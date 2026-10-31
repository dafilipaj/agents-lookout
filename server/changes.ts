import { accessSync, constants } from 'node:fs';
import { mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, delimiter, join, sep } from 'node:path';
import type { ChangedCheckout, ChangedFile, ChangeKind, ChangesView, RowChanges, ServerEvent, SessionRow, Status } from '../shared/types.ts';
import type { RunError, Runner } from './exec.ts';
import { fleetObject } from './fleet.ts';
import { repoName } from './git.ts';

/** DIFF-2.6: how often a Session's Changes are asked for, by what it's doing. */
export const BUSY_INTERVAL_MS = 10_000;
export const IDLE_INTERVAL_MS = 60_000;
/** DIFF-2.6, DIFF-3.6: while a tab has the Session's list open. */
export const WATCHED_INTERVAL_MS = 3_000;
/** DIFF-5.2: an ask is killed after this long. */
export const DIFF_TIMEOUT_MS = 60_000;
/** DIFF-5.2: the last answer stays this long after it was last confirmed; DIFF-4.4: opening needs one this fresh. */
export const STALE_MS = 120_000;
/** DIFF-4.3: base copies older than this are deleted. */
export const COPY_TTL_MS = 24 * 60 * 60 * 1000;
const GIT_SHOW_TIMEOUT_MS = 20_000;
const CODE_TIMEOUT_MS = 15_000;
/** DIFF-4.5: where VS Code keeps its `code` command when it isn't on the PATH. */
export const VSCODE_APP_CODE = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
/** DIFF-5.1: what clap prints for a Fleet without the command. */
const NO_DIFF = /unrecognized subcommand ['"]?diff/;

const KINDS: readonly ChangeKind[] = ['added', 'modified', 'deleted', 'renamed', 'type_changed', 'mode_changed', 'submodule'];

/** One candidate Checkout as `fleet diff --json` reports it (contract C2); only what Lookout reads. */
export interface FleetCandidate {
  root: string;
  why: string[];
  repo: { common_dir: string; linked_worktree: boolean };
  branch: string | null;
  head: string | null;
  on_default_branch: boolean;
  base: { ref: string | null; sha: string };
  stats: { files: number; additions: number; deletions: number };
  files: unknown[];
  more_files: number;
}

/**
 * DIFF-2.1, 2.2: which candidates count. Claude Code: a Checkout it edited files in, and its working
 * directory's when it edited there or it's off its default branch. Codex: its working directory's,
 * always (its rollouts don't say what it edited).
 */
export function counts(harness: string, c: Pick<FleetCandidate, 'why' | 'on_default_branch'>): boolean {
  if (harness === 'codex') return c.why.includes('cwd');
  return c.why.includes('edited') || (c.why.includes('cwd') && c.on_default_branch === false);
}

/** A counted Checkout, with what opening a file needs. */
interface Counted extends ChangedCheckout {
  baseSha: string;
}

interface Entry {
  row: Pick<SessionRow, 'id' | 'pid' | 'harness'>;
  status: Status;
  due: number;
  fingerprint: string | null;
  checkouts: Counted[] | null;
  /** When an answer last came back (changed or not). */
  okAt: number | null;
  /** When the last ask ended: the next is due an interval after it. */
  askedAt: number | null;
  /** DIFF-2.6: the Status changed while its ask ran; the next ask is due at once. */
  again?: boolean;
}

export class ChangesError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ChangesOptions {
  runner: Runner;
  fleetBin(): string;
  /** A row's count changed: the monitor re-derives its rows. */
  onRowsChanged(): void;
  sendTo(clientId: string, event: ServerEvent): void;
  /** DIFF-4.3: `~/.lookout/diffs` unless a test says otherwise. */
  diffsDir?: string;
  env?: NodeJS.ProcessEnv;
  /** DIFF-4.5: VS Code's own `code`; tests point it elsewhere. */
  vscodeAppCode?: string;
  now?: () => number;
}

/**
 * DIFF-2: asks Fleet for each live Session's Changes on its own schedule, one ask at a time, keeps
 * the last answer per Session (the count on its row, the list for open tabs, and DIFF-4.4's
 * allowlist), and opens a file's Changes in VS Code (DIFF-4).
 */
export class Changes {
  private entries = new Map<string, Entry>();
  /** DIFF-3.6: each tab's open list, by its event stream. */
  private watchers = new Map<string, string>();
  private running: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private disabled = false;
  private readonly opts: ChangesOptions;
  private readonly now: () => number;
  private readonly diffsDir: string;

  constructor(opts: ChangesOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.diffsDir = opts.diffsDir ?? join(homedir(), '.lookout', 'diffs');
  }

  /** The Sessions Fleet lists now: new ones and changed Statuses are asked about first (DIFF-2.6). */
  observe(rows: readonly Pick<SessionRow, 'id' | 'pid' | 'harness' | 'status'>[]): void {
    const now = this.now();
    const seen = new Set<string>();
    for (const row of rows) {
      seen.add(row.id);
      const e = this.entries.get(row.id);
      if (!e) {
        this.entries.set(row.id, { row, status: row.status, due: now, fingerprint: null, checkouts: null, okAt: null, askedAt: null });
      } else {
        e.row = row;
        if (e.status !== row.status) {
          e.status = row.status;
          e.due = now;
          if (this.running === row.id) e.again = true;
        }
      }
    }
    // DIFF-2.8: a Session that left the list drops its answer and its schedule.
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.entries.delete(id);
    this.schedule();
  }

  /** DIFF-1: what the row shows; null with nothing changed, stale (DIFF-5.2) or Fleet without `diff`. */
  rowChanges(row: Pick<SessionRow, 'id'>): RowChanges | null {
    const checkouts = this.fresh(row.id);
    if (!checkouts) return null;
    const sum = { additions: 0, deletions: 0, files: 0 };
    for (const c of checkouts) {
      sum.additions += c.additions;
      sum.deletions += c.deletions;
      sum.files += c.files.length + c.moreFiles;
    }
    return sum.files > 0 ? sum : null;
  }

  /** DIFF-3: the list a tab shows; null when nothing counts. */
  view(sessionId: string): ChangesView | null {
    const checkouts = this.fresh(sessionId);
    if (!checkouts?.length) return null;
    return { sessionId, checkouts: checkouts.map(({ baseSha: _, ...c }) => c) };
  }

  /**
   * DIFF-3.6: a tab opened (a Session id) or closed (null) its list. The list as it is now goes to
   * the tab over its event stream, as every later one does: one channel, so an older list never
   * lands after a newer one.
   */
  watch(clientId: string, sessionId: string | null): void {
    const before = this.watchers.get(clientId);
    if (sessionId === null) {
      this.watchers.delete(clientId);
      if (before) this.slowDown(before);
      return;
    }
    this.watchers.set(clientId, sessionId);
    if (before && before !== sessionId) this.slowDown(before);
    const e = this.entries.get(sessionId);
    if (e) {
      e.due = Math.min(e.due, this.now());
      this.schedule();
    }
    this.opts.sendTo(clientId, { type: 'changes', sessionId, changes: this.view(sessionId) });
  }

  /** DIFF-3.6: the tab's event stream closed. */
  drop(clientId: string): void {
    const before = this.watchers.get(clientId);
    this.watchers.delete(clientId);
    if (before) this.slowDown(before);
  }

  /** A list closed: the Session's next ask moves back to its own interval. */
  private slowDown(sessionId: string): void {
    const e = this.entries.get(sessionId);
    if (!e || e.askedAt === null) return;
    e.due = Math.max(e.due, e.askedAt + this.interval(e));
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** The counted Checkouts of an answer at most STALE_MS old. */
  private fresh(sessionId: string): Counted[] | null {
    const e = this.entries.get(sessionId);
    if (this.disabled || !e?.checkouts || e.okAt === null || this.now() - e.okAt > STALE_MS) return null;
    return e.checkouts;
  }

  private interval(e: Entry): number {
    if ([...this.watchers.values()].includes(e.row.id)) return WATCHED_INTERVAL_MS;
    return e.status === 'busy' ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.disabled || this.running !== null || this.entries.size === 0) return;
    const next = Math.min(...[...this.entries.values()].map((e) => e.due));
    this.timer = setTimeout(() => void this.pump(), Math.max(0, next - this.now()));
    this.timer.unref?.();
  }

  /** One ask, the Session most overdue first; then the next is scheduled (DIFF-2.6). */
  async pump(): Promise<void> {
    this.timer = null;
    if (this.disabled || this.running !== null) return;
    const now = this.now();
    const due = [...this.entries.values()].filter((e) => e.due <= now).sort((a, b) => a.due - b.due)[0];
    if (!due) return this.schedule();
    this.running = due.row.id;
    try {
      await this.ask(due);
    } finally {
      this.running = null;
      const e = this.entries.get(due.row.id);
      if (e) {
        e.askedAt = this.now();
        e.due = e.again ? e.askedAt : e.askedAt + this.interval(e);
        e.again = false;
      }
      this.schedule();
    }
  }

  private async ask(e: Entry): Promise<void> {
    const target = /^[a-z]+:\d+$/.test(e.row.id) ? `pid:${e.row.pid}` : `id:${e.row.id}`;
    const args = ['--local', 'diff', target, '--json', ...(e.fingerprint && e.checkouts ? ['--since', e.fingerprint] : [])];
    let stdout: string;
    try {
      stdout = await this.opts.runner(this.opts.fleetBin(), args, { timeoutMs: DIFF_TIMEOUT_MS });
    } catch (err) {
      if (NO_DIFF.test((err as RunError).stderr ?? '')) {
        // DIFF-5.1: this Fleet has no `diff`; nothing shows, nothing is asked until a restart.
        this.disabled = true;
        this.stop();
        this.changed(null);
      }
      return; // DIFF-5.2: the last answer stays until it's stale.
    }
    const obj = fleetObject(stdout);
    if (!obj || obj.ok !== true || this.entries.get(e.row.id) !== e) return;
    e.okAt = this.now();
    if (obj.unchanged === true && e.checkouts) return;
    const before = JSON.stringify(e.checkouts);
    e.fingerprint = typeof obj.fingerprint === 'string' ? obj.fingerprint : null;
    e.checkouts = parseCandidates(obj.candidates, e.row.harness);
    if (JSON.stringify(e.checkouts) !== before) this.changed(e.row.id);
  }

  /** A Session's answer changed (null: every Session's): rows re-derive, open lists get the new one. */
  private changed(sessionId: string | null): void {
    this.opts.onRowsChanged();
    for (const [clientId, watched] of this.watchers) {
      if (sessionId === null || watched === sessionId) {
        this.opts.sendTo(clientId, { type: 'changes', sessionId: watched, changes: this.view(watched) });
      }
    }
  }

  /**
   * DIFF-4: opens one listed file's Changes in VS Code. Throws a ChangesError whose message the
   * file's row shows (DIFF-4.5, 4.6).
   */
  async open(sessionId: string, body: unknown): Promise<void> {
    const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    if (typeof b.root !== 'string' || typeof b.path !== 'string' || b.root.length > 4096 || b.path.length > 4096) {
      throw new ChangesError(400, 'Expected { root, path }.');
    }
    // DIFF-4.4: only a file the latest answer lists, and only while that answer is fresh.
    const checkouts = this.fresh(sessionId);
    if (!checkouts) throw new ChangesError(409, 'The list is out of date. Wait for it to refresh.');
    const checkout = checkouts.find((c) => c.root === b.root);
    const file = checkout?.files.find((f) => f.path === b.path);
    if (!checkout || !file) throw new ChangesError(404, "Lookout's latest list doesn't have that file.");
    if (file.kind === 'submodule') throw new ChangesError(400, 'A submodule has no diff to open.');
    if (file.kind === 'deleted' && file.binary) throw new ChangesError(400, 'A deleted binary file has nothing to open.');

    let realRoot: string;
    try {
      realRoot = await realpath(checkout.root);
    } catch {
      throw new ChangesError(410, 'Its Checkout is gone.');
    }
    let live: string | null = null;
    if (file.kind !== 'deleted') {
      try {
        live = await realpath(join(checkout.root, file.path));
      } catch {
        throw new ChangesError(410, 'The file is gone.');
      }
      if (!live.startsWith(realRoot + sep)) throw new ChangesError(403, 'The file is outside its Checkout.');
    }
    const code = this.codeBin();
    if (!code) throw new ChangesError(404, 'VS Code not found');

    let args: string[];
    if (file.binary) {
      args = [live!];
    } else {
      const base = file.kind === 'added' ? '' : await this.gitShow(checkout, file);
      const copy = await this.writeCopy(file.path, base);
      args = file.kind === 'deleted' ? [copy] : ['--diff', copy, live!];
    }
    // DIFF-4.4: checked again after the awaits, so a folder swapped for a symlink meanwhile can't
    // send VS Code outside the Checkout.
    const moved = (live !== null && !(await sameRealPath(live, live))) || !(await sameRealPath(checkout.root, realRoot));
    if (moved) {
      throw new ChangesError(403, 'The file is outside its Checkout.');
    }
    try {
      await this.opts.runner(code, args, { timeoutMs: CODE_TIMEOUT_MS });
    } catch (err) {
      const why = firstLine((err as RunError).stderr) ?? firstLine((err as Error).message) ?? 'it failed';
      throw new ChangesError(502, `VS Code didn't open it: ${why}`);
    }
  }

  /** DIFF-4.1: the file as it was at the Branch point (its old path for a rename). */
  /** As latin1, one char per byte, so a file that isn't UTF-8 is written back unchanged. */
  private async gitShow(checkout: Counted, file: ChangedFile): Promise<string> {
    const at = `${checkout.baseSha}:${file.oldPath ?? file.path}`;
    try {
      return await this.opts.runner('git', ['-C', checkout.root, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'show', at], {
        timeoutMs: GIT_SHOW_TIMEOUT_MS,
        encoding: 'latin1',
      });
    } catch {
      throw new ChangesError(500, "git couldn't read the file at the branch point.");
    }
  }

  /** DIFF-4.3: a new read-only file under its own name, in a new private folder. */
  private async writeCopy(path: string, content: string): Promise<string> {
    try {
      await mkdir(this.diffsDir, { recursive: true, mode: 0o700 });
      const dir = await mkdtemp(join(this.diffsDir, 'd-'));
      const copy = join(dir, basename(path));
      await writeFile(copy, content, { flag: 'wx', mode: 0o444, encoding: 'latin1' });
      return copy;
    } catch {
      throw new ChangesError(500, "Lookout couldn't write the file's base copy.");
    }
  }

  /** DIFF-4.5: `code` on the PATH, else VS Code's own; null without either. */
  codeBin(): string | null {
    const env = this.opts.env ?? process.env;
    for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
      if (executable(join(dir, 'code'))) return join(dir, 'code');
    }
    const app = this.opts.vscodeAppCode ?? VSCODE_APP_CODE;
    return executable(app) ? app : null;
  }

  /** DIFF-4.3: deletes base copies older than a day. */
  async prune(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.diffsDir);
    } catch {
      return;
    }
    const now = this.now();
    for (const name of names) {
      if (!name.startsWith('d-')) continue;
      const p = join(this.diffsDir, name);
      try {
        if (now - (await stat(p)).mtimeMs > COPY_TTL_MS) await rm(p, { recursive: true, force: true });
      } catch {
        // gone already
      }
    }
  }
}

async function sameRealPath(p: string, expected: string): Promise<boolean> {
  try {
    return (await realpath(p)) === expected;
  } catch {
    return false;
  }
}

function executable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The candidates that count (DIFF-2.1, 2.2), with Changes (DIFF-2.4), in Fleet's order: the cwd's first. */
export function parseCandidates(raw: unknown, harness: string): Counted[] {
  if (!Array.isArray(raw)) return [];
  const out: Counted[] = [];
  for (const v of raw) {
    if (!isCandidate(v) || !counts(harness, v) || v.stats.files === 0) continue;
    const files = v.files.flatMap((f) => (isFile(f) ? [toFile(f)] : []));
    out.push({
      root: v.root,
      repo: repoName(v.repo.common_dir, v.root),
      where: v.repo.linked_worktree ? basename(v.root) : (v.branch ?? (v.head ? v.head.slice(0, 7) : null)),
      additions: v.stats.additions,
      deletions: v.stats.deletions,
      files,
      moreFiles: Math.max(0, v.more_files),
      baseSha: v.base.sha,
    });
  }
  return out;
}

function isCandidate(v: unknown): v is FleetCandidate {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  const repo = c.repo as Record<string, unknown> | null;
  const stats = c.stats as Record<string, unknown> | null;
  const base = c.base as Record<string, unknown> | null;
  return (
    typeof c.root === 'string' &&
    Array.isArray(c.why) &&
    typeof repo === 'object' && repo !== null && typeof repo.common_dir === 'string' &&
    typeof base === 'object' && base !== null && typeof base.sha === 'string' &&
    typeof stats === 'object' && stats !== null &&
    [stats.files, stats.additions, stats.deletions].every((n) => Number.isSafeInteger(n) && (n as number) >= 0) &&
    Array.isArray(c.files) &&
    Number.isSafeInteger(c.more_files)
  );
}

function isFile(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Record<string, unknown>;
  return typeof f.path === 'string' && KINDS.includes(f.kind as ChangeKind);
}

function toFile(f: Record<string, unknown>): ChangedFile {
  const n = (x: unknown) => (Number.isSafeInteger(x) && (x as number) >= 0 ? (x as number) : 0);
  return {
    path: f.path as string,
    oldPath: typeof f.old_path === 'string' ? f.old_path : null,
    kind: f.kind as ChangeKind,
    additions: n(f.additions),
    deletions: n(f.deletions),
    binary: f.binary === true,
    uncommitted: f.uncommitted === true,
  };
}

function firstLine(s: string | undefined): string | undefined {
  const line = s?.trim().split('\n')[0]?.trim();
  return line ? line : undefined;
}
