import type { KnowledgeCitation } from "@/lib/knowledge-context";

/**
 * Из полного списка citations (те, что попали в системный промпт) оставляет только те,
 * чьи маркеры [#N] реально упомянуты в тексте ответа модели. Если модель не проставила
 * ни одной ссылки — возвращается полный список (fallback: показать все что ей передали).
 */
export function filterCitationsByText(
  citations: KnowledgeCitation[],
  answerText: string,
): KnowledgeCitation[] {
  if (!citations.length) {
    return [];
  }
  const text = String(answerText || "");
  const used = new Set<string>();
  const matches = text.match(/\[#\d+\]/g);
  if (matches) {
    for (const m of matches) {
      used.add(m.slice(1, -1)); // "[#3]" → "#3"
    }
  }
  if (used.size === 0) {
    return citations;
  }
  return citations.filter((c) => used.has(c.marker));
}

/**
 * Подсчитать уникальные маркеры [#N], которые модель реально поставила в ответе.
 * Удобно для метрик.
 */
export function countUsedMarkers(answerText: string): number {
  const text = String(answerText || "");
  const matches = text.match(/\[#\d+\]/g);
  if (!matches) {
    return 0;
  }
  return new Set(matches).size;
}

/** Компактная сериализация citations для сохранения в Message.metadata. */
export type MessageMetadata = {
  citations?: KnowledgeCitation[];
  knowledgeBaseIds?: string[];
  toolEvents?: Array<Record<string, unknown>>;
};

export function buildMessageMetadata(input: {
  citations?: KnowledgeCitation[];
  knowledgeBaseIds?: string[];
  toolEvents?: Array<Record<string, unknown>>;
}): MessageMetadata | null {
  const md: MessageMetadata = {};
  if (input.citations && input.citations.length > 0) {
    md.citations = input.citations;
  }
  if (input.knowledgeBaseIds && input.knowledgeBaseIds.length > 0) {
    md.knowledgeBaseIds = input.knowledgeBaseIds;
  }
  if (input.toolEvents && input.toolEvents.length > 0) {
    md.toolEvents = input.toolEvents;
  }
  return Object.keys(md).length > 0 ? md : null;
}

/** Извлечь citations из Message.metadata (для GET-эндпоинтов). */
export function extractCitations(metadata: unknown): KnowledgeCitation[] {
  if (!metadata || typeof metadata !== "object") {
    return [];
  }
  const md = metadata as MessageMetadata;
  if (!Array.isArray(md.citations)) {
    return [];
  }
  return md.citations.filter((c): c is KnowledgeCitation => {
    if (!c || typeof c !== "object") {
      return false;
    }
    const obj = c as Partial<KnowledgeCitation>;
    return typeof obj.marker === "string" && typeof obj.knowledgeItemId === "string";
  });
}
