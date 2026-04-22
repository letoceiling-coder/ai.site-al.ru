"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { CitationText, CitationsList, type ChatCitation } from "@/components/chat-citations";

type ChatMessage = {
  id: string;
  role: string;
  text: string;
  attachments: Array<{ name: string; url: string; mimeType: string; size: number }>;
  createdAt: string;
  citations?: ChatCitation[];
};

type ChatSession = { id: string; status: string; createdAt: string; updatedAt: string };

type UploadResponse = {
  ok: boolean;
  data?: { files?: Array<{ name: string; url: string; mimeType: string; size: number }> };
  error?: { message?: string };
};

type Props = {
  assistantId: string;
  assistantName: string;
};

function asLocalDate(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return value;
  }
  return dt.toLocaleString("ru-RU");
}

export function AssistantTestChatPanel({ assistantId, assistantName }: Props) {
  const [dialogId, setDialogId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatFiles, setChatFiles] = useState<Array<{ name: string; url: string; mimeType: string; size: number }>>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [greeting, setGreeting] = useState<{ welcomeMessage: string | null; quickReplies: string[] } | null>(null);
  const [lastToolEvents, setLastToolEvents] = useState<
    Array<{ toolName: string; status: string; summary: string }>
  >([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadSessions = useCallback(async (preferredId?: string) => {
    setSessionsLoading(true);
    const res = await fetch(`/api/assistants/${assistantId}/chat/sessions`);
    const body = (await res.json()) as {
      ok: boolean;
      data?: {
        sessions?: ChatSession[];
        greeting?: { welcomeMessage: string | null; quickReplies: string[] };
      };
      error?: { message?: string };
    };
    if (!res.ok || !body.ok) {
      setChatError(body.error?.message ?? "Не удалось загрузить сессии");
      setSessionsLoading(false);
      return;
    }
    const sessions = body.data?.sessions ?? [];
    setChatSessions(sessions);
    if (body.data?.greeting) {
      setGreeting(body.data.greeting);
    }
    const nextId = preferredId ?? sessions[0]?.id ?? null;
    setDialogId(nextId);
    if (nextId) {
      const mr = await fetch(
        `/api/assistants/${assistantId}/chat/messages?dialogId=${encodeURIComponent(nextId)}`,
      );
      const mb = (await mr.json()) as {
        ok: boolean;
        data?: {
          messages?: ChatMessage[];
          greeting?: { welcomeMessage: string | null; quickReplies: string[] };
        };
        error?: { message?: string };
      };
      if (mr.ok && mb.ok && mb.data?.messages) {
        setChatMessages(mb.data.messages);
        if (mb.data.greeting) {
          setGreeting(mb.data.greeting);
        }
      } else {
        setChatMessages([]);
      }
    } else {
      setChatMessages([]);
    }
    setSessionsLoading(false);
  }, [assistantId]);

  useEffect(() => {
    setDialogId(null);
    setChatMessages([]);
    setChatInput("");
    setChatFiles([]);
    setChatError(null);
    void loadSessions();
  }, [assistantId, loadSessions]);

  async function createSession() {
    setChatError(null);
    const res = await fetch(`/api/assistants/${assistantId}/chat/sessions`, { method: "POST" });
    const body = (await res.json()) as { ok: boolean; data?: { dialog?: { id: string } }; error?: { message?: string } };
    if (!res.ok || !body.ok || !body.data?.dialog?.id) {
      setChatError(body.error?.message ?? "Не удалось создать сессию");
      return;
    }
    const newId = body.data.dialog.id;
    const now = new Date().toISOString();
    setChatSessions((p) => [{ id: newId, status: "OPEN", createdAt: now, updatedAt: now }, ...p]);
    setDialogId(newId);
    setChatMessages([]);
  }

  async function loadMessagesForDialog(did: string) {
    setDialogId(did);
    const mr = await fetch(
      `/api/assistants/${assistantId}/chat/messages?dialogId=${encodeURIComponent(did)}`,
    );
    const mb = (await mr.json()) as { ok: boolean; data?: { messages?: ChatMessage[] }; error?: { message?: string } };
    if (mr.ok && mb.ok && mb.data?.messages) {
      setChatMessages(mb.data.messages);
    } else {
      setChatError(mb.error?.message ?? "Нет сообщений");
    }
  }

  async function uploadFiles(list: FileList | null) {
    if (!list?.length) {
      return;
    }
    setUploadingFiles(true);
    setChatError(null);
    const form = new FormData();
    for (const f of Array.from(list).slice(0, 10)) {
      form.append("files", f);
    }
    const res = await fetch("/api/uploads", { method: "POST", credentials: "include", body: form });
    const body = (await res.json()) as UploadResponse;
    const filesList = body.data?.files;
    if (!res.ok || !body.ok || !filesList) {
      setChatError(body.error?.message ?? "Ошибка загрузки");
      setUploadingFiles(false);
      return;
    }
    setChatFiles((p) => [...p, ...filesList].slice(0, 10));
    setUploadingFiles(false);
  }

  async function sendMessage() {
    if (!chatInput.trim() || !assistantId) {
      return;
    }
    setChatLoading(true);
    setChatError(null);
    const text = chatInput.trim();
    const files = [...chatFiles];
    const uLocal = `u-${Date.now()}`;
    const aLocal = `a-${Date.now()}`;
    const now = new Date().toISOString();
    setChatMessages((p) => [
      ...p,
      { id: uLocal, role: "USER", text, attachments: files, createdAt: now },
      { id: aLocal, role: "ASSISTANT", text: "", attachments: [], createdAt: now },
    ]);
    setChatInput("");
    setChatFiles([]);
    setLastToolEvents([]);

    const res = await fetch(`/api/assistants/${assistantId}/chat/messages/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        dialogId: dialogId ?? undefined,
        text,
        attachments: files,
      }),
    });
    if (!res.ok || !res.body) {
      setChatError("Не удалось начать ответ");
      setChatLoading(false);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalText = "";
    let metaDialog: string | null = dialogId;
    try {
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
            .find((l) => l.startsWith("data:"))
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
            metaDialog = payload.dialogId;
            setDialogId(payload.dialogId);
          } else if (payload.type === "token") {
            finalText = payload.text ?? finalText;
            setChatMessages((prev) =>
              prev.map((m) => (m.id === aLocal ? { ...m, text: finalText } : m)),
            );
          } else if (payload.type === "citations" && Array.isArray(payload.citations)) {
            const cits = payload.citations;
            setChatMessages((prev) =>
              prev.map((m) => (m.id === aLocal ? { ...m, citations: cits } : m)),
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
            finalText = payload.text ?? finalText;
          } else if (payload.type === "error") {
            throw new Error(payload.message ?? "Ошибка в streaming");
          }
        }
      }
      if (metaDialog) {
        const mr = await fetch(
          `/api/assistants/${assistantId}/chat/messages?dialogId=${encodeURIComponent(metaDialog)}`,
        );
        const mb = (await mr.json()) as { ok: boolean; data?: { messages?: ChatMessage[] } };
        if (mr.ok && mb.ok && mb.data?.messages) {
          setChatMessages(mb.data.messages);
        }
        void loadSessions(metaDialog);
      }
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setChatLoading(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    void uploadFiles(e.dataTransfer.files);
  }
  function handleDrag(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else {
      setDragActive(false);
    }
  }

  return (
    <div className="crm-chat-main">
      <div className="agent-chat-header" style={{ flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Тест: {assistantName}</h3>
        <span className="crm-agent-badge">Ассистент</span>
      </div>
      <div className="crm-chat-side-inline">
        <div className="crm-panel-head">
          <strong>Сессии</strong>
          <button type="button" className="button-ghost" onClick={() => void createSession()}>
            Новый чат
          </button>
        </div>
        <div className="crm-panel-list">
          {sessionsLoading ? <small>Загрузка…</small> : null}
          {!sessionsLoading && chatSessions.length === 0 ? <small>Нет сессий</small> : null}
          {chatSessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`crm-session-pick ${dialogId === s.id ? "crm-session-pick-active" : ""}`}
              onClick={() => void loadMessagesForDialog(s.id)}
            >
              <span>Чат {s.id.slice(-6)}</span>
              <small>{asLocalDate(s.updatedAt)}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="agent-chat-body telegram-chat-body" style={{ minHeight: 200 }}>
        {chatMessages.length === 0 && greeting?.welcomeMessage ? (
          <div className="telegram-row telegram-row-assistant">
            <div className="chat-bubble telegram-bubble chat-assistant">
              <p>{greeting.welcomeMessage}</p>
            </div>
          </div>
        ) : null}
        {chatMessages.length === 0 && !greeting?.welcomeMessage ? (
          <p style={{ color: "var(--muted)" }}>Напишите сообщение для проверки ассистента.</p>
        ) : null}
        {chatMessages.map((m) => (
          <div
            key={m.id}
            className={`telegram-row ${m.role === "USER" ? "telegram-row-user" : "telegram-row-assistant"}`}
          >
            <div className={`chat-bubble telegram-bubble ${m.role === "USER" ? "chat-user" : "chat-assistant"}`}>
              <p>
                <CitationText text={m.text} citations={m.citations} />
              </p>
              {m.attachments.length > 0 ? (
                <div className="chat-attachments">
                  {m.attachments.map((f) => (
                    <a key={f.url} href={f.url} target="_blank" rel="noreferrer">
                      {f.name}
                    </a>
                  ))}
                </div>
              ) : null}
              {m.role !== "USER" ? <CitationsList citations={m.citations} /> : null}
              <small>{asLocalDate(m.createdAt)}</small>
            </div>
          </div>
        ))}
        {chatLoading ? <p style={{ color: "var(--muted)" }}>Ассистент печатает…</p> : null}
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
      </div>
      {chatMessages.length === 0 && greeting?.quickReplies && greeting.quickReplies.length > 0 ? (
        <div className="assistant-quick-replies">
          {greeting.quickReplies.map((reply) => (
            <button
              key={reply}
              type="button"
              className="assistant-quick-reply"
              onClick={() => setChatInput(reply)}
              disabled={chatLoading}
            >
              {reply}
            </button>
          ))}
        </div>
      ) : null}
      {chatFiles.length > 0 ? (
        <div className="chat-pending-files">
          {chatFiles.map((f) => (
            <span key={f.url}>
              <em className="chat-file-name" title={f.name}>
                {f.name}
              </em>
              <button
                type="button"
                className="button-ghost"
                onClick={() => setChatFiles((p) => p.filter((x) => x.url !== f.url))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
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
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingFiles}
            title="Прикрепить файлы"
          >
            {"\u{1F4CE}"}
          </button>
          <textarea
            data-testid="assistant-chat-input"
            rows={2}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Сообщение ассистенту…"
          />
          <button
            type="button"
            className="telegram-send-btn"
            disabled={chatLoading || !chatInput.trim()}
            onClick={() => void sendMessage()}
            title="Отправить"
          >
            {chatLoading ? "…" : "➤"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void uploadFiles(e.target.files);
              e.currentTarget.value = "";
            }}
          />
        </div>
        <p className="telegram-drop-hint">
          {dragActive ? "Отпустите файлы" : "Перетащите файлы в поле или нажмите скрепку"}
        </p>
      </div>
      {chatError ? <p style={{ color: "var(--danger)" }}>{chatError}</p> : null}
    </div>
  );
}
