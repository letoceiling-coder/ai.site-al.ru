"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Health = {
  generatedAt: string;
  totals: {
    knowledgeBases: number;
    knowledgeItems: number;
    documents: number;
    chunks: number;
    chunksWithEmbedding: number;
    embeddingCoveragePct: number;
  };
  items: Record<string, number>;
  parseQueue: Record<string, number> & {
    oldestQueuedAgeSec: number | null;
    stuckRunning: number;
  };
  embeddingQueue: Record<string, number> & {
    oldestQueuedAgeSec: number | null;
    stuckRunning: number;
  };
  perBase: Array<{
    id: string;
    name: string;
    items: number;
    chunks: number;
    chunksWithEmbedding: number;
    coveragePct: number;
    lastUpdatedAt: string | null;
  }>;
  recentFailures: Array<{
    at: string;
    scope: "item" | "parse" | "embedding";
    title: string;
    knowledgeBase: string;
    message: string;
  }>;
  ingestMsP95: number | null;
};

function formatAge(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec} с`;
  if (sec < 3600) return `${Math.round(sec / 60)} мин`;
  if (sec < 86400) return `${Math.round(sec / 3600)} ч`;
  return `${Math.round(sec / 86400)} д`;
}

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} мс`;
  return `${(ms / 1000).toFixed(1)} с`;
}

function pill(value: number, kind: "ok" | "warn" | "bad" | "muted" = "muted") {
  const colors: Record<string, { bg: string; fg: string }> = {
    ok: { bg: "#ecfdf5", fg: "#047857" },
    warn: { bg: "#fef3c7", fg: "#92400e" },
    bad: { bg: "#fee2e2", fg: "#b91c1c" },
    muted: { bg: "#f1f5f9", fg: "#334155" },
  };
  const c = colors[kind];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        fontWeight: 600,
        fontSize: 12,
      }}
    >
      {value}
    </span>
  );
}

export function KnowledgeHealthPage() {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/knowledge/health", { cache: "no-store" });
      const body = (await res.json()) as { ok: boolean; data?: Health; error?: { message?: string } };
      if (!res.ok || !body.ok || !body.data) {
        setError(body.error?.message ?? "Не удалось загрузить метрики");
        return;
      }
      setData(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Сбой запроса");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <section className="card" style={{ display: "grid", gap: 16 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Здоровье базы знаний</h1>
          <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
            Агрегаты только по вашему аккаунту. Обновляется каждые 30 секунд.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/knowledge" className="btn btn-secondary">
            ← К базе знаний
          </Link>
          <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
            {loading ? "Обновление…" : "Обновить"}
          </button>
        </div>
      </header>

      {error ? <div style={{ color: "crimson" }}>{error}</div> : null}
      {!data ? (
        <p style={{ color: "#64748b" }}>Загрузка метрик…</p>
      ) : (
        <>
          {/* Totals */}
          <div>
            <h3 style={{ marginBottom: 8 }}>Общие показатели</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <Metric label="Базы знаний" value={data.totals.knowledgeBases} />
              <Metric label="Материалов" value={data.totals.knowledgeItems} />
              <Metric label="Документов" value={data.totals.documents} />
              <Metric label="Чанков" value={data.totals.chunks} />
              <Metric
                label="С эмбеддингами"
                value={`${data.totals.chunksWithEmbedding} / ${data.totals.chunks}`}
                hint={`Покрытие ${data.totals.embeddingCoveragePct}%`}
                tone={
                  data.totals.chunks === 0
                    ? "muted"
                    : data.totals.embeddingCoveragePct >= 95
                    ? "ok"
                    : data.totals.embeddingCoveragePct >= 70
                    ? "warn"
                    : "bad"
                }
              />
              <Metric label="p95 ingest" value={formatMs(data.ingestMsP95)} hint="по последним 500 items" />
            </div>
          </div>

          {/* Queues */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            <QueueCard
              title="Очередь парсинга файлов"
              data={data.parseQueue}
            />
            <QueueCard
              title="Очередь эмбеддингов"
              data={data.embeddingQueue}
            />
            <div className="card" style={{ background: "#fff" }}>
              <h4 style={{ marginTop: 0 }}>Статусы материалов</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, fontSize: 14 }}>
                <span>В очереди</span>
                <span>{pill(data.items.QUEUED ?? 0, data.items.QUEUED ? "warn" : "muted")}</span>
                <span>В работе</span>
                <span>{pill(data.items.RUNNING ?? 0)}</span>
                <span>Готово</span>
                <span>{pill(data.items.COMPLETED ?? 0, "ok")}</span>
                <span>Ошибки</span>
                <span>{pill(data.items.FAILED ?? 0, data.items.FAILED ? "bad" : "muted")}</span>
              </div>
            </div>
          </div>

          {/* Per base */}
          <div>
            <h3 style={{ marginBottom: 8 }}>По базам знаний (топ 10 по числу чанков)</h3>
            {data.perBase.length === 0 ? (
              <p style={{ color: "#64748b" }}>Пока нет данных.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>
                      <th style={{ padding: "8px 6px" }}>База</th>
                      <th style={{ padding: "8px 6px" }}>Материалов</th>
                      <th style={{ padding: "8px 6px" }}>Чанков</th>
                      <th style={{ padding: "8px 6px" }}>С эмбеддингами</th>
                      <th style={{ padding: "8px 6px" }}>Покрытие</th>
                      <th style={{ padding: "8px 6px" }}>Обновлено</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perBase.map((b) => (
                      <tr key={b.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "8px 6px" }}>
                          <Link href={`/knowledge?base=${b.id}`}>{b.name}</Link>
                        </td>
                        <td style={{ padding: "8px 6px" }}>{b.items}</td>
                        <td style={{ padding: "8px 6px" }}>{b.chunks}</td>
                        <td style={{ padding: "8px 6px" }}>{b.chunksWithEmbedding}</td>
                        <td style={{ padding: "8px 6px" }}>
                          {pill(
                            b.coveragePct,
                            b.chunks === 0
                              ? "muted"
                              : b.coveragePct >= 95
                              ? "ok"
                              : b.coveragePct >= 70
                              ? "warn"
                              : "bad",
                          )}
                          <span style={{ marginLeft: 6, color: "#64748b" }}>%</span>
                        </td>
                        <td style={{ padding: "8px 6px", color: "#64748b" }}>
                          {b.lastUpdatedAt ? new Date(b.lastUpdatedAt).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Failures */}
          <div>
            <h3 style={{ marginBottom: 8 }}>Недавние ошибки</h3>
            {data.recentFailures.length === 0 ? (
              <p style={{ color: "#64748b" }}>Ошибок нет — чисто.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
                {data.recentFailures.map((f, idx) => (
                  <li
                    key={`${f.at}-${idx}`}
                    className="card"
                    style={{ background: "#fff", borderLeft: "3px solid #dc2626" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                      <strong>{f.title || "—"}</strong>
                      <span style={{ fontSize: 12, color: "#64748b" }}>
                        {f.knowledgeBase ? `${f.knowledgeBase} · ` : ""}
                        {f.scope === "item" ? "ingest" : f.scope === "parse" ? "parse" : "embedding"} ·{" "}
                        {new Date(f.at).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ color: "#b91c1c", fontSize: 13, whiteSpace: "pre-wrap", marginTop: 4 }}>
                      {f.message}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p style={{ color: "#94a3b8", fontSize: 12, margin: 0 }}>
            Сгенерировано: {new Date(data.generatedAt).toLocaleString()}
          </p>
        </>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "ok" | "warn" | "bad" | "muted";
}) {
  const palette: Record<string, string> = {
    ok: "#047857",
    warn: "#92400e",
    bad: "#b91c1c",
    muted: "#0f172a",
  };
  const color = palette[tone ?? "muted"];
  return (
    <div className="card" style={{ background: "#fff" }}>
      <div style={{ color: "#64748b", fontSize: 12 }}>{label}</div>
      <div style={{ color, fontSize: 22, fontWeight: 700 }}>{value}</div>
      {hint ? <div style={{ color: "#64748b", fontSize: 12 }}>{hint}</div> : null}
    </div>
  );
}

function QueueCard({
  title,
  data,
}: {
  title: string;
  data: Record<string, number> & { oldestQueuedAgeSec: number | null; stuckRunning: number };
}) {
  const queued = data.QUEUED ?? 0;
  const running = data.RUNNING ?? 0;
  const completed = data.COMPLETED ?? 0;
  const failed = data.FAILED ?? 0;
  return (
    <div className="card" style={{ background: "#fff" }}>
      <h4 style={{ marginTop: 0 }}>{title}</h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, fontSize: 14 }}>
        <span>В очереди</span>
        <span>{pill(queued, queued > 0 ? "warn" : "muted")}</span>
        <span>В работе</span>
        <span>{pill(running)}</span>
        <span>Готово</span>
        <span>{pill(completed, "ok")}</span>
        <span>Ошибки</span>
        <span>{pill(failed, failed > 0 ? "bad" : "muted")}</span>
        <span>Возраст старейшего QUEUED</span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{formatAge(data.oldestQueuedAgeSec)}</span>
        <span>Зависших (RUNNING &gt; 15 мин)</span>
        <span>{pill(data.stuckRunning, data.stuckRunning > 0 ? "bad" : "muted")}</span>
      </div>
    </div>
  );
}
