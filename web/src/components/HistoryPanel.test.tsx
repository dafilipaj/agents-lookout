import type { HistoryDetail, HistoryItem, HistoryPage, LaunchView } from '@shared/types.ts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryQuery } from '@/lib/client';
import { AUTO_FILL_PAGES } from '@/components/HistoryPanel';
import { NOW, launchView, renderApp, row } from '@/test/helpers';

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
    expect(live!.querySelector('[data-field="marker"] svg')).toHaveClass('lucide-circle-dot');
    expect(codex).toHaveAttribute('data-state', 'resumable');
    expect(codex!.querySelector('[data-field="marker"] svg')).toHaveClass('lucide-circle');
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

  it('HIST-2.7: ↑/↓ and j/k move through the results without resuming; Enter acts like a click', async () => {
    const resume = vi.fn(async () => ({ kind: 'started' as const, launch: launchView({ id: 'l-9' }) }));
    const app = renderApp('/s/alpha', { history: async () => ok([LIVE, CODEX, GONE]), resume });
    app.snapshot([row({ id: 'alpha' }), row({ id: 'beta' })]);
    const user = await openHistory(app);
    await waitFor(() => expect(options()).toHaveLength(3));
    const selected = () => options().findIndex((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected()).toBe(0);
    await user.keyboard('{ArrowDown}'); // from the search box
    expect(selected()).toBe(1);
    within(panel()).getByRole('listbox').focus();
    await user.keyboard('j');
    expect(selected()).toBe(2);
    await user.keyboard('kk{ArrowUp}');
    expect(selected()).toBe(0);
    await user.keyboard('j');
    expect(resume).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/s/alpha'); // the Session sidebar didn't move either
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

  it('tb-session missing: says how to install it, like SIDE-6.1', async () => {
    const app = renderApp('/', { history: async () => ({ state: 'not-installed', installCommand: 'install tb-session' }) });
    app.snapshot([]);
    await openHistory(app);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("tb-session isn't installed");
    expect(alert).toHaveTextContent('install tb-session');
  });
});

describe('clicking a past Session (HIST-3)', () => {
  it('HIST-3.1: a resumable one is resumed: "Starting…" in the Session sidebar, selected at once, then the live Session takes over', async () => {
    const resume = vi.fn(async () => ({ kind: 'started' as const, launch: launchView({ id: 'l-7', title: 'kg-hook-review', harness: 'codex' }) }));
    const app = renderApp('/', { history: async () => ok([CODEX]), resume });
    app.snapshot([]);
    const user = await openHistory(app);
    await user.click(await screen.findByText('kg-hook-review', { selector: '[data-field="title"]' }));
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

  it('HIST-3.2: a live one is selected, never resumed; so is one Fleet says went live meanwhile', async () => {
    const resume = vi.fn(async () => ({ kind: 'live' as const, sessionId: 'codex-1' }));
    const app = renderApp('/', { history: async () => ok([LIVE, CODEX]), resume });
    app.snapshot([row({ id: 'live-1' })]);
    const user = await openHistory(app);
    await user.click(await screen.findByText('fix-deal-rates', { selector: '[data-field="title"]' }));
    expect(window.location.pathname).toBe('/s/live-1');
    expect(resume).not.toHaveBeenCalled();
    await user.click(screen.getByText('kg-hook-review', { selector: '[data-field="title"]' }));
    await waitFor(() => expect(window.location.pathname).toBe('/s/codex-1'));
  });

  it('HIST-3.3: one whose start directory is gone opens read-only: its latest messages and why', async () => {
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
    await user.click(await screen.findByText('kg-hook-review', { selector: '[data-field="title"]' }));
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

  it('a resume that fails says why in the History sidebar', async () => {
    const resume = vi.fn(async () => {
      throw new Error("Couldn't start the Session: Fleet refused");
    });
    const app = renderApp('/', { history: async () => ok([CODEX]), resume });
    app.snapshot([]);
    const user = await openHistory(app);
    await user.click(await screen.findByText('kg-hook-review', { selector: '[data-field="title"]' }));
    expect(await within(panel()).findByRole('alert')).toHaveTextContent("Couldn't start the Session: Fleet refused");
    await act(async () => {});
  });
});
