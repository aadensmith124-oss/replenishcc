import { desc, eq, inArray, sum } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import {
  AdminSupportTicketListResponse,
  CreateSupportTicketBody,
  CreateSupportTicketResponse,
  CreateSupportTicketRefundBody,
  CreateSupportTicketRefundResponse,
  GetAdminSupportTicketsResponse,
  GetMySupportTicketsResponse,
  GetSupportTicketParams,
  GetSupportTicketResponse,
  PatchAdminSupportTicketStatusBody,
  PatchAdminSupportTicketStatusParams,
  PatchAdminSupportTicketStatusResponse,
  PostSupportTicketMessageBody,
  PostSupportTicketMessageParams,
  PostSupportTicketMessageResponse,
} from "@workspace/api-zod";
import {
  accountLedgerTable,
  db,
  supportTicketMessagesTable,
  supportTicketRefundsTable,
  supportTicketsTable,
  usersTable,
  type SupportTicketMessageRecord,
  type SupportTicketRecord,
  type SupportTicketRefundRecord,
} from "@workspace/db";
import { getCurrentUser, isDepositAdmin } from "../lib/auth";
import { createRateLimit } from "../middlewares/rate-limit";

const router: IRouter = Router();
const createTicketLimit = createRateLimit(
  5,
  60 * 60 * 1000,
  "support-ticket-create",
);
const createMessageLimit = createRateLimit(
  40,
  60 * 60 * 1000,
  "support-ticket-message",
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

function serializeTicket(ticket: SupportTicketRecord) {
  return {
    id: ticket.id,
    category: ticket.category,
    subject: ticket.subject,
    orderReference: ticket.orderReference,
    status: ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

function serializeMessage(message: SupportTicketMessageRecord) {
  return {
    id: message.id,
    authorUserId: message.authorUserId,
    authorName: message.authorName,
    authorRole: message.authorRole,
    body: message.body,
    createdAt: message.createdAt,
  };
}

function serializeRefund(
  refund: SupportTicketRefundRecord,
  adminName = refund.adminName,
) {
  return {
    id: refund.id,
    amountCents: refund.amountCents,
    reason: refund.reason,
    adminName,
    createdAt: refund.createdAt,
  };
}

async function getTicketDetail(ticketId: string) {
  const [ticket] = await db
    .select()
    .from(supportTicketsTable)
    .where(eq(supportTicketsTable.id, ticketId))
    .limit(1);
  if (!ticket) return null;

  const [messages, refunds, members] = await Promise.all([
    db
      .select()
      .from(supportTicketMessagesTable)
      .where(eq(supportTicketMessagesTable.ticketId, ticketId))
      .orderBy(supportTicketMessagesTable.createdAt),
    db
      .select()
      .from(supportTicketRefundsTable)
      .where(eq(supportTicketRefundsTable.ticketId, ticketId))
      .limit(1),
    db
      .select({ fullName: usersTable.fullName, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, ticket.userId))
      .limit(1),
  ]);
  const member = members[0];
  if (!member) return null;

  return GetSupportTicketResponse.parse({
    ticket: serializeTicket(ticket),
    messages: messages.map(serializeMessage),
    refund: refunds[0] ? serializeRefund(refunds[0]) : null,
    memberName: member.fullName,
    memberEmail: member.email,
  });
}

router.post(
  "/support/tickets",
  createTicketLimit,
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to create a support ticket." });
      return;
    }

    const parsed = CreateSupportTicketBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Check the ticket details and try again." });
      return;
    }

    const subject = parsed.data.subject.trim();
    const message = parsed.data.message.trim();
    const orderReference = parsed.data.orderReference?.trim() || null;
    if (!subject || !message) {
      res.status(400).json({
        error: "A ticket subject and message cannot be blank.",
      });
      return;
    }

    const ticket = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(supportTicketsTable)
        .values({
          userId: user.id,
          category: parsed.data.category,
          subject,
          orderReference,
        })
        .returning();
      if (!created) throw new Error("The support ticket could not be created.");

      await tx.insert(supportTicketMessagesTable).values({
        ticketId: created.id,
        authorUserId: user.id,
        authorName: user.fullName,
        authorRole: isDepositAdmin(user) ? "admin" : "member",
        body: message,
      });
      return created;
    });

    const detail = await getTicketDetail(ticket.id);
    if (!detail) {
      res.status(500).json({ error: "The created ticket could not be loaded." });
      return;
    }
    res.status(201).json(CreateSupportTicketResponse.parse(detail));
  },
);

router.get("/support/tickets/me", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view your support tickets." });
    return;
  }

  const tickets = await db
    .select()
    .from(supportTicketsTable)
    .where(eq(supportTicketsTable.userId, user.id))
    .orderBy(desc(supportTicketsTable.updatedAt));

  res.json(
    GetMySupportTicketsResponse.parse({
      tickets: tickets.map(serializeTicket),
    }),
  );
});

router.get(
  "/support/tickets/:ticketId",
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to view this support ticket." });
      return;
    }

    const params = GetSupportTicketParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid support ticket." });
      return;
    }
    const [ticket] = await db
      .select({ userId: supportTicketsTable.userId })
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.id, params.data.ticketId))
      .limit(1);
    if (!ticket) {
      res.status(404).json({ error: "Support ticket not found." });
      return;
    }
    if (ticket.userId !== user.id && !isDepositAdmin(user)) {
      res.status(403).json({ error: "This support ticket belongs to another member." });
      return;
    }

    const detail = await getTicketDetail(params.data.ticketId);
    if (!detail) {
      res.status(404).json({ error: "Support ticket not found." });
      return;
    }
    res.json(GetSupportTicketResponse.parse(detail));
  },
);

router.post(
  "/support/tickets/:ticketId/messages",
  createMessageLimit,
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to reply to a support ticket." });
      return;
    }

    const params = PostSupportTicketMessageParams.safeParse(req.params);
    const parsed = PostSupportTicketMessageBody.safeParse(req.body);
    if (!params.success || !parsed.success || !parsed.data.message.trim()) {
      res.status(400).json({ error: "Enter a valid ticket message." });
      return;
    }
    const admin = isDepositAdmin(user);
    const result = await db.transaction(async (tx) => {
      const [ticket] = await tx
        .select()
        .from(supportTicketsTable)
        .where(eq(supportTicketsTable.id, params.data.ticketId))
        .for("update")
        .limit(1);
      if (!ticket) return { kind: "not-found" as const };
      if (ticket.userId !== user.id && !admin) {
        return { kind: "forbidden" as const };
      }
      if (ticket.status === "closed" && !admin) {
        return { kind: "closed" as const };
      }

      const [message] = await tx
        .insert(supportTicketMessagesTable)
        .values({
          ticketId: ticket.id,
          authorUserId: user.id,
          authorName: user.fullName,
          authorRole: admin ? "admin" : "member",
          body: parsed.data.message.trim(),
        })
        .returning();
      if (!message) throw new Error("The support reply could not be saved.");

      await tx
        .update(supportTicketsTable)
        .set({
          updatedAt: new Date(),
          ...(!admin && ticket.status === "resolved" ? { status: "open" } : {}),
        })
        .where(eq(supportTicketsTable.id, ticket.id));
      return { kind: "created" as const, message };
    });

    if (result.kind === "not-found") {
      res.status(404).json({ error: "Support ticket not found." });
      return;
    }
    if (result.kind === "forbidden") {
      res.status(403).json({ error: "This support ticket belongs to another member." });
      return;
    }
    if (result.kind === "closed") {
      res.status(409).json({
        error: "This ticket is closed. Create a new ticket if you still need help.",
      });
      return;
    }

    res
      .status(201)
      .json(PostSupportTicketMessageResponse.parse({
        message: serializeMessage(result.message),
      }));
  },
);

router.get("/admin/support/tickets", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to review support tickets." });
    return;
  }
  if (!isDepositAdmin(user)) {
    res.status(403).json({ error: "Admin access is required." });
    return;
  }

  const rows = await db
    .select({
      ticket: supportTicketsTable,
      memberName: usersTable.fullName,
      memberEmail: usersTable.email,
    })
    .from(supportTicketsTable)
    .innerJoin(usersTable, eq(supportTicketsTable.userId, usersTable.id))
    .orderBy(desc(supportTicketsTable.updatedAt))
    .limit(300);
  const ticketIds = rows.map(({ ticket }) => ticket.id);
  const refunds = ticketIds.length
    ? await db
        .select({ ticketId: supportTicketRefundsTable.ticketId })
        .from(supportTicketRefundsTable)
        .where(inArray(supportTicketRefundsTable.ticketId, ticketIds))
    : [];
  const refundedTicketIds = new Set(refunds.map((refund) => refund.ticketId));

  res.json(
    GetAdminSupportTicketsResponse.parse({
      tickets: rows.map(({ ticket, memberName, memberEmail }) => ({
        ...serializeTicket(ticket),
        memberName,
        memberEmail,
        hasRefund: refundedTicketIds.has(ticket.id),
      })),
    }),
  );
});

router.patch(
  "/admin/support/tickets/:ticketId/status",
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to update a support ticket." });
      return;
    }
    if (!isDepositAdmin(user)) {
      res.status(403).json({ error: "Admin access is required." });
      return;
    }

    const params = PatchAdminSupportTicketStatusParams.safeParse(req.params);
    const parsed = PatchAdminSupportTicketStatusBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Choose a valid ticket status." });
      return;
    }

    const [ticket] = await db
      .update(supportTicketsTable)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(eq(supportTicketsTable.id, params.data.ticketId))
      .returning();
    if (!ticket) {
      res.status(404).json({ error: "Support ticket not found." });
      return;
    }

    const detail = await getTicketDetail(ticket.id);
    if (!detail) {
      res.status(404).json({ error: "Support ticket not found." });
      return;
    }
    res.json(PatchAdminSupportTicketStatusResponse.parse(detail));
  },
);

router.post(
  "/admin/support/tickets/:ticketId/refund",
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to issue a refund." });
      return;
    }
    if (!isDepositAdmin(user)) {
      res.status(403).json({ error: "Admin access is required." });
      return;
    }

    const params = PatchAdminSupportTicketStatusParams.safeParse(req.params);
    const parsed = CreateSupportTicketRefundBody.safeParse(req.body);
    if (
      !params.success ||
      !parsed.success ||
      !parsed.data.reason.trim() ||
      !Number.isSafeInteger(parsed.data.amountCents)
    ) {
      res.status(400).json({ error: "Enter a valid balance refund amount and reason." });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [ticket] = await tx
        .select()
        .from(supportTicketsTable)
        .where(eq(supportTicketsTable.id, params.data.ticketId))
        .for("update")
        .limit(1);
      if (!ticket) return { kind: "not-found" as const };

      const [existing] = await tx
        .select({ id: supportTicketRefundsTable.id })
        .from(supportTicketRefundsTable)
        .where(eq(supportTicketRefundsTable.ticketId, ticket.id))
        .limit(1);
      if (existing) return { kind: "already-refunded" as const };

      const [refund] = await tx
        .insert(supportTicketRefundsTable)
        .values({
          ticketId: ticket.id,
          userId: ticket.userId,
          adminUserId: user.id,
          adminName: user.fullName,
          amountCents: parsed.data.amountCents,
          reason: parsed.data.reason.trim(),
        })
        .returning();
      if (!refund) throw new Error("The support refund could not be recorded.");

      await tx.insert(accountLedgerTable).values({
        userId: ticket.userId,
        entryType: "support_refund",
        amountCents: refund.amountCents,
        supportRefundId: refund.id,
      });
      const [balance] = await tx
        .select({ balanceCents: sum(accountLedgerTable.amountCents) })
        .from(accountLedgerTable)
        .where(eq(accountLedgerTable.userId, ticket.userId));

      await tx
        .update(supportTicketsTable)
        .set({ updatedAt: new Date() })
        .where(eq(supportTicketsTable.id, ticket.id));
      return {
        kind: "created" as const,
        refund,
        balanceCents: Number(balance?.balanceCents ?? 0),
      };
    });

    if (result.kind === "not-found") {
      res.status(404).json({ error: "Support ticket not found." });
      return;
    }
    if (result.kind === "already-refunded") {
      res.status(409).json({ error: "This ticket already has a balance refund." });
      return;
    }

    res.status(201).json(
      CreateSupportTicketRefundResponse.parse({
        refund: serializeRefund(result.refund),
        balanceCents: result.balanceCents,
      }),
    );
  },
);

export default router;