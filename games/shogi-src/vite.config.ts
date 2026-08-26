import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * **画面の土台（jsdom）が要る検査**。
 *
 * - `.tsx` は画面を組み立てて確かめるものなので全部
 * - 通信まわりの `.ts` は、相手役の口を `window` にぶら下げて差し替えている
 * - 残り 3 本は保存・表示まわりで画面の部品に触る
 *
 * **ここに書き忘れた検査は「画面が無い」と言って落ちる**（黙って別のことを確かめる形に
 * はならない）。壊し確認済み：この一覧から `.tsx` を外すと 22 件中 14 件が赤になる。
 */
const DOM_TESTS = [
  'src/**/*.test.tsx',
  'src/features/matchmaking/**/*.test.ts',
  'src/adapters/selfmade-alphabeta/search.test.ts',
  'src/core/store/quantum-display.test.ts',
  'src/features/kifu-replay/kifu.test.ts',
];

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
    /**
     * ★**既定は画面なし**（2026-08-26・検査の高速化）。
     *
     * 実測：検査 1 本あたり 45 秒のうち**約 25 秒が画面の土台（jsdom）の組み立て**で、
     * 中身の判定は 0.02 秒しかない。**126 本のうち 113 本は盤の計算しか見ていない**ので、
     * その分の土台を作らないだけで全体が縮む（フル検査 946 秒 → 467 秒・実測）。
     *
     * **画面が要る検査は上の一覧で名指しする。**
     */
    environment: 'node',
    environmentMatchGlobs: DOM_TESTS.map((glob) => [glob, 'jsdom'] as [string, string]),
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
