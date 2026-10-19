import { test } from '../world/index.ts';

/**
 * A test that times out with its World's teardown unfinished (TEST-1.8), run by
 * e2e/scenarios/test/selftest.e2e.ts with a project timeout of 1 s, so the teardown's time runs out
 * too and the worker exits with the World still up. Never run on its own.
 */

let startedAt = 0;
test.beforeEach(() => {
  startedAt = Date.now();
  // Enough to start the World; the test shortens it once the World runs.
  test.setTimeout(20_000);
});

// The teardown waits a minute for a process that ignores SIGTERM: longer than it is given.
test.use({ stopGraceMs: 60_000 });

test('TEST-1.8: a test that times out with a process that ignores SIGTERM', async ({ world: w }) => {
  const tag = process.env.LOOKOUT_SELFTEST_TAG ?? 'selftest';
  await w.run('bash', ['-c', `node -e "process.on('SIGTERM',()=>{});setInterval(()=>{},1e9)" ${tag} >/dev/null 2>&1 &`]);
  await w.waitUntil('the process that ignores SIGTERM to run', async () => (await w.processes()).some((p) => p.command.endsWith(` ${tag}`)));
  test.setTimeout(Date.now() - startedAt + 300);
  await new Promise<never>(() => {});
});
