import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { MAX_KEPT_PIECE } from '../shared/handoff.ts';
import type { Harness, HandoffLink, LaunchContinues, SessionRow } from '../shared/types.ts';
import type { History } from './history.ts';
import type { SessionMonitor } from './monitor.ts';

/** HAND-4.3: where the hand-offs are kept, next to the Topics. */
export const defaultHandoffsPath = (env: NodeJS.ProcessEnv = process.env) => join(env.HOME || homedir(), '.lookout', 'handoffs.json');

/** A start Fleet never reports (failed, closed) is forgotten after this long, as a Topic's is. */
export const HANDOFF_LAUNCH_TTL_MS = 60 * 60_000;
/** HAND-4.3: a first prompt tb-session couldn't read yet (not indexed, say) is read again after this long, at most this many times. */
export const REBUILD_RETRY_MS = 2 * 60_000;
export const REBUILD_TRIES = 3;
/** The record keeps the newest this many; a hand-off older than them is no longer linked. */
export const MAX_HANDOFFS = 5000;
const MAX_TITLE = 300;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const HARNESSES: readonly string[] = ['claude', 'codex'] satisfies Harness[];

/** One hand-off: the old Session (`from`) and the one started from its Handover (`to`). */
export interface HandoffEntry {
  from: string;
  fromHarness: Harness;
  fromTitle: string | null;
  to: string;
  toHarness: Harness;
  toTitle: string | null;
  /** When Fleet reported the new Session with its id (ms). */
  at: number;
}

/** HAND-3.2: the line naming the Session a start continues; the first prompt's last such line is the one Lookout wrote. */
export function continuedFromLine(prompt: string): { sessionId: string; title: string | null } | null {
  let found: { sessionId: string; title: string | null } | null = null;
  for (const line of prompt.split(/\r?\n/)) {
    const m = /^Continued from: (\S+)(?: (.*))?$/.exec(line.trim());
    if (!m || !SESSION_ID.test(m[1]!)) continue;
    found = { sessionId: m[1]!, title: title(m[2]) };
  }
  return found;
}

function title(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').trim();
  return t ? t.slice(0, MAX_TITLE) : null;
}

const harness = (v: unknown): Harness | null => (typeof v === 'string' && HARNESSES.includes(v) ? (v as Harness) : null);

/** A row has a session id once it isn't `<harness>:<pid>` (a Codex Session before its first prompt). */
const hasSessionId = (row: Pick<SessionRow, 'id' | 'harness' | 'pid'>) => row.id !== `${row.harness}:${row.pid}`;

function parseEntry(v: unknown): HandoffEntry | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const fromHarness = harness(r.fromHarness);
  const toHarness = harness(r.toHarness);
  if (typeof r.from !== 'string' || !SESSION_ID.test(r.from) || typeof r.to !== 'string' || !SESSION_ID.test(r.to) || r.from === r.to) return null;
  if (!fromHarness || !toHarness || typeof r.at !== 'number' || !Number.isFinite(r.at)) return null;
  return { from: r.from, fromHarness, fromTitle: title(r.fromTitle), to: r.to, toHarness, toTitle: title(r.toTitle), at: r.at };
}

export interface HandoffsOptions {
  path: string;
  /** HAND-4.3: a Session's whole first prompt, from History; null when it has none. Throws when it can't be read yet. */
  firstPrompt?(sessionId: string, harness: Harness): Promise<string | null>;
  /** HAND-4.3: the Harness History knows an ended Session under, trying `likely` first; null when neither. */
  sessionHarness?(sessionId: string, likely: Harness): Promise<Harness | null>;
  /** The record changed: the rows carry new links. */
  onChange?(): void;
  now?: () => number;
  warn?: (message: string) => void;
}

/**
 * HAND-3.3, HAND-4: the hand-offs, in `~/.lookout/handoffs.json` (`[{from, to, at}]`, each with its
 * Harness and title as last seen), written atomically. A file that can't be read is set aside in
 * memory: Lookout starts without links, and the next hand-off writes a new one.
 */
export class Handoffs {
  private entries: HandoffEntry[] = [];
  private readonly opts: HandoffsOptions;
  private readonly now: () => number;
  /** HAND-4.3: Sessions whose first prompt was read, or is being, by `harness:id`; with the tries so far and when to try again. */
  private readonly checked = new Map<string, { tries: number; retryAt: number }>();
  private readonly queue: { sessionId: string; harness: Harness }[] = [];
  private draining = false;
  /** The live rows with a session id, as the last list gave them. */
  private live: ReadonlyMap<string, SessionRow> = new Map();

  constructor(opts: HandoffsOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  load(): void {
    let text: string;
    try {
      text = readFileSync(this.opts.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.warn(`reading ${this.opts.path} failed: ${message(err)}`);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.warn(`${this.opts.path} isn't JSON; starting without hand-offs`);
      return;
    }
    this.entries = (Array.isArray(parsed) ? parsed : []).flatMap((e) => parseEntry(e) ?? []);
  }

  list(): readonly HandoffEntry[] {
    return this.entries;
  }

  /** HAND-3.3: one hand-off, once; the same pair again only refreshes its titles. */
  record(entry: HandoffEntry): void {
    if (entry.from === entry.to) return;
    const same = this.entries.find((e) => e.from === entry.from && e.to === entry.to);
    if (same) {
      if (!this.retitle(same, entry.fromTitle, entry.toTitle)) return;
    } else {
      this.entries.push(entry);
      if (this.entries.length > MAX_HANDOFFS) this.entries.sort((a, b) => a.at - b.at).splice(0, this.entries.length - MAX_HANDOFFS);
    }
    this.save();
  }

  /** HAND-4.1, HAND-4.2: a Session's links: the Session it continues, and those that continue it, newest first. */
  links(sessionId: string): { continuedFrom: HandoffLink | null; continuedIn: HandoffLink[] } {
    let from: HandoffEntry | null = null;
    const into: HandoffEntry[] = [];
    for (const e of this.entries) {
      if (e.to === sessionId && (!from || e.at > from.at)) from = e;
      if (e.from === sessionId) into.push(e);
    }
    into.sort((a, b) => b.at - a.at);
    return {
      continuedFrom: from ? { sessionId: from.from, harness: from.fromHarness, title: from.fromTitle, at: from.at } : null,
      continuedIn: into.map((e) => ({ sessionId: e.to, harness: e.toHarness, title: e.toTitle, at: e.at })),
    };
  }

  /**
   * After every list: titles of linked Sessions seen live are kept (so a link to one that ended
   * still has its name), and HAND-4.3: a Session not in the record has its first prompt read once
   * for a `Continued from:` line. Call it after HandoffLaunches' `observe`.
   */
  observe(rows: readonly SessionRow[]): void {
    let changed = false;
    const live = new Map(rows.filter(hasSessionId).map((r) => [r.id, r]));
    this.live = live;
    for (const e of this.entries) {
      const from = live.get(e.from);
      const to = live.get(e.to);
      if (this.retitle(e, from ? title(from.title) : null, to ? title(to.title) : null)) changed = true;
    }
    if (changed) this.save();
    if (!this.opts.firstPrompt) return;
    const now = this.now();
    for (const row of live.values()) {
      if (this.entries.some((e) => e.to === row.id)) continue;
      const key = `${row.harness}:${row.id}`;
      const seen = this.checked.get(key);
      if (seen && (seen.retryAt === Infinity || seen.retryAt > now)) continue;
      this.checked.set(key, { tries: seen?.tries ?? 0, retryAt: Infinity });
      this.queue.push({ sessionId: row.id, harness: row.harness });
    }
    void this.drain();
  }

  /** One first prompt at a time, so a server starting with many Sessions doesn't run tb-session for each at once. */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let next = this.queue.shift(); next; next = this.queue.shift()) {
        const key = `${next.harness}:${next.sessionId}`;
        let prompt: string | null;
        try {
          prompt = await this.opts.firstPrompt!(next.sessionId, next.harness);
        } catch {
          const tries = (this.checked.get(key)?.tries ?? 0) + 1;
          this.checked.set(key, { tries, retryAt: tries >= REBUILD_TRIES ? Infinity : this.now() + REBUILD_RETRY_MS });
          continue;
        }
        const line = prompt ? continuedFromLine(prompt) : null;
        if (!line || line.sessionId === next.sessionId) continue;
        const old = this.live.get(line.sessionId);
        // The line names no Harness: the old Session's own while it's live, else the one History knows
        // it under (the launcher can change the Harness), else the new one's.
        const fromHarness = old?.harness ?? (await this.opts.sessionHarness?.(line.sessionId, next.harness).catch(() => null)) ?? next.harness;
        const row = this.live.get(next.sessionId);
        this.record({
          from: line.sessionId,
          fromHarness,
          fromTitle: (old && title(old.title)) ?? line.title,
          to: next.sessionId,
          toHarness: next.harness,
          toTitle: row ? title(row.title) : null,
          at: this.now(),
        });
      }
    } finally {
      this.draining = false;
    }
  }

  private retitle(e: HandoffEntry, fromTitle: string | null, toTitle: string | null): boolean {
    let changed = false;
    if (fromTitle && fromTitle !== e.fromTitle) {
      e.fromTitle = fromTitle;
      changed = true;
    }
    if (toTitle && toTitle !== e.toTitle) {
      e.toTitle = toTitle;
      changed = true;
    }
    return changed;
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.opts.path), { recursive: true });
      const tmp = `${this.opts.path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.entries, null, 2) + '\n', { mode: 0o600 });
      renameSync(tmp, this.opts.path);
    } catch (err) {
      // The links still show until a restart; the `Continued from:` line can rebuild them (HAND-4.3).
      this.warn(`saving ${this.opts.path} failed: ${message(err)}`);
    }
    this.opts.onChange?.();
  }

  private warn(text: string): void {
    (this.opts.warn ?? console.warn)(`lookout: handoffs: ${text}`);
  }
}

/**
 * HAND-3.4: where the old Session works, for the launcher's directory check: as Fleet lists it at
 * that moment (a list that fails isn't trusted, its rows being the last good poll's), else as
 * History has it; null when neither knows it.
 */
export function sessionDirectory(deps: { monitor: Pick<SessionMonitor, 'pollNow' | 'snapshot' | 'get'>; history: Pick<History, 'lookup'> }) {
  return async (sessionId: string, harness: Harness): Promise<string | null> => {
    await deps.monitor.pollNow().catch(() => {});
    const row = deps.monitor.snapshot().fleet.state === 'ok' ? deps.monitor.get(sessionId) : null;
    if (row && row.harness === harness) return row.cwd;
    return (await deps.history.lookup(sessionId, harness).catch(() => null))?.projectPath ?? null;
  };
}

/** HAND-4.3: the Harness History knows a Session under, `likely` first, then the other; null when neither. */
export function historyHarness(history: Pick<History, 'lookup'>) {
  return async (sessionId: string, likely: Harness): Promise<Harness | null> => {
    for (const h of [likely, likely === 'claude' ? 'codex' : 'claude'] as const) {
      if (await history.lookup(sessionId, h).then(() => true, () => false)) return h;
    }
    return null;
  };
}

interface Expected {
  from: LaunchContinues;
  at: number;
  /** Set once the launcher reports the start: the Session's row, by Harness and process. */
  row: { harness: Harness; pid: number } | null;
}

/**
 * HAND-3.3: a start from a Handover is recorded once Fleet reports the new Session with its session
 * id, as TopicLaunches adds a Topic's. Kept in memory: a restart between the start and Fleet's report
 * loses it, and the `Continued from:` line links them instead (HAND-4.3).
 */
export class HandoffLaunches {
  private readonly expected = new Map<string, Expected>();
  private readonly handoffs: Pick<Handoffs, 'record'>;
  private readonly now: () => number;

  constructor(handoffs: Pick<Handoffs, 'record'>, now: () => number = Date.now) {
    this.handoffs = handoffs;
    this.now = now;
  }

  /** The request's `continues`, checked: null without one; throws a message for one that's malformed. */
  check(continues: unknown): LaunchContinues | null {
    if (continues === undefined || continues === null) return null;
    const c = continues as Record<string, unknown>;
    const h = harness(c?.harness);
    if (typeof c !== 'object' || typeof c.sessionId !== 'string' || !SESSION_ID.test(c.sessionId) || !h) throw new Error('Invalid Session to continue.');
    // TOPIC-15.1: the piece handed off, kept with the Handover by the Topic the start joins.
    const piece = typeof c.piece === 'string' ? c.piece.trim().slice(0, MAX_KEPT_PIECE).trim() : '';
    return { sessionId: c.sessionId, harness: h, title: title(c.title) ?? c.sessionId, piece };
  }

  /** Before the start is sent, so a Fleet report that beats the answer still finds it. False for a launch id already expected. */
  expect(launchId: string, from: LaunchContinues): boolean {
    if (this.expected.has(launchId)) return false;
    this.expected.set(launchId, { from, at: this.now(), row: null });
    return true;
  }

  /** The start failed: nothing will be reported, and nothing is recorded. */
  forget(launchId: string): void {
    this.expected.delete(launchId);
  }

  /** The launcher's `started` pairs: each start's Session row, found in the list Fleet just gave. */
  started(pairs: readonly { launchId: string; sessionId: string }[], rows: readonly SessionRow[]): void {
    for (const p of pairs) {
      const e = this.expected.get(p.launchId);
      const row = rows.find((r) => r.id === p.sessionId);
      if (e && row) e.row = { harness: row.harness, pid: row.pid };
    }
  }

  /** After every list: a reported start whose row has a session id is recorded, and forgotten. */
  observe(rows: readonly SessionRow[]): void {
    const now = this.now();
    for (const [launchId, e] of this.expected) {
      if (!e.row) {
        if (now - e.at > HANDOFF_LAUNCH_TTL_MS) this.expected.delete(launchId);
        continue;
      }
      const { harness: h, pid } = e.row;
      const row = rows.find((r) => r.harness === h && r.pid === pid);
      if (!row) {
        this.expected.delete(launchId); // it ended before it had an id
        continue;
      }
      if (!hasSessionId(row)) continue;
      this.expected.delete(launchId);
      const old = rows.find((r) => r.id === e.from.sessionId);
      this.handoffs.record({
        from: e.from.sessionId,
        fromHarness: e.from.harness,
        fromTitle: (old && title(old.title)) ?? e.from.title,
        to: row.id,
        toHarness: row.harness,
        toTitle: title(row.title),
        at: now,
      });
    }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
