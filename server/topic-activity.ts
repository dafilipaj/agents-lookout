import type { ActivityData, ActivityKind } from '../shared/topics.ts';
import type { CiState, PrChip, PrColumn, WorkSnapshot } from '../shared/work.ts';
import { MAX_TASK_PAGES } from './work.ts';

/** WORK-2.1: a Task read holds at most this many (pages of 20). */
const MAX_TASKS = MAX_TASK_PAGES * 20;

/**
 * TOPIC-12.2: what Lookout last saw of a member (`members.observed`), and how what it sees now turns
 * into activity. Only what Lookout knows counts as a change: a sighting of `unknown` keeps what it
 * last saw and records nothing. Pure, so every rule is tested on its own.
 */

/** A Session: in Fleet's list, and how many lists in a row it has been missing from while counted live. */
export interface SessionObserved {
  live: boolean;
  missed: number;
}
/**
 * A PR: in Work's read, its CI, whether a failing was recorded and no passing since (`failing`), or
 * seen failing at its first sighting and never recorded (`quiet`), its chip and column.
 */
export interface PrObserved {
  inWork: boolean;
  ci: CiState;
  failing: boolean;
  quiet?: boolean;
  chip: PrChip | null;
  column: PrColumn | null;
}
/** A Task: in Work's read and its status, for the email that read was for. */
export interface TaskObserved {
  inWork: boolean;
  status: string | null;
  email: string | null;
}
export type Observed = SessionObserved | PrObserved | TaskObserved;

export interface Change {
  kind: ActivityKind;
  data?: ActivityData;
}
/** `next` null: nothing known yet, so nothing is kept either. */
export interface Step<T> {
  next: T | null;
  changes: Change[];
}

/** TOPIC-12.2: "ended" needs a Session missing from this many lists in a row. */
export const ENDED_AFTER_MISSES = 2;

export function observeSession(prev: SessionObserved | null, live: boolean): Step<SessionObserved> {
  if (!prev) return { next: { live, missed: 0 }, changes: [] };
  if (live) return { next: { live: true, missed: 0 }, changes: prev.live ? [] : [{ kind: 'live' }] };
  if (!prev.live) return { next: prev, changes: [] };
  const missed = prev.missed + 1;
  if (missed >= ENDED_AFTER_MISSES) return { next: { live: false, missed: 0 }, changes: [{ kind: 'ended' }] };
  return { next: { live: true, missed }, changes: [] };
}

/** What a Work read says about a PR: unknown, not in it, or in it as it is now. */
export type PrSighting = 'unknown' | { inWork: false } | { inWork: true; ci: CiState; chip: PrChip | null; column: PrColumn };

export function observePr(prev: PrObserved | null, now: PrSighting): Step<PrObserved> {
  // An unknown first sighting is no sighting: nothing is made up to compare the next one with.
  if (now === 'unknown') return { next: prev, changes: [] };
  if (!now.inWork) {
    if (!prev) return { next: { inWork: false, ci: 'unknown', failing: false, chip: null, column: null }, changes: [] };
    return { next: { ...prev, inWork: false }, changes: prev.inWork ? [{ kind: 'gone' }] : [] };
  }
  // Failing at its first sighting is what Lookout saw, not a change: no entry now, and no "passing" later.
  if (!prev) return { next: { inWork: true, ci: now.ci, failing: false, quiet: now.ci === 'failing', chip: now.chip, column: now.column }, changes: [] };
  const changes: Change[] = [];
  if (!prev.inWork) changes.push({ kind: 'back' });
  // `unknown`, `none` and `running` say nothing about whether it's failing.
  let failing = prev.failing;
  let quiet = prev.quiet ?? false;
  if (now.ci === 'failing' && !prev.failing && !quiet) {
    changes.push({ kind: 'ci-failing' });
    failing = true;
  } else if (now.ci === 'passing') {
    if (prev.failing) changes.push({ kind: 'ci-passing' });
    failing = false;
    quiet = false;
  }
  // Review requests carry no chip: that's no change.
  if (now.chip && prev.chip && now.chip !== prev.chip) changes.push({ kind: 'chip', data: { to: now.chip } });
  return { next: { inWork: true, ci: now.ci, failing, ...(quiet ? { quiet } : {}), chip: now.chip ?? prev.chip, column: now.column }, changes };
}

/** What a Work read says about a Task. */
export type TaskSighting = 'unknown' | { inWork: false; email: string } | { inWork: true; status: string | null; email: string };

export function observeTask(prev: TaskObserved | null, now: TaskSighting): Step<TaskObserved> {
  if (now === 'unknown') return { next: prev, changes: [] };
  // A first sighting, or a read for another email, starts over.
  if (!prev || prev.email !== now.email) return { next: { inWork: now.inWork, status: now.inWork ? now.status : null, email: now.email }, changes: [] };
  const next: TaskObserved = now.inWork ? { inWork: true, status: now.status, email: now.email } : { inWork: false, status: prev.status, email: now.email };
  if (prev.inWork && !now.inWork) return { next, changes: [{ kind: 'gone' }] };
  if (!now.inWork) return { next, changes: [] };
  const changes: Change[] = [];
  if (!prev.inWork) changes.push({ kind: 'back' });
  if (now.status && prev.status && now.status !== prev.status) changes.push({ kind: 'task-status', data: { to: now.status } });
  return { next, changes };
}

/**
 * TOPIC-12.2: what a Work read says about each PR, by URL, and about any PR it doesn't list. A failed
 * or stale read says nothing; a PR whose column, now or when last seen, tb-pr put back or a search
 * left out (WORK-7.5) says nothing either.
 */
export function prSightings(work: WorkSnapshot): (url: string, prev: PrObserved | null) => PrSighting {
  const prs = work.prs;
  if (prs.state !== 'ok' || prs.stale) return () => 'unknown';
  const listed = new Map<string, { ci: CiState; chip: PrChip | null; column: PrColumn; marked: boolean }>();
  const markedIn = (marks: readonly { columns: readonly PrColumn[] }[]) => new Set(marks.flatMap((m) => m.columns));
  const mineMarked = markedIn(prs.marks.mine);
  const reviewMarked = markedIn(prs.marks.reviewRequests);
  for (const p of prs.mine) listed.set(p.url, { ci: p.ci, chip: p.chip, column: p.column, marked: mineMarked.has(p.column) });
  for (const p of prs.reviewRequests) if (!listed.has(p.url)) listed.set(p.url, { ci: p.ci, chip: p.chip, column: p.column, marked: reviewMarked.has(p.column) });
  return (url, prev) => {
    const p = listed.get(url);
    if (p) return p.marked ? 'unknown' : { inWork: true, ci: p.ci, chip: p.chip, column: p.column };
    if (prev?.column && (mineMarked.has(prev.column) || reviewMarked.has(prev.column))) return 'unknown';
    return { inWork: false };
  };
}

/**
 * TOPIC-12.2: what a Work read says about each Task, by id. A failed or stale read, no email, and a
 * read at the cap (a Task it doesn't list may be past it) say nothing of a Task it doesn't list.
 */
export function taskSightings(work: WorkSnapshot, email: string | null): (id: string) => TaskSighting {
  const tasks = work.tasks;
  if (tasks.state !== 'ok' || tasks.stale || !email) return () => 'unknown';
  const listed = new Map(tasks.tasks.map((t) => [t.id, t.status]));
  const full = tasks.tasks.length >= MAX_TASKS;
  return (id) => {
    if (listed.has(id)) return { inWork: true, status: listed.get(id) ?? null, email };
    return full ? 'unknown' : { inWork: false, email };
  };
}
