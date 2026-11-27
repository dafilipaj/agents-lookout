import type { BotRun, BotsSnapshot, ReportDetail } from '@shared/bots.ts';
import type { DocumentAnswer, OutputItem } from '@shared/library.ts';
import type { PeopleAnswer, PersonAnswer, PersonRow } from '@shared/people.ts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentView } from '@/components/DocumentView';
import { SaveError } from '@/lib/client';
import { VAULT_FRESH_MS, dayWords, matchesPerson, oneOnOneAge, oneOnOneFacts, oneOnOneLine, sortPeople, troubleWords } from '@/lib/people';
import { placeOfRoute } from '@/lib/places';
import { canGoBack, parseRoute, routePath } from '@/lib/router';
import { formatDayAge } from '@/lib/time';
import { renderApp, row, settings } from '@/test/helpers';

// Invented people, notes and paths throughout: the repo is public.
const VAULT = '/Users/me/notes';
const person = (name: string, over: Partial<PersonRow> = {}): PersonRow => ({ name, oneOnOnes: 0, last: null, next: null, ...over });
const PEOPLE: PeopleAnswer = {
  state: 'ok',
  folder: 'Team',
  people: [person('Tomo', { oneOnOnes: 1, last: '2026-11-18' }), person('Žana'), person('Ines', { oneOnOnes: 3, last: '2026-11-24', next: '2026-12-01' }), person('Vito', { oneOnOnes: 2 })],
};
const TALK = `${VAULT}/Team/Ines/1on1s/Ines 1on1 2026-11-24 - career talk.md`;
const INES: PersonAnswer = {
  state: 'ok',
  folder: 'Team',
  person: {
    name: 'Ines',
    oneOnOnes: [
      { name: 'Ines 1on1 2026-12-01', path: `${VAULT}/Team/Ines/1on1s/Ines 1on1 2026-12-01.md`, date: '2026-12-01', rest: '' },
      { name: 'Ines 1on1 2026-11-24 - career talk', path: TALK, date: '2026-11-24', rest: 'career talk' },
      { name: 'first talk', path: `${VAULT}/Team/Ines/1on1s/first talk.md`, date: null, rest: 'first talk' },
    ],
    notes: [
      { name: 'Career plan', path: `${VAULT}/Team/Ines/Career plan.md` },
      { name: 'Ines', path: `${VAULT}/Team/Ines/Ines.md` },
    ],
  },
};

const places = () => within(screen.getByRole('navigation', { name: 'Places' }));
const main = () => document.querySelector<HTMLElement>('[data-shell-column="main"]')!;
const leftColumn = () => document.querySelector<HTMLElement>('[data-shell-column="left"]')!;
const options = () => within(screen.getByRole('listbox', { name: 'People' })).getAllByRole('option');
const names = () => options().map((o) => o.querySelector('[data-field="name"]')!.textContent);
const open = (path: string, over: Parameters<typeof renderApp>[1] = {}, vault: Parameters<typeof settings>[0] = { vaultFolder: '~/notes' }) => {
  const app = renderApp(path, { people: vi.fn(async () => PEOPLE), person: vi.fn(async () => INES), ...over });
  app.snapshot([row({ id: 'a', title: 'alpha' })], { state: 'ok' }, settings(vault));
  return app;
};

beforeEach(() => {
  window.sessionStorage.clear();
  // Friday 27 November 2026, in local time, as a note's date is.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 27, 10, 0).getTime() });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PEOPLE-3: the People place', () => {
  it('PEOPLE-3.1: People is the rail’s third place, after Sessions, with its own icon, name and key, at its own paths, and no count', async () => {
    const user = userEvent.setup();
    open('/s/a');
    expect(places().getAllByRole('button').map((b) => b.textContent)).toEqual(['Inbox', 'Sessions', 'People']);
    const button = places().getByRole('button', { name: 'People' });
    expect(button).toHaveAttribute('title', 'People (3)');
    expect(button.querySelector('svg.lucide-users')).not.toBeNull();
    expect(button.querySelector('[data-field="count"]')).toBeNull();
    expect(button).not.toHaveAttribute('aria-current');

    await user.click(button);
    expect(window.location.pathname).toBe('/people');
    expect(places().getByRole('button', { name: 'People' })).toHaveAttribute('aria-current', 'page');
    expect(leftColumn()).toHaveAttribute('data-place', 'people');
    expect(leftColumn()).toHaveAccessibleName('People');

    // Its paths, and whose they are: a name no folder could have is the list alone.
    expect(parseRoute('/people')).toEqual({ name: 'people' });
    expect(parseRoute('/people/Ines')).toEqual({ name: 'people', person: 'Ines' });
    expect(parseRoute('/people/Tomo%20K')).toEqual({ name: 'people', person: 'Tomo K' });
    for (const odd of ['/people/.obsidian', '/people/_templates', '/people/Archive', '/people/%E0%A4%A']) expect(parseRoute(odd), odd).toEqual({ name: 'people' });
    expect(routePath({ name: 'people', person: 'Tomo K' })).toBe('/people/Tomo%20K');
    expect(routePath({ name: 'people' })).toBe('/people');
    expect(placeOfRoute({ name: 'people', person: 'Ines' }, 'sessions')).toBe('people');
  });

  it('PEOPLE-3.1: `3` shows People where you left it, and the right sidebar carries over', async () => {
    const user = userEvent.setup();
    open('/s/a');
    await user.keyboard('h');
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    // History took the keys for its search box; back on the page itself, `3` is a place's key.
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('3');
    expect(window.location.pathname).toBe('/people');
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    await user.click(await screen.findByRole('option', { name: /^Ines/ }));
    expect(window.location.pathname).toBe('/people/Ines');
    // Away to Sessions and back: the Person's page that was open.
    await user.keyboard('2');
    expect(window.location.pathname).toBe('/s/a');
    await user.keyboard('3');
    expect(window.location.pathname).toBe('/people/Ines');
    expect(await within(main()).findByRole('heading', { name: 'Ines', level: 1 })).toBeVisible();
    // Not from a text field.
    await user.keyboard('2');
    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.keyboard('3');
    expect(window.location.pathname).toBe('/s/a');
  });

  it('PEOPLE-3.2: the left column lists the Persons by name, A to Z, whatever their case or accents', async () => {
    open('/people');
    await waitFor(() => expect(names()).toEqual(['Ines', 'Tomo', 'Vito', 'Žana']));
    expect(sortPeople([{ name: 'tomo' }, { name: 'Ana' }, { name: 'Žana' }, { name: 'Zora' }, { name: 'Ćiro' }]).map((p) => p.name)).toEqual(['Ana', 'Ćiro', 'tomo', 'Žana', 'Zora']);
  });

  it('PEOPLE-3.3: a row shows the Person’s name and when their last 1on1 note was, else the next, else how many, else that there are none', async () => {
    open('/people');
    await waitFor(() => expect(options()).toHaveLength(4));
    expect(options().map((o) => o.querySelector('[data-field="one-on-one"]')!.textContent)).toEqual(['1on1 3d ago', '1on1 9d ago', '2 1on1 notes', 'No 1on1 notes']);
    expect(options()[0]).toHaveAccessibleName('Ines, 1on1 3d ago');

    const now = Date.now();
    expect(oneOnOneLine(person('x', { oneOnOnes: 1, last: '2026-11-27' }), now)).toBe('1on1 today');
    expect(oneOnOneLine(person('x', { oneOnOnes: 1, next: '2026-12-01' }), now)).toBe('1on1 in 4d');
    expect(oneOnOneLine(person('x', { oneOnOnes: 1 }), now)).toBe('1 1on1 note');
    // The server told last from next by its day at the read: a "next" that today has reached is the last by now.
    expect(oneOnOneLine(person('x', { oneOnOnes: 2, last: '2026-11-20', next: '2026-11-27' }), now)).toBe('1on1 today');
    // A folder the server couldn't read says so, never "No 1on1 notes".
    expect(oneOnOneLine(person('x', { unread: true }), now)).toBe("Couldn't read their notes");
    // GUIDE, "A time ago": a day's age, in a sentence and alone in a column.
    expect([formatDayAge(0), formatDayAge(3), formatDayAge(-4), formatDayAge(3, 'column'), formatDayAge(0, 'column'), formatDayAge(-4, 'column')]).toEqual(['today', '3d ago', 'in 4d', '3d', 'today', 'in 4d']);
  });

  it('PEOPLE-3.4: the list is read when People shows, when the window gets focus 30 s or more after the last read, and after a change of the Vault’s settings', async () => {
    const user = userEvent.setup();
    const people = vi.fn(async () => PEOPLE);
    const app = open('/s/a', { people });
    expect(people).not.toHaveBeenCalled();
    await user.keyboard('3');
    await waitFor(() => expect(options()).toHaveLength(4));
    expect(people).toHaveBeenCalledTimes(1);

    // Focus again too soon asks nothing; 30 s on, it asks.
    act(() => void window.dispatchEvent(new Event('focus')));
    expect(people).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + VAULT_FRESH_MS);
    act(() => void window.dispatchEvent(new Event('focus')));
    expect(people).toHaveBeenCalledTimes(2);

    // A change of the Vault's settings: the people folder, the Vault folder or the Private folders.
    app.snapshot([row({ id: 'a', title: 'alpha' })], { state: 'ok' }, settings({ vaultFolder: '~/notes', peopleFolder: 'Work/People' }));
    await waitFor(() => expect(people).toHaveBeenCalledTimes(3));
    app.snapshot([row({ id: 'a', title: 'alpha' })], { state: 'ok' }, settings({ vaultFolder: '~/notes', peopleFolder: 'Work/People', privateFolders: ['Work/People/*/Reviews'] }));
    await waitFor(() => expect(people).toHaveBeenCalledTimes(4));
    // Another setting saved asks nothing.
    app.snapshot([row({ id: 'a', title: 'alpha' })], { state: 'ok' }, settings({ vaultFolder: '~/notes', peopleFolder: 'Work/People', privateFolders: ['Work/People/*/Reviews'], idleThresholdHours: 9 }));
    await act(async () => {});
    expect(people).toHaveBeenCalledTimes(4);

    // While another place shows, the window's focus reads nothing; back in People, it reads again.
    await user.keyboard('2');
    vi.setSystemTime(Date.now() + VAULT_FRESH_MS);
    act(() => void window.dispatchEvent(new Event('focus')));
    expect(people).toHaveBeenCalledTimes(4);
    await user.keyboard('3');
    await waitFor(() => expect(people).toHaveBeenCalledTimes(5));
  });

  it('PEOPLE-3.5: the header cell’s filter keeps the rows whose name contains what’s typed, whatever the case or accents, and `/` focuses it', async () => {
    const user = userEvent.setup();
    open('/people');
    await waitFor(() => expect(options()).toHaveLength(4));
    const filter = screen.getByRole('searchbox', { name: 'Filter people' });
    expect(filter.closest('[data-shell-row="header"]')).not.toBeNull();
    expect(filter).not.toHaveFocus();
    await user.keyboard('/');
    expect(filter).toHaveFocus();
    await user.keyboard('zan');
    expect(names()).toEqual(['Žana']);
    await user.clear(filter);
    await user.type(filter, 'O');
    expect(names()).toEqual(['Tomo', 'Vito']);
    await user.clear(filter);
    await user.type(filter, 'nobody');
    expect(screen.queryByRole('listbox', { name: 'People' })).toBeNull();
    expect(within(leftColumn()).getByText('Nothing matches')).toBeVisible();
    // Esc clears the filter and leaves it.
    await user.keyboard('{Escape}');
    expect(filter).toHaveValue('');
    expect(filter).not.toHaveFocus();
    expect(names()).toEqual(['Ines', 'Tomo', 'Vito', 'Žana']);

    expect(matchesPerson('Žana', 'ZANA')).toBe(true);
    expect(matchesPerson('Žana', 'žan')).toBe(true);
    // A letter with a stroke has no accent to take off: its plain letter finds it all the same.
    expect(matchesPerson('Đuro', 'duro')).toBe(true);
    expect(matchesPerson('Duro', 'đu')).toBe(true);
    expect(matchesPerson('Ines', '  ')).toBe(true);
    expect(matchesPerson('Ines', 'tomo')).toBe(false);
  });

  it('PEOPLE-3.5: ↑/↓ and j/k move through the Persons and show their page, ⌘1–9 pick a row, and none of them moves the Session selection', async () => {
    const user = userEvent.setup();
    open('/people');
    await waitFor(() => expect(options()).toHaveLength(4));
    await user.keyboard('j');
    expect(window.location.pathname).toBe('/people/Ines');
    await user.keyboard('{ArrowDown}');
    expect(window.location.pathname).toBe('/people/Tomo');
    expect(screen.getByRole('option', { name: /^Tomo/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('k');
    expect(window.location.pathname).toBe('/people/Ines');
    await user.keyboard('{ArrowUp}');
    expect(window.location.pathname).toBe('/people/Ines');
    await user.keyboard('{Meta>}4{/Meta}');
    expect(window.location.pathname).toBe(`/people/${encodeURIComponent('Žana')}`);
    // In Sessions the same keys are the Session list's (NAV-4.2).
    await user.keyboard('2');
    expect(window.location.pathname).toBe('/');
    await user.keyboard('j');
    expect(window.location.pathname).toBe('/s/a');
  });

  it('PEOPLE-3.6: without what it needs, the main pane says so, with the way out', async () => {
    const user = userEvent.setup();
    // No Vault folder: the words, and a button to Settings' Vault section.
    const none = open('/people', { people: async () => ({ state: 'no-vault' }) }, {});
    expect(await within(main()).findByText('People reads your Vault.')).toBeVisible();
    await user.click(within(main()).getByRole('button', { name: 'Vault settings' }));
    expect(window.location.pathname).toBe('/settings/vault');
    none.unmount();

    const missing = open('/people', { people: async () => ({ state: 'no-folder', folder: 'Team' }) });
    expect(await within(main()).findByText('No Team folder in your Vault.')).toBeVisible();
    expect(within(main()).getByRole('button', { name: 'Vault settings' })).toBeVisible();
    missing.unmount();

    // A folder the server can't read is an error, with what to do about it.
    const denied = open('/people', { people: async () => ({ state: 'unreadable', folder: 'Team', reason: 'denied', detail: 'EPERM' }) });
    const alert = await within(main()).findByRole('alert');
    expect(alert).toHaveTextContent("Lookout can't read your Vault.");
    expect(alert).toHaveTextContent('System Settings, under Privacy & Security, Files and Folders');
    expect(within(main()).queryByRole('button', { name: 'Vault settings' })).toBeNull();
    denied.unmount();
    expect(troubleWords({ state: 'unreadable', folder: 'Team', reason: 'slow', detail: '' }).detail).toMatch(/no answer in 5 s/);
    expect(troubleWords({ state: 'unreadable', folder: 'Team', reason: 'error', detail: 'EIO' }).detail).toBe('The disk said EIO.');
    expect(troubleWords({ state: 'unreadable', folder: 'Team', reason: 'error', detail: '' }).detail).toBe('The disk gave no reason.');
    expect(troubleWords({ state: 'unreadable', folder: 'Team', reason: 'path', detail: '' }).detail).toMatch(/a ~ or a : in it/);

    // A Person's own folder that gave no answer is the same error on their page, never a page with no notes.
    const slow = open('/people/Ines', { person: async () => ({ state: 'unreadable', folder: 'Team', reason: 'slow', detail: '' }) });
    expect(await within(main()).findByRole('alert')).toHaveTextContent(/Lookout can't read your Vault\..*no answer in 5 s/);
    expect(within(main()).queryByText(/No 1on1 notes/)).toBeNull();
    expect(within(main()).getByRole('heading', { name: 'Ines', level: 1 })).toBeVisible();
    slow.unmount();

    const empty = open('/people', { people: async () => ({ state: 'ok', folder: 'Team', people: [] }) });
    expect(await within(main()).findByText('No people yet')).toBeVisible();
    expect(within(main()).getByText('Add a folder for each one to Team.')).toBeVisible();
    empty.unmount();

    // A server that is away says so, and never "No people yet".
    const away = open('/people', { people: async () => { throw new SaveError('Lookout server is unreachable.', null, null); } });
    expect(await within(main()).findByRole('alert')).toHaveTextContent('Lookout server is unreachable.');
    away.unmount();

    // With Persons listed and none picked.
    open('/people');
    expect(await within(main()).findByText('Select a person')).toBeVisible();
  });
});

describe('PEOPLE-4: a Person’s page', () => {
  it('PEOPLE-4.1: the header shows the Person’s name and, under it, how many 1on1 notes there are and when the last was, in two lines', async () => {
    open('/people/Ines');
    const title = await within(main()).findByRole('heading', { name: 'Ines', level: 1 });
    const header = title.closest('[data-shell-row="header"]')!;
    await waitFor(() => expect(header.querySelector('[data-field="facts"]')).toHaveTextContent('3 1on1 notes · last 3d ago'));
    // Two lines: the title, and one line of facts under it (SIDE-8.4).
    expect(title.parentElement!.children).toHaveLength(2);

    const now = Date.now();
    expect(oneOnOneFacts([], now)).toBe('No 1on1 notes');
    expect(oneOnOneFacts(['2026-12-01'], now)).toBe('1 1on1 note · next in 4d');
    expect(oneOnOneFacts(['2026-11-27', '2026-12-01'], now)).toBe('2 1on1 notes · last today');
    expect(oneOnOneFacts([null, null], now)).toBe('2 1on1 notes');
  });

  it('PEOPLE-4.2: "1on1 notes" lists the notes as the server orders them, each with its date, what else its name says and its age; one without a date shows its name', async () => {
    open('/people/Ines');
    const list = await within(main()).findByRole('list', { name: '1on1 notes' });
    const rows = within(list).getAllByRole('link');
    expect(rows.map((r) => r.textContent)).toEqual(['1 Dec 2026in 4d', '24 Nov 2026career talk3d', 'first talk']);
    expect(rows[1]!.querySelector('[data-field="age"]')).toHaveTextContent('3d');
    expect(rows[1]!.querySelector('[data-field="age"]')).toHaveClass('tabular-nums');
    expect([dayWords('2026-11-24'), dayWords('2026-01-05')]).toEqual(['24 Nov 2026', '5 Jan 2026']);
    expect([oneOnOneAge('2026-11-27', Date.now()), oneOnOneAge('2026-11-24', Date.now()), oneOnOneAge('2026-12-01', Date.now())]).toEqual(['today', '3d', 'in 4d']);
  });

  it('PEOPLE-4.3: "Notes" lists the other notes the server named, by name, under the 1on1 notes; a Person with none says so', async () => {
    const quiet: PersonAnswer = { state: 'ok', folder: 'Team', person: { name: 'Vito', oneOnOnes: [], notes: [] } };
    const app = open('/people/Ines');
    const notes = await within(main()).findByRole('list', { name: 'Notes' });
    expect(within(notes).getAllByRole('link').map((a) => a.textContent)).toEqual(['Career plan', 'Ines']);
    const talks = within(main()).getByRole('list', { name: '1on1 notes' });
    expect(talks.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    app.unmount();

    open('/people/Vito', { person: async () => quiet });
    expect(await within(main()).findByText(/No 1on1 notes yet\./)).toBeVisible();
    expect(within(main()).getByText('No other notes in their folder.')).toBeVisible();
    expect(within(main()).queryByRole('list')).toBeNull();
  });

  it('PEOPLE-4.4: a row opens its note in the Document view on a plain click or Enter, People stays the place with its list beside it, and Back returns to the page', async () => {
    const user = userEvent.setup();
    const document = vi.fn(async (path: string): Promise<DocumentAnswer> => ({ path, display: path.replace('/Users/me', '~'), type: 'markdown', exists: true, vault: true }));
    open('/people/Ines', { document, documentText: async () => ({ text: '# Ines 1on1\n\nThe import rewrite is on track.', truncated: false }) });
    const link = await within(main()).findByRole('link', { name: /24 Nov 2026/ });
    // A real link to the note's own path, so ⌘-click is the browser's.
    expect(link).toHaveAttribute('href', routePath({ name: 'doc', path: TALK, person: 'Ines' }));
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
    expect(window.location.pathname).toBe('/people/Ines');

    await user.click(link);
    expect(window.location.pathname).toBe(routePath({ name: 'doc', path: TALK, person: 'Ines' }));
    expect(await within(main()).findByText('The import rewrite is on track.')).toBeVisible();
    expect(document).toHaveBeenCalledWith(TALK);
    expect(places().getByRole('button', { name: 'People' })).toHaveAttribute('aria-current', 'page');
    expect(options()).toHaveLength(4);
    // The Person stays the selected row while their note is open.
    expect(screen.getByRole('option', { name: /^Ines/ })).toHaveAttribute('aria-selected', 'true');

    // PEOPLE-3.5: with focus in the note's text the arrow keys scroll it, and never move to another Person.
    act(() => within(main()).getByRole('region', { name: /career talk/ }).focus());
    await user.keyboard('{ArrowDown}');
    expect(window.location.pathname).toBe(routePath({ name: 'doc', path: TALK, person: 'Ines' }));

    await user.click(within(main()).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(window.location.pathname).toBe('/people/Ines'));
    expect(await within(main()).findByRole('heading', { name: 'Ines', level: 1 })).toBeVisible();

    // Its path is the Person's: a new tab on it is in People, and Back there goes to the Person's page.
    expect(routePath({ name: 'doc', path: TALK, person: 'Ines' })).toBe(`/people/Ines/doc/${encodeURIComponent(TALK)}`);
    expect(parseRoute(`/people/Ines/doc/${encodeURIComponent(TALK)}`)).toEqual({ name: 'doc', path: TALK, person: 'Ines' });
    expect(placeOfRoute({ name: 'doc', path: TALK, person: 'Ines' }, 'sessions')).toBe('people');
    for (const odd of [`/people/.git/doc/${encodeURIComponent(TALK)}`, '/people/Ines/doc/relative.md', '/people/Ines/doc/%E0%A4%A']) expect(parseRoute(odd), odd).toEqual({ name: 'people' });

    // Enter on the focused row opens it too.
    const again = await within(main()).findByRole('link', { name: /24 Nov 2026/ });
    again.focus();
    await user.keyboard('{Enter}');
    expect(window.location.pathname).toBe(routePath({ name: 'doc', path: TALK, person: 'Ines' }));
  });

  it('DOC-2.4: a note opened at its Person’s path with nothing before it in this tab, a new tab’s say, goes Back to that Person’s page, by the button and by Esc', async () => {
    const user = userEvent.setup();
    const at = routePath({ name: 'doc', path: TALK, person: 'Ines' });
    const over = {
      document: async (path: string): Promise<DocumentAnswer> => ({ path, display: path.replace('/Users/me', '~'), type: 'markdown', exists: true, vault: true }),
      documentText: async () => ({ text: '# Ines 1on1\n\nThe import rewrite is on track.', truncated: false }),
    };
    const first = open(at, over);
    expect(await within(main()).findByText('The import rewrite is on track.')).toBeVisible();
    expect(canGoBack()).toBe(false);
    await user.click(within(main()).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(window.location.pathname).toBe('/people/Ines'));
    expect(await within(main()).findByRole('heading', { name: 'Ines', level: 1 })).toBeVisible();
    expect(places().getByRole('button', { name: 'People' })).toHaveAttribute('aria-current', 'page');
    first.unmount();

    open(at, over);
    expect(await within(main()).findByText('The import rewrite is on track.')).toBeVisible();
    expect(canGoBack()).toBe(false);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(window.location.pathname).toBe('/people/Ines'));
  });

  it('PEOPLE-4.5: a Markdown file under the Vault folder opens in Obsidian, and the Document view’s button says so; any other Markdown file still opens in VS Code', async () => {
    const user = userEvent.setup();
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const view = (vault: boolean) =>
      render(<DocumentView path={TALK} load={async () => ({ path: TALK, display: '~/notes/Team/Ines/1on1s/x.md', type: 'markdown', exists: true, vault })} loadText={async () => ({ text: '# Note', truncated: false })} onBack={() => {}} keyboardEnabled />);
    const inVault = view(true);
    await user.click(await screen.findByRole('button', { name: 'Open in Obsidian' }));
    expect(opened).toHaveBeenLastCalledWith(`obsidian://open?path=${encodeURIComponent(TALK)}`, '_self');
    // `O` runs it.
    await user.keyboard('o');
    expect(opened).toHaveBeenCalledTimes(2);
    expect(opened.mock.calls[1]![0]).toMatch(/^obsidian:\/\/open\?path=%2FUsers%2Fme%2Fnotes%2FTeam%2FInes%2F1on1s%2FInes%201on1%202026-11-24%20-%20career%20talk\.md$/);
    inVault.unmount();

    view(false);
    await user.click(await screen.findByRole('button', { name: 'Open in VS Code' }));
    expect(String(opened.mock.calls.at(-1)![0])).toMatch(/^vscode:\/\/file\//);
  });

  it('PEOPLE-4.5: on a Report, Open reads "Open in Obsidian" for a note of the Vault and opens it there; a Report’s other documents keep "Open"', async () => {
    const user = userEvent.setup();
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const week = `${VAULT}/Reports/week 48.md`;
    const output = (over: Partial<OutputItem>): OutputItem => ({
      kind: 'file', key: week, type: 'markdown', title: 'Week 48', path: week, url: null, display: '~/notes/Reports/week 48.md', projectPath: null, repo: null,
      createdAt: 1, updatedAt: 1, events: 1, exists: true, source: null, sourcePath: null, sourceDisplay: null, version: null, sessions: [], ...over,
    });
    const run: BotRun = {
      id: 'run-1', botId: 'bot-1', botName: 'Team week', name: 'Team week · Nov 27', dueAt: null, startedAt: 1_000, lateMs: 0, state: 'finished', sessionId: 'run-session', harness: 'claude',
      waitingFor: null, endedAt: 2_000, failure: null, session: 'ended', arrivedAt: 2_000, title: 'Week 48', holds: { documents: 2, reply: false, first: null }, read: true, archived: false, launchId: null,
    };
    const bots: BotsSnapshot = { state: 'ok', path: '~/.lookout/bots.json', error: null, bots: [], runs: [run] };
    const detail = { run, outputs: [output({ vault: true }), output({ key: '/Users/me/work/output/notes.md', path: '/Users/me/work/output/notes.md', title: 'Notes' })], reply: null, session: null } as unknown as ReportDetail;
    const app = renderApp('/inbox/run-1', { report: async () => detail, reportText: async () => ({ text: '# Week 48', truncated: false }) });
    app.snapshot([], { state: 'ok' }, settings({ vaultFolder: '~/notes' }));
    app.emit({ type: 'bots', bots });

    await user.click(await within(main()).findByRole('button', { name: 'Open in Obsidian' }));
    expect(opened).toHaveBeenLastCalledWith(`obsidian://open?path=${encodeURIComponent(week)}`, '_self');
    // Its second document isn't the Vault's: "Open", to VS Code as before (INBOX-2.8).
    await user.click(within(main()).getByRole('tab', { name: /Notes/ }));
    await user.click(await within(main()).findByRole('button', { name: 'Open' }));
    expect(String(opened.mock.calls.at(-1)![0])).toMatch(/^vscode:\/\/file\//);
    expect(within(main()).queryByRole('button', { name: 'Open in Obsidian' })).toBeNull();
  });

  it('PEOPLE-4.6: a Person whose folder is gone says so, with the list still beside it', async () => {
    open('/people/Renamed', { person: async () => ({ state: 'gone', folder: 'Team', name: 'Renamed' }) });
    expect(await within(main()).findByText('No folder for Renamed in your Vault.')).toBeVisible();
    expect(within(main()).getByRole('heading', { name: 'Renamed', level: 1 })).toBeVisible();
    await waitFor(() => expect(options()).toHaveLength(4));
    expect(screen.queryByRole('option', { selected: true })).toBeNull();
  });

  it('PEOPLE-4.6: a path that spells the Person another way than their folder takes the folder’s spelling, so their row is the selected one', async () => {
    const person = vi.fn(async () => INES);
    open('/people/ines', { person });
    await waitFor(() => expect(window.location.pathname).toBe('/people/Ines'));
    expect(person).toHaveBeenCalledWith('ines');
    expect(await screen.findByRole('option', { name: /^Ines/ })).toHaveAttribute('aria-selected', 'true');
    // A note's link names them as the folder does.
    expect(await within(main()).findByRole('link', { name: /24 Nov 2026/ })).toHaveAttribute('href', routePath({ name: 'doc', path: TALK, person: 'Ines' }));
    // The path was put right in place: no entry of the tab's history is left behind for the other spelling.
    expect(canGoBack()).toBe(false);
  });

  it('PEOPLE-3.4: a Person’s page is read when it shows, and again after a change of the Vault’s settings', async () => {
    const one = vi.fn(async () => INES);
    const app = open('/people/Ines', { person: one });
    await within(main()).findByRole('list', { name: '1on1 notes' });
    expect(one).toHaveBeenCalledTimes(1);
    expect(one).toHaveBeenCalledWith('Ines');
    app.snapshot([row({ id: 'a', title: 'alpha' })], { state: 'ok' }, settings({ vaultFolder: '~/notes', privateFolders: ['Team/*/1on1s'] }));
    await waitFor(() => expect(one).toHaveBeenCalledTimes(2));
    vi.setSystemTime(Date.now() + VAULT_FRESH_MS);
    act(() => void window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(one).toHaveBeenCalledTimes(3));
  });
});
