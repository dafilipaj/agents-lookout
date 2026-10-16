import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SaveError } from '@/lib/client';
import { renderApp, row, rowEl, settings } from '@/test/helpers';

const header = () => screen.getByRole('banner', { name: 'Session' });
const drawerToggle = () => screen.getByRole('button', { name: /Terminal/ });

describe('Session view header', () => {
  it('VIEW-5.1: shows title, Harness, model, Status, repo, Worktree or branch and context, updating live', () => {
    const app = renderApp('/s/a');
    app.snapshot([
      row({ id: 'a', title: 'fix-deal-rates', model: 'claude-opus-5-5', status: 'busy', contextPct: 41, git: { repo: 'work', worktree: 'crm-rates', branch: 'x' } }),
    ]);
    const h = header();
    expect(within(h).getByRole('heading', { level: 1 })).toHaveTextContent('fix-deal-rates');
    expect(h).toHaveTextContent('Claude · claude-opus-5-5');
    expect(h.querySelector('[data-field="status"]')).toHaveTextContent('Busy');
    expect(h.querySelector('[data-field="repo"]')).toHaveTextContent('work');
    expect(h.querySelector('[data-field="location"]')).toHaveTextContent('crm-rates');
    expect(within(h).getByLabelText('Worktree')).toBeInTheDocument();
    expect(h.querySelector('[data-field="context"]')).toHaveTextContent('41% context');

    app.emit({
      type: 'sessions',
      upsert: [row({ id: 'a', title: 'renamed', model: 'claude-opus-5-5', status: 'needs-you', waitingFor: 'input needed', contextPct: 55, git: { repo: 'work', worktree: null, branch: 'main' } })],
      remove: [],
    });
    expect(within(h).getByRole('heading', { level: 1 })).toHaveTextContent('renamed');
    expect(h.querySelector('[data-field="status"]')).toHaveTextContent('Needs you');
    expect(h.querySelector('[data-field="location"]')).toHaveTextContent('main');
    expect(within(h).getByLabelText('Branch')).toBeInTheDocument();
    expect(h.querySelector('[data-field="context"]')).toHaveTextContent('55% context');
    expect(h).toHaveTextContent('Waiting for: input needed');
  });

  it('VIEW-5.4: with nothing selected, the "Select a Session" hint stays', () => {
    const app = renderApp('/');
    app.snapshot([row({ id: 'a' })]);
    expect(screen.getByText('Select a Session')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
  });
});

describe('terminal preview', () => {
  it('VIEW-2.1: an open drawer shows the terminal text as is, and the tab asks the server to peek only then', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', status: 'busy' })]);
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'a', false));
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false'); // collapsed by default
    expect(screen.queryByTestId('terminal-preview')).toBeNull();

    await user.click(drawerToggle());
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'a', true));
    app.emit({ type: 'preview', sessionId: 'a', text: '❯ Reply with OK\n⏺ OK  <b>not html</b>', error: null });
    expect(screen.getByTestId('terminal-preview').textContent).toBe('❯ Reply with OK\n⏺ OK  <b>not html</b>');

    app.emit({ type: 'preview', sessionId: 'a', text: '❯ Reply with OK\n⏺ OK', error: 'Preview failed: no such pane' });
    expect(drawerToggle()).toHaveTextContent('Preview failed: no such pane · retrying');

    await user.click(drawerToggle());
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'a', false));
  });

  it('VIEW-2.2 (support): opens on its own when the Session starts to Need you; a manual toggle wins until the Status changes', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    // As the server does, every Status change comes with a new status-change time.
    app.snapshot([row({ id: 'a', status: 'busy', statusSince: 1 })]);
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false');

    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'needs-you', statusSince: 2 })], remove: [] });
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true');
    await user.click(drawerToggle()); // you close it while it Needs you
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false');
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'needs-you', statusSince: 2, waitingFor: 'other' })], remove: [] });
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false'); // same Status: yours wins

    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'busy', statusSince: 3 })], remove: [] });
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'needs-you', statusSince: 4 })], remove: [] });
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true'); // needs you again: opens
  });

  it('VIEW-2.3 / VIEW-5.2: a Session that is not Controllable is read-only, with no preview or composer, and says why', async () => {
    const app = renderApp('/s/orca');
    app.snapshot([row({ id: 'orca', backend: 'unknown', controllable: false, status: 'needs-you' })]);
    expect(screen.queryByRole('button', { name: /Terminal/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    expect(screen.getByText('Read-only: this Session runs in another app')).toBeInTheDocument();
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'orca', false));
  });

  it('VIEW-5.3: when the Session ends, the composer and preview are replaced by "This Session ended"', async () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates', status: 'needs-you' })]);
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    expect(screen.getByText('This Session ended')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Terminal/ })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('fix-rates');
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'a', false));
  });
});

describe('composer', () => {
  it('VIEW-3.1: Enter sends; Shift+Enter adds a line', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' })]);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.type(box, 'Line one{Shift>}{Enter}{/Shift}Line two');
    expect(box).toHaveValue('Line one\nLine two');
    expect(app.client.sendMessage).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(app.client.sendMessage).toHaveBeenCalledWith('a', 'Line one\nLine two');
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('VIEW-3.4: if sending fails, the text stays and the error shows', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a', {
      sendMessage: async () => {
        throw new SaveError("Couldn't send: session has no terminal handle");
      },
    });
    app.snapshot([row({ id: 'a' })]);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.type(box, 'Reply with OK{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't send: session has no terminal handle");
    expect(box).toHaveValue('Reply with OK');
  });

  it('VIEW-3.5: each Session keeps its own unsent draft while switching', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', status: 'busy' }), row({ id: 'b' })]);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'draft for a');
    await user.click(rowEl('b'));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'draft for b');
    await user.click(rowEl('a'));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('draft for a');
    await user.click(rowEl('b'));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('draft for b');
  });

  it('VIEW-3.6 (support): `i` focuses the composer outside text fields; Esc leaves it', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' })]);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.keyboard('i');
    expect(box).toHaveFocus();
    expect(box).toHaveValue(''); // the `i` itself isn't typed
    await user.keyboard('{Escape}');
    expect(box).not.toHaveFocus();

    await user.click(screen.getByRole('searchbox', { name: 'Filter Sessions' }));
    await user.keyboard('i');
    expect(box).not.toHaveFocus();
  });

  it('switching Sessions points the server at the new one', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' }), row({ id: 'b' })]);
    await user.click(rowEl('b'));
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'b', false));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', null, false));
  });

  it('VIEW-2.2: opening a Session that Needs you asks for its preview straight away, never for no preview first', async () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', status: 'needs-you' })]);
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'a', true));
    expect(vi.mocked(app.client.watch).mock.calls).not.toContainEqual(['tab-1', 'a', false]);
  });

  it('coming back from Settings asks for exactly the drawer state shown', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', status: 'busy' })]);
    await user.click(screen.getByRole('button', { name: /Terminal/ })); // drawer open…
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'a', true));
    await user.click(screen.getByRole('button', { name: 'Settings' })); // …then away
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', null, false));
    vi.mocked(app.client.watch).mockClear();
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 30));
    });
    const shown = screen.getByRole('button', { name: /Terminal/ }).getAttribute('aria-expanded') === 'true';
    expect(vi.mocked(app.client.watch).mock.calls).toEqual([['tab-1', 'a', shown]]);
  });

  it('VIEW-3.4: text typed while a send is in flight survives its success', async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    const app = renderApp('/s/a', { sendMessage: () => new Promise<void>((r) => (finish = r)) });
    app.snapshot([row({ id: 'a' })]);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.type(box, 'first{Enter}');
    await user.type(box, ' and more');
    await act(async () => finish());
    expect(box).toHaveValue('first and more');
  });

  it('VIEW-3.4: a send in flight isn’t sent again after switching away and back', async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    const app = renderApp('/s/a', { sendMessage: () => new Promise<void>((r) => (finish = r)) });
    app.snapshot([row({ id: 'a' }), row({ id: 'b' })]);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'once{Enter}');
    await user.click(rowEl('b'));
    await user.click(rowEl('a'));
    await user.type(screen.getByRole('textbox', { name: 'Message' }), '{Enter}');
    expect(app.client.sendMessage).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''));
  });

  it('VIEW-3.4: a send that fails after switching away and back still shows its error', async () => {
    const user = userEvent.setup();
    let fail: (e: Error) => void = () => {};
    const app = renderApp('/s/a', { sendMessage: () => new Promise<void>((_, reject) => (fail = reject)) });
    app.snapshot([row({ id: 'a' }), row({ id: 'b' })]);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'hello{Enter}');
    await user.click(rowEl('b'));
    await user.click(rowEl('a'));
    await act(async () => fail(new SaveError("Couldn't send: the Session host refused the message.")));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't send: the Session host refused the message.");
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('hello');

    // Editing clears it.
    await user.type(screen.getByRole('textbox', { name: 'Message' }), '!');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('VIEW-3.5: a Codex Session’s draft and drawer state follow it when it gets its session id', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/codex%3A42');
    app.snapshot([row({ id: 'codex:42', pid: 42, harness: 'codex', status: 'busy' })]);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'half-typed');
    await user.click(screen.getByRole('button', { name: /Terminal/ })); // open it by hand
    app.emit({ type: 'sessions', upsert: [row({ id: 'uuid-1', pid: 42, harness: 'codex', status: 'busy' })], remove: ['codex:42'] });
    await waitFor(() => expect(window.location.pathname).toBe('/s/uuid-1'));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('half-typed');
    expect(screen.getByRole('button', { name: /Terminal/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('a reconnect (new event stream) says again what the tab views', async () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' })]);
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'a', false));
    await act(async () =>
      app.emit({ type: 'snapshot', sessions: [row({ id: 'a' })], fleet: { state: 'ok' }, settings: settings(), launches: [], started: [], clientId: 'tab-9' }),
    );
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-9', 'a', false));
  });
});
