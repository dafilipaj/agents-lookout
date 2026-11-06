import { createContext, useContext } from 'react';
import { RIGHT_TABS, type RightTab } from './right-sidebar';
import type { HintAt } from './shortcuts';

/** SIDE-11.3: the shell's three columns (SIDE-8.1), by their `data-shell-column`. */
export type KeysColumn = 'left' | 'main' | 'right';

/**
 * SIDE-11.3, VIEW-3.12: where your keys go. The column that has them, and for the hint line, the
 * place in it: the composer, the chat rail, a panel's search box or list…
 */
export interface KeysPlace {
  column: KeysColumn;
  at: HintAt;
  /** The right sidebar's panel, when one is open. */
  panel?: RightTab;
}

export const SESSIONS: KeysPlace = { column: 'left', at: 'sessions' };

const isTab = (s: string | undefined): s is RightTab => (RIGHT_TABS as readonly string[]).includes(s ?? '');

/** The right sidebar's panel `el` is in or names (its tab), else the shown one; none on the closed rail. */
function panelOf(el: Element, column: Element): RightTab | undefined {
  const own = (el.closest('[role="tabpanel"]') ?? (el.getAttribute('role') === 'tab' ? el : null))?.id.match(/^right-(?:panel|tab)-(\w+)$/)?.[1];
  if (isTab(own)) return own;
  const shown = column.querySelector('[role="tab"][aria-selected="true"]')?.id.match(/^right-tab-(\w+)$/)?.[1];
  return isTab(shown) ? shown : undefined;
}

const isTextField = (el: Element) => el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

/**
 * Where in a panel: its search box; its list (a `listbox`, or Topics' `list`) or its tab, where its
 * rows' keys work; anything else (a checkbox, a button, a field in a row) is a `field`, which the
 * hint line names without keys, since the list's keys don't all work there.
 */
function panelPlace(el: Element): 'search' | 'list' | 'field' {
  if (el.matches('[role="tabpanel"] input[type="search"]')) return 'search';
  if (isTextField(el)) return 'field';
  return el.getAttribute('role') === 'tab' || el.closest('[role="tabpanel"] :is([role="listbox"], [role="list"])') ? 'list' : 'field';
}

/**
 * Where the keys are with focus on `el`: the page itself is the Session list's (SIDE-11.2). Null
 * outside the three columns, in a menu or popover portaled to the page's end: the keys stay with
 * the column it opened from.
 */
export function placeOf(el: Element | null): KeysPlace | null {
  if (!el || el === el.ownerDocument.body || el === el.ownerDocument.documentElement) return SESSIONS;
  const column = el.closest<HTMLElement>('[data-shell-column]');
  switch (column?.dataset.shellColumn) {
    case 'left':
      return SESSIONS;
    case 'main':
      if (el.matches('[data-composer]')) return { column: 'main', at: 'composer' };
      if (el.closest('[data-testid="chat-rail"]')) return { column: 'main', at: 'rail' };
      if (el.matches('[data-preview-handle]')) return { column: 'main', at: 'preview' };
      return { column: 'main', at: 'session' };
    case 'right': {
      const panel = panelOf(el, column!);
      if (!panel) return { column: 'right', at: 'panels' };
      return { column: 'right', at: panelPlace(el), panel };
    }
    default:
      return null;
  }
}

export const samePlace = (a: KeysPlace, b: KeysPlace) => a.column === b.column && a.at === b.at && a.panel === b.panel;

/** Null while a dialog is open: no column has the keys then (SIDE-11.3). */
export const KeysContext = createContext<KeysPlace | null>(null);

/** SIDE-11.3, VIEW-3.12: where the keys are, for the column edges and the composer's hint line. */
export function useKeys(): KeysPlace | null {
  return useContext(KeysContext);
}
