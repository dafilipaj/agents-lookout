import type { ChatEntry, ChatPage } from '@shared/types.ts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_CHAT_ENTRIES, clockTime } from '@/lib/chat';
import { chatMarks, firstLine, railFraction, stepMark } from '@/lib/marks';
import { RAIL_THROTTLE_MS } from '@/lib/rail';
import { renderApp, row } from '@/test/helpers';

// Synthetic entries only.
let n = 0;
const c = () => `m${++n}`;
const you = (text: string, ts = '2026-10-16T10:00:00Z'): ChatEntry => ({ kind: 'user', cursor: c(), ts, text, queued: false });
const agent = (text: string): ChatEntry => ({ kind: 'assistant', cursor: c(), ts: '2026-10-16T10:00:05Z', text, final: true });
const tool = (): ChatEntry => ({ kind: 'tool_call', cursor: c(), ts: null, id: `t${n}`, tool: 'Read', summary: 'deal.rb' });
const result = (text: string): ChatEntry => ({ kind: 'system', cursor: c(), ts: '2026-10-16T10:02:00Z', text });
const question = (text: string): ChatEntry => ({
  kind: 'question',
  cursor: c(),
  ts: '2026-10-16T10:03:00Z',
  id: `q${n}`,
  questions: [{ question: text, header: '', multiSelect: false, options: [{ label: 'Yes', description: '' }] }],
  status: 'pending',
  answer: null,
});

function open(options: Parameters<typeof renderApp>[1] = {}, over: object = {}) {
  const app = renderApp('/s/a', options);
  app.snapshot([row({ id: 'a', ...over })]);
  const reset = (entries: ChatEntry[], before: string | null = null, queue: ChatEntry[] = []) =>
    app.emit({ type: 'chat', sessionId: 'a', op: 'reset', entries, before, queue });
  const append = (entries: ChatEntry[], queue: ChatEntry[] = []) => app.emit({ type: 'chat', sessionId: 'a', op: 'append', entries, updated: [], queue });
  return { app, reset, append };
}

const rail = () => screen.getByRole('navigation', { name: 'Bookmarks' });
const marks = async () => {
  await waitFor(() => expect(within(rail()).queryAllByRole('button', { name: /^(Your prompt|Subagent result|Question)/ }).length).toBeGreaterThan(0));
  return within(rail()).getAllByRole('button', { name: /^(Your prompt|Subagent result|Question)/ });
};

/**
 * jsdom has no layout: each row with a Mark sits at `tops[cursor]` px in a chat 1000 px tall,
 * and scrollTo is recorded.
 */
function fakeLayout(tops: Record<string, number>, scrollHeight = 1000) {
  const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    // The chat's box is at 0; its content, and every row in it, moves up as it scrolls.
    const chat = document.querySelector<HTMLElement>('[data-testid="chat"]');
    const scrolled = chat?.scrollTop ?? 0;
    const mark = this.getAttribute('data-mark');
    const top = mark ? (tops[mark] ?? 0) - scrolled : this === chat?.firstElementChild ? -scrolled : 0;
    return { top, bottom: top + 20, left: 0, right: 0, width: 0, height: 20, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
  const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.testid === 'chat' ? scrollHeight : 0;
  });
  const scrollTo = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
  return { rect, height, scrollTo };
}

/** jsdom has no ResizeObserver: a fake one that records what it observes, and resizes on demand. */
function fakeResizeObserver() {
  const observers: { cb: ResizeObserverCallback; targets: Set<Element> }[] = [];
  class FakeResizeObserver {
    targets = new Set<Element>();
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
      observers.push(this);
    }
    observe(t: Element) {
      this.targets.add(t);
    }
    unobserve(t: Element) {
      this.targets.delete(t);
    }
    disconnect() {
      this.targets.clear();
    }
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  const observed = (el: Element) => observers.some((o) => o.targets.has(el));
  const resize = (el: Element) =>
    act(() => {
      for (const o of observers) if (o.targets.has(el)) o.cb([{ target: el } as ResizeObserverEntry], o as unknown as ResizeObserver);
    });
  return { observed, resize };
}

const tops = () => within(rail()).getAllByRole('button', { name: /^(Your prompt|Subagent result|Question)/ }).map((b) => b.parentElement!.style.top);
const messages = () => screen.getByRole('list', { name: 'Messages' });

function reducedMotion(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }),
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe('VIEW-1.11 Marks', () => {
  it('VIEW-1.11: one Mark per prompt you sent (dot), subagent result (diamond) and question (triangle); none for replies, tool calls or queued prompts', async () => {
    const { reset } = open();
    const entries = [you('Fix the rounding\nin deal totals'), agent('On it.'), tool(), result('Agent "Build" finished'), question('Recalculate drafts?')];
    reset(entries, null, [{ kind: 'user', cursor: 'q1', ts: null, text: 'Also KWD', queued: true }]);
    const buttons = await marks();
    expect(buttons.map((b) => b.dataset.markKind)).toEqual(['prompt', 'subagent', 'question']);
    const time = clockTime('2026-10-16T10:00:00Z');
    expect(buttons[0]).toHaveAccessibleName(`Your prompt at ${time}: Fix the rounding`);
    expect(buttons[1]).toHaveAccessibleName(/^Subagent result at .*: Agent "Build" finished$/);
    expect(buttons[2]).toHaveAccessibleName(/^Question at .*: Recalculate drafts\?$/);
    // One tab stop; the arrow keys move between Marks.
    expect(buttons.map((b) => b.tabIndex)).toEqual([0, -1, -1]);
    act(() => buttons[0]!.focus());
    fireEvent.keyDown(buttons[0]!, { key: 'ArrowDown' });
    expect(buttons[1]).toHaveFocus();
    fireEvent.keyDown(buttons[1]!, { key: 'End' });
    expect(buttons[2]).toHaveFocus();
  });

  it('VIEW-1.11: each Mark sits at its entry’s place in the chat’s full scroll height, and moves when the content changes', async () => {
    const first = you('first');
    const second = you('second');
    fakeLayout({ [first.cursor]: 100, [second.cursor]: 750 });
    const r = open();
    r.reset([first, agent('reply'), second]);
    const buttons = await marks();
    const top = (b: HTMLElement) => b.parentElement!.style.top;
    await waitFor(() => expect(buttons.map(top)).toEqual(['10%', '75%']));
    // A new prompt arrives: re-measured, after the throttle, in one batch.
    const third = you('third');
    fakeLayout({ [first.cursor]: 50, [second.cursor]: 400, [third.cursor]: 900 });
    r.append([agent('more'), third]);
    await waitFor(() => expect(within(rail()).getAllByRole('button', { name: /^Your prompt/ }).map(top)).toEqual(['5%', '40%', '90%']));
  });

  it('VIEW-1.11: re-measuring runs at most once per 100 ms, however often the content changes', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const first = you('first');
    const { rect } = fakeLayout({ [first.cursor]: 100 });
    const { reset, append } = open();
    reset([first, agent('reply')]);
    act(() => vi.advanceTimersByTime(RAIL_THROTTLE_MS * 2));
    const chat = screen.getByTestId('chat');
    // Each batch reads the chat's box once, then its rows.
    const batches = () => rect.mock.contexts.filter((el) => el === chat).length;
    const start = batches();
    expect(start).toBeGreaterThan(0);
    expect(tops()).toEqual(['10%']);

    append([you('second')]); // the last batch was long enough ago: measured right away
    act(() => vi.advanceTimersByTime(0));
    expect(batches()).toBe(start + 1);
    append([you('third')]); // within 100 ms of that batch: waits for the rest of it
    act(() => vi.advanceTimersByTime(RAIL_THROTTLE_MS - 1));
    expect(batches()).toBe(start + 1);
    act(() => vi.advanceTimersByTime(1));
    expect(batches()).toBe(start + 2);
    expect(tops()).toHaveLength(3);
  });

  it('VIEW-1.11: a poll that changes nothing reads no layout; a burst of changes is measured once', async () => {
    const first = you('first');
    const { rect } = fakeLayout({ [first.cursor]: 100 });
    const { reset, append } = open();
    reset([first, agent('reply')]);
    await marks();
    await new Promise((r) => setTimeout(r, 150));
    const before = rect.mock.calls.length;
    append([]); // nothing new: the chat state is the same object
    await new Promise((r) => setTimeout(r, 150));
    expect(rect.mock.calls.length).toBe(before);
    append([agent('a')]);
    append([agent('b')]);
    append([you('c')]);
    await waitFor(() => expect(within(rail()).getAllByRole('button', { name: /^Your prompt/ })).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 150));
    // One batch: the content box plus the two rows with a Mark.
    expect(rect.mock.calls.length - before).toBe(3);
  });

  it('VIEW-1.11: clicking a Mark scrolls smoothly to its entry, instantly under reduced motion', async () => {
    const user = userEvent.setup();
    const first = you('first');
    const second = result('Agent "Build" finished');
    const { scrollTo } = fakeLayout({ [first.cursor]: 100, [second.cursor]: 600 });
    const { reset } = open();
    reset([first, agent('reply'), second]);
    reducedMotion(false);
    await user.click((await marks())[1]!);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 588, behavior: 'smooth' });
    reducedMotion(true);
    await user.click((await marks())[0]!);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 88, behavior: 'auto' });
  });

  it('VIEW-1.11: hovering or focusing a Mark shows the entry’s first line and time', async () => {
    const user = userEvent.setup();
    const { reset } = open();
    reset([you('Fix the rounding\nsecond line stays out', '2026-10-16T10:00:00Z'), agent('ok'), result('Agent "Build" finished')]);
    const [prompt, sub] = await marks();
    await user.hover(prompt!);
    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(tip).toHaveTextContent('Fix the rounding');
    expect(tip).not.toHaveTextContent('second line');
    expect(tip).toHaveTextContent(clockTime('2026-10-16T10:00:00Z')!);
    // It repeats the Mark's name, so assistive tech skips it.
    expect(tip).toHaveAttribute('aria-hidden', 'true');
    expect(prompt).not.toHaveAttribute('aria-describedby');
    await user.unhover(prompt!);
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    act(() => sub!.focus());
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Agent "Build" finished');
  });

  it('VIEW-1.11: `[` and `]` jump to the previous and next Mark, but not while typing', async () => {
    const user = userEvent.setup();
    const a = you('a');
    const b = result('Agent "Build" finished');
    const q = question('Which one?');
    const { scrollTo } = fakeLayout({ [a.cursor]: 100, [b.cursor]: 400, [q.cursor]: 700 });
    const { reset } = open();
    reset([a, agent('x'), b, agent('y'), q]);
    await marks();
    screen.getByTestId('chat').scrollTop = 0; // scrolled to the top
    await user.keyboard(']');
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 88 }));
    await user.keyboard(']');
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 388 }));
    await user.keyboard(']');
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 688 }));
    await user.keyboard('[[');
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 388 }));
    const calls = scrollTo.mock.calls.length;
    await user.click(screen.getByRole('textbox'));
    await user.keyboard('[[]');
    expect(scrollTo).toHaveBeenCalledTimes(calls);
    expect(screen.getByRole('textbox')).toHaveValue('[]');
  });

  it('VIEW-1.11: the Marks are re-measured when the message list resizes, even in a chat shorter than its pane', async () => {
    const ro = fakeResizeObserver();
    const a = you('a');
    const b = you('b');
    fakeLayout({ [a.cursor]: 100, [b.cursor]: 200 });
    const { reset } = open();
    reset([]); // no messages yet: no list to observe
    reset([a, tool(), tool(), b]);
    await waitFor(() => expect(tops()).toEqual(['10%', '20%']));
    // The list that appeared is observed, not a box around it that a short chat doesn't resize.
    expect(ro.observed(messages())).toBe(true);
    fakeLayout({ [a.cursor]: 100, [b.cursor]: 450 }); // the tool calls row expanded
    ro.resize(messages());
    await waitFor(() => expect(tops()).toEqual(['10%', '45%']));
  });

  it('VIEW-1.11: the Marks are re-measured after a "Show earlier" page goes in above, and after the oldest entries are trimmed', async () => {
    const user = userEvent.setup();
    const older = you('older');
    const latest = you('latest');
    const earlierMessages = vi.fn(async (): Promise<ChatPage> => ({ entries: [older, agent('older reply')], before: null }));
    fakeLayout({ [latest.cursor]: 300 });
    const { reset, append } = open({ earlierMessages });
    reset([latest, agent('reply')], 'c-latest');
    await waitFor(() => expect(tops()).toEqual(['30%']));
    fakeLayout({ [older.cursor]: 50, [latest.cursor]: 600 });
    await user.click(within(rail()).getByRole('button', { name: 'Load earlier messages' }));
    await waitFor(() => expect(tops()).toEqual(['5%', '60%']));

    // Past the cap, while following, the oldest entries go: so does their Mark.
    const first = you('first');
    const second = you('second');
    fakeLayout({ [first.cursor]: 100, [second.cursor]: 200 });
    reset([first, second, ...Array.from({ length: MAX_CHAT_ENTRIES - 2 }, tool)]);
    await waitFor(() => expect(tops()).toEqual(['10%', '20%']));
    fakeLayout({ [second.cursor]: 50 });
    append([tool()]);
    await waitFor(() => expect(tops()).toEqual(['5%']));
    expect(within(rail()).getByRole('button', { name: /^Your prompt/ })).toHaveAccessibleName(/: second$/);
  });

  it('VIEW-1.11: `[`/`]` step from the Mark jumped to with focus inside the chat; only a key that scrolls releases the hold', async () => {
    const user = userEvent.setup();
    const a = you('a');
    const b = result('Agent "Build" finished');
    const q = question('Which one?');
    // The chat stays scrolled to the top: going by scroll position, `]` always lands on the first Mark.
    const { scrollTo } = fakeLayout({ [a.cursor]: 100, [b.cursor]: 400, [q.cursor]: 700 });
    const { reset } = open();
    reset([a, tool(), tool(), b, agent('y'), q]);
    await marks();
    screen.getByTestId('chat').scrollTop = 0;
    act(() => within(screen.getByTestId('chat')).getByRole('button', { expanded: false }).focus());
    await user.keyboard(']');
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 88 }));
    await user.keyboard(']');
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 388 }));
    await user.keyboard(']');
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 688 }));
    await user.keyboard('{ArrowDown}'); // you scroll with the keys: back to going by scroll position
    await user.keyboard(']');
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 88 }));
  });

  it('VIEW-1.11: clicking in the chat keeps a jump’s hold; pressing on its scroll bar releases it', async () => {
    const user = userEvent.setup();
    const a = you('a');
    const b = you('b');
    const q = question('Which one?');
    const { scrollTo } = fakeLayout({ [a.cursor]: 100, [b.cursor]: 400, [q.cursor]: 700 });
    const { reset } = open();
    reset([a, agent('x'), b, agent('y'), q]);
    await marks();
    screen.getByTestId('chat').scrollTop = 0;
    await user.keyboard(']]');
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 388 }));
    fireEvent.pointerDown(screen.getByText('y')); // clicking or selecting text
    await user.keyboard(']');
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 688 }));
    expect(screen.getByRole('button', { name: /Jump to latest/ })).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByTestId('chat')); // the scroll bar
    await user.keyboard(']');
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 88 }));
  });

  it('VIEW-1.11: `[`/`]` work when the layout needs Option or AltGr to type them, but not in a dialog', async () => {
    const user = userEvent.setup();
    const a = you('a');
    const { scrollTo } = fakeLayout({ [a.cursor]: 100 });
    const { reset } = open();
    reset([a, agent('x')]);
    await marks();
    screen.getByTestId('chat').scrollTop = 0;
    await user.click(screen.getByRole('button', { name: 'New Session' }));
    const dialog = await screen.findByRole('dialog');
    const button = within(dialog).getAllByRole('button')[0]!;
    act(() => button.focus()); // a button, not a text field
    fireEvent.keyDown(button, { key: ']' });
    expect(scrollTo).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.keyDown(document.body, { key: ']', altKey: true });
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 88 }));
  });

  it('VIEW-1.11: a jump from the rail moves focus to the entry; the rail is a vertical toolbar whose tab stop follows `[`/`]`', async () => {
    const user = userEvent.setup();
    const a = you('a');
    const b = you('b');
    const q = question('Which one?');
    fakeLayout({ [a.cursor]: 100, [b.cursor]: 400, [q.cursor]: 700 });
    const { reset } = open();
    reset([a, agent('x'), b, agent('y'), q]);
    const buttons = await marks();
    expect(within(rail()).getByRole('toolbar', { name: 'Marks' })).toHaveAttribute('aria-orientation', 'vertical');
    await user.click(buttons[1]!);
    const entry = (cursor: string) => messages().querySelector(`[data-mark="${cursor}"]`);
    expect(entry(b.cursor)).toHaveFocus();
    expect(buttons.map((x) => x.tabIndex)).toEqual([-1, 0, -1]);
    await user.keyboard(']');
    expect(entry(b.cursor)).toHaveFocus(); // `[`/`]` leave focus where it is…
    expect(buttons.map((x) => x.tabIndex)).toEqual([-1, -1, 0]); // …and move the tab stop
    await user.keyboard('[[[['); // `[[` types one `[`
    expect(buttons.map((x) => x.tabIndex)).toEqual([0, -1, -1]);
  });

  it('VIEW-1.11: after a jump from the rail, the arrow keys scroll the chat instead of switching Sessions (SIDE-5); the entry shows a focus ring', async () => {
    const user = userEvent.setup();
    const { app, reset } = open();
    app.snapshot([row({ id: 'a' }), row({ id: 'b' })]);
    reset([you('first'), agent('reply'), you('second')]);
    await user.click((await marks())[1]!);
    const entry = document.activeElement as HTMLElement;
    expect(entry).toHaveAttribute('data-mark');
    expect(entry).toHaveClass('focus-visible:ring-2');
    await user.keyboard('{ArrowDown}{ArrowUp}{ArrowDown}');
    expect(window.location.pathname).toBe('/s/a');
    expect(entry).toHaveFocus();
    // Outside the chat, the arrow keys still move through the Sessions.
    act(() => entry.blur());
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(window.location.pathname).toBe('/s/b'));
  });

  it('VIEW-1.11: a key that scrolls the chat from the page (after clicking its text) releases the hold; Space on a chat button does not', async () => {
    const user = userEvent.setup();
    const a = you('a');
    const b = you('b');
    const q = question('Which one?');
    const { scrollTo } = fakeLayout({ [a.cursor]: 100, [b.cursor]: 400, [q.cursor]: 700 });
    const { reset } = open();
    reset([a, tool(), tool(), b, agent('y'), q]);
    await marks();
    const chat = screen.getByTestId('chat');
    chat.scrollTop = 0;
    await user.keyboard(']]');
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 388 }));
    // Space presses a button in the chat, like Enter: the hold stays.
    const toggle = within(chat).getByRole('button', { expanded: false });
    fireEvent.keyDown(toggle, { key: ' ' });
    fireEvent.keyDown(toggle, { key: 'Enter' });
    await user.keyboard(']');
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 688 }));
    // Clicking text leaves focus on the page; End then scrolls the chat to the bottom.
    fireEvent.pointerDown(screen.getByText('y'));
    fireEvent.keyDown(document.body, { key: 'End' });
    chat.scrollTop = 1000;
    fireEvent.scroll(chat);
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull();
    chat.scrollTop = 0;
    await user.keyboard(']'); // back to going by scroll position
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 88 }));
  });

  it('VIEW-1.11: the Marks are re-measured when the rows below the list (the Working row) change the chat’s height', async () => {
    const ro = fakeResizeObserver();
    const a = you('a');
    const b = you('b');
    fakeLayout({ [a.cursor]: 100, [b.cursor]: 200 });
    const { reset } = open();
    reset([a, agent('x'), b]);
    await waitFor(() => expect(tops()).toEqual(['10%', '20%']));
    const content = screen.getByTestId('chat').firstElementChild!;
    expect(ro.observed(content)).toBe(true);
    fakeLayout({ [a.cursor]: 100, [b.cursor]: 200 }, 2000); // the Working row appeared
    ro.resize(content);
    await waitFor(() => expect(tops()).toEqual(['5%', '10%']));
  });

  it('VIEW-1.11: the tooltip stays after a click while the pointer is still on the Mark', async () => {
    const user = userEvent.setup();
    const { reset } = open();
    reset([you('Fix the rounding'), agent('ok')]);
    const [prompt] = await marks();
    await user.hover(prompt!);
    await user.click(prompt!);
    expect(prompt).not.toHaveFocus(); // focus went to the entry
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Fix the rounding');
    await user.unhover(prompt!);
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });

  it('VIEW-1.11: `[`/`]` work with Windows AltGr (Ctrl+Alt), but not with Ctrl or ⌘ alone', async () => {
    const a = you('a');
    const { scrollTo } = fakeLayout({ [a.cursor]: 100 });
    const { reset } = open();
    reset([a, agent('x')]);
    await marks();
    screen.getByTestId('chat').scrollTop = 0;
    fireEvent.keyDown(document.body, { key: ']', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: ']', metaKey: true });
    expect(scrollTo).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: ']', ctrlKey: true, altKey: true });
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 88 }));
  });

  it('VIEW-1.11: a jump counts as scrolling up (VIEW-1.5): the chat stops following new messages', async () => {
    const user = userEvent.setup();
    const { reset, append } = open();
    reset([you('first'), agent('reply')]);
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull();
    await user.click((await marks())[0]!);
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeInTheDocument();
    // jsdom puts everything "at the bottom", yet the jump holds until you scroll yourself.
    fireEvent.scroll(screen.getByTestId('chat'));
    append([agent('newer')]);
    expect(screen.getByRole('button', { name: '1 new · Jump to latest' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '1 new · Jump to latest' }));
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull();
  });

  it('VIEW-1.11: with more history, a Mark at the top loads the earlier page; `[` past the first Mark does too', async () => {
    const user = userEvent.setup();
    const older = [you('older prompt'), agent('older reply')];
    const earlierMessages = vi.fn(async (): Promise<ChatPage> => ({ entries: older, before: null }));
    const { reset } = open({ earlierMessages });
    reset([you('latest'), agent('reply')], 'c-latest');
    await marks();
    await user.click(within(rail()).getByRole('button', { name: 'Load earlier messages' }));
    expect(earlierMessages).toHaveBeenCalledWith('a', 'c-latest');
    await waitFor(() => expect(within(rail()).getAllByRole('button', { name: /^Your prompt/ })).toHaveLength(2));
    expect(within(rail()).queryByRole('button', { name: 'Load earlier messages' })).toBeNull(); // the start

    earlierMessages.mockClear();
    reset([you('again')], 'c-again');
    await marks();
    await user.keyboard('[['); // to the first Mark…
    expect(earlierMessages).not.toHaveBeenCalled();
    await user.keyboard('[['); // …and past it
    expect(earlierMessages).toHaveBeenCalledWith('a', 'c-again');
  });

  it('VIEW-1.11: the rail is hidden with no Marks, and by a container query when the chat is narrow; an ended Session offers no earlier page', async () => {
    const { app, reset } = open();
    reset([agent('Only a reply'), tool()], 'c-x');
    expect(screen.queryByRole('navigation', { name: 'Bookmarks' })).toBeNull();
    reset([you('a prompt')], 'c-x');
    await marks();
    expect(rail()).toHaveClass('hidden', '@md:block');
    expect(rail().parentElement).toHaveClass('@container');
    app.snapshot([]); // the Session ended
    expect(within(rail()).queryByRole('button', { name: 'Load earlier messages' })).toBeNull();
  });
});

describe('VIEW-1.11 helpers', () => {
  it('VIEW-1.11: Marks come from prompts, subagent results and questions; first lines are bounded', () => {
    expect(chatMarks([you('\n  hello  \nworld'), agent('x'), result('done')]).map((m) => [m.kind, m.text])).toEqual([
      ['prompt', 'hello'],
      ['subagent', 'done'],
    ]);
    expect(firstLine('x'.repeat(500))).toHaveLength(120);
    expect(railFraction(250, 1000)).toBe(0.25);
    expect(railFraction(5, 0)).toBe(0);
    expect(railFraction(2000, 1000)).toBe(1);
  });

  it('VIEW-1.11: stepping goes by scroll position, or from the Mark last jumped to', () => {
    const tops = [100, 400, 700];
    expect(stepMark(tops, 0, 1, null)).toBe(0);
    expect(stepMark(tops, 388, 1, null)).toBe(2);
    expect(stepMark(tops, 388, -1, null)).toBe(0);
    expect(stepMark(tops, 0, -1, null)).toBeNull();
    // Near the bottom the scroll can't reach the last Mark's top: step from the Mark instead.
    expect(stepMark(tops, 300, 1, 1)).toBe(2);
    expect(stepMark(tops, 300, 1, 2)).toBeNull();
    expect(stepMark([], 0, 1, null)).toBeNull();
  });
});
