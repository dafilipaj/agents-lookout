import type { ChatEntry, ChatEvent, ChatPage, ChatProblem, ChatQuestion, SessionRow } from '../shared/types.ts';
import type { Runner } from './exec.ts';
import { AFTER_LIMIT, INITIAL_LIMIT, type MessagesResult, PAGE_LIMIT, fetchMessages } from './messages.ts';

/** VIEW-1.4: each viewed Session's Transcript is read for new entries this often. */
export const CHAT_INTERVAL_MS = 1000;
/** `transcript_not_found` (a Claude Session without a session id): look less often. */
export const MISSING_RETRY_MS = 5000;
/** After other failures: 1 s, 2 s, then every 5 s. */
const FAILED_RETRY_MS = [1000, 2000, 5000];
/** Entries kept per followed Session, so a tab that joins gets them without a Fleet call. */
const BUFFER_MAX = 500;
/**
 * A feed no tab views any more is kept this long, with its call in flight cancelled: viewed again
 * (A→B→A, holding j/k), it carries on, so one Session never has two Fleet calls at once, and the
 * tab gets its entries at once.
 */
export const PARK_MS = 5000;
/**
 * A conversation that's still empty (a new Session) is polled this often. A pid target (a Codex
 * Session before its first prompt) is checked with a fresh `fleet list` before every call, and
 * those are exactly these Sessions, so slowing this down keeps those checks rare.
 */
export const EMPTY_INTERVAL_MS = 2000;

const TAIL_TIMEOUT_MS = 8000;
const AFTER_TIMEOUT_MS = 4000;
const PAGE_TIMEOUT_MS = 8000;

export interface ChatFeedOptions {
  runner: Runner;
  fleetBin: () => string;
  env: () => NodeJS.ProcessEnv;
  /** The Session as Fleet currently lists it, or null. */
  lookup(sessionId: string): SessionRow | null;
  /**
   * The Fleet target for a row; rejects when it can't be used. A rejection with `status: 409`
   * means the Session is gone (see `Viewer.target`).
   */
  target(row: SessionRow): Promise<string>;
  sendTo(clientId: string, event: ChatEvent): void;
  intervalMs?: number;
}

interface Feed {
  sessionId: string;
  timer: NodeJS.Timeout | null;
  inFlight: boolean;
  /** No tab views it: no new calls; dropped when the park timer fires. */
  parked: NodeJS.Timeout | null;
  /** Server shutdown. */
  stopped: boolean;
  /** The first load arrived: `entries` and `before` are real. */
  loaded: boolean;
  entries: ChatEntry[];
  /** Prompts waiting in the Harness's queue, as Fleet last reported them. */
  queue: ChatEntry[];
  /** Cursor for "Show earlier" before `entries[0]`; null at the Transcript's start. */
  before: string | null;
  /** Fleet's top-level cursor for the next `--after`; null means load the latest entries afresh. */
  cursor: string | null;
  problem: ChatProblem | null;
  failures: number;
  /** Cancels the call in flight (when the feed is parked or stopped). */
  abort: AbortController | null;
  /** Send the next tail as a reset even if nothing changed (the tab was told the chat reloads). */
  forceReset: boolean;
}

export type PageResult = { ok: true; page: ChatPage } | { ok: false; status: number; error: string };

/**
 * VIEW-1.4: follows only the Sessions some tab is viewing. One feed per Session however many
 * tabs view it: the first call loads the latest entries, then `fleet messages --after <cursor>`
 * runs a second after the previous call ended (never two at once), and what changed is pushed
 * to the tabs viewing that Session. A tab that starts viewing gets the feed's entries at once.
 */
export class ChatFeed {
  private readonly viewers = new Map<string, string>();
  private readonly feeds = new Map<string, Feed>();
  private readonly opts: ChatFeedOptions;

  constructor(opts: ChatFeedOptions) {
    this.opts = opts;
  }

  /** What one tab views now (null: nothing). */
  view(clientId: string, sessionId: string | null): void {
    const before = this.viewers.get(clientId) ?? null;
    if (sessionId) this.viewers.set(clientId, sessionId);
    else this.viewers.delete(clientId);
    this.reconcile();
    if (!sessionId || sessionId === before) return;
    const feed = this.feeds.get(sessionId);
    if (feed?.loaded) this.opts.sendTo(clientId, this.resetEvent(feed));
    if (feed?.problem) this.opts.sendTo(clientId, { type: 'chat', sessionId, op: 'problem', problem: feed.problem });
  }

  drop(clientId: string): void {
    this.view(clientId, null);
  }

  /**
   * VIEW-10.3: a question's questions as the feed last read them from the Transcript, by its tool_use
   * id; null when no feed of the Session holds it (no tab views it, or it's older than the buffer).
   */
  question(sessionId: string, questionId: string): ChatQuestion[] | null {
    const f = this.feeds.get(sessionId);
    const e = f?.entries.findLast((x) => x.kind === 'question' && x.id === questionId);
    return e?.kind === 'question' ? e.questions : null;
  }

  /** Session ids being followed (for tests and diagnostics); parked feeds don't count. */
  following(): string[] {
    return [...this.feeds.values()].filter((f) => !f.parked).map((f) => f.sessionId);
  }

  stop(): void {
    for (const f of this.feeds.values()) {
      f.stopped = true;
      if (f.timer) clearTimeout(f.timer);
      if (f.parked) clearTimeout(f.parked);
      f.abort?.abort();
    }
    this.feeds.clear();
  }

  /** VIEW-1.6: entries older than `cursor`, for "Show earlier". */
  async earlier(sessionId: string, cursor: string): Promise<PageResult> {
    const row = this.opts.lookup(sessionId);
    if (!row) return { ok: false, status: 404, error: "This Session isn't running, so earlier messages can't be loaded." };
    let target: string;
    try {
      target = await this.opts.target(row);
    } catch (err) {
      const e = err as { status?: number; message?: string };
      if (e.status === 409) return { ok: false, status: 404, error: "This Session isn't running any more, so earlier messages can't be loaded." };
      return { ok: false, status: e.status ?? 503, error: e.message ?? "Couldn't check that the Session is still running." };
    }
    let res = await this.fetch(target, { before: cursor, limit: PAGE_LIMIT }, PAGE_TIMEOUT_MS);
    if (res.ok && !sameSession(row, res)) res = { ok: false, kind: 'io', error: 'Fleet answered for another Session.' };
    if (res.ok) return { ok: true, page: { entries: res.entries, before: res.hasMoreBefore ? res.oldest : null } };
    if (res.kind === 'cursor_invalid') {
      // The Transcript was rewritten: reload the chat, which replaces what the tab has.
      const feed = this.feeds.get(sessionId);
      if (feed) {
        feed.forceReset = true; // the tab is told the chat reloads: it must get a reset even if nothing changed
        this.reload(feed);
      }
      return { ok: false, status: 409, error: 'The Transcript changed, so the chat is reloading.' };
    }
    if (res.kind === 'transcript_not_found') return { ok: false, status: 404, error: res.error };
    return { ok: false, status: 502, error: `Couldn't load earlier messages: ${res.error}` };
  }

  private reconcile(): void {
    const wanted = new Set(this.viewers.values());
    for (const f of this.feeds.values()) {
      if (wanted.has(f.sessionId) || f.parked) continue;
      // Park: no new calls, and the one in flight is cancelled (its process group killed).
      if (f.timer) clearTimeout(f.timer);
      f.timer = null;
      f.abort?.abort();
      const expire = () => {
        if (this.feeds.get(f.sessionId) !== f || !f.parked) return;
        if (f.inFlight) {
          // Still reading: dropping it now would let a new feed overlap that call.
          f.parked = setTimeout(expire, 1000);
          f.parked.unref?.();
          return;
        }
        f.stopped = true;
        this.feeds.delete(f.sessionId);
      };
      f.parked = setTimeout(expire, PARK_MS);
      f.parked.unref?.();
    }
    for (const id of wanted) {
      const existing = this.feeds.get(id);
      if (existing) {
        if (existing.parked) {
          clearTimeout(existing.parked);
          existing.parked = null;
          if (!existing.inFlight) void this.poll(existing); // the call in flight schedules the next
        }
        continue;
      }
      const feed: Feed = {
        sessionId: id,
        timer: null,
        inFlight: false,
        parked: null,
        stopped: false,
        loaded: false,
        entries: [],
        queue: [],
        before: null,
        cursor: null,
        problem: null,
        failures: 0,
        abort: null,
        forceReset: false,
      };
      this.feeds.set(id, feed);
      void this.poll(feed);
    }
  }

  /** Load the latest entries afresh, now (or right after the call in flight). */
  private reload(f: Feed): void {
    f.cursor = null;
    if (f.inFlight || f.stopped || f.parked) return;
    if (f.timer) clearTimeout(f.timer);
    void this.poll(f);
  }

  private fetch(target: string, q: Parameters<typeof fetchMessages>[3], timeoutMs: number, signal?: AbortSignal): Promise<MessagesResult> {
    return fetchMessages(this.opts.runner, this.opts.fleetBin(), target, q, { timeoutMs, env: this.opts.env(), signal });
  }

  private async poll(f: Feed): Promise<void> {
    if (f.inFlight || f.stopped) return;
    f.timer = null;
    f.inFlight = true;
    let delay = this.opts.intervalMs ?? CHAT_INTERVAL_MS;
    try {
      const row = this.opts.lookup(f.sessionId);
      // Not listed (it ended, or the list isn't in yet): nothing to read, and what's loaded stays.
      if (!row) return;
      let target: string;
      try {
        target = await this.opts.target(row);
      } catch (err) {
        if ((err as { status?: number }).status === 409) return; // gone
        this.setProblem(f, { kind: 'failed', message: err instanceof Error ? err.message : "Couldn't read the Transcript." });
        delay = this.backoff(f);
        return;
      }
      if (f.parked) return; // parked while the target was checked
      const tail = f.cursor === null;
      const abort = new AbortController();
      f.abort = abort;
      let res = tail
        ? await this.fetch(target, { limit: INITIAL_LIMIT }, TAIL_TIMEOUT_MS, abort.signal)
        : await this.fetch(target, { after: f.cursor!, limit: AFTER_LIMIT }, AFTER_TIMEOUT_MS, abort.signal);
      f.abort = null;
      if (f.stopped) return;
      if (!res.ok && res.kind === 'cancelled') {
        delay = 0; // parked meanwhile: nothing to report; if viewed again since, carry on at once
        return;
      }
      if (!tail && f.cursor === null) {
        delay = 0; // a reload was asked for meanwhile: this answer is stale
        return;
      }
      if (res.ok && !sameSession(row, res)) res = { ok: false, kind: 'io', error: 'Fleet answered for another Session.' };
      if (res.ok) {
        f.failures = 0;
        if (tail) {
          this.applyTail(f, res);
          // Still empty (a new Session): look less often.
          if (!f.entries.length && !f.queue.length && f.cursor === null) delay = EMPTY_INTERVAL_MS;
        } else {
          this.applyAfter(f, res);
          if (res.hasMoreAfter) delay = 0;
        }
        this.setProblem(f, null);
      } else if (res.kind === 'cursor_invalid') {
        f.cursor = null; // reload without a cursor; its reset replaces what tabs have
        delay = 0;
      } else if (res.kind === 'transcript_not_found') {
        this.setProblem(f, { kind: 'missing', message: res.error });
        delay = MISSING_RETRY_MS;
      } else {
        this.setProblem(f, { kind: 'failed', message: res.error });
        delay = this.backoff(f);
      }
    } finally {
      f.inFlight = false;
      if (!f.stopped && !f.parked) {
        f.timer = setTimeout(() => void this.poll(f), delay);
        f.timer.unref?.();
      }
    }
  }

  /** The latest entries. Sent as a reset only when something changed (an empty Transcript polls this way). */
  private applyTail(f: Feed, res: Extract<MessagesResult, { ok: true }>): void {
    const entries = res.entries.slice(-BUFFER_MAX);
    const before = res.entries.length > BUFFER_MAX ? entries[0]!.cursor : res.hasMoreBefore ? res.oldest : null;
    const changed =
      !f.loaded ||
      f.forceReset ||
      before !== f.before ||
      JSON.stringify(entries) !== JSON.stringify(f.entries) ||
      JSON.stringify(res.queue) !== JSON.stringify(f.queue);
    f.entries = entries;
    f.before = before;
    f.queue = res.queue;
    f.cursor = res.cursor;
    f.loaded = true;
    f.forceReset = false;
    if (changed) this.broadcast(f, this.resetEvent(f));
  }

  /** New entries, entries that changed, and the queue as it is now. */
  private applyAfter(f: Feed, res: Extract<MessagesResult, { ok: true }>): void {
    if (res.cursor) f.cursor = res.cursor;
    const index = new Map(f.entries.map((e, i) => [e.cursor, i]));
    const fresh = res.entries.filter((e) => !index.has(e.cursor));
    // An entry Fleet reports as new but that's already here is a change too.
    const updated = [...res.updated, ...res.entries.filter((e) => index.has(e.cursor))];
    for (const u of updated) {
      const i = index.get(u.cursor);
      if (i !== undefined) f.entries[i] = u;
    }
    if (fresh.length) {
      f.entries = [...f.entries, ...fresh];
      if (f.entries.length > BUFFER_MAX) {
        f.entries = f.entries.slice(-BUFFER_MAX);
        f.before = f.entries[0]!.cursor;
      }
    }
    const queueChanged = JSON.stringify(res.queue) !== JSON.stringify(f.queue);
    f.queue = res.queue;
    if (fresh.length || updated.length || queueChanged) {
      this.broadcast(f, { type: 'chat', sessionId: f.sessionId, op: 'append', entries: fresh, updated, queue: f.queue });
    }
  }

  private backoff(f: Feed): number {
    return FAILED_RETRY_MS[Math.min(f.failures++, FAILED_RETRY_MS.length - 1)]!;
  }

  /** The latest entries, as a tab gets them when it starts viewing. */
  private resetEvent(f: Feed): ChatEvent {
    const entries = f.entries.slice(-INITIAL_LIMIT);
    const before = f.entries.length > entries.length ? entries[0]!.cursor : f.before;
    return { type: 'chat', sessionId: f.sessionId, op: 'reset', entries, before, queue: f.queue };
  }

  private setProblem(f: Feed, problem: ChatProblem | null): void {
    if (JSON.stringify(problem) === JSON.stringify(f.problem)) return;
    f.problem = problem;
    this.broadcast(f, { type: 'chat', sessionId: f.sessionId, op: 'problem', problem });
  }

  private broadcast(f: Feed, event: ChatEvent): void {
    if (f.stopped) return;
    for (const [clientId, id] of this.viewers) if (id === f.sessionId) this.opts.sendTo(clientId, event);
  }
}

/** Fleet resolved the target to the Session Lookout meant: same Harness, and same id when it has one. */
function sameSession(row: SessionRow, res: Extract<MessagesResult, { ok: true }>): boolean {
  if (res.harness && res.harness !== row.harness) return false;
  const hasId = !row.id.startsWith(`${row.harness}:`);
  return !(hasId && res.sessionId && res.sessionId !== row.id);
}
