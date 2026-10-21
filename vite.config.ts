import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Vite configuration for the Tauri desktop shell.
 * - `@/` resolves to `src/` (mirrors tsconfig paths).
 * - Fixed port 5173 because tauri.conf.json `devUrl` points to it.
 * - Vitest runs domain unit tests in a Node environment.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  // Desktop app loads assets from disk, so one larger bundle is fine.
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
