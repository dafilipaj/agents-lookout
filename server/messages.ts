import type { ChatAnswer, ChatEntry, ChatQuestion } from '../shared/types.ts';
import type { RunError, Runner } from './exec.ts';
import { unwrapPasted } from './pasted.ts';
import { sanitizeLine } from './sanitize.ts';

/**
 * VIEW-1: `fleet messages <target> --json`, the Transcript as chat entries (contract:
 * docs/features/session-view/SPEC.md, Technical approach). Lookout validates every field, keeps
 * only what the chat shows, and bounds it, since a Transcript can hold anything.
 */

/** VIEW-1.6: the latest entries the chat opens with, and the size of a "Show earlier" page. */
export const INITIAL_LIMIT = 100;
export const PAGE_LIMIT = 100;
/** One `--after` poll returns at most this many; `has_more_after` makes the next one start at once. */
export const AFTER_LIMIT = 500;

/** Bounds on what reaches the browser. */
const MAX_TEXT = 200_000;
const MAX_SUMMARY = 200;
const MAX_TOOL = 80;
const MAX_CURSOR = 512;
const MAX_QUESTIONS = 10;
const MAX_OPTIONS = 20;
const MAX_LABEL = 1000;
/** VIEW-10: an option's preview is kept whole or not at all: a cut mockup would mislead. */
const MAX_PREVIEW = 16_000;
const MAX_PREVIEW_LINES = 400;

/** Failure kinds from the contract, plus what can go wrong before Fleet answers. */
export type MessagesFailureKind =
  | 'target_not_found'
  | 'target_ambiguous'
  | 'transcript_not_found'
  | 'harness_unsupported'
  | 'cursor_invalid'
  | 'usage'
  | 'io'
  | 'not_installed'
  | 'unsupported'
  | 'timeout'
  | 'invalid_output'
  /** Lookout cancelled the call (the feed was parked): not a failure to show. */
  | 'cancelled';

const CONTRACT_KINDS = new Set([
  'target_not_found',
  'target_ambiguous',
  'transcript_not_found',
  'harness_unsupported',
  'cursor_invalid',
  'usage',
  'io',
]);

export type MessagesResult =
  | {
      ok: true;
      sessionId: string | null;
      harness: string | null;
      /** The history the chat shows, oldest first: unknown kinds and queued prompts left out. */
      entries: ChatEntry[];
      /** `--after`: entries already shown that changed since (replace them by cursor). */
      updated: ChatEntry[];
      /**
       * Prompts still waiting in the Harness's queue: the full current queue (no-cursor and
       * `--after` responses). Their `q…` cursors aren't positions: never used to page or poll.
       */
      queue: ChatEntry[];
      /** Cursor of the oldest history entry Fleet returned (shown or not), for the next `--before`. */
      oldest: string | null;
      hasMoreBefore: boolean;
      hasMoreAfter: boolean;
      /**
       * The top-level cursor to poll with: the newest position plus Fleet's read hint (it can move
       * without new entries). null for an empty conversation with no `--after`.
       */
      cursor: string | null;
    }
  | { ok: false; kind: MessagesFailureKind; error: string };

export interface MessagesQuery {
  after?: string;
  before?: string;
  limit: number;
}

/** argv for one call. Cursors go in `--opt=value` form, so one starting with `-` is still a value. */
export function messagesArgs(target: string, q: MessagesQuery): string[] {
  const args = ['--local', 'messages', '--json'];
  if (q.after !== undefined) args.push(`--after=${q.after}`);
  if (q.before !== undefined) args.push(`--before=${q.before}`);
  args.push('--limit', String(q.limit), '--', target);
  return args;
}

/** Calls `fleet messages` and classifies the outcome. Never throws. */
export async function fetchMessages(
  runner: Runner,
  bin: string,
  target: string,
  q: MessagesQuery,
  opts: { timeoutMs: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal },
): Promise<MessagesResult> {
  let stdout: string;
  try {
    stdout = await runner(bin, messagesArgs(target, q), { timeoutMs: opts.timeoutMs, env: opts.env, signal: opts.signal });
  } catch (err) {
    const e = err as RunError;
    if (e.aborted) return { ok: false, kind: 'cancelled', error: 'Cancelled.' };
    if (e.code === 'ENOENT') return { ok: false, kind: 'not_installed', error: "Fleet isn't installed." };
    if (e.timedOut) return { ok: false, kind: 'timeout', error: 'Fleet took too long to read the Transcript.' };
    // The contract: exit 1 with one JSON object on stdout, the message on stderr too.
    const parsed = parseJson(e.stdout);
    if (parsed && parsed.ok === false) return failure(parsed);
    const detail = e.stderr?.trim() ?? '';
    if (/unrecognized subcommand|unexpected argument/i.test(detail)) {
      return { ok: false, kind: 'unsupported', error: "This Fleet can't read Transcripts yet (no `fleet messages`)." };
    }
    // Without stderr, say only how it ended: the error message would carry the binary's path.
    const ended = typeof e.code === 'number' ? ` (exit ${e.code})` : '';
    return { ok: false, kind: 'io', error: cleanFleetError(detail) ?? `Fleet failed to read the Transcript${ended}.` };
  }
  const parsed = parseJson(stdout);
  if (!parsed) return { ok: false, kind: 'invalid_output', error: 'Fleet returned something other than JSON.' };
  if (parsed.ok === false) return failure(parsed);
  if (parsed.ok !== true || !Array.isArray(parsed.entries)) {
    return { ok: false, kind: 'invalid_output', error: 'Fleet returned an unexpected answer.' };
  }
  // Queued prompts come last and aren't positions: kept apart from the history.
  const all = parsed.entries as unknown[];
  const raw = all.filter((r) => !isQueued(r));
  const entries = visible(raw);
  const queue = visible(all.filter(isQueued));
  const updated = Array.isArray(parsed.updated) ? visible(parsed.updated.filter((r) => !isQueued(r))) : [];
  return {
    ok: true,
    sessionId: typeof parsed.session_id === 'string' ? parsed.session_id : null,
    harness: typeof parsed.harness === 'string' ? parsed.harness : null,
    entries,
    updated,
    queue,
    oldest: raw.length ? cursorOf(raw[0]) : null,
    hasMoreBefore: parsed.has_more_before === true,
    hasMoreAfter: parsed.has_more_after === true,
    cursor: cursorOf(parsed) ?? (raw.length ? cursorOf(raw[raw.length - 1]) : null),
  };
}

/** A queued prompt: `queued: true`, or a `q…` cursor (never a position). */
function isQueued(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return r.queued === true || (typeof r.cursor === 'string' && r.cursor.startsWith('q'));
}

/** The entries the chat shows, each once (a repeated cursor keeps its first). */
function visible(raw: unknown[]): ChatEntry[] {
  const out: ChatEntry[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const e = toEntry(r);
    if (!e || seen.has(e.cursor)) continue;
    seen.add(e.cursor);
    out.push(e);
  }
  return out;
}

function failure(parsed: Record<string, unknown>): MessagesResult {
  const kind = typeof parsed.kind === 'string' && CONTRACT_KINDS.has(parsed.kind) ? (parsed.kind as MessagesFailureKind) : 'io';
  const fallback = kind === 'transcript_not_found' ? 'No Transcript was found for this Session.' : 'Fleet failed to read the Transcript.';
  return { ok: false, kind, error: cleanFleetError(parsed.error) ?? fallback };
}

function parseJson(text: string | undefined): Record<string, unknown> | null {
  if (!text?.trim()) return null;
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function cursorOf(v: unknown): string | null {
  const c = (v as { cursor?: unknown } | null)?.cursor;
  return typeof c === 'string' && isCursor(c) ? c : null;
}

/** Contract: printable ASCII, at most 512 characters, no leading `-`. */
export function isCursor(c: string): boolean {
  return c.length <= MAX_CURSOR && /^[\x21-\x7e]+$/.test(c) && !c.startsWith('-');
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' ? bound(v, max) : null);
const bound = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** One entry as the chat shows it, or null for one it hides (unknown kinds) or can't read. */
export function toEntry(v: unknown): ChatEntry | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const cursor = cursorOf(r);
  if (!cursor) return null;
  const ts = typeof r.ts === 'string' ? bound(r.ts, 64) : null;
  const text = str(r.kind === 'user' ? unwrapPasted(r.text) : r.text, MAX_TEXT) ?? '';
  switch (r.kind) {
    case 'user':
      return text.trim() ? { kind: 'user', cursor, ts, text, queued: r.queued === true } : null;
    case 'assistant':
      return text.trim() ? { kind: 'assistant', cursor, ts, text, final: r.final === true } : null;
    case 'command':
      return text.trim() ? { kind: 'command', cursor, ts, text } : null;
    case 'system':
      // VIEW-1.3: Claude Code's task notifications (a subagent's result), the only `system` entries Fleet emits.
      return text.trim() ? { kind: 'system', cursor, ts, text } : null;
    case 'tool_call': {
      const tool = str(r.tool, MAX_TOOL);
      if (!tool) return null;
      return { kind: 'tool_call', cursor, ts, id: str(r.id, 200) ?? cursor, tool, summary: oneLine(str(r.summary, MAX_SUMMARY) ?? '') };
    }
    case 'question': {
      const questions = toQuestions(r.questions);
      if (!questions) return null;
      const status = r.status === 'answered' || r.status === 'declined' || r.status === 'abandoned' ? r.status : 'pending';
      return { kind: 'question', cursor, ts, id: str(r.id, 200) ?? cursor, questions, status, answer: toAnswer(r.answer, questions) };
    }
    default:
      return null; // kinds this Lookout doesn't know yet (VIEW-1.3)
  }
}

function toQuestions(v: unknown): ChatQuestion[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: ChatQuestion[] = [];
  for (const q of v.slice(0, MAX_QUESTIONS)) {
    if (typeof q !== 'object' || q === null) return null;
    const r = q as Record<string, unknown>;
    const question = str(r.question, MAX_LABEL);
    if (!question || !Array.isArray(r.options)) return null;
    // Every option stays, even an odd one, so the indexes in `answer.picked` keep pointing at it.
    const options = r.options
      .slice(0, MAX_OPTIONS)
      .map((o) => (typeof o === 'object' && o !== null ? (o as Record<string, unknown>) : {}))
      .map((o) => {
        const option: ChatQuestion['options'][number] = { label: str(o.label, MAX_LABEL) ?? '', description: str(o.description, MAX_LABEL) ?? '' };
        const preview = toPreview(o.preview);
        if (preview === TOO_LONG) option.previewTooLong = true;
        else if (preview !== null) option.preview = preview;
        return option;
      });
    out.push({ question, header: str(r.header, 200) ?? '', multiSelect: r.multiSelect === true, options });
  }
  return out;
}

/**
 * VIEW-10: an option's preview, exactly as Fleet gives it (contract C1: the Transcript's text, never
 * trimmed or rendered), when it's a string of at most 16,000 characters and 400 lines. One over
 * those is never cut: a sentinel marks the option (`previewTooLong`) and its box says so. A
 * blank one, or not a string, is none, as Fleet counts it (C1), so a question has previews in
 * Lookout exactly when Fleet draws it with them (C4).
 */
function toPreview(v: unknown): string | typeof TOO_LONG | null {
  if (typeof v !== 'string' || isBlank(v)) return null;
  if (v.length > MAX_PREVIEW || v.split('\n').length > MAX_PREVIEW_LINES) return TOO_LONG;
  return v;
}

/** Not a string, so a preview whose text is literally `too-long` stays a preview. */
const TOO_LONG = Symbol('too-long');

/** Blank as Rust's `str::trim` has it (Unicode White_Space), which JS `trim()` differs from at U+FEFF. */
const isBlank = (s: string) => /^[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/.test(s);

function toAnswer(v: unknown, questions: ChatQuestion[]): ChatAnswer | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (r.declined === true) return { declined: true };
  if (!Array.isArray(r.answers)) return null;
  const answers = questions.map((_, i) => {
    const a: unknown = (r.answers as unknown[])[i];
    return typeof a === 'string' ? bound(a, MAX_LABEL * 2) : null;
  });
  // `picked[i]`: indexes into questions[i].options; anything else is dropped, not guessed.
  const picked = Array.isArray(r.picked)
    ? questions.map((q, i) => {
        const p: unknown = (r.picked as unknown[])[i];
        if (!Array.isArray(p)) return [];
        return [...new Set(p.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < q.options.length))];
      })
    : null;
  return { answers, picked };
}

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').trim();

/**
 * Fleet's error text before the browser sees it: USAGE's `sanitizeLine` (escapes decoded, the
 * whole text redacted, one bounded line), and tmux reworded (0001).
 */
export function cleanFleetError(text: unknown, max = 200): string | null {
  const line = sanitizeLine(text, max);
  if (line && /tmux|paste-buffer|load-buffer|send-keys|capture-pane/i.test(line)) return 'The Session host could not be read.';
  return line;
}
