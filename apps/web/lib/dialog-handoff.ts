/**
 * Состояние «передачи оператору» для диалога.
 * Хранится в `Dialog.metadata.handoff` (без миграции схемы).
 *
 *   state = "ai"         — диалог ведёт ассистент (по умолчанию)
 *   state = "queued"     — ассистент попросил оператора; в очереди
 *   state = "takenOver"  — оператор взял диалог, отвечает лично
 *   state = "released"   — оператор вернул диалог ассистенту
 */

import { prisma } from "@ai/db";

export type HandoffState = "ai" | "queued" | "takenOver" | "released";

export type HandoffMetadata = {
  state: HandoffState;
  reason?: string;
  urgency?: "low" | "normal" | "high";
  summary?: string;
  queuedAt?: string | null;
  takenOverAt?: string | null;
  takenOverBy?: string | null;
  takenOverByEmail?: string | null;
  releasedAt?: string | null;
  closedAt?: string | null;
  lastEventAt?: string | null;
};

const DEFAULT_HANDOFF: HandoffMetadata = { state: "ai" };

export function extractHandoff(metadata: unknown): HandoffMetadata {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { ...DEFAULT_HANDOFF };
  }
  const m = metadata as Record<string, unknown>;
  const raw = m.handoff;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_HANDOFF };
  }
  const r = raw as Record<string, unknown>;
  const rawState = typeof r.state === "string" ? r.state : "ai";
  const state: HandoffState = (["ai", "queued", "takenOver", "released"] as const).includes(
    rawState as HandoffState,
  )
    ? (rawState as HandoffState)
    : "ai";
  return {
    state,
    reason: typeof r.reason === "string" ? r.reason : undefined,
    urgency:
      r.urgency === "low" || r.urgency === "normal" || r.urgency === "high" ? r.urgency : undefined,
    summary: typeof r.summary === "string" ? r.summary : undefined,
    queuedAt: typeof r.queuedAt === "string" ? r.queuedAt : null,
    takenOverAt: typeof r.takenOverAt === "string" ? r.takenOverAt : null,
    takenOverBy: typeof r.takenOverBy === "string" ? r.takenOverBy : null,
    takenOverByEmail: typeof r.takenOverByEmail === "string" ? r.takenOverByEmail : null,
    releasedAt: typeof r.releasedAt === "string" ? r.releasedAt : null,
    closedAt: typeof r.closedAt === "string" ? r.closedAt : null,
    lastEventAt: typeof r.lastEventAt === "string" ? r.lastEventAt : null,
  };
}

function buildMetadata(existing: unknown, next: HandoffMetadata): Record<string, unknown> {
  const base: Record<string, unknown> =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  base.handoff = { ...next, lastEventAt: new Date().toISOString() };
  return base;
}

/** Пометить диалог: ассистент попросил оператора (tool handoff_to_operator). */
export async function markDialogQueuedForOperator(
  tenantId: string,
  dialogId: string,
  details: { reason?: string; urgency?: "low" | "normal" | "high"; summary?: string },
): Promise<HandoffMetadata | null> {
  const dialog = await prisma.dialog.findFirst({
    where: { id: dialogId, tenantId },
    select: { id: true, metadata: true },
  });
  if (!dialog) {
    return null;
  }
  const current = extractHandoff(dialog.metadata);
  if (current.state === "takenOver") {
    return current;
  }
  const next: HandoffMetadata = {
    state: "queued",
    reason: details.reason || current.reason,
    urgency: details.urgency || current.urgency,
    summary: details.summary || current.summary,
    queuedAt: new Date().toISOString(),
    takenOverAt: null,
    takenOverBy: null,
    takenOverByEmail: null,
    releasedAt: null,
    closedAt: null,
  };
  await prisma.dialog.update({
    where: { id: dialogId },
    data: { metadata: buildMetadata(dialog.metadata, next) as never },
  });
  return next;
}

/** Оператор взял диалог. */
export async function takeOverDialog(
  tenantId: string,
  dialogId: string,
  operator: { userId: string; email: string },
): Promise<HandoffMetadata | null> {
  const dialog = await prisma.dialog.findFirst({
    where: { id: dialogId, tenantId },
    select: { id: true, metadata: true, status: true },
  });
  if (!dialog) {
    return null;
  }
  const current = extractHandoff(dialog.metadata);
  const next: HandoffMetadata = {
    ...current,
    state: "takenOver",
    takenOverAt: new Date().toISOString(),
    takenOverBy: operator.userId,
    takenOverByEmail: operator.email,
    releasedAt: null,
    closedAt: null,
  };
  await prisma.dialog.update({
    where: { id: dialogId },
    data: { metadata: buildMetadata(dialog.metadata, next) as never },
  });
  return next;
}

/** Оператор вернул диалог ассистенту. */
export async function releaseDialogToAi(
  tenantId: string,
  dialogId: string,
): Promise<HandoffMetadata | null> {
  const dialog = await prisma.dialog.findFirst({
    where: { id: dialogId, tenantId },
    select: { id: true, metadata: true },
  });
  if (!dialog) {
    return null;
  }
  const current = extractHandoff(dialog.metadata);
  const next: HandoffMetadata = {
    ...current,
    state: "released",
    releasedAt: new Date().toISOString(),
    takenOverAt: null,
    takenOverBy: null,
    takenOverByEmail: null,
  };
  await prisma.dialog.update({
    where: { id: dialogId },
    data: { metadata: buildMetadata(dialog.metadata, next) as never },
  });
  return next;
}

/** Оператор закрыл диалог. */
export async function closeHandoffDialog(
  tenantId: string,
  dialogId: string,
): Promise<HandoffMetadata | null> {
  const dialog = await prisma.dialog.findFirst({
    where: { id: dialogId, tenantId },
    select: { id: true, metadata: true },
  });
  if (!dialog) {
    return null;
  }
  const current = extractHandoff(dialog.metadata);
  const next: HandoffMetadata = {
    ...current,
    state: "released",
    closedAt: new Date().toISOString(),
  };
  await prisma.dialog.update({
    where: { id: dialogId },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      metadata: buildMetadata(dialog.metadata, next) as never,
    },
  });
  return next;
}

export function isDialogTakenByOperator(metadata: unknown): boolean {
  return extractHandoff(metadata).state === "takenOver";
}
