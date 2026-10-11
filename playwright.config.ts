import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: process.env.CI ? 90_000 : 45_000,
  expect: { timeout: process.env.CI ? 30_000 : 15_000 },
  retries: 0,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4317', trace: 'off', screenshot: 'off' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  // Never reuse another preview process: it may serve a different build.
  webServer: { command: 'npx vite build && npx vite preview --host 127.0.0.1 --port 4317 --strictPort', url: 'http://127.0.0.1:4317', reuseExistingServer: false, timeout: 120_000 },
});
