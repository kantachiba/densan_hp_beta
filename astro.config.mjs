// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://densan.nitnc.club',
  // トップページは静的生成（prerender）、記事・管理画面はサーバーで都度レンダリング
  output: 'server',
  // Origin 照合は src/middleware.ts で行う（プロキシ経由の https を正しく扱うため）
  security: { checkOrigin: false },
  adapter: node({
    mode: 'standalone',
    // 画像アップロード上限（10MB）+ フォームのオーバーヘッド
    bodySizeLimit: 12 * 1024 * 1024,
  }),
  vite: {
    plugins: [tailwindcss()],
  },
});
