"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";

type KnowledgeSettings = {
  chunkSize: number;
  chunkOverlap: number;
  grounding: "strict" | "mixed";
  autoTitle: boolean;
  maxContextChars: number;
  template?: string;
};

type KnowledgeBaseRow = {
  id: string;
  name: string;
  description: string | null;
  visibility: "PUBLIC" | "PRIVATE";
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  settings?: KnowledgeSettings;
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

type TemplatePreset = {
  code: string;
  title: string;
  subtitle: string;
  recommendedFor: string;
  defaultName: string;
  defaultDescription: string;
  defaultTab: "file" | "text" | "url" | "batch";
};

const TEMPLATES: TemplatePreset[] = [
  {
    code: "blank",
    title: "Пустая база",
    subtitle: "Начать с нуля — вы сами загружаете файлы/текст/URL.",
    recommendedFor: "Универсально, если у вас уже есть набор материалов.",
    defaultName: "Новая база знаний",
    defaultDescription: "",
    defaultTab: "file",
  },
  {
    code: "faq",
    title: "FAQ и ответы",
    subtitle: "Короткие вопросы-ответы, небольшие чанки.",
    recommendedFor: "Поддержка клиентов, типовые обращения, скрипты менеджеров.",
    defaultName: "FAQ",
    defaultDescription: "Частые вопросы клиентов и подготовленные ответы.",
    defaultTab: "text",
  },
  {
    code: "docs",
    title: "Документация продукта",
    subtitle: "Среднего размера разделы руководства.",
    recommendedFor: "Гайды, справка, мануалы, technical docs.",
    defaultName: "Документация",
    defaultDescription: "Разделы руководства по продукту.",
    defaultTab: "file",
  },
  {
    code: "policy",
    title: "Регламенты и политики",
    subtitle: "Крупные фрагменты, строгий режим без домыслов.",
    recommendedFor: "Юридические тексты, внутренние регламенты, инструкции.",
    defaultName: "Регламенты",
    defaultDescription: "Внутренние регламенты и политики компании.",
    defaultTab: "file",
  },
  {
    code: "marketing",
    title: "Маркетинг и контент",
    subtitle: "Смешанный режим: база + общие знания модели.",
    recommendedFor: "Описания продукта, УТП, контент для сайта/рассылок.",
    defaultName: "Маркетинговые материалы",
    defaultDescription: "Тексты для сайта, УТП, рекламные описания.",
    defaultTab: "url",
  },
];

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
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removingItem, setRemovingItem] = useState<string | null>(null);
  const [reingesting, setReingesting] = useState<string | null>(null);

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const [wizardTemplate, setWizardTemplate] = useState<TemplatePreset>(TEMPLATES[0]!);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  // Editing selected base
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSettings, setEditSettings] = useState<KnowledgeSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Add content tabs
  const [addTab, setAddTab] = useState<"file" | "text" | "url" | "batch">("file");
  const [itemTitle, setItemTitle] = useState("");
  const [itemContent, setItemContent] = useState("");
  const [urlTitle, setUrlTitle] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [batchUrls, setBatchUrls] = useState("");
  const [batchSitemap, setBatchSitemap] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [dragFile, setDragFile] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // AI suggest
  const [suggestCards, setSuggestCards] = useState<{ title: string; content: string }[]>([]);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestNotice, setSuggestNotice] = useState<string | null>(null);

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
      setEditSettings(null);
      return;
    }
    void (async () => {
      setError(null);
      const info = (await fetch(`/api/knowledge/${selectedId}`).then((r) => r.json())) as OneResponse;
      if (info.ok && info.data?.knowledgeBase) {
        setEditName(info.data.knowledgeBase.name);
        setEditDescription(info.data.knowledgeBase.description ?? "");
        setEditSettings(info.data.knowledgeBase.settings ?? null);
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

  function openWizard() {
    setWizardTemplate(TEMPLATES[0]!);
    setNewName("");
    setNewDescription("");
    setWizardStep(1);
    setWizardOpen(true);
  }

  function pickTemplate(code: string) {
    const t = TEMPLATES.find((x) => x.code === code) ?? TEMPLATES[0]!;
    setWizardTemplate(t);
    if (!newName.trim()) {
      setNewName(t.defaultName);
    }
    if (!newDescription.trim()) {
      setNewDescription(t.defaultDescription);
    }
    setWizardStep(2);
  }

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
      body: JSON.stringify({
        name: newName.trim(),
        description: newDescription.trim() || undefined,
        template: wizardTemplate.code,
      }),
    });
    const body = (await res.json()) as {
      ok: boolean;
      error?: { message?: string };
      data?: { knowledgeBase?: { id: string } };
    };
    if (!res.ok || !body.ok) {
      setError(body.error?.message ?? "Не удалось создать базу");
      setSaving(false);
      return;
    }
    setWizardOpen(false);
    await loadBases();
    const nid = body.data?.knowledgeBase?.id;
    if (nid) {
      setSelectedId(nid);
      setAddTab(wizardTemplate.defaultTab);
      setNotice(`База «${newName.trim()}» создана. Добавьте материалы во вкладке ниже.`);
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
        settings: editSettings ?? undefined,
      }),
    });
    const body = (await res.json()) as { ok: boolean; error?: { message?: string } };
    if (!res.ok || !body.ok) {
      setError(body.error?.message ?? "Не удалось сохранить");
      setSaving(false);
      return;
    }
    await loadBases();
    setNotice("Настройки сохранены");
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
    if (!selectedId || !itemContent.trim()) {
      setError("Введите текст");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/knowledge/${selectedId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: itemTitle.trim() || undefined,
        content: itemContent.trim(),
        sourceType: "TEXT",
      }),
    });
    const body = (await res.json()) as {
      ok: boolean;
      data?: { duplicate?: { existingItemId: string; existingTitle: string; sourceType: string } };
      error?: { message?: string };
    };
    if (!res.ok || !body.ok) {
      setError(body.error?.message ?? "Не удалось добавить");
      setSaving(false);
      return;
    }
    if (body.data?.duplicate) {
      setNotice(
        `Такой же материал уже есть в этой базе: «${body.data.duplicate.existingTitle}». Создание дубликата пропущено.`,
      );
    } else {
      setNotice(null);
    }
    setItemTitle("");
    setItemContent("");
    await loadBases();
    await loadItems(selectedId);
    setSaving(false);
  }

  async function onSuggestSplit() {
    if (!selectedId || itemContent.trim().length < 80) {
      setError("Вставьте черновик в поле «Текст» (от ~80 символов) и нажмите снова");
      return;
    }
    setSuggestBusy(true);
    setError(null);
    setSuggestNotice(null);
    setSuggestCards([]);
    const res = await fetch(`/api/knowledge/${selectedId}/suggest-split`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText: itemContent.trim() }),
    });
    const body = (await res.json()) as {
      ok: boolean;
      data?: { cards?: { title: string; content: string }[]; notice?: string };
      error?: { message?: string };
    };
    if (!res.ok || !body.ok) {
      setError(body.error?.message ?? "ИИ-подсказка недоступна");
      setSuggestBusy(false);
      return;
    }
    const cards = body.data?.cards ?? [];
    setSuggestCards(cards);
    setSuggestNotice(body.data?.notice ?? null);
    setSuggestBusy(false);
  }

  async function onAddUrlItem() {
    if (!selectedId || !urlValue.trim()) {
      setError("Укажите URL");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/knowledge/${selectedId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: urlTitle.trim() || undefined,
        sourceType: "URL",
        sourceUrl: urlValue.trim(),
      }),
    });
    const body = (await res.json()) as {
      ok: boolean;
      error?: { message?: string };
      data?: { urlIngest?: { ok: boolean; message?: string } };
    };
    if (!res.ok || !body.ok) {
      setError(body.error?.message ?? "Не удалось добавить ссылку");
      setSaving(false);
      return;
    }
    if (body.data?.urlIngest && !body.data.urlIngest.ok) {
      setError(body.data.urlIngest.message ?? "Страница не загружена — запись сохранена со статусом FAILED");
    } else {
      setNotice("Страница загружена и разбита на чанки");
    }
    setUrlTitle("");
    setUrlValue("");
    await loadBases();
    await loadItems(selectedId);
    setSaving(false);
  }

  async function onBatchImport() {
    if (!selectedId) return;
    const urls = batchUrls
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (urls.length === 0 && !batchSitemap.trim()) {
      setError("Укажите список URL (по одному на строку) или адрес sitemap.xml");
      return;
    }
    setBatchBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/knowledge/${selectedId}/urls/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        urls,
        sitemap: batchSitemap.trim() || undefined,
      }),
    });
    const body = (await res.json()) as {
      ok: boolean;
      error?: { message?: string };
      data?: {
        total: number;
        created: number;
        failed: number;
        duplicates?: number;
        results?: Array<{ ok: boolean; url: string; duplicate?: boolean; message?: string }>;
      };
    };
    if (!res.ok || !body.ok) {
      setError(body.error?.message ?? "Пакетный импорт не удался");
      setBatchBusy(false);
      return;
    }
    const d = body.data!;
    const dupPart = d.duplicates && d.duplicates > 0 ? `, дубликатов ${d.duplicates}` : "";
    setNotice(`Импорт: успешно ${d.created}${dupPart}, с ошибками ${d.failed} из ${d.total}.`);
    if (d.failed > 0 && d.results) {
      const fails = d.results.filter((r) => !r.ok).slice(0, 5).map((r) => `${r.url}: ${r.message ?? "ошибка"}`).join(" · ");
      if (fails) setError(`Ошибки: ${fails}`);
    }
    setBatchUrls("");
    setBatchSitemap("");
    await loadBases();
    await loadItems(selectedId);
    setBatchBusy(false);
  }

  async function onReembed() {
    if (!selectedId) return;
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/knowledge/${selectedId}/reembed`, { method: "POST" });
    const body = (await res.json()) as {
      ok: boolean;
      error?: { message?: string };
      data?: { queued: number; totalDocuments: number; missing?: number; message?: string };
    };
    if (!res.ok || !body.ok) {
      setError(body.error?.message ?? "Не удалось поставить пересчёт эмбеддингов");
      return;
    }
    const d = body.data!;
    if (d.queued === 0) {
      setNotice(d.message ?? "Все эмбеддинги уже есть");
    } else {
      setNotice(`В очередь поставлено ${d.queued} документов (не хватает ${d.missing ?? "—"} векторов). Воркер обработает в фоне.`);
    }
  }

  async function onReingestItem(id: string) {
    if (!selectedId) return;
    setReingesting(id);
    setError(null);
    const res = await fetch(`/api/knowledge/${selectedId}/items/${id}/reingest`, { method: "POST" });
    const body = (await res.json()) as {
      ok: boolean;
      error?: { message?: string };
      data?: { urlIngest?: { ok: boolean; message?: string } };
    };
    if (!res.ok || !body.ok) {
      setError(body.error?.message ?? "Не удалось переиндексировать");
      setReingesting(null);
      return;
    }
    if (body.data?.urlIngest && !body.data.urlIngest.ok) {
      setError(body.data.urlIngest.message ?? "Страница недоступна");
    } else {
      setNotice("Запись переиндексирована");
    }
    setReingesting(null);
    await loadItems(selectedId);
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
    } else {
      setNotice(`Импортировано файлов: ${body.data?.created ?? 0}`);
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

  function updateSettings(patch: Partial<KnowledgeSettings>) {
    setEditSettings((prev) => ({
      ...(prev ?? {
        chunkSize: 1800,
        chunkOverlap: 200,
        grounding: "strict",
        autoTitle: true,
        maxContextChars: 12000,
      }),
      ...patch,
    }));
  }

  const selected = bases.find((b) => b.id === selectedId);

  return (
    <section className="card agents-crm knowledge-studio" data-testid="knowledge-page">
      <div className="knowledge-studio-header">
        <div>
          <h1 className="knowledge-studio-title">База знаний</h1>
          <p className="knowledge-studio-lead">
            Создавайте базы 3 простыми способами: <strong>файлы</strong>, <strong>готовый текст</strong>,{" "}
            <strong>ссылки/карта сайта</strong>. Ассистент подключает базу в ответах автоматически.{" "}
            <Link href="/docs/knowledge" className="knowledge-link">
              Как это работает
            </Link>
            {" · "}
            <Link href="/assistants" className="knowledge-link">
              Подключить к ассистенту
            </Link>
          </p>
        </div>
      </div>
      {error ? <div className="knowledge-banner-error">{error}</div> : null}
      {notice ? <div className="knowledge-banner-ok">{notice}</div> : null}

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
            <button type="button" className="knowledge-btn-new" onClick={() => (wizardOpen ? setWizardOpen(false) : openWizard())}>
              {wizardOpen ? "−" : "+"} Новая
            </button>
          </div>
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
                      {b.settings?.template ? ` · ${b.settings.template}` : ""}
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
          {wizardOpen ? (
            <div className="knowledge-wizard">
              <div className="knowledge-wizard-steps">
                <span className={wizardStep === 1 ? "knowledge-wizard-step-active" : ""}>1. Шаблон</span>
                <span className={wizardStep === 2 ? "knowledge-wizard-step-active" : ""}>2. Название</span>
              </div>
              {wizardStep === 1 ? (
                <>
                  <p className="knowledge-hint">
                    Выберите шаблон — он задаст оптимальные настройки чанкинга и режим ответов ассистента. Все параметры можно
                    поменять позже.
                  </p>
                  <div className="knowledge-templates">
                    {TEMPLATES.map((t) => (
                      <button
                        key={t.code}
                        type="button"
                        className={`knowledge-template ${wizardTemplate.code === t.code ? "knowledge-template-active" : ""}`}
                        onClick={() => pickTemplate(t.code)}
                      >
                        <strong>{t.title}</strong>
                        <small>{t.subtitle}</small>
                        <em>{t.recommendedFor}</em>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="knowledge-create-panel">
                  <p className="knowledge-hint">
                    Шаблон: <strong>{wizardTemplate.title}</strong>.{" "}
                    <button type="button" className="knowledge-link" onClick={() => setWizardStep(1)}>
                      изменить
                    </button>
                  </p>
                  <label>Название базы</label>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Например: FAQ поддержки" />
                  <label>Короткое описание (необязательно)</label>
                  <textarea
                    rows={2}
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="О чём эта база, для какого ассистента"
                  />
                  <div className="knowledge-inline-actions">
                    <button
                      type="button"
                      className="knowledge-btn-primary"
                      disabled={saving}
                      onClick={() => void onCreateBase()}
                    >
                      {saving ? "Создание…" : "Создать базу"}
                    </button>
                    <button type="button" className="button-ghost" onClick={() => setWizardOpen(false)}>
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : !selectedId ? (
            <div className="knowledge-empty-workspace">
              <h2>Три способа быстро наполнить базу</h2>
              <div className="knowledge-steps-grid">
                <div className="knowledge-step-card">
                  <strong>1. Перетащите файлы</strong>
                  <p>
                    PDF, DOCX, TXT, MD, JSON, CSV (до 10 МБ). Текст извлекается автоматически, режется на чанки и попадает в
                    поиск ассистента.
                  </p>
                </div>
                <div className="knowledge-step-card">
                  <strong>2. Вставьте готовый текст</strong>
                  <p>
                    Инструкции, регламенты, описания. Длинный текст автоматически разбивается на фрагменты. Есть ИИ-подсказка
                    «разбей на карточки».
                  </p>
                </div>
                <div className="knowledge-step-card">
                  <strong>3. Добавьте URL или sitemap.xml</strong>
                  <p>
                    Одной ссылкой или списком. Сервер загрузит страницу, очистит HTML и сохранит контент. Поддерживается
                    <strong> пакетный импорт</strong> из sitemap.
                  </p>
                </div>
              </div>
              <div className="knowledge-inline-actions">
                <button type="button" className="knowledge-btn-primary" onClick={openWizard}>
                  Создать базу
                </button>
                <Link href="/docs/knowledge" className="button-ghost">
                  Подробное руководство
                </Link>
              </div>
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
                  <button type="button" className="knowledge-btn-secondary knowledge-btn-sm" onClick={() => void onReembed()}>
                    Пересчитать эмбеддинги
                  </button>
                </div>
              </header>

              <div className="knowledge-workspace-split">
                <section className="knowledge-panel">
                  <div className="knowledge-panel-head">
                    <h3>Настройки базы</h3>
                    <button type="button" className="button-ghost" onClick={() => setSettingsOpen((v) => !v)}>
                      {settingsOpen ? "Скрыть" : "Расширенные"}
                    </button>
                  </div>
                  <label>Название</label>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <label>Описание</label>
                  <textarea rows={2} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                  {settingsOpen && editSettings ? (
                    <div className="knowledge-settings-grid">
                      <label>
                        Режим ответов
                        <select
                          value={editSettings.grounding}
                          onChange={(e) => updateSettings({ grounding: e.target.value === "mixed" ? "mixed" : "strict" })}
                        >
                          <option value="strict">Строгий — только факты из базы</option>
                          <option value="mixed">Смешанный — можно дополнять общими знаниями</option>
                        </select>
                      </label>
                      <label>
                        Размер чанка, символов (300–4000)
                        <input
                          type="number"
                          min={300}
                          max={4000}
                          value={editSettings.chunkSize}
                          onChange={(e) => updateSettings({ chunkSize: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        Перекрытие (0–500)
                        <input
                          type="number"
                          min={0}
                          max={500}
                          value={editSettings.chunkOverlap}
                          onChange={(e) => updateSettings({ chunkOverlap: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        Макс. контекст, симв. (2000–40000)
                        <input
                          type="number"
                          min={2000}
                          max={40000}
                          step={1000}
                          value={editSettings.maxContextChars}
                          onChange={(e) => updateSettings({ maxContextChars: Number(e.target.value) })}
                        />
                      </label>
                      <label className="knowledge-settings-check">
                        <input
                          type="checkbox"
                          checked={editSettings.autoTitle}
                          onChange={(e) => updateSettings({ autoTitle: e.target.checked })}
                        />
                        Авто-заголовки для текста/URL
                      </label>
                      <p className="knowledge-hint knowledge-settings-note">
                        После изменения размера чанка новые материалы будут использоваться с новыми настройками. Чтобы
                        пересчитать уже загруженные — нажмите «Обновить» в строке материала.
                      </p>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="knowledge-btn-primary knowledge-btn-sm"
                    disabled={saving}
                    onClick={() => void onUpdateBase()}
                  >
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
                      Одна ссылка
                    </button>
                    <button type="button" className={addTab === "batch" ? "knowledge-tab-active" : "button-ghost"} onClick={() => setAddTab("batch")}>
                      Пакет URL · sitemap
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
                        <strong>Перетащите файлы</strong> или выберите с диска (до 6 за раз). PDF, DOCX, TXT, MD, JSON, CSV — до
                        10 МБ.
                      </p>
                      <input ref={fileRef} type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.csv,.json" onChange={(e) => void uploadFilesList(e.target.files)} />
                      <button type="button" className="knowledge-btn-secondary" disabled={fileBusy} onClick={() => fileRef.current?.click()}>
                        {fileBusy ? "Обработка…" : "Выбрать файлы"}
                      </button>
                    </div>
                  ) : null}

                  {addTab === "text" ? (
                    <div className="knowledge-add-text">
                      <label>Заголовок (необязательно — подставим автоматически)</label>
                      <input value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} placeholder="Авто-заголовок, если пусто" />
                      <label>Текст</label>
                      <textarea rows={6} value={itemContent} onChange={(e) => setItemContent(e.target.value)} placeholder="Вставьте готовый фрагмент или черновик" />
                      <div className="knowledge-inline-actions">
                        <button type="button" className="knowledge-btn-secondary knowledge-btn-sm" disabled={suggestBusy} onClick={() => void onSuggestSplit()}>
                          {suggestBusy ? "ИИ…" : "ИИ: разбить на карточки"}
                        </button>
                      </div>
                      {suggestNotice ? <p className="knowledge-hint">{suggestNotice}</p> : null}
                      {suggestCards.length > 0 ? (
                        <div className="knowledge-suggest-cards">
                          {suggestCards.map((c, i) => (
                            <div key={`${c.title}-${i}`} className="knowledge-suggest-card">
                              <strong>{c.title}</strong>
                              <small className="knowledge-hint">{c.content.slice(0, 160)}{c.content.length > 160 ? "…" : ""}</small>
                              <button
                                type="button"
                                className="button-ghost"
                                onClick={() => {
                                  setItemTitle(c.title);
                                  setItemContent(c.content);
                                }}
                              >
                                Вставить в форму
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <button type="button" className="knowledge-btn-primary knowledge-btn-sm" disabled={saving} onClick={() => void onAddTextItem()}>
                        {saving ? "…" : "Добавить"}
                      </button>
                    </div>
                  ) : null}

                  {addTab === "url" ? (
                    <div className="knowledge-add-url">
                      <p className="knowledge-hint">
                        Страница загружается на сервере, HTML очищается и режется на чанки (таймаут 18 с, лимит 2 МБ). Сайты с
                        защитой от ботов могут не отдать текст.
                      </p>
                      <label>Заголовок (необязательно)</label>
                      <input value={urlTitle} onChange={(e) => setUrlTitle(e.target.value)} placeholder="Авто-заголовок, если пусто" />
                      <label>URL</label>
                      <input value={urlValue} onChange={(e) => setUrlValue(e.target.value)} placeholder="https://…" />
                      <button type="button" className="knowledge-btn-primary knowledge-btn-sm" disabled={saving} onClick={() => void onAddUrlItem()}>
                        {saving ? "…" : "Добавить"}
                      </button>
                    </div>
                  ) : null}

                  {addTab === "batch" ? (
                    <div className="knowledge-add-batch">
                      <p className="knowledge-hint">
                        До 40 URL за раз. Поддерживается <code>sitemap.xml</code> — теги <code>&lt;loc&gt;</code> будут
                        прочитаны автоматически. Дубликаты и некорректные/приватные адреса отфильтровываются.
                      </p>
                      <label>Список URL (по одному на строку)</label>
                      <textarea
                        rows={6}
                        value={batchUrls}
                        onChange={(e) => setBatchUrls(e.target.value)}
                        placeholder={"https://site.com/docs/one\nhttps://site.com/docs/two"}
                      />
                      <label>или sitemap.xml</label>
                      <input
                        value={batchSitemap}
                        onChange={(e) => setBatchSitemap(e.target.value)}
                        placeholder="https://site.com/sitemap.xml"
                      />
                      <button
                        type="button"
                        className="knowledge-btn-primary knowledge-btn-sm"
                        disabled={batchBusy}
                        onClick={() => void onBatchImport()}
                      >
                        {batchBusy ? "Импорт…" : "Импортировать"}
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
                              {it.sourceType !== "FILE" ? (
                                <button
                                  type="button"
                                  className="button-ghost"
                                  disabled={reingesting === it.id}
                                  onClick={() => void onReingestItem(it.id)}
                                  title="Переиндексировать (URL — перезагрузить, TEXT — перечанковать)"
                                >
                                  {reingesting === it.id ? "…" : "Обновить"}
                                </button>
                              ) : null}
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
