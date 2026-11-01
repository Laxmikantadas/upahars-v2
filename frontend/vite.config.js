import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), {
      name: 'site-url-in-html',
      // Puts your real domain (VITE_SITE_URL) into index.html's canonical / social tags at build time.
      transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', (env.VITE_SITE_URL || 'https://upahars.in').replace(/\/$/, '')),
    }],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      port: 5173,
      // In development the browser talks to /api on the Vite server, which forwards to the backend.
      // Same-origin requests mean the login cookie just works (no CORS setup needed).
      proxy: { '/api': { target: env.VITE_API_TARGET || 'http://localhost:5000', changeOrigin: false } },
    },
  };
});
