/**
 * パスワードのハッシュ化（scrypt + ランダムソルト）。
 * 保存形式: scrypt$N$r$p$<salt(base64)>$<hash(base64)>
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 1 << 15;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const MAX_MEM = 64 * 1024 * 1024;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

function scryptAsync(password: string, salt: Buffer, keyLen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LEN, { N, r: R, p: P, maxmem: MAX_MEM });
  return ["scrypt", N, R, P, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAX_MEM,
  });
  return timingSafeEqual(actual, expected);
}

/** ユーザーが存在しない場合も同じ計算時間をかけ、ログインIDの存在を推測されにくくする */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `パスワードは${PASSWORD_MIN}文字以上にしてください`;
  if (password.length > PASSWORD_MAX) return `パスワードは${PASSWORD_MAX}文字以内にしてください`;
  return null;
}

/** 初期パスワードの自動生成（紛らわしい文字 0/O/1/l/I を除外） */
export function generatePassword(length = 14): string {
  const chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}
