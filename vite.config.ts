/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Content-Security-Policy jako <meta> (GitHub Pages nie pozwala ustawiać nagłówków).
 * Tylko w buildzie: serwer deweloperski Vite używa skryptów inline i WebSocketów HMR.
 * 'wasm-unsafe-eval' jest potrzebne dekoderom WASM pdf.js; zwykłe eval pozostaje zablokowane.
 */
function originOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function contentSecurityPolicy(apiUrl: string | undefined): Plugin {
  const apiOrigin = originOf(apiUrl);
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin}`.trim(),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
        injectTo: 'head-prepend',
      },
    ],
  };
}

// GitHub Pages serwuje aplikację pod /<repo>/, więc base musi się zgadzać z nazwą repozytorium.
// W CI ustawiane automatycznie z nazwy repo (VITE_BASE_PATH), lokalnie domyślnie /pdf-insight/.
const base = process.env.VITE_BASE_PATH ?? '/pdf-insight/';

export default defineConfig(({ mode }) => ({
  base,
  plugins: [react(), contentSecurityPolicy(loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL)],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
    environment: 'node',
  },
}));
