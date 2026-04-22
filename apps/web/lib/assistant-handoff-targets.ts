/**
 * Настройки передачи диалога между ассистентами («роутинг» между специалистами).
 * Хранится в `Assistant.settingsJson.handoffTargets`.
 *
 * Пример:
 *   handoffTargets: [
 *     { assistantId: "abc", description: "Вопросы по оплате и тарифам" },
 *     { assistantId: "xyz", description: "Технические проблемы и диагностика" },
 *   ]
 *
 * Активирует встроенный tool `handoff_to_assistant`, в котором enum `targetAssistantId`
 * строится динамически из этого списка.
 */

export type AssistantHandoffTarget = {
  assistantId: string;
  description: string;
};

const MAX_TARGETS = 8;
const DESC_MAX = 240;

export function normalizeHandoffTargets(raw: unknown): AssistantHandoffTarget[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: AssistantHandoffTarget[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    const id = typeof v.assistantId === "string" ? v.assistantId.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const desc = typeof v.description === "string" ? v.description.slice(0, DESC_MAX).trim() : "";
    out.push({ assistantId: id, description: desc });
    if (out.length >= MAX_TARGETS) break;
  }
  return out;
}

export function extractHandoffTargets(settingsJson: unknown): AssistantHandoffTarget[] {
  if (!settingsJson || typeof settingsJson !== "object" || Array.isArray(settingsJson)) {
    return [];
  }
  const v = settingsJson as Record<string, unknown>;
  return normalizeHandoffTargets(v.handoffTargets);
}

export function mergeHandoffTargets(
  existing: unknown,
  incoming: AssistantHandoffTarget[] | undefined,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  if (incoming === undefined) {
    return base;
  }
  base.handoffTargets = normalizeHandoffTargets(incoming);
  return base;
}

/** Текстовое описание доступных целей для системного промпта. */
export function buildHandoffTargetsDirective(
  targets: Array<{ assistantId: string; name: string; description?: string }>,
): string {
  if (targets.length === 0) return "";
  const lines = targets.map((t) => {
    const descr = t.description ? ` — ${t.description}` : "";
    return `• «${t.name}» (id=${t.assistantId})${descr}`;
  });
  return (
    "У тебя есть инструмент `handoff_to_assistant` — передача диалога другому специалисту. " +
    "Вызывай его, когда вопрос явно относится к профилю другого ассистента из списка. " +
    "Доступные специалисты:\n" +
    lines.join("\n") +
    "\nПеред вызовом коротко объясни пользователю, что передаёшь вопрос нужному специалисту, " +
    "а затем вызови инструмент с `targetAssistantId` строго из enum."
  );
}
