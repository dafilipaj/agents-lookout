import type { ChatEntry } from '@shared/types.ts';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import css from '@/index.css?raw';
import { RIGHT_TABS, TAB_LABEL, type RightTab } from '@/lib/right-sidebar';
import { type Mode, contrast, solid, themeTokens } from '@/test/contrast';
import { renderApp, row } from '@/test/helpers';

afterEach(() => window.localStorage.clear());

/** The right sidebar as this browser kept it: open, on `tab`. */
const remember = (tab: RightTab) => window.localStorage.setItem('lookout.right', JSON.stringify({ open: true, width: 420, tab }));
const edges = () => [...document.querySelectorAll<HTMLElement>('[data-keys-edge]')].map((e) => e.dataset.keysEdge);
const hintLine = () => document.querySelector<HTMLElement>('[data-field="keys-hint"]');
const message = () => screen.getByRole('textbox', { name: 'Message' });
const you = (text: string): ChatEntry => ({ kind: 'user', cursor: 'p1', ts: '2026-10-16T10:00:00Z', text, queued: false });

function open(path = '/s/a') {
  const app = renderApp(path);
  app.snapshot([row({ id: 'a', title: 'alpha' }), row({ id: 'b', title: 'beta' }), row({ id: 'c', title: 'gamma', controllable: false })]);
  return app;
}

describe('where your keys go (SIDE-11)', () => {
  it('SIDE-11.1: nothing takes focus as the page loads, whichever tab the right sidebar opens on; its key, or a click on its tab, still focuses a panel', async () => {
    for (const tab of RIGHT_TABS) {
      cleanup();
      window.localStorage.clear();
      remember(tab);
      open();
      await screen.findByRole('tabpanel', { name: TAB_LABEL[tab] });
      await act(async () => {}); // the panels' effects have run
      expect(document.activeElement, tab).toBe(document.body);
    }
    // Servers is showing: a click on History's tab focuses its search box, H closes it, H again opens it focused.
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'History' }));
    const search = screen.getByRole('searchbox', { name: /search/i });
    expect(search).toHaveFocus();
    await user.click(screen.getByRole('tab', { name: 'History' }));
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('h');
    expect(screen.queryByRole('tabpanel', { name: 'History' })).toBeNull();
    await user.keyboard('h');
    expect(screen.getByRole('searchbox', { name: /search/i })).toHaveFocus();
  });

  it('SIDE-11.2: with nothing focused the keys are the Session list’s: on a page loaded with History open, j moves the Session selection and History’s search box stays empty', async () => {
    remember('history');
    open();
    const search = await screen.findByRole('searchbox', { name: /search/i });
    await act(async () => {});
    const user = userEvent.setup();
    await user.keyboard('j');
    expect(window.location.pathname).toBe('/s/b');
    expect(search).toHaveValue('');
  });

  it('SIDE-11.3: the column that has the keys shows a 3 px `ring` edge over its header, following focus by key or click, none while a dialog is open; a popover leaves it where it opened', async () => {
    open();
    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'Message' });
    // The page itself is the Session list's.
    expect(edges()).toEqual(['left']);
    const edge = document.querySelector<HTMLElement>('[data-keys-edge]')!;
    expect([...edge.classList]).toEqual(expect.arrayContaining(['absolute', 'inset-x-0', 'top-0', 'h-[3px]', 'bg-ring', 'pointer-events-none']));
    expect(edge.className).not.toMatch(/transition|animate|duration/);
    expect(edge).toHaveAttribute('aria-hidden');
    // Placed absolutely in its positioned column, over the header: never a grid item, which would take a
    // cell and push the column's auto-placed cells out of its way (nothing moves when the keys do).
    expect(edge.parentElement).toHaveAttribute('data-shell-column', 'left');
    expect(edge.className).not.toMatch(/\b(?:row|col)-(?:start|end|span)-/);
    for (const column of document.querySelectorAll('[data-shell-column]')) expect(column, column.getAttribute('data-shell-column')!).toHaveClass('relative');
    // A click into the composer, then Esc out of it.
    await user.click(message());
    expect(edges()).toEqual(['main']);
    expect(document.querySelector('[data-keys-edge]')!.parentElement).toHaveAttribute('data-shell-column', 'main');
    await user.keyboard('{Escape}');
    expect(edges()).toEqual(['left']);
    // W opens Work focused: the right sidebar has the keys; W again closes it, and the page has them.
    await user.keyboard('w');
    expect(edges()).toEqual(['right']);
    await user.keyboard('w');
    await waitFor(() => expect(edges()).toEqual(['left']));
    // A click on a Session row.
    await user.click(message());
    await user.click(screen.getByText('beta'));
    expect(edges()).toEqual(['left']);
    // A popover opened from the Session sidebar leaves it there.
    await user.click(screen.getByRole('button', { name: 'Usage details' }));
    await screen.findByRole('dialog');
    expect(edges()).toEqual(['left']);
    await user.keyboard('{Escape}');
    // A dialog: no column has the keys.
    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(edges()).toEqual([]);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(edges()).toEqual(['left']));
  });

  it('SIDE-11.4: the edge keeps 3:1 or more against the Session sidebar’s header and the main pane’s, in both modes', () => {
    for (const mode of ['light', 'dark'] as Mode[]) {
      const t = themeTokens(css)[mode];
      for (const ground of ['sidebar', 'background']) expect(contrast(solid(t, 'ring'), solid(t, ground)), `${mode} ring on ${ground}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the hint line (VIEW-3.12)', () => {
  const words = () => hintLine()?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  it('VIEW-3.12: the hint line names who has the keys, then that place’s keys as Kbds, its words changing as focus moves', async () => {
    const app = open();
    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'Message' });
    expect(words()).toBe('Sessions · ↑ ↓ move · ⌘ J next that needs you · / filter · i write');
    // The region's name in `foreground`, medium; the rest stays the line's grey.
    expect(hintLine()!.firstElementChild).toHaveTextContent('Sessions');
    expect(hintLine()!.firstElementChild).toHaveClass('font-medium', 'text-foreground');
    expect(hintLine()!.closest('p')).toHaveClass('h-4', 'truncate', 'text-muted-foreground');
    expect([...hintLine()!.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['↑', '↓', '⌘', 'J', '/', 'i']);
    expect(hintLine()).toHaveAttribute('title', 'Sessions · ↑ ↓ move · ⌘ J next that needs you · / filter · i write');
    // Not a live region: the controls announce focus themselves.
    expect(hintLine()!.closest('[aria-live], [role="status"], [role="log"]')).toBeNull();
    await user.click(message());
    expect(words()).toBe('Composer · Enter send · ⇧ Enter new line · Esc leave');
    // The chat rail.
    app.emit({ type: 'chat', sessionId: 'a', op: 'reset', entries: [you('Fix the rounding')], before: null, queue: [] });
    const mark = await screen.findByRole('button', { name: /^Your prompt/ });
    act(() => mark.focus());
    expect(words()).toBe('This Session · i write · ↑ ↓ move between Marks');
    // The rest of the main pane.
    act(() => document.querySelector<HTMLElement>('main[tabindex]')!.focus());
    expect(words()).toBe('This Session · i write');
    // A panel's search box, then its list.
    act(() => document.querySelector<HTMLElement>('main[tabindex]')!.blur());
    await user.keyboard('h');
    expect(words()).toBe('History search · type to search · ↓ results · Esc back to History');
    // Esc in the empty search box hands the keys to History's tab; W then switches to Work, focused on its list.
    await user.keyboard('{Escape}');
    expect(words()).toBe('History · ↑ ↓ move · Enter expand · A add to Topic');
    await user.keyboard('w');
    // Work has no rows here, so W focuses Work itself, not a list: the line names it alone.
    expect(words()).toBe('Work');
    // Its keys show only where they work: in its list or on its tab. Anywhere else in it (a checkbox,
    // a button) names the panel alone, as Topics' "Archived" and Servers' "Show all" don't take them.
    await user.click(screen.getByRole('tab', { name: 'Library' }));
    act(() => screen.getByRole('listbox', { name: 'Outputs' }).focus());
    expect(words()).toBe('Library · ↑ ↓ move · Enter expand · O open · A add to Topic');
    act(() => screen.getByRole('checkbox', { name: 'Hide gone' }).focus());
    expect(words()).toBe('Library');
    // A dialog: no one has the keys, and the line says nothing.
    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(hintLine()).toBeNull();
  });

  it('VIEW-3.12: a Session view without a composer (View only) has no hint line', async () => {
    open('/s/c');
    await screen.findByRole('heading', { name: /gamma/ });
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    expect(hintLine()).toBeNull();
    expect(within(document.querySelector('main')!).queryByText(/^Sessions$/)).toBeNull();
  });
});
