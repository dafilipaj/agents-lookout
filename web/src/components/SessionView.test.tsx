import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SaveError } from '@/lib/client';
import { renderApp, row, rowEl, settings } from '@/test/helpers';

const header = () => screen.getByRole('banner', { name: 'Session' });
const drawerToggle = () => screen.getByRole('button', { name: /Terminal/ });
const statusLine = () => screen.getByRole('group', { name: 'Status line' });

describe('Session view header', () => {
  it('VIEW-5.1: the header shows the title, Harness and Status, updating live; where it works and its model are not in it', () => {
    const app = renderApp('/s/a');
    app.snapshot([
      row({ id: 'a', title: 'fix-deal-rates', model: 'claude-opus-5-5', status: 'busy', contextPct: 41, git: { repo: 'work', worktree: 'crm-rates', branch: 'x' } }),
    ]);
    const h = header();
    expect(within(h).getByRole('heading', { level: 1 })).toHaveTextContent('fix-deal-rates');
    expect(h.querySelector('[data-field="harness"]')).toHaveTextContent(/Claude Code$/);
    expect(h.querySelector('[data-field="harness"]')).not.toHaveTextContent('·');
    expect(within(h).getByRole('img', { name: 'Claude Code' })).toHaveAttribute('data-harness', 'claude');
    expect(h.querySelector('[data-field="status"]')).toHaveTextContent('Busy');
    expect(h).not.toHaveTextContent('claude-opus-5-5');
    expect(h).not.toHaveTextContent('crm-rates');
    expect(h).not.toHaveTextContent('41% context');

    app.emit({
      type: 'sessions',
      upsert: [row({ id: 'a', title: 'renamed', model: 'claude-opus-5-5', status: 'needs-you', waitingFor: 'input needed', contextPct: 55 })],
      remove: [],
    });
    expect(within(h).getByRole('heading', { level: 1 })).toHaveTextContent('renamed');
    expect(h.querySelector('[data-field="status"]')).toHaveTextContent('Needs you');
    expect(h).toHaveTextContent('Waiting for: input needed');
  });

  it('VIEW-5.5: one status line directly below the composer shows repo, Worktree or branch, model and context use, updating live', () => {
    const app = renderApp('/s/a');
    app.snapshot([
      row({ id: 'a', model: 'claude-opus-5-5', contextPct: 41, git: { repo: 'work', worktree: 'crm-rates', branch: 'x' } }),
    ]);
    const line = statusLine();
    // Directly below the composer.
    const composer = screen.getByRole('textbox', { name: 'Message' }).closest('form')!;
    expect(composer.nextElementSibling).toBe(line);
    expect(line.querySelector('[data-field="repo"]')).toHaveTextContent('work');
    expect(line.querySelector('[data-field="location"]')).toHaveTextContent('crm-rates');
    expect(within(line).getByLabelText('Worktree')).toBeInTheDocument();
    expect(line.querySelector('[data-field="model"]')).toHaveTextContent('claude-opus-5-5');
    expect(line.querySelector('[data-field="context"]')).toHaveTextContent('41% context');
    expect(line).toHaveAttribute('title', 'work · crm-rates · claude-opus-5-5 · 41% context');

    app.emit({
      type: 'sessions',
      upsert: [row({ id: 'a', model: 'claude-sonnet-5-5', contextPct: 55, git: { repo: 'work', worktree: null, branch: 'main' } })],
      remove: [],
    });
    expect(line.querySelector('[data-field="location"]')).toHaveTextContent('main');
    expect(within(line).getByLabelText('Branch')).toBeInTheDocument();
    expect(line.querySelector('[data-field="model"]')).toHaveTextContent('claude-sonnet-5-5');
    expect(line.querySelector('[data-field="context"]')).toHaveTextContent('55% context');
  });

  it('VIEW-5.5: at narrow widths it stays one line: nothing wraps, long parts truncate, and the tooltip has it all', () => {
    const long = 'a-very-long-worktree-name-that-would-never-fit-at-a-narrow-width-'.repeat(3);
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', model: 'claude-opus-5-5', contextPct: 9, git: { repo: 'work', worktree: long, branch: 'x' } })]);
    const line = statusLine();
    expect(line).toHaveClass('whitespace-nowrap', 'overflow-hidden', 'h-7');
    for (const f of ['repo', 'model']) expect(line.querySelector(`[data-field="${f}"]`)).toHaveClass('truncate', 'min-w-0');
    expect(line.querySelector('[data-field="location"] .truncate')).toHaveTextContent(long);
    expect(line.querySelector('[data-field="location"]')).toHaveAttribute('title', long);
    expect(line.getAttribute('title')).toContain(long);
  });

  it('VIEW-5.5: without a composer (a view-only or ended Session) the status line sits at the bottom of the pane', () => {
    const app = renderApp('/s/orca');
    app.snapshot([row({ id: 'orca', backend: 'unknown', controllable: false, contextPct: 12 })]);
    const line = statusLine();
    expect(line.parentElement!.lastElementChild).toBe(line);
    expect(line.querySelector('[data-field="context"]')).toHaveTextContent('12% context');
  });

  it('VIEW-5.4: with nothing selected, the "Select a Session" hint stays', () => {
    const app = renderApp('/');
    app.snapshot([row({ id: 'a' })]);
    expect(screen.getByText('Select a Session')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
  });
});

describe('ending a Session', () => {
  const endButton = () => within(header()).queryByRole('button', { name: 'End Session' });

  it('VIEW-5.6: "End Session" is in the header only for a Controllable Session in a Session host of its own', () => {
    const app = renderApp('/s/own');
    app.snapshot([
      row({ id: 'own', ownHost: true }),
      row({ id: 'shared', ownHost: false }),
      row({ id: 'iterm', backend: 'iterm', ownHost: false }),
      row({ id: 'orca', backend: 'unknown', controllable: false, ownHost: false }),
    ]);
    expect(endButton()).toBeInTheDocument();
    for (const id of ['shared', 'iterm', 'orca']) {
      act(() => window.history.pushState(null, '', `/s/${id}`));
      act(() => window.dispatchEvent(new PopStateEvent('popstate')));
      expect(endButton()).toBeNull();
    }
  });

  it('VIEW-5.6: it asks in an in-app dialog first (never window.confirm); Cancel ends nothing, End Session ends it', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates', ownHost: true })]);
    await user.click(endButton()!);
    const dialog = screen.getByRole('dialog', { name: 'End “fix-rates”?' });
    expect(dialog).toHaveTextContent('you can resume it from History');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(app.client.endSession).not.toHaveBeenCalled();

    await user.click(endButton()!);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End Session' }));
    expect(app.client.endSession).toHaveBeenCalledWith('a', { pid: 100, procStart: '2026-10-14T08:12:03Z' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('VIEW-5.7: afterwards the Session shows as ended, its chat stays readable, and the button is gone', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates', ownHost: true })]);
    app.emit({ type: 'chat', sessionId: 'a', op: 'reset', entries: [{ kind: 'user', cursor: 'c1', ts: null, text: 'Fix the rounding', queued: false }], before: null, queue: [] });
    await user.click(endButton()!);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End Session' }));
    // Fleet closed it: the next list no longer has it.
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    expect(header().querySelector('[data-field="status"]')).toHaveTextContent('Ended');
    expect(screen.getByText('This Session ended')).toBeInTheDocument();
    expect(screen.getByText('Fix the rounding')).toBeInTheDocument();
    expect(endButton()).toBeNull();
  });

  it('VIEW-5.8: a refusal is shown in the dialog, which stays open to try again', async () => {
    const user = userEvent.setup();
    const endSession = vi.fn(async () => {
      throw new SaveError('Fleet is typing into it; try again.', null, 409);
    });
    const app = renderApp('/s/a', { endSession });
    app.snapshot([row({ id: 'a', ownHost: true })]);
    await user.click(endButton()!);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End Session' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Fleet is typing into it; try again.');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'End Session' })).toBeEnabled();
    // The rest of the page is hidden from assistive tech while the dialog is open.
    expect(document.querySelector('header [data-field="status"]')).not.toHaveTextContent('Ended');
  });
});

describe('ending the confirmed Session only', () => {
  const endButton = () => within(header()).queryByRole('button', { name: 'End Session' });
  const confirmIn = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'End Session' });

  it('VIEW-5.6: the dialog binds to the process it opened on: a restart meanwhile sends the confirmed pid and start time, not the new ones', async () => {
    const user = userEvent.setup();
    const endSession = vi.fn(async () => {
      throw new SaveError('This Session was restarted since you asked; nothing was closed.', null, 409);
    });
    const app = renderApp('/s/a', { endSession });
    app.snapshot([row({ id: 'a', ownHost: true, pid: 111, procStart: '2026-10-14T08:00:00Z' })]);
    await user.click(endButton()!);
    // Resumed from another tab under a new process while this dialog was open.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', ownHost: true, pid: 222, procStart: '2026-10-17T10:00:00Z' })], remove: [] });
    await user.click(confirmIn());
    expect(endSession).toHaveBeenCalledWith('a', { pid: 111, procStart: '2026-10-14T08:00:00Z' });
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('This Session was restarted since you asked; nothing was closed.');
  });

  it('VIEW-5.6: without a process start time the dialog refuses and says to close it in the terminal; nothing is sent', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', ownHost: true, procStart: null })]);
    await user.click(endButton()!);
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(/can’t confirm it’s the same Session.*Close it in the terminal/);
    expect(confirmIn()).toBeDisabled();
    expect(app.client.endSession).not.toHaveBeenCalled();
  });

  it('VIEW-5.6: background shortcuts stand down while the dialog is open: arrows, H and N change nothing behind it', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', ownHost: true }), row({ id: 'b', ownHost: true })]);
    await user.click(endButton()!);
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }).focus();
    for (const key of ['{ArrowDown}', '{ArrowUp}', 'j', 'k', 'h', 'n']) {
      await user.keyboard(key);
      expect(window.location.pathname).toBe('/s/a');
    }
    expect(screen.getAllByRole('dialog')).toHaveLength(1); // no launcher on top
    expect(screen.getByRole('dialog', { name: 'End “a”?' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: /History/ })).toBeNull();
    // Once it's closed they work again.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    const seen = new Set<string>();
    for (const key of ['{ArrowDown}', '{ArrowUp}']) {
      await user.keyboard(key);
      seen.add(window.location.pathname);
    }
    expect(seen).toContain('/s/b');
  });

  it('VIEW-5.6: ⌘N, ⌘1–9 and ⌘J stand down while the dialog is open too', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', ownHost: true }), row({ id: 'b', ownHost: true, status: 'needs-you' })]);
    await user.click(endButton()!);
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }).focus();
    for (const key of ['{Meta>}n{/Meta}', '{Meta>}1{/Meta}', '{Meta>}2{/Meta}', '{Meta>}j{/Meta}']) {
      await user.keyboard(key);
      expect(window.location.pathname).toBe('/s/a');
    }
    expect(screen.getAllByRole('dialog')).toHaveLength(1); // no launcher on top
    expect(screen.getByRole('dialog', { name: 'End “a”?' })).toBeInTheDocument();
    // Once it's closed they work again.
    await user.keyboard('{Escape}');
    await user.keyboard('{Meta>}j{/Meta}');
    expect(window.location.pathname).toBe('/s/b');
  });

  it('VIEW-5.6: focus goes to the header’s title when the button is gone: after a successful end, or Cancel once it no longer applies', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', ownHost: true }), row({ id: 'b', ownHost: true })]);
    const title = () => within(header()).getByRole('heading', { level: 1 });
    // Cancel after another Session joined its host: the button went while the dialog was open.
    await user.click(endButton()!);
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', ownHost: false })], remove: [] });
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(title()).toHaveFocus());
    // A successful end: focus doesn't go to the button that's about to go.
    await user.click(rowEl('b'));
    await user.click(endButton()!);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End Session' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(title()).toHaveFocus());
    app.emit({ type: 'sessions', upsert: [], remove: ['b'] });
    expect(title()).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('VIEW-5.6: a Codex Session getting its session id keeps an open or pending dialog, and the request’s result is shown', async () => {
    const user = userEvent.setup();
    let reject!: (e: Error) => void;
    const endSession = vi.fn(() => new Promise<never>((_, r) => (reject = r)));
    const app = renderApp('/s/codex%3A42', { endSession });
    const codex = (id: string) => row({ id, pid: 42, harness: 'codex', title: 'codex-run', ownHost: true, procStart: '2026-10-17T09:00:00Z' });
    app.snapshot([codex('codex:42')]);
    await user.click(endButton()!);
    // Open: it gets its session id, the selection follows, the dialog stays.
    app.emit({ type: 'sessions', upsert: [codex('uuid-1')], remove: ['codex:42'] });
    await waitFor(() => expect(window.location.pathname).toBe('/s/uuid-1'));
    expect(screen.getByRole('dialog', { name: 'End “codex-run”?' })).toBeInTheDocument();
    await user.click(confirmIn());
    expect(endSession).toHaveBeenCalledWith('uuid-1', { pid: 42, procStart: '2026-10-17T09:00:00Z' });
    await act(async () => reject(new SaveError('Fleet is typing into it; try again.', null, 409)));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Fleet is typing into it; try again.');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    // Pending: the request went out under the pid id; its result still reaches the dialog.
    app.emit({ type: 'snapshot', sessions: [codex('codex:43')].map((r) => ({ ...r, pid: 43 })), fleet: { state: 'ok' }, settings: settings(), launches: [], started: [], clientId: 'tab-1', usage: null });
    await act(async () => window.history.pushState({}, '', '/s/codex%3A43'));
    await act(async () => window.dispatchEvent(new PopStateEvent('popstate')));
    await user.click(endButton()!);
    await user.click(confirmIn());
    expect(endSession).toHaveBeenLastCalledWith('codex:43', { pid: 43, procStart: '2026-10-17T09:00:00Z' });
    app.emit({ type: 'sessions', upsert: [{ ...codex('uuid-2'), pid: 43 }], remove: ['codex:43'] });
    await waitFor(() => expect(window.location.pathname).toBe('/s/uuid-2'));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ending…' })).toBeDisabled();
    await act(async () => reject(new SaveError('This Session was restarted since you asked; nothing was closed.', null, 409)));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('restarted since you asked');
  });

  it('VIEW-5.6: closing the dialog, by Cancel or Escape, puts focus back on the End Session button', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', ownHost: true })]);
    await user.click(endButton()!);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(endButton()).toHaveFocus());
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(endButton()).toHaveFocus());
  });

  it('VIEW-5.8: an open or pending dialog stays when the button stops applying, so the shared-host refusal is still shown', async () => {
    const user = userEvent.setup();
    let reject!: (e: Error) => void;
    const endSession = vi.fn(() => new Promise<never>((_, r) => (reject = r)));
    const app = renderApp('/s/a', { endSession });
    app.snapshot([row({ id: 'a', ownHost: true })]);
    await user.click(endButton()!);
    // Another Session joined its host while the dialog was open: the button goes, the dialog stays.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', ownHost: false })], remove: [] });
    // (The page behind the dialog is hidden from assistive tech, so look it up in the DOM.)
    expect(document.querySelector('[data-slot="header-actions"]')).toBeEmptyDOMElement();
    await user.click(confirmIn());
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ending…' })).toBeDisabled();
    // And while it's pending.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', ownHost: false, backend: 'iterm' })], remove: [] });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => reject(new SaveError('This Session shares its Session host with other windows, so Lookout won’t end it. Close it in the terminal.', null, 409)));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(/shares its Session host.*Close it in the terminal/);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
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
    expect(screen.getByText('View only: this Session runs in another app')).toBeInTheDocument();
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
      app.emit({ type: 'snapshot', sessions: [row({ id: 'a' })], fleet: { state: 'ok' }, settings: settings(), launches: [], started: [], clientId: 'tab-9', usage: null }),
    );
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-9', 'a', false));
  });
});
