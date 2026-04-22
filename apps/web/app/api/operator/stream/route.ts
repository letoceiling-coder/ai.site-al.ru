import { fail } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { subscribeOperatorEvents, type OperatorEvent } from "@/lib/operator-events";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events поток событий оператора: изменения очереди + новые сообщения в диалогах.
 * Клиент (страница /operator) подписан и обновляет UI по событиям.
 */
export async function GET(request: Request) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const encoder = new TextEncoder();
  const tenantId = auth.tenantId;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };
      const send = (event: Record<string, unknown>) => {
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      send({ type: "ready", at: Date.now() });

      const unsubscribe = subscribeOperatorEvents(tenantId, (event: OperatorEvent) => {
        send(event);
      });

      const heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(`: keep-alive ${Date.now()}\n\n`));
      }, 20_000);

      const onAbort = () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };
      request.signal.addEventListener("abort", onAbort);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
