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
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
