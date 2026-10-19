import { expect, test, world } from '../world/index.ts';

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

test.describe(() => {
  // TEST-1.5: a call the fake tb-prod or tb-pr doesn't answer fails the test, though its body passes.
  test.use({ worldSpec: world().tbProd().tbPr() });

  test('TEST-1.5: a plain test that asks the fake tb-prod for another subcommand', async ({ world: w }) => {
    const r = await w.run('tb-prod', ['create', 'tasks', '--data', '{}']);
    expect(r.code).toBe(2);
    expect(r.stderr).toBe('fake tb-prod: refused `tb-prod create tasks --data {}`: only `query tasks` is answered\n');
  });

  test('TEST-1.5: a plain test that asks the fake tb-pr for another subcommand', async ({ world: w }) => {
    expect((await w.run('tb-pr', ['open', '812'])).code).toBe(2);
    // `list` without `--json` prints a table Lookout must never read.
    expect((await w.run('tb-pr', ['list'])).code).toBe(2);
    // What it does answer is no violation.
    expect((await w.run('tb-pr', ['list', '--json'])).code).toBe(0);
  });
});

// TEST-1.7: a request outside the World that got past its route fails the test, though its body passes.
test("TEST-1.7: a plain test whose page follows a redirect from the World's Lookout to outside it", async ({ page, world: w }) => {
  // Lookout's server never redirects: the page's own route answers on its origin instead.
  await page.route(`${w.url}away`, (route) => route.fulfill({ status: 302, headers: { location: 'https://github.com/productiveio/anvil/pull/2101' } }));
  // The browser follows the redirect, which no route sees, and finds no way out.
  expect(await page.goto(`${w.url}away`).then(() => 'loaded', (e: Error) => e.message)).toContain('net::ERR_PROXY_CONNECTION_FAILED');
  expect(w.browserRequests()).toEqual([]);
});
