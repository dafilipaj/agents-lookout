/**
 * DS-11: the terminal preview's height (VIEW-2), per Session, kept in this browser like the right
 * sidebar's width (`right-sidebar.ts`, HIST-1.3). One `localStorage` entry holds a map from the
 * Session's id to the height you last gave its preview. The height is the whole preview's, from its
 * top edge (the handle) down, its Terminal row included.
 */

const KEY = 'lookout.terminal';

/**
 * DS-11.1: the default, 285 px or 35% of the main pane, whichever is smaller. 285 is what the
 * preview measured before it was resizable: a 256 px text area under a 28 px Terminal row, plus the
 * top border, so the default shows as many lines as ever.
 */
export const DEFAULT_HEIGHT = 285;
const DEFAULT_SHARE = 0.35;
/** DS-11.2: at most 70% of the main pane. */
const MAX_SHARE = 0.7;
/** DS-11.2: ↑/↓ on the handle move it by this much. */
export const HEIGHT_STEP = 16;
/**
 * DS-11.2: at least the Terminal row plus four lines: the top border (1 px), the row (28 px: 6 px
 * padding each side of a 16 px `meta` line), the text's padding (8 px each side) and four 12 px
 * lines at 1.45 (17.4 px each), rounded up.
 */
export const MIN_HEIGHT = Math.ceil(1 + 28 + 16 + 4 * 12 * 1.45);

export interface HeightBounds {
  min: number;
  max: number;
}

/** The chat's own minimum (`min-h-24`): what the content row keeps for it next to the preview (SIDE-8.1). */
export const CHAT_MIN = 96;

/**
 * DS-11.2: what a main pane this tall allows, and, when the content row's height is known (`room`:
 * the chat and the preview share it), what that leaves once the chat has its 96 px, so the value
 * is the height the preview really has. A pane too short for the minimum still gets it; the
 * layout then shrinks the preview first (SIDE-8.1).
 */
export function heightBounds(paneHeight: number, room?: number): HeightBounds {
  const byPane = Math.floor(paneHeight * MAX_SHARE + 1e-6); // + 1e-6: 700 × 0.7 is 489.99…
  const max = room && room > 0 ? Math.min(byPane, Math.floor(room - CHAT_MIN)) : byPane;
  return { min: MIN_HEIGHT, max: Math.max(MIN_HEIGHT, max) };
}

export function clampHeight(height: number, paneHeight: number, room?: number): number {
  const { min, max } = heightBounds(paneHeight, room);
  return Math.round(Math.min(max, Math.max(min, height)));
}

/** DS-11.1, 11.3: the height a preview shows at: the kept one, else the default, either clamped to the pane and the content row. A kept height stays as it was. */
export function drawerHeight(paneHeight: number, kept: number | undefined, room?: number): number {
  return clampHeight(kept ?? Math.min(DEFAULT_HEIGHT, paneHeight * DEFAULT_SHARE), paneHeight, room);
}

const listeners = new Set<() => void>();

/** For `useSyncExternalStore`: told whenever this tab keeps or prunes a height. */
export function subscribeHeights(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * DS-11.5: what this page keeps when storage fails (blocked, full): the last map written, which
 * `readHeightsRaw` then returns, so the handle still resizes for the page's life. Undefined while
 * storage works; a write that goes through clears it.
 */
let memory: string | null | undefined;

/** The kept map as stored (a string, so `useSyncExternalStore` compares it cheaply); null when absent. Storage that fails gives this page's own last map. */
export function readHeightsRaw(): string | null {
  if (memory !== undefined) return memory;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** DS-11.5: the kept heights; anything that isn't a map of positive finite numbers is left out, and junk is none at all. */
export function parseHeights(raw: string | null): Record<string, number> {
  try {
    const v: unknown = JSON.parse(raw ?? 'null');
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
    const out: Record<string, number> = {};
    for (const [id, h] of Object.entries(v)) if (typeof h === 'number' && Number.isFinite(h) && h > 0) out[id] = h;
    return out;
  } catch {
    return {};
  }
}

function write(heights: Record<string, number>): void {
  const raw = Object.keys(heights).length === 0 ? null : JSON.stringify(heights);
  try {
    if (raw === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, raw);
    memory = undefined;
  } catch {
    memory = raw; // no storage here: the height lasts for the page, not beyond
  }
  for (const l of listeners) l();
}

/** DS-11.3: keep this Session's height; another Session's stays as it was. */
export function keepHeight(sessionId: string, height: number): void {
  write({ ...parseHeights(readHeightsRaw()), [sessionId]: Math.round(height) });
}

/**
 * DS-11.5: drop the heights of Sessions no longer in the Session list, so storage doesn't grow. A
 * Session whose id changed (a Codex Session that got its session id: `aliases`, old id to new) keeps
 * its height under the new id. Writes only when something changed.
 */
export function pruneHeights(live: ReadonlySet<string>, aliases: ReadonlyMap<string, string> = new Map()): void {
  const raw = readHeightsRaw();
  const kept = parseHeights(raw);
  const next: Record<string, number> = {};
  for (const [id, h] of Object.entries(kept)) {
    if (live.has(id)) next[id] = h;
  }
  for (const [id, h] of Object.entries(kept)) {
    const to = aliases.get(id);
    if (!live.has(id) && to !== undefined && live.has(to) && !(to in next)) next[to] = h;
  }
  const same = Object.keys(next).length === Object.keys(kept).length && Object.entries(next).every(([id, h]) => kept[id] === h);
  // Also when the stored map held entries that were junk: they go with the next prune.
  if (!same || (raw !== null && JSON.stringify(kept) !== JSON.stringify(rawMap(raw)))) write(next);
}

/** The stored map's own entries, valid or not (null for anything that isn't a map). */
function rawMap(raw: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
