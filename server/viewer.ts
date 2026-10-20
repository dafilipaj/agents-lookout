import { asSent } from '../shared/message.ts';
import { HELD_REASONS, type AnswerRequest, type AnswerResult, type ChatPage, type EscStatus, type HeldReason, type ServerEvent, type SessionRow } from '../shared/types.ts';
import { type AnswerLedger, type AnswererOptions, PromptWatch, answerPrompt, stopSession } from './answerer.ts';
import { ChatFeed } from './chat.ts';
import { isCursor } from './messages.ts';
import type { RunError, Runner } from './exec.ts';
import type { FleetListResult } from './fleet.ts';
import { cleanEnv } from './launcher.ts';

/** VIEW-2.1: the drawer shows this many terminal lines, refreshed this often. */
export const PREVIEW_LINES = 40;
export const PREVIEW_INTERVAL_MS = 1000;
/** VIEW-3: the longest message the composer may send. */
export const MAX_MESSAGE = 100_000;

const PEEK_TIMEOUT_MS = 4000;
const SEND_TIMEOUT_MS = 15_000;

export class ViewError extends Error {
  readonly status: number;
  readonly field: string | null;
  /** VIEW-3.7: Fleet held the send (`send_held`), and why; `reason` is null for one Lookout doesn't know. */
  readonly held: { reason: HeldReason | null } | null;
  constructor(status: number, message: string, field: string | null = null, held: { reason: HeldReason | null } | null = null) {
    super(message);
    this.status = status;
    this.field = field;
    this.held = held;
  }
}

/** VIEW-3.7: what a held send says, by Fleet's reason (VIEW-6.6's words). Never what the box holds. */
export const HELD_MESSAGE: Readonly<Record<HeldReason, string>> = {
  text: "The Session's input box already holds text, so nothing was sent. Send or clear it in the terminal, then try again.",
  prompt: 'The Session is waiting on a prompt, so nothing was sent. Answer it, then try again.',
  no_input_box: "The Session's input box isn't on screen (a panel, a menu or the transcript view is open), so nothing was sent. Press Esc to close it, then try again.",
  unreadable: "Fleet can't read the Session's input box, so nothing was sent. Send it from the terminal instead.",
};
export const HELD_OTHER = 'Fleet held the message, so nothing was sent. Check the terminal.';
export const OLD_FLEET_SEND = "This Fleet can't check the Session's input box before sending, so nothing was sent. Update the Fleet fork.";

/**
 * How Fleet should find a Session: its full session id, or its pid when it has none (a Codex
 * Session before its first prompt). Fleet tries an exact match first, but a target nothing
 * matches exactly falls through to prefix and fuzzy matching on titles; so a pid target is
 * checked against a fresh list right before use (see `Viewer.target`).
 */
export function fleetTarget(row: SessionRow): string {
  return isPidTarget(row) ? String(row.pid) : row.id;
}

function isPidTarget(row: SessionRow): boolean {
  return row.id.startsWith(`${row.harness}:`);
}

/**
 * C0 control characters and DEL that would turn into keypresses. One line is typed, so a tab
 * would be Tab too; multi-line text is pasted, so tabs (Makefiles, Go, TSV) arrive intact.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_TYPED = /[\u0000-\u0009\u000b-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex -- as above, but a pasted tab is fine
const CONTROL_PASTED = /[\u0000-\u0008\u000b-\u001f\u007f]/;

interface Watch {
  sessionId: string | null;
  preview: boolean;
}

interface Poller {
  timer: NodeJS.Timeout | null;
  /** The last result, so a tab that starts watching gets it at once and repeats aren't sent. */
  last: { text: string | null; error: string | null } | null;
  stopped: boolean;
}

export interface ViewerOptions {
  runner: Runner;
  fleetBin: () => string;
  /** The Session as Fleet currently lists it, or null. */
  lookup(sessionId: string): SessionRow | null;
  /** A `fleet list` made now, to check a pid target right before it's used. */
  freshList(): Promise<FleetListResult>;
  /** Pushes an event to one tab's event stream. */
  sendTo(clientId: string, event: ServerEvent): void;
  /**
   * VIEW-4: what every tab answered or stopped, per Session. The prompt reads and the Viewer's own
   * `answer` and `stopSession` use it, so the answer routes can't be wired with another.
   */
  ledger: AnswerLedger;
  env?: NodeJS.ProcessEnv;
  intervalMs?: number;
}

/**
 * Follows the Sessions that tabs are viewing (VIEW): the chat of every viewed Session (VIEW-1,
 * see ChatFeed), the prompt it Needs you on (VIEW-4, see PromptWatch), and the terminal preview,
 * one `fleet peek` per second per Session, only while some tab has its drawer open. Answers and
 * Stop go through it too (VIEW-4), so they share the prompt reads' ledger.
 */
export class Viewer {
  private readonly watches = new Map<string, Watch>();
  private readonly pollers = new Map<string, Poller>();
  private readonly opts: ViewerOptions;
  private readonly chat: ChatFeed;
  private readonly prompts: PromptWatch;
  private readonly answerer: AnswererOptions;

  constructor(opts: ViewerOptions) {
    this.opts = opts;
    this.prompts = new PromptWatch({
      runner: opts.runner,
      fleetBin: opts.fleetBin,
      lookup: opts.lookup,
      sendTo: opts.sendTo,
      ledger: opts.ledger,
      env: opts.env,
      intervalMs: opts.intervalMs,
    });
    this.answerer = { runner: opts.runner, fleetBin: opts.fleetBin, lookup: opts.lookup, freshList: opts.freshList, ledger: opts.ledger, env: opts.env };
    this.chat = new ChatFeed({
      runner: opts.runner,
      fleetBin: opts.fleetBin,
      env: () => this.env,
      lookup: opts.lookup,
      target: (row) => this.target(row),
      sendTo: opts.sendTo,
      intervalMs: opts.intervalMs,
    });
  }

  private get env() {
    return cleanEnv(this.opts.env ?? process.env);
  }

  /** What one tab is viewing, and whether its terminal drawer is open. */
  watch(clientId: string, sessionId: string | null, preview: boolean): void {
    this.watches.set(clientId, { sessionId, preview: preview && sessionId !== null });
    this.reconcile();
    this.chat.view(clientId, sessionId);
    this.prompts.view(clientId, sessionId);
    const poller = sessionId ? this.pollers.get(sessionId) : undefined;
    if (preview && sessionId && poller?.last) this.opts.sendTo(clientId, { type: 'preview', sessionId, ...poller.last });
  }

  /** A tab went away. */
  drop(clientId: string): void {
    this.watches.delete(clientId);
    this.reconcile();
    this.chat.drop(clientId);
    this.prompts.drop(clientId);
  }

  /** Session ids being previewed (for tests and diagnostics). */
  previewing(): string[] {
    return [...this.pollers.keys()];
  }

  /** Session ids whose chat is followed (for tests and diagnostics). */
  following(): string[] {
    return this.chat.following();
  }

  /** Session ids whose prompt is read (VIEW-4.2; for tests and diagnostics). */
  promptsFollowing(): string[] {
    return this.prompts.following();
  }

  /** VIEW-4.1–4.3: answers the prompt a tab read (see `answerPrompt`), against the ledger its reads carry. */
  answer(sessionId: string, req: AnswerRequest): Promise<AnswerResult> {
    return answerPrompt(this.answerer, sessionId, req);
  }

  /** VIEW-4.4/4.5: one Esc for a Session in `status`: Stop while Busy, the Esc button while it Needs you (see `stopSession`). */
  stopSession(sessionId: string, status: EscStatus = 'busy'): Promise<void> {
    return stopSession(this.answerer, sessionId, status);
  }

  stop(): void {
    this.prompts.stop();
    for (const p of this.pollers.values()) {
      p.stopped = true;
      if (p.timer) clearTimeout(p.timer);
    }
    this.pollers.clear();
    this.chat.stop();
  }

  /** VIEW-1.6: "Show earlier": the entries before `cursor`, a cursor Lookout sent to the tab. */
  async earlier(sessionId: string, cursor: unknown): Promise<ChatPage> {
    // A position cursor as the contract has them: printable ASCII, no leading `-`, never a queued `q…` one.
    if (typeof cursor !== 'string' || !isCursor(cursor) || cursor.startsWith('q')) {
      throw new ViewError(400, 'Invalid cursor.', 'before');
    }
    const res = await this.chat.earlier(sessionId, cursor);
    if (!res.ok) throw new ViewError(res.status, res.error);
    return res.page;
  }

  /**
   * VIEW-3: `fleet send` types the text into the Session (a paste when it has line breaks)
   * and submits it. Only for a Session Fleet lists right now as Controllable. VIEW-3.7: only into
   * an empty input box (`--require-empty`); Fleet holds the send otherwise, and nothing is typed.
   */
  async send(sessionId: string, input: unknown): Promise<void> {
    const raw = typeof input === 'object' && input !== null ? (input as Record<string, unknown>).text : undefined;
    if (typeof raw !== 'string' || raw.includes('\0')) throw new ViewError(400, 'Invalid message.', 'text');
    const text = asSent(raw); // the tab compares its message with the Transcript's copy this way (VIEW-1.13)
    const pasted = text.includes('\n'); // Fleet pastes multi-line text and types a single line
    if ((pasted ? CONTROL_PASTED : CONTROL_TYPED).test(text)) {
      throw new ViewError(400, "The message has control characters that can't be sent.", 'text');
    }
    if (text.trim() === '') throw new ViewError(400, 'Type a message first.', 'text');
    if (text.length > MAX_MESSAGE) throw new ViewError(413, 'The message is too long.', 'text');
    const row = this.controllable(sessionId);
    const target = await this.target(row);
    try {
      // Exit 0 is sent, whatever stdout says: the text was typed.
      await this.opts.runner(this.opts.fleetBin(), ['--local', 'send', '--json', '--require-empty', '--', target, text], {
        timeoutMs: SEND_TIMEOUT_MS,
        env: this.env,
      });
    } catch (err) {
      throw sendFailure(err as RunError);
    }
  }

  private controllable(sessionId: string): SessionRow {
    const row = this.opts.lookup(sessionId);
    if (!row) throw new ViewError(404, "This Session isn't running.");
    if (!row.controllable) throw new ViewError(409, "This Session runs in another app, so Lookout can't type into it.");
    return row;
  }

  /**
   * The target to give Fleet. A session id is matched exactly, and the caller has just found
   * it in the latest list. A pid is checked against a fresh `fleet list` first: if that pid is
   * gone, Fleet would fall through to fuzzy title matching and could type into another Session.
   */
  private async target(row: SessionRow): Promise<string> {
    if (!isPidTarget(row)) return row.id;
    const list = await this.opts.freshList();
    if (list.kind !== 'ok') throw new ViewError(503, "Couldn't check that the Session is still running. Try again.");
    if (!list.rows.some((r) => r.pid === row.pid && r.harness === row.harness)) {
      throw new ViewError(409, 'This Session is no longer running, so nothing was sent.');
    }
    return String(row.pid);
  }

  private reconcile(): void {
    const wanted = new Set<string>();
    for (const w of this.watches.values()) if (w.preview && w.sessionId) wanted.add(w.sessionId);
    for (const [id, p] of this.pollers) {
      if (wanted.has(id)) continue;
      p.stopped = true;
      if (p.timer) clearTimeout(p.timer);
      this.pollers.delete(id);
    }
    for (const id of wanted) {
      if (this.pollers.has(id)) continue;
      const poller: Poller = { timer: null, last: null, stopped: false };
      this.pollers.set(id, poller);
      void this.poll(id, poller);
    }
  }

  private async poll(sessionId: string, poller: Poller): Promise<void> {
    let result: { text: string | null; error: string | null } = { text: null, error: null };
    const row = this.opts.lookup(sessionId);
    if (!row) result = { text: null, error: "This Session isn't running." };
    else if (!row.controllable) result = { text: null, error: 'No terminal preview for a Session in another app.' };
    else {
      let target: string | null = null;
      try {
        target = await this.target(row);
      } catch (err) {
        // Gone: nothing to show. The check itself failing (503): keep the last screen, as a failed
        // peek does, and say so.
        const gone = err instanceof ViewError && err.status === 409;
        const message = err instanceof ViewError ? err.message.replace(', so nothing was sent', '') : 'Preview failed.';
        result = { text: gone ? null : (poller.last?.text ?? null), error: message };
      }
      if (target !== null) {
        try {
          const out = await this.opts.runner(
            this.opts.fleetBin(),
            ['--local', 'peek', '--lines', String(PREVIEW_LINES), '--', target],
            { timeoutMs: PEEK_TIMEOUT_MS, env: this.env },
          );
          result = { text: out.replace(/\s+$/, ''), error: null };
        } catch (err) {
          result = { text: poller.last?.text ?? null, error: `Preview failed: ${reason(err, "the Session host couldn't be read.")}` };
        }
      }
    }
    if (poller.stopped) return;
    const changed = JSON.stringify(result) !== JSON.stringify(poller.last);
    poller.last = result;
    if (changed) {
      for (const [clientId, w] of this.watches) {
        if (w.preview && w.sessionId === sessionId) this.opts.sendTo(clientId, { type: 'preview', sessionId, ...result });
      }
    }
    // The next peek starts a second after this one ended, so they never overlap.
    poller.timer = setTimeout(() => void this.poll(sessionId, poller), this.opts.intervalMs ?? PREVIEW_INTERVAL_MS);
    poller.timer.unref?.();
  }
}

/**
 * Why a send failed. VIEW-3.7: a held one (`send_held`) says why by its reason, in Lookout's own
 * words; Fleet's `input` (what the box holds, maybe a secret) and `error` are never used. A Fleet
 * without the flags types nothing, and says so. Anything else is Fleet's reason, as before.
 */
function sendFailure(e: RunError): ViewError {
  const held = heldReason(e.stdout);
  if (held !== undefined) return new ViewError(409, held ? HELD_MESSAGE[held] : HELD_OTHER, null, { reason: held });
  if (e.code !== 'ENOENT' && !e.timedOut && /unexpected argument '--(json|require-empty)'/i.test(e.stderr ?? '')) {
    return new ViewError(501, OLD_FLEET_SEND);
  }
  return new ViewError(502, `Couldn't send: ${reason(e, 'the Session host refused the message.')}`);
}

/** A held send's reason: undefined when it wasn't held, null for a reason Lookout doesn't know. Only `kind` and `reason` are read. */
function heldReason(stdout: string | undefined): HeldReason | null | undefined {
  if (!stdout?.trim()) return undefined;
  let v: unknown;
  try {
    v = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof v !== 'object' || v === null || (v as { kind?: unknown }).kind !== 'send_held') return undefined;
  const r = (v as { reason?: unknown }).reason;
  return HELD_REASONS.find((h) => h === r) ?? null;
}

/** A reason for people. Anything from tmux is reworded: the UI never names tmux (0001). */
function reason(err: unknown, hostRefused: string): string {
  const e = err as RunError;
  if (e.code === 'ENOENT') return "Fleet isn't installed.";
  if (e.timedOut) return 'Fleet took too long.';
  const text = ((e.stderr?.trim() || e.message || 'unknown error').split('\n')[0] ?? '').replace(/^error:\s*/i, '');
  return /tmux|paste-buffer|load-buffer|send-keys|capture-pane/i.test(text) ? hostRefused : text;
}
