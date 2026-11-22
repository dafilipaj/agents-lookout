import { HANDOFF_RESTATE_LINE } from '@shared/handoff.ts';
import type { LaunchChoices, Settings } from '@shared/settings.ts';
import type { ChatEntry, HandoffLink, SessionRow, Status } from '@shared/types.ts';
import { type Topic, memberKey, rowMember } from '@shared/topics.ts';
import type { LaunchDraft } from './launch';

/**
 * HAND-1.3: Lookout's request, in its fixed wording (the spec's Technical approach). With no piece it
 * covers all of the Session's work; with one, only that piece.
 */
export function handoffRequest(piece: string): string {
  const what = piece.trim() ? `this piece of it: ${piece.trim().replace(/\s*\n\s*/g, ' ')}` : "all of this Session's work";
  return [
    `Write a Handover for a new Session that will continue ${what}. It starts with an empty context, so the Handover is all it will know: err on the side of too much. Write it to that Session, not as a summary of ours:`,
    '- the goal, and what done looks like;',
    "- where things stand: the directory, the branch or Worktree, what's changed, what's committed or pushed;",
    '- the files, commands, links, Tasks and PRs it would otherwise have to find again;',
    "- what's settled and why, and what was tried and ruled out;",
    '- the scope and its limits: what not to touch, whether to push;',
    '- the first move.',
    "Don't change anything now. Reply with the Handover alone, between a line <handover> and a line </handover>.",
  ].join('\n');
}

/** HAND-2.3: the Handover in a reply: the text between its `<handover>` and `</handover>` lines, else the whole reply. */
export function handoverFrom(reply: string): string {
  const lines = reply.replace(/\r\n?/g, '\n').split('\n');
  const open = lines.findIndex((l) => l.trim() === '<handover>');
  const close = open < 0 ? -1 : lines.findIndex((l, i) => i > open && l.trim() === '</handover>');
  return (open >= 0 && close > open ? lines.slice(open + 1, close).join('\n') : reply).trim();
}

/** HAND-3.2: the line after the Handover, asking the new Session to restate the work before it changes anything. */
export const RESTATE_LINE = HANDOFF_RESTATE_LINE;

/** HAND-3.2: the new Session's prompt: the Handover, the `Continued from:` line (HAND-4.3 reads it back), the restate line. */
export function handoffPrompt(handover: string, from: { sessionId: string; title: string }): string {
  return `${handover.trim()}\n\nContinued from: ${from.sessionId} ${from.title.replace(/\s+/g, ' ').trim()}\n${RESTATE_LINE}`;
}

/** HAND-1.1: a Session "Hand off…" is offered for: Controllable, with a session id, not ended. */
export function canHandOff(row: SessionRow, ended: boolean): boolean {
  return !ended && row.controllable && rowMember(row) !== null;
}

/**
 * HAND-2: one Session's wait for its Handover, kept in App next to the composer's drafts, so it
 * outlives the popover and switching Sessions, and goes with a reload (HAND-2.2).
 * - `sending`: the request is on its way (VIEW-3.2);
 * - `writing`: sent; the Session's Turn hasn't ended yet. `busy` once a Busy was seen after the send;
 *   `skip`: the same request, sent to the Session from this page in the moments before (`replyAfter`);
 * - `ready`: the Handover, for the launcher; `failed`: why, for "Try again".
 */
export type HandoffWait =
  | { state: 'sending' | 'writing'; piece: string; request: string; sentAt: number; skip: number; busy: boolean; reads: number; readAfter: number }
  /**
   * HAND-6.2: `at`, when it became ready, which tells it from a newer one the Session writes; `draft`,
   * the launcher's fields from its first opening with this Handover on.
   */
  | { state: 'ready'; piece: string; handover: string; at: number; draft?: LaunchDraft }
  | { state: 'failed'; piece: string; reason: string };

/** A wait whose request is on its way or written: the Session's Turn hasn't ended yet. */
export type WritingWait = Extract<HandoffWait, { busy: boolean }>;

/** HAND-2.4: the reasons a wait fails, besides a send's own error. */
export const HANDOFF_ENDED = 'The Session ended before it wrote the Handover.';
export const HANDOFF_NEEDS_YOU = 'The Session needs you before it can write the Handover. Answer it, then try again.';
export const HANDOFF_NO_TEXT = 'The Session replied without any text, so there is no Handover. Try again, or ask it in the chat.';
export const HANDOFF_NOT_FOUND = "The Session is Idle again, but its reply isn't in its chat. Try again, or look in the chat.";
/** HAND-2.3: a request in the chat dated this much before the send is still taken as this one (the Transcript's clock and the page's). */
export const SENT_SKEW_MS = 10_000;
/** HAND-2.3: after a Busy, a chat without the request or its reply yet is read again this often, this many times (the Transcript can lag the Status). */
export const HANDOFF_READ_MS = 2000;
export const HANDOFF_READS = 5;

/** What a wait does as the Session's row changes: nothing, read the chat now (the Turn may have ended), or fail. */
export type WaitStep = { kind: 'none' } | { kind: 'busy' } | { kind: 'read' } | { kind: 'fail'; reason: string };

/**
 * HAND-2.3, HAND-2.4: a written request's next step from the Session's row (null once it's gone from
 * a known list). A Busy after the send marks the Turn running; Idle after it ends the Turn, and the
 * chat is read. An Idle before any Busy is read too: the whole Turn may have run between two lists,
 * and the chat says whether it has (`replyAfter`).
 */
export function waitStep(wait: HandoffWait, row: SessionRow | null): WaitStep {
  if (wait.state !== 'writing') return { kind: 'none' };
  if (!row) return { kind: 'fail', reason: HANDOFF_ENDED };
  const status: Status = row.status;
  if (status === 'needs-you') return { kind: 'fail', reason: HANDOFF_NEEDS_YOU };
  if (status === 'busy') return wait.busy ? { kind: 'none' } : { kind: 'busy' };
  if (status === 'idle') return { kind: 'read' };
  return { kind: 'none' };
}

/** HAND-2.3: what a read of the chat found: whether the request shows, the reply to it, and whether that reply is done. */
export interface FoundReply {
  asked: boolean;
  reply: string | null;
  done: boolean;
}

const hasHandover = (text: string) => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const open = lines.findIndex((l) => l.trim() === '<handover>');
  return open >= 0 && lines.some((l, i) => i > open && l.trim() === '</handover>');
};

/**
 * HAND-2.3: the reply to the request in the chat's latest entries: the last prompt that is the
 * request, and the Session's answer in its Turn, up to the next prompt or command: the text with both
 * markers, else the reply Fleet marks final, else the Turn's last text. `done`: that reply is the
 * Turn's answer (both markers, final, or a later prompt closed the Turn), not an update on the way.
 * `asked` false: the request isn't in the chat yet; `reply` null: asked, but no text since. `skip`:
 * the same request sent from this page within SENT_SKEW_MS before this one; the chat shows this one
 * only once it has one more than those, so a chat that lags isn't answered by an earlier Turn's.
 */
export function replyAfter(entries: readonly ChatEntry[], request: string, sentAt?: number, skip = 0): FoundReply {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const want = norm(request);
  // Its first line names the piece: a Harness that keeps the prompt a little differently still matches.
  const first = norm(request.split('\n')[0]!);
  let at = -1;
  let seen = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind !== 'user' || e.queued || !(norm(e.text) === want || norm(e.text).startsWith(first))) continue;
    // An earlier request, the same words (Try again, say), isn't this one: its reply is an old Handover.
    if (sentAt !== undefined && e.ts && Date.parse(e.ts) < sentAt - SENT_SKEW_MS) break;
    if (at < 0) at = i;
    seen++;
  }
  if (at < 0 || seen <= skip) return { asked: false, reply: null, done: false };
  // The Turn ends at the next prompt or command; a prompt queued behind it doesn't end it.
  let end = at + 1;
  while (end < entries.length && !((entries[end]!.kind === 'user' && !(entries[end] as { queued: boolean }).queued) || entries[end]!.kind === 'command')) end++;
  const said = entries.slice(at + 1, end).filter((e): e is Extract<ChatEntry, { kind: 'assistant' }> => e.kind === 'assistant' && e.text.trim() !== '');
  const marked = said.findLast((e) => hasHandover(e.text));
  const final = said.findLast((e) => e.final);
  const reply = marked ?? final ?? said.at(-1);
  return { asked: true, reply: reply?.text ?? null, done: !!(marked || final) || end < entries.length };
}

/**
 * HAND-2.3, HAND-2.4: a written request's wait after a read of the chat (`found` null: the read
 * failed). A done reply is the Handover, or fails with no text. The Turn has ended once a Busy was
 * seen, then Idle, or once the request shows with the Session Idle: a reply not done yet is read again
 * every 2 s, up to HANDOFF_READS times, and the last read takes the Turn's last text, if any. Until
 * the Turn has ended, an Idle with no request in the chat keeps reading.
 */
export function afterRead(wait: WritingWait, found: FoundReply | null, now: number): HandoffWait {
  const take = (reply: string | null): HandoffWait => {
    const handover = reply ? handoverFrom(reply) : '';
    return handover ? { state: 'ready', piece: wait.piece, handover, at: now } : { state: 'failed', piece: wait.piece, reason: HANDOFF_NO_TEXT };
  };
  if (found?.done) return take(found.reply);
  const again = { ...wait, readAfter: now + HANDOFF_READ_MS };
  if (!wait.busy && !found?.asked) return again;
  if (wait.reads + 1 < HANDOFF_READS) return { ...again, reads: wait.reads + 1 };
  return found?.asked ? take(found.reply) : { state: 'failed', piece: wait.piece, reason: HANDOFF_NOT_FOUND };
}

/**
 * HAND-3.1: the launcher's draft from a Handover: the old Session's directory (HAND-3.4), Harness,
 * model and Effort, its Topic when it's in exactly one Open Topic, no name, Skip permissions as the
 * launcher last had it for that Harness, and the prompt (HAND-3.2). `piece`: what was handed off,
 * '' for all the work, which the Topic keeping the Handover is told (TOPIC-15.1).
 */
export function handoffDraft(row: SessionRow, handover: string, settings: Settings, topics: readonly Topic[], piece = ''): LaunchDraft {
  const harness = row.harness;
  const last: LaunchChoices | undefined = settings.lastLaunch?.byHarness?.[harness];
  const effort = row.pendingEffort?.effort ?? row.effort ?? last?.effort ?? null;
  const key = memberKey('session', { harness, sessionId: row.id });
  const open = rowMember(row) ? topics.filter((t) => t.state === 'open' && t.members.some((m) => m.key === key)) : [];
  const directory = row.cwd ?? '';
  return {
    directory,
    harness,
    model: row.pendingModel?.model ?? row.model ?? '',
    name: '',
    prompt: handoffPrompt(handover, { sessionId: row.id, title: row.title }),
    byHarness: { [harness]: { effort, skipPermissions: last?.skipPermissions ?? harness === 'claude' } },
    ...(open.length === 1 ? { topic: { id: open[0]!.id, via: 'topic' as const } } : {}),
    continues: { sessionId: row.id, harness, title: row.title, piece: piece.trim(), directory },
  };
}

/** HAND-4: a link's other Session as the header shows it: its title now when it's live, else as last seen. */
export interface ShownLink {
  sessionId: string;
  harness: HandoffLink['harness'];
  title: string;
  live: SessionRow | null;
}

export function showLink(link: HandoffLink, sessions: ReadonlyMap<string, SessionRow>): ShownLink {
  const live = sessions.get(link.sessionId) ?? null;
  return { sessionId: link.sessionId, harness: link.harness, title: live?.title ?? link.title ?? `Session ${link.sessionId.slice(0, 8)}`, live };
}

/** HAND-6: a Handover the Session has written, waiting for you. */
export type ReadyWait = Extract<HandoffWait, { state: 'ready' }>;

/** HAND-6.2: `waits` with the ready Handover of `id` holding the launcher's fields `draft`; unchanged otherwise. */
export function withReadyDraft(waits: ReadonlyMap<string, HandoffWait>, id: string, draft: LaunchDraft): ReadonlyMap<string, HandoffWait> {
  const w = waits.get(id);
  return w?.state === 'ready' && w.draft !== draft ? new Map(waits).set(id, { ...w, draft }) : waits;
}

/**
 * HAND-6.2: `waits` without the ready Handover of `id`: started from, kept in a Topic, or discarded.
 * With `at`, only the Handover that became ready then, never a newer one.
 */
export function withoutReady(waits: ReadonlyMap<string, HandoffWait>, id: string, at?: number): ReadonlyMap<string, HandoffWait> {
  const w = waits.get(id);
  if (w?.state !== 'ready' || (at !== undefined && w.at !== at)) return waits;
  const next = new Map(waits);
  next.delete(id);
  return next;
}

/** HAND-6.4: where this browser keeps a Session's ready Handover: this, then its id. */
export const KEPT_HANDOVER_PREFIX = 'lookout.handover.';

/**
 * HAND-6.4: a kept Handover as stored for Session `id`; null for anything else. A kept draft that
 * isn't a launcher's for that Session is dropped, and opening the launcher makes it again.
 */
function parseKept(id: string, raw: string | null): ReadyWait | null {
  let it: { v?: unknown; piece?: unknown; handover?: unknown; at?: unknown; draft?: unknown } | null;
  try {
    it = JSON.parse(raw ?? 'null') as typeof it;
  } catch {
    return null;
  }
  if (!it || it.v !== 1 || typeof it.handover !== 'string' || !it.handover.trim() || typeof it.piece !== 'string' || typeof it.at !== 'number') return null;
  const d = it.draft as Partial<LaunchDraft> | undefined;
  const draftOk = !!d && typeof d === 'object' && typeof d.prompt === 'string' && typeof d.directory === 'string' && typeof d.model === 'string' && typeof d.name === 'string'
    && (d.harness === 'claude' || d.harness === 'codex') && d.continues?.sessionId === id;
  return { state: 'ready', piece: it.piece, handover: it.handover, at: it.at, ...(draftOk ? { draft: d as LaunchDraft } : {}) };
}

/** HAND-6.4: the ready Handovers this browser kept, by Session id; none when the storage can't be read. */
export function readKeptHandovers(): Map<string, ReadyWait> {
  const out = new Map<string, ReadyWait>();
  try {
    const storage = window.localStorage;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(KEPT_HANDOVER_PREFIX)) continue;
      const id = key.slice(KEPT_HANDOVER_PREFIX.length);
      const wait = parseKept(id, storage.getItem(key));
      if (wait) out.set(id, wait);
    }
  } catch {
    // Storage this page can't read keeps nothing.
  }
  return out;
}

/**
 * HAND-6.4: keeps what changed from `prev` to `next`: a Session whose ready Handover is new or changed
 * is written, one that's no longer ready is removed, and the rest are left alone, so a tab never writes
 * over another tab's. `fromStorage`: a Handover brought in from storage, which isn't written back. A
 * storage that throws leaves the page's copy alone.
 */
export function keepHandovers(prev: ReadonlyMap<string, HandoffWait>, next: ReadonlyMap<string, HandoffWait>, fromStorage: (w: ReadyWait) => boolean = () => false): void {
  try {
    const storage = window.localStorage;
    for (const [id, w] of next) {
      if (w.state !== 'ready' || prev.get(id) === w || fromStorage(w)) continue;
      storage.setItem(KEPT_HANDOVER_PREFIX + id, JSON.stringify({ v: 1, piece: w.piece, handover: w.handover, at: w.at, ...(w.draft ? { draft: w.draft } : {}) }));
    }
    for (const [id, w] of prev) if (w.state === 'ready' && next.get(id)?.state !== 'ready') storage.removeItem(KEPT_HANDOVER_PREFIX + id);
  } catch {
    // Private mode or full: it lasts as long as the page.
  }
}

/**
 * HAND-6.4: another tab's change to a kept Handover, from a `storage` event: the Session, and its
 * Handover as stored now, or null once it's gone. Read from the storage, not the event: an event can
 * arrive after a later change, which then wins. Null for any other key.
 */
export function keptHandoverChange(e: Pick<StorageEvent, 'key'>): { id: string; wait: ReadyWait | null } | null {
  if (!e.key?.startsWith(KEPT_HANDOVER_PREFIX)) return null;
  const id = e.key.slice(KEPT_HANDOVER_PREFIX.length);
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(e.key);
  } catch {
    return null;
  }
  return { id, wait: raw === null ? null : parseKept(id, raw) };
}
