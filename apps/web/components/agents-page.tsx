"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { CitationText, CitationsList, type ChatCitation } from "@/components/chat-citations";

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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

type ChatMessage = {
  id: string;
  role: string;
  text: string;
  attachments: Array<{ name: string; url: string; mimeType: string; size: number }>;
  createdAt: string;
  citations?: ChatCitation[];
};

type ChatGetResponse = {
  ok: boolean;
  data?: {
    dialog?: { id: string };
    messages?: ChatMessage[];
  };
  error?: { message?: string };
};

type UploadResponse = {
  ok: boolean;
  data?: {
    files?: Array<{ name: string; url: string; mimeType: string; size: number }>;
  };
  error?: { message?: string };
};

type ChatSession = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
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
  status: "ACTIVE",
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
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [dialogId, setDialogId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatFiles, setChatFiles] = useState<Array<{ name: string; url: string; mimeType: string; size: number }>>([]);
  const [lastToolEvents, setLastToolEvents] = useState<
    Array<{ toolName: string; status: string; summary: string }>
  >([]);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceBackend, setVoiceBackend] = useState<"browser" | "provider">("browser");
  const [voiceGender, setVoiceGender] = useState<"female" | "male">("female");
  const [voiceStyle, setVoiceStyle] = useState<"neutral" | "calm" | "energetic">("neutral");
  const [listening, setListening] = useState(false);
  const [viewTab, setViewTab] = useState<"manage" | "chat">("manage");
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const [voiceState, setVoiceState] = useState<"idle" | "listening" | "error" | "unsupported">("idle");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<any>(null);

  const selectedIntegration = useMemo(
    () => integrations.find((integration) => integration.id === draft.providerIntegrationId) ?? null,
    [integrations, draft.providerIntegrationId],
  );

  const selectedModels = useMemo(() => {
    const provider = selectedIntegration?.provider;
    if (!provider) {
      return [];
    }
    return [...(modelOptions[provider] ?? [])].sort((a, b) => a.localeCompare(b));
  }, [modelOptions, selectedIntegration]);

  function normalizeModel(nextModel: string, models: string[]) {
    if (!models.length) {
      return nextModel;
    }
    if (models.includes(nextModel)) {
      return nextModel;
    }
    return models[0];
  }

  function resetDraft(defaultIntegrationId?: string, options?: Record<string, string[]>) {
    const integrationId = defaultIntegrationId ?? integrations[0]?.id ?? "";
    const sourceOptions = options ?? modelOptions;
    const integration = integrations.find((item) => item.id === integrationId);
    const byProvider = integration ? (sourceOptions[integration.provider] ?? []) : [];
    setDraft({
      ...emptyDraft,
      providerIntegrationId: integrationId,
      model: normalizeModel("", byProvider),
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
          const providerModels = nextOptions[provider] ?? [];
          return providerModels[0] ?? "";
        })(),
      });
    }
    const agents = body.data.agents ?? [];
    if (agents.length > 0 && !activeAgentId) {
      setActiveAgentId(agents[0].id);
    }
    if (agents.length === 0) {
      setActiveAgentId(null);
      setDialogId(null);
      setChatMessages([]);
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
    if (activeAgentId === item.id) {
      setActiveAgentId(null);
      setDialogId(null);
      setChatMessages([]);
    }
    setRemovingId(null);
  }

  async function ensureSession(agentId: string) {
    if (dialogId) {
      return dialogId;
    }
    const response = await fetch(`/api/agents/${agentId}/chat/sessions`, { method: "POST" });
    const raw = await response.text();
    const body = (raw ? safeJsonParse(raw) : null) as
      | { ok: boolean; data?: { dialog?: { id: string } }; error?: { message?: string } }
      | null;
    if (!response.ok || !body?.ok || !body.data?.dialog?.id) {
      throw new Error(
        body?.error?.message ?? `Не удалось создать чат-сессию (HTTP ${response.status})`,
      );
    }
    const newDialogId = body.data.dialog.id;
    const now = new Date().toISOString();
    setChatSessions((prev) => [{ id: newDialogId, status: "OPEN", createdAt: now, updatedAt: now }, ...prev]);
    setDialogId(newDialogId);
    return newDialogId;
  }

  async function loadSessions(agentId: string, preferredDialogId?: string) {
    setSessionsLoading(true);
    const response = await fetch(`/api/agents/${agentId}/chat/sessions`);
    const raw = await response.text();
    const body = (raw ? safeJsonParse(raw) : null) as
      | { ok: boolean; data?: { sessions?: ChatSession[] }; error?: { message?: string } }
      | null;
    if (!response.ok || !body?.ok) {
      setSessionsLoading(false);
      setChatError(
        body?.error?.message ?? `Не удалось загрузить сессии чата (HTTP ${response.status})`,
      );
      return;
    }
    const sessions = body.data?.sessions ?? [];
    setChatSessions(sessions);

    const targetDialogId = preferredDialogId ?? sessions[0]?.id ?? null;
    setDialogId(targetDialogId);
    if (targetDialogId) {
      await loadMessages(agentId, targetDialogId);
    } else {
      setChatMessages([]);
    }
    setSessionsLoading(false);
  }

  async function createSession(agentId: string) {
    setChatError(null);
    const response = await fetch(`/api/agents/${agentId}/chat/sessions`, { method: "POST" });
    const rawCreate = await response.text();
    const body = (rawCreate ? safeJsonParse(rawCreate) : { ok: false }) as {
      ok: boolean;
      data?: { dialog?: { id: string } };
      error?: { message?: string };
    };
    if (!response.ok || !body?.ok || !body.data?.dialog?.id) {
      setChatError(
        body?.error?.message ?? `Не удалось создать чат-сессию (HTTP ${response.status})`,
      );
      return;
    }
    await loadSessions(agentId, body.data.dialog.id);
  }

  async function loadMessages(agentId: string, forcedDialogId?: string) {
    const id = forcedDialogId ?? dialogId;
    if (!id) {
      setChatMessages([]);
      return;
    }
    const response = await fetch(`/api/agents/${agentId}/chat/messages?dialogId=${encodeURIComponent(id)}`);
    const body = (await response.json()) as ChatGetResponse;
    if (!response.ok || !body.ok || !body.data?.messages) {
      setChatError(body.error?.message ?? "Не удалось загрузить сообщения");
      return;
    }
    setChatMessages(body.data.messages);
  }

  async function uploadSelectedFiles(list: FileList | null) {
    if (!list || list.length === 0) {
      return;
    }
    setUploadingFiles(true);
    setChatError(null);
    const form = new FormData();
    for (const file of Array.from(list).slice(0, 10)) {
      form.append("files", file);
    }
    const response = await fetch("/api/uploads", {
      method: "POST",
      credentials: "include",
      body: form,
    });
    const body = (await response.json()) as UploadResponse;
    if (!response.ok || !body.ok || !body.data?.files) {
      setChatError(body.error?.message ?? "Не удалось загрузить файлы");
      setUploadingFiles(false);
      return;
    }
    setChatFiles((prev) => [...prev, ...body.data!.files!].slice(0, 10));
    setUploadingFiles(false);
  }

  function speakText(text: string) {
    if (!voiceEnabled || voiceBackend !== "browser") {
      return;
    }
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    const femaleTokens = ["female", "woman", "zira", "anna", "maria"];
    const maleTokens = ["male", "man", "david", "alex", "pavel"];
    const selectedTokens = voiceGender === "female" ? femaleTokens : maleTokens;
    const selectedVoice = voices.find((voice) =>
      selectedTokens.some((token) => voice.name.toLowerCase().includes(token) || voice.voiceURI.toLowerCase().includes(token)),
    );
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
    if (voiceStyle === "calm") {
      utterance.rate = 0.9;
      utterance.pitch = 0.95;
    } else if (voiceStyle === "energetic") {
      utterance.rate = 1.08;
      utterance.pitch = 1.1;
    } else {
      utterance.rate = 1;
      utterance.pitch = 1;
    }
    synth.cancel();
    synth.speak(utterance);
  }

  function startVoiceInput() {
    if (typeof window === "undefined") {
      return;
    }
    const AnyWindow = window as typeof window & {
      webkitSpeechRecognition?: new () => any;
      SpeechRecognition?: new () => any;
    };
    const Recognition = AnyWindow.SpeechRecognition ?? AnyWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setChatError("Голосовой ввод недоступен в этом браузере");
      setVoiceState("unsupported");
      return;
    }
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      setVoiceState("idle");
      return;
    }
    const recognition = new Recognition();
    let hadError = false;
    recognitionRef.current = recognition;
    recognition.lang = "ru-RU";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart = () => {
      setListening(true);
      setVoiceState("listening");
      setChatError(null);
    };
    recognition.onerror = () => {
      hadError = true;
      setListening(false);
      setVoiceState("error");
    };
    recognition.onend = () => {
      setListening(false);
      if (!hadError) {
        setVoiceState("idle");
      }
      recognitionRef.current = null;
    };
    recognition.onresult = (event: any) => {
      let text = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.isFinal) {
          text += String(result[0]?.transcript ?? "");
        }
      }
      const normalized = text.trim();
      if (!normalized) {
        return;
      }
      setChatInput((prev) => (prev.trim() ? `${prev.trim()} ${normalized}` : normalized));
    };
    recognition.start();
  }

  async function sendMessage() {
    if (!activeAgentId || !chatInput.trim()) {
      return;
    }
    setChatLoading(true);
    setChatError(null);
    setLastToolEvents([]);
    const pendingText = chatInput.trim();
    const pendingFiles = [...chatFiles];
    try {
      const currentDialogId = await ensureSession(activeAgentId);
      const userLocalId = `u-${Date.now()}`;
      const assistantLocalId = `a-${Date.now()}`;
      const nowIso = new Date().toISOString();
      setChatMessages((prev) => [
        ...prev,
        {
          id: userLocalId,
          role: "USER",
          text: pendingText,
          attachments: pendingFiles,
          createdAt: nowIso,
        },
        {
          id: assistantLocalId,
          role: "ASSISTANT",
          text: "",
          attachments: [],
          createdAt: nowIso,
        },
      ]);
      setChatInput("");
      setChatFiles([]);

      const response = await fetch(`/api/agents/${activeAgentId}/chat/messages/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dialogId: currentDialogId,
          text: pendingText,
          attachments: pendingFiles,
        }),
      });
      if (!response.ok || !response.body) {
        throw new Error("Не удалось начать streaming ответа");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalAssistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame
            .split("\n")
            .find((item) => item.startsWith("data:"))
            ?.slice(5)
            .trim();
          if (!line) {
            continue;
          }
          const payload = JSON.parse(line) as {
            type?: string;
            text?: string;
            dialogId?: string;
            message?: string;
            toolName?: string;
            status?: string;
            summary?: string;
            citations?: ChatCitation[];
          };
          if (payload.type === "meta" && payload.dialogId) {
            setDialogId(payload.dialogId);
          } else if (payload.type === "token") {
            finalAssistantText = payload.text ?? finalAssistantText;
            setChatMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantLocalId
                  ? {
                      ...msg,
                      text: finalAssistantText,
                    }
                  : msg,
              ),
            );
          } else if (payload.type === "citations" && Array.isArray(payload.citations)) {
            const cits = payload.citations;
            setChatMessages((prev) =>
              prev.map((msg) => (msg.id === assistantLocalId ? { ...msg, citations: cits } : msg)),
            );
          } else if (payload.type === "tool" && payload.toolName) {
            setLastToolEvents((prev) => [
              ...prev,
              {
                toolName: payload.toolName ?? "",
                status: payload.status ?? "",
                summary: payload.summary ?? "",
              },
            ]);
          } else if (payload.type === "done") {
            finalAssistantText = payload.text ?? finalAssistantText;
          } else if (payload.type === "error") {
            throw new Error(payload.message ?? "Ошибка в streaming");
          }
        }
      }

      await loadMessages(activeAgentId, currentDialogId);
      if (finalAssistantText) {
        speakText(finalAssistantText);
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Ошибка отправки сообщения");
    } finally {
      setChatLoading(false);
    }
  }

  const activeAgent = useMemo(() => items.find((item) => item.id === activeAgentId) ?? null, [items, activeAgentId]);

  useEffect(() => {
    if (!activeAgentId) {
      return;
    }
    setDialogId(null);
    setChatSessions([]);
    setChatMessages([]);
    setChatFiles([]);
    setChatInput("");
    setChatError(null);
    setChatSettingsOpen(false);
    setVoiceState("idle");
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore stop errors when recognition is already idle
      }
      recognitionRef.current = null;
    }
    void loadSessions(activeAgentId);
  }, [activeAgentId]);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    void uploadSelectedFiles(event.dataTransfer.files);
  }

  function handleDrag(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "dragenter" || event.type === "dragover") {
      setDragActive(true);
    } else if (event.type === "dragleave") {
      setDragActive(false);
    }
  }

  return (
    <section className="card agents-crm" data-testid="agents-page">
      <div className="agents-crm-top">
        <div>
          <h1 style={{ marginBottom: 6 }}>Агенты</h1>
          <p style={{ marginTop: 0, color: "#6b7280" }}>
            Удобное создание, управление и тестирование агентов внутри вашего аккаунта.
          </p>
        </div>
        <div className="crm-tabs">
          <button
            type="button"
            className={viewTab === "manage" ? "crm-tab-active" : "button-ghost"}
            onClick={() => setViewTab("manage")}
          >
            Управление агентами
          </button>
          <button
            type="button"
            className={viewTab === "chat" ? "crm-tab-active" : "button-ghost"}
            onClick={() => setViewTab("chat")}
          >
            Тестовые чаты
          </button>
        </div>
      </div>

      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

      {integrations.length === 0 ? (
        <div className="agents-empty">
          <p>Нет доступных AI интеграций. Сначала настройте провайдера на странице Интеграции AI.</p>
        </div>
      ) : null}

      {integrations.length > 0 && viewTab === "manage" ? (
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
                  model: normalizeModel(
                    prev.model,
                    (() => {
                      const integration = integrations.find((item) => item.id === integrationId);
                      return integration ? (modelOptions[integration.provider] ?? []) : [];
                    })(),
                  ),
                }));
              }}
            >
              {integrations.map((integration) => (
                <option key={integration.id} value={integration.id}>
                  {integration.displayName}
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
              <option value="ACTIVE">Активный</option>
              <option value="ARCHIVED">Неактивный</option>
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
            <div className="agents-list-header">
              <strong>Реестр агентов</strong>
              <span>{items.length} шт.</span>
            </div>
            {loading ? (
              <p>Загрузка...</p>
            ) : items.length === 0 ? (
              <p>Пока нет агентов.</p>
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
                        {item.status === "ACTIVE" ? "Активный" : "Неактивный"}
                      </span>
                    </div>
                    <p>{item.description || "Без описания"}</p>
                    <div className="agent-meta">
                      <span>Интеграция: {item.providerIntegration.displayName}</span>
                      <span>Модель: {item.model}</span>
                      <span>Temp: {item.temperature}</span>
                      <span>Max tokens: {item.maxTokens ?? "—"}</span>
                      <span>Обновлен: {asLocalDate(item.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="agent-item-actions">
                    <button
                      type="button"
                      className="button-ghost"
                      onClick={() => {
                        setActiveAgentId(item.id);
                        setViewTab("chat");
                      }}
                    >
                      Открыть чат
                    </button>
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
      ) : null}

      {integrations.length > 0 && viewTab === "chat" ? (
        <div className="crm-chat-layout">
          <aside className="crm-chat-sidebar">
            <div className="crm-chat-panel">
              <div className="crm-panel-head">
                <strong>Агенты</strong>
              </div>
              <div className="crm-panel-list">
                {items.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`crm-agent-pick ${activeAgentId === item.id ? "crm-agent-pick-active" : ""}`}
                    onClick={() => setActiveAgentId(item.id)}
                  >
                    <span>{item.name}</span>
                    <small>{item.model}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="crm-chat-panel">
              <div className="crm-panel-head">
                <strong>Сессии чатов</strong>
                <button
                  type="button"
                  className="button-ghost"
                  disabled={!activeAgentId}
                  data-testid="new-chat-session"
                  onClick={() => {
                    if (activeAgentId) {
                      void createSession(activeAgentId);
                    }
                  }}
                >
                  Новый чат
                </button>
              </div>
              <div className="crm-panel-list">
                {sessionsLoading ? <small>Загрузка сессий...</small> : null}
                {!sessionsLoading && chatSessions.length === 0 ? <small>Сессий пока нет</small> : null}
                {chatSessions.map((session) => (
                  <button
                    type="button"
                    key={session.id}
                    className={`crm-session-pick ${dialogId === session.id ? "crm-session-pick-active" : ""}`}
                    onClick={() => {
                      if (activeAgentId) {
                        setDialogId(session.id);
                        void loadMessages(activeAgentId, session.id);
                      }
                    }}
                  >
                    <span>Чат {session.id.slice(-6)}</span>
                    <small>{asLocalDate(session.updatedAt)}</small>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <div className="crm-chat-main">
            {activeAgent ? (
              <>
                <div className="agent-chat-header">
                  <h3 style={{ margin: 0 }}>Тест чат агента</h3>
                  <div className="chat-header-controls">
                    <div className="crm-agent-badge">
                      {activeAgent.name} · {activeAgent.providerIntegration.displayName}
                    </div>
                    <button
                      type="button"
                      className="chat-settings-btn"
                      onClick={() => setChatSettingsOpen((prev) => !prev)}
                      aria-label="Открыть настройки чата"
                    >
                      {"\u2699"}
                    </button>
                    {chatSettingsOpen ? (
                      <div className="chat-settings-popover">
                        <label className="integration-toggle">
                          <input
                            type="checkbox"
                            checked={voiceEnabled}
                            onChange={(event) => setVoiceEnabled(event.target.checked)}
                          />
                          Голосовой ответ
                        </label>
                        <select value={voiceBackend} onChange={(event) => setVoiceBackend(event.target.value as "browser" | "provider")}>
                          <option value="browser">Voice backend: browser (по умолчанию)</option>
                          <option value="provider">Voice backend: provider</option>
                        </select>
                        <select value={voiceGender} onChange={(event) => setVoiceGender(event.target.value as "female" | "male")}>
                          <option value="female">Голос: женский</option>
                          <option value="male">Голос: мужской</option>
                        </select>
                        <select
                          value={voiceStyle}
                          onChange={(event) => setVoiceStyle(event.target.value as "neutral" | "calm" | "energetic")}
                        >
                          <option value="neutral">Стиль: нейтральный</option>
                          <option value="calm">Стиль: спокойный</option>
                          <option value="energetic">Стиль: энергичный</option>
                        </select>
                        <button type="button" className="button-ghost" onClick={startVoiceInput}>
                          {listening ? "Слушаю..." : "Голосовой ввод"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
                <p style={{ marginTop: 8, color: "#6b7280" }}>Модель: {activeAgent.model}</p>

                <div className="agent-chat-body telegram-chat-body">
                  {chatMessages.length === 0 ? (
                    <p style={{ color: "#6b7280" }}>Сообщений пока нет. Начните новый тестовый диалог.</p>
                  ) : (
                    chatMessages.map((message) => (
                      <div
                        key={message.id}
                        className={`telegram-row ${message.role === "USER" ? "telegram-row-user" : "telegram-row-assistant"}`}
                      >
                        <div className={`chat-bubble telegram-bubble ${message.role === "USER" ? "chat-user" : "chat-assistant"}`}>
                          <p>
                            <CitationText text={message.text} citations={message.citations} />
                          </p>
                          {message.attachments.length > 0 ? (
                            <div className="chat-attachments">
                              {message.attachments.map((file) => (
                                <a key={`${message.id}-${file.url}`} href={file.url} target="_blank" rel="noreferrer">
                                  {file.name}
                                </a>
                              ))}
                            </div>
                          ) : null}
                          {message.role !== "USER" ? <CitationsList citations={message.citations} /> : null}
                          <small>{asLocalDate(message.createdAt)}</small>
                        </div>
                      </div>
                    ))
                  )}
                  {chatLoading ? <p style={{ color: "#6b7280" }}>Агент печатает ответ...</p> : null}
                </div>

                <div className="agent-chat-input telegram-composer">
                  <div
                    className={`telegram-input-shell ${dragActive ? "telegram-input-shell-active" : ""}`}
                    onDrop={handleDrop}
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                  >
                    <button
                      type="button"
                      className="telegram-icon-btn"
                      data-testid="chat-attach-btn"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingFiles}
                      title="Прикрепить файлы"
                    >
                      {"\ud83d\udcce"}
                    </button>
                    <textarea
                      data-testid="chat-input"
                      rows={2}
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      placeholder="Введите сообщение для проверки агента..."
                    />
                    <button
                      type="button"
                      className={`telegram-icon-btn ${listening ? "telegram-icon-btn-active" : ""}`}
                      data-testid="chat-voice-btn"
                      onClick={startVoiceInput}
                      title={listening ? "Остановить голосовой ввод" : "Голосовой ввод"}
                    >
                      {listening ? "\u25a0" : "\ud83c\udfa4"}
                    </button>
                    <button
                      type="button"
                      className="telegram-send-btn"
                      data-testid="chat-send-btn"
                      disabled={chatLoading || !chatInput.trim()}
                      onClick={() => void sendMessage()}
                      title="Отправить"
                    >
                      {chatLoading ? "..." : "\u27a4"}
                    </button>
                    <input
                      ref={fileInputRef}
                      data-testid="chat-file-input"
                      type="file"
                      multiple
                      hidden
                      onChange={(event) => {
                        void uploadSelectedFiles(event.target.files);
                        event.currentTarget.value = "";
                      }}
                    />
                  </div>
                  <p className="telegram-drop-hint">
                    {dragActive ? "Отпустите файлы для загрузки" : "Перетащите файлы в поле ввода или нажмите скрепку"}
                  </p>
                  <p className={`telegram-voice-state voice-${voiceState}`}>
                    {voiceState === "listening" ? "Голосовой ввод активен: слушаю..." : null}
                    {voiceState === "idle" ? "Голосовой ввод выключен" : null}
                    {voiceState === "unsupported" ? "Голосовой ввод не поддерживается браузером" : null}
                    {voiceState === "error" ? "Ошибка голосового ввода, попробуйте снова" : null}
                  </p>

                  {chatFiles.length > 0 ? (
                    <div className="chat-pending-files" data-testid="chat-pending-files">
                      {chatFiles.map((file) => (
                        <span key={file.url}>
                          <em className="chat-file-name" title={file.name}>
                            {file.name}
                          </em>
                          <button
                            type="button"
                            className="button-ghost"
                            onClick={() => setChatFiles((prev) => prev.filter((item) => item.url !== file.url))}
                          >
                            x
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {lastToolEvents.length > 0 ? (
                    <div className="chat-tool-events">
                      <strong>Вызваны инструменты:</strong>
                      <ul>
                        {lastToolEvents.map((e, idx) => (
                          <li key={`${e.toolName}-${idx}`}>
                            <span className={`chat-tool-status chat-tool-${e.status.toLowerCase()}`}>
                              {e.status === "COMPLETED" ? "✓" : "✕"}
                            </span>{" "}
                            <code>{e.toolName}</code>
                            {e.summary ? <span> — {e.summary}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {chatError ? <p style={{ color: "crimson" }}>{chatError}</p> : null}
                </div>
              </>
            ) : (
              <p style={{ color: "#6b7280" }}>Выберите агента слева, чтобы открыть тестовый чат.</p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
