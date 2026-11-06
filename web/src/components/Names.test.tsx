import type { MemorySnapshot } from '@shared/memory.ts';
import type { LibraryPage, OutputItem, OutputSession } from '@shared/library.ts';
import type { LocalServer, PortsSnapshot } from '@shared/ports.ts';
import type { ResJob } from '@shared/res.ts';
import type { HistoryItem, HistoryPage, SessionRow } from '@shared/types.ts';
import { type Topic, memberKey, NO_ACTIVITY } from '@shared/topics.ts';
import type { WorkPr, WorkSnapshot } from '@shared/work.ts';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { nameSuffixes, linkedPrs } from '@/lib/names';
import { reducer, initialState, type LookoutState } from '@/lib/store';
import { NOW, field, renderApp, row, rowEl } from '@/test/helpers';

afterEach(() => window.localStorage.clear());

/** The Session's name, and the title tb-session gave it before the Harness titled it. */
const NAME = 'Fantastic-productive PR 3426';
const OLD = 'let-s-resolve-merge-conflicts';
const live = (over: Partial<SessionRow> = {}) => row({ id: 'a', title: NAME, ownHost: true, ...over });
/** A row's Session chips, by their accessible names (an option's buttons aren't in the accessibility tree's roles). */
const chips = (el: Element) => [...el.querySelectorAll('[data-action="session"]')].map((c) => c.getAttribute('aria-label'));
const remember = (tab: string) => window.localStorage.setItem('lookout.right', JSON.stringify({ open: true, width: 420, tab }));

const history = (over: Partial<HistoryItem> = {}): HistoryItem => ({
  sessionId: 'a', harness: 'claude', headless: false, title: OLD, projectPath: '/Users/me/Projects/work', repo: 'work', branch: 'main',
  lastActiveAt: NOW - 60_000, snippet: null, firstPrompt: null, projectDisplay: '~/Projects/work', blocked: null, ...over,
});
const outputSession = (over: Partial<OutputSession> = {}): OutputSession => ({
  sessionId: 'a', harness: 'claude', title: OLD, projectPath: '/project', projectDisplay: '/project', repo: 'project', branch: null, headless: false,
  lastActiveAt: NOW, snippet: null, firstPrompt: null, blocked: null, pruned: false, event: 'write', ...over,
});
const output = (sessions: OutputSession[]): OutputItem => ({
  kind: 'file', key: '/report.html', type: 'html', title: 'Harbor report', path: '/report.html', url: null, display: '~/report.html', projectPath: '/project',
  repo: 'project', createdAt: NOW - 86_400_000, updatedAt: NOW, events: 3, exists: true, source: null, sourcePath: null, sourceDisplay: null, version: null, sessions,
});
const library = (items: OutputItem[]): LibraryPage => ({ state: 'ok', items, readId: 'read-1', total: items.length, nextPage: 2, hasMore: false, hiddenGone: 0, unfilteredEmpty: false, projects: ['/project'] });
const pr = (number: number, sessions: { sessionId: string; title: string; reason?: string }[]): WorkPr => ({
  repo: 'anvil', number, title: `anvil change ${number}`, url: `https://github.com/productiveio/anvil/pull/${number}`, author: null, createdAt: NOW - 86_400_000,
  ageDays: 1, rotting: 'fresh', ci: 'none', chip: 'draft', column: 'draft_mine', baseBranch: 'develop', taskIds: [],
  links: {
    tasks: [],
    sessions: sessions.map((s) => ({ sessionId: s.sessionId, harness: 'claude', title: s.title, createdAt: NOW - 3_600_000, modifiedAt: NOW, live: true, reason: (s.reason ?? 'started on this PR') as 'started on this PR' })),
    incomplete: false,
  },
});
const work = (prs: WorkPr[]): WorkSnapshot => ({
  prs: { state: 'ok', reason: null, fix: null, stale: false, fetchedAt: NOW, mine: prs, reviewRequests: [], marks: { mine: [], reviewRequests: [] }, taskIds: true },
  tasks: { state: 'no-email', reason: null, fix: null, stale: false, fetchedAt: null, tasks: [] },
  sessionLinks: { state: 'ok', reason: null, fix: null },
  refresh: { cooldownUntil: null, githubBlockedUntil: null },
});
const memory: MemorySnapshot = {
  sampledAt: NOW, old: false, ramBytes: 24e9, pressure: 'normal', watchedBytes: 2.4e9, totalBytes: 12e9,
  lookout: { id: 'lookout', bytes: 96e6, growthBytes: null, cpuPct: 0, top: [] },
  sessions: [{ id: 'a', bytes: 600e6, growthBytes: null, cpuPct: 4, top: [] }], otherBytes: 9.6e9, trend: [], load: { one: 3.3, cores: 12 },
};
const job: ResJob = { id: 'j', pid: 300, kind: 'run', state: 'waiting', prio: 'check', cls: 'vitest@agents-lookout', cores: 3, mb: 2600, since: null, waitingSince: NOW - 60_000, queuedAt: NOW - 60_000, session: null, sessionId: 'a', position: 1 };
const server: LocalServer = {
  pid: 501, ports: [4301], command: 'node', name: 'api', cwd: '/Users/me/Projects/work', dir: 'work', repo: { name: 'work', commonDir: '/Users/me/Projects/work/.git' },
  startedAt: NOW - 60_000, sessionId: 'a', by: 'tree', url: 'http://localhost:4301', devctl: false, lookout: false, shown: true,
};
const ports: PortsSnapshot = { servers: [server], readAt: NOW, error: null };

describe('one name per Session (SIDE-10)', () => {
  it('SIDE-10.2: the Session\'s row, the header, the End Session dialog, the Memory popover\'s row, its res queue and the Servers panel\'s group all name it from the Session list', async () => {
    remember('servers');
    const app = renderApp('/s/a');
    app.snapshot([live()]);
    app.emit({ type: 'memory', memory });
    app.emit({ type: 'res', res: { jobs: [job], readAt: NOW, error: null } });
    app.emit({ type: 'ports', ports });
    const user = userEvent.setup();
    expect(field('a', 'title')).toHaveTextContent(NAME);
    expect(screen.getByRole('heading', { level: 1, name: NAME })).toBeInTheDocument();
    expect(within(document.getElementById('right-panel-servers')!).getByRole('group', { name: NAME })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'End Session' }));
    expect(screen.getByRole('dialog', { name: `End “${NAME}”?` })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Memory details' }));
    const details = screen.getByRole('dialog', { name: 'Memory details' });
    expect(within(details).getByRole('button', { name: new RegExp(`^Open ${NAME}, \\d+ MB$`) })).toBeInTheDocument();
    expect(within(details).getByRole('button', { name: `Open ${NAME}, waiting for vitest` })).toBeInTheDocument();
  });

  it('SIDE-10.2: History\'s result, its chip in Work and in the Library, and a Topic\'s member name a live Session from the Session list; a past one keeps tb-session\'s title', async () => {
    // History: tb-session still has the old title for the live Session; a past one keeps its own.
    remember('history');
    const h = renderApp('/', { history: async (): Promise<HistoryPage> => ({ state: 'ok', items: [history(), history({ sessionId: 'past', title: 'past-title' })], page: 1, hasMore: false }) });
    h.snapshot([live()]);
    const historyRow = (id: string) => document.getElementById('right-panel-history')!.querySelector<HTMLElement>(`[data-session-id="${id}"]`)!;
    await waitFor(() => expect(historyRow('a')).toBeTruthy());
    expect(within(historyRow('a')).getByText(NAME)).toHaveAttribute('data-field', 'title');
    expect(within(historyRow('past')).getByText('past-title')).toBeInTheDocument();
    cleanup();
    window.localStorage.clear();

    // Work: the PR's Linked Session.
    remember('work');
    const w = renderApp('/');
    w.snapshot([live()]);
    w.emit({ type: 'work', work: work([pr(3426, [{ sessionId: 'a', title: OLD }])]) });
    const prRow = await waitFor(() => document.querySelector<HTMLElement>('[data-pr="anvil#3426"]')!);
    fireEvent.click(prRow);
    expect(chips(prRow)).toEqual([`Open ${NAME}, Idle`]);
    expect(within(prRow).queryByText(OLD)).toBeNull();
    cleanup();
    window.localStorage.clear();

    // The Library: an Output's Session.
    remember('library');
    const l = renderApp('/', { library: async () => library([output([outputSession(), outputSession({ sessionId: 'past', title: 'past-title' })])]) });
    l.snapshot([live()]);
    const outputs = await screen.findByRole('listbox', { name: 'Outputs' });
    const outputRow = await waitFor(() => within(outputs).getAllByRole('option')[0]!);
    fireEvent.click(outputRow);
    expect(chips(outputRow)).toEqual([`Open ${NAME}, Idle`, 'Resume past-title, past']);
    cleanup();
    window.localStorage.clear();

    // A Topic's member: its chip and its Remove button.
    const ref = { harness: 'claude' as const, sessionId: 'a' };
    const topic: Topic = {
      id: '00000000-0000-4000-8000-000000000001', title: 'Rates', notes: '', state: 'open', createdAt: NOW - 1e6, updatedAt: NOW, pos: null, summary: null, summaryStale: false,
      members: [{ kind: 'session', ref, snapshot: { harness: 'claude', title: OLD, directory: '~/Projects/work' }, key: memberKey('session', ref), addedAt: NOW - 60_000, reason: 'added by hand' }],
      outputs: { items: [], total: 0 }, ...NO_ACTIVITY,
    };
    const t = renderApp(`/topics/${topic.id}/members`, { topics: [topic] });
    t.snapshot([live()]);
    const main = document.querySelector('main')!;
    expect(await within(main).findByRole('button', { name: `Open ${NAME}, Idle` })).toBeInTheDocument();
    expect(within(main).getByRole('button', { name: `Remove ${NAME} from Rates` })).toBeInTheDocument();
  });

  it('SIDE-10.3: rows that share a name tell themselves apart by a suffix on the first line: the Worktree, else the branch, the Linked PR, then the start time', () => {
    const git = (worktree: string | null, branch: string) => ({ repo: 'work', worktree, branch, commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' });
    const twin = (id: string, over: Partial<SessionRow>) => row({ id, title: OLD, git: git(null, 'main'), procStart: '2026-11-06T09:00:00Z', ...over });
    const suffixes = (rows: SessionRow[], prs = new Map<string, number>()) => Object.fromEntries([...nameSuffixes(rows, prs)].map(([id, s]) => [id, `${s.kind} ${s.text}`]));
    const hhmm = (ts: string, seconds = false) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });
    const alone = row({ id: 'alone', title: 'other' });

    // The Worktree differs: each shows its own; one outside a Worktree says its branch.
    expect(suffixes([twin('one', { git: git('crm-rates', 'fix/rates') }), twin('two', {}), alone])).toEqual({ one: 'worktree crm-rates', two: 'worktree main' });
    // Same Worktree (none), branches differ.
    expect(suffixes([twin('one', { git: { ...git(null, 'main'), repo: 'api' } }), twin('two', { git: git(null, 'develop') })])).toEqual({ one: 'branch main', two: 'branch develop' });
    // Same place: the Linked PR, once Work's list has one.
    const prs = linkedPrs(work([pr(3426, [{ sessionId: 'one', title: OLD }, { sessionId: 'two', title: OLD, reason: 'through PR #1' }]), pr(3500, [{ sessionId: 'two', title: OLD }])]));
    expect([...prs]).toEqual([['one', 3426], ['two', 3500]]);
    expect(suffixes([twin('one', {}), twin('two', {})], prs)).toEqual({ one: 'pr #3426', two: 'pr #3500' });
    // Before Work's list has loaded, or the same PR: the start time; with seconds when the minute is the same too.
    expect(linkedPrs(null).size).toBe(0);
    const a = '2026-11-06T09:00:05Z';
    const b = '2026-11-06T09:00:41Z';
    const c = '2026-11-06T11:07:00Z';
    expect(suffixes([twin('one', { procStart: a }), twin('two', { procStart: b }), twin('three', { procStart: c })])).toEqual({
      one: `start from ${hhmm(a, true)}`,
      two: `start from ${hhmm(b, true)}`,
      three: `start from ${hhmm(c)}`,
    });
    // Three rows, two in one Worktree: the first key that tells all three apart, the start time.
    expect(suffixes([twin('one', { git: git('crm-rates', 'fix/rates'), procStart: a }), twin('two', { git: git('crm-rates', 'fix/rates'), procStart: c }), twin('three', { procStart: '2026-11-06T12:30:00Z' })])).toEqual({
      one: `start from ${hhmm(a)}`,
      two: `start from ${hhmm(c)}`,
      three: `start from ${hhmm('2026-11-06T12:30:00Z')}`,
    });
    // Nothing differs: no suffix.
    expect(suffixes([twin('one', {}), twin('two', {})])).toEqual({});
  });

  it('SIDE-10.3: the suffix sits after the name in the row\'s quieter colour, the second line doesn\'t repeat it, the name gives way first, and the accessible name reads it after the name', () => {
    const app = renderApp();
    const git = (worktree: string | null, branch: string) => ({ repo: 'work', worktree, branch, commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' });
    app.snapshot([
      row({ id: 'one', title: OLD, git: git('crm-rates', 'fix/rates'), locationShown: { repo: false, where: true } }),
      row({ id: 'two', title: OLD, git: git(null, 'main'), locationShown: { repo: false, where: false } }),
      row({ id: 'three', title: 'alone', git: git('crm-rates', 'fix/rates'), locationShown: { repo: false, where: true } }),
    ]);
    const suffix = field('one', 'name-suffix')!;
    expect(suffix).toHaveTextContent('· crm-rates');
    expect(suffix).toHaveAttribute('title', 'Worktree crm-rates');
    expect(suffix).toHaveClass('text-muted-foreground', 'truncate', 'min-w-0', 'max-w-[calc(100%-12ch)]');
    expect(suffix.previousElementSibling).toBe(field('one', 'title'));
    expect(field('one', 'title')).toHaveClass('min-w-0', 'shrink-[1000]', 'truncate');
    // Both on the first line; the second line doesn't repeat the Worktree, so the row keeps two lines.
    expect(field('one', 'title')!.closest('.items-center')).toBe(suffix.closest('.items-center'));
    expect(field('one', 'location')).toBeNull();
    expect(field('two', 'name-suffix')).toHaveTextContent('· main');
    expect(field('three', 'name-suffix')).toBeNull();
    expect(field('three', 'location')).toHaveTextContent('crm-rates');
    // jsdom joins inline text without the space a screen reader hears; the suffix comes right after the name.
    expect(rowEl('one')).toHaveAccessibleName(new RegExp(`^Idle${OLD}crm-ratesClaude Code `));
    // A branch in the suffix leaves a Worktree it doesn't show on the second line (same-named Worktrees in two repos).
    app.snapshot([
      row({ id: 'one', title: OLD, git: { ...git('rates', 'fix/a'), repo: 'api' }, locationShown: { repo: true, where: true } }),
      row({ id: 'two', title: OLD, git: git('rates', 'fix/b'), locationShown: { repo: true, where: true } }),
    ]);
    expect(field('one', 'name-suffix')).toHaveTextContent('· fix/a');
    expect(field('one', 'location')).toHaveTextContent('rates');
  });

  it('SIDE-10.4: a name that changes on its own changes at once while its Session isn\'t selected; the selected one keeps the name it showed, everywhere, until you look away; a rename made here shows at once', async () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: OLD }), row({ id: 'b', title: 'beta' })]);
    const header = () => screen.getByRole('heading', { level: 1 });
    expect(header()).toHaveTextContent(OLD);
    // The Harness titles both: the other row changes at once, the selected one holds, row and header alike.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', title: NAME }), row({ id: 'b', title: 'Beta, titled' })], remove: [] });
    expect(field('b', 'title')).toHaveTextContent('Beta, titled');
    expect(field('a', 'title')).toHaveTextContent(OLD);
    expect(header()).toHaveTextContent(OLD);
    // Another Session selected: it takes its new name.
    const user = userEvent.setup();
    await user.click(field('b', 'title')!);
    expect(field('a', 'title')).toHaveTextContent(NAME);
    expect(header()).toHaveTextContent('Beta, titled');
    // Nothing selected releases it too.
    await user.click(field('a', 'title')!);
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', title: 'Third name' })], remove: [] });
    expect(field('a', 'title')).toHaveTextContent(NAME);
    act(() => window.history.pushState(null, '', '/'));
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await waitFor(() => expect(field('a', 'title')).toHaveTextContent('Third name'));
  });

  it('SIDE-10.4: in the store, a held name survives a snapshot and comes from the latest on release; a rename made here passes, a failed one arms nothing; a reload shows the current name', () => {
    const snap = (rows: SessionRow[]) => ({ type: 'event' as const, event: { type: 'snapshot', sessions: rows, fleet: { state: 'ok' }, settings: initialState.settings, launches: [], started: [], clientId: 'c', memory: null } as never });
    const step = (s: LookoutState, ...actions: Parameters<typeof reducer>[1][]) => actions.reduce(reducer, s);
    let s = step(initialState, snap([row({ id: 'a', title: OLD })]), { type: 'chat-view', sessionId: 'a' });
    s = step(s, snap([row({ id: 'a', title: NAME })]));
    expect(s.sessions.get('a')!.title).toBe(OLD);
    expect(s.lastKnown.get('a')!.title).toBe(OLD);
    expect(s.held).toEqual({ id: 'a', shown: OLD, latest: NAME, accept: null });
    // A rename made here: a list still carrying the Harness's newer title (held meanwhile) isn't it;
    // the name it brings shows at once, and the hold moves to it.
    s = step(s, { type: 'rename-sent', id: 'a', sent: true });
    expect(s.held!.accept).toBe(NAME);
    s = step(s, snap([row({ id: 'a', title: NAME })]));
    expect(s.sessions.get('a')!.title).toBe(OLD);
    s = step(s, snap([row({ id: 'a', title: 'renamed' })]));
    expect(s.sessions.get('a')!.title).toBe('renamed');
    expect(s.held).toEqual({ id: 'a', shown: 'renamed', latest: 'renamed', accept: null });
    // One that failed arms nothing: the Harness's next title still waits.
    s = step(s, { type: 'rename-sent', id: 'a', sent: true }, { type: 'rename-sent', id: 'a', sent: false }, snap([row({ id: 'a', title: 'retitled' })]));
    expect(s.sessions.get('a')!.title).toBe('renamed');
    // Released: the latest name.
    s = step(s, { type: 'chat-view', sessionId: null });
    expect(s.sessions.get('a')!.title).toBe('retitled');
    expect(s.held).toBeNull();
    // A reload: the store starts over, so the current name shows.
    expect(step(initialState, { type: 'chat-view', sessionId: 'a' }, snap([row({ id: 'a', title: 'retitled' })])).sessions.get('a')!.title).toBe('retitled');
  });

  it('SIDE-10.5: the filter also matches a Session\'s first prompt, whether or not its name is that prompt', async () => {
    renderApp().snapshot([
      row({ id: 'titled', title: NAME, firstPrompt: "Let's resolve merge conflicts in the proposals branch" }),
      row({ id: 'prompted', title: 'Port the rates table', firstPrompt: 'Port the rates table' }),
      row({ id: 'none', title: 'other' }),
    ]);
    const user = userEvent.setup();
    await user.keyboard('/');
    await user.keyboard('merge conflicts');
    expect(rowEl('titled')).toBeInTheDocument();
    expect(document.querySelector('[data-session-id="prompted"]')).toBeNull();
    expect(document.querySelector('[data-session-id="none"]')).toBeNull();
    await user.clear(screen.getByRole('searchbox', { name: /filter/i }));
    await user.keyboard('rates table');
    expect(rowEl('prompted')).toBeInTheDocument();
    expect(document.querySelector('[data-session-id="titled"]')).toBeNull();
  });
});
