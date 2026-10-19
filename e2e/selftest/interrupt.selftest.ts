import { test } from '../world/index.ts';

/**
 * A World that stays in its start until the run is interrupted (TEST-1.8), run by
 * e2e/scenarios/test/selftest.e2e.ts. Once everything is started, the World writes its index
 * entry's path to LOOKOUT_SELFTEST_PAUSE_FILE and waits there. Never run on its own.
 */

test.use({ startPauseFile: process.env.LOOKOUT_SELFTEST_PAUSE_FILE });

test('TEST-1.8: a World still starting when the run is interrupted', async ({ world: w }) => {
  void w;
});
