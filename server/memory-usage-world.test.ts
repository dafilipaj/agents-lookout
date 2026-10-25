import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { world } from '../e2e/world/builder.ts';
import { run } from './exec.ts';
import { parseFleetUsage, probeJev } from './usage.ts';

const FULL_USAGE = { claude: { session: 6, weekly_all: 66 }, codex: { session: 0, weekly_all: 39 }, jev: 'ready' as const };

it('MEM-1.2: the World declares populated Claude, Codex and Jev usage through their CLI boundaries', async () => {
  const base = world();
  const declared = base.usage(FULL_USAGE).declaration();
  expect(base.declaration().usage).toBeNull();
  expect(declared.usage).toEqual(FULL_USAGE);
  expect(() => base.usage({ ...FULL_USAGE, claude: { session: -1, weekly_all: 0 } })).toThrow();
  const dir = mkdtempSync(join(tmpdir(), 'lookout-memory-usage-'));
  try {
    writeFileSync(join(dir, 'answer.json'), JSON.stringify(declared.usage));
    writeFileSync(join(dir, 'extras.json'), '[]');
    const fallback = join(dir, 'real-fleet');
    writeFileSync(fallback, '#!/bin/sh\nprintf "real fleet list\\n"\nexit 9\n', { mode: 0o755 });
    const values = { NAME: 'fleet', SELF: join(dir, 'fleet'), EXTRAS: join(dir, 'extras.json'), MERGE_SCRIPT: fileURLToPath(new URL('../e2e/shims/merge-json.mjs', import.meta.url)), REAL: fallback, NODE: process.execPath, LOG: join(dir, 'calls.log'), USAGE: dir, USAGE_SCRIPT: fileURLToPath(new URL('../e2e/fakes/fleet-usage.ts', import.meta.url)), VIOLATIONS: join(dir, 'violations.jsonl') };
    const render = (name: string, over: Record<string, string>) => {
      let script = readFileSync(new URL(`../e2e/shims/${name}`, import.meta.url), 'utf8');
      for (const [key, value] of Object.entries({ ...values, ...over })) script = script.replaceAll(`@${key}@`, value);
      return script;
    };
    const fleet = join(dir, 'fleet');
    writeFileSync(fleet, render('logged', {}), { mode: 0o755 });
    const usage = spawnSync(fleet, ['--local', 'usage', '--json'], { encoding: 'utf8' });
    expect(usage.status, usage.stderr).toBe(0);
    const providers = parseFleetUsage(usage.stdout);
    expect(providers.claude?.windows.map((w) => w.percent)).toEqual([66, 6]);
    expect(providers.codex?.windows.map((w) => w.percent)).toEqual([39, 0]);
    expect(providers.claude?.state).toBe('ok');
    expect(providers.codex?.state).toBe('ok');
    const list = spawnSync(fleet, ['--local', 'harness', 'list', '--json'], { encoding: 'utf8' });
    expect(list.status).toBe(9);
    expect(list.stdout).toBe('real fleet list\n');
    const jev = join(dir, 'tb-jev');
    writeFileSync(jev, render('fake', { NAME: 'tb-jev', STATE: dir, SCRIPT: fileURLToPath(new URL('../e2e/fakes/tb-jev.ts', import.meta.url)) }), { mode: 0o755 });
    expect(await probeJev(run, jev, process.env)).toMatchObject({ state: 'ready', version: '0.2.0' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
