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

/** EVID-6.2: how many reads ran, by their `events` calls; a read after a command that ran also lists headless Sessions. */
const reads = (runner: ReturnType<typeof vi.fn<Runner>>) => runner.mock.calls.filter(([, a]) => a[0] === 'events').length;

function setup(over: Partial<EvidenceOptions> & { rows?: unknown[]; listed?: unknown[]; files?: ChangedFile[]; times?: Record<string, number | null> } = {}) {
  const events: ServerEvent[] = [];
  const rowsChanged = vi.fn();
  let files = over.files ?? [file('src/totals.ts'), file('src/round.ts'), file('src/round.test.ts', { kind: 'added' })];
  const times = over.times ?? { '/shop/src/totals.ts': T('14:20'), '/shop/src/round.ts': T('14:21'), '/shop/src/round.test.ts': T('14:22') };
  const runner = vi.fn<Runner>(async (_bin, args) => (args[0] === 'list' ? answer(over.listed ?? []) : answer(over.rows ?? [cmd('t1', T('14:26'))])));
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
    expect(runner.mock.calls.map(([, a]) => a).filter((a) => a[0] === 'events')).toEqual([
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
    expect(reads(runner)).toBe(1);
    // Three triggers during the read: one more read after it.
    ev.observe([row({ backgroundShell: false })]);
    ev.observe([row({ done: { at: T('14:32'), note: 'Fixed' } })]);
    ev.observe([row({ done: { at: T('14:32'), note: 'Fixed' }, subagents: { running: 0, finished: 1 } })]);
    expect(reads(runner)).toBe(1);
    release();
    await vi.waitFor(() => expect(reads(runner)).toBe(2));
    await settle();
    expect(reads(runner)).toBe(2);
    // A Done time that doesn't change, and a plain re-list, read nothing.
    ev.observe([row({ done: { at: T('14:32'), note: 'Fixed' }, subagents: { running: 0, finished: 1 } })]);
    await settle();
    expect(reads(runner)).toBe(2);
    // A new `fleet done` reads again.
    ev.observe([row({ done: { at: T('14:50'), note: 'Fixed again' }, subagents: { running: 0, finished: 1 } })]);
    await vi.waitFor(() => expect(reads(runner)).toBe(3));
  });

  it('EVID-1.3: one of several background shells ending reads, and so does a Subagent of an earlier Turn ending', async () => {
    const { ev, runner } = setup();
    ev.observe([row({ backgroundShell: true, backgroundShells: 2, subagents: { running: 1, finished: 0 } })]);
    await vi.waitFor(() => expect(reads(runner)).toBe(1));
    ev.observe([row({ backgroundShell: true, backgroundShells: 1, subagents: { running: 1, finished: 0 } })]);
    await vi.waitFor(() => expect(reads(runner)).toBe(2));
    // An earlier Turn's Subagent: running drops, this Turn's finished count doesn't move.
    ev.observe([row({ backgroundShell: true, backgroundShells: 1, subagents: { running: 0, finished: 0 } })]);
    await vi.waitFor(() => expect(reads(runner)).toBe(3));
    // A new shell starting reads nothing.
    ev.observe([row({ backgroundShell: true, backgroundShells: 2, subagents: { running: 0, finished: 0 } })]);
    await settle();
    expect(reads(runner)).toBe(3);
  });

  it('EVID-1.3: every Session in scope is read once when the server starts (its first list)', async () => {
    const { ev, runner } = setup();
    ev.observe([row(), row({ id: '5b0c2c1e-0000-4000-8000-00000000000b' }), row({ id: '5b0c2c1e-0000-4000-8000-00000000000c', status: 'busy' })]);
    await vi.waitFor(() => expect(reads(runner)).toBe(2));
  });

  it('EVID-1.4: 60 s for the first read after the binary changed, 20 s otherwise; a page that takes longer fails the read', async () => {
    const limits: number[] = [];
    const runner = vi.fn<Runner>(async (_b, a, opts: RunOptions) => { if (a[0] === 'events') limits.push(opts.timeoutMs); return answer(a[0] === 'list' ? [] : [cmd('t1', T('14:26'))]); });
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
    expect(reads(runner)).toBe(1);
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

// Invented Subagent calls (contract A2) and headless Sessions (`list`, contract M1).
const agentCall = (key: string, start: number, end: number, extra: Record<string, unknown> = {}) => ({
  id: key, kind: 'agent', key, tool_use_id: key, title: 'Code review round 2', description: 'Code review round 2', subagent_type: 'general-purpose', model: 'claude-opus-5-5', effort: 'xhigh',
  agent_id: `a-${key}`, background: true, started_at: iso(start), timestamp: iso(end), ended: 'completed', harness: 'claude', session_id: ID, subagent: null, headless: false, pruned: false, ...extra,
});
const listed = (session: string, harness: string, created: number, extra: Record<string, unknown> = {}) => ({
  session_id: session, harness, headless: true, transcript_missing: false, summary: 'Review', first_prompt: 'Review the diff', project_path: '/shop',
  created_at: iso(created), modified_at: iso(created + 300_000), ...extra,
});
const CODEX = '01a1ff23-0000-7000-8000-000000000001';
const CLAUDE = '6c2d0000-0000-4000-8000-000000000002';
const review = (key: string, start: number, end: number, extra: Record<string, unknown> = {}) => cmd(key, end, { command: 'codex-run.sh /tmp/p-codex-dual-review-1 /shop', title: 'codex-run.sh', started_at: iso(start), output_tail: '', ...extra });

describe('EVID-6: Review rounds', () => {
  it('EVID-6.2: with a tb-session that gives Subagent calls the read asks for command,agent; with an older one, or one TOOLS can’t read, for commands alone', async () => {
    for (const [version, kind] of [['0.6.0', 'command,agent'], ['0.7.1', 'command,agent'], ['0.5.0', 'command'], [null, 'command']] as const) {
      const { ev, runner, last } = setup({ toolVersion: () => version });
      ev.observe([row()]);
      await vi.waitFor(() => expect(last()).toBeTruthy());
      expect(runner.mock.calls[0]![1]).toEqual(['events', '--all-projects', '--session', ID, '--kind', kind, '--limit', '1000', '--json']);
    }
  });

  it('EVID-6.2: when TOOLS learns a version that has Subagent calls after a read asked for commands alone, the Session is read again', async () => {
    let version: string | null = null;
    const { ev, runner, last } = setup({ toolVersion: () => version });
    ev.observe([row()]);
    await vi.waitFor(() => expect(last()).toBeTruthy());
    expect(runner.mock.calls.filter(([, a]) => a[0] === 'events').map(([, a]) => a[5])).toEqual(['command']);
    // The same answer reads nothing more; one that changes what can be asked does.
    ev.toolsChanged();
    await settle();
    expect(reads(runner)).toBe(1);
    version = '0.6.0';
    ev.toolsChanged();
    await vi.waitFor(() => expect(reads(runner)).toBe(2));
    expect(runner.mock.calls.filter(([, a]) => a[0] === 'events').map(([, a]) => a[5])).toEqual(['command', 'command,agent']);
    ev.toolsChanged();
    await settle();
    expect(reads(runner)).toBe(2);
  });

  it('EVID-6.2: a tb-session that refuses the agent kind after all is read again for commands alone', async () => {
    const runner = vi.fn<Runner>(async (_b, a) => {
      if (a.includes('command,agent')) throw Object.assign(new Error('exit 2'), { code: 2, stderr: "error: invalid value 'agent' for '--kind <KIND>'\n" });
      return answer(a[0] === 'list' ? [] : [cmd('t1', T('14:26'))]);
    });
    const { ev, last } = setup({ runner, toolVersion: () => '0.6.0' });
    ev.observe([row()]);
    await vi.waitFor(() => expect(last()).toBeTruthy());
    expect(last()).toMatchObject({ error: null, verdict: { verdict: 'passed' } });
    expect(runner.mock.calls.map(([, a]) => (a[0] === 'list' ? 'list' : a[5]))).toEqual(['command,agent', 'command', 'list']);
  });

  it('EVID-6.2: after a command that ran, whatever its words, it lists the headless Sessions since its UTC day, page after page, with the same time limit, and keeps Codex and Claude Code', async () => {
    const pages = [
      [listed(CODEX, 'codex', T('14:14')), listed('7a000000-0000-4000-8000-000000000003', 'pi', T('14:14')), ...Array.from({ length: 198 }, (_, n) => listed(`7b000000-0000-4000-8000-${String(n).padStart(12, '0')}`, 'codex', T('09:00')))],
      [listed(CLAUDE, 'claude', T('14:14'))],
    ];
    const limits: number[] = [];
    const runner = vi.fn<Runner>(async (_b, a, opts: RunOptions) => {
      limits.push(opts.timeoutMs);
      if (a[0] === 'list') return answer(pages[a.includes('--page') ? 1 : 0]!, 201);
      return answer([cmd('t1', T('14:26')), review('r1', T('14:14'), T('14:21')), cmd('x', T('14:00'), { command: 'ls', started_at: '2026-11-17T23:59:00Z', ended: 'refused', exit_code: null })]);
    });
    const { ev, last } = setup({ runner });
    ev.observe([row()]);
    await vi.waitFor(() => expect(last()).toBeTruthy());
    expect(runner.mock.calls.map(([, a]) => a).filter((a) => a[0] === 'list')).toEqual([
      // The refused command's earlier day doesn't count: it never ran.
      ['list', '--all-projects', '--headless', 'only', '--after', '2026-11-18', '--limit', '200', '--json'],
      ['list', '--all-projects', '--headless', 'only', '--after', '2026-11-18', '--limit', '200', '--json', '--page', '2'],
    ]);
    expect(new Set(limits)).toEqual(new Set([FIRST_PAGE_TIMEOUT_MS]));
    expect(last()!.rounds).toHaveLength(1);
    expect(last()!.rounds[0]!.reviewers.map((r) => (r.kind === 'headless' ? r.harness : r.kind))).toEqual(['codex', 'claude']);
  });

  it('EVID-6.2: a Session whose every command was refused, or that has none, reads nothing more', async () => {
    for (const rows of [[], [cmd('x', T('14:00'), { ended: 'refused', exit_code: null })]]) {
      const { ev, runner, last } = setup({ rows });
      ev.observe([row()]);
      await vi.waitFor(() => expect(last()).toBeTruthy());
      expect(runner.mock.calls.map(([, a]) => a[0])).toEqual(['events']);
    }
  });

  it('EVID-6.2: a failed list read keeps the Session’s last rounds, and its reason shows as EVID-1.8 says', async () => {
    let fail = false;
    const runner = vi.fn<Runner>(async (_b, a) => {
      if (a[0] === 'list') {
        if (fail) throw Object.assign(new Error('exit 1'), { code: 1, stderr: 'index locked' });
        return answer([listed(CODEX, 'codex', T('14:14'))]);
      }
      return answer(fail ? [cmd('t1', T('14:26'))] : [cmd('t1', T('14:26')), review('r1', T('14:14'), T('14:21'))]);
    });
    const { ev, last } = setup({ runner });
    ev.observe([row()]);
    await vi.waitFor(() => expect(last()?.rounds).toHaveLength(1));
    fail = true;
    ev.observe([row({ done: { at: T('14:32'), note: null } })]);
    await vi.waitFor(() => expect(last()?.error).toBe('tb-session failed: index locked'));
    expect(last()!.rounds).toHaveLength(1);
  });

  it('EVID-6.3: the view carries each round, the latest start first, from the Subagent calls and the headless reviewers', async () => {
    const rows = [
      cmd('t1', T('14:29')),
      review('r1', T('14:14'), T('14:21')),
      review('r2', T('14:14') + 1000, T('14:19'), { command: 'claude-run.sh /tmp/p-codex-dual-review-1 /shop' }),
      agentCall('a1', T('14:00'), T('14:04')),
      agentCall('a2', T('13:00'), T('13:02'), { description: 'Implement the tile', model: 'claude-sonnet-5-5' }),
    ];
    const { ev, last } = setup({ rows, listed: [listed(CODEX, 'codex', T('14:14') + 2000, { model: 'gpt-6.1-sol', effort: 'xhigh' }), listed(CLAUDE, 'claude', T('14:14') + 3000, { transcript_missing: true })], toolVersion: () => '0.6.0' });
    ev.observe([row()]);
    await vi.waitFor(() => expect(last()?.rounds).toHaveLength(2));
    expect(last()!.rounds).toEqual([
      {
        key: 'r1', outcome: 'finished', start: T('14:14'), end: T('14:21'),
        runs: ['codex-run.sh /tmp/p-codex-dual-review-1 /shop', 'claude-run.sh /tmp/p-codex-dual-review-1 /shop'],
        reviewers: [
          { kind: 'headless', harness: 'codex', sessionId: CODEX, transcriptMissing: false, model: 'gpt-6.1-sol', effort: 'xhigh' },
          { kind: 'headless', harness: 'claude', sessionId: CLAUDE, transcriptMissing: true, model: null, effort: null },
        ],
      },
      { key: 'a1', outcome: 'finished', start: T('14:00'), end: T('14:04'), runs: ['Code review round 2'], reviewers: [{ kind: 'subagent', model: 'claude-opus-5-5', count: 1 }] },
    ]);
  });

  it('EVID-6.4: the files changed since the latest finished round’s end', async () => {
    const rows = [cmd('t1', T('14:26')), review('r1', T('14:10'), T('14:20') + 30_000)];
    const { ev, last } = setup({ rows, listed: [listed(CODEX, 'codex', T('14:10'))] });
    ev.observe([row()]);
    // round.ts at 14:21 and round.test.ts at 14:22 changed after 14:20:30; totals.ts at 14:20 didn't.
    await vi.waitFor(() => expect(last()?.changedSinceReview).toBe(2));
    const none = setup({ rows: [cmd('t1', T('14:26'))] });
    none.ev.observe([row()]);
    await vi.waitFor(() => expect(none.last()).toMatchObject({ rounds: [], changedSinceReview: 0 }));
  });

  it('EVID-6.8: rounds never change the verdict, the status line’s part or the row’s mark', async () => {
    let withReview = false;
    const runner = vi.fn<Runner>(async (_b, a) => {
      if (a[0] === 'list') return answer([listed(CODEX, 'codex', T('14:14'))]);
      return answer(withReview ? [cmd('t1', T('14:26')), review('r1', T('14:14'), T('14:21'))] : [cmd('t1', T('14:26'))]);
    });
    const { ev, last, rowsChanged } = setup({ runner });
    ev.observe([row()]);
    await vi.waitFor(() => expect(last()).toBeTruthy());
    const before = last()!.verdict;
    await settle();
    expect(rowsChanged).toHaveBeenCalledTimes(1);
    withReview = true;
    ev.observe([row({ done: { at: T('14:32'), note: null } })]);
    await vi.waitFor(() => expect(last()?.rounds).toHaveLength(1));
    await settle();
    expect(last()!.verdict).toEqual(before);
    expect(rowsChanged).toHaveBeenCalledTimes(1);
  });

  it('EVID-6.9: with a tb-session that gives no Subagent calls and no model, Subagent runs are missing and a reviewer is its Harness alone', async () => {
    const rows = [cmd('t1', T('14:26')), review('r1', T('14:14'), T('14:21')), agentCall('a1', T('14:00'), T('14:04'))];
    // This fake gives Subagent calls only when asked for them, as tb-session 0.6.0 does; 0.5.0 is asked for commands alone.
    const answered = setup({ runner: vi.fn<Runner>(async (_b, a) => answer(a[0] === 'list' ? [listed(CODEX, 'codex', T('14:14'))] : rows.filter((r) => r.kind === 'command' || a.includes('command,agent')))), toolVersion: () => '0.5.0' });
    answered.ev.observe([row()]);
    await vi.waitFor(() => expect(answered.last()?.rounds).toHaveLength(1));
    expect(answered.last()!.rounds[0]!.reviewers).toEqual([{ kind: 'headless', harness: 'codex', sessionId: CODEX, transcriptMissing: false, model: null, effort: null }]);
  });
});
