import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 公開URL は https://qiqiroon.github.io/momo/games/mahjong/
// ビルド成果物は隣の games/mahjong/ へ出す（ソース分離型）
// emptyOutDir で出来上がりは毎回まるごと作り直す＝そこに置くものは必ず public/ に置く
export default defineConfig({
  base: '/momo/games/mahjong/',
  plugins: [react()],
  resolve: {
    alias: {
      '@momo-lib': resolve(__dirname, '..', '..', 'lib'),
    },
  },
  server: {
    port: 5190,
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, '..', 'mahjong'),
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
