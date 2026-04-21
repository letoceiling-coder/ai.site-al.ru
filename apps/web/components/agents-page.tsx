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

type ChatMessage = {
  id: string;
  role: string;
  text: string;
  attachments: Array<{ name: string; url: string; mimeType: string; size: number }>;
  createdAt: string;
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
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceBackend, setVoiceBackend] = useState<"browser" | "provider">("browser");
  const [voiceGender, setVoiceGender] = useState<"female" | "male">("female");
  const [voiceStyle, setVoiceStyle] = useState<"neutral" | "calm" | "energetic">("neutral");
  const [listening, setListening] = useState(false);

  const allModels = useMemo(() => {
    const merged = new Set<string>();
    for (const models of Object.values(modelOptions)) {
      for (const model of models) {
        if (model.trim()) {
          merged.add(model.trim());
        }
      }
    }
    return Array.from(merged).sort((a, b) => a.localeCompare(b));
  }, [modelOptions]);

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
    const merged = new Set<string>();
    const sourceOptions = options ?? modelOptions;
    for (const models of Object.values(sourceOptions)) {
      for (const model of models) {
        if (model.trim()) {
          merged.add(model.trim());
        }
      }
    }
    const all = Array.from(merged).sort((a, b) => a.localeCompare(b));
    setDraft({
      ...emptyDraft,
      providerIntegrationId: integrationId,
      model: normalizeModel("", all),
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
          const merged = new Set<string>();
          for (const models of Object.values(nextOptions)) {
            for (const model of models) {
              if (model.trim()) {
                merged.add(model.trim());
              }
            }
          }
          const all = Array.from(merged).sort((a, b) => a.localeCompare(b));
          return all[0] ?? "";
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
    const body = (await response.json()) as {
      ok: boolean;
      data?: { dialog?: { id: string } };
      error?: { message?: string };
    };
    if (!response.ok || !body.ok || !body.data?.dialog?.id) {
      throw new Error(body.error?.message ?? "Не удалось создать чат-сессию");
    }
    setDialogId(body.data.dialog.id);
    return body.data.dialog.id;
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
    const form = new FormData();
    for (const file of Array.from(list).slice(0, 10)) {
      form.append("files", file);
    }
    const response = await fetch("/api/uploads", {
      method: "POST",
      body: form,
    });
    const body = (await response.json()) as UploadResponse;
    if (!response.ok || !body.ok || !body.data?.files) {
      setChatError(body.error?.message ?? "Не удалось загрузить файлы");
      return;
    }
    setChatFiles((prev) => [...prev, ...body.data!.files!].slice(0, 10));
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
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "ru-RU";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => setListening(true);
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.onresult = (event: any) => {
      const text = Array.from(event.results)
        .map((result: any) => String(result[0]?.transcript ?? ""))
        .join(" ");
      setChatInput((prev) => `${prev} ${text}`.trim());
    };
    recognition.start();
  }

  async function sendMessage() {
    if (!activeAgentId || !chatInput.trim()) {
      return;
    }
    setChatLoading(true);
    setChatError(null);
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
    setChatMessages([]);
    setChatFiles([]);
    setChatInput("");
    setChatError(null);
  }, [activeAgentId]);

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
                  model: normalizeModel(prev.model, allModels),
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
              {allModels.length ? (
                allModels.map((model) => (
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
            {loading ? (
              <p>Загрузка...</p>
            ) : items.length === 0 ? (
              <p>Пока нет агентов.</p>
            ) : (
              items.map((item) => (
                <article key={item.id} className="agent-item">
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
                    <span>Провайдер: {item.providerIntegration.displayName}</span>
                    <span>Модель: {item.model}</span>
                    <span>Temp: {item.temperature}</span>
                    <span>Max tokens: {item.maxTokens ?? "—"}</span>
                    <span>Обновлен: {asLocalDate(item.updatedAt)}</span>
                  </div>
                  <div className="agent-item-actions">
                    <button
                      type="button"
                      className="button-ghost"
                      onClick={() => setActiveAgentId(item.id)}
                    >
                      Тест чат
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
      )}

      <div className="agent-chat card" style={{ marginTop: 16 }}>
        <div className="agent-chat-header">
          <h3 style={{ margin: 0 }}>Тест чат агента</h3>
          <select
            value={activeAgentId ?? ""}
            onChange={(event) => setActiveAgentId(event.target.value || null)}
            style={{ maxWidth: 360 }}
          >
            <option value="">Выберите агента</option>
            {items.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} ({agent.model})
              </option>
            ))}
          </select>
        </div>
        {activeAgent ? (
          <>
            <p style={{ marginTop: 8, color: "#6b7280" }}>
              Интеграция: {activeAgent.providerIntegration.displayName} | Модель: {activeAgent.model}
            </p>
            <div className="agent-voice-controls">
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

            <div className="agent-chat-body">
              {chatMessages.length === 0 ? (
                <p style={{ color: "#6b7280" }}>Сообщений пока нет. Отправьте запрос для теста агента.</p>
              ) : (
                chatMessages.map((message) => (
                  <div key={message.id} className={`chat-bubble ${message.role === "USER" ? "chat-user" : "chat-assistant"}`}>
                    <strong>{message.role === "USER" ? "Вы" : "Агент"}</strong>
                    <p>{message.text}</p>
                    {message.attachments.length > 0 ? (
                      <div className="chat-attachments">
                        {message.attachments.map((file) => (
                          <a key={`${message.id}-${file.url}`} href={file.url} target="_blank" rel="noreferrer">
                            {file.name}
                          </a>
                        ))}
                      </div>
                    ) : null}
                    <small>{asLocalDate(message.createdAt)}</small>
                  </div>
                ))
              )}
              {chatLoading ? <p style={{ color: "#6b7280" }}>Агент печатает ответ...</p> : null}
            </div>
            <div className="agent-chat-input">
              <textarea
                rows={3}
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="Введите сообщение для проверки агента..."
              />
              <div className="agent-chat-input-actions">
                <input
                  type="file"
                  multiple
                  onChange={(event) => {
                    void uploadSelectedFiles(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
                <button type="button" disabled={chatLoading || !chatInput.trim()} onClick={() => void sendMessage()}>
                  {chatLoading ? "Отправка..." : "Отправить"}
                </button>
              </div>
              {chatFiles.length > 0 ? (
                <div className="chat-pending-files">
                  {chatFiles.map((file) => (
                    <span key={file.url}>
                      {file.name}
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
              {chatError ? <p style={{ color: "crimson" }}>{chatError}</p> : null}
            </div>
          </>
        ) : (
          <p style={{ color: "#6b7280" }}>Выберите агента для тестового чата.</p>
        )}
      </div>
    </section>
  );
}
