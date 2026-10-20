import type { AnswerResult, ChatEntry, ChatQuestion, ScreenPrompt, SessionRow } from '@shared/types.ts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ESC_HINT, INCOMPLETE, LOST_ANSWER, LOST_STOP, QUESTION_TOUCHED, STOP_SETTLE_MS, TOUCHED, UNCERTAIN } from '@/lib/answers';
import { SaveError } from '@/lib/client';
import { NOW, renderApp, row } from '@/test/helpers';

const PERMISSION: Extract<ScreenPrompt, { kind: 'permission' }> = {
  kind: 'permission',
  id: 'p2.0badc0de',
  title: 'Do you want to proceed?',
  detail: ['Bash command', '', '  bundle exec rspec spec/models/deal_spec.rb'],
  choices: [
    { n: 1, label: 'Yes' },
    { n: 2, label: 'Yes, and don’t ask again for bundle exec rspec commands' },
    { n: 3, label: 'No, and tell Claude what to do differently (esc)' },
  ],
  untouched: true,
};

const q = (over: Partial<ChatQuestion> = {}): ChatQuestion => ({
  question: 'Push the branch and open a draft PR?',
  header: 'Next step',
  multiSelect: false,
  options: [
    { label: 'Push and open a draft PR', description: 'Runs git push, then gh pr create --draft' },
    { label: 'Only push', description: '' },
    { label: 'Not yet', description: 'Keep working locally.' },
  ],
  ...over,
});

const question = (questions: ChatQuestion[], over: Partial<Extract<ChatEntry, { kind: 'question' }>> = {}): ChatEntry => ({
  kind: 'question',
  cursor: 'c9',
  ts: null,
  id: 'toolu_13',
  questions,
  status: 'pending',
  answer: null,
  ...over,
});

const header = () => screen.getByRole('banner', { name: 'Session' });
const drawerToggle = () => screen.getByRole('button', { name: /Terminal/ });
const card = () => screen.queryByRole('region', { name: 'Permission prompt' });
const choices = () => within(card()!).queryAllByRole('button').filter((b) => b.closest('[aria-label="Choices"]'));

/** A deferred answer, so a test can look while it's in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function open(over: Partial<SessionRow> = {}, entries: ChatEntry[] = [], options: Parameters<typeof renderApp>[1] = {}) {
  const app = renderApp('/s/a', options);
  app.snapshot([row({ id: 'a', status: 'needs-you', statusSince: NOW - 5_000, ...over })]);
  app.emit({ type: 'chat', sessionId: 'a', op: 'reset', entries, before: null, queue: [] });
  const prompt = (p: ScreenPrompt | null, epoch = 1, uncertain: string | null = null) => app.emit({ type: 'prompt', sessionId: 'a', prompt: p, epoch, uncertain });
  return { ...app, prompt };
}

describe('permission prompts (VIEW-4.2)', () => {
  it('VIEW-4.2: a Controllable Session that Needs you on a permission prompt shows its choices as buttons with the terminal’s wording; picking one answers it', async () => {
    const user = userEvent.setup();
    const pending = deferred<AnswerResult>();
    const app = open({}, [], { answer: () => pending.promise });
    expect(card()).toBeNull();
    app.prompt(PERMISSION);
    expect(card()).toHaveTextContent('Claude Code asks');
    expect(card()).toHaveTextContent('Do you want to proceed?');
    expect(card()).toHaveTextContent('bundle exec rspec spec/models/deal_spec.rb');
    expect(choices().map((b) => b.textContent)).toEqual(['1Yes', '2Yes, and don’t ask again for bundle exec rspec commands', '3No, and tell Claude what to do differently (esc)']);
    // The number is the terminal's key; the button's name is its wording.
    expect(within(card()!).getByRole('button', { name: 'No, and tell Claude what to do differently (esc)' })).toBeInTheDocument();
    // It sits in the chat, above the Needs you row.
    expect(screen.getByTestId('chat')).toContainElement(card());

    await user.click(within(card()!).getByRole('button', { name: 'Yes, and don’t ask again for bundle exec rspec commands' }));
    expect(app.client.answer).toHaveBeenCalledWith('a', { kind: 'permission', prompt: 'p2.0badc0de', choice: 2, epoch: 1 });
    // While Fleet answers: no second click.
    expect(choices().every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(card()).toHaveTextContent('Answering…');
    await user.click(choices()[0]!);
    expect(app.client.answer).toHaveBeenCalledOnce();

    await act(async () => pending.resolve({ epoch: 5 }));
    // Answered: what the tab read before the answer landed is stale, so its buttons go…
    expect(card()).toBeNull();
    // …until a read made after it: a new prompt, even one with the same wording and id.
    app.prompt(PERMISSION, 5);
    expect(choices()).toHaveLength(3);
    expect(choices().every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('VIEW-4.2: Codex approvals get buttons too, in Codex’s wording', async () => {
    const user = userEvent.setup();
    const app = open({ harness: 'codex', id: 'a' });
    app.prompt({ ...PERMISSION, id: 'p2.c0dec0de', title: 'Would you like to run the following command?', choices: [{ n: 1, label: 'Yes, proceed (y)' }, { n: 2, label: 'No, and tell Codex what to do differently (esc)' }] });
    expect(card()).toHaveTextContent('Codex asks');
    await user.click(within(card()!).getByRole('button', { name: 'Yes, proceed (y)' }));
    expect(app.client.answer).toHaveBeenCalledWith('a', { kind: 'permission', prompt: 'p2.c0dec0de', choice: 1, epoch: 1 });
  });

  it('VIEW-4.2: no buttons for a Session that isn’t Controllable, has ended, or doesn’t Need you', () => {
    const app = open({ status: 'busy' });
    app.prompt(PERMISSION);
    expect(card()).toBeNull();
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'needs-you', backend: 'unknown', controllable: false })], remove: [] });
    expect(card()).toBeNull();
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'needs-you' })], remove: [] });
    expect(card()).not.toBeNull();
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    expect(screen.getByText('This Session ended')).toBeInTheDocument();
    expect(card()).toBeNull();
  });

  it('VIEW-1.12: the permission prompt card stays plain text, addresses included', () => {
    const app = open();
    app.prompt({
      ...PERMISSION,
      title: 'Fetch https://example.com/a?',
      detail: ['Bash command', '', '  curl https://example.com'],
      choices: [{ n: 1, label: 'Yes' }, { n: 2, label: 'Yes, and don’t ask again for https://example.com' }],
    });
    expect(card()).toHaveTextContent('Fetch https://example.com/a?');
    expect(card()).toHaveTextContent('curl https://example.com');
    expect(within(card()!).queryAllByRole('link')).toEqual([]);
  });

  it('VIEW-4.2: a prompt read for another Session isn’t shown after switching back until it’s read again', () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', status: 'needs-you' }), row({ id: 'b', status: 'needs-you' })]);
    app.emit({ type: 'prompt', sessionId: 'a', prompt: PERMISSION, epoch: 1 });
    expect(card()).not.toBeNull();
    act(() => window.history.pushState(null, '', '/s/b'));
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    act(() => window.history.pushState(null, '', '/s/a'));
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(card()).toBeNull();
  });
});

describe('when Lookout won’t answer (VIEW-4.3)', () => {
  it('VIEW-4.3: a refusal replaces the buttons with why, opens the terminal preview, and is never retried', async () => {
    const user = userEvent.setup();
    const why = 'The terminal no longer shows this prompt as it was, so nothing was typed. Answer it in the terminal.';
    const app = open({}, [], { answer: vi.fn(async () => Promise.reject(new SaveError(why, null, 409))) });
    app.prompt(PERMISSION);
    // You closed the preview while it Needs you.
    await user.click(drawerToggle());
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false');

    await user.click(within(card()!).getByRole('button', { name: 'Yes' }));
    expect(within(card()!).getByRole('alert')).toHaveTextContent(why);
    expect(choices()).toEqual([]);
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true');
    // What it asked stays, so you know what to answer there.
    expect(card()).toHaveTextContent('Do you want to proceed?');
    // The same prompt read again: still no buttons, and no retry.
    app.prompt(PERMISSION, 2);
    expect(choices()).toEqual([]);
    expect(app.client.answer).toHaveBeenCalledOnce();
    // Another prompt gets its own buttons.
    app.prompt({ ...PERMISSION, id: 'p2.feedf00d' }, 3);
    expect(choices()).toHaveLength(3);
  });

  it('VIEW-4.3: when it may have been answered, it says so and to check the terminal', async () => {
    const user = userEvent.setup();
    const why = 'It may have been answered, but Lookout can’t tell. Check the terminal.';
    const app = open({}, [], { answer: vi.fn(async () => Promise.reject(new SaveError(why, null, 502))) });
    app.prompt(PERMISSION);
    await user.click(within(card()!).getByRole('button', { name: 'Yes' }));
    expect(within(card()!).getByRole('alert')).toHaveTextContent(why);
  });

  it('VIEW-4.3: a prompt Fleet can’t read whole, or one touched in the terminal, gets no buttons; the message offers the terminal', async () => {
    const user = userEvent.setup();
    const app = open();
    app.prompt({ kind: 'incomplete' });
    expect(within(card()!).getByRole('alert')).toHaveTextContent(INCOMPLETE);
    expect(choices()).toEqual([]);
    // Open by default while it Needs you (VIEW-2.2): nothing to offer. Closed: a way back to it.
    expect(within(card()!).queryByRole('button', { name: 'Show terminal' })).toBeNull();
    await user.click(drawerToggle());
    await user.click(within(card()!).getByRole('button', { name: 'Show terminal' }));
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true');

    app.prompt({ ...PERMISSION, untouched: false }, 2);
    expect(within(card()!).getByRole('alert')).toHaveTextContent(TOUCHED);
    expect(choices()).toEqual([]);
    expect(app.client.answer).not.toHaveBeenCalled();
  });

  it('VIEW-4.3: two tabs, one prompt: the second click, read before the first tab’s answer, says it was already answered; a newer read brings the next prompt’s buttons', async () => {
    const user = userEvent.setup();
    const why = 'This was already answered from another tab, so nothing was typed.';
    const app = open({}, [], { answer: vi.fn(async () => Promise.reject(new SaveError(why, null, 409, { kind: 'stale' }))) });
    app.prompt(PERMISSION, 4);
    await user.click(drawerToggle());
    await user.click(within(card()!).getByRole('button', { name: 'Yes' }));
    // The answer went with the epoch of the read it answered.
    expect(app.client.answer).toHaveBeenCalledWith('a', { kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: 4 });
    expect(within(card()!).getByRole('alert')).toHaveTextContent(why);
    expect(choices()).toEqual([]);
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true');
    // The read after the other tab's answer: an identical prompt, but a new one.
    app.prompt(PERMISSION, 5);
    expect(choices()).toHaveLength(3);
    expect(choices().every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('VIEW-4.3: two tabs, one prompt: a click while the other tab’s answer is typed says so; when that answer typed nothing, the next read brings the same buttons back, and they answer', async () => {
    const user = userEvent.setup();
    const why = 'Another tab is answering this Session right now, so nothing was typed.';
    const answer = vi.fn<(id: string, req: unknown) => Promise<AnswerResult>>().mockRejectedValueOnce(new SaveError(why, null, 409, { kind: 'stale' })).mockResolvedValueOnce({ epoch: 9 });
    const app = open({}, [], { answer });
    app.prompt(PERMISSION, 4);
    await user.click(within(card()!).getByRole('button', { name: 'Yes' }));
    expect(within(card()!).getByRole('alert')).toHaveTextContent(why);
    expect(choices()).toEqual([]);
    // The read the same epoch carries changes nothing.
    app.prompt(PERMISSION, 4);
    expect(within(card()!).getByRole('alert')).toHaveTextContent(why);
    // Fleet refused the other tab's answer before typing: the server reads again with a newer epoch, the same prompt on screen.
    app.prompt(PERMISSION, 8);
    expect(within(card()!).queryByRole('alert')).toBeNull();
    expect(choices()).toHaveLength(3);
    await user.click(within(card()!).getByRole('button', { name: 'Yes' }));
    expect(answer).toHaveBeenLastCalledWith('a', { kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: 8 });
    await waitFor(() => expect(card()).toBeNull());
  });

  it('VIEW-4.3: after an uncertain answer from any tab, the read says so: no buttons in a tab that never clicked, for a prompt or a question', () => {
    const app = open({}, [question([q()])]);
    app.prompt(PERMISSION, 6, 'p:p2.0badc0de');
    expect(within(card()!).getByRole('alert')).toHaveTextContent(UNCERTAIN);
    expect(choices()).toEqual([]);
    app.prompt({ kind: 'question', id: 'toolu_13', untouched: true }, 7, 'q:toolu_13');
    const asked = screen.getByTestId('chat').querySelector('[data-kind="question"]') as HTMLElement;
    expect(within(asked).getByRole('alert')).toHaveTextContent(UNCERTAIN);
    expect(within(asked).queryAllByRole('button').filter((b) => b.textContent !== 'Show terminal')).toEqual([]);
    expect(app.client.answer).not.toHaveBeenCalled();
  });

  it('VIEW-4.3: a lost connection isn’t a refusal: it may have been answered, so it says to check the terminal, which opens', async () => {
    const user = userEvent.setup();
    const lost = () => Promise.reject(new SaveError('Couldn’t reach the Lookout server.', null, null, { lost: true }));
    const app = open({}, [], { answer: vi.fn(lost) });
    app.prompt(PERMISSION);
    await user.click(drawerToggle());
    await user.click(within(card()!).getByRole('button', { name: 'Yes' }));
    expect(within(card()!).getByRole('alert')).toHaveTextContent(LOST_ANSWER);
    expect(LOST_ANSWER).toMatch(/may have been answered; check the terminal/);
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true');
    // Not retried, even when the same prompt is read again.
    app.prompt(PERMISSION, 2);
    expect(choices()).toEqual([]);
  });
});

describe('questions (VIEW-4.1)', () => {
  const optionButton = (name: RegExp | string) => within(screen.getByTestId('chat')).getByRole('button', { name });
  const submit = () => within(screen.getByTestId('chat')).queryByRole('button', { name: 'Submit' });

  it('VIEW-4.1: one question with one choice answers on click, with no Submit', async () => {
    const user = userEvent.setup();
    const app = open({}, [question([q()])]);
    app.prompt({ kind: 'question', id: 'toolu_13', untouched: true });
    expect(submit()).toBeNull();
    // A circle for one choice, as in the read-only chat (VIEW-1.9).
    expect(optionButton(/^Only push/).querySelector('[data-field="choice"] svg')).toHaveClass('lucide-circle');
    await user.click(optionButton(/^Only push/));
    expect(app.client.answer).toHaveBeenCalledWith('a', { kind: 'question', question: 'toolu_13', answers: [{ options: [1] }], epoch: 1 });
    expect(screen.getByText('Sent. Waiting for the Session…')).toBeInTheDocument();
    expect(optionButton(/^Not yet/)).toBeDisabled();
    // The Transcript records the answer: the question shows it, read-only (VIEW-1.9).
    app.emit({ type: 'chat', sessionId: 'a', op: 'append', entries: [], updated: [question([q()], { status: 'answered', answer: { answers: ['Only push'], picked: [[1]] } })], queue: [] });
    expect(within(screen.getByTestId('chat')).queryByRole('button', { name: /^Only push/ })).toBeNull();
    expect(screen.getByText('Answered')).toBeInTheDocument();
  });

  it('VIEW-4.1: several questions are picked, then submitted; Submit waits for every one', async () => {
    const user = userEvent.setup();
    const two = [q({ header: 'Branch', question: 'Push it?' }), q({ header: 'Tests', question: 'Run them?', options: [{ label: 'All', description: '' }, { label: 'Changed only', description: '' }] })];
    const app = open({}, [question(two)]);
    app.prompt(null);
    expect(submit()).toBeDisabled();
    await user.click(optionButton(/^Push and open a draft PR/));
    expect(optionButton(/^Push and open a draft PR/)).toHaveAttribute('aria-pressed', 'true');
    expect(app.client.answer).not.toHaveBeenCalled();
    expect(submit()).toBeDisabled();
    // One choice per question: picking another moves it.
    await user.click(optionButton(/^Only push/));
    expect(optionButton(/^Push and open a draft PR/)).toHaveAttribute('aria-pressed', 'false');
    await user.click(optionButton(/^Changed only/));
    await user.click(submit()!);
    expect(app.client.answer).toHaveBeenCalledWith('a', { kind: 'question', question: 'toolu_13', answers: [{ options: [1] }, { options: [1] }], epoch: 1 });
  });

  it('VIEW-4.1: multi-select works as in the terminal: boxes toggle, and typed text joins them', async () => {
    const user = userEvent.setup();
    const app = open({}, [question([q({ multiSelect: true, question: 'Which checks?', header: 'Checks' })])]);
    app.prompt(null);
    expect(screen.getByText('Several can be picked')).toBeInTheDocument();
    expect(optionButton(/^Only push/).querySelector('[data-field="choice"] svg')).toHaveClass('lucide-square');
    await user.click(optionButton(/^Push and open a draft PR/));
    await user.click(optionButton(/^Not yet/));
    await user.click(optionButton(/^Push and open a draft PR/));
    await user.click(optionButton(/^Push and open a draft PR/));
    expect(optionButton(/^Not yet/).querySelector('[data-field="choice"] svg')).toHaveClass('lucide-square-check');
    await user.type(screen.getByRole('textbox', { name: 'Type something: Checks' }), '  also the docs  ');
    await user.click(submit()!);
    expect(app.client.answer).toHaveBeenCalledWith('a', { kind: 'question', question: 'toolu_13', answers: [{ options: [0, 2], text: 'also the docs' }], epoch: 1 });
  });

  it('VIEW-4.1: "Type something" stands in for the option of a one-choice question; then Submit, or Enter, sends it', async () => {
    const user = userEvent.setup();
    const app = open({}, [question([q()])]);
    app.prompt(null);
    const box = screen.getByRole('textbox', { name: 'Type something: Next step' });
    await user.type(box, 'Push to my fork instead');
    expect(submit()).toBeEnabled();
    await user.type(box, '{Enter}');
    expect(app.client.answer).toHaveBeenCalledWith('a', { kind: 'question', question: 'toolu_13', answers: [{ options: [], text: 'Push to my fork instead' }], epoch: 1 });
  });

  it('VIEW-4.1: a pasted tab is a space, and other control characters go, so the answer can be typed', async () => {
    const user = userEvent.setup();
    const app = open({}, [question([q()])]);
    app.prompt(null);
    const box = screen.getByRole('textbox', { name: 'Type something: Next step' });
    await user.click(box);
    await user.paste('col1\tcol2\u001b[A\u0007 done');
    expect(box).toHaveValue('col1 col2[A done');
    await user.type(box, '{Enter}');
    expect(app.client.answer).toHaveBeenCalledWith('a', { kind: 'question', question: 'toolu_13', answers: [{ options: [], text: 'col1 col2[A done' }], epoch: 1 });
  });

  it('VIEW-4.1: an answer the server can’t take as written (400) stays in the form with why; the terminal doesn’t open', async () => {
    const user = userEvent.setup();
    const why = 'The answer has characters that can’t be typed.';
    const answer = vi.fn().mockRejectedValueOnce(new SaveError(why, null, 400)).mockResolvedValue({ epoch: 9 });
    const app = open({}, [question([q()])], { answer });
    app.prompt(null);
    await user.click(drawerToggle());
    const box = screen.getByRole('textbox', { name: 'Type something: Next step' });
    await user.type(box, 'Push to my fork{Enter}');
    const asked = screen.getByTestId('chat').querySelector('[data-kind="question"]') as HTMLElement;
    expect(within(asked).getByRole('alert')).toHaveTextContent(why);
    expect(box).toHaveValue('Push to my fork');
    expect(box).toBeEnabled();
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false');
    // Fixed and sent again from the form.
    await user.type(box, ' instead{Enter}');
    expect(app.client.answer).toHaveBeenLastCalledWith('a', { kind: 'question', question: 'toolu_13', answers: [{ options: [], text: 'Push to my fork instead' }], epoch: 1 });
    expect(within(asked).queryByRole('alert')).toBeNull();
  });

  it('VIEW-4.1: a one-click question leaves no empty row under "Type something…"; the row comes with Submit or progress', async () => {
    const user = userEvent.setup();
    open({}, [question([q()])], { answer: () => new Promise(() => {}) }).prompt(null);
    const row = () => screen.getByTestId('chat').querySelector('[data-slot="answer-actions"]') as HTMLElement;
    expect(row()).not.toHaveClass('mt-2.5');
    expect(row()).not.toHaveClass('min-h-7');
    expect(row()).toHaveTextContent('');
    // Typing brings Submit, and its row.
    await user.type(screen.getByRole('textbox', { name: 'Type something: Next step' }), 'x');
    expect(row()).toHaveClass('mt-2.5', 'min-h-7');
    await user.clear(screen.getByRole('textbox', { name: 'Type something: Next step' }));
    await user.click(optionButton(/^Only push/));
    expect(row()).toHaveClass('mt-2.5');
    expect(row()).toHaveTextContent('Answering…');
  });

  it('VIEW-1.12: an answerable question links the addresses in its header and text, never inside its answer buttons', async () => {
    const user = userEvent.setup();
    const withLinks = q({
      header: 'See https://example.com/aBc',
      question: 'Merge https://github.com/productiveio/lookout/pull/12?',
      options: [
        { label: 'Merge https://github.com/productiveio/lookout/pull/12', description: 'As https://example.com/merge says' },
        { label: 'Not yet', description: '' },
      ],
    });
    const app = open({}, [question([withLinks])]);
    app.prompt(null);
    const card = screen.getByTestId('chat').querySelector('[data-kind="question"]') as HTMLElement;
    const [header, text] = within(card).getAllByRole('link');
    expect(within(card).getAllByRole('link')).toHaveLength(2);
    // Under the uppercase header, the link keeps its case.
    expect(header).toHaveAttribute('href', 'https://example.com/aBc');
    expect(header!.parentElement).toHaveClass('uppercase');
    expect(header).toHaveClass('normal-case');
    expect(text).toHaveAttribute('href', 'https://github.com/productiveio/lookout/pull/12');
    expect(text!.closest('button')).toBeNull();
    const merge = optionButton(/^Merge https/);
    expect(merge.querySelector('a')).toBeNull();
    expect(merge).toHaveTextContent('Merge https://github.com/productiveio/lookout/pull/12As https://example.com/merge says');
    await user.click(merge);
    expect(app.client.answer).toHaveBeenCalledWith('a', { kind: 'question', question: 'toolu_13', answers: [{ options: [0] }], epoch: 1 });
  });

  it('VIEW-4.3: a refused answer replaces the question’s buttons with why and opens the terminal preview', async () => {
    const user = userEvent.setup();
    const why = 'This question isn’t the one waiting any more, so nothing was typed. Answer it in the terminal.';
    open({}, [question([q()])], { answer: vi.fn(async () => Promise.reject(new SaveError(why, null, 409))) }).prompt(null);
    await user.click(drawerToggle());
    await user.click(optionButton(/^Not yet/));
    const card = screen.getByTestId('chat').querySelector('[data-kind="question"]') as HTMLElement;
    expect(within(card).getByRole('alert')).toHaveTextContent(why);
    expect(within(card).queryAllByRole('button').filter((b) => b.textContent !== 'Show terminal')).toEqual([]);
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('VIEW-4.3: before the tab’s first read of the screen, the question’s buttons wait, disabled, so a click can’t go out with no epoch; the read enables them', async () => {
    const user = userEvent.setup();
    const app = open({}, [question([q()])]);
    expect(optionButton(/^Only push/)).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Type something: Next step' })).toBeDisabled();
    await user.click(optionButton(/^Only push/));
    expect(app.client.answer).not.toHaveBeenCalled();
    // The first read of a Session that Needs you comes even with nothing on screen.
    app.prompt(null, 7);
    expect(optionButton(/^Only push/)).toBeEnabled();
    await user.click(optionButton(/^Only push/));
    expect(app.client.answer).toHaveBeenCalledWith('a', { kind: 'question', question: 'toolu_13', answers: [{ options: [1] }], epoch: 7 });
  });

  it('VIEW-4.3: a form someone started answering in the terminal gets no buttons', () => {
    const app = open({}, [question([q()])]);
    app.prompt({ kind: 'question', id: 'toolu_13', untouched: false });
    const card = screen.getByTestId('chat').querySelector('[data-kind="question"]') as HTMLElement;
    expect(within(card).getByRole('alert')).toHaveTextContent(QUESTION_TOUCHED);
    expect(within(card).queryAllByRole('button')).toEqual([]);
  });

  it('VIEW-4.1: no buttons for Codex, a Session in another app, one that doesn’t Need you, or while a permission prompt is on screen', () => {
    const cases: Partial<SessionRow>[] = [{ harness: 'codex' }, { backend: 'unknown', controllable: false }, { status: 'busy' }];
    for (const over of cases) {
      const app = open(over, [question([q()])]);
      expect(within(screen.getByTestId('chat')).queryAllByRole('button', { name: /Only push/ })).toEqual([]);
      expect(screen.getByText('Answer it in the terminal.')).toBeInTheDocument();
      app.unmount();
    }
    const app = open({}, [question([q()])]);
    app.prompt(PERMISSION);
    expect(within(screen.getByTestId('chat').querySelector('[data-kind="question"]') as HTMLElement).queryAllByRole('button')).toEqual([]);
  });
});

describe('Stop (VIEW-4.4)', () => {
  const stopButton = () => within(header()).queryByRole('button', { name: /^(Stop|Stopping…)$/ });

  afterEach(() => vi.useRealTimers());

  it('VIEW-4.4: Stop is in the header’s actions only while a Controllable Session is Busy', () => {
    const app = renderApp('/s/busy');
    app.snapshot([
      row({ id: 'busy', status: 'busy' }),
      row({ id: 'idle', status: 'idle' }),
      row({ id: 'waits', status: 'needs-you' }),
      row({ id: 'orca', status: 'busy', backend: 'unknown', controllable: false }),
    ]);
    expect(stopButton()).toHaveTextContent('Stop');
    expect(header().querySelector('[data-slot="header-actions"]')).toContainElement(stopButton());
    for (const id of ['idle', 'waits', 'orca']) {
      act(() => window.history.pushState(null, '', `/s/${id}`));
      act(() => window.dispatchEvent(new PopStateEvent('popstate')));
      expect(stopButton()).toBeNull();
    }
  });

  it('VIEW-4.4: one click sends one Esc; then "Stopping…" stays disabled until the Status leaves Busy', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', status: 'busy', statusSince: NOW })]);
    await user.click(stopButton()!);
    expect(app.client.stopSession).toHaveBeenCalledWith('a');
    await waitFor(() => expect(stopButton()).toHaveTextContent('Stopping…'));
    expect(stopButton()).toBeDisabled();
    await user.click(stopButton()!);
    expect(app.client.stopSession).toHaveBeenCalledOnce();

    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'idle', statusSince: NOW + 2_000 })], remove: [] });
    expect(stopButton()).toBeNull();
    // Busy again, a new turn: Stop can be pressed again.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'busy', statusSince: NOW + 5_000 })], remove: [] });
    expect(stopButton()).toHaveTextContent('Stop');
    expect(stopButton()).toBeEnabled();
  });

  it('VIEW-4.4: still Busy 10 s after the Esc, Stop can be pressed again', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', status: 'busy', statusSince: NOW - 1_000 })]);
    await user.click(stopButton()!);
    await waitFor(() => expect(stopButton()).toHaveTextContent('Stopping…'));
    act(() => vi.advanceTimersByTime(STOP_SETTLE_MS - 1_000));
    expect(stopButton()).toBeDisabled();
    act(() => vi.advanceTimersByTime(2_000));
    expect(stopButton()).toHaveTextContent('Stop');
    expect(stopButton()).toBeEnabled();
  });

  it('VIEW-4.4: a failed Stop says why beside the button, cut to the header’s one line, and Stop can be pressed again', async () => {
    const user = userEvent.setup();
    const why = 'Couldn’t stop it: the Session host refused, and this reason is long enough to fill the whole header on its own. Check the terminal.';
    const stopSession = vi.fn<(id: string) => Promise<void>>().mockRejectedValueOnce(new SaveError(why, null, 502)).mockResolvedValueOnce(undefined);
    const app = renderApp('/s/a', { stopSession });
    app.snapshot([row({ id: 'a', status: 'busy', title: 'long-running-refactor-of-the-invoice-rounding-module-with-a-very-long-title' })]);
    await user.click(stopButton()!);
    const alert = header().querySelector<HTMLElement>('[data-slot="stop-error"]')!;
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(why);
    expect(stopButton()).toBeEnabled();
    // Stop carries it too, as its tooltip and its description.
    expect(stopButton()).toHaveAttribute('title', `Stop\n${why}`);
    expect(stopButton()).toHaveAccessibleDescription(why);
    // The whole text on hover or focus: a bubble out of the flow, so nothing moves, placed against
    // the header (positioned) and capped to it, so it stays inside the pane.
    const full = alert.querySelector('[data-slot="stop-error-full"]')!;
    expect(full).toHaveTextContent(why);
    expect(full).toHaveAttribute('aria-hidden', 'true');
    expect(full).toHaveClass('absolute', 'top-full', 'right-5', 'max-w-[min(28rem,calc(100%-2.5rem))]', 'hidden', 'group-hover:block', 'group-focus-within:block');
    expect(alert).toHaveClass('group');
    expect(alert).not.toHaveClass('relative');
    expect(header()).toHaveClass('relative');
    expect(within(alert).getByText(why, { selector: '[tabindex="0"]' })).toHaveClass('truncate');
    // Below 20rem of header it isn't shown, and its gap goes with it; a hidden alert says it to assistive tech instead.
    expect(alert).toHaveClass('@max-[20rem]:hidden');
    const narrow = header().querySelector('[data-slot="stop-error-narrow"]')!;
    expect(narrow).toHaveAttribute('role', 'alert');
    expect(narrow).toHaveTextContent(why);
    expect(narrow).toHaveClass('sr-only', 'hidden', '@max-[20rem]:block');
    // There, Stop itself turns the error's colour, so the failure still shows.
    expect(stopButton()).toHaveClass('@max-[20rem]:text-destructive');
    // Pressed again, and this time it stops: the error goes, from Stop's tooltip and description too.
    await user.click(stopButton()!);
    await waitFor(() => expect(stopButton()).toHaveTextContent('Stopping…'));
    expect(header().querySelector('[data-slot="stop-error"]')).toBeNull();
    expect(stopButton()).toHaveAttribute('title', 'Stopping…');
    expect(stopButton()).not.toHaveClass('@max-[20rem]:text-destructive');
    expect(stopButton()).not.toHaveAttribute('aria-describedby');
  });

  it('VIEW-4.4: the header stays one line with a long error: only the buttons never shrink, the error gives way first, then the title, down to an ellipsis (class contract; jsdom can’t measure)', async () => {
    const user = userEvent.setup();
    const why = 'x'.repeat(400);
    const app = renderApp('/s/a', { stopSession: vi.fn(async () => Promise.reject(new SaveError(why, null, 409))) });
    app.snapshot([row({ id: 'a', status: 'busy', ownHost: true, title: 't'.repeat(200) })]);
    await user.click(stopButton()!);
    const rowEl = header().querySelector('[data-slot="header-row"]')!;
    expect(rowEl).toHaveClass('flex', 'min-w-0', 'whitespace-nowrap');
    // The title truncates, down to an ellipsis, before the buttons are touched.
    const h1 = within(header()).getByRole('heading', { level: 1 });
    expect(h1).toHaveClass('truncate', 'min-w-5');
    expect(h1).not.toHaveClass('min-w-16');
    // The error gets only the room left over (basis 0), at least 3rem, and sits outside the actions.
    const error = header().querySelector('[data-slot="stop-error"]')!;
    expect(error).toHaveClass('min-w-12', 'flex-[1_1_0]');
    expect(error).not.toHaveClass('shrink-0', 'flex-auto');
    const actions = header().querySelector('[data-slot="header-actions"]')!;
    expect(actions).not.toContainElement(error as HTMLElement);
    // Only the buttons never shrink: the rest of the line is a box of its own that shrinks to nothing
    // and cuts off what doesn't fit, so a very narrow pane never cuts the buttons.
    const info = header().querySelector('[data-slot="header-info"]')!;
    expect(info).toHaveClass('min-w-0', 'flex-1', 'overflow-x-clip');
    expect(info).not.toHaveClass('shrink-0');
    expect(info.lastElementChild).toBe(error);
    expect(info.nextElementSibling).toBe(actions);
    expect([...rowEl.children]).toEqual([info, actions]);
    expect(actions).toHaveClass('shrink-0');
    const buttons = within(actions as HTMLElement).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Stop', 'End Session']);
    for (const b of buttons) expect(b).toHaveClass('shrink-0');
    expect([...info.children].filter((c) => c.classList.contains('shrink-0')).map((c) => c.getAttribute('data-field') ?? c.getAttribute('role'))).toEqual([
      'img', // the Status marker
      'harness',
      'status',
    ]);
    // Narrow headers (a container query on the header) drop the Harness's name and the age, then the buttons' words, which stay their names.
    expect(header()).toHaveClass('@container');
    expect(within(header().querySelector('[data-field="harness"]') as HTMLElement).getByText('Claude Code', { selector: 'span' })).toHaveClass('@max-[32rem]:sr-only');
    for (const b of buttons) expect(b.querySelector('span')).toHaveClass('@max-[26rem]:sr-only');
    expect(buttons.map((b) => b.getAttribute('title'))).toEqual([`Stop\n${why}`, 'End Session']);
  });

  it('VIEW-4.4: a lost connection may have pressed Esc: it says so and opens the terminal', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a', { stopSession: vi.fn(async () => Promise.reject(new SaveError('Couldn’t reach the Lookout server.', null, null, { lost: true }))) });
    app.snapshot([row({ id: 'a', status: 'busy' })]);
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false');
    await user.click(stopButton()!);
    expect(header().querySelector('[data-slot="stop-error"]')).toHaveTextContent(LOST_STOP);
    expect(stopButton()).toHaveAccessibleDescription(LOST_STOP);
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('Esc (VIEW-4.5)', () => {
  const SPELL = NOW - 5_000;
  const escButton = () => within(header()).queryByRole('button', { name: /^(Esc|Pressing Esc…)$/ });
  const stopButton = () => within(header()).queryByRole('button', { name: /^(Stop|Stopping…)$/ });
  /** A Session that Needs you (on `/usage`'s panel, say), and the server's read of its screen in this spell. */
  function waiting(options: Parameters<typeof renderApp>[1] = {}, entries: ChatEntry[] = []) {
    const app = open({ statusSince: SPELL }, entries, options);
    const read = (p: ScreenPrompt | null, since: number | null = SPELL, epoch = 1) =>
      app.emit({ type: 'prompt', sessionId: 'a', prompt: p, epoch, uncertain: null, since });
    return { ...app, read };
  }

  afterEach(() => vi.useRealTimers());

  it('VIEW-4.5: Esc is in the header’s actions while a Controllable Session Needs you and a read of this spell shows no answer buttons; never with Stop, nor before that read', () => {
    const app = waiting();
    // No read of this spell yet: a permission prompt's buttons may be a second away.
    expect(escButton()).toBeNull();
    app.read(null, null);
    expect(escButton()).toBeNull();
    app.read(null);
    expect(escButton()).toHaveTextContent('Esc');
    expect(escButton()).toHaveAttribute('title', ESC_HINT);
    expect(escButton()!.querySelector('svg')).toHaveClass('lucide-octagon-x');
    expect(header().querySelector('[data-slot="header-actions"]')).toContainElement(escButton());
    expect(stopButton()).toBeNull();
    // A permission prompt Lookout answers: its buttons, and no Esc beside them.
    app.read(PERMISSION);
    expect(choices()).toHaveLength(3);
    expect(escButton()).toBeNull();
    // One it can't read whole: no buttons, so Esc.
    app.read({ kind: 'incomplete' });
    expect(card()).toHaveTextContent(INCOMPLETE);
    expect(escButton()).toHaveTextContent('Esc');
    // Busy: Stop, not Esc.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'busy', statusSince: NOW })], remove: [] });
    expect(escButton()).toBeNull();
    expect(stopButton()).toHaveTextContent('Stop');
    // Not for a Session in another app.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'needs-you', statusSince: SPELL, backend: 'unknown', controllable: false })], remove: [] });
    app.read(null);
    expect(escButton()).toBeNull();
  });

  it('VIEW-4.5: never beside a question’s buttons; once Lookout won’t answer it, Esc shows', async () => {
    const app = waiting({}, [question([q()])]);
    app.read(null);
    const card = screen.getByTestId('chat').querySelector('[data-kind="question"]') as HTMLElement;
    expect(within(card).getAllByRole('button').length).toBeGreaterThan(0);
    expect(escButton()).toBeNull();
    // Touched in the terminal: Lookout won't answer it.
    app.read({ kind: 'question', id: 'toolu_13', untouched: false });
    expect(await screen.findByText(QUESTION_TOUCHED)).toBeInTheDocument();
    expect(escButton()).toHaveTextContent('Esc');
  });

  it('VIEW-4.5: one click sends one Esc; then "Pressing Esc…" stays disabled until the Status leaves Needs you', async () => {
    const user = userEvent.setup();
    const app = waiting();
    app.read(null);
    await user.click(escButton()!);
    expect(app.client.escSession).toHaveBeenCalledWith('a');
    expect(app.client.stopSession).not.toHaveBeenCalled();
    await waitFor(() => expect(escButton()).toHaveTextContent('Pressing Esc…'));
    expect(escButton()).toBeDisabled();
    expect(escButton()).toHaveAttribute('title', 'Pressing Esc…');
    await user.click(escButton()!);
    expect(app.client.escSession).toHaveBeenCalledOnce();
    // The panel closed: Idle, and the button goes.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'idle', statusSince: NOW + 1_000 })], remove: [] });
    expect(escButton()).toBeNull();
    // Needs you again, a new spell: Esc once its read comes.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'needs-you', statusSince: NOW + 5_000 })], remove: [] });
    expect(escButton()).toBeNull();
    app.read(null, NOW + 5_000);
    expect(escButton()).toHaveTextContent('Esc');
    expect(escButton()).toBeEnabled();
  });

  it('VIEW-4.5: still Needs you 10 s after the Esc, it can be pressed again', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const app = waiting();
    app.read(null);
    await user.click(escButton()!);
    await waitFor(() => expect(escButton()).toHaveTextContent('Pressing Esc…'));
    act(() => vi.advanceTimersByTime(STOP_SETTLE_MS - 1_000));
    expect(escButton()).toBeDisabled();
    act(() => vi.advanceTimersByTime(2_000));
    expect(escButton()).toHaveTextContent('Esc');
    expect(escButton()).toBeEnabled();
  });

  it('VIEW-4.5: a failed Esc says why beside the button, as Stop’s does, and it can be pressed again', async () => {
    const user = userEvent.setup();
    const why = 'This Session isn’t waiting on you now, so Esc wasn’t pressed.';
    const escSession = vi.fn<(id: string) => Promise<void>>().mockRejectedValueOnce(new SaveError(why, null, 409)).mockResolvedValueOnce(undefined);
    const app = waiting({ escSession });
    app.read(null);
    await user.click(escButton()!);
    const alert = header().querySelector<HTMLElement>('[data-slot="stop-error"]')!;
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(why);
    expect(escButton()).toBeEnabled();
    expect(escButton()).toHaveAttribute('title', `${ESC_HINT}\n${why}`);
    expect(escButton()).toHaveAccessibleDescription(why);
    expect(escButton()).toHaveClass('@max-[20rem]:text-destructive', 'shrink-0');
    expect(escButton()!.querySelector('span')).toHaveClass('@max-[26rem]:sr-only');
    await user.click(escButton()!);
    await waitFor(() => expect(escButton()).toHaveTextContent('Pressing Esc…'));
    expect(header().querySelector('[data-slot="stop-error"]')).toBeNull();
  });

  it('VIEW-4.5: a lost connection may have pressed Esc: it says so and opens the terminal', async () => {
    const user = userEvent.setup();
    const app = waiting({ escSession: vi.fn(async () => Promise.reject(new SaveError('Couldn’t reach the Lookout server.', null, null, { lost: true }))) });
    app.read(null);
    // Needs you opens the drawer on its own (VIEW-2.2): close it first, as you might.
    await user.click(drawerToggle());
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false');
    await user.click(escButton()!);
    expect(header().querySelector('[data-slot="stop-error"]')).toHaveTextContent(LOST_STOP);
    expect(escButton()).toHaveAccessibleDescription(LOST_STOP);
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true');
  });
});
