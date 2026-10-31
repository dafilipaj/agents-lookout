import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, row } from '@/test/helpers';
import { SHORTCUTS, type Press, type Shortcut, emptyViewShortcuts, shortcutsIn, SHORTCUT_GROUPS } from './shortcuts';

afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // no storage: nothing was kept
  }
});

/** user-event's keyboard syntax for a press: a key with ⌘ held, or alone. */
const typed = (p: Press) => {
  // `[` opens a descriptor in user-event: doubled it is a literal.
  const text = p.key === '[' ? '[[' : p.key.length === 1 ? p.key : `{${p.key}}`;
  return p.meta ? `{Meta>}${text}{/Meta}` : text;
};
const pressKey = (user: UserEvent, p: Press) => user.keyboard(typed(p));

/** A fresh app for each press, so one press never leaves state for the next. */
const fresh = (path: string, sessions = [row({ id: 'a', title: 'alpha' }), row({ id: 'b', title: 'beta' })]) => {
  cleanup();
  window.localStorage.clear();
  const app = renderApp(path);
  app.snapshot(sessions);
  return app;
};

const tab = (name: string) => screen.getByRole('tab', { name });
const message = () => screen.getByRole('textbox', { name: 'Message' });

/**
 * The effect of each entry's keys, checked in the whole app. Each probe is handed one of the entry's
 * own `press`es, so changing an entry's keys without changing what the code handles fails here.
 */
const PROBES: Record<string, (user: UserEvent, press: Press) => Promise<void>> = {
  async move(user, press) {
    // With nothing selected, down goes to the first row and up to the last.
    fresh('/');
    await pressKey(user, press);
    expect(window.location.pathname).toBe(['ArrowUp', 'k'].includes(press.key) ? '/s/b' : '/s/a');
  },
  async jump(user, press) {
    fresh('/');
    await pressKey(user, press);
    expect(window.location.pathname).toBe('/s/a');
  },
  async 'needs-you'(user, press) {
    fresh('/', [row({ id: 'a' }), row({ id: 'b', status: 'needs-you' })]);
    await pressKey(user, press);
    expect(window.location.pathname).toBe('/s/b');
  },
  async filter(user, press) {
    fresh('/');
    await pressKey(user, press);
    expect(screen.getByRole('searchbox', { name: 'Filter Sessions' })).toHaveFocus();
  },
  async new(user, press) {
    fresh('/');
    await pressKey(user, press);
    expect(await screen.findByRole('dialog', { name: 'New Session' })).toBeInTheDocument();
  },
  async 'composer-focus'(user, press) {
    fresh('/s/a');
    await pressKey(user, press);
    expect(message()).toHaveFocus();
  },
  async panels(user, press) {
    fresh('/');
    await pressKey(user, press);
    const name = { h: 'History', w: 'Work', l: 'Library', t: 'Topics' }[press.key]!;
    expect(tab(name)).toHaveAttribute('aria-selected', 'true');
  },
  async tabs(user, press) {
    fresh('/');
    await user.keyboard('h');
    await user.click(tab('History'));
    tab('History').focus();
    await pressKey(user, press);
    expect(tab(press.key === 'ArrowRight' ? 'Work' : 'Topics')).toHaveAttribute('aria-selected', 'true');
  },
  async send(user, press) {
    const app = fresh('/s/a');
    await user.type(message(), 'hello');
    await pressKey(user, press);
    await waitFor(() => expect(app.client.sendMessage).toHaveBeenCalledWith('a', 'hello'));
  },
  async 'composer-leave'(user, press) {
    fresh('/s/a');
    await user.click(message());
    expect(message()).toHaveFocus();
    await pressKey(user, press);
    expect(message()).not.toHaveFocus();
  },
  async close(user, press) {
    fresh('/');
    await user.keyboard('n');
    expect(await screen.findByRole('dialog', { name: 'New Session' })).toBeInTheDocument();
    await pressKey(user, press);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  },
};

/** What a shown key is pressed as. A letter is its lowercase; ⌘ is `meta` on the press, not a key. */
const PRESSED_AS: Record<string, string> = { '↑': 'ArrowUp', '↓': 'ArrowDown', '←': 'ArrowLeft', '→': 'ArrowRight', Esc: 'Escape', '1–9': '1' };
const pressedAs = (shown: string) => PRESSED_AS[shown] ?? (shown.length === 1 ? shown.toLowerCase() : shown);

/**
 * Entries whose keys act inside one widget: the criteria whose test, in that file, presses them there.
 * Each ID must still appear in its file, so a renamed or removed test fails here. Never a global entry.
 * ⌘N (new Session) is not pressed anywhere: it only works in the installed app, so the list shows N.
 */
const ELSEWHERE: Record<string, { file: string; criteria: string[] }[]> = {
  marks: [{ file: 'ChatRail.test.tsx', criteria: ['VIEW-1.11'] }],
  'rail-move': [{ file: 'ChatRail.test.tsx', criteria: ['VIEW-1.11'] }],
  'preview-resize': [{ file: 'DesignSystemBehaviour.test.tsx', criteria: ['DS-11.2'] }],
  'panel-move': [
    { file: 'HistoryPanel.test.tsx', criteria: ['HIST-2.7'] },
    { file: 'WorkPanel.test.tsx', criteria: ['WORK-1.7'] },
    { file: 'LibraryPanel.test.tsx', criteria: ['LIB-2.5'] },
  ],
  'panel-enter': [
    { file: 'HistoryPanel.test.tsx', criteria: ['HIST-2.7'] },
    { file: 'WorkPanel.test.tsx', criteria: ['WORK-1.12', 'WORK-1.13'] },
    { file: 'LibraryPanel.test.tsx', criteria: ['LIB-2.5'] },
  ],
  'panel-esc': [
    { file: 'HistoryPanel.test.tsx', criteria: ['HIST-2.11'] },
    { file: 'WorkPanel.test.tsx', criteria: ['WORK-1.12'] },
  ],
  'panel-open': [
    { file: 'WorkPanel.test.tsx', criteria: ['WORK-6.4'] },
    { file: 'LibraryPanel.test.tsx', criteria: ['LIB-3.7'] },
  ],
  'panel-review': [{ file: 'WorkPanel.test.tsx', criteria: ['WORK-5.2'] }],
  'panel-add': [{ file: 'Topics.test.tsx', criteria: ['TOPIC-2.1'] }],
  'panel-graph': [{ file: 'Topics.test.tsx', criteria: ['TOPIC-7.1'] }],
  'panel-start': [
    { file: 'WorkPanel.test.tsx', criteria: ['WORK-5.1'] },
    { file: 'LibraryPanel.test.tsx', criteria: ['LIB-3.7'] },
  ],
  'panel-copy': [{ file: 'LibraryPanel.test.tsx', criteria: ['LIB-3.7'] }],
  start: [{ file: 'Launcher.test.tsx', criteria: ['LAUNCH-3.3'] }],
};

/** The test files, as text, by file name. */
const TEST_FILES = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../components/*.test.tsx', { query: '?raw', import: 'default', eager: true })).map(([path, text]) => [path.split('/').pop()!, text]),
);

describe('the shortcuts list', () => {
  it('SIDE-7.4: every entry is in a known group, has unique id, and shows at least one key and a label', () => {
    const groups = new Set(SHORTCUT_GROUPS.map((g) => g.id));
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
    for (const s of SHORTCUTS) {
      expect(groups.has(s.group), s.id).toBe(true);
      expect(s.keys.length, s.id).toBeGreaterThan(0);
      expect(s.label, s.id).not.toBe('');
      expect(s.press.length, s.id).toBeGreaterThan(0);
    }
    for (const g of SHORTCUT_GROUPS) expect(shortcutsIn(g.id).length, g.id).toBeGreaterThan(0);
  });

  it('SIDE-7.4: each entry is pressed by a probe here, or is named with the test that presses it in its own panel; the global ones can\'t be left out', () => {
    for (const s of SHORTCUTS) {
      const probed = s.id in PROBES;
      const elsewhere = s.id in ELSEWHERE;
      expect(probed !== elsewhere, `${s.id}: exactly one of a probe and a test elsewhere`).toBe(true);
      if (s.global) expect(probed, `${s.id} is global, so it needs a probe here`).toBe(true);
    }
    const ids = new Set(SHORTCUTS.map((s) => s.id));
    for (const id of [...Object.keys(PROBES), ...Object.keys(ELSEWHERE)]) expect(ids.has(id), `${id} is not in the list`).toBe(true);
  });

  it('SIDE-7.4: the `press` of every entry covers every key it shows, the alternates too', () => {
    for (const s of SHORTCUTS) {
      const pressed = new Set(s.press.map((p) => p.key));
      for (const shown of [...s.keys, ...(s.alt ?? [])]) {
        if (shown === '⌘') continue; // the `meta` of a press
        expect(pressed.has(pressedAs(shown)), `${s.id}: ${shown} is shown but never pressed`).toBe(true);
      }
    }
  });

  it('SIDE-7.4: each criterion an entry names is still in the test file that presses its keys', () => {
    for (const [id, refs] of Object.entries(ELSEWHERE)) {
      for (const { file, criteria } of refs) {
        const text = TEST_FILES[file];
        expect(text, `${id}: no test file ${file}`).toBeDefined();
        for (const c of criteria) expect(new RegExp(`it\\('${c.replace('.', '\\.')}[: ]`).test(text!), `${id}: no test named ${c} in ${file}`).toBe(true);
      }
    }
  });

  for (const s of SHORTCUTS.filter((x: Shortcut) => x.id in PROBES)) {
    it(`SIDE-7.4: ${s.id} (${[...s.keys, ...(s.alt ?? [])].join(' ')}) triggers its action`, async () => {
      for (const press of s.press) {
        const user = userEvent.setup();
        await PROBES[s.id]!(user, press);
      }
    });
  }

  it('SIDE-7.4: the empty views list only entries from the list, and every one of those entries is a global shortcut', () => {
    for (const view of ['select', 'none'] as const) {
      const listed = emptyViewShortcuts(view);
      expect(listed.length).toBeGreaterThan(0);
      for (const s of listed) expect(s.global, s.id).toBe(true);
    }
    // VIEW-5.4: the Sessions list's own keys, N, and the panels; DS-6.4: only the keys that do something with no Session.
    expect(emptyViewShortcuts('select').map((s) => s.id)).toEqual(['move', 'jump', 'needs-you', 'filter', 'new', 'panels']);
    expect(emptyViewShortcuts('none').map((s) => s.id)).toEqual(['new', 'panels']);
  });
});

describe('the Keyboard shortcuts dialog', () => {
  const open = () => screen.getByRole('button', { name: 'Keyboard shortcuts' });

  it('SIDE-7.3: a "Keyboard shortcuts" icon button sits beside Settings, sized and spaced as New Session and Settings are', () => {
    fresh('/s/a');
    const button = open();
    const settings = screen.getByRole('button', { name: 'Settings' });
    expect(button).toHaveAttribute('data-slot', 'icon-button');
    expect(button).toHaveAttribute('data-size', 'md');
    expect(button).toHaveAttribute('title', 'Keyboard shortcuts');
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.parentElement).toBe(settings.parentElement);
    expect(button.previousElementSibling).toBe(settings);
    expect(settings.parentElement).toHaveClass('gap-1');
    expect(screen.queryByRole('dialog')).toBeNull();
    // It has no key of its own: no entry in the list names it.
    expect(JSON.stringify(SHORTCUTS)).not.toMatch(/Keyboard shortcuts/);
  });

  it('SIDE-7.3: pressing it opens the dialog over an open Session, without changing the route', async () => {
    const user = userEvent.setup();
    fresh('/s/a');
    await user.click(open());
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/s/a');
  });

  it('SIDE-7.4: it lists every entry of the shortcuts list, in its group, with Kbd keys and its label', async () => {
    const user = userEvent.setup();
    fresh('/s/a');
    await user.click(open());
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    for (const g of SHORTCUT_GROUPS) {
      const section = within(dialog).getByRole('region', { name: g.title });
      for (const s of shortcutsIn(g.id)) {
        const li = section.querySelector<HTMLElement>(`[data-shortcut="${s.id}"]`)!;
        expect(li, s.id).not.toBeNull();
        expect([...li.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual([...s.keys, ...(s.alt ?? [])]);
        expect(li).toHaveTextContent(s.label);
      }
    }
    expect(dialog.querySelectorAll('[data-shortcut]').length).toBe(SHORTCUTS.length);
  });

  it('SIDE-7.5: Esc and Close close it and focus returns to the button; the app\'s shortcuts stand down while it is open', async () => {
    const user = userEvent.setup();
    fresh('/s/a');
    await user.click(open());
    await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    // Nothing behind it moves or opens meanwhile.
    await user.keyboard('nhj');
    expect(screen.queryByRole('dialog', { name: 'New Session' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'History' })).toBeNull();
    expect(window.location.pathname).toBe('/s/a');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(open()).toHaveFocus();

    await user.click(open());
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(open()).toHaveFocus();
  });

  it('VIEW-5.4: with nothing selected the hint lists the shortcuts that matter, and "All shortcuts" opens the dialog and gets focus back', async () => {
    const user = userEvent.setup();
    fresh('/');
    const main = screen.getByRole('main');
    expect(within(main).getByText('Select a Session')).toBeInTheDocument();
    const hint = within(main).getAllByRole('listitem');
    expect(hint.map((li) => [...li.querySelectorAll('kbd')].map((k) => k.textContent))).toEqual(emptyViewShortcuts('select').map((s) => [...s.keys, ...(s.alt ?? [])]));
    const all = within(main).getByRole('button', { name: 'All shortcuts' });
    await user.click(all);
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(all).toHaveFocus();
  });

  it('DS-6.4: with no Session the empty view lists N and the panels under "Start a Session", and "All shortcuts" opens the dialog', async () => {
    const user = userEvent.setup();
    fresh('/', []);
    const main = screen.getByRole('main');
    expect(within(main).getByText('No Sessions running')).toBeInTheDocument();
    expect(within(main).getAllByRole('listitem').map((li) => [...li.querySelectorAll('kbd')].map((k) => k.textContent))).toEqual(emptyViewShortcuts('none').map((s) => [...s.keys, ...(s.alt ?? [])]));
    await user.click(within(main).getByRole('button', { name: 'All shortcuts' }));
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });
});
