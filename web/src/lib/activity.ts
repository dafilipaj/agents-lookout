import type { ChatEntry, Status } from '@shared/types.ts';

/** VIEW-1.10: after a composer send, how long "Working…" shows before Status has caught up. */
export const OPTIMISTIC_MS = 5_000;
/** VIEW-1.10: how long after turning Idle "Working…" waits for the final reply to reach the chat. */
export const SETTLE_MS = 5_000;

/** What the bottom of the chat says the Session is doing; null shows nothing. */
export type Activity = { kind: 'working'; since: number | null } | { kind: 'needs-you'; waitingFor: string | null };

export interface ActivityInput {
  status: Status;
  waitingFor: string | null;
  statusSince: number | null;
  /** The Session's process is gone. */
  ended: boolean;
  /** The chat's history, oldest first. */
  entries: readonly ChatEntry[];
  /**
   * When you last sent from the composer, ms since epoch; null if you haven't. A send made while
   * a turn ran (`turnRunning`) is queued behind it and leaves this unchanged.
   */
  sentAt: number | null;
  now: number;
}

/**
 * VIEW-1.10, the rules:
 * - Never for an ended Session.
 * - Needs you: Status is `needs-you`.
 * - Working: Status is `busy`; or within OPTIMISTIC_MS of a composer send, until Status changes
 *   after it; or Status is `unknown` and the feed is mid-turn; or Status turned `idle` less than
 *   SETTLE_MS ago and the feed is still mid-turn (the final reply hasn't reached the chat yet).
 */
export function activityOf(i: ActivityInput): Activity | null {
  if (i.ended) return null;
  if (i.status === 'needs-you') return { kind: 'needs-you', waitingFor: i.waitingFor };
  const settling = i.status === 'idle' && i.statusSince !== null && i.now - i.statusSince < SETTLE_MS && midTurn(i.entries);
  return turnRunning(i) || settling ? { kind: 'working', since: workingSince(i) } : null;
}

/**
 * A turn is running: Status is `busy`, a composer send that no final reply has answered hasn't
 * been caught up by Status yet, or Status is `unknown` and the feed is mid-turn. A send made now is queued behind that turn, so
 * it doesn't restart the timer. Settling doesn't count: Status already says `idle`.
 */
export function turnRunning(i: Omit<ActivityInput, 'waitingFor' | 'ended'>): boolean {
  const sent = unansweredSend(i.sentAt, i.entries);
  const caughtUp = sent !== null && i.statusSince !== null && i.statusSince >= sent;
  const optimistic = sent !== null && !caughtUp && i.now - sent < OPTIMISTIC_MS;
  return i.status === 'busy' || optimistic || (i.status === 'unknown' && midTurn(i.entries));
}

/** The feed's last entry is your prompt, a tool call, or a reply that isn't final. */
export function midTurn(entries: readonly ChatEntry[]): boolean {
  const last = entries.at(-1);
  if (!last) return false;
  return last.kind === 'user' || last.kind === 'tool_call' || (last.kind === 'assistant' && !last.final);
}

/**
 * When the current turn started: your latest prompt in the history, or your composer send when
 * that is newer (a queued send never sets `sentAt`). A prompt or send that a final reply already
 * answered doesn't count (the Session works on something else, e.g. a background task): then the time
 * Status turned `busy`. Null when none is known.
 */
export function workingSince(i: ActivityInput): number | null {
  let prompt: number | null = null;
  for (let j = i.entries.length - 1; j >= 0; j--) {
    const e = i.entries[j]!;
    if (e.kind === 'assistant' && e.final) break;
    if (e.kind === 'user' && prompt === null) prompt = ms(e.ts);
  }
  const sent = unansweredSend(i.sentAt, i.entries);
  const since = prompt !== null && sent !== null ? Math.max(prompt, sent) : (prompt ?? sent);
  if (since !== null) return since;
  return i.status === 'busy' ? i.statusSince : null;
}

/** The composer send's time, unless the feed's latest final reply came after it (it was answered). */
export function unansweredSend(sentAt: number | null, entries: readonly ChatEntry[]): number | null {
  if (sentAt === null) return null;
  for (let j = entries.length - 1; j >= 0; j--) {
    const e = entries[j]!;
    if (e.kind !== 'assistant' || !e.final) continue;
    const answered = ms(e.ts);
    return answered !== null && answered > sentAt ? null : sentAt;
  }
  return sentAt;
}

/**
 * VIEW-1.10: tidies the per-Session send times. A send's time moves along every alias to the
 * Session's current id (old key dropped; the newer time wins). Once the list is known, a Session
 * missing from it really ended and its time goes, unless a send to it is still in flight. While
 * the list isn't known, nothing is dropped. Returns `sentAt` itself when nothing changed.
 */
export function tidySentAt(
  sentAt: ReadonlyMap<string, number>,
  ctx: { live: { has(id: string): boolean }; aliases: ReadonlyMap<string, string>; listKnown: boolean; inFlight: ReadonlySet<string> },
): ReadonlyMap<string, number> {
  const resolve = (id: string) => {
    let cur = id;
    for (let k = 0; k < 8 && ctx.aliases.has(cur); k++) cur = ctx.aliases.get(cur)!;
    return cur;
  };
  const next = new Map<string, number>();
  let changed = false;
  for (const [id, at] of sentAt) {
    const to = resolve(id);
    if (to !== id) changed = true;
    const sending = ctx.inFlight.has(id) || ctx.inFlight.has(to);
    if (ctx.listKnown && !ctx.live.has(to) && !sending) {
      changed = true;
      continue;
    }
    next.set(to, Math.max(at, next.get(to) ?? -Infinity));
  }
  return changed ? next : sentAt;
}

/** "12s", "3m 07s", "1h 02m". */
export function formatElapsed(msElapsed: number): string {
  const s = Math.max(0, Math.floor(msElapsed / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

function ms(ts: string | null): number | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  return Number.isNaN(t) ? null : t;
}
