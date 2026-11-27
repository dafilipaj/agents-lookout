import type { BotRun, BotsSnapshot } from '@shared/bots.ts';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inbox } from 'lucide-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaceButton, RailCount, RailMark } from '@/components/ui/place-rail';
import { renderApp, row } from '@/test/helpers';

const run = (over: Partial<BotRun> & { id: string }): BotRun => ({
  botId: 'bot-1', botName: 'Team week', name: 'Team week · Nov 23', dueAt: null, startedAt: 1_000, lateMs: 0, state: 'finished', sessionId: 'run-session', harness: 'claude',
  waitingFor: null, endedAt: 2_000, failure: null, session: 'ended', arrivedAt: 2_000, title: 'Team week 47', holds: { documents: 0, reply: true, first: null }, read: false, archived: false, launchId: null, ...over,
});
const bots = (runs: BotRun[]): BotsSnapshot => ({ state: 'ok', path: '~/.lookout/bots.json', error: null, bots: [], runs });

const rail = () => screen.getByTestId('place-rail');
const place = (name: RegExp | string) => within(screen.getByRole('navigation', { name: 'Places' })).getByRole('button', { name });
const leftColumn = () => document.querySelector<HTMLElement>('[data-shell-column="left"]')!;
const open = (path: string, sessions = [row({ id: 'a', title: 'alpha' }), row({ id: 'b', title: 'beta' })]) => {
  const app = renderApp(path);
  app.snapshot(sessions);
  return app;
};

/** A path opened as a link does, as the tests of other views do. */
const go = (path: string) =>
  act(() => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

beforeEach(() => window.sessionStorage.clear());

describe('the rail (NAV-1)', () => {
  it('NAV-1.1: the rail is the first column, 56 px, with Lookout’s mark at 20 px in its header cell and the places under it, Inbox, Sessions, then People', () => {
    open('/s/a');
    expect(document.querySelector('[data-shell]')!.firstElementChild).toBe(rail());
    expect(rail()).toHaveClass('w-14');
    const header = rail().querySelector('[data-shell-row="header"]')!;
    const mark = header.querySelector('[data-slot="lookout-mark"]')!;
    expect(mark).toHaveClass('size-5');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(within(screen.getByRole('navigation', { name: 'Places' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Inbox', 'Sessions', 'People']);
  });

  it('NAV-1.2: a place’s button shows its icon over its name, the current one has aria-current and the neutral wash, and its tooltip names its key', () => {
    open('/s/a');
    expect(place('Sessions')).toHaveAttribute('aria-current', 'page');
    expect(place('Sessions')).toHaveClass('bg-sidebar-accent');
    expect(place('Sessions').className).not.toMatch(/primary/);
    expect(place('Inbox')).not.toHaveAttribute('aria-current');
    expect(place('Inbox')).toHaveAttribute('title', 'Inbox (1)');
    expect(place('Sessions')).toHaveAttribute('title', 'Sessions (2)');
    expect(place('Inbox').querySelector('svg.lucide-inbox')).not.toBeNull();
  });

  it('NAV-1.3: Settings and Keyboard shortcuts are the rail’s last two buttons, and the Session sidebar’s header keeps its filter and New Session', async () => {
    const user = userEvent.setup();
    open('/s/a');
    const buttons = within(rail()).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(buttons.slice(-2)).toEqual(['Keyboard shortcuts', 'Settings']);
    const header = leftColumn().querySelector('[data-shell-row="header"]')!;
    expect(within(header as HTMLElement).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['New Session']);
    expect(within(header as HTMLElement).getByRole('searchbox', { name: 'Filter Sessions' })).toBeInTheDocument();
    // Settings is pressed while it's open; Keyboard shortcuts gets focus back when its dialog closes (SIDE-7.5).
    const settings = within(rail()).getByRole('button', { name: 'Settings' });
    expect(settings).toHaveAttribute('aria-pressed', 'false');
    await user.click(settings);
    expect(window.location.pathname).toBe('/settings');
    expect(settings).toHaveAttribute('aria-pressed', 'true');
    const keys = within(rail()).getByRole('button', { name: 'Keyboard shortcuts' });
    await user.click(keys);
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(keys).toHaveFocus();
  });
});

describe('a place owns the left column and the main pane (NAV-2)', () => {
  it('NAV-2.1: every path Lookout had before the rail is Sessions’, with the Session sidebar in the left column', () => {
    for (const path of ['/', '/s/a', '/h/claude/past-1', '/l/launch-1']) {
      const app = open(path);
      expect(place('Sessions'), path).toHaveAttribute('aria-current', 'page');
      expect(leftColumn()).toHaveAttribute('data-place', 'sessions');
      expect(screen.getByRole('complementary', { name: 'Session sidebar' })).toBeInTheDocument();
      app.unmount();
    }
  });

  it('NAV-2.2: /inbox is the Inbox’s: its list takes the left column, which keeps its width and its dock', () => {
    open('/inbox');
    expect(place('Inbox')).toHaveAttribute('aria-current', 'page');
    const column = screen.getByRole('complementary', { name: 'Inbox' });
    expect(column).toBe(leftColumn());
    expect(column).toHaveAttribute('data-place', 'inbox');
    expect(column).toHaveClass('w-[280px]');
    // The Sessions' own header and list are hidden, and the dock still holds the usage strip's cell.
    expect(screen.getByRole('searchbox', { name: 'Filter Sessions', hidden: true }).closest('[data-shell-row]')).toHaveClass('hidden');
    expect(column.querySelector('[data-shell-row="dock"]')).not.toHaveClass('hidden');
  });

  it('NAV-2.3: Settings and the Topic views keep the place you came from, over Sessions in a new tab, and a reload keeps it', async () => {
    const user = userEvent.setup();
    const app = open('/inbox');
    await user.click(within(rail()).getByRole('button', { name: 'Settings' }));
    expect(window.location.pathname).toBe('/settings');
    expect(place('Inbox')).toHaveAttribute('aria-current', 'page');
    expect(leftColumn()).toHaveAttribute('data-place', 'inbox');
    // A reload on Settings: the place last shown was kept in this browser tab.
    app.unmount();
    const reloaded = open('/settings');
    expect(place('Inbox')).toHaveAttribute('aria-current', 'page');
    reloaded.unmount();
    // A tab that never showed a place shows them over Sessions, whatever another tab last showed.
    for (const path of ['/settings', '/topics', '/topics/suggest']) {
      window.sessionStorage.clear();
      const fresh = open(path);
      expect(place('Sessions'), path).toHaveAttribute('aria-current', 'page');
      fresh.unmount();
    }
  });

  it('NAV-2.4: a place’s button shows it where you left it, and leaves Settings the same way; what’s gone falls back to the place’s start', async () => {
    const user = userEvent.setup();
    const app = open('/s/b', [row({ id: 'a', title: 'alpha', pid: 101 }), row({ id: 'b', title: 'beta', pid: 102 })]);
    app.emit({ type: 'bots', bots: bots([run({ id: 'r-1' })]) });
    await user.click(place(/^Inbox/));
    expect(window.location.pathname).toBe('/inbox');
    go('/inbox/r-1');
    await user.click(place('Sessions'));
    expect(window.location.pathname).toBe('/s/b');
    await user.click(place(/^Inbox/));
    expect(window.location.pathname).toBe('/inbox/r-1');
    // Settings over the Inbox: its place's button leaves it for the Report that was open.
    await user.click(within(rail()).getByRole('button', { name: 'Settings' }));
    await user.click(place(/^Inbox/));
    expect(window.location.pathname).toBe('/inbox/r-1');
    // The Session that was open ended meanwhile: Sessions opens on its own start.
    app.snapshot([row({ id: 'a', title: 'alpha', pid: 101 })]);
    await user.click(place('Sessions'));
    expect(window.location.pathname).toBe('/');
    // The Report is gone from the server: the Inbox opens on its own start.
    app.emit({ type: 'bots', bots: bots([]) });
    await user.click(place('Inbox'));
    expect(window.location.pathname).toBe('/inbox');
  });

  it('NAV-2.4: a Session that got its session id while you were in the Inbox is still the one Sessions opens on', async () => {
    const user = userEvent.setup();
    // A Codex Session before its first prompt is known by its process.
    const app = open('/s/codex:300', [row({ id: 'a', title: 'alpha', pid: 101 }), row({ id: 'codex:300', title: 'tide tables', harness: 'codex', pid: 300 })]);
    await user.click(place(/^Inbox/));
    app.snapshot([row({ id: 'a', title: 'alpha', pid: 101 }), row({ id: 'c0dec0de-0000-4000-8000-000000000300', title: 'tide tables', harness: 'codex', pid: 300 })]);
    await user.click(place('Sessions'));
    expect(window.location.pathname).toBe('/s/c0dec0de-0000-4000-8000-000000000300');
  });

  it('NAV-2.5: the right sidebar carries over a switch of place unchanged', async () => {
    const user = userEvent.setup();
    open('/s/a');
    await user.keyboard('w');
    const sidebar = screen.getByTestId('right-sidebar');
    expect(screen.getByRole('tab', { name: 'Work' })).toHaveAttribute('aria-selected', 'true');
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('1');
    expect(window.location.pathname).toBe('/inbox');
    expect(screen.getByTestId('right-sidebar')).toBe(sidebar);
    expect(screen.getByRole('tab', { name: 'Work' })).toHaveAttribute('aria-selected', 'true');
  });

  it('NAV-2.6: the Session sidebar keeps its filter and its selected Session over a switch of place and back', async () => {
    const user = userEvent.setup();
    open('/s/a');
    const filter = screen.getByRole('searchbox', { name: 'Filter Sessions' });
    await user.type(filter, 'alp');
    act(() => filter.blur());
    await user.keyboard('1');
    await user.keyboard('2');
    expect(window.location.pathname).toBe('/s/a');
    expect(screen.getByRole('searchbox', { name: 'Filter Sessions' })).toBe(filter);
    expect(filter).toHaveValue('alp');
    expect(screen.getByRole('option', { name: /alpha/ })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('what waits in each place (NAV-3)', () => {
  it('NAV-3.1: the Inbox’s button counts the unread Reports, neutral, and says so; none at 0', () => {
    const app = open('/s/a');
    expect(place('Inbox').querySelector('[data-field="count"]')).toBeNull();
    app.emit({ type: 'bots', bots: bots([run({ id: 'r-1' }), run({ id: 'r-2' }), run({ id: 'r-3', read: true }), run({ id: 'r-4', archived: true }), run({ id: 'r-5', arrivedAt: null, state: 'running' })]) });
    const button = place('Inbox, 2 unread');
    const count = button.querySelector('[data-field="count"]')!;
    expect(count).toHaveTextContent('2');
    expect(count).toHaveAttribute('data-tone', 'neutral');
    expect(count.className).not.toMatch(/needs-you|primary/);
  });

  it('NAV-3.2: the Sessions button counts the Sessions that Need you, in amber, in every place; none at 0', () => {
    const app = open('/inbox', [row({ id: 'a', title: 'alpha' })]);
    expect(place('Sessions').querySelector('[data-field="count"]')).toBeNull();
    app.snapshot([row({ id: 'a', title: 'alpha', status: 'needs-you' }), row({ id: 'b', title: 'beta', status: 'needs-you' }), row({ id: 'c', title: 'gamma' })]);
    const count = place('Sessions, 2 need you').querySelector('[data-field="count"]')!;
    expect(count).toHaveTextContent('2');
    expect(count).toHaveClass('bg-needs-you', 'text-needs-you-foreground');
    app.snapshot([row({ id: 'a', title: 'alpha', status: 'needs-you' })]);
    expect(place('Sessions, 1 needs you')).toBeInTheDocument();
    expect(document.title).toMatch(/^\(1\)/);
  });

  it('NAV-3.3: ⌘J in the Inbox selects the first Session that Needs you, which shows Sessions', () => {
    open('/inbox', [row({ id: 'a', title: 'alpha' }), row({ id: 'b', title: 'beta', status: 'needs-you' })]);
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    expect(window.location.pathname).toBe('/s/b');
    expect(place(/^Sessions/)).toHaveAttribute('aria-current', 'page');
  });

  it('NAV-3.3: from the Inbox ⌘J looks past the Session filter, which isn’t on screen there, and clears one that would hide the Session it lands on', async () => {
    const user = userEvent.setup();
    open('/s/a', [row({ id: 'a', title: 'alpha' }), row({ id: 'b', title: 'beta', status: 'needs-you' })]);
    const filter = screen.getByRole('searchbox', { name: 'Filter Sessions' });
    await user.type(filter, 'alp');
    act(() => filter.blur());
    // In Sessions the filter shows, and ⌘J keeps to the rows it leaves.
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    expect(window.location.pathname).toBe('/s/a');
    await user.keyboard('1');
    expect(place('Sessions, 1 needs you')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    expect(window.location.pathname).toBe('/s/b');
    expect(filter).toHaveValue('');
    expect(screen.getByRole('option', { name: /beta/ })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('keys (NAV-4)', () => {
  it('NAV-4.1: 1 shows the Inbox and 2 shows Sessions; not in a text field, with a modifier or while a dialog is open', async () => {
    const user = userEvent.setup();
    open('/s/a');
    await user.keyboard('1');
    expect(window.location.pathname).toBe('/inbox');
    await user.keyboard('2');
    expect(window.location.pathname).toBe('/s/a');
    // In a text field the digit is typed.
    await user.type(screen.getByRole('searchbox', { name: 'Filter Sessions' }), '1');
    expect(window.location.pathname).toBe('/s/a');
    act(() => (document.activeElement as HTMLElement).blur());
    fireEvent.keyDown(window, { key: '1', ctrlKey: true });
    fireEvent.keyDown(window, { key: '1', altKey: true });
    expect(window.location.pathname).toBe('/s/a');
    // A dialog owns the keyboard.
    await user.click(within(rail()).getByRole('button', { name: 'Keyboard shortcuts' }));
    await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    await user.keyboard('1');
    expect(window.location.pathname).toBe('/s/a');
  });

  it('NAV-4.2: in the Inbox the list’s keys never move the Session selection; New Session and the panels’ keys still work', async () => {
    const user = userEvent.setup();
    open('/s/a');
    await user.keyboard('1');
    await user.keyboard('j');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: '2', metaKey: true });
    expect(window.location.pathname).toBe('/inbox');
    // `/` is the Inbox's filter's, not the Sessions'.
    await user.keyboard('/');
    expect(screen.getByRole('searchbox', { name: 'Filter Sessions', hidden: true })).not.toHaveFocus();
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await user.keyboard('h');
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('n');
    expect(await screen.findByRole('dialog', { name: /New Session/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    // Back in Sessions the keys are the Sessions' again, from where it was left.
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await user.keyboard('2');
    await user.keyboard('j');
    expect(window.location.pathname).toBe('/s/b');
  });

  it('NAV-4.3: the keys’ edge sits on the left column in every place, and focus on a rail button counts as the list’s', async () => {
    const user = userEvent.setup();
    open('/s/a');
    expect(leftColumn().querySelector('[data-keys-edge="left"]')).not.toBeNull();
    await user.click(place('Inbox'));
    expect(place('Inbox')).toHaveFocus();
    expect(leftColumn()).toHaveAttribute('data-place', 'inbox');
    expect(leftColumn().querySelector('[data-keys-edge="left"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-keys-edge]')).toHaveLength(1);
    await user.click(place('People'));
    expect(place('People')).toHaveFocus();
    expect(leftColumn()).toHaveAttribute('data-place', 'people');
    expect(leftColumn().querySelector('[data-keys-edge="left"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-keys-edge]')).toHaveLength(1);
  });
});

describe('a place on the rail (DS-24)', () => {
  it('DS-24.1: a place’s button is its icon over its name, 48 by 44 px; current is aria-current on the neutral wash, and its name says what waits', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    const { rerender } = render(<PlaceButton label="Inbox" icon={Inbox} current={false} shortcut="1" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Inbox' });
    expect(button).toHaveClass('h-11', 'w-12', 'text-muted-foreground');
    expect(button).toHaveAttribute('title', 'Inbox (1)');
    expect(button).not.toHaveAttribute('aria-current');
    expect(button.querySelector('svg')).toHaveClass('size-4');
    expect(within(button).getByText('Inbox')).toHaveClass('text-caption');
    await user.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    rerender(<PlaceButton label="Inbox" icon={Inbox} current shortcut="1" count={3} countWords="3 unread" onPress={onPress} />);
    const current = screen.getByRole('button', { name: 'Inbox, 3 unread' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current).toHaveClass('bg-sidebar-accent', 'text-foreground');
    expect(current.className).not.toMatch(/primary/);
  });

  it('DS-24.2: the count is a caption pill on the icon’s corner: neutral for what is new, Needs you’s amber only when asked', () => {
    const { rerender, container } = render(<RailCount n={4} />);
    const neutral = container.querySelector('[data-field="count"]')!;
    expect(neutral).toHaveTextContent('4');
    expect(neutral).toHaveClass('text-caption', 'tabular-nums', 'rounded-full', 'bg-muted', 'text-muted-foreground', 'absolute');
    rerender(<RailCount n={2} tone="needs-you" />);
    const amber = container.querySelector('[data-field="count"]')!;
    expect(amber).toHaveClass('bg-needs-you', 'text-needs-you-foreground');
    expect(amber.className).not.toMatch(/bg-muted/);
  });

  it('DS-24.3: the rail’s mark is the Lens at 20 px, hidden from screen readers', () => {
    const { container } = render(<RailMark />);
    const mark = container.querySelector('[data-slot="lookout-mark"]')!;
    expect(mark).toHaveClass('size-5');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
  });
});
