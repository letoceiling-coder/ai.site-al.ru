import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";

type Context = { params: Promise<{ assistantId: string }> };

export async function POST(request: Request, context: Context) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { assistantId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { version?: unknown };
  const targetVersion = typeof body.version === "number" ? body.version : Number(body.version);
  if (!Number.isFinite(targetVersion) || targetVersion < 1) {
    return fail("Укажите номер версии", "VALIDATION_ERROR", 400);
  }

  const assistant = await prisma.assistant.findFirst({
    where: { id: assistantId, tenantId: auth.tenantId, deletedAt: null },
    select: { id: true, version: true, systemPrompt: true, settingsJson: true },
  });
  if (!assistant) {
    return fail("Ассистент не найден", "NOT_FOUND", 404);
  }

  const base =
    assistant.settingsJson && typeof assistant.settingsJson === "object" && !Array.isArray(assistant.settingsJson)
      ? ({ ...(assistant.settingsJson as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const history = Array.isArray(base.promptHistory) ? [...(base.promptHistory as unknown[])] : [];
  const entry = history.find((row) => {
    if (!row || typeof row !== "object") {
      return false;
    }
    const r = row as Record<string, unknown>;
    return typeof r.prompt === "string" && r.version === targetVersion;
  }) as { version: number; prompt: string } | undefined;
  if (!entry) {
    return fail("Указанная версия не найдена в истории", "NOT_FOUND", 404);
  }
  if (entry.prompt === assistant.systemPrompt) {
    return fail("Эта версия уже активна", "VALIDATION_ERROR", 400);
  }

  history.unshift({
    version: assistant.version,
    prompt: assistant.systemPrompt,
    createdAt: new Date().toISOString(),
    author: auth.userId,
    reason: "restore_previous",
  });
  base.promptHistory = history.slice(0, 20);

  const updated = await prisma.assistant.update({
    where: { id: assistant.id },
    data: {
      systemPrompt: entry.prompt,
      version: { increment: 1 },
      settingsJson: base,
    },
    select: { id: true, version: true, systemPrompt: true, updatedAt: true, settingsJson: true },
  });

  return ok({
    current: {
      version: updated.version,
      prompt: updated.systemPrompt,
      createdAt: updated.updatedAt.toISOString(),
    },
  });
}