import { randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { compare, hash } from "bcryptjs";
import { Router, type IRouter } from "express";
import {
  GetAuthMeResponse,
  PostAuthForgotPasswordBody,
  PostAuthForgotPasswordResponse,
  PostAuthLoginBody,
  PostAuthLoginResponse,
  PostAuthLogoutResponse,
  PostAuthRegisterBody,
  PostAuthRegisterResponse,
  PostAuthResetPasswordBody,
  PostAuthResetPasswordResponse,
} from "@workspace/api-zod";
import {
  db,
  passwordResetTokensTable,
  userSessionsTable,
  usersTable,
} from "@workspace/db";
import {
  clearSessionCookie,
  createSession,
  destroyCurrentSession,
  digestToken,
  getCurrentUser,
  toAuthUser,
} from "../lib/auth";
import { createRateLimit } from "../middlewares/rate-limit";

const router: IRouter = Router();
const registerLimit = createRateLimit(5, 60 * 60 * 1000, "register");
const loginLimit = createRateLimit(10, 15 * 60 * 1000, "login");
const forgotLimit = createRateLimit(5, 60 * 60 * 1000, "forgot-password");
const resetLimit = createRateLimit(10, 15 * 60 * 1000, "reset-password");
const genericResetMessage =
  "If an account exists for that email, you'll receive a password reset link shortly.";

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    next();
    return;
  }

  const origin = req.get("origin");
  if (!origin) {
    next();
    return;
  }

  try {
    if (new URL(origin).host !== req.get("host")) {
      res.status(403).json({ error: "Request origin is not allowed." });
      return;
    }
  } catch {
    res.status(403).json({ error: "Request origin is not allowed." });
    return;
  }

  next();
});

router.post(
  "/auth/register",
  registerLimit,
  async (req, res): Promise<void> => {
    const parsed = PostAuthRegisterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Please check the details and try again." });
      return;
    }

    const input = parsed.data;
    const fullName = input.fullName.trim();
    const email = input.email.trim().toLowerCase();
    const username = input.username?.trim().toLowerCase() || null;

    if (!fullName) {
      res.status(400).json({ error: "Please enter your full name." });
      return;
    }
    if (input.password !== input.confirmPassword) {
      res.status(400).json({ error: "Passwords do not match." });
      return;
    }

    const passwordHash = await hash(input.password, 12);

    try {
      const [user] = await db
        .insert(usersTable)
        .values({ fullName, username, email, passwordHash })
        .returning();

      if (!user) {
        res.status(500).json({ error: "We could not create your account." });
        return;
      }

      await createSession(user.id, res);
      res
        .status(201)
        .json(
          PostAuthRegisterResponse.parse({
            message: "Your account is ready.",
            user: toAuthUser(user),
          }),
        );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        res
          .status(409)
          .json({ error: "An account with that email or username already exists." });
        return;
      }
      req.log.error({ err: error }, "Account registration failed");
      res.status(500).json({ error: "We could not create your account." });
    }
  },
);

router.post("/auth/login", loginLimit, async (req, res): Promise<void> => {
  const parsed = PostAuthLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please enter a valid email and password." });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  const passwordMatches = user
    ? await compare(parsed.data.password, user.passwordHash)
    : false;

  if (!user || !passwordMatches) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  await createSession(user.id, res, parsed.data.rememberMe ?? false);
  res.json(
    PostAuthLoginResponse.parse({
      message: "You are signed in.",
      user: toAuthUser(user),
    }),
  );
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await destroyCurrentSession(req);
  clearSessionCookie(res);
  res.json(PostAuthLogoutResponse.parse({ message: "You are signed out." }));
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  res.json(
    GetAuthMeResponse.parse({
      authenticated: Boolean(user),
      user: user ? toAuthUser(user) : null,
    }),
  );
});

router.post(
  "/auth/forgot-password",
  forgotLimit,
  async (req, res): Promise<void> => {
    const parsed = PostAuthForgotPasswordBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Please enter a valid email address." });
      return;
    }

    if (process.env.NODE_ENV === "production") {
      res.status(503).json({
        error: "Password recovery email delivery is not configured.",
      });
      return;
    }

    const email = parsed.data.email.trim().toLowerCase();
    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (user) {
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await db.transaction(async (tx) => {
        await tx
          .delete(passwordResetTokensTable)
          .where(eq(passwordResetTokensTable.userId, user.id));
        await tx.insert(passwordResetTokensTable).values({
          userId: user.id,
          tokenHash: digestToken(token),
          expiresAt,
        });
      });

      const origin = req.get("origin") ?? `${req.protocol}://${req.get("host")}`;
      const resetUrl = new URL(
        `/reset-password/${encodeURIComponent(token)}`,
        origin,
      ).toString();
      req.log.info({ resetUrl }, "Development password reset link");
    }

    res.json(
      PostAuthForgotPasswordResponse.parse({ message: genericResetMessage }),
    );
  },
);

router.post(
  "/auth/reset-password",
  resetLimit,
  async (req, res): Promise<void> => {
    const parsed = PostAuthResetPasswordBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Please check your new password." });
      return;
    }
    if (parsed.data.password !== parsed.data.confirmPassword) {
      res.status(400).json({ error: "Passwords do not match." });
      return;
    }

    const now = new Date();
    const tokenHash = digestToken(parsed.data.token);
    const newPasswordHash = await hash(parsed.data.password, 12);
    const updated = await db.transaction(async (tx) => {
      const [resetToken] = await tx
        .select()
        .from(passwordResetTokensTable)
        .where(
          and(
            eq(passwordResetTokensTable.tokenHash, tokenHash),
            gt(passwordResetTokensTable.expiresAt, now),
          ),
        )
        .for("update")
        .limit(1);

      if (!resetToken) {
        await tx
          .delete(passwordResetTokensTable)
          .where(
            and(
              eq(passwordResetTokensTable.tokenHash, tokenHash),
              sql`${passwordResetTokensTable.expiresAt} <= ${now}`,
            ),
          );
        return false;
      }

      await tx
        .update(usersTable)
        .set({ passwordHash: newPasswordHash, updatedAt: now })
        .where(eq(usersTable.id, resetToken.userId));
      await tx
        .delete(passwordResetTokensTable)
        .where(eq(passwordResetTokensTable.id, resetToken.id));
      await tx
        .delete(userSessionsTable)
        .where(eq(userSessionsTable.userId, resetToken.userId));
      return true;
    });

    if (!updated) {
      res.status(400).json({ error: "This password reset link is invalid or expired." });
      return;
    }

    res.json(
      PostAuthResetPasswordResponse.parse({
        message: "Your password has been updated. You can now sign in.",
      }),
    );
  },
);

export default router;