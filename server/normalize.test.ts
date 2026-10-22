import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GitLocation } from '../shared/types.ts';
import type { FleetRow } from './fleet.ts';
import { effort, normalizeRows, procStart, sessionId, toStatus } from './normalize.ts';

const fixture = (name: string): FleetRow[] =>
  JSON.parse(readFileSync(new URL(`./fixtures/fleet/${name}`, import.meta.url), 'utf8')).filter(
    (r: Record<string, unknown>) => typeof r.pid === 'number',
  );

const GIT: Record<string, GitLocation> = {
  '/Users/dariofilipaj/Projects/work': { repo: 'work', worktree: null, branch: 'main' },
  '/Users/dariofilipaj/Projects/lookout-demo/demo-repo-wt': { repo: 'demo-repo', worktree: 'demo-repo-wt', branch: 'feature/demo' },
};
const deps = {
  git: (cwd: string) => GIT[cwd] ?? null,
  statusSince: (_id: string, _status: string, at: number | null) => at,
};

describe('fleet list → sidebar rows', () => {
  it('SIDE-1.4: the recorded `fleet list --json` output produces the expected rows', () => {
    const rows = normalizeRows(fixture('recorded-2026-10-16.json'), deps);
    expect(rows).toEqual([
      {
        id: '11111111-1111-4111-8111-111111111111',
        pid: 12434,
        harness: 'claude',
        title: 'lookout-test-claude',
        status: 'needs-you',
        waitingFor: 'input needed',
        statusSince: 1792145455214,
        contextPct: 6,
        cwd: '/Users/dariofilipaj/Projects/lookout-demo/plain-dir',
        git: null,
        backend: 'tmux',
        controllable: true,
        ownHost: true,
        model: 'claude-opus-5-5',
        effort: null,
        procStart: null,
        pendingModel: null,
        modelAt: null,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        pid: 14352,
        harness: 'codex',
        title: 'Run curl command',
        status: 'idle',
        waitingFor: null,
        statusSince: 1792145434397,
        contextPct: 8,
        cwd: '/Users/dariofilipaj/Projects/lookout-demo/demo-repo-wt',
        git: { repo: 'demo-repo', worktree: 'demo-repo-wt', branch: 'feature/demo' },
        backend: 'tmux',
        controllable: true,
        ownHost: true,
        model: 'gpt-6-astra',
        effort: null,
        procStart: null,
        pendingModel: null,
        modelAt: null,
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        pid: 88030,
        harness: 'claude',
        title: 'summarize-this-months-metrics',
        status: 'idle',
        waitingFor: null,
        statusSince: 1792145421960,
        contextPct: 17,
        cwd: '/Users/dariofilipaj/Projects/work',
        git: { repo: 'work', worktree: null, branch: 'main' },
        backend: 'unknown',
        controllable: false,
        ownHost: false,
        model: 'claude-opus-5-5',
        effort: null,
        procStart: null,
        pendingModel: null,
        modelAt: null,
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        pid: 85928,
        harness: 'claude',
        title: 'sketch-a-ui-for-watching',
        status: 'busy',
        waitingFor: null,
        statusSince: 1792145011865,
        contextPct: 10,
        cwd: '/Users/dariofilipaj/Projects/work',
        git: { repo: 'work', worktree: null, branch: 'main' },
        backend: 'unknown',
        controllable: false,
        ownHost: false,
        model: 'claude-opus-5-5',
        effort: null,
        procStart: null,
        pendingModel: null,
        modelAt: null,
      },
    ]);
  });

  it('SIDE-1.4: hand-crafted rows cover iTerm2, unknown backends, Codex without a session id, and drop pi and malformed rows', () => {
    const rows = normalizeRows(fixture('handcrafted-backends.json'), deps);
    expect(rows.map((r) => [r.id, r.harness, r.status, r.backend])).toEqual([
      ['aaaaaaaa-0000-4000-8000-000000000001', 'claude', 'needs-you', 'iterm'],
      ['codex:50002', 'codex', 'idle', 'tmux'],
      ['cccccccc-0000-4000-8000-000000000003', 'claude', 'busy', 'unknown'],
      ['dddddddd-0000-4000-8000-000000000004', 'claude', 'unknown', 'tmux'],
      ['ffffffff-0000-4000-8000-000000000006', 'codex', 'needs-you', 'tmux'],
    ]);
    // An empty display title still gives the row a name.
    expect(rows[3]!.title).toBe('claude 50004');
    expect(rows[3]!.statusSince).toBeNull();
  });

  it('VIEW-5.11: Fleet\'s `effort` reaches the row, and a Fleet without the field (the 2026-10-16 recording) gives null', () => {
    const rows = normalizeRows(fixture('handcrafted-backends.json'), deps);
    expect(rows.map((r) => [r.id, r.effort])).toEqual([
      ['aaaaaaaa-0000-4000-8000-000000000001', 'high'],
      ['codex:50002', null],
      ['cccccccc-0000-4000-8000-000000000003', null],
      ['dddddddd-0000-4000-8000-000000000004', null],
      ['ffffffff-0000-4000-8000-000000000006', 'xhigh'],
    ]);
    expect(normalizeRows(fixture('messages/list.json'), deps).map((r) => r.effort)).toEqual(['high', 'xhigh', null, 'medium', 'high']);
    expect(normalizeRows(fixture('recorded-2026-10-16.json'), deps).every((r) => r.effort === null)).toBe(true);
  });

  it('VIEW-6.8: Fleet\'s `model_at` reaches the row as `modelAt`; a Fleet without it, or one that isn\'t a string, gives null', () => {
    const rows = normalizeRows(fixture('messages/list.json'), deps);
    expect(rows.find((r) => r.id === 'dddddddd-0000-4000-8000-000000000104')?.modelAt).toBe('2026-10-14T09:31:00Z');
    expect(normalizeRows(fixture('recorded-2026-10-16.json'), deps).every((r) => r.modelAt === null)).toBe(true);
    const base = { session_id: 'eeeeeeee-0000-4000-8000-000000000005', pid: 1, harness: 'claude', backend: 'tmux', status: 'idle', display_title: 'x' };
    expect(normalizeRows([{ ...base, model_at: 42 }] as never, deps)[0]!.modelAt).toBeNull();
  });

  it('VIEW-5.11: an effort is kept only as a short word; anything else is null', () => {
    for (const ok of ['low', 'medium', 'high', 'xhigh', 'max', 'extra-high', 'x_2']) expect(effort(ok)).toBe(ok);
    for (const bad of [undefined, null, '', ' ', 'high ', 'very high', 'x'.repeat(17), 3, true, {}, ['high'], '<b>high</b>']) {
      expect(effort(bad)).toBeNull();
    }
  });

  it('SIDE-1.5: only tmux and iTerm2 Sessions are Controllable', () => {
    const rows = normalizeRows(fixture('handcrafted-backends.json'), deps);
    const byBackend = Object.fromEntries(rows.map((r) => [r.backend, r.controllable]));
    expect(byBackend).toEqual({ iterm: true, tmux: true, unknown: false });
  });

  it('VIEW-5.6: a Session has its own host only when it is tmux-backed and no other listed Session (pi included) shares that tmux session', () => {
    const base = { session_id: null, cwd: null, status: 'idle', waiting_for: null, updated_at: null, display_title: 'x', context: null, model: null };
    const rows = normalizeRows(
      [
        { ...base, pid: 1, harness: 'claude', backend: 'tmux', tmux_session: 'alone' },
        { ...base, pid: 2, harness: 'claude', backend: 'tmux', tmux_session: 'work' },
        { ...base, pid: 3, harness: 'codex', backend: 'tmux', tmux_session: 'work' },
        { ...base, pid: 4, harness: 'codex', backend: 'tmux', tmux_session: 'with-pi' },
        { ...base, pid: 5, harness: 'pi', backend: 'tmux', tmux_session: 'with-pi' },
        { ...base, pid: 6, harness: 'claude', backend: 'tmux', tmux_session: null },
        { ...base, pid: 7, harness: 'claude', backend: 'iterm', tmux_session: null },
      ],
      deps,
    );
    expect(rows.map((r) => [r.pid, r.ownHost])).toEqual([
      [1, true],
      [2, false],
      [3, false],
      [4, false],
      [6, false],
      [7, false],
    ]);
  });

  it('VIEW-5.6: `proc_start` is kept verbatim when it is a bounded RFC 3339 UTC time, and null otherwise', () => {
    const base = { session_id: null, cwd: null, status: 'idle', waiting_for: null, updated_at: null, display_title: 'x', context: null, model: null, harness: 'claude', backend: 'tmux' };
    const rows = normalizeRows(
      [
        { ...base, pid: 1, proc_start: '2026-10-14T08:12:03Z' },
        { ...base, pid: 2, proc_start: '2026-10-14T08:12:03.123456789Z' },
        { ...base, pid: 3, proc_start: null },
        { ...base, pid: 4 },
        { ...base, pid: 5, proc_start: 1792145455 as unknown as string },
      ],
      deps,
    );
    expect(rows.map((r) => r.procStart)).toEqual(['2026-10-14T08:12:03Z', '2026-10-14T08:12:03.123456789Z', null, null, null]);
    for (const bad of ['', 'yesterday', '2026-10-14T08:12:03', '2026-10-14T08:12:03+02:00', '2026-10-14 08:12:03Z', '2026-02-30T08:12:03Z', '2026-10-14T25:00:00Z', ` 2026-10-14T08:12:03Z`, `2026-10-14T08:12:03.${'0'.repeat(30)}Z`, '--expect-start']) {
      expect(procStart(bad)).toBeNull();
    }
  });

  it('SIDE-2.3: a Needs you row carries what it waits for; other rows never do', () => {
    const rows = normalizeRows(fixture('handcrafted-backends.json'), deps);
    expect(rows[0]!.waitingFor).toBe('permission: Bash(bundle exec rspec spec/models/deal_spec.rb)');
    expect(rows[4]!.waitingFor).toBeNull(); // waiting, but Fleet didn't say on what
    expect(rows.filter((r) => r.status !== 'needs-you').every((r) => r.waitingFor === null)).toBe(true);
    const busyWithText = normalizeRows([{ ...rows0(), status: 'busy', waiting_for: 'stale text' }], deps);
    expect(busyWithText[0]!.waitingFor).toBeNull();
  });

  it('SIDE-2.4: context usage is a percentage when Fleet reports it, and null when it does not', () => {
    const rows = normalizeRows(fixture('handcrafted-backends.json'), deps);
    expect(rows[0]!.contextPct).toBe(41);
    expect(rows[1]!.contextPct).toBeNull();
    expect(rows[3]!.contextPct).toBe(1); // 0.5 rounds
  });

  it('maps Fleet statuses onto Glossary Statuses', () => {
    expect(['waiting', 'busy', 'idle', 'unknown', 'dormant'].map(toStatus)).toEqual([
      'needs-you',
      'busy',
      'idle',
      'unknown',
      'unknown',
    ]);
  });

  it('identifies a Session by session_id, else <harness>:<pid>', () => {
    expect(sessionId({ session_id: 'abc', harness: 'claude', pid: 1 })).toBe('abc');
    expect(sessionId({ session_id: null, harness: 'codex', pid: 7 })).toBe('codex:7');
  });
});

function rows0(): FleetRow {
  return fixture('handcrafted-backends.json')[0]!;
}
