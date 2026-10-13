/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** ログイン中のユーザー（未ログインなら null） */
    user: import("./lib/server/auth.ts").SessionUser | null;
  }
}
