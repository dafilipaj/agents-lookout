/**
 * PEOPLE-3, PEOPLE-4: what the server says of the people in the Vault, and what a note's name says.
 * Everything here comes from folder and file names: no note is opened for it (PEOPLE-3.4).
 */

/** PEOPLE-4.2: the folder of a Person's 1on1 notes, in any letter case. */
export const ONE_ON_ONES_FOLDER = '1on1s';

/** One Person in the list (PEOPLE-3.2, 3.3). */
export interface PersonRow {
  /** The Person's folder name: their name, and their path's last part. */
  name: string;
  /** How many 1on1 notes their page lists (PEOPLE-4.2): the Markdown notes of their `1on1s` folder. */
  oneOnOnes: number;
  /** The newest date in a 1on1 note's name that isn't after today, as `YYYY-MM-DD`. */
  last: string | null;
  /** The first date after today. */
  next: string | null;
  /** Their folder, or its `1on1s`, gave no answer: how many notes they have isn't known (PEOPLE-3.3). */
  unread?: boolean;
}

/** PEOPLE-3.6: why there is no list. `folder` is the people folder as the settings name it. */
export type VaultTrouble =
  | { state: 'no-vault' }
  | { state: 'no-folder'; folder: string }
  /**
   * `denied`: macOS refused the read; `slow`: no answer in time; `path`: the folder is at a path Lookout
   * opens no file under (VIEW-1.18); else what the disk said, in `detail` (empty when it gave no code).
   */
  | { state: 'unreadable'; folder: string; reason: 'denied' | 'slow' | 'path' | 'error'; detail: string };

export type PeopleAnswer = VaultTrouble | { state: 'ok'; folder: string; people: PersonRow[] };

/** A note a Person's page names: its file name without `.md`, and its absolute path. */
export interface NoteRow {
  name: string;
  path: string;
}

/** PEOPLE-4.2: a 1on1 note: its date, and what else its name says. */
export interface OneOnOneRow extends NoteRow {
  date: string | null;
  rest: string;
}

export interface PersonPage {
  name: string;
  oneOnOnes: OneOnOneRow[];
  notes: NoteRow[];
}

/** PEOPLE-4.6: `gone`: no folder of that name in the people folder. */
export type PersonAnswer = VaultTrouble | { state: 'gone'; folder: string; name: string } | { state: 'ok'; folder: string; person: PersonPage };

/**
 * PEOPLE-3.2: whether a folder's name can be a Person's: not `Archive`, and not one that starts with
 * `.` or `_`. Also what a Person's path may hold (`/people/<name>`).
 */
export function isPersonName(name: string): boolean {
  // eslint-disable-next-line no-control-regex -- a folder name from the disk or a path, checked whole
  return name.length > 0 && name.length <= 255 && !/[/\u0000-\u001f\u007f]/.test(name) && !name.startsWith('.') && !name.startsWith('_') && name.toLowerCase() !== 'archive';
}

/** A Markdown note by its file name: `.md` in any letter case, and no dotfile. */
export const isNoteFile = (file: string): boolean => /^[^.].*\.md$/i.test(file);
/** A note's name: its file name without `.md`. */
export const noteName = (file: string): string => file.replace(/\.md$/i, '');

const isDay = (year: number, month: number, day: number) => month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
const DATE = /(?<![0-9])([0-9]{4})-([0-9]{2})-([0-9]{2})(?![0-9])/g;

/** PEOPLE-4.2: the first date in a note's name that is a day of the calendar, as `YYYY-MM-DD`. */
export function noteDate(name: string): string | null {
  for (const m of name.matchAll(DATE)) if (isDay(Number(m[1]), Number(m[2]), Number(m[3]))) return m[0];
  return null;
}

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A word taken out of a name wherever it stands alone, whatever its letter case. */
const without = (text: string, word: string) => (word ? text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${literal(word)}(?![\\p{L}\\p{N}])`, 'giu'), ' ') : text);

/**
 * PEOPLE-4.2: what a 1on1 note's name says besides the Person's name, "1on1" and its date: nothing for
 * `Ines 1on1 2026-11-24`, "career talk" for `Ines 1on1 2026-11-24 - career talk`.
 */
export function oneOnOneRest(name: string, person: string): string {
  const date = noteDate(name);
  let rest = name.normalize('NFC');
  if (date) rest = rest.replace(date, ' ');
  rest = without(without(rest, person.normalize('NFC')), '1on1');
  return rest.replace(/\s+/g, ' ').replace(/^[\s\-_·,–—:]+|[\s\-_·,–—:]+$/g, '');
}

/** PEOPLE-4.2: newest first by the date in the name; notes without one last, by name. */
export function compareOneOnOnes(a: Pick<OneOnOneRow, 'date' | 'name'>, b: Pick<OneOnOneRow, 'date' | 'name'>): number {
  if (a.date !== null && b.date !== null && a.date !== b.date) return a.date < b.date ? 1 : -1;
  if ((a.date === null) !== (b.date === null)) return a.date === null ? 1 : -1;
  return a.name.localeCompare(b.name);
}

/** A time's day in local time, as `YYYY-MM-DD`. */
export function dayOf(at: number): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

const dayNumber = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000;
/** Whole days from one day to another: 3 when `to` is three days after `from`, -1 when it is the day before. */
export const daysBetween = (from: string, to: string): number => Math.round(dayNumber(to) - dayNumber(from));

/** PEOPLE-3.3: of the dates in 1on1 notes' names, the newest that isn't after today and the first that is. */
export function lastAndNext(dates: readonly (string | null)[], today: string): { last: string | null; next: string | null } {
  const dated = dates.filter((d): d is string => d !== null);
  const past = dated.filter((d) => d <= today).sort();
  const later = dated.filter((d) => d > today).sort();
  return { last: past.at(-1) ?? null, next: later[0] ?? null };
}
