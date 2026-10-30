import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { TB_PROD_INSTALL_COMMAND, TB_PROD_SIGN_IN_COMMAND, TB_PR_INSTALL_COMMAND, TB_SESSION_INSTALL_COMMAND } from '../shared/defaults.ts';
import { HTML_ENTITIES } from './html-entities.ts';
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
  type TaskSection,
  type WorkPr,
  type WorkRefreshResult,
  type SessionLinkSection,
  type WorkSnapshot,
  type WorkSourceState,
  type WorkTask,
  taskUrl,
} from '../shared/work.ts';
import type { RunError, RunOptions, Runner } from './exec.ts';
import { cleanEnv } from './launcher.ts';
import { sanitizeLine } from './sanitize.ts';
import { refusedAsTooOld } from './too-old.ts';
import { tooOld } from '../shared/tools.ts';
import { buildWorkLinks, parseSessionSearch, TbSessionShapeError, type SessionSearchResult } from './work-links.ts';

/**
 * WORK: open PRs and Review requests through `tb-pr`, and Tasks through `tb-prod` (decision 0005),
 * contract in docs/features/tasks-and-prs/SPEC.md, "Sources" and "Lookout's side". Everything they
 * print is validated and bounded here; every failure becomes a plain reason here, what the tool said
 * goes only to the server's log, redacted and one line, and nothing here logs or rethrows a
 * `RunError` (WORK-7.7). Each source has its own `ReadLane`.
 */

/** WORK-8.1: reads every 5 minutes, counted from the end of the last read. */
export const WORK_INTERVAL_MS = 5 * 60_000;
/** WORK-8.2: a forced read is refused for this long after the server accepted one. */
export const WORK_COOLDOWN_MS = 60_000;
/** A cold fetch takes several seconds (Sources). */
export const TB_PR_TIMEOUT_MS = 20_000;
/** Per page of Tasks; one takes 0.3 s (Sources). */
export const TB_PROD_TIMEOUT_MS = 10_000;
/** One tb-session search; its 200 result cap keeps each output bounded (WORK-4.8). */
export const TB_SESSION_TIMEOUT_MS = 20_000;
/** WORK-4.9: how many `tb-session search` processes one Link run starts at once. */
const LINK_SEARCH_CONCURRENCY = 12;
const LINK_RETRY_WINDOW_MS = 10_000;
const LINK_RETRY_INTERVAL_MS = 1_000;
/** WORK-2.1: 5 pages of 20, up to 100 Tasks. */
export const MAX_TASK_PAGES = 5;
/** WORK-8.4: a rate limit holds GitHub reads at least this long… */
export const RATE_LIMIT_MIN_MS = 5 * 60_000;
/** …and at most this long, GitHub's core window. */
export const RATE_LIMIT_MAX_MS = 60 * 60_000;
const DAY_MS = 86_400_000;
const MAX_TITLE = 300;
const MAX_URL = 500;

// --- Binaries and the argv allowlist (WORK-5.3) -------------------------------------------------

export type WorkTool = 'tb-pr' | 'tb-prod' | 'tb-session';
type WorkDataTool = Exclude<WorkTool, 'tb-session'>;
const BIN_ENV: Record<WorkDataTool, string> = { 'tb-pr': 'LOOKOUT_TB_PR_BIN', 'tb-prod': 'LOOKOUT_TB_PROD_BIN' };

/**
 * Finds `tb-pr` or `tb-prod` like tb-session: `LOOKOUT_TB_PR_BIN` / `LOOKOUT_TB_PROD_BIN`, then
 * PATH, then `~/.local/bin` (where cli-toolbox installs them; a server started by launchd has a
 * short PATH). Unfound, the bare name: running it fails with ENOENT, "not installed" (WORK-7.1).
 */
export function resolveWorkBin(tool: WorkDataTool, env: NodeJS.ProcessEnv = process.env): string {
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
  if (tool === 'tb-session') {
    const query = argv[6];
    return argv.length === 7 && argv.slice(0, 6).join(' ') === 'search --all-projects --limit 200 --json --' &&
      (typeof query === 'string' && (/^https:\/\/github\.com\/productiveio\/[A-Za-z0-9._-]+\/pull\/[0-9]+$/i.test(query) || /^(?:tasks\/|task=)[0-9]{1,20}$/i.test(query)));
  }
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

const CI = new Map<unknown, CiState>([
  ['success', 'passing'],
  ['failure', 'failing'],
  ['pending', 'running'],
  ['unknown', 'unknown'],
]);

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
/** WORK-3.8: GitHub's login shape: letters, digits and single hyphens, not at either end, at most 39 characters. */
export function githubLogin(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(value) ? value : null;
}

/** WORK-2.12: a workflow status's `color_id` (a number, or digits as a string) as an index into Productive's 17 colours. */
function paletteIndex(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^[0-9]{1,2}$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 16 ? n : null;
}

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
    author: githubLogin(raw.author),
    createdAt: rfc3339(raw.created_at),
    ageDays: age,
    rotting: ROT_BUCKETS.includes(raw.rotting as RotBucket) ? (raw.rotting as RotBucket) : null,
    // WORK-3.3: tb-pr's `unknown` is "CI unknown"; anything else it doesn't name, absence included, is "no CI". Never passing.
    ci: CI.get(raw.check_state) ?? 'none',
    chip: column === 'waiting_on_me' ? null : CHIP_OF[column],
    column,
    taskIds: readTaskIds(raw.task_ids),
    links: null,
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

/** TOOLS-2.5: "tb-pr 0.2.0 is older than Work needs (0.3.1)", the version from TOOLS-2.1's table, and what to do. */
export function prTooOldReason(installed: string | null): string {
  return `${tooOld('tb-pr', 'Work', installed)}. Update it, then press Refresh.`;
}

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
export function classifyTbPrFailure(err: unknown, now: number, installed: string | null = null): PrReadFailure {
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
  // TOOLS-2.5: a subcommand or flag it doesn't know: too old, never "not installed".
  if (refusedAsTooOld(e)) return failure('error', prTooOldReason(installed), { fix: TB_PR_INSTALL_COMMAND });
  if (e.aborted) return failure('error', PR_REASON.cancelled, { detail: null });
  if (e.timedOut) return failure('error', PR_REASON.timedOut, { detail: null });
  if (stderr.includes('`gh auth token`') || stderr.includes('GitHub API error (401)')) return failure('signed-out', PR_REASON.signedOut, { fix: SIGN_IN_COMMAND });
  if (/rate limited/i.test(stderr)) return failure('error', PR_REASON.rateLimited, { blockedUntil: rateLimitedUntil(stderr, now) });
  const status = /GitHub API error \((\d{3})\)/.exec(stderr)?.[1];
  if (status) return failure('error', Number(status) >= 500 ? PR_REASON.serverError : PR_REASON.refused);
  return failure('error', PR_REASON.failed);
}

// --- Reading `tb-prod query tasks` (WORK-2) -----------------------------------------------------

/**
 * WORK's filter (Sources): the open Tasks assigned to `email`, in active projects, task lists and
 * folders. `folder_status` needs tb-prod 1.2.0 (WORK-7.8).
 */
export function tasksFilter(email: string): string {
  const conditions = [
    { field: 'assignee.email', operator: 'eq', value: email },
    { field: 'project.status', operator: 'eq', value: '1' },
    { field: 'task_list_status', operator: 'eq', value: '1' },
    { field: 'folder_status', operator: 'eq', value: '1' },
    { field: 'workflow_status_category_id', operator: 'not_eq', value: '3' },
  ];
  return JSON.stringify({ op: 'and', conditions });
}

/**
 * One page of WORK's Tasks query (Sources). The sort is one argument: as two, clap would read
 * `-last_activity_at` as a flag.
 */
export function tasksQueryArgv(email: string, page: number): string[] {
  return ['query', 'tasks', '--filter', tasksFilter(email), '--include', 'project,workflow_status', '--sort=-last_activity_at', '--page', String(page)];
}

/** tb-prod printed something that isn't a page of Tasks Lookout can read; `detail` is for the server's log only. */
export class TbProdShapeError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(detail);
    this.detail = detail;
  }
}

export interface TasksPage {
  tasks: WorkTask[];
  hasNextPage: boolean;
}

const DUE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** WORK-2.11: a Task's description as sent, at most this many characters. */
export const MAX_DESCRIPTION = 600;
/**
 * A tag's attributes up to its `>`, as a browser reads them: a `>` inside a quoted value (`="…"` or
 * `='…'`) doesn't end the tag, an unclosed one runs to the end, and a quote anywhere else is a character.
 */
const ATTRS = String.raw`(?:=\s*"[^"]*(?:"|$)|=\s*'[^']*(?:'|$)|[^>])*`;
const BLOCK_END = new RegExp(String.raw`<\/(?:p|div|li|ul|ol|h[1-6]|tr|table|blockquote|pre|section|article|header|footer)\s*>|<(?:br|hr)\b${ATTRS}>?`, 'gi');
const LIST_ITEM = new RegExp(String.raw`<li\b${ATTRS}>?`, 'gi');
const TAG = new RegExp(String.raw`<\/?[A-Za-z]${ATTRS}>?`, 'g');
/** A named reference (HTML_ENTITIES, case-sensitive as HTML's are), or a decimal or hex one. */
const ENTITY = /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g;

/**
 * WORK-2.11: a Task's description from tb-prod, which Productive gives as HTML, as plain text: a
 * block's end or a `<br>` is a line break, a list item starts with "- ", scripts and styles go
 * whole, every other tag is dropped, entities are decoded, controls stripped, blank lines dropped,
 * and it's cut to 600 characters. Null when nothing is left, or it isn't a string: never a read failure.
 */
export function descriptionText(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const text = stripAnsi(v.normalize('NFKC'))
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style|template|iframe|object)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(LIST_ITEM, '\n- ')
    .replace(BLOCK_END, '\n')
    .replace(TAG, '')
    .replace(ENTITY, (all, name: string) => {
      if (name[0] !== '#') return Object.hasOwn(HTML_ENTITIES, name) ? HTML_ENTITIES[name]! : all;
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
    });
  const lines = text
    .split(/\r\n|[\n\r\u2028\u2029]/)
    // eslint-disable-next-line no-control-regex -- strip controls
    .map((line) => line.replace(/[\u0000-\u001f\u007f\u200b]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => line && line !== '-');
  const plain = lines.join('\n');
  if (!plain) return null;
  return plain.length > MAX_DESCRIPTION ? `${plain.slice(0, MAX_DESCRIPTION - 1)}…` : plain;
}

/**
 * One page of `tb-prod query tasks` (JSON:API: `data`, `included`, `meta`), validated. A Task without
 * an id, or a page without `data` or `meta.hasNextPage`, throws TbProdShapeError: a renamed field
 * must fail the read, never leave Tasks silently missing (or Work saying "No open tasks"). What's only
 * shown (project, status, due date) is null when unreadable.
 */
export function parseTasksPage(stdout: string): TasksPage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new TbProdShapeError("query tasks didn't print JSON");
  }
  if (!isObj(parsed) || !Array.isArray(parsed.data)) throw new TbProdShapeError('query tasks printed no data list');
  if (!isObj(parsed.meta) || typeof parsed.meta.hasNextPage !== 'boolean') throw new TbProdShapeError('query tasks printed no meta.hasNextPage');
  const included = new Map<string, Json>();
  for (const r of Array.isArray(parsed.included) ? parsed.included : []) {
    if (isObj(r) && typeof r.type === 'string' && typeof r.id === 'string') included.set(`${r.type}:${r.id}`, isObj(r.attributes) ? r.attributes : {});
  }
  const related = (rels: unknown, name: string, type: string): Json | null => {
    const data = isObj(rels) && isObj(rels[name]) ? rels[name].data : null;
    return isObj(data) && typeof data.id === 'string' ? (included.get(`${type}:${data.id}`) ?? null) : null;
  };
  const tasks = parsed.data.map((raw: unknown, i): WorkTask => {
    if (!isObj(raw) || typeof raw.id !== 'string' || !/^[0-9]{1,20}$/.test(raw.id)) throw new TbProdShapeError(`Task ${i + 1} of the page has no id`);
    const a = isObj(raw.attributes) ? raw.attributes : {};
    const project = related(raw.relationships, 'project', 'projects');
    const status = related(raw.relationships, 'workflow_status', 'workflow_statuses');
    const category = status?.category_id;
    return {
      id: raw.id,
      title: displayText(a.title, MAX_TITLE) ?? `Task ${raw.id}`,
      project: displayText(project?.name, MAX_TITLE),
      status: displayText(status?.name, MAX_TITLE),
      statusCategory: category === 1 ? 'not-started' : category === 2 ? 'started' : null,
      statusColor: paletteIndex(status?.color_id),
      dueDate: typeof a.due_date === 'string' && DUE_DATE.test(a.due_date) ? a.due_date : null,
      lastActivityAt: rfc3339(a.last_activity_at),
      milestone: a.type_id === 3,
      description: descriptionText(a.description),
      url: taskUrl(raw.id),
      links: null,
    };
  });
  return { tasks, hasNextPage: parsed.meta.hasNextPage };
}

/** Pages read one after another: a Task that moved to a later page meanwhile shows once, where it was first seen. */
export function mergePages(pages: readonly TasksPage[]): WorkTask[] {
  const seen = new Set<string>();
  const tasks: WorkTask[] = [];
  for (const task of pages.flatMap((p) => p.tasks)) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    tasks.push(task);
  }
  return tasks;
}

export interface TaskReadFailure {
  state: Exclude<WorkSourceState, 'loading' | 'ok'>;
  /** A plain sentence that says what to do (UX, "Errors"); never tb-prod's own text. */
  reason: string;
  fix: string | null;
  /** What tb-prod said, redacted and one line, for the server's log only (WORK-7.7); null when there's nothing to add. */
  detail: string | null;
}

/** WORK-7.8, TOOLS-2.5: "tb-prod 1.1.1 is older than Work needs (1.2.0)", and how to get one that isn't. */
export function outdatedReason(installed: string | null): string {
  return `${tooOld('tb-prod', 'Work', installed)}. Build it from cli-toolbox's main, then press Refresh.`;
}

/** UX, "Errors": why a Tasks read failed, and what to do, in plain words. */
export const TASK_REASON = {
  notInstalled: "tb-prod isn't installed. Work reads Tasks through it: build it from cli-toolbox's main, then press Refresh.",
  /** WORK-7.8, TOOLS-2.5: the version it needs from TOOLS-2.1's table; `outdatedReason` names the one installed when it's known. */
  outdated: outdatedReason(null),
  signedOut: `tb-prod isn't signed in to Productive. Run ${TB_PROD_SIGN_IN_COMMAND}, then press Refresh.`,
  denied: "Productive denied access to your Tasks. Check what tb-prod's token's account can see, then press Refresh.",
  serverError: 'Productive had a server error. Try Refresh later.',
  refused: 'Productive refused the request. Try Refresh later.',
  queryRefused: "tb-prod refused Work's query. Check that tb-prod and Lookout are up to date, then press Refresh.",
  timedOut: 'tb-prod took too long to answer. Try Refresh later.',
  failed: "tb-prod couldn't read your Tasks. Try Refresh later.",
  unreadable: "tb-prod printed Tasks Lookout can't read. Check that tb-prod and Lookout are up to date, then press Refresh.",
  /** WORK-2.8: the email changed while the read ran, or before it began; its result isn't used. */
  emailChanged: 'The Productive email changed, so that read was dropped.',
  cancelled: 'The read was cancelled.',
  closed: 'Work was closed in every tab before the read began.',
} as const;

/** tb-prod's JSON error on stdout (`json_error.rs`): only its code, its message and `details.status`. */
function tbProdJsonError(stdout: unknown): { code: string; error: string; status: number | null } | null {
  if (typeof stdout !== 'string' || !stdout.trim().startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!isObj(parsed) || typeof parsed.code !== 'string') return null;
  const status = isObj(parsed.details) && typeof parsed.details.status === 'number' ? parsed.details.status : null;
  return { code: parsed.code, error: typeof parsed.error === 'string' ? parsed.error : '', status };
}

/**
 * WORK-7.8: tb-prod 1.1.x's refusal of WORK's filter, `Unknown filter field 'folder_status'` with
 * `board_status`, 1.1.x's name for it, among the keys it lists as available. Anything else naming
 * `folder_status`, such as a bad operator or a later tb-prod that renamed the key again, isn't.
 */
function isTbProd11Refusal(error: string): boolean {
  const available = /^Unknown filter field 'folder_status' on tasks\. Available: (.*)$/.exec(error)?.[1];
  return available !== undefined && available.split(', ').includes('board_status');
}

/**
 * Turns a failed `tb-prod` run into a plain reason (WORK-7, UX "Errors"). "Not signed in" exactly as
 * WORK-7.6 says: exit 1 with "No config found" on stderr, a JSON `config_error`, or a JSON `api_error`
 * with status 401; a 403 is access denied, a failed read. tb-prod 1.1.x's `invalid_filter` for
 * `folder_status` is a tb-prod older than 1.2.0 (WORK-7.8). What tb-prod said goes only to `detail`,
 * for the log: its JSON error's code and message, or the first line of its stderr; Productive's
 * answer (`details.body`) is never read.
 */
export function classifyTbProdFailure(err: unknown, installed: string | null = null): TaskReadFailure {
  const e = (typeof err === 'object' && err !== null ? err : {}) as RunError;
  const stderr = stripAnsi(typeof e.stderr === 'string' ? e.stderr : '');
  const code = typeof e.code === 'number' ? e.code : null;
  const json = code === null ? null : tbProdJsonError(e.stdout);
  const detail = json ? sanitizeLine(`${json.code}: ${json.error}`) : (sanitizeLine(stderr) ?? (code === null ? null : `exit ${code}`));
  const failure = (state: TaskReadFailure['state'], reason: string, opts: Partial<Pick<TaskReadFailure, 'fix' | 'detail'>> = {}): TaskReadFailure => ({
    state,
    reason,
    fix: opts.fix ?? null,
    detail: opts.detail === undefined ? detail : opts.detail,
  });
  // Lookout's own wording, not tb-prod's.
  if (err instanceof WorkCommandRefused) return failure('error', err.message, { detail: null });
  if (err instanceof TbProdShapeError) return failure('error', TASK_REASON.unreadable, { detail: sanitizeLine(err.detail) });
  if (e.code === 'ENOENT') return failure('not-installed', TASK_REASON.notInstalled, { fix: TB_PROD_INSTALL_COMMAND, detail: null });
  if (e.aborted) return failure('error', TASK_REASON.cancelled, { detail: null });
  if (e.timedOut) return failure('error', TASK_REASON.timedOut, { detail: null });
  if (json) {
    const signedOut = () => failure('signed-out', TASK_REASON.signedOut, { fix: TB_PROD_SIGN_IN_COMMAND });
    if (json.code === 'config_error') return signedOut();
    if (json.code === 'api_error') {
      if (json.status === 401) return signedOut();
      if (json.status === 403) return failure('error', TASK_REASON.denied);
      return failure('error', json.status !== null && json.status >= 500 ? TASK_REASON.serverError : TASK_REASON.refused);
    }
    if (json.code === 'invalid_filter' && isTbProd11Refusal(json.error)) return failure('error', outdatedReason(installed), { fix: TB_PROD_INSTALL_COMMAND });
    if (json.code === 'invalid_filter' || json.code === 'invalid_json') return failure('error', TASK_REASON.queryRefused);
    return failure('error', TASK_REASON.failed);
  }
  if (code === 1 && stderr.includes('No config found')) return failure('signed-out', TASK_REASON.signedOut, { fix: TB_PROD_SIGN_IN_COMMAND });
  // TOOLS-2.5: a subcommand or flag it doesn't know: too old, never a refused query.
  if (refusedAsTooOld(e)) return failure('error', outdatedReason(installed), { fix: TB_PROD_INSTALL_COMMAND });
  // clap's usage error: tb-prod couldn't parse the call, which retrying won't change.
  if (code === 2) return failure('error', TASK_REASON.queryRefused);
  return failure('error', TASK_REASON.failed);
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
  tbProdBin: () => string;
  tbSessionBin: () => string;
  onChange(work: WorkSnapshot): void;
  /** WORK-2: the saved Productive email at startup; `setProductiveEmail` follows changes. */
  productiveEmail?: string | null;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** The server's log, for what tb-pr or tb-prod said (redacted, one line); never the UI's (WORK-7.7). */
  log?: (line: string, tool: WorkTool) => void;
  /** TOOLS-2.5: a Tool's version as Settings › Tools last read it, for the "too old" line; null when unknown. */
  toolVersion?: (tool: WorkTool) => string | null;
  intervalMs?: number;
  cooldownMs?: number;
  tbPrTimeoutMs?: number;
  tbProdTimeoutMs?: number;
  tbSessionTimeoutMs?: number;
}

/** A PR read: forced runs `tb-pr refresh` first (WORK-8.2). */
interface PrAsk {
  forced: boolean;
}
/** A Tasks read, for one email. tb-prod has no cache, so a forced one is the same read (WORK-8.3). */
interface TaskAsk {
  email: string;
}
type ReadResult = { ok: true } | { ok: false; reason: string };
type WorkSource = 'prs' | 'tasks';

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

/** WORK-2.6, WORK-2.8: nothing read for this email yet, or no email to read for. */
const emptyTasks = (email: string | null): TaskSection => ({
  state: email === null ? 'no-email' : 'loading',
  reason: null,
  fix: null,
  stale: false,
  fetchedAt: null,
  tasks: [],
});

const emptySessionLinks = (): SessionLinkSection => ({ state: 'loading', reason: null, fix: null });

function classifyTbSessionFailure(err: unknown): SessionLinkSection & { detail: string | null } {
  const e = (typeof err === 'object' && err !== null ? err : {}) as RunError;
  if (err instanceof WorkCommandRefused) return { state: 'error', reason: 'Lookout refused an unexpected tb-session search.', fix: null, detail: null };
  if (err instanceof TbSessionShapeError) return { state: 'error', reason: "tb-session returned Sessions Lookout can't read. Check that tb-session and Lookout are up to date, then press Refresh.", fix: null, detail: sanitizeLine(err.message) };
  if (e.code === 'ENOENT') return { state: 'not-installed', reason: "tb-session isn't installed. Install it to show linked Sessions, then press Refresh.", fix: TB_SESSION_INSTALL_COMMAND, detail: null };
  if (e.aborted) return { state: 'error', reason: 'The Session search was cancelled.', fix: null, detail: null };
  if (e.timedOut) return { state: 'error', reason: 'tb-session took too long to search Sessions. Try Refresh later.', fix: null, detail: null };
  return { state: 'error', reason: "tb-session couldn't search Sessions. Try Refresh later.", fix: null, detail: sanitizeLine(e.stderr ?? e.message) };
}

/**
 * One poller for every tab, shaped like `UsageMonitor` (WORK, "Lookout's side"): it reads only
 * while a tab has Work open (`watch()`), Tasks and PRs in parallel, every 5 minutes from the end of
 * the last read; opening Work reads each source whose data is more than 5 minutes old, and Tasks
 * when they haven't been read for the saved email; a saved email reads Tasks; Refresh forces a read,
 * at most once a minute server-wide; a rate limit holds every GitHub read (WORK-8). Results go to
 * `onChange` only when something changed. `close()` cancels what runs and waits until it has exited.
 */
export class WorkMonitor {
  private prs: PrSection = emptyPrs();
  private tasks: TaskSection;
  private sessionLinks: SessionLinkSection = emptySessionLinks();
  private readonly prSearches = new Map<string, SessionSearchResult>();
  private readonly taskSearches = new Map<string, SessionSearchResult>();
  private readonly taskQuerySearches = new Map<string, Map<string, SessionSearchResult>>();
  private readonly latestLinkQueries = new Map<string, number>();
  private linkQueryVersion = 0;
  private linkRunVersion = 0;
  private readonly urgentLinkRuns = new Set<Promise<void>>();
  private urgentLinkRun: Promise<void> | null = null;
  private normalLinkAbort: AbortController | null = null;
  private liveSessions = new Set<string>();
  private readonly awaitingSessionLinks = new Map<string, number>();
  private linkRetryTimer: NodeJS.Timeout | null = null;
  private linkRun: Promise<void> | null = null;
  private readonly pendingLinkScopes = new Set<'prs' | 'tasks' | 'all'>();
  /** WORK-2: the saved Productive email; Tasks are read for it alone. */
  private email: string | null;
  /** WORK-7.5: per column, when it was last read without a `column_issues` entry. In memory only. */
  private readonly confirmed = new Map<PrColumn, number>();
  private lastIssues: PrColumnIssue[] = [];
  /**
   * Per source, the end of its last read that gave data ("more than 5 minutes old", WORK-8.1): a
   * Tasks-only read never makes the PRs look fresh, nor a PR read the Tasks.
   */
  private readonly lastReadEnd: Record<WorkSource, number | null> = { prs: null, tasks: null };
  private cooldownUntil: number | null = null;
  private githubBlockedUntil: number | null = null;
  private watchers = 0;
  private timer: NodeJS.Timeout | null = null;
  private current: WorkSnapshot | null = null;
  private readonly abort = new AbortController();
  private readonly lane: ReadLane<PrAsk, ReadResult>;
  private readonly taskLane: ReadLane<TaskAsk, ReadResult>;
  private readonly opts: WorkMonitorOptions;
  private readonly now: () => number;

  constructor(opts: WorkMonitorOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.email = opts.productiveEmail ?? null;
    this.tasks = emptyTasks(this.email);
    this.lane = new ReadLane<PrAsk, ReadResult>(
      (ask) => this.readPrs(ask),
      (a, b) => a.forced === b.forced,
    );
    this.taskLane = new ReadLane<TaskAsk, ReadResult>(
      (ask) => this.readTasks(ask),
      (a, b) => a.email === b.email,
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
    if (!this.opened()) void this.requestLinkSearch('all');
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.watchers--;
      if (this.watchers === 0) this.closedEverywhere('closed');
    };
  }

  /**
   * WORK-2.8: a different saved Productive email drops the Tasks kept for the previous one at once.
   * While a tab has Work open, its Tasks are read now, or once a read for another email ends (whose
   * result is then discarded); otherwise when Work next opens (WORK-8.1). Null: no email, no query
   * (WORK-2.6).
   */
  setProductiveEmail(email: string | null): void {
    if (email === this.email) return;
    this.email = email;
    this.tasks = emptyTasks(email);
    this.publish();
    if (email !== null && this.watchers > 0 && !this.abort.signal.aborted) void this.taskLane.request({ email });
  }

  /** The SessionMonitor's latest Fleet list: update live markers and search after a new Session appears (WORK-4.9). */
  setLiveSessions(sessionIds: readonly string[]): void {
    const next = new Set(sessionIds);
    const addedIds = [...next].filter((id) => !this.liveSessions.has(id));
    const added = addedIds.length > 0;
    const changed = added || [...this.liveSessions].some((id) => !next.has(id));
    if (!changed) return;
    this.liveSessions = next;
    if (this.sessionLinks.state === 'ok') this.applyLinks();
    this.publish();
    if (added && this.watchers > 0 && !this.abort.signal.aborted) this.searchForNewSessions(addedIds);
  }

  /**
   * WORK-8.2: a forced read, refused while no tab has Work open (WORK-8.1), during the 60 s cooldown
   * and while GitHub is rate limited (WORK-8.4). Accepted, it starts the cooldown at once, reads PRs
   * and, with an email saved, Tasks, and answers once both reads end.
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
    const reads = [this.lane.request({ forced: true })];
    if (this.email !== null) reads.push(this.taskLane.request({ email: this.email }));
    const failed = [...new Set((await Promise.all(reads)).flatMap((r) => (r.ok ? [] : [r.reason])))];
    return { status: 200, result: failed.length === 0 ? { ok: true } : { ok: false, error: failed.join(' ') } };
  }

  /** Stops polling, cancels running commands, and resolves once they have exited. */
  async close(): Promise<void> {
    this.watchers = 0;
    this.closedEverywhere('cancelled');
    this.abort.abort();
    await Promise.all([this.lane.idle(), this.taskLane.idle(), this.linkRun, ...this.urgentLinkRuns]);
  }

  /**
   * WORK-8.1: with Work closed everywhere, nothing is read: no schedule, and waiting reads are
   * dropped, each lane with its own reason.
   */
  private closedEverywhere(why: 'closed' | 'cancelled'): void {
    this.disarm();
    if (this.linkRetryTimer) clearTimeout(this.linkRetryTimer);
    this.linkRetryTimer = null;
    this.awaitingSessionLinks.clear();
    this.pendingLinkScopes.clear();
    this.lane.drop({ ok: false, reason: PR_REASON[why] });
    this.taskLane.drop({ ok: false, reason: TASK_REASON[why] });
  }

  private blocked(now = this.now()): boolean {
    return this.githubBlockedUntil !== null && now < this.githubBlockedUntil;
  }

  /**
   * WORK-8.1: opening Work reads each source whose data is more than 5 minutes old, by its own age,
   * and Tasks not read yet for the saved email however fresh the PRs. PRs wait while GitHub is rate
   * limited (WORK-8.4). With nothing to read, the schedule stands: 5 minutes from the end of the last
   * read of either kind, or sooner when a rate limit holding old PRs ends.
   */
  private opened(): boolean {
    const now = this.now();
    const old = (source: WorkSource) => {
      const end = this.lastReadEnd[source];
      return end === null || now - end > this.interval;
    };
    const prsOld = old('prs');
    const readTasks = this.email !== null && (this.tasks.state === 'loading' || old('tasks'));
    const readPrs = prsOld && !this.blocked(now);
    if (readTasks) void this.taskLane.request({ email: this.email! });
    if (readPrs) void this.lane.request({ forced: false });
    const sourceRead = readTasks || readPrs || this.lane.busy || this.taskLane.busy;
    // A read started here, or one in flight, re-arms the schedule when it ends.
    if (sourceRead || this.timer) return sourceRead;
    const last = Math.max(this.lastReadEnd.prs ?? -Infinity, this.lastReadEnd.tasks ?? -Infinity);
    let delay = this.interval - (now - last);
    if (prsOld && this.blocked(now)) delay = Math.min(delay, this.githubBlockedUntil! - now);
    this.arm(delay);
    return false;
  }

  /**
   * A read of both sources: Tasks when an email is saved, PRs unless GitHub is rate limited. With
   * nothing to read, the next try comes when the rate limit ends, or with the schedule.
   */
  private scheduled(): void {
    if (this.abort.signal.aborted) return;
    if (this.email !== null) void this.taskLane.request({ email: this.email });
    if (!this.blocked()) void this.lane.request({ forced: false });
    else if (this.email === null) this.arm(this.nextDelay());
  }

  /** WORK-8.1: 5 minutes; WORK-8.4: sooner when a rate limit ends before then. */
  private nextDelay(): number {
    const interval = this.interval;
    return this.blocked() ? Math.min(interval, this.githubBlockedUntil! - this.now()) : interval;
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

  /**
   * A read ended. The schedule counts from here (WORK-8.1), and the source it read is that new; a
   * read that gave no data (`null`, a discarded Tasks read) re-arms it without making either newer.
   */
  private ended(source: WorkSource | null): void {
    if (source !== null) this.lastReadEnd[source] = this.now();
    if (this.watchers > 0) this.arm(this.nextDelay());
    this.publish();
  }

  private tbPr(argv: readonly string[]): Promise<string> {
    return runWorkCommand(this.opts.runner, 'tb-pr', this.opts.tbPrBin(), argv, {
      timeoutMs: this.opts.tbPrTimeoutMs ?? TB_PR_TIMEOUT_MS,
      env: cleanEnv(this.opts.env ?? process.env),
      signal: this.abort.signal,
    });
  }

  private tbProd(argv: readonly string[]): Promise<string> {
    return runWorkCommand(this.opts.runner, 'tb-prod', this.opts.tbProdBin(), argv, {
      timeoutMs: this.opts.tbProdTimeoutMs ?? TB_PROD_TIMEOUT_MS,
      env: cleanEnv(this.opts.env ?? process.env),
      signal: this.abort.signal,
    });
  }

  private tbSession(query: string, signal: AbortSignal): Promise<string> {
    const argv = ['search', '--all-projects', '--limit', '200', '--json', '--', query];
    if (!isAllowedWorkCommand('tb-session', argv)) return Promise.reject(new WorkCommandRefused('Lookout refused an unexpected tb-session search'));
    return this.opts.runner(this.opts.tbSessionBin(), argv, {
      timeoutMs: this.opts.tbSessionTimeoutMs ?? TB_SESSION_TIMEOUT_MS,
      env: cleanEnv(this.opts.env ?? process.env),
      signal,
    });
  }

  /** Coalesces source reads by item type; Fleet-list changes refresh both kinds of search. */
  private requestLinkSearch(scope: 'prs' | 'tasks' | 'all', urgent = false): Promise<void> {
    if (this.watchers === 0 || this.abort.signal.aborted) return Promise.resolve();
    if (urgent) {
      if (this.urgentLinkRun) return this.urgentLinkRun;
      // A normal tb-session process may be waiting on the shared SQLite index. Stop it and wait
      // for its process group to exit before the time-sensitive Fleet search uses that index.
      const previous = this.linkRun;
      this.normalLinkAbort?.abort();
      const run = (async () => {
        if (previous) await previous;
        if (this.watchers > 0 && !this.abort.signal.aborted) await this.readLinks(new Set(['all']), true, this.abort.signal);
      })();
      this.urgentLinkRun = run;
      this.urgentLinkRuns.add(run);
      void run.finally(() => {
        this.urgentLinkRuns.delete(run);
        if (this.urgentLinkRun === run) this.urgentLinkRun = null;
        if (this.pendingLinkScopes.size > 0 && this.watchers > 0 && !this.abort.signal.aborted) void this.requestLinkSearch('all');
      });
      return run;
    }
    this.pendingLinkScopes.add(scope);
    if (this.urgentLinkRun) return this.urgentLinkRun;
    if (this.linkRun) return this.linkRun;
    const controller = new AbortController();
    this.normalLinkAbort = controller;
    const run = (async () => {
      while (this.pendingLinkScopes.size > 0 && this.watchers > 0 && !this.abort.signal.aborted && !controller.signal.aborted) {
        const scopes = new Set(this.pendingLinkScopes);
        this.pendingLinkScopes.clear();
        await this.readLinks(scopes, false, AbortSignal.any([this.abort.signal, controller.signal]));
      }
    })();
    this.linkRun = run.finally(() => {
      this.linkRun = null;
      if (this.normalLinkAbort === controller) this.normalLinkAbort = null;
      if (this.pendingLinkScopes.size > 0 && !this.urgentLinkRun && this.watchers > 0 && !this.abort.signal.aborted) void this.requestLinkSearch('all');
    });
    return this.linkRun;
  }

  /** Re-checks a newly listed Session while tb-session may still be indexing its prompt (WORK-4.9). */
  private searchForNewSessions(sessionIds: readonly string[]): void {
    const deadline = this.now() + LINK_RETRY_WINDOW_MS;
    for (const id of sessionIds) this.awaitingSessionLinks.set(id, deadline);
    void this.requestLinkSearch('all', true);
    this.scheduleLinkRetry();
  }

  private scheduleLinkRetry(): void {
    if (this.linkRetryTimer || this.awaitingSessionLinks.size === 0) return;
    const now = this.now();
    for (const [id, deadline] of this.awaitingSessionLinks) {
      if (!this.liveSessions.has(id) || this.isSessionLinked(id) || deadline <= now) this.awaitingSessionLinks.delete(id);
    }
    if (this.awaitingSessionLinks.size === 0 || this.watchers === 0 || this.abort.signal.aborted) return;
    const deadline = Math.min(...this.awaitingSessionLinks.values());
    const delay = Math.min(LINK_RETRY_INTERVAL_MS, Math.max(0, deadline - now));
    this.linkRetryTimer = setTimeout(() => {
      this.linkRetryTimer = null;
      if (this.watchers === 0 || this.abort.signal.aborted) return;
      for (const [id, until] of this.awaitingSessionLinks) {
        if (!this.liveSessions.has(id) || this.isSessionLinked(id) || until <= this.now()) this.awaitingSessionLinks.delete(id);
      }
      if (this.awaitingSessionLinks.size === 0) return;
      void this.requestLinkSearch('all', true);
      this.scheduleLinkRetry();
    }, delay);
    this.linkRetryTimer.unref?.();
  }

  private isSessionLinked(sessionId: string): boolean {
    return [
      ...this.prs.mine.flatMap((pr) => pr.links?.sessions ?? []),
      ...this.prs.reviewRequests.flatMap((pr) => pr.links?.sessions ?? []),
      ...this.tasks.tasks.flatMap((task) => task.links?.sessions ?? []),
    ].some((session) => session.sessionId === sessionId);
  }

  /** Searches PR and Task URLs after reads, and both after a Fleet Session (WORK-4.9). */
  private async readLinks(scopes: ReadonlySet<'prs' | 'tasks' | 'all'>, urgent: boolean, signal: AbortSignal): Promise<void> {
    const runVersion = ++this.linkRunVersion;
    const prs = this.prs.state === 'ok' || this.prs.stale ? [...this.prs.mine, ...this.prs.reviewRequests] : [];
    const tasks = this.email !== null && (this.tasks.state === 'ok' || this.tasks.stale) ? this.tasks.tasks : [];
    for (const url of this.prSearches.keys()) if (!prs.some((pr) => pr.url === url)) this.prSearches.delete(url);
    for (const id of this.taskSearches.keys()) if (!tasks.some((task) => task.id === id)) {
      this.taskSearches.delete(id);
      this.taskQuerySearches.delete(id);
    }
    const forceAll = scopes.has('all') || this.sessionLinks.state !== 'ok';
    const searchPrs = forceAll || scopes.has('prs')
      ? prs
      : prs.filter((pr) => !this.prSearches.has(pr.url));
    const searchTasks = forceAll || scopes.has('tasks')
      ? tasks
      : tasks.filter((task) => !this.taskSearches.has(task.id));
    // Each search first re-indexes the Transcripts that changed, so a run's searches share one SQLite
    // index: at most LINK_SEARCH_CONCURRENCY run at once, the rest wait their turn.
    let running = 0;
    const waiting: (() => void)[] = [];
    const search = async (key: string, query: string, accept: (result: SessionSearchResult) => void): Promise<unknown | null> => {
      if (running >= LINK_SEARCH_CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
      else running++;
      try {
        return await searchNow(key, query, accept);
      } finally {
        const next = waiting.shift();
        if (next) next();
        else running--;
      }
    };
    const searchNow = async (key: string, query: string, accept: (result: SessionSearchResult) => void): Promise<unknown | null> => {
      const version = ++this.linkQueryVersion;
      this.latestLinkQueries.set(key, version);
      try {
        const result = parseSessionSearch(await this.tbSession(query, signal));
        if (this.latestLinkQueries.get(key) !== version || signal.aborted || this.watchers === 0 || this.abort.signal.aborted) return null;
        accept(result);
        if (urgent) this.sessionLinks = { state: 'ok', reason: null, fix: null };
        this.applyLinks();
        this.publish();
        return null;
      } catch (err) {
        return !signal.aborted && this.latestLinkQueries.get(key) === version ? err : null;
      }
    };
    const jobs = [
      ...searchPrs.map((pr) => search(`pr:${pr.url}`, pr.url, (result) => this.prSearches.set(pr.url, result))),
      ...searchTasks.flatMap((task) => ['tasks/', 'task='].map((prefix) => {
        const query = `${prefix}${task.id}`;
        return search(`task:${task.id}:${query}`, query, (result) => {
          const byQuery = this.taskQuerySearches.get(task.id) ?? new Map<string, SessionSearchResult>();
          byQuery.set(query, result);
          this.taskQuerySearches.set(task.id, byQuery);
          const sessions = new Map([...byQuery.values()].flatMap((value) => value.sessions).map((session) => [session.sessionId, session]));
          this.taskSearches.set(task.id, {
            sessions: [...sessions.values()],
            incomplete: [...byQuery.values()].some((value) => value.incomplete),
          });
        });
      })),
    ];
    const failures = (await Promise.all(jobs)).filter((value) => value !== null);
    if (this.watchers === 0 || signal.aborted || this.abort.signal.aborted || runVersion !== this.linkRunVersion) return;
    if (failures.length > 0) {
      const failure = classifyTbSessionFailure(failures[0]);
      if (failure.detail) this.log(failure.detail, 'tb-session');
      this.prSearches.clear();
      this.taskSearches.clear();
      this.taskQuerySearches.clear();
      this.sessionLinks = { state: failure.state, reason: failure.reason, fix: failure.fix };
    } else {
      this.sessionLinks = { state: 'ok', reason: null, fix: null };
    }
    // Rebuild the PR → Task Links even when tb-session is unavailable.
    this.applyLinks();
    this.publish();
  }

  private applyLinks(): void {
    const prs = [...this.prs.mine, ...this.prs.reviewRequests];
    const linked = buildWorkLinks(prs, this.tasks.tasks, { prs: this.prSearches, tasks: this.taskSearches }, this.liveSessions);
    const byUrl = new Map(linked.prs.map((pr) => [pr.url, pr]));
    this.prs = {
      ...this.prs,
      mine: this.prs.mine.map((pr) => byUrl.get(pr.url) ?? pr),
      reviewRequests: this.prs.reviewRequests.map((pr) => byUrl.get(pr.url) ?? pr),
    };
    const byId = new Map(linked.tasks.map((task) => [task.id, task]));
    this.tasks = { ...this.tasks, tasks: this.tasks.tasks.map((task) => byId.get(task.id) ?? task) };
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
      const failure = classifyTbPrFailure(err, this.now(), this.opts.toolVersion?.('tb-pr') ?? null);
      if (failure.detail) this.log(failure.detail, 'tb-pr');
      result = this.fail(failure);
    }
    this.ended('prs');
    void this.requestLinkSearch('prs');
    return result;
  }

  /**
   * One Tasks read for `ask.email`: up to 5 pages, one after another, each its own `tb-prod` call
   * (WORK-2.1). A failure on any page fails the read: no partial list. Its result is used only if
   * its email is still the saved one, checked after each page (WORK-2.8). Never throws.
   */
  private async readTasks(ask: TaskAsk): Promise<ReadResult> {
    if (this.abort.signal.aborted) return { ok: false, reason: TASK_REASON.cancelled };
    // Only the saved email's Tasks are read: one saved over while this waited isn't (WORK-2.8).
    if (ask.email !== this.email) return { ok: false, reason: TASK_REASON.emailChanged };
    this.disarm();
    let result: ReadResult;
    try {
      const pages: TasksPage[] = [];
      for (let page = 1; page <= MAX_TASK_PAGES; page++) {
        pages.push(parseTasksPage(await this.tbProd(tasksQueryArgv(ask.email, page))));
        // An email saved over meanwhile stops the paging: no page follows for a read that's discarded.
        if (ask.email !== this.email) return this.discarded();
        if (!pages.at(-1)!.hasNextPage) break;
      }
      result = this.acceptTasks(mergePages(pages));
    } catch (err) {
      if (this.abort.signal.aborted) return { ok: false, reason: TASK_REASON.cancelled };
      const failure = classifyTbProdFailure(err, this.opts.toolVersion?.('tb-prod') ?? null);
      if (failure.detail) this.log(failure.detail, 'tb-prod');
      if (ask.email !== this.email) return this.discarded();
      result = this.failTasks(failure);
    }
    this.ended('tasks');
    void this.requestLinkSearch('tasks');
    return result;
  }

  /** WORK-2.8: a Tasks read for an email no longer saved: its result isn't used. */
  private discarded(): ReadResult {
    this.ended(null);
    return { ok: false, reason: TASK_REASON.emailChanged };
  }

  private accept(board: PrBoard): ReadResult {
    const now = this.now();
    if (every401(board)) {
      this.log('api error 401 in every column', 'tb-pr');
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
    this.applyLinks();
    return { ok: true };
  }

  /** WORK-7.3: a failed read keeps the last lists, marked old, with the reason. */
  private fail(f: PrReadFailure): ReadResult {
    if (f.blockedUntil !== null) this.block(f.blockedUntil);
    const hadList = this.prs.fetchedAt !== null || this.prs.mine.length > 0 || this.prs.reviewRequests.length > 0;
    this.prs = { ...this.prs, state: f.state, reason: f.reason, fix: f.fix, stale: hadList, marks: this.marks() };
    return { ok: false, reason: f.reason };
  }

  private acceptTasks(tasks: WorkTask[]): ReadResult {
    this.tasks = { state: 'ok', reason: null, fix: null, stale: false, fetchedAt: this.now(), tasks };
    this.applyLinks();
    return { ok: true };
  }

  /** WORK-7.3: as `fail`. The list kept is always the saved email's: a new email dropped the old one (WORK-2.8). */
  private failTasks(f: TaskReadFailure): ReadResult {
    this.tasks = { ...this.tasks, state: f.state, reason: f.reason, fix: f.fix, stale: this.tasks.fetchedAt !== null };
    return { ok: false, reason: f.reason };
  }

  private marks(): PrSection['marks'] {
    return { mine: marksFor(MINE_COLUMNS, this.lastIssues, this.confirmed), reviewRequests: marksFor(REVIEW_COLUMNS, this.lastIssues, this.confirmed) };
  }

  /** What tb-pr or tb-prod said, already redacted and one line: the server's log only (WORK-7.7). */
  private log(line: string, tool: WorkTool): void {
    (this.opts.log ?? ((l: string, t: WorkTool) => console.warn(`lookout: ${t}: ${l}`)))(line, tool);
  }

  private block(until: number): void {
    this.githubBlockedUntil = Math.max(this.githubBlockedUntil ?? -Infinity, until);
  }

  private build(): WorkSnapshot {
    return { prs: this.prs, tasks: this.tasks, sessionLinks: this.sessionLinks, refresh: { cooldownUntil: this.cooldownUntil, githubBlockedUntil: this.githubBlockedUntil } };
  }

  private publish(): void {
    const next = this.build();
    const same = this.current !== null && JSON.stringify(this.current) === JSON.stringify(next);
    this.current = next;
    if (!same) this.opts.onChange(next);
  }
}
