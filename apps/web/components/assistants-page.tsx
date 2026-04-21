"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AssistantTestChatPanel } from "@/components/assistant-test-chat-panel";
import {
  DEFAULT_ASSISTANT_SETTINGS,
  type AssistantPersonaSettings,
  type AssistantTemplate,
} from "@/lib/assistant-settings";

type IntegrationOption = { id: string; provider: string; displayName: string; status: string };
type AgentOption = { id: string; name: string; model: string };
type KnowledgeBaseOption = { id: string; name: string };
type TemplateOption = {
  id: AssistantTemplate;
  title: string;
  description: string;
  systemPrompt: string;
  persona: Partial<AssistantPersonaSettings>;
};

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
  persona?: AssistantPersonaSettings | null;
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
    templates?: TemplateOption[];
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
  template: "blank" as AssistantTemplate,
  persona: { ...DEFAULT_ASSISTANT_SETTINGS } as AssistantPersonaSettings,
};

function normalizeModel(nextModel: string, models: string[]) {
  if (!models.length) {
    return nextModel;
  }
  if (models.includes(nextModel)) {
    return nextModel;
  }
  return models[0] ?? "";
}

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

const TONE_LABEL: Record<AssistantPersonaSettings["tone"], string> = {
  friendly: "дружелюбный",
  formal: "формальный",
  neutral: "нейтральный",
  energetic: "энергичный",
  empathic: "эмпатичный",
};

const LENGTH_LABEL: Record<AssistantPersonaSettings["length"], string> = {
  short: "коротко",
  normal: "средне",
  detailed: "развёрнуто",
};

const LANGUAGE_LABEL: Record<AssistantPersonaSettings["language"], string> = {
  auto: "как у собеседника",
  ru: "русский",
  en: "english",
};

function personaLabel(persona: AssistantPersonaSettings) {
  const parts = [TONE_LABEL[persona.tone], LENGTH_LABEL[persona.length], LANGUAGE_LABEL[persona.language]];
  if (persona.useEmoji) {
    parts.push("эмодзи");
  }
  return parts.join(" · ");
}

export function AssistantsPageClient() {
  const [items, setItems] = useState<AssistantRow[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationOption[]>([]);
  const [modelOptions, setModelOptions] = useState<Record<string, string[]>>({});
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseOption[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<"manage" | "test">("manage");
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);
  const [personaOpen, setPersonaOpen] = useState(false);

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

  const hasAgent = Boolean(draft.agentId.trim());

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
    setTemplates(body.data.templates ?? []);
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
      const intForModels = integrations.find((i) => i.id === providerId);
      const models = intForModels
        ? [...(modelOptions[intForModels.provider] ?? [])].sort((a, b) => a.localeCompare(b))
        : [];
      const modelStored = typeof s.model === "string" ? s.model : "";
      const personaFromItem: AssistantPersonaSettings = item.persona
        ? { ...DEFAULT_ASSISTANT_SETTINGS, ...item.persona }
        : { ...DEFAULT_ASSISTANT_SETTINGS };
      setDraft({
        name: item.name,
        systemPrompt: item.systemPrompt,
        providerIntegrationId: providerId,
        agentId: item.agentId ?? "",
        model: item.agentId ? "" : normalizeModel(modelStored, models) || (models[0] ?? ""),
        status: item.status,
        knowledgeBaseIds: item.knowledgeLinks.map((l) => l.knowledgeBaseId),
        template: personaFromItem.template,
        persona: personaFromItem,
      });
      setPersonaOpen(true);
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
      const pro = integrations[0]!.provider;
      const mlist = [...(modelOptions[pro] ?? [])].sort((a, b) => a.localeCompare(b));
      return { ...emptyDraft, model: mlist[0] ?? "", providerIntegrationId: def };
    });
  }, [editingId, items, integrations, modelOptions]);

  function resetForm() {
    setEditingId(null);
    setPersonaOpen(false);
    const def = integrations[0]?.id ?? "";
    const pro = integrations[0]?.provider;
    const mlist = pro ? [...(modelOptions[pro] ?? [])].sort((a, b) => a.localeCompare(b)) : [];
    setDraft({
      ...emptyDraft,
      providerIntegrationId: def,
      model: mlist[0] ?? "",
      persona: { ...DEFAULT_ASSISTANT_SETTINGS },
    });
  }

  function applyTemplate(id: AssistantTemplate) {
    const tpl = templates.find((t) => t.id === id) ?? null;
    setDraft((prev) => {
      const prevTpl = templates.find((t) => t.id === prev.template);
      const prevPrompt = prev.systemPrompt.trim();
      const promptComesFromPrevTpl = prevTpl ? prevPrompt === prevTpl.systemPrompt.trim() : false;
      const promptIsCustom = prevPrompt.length > 0 && !promptComesFromPrevTpl;
      const nextPersona: AssistantPersonaSettings = {
        ...DEFAULT_ASSISTANT_SETTINGS,
        ...(tpl?.persona ?? {}),
        template: id,
      };
      return {
        ...prev,
        template: id,
        persona: nextPersona,
        systemPrompt: promptIsCustom ? prev.systemPrompt : tpl?.systemPrompt ?? "",
      };
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
    const linked = draft.agentId.trim();
    if (!draft.providerIntegrationId.trim() && !linked) {
      setError("Укажите агента или выберите интеграцию с моделью");
      setSaving(false);
      return;
    }
    if (!linked && !draft.model.trim()) {
      setError("Без агента выберите модель");
      setSaving(false);
      return;
    }
    const payload: Record<string, unknown> = {
      name: draft.name.trim(),
      systemPrompt: draft.systemPrompt.trim(),
      agentId: linked || null,
      status: draft.status,
      knowledgeBaseIds: draft.knowledgeBaseIds,
      template: draft.template,
      persona: draft.persona,
    };
    if (linked) {
      payload.providerIntegrationId = "";
      payload.model = "";
    } else {
      payload.providerIntegrationId = draft.providerIntegrationId;
      payload.model = draft.model.trim();
    }
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
          <h1 style={{ marginBottom: 4 }}>Ассистенты</h1>
          <p style={{ marginTop: 0, marginBottom: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.45 }}>
            Системный промпт, тестовый чат, базы знаний. Укажите агента — или интеграцию и модель
            (как в разделе «Агенты»).
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
          <div className="agent-form agent-form--compact">
            <h3>{editingId ? "Редактирование" : "Создание ассистента"}</h3>
            <label>Наименование</label>
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Support Assistant"
            />

            {templates.length > 0 ? (
              <>
                <label>Шаблон персоналии</label>
                <p className="assistants-hint" style={{ marginTop: 0 }}>
                  Готовые сценарии: автоматически подставляют промпт и стиль. Можно выбрать «Пустой» и написать свой.
                </p>
                <div className="assistant-templates">
                  {templates.map((tpl) => (
                    <button
                      type="button"
                      key={tpl.id}
                      className={`assistant-template-card ${draft.template === tpl.id ? "assistant-template-card-active" : ""}`}
                      onClick={() => applyTemplate(tpl.id)}
                      title={tpl.description}
                    >
                      <strong>{tpl.title}</strong>
                      <span>{tpl.description}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            <label>Системный промпт</label>
            <textarea
              rows={4}
              value={draft.systemPrompt}
              onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
              placeholder="Роль, стиль ответа, ограничения"
            />

            <div className="assistant-persona-head">
              <button
                type="button"
                className="assistant-persona-toggle"
                onClick={() => setPersonaOpen((v) => !v)}
              >
                {personaOpen ? "▼" : "▶"} Стиль ответов ассистента
              </button>
              <span className="assistant-persona-summary">
                {personaLabel(draft.persona)}
              </span>
            </div>
            {personaOpen ? (
              <div className="assistant-persona-grid">
                <label>
                  Тон
                  <select
                    value={draft.persona.tone}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        persona: { ...d.persona, tone: e.target.value as AssistantPersonaSettings["tone"] },
                      }))
                    }
                  >
                    <option value="friendly">Дружелюбный</option>
                    <option value="formal">Формальный</option>
                    <option value="neutral">Нейтральный</option>
                    <option value="energetic">Энергичный</option>
                    <option value="empathic">Эмпатичный</option>
                  </select>
                </label>
                <label>
                  Длина ответа
                  <select
                    value={draft.persona.length}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        persona: { ...d.persona, length: e.target.value as AssistantPersonaSettings["length"] },
                      }))
                    }
                  >
                    <option value="short">Короткий (1–3 предложения)</option>
                    <option value="normal">Средний</option>
                    <option value="detailed">Развёрнутый (с примерами)</option>
                  </select>
                </label>
                <label>
                  Язык
                  <select
                    value={draft.persona.language}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        persona: {
                          ...d.persona,
                          language: e.target.value as AssistantPersonaSettings["language"],
                        },
                      }))
                    }
                  >
                    <option value="auto">Как у собеседника</option>
                    <option value="ru">Всегда русский</option>
                    <option value="en">Всегда English</option>
                  </select>
                </label>
                <label className="assistant-persona-check">
                  <input
                    type="checkbox"
                    checked={draft.persona.useEmoji}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        persona: { ...d.persona, useEmoji: e.target.checked },
                      }))
                    }
                  />
                  Разрешить эмодзи
                </label>
                <label className="assistant-persona-role">
                  Краткая роль (1 предложение)
                  <input
                    value={draft.persona.role}
                    maxLength={240}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        persona: { ...d.persona, role: e.target.value },
                      }))
                    }
                    placeholder="Например: Консультант ювелирного магазина"
                  />
                </label>
              </div>
            ) : null}

            <div className="assistants-routing">
              <label>Агент</label>
              <select
                value={draft.agentId}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) {
                    setDraft((d) => ({ ...d, agentId: v }));
                    return;
                  }
                  const def = integrations[0]?.id ?? "";
                  const integ = integrations.find((i) => i.id === def) ?? integrations[0];
                  const mlist = integ
                    ? [...(modelOptions[integ.provider] ?? [])].sort((a, b) => a.localeCompare(b))
                    : [];
                  setDraft((d) => ({
                    ...d,
                    agentId: "",
                    providerIntegrationId: def || d.providerIntegrationId,
                    model: normalizeModel(d.model, mlist) || mlist[0] || "",
                  }));
                }}
              >
                <option value="">— Нет, выбрать интеграцию и модель ниже</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.model}
                  </option>
                ))}
              </select>
              {hasAgent ? (
                <p className="assistants-hint">Интеграция и модель берутся с выбранного агента.</p>
              ) : (
                <p className="assistants-hint">Для теста без агента задайте интеграцию и модель.</p>
              )}

              {!hasAgent ? (
                <>
                  <label>Интеграция</label>
                  <select
                    value={draft.providerIntegrationId}
                    onChange={(e) => {
                      const integrationId = e.target.value;
                      setDraft((prev) => ({
                        ...prev,
                        providerIntegrationId: integrationId,
                        model: normalizeModel(
                          prev.model,
                          (() => {
                            const it = integrations.find((x) => x.id === integrationId);
                            return it ? (modelOptions[it.provider] ?? []) : [];
                          })(),
                        ),
                      }));
                    }}
                  >
                    {integrations.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.displayName}
                      </option>
                    ))}
                  </select>
                  <label>Модель</label>
                  <select
                    value={draft.model}
                    onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
                  >
                    {selectedModels.length ? (
                      selectedModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))
                    ) : (
                      <option value="">Нет моделей</option>
                    )}
                  </select>
                </>
              ) : null}
            </div>
            <label>Статус</label>
            <select
              value={draft.status}
              onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as DraftStatus }))}
            >
              <option value="ACTIVE">Активный</option>
              <option value="DRAFT">Черновик</option>
              <option value="ARCHIVED">Архив</option>
            </select>
            <label>Базы знаний</label>
            <p className="assistants-kb-lead" style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 6px" }}>
              <Link href="/knowledge" className="knowledge-link">
                Управление базами
              </Link>
              — отметьте, какие наборы подставлять в контекст ответа.
            </p>
            {knowledgeBases.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 4px" }}>
                Сначала создайте базу на странице «База знаний».
              </p>
            ) : (
              <div
                className="assistant-kb-list assistants-kb-compact"
                role="group"
                aria-label="Базы знаний"
              >
                {knowledgeBases.map((kb) => (
                  <label key={kb.id} className="integration-toggle" style={{ display: "flex", marginBottom: 2 }}>
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
            <div className="agent-actions" style={{ marginTop: 8 }}>
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

          <div
            className={`agents-list ${
              items.length > 0 ? "agents-list--tight" : "agents-list--empty"
            }`}
          >
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
                      {item.agent ? (
                        <span>Агент: {item.agent.name}</span>
                      ) : (
                        <span>
                          Модель:{" "}
                          {typeof (item.settingsJson as { model?: string } | null)?.model === "string"
                            ? (item.settingsJson as { model: string }).model
                            : "—"}
                        </span>
                      )}
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
