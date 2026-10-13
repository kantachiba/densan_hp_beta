/**
 * Users テーブルの操作。
 * role: admin（オーナー）/ editor（運営スタッフ）
 */
import { randomUUID } from "node:crypto";
import { getDb, nowIso, transaction } from "./db.ts";
import { hashPassword } from "./password.ts";

export type Role = "admin" | "editor";
export type UserStatus = "active" | "suspended";

export interface User {
  userId: string;
  loginId: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserWithStats extends User {
  articleCount: number;
}

export const ROLE_LABEL: Record<Role, string> = { admin: "Admin（オーナー）", editor: "Editor（スタッフ）" };

const LOGIN_ID_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

export function validateLoginId(loginId: string): string | null {
  return LOGIN_ID_RE.test(loginId) ? null : "ログインIDは半角英数字と _ . - の3〜32文字で入力してください";
}

export function validateDisplayName(name: string): string | null {
  if (!name.trim()) return "表示名を入力してください";
  if (name.length > 40) return "表示名は40文字以内にしてください";
  return null;
}

export const isRole = (v: unknown): v is Role => v === "admin" || v === "editor";

type Row = Record<string, unknown>;

function toUser(row: Row): User {
  return {
    userId: String(row.user_id),
    loginId: String(row.login_id),
    displayName: String(row.display_name),
    role: row.role as Role,
    status: row.status as UserStatus,
    mustChangePassword: Number(row.must_change_password) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getUserById(userId: string): User | null {
  const row = getDb().prepare("SELECT * FROM users WHERE user_id = ?").get(userId) as Row | undefined;
  return row ? toUser(row) : null;
}

/** ログイン用（パスワードハッシュ込み） */
export function getUserCredentials(loginId: string): (User & { passwordHash: string }) | null {
  const row = getDb().prepare("SELECT * FROM users WHERE login_id = ?").get(loginId) as Row | undefined;
  return row ? { ...toUser(row), passwordHash: String(row.password_hash) } : null;
}

export function getPasswordHash(userId: string): string | null {
  const row = getDb().prepare("SELECT password_hash FROM users WHERE user_id = ?").get(userId) as Row | undefined;
  return row ? String(row.password_hash) : null;
}

export function listUsers(): UserWithStats[] {
  const rows = getDb()
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM articles a WHERE a.author_id = u.user_id) AS article_count
       FROM users u ORDER BY u.role = 'admin' DESC, u.created_at ASC`,
    )
    .all() as Row[];
  return rows.map((r) => ({ ...toUser(r), articleCount: Number(r.article_count) }));
}

export function countUsers(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM users").get() as Row;
  return Number(row.c);
}

export function countActiveAdmins(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'")
    .get() as Row;
  return Number(row.c);
}

export function loginIdExists(loginId: string): boolean {
  return !!getDb().prepare("SELECT 1 FROM users WHERE login_id = ?").get(loginId);
}

export async function createUser(input: {
  loginId: string;
  password: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
}): Promise<User> {
  const userId = randomUUID();
  const passwordHash = await hashPassword(input.password);
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO users (user_id, login_id, password_hash, display_name, role, status, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
    .run(userId, input.loginId, passwordHash, input.displayName.trim(), input.role, input.mustChangePassword ? 1 : 0, now, now);
  return getUserById(userId)!;
}

export function updateUserRole(userId: string, role: Role): void {
  getDb().prepare("UPDATE users SET role = ?, updated_at = ? WHERE user_id = ?").run(role, nowIso(), userId);
}

export function updateUserStatus(userId: string, status: UserStatus): void {
  transaction(() => {
    getDb().prepare("UPDATE users SET status = ?, updated_at = ? WHERE user_id = ?").run(status, nowIso(), userId);
    if (status === "suspended") getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  });
}

export function updateDisplayName(userId: string, displayName: string): void {
  getDb()
    .prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE user_id = ?")
    .run(displayName.trim(), nowIso(), userId);
}

/**
 * パスワード更新。mustChange=true は管理者によるリセット（次回ログイン時に変更を強制）。
 * 他の端末のセッションは無効化する（keepSessionId のみ残す）。
 */
export async function setPassword(
  userId: string,
  password: string,
  opts: { mustChange: boolean; keepSessionId?: string },
): Promise<void> {
  const hash = await hashPassword(password);
  transaction(() => {
    getDb()
      .prepare("UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE user_id = ?")
      .run(hash, opts.mustChange ? 1 : 0, nowIso(), userId);
    getDb()
      .prepare("DELETE FROM sessions WHERE user_id = ? AND session_id != ?")
      .run(userId, opts.keepSessionId ?? "");
  });
}

/** ユーザー削除。記事は消さずに transferTo のユーザーへ引き継ぐ */
export function deleteUser(userId: string, transferTo: string): number {
  return transaction(() => {
    const moved = getDb()
      .prepare("UPDATE articles SET author_id = ? WHERE author_id = ?")
      .run(transferTo, userId);
    getDb().prepare("DELETE FROM users WHERE user_id = ?").run(userId);
    return Number(moved.changes);
  });
}
