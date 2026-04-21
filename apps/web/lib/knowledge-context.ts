import { prisma } from "@ai/db";

const DEFAULT_MAX = 12_000;

/**
 * Собирает текст из привязанных к ассистенту баз: записи с контентом и сегменты из документов.
 * При переполнении — приорит фрагментам, в которых есть слова из запроса.
 */
export async function buildKnowledgeContextForBases(
  tenantId: string,
  knowledgeBaseIds: string[],
  userQuery: string,
  maxChars: number = DEFAULT_MAX,
) {
  if (knowledgeBaseIds.length === 0) {
    return "";
  }

  const items = await prisma.knowledgeItem.findMany({
    where: {
      tenantId,
      knowledgeBaseId: { in: knowledgeBaseIds },
    },
    include: {
      document: {
        include: {
          chunks: { orderBy: { idx: "asc" } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });

  const parts: string[] = [];
  for (const item of items) {
    if (item.document?.chunks?.length) {
      for (const c of item.document.chunks) {
        if (c.content?.trim()) {
          parts.push(`[${item.title}]\n${c.content.trim()}`);
        }
      }
    } else if (item.content?.trim()) {
      parts.push(`[${item.title}]\n${item.content.trim()}`);
    } else if (item.sourceUrl?.trim()) {
      parts.push(`[${item.title}]\n${item.sourceUrl.trim()}`);
    }
  }

  if (parts.length === 0) {
    return "";
  }

  const terms = userQuery
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter((t) => t.length > 1);

  function score(text: string) {
    if (terms.length === 0) {
      return 0;
    }
    const low = text.toLowerCase();
    return terms.reduce((n, t) => (low.includes(t) ? n + 1 : n), 0);
  }

  const ordered = [...parts].sort((a, b) => score(b) - score(a));
  let out = "";
  for (const p of ordered) {
    const next = out ? `${out}\n\n${p}` : p;
    if (next.length > maxChars) {
      if (!out) {
        return p.slice(0, maxChars);
      }
      const room = maxChars - out.length - 2;
      if (room > 20) {
        return `${out}\n\n${p.slice(0, room)}`;
      }
      return out.slice(0, maxChars);
    }
    out = next;
  }
  return out;
}
