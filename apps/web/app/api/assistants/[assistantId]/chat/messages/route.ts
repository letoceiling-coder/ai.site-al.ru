import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { buildMessageContent, parseMessageContent } from "@/lib/agent-chat";

type Context = { params: Promise<{ assistantId: string }> };

function normalizeMessage(message: {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
  userId: string | null;
}) {
  const parsed = parseMessageContent(message.content);
  return {
    id: message.id,
    role: message.role,
    text: parsed.text,
    attachments: parsed.attachments,
    createdAt: message.createdAt.toISOString(),
    userId: message.userId,
  };
}

export async function GET(request: Request, context: Context) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { assistantId } = await context.params;
  const url = new URL(request.url);
  const dialogId = url.searchParams.get("dialogId")?.trim() ?? "";
  if (!dialogId) {
    return fail("dialogId is required", "BAD_REQUEST", 400);
  }
  const dialog = await prisma.dialog.findFirst({
    where: { id: dialogId, tenantId: auth.tenantId, userId: auth.userId, assistantId },
  });
  if (!dialog) {
    return fail("Диалог не найден", "NOT_FOUND", 404);
  }
  const messages = await prisma.message.findMany({
    where: { tenantId: auth.tenantId, dialogId },
    orderBy: { createdAt: "asc" },
    take: 300,
  });
  return ok({
    dialog: { id: dialog.id, status: dialog.status, createdAt: dialog.createdAt.toISOString() },
    messages: messages.map(normalizeMessage),
  });
}
