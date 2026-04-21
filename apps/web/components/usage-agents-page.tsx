"use client";

import { useEffect, useMemo, useState } from "react";

type UsageRow = {
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
};

type UsageSummary = {
  events: number;
  tokensInput: number;
  tokensOutput: number;
  totalTokens: number;
  totalCostUsd: number;
};

type UsageFilterOptions = {
  providers: string[];
  models: string[];
  integrations: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string }>;
  assistants: Array<{ id: string; name: string }>;
};

type AgentGroup = {
  agentId: string;
  agentName: string;
  events: number;
  tokensInput: number;
  tokensOutput: number;
  totalCostUsd: number;
};

type AssistantGroup = {
  assistantId: string;
  assistantName: string;
  agentId: string | null;
  agentName: string | null;
  events: number;
  tokensInput: number;
  tokensOutput: number;
  totalCostUsd: number;
};

type UsageResponse = {
  ok: boolean;
  data?: {
    summary: UsageSummary;
    rows: UsageRow[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
    groups: {
      byAgent: AgentGroup[];
      byAssistant: AssistantGroup[];
    };
    filters: UsageFilterOptions;
  };
  error?: { message?: string };
};

type FiltersState = {
  provider: string;
  model: string;
  integrationId: string;
  agentId: string;
  assistantId: string;
  dateFrom: string;
  dateTo: string;
  sortField: "createdAt" | "tokensInput" | "tokensOutput" | "totalTokens" | "totalCostUsd";
  sortOrder: "asc" | "desc";
  page: number;
  pageSize: number;
};

const defaultFilters: FiltersState = {
  provider: "",
  model: "",
  integrationId: "",
  agentId: "",
  assistantId: "",
  dateFrom: "",
  dateTo: "",
  sortField: "createdAt",
  sortOrder: "desc",
  page: 1,
  pageSize: 20,
};

function formatNum(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value);
}

function formatDate(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return value;
  }
  return dt.toLocaleString("ru-RU");
}

export function UsageAgentsPageClient() {
  const [filters, setFilters] = useState<FiltersState>(defaultFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<UsageSummary>({
    events: 0,
    tokensInput: 0,
    tokensOutput: 0,
    totalTokens: 0,
    totalCostUsd: 0,
  });
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [groups, setGroups] = useState<{
    byAgent: AgentGroup[];
    byAssistant: AssistantGroup[];
  }>({ byAgent: [], byAssistant: [] });
  const [options, setOptions] = useState<UsageFilterOptions>({
    providers: [],
    models: [],
    integrations: [],
    agents: [],
    assistants: [],
  });

  const queryString = useMemo(() => {
    const query = new URLSearchParams();
    if (filters.provider) query.set("provider", filters.provider);
    if (filters.model) query.set("model", filters.model);
    if (filters.integrationId) query.set("integrationId", filters.integrationId);
    if (filters.agentId) query.set("agentId", filters.agentId);
    if (filters.assistantId) query.set("assistantId", filters.assistantId);
    if (filters.dateFrom) query.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) query.set("dateTo", filters.dateTo);
    query.set("sortField", filters.sortField);
    query.set("sortOrder", filters.sortOrder);
    query.set("page", String(filters.page));
    query.set("pageSize", String(filters.pageSize));
    return query.toString();
  }, [filters]);

  async function load() {
    setLoading(true);
    const response = await fetch(`/api/usage/agents?${queryString}`);
    const body = (await response.json()) as UsageResponse;
    if (!response.ok || !body.ok || !body.data) {
      setError(body.error?.message ?? "Не удалось загрузить Usage статистику");
      setLoading(false);
      return;
    }
    setSummary(body.data.summary);
    setRows(body.data.rows);
    setPagination(body.data.pagination);
    setGroups(body.data.groups);
    setOptions(body.data.filters);
    setError(null);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  function applyPatch(patch: Partial<FiltersState>) {
    setFilters((prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }));
  }

  return (
    <section className="card">
      <h1 style={{ marginBottom: 6 }}>Usage: Агенты и ассистенты</h1>
      <p style={{ marginTop: 0, color: "#6b7280" }}>
        Полная статистика расхода токенов и стоимости по моделям, интеграциям, агентам и ассистентам.
      </p>
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

      <div className="usage-summary-grid">
        <div className="usage-summary-card">
          <small>События</small>
          <strong>{formatNum(summary.events)}</strong>
        </div>
        <div className="usage-summary-card">
          <small>Input tokens</small>
          <strong>{formatNum(summary.tokensInput)}</strong>
        </div>
        <div className="usage-summary-card">
          <small>Output tokens</small>
          <strong>{formatNum(summary.tokensOutput)}</strong>
        </div>
        <div className="usage-summary-card">
          <small>Всего tokens</small>
          <strong>{formatNum(summary.totalTokens)}</strong>
        </div>
        <div className="usage-summary-card">
          <small>Стоимость, USD</small>
          <strong>{formatMoney(summary.totalCostUsd)}</strong>
        </div>
      </div>

      <div className="usage-filters">
        <select value={filters.provider} onChange={(event) => applyPatch({ provider: event.target.value })}>
          <option value="">Все провайдеры</option>
          {options.providers.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select value={filters.integrationId} onChange={(event) => applyPatch({ integrationId: event.target.value })}>
          <option value="">Все интеграции</option>
          {options.integrations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select value={filters.model} onChange={(event) => applyPatch({ model: event.target.value })}>
          <option value="">Все модели</option>
          {options.models.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select value={filters.agentId} onChange={(event) => applyPatch({ agentId: event.target.value })}>
          <option value="">Все агенты</option>
          {options.agents.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select value={filters.assistantId} onChange={(event) => applyPatch({ assistantId: event.target.value })}>
          <option value="">Все ассистенты</option>
          {options.assistants.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <input type="date" value={filters.dateFrom} onChange={(event) => applyPatch({ dateFrom: event.target.value })} />
        <input type="date" value={filters.dateTo} onChange={(event) => applyPatch({ dateTo: event.target.value })} />
        <select
          value={filters.sortField}
          onChange={(event) => applyPatch({ sortField: event.target.value as FiltersState["sortField"] })}
        >
          <option value="createdAt">Сортировка: Дата</option>
          <option value="totalCostUsd">Сортировка: Стоимость</option>
          <option value="totalTokens">Сортировка: Всего токенов</option>
          <option value="tokensInput">Сортировка: Input tokens</option>
          <option value="tokensOutput">Сортировка: Output tokens</option>
        </select>
        <select
          value={filters.sortOrder}
          onChange={(event) => applyPatch({ sortOrder: event.target.value as FiltersState["sortOrder"] })}
        >
          <option value="desc">По убыванию</option>
          <option value="asc">По возрастанию</option>
        </select>
        <select value={String(filters.pageSize)} onChange={(event) => applyPatch({ pageSize: Number(event.target.value) })}>
          <option value="10">10 строк</option>
          <option value="20">20 строк</option>
          <option value="50">50 строк</option>
          <option value="100">100 строк</option>
        </select>
      </div>

      <div className="usage-table-wrap">
        {loading ? (
          <p>Загрузка...</p>
        ) : rows.length === 0 ? (
          <p>Нет данных по выбранным фильтрам.</p>
        ) : (
          <table className="usage-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Интеграция / Провайдер</th>
                <th>Модель</th>
                <th>Агент</th>
                <th>Ассистент</th>
                <th>Источник</th>
                <th>Input</th>
                <th>Output</th>
                <th>Total</th>
                <th>USD</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.createdAt)}</td>
                  <td>
                    {row.integrationName || "—"}
                    <small>{row.provider}</small>
                  </td>
                  <td>{row.model}</td>
                  <td>{row.agentName || "—"}</td>
                  <td>{row.assistantName || "—"}</td>
                  <td>
                    {row.sourceType}
                    {row.sourceId ? <small>{row.sourceId}</small> : null}
                  </td>
                  <td>{formatNum(row.tokensInput)}</td>
                  <td>{formatNum(row.tokensOutput)}</td>
                  <td>{formatNum(row.totalTokens)}</td>
                  <td>{formatMoney(row.totalCostUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="usage-pagination">
        <button
          type="button"
          disabled={pagination.page <= 1}
          onClick={() => applyPatch({ page: Math.max(1, pagination.page - 1) })}
        >
          Назад
        </button>
        <span>
          Страница {pagination.page} / {pagination.totalPages} (всего: {pagination.total})
        </span>
        <button
          type="button"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => applyPatch({ page: Math.min(pagination.totalPages, pagination.page + 1) })}
        >
          Вперед
        </button>
      </div>

      <div className="usage-groups">
        <div className="usage-group-card">
          <h3>Трафик по агентам</h3>
          {groups.byAgent.length === 0 ? (
            <p>Нет данных</p>
          ) : (
            <ul>
              {groups.byAgent.slice(0, 10).map((item) => (
                <li key={item.agentId}>
                  <span>{item.agentName}</span>
                  <span>{formatNum(item.tokensInput + item.tokensOutput)} токенов</span>
                  <span>${formatMoney(item.totalCostUsd)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="usage-group-card">
          <h3>Трафик по ассистентам</h3>
          {groups.byAssistant.length === 0 ? (
            <p>Нет данных</p>
          ) : (
            <ul>
              {groups.byAssistant.slice(0, 10).map((item) => (
                <li key={item.assistantId}>
                  <span>{item.assistantName}</span>
                  <span>{item.agentName ? `Агент: ${item.agentName}` : "Без агента"}</span>
                  <span>{formatNum(item.tokensInput + item.tokensOutput)} токенов</span>
                  <span>${formatMoney(item.totalCostUsd)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
