"use client";

import { useEffect, useState } from "react";

type Summary = {
  integrations: number;
  agents: number;
  assistants: number;
  knowledgeBases: number;
  dialogs: number;
  apiKeys: number;
  leads: number;
};

export function DashboardOverview() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      const response = await fetch("/api/admin/summary");
      const body = (await response.json()) as {
        ok: boolean;
        data?: Summary;
        error?: { message?: string };
      };
      if (!response.ok || !body.ok || !body.data) {
        setError(body.error?.message ?? "Не удалось загрузить статистику");
        return;
      }
      setSummary(body.data);
    };
    void run();
  }, []);

  return (
    <section className="card">
      <h1>Дашборд</h1>
      <p>Статистика только по вашему аккаунту.</p>
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
      {!summary ? (
        <p>Загрузка...</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(140px, 1fr))", gap: 12 }}>
          <div className="card"><strong>Интеграции:</strong> {summary.integrations}</div>
          <div className="card"><strong>Агенты:</strong> {summary.agents}</div>
          <div className="card"><strong>Ассистенты:</strong> {summary.assistants}</div>
          <div className="card"><strong>База знаний:</strong> {summary.knowledgeBases}</div>
          <div className="card"><strong>Диалоги:</strong> {summary.dialogs}</div>
          <div className="card"><strong>API ключи:</strong> {summary.apiKeys}</div>
          <div className="card"><strong>Лиды:</strong> {summary.leads}</div>
        </div>
      )}
    </section>
  );
}
