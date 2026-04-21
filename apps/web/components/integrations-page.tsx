"use client";

import { useEffect, useState } from "react";

type ProviderRow = {
  provider: string;
  title: string;
  docsUrl: string;
  enabled: boolean;
  configured: boolean;
  updatedAt: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  config?: {
    model?: string;
    autoRouting?: boolean;
  } | null;
};

type ResponseShape = {
  ok: boolean;
  data?: {
    integrations?: ProviderRow[];
    connected?: boolean;
    message?: string;
  };
  error?: {
    message?: string;
  };
};

export function IntegrationsPageClient() {
  const [items, setItems] = useState<ProviderRow[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, { enabled: boolean; apiKey: string; model: string; autoRouting: boolean }>
  >({});

  async function load() {
    const response = await fetch("/api/integrations");
    const body = (await response.json()) as ResponseShape;
    if (!response.ok || !body.ok || !body.data?.integrations) {
      setError(body.error?.message ?? "Не удалось загрузить интеграции");
      return;
    }
    setItems(body.data.integrations);
    const nextDrafts: Record<string, { enabled: boolean; apiKey: string; model: string; autoRouting: boolean }> = {};
    for (const item of body.data.integrations) {
      nextDrafts[item.provider] = {
        enabled: item.enabled,
        apiKey: "",
        model: item.config?.model ?? "openai/gpt-4.1-mini",
        autoRouting: item.config?.autoRouting !== false,
      };
    }
    setDrafts(nextDrafts);
    setError(null);
  }

  useEffect(() => {
    void load();
  }, []);

  function setDraft(
    provider: string,
    patch: Partial<{ enabled: boolean; apiKey: string; model: string; autoRouting: boolean }>,
  ) {
    setDrafts((prev) => ({
      ...prev,
      [provider]: {
        enabled: prev[provider]?.enabled ?? false,
        apiKey: prev[provider]?.apiKey ?? "",
        model: prev[provider]?.model ?? "openai/gpt-4.1-mini",
        autoRouting: prev[provider]?.autoRouting ?? true,
        ...patch,
      },
    }));
  }

  async function save(provider: string) {
    setSaving(provider);
    setError(null);
    const draft = drafts[provider] ?? { enabled: false, apiKey: "", model: "openai/gpt-4.1-mini", autoRouting: true };
    const response = await fetch(`/api/integrations/${provider}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: draft.enabled,
        apiKey: draft.apiKey.trim() || undefined,
        model: draft.model.trim() || undefined,
        autoRouting: draft.autoRouting,
      }),
    });
    const body = (await response.json()) as ResponseShape;
    if (!response.ok || !body.ok) {
      setError(body.error?.message ?? "Не удалось сохранить интеграцию");
      setSaving(null);
      return;
    }
    setDraft(provider, { apiKey: "" });
    await load();
    setSaving(null);
  }

  async function test(provider: string) {
    setTesting(provider);
    setError(null);
    const response = await fetch(`/api/integrations/${provider}/test`, { method: "POST" });
    const body = (await response.json()) as ResponseShape;
    if (!response.ok || !body.ok) {
      setError(body.error?.message ?? "Тест интеграции не прошел");
      setTesting(null);
      return;
    }
    await load();
    setTesting(null);
  }

  return (
    <section className="card">
      <h1 style={{ marginBottom: 6 }}>Интеграция AI</h1>
      <p style={{ marginTop: 0, color: "#6b7280" }}>
        Настройка API-ключей и проверка подключения провайдеров.
      </p>
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

      <div className="integrations-grid">
        {items.map((item) => {
          const draft = drafts[item.provider] ?? {
            enabled: item.enabled,
            apiKey: "",
            model: item.config?.model ?? "openai/gpt-4.1-mini",
            autoRouting: item.config?.autoRouting !== false,
          };
          const isBusy = saving === item.provider || testing === item.provider;
          return (
            <article key={item.provider} className="integration-card">
              <div className="integration-card-header">
                <h3>{item.title}</h3>
                <a href={item.docsUrl} target="_blank" rel="noreferrer">
                  docs
                </a>
              </div>
              <label className="integration-toggle">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => setDraft(item.provider, { enabled: event.target.checked })}
                />
                Включено
              </label>
              <input
                type="password"
                placeholder={item.configured ? "Ключ сохранен (оставьте пустым)" : "Вставьте API ключ"}
                value={draft.apiKey}
                onChange={(event) => setDraft(item.provider, { apiKey: event.target.value })}
              />
              {item.provider === "openrouter" ? (
                <>
                  <input
                    type="text"
                    placeholder="Модель OpenRouter (например openai/gpt-4.1-mini)"
                    value={draft.model}
                    onChange={(event) => setDraft(item.provider, { model: event.target.value })}
                  />
                  <label className="integration-toggle">
                    <input
                      type="checkbox"
                      checked={draft.autoRouting}
                      onChange={(event) => setDraft(item.provider, { autoRouting: event.target.checked })}
                    />
                    Автоматический роутинг через OpenRouter
                  </label>
                </>
              ) : null}
              <div className="integration-status">
                <span>
                  {item.lastTestOk === true
                    ? "Проверка: успешно"
                    : item.lastTestOk === false
                      ? "Проверка: ошибка"
                      : "Проверка: не выполнялась"}
                </span>
                {item.lastTestMessage ? <small>{item.lastTestMessage}</small> : null}
              </div>
              <div className="integration-actions">
                <button type="button" disabled={isBusy} onClick={() => void save(item.provider)}>
                  {saving === item.provider ? "Сохранение..." : "Сохранить"}
                </button>
                <button type="button" disabled={isBusy || !item.configured} onClick={() => void test(item.provider)}>
                  {testing === item.provider ? "Проверка..." : "Тест"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
