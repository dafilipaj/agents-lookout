import type { SessionRow, Status } from './types.ts';

export const STATUS_ORDER: readonly Status[] = ['needs-you', 'busy', 'idle', 'unknown'];

const rank = (s: Status) => STATUS_ORDER.indexOf(s);

/** SIDE-3.1: Needs you → Busy → Idle → Unknown; most recent status change first within each. */
export function compareSessions(a: SessionRow, b: SessionRow): number {
  const byStatus = rank(a.status) - rank(b.status);
  if (byStatus !== 0) return byStatus;
  const bySince = (b.statusSince ?? 0) - (a.statusSince ?? 0);
  if (bySince !== 0) return bySince;
  return a.id.localeCompare(b.id);
}

export function sortSessions(rows: readonly SessionRow[]): SessionRow[] {
  return [...rows].sort(compareSessions);
}

/** SIDE-1.5, SIDE-3.1: the sidebar's order: Controllable Sessions first, then View only; each in Status order. */
export function sidebarOrder(rows: readonly SessionRow[]): SessionRow[] {
  return [...sortSessions(rows.filter((s) => s.controllable)), ...sortSessions(rows.filter((s) => !s.controllable))];
}
