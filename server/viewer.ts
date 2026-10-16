import type { ServerEvent, SessionRow } from '../shared/types.ts';
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
  constructor(status: number, message: string, field: string | null = null) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

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
const TAB_AS_SPACES = '    ';

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
  env?: NodeJS.ProcessEnv;
  intervalMs?: number;
}

/**
 * Follows the Sessions that tabs are viewing (VIEW). Today that's the terminal preview: one
 * `fleet peek` per second per Session, and only while some tab has its drawer open.
 */
export class Viewer {
  private readonly watches = new Map<string, Watch>();
  private readonly pollers = new Map<string, Poller>();
  private readonly opts: ViewerOptions;

  constructor(opts: ViewerOptions) {
    this.opts = opts;
  }

  private get env() {
    return cleanEnv(this.opts.env ?? process.env);
  }

  /** What one tab is viewing, and whether its terminal drawer is open. */
  watch(clientId: string, sessionId: string | null, preview: boolean): void {
    this.watches.set(clientId, { sessionId, preview: preview && sessionId !== null });
    this.reconcile();
    const poller = sessionId ? this.pollers.get(sessionId) : undefined;
    if (preview && sessionId && poller?.last) this.opts.sendTo(clientId, { type: 'preview', sessionId, ...poller.last });
  }

  /** A tab went away. */
  drop(clientId: string): void {
    this.watches.delete(clientId);
    this.reconcile();
  }

  /** Session ids being previewed (for tests and diagnostics). */
  previewing(): string[] {
    return [...this.pollers.keys()];
  }

  stop(): void {
    for (const p of this.pollers.values()) {
      p.stopped = true;
      if (p.timer) clearTimeout(p.timer);
    }
    this.pollers.clear();
  }

  /**
   * VIEW-3: `fleet send` types the text into the Session (a paste when it has line breaks)
   * and submits it. Only for a Session Fleet lists right now as Controllable.
   */
  async send(sessionId: string, input: unknown): Promise<void> {
    const raw = typeof input === 'object' && input !== null ? (input as Record<string, unknown>).text : undefined;
    if (typeof raw !== 'string' || raw.includes('\0')) throw new ViewError(400, 'Invalid message.', 'text');
    let text = raw.replace(/\r\n?/g, '\n');
    const pasted = text.includes('\n'); // Fleet pastes multi-line text and types a single line
    if (!pasted) text = text.replace(/\t/g, TAB_AS_SPACES);
    if ((pasted ? CONTROL_PASTED : CONTROL_TYPED).test(text)) {
      throw new ViewError(400, "The message has control characters that can't be sent.", 'text');
    }
    if (text.trim() === '') throw new ViewError(400, 'Type a message first.', 'text');
    if (text.length > MAX_MESSAGE) throw new ViewError(413, 'The message is too long.', 'text');
    const row = this.controllable(sessionId);
    const target = await this.target(row);
    try {
      await this.opts.runner(this.opts.fleetBin(), ['--local', 'send', '--', target, text], {
        timeoutMs: SEND_TIMEOUT_MS,
        env: this.env,
      });
    } catch (err) {
      throw new ViewError(502, `Couldn't send: ${reason(err, 'the Session host refused the message.')}`);
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

/** A reason for people. Anything from tmux is reworded: the UI never names tmux (0001). */
function reason(err: unknown, hostRefused: string): string {
  const e = err as RunError;
  if (e.code === 'ENOENT') return "Fleet isn't installed.";
  if (e.timedOut) return 'Fleet took too long.';
  const text = ((e.stderr?.trim() || e.message || 'unknown error').split('\n')[0] ?? '').replace(/^error:\s*/i, '');
  return /tmux|paste-buffer|load-buffer|send-keys|capture-pane/i.test(text) ? hostRefused : text;
}
