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
export const CACHED_ENTRIES = 100;

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

/** Folds each run of consecutive tool calls into one item; everything else stays as it is. */
export function chatItems(entries: readonly ChatEntry[]): ChatItem[] {
  const out: ChatItem[] = [];
  for (const e of entries) {
    if (e.kind === 'tool_call') {
      const last = out.at(-1);
      if (last?.type === 'tools') last.calls.push(e);
      else out.push({ type: 'tools', key: e.cursor, calls: [e] });
    } else {
      out.push({ type: 'entry', key: e.cursor, entry: e });
    }
  }
  return out;
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
