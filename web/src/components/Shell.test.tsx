import type { HistoryDetail, HistoryItem } from '@shared/types.ts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, fakeResizeObserver, launchView, renderApp, row } from '@/test/helpers';
import { SHELL_COLUMN, SHELL_GRID } from './Shell';

/*
 * SIDE-8.1: the lines line up because every column is a subgrid over the shell's one grid, rows
 * header / content / dock. jsdom can't measure layout, so these tests check that structure: which
 * row and column each part sits in. That the lines meet on screen is checked by eye (manual).
 */

const shell = () => document.querySelector<HTMLElement>('[data-shell]')!;
const column = (name: 'left' | 'main' | 'right') => shell().querySelector<HTMLElement>(`:scope > [data-shell-column="${name}"]`);

/** The shell cell an element sits in. */
const cellOf = (el: Element) => el.closest<HTMLElement>('[data-shell-row]')!;
/** Its row and column, as `row/column`. */
const where = (el: Element) => `${cellOf(el)?.dataset.shellRow}/${el.closest<HTMLElement>('[data-shell-column]')?.dataset.shellColumn}`;
/** Whether an element is laid out with the shared shell classes (compared against the constant, not a copy of it). */
const uses = (el: Element, classes: string) => classes.split(' ').every((c) => el.classList.contains(c));

const PAST: HistoryItem = {
  sessionId: 'gone-1',
  harness: 'claude',
  headless: false,
  title: 'pr641-review',
  projectPath: '/Users/me/wt/pr641',
  repo: 'pr641',
  branch: 'fix/pr641',
  lastActiveAt: NOW - 86_400_000,
  snippet: null,
  blocked: 'folder-gone',
};
const PAST_DETAIL: HistoryDetail = {
  item: PAST,
  source: 'transcript',
  preview: 'latest',
  totalMessages: 1,
  entries: [{ kind: 'user', cursor: 'h0', ts: null, text: 'Review PR 641.', queued: false }],
};

async function openHistory() {
  await userEvent.setup().click(screen.getByRole('button', { name: 'History' }));
  await screen.findByTestId('history-panel');
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The last input was a key press, not a pointer press: whether focus would be visible in a browser. */
let keyboardLast = true;
document.addEventListener('keydown', () => (keyboardLast = true), true);
document.addEventListener('pointerdown', () => (keyboardLast = false), true);

/**
 * What jsdom can't do for a dock note. It lays nothing out, so the note's title and detail report
 * sizes that say whether the clamp cuts them short (set `title` or `detail` on the result): the
 * title along its one line, the detail past its two. And its :focus-visible keeps its last match
 * across renders, so after the first test a Tab could read as not visible; this stands in with the
 * browser's rule, visible when the focus came from a key press and not a pointer press.
 */
function stubDockNote() {
  const clip = { title: false, detail: false };
  const size = (axis: 'width' | 'height', kind: 'scroll' | 'client') =>
    function (this: HTMLElement) {
      if (!this.parentElement?.hasAttribute('data-dock-note-text')) return 0;
      const part = this.previousElementSibling ? 'detail' : 'title';
      const cut = axis === 'width' ? part === 'title' && clip.title : part === 'detail' && clip.detail;
      return kind === 'scroll' && cut ? 200 : 100;
    };
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(size('width', 'scroll'));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(size('width', 'client'));
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(size('height', 'scroll'));
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(size('height', 'client'));
  const matches = Element.prototype.matches;
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
    return selector === ':focus-visible' ? this === document.activeElement && keyboardLast : matches.call(this, selector);
  });
  return clip;
}

describe('one grid (SIDE-8.1)', () => {
  it('SIDE-8.1 (support): the shell is one grid with rows header / content / dock, and every column is a subgrid over all three', async () => {
    renderApp('/s/a').snapshot([row({ id: 'a' })]);
    expect(uses(shell(), SHELL_GRID)).toBe(true);
    // History closed: its rail is the third column.
    for (const name of ['left', 'main', 'right'] as const) {
      expect(column(name), name).not.toBeNull();
      expect(uses(column(name)!, SHELL_COLUMN), name).toBe(true);
    }
    // The main pane's view is a subgrid of the main column in turn.
    const view = column('main')!.querySelector<HTMLElement>(':scope > [data-shell-view]')!;
    expect(uses(view, SHELL_COLUMN)).toBe(true);
    await openHistory();
    expect(column('right')).toBe(screen.getByTestId('right-sidebar'));
    expect(column('right')).toContainElement(screen.getByTestId('history-panel'));
    expect(uses(column('right')!, SHELL_COLUMN)).toBe(true);
  });

  it('SIDE-8.1 (support): the Filter bar, the Session title bar and the right sidebar’s tab strip are their columns’ header cells', async () => {
    renderApp('/s/a').snapshot([row({ id: 'a', status: 'needs-you', waitingFor: 'question: ship it?' })]);
    await openHistory();

    expect(where(screen.getByRole('searchbox', { name: 'Filter Sessions' }))).toBe('header/left');
    // The Session's header is one cell of one line: a Needs you Session's question stays out of it
    // (VIEW-5.1), so the header row keeps its height whichever Session is selected.
    const header = screen.getByRole('banner', { name: 'Session' });
    expect(where(header)).toBe('header/main');
    expect(cellOf(header)).toBe(header);
    expect(header).not.toHaveTextContent('ship it?');
    expect(header.querySelectorAll(':scope > *')).toHaveLength(1);

    // WORK-1.8: the tab strip (History, Work) is the right column's header cell, next to Close,
    // like Filter on the left; History's search field sits below it.
    const tabs = screen.getByRole('tablist', { name: 'Right sidebar' });
    expect(where(tabs)).toBe('header/right');
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['History', 'Work']);
    expect(within(cellOf(tabs)).getByRole('button', { name: 'Close History' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Right sidebar' })).toBe(screen.getByTestId('right-sidebar'));
    const search = screen.getByRole('searchbox', { name: 'Search past Sessions' });
    expect(where(search)).toBe('body/right');
    // The search field, the toggles and the list run on past the dock to the bottom.
    expect(cellOf(search)).toHaveAttribute('data-shell-to-bottom');
    const toggle = screen.getByRole('checkbox', { name: 'Show Headless Sessions' });
    expect(where(toggle)).toBe('body/right');
    expect(cellOf(toggle)).toHaveAttribute('data-shell-to-bottom');
  });

  it('SIDE-8.1 (support): a live Session’s composer shares the dock row with the usage panel; the Terminal row stays above it, the status line under the composer', () => {
    renderApp('/s/a').snapshot([row({ id: 'a', model: 'claude-opus-5-5' })]);

    expect(where(screen.getByRole('button', { name: 'Usage details' }))).toBe('dock/left');
    const message = screen.getByRole('textbox', { name: 'Message' });
    expect(where(message)).toBe('dock/main');
    expect(where(screen.getByRole('region', { name: 'Terminal preview' }))).toBe('body/main');
    const status = screen.getByRole('group', { name: 'Status line' });
    expect(cellOf(status)).toBe(cellOf(message));
    expect(status).toBe(cellOf(message).lastElementChild); // at the bottom, under the composer
  });

  it.each([
    ['View only', row({ id: 'a', controllable: false }), 'View only: this Session runs in another app'],
    ['ended', null, 'This Session ended'],
  ])('SIDE-8.1 (support): a %s Session’s banner sits in the dock row, above the status line', (_, live, text) => {
    const app = renderApp('/s/a');
    app.snapshot([live ?? row({ id: 'a' })]);
    if (!live) app.emit({ type: 'sessions', upsert: [], remove: ['a'] });

    const banner = screen.getByText(text);
    expect(where(banner)).toBe('dock/main');
    expect(cellOf(banner).lastElementChild).toBe(screen.getByRole('group', { name: 'Status line' }));
    expect(screen.queryByRole('region', { name: 'Terminal preview' })).toBeNull();
  });

  it('SIDE-8.1 (support): a past Session is laid out like an ended one: a one-line header, its note and where it ran in the dock', async () => {
    renderApp('/h/claude/gone-1', { pastSession: async () => PAST_DETAIL }).snapshot([]);
    const view = await screen.findByTestId('past-session');

    const header = within(view).getByRole('banner', { name: 'Past Session' });
    expect(where(header)).toBe('header/main');
    expect(within(header).queryByText('/Users/me/wt/pr641')).toBeNull();
    const note = within(view).getByRole('note');
    expect(where(note)).toBe('dock/main');
    expect(within(cellOf(note)).getByRole('group', { name: 'Where it ran' })).toHaveTextContent('/Users/me/wt/pr641·fix/pr641');
  });

  it('SIDE-8.1 (support): nothing selected and Settings keep a header cell in the main column, and the closed History rail one too', async () => {
    const app = renderApp('/');
    app.snapshot([row({ id: 'a' })]);
    expect(column('main')!.querySelector('[data-shell-row="header"]')).not.toBeNull();
    expect(where(screen.getByText('Select a Session'))).toBe('body/main');
    expect(where(screen.getByRole('button', { name: 'History' }))).toBe('header/right');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument());
    const title = screen.getByRole('heading', { name: 'Settings' });
    expect(where(title)).toBe('header/main');
    expect(within(cellOf(title)).getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  /*
   * SIDE-8.1 holds only while every main-pane view is a ShellView whose children are shell cells.
   * Anything else in <main> is auto-placed into the header row and makes every column's header as
   * tall as it is. A new view (or a new branch of an old one) must be added here.
   */
  const views: [string, () => Promise<void>][] = [
    [
      'nothing selected',
      async () => {
        renderApp('/').snapshot([row({ id: 'a' })]);
        await screen.findByText('Select a Session');
      },
    ],
    [
      'Settings',
      async () => {
        renderApp('/settings').snapshot([row({ id: 'a' })]);
        await screen.findByRole('heading', { name: 'Settings' });
      },
    ],
    [
      'loading',
      async () => {
        renderApp('/s/a').snapshot([], { state: 'starting' });
        await screen.findByText('Loading…');
      },
    ],
    [
      'Fleet unavailable',
      async () => {
        const app = renderApp('/s/a');
        app.snapshot([], { state: 'starting' });
        app.emit({ type: 'fleet', fleet: { state: 'failing', lastOkAt: null, error: 'boom' } });
        await screen.findByText("Can't tell whether this Session is running");
      },
    ],
    [
      'live',
      async () => {
        renderApp('/s/a').snapshot([row({ id: 'a' })]);
        await screen.findByRole('textbox', { name: 'Message' });
      },
    ],
    [
      'View only',
      async () => {
        renderApp('/s/a').snapshot([row({ id: 'a', controllable: false })]);
        await screen.findByText('View only: this Session runs in another app');
      },
    ],
    [
      'ended',
      async () => {
        const app = renderApp('/s/a');
        app.snapshot([row({ id: 'a' })]);
        app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
        await screen.findByText('This Session ended');
      },
    ],
    [
      'ended, no row known',
      async () => {
        renderApp('/s/a').snapshot([row({ id: 'b' })]);
        await screen.findByText('This Session ended');
      },
    ],
    [
      'past Session loading',
      async () => {
        renderApp('/h/claude/gone-1', { pastSession: () => new Promise<HistoryDetail>(() => {}) }).snapshot([]);
        await screen.findByText('Loading…');
      },
    ],
    [
      'past Session error',
      async () => {
        renderApp('/h/claude/gone-1').snapshot([]);
        await screen.findByText("Couldn't open this past Session");
      },
    ],
    [
      'past Session',
      async () => {
        renderApp('/h/claude/gone-1', { pastSession: async () => PAST_DETAIL }).snapshot([]);
        await screen.findByTestId('past-session');
      },
    ],
    [
      'start under way',
      async () => {
        const app = renderApp('/l/l-1');
        app.snapshot([row({ id: 'a' })]);
        app.emit({ type: 'launches', launches: [launchView({ id: 'l-1', title: 'fix-rates' })], started: [] });
        await screen.findByText('Waiting for Fleet to report the Session…');
      },
    ],
    [
      'start failed',
      async () => {
        const app = renderApp('/l/l-1');
        app.snapshot([row({ id: 'a' })]);
        app.emit({
          type: 'launches',
          launches: [launchView({ id: 'l-1', state: 'failed', error: "Fleet hasn't reported it after 15 s.", terminal: ['Trust this folder?'] })],
          started: [],
        });
        await screen.findByRole('region', { name: "Its terminal's last lines" });
      },
    ],
    [
      'start, before the first snapshot',
      async () => {
        renderApp('/l/l-1');
        await screen.findByText('Loading…');
      },
    ],
    [
      'start no longer listed',
      async () => {
        renderApp('/l/gone').snapshot([row({ id: 'a' })]);
        await screen.findByText('This start is no longer listed');
      },
    ],
  ];

  /*
   * The dock line and the usage panel stay put when switching views: the sidebar's dock cell holds
   * DockRest under the usage panel, an invisible empty composer with its status line, so the row has
   * that height at rest in every view, with or without a main-pane dock. The measured positions are
   * checked by eye (manual).
   */
  it.each(views)('SIDE-8.1: in the %s view the sidebar’s dock holds the resting dock under the usage panel', async (_, show) => {
    await show();
    const dock = cellOf(screen.getByRole('button', { name: 'Usage details' }));
    expect(where(dock)).toBe('dock/left');
    const rest = dock.querySelector<HTMLElement>(':scope > [data-dock-rest]');
    expect(rest).not.toBeNull();
    expect(rest).toHaveAttribute('aria-hidden', 'true');
    expect(rest).toHaveAttribute('inert');
    expect(rest!.classList).toContain('invisible');
  });

  it('SIDE-8.1: the resting dock is drawn by the composer’s and the status line’s own parts, so its height can’t drift from theirs', async () => {
    renderApp('/s/a').snapshot([row({ id: 'a' })]);
    const composer = screen.getByRole('textbox', { name: 'Message' }).closest('form')!;
    const rest = document.querySelector<HTMLElement>('[data-dock-rest]')!;
    // What sets its height: the form, the box, the field, the Send button and the hint; then the bar.
    const parts = (form: Element) =>
      [form, form.firstElementChild, form.querySelector('textarea'), form.querySelector('button'), form.lastElementChild].map((el) => `${el?.tagName} ${el?.className}`);
    expect(parts(rest.querySelector('form')!)).toEqual(parts(composer));
    expect(rest.querySelector('textarea')).toHaveAttribute('rows', '1');
    expect(rest.lastElementChild!.className).toBe(screen.getByRole('group', { name: 'Status line' }).className);
  });

  it('SIDE-8.1: an empty composer is one line whatever its placeholder; typed text sizes it, and clearing it goes back', async () => {
    renderApp('/s/a').snapshot([row({ id: 'a', title: 'a-session-title-long-enough-to-wrap-in-a-narrow-main-pane' })]);
    const field = screen.getByRole('textbox', { name: 'Message' });
    expect(field.classList).toContain('field-sizing-fixed');
    expect(field.classList).toContain('placeholder:truncate');
    expect(field.classList).not.toContain('field-sizing-content');
    const user = userEvent.setup();
    await user.type(field, 'one{Shift>}{Enter}{/Shift}two');
    expect(field.classList).toContain('field-sizing-content');
    expect(field.classList).not.toContain('field-sizing-fixed');
    await user.clear(field);
    expect(field.classList).toContain('field-sizing-fixed');
  });

  it('SIDE-8.1: the resting docks fit the resting height: a one-line composer hint, a banner’s one-line title and two-line detail', async () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' }), row({ id: 'b', controllable: false })]);
    const hint = screen.getByText(/Enter sends/);
    expect(hint.classList).toContain('h-4');
    expect(hint.classList).toContain('truncate');

    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    const ended = await screen.findByText('This Session ended');
    expect(ended.classList).toContain('truncate');
    expect(ended.nextElementSibling!.classList).toContain('line-clamp-2');
  });

  /*
   * A dock note (a banner, a past Session's note) Tabbed to stays clamped, so the dock doesn't grow
   * and the usage panel doesn't move; the full text shows in an overlay above the dock line instead.
   * jsdom applies no CSS, so this checks the classes that do it; the overlay on screen is checked by
   * eye (manual).
   */
  async function expectClampedOnFocus(note: HTMLElement) {
    // The clamp cuts the detail short: the overlay only opens then.
    stubDockNote().detail = true;
    const text = note.querySelector<HTMLElement>('[data-dock-note-text]')!;
    const [title, detail] = [...text.querySelectorAll('p')];
    const overlay = () => note.querySelector<HTMLElement>('[data-dock-note-overlay]');
    const classes = () => [text, title!, detail!].map((el) => el.className);
    const resting = classes();
    expect(overlay()).toBeNull();
    const user = userEvent.setup();
    for (let i = 0; i < 40 && document.activeElement !== text; i++) await user.tab();
    expect(document.activeElement).toBe(text);
    // Still clamped, and nothing (no focus or hover variant) lifts the clamp.
    expect(classes()).toEqual(resting);
    expect(title!.classList).toContain('truncate');
    expect(detail!.classList).toContain('line-clamp-2');
    for (const el of [title!, detail!]) expect(el.className).not.toContain(':');
    // Screen readers read the full text in the note itself; no native tooltip doubles the overlay.
    expect(title).not.toHaveAttribute('title');
    expect(detail).not.toHaveAttribute('title');

    // The full text, in an overlay that opens upward, hidden from assistive tech since it repeats it.
    const shown = overlay()!;
    expect(shown.textContent).toBe(text.textContent);
    expect(shown).toHaveAttribute('aria-hidden', 'true');
    for (const c of ['absolute', '-translate-y-full']) expect(shown.classList).toContain(c);
    // Inside the main pane at any width: 1.25rem in from its left edge, and its widths, minimum
    // included, capped by the pane (the view) less 1.25rem on each side, never by the window.
    for (const c of ['left-5', 'max-w-[min(40rem,calc(100%-2.5rem))]', 'min-w-[min(16rem,calc(100%-2.5rem))]']) expect(shown.classList).toContain(c);
    expect(shown.className).not.toMatch(/vw|pointer-events-none/);
    // Out of flow, its containing block is the view, so the dock cell's scroll box neither grows nor
    // cuts it off: nothing between them is positioned.
    const view = note.closest<HTMLElement>('[data-shell-view]')!;
    expect(view.classList).toContain('relative');
    for (let el = shown.parentElement; el && el !== view; el = el.parentElement) expect(el.className).not.toMatch(/\b(relative|absolute|fixed|sticky)\b/);

    // Hover shows it too; it goes once neither holds.
    await user.hover(text);
    await user.tab();
    expect(document.activeElement).not.toBe(text);
    expect(overlay()).not.toBeNull();
    await user.unhover(text);
    expect(overlay()).toBeNull();
    expect(classes()).toEqual(resting);
  }

  it('SIDE-8.1: a clamped banner can be reached by keyboard; focused it stays clamped and shows its full text in an overlay', async () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' })]);
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    const title = await screen.findByText('This Session ended');
    await expectClampedOnFocus(title.closest<HTMLElement>('[role="status"]')!);
  });

  it('SIDE-8.1: a past Session’s note fits the resting height too: a one-line title and a two-line detail, the full text in an overlay on hover or focus', async () => {
    renderApp('/h/claude/gone-1', { pastSession: async () => PAST_DETAIL }).snapshot([]);
    const note = within(await screen.findByTestId('past-session')).getByRole('note');
    await expectClampedOnFocus(note);
  });

  /** The View only banner's text and its overlay, if open. */
  async function viewOnlyNote() {
    renderApp('/s/a').snapshot([row({ id: 'a', controllable: false })]);
    const title = await screen.findByText('View only: this Session runs in another app');
    const text = title.closest<HTMLElement>('[data-dock-note-text]')!;
    const overlay = () => document.querySelector<HTMLElement>('[data-dock-note-overlay]');
    return { text, overlay, view: text.closest<HTMLElement>('[data-shell-view]')! };
  }

  it('SIDE-8.1: the overlay opens only while the clamp cuts the text short, re-checked as the text or the pane resizes', async () => {
    const ro = fakeResizeObserver();
    const clip = stubDockNote();
    const { text, overlay, view } = await viewOnlyNote();
    const user = userEvent.setup();
    // Everything fits (a wide window): hovering or Tabbing to it opens nothing.
    await user.hover(text);
    expect(overlay()).toBeNull();
    for (let i = 0; i < 40 && document.activeElement !== text; i++) await user.tab();
    expect(document.activeElement).toBe(text);
    expect(overlay()).toBeNull();

    // The pane narrows and the detail's two lines no longer hold it: the open overlay follows.
    expect(ro.observed(text)).toBe(true);
    expect(ro.observed(view)).toBe(true);
    clip.detail = true;
    ro.resize(view);
    expect(overlay()).not.toBeNull();
    clip.detail = false;
    ro.resize(text);
    expect(overlay()).toBeNull();
    // A title cut short on its one line counts too.
    clip.title = true;
    ro.resize(text);
    expect(overlay()).not.toBeNull();
  });

  it('SIDE-8.1: Esc closes the overlay, and only keyboard focus holds it open, not a mouse click', async () => {
    stubDockNote().title = true;
    const { text, overlay } = await viewOnlyNote();
    const user = userEvent.setup();
    for (let i = 0; i < 40 && document.activeElement !== text; i++) await user.tab();
    expect(document.activeElement).toBe(text);
    expect(overlay()).not.toBeNull();
    // Esc closes it and leaves focus where it was; focusing the text again reopens it.
    await user.keyboard('{Escape}');
    expect(overlay()).toBeNull();
    expect(document.activeElement).toBe(text);
    await user.tab({ shift: true });
    await user.tab();
    expect(document.activeElement).toBe(text);
    expect(overlay()).not.toBeNull();

    // Opened by hover with focus elsewhere, Esc closes it too.
    await user.tab();
    expect(overlay()).toBeNull();
    await user.hover(text);
    expect(overlay()).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(overlay()).toBeNull();
    await user.unhover(text);

    // A mouse click focuses the text, and the overlay shows while the pointer is over it, but goes
    // once the pointer leaves: the click doesn't pin it.
    await user.click(text);
    expect(document.activeElement).toBe(text);
    expect(overlay()).not.toBeNull();
    await user.unhover(text);
    expect(document.activeElement).toBe(text);
    expect(overlay()).toBeNull();
  });

  it('SIDE-8.1: a click on the overlay goes no further: focus stays on the text and the click only closes it', async () => {
    stubDockNote().title = true;
    const { text, overlay } = await viewOnlyNote();
    const user = userEvent.setup();
    for (let i = 0; i < 40 && document.activeElement !== text; i++) await user.tab();
    const shown = overlay()!;
    // It takes the press itself (nothing under it gets it), and keeps focus on the text.
    expect(fireEvent.mouseDown(shown)).toBe(false);
    const path = window.location.pathname;
    await user.click(shown);
    expect(overlay()).toBeNull();
    expect(document.activeElement).toBe(text);
    expect(window.location.pathname).toBe(path);
  });

  it.each(views)('SIDE-8.1 (support): the %s view is a ShellView of shell cells, with a header cell', async (_, show) => {
    await show();
    const children = [...column('main')!.children];
    expect(children).toHaveLength(1);
    const view = children[0]!;
    expect(view.matches('[data-shell-view]')).toBe(true);
    for (const cell of view.children) expect(cell.matches('[data-shell-row]'), cell.outerHTML.slice(0, 80)).toBe(true);
    expect(view.querySelector(':scope > [data-shell-row="header"]')).not.toBeNull();
  });
});
