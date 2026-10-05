import { defineConfig, devices } from '@playwright/test';

/**
 * Testy E2E na zbudowanej aplikacji (vite preview). Backend jest mockowany przez page.route,
 * więc testy nie potrzebują klucza API ani sieci, a sprawdzają to, co frontend wysyła.
 * PW_CHROMIUM_PATH pozwala użyć własnej przeglądarki (np. gdy nie da się pobrać Chromium).
 */
const PORT = 4174;
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${String(PORT)}/pdf-insight/`,
    trace: 'retain-on-failure',
    launchOptions: executablePath
      ? { executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] }
      : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${String(PORT)} --strictPort`,
    cwd: '..',
    url: `http://localhost:${String(PORT)}/pdf-insight/`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { VITE_API_URL: 'https://api.e2e.test', VITE_BASE_PATH: '/pdf-insight/' },
  },
});
