import { prisma } from "@ai/db";
import { fail } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { buildAssistantReplyForUserAssistant, buildMessageContent } from "@/lib/agent-chat";
import {
  extractHandoff,
  markDialogQueuedForOperator,
  resolveActiveAssistantId,
} from "@/lib/dialog-handoff";
import { publishOperatorEvent } from "@/lib/operator-events";
import { buildMessageMetadata, filterCitationsByText } from "@/lib/message-citations";

type Context = { params: Promise<{ assistantId: string }> };
type StreamPayload = {
  dialogId?: string;
  text?: string;
  attachments?: Array<{ name: string; url: string; mimeType: string; size: number }>;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function tokenize(text: string) {
  return text.match(/\S+\s*/g) ?? [text];
}

export async function POST(request: Request, context: Context) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { assistantId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as StreamPayload;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return fail("Text is required", "BAD_REQUEST", 400);
  }
  const attachments = Array.isArray(body.attachments)
    ? body.attachments
        .filter((item) => item && typeof item.name === "string" && typeof item.url === "string")
        .slice(0, 10)
    : [];

  const assistantRow = await prisma.assistant.findFirst({
    where: { id: assistantId, tenantId: auth.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!assistantRow) {
    return fail("Assistant not found", "NOT_FOUND", 404);
  }

  let dialogId = typeof body.dialogId === "string" ? body.dialogId.trim() : "";
  let dialog = dialogId
    ? await prisma.dialog.findFirst({
        where: { id: dialogId, tenantId: auth.tenantId, userId: auth.userId, assistantId: assistantRow.id },
      })
    : null;
  if (!dialog) {
    dialog = await prisma.dialog.create({
      data: {
        tenantId: auth.tenantId,
        userId: auth.userId,
        assistantId: assistantRow.id,
        status: "OPEN",
        metadata: { mode: "assistant_test_chat", assistantId: assistantRow.id },
      },
    });
  }
  dialogId = dialog.id;
  const handoffBefore = extractHandoff(dialog.metadata);

  if (handoffBefore.state === "takenOver") {
    await prisma.message.create({
      data: {
        tenantId: auth.tenantId,
        dialogId,
        userId: auth.userId,
        role: "USER",
        content: buildMessageContent(text, attachments),
      },
    });
    publishOperatorEvent({ type: "dialog-message", tenantId: auth.tenantId, dialogId });
    const encoder = new TextEncoder();
    const waitStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };
        send({ type: "meta", dialogId, routeMode: "operator" });
        send({
          type: "handoff",
          state: "takenOver",
          operator: handoffBefore.takenOverByEmail ?? null,
        });
        send({
          type: "done",
          text: "",
          info: "operator_takeover",
        });
        controller.close();
      },
    });
    return new Response(waitStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  const activeAssistantId = resolveActiveAssistantId(dialog.metadata, assistantRow.id);
  const reply = await buildAssistantReplyForUserAssistant({
    tenantId: auth.tenantId,
    assistantId: activeAssistantId,
    userText: text,
    attachments,
    dialogId,
  }).catch((e) => {
    throw e instanceof Error ? e : new Error("Reply failed");
  });

  await prisma.message.create({
    data: {
      tenantId: auth.tenantId,
      dialogId,
      userId: auth.userId,
      role: "USER",
      content: buildMessageContent(text, attachments),
      tokenCount: reply.inputTokens,
      provider: reply.providerForUsage as never,
      model: reply.modelForUsage,
    },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        send({ type: "meta", dialogId, routeMode: reply.routeMode });
        const chunks = tokenize(reply.responseText);
        let full = "";
        for (const chunk of chunks) {
          full += chunk;
          send({ type: "token", token: chunk, text: full });
          await sleep(35);
        }
        const finalText = full.trim();
        const usedCitations = filterCitationsByText(reply.citations ?? [], finalText);
        const messageMetadata = buildMessageMetadata({
          citations: usedCitations,
          knowledgeBaseIds: reply.knowledgeBaseIds ?? [],
        });
        if (usedCitations.length > 0) {
          send({ type: "citations", citations: usedCitations });
        }
        const assistantMessage = await prisma.message.create({
          data: {
            tenantId: auth.tenantId,
            dialogId,
            role: "ASSISTANT",
            content: buildMessageContent(finalText, []),
            tokenCount: reply.outputTokens,
            provider: reply.providerForUsage as never,
            model: reply.modelForUsage,
            metadata: messageMetadata ?? undefined,
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
          send({
            type: "tool",
            toolName: event.toolName,
            status: event.status,
            summary: event.resultText,
          });
          if (event.toolName === "handoff_to_assistant" && event.status === "COMPLETED") {
            const out = (event.outputJson ?? {}) as {
              targetAssistantId?: unknown;
              targetAssistantName?: unknown;
            };
            send({
              type: "handoff_assistant",
              toAssistantId: typeof out.targetAssistantId === "string" ? out.targetAssistantId : null,
              toAssistantName: typeof out.targetAssistantName === "string" ? out.targetAssistantName : null,
            });
          }
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
          send({ type: "handoff", state: "queued" });
        }
        await prisma.usageEvent.create({
          data: {
            tenantId: auth.tenantId,
            provider: reply.providerForUsage as never,
            model: reply.modelForUsage,
            tokensInput: reply.inputTokens,
            tokensOutput: reply.outputTokens,
            totalCostUsd: 0,
            sourceType: reply.routeMode === "openrouter" ? "dialog_openrouter_chat" : "dialog_chat",
            sourceId: dialogId,
          },
        });
        send({ type: "done", text: finalText, citations: usedCitations });
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "Streaming failed" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
