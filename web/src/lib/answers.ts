import type { AnswerDetail, ChatEntry, ChatQuestion, EscStatus, HeldReason, PaneSize, QuestionAnswer, ScreenPrompt, SessionRow } from '@shared/types.ts';
import { createContext } from 'react';

/**
 * VIEW-4.4: after one Esc, Stop waits this long for the Session to leave Busy before it can be
 * pressed again: in Claude Code a second Esc opens its rewind menu.
 */
export const STOP_SETTLE_MS = 10_000;

export type PermissionPrompt = Extract<ScreenPrompt, { kind: 'permission' }>;

/** What the tab last heard of a Session's terminal prompt (VIEW-4.2), and the server's answer epoch when it was read. */
export interface ScreenState {
  prompt: ScreenPrompt | null;
  epoch: number;
  /** An answer whose outcome Lookout can't tell was for this prompt (`p:<id>`) or question (`q:<id>`), from any tab. */
  uncertain: string | null;
  /** VIEW-4.5: the Needs you spell the read was made in (the row's `statusSince`); null or absent when nothing was read. */
  since?: number | null;
  /** VIEW-4.6: Fleet could answer the prompt on screen now; false or absent when it can't, or nothing was read. */
  answerable?: boolean;
  /** VIEW-4.6: why it can't, as Fleet's code; null or absent when it can, nothing was read, or the code is one Lookout doesn't know. */
  detail?: AnswerDetail | null;
  /** VIEW-4.6: the terminal's size, when Fleet gave it. */
  pane?: PaneSize | null;
  /** VIEW-4.6: the read came from a Fleet older than Lookout's pin, which doesn't say whether it could answer. */
  oldFleet?: boolean;
  /**
   * VIEW-4.7: when this tab's reads stopped saying whether the question can be answered (no
   * `answerable`, no `detail`: a read that failed or timed out), on the tab's clock; null or absent
   * while they say.
   */
  unread?: number | null;
  /**
   * VIEW-4.7: `detail`, `pane` and `oldFleet` are the last read's that said why not, kept through
   * the failed reads since (`unread`), so its line stays for `READ_WAIT_MS` instead of flickering.
   */
  carried?: boolean;
}

/** VIEW-4: the latest answer this tab sent to a Session, and what came of it. */
export interface AnswerAttempt {
  /** What it answered: `p:<prompt id>` or `q:<tool_use id>`. */
  key: string;
  /**
   * - `refused`: nothing typed (or it may have been); holds for that prompt in that Needs you spell.
   * - `stale`: another tab answered first, or was answering; holds only until a newer read.
   * - `invalid`: the server couldn't take the answer as written (a question's text); the form stays.
   */
  phase: 'sending' | 'sent' | 'refused' | 'stale' | 'invalid';
  /** Why nothing was (or may not have been) typed, for people. */
  message: string | null;
  /** `sent`: the server's answer epoch after it. A prompt read before it is stale. */
  epoch: number | null;
  /** The epoch of the read it answered. */
  read: number;
  /** The Needs you spell it belongs to: the row's `statusSince` when it was sent. */
  since: number | null;
}

/** VIEW-4.4/4.5: a Stop, or an Esc, this tab pressed. */
export interface StopRequest {
  at: number;
  /** The Status it was pressed in: `busy` for Stop, `needs-you` for the Esc button. */
  status: EscStatus;
  /** The spell it belongs to: the row's `statusSince` when it was pressed. */
  since: number | null;
  /** The request is in flight. */
  pending: boolean;
  /** Why Esc wasn't pressed, for people. */
  error: string | null;
}

export const promptKey = (id: string) => `p:${id}`;
export const questionKey = (id: string) => `q:${id}`;

/** The Session's process: a Codex Session's id changes when it gets its session id; its process doesn't. */
export const processKey = (row: Pick<SessionRow, 'harness' | 'pid'>) => `${row.harness}:${row.pid}`;

export const INCOMPLETE = 'Lookout can’t read this prompt whole, so it won’t answer it. Answer it in the terminal.';
/** An answer from some tab may have landed on it (the server's read says so). */
export const UNCERTAIN = 'It may have been answered, but Lookout can’t tell. Check the terminal.';
/** The request went out, but no answer came back from Lookout's server. */
export const LOST_ANSWER = 'Lost the connection to Lookout. It may have been answered; check the terminal.';
export const LOST_STOP = 'Lost the connection to Lookout. Esc may have been pressed; check the terminal.';
export const TOUCHED = 'This prompt was changed in the terminal, so Lookout won’t answer it. Answer it there.';
export const QUESTION_TOUCHED = 'You started answering in the terminal, so Lookout won’t. Finish it there.';
/** VIEW-4.6: why a question can't be answered from here, by Fleet's reason (`detail`). */
export const QUESTION_LAYOUT = 'Lookout can’t answer this kind of question. Answer it in the terminal.';
export const QUESTION_OTHER = 'The terminal shows a different question, so Lookout won’t answer this one. Answer it in the terminal.';
/** Its tabs, question or options aren't this question's: maybe another, maybe this one drawn wrapped or cut short. */
export const QUESTION_MISMATCH = 'The form in the terminal doesn’t match this question, so Lookout won’t answer it. Answer it in the terminal.';
export const QUESTION_NOT_SHOWN = 'The terminal doesn’t show this question, so Lookout won’t answer it. Answer it in the terminal.';
export const QUESTION_UNCHECKED = 'Lookout can’t check this question in the terminal right now, so it won’t answer it. Answer it in the terminal.';
/** A Fleet older than Lookout's pin: it can answer, but can't say beforehand whether it will (as the server says of a Fleet without `answer`). */
export const QUESTION_OLD_FLEET = 'This Fleet can’t check questions yet, so Lookout won’t answer this one. Update the Fleet fork, or answer it in the terminal.';

/**
 * VIEW-4.6: a question form, or a permission prompt, taller than the terminal (Fleet's `clipped`),
 * with its size when Fleet gave it. A Session Lookout started has no window to make bigger (the
 * Terminal preview only shows the same pane): it's answered from a terminal app opened on it, and
 * a bigger one fits the next.
 */
export function doesntFit(what: 'question' | 'prompt', pane: PaneSize | null | undefined): string {
  const size = pane ? ` (${pane.cols}×${pane.rows})` : '';
  return `This ${what} doesn’t fit in the terminal${size}, so Lookout can’t read it whole. Open the Session in a terminal app and answer it there. A bigger terminal lets Lookout answer ${what}s like this.`;
}

/**
 * VIEW-4.7: how long a question just asked waits for its form to be drawn before its panel says the
 * terminal doesn't show it. Claude Code writes the question to the Transcript a moment before it
 * draws the form, and a read in between isn't worth an alert.
 */
export const FORM_WAIT_MS = 5_000;

/**
 * VIEW-4.7: how long reads that say nothing (one failed, or timed out: `--list` gives up after 4 s)
 * are waited out, from the first of them, before the question's panel says Lookout can't check it.
 * One slow read isn't worth an alert, the Esc button, or the form going away.
 */
export const READ_WAIT_MS = 5_000;

/** Buttons only for a running, Controllable Session that Needs you (VIEW-4.1, 4.2; VIEW-5.2, 5.3). */
function answerable(row: SessionRow, ended: boolean): boolean {
  return !ended && row.controllable && row.status === 'needs-you';
}

/**
 * The attempt, when it's for this prompt and this Needs you spell. A `stale` refusal counts only
 * until a read newer than the one it answered.
 */
function attemptFor(attempt: AnswerAttempt | undefined, key: string, row: SessionRow, screen: ScreenState | undefined): AnswerAttempt | null {
  if (!attempt || attempt.key !== key || attempt.since !== row.statusSince) return null;
  if (attempt.phase === 'stale' && (screen?.epoch ?? 0) > attempt.read) return null;
  return attempt;
}

export type PermissionPanel =
  | { kind: 'buttons'; prompt: PermissionPrompt; sending: boolean }
  /** No buttons: why, in place of them. `prompt` is shown above it when there is one. */
  | { kind: 'message'; prompt: PermissionPrompt | null; message: string };

/**
 * VIEW-4.2/4.3: what the chat shows for a permission prompt on the terminal: its choices as
 * buttons; or, when Lookout can't answer it safely, why, in place of them; or nothing.
 */
export function permissionPanel(row: SessionRow, ended: boolean, screen: ScreenState | undefined, attempt: AnswerAttempt | undefined): PermissionPanel | null {
  const p = screen?.prompt;
  if (!answerable(row, ended) || !p || p.kind === 'question') return null;
  if (p.kind === 'incomplete') return { kind: 'message', prompt: null, message: screen.detail === 'clipped' ? doesntFit('prompt', screen.pane) : INCOMPLETE };
  // An answer landed after this was read: it's stale, whatever it shows (the next read says what's there now).
  if (attempt?.phase === 'sent' && attempt.epoch !== null && screen.epoch < attempt.epoch) return null;
  const a = attemptFor(attempt, promptKey(p.id), row, screen);
  if (a && a.phase !== 'sending' && a.phase !== 'sent') return { kind: 'message', prompt: p, message: a.message ?? TOUCHED };
  // Some tab's answer to it may have landed: no tab answers it again.
  if (screen.uncertain === promptKey(p.id)) return { kind: 'message', prompt: p, message: UNCERTAIN };
  if (!p.untouched) return { kind: 'message', prompt: p, message: TOUCHED };
  return { kind: 'buttons', prompt: p, sending: a?.phase === 'sending' };
}

export interface QuestionPanel {
  /** The question's tool_use id. */
  id: string;
  /**
   * `blocked`: Lookout won't answer it (it was refused, touched in the terminal, or the latest read
   * doesn't show its form as Fleet could answer it, VIEW-4.6); `message` says why. `ready` with a
   * `message`: the last answer couldn't be taken as written; fix it in the form. `reading`: the tab
   * has no read of the screen yet, so no epoch to answer with (the server would refuse the answer as
   * read before it started), a question just asked waits for its form to be drawn, or a read that
   * failed is waited out (VIEW-4.7); the buttons wait, locked but keeping focus, with what was picked
   * and typed.
   */
  phase: 'ready' | 'reading' | 'sending' | 'sent' | 'blocked';
  message: string | null;
}

/**
 * VIEW-4.1: the question the chat can answer, and how its answer went; null when none can. Only
 * Claude Code's (Fleet reads no Codex question forms), and only the one call waiting, as Fleet
 * answers no other. VIEW-4.6: its buttons only once the latest read shows its form, untouched, and
 * Fleet could answer it now; otherwise why, by Fleet's reason (see `notAnswerable`).
 */
export function questionPanel(
  row: SessionRow,
  ended: boolean,
  entries: readonly ChatEntry[],
  screen: ScreenState | undefined,
  attempt: AnswerAttempt | undefined,
  now: number,
): QuestionPanel | null {
  if (!answerable(row, ended) || row.harness !== 'claude') return null;
  const p = screen?.prompt ?? null;
  // A permission prompt on screen: the question isn't what the Session waits on.
  if (p && p.kind !== 'question') return null;
  const pending = entries.filter((e): e is Extract<ChatEntry, { kind: 'question' }> => e.kind === 'question' && e.status === 'pending');
  if (pending.length !== 1) return null;
  const q = pending[0]!;
  const a = attemptFor(attempt, questionKey(q.id), row, screen);
  if (a?.phase === 'refused' || a?.phase === 'stale') return { id: q.id, phase: 'blocked', message: a.message };
  if (a?.phase === 'sending' || a?.phase === 'sent') return { id: q.id, phase: a.phase, message: null };
  if (screen?.uncertain === questionKey(q.id)) return { id: q.id, phase: 'blocked', message: UNCERTAIN };
  // No read of the screen yet: nothing to answer with until the first one comes.
  if (!screen) return { id: q.id, phase: 'reading', message: null };
  if (p?.id === q.id && p.untouched && screen.answerable === true) return { id: q.id, phase: 'ready', message: a?.phase === 'invalid' ? a.message : null };
  const why = notAnswerable(q, screen, row, now);
  return why === null ? { id: q.id, phase: 'reading', message: null } : { id: q.id, phase: 'blocked', message: why };
}

/**
 * VIEW-4.6/4.7: why the pending question `q` can't be answered from the latest read, in plain words
 * by Fleet's reason; null while it waits. A form started in the terminal, one taller than the
 * terminal, one in a layout Fleet doesn't read, and a Fleet too old to say are said at once. The
 * rest (no form, another question's, or no read Lookout can use) wait `FORM_WAIT_MS` from when the
 * question appeared: its Transcript time, or the Needs you spell's start if that's later. A read
 * that says nothing (it failed) also waits `READ_WAIT_MS` from the first such read (`unread`).
 */
function notAnswerable(q: Extract<ChatEntry, { kind: 'question' }>, screen: ScreenState, row: SessionRow, now: number): string | null {
  // A line kept through failed reads (`carried`) gives way after READ_WAIT_MS of them.
  if (screen.carried && screen.unread != null && now - screen.unread >= READ_WAIT_MS) return QUESTION_UNCHECKED;
  const p = screen.prompt;
  const form = p?.kind === 'question' ? p : null;
  if ((form?.id === q.id && !form.untouched) || screen.detail === 'touched' || screen.detail === 'cursor_moved') return QUESTION_TOUCHED;
  if (screen.detail === 'clipped') return doesntFit('question', screen.pane);
  if (screen.detail === 'layout_unsupported') return QUESTION_LAYOUT;
  if (screen.oldFleet) return QUESTION_OLD_FLEET;
  const asked = Math.max(row.statusSince ?? -Infinity, Date.parse(q.ts ?? '') || -Infinity);
  if (now - asked < FORM_WAIT_MS) return null;
  if (form?.id && form.id !== q.id) return QUESTION_OTHER;
  switch (screen.detail) {
    case 'no_form':
      return QUESTION_NOT_SHOWN;
    case 'tabs':
    case 'question':
    case 'options':
      return QUESTION_MISMATCH;
    case 'different_prompt':
      return QUESTION_OTHER;
    default:
      return screen.unread != null && now - screen.unread < READ_WAIT_MS ? null : QUESTION_UNCHECKED;
  }
}

/** VIEW-4.1: one question with one choice answers on click; several questions, or a multi-select one, are picked, then submitted. */
export function answersOnClick(questions: readonly ChatQuestion[]): boolean {
  return questions.length === 1 && !questions[0]!.multiSelect;
}

/** The picks and text of one question, before Submit. */
export interface Draft {
  picked: number[];
  text: string;
}

export const emptyDraft: Draft = { picked: [], text: '' };

/** VIEW-4.6: where a question form keeps its picks and text, by the question's tool_use id (a Map will do). */
export interface DraftKeeper {
  get(questionId: string): readonly Draft[] | undefined;
  set(questionId: string, drafts: readonly Draft[]): void;
}

/** VIEW-4.6: the questions' picks and text, kept by App per Session (by its id), then per question. */
export type QuestionDrafts = Map<string, Map<string, readonly Draft[]>>;

/**
 * VIEW-4.6: lets go of drafts whose question is no longer pending: one the tab's chat for its
 * Session shows answered, declined or abandoned, and all of a Session that ended (once the list is
 * known). A Session whose chat the tab doesn't hold keeps its drafts until its chat or its end says.
 */
export function tidyQuestionDrafts(
  kept: QuestionDrafts,
  ctx: { live: ReadonlyMap<string, unknown>; listKnown: boolean; chats: ReadonlyMap<string, { entries: readonly ChatEntry[] }> },
): void {
  for (const [sessionId, questions] of kept) {
    if (ctx.listKnown && !ctx.live.has(sessionId)) {
      kept.delete(sessionId);
      continue;
    }
    for (const e of ctx.chats.get(sessionId)?.entries ?? []) {
      if (e.kind === 'question' && e.status !== 'pending') questions.delete(e.id);
    }
    if (questions.size === 0) kept.delete(sessionId);
  }
}

/** Picking option `i`: toggles it when several can be picked; otherwise it's the one answer (any text goes, as in the terminal). */
export function pick(q: ChatQuestion, d: Draft, i: number): Draft {
  if (q.multiSelect) return { ...d, picked: d.picked.includes(i) ? d.picked.filter((x) => x !== i) : [...d.picked, i].sort((a, b) => a - b) };
  return { picked: d.picked[0] === i ? [] : [i], text: '' };
}

/**
 * Text that can be typed into the terminal as one line: line breaks and tabs become spaces (a
 * pasted tab would be a keypress), other control characters go.
 */
export function typeable(text: string): string {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  return text.replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
}

/** Typing "something else": with one choice it replaces the option picked; with several it joins them. */
export function typeText(q: ChatQuestion, d: Draft, text: string): Draft {
  const clean = typeable(text);
  return q.multiSelect || clean.trim() === '' ? { ...d, text: clean } : { picked: [], text: clean };
}

/** VIEW-4.1: the answers to send, one per question, or null while a question has none (Submit stays disabled). */
export function draftAnswers(questions: readonly ChatQuestion[], drafts: readonly Draft[]): QuestionAnswer[] | null {
  const out: QuestionAnswer[] = [];
  for (const [i, q] of questions.entries()) {
    const d = drafts[i] ?? emptyDraft;
    const text = typeable(d.text).trim();
    const count = d.picked.length + (text ? 1 : 0);
    if (q.multiSelect ? count === 0 : count !== 1) return null;
    out.push(text ? { options: d.picked, text } : { options: d.picked });
  }
  return out;
}

/**
 * VIEW-4.4: Stop shows only while a Controllable Session is Busy. One click sends one Esc; then it
 * reads "Stopping…" and stays disabled until the Status leaves Busy, or for 10 s. A failure
 * enables it again, with why.
 */
export function stopButton(row: SessionRow, ended: boolean, req: StopRequest | undefined, now: number): { stopping: boolean; error: string | null } | null {
  if (ended || !row.controllable || row.status !== 'busy') return null;
  const r = req && req.status === 'busy' && req.since === row.statusSince ? req : null;
  if (!r) return { stopping: false, error: null };
  if (r.error) return { stopping: false, error: r.error };
  return { stopping: r.pending || now - r.at < STOP_SETTLE_MS, error: null };
}

/** VIEW-3.4, VIEW-3.7: a failed send's message, and why Fleet held it when it did (null otherwise, or for a reason Lookout doesn't know). */
export interface SendFailure {
  message: string;
  held: HeldReason | null;
}

/** VIEW-3.7: while the Esc button shows, what a send held for no input box, or for a prompt, adds. */
export const ESC_POINTER: Readonly<Partial<Record<HeldReason, string>>> = {
  no_input_box: 'The Esc button at the top of the pane does that.',
  prompt: 'Or cancel it with the Esc button at the top of the pane.',
};

/** VIEW-3.7: the composer's error; a held send points to the Esc button while it shows (VIEW-4.5). */
export function sendErrorText(failure: SendFailure | null | undefined, escShown: boolean): string | null {
  if (!failure) return null;
  const pointer = escShown && failure.held ? ESC_POINTER[failure.held] : undefined;
  return pointer ? `${failure.message} ${pointer}` : failure.message;
}

/** VIEW-4.5: the Esc button's tooltip: what it does. */
export const ESC_HINT = 'Press Esc in the Session: closes a panel or menu, or cancels the prompt';

/**
 * VIEW-4.5: the Esc button, for a Controllable Session that Needs you while Lookout shows no answer
 * buttons for it: a panel or a menu (`/usage`'s, which only Esc closes), a prompt Fleet can't read, or
 * one Lookout won't answer. Only once a read of the screen made in this Needs you spell has reached
 * the tab: before it, a permission prompt's buttons may be a second away, and Esc would decline it.
 * Never beside answer buttons (ready, waiting for the first read or for a question's form to be
 * drawn, sending, sent), nor while this tab's answer is on its way or landed after the latest read;
 * never with Stop, which is for Busy.
 * One click, one Esc; then "Pressing Esc…", disabled, until the Status leaves Needs you, or for 10 s.
 */
export function escButton(
  row: SessionRow,
  ended: boolean,
  screen: ScreenState | undefined,
  shown: { permission: PermissionPanel | null; question: QuestionPanel | null },
  attempt: AnswerAttempt | undefined,
  req: StopRequest | undefined,
  now: number,
): { pressing: boolean; error: string | null } | null {
  if (!answerable(row, ended)) return null;
  if (!screen || screen.since == null || screen.since !== row.statusSince) return null;
  if (shown.permission?.kind === 'buttons') return null;
  if (shown.question && shown.question.phase !== 'blocked') return null;
  if (attempt?.phase === 'sending' || (attempt?.phase === 'sent' && attempt.epoch !== null && screen.epoch < attempt.epoch)) return null;
  const r = req && req.status === 'needs-you' && req.since === row.statusSince ? req : null;
  if (!r) return { pressing: false, error: null };
  if (r.error) return { pressing: false, error: r.error };
  return { pressing: r.pending || now - r.at < STOP_SETTLE_MS, error: null };
}

/** The Terminal preview (VIEW-2): where to answer when Lookout won't (VIEW-4.3). */
export interface TerminalLink {
  open: boolean;
  show(): void;
}

/** VIEW-4.1: what the chat's questions need to be answered from here. */
export interface Answering {
  /** The question that can be answered now, and how its answer went; null when none can. */
  panel: QuestionPanel | null;
  submit(questionId: string, answers: QuestionAnswer[]): void;
  terminal: TerminalLink;
  /**
   * VIEW-4.6: what was picked and typed, per question (by its tool_use id), kept by App for this
   * Session: a read that blocks the form, or viewing another Session, takes it away until it's
   * mounted again as it was.
   */
  drafts: DraftKeeper;
}

/** Given by the Session view to the chat's questions (their rows are memoized; the context still reaches them). */
export const AnswerContext = createContext<Answering | null>(null);
