/**
 * SQLite 接続とスキーマ定義（Node.js 組み込みの node:sqlite を使用）。
 * データの保存先は環境変数 CMS_DATA_DIR（未指定時は ./data）。
 * スキーマはアプリ起動時に自動で作成される（CREATE TABLE IF NOT EXISTS）。
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(process.env.CMS_DATA_DIR ?? "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  user_id              TEXT PRIMARY KEY,
  login_id             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash        TEXT NOT NULL,
  display_name         TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('admin', 'editor')),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS articles (
  article_id    TEXT PRIMARY KEY,
  author_id     TEXT NOT NULL REFERENCES users(user_id),
  title         TEXT NOT NULL DEFAULT '',
  content       TEXT NOT NULL,
  excerpt       TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT,
  category      TEXT,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_public ON articles(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_author ON articles(author_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS tags (
  tag_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS article_tags (
  article_id  TEXT NOT NULL REFERENCES articles(article_id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_article_tags_tag ON article_tags(tag_id);

CREATE TABLE IF NOT EXISTS members (
  member_id   TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT '',
  profile     TEXT NOT NULL DEFAULT '',
  image_url   TEXT,
  links       TEXT NOT NULL DEFAULT '[]',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
`;

/** members テーブルを初めて作ったときだけ入れる、差し替え前提のテンプレート部員 */
const TEMPLATE_MEMBER_ROLES = ["部長 / 4年", "副部長 / 4年", "会計 / 3年", "ゲーム開発 / 3年", "3Dモデリング / 2年", "競技プログラミング / 1年"];
const TEMPLATE_MEMBER_PROFILE =
  "ここにプロフィールが入ります。担当している分野や得意な技術、これまでに作ったものなどを2〜3行で紹介します。";

function seedTemplateMembers(conn: DatabaseSync): void {
  const insert = conn.prepare(
    "INSERT INTO members (member_id, name, role, profile, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const now = nowIso();
  TEMPLATE_MEMBER_ROLES.forEach((role, i) => {
    const no = String(i + 1).padStart(2, "0");
    insert.run(`member-${no}`, `部員 ${no}`, role, TEMPLATE_MEMBER_PROFILE, i, now, now);
  });
}

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(UPLOAD_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, "cms.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  const hadMembers = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'members'").get();
  db.exec(SCHEMA);
  if (!hadMembers) seedTemplateMembers(db);
  const cols = new Set(
    (db.prepare("PRAGMA table_info(articles)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!cols.has("thumbnail_focus_x")) {
    db.exec("ALTER TABLE articles ADD COLUMN thumbnail_focus_x INTEGER NOT NULL DEFAULT 50");
  }
  if (!cols.has("thumbnail_focus_y")) {
    db.exec("ALTER TABLE articles ADD COLUMN thumbnail_focus_y INTEGER NOT NULL DEFAULT 50");
  }
  return db;
}

/** BEGIN〜COMMIT で囲んで実行し、例外時は ROLLBACK する */
export function transaction<T>(fn: () => T): T {
  const conn = getDb();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    conn.exec("COMMIT");
    return result;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}

export const nowIso = (): string => new Date().toISOString();
