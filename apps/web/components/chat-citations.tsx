"use client";

import { Fragment } from "react";

export type ChatCitation = {
  marker: string;
  chunkId?: string | null;
  knowledgeBaseId?: string;
  knowledgeBaseName?: string | null;
  knowledgeItemId?: string;
  title?: string;
  sourceType?: "FILE" | "TEXT" | "URL" | null;
  sourceUrl?: string | null;
};

/**
 * Рендерит текст, подсвечивая все вхождения [#N] как inline-ссылки на цитаты.
 * Если citations пуст — возвращает исходный текст.
 */
export function CitationText({ text, citations }: { text: string; citations?: ChatCitation[] }) {
  if (!text) {
    return null;
  }
  const list = citations ?? [];
  if (list.length === 0) {
    return <>{text}</>;
  }
  const byMarker = new Map(list.map((c) => [c.marker, c] as const));
  // split по [#N] сохраняя разделитель
  const parts = text.split(/(\[#\d+\])/g);
  return (
    <>
      {parts.map((part, idx) => {
        const m = /^\[#(\d+)\]$/.exec(part);
        if (!m) {
          return <Fragment key={idx}>{part}</Fragment>;
        }
        const marker = `#${m[1]}`;
        const cite = byMarker.get(marker);
        if (!cite) {
          // модель поставила маркер, которого нет в списке цитат — показываем как обычный текст
          return <Fragment key={idx}>{part}</Fragment>;
        }
        const tooltip = cite.title
          ? `${cite.title}${cite.sourceUrl ? ` — ${cite.sourceUrl}` : ""}`
          : cite.sourceUrl ?? "Источник";
        const href = cite.sourceType === "URL" ? cite.sourceUrl ?? undefined : undefined;
        if (href) {
          return (
            <a
              key={idx}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="chat-citation-link"
              title={tooltip}
            >
              {marker}
            </a>
          );
        }
        return (
          <span key={idx} className="chat-citation-link chat-citation-link--static" title={tooltip}>
            {marker}
          </span>
        );
      })}
    </>
  );
}

/** Блок «Источники» под ответом. */
export function CitationsList({ citations }: { citations?: ChatCitation[] }) {
  if (!citations || citations.length === 0) {
    return null;
  }
  return (
    <div className="chat-citations">
      <strong>Источники:</strong>
      <ol>
        {citations.map((c) => {
          const label = c.title || c.sourceUrl || "Без названия";
          const typeLabel =
            c.sourceType === "URL"
              ? "URL"
              : c.sourceType === "FILE"
                ? "Файл"
                : c.sourceType === "TEXT"
                  ? "Текст"
                  : "";
          return (
            <li key={`${c.marker}-${c.knowledgeItemId ?? label}`}>
              <span className="chat-citation-marker">{c.marker}</span>{" "}
              {c.sourceUrl ? (
                <a href={c.sourceUrl} target="_blank" rel="noreferrer">
                  {label}
                </a>
              ) : (
                <span>{label}</span>
              )}
              {typeLabel ? <small className="chat-citation-meta"> · {typeLabel}</small> : null}
              {c.knowledgeBaseName ? (
                <small className="chat-citation-meta"> · {c.knowledgeBaseName}</small>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
