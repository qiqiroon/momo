import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 成果物は tools/kjcards/ へ直接出力（Shogi と同じ「ソース分離」方式）。
// base はGitHub Pages のサブパス公開に合わせる。
export default defineConfig({
  base: '/momo/tools/kjcards/',
  plugins: [react()],
  resolve: {
    alias: {
      '@momo-lib': resolve(__dirname, '..', '..', 'lib'),
    },
  },
  build: {
    outDir: resolve(__dirname, '..', 'kjcards'),
    emptyOutDir: true,
  },
});
