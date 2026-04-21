import { prisma } from "@ai/db";
import { fail } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { buildAssistantReplyForUserAssistant, buildMessageContent } from "@/lib/agent-chat";

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

  const reply = await buildAssistantReplyForUserAssistant({
    tenantId: auth.tenantId,
    assistantId,
    userText: text,
    attachments,
  }).catch((e) => {
    throw e instanceof Error ? e : new Error("Reply failed");
  });

  const assistantRow = reply.assistant;
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
        await prisma.message.create({
          data: {
            tenantId: auth.tenantId,
            dialogId,
            role: "ASSISTANT",
            content: buildMessageContent(full.trim(), []),
            tokenCount: reply.outputTokens,
            provider: reply.providerForUsage as never,
            model: reply.modelForUsage,
          },
        });
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
        send({ type: "done", text: full.trim() });
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
