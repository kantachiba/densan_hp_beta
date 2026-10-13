/**
 * Members テーブルの操作（メンバー紹介）。
 * トップページのマーキーと /members に sort_order の順で表示される。
 */
import { randomBytes } from "node:crypto";
import { getDb, nowIso, transaction } from "./db.ts";
import { LINKS_MAX, normalizeLink, type MemberLink } from "../member-links.ts";

export interface Member {
  memberId: string;
  name: string;
  /** 役職・学年など、名前に添える短い1行 */
  role: string;
  profile: string;
  imageUrl: string | null;
  links: MemberLink[];
  updatedAt: string;
}

export type MemberInput = Omit<Member, "memberId" | "updatedAt">;

export const NAME_MAX = 40;
export const ROLE_MAX = 40;
export const PROFILE_MAX = 400;

const IMAGE_RE = /^\/uploads\/[a-f0-9]{32}\.(webp|gif)$/;

type Row = Record<string, unknown>;

function parseLinks(json: unknown): MemberLink[] {
  try {
    const list: unknown = JSON.parse(String(json));
    if (!Array.isArray(list)) return [];
    return list.flatMap((item) => {
      const link = normalizeLink(String(item?.type ?? ""), String(item?.url ?? ""), String(item?.label ?? ""));
      return link && !("error" in link) ? [link] : [];
    });
  } catch {
    return [];
  }
}

function toMember(row: Row): Member {
  return {
    memberId: String(row.member_id),
    name: String(row.name),
    role: String(row.role),
    profile: String(row.profile),
    imageUrl: row.image_url ? String(row.image_url) : null,
    links: parseLinks(row.links),
    updatedAt: String(row.updated_at),
  };
}

export function listMembers(): Member[] {
  const rows = getDb().prepare("SELECT * FROM members ORDER BY sort_order, created_at").all() as Row[];
  return rows.map(toMember);
}

export function getMember(memberId: string): Member | null {
  const row = getDb().prepare("SELECT * FROM members WHERE member_id = ?").get(memberId) as Row | undefined;
  return row ? toMember(row) : null;
}

/**
 * フォーム入力を検証する。画像はここでは扱わない（呼び出し側でアップロード後に imageUrl を渡す）。
 * リンクは linkType / linkUrl / linkLabel を同じ順番で複数送る。
 */
export function parseMemberForm(form: FormData, imageUrl: string | null): { input: MemberInput } | { error: string } {
  const name = String(form.get("name") ?? "").trim();
  const role = String(form.get("role") ?? "").trim();
  const profile = String(form.get("profile") ?? "").replace(/\r\n/g, "\n").trim();

  if (!name) return { error: "名前を入力してください" };
  if (name.length > NAME_MAX) return { error: `名前は${NAME_MAX}文字以内にしてください` };
  if (role.length > ROLE_MAX) return { error: `役職・学年は${ROLE_MAX}文字以内にしてください` };
  if (profile.length > PROFILE_MAX) return { error: `プロフィールは${PROFILE_MAX}文字以内にしてください` };
  if (imageUrl !== null && !IMAGE_RE.test(imageUrl)) return { error: "アイコン画像の指定が不正です" };

  const types = form.getAll("linkType").map(String);
  const urls = form.getAll("linkUrl").map(String);
  const labels = form.getAll("linkLabel").map(String);
  const links: MemberLink[] = [];
  for (let i = 0; i < urls.length; i++) {
    const link = normalizeLink(types[i] ?? "", urls[i], labels[i] ?? "");
    if (!link) continue;
    if ("error" in link) return { error: link.error };
    links.push(link);
  }
  if (links.length > LINKS_MAX) return { error: `リンクは${LINKS_MAX}件までです` };

  return { input: { name, role, profile, imageUrl, links } };
}

/** 一覧の末尾に追加する */
export function createMember(input: MemberInput): Member {
  const memberId = randomBytes(6).toString("hex");
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO members (member_id, name, role, profile, image_url, links, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM members), ?, ?)`,
    )
    .run(memberId, input.name, input.role, input.profile, input.imageUrl, JSON.stringify(input.links), now, now);
  return getMember(memberId)!;
}

export function updateMember(memberId: string, input: MemberInput): void {
  getDb()
    .prepare("UPDATE members SET name = ?, role = ?, profile = ?, image_url = ?, links = ?, updated_at = ? WHERE member_id = ?")
    .run(input.name, input.role, input.profile, input.imageUrl, JSON.stringify(input.links), nowIso(), memberId);
}

export function deleteMember(memberId: string): void {
  getDb().prepare("DELETE FROM members WHERE member_id = ?").run(memberId);
}

/** 表示順を1つ前（-1）/ 後ろ（+1）へ動かす。端にいるときは何もしない */
export function moveMember(memberId: string, direction: -1 | 1): void {
  transaction(() => {
    const db = getDb();
    const ids = (db.prepare("SELECT member_id FROM members ORDER BY sort_order, created_at").all() as Row[]).map((r) =>
      String(r.member_id),
    );
    const from = ids.indexOf(memberId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    const update = db.prepare("UPDATE members SET sort_order = ? WHERE member_id = ?");
    ids.forEach((id, i) => update.run(i, id));
  });
}
