import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { ASSISTANT_TEMPLATES, type AssistantTemplate } from "@/lib/assistant-settings";
import {
  generateAssistantSystemPrompt,
  prepareGeneratorPersona,
  prepareGeneratorTools,
} from "@/lib/assistant-prompt-ai";

type Payload = {
  description?: unknown;
  template?: unknown;
  persona?: unknown;
  tools?: unknown;
};

export async function POST(request: Request) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const body = (await request.json().catch(() => ({}))) as Payload;
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) {
    return fail("Укажите описание роли ассистента", "VALIDATION_ERROR", 400);
  }
  if (description.length > 4000) {
    return fail("Описание слишком длинное (макс. 4000 символов)", "VALIDATION_ERROR", 400);
  }

  let template: AssistantTemplate | null = null;
  if (typeof body.template === "string" && body.template.trim()) {
    const candidate = body.template.trim();
    if (ASSISTANT_TEMPLATES.some((t) => t.id === candidate)) {
      template = candidate as AssistantTemplate;
    }
  }

  const persona = prepareGeneratorPersona(body.persona) ?? undefined;
  const tools = prepareGeneratorTools(body.tools) ?? undefined;

  try {
    const systemPrompt = await generateAssistantSystemPrompt({
      tenantId: auth.tenantId,
      roleDescription: description,
      template,
      persona,
      tools,
    });
    return ok({ systemPrompt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка генерации";
    return fail(message, "AI_GENERATE_ERROR", 500);
  }
}
