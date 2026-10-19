import { availableParallelism } from 'node:os';
import { defineConfig } from '@playwright/test';
import { SCENARIO_BUDGET_MS } from './world/budget.ts';

/** TEST-2.1: headless Chromium at 1440×900, against the built Lookout, one World per test. */
export default defineConfig({
  testDir: './scenarios',
  testMatch: '**/*.e2e.ts',
  // The scenario's own 30 s budget names what it waited for (TEST-2.6); this backstop also covers
  // starting and tearing down its World.
  timeout: SCENARIO_BUDGET_MS + 15_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  workers: Math.max(1, Math.floor(availableParallelism() / 2)),
  forbidOnly: true,
  retries: 0,
  globalSetup: './global-setup.ts',
  outputDir: './.results',
  reporter: [['list'], ['html', { outputFolder: './.report', open: 'never' }], ['./world/reporter.ts']],
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
