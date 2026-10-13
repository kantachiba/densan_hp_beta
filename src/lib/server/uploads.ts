/**
 * 画像アップロード。
 * sharp で必ずデコード→再エンコードするため、画像に見せかけたファイルは弾かれ、
 * EXIF（撮影位置情報など）も除去される。SVG はスクリプトを含められるため受け付けない。
 */
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import { UPLOAD_DIR, getDb } from "./db.ts";

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const MAX_WIDTH = 2000;
const ACCEPTED = new Set(["jpeg", "png", "webp", "gif", "avif", "heif"]);

const FILE_RE = /^([a-f0-9]{32})\.(webp|gif)$/;
const MIME: Record<string, string> = { webp: "image/webp", gif: "image/gif" };

export class UploadError extends Error {}

export async function saveImage(file: File): Promise<{ url: string; width: number; height: number }> {
  if (file.size === 0) throw new UploadError("ファイルが空です");
  if (file.size > UPLOAD_MAX_BYTES) throw new UploadError("画像は10MB以下にしてください");

  const input = Buffer.from(await file.arrayBuffer());
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new UploadError("画像ファイルとして読み込めませんでした");
  }
  if (!meta.format || !ACCEPTED.has(meta.format)) {
    throw new UploadError("JPEG / PNG / WebP / GIF 形式の画像をアップロードしてください");
  }

  const animated = (meta.pages ?? 1) > 1;
  const pipeline = sharp(input, { animated }).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true });
  // アニメーションGIFはGIFのまま、それ以外はWebPに統一
  const ext = animated && meta.format === "gif" ? "gif" : "webp";
  const { data, info } = await (ext === "gif" ? pipeline.gif() : pipeline.webp({ quality: 82 })).toBuffer({
    resolveWithObject: true,
  });

  getDb(); // アップロード先ディレクトリの作成を保証
  const name = `${randomBytes(16).toString("hex")}.${ext}`;
  await writeFile(path.join(UPLOAD_DIR, name), data);
  return { url: `/uploads/${name}`, width: info.width, height: info.pageHeight ?? info.height };
}

export async function readUpload(name: string): Promise<{ data: Buffer; type: string } | null> {
  const m = FILE_RE.exec(name);
  if (!m) return null;
  try {
    const data = await readFile(path.join(UPLOAD_DIR, name));
    return { data, type: MIME[m[2]] };
  } catch {
    return null;
  }
}
