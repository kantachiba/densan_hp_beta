/**
 * 全リクエスト共通の認証・認可。
 *   /admin/**        … ログイン必須
 *   /admin/users/**  … Admin のみ
 *   /api/**          … ログイン必須（JSON で 401/403 を返す）
 * 初期パスワードのままのユーザーは、パスワード変更画面以外に進めない。
 *
 * CSRF 対策の Origin 照合もここで行う（astro の security.checkOrigin は無効化）。
 * Cloudflare などが手前で HTTPS を終端すると、Origin は https://…、アプリが見る
 * リクエストは http://… になり、scheme まで比べると正規の POST まで弾かれる。
 * 判定はホスト名だけを見る。
 */
import { defineMiddleware } from "astro:middleware";
import { getSessionUser, isAdmin } from "./lib/server/auth.ts";

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const FORM_CONTENT_TYPES = ["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"];

const firstHeaderValue = (value: string | null) => value?.split(",")[0]?.trim() || undefined;

const requestHost = (context: { request: Request; url: URL }) =>
  firstHeaderValue(context.request.headers.get("x-forwarded-host")) ??
  context.request.headers.get("host") ??
  context.url.host;

/** ホスト名が同じなら同一オリジンとみなす（プロキシの TLS 終端で scheme が食い違っても通す）。 */
const isSameSiteOrigin = (originHeader: string | null, host: string) => {
  if (!originHeader || !host) return false;
  try {
    return new URL(originHeader).host === host;
  } catch {
    return false;
  }
};

/** astro 標準と同じ判定基準（フォーム形式の content-type のみ Origin 必須）。 */
const isForbiddenCrossOrigin = (context: { request: Request; url: URL }) => {
  const { request } = context;
  if (SAFE_METHODS.has(request.method)) return false;
  const sameOrigin = isSameSiteOrigin(request.headers.get("origin"), requestHost(context));
  const contentType = request.headers.get("content-type");
  if (contentType === null) return !sameOrigin;
  const formLike = FORM_CONTENT_TYPES.some((t) => contentType.toLowerCase().includes(t));
  return formLike && !sameOrigin;
};

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.user = null;
  if (context.isPrerendered) return next();

  if (isForbiddenCrossOrigin(context)) {
    return new Response(`Cross-site ${context.request.method} form submissions are forbidden`, { status: 403 });
  }

  const { pathname } = context.url;
  const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
  const isApi = pathname.startsWith("/api/");

  if (isAdminPage || isApi || pathname === "/login") {
    context.locals.user = getSessionUser(context.cookies);
  }
  const user = context.locals.user;

  if (isApi) {
    if (!user) return json(401, "ログインが必要です");
    if (user.mustChangePassword) return json(403, "パスワードを変更してください");
  }

  if (isAdminPage) {
    if (!user) {
      return context.redirect(`/login?next=${encodeURIComponent(pathname + context.url.search)}`);
    }
    if (user.mustChangePassword && pathname !== "/admin/account") {
      return context.redirect("/admin/account?required=1");
    }
    if (pathname.startsWith("/admin/users") && !isAdmin(user)) {
      return new Response("この画面にアクセスする権限がありません", { status: 403 });
    }
  }

  const response = await next();

  if (isAdminPage || isApi || pathname === "/login") {
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Referrer-Policy", "same-origin");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
});
