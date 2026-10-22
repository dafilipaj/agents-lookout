import { EFFORT_LEVEL, MODEL_ID, effortLevels } from '../shared/model.ts';
import {
  HELD_REASONS,
  type EffortSwitchRequest,
  type EffortSwitchResult,
  type HarnessOption,
  type HeldReason,
  type ModelSwitchRequest,
  type ModelSwitchResult,
  type PendingEffort,
  type PendingModel,
  type SessionRow,
} from '../shared/types.ts';
import { EndError, FLEET_TYPING, closeTarget, parseEndTarget } from './closer.ts';
import type { RunError, Runner } from './exec.ts';
import { type FleetListResult, type FleetRow, fleetObject } from './fleet.ts';
import { cleanEnv } from './launcher.ts';
import { freshRow, sessionId } from './normalize.ts';

/**
 * Fleet's `model` and `effort` wait for the Session's typing lock, type `/model <id>` or
 * `/effort <level>`, then read the screen and the Transcript for up to 5 s (2 s more after a
 * confirmation); this leaves room for all of it.
 */
export const MODEL_TIMEOUT_MS = 20_000;

export class ModelSwitchError extends Error {
  readonly status: number;
  /**
   * VIEW-6.8, VIEW-7.8: Lookout can't be sure what happened (it may have switched, or left
   * something open in the terminal): the tab opens the Terminal preview. Claude Code's saved
   * default may have changed too, so LAUNCH's cached list goes.
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
 * VIEW-6.3/6.7, VIEW-7.3/7.7: the server's side of the status line's switches, in memory, per
 * Session process. One switch per process at a time, model or Effort, whichever tab asks; and what
 * a switch moved it to, until Fleet's `model_at` shows a reply after it (`pendingModel` and
 * `pendingEffort`, sent with the process's row, whatever its session id). Fleet's `model` and
 * `effort` come from the same reply, so `model_at` dates both.
 *
 * A switch's answer installs its pending value only while its process is still listed and the
 * latest `model_at` listed for it isn't already later than the switch: checked and set in one step,
 * so a late answer brings back nothing. The next switch of a process can begin only once the last
 * one's answer is in (`settle` comes before `end`), so an answer is always its process's latest.
 */
export class StatusSwitches {
  private readonly running = new Set<string>();
  private readonly models = new Map<string, PendingModel>();
  private readonly efforts = new Map<string, PendingEffort>();
  /** Each listed Session process's latest `model_at`, as the last list showed it. */
  private listed = new Map<string, string | null>();

  /** A switch starts for this process: false while another one, of either kind, runs. */
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

  /** Whether an answer for this process, written at `since`, may still install what it switched to. */
  private current(key: string | null, since: string): key is string {
    return key !== null && this.listed.has(key) && !later(this.listed.get(key), since);
  }

  /** Fleet says the model switch is done: from the next reply on, `model`. True when it's now pending. */
  settle(proc: Proc, model: string, since: string): boolean {
    const key = procKey(proc);
    if (!this.current(key, since)) return false;
    this.models.set(key, { model, since });
    return true;
  }

  /** VIEW-7.7: Fleet says the Effort switch is done: from the next reply on, `effort`. True when it's now pending. */
  settleEffort(proc: Proc, effort: string, since: string): boolean {
    const key = procKey(proc);
    if (!this.current(key, since)) return false;
    this.efforts.set(key, { effort, since });
    return true;
  }

  /**
   * Every list (`raw` its rows, `rows` them normalized): a pending value goes once a reply after
   * its switch has reached the Transcript, whatever it ran at, or once its process ends or changes.
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
    for (const pending of [this.models, this.efforts] as Map<string, { since: string }>[]) {
      for (const [key, p] of pending) {
        if (!listed.has(key) || later(listed.get(key), p.since)) pending.delete(key);
      }
    }
  }

  /** What the row carries as `pendingModel`: its process's, whichever session id it has now. */
  pendingFor(row: SessionRow): PendingModel | null {
    const key = procKey(row);
    return (key !== null && this.models.get(key)) || null;
  }

  /** What the row carries as `pendingEffort` (VIEW-7.7). */
  pendingEffortFor(row: SessionRow): PendingEffort | null {
    const key = procKey(row);
    return (key !== null && this.efforts.get(key)) || null;
  }
}

export interface ModelSwitcherOptions {
  runner: Runner;
  fleetBin: () => string;
  /** The Session as Fleet listed it in the last poll, or null. */
  lookup(sessionId: string): SessionRow | null;
  /** A `fleet list` made now: the Session is checked again right before the switch. */
  freshList(): Promise<FleetListResult>;
  /** LAUNCH's cached `harness list` (LAUNCH-3.2): the models a Session may be switched to, and their levels. */
  harnesses(): Promise<HarnessOption[]>;
  /** The switch may have changed Claude Code's saved default: LAUNCH's cached list goes. */
  dropHarnesses(): void;
  switches: StatusSwitches;
  /** The rows went out again with their `pendingModel` and `pendingEffort` (the monitor re-derives them from its last list). */
  changed(): void;
  /** After a switch, a list made at once. */
  refresh(): Promise<void>;
  env?: NodeJS.ProcessEnv;
}

/** A Fleet failure's words and outcome: `uncertain` when it may have typed, or left something open in the terminal. */
interface Kind {
  status: number;
  message: string;
  uncertain?: boolean;
  reasons?: Readonly<Record<string, string>>;
}

/**
 * What the status line switches, in people's words (VIEW-6.8, VIEW-7.6/7.8: the Effort's are the
 * model's, naming `/effort` where they name `/model`), and Fleet's kinds for it. Nothing names
 * tmux (0001).
 */
export interface SwitchWords {
  OTHER_APP: string;
  ITERM: string;
  NOT_CLAUDE: string;
  NOT_IDLE: string;
  CHANGED: string;
  FLEET_CHANGED: string;
  ENDED_OR_CLEARED: string;
  UNCONFIRMED: string;
  UNLISTED: string;
  UNREADABLE_LIST: string;
  NO_FRESH_LIST: string;
  UNCERTAIN: string;
  HELD: Readonly<Record<HeldReason, string>>;
  HELD_OTHER: string;
  IO: string;
  MISSING: string;
  TOO_LONG: string;
  OLD_FLEET: string;
  KINDS: Readonly<Record<string, Kind>>;
}

const RUNNING = 'A switch for this Session is already under way.';

/**
 * The words for one setting: `noun` as a sentence names it (`model`, `Effort`), `cmd` its slash
 * command, `listed` what Fleet lists of it.
 */
function switchWords(noun: string, cmd: string, listed: { unlisted: string; unreadable: string; oldFleet: string }): SwitchWords {
  const not = `so the ${noun} wasn’t switched`;
  const cantTell = `Lookout can’t tell whether the ${noun} was switched. Check the terminal.`;
  const HELD: Record<HeldReason, string> = {
    text: `The Session’s input box holds text, ${not}. Send or clear it in the terminal, then try again.`,
    prompt: `The Session is waiting on a prompt, ${not}. Answer it, then try again.`,
    no_input_box: `The Session’s input box isn’t on screen (a menu or the transcript view is open), ${not}. Close it with Esc, then try again.`,
    unreadable: `Fleet can’t read the Session’s input box, ${not}. Switch with ${cmd} in the terminal instead.`,
  };
  const HELD_OTHER = `Fleet held the switch, ${not}. Check the terminal.`;
  const NOT_IDLE = `The Session isn’t Idle now, ${not}. Try again once it is.`;
  const FLEET_CHANGED = `This Session changed since you picked the ${noun} (restarted or cleared), so it wasn’t switched. Try again.`;
  const ENDED_OR_CLEARED = `This Session ended or was cleared since you picked the ${noun}, so it wasn’t switched.`;
  const ambiguous = `Fleet couldn’t tell which Session this is, ${not}.`;
  return {
    OTHER_APP: `This Session runs in another app, so Lookout can’t switch its ${noun}.`,
    // VIEW-6.2: Fleet reads the input box only in its own terminal host (tmux), which is never named.
    ITERM: `This Session runs in an iTerm tab, where Lookout can’t switch its ${noun}. Use ${cmd} in its terminal.`,
    NOT_CLAUDE: `Lookout switches the ${noun} only in a Claude Code Session.`,
    NOT_IDLE,
    CHANGED: `This Session was restarted since you picked the ${noun}, so it wasn’t switched.`,
    // VIEW-6.8: Fleet found the Session changed (`target_changed`) or gone (`target_not_found`, or no
    // longer in the fresh list) since the pick. Lookout targets `id:<session_id>`, and `/clear` gives
    // the same process a new one, so either may be a `/clear` rather than a restart or an exit: said neutrally.
    FLEET_CHANGED,
    ENDED_OR_CLEARED,
    UNCONFIRMED: `Lookout can’t confirm it’s the same Session, so it won’t switch its ${noun}. Use ${cmd} in the terminal.`,
    UNLISTED: listed.unlisted,
    UNREADABLE_LIST: listed.unreadable,
    NO_FRESH_LIST: `Couldn’t check that the Session is still running, ${not}. Try again.`,
    UNCERTAIN: cantTell,
    HELD,
    HELD_OTHER,
    // An `io` failure before anything was typed (the lock, `ps`, `lsof`, a read of the screen): a plain one.
    IO: `Fleet couldn’t check the Session, so nothing was typed and the ${noun} wasn’t switched. Try again.`,
    MISSING: `Fleet isn’t installed, ${not}.`,
    TOO_LONG: `Fleet took too long, so Lookout can’t tell whether the ${noun} was switched. Check the terminal.`,
    OLD_FLEET: listed.oldFleet,
    // `kind` decides; `reason` (and `not_idle`'s `status`) only refine it under their own kind.
    KINDS: {
      send_held: { status: 409, message: HELD_OTHER, reasons: HELD },
      not_idle: {
        status: 409,
        message: NOT_IDLE,
        reasons: {
          busy: `The Session is working, ${not}. Try again once it’s Idle.`,
          // VIEW-5.16 (Known gap): a Fleet before e81a0b6 takes only `idle`, not Idle with a background shell running.
          shell: `A background shell command is still running, so this Fleet won’t switch the ${noun}. Try again once it ends, or use ${cmd} in the terminal.`,
        },
      },
      busy: {
        status: 409,
        message: FLEET_TYPING,
        reasons: { locked: FLEET_TYPING, editor_open: `An editor is open in this Session, ${not}. Close it in the terminal, then try again.` },
      },
      host_shared: {
        status: 409,
        message: `This Session isn’t in front in its terminal, ${not}. Check the terminal.`,
        reasons: {
          job_in_front: `This Session is paused behind another program in its terminal, ${not}. Bring it back there, then try again.`,
          suspended: `This Session is paused in its terminal, ${not}. Bring it back there, then try again.`,
        },
      },
      target_not_found: { status: 409, message: ENDED_OR_CLEARED },
      target_changed: { status: 409, message: FLEET_CHANGED },
      target_ambiguous: { status: 409, message: ambiguous },
      target_invalid: { status: 409, message: ambiguous },
      harness_unsupported: { status: 409, message: `Lookout switches the ${noun} only in a Claude Code Session.` },
      backend_unsupported: { status: 409, message: `Lookout can’t reach this Session’s terminal, ${not}.` },
      usage: { status: 502, message: `Fleet refused the request, ${not}.` },
      // Something else came up after the command, nothing pressed: "can't tell whether it switched".
      confirm_unrecognized: { status: 502, message: cantTell, uncertain: true },
      outcome_uncertain: { status: 502, message: cantTell, uncertain: true },
      // Fleet couldn't type the command whole, or doesn't say it typed nothing: it may be partly typed (see `untyped`).
      io: { status: 502, message: `Fleet couldn’t finish typing ${cmd}, so Lookout can’t tell whether the ${noun} was switched. Check the terminal.`, uncertain: true },
    },
  };
}

/** VIEW-6's words, and the Fleet fork's `model --json` failures for people (VIEW-6.8). */
export const MODEL_WORDS: SwitchWords = (() => {
  const w = switchWords('model', '/model', {
    unlisted: 'Fleet doesn’t list this model for Claude Code, so the Session wasn’t switched.',
    unreadable: 'Couldn’t read the models Fleet lists, so the model wasn’t switched. Try again.',
    oldFleet: 'This Fleet can’t switch models yet. Update the Fleet fork.',
  });
  return {
    ...w,
    KINDS: {
      ...w.KINDS,
      model_not_found: { status: 409, message: 'Claude Code doesn’t know this model, so the Session wasn’t switched.' },
      switch_refused: { status: 409, message: 'A hook in Claude Code refused the switch, so the model wasn’t switched.' },
    },
  };
})();

/**
 * VIEW-7's words, and the Fleet fork's `effort --json` failures for people (VIEW-7.8): `model`'s
 * kinds, less `model_not_found` and `switch_refused` (Claude Code has no hook on effort changes).
 */
export const EFFORT_WORDS: SwitchWords = (() => {
  const w = switchWords('Effort', '/effort', {
    unlisted: 'Fleet doesn’t list this level for the Session’s model, so the Effort wasn’t switched.',
    unreadable: 'Couldn’t read the levels Fleet lists, so the Effort wasn’t switched. Try again.',
    oldFleet: 'This Fleet can’t switch the Effort yet. Update the Fleet fork.',
  });
  return {
    ...w,
    KINDS: {
      ...w.KINDS,
      // VIEW-7.8: `/effort` was typed and Claude Code asked something Fleet doesn't know; nothing was
      // pressed, so it's still on screen: the Terminal preview opens.
      confirm_unrecognized: {
        status: 502,
        message: 'Claude Code asked something Fleet didn’t recognise after /effort, so nothing was pressed. Check the terminal.',
        uncertain: true,
      },
    },
  };
})();

export const MODEL_HELD = MODEL_WORDS.HELD;
export const MODEL_HELD_OTHER = MODEL_WORDS.HELD_OTHER;
/** VIEW-6.8: an outcome Lookout can't be sure of. */
export const MODEL_UNCERTAIN = MODEL_WORDS.UNCERTAIN;
/** An `io` failure before anything was typed: a plain one. */
export const MODEL_IO = MODEL_WORDS.IO;
export const EFFORT_HELD = EFFORT_WORDS.HELD;
export const EFFORT_UNCERTAIN = EFFORT_WORDS.UNCERTAIN;
export const EFFORT_IO = EFFORT_WORDS.IO;

/**
 * Fleet's `io` covers both a failure before anything is typed and the typing itself failing (the
 * command may be partly typed). Fleet tells them apart in `typed` (docs/cli.md "`io`: whether
 * anything was typed", fork `lookout` e187158): `false` when no key reached the pane. Only that is
 * read, never the `error` text. `true`, or no `typed` at all (a Fleet before it), stays "can't tell".
 */
function untyped(res: Record<string, unknown> | null): boolean {
  return res?.typed === false;
}

/** The process a body names, `{ pid, procStart }`, as End Session checks it. */
function parseTarget(b: Record<string, unknown>) {
  try {
    return parseEndTarget(b);
  } catch (err) {
    if (err instanceof EndError) throw new ModelSwitchError(err.status, err.message);
    throw err;
  }
}

const asObject = (body: unknown) => (typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {}) as Record<string, unknown>;

/** VIEW-6: the request body, `{ model, pid, procStart }`, checked before it goes anywhere near argv. */
export function parseModelRequest(body: unknown): ModelSwitchRequest {
  const b = asObject(body);
  if (typeof b.model !== 'string' || b.model === '' || !MODEL_ID.test(b.model)) throw new ModelSwitchError(400, 'Invalid model.');
  return { model: b.model, ...parseTarget(b) };
}

/** VIEW-7: the request body, `{ effort, pid, procStart }`, checked before it goes anywhere near argv. */
export function parseEffortRequest(body: unknown): EffortSwitchRequest {
  const b = asObject(body);
  if (typeof b.effort !== 'string' || !EFFORT_LEVEL.test(b.effort)) throw new ModelSwitchError(400, 'Invalid Effort level.');
  return { effort: b.effort, ...parseTarget(b) };
}

/** One switch through Fleet: its words, its subcommand and value, how it's checked and what it settles. */
interface SwitchSpec<R> {
  words: SwitchWords;
  /** Fleet's subcommand, `model` or `effort`. */
  command: string;
  value: string;
  /** Throws (with `words.UNLISTED`) unless the value is one Fleet lists for the Session. */
  check(harnesses: HarnessOption[], row: SessionRow): void;
  /** Fleet's exit-0 report: what the tab gets, whether Claude Code's default may have changed, and the pending value installed. */
  done(answer: Record<string, unknown> & { switched_at: string }, proc: { pid: number; procStart: string }): { result: R; dropDefault: boolean; settled: boolean };
}

/**
 * VIEW-6 and VIEW-7: switches a live, Controllable, Idle Claude Code Session's model or Effort
 * through the Fleet fork's `fleet <model|effort> --json --require-empty --expect-pid … --expect-start
 * … -- <exact target> <value>`, which types the command only into an empty input box (as `send
 * --require-empty` reads it; both always hold so, and the flag is passed as for `send` and `rename`)
 * and answers only Claude Code's confirmation of that switch. The value must be one Fleet lists.
 */
async function runSwitch<R>(opts: ModelSwitcherOptions, id: string, target: { pid: number; procStart: string | null }, spec: SwitchSpec<R>): Promise<R> {
  const w = spec.words;
  const known = opts.lookup(id);
  if (!known) throw new ModelSwitchError(404, 'This Session isn’t running.');
  if (known.harness !== 'claude') throw new ModelSwitchError(409, w.NOT_CLAUDE);
  if (!known.controllable) throw new ModelSwitchError(409, w.OTHER_APP);
  if (target.procStart === null) throw new ModelSwitchError(409, w.UNCONFIRMED);
  let harnesses: HarnessOption[];
  try {
    harnesses = await opts.harnesses();
  } catch {
    throw new ModelSwitchError(503, w.UNREADABLE_LIST);
  }
  spec.check(harnesses, known);

  if (known.backend !== 'tmux') throw new ModelSwitchError(409, w.ITERM);
  const proc = { pid: target.pid, procStart: target.procStart };
  if (!opts.switches.begin(proc)) throw new ModelSwitchError(409, RUNNING);
  try {
    // Read again right before typing: it could have ended, been replaced, or started a turn.
    const row = freshRow(await opts.freshList(), (r) => r.id === known.id && r.harness === known.harness);
    if (row === 'unavailable') throw new ModelSwitchError(503, w.NO_FRESH_LIST);
    if (!row) throw new ModelSwitchError(409, w.ENDED_OR_CLEARED);
    if (row.procStart === null) throw new ModelSwitchError(409, w.UNCONFIRMED);
    if (row.pid !== proc.pid || row.procStart !== proc.procStart) throw new ModelSwitchError(409, w.CHANGED);
    if (!row.controllable) throw new ModelSwitchError(409, w.OTHER_APP);
    if (row.backend !== 'tmux') throw new ModelSwitchError(409, w.ITERM);
    if (row.status !== 'idle') throw new ModelSwitchError(409, w.NOT_IDLE);
    let exact: string;
    try {
      exact = closeTarget(row); // `id:<session_id>` (or `pid:<n>`), checked before it goes anywhere near argv
    } catch (err) {
      if (err instanceof EndError) throw new ModelSwitchError(err.status, err.message);
      throw err;
    }

    let stdout: string;
    try {
      stdout = await opts.runner(
        opts.fleetBin(),
        ['--local', spec.command, '--json', '--require-empty', '--expect-pid', String(proc.pid), '--expect-start', proc.procStart, '--', exact, spec.value],
        { timeoutMs: MODEL_TIMEOUT_MS, env: cleanEnv(opts.env ?? process.env) },
      );
    } catch (err) {
      const e = failure(err as RunError, w);
      if (e.uncertain) await settled(opts, true);
      throw e;
    }
    // Exit 0: switched. Only Fleet's own report says so, with the switch's Transcript time.
    const answer = fleetObject(stdout);
    if (answer?.ok !== true || typeof answer.switched_at !== 'string') {
      await settled(opts, true);
      throw new ModelSwitchError(502, w.UNCERTAIN, true);
    }
    const { result, dropDefault, settled: pending } = spec.done(answer as Record<string, unknown> & { switched_at: string }, proc);
    if (pending) opts.changed();
    await settled(opts, dropDefault);
    return result;
  } finally {
    opts.switches.end(proc);
  }
}

/** VIEW-6: the model; only one Fleet lists for Claude Code, never its "Default" entry (VIEW-6.1). */
export function switchModel(opts: ModelSwitcherOptions, id: string, req: ModelSwitchRequest): Promise<ModelSwitchResult> {
  return runSwitch(opts, id, req, {
    words: MODEL_WORDS,
    command: 'model',
    value: req.model,
    check(harnesses) {
      const claude = harnesses.find((h) => h.id === 'claude');
      if (!claude?.models.some((m) => m.id !== '' && m.id === req.model)) throw new ModelSwitchError(400, MODEL_WORDS.UNLISTED);
    },
    done(answer, proc) {
      // `/model` always saves the pick as Claude Code's default (VIEW-6.4).
      return { result: { model: req.model, confirmed: answer.confirmed === true }, dropDefault: true, settled: opts.switches.settle(proc, req.model, answer.switched_at) };
    },
  });
}

/**
 * VIEW-7: the Effort; only a level Fleet lists for the Session's model (VIEW-7.1: the model it shows,
 * a pending switch's first, matched as VIEW-6.1 matches it; every Claude Code level for a model
 * Fleet doesn't list). Claude Code's default changed only when Fleet's `saved` says so (`max` is for
 * this Session only), so only then does LAUNCH's cached list go.
 */
export function switchEffort(opts: ModelSwitcherOptions, id: string, req: EffortSwitchRequest): Promise<EffortSwitchResult> {
  return runSwitch(opts, id, req, {
    words: EFFORT_WORDS,
    command: 'effort',
    value: req.effort,
    check(harnesses, row) {
      const claude = harnesses.find((h) => h.id === 'claude');
      const levels = effortLevels(claude?.models ?? [], row.pendingModel?.model ?? row.model);
      if (!levels.includes(req.effort)) throw new ModelSwitchError(400, EFFORT_WORDS.UNLISTED);
    },
    done(answer, proc) {
      const saved = answer.saved === true;
      return {
        result: { effort: req.effort, confirmed: answer.confirmed === true, saved },
        // A report without `saved` can't say the default stayed: it goes too.
        dropDefault: answer.saved !== false,
        settled: opts.switches.settleEffort(proc, req.effort, answer.switched_at),
      };
    },
  });
}

/** After anything that may have switched: the saved default may be new, and the list goes out at once. */
async function settled(opts: ModelSwitcherOptions, dropDefault: boolean): Promise<void> {
  if (dropDefault) opts.dropHarnesses();
  await opts.refresh().catch(() => {});
}

/**
 * Why a switch failed, for people. Only `kind`, `reason`, `status` and an `io`'s `typed` (`untyped`)
 * are read, and `error` only to tell clap's missing subcommand; `input` never is.
 */
function failure(e: RunError, w: SwitchWords): ModelSwitchError {
  if (e.code === 'ENOENT') return new ModelSwitchError(503, w.MISSING);
  if (e.timedOut) return new ModelSwitchError(504, w.TOO_LONG, true);
  const parsed = fleetObject(e.stdout);
  // A Fleet before the fork's `model` or `effort` says so in clap's words.
  if (/unrecognized subcommand/i.test(`${e.stderr ?? ''}\n${typeof parsed?.error === 'string' ? parsed.error : ''}`)) {
    return new ModelSwitchError(501, w.OLD_FLEET);
  }
  const kind = typeof parsed?.kind === 'string' ? parsed.kind : e.code === 3 ? 'send_held' : null;
  if (kind !== null && Object.hasOwn(w.KINDS, kind)) {
    const k = w.KINDS[kind]!;
    const why = kind === 'not_idle' ? parsed?.status : parsed?.reason;
    const refined = typeof why === 'string' && k.reasons && Object.hasOwn(k.reasons, why) ? k.reasons[why] : undefined;
    // A held switch's reason is one of `send`'s; any other is Fleet's own, said plainly.
    if (kind === 'send_held' && !HELD_REASONS.some((r) => r === why)) return new ModelSwitchError(409, w.HELD_OTHER);
    if (kind === 'io' && untyped(parsed)) return new ModelSwitchError(502, w.IO);
    return new ModelSwitchError(k.status, refined ?? k.message, k.uncertain);
  }
  // Any other failure (a kind this Lookout doesn't know, no report at all): it may have typed.
  return new ModelSwitchError(502, w.UNCERTAIN, true);
}
