import { expect, test } from '../world/index.ts';

/** The run after an interrupted one (TEST-1.8): its global setup is what's under test. Never run on its own. */

test('TEST-1.8: the next run starts', () => {
  expect(true).toBe(true);
});
