import type { HistoryItem, SessionRow } from '@shared/types.ts';

/** HIST-1.3: the right sidebar's width bounds, in px. */
export const HISTORY_MIN_WIDTH = 280;
export const HISTORY_MAX_WIDTH = 720;
export const HISTORY_DEFAULT_WIDTH = 360;
const KEY = 'lookout.history';

/** HIST-1.3: whether the right sidebar is open, and its width; kept in this browser. */
export interface HistoryLayout {
  open: boolean;
  width: number;
}

export const clampWidth = (w: number) => Math.round(Math.min(HISTORY_MAX_WIDTH, Math.max(HISTORY_MIN_WIDTH, w)));

/** Reads the layout; storage can be missing or blocked, so anything odd is the default. */
export function loadLayout(): HistoryLayout {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    if (typeof v === 'object' && v !== null) {
      const r = v as Record<string, unknown>;
      return {
        open: r.open === true,
        width: typeof r.width === 'number' && Number.isFinite(r.width) ? clampWidth(r.width) : HISTORY_DEFAULT_WIDTH,
      };
    }
  } catch {
    // no storage here
  }
  return { open: false, width: HISTORY_DEFAULT_WIDTH };
}

export function saveLayout(layout: HistoryLayout): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // no storage here: it's only a convenience
  }
}

/** HIST-3.2: live means Fleet's current list has it: the sidebar's row of that id and Harness. */
export function isLive(item: HistoryItem, sessions: ReadonlyMap<string, SessionRow>): boolean {
  return sessions.get(item.sessionId)?.harness === item.harness;
}

/** A search snippet as text and hits (tb-session marks hits with `«` and `»`). */
export function snippetParts(snippet: string): { text: string; hit: boolean }[] {
  return snippet
    .split(/(«[^«»]*»)/)
    .filter(Boolean)
    .map((part) => (part.startsWith('«') && part.endsWith('»') ? { text: part.slice(1, -1), hit: true } : { text: part, hit: false }));
}

export const itemKey = (i: Pick<HistoryItem, 'harness' | 'sessionId'>) => `${i.harness}:${i.sessionId}`;
