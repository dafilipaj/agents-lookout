import type { Harness, HistoryItem, SessionRow } from '@shared/types.ts';

/** HIST-2.8: which Harnesses History shows; never neither. Kept in this browser, like the layout. */
export type HarnessFilter = Record<Harness, boolean>;
const FILTER_KEY = 'lookout.history.harnesses';
export const BOTH_HARNESSES: HarnessFilter = { claude: true, codex: true };

/** Reads the Harness filter; anything odd, or both off, is both. */
export function loadHarnessFilter(): HarnessFilter {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(FILTER_KEY) ?? 'null');
    if (typeof v === 'object' && v !== null) {
      const r = v as Record<string, unknown>;
      const f = { claude: r.claude !== false, codex: r.codex !== false };
      if (f.claude || f.codex) return f;
    }
  } catch {
    // no storage here
  }
  return BOTH_HARNESSES;
}

export function saveHarnessFilter(filter: HarnessFilter): void {
  try {
    window.localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
  } catch {
    // no storage here: it's only a convenience
  }
}

/** The one Harness to ask tb-session for, or null for both. */
export const filterHarness = (f: HarnessFilter): Harness | null => (f.claude && f.codex ? null : f.claude ? 'claude' : 'codex');

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
