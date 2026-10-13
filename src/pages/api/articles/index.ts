import type { APIRoute } from "astro";
import { createArticle, parseArticleInput } from "../../../lib/server/articles.ts";
import { json, jsonError, readJson } from "../../../lib/server/http.ts";

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await readJson(request);
  if (!body) return jsonError(400, "リクエストの形式が不正か、本文が大きすぎます");
  const parsed = parseArticleInput(body);
  if ("error" in parsed) return jsonError(422, parsed.error);
  const article = createArticle(locals.user!.userId, parsed.input);
  return json({ article }, 201);
};
