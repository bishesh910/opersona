import { defineConfig } from '@playwright/test';
// Assumes `pnpm dev` (web :3000 + engine :4000) is already running against the local DB.
export default defineConfig({
  testDir: './e2e', timeout: 90_000, retries: 0, reporter: 'list',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  outputDir: './data/e2e-results',
});
