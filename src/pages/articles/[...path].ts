import type { APIRoute } from "astro";

/** 旧 URL（/articles/...）から /news/... への恒久リダイレクト */
export const GET: APIRoute = ({ params, url, redirect }) =>
  redirect(`/news${params.path ? `/${params.path}` : ""}${url.search}`, 301);
