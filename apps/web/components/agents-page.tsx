"use client";

import { useEffect, useMemo, useState } from "react";

type IntegrationOption = {
  id: string;
  provider: string;
  displayName: string;
  status: string;
};

type AgentRow = {
  id: string;
  name: string;
  description: string | null;
  model: string;
  temperature: number;
  maxTokens: number | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  providerIntegrationId: string;
  createdAt: string;
  updatedAt: string;
  providerIntegration: {
    provider: string;
    displayName: string;
    status: string;
  };
};

type AgentsResponse = {
  ok: boolean;
  data?: {
    agents?: AgentRow[];
    integrations?: IntegrationOption[];
    modelOptions?: Record<string, string[]>;
    item?: AgentRow;
  };
  error?: { message?: string };
};

type AgentDraft = {
  name: string;
  description: string;
  providerIntegrationId: string;
  model: string;
  temperature: string;
  maxTokens: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
};

const emptyDraft: AgentDraft = {
  name: "",
  description: "",
  providerIntegrationId: "",
  model: "",
  temperature: "0.7",
  maxTokens: "",
  status: "DRAFT",
};

function asLocalDate(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return value;
  }
  return dt.toLocaleString("ru-RU");
}

export function AgentsPageClient() {
  const [items, setItems] = useState<AgentRow[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationOption[]>([]);
  const [modelOptions, setModelOptions] = useState<Record<string, string[]>>({});
  const [draft, setDraft] = useState<AgentDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedIntegration = useMemo(
    () => integrations.find((integration) => integration.id === draft.providerIntegrationId) ?? null,
    [integrations, draft.providerIntegrationId],
  );

  const selectedModels = useMemo(() => {
    if (!selectedIntegration) {
      return [];
    }
    return modelOptions[selectedIntegration.provider] ?? [];
  }, [modelOptions, selectedIntegration]);

  function normalizeModel(integrationId: string, nextModel: string, options: Record<string, string[]>) {
    const integration = integrations.find((item) => item.id === integrationId);
    if (!integration) {
      return nextModel;
    }
    const allowed = options[integration.provider] ?? [];
    if (!allowed.length) {
      return nextModel;
    }
    if (allowed.includes(nextModel)) {
      return nextModel;
    }
    return allowed[0];
  }

  function resetDraft(defaultIntegrationId?: string, options?: Record<string, string[]>) {
    const integrationId = defaultIntegrationId ?? integrations[0]?.id ?? "";
    setDraft({
      ...emptyDraft,
      providerIntegrationId: integrationId,
      model: normalizeModel(integrationId, "", options ?? modelOptions),
    });
    setEditingId(null);
  }

  async function load() {
    setLoading(true);
    const response = await fetch("/api/agents");
    const body = (await response.json()) as AgentsResponse;
    if (!response.ok || !body.ok || !body.data) {
      setError(body.error?.message ?? "Не удалось загрузить агентов");
      setLoading(false);
      return;
    }
    const nextIntegrations = body.data.integrations ?? [];
    const nextOptions = body.data.modelOptions ?? {};
    setItems(body.data.agents ?? []);
    setIntegrations(nextIntegrations);
    setModelOptions(nextOptions);
    if (!editingId) {
      const defaultIntegrationId = nextIntegrations[0]?.id ?? "";
      setDraft({
        ...emptyDraft,
        providerIntegrationId: defaultIntegrationId,
        model: (() => {
          const provider = nextIntegrations[0]?.provider;
          if (!provider) {
            return "";
          }
          return nextOptions[provider]?.[0] ?? "";
        })(),
      });
    }
    setError(null);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit() {
    setSaving(true);
    setError(null);
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      providerIntegrationId: draft.providerIntegrationId,
      model: draft.model.trim(),
      temperature: draft.temperature.trim(),
      maxTokens: draft.maxTokens.trim() || null,
      status: draft.status,
    };
    const isEdit = Boolean(editingId);
    const response = await fetch(isEdit ? `/api/agents/${editingId}` : "/api/agents", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as AgentsResponse;
    if (!response.ok || !body.ok) {
      setError(body.error?.message ?? "Не удалось сохранить агента");
      setSaving(false);
      return;
    }
    await load();
    resetDraft();
    setSaving(false);
  }

  function onEdit(item: AgentRow) {
    setEditingId(item.id);
    setDraft({
      name: item.name,
      description: item.description ?? "",
      providerIntegrationId: item.providerIntegrationId,
      model: item.model,
      temperature: String(item.temperature),
      maxTokens: item.maxTokens ? String(item.maxTokens) : "",
      status: item.status,
    });
    setError(null);
  }

  async function onDelete(item: AgentRow) {
    setRemovingId(item.id);
    setError(null);
    const response = await fetch(`/api/agents/${item.id}`, { method: "DELETE" });
    const body = (await response.json()) as AgentsResponse;
    if (!response.ok || !body.ok) {
      setError(body.error?.message ?? "Не удалось удалить агента");
      setRemovingId(null);
      return;
    }
    await load();
    if (editingId === item.id) {
      resetDraft();
    }
    setRemovingId(null);
  }

  return (
    <section className="card">
      <h1 style={{ marginBottom: 6 }}>Агенты</h1>
      <p style={{ marginTop: 0, color: "#6b7280" }}>
        Полноценный CRUD для агентов, конфиг модели и изоляция данных только в рамках вашего аккаунта.
      </p>
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

      {integrations.length === 0 ? (
        <div className="agents-empty">
          <p>Нет доступных AI интеграций. Сначала настройте провайдера на странице Интеграции AI.</p>
        </div>
      ) : (
        <div className="agents-layout">
          <div className="agent-form">
            <h3>{editingId ? "Редактирование агента" : "Создание агента"}</h3>
            <label>Наименование</label>
            <input
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Например: Sales AI"
            />

            <label>Описание</label>
            <textarea
              rows={3}
              value={draft.description}
              onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Краткая роль агента"
            />

            <label>Интеграция</label>
            <select
              value={draft.providerIntegrationId}
              onChange={(event) => {
                const integrationId = event.target.value;
                setDraft((prev) => ({
                  ...prev,
                  providerIntegrationId: integrationId,
                  model: normalizeModel(integrationId, prev.model, modelOptions),
                }));
              }}
            >
              {integrations.map((integration) => (
                <option key={integration.id} value={integration.id}>
                  {integration.displayName} ({integration.provider})
                </option>
              ))}
            </select>

            <label>Модель</label>
            <select
              value={draft.model}
              onChange={(event) => setDraft((prev) => ({ ...prev, model: event.target.value }))}
            >
              {selectedModels.length ? (
                selectedModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))
              ) : (
                <option value="">Нет моделей</option>
              )}
            </select>

            <div className="agent-form-row">
              <div>
                <label>Temperature (0..2)</label>
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={draft.temperature}
                  onChange={(event) => setDraft((prev) => ({ ...prev, temperature: event.target.value }))}
                />
              </div>
              <div>
                <label>Max tokens</label>
                <input
                  type="number"
                  min={1}
                  value={draft.maxTokens}
                  onChange={(event) => setDraft((prev) => ({ ...prev, maxTokens: event.target.value }))}
                  placeholder="Не ограничено"
                />
              </div>
            </div>

            <label>Статус</label>
            <select
              value={draft.status}
              onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value as AgentDraft["status"] }))}
            >
              <option value="DRAFT">Черновик</option>
              <option value="ACTIVE">Активный</option>
              <option value="ARCHIVED">Архив</option>
            </select>

            <div className="agent-actions">
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  void onSubmit();
                }}
              >
                {saving ? "Сохранение..." : editingId ? "Обновить" : "Создать"}
              </button>
              {editingId ? (
                <button
                  type="button"
                  className="button-ghost"
                  onClick={() => resetDraft()}
                  disabled={saving}
                >
                  Отмена
                </button>
              ) : null}
            </div>
          </div>

          <div className="agents-list">
            {loading ? (
              <p>Загрузка...</p>
            ) : items.length === 0 ? (
              <p>Пока нет агентов.</p>
            ) : (
              items.map((item) => (
                <article key={item.id} className="agent-item">
                  <div className="agent-item-head">
                    <h3>{item.name}</h3>
                    <span className={`agent-status status-${item.status.toLowerCase()}`}>{item.status}</span>
                  </div>
                  <p>{item.description || "Без описания"}</p>
                  <div className="agent-meta">
                    <span>Провайдер: {item.providerIntegration.displayName}</span>
                    <span>Модель: {item.model}</span>
                    <span>Temp: {item.temperature}</span>
                    <span>Max tokens: {item.maxTokens ?? "—"}</span>
                    <span>Обновлен: {asLocalDate(item.updatedAt)}</span>
                  </div>
                  <div className="agent-item-actions">
                    <button type="button" className="button-ghost" onClick={() => onEdit(item)}>
                      Редактировать
                    </button>
                    <button
                      type="button"
                      className="button-danger"
                      disabled={removingId === item.id}
                      onClick={() => {
                        void onDelete(item);
                      }}
                    >
                      {removingId === item.id ? "Удаление..." : "Удалить"}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
