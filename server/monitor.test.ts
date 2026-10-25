import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { FLEET_INSTALL_COMMAND } from '../shared/defaults.ts';
import type { GitLocation } from '../shared/types.ts';
import type { FleetListResult, FleetRow } from './fleet.ts';
import { type MonitorEvent, SessionMonitor } from './monitor.ts';

const recorded: FleetRow[] = JSON.parse(
  readFileSync(new URL('./fixtures/fleet/recorded-2026-10-16.json', import.meta.url), 'utf8'),
);

function setup(initial: FleetListResult) {
  let result = initial;
  let now = 1_792_146_000_000;
  const events: MonitorEvent[] = [];
  const monitor = new SessionMonitor({
    fetchList: async () => result,
    git: { get: () => null, prune: () => {} },
    onEvent: (e) => events.push(e),
    now: () => now,
  });
  return {
    monitor,
    events,
    set: (r: FleetListResult) => (result = r),
    advance: (ms: number) => (now += ms),
    now: () => now,
  };
}

const ok = (rows: FleetRow[]): FleetListResult => ({ kind: 'ok', rows });

describe('SessionMonitor', () => {
  it('SIDE-9.2: a count-only change pushes the row on the next poll without changing its Status or age', async () => {
    const base = recorded.find((r) => r.harness === 'codex')!;
    const t = setup(ok([{ ...base, subagents: { running: 1, finished: 0 } }]));
    await t.monitor.tick();
    const before = t.monitor.snapshot().sessions[0]!;
    for (const subagents of [{ running: 3, finished: 1 }, { running: 0, finished: 4 }, { running: 0, finished: 0 }, null]) {
      t.events.length = 0;
      t.advance(2000);
      t.set(ok([{ ...base, subagents, updated_at: t.now() }]));
      await t.monitor.tick();
      expect(t.events).toEqual([{ type: 'sessions', upsert: [{ ...before, subagents }], remove: [] }]);
      t.events.length = 0;
      await t.monitor.tick();
      expect(t.events).toEqual([]);
    }
  });

  it('SIDE-2.11: an activity-only change pushes the row on the next poll without changing its Status or age', async () => {
    const base = recorded.find((r) => r.status === 'busy')!;
    const t = setup(ok([{ ...base, activity: 'Thinking' }]));
    await t.monitor.tick();
    const before = t.monitor.snapshot().sessions[0]!;
    expect(before.activity).toBe('Thinking');
    for (const activity of ['Bash: pnpm lint', 'Edit: web/src/lantern.ts', null]) {
      t.events.length = 0;
      t.advance(2000);
      t.set(ok([{ ...base, activity, updated_at: t.now() }]));
      await t.monitor.tick();
      expect(t.events).toEqual([{ type: 'sessions', upsert: [{ ...before, activity }], remove: [] }]);
      t.events.length = 0;
      await t.monitor.tick();
      expect(t.events).toEqual([]);
    }
  });

  it('SIDE-1.4: the recorded `fleet list --json` output becomes rows, pushed as one diff', async () => {
    const t = setup(ok(recorded));
    await t.monitor.tick();
    expect(t.events).toEqual([
      { type: 'sessions', upsert: expect.any(Array), remove: [] },
      { type: 'fleet', fleet: { state: 'ok' } },
    ]);
    const { sessions } = t.monitor.snapshot();
    expect(sessions.map((s) => [s.title, s.status, s.controllable])).toEqual([
      ['lookout-test-claude', 'needs-you', true],
      ['Run curl command', 'idle', true],
      ['summarize-this-months-metrics', 'idle', false],
      ['sketch-a-ui-for-watching', 'busy', false],
    ]);
  });

  it('pushes only what changed, and nothing when nothing did', async () => {
    const t = setup(ok(recorded));
    await t.monitor.tick();
    t.events.length = 0;
    await t.monitor.tick();
    expect(t.events).toEqual([]);

    const busy = recorded.map((r) => (r.pid === 14352 ? { ...r, status: 'busy' } : r));
    t.set(ok(busy));
    await t.monitor.tick();
    expect(t.events).toHaveLength(1);
    const e = t.events[0] as Extract<MonitorEvent, { type: 'sessions' }>;
    expect(e.upsert.map((r) => [r.pid, r.status])).toEqual([[14352, 'busy']]);
    expect(e.remove).toEqual([]);
  });

  it('SIDE-1.2: a Session whose process exits is removed on the next poll', async () => {
    const t = setup(ok(recorded));
    await t.monitor.tick();
    t.events.length = 0;
    t.set(ok(recorded.filter((r) => r.pid !== 12434)));
    await t.monitor.tick();
    expect(t.events).toEqual([{ type: 'sessions', upsert: [], remove: ['11111111-1111-4111-8111-111111111111'] }]);
  });

  it('ignores Codex `updated_at` jitter, and times a status change from when it happened', async () => {
    const codex = recorded.find((r) => r.harness === 'codex')!;
    const t = setup(ok([codex]));
    await t.monitor.tick();
    const first = t.monitor.snapshot().sessions[0]!.statusSince;
    expect(first).toBe(codex.updated_at);

    t.events.length = 0;
    t.advance(2000);
    t.set(ok([{ ...codex, updated_at: codex.updated_at! + 731 }])); // same status, new mtime
    await t.monitor.tick();
    expect(t.events).toEqual([]);

    t.advance(2000);
    t.set(ok([{ ...codex, status: 'busy', updated_at: t.now() - 500 }]));
    await t.monitor.tick();
    expect(t.monitor.snapshot().sessions[0]!.statusSince).toBe(t.now() - 500);

    // A Fleet time from before the previous change can't be when this change happened.
    t.advance(2000);
    t.set(ok([{ ...codex, status: 'idle', updated_at: codex.updated_at }]));
    await t.monitor.tick();
    expect(t.monitor.snapshot().sessions[0]!.statusSince).toBe(t.now());
  });

  it('SIDE-2.6: a background shell starting or ending pushes the row but keeps its Idle age', async () => {
    const codex = recorded.find((r) => r.harness === 'codex')!;
    const t = setup(ok([codex]));
    await t.monitor.tick();
    const since = t.monitor.snapshot().sessions[0]!.statusSince;

    t.events.length = 0;
    t.advance(2000);
    t.set(ok([{ ...codex, status: 'shell', updated_at: t.now() - 100 }]));
    await t.monitor.tick();
    const e = t.events[0] as Extract<MonitorEvent, { type: 'sessions' }>;
    expect(e.upsert.map((r) => [r.status, r.backgroundShell, r.statusSince])).toEqual([['idle', true, since]]);

    t.advance(2000);
    t.set(ok([{ ...codex, status: 'idle', updated_at: t.now() - 100 }]));
    await t.monitor.tick();
    expect(t.monitor.snapshot().sessions.map((r) => [r.status, r.backgroundShell, r.statusSince])).toEqual([['idle', false, since]]);
  });

  it('SIDE-2.9: a changed Start directory re-derives which rows show their repo, as a diff of those rows', async () => {
    const codex = recorded.find((r) => r.harness === 'codex')!;
    const loc: GitLocation = { repo: 'work', worktree: null, branch: 'main', commonDir: '/p/work/.git', defaultBranch: 'main' };
    let startRepos = new Set<string>();
    const events: MonitorEvent[] = [];
    const monitor = new SessionMonitor({
      fetchList: async () => ok([codex]),
      git: { get: () => loc, prune: () => {} },
      startRepos: () => startRepos,
      onEvent: (e) => events.push(e),
    });
    await monitor.tick();
    expect(monitor.snapshot().sessions.map((r) => r.locationShown)).toEqual([{ repo: true, where: false }]);

    events.length = 0;
    startRepos = new Set(['/p/work/.git']);
    monitor.refreshDerived();
    expect(monitor.snapshot().sessions.map((r) => r.locationShown)).toEqual([{ repo: false, where: false }]);
    expect(events).toEqual([{ type: 'sessions', upsert: [expect.objectContaining({ locationShown: { repo: false, where: false } })], remove: [] }]);
  });

  it('SIDE-6.2: when a poll fails, the last list stays and the health says since when; it recovers on its own', async () => {
    const t = setup(ok(recorded));
    await t.monitor.tick();
    const okAt = t.now();
    t.events.length = 0;

    t.advance(2000);
    t.set({ kind: 'error', message: 'fleet list timed out after 4 s' });
    await t.monitor.tick();
    expect(t.events).toEqual([{ type: 'fleet', fleet: { state: 'failing', lastOkAt: okAt, error: 'fleet list timed out after 4 s' } }]);
    expect(t.monitor.snapshot().sessions).toHaveLength(4);

    t.events.length = 0;
    t.advance(2000);
    await t.monitor.tick(); // still failing: no new event
    expect(t.events).toEqual([]);

    t.set(ok(recorded));
    await t.monitor.tick();
    expect(t.events).toEqual([{ type: 'fleet', fleet: { state: 'ok' } }]);
  });

  it('SIDE-6.1: when fleet is not installed, the list empties and the health carries the install command', async () => {
    const t = setup(ok(recorded));
    await t.monitor.tick();
    t.set({ kind: 'not-installed' });
    await t.monitor.tick();
    expect(t.monitor.snapshot()).toEqual({
      sessions: [],
      fleet: { state: 'not-installed', installCommand: FLEET_INSTALL_COMMAND },
    });
  });

  it('polls every 2 s only while someone watches', async () => {
    vi.useFakeTimers();
    try {
      const fetchList = vi.fn(async (): Promise<FleetListResult> => ok([]));
      const monitor = new SessionMonitor({ fetchList, git: { get: () => null, prune: () => {} }, onEvent: () => {} });
      expect(fetchList).not.toHaveBeenCalled();
      const unwatch = monitor.watch();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchList).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchList).toHaveBeenCalledTimes(2);
      const unwatch2 = monitor.watch(); // a second tab doesn't double the polling
      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchList).toHaveBeenCalledTimes(3);
      unwatch();
      unwatch2();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetchList).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('VIEW-5.7: the poll after a close starts after it: one already in flight (listed before the close) is waited for, not reused', async () => {
    const before = ok(recorded);
    const after = ok(recorded.slice(1));
    let release!: () => void;
    const calls: string[] = [];
    let closed = false;
    const monitor = new SessionMonitor({
      fetchList: async () => {
        calls.push(closed ? 'after' : 'before');
        if (!closed) await new Promise<void>((r) => (release = r));
        return closed ? after : before;
      },
      git: { get: () => null, prune: () => {} },
      onEvent: () => {},
    });
    const gone = recorded[0]!.session_id ?? `${recorded[0]!.harness}:${recorded[0]!.pid}`;
    const inFlight = monitor.tick(); // started while Fleet was still closing the Session
    closed = true;
    const refreshed = monitor.pollNow();
    release();
    await Promise.all([inFlight, refreshed]);
    expect(calls).toEqual(['before', 'after']);
    expect(monitor.get(gone)).toBeNull();
    // Without a poll in flight it polls at once.
    await monitor.pollNow();
    expect(calls).toEqual(['before', 'after', 'after']);
  });
});

it('MEM-4.2: memory growth re-derives only the growth field, and Fleet removal drops its row', async () => {
  let growth: number | null = null;
  let rows = [recorded[0]!];
  const events: MonitorEvent[] = [];
  const monitor = new SessionMonitor({ fetchList: async () => ok(rows), git: { get: () => null, prune: () => {} }, now: () => 1_792_146_000_000, memoryGrowth: () => growth, onEvent: (e) => events.push(e) });
  await monitor.tick();
  const before = monitor.snapshot().sessions[0]!;
  events.length = 0;
  growth = 30 * 1024 * 1024;
  monitor.refreshDerived();
  expect(events).toEqual([{ type: 'sessions', upsert: [{ ...before, memoryGrowthBytes: growth }], remove: [] }]);
  events.length = 0;
  growth = null;
  monitor.refreshDerived();
  expect(events).toEqual([{ type: 'sessions', upsert: [before], remove: [] }]);
  events.length = 0;
  rows = [];
  await monitor.tick();
  expect(events).toEqual([{ type: 'sessions', upsert: [], remove: [before.id] }]);
});
