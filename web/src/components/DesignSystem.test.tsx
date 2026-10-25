import { FLEET_INSTALL_COMMAND } from '@shared/defaults.ts';
import type { HarnessOption, HistoryDetail, ServerEvent } from '@shared/types.ts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, launchView, renderApp, row, rowEl, settings } from '@/test/helpers';

/**
 * The design system's components in the places that use them (DS-4 to DS-8): each place draws its
 * Alert, Session marker, Loading, icon button, empty state, command, chip or key through the shared
 * one, and says what it said before.
 */

const sidebar = () => screen.getByRole('complementary', { name: 'Session sidebar' });
const main = () => document.querySelector<HTMLElement>('main')!;
const statusLine = () => screen.getByRole('group', { name: 'Status line' });
const loadingIn = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-slot="loading"]');

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.useRealTimers());

describe('Session marker in the sidebar', () => {
  it("DS-5.1: a sidebar row draws its Status through SessionMarker, in the sidebar's 18 px box", () => {
    const app = renderApp('/');
    app.snapshot([row({ id: 'a', status: 'needs-you' }), row({ id: 'b', status: 'busy' })]);
    for (const [id, status] of [['a', 'needs-you'], ['b', 'busy']] as const) {
      const marker = rowEl(id).querySelector('[data-session-marker]')!;
      expect(marker).toHaveAttribute('data-state', 'live');
      expect(marker).toHaveAttribute('data-status', status);
      expect(marker).toHaveClass('size-4.5');
    }
  });
});

describe('Alert in its places', () => {
  it("DS-4.3: the sidebar's \"Fleet isn't installed\" says what it said, in an error Alert with its command in a CommandBlock (DS-8.2)", () => {
    const app = renderApp('/');
    app.snapshot([], { state: 'not-installed', installCommand: FLEET_INSTALL_COMMAND });
    const alert = within(sidebar()).getByRole('alert');
    expect(alert).toHaveAttribute('data-slot', 'alert');
    expect(alert).toHaveTextContent(
      `Fleet isn't installedLookout finds Sessions through Fleet. Install it, and the list appears here on its own:${FLEET_INSTALL_COMMAND}Needs Rust's cargo, and tmux for Sessions Lookout can control.`,
    );
    expect(within(alert).getByText(FLEET_INSTALL_COMMAND)).toHaveAttribute('data-slot', 'command-block');
  });

  it('DS-4.3: the main pane\'s "This Session ended" and the composer\'s failed send keep their words, as Alerts', async () => {
    const gone = renderApp('/s/gone');
    gone.snapshot([row({ id: 'a' })]);
    const ended = within(main()).getByRole('status');
    expect(ended).toHaveAttribute('data-slot', 'alert');
    expect(ended).toHaveTextContent("This Session endedSession gone isn't running.");
    gone.unmount();

    const app = renderApp('/s/a', { sendMessage: async () => Promise.reject(new Error("Couldn't send: session has no terminal handle")) });
    app.snapshot([row({ id: 'a' })]);
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Message' }), 'hello{Enter}');
    const error = await within(main()).findByRole('alert');
    expect(error).toHaveAttribute('data-layout', 'inline');
    expect(error).toHaveTextContent("Couldn't send: session has no terminal handle");
  });
});

describe('Loading in its places', () => {
  it('DS-6.2: the chat keeps its skeleton, with "Reading the Transcript…" under it; from 15 s a hint and Show terminal, which opens the preview', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW });
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' })]);
    expect(screen.getByLabelText('Loading the chat')).toBeInTheDocument();
    const loading = loadingIn(main().querySelector<HTMLElement>('[data-shell-view]') ?? main())!;
    expect(within(loading).getByRole('status')).toHaveTextContent('Reading the Transcript…');
    expect(within(loading).queryByRole('button', { name: /Show terminal/ })).toBeNull();
    act(() => vi.advanceTimersByTime(5_000));
    expect(loading.querySelector('[data-field="elapsed"]')).toHaveTextContent(/· [45]s/);
    act(() => vi.advanceTimersByTime(11_000));
    expect(loading).toHaveTextContent('This is taking a while. The terminal preview still works.');
    fireEvent.click(within(loading).getByRole('button', { name: /Show terminal/ }));
    expect(screen.getByRole('button', { name: /^Terminal/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('DS-6.2: a View only Session has no terminal preview, so no hint and no button', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW });
    const app = renderApp('/s/v');
    app.snapshot([row({ id: 'v', backend: 'unknown', controllable: false })]);
    act(() => vi.advanceTimersByTime(20_000));
    const loading = loadingIn(main())!;
    expect(within(loading).getByRole('status')).toHaveTextContent('Reading the Transcript…');
    expect(loading).not.toHaveTextContent('This is taking a while');
    expect(within(loading).queryByRole('button')).toBeNull();
  });

  it('DS-6.3: the main pane, a starting and a past Session\'s view, the terminal preview and the usage strip and its details are a Loading', async () => {
    // The main pane before the Session list is known.
    const first = renderApp('/s/a');
    expect(within(loadingIn(main())!).getByRole('status')).toHaveTextContent('Loading…');
    first.unmount();

    // A starting Session's view before the first snapshot.
    const starting = renderApp('/l/l-1');
    expect(within(loadingIn(main())!).getByRole('status')).toHaveTextContent('Loading…');
    starting.unmount();

    // A past Session's view while it's read.
    const past = renderApp('/h/claude/p-1', { pastSession: () => new Promise<HistoryDetail>(() => {}) });
    past.snapshot([]);
    expect(within(loadingIn(main())!).getByRole('status')).toHaveTextContent('Loading…');
    past.unmount();

    // The terminal preview before its first lines, and the usage strip and details before a reading.
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' })]);
    fireEvent.click(screen.getByRole('button', { name: /^Terminal/ }));
    expect(within(loadingIn(screen.getByTestId('terminal-preview'))!).getByRole('status')).toHaveTextContent('Loading…');
    const strip = within(sidebar()).getByRole('button', { name: /usage/i });
    expect(within(loadingIn(strip)!).getByRole('status')).toHaveTextContent('Reading usage…');
    await userEvent.setup().click(strip);
    const details = await screen.findByRole('dialog', { name: 'Usage details' });
    expect(within(loadingIn(details)!).getByRole('status')).toHaveTextContent('Reading usage…');
  });

  it('DS-6.3: a status-line menu reads its choices with a Loading', async () => {
    const app = renderApp('/s/a', { harnesses: () => new Promise<HarnessOption[]>(() => {}) });
    app.snapshot([row({ id: 'a', model: 'claude-opus-5-5' })]);
    await userEvent.setup().click(within(statusLine()).getByRole('button', { name: /^Model: / }));
    const menu = await screen.findByRole('menu', { name: /^Model: / });
    expect(within(loadingIn(menu)!).getByRole('status')).toHaveTextContent('Loading…');
  });

  it('DS-6.4: with no live Session and no Starting row the main pane says "No Sessions running", and "Start a Session" opens the launcher, as N does', async () => {
    const app = renderApp('/');
    app.snapshot([]);
    expect(within(main()).getByText('No Sessions running')).toBeInTheDocument();
    expect(within(main()).queryByText('Select a Session')).toBeNull();
    expect(within(main()).queryByText('Move')).toBeNull(); // no keys to move through an empty list
    const kbd = within(main()).getByText('N');
    expect(kbd.tagName.toLowerCase()).toBe('kbd');
    await userEvent.setup().click(within(main()).getByRole('button', { name: 'Start a Session' }));
    expect(await screen.findByRole('dialog', { name: 'New Session' })).toBeInTheDocument();
  });

  it('DS-6.4: before the first snapshot the main pane loads, so the hint does not flash before "No Sessions running"', () => {
    const app = renderApp('/');
    expect(within(main()).getByRole('status')).toHaveTextContent('Loading…');
    expect(within(main()).queryByText('Select a Session')).toBeNull();
    expect(within(main()).queryByText('No Sessions running')).toBeNull();
    app.snapshot([]);
    expect(within(main()).getByText('No Sessions running')).toBeInTheDocument();
  });

  it('DS-6.4: with a Starting row or a Session, the hint stays (VIEW-5.4)', () => {
    const app = renderApp('/');
    app.emit({ type: 'snapshot', sessions: [], fleet: { state: 'ok' }, settings: settings(), launches: [launchView({ id: 'l-1' })], started: [], clientId: 'tab-1', usage: null, memory: null } as ServerEvent);
    expect(within(main()).getByText('Select a Session')).toBeInTheDocument();
    expect(within(main()).queryByText('No Sessions running')).toBeNull();
    app.snapshot([row({ id: 'a' })]);
    expect(within(main()).getByText('Select a Session')).toBeInTheDocument();
  });
});

describe('the status line', () => {
  it("DS-7.3: its text is meta, its model and Effort menus 24 px tall with 4 px each side, and the line stays 28 px", () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', model: 'claude-opus-5-5', effort: 'medium' })]);
    expect(statusLine()).toHaveClass('h-7', 'text-meta');
    for (const name of [/^Model: /, /^Effort: /]) {
      const button = within(statusLine()).getByRole('button', { name });
      expect(button).toHaveClass('h-6', 'px-1', 'text-meta');
    }
  });
});

describe('shared pieces in their places', () => {
  it("DS-8.1: the sidebar's and the chat's empty states and the main pane's hint are an EmptyState", () => {
    const app = renderApp('/');
    app.snapshot([]);
    expect(within(sidebar()).getByText('No live Sessions').closest('[data-slot="empty-state"]')).not.toBeNull();
    expect(within(main()).getByText('No Sessions running').closest('[data-slot="empty-state"]')).not.toBeNull();
    app.snapshot([row({ id: 'a' })]);
    expect(within(main()).getByText('Select a Session').closest('[data-slot="empty-state"]')).not.toBeNull();
  });

  it('DS-8.1: the chat\'s notices ("No messages yet") are an EmptyState', async () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' })], { state: 'ok' }, settings());
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    await waitFor(() => expect(within(main()).getByText('No chat').closest('[data-slot="empty-state"]')).not.toBeNull());
  });

  it("DS-8.4: a key is a Kbd: the Filter box's /, the main pane's hints, the launcher's Esc and ⌘↵ (and no sentence), the composer hint's i", async () => {
    const app = renderApp('/');
    app.snapshot([row({ id: 'a' })]);
    const isKbd = (el: HTMLElement) => expect(el).toHaveAttribute('data-slot', 'kbd');
    isKbd(within(sidebar()).getByText('/'));
    for (const key of ['↑', '↓', 'j', 'k', '1–9', 'J', 'N']) isKbd(within(main()).getByText(key));
    const user = userEvent.setup();
    await user.click(within(sidebar()).getByRole('button', { name: 'New Session' }));
    const dialog = await screen.findByRole('dialog', { name: 'New Session' });
    isKbd(within(dialog).getByText('Esc'));
    isKbd(within(dialog).getByText('⌘↵'));
    expect([...dialog.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['Esc', '⌘↵']); // "to close · your input is kept" is words, not a key
    expect(within(dialog).getByText(/to close · your input is kept/)).toBeInTheDocument();
  });

  it("DS-8.4: the composer hint's i is a Kbd", () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' })]);
    expect(within(main()).getByText('i')).toHaveAttribute('data-slot', 'kbd');
  });
});
