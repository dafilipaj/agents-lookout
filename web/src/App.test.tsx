import { defaultSettings } from '@shared/settings.ts';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp, row, rowEl, settings } from '@/test/helpers';

const selected = () => document.querySelector('[aria-selected="true"]')?.getAttribute('data-session-id') ?? null;

describe('switching Sessions', () => {
  it('SIDE-4.2: the selected Session is in the URL, so reload and back/forward keep it', async () => {
    const user = userEvent.setup();
    const sessions = [row({ id: 'alpha', status: 'busy' }), row({ id: 'beta' }), row({ id: 'codex:42', harness: 'codex' })];

    // A reload: the app starts from the URL.
    const first = renderApp('/s/beta');
    first.snapshot(sessions);
    expect(selected()).toBe('beta');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('beta');

    await user.click(rowEl('alpha'));
    expect(window.location.pathname).toBe('/s/alpha');
    expect(selected()).toBe('alpha');

    await user.click(rowEl('codex:42'));
    expect(window.location.pathname).toBe('/s/codex%3A42');

    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(selected()).toBe('alpha');

    await act(async () => {
      window.history.forward();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(selected()).toBe('codex:42');

    first.unmount();
    const reloaded = renderApp(window.location.pathname);
    reloaded.snapshot(sessions);
    expect(selected()).toBe('codex:42');
  });

  it('SIDE-4.3 (support): a selected Session that ends stays selected, and the main pane says it ended', () => {
    const app = renderApp('/s/alpha');
    app.snapshot([row({ id: 'alpha', title: 'fix-rates' }), row({ id: 'beta' })]);
    app.emit({ type: 'sessions', upsert: [], remove: ['alpha'] });
    expect(window.location.pathname).toBe('/s/alpha');
    expect(screen.getByText('This Session ended')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('fix-rates');
  });

  it('keeps a Codex Session selected when it gets its session id', () => {
    const app = renderApp('/s/codex%3A42');
    app.snapshot([row({ id: 'codex:42', pid: 42, harness: 'codex' })]);
    app.emit({ type: 'sessions', upsert: [row({ id: 'uuid-1', pid: 42, harness: 'codex' })], remove: ['codex:42'] });
    expect(window.location.pathname).toBe('/s/uuid-1');
    expect(screen.queryByText('This Session ended')).toBeNull();
  });
});

describe('ended vs unknown', () => {
  it('SIDE-4.3 (support): after a reconnect, a Codex Session that got its session id meanwhile stays selected', () => {
    const app = renderApp('/s/codex%3A42');
    app.snapshot([row({ id: 'codex:42', pid: 42, harness: 'codex' })]);
    app.connection(false);
    // While disconnected, the Session got its id; the reconnect snapshot only has the new one.
    app.snapshot([row({ id: 'uuid-9', pid: 42, harness: 'codex' })]);
    expect(window.location.pathname).toBe('/s/uuid-9');
    expect(screen.queryByText('This Session ended')).toBeNull();
  });

  it('SIDE-4.3 (support): before Fleet first answers, a selected Session is loading, not ended', () => {
    const app = renderApp('/s/alpha');
    app.snapshot([], { state: 'starting' });
    expect(screen.queryByText('This Session ended')).toBeNull();
    expect(screen.getByText('Loading…')).toBeInTheDocument();

    // Fleet fails before ever answering: unknown, still not ended.
    app.emit({ type: 'fleet', fleet: { state: 'failing', lastOkAt: null, error: 'boom' } });
    expect(screen.queryByText('This Session ended')).toBeNull();
    expect(screen.getByText("Can't tell whether this Session is running")).toBeInTheDocument();

    // Fleet answers, and the Session is in the list.
    app.emit({ type: 'sessions', upsert: [row({ id: 'alpha' })], remove: [] });
    app.emit({ type: 'fleet', fleet: { state: 'ok' } });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('alpha');
    expect(screen.queryByText('This Session ended')).toBeNull();
  });

  it('SIDE-4.3 (support): a server restart, then a Codex Session’s new id, keeps it selected', () => {
    const app = renderApp('/s/codex%3A42');
    app.snapshot([row({ id: 'codex:42', pid: 42, harness: 'codex' })]);
    app.connection(false);
    // The server restarted: its first snapshot is empty while its first poll is pending…
    app.snapshot([], { state: 'starting' });
    // …then the poll brings the Session back under its new id.
    app.emit({ type: 'sessions', upsert: [row({ id: 'uuid-7', pid: 42, harness: 'codex' })], remove: [] });
    app.emit({ type: 'fleet', fleet: { state: 'ok' } });
    expect(window.location.pathname).toBe('/s/uuid-7');
    expect(screen.queryByText('This Session ended')).toBeNull();
  });

  it('SIDE-4.3 (support): a Session that is gone once the list is known again does end', () => {
    const app = renderApp('/s/alpha');
    app.snapshot([row({ id: 'alpha', pid: 5 })]);
    app.snapshot([], { state: 'starting' });
    app.emit({ type: 'sessions', upsert: [row({ id: 'other', pid: 6 })], remove: [] });
    app.emit({ type: 'fleet', fleet: { state: 'ok' } });
    expect(window.location.pathname).toBe('/s/alpha');
    expect(screen.getByText('This Session ended')).toBeInTheDocument();
  });

  it('SIDE-4.3 (support): after a server restart, the empty first snapshot does not end the selected Session', () => {
    const app = renderApp('/s/alpha');
    app.snapshot([row({ id: 'alpha' })]);
    app.snapshot([], { state: 'starting' }); // the server restarted; its first poll is pending
    expect(screen.queryByText('This Session ended')).toBeNull();
  });
});

describe('settings page', () => {
  it('SIDE-7.1 (support): the Settings page is reachable from the sidebar and saves the idle threshold', async () => {
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([]);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(window.location.pathname).toBe('/settings');
    const input = screen.getByLabelText('Idle threshold');
    expect(input).toHaveValue(4);
    await user.clear(input);
    await user.type(input, '2.5');
    const form = within(input.closest('form')!);
    await user.click(form.getByRole('button', { name: 'Save' }));
    expect(app.saveSettings).toHaveBeenCalledWith({ idleThresholdHours: 2.5 });
    expect(await form.findByText('Saved')).toBeInTheDocument();
  });

  it('SIDE-7.7: General has "Undo send", on by default, saying what it does; turning it off saves it', async () => {
    const user = userEvent.setup();
    const app = renderApp('/settings/general');
    app.snapshot([], { state: 'ok' }, settings({ undoSend: true }));
    const sw = screen.getByRole('switch', { name: 'Undo send' });
    expect(sw).toBeChecked();
    expect(sw).toHaveAccessibleDescription('Enter waits 3 s before sending, so Undo or Backspace can take the message back.');
    await user.click(sw);
    expect(app.client.saveSettings).toHaveBeenCalledWith({ undoSend: false });
    expect(defaultSettings().undoSend).toBe(true);
  });

  it('SIDE-7.6: Settings is two sub-pages, General and Tools, in a side nav; the sub-page is in the path, replaced on a switch, kept on a reload; the Settings button closes it from either', async () => {
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([]);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const nav = within(screen.getByRole('navigation', { name: 'Settings' }));
    expect(nav.getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href'), l.getAttribute('aria-current')])).toEqual([
      ['General', '/settings/general', 'page'],
      ['Tools', '/settings/tools', null],
    ]);
    // DS-13.1: the side nav's container query measures the pane, so the container has no padding of its own.
    const pane = screen.getByRole('navigation', { name: 'Settings' }).closest('.\\@container')!;
    expect(pane).not.toHaveClass('px-8');
    expect(pane.firstElementChild).toHaveClass('px-8');
    // General: every setting, under where they're kept; no Tools.
    expect(screen.getByText('Saved on this Mac, shared by every Lookout tab.')).toBeInTheDocument();
    for (const name of ['Idle threshold', 'Productive email', 'Directory to add']) expect(screen.getByLabelText(name)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Recommend Topics with Jev' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tools' })).toBeNull();
    const depth = window.history.length;
    await user.click(nav.getByRole('link', { name: 'Tools' }));
    expect(window.location.pathname).toBe('/settings/tools');
    expect(window.history.length).toBe(depth);
    expect(nav.getByRole('link', { name: 'Tools' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('region', { name: 'Tools' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Idle threshold')).toBeNull();
    // A ⌘-click is the browser's: a new browser tab, not a switch here.
    expect(fireEvent.click(nav.getByRole('link', { name: 'General' }), { metaKey: true })).toBe(true);
    expect(window.location.pathname).toBe('/settings/tools');
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(window.location.pathname).toBe('/');
    app.unmount();
    for (const [path, open] of [['/settings/tools', 'Tools'], ['/settings', 'General'], ['/settings/general', 'General'], ['/settings/nonsense', 'General']] as const) {
      const again = renderApp(path);
      again.snapshot([]);
      expect(within(screen.getByRole('navigation', { name: 'Settings' })).getByRole('link', { current: 'page' })).toHaveTextContent(open);
      again.unmount();
    }
  });
});
