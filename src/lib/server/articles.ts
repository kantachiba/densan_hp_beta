/**
 * Articles / Tags テーブルの操作。
 */
import { randomBytes } from "node:crypto";
import { getDb, nowIso, transaction } from "./db.ts";
import { normalizeFocus } from "../image-layout.ts";
import { docToPlainText, makeExcerpt, safeImageSrc, sanitizeDoc, type DocNode } from "./content.ts";

export type ArticleStatus = "draft" | "published";

export interface Article {
  articleId: string;
  authorId: string;
  authorName: string;
  title: string;
  content: DocNode;
  excerpt: string;
  thumbnailUrl: string | null;
  thumbnailFocusX: number;
  thumbnailFocusY: number;
  category: string | null;
  tags: string[];
  status: ArticleStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ArticleSummary = Omit<Article, "content">;

export interface ArticleInput {
  title: string;
  content: DocNode;
  thumbnailUrl: string | null;
  thumbnailFocusX: number;
  thumbnailFocusY: number;
  category: string | null;
  tags: string[];
  status: ArticleStatus;
}

export const TITLE_MAX = 120;
export const CATEGORY_MAX = 30;
export const TAG_MAX = 30;
export const TAGS_PER_ARTICLE = 10;

type Row = Record<string, unknown>;

const SUMMARY_COLUMNS = `a.article_id, a.author_id, u.display_name AS author_name, a.title, a.excerpt,
  a.thumbnail_url, a.thumbnail_focus_x, a.thumbnail_focus_y, a.category, a.status, a.published_at, a.created_at, a.updated_at,
  (SELECT group_concat(t.name, char(31)) FROM article_tags xt JOIN tags t ON t.tag_id = xt.tag_id
     WHERE xt.article_id = a.article_id) AS tag_names`;

function toSummary(row: Row): ArticleSummary {
  return {
    articleId: String(row.article_id),
    authorId: String(row.author_id),
    authorName: String(row.author_name ?? "（不明）"),
    title: String(row.title),
    excerpt: String(row.excerpt),
    thumbnailUrl: (row.thumbnail_url as string | null) ?? null,
    thumbnailFocusX: normalizeFocus(row.thumbnail_focus_x),
    thumbnailFocusY: normalizeFocus(row.thumbnail_focus_y),
    category: (row.category as string | null) ?? null,
    tags: row.tag_names ? String(row.tag_names).split("\u001f") : [],
    status: row.status as ArticleStatus,
    publishedAt: (row.published_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function parseContent(raw: unknown): DocNode {
  try {
    return sanitizeDoc(JSON.parse(String(raw)));
  } catch {
    return sanitizeDoc(null);
  }
}

/* ---------------- 入力の正規化・検証 ---------------- */

export function normalizeTags(input: unknown): string[] {
  const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[,、\s]+/) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().replace(/^#+/, "").slice(0, TAG_MAX);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length >= TAGS_PER_ARTICLE) break;
  }
  return out;
}

/** API から受け取った値を ArticleInput に変換。エラー時は message を返す */
export function parseArticleInput(body: unknown): { input: ArticleInput } | { error: string } {
  if (!body || typeof body !== "object") return { error: "不正なリクエストです" };
  const b = body as Record<string, unknown>;

  const title = typeof b.title === "string" ? b.title.replace(/\s+/g, " ").trim() : "";
  if (title.length > TITLE_MAX) return { error: `タイトルは${TITLE_MAX}文字以内にしてください` };

  const status: ArticleStatus = b.status === "published" ? "published" : "draft";
  const content = sanitizeDoc(b.content);

  let thumbnailUrl: string | null = null;
  if (typeof b.thumbnailUrl === "string" && b.thumbnailUrl) {
    thumbnailUrl = safeImageSrc(b.thumbnailUrl);
    if (!thumbnailUrl) return { error: "アイキャッチ画像のURLが不正です" };
  }

  const category = typeof b.category === "string" ? b.category.trim().slice(0, CATEGORY_MAX) || null : null;
  const tags = normalizeTags(b.tags);

  if (status === "published") {
    if (!title) return { error: "公開するにはタイトルを入力してください" };
    if (!docToPlainText(content) && !JSON.stringify(content).includes('"image"')) {
      return { error: "公開するには本文を入力してください" };
    }
  }
  const thumbnailFocusX = normalizeFocus(b.thumbnailFocusX);
  const thumbnailFocusY = normalizeFocus(b.thumbnailFocusY);

  return { input: { title, content, thumbnailUrl, thumbnailFocusX, thumbnailFocusY, category, tags, status } };
}

/* ---------------- 読み取り ---------------- */

export function getArticle(articleId: string): Article | null {
  const row = getDb()
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}, a.content FROM articles a
       LEFT JOIN users u ON u.user_id = a.author_id WHERE a.article_id = ?`,
    )
    .get(articleId) as Row | undefined;
  return row ? { ...toSummary(row), content: parseContent(row.content) } : null;
}

export function getPublishedArticle(articleId: string): Article | null {
  const article = getArticle(articleId);
  return article?.status === "published" ? article : null;
}

export interface PublicListOptions {
  page: number;
  perPage: number;
  category?: string | null;
  tag?: string | null;
}

export function listPublished(opts: PublicListOptions): { items: ArticleSummary[]; total: number; totalPages: number } {
  const where = ["a.status = 'published'"];
  const params: (string | number)[] = [];
  if (opts.category) {
    where.push("a.category = ?");
    params.push(opts.category);
  }
  if (opts.tag) {
    where.push(
      "EXISTS (SELECT 1 FROM article_tags xt JOIN tags t ON t.tag_id = xt.tag_id WHERE xt.article_id = a.article_id AND t.name = ?)",
    );
    params.push(opts.tag);
  }
  const whereSql = where.join(" AND ");
  const db = getDb();
  const total = Number((db.prepare(`SELECT COUNT(*) AS c FROM articles a WHERE ${whereSql}`).get(...params) as Row).c);
  const rows = db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM articles a LEFT JOIN users u ON u.user_id = a.author_id
       WHERE ${whereSql} ORDER BY a.published_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, opts.perPage, (opts.page - 1) * opts.perPage) as Row[];
  return { items: rows.map(toSummary), total, totalPages: Math.max(1, Math.ceil(total / opts.perPage)) };
}

/** 管理画面の一覧。authorId 指定時はその人の記事のみ */
export function listForDashboard(opts: { authorId?: string; status?: ArticleStatus | null }): ArticleSummary[] {
  const where: string[] = [];
  const params: string[] = [];
  if (opts.authorId) {
    where.push("a.author_id = ?");
    params.push(opts.authorId);
  }
  if (opts.status) {
    where.push("a.status = ?");
    params.push(opts.status);
  }
  const rows = getDb()
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM articles a LEFT JOIN users u ON u.user_id = a.author_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.updated_at DESC`,
    )
    .all(...params) as Row[];
  return rows.map(toSummary);
}

/** 公開記事で使われているカテゴリ（件数順） */
export function listPublicCategories(): { name: string; count: number }[] {
  const rows = getDb()
    .prepare(
      `SELECT category AS name, COUNT(*) AS c FROM articles
       WHERE status = 'published' AND category IS NOT NULL GROUP BY category ORDER BY c DESC, category`,
    )
    .all() as Row[];
  return rows.map((r) => ({ name: String(r.name), count: Number(r.c) }));
}

/** エディタの入力補完用 */
export function listKnownCategories(): string[] {
  const rows = getDb()
    .prepare("SELECT DISTINCT category FROM articles WHERE category IS NOT NULL ORDER BY category")
    .all() as Row[];
  return rows.map((r) => String(r.category));
}

export function listKnownTags(limit = 50): string[] {
  const rows = getDb()
    .prepare(
      `SELECT t.name, COUNT(xt.article_id) AS c FROM tags t JOIN article_tags xt ON xt.tag_id = t.tag_id
       GROUP BY t.tag_id ORDER BY c DESC, t.name LIMIT ?`,
    )
    .all(limit) as Row[];
  return rows.map((r) => String(r.name));
}

/* ---------------- 書き込み ---------------- */

function saveTags(articleId: string, tags: string[]): void {
  const db = getDb();
  db.prepare("DELETE FROM article_tags WHERE article_id = ?").run(articleId);
  const insertTag = db.prepare("INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING");
  const findTag = db.prepare("SELECT tag_id FROM tags WHERE name = ?");
  const link = db.prepare("INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)");
  for (const tag of tags) {
    insertTag.run(tag);
    const row = findTag.get(tag) as Row;
    link.run(articleId, Number(row.tag_id));
  }
  db.prepare("DELETE FROM tags WHERE tag_id NOT IN (SELECT tag_id FROM article_tags)").run();
}

export function createArticle(authorId: string, input: ArticleInput): Article {
  const articleId = randomBytes(6).toString("hex");
  const now = nowIso();
  transaction(() => {
    getDb()
      .prepare(
        `INSERT INTO articles (article_id, author_id, title, content, excerpt, thumbnail_url, thumbnail_focus_x, thumbnail_focus_y, category, status, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        articleId,
        authorId,
        input.title,
        JSON.stringify(input.content),
        makeExcerpt(input.content),
        input.thumbnailUrl,
        input.thumbnailFocusX,
        input.thumbnailFocusY,
        input.category,
        input.status,
        input.status === "published" ? now : null,
        now,
        now,
      );
    saveTags(articleId, input.tags);
  });
  return getArticle(articleId)!;
}

export function updateArticle(articleId: string, input: ArticleInput): Article {
  const now = nowIso();
  transaction(() => {
    // 初めて公開したときだけ publishedAt を記録（再公開・更新では元の日付を保持）
    getDb()
      .prepare(
        `UPDATE articles SET title = ?, content = ?, excerpt = ?, thumbnail_url = ?, thumbnail_focus_x = ?, thumbnail_focus_y = ?, category = ?, status = ?,
           published_at = CASE WHEN ? = 'published' AND published_at IS NULL THEN ? ELSE published_at END,
           updated_at = ?
         WHERE article_id = ?`,
      )
      .run(
        input.title,
        JSON.stringify(input.content),
        makeExcerpt(input.content),
        input.thumbnailUrl,
        input.thumbnailFocusX,
        input.thumbnailFocusY,
        input.category,
        input.status,
        input.status,
        now,
        now,
        articleId,
      );
    saveTags(articleId, input.tags);
  });
  return getArticle(articleId)!;
}

export function deleteArticle(articleId: string): void {
  transaction(() => {
    getDb().prepare("DELETE FROM articles WHERE article_id = ?").run(articleId);
    getDb().prepare("DELETE FROM tags WHERE tag_id NOT IN (SELECT tag_id FROM article_tags)").run();
  });
}

/** Admin は全記事、Editor は自分の記事のみ操作可能 */
export function canEdit(user: { userId: string; role: string }, article: { authorId: string }): boolean {
  return user.role === "admin" || article.authorId === user.userId;
}
