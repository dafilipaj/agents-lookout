import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, row } from '@/test/helpers';
import { RIGHT_TABS } from './right-sidebar';
import { type HintAt, SHORTCUTS, type Press, type Shortcut, emptyViewShortcuts, hint, hintKeys, shortcutsIn, SHORTCUT_GROUPS } from './shortcuts';

afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // no storage: nothing was kept
  }
});

/** user-event's keyboard syntax for a press: a key with ⌘ or ⇧ held, or alone. */
const typed = (p: Press) => {
  // `[` opens a descriptor in user-event: doubled it is a literal.
  const text = p.key === '[' ? '[[' : p.key.length === 1 ? p.key : `{${p.key}}`;
  return p.meta ? `{Meta>}${text}{/Meta}` : p.shift ? `{Shift>}${text}{/Shift}` : text;
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
    const name = { h: 'History', w: 'Work', l: 'Library', t: 'Topics', p: 'Servers' }[press.key]!;
    expect(tab(name)).toHaveAttribute('aria-selected', 'true');
  },
  async tabs(user, press) {
    fresh('/');
    await user.keyboard('h');
    await user.click(tab('History'));
    tab('History').focus();
    await pressKey(user, press);
    expect(tab(press.key === 'ArrowRight' ? 'Work' : 'Servers')).toHaveAttribute('aria-selected', 'true');
    // DS-20.2: a choice of views too, Work's Show.
    await user.click(tab('Work'));
    const show = within(screen.getByRole('radiogroup', { name: 'Show' }));
    show.getByRole('radio', { checked: true }).focus();
    await pressKey(user, press);
    expect(show.getByRole('radio', { checked: true })).toHaveTextContent(press.key === 'ArrowRight' ? 'Tasks' : 'PRs');
  },
  async send(user, press) {
    const app = fresh('/s/a');
    await user.type(message(), 'hello');
    await pressKey(user, press);
    await waitFor(() => expect(app.client.sendMessage).toHaveBeenCalledWith('a', 'hello'));
  },
  async 'new-line'(user, press) {
    const app = fresh('/s/a');
    await user.type(message(), 'one');
    await pressKey(user, press);
    await user.keyboard('two');
    expect(message()).toHaveValue('one\ntwo');
    expect(app.client.sendMessage).not.toHaveBeenCalled();
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
  async 'settings-back'(user, press) {
    fresh('/settings');
    await screen.findByRole('heading', { name: 'Settings' });
    await pressKey(user, press);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull());
    expect(window.location.pathname).toBe('/');
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
  'spec-viewed': [{ file: 'SpecView.test.tsx', criteria: ['PLAIN-4.1'] }],
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
    { file: 'PrSpecs.test.tsx', criteria: ['PLAIN-5.1'] },
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
        if (shown === '⌘' || shown === '⇧') continue; // the `meta` or `shift` of a press
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

describe('the hint line (VIEW-3.12)', () => {
  const places: [HintAt, (typeof RIGHT_TABS)[number] | undefined][] = [
    ['sessions', undefined],
    ['composer', undefined],
    ['session', undefined],
    ['rail', undefined],
    ['preview', undefined],
    ['panels', undefined],
    ...RIGHT_TABS.flatMap((t) => (['list', 'field'] as const).map((at) => [at, t] as [HintAt, typeof t])),
    ...(['history', 'library', 'topics'] as const).map((t) => ['search', t] as [HintAt, typeof t]),
  ];

  it('VIEW-3.12: each place names who has the keys, then at most four keys, each an entry of the one shortcuts list with its own keys', () => {
    for (const [at, panel] of places) {
      const { name, keys } = hint(at, panel);
      expect(name, at).not.toBe('');
      expect(keys.length, `${at} ${panel}`).toBeLessThanOrEqual(4);
      for (const k of keys) {
        if (!k.id) {
          expect(k.keys, `${at}: words without an entry show no keys`).toBeUndefined();
          continue;
        }
        const entry = SHORTCUTS.find((s) => s.id === k.id);
        expect(entry, `${at}: ${k.id} is not in the list`).toBeDefined();
        const own = [...entry!.keys, ...(entry!.alt ?? [])];
        for (const key of hintKeys(k)) expect(own, `${at}: ${k.id} shows ${key}`).toContain(key);
      }
    }
  });

  it('VIEW-3.12: the words are the UX table\'s, region by region', () => {
    const line = (at: HintAt, panel?: (typeof RIGHT_TABS)[number]) => {
      const { name, keys } = hint(at, panel);
      return [name, ...keys.map((k) => [...hintKeys(k), k.label].join(' '))].join(' · ');
    };
    expect(line('sessions')).toBe('Sessions · ↑ ↓ move · ⌘ J next that needs you · / filter · i write');
    expect(line('composer')).toBe('Composer · Enter send · ⇧ Enter new line · Esc leave');
    expect(line('session')).toBe('This Session · i write');
    expect(line('rail')).toBe('This Session · i write · ↑ ↓ move between Marks');
    expect(line('preview')).toBe('This Session · i write · ↑ ↓ resize');
    expect(line('search', 'history')).toBe('History search · type to search · ↓ results · Esc back to History');
    expect(line('list', 'work')).toBe('Work · ↑ ↓ move · Enter expand · O open · A add to Topic');
    // A panel's line leaves out the keys its rows don't take: History's rows open nothing with O, Servers' take neither A nor O.
    expect(line('list', 'history')).toBe('History · ↑ ↓ move · Enter expand · A add to Topic');
    expect(line('list', 'servers')).toBe('Servers · ↑ ↓ move · Enter open');
    expect(line('panels')).toBe('Panels · H W L T P open');
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
