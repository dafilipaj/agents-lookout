import type { ChatEntry } from '@shared/types.ts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatItems, clockTime, foldSteps, isShortUpdate, newSince, UPDATE_MAX_CHARS, workedFor } from '@/lib/chat';
import { renderApp, row } from '@/test/helpers';
import { PROMPT_STRIP_PX } from './Chat';

let n = 0;
const c = () => `c${++n}`;
const at = (min: number) => new Date(Date.UTC(2026, 10, 5, 11, 29 + min)).toISOString();
const you = (text: string, min = 0): ChatEntry => ({ kind: 'user', cursor: c(), ts: at(min), text, queued: false });
const update = (text: string, min = 1): ChatEntry => ({ kind: 'assistant', cursor: c(), ts: at(min), text, final: false });
const answer = (text: string, min = 55): ChatEntry => ({ kind: 'assistant', cursor: c(), ts: at(min), text, final: true });
const tool = (name: string, summary: string, min = 2): ChatEntry => ({ kind: 'tool_call', cursor: c(), ts: at(min), id: `t${n}`, tool: name, summary });

function open(over: Parameters<typeof row>[0] | object = {}, options: Parameters<typeof renderApp>[1] = {}) {
  const app = renderApp('/s/a', options);
  app.snapshot([row({ id: 'a', ...over })]);
  const reset = (entries: ChatEntry[]) => app.emit({ type: 'chat', sessionId: 'a', op: 'reset', entries, before: null, queue: [] });
  const append = (entries: ChatEntry[]) => app.emit({ type: 'chat', sessionId: 'a', op: 'append', entries, updated: [], queue: [] });
  return { app, reset, append };
}

const messages = () => within(screen.getByRole('list', { name: 'Messages' }));
const kinds = (rows: ReturnType<typeof foldSteps>) => rows.map((r) => (r.type === 'fold' ? `fold(${r.items.length})` : r.type === 'tools' ? 'tools' : r.entry.kind));

const spies: { mockRestore(): void }[] = [];

/** A chat box of 600 px over 2000 px of content, rows at the given content tops, for the layout jsdom doesn't have. */
function layout(tops: (el: Element) => { top: number; bottom: number } | null, sizes = { client: 600, scroll: 2000 }) {
  spies.push(vi.spyOn(Element.prototype, 'getBoundingClientRect'));
  vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
    const scrolled = document.querySelector<HTMLElement>('[aria-label="Chat"]')?.scrollTop ?? 0;
    const content = tops(this);
    const box = this.getAttribute('aria-label') === 'Chat' ? { top: 0, bottom: 600 } : content ? { top: content.top - scrolled, bottom: content.bottom - scrolled } : { top: 0, bottom: 20 };
    return { ...box, left: 0, right: 0, width: 0, height: box.bottom - box.top, x: 0, y: box.top, toJSON: () => ({}) } as DOMRect;
  });
  const isChat = (el: HTMLElement) => el.getAttribute?.('aria-label') === 'Chat';
  const client = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isChat(this) ? sizes.client : 0;
  });
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isChat(this) ? sizes.scroll : 0;
  });
  spies.push(client, scroll);
  const scrollTo = vi.fn(function (this: HTMLElement, o: ScrollToOptions) {
    this.scrollTop = o.top ?? 0;
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
  return { scrollTo };
}

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
});

describe('reading type', () => {
  it("VIEW-11.1: prompts and replies read in `reading`, replies at most 42rem; a reply's headings, inline code and tables are sized for it", () => {
    const { reset } = open();
    reset([you('Proceed to implementation'), answer('# Done\n\n## What changed\n\nThe `popover` is wider.\n\n| a | b |\n|---|---|\n| 1 | 2 |')]);
    expect(screen.getByText('Proceed to implementation').closest('.rounded-lg')).toHaveClass('text-reading');
    const reply = screen.getByText(/is wider/).closest('[data-kind="assistant"] > div')!;
    expect(reply).toHaveClass('max-w-[42rem]', 'text-reading');
    expect(screen.getByRole('heading', { name: 'Done' })).toHaveClass('text-reading-title');
    expect(screen.getByRole('heading', { name: 'What changed' })).toHaveClass('text-reading');
    expect(screen.getByText('popover', { selector: 'code' })).toHaveClass('text-prose');
    expect(screen.getByRole('table')).toHaveClass('text-prose');
  });
});

describe('the work folds, the answer shows', () => {
  it('VIEW-12.1: a short update is one plain paragraph of at most 170 characters', () => {
    expect(isShortUpdate('Reading the panel and send-dialog patterns; deps are installed.')).toBe(true);
    expect(isShortUpdate('x'.repeat(UPDATE_MAX_CHARS))).toBe(true);
    expect(isShortUpdate('x'.repeat(UPDATE_MAX_CHARS + 1))).toBe(false);
    expect(isShortUpdate('One.\n\nTwo.')).toBe(false);
    for (const t of ['- a list', '1. a step', '## Heading', '> quote', '| a | b |', '```\ncode\n```']) expect(isShortUpdate(t)).toBe(false);
  });

  it("VIEW-12.1: runs of two or more steps fold; prompts, answers, longer replies and questions never do, and a turn's answer is found without Fleet's final", () => {
    const long = update('The first run does not count. '.repeat(8));
    const entries = [you('Go'), update('Starting.'), tool('Bash', 'ls'), tool('Bash', 'pwd'), update('Reading.'), long, update('One alone.'), answer('Done.')];
    expect(kinds(foldSteps(chatItems(entries), false))).toEqual(['user', 'fold(3)', 'assistant', 'assistant', 'assistant']);
    // No final mark: the last reply before the next prompt is the answer, and the chat's last while idle.
    const plain = [you('Go'), update('Starting.'), tool('Read', 'a.ts'), update('Done here.'), you('Next'), tool('Bash', 'x'), update('Also done.')];
    expect(kinds(foldSteps(chatItems(plain), false))).toEqual(['user', 'fold(2)', 'assistant', 'user', 'tools', 'assistant']);
    // While a turn runs, its last reply is a step, not yet an answer.
    expect(kinds(foldSteps(chatItems(plain), true))).toEqual(['user', 'fold(2)', 'assistant', 'user', 'fold(2)']);
    expect(foldSteps(chatItems(plain), true).at(-1)).toMatchObject({ type: 'fold', live: true });
  });

  it('VIEW-12.2: a fold says how long the run took and what it held, its last update under it; it opens and closes', async () => {
    const user = userEvent.setup();
    const { reset } = open();
    reset([you('Proceed'), update('Starting Step 0/1.', 1), tool('Bash', 'npm ci', 3), tool('Bash', 'npm test', 4), update('Writing the failing tests.', 50), answer('All done.')]);
    const fold = messages().getByRole('button', { name: /^Worked for 49 min · 2 updates · 2 tool calls/ });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(within(fold).getByText('Writing the failing tests.')).toBeInTheDocument();
    expect(messages().queryByText('Starting Step 0/1.')).toBeNull();
    expect(messages().getByText('All done.')).toBeInTheDocument();
    await user.click(fold);
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    expect(messages().getByText('Starting Step 0/1.')).toBeInTheDocument();
    expect(messages().getByText('2 tool calls: Bash ×2')).toBeInTheDocument();
    // As unfolded: the turn's first reply says who and when; the later one doesn't.
    const steps = within(messages().getByRole('list', { name: 'Steps' }));
    expect(steps.getByText('Starting Step 0/1.').closest('[data-kind]')!.querySelector('time')).toHaveAttribute('dateTime', at(1));
    expect(steps.getByText('Writing the failing tests.').closest('[data-kind]')!.querySelector('time')).toBeNull();
    await user.click(fold);
    expect(messages().queryByText('Starting Step 0/1.')).toBeNull();
    expect(workedFor(30_000)).toBe('less than a minute');
    expect(workedFor(65 * 60_000)).toBe('1 h 5 min');
  });

  it('VIEW-12.3: while a turn runs, the run at the end is "Working", its hint the latest update', async () => {
    const { reset, append } = open({ status: 'busy', statusSince: Date.now() });
    reset([you('Run option 1'), update('Running the two repo tests.'), tool('Bash', 'pnpm vitest')]);
    expect(messages().getByRole('button', { name: /^Working · 1 update · 1 tool call/ })).toBeInTheDocument();
    await append([update('Both pass; now the acceptance files.')]);
    const fold = messages().getByRole('button', { name: /^Working · 2 updates · 1 tool call/ });
    expect(within(fold).getByText('Both pass; now the acceptance files.')).toBeInTheDocument();
  });

  it("VIEW-12.1: a prompt you sent that isn't in the Transcript yet ends the turn before it: its answer doesn't fold", async () => {
    const user = userEvent.setup();
    const { reset } = open({}, { sendMessage: vi.fn(() => new Promise<void>(() => {})) });
    reset([you('Go'), update('Starting.'), tool('Bash', 'ls'), update('Short reply.', 9)]);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Next{Enter}');
    expect(document.querySelector('[data-echo="waiting"]')).toHaveTextContent('Next');
    expect(messages().queryByRole('button', { name: /^Working/ })).toBeNull();
    expect(messages().getByRole('button', { name: /^Worked for .* 1 update · 1 tool call/ })).toHaveAttribute('aria-expanded', 'false');
    expect(messages().getAllByText('Short reply.')).toHaveLength(1);
  });

  it('VIEW-12.4: a fold you opened stays open as steps join it; Marks stay outside folds', async () => {
    const user = userEvent.setup();
    const { reset, append } = open({ status: 'busy', statusSince: Date.now() });
    reset([you('Go'), update('Starting.'), tool('Bash', 'ls')]);
    await user.click(messages().getByRole('button', { name: /^Working/ }));
    await append([tool('Read', 'a.ts'), update('Reading a.ts.')]);
    expect(messages().getByRole('button', { name: /^Working · 2 updates · 2 tool calls/ })).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('[data-fold] [data-mark]')).toBeNull();
    expect(document.querySelector('[data-mark]')).toHaveTextContent('Go');
  });
});

describe('new since you looked', () => {
  it('VIEW-13.1: leaving the view keeps the last entry as seen, kept alive when the tab hides', async () => {
    const setChatSeen = vi.fn(async () => {});
    const { reset } = open({}, { setChatSeen });
    const last = answer('Done.');
    reset([you('Go'), last]);
    await waitFor(() => expect(messages().getByText('Done.')).toBeInTheDocument());
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    spies.push(visibility);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(setChatSeen).toHaveBeenCalledWith('a', { cursor: last.cursor, at: Date.parse(last.ts!) }, true);
  });

  it('VIEW-13.2: a divider sits above the first entry of the agent\'s after what you saw; your own prompts alone make none', async () => {
    const seen = answer('Earlier answer.', 10);
    const fresh = update('Picking it up again.', 30);
    const entries = [you('Go'), seen, you('More', 20), fresh, tool('Bash', 'ls', 31), answer('Done.', 40)];
    const { reset } = open({}, { chatSeen: async () => ({ cursor: seen.cursor, at: null }) });
    reset(entries);
    const divider = await screen.findByRole('separator', { name: `New since you looked, ${clockTime(fresh.ts)}` });
    expect(divider.closest('li')!.nextElementSibling).toHaveTextContent('Picking it up again.');
    // By time, when the cursor isn't loaded; and nothing new of the agent's makes no divider.
    expect(newSince(entries, { cursor: 'gone', at: Date.parse(at(25)) })).toEqual({ key: fresh.cursor, ts: fresh.ts });
    expect(newSince(entries, { cursor: 'gone', at: Date.parse(fresh.ts!) })).toEqual({ key: fresh.cursor, ts: fresh.ts });
    expect(newSince(entries.slice(0, 3), { cursor: seen.cursor, at: null })).toBeNull();
    // A run of tool calls is cut where the new part begins, so the calls you saw stay above it.
    const calls = [tool('Bash', 'one'), tool('Bash', 'two'), tool('Bash', 'three')];
    const cut = newSince(calls, { cursor: calls[1]!.cursor, at: null })!;
    expect(chatItems(calls, cut.key).map((it) => (it.type === 'tools' ? it.calls.length : 0))).toEqual([2, 1]);
  });

  it('VIEW-13.2: a chat sent as you left it, its new entries following, still gets the divider; a tab back from hidden with nothing new has none', async () => {
    const seen = answer('Earlier answer.', 10);
    const { reset, append } = open({}, { chatSeen: async () => ({ cursor: seen.cursor, at: null }) });
    // A feed viewed again soon after comes as it was; what's new follows on the next read.
    reset([you('Go'), seen]);
    await waitFor(() => expect(messages().getByText('Earlier answer.')).toBeInTheDocument());
    await act(async () => {});
    const fresh = answer('Picked it up again.', 30);
    await append([fresh]);
    expect(await screen.findByRole('separator', { name: `New since you looked, ${clockTime(fresh.ts)}` })).toBeInTheDocument();
    // Hidden, then back: the divider moves to what came meanwhile, here in the moment after.
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    spies.push(visibility);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    visibility.mockReturnValue('visible');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    const later = answer('And more.', 40);
    await append([later]);
    expect(await screen.findByRole('separator', { name: `New since you looked, ${clockTime(later.ts)}` })).toBeInTheDocument();
    // Again, with nothing new: the divider goes once the wait is over.
    visibility.mockReturnValue('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    visibility.mockReturnValue('visible');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(screen.queryByRole('separator', { name: /New since you looked/ })).toBeNull(), { timeout: 4000 });
  });

  it('VIEW-13.3: the chat opens at the divider when what is new is taller than it, else at the bottom', async () => {
    const seen = answer('Earlier answer.', 10);
    layout((el) => (el.hasAttribute('data-new-divider') ? { top: 1000, bottom: 1016 } : null));
    const { reset } = open({}, { chatSeen: async () => ({ cursor: seen.cursor, at: null }) });
    reset([you('Go'), seen, answer('A long new answer.', 30)]);
    await screen.findByRole('separator', { name: /New since you looked/ });
    const chat = screen.getByLabelText('Chat');
    await waitFor(() => expect(chat.scrollTop).toBe(1000 - 12 - PROMPT_STRIP_PX));
    expect(await screen.findByRole('button', { name: /Jump to latest/ })).toBeInTheDocument();
  });

  it('VIEW-13.3: when what is new fits, the chat opens at the bottom, as before', async () => {
    const seen = answer('Earlier answer.', 10);
    layout((el) => (el.hasAttribute('data-new-divider') ? { top: 1700, bottom: 1716 } : null));
    const { reset } = open({}, { chatSeen: async () => ({ cursor: seen.cursor, at: null }) });
    reset([you('Go'), seen, answer('A short new answer.', 30)]);
    await screen.findByRole('separator', { name: /New since you looked/ });
    expect(screen.getByLabelText('Chat').scrollTop).toBe(2000);
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull();
  });

  it('VIEW-13.4: a failed read opens the chat with no divider', async () => {
    const { reset } = open({}, { chatSeen: async () => Promise.reject(new Error('offline')) });
    reset([you('Go'), answer('Done.')]);
    await waitFor(() => expect(messages().getByText('Done.')).toBeInTheDocument());
    expect(screen.queryByRole('separator', { name: /New since you looked/ })).toBeNull();
  });
});

describe('your latest prompt, in sight', () => {
  it('VIEW-14.1: while your latest prompt is out of view, a strip names it and leads back to it', async () => {
    const user = userEvent.setup();
    const { scrollTo } = layout((el) => (el.getAttribute('data-prompt-row') === prompt.cursor ? { top: 100, bottom: 140 } : null));
    const prompt = you('Proceed to implementation, then run the tests');
    const { reset } = open();
    reset([you('Earlier'), answer('Ok.'), prompt, update('Starting.'), tool('Bash', 'ls'), answer('Done.')]);
    const strip = await screen.findByRole('button', { name: `You, ${clockTime(prompt.ts)}: Proceed to implementation, then run the tests` });
    expect(strip.closest('[data-slot="prompt-strip"]')).toHaveClass('absolute', 'top-0');
    await user.click(strip);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 100 - 12 - PROMPT_STRIP_PX }));
    // Focus goes to the prompt, so it isn't lost when the strip goes.
    expect(document.activeElement).toBe(document.querySelector(`[data-prompt-row="${prompt.cursor}"]`));
    // Back in view, the strip goes.
    act(() => void screen.getByLabelText('Chat').dispatchEvent(new Event('scroll')));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^You, / })).toBeNull());
  });

  it('VIEW-14.2: what the chat scrolls into view for focus or a link lands below the strip', () => {
    const { reset } = open();
    reset([you('Go'), answer('Done.')]);
    expect(screen.getByLabelText('Chat')).toHaveClass('scroll-pt-9');
  });
});
