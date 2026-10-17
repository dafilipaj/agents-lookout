import type { ChatEntry } from '@shared/types.ts';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ActivityInput, OPTIMISTIC_MS, SETTLE_MS, activityOf, formatElapsed, tidySentAt, turnRunning } from '@/lib/activity';
import { NOW, renderApp, row, rowEl } from '@/test/helpers';

let n = 0;
const iso = (t: number) => new Date(t).toISOString();
const you = (at: number): ChatEntry => ({ kind: 'user', cursor: `c${++n}`, ts: iso(at), text: 'Fix the rounding', queued: false });
const reply = (at: number, final = true): ChatEntry => ({ kind: 'assistant', cursor: `c${++n}`, ts: iso(at), text: 'Done.', final });
const tool = (): ChatEntry => ({ kind: 'tool_call', cursor: `c${++n}`, ts: null, id: `t${n}`, tool: 'Read', summary: 'deal.rb' });

const input = (over: Partial<ActivityInput> = {}): ActivityInput => ({
  status: 'idle',
  waitingFor: null,
  statusSince: NOW - 60_000,
  ended: false,
  entries: [],
  sentAt: null,
  now: NOW,
  ...over,
});

describe('VIEW-1.10 rules', () => {
  it('VIEW-1.10: Working while Status is busy, timed from your latest prompt', () => {
    expect(activityOf(input({ status: 'busy', statusSince: NOW - 3_000, entries: [you(NOW - 12_000), tool()] }))).toEqual({ kind: 'working', since: NOW - 12_000 });
  });

  it('VIEW-1.10: optimistic for up to 5 s after a composer send, until Status catches up', () => {
    const sentAt = NOW - 1_000;
    expect(activityOf(input({ sentAt }))).toEqual({ kind: 'working', since: sentAt });
    expect(activityOf(input({ sentAt, now: sentAt + OPTIMISTIC_MS }))).toBeNull();
    // Status changed after the send (a quick turn already done): no longer optimistic.
    expect(activityOf(input({ sentAt, statusSince: NOW - 500, entries: [you(sentAt + 100), reply(NOW - 600)] }))).toBeNull();
  });

  it('VIEW-1.10: Status unknown falls back to the feed', () => {
    const unknown = (entries: ChatEntry[]) => activityOf(input({ status: 'unknown', entries }));
    expect(unknown([you(NOW - 5_000)])).toEqual({ kind: 'working', since: NOW - 5_000 });
    expect(unknown([you(NOW - 5_000), tool()])?.kind).toBe('working');
    expect(unknown([you(NOW - 5_000), reply(NOW - 1_000, false)])?.kind).toBe('working');
    expect(unknown([you(NOW - 5_000), reply(NOW - 1_000)])).toBeNull();
    expect(unknown([])).toBeNull();
  });

  it('VIEW-1.10: Needs you, with what it waits for when Status has it', () => {
    expect(activityOf(input({ status: 'needs-you', waitingFor: 'permission: Bash(rspec)' }))).toEqual({ kind: 'needs-you', waitingFor: 'permission: Bash(rspec)' });
    expect(activityOf(input({ status: 'needs-you' }))).toEqual({ kind: 'needs-you', waitingFor: null });
  });

  it('VIEW-1.10: gone once the reply is final and the Session is idle; waits briefly for that reply', () => {
    expect(activityOf(input({ entries: [you(NOW - 9_000), reply(NOW - 2_000)] }))).toBeNull();
    const midTurn = [you(NOW - 9_000), tool()];
    expect(activityOf(input({ statusSince: NOW - 1_000, entries: midTurn }))?.kind).toBe('working');
    expect(activityOf(input({ statusSince: NOW - SETTLE_MS, entries: midTurn }))).toBeNull();
  });

  it('VIEW-1.10: never for an ended Session', () => {
    expect(activityOf(input({ ended: true, status: 'busy', sentAt: NOW }))).toBeNull();
    expect(activityOf(input({ ended: true, status: 'needs-you' }))).toBeNull();
  });

  it('VIEW-1.10: the timer: a newer send wins; an answered prompt yields to Status', () => {
    const busy = { status: 'busy' as const, statusSince: NOW - 4_000 };
    expect(activityOf(input({ ...busy, entries: [you(NOW - 30_000), tool()], sentAt: NOW - 2_000 }))).toEqual({ kind: 'working', since: NOW - 2_000 });
    // The latest prompt already got its final reply: the Session works on something else.
    expect(activityOf(input({ ...busy, entries: [you(NOW - 90_000), reply(NOW - 60_000)], sentAt: NOW - 95_000 }))).toEqual({ kind: 'working', since: NOW - 4_000 });
  });

  it('VIEW-1.10: a send is queued while a turn runs: Status busy, a send not yet caught up, or unknown mid-turn', () => {
    expect(turnRunning(input({ status: 'busy' }))).toBe(true);
    expect(turnRunning(input({ sentAt: NOW - 1_000 }))).toBe(true);
    expect(turnRunning(input({ status: 'unknown', entries: [you(NOW - 5_000)] }))).toBe(true);
    expect(turnRunning(input({ statusSince: NOW - 1_000, entries: [you(NOW - 9_000), tool()] }))).toBe(false); // settling
    expect(turnRunning(input({ status: 'needs-you' }))).toBe(false);
    expect(turnRunning(input())).toBe(false);
    // The feed shows the send already answered (Status missed busy → idle): not running.
    expect(turnRunning(input({ sentAt: NOW - 3_000, entries: [you(NOW - 2_900), reply(NOW - 2_000)] }))).toBe(false);
  });

  it('VIEW-1.10: send times follow every alias, and go once a Session has definitely ended', () => {
    const live = new Set(['uuid-1', 'b']);
    const aliases = new Map([['codex:42', 'uuid-1']]);
    const ctx = { live, aliases, listKnown: true, inFlight: new Set<string>() };
    // Moved to the new id, the old key dropped; the newer time wins.
    expect(tidySentAt(new Map([['codex:42', 5], ['uuid-1', 3]]), ctx)).toEqual(new Map([['uuid-1', 5]]));
    // An ended Session's time goes, unless a send to it is still in flight.
    expect(tidySentAt(new Map([['b', 1], ['gone', 2]]), ctx)).toEqual(new Map([['b', 1]]));
    expect(tidySentAt(new Map([['gone', 2]]), { ...ctx, inFlight: new Set(['gone']) })).toEqual(new Map([['gone', 2]]));
    // While the list isn't known, nothing is dropped; an untouched map comes back as is.
    const unknown = new Map([['gone', 2]]);
    expect(tidySentAt(unknown, { ...ctx, listKnown: false })).toBe(unknown);
  });

  it('VIEW-1.10: elapsed time reads 12s, 3m 07s, 1h 02m', () => {
    expect(formatElapsed(12_400)).toBe('12s');
    expect(formatElapsed(187_000)).toBe('3m 07s');
    expect(formatElapsed(3_720_000)).toBe('1h 02m');
    expect(formatElapsed(-50)).toBe('0s');
  });
});

describe('VIEW-1.10 in the chat', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  const activity = () => screen.getByTestId('chat-activity');
  const nothing = () => expect(activity().textContent).toBe('');
  const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  function open(over: Parameters<typeof row>[0] | object = {}, entries: ChatEntry[] = [], options: Parameters<typeof renderApp>[1] = {}) {
    const app = renderApp('/s/a', options);
    app.snapshot([row({ id: 'a', ...over })]);
    app.emit({ type: 'chat', sessionId: 'a', op: 'reset', entries, before: null, queue: [] });
    return app;
  }

  it('VIEW-1.10: "Working… 12s" sits at the bottom of the chat and ticks each second; only the state is announced', () => {
    open({ status: 'busy', statusSince: NOW - 3_000 }, [you(NOW - 12_000), tool()]);
    const el = activity();
    expect(screen.getByTestId('chat').querySelector('[data-testid="chat-activity"]')).toBe(el);
    expect(screen.getByRole('list', { name: 'Messages' }).compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(el).toHaveTextContent('Working… 12s');
    const status = screen.getAllByRole('status').find((s) => el.contains(s))!;
    expect(status).toHaveTextContent(/^Working…$/);
    expect(status).toHaveAttribute('aria-live', 'polite');
    tick(1_000);
    expect(el).toHaveTextContent('Working… 13s');
    expect(status).toHaveTextContent(/^Working…$/);
    // The pulse is `animate-busy`, which only animates without prefers-reduced-motion.
    expect(el.querySelector('.animate-busy')).not.toBeNull();
  });

  it('VIEW-1.10: appears the moment you send, and goes after 5 s if Status never catches up', async () => {
    let finish: () => void = () => {};
    open({}, [you(NOW - 60_000), reply(NOW - 50_000)], { sendMessage: () => new Promise<void>((r) => (finish = r)) });
    nothing();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Go on{Enter}');
    expect(activity()).toHaveTextContent(/^Working… 0s$/);
    await act(async () => finish());
    tick(OPTIMISTIC_MS + 1_000);
    nothing();
  });

  it('VIEW-1.10: a send that fails takes it away again', async () => {
    open({}, [], {
      sendMessage: async () => {
        throw new Error('no terminal');
      },
    });
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Message' }), 'hi{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('no terminal');
    nothing();
  });

  it('VIEW-1.10: reads "Needs you" with what it waits for, then goes once the reply is final and the Session idle', () => {
    const app = open({ status: 'needs-you', statusSince: NOW - 1_000, waitingFor: 'permission: Bash(rspec)' }, [you(NOW - 20_000), tool()]);
    expect(activity()).toHaveTextContent(/^Needs you · permission: Bash\(rspec\)$/);
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'busy', statusSince: NOW })], remove: [] });
    expect(activity()).toHaveTextContent('Working… 20s');
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'idle', statusSince: NOW })], remove: [] });
    expect(activity()).toHaveTextContent('Working…'); // the final reply isn't in the chat yet
    app.emit({ type: 'chat', sessionId: 'a', op: 'append', entries: [reply(NOW)], updated: [], queue: [] });
    nothing();
  });

  it('VIEW-1.10: shown for a running view-only Session, never for an ended one', () => {
    const app = open({ status: 'busy', controllable: false, backend: 'unknown' }, [you(NOW - 5_000)]);
    expect(activity()).toHaveTextContent('Working… 5s');
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    expect(screen.getByText('This Session ended')).toBeInTheDocument();
    nothing();
  });

  const type = (text: string) => userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(screen.getByRole('textbox', { name: 'Message' }), text);

  it("VIEW-1.10: a send while busy is queued and doesn't restart the timer, before or after the queue shows", async () => {
    const app = open({ status: 'busy', statusSince: NOW - 4_000 }, [you(NOW - 60_000), tool()]);
    await type('And the tests{Enter}');
    expect(activity()).toHaveTextContent('Working… 1m 00s');
    const queued: ChatEntry = { kind: 'user', cursor: 'q1', ts: iso(NOW), text: 'And the tests', queued: true };
    app.emit({ type: 'chat', sessionId: 'a', op: 'append', entries: [], updated: [], queue: [queued] });
    expect(activity()).toHaveTextContent('Working… 1m 00s');
    app.emit({ type: 'chat', sessionId: 'a', op: 'append', entries: [], updated: [], queue: [] });
    expect(activity()).toHaveTextContent('Working… 1m 00s');
  });

  it('VIEW-1.10: a send during a background turn (no prompt of yours) keeps timing from when Status turned busy', async () => {
    const app = open({ status: 'busy', statusSince: NOW - 60_000 }, [you(NOW - 90_000), reply(NOW - 80_000)]);
    await type('Status?{Enter}');
    expect(activity()).toHaveTextContent('Working… 1m 00s');
    const queued: ChatEntry = { kind: 'user', cursor: 'q2', ts: iso(NOW), text: 'Status?', queued: true };
    app.emit({ type: 'chat', sessionId: 'a', op: 'append', entries: [], updated: [], queue: [queued] });
    app.emit({ type: 'chat', sessionId: 'a', op: 'append', entries: [], updated: [], queue: [] });
    tick(1_000);
    expect(activity()).toHaveTextContent('Working… 1m 01s');
  });

  it('VIEW-1.10: survives switching away and back before Status catches up', async () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' }), row({ id: 'b', pid: 200 })]);
    app.emit({ type: 'chat', sessionId: 'a', op: 'reset', entries: [], before: null, queue: [] });
    await type('Go on{Enter}');
    expect(activity()).toHaveTextContent('Working… 0s');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(rowEl('b'));
    nothing();
    tick(2_000);
    await user.click(rowEl('a'));
    expect(activity()).toHaveTextContent('Working… 2s');
  });

  it('VIEW-1.10: follows a Codex Session whose id changes after the send', async () => {
    const app = renderApp('/s/codex%3A42');
    app.snapshot([row({ id: 'codex:42', pid: 42, harness: 'codex' })]);
    await type('Go on{Enter}');
    expect(activity()).toHaveTextContent('Working… 0s');
    app.emit({ type: 'sessions', upsert: [row({ id: 'uuid-1', pid: 42, harness: 'codex' })], remove: ['codex:42'] });
    expect(window.location.pathname).toBe('/s/uuid-1');
    tick(1_000);
    expect(activity()).toHaveTextContent('Working… 1s');
  });

  it('VIEW-1.10: a send after an answered one is not queued, even when Status missed the turn', async () => {
    const app = open({ status: 'idle', statusSince: NOW - 60_000 }, [you(NOW - 60_000), reply(NOW - 50_000)]);
    await type('A{Enter}');
    const sentA = Date.now();
    app.emit({ type: 'chat', sessionId: 'a', op: 'append', entries: [you(sentA + 100), reply(sentA + 1_000)], updated: [], queue: [] });
    tick(sentA + 4_500 - Date.now());
    await type('B{Enter}');
    expect(activity()).toHaveTextContent(/^Working… 0s$/);
    tick(2_000); // past A's 5 s: B has its own time (the row's clock ticks once a second)
    expect(activity()).toHaveTextContent('Working… 1s');
  });

  it('VIEW-1.10: follows a Codex id change that happens while another Session is selected', async () => {
    const app = renderApp('/s/codex%3A42');
    app.snapshot([row({ id: 'codex:42', pid: 42, harness: 'codex' }), row({ id: 'b', pid: 200 })]);
    await type('Go on{Enter}');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(rowEl('b'));
    app.emit({ type: 'sessions', upsert: [row({ id: 'uuid-1', pid: 42, harness: 'codex' })], remove: ['codex:42'] });
    tick(1_000);
    await user.click(rowEl('uuid-1'));
    expect(activity()).toHaveTextContent(/^Working… [12]s$/);
  });

  it("VIEW-1.10: a failed send puts back the earlier send's time", async () => {
    let fail = false;
    const app = open({}, [you(NOW - 60_000), reply(NOW - 50_000)], {
      sendMessage: async () => {
        if (fail) throw new Error('no terminal');
      },
    });
    await type('Go on{Enter}');
    // Status caught up: the Session asks for something, so a send now isn't queued.
    tick(1_000);
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'needs-you', statusSince: NOW + 1_000 })], remove: [] });
    fail = true;
    tick(1_000);
    await type('yes{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('no terminal');
    tick(1_000);
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'busy', statusSince: NOW + 3_000 })], remove: [] });
    // Timed from the first send, not cleared to when Status turned busy.
    expect(activity()).toHaveTextContent('Working… 3s');
  });
});
