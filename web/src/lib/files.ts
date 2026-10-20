import { MAX_PATHS, type PathAnswer } from '@shared/files.ts';
import { createContext } from 'react';

/**
 * VIEW-1.17: the common code and doc extensions a path's file name may end in, compared ignoring
 * case. A file name without one (`Makefile`, `.env`) isn't a path here.
 */
export const FILE_EXTENSIONS = [
  // JavaScript and TypeScript, and their frameworks
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte', 'astro',
  // data and configuration
  'json', 'jsonc', 'json5', 'jsonl', 'ndjson', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'properties', 'xml', 'plist', 'csv', 'tsv', 'lock',
  // docs
  'md', 'mdx', 'markdown', 'txt', 'rst', 'adoc', 'org', 'tex',
  // the web
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'styl', 'svg',
  'hbs', 'handlebars', 'ejs', 'pug', 'twig', 'liquid', 'njk', 'mustache', 'erb', 'haml', 'slim', 'heex',
  // other languages
  'rb', 'rake', 'gemspec', 'ru', 'py', 'pyi', 'ipynb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'groovy', 'gradle', 'swift',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hh', 'hpp', 'cs', 'fs', 'php', 'sql', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'lua', 'pl', 'pm',
  'ex', 'exs', 'erl', 'hrl', 'hs', 'elm', 'ml', 'mli', 'clj', 'cljs', 'edn', 'dart', 'jl', 'nim', 'zig', 'sol',
  'graphql', 'gql', 'proto', 'prisma', 'tf', 'tfvars', 'hcl', 'nix',
  // logs and patches
  'log', 'diff', 'patch',
];

/**
 * Path characters, plus the ones that make a run of them text (`~`, `$`, `%`, `\`, a `:` other than
 * `:line`): a run is the most a path can be, found in one linear pass.
 */
const RUN = /[\p{L}\p{M}\p{N}_.@+\-/~$%:\\]+/gu;
/** Longer runs are skipped: no path is that long, and the match below stays cheap. */
const MAX_RUN = 512;
const NAME = '[\\p{L}\\p{M}\\p{N}_.@+\\-]';
/**
 * A run that is a path, whole: optionally `./`, `../` or `/`, folders, a file name with a known
 * extension, then optionally `:line`, `:line:col` and a range's `-n`.
 */
const PATH = new RegExp(
  `^((?:\\.{1,2}/|/)?(?:${NAME}+/)*\\.?[\\p{L}\\p{M}\\p{N}_@+\\-]${NAME}*\\.(?:${FILE_EXTENSIONS.join('|')}))(?::(\\d{1,7})(?::(\\d{1,7}))?(?:-\\d{1,7})?)?$`,
  'iu',
);
/** A sentence's full stop, "in src/a.ts: …", a dash: never the end of a path. */
const TRAILING = /[.:-]+$/;

export interface PathRef {
  /** The path as written, without `:line:col`: what the server is asked about. */
  path: string;
  line: number | null;
  col: number | null;
}

/** The path a run of text names, or null. */
export function parsePath(text: string): PathRef | null {
  const m = PATH.exec(text);
  if (!m) return null;
  const line = m[2] === undefined ? null : Number(m[2]);
  return { path: m[1]!, line, col: line !== null && m[3] !== undefined ? Number(m[3]) : null };
}

export interface PathPart {
  text: string;
  /** Set when `text` is a path, with its `:line:col` if any. */
  ref: PathRef | null;
}

/** VIEW-1.17: the text cut into plain runs and paths, in order: joined, they're the text exactly. */
export function pathParts(text: string): PathPart[] {
  const parts: PathPart[] = [];
  let from = 0;
  for (const m of text.matchAll(RUN)) {
    if (m[0].length > MAX_RUN) continue;
    const run = m[0].replace(TRAILING, '');
    const ref = run ? parsePath(run) : null;
    if (!ref) continue;
    if (m.index > from) parts.push({ text: text.slice(from, m.index), ref: null });
    parts.push({ text: run, ref });
    from = m.index + run.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), ref: null });
  return parts;
}

/** `vscode://file/<absolute path>[:line[:col]]`, each segment of the path percent-encoded. */
export function vscodeHref(absolute: string, line: number | null, col: number | null): string {
  const path = absolute.split('/').map(encodeURIComponent).join('/');
  return `vscode://file${path}${line !== null ? `:${line}` : ''}${line !== null && col !== null ? `:${col}` : ''}`;
}

export type CheckPaths = (sessionId: string, paths: string[]) => Promise<PathAnswer[]>;

/** VIEW-1.18: how long the tab trusts an answer before it asks again… */
export const ANSWER_TTL_MS = 30_000;
/** …how long it collects the paths rows want before asking… */
export const BATCH_DELAY_MS = 30;
/** …and how many answers it keeps per Session, beyond which expired ones go (fresh ones never do). */
const MAX_ANSWERS = 2000;
// eslint-disable-next-line no-control-regex -- an absolute path from the server, checked anyway
const ABSOLUTE = /^\/[^\u0000-\u001f\u007f]*$/;

/**
 * VIEW-1.18: one Session's answers in the tab. `FilePath`s say which paths they show; the store asks
 * the server in batches of at most MAX_PATHS, one request at a time, and keeps each answer for
 * ANSWER_TTL_MS. A failed request counts as "not a file" for as long. Past MAX_ANSWERS only expired
 * answers go, so a path is never asked twice in ANSWER_TTL_MS.
 */
export class FileStore {
  private readonly known = new Map<string, { absolute: string | null; at: number }>();
  /** Wanted and not answered yet, those being asked included. */
  private readonly wanted = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private asking = false;
  /** When the newest answer came. */
  private lastAnswer: number | null = null;
  private readonly sessionId: string;
  private readonly check: CheckPaths;

  constructor(sessionId: string, check: CheckPaths) {
    this.sessionId = sessionId;
    this.check = check;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** The file's absolute path, or null: not a file, or not answered yet. */
  absolute(path: string): string | null {
    return this.known.get(path)?.absolute ?? null;
  }

  /** Something is being asked, or an answer is still fresh: dropping the store would ask again too soon. */
  busy(): boolean {
    return this.wanted.size > 0 || (this.lastAnswer !== null && Date.now() - this.lastAnswer < ANSWER_TTL_MS);
  }

  /** A row shows this path: ask about it, unless there's a fresh answer or it's being asked. */
  want(path: string): void {
    const known = this.known.get(path);
    if ((known && Date.now() - known.at < ANSWER_TTL_MS) || this.wanted.has(path)) return;
    this.wanted.add(path);
    this.timer ??= setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, BATCH_DELAY_MS);
  }

  private async flush(): Promise<void> {
    if (this.asking) return;
    this.asking = true;
    try {
      while (this.wanted.size > 0) {
        const batch = [...this.wanted].slice(0, MAX_PATHS);
        let answers: PathAnswer[] = [];
        try {
          answers = await this.check(this.sessionId, batch);
        } catch {
          // Not a file, for now: the Session ended, or the server couldn't say.
        }
        const byPath = new Map(answers.map((a) => [a.path, a]));
        const at = Date.now();
        this.lastAnswer = at;
        for (const path of batch) {
          const a = byPath.get(path);
          this.wanted.delete(path);
          this.known.delete(path); // re-inserted last: the oldest answers go first
          this.known.set(path, { absolute: a?.exists && typeof a.absolute === 'string' && ABSOLUTE.test(a.absolute) ? a.absolute : null, at });
        }
        // Oldest first: stop at the first fresh one, which the rest are newer than.
        for (const [old, k] of this.known) {
          if (this.known.size <= MAX_ANSWERS || Date.now() - k.at < ANSWER_TTL_MS) break;
          this.known.delete(old);
        }
        for (const l of this.listeners) l();
      }
    } finally {
      this.asking = false;
    }
  }
}

/**
 * The stores of the Sessions viewed last are kept, so switching back reuses their answers; an older
 * one goes only once it's idle (`busy`), so no path is asked twice in ANSWER_TTL_MS.
 */
const MAX_STORES = 8;

/** VIEW-1.17: every live Session's file links in this tab, one store per Session. */
export class FileLinks {
  private readonly stores = new Map<string, FileStore>();
  private readonly check: CheckPaths;

  constructor(check: CheckPaths) {
    this.check = check;
  }

  session(sessionId: string): FileStore {
    const store = this.stores.get(sessionId) ?? new FileStore(sessionId, this.check);
    this.stores.delete(sessionId);
    this.stores.set(sessionId, store);
    let over = this.stores.size - MAX_STORES;
    for (const [old, s] of this.stores) {
      if (over <= 0) break;
      if (old === sessionId || s.busy()) continue;
      this.stores.delete(old);
      over--;
    }
    return store;
  }
}

/** App's registry, given to the main pane only: a past Session's chat (HIST-3.3) has no file links. */
export const FileLinksContext = createContext<FileLinks | null>(null);
/** The viewed Session's store, given by its Chat. */
export const SessionFilesContext = createContext<FileStore | null>(null);
