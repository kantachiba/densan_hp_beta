/**
 * Admin（オーナー）アカウントを作成する CLI。
 *
 *   npm run cms:create-admin -- --login owner --name "電算機部 部長"
 *   npm run cms:create-admin -- --login owner --name "部長" --password "任意のパスワード"
 *
 * --password を省略すると初期パスワードを自動生成して表示する（初回ログイン時に変更を求める）。
 * 既存の loginId を指定した場合は、そのユーザーを Admin に昇格しパスワードをリセットする（締め出し時の復旧用）。
 */
import { parseArgs } from "node:util";
import { generatePassword, validatePassword } from "../src/lib/server/password.ts";
import {
  createUser,
  getUserCredentials,
  setPassword,
  updateUserRole,
  updateUserStatus,
  validateDisplayName,
  validateLoginId,
} from "../src/lib/server/users.ts";

const { values } = parseArgs({
  options: {
    login: { type: "string" },
    name: { type: "string" },
    password: { type: "string" },
  },
});

const fail = (msg: string): never => {
  console.error(`エラー: ${msg}`);
  console.error('使い方: npm run cms:create-admin -- --login <ログインID> --name "<表示名>" [--password <パスワード>]');
  process.exit(1);
};

const loginId = values.login?.trim() ?? fail("--login を指定してください");
const generated = !values.password;
const password = values.password ?? generatePassword();

const loginErr = validateLoginId(loginId);
if (loginErr) fail(loginErr);
const pwErr = validatePassword(password);
if (pwErr) fail(pwErr);

const existing = getUserCredentials(loginId);
if (existing) {
  updateUserRole(existing.userId, "admin");
  updateUserStatus(existing.userId, "active");
  await setPassword(existing.userId, password, { mustChange: generated });
  console.log(`既存ユーザー「${existing.displayName}」を Admin にし、パスワードをリセットしました。`);
} else {
  const displayName = values.name?.trim() ?? fail("--name を指定してください");
  const nameErr = validateDisplayName(displayName);
  if (nameErr) fail(nameErr);
  await createUser({ loginId, displayName, role: "admin", password, mustChangePassword: generated });
  console.log(`Admin アカウント「${displayName}」を作成しました。`);
}

console.log(`  ログインID : ${loginId}`);
if (generated) {
  console.log(`  初期パスワード: ${password}`);
  console.log("  （初回ログイン時にパスワードの変更が必要です）");
}
