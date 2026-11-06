import type { HistoryItem, LaunchRequest, LaunchView, ResumeResult } from '@shared/types.ts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, launchView, pressResult, renderApp, row } from '@/test/helpers';

type App = ReturnType<typeof renderApp>;

/** Starts a Session from the launcher with the given Harness; the fake server answers with launch `id`. */
async function startFromLauncher(harness: 'Claude Code' | 'Codex', id: string, title: string) {
  let sent: LaunchRequest | null = null;
  const launch = async (req: LaunchRequest): Promise<LaunchView> => {
    sent = req;
    return launchView({ id, title, harness: req.harness, directory: '~/Projects/work', startedAt: Date.now() - 4_000 });
  };
  const app = renderApp('/s/other', { launch });
  app.snapshot([row({ id: 'other' }), row({ id: 'busy-one', status: 'busy' })]);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'New Session' }));
  await screen.findByRole('dialog');
  await waitFor(() => expect(screen.getByRole('radio', { name: new RegExp(harness) })).toBeEnabled());
  await user.click(screen.getByRole('radio', { name: new RegExp(harness) }));
  await user.click(screen.getByRole('button', { name: /Start/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  return { app, user, sent: () => sent };
}

/** A request the test answers when it wants: the real server is slow while `fleet spawn` runs. */
function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A launcher whose `fleet spawn` hangs until the test answers; the server echoes the tab's launch id. */
function slowLaunches() {
  const pending: { req: LaunchRequest; id: string; answer: ReturnType<typeof deferred<LaunchView>> }[] = [];
  const launch = (req: LaunchRequest, id: string) => {
    const answer = deferred<LaunchView>();
    pending.push({ req, id, answer });
    return answer.promise;
  };
  const answer = async (i: number) => {
    const p = pending[i]!;
    await act(async () => p.answer.resolve(launchView({ id: p.id, title: p.req.name || 'New Session' })));
  };
  return { launch, pending, answer };
}

async function pressStart(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: 'New Session' }));
  await screen.findByRole('dialog');
  await waitFor(() => expect(screen.getByRole('button', { name: /^Start/ })).toBeEnabled());
  const nameField = screen.getByLabelText('Name');
  await user.clear(nameField);
  await user.type(nameField, name);
  await user.click(screen.getByRole('button', { name: /^Start/ }));
}

const startingList = () => screen.getByRole('list', { name: 'Starting Sessions' });
const startingRow = (title?: string) => {
  const rows = within(startingList()).getAllByRole('listitem');
  return title ? rows.find((r) => r.textContent?.includes(title))! : rows[0]!;
};
const view = () => screen.getByTestId('starting-view');
/** Lets effects and the router settle, without waiting a fixed time. */
const settle = () => act(async () => {});

function report(app: App, launchId: string, session: ReturnType<typeof row>) {
  app.emit({ type: 'sessions', upsert: [session], remove: [] });
  app.emit({ type: 'launches', launches: [], started: [{ launchId, sessionId: session.id }] });
}

const PAST: HistoryItem = {
  sessionId: 'codex-1',
  harness: 'codex',
  headless: false,
  title: 'kg-hook-review',
  projectPath: '/Users/me/Projects/work',
  repo: 'work',
  branch: 'main',
  lastActiveAt: NOW - 3 * 86_400_000,
  snippet: null,
  firstPrompt: null,
  projectDisplay: null,
  blocked: null,
};
const historyOf = (items: HistoryItem[]) => async () => ({ state: 'ok' as const, page: 1, hasMore: false, items });

beforeEach(() => window.localStorage.clear()); // History closed, so its keys don't take ↑/↓

describe('selecting a start the moment you press it (LAUNCH-4.2, HIST-3.1)', () => {
  it('LAUNCH-4.2: Start selects its "Starting…" row before the start request answers', async () => {
    const slow = slowLaunches();
    const app = renderApp('/s/other', { launch: slow.launch });
    app.snapshot([row({ id: 'other' })]);
    const user = userEvent.setup();
    await pressStart(user, 'fix-rates');
    const id = slow.pending[0]!.id;
    expect(window.location.pathname).toBe(`/l/${id}`);
    // The launcher is still open (modal), so the page behind it is hidden from the a11y tree.
    const row0 = within(screen.getByRole('list', { name: 'Starting Sessions', hidden: true })).getByRole('listitem', { hidden: true });
    expect(row0).toHaveAttribute('aria-current', 'true');
    expect(within(view()).getByRole('heading', { level: 1, hidden: true })).toHaveTextContent('fix-rates');
    // The server lists it (before answering, as it does): still one row, still selected.
    app.emit({ type: 'launches', launches: [launchView({ id, title: 'fix-rates' })], started: [] });
    expect(document.querySelectorAll('[data-launch-id]')).toHaveLength(1);
    await slow.answer(0);
    expect(window.location.pathname).toBe(`/l/${id}`);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('LAUNCH-4.2: a late answer never pulls you back from a Session you moved to meanwhile', async () => {
    const slow = slowLaunches();
    const app = renderApp('/s/other', { launch: slow.launch });
    app.snapshot([row({ id: 'other' }), row({ id: 'busy-one', status: 'busy' })]);
    const user = userEvent.setup();
    await pressStart(user, 'race');
    // Close the launcher while it's still starting, then go elsewhere.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByText('busy-one', { selector: '[data-field="title"]' }));
    expect(window.location.pathname).toBe('/s/busy-one');

    const id = slow.pending[0]!.id;
    app.emit({ type: 'launches', launches: [launchView({ id, title: 'race' })], started: [] });
    await slow.answer(0);
    await settle();
    expect(window.location.pathname).toBe('/s/busy-one');
    report(app, id, row({ id: 'race-id', title: 'race' }));
    await settle();
    expect(window.location.pathname).toBe('/s/busy-one');
  });

  it('HIST-3.1: a resume selects its "Starting…" row at once, and a late answer never pulls you back', async () => {
    const answer = deferred<ResumeResult>();
    let sentId = '';
    const app = renderApp('/', {
      history: historyOf([PAST]),
      resume: (_h, _s, launchId) => {
        sentId = launchId;
        return answer.promise;
      },
    });
    app.snapshot([row({ id: 'other' })]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'History' }));
    await pressResult(user, 'kg-hook-review');
    expect(window.location.pathname).toBe(`/l/${sentId}`);
    expect(within(view()).getByRole('img', { name: 'Codex' })).toBeInTheDocument();

    await user.click(screen.getByText('other', { selector: '[data-field="title"]' }));
    await act(async () => answer.resolve({ kind: 'started', launch: launchView({ id: sentId, title: 'kg-hook-review', harness: 'codex' }) }));
    await settle();
    expect(window.location.pathname).toBe('/s/other');
    report(app, sentId, row({ id: 'codex-1', harness: 'codex', title: 'kg-hook-review' }));
    await settle();
    expect(window.location.pathname).toBe('/s/other');
  });

  it('HIST-3.1: a resume already under way answers with its own row, which is selected instead; a live one selects the Session', async () => {
    const answers: ResumeResult[] = [
      { kind: 'started', launch: launchView({ id: 'l-old', title: 'kg-hook-review', harness: 'codex' }) },
      { kind: 'live', sessionId: 'codex-1' },
    ];
    const app = renderApp('/', { history: historyOf([PAST]), resume: async () => answers.shift()! });
    app.snapshot([row({ id: 'other' })]);
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-old', title: 'kg-hook-review', harness: 'codex' })], started: [] });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'History' }));
    await pressResult(user, 'kg-hook-review');
    await waitFor(() => expect(window.location.pathname).toBe('/l/l-old'));
    expect(within(startingList()).getAllByRole('listitem')).toHaveLength(1);

    await pressResult(user, 'kg-hook-review');
    await waitFor(() => expect(window.location.pathname).toBe('/s/codex-1'));
    expect(within(startingList()).getAllByRole('listitem')).toHaveLength(1); // its own row went
  });

  it('LAUNCH-4.4: a start that fails goes back to where you pressed Start; the launcher keeps the error', async () => {
    const slow = slowLaunches();
    const app = renderApp('/s/other', { launch: slow.launch });
    app.snapshot([row({ id: 'other' })]);
    const user = userEvent.setup();
    await pressStart(user, 'taken');
    expect(window.location.pathname).toMatch(/^\/l\//);
    await act(async () => slow.pending[0]!.answer.reject(new Error('A Session host named taken already exists. Pick another name.')));
    expect(window.location.pathname).toBe('/s/other');
    expect(screen.queryByRole('list', { name: 'Starting Sessions' })).toBeNull();
    expect(within(screen.getByRole('dialog')).getByText(/already exists/)).toBeInTheDocument();
  });

  it('LAUNCH-4.2: two starts in a row: the second is selected, and the first one being reported leaves it alone', async () => {
    const slow = slowLaunches();
    const app = renderApp('/s/other', { launch: slow.launch });
    app.snapshot([row({ id: 'other' })]);
    const user = userEvent.setup();
    // The launcher takes one start at a time: the second Start comes once the first has answered.
    await pressStart(user, 'first');
    await slow.answer(0);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await pressStart(user, 'second');
    const [a, b] = [slow.pending[0]!.id, slow.pending[1]!.id];
    expect(window.location.pathname).toBe(`/l/${b}`);
    await slow.answer(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(startingRow('second')).toHaveAttribute('aria-current', 'true');
    expect(startingRow('first')).not.toHaveAttribute('aria-current');

    report(app, a, row({ id: 'first-id', title: 'first' }));
    await settle();
    expect(window.location.pathname).toBe(`/l/${b}`);
    report(app, b, row({ id: 'second-id', title: 'second' }));
    await waitFor(() => expect(window.location.pathname).toBe('/s/second-id'));
    // Back: the first start's URL was left behind by the second Start, and it became its Session.
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe('/s/first-id'));
  });

  it('HIST-3.1, LAUNCH-4.2: Start, then a resume while it starts: the resume is selected, and the start doesn’t take it back', async () => {
    const slow = slowLaunches();
    const resumeAnswer = deferred<ResumeResult>();
    let resumeId = '';
    const app = renderApp('/s/other', {
      launch: slow.launch,
      history: historyOf([PAST]),
      resume: (_h, _s, id) => {
        resumeId = id;
        return resumeAnswer.promise;
      },
    });
    app.snapshot([row({ id: 'other' })]);
    const user = userEvent.setup();
    await pressStart(user, 'first');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'History' }));
    await pressResult(user, 'kg-hook-review');
    expect(window.location.pathname).toBe(`/l/${resumeId}`);

    await slow.answer(0);
    report(app, slow.pending[0]!.id, row({ id: 'first-id', title: 'first' }));
    await settle();
    expect(window.location.pathname).toBe(`/l/${resumeId}`);
    await act(async () => resumeAnswer.resolve({ kind: 'started', launch: launchView({ id: resumeId, title: 'kg-hook-review', harness: 'codex' }) }));
    report(app, resumeId, row({ id: 'codex-1', harness: 'codex', title: 'kg-hook-review' }));
    await waitFor(() => expect(window.location.pathname).toBe('/s/codex-1'));
  });

  it('LAUNCH-4.2: an answer for a start dismissed meanwhile doesn’t bring its row back', async () => {
    const slow = slowLaunches();
    const app = renderApp('/s/other', { launch: slow.launch });
    app.snapshot([row({ id: 'other' })]);
    const user = userEvent.setup();
    await pressStart(user, 'gone');
    await user.keyboard('{Escape}');
    const id = slow.pending[0]!.id;
    app.emit({ type: 'launches', launches: [launchView({ id, title: 'gone', state: 'failed', error: 'x' })], started: [] });
    app.emit({ type: 'launches', launches: [], started: [] }); // dismissed (here or in another tab)
    await slow.answer(0);
    await settle();
    expect(screen.queryByRole('list', { name: 'Starting Sessions' })).toBeNull();
  });
});

describe('selecting a start (LAUNCH-4.2, 4.6, 4.7)', () => {
  it.each([
    ['Claude Code', 'claude', 'fix-rates', 'fix-rates-id'],
    ['Codex', 'codex', 'kg-hook', 'codex:4242'],
  ] as const)(
    'LAUNCH-4.2, LAUNCH-4.6: with %s, the selected "Starting…" row’s view shows the start, and the Session takes over once Fleet reports it',
    async (label, harness, title, sessionId) => {
      const { app, sent } = await startFromLauncher(label, 'l-1', title);
      expect(sent()?.harness).toBe(harness);

      expect(window.location.pathname).toBe('/l/l-1');
      expect(startingRow()).toHaveAttribute('aria-current', 'true');
      expect(startingRow()).toHaveTextContent(title);
      const header = within(view()).getByRole('banner', { name: 'Starting Session' });
      expect(within(header).getByRole('heading', { level: 1 })).toHaveTextContent(title);
      expect(within(header).getByRole('img', { name: label })).toHaveAttribute('data-harness', harness);
      expect(header).toHaveTextContent(label);
      expect(header.querySelector('[data-field="status"]')).toHaveTextContent(/^Starting…$/);
      // LAUNCH-7.3: where it's starting, once, under your prompt; the header says the Harness.
      const loading = view().querySelector<HTMLElement>('[data-field="arriving"] [data-slot="loading"]')!;
      expect(loading).toHaveTextContent(`${label} is starting in work…`);
      expect(loading.querySelector('[title="~/Projects/work"]')).not.toBeNull();
      expect(within(view()).getByRole('status')).toHaveTextContent(`${label} is starting in work…`);

      // The `launches` event arrives: still one row, still selected.
      app.emit({ type: 'launches', launches: [launchView({ id: 'l-1', title, harness })], started: [] });
      expect(startingRow()).toHaveAttribute('aria-current', 'true');

      report(app, 'l-1', row({ id: sessionId, title, harness, pid: 4242 }));
      await waitFor(() => expect(window.location.pathname).toBe(`/s/${encodeURIComponent(sessionId)}`));
      expect(screen.getByRole('banner', { name: 'Session' })).toHaveTextContent(title);
      expect(screen.queryByTestId('starting-view')).toBeNull();
      // Replaced, not pushed: Back doesn't return to the start that's gone.
      window.history.back();
      await waitFor(() => expect(window.location.pathname).toBe('/s/other'));
    },
  );

  it.each([
    ['Claude Code', 'claude'],
    ['Codex', 'codex'],
  ] as const)('LAUNCH-4.6: with %s, a start that failed shows its error and its terminal’s last lines in place of the waiting note', async (label, harness) => {
    const { app } = await startFromLauncher(label, 'l-2', 'stuck');
    const failed = launchView({
      id: 'l-2',
      title: 'stuck',
      harness,
      state: 'failed',
      error: "Fleet hasn't reported it after 15 s. Its Session host is still running.",
      terminal: ['Quick safety check', '❯ 1. Yes, I trust this folder', '  2. No, exit'],
    });
    app.emit({ type: 'launches', launches: [failed], started: [] });
    expect(window.location.pathname).toBe('/l/l-2');
    expect(view().querySelector('[data-field="status"]')).toHaveTextContent("Didn't start");
    expect(within(view()).getByRole('alert')).toHaveTextContent(/^Fleet hasn't reported it after 15 s. Its Session host is still running.$/);
    const terminal = within(view()).getByRole('region', { name: "Its terminal's last lines" });
    expect(terminal.querySelector('pre')!.textContent).toBe('Quick safety check\n❯ 1. Yes, I trust this folder\n  2. No, exit');
    expect(view().querySelector('[data-field="arriving"]')).toBeNull();
    expect(view().querySelector('[data-field="started"]')).toHaveTextContent(/^Started in ~\/Projects\/work \S+ ago$/);
  });

  it('LAUNCH-4.5, LAUNCH-4.6: a failed row stays compact while selected (the view has the detail), and shows the error and lines when it isn’t', async () => {
    const app = renderApp('/l/l-2');
    app.snapshot([row({ id: 'a' })]);
    const failed = launchView({ id: 'l-2', title: 'stuck', state: 'failed', error: "Fleet hasn't reported it after 15 s.", terminal: ['Trust this folder?'] });
    app.emit({ type: 'launches', launches: [failed], started: [] });
    const r = startingRow();
    expect(r).toHaveTextContent("stuck");
    expect(r).toHaveTextContent("Didn't start");
    expect(within(r).getByRole('button', { name: 'Dismiss stuck' })).toBeInTheDocument();
    expect(r).not.toHaveTextContent("Fleet hasn't reported it");
    expect(r.querySelector('pre')).toBeNull();

    await userEvent.setup().click(screen.getByText('a', { selector: '[data-field="title"]' }));
    expect(startingRow()).toHaveTextContent("Fleet hasn't reported it after 15 s.");
    expect(startingRow().querySelector('pre')).toHaveTextContent('Trust this folder?');
  });

  it("LAUNCH-4.5: an unselected failed row's error wraps instead of being cut, and is not announced again (the view says it when selected)", async () => {
    const error = "Claude is waiting on 'Quick safety check: is this a project you created or one you trust?' in the terminal.";
    const app = renderApp('/l/l-2');
    app.snapshot([row({ id: 'a' })]);
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-2', title: 'stuck', state: 'failed', error })], started: [] });
    // Selected: the view announces the failure, the row shows none.
    expect(within(view()).getByRole('alert')).toHaveTextContent(error);
    await userEvent.setup().click(screen.getByText('a', { selector: '[data-field="title"]' }));
    const shown = within(startingRow()).getByText(error);
    expect(shown.closest('[data-slot="alert"]')).not.toHaveAttribute('role');
    expect(shown).not.toHaveClass('truncate');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['Claude Code', 'claude', 'new-claude'],
    ['Codex', 'codex', 'codex:5150'],
  ] as const)('LAUNCH-4.2: with %s, a Session you moved to before it appeared stays selected', async (label, harness, sessionId) => {
    const { app, user } = await startFromLauncher(label, 'l-3', 'later');
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-3', title: 'later', harness })], started: [] });
    expect(window.location.pathname).toBe('/l/l-3');

    // Move to another Session while it starts.
    await user.click(screen.getByText('busy-one', { selector: '[data-field="title"]' }));
    expect(window.location.pathname).toBe('/s/busy-one');
    expect(startingRow()).not.toHaveAttribute('aria-current');

    report(app, 'l-3', row({ id: sessionId, title: 'later', harness, pid: 5150 }));
    await settle();
    expect(window.location.pathname).toBe('/s/busy-one');
    expect(screen.getByRole('banner', { name: 'Session' })).toHaveTextContent('busy-one');
  });

  it('LAUNCH-4.2: selecting the "Starting…" row again before it appears lets the Session take over', async () => {
    const { app, user } = await startFromLauncher('Claude Code', 'l-4', 'again');
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-4', title: 'again' })], started: [] });
    await user.click(screen.getByText('busy-one', { selector: '[data-field="title"]' }));
    await user.click(startingRow());
    expect(window.location.pathname).toBe('/l/l-4');
    report(app, 'l-4', row({ id: 'again-id', title: 'again' }));
    await waitFor(() => expect(window.location.pathname).toBe('/s/again-id'));
  });

  it('LAUNCH-4.2: two starts under way, the unselected one reported first: the selected one keeps the selection until its own Session takes over', async () => {
    const app = renderApp('/l/l-b');
    app.snapshot([row({ id: 'a' })]);
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-a', title: 'one' }), launchView({ id: 'l-b', title: 'two' })], started: [] });
    app.emit({ type: 'sessions', upsert: [row({ id: 'one-id', title: 'one' })], remove: [] });
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-b', title: 'two' })], started: [{ launchId: 'l-a', sessionId: 'one-id' }] });
    await settle();
    expect(window.location.pathname).toBe('/l/l-b');
    expect(startingRow('two')).toHaveAttribute('aria-current', 'true');
    report(app, 'l-b', row({ id: 'two-id', title: 'two' }));
    await waitFor(() => expect(window.location.pathname).toBe('/s/two-id'));
  });

  it('LAUNCH-4.7: "Starting…" rows are rows for ↑/↓, j/k and ⌘1–9, above the Sessions; a failed one takes no ⌘ number; ⌘J skips them', async () => {
    const app = renderApp('/');
    app.snapshot([row({ id: 'a', status: 'needs-you' }), row({ id: 'b' })]);
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-1', title: 'one' }), launchView({ id: 'l-2', title: 'two', state: 'failed' })], started: [] });
    const user = userEvent.setup();

    await user.keyboard('{Meta>}1{/Meta}');
    expect(window.location.pathname).toBe('/l/l-1');
    await user.keyboard('{ArrowDown}');
    expect(window.location.pathname).toBe('/l/l-2');
    await user.keyboard('j');
    expect(window.location.pathname).toBe('/s/a');
    await user.keyboard('k');
    expect(window.location.pathname).toBe('/l/l-2');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(window.location.pathname).toBe('/l/l-1');
    // ⌘2 is the first Session: the failed start doesn't hold a number while it waits to be dismissed.
    await user.keyboard('{Meta>}2{/Meta}');
    expect(window.location.pathname).toBe('/s/a');
    await user.keyboard('{Meta>}3{/Meta}');
    expect(window.location.pathname).toBe('/s/b');
    // ⌘J goes to the next Session that needs you, never to a "Starting…" row.
    await user.keyboard('{Meta>}j{/Meta}');
    expect(window.location.pathname).toBe('/s/a');
    await user.keyboard('{Meta>}j{/Meta}');
    expect(window.location.pathname).toBe('/s/a');
  });

  it('LAUNCH-4.7 (support): filtering the Sessions leaves the "Starting…" rows in place', async () => {
    const app = renderApp('/');
    app.snapshot([row({ id: 'alpha' }), row({ id: 'beta' })]);
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-1', title: 'one' })], started: [] });
    await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Filter Sessions' }), 'zzz');
    expect(screen.getByText('No matching Sessions')).toBeInTheDocument();
    expect(startingRow()).toHaveTextContent('one');
  });

  it('LAUNCH-4.6: a start the tab doesn’t list says so', () => {
    renderApp('/l/gone').snapshot([row({ id: 'a' })]);
    expect(screen.getByText('This start is no longer listed')).toBeInTheDocument();
    expect(screen.getByText(/or Lookout restarted/)).toBeInTheDocument();
  });
});

describe('dismissing the selected failed start (LAUNCH UX)', () => {
  const failed = (id: string, title: string) => launchView({ id, title, state: 'failed', error: 'x', terminal: ['y'] });

  it('the next start takes the selection; focus goes to its Dismiss button when it failed too', async () => {
    const app = renderApp('/l/l-1');
    app.snapshot([row({ id: 'a' })]);
    app.emit({ type: 'launches', launches: [failed('l-1', 'one'), failed('l-2', 'two')], started: [] });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Dismiss one' }));
    expect(app.client.dismissLaunch).toHaveBeenCalledWith('l-1');
    expect(window.location.pathname).toBe('/l/l-2');
    app.emit({ type: 'launches', launches: [failed('l-2', 'two')], started: [] });
    expect(screen.getByRole('button', { name: 'Dismiss two' })).toHaveFocus();
  });

  it('with no other start left, nothing is selected and focus goes to the main pane', async () => {
    const app = renderApp('/l/l-1');
    app.snapshot([row({ id: 'a' })]);
    app.emit({ type: 'launches', launches: [failed('l-1', 'one')], started: [] });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss one' }));
    expect(window.location.pathname).toBe('/');
    app.emit({ type: 'launches', launches: [], started: [] });
    expect(screen.getByRole('main')).toHaveFocus();
    expect(screen.getByText('Select a Session')).toBeInTheDocument();
    expect(screen.queryByText('This start is no longer listed')).toBeNull();
  });

  it('dismissing one that isn’t selected keeps the selection', async () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' })]);
    app.emit({ type: 'launches', launches: [failed('l-1', 'one')], started: [] });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss one' }));
    app.emit({ type: 'launches', launches: [], started: [] });
    expect(window.location.pathname).toBe('/s/a');
    expect(screen.getByRole('main')).toHaveFocus();
  });
});

describe('the Session, arriving (LAUNCH-7)', () => {
  afterEach(() => vi.useRealTimers());
  const header = () => within(view()).getByRole('banner', { name: 'Starting Session' });
  const firstPrompt = () => view().querySelector<HTMLElement>('[data-field="first-prompt"]');

  it('LAUNCH-7.2: Start shows your first prompt at once (LAUNCH-7.1), as a message you sent, in the Session view’s layout: the Lens in the header, the composer disabled, the status line empty; another tab shows it too', async () => {
    const slow = slowLaunches();
    const app = renderApp('/s/a', { launch: slow.launch });
    app.snapshot([row({ id: 'a' })]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'New Session' }));
    await screen.findByRole('dialog');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Start/ })).toBeEnabled());
    await user.type(screen.getByLabelText('Prompt'), 'Fix the rounding{Enter}so totals match');
    await user.click(screen.getByRole('button', { name: /^Start/ }));
    // Before the server answers: the tab's own row carries the prompt (LAUNCH-7.1).
    expect(slow.pending[0]!.req.prompt).toBe('Fix the rounding\nso totals match');
    expect(firstPrompt()).toHaveTextContent('Fix the rounding so totals match');
    expect(firstPrompt()!.querySelector('[data-kind="user"]')).toBeNull(); // not the Transcript's copy
    expect(firstPrompt()).toHaveTextContent(/^You/);
    // The header: the orbiting Lens where the Status marker will be, then the name, the Harness and "Starting…".
    const row0 = header().firstElementChild!;
    expect(row0.firstElementChild).toHaveAttribute('data-slot', 'lookout-mark');
    expect(row0.firstElementChild).toHaveAttribute('data-orbiting', 'true');
    expect(header().querySelector('[data-field="status"]')).toHaveTextContent(/^Starting…$/);
    // The dock: the composer disabled, saying when you can type; the status line empty.
    const box = within(view()).getByRole('textbox', { name: 'Message' });
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute('placeholder', "You can type once it's ready");
    expect(within(view()).getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(view().querySelector('[data-field="status-line"]')).toHaveTextContent(/^$/);
    for (const cell of view().children) expect(cell.getAttribute('data-shell-row')).toMatch(/^(header|body|dock)$/);

    // Another tab, or a reload, gets it with the start.
    const other = renderApp('/l/l-9');
    other.snapshot([]);
    other.emit({ type: 'launches', launches: [launchView({ id: 'l-9', prompt: 'Line one\nLine two' })], started: [] });
    expect(screen.getAllByTestId('starting-view').at(-1)!.querySelector('[data-field="first-prompt"]')).toHaveTextContent('Line one Line two');
  });

  it('LAUNCH-7.3, DS-6.7: under your prompt a Loading counts from Start; from 10 s it says a start fails at 15 s; three skeleton bars follow; its words are announced once, through the start’s one region', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW });
    const app = renderApp('/l/l-1');
    app.snapshot([]);
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-1', startedAt: NOW - 2_000, prompt: 'Fix the rounding' })], started: [] });
    const arriving = view().querySelector<HTMLElement>('[data-field="arriving"]')!;
    expect(firstPrompt()!.compareDocumentPosition(arriving) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const loading = arriving.querySelector<HTMLElement>('[data-slot="loading"]')!;
    expect(loading.querySelector('[data-slot="lookout-mark"]')).toHaveAttribute('data-orbiting', 'true');
    expect(loading.querySelector('[data-field="elapsed"]')).toBeNull();
    act(() => vi.advanceTimersByTime(2_000));
    expect(loading.querySelector('[data-field="elapsed"]')).toHaveTextContent('· 4s');
    act(() => vi.advanceTimersByTime(5_000));
    expect(loading.querySelector('[data-field="hint"]')).toBeNull();
    act(() => vi.advanceTimersByTime(1_000)); // 10 s after Start
    expect(loading.querySelector('[data-field="hint"]')).toHaveTextContent('Taking longer than usual. At 15 s, its terminal shows here.');
    const bars = [...arriving.querySelectorAll('.bg-muted')];
    expect(bars).toHaveLength(3);
    for (const bar of bars) expect(bar).toHaveClass('motion-safe:animate-pulse');
    // One region says it; the Loading's words aren't a second one.
    const regions = within(view()).getAllByRole('status');
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveTextContent(/^Claude Code is starting in work…$/);
    expect(loading.querySelector('[aria-live]')).toBeNull();
  });

  it('LAUNCH-7.3: a resume says "resuming", and shows the header and its Loading only', () => {
    const app = renderApp('/l/l-r');
    app.snapshot([]);
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-r', title: 'kg-hook-review', harness: 'codex', resume: true, directory: '/Users/me/Projects/work' })], started: [] });
    expect(firstPrompt()).toBeNull();
    expect(view().querySelector('[data-field="arriving"] [data-slot="loading"]')).toHaveTextContent('Codex is resuming in work…');
  });

  it('LAUNCH-7.4: when the Session takes over, your first prompt stays where it was, as a sent message, with "Working…" counted from Start in place of the chat’s skeleton, until the Transcript’s copy takes its place', async () => {
    const app = renderApp('/l/l-1');
    app.snapshot([row({ id: 'other' })]);
    const startedAt = Date.now() - 6_000;
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-1', title: 'fix-rates', startedAt, prompt: 'Fix the rounding' })], started: [] });
    expect(firstPrompt()).toHaveTextContent('Fix the rounding');
    const column = firstPrompt()!.parentElement!.className;

    report(app, 'l-1', row({ id: 's-new', title: 'fix-rates', status: 'idle', statusSince: startedAt + 1_000, ownHost: true }));
    await waitFor(() => expect(window.location.pathname).toBe('/s/s-new'));
    const chat = screen.getByTestId('chat');
    const echo = chat.querySelector<HTMLElement>('[data-echo="waiting"]')!;
    expect(echo).toHaveTextContent('Fix the rounding');
    expect(chat.querySelector('ol[aria-label="Messages"] > li:first-child')).toBe(echo); // where it was: the column's first message
    expect(chat.querySelector('ol[aria-label="Messages"]')!.className).toBe(column); // in the same column
    expect(within(chat).queryByLabelText('Loading the chat')).toBeNull(); // no skeleton
    const activity = screen.getByTestId('chat-activity');
    expect(activity).toHaveAttribute('data-activity', 'working');
    expect(Number(activity.querySelector('[data-field="elapsed"]')!.textContent!.replace('s', ''))).toBeGreaterThanOrEqual(6); // from Start
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled();

    // The chat loads with the Transcript's copy: it takes the echo's place.
    const copy = { kind: 'user' as const, cursor: 'c1', ts: new Date(startedAt + 2_000).toISOString(), text: 'Fix the rounding', queued: false };
    app.emit({ type: 'chat', sessionId: 's-new', op: 'reset', entries: [copy], before: null, queue: [] });
    await waitFor(() => expect(chat.querySelector('[data-echo]')).toBeNull());
    expect(chat.querySelector('[data-kind="user"]')).toHaveTextContent('Fix the rounding');

    // Selected again later, it's the chat's own: nothing handed over twice.
    await userEvent.setup().click(screen.getByText('other', { selector: '[data-field="title"]' }));
    await userEvent.setup().click(screen.getByText('fix-rates', { selector: '[data-field="title"]' }));
    expect(screen.getByTestId('chat').querySelector('[data-echo]')).toBeNull();
  });

  it('LAUNCH-7.4: a start without a prompt (a resume) hands nothing over: the chat’s skeleton, as for any Session', async () => {
    const app = renderApp('/l/l-r');
    app.snapshot([row({ id: 'other' })]);
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-r', resume: true })], started: [] });
    report(app, 'l-r', row({ id: 's-r', title: 'resumed' }));
    await waitFor(() => expect(window.location.pathname).toBe('/s/s-r'));
    expect(within(screen.getByTestId('chat')).getByLabelText('Loading the chat')).toBeInTheDocument();
    expect(screen.getByTestId('chat').querySelector('[data-echo]')).toBeNull();
  });

  it('LAUNCH-7.4: if the chat can’t be read before it loads, it says so, and "Working…" follows the Session’s Status again', async () => {
    const app = renderApp('/l/l-1');
    app.snapshot([row({ id: 'other' })]);
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-1', startedAt: Date.now() - 3_000, prompt: 'Fix the rounding' })], started: [] });
    report(app, 'l-1', row({ id: 's-new', title: 'fix-rates', status: 'idle' }));
    await waitFor(() => expect(window.location.pathname).toBe('/s/s-new'));
    expect(screen.getByTestId('chat-activity')).toHaveAttribute('data-activity', 'working');
    app.emit({ type: 'chat', sessionId: 's-new', op: 'problem', problem: { kind: 'missing', message: 'no transcript found for session s-new' } });
    expect(await screen.findByText('No Transcript found')).toBeInTheDocument();
    expect(screen.getByTestId('chat').querySelector('[data-echo]')).toBeNull();
    expect(screen.getByTestId('chat-activity')).not.toHaveAttribute('data-activity'); // Idle: nothing
  });

  it('LAUNCH-7.4: the hand-over is for the view it took over; after another start, its Session shows its own chat', async () => {
    const app = renderApp('/l/l-1');
    app.snapshot([row({ id: 'other' })]);
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-1', prompt: 'Fix the rounding' }), launchView({ id: 'l-2', title: 'second', prompt: 'Next thing' })], started: [] });
    app.emit({ type: 'sessions', upsert: [row({ id: 's-new', title: 'fix-rates' })], remove: [] });
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-2', title: 'second', prompt: 'Next thing' })], started: [{ launchId: 'l-1', sessionId: 's-new' }] });
    await waitFor(() => expect(window.location.pathname).toBe('/s/s-new'));
    expect(screen.getByTestId('chat').querySelector('[data-echo]')).toHaveTextContent('Fix the rounding');
    const user = userEvent.setup();
    await user.click(startingRow('second'));
    expect(window.location.pathname).toBe('/l/l-2');
    await user.click(screen.getByText('fix-rates', { selector: '[data-field="title"]' }));
    expect(screen.getByTestId('chat').querySelector('[data-echo]')).toBeNull();
    expect(within(screen.getByTestId('chat')).getByLabelText('Loading the chat')).toBeInTheDocument();
  });

  it('LAUNCH-7.3, LAUNCH-4.5: after a Trust prompt the hint counts 10 s from the answer, as the 15 s run again from it', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW });
    const app = renderApp('/l/l-1');
    app.snapshot([]);
    const trust = { id: 't1', lines: null, answerable: true, detail: null, answering: null, message: null };
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-1', startedAt: NOW, prompt: 'Fix it' })], started: [] });
    act(() => vi.advanceTimersByTime(5_000)); // the Trust prompt shows 5 s after Start
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-1', startedAt: NOW, state: 'trust', trust, prompt: 'Fix it' })], started: [] });
    act(() => vi.advanceTimersByTime(30_000)); // answered 35 s after Start
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-1', startedAt: NOW, prompt: 'Fix it' })], started: [] });
    const loading = () => view().querySelector<HTMLElement>('[data-field="arriving"] [data-slot="loading"]')!;
    expect(loading().querySelector('[data-field="elapsed"]')).toHaveTextContent('· 35s'); // counted from Start
    act(() => vi.advanceTimersByTime(9_000)); // 44 s: not 10 s plus the 30 s wait, but 10 s from the answer
    expect(loading().querySelector('[data-field="hint"]')).toBeNull();
    act(() => vi.advanceTimersByTime(1_000));
    expect(loading().querySelector('[data-field="hint"]')).not.toBeNull();
  });

  it('LAUNCH-7.5: a Trust prompt’s card and a failure take the Loading’s place under your prompt; the header’s Lens becomes Needs you’s marker or the red CircleX; a failure says where and when above its error', () => {
    const app = renderApp('/l/l-1');
    app.snapshot([]);
    const trust = { id: 't1', lines: ['Accessing workspace:', '/Users/me/Projects/work'], answerable: true, detail: null, answering: null, message: null };
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-1', state: 'trust', trust, prompt: 'Fix the rounding' })], started: [] });
    const card = within(view()).getByRole('region', { name: 'Claude Code asks whether you trust this folder' });
    expect(firstPrompt()!.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view().querySelector('[data-field="arriving"]')).toBeNull();
    expect(header().querySelector('[data-slot="lookout-mark"]')).toBeNull();
    expect(within(header()).getByRole('img', { name: 'Needs you' })).toBeInTheDocument();
    expect(within(view()).getByRole('button', { name: 'Send' })).toHaveAttribute('data-variant', 'secondary'); // Trust folder is the one primary

    app.emit({ type: 'launches', launches: [launchView({ id: 'l-1', state: 'failed', error: "Fleet hasn't reported it after 15 s.", terminal: ['❯ 1. Yes'], prompt: 'Fix the rounding', startedAt: Date.now() - 18_000 })], started: [] });
    const failure = view().querySelector<HTMLElement>('[data-field="failure"]')!;
    expect(firstPrompt()!.compareDocumentPosition(failure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(failure.firstElementChild).toHaveTextContent(/^Started in ~\/Projects\/work 1[78]s ago$/); // on the app's one-second clock
    expect(within(failure).getByRole('alert')).toHaveTextContent("Fleet hasn't reported it after 15 s.");
    expect(header().querySelector('.text-destructive')).not.toBeNull();
    expect(header().querySelector('[data-slot="lookout-mark"]')).toBeNull();
    expect(within(view()).queryByRole('textbox', { name: 'Message' })).toBeNull(); // nothing to type to: its content runs to the bottom
  });

  it('LAUNCH-7.6: a Starting row shows the orbiting Lens where a Session’s marker sits; a failed or Trust row keeps its marker', () => {
    const app = renderApp('/');
    app.snapshot([row({ id: 'a' })]);
    const trust = { id: 't1', lines: null, answerable: true, detail: null, answering: null, message: null };
    app.emit({
      type: 'launches',
      launches: [launchView({ id: 'l-1', title: 'starting' }), launchView({ id: 'l-2', title: 'stuck', state: 'failed', error: 'x' }), launchView({ id: 'l-3', title: 'asks', state: 'trust', trust })],
      started: [],
    });
    const lens = (title: string) => startingRow(title).querySelector('[data-slot="lookout-mark"]');
    expect(within(startingRow('starting')).getByRole('img', { name: 'Starting' })).toContainElement(lens('starting') as HTMLElement);
    expect(lens('starting')).toHaveAttribute('data-orbiting', 'true');
    expect(lens('stuck')).toBeNull();
    expect(within(startingRow('stuck')).getByLabelText("Didn't start")).toBeInTheDocument();
    expect(lens('asks')).toBeNull();
    expect(within(startingRow('asks')).getByRole('img', { name: 'Needs you' })).toBeInTheDocument();
  });
});
