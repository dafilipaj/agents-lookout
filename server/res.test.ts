import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResSnapshot } from '../shared/res.ts';
import type { RunError, Runner } from './exec.ts';
import { RES_ARGS, ResMonitor, resolveResBin } from './res.ts';

const t0 = Date.parse('2026-11-06T09:00:00Z');
const entry = (id: string, state: string, session: string, waitedMs = 0) => ({
  id, pid: 300, session, cls: 'vitest@agents-lookout', tool: 'vitest', kind: 'run', prio: 'check', state, cores: 3, mb: 2600,
  req: { scaled: false, workers: 3, cores: 3, mb: 2600 }, since: new Date(t0).toISOString(),
  queuedAt: new Date(t0 - waitedMs).toISOString(), waitingSince: new Date(t0 - waitedMs).toISOString(),
});
const json = (entries: unknown[]) => JSON.stringify({ machine: { cores: 12 }, budget: {}, entries });
const fail = (patch: Partial<RunError>): RunError => Object.assign(new Error(patch.message ?? 'failed'), patch);

function setup(answer: () => string | RunError, now = () => t0) {
  const changed = vi.fn<(r: ResSnapshot | null) => void>();
  const run = vi.fn<Runner>(async () => {
    const a = answer();
    if (a instanceof Error) throw a;
    return a;
  });
  const monitor = new ResMonitor({
    runner: run,
    sessions: () => [{ id: 's-tmux', tmuxSession: 'lookout-res' }, { id: 'abc-123', tmuxSession: null }],
    onChange: changed,
    now,
    env: { PATH: '', HOME: '/Users/me', LOOKOUT_RES_BIN: '/bin/res' },
  });
  return { monitor, run, changed };
}
afterEach(() => vi.useRealTimers());

describe('RES-1: read the queue', () => {
  it('RES-1.1: res status --json through the runner with a 3 s timeout; jobs tied to Sessions and in queue order', async () => {
    let entries = [entry('w2', 'waiting', 'abc-123', 1000), entry('h', 'holding', 'lookout-res'), entry('w1', 'waiting', 'lookout-res', 60_000)];
    const { monitor, run, changed } = setup(() => json(entries));
    await monitor.tick();
    expect(run.mock.calls.map(([file, args, o]) => [file, args, o.timeoutMs])).toEqual([['/bin/res', RES_ARGS, 3000]]);
    expect(RES_ARGS).toEqual(['status', '--json']);
    expect(monitor.snapshot()?.jobs.map((j) => [j.id, j.state, j.sessionId, j.position])).toEqual([
      ['h', 'holding', 's-tmux', null],
      ['w1', 'waiting', 's-tmux', 1],
      ['w2', 'waiting', 'abc-123', 2],
    ]);
    expect(changed).toHaveBeenCalledTimes(1);
    // The same queue again isn't a change; a job admitted is.
    await monitor.tick();
    expect(changed).toHaveBeenCalledTimes(1);
    entries = [entry('w1', 'holding', 'lookout-res', 60_000)];
    await monitor.tick();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(monitor.snapshot()?.jobs.map((j) => j.state)).toEqual(['holding']);
    await monitor.close();
  });

  it('RES-1.1: reads every 5 s while a tab watches, none while none does', async () => {
    vi.useFakeTimers({ now: t0 });
    const { monitor, run } = setup(() => json([]), Date.now);
    const unwatch = monitor.watch();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(2);
    unwatch();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(run).toHaveBeenCalledTimes(2);
    await monitor.close();
  });

  it('RES-1.2: res not found is no queue: null', async () => {
    const { monitor, changed } = setup(() => fail({ code: 'ENOENT' }));
    await monitor.tick();
    expect(monitor.snapshot()).toBeNull();
    expect(changed).toHaveBeenCalledWith(null);
    await monitor.close();
  });

  it('RES-1.2: a failed read keeps the last list with the reason and its time; the next good read clears it', async () => {
    let now = t0;
    let answer: string | RunError = json([entry('h', 'holding', 'lookout-res')]);
    const { monitor } = setup(() => answer, () => now);
    await monitor.tick();
    now = t0 + 5000;
    answer = fail({ timedOut: true });
    await monitor.tick();
    expect(monitor.snapshot()).toMatchObject({ error: 'res status timed out', readAt: t0, jobs: [expect.objectContaining({ id: 'h' })] });
    answer = 'not json';
    await monitor.tick();
    expect(monitor.snapshot()?.error).toBe('res status printed something other than its JSON');
    answer = fail({ code: 2, stderr: 'res: unknown command\nusage' });
    await monitor.tick();
    expect(monitor.snapshot()?.error).toBe('res: unknown command');
    answer = json([]);
    await monitor.tick();
    expect(monitor.snapshot()).toEqual({ jobs: [], readAt: t0 + 5000, error: null });
    await monitor.close();
  });

  it('RES-1.1: finds res in PATH, then ~/.local/bin, else the bare name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'res-bin-'));
    try {
      const bin = join(dir, 'bin');
      const local = join(dir, 'home', '.local', 'bin');
      mkdirSync(bin, { recursive: true });
      mkdirSync(local, { recursive: true });
      writeFileSync(join(local, 'res'), '#!/bin/sh\n', { mode: 0o755 });
      expect(resolveResBin({ PATH: bin, HOME: join(dir, 'home') })).toBe(join(local, 'res'));
      writeFileSync(join(bin, 'res'), '#!/bin/sh\n', { mode: 0o755 });
      expect(resolveResBin({ PATH: bin, HOME: join(dir, 'home') })).toBe(join(bin, 'res'));
      expect(resolveResBin({ PATH: '', HOME: join(dir, 'nobody'), LOOKOUT_RES_BIN: '/x/res' })).toBe('/x/res');
      expect(resolveResBin({ PATH: '', HOME: join(dir, 'nobody') })).toBe('res');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
