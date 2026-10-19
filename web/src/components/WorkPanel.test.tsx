import type { HistoryItem } from '@shared/types.ts';
import type { ColumnMark, PrSection, WorkPr, WorkSnapshot } from '@shared/work.ts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REFRESH_FAILED, REFRESH_NOT_WATCHED, SaveError } from '@/lib/client';
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

const snap = (p: Partial<PrSection> = {}, refresh: Partial<WorkSnapshot['refresh']> = {}): WorkSnapshot => ({
  prs: prs(p),
  refresh: { cooldownUntil: null, githubBlockedUntil: null, ...refresh },
});

const workPanel = () => screen.getByTestId('work-panel');
const tab = (name: 'History' | 'Work') => screen.getByRole('tab', { name });
const listbox = () => within(workPanel()).getByRole('listbox', { name: 'PRs and review requests', hidden: true });
const options = () => within(workPanel()).queryAllByRole('option', { hidden: true });
const shown = () => options().map((o) => o.getAttribute('data-pr'));
const selectedPr = () => options().find((o) => o.getAttribute('aria-selected') === 'true')?.getAttribute('data-pr') ?? null;
const group = (name: 'Mine' | 'Review requests') => within(workPanel()).getByRole('group', { name });
const option = (id: string) => options().find((o) => o.getAttribute('data-pr') === id)!;
const rowButton = (id: string, action: 'open' | 'review') => option(id).querySelector<HTMLElement>(`[data-action="${action}"]`);

function openApp(path = '/', work: WorkSnapshot | null = snap(), options: Parameters<typeof renderApp>[1] = {}, current = settings()) {
  const app = renderApp(path, options);
  app.snapshot([row({ id: 'alpha' }), row({ id: 'beta' })], { state: 'ok' }, current);
  if (work) app.emit({ type: 'work', work });
  return app;
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

  it('WORK-1.3: PRs shows its count and how old its data is', async () => {
    openApp();
    await userEvent.setup().keyboard('w');
    const prsSection = within(workPanel()).getByRole('region', { name: 'PRs' });
    expect(within(prsSection).getByText('4')).toHaveAttribute('data-field', 'count');
    expect(prsSection.querySelector('[data-field="updated"]')).toHaveTextContent('updated 2m ago');
  });

  it('WORK-1.5: the filter shows All by default, and PRs and review requests shows the PRs section with both groups; Tasks isn’t offered until slice C; the choice is remembered', async () => {
    const user = userEvent.setup();
    const app = openApp();
    await user.keyboard('w');
    const filter = within(workPanel()).getByRole('group', { name: 'Show' });
    expect(within(filter).getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'PRs and review requests']);
    expect(within(filter).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(filter).getByRole('button', { name: 'PRs and review requests' }));
    expect(group('Mine')).toBeInTheDocument();
    expect(group('Review requests')).toBeInTheDocument();
    app.unmount();
    openApp();
    expect(within(workPanel()).getByRole('button', { name: 'PRs and review requests' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('WORK-1.5: a remembered Tasks filter reads as All, with the PRs showing', () => {
    window.localStorage.setItem('lookout.right', JSON.stringify({ open: true, width: 360, tab: 'work', workFilter: 'tasks' }));
    openApp();
    expect(within(workPanel()).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(shown()).toEqual(['anvil#2101', 'willow#2102', 'kettle#2103', 'willow#2106']);
  });

  it('WORK-1.6 (support): switching the filter shows the latest PRs at once, without asking the server for a read', async () => {
    const user = userEvent.setup();
    const app = openApp();
    await user.keyboard('w');
    await user.click(within(workPanel()).getByRole('button', { name: 'PRs and review requests' }));
    app.emit({ type: 'work', work: snap({ mine: [DRAFT], reviewRequests: [] }) });
    await user.click(within(workPanel()).getByRole('button', { name: 'All' }));
    expect(shown()).toEqual(['anvil#2101']);
    expect(app.client.refreshWork).not.toHaveBeenCalled();
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
    await user.click(within(workPanel()).getByRole('button', { name: 'PRs and review requests' }));
    await user.click(within(workPanel()).getByRole('button', { name: 'All' }));
    expect(selectedPr()).toBe('anvil#2101');
    // Work empty: none selected.
    app.emit({ type: 'work', work: snap({ mine: [], reviewRequests: [] }) });
    expect(options()).toEqual([]);
    expect(within(workPanel()).queryByRole('listbox')).toBeNull();
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

  it('WORK-6.1 (support): every PR row has an Open in browser button, its tooltip naming it and O; it opens the PR in a new tab', async () => {
    const opened = spyOpen();
    const user = userEvent.setup();
    openApp();
    await user.keyboard('w');
    const buttons = options().map((o) => o.querySelector<HTMLElement>('[data-action="open"]')!);
    expect(buttons).toHaveLength(4);
    for (const b of buttons) expect(b).toHaveAttribute('title', 'Open on GitHub (O)');
    await user.click(buttons[3]!);
    expect(opened).toEqual([[REVIEW.url, '_blank', 'noopener,noreferrer']]);
    expect(screen.queryByRole('dialog')).toBeNull();
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
