export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

export const jsonError = (status: number, error: string): Response => json({ error }, status);

const CONTENT_MAX_BYTES = 2 * 1024 * 1024;

/** JSON ボディを読み取る（サイズ上限つき）。失敗時は null */
export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) return null;
  const text = await request.text();
  if (text.length > CONTENT_MAX_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
