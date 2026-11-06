import { describe, expect, it } from 'vitest';
import { attributeJobs, jobTool, parseResStatus, queueOrder, queuedFor, waitingCount, type ResJob } from './res.ts';

const t0 = Date.parse('2026-11-06T09:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

/** `res status --json` as res 2026-11 prints it: machine, budget, then the ledger's entries. */
function status(entries: unknown[]): string {
  return JSON.stringify({ machine: { cores: 12, perf: 8, eff: 4, totalMB: 24576 }, load1: 3.5, psCores: 2, availMB: 8438, freePct: 62, budget: { reserve: { cores: 2, mb: 4096 }, headCores: 0, headMB: 0, freeCores: 8, freeMB: 4342, usage: {} }, entries });
}

const holding = {
  id: '95100-mhd', pid: 95100, session: 'varane-108', cwd: '/w/fantastic', command: 'npx vitest run',
  cls: 'vitest@fantastic-productive', tool: 'vitest', kind: 'run', prio: 'check', state: 'holding', workers: 3, cores: 3, mb: 2600, idle: false,
  req: { scaled: true, workers: 3, minWorkers: 2, perWorker: { cores: 1, mb: 700 }, baseMB: 500, source: 'default' },
  queuedAt: iso(t0 - 120_000), waitingSince: iso(t0 - 120_000), since: iso(t0 - 60_000), peakMB: 1800, peakCores: 2.7,
};
const waiting = (id: string, prio: string, waitedMs: number, extra: Record<string, unknown> = {}) => ({
  id, pid: 200, session: 'lookout-res', cwd: '/w/lookout', command: 'pnpm exec vitest run', cls: 'vitest@agents-lookout', tool: 'vitest',
  kind: 'run', prio, state: 'waiting', req: { scaled: true, workers: 3, minWorkers: 2, perWorker: { cores: 1, mb: 700 }, baseMB: 500 },
  queuedAt: iso(t0 - waitedMs), waitingSince: iso(t0 - waitedMs), ...extra,
});

const job = (over: Partial<ResJob>): ResJob => ({
  id: 'j', pid: 1, kind: 'run', state: 'waiting', prio: 'check', cls: 'vitest@x', cores: 1, mb: 1, since: null,
  waitingSince: t0, queuedAt: t0, session: null, sessionId: null, position: null, ...over,
});

describe('res', () => {
  it('RES-1.1: reads each entry: a holder by its lease, a waiter by what it needs; an entry it cannot read is skipped', () => {
    const jobs = parseResStatus(status([holding, waiting('w1', 'check', 30_000), { pid: 'x' }, { ...holding, id: 'bad', state: 'done' }]));
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ id: '95100-mhd', pid: 95100, kind: 'run', state: 'holding', prio: 'check', cls: 'vitest@fantastic-productive', cores: 3, mb: 2600, since: t0 - 60_000, session: 'varane-108' });
    // need(req): 3 workers × 1 core, 500 + 3 × 700 MB.
    expect(jobs[1]).toMatchObject({ state: 'waiting', cores: 3, mb: 2600, waitingSince: t0 - 30_000 });
    expect(parseResStatus(status([{ ...waiting('w2', 'bg', 0), req: { scaled: false, workers: 1, cores: 1.5, mb: 3000 } }]))[0]).toMatchObject({ cores: 1.5, mb: 3000 });
  });

  it('RES-1.2: output that is not res\'s JSON throws, so the read counts as failed', () => {
    expect(() => parseResStatus('budget  cpu 12 cores')).toThrow();
    expect(() => parseResStatus('{"machine":{}}')).toThrow(/no entries/);
  });

  it('RES-1.3: waiters in res\'s order: priority raised a level per 5 min waited, then first queued; holders first', () => {
    const jobs = parseResStatus(status([
      waiting('check-new', 'check', 10_000),
      waiting('live', 'live', 1_000),
      holding,
      waiting('check-old', 'check', 30_000),
      waiting('bg-aged', 'bg', 11 * 60_000),
    ]));
    const order = queueOrder(jobs, t0);
    expect(order.map((j) => [j.id, j.position])).toEqual([['95100-mhd', null], ['bg-aged', 1], ['live', 2], ['check-old', 3], ['check-new', 4]]);
  });

  it('RES-1.4: a job belongs to the one Session in its tmux session, else to the Session with its id; a shared tmux session names none', () => {
    const jobs = [job({ id: 'a', session: 'rates' }), job({ id: 'b', session: 'abc-123' }), job({ id: 'c', session: 'shared' }), job({ id: 'd', session: 'gone' }), job({ id: 'e', session: null })];
    const sessions = [
      { id: 's-rates', tmuxSession: 'rates' },
      { id: 'abc-123', tmuxSession: null },
      { id: 's1', tmuxSession: 'shared' },
      { id: 's2', tmuxSession: 'shared' },
    ];
    expect(attributeJobs(jobs, sessions).map((j) => [j.id, j.sessionId])).toEqual([['a', 's-rates'], ['b', 'abc-123'], ['c', null], ['d', null], ['e', null]]);
  });

  it('RES-3.1: a Session\'s Queued mark is its longest-waiting job, with the tool and its place', () => {
    const jobs = [
      job({ id: 'newer', cls: 'tsc@x', sessionId: 's', waitingSince: t0 - 1000, position: 1 }),
      job({ id: 'older', cls: 'vitest@agents-lookout', sessionId: 's', waitingSince: t0 - 60_000, position: 2 }),
      job({ id: 'held', state: 'holding', sessionId: 's', waitingSince: t0 - 600_000 }),
      job({ id: 'other', sessionId: 'o', waitingSince: t0 - 600_000, position: 3 }),
    ];
    const res = { jobs, readAt: t0, error: null };
    expect(queuedFor(res, 's')).toEqual({ tool: 'vitest', since: t0 - 60_000, position: 2 });
    expect(queuedFor(res, 'nobody')).toBeNull();
    expect(queuedFor(null, 's')).toBeNull();
    expect(waitingCount(res)).toBe(3);
    expect(jobTool({ cls: 'playwright test@a@b' })).toBe('playwright test@a');
    expect(jobTool({ cls: 'vitest@work@2', tool: 'vitest' })).toBe('vitest');
  });
});
