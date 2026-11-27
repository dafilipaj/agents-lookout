import { chmod, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FolderEntry, People, type PeopleOptions } from './people.ts';
import { PrivateFolders } from './private-folders.ts';

// Invented people and notes; a real folder on disk, so the reads are the ones the server makes.
let home: string;
let vault: string;
let allowed: string[];
let privateFolders: PrivateFolders;

const note = async (path: string, text = '# A note\n') => {
  await mkdir(dirname(join(vault, path)), { recursive: true });
  await writeFile(join(vault, path), text);
};

const people = (over: Partial<PeopleOptions> = {}, settings: { vaultFolder: string | null; peopleFolder: string } = { vaultFolder: '~/vault', peopleFolder: 'Team' }) =>
  new People({
    settings: () => settings,
    home,
    isPrivateFolder: (path) => privateFolders.coversFolder(path),
    allow: (path) => void allowed.push(path),
    // Friday 27 November 2026, local time.
    now: () => new Date(2026, 10, 27, 10, 0).getTime(),
    ...over,
  });

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'lookout-people-')));
  vault = join(home, 'vault');
  await mkdir(join(vault, 'Team'), { recursive: true });
  allowed = [];
  privateFolders = new PrivateFolders({ home });
  await privateFolders.set({ vaultFolder: '~/vault', privateFolders: [] });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('PEOPLE-3: the Persons of the Vault', () => {
  it('PEOPLE-3.2: a Person is a folder directly inside the people folder; Archive, a Private folder, a dot or underscore folder, a file and a link to a folder are none', async () => {
    await note('Team/Ines/Ines.md');
    await note('Team/Tomo/1on1s/Tomo 1on1 2026-11-18.md');
    await note('Team/Archive/Vito/Vito.md');
    await note('Team/.obsidian/app.json');
    await note('Team/_templates/1on1.md');
    await note('Team/Cycle autumn/summary.md');
    await note('Team/Team overview.md');
    await note('Elsewhere/Zora/Zora.md');
    await symlink(join(vault, 'Elsewhere/Zora'), join(vault, 'Team/Zora'));
    await privateFolders.set({ vaultFolder: '~/vault', privateFolders: ['Team/Cycle *'] });

    const answer = await people().list();
    expect(answer).toMatchObject({ state: 'ok', folder: 'Team' });
    expect(answer.state === 'ok' && answer.people.map((p) => p.name)).toEqual(['Ines', 'Tomo']);
  });

  it('PEOPLE-3.2: the people folder is the one the settings name, inside the Vault folder', async () => {
    await note('Work/People/Ines/Ines.md');
    await note('Team/Tomo/Tomo.md');
    const answer = await people({}, { vaultFolder: '~/vault', peopleFolder: 'Work/People' }).list();
    expect(answer).toEqual({ state: 'ok', folder: 'Work/People', people: [{ name: 'Ines', oneOnOnes: 0, last: null, next: null }] });
  });

  it('PEOPLE-3.3: a row has how many 1on1 notes there are, the newest date not after today and the first after it', async () => {
    await note('Team/Ines/1on1s/Ines 1on1 2026-11-10.md');
    await note('Team/Ines/1on1s/Ines 1on1 2026-11-24.md');
    await note('Team/Ines/1on1s/Ines 1on1 2026-12-01.md');
    await note('Team/Ines/1on1s/agenda.txt');
    await note('Team/Ines/1on1s/Older/Ines 1on1 2025-01-01.md');
    await note('Team/Tomo/1ON1S/Tomo 1on1 2026-11-27.md');
    await note('Team/Vito/1on1s/first talk.md');
    await note('Team/Zora/Zora.md');

    const answer = await people().list();
    expect(answer.state === 'ok' && answer.people).toEqual([
      { name: 'Ines', oneOnOnes: 3, last: '2026-11-24', next: '2026-12-01' },
      { name: 'Tomo', oneOnOnes: 1, last: '2026-11-27', next: null },
      { name: 'Vito', oneOnOnes: 1, last: null, next: null },
      { name: 'Zora', oneOnOnes: 0, last: null, next: null },
    ]);
  });

  it('PEOPLE-3.3: a 1on1s folder that is private holds no notes for the list', async () => {
    await note('Team/Ines/1on1s/Ines 1on1 2026-11-24.md');
    await privateFolders.set({ vaultFolder: '~/vault', privateFolders: ['Team/*/1on1s'] });
    const answer = await people().list();
    expect(answer.state === 'ok' && answer.people).toEqual([{ name: 'Ines', oneOnOnes: 0, last: null, next: null }]);
  });

  it('PEOPLE-3.4: the list comes from folder and file names alone: it asks the disk only for folders’ entries, and a note nobody may open is still counted', async () => {
    await note('Team/Ines/1on1s/Ines 1on1 2026-11-24.md');
    await note('Team/Ines/Ines.md');
    await chmod(join(vault, 'Team/Ines/1on1s/Ines 1on1 2026-11-24.md'), 0o000);
    await chmod(join(vault, 'Team/Ines/Ines.md'), 0o000);
    const asked: string[] = [];
    const answer = await people({
      readdir: async (path): Promise<FolderEntry[]> => {
        asked.push(path);
        return readdir(path, { withFileTypes: true });
      },
    }).list();
    expect(answer.state === 'ok' && answer.people).toEqual([{ name: 'Ines', oneOnOnes: 1, last: '2026-11-24', next: null }]);
    // The people folder, the Person's folder and their 1on1s folder: three reads of names, and nothing else.
    expect(asked).toEqual([join(vault, 'Team'), join(vault, 'Team/Ines'), join(vault, 'Team/Ines/1on1s')]);
    expect(allowed).toEqual([]);
  });

  it('PEOPLE-3.6: with no Vault folder, no people folder, or a folder the disk won’t give, the answer says which', async () => {
    expect(await people({}, { vaultFolder: null, peopleFolder: 'Team' }).list()).toEqual({ state: 'no-vault' });
    expect(await people({}, { vaultFolder: '~/vault', peopleFolder: 'Crew' }).list()).toEqual({ state: 'no-folder', folder: 'Crew' });
    // A file where the folder should be is no folder either.
    await note('Notes.md');
    expect(await people({}, { vaultFolder: '~/vault', peopleFolder: 'Notes.md' }).list()).toEqual({ state: 'no-folder', folder: 'Notes.md' });

    const refuse = (code: string) => async () => {
      throw Object.assign(new Error(code), { code });
    };
    expect(await people({ readdir: refuse('EPERM') }).list()).toEqual({ state: 'unreadable', folder: 'Team', reason: 'denied', detail: 'EPERM' });
    // EACCES is the file modes' refusal, not macOS's: the disk's word.
    expect(await people({ readdir: refuse('EACCES') }).list()).toEqual({ state: 'unreadable', folder: 'Team', reason: 'error', detail: 'EACCES' });
    expect(await people({ readdir: async () => { throw new Error('no code'); } }).list()).toEqual({ state: 'unreadable', folder: 'Team', reason: 'error', detail: '' });
    expect(await people({ readdir: refuse('EIO') }).list()).toEqual({ state: 'unreadable', folder: 'Team', reason: 'error', detail: 'EIO' });
    // A disk that never answers is given up, not waited for.
    expect(await people({ readdir: () => new Promise(() => undefined), timeoutMs: 20 }).list()).toEqual({ state: 'unreadable', folder: 'Team', reason: 'slow', detail: '' });
    expect(await people({ readdir: refuse('EPERM') }).person('Ines')).toMatchObject({ state: 'unreadable', reason: 'denied' });
    expect(await people({}, { vaultFolder: null, peopleFolder: 'Team' }).person('Ines')).toEqual({ state: 'no-vault' });
  });

  it('PEOPLE-3.6: a Person’s folder named with a `~` or a `:` keeps its row, unread, and its page says why: no note under it could be opened', async () => {
    await note('Team/Ana ~ Design/1on1s/Ana 1on1 2026-11-24.md');
    await note('Team/Ines/Ines.md');
    const reader = people();
    expect(await reader.list()).toMatchObject({ state: 'ok', people: [{ name: 'Ana ~ Design', oneOnOnes: 0, unread: true }, { name: 'Ines' }] });
    expect(await reader.person('Ana ~ Design')).toEqual({ state: 'unreadable', folder: 'Team', reason: 'path', detail: '' });
    expect(allowed).toEqual([]);
  });

  it('PEOPLE-3.6: a Vault at a path Lookout opens no file under says so, for the list and for a Person', async () => {
    const at = join(home, 'Library/Mobile Documents/iCloud~md~notes/Documents/vault');
    await mkdir(join(at, 'Team/Ines/1on1s'), { recursive: true });
    await writeFile(join(at, 'Team/Ines/1on1s/Ines 1on1 2026-11-24.md'), '# 1on1\n');
    const settings = { vaultFolder: '~/Library/Mobile Documents/iCloud~md~notes/Documents/vault', peopleFolder: 'Team' };
    expect(await people({}, settings).list()).toEqual({ state: 'unreadable', folder: 'Team', reason: 'path', detail: '' });
    expect(await people({}, settings).person('Ines')).toEqual({ state: 'unreadable', folder: 'Team', reason: 'path', detail: '' });
    expect(allowed).toEqual([]);
  });

  it('PEOPLE-3.3, PEOPLE-3.6: a Person whose folder, or its 1on1s folder, gives no answer keeps their row, marked unread, and their page says the Vault can’t be read: never "no notes"', async () => {
    await note('Team/Ines/Ines.md');
    await note('Team/Ines/1on1s/Ines 1on1 2026-11-24.md');
    await note('Team/Tomo/1on1s/Tomo 1on1 2026-11-18.md');
    const failing = (bad: string, code: string | null) => async (path: string): Promise<FolderEntry[]> => {
      if (path === join(vault, bad)) return code === null ? new Promise(() => undefined) : Promise.reject(Object.assign(new Error(code), { code }));
      return readdir(path, { withFileTypes: true });
    };
    const tomo = { name: 'Tomo', oneOnOnes: 1, last: '2026-11-18', next: null };
    // The Person's own folder, refused.
    let reader = people({ readdir: failing('Team/Ines', 'EIO') });
    expect(await reader.list()).toMatchObject({ state: 'ok', people: [{ name: 'Ines', oneOnOnes: 0, last: null, next: null, unread: true }, tomo] });
    expect(await reader.person('Ines')).toEqual({ state: 'unreadable', folder: 'Team', reason: 'error', detail: 'EIO' });
    // Their 1on1s folder, with no answer in time.
    reader = people({ readdir: failing('Team/Ines/1on1s', null), timeoutMs: 20 });
    expect(await reader.list()).toMatchObject({ state: 'ok', people: [{ name: 'Ines', unread: true }, tomo] });
    expect(await reader.person('Ines')).toEqual({ state: 'unreadable', folder: 'Team', reason: 'slow', detail: '' });
    expect(allowed).toEqual([]);
    // A disk too slow to say whether their 1on1s folder is private: unread too, and none of its notes named.
    reader = people({ isPrivateFolder: async (path) => (path === join(vault, 'Team/Ines/1on1s') ? 'slow' : false) });
    expect(await reader.list()).toMatchObject({ state: 'ok', people: [{ name: 'Ines', unread: true }, tomo] });
    expect(await reader.person('Ines')).toEqual({ state: 'unreadable', folder: 'Team', reason: 'slow', detail: '' });
    // Too slow to say whether the Person's own folder is: hidden, as a private one is.
    reader = people({ isPrivateFolder: async (path) => (path === join(vault, 'Team/Ines') ? 'slow' : false) });
    expect(await reader.list()).toMatchObject({ state: 'ok', people: [tomo] });
    expect(await reader.person('Ines')).toEqual({ state: 'gone', folder: 'Team', name: 'Ines' });
    expect(allowed).toEqual([]);
    // A folder that went between the two reads is no Person.
    reader = people({ readdir: failing('Team/Ines', 'ENOENT') });
    expect(await reader.list()).toMatchObject({ state: 'ok', people: [tomo] });
    expect(await reader.person('Ines')).toEqual({ state: 'gone', folder: 'Team', name: 'Ines' });
  });
});

describe('PEOPLE-4: one Person’s notes', () => {
  it('PEOPLE-4.2: the 1on1 notes are the Markdown notes of the 1on1s folder, in any letter case, newest first, the ones without a date last', async () => {
    await note('Team/Ines/1On1s/Ines 1on1 2026-11-10.md');
    await note('Team/Ines/1On1s/Ines 1on1 2026-11-24 - career talk.md');
    await note('Team/Ines/1On1s/Ines 1on1 2026-12-01.md');
    await note('Team/Ines/1On1s/first talk.md');
    await note('Team/Ines/1On1s/agenda.txt');

    const answer = await people().person('Ines');
    const dir = join(vault, 'Team/Ines/1On1s');
    expect(answer.state === 'ok' && answer.person.oneOnOnes).toEqual([
      { name: 'Ines 1on1 2026-12-01', path: join(dir, 'Ines 1on1 2026-12-01.md'), date: '2026-12-01', rest: '' },
      { name: 'Ines 1on1 2026-11-24 - career talk', path: join(dir, 'Ines 1on1 2026-11-24 - career talk.md'), date: '2026-11-24', rest: 'career talk' },
      { name: 'Ines 1on1 2026-11-10', path: join(dir, 'Ines 1on1 2026-11-10.md'), date: '2026-11-10', rest: '' },
      { name: 'first talk', path: join(dir, 'first talk.md'), date: null, rest: 'first talk' },
    ]);
  });

  it('PEOPLE-4.3: Notes are the other Markdown notes directly in the Person’s folder, by name; no other file, no folder’s notes, no link and no path the Document view can’t take', async () => {
    await note('Team/Ines/Ines.md');
    await note('Team/Ines/Career plan.md');
    await note('Team/Ines/photo.png');
    await note('Team/Ines/.hidden.md');
    await note('Team/Ines/Goals/Q4 2026.md');
    await note('Team/Ines/Reviews/autumn review.md');
    await note('Team/Ines/Projects/import.md');
    await note('Team/Ines/1on1s/Ines 1on1 2026-11-24.md');
    await note('Team/Ines/~draft.md');
    await note('Elsewhere/secret.md');
    await symlink(join(vault, 'Elsewhere/secret.md'), join(vault, 'Team/Ines/linked.md'));

    const answer = await people().person('Ines');
    expect(answer.state === 'ok' && answer.person.notes).toEqual([
      { name: 'Career plan', path: join(vault, 'Team/Ines/Career plan.md') },
      { name: 'Ines', path: join(vault, 'Team/Ines/Ines.md') },
    ]);
    expect(answer.state === 'ok' && answer.person.oneOnOnes.map((n) => n.name)).toEqual(['Ines 1on1 2026-11-24']);
  });

  it('PEOPLE-3.3, PEOPLE-4.3: the list counts the 1on1 notes the page lists: one whose path the Document view can’t take is in neither', async () => {
    await note('Team/Ines/1on1s/Ines 1on1 2026-11-24.md');
    await note('Team/Ines/1on1s/Ines 1on1 2026-11-26 ~draft.md');
    const reader = people();
    expect(await reader.list()).toMatchObject({ state: 'ok', people: [{ name: 'Ines', oneOnOnes: 1, last: '2026-11-24', next: null }] });
    const page = await reader.person('Ines');
    expect(page.state === 'ok' && page.person.oneOnOnes.map((n) => n.name)).toEqual(['Ines 1on1 2026-11-24']);
  });

  it('PEOPLE-4.3: 1on1 notes in a Private folder are not named', async () => {
    await note('Team/Ines/Ines.md');
    await note('Team/Ines/1on1s/Ines 1on1 2026-11-24.md');
    await privateFolders.set({ vaultFolder: '~/vault', privateFolders: ['Team/*/1on1s'] });
    const answer = await people().person('Ines');
    expect(answer.state === 'ok' && answer.person).toEqual({ name: 'Ines', oneOnOnes: [], notes: [{ name: 'Ines', path: join(vault, 'Team/Ines/Ines.md') }] });
    expect(allowed).toEqual([join(vault, 'Team/Ines/Ines.md')]);
  });

  it('PEOPLE-4.4: every note a Person’s page names is listed for the Document view, and nothing else is', async () => {
    await note('Team/Ines/Ines.md');
    await note('Team/Ines/1on1s/Ines 1on1 2026-11-24.md');
    await note('Team/Ines/Reviews/autumn review.md');
    await note('Team/Tomo/Tomo.md');
    await people().person('Ines');
    expect(allowed.sort()).toEqual([join(vault, 'Team/Ines/1on1s/Ines 1on1 2026-11-24.md'), join(vault, 'Team/Ines/Ines.md')]);
  });

  it('PEOPLE-4.4: after a restart, a path inside the people folder has its Person’s notes listed again; a path anywhere else lists nothing', async () => {
    await note('Team/Ines/Ines.md');
    await note('Team/Ines/1on1s/Ines 1on1 2026-11-24.md');
    await note('Reports/week.md');
    const reader = people();
    expect(await reader.relist(join(vault, 'Reports/week.md'))).toBe(false);
    expect(await reader.relist(join(vault, 'Team/overview.md'))).toBe(false);
    expect(await reader.relist(join(vault, 'Team/Nobody/x.md'))).toBe(false);
    expect(await reader.relist('Team/Ines/Ines.md')).toBe(false);
    expect(allowed).toEqual([]);
    expect(await reader.relist(join(vault, 'Team/Ines/1on1s/Ines 1on1 2026-11-24.md'))).toBe(true);
    expect(allowed.sort()).toEqual([join(vault, 'Team/Ines/1on1s/Ines 1on1 2026-11-24.md'), join(vault, 'Team/Ines/Ines.md')]);
    expect(await people({}, { vaultFolder: null, peopleFolder: 'Team' }).relist(join(vault, 'Team/Ines/Ines.md'))).toBe(false);
  });

  it('PEOPLE-4.4: the Person read again is the one the path names, in its own letter case', async () => {
    await note('Team/Ines/Ines.md');
    const asked: string[] = [];
    const reader = people();
    const person = reader.person.bind(reader);
    reader.person = (name) => (asked.push(name), person(name));
    expect(await reader.relist(join(vault, 'Team/Ines/Ines.md'))).toBe(true);
    expect(await reader.relist(join(vault, 'team/INES/Ines.md'))).toBe(true);
    expect(asked).toEqual(['Ines', 'INES']);
  });

  it('PEOPLE-4.6: a name with no folder of its own is gone, and so is a private Person, a folder that is no Person and a link', async () => {
    await note('Team/Ines/Ines.md');
    await note('Team/Secret/Secret.md');
    await note('Team/Archive/Vito/Vito.md');
    await note('Elsewhere/Zora/Zora.md');
    await symlink(join(vault, 'Elsewhere/Zora'), join(vault, 'Team/Zora'));
    await privateFolders.set({ vaultFolder: '~/vault', privateFolders: ['Team/Secret'] });
    const reader = people();
    for (const name of ['Renamed', 'Secret', 'Archive', 'Zora', '..', 'Ines/1on1s', '']) expect(await reader.person(name), name).toEqual({ state: 'gone', folder: 'Team', name });
    expect(allowed).toEqual([]);
    // Whatever the letter case its path has, the Person is the folder's.
    expect(await reader.person('ines')).toMatchObject({ state: 'ok', person: { name: 'Ines' } });
  });
});
