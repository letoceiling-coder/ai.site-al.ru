import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { extractAssistantSettings } from "@/lib/assistant-settings";

type Context = { params: Promise<{ assistantId: string }> };

function pickGreeting(assistant: { settingsJson: unknown }) {
  const persona = extractAssistantSettings(assistant.settingsJson);
  return {
    welcomeMessage: persona.welcomeMessage || null,
    quickReplies: persona.quickReplies.length > 0 ? persona.quickReplies : [],
  };
}

export async function GET(_: Request, context: Context) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { assistantId } = await context.params;
  const assistant = await prisma.assistant.findFirst({
    where: { id: assistantId, tenantId: auth.tenantId, deletedAt: null },
    select: { id: true, settingsJson: true },
  });
  if (!assistant) {
    return fail("Ассистент не найден", "NOT_FOUND", 404);
  }
  const dialogs = await prisma.dialog.findMany({
    where: {
      tenantId: auth.tenantId,
      userId: auth.userId,
      assistantId,
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, status: true, createdAt: true, updatedAt: true },
  });
  return ok({
    sessions: dialogs.map((d: (typeof dialogs)[number]) => ({
      id: d.id,
      status: d.status,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    })),
    greeting: pickGreeting(assistant),
  });
}

export async function POST(_: Request, context: Context) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { assistantId } = await context.params;
  const assistant = await prisma.assistant.findFirst({
    where: { id: assistantId, tenantId: auth.tenantId, deletedAt: null },
  });
  if (!assistant) {
    return fail("Ассистент не найден", "NOT_FOUND", 404);
  }
  const dialog = await prisma.dialog.create({
    data: {
      tenantId: auth.tenantId,
      userId: auth.userId,
      assistantId,
      status: "OPEN",
      metadata: { mode: "assistant_test_chat", assistantId },
    },
  });
  return ok({
    dialog: { id: dialog.id, status: dialog.status, createdAt: dialog.createdAt.toISOString() },
    greeting: pickGreeting(assistant),
  });
}
