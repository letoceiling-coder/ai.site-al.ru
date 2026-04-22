import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { buildAssistantReply, buildMessageContent, parseMessageContent } from "@/lib/agent-chat";
import { markDialogQueuedForOperator } from "@/lib/dialog-handoff";
import { publishOperatorEvent } from "@/lib/operator-events";

type Context = {
  params: Promise<{ agentId: string }>;
};

type MessagePayload = {
  dialogId?: string;
  text?: string;
  attachments?: Array<{ name: string; url: string; mimeType: string; size: number }>;
};

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
  const { agentId } = await context.params;
  const url = new URL(request.url);
  const dialogId = url.searchParams.get("dialogId")?.trim() ?? "";
  if (!dialogId) {
    return fail("dialogId is required", "BAD_REQUEST", 400);
  }

  const dialog = await prisma.dialog.findFirst({
    where: {
      id: dialogId,
      tenantId: auth.tenantId,
      metadata: {
        path: ["agentId"],
        equals: agentId,
      },
    },
  });
  if (!dialog) {
    return fail("Dialog not found", "NOT_FOUND", 404);
  }

  const messages = await prisma.message.findMany({
    where: { tenantId: auth.tenantId, dialogId },
    orderBy: { createdAt: "asc" },
    take: 300,
  });

  return ok({
    dialog: {
      id: dialog.id,
      status: dialog.status,
      createdAt: dialog.createdAt.toISOString(),
    },
    messages: messages.map(normalizeMessage),
  });
}

export async function POST(request: Request, context: Context) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const { agentId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as MessagePayload;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return fail("Text is required", "BAD_REQUEST", 400);
  }
  const attachments = Array.isArray(body.attachments)
    ? body.attachments
        .filter((item) => item && typeof item.name === "string" && typeof item.url === "string")
        .slice(0, 10)
    : [];

  const incomingDialogId = typeof body.dialogId === "string" ? body.dialogId.trim() : "";
  const reply = await buildAssistantReply({
    tenantId: auth.tenantId,
    userId: auth.userId,
    agentId,
    userText: text,
    attachments,
    dialogId: incomingDialogId || undefined,
  }).catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(message);
  });

  let dialogId = incomingDialogId;
  let dialog = dialogId
    ? await prisma.dialog.findFirst({
        where: {
          id: dialogId,
          tenantId: auth.tenantId,
          assistantId: reply.assistant.id,
        },
      })
    : null;

  if (!dialog) {
    dialog = await prisma.dialog.create({
      data: {
        tenantId: auth.tenantId,
        userId: auth.userId,
        assistantId: reply.assistant.id,
        status: "OPEN",
        metadata: {
          mode: "agent_test_chat",
          agentId: reply.agent.id,
          assistantId: reply.assistant.id,
        },
      },
    });
  }
  dialogId = dialog.id;

  const userMessage = await prisma.message.create({
    data: {
      tenantId: auth.tenantId,
      dialogId,
      userId: auth.userId,
      role: "USER",
      content: buildMessageContent(text, attachments),
      tokenCount: reply.inputTokens,
      provider: reply.providerForUsage as any,
      model: reply.modelForUsage,
    },
  });

  const assistantMessage = await prisma.message.create({
    data: {
      tenantId: auth.tenantId,
      dialogId,
      role: "ASSISTANT",
      content: buildMessageContent(reply.responseText, []),
      tokenCount: reply.outputTokens,
      provider: reply.providerForUsage as any,
      model: reply.modelForUsage,
    },
  });

  let queuedForOperator = false;
  for (const event of reply.toolEvents ?? []) {
    await prisma.toolCall.create({
      data: {
        tenantId: auth.tenantId,
        messageId: assistantMessage.id,
        toolName: event.toolName,
        status: event.status,
        inputJson: event.inputJson as never,
        outputJson: event.outputJson as never,
      },
    });
    if (event.toolName === "handoff_to_operator" && event.status === "COMPLETED") {
      const input = (event.inputJson ?? {}) as {
        reason?: unknown;
        urgency?: unknown;
        summary?: unknown;
      };
      const urgencyRaw = typeof input.urgency === "string" ? input.urgency.toLowerCase() : "";
      const urgency: "low" | "normal" | "high" | undefined =
        urgencyRaw === "low" || urgencyRaw === "high"
          ? (urgencyRaw as "low" | "high")
          : urgencyRaw === "normal"
            ? "normal"
            : undefined;
      await markDialogQueuedForOperator(auth.tenantId, dialogId, {
        reason: typeof input.reason === "string" ? input.reason.slice(0, 1000) : undefined,
        urgency,
        summary: typeof input.summary === "string" ? input.summary.slice(0, 2000) : undefined,
      });
      queuedForOperator = true;
    }
  }
  if (queuedForOperator) {
    publishOperatorEvent({ type: "queue", tenantId: auth.tenantId });
    publishOperatorEvent({ type: "dialog-updated", tenantId: auth.tenantId, dialogId });
  }

  await prisma.usageEvent.create({
    data: {
      tenantId: auth.tenantId,
      provider: reply.providerForUsage as any,
      model: reply.modelForUsage,
      tokensInput: reply.inputTokens,
      tokensOutput: reply.outputTokens,
      totalCostUsd: 0,
      sourceType: reply.routeMode === "openrouter" ? "dialog_openrouter_chat" : "dialog_chat",
      sourceId: dialogId,
    },
  });

  return ok({
    dialogId,
    routeMode: reply.routeMode,
    messages: [normalizeMessage(userMessage), normalizeMessage(assistantMessage)],
    toolEvents: (reply.toolEvents ?? []).map((e) => ({
      toolName: e.toolName,
      status: e.status,
      summary: e.resultText,
    })),
  });
}
