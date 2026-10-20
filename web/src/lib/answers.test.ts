import type { ChatEntry, ChatQuestion, ScreenPrompt, SessionRow } from '@shared/types.ts';
import { describe, expect, it } from 'vitest';
import { NOW, row } from '@/test/helpers';
import {
  type AnswerAttempt,
  ESC_POINTER,
  INCOMPLETE,
  QUESTION_TOUCHED,
  STOP_SETTLE_MS,
  TOUCHED,
  UNCERTAIN,
  answersOnClick,
  draftAnswers,
  emptyDraft,
  escButton,
  permissionPanel,
  pick,
  processKey,
  questionPanel,
  sendErrorText,
  stopButton,
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
    const form = (epoch: number) => screen({ kind: 'question', id: 'toolu_1', untouched: true }, epoch);
    expect(questionPanel(waiting(), false, [pendingQ()], form(7), q({ phase: 'stale', message: inFlight.message, read: 7 }))).toMatchObject({ phase: 'blocked', message: inFlight.message });
    expect(questionPanel(waiting(), false, [pendingQ()], form(8), q({ phase: 'stale', message: inFlight.message, read: 7 }))).toEqual({ id: 'toolu_1', phase: 'ready', message: null });
  });

  it('VIEW-4.3: an answer from any tab may have landed on it: no buttons, in every tab', () => {
    expect(permissionPanel(waiting(), false, screen(PERMISSION, 9, 'p:p2.0badc0de'), undefined)).toEqual({ kind: 'message', prompt: PERMISSION, message: UNCERTAIN });
    expect(permissionPanel(waiting(), false, screen({ ...PERMISSION, id: 'p2.next' }, 9, 'p:p2.0badc0de'), undefined)).toMatchObject({ kind: 'buttons' });
  });
});

describe('the question’s panel (VIEW-4.1)', () => {
  it('VIEW-4.1: the one pending question of a Claude Code Session that Needs you can be answered', () => {
    expect(questionPanel(waiting(), false, [pendingQ()], screen(null), undefined)).toEqual({ id: 'toolu_1', phase: 'ready', message: null });
    expect(questionPanel(waiting(), false, [pendingQ()], screen({ kind: 'question', id: 'toolu_1', untouched: true }), undefined)).toMatchObject({ phase: 'ready' });
    expect(questionPanel(waiting(), false, [pendingQ()], screen({ kind: 'question', id: null, untouched: false }), undefined)).toMatchObject({ phase: 'ready' });
  });

  it('VIEW-4.1: none for Codex, a Session that can’t be answered, two pending, none pending, another form or a permission prompt on screen', () => {
    expect(questionPanel(waiting({ harness: 'codex' }), false, [pendingQ()], undefined, undefined)).toBeNull();
    expect(questionPanel(waiting({ status: 'busy' }), false, [pendingQ()], undefined, undefined)).toBeNull();
    expect(questionPanel(waiting(), true, [pendingQ()], undefined, undefined)).toBeNull();
    expect(questionPanel(waiting({ controllable: false, backend: 'unknown' }), false, [pendingQ()], undefined, undefined)).toBeNull();
    expect(questionPanel(waiting(), false, [pendingQ('toolu_1'), pendingQ('toolu_2')], undefined, undefined)).toBeNull();
    expect(questionPanel(waiting(), false, [pendingQ('toolu_1', 'answered')], undefined, undefined)).toBeNull();
    expect(questionPanel(waiting(), false, [pendingQ()], screen({ kind: 'question', id: 'toolu_9', untouched: true }), undefined)).toBeNull();
    expect(questionPanel(waiting(), false, [pendingQ()], screen(PERMISSION), undefined)).toBeNull();
    expect(questionPanel(waiting(), false, [pendingQ()], screen({ kind: 'incomplete' }), undefined)).toBeNull();
  });

  it('VIEW-4.3: sending, sent, refused, or touched in the terminal', () => {
    const a = (over: Partial<AnswerAttempt>) => attempt({ key: 'q:toolu_1', ...over });
    expect(questionPanel(waiting(), false, [pendingQ()], undefined, a({}))).toMatchObject({ phase: 'sending' });
    expect(questionPanel(waiting(), false, [pendingQ()], undefined, a({ phase: 'sent', epoch: 3 }))).toMatchObject({ phase: 'sent' });
    expect(questionPanel(waiting(), false, [pendingQ()], undefined, a({ phase: 'refused', message: 'why' }))).toEqual({ id: 'toolu_1', phase: 'blocked', message: 'why' });
    // A refusal from an earlier Needs you spell doesn't count.
    expect(questionPanel(waiting({ statusSince: SINCE + 1 }), false, [pendingQ()], screen(null), a({ phase: 'refused', message: 'why' }))).toMatchObject({ phase: 'ready' });
    expect(questionPanel(waiting(), false, [pendingQ()], screen({ kind: 'question', id: 'toolu_1', untouched: false }), undefined)).toEqual({
      id: 'toolu_1',
      phase: 'blocked',
      message: QUESTION_TOUCHED,
    });
  });

  it('VIEW-4.3: answered from another tab (until a newer read), or maybe answered from any tab: no form', () => {
    const a = (over: Partial<AnswerAttempt>) => attempt({ key: 'q:toolu_1', ...over });
    expect(questionPanel(waiting(), false, [pendingQ()], screen(null, 4), a({ phase: 'stale', message: 'already', read: 4 }))).toEqual({ id: 'toolu_1', phase: 'blocked', message: 'already' });
    expect(questionPanel(waiting(), false, [pendingQ()], screen(null, 5), a({ phase: 'stale', message: 'already', read: 4 }))).toMatchObject({ phase: 'ready' });
    expect(questionPanel(waiting(), false, [pendingQ()], screen(null, 5, 'q:toolu_1'), undefined)).toEqual({ id: 'toolu_1', phase: 'blocked', message: UNCERTAIN });
  });

  it('VIEW-4.1: text the server couldn’t take keeps the form, with why', () => {
    const invalid = attempt({ key: 'q:toolu_1', phase: 'invalid', message: 'The answer is too long.' });
    expect(questionPanel(waiting(), false, [pendingQ()], screen(null), invalid)).toEqual({ id: 'toolu_1', phase: 'ready', message: 'The answer is too long.' });
  });

  it('VIEW-4.3: before the tab’s first read of the screen it waits for one: no epoch to answer with, which the server would refuse', () => {
    expect(questionPanel(waiting(), false, [pendingQ()], undefined, undefined)).toEqual({ id: 'toolu_1', phase: 'reading', message: null });
    // A read with nothing on screen is enough: it carries the epoch.
    expect(questionPanel(waiting(), false, [pendingQ()], screen(null, 3), undefined)).toMatchObject({ phase: 'ready' });
    // An answer already on its way, or sent, still shows as such.
    expect(questionPanel(waiting(), false, [pendingQ()], undefined, attempt({ key: 'q:toolu_1', phase: 'sent', epoch: 4 }))).toMatchObject({ phase: 'sent' });
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
