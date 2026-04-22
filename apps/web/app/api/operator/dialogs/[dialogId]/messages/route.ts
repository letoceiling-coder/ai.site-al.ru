import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { buildMessageContent, parseMessageContent } from "@/lib/agent-chat";
import { extractHandoff } from "@/lib/dialog-handoff";
import { publishOperatorEvent } from "@/lib/operator-events";

type Context = { params: Promise<{ dialogId: string }> };

type PostPayload = {
  text?: string;
};

function normalizeMessage(m: {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
  userId: string | null;
}) {
  const parsed = parseMessageContent(m.content);
  return {
    id: m.id,
    role: m.role,
    text: parsed.text,
    attachments: parsed.attachments,
    createdAt: m.createdAt.toISOString(),
    userId: m.userId,
  };
}

export async function GET(_request: Request, context: Context) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { dialogId } = await context.params;
  if (!dialogId) {
    return fail("dialogId is required", "BAD_REQUEST", 400);
  }
  const dialog = await prisma.dialog.findFirst({
    where: { id: dialogId, tenantId: auth.tenantId },
    select: {
      id: true,
      status: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, email: true, name: true } },
      assistant: { select: { id: true, name: true } },
    },
  });
  if (!dialog) {
    return fail("Dialog not found", "NOT_FOUND", 404);
  }
  const messages = await prisma.message.findMany({
    where: { tenantId: auth.tenantId, dialogId },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: { id: true, role: true, content: true, createdAt: true, userId: true },
  });
  const handoff = extractHandoff(dialog.metadata);
  return ok({
    dialog: {
      id: dialog.id,
      status: dialog.status,
      createdAt: dialog.createdAt.toISOString(),
      updatedAt: dialog.updatedAt.toISOString(),
      user: dialog.user
        ? { id: dialog.user.id, email: dialog.user.email, name: dialog.user.name ?? null }
        : null,
      assistant: dialog.assistant
        ? { id: dialog.assistant.id, name: dialog.assistant.name }
        : null,
      handoff,
    },
    messages: messages.map(normalizeMessage),
  });
}

export async function POST(request: Request, context: Context) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { dialogId } = await context.params;
  if (!dialogId) {
    return fail("dialogId is required", "BAD_REQUEST", 400);
  }
  const body = (await request.json().catch(() => ({}))) as PostPayload;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return fail("Text is required", "BAD_REQUEST", 400);
  }
  const dialog = await prisma.dialog.findFirst({
    where: { id: dialogId, tenantId: auth.tenantId },
    select: { id: true, metadata: true, status: true },
  });
  if (!dialog) {
    return fail("Dialog not found", "NOT_FOUND", 404);
  }
  const handoff = extractHandoff(dialog.metadata);
  if (handoff.state !== "takenOver") {
    return fail("Diaglog not taken over by operator", "CONFLICT", 409);
  }
  if (handoff.takenOverBy && handoff.takenOverBy !== auth.userId) {
    return fail("Dialog is taken by another operator", "FORBIDDEN", 403);
  }

  const message = await prisma.message.create({
    data: {
      tenantId: auth.tenantId,
      dialogId,
      userId: auth.userId,
      role: "ASSISTANT",
      content: buildMessageContent(text.slice(0, 8000), []),
    },
  });
  publishOperatorEvent({ type: "dialog-message", tenantId: auth.tenantId, dialogId });
  return ok({ message: normalizeMessage(message) });
}
