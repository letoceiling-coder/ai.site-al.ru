import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { suggestKnowledgeCardsFromRawText } from "@/lib/knowledge-suggest-ai";
import { prisma } from "@ai/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ knowledgeBaseId: string }> };

export async function POST(request: Request, context: Ctx) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { knowledgeBaseId } = await context.params;
  const base = await prisma.knowledgeBase.findFirst({
    where: { id: knowledgeBaseId, tenantId: auth.tenantId, deletedAt: null },
  });
  if (!base) {
    return fail("База не найдена", "NOT_FOUND", 404);
  }
  const body = (await request.json().catch(() => ({}))) as { rawText?: unknown };
  const rawText = typeof body.rawText === "string" ? body.rawText.trim() : "";
  if (rawText.length < 80) {
    return fail("Вставьте не менее ~80 символов сырого текста", "VALIDATION_ERROR", 400);
  }
  if (rawText.length > 50_000) {
    return fail("Текст слишком длинный (макс. 50000)", "VALIDATION_ERROR", 400);
  }

  try {
    const cards = await suggestKnowledgeCardsFromRawText(auth.tenantId, rawText);
    return ok({ cards, notice: "Проверьте карточки и добавьте вручную — модель может ошибаться." });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка ИИ";
    return fail(msg, "SUGGEST_ERROR", 422);
  }
}
