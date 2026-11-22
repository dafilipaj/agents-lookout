import { useEffect, useState } from 'react';
import type { SessionRow } from '@shared/types.ts';

/** SIDE-13.3: when this tab last left each Session's view, ms since epoch. */
export type LeftAt = ReadonlyMap<string, number>;

/**
 * SIDE-13.2: when you last saw the Session: the later of the server's record (`viewedAt`) and this
 * tab's leaving its view; null with neither, a Session you've never opened in Lookout.
 */
export function lastSeen(row: Pick<SessionRow, 'id' | 'viewedAt'>, leftAt: LeftAt): number | null {
  const server = typeof row.viewedAt === 'number' ? row.viewedAt : null;
  const here = leftAt.get(row.id) ?? null;
  if (server === null) return here;
  if (here === null) return server;
  return Math.max(server, here);
}

/** SIDE-13.2: Idle, and it went Idle after you last saw it. Whether a tab shows it is the caller's. */
export function wentIdleUnseen(row: Pick<SessionRow, 'id' | 'status' | 'statusSince' | 'viewedAt'>, leftAt: LeftAt): boolean {
  if (row.status !== 'idle' || row.statusSince === null) return false;
  const seen = lastSeen(row, leftAt);
  return seen !== null && row.statusSince > seen;
}

/**
 * SIDE-13.2: the Unread Sessions: those that went Idle after you last saw them, but the one this
 * tab shows (`shown`: the selected Session while the tab is visible, else null).
 */
export function unreadIds(rows: Iterable<SessionRow>, shown: string | null, leftAt: LeftAt): Set<string> {
  const out = new Set<string>();
  for (const row of rows) if (row.id !== shown && wentIdleUnseen(row, leftAt)) out.add(row.id);
  return out;
}

/** SIDE-3.3, SIDE-13.6: "(2) • Lookout": the Needs you count, then a dot while any Session is Unread. */
export function tabTitle(needsYou: number, unread: number): string {
  return [needsYou > 0 ? `(${needsYou})` : null, unread > 0 ? '•' : null, 'Lookout'].filter(Boolean).join(' ');
}

/** SIDE-13.3: whether the page is visible, following `visibilitychange`. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}
