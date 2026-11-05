import type { ChatAnswer, ChatEntry, ChatEvent, ChatPage, ChatProblem, ChatQuestion } from '@shared/types.ts';

export type ToolCall = Extract<ChatEntry, { kind: 'tool_call' }>;
export type QuestionEntry = Extract<ChatEntry, { kind: 'question' }>;

/** VIEW-1: one Session's chat, as the server pushed it. */
export interface Chat {
  /** The first entries arrived. */
  loaded: boolean;
  /** The history, oldest first, "Show earlier" pages included. */
  entries: readonly ChatEntry[];
  /** Prompts waiting in the Harness's queue (shown after the history, never part of it). */
  queue: readonly ChatEntry[];
  /** Cursor for "Show earlier"; null at the Transcript's start. */
  before: string | null;
  problem: ChatProblem | null;
  /** Bumped on every reset, so a "Show earlier" page that lands after one is dropped. */
  epoch: number;
  /** You're at the bottom (VIEW-1.5): only then is the oldest end trimmed. */
  following: boolean;
}

/** Entries a chat keeps; past this, the oldest are dropped, but only while you're at the bottom. */
export const MAX_CHAT_ENTRIES = 2000;
/** Chats kept besides the one in view, for switching back; each cut to its latest entries. */
export const CACHED_CHATS = 3;
/** What a cached chat keeps: the server's reset brings the same latest entries on switching back. */
export const CACHED_ENTRIES = 300;

export const emptyChat: Chat = { loaded: false, entries: [], queue: [], before: null, problem: null, epoch: 0, following: true };

/** A server event applied to a chat; the same object when nothing changed. */
export function applyChatEvent(chat: Chat, e: ChatEvent): Chat {
  if (e.op === 'reset') {
    return { ...chat, loaded: true, entries: unique(e.entries), queue: e.queue, before: e.before, problem: null, epoch: chat.epoch + 1 };
  }
  if (e.op === 'problem') return { ...chat, problem: e.problem };
  if (!chat.loaded) return chat;
  // Entries already shown are replaced in place (a question answered, a reply that grew); new
  // ones go at the end; the queue is replaced as a whole.
  const index = new Map(chat.entries.map((x, i) => [x.cursor, i]));
  let entries: ChatEntry[] | null = null;
  for (const u of [...e.updated, ...e.entries.filter((x) => index.has(x.cursor))]) {
    const i = index.get(u.cursor);
    if (i === undefined) continue;
    entries ??= [...chat.entries];
    entries[i] = u;
  }
  const fresh = unique(e.entries.filter((x) => !index.has(x.cursor)));
  if (fresh.length) entries = [...(entries ?? chat.entries), ...fresh];
  const queueSame = JSON.stringify(e.queue) === JSON.stringify(chat.queue);
  if (!entries && queueSame) return chat;
  return trim({ ...chat, entries: entries ?? chat.entries, queue: queueSame ? chat.queue : e.queue });
}

/** VIEW-1.6: an older page goes above the history, if it still fits (no reset or trim since). */
export function applyPage(chat: Chat, before: string, epoch: number, page: ChatPage): Chat {
  if (chat.epoch !== epoch || chat.before !== before) return chat;
  return { ...chat, entries: joinPages(page.entries, chat.entries), before: page.before };
}

/** Whether you're at the bottom; arriving there trims a chat that grew past the cap. */
export function setFollowing(chat: Chat, following: boolean): Chat {
  return chat.following === following ? chat : trim({ ...chat, following });
}

/** A chat out of view keeps only its latest entries. */
export function park(chat: Chat): Chat {
  if (chat.entries.length <= CACHED_ENTRIES) return chat;
  const entries = chat.entries.slice(-CACHED_ENTRIES);
  return { ...chat, entries, before: entries[0]!.cursor, epoch: chat.epoch + 1 };
}

function trim(chat: Chat): Chat {
  if (!chat.following || chat.entries.length <= MAX_CHAT_ENTRIES) return chat;
  const entries = chat.entries.slice(-MAX_CHAT_ENTRIES);
  return { ...chat, entries, before: entries[0]!.cursor };
}

function unique(entries: readonly ChatEntry[]): ChatEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => !seen.has(e.cursor) && !!seen.add(e.cursor));
}

/** One row of the chat: an entry, or a run of consecutive tool calls folded into one (VIEW-1.2). */
export type ChatItem = { type: 'entry'; key: string; entry: Exclude<ChatEntry, ToolCall> } | { type: 'tools'; key: string; calls: ToolCall[] };

/**
 * Folds each run of consecutive tool calls into one item; everything else stays as it is. A run is
 * cut at `splitAt`, the entry the "New since you looked" divider sits above (VIEW-13.2).
 */
export function chatItems(entries: readonly ChatEntry[], splitAt: string | null = null): ChatItem[] {
  const out: ChatItem[] = [];
  for (const e of entries) {
    if (e.kind === 'tool_call') {
      const last = out.at(-1);
      if (last?.type === 'tools' && e.cursor !== splitAt) last.calls.push(e);
      else out.push({ type: 'tools', key: e.cursor, calls: [e] });
    } else {
      out.push({ type: 'entry', key: e.cursor, entry: e });
    }
  }
  return out;
}

/** VIEW-12.1: a reply this short, in one plain paragraph, is a progress update. */
export const UPDATE_MAX_CHARS = 170;

/** VIEW-12.1: one paragraph, no list, code, table, heading or quote, at most UPDATE_MAX_CHARS. */
export function isShortUpdate(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > UPDATE_MAX_CHARS || /\n\s*\n/.test(t)) return false;
  return !t.split('\n').some((line) => /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>|\||```|~~~)/.test(line));
}

/** VIEW-12.2: two or more steps in a row, shown as one row; `live` while its turn runs (VIEW-12.3). */
export type ChatFold = { type: 'fold'; key: string; items: ChatItem[]; live: boolean };
export type ChatRow = ChatItem | ChatFold;

/**
 * VIEW-12.1, 12.2: the chat's rows with each run of two or more steps folded. A step is a run of
 * tool calls or a short update; the turn's answer never is: a reply Fleet marks final, else the
 * last reply before your next prompt or command, or the chat's last reply while no turn runs.
 * No run spans `breakBefore`, the item the "New since you looked" divider sits above (VIEW-13.2).
 */
export function foldSteps(items: readonly ChatItem[], running: boolean, breakBefore: string | null = null): ChatRow[] {
  const answers = new Set<number>();
  let lastReply = -1;
  const closeTurn = () => {
    if (lastReply >= 0) answers.add(lastReply);
    lastReply = -1;
  };
  items.forEach((it, i) => {
    if (it.type !== 'entry') return;
    const e = it.entry;
    if (e.kind === 'user' || e.kind === 'command') closeTurn();
    else if (e.kind === 'assistant') {
      if (e.final) {
        answers.add(i);
        lastReply = -1;
      } else lastReply = i;
    }
  });
  if (!running) closeTurn();
  const isStep = (it: ChatItem, i: number) => it.type === 'tools' || (it.entry.kind === 'assistant' && !answers.has(i) && isShortUpdate(it.entry.text));
  const out: ChatRow[] = [];
  let run: ChatItem[] = [];
  const flush = (live: boolean) => {
    if (run.length >= 2) out.push({ type: 'fold', key: run[0]!.key, items: run, live });
    else out.push(...run);
    run = [];
  };
  items.forEach((it, i) => {
    // VIEW-13.2: the divider sits between two rows, so no fold spans it.
    if (it.key === breakBefore) flush(false);
    if (isStep(it, i)) run.push(it);
    else {
      flush(false);
      out.push(it);
    }
  });
  flush(running);
  return out;
}

/** VIEW-12.2: a fold's counts, time span and hint: its last update, or its last tool call without one. */
export function foldSummary(fold: ChatFold): { updates: number; calls: number; ms: number | null; hint: string } {
  let updates = 0;
  let calls = 0;
  const times: number[] = [];
  for (const it of fold.items) {
    const stamps = it.type === 'tools' ? it.calls.map((c) => c.ts) : [it.entry.ts];
    if (it.type === 'tools') calls += it.calls.length;
    else updates += 1;
    for (const ts of stamps) if (ts && !Number.isNaN(Date.parse(ts))) times.push(Date.parse(ts));
  }
  const update = fold.items.findLast((it) => it.type === 'entry');
  const tools = fold.items.findLast((it) => it.type === 'tools');
  const call = tools?.type === 'tools' ? tools.calls.at(-1) : undefined;
  const hint = update?.type === 'entry' && update.entry.kind === 'assistant' ? update.entry.text.trim().split('\n')[0]! : call ? `${call.tool} · ${call.summary}` : '';
  return { updates, calls, ms: times.length >= 2 ? Math.max(...times) - Math.min(...times) : null, hint };
}

/** VIEW-12.2: "55 min", "1 h 5 min", "less than a minute". */
export function workedFor(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'less than a minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

/** "6 tool calls: Read ×3, Grep ×2, Bash": most used first, ties in order of first use. */
export function toolsLabel(calls: readonly ToolCall[]): string {
  const counts = new Map<string, number>();
  for (const c of calls) counts.set(c.tool, (counts.get(c.tool) ?? 0) + 1);
  const names = [...counts.entries()]
    .map(([tool, n], i) => ({ tool, n, i }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map(({ tool, n }) => (n > 1 ? `${tool} ×${n}` : tool));
  return `${calls.length} tool ${calls.length === 1 ? 'call' : 'calls'}: ${names.join(', ')}`;
}

/** Entries from `older` that `newer` doesn't have yet, then `newer` (a page joined to the chat). */
export function joinPages(older: readonly ChatEntry[], newer: readonly ChatEntry[]): ChatEntry[] {
  const known = new Set(newer.map((e) => e.cursor));
  return [...unique(older.filter((e) => !known.has(e.cursor))), ...newer];
}

/**
 * VIEW-1.9: what was answered to question `i`: the indexes of the options picked (Fleet's
 * `picked`), and the answer text when it isn't just those options (typed by you).
 */
export function answerFor(q: ChatQuestion, answer: ChatAnswer | null, i: number): { picked: Set<number>; other: string | null } {
  if (!answer || !('answers' in answer)) return { picked: new Set(), other: null };
  const text = answer.answers[i] ?? null;
  // Without `picked`, only an answer that is exactly one option's label marks it.
  const exact = text === null ? -1 : q.options.findIndex((o) => o.label === text);
  const picked = new Set(answer.picked ? (answer.picked[i] ?? []) : exact >= 0 ? [exact] : []);
  if (text === null) return { picked, other: null };
  // The answer as Claude Code records it: the picked labels, joined with ", ".
  const asPicked = [...picked]
    .sort((a, b) => a - b)
    .map((n) => q.options[n]?.label)
    .join(', ');
  return { picked, other: text === asPicked ? null : text };
}

/** "10:03" in local time, or null. */
export function clockTime(ts: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** VIEW-13.1: the last entry the chat had when you left a Session's view. */
export interface ChatSeen {
  cursor: string;
  /** Its time, ms since epoch; null when it has none. */
  at: number | null;
}

/** An entry's time in ms, or null. */
export function timeOf(ts: string | null): number | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  return Number.isNaN(t) ? null : t;
}

/**
 * VIEW-13.2: where the "New since you looked" divider sits: above the first entry of the agent's
 * after what you saw (found by its cursor, else by its time, a tie counting as new); null when
 * there's none. `chatItems` starts an item at that entry, so the key is an item's.
 */
export function newSince(entries: readonly ChatEntry[], seen: ChatSeen): { key: string; ts: string | null } | null {
  const i = entries.findIndex((e) => e.cursor === seen.cursor);
  const after = i >= 0 ? entries.slice(i + 1) : seen.at !== null ? entries.filter((e) => (timeOf(e.ts) ?? -Infinity) >= seen.at!) : [];
  const first = after.find((e) => e.kind !== 'user' && e.kind !== 'command');
  return first ? { key: first.cursor, ts: first.ts } : null;
}

