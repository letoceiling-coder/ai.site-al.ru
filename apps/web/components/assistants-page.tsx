"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AssistantTestChatPanel } from "@/components/assistant-test-chat-panel";
import {
  DEFAULT_ASSISTANT_GENERATION,
  DEFAULT_ASSISTANT_SETTINGS,
  type AssistantGenerationOverrides,
  type AssistantPersonaSettings,
  type AssistantTemplate,
} from "@/lib/assistant-settings";
import {
  DEFAULT_ASSISTANT_TOOLS,
  type AssistantToolConfig,
  type AssistantToolId,
  type AssistantToolsConfig,
} from "@/lib/assistant-tools";

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

type ToolCatalogEntry = {
  id: AssistantToolId;
  title: string;
  humanDescription: string;
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
  generation?: AssistantGenerationOverrides | null;
  tools?: AssistantToolsConfig | null;
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
    toolCatalog?: ToolCatalogEntry[];
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
  generation: { ...DEFAULT_ASSISTANT_GENERATION } as AssistantGenerationOverrides,
  tools: {
    create_lead: { ...DEFAULT_ASSISTANT_TOOLS.create_lead },
    handoff_to_operator: { ...DEFAULT_ASSISTANT_TOOLS.handoff_to_operator },
    schedule_callback: { ...DEFAULT_ASSISTANT_TOOLS.schedule_callback },
  } as AssistantToolsConfig,
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
  const [toolCatalog, setToolCatalog] = useState<ToolCatalogEntry[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [generatorDescription, setGeneratorDescription] = useState("");
  const [generatorLoading, setGeneratorLoading] = useState(false);
  const [generatorError, setGeneratorError] = useState<string | null>(null);
  const [generatorUsePersona, setGeneratorUsePersona] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<
    Array<{ version: number; prompt: string; createdAt: string }>
  >([]);
  const [historyCurrentVersion, setHistoryCurrentVersion] = useState<number | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
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
    setToolCatalog(body.data.toolCatalog ?? []);
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
      const generationFromItem: AssistantGenerationOverrides = item.generation
        ? { ...DEFAULT_ASSISTANT_GENERATION, ...item.generation }
        : { ...DEFAULT_ASSISTANT_GENERATION };
      const toolsFromItem: AssistantToolsConfig = {
        create_lead: { ...DEFAULT_ASSISTANT_TOOLS.create_lead, ...(item.tools?.create_lead ?? {}) },
        handoff_to_operator: {
          ...DEFAULT_ASSISTANT_TOOLS.handoff_to_operator,
          ...(item.tools?.handoff_to_operator ?? {}),
        },
        schedule_callback: { ...DEFAULT_ASSISTANT_TOOLS.schedule_callback, ...(item.tools?.schedule_callback ?? {}) },
      };
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
        generation: generationFromItem,
        tools: toolsFromItem,
      });
      setPersonaOpen(true);
      if (
        toolsFromItem.create_lead.enabled ||
        toolsFromItem.handoff_to_operator.enabled ||
        toolsFromItem.schedule_callback.enabled
      ) {
        setToolsOpen(true);
      }
      setHistoryOpen(false);
      setHistoryItems([]);
      setHistoryCurrentVersion(null);
      void loadHistory(item.id);
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
    setToolsOpen(false);
    setGeneratorOpen(false);
    setGeneratorDescription("");
    setGeneratorError(null);
    setHistoryOpen(false);
    setHistoryItems([]);
    setHistoryCurrentVersion(null);
    setHistoryError(null);
    setPreviewOpen(false);
    const def = integrations[0]?.id ?? "";
    const pro = integrations[0]?.provider;
    const mlist = pro ? [...(modelOptions[pro] ?? [])].sort((a, b) => a.localeCompare(b)) : [];
    setDraft({
      ...emptyDraft,
      providerIntegrationId: def,
      model: mlist[0] ?? "",
      persona: { ...DEFAULT_ASSISTANT_SETTINGS },
      generation: { ...DEFAULT_ASSISTANT_GENERATION },
      tools: {
        create_lead: { ...DEFAULT_ASSISTANT_TOOLS.create_lead },
        handoff_to_operator: { ...DEFAULT_ASSISTANT_TOOLS.handoff_to_operator },
        schedule_callback: { ...DEFAULT_ASSISTANT_TOOLS.schedule_callback },
      },
    });
  }

  function updateTool(id: AssistantToolId, patch: Partial<AssistantToolConfig>) {
    setDraft((d) => ({
      ...d,
      tools: {
        ...d.tools,
        [id]: { ...d.tools[id], ...patch },
      },
    }));
  }

  async function loadHistory(assistantId: string) {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(`/api/assistants/${assistantId}/prompt-history`, { credentials: "include" });
      const body = (await res.json()) as {
        ok: boolean;
        data?: {
          current?: { version: number; prompt: string; createdAt: string };
          history?: Array<{ version: number; prompt: string; createdAt: string }>;
        };
        error?: { message?: string };
      };
      if (!res.ok || !body.ok || !body.data) {
        setHistoryError(body.error?.message ?? "Не удалось загрузить историю");
        return;
      }
      setHistoryCurrentVersion(body.data.current?.version ?? null);
      setHistoryItems(body.data.history ?? []);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "Ошибка запроса");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function restoreHistoryVersion(version: number) {
    if (!editingId) {
      return;
    }
    const confirmed = window.confirm(
      `Восстановить версию ${version}? Текущий промпт будет сохранён в истории как новая запись.`,
    );
    if (!confirmed) {
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(`/api/assistants/${editingId}/prompt-history/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ version }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        data?: { current?: { version: number; prompt: string } };
        error?: { message?: string };
      };
      if (!res.ok || !body.ok || !body.data?.current) {
        setHistoryError(body.error?.message ?? "Не удалось восстановить");
        return;
      }
      const restoredPrompt = body.data.current.prompt;
      setDraft((d) => ({ ...d, systemPrompt: restoredPrompt }));
      await loadHistory(editingId);
      await load();
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "Ошибка запроса");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function runGenerator() {
    const description = generatorDescription.trim();
    if (description.length < 8) {
      setGeneratorError("Описание слишком короткое (минимум 8 символов).");
      return;
    }
    setGeneratorLoading(true);
    setGeneratorError(null);
    try {
      const payload = {
        description,
        template: generatorUsePersona ? draft.template : undefined,
        persona: generatorUsePersona ? draft.persona : undefined,
        tools: generatorUsePersona ? draft.tools : undefined,
      };
      const res = await fetch("/api/assistants/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as {
        ok: boolean;
        data?: { systemPrompt?: string };
        error?: { message?: string };
      };
      if (!res.ok || !body.ok || !body.data?.systemPrompt) {
        setGeneratorError(body.error?.message ?? "Не удалось сгенерировать промпт");
        return;
      }
      setDraft((d) => ({ ...d, systemPrompt: body.data?.systemPrompt ?? "" }));
      setGeneratorOpen(false);
    } catch (err) {
      setGeneratorError(err instanceof Error ? err.message : "Ошибка запроса");
    } finally {
      setGeneratorLoading(false);
    }
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
      generation: draft.generation,
      tools: draft.tools,
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

  async function onClone(id: string) {
    setCloningId(id);
    setError(null);
    try {
      const response = await fetch(`/api/assistants/${id}/clone`, { method: "POST", credentials: "include" });
      const body = (await response.json()) as {
        ok: boolean;
        data?: { item?: AssistantRow };
        error?: { message?: string };
      };
      if (!response.ok || !body.ok || !body.data?.item) {
        setError(body.error?.message ?? "Не удалось создать копию");
        return;
      }
      await load();
      onEdit(body.data.item);
      setViewTab("manage");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка при клонировании");
    } finally {
      setCloningId(null);
    }
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

            <div className="assistant-prompt-head">
              <label style={{ margin: 0 }}>Системный промпт</label>
              <button
                type="button"
                className="button-ghost"
                onClick={() => setGeneratorOpen((v) => !v)}
                title="Сгенерировать системный промпт по описанию"
              >
                {generatorOpen ? "× Закрыть генератор" : "✨ Сгенерировать по описанию"}
              </button>
            </div>
            {generatorOpen ? (
              <div className="assistant-prompt-generator">
                <textarea
                  rows={3}
                  value={generatorDescription}
                  onChange={(e) => setGeneratorDescription(e.target.value)}
                  placeholder="Опишите роль: «Менеджер по продажам автозапчастей для Renault — отвечаю на вопросы о наличии, консультирую по подбору, веду пользователя к заявке»."
                  disabled={generatorLoading}
                  maxLength={4000}
                />
                <div className="assistant-prompt-generator-actions">
                  <label className="assistant-prompt-generator-check">
                    <input
                      type="checkbox"
                      checked={generatorUsePersona}
                      onChange={(e) => setGeneratorUsePersona(e.target.checked)}
                      disabled={generatorLoading}
                    />
                    Учитывать шаблон, стиль и инструменты
                  </label>
                  <button
                    type="button"
                    className="button-primary"
                    disabled={generatorLoading || generatorDescription.trim().length < 8}
                    onClick={() => void runGenerator()}
                  >
                    {generatorLoading ? "Генерирую…" : "Сгенерировать"}
                  </button>
                </div>
                {generatorError ? (
                  <p className="assistants-hint" style={{ color: "var(--danger)" }}>
                    {generatorError}
                  </p>
                ) : null}
                <p className="assistants-hint">
                  Текст в поле ниже будет заменён сгенерированным промптом. Вы сможете отредактировать результат
                  вручную.
                </p>
              </div>
            ) : null}
            <textarea
              rows={4}
              value={draft.systemPrompt}
              onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
              placeholder="Роль, стиль ответа, ограничения"
            />

            {editingId ? (
              <>
                <div className="assistant-persona-head">
                  <button
                    type="button"
                    className="assistant-persona-toggle"
                    onClick={() => setHistoryOpen((v) => !v)}
                  >
                    {historyOpen ? "▼" : "▶"} История промпта
                  </button>
                  <span className="assistant-persona-summary">
                    {historyCurrentVersion != null ? `v${historyCurrentVersion}` : ""}
                    {historyItems.length > 0 ? ` · ${historyItems.length} версий в архиве` : " · архив пуст"}
                  </span>
                </div>
                {historyOpen ? (
                  <div className="assistant-prompt-history">
                    {historyLoading ? <p className="assistants-hint">Загружаю…</p> : null}
                    {historyError ? (
                      <p className="assistants-hint" style={{ color: "var(--danger)" }}>
                        {historyError}
                      </p>
                    ) : null}
                    {!historyLoading && historyItems.length === 0 ? (
                      <p className="assistants-hint">Предыдущих версий пока нет.</p>
                    ) : null}
                    {historyItems.map((entry) => (
                      <div key={`${entry.version}-${entry.createdAt}`} className="assistant-prompt-history-item">
                        <div className="assistant-prompt-history-head">
                          <strong>v{entry.version}</strong>
                          <small>{entry.createdAt ? new Date(entry.createdAt).toLocaleString("ru-RU") : ""}</small>
                          <button
                            type="button"
                            className="button-ghost"
                            disabled={historyLoading}
                            onClick={() => void restoreHistoryVersion(entry.version)}
                            title="Сделать эту версию текущей"
                          >
                            Восстановить
                          </button>
                        </div>
                        <pre className="assistant-prompt-history-body">{entry.prompt.slice(0, 1400)}{entry.prompt.length > 1400 ? "…" : ""}</pre>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}

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
                <label className="assistant-persona-role">
                  Температура {draft.generation.temperature ?? "0.7"}
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={draft.generation.temperature ?? 0.7}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        generation: { ...d.generation, temperature: Number(e.target.value) },
                      }))
                    }
                  />
                  <small className="assistants-hint">0 — строго и предсказуемо, 1+ — креативнее и свободнее.</small>
                </label>
                <label>
                  Max tokens
                  <input
                    type="number"
                    min={64}
                    max={32000}
                    step={64}
                    value={draft.generation.maxTokens ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setDraft((d) => ({
                        ...d,
                        generation: {
                          ...d.generation,
                          maxTokens: raw === "" ? null : Math.max(64, Math.min(32000, Number(raw))),
                        },
                      }));
                    }}
                    placeholder="Авто (по умолчанию)"
                  />
                </label>
                <label>
                  Top-p
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={draft.generation.topP ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setDraft((d) => ({
                        ...d,
                        generation: {
                          ...d.generation,
                          topP: raw === "" ? null : Math.max(0, Math.min(1, Number(raw))),
                        },
                      }));
                    }}
                    placeholder="Авто (1.0)"
                  />
                </label>

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

                <label className="assistant-persona-role">
                  Приветственное сообщение
                  <textarea
                    className="assistant-persona-list-textarea"
                    value={draft.persona.welcomeMessage}
                    maxLength={600}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        persona: { ...d.persona, welcomeMessage: e.target.value },
                      }))
                    }
                    placeholder="Покажется пользователю при открытии чата."
                  />
                </label>

                <label className="assistant-persona-role">
                  Быстрые подсказки (по одной на строке, до 8)
                  <textarea
                    className="assistant-persona-list-textarea"
                    value={draft.persona.quickReplies.join("\n")}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        persona: {
                          ...d.persona,
                          quickReplies: e.target.value
                            .split("\n")
                            .map((v) => v.trim())
                            .filter(Boolean)
                            .slice(0, 8),
                        },
                      }))
                    }
                    placeholder={"Режим работы\nДоставка\nВозврат\nСвязь с оператором"}
                  />
                </label>

                <label className="assistant-persona-role">
                  Запрещённые темы (по одной на строке)
                  <textarea
                    className="assistant-persona-list-textarea"
                    value={draft.persona.bannedTopics.join("\n")}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        persona: {
                          ...d.persona,
                          bannedTopics: e.target.value
                            .split("\n")
                            .map((v) => v.trim())
                            .filter(Boolean)
                            .slice(0, 20),
                        },
                      }))
                    }
                    placeholder={"политика\nмедицинские диагнозы\nличные данные других клиентов"}
                  />
                </label>

                <label className="assistant-persona-role">
                  Обязательный дисклеймер в конце ответа
                  <input
                    value={draft.persona.disclaimer}
                    maxLength={400}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        persona: { ...d.persona, disclaimer: e.target.value },
                      }))
                    }
                    placeholder="Например: Информация носит справочный характер."
                  />
                </label>

                <label className="assistant-persona-role">
                  Фраза для передачи оператору
                  <input
                    value={draft.persona.handoffMessage}
                    maxLength={400}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        persona: { ...d.persona, handoffMessage: e.target.value },
                      }))
                    }
                    placeholder="Например: Сейчас подключу живого специалиста."
                  />
                </label>
              </div>
            ) : null}

            {toolCatalog.length > 0 ? (
              <>
                <div className="assistant-persona-head">
                  <button
                    type="button"
                    className="assistant-persona-toggle"
                    onClick={() => setToolsOpen((v) => !v)}
                  >
                    {toolsOpen ? "▼" : "▶"} Инструменты ассистента
                  </button>
                  <span className="assistant-persona-summary">
                    {(() => {
                      const on = toolCatalog.filter((t) => draft.tools[t.id]?.enabled).length;
                      return on > 0 ? `включено: ${on} из ${toolCatalog.length}` : "все выключены";
                    })()}
                  </span>
                </div>
                {toolsOpen ? (
                  <div className="assistant-tools-list">
                    {toolCatalog.map((tool) => {
                      const cfg = draft.tools[tool.id] ?? DEFAULT_ASSISTANT_TOOLS[tool.id];
                      return (
                        <div key={tool.id} className="assistant-tool-card">
                          <label className="assistant-tool-enable">
                            <input
                              type="checkbox"
                              checked={cfg.enabled}
                              onChange={(e) => updateTool(tool.id, { enabled: e.target.checked })}
                            />
                            <strong>{tool.title}</strong>
                          </label>
                          <p className="assistants-hint" style={{ margin: "4px 0 8px" }}>
                            {tool.humanDescription}
                          </p>
                          {cfg.enabled ? (
                            <div className="assistant-tool-fields">
                              <label>
                                Webhook URL (необязательно)
                                <input
                                  type="url"
                                  value={cfg.webhookUrl}
                                  placeholder="https://your-crm.example.com/hook"
                                  onChange={(e) => updateTool(tool.id, { webhookUrl: e.target.value })}
                                />
                              </label>
                              <label>
                                Email для уведомлений (необязательно)
                                <input
                                  type="email"
                                  value={cfg.notifyEmail}
                                  placeholder="sales@example.com"
                                  onChange={(e) => updateTool(tool.id, { notifyEmail: e.target.value })}
                                />
                              </label>
                              <label className="assistant-persona-role">
                                Инструкция для ассистента (когда вызывать)
                                <textarea
                                  className="assistant-persona-list-textarea"
                                  value={cfg.instructions}
                                  maxLength={600}
                                  onChange={(e) => updateTool(tool.id, { instructions: e.target.value })}
                                  placeholder="Например: вызывай только если пользователь явно просит перезвонить и назвал телефон."
                                />
                              </label>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </>
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
              {editingId ? (
                <button
                  type="button"
                  className="button-ghost"
                  onClick={() => setPreviewOpen((v) => !v)}
                  disabled={saving}
                >
                  {previewOpen ? "× Скрыть тестовый чат" : "💬 Быстрый тест"}
                </button>
              ) : null}
            </div>
            {editingId && previewOpen ? (
              <div className="assistant-inline-preview">
                <p className="assistants-hint">
                  Тестовый чат работает с сохранённой версией ассистента. После обновления формы не забудьте
                  «Обновить», чтобы изменения попали в чат.
                </p>
                <AssistantTestChatPanel
                  assistantId={editingId}
                  assistantName={draft.name || "Ассистент"}
                />
              </div>
            ) : null}
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
                      className="button-ghost"
                      disabled={cloningId === item.id}
                      onClick={() => void onClone(item.id)}
                    >
                      {cloningId === item.id ? "Дублирую…" : "Дублировать"}
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
