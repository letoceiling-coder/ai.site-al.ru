import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";

export async function GET() {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const tenantId = auth.tenantId;
  const [integrations, agents, assistants, knowledgeBases, dialogs, apiKeys, leads] =
    await Promise.all([
      prisma.providerIntegration.count({ where: { tenantId } }),
      prisma.agent.count({ where: { tenantId } }),
      prisma.assistant.count({ where: { tenantId } }),
      prisma.knowledgeBase.count({ where: { tenantId } }),
      prisma.dialog.count({ where: { tenantId } }),
      prisma.apiKey.count({ where: { tenantId } }),
      prisma.lead.count({ where: { tenantId } }),
    ]);

  return ok({
    integrations,
    agents,
    assistants,
    knowledgeBases,
    dialogs,
    apiKeys,
    leads,
  });
}
