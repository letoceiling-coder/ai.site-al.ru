export type EmbeddingBatchResult = {
  vectors: number[][];
  model: string;
};

/**
 * OpenAI-совместимый POST /embeddings (OpenAI или OpenRouter).
 */
export async function fetchEmbeddingsBatch(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  inputs: string[];
}): Promise<EmbeddingBatchResult> {
  const inputs = input.inputs.map((t) => (t.length > 8000 ? `${t.slice(0, 8000)}…` : t));
  const url = `${input.baseUrl.replace(/\/$/, "")}/embeddings`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      input: inputs,
    }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Embeddings HTTP ${response.status}: ${errText.slice(0, 400)}`);
  }
  const json = (await response.json()) as {
    data?: Array<{ embedding?: number[]; index?: number }>;
    model?: string;
  };
  const rows = Array.isArray(json.data) ? json.data : [];
  const sorted = [...rows].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const vectors = sorted.map((r) => r.embedding ?? []);
  if (vectors.length !== inputs.length || vectors.some((v) => v.length < 8)) {
    throw new Error("Embeddings: некорректный ответ API");
  }
  return { vectors, model: json.model ?? input.model };
}

export function vectorLiteralForSql(values: number[]): string {
  if (!values.every((n) => Number.isFinite(n))) {
    throw new Error("vectorLiteralForSql: non-finite");
  }
  return `[${values.join(",")}]`;
}
