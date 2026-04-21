import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { ensureAssistantForAgent } from "@/lib/agent-chat";

type Context = {
  params: Promise<{ agentId: string }>;
};

export async function POST(_: Request, context: Context) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const { agentId } = await context.params;
  const linked = await ensureAssistantForAgent(auth.tenantId, auth.userId, agentId);
  if (!linked) {
    return fail("Агент не найден", "NOT_FOUND", 404);
  }

  const dialog = await prisma.dialog.create({
    data: {
      tenantId: auth.tenantId,
      userId: auth.userId,
      assistantId: linked.assistant.id,
      status: "OPEN",
      metadata: {
        mode: "agent_test_chat",
        agentId: linked.agent.id,
        assistantId: linked.assistant.id,
      },
    },
  });

  return ok({
    dialog,
    agent: {
      id: linked.agent.id,
      name: linked.agent.name,
      model: linked.agent.model,
      provider: linked.agent.providerIntegration.provider,
    },
    assistant: {
      id: linked.assistant.id,
      name: linked.assistant.name,
    },
  });
}
