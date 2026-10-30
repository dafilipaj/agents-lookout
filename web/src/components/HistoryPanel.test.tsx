import type { HistoryDetail, HistoryItem, HistoryPage, HistoryPeek, LaunchView } from '@shared/types.ts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryQuery } from '@/lib/client';
import { AUTO_FILL_PAGES } from '@/components/HistoryPanel';
import { NOW, launchView, pressResult, pressRowAction, renderApp, row } from '@/test/helpers';

/** Synthetic past Sessions only. */
const item = (over: Partial<HistoryItem> & { sessionId: string }): HistoryItem => ({
  harness: 'claude',
  headless: false,
  title: over.sessionId,
  projectPath: '/Users/me/Projects/work',
  repo: 'work',
  branch: 'main',
  lastActiveAt: NOW - 2 * 3_600_000,
  snippet: null,
  firstPrompt: null,
  projectDisplay: '~/Projects/work',
  blocked: null,
  ...over,
});

const LIVE = item({ sessionId: 'live-1', title: 'fix-deal-rates' });
const CODEX = item({ sessionId: 'codex-1', harness: 'codex', title: 'kg-hook-review', lastActiveAt: NOW - 3 * 86_400_000, branch: 'feature/kg-hook' });
const GONE = item({ sessionId: 'gone-1', title: 'pr641-review', blocked: 'folder-gone', projectPath: '/Users/me/wt/pr641' });

const ok = (items: HistoryItem[], over: Partial<Extract<HistoryPage, { state: 'ok' }>> = {}): HistoryPage => ({ state: 'ok', items, page: 1, hasMore: false, ...over });

const panel = () => screen.getByTestId('history-panel');
const options = () => within(panel()).queryAllByRole('option');
const titles = () => options().map((o) => o.querySelector('[data-field="title"]')!.textContent);

async function openHistory(app: ReturnType<typeof renderApp>, user = userEvent.setup()) {
  await user.click(screen.getByRole('button', { name: 'History' }));
  await waitFor(() => expect(app.client.history).toHaveBeenCalled());
  return user;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

describe('a failed search (DS-4.2)', () => {
  it('DS-4.2: a search that fails is an error Alert (a box, with its reason), not a neutral empty state', async () => {
    const app = renderApp('/', {
      history: async () => {
        throw new Error('tb-session timed out after 20 s.');
      },
    });
    app.snapshot([]);
    await openHistory(app);
    const alert = await within(panel()).findByRole('alert');
    expect(alert).toHaveAttribute('data-layout', 'box');
    expect(alert).toHaveTextContent("Couldn't search History");
    expect(alert).toHaveTextContent('tb-session timed out after 20 s.');
    expect(within(panel()).queryByText('No past Sessions')).toBeNull();
    expect(panel().querySelector('[data-slot="empty-state"]')).toBeNull();
  });
});

describe('the right sidebar (HIST-1)', () => {
  it('HIST-1.1: a button at the top right or H opens it, focused on the search box; H outside a text field closes it', async () => {
    const app = renderApp('/', { history: async () => ok([]) });
    app.snapshot([]);
    await openHistory(app);
    expect(screen.getByRole('searchbox', { name: 'Search past Sessions' })).toHaveFocus();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search past Sessions' }), 'h');
    expect(screen.getByTestId('history-panel')).toBeInTheDocument(); // typing h in the search box is just text
    await userEvent.click(screen.getByRole('button', { name: 'Close History' }));
    expect(screen.queryByTestId('history-panel')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'h' });
    expect(screen.getByTestId('history-panel')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search past Sessions' })).toHaveFocus());
  });

  it('HIST-1.2: the Session sidebar and the main pane stay there while it’s open', async () => {
    const app = renderApp('/s/alpha', { history: async () => ok([]) });
    app.snapshot([row({ id: 'alpha', title: 'alpha' })]);
    await openHistory(app);
    expect(screen.getByRole('complementary', { name: 'Session sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('alpha');
  });

  it('HIST-1.3: whether it’s open, and its width, are remembered across reloads', async () => {
    const app = renderApp('/', { history: async () => ok([]) });
    app.snapshot([]);
    await openHistory(app);
    const sidebar = () => screen.getByTestId('right-sidebar');
    const handle = screen.getByRole('separator', { name: 'Resize the right sidebar' });
    fireEvent.mouseDown(handle, { clientX: 1000 });
    fireEvent.mouseMove(window, { clientX: 900 });
    fireEvent.mouseUp(window, { clientX: 900 });
    expect(sidebar()).toHaveStyle({ width: '460px' });
    app.unmount();

    const reloaded = renderApp('/', { history: async () => ok([]) });
    reloaded.snapshot([]);
    expect(sidebar()).toHaveStyle({ width: '460px' });
    await userEvent.click(screen.getByRole('button', { name: 'Close History' }));
    reloaded.unmount();
    renderApp('/');
    expect(screen.queryByTestId('history-panel')).toBeNull();
  });
});

describe('finding past Sessions (HIST-2)', () => {
  it('HIST-2.1: with an empty query, the newest first, and more as you scroll', async () => {
    const history = vi.fn(async (q: HistoryQuery) =>
      q.page === 1 ? ok([LIVE, CODEX], { hasMore: true }) : ok([GONE], { page: 2, hasMore: false }),
    );
    const app = renderApp('/', { history });
    app.snapshot([]);
    await openHistory(app);
    await waitFor(() => expect(titles()).toEqual(['fix-deal-rates', 'kg-hook-review']));
    expect(history).toHaveBeenLastCalledWith({ query: '', page: 1, headless: false, harness: null });
    fireEvent.scroll(document.getElementById('history-results')!);
    await waitFor(() => expect(titles()).toEqual(['fix-deal-rates', 'kg-hook-review', 'pr641-review']));
    expect(history).toHaveBeenLastCalledWith({ query: '', page: 2, headless: false, harness: null });
    fireEvent.scroll(document.getElementById('history-results')!);
    expect(history).toHaveBeenCalledTimes(2); // no more pages
  });

  it('HIST-2.2: typing searches, and the results show within 1 s, in the order given (best match first)', async () => {
    const history = vi.fn(async (q: HistoryQuery) => (q.query ? ok([CODEX, GONE]) : ok([LIVE])));
    const app = renderApp('/', { history });
    app.snapshot([]);
    const user = await openHistory(app);
    await waitFor(() => expect(titles()).toEqual(['fix-deal-rates']));
    const typed = performance.now();
    await user.type(screen.getByRole('searchbox', { name: 'Search past Sessions' }), 'hook fires');
    await waitFor(() => expect(titles()).toEqual(['kg-hook-review', 'pr641-review']), { timeout: 1000 });
    expect(performance.now() - typed).toBeLessThan(1000 + 400); // typing itself takes a few ms per key
    // One search for the whole query, not one per keystroke.
    expect(history.mock.calls.filter(([q]) => q.query)).toEqual([[{ query: 'hook fires', page: 1, headless: false, harness: null }]]);
  });

  it('HIST-2.3: each result shows title, Harness, repo, branch, last activity and the snippet; a live one is marked', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW }); // ages count from the fixtures' NOW, not today
    const app = renderApp('/', { history: async () => ok([LIVE, { ...CODEX, snippet: '…but «the hook fires» twice…' }, GONE]) });
    app.snapshot([row({ id: 'live-1', harness: 'claude' })]);
    await openHistory(app);
    await waitFor(() => expect(options()).toHaveLength(3));
    const [live, codex, gone] = options();
    expect(live).toHaveAttribute('data-state', 'live');
    expect(within(live!).getByText('live')).toBeInTheDocument();
    // DS-5.2: a live result shows its Session's Status marker; a resumable one the past marker.
    expect(live!.querySelector('[data-field="marker"]')).toHaveAttribute('data-state', 'live');
    expect(live!.querySelector('[data-field="marker"]')).toHaveAttribute('data-status', 'idle');
    expect(codex).toHaveAttribute('data-state', 'resumable');
    expect(codex!.querySelector('[data-field="marker"] svg')).toHaveClass('lucide-history');
    expect(codex!.querySelector('[data-field="harness"]')).toHaveTextContent('Codex');
    expect(codex!.querySelector('[data-field="repo"]')).toHaveTextContent('work');
    expect(codex!.querySelector('[data-field="branch"]')).toHaveTextContent('feature/kg-hook');
    expect(codex!.querySelector('[data-field="age"]')).toHaveTextContent('3d');
    expect(codex!.querySelector('mark')).toHaveTextContent('the hook fires');
    expect(gone).toHaveAttribute('data-state', 'blocked');
    expect(gone!.querySelector('[data-field="marker"] svg')).toHaveClass('lucide-circle-slash');
    expect(within(gone!).getByText('folder gone')).toBeInTheDocument();
  });

  it('HIST-2.3: a past Session is live only while Fleet lists it under the same Harness', async () => {
    const app = renderApp('/', { history: async () => ok([LIVE]) });
    app.snapshot([row({ id: 'live-1', harness: 'codex' })]);
    await openHistory(app);
    await waitFor(() => expect(options()[0]).toHaveAttribute('data-state', 'resumable'));
    app.emit({ type: 'sessions', upsert: [row({ id: 'live-1', harness: 'claude' })], remove: [] });
    expect(options()[0]).toHaveAttribute('data-state', 'live');
  });

  it('HIST-2.4: Claude Code and Codex Sessions both appear', async () => {
    const app = renderApp('/', { history: async () => ok([LIVE, CODEX]) });
    app.snapshot([]);
    await openHistory(app);
    await waitFor(() => expect(options().map((o) => o.querySelector('[data-field="harness"]')!.textContent)).toEqual(['Claude Code', 'Codex']));
  });

  it('HIST-2.5: Headless Sessions are hidden by default; the toggle shows them', async () => {
    const history = vi.fn(async (q: HistoryQuery) => ok(q.headless ? [LIVE, item({ sessionId: 'eval-1', title: 'eval run', headless: true })] : [LIVE]));
    const app = renderApp('/', { history });
    app.snapshot([]);
    const user = await openHistory(app);
    await waitFor(() => expect(titles()).toEqual(['fix-deal-rates']));
    await user.click(screen.getByRole('checkbox', { name: 'Show Headless Sessions' }));
    await waitFor(() => expect(titles()).toEqual(['fix-deal-rates', 'eval run']));
    expect(history).toHaveBeenLastCalledWith({ query: '', page: 1, headless: true, harness: null });
  });

  it('HIST-2.8: Claude Code and Codex buttons with their logos, next to the headless toggle; both by default, never neither, remembered across reloads', async () => {
    const history = vi.fn(async (q: HistoryQuery) => ok(q.harness === 'codex' ? [CODEX] : q.harness === 'claude' ? [LIVE] : [LIVE, CODEX]));
    const app = renderApp('/', { history });
    app.snapshot([]);
    const user = await openHistory(app);
    const group = screen.getByRole('group', { name: 'Harnesses' });
    // Next to the headless toggle, each with its Harness's logo.
    expect(group.parentElement).toContainElement(screen.getByRole('checkbox', { name: 'Show Headless Sessions' }));
    const claude = within(group).getByRole('button', { name: 'Claude Code' });
    const codex = within(group).getByRole('button', { name: 'Codex' });
    expect(claude.querySelector('svg[data-harness="claude"]')).not.toBeNull();
    expect(codex.querySelector('svg[data-harness="codex"]')).not.toBeNull();
    expect(claude).toHaveAttribute('aria-pressed', 'true');
    expect(codex).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(titles()).toEqual(['fix-deal-rates', 'kg-hook-review']));
    expect(history).toHaveBeenLastCalledWith({ query: '', page: 1, headless: false, harness: null });

    await user.click(claude);
    expect(claude).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(titles()).toEqual(['kg-hook-review']));
    expect(history).toHaveBeenLastCalledWith({ query: '', page: 1, headless: false, harness: 'codex' });
    // Codex is the only one on: it can't be switched off.
    expect(codex).toHaveAttribute('aria-disabled', 'true');
    await user.click(codex);
    expect(codex).toHaveAttribute('aria-pressed', 'true');
    expect(claude).toHaveAttribute('aria-pressed', 'false');

    // A reload keeps the choice.
    app.unmount();
    const again = renderApp('/', { history });
    again.snapshot([]); // History stays open across the reload too (HIST-1.3)
    expect(within(screen.getByRole('group', { name: 'Harnesses' })).getByRole('button', { name: 'Claude Code' })).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(history).toHaveBeenLastCalledWith({ query: '', page: 1, headless: false, harness: 'codex' }));
  });

  it('HIST-2.7: ↑/↓ and j/k move through the results without resuming, opening or selecting any Session, and collapse the expanded result as they leave it; Enter expands, then runs its button', async () => {
    const resume = vi.fn(async () => ({ kind: 'started' as const, launch: launchView({ id: 'l-9' }) }));
    const app = renderApp('/s/alpha', { history: async () => ok([LIVE, CODEX, GONE]), resume });
    app.snapshot([row({ id: 'alpha' }), row({ id: 'beta' })]);
    const user = await openHistory(app);
    await waitFor(() => expect(options()).toHaveLength(3));
    const selected = () => options().findIndex((o) => o.getAttribute('aria-selected') === 'true');
    const expanded = () => options().findIndex((o) => o.getAttribute('aria-expanded') === 'true');
    expect(selected()).toBe(0);
    await user.keyboard('{ArrowDown}'); // from the search box
    expect(selected()).toBe(1);
    within(panel()).getByRole('listbox').focus();
    await user.keyboard('j');
    expect(selected()).toBe(2);
    await user.keyboard('kk{ArrowUp}');
    expect(selected()).toBe(0);
    await user.keyboard('j');
    expect(expanded()).toBe(-1); // moving expands nothing
    // Enter on a result that isn't expanded expands it, and does nothing else.
    await user.keyboard('{Enter}');
    expect(expanded()).toBe(1);
    expect(resume).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/s/alpha'); // the Session sidebar didn't move either
    // Moving away collapses it; coming back expands nothing.
    await user.keyboard('j');
    expect(expanded()).toBe(-1);
    await user.keyboard('k');
    expect(expanded()).toBe(-1);
    // Enter, Enter: expand, then its button (Resume).
    await user.keyboard('{Enter}');
    expect(resume).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(resume).toHaveBeenCalledWith('codex', 'codex-1', expect.any(String));
  });

  it('HIST-2.7: Enter acts on a result only from the search box or the list: on Close History it closes, on the toggle it toggles', async () => {
    const resume = vi.fn(async () => ({ kind: 'started' as const, launch: launchView({ id: 'l-9' }) }));
    const app = renderApp('/', { history: async () => ok([CODEX]), resume });
    app.snapshot([]);
    const user = await openHistory(app);
    await waitFor(() => expect(options()).toHaveLength(1));
    screen.getByRole('checkbox', { name: 'Show Headless Sessions' }).focus();
    await user.keyboard('{Enter}');
    expect(resume).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Close History' }).focus();
    await user.keyboard('{Enter}');
    expect(resume).not.toHaveBeenCalled();
    expect(screen.queryByTestId('history-panel')).toBeNull();
  });

  it('HIST-2.1: a toggle mid-scroll never appends an older request’s next page; paging waits for the new first page', async () => {
    let release: ((p: HistoryPage) => void) | null = null;
    const page = (n: number, prefix: string) => item({ sessionId: `${prefix}-${n}`, title: `${prefix} page ${n}` });
    const history = vi.fn((q: HistoryQuery): Promise<HistoryPage> => {
      if (q.headless && q.page === 1) return new Promise((r) => (release = r));
      return Promise.resolve(ok([page(q.page, q.headless ? 'all' : 'tty')], { page: q.page, hasMore: true }));
    });
    const app = renderApp('/', { history });
    app.snapshot([]);
    const user = await openHistory(app);
    await waitFor(() => expect(titles()).toEqual(['tty page 1']));
    fireEvent.scroll(document.getElementById('history-results')!);
    await waitFor(() => expect(titles()).toEqual(['tty page 1', 'tty page 2']));
    await user.click(screen.getByRole('checkbox', { name: 'Show Headless Sessions' }));
    await waitFor(() => expect(release).not.toBeNull()); // the new first page is on its way, deferred
    fireEvent.scroll(document.getElementById('history-results')!);
    await act(async () => {});
    expect(history.mock.calls.map(([q]) => q).filter((q) => q.page > 2 || (q.headless && q.page > 1))).toEqual([]);
    await act(async () => release!(ok([page(1, 'all')], { hasMore: true })));
    expect(titles()).toEqual(['all page 1']);
    fireEvent.scroll(document.getElementById('history-results')!);
    await waitFor(() => expect(titles()).toEqual(['all page 1', 'all page 2']));
    expect(history).toHaveBeenLastCalledWith({ query: '', page: 2, headless: true, harness: null });
  });

  it('HIST-2.1: when the newest 50 are all filtered out (an empty page with more to come), the next pages load on their own', async () => {
    const history = vi.fn(async (q: HistoryQuery) => (q.page < 4 ? ok([], { page: q.page, hasMore: true }) : ok([CODEX], { page: q.page, hasMore: false })));
    const app = renderApp('/', { history });
    app.snapshot([]);
    await openHistory(app);
    await waitFor(() => expect(titles()).toEqual(['kg-hook-review']));
    expect(history.mock.calls.map(([q]) => q.page)).toEqual([1, 2, 3, 4]);
    expect(screen.queryByText('No past Sessions')).toBeNull();
  });

  it(`HIST-2.1: at most ${AUTO_FILL_PAGES} pages on their own, then "Load more"; a new query starts its own count`, async () => {
    const history = vi.fn(async (q: HistoryQuery) => ok(q.page === 9 ? [GONE] : [], { page: q.page, hasMore: true }));
    const app = renderApp('/', { history });
    app.snapshot([]);
    const user = await openHistory(app);
    const more = await screen.findByRole('button', { name: 'Load more' });
    const pages = () => history.mock.calls.map(([q]) => q.page);
    expect(pages()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(screen.queryByText('No past Sessions')).toBeNull();
    await user.click(more);
    // The click's page, then more on their own until one shows something.
    await waitFor(() => expect(titles()).toEqual(['pr641-review']));
    // jsdom lays nothing out: the list has no height, so it counts as filling the panel.
    expect(pages()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    // A panel taller than the one row: it doesn't fill it, so on until the cap again, then the
    // button under the list.
    const results = document.getElementById('history-results')!;
    Object.defineProperty(results, 'clientHeight', { configurable: true, value: 600 });
    fireEvent.scroll(results);
    expect(await screen.findByRole('button', { name: 'Load more' })).toBeInTheDocument();
    expect(pages()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]); // the scroll's page, then five
    // A toggle is a new request: page 1 and its own five.
    history.mockClear();
    await user.click(screen.getByRole('checkbox', { name: 'Show Headless Sessions' }));
    await waitFor(() => expect(history.mock.calls.map(([q]) => q.page)).toEqual([1, 2, 3, 4, 5, 6]));
    expect(history.mock.calls.every(([q]) => q.headless)).toBe(true);
  });

  it('empty states: no past Sessions, and nothing matching the query', async () => {
    const app = renderApp('/', { history: async () => ok([]) });
    app.snapshot([]);
    const user = await openHistory(app);
    expect(await screen.findByText('No past Sessions')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Search past Sessions' }), 'zebra');
    expect(await screen.findByText('Nothing matches “zebra”')).toBeInTheDocument();
  });

  it('TOOLS-2.5: a tb-session too old for History says so, with the version it needs and the update command, never that it isn’t installed', async () => {
    const reason = 'tb-session 0.1.0 is older than History needs (0.3.0)';
    const app = renderApp('/', { history: async () => ({ state: 'too-old', reason, installCommand: 'install tb-session' }) });
    app.snapshot([]);
    await openHistory(app);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(reason);
    expect(alert).not.toHaveTextContent("isn't installed");
    expect(alert.querySelector('[data-slot="command-block"]')).toHaveTextContent('install tb-session');
  });

  it('tb-session missing: says how to install it, like SIDE-6.1', async () => {
    const app = renderApp('/', { history: async () => ({ state: 'not-installed', installCommand: 'install tb-session' }) });
    app.snapshot([]);
    await openHistory(app);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("tb-session isn't installed");
    expect(alert).toHaveTextContent('install tb-session');
  });
});

describe('an expanded result (HIST-2.9 to HIST-2.11, HIST-3.5)', () => {
  const peekOf = (over: Partial<HistoryPeek> = {}): HistoryPeek => ({ firstPrompt: 'Why does the hook skip the merge commit?', last: { role: 'assistant', text: 'The hook only runs on\nthe first parent.' }, tailed: true, ...over });
  const details = (o: HTMLElement) => o.querySelector<HTMLElement>('[data-field="details"]');

  it('HIST-3.5: a click selects and expands a result and does nothing else: no resume, open or show, and no read but its own', async () => {
    const resume = vi.fn();
    const pastSession = vi.fn();
    const app = renderApp('/s/alpha', { history: async () => ok([LIVE, CODEX, GONE]), resume, pastSession });
    app.snapshot([row({ id: 'alpha' }), row({ id: 'live-1' })]);
    const user = await openHistory(app);
    await waitFor(() => expect(options()).toHaveLength(3));
    for (const [i, title] of [[0, 'fix-deal-rates'], [1, 'kg-hook-review'], [2, 'pr641-review']] as const) {
      await user.click(screen.getByText(title, { selector: '[data-field="title"]' }));
      expect(options()[i]).toHaveAttribute('aria-selected', 'true');
      expect(options()[i]).toHaveAttribute('aria-expanded', 'true');
      // A second click on it keeps it as it is.
      await user.click(screen.getByText(title, { selector: '[data-field="title"]' }));
      expect(options()[i]).toHaveAttribute('aria-expanded', 'true');
    }
    expect(resume).not.toHaveBeenCalled();
    expect(pastSession).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/s/alpha');
    expect(screen.queryByRole('list', { name: 'Starting Sessions' })).toBeNull();
  });

  it('HIST-3.5: a double click on a result only expands it, though the expanding moves its button under the second click; the button waits 400 ms after a click expands it, then acts', async () => {
    const resume = vi.fn(async () => ({ kind: 'started' as const, launch: launchView({ id: 'l-9' }) }));
    const app = renderApp('/s/alpha', { history: async () => ok([CODEX, GONE]), resume });
    app.snapshot([row({ id: 'alpha' })]);
    await openHistory(app);
    await waitFor(() => expect(options()).toHaveLength(2));
    fireEvent.click(options()[0]!, { detail: 1 });
    const button = options()[0]!.querySelector<HTMLElement>('[data-field="actions"] [data-action]')!;
    fireEvent.click(button, { detail: 2 });
    fireEvent.click(button, { detail: 1 });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(resume).not.toHaveBeenCalled();
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(button, { detail: 1 });
    expect(resume).toHaveBeenCalledWith('codex', 'codex-1', expect.any(String));
  });

  it('HIST-2.9: it shows its start directory with ~, when it was last active and that it can be resumed, not the Harness or branch its row already shows; its first prompt and last message, three lines each, with who said the last', async () => {
    const pastPeek = vi.fn(async () => peekOf());
    const app = renderApp('/', { history: async () => ok([{ ...CODEX, firstPrompt: 'Why does the hook skip the merge commit?' }]), pastPeek });
    app.snapshot([]);
    const user = await openHistory(app);
    await user.click(await screen.findByText('kg-hook-review', { selector: '[data-field="title"]' }));
    const d = details(options()[0]!)!;
    expect(d.querySelector('[data-field="start-dir"]')!.textContent).toBe('~/Projects/work');
    const when = new Date(CODEX.lastActiveAt!).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    expect(d.querySelector('[data-field="state"]')!.textContent).toBe(`${when} · can resume`);
    expect(d.querySelector('[data-field="first-prompt"]')).toHaveTextContent('Why does the hook skip the merge commit?');
    await waitFor(() => expect(d.querySelector('[data-field="last-message"]')).toHaveTextContent('Codex'));
    expect(d.querySelector('[data-field="last-message"] p')!.textContent).toBe('The hook only runs on\nthe first parent.');
    expect(d.querySelector('[data-field="last-message"] p')).toHaveClass('line-clamp-3', 'whitespace-pre-line');
    expect(d.querySelector('[data-field="first-prompt"] p')).toHaveClass('line-clamp-3');
    // No model: tb-session gives none.
    expect(d).not.toHaveTextContent(/gpt|sonnet|opus/i);
    // A screen reader hears it as the result's description, not its name.
    expect(d).toHaveAttribute('aria-hidden');
    expect(options()[0]).toHaveAttribute('aria-describedby', d.id);
  });

  it('HIST-2.9: your own last prompt is labelled "You"; a live result says it’s live and its button is Open; one that can’t be resumed says why and its button is Show', async () => {
    const pastPeek = vi.fn(async (_h: string, id: string) => peekOf({ last: id === 'live-1' ? { role: 'user', text: 'Keep going.' } : null }));
    const app = renderApp('/', { history: async () => ok([LIVE, GONE]), pastPeek });
    app.snapshot([row({ id: 'live-1' })]);
    const user = await openHistory(app);
    await user.click(await screen.findByText('fix-deal-rates', { selector: '[data-field="title"]' }));
    const live = details(options()[0]!)!;
    expect(live.querySelector('[data-field="state"]')).toHaveTextContent(/\d · live$/);
    await waitFor(() => expect(live.querySelector('[data-field="last-message"]')).toHaveTextContent('YouKeep going.'));
    expect(live.querySelector('[data-field="actions"]')).toHaveTextContent('Open');
    await user.click(screen.getByText('pr641-review', { selector: '[data-field="title"]' }));
    const gone = details(options()[1]!)!;
    expect(gone.querySelector('[data-field="state"]')).toHaveTextContent("can't be resumed");
    expect(gone.querySelector('[data-field="blocked"]')).toHaveTextContent('The directory it started in no longer exists.');
    expect(gone.querySelector('[data-field="actions"]')).toHaveTextContent('Show');
  });

  it('HIST-2.10: the first prompt and last message are read when a result is expanded, once per Session, with "Loading…" meanwhile; a new search clears them', async () => {
    let answer: (p: HistoryPeek) => void = () => {};
    const pastPeek = vi.fn(() => new Promise<HistoryPeek>((r) => (answer = r)));
    const history = vi.fn(async () => ok([LIVE, CODEX]));
    const app = renderApp('/', { history, pastPeek });
    app.snapshot([]);
    const user = await openHistory(app);
    await waitFor(() => expect(options()).toHaveLength(2));
    // Listing reads nothing per result.
    expect(pastPeek).not.toHaveBeenCalled();
    await user.click(screen.getByText('kg-hook-review', { selector: '[data-field="title"]' }));
    expect(pastPeek).toHaveBeenCalledTimes(1);
    expect(pastPeek).toHaveBeenCalledWith('codex', 'codex-1');
    expect(details(options()[1]!)).toHaveTextContent('Loading…');
    await act(async () => answer(peekOf()));
    expect(details(options()[1]!)).not.toHaveTextContent('Loading…');
    expect(details(options()[1]!)!.querySelector('[data-field="last-message"]')).toHaveTextContent('The hook only runs on');
    // Another, then back: the first one's read is kept.
    await user.click(screen.getByText('fix-deal-rates', { selector: '[data-field="title"]' }));
    expect(pastPeek).toHaveBeenCalledTimes(2);
    await act(async () => answer(peekOf()));
    await user.click(screen.getByText('kg-hook-review', { selector: '[data-field="title"]' }));
    expect(pastPeek).toHaveBeenCalledTimes(2);
    expect(details(options()[1]!)!.querySelector('[data-field="last-message"]')).toBeInTheDocument();
    // A new search clears them.
    await user.type(screen.getByRole('searchbox', { name: 'Search past Sessions' }), 'hook');
    await waitFor(() => expect(history).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(options().every((o) => o.getAttribute('aria-expanded') === 'false')).toBe(true));
    await user.click(screen.getByText('kg-hook-review', { selector: '[data-field="title"]' }));
    expect(pastPeek).toHaveBeenCalledTimes(3);
  });

  it('HIST-2.10: a failed read shows an error line and the button still works; with tb-session 0.2 the last message is left out and the first prompt still shows', async () => {
    const resume = vi.fn(async () => ({ kind: 'started' as const, launch: launchView({ id: 'l-3' }) }));
    const pastPeek = vi.fn(async (_h: string, id: string): Promise<HistoryPeek> => {
      if (id === 'codex-1') throw new Error('tb-session took too long to answer.');
      return { firstPrompt: 'Review PR 641.', last: null, tailed: false };
    });
    const app = renderApp('/', { history: async () => ok([CODEX, { ...LIVE, sessionId: 'old-1', title: 'old-one' }]), pastPeek, resume });
    app.snapshot([]);
    const user = await openHistory(app);
    await user.click(await screen.findByText('kg-hook-review', { selector: '[data-field="title"]' }));
    await waitFor(() => expect(details(options()[0]!)!.querySelector('[data-field="peek-error"]')).toHaveTextContent('tb-session took too long to answer.'));
    await pressRowAction(user, options()[0]!.querySelector<HTMLElement>('[data-field="actions"] [data-action]')!);
    expect(resume).toHaveBeenCalledWith('codex', 'codex-1', expect.any(String));
    await user.click(screen.getByText('old-one', { selector: '[data-field="title"]' }));
    const old = details(options()[1]!)!;
    await waitFor(() => expect(old.querySelector('[data-field="first-prompt"]')).toHaveTextContent('Review PR 641.'));
    expect(old.querySelector('[data-field="last-message"]')).toBeNull();
    expect(old).not.toHaveTextContent('Loading…');
  });

  it('HIST-2.11: a new query, the headless toggle or a Harness toggle collapses the expanded result, and Enter before the new search answers resumes nothing', async () => {
    const answers: ((p: HistoryPage) => void)[] = [];
    const history = vi.fn((q: HistoryQuery) => (q.query || q.headless || q.harness ? new Promise<HistoryPage>((r) => answers.push(r)) : Promise.resolve(ok([CODEX, GONE]))));
    const resume = vi.fn(async () => ({ kind: 'started' as const, launch: launchView({ id: 'l-8' }) }));
    const app = renderApp('/s/alpha', { history, resume });
    app.snapshot([row({ id: 'alpha' })]);
    const user = await openHistory(app);
    await waitFor(() => expect(options()).toHaveLength(2));
    const search = screen.getByRole('searchbox', { name: 'Search past Sessions' });
    const expandFirst = async () => {
      await user.click(search);
      await user.keyboard('{Enter}');
      expect(options()[0]).toHaveAttribute('aria-expanded', 'true');
    };
    await expandFirst();
    // Typed, and Enter at once: the old result collapsed, and Enter waits for the new search.
    await user.type(search, 'pr641{Enter}');
    expect(options()[0]).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Enter}{Enter}');
    expect(resume).not.toHaveBeenCalled();
    expect(options().every((o) => o.getAttribute('aria-expanded') === 'false')).toBe(true);
    await waitFor(() => expect(answers).toHaveLength(1));
    await act(async () => answers.at(-1)!(ok([GONE])));
    await waitFor(() => expect(titles()).toEqual(['pr641-review']));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(titles()).toEqual(['kg-hook-review', 'pr641-review']));
    for (const [n, toggle] of [() => screen.getByRole('checkbox', { name: 'Show Headless Sessions' }), () => within(screen.getByRole('group', { name: 'Harnesses' })).getByRole('button', { name: 'Codex' })].entries()) {
      await expandFirst();
      await user.click(toggle());
      expect(options()[0]).toHaveAttribute('aria-expanded', 'false');
      await user.click(search);
      await user.keyboard('{Enter}');
      expect(resume).not.toHaveBeenCalled();
      expect(options()[0]).toHaveAttribute('aria-expanded', 'false');
      await waitFor(() => expect(answers).toHaveLength(n + 2));
      await act(async () => answers.at(-1)!(ok([CODEX, GONE])));
      // Back as it was, for the next toggle.
      await user.click(toggle());
      await waitFor(() => expect(history.mock.calls.at(-1)![0]).toMatchObject({ headless: false, harness: null }));
    }
    expect(resume).not.toHaveBeenCalled();
  });

  it('HIST-2.11: one result is expanded at a time; Esc in the list or the search box collapses it and leaves it selected; the list scrolls to keep it in view, and the main pane stays', async () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    try {
      const app = renderApp('/s/alpha', { history: async () => ok([LIVE, CODEX, GONE]) });
      app.snapshot([row({ id: 'alpha' })]);
      const user = await openHistory(app);
      await waitFor(() => expect(options()).toHaveLength(3));
      const expanded = () => options().filter((o) => o.getAttribute('aria-expanded') === 'true').map((o) => o.getAttribute('data-session-id'));
      await user.click(screen.getByText('kg-hook-review', { selector: '[data-field="title"]' }));
      expect(scrolled).toContain('history-codex:codex-1');
      await user.click(screen.getByText('pr641-review', { selector: '[data-field="title"]' }));
      expect(expanded()).toEqual(['gone-1']);
      // Esc in the list.
      within(panel()).getByRole('listbox').focus();
      await user.keyboard('{Escape}');
      expect(expanded()).toEqual([]);
      expect(options()[2]).toHaveAttribute('aria-selected', 'true');
      // Esc in the search box collapses it too.
      await user.keyboard('{Enter}');
      expect(expanded()).toEqual(['gone-1']);
      const box = screen.getByRole('searchbox', { name: 'Search past Sessions' });
      box.focus();
      await user.keyboard('{Escape}');
      expect(expanded()).toEqual([]);
      expect(options()[2]).toHaveAttribute('aria-selected', 'true');
      expect(window.location.pathname).toBe('/s/alpha');
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('alpha');
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe('resuming a past Session from its result (HIST-3)', () => {
  it('HIST-3.1: "Resume" on an expanded result that can be resumed resumes it: "Starting…" in the Session sidebar, selected at once, then the live Session takes over', async () => {
    const resume = vi.fn(async () => ({ kind: 'started' as const, launch: launchView({ id: 'l-7', title: 'kg-hook-review', harness: 'codex' }) }));
    const app = renderApp('/', { history: async () => ok([CODEX]), resume });
    app.snapshot([]);
    const user = await openHistory(app);
    await user.click(await screen.findByText('kg-hook-review', { selector: '[data-field="title"]' }));
    expect(resume).not.toHaveBeenCalled();
    const button = options()[0]!.querySelector('[data-field="actions"] [data-action]')!;
    expect(button).toHaveAttribute('data-action', 'resume');
    expect(button).toHaveTextContent('Resume');
    await pressRowAction(user, button as HTMLElement);
    expect(resume).toHaveBeenCalledWith('codex', 'codex-1', expect.any(String));
    const starting: LaunchView = launchView({ id: 'l-7', title: 'kg-hook-review', harness: 'codex' });
    app.emit({ type: 'launches', launches: [starting], started: [] });
    expect(within(screen.getByRole('list', { name: 'Starting Sessions' })).getByText(/kg-hook-review/)).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/l/l-7'));
    expect(within(screen.getByTestId('starting-view')).getByRole('heading', { level: 1 })).toHaveTextContent('kg-hook-review');
    app.emit({ type: 'sessions', upsert: [row({ id: 'codex-1', harness: 'codex', title: 'kg-hook-review' })], remove: [] });
    app.emit({ type: 'launches', launches: [], started: [{ launchId: 'l-7', sessionId: 'codex-1' }] });
    await waitFor(() => expect(window.location.pathname).toBe('/s/codex-1'));
  });

  it('HIST-3.2: "Open" on an expanded live result, or Enter on it, selects it, never resumed; so is one Fleet says went live meanwhile', async () => {
    const resume = vi.fn(async () => ({ kind: 'live' as const, sessionId: 'codex-1' }));
    const app = renderApp('/', { history: async () => ok([LIVE, CODEX]), resume });
    app.snapshot([row({ id: 'live-1' })]);
    const user = await openHistory(app);
    await user.click(await screen.findByText('fix-deal-rates', { selector: '[data-field="title"]' }));
    expect(window.location.pathname).toBe('/');
    expect(options()[0]!.querySelector('[data-field="actions"] [data-action]')).toHaveTextContent('Open');
    // Enter on the expanded result runs its button.
    within(panel()).getByRole('listbox').focus();
    await user.keyboard('{Enter}');
    expect(window.location.pathname).toBe('/s/live-1');
    expect(resume).not.toHaveBeenCalled();
    await pressResult(user, 'kg-hook-review');
    await waitFor(() => expect(window.location.pathname).toBe('/s/codex-1'));
  });

  it('HIST-3.3: "Show" on an expanded result whose start directory is gone, or Enter on it, opens it read-only: its latest messages and why', async () => {
    const detail: HistoryDetail = {
      item: GONE,
      source: 'transcript',
      preview: 'latest',
      totalMessages: 2,
      entries: [
        { kind: 'user', cursor: 'h0', ts: null, text: 'Review PR 641.', queued: false },
        { kind: 'assistant', cursor: 'h1', ts: null, text: 'Two findings: a missing **null check**.', final: true },
      ],
    };
    const pastSession = vi.fn(async () => detail);
    const resume = vi.fn();
    const app = renderApp('/', { history: async () => ok([GONE]), pastSession, resume });
    app.snapshot([]);
    const user = await openHistory(app);
    await user.click(await screen.findByText('pr641-review', { selector: '[data-field="title"]' }));
    expect(window.location.pathname).toBe('/');
    expect(options()[0]!.querySelector('[data-field="actions"] [data-action]')).toHaveTextContent('Show');
    // Enter on the expanded result runs its button, as pressing Show does.
    within(panel()).getByRole('listbox').focus();
    await user.keyboard('{Enter}');
    expect(window.location.pathname).toBe('/h/claude/gone-1');
    expect(resume).not.toHaveBeenCalled();
    const view = await screen.findByTestId('past-session');
    expect(within(view).getByRole('note')).toHaveTextContent("This Session can't be resumed. The directory it started in no longer exists.");
    expect(within(view).getByText('Review PR 641.')).toBeInTheDocument();
    expect(within(view).getByText('null check').tagName).toBe('STRONG'); // VIEW's chat, Markdown and all
    expect(within(view).queryByRole('textbox')).toBeNull(); // no composer
    expect(pastSession).toHaveBeenCalledWith('claude', 'gone-1');
  });

  it('HIST-3.3: from the search index when its Transcript is gone, and it says so', async () => {
    const pastSession = vi.fn(async (): Promise<HistoryDetail> => ({ item: { ...GONE, blocked: 'transcript-missing' }, source: 'index', preview: 'latest', totalMessages: null, entries: [] }));
    renderApp('/h/claude/gone-1', { pastSession }).snapshot([]);
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('Its Transcript was deleted.');
    expect(note).toHaveTextContent("these are the latest messages tb-session indexed earlier");
  });

  it('HIST-3.3: one whose start directory went after it was listed opens read-only, not as an error', async () => {
    const resume = vi.fn(async () => ({ kind: 'blocked' as const, harness: 'codex' as const, sessionId: 'codex-1', blocked: 'folder-gone' as const }));
    const pastSession = vi.fn(async (): Promise<HistoryDetail> => ({ item: { ...CODEX, blocked: 'folder-gone' }, source: 'transcript', preview: 'latest', totalMessages: 0, entries: [] }));
    const app = renderApp('/', { history: async () => ok([CODEX]), resume, pastSession });
    app.snapshot([]);
    const user = await openHistory(app);
    await pressResult(user, 'kg-hook-review');
    await waitFor(() => expect(window.location.pathname).toBe('/h/codex/codex-1'));
    const view = await screen.findByTestId('past-session');
    expect(within(view).getByRole('note')).toHaveTextContent('The directory it started in no longer exists.');
    expect(within(panel()).queryByRole('alert')).toBeNull();
  });

  it('HIST-3.3: with tb-session 0.2, which can’t tail, the preview says it’s the first messages, not the latest', async () => {
    const pastSession = vi.fn(async (): Promise<HistoryDetail> => ({ item: GONE, source: 'transcript', preview: 'first', totalMessages: 24, entries: [] }));
    renderApp('/h/claude/gone-1', { pastSession }).snapshot([]);
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('its first messages of 24');
    expect(note).toHaveTextContent("can't show the latest");
    expect(note).not.toHaveTextContent('Its latest messages');
  });

  it('HIST-3.6 (support): while a resume runs the result stays expanded and says "Resuming…"; a failure shows under its button as an error Alert', async () => {
    let fail: (e: Error) => void = () => {};
    const resume = vi.fn(() => new Promise<never>((_, reject) => (fail = reject)));
    const app = renderApp('/', { history: async () => ok([CODEX]), resume });
    app.snapshot([]);
    const user = await openHistory(app);
    await pressResult(user, 'kg-hook-review');
    const result = options()[0]!;
    expect(result).toHaveAttribute('aria-expanded', 'true');
    expect(result.querySelector('[data-field="actions"] [data-action]')).toHaveTextContent('Resuming…');
    expect(result.querySelector('[data-field="actions"] [data-action]')).toHaveAttribute('aria-disabled', 'true');
    await act(async () => fail(new Error("Couldn't start the Session: Fleet refused")));
    const alert = await within(result).findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't start the Session: Fleet refused");
    expect(result.querySelector('[data-field="actions"]')!.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(result.querySelector('[data-field="actions"] [data-action]')).toHaveTextContent('Resume');
  });

  it('HIST-3.6 (support): the button is its word beside a 20 px icon, in the labelled size (DS-7.1)', async () => {
    const app = renderApp('/', { history: async () => ok([CODEX]) });
    app.snapshot([]);
    const user = await openHistory(app);
    await user.click(await screen.findByText('kg-hook-review', { selector: '[data-field="title"]' }));
    const button = options()[0]!.querySelector('[data-field="actions"] [data-action]')!;
    expect(button).toHaveAttribute('role', 'button');
    expect(button).toHaveAttribute('data-slot', 'row-action');
    expect(button).toHaveClass('h-7', "[&_svg:not([class*='size-'])]:size-5");
    expect(button.querySelector('svg.lucide-history')).not.toBeNull();
  });
});

describe('History colours (design system)', () => {
  it("DS-3.1: History's filter and results draw the Harness logos monochrome", async () => {
    const app = renderApp('/', { history: async () => ok([LIVE, CODEX]) });
    app.snapshot([]);
    await openHistory(app);
    await waitFor(() => expect(options()).toHaveLength(2));
    const group = screen.getByRole('group', { name: 'Harnesses' });
    const logos = [...group.querySelectorAll('svg[data-harness]'), ...panel().querySelectorAll('[role="option"] svg[data-harness]')];
    expect(logos.map((l) => l.getAttribute('data-harness'))).toEqual(['claude', 'codex', 'claude', 'codex']);
    for (const logo of logos) {
      expect(logo).toHaveAttribute('data-tone', 'mono');
      expect(logo).toHaveAttribute('fill', 'currentColor');
    }
  });

  it("DS-3.4: a search hit is marked with the highlight token, not Needs you's amber", async () => {
    const app = renderApp('/', { history: async () => ok([{ ...CODEX, snippet: '…but «the hook fires» twice…' }]) });
    app.snapshot([]);
    await openHistory(app);
    await waitFor(() => expect(options()).toHaveLength(1));
    const hit = options()[0]!.querySelector('mark')!;
    expect(hit).toHaveTextContent('the hook fires');
    expect(hit).toHaveClass('bg-highlight', 'text-foreground');
    expect([...hit.classList].filter((c) => c.includes('needs-you'))).toEqual([]);
  });
});

describe('History on the design system', () => {
  it("DS-5.2: a live result shows its Session's Status marker from the Session list and follows its Status; a resumable one the past marker, a blocked one the slashed circle; the live chip stays", async () => {
    const app = renderApp('/', { history: async () => ok([LIVE, CODEX, GONE]) });
    app.snapshot([row({ id: 'live-1', harness: 'claude', status: 'busy' })]);
    await openHistory(app);
    await waitFor(() => expect(options()).toHaveLength(3));
    const marker = (i: number) => options()[i]!.querySelector<HTMLElement>('[data-session-marker]')!;
    expect(marker(0)).toHaveAttribute('data-state', 'live');
    expect(marker(0)).toHaveAttribute('data-status', 'busy');
    expect(within(options()[0]!).getByText('live')).toHaveAttribute('data-slot', 'chip');
    app.emit({ type: 'sessions', upsert: [row({ id: 'live-1', harness: 'claude', status: 'needs-you' })], remove: [] });
    expect(marker(0)).toHaveAttribute('data-status', 'needs-you');
    expect(marker(1)).toHaveAttribute('data-state', 'past');
    expect(marker(1).querySelector('svg')).toHaveClass('lucide-history', 'text-muted-foreground');
    expect(marker(2)).toHaveAttribute('data-state', 'blocked');
    expect(marker(2).querySelector('svg')).toHaveClass('lucide-circle-slash');
  });

  it("DS-10.1: a live result's Busy marker pulses by its Session's Status start, from the Session list", async () => {
    const app = renderApp('/', { history: async () => ok([LIVE]) });
    app.snapshot([row({ id: 'live-1', harness: 'claude', status: 'busy', statusSince: Date.now() - 2_000 })]);
    await openHistory(app);
    await waitFor(() => expect(options()).toHaveLength(1));
    const dot = options()[0]!.querySelector<SVGElement>('[data-session-marker] svg')!;
    expect(dot).toHaveClass('animate-busy');
    expect(dot.style.animationDelay).toMatch(/^-2\d{3}ms$/);
    // Busy for a minute: no pulse.
    app.emit({ type: 'sessions', upsert: [row({ id: 'live-1', harness: 'claude', status: 'busy', statusSince: Date.now() - 60_000 })], remove: [] });
    expect(options()[0]!.querySelector('[data-session-marker] svg')).not.toHaveClass('animate-busy');
  });

  it("DS-3.6: a live result's marker is its Session's Status colour, no longer a stand-in grey", async () => {
    const app = renderApp('/', { history: async () => ok([LIVE]) });
    app.snapshot([row({ id: 'live-1', harness: 'claude', status: 'busy' })]);
    await openHistory(app);
    await waitFor(() => expect(options()).toHaveLength(1));
    const svg = options()[0]!.querySelector('[data-session-marker] svg')!;
    expect(svg).toHaveClass('text-busy');
    expect(svg).not.toHaveClass('text-muted-foreground');
  });

  it("DS-5.5: a result's accessible name doesn't change: the marker is hidden from screen readers, the row's words say it", async () => {
    const app = renderApp('/', { history: async () => ok([LIVE, CODEX]) });
    app.snapshot([row({ id: 'live-1', harness: 'claude', status: 'needs-you' })]);
    await openHistory(app);
    await waitFor(() => expect(options()).toHaveLength(2));
    for (const option of options()) {
      expect(option.querySelector('[data-session-marker]')).toHaveAttribute('aria-hidden', 'true');
      expect(option).not.toHaveAccessibleName(/Needs you|Past Session/);
    }
    expect(options()[0]).toHaveAccessibleName(/^fix-deal-rates\s*live/);
  });

  it('DS-6.3: results and "Loading more…" are a Loading', async () => {
    const app = renderApp('/', { history: () => new Promise<HistoryPage>(() => {}) });
    app.snapshot([]);
    await openHistory(app);
    const loading = panel().querySelector<HTMLElement>('[data-slot="loading"]')!;
    expect(within(loading).getByRole('status')).toHaveTextContent('Loading…');
  });

  it("DS-8.1, DS-8.2, DS-4.3: History's empty states are an EmptyState; tb-session missing is an error Alert with its words and a CommandBlock", async () => {
    const empty = renderApp('/', { history: async () => ok([]) });
    empty.snapshot([]);
    await openHistory(empty);
    expect((await screen.findByText('No past Sessions')).closest('[data-slot="empty-state"]')).not.toBeNull();
    empty.unmount();
    window.localStorage.clear(); // History opens from the rail again

    const app = renderApp('/', { history: async () => ({ state: 'not-installed', installCommand: 'install tb-session' }) });
    app.snapshot([]);
    await openHistory(app);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-slot', 'alert');
    expect(alert).toHaveTextContent(
      "tb-session isn't installedHistory searches past Sessions through tb-session. Install it, then reopen History:install tb-sessionNeeds an authenticated gh; it installs into ~/.local/bin.",
    );
    expect(within(alert).getByText('install tb-session')).toHaveAttribute('data-slot', 'command-block');
  });
});
