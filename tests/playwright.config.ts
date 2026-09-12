import { defineConfig } from '@playwright/test';

export default defineConfig({
  tsconfig: './tsconfig.playwright.json',
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'line',
});
