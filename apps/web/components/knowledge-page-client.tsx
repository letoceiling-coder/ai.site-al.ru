"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";

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
  document: { id: string; parsingStatus: string; _count?: { chunks: number } } | null;
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

function chunkCount(it: ItemRow) {
  return it.document?._count?.chunks ?? 0;
}

export function KnowledgePageClient() {
  const [bases, setBases] = useState<KnowledgeBaseRow[]>([]);
  const [kbQuery, setKbQuery] = useState("");
  const [debouncedKbQuery, setDebouncedKbQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [itemQuery, setItemQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removingItem, setRemovingItem] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [addTab, setAddTab] = useState<"text" | "file" | "url">("file");
  const [itemTitle, setItemTitle] = useState("");
  const [itemContent, setItemContent] = useState("");
  const [urlTitle, setUrlTitle] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [dragFile, setDragFile] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedKbQuery(kbQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [kbQuery]);

  const loadBases = useCallback(async () => {
    setLoading(true);
    setError(null);
    const qs = debouncedKbQuery ? `?q=${encodeURIComponent(debouncedKbQuery)}` : "";
    const res = await fetch(`/api/knowledge${qs}`);
    const body = (await res.json()) as ListResponse;
    if (!res.ok || !body.ok || !body.data) {
      setError((body as { error?: { message?: string } }).error?.message ?? "Не удалось загрузить базы");
      setBases([]);
      setLoading(false);
      return;
    }
    setBases((body.data.knowledgeBases ?? []) as KnowledgeBaseRow[]);
    setLoading(false);
  }, [debouncedKbQuery]);

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

  const filteredItems = useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    if (!q) {
      return items;
    }
    return items.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        (it.content?.toLowerCase().includes(q) ?? false) ||
        (it.sourceUrl?.toLowerCase().includes(q) ?? false),
    );
  }, [items, itemQuery]);

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
    const body = (await res.json()) as { ok: boolean; error?: { message?: string }; data?: { knowledgeBase?: { id: string } } };
    if (!res.ok || !body.ok) {
      setError(body.error?.message ?? "Не удалось создать базу");
      setSaving(false);
      return;
    }
    setNewName("");
    setNewDescription("");
    setCreateOpen(false);
    await loadBases();
    const nid = body.data?.knowledgeBase?.id;
    if (nid) {
      setSelectedId(nid);
    }
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
      setError("Укажите заголовок и текст");
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

  async function onAddUrlItem() {
    if (!selectedId || !urlTitle.trim() || !urlValue.trim()) {
      setError("Укажите название и URL");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/knowledge/${selectedId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: urlTitle.trim(), sourceType: "URL", sourceUrl: urlValue.trim() }),
    });
    const body = (await res.json()) as { ok: boolean; error?: { message?: string } };
    if (!res.ok || !body.ok) {
      setError(body.error?.message ?? "Не удалось добавить ссылку");
      setSaving(false);
      return;
    }
    setUrlTitle("");
    setUrlValue("");
    await loadBases();
    await loadItems(selectedId);
    setSaving(false);
  }

  async function ingestUploadedFiles(uploaded: Array<{ name: string; url: string; mimeType: string; size: number }>) {
    if (!selectedId || uploaded.length === 0) {
      return;
    }
    setFileBusy(true);
    setError(null);
    const res = await fetch(`/api/knowledge/${selectedId}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ files: uploaded }),
    });
    const body = (await res.json()) as {
      ok: boolean;
      data?: { created?: number; errors?: string[] };
      error?: { message?: string };
    };
    if (!res.ok || !body.ok) {
      setError(body.error?.message ?? "Ошибка импорта файлов");
      setFileBusy(false);
      return;
    }
    const errs = body.data?.errors ?? [];
    if (errs.length) {
      setError(`Частично: ${errs.join(" · ")}`);
    }
    await loadBases();
    await loadItems(selectedId);
    setFileBusy(false);
  }

  async function uploadFilesList(list: FileList | null) {
    if (!list?.length || !selectedId) {
      return;
    }
    const form = new FormData();
    for (const f of Array.from(list).slice(0, 6)) {
      form.append("files", f);
    }
    setFileBusy(true);
    setError(null);
    const res = await fetch("/api/uploads", { method: "POST", credentials: "include", body: form });
    const body = (await res.json()) as {
      ok: boolean;
      data?: { files?: Array<{ name: string; url: string; mimeType: string; size: number }> };
      error?: { message?: string };
    };
    if (!res.ok || !body.ok || !body.data?.files?.length) {
      setError(body.error?.message ?? "Загрузка не удалась");
      setFileBusy(false);
      return;
    }
    await ingestUploadedFiles(body.data.files);
  }

  function onDrag(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragFile(true);
    } else {
      setDragFile(false);
    }
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

  const selected = bases.find((b) => b.id === selectedId);

  return (
    <section className="card agents-crm knowledge-studio" data-testid="knowledge-page">
      <div className="knowledge-studio-header">
        <div>
          <h1 className="knowledge-studio-title">База знаний</h1>
          <p className="knowledge-studio-lead">
            Управление наборами для RAG: файлы разбиваются на фрагменты (чанки), текст и ссылки попадают в контекст
            ассистента. Подключение — в{" "}
            <Link href="/assistants" className="knowledge-link">
              Ассистенты
            </Link>
            .
          </p>
        </div>
      </div>
      {error ? <div className="knowledge-banner-error">{error}</div> : null}

      <div className="knowledge-studio-grid">
        <aside className="knowledge-studio-sidebar">
          <div className="knowledge-sidebar-toolbar">
            <input
              className="knowledge-search"
              type="search"
              placeholder="Поиск баз…"
              value={kbQuery}
              onChange={(e) => setKbQuery(e.target.value)}
              aria-label="Поиск баз знаний"
            />
            <button type="button" className="knowledge-btn-new" onClick={() => setCreateOpen((v) => !v)}>
              {createOpen ? "−" : "+"} Новая
            </button>
          </div>
          {createOpen ? (
            <div className="knowledge-create-panel">
              <label>Название</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Например: Продукт" />
              <label>Описание</label>
              <textarea rows={2} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
              <div className="knowledge-inline-actions">
                <button type="button" className="knowledge-btn-primary" disabled={saving} onClick={() => void onCreateBase()}>
                  {saving ? "…" : "Создать"}
                </button>
                <button type="button" className="button-ghost" onClick={() => setCreateOpen(false)}>
                  Отмена
                </button>
              </div>
            </div>
          ) : null}
          <div className="knowledge-base-list-scroll">
            {loading ? (
              <p className="knowledge-muted-pad">Загрузка…</p>
            ) : bases.length === 0 ? (
              <p className="knowledge-muted-pad">Нет баз. Создайте первую кнопкой «+ Новая».</p>
            ) : (
              bases.map((b) => (
                <div key={b.id} className={`knowledge-base-row ${selectedId === b.id ? "knowledge-base-row-active" : ""}`}>
                  <button type="button" className="knowledge-base-row-main" onClick={() => setSelectedId(b.id)}>
                    <span className="knowledge-base-row-name">{b.name}</span>
                    <span className="knowledge-base-row-meta">
                      {b.itemCount} матер. · {formatDate(b.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="knowledge-base-row-del"
                    title="Удалить"
                    disabled={removing === b.id}
                    onClick={() => void onDeleteBase(b.id)}
                  >
                    {removing === b.id ? "…" : "×"}
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        <main className="knowledge-studio-main">
          {!selectedId ? (
            <div className="knowledge-empty-workspace">
              <p>Выберите базу слева или создайте новую.</p>
              <details className="knowledge-automation">
                <summary>Автоматизация и лучшие практики</summary>
                <ul>
                  <li>
                    <strong>Массовый импорт:</strong> перетащите несколько PDF/DOCX/TXT — сервер извлечёт текст и создаст
                    чанки для поиска в диалоге.
                  </li>
                  <li>
                    <strong>Синхронизация:</strong> позже — webhook или cron, который по расписанию подтягивает
                    страницы из Confluence/Notion и обновляет базу.
                  </li>
                  <li>
                    <strong>Конвейер:</strong> очередь воркеров для OCR сканов, транскрибации аудио и векторного
                    индекса (pgvector / отдельный search-сервис).
                  </li>
                  <li>
                    <strong>Качество RAG:</strong> держите фрагменты тематически однородными; для юридических текстов —
                    отдельная база и отдельный ассистент.
                  </li>
                </ul>
              </details>
            </div>
          ) : (
            <>
              <header className="knowledge-workspace-head">
                <div>
                  <h2 className="knowledge-workspace-title">{selected?.name ?? "База"}</h2>
                  <p className="knowledge-workspace-sub">{selected?.description || "Без описания"}</p>
                </div>
                <div className="knowledge-workspace-stats">
                  <span className="knowledge-stat-pill">{selected?.itemCount ?? 0} материалов</span>
                </div>
              </header>

              <div className="knowledge-workspace-split">
                <section className="knowledge-panel">
                  <div className="knowledge-panel-head">
                    <h3>Настройки</h3>
                  </div>
                  <label>Название</label>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <label>Описание</label>
                  <textarea rows={2} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                  <button type="button" className="knowledge-btn-primary knowledge-btn-sm" disabled={saving} onClick={() => void onUpdateBase()}>
                    {saving ? "…" : "Сохранить"}
                  </button>
                </section>

                <section className="knowledge-panel knowledge-panel-wide">
                  <div className="knowledge-tabs">
                    <button type="button" className={addTab === "file" ? "knowledge-tab-active" : "button-ghost"} onClick={() => setAddTab("file")}>
                      Файлы → RAG
                    </button>
                    <button type="button" className={addTab === "text" ? "knowledge-tab-active" : "button-ghost"} onClick={() => setAddTab("text")}>
                      Текст
                    </button>
                    <button type="button" className={addTab === "url" ? "knowledge-tab-active" : "button-ghost"} onClick={() => setAddTab("url")}>
                      URL
                    </button>
                  </div>

                  {addTab === "file" ? (
                    <div
                      className={`knowledge-dropzone ${dragFile ? "knowledge-dropzone-active" : ""}`}
                      onDragEnter={onDrag}
                      onDragOver={onDrag}
                      onDragLeave={onDrag}
                      onDrop={(e) => {
                        onDrag(e);
                        void uploadFilesList(e.dataTransfer.files);
                      }}
                    >
                      <p>
                        <strong>Перетащите файлы</strong> или выберите с диска (до 6 за раз). Поддерживаются PDF, DOCX,
                        TXT, MD, JSON, CSV (до 10 МБ).
                      </p>
                      <input ref={fileRef} type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.csv,.json" onChange={(e) => void uploadFilesList(e.target.files)} />
                      <button type="button" className="knowledge-btn-secondary" disabled={fileBusy} onClick={() => fileRef.current?.click()}>
                        {fileBusy ? "Обработка…" : "Выбрать файлы"}
                      </button>
                    </div>
                  ) : null}

                  {addTab === "text" ? (
                    <div className="knowledge-add-text">
                      <label>Заголовок</label>
                      <input value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} placeholder="Тема" />
                      <label>Текст</label>
                      <textarea rows={5} value={itemContent} onChange={(e) => setItemContent(e.target.value)} placeholder="Полный текст фрагмента" />
                      <button type="button" className="knowledge-btn-primary knowledge-btn-sm" disabled={saving} onClick={() => void onAddTextItem()}>
                        {saving ? "…" : "Добавить"}
                      </button>
                    </div>
                  ) : null}

                  {addTab === "url" ? (
                    <div className="knowledge-add-url">
                      <p className="knowledge-hint">Ссылка сохраняется как ориентир; авто-скрейпинг можно добавить отдельно.</p>
                      <label>Заголовок</label>
                      <input value={urlTitle} onChange={(e) => setUrlTitle(e.target.value)} />
                      <label>URL</label>
                      <input value={urlValue} onChange={(e) => setUrlValue(e.target.value)} placeholder="https://…" />
                      <button type="button" className="knowledge-btn-primary knowledge-btn-sm" disabled={saving} onClick={() => void onAddUrlItem()}>
                        {saving ? "…" : "Добавить"}
                      </button>
                    </div>
                  ) : null}
                </section>
              </div>

              <section className="knowledge-materials">
                <div className="knowledge-materials-head">
                  <h3>Материалы</h3>
                  <input
                    className="knowledge-search knowledge-search-inline"
                    type="search"
                    placeholder="Фильтр по названию или тексту…"
                    value={itemQuery}
                    onChange={(e) => setItemQuery(e.target.value)}
                  />
                </div>
                {itemsLoading ? (
                  <p className="knowledge-muted-pad">Загрузка…</p>
                ) : filteredItems.length === 0 ? (
                  <p className="knowledge-muted-pad">Нет записей — загрузите файлы или добавьте текст.</p>
                ) : (
                  <div className="knowledge-table-wrap">
                    <table className="knowledge-table">
                      <thead>
                        <tr>
                          <th>Тип</th>
                          <th>Название</th>
                          <th>Чанки</th>
                          <th>Статус</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredItems.map((it) => (
                          <tr key={it.id}>
                            <td>
                              <span className="knowledge-type-badge">{it.sourceType}</span>
                            </td>
                            <td className="knowledge-td-title">{it.title}</td>
                            <td>{chunkCount(it) || "—"}</td>
                            <td>
                              <span className="knowledge-status">{it.status}</span>
                              {it.document ? <small className="knowledge-doc-status"> {it.document.parsingStatus}</small> : null}
                            </td>
                            <td className="knowledge-td-actions">
                              <button type="button" className="button-ghost" disabled={removingItem === it.id} onClick={() => void onDeleteItem(it.id)}>
                                {removingItem === it.id ? "…" : "Удалить"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </section>
  );
}
