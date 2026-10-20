import { stat as fsStat } from 'node:fs/promises';
import { isAbsolute, normalize, resolve } from 'node:path';
import { MAX_PATHS, MAX_PATH_LENGTH, type PathAnswer } from '../shared/files.ts';
import type { SessionRow } from '../shared/types.ts';

/** VIEW-1.18: a batch's stats get this long together; one still out then is "not a file". */
export const CHECK_TIMEOUT_MS = 2000;

export class PathsError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface PathsOptions {
  /** The Session as Fleet currently lists it, or null. */
  lookup(sessionId: string): Pick<SessionRow, 'cwd'> | null;
  /** `fs.stat`; tests pass their own. Only ever asked whether a path is a file. */
  stat?: (path: string) => Promise<{ isFile(): boolean }>;
  timeoutMs?: number;
}

/** VIEW-1.18: `{ paths: [...] }`, 1–100 strings. Anything else is refused whole. */
export function parsePathsRequest(body: unknown): string[] {
  const b = (typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const paths = b.paths;
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PATHS || !paths.every((p) => typeof p === 'string')) {
    throw new PathsError(400, `Expected 1 to ${MAX_PATHS} paths.`);
  }
  return paths as string[];
}

/**
 * Control and format characters (bidi controls and invisible ones among them), a `~` (the shell's
 * home, or anyone's), a `:` (a URL or another scheme): not a plain path, so never looked up.
 */
const NOT_PLAIN = /[\p{Cc}\p{Cf}~:]/u;

/** A plain path: not empty, at most MAX_PATH_LENGTH characters, nothing in NOT_PLAIN. */
export function isPlainPath(p: string): boolean {
  return p.length > 0 && p.length <= MAX_PATH_LENGTH && !NOT_PLAIN.test(p);
}

/**
 * VIEW-1.18: for each path, in order, whether it's a regular file (a symlink to one counts) and, if
 * it is, its absolute path: relative ones against the Session's cwd, `..` and `.` resolved. Only
 * `stat` touches the disk: nothing is opened or read, and no command runs.
 */
export async function checkPaths(cwd: string | null, paths: readonly string[], opts: Pick<PathsOptions, 'stat' | 'timeoutMs'> = {}): Promise<PathAnswer[]> {
  const stat = opts.stat ?? fsStat;
  const base = cwd !== null && isAbsolute(cwd) && isPlainPath(cwd) ? cwd : null;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((r) => {
    timer = setTimeout(() => r(null), opts.timeoutMs ?? CHECK_TIMEOUT_MS);
  });
  const answer = async (path: string): Promise<PathAnswer> => {
    const absolute = !isPlainPath(path) ? null : isAbsolute(path) ? normalize(path) : base === null ? null : resolve(base, path);
    if (absolute === null) return { path, exists: false, absolute: null };
    const file = await Promise.race([
      stat(absolute).then(
        (s) => s.isFile(),
        () => false,
      ),
      timeout,
    ]);
    return file ? { path, exists: true, absolute } : { path, exists: false, absolute: null };
  };
  try {
    return await Promise.all(paths.map(answer));
  } finally {
    clearTimeout(timer);
  }
}

/** VIEW-1.18: the check for one Session, by the cwd Fleet lists for it. */
export async function checkSessionPaths(opts: PathsOptions, sessionId: string, body: unknown): Promise<PathAnswer[]> {
  const paths = parsePathsRequest(body);
  const row = opts.lookup(sessionId);
  if (!row) throw new PathsError(404, "This Session isn't running.");
  return checkPaths(row.cwd, paths, opts);
}
