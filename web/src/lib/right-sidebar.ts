import { DEFAULT_LIBRARY_TYPES, LIBRARY_TYPES, type LibraryFilter } from '@shared/library.ts';
/**
 * The right sidebar (HIST-1, WORK-1): a container with an active tab, History or Work. Whether it's
 * open, its width, the tab and Work's filter are kept in this browser (HIST-1.3, WORK-1.2, WORK-1.5).
 */

export type RightTab = 'history' | 'work' | 'library';
export const RIGHT_TABS: readonly RightTab[] = ['history', 'work', 'library'];
export const TAB_LABEL: Record<RightTab, string> = { history: 'History', work: 'Work', library: 'Library' };
/** The key that opens each tab, or closes the sidebar when that tab is already showing (WORK-1.1). */
export const TAB_KEY: Record<RightTab, string> = { history: 'H', work: 'W', library: 'L' };

/**
 * What the tab strip asks of the open panel (HIST-2.7, WORK-1.7): with focus on a tab, Refresh or
 * Close, ↑/↓ and j/k move the panel's selection by a row, never the Session sidebar's; Esc collapses
 * Work's expanded row (WORK-1.12), and says whether there was one.
 */
export interface PanelNav {
  move(delta: 1 | -1): void;
  collapse?(): boolean;
}

/** WORK-1.5: which of Work's sections show: both, Tasks only, or PRs only (both PR groups). */
export type WorkFilter = 'all' | 'tasks' | 'prs';
export const WORK_FILTERS: readonly WorkFilter[] = ['all', 'tasks', 'prs'];
export const WORK_FILTER_LABEL: Record<WorkFilter, string> = { all: 'All', tasks: 'Tasks', prs: 'PRs' };

/** HIST-1.3: the width bounds, in px. */
export const RIGHT_MIN_WIDTH = 280;
export const RIGHT_MAX_WIDTH = 720;
export const RIGHT_DEFAULT_WIDTH = 360;

export interface RightLayout {
  open: boolean;
  width: number;
  tab: RightTab;
  workFilter: WorkFilter;
  libraryFilter: LibraryFilter;
  headless: boolean;
}

const KEY = 'lookout.right';
/** Where HIST kept `{ open, width }` before Work was a tab: read when the new key is absent. */
const HISTORY_KEY = 'lookout.history';

export const DEFAULT_LAYOUT: RightLayout = { open: false, width: RIGHT_DEFAULT_WIDTH, tab: 'history', workFilter: 'all', libraryFilter: { types: [...DEFAULT_LIBRARY_TYPES], project: '', hideGone: true }, headless: false };

export const clampWidth = (w: number) => Math.round(Math.min(RIGHT_MAX_WIDTH, Math.max(RIGHT_MIN_WIDTH, w)));

/** A kept object, or null when it's missing, not JSON, not an object, or storage is blocked. */
function read(key: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null');
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Reads the layout: this key, else HIST's old one (also when this one is corrupt); anything odd is the default. */
export function loadLayout(): RightLayout {
  const r = read(KEY) ?? read(HISTORY_KEY);
  if (!r) return DEFAULT_LAYOUT;
  return {
    libraryFilter: readLibraryFilter(r.libraryFilter),
    headless: r.headless === true,
    open: r.open === true,
    width: typeof r.width === 'number' && Number.isFinite(r.width) ? clampWidth(r.width) : RIGHT_DEFAULT_WIDTH,
    tab: RIGHT_TABS.includes(r.tab as RightTab) ? (r.tab as RightTab) : 'history',
    workFilter: WORK_FILTERS.includes(r.workFilter as WorkFilter) ? (r.workFilter as WorkFilter) : 'all',
  };
}

export function saveLayout(layout: RightLayout): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // no storage here: it's only a convenience
  }
}

/** WORK-1.1, HIST-1.1: `W` or `H`: open on that tab, or close when it's already showing. */
export function toggleTab(layout: RightLayout, tab: RightTab): RightLayout {
  if (layout.open && layout.tab === tab) return { ...layout, open: false };
  return { ...layout, open: true, tab };
}

/** LIB-2.3: anything odd, including all chips off, reads as the default. */
function readLibraryFilter(v: unknown): LibraryFilter {
  const r = typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const types = Array.isArray(r.types) && r.types.length > 0 && r.types.every((t) => LIBRARY_TYPES.includes(t)) ? LIBRARY_TYPES.filter((t) => (r.types as unknown[]).includes(t)) : [...DEFAULT_LIBRARY_TYPES];
  return { types, project: typeof r.project === 'string' && r.project.startsWith('/') && r.project.length <= 1024 && !/[\p{Cc}\p{Cf}~:]/u.test(r.project) ? r.project : '', hideGone: r.hideGone !== false };
}
