import { prisma } from "@ai/db";

export type KnowledgeGroundingMode = "strict" | "mixed";

export type KnowledgeSettings = {
  /** Размер одного чанка в символах (300..4000). */
  chunkSize: number;
  /** Перекрытие между чанками (0..500). */
  chunkOverlap: number;
  /** Строгость ответа: strict — только по базе; mixed — можно дополнять общими знаниями. */
  grounding: KnowledgeGroundingMode;
  /** Автоматически подбирать заголовок для TEXT/URL, если пользователь не задал. */
  autoTitle: boolean;
  /** Максимум символов контекста, попадающих в системный промпт. */
  maxContextChars: number;
  /** Пресет, из которого база была создана (опционально, для UI). */
  template?: string;
};

export const DEFAULT_KNOWLEDGE_SETTINGS: KnowledgeSettings = {
  chunkSize: 1800,
  chunkOverlap: 200,
  grounding: "strict",
  autoTitle: true,
  maxContextChars: 12_000,
};

function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) {
    return def;
  }
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeKnowledgeSettings(raw: unknown): KnowledgeSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const chunkSize = clampInt(r.chunkSize, 300, 4000, DEFAULT_KNOWLEDGE_SETTINGS.chunkSize);
  const chunkOverlap = clampInt(
    r.chunkOverlap,
    0,
    Math.min(500, Math.floor(chunkSize / 2)),
    Math.min(DEFAULT_KNOWLEDGE_SETTINGS.chunkOverlap, Math.floor(chunkSize / 2)),
  );
  const grounding: KnowledgeGroundingMode = r.grounding === "mixed" ? "mixed" : "strict";
  const autoTitle = r.autoTitle === false ? false : true;
  const maxContextChars = clampInt(
    r.maxContextChars,
    2000,
    40_000,
    DEFAULT_KNOWLEDGE_SETTINGS.maxContextChars,
  );
  const template = typeof r.template === "string" ? r.template.slice(0, 60) : undefined;
  return { chunkSize, chunkOverlap, grounding, autoTitle, maxContextChars, template };
}

export function settingsFromTemplate(template: string): Partial<KnowledgeSettings> {
  switch (template) {
    case "faq":
      return { chunkSize: 1200, chunkOverlap: 150, grounding: "strict", maxContextChars: 10_000 };
    case "docs":
      return { chunkSize: 1800, chunkOverlap: 220, grounding: "strict", maxContextChars: 16_000 };
    case "policy":
      return { chunkSize: 2200, chunkOverlap: 260, grounding: "strict", maxContextChars: 18_000 };
    case "marketing":
      return { chunkSize: 1500, chunkOverlap: 180, grounding: "mixed", maxContextChars: 12_000 };
    default:
      return {};
  }
}

export async function resolveKnowledgeBaseSettings(
  tenantId: string,
  knowledgeBaseId: string,
): Promise<KnowledgeSettings> {
  const row = await prisma.knowledgeBase.findFirst({
    where: { id: knowledgeBaseId, tenantId, deletedAt: null },
    select: { settingsJson: true },
  });
  return normalizeKnowledgeSettings(row?.settingsJson ?? null);
}

/** Возвращает суммарную максимальную длину контекста по нескольким базам (берём максимум). */
export async function resolveMaxContextCharsForBases(
  tenantId: string,
  knowledgeBaseIds: string[],
): Promise<{ maxChars: number; grounding: KnowledgeGroundingMode }> {
  if (knowledgeBaseIds.length === 0) {
    return {
      maxChars: DEFAULT_KNOWLEDGE_SETTINGS.maxContextChars,
      grounding: DEFAULT_KNOWLEDGE_SETTINGS.grounding,
    };
  }
  const rows = await prisma.knowledgeBase.findMany({
    where: { tenantId, id: { in: knowledgeBaseIds }, deletedAt: null },
    select: { settingsJson: true },
  });
  let maxChars = 0;
  let strictAny = false;
  let mixedAny = false;
  for (const row of rows) {
    const s = normalizeKnowledgeSettings(row.settingsJson);
    maxChars = Math.max(maxChars, s.maxContextChars);
    if (s.grounding === "strict") {
      strictAny = true;
    } else {
      mixedAny = true;
    }
  }
  if (maxChars === 0) {
    maxChars = DEFAULT_KNOWLEDGE_SETTINGS.maxContextChars;
  }
  // Если хотя бы одна база строгая — общий режим "strict" (безопаснее для галлюцинаций).
  const grounding: KnowledgeGroundingMode = strictAny && !mixedAny ? "strict" : strictAny ? "strict" : "mixed";
  return { maxChars, grounding };
}
