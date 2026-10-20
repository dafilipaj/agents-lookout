import { CHIP_OF, type ColumnMark, type PrSection, type TaskSection, type WorkPr, type WorkSnapshot, type WorkTask } from '@shared/work.ts';
import type { WorkFilter } from './right-sidebar.ts';
import { CONTEXT_LEVEL_CLASS } from './sessions.ts';
import { formatAge } from './time.ts';

/** WORK-3.1: the two PR groups, in the order they show. */
export type PrGroup = 'mine' | 'reviewRequests';
export const PR_GROUPS: readonly PrGroup[] = ['mine', 'reviewRequests'];
export const PR_GROUP_LABEL: Record<PrGroup, string> = { mine: 'Mine', reviewRequests: 'Review requests' };

/** One row of Work: a Task (WORK-2) or a PR (WORK-3). `key` is stable across reads, for the keyboard selection (WORK-1.9). */
export type WorkRow = { key: string; kind: 'task'; task: WorkTask } | { key: string; kind: 'pr'; group: PrGroup; pr: WorkPr };

export const taskKey = (task: WorkTask) => `task:${task.id}`;
export const prKey = (pr: WorkPr) => `pr:${pr.url}`;

/** WORK-6: where a row opens in the browser: a Task in Fantastic (WORK-6.2), a PR on GitHub (WORK-6.3). */
export const rowUrl = (row: WorkRow) => (row.kind === 'task' ? row.task.url : row.pr.url);

/** WORK-1.5: whether the filter shows the Tasks section. */
export const showsTasks = (filter: WorkFilter) => filter === 'all' || filter === 'tasks';
/** WORK-1.5: whether the filter shows the PRs section. */
export const showsPrs = (filter: WorkFilter) => filter === 'all' || filter === 'prs';

/** Whether a PR section has lists to show: read once at least, also when a later read failed (WORK-7.3). */
export function hasPrLists(prs: PrSection): boolean {
  return prs.state === 'ok' || prs.stale;
}

/** As `hasPrLists`, for Tasks: only ever a list read for the saved email (WORK-2.8). */
export function hasTaskList(tasks: TaskSection): boolean {
  return tasks.state === 'ok' || tasks.stale;
}

/** The rows of the visible sections, top to bottom, Tasks then PRs: what ↑/↓ and j/k move through (WORK-1.7). */
export function visibleRows(work: WorkSnapshot | null, filter: WorkFilter): WorkRow[] {
  if (!work) return [];
  const tasks = showsTasks(filter) && hasTaskList(work.tasks) ? work.tasks.tasks.map((task): WorkRow => ({ key: taskKey(task), kind: 'task', task })) : [];
  const prs =
    showsPrs(filter) && hasPrLists(work.prs) ? PR_GROUPS.flatMap((group) => work.prs[group].map((pr): WorkRow => ({ key: prKey(pr), kind: 'pr', group, pr }))) : [];
  return [...tasks, ...prs];
}

/**
 * WORK-1.9: the selection stays on its item while that item is visible; once a filter change or a
 * read removes it, it moves to the first visible row, or to none when nothing is visible.
 */
export function keepSelection(current: string | null, rows: readonly WorkRow[]): string | null {
  if (current !== null && rows.some((r) => r.key === current)) return current;
  return rows[0]?.key ?? null;
}

const DAY_MS = 86_400_000;

/**
 * WORK-3.5: how old a PR reads, by the time since it was opened: recent under 3 days, aging from 3
 * days up to and including 10, old over 10.
 */
export type AgeLevel = 'recent' | 'aging' | 'old';

export function ageLevel(ms: number): AgeLevel {
  if (ms > 10 * DAY_MS) return 'old';
  if (ms >= 3 * DAY_MS) return 'aging';
  return 'recent';
}

/**
 * The age's colour for each level: green, then the context meter's warning colour (VIEW-5.5), then red.
 * Green and red use their darker text tokens, so the small age text stays readable on a selected row.
 */
export const AGE_LEVEL_CLASS: Record<AgeLevel, string> = {
  recent: 'text-ok-text',
  aging: CONTEXT_LEVEL_CLASS.warning!,
  old: 'text-destructive-text',
};

/** WORK-5.2: the launcher's prompt for a Review request. */
export const reviewPrompt = (url: string) => `/p-codex:dual-review ${url}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * WORK-2.2: a Task's due date, `YYYY-MM-DD` as tb-prod gives it, a day without a time zone: "due Oct
 * 24", with the year when it isn't this year's ("due Jan 5, 2027"), and the full date for its hover.
 * Null for a date it can't read.
 */
export function formatDue(dueDate: string, now: number): { text: string; title: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  const sameYear = year === new Date(now).getFullYear();
  return {
    text: `due ${MONTHS[month - 1]} ${day}${sameYear ? '' : `, ${year}`}`,
    title: `Due ${date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
  };
}

/**
 * WORK-7.5: one entry of a group's "possibly out of date" mark, with the UI's ages (`formatAge`).
 * Mine names its columns by their chips ("draft: GitHub's search came back empty, last confirmed 40m
 * ago"); Review requests is a single column, so its entry doesn't repeat the group's name.
 */
export function describeMark(mark: ColumnMark, group: PrGroup, now: number): string {
  const when = mark.confirmedAt === null ? 'not confirmed yet' : `last confirmed ${formatAge(now - mark.confirmedAt)} ago`;
  const what = `${mark.reason}, ${when}`;
  if (group === 'reviewRequests') return what.charAt(0).toUpperCase() + what.slice(1);
  const chips = mark.columns.map((c) => (c === 'waiting_on_me' ? 'review requests' : CHIP_OF[c]));
  return `${chips.join(', ')}: ${what}`;
}

/** "42s", "5m": how long until a time; seconds rounded up, so it never says 0 while it's still ahead. */
export function backIn(ms: number): string {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
}

/**
 * WORK-8.2, WORK-8.4: whether Refresh can be pressed now, and its hover. Refused by the server
 * during the 60 s cooldown and while GitHub is rate limited, so it's disabled then, saying why and
 * when it's back. The later of the two wins.
 */
export function refreshState(refresh: WorkSnapshot['refresh'] | null, now: number): { disabled: boolean; title: string } {
  const blocked = refresh?.githubBlockedUntil != null && refresh.githubBlockedUntil > now ? refresh.githubBlockedUntil : null;
  const cooling = refresh?.cooldownUntil != null && refresh.cooldownUntil > now ? refresh.cooldownUntil : null;
  if (blocked !== null && (cooling === null || blocked >= cooling)) {
    return { disabled: true, title: `GitHub is rate limited: Refresh is back in ${backIn(blocked - now)}` };
  }
  if (cooling !== null) return { disabled: true, title: `Refresh was used less than a minute ago: it's back in ${backIn(cooling - now)}` };
  return { disabled: false, title: 'Refresh' };
}
