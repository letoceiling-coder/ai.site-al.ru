import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";

type Context = { params: Promise<{ assistantId: string }> };

type HistoryEntry = {
  version: number;
  prompt: string;
  createdAt: string;
  author?: string;
};

function extractHistory(settingsJson: unknown): HistoryEntry[] {
  if (!settingsJson || typeof settingsJson !== "object" || Array.isArray(settingsJson)) {
    return [];
  }
  const v = settingsJson as Record<string, unknown>;
  if (!Array.isArray(v.promptHistory)) {
    return [];
  }
  const out: HistoryEntry[] = [];
  for (const item of v.promptHistory) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const row = item as Record<string, unknown>;
    if (typeof row.prompt !== "string" || typeof row.version !== "number") {
      continue;
    }
    out.push({
      version: row.version,
      prompt: row.prompt,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
      author: typeof row.author === "string" ? row.author : undefined,
    });
  }
  return out;
}

export async function GET(_request: Request, context: Context) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { assistantId } = await context.params;
  const assistant = await prisma.assistant.findFirst({
    where: { id: assistantId, tenantId: auth.tenantId, deletedAt: null },
    select: { id: true, version: true, systemPrompt: true, settingsJson: true, updatedAt: true },
  });
  if (!assistant) {
    return fail("Ассистент не найден", "NOT_FOUND", 404);
  }
  return ok({
    current: {
      version: assistant.version,
      prompt: assistant.systemPrompt,
      createdAt: assistant.updatedAt.toISOString(),
    },
    history: extractHistory(assistant.settingsJson),
  });
}