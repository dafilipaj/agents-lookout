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
    // TEST-1.7: the World aborts every request outside its Lookout origin, and fails the test on one
    // that got past its route (world/browser.ts). A service worker's requests aren't routed, so there
    // are none. As a backstop, HTTP(S) and WebSocket traffic, IP literals included, goes to a proxy
    // nothing listens on (port 9), except loopback, which Chromium never proxies; and no host but
    // 127.0.0.1 and localhost resolves. That covers what Lookout's pages do, not all of Chromium:
    // WebRTC's UDP, for one, uses neither the proxy nor the resolver.
    serviceWorkers: 'block',
    launchOptions: { args: ['--proxy-server=127.0.0.1:9', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
