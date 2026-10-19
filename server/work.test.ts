import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TB_PR_INSTALL_COMMAND } from '../shared/defaults.ts';
import type { WorkSnapshot } from '../shared/work.ts';
import type { RunError, RunOptions } from './exec.ts';
import { sanitizeLine } from './sanitize.ts';
import {
  PR_REASON,
  RATE_LIMIT_MIN_MS,
  ReadLane,
  TbPrShapeError,
  WORK_COOLDOWN_MS,
  WORK_INTERVAL_MS,
  WorkCommandRefused,
  WorkMonitor,
  acceptPrUrl,
  byUrgency,
  classifyTbPrFailure,
  every401,
  isAllowedWorkCommand,
  marksFor,
  parseTbPrList,
  plainIssue,
  rateLimitedUntil,
  resolveWorkBin,
  runWorkCommand,
} from './work.ts';

/**
 * Fixtures in `fixtures/tb-pr/` are tb-pr 0.3.1's output, written from its source (`Pr`, `BoardState`
 * and `ColumnIssue` in `core/model.rs` as serde prints them; errors as `run_main!`, `send_get`,
 * `gh_auth_token` and `summarize_fetch_error` word them), with made-up repos, titles and people.
 */
const fixture = (name: string) => readFileSync(new URL(`./fixtures/tb-pr/${name}`, import.meta.url), 'utf8');
const LIST = fixture('list.json');
const FETCHED = Date.parse('2026-10-19T10:00:00.482913Z');
const failedRun = (stderr: string, code = 1): RunError => Object.assign(new Error(`tb-pr exited with ${code}`), { code, stderr, stdout: '', timedOut: false });
const ids = (prs: { repo: string; number: number }[]) => prs.map((p) => `${p.repo}#${p.number}`);
/** A board to change in place: tb-pr's JSON, loosely typed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test edits arbitrary JSON
type Loose = Record<string, any>;
const withBoard = (mutate: (b: Loose) => void, text = LIST) => {
  const b = JSON.parse(text) as Loose;
  mutate(b);
  return JSON.stringify(b);
};
const FAKE_TOKENS = ['ghp_FAKEfake0123456789', 'github_pat_11FAKE_fake0123', 'tok3n-s3cret-v4lue', 'sekr1t-header'];
const leaky = `Error: GitHub API error (502): proxy said Authorization: token sekr1t-header and token=tok3n-s3cret-v4lue for ghp_FAKEfake0123456789 github_pat_11FAKE_fake0123\nsecond line ghp_FAKEfake0123456789`;

describe('reading `tb-pr list --json` (tb-pr 0.3.1)', () => {
  it('WORK-3.1: Mine and Review requests, each most urgent first as tb-pr’s table sorts: rotting bucket, then oldest, then repo and number', () => {
    const board = parseTbPrList(LIST);
    expect(ids(board.columns.draft_mine)).toEqual(['willow#2102', 'kettle#2103', 'anvil#2101']);
    // Mine as one group: critical 39d, rotting 14d, two stale PRs of the same age (repo breaks the tie), fresh.
    const mine = [...board.columns.draft_mine, ...board.columns.review_mine, ...board.columns.ready_to_merge_mine].sort(byUrgency);
    expect(ids(mine)).toEqual(['willow#2102', 'kettle#2103', 'anvil#2104', 'willow#2105', 'anvil#2101']);
    expect(ids(board.columns.waiting_on_me)).toEqual(['anvil#2107', 'willow#2106']);
    // Waiting on author isn't shown (Later).
    expect(Object.keys(board.columns)).toEqual(['draft_mine', 'review_mine', 'ready_to_merge_mine', 'waiting_on_me']);
  });

  it('WORK-3.1: a PR outside productiveio/* is left out, whatever tb-pr’s org', () => {
    const text = withBoard((b) => {
      b.columns.draft_mine[0].url = 'https://github.com/someone/anvil/pull/2101';
      b.columns.waiting_on_me[0].url = 'https://github.com/ProductiveIO/willow/pull/2106';
    });
    const board = parseTbPrList(text);
    expect(ids(board.columns.draft_mine)).toEqual(['willow#2102', 'kettle#2103']);
    // Owners are case-insensitive on GitHub.
    expect(ids(board.columns.waiting_on_me)).toEqual(['anvil#2107', 'willow#2106']);
  });

  it('WORK-3.1: ties keep no GitHub order: same bucket and age sort by repo, then number', () => {
    const text = withBoard((b) => {
      const base = b.columns.draft_mine[0];
      b.columns.draft_mine = [
        { ...base, repo: 'willow', number: 3, url: 'https://github.com/productiveio/willow/pull/3' },
        { ...base, repo: 'anvil', number: 20, url: 'https://github.com/productiveio/anvil/pull/20' },
        { ...base, repo: 'anvil', number: 4, url: 'https://github.com/productiveio/anvil/pull/4' },
      ];
    });
    expect(ids(parseTbPrList(text).columns.draft_mine)).toEqual(['anvil#4', 'anvil#20', 'willow#3']);
  });

  it('WORK-3.2: each PR has its repo, number, title, age, CI state, and in Mine its state chip from its column', () => {
    const board = parseTbPrList(LIST);
    const pr = board.columns.draft_mine.find((p) => p.number === 2101)!;
    expect(pr).toEqual({
      repo: 'anvil',
      number: 2101,
      title: 'Sharpen the anvil corners',
      url: 'https://github.com/productiveio/anvil/pull/2101',
      createdAt: Date.parse('2026-10-17T10:00:00Z'),
      ageDays: expect.closeTo(2.0000056, 6),
      rotting: 'fresh',
      ci: 'passing',
      chip: 'draft',
      column: 'draft_mine',
      taskIds: null,
    });
    const all = Object.values(board.columns).flat();
    const by = (n: number) => all.find((p) => p.number === n)!;
    expect([by(2102), by(2104), by(2105), by(2103)].map((p) => [p.chip, p.ci])).toEqual([
      ['draft', 'running'],
      ['ready', 'failing'],
      ['approved', 'none'],
      ['draft', 'none'],
    ]);
    expect(by(2107).chip).toBeNull();
    expect(board.fetchedAt).toBe(FETCHED);
  });

  it('WORK-3.2: titles are one line and bounded; an unreadable title shows the number', () => {
    const text = withBoard((b) => {
      b.columns.draft_mine[0].title = 'Two\nlines\u0007 \u001b[31mred\u001b[0m';
      b.columns.draft_mine[1].title = 'x'.repeat(400);
      b.columns.draft_mine[2].title = 42;
    });
    const titles = parseTbPrList(text).columns.draft_mine.map((p) => p.title);
    expect(titles).toContain('Two lines red');
    expect(titles.find((t) => t.startsWith('x'))).toHaveLength(300);
    expect(titles).toContain('#2103');
  });

  it('WORK-3.3: "no CI" is its own state, never passing: missing or unknown check states, and Review requests until tb-pr gives one', () => {
    const board = parseTbPrList(LIST);
    expect(board.columns.waiting_on_me.map((p) => p.ci)).toEqual(['none', 'none']);
    const text = withBoard((b) => {
      b.columns.waiting_on_me[0].check_state = 'success'; // after Gap 1
      b.columns.waiting_on_me[1].check_state = 'neutral';
      b.columns.draft_mine[0].check_state = null;
    });
    const after = parseTbPrList(text);
    expect(after.columns.waiting_on_me.map((p) => [p.number, p.ci])).toEqual([
      [2107, 'none'],
      [2106, 'passing'],
    ]);
    expect(after.columns.draft_mine.find((p) => p.number === 2101)!.ci).toBe('none');
  });

  const BAD_URLS = [
    'http://github.com/productiveio/anvil/pull/1',
    'https://github.com.example.com/productiveio/anvil/pull/1',
    'https://example.com/productiveio/anvil/pull/1',
    'javascript:alert(1)//https://github.com/productiveio/',
    'https://github.com/productiveio/anvil/pull/1" onclick="x',
    'https://github.com/productiveio/anvil/pull/1 x',
    ' https://github.com/productiveio/anvil/pull/1',
    42,
    null,
  ];

  it('WORK-6.3: a PR’s url is accepted only when it starts with https://github.com/', () => {
    for (const bad of BAD_URLS) expect(acceptPrUrl(bad), String(bad)).toBeNull();
    expect(acceptPrUrl('https://github.com/productiveio/anvil/pull/1')).toBe('https://github.com/productiveio/anvil/pull/1');
  });

  it('WORK-3.1: a PR Lookout can’t read, for any reason but another owner, makes the whole board a shape error, never a shorter list', () => {
    const broken: [string, (pr: Loose) => void][] = [
      ['no url (a renamed field)', (pr) => delete pr.url],
      ['no number', (pr) => delete pr.number],
      ['a number that isn’t one', (pr) => (pr.number = '2101')],
      ['no repo', (pr) => delete pr.repo],
      ['a repo with a slash', (pr) => (pr.repo = 'productiveio/anvil')],
      ...BAD_URLS.map((url): [string, (pr: Loose) => void] => [`url ${String(url)}`, (pr) => (pr.url = url)]),
    ];
    for (const [what, mutate] of broken) {
      for (const column of ['draft_mine', 'waiting_on_me']) {
        const text = withBoard((b) => mutate(b.columns[column][0]));
        expect(() => parseTbPrList(text), `${what} in ${column}`).toThrow(TbPrShapeError);
      }
    }
    expect(() => parseTbPrList(withBoard((b) => (b.columns.review_mine[0] = 'a PR')))).toThrow(TbPrShapeError);
    // A PR in waiting_on_author isn't shown, so it can't break the board.
    expect(() => parseTbPrList(withBoard((b) => delete b.columns.waiting_on_author[0].url))).not.toThrow();
  });

  it('WORK-4.1: `task_ids` are kept per PR when tb-pr gives them, and their absence says tb-pr is older than Gap 1', () => {
    expect(parseTbPrList(LIST).taskIds).toBe(false);
    const text = withBoard((b) => {
      for (const c of ['draft_mine', 'review_mine', 'ready_to_merge_mine', 'waiting_on_me', 'waiting_on_author']) for (const p of b.columns[c]) p.task_ids = [];
      b.columns.draft_mine[0].task_ids = [
        { id: '12345678', source: 'branch' },
        { id: '12345', source: 'body' },
        { id: 'abc', source: 'body' },
        { id: '1', source: 'todo' },
      ];
    });
    const board = parseTbPrList(text);
    expect(board.taskIds).toBe(true);
    expect(board.columns.draft_mine.find((p) => p.number === 2101)!.taskIds).toEqual([
      { id: '12345678', source: 'branch' },
      { id: '12345', source: 'body' },
    ]);
    expect(parseTbPrList(fixture('list-401-columns.json')).taskIds).toBeNull();
  });

  it('anything but a board is a shape error', () => {
    for (const text of ['', 'refreshed 3 PR(s)', '[]', '{"columns":{}}', '{"columns":{"draft_mine":[],"review_mine":[],"ready_to_merge_mine":[],"waiting_on_me":{}}}', withBoard((b) => (b.column_issues = 'x'))]) {
      expect(() => parseTbPrList(text), text).toThrow(TbPrShapeError);
    }
  });
});

describe('failures (WORK-7)', () => {
  const now = Date.parse('2026-10-19T10:00:00Z');
  const PLAIN: readonly string[] = Object.values(PR_REASON);

  it('WORK-7.6: "not signed in" from tb-pr’s recorded outputs: `gh auth token` in its error, or GitHub API error (401)', () => {
    for (const name of ['stderr-gh-missing.txt', 'stderr-gh-signed-out.txt', 'stderr-gh-empty-token.txt', 'stderr-401.txt', 'stderr-colored-401.txt']) {
      expect(classifyTbPrFailure(failedRun(fixture(name)), now), name).toMatchObject({ state: 'signed-out', reason: PR_REASON.signedOut, fix: 'gh auth login' });
    }
    for (const name of ['stderr-rate-limited.txt', 'stderr-rate-limited-reset.txt', 'stderr-502.txt']) {
      expect(classifyTbPrFailure(failedRun(fixture(name)), now).state, name).toBe('error');
    }
  });

  it('WORK-7.6: "api error 401" in every PR column’s column_issues is "not signed in"; in only some it isn’t', () => {
    expect(every401(parseTbPrList(fixture('list-401-columns.json')))).toBe(true);
    const some = withBoard((b) => {
      b.column_issues = b.column_issues.filter((i: { column: string }) => i.column !== 'waiting_on_author');
    }, fixture('list-401-columns.json'));
    expect(every401(parseTbPrList(some))).toBe(false);
    expect(every401(parseTbPrList(fixture('list-rate-limited-column.json')))).toBe(false);
  });

  it('WORK-7.1: a tb-pr that isn’t installed says so and how to install it', () => {
    const enoent = Object.assign(new Error('spawn tb-pr ENOENT'), { code: 'ENOENT' });
    expect(classifyTbPrFailure(enoent, now)).toEqual({ state: 'not-installed', reason: PR_REASON.notInstalled, fix: TB_PR_INSTALL_COMMAND, blockedUntil: null, detail: null });
  });

  it('WORK-7.3: any other failure is a failed read whose reason says, in plain words, what failed and to try Refresh later; tb-pr’s own text goes only to `detail`, for the log', () => {
    const cases: [unknown, string, string | null][] = [
      [failedRun(fixture('stderr-502.txt')), PR_REASON.serverError, 'GitHub API error (502): <html>'],
      [failedRun('Error: GitHub API error (403): Resource not accessible by integration\n'), PR_REASON.refused, 'GitHub API error (403): Resource not accessible by integration'],
      [failedRun('Error: error sending request for url (https://api.github.com/graphql)\n'), PR_REASON.failed, 'error sending request for url (https://api.github.com/graphql)'],
      [failedRun('', 3), PR_REASON.failed, 'exit 3'],
      [Object.assign(new Error('x'), { timedOut: true, code: null }), PR_REASON.timedOut, null],
      [new TbPrShapeError('a PR in draft_mine (#2101) has no GitHub URL'), PR_REASON.unreadable, 'a PR in draft_mine (#2101) has no GitHub URL'],
    ];
    for (const [err, reason, detail] of cases) {
      expect(classifyTbPrFailure(err, now), reason).toMatchObject({ state: 'error', reason, fix: null, detail });
    }
    // Every reason is Lookout's own sentence: no HTML, no "Error:", no status line from tb-pr.
    for (const [err] of cases) expect(PLAIN).toContain(classifyTbPrFailure(err, now).reason);
    expect(PLAIN.filter((r) => /<|GitHub API error|exit \d/.test(r))).toEqual([]);
  });

  it('WORK-7.7: token-like text in tb-pr’s error reaches neither the reason nor the logged detail, which is one line', () => {
    const { reason, detail } = classifyTbPrFailure(failedRun(leaky), now);
    expect(reason).toBe(PR_REASON.serverError);
    expect(detail).not.toContain('\n');
    expect(FAKE_TOKENS.filter((t) => `${reason} ${detail}`.includes(t))).toEqual([]);
    expect(detail).toMatch(/^GitHub API error \(502\)/);
  });

  it('WORK-7.7: secrets in query parameters and longer names are redacted too: access_token=, client_secret=, X-Amz-Signature=', () => {
    const { reason, detail } = classifyTbPrFailure(failedRun('Error: GET https://api.github.com/x?access_token=acc3ss-v4lue&client_secret=cl1ent-v4lue&page=2 failed\n'), now);
    expect(reason).toBe(PR_REASON.failed);
    expect(detail).toBe('GET https://api.github.com/x?access_token=…&client_secret=…&page=2 failed');
    expect(sanitizeLine('refresh_token: r3fresh-v4lue, apiKey=k3y-v4lue')).toBe('refresh_token: …, apiKey=…');
    expect(sanitizeLine('https://s3.example.com/f?X-Amz-Credential=cr3d-v4lue&X-Amz-Signature=s1g-v4lue')).toBe('https://s3.example.com/f?X-Amz-Credential=…&X-Amz-Signature=…');
    expect(sanitizeLine('{"refreshToken":"b0dy-v4lue","user_password": "pw-v4lue"}')).toBe('{"refreshToken":"…","user_password": "…"}');
    // What isn't a secret stays readable.
    expect(sanitizeLine('token_type=jwt page=2 exit_code=3')).toBe('token_type=jwt page=2 exit_code=3');
  });

  it('WORK-7.7: redacting long dash-joined text stays fast, so a tool’s big error can’t block the server', () => {
    const started = performance.now();
    expect(sanitizeLine(`${'a-'.repeat(80_000)}x`)).not.toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('rate limits (WORK-8.4)', () => {
  const at = (iso: string) => Date.parse(iso);

  it('waits until tb-pr’s reset time, the nearest moment with that UTC time of day, at least 5 minutes and at most an hour', () => {
    const text = (hms: string) => `Error: GitHub API error (403): rate limited — resets at ${hms} UTC. Run \`tb-pr refresh\` later or widen TTL.`;
    expect(rateLimitedUntil(text('10:42:17'), at('2026-10-19T10:00:00Z'))).toBe(at('2026-10-19T10:42:17Z'));
    expect(rateLimitedUntil(text('10:01:00'), at('2026-10-19T10:00:00Z'))).toBe(at('2026-10-19T10:05:00Z'));
    // Just past midnight, a reset a minute before it was yesterday's: at least 5 minutes.
    expect(rateLimitedUntil(text('23:59:30'), at('2026-10-20T00:01:00Z'))).toBe(at('2026-10-20T00:06:00Z'));
    // Just before midnight, a reset after it is tomorrow's.
    expect(rateLimitedUntil(text('00:30:00'), at('2026-10-19T23:59:00Z'))).toBe(at('2026-10-20T00:30:00Z'));
    expect(rateLimitedUntil(text('13:00:00'), at('2026-10-19T10:00:00Z'))).toBe(at('2026-10-19T11:00:00Z'));
    // A 429 has no reset time: 5 minutes.
    expect(rateLimitedUntil(fixture('stderr-rate-limited.txt'), at('2026-10-19T10:00:00Z'))).toBe(at('2026-10-19T10:05:00Z'));
  });

  it('a failed tb-pr run that says "rate limited" blocks GitHub reads until then, and says Work reads again when it frees up', () => {
    const now = at('2026-10-19T10:00:00Z');
    expect(classifyTbPrFailure(failedRun(fixture('stderr-rate-limited-reset.txt')), now)).toMatchObject({
      state: 'error',
      reason: PR_REASON.rateLimited,
      fix: null,
      blockedUntil: at('2026-10-19T10:42:17Z'),
    });
  });
});

describe('column confirmation times (WORK-7.5)', () => {
  it('WORK-7.5: lists each affected column with its reason in plain words and its time; columns with the same reason and time share one entry', () => {
    const issues = [
      { column: 'draft_mine', reason: 'search returned empty', restoredFrom: null },
      { column: 'review_mine', reason: 'api error 404', restoredFrom: null },
      { column: 'ready_to_merge_mine', reason: 'api error 422', restoredFrom: null },
      { column: 'mentions', reason: 'api error 403', restoredFrom: null },
    ];
    const now = 10_000_000;
    const confirmed = new Map([['draft_mine' as const, now - 40 * 60_000]]);
    expect(marksFor(['draft_mine', 'review_mine', 'ready_to_merge_mine'], issues, confirmed)).toEqual([
      { columns: ['draft_mine'], reason: "GitHub's search came back empty", confirmedAt: now - 40 * 60_000 },
      { columns: ['review_mine', 'ready_to_merge_mine'], reason: 'GitHub refused the request', confirmedAt: null },
    ]);
    expect(marksFor(['waiting_on_me'], issues, confirmed)).toEqual([]);
  });

  it('WORK-7.5: tb-pr’s own issue labels never show: each reads in plain words', () => {
    const labels = ['search returned empty', 'search incomplete', 'rate limited', 'server error 503', 'api error 401', 'api error 403', 'api error 422', 'network error', 'fetch failed', 'something new'];
    expect(Object.fromEntries(labels.map((l) => [l, plainIssue(l)]))).toEqual({
      'search returned empty': "GitHub's search came back empty",
      'search incomplete': "GitHub's search came back incomplete",
      'rate limited': "GitHub's rate limit is used up",
      'server error 503': 'GitHub had a server error',
      'api error 401': 'GitHub refused the sign-in',
      'api error 403': 'GitHub refused access',
      'api error 422': 'GitHub refused the request',
      'network error': "GitHub couldn't be reached",
      'fetch failed': 'the read failed',
      'something new': 'the read failed',
    });
  });
});

describe('the argv allowlist (WORK-5.3)', () => {
  it('WORK-5.3: only `tb-pr list --json`, `tb-pr refresh` and `tb-prod query tasks` run; anything else is refused before a process starts', async () => {
    expect(isAllowedWorkCommand('tb-pr', ['list', '--json'])).toBe(true);
    expect(isAllowedWorkCommand('tb-pr', ['refresh'])).toBe(true);
    expect(isAllowedWorkCommand('tb-prod', ['query', 'tasks', '--filter', '{}'])).toBe(true);
    for (const argv of [['list'], ['list', '--json', '--column', 'x'], ['open', '1'], ['show', '1'], ['config', 'init'], ['refresh', '--x'], ['tui'], [], ['skill', 'install']]) {
      expect(isAllowedWorkCommand('tb-pr', argv), argv.join(' ')).toBe(false);
    }
    for (const argv of [['query'], ['query', 'projects'], ['config', 'init'], ['create', 'tasks'], ['update', 'tasks'], ['delete', 'tasks'], ['action', 'x']]) {
      expect(isAllowedWorkCommand('tb-prod', argv), argv.join(' ')).toBe(false);
    }
    const runner = vi.fn(async () => '');
    await expect(runWorkCommand(runner, 'tb-pr', '/bin/tb-pr', ['open', '1'], { timeoutMs: 1 })).rejects.toBeInstanceOf(WorkCommandRefused);
    await expect(runWorkCommand(runner, 'tb-prod', '/bin/tb-prod', ['create', 'tasks'], { timeoutMs: 1 })).rejects.toBeInstanceOf(WorkCommandRefused);
    expect(runner).not.toHaveBeenCalled();
  });

  it('finds the binaries like tb-session: the override, then PATH, then ~/.local/bin, else the bare name', () => {
    expect(resolveWorkBin('tb-pr', { LOOKOUT_TB_PR_BIN: '/opt/x/tb-pr', PATH: '/bin' })).toBe('/opt/x/tb-pr');
    expect(resolveWorkBin('tb-prod', { LOOKOUT_TB_PROD_BIN: '/opt/x/tb-prod' })).toBe('/opt/x/tb-prod');
    expect(resolveWorkBin('tb-pr', { PATH: '/nonexistent', HOME: '/nonexistent' })).toBe('tb-pr');
  });
});

describe('ReadLane (WORK-8.3)', () => {
  it('joins the read in flight only when it asks the same; others wait, and waiting ones asking the same run as one', async () => {
    const started: string[] = [];
    const gates: (() => void)[] = [];
    const lane = new ReadLane<string, string>(
      (ask) => {
        started.push(ask);
        return new Promise((r) => gates.push(() => r(ask)));
      },
      (a, b) => a === b,
    );
    const a1 = lane.request('plain');
    const a2 = lane.request('plain');
    const f1 = lane.request('forced');
    const f2 = lane.request('forced');
    await Promise.resolve();
    expect(started).toEqual(['plain']);
    expect(a1).toBe(a2);
    gates.shift()!();
    expect(await a1).toBe('plain');
    await vi.waitFor(() => expect(started).toEqual(['plain', 'forced']));
    expect(f1).toBe(f2);
    // During the forced read, plain ones wait, and run as one.
    const p1 = lane.request('plain');
    const p2 = lane.request('plain');
    expect(p1).toBe(p2);
    gates.shift()!();
    await f1;
    await vi.waitFor(() => expect(started).toEqual(['plain', 'forced', 'plain']));
    gates.shift()!();
    await p1;
    expect(lane.busy).toBe(false);
  });

  it('WORK-8.1: drop() answers every waiting request without running it; the read in flight runs on', async () => {
    const started: string[] = [];
    const gates: (() => void)[] = [];
    const lane = new ReadLane<string, string>(
      (ask) => {
        started.push(ask);
        return new Promise((r) => gates.push(() => r(ask)));
      },
      (a, b) => a === b,
    );
    const running = lane.request('plain');
    const waiting = lane.request('forced');
    await Promise.resolve();
    lane.drop('dropped');
    expect(await waiting).toBe('dropped');
    gates.shift()!();
    expect(await running).toBe('plain');
    await Promise.resolve();
    expect(started).toEqual(['plain']);
    expect(lane.busy).toBe(false);
  });
});

/** A scripted tb-pr: each call waits until the test answers it. */
function scriptedTbPr() {
  const calls: { argv: string[]; answer: (out: string | RunError) => void; signal?: AbortSignal }[] = [];
  const runner = (_file: string, args: readonly string[], opts: RunOptions) =>
    new Promise<string>((resolve, reject) => {
      calls.push({ argv: [...args], signal: opts.signal, answer: (out) => (typeof out === 'string' ? resolve(out) : reject(out)) });
    });
  return { runner, calls, argvs: () => calls.map((c) => c.argv.join(' ')) };
}

describe('WorkMonitor reads (WORK-8, PRs)', () => {
  let events: WorkSnapshot[];
  let logged: string[];
  let monitor: WorkMonitor;
  let tb: ReturnType<typeof scriptedTbPr>;
  const T0 = Date.parse('2026-10-19T10:00:00.482913Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    events = [];
    logged = [];
    tb = scriptedTbPr();
    monitor = new WorkMonitor({ runner: tb.runner, tbPrBin: () => '/bin/tb-pr', onChange: (w) => events.push(w), log: (l) => logged.push(l) });
  });
  afterEach(async () => {
    for (const c of tb.calls) c.answer(failedRun('test over'));
    await monitor.close();
    vi.useRealTimers();
  });

  /** Lets the monitor reach its next await. */
  const settle = () => vi.advanceTimersByTimeAsync(0);
  const answerLast = async (out: string | RunError) => {
    tb.calls.at(-1)!.answer(out);
    await settle();
  };
  /** A tab opens Work, and its opening read gets the board. */
  const opened = async () => {
    const close = monitor.watch();
    await settle();
    await answerLast(LIST);
    return close;
  };

  it('WORK-8.1: reads only while a tab has Work open, every 5 minutes from the end of the last read', async () => {
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS * 2);
    expect(tb.calls).toHaveLength(0);
    const close = monitor.watch();
    await settle();
    expect(tb.argvs()).toEqual(['list --json']);
    // A slow read: the next one is due 5 minutes after it ended, not after it started.
    await vi.advanceTimersByTimeAsync(15_000);
    await answerLast(LIST);
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS - 1);
    expect(tb.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tb.calls).toHaveLength(2);
    await answerLast(LIST);
    close();
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS * 3);
    expect(tb.calls).toHaveLength(2);
  });

  it('WORK-8.1: opening Work reads when the data is more than 5 minutes old, and otherwise waits for the schedule', async () => {
    const first = await opened();
    first();
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    const second = monitor.watch();
    await settle();
    expect(tb.calls).toHaveLength(1); // 4 minutes old: no read on opening…
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tb.calls).toHaveLength(2); // …the schedule's, 5 minutes after the last ended
    await answerLast(LIST);
    second();
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    expect(tb.calls).toHaveLength(2);
    monitor.watch();
    await settle();
    expect(tb.calls).toHaveLength(3); // more than 5 minutes old
  });

  it('WORK-8.1: with Work closed in every tab, Refresh is refused and starts no cooldown', async () => {
    expect(await monitor.refresh()).toEqual({ status: 409, result: { ok: false, error: "Work isn't open in any tab" } });
    expect(monitor.snapshot().refresh.cooldownUntil).toBeNull();
    const close = await opened();
    close();
    expect((await monitor.refresh()).status).toBe(409);
    expect(tb.argvs()).toEqual(['list --json']);
    expect(monitor.snapshot().refresh.cooldownUntil).toBeNull();
  });

  it('WORK-8.1: reads waiting when the last tab closes Work are dropped, a waiting Refresh says so; the read in flight runs to its end', async () => {
    const close = monitor.watch();
    await settle();
    expect(tb.argvs()).toEqual(['list --json']);
    // A Refresh waits behind the opening read; then the last tab closes Work.
    const forced = monitor.refresh();
    await settle();
    close();
    expect(await forced).toEqual({ status: 200, result: { ok: false, error: PR_REASON.closed } });
    expect(monitor.snapshot().refresh.cooldownUntil).toBe(T0 + WORK_COOLDOWN_MS);
    await answerLast(LIST);
    expect(monitor.snapshot().prs.state).toBe('ok');
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS * 2);
    expect(tb.argvs()).toEqual(['list --json']);
  });

  it('WORK-8.3: two tabs opening at once share one read; a plain read joins a plain one', async () => {
    monitor.watch();
    monitor.watch();
    await settle();
    expect(tb.argvs()).toEqual(['list --json']);
  });

  it('WORK-8.2: a forced read is `tb-pr refresh`, then `list --json` only if the refresh succeeded', async () => {
    await opened();
    const ok = monitor.refresh();
    await settle();
    expect(tb.argvs()).toEqual(['list --json', 'refresh']);
    await answerLast(fixture('stdout-refresh.txt'));
    expect(tb.argvs()).toEqual(['list --json', 'refresh', 'list --json']);
    await answerLast(LIST);
    expect(await ok).toEqual({ status: 200, result: { ok: true } });
    expect(monitor.snapshot().prs.state).toBe('ok');

    await vi.advanceTimersByTimeAsync(WORK_COOLDOWN_MS);
    const failed = monitor.refresh();
    await settle();
    await answerLast(failedRun('Error: GitHub API error (500): oops'));
    expect(tb.argvs()).toEqual(['list --json', 'refresh', 'list --json', 'refresh']);
    expect(await failed).toEqual({ status: 200, result: { ok: false, error: PR_REASON.serverError } });
  });

  it('WORK-8.2, WORK-8.3: the 60 s cooldown starts when the server accepts a forced read, whatever its result; one asked for during it is refused, not queued', async () => {
    await opened();
    const first = monitor.refresh();
    expect(monitor.snapshot().refresh.cooldownUntil).toBe(T0 + WORK_COOLDOWN_MS);
    expect(events.at(-1)!.refresh.cooldownUntil).toBe(T0 + WORK_COOLDOWN_MS);
    await settle();
    await answerLast(failedRun('Error: refresh failed'));
    await first;
    await vi.advanceTimersByTimeAsync(WORK_COOLDOWN_MS - 1);
    expect(await monitor.refresh()).toEqual({ status: 429, result: { ok: false, error: 'Refresh was used less than a minute ago', until: T0 + WORK_COOLDOWN_MS } });
    await vi.advanceTimersByTimeAsync(1);
    expect(tb.argvs()).toEqual(['list --json', 'refresh']); // the refused one wasn't queued
    void monitor.refresh();
    await settle();
    expect(tb.argvs()).toEqual(['list --json', 'refresh', 'refresh']);
  });

  it('WORK-8.3: a forced read never joins a plain one: it waits for it, and a plain one waits for a forced one', async () => {
    monitor.watch();
    await settle();
    const forced = monitor.refresh();
    await settle();
    expect(tb.argvs()).toEqual(['list --json']);
    await answerLast(LIST);
    expect(tb.argvs()).toEqual(['list --json', 'refresh']);
    await answerLast(fixture('stdout-refresh.txt'));
    await answerLast(LIST);
    expect(await forced).toEqual({ status: 200, result: { ok: true } });
    expect(tb.argvs()).toEqual(['list --json', 'refresh', 'list --json']);
  });

  it('WORK-8.3: a plain read asked for during a forced one runs after it, as one read however many asked', async () => {
    await opened();
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS - 1_000);
    const forced = monitor.refresh();
    await settle();
    expect(tb.argvs()).toEqual(['list --json', 'refresh']);
    // While it runs, two more tabs open Work on data over 5 minutes old.
    await vi.advanceTimersByTimeAsync(1_001);
    monitor.watch();
    monitor.watch();
    await settle();
    expect(tb.argvs()).toEqual(['list --json', 'refresh']);
    await answerLast(fixture('stdout-refresh.txt'));
    await answerLast(LIST);
    await forced;
    await settle();
    expect(tb.argvs()).toEqual(['list --json', 'refresh', 'list --json', 'list --json']);
  });

  it('WORK-8.1, WORK-8.2: no scheduled read right behind a Refresh: the schedule is off while a forced read waits and runs, and counts 5 minutes from its end', async () => {
    await opened();
    // The schedule would come due 1 s into a Refresh, whose `tb-pr refresh` then fails.
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS - 1_000);
    const forced = monitor.refresh();
    await settle();
    expect(tb.argvs()).toEqual(['list --json', 'refresh']);
    await vi.advanceTimersByTimeAsync(10_000);
    await answerLast(failedRun('Error: refresh failed'));
    expect((await forced).result.ok).toBe(false);
    await settle();
    // No plain read behind it, which would fetch cold: the failed refresh cleared tb-pr's cache.
    expect(tb.argvs()).toEqual(['list --json', 'refresh']);
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS - 1);
    expect(tb.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(tb.argvs()).toEqual(['list --json', 'refresh', 'list --json']);
    await answerLast(LIST);

    // A Refresh that waits behind a read in flight: that read's end doesn't arm the schedule under it,
    // however long the refresh then takes.
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    expect(tb.argvs().slice(3)).toEqual(['list --json']); // the schedule's, in flight
    const waiting = monitor.refresh();
    await settle();
    await answerLast(LIST);
    expect(tb.argvs().slice(3)).toEqual(['list --json', 'refresh']);
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS + 1_000);
    await answerLast(fixture('stdout-refresh.txt'));
    await answerLast(LIST);
    expect(await waiting).toEqual({ status: 200, result: { ok: true } });
    await settle();
    expect(tb.argvs().slice(3)).toEqual(['list --json', 'refresh', 'list --json']);
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS - 1);
    expect(tb.calls).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(1);
    expect(tb.argvs().slice(6)).toEqual(['list --json']);
  });

  it('WORK-8.4: a rate limit on stderr stops GitHub reads, scheduled and forced, until tb-pr’s reset time', async () => {
    monitor.watch();
    await settle();
    await answerLast(failedRun(fixture('stderr-rate-limited-reset.txt'))); // resets at 10:42:17 UTC
    const until = Date.parse('2026-10-19T10:42:17Z');
    expect(monitor.snapshot().refresh.githubBlockedUntil).toBe(until);
    expect(monitor.snapshot().prs.reason).toBe(PR_REASON.rateLimited);
    expect(await monitor.refresh()).toEqual({ status: 429, result: { ok: false, error: 'GitHub is rate limited', until } });
    await vi.advanceTimersByTimeAsync(until - Date.now() - 1);
    expect(tb.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tb.argvs()).toEqual(['list --json', 'list --json']);
  });

  it('WORK-8.4: "rate limited" as a column_issues reason stops GitHub reads for 5 minutes', async () => {
    monitor.watch();
    await settle();
    await answerLast(fixture('list-rate-limited-column.json'));
    expect(monitor.snapshot().refresh.githubBlockedUntil).toBe(T0 + RATE_LIMIT_MIN_MS);
    expect((await monitor.refresh()).status).toBe(429);
    expect(monitor.snapshot().prs.state).toBe('ok');
  });

  it('WORK-7.3: a failed read keeps the last lists, marked old, with the reason in plain words; the next good read clears it', async () => {
    await opened();
    const good = monitor.snapshot().prs;
    expect(good).toMatchObject({ state: 'ok', stale: false, reason: null, fetchedAt: FETCHED });
    expect(ids(good.mine)).toEqual(['willow#2102', 'kettle#2103', 'anvil#2104', 'willow#2105', 'anvil#2101']);
    expect(ids(good.reviewRequests)).toEqual(['anvil#2107', 'willow#2106']);

    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    await answerLast(failedRun(fixture('stderr-502.txt'), 1));
    expect(monitor.snapshot().prs).toEqual({ ...good, state: 'error', reason: PR_REASON.serverError, stale: true });
    // What tb-pr said goes to the server's log only.
    expect(logged).toEqual(['GitHub API error (502): <html>']);

    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    await answerLast(LIST);
    expect(monitor.snapshot().prs).toEqual(good);
  });

  it('WORK-7.3: a board with a PR Lookout can’t read is a failed read that keeps the last lists, never "No open PRs"', async () => {
    await opened();
    const good = monitor.snapshot().prs;
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    // tb-pr renames `url`: every PR would be dropped.
    await answerLast(withBoard((b) => Object.values(b.columns).flat().forEach((pr) => delete (pr as Loose).url)));
    expect(monitor.snapshot().prs).toEqual({ ...good, state: 'error', reason: PR_REASON.unreadable, stale: true });
    expect(logged).toEqual(['a PR in draft_mine (#2101) has no GitHub URL']);
    // With no earlier list: the reason, and no lists at all.
    const fresh = new WorkMonitor({ runner: tb.runner, tbPrBin: () => '/bin/tb-pr', onChange: () => {}, log: () => {} });
    fresh.watch();
    await settle();
    await answerLast(withBoard((b) => delete b.columns.waiting_on_me[0].number));
    expect(fresh.snapshot().prs).toMatchObject({ state: 'error', reason: PR_REASON.unreadable, stale: false, mine: [], reviewRequests: [] });
    await fresh.close();
  });

  it('WORK-7.2: not signed in keeps the lists, marked old, and names `gh auth login`; so does "api error 401" in every column', async () => {
    await opened();
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    await answerLast(fixture('list-401-columns.json'));
    expect(monitor.snapshot().prs).toMatchObject({ state: 'signed-out', reason: PR_REASON.signedOut, fix: 'gh auth login', stale: true });
    expect(monitor.snapshot().prs.mine).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    await answerLast(failedRun(fixture('stderr-gh-signed-out.txt')));
    expect(monitor.snapshot().prs).toMatchObject({ state: 'signed-out', reason: PR_REASON.signedOut, fix: 'gh auth login', stale: true });
  });

  it('WORK-7.1: tb-pr not installed: the section says so and how to install it, with no list', async () => {
    monitor.watch();
    await settle();
    await answerLast(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
    expect(monitor.snapshot().prs).toMatchObject({ state: 'not-installed', fix: TB_PR_INSTALL_COMMAND, stale: false, mine: [], reviewRequests: [] });
  });

  it('WORK-7.5: per column, when it was last read without an issue: a restart starts at "not confirmed yet"; same reason and time share an entry', async () => {
    monitor.watch();
    await settle();
    await answerLast(fixture('list-rate-limited-column.json'));
    let marks = monitor.snapshot().prs.marks;
    expect(marks.mine).toEqual([{ columns: ['review_mine', 'ready_to_merge_mine'], reason: "GitHub's rate limit is used up", confirmedAt: null }]);
    expect(marks.reviewRequests).toEqual([]);

    // A clean board fetched later confirms every column as of its fetch…
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    const clean = withBoard((b) => (b.fetched_at = '2026-10-19T10:04:30Z'));
    await answerLast(clean);
    expect(monitor.snapshot().prs.marks).toEqual({ mine: [], reviewRequests: [] });

    // …so the next outage's mark names that time, per group.
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    await answerLast(fixture('list-search-empty.json'));
    marks = monitor.snapshot().prs.marks;
    const confirmedAt = Date.parse('2026-10-19T10:04:30Z');
    expect(marks.mine).toEqual([{ columns: ['draft_mine', 'review_mine', 'ready_to_merge_mine'], reason: "GitHub's search came back empty", confirmedAt }]);
    expect(marks.reviewRequests).toEqual([{ columns: ['waiting_on_me'], reason: "GitHub's search came back empty", confirmedAt }]);
    // tb-pr succeeded and its fetched_at is fresh, yet the groups are marked.
    expect(monitor.snapshot().prs).toMatchObject({ state: 'ok', stale: false, fetchedAt: FETCHED });
  });

  it('the `work` event goes out only when something changed', async () => {
    await opened();
    const n = events.length;
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    await answerLast(LIST);
    expect(events).toHaveLength(n);
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    await answerLast(failedRun('Error: boom'));
    expect(events).toHaveLength(n + 1);
  });

  it('WORK-7.7: a failing tb-pr with token-like output leaves none of it in the snapshot, the event, the refresh answer or the log', async () => {
    const consoles = [vi.spyOn(console, 'error'), vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'info')];
    const leak = () => Object.assign(failedRun(leaky), { stdout: `token=tok3n-s3cret-v4lue ghp_FAKEfake0123456789` });
    monitor.watch();
    await settle();
    await answerLast(leak());
    const answer = monitor.refresh();
    await settle();
    await answerLast(leak());
    const result = await answer;
    const seen = JSON.stringify([result, monitor.snapshot(), events, logged]);
    expect(FAKE_TOKENS.filter((t) => seen.includes(t))).toEqual([]);
    expect(monitor.snapshot().prs.reason).toBe(PR_REASON.serverError);
    expect(logged).toHaveLength(2);
    for (const line of logged) expect(line).not.toContain('\n');
    for (const spy of consoles) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  it('close() cancels the read in flight and stops polling', async () => {
    monitor.watch();
    await settle();
    expect(tb.calls[0]!.signal?.aborted).toBe(false);
    const closing = monitor.close();
    expect(tb.calls[0]!.signal?.aborted).toBe(true);
    tb.calls[0]!.answer(Object.assign(new Error('cancelled'), { aborted: true }));
    await closing;
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS * 2);
    expect(tb.calls).toHaveLength(1);
  });
});
