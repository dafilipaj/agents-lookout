import type { OutputItem } from '@shared/library.ts';
import { type NewMember, type Recommendation, type Topic, type TopicMember, type TopicSummary, memberKey } from '@shared/topics.ts';
import type { UsageSnapshot } from '@shared/usage.ts';
import type { HistoryItem } from '@shared/types.ts';
import type { PrSection, TaskSection, WorkPr, WorkSnapshot, WorkTask } from '@shared/work.ts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, pressRowAction, renderApp, row, settings } from '@/test/helpers';

/** Synthetic Topics, Tasks and PRs only: invented titles, repos and ids. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const member = (m: NewMember, addedAt = NOW - 60_000): TopicMember => ({ ...m, key: memberKey(m.kind, m.ref), addedAt, reason: 'added by hand' }) as TopicMember;
const topic = (n: number, over: Partial<Topic> = {}): Topic => ({ id: id(n), title: `Topic ${n}`, notes: '', state: 'open', createdAt: NOW - 1e6, updatedAt: NOW - n * 1000, members: [], outputs: { items: [], total: 0 }, pos: null, summary: null, summaryStale: false, ...over });

const pr = (over: Partial<WorkPr> & { repo: string; number: number }): WorkPr => ({
  title: `${over.repo} change ${over.number}`,
  url: `https://github.com/productiveio/${over.repo}/pull/${over.number}`,
  author: null, createdAt: NOW - 2 * 86_400_000, ageDays: 2, rotting: 'fresh', ci: 'passing', chip: 'draft', column: 'draft_mine', taskIds: [], links: null,
  ...over,
});
const task = (over: Partial<WorkTask> & { id: string; title: string }): WorkTask => ({
  project: 'Lantern Works', status: 'In progress', statusCategory: 'started', statusColor: null, dueDate: null, lastActivityAt: NOW - 3_600_000, milestone: false, description: null,
  url: `https://app.fantastic.productive.io/109-productive/tasks/${over.id}`, links: null,
  ...over,
});
const ANVIL = pr({ repo: 'anvil', number: 2101, title: 'Sharpen the anvil corners' });
const LIGHT = task({ id: '41000101', title: 'Light the harbor lanterns' });
const prSection = (over: Partial<PrSection> = {}): PrSection => ({ state: 'ok', reason: null, fix: null, stale: false, fetchedAt: NOW - 60_000, mine: [ANVIL], reviewRequests: [], marks: { mine: [], reviewRequests: [] }, taskIds: true, ...over });
const taskSection = (over: Partial<TaskSection> = {}): TaskSection => ({ state: 'ok', reason: null, fix: null, stale: false, fetchedAt: NOW - 60_000, tasks: [LIGHT], ...over });
const work = (p: Partial<PrSection> = {}, t: Partial<TaskSection> = {}): WorkSnapshot => ({ prs: prSection(p), tasks: taskSection(t), sessionLinks: { state: 'ok', reason: null, fix: null }, refresh: { cooldownUntil: null, githubBlockedUntil: null } });
const LOADING: WorkSnapshot = work({ state: 'loading', mine: [], fetchedAt: null }, { state: 'loading', tasks: [], fetchedAt: null });

const SESSION_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const SESSION: NewMember = { kind: 'session', ref: { harness: 'claude', sessionId: SESSION_ID }, snapshot: { harness: 'claude', title: 'rates-port', directory: '~/Projects/work' } };
const PR_MEMBER: NewMember = { kind: 'pr', ref: { url: ANVIL.url }, snapshot: { repo: 'anvil', number: 2101, title: 'Sharpen the anvil corners', url: ANVIL.url } };
const TASK_MEMBER: NewMember = { kind: 'task', ref: { id: LIGHT.id }, snapshot: { title: LIGHT.title, project: 'Lantern Works', url: LIGHT.url } };

const panel = () => screen.getByTestId('topics-panel');
const header = (title: string) => within(panel()).getByRole('button', { name: new RegExp(`^${title},`) });
const item = (title: string) => header(title).closest<HTMLElement>('[role="listitem"]')!;
const titles = () => within(panel()).queryAllByRole('button', { expanded: false }).concat(within(panel()).queryAllByRole('button', { expanded: true })).filter((b) => b.id.startsWith('topic-')).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)).map((b) => b.querySelector('[data-field="title"]')!.textContent);

const topicView = () => screen.getByTestId('topic-view');
/** TOPIC-10.1: a Topic's view, from "Open" on its expanded row in the tab. */
async function openView(user: ReturnType<typeof userEvent.setup>, title: string) {
  if (header(title).getAttribute('aria-expanded') !== 'true') await user.click(header(title));
  await user.click(within(item(title)).getByRole('button', { name: 'Open' }));
  return topicView();
}

function openApp(topics: Topic[] = [], w: WorkSnapshot | null = work(), options: Parameters<typeof renderApp>[1] = {}) {
  const app = renderApp('/s/alpha', { topics, ...options });
  app.snapshot([row({ id: 'alpha' }), row({ id: SESSION_ID, title: 'rates-port', status: 'needs-you' })]);
  if (w) app.emit({ type: 'work', work: w });
  return app;
}
async function openTopics() {
  const user = userEvent.setup();
  await user.keyboard('t');
  return user;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.useRealTimers());

describe('the Topics tab (TOPIC-3)', () => {
  it('TOPIC-3.1: T opens the sidebar on Topics, switches to it from another tab and closes it when Topics shows; the closed rail has its button under Library’s, and the tab is remembered', async () => {
    openApp();
    const user = userEvent.setup();
    await user.keyboard('t');
    expect(screen.getByRole('tab', { name: 'Topics' })).toHaveAttribute('aria-selected', 'true');
    expect(JSON.parse(window.localStorage.getItem('lookout.right')!)).toMatchObject({ open: true, tab: 'topics' });
    // With no Topic, opening Topics focuses its filter, which keeps its letters: leave it.
    expect(screen.getByRole('searchbox', { name: 'Filter Topics' })).toHaveFocus();
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('w');
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('t');
    expect(screen.getByRole('tab', { name: 'Topics' })).toHaveAttribute('aria-selected', 'true');
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('t');
    expect(screen.queryByTestId('topics-panel')).toBeNull();
    const rail = screen.getByRole('button', { name: 'Library' }).parentElement!;
    const buttons = within(rail).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(buttons.slice(-2)).toEqual(['Library', 'Topics']);
    await user.click(screen.getByRole('button', { name: 'Topics' }));
    expect(screen.getByTestId('topics-panel')).toBeVisible();
    // A text field keeps its T.
    await user.click(screen.getByRole('searchbox', { name: 'Filter Topics' }));
    await user.keyboard('t');
    expect(screen.getByRole('searchbox', { name: 'Filter Topics' })).toHaveValue('t');
  });

  it('TOPIC-3.6: Loading before the server sends Topics, "No Topics yet" with New Topic, "Nothing matches" under a filter, and a store that can’t be opened as an error Alert with its reason and file', async () => {
    const app = renderApp('/');
    const user = userEvent.setup();
    await user.keyboard('t');
    expect(within(panel()).getByText('Loading…')).toBeInTheDocument();
    app.snapshot([]);
    expect(within(panel()).getByText('No Topics yet')).toBeInTheDocument();
    expect(within(panel()).getAllByRole('button', { name: /New Topic/ })).toHaveLength(2);
    app.emit({ type: 'topics', topics: { state: 'ok', reason: null, path: '/p', topics: [topic(1)], edges: [], pruned: [], libraryReadAt: null, recommendations: [], jevAsksToday: 0, summarizing: [], summaryErrors: {} } });
    await user.type(screen.getByRole('searchbox', { name: 'Filter Topics' }), 'zzz');
    expect(within(panel()).getByText('Nothing matches')).toBeInTheDocument();
    app.emit({ type: 'topics', topics: { state: 'error', reason: 'Lookout couldn’t open its Topics database: permission denied.', path: '/Users/me/.lookout/topics.db', topics: [], edges: [], pruned: [], libraryReadAt: null, recommendations: [], jevAsksToday: 0, summarizing: [], summaryErrors: {} } });
    const alert = within(panel()).getByRole('alert');
    expect(alert).toHaveTextContent('Topics can\'t be opened');
    expect(alert).toHaveTextContent('permission denied. /Users/me/.lookout/topics.db');
  });

  it('TOPIC-3.2: Open Topics, most recently changed first, each with its member counts and the most urgent live member Session’s marker; the filter matches titles and notes', async () => {
    openApp([
      topic(1, { title: 'Older', updatedAt: NOW - 50_000, members: [member(PR_MEMBER)] }),
      topic(2, { title: 'Newest', updatedAt: NOW - 1_000, notes: 'rounding half up', members: [member(SESSION), member(PR_MEMBER), member(TASK_MEMBER)] }),
      topic(3, { title: 'Past only', updatedAt: NOW - 20_000, members: [member({ ...SESSION, ref: { harness: 'codex', sessionId: SESSION_ID } })] }),
      topic(4, { title: 'Put away', state: 'archived', updatedAt: NOW }),
    ]);
    const user = await openTopics();
    expect(titles()).toEqual(['Newest', 'Past only', 'Older']);
    expect(item('Newest').querySelector('[data-field="counts"]')).toHaveTextContent('1 Session · 1 PR · 1 Task');
    expect(item('Newest').querySelector('[data-session-marker]')).toHaveAttribute('data-status', 'needs-you');
    // The same id under the other Harness isn't that Session: past.
    expect(item('Past only').querySelector('[data-session-marker]')).toHaveAttribute('data-state', 'past');
    expect(item('Older').querySelector('[data-session-marker]')).toBeNull();
    await user.type(screen.getByRole('searchbox', { name: 'Filter Topics' }), 'HALF UP');
    expect(titles()).toEqual(['Newest']);
  });

  it('TOPIC-3.3: a click or Enter selects and expands one Topic in place, Esc collapses it, ↑/↓ and j/k move without acting, and a click opens nothing', async () => {
    const app = openApp([topic(1, { title: 'First', members: [member(SESSION)] }), topic(2, { title: 'Second' })]);
    const user = await openTopics();
    await user.click(header('Second'));
    expect(header('Second')).toHaveAttribute('aria-expanded', 'true');
    expect(header('Second')).toHaveAttribute('aria-current', 'true');
    expect(header('First')).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Escape}');
    expect(header('Second')).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('k');
    expect(header('First')).toHaveAttribute('aria-current', 'true');
    expect(header('First')).toHaveFocus();
    expect(header('First')).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{ArrowDown}');
    expect(header('Second')).toHaveAttribute('aria-current', 'true');
    await user.keyboard('{ArrowUp}{Enter}');
    expect(header('First')).toHaveAttribute('aria-expanded', 'true');
    // The Session sidebar's selection stayed, and nothing was resumed or opened.
    expect(window.location.pathname).toBe('/s/alpha');
    expect(app.client.resume).not.toHaveBeenCalled();
  });

  it('TOPIC-3.4: an expanded Topic is a summary: its notes’ first three lines, its live Sessions as chips and how many past, then Open, Open graph, Link to Topic…, Archive and Delete; Enter on it opens its view', async () => {
    const notes = ['**Port** the rates table', 'two', 'three', 'fourth line'].join('\n');
    const app = openApp([topic(1, { title: 'Proposals rates', notes, members: [member(TASK_MEMBER), member(PR_MEMBER), member(SESSION), member({ ...SESSION, ref: { harness: 'claude', sessionId: 'past-one' }, snapshot: { harness: 'claude', title: 'spec', directory: null } })] })]);
    const user = await openTopics();
    await user.click(header('Proposals rates'));
    const details = item('Proposals rates').querySelector<HTMLElement>('[data-field="details"]')!;
    const rendered = details.querySelector('[data-field="notes-text"]')!;
    expect(rendered.querySelector('strong')).toHaveTextContent('Port');
    expect(rendered).toHaveTextContent('three');
    expect(rendered).not.toHaveTextContent('fourth line');
    expect(within(details).queryByRole('button', { name: /^(more|Edit)$/ })).toBeNull();
    // Live Sessions as chips, the past ones counted; PRs, Tasks and Edges are in the view.
    expect(within(details).getByRole('button', { name: 'Open rates-port, Needs you' })).toBeInTheDocument();
    expect(within(details).queryByRole('button', { name: /spec/ })).toBeNull();
    expect(details.querySelector('[data-field="past-sessions"]')).toHaveTextContent('+1 past');
    expect(details.querySelector('[data-field="prs"], [data-field="tasks"], [data-field="outputs"], [data-field="edges"]')).toBeNull();
    expect(within(details).queryByRole('textbox')).toBeNull();
    expect([...details.querySelectorAll('[data-field="actions"] [data-action]')].map((b) => b.textContent)).toEqual(['Open', 'Open graph', 'Link to Topic…', 'Archive', 'Delete']);
    // Enter on the expanded Topic runs its first button, Open; a click on it only keeps it selected.
    await user.click(header('Proposals rates'));
    expect(window.location.pathname).toBe('/s/alpha');
    header('Proposals rates').focus();
    await user.keyboard('{Enter}');
    expect(window.location.pathname).toBe(`/topics/${id(1)}`);
    expect(topicView()).toBeInTheDocument();
    // A Session chip opens a live Session.
    await user.click(within(details).getByRole('button', { name: 'Open rates-port, Needs you' }));
    expect(window.location.pathname).toBe(`/s/${SESSION_ID}`);
    expect(app.client.resume).not.toHaveBeenCalled();
  });

  it('TOPIC-3.5: the Session sidebar’s filter also matches the titles of the Topics a live Session is in', async () => {
    openApp([topic(1, { title: 'Proposals rates', members: [member(SESSION)] })]);
    const user = userEvent.setup();
    await user.keyboard('/');
    await user.keyboard('proposals');
    const list = screen.getByRole('listbox', { name: /Sessions/ });
    expect(within(list).getAllByRole('option').map((o) => o.getAttribute('data-session-id'))).toEqual([SESSION_ID]);
  });
});

describe('a Topic (TOPIC-1)', () => {
  it('TOPIC-1.1: New Topic asks for a title and makes an Open Topic with no members, selected and expanded; an empty title is refused', async () => {
    const app = openApp();
    const user = await openTopics();
    await user.click(within(panel()).getAllByRole('button', { name: /New Topic/ })[0]!);
    const title = screen.getByRole('textbox', { name: 'New Topic title' });
    await user.keyboard('{Enter}');
    expect(within(panel()).getByRole('alert')).toHaveTextContent('A Topic needs a title.');
    expect(app.client.createTopic).not.toHaveBeenCalled();
    await user.type(title, 'Proposals rates{Enter}');
    expect(app.client.createTopic).toHaveBeenCalledWith('Proposals rates');
    await waitFor(() => expect(header('Proposals rates')).toHaveAttribute('aria-expanded', 'true'));
    expect(item('Proposals rates').querySelector('[data-field="counts"]')).toHaveTextContent('No members');
  });

  it('TOPIC-1.2: the title is edited in place, and the notes in a text area saved on ⌘Enter or leaving it, with "Saved" for 2 s; Esc cancels; empty notes clear them', async () => {
    const app = openApp([topic(1, { title: 'Proposals rates', notes: 'old notes' })]);
    const user = await openTopics();
    await openView(user, 'Proposals rates');
    const title = within(topicView()).getByRole('textbox', { name: 'Topic title' });
    await user.clear(title);
    await user.type(title, 'Rates port{Enter}');
    expect(app.client.updateTopic).toHaveBeenCalledWith(id(1), { title: 'Rates port' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const notes = screen.getByRole('textbox', { name: 'Notes' });
    await user.type(notes, ' and more');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Notes' })).toBeNull();
    expect(app.client.updateTopic).toHaveBeenCalledTimes(1);
    // Leaving the text area from the keyboard puts focus on Edit, so the panel's keys still work.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByRole('textbox', { name: 'Notes' }));
    await user.type(screen.getByRole('textbox', { name: 'Notes' }), 'Rounding: **half up**');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(app.client.updateTopic).toHaveBeenLastCalledWith(id(1), { notes: 'Rounding: **half up**' });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus());
    expect(topicView().querySelector('[data-field="notes-text"] strong')).toHaveTextContent('half up');
    await waitFor(() => expect(screen.queryByText('Saved')).toBeNull(), { timeout: 3000 });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByRole('textbox', { name: 'Notes' }));
    act(() => screen.getByRole('textbox', { name: 'Notes' }).blur());
    expect(app.client.updateTopic).toHaveBeenLastCalledWith(id(1), { notes: '' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add notes' })).toBeInTheDocument());
  });

  it('TOPIC-1.3: Archive moves a Topic out of the default list and keeps its members; the Archived toggle shows it, and Unarchive brings it back', async () => {
    const app = openApp([topic(1, { title: 'Proposals rates', members: [member(PR_MEMBER)] }), topic(2, { title: 'Other' })]);
    const user = await openTopics();
    await user.click(header('Proposals rates'));
    await user.click(within(item('Proposals rates')).getByRole('button', { name: 'Archive' }));
    expect(app.client.updateTopic).toHaveBeenCalledWith(id(1), { state: 'archived' });
    expect(titles()).toEqual(['Other']);
    await user.click(screen.getByRole('checkbox', { name: 'Archived' }));
    expect(titles()).toEqual(['Proposals rates', 'Other']);
    expect(item('Proposals rates').querySelector('[data-field="counts"]')).toHaveTextContent('1 PR');
    await user.click(header('Proposals rates'));
    await user.click(within(item('Proposals rates')).getByRole('button', { name: 'Unarchive' }));
    expect(app.client.updateTopic).toHaveBeenLastCalledWith(id(1), { state: 'open' });
    await user.click(screen.getByRole('checkbox', { name: 'Archived' }));
    expect(titles()).toEqual(['Proposals rates', 'Other']);
  });

  it('TOPIC-1.4: Delete asks first, naming the Topic, then removes the Topic and nothing else', async () => {
    const app = openApp([topic(1, { title: 'Proposals rates', members: [member(SESSION), member(PR_MEMBER)] })]);
    const user = await openTopics();
    await user.click(header('Proposals rates'));
    await user.click(within(item('Proposals rates')).getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete “Proposals rates”?' });
    expect(dialog).toHaveTextContent('No Session, PR, Task or Output is changed, closed or deleted.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(app.client.deleteTopic).not.toHaveBeenCalled();
    await user.click(within(item('Proposals rates')).getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete Topic' }));
    expect(app.client.deleteTopic).toHaveBeenCalledWith(id(1));
    expect(app.client.removeMember).not.toHaveBeenCalled();
    expect(app.client.endSession).not.toHaveBeenCalled();
    await waitFor(() => expect(within(panel()).getByText('No Topics yet')).toBeInTheDocument());
  });

  it('TOPIC-1.5: a Topic whose every PR and Task left Work shows "looks done", never before Work has read, and is never archived on its own', async () => {
    const gone = [topic(1, { title: 'Shipped', members: [member(PR_MEMBER), member(TASK_MEMBER)] }), topic(2, { title: 'Research', members: [member(SESSION)] }), topic(3, { title: 'Half', members: [member(PR_MEMBER), member({ ...TASK_MEMBER, ref: { id: '1' } })] })];
    const app = openApp(gone, LOADING);
    await openTopics();
    expect(panel().querySelector('[data-field="looks-done"]')).toBeNull();
    app.emit({ type: 'work', work: work({ mine: [] }, { tasks: [LIGHT] }) });
    expect(item('Shipped').querySelector('[data-field="looks-done"]')).toBeNull();
    app.emit({ type: 'work', work: work({ mine: [] }, { tasks: [] }) });
    expect(item('Shipped').querySelector('[data-field="looks-done"]')).toHaveTextContent('looks done');
    expect(item('Shipped').querySelector('[data-field="looks-done"]')).toHaveAttribute('data-tone', 'info');
    expect(item('Research').querySelector('[data-field="looks-done"]')).toBeNull();
    expect(item('Half').querySelector('[data-field="looks-done"]')).toHaveTextContent('looks done');
    expect(app.client.updateTopic).not.toHaveBeenCalled();
  });
});

describe('members (TOPIC-2)', () => {
  /** Work's Task row, expanded, and its Add to Topic. */
  async function addFromWork(user: ReturnType<typeof userEvent.setup>) {
    await user.keyboard('w');
    const option = screen.getByTestId('work-panel').querySelector<HTMLElement>(`[data-task="${LIGHT.id}"]`)!;
    fireEvent.click(option);
    await pressRowAction(user, option.querySelector<HTMLElement>('[data-action="add-to-topic"]')!);
    return screen.getByRole('dialog', { name: 'Add to Topic' });
  }

  it('TOPIC-2.1: Add to Topic on an expanded Work row opens the picker, Open Topics most recently changed first then New Topic…; a pick adds the row’s item and closes it; A opens it for the selected row', async () => {
    const app = openApp([topic(1, { title: 'Older', updatedAt: NOW - 9_000 }), topic(2, { title: 'Newer', updatedAt: NOW - 1_000 }), topic(3, { title: 'Archived one', state: 'archived' })]);
    const user = userEvent.setup();
    const dialog = await addFromWork(user);
    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(['Newer', 'Older', 'New Topic…']);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(app.client.addMember).toHaveBeenCalledWith(id(1), TASK_MEMBER);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Focus goes back to what opened it, in Work.
    await waitFor(() => expect(screen.getByTestId('work-panel')).toContainElement(document.activeElement as HTMLElement));
    // A, from the list, for the selected row.
    const list = screen.getByTestId('work-panel').querySelector<HTMLElement>('[role="listbox"]')!;
    list.focus();
    await user.keyboard('a');
    const again = screen.getByRole('dialog', { name: 'Add to Topic' });
    await user.type(within(again).getByRole('combobox', { name: 'Filter Topics' }), 'newer');
    expect(within(again).getAllByRole('option').map((o) => o.textContent)).toEqual(['Newer', 'New Topic…']);
    await user.click(within(again).getByRole('option', { name: 'New Topic…' }));
    await user.type(screen.getByRole('textbox', { name: 'Topic title' }), 'Harbor work{Enter}');
    expect(app.client.createTopic).toHaveBeenCalledWith('Harbor work');
    await waitFor(() => expect(app.client.addMember).toHaveBeenLastCalledWith(id(4), TASK_MEMBER));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(list).toHaveFocus());
    await user.keyboard('a');
    expect(screen.getByRole('dialog', { name: 'Add to Topic' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(list).toHaveFocus());
  });

  it('TOPIC-2.1 (support): a History result adds its Session, and a Library row its Sessions', async () => {
    const past: HistoryItem = { sessionId: 'past-one', harness: 'codex', headless: false, title: 'spec the rates', projectPath: '/Users/me/Projects/work', projectDisplay: '~/Projects/work', repo: 'work', branch: 'main', lastActiveAt: NOW - 3_600_000, snippet: null, firstPrompt: 'spec it', blocked: null };
    const output: OutputItem = {
      kind: 'file', key: '/Users/me/out.md', type: 'markdown', title: 'Rates doc', path: '/Users/me/out.md', url: null, display: '~/out.md', projectPath: null, repo: null, createdAt: NOW, updatedAt: NOW, events: 1, exists: true,
      source: null, sourcePath: null, sourceDisplay: null, version: null,
      sessions: [{ ...past, event: 'write', pruned: false }, { ...past, sessionId: 'gone-one', event: 'edit', pruned: true }],
    };
    const app = openApp([topic(1, { title: 'Rates' })], work(), {
      history: async () => ({ state: 'ok', items: [past], page: 1, hasMore: false }),
      library: async () => ({ state: 'ok', items: [output], readId: 'r', total: 1, nextPage: 2, hasMore: false, hiddenGone: 0, unfilteredEmpty: false, projects: [] }),
    });
    const user = userEvent.setup();
    await user.keyboard('h');
    const result = await within(screen.getByTestId('history-panel')).findByText('spec the rates', { selector: '[data-field="title"]' });
    await user.click(result);
    await pressRowAction(user, result.closest<HTMLElement>('[role="option"]')!.querySelector<HTMLElement>('[data-action="add-to-topic"]')!);
    await user.click(within(screen.getByRole('dialog')).getByRole('option', { name: 'Rates' }));
    expect(app.client.addMember).toHaveBeenCalledWith(id(1), { kind: 'session', ref: { harness: 'codex', sessionId: 'past-one' }, snapshot: { harness: 'codex', title: 'spec the rates', directory: '~/Projects/work' } });
    await user.keyboard('l');
    const out = await within(screen.getByTestId('library-panel')).findByText('Rates doc');
    await user.click(out);
    await pressRowAction(user, out.closest<HTMLElement>('[role="option"]')!.querySelector<HTMLElement>('[data-action="add-to-topic"]')!);
    await user.click(within(screen.getByRole('dialog')).getByRole('option', { name: /Rates/ }));
    // Both of its Sessions, the pruned one too: a member keeps its snapshot (TOPIC-4.2).
    expect(app.client.addMember).toHaveBeenCalledWith(id(1), { kind: 'session', ref: { harness: 'codex', sessionId: 'gone-one' }, snapshot: { harness: 'codex', title: 'spec the rates', directory: '~/Projects/work' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('TOPIC-2.2: the Session header has Add to Topic; a Session without a session id has it disabled, saying why; a past Session opened read-only has it too', async () => {
    const past: HistoryItem = { sessionId: 'past-one', harness: 'claude', headless: false, title: 'old spec', projectPath: null, projectDisplay: null, repo: null, branch: null, lastActiveAt: null, snippet: null, firstPrompt: null, blocked: 'folder-gone' };
    const app = renderApp(`/s/${SESSION_ID}`, { topics: [topic(1, { title: 'Rates' })], pastSession: async () => ({ item: past, entries: [], tailed: true, previewNote: null }) as never });
    app.snapshot([row({ id: SESSION_ID, title: 'rates-port' }), row({ id: 'codex:4242', harness: 'codex', pid: 4242, title: 'fresh codex' })]);
    const user = userEvent.setup();
    const header = () => screen.getByRole('banner', { name: 'Session' });
    await user.click(within(header()).getByRole('button', { name: 'Add to Topic' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('option', { name: 'Rates' }));
    expect(app.client.addMember).toHaveBeenCalledWith(id(1), expect.objectContaining({ kind: 'session', ref: { harness: 'claude', sessionId: SESSION_ID } }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByText('fresh codex'));
    const disabled = within(header()).getByRole('button', { name: 'Add to Topic' });
    expect(disabled).toHaveAttribute('aria-disabled', 'true');
    expect(disabled.getAttribute('title')).toMatch(/no session id until its first prompt/);
    await user.click(disabled);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => {
      window.history.pushState(null, '', '/h/claude/past-one');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    const pastHeader = await screen.findByRole('banner', { name: 'Past Session' });
    expect(within(pastHeader).getByRole('button', { name: 'Add to Topic' })).not.toHaveAttribute('aria-disabled');
  });

  it('TOPIC-2.3: adding an item that is already a member changes nothing and says "Already in <Topic>"', async () => {
    const app = openApp([topic(1, { title: 'Rates', members: [member(TASK_MEMBER)] })]);
    const user = userEvent.setup();
    const dialog = await addFromWork(user);
    expect(within(dialog).getByRole('option', { name: /Rates/ })).toHaveTextContent('already in');
    await user.click(within(dialog).getByRole('option', { name: /Rates/ }));
    expect(await within(dialog).findByText('Already in Rates')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(app.client.addMember).toHaveBeenCalledTimes(1);
  });

  it('TOPIC-2.4: an item can be in any number of Topics, and Remove takes away that membership only', async () => {
    const app = openApp([topic(1, { title: 'Rates', members: [member(PR_MEMBER), member(TASK_MEMBER)] }), topic(2, { title: 'Other', members: [member(PR_MEMBER)] })]);
    const user = await openTopics();
    await openView(user, 'Rates');
    await user.click(within(topicView()).getByRole('button', { name: 'Remove #2101 from Rates' }));
    expect(app.client.removeMember).toHaveBeenCalledWith(id(1), expect.objectContaining({ kind: 'pr', ref: PR_MEMBER.ref }));
    await waitFor(() => expect(item('Rates').querySelector('[data-field="counts"]')).toHaveTextContent(/^1 Task$/));
    expect(item('Other').querySelector('[data-field="counts"]')).toHaveTextContent('1 PR');
  });

  it('TOPIC-2.5: an expanded Work row shows each Topic its item is in as a chip, a collapsed one none, and a chip opens the Topics tab on that Topic', async () => {
    openApp([topic(1, { title: 'Rates', members: [member(TASK_MEMBER)] }), topic(2, { title: 'Archived', state: 'archived', members: [member(TASK_MEMBER)] }), topic(3, { title: 'Unrelated' })]);
    const user = userEvent.setup();
    await user.keyboard('w');
    const option = screen.getByTestId('work-panel').querySelector<HTMLElement>(`[data-task="${LIGHT.id}"]`)!;
    expect(option.querySelector('[data-field="topic-chips"]')).toBeNull();
    fireEvent.click(option);
    const chips = option.querySelector<HTMLElement>('[data-field="topic-chips"]')!;
    expect([...chips.querySelectorAll('[data-topic-id]')].map((c) => c.textContent)).toEqual(['Rates', 'Archived']);
    await waitFor(() => expect(chips.querySelector('[data-topic-id]')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 450)); // the row's settle (ROW_SETTLE_MS)
    await user.click(within(chips).getByText('Archived'));
    expect(screen.getByRole('tab', { name: 'Topics' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(header('Archived')).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByRole('checkbox', { name: 'Archived' })).toBeChecked();
  });
});

describe('what a member is doing now (TOPIC-4)', () => {
  it('TOPIC-4.1: a Session member follows the Session list’s Status; a PR or Task member shows Work’s state and CI', async () => {
    const app = openApp([topic(1, { title: 'Rates', members: [member(SESSION), member(PR_MEMBER), member(TASK_MEMBER)] })]);
    const user = await openTopics();
    await openView(user, 'Rates');
    const details = topicView;
    expect(within(details()).getByRole('button', { name: 'Open rates-port, Needs you' })).toBeInTheDocument();
    app.emit({ type: 'sessions', upsert: [row({ id: SESSION_ID, title: 'rates-port', status: 'busy' })], remove: [] });
    expect(within(details()).getByRole('button', { name: 'Open rates-port, Busy' })).toBeInTheDocument();
    const prLine = details().querySelector<HTMLElement>('[data-field="pr"]')!;
    expect(prLine).toHaveTextContent(/^anvil#2101draft/);
    expect(prLine.querySelector('[data-field="ci"]')).toHaveAttribute('data-ci', 'passing');
    expect(details().querySelector('[data-field="task"]')).toHaveTextContent(/^Light the harbor lanterns· In progress/);
    app.emit({ type: 'sessions', upsert: [], remove: [SESSION_ID] });
    expect(within(details()).getByRole('button', { name: 'Resume rates-port, past' })).toBeInTheDocument();
  });

  it('TOPIC-4.2: a member Work doesn’t list shows its snapshot with "not in Work"; before Work has read, "Loading"; a Session pruned from the index shows its snapshot and no button', async () => {
    const app = openApp([topic(1, { title: 'Rates', members: [member({ ...SESSION, ref: { harness: 'claude', sessionId: 'gone-one' }, snapshot: { harness: 'claude', title: 'old fix', directory: null } }), member(PR_MEMBER), member(TASK_MEMBER)] })], LOADING);
    const user = await openTopics();
    await openView(user, 'Rates');
    const details = topicView;
    expect(details().querySelectorAll('[data-field="member-loading"]')).toHaveLength(2);
    app.emit({ type: 'work', work: work({ mine: [] }, { tasks: [] }) });
    const chips = details().querySelectorAll('[data-field="not-in-work"]');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveAttribute('title', 'Work lists open items only, so this may be merged, closed or not read yet.');
    expect(details().querySelector('[data-field="pr"]')).toHaveTextContent('Sharpen the anvil corners');
    expect(within(details()).getByRole('button', { name: 'Resume old fix, past' })).toBeInTheDocument();
    app.emit({ type: 'topics', topics: { state: 'ok', reason: null, path: '/p', topics: [topic(1, { title: 'Rates', members: [member({ ...SESSION, ref: { harness: 'claude', sessionId: 'gone-one' }, snapshot: { harness: 'claude', title: 'old fix', directory: null } })] })], edges: [], pruned: ['claude:gone-one'], libraryReadAt: null, recommendations: [], jevAsksToday: 0, summarizing: [], summaryErrors: {} } });
    expect(details().querySelector('[data-field="session"]')).toHaveTextContent('old fix· removed from the index');
    expect(within(details()).queryByRole('button', { name: /^(Open|Resume) old fix/ })).toBeNull();
  });

  it('TOPIC-4.3 (support): a tab with Topics open tells the server it has Work open, and closing it says it hasn’t', async () => {
    const app = openApp();
    const user = await openTopics();
    await waitFor(() => expect(app.client.watchWork).toHaveBeenLastCalledWith('tab-1', true));
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('t');
    await waitFor(() => expect(app.client.watchWork).toHaveBeenLastCalledWith('tab-1', false));
  });

  it('TOPIC-4.4: the Topic view lists its Sessions’ Outputs with an Open button, "+N more" opening the Library on those Sessions; opening it asks for a Library read when none ran in the last minute', async () => {
    const output = (n: number): OutputItem => ({
      kind: 'file', key: `/o/${n}.md`, type: 'markdown', title: `Doc ${n}`, path: `/o/${n}.md`, url: null, display: `~/o/${n}.md`, projectPath: null, repo: null, createdAt: NOW, updatedAt: Date.now() - n * 3_600_000 - 60_000, events: 1, exists: true,
      source: null, sourcePath: null, sourceDisplay: null, version: null, sessions: [],
    });
    const app = openApp([topic(1, { title: 'Rates', members: [member(SESSION)], outputs: null }), topic(2, { title: 'Other' })]);
    const user = await openTopics();
    await openView(user, 'Rates');
    expect(within(topicView()).getByText('Reading the Library…')).toBeInTheDocument();
    await waitFor(() => expect(app.client.library).toHaveBeenCalledWith(expect.objectContaining({ page: 1, query: '' })));
    /** Leaves the view for another Topic's, then opens it again. */
    const reopen = async () => {
      await openView(user, 'Other');
      await openView(user, 'Rates');
    };
    app.emit({ type: 'topics', topics: { state: 'ok', reason: null, path: '/p', topics: [topic(1, { title: 'Rates', members: [member(SESSION)], outputs: { items: [output(1), output(2)], total: 12 } }), topic(2, { title: 'Other' })], edges: [], pruned: [], libraryReadAt: Date.now(), recommendations: [], jevAsksToday: 0, summarizing: [], summaryErrors: {} } });
    // Opened again within a minute of the last read: nothing is read again.
    const reads = vi.mocked(app.client.library).mock.calls.length;
    await reopen();
    expect(app.client.library).toHaveBeenCalledTimes(reads);
    // A minute or more after it: opening it reads the Library again, for Outputs written since.
    app.emit({ type: 'topics', topics: { state: 'ok', reason: null, path: '/p', topics: [topic(1, { title: 'Rates', members: [member(SESSION)], outputs: { items: [output(1), output(2)], total: 12 } }), topic(2, { title: 'Other' })], edges: [], pruned: [], libraryReadAt: Date.now() - 61_000, recommendations: [], jevAsksToday: 0, summarizing: [], summaryErrors: {} } });
    await reopen();
    await waitFor(() => expect(app.client.library).toHaveBeenCalledTimes(reads + 1));
    const outputs = topicView().querySelector<HTMLElement>('[data-field="outputs"]')!;
    expect([...outputs.querySelectorAll('[data-field="output"]')].map((o) => o.textContent)).toEqual(["Doc 11hOpen", "Doc 22hOpen"]);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await user.click(within(outputs).getByRole('button', { name: 'Open Doc 1, Markdown' }));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^vscode:/), '_self');
    // A text filter left in the Library, and its default types, would hide them: both give way.
    await user.keyboard('l');
    await user.type(screen.getByRole('searchbox', { name: 'Filter Outputs' }), 'zzz');
    act(() => (document.activeElement as HTMLElement).blur());
    await user.click(within(topicView().querySelector<HTMLElement>('[data-field="outputs"]')!).getByRole('button', { name: '+10 more' }));
    expect(screen.getByRole('tab', { name: 'Library' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(app.client.library).toHaveBeenLastCalledWith(expect.objectContaining({ sessions: [`claude:${SESSION_ID}`], query: '', types: ['pages', 'pdf', 'markdown', 'image', 'share'], project: '', hideGone: false })));
    expect(screen.getByRole('searchbox', { name: 'Filter Outputs' })).toHaveValue('');
    expect(screen.getByTestId('library-panel').querySelector('[data-field="session-filter"]')).toHaveTextContent('Sessions of Rates');
    await user.click(screen.getByRole('button', { name: "Show every Output, not only Rates's" }));
    await waitFor(() => expect(app.client.library).toHaveBeenLastCalledWith(expect.not.objectContaining({ sessions: expect.anything() })));
  });

  it('TOPIC-4.4: a Library read that fails says why where the Outputs would be, instead of reading forever', async () => {
    openApp([topic(1, { title: 'Rates', members: [member(SESSION)], outputs: null })], work(), { library: async () => ({ state: 'not-installed', installCommand: 'cargo install tb-session' }) });
    const user = await openTopics();
    await openView(user, 'Rates');
    expect(await within(topicView()).findByText("The Library can't be read: tb-session isn't installed.")).toBeInTheDocument();
    expect(within(topicView()).queryByText('Reading the Library…')).toBeNull();
  });
});

it('TOPIC-8.1: the browser keeps only which Topic is selected', async () => {
  openApp([topic(1, { title: 'Proposals rates', notes: 'secret-ish notes', members: [member(PR_MEMBER)] })]);
  const user = await openTopics();
  await user.click(header('Proposals rates'));
  const kept = Object.keys(window.localStorage).map((k) => window.localStorage.getItem(k)).join('\n');
  expect(JSON.parse(window.localStorage.getItem('lookout.right')!).topic).toBe(id(1));
  expect(kept).not.toContain('Proposals rates');
  expect(kept).not.toContain('secret-ish');
  expect(kept).not.toContain('anvil');
});

describe('recommendations (TOPIC-9)', () => {
  const FIX: NewMember = { kind: 'session', ref: { harness: 'claude', sessionId: SESSION_ID }, snapshot: { harness: 'claude', title: 'rates-port', directory: '~/Projects/work' } };
  const fromLink: Recommendation = { key: memberKey('session', FIX.ref), member: FIX, topicId: id(1), newTitle: null, source: 'link', confidence: null, reason: 'started on PR #812', createdAt: NOW - 1_000 };
  const fromJev: Recommendation = { key: memberKey('pr', PR_MEMBER.ref), member: PR_MEMBER, topicId: null, newTitle: 'Sharpen the anvil corners', source: 'jev', confidence: 0.71, reason: 'Jev, 71%', createdAt: NOW - 500 };
  const usage = (jev: Partial<UsageSnapshot['jev']> = {}): UsageSnapshot => ({ providers: [], checkedAt: NOW, jev: { state: 'ready', version: '0.2.0', keySource: 'env TYPESAFE_API_KEY', baseUrl: 'https://api.typesafe.ai', configPath: null, reason: null, ...jev } });
  const recommended = () => within(panel()).getByRole('list', { name: 'Recommended' });
  const rec = (name: RegExp) => within(recommended()).getByRole('listitem', { name });

  it('TOPIC-9.4: "Recommended" at the top, newest first, each with the item, its Topic or "New Topic: <title>" and the reason; the rail and the tab show how many, a neutral count', async () => {
    openApp([topic(1, { title: 'Proposals rates' })], work(), { recommendations: [fromJev, fromLink] });
    expect(screen.getByRole('button', { name: 'Topics, 2 recommended' })).toBeInTheDocument();
    await openTopics();
    expect(screen.getByRole('tab', { name: /Topics/ }).querySelector('[data-field="count"]')).toHaveTextContent('2');
    const rows = within(recommended()).getAllByRole('listitem');
    expect(rows.map((r) => [r.querySelector('[data-field="item"]')!.textContent, r.querySelector('[data-field="target"]')!.textContent, r.querySelector('[data-field="reason"]')!.textContent])).toEqual([
      ['anvil #2101 Sharpen the anvil corners', 'New Topic: Sharpen the anvil corners', 'Jev, 71%'],
      ['rates-port', 'Proposals rates', 'started on PR #812'],
    ]);
    expect(within(rows[1]!).getAllByRole('button').map((b) => b.textContent)).toEqual(['Accept', 'Other Topic…', 'Dismiss']);
  });

  it('TOPIC-9.4, TOPIC-9.5: Accept adds it with where it came from; Dismiss adds nothing; "Recommended" goes once nothing is pending; the Topic view repeats its own', async () => {
    const app = openApp([topic(1, { title: 'Proposals rates' })], work(), { recommendations: [fromJev, fromLink] });
    const user = await openTopics();
    await openView(user, 'Proposals rates');
    expect(within(topicView().querySelector<HTMLElement>('[data-field="topic-recommended"]')!).getByRole('listitem', { name: /rates-port/ })).toBeInTheDocument();
    await user.click(within(rec(/^rates-port/)).getByRole('button', { name: 'Accept' }));
    expect(app.client.recommend).toHaveBeenCalledWith({ action: 'accept', key: fromLink.key, topicId: id(1) });
    await waitFor(() => expect(topicView().querySelector('[data-field="topic-recommended"]')).toBeNull());
    expect(topicView().querySelector('[data-field="sessions"]')).toHaveTextContent('rates-port');
    await user.click(within(rec(/^anvil/)).getByRole('button', { name: 'Dismiss' }));
    expect(app.client.recommend).toHaveBeenLastCalledWith({ action: 'dismiss', key: fromJev.key, topicId: null });
    await waitFor(() => expect(within(panel()).queryByRole('list', { name: 'Recommended' })).toBeNull());
    expect(screen.getByRole('tab', { name: /Topics/ }).querySelector('[data-field="count"]')).toBeNull();
  });

  it('TOPIC-9.4: "Other Topic…" opens the Topic picker; a pick moves the item there', async () => {
    const app = openApp([topic(1, { title: 'Proposals rates' }), topic(2, { title: 'Anvil care' })], work(), { recommendations: [fromLink] });
    const user = await openTopics();
    await user.click(within(rec(/^rates-port/)).getByRole('button', { name: 'Other Topic…' }));
    const dialog = screen.getByRole('dialog', { name: 'Other Topic' });
    await user.click(within(dialog).getByRole('option', { name: 'Anvil care' }));
    expect(app.client.recommend).toHaveBeenCalledWith({ action: 'move', key: fromLink.key, topicId: id(1), to: id(2) });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('TOPIC-9.3: Settings has "Recommend Topics with Jev", off by default, saying each judgment is billed, at most 30 an hour, and how many ran today; with Jev not set up it says so with the fix', async () => {
    const app = renderApp('/settings');
    app.snapshot([row({ id: 'alpha' })]);
    app.emit({ type: 'usage', usage: usage({ state: 'not-set-up', reason: 'no key', fix: 'tb-jev config init' }) });
    const user = userEvent.setup();
    const sw = screen.getByRole('switch', { name: 'Recommend Topics with Jev' });
    expect(sw).not.toBeChecked();
    expect(screen.getByText(/Each judgment is a billed Jev call; at most 30 an hour\. 0 ran today\./)).toBeInTheDocument();
    expect(screen.getByText("Jev isn't ready (no key), so nothing is asked.")).toBeInTheDocument();
    expect(screen.getByText('tb-jev config init')).toBeInTheDocument();
    await user.click(sw);
    expect(app.client.saveSettings).toHaveBeenCalledWith({ recommendWithJev: true });
  });

  it('TOPIC-9.1: while Jev can be asked, the Topic picker offers "Ask Jev which Topic" ("Judge again") for the row it was opened on', async () => {
    const app = openApp([topic(1, { title: 'Rates' })], work());
    const user = userEvent.setup();
    await user.keyboard('w');
    const option = () => screen.getByTestId('work-panel').querySelector<HTMLElement>(`[data-task="${LIGHT.id}"]`)!;
    fireEvent.click(option());
    await pressRowAction(user, option().querySelector<HTMLElement>('[data-action="add-to-topic"]')!);
    expect(within(screen.getByRole('dialog')).queryByRole('option', { name: /Ask Jev/ })).toBeNull();
    await user.keyboard('{Escape}');
    app.snapshot([row({ id: 'alpha' }), row({ id: SESSION_ID, title: 'rates-port', status: 'needs-you' })], { state: 'ok' }, settings({ recommendWithJev: true }));
    app.emit({ type: 'usage', usage: usage() });
    await pressRowAction(user, option().querySelector<HTMLElement>('[data-action="add-to-topic"]')!);
    await user.click(within(screen.getByRole('dialog')).getByRole('option', { name: /Ask Jev which Topic/ }));
    expect(app.client.recommend).toHaveBeenCalledWith({ action: 'judge-again', member: TASK_MEMBER });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

const graph = () => screen.getByTestId('topic-graph');
const node = (title: string) => within(graph()).getByRole('button', { name: new RegExp(`^${title},`) });
const at = (el: Element) => ({ x: Number(el.getAttribute('data-x')), y: Number(el.getAttribute('data-y')) });

describe('Edges (TOPIC-6)', () => {
  it('TOPIC-6.1: "Link to Topic…" opens the Topic picker without "New Topic…" or the Topic itself; a pick asks for an optional label, then links from it; linking again says "Already linked"', async () => {
    const app = openApp([topic(1, { title: 'Rates table' }), topic(2, { title: 'Proposals v2' }), topic(3, { title: 'CRM backlog' }), topic(4, { title: 'Old one', state: 'archived' })]);
    const user = await openTopics();
    await user.click(header('Rates table'));
    await user.click(within(item('Rates table')).getByRole('button', { name: 'Link to Topic…' }));
    const dialog = screen.getByRole('dialog', { name: 'Link to Topic' });
    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(['Proposals v2', 'CRM backlog']);
    await user.click(within(dialog).getByRole('option', { name: 'Proposals v2' }));
    const label = within(screen.getByRole('dialog', { name: 'Link to Proposals v2' })).getByRole('textbox', { name: 'Label' });
    expect(label).toHaveFocus();
    expect(label).toHaveAttribute('maxLength', '60');
    await user.type(label, 'part of{Enter}');
    expect(app.client.linkTopics).toHaveBeenCalledWith(id(1), id(2), 'part of');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Again, from the other end: already linked, whichever way it goes; nothing is sent.
    await user.click(header('Proposals v2'));
    await user.click(within(item('Proposals v2')).getByRole('button', { name: 'Link to Topic…' }));
    const again = screen.getByRole('dialog', { name: 'Link to Topic' });
    expect(within(again).getByRole('option', { name: /Rates table/ })).toHaveTextContent('linked');
    await user.click(within(again).getByRole('option', { name: /Rates table/ }));
    expect(within(again).getByText('Already linked')).toBeInTheDocument();
    expect(app.client.linkTopics).toHaveBeenCalledTimes(1);
    // No label is no label.
    await user.click(within(again).getByRole('option', { name: 'CRM backlog' }));
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(app.client.linkTopics).toHaveBeenLastCalledWith(id(2), id(3), null);
  });

  it('TOPIC-6.2: an Edge shows in both Topics’ views, "→ <other> (<label>)" where it starts and "← <other> (<label>)" on the other; Reverse turns it around and Unlink removes it, from either', async () => {
    const app = openApp([topic(1, { title: 'Rates table' }), topic(2, { title: 'Proposals v2' })], work(), { edges: [{ from: id(1), to: id(2), label: 'part of', createdAt: NOW }] });
    const user = await openTopics();
    await openView(user, 'Rates table');
    const edge = () => within(topicView()).getByRole('group', { name: /^Edge (to|from)/ });
    expect(edge()).toHaveAccessibleName('Edge to Proposals v2 (part of)');
    expect(edge()).toHaveAttribute('data-dir', 'out');
    await openView(user, 'Proposals v2');
    expect(edge()).toHaveAccessibleName('Edge from Rates table (part of)');
    expect(edge()).toHaveAttribute('data-dir', 'in');
    await user.click(within(edge()).getByRole('button', { name: 'Reverse the Edge with Rates table' }));
    expect(app.client.editEdge).toHaveBeenCalledWith(id(2), { other: id(1), reverse: true });
    await waitFor(() => expect(edge()).toHaveAccessibleName('Edge to Rates table (part of)'));
    await user.click(within(edge()).getByRole('button', { name: 'Unlink Rates table' }));
    expect(app.client.unlinkTopics).toHaveBeenCalledWith(id(2), id(1));
    await waitFor(() => expect(within(topicView()).queryByRole('group', { name: /^Edge/ })).toBeNull());
  });

  it('TOPIC-6.3: two Open Topics that share a member show, in their views, a dashed "shared: <item>" line on each, never stored; Link makes an Edge from the Topic it is clicked on, and the line goes', async () => {
    const app = openApp([topic(1, { title: 'Rates table', members: [member(PR_MEMBER), member(TASK_MEMBER)] }), topic(2, { title: 'Proposals v2', members: [member(PR_MEMBER), member(TASK_MEMBER)] }), topic(3, { title: 'CRM backlog' }), topic(4, { title: 'Old audit', state: 'archived', members: [member(PR_MEMBER)] })]);
    const user = await openTopics();
    // An Archived Topic shares nothing, shown or not.
    await user.click(within(panel()).getByRole('checkbox', { name: 'Archived' }));
    await openView(user, 'Old audit');
    expect(topicView().querySelector('[data-field="shared"]')).toBeNull();
    await openView(user, 'Proposals v2');
    const line = topicView().querySelector<HTMLElement>('[data-field="shared"]')!;
    expect(line).toHaveTextContent('Rates table · shared: anvil #2101 and 1 more');
    expect(line.className).toContain('border-dashed');
    expect(topicView().querySelectorAll('[data-field="shared"]')).toHaveLength(1);
    expect(line).not.toHaveTextContent('Old audit');
    await user.click(within(line).getByRole('button', { name: 'Link to Rates table' }));
    expect(app.client.linkTopics).toHaveBeenCalledWith(id(2), id(1), null);
    await waitFor(() => expect(topicView().querySelector('[data-field="shared"]')).toBeNull());
    expect(within(topicView()).getByRole('group', { name: 'Edge to Rates table' })).toBeInTheDocument();
  });
});

describe('the graph (TOPIC-7)', () => {
  it('TOPIC-7.1: Open graph or G in Topics shows the graph: a node per Open Topic with its marker, Archived ones behind the same toggle, an arrow per Edge with its label; the selected Topic is marked and a node selects it in the tab; a reload keeps the view', async () => {
    const edges = [{ from: id(1), to: id(2), label: 'part of', createdAt: NOW }, { from: id(3), to: id(1), label: null, createdAt: NOW }];
    const app = openApp([topic(1, { title: 'Rates table', members: [member(SESSION)] }), topic(2, { title: 'Proposals v2' }), topic(3, { title: 'Old audit', state: 'archived' })], work(), { edges });
    const user = await openTopics();
    await user.click(within(panel()).getAllByRole('button', { name: 'Open graph' })[0]!);
    expect(window.location.pathname).toBe('/topics');
    expect(within(graph()).getAllByRole('button', { name: /, (No members|\d)/ }).map((n) => n.getAttribute('aria-label'))).toEqual(['Rates table, 1 Session', 'Proposals v2, No members']);
    expect(node('Rates table').querySelector('[data-session-marker]')).toHaveAttribute('data-status', 'needs-you');
    expect(graph().querySelectorAll('[data-field="edge"]')).toHaveLength(1);
    expect(within(graph()).getByRole('button', { name: 'Edge from Rates table to Proposals v2, part of' })).toHaveTextContent('part of');
    expect(graph().querySelector('[data-field="edge"] line')).toHaveAttribute('marker-end', 'url(#topic-arrow)');
    // The same Archived toggle as the tab's.
    await user.click(within(screen.getByRole('banner')).getByRole('checkbox', { name: 'Archived' }));
    expect(node('Old audit')).toBeInTheDocument();
    expect(graph().querySelectorAll('[data-field="edge"]')).toHaveLength(2);
    expect(within(panel()).getByRole('checkbox', { name: 'Archived' })).toBeChecked();
    // Selecting a node selects the Topic in the tab; its node is marked.
    await user.click(node('Proposals v2'));
    expect(node('Proposals v2')).toHaveAttribute('aria-pressed', 'true');
    expect(header('Proposals v2')).toHaveAttribute('aria-current', 'true');
    expect(JSON.parse(window.localStorage.getItem('lookout.right')!)).toMatchObject({ topic: id(2) });
    // A node the tab's filter hides clears the filter, so the tab marks that Topic.
    await user.type(within(panel()).getByRole('searchbox', { name: 'Filter Topics' }), 'Rates');
    await user.click(node('Proposals v2'));
    expect(within(panel()).getByRole('searchbox', { name: 'Filter Topics' })).toHaveValue('');
    expect(header('Proposals v2')).toHaveAttribute('aria-current', 'true');
    // G, with focus in Topics.
    app.unmount();
    window.localStorage.clear();
    const again = openApp([topic(1, { title: 'Rates table' })]);
    expect(window.location.pathname).toBe('/s/alpha');
    const u = await openTopics();
    await u.keyboard('g');
    expect(window.location.pathname).toBe('/topics');
    again.unmount();
    // A reload keeps the view.
    const reloaded = renderApp('/topics', { topics: [topic(1, { title: 'Rates table' })] });
    reloaded.snapshot([row({ id: 'alpha' })]);
    expect(within(graph()).getByRole('button', { name: /^Rates table,/ })).toBeInTheDocument();
  });

  it('TOPIC-7.2: a node with no position is placed clear of the others and stored; a dragged node is stored where it is dropped; Arrange asks, then lays every node out again', async () => {
    const app = renderApp('/topics', { topics: [topic(1, { title: 'Rates table', pos: { x: 400, y: 280 } }), topic(2, { title: 'Proposals v2' }), topic(3, { title: 'CRM backlog' })] });
    app.snapshot([row({ id: 'alpha' })]);
    // Placed once, both together, clear of the placed one and of each other.
    await waitFor(() => expect(app.client.placeTopics).toHaveBeenCalledTimes(1));
    const placed = vi.mocked(app.client.placeTopics).mock.calls[0]![0];
    expect(placed.map((p) => p.id).sort()).toEqual([id(2), id(3)]);
    const all = [{ x: 400, y: 280 }, ...placed];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(Math.abs(all[i]!.x - all[j]!.x) >= 216 || Math.abs(all[i]!.y - all[j]!.y) >= 88).toBe(true);
    await waitFor(() => expect(at(node('Proposals v2'))).toEqual({ x: placed.find((p) => p.id === id(2))!.x, y: placed.find((p) => p.id === id(2))!.y }));
    // Drag: down, move, up; stored where it lies; it isn't a click.
    const svg = graph().querySelector('svg')!;
    fireEvent.pointerDown(node('Rates table'), { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 160, clientY: 130 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 160, clientY: 130 });
    fireEvent.click(node('Rates table'));
    expect(app.client.placeTopics).toHaveBeenLastCalledWith([{ id: id(1), x: 460, y: 310 }]);
    expect(node('Rates table')).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(at(node('Rates table'))).toEqual({ x: 460, y: 310 }));
    // A drag the browser cancels stores nothing, and the node goes back.
    fireEvent.pointerDown(node('Rates table'), { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 300, clientY: 300 });
    expect(at(node('Rates table'))).toEqual({ x: 660, y: 510 });
    fireEvent.pointerCancel(svg, { pointerId: 1 });
    expect(at(node('Rates table'))).toEqual({ x: 460, y: 310 });
    expect(app.client.placeTopics).toHaveBeenCalledTimes(2);
    // A press that barely moves is a click, and stores nothing.
    fireEvent.pointerDown(node('Rates table'), { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 102, clientY: 101 });
    fireEvent.pointerUp(svg, { pointerId: 1 });
    expect(app.client.placeTopics).toHaveBeenCalledTimes(2);
    // Arrange, after its confirmation; Cancel moves nothing.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Arrange' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Arrange every node?' })).getByRole('button', { name: 'Cancel' }));
    expect(app.client.placeTopics).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Arrange' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Arrange every node?' })).getByRole('button', { name: 'Arrange' }));
    expect(app.client.placeTopics).toHaveBeenCalledTimes(3);
    expect(vi.mocked(app.client.placeTopics).mock.calls[2]![0].map((p) => p.id).sort()).toEqual([id(1), id(2), id(3)]);
  });

  it('TOPIC-7.2: a new node is placed clear of hidden Archived ones too; a save that fails puts the nodes back where the server has them', async () => {
    const app = renderApp('/topics', { topics: [topic(1, { title: 'Rates table', pos: { x: 400, y: 280 } }), topic(2, { title: 'Old audit', state: 'archived', pos: { x: 400, y: 380 } }), topic(3, { title: 'Proposals v2' })] });
    app.snapshot([row({ id: 'alpha' })]);
    await waitFor(() => expect(app.client.placeTopics).toHaveBeenCalledTimes(1));
    const [p] = vi.mocked(app.client.placeTopics).mock.calls[0]![0];
    for (const q of [{ x: 400, y: 280 }, { x: 400, y: 380 }]) expect(Math.abs(p!.x - q.x) >= 216 || Math.abs(p!.y - q.y) >= 88).toBe(true);
    // Arrange whose save fails: an error, and the nodes back where they were.
    vi.mocked(app.client.placeTopics).mockRejectedValueOnce(new Error('Topics are read-only right now.'));
    const before = at(node('Rates table'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Arrange' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Arrange every node?' })).getByRole('button', { name: 'Arrange' }));
    expect(await screen.findByText('Topics are read-only right now.')).toBeInTheDocument();
    expect(at(node('Rates table'))).toEqual(before);
  });

  it('TOPIC-7.3: a click on a node expands it to its members as small nodes, each with its kind’s icon and a Session’s Status marker; a member node does what its chip does; Esc collapses it', async () => {
    const app = renderApp('/topics', { topics: [topic(1, { title: 'Rates table', pos: { x: 300, y: 200 }, members: [member(SESSION), member(PR_MEMBER), member(TASK_MEMBER)] })] });
    app.snapshot([row({ id: 'alpha' }), row({ id: SESSION_ID, title: 'rates-port', status: 'busy' })]);
    const user = userEvent.setup();
    await user.click(node('Rates table'));
    expect(node('Rates table')).toHaveAttribute('aria-expanded', 'true');
    const members = [...graph().querySelectorAll<HTMLElement>('[data-field="member"]')];
    expect(members.map((m) => m.getAttribute('data-kind'))).toEqual(['session', 'pr', 'task']);
    expect(members[0]!.querySelector('[data-session-marker]')).toHaveAttribute('data-status', 'busy');
    expect(members[1]!.querySelector('[data-slot="pr-icon"]')).toBeInTheDocument();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await user.click(within(graph()).getByRole('button', { name: 'Open anvil #2101 on GitHub' }));
    expect(open).toHaveBeenCalledWith(ANVIL.url, '_blank', 'noopener,noreferrer');
    await user.click(within(graph()).getByRole('button', { name: `Open ${LIGHT.title} in Fantastic` }));
    expect(open).toHaveBeenLastCalledWith(LIGHT.url, '_blank', 'noopener,noreferrer');
    await user.keyboard('{Escape}');
    expect(graph().querySelectorAll('[data-field="member"]')).toHaveLength(0);
    expect(node('Rates table')).toHaveFocus();
    // Enter expands it again; a live Session's node opens it.
    await user.keyboard('{Enter}');
    await user.click(within(graph()).getByRole('button', { name: 'Open rates-port' }));
    expect(window.location.pathname).toBe(`/s/${SESSION_ID}`);
  });

  it('TOPIC-7.4: an Edge drawn from a node’s handle onto another node goes from the first to the second; a click on its label edits the label, reverses it or unlinks it', async () => {
    const app = renderApp('/topics', { topics: [topic(1, { title: 'Rates table', pos: { x: 200, y: 200 } }), topic(2, { title: 'Proposals v2', pos: { x: 600, y: 200 } })] });
    app.snapshot([row({ id: 'alpha' })]);
    const handle = node('Rates table').querySelector('[data-field="handle"]')!;
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(graph().querySelector('svg')!, { pointerId: 1, clientX: 300, clientY: 10 });
    expect(node('Proposals v2').querySelector('[data-field="node"]')!.className).toContain('border-dashed');
    fireEvent.pointerUp(node('Proposals v2'), { pointerId: 1 });
    expect(app.client.linkTopics).toHaveBeenCalledWith(id(1), id(2), null);
    const user = userEvent.setup();
    await user.click(await within(graph()).findByRole('button', { name: 'Edge from Rates table to Proposals v2' }));
    const dialog = screen.getByRole('dialog', { name: 'Edge' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Label' }), 'part of{Enter}');
    expect(app.client.editEdge).toHaveBeenCalledWith(id(1), { other: id(2), label: 'part of' });
    await user.click(await within(graph()).findByRole('button', { name: 'Edge from Rates table to Proposals v2, part of' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Edge' })).getByRole('button', { name: 'Reverse' }));
    expect(app.client.editEdge).toHaveBeenLastCalledWith(id(1), { other: id(2), reverse: true });
    await user.click(await within(graph()).findByRole('button', { name: 'Edge from Proposals v2 to Rates table, part of' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Edge' })).getByRole('button', { name: 'Unlink' }));
    expect(app.client.unlinkTopics).toHaveBeenCalledWith(id(2), id(1));
    await waitFor(() => expect(graph().querySelectorAll('[data-field="edge"]')).toHaveLength(0));
    // A handle dropped on its own node, or on nothing, links nothing.
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(node('Rates table'), { pointerId: 1 });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(graph().querySelector('svg')!, { pointerId: 1 });
    expect(app.client.linkTopics).toHaveBeenCalledTimes(1);
  });

  it('TOPIC-7.6: with no Topic, the graph says "No Topics yet" with New Topic, which makes one and shows its node', async () => {
    const app = renderApp('/topics');
    app.snapshot([row({ id: 'alpha' })]);
    expect(screen.getByText('No Topics yet')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(screen.getByText('No Topics yet').closest<HTMLElement>('[role="status"]')!).getByRole('button', { name: 'New Topic' }));
    await user.type(within(screen.getByRole('dialog', { name: 'New Topic' })).getByRole('textbox', { name: 'Topic title' }), 'Rates table{Enter}');
    expect(app.client.createTopic).toHaveBeenCalledWith('Rates table');
    expect(await within(graph()).findByRole('button', { name: /^Rates table,/ })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('the Topic view (TOPIC-10)', () => {
  it('TOPIC-10.1: Open, Enter on an expanded Topic, a double-click on a graph node or Enter on an expanded one opens the Topic’s view and selects it in the tab; a reload keeps it; an unknown id says the Topic is gone', async () => {
    const app = openApp([topic(1, { title: 'Rates table', pos: { x: 300, y: 200 } }), topic(2, { title: 'Proposals v2', pos: { x: 600, y: 200 } })]);
    const user = await openTopics();
    await openView(user, 'Rates table');
    expect(window.location.pathname).toBe(`/topics/${id(1)}`);
    expect(within(topicView()).getByRole('textbox', { name: 'Topic title' })).toHaveValue('Rates table');
    expect(header('Rates table')).toHaveAttribute('aria-current', 'true');
    // From the graph: a double-click on a node, or Enter on an expanded one.
    await user.click(within(topicView()).getByRole('button', { name: 'Open graph' }));
    await user.dblClick(node('Proposals v2'));
    expect(window.location.pathname).toBe(`/topics/${id(2)}`);
    expect(header('Proposals v2')).toHaveAttribute('aria-current', 'true');
    await user.click(within(topicView()).getByRole('button', { name: 'Open graph' }));
    node('Rates table').focus();
    await user.keyboard('{Enter}');
    expect(node('Rates table')).toHaveAttribute('aria-expanded', 'true');
    expect(window.location.pathname).toBe('/topics');
    await user.keyboard('{Enter}');
    expect(window.location.pathname).toBe(`/topics/${id(1)}`);
    app.unmount();
    // A reload keeps the view.
    const reloaded = renderApp(`/topics/${id(2)}`, { topics: [topic(2, { title: 'Proposals v2' })] });
    reloaded.snapshot([row({ id: 'alpha' })]);
    expect(within(topicView()).getByRole('textbox', { name: 'Topic title' })).toHaveValue('Proposals v2');
    reloaded.unmount();
    // An id no Topic has.
    const gone = renderApp(`/topics/${id(9)}`, { topics: [topic(2, { title: 'Proposals v2' })] });
    gone.snapshot([row({ id: 'alpha' })]);
    expect(screen.getByText('This Topic is gone')).toBeInTheDocument();
    const u = userEvent.setup();
    await u.click(within(screen.getByText('This Topic is gone').closest<HTMLElement>('[role="status"]')!).getByRole('button', { name: 'Open graph' }));
    expect(window.location.pathname).toBe('/topics');
  });

  it('TOPIC-10.1: Back and Forward between two Topic views select each Topic in the tab, and a notes draft never saves into the other Topic', async () => {
    const app = openApp([topic(1, { title: 'Rates', notes: 'rates notes' }), topic(2, { title: 'Other', notes: 'other notes' })]);
    const user = await openTopics();
    await openView(user, 'Rates');
    await openView(user, 'Other');
    await user.click(within(topicView()).getByRole('button', { name: 'Edit' }));
    await user.type(within(topicView()).getByRole('textbox', { name: 'Notes' }), ' draft');
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe(`/topics/${id(1)}`));
    await waitFor(() => expect(within(topicView()).getByRole('textbox', { name: 'Topic title' })).toHaveValue('Rates'));
    expect(header('Rates')).toHaveAttribute('aria-current', 'true');
    expect(within(topicView()).queryByRole('textbox', { name: 'Notes' })).toBeNull();
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(app.client.updateTopic).not.toHaveBeenCalledWith(id(1), expect.objectContaining({ notes: expect.anything() }));
    act(() => window.history.forward());
    await waitFor(() => expect(header('Other')).toHaveAttribute('aria-current', 'true'));
  });

  it('TOPIC-4.4: opening another Topic’s view asks for a Library read when the last one is a minute old', async () => {
    const view = (readAt: number) => ({ state: 'ok' as const, reason: null, path: '/p', topics: [topic(1, { title: 'Rates', members: [member(SESSION)] }), topic(2, { title: 'Other', members: [member({ ...SESSION, ref: { harness: 'claude', sessionId: 'other-one' } })] })], edges: [], pruned: [], libraryReadAt: readAt, recommendations: [], jevAsksToday: 0, summarizing: [], summaryErrors: {} });
    const app = openApp([]);
    app.emit({ type: 'topics', topics: view(Date.now()) });
    const user = await openTopics();
    await openView(user, 'Rates');
    expect(app.client.library).not.toHaveBeenCalled();
    app.emit({ type: 'topics', topics: view(Date.now() - 61_000) });
    await openView(user, 'Other');
    await waitFor(() => expect(app.client.library).toHaveBeenCalledTimes(1));
  });

  it('TOPIC-3.4 (support): S opens the summary’s first chip, a live Session, even when a past member was added first', async () => {
    const app = openApp([topic(1, { title: 'Rates', members: [member({ ...SESSION, ref: { harness: 'claude', sessionId: 'past-one' }, snapshot: { harness: 'claude', title: 'spec', directory: null } }, NOW - 9_000), member(SESSION, NOW - 1_000)] })]);
    const user = await openTopics();
    await user.click(header('Rates'));
    await user.keyboard('s');
    expect(window.location.pathname).toBe(`/s/${SESSION_ID}`);
    expect(app.client.resume).not.toHaveBeenCalled();
  });

  it('TOPIC-10.2: the header has the Topic’s marker, title, chips and counts, then Open graph, Link to Topic…, Archive and Delete; Delete asks, then shows the graph', async () => {
    const app = openApp([topic(1, { title: 'Shipped', members: [member(SESSION), member(PR_MEMBER)] }), topic(2, { title: 'Other' })], work({ mine: [] }));
    const user = await openTopics();
    const view = await openView(user, 'Shipped');
    const banner = within(view).getByRole('banner');
    expect(banner.querySelector('[data-session-marker]')).toHaveAttribute('data-status', 'needs-you');
    expect(within(banner).getByRole('textbox', { name: 'Topic title' })).toHaveValue('Shipped');
    expect(banner.querySelector('[data-field="looks-done"]')).toHaveTextContent('looks done');
    expect(banner.querySelector('[data-field="counts"]')).toHaveTextContent('1 Session · 1 PR');
    expect([...banner.querySelectorAll('[data-field="actions"] [data-action]')].map((b) => b.textContent)).toEqual(['Open graph', 'Link to Topic…', 'Archive', 'Delete']);
    await user.click(within(banner).getByRole('button', { name: 'Archive' }));
    expect(app.client.updateTopic).toHaveBeenCalledWith(id(1), { state: 'archived' });
    await waitFor(() => expect(within(topicView()).getByRole('banner').querySelector('[data-tone="muted"]')).toHaveTextContent('archived'));
    await user.click(within(topicView()).getByRole('button', { name: 'Link to Topic…' }));
    expect(screen.getByRole('dialog', { name: 'Link to Topic' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(within(topicView()).getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Delete “Shipped”?' })).getByRole('button', { name: 'Delete Topic' }));
    expect(app.client.deleteTopic).toHaveBeenCalledWith(id(1));
    await waitFor(() => expect(window.location.pathname).toBe('/topics'));
  });

  it('TOPIC-10.3: the notes show in full, with no six-line cut, and Edit edits them', async () => {
    const notes = ['**Port** the rates table', 'two', 'three', 'four', 'five', 'six', 'seven', 'the eighth line'].join('\n');
    const app = openApp([topic(1, { title: 'Rates', notes })]);
    const user = await openTopics();
    const view = await openView(user, 'Rates');
    expect(view.querySelector('[data-field="notes-text"]')).toHaveTextContent('the eighth line');
    expect(within(view).queryByRole('button', { name: 'more' })).toBeNull();
    await user.click(within(view).getByRole('button', { name: 'Edit' }));
    await user.type(within(view).getByRole('textbox', { name: 'Notes' }), '!');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(app.client.updateTopic).toHaveBeenCalledWith(id(1), { notes: `${notes}!` });
  });

  it('TOPIC-10.4: members in Sessions, PRs and Tasks, each headed with its count; live Sessions first by Status, then past ones; PRs and Tasks in Work first; newest added first within each', async () => {
    const live2 = 'a1b2c3d4-0000-4000-8000-000000000002';
    const sessionMember = (sessionId: string, title: string, addedAt: number) => member({ kind: 'session', ref: { harness: 'claude', sessionId }, snapshot: { harness: 'claude', title, directory: null } }, addedAt);
    const goneTask = (n: number, addedAt: number) => member({ kind: 'task', ref: { id: `9${n}` }, snapshot: { title: `Closed ${n}`, project: 'Lantern Works', url: `https://example.test/${n}` } }, addedAt);
    const gonePr = member({ kind: 'pr', ref: { url: 'https://github.com/productiveio/anvil/pull/1' }, snapshot: { repo: 'anvil', number: 1, title: 'Old anvil', url: 'https://github.com/productiveio/anvil/pull/1' } }, NOW - 1_000);
    const app = openApp([
      topic(1, {
        title: 'Rates',
        members: [sessionMember('past-new', 'past new', NOW - 1_000), sessionMember(live2, 'idle one', NOW - 2_000), sessionMember('past-old', 'past old', NOW - 9_000), member(SESSION, NOW - 8_000), gonePr, member(PR_MEMBER, NOW - 5_000), goneTask(1, NOW - 9_000), member(TASK_MEMBER, NOW - 7_000), goneTask(2, NOW - 1_000)],
      }),
    ]);
    app.snapshot([row({ id: 'alpha' }), row({ id: SESSION_ID, title: 'rates-port', status: 'needs-you' }), row({ id: live2, title: 'idle one', status: 'idle' })]);
    const user = await openTopics();
    const view = await openView(user, 'Rates');
    const sections = [...view.querySelectorAll<HTMLElement>('section')];
    expect(sections.map((s) => s.querySelector('h2')!.textContent)).toEqual(['Summary', 'Sessions4', 'PRs2', 'Tasks3']);
    expect([...view.querySelectorAll('[data-field="session"] button[aria-label^="Open"], [data-field="session"] button[aria-label^="Resume"]')].map((c) => c.getAttribute('aria-label'))).toEqual(['Open rates-port, Needs you', 'Open idle one, Idle', 'Resume past new, past', 'Resume past old, past']);
    expect([...view.querySelectorAll('[data-field="pr"]')].map((l) => l.querySelector('[data-field="member-title"]')!.textContent)).toEqual([ANVIL.title, 'Old anvil']);
    expect([...view.querySelectorAll('[data-field="task"]')].map((l) => l.querySelector('[data-field="member-title"]')!.textContent)).toEqual([LIGHT.title, 'Closed 2', 'Closed 1']);
    expect(within(view).getAllByRole('button', { name: /^Remove .* from Rates$/ })).toHaveLength(9);
  });

  it('TOPIC-10.5: under the members, its recommendations, Outputs and Edges; while the view shows, Work is watched', async () => {
    const app = openApp([topic(1, { title: 'Rates', members: [member(SESSION)], outputs: null }), topic(2, { title: 'Proposals v2' })], work(), {
      edges: [{ from: id(1), to: id(2), label: 'part of', createdAt: NOW }],
      recommendations: [{ key: memberKey('pr', PR_MEMBER.ref), member: PR_MEMBER, topicId: id(1), newTitle: null, source: 'link', confidence: null, reason: 'Linked', createdAt: NOW }],
    });
    const user = await openTopics();
    const view = await openView(user, 'Rates');
    expect([...view.querySelectorAll('section')].map((s) => s.getAttribute('data-field'))).toEqual(['summary', 'sessions', 'topic-recommended', 'outputs', 'edges']);
    // With the sidebar closed, the view still keeps Work read.
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('t');
    expect(screen.queryByTestId('topics-panel')).toBeNull();
    await waitFor(() => expect(app.client.watchWork).toHaveBeenLastCalledWith('tab-1', true));
    await user.click(within(topicView()).getByRole('button', { name: 'Open graph' }));
    await waitFor(() => expect(app.client.watchWork).toHaveBeenLastCalledWith('tab-1', false));
  });
});

describe('a summary of the Topic (TOPIC-11)', () => {
  const SUMMARY = (over: Partial<TopicSummary> = {}): TopicSummary => ({
    answer: {
      what: 'Sharpen the anvil and light the lanterns, part by part.',
      state: 'in progress',
      why: 'The anvil PR is a draft.',
      open: [{ text: 'The corners are still blunt.', cites: [{ key: memberKey('pr', PR_MEMBER.ref), name: 'anvil #2101' }, { key: 'pr:{"url":"https://github.com/productiveio/anvil/pull/1"}', name: 'anvil #1' }] }],
      recent: [{ text: 'The port began.', cites: [{ key: memberKey('session', SESSION.ref), name: 'rates-port' }] }],
      next: [{ text: 'Light the lanterns.', cites: [{ key: memberKey('task', TASK_MEMBER.ref), name: LIGHT.title }] }],
    },
    // The view's age runs on the real clock, ticking each second: 2.5 h reads as "2h" either side of a tick.
    writtenAt: Date.now() - 2.5 * 3_600_000,
    model: 'claude-sonnet-5-5',
    costUsd: 0.04,
    ...over,
  });
  const section = () => within(topicView()).getByRole('region', { name: 'Summary' });

  it('TOPIC-11.1: the view has a Summary section between the header and the notes, with "Summarize" while there is none and "Summarize again" once there is; nothing starts it on its own', async () => {
    const app = openApp([topic(1, { title: 'Anvil', notes: 'Sharp corners.', members: [member(PR_MEMBER)] })]);
    const user = await openTopics();
    await openView(user, 'Anvil');
    const summary = section();
    expect(summary.compareDocumentPosition(within(topicView()).getByText('Sharp corners.')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Opening the view, a poll or a new member never starts one.
    app.emit({ type: 'work', work: work() });
    expect(app.client.summarize).not.toHaveBeenCalled();
    await user.click(within(summary).getByRole('button', { name: 'Summarize' }));
    expect(app.client.summarize).toHaveBeenCalledWith(id(1));
    app.finishSummary(id(1), { summary: SUMMARY() });
    expect(within(section()).getByRole('button', { name: 'Summarize again' })).toBeInTheDocument();
    expect(within(section()).queryByRole('button', { name: 'Summarize' })).toBeNull();
  });

  it('TOPIC-11.4: the summary’s what, state and points, each cited member by its name; a click does what its chip or line does, and a removed one is its name alone', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openApp([topic(1, { title: 'Anvil', members: [member(SESSION), member(PR_MEMBER), member(TASK_MEMBER)], summary: SUMMARY() })]);
    const user = await openTopics();
    await openView(user, 'Anvil');
    const s = section();
    expect(within(s).getByText('Sharpen the anvil and light the lanterns, part by part.')).toBeInTheDocument();
    expect(s.querySelector('[data-field="summary-state"]')).toHaveTextContent('In progress: The anvil PR is a draft.');
    const openPoints = s.querySelector<HTMLElement>('[data-field="summary-open"]')!;
    expect(openPoints).toHaveTextContent('Open');
    expect(openPoints).toHaveTextContent('The corners are still blunt.');
    await user.click(within(openPoints).getByRole('button', { name: 'Open on GitHub: anvil #2101' }));
    expect(open).toHaveBeenCalledWith(ANVIL.url, '_blank', 'noopener,noreferrer');
    // No longer a member: its name, nothing to press.
    expect(within(openPoints).getByText('anvil #1').tagName).toBe('SPAN');
    await user.click(within(s.querySelector<HTMLElement>('[data-field="summary-next"]')!).getByRole('button', { name: `Open in Fantastic: ${LIGHT.title}` }));
    expect(open).toHaveBeenLastCalledWith(LIGHT.url, '_blank', 'noopener,noreferrer');
    await user.click(within(s.querySelector<HTMLElement>('[data-field="summary-recent"]')!).getByRole('button', { name: 'Open rates-port' }));
    expect(window.location.pathname).toBe(`/s/${SESSION_ID}`);
  });

  it('TOPIC-11.4: a cited past Session tb-session no longer has is its name alone, as its chip has no button', async () => {
    const GONE: NewMember = { ...SESSION, ref: { harness: 'claude', sessionId: 'gone-one' }, snapshot: { harness: 'claude', title: 'old fix', directory: null } };
    const app = openApp([topic(1, { title: 'Anvil', members: [member(GONE)], summary: SUMMARY({ answer: { ...SUMMARY().answer, recent: [{ text: 'It was fixed.', cites: [{ key: memberKey('session', GONE.ref), name: 'old fix' }] }] } }) })]);
    const user = await openTopics();
    await openView(user, 'Anvil');
    const recent = () => section().querySelector<HTMLElement>('[data-field="summary-recent"]')!;
    expect(within(recent()).getByRole('button', { name: 'Resume old fix' })).toBeInTheDocument();
    app.emit({ type: 'topics', topics: { state: 'ok', reason: null, path: '/p', topics: [topic(1, { title: 'Anvil', members: [member(GONE)], summary: SUMMARY({ answer: { ...SUMMARY().answer, recent: [{ text: 'It was fixed.', cites: [{ key: memberKey('session', GONE.ref), name: 'old fix' }] }] } }) })], edges: [], pruned: ['claude:gone-one'], libraryReadAt: null, recommendations: [], jevAsksToday: 0, summarizing: [], summaryErrors: {} } });
    expect(within(recent()).queryByRole('button', { name: /old fix/ })).toBeNull();
    expect(within(recent()).getByText('old fix')).toHaveAttribute('title', 'Removed from the index');
  });

  it('TOPIC-11.5: "Out of date", an info chip, once a member or the notes changed since it was written', async () => {
    const app = openApp([topic(1, { title: 'Anvil', members: [member(PR_MEMBER)], summary: SUMMARY() })]);
    const user = await openTopics();
    await openView(user, 'Anvil');
    expect(within(section()).queryByText('Out of date')).toBeNull();
    app.emit({ type: 'topics', topics: { state: 'ok', reason: null, path: '/p', topics: [topic(1, { title: 'Anvil', members: [member(PR_MEMBER)], summary: SUMMARY(), summaryStale: true })], edges: [], pruned: [], libraryReadAt: null, recommendations: [], jevAsksToday: 0, summarizing: [], summaryErrors: {} } });
    const chip = within(section()).getByText('Out of date');
    expect(chip).toHaveAttribute('data-tone', 'info');
    // The summary itself still shows, by its age.
    expect(within(section()).getByText(/2h ago/)).toBeInTheDocument();
  });

  it('TOPIC-11.6: "Summarizing…" with Cancel while it runs, in every tab; a run that failed or was cancelled shows why as an error Alert and keeps the summary before', async () => {
    const app = openApp([topic(1, { title: 'Anvil', members: [member(PR_MEMBER)], summary: SUMMARY() }), topic(2, { title: 'Lanterns' }), topic(3, { title: 'Harbor' })]);
    const user = await openTopics();
    await openView(user, 'Anvil');
    await user.click(within(section()).getByRole('button', { name: 'Summarize again' }));
    expect(within(section()).getByText('Summarizing…')).toBeInTheDocument();
    expect(within(section()).queryByRole('button', { name: 'Summarize again' })).toBeNull();
    // The summary before stays while the new one is written.
    expect(within(section()).getByText('The corners are still blunt.')).toBeInTheDocument();
    await user.click(within(section()).getByRole('button', { name: 'Cancel' }));
    expect(app.client.cancelSummary).toHaveBeenCalledWith(id(1));
    const alert = within(section()).getByRole('alert');
    expect(alert).toHaveTextContent("The summary wasn't written");
    expect(alert).toHaveTextContent('Cancelled. The summary before it is kept.');
    expect(within(section()).getByText('The corners are still blunt.')).toBeInTheDocument();
    // A run another tab started shows here too; one Lookout can't start says why.
    app.emit({ type: 'topics', topics: { state: 'ok', reason: null, path: '/p', topics: [topic(1, { title: 'Anvil', members: [member(PR_MEMBER)], summary: SUMMARY() })], edges: [], pruned: [], libraryReadAt: null, recommendations: [], jevAsksToday: 0, summarizing: [id(1)], summaryErrors: {} } });
    expect(within(section()).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    app.emit({ type: 'topics', topics: { state: 'ok', reason: null, path: '/p', topics: [topic(1, { title: 'Anvil', members: [member(PR_MEMBER)], summary: SUMMARY() })], edges: [], pruned: [], libraryReadAt: null, recommendations: [], jevAsksToday: 0, summarizing: [], summaryErrors: { [id(1)]: { reason: "Claude Code isn't installed: Fleet doesn't find claude. Settings, under Tools, says where it looks.", fix: null } } } });
    expect(within(section()).getByRole('alert')).toHaveTextContent("Claude Code isn't installed");
  });

  it('TOPIC-11.6: a refused start says why in the view', async () => {
    const app = openApp([topic(1, { title: 'Anvil' }), topic(2, { title: 'Lanterns' }), topic(3, { title: 'Harbor' })]);
    await app.client.summarize(id(2));
    await app.client.summarize(id(3));
    const user = await openTopics();
    await openView(user, 'Anvil');
    await user.click(within(section()).getByRole('button', { name: 'Summarize' }));
    expect(await within(topicView()).findByText('2 summaries are being written; try again when one is done.')).toBeInTheDocument();
  });

  it('TOPIC-11.7: under the summary, who wrote it, what it cost and how long ago: "Sonnet 5.5 · $0.04 · 2h ago"', async () => {
    const app = openApp([topic(1, { title: 'Anvil', summary: SUMMARY() })]);
    const user = await openTopics();
    await openView(user, 'Anvil');
    expect(section().querySelector('[data-field="summary-by"]')).toHaveTextContent(/^Sonnet 5\.5 · \$0\.04 · 2h ago$/);
    app.emit({ type: 'topics', topics: { state: 'ok', reason: null, path: '/p', topics: [topic(1, { title: 'Anvil', summary: SUMMARY({ costUsd: 0.003, model: 'claude-opus-5-5' }) })], edges: [], pruned: [], libraryReadAt: null, recommendations: [], jevAsksToday: 0, summarizing: [], summaryErrors: {} } });
    expect(section().querySelector('[data-field="summary-by"]')).toHaveTextContent(/^Opus 5\.5 · <\$0\.01 · 2h ago$/);
  });

  it('TOPIC-11.8: the tab’s expanded Topic shows the summary’s what and state above the notes, with "Out of date" when it is', async () => {
    const app = openApp([topic(1, { title: 'Anvil', notes: 'Sharp corners.', summary: SUMMARY() })]);
    const user = await openTopics();
    await user.click(header('Anvil'));
    const shown = item('Anvil').querySelector<HTMLElement>('[data-field="summary"]')!;
    expect(shown).toHaveTextContent('Sharpen the anvil and light the lanterns, part by part.');
    expect(shown).toHaveTextContent('In progress');
    expect(shown.compareDocumentPosition(within(item('Anvil')).getByText('Sharp corners.')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(shown).queryByText('Out of date')).toBeNull();
    app.emit({ type: 'topics', topics: { state: 'ok', reason: null, path: '/p', topics: [topic(1, { title: 'Anvil', notes: 'Sharp corners.', summary: SUMMARY(), summaryStale: true })], edges: [], pruned: [], libraryReadAt: null, recommendations: [], jevAsksToday: 0, summarizing: [], summaryErrors: {} } });
    expect(within(item('Anvil').querySelector<HTMLElement>('[data-field="summary"]')!).getByText('Out of date')).toHaveAttribute('data-tone', 'info');
    // None yet: nothing is shown for it.
    app.emit({ type: 'topics', topics: { state: 'ok', reason: null, path: '/p', topics: [topic(1, { title: 'Anvil', notes: 'Sharp corners.' })], edges: [], pruned: [], libraryReadAt: null, recommendations: [], jevAsksToday: 0, summarizing: [], summaryErrors: {} } });
    expect(item('Anvil').querySelector('[data-field="summary"]')).toBeNull();
  });
});
