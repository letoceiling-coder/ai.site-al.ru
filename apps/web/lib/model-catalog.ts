/**
 * Каталог профилей LLM-моделей (A8): бюджет RAG-контекста и разумная
 * дефолтная температура по выбранной модели ассистента/агента.
 *
 * Логика подбора:
 *  - модель определяется по слагу (например, "gpt-4.1-mini", "claude-3.5-sonnet",
 *    "gemini-1.5-pro", "openrouter/meta-llama/llama-3.3-70b-instruct");
 *  - `maxContextChars` — жёсткий потолок символов контекста из базы знаний
 *    под эту модель, оставляя достаточно окна под системный промпт,
 *    историю и ответ. Это НЕ окно модели — это её безопасная доля под RAG.
 *  - `defaultTemperature` — безопасный дефолт, если ни ассистент, ни агент
 *    не задали свою температуру.
 *  - `isReasoning` — признак reasoning-семейства (o1/o3/o4/GPT-5),
 *    где высокая креативность обычно не нужна и часть параметров игнорируется провайдером.
 */

export type ModelProfile = {
  /** Человекочитаемый slug — только для диагностики/логирования. */
  slug: string;
  /** Максимум символов контекста из базы знаний, попадающего в системный промпт. */
  maxContextChars: number;
  /** Дефолтная температура, если ассистент/агент не задали свою. */
  defaultTemperature: number;
  /** Reasoning‑модели (o1/o3/o4/GPT‑5*). */
  isReasoning: boolean;
};

/**
 * Нормализует имя модели для сопоставления:
 * убирает префикс провайдера OpenRouter ("openai/", "anthropic/", …), суффикс версии и regex-переключатели.
 */
function normalizeSlug(model: string): string {
  const s = model.toLowerCase().trim();
  const withoutProvider = s.includes("/") ? (s.split("/").pop() || s) : s;
  return withoutProvider;
}

const DEFAULT_PROFILE: ModelProfile = {
  slug: "default",
  maxContextChars: 12_000,
  defaultTemperature: 0.7,
  isReasoning: false,
};

/**
 * Порядок важен: сопоставляем по первому совпадающему префиксу/паттерну.
 * Точное значение `maxContextChars` — это разумная доля окна (30–40%),
 * не превышающая верхний лимит 40_000 из KnowledgeSettings.
 */
const PROFILES: Array<{ test: (slug: string) => boolean; profile: ModelProfile }> = [
  // ── OpenAI reasoning (GPT-5, o1, o3, o4) ────────────────────────────
  {
    test: (s) => /^(gpt-5|o1|o3|o4)(\b|[-_])/.test(s),
    profile: {
      slug: "openai-reasoning",
      maxContextChars: 40_000,
      defaultTemperature: 1.0, // reasoning‑модели обычно требуют дефолт 1.0
      isReasoning: true,
    },
  },

  // ── OpenAI chat: gpt-4o, gpt-4.1 (и -mini) ─────────────────────────
  {
    test: (s) => /^gpt-4o(\b|[-_])/.test(s) || /^gpt-4\.1(\b|[-_])/.test(s),
    profile: { slug: "openai-gpt4o", maxContextChars: 40_000, defaultTemperature: 0.7, isReasoning: false },
  },
  // ── OpenAI legacy gpt-4 (8k-32k окно) ──────────────────────────────
  {
    test: (s) => /^gpt-4(\b|[-_])/.test(s) && !/^gpt-4o|^gpt-4\.1/.test(s),
    profile: { slug: "openai-gpt4", maxContextChars: 12_000, defaultTemperature: 0.7, isReasoning: false },
  },
  // ── OpenAI gpt-3.5 (16k) ───────────────────────────────────────────
  {
    test: (s) => /^gpt-3\.5/.test(s),
    profile: { slug: "openai-gpt35", maxContextChars: 8_000, defaultTemperature: 0.7, isReasoning: false },
  },

  // ── Anthropic Claude 3.x / 4 ───────────────────────────────────────
  {
    test: (s) => /^claude-(?:3(?:\.5|-5)?-|sonnet-4|opus-4|3-opus|3-sonnet|3-haiku)/.test(s) || /^claude-3/.test(s),
    profile: { slug: "anthropic-claude3x", maxContextChars: 40_000, defaultTemperature: 0.7, isReasoning: false },
  },
  {
    test: (s) => /^claude-(?:3(?:\.5|-5)?-haiku|haiku)/.test(s),
    profile: { slug: "anthropic-claude-haiku", maxContextChars: 32_000, defaultTemperature: 0.7, isReasoning: false },
  },

  // ── Google Gemini 1.5 / 2.x Pro ────────────────────────────────────
  {
    test: (s) => /^gemini-(?:1\.5|2\.0|2\.5)-pro/.test(s) || /^gemini-pro/.test(s),
    profile: { slug: "gemini-pro", maxContextChars: 40_000, defaultTemperature: 0.7, isReasoning: false },
  },
  // ── Google Gemini Flash (большое окно, но быстрее/дешевле) ─────────
  {
    test: (s) => /^gemini-(?:1\.5|2\.0|2\.5)-flash/.test(s) || /^gemini-flash/.test(s),
    profile: { slug: "gemini-flash", maxContextChars: 32_000, defaultTemperature: 0.7, isReasoning: false },
  },

  // ── Llama 3.x 70B / 405B ───────────────────────────────────────────
  {
    test: (s) => /llama-3(?:\.\d+)?-(?:70b|405b)/.test(s) || /llama-3\.3/.test(s),
    profile: { slug: "llama-large", maxContextChars: 32_000, defaultTemperature: 0.7, isReasoning: false },
  },
  // ── Llama 3.x small ────────────────────────────────────────────────
  {
    test: (s) => /llama-3(?:\.\d+)?-(?:8b|instruct)/.test(s),
    profile: { slug: "llama-small", maxContextChars: 16_000, defaultTemperature: 0.7, isReasoning: false },
  },

  // ── Qwen / DeepSeek ────────────────────────────────────────────────
  {
    test: (s) => /^qwen(2\.5|3)/.test(s) || /^deepseek/.test(s),
    profile: { slug: "qwen-deepseek", maxContextChars: 32_000, defaultTemperature: 0.7, isReasoning: false },
  },
];

export function resolveModelProfile(model: string | null | undefined): ModelProfile {
  if (!model || typeof model !== "string") {
    return DEFAULT_PROFILE;
  }
  const slug = normalizeSlug(model);
  for (const entry of PROFILES) {
    if (entry.test(slug)) {
      return entry.profile;
    }
  }
  return DEFAULT_PROFILE;
}

const RAG_BUDGET_MIN = 2_000;
const RAG_BUDGET_MAX = 40_000;

/**
 * Итоговый бюджет RAG-контекста: `min(настройки баз, профиль модели, опц. ручной потолок)`.
 * Ручной `assistantRagCap` (из настроек ассистента) позволяет **снизить** бюджет
 * (экономия токенов), не повышая его выше `min(база, модель)`.
 */
export function computeEffectiveRagMaxChars(
  knowledgeBasesMaxChars: number,
  modelProfile: ModelProfile,
  assistantRagCap: number | null | undefined,
): number {
  const ceiling = Math.min(knowledgeBasesMaxChars, modelProfile.maxContextChars);
  if (assistantRagCap == null || !Number.isFinite(assistantRagCap)) {
    return ceiling;
  }
  const clamped = Math.min(RAG_BUDGET_MAX, Math.max(RAG_BUDGET_MIN, Math.round(assistantRagCap)));
  return Math.min(ceiling, clamped);
}
