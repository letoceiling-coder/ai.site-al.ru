/**
 * Markdown-aware chunker с breadcrumbs в metadata.
 *
 * Стратегия:
 *  1) Если в тексте встречаются markdown-заголовки (`^#+ ` в начале строки), режем текст
 *     по разделам заголовков и собираем «breadcrumbs» — путь от H1 до текущего уровня.
 *     Каждый чанк знает свой заголовок и всю цепочку вверх.
 *  2) Большие разделы (больше target) внутри дробим по параграфам (двойной \n), затем
 *     по предложениям, с перекрытием — это paragraph-aware подход, аналогичный прежнему.
 *  3) Если заголовков нет — fallback на paragraph-aware дробление без breadcrumbs.
 *
 * HTML сначала прогоняется через `htmlToStructuredMarkdown` — он сохраняет h1-h6 как
 * `#..######`, параграфы и пункты списков как переводы строк. После этого текст уже
 * выглядит как markdown и прогоняется через общий чанкер.
 */

export type ChunkPieceMeta = {
  /** Цепочка заголовков от корня до текущего раздела (без самого чанка). */
  breadcrumbs: string[];
  /** Заголовок секции, в которой лежит этот чанк (если удалось определить). */
  heading: string | null;
  /** Уровень heading-a (1..6) или null. */
  headingLevel: number | null;
};

export type ChunkPiece = {
  content: string;
  metadata: ChunkPieceMeta | null;
};

const DEFAULT_TARGET = 1800;
const DEFAULT_OVERLAP = 200;
const MAX_CHUNKS_PER_DOC = 400;
const MAX_BREADCRUMB_LEN = 120;

function hasMarkdownHeadings(text: string): boolean {
  return /^#{1,6}\s+\S/m.test(text);
}

/** Разделить на секции по markdown-заголовкам. Возвращает блоки в порядке документа. */
type Section = {
  level: number; // 0 — «до первого заголовка», иначе 1..6
  heading: string | null;
  body: string;
  breadcrumbs: string[];
};

function splitByHeadings(text: string): Section[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  let current: Section = { level: 0, heading: null, body: "", breadcrumbs: [] };

  const flush = () => {
    if (current.body.trim().length > 0 || current.heading) {
      sections.push({ ...current, body: current.body.trim() });
    }
  };

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      flush();
      const level = m[1].length;
      const title = m[2].trim().slice(0, MAX_BREADCRUMB_LEN);
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      const breadcrumbs = stack.map((s) => s.title);
      stack.push({ level, title });
      current = { level, heading: title, body: "", breadcrumbs };
    } else {
      current.body += line + "\n";
    }
  }
  flush();
  return sections;
}

/** Paragraph-aware разбиение куска текста с перекрытием. */
function splitParagraphAware(text: string, target: number, overlap: number): string[] {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (!t) return [];
  if (t.length <= target) return [t];

  const out: string[] = [];
  let start = 0;
  while (start < t.length && out.length < MAX_CHUNKS_PER_DOC) {
    let end = Math.min(t.length, start + target);
    if (end < t.length) {
      const slice = t.slice(start, end);
      const cut = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? "),
      );
      if (cut > target * 0.35) {
        end = start + cut + 1;
      }
    }
    const piece = t.slice(start, end).trim();
    if (piece) out.push(piece);
    if (end >= t.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out;
}

/**
 * Основной чанкер: структурный, если есть заголовки; paragraph-aware иначе.
 * Возвращает массив кусков с метаданными (breadcrumbs + heading).
 */
export function chunkStructured(
  raw: string,
  opts: { target?: number; overlap?: number } = {},
): ChunkPiece[] {
  const target = opts.target ?? DEFAULT_TARGET;
  const overlap = opts.overlap ?? DEFAULT_OVERLAP;

  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  if (!hasMarkdownHeadings(text)) {
    return splitParagraphAware(text, target, overlap).map((content) => ({
      content,
      metadata: null,
    }));
  }

  const out: ChunkPiece[] = [];
  const sections = splitByHeadings(text);

  for (const sec of sections) {
    if (!sec.body) continue;
    if (out.length >= MAX_CHUNKS_PER_DOC) break;

    const meta: ChunkPieceMeta = {
      breadcrumbs: sec.breadcrumbs,
      heading: sec.heading,
      headingLevel: sec.level || null,
    };

    // Если вся секция целиком помещается в target — отдаём как один чанк.
    if (sec.body.length <= target) {
      out.push({ content: sec.body, metadata: meta });
      continue;
    }

    const pieces = splitParagraphAware(sec.body, target, overlap);
    for (const piece of pieces) {
      if (out.length >= MAX_CHUNKS_PER_DOC) break;
      out.push({ content: piece, metadata: meta });
    }
  }

  return out;
}

/**
 * Превратить HTML в «структурный markdown»:
 * — h1..h6 → `#..######`,
 * — p, li, div, br → переводы строк (двойные между блоками),
 * — остальные теги раскрываются.
 * Не полноценный парсер, но лучше плоского `stripHtml` для чанкинга.
 */
export function htmlToStructuredMarkdown(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  // Заголовки — оставляем перевод строки до и после.
  for (let lvl = 6; lvl >= 1; lvl--) {
    const prefix = "#".repeat(lvl);
    const re = new RegExp(`<h${lvl}[^>]*>([\\s\\S]*?)<\\/h${lvl}>`, "gi");
    s = s.replace(re, (_m, inner: string) => `\n\n${prefix} ${stripInlineTags(inner).trim()}\n\n`);
  }

  // Блочные элементы — двойные переводы строк.
  s = s.replace(/<\/(p|div|section|article|header|footer|main|aside|tr|table|thead|tbody)>/gi, "\n\n");
  s = s.replace(/<br\s*\/?>(?!\s*<br)/gi, "\n");
  s = s.replace(/<\/(li)>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "• ");

  // Остальные теги — убираем.
  s = s.replace(/<[^>]+>/g, " ");

  // Декод базовых HTML-сущностей.
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");

  // Нормализация пробелов, но сохраняя переводы строк.
  s = s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return s;
}

function stripInlineTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Удобный рендер breadcrumbs для предпросмотра/контекста. */
export function formatBreadcrumbs(meta: ChunkPieceMeta | null | undefined): string {
  if (!meta) return "";
  const path = [...meta.breadcrumbs];
  if (meta.heading) path.push(meta.heading);
  return path.filter((p) => p && p.trim().length > 0).join(" › ");
}
