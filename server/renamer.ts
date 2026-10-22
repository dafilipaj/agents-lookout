import { checkName } from '../shared/rename.ts';
import type { RenameResult, SessionRow } from '../shared/types.ts';
import { EndError, closeTarget, isPidOnly } from './closer.ts';
import type { RunError, Runner } from './exec.ts';
import type { FleetListResult } from './fleet.ts';
import { cleanEnv } from './launcher.ts';
import { normalizeRows } from './normalize.ts';

/**
 * Fleet's `rename` waits for the Session's typing lock, types, then reads the registry every 400 ms
 * for up to 10 s before it answers `sent`; this leaves room for all of it.
 */
export const RENAME_TIMEOUT_MS = 20_000;

export class RenameError extends Error {
  readonly status: number;
  /** The request field to fix (`title`), for a name that can't be sent; null otherwise. */
  readonly field: string | null;
  constructor(status: number, message: string, field: string | null = null) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

export interface RenamerOptions {
  runner: Runner;
  fleetBin: () => string;
  /** The Session as Fleet listed it in the last poll, or null. */
  lookup(sessionId: string): SessionRow | null;
  /** A `fleet list` made now: the Session is checked again right before it's renamed. */
  freshList(): Promise<FleetListResult>;
  /** After a rename, so the new title reaches the tabs without waiting for the next poll. */
  refresh(): Promise<void>;
  env?: NodeJS.ProcessEnv;
}

const GONE = 'This Session is no longer running, so it wasn’t renamed.';
const OTHER_APP = 'This Session runs in another app, so Lookout can’t rename it.';
const NOT_IDLE = 'The Session isn’t Idle now, so it wasn’t renamed. Try again once it is.';
/** VIEW-5.14: Fleet exited 0 without a report that says `renamed` or `sent`: it may have typed it. */
export const RENAME_UNCLEAR = 'Fleet’s answer didn’t say how the rename went, so Lookout can’t tell whether it was renamed. Check the Session list.';
const NO_ID = 'This Session has no session ID yet, so it can’t be renamed. Rename it after its first prompt.';

/**
 * VIEW-5.14: why Fleet held a rename (its report's `held`), in VIEW-3.7's words for renaming. Fleet's
 * own codes for text in the box and a prompt in its place (`input`, `waiting`); `send`'s for a box
 * it can't find or read, which only `--require-empty` holds on; `busy` for a Codex turn running.
 */
export const RENAME_HELD: Readonly<Record<string, string>> = {
  input: 'The Session’s input box holds text, so it wasn’t renamed. Send or clear it in the terminal, then try again.',
  waiting: 'The Session is waiting on a prompt, so it wasn’t renamed. Answer it, then try again.',
  no_input_box:
    'The Session’s input box isn’t on screen (a panel, a menu or the transcript view is open), so it wasn’t renamed. Press Esc to close it, then try again.',
  unreadable: 'Fleet can’t read the Session’s input box, so it wasn’t renamed. Rename it with /rename in the terminal instead.',
  busy: 'The Session is working, so it wasn’t renamed. Try again once it’s Idle.',
};
export const RENAME_HELD_OTHER = 'Fleet held the rename, so it wasn’t renamed. Check the terminal.';

/** VIEW-5.12: the request body, `{ title }`, checked as the tab checks it (`shared/rename.ts`). */
export function parseRenameRequest(body: unknown): string {
  const title = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>).title : undefined;
  if (typeof title !== 'string') throw new RenameError(400, 'Invalid name.', 'title');
  const checked = checkName(title);
  if (!checked.ok) throw new RenameError(400, checked.message, 'title');
  return checked.name;
}

/**
 * VIEW-5.12–5.14: renames a live, Controllable, Idle Session through Fleet's `rename`, which types the
 * Harness's own `/rename` only into an empty input box (`--require-empty`) and keeps the Session
 * host's name in step. The target is always exact (`id:<session_id>`): a Session without a session
 * ID isn't renamed. The new title comes back through `fleet list`, polled at once afterwards.
 */
export async function renameSession(opts: RenamerOptions, sessionId: string, name: string): Promise<RenameResult> {
  const known = opts.lookup(sessionId);
  if (!known) throw new RenameError(404, 'This Session isn’t running.');
  if (isPidOnly(known)) throw new RenameError(409, NO_ID);
  if (!known.controllable) throw new RenameError(409, OTHER_APP);
  // Read again right before typing: it could have ended, started a turn, or begun waiting on you.
  const fresh = await opts.freshList();
  if (fresh.kind !== 'ok') throw new RenameError(503, 'Couldn’t check that the Session is still running, so it wasn’t renamed. Try again.');
  const row = normalizeRows(fresh.rows, { git: () => null, statusSince: () => null }).find((r) => r.id === known.id && r.harness === known.harness);
  if (!row) throw new RenameError(409, GONE);
  if (!row.controllable) throw new RenameError(409, OTHER_APP);
  if (row.status !== 'idle') throw new RenameError(409, NOT_IDLE);

  let target: string;
  try {
    target = closeTarget(row); // `id:<session_id>`, checked before it goes anywhere near argv
  } catch (err) {
    if (err instanceof EndError) throw new RenameError(err.status, err.message);
    throw err;
  }
  let stdout: string;
  try {
    stdout = await opts.runner(opts.fleetBin(), ['--local', 'rename', '--json', '--require-empty', '--', target, name], {
      timeoutMs: RENAME_TIMEOUT_MS,
      env: cleanEnv(opts.env ?? process.env),
    });
  } catch (err) {
    throw failure(err as RunError);
  }
  // Exit 0: Fleet typed it, or may have. Only its own report says which: `renamed` or `sent`.
  const answer = parseObject(stdout);
  const result = answer?.ok === true && (answer.result === 'renamed' || answer.result === 'sent') ? answer.result : null;
  // Polled either way: if it was renamed, the new title reaches the tabs at once.
  await opts.refresh().catch(() => {});
  if (result === null) throw new RenameError(502, RENAME_UNCLEAR);
  return { result };
}

/**
 * Why a rename failed, for people. Only `held` and `kind` are read: Fleet's `error`, `message`,
 * `from` and `tmux` can name the Session host, so none of its text is shown (0001).
 */
function failure(e: RunError): RenameError {
  if (e.code === 'ENOENT') return new RenameError(503, 'Fleet isn’t installed, so the Session wasn’t renamed.');
  if (e.timedOut) return new RenameError(504, 'Fleet took too long, so Lookout can’t tell whether it was renamed. Check the Session list.');
  const parsed = parseObject(e.stdout);
  if (parsed && (parsed.result === 'held' || e.code === 3)) {
    const held = parsed.held;
    return new RenameError(409, typeof held === 'string' && Object.hasOwn(RENAME_HELD, held) ? RENAME_HELD[held]! : RENAME_HELD_OTHER);
  }
  switch (parsed?.kind) {
    case 'busy':
      return new RenameError(409, 'Fleet is typing into it; try again.');
    case 'target_not_found':
      return new RenameError(409, GONE);
    case 'target_ambiguous':
    case 'target_invalid':
      return new RenameError(409, 'Fleet couldn’t tell which Session this is, so it wasn’t renamed.');
    case 'backend_unsupported':
      return new RenameError(409, 'Lookout can’t reach this Session’s terminal, so it wasn’t renamed.');
  }
  const stderr = e.stderr ?? '';
  // A Fleet before the fork's `--require-empty` for `rename` types nothing: clap refuses the flag.
  if (/unexpected argument '--require-empty'/i.test(stderr)) {
    return new RenameError(501, 'This Fleet can’t check the Session’s input box before renaming, so it wasn’t renamed. Update the Fleet fork.');
  }
  if (/unrecognized subcommand/i.test(stderr)) return new RenameError(501, 'This Fleet can’t rename Sessions yet. Update the Fleet fork.');
  return new RenameError(502, 'Couldn’t rename it. Check the terminal.');
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
