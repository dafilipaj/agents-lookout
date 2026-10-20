import type { AnswerRequest, AnswerResult, EscStatus, PromptChoice, QuestionAnswer, ScreenPrompt, ServerEvent, SessionRow } from '../shared/types.ts';
import { EndError, closeTarget, isPidOnly } from './closer.ts';
import type { RunError, Runner } from './exec.ts';
import type { FleetListResult } from './fleet.ts';
import { cleanEnv } from './launcher.ts';
import { MONITOR_INTERVAL_MS } from './monitor.ts';
import { normalizeRows } from './normalize.ts';
import { sanitizeLine } from './sanitize.ts';

/** VIEW-4.2: a viewed Session that Needs you has its prompt read this often, as the preview is (VIEW-2.1). */
export const PROMPT_INTERVAL_MS = 1000;
const LIST_TIMEOUT_MS = 4000;
/**
 * Fleet checks the screen before each key of a question form (up to 1.5 s each) and watches it for
 * 300 ms after the last; a form of several questions takes many keys.
 */
const ANSWER_TIMEOUT_MS = 60_000;
const KEYS_TIMEOUT_MS = 10_000;
/** VIEW-4.4: after one Esc, a second one for the same Busy spell waits this long (as the tab's Stop does). */
export const STOP_SETTLE_MS = 10_000;

/** Fleet's permission prompt id (`p2.<fnv1a hex>`), bounded; it goes back to Fleet as `--prompt`. */
const PROMPT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
/** An AskUserQuestion's tool_use id (`toolu_…`); it goes back to Fleet as `--question`. */
const QUESTION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
/** Fleet's limits on an answer (docs/cli.md, "Answering prompts"); the chat's (VIEW-1) on questions. */
const MAX_QUESTIONS = 10;
const MAX_OPTIONS = 20;
const MAX_TEXT = 2000;
const MAX_CHOICES = 10;
const MAX_DETAIL_LINES = 60;
const MAX_LINE = 500;

export class AnswerError extends Error {
  readonly status: number;
  /**
   * `stale`: refused because the tab's read of the prompt is older than an answer from another tab
   * (or one is being typed now). It holds only until the tab gets a newer read.
   */
  readonly kind: 'stale' | null;
  constructor(status: number, message: string, kind: 'stale' | null = null) {
    super(message);
    this.status = status;
    this.kind = kind;
  }
}

export interface AnswererOptions {
  runner: Runner;
  fleetBin: () => string;
  /** The Session as Fleet listed it in the last poll, or null. */
  lookup(sessionId: string): SessionRow | null;
  /** A `fleet list` made now: a pid target, and Stop's Busy check, are read again right before typing. */
  freshList(): Promise<FleetListResult>;
  /** What every tab has answered or stopped, per Session (see `AnswerLedger`). */
  ledger: AnswerLedger;
  env?: NodeJS.ProcessEnv;
}

const env = (opts: { env?: NodeJS.ProcessEnv }) => cleanEnv(opts.env ?? process.env);

/**
 * Fleet's exact target, `id:<session_id>` or `pid:<n>` (as `close` takes): it never falls through
 * to fuzzy matching on titles, so a Session that just exited can't send the keys to another.
 */
function exactTarget(row: SessionRow): string {
  try {
    return closeTarget(row);
  } catch (err) {
    if (err instanceof EndError) throw new AnswerError(err.status, err.message);
    throw err;
  }
}

/**
 * The target to type into. On top of the exact form, the interim guard (Technical approach): a pid
 * target goes ahead only if a fresh `fleet list` still has that pid with the same Harness.
 */
async function typingTarget(opts: Omit<AnswererOptions, 'ledger'>, row: SessionRow): Promise<string> {
  if (isPidOnly(row)) {
    const fresh = await opts.freshList();
    if (fresh.kind !== 'ok') throw new AnswerError(503, "Couldn't check that the Session is still running, so nothing was typed. Try again.");
    if (!freshRows(fresh).some((r) => sameProcess(row, r))) {
      throw new AnswerError(409, 'This Session is no longer running, so nothing was typed.');
    }
  }
  return exactTarget(row);
}

const freshRows = (fresh: Extract<FleetListResult, { kind: 'ok' }>) => normalizeRows(fresh.rows, { git: () => null, statusSince: () => null });

/**
 * The pid guard: the same pid and Harness, and the same start time where Lookout has one (a pid
 * reused by another process, or a Session restarted under it, has another).
 */
export function sameProcess(known: Pick<SessionRow, 'pid' | 'harness' | 'procStart'>, fresh: Pick<SessionRow, 'pid' | 'harness' | 'procStart'>): boolean {
  return fresh.pid === known.pid && fresh.harness === known.harness && (known.procStart === null || fresh.procStart === known.procStart);
}

/** A Session's process: a Codex Session's id changes when it gets its session id; its process doesn't. */
const processKey = (row: Pick<SessionRow, 'harness' | 'pid'>) => `${row.harness}:${row.pid}`;

/** What an answer is for: `p:<prompt id>` or `q:<tool_use id>` (as the tab keys them). */
export const answerKey = (req: AnswerRequest) => (req.kind === 'permission' ? `p:${req.prompt}` : `q:${req.question}`);

/** What the screen shows, keyed as answers are; null for nothing. */
const screenKey = (p: ScreenPrompt | null) => (p === null ? null : p.kind === 'permission' ? `p:${p.id}` : p.kind === 'question' ? `q:${p.id ?? ''}` : 'incomplete');

// ---------------------------------------------------------------------------------------------
// Reading the prompt (VIEW-4.2)

/**
 * A read of the screen. `ok`: Fleet said what the terminal shows (`prompt`, null when it shows no
 * prompt Lookout answers). Not `ok`: the read failed or can't be trusted (Fleet missing or timed
 * out, the Session gone, malformed output, an answer for another Session); the tabs see no prompt,
 * but it's no proof the prompt has gone.
 */
export type PromptRead = { ok: true; prompt: ScreenPrompt | null } | { ok: false };

const FAILED_READ: PromptRead = { ok: false };

/**
 * VIEW-4.2: what `fleet answer <target> --list --json` reads off the terminal (see `PromptRead`).
 * Types nothing, and takes no lock, so it never makes an answer `busy`.
 */
export async function listPrompt(opts: Pick<AnswererOptions, 'runner' | 'fleetBin' | 'env'>, row: SessionRow): Promise<PromptRead> {
  let stdout: string;
  try {
    stdout = await opts.runner(opts.fleetBin(), ['--local', 'answer', exactTarget(row), '--list', '--json'], {
      timeoutMs: LIST_TIMEOUT_MS,
      env: env(opts),
    });
  } catch {
    return FAILED_READ;
  }
  const res = parseObject(stdout);
  if (res?.ok !== true) return FAILED_READ;
  // An answer naming another Session or Harness than the one asked for is never shown.
  if (res.harness !== row.harness) return FAILED_READ;
  if (!isPidOnly(row) && res.session_id !== row.id) return FAILED_READ;
  // Only Fleet's `null` says the screen shows no prompt; anything else that isn't a prompt is malformed.
  if (res.prompt === null) return { ok: true, prompt: null };
  if (!isRecord(res.prompt) || typeof res.prompt.kind !== 'string') return FAILED_READ;
  return { ok: true, prompt: parseScreenPrompt(res.prompt) };
}

/**
 * VIEW-4.2: Fleet's `prompt`, type-checked and bounded. A permission prompt whose id or choices
 * don't check out is `incomplete`: it's there, but Lookout won't offer to answer it.
 */
export function parseScreenPrompt(value: unknown): ScreenPrompt | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'question') {
    const id = typeof value.id === 'string' && QUESTION_ID.test(value.id) ? value.id : null;
    return { kind: 'question', id, untouched: value.untouched === true };
  }
  if (value.kind !== 'permission') return null;
  if (value.incomplete === true) return { kind: 'incomplete' };
  const id = typeof value.id === 'string' && PROMPT_ID.test(value.id) ? value.id : null;
  const choices = Array.isArray(value.choices) ? value.choices.map(parseChoice) : [];
  const valid = choices.length > 0 && choices.length <= MAX_CHOICES && choices.every((c) => c !== null);
  if (!id || !valid || new Set(choices.map((c) => c!.n)).size !== choices.length) return { kind: 'incomplete' };
  const lines = Array.isArray(value.detail) ? value.detail.filter((l): l is string => typeof l === 'string') : [];
  const detail = lines.slice(0, MAX_DETAIL_LINES).map((l) => bounded(l, MAX_LINE));
  if (lines.length > MAX_DETAIL_LINES) detail.push('…');
  return {
    kind: 'permission',
    id,
    title: oneLine(value.title, 300) ?? '',
    detail,
    choices: choices as PromptChoice[],
    // Fleet answers only while the cursor is on the first choice.
    untouched: value.untouched === true && (value.selected === undefined || value.selected === 1),
  };
}

function parseChoice(c: unknown): PromptChoice | null {
  if (!isRecord(c) || typeof c.n !== 'number' || !Number.isSafeInteger(c.n) || c.n < 1 || c.n > MAX_OPTIONS) return null;
  const label = oneLine(c.label, 300);
  return label ? { n: c.n, label } : null;
}

/**
 * The terminal's wording, shown as the terminal shows it (like the preview, VIEW-2, not redacted):
 * its first non-empty line, control characters out, at most `max` characters; null if none.
 */
function oneLine(text: unknown, max: number): string | null {
  if (typeof text !== 'string') return null;
  const line = text.split(/\r?\n/).map((l) => bounded(l, max).replace(/\t/g, ' ').trim()).find((l) => l !== '');
  return line ?? null;
}

/** A line of the prompt as drawn: control characters out (a tab stays), at most `max` characters. */
function bounded(line: string, max: number): string {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const clean = line.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '').replace(/\s+$/, '');
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * VIEW-4: what every tab has answered or stopped, per Session (by its process), so two tabs, or a
 * reload, can't answer one prompt twice or press Esc twice.
 *
 * The answer epoch: a number that starts at the clock (so it keeps growing across restarts) and is
 * bumped after every answer, whatever it typed. Each read of a prompt carries the epoch from when
 * it began, and each answer carries the epoch of the read it answers. An answer whose read began
 * before the Session's last answer that typed, or may have, is refused, nothing typed: it answers a
 * prompt that may be gone, or one that looks the same but is new (two identical commands share an
 * id). So is one whose read began before this server started: what was answered before a restart
 * isn't known. Only one answer per Session is typed at a time. An answer that typed nothing still moves
 * the epoch and the Session's change stamp, so every tab gets a fresh read: a tab refused while it
 * was being typed answers from that read.
 *
 * After an answer whose outcome isn't certain, that prompt (or question) gets no more answers from
 * any tab while it stays on screen in that Needs you spell; the reads say so, so no tab offers its
 * buttons.
 */
export class AnswerLedger {
  private epoch: number;
  /** The epoch this server started at: a read carrying an older one was made before a restart. */
  private readonly started: number;
  private readonly sessions = new Map<string, SessionLedger>();
  private readonly now: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
    this.epoch = this.now();
    this.started = this.epoch;
  }

  /** The epoch now: a read of the screen that begins now carries it. */
  current(): number {
    return this.epoch;
  }

  /** The epoch after this Session's last answer that typed, or may have; 0 when none. */
  lastAnswer(row: Pick<SessionRow, 'harness' | 'pid'>): number {
    return this.sessions.get(processKey(row))?.answered ?? 0;
  }

  /** The epoch after this Session's last answer, whatever it typed; 0 when none. Its reads go to the tabs again when it moves. */
  lastChange(row: Pick<SessionRow, 'harness' | 'pid'>): number {
    return this.sessions.get(processKey(row))?.changed ?? 0;
  }

  /** The prompt an uncertain answer was for (`p:<id>`, `q:<id>`), while it still holds in this Needs you spell. */
  uncertainFor(row: Pick<SessionRow, 'harness' | 'pid' | 'statusSince'>): string | null {
    const u = this.sessions.get(processKey(row))?.uncertain;
    return u && u.since === row.statusSince ? u.key : null;
  }

  /**
   * A read of the screen ended (`read`: null when the screen wasn't read). The uncertain mark goes
   * once the Session no longer Needs you, or a read that began after the mark shows something else:
   * that prompt has gone. A read that failed, or one that can't tell which prompt is there (Fleet
   * can't read it whole, a form without its id), keeps the mark: it may still be that prompt.
   */
  seen(row: Pick<SessionRow, 'harness' | 'pid' | 'status'>, readEpoch: number, read: PromptRead | null): void {
    const s = this.sessions.get(processKey(row));
    if (!s?.uncertain) return;
    if (row.status !== 'needs-you') {
      s.uncertain = null;
      return;
    }
    if (!read?.ok || readEpoch < s.uncertain.epoch) return;
    const shown = screenKey(read.prompt);
    if (shown === 'incomplete' || shown === 'q:') return;
    if (shown !== s.uncertain.key) s.uncertain = null;
  }

  /** VIEW-4.3: an answer may start: one per Session at a time, and only from a read made after its last answer. */
  beginAnswer(row: SessionRow, readEpoch: number, key: string): void {
    const s = this.entry(row);
    if (s.answering) throw new AnswerError(409, IN_FLIGHT, 'stale');
    // Read before this server started: it knows nothing of the answers before (a restart forgets them).
    if (readEpoch < this.started) throw new AnswerError(409, RESTARTED, 'stale');
    if (readEpoch < s.answered) throw new AnswerError(409, s.maybe ? MAYBE_ELSEWHERE : ANSWERED_ELSEWHERE, 'stale');
    if (s.uncertain && s.uncertain.key === key && s.uncertain.since === row.statusSince) throw new AnswerError(409, UNCERTAIN_HERE);
    s.answering = true;
  }

  /**
   * The answer ended: `none` typed nothing, `typed` answered, `uncertain` may have typed. The epoch
   * moves on either way, so every tab gets a fresh read (one refused while this was typed holds only
   * until then); only an answer that typed, or may have, makes the reads from before stale. Returns
   * the epoch after it.
   */
  endAnswer(row: SessionRow, key: string, outcome: 'none' | 'typed' | 'uncertain'): number {
    const s = this.entry(row);
    s.answering = false;
    this.epoch = Math.max(this.epoch + 1, this.now());
    s.changed = this.epoch;
    if (outcome === 'none') return this.epoch;
    s.answered = this.epoch;
    s.maybe = outcome === 'uncertain';
    s.uncertain = outcome === 'uncertain' ? { key, since: row.statusSince, epoch: this.epoch } : null;
    return this.epoch;
  }

  /**
   * VIEW-4.4: Stop may press Esc: not while one is being pressed, nor within 10 s of the last in the
   * Busy spell it reached. That's the spell on when Esc went out, which may be newer than the one the
   * Stop was asked in (the Session can move on while the fresh list runs), so any spell that began
   * by then counts as reached, as does the one the Stop was asked in. The monitor may date a spell up
   * to one poll late (for Codex, Fleet's time is the Transcript's last write, or none), so a spell
   * dated up to one monitor interval after the Esc counts as reached too.
   *
   * VIEW-4.5: the Esc button shares the guard: one Esc per Status spell every 10 s, from Stop or Esc.
   */
  beginStop(row: SessionRow, status: EscStatus = 'busy'): void {
    const s = this.entry(row);
    const last = s.stop;
    const reached =
      last !== null && (last.since === row.statusSince || (row.statusSince !== null && row.statusSince <= last.at + MONITOR_INTERVAL_MS));
    if (s.stopping || (reached && this.now() - last.at < STOP_SETTLE_MS)) {
      throw new AnswerError(409, status === 'busy' ? STOPPED_ELSEWHERE : ESC_ELSEWHERE);
    }
    s.stopping = true;
  }

  /** Stop ended; `pressed`: Esc went out, or may have (by now: a spell that begins later is a new one). */
  endStop(row: SessionRow, pressed: boolean): void {
    const s = this.entry(row);
    s.stopping = false;
    if (pressed) s.stop = { at: this.now(), since: row.statusSince };
  }

  private entry(row: Pick<SessionRow, 'harness' | 'pid'>): SessionLedger {
    const key = processKey(row);
    let s = this.sessions.get(key);
    if (!s) {
      s = { answered: 0, changed: 0, maybe: false, answering: false, uncertain: null, stopping: false, stop: null };
      this.sessions.set(key, s);
    }
    return s;
  }
}

interface SessionLedger {
  /** The epoch after the last answer that typed, or may have; 0 when none. */
  answered: number;
  /** The epoch after the last answer, whatever it typed; 0 when none. */
  changed: number;
  /** That answer's outcome wasn't certain. */
  maybe: boolean;
  /** An answer is being typed now. */
  answering: boolean;
  /** An answer whose outcome wasn't certain: what it was for, its Needs you spell, and its epoch. */
  uncertain: { key: string; since: number | null; epoch: number } | null;
  /** Esc is being pressed now. */
  stopping: boolean;
  /** The last Esc (when its Stop ended, so no earlier than the key), and the Busy spell it was asked in. */
  stop: { at: number; since: number | null } | null;
}

const IN_FLIGHT = 'Another tab is answering this Session right now, so nothing was typed.';
const RESTARTED = 'Lookout restarted since this was read, so nothing was typed.';
const ANSWERED_ELSEWHERE = 'This was already answered from another tab, so nothing was typed.';
const MAYBE_ELSEWHERE = 'Another tab’s answer to this may have gone through, so nothing was typed. Check the terminal.';
const UNCERTAIN_HERE = 'It may have been answered, but Lookout can’t tell, so nothing was typed. Check the terminal.';
const STOPPED_ELSEWHERE = 'Esc was just pressed in this Session, so it wasn’t pressed again. Give it a few seconds to stop.';
const ESC_ELSEWHERE = 'Esc was just pressed in this Session, so it wasn’t pressed again. Give it a few seconds.';

/**
 * VIEW-4.2: reads the prompt of every Session some tab views, but calls Fleet only while that
 * Session is Controllable and Needs you: one `answer --list` per Session however many tabs view
 * it, the next a second after the last ended. A result goes to the tabs viewing it only when it
 * changed; a tab that starts viewing gets the last one at once. Every read of a Session that Needs
 * you counts as news the first time, even with nothing on screen, so the tabs have an epoch to
 * answer its question with.
 *
 * Each result carries the epoch from when its read began (see `AnswerLedger`). An answer to the
 * Session, even one that typed nothing, counts as a change, so a prompt read after it always
 * reaches the tabs, even when it looks the same; an answer to another Session doesn't. A read that
 * began before an answer to the Session landed (typed, or may have) is dropped and made again at
 * once: it may show the prompt just answered. A result also says when an uncertain answer was for
 * the prompt on screen, so no tab offers its buttons.
 *
 * A Session no tab views any more stops being read; a read still running finishes first, and a tab
 * viewing it again meanwhile (A→B→A) picks that read up, so two never overlap.
 */
export class PromptWatch {
  private readonly viewers = new Map<string, string>();
  private readonly polls = new Map<string, Poll>();
  private readonly opts: PromptWatchOptions;

  constructor(opts: PromptWatchOptions) {
    this.opts = opts;
  }

  view(clientId: string, sessionId: string | null): void {
    const before = this.viewers.get(clientId) ?? null;
    // What's been read already goes to this tab at once; a poll started now sends its first read to every viewer.
    const last = sessionId && sessionId !== before ? this.polls.get(sessionId)?.last : null;
    if (sessionId) this.viewers.set(clientId, sessionId);
    else this.viewers.delete(clientId);
    this.reconcile();
    if (sessionId && last) this.opts.sendTo(clientId, { type: 'prompt', sessionId, ...last });
  }

  drop(clientId: string): void {
    this.view(clientId, null);
  }

  /** Session ids whose prompt is followed (for tests and diagnostics). */
  following(): string[] {
    return [...this.polls.values()].filter((p) => !p.stopped).map((p) => p.sessionId);
  }

  stop(): void {
    for (const p of this.polls.values()) {
      p.stopped = true;
      if (p.timer) clearTimeout(p.timer);
    }
    this.polls.clear();
  }

  private reconcile(): void {
    const wanted = new Set(this.viewers.values());
    for (const [id, p] of this.polls) {
      if (wanted.has(id) || p.stopped) continue;
      p.stopped = true;
      if (p.timer) clearTimeout(p.timer);
      p.timer = null;
      // A read still running ends first (Lookout can't cancel it), and then drops the poll.
      if (!p.reading) this.polls.delete(id);
    }
    for (const id of wanted) {
      const p = this.polls.get(id);
      if (p) {
        // Viewed again while its last read runs: that read carries on as this poll's.
        p.stopped = false;
        continue;
      }
      const poll: Poll = { sessionId: id, timer: null, stopped: false, reading: false, last: null, key: NOTHING };
      this.polls.set(id, poll);
      void this.poll(poll);
    }
  }

  private async poll(p: Poll): Promise<void> {
    const { ledger } = this.opts;
    const row = this.opts.lookup(p.sessionId);
    // Read before the screen is.
    const epoch = ledger.current();
    const changed = row ? ledger.lastChange(row) : 0;
    const read = !!row && row.controllable && row.status === 'needs-you';
    let result: PromptRead | null = null;
    p.reading = true;
    try {
      if (read) result = await listPrompt(this.opts, row);
    } finally {
      p.reading = false;
    }
    if (p.stopped) {
      if (this.polls.get(p.sessionId) === p) this.polls.delete(p.sessionId);
      return;
    }
    // An answer landed while the screen was read: it may show the prompt just answered, and a tab's
    // click on it would be refused as already answered. Read again now instead.
    if (row && ledger.lastAnswer(row) > epoch) {
      p.timer = setTimeout(() => void this.poll(p), 0);
      p.timer.unref?.();
      return;
    }
    // A failed read shows the tabs no prompt, but keeps an uncertain mark (see `seen`).
    const prompt = result?.ok ? result.prompt : null;
    let uncertain: string | null = null;
    if (row) {
      ledger.seen(row, epoch, result);
      uncertain = ledger.uncertainFor(row);
    }
    // VIEW-4.5: the Needs you spell the read was made in, so a tab can tell a read from this spell
    // from one of an earlier one; a new spell is news even when the screen reads the same.
    const since = read && row ? row.statusSince : null;
    const key = JSON.stringify({ read, prompt, changed, uncertain, since });
    if (key !== p.key) {
      p.key = key;
      p.last = { prompt, epoch, uncertain, since };
      for (const [clientId, sessionId] of this.viewers) {
        if (sessionId === p.sessionId) this.opts.sendTo(clientId, { type: 'prompt', sessionId, ...p.last });
      }
    }
    p.timer = setTimeout(() => void this.poll(p), this.opts.intervalMs ?? PROMPT_INTERVAL_MS);
    p.timer.unref?.();
  }
}

export interface PromptWatchOptions {
  runner: Runner;
  fleetBin: () => string;
  lookup(sessionId: string): SessionRow | null;
  sendTo(clientId: string, event: Extract<ServerEvent, { type: 'prompt' }>): void;
  ledger: AnswerLedger;
  env?: NodeJS.ProcessEnv;
  intervalMs?: number;
}

interface Poll {
  sessionId: string;
  timer: NodeJS.Timeout | null;
  /** No tab views it: it reads no more (a read already running still ends). */
  stopped: boolean;
  /** A read is running now. */
  reading: boolean;
  /** The last result sent, or null while there was nothing to say. */
  last: { prompt: ScreenPrompt | null; epoch: number; uncertain: string | null; since: number | null } | null;
  /**
   * What was last sent: whether the screen was read, the prompt, the Session's last answer (whatever
   * it typed), the uncertain mark, and the Needs you spell the read was made in (VIEW-4.5).
   */
  key: string;
}

/** A Session that doesn't Need you, never answered from here: nothing to tell a tab. */
const NOTHING = JSON.stringify({ read: false, prompt: null, changed: 0, uncertain: null, since: null });

// ---------------------------------------------------------------------------------------------
// Answering (VIEW-4.1–4.3)

/**
 * VIEW-4: `POST /api/sessions/:id/answer`'s body, checked before it goes anywhere near argv: a
 * permission prompt's id and choice number, or a question's id and one answer per question
 * (option indexes and/or one line of text, as Fleet takes them); and the epoch of the read it
 * answers (see `AnswerLedger`).
 */
export function parseAnswerRequest(body: unknown): AnswerRequest {
  const invalid = () => new AnswerError(400, 'Invalid answer.');
  if (!isRecord(body)) throw invalid();
  const { epoch } = body;
  if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) throw invalid();
  if (body.kind === 'permission') {
    const { prompt, choice } = body;
    if (typeof prompt !== 'string' || !PROMPT_ID.test(prompt)) throw invalid();
    if (typeof choice !== 'number' || !Number.isSafeInteger(choice) || choice < 1 || choice > MAX_OPTIONS) throw invalid();
    return { kind: 'permission', prompt, choice, epoch };
  }
  if (body.kind !== 'question') throw invalid();
  const { question, answers } = body;
  if (typeof question !== 'string' || !QUESTION_ID.test(question)) throw invalid();
  if (!Array.isArray(answers) || answers.length === 0 || answers.length > MAX_QUESTIONS) throw invalid();
  return { kind: 'question', question, answers: answers.map((a) => parseQuestionAnswer(a, invalid)), epoch };
}

function parseQuestionAnswer(a: unknown, invalid: () => AnswerError): QuestionAnswer {
  if (!isRecord(a) || !Array.isArray(a.options) || a.options.length > MAX_OPTIONS) throw invalid();
  const options = [...new Set(a.options)].sort((x, y) => Number(x) - Number(y));
  if (!options.every((o) => typeof o === 'number' && Number.isSafeInteger(o) && o >= 0 && o < MAX_OPTIONS)) throw invalid();
  if (a.text !== undefined && typeof a.text !== 'string') throw invalid();
  const raw = a.text ?? '';
  // Typed into a live terminal: one line, no control characters or escape sequences (they'd be keypresses).
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw)) throw new AnswerError(400, 'The answer has characters that can’t be typed.');
  const text = raw.trim();
  if ([...text].length > MAX_TEXT) throw new AnswerError(400, 'The answer is too long.');
  if (options.length === 0 && text === '') throw invalid();
  return text ? { options: options as number[], text } : { options: options as number[] };
}

/**
 * VIEW-4.1–4.3: answers through `fleet answer <target> --json --allow-attached`: `--choice <n>
 * --prompt <id>` for a permission prompt, `--question <tool_use_id> --answers <json>` for a
 * question. Fleet types only while the terminal still shows that very prompt, untouched;
 * otherwise nothing is typed and the refusal is said in plain words. Never retried.
 *
 * `--allow-attached`: the user is the only person who could be typing (Key decisions); Fleet
 * still holds the Session's lock and checks the prompt is untouched.
 *
 * Across tabs (`AnswerLedger`): one answer per Session at a time, none from a read older than the
 * Session's last answer, and none to a prompt an uncertain answer was for. Refused, nothing typed.
 */
export async function answerPrompt(opts: AnswererOptions, sessionId: string, req: AnswerRequest): Promise<AnswerResult> {
  const row = opts.lookup(sessionId);
  if (!row) throw new AnswerError(404, 'This Session isn’t running, so nothing was typed.');
  if (!row.controllable) throw new AnswerError(409, 'This Session runs in another app, so Lookout can’t answer it. Answer it in its terminal.');
  // Fleet reads only Claude Code's question forms.
  if (req.kind === 'question' && row.harness !== 'claude') {
    throw new AnswerError(409, 'Lookout can only answer Claude Code’s questions. Answer this one in the terminal.');
  }
  const key = answerKey(req);
  opts.ledger.beginAnswer(row, req.epoch, key);
  let outcome: 'none' | 'typed' | 'uncertain' = 'none';
  let epoch: number;
  try {
    const target = await typingTarget(opts, row);
    const how =
      req.kind === 'permission'
        ? ['--choice', String(req.choice), '--prompt', req.prompt]
        : ['--question', req.question, '--answers', JSON.stringify(req.answers)];
    let stdout: string;
    try {
      stdout = await opts.runner(opts.fleetBin(), ['--local', 'answer', target, '--json', '--allow-attached', ...how], {
        timeoutMs: ANSWER_TIMEOUT_MS,
        env: env(opts),
      });
    } catch (err) {
      const failure = answerFailure(err as RunError);
      if (failure.typed) outcome = 'uncertain';
      throw failure.error;
    }
    const res = parseObject(stdout);
    if (res?.ok !== true || res.answered !== true) {
      outcome = 'uncertain';
      throw new AnswerError(502, UNCERTAIN);
    }
    outcome = 'typed';
  } finally {
    // The epoch moves on, so every tab gets a fresh read; typed, or may have: every read from before is stale.
    epoch = opts.ledger.endAnswer(row, key, outcome);
  }
  return { epoch };
}

const UNCERTAIN = 'It may have been answered, but Lookout can’t tell. Check the terminal.';
const NOTHING_TYPED = 'so nothing was typed. Answer it in the terminal.';

/** VIEW-4.3: Fleet refused before typing anything: why, in plain words, by kind. Nothing names tmux (0001). */
const REFUSED: Readonly<Record<string, string>> = {
  prompt_not_on_screen: `The terminal no longer shows this prompt as it was, ${NOTHING_TYPED}`,
  prompt_incomplete: `Lookout can’t read this prompt whole, ${NOTHING_TYPED}`,
  choice_invalid: `That choice isn’t on the prompt any more, ${NOTHING_TYPED}`,
  question_not_active: `This question isn’t the one waiting any more, ${NOTHING_TYPED}`,
  question_not_found: `Fleet can’t find this question in the Transcript, ${NOTHING_TYPED}`,
  question_answered: 'This question was already answered, so nothing was typed.',
  not_waiting: 'The Session isn’t waiting on this question any more, so nothing was typed.',
  answer_invalid: `Lookout can’t type this answer safely (it could read as another option), ${NOTHING_TYPED}`,
  busy: `Fleet is typing into this Session right now, ${NOTHING_TYPED}`,
  human_attached: 'Someone is attached to this Session’s terminal, so nothing was typed. Answer it there.',
  harness_unsupported: `Lookout can’t answer this Harness’s questions, ${NOTHING_TYPED}`,
  transcript_not_found: `Fleet can’t find this Session’s Transcript, ${NOTHING_TYPED}`,
  backend_unsupported: 'Lookout can’t reach this Session’s terminal, so nothing was typed. Answer it there.',
  target_not_found: 'This Session is no longer running, so nothing was typed.',
  target_ambiguous: `Fleet couldn’t tell which Session this is, ${NOTHING_TYPED}`,
  target_invalid: `Fleet couldn’t tell which Session this is, ${NOTHING_TYPED}`,
  usage: `Fleet didn’t take the answer, ${NOTHING_TYPED}`,
};

/** Keys went out, or may have: what they did isn't certain. */
const TYPED: Readonly<Record<string, string>> = {
  outcome_uncertain: UNCERTAIN,
  prompt_changed: 'The prompt changed while Lookout was answering, so it stopped part-way. Check the terminal and finish there.',
  send_failed: 'Typing failed part-way. Check the terminal and finish there.',
};

/** Why the answer failed, and whether keys may have gone out before it did (`typed`). */
function answerFailure(e: RunError): { error: AnswerError; typed: boolean } {
  if (e.code === 'ENOENT') return { error: new AnswerError(503, 'Fleet isn’t installed, so nothing was typed.'), typed: false };
  if (e.timedOut) return { error: new AnswerError(504, 'Fleet took too long. It may have been answered; check the terminal.'), typed: true };
  if (/unrecognized subcommand/i.test(e.stderr ?? '')) return { error: new AnswerError(501, 'This Fleet can’t answer prompts yet. Update the Fleet fork.'), typed: false };
  const res = parseObject(e.stdout);
  const kind = typeof res?.kind === 'string' ? res.kind : null;
  if (kind && Object.hasOwn(REFUSED, kind)) return { error: new AnswerError(409, REFUSED[kind]!), typed: false };
  // Anything else may have come after a key: the tabs' buttons for what they last read are stale.
  if (kind && Object.hasOwn(TYPED, kind)) return { error: new AnswerError(502, TYPED[kind]!), typed: true };
  return { error: new AnswerError(502, `Couldn’t answer: ${fleetReason(res, e)}. Check the terminal.`), typed: true };
}

// ---------------------------------------------------------------------------------------------
// Stop (VIEW-4.4) and Esc (VIEW-4.5)

/** How Stop and the Esc button word what they say: Stop speaks of stopping, Esc of pressing it. */
const ESC_WORDS: Readonly<Record<EscStatus, { otherApp: string; check: string; notNow: string; there: string; failed: string }>> = {
  busy: {
    otherApp: 'This Session runs in another app, so Lookout can’t stop it.',
    check: 'Couldn’t check that the Session is still working, so Esc wasn’t pressed. Try again.',
    notNow: 'This Session isn’t working on anything now, so Esc wasn’t pressed.',
    there: 'Stop it in the terminal.',
    failed: 'Couldn’t stop it',
  },
  'needs-you': {
    otherApp: 'This Session runs in another app, so Lookout can’t press Esc in it.',
    check: 'Couldn’t check that the Session is still waiting on you, so Esc wasn’t pressed. Try again.',
    notNow: 'This Session isn’t waiting on you now, so Esc wasn’t pressed.',
    there: 'Press Esc in the terminal.',
    failed: 'Couldn’t press Esc',
  },
};

/**
 * VIEW-4.4: interrupts a Busy Session as Esc does in its terminal: `fleet keys <target> Escape
 * --json`. Read again right before: only a Session a fresh `fleet list` still has as Busy gets
 * the key, since Esc on a prompt would decline it. One Esc per Busy spell every 10 s, whichever tab
 * asks: in Claude Code a second Esc opens its rewind menu.
 *
 * VIEW-4.5: the Esc button is the same for a Session that Needs you (`status`): a fresh list must
 * still have it Needs you, and the same guard holds, so one Esc per spell every 10 s from either.
 *
 * Known gap: a prompt can appear between the fresh list and the key (Technical approach).
 */
export async function stopSession(opts: AnswererOptions, sessionId: string, status: EscStatus = 'busy'): Promise<void> {
  const words = ESC_WORDS[status];
  const known = opts.lookup(sessionId);
  if (!known) throw new AnswerError(404, 'This Session isn’t running.');
  if (!known.controllable) throw new AnswerError(409, words.otherApp);
  opts.ledger.beginStop(known, status);
  let pressed = false;
  try {
    const fresh = await opts.freshList();
    if (fresh.kind !== 'ok') throw new AnswerError(503, words.check);
    const row = freshRows(fresh).find((r) => (isPidOnly(known) ? sameProcess(known, r) : r.id === known.id && r.harness === known.harness));
    if (!row) throw new AnswerError(409, 'This Session is no longer running, so Esc wasn’t pressed.');
    if (row.status !== status) throw new AnswerError(409, words.notNow);
    if (!row.controllable) throw new AnswerError(409, words.otherApp);
    let stdout: string;
    try {
      stdout = await opts.runner(opts.fleetBin(), ['--local', 'keys', exactTarget(row), 'Escape', '--json'], {
        timeoutMs: KEYS_TIMEOUT_MS,
        env: env(opts),
      });
    } catch (err) {
      const failure = stopFailure(err as RunError, status);
      pressed = failure.pressed;
      throw failure.error;
    }
    pressed = true;
    if (parseObject(stdout)?.ok !== true) throw new AnswerError(502, `${words.failed}: Fleet gave an unexpected answer. Check the terminal.`);
  } finally {
    opts.ledger.endStop(known, pressed);
  }
}

/** Fleet's refusals before any key went out, for Stop or Esc; null for anything else. */
function notPressed(kind: string, status: EscStatus): string | null {
  const there = ESC_WORDS[status].there;
  switch (kind) {
    case 'busy':
      return 'Fleet is typing into this Session right now, so Esc wasn’t pressed. Try again.';
    case 'target_not_found':
      return 'This Session is no longer running, so Esc wasn’t pressed.';
    case 'target_ambiguous':
    case 'target_invalid':
      return `Fleet couldn’t tell which Session this is, so Esc wasn’t pressed. ${there}`;
    case 'backend_unsupported':
      return `Lookout can’t reach this Session’s terminal, so Esc wasn’t pressed. ${status === 'busy' ? 'Stop it there.' : 'Press it there.'}`;
    default:
      return null;
  }
}

/** Why Stop (or Esc) failed, and whether Esc may have gone out before it did (`pressed`). */
function stopFailure(e: RunError, status: EscStatus): { error: AnswerError; pressed: boolean } {
  if (e.code === 'ENOENT') return { error: new AnswerError(503, 'Fleet isn’t installed, so Esc wasn’t pressed.'), pressed: false };
  if (e.timedOut) return { error: new AnswerError(504, 'Fleet took too long. Check the terminal.'), pressed: true };
  if (/unrecognized subcommand/i.test(e.stderr ?? '')) return { error: new AnswerError(501, 'This Fleet can’t press keys yet. Update the Fleet fork.'), pressed: false };
  const res = parseObject(e.stdout);
  const kind = typeof res?.kind === 'string' ? res.kind : null;
  const refused = kind ? notPressed(kind, status) : null;
  if (refused) return { error: new AnswerError(409, refused), pressed: false };
  return { error: new AnswerError(502, `${ESC_WORDS[status].failed}: ${fleetReason(res, e)}. Check the terminal.`), pressed: true };
}

/** VIEW-4.5: Stop's optional body, the Status Esc is for: none is Stop (Busy); anything else is refused. */
export function parseEscStatus(body: unknown): EscStatus {
  const status = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>).status : undefined;
  if (status === 'busy' || status === 'needs-you') return status;
  throw new AnswerError(400, 'Invalid request.');
}

// ---------------------------------------------------------------------------------------------

/** Fleet's error on one line, redacted, with anything naming tmux reworded (0001). */
function fleetReason(res: Record<string, unknown> | null, e: RunError): string {
  const text = typeof res?.error === 'string' ? res.error : (e.stderr ?? e.message);
  const line = sanitizeLine(text, 200)?.replace(/[.\s]+$/, '');
  if (!line) return 'no details';
  return /tmux|send-keys|capture-pane|paste-buffer|kill-session/i.test(line) ? 'the Session host refused' : line;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseObject(text: string | undefined): Record<string, unknown> | null {
  if (!text?.trim()) return null;
  try {
    const v: unknown = JSON.parse(text);
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}
