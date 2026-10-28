import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { run } from './exec.ts';
import { fetchFleetList, resolveFleetBin } from './fleet.ts';
import { normalizeRows } from './normalize.ts';

// Made in a hook, not at import: `pnpm req-check` imports this file to collect its titles.
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lookout-fleet-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A stand-in `fleet` executable. */
function fakeFleet(name: string, script: string): string {
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  return file;
}

describe('calling fleet list', () => {
  it('SIDE-9.3: the fake Fleet reports known, empty and unknown Subagent counts through the same list contract', async () => {
    const fake = new URL('./fixtures/fleet/messages/fake-fleet.mjs', import.meta.url).pathname;
    const result = await fetchFleetList(run, fake);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('fake Fleet did not list');
    const rows = normalizeRows(result.rows, { git: () => null, statusSince: () => null });
    expect(rows.map((r) => r.subagents)).toEqual([
      { running: 1, finished: 2 }, { running: 3, finished: 0 }, null, { running: 0, finished: 3 }, { running: 0, finished: 0 }, null,
    ]);
  });

  it('runs `fleet --local list --json` with an argv array', async () => {
    const runner = vi.fn(async () => '[]');
    await fetchFleetList(runner, '/bin/fleet');
    expect(runner).toHaveBeenCalledWith('/bin/fleet', ['--local', 'list', '--json'], { timeoutMs: 4000 });
  });

  it('SIDE-1.4: parses the rows a real process prints', async () => {
    const bin = fakeFleet('fleet-ok', `cat '${new URL('./fixtures/fleet/recorded-2026-10-16.json', import.meta.url).pathname}'`);
    const result = await fetchFleetList(run, bin);
    expect(result.kind).toBe('ok');
    expect(result.kind === 'ok' && result.rows.map((r) => r.pid)).toEqual([12434, 14352, 88030, 85928]);
  });

  it('SIDE-6.1: a missing fleet binary reads as not installed', async () => {
    expect(await fetchFleetList(run, join(dir, 'no-such-fleet'))).toEqual({ kind: 'not-installed' });
  });

  it('SIDE-6.2: a failing call is an error with the reason', async () => {
    const bin = fakeFleet('fleet-fails', 'echo "error: registry unreadable" >&2; exit 1');
    expect(await fetchFleetList(run, bin)).toEqual({ kind: 'error', message: 'fleet list failed: error: registry unreadable' });
  });

  it('SIDE-6.2: a call that hangs times out', async () => {
    const bin = fakeFleet('fleet-hangs', 'exec sleep 5');
    expect(await fetchFleetList(run, bin, 200)).toEqual({ kind: 'error', message: 'fleet list timed out after 0.2 s' });
  });

  it('SIDE-6.2: output that is not a JSON list is an error', async () => {
    expect(await fetchFleetList(async () => 'not json', 'fleet')).toEqual({ kind: 'error', message: 'fleet list returned invalid JSON' });
    expect((await fetchFleetList(async () => '{}', 'fleet')).kind).toBe('error');
  });

  it('finds fleet on PATH, then in cargo’s bin dir, and honours LOOKOUT_FLEET_BIN', () => {
    const pathDir = mkdtempSync(join(dir, 'path-'));
    const cargo = mkdtempSync(join(dir, 'cargo-'));
    expect(resolveFleetBin({ LOOKOUT_FLEET_BIN: '/opt/fleet' })).toBe('/opt/fleet');
    expect(resolveFleetBin({ PATH: pathDir, CARGO_HOME: cargo })).toBe('fleet');
    mkdirSync(join(cargo, 'bin'));
    writeFileSync(join(cargo, 'bin', 'fleet'), '#!/bin/sh\n');
    chmodSync(join(cargo, 'bin', 'fleet'), 0o755);
    expect(resolveFleetBin({ PATH: pathDir, CARGO_HOME: cargo })).toBe(join(cargo, 'bin', 'fleet'));
    writeFileSync(join(pathDir, 'fleet'), '#!/bin/sh\n');
    chmodSync(join(pathDir, 'fleet'), 0o755);
    expect(resolveFleetBin({ PATH: pathDir, CARGO_HOME: cargo })).toBe(join(pathDir, 'fleet'));
  });
});
