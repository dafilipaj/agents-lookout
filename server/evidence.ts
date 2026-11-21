import { lstat, stat as fsStat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { verdict, type EvidenceFile, type EvidenceView, type RowEvidence, type TestFiles, type VerdictKey } from '../shared/evidence.ts';
import type { ChangedCheckout, ServerEvent, SessionRow } from '../shared/types.ts';
import type { RunError, Runner } from './exec.ts';
import { SESSION_ID } from './history.ts';
import { cleanEnv } from './launcher.ts';
import { sanitizeLine } from './sanitize.ts';
import { type CommandRow, isTestFile, testRun, type TestRun } from './test-runs.ts';
import { refusedAsTooOld } from './too-old.ts';

/** EVID-1.2: rows per page. */
export const PAGE_LIMIT = 1000;
/** EVID-1.4: a page's time limit, and the first read's after the tb-session binary changed. */
export const PAGE_TIMEOUT_MS = 20_000;
export const FIRST_PAGE_TIMEOUT_MS = 60_000;
/** EVID-3.1: how long a changed file's `stat` may take before it has no time. */
const STAT_TIMEOUT_MS = 2000;
/** EVID-5.10: the changed files the popover lists before "N more". */
export const CHANGED_SINCE_SHOWN = 10;

type Row = Pick<SessionRow, 'id' | 'harness' | 'status' | 'done' | 'backgroundShell' | 'backgroundShells' | 'subagents' | 'changes'>;
const ENDED = ['exited', 'refused', 'errored', 'timed_out', 'interrupted', 'running'] as const;

interface Entry {
  scope: boolean;
  doneAt: number | null;
  /** How many background shells ran, Subagents ran and finished, at the last look. */
  shells: number;
  running: number;
  finished: number;
  /** The last read that worked: its Test runs and when it ended. */
  runs: TestRun[] | null;
  readAt: number | null;
  /** EVID-1.8: why the latest read failed; null when it worked. */
  error: string | null;
  view: EvidenceView | null;
  /** The work queued for this Session (EVID-1.3: one read at a time, one more after it). */
  busy: boolean;
  read: boolean;
  compute: boolean;
}

export interface EvidenceOptions {
  runner: Runner;
  bin(): string;
  env?: NodeJS.ProcessEnv;
  /** DIFF's latest fresh answer for the Session: its counted Checkouts; null without one. */
  checkouts(sessionId: string): readonly ChangedCheckout[] | null;
  /** Every tab: a Session's Evidence changed. */
  broadcast(event: ServerEvent): void;
  /** A row's verdict changed: the monitor re-derives its rows (EVID-5.6's mark). */
  onRowsChanged(): void;
  /** EVID-3.1: a changed file's modification time; tests replace it. */
  mtime?: (path: string) => Promise<number | null>;
  now?: () => number;
  log?: (line: string) => void;
}

/**
 * EVID-1: reads a live Claude Code Session's commands through tb-session when it stops with Changes
 * (Idle, or Done), keeps the last read in memory, and works out its Evidence (EVID-2 to EVID-4)
 * again whenever its Changes change.
 */
export class Evidence {
  private readonly opts: EvidenceOptions;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();
  /** EVID-1.7: tb-session refused `--kind command`: no Session has Evidence until a read works. */
  private tooOld = false;
  /** EVID-1.4: the binary a read last ran, and the reads sharing the first read's longer limit. */
  private revision: string | null = null;
  private firstReads = 0;

  constructor(opts: EvidenceOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  /** EVID-1.1: a live Claude Code Session with a session id, Idle or Done (not Busy, not Needs you), with Changes. */
  static inScope(row: Row): boolean {
    if (row.harness !== 'claude' || !SESSION_ID.test(row.id) || /^[a-z]+:\d+$/.test(row.id)) return false;
    if (!row.changes || row.changes.files <= 0) return false;
    return row.status === 'idle' || (!!row.done && row.status !== 'busy' && row.status !== 'needs-you');
  }

  /** EVID-1.3: the rows as they are now; who entered scope, was marked Done again, or had a shell or a Subagent end is read. */
  observe(rows: readonly Row[]): void {
    const seen = new Set<string>();
    for (const row of rows) {
      seen.add(row.id);
      const scope = Evidence.inScope(row);
      const doneAt = row.done?.at ?? null;
      const finished = row.subagents?.finished ?? 0;
      const running = row.subagents?.running ?? 0;
      const shells = row.backgroundShells ?? (row.backgroundShell ? 1 : 0);
      let e = this.entries.get(row.id);
      if (!e) {
        e = { scope: false, doneAt, shells, running, finished, runs: null, readAt: null, error: null, view: null, busy: false, read: false, compute: false };
        this.entries.set(row.id, e);
      }
      const entered = scope && !e.scope;
      const redone = scope && doneAt !== null && doneAt !== e.doneAt;
      // One of several background shells ending counts too; so does a Subagent of an earlier Turn (its running count drops).
      const shellEnded = scope && shells < e.shells;
      const subagentEnded = scope && (finished > e.finished || running < e.running);
      const left = !scope && e.scope;
      e.scope = scope;
      e.doneAt = doneAt;
      e.shells = shells;
      e.running = running;
      e.finished = finished;
      if (entered || redone || shellEnded || subagentEnded) this.queue(row.id, 'read');
      if (left) this.publish(row.id, e, null);
    }
    // EVID-1.6: a Session that left the list drops its read.
    for (const [id, e] of this.entries) {
      if (seen.has(id)) continue;
      this.entries.delete(id);
      if (e.view) this.publish(id, e, null);
    }
  }

  /** EVID-1.5: DIFF's answer for a Session changed (null: every Session's); the verdict is worked out again, without a read. */
  changesChanged(sessionId: string | null): void {
    for (const [id, e] of this.entries) if ((sessionId === null || id === sessionId) && e.scope && e.runs) this.queue(id, 'compute');
  }

  /** EVID-5.6: what the row carries for its mark; null without Evidence. */
  rowEvidence(sessionId: string): RowEvidence | null {
    return this.entries.get(sessionId)?.view?.verdict ?? null;
  }

  /** Every Session's Evidence, for a new tab's snapshot. */
  views(): EvidenceView[] {
    return [...this.entries.values()].flatMap((e) => (e.view ? [e.view] : []));
  }

  private queue(id: string, what: 'read' | 'compute'): void {
    const e = this.entries.get(id);
    if (!e) return;
    e[what] = true;
    if (!e.busy) void this.work(id, e);
  }

  /** One piece of work per Session at a time; what was asked meanwhile runs once after it (EVID-1.3). */
  private async work(id: string, e: Entry): Promise<void> {
    e.busy = true;
    try {
      while (this.entries.get(id) === e && (e.read || e.compute)) {
        const read = e.read;
        e.read = false;
        e.compute = false;
        if (!e.scope) continue;
        if (read) await this.read(id, e);
        if (this.entries.get(id) !== e || !e.scope) continue;
        await this.compute(id, e);
      }
    } catch (err) {
      this.log(`lookout: evidence: ${(err as Error).message}`);
    } finally {
      e.busy = false;
    }
  }

  /** EVID-1.2, EVID-1.4: every page of the Session's commands, its Subagents' included. */
  private async read(id: string, e: Entry): Promise<void> {
    const bin = this.opts.bin();
    const info = await fsStat(bin).catch(() => null);
    const revision = `${bin}:${info?.mtimeMs ?? ''}:${info?.size ?? ''}`;
    // A read that starts while the first read after a change still runs shares its longer limit.
    const first = revision !== this.revision || this.firstReads > 0;
    this.revision = revision;
    if (first) this.firstReads++;
    const env = cleanEnv(this.opts.env ?? process.env);
    const args = ['events', '--all-projects', '--session', id, '--kind', 'command', '--limit', String(PAGE_LIMIT), '--json'];
    const rows: unknown[] = [];
    try {
      for (let page = 1; ; page++) {
        let raw: string;
        try {
          raw = await this.opts.runner(bin, page === 1 ? args : [...args, '--page', String(page)], { timeoutMs: first ? FIRST_PAGE_TIMEOUT_MS : PAGE_TIMEOUT_MS, env });
        } catch (err) {
          const r = err as RunError;
          // EVID-1.7: a tb-session without the command kind.
          if (refusedAsTooOld(r) || refusesKind(r)) {
            this.tooOld = true;
            for (const [other, entry] of this.entries) if (entry.view) this.publish(other, entry, null);
            return;
          }
          return this.failed(id, e, r.code === 'ENOENT' ? "tb-session isn't installed" : r.timedOut ? 'tb-session took too long to answer' : `tb-session failed: ${sanitizeLine(r.stderr, 200) ?? 'no details'}`);
        }
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return this.failed(id, e, 'tb-session returned an unexpected answer');
        }
        const total = parsed?.total_results;
        if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.results) || !Number.isSafeInteger(total) || (total as number) < 0) {
          return this.failed(id, e, 'tb-session returned an unexpected answer');
        }
        rows.push(...parsed.results);
        if (rows.length >= (total as number)) break;
        if (!parsed.results.length) return this.failed(id, e, 'tb-session returned an incomplete read');
      }
    } finally {
      if (first) this.firstReads--;
    }
    if (this.entries.get(id) !== e) return;
    const runs = new Map<string, TestRun>();
    for (const r of rows) {
      const row = commandRow(r, id);
      if (!row || runs.has(row.key)) continue; // contract K7: a command comes back once
      const run = testRun(row);
      if (run) runs.set(row.key, run);
    }
    if (this.tooOld) {
      // EVID-1.7: tb-session answers now; the Sessions it refused are read again.
      this.tooOld = false;
      for (const [other, entry] of this.entries) if (other !== id && entry.scope) this.queue(other, 'read');
    }
    e.runs = [...runs.values()].sort((a, b) => b.end - a.end || a.key.localeCompare(b.key));
    e.readAt = this.now();
    e.error = null;
  }

  /** EVID-1.8: the last Evidence stays, its verdict old with the reason; a Session that never had a read has none. */
  private failed(id: string, e: Entry, reason: string): void {
    e.error = reason;
    this.log(`lookout: evidence: a read failed: ${reason}`);
    if (e.view) this.publish(id, e, { ...e.view, error: reason });
  }

  /** EVID-3, EVID-4: the verdict, the tiles and the lists, from the last read and DIFF's answer now. */
  private async compute(id: string, e: Entry): Promise<void> {
    if (!e.runs || e.readAt === null || this.tooOld) return;
    const checkouts = this.opts.checkouts(id);
    if (!checkouts || !checkouts.some((c) => c.files.length || c.moreFiles)) return this.publish(id, e, null);
    const files = await this.times(checkouts);
    if (this.entries.get(id) !== e || !e.scope || !e.runs) return;
    const view = evidenceView(id, e.runs, files, checkouts, e.readAt, e.error);
    this.publish(id, e, view);
  }

  /** EVID-3.1: each listed changed file's modification time; a deleted file, a submodule or a failed `stat` has none. */
  private async times(checkouts: readonly ChangedCheckout[]): Promise<TimedFile[]> {
    const all = checkouts.flatMap((c) => c.files.map((f) => ({ root: c.root, checkout: c.id, file: f })));
    const out: TimedFile[] = new Array(all.length);
    let n = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, all.length) }, async () => {
        while (n < all.length) {
          const i = n++;
          const { root, checkout, file } = all[i]!;
          const plain = !isAbsolute(file.path) && !file.path.split('/').includes('..');
          const mtime = file.kind === 'deleted' || file.kind === 'submodule' || !plain ? null : await this.mtime(join(root, file.path));
          out[i] = { root, checkout, file, mtime };
        }
      }),
    );
    return out;
  }

  private mtime(path: string): Promise<number | null> {
    if (this.opts.mtime) return this.opts.mtime(path).catch(() => null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), STAT_TIMEOUT_MS);
      lstat(path).then(
        (s) => { clearTimeout(timer); resolve(s.mtimeMs); },
        () => { clearTimeout(timer); resolve(null); },
      );
    });
  }

  /** Tells the tabs, and the rows when the verdict changed; nothing when nothing changed. */
  private publish(id: string, e: Entry, view: EvidenceView | null): void {
    const before = e.view;
    if (JSON.stringify(before) === JSON.stringify(view)) return;
    e.view = view;
    this.opts.broadcast({ type: 'evidence', sessionId: id, evidence: view });
    // After the caller is done: a publish can come from inside the monitor's own derive (`observe`).
    if (JSON.stringify(before?.verdict ?? null) !== JSON.stringify(view?.verdict ?? null)) queueMicrotask(() => this.opts.onRowsChanged());
  }

  private log(line: string): void {
    try {
      (this.opts.log ?? ((l: string) => console.warn(l)))(line);
    } catch {
      // A logger cannot change Evidence.
    }
  }
}

// eslint-disable-next-line no-control-regex -- ANSI colour codes are what's being stripped
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
/** EVID-1.7: clap's usage error for a `--kind` value it doesn't know, as tb-session 0.4 answers `command`. */
function refusesKind(err: RunError): boolean {
  return err.code === 2 && typeof err.stderr === 'string' && /\berror: invalid value 'command' for '--kind\b/i.test(err.stderr.replace(ANSI, ''));
}

interface TimedFile {
  root: string;
  checkout: string;
  file: ChangedCheckout['files'][number];
  mtime: number | null;
}

/** Contract K2: a command row as Lookout reads it; null for one it can't. */
export function commandRow(value: unknown, sessionId: string): CommandRow | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  if (r.kind !== 'command' || (r.session_id !== undefined && r.session_id !== sessionId)) return null;
  const key = typeof r.tool_use_id === 'string' && r.tool_use_id ? r.tool_use_id : typeof r.key === 'string' && r.key ? r.key : null;
  const at = typeof r.timestamp === 'string' ? Date.parse(r.timestamp) : NaN;
  if (!key || typeof r.command !== 'string' || !Number.isFinite(at) || !ENDED.includes(r.ended as CommandRow['ended'])) return null;
  return {
    key,
    command: r.command,
    timestamp: at,
    ended: r.ended as CommandRow['ended'],
    exitCode: Number.isSafeInteger(r.exit_code) ? (r.exit_code as number) : null,
    outputTail: typeof r.output_tail === 'string' ? r.output_tail : null,
    // Contract E2: the Subagent Transcript's filename, or null for the parent.
    subagent: typeof r.subagent === 'string' && r.subagent.length > 0,
  };
}

/** EVID-3, EVID-4, EVID-5.2 to 5.4, 5.10, 5.11: a Session's Evidence from its Test runs and its changed files' times. */
export function evidenceView(sessionId: string, runs: readonly TestRun[], files: readonly TimedFile[], checkouts: readonly ChangedCheckout[], readAt: number, error: string | null): EvidenceView {
  const times = files.flatMap((f) => (f.mtime === null ? [] : [f.mtime]));
  const lastChange = times.length ? Math.max(...times) : null;
  const lastPass = runs.find((r) => r.outcome === 'passed') ?? null;
  // EVID-5.3: changed since the last pass; without one, every file that has a time.
  const since = files
    .filter((f): f is TimedFile & { mtime: number } => f.mtime !== null && (!lastPass || f.mtime > lastPass.end))
    .sort((a, b) => b.mtime - a.mtime || a.file.path.localeCompare(b.file.path));
  const changedFiles = checkouts.reduce((n, c) => n + c.files.length + c.moreFiles, 0);
  return {
    sessionId,
    verdict: decide(runs, lastChange),
    readAt,
    error,
    lastChange,
    lastPass: lastPass ? { end: lastPass.end, passed: lastPass.passed } : null,
    runCount: runs.length,
    changedSince: since.length,
    changedSinceFiles: lastPass
      ? since.slice(0, CHANGED_SINCE_SHOWN).map((f): EvidenceFile => ({ root: f.root, checkout: f.checkout, path: f.file.path, mtime: f.mtime, additions: f.file.additions, deletions: f.file.deletions, binary: f.file.binary }))
      : [],
    testFiles: testFiles(files),
    changedFiles,
    listedFiles: files.length,
    runs: runs.map((r) => ({ key: r.key, end: r.end, outcome: r.outcome, passed: r.passed, failed: r.failed, command: r.command, subagent: r.subagent })),
  };
}

/** EVID-3.2 to EVID-3.4: the first row of the table that holds. */
export function decide(runs: readonly TestRun[], lastChange: number | null): RowEvidence {
  if (!runs.length) return verdict('no-run');
  if (runs.some((r) => r.outcome === 'running')) return verdict('running');
  // EVID-3.2: at or after the last change; with no last change, every run did.
  const after = runs.filter((r) => lastChange === null || r.end >= lastChange);
  if (!after.length) return verdict('changed');
  const readable = after.find((r) => r.outcome !== 'unread');
  const deciding = readable ?? after[0]!;
  const key: Record<string, VerdictKey> = { passed: 'passed', failed: 'failed', 'timed-out': 'timed-out', stopped: 'stopped', 'no-tests': 'no-tests', unread: 'unread' };
  const k = key[deciding.outcome] ?? 'unread';
  // EVID-3.4: a later unread run makes a bad verdict "its last readable test run".
  const laterUnread = readable && k !== 'passed' && after.some((r) => r.outcome === 'unread' && r.end > deciding.end);
  return verdict(k, !!laterUnread);
}

/** EVID-4.1, EVID-4.2: the test files among the listed changed files. */
function testFiles(files: readonly TimedFile[]): TestFiles {
  const tests = files.filter((f) => isTestFile(f.file.path) || (f.file.oldPath !== null && isTestFile(f.file.oldPath)));
  return {
    count: tests.length,
    added: tests.filter((f) => f.file.kind === 'added').length,
    deleted: tests.filter((f) => f.file.kind === 'deleted').length,
    additions: tests.reduce((n, f) => n + f.file.additions, 0),
    deletions: tests.reduce((n, f) => n + f.file.deletions, 0),
  };
}
