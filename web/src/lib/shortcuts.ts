/**
 * SIDE-7.4: every keyboard shortcut the app handles, in one list. The Keyboard shortcuts dialog and
 * the empty views (VIEW-5.4, DS-6.4) render from it, so they can't drift apart. Only built shortcuts
 * belong here. The handlers stay where they are (App, Sidebar, SessionView, the panels); the test in
 * `shortcuts.test.tsx` checks that `press` covers every key an entry shows, then presses each one and checks that something happens.
 */

export type ShortcutGroupId = 'sessions' | 'session' | 'panels' | 'composer' | 'app';

export const SHORTCUT_GROUPS: readonly { id: ShortcutGroupId; title: string }[] = [
  { id: 'sessions', title: 'Sessions list' },
  { id: 'session', title: 'The selected Session' },
  { id: 'panels', title: 'Panels' },
  { id: 'composer', title: 'Composer' },
  { id: 'app', title: 'App' },
];

/** One real key press: what a test sends to see the entry work. */
export interface Press {
  key: string;
  meta?: boolean;
}

export interface Shortcut {
  id: string;
  group: ShortcutGroupId;
  /** The keys shown, each in its own `Kbd`. */
  keys: string[];
  /** Other keys that do the same, shown after "or". */
  alt?: string[];
  label: string;
  /** When it works, or what else it does: shown in the dialog. */
  note?: string;
  /** Key presses that trigger it (one per distinct key). */
  press: Press[];
  /** Handled for the whole page (App, the Session sidebar, the open Session): the test may not leave it unchecked. */
  global?: boolean;
  /** The short label of an empty view that lists it, and which one. */
  empty?: { label: string; views: ('select' | 'none')[] };
}

export const SHORTCUTS: readonly Shortcut[] = [
  {
    id: 'move',
    group: 'sessions',
    keys: ['↑', '↓'],
    alt: ['j', 'k'],
    label: 'Move through Sessions',
    note: 'Not in a text field. Inside the chat, the arrow keys scroll it.',
    press: [{ key: 'ArrowDown' }, { key: 'ArrowUp' }, { key: 'j' }, { key: 'k' }],
    global: true,
    empty: { label: 'Move', views: ['select'] },
  },
  {
    id: 'jump',
    group: 'sessions',
    keys: ['⌘', '1–9'],
    label: 'Jump to a row',
    press: [{ key: '1', meta: true }],
    global: true,
    empty: { label: 'Jump to a row', views: ['select'] },
  },
  {
    id: 'needs-you',
    group: 'sessions',
    keys: ['⌘', 'J'],
    label: 'Next Session that needs you',
    press: [{ key: 'j', meta: true }],
    global: true,
    empty: { label: 'Next that needs you', views: ['select'] },
  },
  {
    id: 'filter',
    group: 'sessions',
    keys: ['/'],
    label: 'Filter Sessions',
    note: 'Esc clears the filter.',
    press: [{ key: '/' }],
    global: true,
    empty: { label: 'Filter', views: ['select'] },
  },
  {
    id: 'new',
    group: 'sessions',
    keys: ['N'],
    label: 'New Session',
    note: '⌘N in the installed app, also inside a text field.',
    press: [{ key: 'n' }],
    global: true,
    empty: { label: 'New Session (⌘N in the installed app)', views: ['select', 'none'] },
  },
  {
    id: 'composer-focus',
    group: 'session',
    keys: ['i'],
    label: 'Write a message',
    note: 'Focuses the composer. Not in a text field.',
    press: [{ key: 'i' }],
    global: true,
  },
  {
    id: 'rail-move',
    group: 'session',
    keys: ['↑', '↓'],
    alt: ['Home', 'End'],
    label: 'Move between Marks',
    note: 'With focus on a Mark in the chat rail (wide windows). Up and Down step, Home and End go to the first and last Mark.',
    press: [{ key: 'ArrowDown' }, { key: 'ArrowUp' }, { key: 'Home' }, { key: 'End' }],
  },
  {
    id: 'preview-resize',
    group: 'session',
    keys: ['↑', '↓'],
    label: 'Resize the Terminal preview',
    note: 'With focus on the preview’s top edge, while the Terminal is open. Up makes it taller, Down shorter, 16 px a press.',
    press: [{ key: 'ArrowUp' }, { key: 'ArrowDown' }],
  },
  {
    id: 'marks',
    group: 'session',
    keys: ['['],
    alt: [']'],
    label: 'Previous or next Mark in the chat',
    note: 'Not in a text field.',
    press: [{ key: '[' }, { key: ']' }],
  },
  {
    id: 'panels',
    group: 'panels',
    keys: ['H', 'W', 'L', 'T'],
    label: 'Open or close History, Work, Library, Topics',
    note: 'Not in a text field.',
    press: [{ key: 'h' }, { key: 'w' }, { key: 'l' }, { key: 't' }],
    global: true,
    empty: { label: 'History, Work, Library, Topics', views: ['select', 'none'] },
  },
  {
    id: 'tabs',
    group: 'panels',
    keys: ['←', '→'],
    label: 'Switch tab',
    note: 'On the tab strip.',
    press: [{ key: 'ArrowRight' }, { key: 'ArrowLeft' }],
  },
  {
    id: 'panel-move',
    group: 'panels',
    keys: ['↑', '↓'],
    alt: ['j', 'k'],
    label: 'Move through rows',
    note: 'In the open panel or on its tab strip, never the Sessions list.',
    press: [{ key: 'ArrowDown' }, { key: 'ArrowUp' }, { key: 'j' }, { key: 'k' }],
  },
  {
    id: 'panel-enter',
    group: 'panels',
    keys: ['Enter'],
    label: 'Expand the row, then run its first button',
    press: [{ key: 'Enter' }],
  },
  {
    id: 'panel-esc',
    group: 'panels',
    keys: ['Esc'],
    label: 'Collapse the row, or clear the search',
    note: 'Clearing the search is History only.',
    press: [{ key: 'Escape' }],
  },
  {
    id: 'panel-open',
    group: 'panels',
    keys: ['O'],
    label: 'Open the selected row',
    note: 'Work and Library. Once per press.',
    press: [{ key: 'o' }],
  },
  {
    id: 'panel-review',
    group: 'panels',
    keys: ['R'],
    label: 'Review the selected pull request',
    note: 'Work, Review requests only.',
    press: [{ key: 'r' }],
  },
  {
    id: 'panel-start',
    group: 'panels',
    keys: ['S'],
    label: 'Start a Session on the selected Task, or open the selected Session',
    note: 'Work (a Task) and Library (a Session).',
    press: [{ key: 's' }],
  },
  {
    id: 'panel-add',
    group: 'panels',
    keys: ['A'],
    label: 'Add the selected row to a Topic',
    note: 'Work, History and Library.',
    press: [{ key: 'a' }],
  },
  {
    id: 'panel-copy',
    group: 'panels',
    keys: ['C'],
    label: 'Copy the selected row’s path or link',
    note: 'Library.',
    press: [{ key: 'c' }],
  },
  {
    id: 'send',
    group: 'composer',
    keys: ['Enter'],
    label: 'Send the message',
    note: 'Shift+Enter starts a new line.',
    press: [{ key: 'Enter' }],
    global: true,
  },
  {
    id: 'composer-leave',
    group: 'composer',
    keys: ['Esc'],
    label: 'Leave the composer',
    press: [{ key: 'Escape' }],
    global: true,
  },
  {
    id: 'start',
    group: 'app',
    keys: ['⌘', 'Enter'],
    label: 'Start the Session',
    note: 'In the New Session dialog.',
    press: [{ key: 'Enter', meta: true }],
  },
  {
    id: 'close',
    group: 'app',
    keys: ['Esc'],
    label: 'Close a dialog',
    note: 'Other shortcuts stand down while a dialog is open.',
    press: [{ key: 'Escape' }],
  },
];

/** The entries of one group, in list order. */
export const shortcutsIn = (group: ShortcutGroupId): Shortcut[] => SHORTCUTS.filter((s) => s.group === group);

/** The entries an empty view lists, in list order. */
export const emptyViewShortcuts = (view: 'select' | 'none'): Shortcut[] => SHORTCUTS.filter((s) => s.empty?.views.includes(view));
