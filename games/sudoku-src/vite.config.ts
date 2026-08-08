import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 公開URL は https://qiqiroon.github.io/momo/games/sudoku/
// ビルド成果物は隣の games/sudoku/ へ出す（ソース分離型・C-129）
export default defineConfig({
  base: '/momo/games/sudoku/',
  plugins: [react()],
  resolve: {
    alias: {
      '@momo-lib': resolve(__dirname, '..', '..', 'lib'),
    },
  },
  build: {
    outDir: resolve(__dirname, '..', 'sudoku'),
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
