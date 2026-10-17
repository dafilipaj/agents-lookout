import type { HistoryDetail, HistoryItem } from '@shared/types.ts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { NOW, launchView, renderApp, row } from '@/test/helpers';
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
    expect(column('right')).toBe(screen.getByTestId('history-panel'));
    expect(uses(column('right')!, SHELL_COLUMN)).toBe(true);
  });

  it('SIDE-8.1 (support): the Filter bar, the Session title bar and History’s search field are their columns’ header cells', async () => {
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

    // History's search field moved up into the header row, next to Close, like Filter on the left.
    const search = screen.getByRole('searchbox', { name: 'Search past Sessions' });
    expect(where(search)).toBe('header/right');
    const top = cellOf(search);
    expect(within(top).getByRole('button', { name: 'Close History' })).toBeInTheDocument();
    // No visible title, but the panel keeps its name and a heading.
    expect(within(top).getByRole('heading', { name: 'History' }).classList).toContain('sr-only');
    expect(screen.getByRole('complementary', { name: 'History sidebar' })).toBe(screen.getByTestId('history-panel'));
    // The toggles and the list sit below the line and run on past the dock to the bottom.
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
