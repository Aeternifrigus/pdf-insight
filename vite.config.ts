/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// GitHub Pages serwuje aplikację pod /<repo>/, więc base musi się zgadzać z nazwą repozytorium.
// W CI ustawiane automatycznie z nazwy repo (VITE_BASE_PATH), lokalnie domyślnie /pdf-insight/.
const base = process.env.VITE_BASE_PATH ?? '/pdf-insight/';

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
    environment: 'node',
  },
});
