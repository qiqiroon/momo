import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// 公開URL は https://qiqiroon.github.io/momo/games/cube/
// base は相対（./）。どの階層に置いても動く（設計 09 §2・§3.2）
// 出来上がりは隣の games/cube/ へ出す（ソース分離型。数独と同じ）
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': resolve(here, 'src'),
      // MOMO 共通ライブラリ（言語の切替 lib/momo-lang）。数独と同じ置き方
      '@momo-lib': resolve(here, '..', '..', 'lib'),
    },
  },
  build: {
    outDir: resolve(here, '..', 'cube'),
    emptyOutDir: true,
  },
  server: {
    port: 5191,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 全 N を総当たりする重いテスト（move・drag）は、並べて回すと 5 秒を超えることがある
    testTimeout: 20000,
  },
});
