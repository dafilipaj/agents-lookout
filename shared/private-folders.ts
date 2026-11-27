/**
 * PEOPLE-2: Private folders. An entry names a folder, as a path inside the Vault folder or as a full
 * path, with `*` for any run of characters inside one folder's name. A file under a folder an entry
 * matches, at any depth, is private: never an Output, never read for the browser.
 */

export const MAX_PRIVATE_FOLDERS = 50;
export const MAX_PRIVATE_FOLDER_LENGTH = 300;

/** Why an entry is refused, in the words Settings shows. */
export const PRIVATE_FOLDER_ERROR = 'A Private folder is a folder inside the Vault, such as Team/*/Reviews, or a full path such as ~/notes/private.';

/** PEOPLE-2.1: an entry that is a full path (`/…`, `~`, `~/…`); any other is a path inside the Vault folder. */
export function isFullPath(entry: string): boolean {
  return entry.startsWith('/') || entry === '~' || entry.startsWith('~/');
}

/**
 * PEOPLE-2.2: one entry, trimmed and without a slash at its end; null when it is refused: empty, too
 * long, on more than one line, with an empty, `.` or `..` part, with two `*` in a row, another
 * user's home (`~name`), or a full path that names no folder outright (the root, the home, or
 * a path whose every part has a `*`): that would hide every Output on this Mac, or in the home.
 */
export function parsePrivateFolder(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const entry = value.trim().replace(/(.)\/+$/, '$1');
  if (!entry || [...entry].length > MAX_PRIVATE_FOLDER_LENGTH || /[\0\n\r]/.test(entry) || entry.includes('**')) return null;
  if (entry.startsWith('~') && !isFullPath(entry)) return null; // `~someone`
  if (entry === '/' || entry === '~') return null;
  const parts = (entry.startsWith('~/') ? entry.slice(2) : entry.startsWith('/') ? entry.slice(1) : entry).split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  if (isFullPath(entry) && parts.every((p) => p.includes('*'))) return null;
  return entry;
}

/** How paths are compared: whatever the letter case, and however an accented letter is encoded (PEOPLE-2.3). */
export function comparable(path: string): string {
  return path.normalize('NFC').toLowerCase().normalize('NFC');
}

/**
 * Whether one folder's name matches one part of a pattern, `*` standing for any run of characters.
 * Two cursors and one way back to the last `*`: its cost is the two lengths multiplied at worst, however
 * many `*` the part has, where an expression would back off once per `*`.
 */
function nameMatches(pattern: string, name: string): boolean {
  let p = 0;
  let n = 0;
  let star = -1;
  let mark = 0;
  while (n < name.length) {
    if (p < pattern.length && pattern[p] !== '*' && pattern[p] === name[n]) {
      p++;
      n++;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p++;
      mark = n;
    } else if (star !== -1) {
      p = star + 1;
      n = ++mark;
    } else return false;
  }
  while (pattern[p] === '*') p++;
  return p === pattern.length;
}

/** `~` and `~/…` under `home`; anything else as it is. */
function underHome(path: string, home: string): string {
  return path === '~' ? home : path.startsWith('~/') ? `${home.replace(/\/+$/, '')}/${path.slice(2)}` : path;
}

/**
 * PEOPLE-2.1: each entry as full folder patterns: a full path as it is, a path inside the Vault
 * under each form of the Vault folder it's given (as set, and as it resolves). An entry inside the
 * Vault matches nothing while there is no Vault folder.
 */
export function privatePatterns(entries: readonly string[], vaultFolders: readonly string[], home: string): string[] {
  const patterns: string[] = [];
  for (const entry of entries) {
    if (parsePrivateFolder(entry) === null) continue;
    if (isFullPath(entry)) patterns.push(underHome(entry, home));
    else for (const vault of vaultFolders) patterns.push(`${underHome(vault, home).replace(/\/+$/, '')}/${entry}`);
  }
  return [...new Set(patterns)];
}

/**
 * PEOPLE-2.3: whether an absolute path is a file under a matched folder, at any depth. A path that
 * only names the folder, or a file whose own name matches an entry, is not one: an entry names a
 * folder (0018). `patterns` are full folder patterns (privatePatterns), and the path is taken as
 * written: the caller resolves symlinks.
 */
export function privateMatcher(patterns: readonly string[]): (path: string) => boolean {
  const folders = patterns.map((pattern) => comparable(pattern).split('/'));
  if (folders.length === 0) return () => false;
  return (path) => {
    const parts = comparable(path).split('/');
    return folders.some((folder) => parts.length > folder.length && folder.every((part, i) => (part.includes('*') ? nameMatches(part, parts[i]!) : part === parts[i])));
  };
}

/**
 * The part of a full folder pattern before its first starred part, as a folder path, and the rest:
 * what can be resolved on disk, and what is matched after it. `/a/x*y/c` is `/a` and `x*y/c`.
 */
export function literalPrefix(pattern: string): { folder: string; rest: string } {
  const parts = pattern.split('/');
  const first = parts.findIndex((p) => p.includes('*'));
  if (first === -1) return { folder: pattern, rest: '' };
  return { folder: parts.slice(0, first).join('/') || '/', rest: parts.slice(first).join('/') };
}
