import type { SessionRow, Status } from './types.ts';

export const STATUS_ORDER: readonly Status[] = ['needs-you', 'busy', 'idle', 'unknown'];

/** SIDE-3.1, SIDE-13.4: Needs you → Unread → Busy → Idle → Unknown. */
function rank(row: SessionRow, unread: ReadonlySet<string> | undefined): number {
  if (row.status === 'needs-you') return 0;
  if (row.status === 'idle' && unread?.has(row.id)) return 1;
  return 1 + STATUS_ORDER.indexOf(row.status);
}

/**
 * SIDE-3.1, SIDE-13.4: Needs you → Unread → Busy → Idle → Unknown; most recent status change first
 * within each. `unread`: the Idle Sessions that count as Unread for the order.
 */
export function compareSessions(a: SessionRow, b: SessionRow, unread?: ReadonlySet<string>): number {
  const byStatus = rank(a, unread) - rank(b, unread);
  if (byStatus !== 0) return byStatus;
  const bySince = (b.statusSince ?? 0) - (a.statusSince ?? 0);
  if (bySince !== 0) return bySince;
  return a.id.localeCompare(b.id);
}

export function sortSessions(rows: readonly SessionRow[], unread?: ReadonlySet<string>): SessionRow[] {
  return [...rows].sort((a, b) => compareSessions(a, b, unread));
}

/** SIDE-1.5, SIDE-3.1: the sidebar's order: Controllable Sessions first, then View only; each in Status order. */
export function sidebarOrder(rows: readonly SessionRow[], unread?: ReadonlySet<string>): SessionRow[] {
  return [...sortSessions(rows.filter((s) => s.controllable), unread), ...sortSessions(rows.filter((s) => !s.controllable), unread)];
}
