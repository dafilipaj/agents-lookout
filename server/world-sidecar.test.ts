import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readJsonArray } from '../e2e/world/runtime.ts';

it('e2e shim: invalid sidecars fail before a World can overwrite them, while empty arrays work', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookout-sidecar-'));
  const path = join(dir, 'rows.json');
  try {
    for (const invalid of ['{bad', '{"results":[]}']) {
      writeFileSync(path, invalid);
      expect(() => readJsonArray(path)).toThrow();
      expect(readFileSync(path, 'utf8')).toBe(invalid);
    }
    writeFileSync(path, '[]');
    expect(readJsonArray(path)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
