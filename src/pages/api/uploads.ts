import type { APIRoute } from "astro";
import { json, jsonError } from "../../lib/server/http.ts";
import { UploadError, saveImage } from "../../lib/server/uploads.ts";

export const POST: APIRoute = async ({ request }) => {
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return jsonError(400, "アップロードに失敗しました（ファイルが大きすぎる可能性があります）");
  }
  if (!(file instanceof File)) return jsonError(400, "画像ファイルを選択してください");

  try {
    return json(await saveImage(file), 201);
  } catch (err) {
    if (err instanceof UploadError) return jsonError(422, err.message);
    console.error("[upload]", err);
    return jsonError(500, "画像の処理中にエラーが発生しました");
  }
};
