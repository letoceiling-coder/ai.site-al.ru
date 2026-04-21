"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type KnowledgeBaseRow = {
  id: string;
  name: string;
  description: string | null;
  visibility: "PUBLIC" | "PRIVATE";
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

type ItemRow = {
  id: string;
  title: string;
  content: string | null;
  sourceType: "TEXT" | "URL" | "FILE";
  sourceUrl: string | null;
  status: string;
  createdAt: string;
  document: { id: string; parsingStatus: string } | null;
};

type ListResponse = { ok: boolean; data?: { knowledgeBases?: KnowledgeBaseRow[] } };
type ItemsResponse = { ok: boolean; data?: { items?: ItemRow[] } };
type OneResponse = { ok: boolean; data?: { knowledgeBase?: KnowledgeBaseRow } };

function formatDate(s: string) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    return s;
  }
  return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

export function KnowledgePageClient() {
  const [bases, setBases] = useState<KnowledgeBaseRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removingItem, setRemovingItem] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [itemTitle, setItemTitle] = useState("");
  const [itemContent, setItemContent] = useState("");

  const loadBases = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/knowledge");
    const body = (await res.json()) as ListResponse;
    if (!res.ok || !body.ok || !body.data) {
      setError((body as { error?: { message?: string } }).error?.message ?? "Не удалось загрузить базы");
      setBases([]);
      setLoading(false);
      return;
    }
    setBases((body.data.knowledgeBases ?? []) as KnowledgeBaseRow[]);
    setLoading(false);
  }, []);

  const loadItems = useCallback(async (knowledgeBaseId: string) => {
    setItemsLoading(true);
    setError(null);
    const res = await fetch(`/api/knowledge/${knowledgeBaseId}/items`);
    const body = (await res.json()) as ItemsResponse;
    if (!res.ok || !body.ok) {
      setError("Не удалось загрузить записи");
      setItemsLoading(false);
      return;
    }
    setItems(body.data?.items ?? []);
    setItemsLoading(false);
  }, []);

  useEffect(() => {
    void loadBases();
  }, [loadBases]);

  useEffect(() => {
    if (!selectedId) {
      setItems([]);
      setEditName("");
      setEditDescription("");
      return;
    }
    void (async () => {
      setError(null);
      const info = (await fetch(`/api/knowledge/${selectedId}`).then((r) => r.json())) as OneResponse;
      if (info.ok && info.data?.knowledgeBase) {
        setEditName(info.data.knowledgeBase.name);
        setEditDescription(info.data.knowledgeBase.description ?? "");
      }
      await loadItems(selectedId);
    })();
  }, [selectedId, loadItems]);

  async function onCreateBase() {
    if (!newName.trim()) {
      setError("Укажите название");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() || undefined }),
    });
    const body = (await res.json()) as { ok: boolean; error?: { message?: string } };
    if (!res.ok || !body.ok) {
      setError(body.error?.message ?? "Не удалось создать базу");
      setSaving(false);
      return;
    }
    setNewName("");
    setNewDescription("");
    await loadBases();
    setSaving(false);
  }

  async function onUpdateBase() {
    if (!selectedId || !editName.trim()) {
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/knowledge/${selectedId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName.trim(),
        description: editDescription.trim() || null,
      }),
    });
    const body = (await res.json()) as { ok: boolean; error?: { message?: string } };
    if (!res.ok || !body.ok) {
      setError(body.error?.message ?? "Не удалось сохранить");
      setSaving(false);
      return;
    }
    await loadBases();
    setSaving(false);
  }

  async function onDeleteBase(id: string) {
    if (!confirm("Удалить эту базу и все записи?")) {
      return;
    }
    setRemoving(id);
    setError(null);
    const res = await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
    const body = (await res.json()) as { ok: boolean; error?: { message?: string } };
    if (!res.ok || !body.ok) {
      setError(body.error?.message ?? "Ошибка удаления");
      setRemoving(null);
      return;
    }
    if (selectedId === id) {
      setSelectedId(null);
    }
    setRemoving(null);
    await loadBases();
  }

  async function onAddTextItem() {
    if (!selectedId || !itemTitle.trim() || !itemContent.trim()) {
      setError("Укажите заголовок и текст фрагмента");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/knowledge/${selectedId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: itemTitle.trim(), content: itemContent.trim(), sourceType: "TEXT" }),
    });
    const body = (await res.json()) as { ok: boolean; error?: { message?: string } };
    if (!res.ok || !body.ok) {
      setError(body.error?.message ?? "Не удалось добавить");
      setSaving(false);
      return;
    }
    setItemTitle("");
    setItemContent("");
    await loadBases();
    await loadItems(selectedId);
    setSaving(false);
  }

  async function onDeleteItem(id: string) {
    if (!selectedId) {
      return;
    }
    setRemovingItem(id);
    setError(null);
    const res = await fetch(`/api/knowledge/${selectedId}/items/${id}`, { method: "DELETE" });
    const body = (await res.json()) as { ok: boolean; error?: { message?: string } };
    if (!res.ok || !body.ok) {
      setError(body.error?.message ?? "Ошибка удаления");
      setRemovingItem(null);
      return;
    }
    setRemovingItem(null);
    await loadBases();
    await loadItems(selectedId);
  }

  return (
    <section className="card agents-crm" data-testid="knowledge-page">
      <div className="agents-crm-top">
        <div>
          <h1 style={{ marginBottom: 4 }}>База знаний</h1>
          <p
            className="knowledge-subtitle"
            style={{ marginTop: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.45, maxWidth: 720 }}
          >
            Создайте наборы материалов и текстовых фрагментов, затем подключите их к ассистентам в разделе{" "}
            <Link href="/assistants" className="knowledge-link">
              Ассистенты
            </Link>
            . Контекст из отмеченных баз подставляется в тестовый чат.
          </p>
        </div>
      </div>
      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}

      <div className="knowledge-layout">
        <aside className="knowledge-aside">
          <div className="agent-form agent-form--compact" style={{ marginBottom: 10 }}>
            <h3>Новая база</h3>
            <label>Название</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Например: продукт" />
            <label>Описание</label>
            <textarea
              rows={2}
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Кратко"
            />
            <div className="agent-actions" style={{ marginTop: 8 }}>
              <button type="button" disabled={saving} onClick={() => void onCreateBase()}>
                {saving ? "…" : "Создать"}
              </button>
            </div>
          </div>
          {loading ? (
            <p className="knowledge-aside-pad">Загрузка…</p>
          ) : bases.length === 0 ? (
            <p className="knowledge-aside-pad" style={{ color: "var(--muted)" }}>
              Пока нет баз. Создайте первую.
            </p>
          ) : (
            <div className="knowledge-bases-list" role="list">
              {bases.map((b) => (
                <div key={b.id} className="knowledge-base-pick" role="listitem">
                  <button
                    type="button"
                    className={selectedId === b.id ? "knowledge-base-pick-active" : ""}
                    onClick={() => setSelectedId(b.id)}
                  >
                    <span>{b.name}</span>
                    <small>
                      {b.itemCount} {b.itemCount === 1 ? "запись" : "зап."} · {formatDate(b.updatedAt)}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="button-ghost knowledge-base-del"
                    title="Удалить"
                    disabled={removing === b.id}
                    onClick={() => void onDeleteBase(b.id)}
                  >
                    {removing === b.id ? "…" : "×"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>

        <div className="knowledge-main">
          {!selectedId ? (
            <div className="knowledge-main-empty">Выберите базу слева или создайте новую.</div>
          ) : (
            <>
              <div className="agent-form agent-form--compact" style={{ marginBottom: 12 }}>
                <h3>Настройки базы</h3>
                <label>Название</label>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                <label>Описание</label>
                <textarea rows={2} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                <div className="agent-actions" style={{ marginTop: 8 }}>
                  <button type="button" disabled={saving} onClick={() => void onUpdateBase()}>
                    {saving ? "…" : "Сохранить"}
                  </button>
                </div>
              </div>
              <div className="agent-form agent-form--compact" style={{ marginBottom: 12 }}>
                <h3>Добавить текст</h3>
                <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 6px" }}>
                  Текстовые фрагменты сразу учитываются в ответах ассистента. Загрузка файлов — позже, через
                  обработку документов.
                </p>
                <label>Заголовок</label>
                <input value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} placeholder="Тема" />
                <label>Текст</label>
                <textarea
                  rows={5}
                  value={itemContent}
                  onChange={(e) => setItemContent(e.target.value)}
                  placeholder="Содержимое для подстановки в контекст"
                />
                <div className="agent-actions" style={{ marginTop: 8 }}>
                  <button type="button" disabled={saving} onClick={() => void onAddTextItem()}>
                    {saving ? "…" : "Добавить в базу"}
                  </button>
                </div>
              </div>
              <div>
                <h3 className="knowledge-items-head">Материалы</h3>
                {itemsLoading ? (
                  <p>Загрузка…</p>
                ) : items.length === 0 ? (
                  <p style={{ color: "var(--muted)", fontSize: 13 }}>Пока пусто — добавьте текст выше.</p>
                ) : (
                  <ul className="knowledge-items" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {items.map((it) => (
                      <li key={it.id} className="knowledge-item-card">
                        <div className="knowledge-item-head">
                          <strong>{it.title}</strong>
                          <span className="knowledge-item-meta">
                            {it.sourceType} · {it.status}
                            {it.document
                              ? ` · док. ${it.document.parsingStatus}`
                              : ""}
                          </span>
                        </div>
                        {it.content ? (
                          <p className="knowledge-item-content">{it.content.length > 400 ? `${it.content.slice(0, 400)}…` : it.content}</p>
                        ) : it.sourceUrl ? (
                          <p className="knowledge-item-content">{it.sourceUrl}</p>
                        ) : null}
                        <button
                          type="button"
                          className="button-ghost"
                          style={{ fontSize: 12, marginTop: 6, padding: "2px 8px" }}
                          disabled={removingItem === it.id}
                          onClick={() => void onDeleteItem(it.id)}
                        >
                          {removingItem === it.id ? "…" : "Удалить"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
