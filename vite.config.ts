/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

/** Unique per build: the Vercel commit SHA when available, otherwise a timestamp. Used to version the SW cache. */
function buildId(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  const stamp = Date.now().toString(36);
  return sha ? `${sha.slice(0, 8)}-${stamp}` : stamp;
}

export default defineConfig(({ mode }) => ({
  base: '/',
  plugins: [react(), tailwindcss(), ...(mode === 'https' ? [basicSsl()] : [])],
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
    // The lazy physics chunk (Rapier compat build, wasm inlined) is ~2.2 MB raw / ~850 KB gzip by
    // design: it loads only after the gate on tiers 1–2, never on the critical path.
    chunkSizeWarningLimit: 2400,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
}));
