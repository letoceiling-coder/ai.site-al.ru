import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { extractHandoff } from "@/lib/dialog-handoff";
import { parseMessageContent } from "@/lib/agent-chat";

type QueueItem = {
  dialogId: string;
  state: "queued" | "takenOver";
  reason: string | null;
  urgency: "low" | "normal" | "high" | null;
  summary: string | null;
  queuedAt: string | null;
  takenOverAt: string | null;
  takenOverByEmail: string | null;
  takenOverByYou: boolean;
  user: { id: string; email: string; name: string | null } | null;
  assistant: { id: string; name: string } | null;
  lastMessage: { role: string; preview: string; createdAt: string; isUser: boolean } | null;
  createdAt: string;
  updatedAt: string;
};

export async function GET(_request: Request) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const dialogs = await prisma.dialog.findMany({
    where: {
      tenantId: auth.tenantId,
      status: "OPEN",
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      userId: true,
      assistantId: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, email: true, name: true } },
      assistant: { select: { id: true, name: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { role: true, content: true, createdAt: true, userId: true },
      },
    },
  });

  const items: QueueItem[] = [];
  for (const d of dialogs as Array<(typeof dialogs)[number]>) {
    const handoff = extractHandoff(d.metadata);
    if (handoff.state !== "queued" && handoff.state !== "takenOver") {
      continue;
    }
    const last = d.messages[0] ?? null;
    const lastPreview = last ? parseMessageContent(last.content).text.slice(0, 200) : "";
    items.push({
      dialogId: d.id,
      state: handoff.state,
      reason: handoff.reason ?? null,
      urgency: handoff.urgency ?? null,
      summary: handoff.summary ?? null,
      queuedAt: handoff.queuedAt ?? null,
      takenOverAt: handoff.takenOverAt ?? null,
      takenOverByEmail: handoff.takenOverByEmail ?? null,
      takenOverByYou: handoff.takenOverBy === auth.userId,
      user: d.user ? { id: d.user.id, email: d.user.email, name: d.user.name ?? null } : null,
      assistant: d.assistant ? { id: d.assistant.id, name: d.assistant.name } : null,
      lastMessage: last
        ? {
            role: last.role,
            preview: lastPreview,
            createdAt: last.createdAt.toISOString(),
            isUser: last.role === "USER",
          }
        : null,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    });
  }

  items.sort((a, b) => {
    const aPriority = a.state === "queued" ? 0 : 1;
    const bPriority = b.state === "queued" ? 0 : 1;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return (b.queuedAt ?? b.updatedAt).localeCompare(a.queuedAt ?? a.updatedAt);
  });

  return ok({ items, count: items.length });
}
