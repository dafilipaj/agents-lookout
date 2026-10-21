import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const script = new URL('../e2e/shims/merge-json.mjs', import.meta.url).pathname;
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function merge(tool: 'fleet' | 'tb-session', base: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'lookout-merge-test-'));
  dirs.push(dir);
  const basePath = join(dir, 'base.json');
  const extrasPath = join(dir, 'extras.json');
  writeFileSync(basePath, JSON.stringify(base));
  writeFileSync(extrasPath, '[]');
  return spawnSync(process.execPath, [script, tool, basePath, extrasPath, 'search', '--', 'task=41000001'], { encoding: 'utf8' });
}

it('e2e shim: Fleet shim rejects an unexpected list shape and accepts an explicit empty list', () => {
  const bad = merge('fleet', { sessions: [] });
  expect(bad.status).not.toBe(0);
  expect(bad.stderr).toMatch(/Fleet.*array/i);
  const empty = merge('fleet', []);
  expect(empty.status).toBe(0);
  expect(JSON.parse(empty.stdout)).toEqual([]);
});

it('e2e shim: tb-session shim rejects a missing results list and accepts an explicit empty one', () => {
  const bad = merge('tb-session', { sessions: [] });
  expect(bad.status).not.toBe(0);
  expect(bad.stderr).toMatch(/tb-session.*results.*array/i);
  const empty = merge('tb-session', { results: [] });
  expect(empty.status).toBe(0);
  expect(JSON.parse(empty.stdout)).toEqual({ results: [] });
});
