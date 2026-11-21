import { describe, expect, it, vi } from 'vitest';
import type { EvidenceView } from '../shared/evidence.ts';
import type { ChangedCheckout, ChangedFile, ServerEvent } from '../shared/types.ts';
import type { RunOptions, Runner } from './exec.ts';
import { decide, Evidence, type EvidenceOptions, FIRST_PAGE_TIMEOUT_MS, PAGE_TIMEOUT_MS } from './evidence.ts';
import type { TestRun } from './test-runs.ts';

// Invented Session, commands and files.
const ID = '5b0c2c1e-0000-4000-8000-00000000000a';
const T = (hhmm: string) => Date.parse(`2026-11-18T${hhmm}:00Z`);
const iso = (ms: number) => new Date(ms).toISOString();
const PASS = '      Tests  2180 passed (2180)\n';
const FAIL = '      Tests  2 failed | 2178 passed (2180)\n';
const cmd = (key: string, at: number, extra: Record<string, unknown> = {}) => ({
  id: key, kind: 'command', key, tool_use_id: key, title: 'pnpm test', command: 'pnpm test 2>&1 | tail -5', cwd: '/shop', started_at: iso(at - 60_000),
  timestamp: iso(at), ended: 'exited', exit_code: 0, output_tail: PASS, output_chars: 40, harness: 'claude', session_id: ID, subagent: null, headless: false, pruned: false, ...extra,
});
const file = (path: string, extra: Partial<ChangedFile> = {}): ChangedFile => ({ path, oldPath: null, kind: 'modified', additions: 3, deletions: 1, binary: false, uncommitted: true, ...extra });
const checkout = (files: ChangedFile[], moreFiles = 0): ChangedCheckout => ({ id: 'c1', root: '/shop', repo: 'shop', where: 'fix/rates', additions: 10, deletions: 2, files, moreFiles });
const row = (extra: Record<string, unknown> = {}) => ({ id: ID, harness: 'claude' as const, status: 'idle' as const, done: null, backgroundShell: false, subagents: null, changes: { additions: 10, deletions: 2, files: 3 }, ...extra });
const answer = (results: unknown[], total = results.length) => JSON.stringify({ results, total_results: total, page: 1 });

function setup(over: Partial<EvidenceOptions> & { rows?: unknown[]; files?: ChangedFile[]; times?: Record<string, number | null> } = {}) {
  const events: ServerEvent[] = [];
  const rowsChanged = vi.fn();
  let files = over.files ?? [file('src/totals.ts'), file('src/round.ts'), file('src/round.test.ts', { kind: 'added' })];
  const times = over.times ?? { '/shop/src/totals.ts': T('14:20'), '/shop/src/round.ts': T('14:21'), '/shop/src/round.test.ts': T('14:22') };
  const runner = vi.fn<Runner>(async () => answer(over.rows ?? [cmd('t1', T('14:26'))]));
  const ev = new Evidence({
    runner,
    bin: () => '/nonexistent/tb-session',
    checkouts: () => (files.length ? [checkout(files)] : null),
    broadcast: (e) => events.push(e),
    onRowsChanged: rowsChanged,
    mtime: async (p) => times[p] ?? null,
    now: () => T('14:40'),
    log: () => {},
    ...over,
  });
  const last = () => (events.filter((e) => e.type === 'evidence').at(-1) as { evidence: EvidenceView | null } | undefined)?.evidence;
  return { ev, runner, events, rowsChanged, last, setFiles: (f: ChangedFile[]) => { files = f; } };
}
const settle = () => new Promise((r) => setTimeout(r, 5));

describe('EVID-1: which Sessions, and when Lookout reads', () => {
  it('EVID-1.1: a live Claude Code Session that is Idle or Done with Changes is in scope; Busy, Needs you, no Changes and Codex are not', () => {
    expect(Evidence.inScope(row())).toBe(true);
    expect(Evidence.inScope(row({ status: 'unknown', done: { at: T('14:32'), note: null } }))).toBe(true);
    expect(Evidence.inScope(row({ status: 'busy' }))).toBe(false);
    expect(Evidence.inScope(row({ status: 'needs-you', done: { at: T('14:32'), note: null } }))).toBe(false);
    expect(Evidence.inScope(row({ changes: null }))).toBe(false);
    expect(Evidence.inScope(row({ harness: 'codex' }))).toBe(false);
    expect(Evidence.inScope(row({ id: 'claude:4242' }))).toBe(false);
  });

  it('EVID-1.1: a Session out of scope shows nothing, and one that leaves scope loses its Evidence', async () => {
    const { ev, runner, last } = setup();
    ev.observe([row({ status: 'busy' })]);
    await settle();
    expect(runner).not.toHaveBeenCalled();
    ev.observe([row()]);
    await vi.waitFor(() => expect(last()).toBeTruthy());
    ev.observe([row({ status: 'busy' })]);
    expect(last()).toBeNull();
    expect(ev.rowEvidence(ID)).toBeNull();
  });

  it('EVID-1.2: reads every page of the Session’s commands with --all-projects, --session and --kind command', async () => {
    const rows = Array.from({ length: 2500 }, (_, n) => cmd(`t${n}`, T('14:00') + n * 1000, { output_tail: 'ok', command: 'ls' }));
    const runner = vi.fn<Runner>(async (_bin, args) => {
      const page = args.includes('--page') ? Number(args[args.indexOf('--page') + 1]) : 1;
      return answer(rows.slice((page - 1) * 1000, page * 1000), rows.length);
    });
    const { ev, last } = setup({ runner });
    ev.observe([row()]);
    await vi.waitFor(() => expect(last()).toBeTruthy());
    expect(runner.mock.calls.map(([, a]) => a)).toEqual([
      ['events', '--all-projects', '--session', ID, '--kind', 'command', '--limit', '1000', '--json'],
      ['events', '--all-projects', '--session', ID, '--kind', 'command', '--limit', '1000', '--json', '--page', '2'],
      ['events', '--all-projects', '--session', ID, '--kind', 'command', '--limit', '1000', '--json', '--page', '3'],
    ]);
  });

  it('EVID-1.3: reads on entering scope, a new Done, a background shell’s end and a Subagent’s end; one read at a time, one more after it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const runner = vi.fn<Runner>(async () => { await gate; return answer([cmd('t1', T('14:26'))]); });
    const { ev } = setup({ runner });
    ev.observe([row({ backgroundShell: true })]);
    await settle();
    expect(runner).toHaveBeenCalledTimes(1);
    // Three triggers during the read: one more read after it.
    ev.observe([row({ backgroundShell: false })]);
    ev.observe([row({ done: { at: T('14:32'), note: 'Fixed' } })]);
    ev.observe([row({ done: { at: T('14:32'), note: 'Fixed' }, subagents: { running: 0, finished: 1 } })]);
    expect(runner).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2));
    await settle();
    expect(runner).toHaveBeenCalledTimes(2);
    // A Done time that doesn't change, and a plain re-list, read nothing.
    ev.observe([row({ done: { at: T('14:32'), note: 'Fixed' }, subagents: { running: 0, finished: 1 } })]);
    await settle();
    expect(runner).toHaveBeenCalledTimes(2);
    // A new `fleet done` reads again.
    ev.observe([row({ done: { at: T('14:50'), note: 'Fixed again' }, subagents: { running: 0, finished: 1 } })]);
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(3));
  });

  it('EVID-1.3: one of several background shells ending reads, and so does a Subagent of an earlier Turn ending', async () => {
    const { ev, runner } = setup();
    ev.observe([row({ backgroundShell: true, backgroundShells: 2, subagents: { running: 1, finished: 0 } })]);
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));
    ev.observe([row({ backgroundShell: true, backgroundShells: 1, subagents: { running: 1, finished: 0 } })]);
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2));
    // An earlier Turn's Subagent: running drops, this Turn's finished count doesn't move.
    ev.observe([row({ backgroundShell: true, backgroundShells: 1, subagents: { running: 0, finished: 0 } })]);
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(3));
    // A new shell starting reads nothing.
    ev.observe([row({ backgroundShell: true, backgroundShells: 2, subagents: { running: 0, finished: 0 } })]);
    await settle();
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it('EVID-1.3: every Session in scope is read once when the server starts (its first list)', async () => {
    const { ev, runner } = setup();
    ev.observe([row(), row({ id: '5b0c2c1e-0000-4000-8000-00000000000b' }), row({ id: '5b0c2c1e-0000-4000-8000-00000000000c', status: 'busy' })]);
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2));
  });

  it('EVID-1.4: 60 s for the first read after the binary changed, 20 s otherwise; a page that takes longer fails the read', async () => {
    const limits: number[] = [];
    const runner = vi.fn<Runner>(async (_b, _a, opts: RunOptions) => { limits.push(opts.timeoutMs); return answer([cmd('t1', T('14:26'))]); });
    const { ev } = setup({ runner });
    ev.observe([row()]);
    await vi.waitFor(() => expect(limits).toHaveLength(1));
    ev.observe([row({ done: { at: T('14:32'), note: null } })]);
    await vi.waitFor(() => expect(limits).toHaveLength(2));
    expect(limits).toEqual([FIRST_PAGE_TIMEOUT_MS, PAGE_TIMEOUT_MS]);
    const slow = setup({ runner: vi.fn<Runner>(async () => Promise.reject(Object.assign(new Error('timed out'), { timedOut: true, code: null }))) });
    slow.ev.observe([row()]);
    await settle();
    expect(slow.last()).toBeUndefined();
  });

  it('EVID-1.5: a change in the Session’s Changes works the verdict out again, without a read', async () => {
    const times: Record<string, number | null> = { '/shop/src/totals.ts': T('14:20') };
    const { ev, runner, last, setFiles } = setup({ files: [file('src/totals.ts')], times });
    ev.observe([row()]);
    await vi.waitFor(() => expect(last()?.verdict.verdict).toBe('passed'));
    setFiles([file('src/totals.ts'), file('src/format.ts')]);
    times['/shop/src/format.ts'] = T('14:31');
    ev.changesChanged(ID);
    await vi.waitFor(() => expect(last()?.verdict.verdict).toBe('changed'));
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('EVID-1.6: the last read is kept in memory only, and dropped when the Session ends', async () => {
    const { ev, last } = setup();
    ev.observe([row()]);
    await vi.waitFor(() => expect(last()).toBeTruthy());
    expect(ev.views()).toHaveLength(1);
    ev.observe([]);
    expect(last()).toBeNull();
    expect(ev.views()).toEqual([]);
    expect(ev.rowEvidence(ID)).toBeNull();
  });

  it('EVID-1.7: a tb-session that refuses --kind command as a usage error gives no Session Evidence', async () => {
    const refusal = Object.assign(new Error('exit 2'), { code: 2, stderr: "error: invalid value 'command' for '--kind <KIND>'\n" });
    const tooOld = Object.assign(new Error('exit 2'), { code: 2, stderr: "error: unexpected argument '--kind' found\n" });
    let refuse: unknown = null;
    const runner = vi.fn<Runner>(async () => { if (refuse) throw refuse; return answer([cmd('t1', T('14:26'))]); });
    const { ev, last } = setup({ runner });
    ev.observe([row()]);
    await vi.waitFor(() => expect(last()).toBeTruthy());
    for (const r of [tooOld, refusal]) {
      refuse = r;
      ev.observe([row({ done: { at: T('14:32') + runner.mock.calls.length, note: null } })]);
      await vi.waitFor(() => expect(last()).toBeNull());
      expect(ev.views()).toEqual([]);
      refuse = null;
      ev.observe([row({ done: { at: T('14:33') + runner.mock.calls.length, note: null } })]);
      await vi.waitFor(() => expect(last()).toBeTruthy());
    }
  });

  it('EVID-1.8: a read that fails otherwise keeps the last Evidence, its verdict marked old with the reason; with no read that worked, none', async () => {
    let fail = false;
    const runner = vi.fn<Runner>(async () => { if (fail) throw Object.assign(new Error('exit 1'), { code: 1, stderr: 'index locked' }); return answer([cmd('t1', T('14:26'))]); });
    const { ev, last } = setup({ runner });
    ev.observe([row()]);
    await vi.waitFor(() => expect(last()?.error).toBeNull());
    const readAt = last()!.readAt;
    fail = true;
    ev.observe([row({ done: { at: T('14:32'), note: null } })]);
    await vi.waitFor(() => expect(last()?.error).toBe('tb-session failed: index locked'));
    expect(last()).toMatchObject({ readAt, verdict: { verdict: 'passed' } });
    const never = setup({ runner: vi.fn<Runner>(async () => 'not json') });
    never.ev.observe([row()]);
    await settle();
    expect(never.last()).toBeUndefined();
    expect(never.ev.rowEvidence(ID)).toBeNull();
  });
});

const run = (key: string, end: number, outcome: TestRun['outcome']): TestRun => ({ key, end, outcome, passed: null, failed: null, command: 'pnpm test', subagent: false });

describe('EVID-3: the verdict', () => {
  it('EVID-3.1: the last change is the latest modification time of the listed changed files; deleted, submodule and failed stats have none', async () => {
    const times = { '/shop/a.ts': T('14:20'), '/shop/b.ts': null, '/shop/gone.ts': T('15:00'), '/shop/mod': T('15:00') };
    const { ev, last } = setup({ files: [file('a.ts'), file('b.ts'), file('gone.ts', { kind: 'deleted' }), file('mod', { kind: 'submodule' })], times });
    ev.observe([row()]);
    await vi.waitFor(() => expect(last()?.lastChange).toBe(T('14:20')));
  });

  it('EVID-3.2: a run at or after the last change ended after it; with every changed file deleted, every run did', () => {
    expect(decide([run('a', T('14:20'), 'passed')], T('14:20')).verdict).toBe('passed');
    expect(decide([run('a', T('14:19'), 'passed')], T('14:20')).verdict).toBe('changed');
    expect(decide([run('a', T('09:00'), 'passed')], null).verdict).toBe('passed');
  });

  it('EVID-3.3: the table, row by row, with the deciding run the latest readable one after the last change', () => {
    const last = T('14:20');
    expect(decide([], last)).toEqual({ verdict: 'no-run', tone: 'warning', text: 'No test run', short: 'No test run' });
    expect(decide([run('b', T('14:25'), 'passed'), run('a', T('13:00'), 'running')], last)).toMatchObject({ verdict: 'running', tone: 'quiet', short: 'Tests running' });
    expect(decide([run('a', T('14:00'), 'passed')], last)).toMatchObject({ verdict: 'changed', tone: 'warning', text: 'Changed after its last test run', short: 'Changed since tests' });
    expect(decide([run('a', T('14:25'), 'passed')], last)).toMatchObject({ verdict: 'passed', tone: 'ok', text: 'Tests passed after its last change' });
    expect(decide([run('a', T('14:25'), 'failed')], last)).toMatchObject({ verdict: 'failed', short: 'Tests failed' });
    expect(decide([run('a', T('14:25'), 'timed-out')], last)).toMatchObject({ verdict: 'timed-out', short: 'Tests timed out' });
    expect(decide([run('a', T('14:25'), 'stopped')], last)).toMatchObject({ verdict: 'stopped', text: 'Its last test run was stopped' });
    expect(decide([run('a', T('14:25'), 'no-tests')], last)).toMatchObject({ verdict: 'no-tests', short: 'No tests ran' });
    expect(decide([run('a', T('14:25'), 'unread')], last)).toMatchObject({ verdict: 'unread', text: 'No readable test result after its last change', short: 'Result unread' });
    // An unread run after a readable one adds nothing.
    expect(decide([run('b', T('14:30'), 'unread'), run('a', T('14:25'), 'passed')], last)).toMatchObject({ verdict: 'passed' });
  });

  it('EVID-3.4: a later unread run makes a bad verdict "its last readable test run"', () => {
    const last = T('14:20');
    expect(decide([run('b', T('14:30'), 'unread'), run('a', T('14:25'), 'failed')], last).text).toBe('Its last readable test run failed');
    expect(decide([run('b', T('14:30'), 'unread'), run('a', T('14:25'), 'no-tests')], last).text).toBe('Its last readable test run ran no tests');
    expect(decide([run('b', T('14:24'), 'unread'), run('a', T('14:25'), 'failed')], last).text).toBe('Its last test run failed');
  });
});

describe('EVID-4.2 and the popover’s numbers', () => {
  it('EVID-4.2: counts the test files, added and deleted, and sums their lines; DIFF’s cap shows in the totals', async () => {
    const files = [file('src/a.test.ts', { kind: 'added', additions: 40, deletions: 0 }), file('tests/old.py', { kind: 'deleted', additions: 0, deletions: 8 }), file('src/a.ts'), file('e2e/new/x.ts', { kind: 'renamed', oldPath: 'e2e/x.ts', additions: 24, deletions: 0 })];
    const { ev, last } = setup({ files, checkouts: () => [checkout(files, 7)] });
    ev.observe([row()]);
    await vi.waitFor(() => expect(last()).toBeTruthy());
    expect(last()!.testFiles).toEqual({ count: 3, added: 1, deleted: 1, additions: 64, deletions: 8 });
    expect(last()).toMatchObject({ changedFiles: 11, listedFiles: 4 });
  });

  it('EVID-5.3: Last pass and Changed since: the latest pass, and the files changed after it, latest first (EVID-5.10)', async () => {
    const times = { '/shop/src/totals.ts': T('14:29'), '/shop/src/round.ts': T('14:30'), '/shop/src/format.ts': T('14:31'), '/shop/src/old.ts': T('14:00') };
    const files = [file('src/totals.ts'), file('src/round.ts'), file('src/format.ts'), file('src/old.ts')];
    const rows = [cmd('t3', T('14:24'), { output_tail: FAIL }), cmd('t2', T('14:26')), cmd('t1', T('13:58'))];
    const { ev, last } = setup({ files, times, rows });
    ev.observe([row()]);
    await vi.waitFor(() => expect(last()).toBeTruthy());
    expect(last()).toMatchObject({ lastPass: { end: T('14:26'), passed: 2180 }, runCount: 3, changedSince: 3, lastChange: T('14:31'), verdict: { verdict: 'changed' } });
    expect(last()!.changedSinceFiles.map((f) => f.path)).toEqual(['src/format.ts', 'src/round.ts', 'src/totals.ts']);
    expect(last()!.runs.map((r) => [r.key, r.outcome])).toEqual([['t2', 'passed'], ['t3', 'failed'], ['t1', 'passed']]);
  });

  it('EVID-5.3: with no run that passed, Changed since counts every changed file with a time and lists none', async () => {
    const { ev, last } = setup({ rows: [cmd('t1', T('14:26'), { output_tail: FAIL })] });
    ev.observe([row()]);
    await vi.waitFor(() => expect(last()).toBeTruthy());
    expect(last()).toMatchObject({ lastPass: null, changedSince: 3, changedSinceFiles: [], verdict: { verdict: 'failed' } });
  });

  it('EVID-5.6: a verdict that changes tells the rows once, so the mark follows', async () => {
    const { ev, last, rowsChanged } = setup();
    ev.observe([row()]);
    await vi.waitFor(() => expect(last()).toBeTruthy());
    await settle();
    expect(rowsChanged).toHaveBeenCalledTimes(1);
    expect(ev.rowEvidence(ID)).toMatchObject({ verdict: 'passed', tone: 'ok' });
  });
});
