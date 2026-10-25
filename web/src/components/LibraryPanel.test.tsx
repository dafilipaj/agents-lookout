import type { LibraryPage, OutputItem, OutputSession } from '@shared/library.ts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NOW, launchView, renderApp, row } from '@/test/helpers';

const session = (over: Partial<OutputSession> = {}): OutputSession => ({ sessionId: 'writer', harness: 'claude', title: 'Report writer', projectPath: '/project', projectDisplay: '/project', repo: 'project', branch: null, headless: false, lastActiveAt: NOW, snippet: null, firstPrompt: null, blocked: null, pruned: false, event: 'write', ...over });
const output = (over: Partial<OutputItem> = {}): OutputItem => ({ kind: 'file', key: '/report.html', type: 'html', title: 'Harbor report', path: '/report.html', url: null, display: '~/report.html', projectPath: '/project', repo: 'project', createdAt: NOW - 86400000, updatedAt: NOW, events: 3, exists: true, source: null, sourcePath: null, sourceDisplay: null, version: null, sessions: [session()], ...over });
const ok = (items: OutputItem[], over = {}): LibraryPage => ({ state: 'ok', items, nextPage: 2, hasMore: false, hiddenGone: 0, unfilteredEmpty: false, projects: ['/project'], ...over });
const panel = () => screen.getByTestId('library-panel');
const rows = () => within(within(panel()).getByRole('listbox', { name: 'Outputs' })).queryAllByRole('option');
const first = () => within(within(panel()).getByRole('listbox', { name: 'Outputs' })).findByRole('option');
async function open(app: ReturnType<typeof renderApp>) { app.snapshot([]); if (!screen.queryByTestId('library-panel')) fireEvent.keyDown(document.body, { key: 'l' }); await waitFor(() => expect(app.client.library).toHaveBeenCalled()); }
beforeEach(() => { window.localStorage.clear(); vi.useFakeTimers({ toFake: ['Date'], now: NOW }); });
afterEach(() => vi.useRealTimers());

it('LIB-1.1: Library follows Work, L switches and closes it, the rail opens it and focuses its text filter, and text fields and modals keep their keys', async () => {
  const app = renderApp(); await open(app);
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['History', 'Work', 'Library']);
  const filter = screen.getByRole('searchbox', { name: 'Filter Outputs' }); expect(filter).toHaveFocus();
  fireEvent.keyDown(filter, { key: 'l' }); expect(panel()).toBeVisible();
  fireEvent.keyDown(document.body, { key: 'l' }); expect(screen.queryByTestId('library-panel')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Work' }));
  fireEvent.keyDown(document.body, { key: 'L' }); expect(panel()).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'New Session' }));
  fireEvent.keyDown(document.body, { key: 'l' }); expect(panel()).toBeVisible();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  app.unmount();
});
it('LIB-1.2: remembers Library, open state and width in lookout.right across reloads', async () => {
  window.localStorage.setItem('lookout.right', JSON.stringify({ open: true, width: 420, tab: 'library', libraryFilter: { types: ['share'], project: '/other', hideGone: false } }));
  const app = renderApp(); app.snapshot([]);
  expect(screen.getByRole('tab', { name: 'Library' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('complementary', { name: 'Right sidebar' })).toHaveStyle({ width: '420px' });
  await waitFor(() => expect(app.client.library).toHaveBeenCalledWith(expect.objectContaining({ types: ['share'], project: '/other', hideGone: false })));
});
it('LIB-2.1: groups by local day and loads the next server cursor, with at most five automatic fills before Load more', async () => {
  const library = vi.fn(async (q) => ok([], { nextPage: q.page + 5, hasMore: true }));
  const app = renderApp('/', { library }); await open(app);
  await waitFor(() => expect(within(panel()).getByRole('button', { name: 'Load more' })).toBeVisible());
  await waitFor(() => expect(library).toHaveBeenCalledTimes(6));
  expect(library.mock.calls.map(([q]) => q.page)).toEqual([1, 6, 11, 16, 21, 26]);
  app.unmount();
  const grouped = renderApp('/', { library: async () => ok([output(), output({ key: 'yesterday', updatedAt: NOW - 86400000 }), output({ key: 'older', updatedAt: NOW - 3 * 86400000 })]) }); await open(grouped);
  expect(within(panel()).getByText('Today')).toBeVisible(); expect(within(panel()).getByText('Yesterday')).toBeVisible();
});
it('LIB-2.2: rows expose title, Type, repo, age, path and live/gone chips as options of one focusable listbox with decorative icons', async () => {
  const app = renderApp('/', { library: async () => ok([output({ exists: false })]) }); await open(app); app.snapshot([row({ id: 'writer' })]);
  const list = await within(panel()).findByRole('listbox', { name: 'Outputs' }); expect(list).toHaveAttribute('tabindex', '0');
  const option = within(list).getByRole('option', { name: /Harbor report HTML project .*~\/report.html gone live/ });
  expect(option.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
});
it('LIB-2.3: chips default to Pages/PDF, toggle or Alt-isolate, keep one on, remember filters and share History’s headless value', async () => {
  const app = renderApp(); await open(app);
  expect(within(panel()).getByRole('button', { name: 'Pages' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(within(panel()).getByRole('button', { name: 'Markdown' }), { altKey: true });
  fireEvent.click(within(panel()).getByRole('button', { name: 'Markdown' }));
  fireEvent.click(within(panel()).getByRole('checkbox', { name: 'Hide gone' }));
  fireEvent.click(within(panel()).getByRole('checkbox', { name: 'Show Headless Sessions' }));
  await waitFor(() => expect(app.client.library).toHaveBeenLastCalledWith(expect.objectContaining({ types: ['markdown'], hideGone: false, headless: true })));
  fireEvent.click(screen.getByRole('tab', { name: 'History' }));
  expect(screen.getByRole('checkbox', { name: 'Show Headless Sessions' })).toBeChecked();
  const saved = JSON.parse(window.localStorage.getItem('lookout.right')!); expect(saved.libraryFilter).toMatchObject({ types: ['markdown'], hideGone: false });
  app.unmount();
  window.localStorage.setItem('lookout.right', JSON.stringify({ open: true, tab: 'library', libraryFilter: { types: [], hideGone: 'odd', project: 12 } }));
  const fallback = renderApp(); fallback.snapshot([]);
  await waitFor(() => expect(fallback.client.library).toHaveBeenCalledWith(expect.objectContaining({ types: ['pages', 'pdf'], hideGone: true, project: '' })));
});
it('LIB-2.4: debounces text search within one second, shows Loading and marks title and path hits with highlight', async () => {
  let finish: ((p: LibraryPage) => void) | undefined;
  const app = renderApp('/', { library: (q) => q.query ? new Promise((r) => { finish = r; }) : Promise.resolve(ok([output()])) }); await open(app);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Outputs' }), { target: { value: 'report' } });
  await waitFor(() => expect(app.client.library).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'report' })), { timeout: 900 });
  expect(within(panel()).getByText('Loading…')).toBeVisible();
  await act(async () => finish!(ok([output()])));
  expect(panel().querySelectorAll('mark.bg-highlight')).toHaveLength(2);
});
it('LIB-2.5: arrows and j/k move without acting and collapse, Enter expands then opens except for gone files, and tab arrows reach all three tabs', async () => {
  const browser = vi.spyOn(window, 'open').mockImplementation(() => null);
  const app = renderApp('/', { library: async () => ok([output(), output({ key: 'gone', title: 'Gone report', exists: false })]) }); await open(app);
  const list = await within(panel()).findByRole('listbox'); list.focus();
  fireEvent.keyDown(list, { key: 'Enter' }); expect(rows()[0]).toHaveAttribute('aria-expanded', 'true'); expect(browser).not.toHaveBeenCalled();
  fireEvent.keyDown(list, { key: 'j' }); expect(rows()[0]).toHaveAttribute('aria-expanded', 'false');
  fireEvent.keyDown(list, { key: 'Enter' }); fireEvent.keyDown(list, { key: 'Enter' });
  expect(rows()[1]).toHaveAttribute('aria-expanded', 'true'); expect(browser).not.toHaveBeenCalled();
  fireEvent.keyDown(list, { key: 'ArrowUp' }); fireEvent.keyDown(list, { key: 'Enter' }); fireEvent.keyDown(list, { key: 'Enter' }); expect(browser).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Library' }), { key: 'ArrowLeft' }); expect(screen.getByRole('tab', { name: 'Work' })).toHaveFocus();
  browser.mockRestore();
});
it('LIB-2.7: refreshes on open, Fleet changes and 60 visible seconds, freezing pending moves until both expansion and hover end', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW });
  const a = output(), b = output({ key: 'second', title: 'Second report' });
  let items = [a, b]; const library = vi.fn(async () => ok(items));
  const app = renderApp('/', { library }); await open(app); await waitFor(() => expect(rows()).toHaveLength(2));
  fireEvent.mouseEnter(rows()[0]!); fireEvent.click(rows()[0]!); items = [b, a];
  app.snapshot([row({ id: 'fresh' })]); await waitFor(() => expect(library.mock.calls.length).toBeGreaterThan(1));
  expect(rows()[0]).toHaveTextContent('Harbor report');
  fireEvent.keyDown(within(panel()).getByRole('listbox'), { key: 'Escape' }); expect(rows()[0]).toHaveTextContent('Harbor report');
  fireEvent.mouseLeave(rows()[0]!); await waitFor(() => expect(rows()[0]).toHaveTextContent('Second report'));
  const before = library.mock.calls.length; await act(async () => vi.advanceTimersByTime(60000));
  expect(library.mock.calls.length).toBeGreaterThan(before);
});
it('LIB-2.8: uses Loading, EmptyState, hidden-gone explanation, error Alert and install CommandBlock', async () => {
  const app = renderApp('/', { library: async () => ok([], { hiddenGone: 4 }) }); await open(app);
  expect(await within(panel()).findByText('Nothing matches')).toBeVisible(); expect(panel()).toHaveTextContent('4 gone Outputs are hidden'); expect(panel()).toHaveTextContent('Hide gone'); app.unmount();
  const empty = renderApp('/', { library: async () => ok([], { unfilteredEmpty: true }) }); await open(empty); expect(await within(panel()).findByText('Nothing produced yet')).toBeVisible(); empty.unmount();
  const missing = renderApp('/', { library: async () => ({ state: 'not-installed', installCommand: 'install tb-session' }) }); await open(missing); expect((await within(panel()).findByRole('alert')).querySelector('[data-slot="command-block"]')).toHaveTextContent('install tb-session'); missing.unmount();
  const failed = renderApp('/', { library: async () => { throw new Error('Read failed'); } }); await open(failed); expect(await within(panel()).findByRole('alert')).toHaveTextContent('Read failed');
});
it('LIB-3.1: a row click only selects and expands, Esc leaves it selected, and the current Session stays in the main pane', async () => {
  const app = renderApp('/s/current', { library: async () => ok([output()]) }); app.snapshot([row({ id: 'current' })]); fireEvent.click(screen.getByRole('button', { name: 'Library' }));
  const option = await first(); fireEvent.click(option);
  expect(option).toHaveAttribute('aria-expanded', 'true'); expect(app.client.resume).not.toHaveBeenCalled(); expect(window.location.pathname).toBe('/s/current');
  fireEvent.keyDown(within(panel()).getByRole('listbox'), { key: 'Escape' }); expect(option).toHaveAttribute('aria-selected', 'true'); expect(option).toHaveAttribute('aria-expanded', 'false');
});
it('LIB-3.2: expanded details show full source, newer edits, timestamps and event count, with eight newest Session chips and older count', async () => {
  const item = output({ kind: 'artifact', url: 'https://example.invalid/page', source: { path: '/source.html', display: '/source.html', type: 'html', createdAt: NOW, updatedAt: NOW + 1000, events: 4, exists: true }, sessions: Array.from({ length: 10 }, (_, i) => session({ sessionId: `writer-${i}`, title: `Writer ${i}`, event: i ? 'edit' : 'publish', lastActiveAt: NOW - i })) });
  const app = renderApp('/', { library: async () => ok([item]) }); await open(app); fireEvent.click(await first());
  expect(panel()).toHaveTextContent('newer than published'); expect(panel()).toHaveTextContent('/source.html'); expect(panel()).toHaveTextContent('3 times'); expect(panel()).toHaveTextContent('+2 older');
  const chips = panel().querySelectorAll('[data-action="session"]'); expect(chips).toHaveLength(8); expect(chips[0]).toHaveAttribute('title', 'published it (S)');
});
it('LIB-3.3: Open uses the file route, Markdown uses VS Code, external URLs use no referrer, and a folded existing source has Open file', async () => {
  const browser = vi.spyOn(window, 'open').mockImplementation(() => null);
  const app = renderApp('/', { library: async () => ok([output(), output({ key: 'md', path: '/a b.md', type: 'markdown' }), output({ key: 'artifact', kind: 'artifact', url: 'https://example.invalid/page', source: { path: '/a.html', display: '/a.html', type: 'html', exists: true, createdAt: NOW, updatedAt: NOW, events: 1 } })]) }); await open(app);
  fireEvent.click(await within(panel()).findByRole('option', { name: /Harbor report HTML/ })); fireEvent.click(within(rows()[0]!).getByRole('button', { name: 'Open' })); expect(browser).toHaveBeenLastCalledWith('/api/library/file?path=%2Freport.html', '_blank', 'noopener,noreferrer');
  fireEvent.click(rows()[1]!); fireEvent.click(within(rows()[1]!).getByRole('button', { name: 'Open' })); expect(browser).toHaveBeenLastCalledWith('vscode://file/a%20b.md', '_self');
  fireEvent.click(rows()[2]!); fireEvent.click(within(rows()[2]!).getByRole('button', { name: 'Open' })); expect(browser).toHaveBeenLastCalledWith('https://example.invalid/page', '_blank', 'noopener,noreferrer'); expect(within(rows()[2]!).getByRole('button', { name: 'Open file' })).toBeVisible(); browser.mockRestore();
});
it('LIB-3.4: Copy link copies an absolute path and reports success for 2 seconds or refusal', async () => {
  const write = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
  const app = renderApp('/', { library: async () => ok([output()]) }); await open(app); fireEvent.click(await first());
  fireEvent.click(within(panel()).getByRole('button', { name: 'Copy link' })); await waitFor(() => expect(within(panel()).getByRole('button', { name: 'Copied' })).toBeVisible()); expect(write).toHaveBeenCalledWith('/report.html');
  await waitFor(() => expect(within(panel()).getByRole('button', { name: 'Copy link' })).toBeVisible(), { timeout: 2500 });
  write.mockRejectedValueOnce(new Error('refused')); fireEvent.click(within(panel()).getByRole('button', { name: 'Copy link' })); expect(await within(panel()).findByRole('button', { name: "Couldn't copy" })).toBeVisible();
});
it('LIB-3.5: Session chips select live Sessions, resume through History’s Starting row, Show blocked ones, and never act for pruned ones', async () => {
  let finish: ((v: Awaited<ReturnType<ReturnType<typeof renderApp>['client']['resume']>>) => void) | undefined;
  const app = renderApp('/', { library: async () => ok([output({ sessions: [session(), session({ sessionId: 'live', title: 'Live writer' }), session({ sessionId: 'deleted', title: 'Deleted writer', blocked: 'transcript-missing' }), session({ sessionId: 'pruned-12345', pruned: true })] })]), resume: () => new Promise((r) => { finish = r; }) }); await open(app); app.snapshot([row({ id: 'live' })]); fireEvent.click(await first());
  await act(async () => { fireEvent.click(within(panel()).getByRole('button', { name: 'Open Live writer, Idle' })); }); expect(window.location.pathname).toBe('/s/live'); expect(app.client.resume).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(within(panel()).getByRole('button', { name: 'Show Deleted writer, past' })); }); expect(window.location.pathname).toBe('/h/claude/deleted');
  expect(within(panel()).queryByRole('button', { name: /pruned/ })).toBeNull();
  fireEvent.click(within(panel()).getByRole('button', { name: 'Resume Report writer, past' })); expect(window.location.pathname).toMatch(/^\/l\//); expect(app.client.resume).toHaveBeenCalledWith('claude', 'writer', expect.any(String));
  await act(async () => finish!({ kind: 'started', launch: launchView({ id: 'resumed' }) }));
});
it('LIB-3.7: O/C/S act once per press on collapsed selected rows, ignore modifiers and modal state, and expose the screen-reader key hint', async () => {
  const browser = vi.spyOn(window, 'open').mockImplementation(() => null), write = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
  const app = renderApp('/', { library: async () => ok([output()]) }); await open(app); const list = await within(panel()).findByRole('listbox'); list.focus();
  fireEvent.keyDown(list, { key: 'O', repeat: true }); fireEvent.keyDown(list, { key: 'o', ctrlKey: true }); expect(browser).not.toHaveBeenCalled();
  fireEvent.keyDown(list, { key: 'O' }); expect(browser).toHaveBeenCalledTimes(1); fireEvent.keyDown(list, { key: 'C' }); await waitFor(() => expect(write).toHaveBeenCalledWith('/report.html'));
  expect(document.getElementById(rows()[0]!.getAttribute('aria-describedby')!.split(' ')[0]!)).toHaveTextContent('O opens it, C copies its link, S opens its Session');
  fireEvent.click(screen.getByRole('button', { name: 'New Session' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  fireEvent.keyDown(list, { key: 'O' }); fireEvent.keyDown(list, { key: 'C' }); fireEvent.keyDown(list, { key: 'S' });
  expect(browser).toHaveBeenCalledTimes(1); expect(write).toHaveBeenCalledTimes(1); expect(app.client.resume).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.keyDown(list, { key: 'S' }); expect(app.client.resume).toHaveBeenCalledTimes(1); browser.mockRestore();
});

it('LIB-2.8: a slow migration says Indexing Transcripts until the first answer arrives', async () => {
  let finish: ((p: LibraryPage) => void) | undefined;
  const app = renderApp('/', { library: () => new Promise((r) => { finish = r; }), libraryStatus: async () => ({ indexing: true }) });
  await open(app);
  expect(within(panel()).getByText('Loading…')).toBeVisible();
  expect(await within(panel()).findByText('Indexing Transcripts…')).toBeVisible();
  await act(async () => finish!(ok([output()])));
  expect(within(panel()).queryByText('Indexing Transcripts…')).toBeNull();
});
it('LIB-2.7: Fleet changes during paging queue a page-one refresh, whose keys replace later-page duplicates', async () => {
  const a = output(), c = output({ key: 'c', title: 'C report' }), b = output({ key: 'b', title: 'B report' });
  let refreshed = false, finish: ((p: LibraryPage) => void) | undefined;
  const library = vi.fn((q) => q.page === 1 ? Promise.resolve(ok(refreshed ? [b, a] : [a, c], { hasMore: true })) : new Promise<LibraryPage>((r) => { finish = r; }));
  const app = renderApp('/', { library }); await open(app);
  fireEvent.click(await within(panel()).findByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(library).toHaveBeenCalledTimes(2));
  refreshed = true; app.snapshot([row({ id: 'new-writer' })]);
  expect(library).toHaveBeenCalledTimes(2);
  await act(async () => finish!(ok([b], { nextPage: 3 })));
  await waitFor(() => expect(library).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(rows()).toHaveLength(2));
  expect(rows()[0]).toHaveTextContent('B report'); expect(rows()[1]).toHaveTextContent('Harbor report');
  expect(library.mock.calls.map(([q]) => q.page)).toEqual([1, 2, 1]);
});

it('LIB-2.7: routine Session metadata waits for the 60-second refresh and never queues another indexing call', async () => {
  vi.useFakeTimers({ now: NOW });
  const base = row({ id: 'writer', status: 'busy', subagents: { running: 1, finished: 0 } });
  const library = vi.fn(async () => ok([output()]));
  const app = renderApp('/', { library });
  app.snapshot([base]);
  fireEvent.click(screen.getByRole('button', { name: 'Library' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(library).toHaveBeenCalledTimes(1);
  for (let seconds = 2; seconds < 60; seconds += 2) {
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    app.snapshot([{
      ...base, contextPct: seconds, activity: `Reading file ${seconds}`, model: `model-${seconds}`,
      modelAt: String(seconds), title: `Writer ${seconds}`, status: seconds % 4 ? 'idle' : 'busy', statusSince: NOW + seconds * 1000,
    }]);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(library).toHaveBeenCalledTimes(1);
  }
  // The periodic read is slow: metadata changes while it runs must not arm refreshQueued.
  let finish: ((p: LibraryPage) => void) | undefined;
  library.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(library).toHaveBeenCalledTimes(2);
  for (let n = 0; n < 3; n++) {
    app.snapshot([{ ...base, contextPct: 70 + n, activity: `Streaming ${n}` }]);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  }
  await act(async () => { finish!(ok([output()])); await vi.advanceTimersByTimeAsync(0); });
  expect(library).toHaveBeenCalledTimes(2);
  // Subagent completion, process replacement, Session start and Session end still refresh promptly.
  let current = { ...base, subagents: { running: 0, finished: 1 } };
  app.snapshot([current]); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(library).toHaveBeenCalledTimes(3);
  current = { ...current, subagents: { running: 2, finished: 0 } };
  app.snapshot([current]); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(library).toHaveBeenCalledTimes(3);
  current = { ...current, pid: 200, procStart: '2026-10-16T12:01:00Z' };
  app.snapshot([current]); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(library).toHaveBeenCalledTimes(4);
  const another = row({ id: 'another' });
  app.snapshot([current, another]); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(library).toHaveBeenCalledTimes(5);
  app.snapshot([another, current]); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(library).toHaveBeenCalledTimes(5);
  app.snapshot([current]); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(library).toHaveBeenCalledTimes(6);
});

it('LIB-2.1: a refresh keeps the retained later page’s overflow continuation when loading more', async () => {
  let firstReads = 0;
  const library = vi.fn(async (q) => q.page === 1
    ? ok([output()], { hasMore: true, nextPage: 3, continuation: `first-${++firstReads}` })
    : q.page === 3 ? ok([output({ key: 'second', title: 'Second report' })], { hasMore: true, nextPage: 4, continuation: 'retained-overflow' })
      : ok([output({ key: 'third', title: 'Third report' })]));
  const app = renderApp('/', { library }); await open(app);
  fireEvent.click(await within(panel()).findByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(rows()).toHaveLength(2));
  app.snapshot([row({ id: 'new-writer' })]);
  await waitFor(() => expect(library).toHaveBeenCalledTimes(3));
  fireEvent.click(within(panel()).getByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(rows()).toHaveLength(3));
  expect(library).toHaveBeenLastCalledWith(expect.objectContaining({ page: 4, continuation: 'retained-overflow' }));
});
