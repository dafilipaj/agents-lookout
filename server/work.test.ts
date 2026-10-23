import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TB_PROD_INSTALL_COMMAND, TB_PR_INSTALL_COMMAND } from '../shared/defaults.ts';
import { parseProductiveEmail } from '../shared/settings.ts';
import type { WorkSnapshot } from '../shared/work.ts';
import type { RunError, RunOptions } from './exec.ts';
import { sanitizeLine } from './sanitize.ts';
import {
  MAX_TASK_PAGES,
  PR_REASON,
  RATE_LIMIT_MIN_MS,
  ReadLane,
  TASK_REASON,
  TB_PROD_TIMEOUT_MS,
  TbProdShapeError,
  TbPrShapeError,
  MAX_DESCRIPTION,
  WORK_COOLDOWN_MS,
  WORK_INTERVAL_MS,
  WorkCommandRefused,
  WorkMonitor,
  acceptPrUrl,
  byUrgency,
  classifyTbProdFailure,
  classifyTbPrFailure,
  descriptionText,
  every401,
  isAllowedWorkCommand,
  marksFor,
  mergePages,
  parseTasksPage,
  parseTbPrList,
  plainIssue,
  rateLimitedUntil,
  resolveWorkBin,
  runWorkCommand,
  tasksQueryArgv,
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
      links: null,
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

  it('WORK-3.3: "no CI" is its own state, never passing: missing or unrecognized check states, and Review requests until tb-pr gives one', () => {
    const board = parseTbPrList(LIST);
    expect(board.columns.waiting_on_me.map((p) => p.ci)).toEqual(['none', 'none']);
    const text = withBoard((b) => {
      b.columns.waiting_on_me[0].check_state = 'success'; // tb-pr 0.4.0 (Gap 1)
      b.columns.waiting_on_me[1].check_state = 'neutral';
      b.columns.draft_mine[0].check_state = null;
      b.columns.draft_mine[1].check_state = 'toString'; // not a state, though every object has one
    });
    const after = parseTbPrList(text);
    expect(after.columns.waiting_on_me.map((p) => [p.number, p.ci])).toEqual([
      [2107, 'none'],
      [2106, 'passing'],
    ]);
    const draft = (n: number) => after.columns.draft_mine.find((p) => p.number === n)!.ci;
    expect([draft(2101), draft(2102)]).toEqual(['none', 'none']);
  });

  it('WORK-3.3: tb-pr 0.4.0’s `unknown`, a check-runs read that failed, is "CI unknown", in Mine and in Review requests, never passing or "no CI"', () => {
    const text = withBoard((b) => {
      b.columns.waiting_on_me[0].check_state = 'unknown';
      b.columns.review_mine[0].check_state = 'unknown'; // #2104
      b.columns.waiting_on_me[1].check_state = 'Unknown'; // tb-pr writes it in lower case only
    });
    const board = parseTbPrList(text);
    expect(board.columns.waiting_on_me.map((p) => [p.number, p.ci])).toEqual([
      [2107, 'none'],
      [2106, 'unknown'],
    ]);
    expect(board.columns.review_mine.find((p) => p.number === 2104)!.ci).toBe('unknown');
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
  it('WORK-4.3: tb-session searches use bounded Task URL tokens, never a bare Task id', () => {
    const prefix = ['search', '--all-projects', '--limit', '200', '--json', '--'];
    expect(isAllowedWorkCommand('tb-session', [...prefix, 'tasks/41000001'])).toBe(true);
    expect(isAllowedWorkCommand('tb-session', [...prefix, 'task=41000001'])).toBe(true);
    expect(isAllowedWorkCommand('tb-session', [...prefix, '41000001'])).toBe(false);
  });

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
  const runner = (_file: string, args: readonly string[], opts: RunOptions) => {
    if (_file.endsWith('tb-session')) return Promise.resolve(JSON.stringify({ results: [] }));
    return new Promise<string>((resolve, reject) => {
      calls.push({ argv: [...args], signal: opts.signal, answer: (out) => (typeof out === 'string' ? resolve(out) : reject(out)) });
    });
  };
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
    monitor = new WorkMonitor({ runner: tb.runner, tbPrBin: () => '/bin/tb-pr', tbProdBin: () => '/bin/tb-prod', tbSessionBin: () => '/bin/tb-session', onChange: (w) => events.push(w), log: (l) => logged.push(l) });
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
    const fresh = new WorkMonitor({ runner: tb.runner, tbPrBin: () => '/bin/tb-pr', tbProdBin: () => '/bin/tb-prod', tbSessionBin: () => '/bin/tb-session', onChange: () => {}, log: () => {} });
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

// --- Tasks (slice C) -----------------------------------------------------------------------------

/**
 * Fixtures in `fixtures/tb-prod/` are tb-prod's output, written from its source: a page as 1.2.0's
 * `query` prints Productive's JSON:API (`commands/resource/query.rs`), JSON errors as `json_error.rs`
 * prints them, the config error as `run_main!` does, and 1.1.1's answer to WORK's filter
 * (`invalid-filter-1.1.1.json`, its schema's keys in HashMap order). Invented projects, Tasks and people.
 */
const prodFixture = (name: string) => readFileSync(new URL(`./fixtures/tb-prod/${name}`, import.meta.url), 'utf8');
const TASKS = prodFixture('tasks.json');
const ME = 'lamplighter@example.com';
const OTHER = 'keeper@example.com';
/** A failed tb-prod run: its JSON error on stdout, or its words on stderr. */
const prodFailed = (out: { stdout?: string; stderr?: string }, code = 1): RunError =>
  Object.assign(new Error(`tb-prod exited with ${code}`), { code, stdout: out.stdout ?? '', stderr: out.stderr ?? '', timedOut: false });
const titles = (tasks: { title: string }[]) => tasks.map((t) => t.title);

/** `n` open Tasks as a JSON:API page holds them, most recently active first. */
function taskRows(n: number, from = 0) {
  return Array.from({ length: n }, (_, i) => ({
    id: String(50_000 + from + i),
    type: 'tasks',
    attributes: { title: `Task ${from + i}`, due_date: null, type_id: 1, last_activity_at: new Date(Date.UTC(2026, 9, 19) - (from + i) * 60_000).toISOString() },
    relationships: {},
  }));
}
/** Page `page` of `rows`, as tb-prod prints it: 20 per page, with `meta.hasNextPage`. */
function pageOf(rows: unknown[], page: number): string {
  const totalPages = Math.max(1, Math.ceil(rows.length / 20));
  return JSON.stringify({ data: rows.slice((page - 1) * 20, page * 20), included: [], meta: { totalCount: rows.length, totalPages, currentPage: page, hasNextPage: page < totalPages } });
}

describe('reading `tb-prod query tasks` (WORK-2)', () => {
  it('WORK-2.1: the query is WORK’s filter for the email (open Tasks in active projects, task lists and folders), most recently active first, one page per call', () => {
    const argv = tasksQueryArgv(ME, 2);
    expect(argv).toEqual(['query', 'tasks', '--filter', expect.any(String), '--include', 'project,workflow_status', '--sort=-last_activity_at', '--page', '2']);
    expect(JSON.parse(argv[3]!)).toEqual({
      op: 'and',
      conditions: [
        { field: 'assignee.email', operator: 'eq', value: ME },
        { field: 'project.status', operator: 'eq', value: '1' },
        { field: 'task_list_status', operator: 'eq', value: '1' },
        { field: 'folder_status', operator: 'eq', value: '1' },
        { field: 'workflow_status_category_id', operator: 'not_eq', value: '3' },
      ],
    });
    // Any status but closed, milestones included: nothing filters by type.
    expect(argv[3]).not.toContain('type_id');
    // An email is data in the filter's JSON, never an argument of its own.
    expect(JSON.parse(tasksQueryArgv('a"b@example.com --page 9', 1)[3]!).conditions[0].value).toBe('a"b@example.com --page 9');
    expect(isAllowedWorkCommand('tb-prod', argv)).toBe(true);
  });

  it('WORK-2.2: each Task has its title, project, status, due date when set, and whether it is a milestone; WORK-2.1: in tb-prod’s order', () => {
    const { tasks, hasNextPage } = parseTasksPage(TASKS);
    expect(hasNextPage).toBe(false);
    expect(titles(tasks)).toEqual(['Polish the brass lanterns', 'Ring the harbor bells at noon', 'Q4 lantern launch', 'Sweep the lighthouse stairs']);
    expect(tasks[0]).toEqual({
      id: '41000001',
      title: 'Polish the brass lanterns',
      project: 'Lantern Works',
      status: 'In progress',
      statusCategory: 'started',
      dueDate: null,
      lastActivityAt: Date.parse('2026-10-19T12:12:03Z'),
      milestone: false,
      description: 'All twelve, east wing first.',
      url: 'https://app.fantastic.productive.io/109-productive/tasks/41000001',
      links: null,
    });
    expect(tasks.map((t) => [t.project, t.status, t.statusCategory, t.dueDate, t.milestone])).toEqual([
      ['Lantern Works', 'In progress', 'started', null, false],
      ['Harbor Bells', 'Review', 'started', '2026-10-24', false],
      ['Lantern Works', 'Not started', 'not-started', '2026-11-01', true],
      ['Harbor Bells', 'Not started', 'not-started', null, false],
    ]);
  });

  it('WORK-2.11: a Task’s description comes from the same query, as plain text: tags stripped, blocks and <br> as line breaks, entities decoded, blank lines dropped', () => {
    const page = JSON.parse(TASKS) as Loose;
    page.data[0].attributes.description =
      '<h2>Why</h2><p>Totals round <strong>half up</strong> on the preview&nbsp;but&#160;half even on the PDF.<br>Reproduce with deal&nbsp;4 &amp; a 3-line &lt;table&gt;.</p><p></p><ul><li>First</li><li>Second &#x2192; third</li></ul>';
    const [described, none] = parseTasksPage(JSON.stringify(page)).tasks;
    expect(described!.description).toBe('Why\nTotals round half up on the preview but half even on the PDF.\nReproduce with deal 4 & a 3-line <table>.\n- First\n- Second → third');
    expect(none!.description).toBeNull();
  });

  it('WORK-2.11: no tag, script or style survives, controls are stripped, and the text is cut to 600 characters', () => {
    expect(descriptionText('<script>alert(1)</script><style>p{}</style><p onclick="x()">Hi <img src=x onerror=alert(1)>there</p><!-- note --><iframe src="y"></iframe>')).toBe('Hi there');
    expect(descriptionText('<p>Line\u0007 with \u001b[31mred\u001b[0m and\ttab</p>')).toBe('Line with red and tab');
    const long = descriptionText(`<p>${'word '.repeat(300)}</p>`)!;
    expect(long).toHaveLength(MAX_DESCRIPTION);
    expect(long.endsWith('…')).toBe(true);
    expect(descriptionText('<p>Unclosed <b')).toBe('Unclosed');
  });

  it('WORK-2.11: a `>` inside a quoted attribute doesn’t end its tag, and every named entity HTML has is decoded, as are numeric ones; an unknown name stays as written', () => {
    expect(descriptionText('<p><a title="x>y" href=\'a>b\'>Link</a> and <img alt = "1 > 0">done</p>')).toBe('Link and done');
    expect(descriptionText('<ul><li data-note="a>b">One</li></ul><p>Two<br class="x>y">Three</p>')).toBe('- One\nTwo\nThree');
    expect(descriptionText("<p class=a'b>Kept</p>")).toBe('Kept');
    expect(descriptionText('<p title="never closed>Gone</p>')).toBeNull();
    expect(descriptionText('<p>&eacute;t&eacute; &Eacute;T&Eacute; &frac12; &sup2; &euro;5 &check; &rarr; &CounterClockwiseContourIntegral; &copy;</p>')).toBe('été ÉTÉ ½ ² €5 ✓ → ∳ ©');
    expect(descriptionText('<p>&#233; &#xE9; &#X1F600; &nosuchentity; &constructor; &amp;lt;</p>')).toBe('é é 😀 &nosuchentity; &constructor; &lt;');
  });

  it('WORK-2.11: a missing, empty or unreadable description is left out, never a read failure', () => {
    for (const value of [undefined, null, '', '   ', '<p></p><br>', 42, { html: '<p>x</p>' }, ['x']]) {
      const page = JSON.parse(TASKS) as Loose;
      if (value === undefined) delete page.data[0].attributes.description;
      else page.data[0].attributes.description = value;
      expect(parseTasksPage(JSON.stringify(page)).tasks[0]!.description, JSON.stringify(value)).toBeNull();
    }
  });

  it('WORK-6.2: each Task’s URL is built on the server, in Fantastic, never the old app', () => {
    for (const t of parseTasksPage(TASKS).tasks) {
      expect(t.url).toBe(`https://app.fantastic.productive.io/109-productive/tasks/${t.id}`);
      expect(t.url).not.toContain('app.productive.io');
    }
  });

  it('WORK-2.2: what is only shown is bounded, and null when unreadable; a title falls back to the Task', () => {
    const page = JSON.parse(TASKS) as Loose;
    page.data[0].attributes.title = 'Two\nlines \u001b[31mred\u001b[0m';
    page.data[1].attributes.title = 'x'.repeat(400);
    page.data[2].attributes.title = null;
    page.data[0].attributes.due_date = '24.10.2026';
    page.data[1].relationships.project = { meta: { included: false } };
    page.data[3].relationships.workflow_status.data.id = '9999';
    page.included.find((r: Loose) => r.id === '8002').attributes.category_id = 3;
    const tasks = parseTasksPage(JSON.stringify(page)).tasks;
    expect(tasks.map((t) => t.title)).toEqual(['Two lines red', `${'x'.repeat(299)}…`, 'Task 41000003', 'Sweep the lighthouse stairs']);
    expect(tasks[0]!.dueDate).toBeNull();
    expect(tasks[1]!.project).toBeNull();
    expect(tasks[1]!.statusCategory).toBeNull();
    expect(tasks[3]).toMatchObject({ status: null, statusCategory: null, project: 'Harbor Bells' });
  });

  it('WORK-2.1: Tasks Lookout can’t read, a Task without a digit id or a page without data or meta.hasNextPage, are a shape error, never a shorter list', () => {
    const broken: ((p: Loose) => void)[] = [
      (p) => delete p.data[1].id,
      (p) => (p.data[1].id = 41000002),
      (p) => (p.data[1].id = '41000002abc'),
      (p) => (p.data[1] = 'a Task'),
      (p) => delete p.data,
      (p) => delete p.meta.hasNextPage,
      (p) => (p.meta.hasNextPage = 'no'),
      (p) => delete p.meta,
    ];
    for (const mutate of broken) {
      const page = JSON.parse(TASKS) as Loose;
      mutate(page);
      expect(() => parseTasksPage(JSON.stringify(page)), mutate.toString()).toThrow(TbProdShapeError);
    }
    for (const text of ['', 'not json', '[]', 'null']) expect(() => parseTasksPage(text), text).toThrow(TbProdShapeError);
  });

  // tb-prod percent-encodes every character of a filter value but A-Z a-z 0-9 - . _ ~ (`urlencoding::encode`
  // in `Query::to_query_string`), and builds the key from the field alone: these can't change the query.
  it.each([
    ['the query string’s own characters, & = ? and #, which can’t start another parameter', ['lamp&lighter@example.com', 'lamp=lighter@example.com', 'lamp?page=9@example.com', 'lamp#lighter@example.com']],
    ['percent, plus and underscore, which arrive as themselves, never a space, a wildcard or a decoded comma', ['lamp%lighter@example.com', 'lamp%2Clighter@example.com', 'lamp+work@example.com', 'lamp_lighter@example.com']],
    ['brackets, which stay in the value, never the key', ['lamp[0]lighter@example.com', 'lamplighter@[192.0.2.1]', ']x[@example.com']],
  ])('WORK-2.7: %s, are kept as typed and reach tb-prod as one `eq` value in the filter’s JSON', (_, emails) => {
    for (const email of emails) {
      expect(parseProductiveEmail(email), email).toBe(email);
      expect(JSON.parse(tasksQueryArgv(email, 1)[3]!).conditions[0], email).toEqual({ field: 'assignee.email', operator: 'eq', value: email });
    }
  });

  it('WORK-2.1: a Task that moved to a later page while the pages were read shows once, where it was first seen', () => {
    const rows = taskRows(22);
    const first = parseTasksPage(pageOf(rows, 1));
    // Between the calls, a Task on page 1 moved down and shows again on page 2.
    const second = parseTasksPage(pageOf([...rows.slice(0, 20), rows[3], ...rows.slice(20)], 2));
    expect(mergePages([first, second]).map((t) => t.id)).toEqual(rows.map((r) => r.id));
  });
});

describe('tb-prod failures (WORK-7)', () => {
  const PLAIN: readonly string[] = Object.values(TASK_REASON);

  it('WORK-7.6: "not signed in" from tb-prod’s recorded outputs: exit 1 with "No config found", a JSON config_error, or an api_error with status 401', () => {
    const cases: [string, RunError][] = [
      ['stderr-no-config.txt', prodFailed({ stderr: prodFixture('stderr-no-config.txt') })],
      ['stderr-colored-no-config.txt', prodFailed({ stderr: prodFixture('stderr-colored-no-config.txt') })],
      ['config-error.json', prodFailed({ stdout: prodFixture('config-error.json') })],
      ['api-error-401.json', prodFailed({ stdout: prodFixture('api-error-401.json') })],
    ];
    for (const [name, err] of cases) {
      expect(classifyTbProdFailure(err), name).toMatchObject({ state: 'signed-out', reason: TASK_REASON.signedOut, fix: 'tb-prod config init' });
    }
    // "No config found" counts on exit 1 only, as WORK-7.6 says.
    expect(classifyTbProdFailure(prodFailed({ stderr: prodFixture('stderr-no-config.txt') }, 3)).state).toBe('error');
  });

  it('WORK-7.6: an api_error with status 403 isn’t "not signed in": it’s a failed read saying Productive denied access', () => {
    expect(classifyTbProdFailure(prodFailed({ stdout: prodFixture('api-error-403.json') }))).toEqual({
      state: 'error',
      reason: TASK_REASON.denied,
      fix: null,
      detail: 'api_error: API error (403)',
    });
    expect(TASK_REASON.denied).toMatch(/^Productive denied access/);
  });

  it('WORK-7.1: a tb-prod that isn’t installed says so, with the command that builds it from cli-toolbox’s main', () => {
    const enoent = Object.assign(new Error('spawn tb-prod ENOENT'), { code: 'ENOENT' });
    expect(classifyTbProdFailure(enoent)).toEqual({ state: 'not-installed', reason: TASK_REASON.notInstalled, fix: TB_PROD_INSTALL_COMMAND, detail: null });
    expect(TB_PROD_INSTALL_COMMAND).toMatch(/^CARGO_NET_GIT_FETCH_WITH_CLI=true cargo install --git https:\/\/github\.com\/productiveio\/cli-toolbox --branch main --locked --root ~\/\.local tb-prod$/);
  });

  it('WORK-7.8: tb-prod 1.1.1’s invalid_filter naming folder_status says tb-prod is older than 1.2.0, with the build command; any other invalid_filter is a failed read', () => {
    expect(classifyTbProdFailure(prodFailed({ stdout: prodFixture('invalid-filter-1.1.1.json') }))).toMatchObject({
      state: 'error',
      reason: TASK_REASON.outdated,
      fix: TB_PROD_INSTALL_COMMAND,
      detail: expect.stringMatching(/^invalid_filter: Unknown filter field 'folder_status' on tasks\. Available: /),
    });
    expect(TASK_REASON.outdated).toMatch(/^tb-prod is older than 1\.2\.0/);
    expect(classifyTbProdFailure(prodFailed({ stdout: prodFixture('invalid-filter-other.json') }))).toMatchObject({ state: 'error', reason: TASK_REASON.queryRefused, fix: null });
    // clap's usage error (exit 2): a call tb-prod can't parse.
    expect(classifyTbProdFailure(prodFailed({ stderr: prodFixture('stderr-usage.txt') }, 2))).toMatchObject({ state: 'error', reason: TASK_REASON.queryRefused, fix: null });
  });

  it('WORK-7.8: only 1.1.x’s message says tb-prod is older than 1.2.0, `Unknown filter field \'folder_status\'` with board_status among the available keys; any other invalid_filter naming folder_status is a refused query', () => {
    const invalidFilter = (error: string) => prodFailed({ stdout: JSON.stringify({ code: 'invalid_filter', details: { errors: [error] }, error }, null, 2) });
    const v11 = (JSON.parse(prodFixture('invalid-filter-1.1.1.json')) as { error: string }).error;
    expect(classifyTbProdFailure(invalidFilter(v11))).toMatchObject({ reason: TASK_REASON.outdated, fix: TB_PROD_INSTALL_COMMAND });
    for (const error of [
      // A later tb-prod that renamed the key again: building from main wouldn't help.
      v11.replace('board_status', 'container_status'),
      // 1.2.0 refusing an operator, as its validate_condition words it.
      'Invalid operator \'contains\' for field \'folder_status\' (archivable_status). Valid: ["eq", "not_eq"]',
      'Unknown filter field \'folder_status\' on related resource projects.',
    ]) {
      expect(classifyTbProdFailure(invalidFilter(error)), error).toMatchObject({ state: 'error', reason: TASK_REASON.queryRefused, fix: null });
    }
  });

  it('WORK-7.3: any other failure is a failed read whose reason says, in plain words, what failed and what to do; tb-prod’s own text goes only to `detail`, for the log', () => {
    const apiError = (status: number) => prodFailed({ stdout: JSON.stringify({ code: 'api_error', details: { body: '<html>oops</html>', status }, error: `API error (${status})` }, null, 2) });
    const cases: [unknown, string, string | null][] = [
      [apiError(502), TASK_REASON.serverError, 'api_error: API error (502)'],
      [apiError(422), TASK_REASON.refused, 'api_error: API error (422)'],
      [prodFailed({ stdout: '{\n  "code": "internal_error",\n  "error": "HTTP error: error sending request for url (https://api.productive.io/api/v2/tasks)"\n}\n' }), TASK_REASON.failed, 'internal_error: HTTP error: error sending request for url (https://api.productive.io/api/v2/tasks)'],
      [prodFailed({ stderr: 'Error: Config error: TOML parse error at line 1\n' }), TASK_REASON.failed, 'Config error: TOML parse error at line 1'],
      [prodFailed({}, 101), TASK_REASON.failed, 'exit 101'],
      [Object.assign(new Error('x'), { timedOut: true, code: null }), TASK_REASON.timedOut, null],
      [new TbProdShapeError('Task 2 of the page has no id'), TASK_REASON.unreadable, 'Task 2 of the page has no id'],
    ];
    for (const [err, reason, detail] of cases) {
      expect(classifyTbProdFailure(err), reason).toMatchObject({ state: 'error', reason, fix: null, detail });
    }
    // Every reason is Lookout's own sentence: no JSON, no "Error:", no status line, no HTML from tb-prod or Productive.
    for (const [err] of cases) expect(PLAIN).toContain(classifyTbProdFailure(err).reason);
    expect(PLAIN.filter((r) => /<|API error|exit \d|\{|_error/.test(r))).toEqual([]);
    // Productive's answer (`details.body`) is never read, not even for the log.
    expect(JSON.stringify(cases.map(([err]) => classifyTbProdFailure(err)))).not.toContain('oops');
  });

  it('WORK-7.7: token-like text on tb-prod’s stdout and stderr reaches neither the reason nor the logged detail, which is one line', () => {
    const leakyJson = prodFailed({
      stdout: JSON.stringify({ code: 'internal_error', error: `HTTP error: GET https://api.productive.io/x?access_token=tok3n-s3cret-v4lue failed, Authorization: token sekr1t-header ${FAKE_TOKENS[0]}\nline two ${FAKE_TOKENS[1]}` }),
      stderr: leaky,
    });
    const leakyStderr = prodFailed({ stdout: `token=tok3n-s3cret-v4lue ${FAKE_TOKENS[0]}`, stderr: leaky });
    for (const err of [leakyJson, leakyStderr]) {
      const { reason, detail } = classifyTbProdFailure(err);
      expect(reason).toBe(TASK_REASON.failed);
      expect(detail).not.toContain('\n');
      expect(FAKE_TOKENS.filter((t) => `${reason} ${detail}`.includes(t))).toEqual([]);
    }
  });
});

/** A scripted tb-pr and tb-prod: each call waits until the test answers it. */
function scriptedTools() {
  type Call = { tool: 'tb-pr' | 'tb-prod'; argv: string[]; answered: boolean; answer: (out: string | RunError) => void; signal?: AbortSignal; timeoutMs: number };
  const calls: Call[] = [];
  const runner = (file: string, args: readonly string[], opts: RunOptions) => {
    if (file.endsWith('tb-session')) return Promise.resolve(JSON.stringify({ results: [] }));
    return new Promise<string>((resolve, reject) => {
      const call: Call = {
        tool: file.endsWith('tb-prod') ? 'tb-prod' : 'tb-pr',
        argv: [...args],
        answered: false,
        signal: opts.signal,
        timeoutMs: opts.timeoutMs,
        answer: (out) => {
          call.answered = true;
          if (typeof out === 'string') resolve(out);
          else reject(out);
        },
      };
      calls.push(call);
    });
  };
  const of = (tool: Call['tool']) => calls.filter((c) => c.tool === tool);
  return {
    runner,
    calls,
    of,
    /** Each tb-prod call's email and page. */
    prodAsks: () => of('tb-prod').map((c) => `${JSON.parse(c.argv[3]!).conditions[0].value} p${c.argv[8]}`),
    prArgvs: () => of('tb-pr').map((c) => c.argv.join(' ')),
    pending: (tool: Call['tool']) => of(tool).filter((c) => !c.answered),
  };
}

describe('WorkMonitor reads Tasks (WORK-2, WORK-8)', () => {
  let events: WorkSnapshot[];
  let logged: [string, string][];
  let monitor: WorkMonitor;
  let tools: ReturnType<typeof scriptedTools>;
  const T0 = Date.parse('2026-10-20T09:00:00Z');

  const make = (email: string | null) =>
    new WorkMonitor({
      runner: tools.runner,
      tbPrBin: () => '/bin/tb-pr',
      tbProdBin: () => '/bin/tb-prod',
      tbSessionBin: () => '/bin/tb-session',
      productiveEmail: email,
      onChange: (w) => events.push(w),
      log: (line, tool) => logged.push([tool, line]),
    });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    events = [];
    logged = [];
    tools = scriptedTools();
    monitor = make(ME);
  });
  afterEach(async () => {
    for (const c of tools.calls) if (!c.answered) c.answer(failedRun('test over'));
    await monitor.close();
    vi.useRealTimers();
  });

  const settle = () => vi.advanceTimersByTimeAsync(0);
  /** Answers the oldest unanswered call of `tool`. */
  const answer = async (tool: 'tb-pr' | 'tb-prod', out: string | RunError) => {
    const call = tools.pending(tool)[0];
    if (!call) throw new Error(`no ${tool} call to answer`);
    call.answer(out);
    await settle();
  };
  /** Answers a whole Tasks read of `rows`, page by page. */
  const answerTasks = async (rows: unknown[]) => {
    for (let page = 1; tools.pending('tb-prod').length > 0; page++) await answer('tb-prod', pageOf(rows, page));
  };
  const tasks = () => monitor.snapshot().tasks;

  it('WORK-2.6: with no Productive email saved, Tasks is `no-email` and no tb-prod runs; PRs work as usual', async () => {
    const none = make(null);
    expect(none.snapshot().tasks).toEqual({ state: 'no-email', reason: null, fix: null, stale: false, fetchedAt: null, tasks: [] });
    none.watch();
    await settle();
    await answer('tb-pr', LIST);
    expect(none.snapshot().prs.state).toBe('ok');
    const forced = none.refresh();
    await settle();
    await answer('tb-pr', fixture('stdout-refresh.txt'));
    await answer('tb-pr', LIST);
    expect(await forced).toEqual({ status: 200, result: { ok: true } });
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS * 3);
    expect(tools.of('tb-prod')).toEqual([]);
    expect(none.snapshot().tasks.state).toBe('no-email');
    for (const c of tools.pending('tb-pr')) c.answer(LIST);
    await none.close();
  });

  it('WORK-2.1, WORK-8.1: a tab opening Work reads Tasks and PRs in parallel; Tasks list the saved email’s, in tb-prod’s order, with when they were read', async () => {
    expect(tasks().state).toBe('loading');
    monitor.watch();
    await settle();
    // Both started before either answered.
    expect(tools.prodAsks()).toEqual([`${ME} p1`]);
    expect(tools.prArgvs()).toEqual(['list --json']);
    expect(tools.of('tb-prod')[0]!.timeoutMs).toBe(TB_PROD_TIMEOUT_MS);
    vi.setSystemTime(T0 + 300);
    await answer('tb-prod', TASKS);
    expect(tasks()).toMatchObject({ state: 'ok', reason: null, fix: null, stale: false, fetchedAt: T0 + 300 });
    expect(titles(tasks().tasks)).toEqual(['Polish the brass lanterns', 'Ring the harbor bells at noon', 'Q4 lantern launch', 'Sweep the lighthouse stairs']);
    expect(events.at(-1)!.tasks.tasks).toHaveLength(4);
    await answer('tb-pr', LIST);
    expect(monitor.snapshot().prs.state).toBe('ok');
  });

  it('WORK-2.1: a page with more after it reads the next, up to 5 pages (100 Tasks); 20 Tasks or fewer take one call', async () => {
    monitor.watch();
    await settle();
    await answerTasks(taskRows(23));
    expect(tools.prodAsks()).toEqual([`${ME} p1`, `${ME} p2`]);
    expect(tasks().tasks.map((t) => t.title)).toEqual(taskRows(23).map((r) => r.attributes.title));

    await answer('tb-pr', LIST);
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    await answerTasks(taskRows(130));
    expect(tools.prodAsks().slice(2)).toEqual([1, 2, 3, 4, 5].map((p) => `${ME} p${p}`));
    expect(MAX_TASK_PAGES).toBe(5);
    expect(tasks().tasks).toHaveLength(100);
    expect(tasks().tasks.at(-1)!.title).toBe('Task 99');

    await answer('tb-pr', LIST);
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    await answerTasks(taskRows(20));
    expect(tools.prodAsks().slice(7)).toEqual([`${ME} p1`]);
    expect(tasks().tasks).toHaveLength(20);
  });

  it('WORK-7.3: a failure on any page fails the whole read: the last list stays, marked old, with the reason; with none, the reason alone', async () => {
    monitor.watch();
    await settle();
    // The first read fails on page 2: no partial list.
    await answer('tb-prod', pageOf(taskRows(23), 1));
    await answer('tb-prod', prodFailed({ stdout: prodFixture('api-error-403.json') }));
    expect(tasks()).toEqual({ state: 'error', reason: TASK_REASON.denied, fix: null, stale: false, fetchedAt: null, tasks: [] });
    expect(logged).toEqual([['tb-prod', 'api_error: API error (403)']]);

    await answer('tb-pr', LIST);
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    await answer('tb-prod', TASKS);
    const good = tasks();
    expect(good.state).toBe('ok');

    await answer('tb-pr', LIST);
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    await answer('tb-prod', Object.assign(new Error('timed out'), { timedOut: true, code: null }));
    expect(tasks()).toEqual({ ...good, state: 'error', reason: TASK_REASON.timedOut, stale: true });

    await answer('tb-pr', LIST);
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    await answer('tb-prod', TASKS);
    expect(tasks()).toEqual({ ...good, fetchedAt: Date.now() });
  });

  it('WORK-7.1, WORK-7.2: tb-prod not installed or not signed in: Tasks says so with its fix, and PRs work as usual', async () => {
    monitor.watch();
    await settle();
    await answer('tb-prod', Object.assign(new Error('spawn tb-prod ENOENT'), { code: 'ENOENT' }));
    await answer('tb-pr', LIST);
    expect(tasks()).toMatchObject({ state: 'not-installed', reason: TASK_REASON.notInstalled, fix: TB_PROD_INSTALL_COMMAND, tasks: [] });
    expect(monitor.snapshot().prs.state).toBe('ok');
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    await answer('tb-prod', prodFailed({ stdout: prodFixture('api-error-401.json') }));
    expect(tasks()).toMatchObject({ state: 'signed-out', reason: TASK_REASON.signedOut, fix: 'tb-prod config init' });
  });

  it('WORK-8.1: every 5 minutes from the end of the last read, both sources; with Work closed everywhere, nothing, not even for a newly saved email', async () => {
    const close = monitor.watch();
    await settle();
    await answer('tb-prod', TASKS);
    await vi.advanceTimersByTimeAsync(2_000);
    await answer('tb-pr', LIST); // the last read ends here
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS - 1);
    expect(tools.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(tools.prodAsks()).toEqual([`${ME} p1`, `${ME} p1`]);
    expect(tools.prArgvs()).toEqual(['list --json', 'list --json']);
    await answer('tb-prod', TASKS);
    await answer('tb-pr', LIST);

    close();
    monitor.setProductiveEmail(OTHER);
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS * 3);
    expect(tools.calls).toHaveLength(4);
    expect(tasks()).toMatchObject({ state: 'loading', tasks: [] });
  });

  it('WORK-8.1: opening Work reads Tasks not yet read for the saved email, however fresh the PRs; otherwise it waits for the schedule', async () => {
    const none = make(null);
    const first = none.watch();
    await settle();
    await answer('tb-pr', LIST);
    first();
    none.setProductiveEmail(ME);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tools.of('tb-prod')).toEqual([]);
    // A minute later, a tab opens Work: the PRs are fresh, the Tasks not read yet.
    const second = none.watch();
    await settle();
    expect(tools.prodAsks()).toEqual([`${ME} p1`]);
    expect(tools.prArgvs()).toEqual(['list --json']);
    await answer('tb-prod', TASKS);
    expect(none.snapshot().tasks.state).toBe('ok');
    second();
    // Read now, and fresh: opening again reads nothing.
    none.watch();
    await settle();
    expect(tools.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    expect(tools.calls).toHaveLength(4);
    for (const c of tools.pending('tb-pr')) c.answer(LIST);
    for (const c of tools.pending('tb-prod')) c.answer(TASKS);
    await none.close();
  });

  it('WORK-8.1: opening Work reads each source by its own age: a Tasks-only read never makes the PRs look fresh, nor a PR read the Tasks', async () => {
    const first = monitor.watch();
    await settle();
    await answer('tb-prod', TASKS);
    await answer('tb-pr', LIST);
    // 4 minutes on, a new email is saved: its Tasks are read, the PRs aren't.
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    monitor.setProductiveEmail(OTHER);
    await settle();
    await answer('tb-prod', TASKS);
    first();
    // At 8 minutes a tab opens Work: the PRs are 8 minutes old, the Tasks 4. The PRs are read at
    // once, not at 9 minutes with the schedule.
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    const second = monitor.watch();
    await settle();
    expect(tools.prArgvs()).toEqual(['list --json', 'list --json']);
    expect(tools.prodAsks()).toEqual([`${ME} p1`, `${OTHER} p1`]);
    await answer('tb-pr', LIST);
    second();
    // At 10 minutes: the Tasks are 6 minutes old, the PRs 2. The Tasks alone are read.
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    monitor.watch();
    await settle();
    expect(tools.prodAsks()).toEqual([`${ME} p1`, `${OTHER} p1`, `${OTHER} p1`]);
    expect(tools.prArgvs()).toEqual(['list --json', 'list --json']);
    await answer('tb-prod', TASKS);
    // The schedule still counts from the end of the last read of either kind, and reads both.
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS - 1);
    expect(tools.calls).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(tools.calls).toHaveLength(7);
  });

  it('WORK-2.8: saving a different email drops the kept list at once and, with Work open, reads the new email’s Tasks at once', async () => {
    monitor.watch();
    await settle();
    await answer('tb-prod', TASKS);
    await answer('tb-pr', LIST);
    const n = events.length;
    monitor.setProductiveEmail(OTHER);
    // Dropped at once, and every tab hears it: "Loading", never the previous address's list.
    expect(tasks()).toEqual({ state: 'loading', reason: null, fix: null, stale: false, fetchedAt: null, tasks: [] });
    expect(events).toHaveLength(n + 1);
    expect(events.at(-1)!.tasks.tasks).toEqual([]);
    await settle();
    expect(tools.prodAsks()).toEqual([`${ME} p1`, `${OTHER} p1`]);
    // Its read fails: the reason, without a list (WORK-7.3).
    await answer('tb-prod', prodFailed({ stdout: prodFixture('api-error-403.json') }));
    expect(tasks()).toEqual({ state: 'error', reason: TASK_REASON.denied, fix: null, stale: false, fetchedAt: null, tasks: [] });
    // Saving the same email again changes nothing and reads nothing.
    monitor.setProductiveEmail(OTHER);
    await settle();
    expect(tools.of('tb-prod')).toHaveLength(2);
  });

  it('WORK-2.8, WORK-8.3: a new email’s read waits for one running for another email, whose result is discarded; only the newest saved email is read', async () => {
    monitor.watch();
    await settle();
    expect(tools.prodAsks()).toEqual([`${ME} p1`]);
    monitor.setProductiveEmail(OTHER);
    monitor.setProductiveEmail('third@example.com');
    await settle();
    // It waits: one Tasks read at a time.
    expect(tools.prodAsks()).toEqual([`${ME} p1`]);
    await answer('tb-prod', TASKS);
    // The previous email's Tasks are discarded: still "Loading".
    expect(tasks()).toMatchObject({ state: 'loading', tasks: [] });
    expect(events.some((e) => e.tasks.tasks.length > 0)).toBe(false);
    // The email saved over meanwhile isn't read; the newest is.
    expect(tools.prodAsks()).toEqual([`${ME} p1`, 'third@example.com p1']);
    await answer('tb-prod', pageOf(taskRows(2), 1));
    expect(tasks()).toMatchObject({ state: 'ok', tasks: [{ title: 'Task 0' }, { title: 'Task 1' }] });

    // A failure for an email no longer saved is discarded too: its reason never shows.
    await answer('tb-pr', LIST);
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    expect(tools.pending('tb-prod')).toHaveLength(1);
    monitor.setProductiveEmail(ME);
    await answer('tb-prod', prodFailed({ stdout: prodFixture('api-error-401.json') }));
    expect(tasks()).toMatchObject({ state: 'loading', reason: null, tasks: [] });
    await settle();
    expect(tools.prodAsks().at(-1)).toBe(`${ME} p1`);
  });

  it('WORK-2.8: an email saved over while the pages are read stops the paging: no page follows the one in flight, and the new email’s read starts then', async () => {
    monitor.watch();
    await settle();
    await answer('tb-pr', LIST);
    // 100 Tasks: page 1 says there's more, and page 2 is asked for.
    await answer('tb-prod', pageOf(taskRows(100), 1));
    expect(tools.prodAsks()).toEqual([`${ME} p1`, `${ME} p2`]);
    monitor.setProductiveEmail(OTHER);
    await settle();
    await answer('tb-prod', pageOf(taskRows(100), 2));
    // No page 3 for an email no longer saved: the new email's read runs next.
    expect(tools.prodAsks()).toEqual([`${ME} p1`, `${ME} p2`, `${OTHER} p1`]);
    expect(tasks()).toMatchObject({ state: 'loading', tasks: [] });
    await answer('tb-prod', pageOf(taskRows(2), 1));
    expect(tasks()).toMatchObject({ state: 'ok', tasks: [{ title: 'Task 0' }, { title: 'Task 1' }] });
    expect(tools.of('tb-prod')).toHaveLength(3);
  });

  it('WORK-2.7, WORK-2.6: clearing the email goes back to `no-email`; a read running for the old one is discarded, and none follows', async () => {
    monitor.watch();
    await settle();
    monitor.setProductiveEmail(null);
    expect(tasks()).toEqual({ state: 'no-email', reason: null, fix: null, stale: false, fetchedAt: null, tasks: [] });
    await answer('tb-prod', TASKS);
    expect(tasks().state).toBe('no-email');
    await answer('tb-pr', LIST);
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    await answer('tb-pr', LIST);
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    expect(tools.of('tb-prod')).toHaveLength(1);
    expect(tools.prArgvs()).toEqual(['list --json', 'list --json', 'list --json']);
  });

  it('WORK-8.3: two tabs opening at once share one Tasks read; Refresh joins a Tasks read in flight for the same email, but runs tb-pr refresh', async () => {
    monitor.watch();
    monitor.watch();
    await settle();
    expect(tools.prodAsks()).toEqual([`${ME} p1`]);
    await answer('tb-pr', LIST);
    const forced = monitor.refresh();
    await settle();
    expect(tools.prodAsks()).toEqual([`${ME} p1`]);
    expect(tools.prArgvs()).toEqual(['list --json', 'refresh']);
    await answer('tb-prod', TASKS);
    await answer('tb-pr', fixture('stdout-refresh.txt'));
    await answer('tb-pr', LIST);
    expect(await forced).toEqual({ status: 200, result: { ok: true } });
    expect(tools.of('tb-prod')).toHaveLength(1);
  });

  it('WORK-8.2: Refresh reads Tasks too and answers once both reads end, with the reasons of those that failed', async () => {
    monitor.watch();
    await settle();
    await answer('tb-prod', TASKS);
    await answer('tb-pr', LIST);
    const forced = monitor.refresh();
    await settle();
    expect(tools.prodAsks()).toEqual([`${ME} p1`, `${ME} p1`]);
    expect(tools.prArgvs()).toEqual(['list --json', 'refresh']);
    await answer('tb-pr', fixture('stdout-refresh.txt'));
    await answer('tb-pr', LIST);
    let done = false;
    void forced.then(() => (done = true));
    await settle();
    expect(done).toBe(false); // the Tasks read still runs
    await answer('tb-prod', prodFailed({ stdout: prodFixture('invalid-filter-1.1.1.json') }));
    expect(await forced).toEqual({ status: 200, result: { ok: false, error: TASK_REASON.outdated } });
    expect(tasks()).toMatchObject({ state: 'error', reason: TASK_REASON.outdated, fix: TB_PROD_INSTALL_COMMAND, stale: true });

    await vi.advanceTimersByTimeAsync(WORK_COOLDOWN_MS);
    const both = monitor.refresh();
    await settle();
    await answer('tb-pr', failedRun('Error: GitHub API error (500): oops'));
    await answer('tb-prod', prodFailed({ stdout: prodFixture('api-error-403.json') }));
    expect(await both).toEqual({ status: 200, result: { ok: false, error: `${PR_REASON.serverError} ${TASK_REASON.denied}` } });
  });

  it('WORK-8.4: while GitHub is rate limited, scheduled reads read Tasks only, and the next comes when the limit ends', async () => {
    vi.setSystemTime(Date.parse('2026-10-20T10:00:00Z'));
    monitor.watch();
    await settle();
    await answer('tb-prod', TASKS);
    await answer('tb-pr', failedRun(fixture('stderr-rate-limited-reset.txt'))); // resets at 10:42:17 UTC
    const until = Date.parse('2026-10-20T10:42:17Z');
    expect(monitor.snapshot().refresh.githubBlockedUntil).toBe(until);
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    expect(tools.prodAsks()).toHaveLength(2);
    expect(tools.prArgvs()).toEqual(['list --json']);
    await answer('tb-prod', TASKS);
    // Every 5 minutes, Tasks alone, until the limit ends.
    while (Date.now() + WORK_INTERVAL_MS < until) {
      await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
      await answer('tb-prod', TASKS);
    }
    expect(tools.prArgvs()).toEqual(['list --json']);
    await vi.advanceTimersByTimeAsync(until - Date.now());
    expect(tools.prArgvs()).toEqual(['list --json', 'list --json']);
  });

  it('WORK-8.4: with an email saved and GitHub rate limited, Refresh answers 429 and runs no tb-prod either; scheduled reads read Tasks only', async () => {
    vi.setSystemTime(Date.parse('2026-10-20T10:00:00Z'));
    monitor.watch();
    await settle();
    await answer('tb-prod', TASKS);
    await answer('tb-pr', failedRun(fixture('stderr-rate-limited-reset.txt'))); // resets at 10:42:17 UTC
    const until = Date.parse('2026-10-20T10:42:17Z');
    const refused = { status: 429, result: { ok: false, error: 'GitHub is rate limited', until } };
    expect(await monitor.refresh()).toEqual(refused);
    await settle();
    expect(tools.prodAsks()).toEqual([`${ME} p1`]);
    expect(monitor.snapshot().refresh.cooldownUntil).toBeNull();
    // The schedule reads Tasks, and Tasks alone; Refresh stays refused for both.
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    expect(tools.prodAsks()).toEqual([`${ME} p1`, `${ME} p1`]);
    await answer('tb-prod', TASKS);
    expect(await monitor.refresh()).toEqual(refused);
    await settle();
    expect(tools.of('tb-prod')).toHaveLength(2);
    expect(tools.prArgvs()).toEqual(['list --json']);
  });

  it('WORK-8.1, WORK-8.4: Tasks-only reads during a rate limit never make the PRs look fresh: opening Work after it ended reads the PRs at once', async () => {
    vi.setSystemTime(Date.parse('2026-10-20T10:35:00Z'));
    const first = monitor.watch();
    await settle();
    await answer('tb-prod', TASKS);
    await answer('tb-pr', failedRun(fixture('stderr-rate-limited-reset.txt'))); // resets at 10:42:17 UTC
    // 10:40: the schedule reads Tasks alone.
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    await answer('tb-prod', TASKS);
    expect(tools.prArgvs()).toEqual(['list --json']);
    // Work closes at 10:41; the limit ends at 10:42:17 with Work closed.
    await vi.advanceTimersByTimeAsync(60_000);
    first();
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    // 10:43: the Tasks are 3 minutes old, the PRs 8. The PRs are read at once, not at 10:45.
    monitor.watch();
    await settle();
    expect(tools.prArgvs()).toEqual(['list --json', 'list --json']);
    expect(tools.prodAsks()).toEqual([`${ME} p1`, `${ME} p1`]);
  });

  it('WORK-8.1, WORK-8.4: opening Work while a rate limit still holds old PRs reads them when it ends, not 5 minutes after the last Tasks read', async () => {
    vi.setSystemTime(Date.parse('2026-10-20T10:35:00Z'));
    const first = monitor.watch();
    await settle();
    await answer('tb-prod', TASKS);
    await answer('tb-pr', failedRun(fixture('stderr-rate-limited-reset.txt'))); // resets at 10:42:17 UTC
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS);
    await answer('tb-prod', TASKS); // 10:40, Tasks alone
    first();
    // 10:42: still limited. Nothing is read on opening…
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    monitor.watch();
    await settle();
    expect(tools.calls).toHaveLength(3);
    // …and the PRs are read as the limit ends, at 10:42:17.
    await vi.advanceTimersByTimeAsync(Date.parse('2026-10-20T10:42:17Z') - Date.now() - 1);
    expect(tools.prArgvs()).toEqual(['list --json']);
    await vi.advanceTimersByTimeAsync(1);
    expect(tools.prArgvs()).toEqual(['list --json', 'list --json']);
  });

  it('WORK-7.7: a failing tb-prod with token-like stdout and stderr leaves none of it in the snapshot, the events, the Refresh answer or the log', async () => {
    const consoles = [vi.spyOn(console, 'error'), vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'info')];
    const leak = () =>
      prodFailed({
        stdout: JSON.stringify({ code: 'api_error', details: { body: `token=tok3n-s3cret-v4lue ${FAKE_TOKENS[0]}`, status: 500 }, error: `API error (500): ${FAKE_TOKENS[0]} Authorization: token sekr1t-header` }),
        stderr: leaky,
      });
    monitor.watch();
    await settle();
    await answer('tb-prod', leak());
    await answer('tb-pr', LIST);
    const forced = monitor.refresh();
    await settle();
    await answer('tb-prod', prodFailed({ stdout: `token=tok3n-s3cret-v4lue ${FAKE_TOKENS[1]}`, stderr: leaky }));
    await answer('tb-pr', fixture('stdout-refresh.txt'));
    await answer('tb-pr', LIST);
    const result = await forced;
    const seen = JSON.stringify([result, monitor.snapshot(), events, logged]);
    expect(FAKE_TOKENS.filter((t) => seen.includes(t))).toEqual([]);
    expect(tasks().reason).toBe(TASK_REASON.failed);
    expect(logged.map(([tool]) => tool)).toEqual(['tb-prod', 'tb-prod']);
    for (const [, line] of logged) expect(line).not.toContain('\n');
    for (const spy of consoles) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  it('close() cancels a Tasks read in flight, and no page follows it', async () => {
    monitor.watch();
    await settle();
    const call = tools.of('tb-prod')[0]!;
    const closing = monitor.close();
    expect(call.signal?.aborted).toBe(true);
    call.answer(Object.assign(new Error('cancelled'), { aborted: true }));
    for (const c of tools.pending('tb-pr')) c.answer(Object.assign(new Error('cancelled'), { aborted: true }));
    await closing;
    await vi.advanceTimersByTimeAsync(WORK_INTERVAL_MS * 2);
    expect(tools.of('tb-prod')).toHaveLength(1);
    expect(tasks().state).toBe('loading');
  });
});
