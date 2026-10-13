/**
 * 記事本文（Tiptap / ProseMirror の JSON）の検証と HTML 化。
 *
 * - sanitizeDoc: 許可したノード・マーク・属性だけで木を組み直す（保存前に必ず通す）
 * - renderDoc:   検証済みの木を HTML 文字列にする（テキストは常にエスケープ）
 *
 * 生の HTML は一切受け付けないため、本文経由のスクリプト注入は起こらない。
 */

import { layoutStyle, normalizeLayout } from "../image-layout.ts";

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface TocItem {
  id: string;
  level: 2 | 3;
  text: string;
}

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "image",
]);
const INLINE_TYPES = new Set(["text", "hardBreak"]);
const MARK_TYPES = new Set(["bold", "italic", "strike", "underline", "code", "link"]);

const MAX_DEPTH = 12;
const MAX_NODES = 20_000;

export const EMPTY_DOC: DocNode = { type: "doc", content: [{ type: "paragraph" }] };

/* ---------------- URL の検証 ---------------- */

export function safeLinkHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const v = href.trim();
  if (!v || v.length > 2048) return null;
  if (v.startsWith("#")) return v;
  if (v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\")) return v;
  try {
    const url = new URL(v);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

const UPLOAD_PATH_RE = /^\/uploads\/[a-f0-9]{32}\.(webp|gif)$/;

/** 画像URL: 自サイトのアップロード画像か https の外部画像のみ */
export function safeImageSrc(src: unknown): string | null {
  if (typeof src !== "string") return null;
  const v = src.trim();
  if (UPLOAD_PATH_RE.test(v)) return v;
  try {
    const url = new URL(v);
    return url.protocol === "https:" && v.length <= 2048 ? url.href : null;
  } catch {
    return null;
  }
}

/* ---------------- サニタイズ ---------------- */

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

export function sanitizeDoc(input: unknown): DocNode {
  let count = 0;

  const cleanMarks = (marks: unknown): DocNode["marks"] => {
    if (!Array.isArray(marks)) return undefined;
    const out: NonNullable<DocNode["marks"]> = [];
    for (const m of marks) {
      if (!m || typeof m !== "object" || !MARK_TYPES.has((m as DocNode).type)) continue;
      const type = (m as DocNode).type;
      if (type === "link") {
        const href = safeLinkHref((m as DocNode).attrs?.href);
        if (href) out.push({ type, attrs: { href } });
      } else {
        out.push({ type });
      }
    }
    return out.length ? out : undefined;
  };

  const cleanNode = (node: unknown, depth: number): DocNode | null => {
    if (!node || typeof node !== "object" || depth > MAX_DEPTH || ++count > MAX_NODES) return null;
    const n = node as DocNode;
    const attrs = n.attrs ?? {};

    if (n.type === "text") {
      const text = str(n.text, 100_000);
      if (!text) return null;
      return { type: "text", text, ...(cleanMarks(n.marks) ? { marks: cleanMarks(n.marks) } : {}) };
    }
    if (n.type === "hardBreak") return { type: "hardBreak" };
    if (n.type === "horizontalRule") return { type: "horizontalRule" };
    if (n.type === "image") {
      const src = safeImageSrc(attrs.src);
      if (!src) return null;
      return { type: "image", attrs: { src, alt: str(attrs.alt, 300), ...normalizeLayout(attrs) } };
    }
    if (!BLOCK_TYPES.has(n.type)) return null;

    const children = Array.isArray(n.content)
      ? (n.content.map((c) => cleanNode(c, depth + 1)).filter(Boolean) as DocNode[])
      : [];
    const isTextBlock = n.type === "paragraph" || n.type === "heading" || n.type === "codeBlock";
    const kids = isTextBlock
      ? children.filter((c) => INLINE_TYPES.has(c.type))
      : children.filter((c) => !INLINE_TYPES.has(c.type));
    const content = kids.length ? { content: kids } : {};

    switch (n.type) {
      case "heading": {
        const level = Math.min(Math.max(Number(attrs.level) || 2, 2), 3);
        return { type: "heading", attrs: { level }, ...content };
      }
      case "codeBlock": {
        const language = str(attrs.language, 32).replace(/[^a-zA-Z0-9_+-]/g, "");
        const plain = kids.filter((c) => c.type === "text").map((c) => ({ type: "text", text: c.text }));
        return {
          type: "codeBlock",
          attrs: { language: language || null },
          ...(plain.length ? { content: plain } : {}),
        };
      }
      case "orderedList": {
        const start = Math.max(1, Math.min(Number(attrs.start) || 1, 10_000));
        return kids.length ? { type: "orderedList", attrs: { start }, content: kids } : null;
      }
      case "bulletList":
      case "listItem":
      case "blockquote":
        return kids.length ? { type: n.type, content: kids } : null;
      default:
        return { type: n.type, ...content };
    }
  };

  const root = input as DocNode | null;
  if (!root || typeof root !== "object" || root.type !== "doc" || !Array.isArray(root.content)) {
    return structuredClone(EMPTY_DOC);
  }
  const content = root.content
    .map((c) => cleanNode(c, 1))
    .filter((c): c is DocNode => !!c && !INLINE_TYPES.has(c.type));
  while (content.length && content.at(-1)!.type === "paragraph" && !content.at(-1)!.content) content.pop();
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/* ---------------- テキスト抽出 ---------------- */

export function docToPlainText(doc: DocNode): string {
  const parts: string[] = [];
  const walk = (n: DocNode) => {
    if (n.type === "text") parts.push(n.text ?? "");
    else if (n.type === "hardBreak") parts.push(" ");
    n.content?.forEach(walk);
    if (BLOCK_TYPES.has(n.type)) parts.push(" ");
  };
  walk(doc);
  return parts.join("").replace(/\s+/g, " ").trim();
}

/** 一覧・OGP 用の要約。見出しとコードは除き、本文の文章から作る */
export function makeExcerpt(doc: DocNode, max = 120): string {
  const prose = { ...doc, content: (doc.content ?? []).filter((n) => n.type !== "heading" && n.type !== "codeBlock") };
  const text = docToPlainText(prose) || docToPlainText(doc);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 日本語の読了目安（500字/分） */
export function readingMinutes(doc: DocNode): number {
  return Math.max(1, Math.round(docToPlainText(doc).length / 500));
}

export function firstImage(doc: DocNode): string | null {
  let found: string | null = null;
  const walk = (n: DocNode) => {
    if (found) return;
    if (n.type === "image" && typeof n.attrs?.src === "string") found = n.attrs.src;
    n.content?.forEach(walk);
  };
  walk(doc);
  return found;
}

/* ---------------- HTML 化 ---------------- */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function renderText(n: DocNode): string {
  let html = escapeHtml(n.text ?? "");
  for (const m of n.marks ?? []) {
    switch (m.type) {
      case "bold": html = `<strong>${html}</strong>`; break;
      case "italic": html = `<em>${html}</em>`; break;
      case "strike": html = `<s>${html}</s>`; break;
      case "underline": html = `<u>${html}</u>`; break;
      case "code": html = `<code>${html}</code>`; break;
      case "link": {
        const href = safeLinkHref(m.attrs?.href);
        if (!href) break;
        const external = /^(https?:|mailto:)/.test(href);
        html = `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer nofollow"' : ""}>${html}</a>`;
        break;
      }
    }
  }
  return html;
}

/** 本文 HTML と目次を生成。見出しには目次用の id を振る */
export function renderDoc(doc: DocNode): { html: string; toc: TocItem[] } {
  const toc: TocItem[] = [];
  let headingIndex = 0;

  const inner = (n: DocNode): string => (n.content ?? []).map(render).join("");

  const render = (n: DocNode): string => {
    switch (n.type) {
      case "text": return renderText(n);
      case "hardBreak": return "<br>";
      case "paragraph": return `<p>${inner(n) || "<br>"}</p>`;
      case "heading": {
        const level = n.attrs?.level === 3 ? 3 : 2;
        const id = `h-${++headingIndex}`;
        toc.push({ id, level, text: docToPlainText(n) });
        return `<h${level} id="${id}">${inner(n)}</h${level}>`;
      }
      case "bulletList": return `<ul>${inner(n)}</ul>`;
      case "orderedList": {
        const start = Number(n.attrs?.start) || 1;
        return `<ol${start !== 1 ? ` start="${start}"` : ""}>${inner(n)}</ol>`;
      }
      case "listItem": return `<li>${inner(n)}</li>`;
      case "blockquote": return `<blockquote>${inner(n)}</blockquote>`;
      case "horizontalRule": return "<hr>";
      case "codeBlock": {
        const lang = typeof n.attrs?.language === "string" ? n.attrs.language : "";
        const code = (n.content ?? []).map((c) => escapeHtml(c.text ?? "")).join("");
        return `<pre${lang ? ` data-lang="${escapeHtml(lang)}"` : ""}><code>${code}</code></pre>`;
      }
      case "image": {
        const src = safeImageSrc(n.attrs?.src);
        if (!src) return "";
        const alt = typeof n.attrs?.alt === "string" ? n.attrs.alt : "";
        const layout = normalizeLayout(n.attrs);
        const style = layoutStyle(layout);
        const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`;
        return (
          `<figure class="a-fig" data-align="${layout.align}"${style ? ` style="${escapeHtml(style)}"` : ""}>` +
          `<div class="a-fig__frame"${layout.ratio ? ' data-cropped=""' : ""}>${img}</div>` +
          `</figure>`
        );
      }
      default: return "";
    }
  };

  const html = inner(doc);
  return { html, toc };
}
