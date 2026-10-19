import { type Page, type TestInfo, test as base, expect } from '@playwright/test';
import { type WorldBuilder, world } from './builder.ts';
import { SCENARIO_BUDGET_MS, checkBudget, withinBudget } from './budget.ts';
import { recordLeftovers } from './registry.ts';
import { type RunningWorld, settleWorlds, startWorld } from './runtime.ts';

/**
 * The Behaviour-test API (TEST-2.2):
 *
 *   scenario('SIDE-6.1: …', world().without('fleet'), async ({ page, world }) => { … });
 *
 * Each test that uses `world` gets its own World, started before the page opens Lookout and torn
 * down after the test, whether it passed, failed or timed out (TEST-1.8). The `world` fixture
 * itself checks the title (TEST-2.2) and keeps the budget (TEST-2.6), so a plain `test()` that
 * uses it is held to both, as a `scenario()` is.
 */

export { expect, world };
export type { RunningWorld, WorldBuilder };

/** A criterion id, a colon, then what holds: `SIDE-6.1: …`. */
const TITLE = /^[A-Z][A-Z0-9]*-\d+(?:\.\d+)*: \S/;

export function checkTitle(title: string): void {
  if (!TITLE.test(title)) {
    throw new Error(`A Behaviour test's title starts with its criterion id, like "SIDE-6.1: what holds". Got: "${title}"`);
  }
}

interface Fixtures {
  worldSpec: WorldBuilder;
  /** The test's budget (TEST-2.6): 30 s, and a test may only shorten it. */
  budgetMs: number;
  /** How long the World's teardown waits after SIGTERM before SIGKILL. */
  stopGraceMs: number;
  /** For the World's own tests (e2e/selftest): see `StartOptions.pauseFile`. */
  startPauseFile: string | undefined;
  world: RunningWorld;
}

interface WorkerFixtures {
  /** A worker waits for the teardowns in progress (a cancelled start's too) before it exits. */
  worldsSettled: void;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  worldSpec: [world(), { option: true }],
  budgetMs: [SCENARIO_BUDGET_MS, { option: true }],
  stopGraceMs: [3000, { option: true }],
  startPauseFile: [undefined, { option: true }],
  worldsSettled: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use();
      await settleWorlds();
    },
    { scope: 'worker', auto: true },
  ],
  world: async ({ worldSpec, budgetMs, stopGraceMs, startPauseFile }, use, testInfo) => {
    // TEST-2.2, TEST-2.6: every test with a World, `scenario()` or not.
    checkTitle(testInfo.title);
    checkBudget(budgetMs);

    // Playwright tears down only fixtures that reached `use()`. A World still starting when the
    // run is interrupted is cancelled here, and the worker waits for its teardown (worldsSettled);
    // if the worker exits first, runtime.ts sweeps it on exit and names it, and the next run's
    // global setup sweeps whatever is left (registry.ts).
    const cancel = new AbortController();
    const onSignal = (sig: NodeJS.Signals) => cancel.abort(new Error(`The World start was interrupted (${sig}).`));
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    let w: RunningWorld;
    try {
      w = await startWorld(worldSpec.declaration(), { signal: cancel.signal, label: testInfo.title, stopGraceMs, pauseFile: startPauseFile });
    } finally {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    }
    testInfo.annotations.push({ type: 'world-start', description: String(w.startMs) });

    // TEST-1.2, TEST-1.8: nothing escaped the World, and no real Harness runs in it, before and
    // after the test.
    const problems: string[] = (await w.guard()).map((v) => `before the test: ${v}`);
    const budget = w.budget(budgetMs);
    try {
      if (problems.length === 0) await use(w);
    } finally {
      // TEST-2.6: past its budget, also when no timer could fire, or when Playwright's own
      // timeout ended it; named once.
      const over = budget.end();
      if (over && !testInfo.errors.some((e) => e.message?.includes('The Behaviour test ran past'))) problems.push(over.message);
      problems.push(...(await w.guard()).map((v) => `after the test: ${v}`));
      problems.push(...(await tearDown(w, testInfo)));
    }
    if (problems.length) throw new Error(problems.join('\n'));
  },
});

/** Stops the World; on failure attaches its report first. Returns what makes the test fail. */
async function tearDown(w: RunningWorld, testInfo: TestInfo): Promise<string[]> {
  const failed = testInfo.status !== testInfo.expectedStatus;
  const { leftovers, trapKnocks, report } = await w.stop({ collect: failed });
  // TEST-2.4: everything needed to understand a failure without rerunning it. Playwright adds the
  // trace and the screenshot.
  if (report) {
    await testInfo.attach('world-declaration.json', { body: report.declaration, contentType: 'application/json' });
    await testInfo.attach('lookout-server.log', { body: report.serverLog || '(empty)', contentType: 'text/plain' });
    await testInfo.attach('calls.log', { body: report.calls || '(no calls)', contentType: 'text/plain' });
    await testInfo.attach('tmux-panes.txt', { body: report.panes, contentType: 'text/plain' });
  }
  const problems: string[] = [];
  if (trapKnocks > 0) problems.push(`Something reached the default tmux socket ${trapKnocks}× instead of the World's private server (TEST-1.9).`);
  if (leftovers.length) {
    problems.push(`The World left these behind (TEST-1.8):\n  ${leftovers.join('\n  ')}`);
    // Global teardown fails the run on these too, also when the test was expected to fail.
    recordLeftovers(testInfo.title, leftovers);
  }
  return problems;
}

export interface ScenarioContext {
  page: Page;
  world: RunningWorld;
}

export interface ScenarioOptions {
  /** The Behaviour test's budget (TEST-2.6): 30 s, and a test may only shorten it. */
  budgetMs?: number;
}

/**
 * A scenario's body, within its budget: Lookout opened, then `fn` (TEST-2.6). Racing the whole
 * body fails it at the budget even while it waits on the page outside `world.step`.
 */
export function runScenario(budgetMs: number, { page, world: w }: ScenarioContext, fn: (ctx: ScenarioContext) => Promise<void>): Promise<void> {
  checkBudget(budgetMs);
  return withinBudget(budgetMs, w, async () => {
    await w.step('Lookout to load', () => page.goto(w.url).then(() => undefined));
    await fn({ page, world: w });
  });
}

/** A Behaviour test: its title starts with the criterion id it checks (TEST-2.2). */
export function scenario(title: string, spec: WorldBuilder, fn: (ctx: ScenarioContext) => Promise<void>, opts: ScenarioOptions = {}): void {
  checkTitle(title);
  const budgetMs = opts.budgetMs ?? SCENARIO_BUDGET_MS;
  checkBudget(budgetMs);
  test.describe(() => {
    test.use({ worldSpec: spec, budgetMs });
    test(title, ({ page, world: w }) => runScenario(budgetMs, { page, world: w }, fn));
  });
}
