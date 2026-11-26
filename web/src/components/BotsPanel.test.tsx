import { BOTS_READ_ONLY, type BotInput, type BotRun, type BotView, type BotsSnapshot } from '@shared/bots.ts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { botFact, dayTime, sortBots } from '@/lib/bots';
import { SaveError } from '@/lib/client';
import type { PanelNav } from '@/lib/right-sidebar';
import { HARNESSES, openMore, pickMore, pressRowAction, primaryButtons, renderApp, row, rowActionWords, settings } from '@/test/helpers';
import { BotsPanel, type BotsPanelProps } from './BotsPanel';

// Invented Bots, as the spec's own examples: no real team's.
/** A time in November 2026, in this machine's time zone: the 23rd is a Monday, and "now" is Thursday the 26th at noon. */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
const NOW = at(26, 12);
const DAY = 86_400_000;

const bot = (over: Partial<BotView> & Pick<BotView, 'id' | 'name'>): BotView => ({
  prompt: '/team-week for last week, as a page',
  harness: 'claude',
  model: '',
  effort: 'high',
  skipPermissions: true,
  directory: '~/Projects/people',
  schedule: null,
  on: true,
  since: at(1, 9),
  skipped: 0,
  createdAt: at(1, 9),
  updatedAt: at(1, 9),
  nextAt: null,
  running: null,
  ...over,
});
const run = (over: Partial<BotRun> & Pick<BotRun, 'id' | 'botId'>): BotRun => ({
  botName: 'Team week',
  name: 'Team week · Nov 23',
  dueAt: null,
  startedAt: at(23, 7, 30),
  lateMs: 0,
  state: 'finished',
  sessionId: null,
  harness: 'claude',
  waitingFor: null,
  endedAt: at(23, 7, 41),
  failure: null,
  session: 'ended',
  arrivedAt: at(23, 7, 41),
  title: 'Team week 47',
  holds: { documents: 1, reply: false, first: null },
  read: true,
  archived: false,
  launchId: null,
  ...over,
});
const snapshot = (bots: BotView[], runs: BotRun[] = [], over: Partial<BotsSnapshot> = {}): BotsSnapshot => ({ state: 'ok', path: '~/.lookout/bots.json', error: null, bots, runs, ...over });

const TEAM = bot({ id: 'b-team', name: 'Team week', schedule: { days: ['mon'], time: '07:30' }, nextAt: at(30, 7, 30), model: 'claude-opus-5-5' });
const FLAKY = bot({ id: 'b-flaky', name: 'Flaky tests', prompt: '/flaky-tests since yesterday', schedule: { days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], time: '02:00' }, nextAt: at(27, 2) });
const GOALS = bot({ id: 'b-goals', name: 'Goals check', on: false });

const SETTINGS = settings({ startDirectories: ['~/Projects/work', '~/Projects/people'], lastLaunch: { harness: 'codex', model: 'gpt-6-astra', directory: '~/Projects/people' } });

/** The panel on its own, with a fake server's answers the test can read. */
function mount(bots: BotsSnapshot | null, over: Partial<BotsPanelProps> = {}) {
  const calls = {
    create: vi.fn(async (input: BotInput) => bot({ id: 'b-new', ...input, effort: input.effort ?? null, skipPermissions: input.skipPermissions ?? false, on: true })),
    update: vi.fn(async (id: string, _patch: Partial<BotInput>) => bot({ id, name: 'changed' })),
    remove: vi.fn(async (_id: string) => {}),
    run: vi.fn(async (id: string) => run({ id: 'r-new', botId: id, state: 'starting', endedAt: null, arrivedAt: null })),
    onOpenRun: vi.fn(),
    onLoadHarnesses: vi.fn(),
    onRevealed: vi.fn(),
  };
  const props: BotsPanelProps = {
    bots,
    sessions: new Map(),
    now: NOW,
    focusKey: 0,
    reveal: null,
    settings: SETTINGS,
    harnesses: { state: 'ready', harnesses: HARNESSES },
    keyboardEnabled: true,
    navRef: createRef<PanelNav>(),
    ...calls,
    ...over,
  };
  const view = render(<BotsPanel {...props} />);
  /** The panel again with what changed, as App renders it when the server sends the Bots. */
  const show = (next: Partial<BotsPanelProps>) => view.rerender(<BotsPanel {...props} {...next} />);
  return { ...view, ...calls, show, props };
}

const list = () => screen.getByRole('listbox', { name: 'Bots' });
const options = () => within(list()).queryAllByRole('option');
const titleOf = (option: HTMLElement) => option.querySelector('[data-field="title"]')!.textContent;
const names = () => options().map(titleOf);
const rowOf = (name: string) => options().find((o) => titleOf(o) === name)!;
const fact = (name: string) => rowOf(name).querySelector<HTMLElement>('[data-field="fact"]');
const runNow = (name: string) => rowOf(name).querySelector<HTMLElement>('[data-field="actions"] [data-action="run-now"]')!;
const focusList = () => act(() => list().focus());
const newBot = () => screen.getAllByRole('button', { name: 'New Bot' })[0]!;
/** The line under the field a refusal names, in the dialog. */
const refusal = () => screen.getByRole('dialog').querySelector<HTMLElement>('[data-field="field-error"]');

beforeEach(() => window.localStorage.clear());

describe('the Bots tab (BOT-1)', () => {
  it('BOT-1.1: the seventh tab, after Topics, with lucide’s Bot icon; B opens it, switches to it and closes it; the closed rail has its button under Topics; the open tab is remembered', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'alpha' })]);
    // The closed rail: a button per tab, Bots under Topics.
    const rail = document.querySelector<HTMLElement>('[data-shell-column="right"]')!;
    const railNames = within(rail).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(railNames.indexOf('Bots')).toBe(railNames.indexOf('Topics') + 1);
    expect(within(rail).getByRole('button', { name: 'Bots' }).querySelector('svg.lucide-bot')).not.toBeNull();
    expect(within(rail).getByRole('button', { name: 'Bots' })).toHaveAttribute('title', 'Bots (B)');

    await user.keyboard('b');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['History', 'Work', 'Library', 'Topics', 'Bots', 'Servers', 'Setup']);
    expect(tabs).toHaveLength(7);
    expect(tabs[4]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[4]).toHaveAttribute('title', 'Bots (B)');
    expect(tabs[4]!.querySelector('svg.lucide-bot')).not.toBeNull();
    // From another tab it switches; on Bots it closes the sidebar.
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('w');
    expect(screen.getByRole('tab', { name: 'Work' })).toHaveAttribute('aria-selected', 'true');
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('b');
    expect(screen.getByRole('tab', { name: 'Bots' })).toHaveAttribute('aria-selected', 'true');
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('b');
    expect(screen.queryByRole('tab', { name: 'Bots' })).toBeNull();
    // Not in a text field: the letter is typed.
    await user.type(screen.getByRole('searchbox', { name: 'Filter Sessions' }), 'b');
    expect(screen.queryByRole('tab', { name: 'Bots' })).toBeNull();
    // Which tab is open is remembered with the others' (WORK-1.2).
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('b');
    app.unmount();
    const again = renderApp('/s/a');
    again.snapshot([row({ id: 'a', title: 'alpha' })]);
    expect(screen.getByRole('tab', { name: 'Bots' })).toHaveAttribute('aria-selected', 'true');
  });

  it('BOT-1.2: every Bot is a row of one listbox: on by next time, then on with no time, then off, each group by name; a row shows its name, its schedule in words and one fact about its runs', () => {
    const standup = bot({ id: 'b-standup', name: 'Standup notes', schedule: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '16:00' }, nextAt: at(26, 16) });
    const sweep = bot({ id: 'b-sweep', name: 'Inbox sweep', schedule: { days: ['mon', 'wed'], time: '08:15' }, nextAt: at(30, 8, 15), running: 'r-sweep' });
    const team = { ...TEAM, running: 'r-team' };
    const release = bot({ id: 'b-release', name: 'Release notes' });
    const drafts = bot({ id: 'b-drafts', name: 'Drafts' });
    const archive = bot({ id: 'b-archive', name: 'Archive sweep', on: false, schedule: { days: ['sun'], time: '23:00' } });
    const runs = [
      run({ id: 'r-team', botId: 'b-team', state: 'running', startedAt: at(26, 11, 58), endedAt: null, arrivedAt: null, sessionId: 's-team' }),
      run({ id: 'r-sweep', botId: 'b-sweep', state: 'waiting', startedAt: at(26, 11), endedAt: null, sessionId: 's-sweep' }),
      run({ id: 'r-release', botId: 'b-release', state: 'failed', startedAt: NOW - 2 * DAY, failure: 'Its Session ended before it finished' }),
      run({ id: 'r-release-0', botId: 'b-release', startedAt: NOW - 9 * DAY }),
      run({ id: 'r-goals', botId: 'b-goals', startedAt: NOW - 6 * DAY }),
    ];
    // Sent in another order: the tab sorts them.
    mount(snapshot([GOALS, release, team, archive, FLAKY, drafts, sweep, standup], runs));

    expect(screen.getAllByRole('listbox')).toHaveLength(1);
    expect(names()).toEqual(['Standup notes', 'Flaky tests', 'Team week', 'Inbox sweep', 'Drafts', 'Release notes', 'Archive sweep', 'Goals check']);
    for (const option of options()) expect(option).toHaveAttribute('data-slot', 'row');
    // The name in body medium, the schedule and the rest in meta, muted, on the second line.
    expect(rowOf('Flaky tests').querySelector('[data-field="title"]')).toHaveClass('font-medium');
    const second = (name: string) => rowOf(name).querySelector<HTMLElement>('[data-field="second-line"]')!;
    expect(second('Flaky tests')).toHaveClass('text-meta', 'text-muted-foreground');
    expect(second('Flaky tests')).toHaveTextContent('Every day at 02:00·next Fri 02:00');
    expect(second('Standup notes')).toHaveTextContent('Weekdays at 16:00·next today 16:00');
    // A run that's going is the row's one fact, at the right of its name: the schedule stands alone.
    expect(fact('Team week')).toHaveTextContent('running');
    expect(fact('Team week')).toHaveClass('text-muted-foreground');
    expect(second('Team week')).toHaveTextContent(/^Mondays at 07:30$/);
    expect(fact('Inbox sweep')).toHaveTextContent('waiting on you');
    expect(fact('Inbox sweep')).toHaveClass('text-needs-you-text');
    expect(second('Inbox sweep')).toHaveTextContent(/^Mon, Wed at 08:15$/);
    // No time ahead: its last run's age, a failed one with the warning triangle and its word.
    expect(second('Release notes')).toHaveTextContent('Only by hand·failed 2d ago');
    expect(fact('Release notes')).toHaveClass('text-destructive-text');
    expect(fact('Release notes')!.querySelector('svg.lucide-triangle-alert')).not.toBeNull();
    expect(second('Goals check')).toHaveTextContent('Only by hand·ran 6d ago');
    expect(fact('Goals check')!.querySelector('svg')).toBeNull();
    expect(fact('Goals check')!.className).not.toMatch(/destructive|needs-you/);
    expect(second('Drafts')).toHaveTextContent(/^Only by hand$/);
    // Off: an "Off" chip, the row dimmed, and no next time though it has a schedule.
    for (const name of ['Archive sweep', 'Goals check']) {
      expect(within(rowOf(name)).getByText('Off')).toHaveAttribute('data-slot', 'chip');
      expect(rowOf(name)).toHaveClass('opacity-60');
    }
    expect(second('Archive sweep')).toHaveTextContent(/^Sundays at 23:00$/);
    expect(rowOf('Flaky tests')).not.toHaveClass('opacity-60');
    expect(rowOf('Flaky tests').querySelector('[data-slot="chip"]')).toBeNull();
    // A screen reader hears the row whole.
    expect(rowOf('Inbox sweep')).toHaveAccessibleName('Inbox sweep, Mon, Wed at 08:15, waiting on you');
    expect(rowOf('Goals check')).toHaveAccessibleName('Goals check, Only by hand, ran 6d ago, off');
  });

  it('BOT-1.2: the order is the next time’s, soonest first, and a name breaks a tie', () => {
    const b = (name: string, over: Partial<BotView> = {}) => bot({ id: name, name, ...over });
    const sorted = sortBots([b('Zeta', { on: false }), b('Beta'), b('Late', { nextAt: 3 }), b('Alpha'), b('Soon B', { nextAt: 1 }), b('Soon A', { nextAt: 1 }), b('Eta', { on: false, nextAt: null })]);
    expect(sorted.map((x) => x.name)).toEqual(['Soon A', 'Soon B', 'Late', 'Alpha', 'Beta', 'Eta', 'Zeta']);
  });

  it('BOT-1.3: "New Bot" is above the list, Secondary with a plus; with no Bot the list is an empty state with New Bot as its action', async () => {
    const user = userEvent.setup();
    const { show, onLoadHarnesses } = mount(snapshot([TEAM]));
    const button = screen.getByRole('button', { name: 'New Bot' });
    expect(button).toHaveAttribute('data-variant', 'secondary');
    expect(button.querySelector('svg.lucide-plus')).not.toBeNull();
    expect(button.compareDocumentPosition(list()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('No Bots yet')).toBeNull();

    show({ bots: snapshot([]) });
    const empty = screen.getByRole('status');
    expect(empty).toHaveAttribute('data-slot', 'empty-state');
    expect(empty).toHaveTextContent('No Bots yet');
    expect(empty).toHaveTextContent('A Bot starts a Session on a schedule, and its Report arrives in the Inbox.');
    const action = within(empty).getByRole('button', { name: 'New Bot' });
    expect(action).toHaveAttribute('data-variant', 'secondary');
    expect(options()).toHaveLength(0);
    await user.click(action);
    expect(await screen.findByRole('dialog', { name: 'New Bot' })).toBeInTheDocument();
    // BOT-2.1: the launcher's fields read Fleet's Harnesses as the launcher does when it opens.
    expect(onLoadHarnesses).toHaveBeenCalled();
  });

  it('BOT-1.3: before the server’s first answer the tab says what it reads, and New Bot waits', () => {
    mount(null);
    expect(screen.getByText('Reading Bots…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Bot' })).toBeDisabled();
    expect(screen.queryByText('No Bots yet')).toBeNull();
  });

  it('BOT-1.4: ↑/↓ and j/k move through the rows; Enter expands the selected row, and on the expanded one runs Run now; Esc collapses it; X turns the selected Bot off or on; one row is expanded at a time', async () => {
    const user = userEvent.setup();
    const { run: runBot, update } = mount(snapshot([TEAM, FLAKY, GOALS]));
    const selected = () => options().find((o) => o.getAttribute('aria-selected') === 'true');
    const expandedRows = () => options().filter((o) => o.getAttribute('aria-expanded') === 'true').map(titleOf);
    expect(names()).toEqual(['Flaky tests', 'Team week', 'Goals check']);
    focusList();
    expect(titleOf(selected()!)).toBe('Flaky tests');
    await user.keyboard('j');
    expect(titleOf(selected()!)).toBe('Team week');
    expect(list()).toHaveAttribute('aria-activedescendant', rowOf('Team week').id);
    await user.keyboard('{ArrowDown}');
    expect(titleOf(selected()!)).toBe('Goals check');
    await user.keyboard('{ArrowDown}');
    expect(titleOf(selected()!)).toBe('Goals check');
    await user.keyboard('k');
    expect(titleOf(selected()!)).toBe('Team week');
    await user.keyboard('{ArrowUp}');
    expect(titleOf(selected()!)).toBe('Flaky tests');
    expect(expandedRows()).toEqual([]);

    // Enter expands; on the expanded row it runs its first button.
    await user.keyboard('{Enter}');
    expect(expandedRows()).toEqual(['Flaky tests']);
    expect(runBot).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(runBot).toHaveBeenCalledTimes(1);
    expect(runBot).toHaveBeenCalledWith('b-flaky');
    // Moving on collapses it; another row expands alone.
    await user.keyboard('j');
    expect(expandedRows()).toEqual([]);
    await user.keyboard('{Enter}');
    expect(expandedRows()).toEqual(['Team week']);
    fireEvent.click(rowOf('Goals check'));
    expect(expandedRows()).toEqual(['Goals check']);
    // Esc collapses it and leaves it selected.
    await user.keyboard('{Escape}');
    expect(expandedRows()).toEqual([]);
    expect(titleOf(selected()!)).toBe('Goals check');

    // X: the selected Bot off or on, expanded or not; More shows the key by it.
    await user.keyboard('x');
    expect(update).toHaveBeenLastCalledWith('b-goals', { on: true });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await user.keyboard('k');
    await user.keyboard('{Enter}');
    const menu = await openMore(rowOf('Team week'), user);
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Edit', 'Turn offX', 'Delete']);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(list()).toHaveFocus());
    await user.keyboard('X');
    expect(update).toHaveBeenLastCalledWith('b-team', { on: false });
    // With a modifier it isn't the panel's key.
    fireEvent.keyDown(list(), { key: 'x', metaKey: true });
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('BOT-1.4: the tab strip moves the rows and collapses one through the panel’s nav; keys stand down while a dialog owns the keyboard', async () => {
    const user = userEvent.setup();
    const navRef = createRef<PanelNav>();
    const { update, show } = mount(snapshot([TEAM, FLAKY]), { navRef });
    act(() => navRef.current!.move(1));
    expect(rowOf('Team week')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(rowOf('Team week'));
    expect(rowOf('Team week')).toHaveAttribute('aria-expanded', 'true');
    let collapsed = false;
    act(() => {
      collapsed = navRef.current!.collapse!();
    });
    expect(collapsed).toBe(true);
    expect(rowOf('Team week')).toHaveAttribute('aria-expanded', 'false');
    show({ navRef, keyboardEnabled: false });
    focusList();
    await user.keyboard('x');
    await user.keyboard('k');
    expect(update).not.toHaveBeenCalled();
    expect(rowOf('Team week')).toHaveAttribute('aria-selected', 'true');
  });

  it('SIDE-11.1 (support): the panel takes focus only when asked: not as it mounts or its Bots change, its list once focusKey rises', () => {
    const { show } = mount(snapshot([TEAM]));
    expect(list()).not.toHaveFocus();
    show({ bots: snapshot([TEAM, FLAKY]) });
    expect(document.body).toHaveFocus();
    show({ focusKey: 1 });
    expect(list()).toHaveFocus();
  });

  it('BOT-1.5: an expanded row shows its state, its prompt’s first three lines, where and with what it starts, its runs as a count that lists them, and its actions last: Run now, then Edit, the switch and Delete under More', async () => {
    const user = userEvent.setup();
    const prompt = '/team-week for last week, as a page\nLeave out the weekend.\nName who was out.\nA fourth line, past the three.';
    const team = { ...TEAM, prompt };
    // Seven runs, newest first, as the server sends them: the row lists the newest five.
    const runs = [
      run({ id: 'r-7', botId: 'b-team', state: 'running', name: 'Team week · Nov 26', startedAt: at(26, 11, 50), endedAt: null, arrivedAt: null, sessionId: 's-run' }),
      run({ id: 'r-6', botId: 'b-team', state: 'finished', startedAt: at(23, 7, 30) }),
      run({ id: 'r-other', botId: 'b-flaky', state: 'finished', startedAt: at(26, 2) }),
      run({ id: 'r-5', botId: 'b-team', state: 'failed', name: 'Team week · Nov 16', startedAt: at(16, 7, 30), failure: 'Its Session ended before it finished' }),
      run({ id: 'r-4', botId: 'b-team', state: 'starting', startedAt: at(9, 7, 30), endedAt: null, arrivedAt: null }),
      run({ id: 'r-3', botId: 'b-team', state: 'finished', startedAt: at(2, 7, 30) }),
      run({ id: 'r-2', botId: 'b-team', state: 'finished', startedAt: at(1, 9) }),
      run({ id: 'r-1', botId: 'b-team', state: 'finished', startedAt: at(1, 8) }),
    ];
    const { onOpenRun } = mount(snapshot([{ ...team, running: 'r-7' }, FLAKY], runs), { sessions: new Map([['s-run', row({ id: 's-run', title: 'Team week · Nov 26', status: 'busy' })]]) });
    await user.click(rowOf('Team week'));
    const team$ = rowOf('Team week');
    expect(team$).toHaveAttribute('aria-expanded', 'true');
    // DS-21: built from ui/row-details, in its one order: state, summary, links, actions last.
    const details = team$.querySelector<HTMLElement>('[data-slot="row-details"]')!;
    const order = [...details.querySelectorAll('[data-field="state"], [data-field="row-summary"], [data-field="links"], [data-field="actions"]')].map((el) => el.getAttribute('data-field'));
    expect(order).toEqual(['state', 'row-summary', 'links', 'actions']);
    expect(details.querySelector('[data-field="state"]')).toHaveTextContent('On · Mondays at 07:30 · next Mon 07:30');
    // The prompt: three lines shown, the whole in its tooltip.
    const shownPrompt = details.querySelector<HTMLElement>('[data-field="prompt"]')!;
    expect(shownPrompt).toHaveClass('line-clamp-3');
    expect(shownPrompt).toHaveAttribute('title', prompt);
    // Where and with what it starts, the model by the name the launcher gives it.
    expect(details.querySelector('[data-field="start"]')).toHaveTextContent('~/Projects/people · Claude Code · Opus 5.5 · high · skips permissions');

    // Its runs: a count of the newest five, listed in place, each with its state and when it started.
    const count = details.querySelector<HTMLElement>('[data-field="count"]')!;
    expect(count).toHaveTextContent('5 runs');
    await waitFor(() => expect(count).not.toHaveAttribute('aria-disabled'));
    await user.click(count);
    await user.click(details.querySelector<HTMLElement>('[data-field="show-all"]')!);
    const lines = [...details.querySelectorAll<HTMLElement>('[data-field="link"]')];
    expect(lines.map((l) => l.textContent)).toEqual(['runningtoday 11:50', 'finishedMon 07:30', 'failedNov 16 07:30', 'startingNov 9 07:30', 'finishedNov 2 07:30']);
    // A run that's going shows its Session's own marker and opens its Session; a failed one has the triangle and why.
    expect(lines[0]!.querySelector('[data-session-marker]')).toHaveAttribute('data-status', 'busy');
    expect(lines[0]).toHaveAccessibleName('Open Team week · Nov 26, running');
    expect(lines[2]!.querySelector('svg.lucide-triangle-alert')).toHaveClass('text-destructive-text');
    expect(lines[2]).toHaveAttribute('title', 'Its Session ended before it finished');
    expect(lines[1]).toHaveAccessibleName('Open the Report of Team week · Nov 23, finished');
    await user.click(lines[1]!);
    expect(onOpenRun).toHaveBeenLastCalledWith(runs[1]);
    await user.click(lines[0]!);
    expect(onOpenRun).toHaveBeenLastCalledWith(runs[0]);
    // One still starting, whose start this server no longer names, has nothing to open.
    expect(lines[3]).not.toHaveAttribute('role');
    await user.click(lines[3]!);
    expect(onOpenRun).toHaveBeenCalledTimes(2);
    expect(team$).toHaveAttribute('aria-expanded', 'true');

    // Its actions: Run now, Soft, with the Play icon; the rest under More, Delete in the danger role.
    await user.click(rowOf('Flaky tests'));
    const flaky = rowOf('Flaky tests');
    // Its own runs only, and a few are listed as the row expands.
    expect(flaky.querySelector('[data-field="count"]')).toHaveTextContent(/^1 run$/);
    expect([...flaky.querySelectorAll('[data-field="link"]')].map((l) => l.textContent)).toEqual(['finishedtoday 02:00']);
    const first = runNow('Flaky tests');
    expect(first).toHaveClass('bg-primary-soft', 'text-primary-text');
    expect(first.querySelector('[data-action-icon="run-now"]')).toHaveClass('lucide-play');
    expect(flaky.querySelectorAll('[data-field="actions"] [data-slot="row-action"]')).toHaveLength(2);
    expect(await rowActionWords(flaky, user)).toEqual(['Run now', 'Edit', 'Turn off', 'Delete']);
    const menu = await openMore(flaky, user);
    expect(menu.querySelector('[data-action="delete"]')).toHaveClass('text-destructive-text');
    expect(menu.querySelector('[data-action="turn-off"] [data-action-icon="turn-off"]')).not.toBeNull();
    expect(menu.querySelector('[data-action="edit"]')!.className).not.toMatch(/destructive/);
    await user.keyboard('{Escape}');
    // Another row expanded: this one collapses.
    await user.click(rowOf('Team week'));
    expect(rowOf('Flaky tests')).toHaveAttribute('aria-expanded', 'false');
  });

  it('BOT-1.5, BOT-4.3: a run with no Session yet opens its start, where its Trust prompt is answered', async () => {
    const user = userEvent.setup();
    const trust = run({ id: 'r-9', botId: 'b-team', state: 'waiting', waitingFor: 'Trust prompt', name: 'Team week · Nov 26', startedAt: at(26, 11, 50), endedAt: null, launchId: 'launch-9' });
    const { onOpenRun } = mount(snapshot([{ ...TEAM, running: 'r-9' }], [trust]));
    await user.click(rowOf('Team week'));
    const details = rowOf('Team week').querySelector<HTMLElement>('[data-slot="row-details"]')!;
    // One run: its list is open as the row expands (DS-21.2).
    expect(details.querySelector('[data-field="count"]')).toHaveTextContent('1 run');
    const line = await waitFor(() => {
      const link = rowOf('Team week').querySelector<HTMLElement>('[data-field="link"]');
      expect(link).not.toBeNull();
      return link!;
    });
    expect(line).toHaveAccessibleName('Open the start of Team week · Nov 26, waiting on you');
    // A row that just expanded takes no press for a moment (DS-21).
    await waitFor(() => expect(line).not.toHaveAttribute('aria-disabled'));
    await user.click(line);
    expect(onOpenRun).toHaveBeenLastCalledWith(trust);
  });

  it("BOT-2.6: a lock this server couldn't write is said as an error, with why, and nothing can be changed", () => {
    const why = "Lookout couldn't write the lock beside ~/.lookout/bots.json (EACCES), so the Bots don't run.";
    mount(snapshot([TEAM], [], { state: 'read-only', error: why }));
    const notice = screen.getByRole('alert');
    expect(notice).toHaveAttribute('data-tone', 'error');
    expect(notice).toHaveTextContent(why);
    expect(screen.getByRole('button', { name: 'New Bot' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New Bot' })).toHaveAttribute('title', why);
  });

  it('BOT-1.5: a Bot that never ran has no runs to count, and its model is the Harness’s default', () => {
    mount(snapshot([GOALS]));
    fireEvent.click(rowOf('Goals check'));
    const goals = rowOf('Goals check');
    expect(goals.querySelector('[data-field="links"]')).toBeNull();
    expect(goals.querySelector('[data-field="start"]')).toHaveTextContent('~/Projects/people · Claude Code · Default · high · skips permissions');
    // Expanded, the state line says Off, in place of the chip.
    expect(goals.querySelector('[data-slot="chip"]')).toBeNull();
    expect(goals).not.toHaveClass('opacity-60');
  });

  it('INBOX-2.2 (support): a Bot to reveal is selected and expanded, once', () => {
    const onRevealed = vi.fn();
    const { show } = mount(snapshot([TEAM, FLAKY, GOALS]), { onRevealed });
    expect(onRevealed).not.toHaveBeenCalled();
    show({ reveal: 'b-goals', onRevealed });
    expect(rowOf('Goals check')).toHaveAttribute('aria-selected', 'true');
    expect(rowOf('Goals check')).toHaveAttribute('aria-expanded', 'true');
    expect(onRevealed).toHaveBeenCalled();
    // Taken once: App clears it, and the row is yours to collapse.
    show({ reveal: null, onRevealed });
    fireEvent.keyDown(list(), { key: 'Escape' });
    expect(rowOf('Goals check')).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('make, change and delete a Bot (BOT-2)', () => {
  it('BOT-2.1: New Bot opens the dialog with Name, the launcher’s fields as the launcher would start them, Prompt and Schedule on "Only by hand"; Save is the one Primary and ⌘Enter; Esc and Cancel close it without saving', async () => {
    const user = userEvent.setup();
    const { create } = mount(snapshot([]));
    await user.click(newBot());
    const dialog = await screen.findByRole('dialog', { name: 'New Bot' });
    // Name first, then the launcher's fields in its order, the Prompt, then the Schedule.
    const labels = [...dialog.querySelector('form > .grid')!.children].filter((el) => el.matches('label, span[id]')).map((el) => el.textContent);
    expect(labels).toEqual(['Name', 'Directory', 'Harness', 'Model', 'Prompt', 'Schedule']);
    expect(screen.getByLabelText('Name')).toHaveAttribute('maxlength', '64');
    expect(screen.getByLabelText('Prompt')).toHaveAttribute('maxlength', '20000');
    expect(screen.getByLabelText('Prompt').tagName).toBe('TEXTAREA');
    // LAUNCH-1.2: the Harness, model and Start directory used last; LAUNCH-3.4, 3.5: high, and Codex's permissions.
    expect(screen.getByRole('radio', { name: /Codex/ })).toBeChecked();
    expect(screen.getByLabelText('Model')).toHaveValue('gpt-6-astra');
    expect(screen.getByLabelText('Directory')).toHaveValue('~/Projects/people');
    expect(within(screen.getByLabelText('Directory')).getAllByRole('option').map((o) => o.textContent)).toEqual(['~/Projects/work', '~/Projects/people']);
    expect(screen.getByLabelText('Effort')).toHaveValue('high');
    expect(screen.getByRole('checkbox', { name: 'Skip permissions' })).not.toBeChecked();
    expect(screen.getByText("Also turns off Codex's sandbox")).toBeInTheDocument();
    expect(within(screen.getByRole('radiogroup', { name: 'Harness' })).getAllByRole('img').map((i) => i.getAttribute('aria-label'))).toEqual(['Claude Code', 'Codex']);
    const schedule = within(dialog).getByRole('radiogroup', { name: 'Schedule' });
    expect(within(schedule).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Only by hand', 'On a schedule']);
    expect(within(schedule).getByRole('radio', { name: 'Only by hand' })).toBeChecked();
    expect(within(dialog).queryByRole('checkbox', { name: 'Mon' })).toBeNull();
    // DS-18: Save is the dialog's one Primary, at the form size.
    expect(primaryButtons(dialog).map((b) => b.textContent)).toEqual(['Save⌘↵']);
    expect(primaryButtons(dialog)[0]).toHaveAttribute('data-size', 'form');

    // Esc and Cancel close it without saving, and what was typed is gone the next time.
    await user.type(screen.getByLabelText('Name'), 'Team week');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(newBot()).toHaveFocus());
    await user.click(newBot());
    await screen.findByRole('dialog', { name: 'New Bot' });
    expect(screen.getByLabelText('Name')).toHaveValue('');
    await user.type(screen.getByLabelText('Name'), 'Team week');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create).not.toHaveBeenCalled();

    // The launcher's rules: another Harness starts on its own default model, with its own Effort and permissions.
    await user.click(newBot());
    await screen.findByRole('dialog', { name: 'New Bot' });
    await user.type(screen.getByLabelText('Name'), 'Team week');
    await user.type(screen.getByLabelText('Prompt'), '/team-week for last week{Enter}as a page');
    await user.click(screen.getByRole('radio', { name: /Claude Code/ }));
    expect(screen.getByLabelText('Model')).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: 'Skip permissions' })).toBeChecked();
    await user.selectOptions(screen.getByLabelText('Model'), 'claude-opus-5-5');
    await user.selectOptions(screen.getByLabelText('Effort'), 'xhigh');
    await user.selectOptions(screen.getByLabelText('Directory'), '~/Projects/work');
    // ⌘Enter saves, from any field.
    await user.click(screen.getByLabelText('Prompt'));
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create).toHaveBeenCalledTimes(1);
    // A new Bot is on (the server's default) and only by hand.
    expect(create).toHaveBeenCalledWith({ name: 'Team week', prompt: '/team-week for last week\nas a page', harness: 'claude', model: 'claude-opus-5-5', effort: 'xhigh', skipPermissions: true, directory: '~/Projects/work', schedule: null });
  });

  it('BOT-2.1: Edit opens the same dialog on the Bot, and saves only what changed', async () => {
    const user = userEvent.setup();
    const { update, create } = mount(snapshot([TEAM]));
    await user.click(rowOf('Team week'));
    await pickMore(rowOf('Team week'), 'edit', user);
    const dialog = await screen.findByRole('dialog', { name: 'Edit Bot' });
    expect(screen.getByLabelText('Name')).toHaveValue('Team week');
    expect(screen.getByLabelText('Prompt')).toHaveValue('/team-week for last week, as a page');
    expect(screen.getByRole('radio', { name: /Claude Code/ })).toBeChecked();
    expect(screen.getByLabelText('Model')).toHaveValue('claude-opus-5-5');
    expect(screen.getByLabelText('Effort')).toHaveValue('high');
    expect(screen.getByRole('checkbox', { name: 'Skip permissions' })).toBeChecked();
    expect(screen.getByLabelText('Directory')).toHaveValue('~/Projects/people');
    expect(within(dialog).getByRole('radio', { name: 'On a schedule' })).toBeChecked();
    expect(within(dialog).getAllByRole('checkbox').filter((c) => (c as HTMLInputElement).checked).map((c) => c.closest('label')!.textContent)).toEqual(['Skip permissions', 'Mon']);
    expect(screen.getByLabelText('Time')).toHaveValue('07:30');

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Team week, short');
    await user.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('b-team', { name: 'Team week, short' });
    expect(create).not.toHaveBeenCalled();
    // Focus goes back to the list, so its keys work again.
    await waitFor(() => expect(list()).toHaveFocus());

    // Nothing changed: nothing is sent.
    await pickMore(rowOf('Team week'), 'edit', user);
    await screen.findByRole('dialog', { name: 'Edit Bot' });
    await user.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('BOT-2.2: what the server refuses is said beside its field, and the dialog keeps everything typed', async () => {
    const user = userEvent.setup();
    const refusals = [new SaveError('Give the Bot a name.', 'name', 400), new SaveError('Pick one of the start directories from Settings.', 'directory', 400), new SaveError('Pick at least one day.', 'schedule', 400), new SaveError('Lookout couldn’t save the Bots.', null, 500)];
    const create = vi.fn(async (_input: BotInput): Promise<BotView> => {
      throw refusals.shift()!;
    });
    mount(snapshot([]), { create });
    await user.click(newBot());
    const dialog = await screen.findByRole('dialog', { name: 'New Bot' });
    await user.type(screen.getByLabelText('Prompt'), '/flaky-tests since yesterday');
    await user.click(within(dialog).getByRole('radio', { name: 'On a schedule' }));
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) await user.click(within(dialog).getByRole('checkbox', { name: day }));
    const save = () => user.click(screen.getByRole('button', { name: /Save/ }));
    const kept = () => {
      expect(screen.getByRole('dialog', { name: 'New Bot' })).toBeInTheDocument();
      expect(screen.getByLabelText('Prompt')).toHaveValue('/flaky-tests since yesterday');
      expect(within(dialog).getByRole('radio', { name: 'On a schedule' })).toBeChecked();
    };

    // The name: said under the Name field, which is marked and described by it.
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the Bot a name.');
    expect(refusal()!.previousElementSibling).toBe(screen.getByLabelText('Name'));
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Give the Bot a name.');
    expect(screen.getByLabelText('Prompt')).not.toHaveAttribute('aria-invalid');
    kept();
    // It stays until its own field changes.
    await user.type(screen.getByLabelText('Prompt'), '!');
    expect(refusal()).toHaveTextContent('Give the Bot a name.');
    await user.clear(screen.getByLabelText('Prompt'));
    await user.type(screen.getByLabelText('Prompt'), '/flaky-tests since yesterday');
    await user.type(screen.getByLabelText('Name'), 'Flaky tests');
    expect(refusal()).toBeNull();

    // A field of the launcher's: under that field.
    await save();
    await waitFor(() => expect(refusal()).toHaveTextContent('Pick one of the start directories from Settings.'));
    expect(refusal()!.previousElementSibling).toBe(screen.getByLabelText('Directory'));
    expect(screen.getByLabelText('Directory')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
    kept();

    // The schedule: under the Schedule.
    await save();
    await waitFor(() => expect(refusal()).toHaveTextContent('Pick at least one day.'));
    expect(refusal()!.previousElementSibling).toBe(within(dialog).getByRole('group', { name: 'Schedule' }));
    kept();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Sat' }));
    expect(refusal()).toBeNull();

    // A refusal about no field: above the buttons.
    await save();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Lookout couldn’t save the Bots.'));
    expect(refusal()).toBeNull();
    kept();
    expect(screen.getByLabelText('Name')).toHaveValue('Flaky tests');
    expect(create).toHaveBeenCalledTimes(4);
  });

  it('BOT-2.3: a change reaches the tab without a reload; a store that can’t be read leaves the tab saying so, with its path, and nothing to save with', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'alpha' })]);
    await user.keyboard('b');
    const panel = screen.getByTestId('bots-panel');
    app.emit({ type: 'bots', bots: snapshot([TEAM]) });
    expect(names()).toEqual(['Team week']);
    app.emit({ type: 'bots', bots: snapshot([TEAM, FLAKY]) });
    expect(names()).toEqual(['Flaky tests', 'Team week']);

    app.emit({ type: 'bots', bots: snapshot([], [], { state: 'unreadable', error: 'It isn’t JSON.' }) });
    const alert = within(panel).getByRole('alert');
    expect(alert).toHaveAttribute('data-tone', 'error');
    expect(alert).toHaveAttribute('data-layout', 'box');
    expect(alert).toHaveTextContent('~/.lookout/bots.json');
    expect(alert).toHaveTextContent('It isn’t JSON.');
    expect(alert).toHaveTextContent('nothing is saved until it can be read');
    // A failure isn't an empty state, and New Bot waits, saying why.
    expect(within(panel).queryByText('No Bots yet')).toBeNull();
    expect(within(panel).getByRole('button', { name: 'New Bot' })).toBeDisabled();
    expect(within(panel).getByRole('button', { name: 'New Bot' })).toHaveAttribute('title', 'Nothing can be saved while ~/.lookout/bots.json can’t be read.');
    // Put right, it's back by itself.
    app.emit({ type: 'bots', bots: snapshot([TEAM]) });
    expect(within(panel).queryByRole('alert')).toBeNull();
    expect(within(panel).getByRole('button', { name: 'New Bot' })).toBeEnabled();
    expect(names()).toEqual(['Team week']);
  });

  it('BOT-2.3: while the store can’t be read, Edit, Run now and the switch are disabled on a Bot that still shows', async () => {
    const user = userEvent.setup();
    const { run: runBot, update } = mount(snapshot([TEAM], [], { state: 'unreadable', error: 'It isn’t JSON.' }));
    await user.click(rowOf('Team week'));
    expect(runNow('Team week')).toHaveAttribute('aria-disabled', 'true');
    const menu = await openMore(rowOf('Team week'), user);
    for (const action of ['edit', 'turn-off', 'delete']) expect(menu.querySelector(`[data-action="${action}"]`)).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Escape}');
    focusList();
    await user.keyboard('x');
    await user.keyboard('{Enter}');
    expect(update).not.toHaveBeenCalled();
    expect(runBot).not.toHaveBeenCalled();
  });

  it('BOT-2.4: Delete asks first, naming the Bot and saying its Reports stay in the Inbox, its confirm the red fill; a Bot with a run going can’t be deleted', async () => {
    const user = userEvent.setup();
    let refuse = true;
    const remove = vi.fn(async (_id: string) => {
      if (refuse) throw new SaveError("It's running. Wait for it, or end its Session.", null, 409);
    });
    const { show } = mount(snapshot([TEAM, FLAKY]), { remove });
    await user.click(rowOf('Flaky tests'));
    await pickMore(rowOf('Flaky tests'), 'delete', user);
    const dialog = await screen.findByRole('dialog', { name: 'Delete “Flaky tests”?' });
    expect(dialog).toHaveTextContent('Its Reports stay in the Inbox');
    expect(remove).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    expect(confirm).toHaveAttribute('data-variant', 'destructive');
    expect(confirm.querySelector('[data-action-icon="delete"]')).not.toBeNull();
    expect(dialog.querySelectorAll('[data-variant="destructive"], [data-variant="primary"]')).toHaveLength(1);
    // The server refuses it (a run started meanwhile): its words show here, and the Bot stays.
    await user.click(confirm);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("It's running. Wait for it, or end its Session.");
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Cancel deletes nothing.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(remove).toHaveBeenCalledTimes(1);

    // A run the tab already knows of: the dialog says so, and its confirm waits for it.
    show({ remove, bots: snapshot([TEAM, { ...FLAKY, running: 'r-1' }], [run({ id: 'r-1', botId: 'b-flaky', state: 'running', endedAt: null, arrivedAt: null })]) });
    await pickMore(rowOf('Flaky tests'), 'delete', user);
    const again = await screen.findByRole('dialog', { name: 'Delete “Flaky tests”?' });
    expect(within(again).getByRole('alert')).toHaveTextContent("It's running. Wait for it, or end its Session.");
    expect(within(again).getByRole('button', { name: 'Delete' })).toBeDisabled();
    // Its run over, it can go.
    refuse = false;
    show({ remove, bots: snapshot([TEAM, FLAKY]) });
    expect(within(again).queryByRole('alert')).toBeNull();
    await user.click(within(again).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(remove).toHaveBeenLastCalledWith('b-flaky');
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('BOT-2.5: Turn off and Turn on send only the switch, and an off Bot still has Run now; a refusal is said at the panel’s top', async () => {
    const user = userEvent.setup();
    let fail = false;
    const update = vi.fn(async (id: string, _patch: Partial<BotInput>) => {
      if (fail) throw new SaveError('Lookout couldn’t save the Bots.', null, 500);
      return bot({ id, name: 'changed' });
    });
    const { run: runBot } = mount(snapshot([TEAM, GOALS]), { update });
    await user.click(rowOf('Team week'));
    await pickMore(rowOf('Team week'), 'turn-off', user);
    expect(update).toHaveBeenLastCalledWith('b-team', { on: false });
    await waitFor(() => expect(list()).toHaveFocus());

    // Off: More offers Turn on, and Run now still works (BOT-4.2).
    await user.click(rowOf('Goals check'));
    const goals = rowOf('Goals check');
    expect(goals.querySelector('[data-field="state"]')).toHaveTextContent('Off · Only by hand');
    expect(await rowActionWords(goals, user)).toEqual(['Run now', 'Edit', 'Turn on', 'Delete']);
    expect(runNow('Goals check')).not.toHaveAttribute('aria-disabled');
    await pressRowAction(user, runNow('Goals check'));
    expect(runBot).toHaveBeenCalledWith('b-goals');
    await pickMore(goals, 'turn-on', user);
    expect(update).toHaveBeenLastCalledWith('b-goals', { on: true });
    expect(update).toHaveBeenCalledTimes(2);

    fail = true;
    await waitFor(() => expect(list()).toHaveFocus());
    await user.keyboard('x');
    expect(await screen.findByRole('alert')).toHaveTextContent('Lookout couldn’t save the Bots.');
    expect(screen.getByRole('alert').closest('[data-testid="bots-panel"]')).not.toBeNull();
  });

  it('BOT-2.6: on a second server the tab says another Lookout runs the Bots, in an info Alert, and New Bot, Edit, Run now, the switch and Delete are disabled; the list still shows, rows expand and a run’s line opens', async () => {
    const user = userEvent.setup();
    const done = run({ id: 'r-1', botId: 'b-team' });
    const { run: runBot, update, remove, create, onOpenRun } = mount(snapshot([TEAM, GOALS], [done], { state: 'read-only' }));
    const notice = screen.getByRole('status');
    expect(notice).toHaveAttribute('data-slot', 'alert');
    expect(notice).toHaveAttribute('data-tone', 'info');
    expect(notice).toHaveTextContent(BOTS_READ_ONLY);
    expect(notice).toHaveTextContent("Another Lookout on this Mac runs the Bots. Here they can't be changed.");
    expect(screen.queryByRole('alert')).toBeNull();
    // New Bot is disabled, saying why.
    expect(screen.getByRole('button', { name: 'New Bot' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New Bot' })).toHaveAttribute('title', BOTS_READ_ONLY);

    // The Bots show as their owner last wrote them, and a row expands.
    expect(names()).toEqual(['Team week', 'Goals check']);
    await user.click(rowOf('Team week'));
    const team = rowOf('Team week');
    expect(team).toHaveAttribute('aria-expanded', 'true');
    expect(team.querySelector('[data-field="state"]')).toHaveTextContent('On · Mondays at 07:30 · next Mon 07:30');
    expect(runNow('Team week')).toHaveAttribute('aria-disabled', 'true');
    expect(runNow('Team week')).toHaveAttribute('title', BOTS_READ_ONLY);
    const menu = await openMore(team, user);
    for (const action of ['edit', 'turn-off', 'delete']) expect(menu.querySelector(`[data-action="${action}"]`)).toHaveAttribute('aria-disabled', 'true');
    await user.click(menu.querySelector<HTMLElement>('[data-action="delete"]')!).catch(() => {});
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    // A press on Run now, and the keys: nothing is sent.
    fireEvent.click(runNow('Team week'), { detail: 1 });
    focusList();
    await user.keyboard('{Enter}');
    await user.keyboard('x');
    await user.keyboard('j');
    await user.keyboard('x');
    expect(runBot).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    // The keys still move through the rows, and a run's line still opens its Report.
    expect(rowOf('Goals check')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(rowOf('Team week'));
    fireEvent.click(rowOf('Team week').querySelector<HTMLElement>('[data-field="link"]')!, { detail: 1 });
    expect(onOpenRun).toHaveBeenCalledWith(done);
  });
});

describe('the schedule (BOT-3)', () => {
  it('BOT-3.1: the dialog’s schedule is "Only by hand", or seven day toggles Mon to Sun and one time, read back in words as it’s picked and sent Monday first', async () => {
    const user = userEvent.setup();
    const { create } = mount(snapshot([]));
    await user.click(newBot());
    const dialog = await screen.findByRole('dialog', { name: 'New Bot' });
    await user.type(screen.getByLabelText('Name'), 'Flaky tests');
    await user.type(screen.getByLabelText('Prompt'), '/flaky-tests since yesterday');
    await user.click(within(dialog).getByRole('radio', { name: 'On a schedule' }));
    const days = within(dialog).getByRole('group', { name: 'Days' });
    expect(within(days).getAllByRole('checkbox').map((c) => c.closest('label')!.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    const words = () => dialog.querySelector('[data-field="schedule-words"]');
    const day = (name: string) => within(days).getByRole('checkbox', { name });
    // It starts on the weekdays at nine, until you pick.
    expect(words()).toHaveTextContent('Weekdays at 09:00');
    expect(screen.getByLabelText('Time')).toHaveAttribute('type', 'time');
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '07:30' } });
    expect(words()).toHaveTextContent('Weekdays at 07:30');
    await user.click(day('Sat'));
    await user.click(day('Sun'));
    expect(words()).toHaveTextContent('Every day at 07:30');
    for (const name of ['Tue', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon']) await user.click(day(name));
    expect(words()).toHaveTextContent('Wednesdays at 07:30');
    // Picked out of order, said and sent Monday first.
    await user.click(day('Mon'));
    expect(words()).toHaveTextContent('Mon, Wed at 07:30');
    expect(day('Mon').closest('label')!.className).toMatch(/has-checked:bg-accent/);
    // No day: nothing to say yet, and the server says what's missing (BOT-2.2).
    await user.click(day('Mon'));
    await user.click(day('Wed'));
    expect(words()).toBeNull();
    await user.click(day('Wed'));
    await user.click(day('Mon'));
    // "Only by hand" keeps the days for a change of mind.
    await user.click(within(dialog).getByRole('radio', { name: 'Only by hand' }));
    expect(within(dialog).queryByRole('group', { name: 'Days' })).toBeNull();
    await user.click(within(dialog).getByRole('radio', { name: 'On a schedule' }));
    expect(words()).toHaveTextContent('Mon, Wed at 07:30');
    await user.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Flaky tests', schedule: { days: ['mon', 'wed'], time: '07:30' } }));
  });

  it('BOT-3.5: an expanded row says how many times were skipped while the Bot’s own run was going, and nothing when none was', async () => {
    const user = userEvent.setup();
    const { show } = mount(snapshot([{ ...TEAM, skipped: 1 }, FLAKY]));
    await user.click(rowOf('Team week'));
    expect(rowOf('Team week').querySelector('[data-field="skipped"]')).toHaveTextContent(/^Skipped 1 time while it was running$/);
    show({ bots: snapshot([{ ...TEAM, skipped: 3 }, FLAKY]) });
    expect(rowOf('Team week').querySelector('[data-field="skipped"]')).toHaveTextContent(/^Skipped 3 times while it was running$/);
    // Its next run started: the server counts from nothing again.
    show({ bots: snapshot([{ ...TEAM, skipped: 0 }, FLAKY]) });
    expect(rowOf('Team week').querySelector('[data-field="skipped"]')).toBeNull();
  });

  it('BOT-3.6: a row’s "next" is its next time as a day and a time; a Bot that is off, or only by hand, has none', () => {
    // Today, a day of this week, and the same day of next week.
    expect(dayTime(at(26, 16), NOW)).toBe('today 16:00');
    expect(dayTime(at(27, 2), NOW)).toBe('Fri 02:00');
    expect(dayTime(at(30, 7, 30), NOW)).toBe('Mon 07:30');
    expect(dayTime(at(26, 7, 5) + 7 * DAY, NOW)).toBe('Thu 07:05');
    // A run's start, behind: the day within a week, the date before that.
    expect(dayTime(at(23, 7, 30), NOW)).toBe('Mon 07:30');
    expect(dayTime(at(16, 7, 30), NOW)).toBe('Nov 16 07:30');
    expect(botFact(TEAM, [], NOW)).toEqual({ kind: 'next', words: 'next Mon 07:30' });
    expect(botFact({ ...FLAKY, nextAt: at(26, 23, 59) }, [], NOW)).toEqual({ kind: 'next', words: 'next today 23:59' });
    // Off (the server sends no next time) and only by hand: none.
    expect(botFact({ ...TEAM, on: false, nextAt: null }, [], NOW)).toBeNull();
    expect(botFact(bot({ id: 'b-hand', name: 'By hand' }), [], NOW)).toBeNull();

    mount(snapshot([TEAM, { ...FLAKY, on: false, nextAt: null }, bot({ id: 'b-hand', name: 'By hand' })]));
    expect(fact('Team week')).toHaveTextContent(/^next Mon 07:30$/);
    expect(fact('Flaky tests')).toBeNull();
    expect(fact('By hand')).toBeNull();
    // Expanded, the state line says it too, and leaves it out for a Bot with none.
    fireEvent.click(rowOf('Team week'));
    expect(rowOf('Team week').querySelector('[data-field="state"]')).toHaveTextContent('On · Mondays at 07:30 · next Mon 07:30');
    fireEvent.click(rowOf('Flaky tests'));
    expect(rowOf('Flaky tests').querySelector('[data-field="state"]')).toHaveTextContent(/^Off · Every day at 02:00$/);
  });
});

describe('a run (BOT-4)', () => {
  it('BOT-4.2: Run now starts a run at once, on or off; while one of the Bot’s runs is going the button is disabled and says "It\'s running"', async () => {
    const user = userEvent.setup();
    let fail: SaveError | null = null;
    const runBot = vi.fn(async (id: string) => {
      if (fail) throw fail;
      return run({ id: 'r-new', botId: id, state: 'starting', endedAt: null, arrivedAt: null });
    });
    const { show } = mount(snapshot([TEAM, GOALS]), { run: runBot });
    await user.click(rowOf('Team week'));
    const button = runNow('Team week');
    expect(button).toHaveTextContent('Run now');
    expect(button).toHaveAttribute('title', 'Run now (Enter)');
    await pressRowAction(user, button);
    expect(runBot).toHaveBeenCalledTimes(1);
    expect(runBot).toHaveBeenCalledWith('b-team');

    // The server's next word: its run is going.
    show({ run: runBot, bots: snapshot([{ ...TEAM, running: 'r-new' }, GOALS], [run({ id: 'r-new', botId: 'b-team', state: 'starting', endedAt: null, arrivedAt: null })]) });
    expect(runNow('Team week')).toHaveTextContent("It's running");
    expect(runNow('Team week')).toHaveAttribute('aria-disabled', 'true');
    expect(runNow('Team week')).toHaveAttribute('title', "It's running");
    fireEvent.click(runNow('Team week'), { detail: 1 });
    focusList();
    await user.keyboard('{Enter}');
    expect(runBot).toHaveBeenCalledTimes(1);
    expect(fact('Team week')).toHaveTextContent('running');

    // Over: Run now is back. A start the server refuses says why at the panel's top.
    show({ run: runBot, bots: snapshot([TEAM, GOALS]) });
    expect(runNow('Team week')).not.toHaveAttribute('aria-disabled');
    fail = new SaveError("It's running", null, 409);
    await user.keyboard('{Enter}');
    expect(runBot).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('alert')).toHaveTextContent("It's running");
    // An off Bot runs by hand too.
    fail = null;
    await user.keyboard('j');
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');
    expect(runBot).toHaveBeenLastCalledWith('b-goals');
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
