import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: '/momo/games/shogi/',
  plugins: [react()],
  resolve: {
    alias: {
      '@momo-lib': resolve(__dirname, '..', '..', 'lib'),
      '@momo-mm': resolve(__dirname, '..', 'matchmaking'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        b: resolve(__dirname, 'index.html'),
        a: resolve(__dirname, 'index-a.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    /**
     * **検査を走らせる時計は日本時間に固定する**。
     *
     * 棋譜のファイル名は先頭に「日付と時刻」が入り、これは**その機械の時計**で描かれる
     * (親 §9.2.2)。検査は日本時間の答えを直に書いているので、世界標準時で動く CI では
     * 9 時間ずれて落ちていた (2026-08-16 の v1.41 から 6 回連続で赤・第43セッションで判明)。
     *
     * 製品の振る舞いは正しい (保存する人の時計で名前が付く) ので、**直すのは検査の側だけ**。
     * ここで固定しておけば、今後どの日時を材料に検査を書いても同じ落とし穴にはまらない。
     */
    env: { TZ: 'Asia/Tokyo' },
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
