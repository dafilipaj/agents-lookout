import { BOTS_READ_ONLY, type BotRun, type BotView, type BotsSnapshot, type ReportDetail, type ReportMark } from '@shared/bots.ts';
import type { OutputItem, OutputSource } from '@shared/library.ts';
import type { HistoryItem, SessionRow } from '@shared/types.ts';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookoutClient } from '@/lib/client';
import { spanWords, stampWords, whenWords } from '@/lib/inbox';
import { NOW, launchView, primaryButtons, renderApp, row } from '@/test/helpers';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Invented names throughout: the repo is public.
const run = (over: Partial<BotRun> & { id: string }): BotRun => ({
  botId: 'bot-week', botName: 'Harbor week', name: 'Harbor week · Oct 16', dueAt: null, startedAt: NOW - 2 * HOUR - 4 * MINUTE, lateMs: 0, state: 'finished', sessionId: 'writer-1', harness: 'claude',
  waitingFor: null, endedAt: NOW - 2 * HOUR, failure: null, session: 'ended', arrivedAt: NOW - 2 * HOUR, title: 'Harbor week 42', holds: { documents: 1, reply: true, first: { kind: 'file', type: 'html' } }, read: false, archived: false, launchId: null, ...over,
});
const bot = (over: Partial<BotView> = {}): BotView => ({
  id: 'bot-week', name: 'Harbor week', prompt: 'Write the week up.', harness: 'claude', model: '', effort: null, skipPermissions: false, directory: '~/Projects/harbor', schedule: null, on: true,
  since: 0, skipped: 0, createdAt: 0, updatedAt: 0, nextAt: null, running: null, ...over,
});
const output = (over: Partial<OutputItem> = {}): OutputItem => ({
  kind: 'file', key: '/out/week.html', type: 'html', title: 'Harbor week 42', path: '/out/week.html', url: null, display: '~/out/week.html', projectPath: '/project', repo: 'project',
  createdAt: NOW - 3 * HOUR, updatedAt: NOW - 2 * HOUR, events: 1, exists: true, source: null, sourcePath: null, sourceDisplay: null, version: null, sessions: [], ...over,
});
const notes = (over: Partial<OutputItem> = {}) => output({ key: '/out/notes.md', type: 'markdown', title: 'Harbor notes', path: '/out/notes.md', display: '~/out/notes.md', ...over });
const source = (over: Partial<OutputSource> = {}): OutputSource => ({ path: '/out/page.html', display: '~/out/page.html', type: 'html', createdAt: NOW - 3 * HOUR, updatedAt: NOW - 2 * HOUR, events: 1, exists: true, ...over });
const artifact = (over: Partial<OutputItem> = {}) => output({ kind: 'artifact', key: 'artifact-1', type: null, title: 'Harbor page', path: null, url: 'https://example.invalid/artifact/1', display: 'example.invalid/artifact/1', ...over });
const past = (over: Partial<HistoryItem> = {}): HistoryItem => ({
  sessionId: 'writer-1', harness: 'claude', headless: false, title: 'Harbor week · Oct 16', projectPath: '/project', projectDisplay: '~/project', repo: 'project', branch: null, lastActiveAt: NOW - 2 * HOUR, snippet: null, firstPrompt: null, blocked: null, ...over,
});

interface World {
  runs: BotRun[];
  /** What the fake server reads for a Report, by run id; a reply-less, document-less read otherwise. */
  details?: Record<string, Partial<ReportDetail>>;
  /** A Markdown file's text, by path. */
  texts?: Record<string, { text: string; truncated: boolean }>;
  sessions?: SessionRow[];
  bots?: BotView[];
  /** BOT-2.6: a second server refuses every mark. */
  state?: BotsSnapshot['state'];
  /** The server refuses every mark with these words (a save that failed, say). */
  refuse?: string;
  resume?: LookoutClient['resume'];
}

/** The whole app in the Inbox against a fake server that keeps the Reports: a mark changes them and tells the tab, as the server does. */
function openInbox(path: string, world: World) {
  let runs = world.runs;
  const send = () => app.emit({ type: 'bots', bots: { state: world.state ?? 'ok', path: '~/.lookout/bots.json', error: null, bots: world.bots ?? [bot()], runs } });
  const report = vi.fn(async (id: string): Promise<ReportDetail> => {
    const found = runs.find((r) => r.id === id);
    if (!found) throw new Error('This Report is gone.');
    return { run: found, reply: null, outputs: [], outputsError: null, session: null, ...world.details?.[id] };
  });
  const markReport = vi.fn(async (id: string, mark: ReportMark): Promise<BotRun> => {
    await Promise.resolve();
    if (world.state === 'read-only') throw new Error(BOTS_READ_ONLY);
    if (world.refuse) throw new Error(world.refuse);
    const { arrivedAt, ...marks } = mark;
    // As the server does: a mark made for an earlier arrival changes nothing, and archiving also marks it read.
    runs = runs.map((r) => (r.id === id && (arrivedAt === undefined || arrivedAt === r.arrivedAt) ? { ...r, ...marks, ...(marks.archived ? { read: true } : {}) } : r));
    send();
    return runs.find((r) => r.id === id)!;
  });
  const reportText = vi.fn(async (file: string) => {
    const text = world.texts?.[file];
    if (!text) throw new Error("That file isn't one of a Report's.");
    return text;
  });
  const app = renderApp(path, { report, markReport, reportText, ...(world.resume ? { resume: world.resume } : {}) });
  app.snapshot(world.sessions ?? []);
  send();
  return {
    app,
    report,
    markReport,
    reportText,
    /** The server's runs change: a new arrival, a run that goes on. */
    arrive(next: BotRun[]) {
      runs = next;
      send();
    },
  };
}

const column = () => screen.getByTestId('inbox-list');
const list = () => screen.getByRole('listbox', { name: 'Reports' });
const options = () => within(list()).queryAllByRole('option');
const titles = () => options().map((o) => o.querySelector('[data-field="title"]')!.textContent);
const option = (id: string) => list().querySelector<HTMLElement>(`[data-report-id="${id}"]`)!;
const filter = () => screen.getByRole('searchbox', { name: 'Filter Reports' });
const choice = (name: string) => within(screen.getByRole('radiogroup', { name: 'Reports' })).getByRole('radio', { name });
const view = () => screen.getByTestId('report-view');
const actions = () => [...view().querySelectorAll<HTMLElement>('[data-field="actions"] [data-action]')];
const action = (name: string) => view().querySelector<HTMLElement>(`[data-field="actions"] [data-action="${name}"]`);
const path = () => window.location.pathname;
/** A Report's read has arrived: its header's actions hold what the read decides. */
const shown = (name: string) => waitFor(() => expect(action(name)).not.toBeNull());
const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(action('more')!);
  return screen.findByRole('menu');
};

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the list (INBOX-1)', () => {
  it('INBOX-1.1: the left column lists every run that arrived, newest arrival first, each day a named group of one listbox; a run that arrives again moves to the top, unread', () => {
    const inbox = openInbox('/inbox', {
      runs: [
        run({ id: 'r-old', title: 'Harbor week 40', arrivedAt: NOW - 3 * DAY, read: true }),
        run({ id: 'r-new', title: 'Harbor week 42', arrivedAt: NOW - HOUR }),
        run({ id: 'r-failed', title: 'Flaky tests · Oct 15', botName: 'Flaky tests', state: 'failed', failure: 'Its Session ended before it finished', arrivedAt: NOW - 26 * HOUR, holds: { documents: 0, reply: false, first: null } }),
        run({ id: 'r-waiting', title: 'Harbor week · Oct 16', state: 'waiting', waitingFor: 'Allow Bash?', endedAt: null, arrivedAt: NOW - 2 * HOUR, holds: null, read: true }),
        // Not Reports: one still running, and one archived.
        run({ id: 'r-running', title: 'Still running', state: 'running', endedAt: null, arrivedAt: null }),
        run({ id: 'r-archived', title: 'Put away', archived: true, read: true }),
      ],
    });
    expect(titles()).toEqual(['Harbor week 42', 'Harbor week · Oct 16', 'Flaky tests · Oct 15', 'Harbor week 40']);
    // DS-17: each day a group of the listbox, named by its heading.
    const days = within(list()).getAllByRole('group');
    expect(days.map((g) => [document.getElementById(g.getAttribute('aria-labelledby')!)!.textContent, within(g).getAllByRole('option').length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      [new Date(NOW - 3 * DAY).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }), 1],
    ]);
    expect(days[0]).toHaveAccessibleName('Today');
    expect(options().every((o) => o.getAttribute('data-slot') === 'row')).toBe(true);
    // The run that waited on you finished: it arrives again, at the top and unread.
    inbox.arrive([
      run({ id: 'r-new', title: 'Harbor week 42', arrivedAt: NOW - HOUR }),
      run({ id: 'r-waiting', title: 'Harbor week 43', state: 'finished', arrivedAt: NOW - MINUTE, read: false }),
    ]);
    expect(titles()).toEqual(['Harbor week 43', 'Harbor week 42']);
    expect(option('r-waiting')).toHaveAttribute('data-unread');
  });

  it('INBOX-1.2: a row shows its title, then its Bot, what it holds and its age, with the icon of what it holds, and names all of it', () => {
    openInbox('/inbox', {
      runs: [
        run({ id: 'r-page', title: 'Harbor week 42', holds: { documents: 2, reply: true, first: { kind: 'file', type: 'html' } }, arrivedAt: NOW - 2 * HOUR }),
        run({ id: 'r-notes', title: 'Harbor notes', holds: { documents: 1, reply: true, first: { kind: 'file', type: 'markdown' } }, arrivedAt: NOW - 3 * HOUR, read: true }),
        run({ id: 'r-artifact', title: 'Harbor page', holds: { documents: 1, reply: false, first: { kind: 'artifact', type: null } }, arrivedAt: NOW - 4 * HOUR, read: true }),
        // No document: the run's name, the Bot's and the day.
        run({ id: 'r-reply', title: 'Harbor week · Oct 16', holds: { documents: 0, reply: true, first: null }, arrivedAt: NOW - 5 * HOUR, read: true }),
        run({ id: 'r-failed', title: 'Flaky tests · Oct 15', botName: 'Flaky tests', state: 'failed', failure: 'No Session after 15 s', holds: { documents: 0, reply: false, first: null }, arrivedAt: NOW - 6 * HOUR, read: true }),
        run({ id: 'r-waiting', title: 'Flaky tests · Oct 16', botName: 'Flaky tests', state: 'waiting', waitingFor: 'Allow Bash?', endedAt: null, holds: null, arrivedAt: NOW - 30 * MINUTE }),
      ],
    });
    const line = (id: string) => [...option(id).querySelectorAll('[data-field="title"], [data-field="bot"], [data-field="holds"], [data-field="age"]')].map((e) => e.textContent);
    expect(line('r-page')).toEqual(['Harbor week 42', 'Harbor week', '2 documents', '2h']);
    expect(line('r-notes')).toEqual(['Harbor notes', 'Harbor week', '1 document', '3h']);
    expect(line('r-reply')).toEqual(['Harbor week · Oct 16', 'Harbor week', 'a reply', '5h']);
    expect(line('r-failed')).toEqual(['Flaky tests · Oct 15', 'Flaky tests', 'failed', '6h']);
    expect(line('r-waiting')).toEqual(['Flaky tests · Oct 16', 'Flaky tests', 'waiting on you', '30m']);
    // A failed run's icon is the warning triangle in the destructive colour, once; "waiting on you" is in Needs you's amber.
    expect(option('r-failed').querySelectorAll('svg.lucide-triangle-alert')).toHaveLength(1);
    expect(option('r-failed').firstElementChild!.querySelector('svg')).toHaveClass('text-destructive');
    expect(option('r-waiting').querySelector('[data-field="holds"]')).toHaveClass('text-needs-you-text');
    expect(option('r-page').querySelector('[data-field="holds"]')!.className).not.toMatch(/destructive|needs-you/);
    // Its icon, 16 px before the title: the Library's for the first document's Type, a reply's, a failure's, a question.
    const icon = (id: string) => option(id).firstElementChild!.querySelector('svg')!;
    expect(icon('r-page')).toHaveClass('lucide-app-window', 'size-4');
    expect(icon('r-notes')).toHaveClass('lucide-hash');
    expect(icon('r-artifact')).toHaveClass('lucide-app-window');
    expect(icon('r-reply')).toHaveClass('lucide-message-square-text');
    expect(icon('r-failed')).toHaveClass('lucide-triangle-alert');
    expect(icon('r-waiting')).toHaveClass('lucide-circle-question-mark');
    expect(options().every((o) => [...o.querySelectorAll('svg')].every((s) => s.getAttribute('aria-hidden') === 'true'))).toBe(true);
    // A row's accessible name: its title, its Bot, what it holds, its age and "unread" when it is.
    expect(option('r-page')).toHaveAccessibleName('Harbor week 42, Harbor week, 2 documents, 2h, unread');
    expect(option('r-notes')).toHaveAccessibleName('Harbor notes, Harbor week, 1 document, 3h');
    expect(option('r-failed')).toHaveAccessibleName('Flaky tests · Oct 15, Flaky tests, failed, 6h');
    expect(option('r-waiting')).toHaveAccessibleName('Flaky tests · Oct 16, Flaky tests, waiting on you, 30m, unread');
  });

  it('INBOX-1.3: the header holds "Filter Reports", which / focuses; every word typed is in the title or the Bot’s name, whatever its case; Esc clears it and leaves it', async () => {
    const user = userEvent.setup();
    openInbox('/inbox', {
      runs: [
        run({ id: 'r-1', title: 'Harbor week 42', arrivedAt: NOW - HOUR }),
        run({ id: 'r-2', title: 'Nightly look', botName: 'Flaky tests', arrivedAt: NOW - 2 * HOUR }),
        run({ id: 'r-3', title: 'Harbor week 41', arrivedAt: NOW - 3 * HOUR }),
      ],
    });
    expect(filter().closest('[data-shell-row]')).toHaveAttribute('data-shell-row', 'header');
    expect(filter()).toHaveAttribute('placeholder', 'Filter Reports');
    // Nothing takes focus by itself (SIDE-11).
    expect(filter()).not.toHaveFocus();
    await user.keyboard('/');
    expect(filter()).toHaveFocus();
    expect(filter()).toHaveValue('');
    await user.keyboard('WEEK 42');
    expect(titles()).toEqual(['Harbor week 42']);
    // A word of the Bot's name, and one of the title.
    await user.clear(filter());
    await user.keyboard('flaky NIGHT');
    expect(titles()).toEqual(['Nightly look']);
    await user.clear(filter());
    await user.keyboard('harbor flaky');
    expect(within(column()).getByText('Nothing matches')).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Reports' })).toBeNull();
    await user.keyboard('{Escape}');
    expect(filter()).toHaveValue('');
    expect(filter()).not.toHaveFocus();
    expect(titles()).toEqual(['Harbor week 42', 'Nightly look', 'Harbor week 41']);
  });

  it('INBOX-1.4: under the header a Segmented shows Inbox or Archived, kept for this page load only', async () => {
    const user = userEvent.setup();
    const world = { runs: [run({ id: 'r-1', title: 'In the Inbox' }), run({ id: 'r-2', title: 'Put away', archived: true, read: true })] };
    const inbox = openInbox('/inbox', world);
    expect(screen.getByRole('radiogroup', { name: 'Reports' })).toHaveAttribute('data-slot', 'segmented');
    expect(screen.getByRole('radiogroup', { name: 'Reports' }).closest('[data-shell-row]')).toHaveAttribute('data-shell-row', 'body');
    expect(choice('Inbox')).toBeChecked();
    expect(titles()).toEqual(['In the Inbox']);
    await user.click(choice('Archived'));
    expect(choice('Archived')).toBeChecked();
    expect(titles()).toEqual(['Put away']);
    // Nothing of it is kept in the browser: a reload shows Inbox.
    expect(JSON.stringify({ ...window.localStorage })).not.toMatch(/archived/i);
    inbox.app.unmount();
    openInbox('/inbox', world);
    expect(choice('Inbox')).toBeChecked();
    expect(titles()).toEqual(['In the Inbox']);
  });

  it('INBOX-1.5: with nothing to list the column says why, with a way to the Bots tab; before the server’s first answer it says Connecting…', async () => {
    const user = userEvent.setup();
    // Before the first answer.
    const waiting = renderApp('/inbox');
    expect(within(column()).getByText('Connecting…').closest('[data-slot="loading"]')).not.toBeNull();
    expect(screen.queryByRole('listbox', { name: 'Reports' })).toBeNull();
    waiting.unmount();

    openInbox('/inbox', { runs: [run({ id: 'r-1', title: 'Put away', archived: true, read: true })] });
    expect(within(column()).getByText('Nothing has arrived')).toBeInTheDocument();
    expect(within(column()).getByText("A Bot's Report arrives here when its run ends.")).toBeInTheDocument();
    // The main pane says the same, with none to pick.
    expect(within(view()).getByText('Nothing has arrived')).toBeInTheDocument();
    await user.click(choice('Archived'));
    expect(within(column()).queryByText('Nothing has arrived')).toBeNull();
    await user.type(filter(), 'nothing like it');
    expect(within(column()).getByText('Nothing matches')).toBeInTheDocument();
    await user.clear(filter());
    await user.click(choice('Inbox'));
    await user.click(within(column()).getByRole('button', { name: 'Bots' }));
    expect(screen.getByRole('tab', { name: 'Bots' })).toHaveAttribute('aria-selected', 'true');
  });

  it('INBOX-1.5: Archived with nothing in it says Nothing archived, and a store that can’t be read says so', async () => {
    const user = userEvent.setup();
    const inbox = openInbox('/inbox', { runs: [run({ id: 'r-1' })] });
    await user.click(choice('Archived'));
    expect(within(column()).getByText('Nothing archived')).toBeInTheDocument();
    expect(within(column()).queryByRole('button', { name: 'Bots' })).toBeNull();
    inbox.app.emit({ type: 'bots', bots: { state: 'unreadable', path: '~/.lookout/bots.json', error: 'It isn’t JSON.', bots: [], runs: [] } });
    expect(within(column()).getByRole('alert')).toHaveTextContent('Reports can\'t be read');
    expect(within(column()).getByRole('alert')).toHaveTextContent('~/.lookout/bots.json');
    expect(within(column()).queryByText('Nothing archived')).toBeNull();
  });
});

describe('read a Report (INBOX-2)', () => {
  it('INBOX-2.1: selecting a row shows its Report at /inbox/<run id>, kept over a reload and Back; a run the server doesn’t have says This Report is gone, the list beside it', async () => {
    const user = userEvent.setup();
    const world: World = {
      runs: [run({ id: 'r-1', title: 'Harbor week 42', arrivedAt: NOW - HOUR }), run({ id: 'r-2', title: 'Harbor week 41', arrivedAt: NOW - 2 * HOUR })],
      details: { 'r-1': { reply: 'The first one.' }, 'r-2': { reply: 'The second one.' } },
    };
    const inbox = openInbox('/inbox', world);
    expect(within(view()).getByText('Select a Report')).toBeInTheDocument();
    expect(inbox.report).not.toHaveBeenCalled();
    await user.click(option('r-1'));
    expect(path()).toBe('/inbox/r-1');
    expect(option('r-1')).toHaveAttribute('aria-selected', 'true');
    expect(list()).toHaveAttribute('aria-activedescendant', option('r-1').id);
    expect(view()).toHaveAccessibleName('Report Harbor week 42');
    expect(await within(view()).findByText('The first one.')).toBeInTheDocument();
    expect(inbox.report).toHaveBeenCalledWith('r-1');
    await user.click(option('r-2'));
    expect(path()).toBe('/inbox/r-2');
    expect(await within(view()).findByText('The second one.')).toBeInTheDocument();
    // Back shows the one before.
    act(() => window.history.back());
    await waitFor(() => expect(path()).toBe('/inbox/r-1'));
    expect(await within(view()).findByText('The first one.')).toBeInTheDocument();
    // A reload keeps it.
    inbox.app.unmount();
    openInbox('/inbox/r-2', world);
    expect(await within(view()).findByText('The second one.')).toBeInTheDocument();
    expect(option('r-2')).toHaveAttribute('aria-selected', 'true');
  });

  it('INBOX-2.1: a path whose run the server doesn’t have shows This Report is gone, with the Inbox’s list beside it', () => {
    const inbox = openInbox('/inbox/r-dropped', { runs: [run({ id: 'r-1', title: 'Harbor week 42' })] });
    expect(within(view()).getByText('This Report is gone')).toBeInTheDocument();
    expect(titles()).toEqual(['Harbor week 42']);
    expect(options().some((o) => o.getAttribute('aria-selected') === 'true')).toBe(false);
    expect(inbox.report).not.toHaveBeenCalled();
    expect(inbox.markReport).not.toHaveBeenCalled();
  });

  it('BOT-4.6: a Report whose Session Lookout didn’t end, because you opened it or the end failed, says "its Session is still open"', async () => {
    const ended = new Date(2026, 9, 12, 7, 34).getTime();
    const when = () => view().querySelector('header [data-field="when"]');
    for (const [session, said] of [['yours', true], ['left', true], ['ended', false], [null, false]] as const) {
      openInbox('/inbox/r-1', {
        runs: [run({ id: 'r-1', title: 'Harbor week 42', startedAt: ended - 4 * MINUTE, endedAt: ended, session, read: true })],
        details: { 'r-1': { outputs: [output()], session: past() } },
      });
      await shown('session');
      const words = 'Mon 12 Oct, 07:34 · took 4 min';
      expect(when(), String(session)).toHaveTextContent(said ? `${words} · its Session is still open` : words);
      if (!said) expect(when()!.textContent).toBe(words);
      cleanup();
    }
  });

  it('INBOX-2.2: the header shows its title, its Bot as a link to the Bots tab, when it ended, how long it took and how late it started; then the Session’s action, Open, Archive, and More with Copy link and Mark unread', async () => {
    const user = userEvent.setup();
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
    const ended = new Date(2026, 9, 12, 7, 34).getTime();
    openInbox('/inbox/r-1', {
      runs: [run({ id: 'r-1', title: 'Harbor week 42', startedAt: ended - 4 * MINUTE, endedAt: ended, lateMs: 85 * MINUTE, read: true })],
      details: { 'r-1': { outputs: [output()], session: past() } },
    });
    await shown('session');
    const header = view().querySelector('header')!;
    expect(within(header).getByRole('heading', { level: 1, name: 'Harbor week 42' })).toBeInTheDocument();
    expect(header.querySelector('[data-field="when"]')).toHaveTextContent('Mon 12 Oct, 07:34 · took 4 min · started 1 h 25 min late');
    // In order: the Session's, Open, Archive, More; none is Primary (DS-18.4).
    expect(actions().map((a) => a.getAttribute('data-action'))).toEqual(['session', 'open', 'archive', 'more']);
    expect(actions().map((a) => a.textContent)).toEqual(['Resume Session', 'Open', 'Archive', '']);
    expect(action('more')).toHaveAccessibleName('More for Harbor week 42');
    expect(primaryButtons(view())).toEqual([]);
    // DS-18.6: each draws its action's icon.
    expect(actions().map((a) => a.querySelector('[data-action-icon]')?.getAttribute('data-action-icon'))).toEqual(['resume', 'open-external', 'archive', 'more']);
    const menu = await openMenu(user);
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Copy link', 'Mark unread']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Copy link' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(`${window.location.origin}/inbox/r-1`));
    expect(within(header).getByRole('status')).toHaveTextContent('Copied');
    // Its Bot's name opens the Bots tab on that Bot.
    await user.click(within(header).getByRole('button', { name: 'Harbor week' }));
    expect(screen.getByRole('tab', { name: 'Bots' })).toHaveAttribute('aria-selected', 'true');
  });

  it('INBOX-2.2: a run on time says nothing of being late, one that hasn’t ended says when it started, and a deleted Bot’s name is no link', async () => {
    const ended = new Date(2026, 10, 23, 7, 34).getTime();
    expect(stampWords(ended)).toBe('Mon 23 Nov, 07:34');
    expect(whenWords({ startedAt: ended - 4 * MINUTE, endedAt: ended, lateMs: 0 })).toBe('Mon 23 Nov, 07:34 · took 4 min');
    expect(whenWords({ startedAt: ended - 40_000, endedAt: ended, lateMs: 2 * HOUR })).toBe('Mon 23 Nov, 07:34 · took 40 s · started 2 h late');
    expect(whenWords({ startedAt: ended, endedAt: null, lateMs: 85 * MINUTE })).toBe('started Mon 23 Nov, 07:34 · 1 h 25 min late');
    expect([spanWords(0), spanWords(59_400), spanWords(59 * MINUTE + 40_000), spanWords(3 * HOUR + 5 * MINUTE)]).toEqual(['0 s', '59 s', '1 h', '3 h 5 min']);
    openInbox('/inbox/r-1', { runs: [run({ id: 'r-1', botId: 'bot-gone', botName: 'Old Bot', read: true })] });
    const header = view().querySelector('header')!;
    expect(header.querySelector('[data-field="bot"]')).toHaveTextContent('Old Bot');
    expect(within(header).queryByRole('button', { name: 'Old Bot' })).toBeNull();
    await shown('session');
  });

  it('INBOX-2.3: with more than one document a tab strip names each by its title and Type word, and the open one is in the path, none for the first', async () => {
    const user = userEvent.setup();
    const world: World = {
      runs: [run({ id: 'r-1', read: true }), run({ id: 'r-one', title: 'One page', read: true, arrivedAt: NOW - 3 * HOUR })],
      details: { 'r-1': { outputs: [output(), notes()] }, 'r-one': { outputs: [output({ title: 'One page' })] } },
      texts: { '/out/notes.md': { text: 'The notes of the week.', truncated: false } },
    };
    const inbox = openInbox('/inbox/r-1', world);
    const strip = await within(view()).findByRole('tablist', { name: 'Documents' });
    expect(strip).toHaveAttribute('data-slot', 'tabs');
    expect(within(strip).getAllByRole('tab').map((t) => t.getAttribute('aria-label'))).toEqual(['Harbor week 42 HTML', 'Harbor notes Markdown']);
    // The one updated last is first, and open.
    expect(within(strip).getByRole('tab', { name: 'Harbor week 42 HTML' })).toHaveAttribute('aria-selected', 'true');
    expect(view().querySelector('iframe')).toHaveAttribute('title', 'Harbor week 42');
    await user.click(within(strip).getByRole('tab', { name: 'Harbor notes Markdown' }));
    expect(path()).toBe('/inbox/r-1/2');
    expect(await within(view()).findByText('The notes of the week.')).toBeInTheDocument();
    // Only the open one is drawn.
    expect(view().querySelector('iframe')).toBeNull();
    await user.click(within(strip).getByRole('tab', { name: 'Harbor week 42 HTML' }));
    expect(path()).toBe('/inbox/r-1');
    // A reload keeps the open document.
    inbox.app.unmount();
    openInbox('/inbox/r-1/2', world);
    expect(await within(view()).findByText('The notes of the week.')).toBeInTheDocument();
    expect(within(view()).getByRole('tab', { name: 'Harbor notes Markdown' })).toHaveAttribute('aria-selected', 'true');
    // One document: no strip.
    await user.click(option('r-one'));
    await waitFor(() => expect(view().querySelector('iframe')).toHaveAttribute('title', 'One page'));
    expect(within(view()).queryByRole('tablist')).toBeNull();
  });

  it('INBOX-2.4: a Markdown file is rendered as the chat renders Markdown, saying so when it was cut; an HTML file is a page in a frame; an image shows at its own size', async () => {
    const markdown = openInbox('/inbox/r-1', {
      runs: [run({ id: 'r-1', read: true })],
      details: { 'r-1': { outputs: [notes()] } },
      texts: { '/out/notes.md': { text: '# Week 42\n\nAll **green**, see `deploy.log`.', truncated: true } },
    });
    expect(within(view()).getByText('Reading what it produced…')).toBeInTheDocument();
    expect(await within(view()).findByRole('heading', { name: 'Week 42' })).toBeInTheDocument();
    expect(markdown.reportText).toHaveBeenCalledWith('/out/notes.md');
    expect(within(view()).getByText('green').tagName).toBe('STRONG');
    expect(view().querySelector('[data-field="markdown"]')).toHaveClass('text-reading', 'max-w-[42rem]');
    expect(view().querySelector('[data-field="truncated"]')).toHaveTextContent('only its first megabyte is shown');
    expect(view().querySelector('iframe, img')).toBeNull();
    markdown.app.unmount();

    const page = openInbox('/inbox/r-1', { runs: [run({ id: 'r-1', read: true })], details: { 'r-1': { outputs: [output()] } } });
    await shown('open');
    const frame = view().querySelector('iframe')!;
    expect(frame).toHaveAttribute('src', '/api/library/file?path=%2Fout%2Fweek.html&frame=1');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
    expect(frame).toHaveAttribute('title', 'Harbor week 42');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    // It fills the pane to its edges, on white: a page brings its own colours.
    expect(frame).toHaveClass('flex-1', 'w-full', 'bg-white');
    expect(frame.parentElement).toHaveAttribute('data-field', 'report');
    expect(page.reportText).not.toHaveBeenCalled();
    page.app.unmount();

    openInbox('/inbox/r-1', { runs: [run({ id: 'r-1', read: true })], details: { 'r-1': { outputs: [output({ key: '/out/chart.png', type: 'image', title: 'Harbor chart', path: '/out/chart.png', display: '~/out/chart.png' })] } } });
    await shown('open');
    const image = within(view()).getByRole('img', { name: 'Harbor chart' });
    expect(image).toHaveAttribute('src', '/api/library/file?path=%2Fout%2Fchart.png&frame=1');
    expect(image).toHaveClass('max-w-full');
  });

  it('INBOX-2.4: an Artifact shows its source file while that file exists; a PDF, a Share and an Artifact without one show a card with one Primary Open; a file that is gone says so', async () => {
    const withSource = openInbox('/inbox/r-1', { runs: [run({ id: 'r-1', read: true })], details: { 'r-1': { outputs: [artifact({ source: source() })] } } });
    await shown('open');
    expect(view().querySelector('iframe')).toHaveAttribute('src', '/api/library/file?path=%2Fout%2Fpage.html&frame=1');
    expect(view().querySelector('[data-field="card"]')).toBeNull();
    withSource.app.unmount();

    const notesSource = openInbox('/inbox/r-1', {
      runs: [run({ id: 'r-1', read: true })],
      details: { 'r-1': { outputs: [artifact({ source: source({ path: '/out/page.md', type: 'markdown' }) })] } },
      texts: { '/out/page.md': { text: 'The page, as notes.', truncated: false } },
    });
    expect(await within(view()).findByText('The page, as notes.')).toBeInTheDocument();
    expect(view().querySelector('[data-field="truncated"]')).toBeNull();
    notesSource.app.unmount();

    const cards: [OutputItem, string][] = [
      [output({ key: '/out/week.pdf', type: 'pdf', title: 'Harbor week, printed', path: '/out/week.pdf', display: '~/out/week.pdf' }), 'PDF · ~/out/week.pdf'],
      [output({ kind: 'share', key: 'share-1', type: null, title: 'Harbor share', path: null, url: 'https://example.invalid/s/1', display: 'example.invalid/s/1' }), 'Share · example.invalid/s/1'],
      [artifact({ source: source({ exists: false }) }), 'Artifact · example.invalid/artifact/1'],
      [artifact(), 'Artifact · example.invalid/artifact/1'],
    ];
    for (const [item, where] of cards) {
      const app = openInbox('/inbox/r-1', { runs: [run({ id: 'r-1', read: true })], details: { 'r-1': { outputs: [item] } } });
      await shown('open');
      const card = view().querySelector<HTMLElement>('[data-field="card"]')!;
      expect(card, item.title).toHaveTextContent(item.title);
      expect(card).toHaveTextContent(where);
      // DS-18.4: the card's one button is what the surface is for.
      expect(primaryButtons(view()).map((b) => b.textContent), item.title).toEqual(['Open']);
      expect(within(card).getByRole('button', { name: 'Open' })).toHaveAttribute('data-variant', 'primary');
      expect(view().querySelector('iframe, img')).toBeNull();
      app.app.unmount();
    }

    openInbox('/inbox/r-1', { runs: [run({ id: 'r-1', read: true })], details: { 'r-1': { outputs: [output({ exists: false })], session: past() } } });
    await shown('session');
    expect(within(view()).getByText('This file no longer exists.')).toBeInTheDocument();
    expect(within(view()).getByText('Resume the Session that wrote it to have it written again.')).toBeInTheDocument();
    // LIB-3.3: a gone file has no Open.
    expect(action('open')).toBeNull();
    expect(view().querySelector('iframe')).toBeNull();
  });

  it('INBOX-2.4: a Markdown file that can’t be read says why', async () => {
    openInbox('/inbox/r-1', { runs: [run({ id: 'r-1', read: true })], details: { 'r-1': { outputs: [notes()] } } });
    const alert = await within(view()).findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't read this file");
    expect(alert).toHaveTextContent("That file isn't one of a Report's.");
  });

  it('INBOX-2.5: a finished run that produced no Output shows its last reply as Markdown under its line; with no reply either, it says so', async () => {
    const replied = openInbox('/inbox/r-1', {
      runs: [run({ id: 'r-1', read: true, holds: { documents: 0, reply: true, first: null } })],
      details: { 'r-1': { reply: 'Nothing to report: **all green**.' } },
    });
    expect(await within(view()).findByText('It wrote no document. This is its last reply.')).toBeInTheDocument();
    expect(within(view()).getByText('all green').tagName).toBe('STRONG');
    expect(view().querySelector('[data-field="reply"]')).toHaveClass('text-reading');
    expect(within(view()).queryByRole('tablist')).toBeNull();
    // INBOX-2.8: a Report with no document has no Open.
    expect(action('open')).toBeNull();
    replied.app.unmount();

    openInbox('/inbox/r-1', { runs: [run({ id: 'r-1', read: true, holds: { documents: 0, reply: false, first: null } })] });
    expect(await within(view()).findByText('It finished without a reply.')).toBeInTheDocument();
    expect(within(view()).queryByText(/This is its last reply/)).toBeNull();
  });

  it('INBOX-2.5: a Library that can’t be read says so above the reply, and a read that fails keeps the header', async () => {
    const unlisted = openInbox('/inbox/r-1', {
      runs: [run({ id: 'r-1', read: true })],
      details: { 'r-1': { reply: 'What I found.', outputsError: 'tb-session 0.3.0 is older than the Library needs (0.4.0)' } },
    });
    const alert = await within(view()).findByRole('alert');
    expect(alert).toHaveTextContent('tb-session 0.3.0 is older than the Library needs (0.4.0)');
    expect(within(view()).getByText('This is its last reply.')).toBeInTheDocument();
    expect(alert.compareDocumentPosition(within(view()).getByText('What I found.')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unlisted.app.unmount();

    const failing = openInbox('/inbox/r-1', { runs: [run({ id: 'r-1', title: 'Harbor week 42', read: true })] });
    failing.report.mockRejectedValueOnce(new Error('The server is busy.'));
    failing.arrive([run({ id: 'r-1', title: 'Harbor week 42', read: true, arrivedAt: NOW - MINUTE })]);
    const failed = await within(view()).findByRole('alert');
    expect(failed).toHaveTextContent("Couldn't read what it produced");
    expect(failed).toHaveTextContent('The server is busy.');
    expect(within(view()).getByRole('heading', { level: 1, name: 'Harbor week 42' })).toBeInTheDocument();
  });

  it('INBOX-2.6: a failed run’s Report is an error Alert saying what failed and why, then what the run did produce', async () => {
    openInbox('/inbox/r-1', {
      runs: [run({ id: 'r-1', state: 'failed', failure: 'Its Session ended before it finished', read: true, holds: { documents: 0, reply: true, first: null } })],
      details: { 'r-1': { reply: 'I got as far as the second repo.' } },
    });
    const alert = within(view()).getByRole('alert');
    expect(alert).toHaveAttribute('data-tone', 'error');
    expect(alert).toHaveTextContent('This run failed');
    expect(alert).toHaveTextContent('Its Session ended before it finished');
    const reply = await within(view()).findByText('I got as far as the second repo.');
    expect(alert.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(view()).queryByText('It finished without a reply.')).toBeNull();
  });

  it('INBOX-2.6: a run waiting on you shows It’s waiting on you with what it waits for and a Primary Open Session', async () => {
    const user = userEvent.setup();
    const waiting = run({ id: 'r-1', state: 'waiting', waitingFor: 'Allow Bash(pnpm test)?', endedAt: null, holds: null, read: true });
    const inbox = openInbox('/inbox/r-1', {
      runs: [waiting],
      sessions: [row({ id: 'writer-1', title: 'Harbor week · Oct 16', status: 'needs-you' })],
      details: { 'r-1': { outputs: [output({ type: 'pdf', path: '/out/week.pdf' })] } },
    });
    const card = () => within(view()).getByRole('region', { name: 'Waiting on you' });
    expect(card()).toHaveTextContent("It's waiting on you");
    expect(card()).toHaveTextContent('Allow Bash(pnpm test)?');
    // The one Primary of the view: what it wrote so far isn't shown yet, so no card or Open of its own.
    await waitFor(() => expect(inbox.report).toHaveBeenCalledWith('r-1'));
    await act(async () => {});
    expect(primaryButtons(view()).map((b) => b.textContent)).toEqual(['Open Session']);
    expect(card()).toContainElement(primaryButtons(view())[0]!);
    expect(view().querySelector('[data-field="card"]')).toBeNull();
    expect(action('open')).toBeNull();
    // Answered, it goes on: nothing to act on until it arrives again.
    inbox.arrive([{ ...waiting, state: 'running', waitingFor: null }]);
    expect(view().querySelector('[data-field="running"]')).toHaveTextContent("It's running again");
    expect(view().querySelector('[data-field="running"]')).toHaveAttribute('data-tone', 'info');
    expect(primaryButtons(view())).toEqual([]);
    inbox.arrive([waiting]);
    await user.click(primaryButtons(view())[0]!);
    expect(path()).toBe('/s/writer-1');
  });

  it('INBOX-2.6, BOT-4.3: a run waiting at its Trust prompt has no Session yet: its Primary opens its start, where the prompt is answered', async () => {
    const user = userEvent.setup();
    const waiting = run({ id: 'r-1', state: 'waiting', waitingFor: 'Trust prompt', sessionId: null, endedAt: null, holds: null, read: true, launchId: 'launch-1' });
    const inbox = openInbox('/inbox/r-1', { runs: [waiting] });
    inbox.app.emit({ type: 'launches', launches: [launchView({ id: 'launch-1', title: 'Harbor week · Oct 16', state: 'trust', trust: { id: 't1', lines: ['Accessing workspace:'], answerable: true, detail: null, answering: null, message: null } })], started: [] });
    const card = () => within(view()).getByRole('region', { name: 'Waiting on you' });
    expect(card()).toHaveTextContent('Trust prompt');
    expect(primaryButtons(view()).map((b) => b.textContent)).toEqual(['Open its start']);
    expect(action('session')).toHaveAttribute('title', 'Open its start (S)');
    await user.click(primaryButtons(view())[0]!);
    expect(path()).toBe('/l/launch-1');
    // A run that never got a Session and names no start has neither.
    cleanup();
    openInbox('/inbox/r-2', { runs: [run({ id: 'r-2', state: 'failed', failure: "Couldn't start the Session.", sessionId: null, holds: { documents: 0, reply: false, first: null }, read: true })] });
    await waitFor(() => expect(view().querySelector('[data-field="failed"]')).not.toBeNull());
    expect(action('session')).toBeNull();
  });

  it('INBOX-2.7: the Session’s action is Open Session when it’s live, Resume Session when it can be resumed and Show Session when it can’t; a run with no Session has none; S runs it', async () => {
    const user = userEvent.setup();
    const one = { runs: [run({ id: 'r-1', read: true })] };
    // Live: it selects the Session, which shows Sessions.
    const live = openInbox('/inbox/r-1', { ...one, sessions: [row({ id: 'writer-1', title: 'Harbor week · Oct 16' })] });
    expect(action('session')).toHaveTextContent('Open Session');
    expect(action('session')).toHaveAttribute('title', 'Open Session (S)');
    await user.keyboard('s');
    expect(path()).toBe('/s/writer-1');
    live.app.unmount();

    // Past, and History says it can be resumed: through History's resume route.
    const resume = vi.fn(async () => ({ kind: 'live' as const, sessionId: 'writer-1' }));
    const resumable = openInbox('/inbox/r-1', { ...one, details: { 'r-1': { session: past() } }, resume });
    // Whether it can be resumed is History's to say: no button before the read.
    expect(action('session')).toBeNull();
    await shown('session');
    expect(action('session')).toHaveTextContent('Resume Session');
    await user.keyboard('s');
    await waitFor(() => expect(resume).toHaveBeenCalledWith('claude', 'writer-1', expect.any(String)));
    resumable.app.unmount();

    // Past, and it can't be resumed: shown read-only (HIST-3.3).
    const blocked = openInbox('/inbox/r-1', { ...one, details: { 'r-1': { session: past({ blocked: 'folder-gone' }) } } });
    await shown('session');
    expect(action('session')).toHaveTextContent('Show Session');
    await user.click(action('session')!);
    expect(path()).toBe('/h/claude/writer-1');
    blocked.app.unmount();

    // A run that never got a Session has none, and S does nothing.
    const none = openInbox('/inbox/r-1', { runs: [run({ id: 'r-1', read: true, sessionId: null, state: 'failed', failure: 'No Session after 15 s' })], details: { 'r-1': { reply: 'x' } }, resume });
    await within(view()).findByText('x');
    expect(action('session')).toBeNull();
    resume.mockClear();
    await user.keyboard('s');
    expect(path()).toBe('/inbox/r-1');
    expect(resume).not.toHaveBeenCalled();
    expect(none.app.client.pastSession).not.toHaveBeenCalled();
  });

  it('INBOX-2.8: Open opens the shown document as the Library does, O runs it, and a Report with no document has no Open', async () => {
    const user = userEvent.setup();
    const browser = vi.spyOn(window, 'open').mockImplementation(() => null);
    // A page: a new browser tab from Lookout's file route, with no frame.
    const page = openInbox('/inbox/r-1', {
      runs: [run({ id: 'r-1', read: true })],
      details: { 'r-1': { outputs: [output(), notes(), artifact({ source: source() })] } },
      texts: { '/out/notes.md': { text: 'Notes.', truncated: false } },
    });
    await shown('open');
    expect(action('open')).toHaveAttribute('title', 'Open (O)');
    await user.click(action('open')!);
    expect(browser).toHaveBeenLastCalledWith('/api/library/file?path=%2Fout%2Fweek.html', '_blank', 'noopener,noreferrer');
    await user.keyboard('o');
    expect(browser).toHaveBeenCalledTimes(2);
    // Held down, or with a modifier, it doesn't open a stack of tabs.
    fireEvent.keyDown(window, { key: 'o', repeat: true });
    fireEvent.keyDown(window, { key: 'o', ctrlKey: true });
    expect(browser).toHaveBeenCalledTimes(2);
    // The shown document is the one it opens: a Markdown file in VS Code.
    await user.click(within(view()).getByRole('tab', { name: 'Harbor notes Markdown' }));
    await within(view()).findByText('Notes.');
    await user.keyboard('o');
    expect(browser).toHaveBeenLastCalledWith(expect.stringMatching(/^vscode:\/\/file\/out\/notes\.md/), '_self');
    // An Artifact at its URL, with no referrer, though its source file is what shows.
    await user.click(within(view()).getByRole('tab', { name: 'Harbor page Artifact' }));
    await user.keyboard('o');
    expect(browser).toHaveBeenLastCalledWith('https://example.invalid/artifact/1', '_blank', 'noopener,noreferrer');
    expect(browser).toHaveBeenCalledTimes(4);
    page.app.unmount();

    openInbox('/inbox/r-1', { runs: [run({ id: 'r-1', read: true })], details: { 'r-1': { reply: 'Only a reply.' } } });
    await within(view()).findByText('Only a reply.');
    expect(action('open')).toBeNull();
    await user.keyboard('o');
    expect(browser).toHaveBeenCalledTimes(4);
  });

  it('INBOX-2.9: the frame carries the sandbox the file route sends, so the page never gets Lookout’s origin, and asks the route for a framed answer', async () => {
    openInbox('/inbox/r-1', { runs: [run({ id: 'r-1', read: true })], details: { 'r-1': { outputs: [output()] } } });
    await shown('open');
    const frame = view().querySelector('iframe')!;
    const sandbox = frame.getAttribute('sandbox')!.split(' ');
    expect(sandbox).toEqual(['allow-scripts', 'allow-popups', 'allow-popups-to-escape-sandbox']);
    // An opaque origin: no storage, no requests as Lookout, no navigating the window.
    for (const never of ['allow-same-origin', 'allow-top-navigation', 'allow-top-navigation-by-user-activation', 'allow-forms']) expect(sandbox).not.toContain(never);
    expect(new URL(frame.getAttribute('src')!, window.location.origin).searchParams.get('frame')).toBe('1');
    expect(new URL(frame.getAttribute('src')!, window.location.origin).origin).toBe(window.location.origin);
  });
});

describe('unread (INBOX-3)', () => {
  it('INBOX-3.1: a Report is unread until it’s shown in the main pane, and the server is told once', async () => {
    const user = userEvent.setup();
    const inbox = openInbox('/inbox', {
      runs: [run({ id: 'r-1', title: 'Harbor week 42', arrivedAt: NOW - HOUR }), run({ id: 'r-2', title: 'Harbor week 41', arrivedAt: NOW - 2 * HOUR, read: true })],
      details: { 'r-1': { reply: 'One.' }, 'r-2': { reply: 'Two.' } },
    });
    // Listed isn't shown.
    expect(inbox.markReport).not.toHaveBeenCalled();
    expect(option('r-1')).toHaveAttribute('data-unread');
    await user.click(option('r-1'));
    await waitFor(() => expect(option('r-1')).not.toHaveAttribute('data-unread'));
    // The mark names the arrival that showed.
    expect(inbox.markReport.mock.calls).toEqual([['r-1', { read: true, arrivedAt: NOW - HOUR }]]);
    // What the server sends next doesn't mark it again, and one already read isn't marked.
    inbox.arrive([run({ id: 'r-1', title: 'Harbor week 42', arrivedAt: NOW - HOUR, read: true }), run({ id: 'r-2', title: 'Harbor week 41', arrivedAt: NOW - 2 * HOUR, read: true })]);
    await user.click(option('r-2'));
    await within(view()).findByText('Two.');
    expect(inbox.markReport).toHaveBeenCalledTimes(1);
    // It arrives again while it's open: shown, so read again.
    inbox.arrive([run({ id: 'r-2', title: 'Harbor week 41', arrivedAt: NOW - MINUTE, read: false }), run({ id: 'r-1', title: 'Harbor week 42', arrivedAt: NOW - HOUR, read: true })]);
    await waitFor(() => expect(inbox.markReport.mock.calls).toEqual([['r-1', { read: true, arrivedAt: NOW - HOUR }], ['r-2', { read: true, arrivedAt: NOW - MINUTE }]]));
  });

  it('INBOX-1.1, INBOX-3.1: a mark sent for the arrival that showed changes nothing once the Report arrived again', async () => {
    const waiting = run({ id: 'r-1', state: 'waiting', waitingFor: 'Allow Bash?', endedAt: null, holds: null, arrivedAt: NOW - HOUR });
    const inbox = openInbox('/inbox', { runs: [waiting] });
    // The tab's mark for the waiting Report reaches the server after the run finished and arrived again.
    inbox.arrive([{ ...waiting, state: 'finished', arrivedAt: NOW - MINUTE, endedAt: NOW - MINUTE, holds: { documents: 0, reply: true, first: null } }]);
    await act(async () => void (await inbox.markReport('r-1', { read: true, arrivedAt: NOW - HOUR })));
    expect(option('r-1')).toHaveAttribute('data-unread');
    await act(async () => void (await inbox.markReport('r-1', { archived: true, arrivedAt: NOW - HOUR })));
    expect(titles()).toEqual(['Harbor week 42']);
  });

  it('INBOX-3.2: an unread row has a 6 px dot in the title’s colour after a semibold title; Mark unread makes a Report unread again and leaves it open, read again the next time it’s selected', async () => {
    const user = userEvent.setup();
    const inbox = openInbox('/inbox/r-2', {
      runs: [run({ id: 'r-1', title: 'Harbor week 42', arrivedAt: NOW - HOUR }), run({ id: 'r-2', title: 'Harbor week 41', arrivedAt: NOW - 2 * HOUR, read: true })],
      details: { 'r-1': { reply: 'One.' }, 'r-2': { reply: 'Two.' } },
    });
    // SIDE-13.2's mark: the dot follows the title, in its colour, never Primary or a Status colour.
    const dot = option('r-1').querySelector('[data-slot="unread-dot"]')!;
    expect(dot).toHaveClass('size-1.5', 'rounded-full', 'bg-sidebar-foreground');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot.parentElement!.previousElementSibling).toHaveAttribute('data-field', 'title');
    expect(option('r-1').querySelector('[data-field="title"]')).toHaveClass('font-semibold');
    expect(option('r-2').querySelector('[data-slot="unread-dot"]')).toBeNull();
    expect(option('r-2').querySelector('[data-field="title"]')).toHaveClass('font-medium');
    expect(option('r-2').querySelector('[data-field="title"]')).not.toHaveClass('font-semibold');

    await within(view()).findByText('Two.');
    expect(inbox.markReport).not.toHaveBeenCalled();
    await user.click(within(await openMenu(user)).getByRole('menuitem', { name: 'Mark unread' }));
    await waitFor(() => expect(option('r-2')).toHaveAttribute('data-unread'));
    expect(inbox.markReport.mock.calls).toEqual([['r-2', { read: false, arrivedAt: NOW - 2 * HOUR }]]);
    // It stays open and unread: showing it doesn't mark it read again.
    expect(path()).toBe('/inbox/r-2');
    expect(within(view()).getByText('Two.')).toBeInTheDocument();
    expect(option('r-2')).toHaveAccessibleName(/, unread$/);
    // Unread already, so there's nothing to mark.
    expect(within(await openMenu(user)).getByRole('menuitem', { name: 'Mark unread' })).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Escape}');
    // Selected again, it's read again.
    await user.click(option('r-1'));
    await waitFor(() => expect(option('r-1')).not.toHaveAttribute('data-unread'));
    await user.click(option('r-2'));
    await waitFor(() => expect(option('r-2')).not.toHaveAttribute('data-unread'));
    expect(inbox.markReport.mock.calls).toEqual([['r-2', { read: false, arrivedAt: NOW - 2 * HOUR }], ['r-1', { read: true, arrivedAt: NOW - HOUR }], ['r-2', { read: true, arrivedAt: NOW - 2 * HOUR }]]);
  });

  it('INBOX-3.3: the rail counts the unread Reports that aren’t archived', async () => {
    const user = userEvent.setup();
    openInbox('/inbox', {
      runs: [
        run({ id: 'r-1', arrivedAt: NOW - HOUR }),
        run({ id: 'r-2', arrivedAt: NOW - 2 * HOUR }),
        run({ id: 'r-3', arrivedAt: NOW - 3 * HOUR, read: true }),
        // Unread, but archived by another tab; and a run that hasn't arrived.
        run({ id: 'r-4', archived: true }),
        run({ id: 'r-5', state: 'running', endedAt: null, arrivedAt: null }),
      ],
    });
    const count = () => within(screen.getByRole('navigation', { name: 'Places' })).getByRole('button', { name: /^Inbox/ }).querySelector('[data-field="count"]');
    expect(count()).toHaveTextContent('2');
    await user.click(option('r-1'));
    await waitFor(() => expect(count()).toHaveTextContent('1'));
    await user.click(option('r-2'));
    await waitFor(() => expect(count()).toBeNull());
  });

  it('BOT-2.6: on a second server a Report reads as usual, its refused read mark is neither shown nor tried again, and Archive and Mark unread are disabled with why', async () => {
    const user = userEvent.setup();
    const browser = vi.spyOn(window, 'open').mockImplementation(() => null);
    const unread = run({ id: 'r-1', title: 'Harbor week 42', arrivedAt: NOW - HOUR });
    const inbox = openInbox('/inbox/r-1', {
      runs: [unread, run({ id: 'r-2', title: 'Harbor week 41', arrivedAt: NOW - 2 * HOUR, read: true })],
      details: { 'r-1': { outputs: [output(), notes()], session: past() }, 'r-2': { reply: 'Two.' } },
      state: 'read-only',
    });
    await shown('open');
    // Tried once, refused, and nothing says so here: the Bots tab does.
    expect(inbox.markReport.mock.calls).toEqual([['r-1', { read: true, arrivedAt: NOW - HOUR }]]);
    inbox.arrive([unread, run({ id: 'r-2', title: 'Harbor week 41', arrivedAt: NOW - 2 * HOUR, read: true })]);
    await act(async () => {});
    expect(inbox.markReport).toHaveBeenCalledTimes(1);
    expect(within(view()).queryByRole('alert')).toBeNull();
    expect(option('r-1')).toHaveAttribute('data-unread');
    // Reading, the document strip, Open and the Session's button work as usual.
    expect(view().querySelector('iframe')).toHaveAttribute('title', 'Harbor week 42');
    expect(within(view()).getByRole('tablist', { name: 'Documents' })).toBeInTheDocument();
    expect(action('session')).toBeEnabled();
    await user.keyboard('o');
    expect(browser).toHaveBeenCalledTimes(1);
    // Archive is disabled, with the second server's words; E does nothing.
    expect(action('archive')).toBeDisabled();
    expect(action('archive')!.parentElement).toHaveAttribute('title', BOTS_READ_ONLY);
    await user.keyboard('e');
    expect(path()).toBe('/inbox/r-1');
    expect(inbox.markReport).toHaveBeenCalledTimes(1);
    // Mark unread is disabled too, on a Report that is read.
    await user.click(option('r-2'));
    await within(view()).findByText('Two.');
    const menu = await openMenu(user);
    expect(within(menu).getByRole('menuitem', { name: 'Mark unread' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).getByRole('note')).toHaveTextContent(BOTS_READ_ONLY);
    expect(within(menu).getByRole('menuitem', { name: 'Copy link' })).not.toHaveAttribute('aria-disabled');
    expect(inbox.markReport).toHaveBeenCalledTimes(1);
  });
});

describe('archive (INBOX-4)', () => {
  const three = () => [
    run({ id: 'r-a', title: 'Report A', arrivedAt: NOW - HOUR, read: true }),
    run({ id: 'r-b', title: 'Report B', arrivedAt: NOW - 2 * HOUR, read: true }),
    run({ id: 'r-c', title: 'Report C', arrivedAt: NOW - 3 * HOUR }),
  ];

  it('INBOX-4.1: Archive, the header’s button or E, moves the open Report into Archived and marks it read, and selects the next row down, else the one above, else nothing; in Archived it’s Move to Inbox', async () => {
    const user = userEvent.setup();
    const inbox = openInbox('/inbox/r-b', { runs: three() });
    expect(action('archive')).toHaveTextContent('Archive');
    expect(action('archive')).toHaveAttribute('title', 'Archive (E)');
    await user.click(action('archive')!);
    expect(inbox.markReport).toHaveBeenCalledWith('r-b', { archived: true, arrivedAt: NOW - 2 * HOUR });
    // The next row down, once the server kept it.
    await waitFor(() => expect(path()).toBe('/inbox/r-c'));
    await waitFor(() => expect(titles()).toEqual(['Report A', 'Report C']));
    // E: none below it, so the one above.
    await user.keyboard('e');
    expect(inbox.markReport).toHaveBeenCalledWith('r-c', { archived: true, arrivedAt: NOW - 3 * HOUR });
    await waitFor(() => expect(path()).toBe('/inbox/r-a'));
    await waitFor(() => expect(titles()).toEqual(['Report A']));
    // Held down, E archives one Report, not the pile.
    fireEvent.keyDown(window, { key: 'e', repeat: true });
    fireEvent.keyDown(window, { key: 'e', metaKey: true });
    expect(path()).toBe('/inbox/r-a');
    await user.keyboard('e');
    await waitFor(() => expect(path()).toBe('/inbox'));
    await waitFor(() => expect(within(column()).getByText('Nothing has arrived')).toBeInTheDocument());
    // Archived holds all three, each read: C was unread when it was archived.
    await user.click(choice('Archived'));
    expect(titles()).toEqual(['Report A', 'Report B', 'Report C']);
    expect(options().some((o) => o.hasAttribute('data-unread'))).toBe(false);
    // There the same button brings it back.
    await user.click(option('r-b'));
    expect(action('archive')).toHaveTextContent('Move to Inbox');
    expect(action('archive')).toHaveAttribute('title', 'Move to Inbox (E)');
    expect(action('archive')!.querySelector('[data-action-icon]')).toHaveAttribute('data-action-icon', 'unarchive');
    await user.click(action('archive')!);
    expect(inbox.markReport).toHaveBeenLastCalledWith('r-b', { archived: false, arrivedAt: NOW - 2 * HOUR });
    await waitFor(() => expect(titles()).toEqual(['Report A', 'Report C']));
    await user.click(choice('Inbox'));
    expect(titles()).toEqual(['Report B']);
  });

  it('INBOX-4.1: with a filter typed, archiving selects the next row that shows; an archive the server refuses moves nothing and says why', async () => {
    const user = userEvent.setup();
    const reports = () => [
      run({ id: 'r-a', title: 'Harbor week 42', arrivedAt: NOW - HOUR, read: true }),
      run({ id: 'r-b', title: 'Harbor week 41', arrivedAt: NOW - 2 * HOUR, read: true }),
      run({ id: 'r-x', title: 'Flaky tests', botName: 'Flaky tests', arrivedAt: NOW - 3 * HOUR, read: true }),
      run({ id: 'r-c', title: 'Harbor week 40', arrivedAt: NOW - 4 * HOUR, read: true }),
    ];
    openInbox('/inbox/r-b', { runs: reports() });
    await user.type(filter(), 'harbor');
    expect(titles()).toEqual(['Harbor week 42', 'Harbor week 41', 'Harbor week 40']);
    act(() => filter().blur());
    await user.keyboard('e');
    // Not the row the filter hides, though it is the next one of them all.
    await waitFor(() => expect(path()).toBe('/inbox/r-c'));
    expect(option('r-c')).toHaveAttribute('aria-selected', 'true');
    cleanup();

    const refused = openInbox('/inbox/r-b', { runs: reports(), refuse: "Lookout couldn't save its Bots, so nothing was changed." });
    await user.click(action('archive')!);
    const alert = await within(view()).findByRole('alert');
    expect(alert).toHaveTextContent("That wasn't saved");
    expect(alert).toHaveTextContent("Lookout couldn't save its Bots, so nothing was changed.");
    expect(refused.markReport).toHaveBeenCalledWith('r-b', { archived: true, arrivedAt: NOW - 2 * HOUR });
    expect(path()).toBe('/inbox/r-b');
    expect(titles()).toEqual(['Harbor week 42', 'Harbor week 41', 'Flaky tests', 'Harbor week 40']);
  });

  it('INBOX-4.2: archiving deletes nothing: the Report stays under Archived and opens as before', async () => {
    const user = userEvent.setup();
    const inbox = openInbox('/inbox/r-b', { runs: three(), details: { 'r-b': { outputs: [output({ title: 'Report B' })], reply: 'Kept.' } } });
    await shown('open');
    await user.keyboard('e');
    await waitFor(() => expect(titles()).toEqual(['Report A', 'Report C']));
    // Only a mark went to the server.
    expect(inbox.markReport.mock.calls.filter(([id]) => id === 'r-b')).toEqual([['r-b', { archived: true, arrivedAt: NOW - 2 * HOUR }]]);
    expect(inbox.app.client.deleteBot).not.toHaveBeenCalled();
    await user.click(choice('Archived'));
    expect(titles()).toEqual(['Report B']);
    await user.click(option('r-b'));
    expect(path()).toBe('/inbox/r-b');
    await shown('open');
    expect(view().querySelector('iframe')).toHaveAttribute('title', 'Report B');
  });
});

describe('keys (INBOX-5)', () => {
  const three = (): World => ({
    runs: [
      run({ id: 'r-a', title: 'Report A', arrivedAt: NOW - HOUR, read: true }),
      run({ id: 'r-b', title: 'Report B', arrivedAt: NOW - 2 * HOUR, read: true }),
      run({ id: 'r-c', title: 'Report C', arrivedAt: NOW - 3 * HOUR, read: true }),
    ],
    details: { 'r-b': { outputs: [notes()] } },
    texts: { '/out/notes.md': { text: 'The notes of the week.', truncated: false } },
  });

  it('INBOX-5.1: ↑/↓ and j/k move the selection and show the Report, and ⌘1 to ⌘9 select a row; not from a text field, the right sidebar or under a dialog, and ↑/↓ inside a Markdown Report scroll it', async () => {
    const user = userEvent.setup();
    const inbox = openInbox('/inbox', three());
    // With nothing selected, down goes to the first row and up to the last.
    await user.keyboard('{ArrowDown}');
    expect(path()).toBe('/inbox/r-a');
    await user.keyboard('j');
    expect(path()).toBe('/inbox/r-b');
    expect(option('r-b')).toHaveAttribute('aria-selected', 'true');
    expect(await within(view()).findByText('The notes of the week.')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    expect(path()).toBe('/inbox/r-c');
    // The ends hold.
    await user.keyboard('j');
    expect(path()).toBe('/inbox/r-c');
    await user.keyboard('k');
    expect(path()).toBe('/inbox/r-b');
    await user.keyboard('{ArrowUp}');
    expect(path()).toBe('/inbox/r-a');
    await user.keyboard('k');
    expect(path()).toBe('/inbox/r-a');
    // A step replaces the history entry; ⌘1–⌘9 select the first to ninth row.
    await user.keyboard('{Meta>}3{/Meta}');
    expect(path()).toBe('/inbox/r-c');
    await user.keyboard('{Meta>}1{/Meta}');
    expect(path()).toBe('/inbox/r-a');
    await user.keyboard('{Meta>}7{/Meta}');
    expect(path()).toBe('/inbox/r-a');
    // The Sessions' own list never moved (NAV-4.2).
    expect(path()).not.toMatch(/^\/s\//);

    // In the filter, the letters are text; the arrows still move.
    await user.keyboard('/');
    await user.keyboard('jk');
    expect(filter()).toHaveValue('jk');
    expect(path()).toBe('/inbox/r-a');
    await user.keyboard('{Escape}');
    await user.keyboard('/');
    await user.keyboard('{ArrowDown}');
    expect(path()).toBe('/inbox/r-b');
    expect(filter()).toHaveFocus();
    await user.keyboard('{Escape}');

    // ↑/↓ from inside a Markdown Report scroll it; j and k still move through the Reports.
    const text = await within(view()).findByRole('region', { name: 'Harbor notes' });
    expect(text).toHaveAttribute('data-scroll-keys');
    expect(text).toHaveAttribute('tabindex', '0');
    text.focus();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowUp}');
    expect(path()).toBe('/inbox/r-b');
    await user.keyboard('j');
    expect(path()).toBe('/inbox/r-c');

    // Not from the right sidebar, whose panels have their own lists.
    await user.keyboard('h');
    const tab = screen.getByRole('tab', { name: 'History' });
    for (const key of ['j', 'k', 'ArrowUp', 'e', 's', 'o']) fireEvent.keyDown(tab, { key });
    fireEvent.keyDown(tab, { key: '1', metaKey: true });
    expect(path()).toBe('/inbox/r-c');
    expect(inbox.markReport).not.toHaveBeenCalled();
    // Nor while a dialog is open.
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    await user.keyboard('kke');
    fireEvent.keyDown(window, { key: '1', metaKey: true });
    expect(path()).toBe('/inbox/r-c');
    expect(inbox.markReport).not.toHaveBeenCalled();
  });

  it('INBOX-5.1: E, O and S are the open Report’s, not a text field’s or an open menu’s', async () => {
    const user = userEvent.setup();
    const browser = vi.spyOn(window, 'open').mockImplementation(() => null);
    const inbox = openInbox('/inbox/r-b', { ...three(), sessions: [row({ id: 'writer-1' })] });
    await shown('open');
    // Typed into the filter, they are text.
    await user.type(filter(), 'eos');
    expect(filter()).toHaveValue('eos');
    await user.keyboard('{Escape}');
    // In the open More menu, they are the menu's.
    const menu = await openMenu(user);
    for (const key of ['e', 'o', 's']) fireEvent.keyDown(menu, { key });
    await user.keyboard('{Escape}');
    expect(browser).not.toHaveBeenCalled();
    expect(inbox.markReport).not.toHaveBeenCalled();
    expect(path()).toBe('/inbox/r-b');
    // On the page, each runs its action.
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await user.keyboard('o');
    expect(browser).toHaveBeenCalledTimes(1);
    await user.keyboard('e');
    expect(inbox.markReport).toHaveBeenCalledWith('r-b', { archived: true, arrivedAt: NOW - 2 * HOUR });
    await waitFor(() => expect(path()).toBe('/inbox/r-c'));
    await user.keyboard('s');
    expect(path()).toBe('/s/writer-1');
  });
});
