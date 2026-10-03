import { desc, eq, isNull } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import {
  CreateAnnouncementBody,
  CreateAnnouncementResponse,
  GetAdminAnnouncementsResponse,
  GetAnnouncementsResponse,
  UpdateAnnouncementBody,
  UpdateAnnouncementParams,
  UpdateAnnouncementResponse,
} from "@workspace/api-zod";
import {
  announcementsTable,
  db,
  type AnnouncementRecord,
} from "@workspace/db";
import { getCurrentUser, isDepositAdmin } from "../lib/auth";
import { createRateLimit } from "../middlewares/rate-limit";

const router: IRouter = Router();
const createAnnouncementLimit = createRateLimit(
  30,
  60 * 60 * 1000,
  "announcement-create",
);

function isSameOriginWrite(req: Request): boolean {
  const origin = req.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.get("host");
  } catch {
    return false;
  }
}

function serializeAnnouncement(announcement: AnnouncementRecord) {
  return {
    id: announcement.id,
    title: announcement.title,
    body: announcement.body,
    createdAt: announcement.createdAt,
    publishedAt: announcement.publishedAt,
    archivedAt: announcement.archivedAt,
  };
}

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  if (!isSameOriginWrite(req)) {
    res.status(403).json({ error: "Request origin is not allowed." });
    return;
  }
  next();
});

router.get("/announcements", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view announcements." });
    return;
  }

  const rows = await db
    .select()
    .from(announcementsTable)
    .where(isNull(announcementsTable.archivedAt))
    .orderBy(desc(announcementsTable.publishedAt))
    .limit(100);

  res.json(
    GetAnnouncementsResponse.parse({
      announcements: rows.map(serializeAnnouncement),
    }),
  );
});

router.get("/admin/announcements", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage announcements." });
    return;
  }
  if (!isDepositAdmin(user)) {
    res.status(403).json({ error: "Administrator access is required." });
    return;
  }

  const rows = await db
    .select()
    .from(announcementsTable)
    .orderBy(desc(announcementsTable.publishedAt))
    .limit(200);

  res.json(
    GetAdminAnnouncementsResponse.parse({
      announcements: rows.map(serializeAnnouncement),
    }),
  );
});

router.post(
  "/admin/announcements",
  createAnnouncementLimit,
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to publish announcements." });
      return;
    }
    if (!isDepositAdmin(user)) {
      res.status(403).json({ error: "Administrator access is required." });
      return;
    }

    const parsed = CreateAnnouncementBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Please check the announcement details." });
      return;
    }

    const title = parsed.data.title.trim();
    const body = parsed.data.body.trim();
    if (!title || !body) {
      res.status(400).json({
        error: "Announcement title and message cannot be blank.",
      });
      return;
    }

    const [created] = await db
      .insert(announcementsTable)
      .values({ title, body, createdByUserId: user.id })
      .returning();
    if (!created) {
      res.status(500).json({ error: "The announcement could not be saved." });
      return;
    }

    res
      .status(201)
      .json(CreateAnnouncementResponse.parse(serializeAnnouncement(created)));
  },
);

router.patch(
  "/admin/announcements/:announcementId",
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to manage announcements." });
      return;
    }
    if (!isDepositAdmin(user)) {
      res.status(403).json({ error: "Administrator access is required." });
      return;
    }

    const parsedParams = UpdateAnnouncementParams.safeParse(req.params);
    const parsedBody = UpdateAnnouncementBody.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      res.status(400).json({ error: "Please check the announcement action." });
      return;
    }

    const now = new Date();
    const update =
      parsedBody.data.action === "archive"
        ? { archivedAt: now }
        : { archivedAt: null, publishedAt: now };
    const [updated] = await db
      .update(announcementsTable)
      .set(update)
      .where(eq(announcementsTable.id, parsedParams.data.announcementId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Announcement not found." });
      return;
    }

    res.json(
      UpdateAnnouncementResponse.parse(serializeAnnouncement(updated)),
    );
  },
);

export default router;