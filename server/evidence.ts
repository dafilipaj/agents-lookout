import { lstat, stat as fsStat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { verdict, type EvidenceFile, type EvidenceView, type RowEvidence, type TestFiles, type VerdictKey } from '../shared/evidence.ts';
import { compareVersions, neededVersion } from '../shared/tools.ts';
import type { ChangedCheckout, ServerEvent, SessionRow } from '../shared/types.ts';
import type { RunError, Runner } from './exec.ts';
import { SESSION_ID } from './history.ts';
import { cleanEnv } from './launcher.ts';
import { type AgentRow, reviewRounds, reviewRuns, type ReviewerSession } from './reviews.ts';
import { sanitizeLine } from './sanitize.ts';
import { documentType } from './documents.ts';
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
/** EVID-6.2: rows per page of the headless Sessions' list. */
export const LIST_LIMIT = 200;
/** EVID-6.9: what TOOLS names for the tb-session that gives Subagent calls and a Session's model. */
export const REVIEW_FEATURE = "Review rounds by Subagents, and a reviewer's model";

type Row = Pick<SessionRow, 'id' | 'harness' | 'status' | 'done' | 'backgroundShell' | 'backgroundShells' | 'subagents' | 'changes'>;
const ENDED = ['exited', 'refused', 'errored', 'timed_out', 'interrupted', 'running'] as const;
const AGENT_ENDED = ['completed', 'failed', 'stopped', 'running'] as const;

/** EVID-6.1: what the last read that worked gave for the Session's Review rounds. */
interface ReviewInput {
  commands: CommandRow[];
  agents: AgentRow[];
  sessions: ReviewerSession[];
}

/** A paged tb-session answer: every row, or why there's none. */
type Pages = { kind: 'ok'; rows: unknown[] } | { kind: 'failed'; reason: string } | { kind: 'too-old' } | { kind: 'refused-agent' };

interface Entry {
  scope: boolean;
  doneAt: number | null;
  /** How many background shells ran, Subagents ran and finished, at the last look. */
  shells: number;
  running: number;
  finished: number;
  /** The last read that worked: its Test runs, what its Review rounds come from, and when it ended. */
  runs: TestRun[] | null;
  review: ReviewInput | null;
  /** EVID-6.2: whether TOOLS' version had Subagent calls when the last read was asked; null before one. */
  agents: boolean | null;
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
  /** EVID-6.2: the tb-session version TOOLS last read; the read asks for Subagent calls only from the one that has them. */
  toolVersion?: () => string | null;
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
        e = { scope: false, doneAt, shells, running, finished, runs: null, review: null, agents: null, readAt: null, error: null, view: null, busy: false, read: false, compute: false };
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

  /**
   * EVID-6.2: TOOLS read tb-session's version again. A Session whose last read asked for Subagent
   * calls by an older answer (none yet at start, say) is read again with the new one.
   */
  toolsChanged(): void {
    const agents = this.hasAgents();
    for (const [id, e] of this.entries) if (e.scope && e.agents !== null && e.agents !== agents) this.queue(id, 'read');
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

  /**
   * EVID-1.2, EVID-1.4: every page of the Session's commands, its Subagents' included, and its
   * Subagent calls from a tb-session that gives them (EVID-6.2); then, after a command that ran,
   * the headless Sessions that may have reviewed it.
   */
  private async read(id: string, e: Entry): Promise<void> {
    const bin = this.opts.bin();
    const info = await fsStat(bin).catch(() => null);
    const revision = `${bin}:${info?.mtimeMs ?? ''}:${info?.size ?? ''}`;
    // A read that starts while the first read after a change still runs shares its longer limit.
    const first = revision !== this.revision || this.firstReads > 0;
    this.revision = revision;
    if (first) this.firstReads++;
    const env = cleanEnv(this.opts.env ?? process.env);
    const timeoutMs = first ? FIRST_PAGE_TIMEOUT_MS : PAGE_TIMEOUT_MS;
    const events = (agents: boolean) => ['events', '--all-projects', '--session', id, '--kind', agents ? 'command,agent' : 'command', '--limit', String(PAGE_LIMIT), '--json'];
    const sessions: ReviewerSession[] = [];
    let commands: CommandRow[];
    let agents: AgentRow[];
    const asked = this.hasAgents();
    try {
      let read = await this.pages(bin, events(asked), timeoutMs, env);
      // EVID-6.9: a tb-session older than TOOLS last read it: commands alone.
      if (read.kind === 'refused-agent') read = await this.pages(bin, events(false), timeoutMs, env);
      if (read.kind === 'too-old' || read.kind === 'refused-agent') {
        // EVID-1.7: a tb-session without the command kind.
        this.tooOld = true;
        for (const [other, entry] of this.entries) if (entry.view) this.publish(other, entry, null);
        return;
      }
      if (read.kind === 'failed') return this.failed(id, e, read.reason);
      const seen = new Set<string>();
      commands = [];
      agents = [];
      for (const r of read.rows) {
        // Contract K7, A5: a command or a call comes back once.
        const command = commandRow(r, id);
        if (command && !seen.has(command.key)) {
          seen.add(command.key);
          commands.push(command);
        }
        const agent = agentRow(r, id);
        if (agent && !seen.has(`agent:${agent.key}`)) {
          seen.add(`agent:${agent.key}`);
          agents.push(agent);
        }
      }
      // EVID-6.2: a script of any name can start a reviewer, so any command that ran asks who did.
      const ran = commands.filter((c) => c.ended !== 'refused');
      if (ran.length) {
        const earliest = Math.min(...ran.map((c) => c.startedAt ?? c.timestamp));
        const day = new Date(earliest).toISOString().slice(0, 10);
        const listed = await this.pages(bin, ['list', '--all-projects', '--headless', 'only', '--after', day, '--limit', String(LIST_LIMIT), '--json'], timeoutMs, env);
        if (listed.kind !== 'ok') return this.failed(id, e, listed.kind === 'failed' ? listed.reason : 'tb-session refused to list headless Sessions');
        const known = new Set<string>();
        for (const r of listed.rows) {
          const s = reviewerSession(r);
          if (s && s.sessionId !== id && !known.has(s.sessionId)) {
            known.add(s.sessionId);
            sessions.push(s);
          }
        }
      }
    } finally {
      if (first) this.firstReads--;
    }
    if (this.entries.get(id) !== e) return;
    const runs = new Map<string, TestRun>();
    for (const row of commands) {
      const run = testRun(row);
      if (run) runs.set(row.key, run);
    }
    if (this.tooOld) {
      // EVID-1.7: tb-session answers now; the Sessions it refused are read again.
      this.tooOld = false;
      for (const [other, entry] of this.entries) if (other !== id && entry.scope) this.queue(other, 'read');
    }
    e.runs = [...runs.values()].sort((a, b) => b.end - a.end || a.key.localeCompare(b.key));
    e.review = { commands, agents, sessions };
    e.agents = asked;
    e.readAt = this.now();
    e.error = null;
  }

  /** EVID-6.2: whether the tb-session TOOLS last read gives Subagent calls (contract A1). */
  private hasAgents(): boolean {
    return (compareVersions(this.opts.toolVersion?.() ?? null, neededVersion('tb-session', REVIEW_FEATURE)) ?? -1) >= 0;
  }

  /** EVID-1.2, EVID-6.2: a tb-session answer, page after page until it has `total_results` rows. */
  private async pages(bin: string, args: readonly string[], timeoutMs: number, env: NodeJS.ProcessEnv): Promise<Pages> {
    const rows: unknown[] = [];
    for (let page = 1; ; page++) {
      let raw: string;
      try {
        raw = await this.opts.runner(bin, page === 1 ? [...args] : [...args, '--page', String(page)], { timeoutMs, env });
      } catch (err) {
        const r = err as RunError;
        if (refusesKind(r, 'agent')) return { kind: 'refused-agent' };
        if (refusedAsTooOld(r) || refusesKind(r, 'command')) return { kind: 'too-old' };
        return { kind: 'failed', reason: r.code === 'ENOENT' ? "tb-session isn't installed" : r.timedOut ? 'tb-session took too long to answer' : `tb-session failed: ${sanitizeLine(r.stderr, 200) ?? 'no details'}` };
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return { kind: 'failed', reason: 'tb-session returned an unexpected answer' };
      }
      const total = parsed?.total_results;
      if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.results) || !Number.isSafeInteger(total) || (total as number) < 0) {
        return { kind: 'failed', reason: 'tb-session returned an unexpected answer' };
      }
      rows.push(...parsed.results);
      if (rows.length >= (total as number)) return { kind: 'ok', rows };
      if (!parsed.results.length) return { kind: 'failed', reason: 'tb-session returned an incomplete read' };
    }
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
    // EVID-1.1, EVID-7.3: only documents changed is nothing to back; a Checkout listed in part may hold anything.
    if (!checkouts || !checkouts.some((c) => c.moreFiles > 0 || c.files.some((f) => !isDocument(f)))) return this.publish(id, e, null);
    const files = await this.times(checkouts);
    if (this.entries.get(id) !== e || !e.scope || !e.runs) return;
    const view = evidenceView(id, e.runs, files, checkouts, e.readAt, e.error, e.review, this.now());
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
/** EVID-1.7, EVID-6.9: clap's usage error for a `--kind` value it doesn't know, as tb-session 0.4 answers `command` and 0.5 `agent`. */
function refusesKind(err: RunError, value: 'command' | 'agent'): boolean {
  return err.code === 2 && typeof err.stderr === 'string' && new RegExp(`\\berror: invalid value '${value}' for '--kind\\b`, 'i').test(err.stderr.replace(ANSI, ''));
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
    cwd: absolute(r.cwd),
    startedAt: time(r.started_at),
  };
}

const time = (v: unknown): number | null => {
  const at = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(at) ? at : null;
};
const absolute = (v: unknown): string | null => (typeof v === 'string' && isAbsolute(v) && !/[\0\n\r]/.test(v) && v.length <= 4096 ? (v.length > 1 ? v.replace(/\/+$/, '') : v) : null);
const word = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.slice(0, max) : null);

/** Contract A2: a Subagent call as Lookout reads it; null for one it can't. */
export function agentRow(value: unknown, sessionId: string): AgentRow | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  if (r.kind !== 'agent' || (r.session_id !== undefined && r.session_id !== sessionId)) return null;
  const key = typeof r.tool_use_id === 'string' && r.tool_use_id ? r.tool_use_id : typeof r.key === 'string' && r.key ? r.key : null;
  const startedAt = time(r.started_at);
  const timestamp = time(r.timestamp);
  if (!key || startedAt === null || timestamp === null || !AGENT_ENDED.includes(r.ended as AgentRow['ended'])) return null;
  return {
    key,
    description: word(r.description, 20_000),
    subagentType: word(r.subagent_type, 200),
    model: word(r.model, 120),
    effort: word(r.effort, 40),
    startedAt,
    timestamp,
    ended: r.ended as AgentRow['ended'],
  };
}

/** EVID-6.2: a headless Codex or Claude Code Session from `list`; null for any other row. */
export function reviewerSession(value: unknown): ReviewerSession | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.session_id !== 'string' || !SESSION_ID.test(r.session_id)) return null;
  if (r.harness !== 'codex' && r.harness !== 'claude') return null;
  if (r.headless === false) return null;
  const createdAt = time(r.created_at);
  if (createdAt === null) return null;
  return {
    sessionId: r.session_id,
    harness: r.harness,
    projectPath: absolute(r.project_path),
    createdAt,
    firstPrompt: typeof r.first_prompt === 'string' ? r.first_prompt : null,
    transcriptMissing: r.transcript_missing === true,
    model: word(r.model, 120),
    effort: word(r.effort, 40),
  };
}

/** EVID-7.1: a changed file is a document by its (new) path's extension, unless it's a test file (EVID-4.1). */
export function isDocument(file: Pick<ChangedCheckout['files'][number], 'path' | 'oldPath'>): boolean {
  return documentType(file.path) !== null && !isTestFile(file.path) && !(file.oldPath !== null && isTestFile(file.oldPath));
}

/** EVID-3, EVID-4, EVID-5.2 to 5.4, 5.10, 5.11, EVID-6, EVID-7: a Session's Evidence from its Test runs, its Review rounds and its changed files' times. */
export function evidenceView(sessionId: string, runs: readonly TestRun[], files: readonly TimedFile[], checkouts: readonly ChangedCheckout[], readAt: number, error: string | null, review: ReviewInput | null = null, now = readAt): EvidenceView {
  // EVID-7.2: documents don't move the last change or count as changed since.
  const counted = files.filter((f) => !isDocument(f.file));
  const times = counted.flatMap((f) => (f.mtime === null ? [] : [f.mtime]));
  const lastChange = times.length ? Math.max(...times) : null;
  const lastPass = runs.find((r) => r.outcome === 'passed') ?? null;
  // EVID-5.3: changed since the last pass; without one, every file that has a time.
  const latest = (list: readonly TimedFile[]) =>
    list
      .filter((f): f is TimedFile & { mtime: number } => f.mtime !== null && (!lastPass || f.mtime > lastPass.end))
      .sort((a, b) => b.mtime - a.mtime || a.file.path.localeCompare(b.file.path));
  const since = latest(counted);
  // EVID-7.4: the documents changed since the last pass, after the files that count.
  const documentsSince = lastPass ? latest(files.filter((f) => isDocument(f.file))) : [];
  const changedFiles = checkouts.reduce((n, c) => n + c.files.length + c.moreFiles, 0);
  // EVID-6.3, EVID-6.8: the rounds never change the verdict.
  const rounds = review ? reviewRounds(reviewRuns(review.commands, review.agents, review.sessions, now), now) : [];
  const reviewed = rounds.flatMap((r) => (r.outcome === 'finished' && r.end !== null ? [r.end] : []));
  const lastReview = reviewed.length ? Math.max(...reviewed) : null;
  return {
    sessionId,
    verdict: decide(runs, lastChange),
    readAt,
    error,
    lastChange,
    lastPass: lastPass ? { end: lastPass.end, passed: lastPass.passed } : null,
    runCount: runs.length,
    changedSince: since.length,
    documentsSince: documentsSince.length,
    changedSinceFiles: lastPass
      ? [...since.map((f) => ({ f, document: false })), ...documentsSince.map((f) => ({ f, document: true }))]
          .slice(0, CHANGED_SINCE_SHOWN)
          .map(({ f, document }): EvidenceFile => ({ root: f.root, checkout: f.checkout, path: f.file.path, mtime: f.mtime, additions: f.file.additions, deletions: f.file.deletions, binary: f.file.binary, document }))
      : [],
    testFiles: testFiles(files),
    changedFiles,
    listedFiles: files.length,
    runs: runs.map((r) => ({ key: r.key, end: r.end, outcome: r.outcome, passed: r.passed, failed: r.failed, command: r.command, subagent: r.subagent })),
    rounds,
    // EVID-6.4: changed files with a modification time later than the latest finished round's end.
    changedSinceReview: lastReview === null ? 0 : counted.filter((f) => f.mtime !== null && f.mtime > lastReview).length,
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
