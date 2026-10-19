import { CHIP_OF, type ColumnMark, type PrSection, type WorkPr, type WorkSnapshot } from '@shared/work.ts';
import type { WorkFilter } from './right-sidebar.ts';
import { formatAge } from './time.ts';

/** WORK-3.1: the two PR groups, in the order they show. */
export type PrGroup = 'mine' | 'reviewRequests';
export const PR_GROUPS: readonly PrGroup[] = ['mine', 'reviewRequests'];
export const PR_GROUP_LABEL: Record<PrGroup, string> = { mine: 'Mine', reviewRequests: 'Review requests' };

/** One row of Work: a PR (Tasks come with slice C). */
export interface WorkRow {
  /** Stable across reads, for the keyboard selection (WORK-1.9). */
  key: string;
  kind: 'pr';
  group: PrGroup;
  pr: WorkPr;
}

export const prKey = (pr: WorkPr) => `pr:${pr.url}`;

/** WORK-1.5: whether the filter shows the PRs section. */
export const showsPrs = (filter: WorkFilter) => filter === 'all' || filter === 'prs';

/** Whether a PR section has lists to show: read once at least, also when a later read failed (WORK-7.3). */
export function hasPrLists(prs: PrSection): boolean {
  return prs.state === 'ok' || prs.stale;
}

/** The rows of the visible sections, top to bottom: what ↑/↓ and j/k move through (WORK-1.7). */
export function visibleRows(work: WorkSnapshot | null, filter: WorkFilter): WorkRow[] {
  if (!work || !showsPrs(filter) || !hasPrLists(work.prs)) return [];
  return PR_GROUPS.flatMap((group) => work.prs[group].map((pr): WorkRow => ({ key: prKey(pr), kind: 'pr', group, pr })));
}

/**
 * WORK-1.9: the selection stays on its item while that item is visible; once a filter change or a
 * read removes it, it moves to the first visible row, or to none when nothing is visible.
 */
export function keepSelection(current: string | null, rows: readonly WorkRow[]): string | null {
  if (current !== null && rows.some((r) => r.key === current)) return current;
  return rows[0]?.key ?? null;
}

/** WORK-5.2: the launcher's prompt for a Review request. */
export const reviewPrompt = (url: string) => `/p-codex:dual-review ${url}`;

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
