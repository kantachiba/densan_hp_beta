import type { APIRoute } from "astro";
import { readUpload } from "../../lib/server/uploads.ts";

export const GET: APIRoute = async ({ params }) => {
  const file = await readUpload(params.file ?? "");
  if (!file) return new Response("Not Found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.type,
      // ファイル名はランダムで内容は不変
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
};
