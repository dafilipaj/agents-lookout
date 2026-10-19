import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { TB_PR_INSTALL_COMMAND } from '../shared/defaults.ts';
import {
  CHIP_OF,
  type CiState,
  type ColumnMark,
  MINE_COLUMNS,
  PR_COLUMNS,
  type PrColumn,
  type PrSection,
  type PrTaskRef,
  REVIEW_COLUMNS,
  ROT_BUCKETS,
  type RotBucket,
  type WorkPr,
  type WorkRefreshResult,
  type WorkSnapshot,
  type WorkSourceState,
} from '../shared/work.ts';
import type { RunError, RunOptions, Runner } from './exec.ts';
import { cleanEnv } from './launcher.ts';
import { sanitizeLine } from './sanitize.ts';

/**
 * WORK: open PRs and Review requests through `tb-pr` (decision 0005), contract in
 * docs/features/tasks-and-prs/SPEC.md, "Sources" and "Lookout's side". Everything tb-pr prints is
 * validated and bounded here; every failure becomes a redacted one-line reason here, and nothing
 * here logs or rethrows a `RunError` (WORK-7.7). Tasks (`tb-prod`) join in slice C as a second
 * source with its own `ReadLane`.
 */

/** WORK-8.1: reads every 5 minutes, counted from the end of the last read. */
export const WORK_INTERVAL_MS = 5 * 60_000;
/** WORK-8.2: a forced read is refused for this long after the server accepted one. */
export const WORK_COOLDOWN_MS = 60_000;
/** A cold fetch takes several seconds (Sources). */
export const TB_PR_TIMEOUT_MS = 20_000;
/** WORK-8.4: a rate limit holds GitHub reads at least this long… */
export const RATE_LIMIT_MIN_MS = 5 * 60_000;
/** …and at most this long, GitHub's core window. */
export const RATE_LIMIT_MAX_MS = 60 * 60_000;
const DAY_MS = 86_400_000;
const MAX_TITLE = 300;
const MAX_URL = 500;

// --- Binaries and the argv allowlist (WORK-5.3) -------------------------------------------------

export type WorkTool = 'tb-pr' | 'tb-prod';
const BIN_ENV: Record<WorkTool, string> = { 'tb-pr': 'LOOKOUT_TB_PR_BIN', 'tb-prod': 'LOOKOUT_TB_PROD_BIN' };

/**
 * Finds `tb-pr` or `tb-prod` like tb-session: `LOOKOUT_TB_PR_BIN` / `LOOKOUT_TB_PROD_BIN`, then
 * PATH, then `~/.local/bin` (where cli-toolbox installs them; a server started by launchd has a
 * short PATH). Unfound, the bare name: running it fails with ENOENT, "not installed" (WORK-7.1).
 */
export function resolveWorkBin(tool: WorkTool, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[BIN_ENV[tool]];
  if (override) return override;
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  dirs.push(join(env.HOME || homedir(), '.local', 'bin'));
  for (const dir of dirs) {
    const candidate = join(dir, tool);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return tool;
}

/**
 * WORK-5.3: the only commands Lookout runs against Productive and GitHub, all reads:
 * `tb-pr list --json`, `tb-pr refresh` and `tb-prod query tasks …`. Nothing from the browser
 * reaches an argv.
 */
export function isAllowedWorkCommand(tool: WorkTool, argv: readonly string[]): boolean {
  if (tool === 'tb-pr') {
    return (argv.length === 2 && argv[0] === 'list' && argv[1] === '--json') || (argv.length === 1 && argv[0] === 'refresh');
  }
  return argv[0] === 'query' && argv[1] === 'tasks';
}

/** A command outside the allowlist: never run. */
export class WorkCommandRefused extends Error {}

/** Runs an allowlisted command; anything else is refused before a process starts. */
export function runWorkCommand(runner: Runner, tool: WorkTool, bin: string, argv: readonly string[], opts: RunOptions): Promise<string> {
  if (!isAllowedWorkCommand(tool, argv)) {
    return Promise.reject(new WorkCommandRefused(`Lookout runs only read commands; refused ${tool} ${argv[0] ?? ''}`.trim()));
  }
  return runner(bin, argv, opts);
}

// --- Reading `tb-pr list --json` (WORK-3) -------------------------------------------------------

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * tb-pr printed something that isn't 0.3.1's `list --json` board, or a PR in it Lookout can't read.
 * `detail` says what, for the server's log only (WORK-7.7): the reason shown is a plain sentence.
 */
export class TbPrShapeError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(detail);
    this.detail = detail;
  }
}

/** tb-pr's PR columns (`PR_COLUMNS` in its `core/github.rs`), the four shown plus waiting-on-author. */
const TB_PR_PR_COLUMNS = [...PR_COLUMNS, 'waiting_on_author'] as const;
const ISSUE_COLUMNS: readonly string[] = [...TB_PR_PR_COLUMNS, 'mentions'];

export interface PrColumnIssue {
  /** One of tb-pr's columns, `waiting_on_author` and `mentions` included. */
  column: string;
  /** Redacted, one line. */
  reason: string;
  restoredFrom: number | null;
}

/** What one `tb-pr list --json` says, validated. */
export interface PrBoard {
  fetchedAt: number | null;
  columns: Record<PrColumn, WorkPr[]>;
  issues: PrColumnIssue[];
  /** WORK-4.1: whether its PRs carry `task_ids`; null without PRs to tell by. */
  taskIds: boolean | null;
}

/** ANSI escapes (tb-pr colours `Error:` when it thinks it has a terminal). */
// eslint-disable-next-line no-control-regex -- matching escapes is the point
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g;
export const stripAnsi = (text: string): string => text.replace(ANSI, '');

/** A display text (a PR title): one line, no controls, bounded; not an error, so not redacted. */
function displayText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex -- strip controls
  const line = stripAnsi(v.normalize('NFKC')).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function rfc3339(v: unknown): number | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

const GITHUB = 'https://github.com/';

/** WORK-6.3: tb-pr's `url` when it starts with `https://github.com/` and is safe to open; else null. */
function githubUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > MAX_URL || !v.startsWith(GITHUB)) return null;
  // Nothing that could leave a URL or a tooltip: no whitespace, quotes, angle brackets or controls.
  // eslint-disable-next-line no-control-regex -- refuse controls
  if (/[\s"'<>\\`\u0000-\u001f\u007f]/.test(v)) return null;
  return v;
}

/** WORK-3.1: GitHub owners are case-insensitive. */
const inProductiveio = (url: string) => (url.slice(GITHUB.length).split('/')[0] ?? '').toLowerCase() === 'productiveio';

/**
 * WORK-6.3: tb-pr's `url`, accepted only when it starts with `https://github.com/`; WORK-3.1: and
 * only in `productiveio/*`. Returns the URL as tb-pr gave it, or null.
 */
export function acceptPrUrl(v: unknown): string | null {
  const url = githubUrl(v);
  return url && inProductiveio(url) ? url : null;
}

const CI: Record<string, CiState> = { success: 'passing', failure: 'failing', pending: 'running' };

function readTaskIds(v: unknown): PrTaskRef[] | null {
  if (!Array.isArray(v)) return null;
  const out: PrTaskRef[] = [];
  for (const t of v) {
    if (!isObj(t) || typeof t.id !== 'string' || !/^[0-9]{1,20}$/.test(t.id) || (t.source !== 'branch' && t.source !== 'body')) continue;
    out.push({ id: t.id, source: t.source });
  }
  return out;
}

/**
 * One PR of a column. Null for a PR under another owner, which is left out (WORK-3.1). Any other PR
 * Lookout can't read, without a number, a repo or a GitHub URL, throws TbPrShapeError: a renamed
 * field must fail the read, never leave a PR silently missing (or Work saying "No open PRs").
 */
export function parsePr(raw: unknown, column: PrColumn): WorkPr | null {
  const unreadable = (what: string) => new TbPrShapeError(`a PR in ${column} ${what}`);
  if (!isObj(raw)) throw unreadable('is not an object');
  const number = raw.number;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) throw unreadable('has no number');
  if (typeof raw.repo !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(raw.repo)) throw unreadable(`(#${number}) has no repo`);
  const url = githubUrl(raw.url);
  if (!url) throw unreadable(`(#${number}) has no GitHub URL`);
  if (!inProductiveio(url)) return null;
  const age = typeof raw.age_days === 'number' && Number.isFinite(raw.age_days) && raw.age_days >= 0 ? raw.age_days : null;
  return {
    repo: raw.repo,
    number,
    title: displayText(raw.title, MAX_TITLE) ?? `#${number}`,
    url,
    createdAt: rfc3339(raw.created_at),
    ageDays: age,
    rotting: ROT_BUCKETS.includes(raw.rotting as RotBucket) ? (raw.rotting as RotBucket) : null,
    // WORK-3.3: anything but a known state, absence included, is "no CI", never passing.
    ci: typeof raw.check_state === 'string' ? (CI[raw.check_state] ?? 'none') : 'none',
    chip: column === 'waiting_on_me' ? null : CHIP_OF[column],
    column,
    taskIds: readTaskIds(raw.task_ids),
  };
}

/**
 * WORK-3.1: most urgent first, as tb-pr's own table sorts (`flatten` in `commands/list.rs`):
 * rotting bucket descending (critical first), then `age_days` descending; then repo and number,
 * which tb-pr leaves in GitHub's search order.
 */
export function byUrgency(a: WorkPr, b: WorkPr): number {
  const rank = (p: WorkPr) => (p.rotting === null ? -1 : ROT_BUCKETS.indexOf(p.rotting));
  return (
    rank(b) - rank(a) ||
    (b.ageDays ?? -1) - (a.ageDays ?? -1) ||
    (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0) ||
    a.number - b.number
  );
}

/**
 * `tb-pr list --json` (0.3.1, or later with `task_ids`), validated. Another shape, or a PR Lookout
 * can't read (`parsePr`), throws TbPrShapeError.
 */
export function parseTbPrList(stdout: string): PrBoard {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new TbPrShapeError("list --json didn't print JSON");
  }
  if (!isObj(parsed) || !isObj(parsed.columns)) throw new TbPrShapeError('list --json printed no columns');
  const raw = parsed.columns;
  const missing = PR_COLUMNS.find((c) => !Array.isArray(raw[c]));
  if (missing) throw new TbPrShapeError(`list --json has no ${missing} list`);

  const columns = Object.fromEntries(PR_COLUMNS.map((c) => [c, [] as WorkPr[]])) as Record<PrColumn, WorkPr[]>;
  let withIds = 0;
  let prs = 0;
  for (const c of PR_COLUMNS) {
    for (const item of raw[c] as unknown[]) {
      const pr = parsePr(item, c);
      // WORK-3.1: tb-pr searches one org; a PR under another owner is left out.
      if (!pr) continue;
      columns[c].push(pr);
      prs++;
      if (pr.taskIds !== null) withIds++;
    }
    columns[c].sort(byUrgency);
  }

  const issues: PrColumnIssue[] = [];
  if (parsed.column_issues !== undefined) {
    if (!Array.isArray(parsed.column_issues)) throw new TbPrShapeError('list --json has column_issues that are no list');
    for (const i of parsed.column_issues) {
      if (!isObj(i) || typeof i.column !== 'string' || !ISSUE_COLUMNS.includes(i.column)) continue;
      issues.push({ column: i.column, reason: sanitizeLine(stripAnsi(String(i.reason ?? '')), 80) ?? 'unknown issue', restoredFrom: rfc3339(i.restored_from) });
    }
  }
  return { fetchedAt: rfc3339(parsed.fetched_at), columns, issues, taskIds: prs === 0 ? null : withIds > 0 };
}

/** WORK-7.6: `column_issues` saying "api error 401" for every PR column: a revoked token with `username_override` set. */
export function every401(board: PrBoard): boolean {
  return TB_PR_PR_COLUMNS.every((c) => board.issues.some((i) => i.column === c && i.reason === 'api error 401'));
}

/** WORK-8.4: a `column_issues` reason of "rate limited" (a refused search or notifications page). */
export function boardRateLimited(board: PrBoard): boolean {
  return board.issues.some((i) => /rate limited/i.test(i.reason));
}

/**
 * WORK-7.5, UX "Errors": a `column_issues` reason in plain words. tb-pr's own labels
 * (`summarize_fetch_error` and `merge_with_previous` in its `core/github.rs`) never reach the UI.
 */
export function plainIssue(reason: string): string {
  const r = reason.trim().toLowerCase();
  if (r === 'search returned empty') return "GitHub's search came back empty";
  if (r === 'search incomplete') return "GitHub's search came back incomplete";
  if (/rate limited/.test(r)) return "GitHub's rate limit is used up";
  if (/^server error \d+$/.test(r)) return 'GitHub had a server error';
  if (r === 'api error 401') return 'GitHub refused the sign-in';
  if (r === 'api error 403') return 'GitHub refused access';
  if (/^api error \d+$/.test(r)) return 'GitHub refused the request';
  if (r === 'network error') return "GitHub couldn't be reached";
  return 'the read failed';
}

/** WORK-7.5: a group's columns with an issue, in plain words, those with the same reason and time in one entry. */
export function marksFor(columns: readonly PrColumn[], issues: readonly PrColumnIssue[], confirmed: ReadonlyMap<PrColumn, number>): ColumnMark[] {
  const marks: ColumnMark[] = [];
  for (const column of columns) {
    const issue = issues.find((i) => i.column === column);
    if (!issue) continue;
    const reason = plainIssue(issue.reason);
    const confirmedAt = confirmed.get(column) ?? null;
    const same = marks.find((m) => m.reason === reason && m.confirmedAt === confirmedAt);
    if (same) same.columns.push(column);
    else marks.push({ columns: [column], reason, confirmedAt });
  }
  return marks;
}

// --- Failures (WORK-7) and rate limits (WORK-8.4) ----------------------------------------------

export interface PrReadFailure {
  state: Exclude<WorkSourceState, 'loading' | 'ok'>;
  /** A plain sentence that says what to do (UX, "Errors"); never tb-pr's own text. */
  reason: string;
  fix: string | null;
  /** WORK-8.4: no GitHub read until then. */
  blockedUntil: number | null;
  /** What tb-pr said, redacted and one line, for the server's log only (WORK-7.7); null when there's nothing to add. */
  detail: string | null;
}

export const SIGN_IN_COMMAND = 'gh auth login';

/** UX, "Errors": why a PR read failed, and what to do, in plain words. */
export const PR_REASON = {
  notInstalled: "tb-pr isn't installed. Install it, then press Refresh.",
  signedOut: `tb-pr isn't signed in to GitHub. Run ${SIGN_IN_COMMAND}, then press Refresh.`,
  rateLimited: "GitHub's rate limit is used up. Work reads PRs again when it frees up.",
  serverError: 'GitHub had a server error. Try Refresh later.',
  refused: 'GitHub refused the request. Try Refresh later.',
  timedOut: 'tb-pr took too long to answer. Try Refresh later.',
  failed: "tb-pr couldn't read your PRs. Try Refresh later.",
  unreadable: "tb-pr printed PRs Lookout can't read. Check that tb-pr and Lookout are up to date, then press Refresh.",
  cancelled: 'The read was cancelled.',
  closed: 'Work was closed in every tab before the read began.',
} as const;

/**
 * WORK-8.4: until when a rate limit holds GitHub reads. With tb-pr's "resets at HH:MM:SS UTC" (a
 * time of day without a date), the moment with that time of day nearest to now; at least 5 minutes
 * and at most an hour from now. Without one, 5 minutes.
 */
export function rateLimitedUntil(text: string, now: number): number {
  const min = now + RATE_LIMIT_MIN_MS;
  const m = /resets at (\d{2}):(\d{2}):(\d{2}) UTC/.exec(text);
  if (!m) return min;
  const d = new Date(now);
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(m[1]), Number(m[2]), Number(m[3]));
  if (Number.isNaN(base)) return min;
  const nearest = [base - DAY_MS, base, base + DAY_MS].reduce((best, t) => (Math.abs(t - now) < Math.abs(best - now) ? t : best));
  return Math.min(Math.max(nearest, min), now + RATE_LIMIT_MAX_MS);
}

/**
 * Turns a failed `tb-pr` run into a plain reason (WORK-7, UX "Errors"). "Not signed in" exactly as
 * WORK-7.6 says: "`gh auth token`" in its error (gh not signed in, or not installed), or "GitHub API
 * error (401)". What tb-pr said goes only to `detail`, for the log: the redacted first line of
 * stderr; stdout is never looked at.
 */
export function classifyTbPrFailure(err: unknown, now: number): PrReadFailure {
  const e = (typeof err === 'object' && err !== null ? err : {}) as RunError;
  const stderr = stripAnsi(typeof e.stderr === 'string' ? e.stderr : '');
  const code = typeof e.code === 'number' ? e.code : null;
  const detail = sanitizeLine(stderr) ?? (code === null ? null : `exit ${code}`);
  const failure = (state: PrReadFailure['state'], reason: string, opts: Partial<Pick<PrReadFailure, 'fix' | 'blockedUntil' | 'detail'>> = {}): PrReadFailure => ({
    state,
    reason,
    fix: opts.fix ?? null,
    blockedUntil: opts.blockedUntil ?? null,
    detail: opts.detail === undefined ? detail : opts.detail,
  });
  // Lookout's own wording, not tb-pr's.
  if (err instanceof WorkCommandRefused) return failure('error', err.message, { detail: null });
  if (err instanceof TbPrShapeError) return failure('error', PR_REASON.unreadable, { detail: sanitizeLine(err.detail) });
  if (e.code === 'ENOENT') return failure('not-installed', PR_REASON.notInstalled, { fix: TB_PR_INSTALL_COMMAND, detail: null });
  if (e.aborted) return failure('error', PR_REASON.cancelled, { detail: null });
  if (e.timedOut) return failure('error', PR_REASON.timedOut, { detail: null });
  if (stderr.includes('`gh auth token`') || stderr.includes('GitHub API error (401)')) return failure('signed-out', PR_REASON.signedOut, { fix: SIGN_IN_COMMAND });
  if (/rate limited/i.test(stderr)) return failure('error', PR_REASON.rateLimited, { blockedUntil: rateLimitedUntil(stderr, now) });
  const status = /GitHub API error \((\d{3})\)/.exec(stderr)?.[1];
  if (status) return failure('error', Number(status) >= 500 ? PR_REASON.serverError : PR_REASON.refused);
  return failure('error', PR_REASON.failed);
}

// --- One read at a time per source (WORK-8.3) ---------------------------------------------------

/**
 * One read in flight per source, server-wide. A request joins the read in flight only when it asks
 * for the same thing (`same`); otherwise it waits until that read ends. Waiting requests run in the
 * order they arrived, those asking for the same thing as one read.
 */
export class ReadLane<A, R> {
  private current: { ask: A; done: Promise<R> } | null = null;
  private readonly queue: { ask: A; done: Promise<R>; start: () => void; drop: (result: R) => void }[] = [];
  private readonly read: (ask: A) => Promise<R>;
  private readonly same: (a: A, b: A) => boolean;

  constructor(read: (ask: A) => Promise<R>, same: (a: A, b: A) => boolean) {
    this.read = read;
    this.same = same;
  }

  get busy(): boolean {
    return this.current !== null;
  }

  /** Resolves when nothing is running or waiting. */
  async idle(): Promise<void> {
    while (this.current) await this.current.done.catch(() => {});
  }

  request(ask: A): Promise<R> {
    if (this.current && this.same(this.current.ask, ask)) return this.current.done;
    const waiting = this.queue.find((q) => this.same(q.ask, ask));
    if (waiting) return waiting.done;
    if (!this.current) return this.begin(ask);
    let start!: () => void;
    let drop!: (result: R) => void;
    const done = new Promise<R>((resolve, reject) => {
      start = () => void this.begin(ask).then(resolve, reject);
      drop = resolve;
    });
    this.queue.push({ ask, done, start, drop });
    return done;
  }

  /** Drops every waiting request, which answers with `result` without running; the read in flight runs on. */
  drop(result: R): void {
    for (const waiting of this.queue.splice(0)) waiting.drop(result);
  }

  private begin(ask: A): Promise<R> {
    const done = Promise.resolve()
      .then(() => this.read(ask))
      .finally(() => {
        this.current = null;
        this.queue.shift()?.start();
      });
    this.current = { ask, done };
    return done;
  }
}

// --- The monitor --------------------------------------------------------------------------------

export interface WorkMonitorOptions {
  runner: Runner;
  tbPrBin: () => string;
  onChange(work: WorkSnapshot): void;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** The server's log, for what tb-pr said (redacted, one line); never the UI's (WORK-7.7). */
  log?: (line: string) => void;
  intervalMs?: number;
  cooldownMs?: number;
  tbPrTimeoutMs?: number;
}

/** A PR read: forced runs `tb-pr refresh` first (WORK-8.2). */
interface PrAsk {
  forced: boolean;
}
type ReadResult = { ok: true } | { ok: false; reason: string };

/**
 * `refresh()`'s answer, with its HTTP status: refused while no tab has Work open (409), during the
 * cooldown or a rate limit (429), or the forced read's outcome (200).
 */
export interface RefreshAnswer {
  status: 200 | 409 | 429;
  result: WorkRefreshResult;
}

const emptyPrs = (): PrSection => ({
  state: 'loading',
  reason: null,
  fix: null,
  stale: false,
  fetchedAt: null,
  mine: [],
  reviewRequests: [],
  marks: { mine: [], reviewRequests: [] },
  taskIds: null,
});

/**
 * One poller for every tab, shaped like `UsageMonitor` (WORK, "Lookout's side"): it reads only
 * while a tab has Work open (`watch()`), every 5 minutes from the end of the last read; opening
 * Work reads when the data is more than 5 minutes old; Refresh forces a read, at most once a minute
 * server-wide; a rate limit holds every GitHub read (WORK-8). Results go to `onChange` only when
 * something changed. `close()` cancels what runs and waits until it has exited.
 */
export class WorkMonitor {
  private prs: PrSection = emptyPrs();
  /** WORK-7.5: per column, when it was last read without a `column_issues` entry. In memory only. */
  private readonly confirmed = new Map<PrColumn, number>();
  private lastIssues: PrColumnIssue[] = [];
  private lastReadEnd: number | null = null;
  private cooldownUntil: number | null = null;
  private githubBlockedUntil: number | null = null;
  private watchers = 0;
  private timer: NodeJS.Timeout | null = null;
  private current: WorkSnapshot | null = null;
  private readonly abort = new AbortController();
  private readonly lane: ReadLane<PrAsk, ReadResult>;
  private readonly opts: WorkMonitorOptions;
  private readonly now: () => number;

  constructor(opts: WorkMonitorOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.lane = new ReadLane<PrAsk, ReadResult>(
      (ask) => this.readPrs(ask),
      (a, b) => a.forced === b.forced,
    );
    this.current = this.build();
  }

  private get interval() {
    return this.opts.intervalMs ?? WORK_INTERVAL_MS;
  }

  snapshot(): WorkSnapshot {
    return this.current ?? this.build();
  }

  /** A tab opened Work (WORK-8.1); the returned function says it closed it. */
  watch(): () => void {
    this.watchers++;
    this.opened();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.watchers--;
      if (this.watchers === 0) this.closedEverywhere(PR_REASON.closed);
    };
  }

  /**
   * WORK-8.2: a forced read, refused while no tab has Work open (WORK-8.1), during the 60 s cooldown
   * and while GitHub is rate limited (WORK-8.4). Accepted, it starts the cooldown at once and answers
   * with the read's outcome.
   */
  async refresh(): Promise<RefreshAnswer> {
    const now = this.now();
    if (this.watchers === 0) return { status: 409, result: { ok: false, error: "Work isn't open in any tab" } };
    if (this.cooldownUntil !== null && now < this.cooldownUntil) {
      return { status: 429, result: { ok: false, error: 'Refresh was used less than a minute ago', until: this.cooldownUntil } };
    }
    if (this.blocked(now)) {
      return { status: 429, result: { ok: false, error: 'GitHub is rate limited', until: this.githubBlockedUntil! } };
    }
    this.cooldownUntil = now + (this.opts.cooldownMs ?? WORK_COOLDOWN_MS);
    // Accepted: no scheduled read while it waits or runs; its end re-arms the schedule.
    this.disarm();
    this.publish();
    const r = await this.lane.request({ forced: true });
    return { status: 200, result: r.ok ? { ok: true } : { ok: false, error: r.reason } };
  }

  /** Stops polling, cancels running commands, and resolves once they have exited. */
  async close(): Promise<void> {
    this.watchers = 0;
    this.closedEverywhere(PR_REASON.cancelled);
    this.abort.abort();
    await this.lane.idle();
  }

  /** WORK-8.1: with Work closed everywhere, nothing is read: no schedule, and waiting reads are dropped. */
  private closedEverywhere(reason: string): void {
    this.disarm();
    this.lane.drop({ ok: false, reason });
  }

  private blocked(now = this.now()): boolean {
    return this.githubBlockedUntil !== null && now < this.githubBlockedUntil;
  }

  private opened(): void {
    const now = this.now();
    const age = this.lastReadEnd === null ? Infinity : now - this.lastReadEnd;
    if (age > this.interval) this.scheduled();
    else if (!this.timer && !this.lane.busy) this.arm(this.interval - age);
  }

  /** A plain read, unless GitHub is rate limited: then the next try comes when that ends. */
  private scheduled(): void {
    if (this.abort.signal.aborted) return;
    if (this.blocked()) {
      this.arm(this.githubBlockedUntil! - this.now());
      return;
    }
    void this.lane.request({ forced: false });
  }

  private arm(delay: number): void {
    this.disarm();
    if (this.watchers === 0 || this.abort.signal.aborted) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.watchers > 0) this.scheduled();
    }, Math.max(0, delay));
    this.timer.unref?.();
  }

  private disarm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private tbPr(argv: readonly string[]): Promise<string> {
    return runWorkCommand(this.opts.runner, 'tb-pr', this.opts.tbPrBin(), argv, {
      timeoutMs: this.opts.tbPrTimeoutMs ?? TB_PR_TIMEOUT_MS,
      env: cleanEnv(this.opts.env ?? process.env),
      signal: this.abort.signal,
    });
  }

  /**
   * One PR read. Forced: `tb-pr refresh`, then `list --json` only if the refresh succeeded (it has
   * cleared tb-pr's cache either way, so a list after a failed refresh would fetch again).
   * Never throws.
   */
  private async readPrs(ask: PrAsk): Promise<ReadResult> {
    // WORK-8.4: no GitHub read, scheduled or forced, while rate limited; this one waited behind it.
    if (this.blocked()) return { ok: false, reason: PR_REASON.rateLimited };
    if (this.abort.signal.aborted) return { ok: false, reason: PR_REASON.cancelled };
    // The schedule counts from the end of this read, which re-arms it: cancelled meanwhile, so no
    // scheduled read lines up behind a Refresh (WORK-8.1, "Reads, cooldown and coalescing").
    this.disarm();
    let result: ReadResult;
    try {
      if (ask.forced) await this.tbPr(['refresh']);
      const board = parseTbPrList(await this.tbPr(['list', '--json']));
      result = this.accept(board);
    } catch (err) {
      if (this.abort.signal.aborted) return { ok: false, reason: PR_REASON.cancelled };
      const failure = classifyTbPrFailure(err, this.now());
      if (failure.detail) this.log(failure.detail);
      result = this.fail(failure);
    }
    this.lastReadEnd = this.now();
    if (this.watchers > 0) this.arm(this.interval);
    this.publish();
    return result;
  }

  private accept(board: PrBoard): ReadResult {
    const now = this.now();
    if (every401(board)) {
      this.log('api error 401 in every column');
      return this.fail({ state: 'signed-out', reason: PR_REASON.signedOut, fix: SIGN_IN_COMMAND, blockedUntil: null, detail: null });
    }
    if (boardRateLimited(board)) this.block(now + RATE_LIMIT_MIN_MS);
    // WORK-7.5: a column without an issue is confirmed as of the board's fetch (served from tb-pr's cache, older than now).
    const asOf = Math.min(board.fetchedAt ?? now, now);
    for (const c of PR_COLUMNS) {
      if (board.issues.some((i) => i.column === c)) continue;
      this.confirmed.set(c, Math.max(this.confirmed.get(c) ?? -Infinity, asOf));
    }
    this.lastIssues = board.issues;
    this.prs = {
      state: 'ok',
      reason: null,
      fix: null,
      stale: false,
      fetchedAt: board.fetchedAt,
      mine: MINE_COLUMNS.flatMap((c) => board.columns[c]).sort(byUrgency),
      reviewRequests: REVIEW_COLUMNS.flatMap((c) => board.columns[c]).sort(byUrgency),
      marks: this.marks(),
      taskIds: board.taskIds,
    };
    return { ok: true };
  }

  /** WORK-7.3: a failed read keeps the last lists, marked old, with the reason. */
  private fail(f: PrReadFailure): ReadResult {
    if (f.blockedUntil !== null) this.block(f.blockedUntil);
    const hadList = this.prs.fetchedAt !== null || this.prs.mine.length > 0 || this.prs.reviewRequests.length > 0;
    this.prs = { ...this.prs, state: f.state, reason: f.reason, fix: f.fix, stale: hadList, marks: this.marks() };
    return { ok: false, reason: f.reason };
  }

  private marks(): PrSection['marks'] {
    return { mine: marksFor(MINE_COLUMNS, this.lastIssues, this.confirmed), reviewRequests: marksFor(REVIEW_COLUMNS, this.lastIssues, this.confirmed) };
  }

  /** What tb-pr said, already redacted and one line: the server's log only (WORK-7.7). */
  private log(line: string): void {
    (this.opts.log ?? ((l: string) => console.warn(`lookout: tb-pr: ${l}`)))(line);
  }

  private block(until: number): void {
    this.githubBlockedUntil = Math.max(this.githubBlockedUntil ?? -Infinity, until);
  }

  private build(): WorkSnapshot {
    return { prs: this.prs, refresh: { cooldownUntil: this.cooldownUntil, githubBlockedUntil: this.githubBlockedUntil } };
  }

  private publish(): void {
    const next = this.build();
    const same = this.current !== null && JSON.stringify(this.current) === JSON.stringify(next);
    this.current = next;
    if (!same) this.opts.onChange(next);
  }
}
