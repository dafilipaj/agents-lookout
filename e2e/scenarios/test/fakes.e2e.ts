import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { STATE_ENV, VIOLATIONS_ENV, readViolations } from '../../fakes/control.ts';
import type { FakeViolation } from '../../fakes/index.ts';
import { BrowserGuard } from '../../world/browser.ts';
import { type TaskDecl, type TbPrBoardDecl, type TbProdDecl, checkTbProd } from '../../world/builder.ts';
import { expect, scenario, test, world } from '../../world/index.ts';
import { REPO_ROOT } from '../../world/pins.ts';
import { recordLeftovers, runDir } from '../../world/registry.ts';
import { type StopReport, type WorldCall, startWorld } from '../../world/runtime.ts';

/**
 * What WORK's Behaviour tests need from a World (TEST-1.5, TEST-1.6, TEST-1.7): the fake `tb-prod`
 * and `tb-pr`, answers changed or held mid-test, a global git identity, and pages that reach only
 * the World's Lookout. A call a fake doesn't answer fails the test: e2e/scenarios/test/selftest.e2e.ts
 * proves that with a run of its own.
 */

const ME = 'dario@example.com';
const OTHER = 'someone@example.com';

/** WORK's filter (its Sources): the open Tasks assigned to `email`. */
const workConditions = (email: string): Record<string, unknown>[] => [
  { field: 'assignee.email', op: 'eq', value: email },
  { field: 'project.status', op: 'eq', value: '1' },
  { field: 'task_list_status', op: 'eq', value: '1' },
  { field: 'folder_status', op: 'eq', value: '1' },
  { field: 'workflow_status_category_id', op: 'not_eq', value: '3' },
];
const filterOf = (conditions: unknown[]) => JSON.stringify({ op: 'and', conditions });

/** `tb-prod query tasks` as WORK reads Tasks (its Sources). */
const tasksQuery = (email: string, page = 1) => [
  'query',
  'tasks',
  '--filter',
  filterOf(workConditions(email)),
  '--include',
  'project,workflow_status',
  '--sort=-last_activity_at',
  '--page',
  String(page),
];

/**
 * Runs a fake's script as its `bin/` wrapper does, outside any World, answering `answer`: for the
 * calls a World fails its test on. Its directory is in this run's, under .cache/e2e/runs/.
 */
async function callFake(name: 'tb-prod' | 'tb-pr', argv: string[], answer: unknown): Promise<WorldCall & { violations: FakeViolation[] }> {
  const base = join(runDir(), 'fakes');
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, `${name}-`));
  try {
    writeFileSync(join(dir, 'answer.json'), JSON.stringify(answer));
    const log = join(dir, 'violations.jsonl');
    const env = { PATH: '/usr/bin:/bin', [STATE_ENV]: dir, [VIOLATIONS_ENV]: log };
    const r = await new Promise<WorldCall>((resolve) => {
      execFile(process.execPath, [join(REPO_ROOT, 'e2e', 'fakes', `${name}.ts`), ...argv], { env, timeout: 10_000 }, (err, stdout, stderr) => {
        resolve({ stdout, stderr, code: err ? (typeof err.code === 'number' ? err.code : null) : 0 });
      });
    });
    return { ...r, violations: readViolations(log) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * A fake call answering a declared timeout (TEST-1.5): it starts, reads that answer (`hanging()`),
 * and from then on says nothing for `SILENT_MS`, until the caller's timeout ends it with nothing
 * printed. The silence is measured only once the fake read its answer, so a slow start can't pass
 * for it, and the caller's timeout leaves the start seconds to spare.
 */
const SILENT_MS = 1000;
async function expectTimeout(call: Promise<WorldCall>, hanging: () => Promise<string[]>, argv: string[]): Promise<void> {
  let answered = false;
  void call.then(() => (answered = true));
  expect(await hanging()).toEqual(argv);
  await new Promise((r) => setTimeout(r, SILENT_MS));
  expect(answered, `the fake answered ${JSON.stringify(argv)} though it read a timeout`).toBe(false);
  expect(await call).toEqual({ stdout: '', stderr: '', code: null });
}

/** An ISO time `minutes` before now. */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

interface Ref {
  type: string;
  id: string;
}
interface Resource extends Ref {
  attributes: Record<string, unknown>;
}
interface TasksPage {
  data: (Resource & { relationships: { project: { data: Ref }; workflow_status: { data: Ref } } })[];
  included: Resource[];
  meta: { totalCount: number; totalPages: number; currentPage: number; hasNextPage: boolean };
}

const page = (r: WorldCall): TasksPage => {
  expect(r.code, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as TasksPage;
};
const titles = (r: WorldCall) => page(r).data.map((t) => t.attributes.title);

/** 23 open Tasks, declared oldest first, so that only the fake's sort puts the newest first. */
const many: TaskDecl[] = Array.from({ length: 23 }, (_, i) => ({
  id: String(100 + i),
  title: `Task ${i}`,
  project: i % 2 ? 'Acme' : 'Lookout',
  lastActivityAt: `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
  ...(i === 22 ? { status: 'Backlog', statusCategory: 1 as const, milestone: true, dueDate: '2026-11-01' } : {}),
}));

scenario('TEST-1.2: tb-prod and tb-pr are on PATH only when declared, and each call of theirs is logged', world().tbProd().tbPr(), async ({ world }) => {
  const lookup = async (name: string) => (await world.run('bash', ['-c', `type -P ${name} || true`])).stdout.trim();
  for (const name of ['tb-prod', 'tb-pr']) {
    expect(await lookup(name), name).toBe(join(world.bin, name));
    // A wrapper that runs the fake's script, never a real tb-prod or tb-pr.
    expect(readFileSync(join(world.bin, name), 'utf8')).toContain(`/e2e/fakes/${name}.ts'`);
  }
  expect((await world.run('tb-pr', ['list', '--json'])).code).toBe(0);
  expect((await world.run('tb-prod', tasksQuery(ME))).code).toBe(0);
  // TEST-2.4: in the calls log with Fleet's and tb-session's, and per fake as argv.
  expect(world.calls().filter((c) => /^\S+ tb-pr(od)? /.test(c))).toEqual([
    expect.stringMatching(/^\d\d:\d\d:\d\d tb-pr list --json$/),
    expect.stringMatching(/^\d\d:\d\d:\d\d tb-prod query tasks --filter \S+ --include project\\,workflow_status --sort=-last_activity_at --page 1$/),
  ]);
  expect(world.tbPr.calls()).toEqual([['list', '--json']]);
  expect(world.tbProd.calls()).toEqual([tasksQuery(ME)]);
});

scenario(
  'TEST-1.5: the fake tb-prod answers query tasks with the Tasks declared for the email in its filter, as JSON:API pages',
  world().tbProd({ tasks: { [ME]: many, [OTHER]: [{ id: '900', title: 'Not mine', project: 'Acme', dueDate: '2026-10-30' }] } }),
  async ({ world }) => {
    // Pages of 20, the most recently active first.
    const first = page(await world.run('tb-prod', tasksQuery(ME)));
    expect(first.meta).toEqual({ totalCount: 23, totalPages: 2, currentPage: 1, hasNextPage: true });
    expect(first.data.map((t) => t.attributes.title)).toEqual(Array.from({ length: 20 }, (_, i) => `Task ${22 - i}`));
    const second = page(await world.run('tb-prod', tasksQuery(ME, 2)));
    expect(second.meta).toEqual({ totalCount: 23, totalPages: 2, currentPage: 2, hasNextPage: false });
    expect(second.data.map((t) => t.attributes.title)).toEqual(['Task 2', 'Task 1', 'Task 0']);

    // A Task with its project and workflow status under `included`, as tb-prod prints Productive's.
    const [milestone] = first.data;
    expect(milestone).toEqual({
      id: '122',
      type: 'tasks',
      attributes: { title: 'Task 22', due_date: '2026-11-01', last_activity_at: '2026-10-23T10:00:00Z', type_id: 3 },
      relationships: { project: { data: { type: 'projects', id: expect.any(String) } }, workflow_status: { data: { type: 'workflow_statuses', id: expect.any(String) } } },
    });
    const included = (r: Ref | undefined) => first.included.find((i) => i.type === r?.type && i.id === r?.id)?.attributes;
    expect(included(milestone?.relationships.project.data)).toEqual({ name: 'Lookout' });
    expect(included(milestone?.relationships.workflow_status.data)).toEqual({ name: 'Backlog', category_id: 1 });
    expect(included(first.data[1]?.relationships.workflow_status.data)).toEqual({ name: 'In progress', category_id: 2 });
    expect(first.data[1]?.attributes).toMatchObject({ due_date: null, type_id: 1 });

    // Another email gets its own Tasks; one nothing is declared for gets none.
    expect(titles(await world.run('tb-prod', tasksQuery(OTHER)))).toEqual(['Not mine']);
    const none = page(await world.run('tb-prod', tasksQuery('nobody@example.com')));
    expect(none).toEqual({ data: [], included: [], meta: { totalCount: 0, totalPages: 1, currentPage: 1, hasNextPage: false } });
    expect(world.violations()).toEqual([]);
  },
);

scenario(
  'TEST-1.5: the fake tb-prod fails as declared: no config, an api_error with status 401 or 403, a timeout',
  world().tbProd({ tasks: { [ME]: many }, failure: 'no-config' }),
  async ({ world }) => {
    expect(await world.run('tb-prod', tasksQuery(ME))).toEqual({
      stdout: '',
      stderr: 'Error: Config error: No config found. Run `tb-prod config init --token <TOKEN>` or create secrets.toml with [productive] section\n',
      code: 1,
    });
    for (const status of [401, 403] as const) {
      world.tbProd.answer({ tasks: { [ME]: many }, failure: status });
      const r = await world.run('tb-prod', tasksQuery(ME));
      expect(r.code).toBe(1);
      expect(r.stderr).toBe('');
      expect(JSON.parse(r.stdout)).toEqual({ error: `API error (${status})`, code: 'api_error', details: { status, body: expect.stringContaining(`"status":"${status}"`) } });
    }
    // A timeout never answers: the caller gives up first.
    world.tbProd.answer({ failure: 'timeout' });
    await expectTimeout(world.run('tb-prod', tasksQuery(ME), { timeoutMs: 5000 }), () => world.tbProd.hanging(), tasksQuery(ME));
  },
);

test('TEST-1.5: the fake tb-prod refuses, each as a violation, what tb-prod refuses, in its words, and any query but WORK\'s', async () => {
  const decl: TbProdDecl = checkTbProd({ tasks: { [ME]: [{ id: '1', title: 'Mine', project: 'Acme' }] } });
  const work = workConditions(ME);
  const query = (conditions: unknown[], ...rest: string[]) => ['query', 'tasks', '--filter', filterOf(conditions), ...rest];
  const swap = (field: string, condition: Record<string, unknown>) => work.map((c) => (c.field === field ? condition : c));
  const violation = (argv: string[], why: string | RegExp) => [{ command: 'tb-prod', argv, why: typeof why === 'string' ? why : expect.stringMatching(why) }];

  // WORK's query is answered, and is no violation.
  expect(await callFake('tb-prod', tasksQuery(ME), decl)).toMatchObject({ code: 0, stderr: '', violations: [] });

  // clap takes a value that starts with `-`, given as a word of its own, for a flag.
  const split = [...query(work), '--sort', '-last_activity_at'];
  expect(await callFake('tb-prod', split, decl)).toEqual({
    stdout: '',
    stderr: "error: unexpected argument '-l' found\n\n  tip: to pass '-l' as a value, use '-- -l'\n\nUsage: tb-prod query [OPTIONS] <RESOURCE_TYPE>\n\nFor more information, try '--help'.\n",
    code: 2,
    violations: violation(split, 'clap reads `-last_activity_at`, the value of --sort, as a flag: pass it as `--sort=-last_activity_at`'),
  });

  // A filter tb-prod's schema rejects: `invalid_filter`, exit 1, JSON on stdout, as validate_condition words it.
  const invalidFilter = async (conditions: unknown[], first: string | RegExp) => {
    const argv = query(conditions);
    const r = await callFake('tb-prod', argv, decl);
    expect(r, argv[3]).toMatchObject({ stderr: '', code: 1, violations: violation(argv, /^tb-prod rejects its --filter \(invalid_filter\): /) });
    expect(r.stdout).toMatch(/^\{\n {2}"code": "invalid_filter",\n {2}"details": \{/);
    const out = JSON.parse(r.stdout) as { code: string; error: string; details: { errors: string[] } };
    expect(out.error).toEqual(typeof first === 'string' ? first : expect.stringMatching(first));
    expect(out.details.errors[0]).toBe(out.error);
    return out.details.errors;
  };
  // The category by its parameter's name, as tb-prod's own hint gives it, and the board's status.
  await invalidFilter(swap('workflow_status_category_id', { field: 'workflow_status_category', op: 'not_eq', value: '3' }), /^Unknown filter field 'workflow_status_category' on tasks\. Available: title, description, .*workflow_status_category_id/);
  await invalidFilter(swap('folder_status', { field: 'board_status', op: 'eq', value: '1' }), /^Unknown filter field 'board_status' on tasks\. Available: /);
  await invalidFilter(swap('assignee.email', { field: 'assignee.mail', op: 'eq', value: ME }), "Unknown filter field 'mail' on related resource people.");
  await invalidFilter(swap('assignee.email', { field: 'assignee_email', op: 'eq', value: ME }), /^Unknown filter field 'assignee_email' on tasks\./);
  await invalidFilter(swap('project.status', { field: 'project.status', op: 'gt', value: '1' }), 'Invalid operator \'gt\' for project.status. Valid: ["eq", "not_eq"]');
  await invalidFilter(swap('folder_status', { field: 'folder_status', op: 'contains', value: '1' }), 'Invalid operator \'contains\' for field \'folder_status\' (archivable_status). Valid: ["eq", "not_eq"]');
  // A number for a value: serde can't read the group, and reads the object as a flat filter instead.
  const numbered = await invalidFilter(swap('project.status', { field: 'project.status', op: 'eq', value: 1 }), /^Unknown filter field 'conditions' on tasks\./);
  expect(numbered[1]).toMatch(/^Unknown filter field 'op' on tasks\./);
  const notJson = ['query', 'tasks', '--filter', '{'];
  const r = await callFake('tb-prod', notJson, decl);
  expect(r).toMatchObject({ stderr: '', code: 1, violations: violation(notJson, /^tb-prod can't read its --filter \(invalid_json\): Invalid filter JSON: /) });
  expect(JSON.parse(r.stdout)).toMatchObject({ code: 'invalid_json' });

  // tb-prod would run these, but the fake can't tell what they'd return: refused in its own words.
  const refused = async (argv: string[], why: RegExp) => {
    expect(await callFake('tb-prod', argv, decl), argv.join(' ')).toEqual({
      stdout: '',
      stderr: expect.stringMatching(/^fake tb-prod: refused `tb-prod query tasks .*`: /),
      code: 2,
      violations: violation(argv, why),
    });
  };
  await refused(query(work.filter((c) => c.field !== 'workflow_status_category_id')), /^its --filter isn't WORK's/);
  await refused(query([...work, { field: 'due_date', op: 'lt', value: '2026-11-01' }]), /^its --filter isn't WORK's/);
  await refused(['query', 'tasks', '--filter', JSON.stringify({ 'assignee.email': ME })], /^its --filter isn't WORK's/);
  // tb-prod has no default sort for Tasks: without WORK's, Productive picks the order, and WORK's 5 pages could miss the newest.
  const sorted = '--sort=-last_activity_at';
  await refused(query(work, '--include=project'), /^it has no --sort, so Productive would pick the order; WORK sorts by -last_activity_at$/);
  await refused(query(work, '--sort=last_activity_at'), /^it sorts by "last_activity_at"; the fake answers only WORK's sort, -last_activity_at$/);
  await refused(query(work, '--sort=-due_date'), /^it sorts by "-due_date"/);
  await refused(query(work, sorted, '--include=assignee'), /^it can't include assignee/);
  await refused(query(work, sorted, '--page=0'), /^--page 0: pages start at 1/);

  // Without a config, tb-prod stops before it reads the filter: that's what it prints, and it's still a violation.
  const noConfig = query(swap('folder_status', { field: 'board_status', op: 'eq', value: '1' }));
  expect(await callFake('tb-prod', noConfig, checkTbProd({ failure: 'no-config' }))).toMatchObject({
    stdout: '',
    stderr: expect.stringMatching(/^Error: Config error: No config found\./),
    code: 1,
    violations: violation(noConfig, /^tb-prod rejects its --filter \(invalid_filter\): Unknown filter field 'board_status'/),
  });
});

/**
 * A board tb-pr 0.3.1 prints: Review requests' search was rate limited, so the list of an earlier
 * fetch is put back (`restored_from`); the reviewed-by search too, with no list to put back.
 */
const prBoard = (restoredFrom: string): TbPrBoardDecl => ({
  user: 'dafilipaj',
  columns: {
    draft_mine: [{ number: 812, repo: 'api', title: 'Fix rounding in rates', check_state: 'success', head_branch: 'fix/12345678-rounding', task_ids: [{ id: '12345678', source: 'branch' }] }],
    ready_to_merge_mine: [{ number: 77, repo: 'web', title: 'Ready one', age_days: 6, rotting: 'stale' }],
    waiting_on_me: [{ number: 90, repo: 'web', title: 'Review me', author: 'teammate' }],
  },
  column_issues: [
    { column: 'waiting_on_me', reason: 'rate limited', restored_from: restoredFrom },
    { column: 'waiting_on_author', reason: 'rate limited' },
  ],
});
const declaredRestoredFrom = minutesAgo(20);

scenario(
  'TEST-1.5: the fake tb-pr answers list --json with the declared board, with or without task_ids, and refresh with its exit code',
  world().tbPr({ board: prBoard(declaredRestoredFrom) }),
  async ({ world }) => {
    const list = await world.run('tb-pr', ['list', '--json']);
    expect(list.code, list.stderr).toBe(0);
    const board = JSON.parse(list.stdout);
    expect(board).toMatchObject({ user: 'dafilipaj' });
    expect(board.column_issues).toEqual([
      { column: 'waiting_on_me', reason: 'rate limited', restored_from: declaredRestoredFrom },
      { column: 'waiting_on_author', reason: 'rate limited' },
    ]);
    expect(Date.now() - Date.parse(board.fetched_at)).toBeLessThan(10_000);
    expect(Object.keys(board.columns)).toEqual(['draft_mine', 'review_mine', 'ready_to_merge_mine', 'waiting_on_me', 'waiting_on_author', 'notifications']);
    expect(board.columns.draft_mine).toEqual([
      {
        number: 812,
        repo: 'api',
        title: 'Fix rounding in rates',
        url: 'https://github.com/productiveio/api/pull/812',
        author: 'dafilipaj',
        state: 'draft',
        created_at: expect.any(String),
        age_days: 1,
        size: null,
        rotting: 'fresh',
        comments_count: 0,
        base_branch: 'develop',
        head_branch: 'fix/12345678-rounding',
        check_state: 'success',
        task_ids: [{ id: '12345678', source: 'branch' }],
      },
    ]);
    // The column sets the state chip; a PR without Task links still has `task_ids`, empty, and no CI state.
    expect(board.columns.ready_to_merge_mine[0]).toMatchObject({ state: 'approved', age_days: 6, rotting: 'stale', task_ids: [] });
    expect(board.columns.ready_to_merge_mine[0]).not.toHaveProperty('check_state');
    expect(board.columns.waiting_on_me[0]).toMatchObject({ state: 'ready', author: 'teammate', task_ids: [] });
    // `--json` is a global flag: before the subcommand, too.
    expect(JSON.parse((await world.run('tb-pr', ['--json', 'list'])).stdout).columns.draft_mine[0].number).toBe(812);

    // tb-pr's summary gives a put-back list's age at the moment of the call (`humanize_age_hours`).
    world.tbPr.answer({ board: prBoard(minutesAgo(40)) });
    expect(await world.run('tb-pr', ['refresh'])).toEqual({
      stdout: 'refreshed 3 PR(s) — draft=1 review=0 ready=1 wait-me=1 wait-au=0\n',
      stderr: '⚠ partial fetch — wait-me (rate limited, showing the list from 40m ago), wait-au (rate limited)\n',
      code: 0,
    });

    // A tb-pr from before Gap 1: no PR has `task_ids`. And a refresh that fails.
    world.tbPr.answer({ board: { withTaskIds: false, columns: { review_mine: [{ number: 5, repo: 'api', title: 'Old' }] } }, refreshExit: 1 });
    const old = JSON.parse((await world.run('tb-pr', ['list', '--json'])).stdout);
    expect(old.columns.review_mine).toEqual([expect.objectContaining({ number: 5, state: 'ready', author: 'world-tester' })]);
    expect(old.columns.review_mine[0]).not.toHaveProperty('task_ids');
    expect(old).not.toHaveProperty('column_issues');
    const refresh = await world.run('tb-pr', ['refresh']);
    expect(refresh).toMatchObject({ stdout: '', code: 1 });
    expect(refresh.stderr).toMatch(/^Error: /);
  },
);

scenario(
  'TEST-1.5: the fake tb-pr fails as declared: gh auth token, a 401, rate limited with or without a reset time, a timeout',
  world().tbPr({ board: { columns: { draft_mine: [{ number: 1, repo: 'api', title: 'One' }] } }, failure: 'gh-auth' }),
  async ({ world }) => {
    const fails = async (stderr: string) => {
      for (const argv of [['list', '--json'], ['refresh']]) {
        expect(await world.run('tb-pr', argv), argv.join(' ')).toEqual({ stdout: '', stderr, code: 1 });
      }
    };
    await fails('Error: `gh auth token` failed — run `gh auth login`\n');
    world.tbPr.answer({ failure: 401 });
    await fails('Error: GitHub API error (401): {"message":"Bad credentials","documentation_url":"https://docs.github.com/rest","status":"401"}\n');
    world.tbPr.answer({ failure: 'rate-limited' });
    await fails('Error: GitHub API error (429): rate limited. Run `tb-pr refresh` later or widen TTL.\n');
    world.tbPr.answer({ failure: { rateLimitedUntil: '2026-10-19T14:05:09Z' } });
    await fails('Error: GitHub API error (403): rate limited — resets at 14:05:09 UTC. Run `tb-pr refresh` later or widen TTL.\n');
    world.tbPr.answer({ failure: 'timeout' });
    await expectTimeout(world.run('tb-pr', ['refresh'], { timeoutMs: 5000 }), () => world.tbPr.hanging(), ['refresh']);
  },
);

scenario('TEST-1.5: a World with a git identity has it in ~/.gitconfig', world().gitIdentity({ name: 'World "Tester" O\'Neil', email: 'tester@example.com' }), async ({ world }) => {
  const git = async (...args: string[]) => (await world.run('git', ['config', '--global', ...args])).stdout;
  expect(await git('user.email')).toBe('tester@example.com\n');
  expect(await git('user.name')).toBe('World "Tester" O\'Neil\n');
  expect(await git('--list')).toBe('user.name=World "Tester" O\'Neil\nuser.email=tester@example.com\n');
  expect(readFileSync(join(world.home, '.gitconfig'), 'utf8')).toContain('[user]');
});

test('TEST-1.5: a declaration the World cannot build is refused when it is made', () => {
  expect(() => world().gitIdentity({ name: 'Two\nlines', email: 'a@example.com' })).toThrow(/gitIdentity\(\): name must be one non-empty line/);
  expect(() => world().gitIdentity({ name: 'A', email: '' })).toThrow(/email must be one non-empty line/);
  expect(() => world().tbProd({ tasks: { [ME]: [{ id: 'abc', title: 'T', project: 'P' }] } })).toThrow(/a Task's id is digits only/);
  expect(() => world().tbProd({ failure: 500 as never })).toThrow(/unknown failure 500/);
  expect(() => world().tbPr({ board: { columns: { mentions: [] } as never } })).toThrow(/unknown column mentions/);
  expect(() => world().tbPr({ board: { columns: { draft_mine: [{ number: 1, repo: 'productiveio/api', title: 'T' }] } } })).toThrow(/bare repo name/);
  expect(() => world().tbPr({ board: { withTaskIds: false, columns: { draft_mine: [{ number: 1, repo: 'api', title: 'T', task_ids: [] }] } } })).toThrow(/withTaskIds: false/);
  expect(() => world().tbPr({ refreshExit: 300 })).toThrow(/refreshExit/);
  // A board tb-pr 0.3.1 never prints (`merge_with_previous`).
  const pr = { number: 1, repo: 'api', title: 'T' };
  const flagged = (column_issues: TbPrBoardDecl['column_issues'], columns: TbPrBoardDecl['columns'] = { waiting_on_me: [pr] }) => () => world().tbPr({ board: { columns, column_issues } });
  expect(flagged([{ column: 'waiting_on_me', reason: 'rate limited' }])).toThrow(/waiting_on_me has PRs and the issue "rate limited" but no restored_from/);
  expect(flagged([{ column: 'waiting_on_me', reason: 'search returned empty' }])).toThrow(/but no restored_from/);
  expect(flagged([{ column: 'waiting_on_author', reason: 'rate limited', restored_from: minutesAgo(5) }])).toThrow(/waiting_on_author has restored_from but no PRs/);
  expect(flagged([{ column: 'mentions', reason: 'api error 403', restored_from: minutesAgo(5) }])).toThrow(/mentions has restored_from but no PRs/);
  // Times as tb-pr prints them, RFC 3339 in UTC (chrono's `DateTime<Utc>`), and as Productive gives them, RFC 3339.
  for (const time of ['an hour ago', '2026-10-19 14:00', 'Oct 19 2026', '2026-10-19T14:00:00', '2026-10-19T14:00:00+02:00', '2026-13-01T00:00:00Z', '2026-02-30T14:00:00Z', '2026-04-31T14:00:00Z', '2026-02-29T14:00:00Z', '2100-02-29T14:00:00Z']) {
    expect(flagged([{ column: 'waiting_on_me', reason: 'rate limited', restored_from: time }]), time).toThrow(/restored_from is an RFC 3339 time in UTC/);
    expect(() => world().tbPr({ board: { fetched_at: time } }), time).toThrow(/fetched_at is an RFC 3339 time in UTC/);
    expect(() => world().tbPr({ board: { columns: { draft_mine: [{ ...pr, created_at: time }] } } }), time).toThrow(/created_at is an RFC 3339 time in UTC/);
    expect(() => world().tbPr({ failure: { rateLimitedUntil: time } }), time).toThrow(/unknown failure/);
  }
  for (const time of ['an hour ago', '2026-10-19 14:00', 'Oct 19 2026', '2026-10-19T14:00:00', '2026-02-30T14:00:00Z', '2026-09-31T14:00:00+02:00']) {
    expect(() => world().tbProd({ tasks: { [ME]: [{ id: '1', title: 'T', project: 'P', lastActivityAt: time }] } }), time).toThrow(/lastActivityAt is an RFC 3339 time/);
  }
  expect(() => world().tbPr({ board: { fetched_at: '2026-10-19T14:00:00.123456789Z', columns: { draft_mine: [{ ...pr, created_at: '2026-10-18T09:30:00Z' }] } }, failure: { rateLimitedUntil: '2026-10-19T15:00:00Z' } })).not.toThrow();
  expect(() => world().tbProd({ tasks: { [ME]: [{ id: '1', title: 'T', project: 'P', lastActivityAt: '2026-10-19T14:00:00.000+02:00' }] } })).not.toThrow();
  // A day the month has: February 29 only in a leap year.
  for (const time of ['2028-02-29T14:00:00Z', '2000-02-29T14:00:00Z', '2026-12-31T23:59:59Z']) {
    expect(() => world().tbPr({ board: { fetched_at: time } }), time).not.toThrow();
    expect(() => world().tbProd({ tasks: { [ME]: [{ id: '1', title: 'T', project: 'P', lastActivityAt: time, dueDate: time.slice(0, 10) }] } }), time).not.toThrow();
  }
  for (const day of ['2026-02-29', '2026-06-31', '2026-10-00', '2026-1-05']) {
    expect(() => world().tbProd({ tasks: { [ME]: [{ id: '1', title: 'T', project: 'P', dueDate: day }] } }), day).toThrow(/dueDate is YYYY-MM-DD/);
  }
  expect(flagged([{ column: 'waiting_on_me', reason: 'rate limited', restored_from: minutesAgo(61) }])).toThrow(/within the hour before fetched_at and now/);
  expect(flagged([{ column: 'waiting_on_me', reason: 'rate limited', restored_from: minutesAgo(-1) }])).toThrow(/within the hour/);
  expect(
    flagged([
      { column: 'waiting_on_me', reason: 'rate limited', restored_from: minutesAgo(5) },
      { column: 'waiting_on_me', reason: 'search incomplete' },
    ]),
  ).toThrow(/two column_issues entries/);
  // "search returned empty": no search returned a PR, so no column has a list of its own.
  expect(flagged([{ column: 'waiting_on_me', reason: 'search returned empty', restored_from: minutesAgo(5) }], { draft_mine: [pr], waiting_on_me: [pr] })).toThrow(
    /draft_mine has PRs of its own next to "search returned empty"/,
  );
  // One search feeds review_mine and ready_to_merge_mine, so an error or an incomplete search flags both alike.
  expect(flagged([{ column: 'review_mine', reason: 'rate limited' }], {})).toThrow(/review_mine has the issue "rate limited" but ready_to_merge_mine has none: one search feeds both/);
  expect(flagged([{ column: 'ready_to_merge_mine', reason: 'search incomplete' }], {})).toThrow(/ready_to_merge_mine has the issue "search incomplete" but review_mine has none/);
  expect(flagged([{ column: 'review_mine', reason: 'rate limited' }, { column: 'ready_to_merge_mine', reason: 'server error 503' }], {})).toThrow(
    /review_mine has the issue "rate limited" but ready_to_merge_mine has "server error 503"/,
  );
  expect(flagged([{ column: 'review_mine', reason: 'search incomplete' }, { column: 'ready_to_merge_mine', reason: 'search returned empty' }], {})).toThrow(
    /review_mine has the issue "search incomplete" but ready_to_merge_mine has "search returned empty"/,
  );
  // "search returned empty" alone may stay on one of them: tb-pr drops it where the board before had no list.
  expect(flagged([{ column: 'review_mine', reason: 'search returned empty' }], {})).not.toThrow();
  // What 0.3.1 does print: an incomplete search's own list, and an outage's lists all put back.
  expect(flagged([{ column: 'review_mine', reason: 'search incomplete' }, { column: 'ready_to_merge_mine', reason: 'search incomplete' }], { review_mine: [pr] })).not.toThrow();
  expect(
    flagged(
      [
        { column: 'draft_mine', reason: 'search returned empty', restored_from: minutesAgo(5) },
        { column: 'waiting_on_me', reason: 'search returned empty', restored_from: minutesAgo(50) },
        { column: 'waiting_on_author', reason: 'search returned empty' },
      ],
      { draft_mine: [pr], waiting_on_me: [pr] },
    ),
  ).not.toThrow();
  // What a test declares is its own: one World's declaration can't change another's.
  const base = world().tbProd({ tasks: { [ME]: [] } });
  base.tbProd({ failure: 401 });
  expect(base.declaration()).toMatchObject({ tbProd: { tasks: { [ME]: [] } }, tbPr: null, gitIdentity: null });
});

scenario(
  'TEST-1.6: a test changes what the fake tb-prod and tb-pr answer from their next call on',
  world()
    .tbProd({ tasks: { [ME]: [{ id: '1', title: 'Before', project: 'Acme' }] } })
    .tbPr({ board: { columns: { draft_mine: [{ number: 1, repo: 'api', title: 'Before' }] } } }),
  async ({ world }) => {
    const prTitles = async () => (JSON.parse((await world.run('tb-pr', ['list', '--json'])).stdout).columns.draft_mine as { title: string }[]).map((p) => p.title);
    expect(titles(await world.run('tb-prod', tasksQuery(ME)))).toEqual(['Before']);
    expect(await prTitles()).toEqual(['Before']);

    world.tbProd.answer({ tasks: { [ME]: [{ id: '2', title: 'After', project: 'Acme' }] } });
    world.tbPr.answer({ board: { columns: { draft_mine: [{ number: 2, repo: 'api', title: 'After' }] } } });
    expect(titles(await world.run('tb-prod', tasksQuery(ME)))).toEqual(['After']);
    expect(await prTitles()).toEqual(['After']);

    // From an answer to a failure after a good read, as WORK-7.3's test does.
    world.tbProd.answer({ failure: 403 });
    world.tbPr.answer({ failure: 'gh-auth' });
    expect((await world.run('tb-prod', tasksQuery(ME))).code).toBe(1);
    expect((await world.run('tb-pr', ['refresh'])).stderr).toContain('`gh auth token`');
    // A new answer is checked as a declaration is.
    expect(() => world.tbPr.answer({ failure: 'nope' as never })).toThrow(/unknown failure "nope"/);
  },
);

scenario(
  'TEST-1.6: a test holds a fake call in flight until it releases it, and the call answers what it read when it started',
  world().tbProd({ tasks: { [ME]: [{ id: '1', title: 'Read at the start', project: 'Acme' }] } }).tbPr(),
  async ({ world }) => {
    world.tbProd.hold();
    const held = world.run('tb-prod', tasksQuery(ME));
    let answered = false;
    void held.then(() => (answered = true));
    expect(await world.tbProd.held()).toEqual(tasksQuery(ME));

    // While it is held: a new answer, which the next call gets at once, unheld.
    world.tbProd.answer({ tasks: { [ME]: [{ id: '2', title: 'Changed meanwhile', project: 'Acme' }] } });
    expect(titles(await world.run('tb-prod', tasksQuery(ME)))).toEqual(['Changed meanwhile']);
    expect(answered).toBe(false);
    expect(() => world.tbProd.hold()).toThrow(/already held: release\(\) it first/);

    world.tbProd.release();
    expect(titles(await world.step('the held call to answer', () => held))).toEqual(['Read at the start']);

    // A hold no call took is dropped by its release.
    world.tbProd.hold();
    world.tbProd.release();
    expect(titles(await world.run('tb-prod', tasksQuery(ME)))).toEqual(['Changed meanwhile']);
    expect(() => world.tbProd.release()).toThrow(/No tb-prod call is held/);

    // tb-pr's the same way.
    world.tbPr.hold();
    const refresh = world.run('tb-pr', ['refresh']);
    expect(await world.tbPr.held()).toEqual(['refresh']);
    world.tbPr.release();
    expect((await world.step('the held refresh to answer', () => refresh)).code).toBe(0);
    expect(world.violations()).toEqual([]);
  },
);

scenario('TEST-1.6: the controls of a fake the World does not declare say how to declare it', world().tbProd(), async ({ world }) => {
  expect(() => world.tbPr.answer({})).toThrow('This World has no tb-pr: declare it with world().tbPr(…).');
  expect(() => world.tbPr.hold()).toThrow(/declare it with world\(\)\.tbPr/);
  expect(() => world.tbPr.calls()).toThrow(/declare it with world\(\)\.tbPr/);
  expect((await world.run('bash', ['-c', 'type -P tb-pr || echo absent'])).stdout.trim()).toBe('absent');
});

scenario(
  "TEST-1.7: the World aborts and lists every browser request outside its Lookout origin, popups and new tabs included",
  world(),
  async ({ page, world }) => {
    // Lookout itself loads through the guard, and asks for nothing outside its origin.
    await world.step('Lookout to list Sessions', () => expect(page.getByRole('complementary', { name: 'Session sidebar' }).getByText('No live Sessions')).toBeVisible());
    expect(world.browserRequests()).toEqual([]);
    expect(await page.evaluate(() => fetch('/api/bootstrap').then((r) => r.status))).toBe(200);

    const context = page.context();
    const failed: string[] = [];
    context.on('requestfailed', (r) => failed.push(`${r.failure()?.errorText} ${r.url()}`));
    const task = 'https://app.fantastic.productive.io/109-productive/tasks/12345';
    const pr = 'https://github.com/productiveio/api/pull/812';
    const api = 'https://api.github.com/user';
    const avatar = 'https://avatars.githubusercontent.com/u/1';
    const socket = 'wss://example.com/socket';
    // The same server under another name is another origin.
    const otherOrigin = `http://localhost:${world.port}/api/bootstrap`;
    const refused = (url: string) => world.waitUntil(`the request for ${url} to be refused`, () => world.browserRequests().includes(url));

    // Lookout's CSP keeps its page's own fetches and images to its origin, but not where a link or
    // window.open takes a new tab: a new tab from a link, as WORK-6's "Open in browser" opens one,
    // and a popup.
    await page.evaluate((href) => {
      const a = Object.assign(document.createElement('a'), { href, target: '_blank', rel: 'noopener noreferrer', textContent: 'Open in Fantastic' });
      a.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647';
      document.body.append(a);
    }, task);
    const tab = context.waitForEvent('page');
    await page.getByRole('link', { name: 'Open in Fantastic' }).click();
    expect(await tab).not.toBe(page);
    await refused(task);
    const popup = context.waitForEvent('page');
    await page.evaluate((u) => void window.open(u), pr);
    await popup;
    await refused(pr);

    // Any page of the test, one without Lookout's CSP too: a fetch, an image, a WebSocket, and a page
    // of the same server under another name.
    const blank = await context.newPage();
    expect(await blank.evaluate((u) => fetch(u).then(() => 'loaded', (e: Error) => e.message), api)).toBe('Failed to fetch');
    expect(await blank.evaluate((u) => new Promise((resolve) => Object.assign(new Image(), { onload: () => resolve('loaded'), onerror: () => resolve('refused'), src: u })), avatar)).toBe('refused');
    expect(await blank.evaluate((u) => new Promise((resolve) => Object.assign(new WebSocket(u), { onclose: (e: CloseEvent) => resolve(e.code) })), socket)).toBe(1008);
    expect(await blank.goto(otherOrigin).then(() => 'loaded', (e: Error) => e.message)).toContain('net::ERR_BLOCKED_BY_CLIENT');

    expect(world.browserRequests()).toEqual([task, pr, api, avatar, socket, otherOrigin]);
    // Aborted by the World, not failed on the way: nothing left the browser. Chromium reports a
    // subresource it blocked as `….Inspector`; a WebSocket isn't a request.
    await world.waitUntil('each refused request to be reported as failed', () => failed.length === 5);
    const blocked = failed.map((f) => /^net::ERR_BLOCKED_BY_CLIENT(?:\.Inspector)? (\S+)$/.exec(f)?.[1] ?? f);
    expect(blocked.sort()).toEqual([task, pr, api, avatar, otherOrigin].sort());
    // Lookout's own origin still passes.
    expect(await page.evaluate(() => fetch('/api/bootstrap').then((r) => r.status))).toBe(200);
  },
);

scenario("TEST-1.7: a World's pages can't register a service worker, whose requests the World's route would not see", world(), async ({ page, world }) => {
  // A worker script on the World's own origin, so only the browser's policy can stop it.
  const script = new URL('/world-sw.js', world.url).href;
  await page.context().route(script, (route) => route.fulfill({ contentType: 'text/javascript', body: "self.addEventListener('fetch', () => {});" }));
  const registered = await page.evaluate(async (url) => {
    const registration = await navigator.serviceWorker.register(url).then(
      (r: ServiceWorkerRegistration | undefined) => (r ? `registered ${r.scope}` : 'nothing registered'),
      (e: Error) => `refused: ${e.message}`,
    );
    return { registration, registrations: (await navigator.serviceWorker.getRegistrations()).length };
  }, script);
  // Playwright's `serviceWorkers: 'block'` (e2e/playwright.config.ts) answers the registration with nothing.
  expect(registered).toEqual({ registration: 'nothing registered', registrations: 0 });
  expect(world.browserRequests()).toEqual([]);
});

test('TEST-1.7: until the World says which origin is its own, its guard lets nothing through', async ({ browser }) => {
  const server = createServer((_req, res) => res.end('ok'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const context = await browser.newContext();
  try {
    const guard = new BrowserGuard();
    await guard.watch(context);
    const before = await context.newPage();
    expect(await before.goto(url).then(() => 'loaded', (e: Error) => e.message)).toContain('net::ERR_BLOCKED_BY_CLIENT');
    guard.allow(new URL(url).origin);
    expect((await (await context.newPage()).goto(url))?.status()).toBe(200);
    expect(guard.requests()).toEqual([url]);
    expect(guard.escapes()).toEqual([]);
  } finally {
    await context.close();
    server.close();
  }
});

scenario(
  'TEST-2.4: a stopped World reports every answer its fakes had, as the test changed them, and the calls they refused until it stopped',
  world(),
  async () => {
    const label = 'TEST-2.4 (the inner World of a stopped World with fakes)';
    const inner = await startWorld(world().tbProd({ tasks: { [ME]: [] } }).tbPr().declaration(), { label });
    let stopped: StopReport | undefined;
    try {
      inner.tbProd.answer({ failure: 403 });
      expect((await inner.run('tb-prod', ['create', 'tasks'])).code).toBe(2);
      stopped = await inner.stop({ collect: true });
      const at = expect.stringMatching(/^\d\d:\d\d:\d\d$/);
      expect(JSON.parse(stopped.report?.fakes ?? 'null')).toEqual({
        'tb-prod': [
          { at, answer: { tasks: { [ME]: [] } } },
          { at, answer: { failure: 403 } },
        ],
        'tb-pr': [{ at, answer: {} }],
      });
      // Read once nothing of the World ran any more, before its directory, and the log in it, went.
      expect(stopped.violations).toEqual([{ command: 'tb-prod', argv: ['create', 'tasks'], why: 'only `query tasks` is answered' }]);
      expect(existsSync(inner.root)).toBe(false);
      expect(stopped.leftovers).toEqual([]);
    } finally {
      if (!stopped) recordLeftovers(label, (await inner.stop()).leftovers);
    }
  },
);

for (const collect of [false, true]) {
  scenario(
    collect
      ? 'TEST-2.4: a call a fake refuses while the World stops is in the report collected before it stopped, which keeps its panes'
      : 'TEST-2.4: a call a fake refuses while the World stops fails the test with its report, though the test was not known to fail before',
    world(),
    async ({ world: outer }) => {
      const label = `TEST-2.4 (the inner World whose process calls tb-prod as it stops, ${collect ? 'collected' : 'not collected'})`;
      const inner = await startWorld(world().tbProd({ tasks: { [ME]: [] } }).declaration(), { label });
      let stopped: StopReport | undefined;
      try {
        // A World process that calls the fake only once teardown sends it SIGTERM, as Lookout's poller
        // could while its server stops. Node, not a shell: macOS hides an Apple binary's environment,
        // so a `bash` the test starts directly would carry no visible token and never be the World's.
        const ready = join(inner.home, 'trap-set');
        const script = [
          "const { spawnSync } = require('node:child_process');",
          "process.on('SIGTERM', () => process.exit(spawnSync('tb-prod', ['create', 'tasks'], { stdio: 'ignore' }).status === 2 ? 0 : 1));",
          `require('node:fs').writeFileSync(${JSON.stringify(ready)}, '');`,
          'setInterval(() => {}, 1000);',
        ].join('\n');
        const trapped = inner.run('node', ['-e', script], { timeoutMs: 20_000 });
        await outer.waitUntil('the TERM trap to be set', () => existsSync(ready));
        expect(inner.violations()).toEqual([]);

        // Collected: the panes are captured before the World stops, its files read again once it has.
        // Not collected: nothing had failed when the World was told to stop.
        stopped = await inner.stop({ collect });
        expect((await trapped).code).toBe(0);
        expect(stopped.violations).toEqual([{ command: 'tb-prod', argv: ['create', 'tasks'], why: 'only `query tasks` is answered' }]);
        // The report is read before the World's directories go; without collecting, with no panes, which went first.
        expect(stopped.report).toEqual({
          declaration: expect.stringContaining('"tbProd"'),
          serverLog: expect.stringContaining('Lookout server on http://127.0.0.1:'),
          calls: expect.stringMatching(/^\d\d:\d\d:\d\d tb-prod create tasks$/m),
          panes: collect ? expect.not.stringMatching(/^\((?:World stopped|could not read)/) : expect.stringMatching(/^\(World stopped/),
          fakes: expect.stringContaining('"tb-prod"'),
        });
        expect(existsSync(inner.root)).toBe(false);
        expect(stopped.leftovers).toEqual([]);
      } finally {
        if (!stopped) recordLeftovers(label, (await inner.stop()).leftovers);
      }
    },
  );
}
