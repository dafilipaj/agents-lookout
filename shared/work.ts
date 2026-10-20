/**
 * WORK: open PRs and Review requests from `tb-pr`, and Tasks from `tb-prod`, as the server sends
 * them to the UI. Contract: docs/features/tasks-and-prs/SPEC.md, "Lookout's side".
 */

/** The `tb-pr` columns Lookout shows (WORK-3.1): Mine is the first three, Review requests the last. */
export const PR_COLUMNS = ['draft_mine', 'review_mine', 'ready_to_merge_mine', 'waiting_on_me'] as const;
export type PrColumn = (typeof PR_COLUMNS)[number];
export const MINE_COLUMNS: readonly PrColumn[] = ['draft_mine', 'review_mine', 'ready_to_merge_mine'];
export const REVIEW_COLUMNS: readonly PrColumn[] = ['waiting_on_me'];

/** WORK-3.2: Mine's state chip, set by the column the PR is in. */
export type PrChip = 'draft' | 'ready' | 'approved';
export const CHIP_OF: Record<Exclude<PrColumn, 'waiting_on_me'>, PrChip> = {
  draft_mine: 'draft',
  review_mine: 'ready',
  ready_to_merge_mine: 'approved',
};

/** WORK-3.2, WORK-3.3: `check_state` success, failure, pending; `none` ("no CI") when tb-pr gives none. Never shown as passing. */
export type CiState = 'passing' | 'failing' | 'running' | 'none';

/** tb-pr's rotting buckets, least urgent first. */
export const ROT_BUCKETS = ['fresh', 'warming', 'stale', 'rotting', 'critical'] as const;
export type RotBucket = (typeof ROT_BUCKETS)[number];

/** A PR → Task id from tb-pr's `task_ids` (Gap 1, WORK-4.1). */
export interface PrTaskRef {
  /** ASCII digits. */
  id: string;
  source: 'branch' | 'body';
}

export interface WorkPr {
  /** The repo's name in `productiveio`, as tb-pr gives it (`lantern`, not `productiveio/lantern`). */
  repo: string;
  number: number;
  title: string;
  /** tb-pr's `url`, always `https://github.com/productiveio/…` (WORK-6.3); a PR without one isn't listed. */
  url: string;
  /** tb-pr's `created_at`, ms since epoch; null when unreadable. */
  createdAt: number | null;
  /** tb-pr's `age_days` when the board was fetched; null when unreadable. */
  ageDays: number | null;
  rotting: RotBucket | null;
  ci: CiState;
  /** Mine's state chip; null in Review requests. */
  chip: PrChip | null;
  column: PrColumn;
  /** tb-pr's `task_ids`; null when this tb-pr doesn't give them (before Gap 1). */
  taskIds: PrTaskRef[] | null;
}

/**
 * WORK-7.5: columns of a group with a `column_issues` entry, grouped by reason and time. `reason` is
 * tb-pr's reason in plain words, never its own. `confirmedAt` is when Lookout last read the column
 * without an issue (ms since epoch), null for "not confirmed yet".
 */
export interface ColumnMark {
  columns: PrColumn[];
  reason: string;
  confirmedAt: number | null;
}

/**
 * - `loading`: nothing read yet;
 * - `ok`: the last read succeeded;
 * - `not-installed`, `signed-out` (WORK-7.6), `error`: the last read failed (WORK-7.1 to 7.3).
 */
export type WorkSourceState = 'loading' | 'ok' | 'not-installed' | 'signed-out' | 'error';

export interface PrSection {
  state: WorkSourceState;
  /** Why the last read failed, as a plain sentence that says what to do; never tb-pr's own text (WORK-7.7). Null when it succeeded. */
  reason: string | null;
  /** The command that fixes it: the install command, or `gh auth login` (WORK-7.1, WORK-7.2). */
  fix: string | null;
  /** True when the lists are from an earlier read than the last one, which failed (WORK-7.3). */
  stale: boolean;
  /** tb-pr's `fetched_at` of the lists shown, ms since epoch ("updated 2m ago", WORK-1.3). */
  fetchedAt: number | null;
  /** WORK-3.1: most urgent first. */
  mine: WorkPr[];
  reviewRequests: WorkPr[];
  /** WORK-7.5: per group, the columns that may be out of date. Empty when every column is confirmed. */
  marks: { mine: ColumnMark[]; reviewRequests: ColumnMark[] };
  /** WORK-4.1: false when the tb-pr read gives no `task_ids` (older than Gap 1); null when it can't tell (no PRs). */
  taskIds: boolean | null;
}

/** WORK-6.2: where a Task opens, Fantastic's canonical task path in organization 109 (Non-goals). */
export const TASK_URL_BASE = 'https://app.fantastic.productive.io/109-productive/tasks/';
export const taskUrl = (id: string): string => `${TASK_URL_BASE}${id}`;

export interface WorkTask {
  /** Productive's id: ASCII digits. */
  id: string;
  title: string;
  /** The project's name; null when tb-prod didn't include it. */
  project: string | null;
  /** The workflow status's name; null when tb-prod didn't include it. */
  status: string | null;
  /** The status's category: 1 not started, 2 started; null for anything else. */
  statusCategory: 'not-started' | 'started' | null;
  /** `YYYY-MM-DD`, null when unset (WORK-2.2). */
  dueDate: string | null;
  /** ms since epoch; null when unreadable. */
  lastActivityAt: number | null;
  /** `type_id` 3 (WORK-2.2). */
  milestone: boolean;
  /** WORK-6.2: built on the server, always `TASK_URL_BASE` + id. */
  url: string;
  /** WORK-2.3, WORK-2.4: the Task's Linked PRs and Sessions, from Links (WORK-4); null until those are built. */
  links: null;
}

/** WORK-2.6: no Productive email is saved, so Tasks isn't read. */
export type TaskSourceState = WorkSourceState | 'no-email';

export interface TaskSection {
  state: TaskSourceState;
  /** As `PrSection`'s: a plain sentence, never tb-prod's own text (WORK-7.7). */
  reason: string | null;
  /** The build command (WORK-7.1, WORK-7.8), or `tb-prod config init` (WORK-7.2). */
  fix: string | null;
  /** As `PrSection`'s, and only ever for a list read for the saved email (WORK-2.8). */
  stale: boolean;
  /** When Lookout's read of the Tasks shown ended, ms since epoch; tb-prod has no cache (WORK-1.3). */
  fetchedAt: number | null;
  /** WORK-2.1: most recently active first, at most 100. */
  tasks: WorkTask[];
}

export interface WorkSnapshot {
  prs: PrSection;
  tasks: TaskSection;
  /** WORK-8.2, WORK-8.4: until when Refresh is refused, ms since epoch; null when it isn't. */
  refresh: {
    /** The 60 s server-wide cooldown after a forced read was accepted. */
    cooldownUntil: number | null;
    /** No GitHub read, scheduled or forced, until then: tb-pr reported a rate limit. */
    githubBlockedUntil: number | null;
  };
}

/** `POST /api/work/refresh`'s answer: refused (409, 429), or the forced read's outcome. */
export type WorkRefreshResult = { ok: true } | { ok: false; error: string; until?: number };
