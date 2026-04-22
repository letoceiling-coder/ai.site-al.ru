/** Инструкции к модели: ответы только по фактам из базы, без домыслов. */

export type GroundingMode = "strict" | "mixed";

export function knowledgeContextBlock(kbText: string): string {
  const trimmed = kbText.trim();
  if (!trimmed) {
    return "";
  }
  return `### Материалы из подключённых баз знаний\n${trimmed}`;
}

export function knowledgeGroundingSystemRules(
  mode: GroundingMode = "strict",
  hasCitations: boolean = false,
): string {
  const citationRules = hasCitations
    ? [
        "Каждому фрагменту материалов присвоен маркер вида ⟨#1⟩, ⟨#2⟩ и т. д.",
        "Когда используешь факт/цифру/формулировку из фрагмента — ставь ссылку в формате [#N] сразу после соответствующего утверждения.",
        "Разрешено комбинировать несколько ссылок: [#1][#3]. Один факт — одна-две ссылки.",
        "Никогда не придумывай маркеры, которых нет в материалах. Если маркеров нет или не нашёл подходящих — не ставь ссылки.",
        "В конце ответа не добавляй блок «Источники» — он формируется автоматически из твоих [#N].",
      ].join("\n")
    : "";

  if (mode === "mixed") {
    const base = [
      "Сначала используй материалы из базы знаний — они считаются основным источником фактов.",
      "Если в материалах есть ответ — отвечай по ним и указывай это явно.",
      "Если материалов недостаточно — можешь дополнить ответ общими знаниями, но чётко разграничивай «из базы знаний» и «из общих сведений».",
      "Не придумывай факты, цифры, даты, названия продуктов, законы и формулировки.",
    ].join("\n");
    return citationRules ? `${base}\n\n${citationRules}` : base;
  }

  const base = [
    "Ты отвечаешь строго по приведённым ниже материалам из базы знаний, если они есть.",
    "Не придумывай факты, цифры, даты, названия продуктов, законы и формулировки, которых нет в материалах.",
    "Если в материалах нет ответа или информации недостаточно — прямо скажи, что в базе знаний этого нет; не заполняй пробелы догадками.",
    "Можно переформулировать и структурировать текст из материалов, сохраняя смысл; при спорных формулировках цитируй дословно короткие фрагменты из материалов.",
    "Если вопрос не относится к материалам, ответь кратко и по делу, не выдавая вымышленные «факты».",
  ].join("\n");
  return citationRules ? `${base}\n\n${citationRules}` : base;
}

export function buildGroundedSystemPrompt(
  baseSystem: string,
  kbText: string,
  mode: GroundingMode = "strict",
  hasCitations: boolean = false,
): string {
  const base = baseSystem.trim() || "You are a helpful assistant.";
  const block = knowledgeContextBlock(kbText);
  if (!block) {
    return base;
  }
  return `${base}\n\n${knowledgeGroundingSystemRules(mode, hasCitations)}\n\n${block}`;
}
