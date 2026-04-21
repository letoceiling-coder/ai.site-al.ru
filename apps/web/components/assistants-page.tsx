"use client";

import { useEffect, useMemo, useState } from "react";
import { AssistantTestChatPanel } from "@/components/assistant-test-chat-panel";

type IntegrationOption = { id: string; provider: string; displayName: string; status: string };
type AgentOption = { id: string; name: string; model: string };
type KnowledgeBaseOption = { id: string; name: string };

type AssistantRow = {
  id: string;
  name: string;
  systemPrompt: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  version: number;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
  settingsJson: Record<string, unknown> | null;
  providerIntegration: { id: string; provider: string; displayName: string; status: string };
  agent: { id: string; name: string; model: string; status: string } | null;
  knowledgeLinks: { knowledgeBaseId: string }[];
};

type ApiResponse = {
  ok: boolean;
  data?: {
    assistants?: AssistantRow[];
    integrations?: IntegrationOption[];
    modelOptions?: Record<string, string[]>;
    agents?: AgentOption[];
    knowledgeBases?: KnowledgeBaseOption[];
  };
  error?: { message?: string };
};

type DraftStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

const emptyDraft = {
  name: "",
  systemPrompt: "",
  providerIntegrationId: "",
  agentId: "",
  model: "",
  status: "ACTIVE" as DraftStatus,
  knowledgeBaseIds: [] as string[],
};

function asLocalDate(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return value;
  }
  return dt.toLocaleString("ru-RU");
}

function statusLabel(s: AssistantRow["status"]) {
  if (s === "ACTIVE") {
    return "Активный";
  }
  if (s === "DRAFT") {
    return "Черновик";
  }
  return "Архив";
}

function integrationLabel(assistant: AssistantRow) {
  if (assistant.settingsJson && assistant.settingsJson.useOpenRouter === true) {
    return "OpenRouter";
  }
  return assistant.providerIntegration.displayName;
}

export function AssistantsPageClient() {
  const [items, setItems] = useState<AssistantRow[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationOption[]>([]);
  const [modelOptions, setModelOptions] = useState<Record<string, string[]>>({});
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseOption[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<"manage" | "test">("manage");
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);

  const selectedIntegration = useMemo(
    () => integrations.find((i) => i.id === draft.providerIntegrationId) ?? null,
    [integrations, draft.providerIntegrationId],
  );
  const selectedModels = useMemo(() => {
    const provider = selectedIntegration?.provider;
    if (!provider) {
      return [];
    }
    return [...(modelOptions[provider] ?? [])].sort((a, b) => a.localeCompare(b));
  }, [modelOptions, selectedIntegration]);

  async function load() {
    setLoading(true);
    const response = await fetch("/api/assistants");
    const body = (await response.json()) as ApiResponse;
    if (!response.ok || !body.ok || !body.data) {
      setError(body.error?.message ?? "Не удалось загрузить ассистентов");
      setLoading(false);
      return;
    }
    setItems((body.data.assistants ?? []) as AssistantRow[]);
    setIntegrations(body.data.integrations ?? []);
    setModelOptions(body.data.modelOptions ?? {});
    setAgents(body.data.agents ?? []);
    setKnowledgeBases(body.data.knowledgeBases ?? []);
    setError(null);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onEdit(item: AssistantRow) {
    setEditingId(item.id);
  }

  useEffect(() => {
    if (editingId) {
      const item = items.find((a) => a.id === editingId);
      if (!item) {
        return;
      }
      const firstId = integrations[0]?.id ?? "";
      const useOr = item.settingsJson?.useOpenRouter === true;
      const providerId = useOr
        ? "openrouter"
        : integrations.find((i) => i.id === item.providerIntegration.id)?.id ??
          integrations.find((i) => i.provider === item.providerIntegration.provider)?.id ??
          firstId;
      const s = (item.settingsJson ?? {}) as { model?: string };
      setDraft({
        name: item.name,
        systemPrompt: item.systemPrompt,
        providerIntegrationId: providerId,
        agentId: item.agentId ?? "",
        model: typeof s.model === "string" ? s.model : "",
        status: item.status,
        knowledgeBaseIds: item.knowledgeLinks.map((l) => l.knowledgeBaseId),
      });
      return;
    }
    setDraft((prev) => {
      if (prev.name || prev.systemPrompt) {
        return prev;
      }
      const def = integrations[0]?.id ?? "";
      if (!def) {
        return prev;
      }
      return { ...emptyDraft, model: "", providerIntegrationId: def };
    });
  }, [editingId, items, integrations]);

  function resetForm() {
    setEditingId(null);
    setDraft({
      ...emptyDraft,
      providerIntegrationId: integrations[0]?.id ?? "",
    });
  }

  const activeChatAssistant = useMemo(
    () => items.find((a) => a.id === activeAssistantId) ?? null,
    [items, activeAssistantId],
  );

  function toggleKnowledge(id: string) {
    setDraft((prev) => {
      const set = new Set(prev.knowledgeBaseIds);
      if (set.has(id)) {
        set.delete(id);
      } else {
        set.add(id);
      }
      return { ...prev, knowledgeBaseIds: Array.from(set) };
    });
  }

  async function onSubmit() {
    setSaving(true);
    setError(null);
    const payload = {
      name: draft.name.trim(),
      systemPrompt: draft.systemPrompt.trim(),
      providerIntegrationId: draft.providerIntegrationId,
      agentId: draft.agentId.trim() || null,
      model: draft.model.trim() || undefined,
      status: draft.status,
      knowledgeBaseIds: draft.knowledgeBaseIds,
    };
    if (!payload.name) {
      setError("Укажите наименование");
      setSaving(false);
      return;
    }
    if (!payload.systemPrompt) {
      setError("Укажите системный промпт");
      setSaving(false);
      return;
    }
    if (!payload.providerIntegrationId) {
      setError("Выберите интеграцию");
      setSaving(false);
      return;
    }
    const isEdit = Boolean(editingId);
    const response = await fetch(isEdit ? `/api/assistants/${editingId}` : "/api/assistants", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as ApiResponse;
    if (!response.ok || !body.ok) {
      setError((body as { error?: { message?: string } }).error?.message ?? "Ошибка сохранения");
      setSaving(false);
      return;
    }
    await load();
    resetForm();
    setSaving(false);
  }

  async function onDelete(id: string) {
    setRemovingId(id);
    setError(null);
    const response = await fetch(`/api/assistants/${id}`, { method: "DELETE" });
    const body = (await response.json()) as ApiResponse;
    if (!response.ok || !body.ok) {
      setError("Не удалось удалить");
      setRemovingId(null);
      return;
    }
    if (editingId === id) {
      resetForm();
    }
    await load();
    setRemovingId(null);
  }

  return (
    <section className="card agents-crm" data-testid="assistants-page">
      <div className="agents-crm-top">
        <div>
          <h1 style={{ marginBottom: 6 }}>Ассистенты</h1>
          <p style={{ marginTop: 0, color: "var(--muted)" }}>
            Системный промпт, интеграция, привязка к агенту и к базам знаний, тестовый чат с потоковым ответом.
            Убедитесь, что на сервере задеплоена последняя версия: страница без вкладок — старая сборка.
          </p>
        </div>
        <div className="crm-tabs">
          <button
            type="button"
            className={viewTab === "manage" ? "crm-tab-active" : "button-ghost"}
            onClick={() => setViewTab("manage")}
          >
            Управление
          </button>
          <button
            type="button"
            className={viewTab === "test" ? "crm-tab-active" : "button-ghost"}
            onClick={() => {
              setViewTab("test");
              if (items[0] && !activeAssistantId) {
                setActiveAssistantId(items[0].id);
              }
            }}
          >
            Тестовый чат
          </button>
        </div>
      </div>
      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
      {integrations.length === 0 ? (
        <div className="agents-empty">
          <p>Нет доступных AI интеграций. Настройте и протестируйте провайдера в разделе «Интеграция AI».</p>
        </div>
      ) : null}

      {integrations.length > 0 && viewTab === "test" && items.length > 0 ? (
        <div className="crm-chat-layout" style={{ gridTemplateColumns: "240px 1fr" }}>
          <aside className="crm-chat-sidebar" style={{ maxHeight: 520, overflow: "auto" }}>
            <div className="crm-chat-panel">
              <div className="crm-panel-head">
                <strong>Ассистент</strong>
              </div>
              <div className="crm-panel-list">
                {items.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`crm-agent-pick ${activeAssistantId === a.id ? "crm-agent-pick-active" : ""}`}
                    onClick={() => setActiveAssistantId(a.id)}
                  >
                    <span>{a.name}</span>
                    <small>{integrationLabel(a)}</small>
                  </button>
                ))}
              </div>
            </div>
          </aside>
          {activeChatAssistant && activeAssistantId ? (
            <AssistantTestChatPanel
              key={activeAssistantId}
              assistantId={activeAssistantId}
              assistantName={activeChatAssistant.name}
            />
          ) : (
            <p className="agents-empty" style={{ margin: 0 }}>
              Выберите ассистента слева.
            </p>
          )}
        </div>
      ) : null}
      {integrations.length > 0 && viewTab === "test" && items.length === 0 ? (
        <div className="agents-empty">
          <p>Сначала создайте ассистента во вкладке «Управление».</p>
        </div>
      ) : null}

      {integrations.length > 0 && viewTab === "manage" ? (
        <div className="agents-layout">
          <div className="agent-form">
            <h3>{editingId ? "Редактирование" : "Создание ассистента"}</h3>
            <label>Наименование</label>
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Support Assistant"
            />
            <label>Системный промпт</label>
            <textarea
              rows={5}
              value={draft.systemPrompt}
              onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
              placeholder="Роль, стиль ответа, ограничения"
            />
            <label>Интеграция</label>
            <select
              value={draft.providerIntegrationId}
              onChange={(e) => setDraft((d) => ({ ...d, providerIntegrationId: e.target.value }))}
            >
              {integrations.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.displayName}
                </option>
              ))}
            </select>
            {selectedModels.length > 0 ? (
              <p className="assistants-hint" style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)" }}>
                Каталог: {selectedModels.slice(0, 8).join(", ")}
                {selectedModels.length > 8 ? "…" : ""}
              </p>
            ) : null}
            <label>Модель (если агент не привязан)</label>
            <input
              value={draft.model}
              onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
              placeholder="Напр. gpt-4.1-mini (иначе используется модель агента)"
            />
            <label>Агент (опционально)</label>
            <select
              value={draft.agentId}
              onChange={(e) => setDraft((d) => ({ ...d, agentId: e.target.value }))}
            >
              <option value="">Без привязки</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.model}
                </option>
              ))}
            </select>
            <label>Статус</label>
            <select
              value={draft.status}
              onChange={(e) =>
                setDraft((d) => ({ ...d, status: e.target.value as DraftStatus }))
              }
            >
              <option value="ACTIVE">Активный</option>
              <option value="DRAFT">Черновик</option>
              <option value="ARCHIVED">Архив</option>
            </select>
            <label>Базы знаний</label>
            {knowledgeBases.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--muted)" }}>
                Сначала создайте базу знаний в разделе «База знаний», затем отметьте её здесь.
              </p>
            ) : (
              <div className="assistant-kb-list" role="group" aria-label="Базы знаний">
                {knowledgeBases.map((kb) => (
                  <label key={kb.id} className="integration-toggle" style={{ display: "flex", marginBottom: 4 }}>
                    <input
                      type="checkbox"
                      checked={draft.knowledgeBaseIds.includes(kb.id)}
                      onChange={() => toggleKnowledge(kb.id)}
                    />
                    {kb.name}
                  </label>
                ))}
              </div>
            )}
            <div className="agent-actions" style={{ marginTop: 10 }}>
              <button type="button" disabled={saving} onClick={() => void onSubmit()}>
                {saving ? "Сохранение…" : editingId ? "Обновить" : "Создать"}
              </button>
              {editingId ? (
                <button type="button" className="button-ghost" onClick={resetForm} disabled={saving}>
                  Отмена
                </button>
              ) : null}
            </div>
          </div>

          <div className="agents-list">
            <div className="agents-list-header">
              <strong>Реестр</strong>
              <span>{items.length} шт.</span>
            </div>
            {loading ? (
              <p>Загрузка…</p>
            ) : items.length === 0 ? (
              <p>Ассистентов пока нет.</p>
            ) : (
              items.map((item) => (
                <article key={item.id} className="agent-item">
                  <div className="agent-item-main">
                    <div className="agent-item-head">
                      <h3>{item.name}</h3>
                      <span
                        className={`agent-status ${
                          item.status === "ACTIVE" ? "status-active" : "status-archived"
                        }`}
                      >
                        {statusLabel(item.status)}
                      </span>
                    </div>
                    <p className="assistant-prompt-preview">{item.systemPrompt.slice(0, 200)}{item.systemPrompt.length > 200 ? "…" : ""}</p>
                    <div className="agent-meta">
                      <span>Интеграция: {integrationLabel(item)}</span>
                      {item.agent ? <span>Агент: {item.agent.name}</span> : <span>Агент: —</span>}
                      <span>v{item.version}</span>
                      <span>Баз знаний: {item.knowledgeLinks.length}</span>
                      <span>Обновлён: {asLocalDate(item.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="agent-item-actions">
                    <button
                      type="button"
                      className="button-ghost"
                      onClick={() => {
                        setActiveAssistantId(item.id);
                        setViewTab("test");
                      }}
                    >
                      Тест
                    </button>
                    <button type="button" className="button-ghost" onClick={() => onEdit(item)}>
                      Редактировать
                    </button>
                    <button
                      type="button"
                      className="button-danger"
                      disabled={removingId === item.id}
                      onClick={() => void onDelete(item.id)}
                    >
                      {removingId === item.id ? "Удаление…" : "Удалить"}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
