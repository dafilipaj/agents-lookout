import { defineConfig } from '@playwright/test';
import base from '../playwright.config.ts';

/**
 * The World's own tests run Playwright inside a Behaviour test, the way `pnpm e2e` runs it:
 * e2e/scenarios/test/selftest.e2e.ts starts a run of these `*.selftest.ts` files with this config,
 * interrupts or times it out, and checks what it left. They never run on their own, and `pnpm e2e`
 * and `pnpm req-check` don't list them (`e2e/playwright.config.ts` reads only e2e/scenarios/).
 *
 * The calling test passes, so that its run can't touch `pnpm e2e`'s own results or report:
 * - LOOKOUT_SELFTEST_OUTPUT: the run's output directory;
 * - PLAYWRIGHT_JSON_OUTPUT_NAME: where the JSON report goes;
 * - LOOKOUT_SELFTEST_TIMEOUT: the project's test timeout, when a test needs a short one.
 */
const output = process.env.LOOKOUT_SELFTEST_OUTPUT;
if (!output) throw new Error('e2e/selftest runs only from e2e/scenarios/test/selftest.e2e.ts (LOOKOUT_SELFTEST_OUTPUT is not set).');

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: '*.selftest.ts',
  timeout: Number(process.env.LOOKOUT_SELFTEST_TIMEOUT ?? base.timeout),
  globalSetup: '../global-setup.ts',
  outputDir: output,
  reporter: [['json']],
  use: { ...base.use, trace: 'off', screenshot: 'off' },
});
