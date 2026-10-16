import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GitLocation } from '../shared/types.ts';
import type { FleetRow } from './fleet.ts';
import { normalizeRows, sessionId, toStatus } from './normalize.ts';

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
        model: 'claude-opus-5-5',
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
        model: 'gpt-6-astra',
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
        model: 'claude-opus-5-5',
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
        model: 'claude-opus-5-5',
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

  it('SIDE-1.5: only tmux and iTerm2 Sessions are Controllable', () => {
    const rows = normalizeRows(fixture('handcrafted-backends.json'), deps);
    const byBackend = Object.fromEntries(rows.map((r) => [r.backend, r.controllable]));
    expect(byBackend).toEqual({ iterm: true, tmux: true, unknown: false });
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
