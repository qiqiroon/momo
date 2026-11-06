import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// 公開URL は https://qiqiroon.github.io/momo/games/polyomino/
// base は相対（./）。どの階層に置いても動く（Cube と同じ）
// 出来上がりは隣の games/polyomino/ へ出す（ソース分離型）
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': resolve(here, 'src'),
      // MOMO 共通ライブラリ（言語の切替 lib/momo-lang）
      '@momo-lib': resolve(here, '..', '..', 'lib'),
    },
  },
  build: {
    outDir: resolve(here, '..', 'polyomino'),
    emptyOutDir: true,
  },
  server: {
    port: 5195,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
