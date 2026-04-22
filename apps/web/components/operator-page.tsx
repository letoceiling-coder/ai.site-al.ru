"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type QueueItem = {
  dialogId: string;
  state: "queued" | "takenOver";
  reason: string | null;
  urgency: "low" | "normal" | "high" | null;
  summary: string | null;
  queuedAt: string | null;
  takenOverAt: string | null;
  takenOverByEmail: string | null;
  takenOverByYou: boolean;
  user: { id: string; email: string; name: string | null } | null;
  assistant: { id: string; name: string } | null;
  lastMessage: { role: string; preview: string; createdAt: string; isUser: boolean } | null;
  createdAt: string;
  updatedAt: string;
};

type DialogMessage = {
  id: string;
  role: string;
  text: string;
  createdAt: string;
  userId: string | null;
};

type DialogPayload = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  user: { id: string; email: string; name: string | null } | null;
  assistant: { id: string; name: string } | null;
  handoff: {
    state: "ai" | "queued" | "takenOver" | "released";
    takenOverByEmail: string | null;
    takenOverBy: string | null;
    reason?: string | null;
    urgency?: "low" | "normal" | "high" | null;
    summary?: string | null;
  };
};

function formatTime(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  } catch {
    return iso;
  }
}

function urgencyLabel(u: QueueItem["urgency"]) {
  if (u === "high") return "🔥 высокая";
  if (u === "low") return "низкая";
  if (u === "normal") return "обычная";
  return null;
}

export function OperatorPageClient() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogPayload | null>(null);
  const [messages, setMessages] = useState<DialogMessage[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [loadingDialog, setLoadingDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    try {
      const r = await fetch("/api/operator/queue", { credentials: "include" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body?.ok) {
        throw new Error(body?.error?.message || "Не удалось загрузить очередь");
      }
      setQueue(body.data?.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка очереди");
    }
  }, []);

  const loadDialog = useCallback(async (dialogId: string) => {
    setLoadingDialog(true);
    try {
      const r = await fetch(`/api/operator/dialogs/${dialogId}/messages`, { credentials: "include" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body?.ok) {
        throw new Error(body?.error?.message || "Не удалось открыть диалог");
      }
      setDialog(body.data?.dialog ?? null);
      setMessages(body.data?.messages ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка диалога");
    } finally {
      setLoadingDialog(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (selectedId) {
      void loadDialog(selectedId);
    }
  }, [selectedId, loadDialog]);

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    const connect = () => {
      if (cancelled) return;
      es = new EventSource("/api/operator/stream", { withCredentials: true });
      es.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(ev.data);
          if (data.type === "queue") {
            void loadQueue();
          } else if (data.type === "dialog-updated") {
            void loadQueue();
            if (data.dialogId === selectedId) {
              void loadDialog(data.dialogId);
            }
          } else if (data.type === "dialog-message") {
            if (data.dialogId === selectedId) {
              void loadDialog(data.dialogId);
            }
          }
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        if (cancelled) return;
        es?.close();
        setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      cancelled = true;
      es?.close();
    };
  }, [loadQueue, loadDialog, selectedId]);

  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const selected = useMemo(() => queue.find((q) => q.dialogId === selectedId) ?? null, [queue, selectedId]);
  const isMine = dialog?.handoff.state === "takenOver";
  const canSend = isMine && !sending && reply.trim().length > 0;

  const doAction = async (path: string, successMsg?: string) => {
    if (!selectedId) return;
    setActionLoading(true);
    try {
      const r = await fetch(`/api/operator/dialogs/${selectedId}/${path}`, {
        method: "POST",
        credentials: "include",
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body?.ok) {
        throw new Error(body?.error?.message || "Ошибка действия");
      }
      await loadDialog(selectedId);
      await loadQueue();
      if (successMsg) {
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка действия");
    } finally {
      setActionLoading(false);
    }
  };

  const sendReply = async () => {
    if (!selectedId || !canSend) return;
    setSending(true);
    try {
      const r = await fetch(`/api/operator/dialogs/${selectedId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: reply.trim() }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body?.ok) {
        throw new Error(body?.error?.message || "Не удалось отправить сообщение");
      }
      setReply("");
      await loadDialog(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка отправки");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="operator-page">
      <div className="operator-header">
        <div>
          <h1>Оператор</h1>
          <p className="assistants-hint">
            Диалоги, которые ассистенты передали живому оператору, и активные взятые разговоры.
          </p>
        </div>
        <div className="operator-header-actions">
          <button type="button" onClick={() => void loadQueue()} disabled={actionLoading}>
            ⟳ Обновить
          </button>
        </div>
      </div>

      {error ? <div className="assistants-error">{error}</div> : null}

      <div className="operator-layout">
        <aside className="operator-queue">
          <h3 className="operator-queue-title">
            Очередь <span>{queue.length}</span>
          </h3>
          {queue.length === 0 ? (
            <p className="assistants-hint">Пока нет активных передач оператору.</p>
          ) : (
            <ul>
              {queue.map((q) => {
                const isSelected = selectedId === q.dialogId;
                const badge =
                  q.state === "queued"
                    ? "в ожидании"
                    : q.takenOverByYou
                      ? "у вас"
                      : `у ${q.takenOverByEmail ?? "оператора"}`;
                return (
                  <li
                    key={q.dialogId}
                    className={`operator-queue-item ${isSelected ? "selected" : ""} state-${q.state}`}
                  >
                    <button type="button" onClick={() => setSelectedId(q.dialogId)}>
                      <div className="operator-queue-item-head">
                        <strong>{q.user?.email ?? "anonymous"}</strong>
                        <span className="operator-queue-badge">{badge}</span>
                      </div>
                      <div className="operator-queue-item-meta">
                        <span>{q.assistant?.name ?? "—"}</span>
                        {urgencyLabel(q.urgency) ? <span>{urgencyLabel(q.urgency)}</span> : null}
                      </div>
                      {q.reason ? <p className="operator-queue-item-reason">{q.reason}</p> : null}
                      {q.lastMessage ? (
                        <p className="operator-queue-item-preview">
                          {q.lastMessage.isUser ? "👤 " : "🤖 "}
                          {q.lastMessage.preview || "…"}
                        </p>
                      ) : null}
                      <div className="operator-queue-item-time">{formatTime(q.queuedAt ?? q.updatedAt)}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="operator-chat">
          {!selectedId ? (
            <div className="operator-chat-empty">Выберите диалог в очереди слева.</div>
          ) : loadingDialog && !dialog ? (
            <div className="operator-chat-empty">Загрузка диалога…</div>
          ) : dialog ? (
            <>
              <header className="operator-chat-head">
                <div>
                  <h3>{dialog.user?.email ?? "anonymous"}</h3>
                  <p className="assistants-hint">
                    Ассистент: {dialog.assistant?.name ?? "—"} · статус:{" "}
                    {dialog.handoff.state === "takenOver"
                      ? dialog.handoff.takenOverByEmail
                        ? `у ${dialog.handoff.takenOverByEmail}`
                        : "у оператора"
                      : dialog.handoff.state === "queued"
                        ? "в ожидании оператора"
                        : dialog.handoff.state === "released"
                          ? "вернули ассистенту"
                          : "ведёт ассистент"}
                  </p>
                </div>
                <div className="operator-chat-actions">
                  {dialog.handoff.state === "queued" ? (
                    <button
                      type="button"
                      className="operator-action-primary"
                      disabled={actionLoading}
                      onClick={() => void doAction("take")}
                    >
                      Взять диалог
                    </button>
                  ) : null}
                  {dialog.handoff.state === "takenOver" ? (
                    <>
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => void doAction("release")}
                      >
                        Вернуть ассистенту
                      </button>
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => void doAction("close")}
                      >
                        Закрыть
                      </button>
                    </>
                  ) : null}
                </div>
              </header>

              {selected?.reason || dialog.handoff.reason ? (
                <div className="operator-chat-reason">
                  <strong>Причина: </strong>
                  {selected?.reason || dialog.handoff.reason}
                  {selected?.summary || dialog.handoff.summary ? (
                    <>
                      <br />
                      <strong>Сводка: </strong>
                      {selected?.summary || dialog.handoff.summary}
                    </>
                  ) : null}
                </div>
              ) : null}

              <div className="operator-chat-messages" ref={listRef}>
                {messages.map((m) => {
                  const klass =
                    m.role === "USER"
                      ? "operator-msg user"
                      : m.userId
                        ? "operator-msg operator"
                        : "operator-msg assistant";
                  const label =
                    m.role === "USER" ? "Пользователь" : m.userId ? "Оператор" : "Ассистент";
                  return (
                    <div key={m.id} className={klass}>
                      <div className="operator-msg-label">
                        {label} · {formatTime(m.createdAt)}
                      </div>
                      <div className="operator-msg-body">{m.text}</div>
                    </div>
                  );
                })}
                {messages.length === 0 ? <div className="assistants-hint">Сообщений пока нет.</div> : null}
              </div>

              {isMine ? (
                <div className="operator-chat-input">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Напишите ответ пользователю от имени оператора…"
                    rows={3}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        void sendReply();
                      }
                    }}
                  />
                  <button type="button" onClick={() => void sendReply()} disabled={!canSend}>
                    Отправить (Ctrl+Enter)
                  </button>
                </div>
              ) : dialog.handoff.state === "queued" ? (
                <div className="operator-chat-cta">
                  Нажмите «Взять диалог», чтобы перехватить разговор у ассистента.
                </div>
              ) : (
                <div className="operator-chat-cta">Диалог сейчас не активен для оператора.</div>
              )}
            </>
          ) : (
            <div className="operator-chat-empty">Диалог не найден или недоступен.</div>
          )}
        </section>
      </div>
    </div>
  );
}
