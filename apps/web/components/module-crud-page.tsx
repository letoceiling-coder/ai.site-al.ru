"use client";

import { useEffect, useMemo, useState } from "react";

type ModuleCrudPageProps = {
  moduleKey:
    | "integrations"
    | "agents"
    | "knowledge"
    | "assistants"
    | "dialogs"
    | "api_keys"
    | "leads"
    | "telegram"
    | "analytics"
    | "usage"
    | "settings"
    | "avito";
  title: string;
  description: string;
};

type ApiListResponse = {
  ok: boolean;
  data?: {
    module: string;
    items: Record<string, unknown>[];
  };
  error?: {
    message?: string;
  };
};

export function ModuleCrudPage({ moduleKey, title, description }: ModuleCrudPageProps) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [jsonPayload, setJsonPayload] = useState("{}");
  const [error, setError] = useState<string | null>(null);

  const endpoint = useMemo(() => `/api/admin/${moduleKey}`, [moduleKey]);

  async function loadItems() {
    setLoading(true);
    setError(null);
    const response = await fetch(endpoint);
    const body = (await response.json()) as ApiListResponse;
    if (!response.ok || !body.ok || !body.data) {
      setError(body.error?.message ?? "Не удалось загрузить данные");
      setItems([]);
      setLoading(false);
      return;
    }
    setItems(body.data.items ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleKey]);

  async function onCreate() {
    setCreating(true);
    setError(null);
    let extra: Record<string, unknown> = {};
    try {
      extra = JSON.parse(jsonPayload || "{}") as Record<string, unknown>;
    } catch {
      setError("Поле JSON должно быть валидным");
      setCreating(false);
      return;
    }

    const payload = {
      name: name || "New Item",
      ...extra,
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as ApiListResponse;
    if (!response.ok || !body.ok) {
      setError(body.error?.message ?? "Не удалось создать запись");
      setCreating(false);
      return;
    }

    setName("");
    setJsonPayload("{}");
    await loadItems();
    setCreating(false);
  }

  const columns = items.length ? Object.keys(items[0]).slice(0, 6) : [];

  return (
    <section className="card">
      <div className="module-title-row">
        <span className="module-chip-icon" aria-hidden="true">
          ◉
        </span>
        <h1>{title}</h1>
      </div>
      <p>{description}</p>
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

      <div className="module-crud-form">
        <input
          placeholder="Название"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <textarea
          placeholder='Доп. поля JSON, например {"provider":"OPENAI"}'
          value={jsonPayload}
          onChange={(event) => setJsonPayload(event.target.value)}
          rows={4}
        />
        <button type="button" onClick={onCreate} disabled={creating}>
          {creating ? "Создание..." : "Создать"}
        </button>
      </div>

      {loading ? (
        <p>Загрузка...</p>
      ) : items.length === 0 ? (
        <p>Пока нет данных</p>
      ) : (
        <div className="module-crud-table-wrap">
          <table className="module-crud-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column}
                    style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={String(item.id ?? index)}>
                  {columns.map((column) => (
                    <td key={`${String(item.id ?? index)}-${column}`} style={{ padding: 8 }}>
                      {typeof item[column] === "object"
                        ? JSON.stringify(item[column]).slice(0, 60)
                        : String(item[column] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
