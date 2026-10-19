import { test } from '../world/index.ts';

/**
 * Plain `test()`s with a World, run by e2e/scenarios/test/selftest.e2e.ts, which checks that each
 * fails the way it says. Never run on their own.
 */

test.beforeEach(() => {
  // Starting a World isn't what these tests time.
  test.setTimeout(20_000);
});

// TEST-2.2: the `world` fixture checks the title, not only `scenario()`.
test('a plain test with a World but no criterion id', async ({ world: w }) => {
  void w;
});

test.describe(() => {
  // TEST-2.6: the `world` fixture keeps the budget, not only `scenario()`.
  test.use({ budgetMs: 1000 });

  test('TEST-2.6: a plain test stuck in a wait past its budget', async ({ world: w }) => {
    await w.step('a Session called nope to appear', () => new Promise<never>(() => {}));
  });

  test('TEST-2.6: a plain test busy past its budget where no timer can fire', async ({ world: w }) => {
    await w.step('the sidebar to render', async () => {
      const until = performance.now() + 1200;
      while (performance.now() < until) {
        // a synchronous stretch
      }
    });
  });
});
