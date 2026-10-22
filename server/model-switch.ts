import { MODEL_ID } from '../shared/model.ts';
import { HELD_REASONS, type HarnessOption, type HeldReason, type ModelSwitchRequest, type ModelSwitchResult, type PendingModel, type SessionRow } from '../shared/types.ts';
import { EndError, FLEET_TYPING, closeTarget, parseEndTarget } from './closer.ts';
import type { RunError, Runner } from './exec.ts';
import { type FleetListResult, type FleetRow, fleetObject } from './fleet.ts';
import { cleanEnv } from './launcher.ts';
import { freshRow, sessionId } from './normalize.ts';

/**
 * Fleet's `model` waits for the Session's typing lock, types `/model <id>`, then reads the screen
 * and the Transcript for up to 5 s (2 s more after a confirmation); this leaves room for all of it.
 */
export const MODEL_TIMEOUT_MS = 20_000;

export class ModelSwitchError extends Error {
  readonly status: number;
  /**
   * VIEW-6.8: Lookout can't be sure what happened (it may have switched, or left something open in
   * the terminal): the tab opens the Terminal preview. Claude Code's saved default may have changed
   * too, so LAUNCH's cached list goes.
   */
  readonly uncertain: boolean;
  constructor(status: number, message: string, uncertain = false) {
    super(message);
    this.status = status;
    this.uncertain = uncertain;
  }
}

/** A process: its pid and Fleet's start time for it. */
interface Proc {
  pid: number;
  procStart: string | null;
}

/** Transcript times (RFC 3339) compared as instants; one that can't be read is never later. */
function later(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) && x > y;
}

/**
 * A Session process's key (pid and `procStart`). `/clear` gives the same process a new session id,
 * so a new row, and a switch still holds there: what the server keeps goes by process, not by row.
 */
function procKey(p: Proc): string | null {
  return p.procStart === null ? null : `${p.pid}\0${p.procStart}`;
}

/**
 * VIEW-6.3/6.7: the server's side of model switches, in memory, per Session process. One switch per
 * process at a time, whichever tab asks; and the model a switch moved it to, until Fleet's
 * `model_at` shows a reply after it (`pendingModel`, sent with the process's row, whatever its
 * session id).
 *
 * A switch's answer installs the pending model only while its process is still listed and the
 * latest `model_at` listed for it isn't already later than the switch: checked and set in one step,
 * so a late answer brings back nothing. The next switch of a process can begin only once the last
 * one's answer is in (`settle` comes before `end`), so an answer is always its process's latest.
 */
export class ModelSwitches {
  private readonly running = new Set<string>();
  private readonly pending = new Map<string, PendingModel>();
  /** Each listed Session process's latest `model_at`, as the last list showed it. */
  private listed = new Map<string, string | null>();

  /** A switch starts for this process: false while another one runs. */
  begin(proc: Proc): boolean {
    const key = procKey(proc);
    if (key === null || this.running.has(key)) return false;
    this.running.add(key);
    return true;
  }

  end(proc: Proc): void {
    const key = procKey(proc);
    if (key !== null) this.running.delete(key);
  }

  /** Fleet says the switch is done: from the next reply on, `model`. True when it's now pending. */
  settle(proc: Proc, model: string, since: string): boolean {
    const key = procKey(proc);
    if (key === null || !this.listed.has(key) || later(this.listed.get(key), since)) return false;
    this.pending.set(key, { model, since });
    return true;
  }

  /**
   * Every list (`raw` its rows, `rows` them normalized): a pending model goes once a reply after the
   * switch has reached the Transcript, whatever its model, or once its process ends or changes.
   */
  observe(rows: readonly SessionRow[], raw: readonly FleetRow[]): void {
    const modelAt = new Map(raw.map((r) => [`${r.harness}\0${sessionId(r)}`, typeof r.model_at === 'string' ? r.model_at : null]));
    const listed = new Map<string, string | null>();
    for (const r of rows) {
      const key = procKey(r);
      if (key === null) continue;
      const at = modelAt.get(`${r.harness}\0${r.id}`) ?? null;
      const seen = listed.get(key) ?? null;
      listed.set(key, at !== null && (seen === null || later(at, seen)) ? at : seen);
    }
    this.listed = listed;
    for (const [key, p] of this.pending) {
      if (!listed.has(key) || later(listed.get(key), p.since)) this.pending.delete(key);
    }
  }

  /** What the row carries as `pendingModel`: its process's, whichever session id it has now. */
  pendingFor(row: SessionRow): PendingModel | null {
    const key = procKey(row);
    return (key !== null && this.pending.get(key)) || null;
  }
}

export interface ModelSwitcherOptions {
  runner: Runner;
  fleetBin: () => string;
  /** The Session as Fleet listed it in the last poll, or null. */
  lookup(sessionId: string): SessionRow | null;
  /** A `fleet list` made now: the Session is checked again right before the switch. */
  freshList(): Promise<FleetListResult>;
  /** LAUNCH's cached `harness list` (LAUNCH-3.2): the models a Session may be switched to. */
  harnesses(): Promise<HarnessOption[]>;
  /** The switch may have changed Claude Code's saved default: LAUNCH's cached list goes. */
  dropHarnesses(): void;
  switches: ModelSwitches;
  /** The rows went out again with their `pendingModel` (the monitor re-derives them from its last list). */
  changed(): void;
  /** After a switch, a list made at once. */
  refresh(): Promise<void>;
  env?: NodeJS.ProcessEnv;
}

const OTHER_APP = 'This Session runs in another app, so Lookout can’t switch its model.';
/** VIEW-6.2: Fleet reads the input box only in its own terminal host (tmux), which is never named. */
const ITERM = 'This Session runs in an iTerm tab, where Lookout can’t switch its model. Use /model in its terminal.';
const NOT_CLAUDE = 'Lookout switches the model only in a Claude Code Session.';
const NOT_IDLE = 'The Session isn’t Idle now, so the model wasn’t switched. Try again once it is.';
const WORKING = 'The Session is working, so the model wasn’t switched. Try again once it’s Idle.';
const CHANGED = 'This Session was restarted since you picked the model, so it wasn’t switched.';
/**
 * VIEW-6.8: Fleet found the Session changed (`target_changed`) or gone (`target_not_found`, or no
 * longer in the fresh list) since the pick. Lookout targets `id:<session_id>`, and `/clear` gives the
 * same process a new one, so either may be a `/clear` rather than a restart or an exit: said neutrally.
 */
const FLEET_CHANGED = 'This Session changed since you picked the model (restarted or cleared), so it wasn’t switched. Try again.';
const ENDED_OR_CLEARED = 'This Session ended or was cleared since you picked the model, so it wasn’t switched.';
const UNCONFIRMED = 'Lookout can’t confirm it’s the same Session, so it won’t switch its model. Use /model in the terminal.';
const UNKNOWN_MODEL = 'Fleet doesn’t list this model for Claude Code, so the Session wasn’t switched.';
const RUNNING = 'A switch for this Session is already under way.';
/** VIEW-6.8: an outcome Lookout can't be sure of. */
export const MODEL_UNCERTAIN = 'Lookout can’t tell whether the model was switched. Check the terminal.';

/**
 * VIEW-6.6: why Fleet held the switch (its `send_held` reason, as `send --require-empty` gives it),
 * and what to do in the terminal. Never what the box holds: Fleet's `input` and `error` aren't read.
 */
export const MODEL_HELD: Readonly<Record<HeldReason, string>> = {
  text: 'The Session’s input box holds text, so the model wasn’t switched. Send or clear it in the terminal, then try again.',
  prompt: 'The Session is waiting on a prompt, so the model wasn’t switched. Answer it, then try again.',
  no_input_box: 'The Session’s input box isn’t on screen (a menu or the transcript view is open), so the model wasn’t switched. Close it with Esc, then try again.',
  unreadable: 'Fleet can’t read the Session’s input box, so the model wasn’t switched. Switch with /model in the terminal instead.',
};
export const MODEL_HELD_OTHER = 'Fleet held the switch, so the model wasn’t switched. Check the terminal.';

/**
 * The Fleet fork's `model --json` failures, for people (VIEW-6.8), all in one place: the contract
 * may still shift a little. `kind` decides; `reason` (and `not_idle`'s `status`) only refine it
 * under their own kind. Nothing names tmux (0001). `uncertain`: it may have typed, or left
 * something open in the terminal.
 */
const KINDS: Readonly<Record<string, { status: number; message: string; uncertain?: boolean; reasons?: Readonly<Record<string, string>> }>> = {
  send_held: { status: 409, message: MODEL_HELD_OTHER, reasons: MODEL_HELD },
  not_idle: { status: 409, message: NOT_IDLE, reasons: { busy: WORKING } },
  busy: {
    status: 409,
    message: FLEET_TYPING,
    reasons: { locked: FLEET_TYPING, editor_open: 'An editor is open in this Session, so the model wasn’t switched. Close it in the terminal, then try again.' },
  },
  host_shared: {
    status: 409,
    message: 'This Session isn’t in front in its terminal, so the model wasn’t switched. Check the terminal.',
    reasons: {
      job_in_front: 'This Session is paused behind another program in its terminal, so the model wasn’t switched. Bring it back there, then try again.',
      suspended: 'This Session is paused in its terminal, so the model wasn’t switched. Bring it back there, then try again.',
    },
  },
  model_not_found: { status: 409, message: 'Claude Code doesn’t know this model, so the Session wasn’t switched.' },
  switch_refused: { status: 409, message: 'A hook in Claude Code refused the switch, so the model wasn’t switched.' },
  target_not_found: { status: 409, message: ENDED_OR_CLEARED },
  target_changed: { status: 409, message: FLEET_CHANGED },
  target_ambiguous: { status: 409, message: 'Fleet couldn’t tell which Session this is, so the model wasn’t switched.' },
  target_invalid: { status: 409, message: 'Fleet couldn’t tell which Session this is, so the model wasn’t switched.' },
  harness_unsupported: { status: 409, message: NOT_CLAUDE },
  backend_unsupported: { status: 409, message: 'Lookout can’t reach this Session’s terminal, so the model wasn’t switched.' },
  usage: { status: 502, message: 'Fleet refused the request, so the model wasn’t switched.' },
  // Something else came up after `/model`, nothing pressed: VIEW-6.8's "can't tell whether it switched".
  confirm_unrecognized: { status: 502, message: MODEL_UNCERTAIN, uncertain: true },
  outcome_uncertain: { status: 502, message: MODEL_UNCERTAIN, uncertain: true },
  // Fleet couldn't type `/model` whole, or doesn't say it typed nothing: it may be partly typed (see `untyped`).
  io: { status: 502, message: 'Fleet couldn’t finish typing /model, so Lookout can’t tell whether the model was switched. Check the terminal.', uncertain: true },
};

/** An `io` failure before anything was typed (the lock, `ps`, `lsof`, a read of the screen): a plain one. */
export const MODEL_IO = 'Fleet couldn’t check the Session, so nothing was typed and the model wasn’t switched. Try again.';

/**
 * Fleet's `io` covers both a failure before anything is typed and the typing itself failing (`/model`
 * may be partly typed). Fleet tells them apart in `typed` (docs/cli.md "`io`: whether anything was
 * typed", fork `lookout` e187158): `false` when no key reached the pane. Only that is read, never
 * the `error` text. `true`, or no `typed` at all (a Fleet before it), stays "can't tell".
 */
function untyped(res: Record<string, unknown> | null): boolean {
  return res?.typed === false;
}

/** VIEW-6: the request body, `{ model, pid, procStart }`, checked before it goes anywhere near argv. */
export function parseModelRequest(body: unknown): ModelSwitchRequest {
  const b = (typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  if (typeof b.model !== 'string' || b.model === '' || !MODEL_ID.test(b.model)) throw new ModelSwitchError(400, 'Invalid model.');
  let target;
  try {
    target = parseEndTarget(b);
  } catch (err) {
    if (err instanceof EndError) throw new ModelSwitchError(err.status, err.message);
    throw err;
  }
  return { model: b.model, ...target };
}

/**
 * VIEW-6: switches a live, Controllable, Idle Claude Code Session's model through the Fleet fork's
 * `fleet model <exact target> <model-id> --json --require-empty --expect-pid … --expect-start …`,
 * which types `/model <id>` only into an empty input box (as `send --require-empty` reads it; Fleet's
 * `model` always holds so, and the flag is passed as for `send` and `rename`) and answers only
 * Claude Code's confirmation of that switch. The model must be one Fleet lists for Claude Code.
 */
export async function switchModel(opts: ModelSwitcherOptions, id: string, req: ModelSwitchRequest): Promise<ModelSwitchResult> {
  const known = opts.lookup(id);
  if (!known) throw new ModelSwitchError(404, 'This Session isn’t running.');
  if (known.harness !== 'claude') throw new ModelSwitchError(409, NOT_CLAUDE);
  if (!known.controllable) throw new ModelSwitchError(409, OTHER_APP);
  if (req.procStart === null) throw new ModelSwitchError(409, UNCONFIRMED);
  await checkModel(opts, req.model);

  if (known.backend !== 'tmux') throw new ModelSwitchError(409, ITERM);
  const proc = { pid: req.pid, procStart: req.procStart };
  if (!opts.switches.begin(proc)) throw new ModelSwitchError(409, RUNNING);
  try {
    // Read again right before typing: it could have ended, been replaced, or started a turn.
    const row = freshRow(await opts.freshList(), (r) => r.id === known.id && r.harness === known.harness);
    if (row === 'unavailable') throw new ModelSwitchError(503, 'Couldn’t check that the Session is still running, so the model wasn’t switched. Try again.');
    if (!row) throw new ModelSwitchError(409, ENDED_OR_CLEARED);
    if (row.procStart === null) throw new ModelSwitchError(409, UNCONFIRMED);
    if (row.pid !== req.pid || row.procStart !== req.procStart) throw new ModelSwitchError(409, CHANGED);
    if (!row.controllable) throw new ModelSwitchError(409, OTHER_APP);
    if (row.backend !== 'tmux') throw new ModelSwitchError(409, ITERM);
    if (row.status !== 'idle') throw new ModelSwitchError(409, NOT_IDLE);
    let target: string;
    try {
      target = closeTarget(row); // `id:<session_id>` (or `pid:<n>`), checked before it goes anywhere near argv
    } catch (err) {
      if (err instanceof EndError) throw new ModelSwitchError(err.status, err.message);
      throw err;
    }

    let stdout: string;
    try {
      stdout = await opts.runner(
        opts.fleetBin(),
        ['--local', 'model', '--json', '--require-empty', '--expect-pid', String(req.pid), '--expect-start', req.procStart, '--', target, req.model],
        { timeoutMs: MODEL_TIMEOUT_MS, env: cleanEnv(opts.env ?? process.env) },
      );
    } catch (err) {
      const e = failure(err as RunError);
      if (e.uncertain) await settled(opts);
      throw e;
    }
    // Exit 0: switched. Only Fleet's own report says so, with the switch's Transcript time.
    const answer = fleetObject(stdout);
    if (answer?.ok !== true || typeof answer.switched_at !== 'string') {
      await settled(opts);
      throw new ModelSwitchError(502, MODEL_UNCERTAIN, true);
    }
    if (opts.switches.settle(proc, req.model, answer.switched_at)) opts.changed();
    await settled(opts);
    return { model: req.model, confirmed: answer.confirmed === true };
  } finally {
    opts.switches.end(proc);
  }
}

/** VIEW-6.1: only a model Fleet lists for Claude Code, never its "Default" entry. */
async function checkModel(opts: ModelSwitcherOptions, model: string): Promise<void> {
  let harnesses: HarnessOption[];
  try {
    harnesses = await opts.harnesses();
  } catch {
    throw new ModelSwitchError(503, 'Couldn’t read the models Fleet lists, so the model wasn’t switched. Try again.');
  }
  const claude = harnesses.find((h) => h.id === 'claude');
  if (!claude?.models.some((m) => m.id !== '' && m.id === model)) throw new ModelSwitchError(400, UNKNOWN_MODEL);
}

/** After anything that may have switched: the saved default may be new, and the list goes out at once. */
async function settled(opts: ModelSwitcherOptions): Promise<void> {
  opts.dropHarnesses();
  await opts.refresh().catch(() => {});
}

/**
 * Why a switch failed, for people. Only `kind`, `reason`, `status` and an `io`'s `typed` (`untyped`)
 * are read, and `error` only to tell clap's missing subcommand; `input` never is.
 */
function failure(e: RunError): ModelSwitchError {
  if (e.code === 'ENOENT') return new ModelSwitchError(503, 'Fleet isn’t installed, so the model wasn’t switched.');
  if (e.timedOut) return new ModelSwitchError(504, 'Fleet took too long, so Lookout can’t tell whether the model was switched. Check the terminal.', true);
  const parsed = fleetObject(e.stdout);
  // A Fleet before the fork's `model` says so in clap's words.
  if (/unrecognized subcommand/i.test(`${e.stderr ?? ''}\n${typeof parsed?.error === 'string' ? parsed.error : ''}`)) {
    return new ModelSwitchError(501, 'This Fleet can’t switch models yet. Update the Fleet fork.');
  }
  const kind = typeof parsed?.kind === 'string' ? parsed.kind : e.code === 3 ? 'send_held' : null;
  if (kind !== null && Object.hasOwn(KINDS, kind)) {
    const k = KINDS[kind]!;
    const why = kind === 'not_idle' ? parsed?.status : parsed?.reason;
    const refined = typeof why === 'string' && k.reasons && Object.hasOwn(k.reasons, why) ? k.reasons[why] : undefined;
    // A held switch's reason is one of `send`'s; any other is Fleet's own, said plainly.
    if (kind === 'send_held' && !HELD_REASONS.some((r) => r === why)) return new ModelSwitchError(409, MODEL_HELD_OTHER);
    if (kind === 'io' && untyped(parsed)) return new ModelSwitchError(502, MODEL_IO);
    return new ModelSwitchError(k.status, refined ?? k.message, k.uncertain);
  }
  // Any other failure (a kind this Lookout doesn't know, no report at all): it may have typed.
  return new ModelSwitchError(502, MODEL_UNCERTAIN, true);
}
