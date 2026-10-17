import type { ChatEntry } from '@shared/types.ts';
import { clockTime } from './chat';

/** VIEW-1.11: what a Mark stands for: a prompt you sent, a subagent's result, or a question. */
export type MarkKind = 'prompt' | 'subagent' | 'question';

export interface Mark {
  /** The entry's cursor; its chat row carries it as `data-mark`. */
  cursor: string;
  kind: MarkKind;
  /** The entry's first line, bounded. */
  text: string;
  ts: string | null;
}

export const MARK_KIND_LABEL: Record<MarkKind, string> = {
  prompt: 'Your prompt',
  subagent: 'Subagent result',
  question: 'Question',
};

const MAX_LINE = 120;

/** The Marks for the loaded history, in order. Queued prompts aren't part of the history. */
export function chatMarks(entries: readonly ChatEntry[]): Mark[] {
  const out: Mark[] = [];
  for (const e of entries) {
    if (e.kind === 'user' && !e.queued) out.push({ cursor: e.cursor, kind: 'prompt', text: firstLine(e.text), ts: e.ts });
    else if (e.kind === 'system') out.push({ cursor: e.cursor, kind: 'subagent', text: firstLine(e.text), ts: e.ts });
    else if (e.kind === 'question') out.push({ cursor: e.cursor, kind: 'question', text: firstLine(e.questions[0]?.question ?? ''), ts: e.ts });
  }
  return out;
}

/** The first line with text in it, bounded. */
export function firstLine(text: string): string {
  const line =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? '';
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line;
}

/** The Mark's accessible name: what it is, when, and its first line. */
export function markName(m: Mark): string {
  const time = clockTime(m.ts);
  return `${MARK_KIND_LABEL[m.kind]}${time ? ` at ${time}` : ''}: ${m.text}`;
}

/** Where a Mark sits on the rail, as a fraction of the chat's full scroll height (0 at the top). */
export function railFraction(top: number, scrollHeight: number): number {
  if (!(scrollHeight > 0) || !Number.isFinite(top)) return 0;
  return Math.min(1, Math.max(0, top / scrollHeight));
}

/** How far above an entry a jump leaves it, so it isn't flush with the chat's top edge. */
export const JUMP_MARGIN_PX = 12;

/**
 * VIEW-1.11: the Mark `[` (-1) or `]` (+1) goes to. `tops` are the Marks' offsets in the chat,
 * in order. After a jump that you haven't scrolled away from, it steps from that Mark (a Mark
 * near the bottom can't reach the top edge, so the scroll position alone would get stuck);
 * otherwise from where the chat is scrolled to. Null when there's none that way.
 */
export function stepMark(tops: readonly number[], scrollTop: number, dir: 1 | -1, from: number | null): number | null {
  if (tops.length === 0) return null;
  if (from !== null && from >= 0 && from < tops.length) {
    const next = from + dir;
    return next >= 0 && next < tops.length ? next : null;
  }
  const line = scrollTop + JUMP_MARGIN_PX;
  if (dir === 1) {
    const i = tops.findIndex((t) => t > line + 1);
    return i >= 0 ? i : null;
  }
  for (let i = tops.length - 1; i >= 0; i--) if (tops[i]! < line - 1) return i;
  return null;
}
