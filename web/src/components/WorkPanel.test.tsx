import { TB_PROD_INSTALL_COMMAND, TB_PROD_SIGN_IN_COMMAND } from '@shared/defaults.ts';
import { PRODUCTIVE_EMAIL_ERROR } from '@shared/settings.ts';
import type { HistoryItem } from '@shared/types.ts';
import type { ColumnMark, PrSection, PrTaskRef, TaskSection, WorkPr, WorkSessionLink, WorkSnapshot, WorkTask } from '@shared/work.ts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REFRESH_FAILED, REFRESH_NOT_WATCHED, SaveError } from '@/lib/client';
import { initialState, reducer } from '@/lib/store';
import { ageLevel } from '@/lib/work';
import { renderApp, row, rowEl, settings } from '@/test/helpers';

/** Synthetic PRs only: invented repos, numbers and titles. */
const pr = (over: Partial<WorkPr> & { repo: string; number: number }): WorkPr => ({
  title: `${over.repo} change ${over.number}`,
  url: `https://github.com/productiveio/${over.repo}/pull/${over.number}`,
  createdAt: Date.now() - 2 * 86_400_000,
  ageDays: 2,
  rotting: 'fresh',
  ci: 'none',
  chip: 'draft',
  column: 'draft_mine',
  taskIds: [],
  links: null,
  ...over,
});

const DRAFT = pr({ repo: 'anvil', number: 2101, title: 'Sharpen the anvil corners', ci: 'passing', chip: 'draft' });
const READY = pr({ repo: 'willow', number: 2102, title: 'Hang the willow lanterns', ci: 'failing', chip: 'ready', column: 'review_mine', createdAt: Date.now() - 6 * 86_400_000 });
const APPROVED = pr({ repo: 'kettle', number: 2103, title: 'Draft the kettle manual', ci: 'none', chip: 'approved', column: 'ready_to_merge_mine' });
const REVIEW = pr({ repo: 'willow', number: 2106, title: 'Count the willow leaves', ci: 'none', chip: null, column: 'waiting_on_me' });

function prs(over: Partial<PrSection> = {}): PrSection {
  return {
    state: 'ok',
    reason: null,
    fix: null,
    stale: false,
    fetchedAt: Date.now() - 150_000, // "2m" while the app's clock lags up to a second
    mine: [DRAFT, READY, APPROVED],
    reviewRequests: [REVIEW],
    marks: { mine: [], reviewRequests: [] },
    taskIds: true,
    ...over,
  };
}

/** Synthetic Tasks only: invented projects, titles and ids. */
const task = (over: Partial<WorkTask> & { id: string; title: string }): WorkTask => ({
  project: 'Lantern Works',
  status: 'In progress',
  statusCategory: 'started',
  dueDate: null,
  lastActivityAt: Date.now() - 3_600_000,
  milestone: false,
  url: `https://app.fantastic.productive.io/109-productive/tasks/${over.id}`,
  links: null,
  ...over,
});

const YEAR = new Date().getFullYear();
const LIGHT = task({ id: '41000101', title: 'Light the harbor lanterns' });
const BELLS = task({ id: '41000102', title: 'Tune the harbor bells', project: 'Harbor Bells', status: 'Not started', statusCategory: 'not-started', dueDate: `${YEAR}-11-04`, milestone: true });

/** No Productive email saved: Tasks isn't read (WORK-2.6). The PR tests' default. */
const NO_EMAIL: TaskSection = { state: 'no-email', reason: null, fix: null, stale: false, fetchedAt: null, tasks: [] };

function tasks(over: Partial<TaskSection> = {}): TaskSection {
  return { state: 'ok', reason: null, fix: null, stale: false, fetchedAt: Date.now() - 150_000, tasks: [LIGHT, BELLS], ...over };
}

const snap = (p: Partial<PrSection> = {}, refresh: Partial<WorkSnapshot['refresh']> = {}, t: TaskSection = NO_EMAIL): WorkSnapshot => ({
  prs: prs(p),
  tasks: t,
  sessionLinks: { state: 'ok', reason: null, fix: null },
  refresh: { cooldownUntil: null, githubBlockedUntil: null, ...refresh },
});
/** Work with Tasks read for a saved email. */
const withTasks = (t: Partial<TaskSection> = {}, p: Partial<PrSection> = {}) => snap(p, {}, tasks(t));

const workPanel = () => screen.getByTestId('work-panel');
const tab = (name: 'History' | 'Work') => screen.getByRole('tab', { name });
const listbox = () => within(workPanel()).getByRole('listbox', { name: 'PRs', hidden: true });
const options = () => within(workPanel()).queryAllByRole('option', { hidden: true });
const shown = () => options().map((o) => o.getAttribute('data-pr'));
const selectedPr = () => options().find((o) => o.getAttribute('aria-selected') === 'true')?.getAttribute('data-pr') ?? null;
const group = (name: 'Mine' | 'Review requests') => within(workPanel()).getByRole('group', { name });
const option = (id: string) => options().find((o) => o.getAttribute('data-pr') === id)!;
const rowButton = (id: string, action: 'open' | 'review') => option(id).querySelector<HTMLElement>(`[data-action="${action}"]`);
const taskList = () => within(workPanel()).getByRole('listbox', { name: 'Tasks', hidden: true });
const taskOption = (id: string) => options().find((o) => o.getAttribute('data-task') === id)!;
const taskButton = (id: string, action: 'open' | 'start') => taskOption(id).querySelector<HTMLElement>(`[data-action="${action}"]`);
/** Every row, Tasks and PRs, top to bottom, by its Task id or its repo#number. */
const shownRows = () => options().map((o) => o.getAttribute('data-task') ?? o.getAttribute('data-pr'));
const selectedRow = () => {
  const o = options().find((x) => x.getAttribute('aria-selected') === 'true');
  return o ? (o.getAttribute('data-task') ?? o.getAttribute('data-pr')) : null;
};
const tasksRegion = () => within(workPanel()).getByRole('region', { name: 'Tasks' });

function openApp(path = '/', work: WorkSnapshot | null = snap(), options: Parameters<typeof renderApp>[1] = {}, current = settings()) {
  const app = renderApp(path, options);
  app.snapshot([row({ id: 'alpha' }), row({ id: 'beta' })], { state: 'ok' }, current);
  if (work) app.emit({ type: 'work', work });
  return app;
}

/**
 * A click on a button as Safari and Firefox on macOS give it: the button doesn't take focus, so the
 * closest focusable element around it, Work itself, does.
 */
function clickUnfocused(button: HTMLElement) {
  fireEvent.mouseDown(button);
  act(() => workPanel().focus());
  fireEvent.mouseUp(button);
  fireEvent.click(button);
}

/** WORK-6.3: what Lookout opened in a new tab, through `window.open`. */
function spyOpen() {
  const opened: [string, string, string][] = [];
  vi.spyOn(window, 'open').mockImplementation((url, target, features) => {
    opened.push([String(url), String(target), String(features)]);
    return null;
  });
  return opened;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});
afterEach(() => vi.restoreAllMocks());

describe('the Work tab (WORK-1)', () => {
  it('WORK-1.1: W opens the right sidebar on Work and closes it on Work; H does the same for History; both stand down in a text field', async () => {
    const user = userEvent.setup();
    openApp();
    expect(screen.queryByTestId('right-sidebar')).toBeNull();
    await user.keyboard('w');
    expect(tab('Work')).toHaveAttribute('aria-selected', 'true');
    expect(workPanel()).toBeVisible();
    // H on Work switches to History; H again closes it.
    await user.keyboard('h');
    expect(tab('History')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search past Sessions' })).toHaveFocus());
    // In History's search box, w and h are text.
    await user.keyboard('wh');
    expect(screen.getByRole('searchbox', { name: 'Search past Sessions' })).toHaveValue('wh');
    expect(tab('History')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.body, { key: 'w' });
    expect(tab('Work')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.body, { key: 'w' });
    expect(screen.queryByTestId('right-sidebar')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'h' });
    expect(tab('History')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.body, { key: 'h' });
    expect(screen.queryByTestId('right-sidebar')).toBeNull();
    // With a modifier, they're not Work's or History's.
    fireEvent.keyDown(document.body, { key: 'w', metaKey: true });
    expect(screen.queryByTestId('right-sidebar')).toBeNull();
    // The closed rail has a button per tab, each naming its key.
    expect(screen.getByRole('button', { name: 'Work' })).toHaveAttribute('title', 'Work (W)');
    expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('title', 'History (H)');
    await user.click(screen.getByRole('button', { name: 'Work' }));
    expect(tab('Work')).toHaveAttribute('aria-selected', 'true');
  });

  it('HIST-1.1: H switches to History from Work; the sidebar is named “Right sidebar”, and History’s tab names its panel, with no other History heading', async () => {
    const user = userEvent.setup();
    openApp();
    await user.keyboard('w');
    expect(screen.getByRole('complementary', { name: 'Right sidebar' })).toBeInTheDocument();
    await user.keyboard('h');
    expect(tab('History')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'History' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'History' })).toBeNull();
  });

  it('WORK-1.1: W and H stand down while a modal is open', async () => {
    const user = userEvent.setup();
    openApp();
    await user.keyboard('n');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'w' });
    fireEvent.keyDown(document.body, { key: 'h' });
    expect(screen.queryByTestId('right-sidebar')).toBeNull();
  });

  it('WORK-1.2: the open tab, whether the sidebar is open, and its width are remembered across reloads', async () => {
    const user = userEvent.setup();
    const app = openApp();
    await user.keyboard('w');
    fireEvent.mouseDown(screen.getByRole('separator', { name: 'Resize the right sidebar' }), { clientX: 1000 });
    fireEvent.mouseMove(window, { clientX: 880 });
    fireEvent.mouseUp(window, { clientX: 880 });
    app.unmount();

    const reloaded = openApp();
    expect(tab('Work')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('right-sidebar')).toHaveStyle({ width: '480px' });
    await user.click(tab('History'));
    reloaded.unmount();
    const again = openApp();
    expect(tab('History')).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('button', { name: 'Close History' }));
    again.unmount();
    openApp();
    expect(screen.queryByTestId('right-sidebar')).toBeNull();
  });

  it('WORK-1.2: a layout kept by History before Work existed opens as it was, on History', () => {
    window.localStorage.setItem('lookout.history', JSON.stringify({ open: true, width: 420 }));
    openApp();
    expect(tab('History')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('right-sidebar')).toHaveStyle({ width: '420px' });
  });

  it('WORK-1.2: a corrupt or odd kept layout still falls back to History’s old one', () => {
    for (const corrupt of ['{not json', '"a string"', '[1, 2]', 'null']) {
      window.localStorage.clear();
      window.localStorage.setItem('lookout.right', corrupt);
      window.localStorage.setItem('lookout.history', JSON.stringify({ open: true, width: 420 }));
      const app = openApp();
      expect(tab('History'), corrupt).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('right-sidebar')).toHaveStyle({ width: '420px' });
      app.unmount();
    }
  });

  it('WORK-1.3: Work has two sections, Tasks then PRs, each with its count and how old its data is', async () => {
    openApp('/', withTasks({ fetchedAt: Date.now() - 7 * 60_000 }));
    await userEvent.setup().keyboard('w');
    expect(within(workPanel()).getAllByRole('region').map((r) => r.getAttribute('data-section'))).toEqual(['tasks', 'prs']);
    const prsSection = within(workPanel()).getByRole('region', { name: 'PRs' });
    expect(within(prsSection).getByText('4')).toHaveAttribute('data-field', 'count');
    expect(prsSection.querySelector('[data-field="updated"]')).toHaveTextContent('updated 2m ago');
    expect(tasksRegion().querySelector('[data-field="count"]')).toHaveTextContent(/^2 open$/);
    expect(tasksRegion().querySelector('[data-field="updated"]')).toHaveTextContent('updated 7m ago');
    expect(within(workPanel()).getByRole('heading', { name: 'Tasks' })).toBeInTheDocument();
  });

  it('WORK-1.5: the filter offers All (the default), Tasks and PRs; Tasks shows only Tasks, PRs only PRs with both groups; the choice is remembered', async () => {
    const user = userEvent.setup();
    const app = openApp('/', withTasks());
    await user.keyboard('w');
    const filter = within(workPanel()).getByRole('group', { name: 'Show' });
    const choice = (name: string) => within(filter).getByRole('button', { name });
    const sections = () => within(workPanel()).queryAllByRole('region').map((r) => r.getAttribute('data-section'));
    expect(within(filter).getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Tasks', 'PRs']);
    expect(choice('All')).toHaveAttribute('aria-pressed', 'true');
    expect(sections()).toEqual(['tasks', 'prs']);
    expect(shownRows()).toEqual(['41000101', '41000102', 'anvil#2101', 'willow#2102', 'kettle#2103', 'willow#2106']);
    await user.click(choice('Tasks'));
    expect(choice('Tasks')).toHaveAttribute('aria-pressed', 'true');
    expect(sections()).toEqual(['tasks']);
    expect(shownRows()).toEqual(['41000101', '41000102']);
    await user.click(choice('PRs'));
    expect(sections()).toEqual(['prs']);
    expect(group('Mine')).toBeInTheDocument();
    expect(group('Review requests')).toBeInTheDocument();
    expect(shownRows()).toEqual(['anvil#2101', 'willow#2102', 'kettle#2103', 'willow#2106']);
    app.unmount();
    openApp('/', withTasks());
    expect(within(workPanel()).getByRole('button', { name: 'PRs' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('WORK-1.5: a remembered Tasks filter shows Tasks only', () => {
    window.localStorage.setItem('lookout.right', JSON.stringify({ open: true, width: 360, tab: 'work', workFilter: 'tasks' }));
    openApp('/', withTasks());
    expect(within(workPanel()).getByRole('button', { name: 'Tasks' })).toHaveAttribute('aria-pressed', 'true');
    expect(shownRows()).toEqual(['41000101', '41000102']);
    expect(within(workPanel()).queryByRole('region', { name: 'PRs' })).toBeNull();
  });

  it('WORK-1.5: an unknown remembered filter reads as All', () => {
    window.localStorage.setItem('lookout.right', JSON.stringify({ open: true, width: 360, tab: 'work', workFilter: 'reviews' }));
    openApp('/', withTasks());
    expect(within(workPanel()).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('WORK-1.6 (support): switching the filter shows the hidden section’s latest data at once, without asking the server for a read', async () => {
    const user = userEvent.setup();
    const app = openApp('/', withTasks());
    await user.keyboard('w');
    await waitFor(() => expect(app.client.watchWork).toHaveBeenCalledWith('tab-1', true));
    // The watch is said once, when Work opens: no switch says it again, or closes it and reopens it.
    const watches = vi.mocked(app.client.watchWork).mock.calls.length;
    await user.click(within(workPanel()).getByRole('button', { name: 'PRs' }));
    app.emit({ type: 'work', work: withTasks({ tasks: [BELLS] }, { mine: [DRAFT], reviewRequests: [] }) });
    await user.click(within(workPanel()).getByRole('button', { name: 'Tasks' }));
    expect(shownRows()).toEqual(['41000102']);
    await user.click(within(workPanel()).getByRole('button', { name: 'All' }));
    expect(shownRows()).toEqual(['41000102', 'anvil#2101']);
    expect(app.client.refreshWork).not.toHaveBeenCalled();
    expect(vi.mocked(app.client.watchWork).mock.calls).toHaveLength(watches);
    expect(vi.mocked(app.client.watchWork).mock.calls.at(-1)).toEqual(['tab-1', true]);
  });

  it('WORK-1.7: with focus in Work, ↑/↓ and j/k move through the rows of both groups without acting; Enter acts like a click', async () => {
    const user = userEvent.setup();
    openApp('/s/alpha');
    await user.keyboard('w');
    await waitFor(() => expect(listbox()).toHaveFocus());
    expect(selectedPr()).toBe('anvil#2101');
    await user.keyboard('{ArrowDown}');
    expect(selectedPr()).toBe('willow#2102');
    await user.keyboard('jj');
    expect(selectedPr()).toBe('willow#2106'); // on into Review requests
    await user.keyboard('j');
    expect(selectedPr()).toBe('willow#2106'); // the last row stays
    await user.keyboard('k{ArrowUp}');
    expect(selectedPr()).toBe('willow#2102');
    // Nothing acted: the Session sidebar kept its selection, no launcher opened.
    expect(window.location.pathname).toBe('/s/alpha');
    expect(screen.queryByRole('dialog')).toBeNull();
    // Enter acts like a click: a PR without a Linked Session does nothing (WORK-2.4's UX).
    await user.keyboard('{Enter}');
    expect(window.location.pathname).toBe('/s/alpha');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(selectedPr()).toBe('willow#2102');
    // A click selects the row, as Enter would act on it.
    await user.click(options()[0]!);
    expect(selectedPr()).toBe('anvil#2101');
    expect(window.location.pathname).toBe('/s/alpha');
  });

  it('WORK-1.7: on the tab strip, Refresh or Close, j/k and ↑/↓ move the open panel’s rows, never the Session sidebar’s; ←/→ move between the tabs', async () => {
    const user = userEvent.setup();
    const past = (id: string): HistoryItem => ({
      sessionId: id,
      harness: 'claude',
      headless: false,
      title: id,
      projectPath: '/Users/me/Projects/work',
      repo: 'work',
      branch: 'main',
      lastActiveAt: Date.now() - 3_600_000,
      snippet: null,
      blocked: null,
    });
    openApp('/s/alpha', snap(), { history: async () => ({ state: 'ok', items: [past('past-1'), past('past-2'), past('past-3')], page: 1, hasMore: false }) });
    await user.keyboard('w');
    expect(selectedPr()).toBe('anvil#2101');
    // Work: from its tab, Refresh and Close.
    for (const target of [tab('Work'), screen.getByRole('button', { name: 'Refresh' }), screen.getByRole('button', { name: 'Close Work' })]) {
      target.focus();
      await user.keyboard('j');
    }
    expect(selectedPr()).toBe('willow#2106');
    tab('Work').focus();
    await user.keyboard('k{ArrowUp}');
    expect(selectedPr()).toBe('willow#2102');
    expect(window.location.pathname).toBe('/s/alpha');
    expect(tab('Work')).toHaveFocus();

    // ←/→ move between the tabs, focus staying on the tab strip; only the open tab is tabbable.
    expect(tab('Work')).toHaveAttribute('tabindex', '0');
    expect(tab('History')).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{ArrowLeft}');
    expect(tab('History')).toHaveAttribute('aria-selected', 'true');
    expect(tab('History')).toHaveFocus();
    expect(tab('History')).toHaveAttribute('tabindex', '0');
    const results = await within(screen.getByTestId('history-panel')).findAllByRole('option');
    expect(results.map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    // History: j from its tab moves its results, not the Session sidebar.
    expect(tab('History')).toHaveFocus();
    await user.keyboard('jj');
    expect(within(screen.getByTestId('history-panel')).getAllByRole('option').map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
    expect(window.location.pathname).toBe('/s/alpha');
    await user.keyboard('{ArrowRight}');
    expect(tab('Work')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Work')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab('History')).toHaveAttribute('aria-selected', 'true');
    // Work kept its selection meanwhile.
    await user.keyboard('{ArrowLeft}');
    expect(selectedPr()).toBe('willow#2102');
    expect(window.location.pathname).toBe('/s/alpha');
  });

  it('WORK-1.7: focus moves into the list once it shows, and back to Work when the last PR goes, so j/k never reach the Session sidebar', async () => {
    const user = userEvent.setup();
    const empty = snap({ mine: [], reviewRequests: [] });
    const app = openApp('/s/alpha', snap({ state: 'loading', fetchedAt: null, mine: [], reviewRequests: [] }));
    await user.keyboard('w');
    // Nothing read yet: Work itself holds focus, named for a screen reader, and keeps j/k.
    await waitFor(() => expect(workPanel()).toHaveFocus());
    expect(workPanel()).toHaveAccessibleName('Work');
    await user.keyboard('j');
    expect(window.location.pathname).toBe('/s/alpha');
    // The PRs arrive: the list takes focus, so Enter, O and R reach it.
    app.emit({ type: 'work', work: snap() });
    expect(listbox()).toHaveFocus();
    await user.keyboard('j');
    expect(selectedPr()).toBe('willow#2102');
    // The last PR goes: focus goes back to Work, not to the page.
    app.emit({ type: 'work', work: empty });
    expect(within(workPanel()).queryByRole('listbox')).toBeNull();
    expect(workPanel()).toHaveFocus();
    await user.keyboard('jk');
    expect(window.location.pathname).toBe('/s/alpha');
    app.emit({ type: 'work', work: snap() });
    expect(listbox()).toHaveFocus();
    // Focus put elsewhere stays there when the list comes back.
    app.emit({ type: 'work', work: empty });
    within(workPanel()).getByRole('button', { name: 'All' }).focus();
    app.emit({ type: 'work', work: snap() });
    expect(within(workPanel()).getByRole('button', { name: 'All' })).toHaveFocus();
  });

  it('WORK-1.9: the selection stays on its item across reads; once a read removes it, it moves to the first visible row, or to none', async () => {
    const user = userEvent.setup();
    const app = openApp();
    await user.keyboard('w');
    await user.keyboard('jj');
    expect(selectedPr()).toBe('kettle#2103');
    // A read that reorders and adds: the selection stays on kettle#2103.
    const NEW = pr({ repo: 'anvil', number: 2120 });
    app.emit({ type: 'work', work: snap({ mine: [NEW, APPROVED, DRAFT, READY] }) });
    expect(selectedPr()).toBe('kettle#2103');
    // A read that removes it: the first visible row.
    app.emit({ type: 'work', work: snap({ mine: [DRAFT, READY] }) });
    expect(selectedPr()).toBe('anvil#2101');
    // A filter change keeps it while it's visible.
    await user.click(within(workPanel()).getByRole('button', { name: 'PRs' }));
    await user.click(within(workPanel()).getByRole('button', { name: 'All' }));
    expect(selectedPr()).toBe('anvil#2101');
    // Work empty: none selected.
    app.emit({ type: 'work', work: snap({ mine: [], reviewRequests: [] }) });
    expect(options()).toEqual([]);
    expect(within(workPanel()).queryByRole('listbox')).toBeNull();
  });

  it('WORK-1.7: ↑/↓ and j/k run on from the last Task into the PRs and back, focus following the selection into the list that holds it', async () => {
    const user = userEvent.setup();
    openApp('/s/alpha', withTasks());
    await user.keyboard('w');
    await waitFor(() => expect(taskList()).toHaveFocus());
    expect(selectedRow()).toBe('41000101');
    expect(taskList()).toHaveAttribute('aria-activedescendant', taskOption('41000101').id);
    await user.keyboard('j');
    expect(selectedRow()).toBe('41000102');
    await user.keyboard('{ArrowDown}');
    expect(selectedRow()).toBe('anvil#2101');
    // Focus moved with it: the list in focus shows its selected row, the other none.
    expect(listbox()).toHaveFocus();
    expect(listbox()).toHaveAttribute('aria-activedescendant', option('anvil#2101').id);
    expect(taskList()).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('k');
    expect(selectedRow()).toBe('41000102');
    expect(taskList()).toHaveFocus();
    // Nothing acted; Enter on a Task without a Linked Session does nothing (UX, "Row clicks").
    await user.keyboard('{Enter}');
    expect(window.location.pathname).toBe('/s/alpha');
    expect(screen.queryByRole('dialog')).toBeNull();
    // A click on a PR row selects it; the tab strip moves the rows without taking focus from it.
    await user.click(option('willow#2102'));
    expect(selectedRow()).toBe('willow#2102');
    tab('Work').focus();
    await user.keyboard('kk');
    expect(selectedRow()).toBe('41000102');
    expect(tab('Work')).toHaveFocus();
  });

  it('WORK-1.7: only the list holding the selection is in the Tab order; a click into the other list selects its first row, so O opens what the focused list shows', async () => {
    const user = userEvent.setup();
    const opened = spyOpen();
    openApp('/s/alpha', withTasks());
    await user.keyboard('w');
    await waitFor(() => expect(taskList()).toHaveFocus());
    expect(selectedRow()).toBe('41000101');
    expect(taskList()).toHaveAttribute('tabindex', '0');
    expect(listbox()).toHaveAttribute('tabindex', '-1');
    // Tab doesn't land on the PRs, which don't hold the selection.
    await user.tab();
    expect(listbox()).not.toHaveFocus();
    // A click on the PRs' group heading focuses them and selects their first row: O opens that PR, not the Task.
    await user.click(within(group('Review requests')).getByText('Review requests'));
    expect(listbox()).toHaveFocus();
    expect(selectedRow()).toBe('anvil#2101');
    expect(listbox()).toHaveAttribute('aria-activedescendant', option('anvil#2101').id);
    expect(taskList()).not.toHaveAttribute('aria-activedescendant');
    expect(listbox()).toHaveAttribute('tabindex', '0');
    expect(taskList()).toHaveAttribute('tabindex', '-1');
    await user.keyboard('o');
    expect(opened.map(([url]) => url)).toEqual([DRAFT.url]);
    // Shift+Tab passes over the Tasks; Tab from the filter comes back to the PRs, holding the selection.
    await user.tab({ shift: true });
    expect(taskList()).not.toHaveFocus();
    within(workPanel()).getByRole('button', { name: 'PRs' }).focus();
    await user.tab();
    expect(listbox()).toHaveFocus();
    expect(selectedRow()).toBe('anvil#2101');
  });

  it('WORK-1.7: a read that moves the selection out of the focused list takes focus with it, so O opens the row it shows', async () => {
    const user = userEvent.setup();
    const opened = spyOpen();
    const app = openApp('/s/alpha', withTasks());
    await user.keyboard('w');
    await waitFor(() => expect(taskList()).toHaveFocus());
    await user.keyboard('jjj');
    expect(selectedRow()).toBe('willow#2102');
    expect(listbox()).toHaveFocus();
    // The read drops the selected PR: the selection moves to the first visible row, a Task, and focus goes with it.
    app.emit({ type: 'work', work: withTasks({}, { mine: [DRAFT, APPROVED] }) });
    expect(selectedRow()).toBe('41000101');
    expect(taskList()).toHaveFocus();
    expect(taskList()).toHaveAttribute('aria-activedescendant', taskOption('41000101').id);
    expect(listbox()).not.toHaveAttribute('aria-activedescendant');
    expect(listbox()).toHaveAttribute('tabindex', '-1');
    await user.keyboard('o');
    expect(opened.map(([url]) => url)).toEqual([LIGHT.url]);
  });

  it('WORK-1.7: focus that reaches the other list without a click in it, as a script’s, goes on to the list holding the selection and moves nothing', async () => {
    const user = userEvent.setup();
    const opened = spyOpen();
    openApp('/s/alpha', withTasks());
    await user.keyboard('w');
    await waitFor(() => expect(taskList()).toHaveFocus());
    expect(selectedRow()).toBe('41000101');
    act(() => listbox().focus());
    expect(taskList()).toHaveFocus();
    expect(selectedRow()).toBe('41000101');
    expect(taskList()).toHaveAttribute('aria-activedescendant', taskOption('41000101').id);
    await user.keyboard('o');
    expect(opened.map(([url]) => url)).toEqual([LIGHT.url]);
  });

  it('WORK-1.7: closing the launcher that R or Start Session opened, without a start, gives focus back to the list holding the selection, so j/k move Work, not the Session sidebar', async () => {
    const user = userEvent.setup();
    openApp('/s/alpha', withTasks());
    await user.keyboard('w');
    await waitFor(() => expect(taskList()).toHaveFocus());
    await user.keyboard('jjjjj');
    expect(selectedRow()).toBe('willow#2106');
    await user.keyboard('r');
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(listbox()).toHaveFocus());
    await user.keyboard('k');
    expect(selectedRow()).toBe('kettle#2103');
    expect(window.location.pathname).toBe('/s/alpha');
    // Start Session's button, then Escape: back to the Tasks, holding the Task it was pressed on.
    await user.click(taskButton('41000102', 'start')!);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(taskList()).toHaveFocus());
    await user.keyboard('j');
    expect(selectedRow()).toBe('anvil#2101');
    expect(window.location.pathname).toBe('/s/alpha');
  });

  it('WORK-1.7: a list that shows up while Work itself has focus, as after a click on a heading, leaves the selection on the row still showing and focuses the list that holds it', async () => {
    const user = userEvent.setup();
    const opened = spyOpen();
    const app = openApp('/s/alpha', withTasks({ state: 'loading', fetchedAt: null, tasks: [] }));
    await user.keyboard('w');
    await waitFor(() => expect(listbox()).toHaveFocus());
    await user.keyboard('j');
    expect(selectedRow()).toBe('willow#2102');
    // Nothing focusable holds the Tasks heading, so a click on it puts focus on Work itself.
    await user.click(within(tasksRegion()).getByRole('heading', { name: 'Tasks' }));
    expect(workPanel()).toHaveFocus();
    // The read brings the Tasks: willow#2102 still shows, so it stays selected, and focus goes to its list.
    app.emit({ type: 'work', work: withTasks() });
    expect(shownRows()).toEqual(['41000101', '41000102', 'anvil#2101', 'willow#2102', 'kettle#2103', 'willow#2106']);
    expect(selectedRow()).toBe('willow#2102');
    expect(listbox()).toHaveFocus();
    expect(listbox()).toHaveAttribute('tabindex', '0');
    expect(taskList()).toHaveAttribute('tabindex', '-1');
    await user.keyboard('o');
    expect(opened.map(([url]) => url)).toEqual([READY.url]);
  });

  it('WORK-1.7: switching from PRs to All while Work itself has focus, as a filter click leaves it in Safari and Firefox, keeps the selected PR and focuses its list', async () => {
    const user = userEvent.setup();
    const opened = spyOpen();
    openApp('/s/alpha', withTasks());
    await user.keyboard('w');
    await waitFor(() => expect(taskList()).toHaveFocus());
    clickUnfocused(within(workPanel()).getByRole('button', { name: 'PRs' }));
    expect(workPanel()).toHaveFocus();
    expect(selectedRow()).toBe('anvil#2101');
    await user.keyboard('j');
    expect(selectedRow()).toBe('willow#2102');
    // All brings the Tasks list back: the selection stays on the PR, and focus goes to the PRs.
    clickUnfocused(within(workPanel()).getByRole('button', { name: 'All' }));
    expect(shownRows()).toEqual(['41000101', '41000102', 'anvil#2101', 'willow#2102', 'kettle#2103', 'willow#2106']);
    expect(selectedRow()).toBe('willow#2102');
    expect(listbox()).toHaveFocus();
    expect(taskList()).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('o');
    expect(opened.map(([url]) => url)).toEqual([READY.url]);
  });

  it('WORK-1.7: a PRs list with only “Possibly out of date” marks, no rows, is in the Tab order while no list holds the selection', async () => {
    const user = userEvent.setup();
    const marks = { mine: [], reviewRequests: [{ columns: ['waiting_on_me'], reason: "GitHub's rate limit is used up", confirmedAt: Date.now() - 45_000 }] } satisfies PrSection['marks'];
    const app = openApp('/s/alpha', withTasks({ tasks: [] }, { mine: [], reviewRequests: [], marks }));
    await user.keyboard('w');
    await waitFor(() => expect(listbox()).toHaveFocus());
    expect(options()).toEqual([]);
    expect(listbox()).toHaveAttribute('tabindex', '0');
    // Tab from the filter comes back to it.
    within(workPanel()).getByRole('button', { name: 'PRs' }).focus();
    await user.tab();
    expect(listbox()).toHaveFocus();
    // A Task shows up and holds the selection: only the Tasks are in the Tab order.
    app.emit({ type: 'work', work: withTasks({ tasks: [LIGHT] }, { mine: [], reviewRequests: [], marks }) });
    expect(selectedRow()).toBe('41000101');
    expect(taskList()).toHaveFocus();
    expect(taskList()).toHaveAttribute('tabindex', '0');
    expect(listbox()).toHaveAttribute('tabindex', '-1');
  });

  it('WORK-1.7: when the focused Tasks list’s last row goes, the PRs list takes focus, and Work itself once neither is left', async () => {
    const user = userEvent.setup();
    const app = openApp('/s/alpha', withTasks());
    await user.keyboard('w');
    await waitFor(() => expect(taskList()).toHaveFocus());
    app.emit({ type: 'work', work: withTasks({ tasks: [] }) });
    expect(within(workPanel()).queryByRole('listbox', { name: 'Tasks' })).toBeNull();
    expect(listbox()).toHaveFocus();
    expect(selectedRow()).toBe('anvil#2101');
    app.emit({ type: 'work', work: withTasks({ tasks: [] }, { mine: [], reviewRequests: [] }) });
    expect(workPanel()).toHaveFocus();
    await user.keyboard('jk');
    expect(window.location.pathname).toBe('/s/alpha');
    // Opening Work again focuses the list that holds the selected row.
    app.emit({ type: 'work', work: withTasks() });
    await user.keyboard('jjj');
    expect(selectedRow()).toBe('willow#2102');
    await user.click(tab('History'));
    await user.click(tab('Work'));
    await waitFor(() => expect(listbox()).toHaveFocus());
    expect(selectedRow()).toBe('willow#2102');
  });

  it('WORK-1.9: a filter change that hides the selected row moves the selection to the first visible row', async () => {
    const user = userEvent.setup();
    const app = openApp('/', withTasks());
    await user.keyboard('w');
    await user.keyboard('jjj');
    expect(selectedRow()).toBe('willow#2102');
    await user.click(within(workPanel()).getByRole('button', { name: 'Tasks' }));
    expect(selectedRow()).toBe('41000101');
    await user.keyboard('j');
    expect(selectedRow()).toBe('41000102');
    // Back to All: the Task is still visible, so it stays selected.
    await user.click(within(workPanel()).getByRole('button', { name: 'All' }));
    expect(selectedRow()).toBe('41000102');
    await user.click(within(workPanel()).getByRole('button', { name: 'PRs' }));
    expect(selectedRow()).toBe('anvil#2101');
    // A read that removes the selected Task: the first visible row.
    await user.click(within(workPanel()).getByRole('button', { name: 'Tasks' }));
    await user.keyboard('j');
    expect(selectedRow()).toBe('41000102');
    app.emit({ type: 'work', work: withTasks({ tasks: [LIGHT] }) });
    expect(selectedRow()).toBe('41000101');
    // Tasks empty under the Tasks filter: none.
    app.emit({ type: 'work', work: withTasks({ tasks: [] }) });
    expect(selectedRow()).toBeNull();
  });

  it('WORK-1.10: with Work open, a Session row click selects it, and the composer takes W, H, O, R, j and k as text without moving Work', async () => {
    const user = userEvent.setup();
    const opened = spyOpen();
    openApp('/s/alpha');
    await user.keyboard('wj');
    expect(selectedPr()).toBe('willow#2102');
    await user.click(rowEl('beta'));
    expect(window.location.pathname).toBe('/s/beta');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('beta');
    const composer = screen.getByRole('textbox', { name: 'Message' });
    await user.click(composer);
    await user.keyboard('WHORjk whorjk');
    expect(composer).toHaveValue('WHORjk whorjk');
    expect(tab('Work')).toHaveAttribute('aria-selected', 'true');
    expect(selectedPr()).toBe('willow#2102');
    expect(opened).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.pathname).toBe('/s/beta');
  });
});

describe('Tasks (WORK-2)', () => {
  it('WORK-2.1: Tasks lists every Task the server read, in its order (most recently active first), as one listbox', async () => {
    const many = Array.from({ length: 30 }, (_, i) => task({ id: String(41_000_200 + i), title: `Polish lantern ${i + 1}`, lastActivityAt: Date.now() - i * 60_000 }));
    openApp('/', withTasks({ tasks: many }));
    await userEvent.setup().keyboard('w');
    expect(within(workPanel()).getAllByRole('listbox').map((l) => l.getAttribute('aria-label'))).toEqual(['Tasks', 'PRs']);
    expect(within(taskList()).getAllByRole('option').map((o) => o.getAttribute('data-task'))).toEqual(many.map((t) => t.id));
    expect(taskList()).toHaveAttribute('tabindex', '0');
    expect(tasksRegion().querySelector('[data-field="count"]')).toHaveTextContent(/^30 open$/);
    // An option holds nothing focusable or interactive, as a PR's doesn't.
    for (const o of within(taskList()).getAllByRole('option')) {
      expect(o.querySelectorAll('button, a, input, select, textarea, [tabindex], [role="button"], [role="link"]')).toHaveLength(0);
    }
  });

  it('WORK-2.2: each Task shows its title, project and status, its due date when set, and a milestone marked as one; a screen reader hears them as its name', async () => {
    const NEXT = task({ id: '41000103', title: 'Count the lamp oil', dueDate: `${YEAR + 1}-01-05` });
    const BARE = task({ id: '41000104', title: 'Sweep the pier', project: null, status: null, statusCategory: null });
    openApp('/', withTasks({ tasks: [LIGHT, BELLS, NEXT, BARE] }));
    await userEvent.setup().keyboard('w');
    const field = (id: string, name: string) => taskOption(id).querySelector(`[data-field="${name}"]`);
    expect(field('41000101', 'title')).toHaveTextContent('Light the harbor lanterns');
    expect(field('41000101', 'project')).toHaveTextContent('Lantern Works');
    expect(field('41000101', 'status')).toHaveTextContent('In progress');
    // No due date and no milestone: no line for them.
    expect(field('41000101', 'due')).toBeNull();
    expect(field('41000101', 'milestone')).toBeNull();
    expect(taskOption('41000101').children).toHaveLength(3); // the keys' description, the title line, project and status
    expect(field('41000102', 'milestone')).toHaveTextContent('milestone');
    expect(field('41000102', 'due')).toHaveTextContent(/^due Nov 4$/);
    expect(field('41000102', 'due')!.getAttribute('title')).toMatch(/^Due .*4/);
    // Another year's date says its year.
    expect(field('41000103', 'due')).toHaveTextContent(`due Jan 5, ${YEAR + 1}`);
    expect(field('41000103', 'milestone')).toBeNull();
    // What tb-prod didn't give is left out.
    expect(field('41000104', 'project')).toBeNull();
    expect(field('41000104', 'status')).toBeNull();
    expect(taskOption('41000104').children).toHaveLength(2);
    expect(taskOption('41000101')).toHaveAccessibleName('Light the harbor lanterns Lantern Works In progress');
    expect(taskOption('41000102')).toHaveAccessibleName('Tune the harbor bells Harbor Bells Not started milestone due Nov 4');
    expect(taskOption('41000104')).toHaveAccessibleName('Sweep the pier');
    expect(taskOption('41000102')).toHaveAccessibleDescription('S starts a Session on it, O opens it in Fantastic.');
  });

  it('WORK-2.3, WORK-3.4, WORK-4.5: Tasks and PRs show their links, with the source and Session reasons on hover', async () => {
    const linkedSession = (sessionId: string, reason: WorkSessionLink['reason'], over: Partial<WorkSessionLink> = {}): WorkSessionLink => ({
      sessionId,
      harness: 'claude',
      title: sessionId,
      createdAt: 100,
      modifiedAt: 100,
      live: false,
      reason,
      ...over,
    });
    const taskSession = linkedSession('task-start', 'started on this Task', { live: true, modifiedAt: 300 });
    const prSession = linkedSession('pr-start', 'through PR #2101', { live: true, modifiedAt: 200 });
    const linkedTask = task({
      ...LIGHT,
      links: {
        prs: [{ repo: 'anvil', number: 2101, url: DRAFT.url, chip: 'draft', ci: 'passing', sources: ['branch'] as PrTaskRef['source'][] }],
        sessions: [prSession, taskSession],
        incomplete: true,
      },
    });
    const linkedPr = {
      ...DRAFT,
      taskIds: [{ id: LIGHT.id, source: 'branch' } as PrTaskRef],
      links: {
        tasks: [{ id: LIGHT.id, title: LIGHT.title, sources: ['branch'] as PrTaskRef['source'][] }],
        sessions: [linkedSession('opener', 'probably opened this PR (the earliest Session that mentions it)')],
        incomplete: true,
      },
    };
    openApp('/s/alpha', withTasks({ tasks: [linkedTask] }, { mine: [linkedPr], reviewRequests: [] }));
    const user = userEvent.setup();
    await user.keyboard('w');

    const linkedPrLine = taskOption(LIGHT.id).querySelector('[data-field="linked-pr"]')!;
    expect(linkedPrLine).toHaveTextContent('#2101draft');
    expect(linkedPrLine.querySelector('[data-field="ci"]')).toHaveAttribute('data-ci', 'passing');
    expect(linkedPrLine).toHaveAttribute('title', 'branch');
    const taskMarker = taskOption(LIGHT.id).querySelector('[data-session-marker]')!;
    expect(taskMarker.querySelector('svg')).toHaveClass('text-ok-text');
    expect(taskMarker).toHaveAttribute('title', 'through PR #2101\nstarted on this Task\nLinks may be incomplete');
    expect(taskOption(LIGHT.id)).toHaveAttribute('title', 'Links may be incomplete');

    const linkedTaskLine = option('anvil#2101').querySelector('[data-field="linked-task"]')!;
    expect(linkedTaskLine).toHaveTextContent(LIGHT.title);
    expect(linkedTaskLine).toHaveAttribute('title', 'branch');
    const prMarker = option('anvil#2101').querySelector('[data-session-marker]')!;
    expect(prMarker).toHaveAttribute('title', 'probably opened this PR (the earliest Session that mentions it)\nLinks may be incomplete');

    // Clicking a marker acts on the row and opens its newest live Linked Session.
    await user.click(taskMarker);
    expect(window.location.pathname).toBe('/s/task-start');
  });

  it('WORK-4.1: an older tb-pr explains once that Task links need a newer tb-pr', async () => {
    openApp('/', snap({ taskIds: false }));
    await userEvent.setup().keyboard('w');
    expect(within(workPanel()).getAllByText('Task links need a newer tb-pr.')).toHaveLength(1);
    expect(within(workPanel()).getByRole('region', { name: 'PRs' }).querySelector('[data-field="task-link-version"]')).toBeInTheDocument();
  });

  it('WORK-7.4: a tb-session failure hides Session markers while keeping Task and PR links', async () => {
    const failed = withTasks({ tasks: [task({ ...LIGHT, links: { prs: [{ repo: 'anvil', number: 2101, url: DRAFT.url, chip: 'draft', ci: 'passing', sources: ['body'] }], sessions: [
      { sessionId: 'past', harness: 'claude', title: 'past', createdAt: 1, modifiedAt: 2, live: false, reason: 'started on this Task' },
    ], incomplete: false } })] }, { mine: [DRAFT], reviewRequests: [] });
    failed.sessionLinks = { state: 'error', reason: "tb-session couldn't search Sessions. Try Refresh later.", fix: null };
    openApp('/', failed);
    await userEvent.setup().keyboard('w');
    expect(workPanel().querySelectorAll('[data-session-marker]')).toHaveLength(0);
    expect(workPanel()).toHaveTextContent("Session links are unavailable. tb-session couldn't search Sessions. Try Refresh later.");
    expect(taskOption(LIGHT.id).querySelector('[data-field="linked-pr"]')).toHaveTextContent('#2101draft');
    expect(taskOption(LIGHT.id).querySelector('[data-field="linked-pr"] [data-field="ci"]')).toHaveAttribute('data-ci', 'passing');
  });

  it('WORK-1.7: Enter acts like a click when the selected Task has a Linked Session', async () => {
    const linked = task({
      ...LIGHT,
      links: {
        prs: [],
        sessions: [{ sessionId: 'linked-live', harness: 'claude', title: 'Linked session', createdAt: 100, modifiedAt: 200, live: true, reason: 'started on this Task' }],
        incomplete: false,
      },
    });
    openApp('/s/alpha', withTasks({ tasks: [linked] }));
    const user = userEvent.setup();
    await user.keyboard('w');
    await waitFor(() => expect(taskList()).toHaveFocus());
    await user.keyboard('{Enter}');
    expect(window.location.pathname).toBe('/s/linked-live');
  });

  it('WORK-3.4: after Fleet removes a live Session, the marker clears and the row resumes the latest past Session', async () => {
    const links = {
      tasks: [], incomplete: false,
      sessions: [
        { sessionId: 'vanished', harness: 'claude' as const, title: 'vanished', createdAt: 100, modifiedAt: 150, live: true, reason: 'started on this PR' as const },
        { sessionId: 'latest-past', harness: 'claude' as const, title: 'past', createdAt: 90, modifiedAt: 200, live: false, reason: 'started on this PR' as const },
      ],
    };
    const app = openApp('/s/alpha', snap({ mine: [pr({ ...DRAFT, links })] }), { resume: async () => ({ kind: 'live', sessionId: 'latest-past' }) });
    const user = userEvent.setup();
    await user.keyboard('w');
    const marker = () => option('anvil#2101').querySelector('[data-session-marker] svg');
    expect(marker()).toHaveClass('text-ok-text');
    app.emit({ type: 'work', work: snap({ mine: [pr({ ...DRAFT, links: { ...links, sessions: links.sessions.map((session) => ({ ...session, live: false })) } })] }) });
    await waitFor(() => expect(marker()).toHaveClass('text-muted-foreground'));
    await user.click(option('anvil#2101'));
    await waitFor(() => expect(app.client.resume).toHaveBeenCalledTimes(1));
    expect(vi.mocked(app.client.resume).mock.calls[0]?.[1]).toBe('latest-past');
  });

  it('Tasks says “Loading” until its first read for the saved email ends, and “No open tasks” only after a read that succeeded', async () => {
    const app = openApp('/', snap({}, {}, tasks({ state: 'loading', fetchedAt: null, tasks: [] })));
    await userEvent.setup().keyboard('w');
    expect(tasksRegion()).toHaveTextContent(/Tasks\s*· Loading…/);
    expect(within(tasksRegion()).queryByText('No open tasks')).toBeNull();
    expect(tasksRegion().querySelector('[data-field="count"]')).toBeNull();
    app.emit({ type: 'work', work: withTasks({ tasks: [] }) });
    expect(within(tasksRegion()).getByText('No open tasks')).toBeInTheDocument();
    expect(tasksRegion()).not.toHaveTextContent('Loading');
    expect(tasksRegion().querySelector('[data-field="count"]')).toHaveTextContent(/^0 open$/);
  });

  it('WORK-2.6: until an email is saved, Tasks says “Set your Productive email in Settings”, whose link opens Settings with Work still open; PRs works as usual', async () => {
    const user = userEvent.setup();
    openApp('/s/alpha');
    await user.keyboard('w');
    expect(tasksRegion().querySelector('[data-field="no-email"]')).toHaveTextContent(/^Set your Productive email in Settings$/);
    expect(within(tasksRegion()).queryByRole('listbox')).toBeNull();
    expect(within(tasksRegion()).queryByRole('alert')).toBeNull();
    expect(within(tasksRegion()).queryByText('No open tasks')).toBeNull();
    expect(shownRows()).toEqual(['anvil#2101', 'willow#2102', 'kettle#2103', 'willow#2106']);
    const link = within(tasksRegion()).getByRole('link', { name: 'Settings' });
    expect(link).toHaveAttribute('href', '/settings');
    await user.click(link);
    expect(window.location.pathname).toBe('/settings');
    expect(screen.getByLabelText('Productive email')).toBeInTheDocument();
    expect(tab('Work')).toHaveAttribute('aria-selected', 'true');
  });

  it('WORK-2.5 (support): while no email is saved, the field holds git’s address as an unsaved suggestion, and Save saves it', async () => {
    const user = userEvent.setup();
    const app = openApp('/settings', snap(), {}, settings({ productiveEmailSuggestion: 'lamplighter@example.com' }));
    const field = screen.getByLabelText('Productive email');
    const form = field.closest('form')!;
    expect(field).toHaveValue('lamplighter@example.com');
    expect(field).toHaveAccessibleDescription(/From your git config\. Not saved yet: press Save to use it\./);
    expect(app.saveSettings).not.toHaveBeenCalled();
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(app.saveSettings).toHaveBeenCalledWith({ productiveEmail: 'lamplighter@example.com' });
    // The server answered before its `settings` event: its answer counts, so "Saved" never sits beside "Not saved yet".
    await waitFor(() => expect(within(form).getByRole('status')).toHaveTextContent('Saved'));
    expect(field).toHaveValue('lamplighter@example.com');
    expect(screen.queryByText(/Not saved yet/)).toBeNull();
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('WORK-2.5 (support): a save’s answer is the tab’s settings at once, unless a settings event landed while it was pending', () => {
    const since = settings({ productiveEmailSuggestion: 'lamplighter@example.com' });
    const before = reducer(initialState, { type: 'event', event: { type: 'settings', settings: since } });
    const answer = settings({ productiveEmail: 'lamplighter@example.com', productiveEmailSuggestion: 'lamplighter@example.com' });
    expect(reducer(before, { type: 'settings-saved', since, settings: answer }).settings).toBe(answer);
    // Another tab's save landed meanwhile: its event, or a later one still to come, is as new, so the answer is dropped.
    const other = settings({ productiveEmail: 'keeper@example.com', productiveEmailSuggestion: 'lamplighter@example.com' });
    const moved = reducer(before, { type: 'event', event: { type: 'settings', settings: other } });
    expect(reducer(moved, { type: 'settings-saved', since, settings: answer })).toBe(moved);
  });

  it('WORK-2.5 (support): a saved email shows as saved, with no suggestion; without one from git, the field starts empty', async () => {
    const saved = openApp('/settings', snap(), {}, settings({ productiveEmail: 'keeper@example.com', productiveEmailSuggestion: 'lamplighter@example.com' }));
    expect(screen.getByLabelText('Productive email')).toHaveValue('keeper@example.com');
    expect(screen.queryByText(/From your git config/)).toBeNull();
    expect(within(screen.getByLabelText('Productive email').closest('form')!).getByRole('button', { name: 'Save' })).toBeDisabled();
    saved.unmount();
    openApp('/settings', snap(), {}, settings());
    expect(screen.getByLabelText('Productive email')).toHaveValue('');
    expect(screen.queryByText(/From your git config/)).toBeNull();
    expect(within(screen.getByLabelText('Productive email').closest('form')!).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('WORK-2.7: a refused email shows “Enter an email such as name@example.com”, keeps what was typed and the saved email; it’s saved trimmed', async () => {
    const user = userEvent.setup();
    const app = openApp('/settings', snap(), {}, settings({ productiveEmail: 'keeper@example.com' }));
    const field = screen.getByLabelText('Productive email');
    const save = within(field.closest('form')!).getByRole('button', { name: 'Save' });
    for (const typed of ['lamp lighter@example.com', 'lamplighter@example.com,keeper@example.com', 'lamp@lighter@example.com', '@example.com', 'lamplighter@', 'lamplighter', `${'a'.repeat(243)}@example.com`]) {
      await user.clear(field);
      await user.type(field, typed);
      await user.click(save);
      expect(screen.getByRole('alert'), typed).toHaveTextContent(PRODUCTIVE_EMAIL_ERROR);
      expect(field, typed).toHaveValue(typed);
      expect(field, typed).toHaveAttribute('aria-invalid', 'true');
    }
    expect(app.saveSettings).not.toHaveBeenCalled();
    // Trimmed, otherwise as typed.
    await user.clear(field);
    await user.type(field, '  Lamp.Lighter+work@example.com ');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(save);
    expect(app.saveSettings).toHaveBeenCalledWith({ productiveEmail: 'Lamp.Lighter+work@example.com' });
  });

  it('WORK-2.7: a value the server refuses shows its words, and the saved email stays', async () => {
    const user = userEvent.setup();
    const app = openApp('/settings', snap(), { saveSettings: async () => Promise.reject(new SaveError(PRODUCTIVE_EMAIL_ERROR, 'productiveEmail', 400)) }, settings({ productiveEmail: 'keeper@example.com' }));
    const field = screen.getByLabelText('Productive email');
    await user.clear(field);
    await user.type(field, 'other@example.com');
    await user.click(within(field.closest('form')!).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(PRODUCTIVE_EMAIL_ERROR);
    expect(field).toHaveValue('other@example.com');
    expect(app.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('WORK-2.7: saving an empty field clears the email, and Tasks goes back to “Set your Productive email”; git’s address shows again as a suggestion', async () => {
    const user = userEvent.setup();
    const app = openApp('/settings', withTasks(), {}, settings({ productiveEmail: 'keeper@example.com', productiveEmailSuggestion: 'lamplighter@example.com' }));
    await user.click(screen.getByRole('button', { name: 'Work' }));
    expect(within(tasksRegion()).getAllByRole('option')).toHaveLength(2);
    const field = screen.getByLabelText('Productive email');
    const form = field.closest('form')!;
    await user.clear(field);
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(app.saveSettings).toHaveBeenCalledWith({ productiveEmail: null });
    // "Cleared", never "Saved" beside git's address, which isn't saved: before the server's event and after it.
    await waitFor(() => expect(within(form).getByRole('status')).toHaveTextContent('Cleared'));
    expect(field).toHaveValue('lamplighter@example.com');
    // The server says so: the settings without an email, and Tasks as no-email (both tested on the server).
    app.emit({ type: 'settings', settings: settings({ productiveEmail: null, productiveEmailSuggestion: 'lamplighter@example.com' }) });
    app.emit({ type: 'work', work: snap() });
    expect(tasksRegion().querySelector('[data-field="no-email"]')).toHaveTextContent('Set your Productive email in Settings');
    expect(within(tasksRegion()).queryByRole('option')).toBeNull();
    expect(field).toHaveValue('lamplighter@example.com');
    expect(screen.getByText('From your git config. Not saved yet: press Save to use it.')).toBeInTheDocument();
    expect(within(form).getByRole('status')).toHaveTextContent('Cleared');
    expect(within(form).queryByText('Saved')).toBeNull();
  });

  it('WORK-2.8 (support): after a different email is saved, Tasks shows “Loading” without the previous list, then the new email’s Tasks', async () => {
    const user = userEvent.setup();
    const app = openApp('/', withTasks());
    await user.keyboard('w');
    expect(within(tasksRegion()).getAllByRole('option')).toHaveLength(2);
    // The server dropped the list for the new email (tested there): Loading, no rows, no count.
    app.emit({ type: 'work', work: snap({}, {}, tasks({ state: 'loading', fetchedAt: null, tasks: [] })) });
    expect(tasksRegion()).toHaveTextContent(/Loading…/);
    expect(within(tasksRegion()).queryByRole('option')).toBeNull();
    expect(tasksRegion().querySelector('[data-field="count"]')).toBeNull();
    const NEW = task({ id: '41000301', title: 'Ring the fog bell' });
    app.emit({ type: 'work', work: withTasks({ tasks: [NEW] }) });
    expect(shownRows()[0]).toBe('41000301');
  });
});

describe('PRs (WORK-3)', () => {
  it('WORK-3.1: Mine and Review requests, each in the order the server sorted them (most urgent first)', async () => {
    openApp('/', snap({ mine: [READY, DRAFT, APPROVED] }));
    await userEvent.setup().keyboard('w');
    expect(within(group('Mine')).getAllByRole('option').map((o) => o.getAttribute('data-pr'))).toEqual(['willow#2102', 'anvil#2101', 'kettle#2103']);
    expect(within(group('Review requests')).getAllByRole('option').map((o) => o.getAttribute('data-pr'))).toEqual(['willow#2106']);
    expect(within(listbox()).getAllByRole('group').map((g) => g.getAttribute('data-group'))).toEqual(['mine', 'reviewRequests']);
  });

  it('WORK-3.1: one focusable listbox, as History has, with a group per PR group; an option holds nothing focusable or interactive', async () => {
    openApp();
    await userEvent.setup().keyboard('w');
    expect(within(workPanel()).getAllByRole('listbox')).toHaveLength(1);
    expect(listbox()).toHaveAttribute('tabindex', '0');
    expect(listbox()).toHaveAttribute('aria-activedescendant', option('anvil#2101').id);
    for (const o of options()) {
      expect(o.querySelectorAll('button, a, input, select, textarea, [tabindex], [role="button"], [role="link"]'), o.getAttribute('data-pr')!).toHaveLength(0);
    }
    // Each row says which keys act on it.
    expect(option('anvil#2101')).toHaveAccessibleDescription('O opens it on GitHub.');
    expect(option('willow#2106')).toHaveAccessibleDescription('R reviews it, O opens it on GitHub.');
  });

  it('WORK-3.2: each PR shows its repo, number, title, age and CI; Mine’s have a state chip', async () => {
    openApp('/', snap({ reviewRequests: [{ ...REVIEW, createdAt: null, ageDays: 3.6 }] }));
    await userEvent.setup().keyboard('w');
    const field = (id: string, name: string) => option(id).querySelector(`[data-field="${name}"]`);
    expect(field('anvil#2101', 'repo')).toHaveTextContent('anvil');
    expect(field('anvil#2101', 'number')).toHaveTextContent('#2101');
    expect(field('anvil#2101', 'title')).toHaveTextContent('Sharpen the anvil corners');
    expect(field('anvil#2101', 'age')).toHaveTextContent('2d');
    expect(field('willow#2102', 'age')).toHaveTextContent('6d');
    // Without a creation time, tb-pr's age in days, in the same format.
    expect(field('willow#2106', 'age')).toHaveTextContent(/^3d$/);
    expect(field('anvil#2101', 'chip')).toHaveTextContent('draft');
    expect(field('willow#2102', 'chip')).toHaveTextContent('ready');
    expect(field('kettle#2103', 'chip')).toHaveTextContent('approved');
    expect(field('willow#2106', 'chip')).toBeNull();
    expect(within(workPanel()).getAllByRole('img').map((i) => i.getAttribute('aria-label'))).toEqual(['CI passing', 'CI failing', 'no CI', 'no CI']);
  });

  it('WORK-3.2: a screen reader hears each row’s repo, number, chip, CI, age and title as its name, and the keys that act on it as its description', async () => {
    openApp('/', snap({ reviewRequests: [{ ...REVIEW, createdAt: null, ageDays: 3.6 }] }));
    await userEvent.setup().keyboard('w');
    const names = [
      'anvil #2101 draft CI passing 2d Sharpen the anvil corners',
      'willow #2102 ready CI failing 6d Hang the willow lanterns',
      'kettle #2103 approved no CI 2d Draft the kettle manual',
    ];
    const mine = within(group('Mine')).getAllByRole('option');
    expect(mine).toHaveLength(names.length);
    mine.forEach((o, i) => expect(o).toHaveAccessibleName(names[i]));
    // Found by what it says, as a screen reader user would.
    const review = within(group('Review requests')).getByRole('option', { name: 'willow #2106 no CI 3d Count the willow leaves' });
    expect(review).toHaveAccessibleDescription('R reviews it, O opens it on GitHub.');
    // The row's own buttons and their keys aren't part of its name.
    expect(review).not.toHaveAccessibleName(/Review|Open|GitHub/);
  });

  it('WORK-3.2: CI running shows as running', async () => {
    openApp('/', snap({ mine: [{ ...DRAFT, ci: 'running' }], reviewRequests: [] }));
    await userEvent.setup().keyboard('w');
    expect(within(workPanel()).getByRole('img', { name: 'CI running' })).toHaveAttribute('data-ci', 'running');
  });

  it('WORK-3.3: "no CI" never looks like passing; a Review request shows its real CI once tb-pr gives one', async () => {
    const app = openApp();
    await userEvent.setup().keyboard('w');
    const ci = () => within(group('Review requests')).getByRole('img');
    expect(ci()).toHaveAccessibleName('no CI');
    expect(ci()).toHaveTextContent('no CI');
    expect(ci().querySelector('svg')).not.toHaveClass('text-ok');
    const passing = within(group('Mine')).getByRole('img', { name: 'CI passing' });
    expect(passing).not.toHaveTextContent('no CI');
    expect(passing.querySelector('svg')).toHaveClass('text-ok');
    // Gap 1: tb-pr gives Review requests their CI state.
    app.emit({ type: 'work', work: snap({ reviewRequests: [{ ...REVIEW, ci: 'passing' }] }) });
    expect(ci()).toHaveAccessibleName('CI passing');
    expect(ci()).not.toHaveTextContent('no CI');
  });

  it('WORK-3.5: a PR’s age reads green under 3 days, amber from 3 to 10 days, red over 10, in both groups, keeping its text and hover; without an opening time it stays muted', async () => {
    const DAY = 86_400_000;
    const MIN = 60_000;
    expect([0, 3 * DAY - 1, 3 * DAY, 10 * DAY, 10 * DAY + 1].map(ageLevel)).toEqual(['recent', 'recent', 'aging', 'aging', 'old']);
    const opened = (number: number, ago: number, over: Partial<WorkPr> = {}) => pr({ repo: 'anvil', number, createdAt: Date.now() - ago, ...over });
    const review = (number: number, ago: number) => opened(number, ago, { chip: null, column: 'waiting_on_me' });
    const edges = [3 * DAY - MIN, 3 * DAY + MIN, 10 * DAY - MIN, 10 * DAY + MIN];
    openApp(
      '/',
      snap({
        mine: [...edges.map((ago, i) => opened(3101 + i, ago)), opened(3105, 0, { createdAt: null, ageDays: 12 })],
        reviewRequests: edges.map((ago, i) => review(3111 + i, ago)),
      }),
    );
    await userEvent.setup().keyboard('w');
    const colours = ['text-ok-text', 'text-needs-you-text', 'text-destructive-text', 'text-muted-foreground'];
    const age = (number: number) => option(`anvil#${number}`).querySelector('[data-field="age"]')!;
    const cases = [
      [3101, '2d', 'recent', 'text-ok-text'],
      [3102, '3d', 'aging', 'text-needs-you-text'],
      [3103, '9d', 'aging', 'text-needs-you-text'],
      [3104, '10d', 'old', 'text-destructive-text'],
      [3111, '2d', 'recent', 'text-ok-text'],
      [3112, '3d', 'aging', 'text-needs-you-text'],
      [3113, '9d', 'aging', 'text-needs-you-text'],
      [3114, '10d', 'old', 'text-destructive-text'],
    ] as const;
    for (const [number, text, level, cls] of cases) {
      expect(age(number), `#${number}`).toHaveTextContent(new RegExp(`^${text}$`));
      expect(age(number), `#${number}`).toHaveAttribute('data-level', level);
      for (const c of colours) expect(age(number).classList.contains(c), `#${number} ${c}`).toBe(c === cls);
      expect(age(number).getAttribute('title'), `#${number}`).toMatch(/^Opened /);
    }
    // The age is still in the row's name: colour is never the only cue.
    expect(option('anvil#3104')).toHaveAccessibleName(/ 10d /);
    // Without an opening time: tb-pr's days, muted as before, with no hover.
    expect(age(3105)).toHaveTextContent(/^12d$/);
    expect(age(3105)).not.toHaveAttribute('data-level');
    for (const c of colours) expect(age(3105).classList.contains(c), c).toBe(c === 'text-muted-foreground');
    expect(age(3105)).not.toHaveAttribute('title');
  });

  it('No open PRs or review requests, when both groups are empty', async () => {
    openApp('/', snap({ mine: [], reviewRequests: [] }));
    await userEvent.setup().keyboard('w');
    expect(within(workPanel()).getByText('No open PRs or review requests')).toBeInTheDocument();
  });
});

describe('actions (WORK-5, WORK-6)', () => {
  it('WORK-5.2: Review on a Review request opens the launcher with /p-codex:dual-review <PR URL> and nothing else; nothing starts', async () => {
    const user = userEvent.setup();
    const app = openApp();
    await user.keyboard('w');
    // Only Review requests have it.
    expect(rowButton('anvil#2101', 'review')).toBeNull();
    expect(rowButton('willow#2106', 'review')).toHaveAttribute('title', 'Review (R)');
    await user.click(rowButton('willow#2106', 'review')!);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Prompt')).toHaveValue('/p-codex:dual-review https://github.com/productiveio/willow/pull/2106');
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(app.client.launch).not.toHaveBeenCalled();
    // The row it acted on is selected.
    expect(selectedPr()).toBe('willow#2106');
  });

  it('WORK-5.2: Review always starts Claude Code, its prompt being a Claude Code plugin command, even when Codex was started last', async () => {
    const user = userEvent.setup();
    openApp('/', snap(), {}, settings({ lastLaunch: { harness: 'codex', model: 'gpt-6-astra', directory: '~/Projects/work' } }));
    await user.keyboard('w');
    await user.click(rowButton('willow#2106', 'review')!);
    await screen.findByRole('dialog');
    expect(await screen.findByRole('radio', { name: /Claude Code/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Codex/ })).not.toBeChecked();
    // Codex's model doesn't carry over: Claude Code's default.
    expect(screen.getByLabelText('Model')).toHaveValue('');
  });

  it('WORK-5.2: after a Claude Code start, Review keeps its model', async () => {
    const user = userEvent.setup();
    openApp('/', snap(), {}, settings({ lastLaunch: { harness: 'claude', model: 'claude-opus-5-5', directory: '~/Projects/work' } }));
    await user.keyboard('w');
    await user.click(rowButton('willow#2106', 'review')!);
    expect(await screen.findByRole('radio', { name: /Claude Code/ })).toBeChecked();
    await waitFor(() => expect(screen.getByLabelText('Model')).toHaveValue('claude-opus-5-5'));
  });

  it('WORK-5.2: R reviews the selected Review request, with Caps Lock too; on a PR of yours, with Shift or a modifier, or as a held key’s repeat it does nothing', async () => {
    const user = userEvent.setup();
    openApp('/s/alpha');
    await user.keyboard('w');
    await user.keyboard('r');
    expect(screen.queryByRole('dialog')).toBeNull(); // anvil#2101 is in Mine
    await user.keyboard('jjj');
    expect(selectedPr()).toBe('willow#2106');
    await user.keyboard('{Shift>}r{/Shift}');
    fireEvent.keyDown(listbox(), { key: 'r', metaKey: true });
    // A held key's repeats aren't presses.
    fireEvent.keyDown(listbox(), { key: 'r', repeat: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Caps Lock: the key is "R" without Shift.
    fireEvent.keyDown(listbox(), { key: 'R' });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Prompt')).toHaveValue('/p-codex:dual-review https://github.com/productiveio/willow/pull/2106');
    expect(selectedPr()).toBe('willow#2106');
    expect(window.location.pathname).toBe('/s/alpha');
  });

  it('WORK-6.1: every Task, PR and Review request row has an Open in browser button, its tooltip naming it and O; it opens the row in a new tab', async () => {
    const opened = spyOpen();
    const user = userEvent.setup();
    openApp('/', withTasks());
    await user.keyboard('w');
    const buttons = options().map((o) => o.querySelector<HTMLElement>('[data-action="open"]')!);
    expect(buttons).toHaveLength(6);
    expect(buttons.map((b) => b.getAttribute('title'))).toEqual([
      'Open in Fantastic (O)',
      'Open in Fantastic (O)',
      'Open on GitHub (O)',
      'Open on GitHub (O)',
      'Open on GitHub (O)',
      'Open on GitHub (O)',
    ]);
    await user.click(buttons[5]!);
    expect(opened).toEqual([[REVIEW.url, '_blank', 'noopener,noreferrer']]);
    await user.click(buttons[1]!);
    expect(opened.at(-1)).toEqual([BELLS.url, '_blank', 'noopener,noreferrer']);
    expect(selectedRow()).toBe('41000102');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('WORK-6.2 (support): a Task opens its Fantastic URL from the server, never the old app', async () => {
    const opened = spyOpen();
    const user = userEvent.setup();
    openApp('/', withTasks());
    await user.keyboard('w');
    await user.click(taskButton('41000101', 'open')!);
    expect(opened).toEqual([['https://app.fantastic.productive.io/109-productive/tasks/41000101', '_blank', 'noopener,noreferrer']]);
    expect(opened[0]![0]).not.toMatch(/app\.productive\.io/);
  });

  it('WORK-6.4: O on a selected Task opens it in Fantastic, as its button does, moving nothing', async () => {
    const user = userEvent.setup();
    const opened = spyOpen();
    openApp('/s/alpha', withTasks());
    await user.keyboard('wj');
    expect(selectedRow()).toBe('41000102');
    await user.keyboard('o');
    expect(opened).toEqual([[BELLS.url, '_blank', 'noopener,noreferrer']]);
    expect(selectedRow()).toBe('41000102');
    expect(window.location.pathname).toBe('/s/alpha');
    expect(screen.queryByRole('dialog')).toBeNull();
    // R does nothing on a Task.
    await user.keyboard('r');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('WORK-5.1: Start Session on a Task opens the launcher with the Task’s URL as the prompt and nothing else, on the last start’s choices; Start sends that prompt', async () => {
    const user = userEvent.setup();
    const app = openApp('/', withTasks(), {}, settings({ lastLaunch: { harness: 'codex', model: 'gpt-6-astra', directory: '~/Projects/work' } }));
    await user.keyboard('w');
    expect(taskButton('41000101', 'start')).toHaveAttribute('title', 'Start Session (S)');
    // A PR row has no Start Session.
    expect(option('anvil#2101').querySelector('[data-action="start"]')).toBeNull();
    await user.click(taskButton('41000102', 'start')!);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Prompt')).toHaveValue(BELLS.url);
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(await screen.findByRole('radio', { name: /Codex/ })).toBeChecked();
    expect(selectedRow()).toBe('41000102');
    expect(app.client.launch).not.toHaveBeenCalled();
    // Editable before Start; Start sends what's there.
    await user.type(screen.getByLabelText('Prompt'), ' then plan it');
    await waitFor(() => expect(screen.getByRole('button', { name: /Start/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Start/ }));
    expect(app.client.launch).toHaveBeenCalledWith(
      { directory: '~/Projects/work', harness: 'codex', model: 'gpt-6-astra', name: '', prompt: `${BELLS.url} then plan it` },
      expect.any(String),
    );
    // A start selects the new Session's row: focus isn't taken back to Work.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await new Promise((r) => setTimeout(r, 10));
    expect(taskList()).not.toHaveFocus();
  });

  it('WORK-5.1: S starts a Session on the selected Task as Start Session does, with Caps Lock too; on a PR, with Shift or a modifier, or as a held key’s repeat it does nothing', async () => {
    const user = userEvent.setup();
    const app = openApp('/s/alpha', withTasks());
    await user.keyboard('w');
    await waitFor(() => expect(taskList()).toHaveFocus());
    await user.keyboard('jj');
    expect(selectedRow()).toBe('anvil#2101');
    await user.keyboard('s');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.keyboard('k');
    expect(selectedRow()).toBe('41000102');
    expect(taskOption('41000102')).toHaveAccessibleDescription('S starts a Session on it, O opens it in Fantastic.');
    await user.keyboard('{Shift>}s{/Shift}');
    fireEvent.keyDown(taskList(), { key: 's', metaKey: true });
    fireEvent.keyDown(taskList(), { key: 's', ctrlKey: true });
    // A held key's repeats aren't presses.
    fireEvent.keyDown(taskList(), { key: 's', repeat: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Caps Lock: the key is "S" without Shift.
    fireEvent.keyDown(taskList(), { key: 'S' });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Prompt')).toHaveValue(BELLS.url);
    expect(selectedRow()).toBe('41000102');
    expect(window.location.pathname).toBe('/s/alpha');
    // Under the launcher, Work's keys stand down.
    fireEvent.keyDown(taskList(), { key: 's' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(app.client.launch).not.toHaveBeenCalled();
  });

  it('WORK-6.4: O opens the selected row as its button does, moving nothing; with Caps Lock too; once while held; not with Shift or a modifier, not in a text field, not under a modal', async () => {
    const user = userEvent.setup();
    const opened = spyOpen();
    openApp('/s/alpha');
    await user.keyboard('wjjj');
    expect(selectedPr()).toBe('willow#2106');
    await user.keyboard('o');
    expect(opened).toEqual([[REVIEW.url, '_blank', 'noopener,noreferrer']]);
    expect(selectedPr()).toBe('willow#2106');
    expect(window.location.pathname).toBe('/s/alpha');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.keyboard('{Shift>}o{/Shift}{Meta>}o{/Meta}');
    expect(opened).toHaveLength(1);
    // Caps Lock: the key is "O" without Shift.
    fireEvent.keyDown(listbox(), { key: 'O' });
    expect(opened).toHaveLength(2);
    // Held down: one tab, not one per repeat.
    fireEvent.keyDown(listbox(), { key: 'o', repeat: true });
    fireEvent.keyDown(listbox(), { key: 'o', repeat: true });
    expect(opened).toHaveLength(2);
    // Under a modal: the launcher's own text field has focus, and O is text there.
    await user.keyboard('r');
    await screen.findByRole('dialog');
    fireEvent.keyDown(listbox(), { key: 'o' });
    expect(opened).toHaveLength(2);
  });
});

describe('when tb-prod can’t be read (WORK-7)', () => {
  const failedTasks = (over: Partial<TaskSection>) => snap({}, {}, tasks({ fetchedAt: null, tasks: [], ...over }));

  it('WORK-7.1 (support): tb-prod not installed: the Tasks section says so and gives the command that builds it from cli-toolbox’s main; PRs works as usual', async () => {
    openApp('/', failedTasks({ state: 'not-installed', reason: "tb-prod isn't installed.", fix: TB_PROD_INSTALL_COMMAND }));
    await userEvent.setup().keyboard('w');
    const alert = within(tasksRegion()).getByRole('alert');
    expect(alert).toHaveTextContent("tb-prod isn't installed");
    expect(alert).toHaveTextContent("Work reads your Tasks through tb-prod. Build it from cli-toolbox's main, then press Refresh:");
    expect(within(alert).getByText(TB_PROD_INSTALL_COMMAND)).toBeInTheDocument();
    expect(within(tasksRegion()).queryByText('No open tasks')).toBeNull();
    expect(shownRows()).toEqual(['anvil#2101', 'willow#2102', 'kettle#2103', 'willow#2106']);
  });

  it('WORK-7.2 (support): tb-prod not signed in: the Tasks section says so once and shows tb-prod config init', async () => {
    openApp('/', failedTasks({ state: 'signed-out', reason: "tb-prod isn't signed in to Productive. Run tb-prod config init, then press Refresh.", fix: TB_PROD_SIGN_IN_COMMAND }));
    await userEvent.setup().keyboard('w');
    const alert = within(tasksRegion()).getByRole('alert');
    expect(alert).toHaveTextContent("tb-prod isn't signed in to Productive");
    expect(alert.textContent!.match(/signed in/g)).toHaveLength(1);
    expect(alert).toHaveTextContent('Run this, then press Refresh:');
    expect(within(alert).getByText('tb-prod config init')).toBeInTheDocument();
  });

  it('WORK-7.3 (support): a failed Tasks read keeps the last list, marked old, with the plain reason; without a list, the reason alone', async () => {
    const app = openApp('/', withTasks());
    await userEvent.setup().keyboard('w');
    expect(tasksRegion().querySelector('[data-field="old"]')).toBeNull();
    const reason = "Productive denied access to your Tasks. Check what tb-prod's token's account can see, then press Refresh.";
    app.emit({ type: 'work', work: withTasks({ state: 'error', reason, stale: true }) });
    expect(tasksRegion().querySelector('[data-field="old"]')).toHaveTextContent('old');
    const alert = within(tasksRegion()).getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't update Tasks");
    expect(alert).toHaveTextContent(reason);
    expect(alert).toHaveTextContent('Showing the last list, from 2m ago.');
    expect(within(tasksRegion()).getAllByRole('option')).toHaveLength(2);
    app.emit({ type: 'work', work: failedTasks({ state: 'error', reason }) });
    expect(within(tasksRegion()).getByRole('alert')).toHaveTextContent("Couldn't read Tasks");
    expect(tasksRegion().querySelector('[data-field="old"]')).toBeNull();
    expect(within(tasksRegion()).queryByRole('option')).toBeNull();
    expect(within(tasksRegion()).queryByText('No open tasks')).toBeNull();
  });

  it('WORK-7.8: a tb-prod older than 1.2.0 says so, with the command that builds it from cli-toolbox’s main', async () => {
    const reason = "tb-prod is older than 1.2.0, which Work needs to read Tasks. Build it from cli-toolbox's main, then press Refresh.";
    openApp('/', failedTasks({ state: 'error', reason, fix: TB_PROD_INSTALL_COMMAND }));
    await userEvent.setup().keyboard('w');
    const alert = within(tasksRegion()).getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't read Tasks");
    expect(alert.querySelector('[data-field="reason"]')).toHaveTextContent(reason);
    expect(within(alert).getByText(TB_PROD_INSTALL_COMMAND)).toBeInTheDocument();
  });
});

describe('when tb-pr can’t be read (WORK-7)', () => {
  it('WORK-7.1 (support): tb-pr not installed: the PRs section says so and how to install it', async () => {
    openApp('/', snap({ state: 'not-installed', reason: "tb-pr isn't installed. Install it, then press Refresh.", fix: 'install tb-pr', fetchedAt: null, mine: [], reviewRequests: [] }));
    await userEvent.setup().keyboard('w');
    const alert = within(workPanel()).getByRole('alert');
    expect(alert).toHaveTextContent("tb-pr isn't installed");
    expect(alert).toHaveTextContent('Work reads your PRs through tb-pr. Install it, then press Refresh:');
    expect(alert).toHaveTextContent('install tb-pr');
    expect(within(workPanel()).queryByText('No open PRs or review requests')).toBeNull();
  });

  it('WORK-7.2 (support): tb-pr not signed in: the PRs section says so once and shows gh auth login', async () => {
    const reason = "tb-pr isn't signed in to GitHub. Run gh auth login, then press Refresh.";
    openApp('/', snap({ state: 'signed-out', reason, fix: 'gh auth login', fetchedAt: null, mine: [], reviewRequests: [] }));
    await userEvent.setup().keyboard('w');
    const alert = within(workPanel()).getByRole('alert');
    expect(alert).toHaveTextContent("tb-pr isn't signed in to GitHub");
    expect(alert.textContent!.match(/signed in/g)).toHaveLength(1);
    expect(alert).toHaveTextContent('Run this, then press Refresh:');
    expect(within(alert).getByText('gh auth login')).toBeInTheDocument();
  });

  it('WORK-7.3 (support): a failed read keeps the last list, marked old, with the plain reason; never as current', async () => {
    const app = openApp();
    await userEvent.setup().keyboard('w');
    const section = () => within(workPanel()).getByRole('region', { name: 'PRs' });
    expect(section().querySelector('[data-field="old"]')).toBeNull();
    const reason = 'tb-pr took too long to answer. Try Refresh later.';
    app.emit({ type: 'work', work: snap({ state: 'error', reason, stale: true }) });
    expect(section().querySelector('[data-field="old"]')).toHaveTextContent('old');
    expect(within(section()).getByRole('alert')).toHaveTextContent("Couldn't update PRs");
    expect(within(section()).getByRole('alert')).toHaveTextContent(reason);
    expect(within(section()).getByRole('alert')).toHaveTextContent('Showing the last list, from 2m ago.');
    expect(shown()).toEqual(['anvil#2101', 'willow#2102', 'kettle#2103', 'willow#2106']);
    // A failure with no earlier list: the reason, without a list.
    app.emit({ type: 'work', work: snap({ state: 'error', reason, stale: false, fetchedAt: null, mine: [], reviewRequests: [] }) });
    expect(within(section()).getByRole('alert')).toHaveTextContent("Couldn't read PRs");
    expect(within(workPanel()).queryByText('No open PRs or review requests')).toBeNull();
  });

  it('WORK-8.4 (support): a rate-limited read says when GitHub’s limit frees up', async () => {
    const reason = "GitHub's rate limit is used up. Work reads PRs again when it frees up.";
    openApp('/', snap({ state: 'error', reason, stale: true }, { githubBlockedUntil: Date.now() + 37 * 60_000 }));
    await userEvent.setup().keyboard('w');
    expect(within(workPanel()).getByRole('alert').querySelector('[data-field="reason"]')).toHaveTextContent(/^GitHub's rate limit is used up\. Work reads PRs again when it frees up\. That's in 3[67]m\.$/);
  });

  it('WORK-7.5: a group with a column issue is marked possibly out of date, each column by its chip with its reason in plain words and its time', async () => {
    const now = Date.now();
    const mine: ColumnMark[] = [
      { columns: ['draft_mine'], reason: "GitHub's search came back empty", confirmedAt: now - 40 * 60_000 },
      { columns: ['review_mine', 'ready_to_merge_mine'], reason: "GitHub's rate limit is used up", confirmedAt: null },
    ];
    openApp('/', snap({ marks: { mine, reviewRequests: [] } }));
    await userEvent.setup().keyboard('w');
    const marks = group('Mine').querySelectorAll('[data-field="mark"]');
    expect([...marks].map((m) => m.textContent)).toEqual([
      "draft: GitHub's search came back empty, last confirmed 40m ago.",
      "ready, approved: GitHub's rate limit is used up, not confirmed yet.",
    ]);
    expect(group('Mine')).toHaveAccessibleDescription(/^Possibly out of date\. draft: GitHub's search came back empty/);
    expect(group('Review requests').querySelector('[data-field="marks"]')).toBeNull();
  });

  it('WORK-7.5: Review requests’ mark doesn’t repeat the group’s name; an empty group with an issue still shows, with its mark', async () => {
    openApp('/', snap({ reviewRequests: [], marks: { mine: [], reviewRequests: [{ columns: ['waiting_on_me'], reason: "GitHub's rate limit is used up", confirmedAt: Date.now() - 45_000 }] } }));
    await userEvent.setup().keyboard('w');
    const marks = group('Review requests').querySelector('[data-field="marks"]')!;
    expect(marks).toHaveTextContent("Possibly out of date. GitHub's rate limit is used up, last confirmed 45s ago.");
    expect(marks.textContent).not.toMatch(/review requests/i);
  });
});

describe('Refresh (WORK-8)', () => {
  it('WORK-8.1 (support): the tab tells the server it has Work open only while Work is the tab showing', async () => {
    const user = userEvent.setup();
    const app = openApp();
    const watched = () => vi.mocked(app.client.watchWork).mock.calls.at(-1);
    expect(watched()).toEqual(['tab-1', false]);
    await user.keyboard('w');
    expect(watched()).toEqual(['tab-1', true]);
    await user.click(tab('History'));
    expect(watched()).toEqual(['tab-1', false]);
    await user.click(tab('Work'));
    expect(watched()).toEqual(['tab-1', true]);
    await user.click(screen.getByRole('button', { name: 'Close Work' }));
    expect(watched()).toEqual(['tab-1', false]);
    // A new event stream says it again under its own id.
    await user.keyboard('w');
    app.emit({ type: 'snapshot', sessions: [], fleet: { state: 'ok' }, settings: settings(), launches: [], started: [], clientId: 'tab-2', usage: null });
    expect(watched()).toEqual(['tab-2', true]);
  });

  it('WORK-8.2 (support): Refresh asks for a forced read; during the cooldown it is disabled and says when it’s back', async () => {
    const user = userEvent.setup();
    const app = openApp();
    await user.keyboard('w');
    const refresh = () => screen.getByRole('button', { name: 'Refresh' });
    expect(refresh()).toHaveAttribute('title', 'Refresh');
    await user.click(refresh());
    expect(app.client.refreshWork).toHaveBeenCalledTimes(1);
    app.emit({ type: 'work', work: snap({}, { cooldownUntil: Date.now() + 42_000 }) });
    await waitFor(() => expect(refresh()).toHaveAttribute('aria-disabled', 'true'));
    expect(refresh().getAttribute('title')).toMatch(/^Refresh was used less than a minute ago: it's back in 4[1-3]s$/);
    await user.click(refresh());
    expect(app.client.refreshWork).toHaveBeenCalledTimes(1);
    // History has no Refresh.
    await user.click(tab('History'));
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it('WORK-8.2 (support): a Refresh the server refuses with 409, or fails with 500 or never answers, says so in plain words until the next press', async () => {
    const user = userEvent.setup();
    const answers = [new SaveError(REFRESH_NOT_WATCHED, null, 409), new SaveError(REFRESH_FAILED, null, 500), new SaveError("Couldn't reach the Lookout server.", null, null, { lost: true })];
    const app = openApp('/', snap(), {
      refreshWork: async () => {
        const next = answers.shift();
        if (next) throw next;
        return { ok: true };
      },
    });
    await user.keyboard('w');
    const refresh = () => screen.getByRole('button', { name: 'Refresh' });
    const problem = () => within(screen.getByRole('tabpanel', { name: 'Work' })).queryByRole('alert');
    expect(problem()).toBeNull();
    for (const said of [REFRESH_NOT_WATCHED, REFRESH_FAILED, "Couldn't reach the Lookout server."]) {
      await user.click(refresh());
      await waitFor(() => expect(problem()).toHaveTextContent(said));
      expect(refresh()).not.toHaveAttribute('aria-disabled');
    }
    // The next press clears it, and one that ran says nothing here: its outcome is in the PRs section.
    await user.click(refresh());
    await waitFor(() => expect(app.client.refreshWork).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(problem()).toBeNull());
  });

  it('WORK-8.4: while GitHub is rate limited, Refresh is disabled and says when it’s back', async () => {
    const user = userEvent.setup();
    const app = openApp('/', snap({}, { cooldownUntil: Date.now() + 30_000, githubBlockedUntil: Date.now() + 5 * 60_000 }));
    await user.keyboard('w');
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    expect(refresh).toHaveAttribute('aria-disabled', 'true');
    expect(refresh).toHaveAttribute('title', 'GitHub is rate limited: Refresh is back in 5m');
    await user.click(refresh);
    expect(app.client.refreshWork).not.toHaveBeenCalled();
  });
});
