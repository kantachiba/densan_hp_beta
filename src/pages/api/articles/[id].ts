import type { APIRoute } from "astro";
import { canEdit, deleteArticle, getArticle, parseArticleInput, updateArticle } from "../../../lib/server/articles.ts";
import { json, jsonError, readJson } from "../../../lib/server/http.ts";

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const article = getArticle(params.id ?? "");
  if (!article) return jsonError(404, "記事が見つかりません");
  if (!canEdit(locals.user!, article)) return jsonError(403, "この記事を編集する権限がありません");

  const body = await readJson(request);
  if (!body) return jsonError(400, "リクエストの形式が不正か、本文が大きすぎます");
  const parsed = parseArticleInput(body);
  if ("error" in parsed) return jsonError(422, parsed.error);

  // 他の端末・タブでの更新を上書きしないよう、編集開始時の updatedAt と照合
  const base = (body as { baseUpdatedAt?: unknown }).baseUpdatedAt;
  if (typeof base === "string" && base !== article.updatedAt) {
    return jsonError(409, "この記事は別の画面で更新されています。ページを再読み込みしてから編集してください");
  }

  return json({ article: updateArticle(article.articleId, parsed.input) });
};

export const DELETE: APIRoute = ({ params, locals }) => {
  const article = getArticle(params.id ?? "");
  if (!article) return jsonError(404, "記事が見つかりません");
  if (!canEdit(locals.user!, article)) return jsonError(403, "この記事を削除する権限がありません");
  deleteArticle(article.articleId);
  return json({ ok: true });
};
