import type { ChatEntry } from '@shared/types.ts';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ECHO_TIMEOUT_MS, IN_TERMINAL, NOT_TAKEN } from '@/lib/echoes';
import { NOW, renderApp, row, rowEl } from '@/test/helpers';

let n = 0;
const iso = (t: number) => new Date(t).toISOString();
const you = (at: number, text = 'Fix the rounding'): ChatEntry => ({ kind: 'user', cursor: `c${++n}`, ts: iso(at), text, queued: false });
const reply = (at: number): ChatEntry => ({ kind: 'assistant', cursor: `c${++n}`, ts: iso(at), text: 'Done.', final: true });
const command = (at: number, text: string): ChatEntry => ({ kind: 'command', cursor: `c${++n}`, ts: iso(at), text });

describe('VIEW-1.13 in the chat', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  /** The messages on their way, as the chat shows them: one whose copy never came marked "(lost)". */
  const echoes = () =>
    [...document.querySelectorAll<HTMLElement>('[data-echo]')].map((el) => {
      const text = el.firstElementChild?.lastElementChild?.textContent;
      return el.dataset.echo === 'lost' ? `${text} (lost)` : text;
    });
  const type = (text: string) => user().type(screen.getByRole('textbox', { name: 'Message' }), text);
  const drawerToggle = () => screen.getByRole('button', { name: /^Terminal/ });
  const copy = (app: ReturnType<typeof renderApp>, ...entries: ChatEntry[]) =>
    app.emit({ type: 'chat', sessionId: 'a', op: 'append', entries, updated: [], queue: [] });
  const status = (app: ReturnType<typeof renderApp>, s: 'idle' | 'busy' | 'needs-you') =>
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: s, statusSince: Date.now() })], remove: [] });

  function open(over: Partial<Parameters<typeof row>[0]> = {}, entries: ChatEntry[] = [you(NOW - 60_000), reply(NOW - 50_000)], options: Parameters<typeof renderApp>[1] = {}) {
    const app = renderApp('/s/a', options);
    app.snapshot([row({ id: 'a', ...over }), row({ id: 'b', pid: 200 })]);
    app.emit({ type: 'chat', sessionId: 'a', op: 'reset', entries, before: null, queue: [] });
    return app;
  }

  it('VIEW-1.13: your message shows at once, dimmed, in the chat, above the "Working…" row', async () => {
    let finish: () => void = () => {};
    open({}, [you(NOW - 60_000), reply(NOW - 50_000)], { sendMessage: () => new Promise<void>((r) => (finish = r)) });
    await type('Fix it too{Enter}');
    expect(echoes()).toEqual(['Fix it too']);
    const el = document.querySelector<HTMLElement>('[data-echo]')!;
    expect(screen.getByRole('list', { name: 'Messages' })).toContainElement(el);
    expect(el.firstElementChild).toHaveClass('opacity-60');
    expect(el).toHaveTextContent(/^You\s*sending/);
    // Above the Working row: message, then Working.
    const activity = screen.getByTestId('chat-activity');
    expect(activity).toHaveTextContent('Working… 0s');
    expect(el.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => finish());
    expect(echoes()).toEqual(['Fix it too']);
  });

  it("VIEW-1.13: replaced by the Transcript's copy, shell mode's `! cmd` too", async () => {
    const app = open();
    await type('!git status{Enter}');
    expect(echoes()).toEqual(['!git status']);
    // A prompt from before the send, delivered late, isn't its copy.
    copy(app, you(NOW - 1_000, 'typed in the terminal earlier'));
    expect(echoes()).toEqual(['!git status']);
    copy(app, command(Date.now() + 300, '! git status'));
    expect(echoes()).toEqual([]);
    expect(screen.getByText('! git status')).toBeInTheDocument();
  });

  it("VIEW-1.13: a slash command that writes nothing keeps its place, then says its result is in the terminal", async () => {
    open();
    await type('/usage{Enter}');
    tick(ECHO_TIMEOUT_MS - 1_000);
    expect(echoes()).toEqual(['/usage']);
    tick(1_000);
    expect(echoes()).toEqual(['/usage (lost)']);
    const el = document.querySelector<HTMLElement>('[data-echo]')!;
    expect(within(el).getByRole('status')).toHaveTextContent(IN_TERMINAL);
    expect(within(el).queryByRole('alert')).toBeNull();
    // That's where its result is.
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('VIEW-1.13: a waiting slash command goes, without a line or the preview, once a prompt of yours that came after it reaches the chat', async () => {
    const app = open();
    // `/status`, then a send from the composer, recorded as `! git status`.
    await type('/status{Enter}');
    tick(300);
    await type('!git status{Enter}');
    expect(echoes()).toEqual(['/status', '!git status']);
    copy(app, command(Date.now() + 100, '! git status'));
    expect(echoes()).toEqual([]);
    // `/usage`, then a prompt typed in the terminal.
    tick(1_000);
    await type('/usage{Enter}');
    expect(echoes()).toEqual(['/usage']);
    copy(app, you(Date.now() + 100, 'Typed in the terminal'));
    expect(echoes()).toEqual([]);
    tick(3 * ECHO_TIMEOUT_MS);
    expect(echoes()).toEqual([]);
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByRole('listitem').at(-1)).toHaveTextContent('Typed in the terminal');
  });

  it('VIEW-1.13: replaced by its queued copy when the Session is Busy', async () => {
    const app = open({ status: 'busy', statusSince: NOW - 4_000 }, [you(NOW - 60_000)]);
    await type('And the tests{Enter}');
    expect(echoes()).toEqual(['And the tests']);
    const q: ChatEntry = { kind: 'user', cursor: 'q1.0', ts: iso(Date.now() + 200), text: 'And the tests', queued: true };
    app.emit({ type: 'chat', sessionId: 'a', op: 'append', entries: [], updated: [], queue: [q] });
    expect(echoes()).toEqual([]);
    expect(document.querySelectorAll('[data-queued]')).toHaveLength(1);
  });

  it('VIEW-1.13: shows in an empty conversation instead of "No messages yet"', async () => {
    const app = open({}, []);
    expect(screen.getByText('No messages yet')).toBeInTheDocument();
    await type('Hello{Enter}');
    expect(screen.queryByText('No messages yet')).toBeNull();
    expect(echoes()).toEqual(['Hello']);
    // A new Session's first prompt comes as a reset, not an append.
    app.emit({ type: 'chat', sessionId: 'a', op: 'reset', entries: [you(Date.now() + 200, 'Hello')], before: null, queue: [] });
    expect(echoes()).toEqual([]);
  });

  it('VIEW-1.13: a failed send takes it away; the composer keeps the text', async () => {
    open({}, undefined, {
      sendMessage: async () => {
        throw new Error('no terminal');
      },
    });
    await type('hi{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('no terminal');
    expect(echoes()).toEqual([]);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('hi');
  });

  it('VIEW-1.13: two quick sends are each replaced, in order', async () => {
    const app = open();
    await type('A{Enter}');
    tick(300);
    await type('B{Enter}');
    expect(echoes()).toEqual(['A', 'B']);
    copy(app, you(Date.now() + 100, 'A'));
    expect(echoes()).toEqual(['B']);
    copy(app, you(Date.now() + 200, 'B'));
    expect(echoes()).toEqual([]);
    expect(screen.getAllByText(/^[AB]$/)).toHaveLength(2);
  });

  it("VIEW-1.13: neither an interrupt marker nor a later message's copy takes its place", async () => {
    const app = open();
    await type('A{Enter}');
    tick(300);
    await type('B{Enter}');
    // A hook blocked A, then Stop: B's copy comes, and Claude Code's interrupt marker.
    copy(app, you(Date.now() + 100, 'B'), you(Date.now() + 200, '[Request interrupted by user]'));
    expect(echoes()).toEqual(['A']);
  });

  it('VIEW-1.13: one whose copy never comes in 30 s of Idle says so and opens the Terminal preview', async () => {
    open();
    await type('Go on{Enter}');
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false');
    tick(ECHO_TIMEOUT_MS - 1_000);
    expect(echoes()).toEqual(['Go on']);
    tick(1_000);
    expect(echoes()).toEqual(['Go on (lost)']);
    const el = document.querySelector<HTMLElement>('[data-echo]')!;
    expect(within(el).getByRole('alert')).toHaveTextContent(NOT_TAKEN);
    expect(el).not.toHaveTextContent(/^You\s*sending/);
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true');
    // Closed again, the line offers the way back, as VIEW-4.3's does.
    await user().click(drawerToggle());
    await user().click(within(el).getByRole('button', { name: 'Show terminal' }));
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true');
    // Sending again takes it away.
    await type('Again{Enter}');
    expect(echoes()).toEqual(['Again']);
  });

  it('VIEW-1.13: a lost one goes once a newer prompt of yours reaches the chat', async () => {
    const app = open();
    await type('Go on{Enter}');
    tick(ECHO_TIMEOUT_MS);
    expect(echoes()).toEqual(['Go on (lost)']);
    // Typed in the terminal, as the line suggests.
    copy(app, you(Date.now() + 100, 'Try this instead'));
    expect(echoes()).toEqual([]);
    expect(screen.getAllByRole('listitem').at(-1)).toHaveTextContent('Try this instead');
  });

  it("VIEW-1.13: a lost one stays when the next send fails, and goes when one succeeds", async () => {
    let fail = false;
    open({}, undefined, {
      sendMessage: async () => {
        if (fail) throw new Error('no terminal');
      },
    });
    await type('Go on{Enter}');
    tick(ECHO_TIMEOUT_MS);
    expect(echoes()).toEqual(['Go on (lost)']);
    fail = true;
    await type('Again{Enter}');
    expect(await screen.findByText('no terminal')).toBeInTheDocument();
    expect(echoes()).toEqual(['Go on (lost)']);
    fail = false;
    await type('{Enter}');
    expect(echoes()).toEqual(['Again']);
  });

  it("VIEW-1.13: none shows, times out or opens the preview while there's no Transcript", async () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' })]);
    app.emit({ type: 'chat', sessionId: 'a', op: 'problem', problem: { kind: 'missing', message: 'no transcript found for session a' } });
    expect(screen.getByText('No Transcript found')).toBeInTheDocument();
    await type('Go on{Enter}');
    tick(3 * ECHO_TIMEOUT_MS);
    expect(echoes()).toEqual([]);
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false');
    // Found after all: it shows, and its 30 s start then.
    app.emit({ type: 'chat', sessionId: 'a', op: 'reset', entries: [you(NOW - 60_000)], before: null, queue: [] });
    expect(echoes()).toEqual(['Go on']);
    tick(ECHO_TIMEOUT_MS - 1_000);
    expect(echoes()).toEqual(['Go on']);
    tick(1_000);
    expect(echoes()).toEqual(['Go on (lost)']);
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('VIEW-1.13: shows, but doesn\'t time out or open the preview, while the chat shows a feed problem', async () => {
    const app = open();
    await type('Go on{Enter}');
    tick(1_000);
    app.emit({ type: 'chat', sessionId: 'a', op: 'problem', problem: { kind: 'failed', message: 'fleet timed out' } });
    expect(screen.getByText(/Couldn't read new messages/)).toBeInTheDocument();
    tick(3 * ECHO_TIMEOUT_MS);
    expect(echoes()).toEqual(['Go on']);
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false');
    // Cleared: its 30 s start then.
    app.emit({ type: 'chat', sessionId: 'a', op: 'problem', problem: null });
    tick(ECHO_TIMEOUT_MS - 1_000);
    expect(echoes()).toEqual(['Go on']);
    tick(1_000);
    expect(echoes()).toEqual(['Go on (lost)']);
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('VIEW-1.13: the timer runs only while the Session is Idle, not while Busy or Needs you', async () => {
    const app = open();
    await type('Again{Enter}');
    status(app, 'busy');
    tick(3 * ECHO_TIMEOUT_MS);
    expect(echoes()).toEqual(['Again']);
    status(app, 'needs-you');
    tick(3 * ECHO_TIMEOUT_MS);
    expect(echoes()).toEqual(['Again']);
    status(app, 'idle');
    tick(ECHO_TIMEOUT_MS - 1_000);
    expect(echoes()).toEqual(['Again']);
    tick(1_000);
    expect(echoes()).toEqual(['Again (lost)']);
  });

  it('VIEW-1.13: a Codex Session getting its session id keeps them', async () => {
    const app = renderApp('/s/codex%3A42');
    app.snapshot([row({ id: 'codex:42', pid: 42, harness: 'codex' })]);
    const history = [you(NOW - 60_000), reply(NOW - 50_000)];
    app.emit({ type: 'chat', sessionId: 'codex:42', op: 'reset', entries: history, before: null, queue: [] });
    await type('Go on{Enter}');
    expect(echoes()).toEqual(['Go on']);
    app.emit({ type: 'sessions', upsert: [row({ id: 'uuid-1', pid: 42, harness: 'codex' })], remove: ['codex:42'] });
    expect(window.location.pathname).toBe('/s/uuid-1');
    app.emit({ type: 'chat', sessionId: 'uuid-1', op: 'reset', entries: history, before: null, queue: [] });
    expect(echoes()).toEqual(['Go on']);
    app.emit({ type: 'chat', sessionId: 'uuid-1', op: 'append', entries: [you(Date.now() + 200, 'Go on')], updated: [], queue: [] });
    expect(echoes()).toEqual([]);
  });

  it('VIEW-1.13: none for an ended Session, and they go when you select another Session', async () => {
    const app = open();
    await type('Go on{Enter}');
    expect(echoes()).toEqual(['Go on']);
    await user().click(rowEl('b'));
    await user().click(rowEl('a'));
    expect(echoes()).toEqual([]);

    await type('Once more{Enter}');
    expect(echoes()).toEqual(['Once more']);
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    expect(screen.getByText('This Session ended')).toBeInTheDocument();
    expect(echoes()).toEqual([]);
  });
});
