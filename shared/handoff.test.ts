import { expect, it } from 'vitest';
import { HANDOFF_RESTATE_LINE, MAX_KEPT_HANDOVER, handoverText } from './handoff.ts';

it("TOPIC-15.1: a Topic keeps the Handover as it was started: your edits kept, its `Continued from:` and restate lines left out, its first 20,000 characters", () => {
  const prompt = `Edited: rounding is half up.\r\n\r\nNext: ship it.\n\nContinued from: a1b2c3d4-0000-4000-8000-000000000001 Rates port\n${HANDOFF_RESTATE_LINE}\n\nAlso check the flag.`;
  expect(handoverText(prompt)).toBe('Edited: rounding is half up.\n\nNext: ship it.\n\n\nAlso check the flag.');
  expect(handoverText(`Continued from: a1b2c3d4-0000-4000-8000-000000000001 Rates port\n${HANDOFF_RESTATE_LINE}`)).toBe('');
  // A line that only mentions it stays.
  expect(handoverText('Continued from:\nthe old plan')).toBe('Continued from:\nthe old plan');
  expect(handoverText('x'.repeat(MAX_KEPT_HANDOVER + 10))).toHaveLength(MAX_KEPT_HANDOVER);
});
