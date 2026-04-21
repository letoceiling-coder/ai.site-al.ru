/** Инструкции к модели: ответы только по фактам из базы, без домыслов. */

export type GroundingMode = "strict" | "mixed";

export function knowledgeContextBlock(kbText: string): string {
  const trimmed = kbText.trim();
  if (!trimmed) {
    return "";
  }
  return `### Материалы из подключённых баз знаний\n${trimmed}`;
}

export function knowledgeGroundingSystemRules(mode: GroundingMode = "strict"): string {
  if (mode === "mixed") {
    return [
      "Сначала используй материалы из базы знаний — они считаются основным источником фактов.",
      "Если в материалах есть ответ — отвечай по ним и указывай это явно.",
      "Если материалов недостаточно — можешь дополнить ответ общими знаниями, но чётко разграничивай «из базы знаний» и «из общих сведений».",
      "Не придумывай факты, цифры, даты, названия продуктов, законы и формулировки.",
    ].join("\n");
  }
  return [
    "Ты отвечаешь строго по приведённым ниже материалам из базы знаний, если они есть.",
    "Не придумывай факты, цифры, даты, названия продуктов, законы и формулировки, которых нет в материалах.",
    "Если в материалах нет ответа или информации недостаточно — прямо скажи, что в базе знаний этого нет; не заполняй пробелы догадками.",
    "Можно переформулировать и структурировать текст из материалов, сохраняя смысл; при спорных формулировках цитируй дословно короткие фрагменты из материалов.",
    "Если вопрос не относится к материалам, ответь кратко и по делу, не выдавая вымышленные «факты».",
  ].join("\n");
}

export function buildGroundedSystemPrompt(
  baseSystem: string,
  kbText: string,
  mode: GroundingMode = "strict",
): string {
  const base = baseSystem.trim() || "You are a helpful assistant.";
  const block = knowledgeContextBlock(kbText);
  if (!block) {
    return base;
  }
  return `${base}\n\n${knowledgeGroundingSystemRules(mode)}\n\n${block}`;
}
