import { TB_PR_COLUMNS, type PrDecl, type TbPrBoardDecl, type TbPrColumn, type TbPrColumnIssue, type TbPrDecl } from '../world/builder.ts';
import { type Outcome, type Refusal, serveCall } from './control.ts';

/**
 * The fake `tb-pr` (TEST-1.5, WORK's Dependencies). It answers `tb-pr list --json` with the
 * declared board, as tb-pr 0.3.1 prints it (the World refuses a board 0.3.1 never prints:
 * `TbPrColumnIssue`), and `tb-pr refresh` with the declared exit code and 0.3.1's summary, or fails
 * both as declared: `gh auth token`, a 401, GitHub's rate limit with or without a reset time, or no
 * answer at all.
 *
 * Anything else is a violation, `list` without `--json` included: a real tb-pr would reach GitHub
 * with your account. `--version`, which Settings › Tools reads when the server starts (TOOLS-1.3),
 * prints the declared line, never reaching GitHub here.
 */

const MINE = new Set<TbPrColumn>(['draft_mine', 'review_mine', 'ready_to_merge_mine']);
/** The state chip each column gives its PRs (WORK-3.2). */
const STATE: Record<TbPrColumn, 'draft' | 'ready' | 'approved'> = {
  draft_mine: 'draft',
  review_mine: 'ready',
  ready_to_merge_mine: 'approved',
  waiting_on_me: 'ready',
  waiting_on_author: 'ready',
};
/** tb-pr's short labels, as `refresh` prints them. */
const SHORT: Record<TbPrColumn | 'mentions', string> = {
  draft_mine: 'draft',
  review_mine: 'review',
  ready_to_merge_mine: 'ready',
  waiting_on_me: 'wait-me',
  waiting_on_author: 'wait-au',
  mentions: 'mentions',
};
const DAY_MS = 86_400_000;
const LATER = 'Run `tb-pr refresh` later or widen TTL.';

/** A PR as `list --json` serializes it: optional fields left out when unset, `task_ids` only after Gap 1. */
function pr(p: PrDecl, column: TbPrColumn, user: string, withTaskIds: boolean, now: Date): Record<string, unknown> {
  const age = p.age_days ?? (p.created_at ? (now.getTime() - Date.parse(p.created_at)) / DAY_MS : 1);
  const optional = <K extends keyof PrDecl>(key: K) => (p[key] === undefined ? {} : { [key]: p[key] });
  return {
    number: p.number,
    repo: p.repo,
    title: p.title,
    url: p.url ?? `https://github.com/productiveio/${p.repo}/pull/${p.number}`,
    author: p.author ?? (MINE.has(column) ? user : 'teammate'),
    state: p.state ?? STATE[column],
    created_at: p.created_at ?? new Date(now.getTime() - age * DAY_MS).toISOString(),
    age_days: age,
    size: p.size ?? null,
    rotting: p.rotting ?? 'fresh',
    ...optional('productive_task_id'),
    comments_count: p.comments_count ?? 0,
    base_branch: p.base_branch === undefined ? 'develop' : p.base_branch,
    ...optional('head_branch'),
    ...optional('has_new_commits_since_my_review'),
    ...(p.changes_requested_by?.length ? { changes_requested_by: p.changes_requested_by } : {}),
    ...optional('check_state'),
    ...(withTaskIds ? { task_ids: p.task_ids ?? [] } : {}),
  };
}

function board(decl: TbPrBoardDecl, now: Date) {
  const user = decl.user ?? 'world-tester';
  const columns = Object.fromEntries(TB_PR_COLUMNS.map((c) => [c, (decl.columns?.[c] ?? []).map((p) => pr(p, c, user, decl.withTaskIds !== false, now))])) as Record<TbPrColumn, unknown[]>;
  return {
    user,
    fetched_at: decl.fetched_at ?? now.toISOString(),
    columns: { ...columns, notifications: [] },
    // `ColumnIssue`'s fields in its order, `restored_from` only when set.
    ...(decl.column_issues?.length
      ? { column_issues: decl.column_issues.map((i) => ({ column: i.column, reason: i.reason, ...(i.restored_from === undefined ? {} : { restored_from: i.restored_from }) })) }
      : {}),
  };
}

/** tb-pr's `humanize_age_hours` (`commands/util.rs`). */
function humanizeAgeHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  if (hours < 24 * 60) return `${Math.round(hours / 24)}d`;
  return `${Math.round(hours / (24 * 30))}mo`;
}

/** tb-pr's `partial_fetch_summary`, as `refresh` prints it on stderr: each flagged column, and how old a put-back list is. */
function partialFetchSummary(issues: readonly TbPrColumnIssue[], now: Date): string {
  const parts = issues.map((i) => {
    if (i.restored_from === undefined) return `${SHORT[i.column]} (${i.reason})`;
    // `hours_since`: whole seconds.
    const hours = Math.trunc((now.getTime() - Date.parse(i.restored_from)) / 1000) / 3600;
    return `${SHORT[i.column]} (${i.reason}, showing the list from ${humanizeAgeHours(hours)} ago)`;
  });
  return `⚠ partial fetch — ${parts.join(', ')}\n`;
}

function failed(decl: TbPrDecl): Outcome | null {
  const f = decl.failure;
  if (f === undefined) return null;
  if (f === 'timeout') return { hang: true };
  const error = (text: string): Outcome => ({ stderr: `Error: ${text}\n`, code: 1 });
  if (f === 'gh-auth') return error('`gh auth token` failed — run `gh auth login`');
  if (f === 401) return error('GitHub API error (401): {"message":"Bad credentials","documentation_url":"https://docs.github.com/rest","status":"401"}');
  // A 429 carries no reset header; a 403 with an exhausted rate limit does (tb-pr's `send_get`).
  if (f === 'rate-limited') return error(`GitHub API error (429): rate limited. ${LATER}`);
  const resets = new Date(f.rateLimitedUntil).toISOString().slice(11, 19);
  return error(`GitHub API error (403): rate limited — resets at ${resets} UTC. ${LATER}`);
}

/** TOOLS-1.3: what `tb-pr --version` prints in a World, where no gh can check for a newer release. */
export const TB_PR_VERSION = 'tb-pr 0.3.1 (install gh to check for updates)';

function answer(argv: string[], decl: TbPrDecl, now: Date): Outcome | Refusal {
  // Settings › Tools reads it (TOOLS-1.3): a read like the real one's, which never reaches GitHub here.
  if (argv.length === 1 && argv[0] === '--version') return { stdout: `${decl.version ?? TB_PR_VERSION}\n`, code: 0 };
  // `--json` is a global flag: before or after the subcommand.
  const words = argv.filter((a) => a !== '--json');
  const json = argv.length - words.length;
  const command = words.length === 1 && words[0] === 'list' && json === 1 ? 'list' : argv.length === 1 && argv[0] === 'refresh' ? 'refresh' : null;
  if (!command) return { refused: 'only `list --json` and `refresh` are answered' };

  const failure = failed(decl);
  if (failure) return failure;
  const state = board(decl.board ?? {}, now);
  if (command === 'list') return { stdout: `${JSON.stringify(state, null, 2)}\n`, code: 0 };

  const exit = decl.refreshExit ?? 0;
  if (exit !== 0) return { stderr: `Error: refresh failed (the World declared exit ${exit})\n`, code: exit };
  const n = (c: TbPrColumn) => state.columns[c].length;
  const total = TB_PR_COLUMNS.reduce((sum, c) => sum + n(c), 0);
  const issues = decl.board?.column_issues ?? [];
  return {
    stdout: `refreshed ${total} PR(s) — draft=${n('draft_mine')} review=${n('review_mine')} ready=${n('ready_to_merge_mine')} wait-me=${n('waiting_on_me')} wait-au=${n('waiting_on_author')}\n`,
    ...(issues.length ? { stderr: partialFetchSummary(issues, now) } : {}),
    code: 0,
  };
}

await serveCall<TbPrDecl>('tb-pr', answer);
