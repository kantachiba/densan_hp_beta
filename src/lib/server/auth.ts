/**
 * セッション認証。
 * Cookie にはランダムなトークンのみを入れ、DB には SHA-256 ハッシュを保存する
 * （DB が漏えいしてもセッションを乗っ取れない）。
 */
import { createHash, randomBytes } from "node:crypto";
import type { AstroCookies } from "astro";
import { getDb, nowIso } from "./db.ts";
import type { Role, User } from "./users.ts";
import { getUserById } from "./users.ts";

export const SESSION_COOKIE = "densan_session";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const RENEW_THRESHOLD_MS = SESSION_TTL_MS / 2;

export interface SessionUser extends User {
  sessionId: string;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function setCookie(cookies: AstroCookies, token: string, expiresAt: number): void {
  cookies.set(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: import.meta.env.PROD,
    expires: new Date(expiresAt),
  });
}

export function createSession(cookies: AstroCookies, userId: string): void {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  getDb()
    .prepare("INSERT INTO sessions (session_id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(hashToken(token), userId, expiresAt, nowIso());
  setCookie(cookies, token, expiresAt);
}

/** Cookie からログイン中ユーザーを取得。停止中ユーザー・期限切れは null */
export function getSessionUser(cookies: AstroCookies): SessionUser | null {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const sessionId = hashToken(token);
  const db = getDb();
  const row = db.prepare("SELECT user_id, expires_at FROM sessions WHERE session_id = ?").get(sessionId) as
    | { user_id: string; expires_at: number }
    | undefined;
  if (!row) return null;

  const now = Date.now();
  if (Number(row.expires_at) <= now) {
    db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
    return null;
  }
  const user = getUserById(row.user_id);
  if (!user || user.status !== "active") return null;

  // スライディング更新: 期限の半分を過ぎたら延長
  if (Number(row.expires_at) - now < RENEW_THRESHOLD_MS) {
    const expiresAt = now + SESSION_TTL_MS;
    db.prepare("UPDATE sessions SET expires_at = ? WHERE session_id = ?").run(expiresAt, sessionId);
    setCookie(cookies, token, expiresAt);
  }
  return { ...user, sessionId };
}

export function destroySession(cookies: AstroCookies): void {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) getDb().prepare("DELETE FROM sessions WHERE session_id = ?").run(hashToken(token));
  cookies.delete(SESSION_COOKIE, { path: "/" });
}

export function purgeExpiredSessions(): void {
  getDb().prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
}

export const isAdmin = (user: { role: Role } | null | undefined): boolean => user?.role === "admin";

/* ============================================================
   ログイン試行のレート制限（メモリ内・単一プロセス前提）
   同一 IP + ログインID で 15 分間に 5 回失敗するとロック
   ============================================================ */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const failures = new Map<string, { count: number; first: number }>();

const throttleKey = (ip: string, loginId: string) => `${ip}|${loginId.toLowerCase()}`;

export function isLoginLocked(ip: string, loginId: string): boolean {
  const entry = failures.get(throttleKey(ip, loginId));
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    failures.delete(throttleKey(ip, loginId));
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

export function recordLoginFailure(ip: string, loginId: string): void {
  const key = throttleKey(ip, loginId);
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
  else entry.count++;
  if (failures.size > 10_000) failures.clear();
}

export function clearLoginFailures(ip: string, loginId: string): void {
  failures.delete(throttleKey(ip, loginId));
}

/** ログイン後のリダイレクト先として安全なパスか（オープンリダイレクト防止） */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/admin";
  return next;
}
