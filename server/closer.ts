import type { EndResult, EndTarget, Harness, SessionRow } from '../shared/types.ts';
import type { RunError, Runner } from './exec.ts';
import type { FleetListResult } from './fleet.ts';
import { SESSION_ID } from './history.ts';
import { cleanEnv } from './launcher.ts';
import { normalizeRows, procStart } from './normalize.ts';
import { sanitizeLine } from './sanitize.ts';

/**
 * Fleet's `close` waits up to ~3 s for a busy Session to settle and 5 s (its `--timeout`) for the
 * Harness to exit, then kills the Session host; this leaves room for both.
 */
const CLOSE_TIMEOUT_MS = 20_000;

export class EndError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface CloserOptions {
  runner: Runner;
  fleetBin: () => string;
  /** The Session as Fleet listed it in the last poll, or null. */
  lookup(sessionId: string): SessionRow | null;
  /** A `fleet list` made now: the Session is checked again right before it's closed. */
  freshList(): Promise<FleetListResult>;
  /** After a close, so the Session's end reaches the tabs without waiting for the next poll. */
  refresh(): Promise<void>;
  env?: NodeJS.ProcessEnv;
}

/**
 * VIEW-5.6: ends a Controllable Session through the Fleet fork's `fleet close <target> --json`
 * (contract in docs/features/session-view/SPEC.md, Technical approach). Only a Session that's
 * alone in its own tmux session, as far as `fleet list` tells; Fleet's `host_shared` is the
 * backstop for what the list can't tell (another window or pane in that tmux session).
 *
 * `expect` is the process the user confirmed (its pid and start time, from the row the dialog
 * opened on). A replacement, a resume under a new process or a reused pid, is refused here and,
 * atomically, by Fleet (`--expect-pid`/`--expect-start`, `target_changed`).
 */
export async function endSession(opts: CloserOptions, sessionId: string, expect: EndTarget): Promise<EndResult> {
  // A Codex Session asked for by pid may have got its session id since the dialog opened; it's
  // still the same process, found below by pid and Harness (the start-time check guards it).
  const known = opts.lookup(sessionId) ?? pidOnlyId(sessionId);
  if (!known) throw new EndError(404, "This Session isn't running.");
  // Without a start time Lookout can't tell this process from a replacement with the same pid.
  if (expect.procStart === null) throw new EndError(409, UNCONFIRMED);
  // Read again right before closing: the Session could have ended, or another moved in with it.
  const fresh = await opts.freshList();
  if (fresh.kind !== 'ok') throw new EndError(503, "Couldn't check that the Session is still running. Try again.");
  const row = normalizeRows(fresh.rows, { git: () => null, statusSince: () => null }).find((r) =>
    isPidOnly(known) ? r.pid === known.pid && r.harness === known.harness : r.id === known.id && r.harness === known.harness,
  );
  if (!row) throw new EndError(409, 'This Session is no longer running.');
  if (row.procStart === null) throw new EndError(409, UNCONFIRMED);
  if (row.pid !== expect.pid || row.procStart !== expect.procStart) throw new EndError(409, CHANGED);
  if (!row.controllable) throw new EndError(409, "This Session runs in another app, so Lookout can't end it.");
  if (!row.ownHost) throw new EndError(409, SHARED);

  const target = closeTarget(row);
  let stdout: string;
  try {
    stdout = await opts.runner(
      opts.fleetBin(),
      ['--local', 'close', target, '--json', '--expect-pid', String(expect.pid), '--expect-start', expect.procStart],
      { timeoutMs: CLOSE_TIMEOUT_MS, env: cleanEnv(opts.env ?? process.env) },
    );
  } catch (err) {
    throw failure(err as RunError);
  }
  const answer = parseObject(stdout);
  if (answer?.ok !== true) throw new EndError(502, "Couldn't end it: Fleet gave an unexpected answer.");
  await opts.refresh().catch(() => {});
  return { how: answer.how === 'killed' ? 'killed' : 'exit' };
}

/**
 * VIEW-5.6: the request body, `{ pid, procStart }`, checked before it goes anywhere near argv:
 * a positive pid and a start time in Fleet's form (or null, which `endSession` refuses).
 */
export function parseEndTarget(body: unknown): EndTarget {
  const b = (typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  if (typeof b.pid !== 'number' || !Number.isSafeInteger(b.pid) || b.pid <= 0) throw new EndError(400, 'Invalid process id.');
  if (b.procStart === null) return { pid: b.pid, procStart: null };
  const start = procStart(b.procStart);
  if (start === null) throw new EndError(400, 'Invalid process start time.');
  return { pid: b.pid, procStart: start };
}

/**
 * Fleet's exact target: `id:<session_id>`, or `pid:<n>` for a Session without one (a Codex
 * Session before its first prompt). Checked here, before it goes anywhere near argv.
 */
export function closeTarget(row: Pick<SessionRow, 'id' | 'pid' | 'harness'>): string {
  if (isPidOnly(row)) {
    if (!Number.isSafeInteger(row.pid) || row.pid <= 0) throw new EndError(400, 'Invalid process id.');
    return `pid:${row.pid}`;
  }
  if (!SESSION_ID.test(row.id)) throw new EndError(400, 'Invalid session id.');
  return `id:${row.id}`;
}

const isPidOnly = (row: Pick<SessionRow, 'id' | 'harness'>) => row.id.startsWith(`${row.harness}:`);

/** `codex:<pid>` (or `claude:<pid>`), the id Lookout gives a Session without a session id. */
function pidOnlyId(id: string): Pick<SessionRow, 'id' | 'harness' | 'pid'> | null {
  const m = /^(claude|codex):([1-9]\d{0,9})$/.exec(id);
  if (!m) return null;
  const pid = Number(m[2]);
  return Number.isSafeInteger(pid) ? { id, harness: m[1] as Harness, pid } : null;
}

const UNCONFIRMED = 'Lookout can’t confirm it’s the same Session, so it won’t end it. Close it in the terminal.';
const CHANGED = 'This Session was restarted since you asked; nothing was closed.';
const SHARED = 'This Session shares its Session host with other windows, so Lookout won’t end it. Close it in the terminal.';

/** Fleet's failure kinds, for people. Nothing names tmux (0001). */
function failure(e: RunError): EndError {
  if (e.code === 'ENOENT') return new EndError(503, "Couldn't end it: Fleet isn't installed.");
  if (e.timedOut) return new EndError(504, "Couldn't end it: Fleet took too long. Check the Session list before trying again.");
  const parsed = parseObject(e.stdout);
  switch (parsed?.kind) {
    case 'busy':
      return new EndError(409, 'Fleet is typing into it; try again.');
    case 'host_shared':
      return new EndError(409, SHARED);
    case 'backend_unsupported':
      return new EndError(409, 'Lookout can only end a Session that runs in a Session host of its own. Close this one in its terminal.');
    case 'target_not_found':
      return new EndError(409, 'This Session is no longer running.');
    case 'target_changed':
      return new EndError(409, CHANGED);
  }
  // A Fleet without `close` (an older fork build) says so in clap's words.
  if (/unrecognized subcommand/i.test(e.stderr ?? '')) return new EndError(501, 'This Fleet can’t end Sessions yet. Update the Fleet fork.');
  const text = typeof parsed?.error === 'string' ? parsed.error : (e.stderr ?? e.message);
  const line = sanitizeLine(text, 200)?.replace(/^error:\s*/i, '');
  const reason = !line ? 'no details' : /tmux|kill-session|send-keys/i.test(line) ? 'the Session host refused' : line;
  return new EndError(502, `Couldn't end it: ${reason}.`.replace(/\.\.$/, '.'));
}

function parseObject(text: string | undefined): Record<string, unknown> | null {
  if (!text?.trim()) return null;
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
