/**
 * 本文中の画像のレイアウト属性（幅・配置・トリミング）。
 * エディタ（クライアント）と保存・描画（サーバー）の両方から使うため、
 * 正規化のルールをここ一箇所に置く。
 *
 * トリミングは元画像を加工せず、枠の縦横比と表示位置（object-position）で表現する。
 * あとから比率を変えても画質は落ちず、元の画像にいつでも戻せる。
 */

export const IMAGE_RATIOS = ["16:9", "3:2", "4:3", "1:1", "3:4", "9:16"] as const;
export type ImageRatio = (typeof IMAGE_RATIOS)[number];

export const IMAGE_ALIGNS = ["left", "center", "right"] as const;
export type ImageAlign = (typeof IMAGE_ALIGNS)[number];

export const WIDTH_MIN = 25;
export const WIDTH_MAX = 100;
export const ZOOM_MIN = 100;
export const ZOOM_MAX = 300;

export interface ImageLayout {
  width: number;
  align: ImageAlign;
  ratio: ImageRatio | null;
  focusX: number;
  focusY: number;
  zoom: number;
}

export const DEFAULT_LAYOUT: ImageLayout = {
  width: WIDTH_MAX,
  align: "center",
  ratio: null,
  focusX: 50,
  focusY: 50,
  zoom: 100,
};

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

export function normalizeWidth(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? clamp(n, WIDTH_MIN, WIDTH_MAX) : DEFAULT_LAYOUT.width;
}

export function normalizeAlign(value: unknown): ImageAlign {
  return IMAGE_ALIGNS.includes(value as ImageAlign) ? (value as ImageAlign) : DEFAULT_LAYOUT.align;
}

export function normalizeRatio(value: unknown): ImageRatio | null {
  return IMAGE_RATIOS.includes(value as ImageRatio) ? (value as ImageRatio) : null;
}

export function normalizeFocus(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? clamp(n, 0, 100) : 50;
}

export function normalizeZoom(value: unknown): number {
  const n = Math.round(Number(value) / 10) * 10;
  return Number.isFinite(n) ? clamp(n, ZOOM_MIN, ZOOM_MAX) : DEFAULT_LAYOUT.zoom;
}

export function normalizeLayout(attrs: Record<string, unknown> | undefined): ImageLayout {
  const ratio = normalizeRatio(attrs?.ratio);
  return {
    width: normalizeWidth(attrs?.width),
    align: normalizeAlign(attrs?.align),
    ratio,
    focusX: normalizeFocus(attrs?.focusX),
    focusY: normalizeFocus(attrs?.focusY),
    zoom: ratio ? normalizeZoom(attrs?.zoom) : DEFAULT_LAYOUT.zoom,
  };
}

/** aspect-ratio に渡せる形（"16:9" → "16 / 9"） */
export const ratioToCss = (ratio: ImageRatio): string => ratio.replace(":", " / ");

/** figure に付けるインラインスタイル。既定値のときは何も出さない */
export function layoutStyle(layout: ImageLayout): string {
  const parts: string[] = [];
  if (layout.width !== WIDTH_MAX) parts.push(`--img-w:${layout.width}%`);
  if (layout.ratio) {
    parts.push(`--img-ratio:${ratioToCss(layout.ratio)}`);
    parts.push(`--img-pos:${layout.focusX}% ${layout.focusY}%`);
    if (layout.zoom !== DEFAULT_LAYOUT.zoom) parts.push(`--img-zoom:${layout.zoom / 100}`);
  }
  return parts.join(";");
}

export const focusToCss = (x: unknown, y: unknown): string =>
  `${normalizeFocus(x)}% ${normalizeFocus(y)}%`;
