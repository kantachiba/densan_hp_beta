/**
 * メンバーに載せるリンクの種類。
 * プリセット（GitHub / X / Instagram）はロゴで表示し、URL の代わりにユーザー名だけでも登録できる。
 * それ以外は "other" として、表示名 + URL を自由に追加する。
 * プリセットを増やすときはここに1行足し、src/components/SocialIcon.astro に同じ id のロゴを追加する。
 */
export const LINK_PRESETS = {
  github: { label: "GitHub", base: "https://github.com/" },
  x: { label: "X", base: "https://x.com/" },
  instagram: { label: "Instagram", base: "https://www.instagram.com/" },
} as const;

export type LinkPreset = keyof typeof LINK_PRESETS;
export type LinkType = LinkPreset | "other";

export interface MemberLink {
  type: LinkType;
  url: string;
  /** 画面に出す名前（プリセットはサービス名、other は入力された表示名） */
  label: string;
}

export const LINKS_MAX = 8;
export const LINK_LABEL_MAX = 20;
export const LINK_URL_MAX = 300;

export const isLinkPreset = (v: unknown): v is LinkPreset => typeof v === "string" && Object.hasOwn(LINK_PRESETS, v);

const HANDLE_RE = /^[A-Za-z0-9_.-]{1,40}$/;

/** http(s) の URL だけを通す（javascript: などを弾く）。不正なら null */
export function safeHttpUrl(value: string): string | null {
  if (value.length > LINK_URL_MAX || !/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * 入力1行分を検証して MemberLink にする。
 * URL 欄が空の行は null（＝無視）。不正な行は { error }。
 */
export function normalizeLink(type: string, value: string, label: string): MemberLink | null | { error: string } {
  const v = value.trim();
  if (!v) return null;

  if (isLinkPreset(type)) {
    const preset = LINK_PRESETS[type];
    const handle = v.replace(/^@/, "");
    const url = safeHttpUrl(v) ?? (HANDLE_RE.test(handle) ? preset.base + handle : null);
    if (!url) return { error: `${preset.label} のリンクは URL（https://…）かユーザー名で入力してください` };
    return { type, url, label: preset.label };
  }

  const name = label.trim();
  if (!name) return { error: "追加したリンクには表示名を入力してください" };
  if (name.length > LINK_LABEL_MAX) return { error: `リンクの表示名は${LINK_LABEL_MAX}文字以内にしてください` };
  const url = safeHttpUrl(v);
  if (!url) return { error: `「${name}」のリンクは https:// から始まる URL で入力してください` };
  return { type: "other", url, label: name };
}
