import type { Settings } from '../../shared/settings.ts';

/**
 * TEST-1.5: a World is declared in code, with a builder that starts empty. Every method returns
 * a new builder, so a shared base World can't be changed by one Behaviour test for another.
 *
 * What a World holds by default: the real tools of TEST-1.2 (Fleet and tb-session included), and
 * nothing else: no Harness, no Session, no repo, no History, no usage numbers, no git identity,
 * Jev, tb-prod and tb-pr absent.
 */

export type HarnessId = 'claude' | 'codex';
/** The real tools a World can take away (SIDE-6.1 runs without Fleet). */
export type RemovableTool = 'fleet' | 'tb-session';

/** Claude Code's usage the fake `curl` answers with (TEST-1.7). */
export interface ClaudeUsageDecl {
  session?: number;
  weekly_all?: number;
  /** An HTTP failure instead of numbers, or a request that never answers. */
  failure?: 401 | 429 | 'timeout';
}

export interface HarnessDecl {
  /** The recorded Transcript version the Fake Harness replays (TEST-6); newest when unset. */
  version?: string;
  usage?: ClaudeUsageDecl | Record<string, unknown>;
}

/** A live Session, started as a Fake Harness in the World's tmux (TEST-1.4). */
export interface SessionDecl {
  harness: HarnessId;
  status?: 'idle' | 'busy' | 'waiting';
  /** Relative to the World's HOME, or absolute. */
  cwd?: string;
  /** A recorded fixture (TEST-6), e.g. `claude/2.1.170/reply`. */
  transcript?: string;
}

export interface RepoDecl {
  name: string;
  worktrees?: string[];
}

/** A past Session for History (HIST), written where tb-session indexes it. */
export interface PastSessionDecl {
  harness: HarnessId;
  transcript: string;
  cwd?: string;
}

/** `user.name` and `user.email` in the World's `~/.gitconfig` (TEST-1.5). */
export interface GitIdentityDecl {
  name: string;
  email: string;
}

/**
 * An open Task the fake `tb-prod` returns for its assignee's email (WORK-2), declared flat: the
 * fake turns it into JSON:API, with its project and workflow status under `included`.
 */
export interface TaskDecl {
  /** Productive's id: digits only. */
  id: string;
  title: string;
  /** The project's name. */
  project: string;
  /** The workflow status's name; "In progress" (or "Not started" in category 1) when unset. */
  status?: string;
  /** The status's category: 1 not started, 2 started (the default). Closed Tasks aren't open. */
  statusCategory?: 1 | 2;
  /** `YYYY-MM-DD`. */
  dueDate?: string;
  /** RFC 3339, as Productive gives it; the fake answers the most recently active first, as WORK's `--sort=-last_activity_at` asks. */
  lastActivityAt?: string;
  /** `type_id` 3. */
  milestone?: boolean;
  /** The description, as HTML, as Productive gives it (WORK-2.11); none when unset. */
  description?: string;
}

/**
 * How the fake `tb-prod` fails instead of answering (WORK-7.6): no config (exit 1, "No config
 * found" on stderr), an `api_error` with that status (exit 1, JSON on stdout), or no answer at all.
 */
export type TbProdFailure = 'no-config' | 401 | 403 | 'timeout';

/** What the fake `tb-prod` answers (TEST-1.5); a test can change it while it runs (TEST-1.6). */
export interface TbProdDecl {
  /** The open Tasks assigned to each email, in any order: the fake answers them sorted as WORK asks. An email not here has none. */
  tasks?: Record<string, TaskDecl[]>;
  /** Instead of Tasks, every `query tasks` fails this way. */
  failure?: TbProdFailure;
}

/** A `tb-pr` column (`list --json`'s `columns`). */
export type TbPrColumn = 'draft_mine' | 'review_mine' | 'ready_to_merge_mine' | 'waiting_on_me' | 'waiting_on_author';
export const TB_PR_COLUMNS: readonly TbPrColumn[] = ['draft_mine', 'review_mine', 'ready_to_merge_mine', 'waiting_on_me', 'waiting_on_author'];

/**
 * A PR on the fake `tb-pr`'s board, in `tb-pr list --json`'s own fields. What isn't declared gets
 * a default: `url` from the repo and number in `productiveio`, `state` from its column, `author`
 * the board's user in a Mine column, `age_days` 1, `rotting` fresh, no CI.
 */
export interface PrDecl {
  number: number;
  /** The repo's name in `productiveio`, as tb-pr gives it: `anvil`, not `productiveio/anvil`. */
  repo: string;
  title: string;
  url?: string;
  author?: string;
  state?: 'draft' | 'ready' | 'approved';
  /** RFC 3339 in UTC (`…Z`), as tb-pr prints it; when unset, `age_days` before the call. */
  created_at?: string;
  age_days?: number;
  size?: 'XS' | 'S' | 'M' | 'L' | 'XL' | null;
  rotting?: 'fresh' | 'warming' | 'stale' | 'rotting' | 'critical';
  comments_count?: number;
  base_branch?: string | null;
  head_branch?: string;
  /** `unknown` from tb-pr 0.4.0: it couldn't read the check-runs. */
  check_state?: 'success' | 'failure' | 'pending' | 'unknown';
  productive_task_id?: string;
  /** From a tb-pr with Gap 1 (WORK-4.1); refused on a board declared `withTaskIds: false`. */
  task_ids?: { id: string; source: 'branch' | 'body' }[];
  has_new_commits_since_my_review?: boolean;
  changes_requested_by?: string[];
}

/**
 * A `column_issues` entry, as tb-pr 0.3.1 prints it (`ColumnIssue`, `merge_with_previous`). A column
 * has at most one. A flagged column has PRs only when its search came back incomplete (its own
 * fresh list) or when tb-pr put back the list of an earlier fetch, at most an hour old, marked by
 * `restored_from`. "search returned empty" means no search returned a PR, so every list on that
 * board is a put-back one.
 */
export interface TbPrColumnIssue {
  column: TbPrColumn | 'mentions';
  reason: string;
  /** RFC 3339 in UTC (`…Z`): when the fetch that last returned this column's list ran. Only on a PR column with PRs. */
  restored_from?: string;
}
/** `SEARCH_INCOMPLETE_REASON` and `SEARCH_EMPTY_REASON` in tb-pr's `core/github.rs`. */
export const TB_PR_SEARCH_INCOMPLETE = 'search incomplete';
export const TB_PR_SEARCH_EMPTY = 'search returned empty';
/** The columns the author search feeds, split by approval (`SEARCH_COLUMNS` in tb-pr's `core/github.rs`). */
const AUTHOR_SEARCH_COLUMNS = ['review_mine', 'ready_to_merge_mine'] as const;
/** `MAX_RESTORED_AGE_SECS`: tb-pr puts back no list older than this. */
const TB_PR_MAX_RESTORED_MS = 3_600_000;

/** The board the fake `tb-pr` prints for `list --json`. */
export interface TbPrBoardDecl {
  /** The GitHub login; `world-tester` when unset. */
  user?: string;
  /** RFC 3339 in UTC (`…Z`); the moment of the call when unset, as a fresh fetch. */
  fetched_at?: string;
  columns?: Partial<Record<TbPrColumn, PrDecl[]>>;
  column_issues?: TbPrColumnIssue[];
  /** False: a tb-pr from before Gap 1, whose PRs have no `task_ids`. Otherwise every PR has them, `[]` when it has none. */
  withTaskIds?: boolean;
}

/**
 * How the fake `tb-pr` fails, both `list --json` and `refresh`, instead of answering (WORK-7.6,
 * WORK-8.4), each as tb-pr prints it on stderr with exit 1: gh not signed in (`gh auth token`), a
 * revoked token (`GitHub API error (401)`), GitHub's rate limit without a reset time (a 429) or with
 * one (a 403 that "resets at HH:MM:SS UTC", from this RFC 3339 time in UTC), or no answer at all.
 */
export type TbPrFailure = 'gh-auth' | 401 | 'rate-limited' | { rateLimitedUntil: string } | 'timeout';

/** What the fake `tb-pr` answers (TEST-1.5); a test can change it while it runs (TEST-1.6). */
export interface TbPrDecl {
  board?: TbPrBoardDecl;
  /** `refresh`'s exit code: 0 (the default) prints tb-pr's summary of the board, anything else fails. */
  refreshExit?: number;
  /** Instead of the board, `list --json` and `refresh` both fail this way. */
  failure?: TbPrFailure;
}

export interface WorldSpec {
  /** Real tools removed from PATH (and from `LOOKOUT_*_BIN`). */
  without: RemovableTool[];
  /** Harnesses present, each with its Fake Harness on PATH. Absent unless declared. */
  harnesses: Partial<Record<HarnessId, HarnessDecl>>;
  /** Harnesses declared absent on purpose; reported in the declaration, absent either way. */
  absentHarnesses: HarnessId[];
  sessions: SessionDecl[];
  repos: RepoDecl[];
  history: PastSessionDecl[];
  jev: 'absent' | 'ready' | 'not-set-up';
  /** A global git identity in `~/.gitconfig`; none unless declared. */
  gitIdentity: GitIdentityDecl | null;
  /** The fake `tb-prod` on PATH and what it answers; absent unless declared. */
  tbProd: TbProdDecl | null;
  /** The fake `tb-pr` on PATH and what it answers; absent unless declared. */
  tbPr: TbPrDecl | null;
  /** `lastLaunch`: what the launcher remembers as started last (WORK-5.2). */
  settings: Partial<Pick<Settings, 'idleThresholdHours' | 'startDirectories' | 'lastLaunch' | 'productiveEmail'>>;
}

/** A declaration this slice can't build yet: the World refuses it instead of ignoring it. */
export class NotYetBuilt extends Error {
  constructor(what: string, criterion: string) {
    super(`${what} isn't built yet (${criterion}, docs/features/behaviour-tests/SPEC.md).`);
  }
}

export class WorldBuilder {
  readonly spec: Readonly<WorldSpec>;

  constructor(spec: WorldSpec) {
    this.spec = spec;
  }

  private next(patch: Partial<WorldSpec>): WorldBuilder {
    return new WorldBuilder({ ...this.spec, ...patch });
  }

  /**
   * A Harness present: its Fake Harness on PATH, its home directory, its launcher in the Fleet
   * config, and optionally usage numbers.
   *
   * TODO(TEST-1.4, TEST-1.6, TEST-1.7, TEST-1.10): Fake Harnesses, fake `curl` and the `ps` shim.
   * Codex must not be declared before the `ps` shim exists: Fleet scans every process for
   * `codex`, so the user's own Codex TUIs would show up in the World.
   */
  with(harness: HarnessId, decl: HarnessDecl = {}): WorldBuilder {
    void decl;
    throw new NotYetBuilt(`world().with('${harness}')`, 'TEST-1.4');
  }

  /**
   * Absent on every axis Lookout and Fleet check. For a Harness: no CLI, no home directory, and
   * a launcher in the Fleet config that doesn't exist (`.without('codex')` removes both the CLI
   * and `~/.codex`). For Fleet or tb-session: not on PATH, no `LOOKOUT_*_BIN`.
   */
  without(what: HarnessId | RemovableTool): WorldBuilder {
    if (what === 'claude' || what === 'codex') {
      const { [what]: _removed, ...harnesses } = this.spec.harnesses;
      return this.next({ harnesses, absentHarnesses: unique([...this.spec.absentHarnesses, what]) });
    }
    return this.next({ without: unique([...this.spec.without, what]) });
  }

  /** TODO(TEST-1.4): a live Session as a Fake Harness; the World waits until Fleet lists it. */
  session(decl: SessionDecl): WorldBuilder {
    void decl;
    throw new NotYetBuilt('world().session()', 'TEST-1.4');
  }

  /** TODO(TEST-1.5): a git repo under `~/Projects`, with Worktrees. */
  repo(name: string, opts: Omit<RepoDecl, 'name'> = {}): WorldBuilder {
    void name;
    void opts;
    throw new NotYetBuilt('world().repo()', 'TEST-1.5');
  }

  /** TODO(TEST-1.5, TEST-6): past Sessions from recorded Transcripts, for History. */
  history(sessions: PastSessionDecl[]): WorldBuilder {
    void sessions;
    throw new NotYetBuilt('world().history()', 'TEST-1.5');
  }

  /** TODO(TEST-1.7): the fake `tb-jev`, answering `status --json` with USAGE's 0.2.0 contract. */
  jev(state: 'ready' | 'not-set-up'): WorldBuilder {
    void state;
    throw new NotYetBuilt('world().jev()', 'TEST-1.7');
  }

  /** A global git identity: `user.name` and `user.email` in `~/.gitconfig` (WORK-2.5). */
  gitIdentity(identity: GitIdentityDecl): WorldBuilder {
    return this.next({ gitIdentity: checkGitIdentity(identity) });
  }

  /**
   * The fake `tb-prod` on PATH, answering `query tasks` with the Tasks declared for the email in
   * its filter, or failing as declared. `world.tbProd` changes or holds its answer mid-test (TEST-1.6).
   */
  tbProd(decl: TbProdDecl = {}): WorldBuilder {
    return this.next({ tbProd: checkTbProd(decl) });
  }

  /**
   * The fake `tb-pr` on PATH, answering `list --json` with the declared board and `refresh` with the
   * declared exit code, or failing as declared. `world.tbPr` changes or holds its answer mid-test (TEST-1.6).
   */
  tbPr(decl: TbPrDecl = {}): WorldBuilder {
    return this.next({ tbPr: checkTbPr(decl) });
  }

  /** Lookout's settings file, merged over the defaults. */
  settings(settings: WorldSpec['settings']): WorldBuilder {
    return this.next({ settings: { ...this.spec.settings, ...settings } });
  }

  /** The World's declaration, as it goes into a failure report (TEST-2.4). */
  declaration(): WorldSpec {
    return structuredClone(this.spec) as WorldSpec;
  }
}

/** An empty World (TEST-1.5). Helpers for common Worlds are built on top of it, never instead. */
export function world(): WorldBuilder {
  return new WorldBuilder({
    without: [],
    harnesses: {},
    absentHarnesses: [],
    sessions: [],
    repos: [],
    history: [],
    jev: 'absent',
    gitIdentity: null,
    tbProd: null,
    tbPr: null,
    settings: {},
  });
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** A declaration the World can't build as written: refused when it's made, never half-built. */
function refuse(what: string, why: string): never {
  throw new Error(`${what}: ${why}`);
}

const RFC3339 = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:(?:[0-5]\d|60)(?:\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
/** Whether the day exists in that month: `Date.parse` takes February 30 and makes it March 2. */
const isCalendarDay = (year: string, month: string, day: string) => {
  const y = Number(year);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(month) - 1] ?? 0;
  return Number(day) >= 1 && Number(day) <= days;
};
const isDate = (s: string) => {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s);
  return !!m && isCalendarDay(m[1] ?? '', m[2] ?? '', m[3] ?? '');
};
/**
 * An RFC 3339 time, as Productive gives one, or with `utc`, one in UTC (`…Z`), the only kind tb-pr
 * prints (chrono's `DateTime<Utc>`). `Date.parse` alone takes local times, `Oct 19 2026` and days a
 * month doesn't have, none of which either ever prints.
 */
const isRfc3339 = (s: unknown, o: { utc?: boolean } = {}) => {
  const m = typeof s === 'string' ? RFC3339.exec(s) : null;
  return !!m && isCalendarDay(m[1] ?? '', m[2] ?? '', m[3] ?? '') && (!o.utc || m[4] === 'Z') && !Number.isNaN(Date.parse(m[0]));
};
const isUtc = (s: unknown) => isRfc3339(s, { utc: true });
const oneLine = (s: unknown) => typeof s === 'string' && s.trim() !== '' && !/[\n\r\0]/.test(s);

export function checkGitIdentity(identity: GitIdentityDecl): GitIdentityDecl {
  for (const key of ['name', 'email'] as const) {
    if (!oneLine(identity[key])) refuse('.gitIdentity()', `${key} must be one non-empty line, got ${JSON.stringify(identity[key])}`);
  }
  return { name: identity.name, email: identity.email };
}

export function checkTbProd(decl: TbProdDecl): TbProdDecl {
  const what = 'tb-prod';
  if (decl.failure !== undefined && !['no-config', 401, 403, 'timeout'].includes(decl.failure)) refuse(what, `unknown failure ${JSON.stringify(decl.failure)}`);
  for (const [email, tasks] of Object.entries(decl.tasks ?? {})) {
    if (!oneLine(email)) refuse(what, `an assignee email must be one non-empty line, got ${JSON.stringify(email)}`);
    for (const t of tasks) {
      if (!/^\d+$/.test(t.id)) refuse(what, `a Task's id is digits only, got ${JSON.stringify(t.id)}`);
      if (!oneLine(t.title) || !oneLine(t.project)) refuse(what, `Task ${t.id} needs a title and a project`);
      if (t.status !== undefined && !oneLine(t.status)) refuse(what, `Task ${t.id}'s status must be one non-empty line`);
      if (t.statusCategory !== undefined && t.statusCategory !== 1 && t.statusCategory !== 2) refuse(what, `Task ${t.id} is open: its status category is 1 or 2`);
      if (t.dueDate !== undefined && !isDate(t.dueDate)) refuse(what, `Task ${t.id}'s dueDate is YYYY-MM-DD`);
      if (t.lastActivityAt !== undefined && !isRfc3339(t.lastActivityAt)) refuse(what, `Task ${t.id}'s lastActivityAt is an RFC 3339 time, got ${JSON.stringify(t.lastActivityAt)}`);
    }
  }
  return structuredClone(decl);
}

export function checkTbPr(decl: TbPrDecl): TbPrDecl {
  const what = 'tb-pr';
  const f = decl.failure;
  if (f !== undefined && !['gh-auth', 401, 'rate-limited', 'timeout'].includes(f as string | number) && !(typeof f === 'object' && isUtc(f.rateLimitedUntil))) {
    refuse(what, `unknown failure ${JSON.stringify(f)}`);
  }
  if (decl.refreshExit !== undefined && !(Number.isInteger(decl.refreshExit) && decl.refreshExit >= 0 && decl.refreshExit <= 255)) refuse(what, 'refreshExit is an exit code, 0 to 255');
  const board = decl.board ?? {};
  if (board.fetched_at !== undefined && !isUtc(board.fetched_at)) refuse(what, `fetched_at is an RFC 3339 time in UTC, got ${JSON.stringify(board.fetched_at)}`);
  for (const [column, prs] of Object.entries(board.columns ?? {})) {
    if (!(TB_PR_COLUMNS as readonly string[]).includes(column)) refuse(what, `unknown column ${column}`);
    for (const pr of prs ?? []) {
      if (!Number.isInteger(pr.number) || pr.number <= 0) refuse(what, `a PR's number is a positive integer, got ${JSON.stringify(pr.number)}`);
      if (!/^[\w.-]+$/.test(pr.repo ?? '')) refuse(what, `PR #${pr.number}'s repo is a bare repo name, got ${JSON.stringify(pr.repo)}`);
      if (!oneLine(pr.title)) refuse(what, `PR #${pr.number} needs a title`);
      if (pr.created_at !== undefined && !isUtc(pr.created_at)) refuse(what, `PR #${pr.number}'s created_at is an RFC 3339 time in UTC, got ${JSON.stringify(pr.created_at)}`);
      if (pr.task_ids && board.withTaskIds === false) refuse(what, `PR #${pr.number} has task_ids on a board declared withTaskIds: false`);
      for (const ref of pr.task_ids ?? []) {
        if (!/^[0-9]+$/.test(ref.id) || !['branch', 'body'].includes(ref.source)) refuse(what, `PR #${pr.number} has an invalid task_ids entry ${JSON.stringify(ref)}`);
      }
    }
  }
  // The board as tb-pr 0.3.1 can print it (TbPrColumnIssue).
  const issues = board.column_issues ?? [];
  const prsIn = (column: TbPrColumn | 'mentions') => (column === 'mentions' ? 0 : (board.columns?.[column]?.length ?? 0));
  const fetchedAt = board.fetched_at === undefined ? Date.now() : Date.parse(board.fetched_at);
  const flagged = new Set<string>();
  for (const issue of issues) {
    if (![...TB_PR_COLUMNS, 'mentions'].includes(issue.column) || !oneLine(issue.reason)) refuse(what, `invalid column_issues entry ${JSON.stringify(issue)}`);
    if (flagged.has(issue.column)) refuse(what, `${issue.column} has two column_issues entries; tb-pr flags a column once`);
    flagged.add(issue.column);
    if (issue.restored_from !== undefined) {
      if (!isUtc(issue.restored_from)) refuse(what, `${issue.column}'s restored_from is an RFC 3339 time in UTC, got ${JSON.stringify(issue.restored_from)}`);
      if (prsIn(issue.column) === 0) refuse(what, `${issue.column} has restored_from but no PRs: tb-pr sets it only on a PR column it put a list back into`);
      const restored = Date.parse(issue.restored_from);
      if (restored > fetchedAt || Math.max(fetchedAt, Date.now()) - restored > TB_PR_MAX_RESTORED_MS) {
        refuse(what, `${issue.column}'s restored_from must be within the hour before fetched_at and now: tb-pr puts back no older list`);
      }
    } else if (prsIn(issue.column) > 0 && issue.reason !== TB_PR_SEARCH_INCOMPLETE) {
      refuse(what, `${issue.column} has PRs and the issue "${issue.reason}" but no restored_from: tb-pr keeps a flagged column's own list only when its search came back incomplete, and marks a list it put back with restored_from`);
    }
  }
  // One search, the author's, feeds both review_mine and ready_to_merge_mine (`SEARCH_COLUMNS`), so
  // an error or an incomplete search flags both alike. Only "search returned empty" can later be
  // dropped from one of them (`merge_with_previous`).
  const [review, ready] = AUTHOR_SEARCH_COLUMNS.map((c) => issues.find((i) => i.column === c));
  for (const [issue, other, otherColumn] of [[review, ready, 'ready_to_merge_mine'], [ready, review, 'review_mine']] as const) {
    if (issue && issue.reason !== TB_PR_SEARCH_EMPTY && other?.reason !== issue.reason) {
      refuse(what, `${issue.column} has the issue "${issue.reason}" but ${otherColumn} ${other ? `has "${other.reason}"` : 'has none'}: one search feeds both, so tb-pr flags both with the same reason`);
    }
  }
  if (issues.some((i) => i.reason === TB_PR_SEARCH_EMPTY)) {
    for (const column of TB_PR_COLUMNS) {
      if (prsIn(column) > 0 && !issues.some((i) => i.column === column && i.restored_from !== undefined)) {
        refuse(what, `${column} has PRs of its own next to "${TB_PR_SEARCH_EMPTY}", which tb-pr says only when no search returned a PR`);
      }
    }
  }
  return structuredClone(decl);
}
