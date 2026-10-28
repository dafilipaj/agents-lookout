import type { ChatEntry, ChatQuestion, ScreenPrompt, SessionRow } from '@shared/types.ts';
import { describe, expect, it } from 'vitest';
import { NOW, row } from '@/test/helpers';
import {
  type AnswerAttempt,
  type Draft,
  ESC_POINTER,
  FORM_WAIT_MS,
  INCOMPLETE,
  QUESTION_LAYOUT,
  QUESTION_MISMATCH,
  QUESTION_NOT_SHOWN,
  QUESTION_OLD_FLEET,
  QUESTION_OTHER,
  QUESTION_TOUCHED,
  QUESTION_UNCHECKED,
  type QuestionDrafts,
  READ_WAIT_MS,
  STOP_SETTLE_MS,
  type ScreenState,
  TOUCHED,
  UNCERTAIN,
  answersOnClick,
  doesntFit,
  draftAnswers,
  emptyDraft,
  escButton,
  hasPreviews,
  permissionPanel,
  pick,
  processKey,
  questionPanel,
  sendErrorText,
  shownOption,
  stopButton,
  tidyQuestionDrafts,
  typeText,
  typeable,
} from './answers';

const PERMISSION: Extract<ScreenPrompt, { kind: 'permission' }> = {
  kind: 'permission',
  id: 'p2.0badc0de',
  title: 'Do you want to proceed?',
  detail: [],
  choices: [
    { n: 1, label: 'Yes' },
    { n: 2, label: 'No' },
  ],
  untouched: true,
};
const SINCE = NOW - 5_000;
const waiting = (over: Partial<SessionRow> = {}) => row({ id: 'a', status: 'needs-you', statusSince: SINCE, ...over });
const screen = (prompt: ScreenPrompt | null, epoch = 1, uncertain: string | null = null) => ({ prompt, epoch, uncertain });
/** A read that shows question toolu_1's form, untouched, as Fleet can answer it now (VIEW-4.6). */
const form = (epoch = 1, over: Partial<ScreenState> = {}): ScreenState => ({
  prompt: { kind: 'question', id: 'toolu_1', untouched: true },
  epoch,
  uncertain: null,
  since: SINCE,
  answerable: true,
  detail: null,
  pane: { cols: 200, rows: 50 },
  ...over,
});
const attempt = (over: Partial<AnswerAttempt>): AnswerAttempt => ({ key: 'p:p2.0badc0de', phase: 'sending', message: null, epoch: null, read: 1, since: SINCE, ...over });

const q = (over: Partial<ChatQuestion> = {}): ChatQuestion => ({
  question: 'Push?',
  header: 'Next',
  multiSelect: false,
  options: [
    { label: 'A', description: '' },
    { label: 'B', description: '' },
    { label: 'C', description: '' },
  ],
  ...over,
});
const pendingQ = (id = 'toolu_1', status: 'pending' | 'answered' = 'pending'): ChatEntry => ({ kind: 'question', cursor: id, ts: null, id, questions: [q()], status, answer: null });

describe('the permission prompt’s panel (VIEW-4.2, VIEW-4.3)', () => {
  it('VIEW-4.2: buttons for an untouched permission prompt while a Controllable Session Needs you', () => {
    expect(permissionPanel(waiting(), false, screen(PERMISSION), undefined)).toEqual({ kind: 'buttons', prompt: PERMISSION, sending: false });
    expect(permissionPanel(waiting(), false, screen(PERMISSION), attempt({}))).toEqual({ kind: 'buttons', prompt: PERMISSION, sending: true });
  });

  it('VIEW-4.2: nothing for a Session that ended, isn’t Controllable or doesn’t Need you, nothing on screen, or a question form', () => {
    expect(permissionPanel(waiting(), true, screen(PERMISSION), undefined)).toBeNull();
    expect(permissionPanel(waiting({ controllable: false, backend: 'unknown' }), false, screen(PERMISSION), undefined)).toBeNull();
    expect(permissionPanel(waiting({ status: 'busy' }), false, screen(PERMISSION), undefined)).toBeNull();
    expect(permissionPanel(waiting(), false, undefined, undefined)).toBeNull();
    expect(permissionPanel(waiting(), false, screen(null), undefined)).toBeNull();
    expect(permissionPanel(waiting(), false, screen({ kind: 'question', id: 'toolu_1', untouched: true }), undefined)).toBeNull();
  });

  it('VIEW-4.3: a prompt Fleet can’t read whole, or one touched in the terminal, says why instead of buttons', () => {
    expect(permissionPanel(waiting(), false, screen({ kind: 'incomplete' }), undefined)).toEqual({ kind: 'message', prompt: null, message: INCOMPLETE });
    expect(permissionPanel(waiting(), false, screen({ ...PERMISSION, untouched: false }), undefined)).toMatchObject({ kind: 'message', message: TOUCHED });
  });

  it('VIEW-4.3: a refusal holds for that prompt in that Needs you spell only', () => {
    const refused = attempt({ phase: 'refused', message: 'nothing was typed' });
    expect(permissionPanel(waiting(), false, screen(PERMISSION), refused)).toEqual({ kind: 'message', prompt: PERMISSION, message: 'nothing was typed' });
    expect(permissionPanel(waiting(), false, screen({ ...PERMISSION, id: 'p2.other' }), refused)).toMatchObject({ kind: 'buttons' });
    expect(permissionPanel(waiting({ statusSince: SINCE + 9_000 }), false, screen(PERMISSION), refused)).toMatchObject({ kind: 'buttons' });
  });

  it('VIEW-4.3: after an answer, a prompt read before it landed is stale: no buttons until a newer read, whatever it shows', () => {
    const sent = attempt({ phase: 'sent', epoch: 10 });
    expect(permissionPanel(waiting(), false, screen(PERMISSION, 9), sent)).toBeNull();
    expect(permissionPanel(waiting(), false, screen({ ...PERMISSION, id: 'p2.next' }, 9), sent)).toBeNull();
    expect(permissionPanel(waiting(), false, screen(PERMISSION, 10), sent)).toEqual({ kind: 'buttons', prompt: PERMISSION, sending: false });
  });

  it('VIEW-4.3: another tab answered first: “already answered” until a newer read, then the new prompt’s buttons', () => {
    const stale = attempt({ phase: 'stale', message: 'This was already answered from another tab, so nothing was typed.', read: 7 });
    expect(permissionPanel(waiting(), false, screen(PERMISSION, 7), stale)).toEqual({ kind: 'message', prompt: PERMISSION, message: stale.message });
    expect(permissionPanel(waiting(), false, screen(PERMISSION, 8), stale)).toEqual({ kind: 'buttons', prompt: PERMISSION, sending: false });
  });

  it('VIEW-4.3: another tab was answering: “answering right now” until a newer read, which brings the same prompt’s buttons back when that answer typed nothing', () => {
    const inFlight = attempt({ phase: 'stale', message: 'Another tab is answering this Session right now, so nothing was typed.', read: 7 });
    expect(permissionPanel(waiting(), false, screen(PERMISSION, 7), inFlight)).toEqual({ kind: 'message', prompt: PERMISSION, message: inFlight.message });
    // The other tab's answer was refused before typing: the server's next read is the same prompt, with a newer epoch.
    expect(permissionPanel(waiting(), false, screen(PERMISSION, 8), inFlight)).toEqual({ kind: 'buttons', prompt: PERMISSION, sending: false });
    const q = (over: Partial<AnswerAttempt>) => attempt({ key: 'q:toolu_1', ...over });
    expect(questionPanel(waiting(), false, [pendingQ()], form(7), q({ phase: 'stale', message: inFlight.message, read: 7 }), NOW)).toMatchObject({ phase: 'blocked', message: inFlight.message });
    expect(questionPanel(waiting(), false, [pendingQ()], form(8), q({ phase: 'stale', message: inFlight.message, read: 7 }), NOW)).toEqual({ id: 'toolu_1', phase: 'ready', message: null });
  });

  it('VIEW-4.3: an answer from any tab may have landed on it: no buttons, in every tab', () => {
    expect(permissionPanel(waiting(), false, screen(PERMISSION, 9, 'p:p2.0badc0de'), undefined)).toEqual({ kind: 'message', prompt: PERMISSION, message: UNCERTAIN });
    expect(permissionPanel(waiting(), false, screen({ ...PERMISSION, id: 'p2.next' }, 9, 'p:p2.0badc0de'), undefined)).toMatchObject({ kind: 'buttons' });
  });
});

describe('the question’s panel (VIEW-4.1)', () => {
  it('VIEW-4.1: the one pending question of a Claude Code Session that Needs you can be answered', () => {
    expect(questionPanel(waiting(), false, [pendingQ()], form(), undefined, NOW)).toEqual({ id: 'toolu_1', phase: 'ready', message: null });
  });

  it('VIEW-4.1: none for Codex, a Session that can’t be answered, two pending, none pending, or a permission prompt on screen', () => {
    expect(questionPanel(waiting({ harness: 'codex' }), false, [pendingQ()], undefined, undefined, NOW)).toBeNull();
    expect(questionPanel(waiting({ status: 'busy' }), false, [pendingQ()], undefined, undefined, NOW)).toBeNull();
    expect(questionPanel(waiting(), true, [pendingQ()], undefined, undefined, NOW)).toBeNull();
    expect(questionPanel(waiting({ controllable: false, backend: 'unknown' }), false, [pendingQ()], undefined, undefined, NOW)).toBeNull();
    expect(questionPanel(waiting(), false, [pendingQ('toolu_1'), pendingQ('toolu_2')], undefined, undefined, NOW)).toBeNull();
    expect(questionPanel(waiting(), false, [pendingQ('toolu_1', 'answered')], undefined, undefined, NOW)).toBeNull();
    expect(questionPanel(waiting(), false, [pendingQ()], screen(PERMISSION), undefined, NOW)).toBeNull();
    expect(questionPanel(waiting(), false, [pendingQ()], screen({ kind: 'incomplete' }), undefined, NOW)).toBeNull();
  });

  it('VIEW-4.3: sending, sent, refused, or touched in the terminal', () => {
    const a = (over: Partial<AnswerAttempt>) => attempt({ key: 'q:toolu_1', ...over });
    expect(questionPanel(waiting(), false, [pendingQ()], undefined, a({}), NOW)).toMatchObject({ phase: 'sending' });
    expect(questionPanel(waiting(), false, [pendingQ()], undefined, a({ phase: 'sent', epoch: 3 }), NOW)).toMatchObject({ phase: 'sent' });
    expect(questionPanel(waiting(), false, [pendingQ()], undefined, a({ phase: 'refused', message: 'why' }), NOW)).toEqual({ id: 'toolu_1', phase: 'blocked', message: 'why' });
    // A refusal from an earlier Needs you spell doesn't count.
    expect(questionPanel(waiting({ statusSince: SINCE + 1 }), false, [pendingQ()], form(), a({ phase: 'refused', message: 'why' }), NOW)).toMatchObject({ phase: 'ready' });
    expect(questionPanel(waiting(), false, [pendingQ()], form(1, { prompt: { kind: 'question', id: 'toolu_1', untouched: false }, answerable: false, detail: 'touched' }), undefined, NOW)).toEqual({
      id: 'toolu_1',
      phase: 'blocked',
      message: QUESTION_TOUCHED,
    });
  });

  it('VIEW-4.3: answered from another tab (until a newer read), or maybe answered from any tab: no form', () => {
    const a = (over: Partial<AnswerAttempt>) => attempt({ key: 'q:toolu_1', ...over });
    expect(questionPanel(waiting(), false, [pendingQ()], form(4), a({ phase: 'stale', message: 'already', read: 4 }), NOW)).toEqual({ id: 'toolu_1', phase: 'blocked', message: 'already' });
    expect(questionPanel(waiting(), false, [pendingQ()], form(5), a({ phase: 'stale', message: 'already', read: 4 }), NOW)).toMatchObject({ phase: 'ready' });
    expect(questionPanel(waiting(), false, [pendingQ()], form(5, { uncertain: 'q:toolu_1' }), undefined, NOW)).toEqual({ id: 'toolu_1', phase: 'blocked', message: UNCERTAIN });
  });

  it('VIEW-4.1: text the server couldn’t take keeps the form, with why', () => {
    const invalid = attempt({ key: 'q:toolu_1', phase: 'invalid', message: 'The answer is too long.' });
    expect(questionPanel(waiting(), false, [pendingQ()], form(), invalid, NOW)).toEqual({ id: 'toolu_1', phase: 'ready', message: 'The answer is too long.' });
  });

  it('VIEW-4.3: before the tab’s first read of the screen it waits for one: no epoch to answer with, which the server would refuse', () => {
    expect(questionPanel(waiting(), false, [pendingQ()], undefined, undefined, NOW)).toEqual({ id: 'toolu_1', phase: 'reading', message: null });
    // A read that shows the form, untouched and answerable, carries the epoch.
    expect(questionPanel(waiting(), false, [pendingQ()], form(3), undefined, NOW)).toMatchObject({ phase: 'ready' });
    // An answer already on its way, or sent, still shows as such.
    expect(questionPanel(waiting(), false, [pendingQ()], undefined, attempt({ key: 'q:toolu_1', phase: 'sent', epoch: 4 }), NOW)).toMatchObject({ phase: 'sent' });
  });
});

describe('a question Fleet can’t answer now (VIEW-4.6, VIEW-4.7)', () => {
  /** A read with nothing Fleet can answer: `detail` says why. Past the wait for the form, unless said otherwise. */
  const unconfirmed = (prompt: ScreenPrompt | null, detail: ScreenState['detail'], pane: ScreenState['pane'] = { cols: 200, rows: 50 }): ScreenState => ({
    prompt,
    epoch: 1,
    uncertain: null,
    since: SINCE,
    answerable: false,
    detail,
    pane,
  });
  const CUT: ScreenPrompt = { kind: 'question', id: null, untouched: false };
  /** The question (no Transcript time) appeared when the spell began: this is when its wait for the form is over (VIEW-4.7). */
  const WAITED = SINCE + FORM_WAIT_MS;
  const panel = (s: ScreenState, now = WAITED, entry = pendingQ(), r = waiting()) => questionPanel(r, false, [entry], s, undefined, now);
  const blocked = (message: string) => ({ id: 'toolu_1', phase: 'blocked', message });
  const reading = { id: 'toolu_1', phase: 'reading', message: null };

  it('VIEW-4.6: buttons only when the latest read shows this question’s form, untouched, and Fleet says it can answer it now', () => {
    expect(panel(form())).toEqual({ id: 'toolu_1', phase: 'ready', message: null });
    // Fleet doesn't say so (`answerable` absent or `false`, with no reason): no buttons.
    expect(panel(form(1, { answerable: undefined, detail: undefined, pane: undefined }))).toEqual(blocked(QUESTION_UNCHECKED));
    expect(panel(form(1, { answerable: false, detail: null }))).toEqual(blocked(QUESTION_UNCHECKED));
    // A form without its id, or another question's, even one Fleet could answer.
    expect(panel(form(1, { prompt: { kind: 'question', id: null, untouched: true } }))).toEqual(blocked(QUESTION_UNCHECKED));
    expect(panel(form(1, { prompt: { kind: 'question', id: 'toolu_9', untouched: true } }))).toEqual(blocked(QUESTION_OTHER));
    // Touched in the terminal.
    expect(panel(form(1, { prompt: { kind: 'question', id: 'toolu_1', untouched: false }, answerable: true }))).toEqual(blocked(QUESTION_TOUCHED));
  });

  it('VIEW-4.6: a form taller than the terminal says it doesn’t fit, with the terminal’s size, to answer it from a terminal app, where a bigger terminal lets Lookout answer it', () => {
    const message = doesntFit('question', { cols: 80, rows: 24 });
    expect(message).toBe(
      'This question doesn’t fit in the terminal (80×24), so Lookout can’t read it whole. Open the Session in a terminal app and answer it there. A bigger terminal lets Lookout answer questions like this.',
    );
    expect(panel(unconfirmed(CUT, 'clipped', { cols: 80, rows: 24 }))).toEqual(blocked(message));
    // Without a size from Fleet, the line leaves it out.
    expect(panel(unconfirmed(CUT, 'clipped', null))).toEqual(
      blocked('This question doesn’t fit in the terminal, so Lookout can’t read it whole. Open the Session in a terminal app and answer it there. A bigger terminal lets Lookout answer questions like this.'),
    );
  });

  it('VIEW-4.6: each of Fleet’s reasons in plain words, and to answer in the terminal', () => {
    expect(panel(unconfirmed(CUT, 'layout_unsupported'))).toEqual(blocked(QUESTION_LAYOUT));
    expect(panel(unconfirmed({ kind: 'question', id: 'toolu_1', untouched: false }, 'touched'))).toEqual(blocked(QUESTION_TOUCHED));
    expect(panel(unconfirmed({ kind: 'question', id: 'toolu_1', untouched: true }, 'cursor_moved'))).toEqual(blocked(QUESTION_TOUCHED));
    expect(panel(unconfirmed(null, 'no_form'))).toEqual(blocked(QUESTION_NOT_SHOWN));
    // Its tabs, question or options aren't this question's: it may be this one, drawn wrapped or cut short.
    for (const detail of ['tabs', 'question', 'options'] as const) {
      expect(panel(unconfirmed({ kind: 'question', id: null, untouched: false }, detail)), detail).toEqual(blocked(QUESTION_MISMATCH));
    }
    expect(QUESTION_MISMATCH).toMatch(/^The form in the terminal doesn’t match this question/);
    // A form no pending question accounts for, or another question's id: a different question.
    expect(panel(unconfirmed({ kind: 'question', id: null, untouched: false }, 'different_prompt'))).toEqual(blocked(QUESTION_OTHER));
    // A failed read (or a code Lookout doesn't know): it can't check.
    expect(panel(unconfirmed(null, null, null))).toEqual(blocked(QUESTION_UNCHECKED));
    // Every line is Lookout's own words, and says where to answer instead.
    for (const message of [QUESTION_LAYOUT, QUESTION_OTHER, QUESTION_MISMATCH, QUESTION_NOT_SHOWN, QUESTION_UNCHECKED]) expect(message).toMatch(/Answer it in the terminal\.$/);
    expect(doesntFit('question', null)).toMatch(/Open the Session in a terminal app and answer it there\./);
    expect(QUESTION_TOUCHED).toMatch(/Finish it there\.$/);
  });

  it('VIEW-4.6: a Fleet older than the pin, which doesn’t say whether it could answer, says so at once: update the Fleet fork', () => {
    const old = form(1, { answerable: false, detail: null, pane: null, oldFleet: true });
    expect(panel(old)).toEqual(blocked(QUESTION_OLD_FLEET));
    // At once: not a read to wait out.
    expect(panel(old, SINCE)).toEqual(blocked(QUESTION_OLD_FLEET));
    expect(QUESTION_OLD_FLEET).toBe('This Fleet can’t check questions yet, so Lookout won’t answer this one. Update the Fleet fork, or answer it in the terminal.');
    // A form started in the terminal still says so.
    expect(panel({ ...old, prompt: { kind: 'question', id: 'toolu_1', untouched: false } })).toEqual(blocked(QUESTION_TOUCHED));
  });

  it('VIEW-4.6: a permission prompt taller than the terminal says it doesn’t fit, in the same words; other prompts Fleet can’t read whole keep theirs', () => {
    const cut = (detail: ScreenState['detail']) => unconfirmed({ kind: 'incomplete' }, detail, { cols: 80, rows: 24 });
    expect(permissionPanel(waiting(), false, cut('clipped'), undefined)).toEqual({ kind: 'message', prompt: null, message: doesntFit('prompt', { cols: 80, rows: 24 }) });
    expect(doesntFit('prompt', { cols: 80, rows: 24 })).toBe(
      'This prompt doesn’t fit in the terminal (80×24), so Lookout can’t read it whole. Open the Session in a terminal app and answer it there. A bigger terminal lets Lookout answer prompts like this.',
    );
    expect(permissionPanel(waiting(), false, cut('layout_unsupported'), undefined)).toEqual({ kind: 'message', prompt: null, message: INCOMPLETE });
    expect(permissionPanel(waiting(), false, cut(null), undefined)).toEqual({ kind: 'message', prompt: null, message: INCOMPLETE });
  });

  it('VIEW-4.7: for 5 s after the question appears, a read without its form waits, disabled and quiet; then the line says why', () => {
    const asked = NOW - 1_000;
    const entry = { ...pendingQ(), ts: new Date(asked).toISOString() } as ChatEntry;
    for (const s of [unconfirmed(null, 'no_form'), unconfirmed(null, null, null), unconfirmed(CUT, 'options'), form(1, { prompt: { kind: 'question', id: 'toolu_9', untouched: true } })]) {
      expect(panel(s, asked, entry)).toEqual(reading);
      expect(panel(s, asked + FORM_WAIT_MS - 1, entry)).toEqual(reading);
      expect(panel(s, asked + FORM_WAIT_MS, entry)).toMatchObject({ phase: 'blocked' });
    }
    expect(panel(unconfirmed(null, 'no_form'), asked + FORM_WAIT_MS, entry)).toEqual(blocked(QUESTION_NOT_SHOWN));
    // The form drawn in time: buttons, no line ever shown.
    expect(panel(form(), asked + 500, entry)).toEqual({ id: 'toolu_1', phase: 'ready', message: null });
  });

  it('VIEW-4.7: the wait counts from the later of the question’s Transcript time and the Needs you spell’s start; without either, there is none', () => {
    const entry = { ...pendingQ(), ts: new Date(NOW - 60_000).toISOString() } as ChatEntry;
    // The spell began after the question was written (a second question in one spell starts it from its own time).
    const spell = waiting({ statusSince: NOW - 2_000 });
    expect(panel(unconfirmed(null, 'no_form'), NOW, entry, spell)).toEqual(reading);
    expect(panel(unconfirmed(null, 'no_form'), NOW + 3_000, entry, spell)).toEqual(blocked(QUESTION_NOT_SHOWN));
    const later = { ...pendingQ(), ts: new Date(NOW - 2_000).toISOString() } as ChatEntry;
    expect(panel(unconfirmed(null, 'no_form'), NOW, later, waiting({ statusSince: NOW - 60_000 }))).toEqual(reading);
    expect(panel(unconfirmed(null, 'no_form'), NOW, pendingQ(), waiting({ statusSince: null }))).toEqual(blocked(QUESTION_NOT_SHOWN));
  });

  it('VIEW-4.7: a read that says nothing (it failed) is waited out for 5 s from the first of them, however long ago the question appeared; then the line says Lookout can’t check it', () => {
    const failed = (unread: number | null) => ({ ...unconfirmed(null, null, null), unread });
    // The form was confirmed long ago; then a read fails at `at`.
    const at = WAITED + 60_000;
    expect(READ_WAIT_MS).toBe(5_000);
    expect(panel(failed(at), at)).toEqual(reading);
    expect(panel(failed(at), at + READ_WAIT_MS - 1)).toEqual(reading);
    expect(panel(failed(at), at + READ_WAIT_MS)).toEqual(blocked(QUESTION_UNCHECKED));
    // Not timed (no `unread`): said at once, past the wait for the form.
    expect(panel(failed(null), at)).toEqual(blocked(QUESTION_UNCHECKED));
    // A read that says why is never waited out this way.
    expect(panel({ ...unconfirmed(null, 'no_form'), unread: at }, at)).toEqual(blocked(QUESTION_NOT_SHOWN));
    // Esc stays hidden meanwhile (VIEW-4.5).
    const esc = (now: number) => escButton(waiting(), false, failed(at), { permission: null, question: panel(failed(at), now) }, undefined, undefined, now);
    expect(esc(at + READ_WAIT_MS - 1)).toBeNull();
    expect(esc(at + READ_WAIT_MS)).toEqual({ pressing: false, error: null });
  });

  it('VIEW-4.7: a form that doesn’t fit, one Lookout can’t answer, or one started in the terminal is said at once', () => {
    const asked = NOW;
    const entry = { ...pendingQ(), ts: new Date(asked).toISOString() } as ChatEntry;
    expect(panel(unconfirmed(CUT, 'clipped', { cols: 80, rows: 24 }), asked, entry)).toEqual(blocked(doesntFit('question', { cols: 80, rows: 24 })));
    expect(panel(unconfirmed(CUT, 'layout_unsupported'), asked, entry)).toEqual(blocked(QUESTION_LAYOUT));
    expect(panel(unconfirmed({ kind: 'question', id: 'toolu_1', untouched: false }, 'touched'), asked, entry)).toEqual(blocked(QUESTION_TOUCHED));
  });

  it('VIEW-4.7: Esc stays hidden while the form is waited for, and shows once the line says why (VIEW-4.5)', () => {
    const asked = NOW - 1_000;
    const entry = { ...pendingQ(), ts: new Date(asked).toISOString() } as ChatEntry;
    const s = unconfirmed(null, 'no_form');
    const esc = (now: number) => escButton(waiting(), false, s, { permission: null, question: panel(s, now, entry) }, undefined, undefined, now);
    expect(esc(asked)).toBeNull();
    expect(esc(asked + FORM_WAIT_MS)).toEqual({ pressing: false, error: null });
    // A form that doesn't fit has no buttons from the start: Esc too.
    const cut = unconfirmed(CUT, 'clipped');
    expect(escButton(waiting(), false, cut, { permission: null, question: panel(cut, asked, entry) }, undefined, undefined, asked)).toEqual({ pressing: false, error: null });
  });
});
describe('kept question drafts (VIEW-4.6)', () => {
  it('VIEW-4.6: a question’s draft goes once the tab’s chat shows it answered, dismissed or abandoned, and a Session’s once it ended; a chat the tab doesn’t hold keeps them', () => {
    const d: readonly Draft[] = [{ picked: [1], text: 'and tag it' }];
    const kept: QuestionDrafts = new Map([
      ['a', new Map([['toolu_1', d], ['toolu_2', d], ['toolu_3', d], ['toolu_4', d]])],
      ['ended', new Map([['toolu_5', d]])],
      ['unheld', new Map([['toolu_6', d]])],
    ]);
    const live = new Map([['a', waiting()], ['unheld', waiting({ id: 'unheld' })]]);
    const entry = (id: string, status: 'pending' | 'answered' | 'declined' | 'abandoned') => ({ ...pendingQ(id), status }) as ChatEntry;
    const chats = new Map([['a', { entries: [entry('toolu_1', 'pending'), entry('toolu_2', 'answered'), entry('toolu_3', 'declined'), entry('toolu_4', 'abandoned')] }]]);
    // While the list isn't known, a Session missing from it may not have ended.
    tidyQuestionDrafts(kept, { live, listKnown: false, chats });
    expect([...kept.keys()]).toEqual(['a', 'ended', 'unheld']);
    expect([...kept.get('a')!.keys()]).toEqual(['toolu_1']);
    expect(kept.get('a')!.get('toolu_1')).toBe(d);
    tidyQuestionDrafts(kept, { live, listKnown: true, chats });
    expect([...kept.keys()]).toEqual(['a', 'unheld']);
    // Its last question answered, the Session's entry goes too.
    tidyQuestionDrafts(kept, { live, listKnown: true, chats: new Map([['a', { entries: [entry('toolu_1', 'answered')] }]]) });
    expect([...kept.keys()]).toEqual(['unheld']);
  });
});

describe('the answer form (VIEW-4.1)', () => {
  it('VIEW-4.1: only one question with one choice answers on click', () => {
    expect(answersOnClick([q()])).toBe(true);
    expect(answersOnClick([q({ multiSelect: true })])).toBe(false);
    expect(answersOnClick([q(), q()])).toBe(false);
  });

  it('VIEW-4.1: one choice: an option or text, never both; several: options toggle, text joins them', () => {
    const one = q();
    let d = pick(one, emptyDraft, 1);
    expect(d).toEqual({ picked: [1], text: '' });
    expect(pick(one, d, 1)).toEqual({ picked: [], text: '' });
    d = typeText(one, d, 'my own');
    expect(d).toEqual({ picked: [], text: 'my own' });
    expect(pick(one, d, 2)).toEqual({ picked: [2], text: '' });
    expect(typeText(one, { picked: [2], text: '' }, '  ')).toEqual({ picked: [2], text: '  ' });
    expect(typeText(one, emptyDraft, 'a\nb')).toEqual({ picked: [], text: 'a b' });
    // Pasted: a tab is a space, other control characters go (they'd be keypresses).
    expect(typeText(one, emptyDraft, 'col1\tcol2\u001b[A\u0007!')).toEqual({ picked: [], text: 'col1 col2[A!' });
    expect(typeable('a\r\n\tb\u007f\u009bc')).toBe('a bc');

    const many = q({ multiSelect: true });
    d = pick(many, pick(many, emptyDraft, 2), 0);
    expect(d.picked).toEqual([0, 2]);
    expect(pick(many, d, 2).picked).toEqual([0]);
    expect(typeText(many, d, 'and docs')).toEqual({ picked: [0, 2], text: 'and docs' });
  });

  it('VIEW-4.1: Submit waits for an answer to every question, and sends trimmed text', () => {
    const qs = [q(), q({ multiSelect: true })];
    expect(draftAnswers(qs, [emptyDraft, emptyDraft])).toBeNull();
    expect(draftAnswers(qs, [{ picked: [1], text: '' }, emptyDraft])).toBeNull();
    expect(draftAnswers(qs, [{ picked: [1], text: '' }, { picked: [], text: '   ' }])).toBeNull();
    expect(draftAnswers(qs, [{ picked: [1], text: 'x' }, { picked: [0], text: '' }])).toBeNull(); // one choice: not both
    expect(draftAnswers(qs, [{ picked: [], text: ' mine ' }, { picked: [0, 2], text: 'more' }])).toEqual([
      { options: [], text: 'mine' },
      { options: [0, 2], text: 'more' },
    ]);
    // Never a control character on the way out.
    expect(draftAnswers([q()], [{ picked: [], text: 'a\tb\u001b' }])).toEqual([{ options: [], text: 'a b' }]);
  });
});

describe('Stop (VIEW-4.4)', () => {
  const busy = row({ id: 'a', status: 'busy', statusSince: SINCE });

  it('VIEW-4.4: only while a Controllable Session is Busy', () => {
    expect(stopButton(busy, false, undefined, NOW)).toEqual({ stopping: false, error: null });
    expect(stopButton({ ...busy, status: 'idle' }, false, undefined, NOW)).toBeNull();
    expect(stopButton({ ...busy, status: 'needs-you' }, false, undefined, NOW)).toBeNull();
    expect(stopButton({ ...busy, controllable: false, backend: 'unknown' }, false, undefined, NOW)).toBeNull();
    expect(stopButton(busy, true, undefined, NOW)).toBeNull();
  });

  it('VIEW-4.4: "Stopping…" while the Esc is on its way and for 10 s after, in the same Busy spell; a failure enables it again', () => {
    expect(stopButton(busy, false, { at: NOW, status: 'busy', since: SINCE, pending: true, error: null }, NOW + 60_000)).toEqual({ stopping: true, error: null });
    expect(stopButton(busy, false, { at: NOW, status: 'busy', since: SINCE, pending: false, error: null }, NOW + STOP_SETTLE_MS - 1)).toEqual({ stopping: true, error: null });
    expect(stopButton(busy, false, { at: NOW, status: 'busy', since: SINCE, pending: false, error: null }, NOW + STOP_SETTLE_MS)).toEqual({ stopping: false, error: null });
    expect(stopButton(busy, false, { at: NOW, status: 'busy', since: SINCE - 1, pending: false, error: null }, NOW)).toEqual({ stopping: false, error: null });
    expect(stopButton(busy, false, { at: NOW, status: 'busy', since: SINCE, pending: false, error: 'why' }, NOW)).toEqual({ stopping: false, error: 'why' });
  });

  it('VIEW-4.4: a Session’s Stop and answers follow its process, not its id', () => {
    expect(processKey({ harness: 'codex', pid: 77 })).toBe('codex:77');
  });
});

describe('Esc (VIEW-4.5)', () => {
  /** A read of the screen made in the row's Needs you spell. */
  const read = (prompt: ScreenPrompt | null, epoch = 1, since: number | null = SINCE) => ({ prompt, epoch, uncertain: null, since });
  type Shown = Parameters<typeof escButton>[3];
  const none: Shown = { permission: null, question: null };
  const esc = (r: SessionRow, s: Parameters<typeof escButton>[2], shown: Shown = none, a?: AnswerAttempt, req?: Parameters<typeof escButton>[5], now = NOW) =>
    escButton(r, false, s, shown, a, req, now);

  it('VIEW-4.5: while a Controllable Session Needs you and a read made in this spell shows nothing Lookout answers', () => {
    expect(esc(waiting(), read(null))).toEqual({ pressing: false, error: null });
    // A prompt Fleet can't read whole: no buttons, so Esc.
    const incomplete = read({ kind: 'incomplete' });
    expect(esc(waiting(), incomplete, { permission: permissionPanel(waiting(), false, incomplete, undefined), question: null })).toEqual({ pressing: false, error: null });
    expect(escButton(waiting(), true, read(null), none, undefined, undefined, NOW)).toBeNull();
    expect(esc(waiting({ controllable: false, backend: 'unknown' }), read(null))).toBeNull();
    for (const status of ['busy', 'idle', 'unknown'] as const) expect(esc(waiting({ status }), read(null))).toBeNull();
  });

  it('VIEW-4.5: not before a read made in this Needs you spell reaches the tab: a permission prompt’s buttons may be a second away', () => {
    expect(esc(waiting(), undefined)).toBeNull();
    expect(esc(waiting(), read(null, 1, null))).toBeNull(); // read while it didn't Need you
    expect(esc(waiting(), read(null, 1, SINCE - 60_000))).toBeNull(); // an earlier spell's
    expect(esc(waiting(), { prompt: null, epoch: 1, uncertain: null })).toBeNull(); // a server before spells
  });

  it('VIEW-4.5: never beside answer buttons: a permission prompt’s, or a question’s (ready, waiting for the first read, sending, sent)', () => {
    const p = read(PERMISSION);
    expect(esc(waiting(), p, { permission: permissionPanel(waiting(), false, p, undefined), question: null })).toBeNull();
    for (const phase of ['ready', 'reading', 'sending', 'sent'] as const) {
      expect(esc(waiting(), read(null), { permission: null, question: { id: 'toolu_1', phase, message: null } })).toBeNull();
    }
    // Lookout won't answer it (refused, touched, uncertain): the buttons are gone, so Esc.
    expect(esc(waiting(), read(null), { permission: null, question: { id: 'toolu_1', phase: 'blocked', message: QUESTION_TOUCHED } })).toEqual({ pressing: false, error: null });
    const touched = read({ ...PERMISSION, untouched: false });
    expect(esc(waiting(), touched, { permission: permissionPanel(waiting(), false, touched, undefined), question: null })).toEqual({ pressing: false, error: null });
  });

  it('VIEW-4.5: not while this tab’s answer is on its way, or landed after the latest read', () => {
    expect(esc(waiting(), read(null, 5), none, attempt({ phase: 'sending' }))).toBeNull();
    expect(esc(waiting(), read(null, 5), none, attempt({ phase: 'sent', epoch: 6 }))).toBeNull();
    expect(esc(waiting(), read(null, 6), none, attempt({ phase: 'sent', epoch: 6 }))).toEqual({ pressing: false, error: null });
    expect(esc(waiting(), read(null, 6), none, attempt({ phase: 'refused', message: TOUCHED }))).toEqual({ pressing: false, error: null });
  });

  it('VIEW-4.5: "Pressing Esc…" while the Esc is on its way and for 10 s after, in the same Needs you spell; a failure enables it again; a Stop never counts', () => {
    const at = (over: Partial<Parameters<typeof escButton>[5] & object> = {}) => ({ at: NOW, status: 'needs-you' as const, since: SINCE, pending: false, error: null, ...over });
    expect(esc(waiting(), read(null), none, undefined, at({ pending: true }), NOW + 60_000)).toEqual({ pressing: true, error: null });
    expect(esc(waiting(), read(null), none, undefined, at(), NOW + STOP_SETTLE_MS - 1)).toEqual({ pressing: true, error: null });
    expect(esc(waiting(), read(null), none, undefined, at(), NOW + STOP_SETTLE_MS)).toEqual({ pressing: false, error: null });
    expect(esc(waiting(), read(null), none, undefined, at({ since: SINCE - 1 }))).toEqual({ pressing: false, error: null });
    expect(esc(waiting(), read(null), none, undefined, at({ error: 'why' }))).toEqual({ pressing: false, error: 'why' });
    // The same spell number from a Stop: not this button's.
    expect(esc(waiting(), read(null), none, undefined, at({ status: 'busy', pending: true }))).toEqual({ pressing: false, error: null });
    expect(stopButton(row({ id: 'a', status: 'busy', statusSince: SINCE }), false, at({ pending: true }), NOW)).toEqual({ stopping: false, error: null });
  });
});

describe('a held send in the composer (VIEW-3.7)', () => {
  it('VIEW-3.7: while the Esc button shows, a send held for no input box or a prompt points to it; other reasons, and other failures, read as sent', () => {
    expect(sendErrorText(null, true)).toBeNull();
    expect(sendErrorText({ message: 'No box.', held: 'no_input_box' }, true)).toBe(`No box. ${ESC_POINTER.no_input_box}`);
    expect(sendErrorText({ message: 'A prompt.', held: 'prompt' }, true)).toBe(`A prompt. ${ESC_POINTER.prompt}`);
    expect(sendErrorText({ message: 'No box.', held: 'no_input_box' }, false)).toBe('No box.');
    expect(sendErrorText({ message: 'Text.', held: 'text' }, true)).toBe('Text.');
    expect(sendErrorText({ message: 'Unreadable.', held: 'unreadable' }, true)).toBe('Unreadable.');
    expect(sendErrorText({ message: "Couldn't send: x", held: null }, true)).toBe("Couldn't send: x");
  });
});

describe('questions with previews (VIEW-10)', () => {
  /** P1's second question, shortened: an option's preview as the Transcript has it (neutral capture, 2026-10-28). */
  const withPreviews = (over: Partial<ChatQuestion> = {}): ChatQuestion =>
    q({
      question: 'Which layout should the page use?',
      header: 'Layout',
      options: [
        { label: 'Sidebar', description: 'Option Sidebar', preview: '┌────┐\n│ Sidebar │\n└────┘' },
        { label: 'Top tabs', description: 'Option Top tabs', preview: '┌────┐\n│ Top tabs │\n└────┘' },
        { label: 'Single page', description: 'Option Single page' },
      ],
      ...over,
    });

  it('VIEW-10.5: a question has previews when it takes one answer and an option has a preview; a multi-select one with previews is answered as any multi-select', () => {
    expect(hasPreviews(withPreviews())).toBe(true);
    // One preview is enough (Fleet's rule, contract C4).
    expect(hasPreviews(withPreviews({ options: [{ label: 'A', description: '', preview: 'x' }, { label: 'B', description: '' }] }))).toBe(true);
    expect(hasPreviews(q())).toBe(false);
    const several = withPreviews({ multiSelect: true });
    expect(hasPreviews(several)).toBe(false);
    expect(draftAnswers([several], [{ picked: [0, 1], text: 'and docs' }])).toEqual([{ options: [0, 1], text: 'and docs' }]);
  });

  it('VIEW-10.3: never answered on one click, even alone: picked, then submitted, with its one option and never text', () => {
    expect(answersOnClick([withPreviews()])).toBe(false);
    expect(answersOnClick([q(), withPreviews()])).toBe(false);
    // A question without previews in the same form keeps its text.
    const qs = [q(), withPreviews()];
    expect(draftAnswers(qs, [{ picked: [], text: 'mine' }, emptyDraft])).toBeNull();
    expect(draftAnswers(qs, [{ picked: [], text: 'mine' }, { picked: [1], text: '' }])).toEqual([{ options: [], text: 'mine' }, { options: [1] }]);
    // Text left in a kept draft never goes out for it.
    expect(draftAnswers([withPreviews()], [{ picked: [2], text: 'stray' }])).toEqual([{ options: [2] }]);
    expect(draftAnswers([withPreviews()], [{ picked: [], text: 'stray' }])).toBeNull();
  });

  it('VIEW-10.1: the box shows the option under the pointer, else the one with focus, else the picked one, else the first', () => {
    expect(shownOption(2, 1, [0])).toBe(2);
    expect(shownOption(null, 1, [0])).toBe(1);
    expect(shownOption(null, null, [2])).toBe(2);
    expect(shownOption(null, null, new Set([1]))).toBe(1);
    expect(shownOption(null, null, [])).toBe(0);
  });
});
