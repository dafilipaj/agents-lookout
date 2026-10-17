// Collected by scripts/vitest-titles.mjs in req-check.test.mjs (TEST-3.1), never run.
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';

const registered = false;
// A static parse of this file sees this test; collecting it never registers one.
if (registered) it('VIEW-1.1: absent', () => {});

describe('VIEW-1', () => {
  it.each(['VIEW-1.1', 'VIEW-1.2'])('%s: works', () => {
    // Collecting never runs a test body.
    writeFileSync(process.env.TITLES_RAN, 'ran');
  });
  it.skip('VIEW-1.3: skipped', () => {});
});
