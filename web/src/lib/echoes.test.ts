import type { ChatEntry } from '@shared/types.ts';
import { describe, expect, it } from 'vitest';
import { ECHO_TIMEOUT_MS, type Echo, type EchoContext, isCommand, settleEchoes, shown } from './echoes';

const T = Date.UTC(2026, 9, 19, 12, 0, 0);
let n = 0;
const iso = (t: number) => new Date(t).toISOString();
const you = (at: number | null, text = 'whatever Claude Code recorded'): ChatEntry => ({ kind: 'user', cursor: `c${++n}`, ts: at === null ? null : iso(at), text, queued: false });
const queued = (at: number, text: string): ChatEntry => ({ kind: 'user', cursor: `q1.${++n}`, ts: iso(at), text, queued: true });
const command = (at: number, text: string): ChatEntry => ({ kind: 'command', cursor: `c${++n}`, ts: iso(at), text });
const reply = (at: number): ChatEntry => ({ kind: 'assistant', cursor: `c${++n}`, ts: iso(at), text: 'Done.', final: true });

const ctx = (over: Partial<EchoContext> = {}): EchoContext => ({
  entries: [],
  queue: [],
  status: 'idle',
  statusSince: T - 60_000,
  hidden: false,
  paused: false,
  now: T,
  ...over,
});

/**
 * Messages sent at the given times, then the chat rendered over successive states as the Session
 * view does it: each call returns what the chat shows, a lost message marked "(lost)".
 */
function sent(...messages: [text: string, at: number][]) {
  let list: readonly Echo[] = messages.map(([text, at], i) => ({ id: i + 1, text, at, since: at, state: 'waiting' }));
  return (over: Partial<EchoContext> = {}) => {
    list = settleEchoes(list, ctx(over));
    return shown(list).map((e) => (e.state === 'lost' ? `${e.text} (lost)` : e.text));
  };
}

describe('VIEW-1.13 rules', () => {
  it('VIEW-1.13: a message shows until a prompt of yours written at or after the send reaches the chat', () => {
    // A reply, a prompt from before the send, or one without a time isn't its copy.
    expect(sent(['Fix it', T])({ entries: [you(T - 60_000), reply(T - 50_000), you(T - 1), reply(T + 500), you(null, 'Fix it')] })).toEqual(['Fix it']);
    expect(sent(['Fix it', T])({ entries: [you(T, 'Fix it')] })).toEqual([]);
    // When no prompt has its text, any prompt of yours left over counts.
    expect(sent(['Fix it', T])({ entries: [you(T + 300, 'recorded some other way')] })).toEqual([]);
  });

  it('VIEW-1.13: the copy with its text comes first, compared as the server sends it', () => {
    // A one-line message's tabs go as spaces, line endings as \n, and both sides are trimmed.
    const show = sent(['a\tb  ', T], ['x\r\ny', T + 400]);
    expect(show({ entries: [you(T + 600, 'x\ny')] })).toEqual(['a\tb  ']);
    expect(show({ entries: [you(T + 600, 'x\ny'), you(T + 900, 'a    b')] })).toEqual([]);
    // As Fleet records a command: shell mode's `!cmd` as `! cmd`, a slash command's arguments one space on.
    const commands = sent(['!git status', T], ['! ls', T + 100], ['/review  42', T + 400]);
    expect(commands({ entries: [command(T + 200, '! git status'), command(T + 300, '! ls')] })).toEqual(['/review  42']);
    expect(commands({ entries: [command(T + 200, '! git status'), command(T + 300, '! ls'), command(T + 800, '/review 42')] })).toEqual([]);
  });

  it('VIEW-1.13: a slash command takes only a copy with its text, and one that never comes says its result is in the terminal', () => {
    // `/usage` writes nothing to the Transcript: it never takes the next message's copy, even one
    // whose text matches neither (taking it, it would leave "Fix it" waiting).
    expect(sent(['/usage', T], ['Fix it', T + 400])({ entries: [you(T + 600, 'Fix it, as recorded')] })).toEqual([]);
    // With nothing after it, it waits out the 30 s of Idle.
    const usage = sent(['/usage', T]);
    expect(usage({ now: T + ECHO_TIMEOUT_MS - 1 })).toEqual(['/usage']);
    expect(usage({ now: T + ECHO_TIMEOUT_MS })).toEqual(['/usage (lost)']);
    expect(sent(['/review 42', T])({ entries: [command(T + 600, '/review 42')] })).toEqual([]);
    expect(isCommand('/usage')).toBe(true);
    expect(isCommand('  /review 42')).toBe(true);
    expect(isCommand('!git status')).toBe(false);
    expect(isCommand('Fix /usage')).toBe(false);
  });

  it("VIEW-1.13: a message whose copy never comes doesn't take the next one's", () => {
    // A hook blocked A: only B's copy comes.
    const show = sent(['A', T], ['B', T + 400]);
    expect(show({ entries: [you(T + 600, 'B')] })).toEqual(['A']);
    expect(show({ entries: [you(T + 600, 'B')], now: T + ECHO_TIMEOUT_MS })).toEqual(['A (lost)']);
  });

  it('VIEW-1.13: an interrupt marker is never its copy', () => {
    const show = sent(['Go on', T]);
    const interrupted = [you(T + 300, '[Request interrupted by user]'), you(T + 400, '[Request interrupted by user for tool use]')];
    expect(show({ entries: interrupted, now: T + 1_000 })).toEqual(['Go on']);
    expect(show({ entries: interrupted, now: T + ECHO_TIMEOUT_MS })).toEqual(['Go on (lost)']);
  });

  it('VIEW-1.13: the rest are replaced in send order, each copy taken once', () => {
    const show = sent(['A', T], ['B', T + 400]);
    // The first copy without a match is written after the second send: it still goes to the first message.
    expect(show({ entries: [you(T + 600, 'one')] })).toEqual(['B']);
    expect(show({ entries: [you(T + 600, 'one')], now: T + 1_000 })).toEqual(['B']);
    expect(show({ entries: [you(T + 600, 'one'), you(T + 900, 'two')], now: T + 1_000 })).toEqual([]);
  });

  it('VIEW-1.13: a queued copy replaces it, and moving into the history later changes nothing', () => {
    const show = sent(['And the tests', T], ['Then docs', T + 1_000]);
    // Queued behind a running turn: the queue shows the first.
    expect(show({ status: 'busy', entries: [you(T - 9_000)], queue: [queued(T + 200, 'And the tests')] })).toEqual(['Then docs']);
    // The turn takes it: it leaves the queue and enters the history with a later time.
    expect(show({ status: 'busy', entries: [you(T - 9_000), you(T + 5_000, 'And the tests')], queue: [] })).toEqual(['Then docs']);
  });

  it('VIEW-1.13: a replaced message stays replaced while the chat reloads without its copy', () => {
    const show = sent(['A', T], ['B', T + 400]);
    expect(show({ entries: [you(T + 600, 'A')] })).toEqual(['B']);
    // A Codex Session's id changed: its chat starts empty, then reloads.
    expect(show({ entries: [] })).toEqual(['B']);
    expect(show({ entries: [you(T + 600, 'A')] })).toEqual(['B']);
    expect(show({ entries: [you(T + 600, 'A'), you(T + 900, 'B')] })).toEqual([]);
  });

  it('VIEW-1.13: the timer runs only while the Session is Idle, from the send or the Status’s last change', () => {
    expect(sent(['Go on', T])({ now: T + ECHO_TIMEOUT_MS - 1 })).toEqual(['Go on']);
    expect(sent(['Go on', T])({ now: T + ECHO_TIMEOUT_MS })).toEqual(['Go on (lost)']);
    // Busy: a Codex Session takes a message only when its turn ends. Needs you: through an approval
    // too. Unknown: Lookout can't tell.
    for (const status of ['busy', 'needs-you', 'unknown'] as const) {
      expect(sent(['Go on', T])({ status, statusSince: T + 1_000, now: T + 10 * ECHO_TIMEOUT_MS })).toEqual(['Go on']);
    }
    // Idle again: 30 s from then.
    const idleAt = T + 120_000;
    const show = sent(['Go on', T]);
    expect(show({ status: 'needs-you', statusSince: T + 1_000, now: idleAt - 1 })).toEqual(['Go on']);
    expect(show({ statusSince: idleAt, now: idleAt + ECHO_TIMEOUT_MS - 1 })).toEqual(['Go on']);
    expect(show({ statusSince: idleAt, now: idleAt + ECHO_TIMEOUT_MS })).toEqual(['Go on (lost)']);
  });

  it('VIEW-1.13: a lost message takes only a copy with its text', () => {
    const show = sent(['A', T], ['B', T + 400]);
    expect(show({ now: T + 400 + ECHO_TIMEOUT_MS })).toEqual(['A (lost)', 'B (lost)']);
    // B's copy, written after A was sent, is B's: it doesn't go to A by send order.
    expect(show({ entries: [you(T + 40_000, 'B')], now: T + 41_000 })).toEqual(['A (lost)']);
    // Sent from the terminal after all.
    expect(show({ entries: [you(T + 40_000, 'B'), you(T + 50_000, 'A')], now: T + 51_000 })).toEqual([]);
  });

  it('VIEW-1.13: a lost message goes once a newer prompt of yours reaches the chat', () => {
    const show = sent(['Go on', T]);
    expect(show({ now: T + ECHO_TIMEOUT_MS })).toEqual(['Go on (lost)']);
    // One from before the send doesn't count.
    expect(show({ entries: [you(T - 1, 'earlier')], now: T + 40_000 })).toEqual(['Go on (lost)']);
    // Typed in the terminal, or sent from another tab.
    expect(show({ entries: [you(T - 1, 'earlier'), you(T + 40_000, 'Try this instead')], now: T + 41_000 })).toEqual([]);
  });

  it('VIEW-1.13: a waiting slash command goes, without a line, once a prompt of yours that came after it reaches the chat', () => {
    // `/status`, then a send from the composer: the Harness takes input in order, so `/status` is done.
    const status = sent(['/status', T], ['Fix it', T + 2_000]);
    expect(status({ now: T + 2_500 })).toEqual(['/status', 'Fix it']);
    expect(status({ entries: [you(T + 2_100, 'Fix it')], now: T + 2_500 })).toEqual([]);
    // `/usage`, then a prompt typed in the terminal.
    const usage = sent(['/usage', T]);
    expect(usage({ entries: [you(T - 1, 'from before the send')], now: T + 5_000 })).toEqual(['/usage']);
    expect(usage({ entries: [you(T - 1, 'from before the send'), you(T + 5_000, 'Try this')], now: T + 5_500 })).toEqual([]);
    // Codex's `/init`, written as a prompt with other text: the copy shows in its place.
    expect(sent(['/init', T])({ entries: [you(T + 300, 'Generate a file named AGENTS.md…')] })).toEqual([]);
    // An earlier message's copy, written after the command's send, doesn't count: that message came first.
    const after = sent(['A', T], ['/status', T + 300]);
    expect(after({ entries: [you(T + 600, 'A')], now: T + 1_000 })).toEqual(['/status']);
    expect(after({ entries: [you(T + 600, 'A')], now: T + 600 + ECHO_TIMEOUT_MS })).toEqual(['/status (lost)']);
  });

  it("VIEW-1.13: nothing is matched or timed out while the chat can't show them, and the count starts again when it can", () => {
    const show = sent(['Go on', T]);
    // The Session reads as ended, or its chat hasn't loaded (no Transcript).
    expect(show({ hidden: true, entries: [you(T + 300, 'Go on')], now: T + 10 * ECHO_TIMEOUT_MS })).toEqual(['Go on']);
    expect(show({ entries: [you(T + 300, 'Go on')], now: T + 10 * ECHO_TIMEOUT_MS })).toEqual([]);

    const later = sent(['Go on', T]);
    const shownAt = T + 10 * ECHO_TIMEOUT_MS;
    expect(later({ hidden: true, now: T + ECHO_TIMEOUT_MS })).toEqual(['Go on']);
    expect(later({ now: shownAt })).toEqual(['Go on']);
    expect(later({ now: shownAt + ECHO_TIMEOUT_MS - 1 })).toEqual(['Go on']);
    expect(later({ now: shownAt + ECHO_TIMEOUT_MS })).toEqual(['Go on (lost)']);
  });

  it('VIEW-1.13: while the chat shows a feed problem they show and are matched, but the count waits until it clears', () => {
    const show = sent(['Go on', T]);
    expect(show({ paused: true, now: T + 10 * ECHO_TIMEOUT_MS })).toEqual(['Go on']);
    const clearedAt = T + 10 * ECHO_TIMEOUT_MS + 1;
    expect(show({ now: clearedAt })).toEqual(['Go on']);
    expect(show({ now: clearedAt + ECHO_TIMEOUT_MS - 1 })).toEqual(['Go on']);
    expect(show({ now: clearedAt + ECHO_TIMEOUT_MS })).toEqual(['Go on (lost)']);
    // A copy already in the chat still takes its place.
    expect(sent(['Go on', T])({ paused: true, entries: [you(T + 300, 'Go on')] })).toEqual([]);
  });
});
