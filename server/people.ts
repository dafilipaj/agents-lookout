import type { Dirent } from 'node:fs';
import { readdir as fsReaddir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';
import {
  type NoteRow,
  ONE_ON_ONES_FOLDER,
  type OneOnOneRow,
  type PeopleAnswer,
  type PersonAnswer,
  type PersonRow,
  type VaultTrouble,
  compareOneOnOnes,
  dayOf,
  isNoteFile,
  isPersonName,
  lastAndNext,
  noteDate,
  noteName,
  oneOnOneRest,
} from '../shared/people.ts';
import { comparable } from '../shared/private-folders.ts';
import type { Settings } from '../shared/settings.ts';
import { isPlainPath } from './files.ts';
import { expandHome } from './settings.ts';

/** What a folder's read gives of each entry: its name and whether it is a folder or a file itself, never through a link. */
export type FolderEntry = Pick<Dirent, 'name' | 'isDirectory' | 'isFile'>;

export interface PeopleOptions {
  /** The saved settings, read at every ask, so a change holds at once. */
  settings(): Pick<Settings, 'vaultFolder' | 'peopleFolder'>;
  home?: string;
  /**
   * PEOPLE-3.2, 4.3: whether a folder is a Private folder, or inside one (PrivateFolders.coversFolder).
   * `slow`: the disk didn't say in time; a Person's folder is hidden on it, their `1on1s` is unread.
   */
  isPrivateFolder(path: string): Promise<boolean | 'slow'>;
  /** PEOPLE-4.4: a note a Person's page named may be read for the Document view (DOC-3.1). */
  allow(path: string): void;
  /** `fs.readdir` with each entry's type; tests pass their own. */
  readdir?(path: string): Promise<FolderEntry[]>;
  /** How long a folder may take to answer; 5 s unless a test shortens it. */
  timeoutMs?: number;
  now?(): number;
}

type Unreadable = Pick<Extract<VaultTrouble, { state: 'unreadable' }>, 'reason' | 'detail'>;
/** How many Persons' folders are read at once. */
const AT_ONCE = 8;

/**
 * PEOPLE-3, PEOPLE-4: the people in the Vault, read from folder and file names alone (0018). A
 * Person is a folder directly in the people folder; their 1on1 notes are the Markdown files of its
 * `1on1s` folder, their other notes the Markdown files beside it. Nothing is kept between asks, no
 * note is opened (PEOPLE-3.4), and no link is followed: a link is neither a Person nor a note.
 */
export class People {
  private readonly opts: PeopleOptions;

  constructor(opts: PeopleOptions) {
    this.opts = opts;
  }

  /** The people folder: as the settings name it, and where it is. Null with no Vault folder. */
  private where(): { folder: string; root: string } | null {
    const { vaultFolder, peopleFolder } = this.opts.settings();
    if (vaultFolder === null) return null;
    return { folder: peopleFolder, root: normalize(join(expandHome(vaultFolder, this.opts.home ?? homedir()), peopleFolder)) };
  }

  /** A folder's entries; `missing` when there is no such folder, else why it can't be read. */
  private async read(path: string): Promise<FolderEntry[] | 'missing' | Unreadable> {
    const readdir = this.opts.readdir ?? ((p: string) => fsReaddir(p, { withFileTypes: true }));
    let timer: NodeJS.Timeout | undefined;
    const slow = new Promise<Unreadable>((resolve) => {
      timer = setTimeout(() => resolve({ reason: 'slow', detail: '' }), this.opts.timeoutMs ?? 5000);
    });
    const entries = readdir(path).catch((err: unknown): 'missing' | Unreadable => {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing';
      // macOS answers EPERM for a folder Files and Folders doesn't allow. EACCES is the file modes' doing: the disk's word.
      if (code === 'EPERM') return { reason: 'denied', detail: code };
      return { reason: 'error', detail: code ?? '' };
    });
    return Promise.race([entries, slow]).finally(() => clearTimeout(timer));
  }

  /** The people folder's entries, or the answer that says why there are none (PEOPLE-3.6). */
  private async root(): Promise<{ folder: string; root: string; entries: FolderEntry[] } | VaultTrouble> {
    const at = this.where();
    if (!at) return { state: 'no-vault' };
    // PEOPLE-3.6: under a path the Document view takes no file at (VIEW-1.18), not one note could be opened.
    if (!isPlainPath(at.root)) return { state: 'unreadable', folder: at.folder, reason: 'path', detail: '' };
    const entries = await this.read(at.root);
    if (entries === 'missing') return { state: 'no-folder', folder: at.folder };
    if (!Array.isArray(entries)) return { state: 'unreadable', folder: at.folder, ...entries };
    return { ...at, entries };
  }

  /**
   * One Person's folder: the Markdown notes directly in it, and those of its `1on1s` folder with where
   * that is. Only notes the Document view can take (PEOPLE-4.3), so the list's count and the page say
   * the same. A private `1on1s` holds none. `missing`: the folder went since the People folder was
   * read. Unreadable: it, or its `1on1s`, gave no answer, which is never "no notes".
   */
  private async folder(dir: string): Promise<{ notes: string[]; oneOnOnes: { dir: string; files: string[] } | null } | 'missing' | Unreadable> {
    // A folder at a path the Document view takes no file under (VIEW-1.18): none of its notes could be opened.
    if (!isPlainPath(dir)) return { reason: 'path', detail: '' };
    const entries = await this.read(dir);
    if (!Array.isArray(entries)) return entries;
    const markdown = (at: string, list: FolderEntry[]) => list.filter((e) => e.isFile() && isNoteFile(e.name) && isPlainPath(join(at, e.name))).map((e) => e.name);
    const notes = markdown(dir, entries);
    // PEOPLE-4.2: in any letter case; with two of them on a disk that tells case apart, the first by name.
    const named = entries.filter((e) => e.isDirectory() && e.name.toLowerCase() === ONE_ON_ONES_FOLDER).map((e) => e.name).sort()[0];
    if (named === undefined) return { notes, oneOnOnes: null };
    const inner = join(dir, named);
    const hidden = await this.opts.isPrivateFolder(inner);
    // A disk too slow to say whether `1on1s` is private: unread, never "no notes". Its name is the same for everyone.
    if (hidden === 'slow') return { reason: 'slow', detail: '' };
    if (hidden) return { notes, oneOnOnes: null };
    const inside = await this.read(inner);
    if (inside === 'missing') return { notes, oneOnOnes: null };
    if (!Array.isArray(inside)) return inside;
    return { notes, oneOnOnes: { dir: inner, files: markdown(inner, inside) } };
  }

  /** PEOPLE-3.2, 3.3: every Person, with how many 1on1 notes they have and when the last and the next are. */
  async list(): Promise<PeopleAnswer> {
    const at = await this.root();
    if ('state' in at) return at;
    const today = dayOf((this.opts.now ?? Date.now)());
    const folders = at.entries.filter((e) => e.isDirectory() && isPersonName(e.name)).map((e) => e.name);
    const people: PersonRow[] = [];
    let next = 0;
    const worker = async () => {
      while (next < folders.length) {
        const name = folders[next++]!;
        const dir = join(at.root, name);
        if (await this.opts.isPrivateFolder(dir)) continue;
        const read = await this.folder(dir);
        // Gone since the People folder was read: no Person.
        if (read === 'missing') continue;
        // PEOPLE-3.3: a folder that gave no answer keeps its row, which says so in place of a count.
        if ('reason' in read) {
          people.push({ name, oneOnOnes: 0, last: null, next: null, unread: true });
          continue;
        }
        const files = read.oneOnOnes?.files ?? [];
        people.push({ name, oneOnOnes: files.length, ...lastAndNext(files.map((f) => noteDate(noteName(f))), today) });
      }
    };
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, folders.length) }, worker));
    // The browser sorts them for show (PEOPLE-3.2); by name here so two asks answer alike.
    people.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { state: 'ok', folder: at.folder, people };
  }

  /**
   * PEOPLE-4.2, 4.3: one Person's notes by name, each listed for the Document view (PEOPLE-4.4). A name
   * that is no Person's folder, a private one included, is `gone` and says nothing else. A folder that
   * gave no answer is the Vault unread (PEOPLE-3.6), never a page with no notes.
   */
  async person(name: string): Promise<PersonAnswer> {
    const at = await this.root();
    if ('state' in at) return at;
    const gone: PersonAnswer = { state: 'gone', folder: at.folder, name };
    if (!isPersonName(name)) return gone;
    const folders = at.entries.filter((e) => e.isDirectory() && isPersonName(e.name)).map((e) => e.name);
    // As the path has it; else whatever its letter case or the encoding of an accented letter.
    const found = folders.find((f) => f === name) ?? folders.find((f) => comparable(f) === comparable(name));
    if (found === undefined) return gone;
    const dir = join(at.root, found);
    if (await this.opts.isPrivateFolder(dir)) return gone;
    const read = await this.folder(dir);
    if (read === 'missing') return gone;
    if ('reason' in read) return { state: 'unreadable', folder: at.folder, ...read };
    const note = (folder: string, file: string): NoteRow => {
      const path = join(folder, file);
      this.opts.allow(path);
      return { name: noteName(file), path };
    };
    const notes = read.notes.map((file) => note(dir, file));
    const inner = read.oneOnOnes;
    const dated = (inner?.files ?? []).map((file): OneOnOneRow => {
      const row = note(inner!.dir, file);
      return { ...row, date: noteDate(row.name), rest: oneOnOneRest(row.name, found) };
    });
    return { state: 'ok', folder: at.folder, person: { name: found, oneOnOnes: dated.sort(compareOneOnOnes), notes: notes.sort((a, b) => a.name.localeCompare(b.name)) } };
  }

  /**
   * PEOPLE-4.4, DOC-3.3: after a restart nothing is listed: for a path inside the people folder, reads
   * the folder of the Person it is in, which lists that Person's notes again. False for any other path.
   */
  async relist(path: string): Promise<boolean> {
    const at = this.where();
    if (!at || !isAbsolute(path) || !isPlainPath(path)) return false;
    const root = at.root.replace(/(.)\/+$/, '$1').split('/');
    const parts = normalize(path).split('/');
    // A file inside a Person's folder: the People folder, a folder, and at least a file's name under it.
    if (parts.length < root.length + 2 || comparable(parts.slice(0, root.length).join('/')) !== comparable(root.join('/'))) return false;
    // The Person as the path names them, so on a disk that tells letter case apart the folder asked for is the one read.
    return (await this.person(parts[root.length]!)).state === 'ok';
  }
}
