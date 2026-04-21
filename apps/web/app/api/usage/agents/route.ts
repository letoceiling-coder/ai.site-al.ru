import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";

type SortField = "createdAt" | "tokensInput" | "tokensOutput" | "totalTokens" | "totalCostUsd";
type SortOrder = "asc" | "desc";

type EnrichedRow = {
  id: string;
  createdAt: string;
  provider: string;
  model: string;
  sourceType: string;
  sourceId: string | null;
  tokensInput: number;
  tokensOutput: number;
  totalTokens: number;
  totalCostUsd: number;
  integrationId: string | null;
  integrationName: string | null;
  agentId: string | null;
  agentName: string | null;
  assistantId: string | null;
  assistantName: string | null;
  dialogId: string | null;
  routeMode: "openrouter" | "direct";
};

type UsageEventRow = {
  id: string;
  createdAt: Date;
  provider: string;
  model: string;
  sourceType: string;
  sourceId: string | null;
  tokensInput: number;
  tokensOutput: number;
  totalCostUsd: unknown;
};

type IntegrationRow = {
  id: string;
  provider: string;
  displayName: string;
};

type AssistantRow = {
  id: string;
  name: string;
  agentId: string | null;
  providerIntegrationId: string;
};

type AgentRow = {
  id: string;
  name: string;
  providerIntegrationId: string;
};

type DialogRow = {
  id: string;
  assistantId: string;
};

type MessageRow = {
  id: string;
  dialogId: string;
};

function asNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }
  if (value && typeof value === "object" && "toNumber" in (value as Record<string, unknown>)) {
    return (value as { toNumber: () => number }).toNumber();
  }
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function parseDate(value: string | null) {
  if (!value) {
    return null;
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return null;
  }
  return dt;
}

function parseSortField(value: string | null): SortField {
  switch (value) {
    case "tokensInput":
    case "tokensOutput":
    case "totalTokens":
    case "totalCostUsd":
      return value;
    default:
      return "createdAt";
  }
}

function parseSortOrder(value: string | null): SortOrder {
  return value === "asc" ? "asc" : "desc";
}

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1) {
    return fallback;
  }
  return num;
}

function normalizeSourceType(sourceType: string) {
  return sourceType.trim().toLowerCase();
}

export async function GET(request: Request) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const url = new URL(request.url);
  const provider = url.searchParams.get("provider")?.trim() || "";
  const model = url.searchParams.get("model")?.trim() || "";
  const integrationId = url.searchParams.get("integrationId")?.trim() || "";
  const agentIdFilter = url.searchParams.get("agentId")?.trim() || "";
  const assistantIdFilter = url.searchParams.get("assistantId")?.trim() || "";
  const routeModeFilter = url.searchParams.get("routeMode")?.trim() || "";
  const dateFrom = parseDate(url.searchParams.get("dateFrom"));
  const dateTo = parseDate(url.searchParams.get("dateTo"));
  const sortField = parseSortField(url.searchParams.get("sortField"));
  const sortOrder = parseSortOrder(url.searchParams.get("sortOrder"));
  const page = parsePositiveInt(url.searchParams.get("page"), 1);
  const pageSize = Math.min(100, parsePositiveInt(url.searchParams.get("pageSize"), 20));

  const where: Record<string, unknown> = {
    tenantId: auth.tenantId,
  };
  if (provider) {
    where.provider = provider;
  }
  if (model) {
    where.model = model;
  }
  if (dateFrom || dateTo) {
    where.createdAt = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {}),
    };
  }

  const [eventsRaw, integrationsRaw, assistantsRaw, agentsRaw, dialogsRaw, messagesRaw] = await Promise.all([
    prisma.usageEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.providerIntegration.findMany({
      where: { tenantId: auth.tenantId },
      select: { id: true, provider: true, displayName: true },
    }),
    prisma.assistant.findMany({
      where: { tenantId: auth.tenantId, deletedAt: null },
      select: { id: true, name: true, agentId: true, providerIntegrationId: true },
    }),
    prisma.agent.findMany({
      where: { tenantId: auth.tenantId, deletedAt: null },
      select: { id: true, name: true, providerIntegrationId: true },
    }),
    prisma.dialog.findMany({
      where: { tenantId: auth.tenantId },
      select: { id: true, assistantId: true },
    }),
    prisma.message.findMany({
      where: { tenantId: auth.tenantId },
      select: { id: true, dialogId: true },
      take: 5000,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const events = eventsRaw as UsageEventRow[];
  const integrations = integrationsRaw as IntegrationRow[];
  const assistants = assistantsRaw as AssistantRow[];
  const agents = agentsRaw as AgentRow[];
  const dialogs = dialogsRaw as DialogRow[];
  const messages = messagesRaw as MessageRow[];

  const integrationById = new Map(integrations.map((item) => [item.id, item]));
  const firstIntegrationByProvider = new Map<string, { id: string; displayName: string }>();
  for (const integration of integrations) {
    if (!firstIntegrationByProvider.has(integration.provider)) {
      firstIntegrationByProvider.set(integration.provider, { id: integration.id, displayName: integration.displayName });
    }
  }

  const assistantsById = new Map(assistants.map((item) => [item.id, item]));
  const agentsById = new Map(agents.map((item) => [item.id, item]));
  const dialogAssistantById = new Map(dialogs.map((item) => [item.id, item.assistantId]));
  const messageDialogById = new Map(messages.map((item) => [item.id, item.dialogId]));

  const rows: EnrichedRow[] = events.map((event) => {
    const sourceType = normalizeSourceType(event.sourceType);
    const sourceId = event.sourceId ?? null;

    let assistantId: string | null = null;
    let agentId: string | null = null;

    if (sourceId) {
      if (sourceType.includes("assistant")) {
        assistantId = sourceId;
      } else if (sourceType.includes("agent")) {
        agentId = sourceId;
      } else if (sourceType.includes("dialog")) {
        assistantId = dialogAssistantById.get(sourceId) ?? null;
      } else if (sourceType.includes("message")) {
        const dialogId = messageDialogById.get(sourceId) ?? null;
        assistantId = dialogId ? (dialogAssistantById.get(dialogId) ?? null) : null;
      }
    }

    const assistant = assistantId ? assistantsById.get(assistantId) : null;
    if (assistant && !agentId) {
      agentId = assistant.agentId ?? null;
    }
    const agent = agentId ? agentsById.get(agentId) : null;

    let integrationIdResolved = agent?.providerIntegrationId ?? assistant?.providerIntegrationId ?? null;
    let integrationNameResolved = integrationIdResolved
      ? (integrationById.get(integrationIdResolved)?.displayName ?? null)
      : null;
    if (!integrationIdResolved) {
      const byProvider = firstIntegrationByProvider.get(event.provider);
      if (byProvider) {
        integrationIdResolved = byProvider.id;
        integrationNameResolved = byProvider.displayName;
      }
    }

    const tokensInput = event.tokensInput;
    const tokensOutput = event.tokensOutput;
    const totalCostUsd = asNumber(event.totalCostUsd);

    return {
      id: event.id,
      createdAt: event.createdAt.toISOString(),
      provider: event.provider,
      model: event.model,
      sourceType: event.sourceType,
      sourceId,
      tokensInput,
      tokensOutput,
      totalTokens: tokensInput + tokensOutput,
      totalCostUsd,
      integrationId: integrationIdResolved,
      integrationName: integrationNameResolved,
      agentId: agent?.id ?? agentId ?? null,
      agentName: agent?.name ?? null,
      assistantId: assistant?.id ?? assistantId ?? null,
      assistantName: assistant?.name ?? null,
      dialogId: sourceType.includes("dialog") ? sourceId : null,
      routeMode: sourceType.includes("openrouter") ? "openrouter" : "direct",
    };
  });

  const filtered = rows.filter((row) => {
    if (integrationId && row.integrationId !== integrationId) {
      return false;
    }
    if (agentIdFilter && row.agentId !== agentIdFilter) {
      return false;
    }
    if (assistantIdFilter && row.assistantId !== assistantIdFilter) {
      return false;
    }
    if (routeModeFilter && row.routeMode !== routeModeFilter) {
      return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortOrder === "asc" ? 1 : -1;
    switch (sortField) {
      case "tokensInput":
        return (a.tokensInput - b.tokensInput) * dir;
      case "tokensOutput":
        return (a.tokensOutput - b.tokensOutput) * dir;
      case "totalTokens":
        return (a.totalTokens - b.totalTokens) * dir;
      case "totalCostUsd":
        return (a.totalCostUsd - b.totalCostUsd) * dir;
      default:
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
    }
  });

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const paged = sorted.slice(start, start + pageSize);

  const summary = sorted.reduce(
    (acc, row) => {
      acc.events += 1;
      acc.tokensInput += row.tokensInput;
      acc.tokensOutput += row.tokensOutput;
      acc.totalTokens += row.totalTokens;
      acc.totalCostUsd += row.totalCostUsd;
      return acc;
    },
    { events: 0, tokensInput: 0, tokensOutput: 0, totalTokens: 0, totalCostUsd: 0, openrouterEvents: 0, directEvents: 0 },
  );
  for (const row of sorted) {
    if (row.routeMode === "openrouter") {
      summary.openrouterEvents += 1;
    } else {
      summary.directEvents += 1;
    }
  }

  const byAgentMap = new Map<
    string,
    { agentId: string; agentName: string; events: number; tokensInput: number; tokensOutput: number; totalCostUsd: number }
  >();
  const byAssistantMap = new Map<
    string,
    {
      assistantId: string;
      assistantName: string;
      agentId: string | null;
      agentName: string | null;
      events: number;
      tokensInput: number;
      tokensOutput: number;
      totalCostUsd: number;
    }
  >();

  for (const row of sorted) {
    if (row.agentId) {
      const key = row.agentId;
      const current = byAgentMap.get(key) ?? {
        agentId: key,
        agentName: row.agentName ?? "Без названия",
        events: 0,
        tokensInput: 0,
        tokensOutput: 0,
        totalCostUsd: 0,
      };
      current.events += 1;
      current.tokensInput += row.tokensInput;
      current.tokensOutput += row.tokensOutput;
      current.totalCostUsd += row.totalCostUsd;
      byAgentMap.set(key, current);
    }
    if (row.assistantId) {
      const key = row.assistantId;
      const current = byAssistantMap.get(key) ?? {
        assistantId: key,
        assistantName: row.assistantName ?? "Без названия",
        agentId: row.agentId ?? null,
        agentName: row.agentName ?? null,
        events: 0,
        tokensInput: 0,
        tokensOutput: 0,
        totalCostUsd: 0,
      };
      current.events += 1;
      current.tokensInput += row.tokensInput;
      current.tokensOutput += row.tokensOutput;
      current.totalCostUsd += row.totalCostUsd;
      byAssistantMap.set(key, current);
    }
  }

  const filterOptions = {
    providers: Array.from(new Set(rows.map((row) => row.provider))).sort((a, b) => a.localeCompare(b)),
    models: Array.from(new Set(rows.map((row) => row.model))).sort((a, b) => a.localeCompare(b)),
    integrations: Array.from(
      new Map(
        rows
          .filter((row) => row.integrationId && row.integrationName)
          .map((row) => [row.integrationId as string, { id: row.integrationId as string, name: row.integrationName as string }]),
      ).values(),
    ),
    agents: Array.from(
      new Map(
        rows.filter((row) => row.agentId && row.agentName).map((row) => [row.agentId as string, { id: row.agentId as string, name: row.agentName as string }]),
      ).values(),
    ),
    assistants: Array.from(
      new Map(
        rows
          .filter((row) => row.assistantId && row.assistantName)
          .map((row) => [row.assistantId as string, { id: row.assistantId as string, name: row.assistantName as string }]),
      ).values(),
    ),
    routeModes: ["openrouter", "direct"],
  };

  return ok({
    summary,
    rows: paged,
    pagination: {
      page: currentPage,
      pageSize,
      total,
      totalPages,
    },
    groups: {
      byAgent: Array.from(byAgentMap.values()).sort((a, b) => b.totalCostUsd - a.totalCostUsd),
      byAssistant: Array.from(byAssistantMap.values()).sort((a, b) => b.totalCostUsd - a.totalCostUsd),
    },
    filters: filterOptions,
  });
}
