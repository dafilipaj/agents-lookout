import type { HistoryItem, LaunchRequest, LaunchView, ResumeResult } from '@shared/types.ts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { NOW, launchView, renderApp, row } from '@/test/helpers';

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
    await user.click(await screen.findByText('kg-hook-review', { selector: '[data-field="title"]' }));
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
    await user.click(await screen.findByText('kg-hook-review', { selector: '[data-field="title"]' }));
    await waitFor(() => expect(window.location.pathname).toBe('/l/l-old'));
    expect(within(startingList()).getAllByRole('listitem')).toHaveLength(1);

    await user.click(screen.getByText('kg-hook-review', { selector: '[data-field="title"]' }));
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
    await user.click(await screen.findByText('kg-hook-review', { selector: '[data-field="title"]' }));
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
      const facts = view().querySelector('dl')!;
      expect(facts).not.toHaveTextContent('Harness'); // the header says it
      expect(facts).toHaveTextContent('Directory~/Projects/work');
      expect(facts).toHaveTextContent(/Started\ds ago/);
      expect(within(view()).getByRole('status')).toHaveTextContent('Waiting for Fleet to report the Session…');

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
    expect(within(view()).queryByText('Waiting for Fleet to report the Session…')).toBeNull();
    expect(view().querySelector('dl')).toHaveTextContent('Directory~/Projects/work');
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
