import { homedir } from 'node:os';
import type { DocumentAnswer } from '../shared/library.ts';
import { LIBRARY_TYPES } from '../shared/library.ts';
import type { Library } from './library.ts';

/** DOC-3.3: an unlisted path has the Library read at most this often. */
export const RELIST_EVERY_MS = 30_000;

type Lists = Pick<Library, 'find' | 'files'>;
const relisted = new WeakMap<Lists, number>();

/**
 * DOC-3.1, 3.3: a file for the Document view: its Type and whether it still exists, when the server
 * listed its path. After a restart nothing is listed, so a path that could be (plain, absolute, a
 * document's extension) has the Library read once, headless Sessions included, before the answer;
 * a path in a chat is listed by the path check instead (VIEW-1.18). Null: not a file Lookout shows.
 */
export async function describeDocument(library: Lists, path: string, opts: { now?: number; home?: string } = {}): Promise<DocumentAnswer | null> {
  const now = opts.now ?? Date.now(), home = opts.home ?? (process.env.HOME || homedir());
  const shown = (file: Awaited<ReturnType<Lists['files']['describe']>>): DocumentAnswer | null =>
    file && { ...file, display: file.path === home || file.path.startsWith(`${home}/`) ? `~${file.path.slice(home.length)}` : file.path };
  const known = await library.files.describe(path);
  if (known || !library.files.couldList(path)) return shown(known);
  if (now - (relisted.get(library) ?? -Infinity) < RELIST_EVERY_MS) return null;
  relisted.set(library, now);
  // Every Type and gone files too: the read lists each file it finds, whatever the page it answers.
  await library.find({ query: '', page: 1, types: [...LIBRARY_TYPES], project: '', headless: true, hideGone: false }).catch(() => undefined);
  return shown(await library.files.describe(path));
}
