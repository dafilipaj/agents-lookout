import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asSent } from '../shared/message.ts';
import type { ServerEvent, SessionRow } from '../shared/types.ts';
import { AnswerLedger } from './answerer.ts';
import type { RunOptions } from './exec.ts';
import type { FleetListResult, FleetRow } from './fleet.ts';
import { HELD_OTHER, MAX_MESSAGE, OLD_FLEET_SEND, ViewError, Viewer, fleetTarget } from './viewer.ts';

const fleetRow = (over: Partial<FleetRow>): FleetRow => ({
  pid: 1,
  session_id: null,
  cwd: '/x',
  status: 'idle',
  waiting_for: null,
  updated_at: 0,
  backend: 'tmux',
  display_title: 'x',
  context: null,
  harness: 'claude',
  model: null,
  ...over,
});

const row = (over: Partial<SessionRow> & { id: string }): SessionRow => ({
  pid: 4242,
  harness: 'claude',
  title: over.id,
  status: 'idle',
  waitingFor: null,
  statusSince: 0,
  contextPct: null,
  cwd: '/x',
  git: null,
  backend: 'tmux',
  controllable: true,
  ownHost: true,
  model: null,
  effort: null,
  subagents: null, backgroundShell: false,
  procStart: null,
  pendingModel: null, pendingEffort: null,
  modelAt: null,
  ...over,
});

type Call = { file: string; args: readonly string[]; opts: RunOptions };

function setup(
  over: { peek?: (call: Call) => Promise<string>; send?: (call: Call) => Promise<string>; fresh?: () => Promise<FleetListResult> } = {},
) {
  const rows = new Map<string, SessionRow>([
    ['sess-a', row({ id: 'sess-a' })],
    ['codex:77', row({ id: 'codex:77', pid: 77, harness: 'codex' })],
    ['orca', row({ id: 'orca', backend: 'unknown', controllable: false })],
  ]);
  const calls: Call[] = [];
  let screen = 'line 1\nline 2\n\n';
  const runner = vi.fn(async (file: string, args: readonly string[], opts: RunOptions) => {
    // The chat (VIEW-1) is covered in chat.test.ts; here it reads an empty Transcript.
    if (args.includes('messages')) return JSON.stringify({ ok: true, entries: [], has_more_before: false, has_more_after: false, cursor: null });
    const call = { file, args, opts };
    calls.push(call);
    if (args.includes('peek')) return over.peek ? over.peek(call) : screen;
    if (args.includes('send')) return over.send ? over.send(call) : 'sent\n';
    throw new Error('unexpected');
  });
  const sent: { clientId: string; event: ServerEvent }[] = [];
  const viewer = new Viewer({
    runner,
    fleetBin: () => '/bin/fleet',
    lookup: (id) => rows.get(id) ?? null,
    freshList: over.fresh ?? (async () => ({ kind: 'ok', rows: [fleetRow({ pid: 77, harness: 'codex', session_id: null })] })),
    sendTo: (clientId, event) => void (event.type !== 'chat' && sent.push({ clientId, event })),
    ledger: new AnswerLedger(),
    env: { PATH: '/usr/bin', CLAUDECODE: '1', OTEL_X: '1' },
  });
  const peeks = () => calls.filter((c) => c.args.includes('peek')).length;
  return { viewer, calls, sent, rows, peeks, setScreen: (s: string) => (screen = s) };
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());

describe('terminal preview', () => {
  it('VIEW-2.1: while a tab’s drawer is open, the last 40 lines are read every second and pushed to that tab', async () => {
    const t = setup();
    t.viewer.watch('tab-1', 'sess-a', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls[0]).toMatchObject({ file: '/bin/fleet', args: ['--local', 'peek', '--lines', '40', '--', 'sess-a'] });
    expect(t.sent).toEqual([{ clientId: 'tab-1', event: { type: 'preview', sessionId: 'sess-a', text: 'line 1\nline 2', error: null } }]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(t.peeks()).toBe(2);
    expect(t.sent).toHaveLength(1); // unchanged screen: nothing new pushed

    t.setScreen('line 1\nline 2\nline 3');
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sent.at(-1)!.event).toMatchObject({ text: 'line 1\nline 2\nline 3' });
  });

  it('VIEW-2.1: no peeking while the drawer is closed, or once the tab is gone', async () => {
    const t = setup();
    t.viewer.watch('tab-1', 'sess-a', false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.peeks()).toBe(0);

    t.viewer.watch('tab-1', 'sess-a', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.peeks()).toBe(1);
    t.viewer.watch('tab-1', 'sess-a', false); // drawer closed
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.peeks()).toBe(1);

    t.viewer.watch('tab-1', 'sess-a', true);
    await vi.advanceTimersByTimeAsync(0);
    t.viewer.drop('tab-1'); // tab closed
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.peeks()).toBe(2);
    expect(t.viewer.previewing()).toEqual([]);
  });

  it('VIEW-2.1: two tabs on one Session share one peek; a tab that joins gets the latest screen at once', async () => {
    const t = setup();
    t.viewer.watch('tab-1', 'sess-a', true);
    await vi.advanceTimersByTimeAsync(0);
    t.viewer.watch('tab-2', 'sess-a', true);
    expect(t.sent.map((s) => s.clientId)).toEqual(['tab-1', 'tab-2']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.peeks()).toBe(2); // one per second, not one per tab
    t.viewer.drop('tab-1');
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.peeks()).toBe(3); // tab-2 still previews
  });

  it('VIEW-2.3: never peeks a Session that is not Controllable', async () => {
    const t = setup();
    t.viewer.watch('tab-1', 'orca', true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.peeks()).toBe(0);
    expect(t.sent[0]!.event).toMatchObject({ type: 'preview', text: null, error: expect.stringContaining('another app') });
  });

  it('a failing peek keeps the last screen, says so, and retries', async () => {
    let fail = false;
    const t = setup({
      peek: async () => {
        if (fail) throw Object.assign(new Error('x'), { code: 1, stderr: 'error: no such pane\n' });
        return 'ok';
      },
    });
    t.viewer.watch('tab-1', 'sess-a', true);
    await vi.advanceTimersByTimeAsync(0);
    fail = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sent.at(-1)!.event).toEqual({ type: 'preview', sessionId: 'sess-a', text: 'ok', error: 'Preview failed: no such pane' });
    fail = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sent.at(-1)!.event).toMatchObject({ text: 'ok', error: null });
  });

  it('targets a Session by its full session id, or by pid when it has none', () => {
    expect(fleetTarget(row({ id: '0b8a…-uuid' }))).toBe('0b8a…-uuid');
    expect(fleetTarget(row({ id: 'codex:77', pid: 77, harness: 'codex' }))).toBe('77');
  });
});

describe('pid targets (a pid Fleet no longer lists would match titles fuzzily)', () => {
  it('VIEW-3.2: before sending to a pid, checks a fresh `fleet list` still has that pid with the same Harness', async () => {
    const t = setup();
    await t.viewer.send('codex:77', { text: 'OK' });
    expect(t.calls.map((c) => c.args[1])).toEqual(['send']);

    const gone = setup({ fresh: async () => ({ kind: 'ok', rows: [fleetRow({ pid: 78, harness: 'codex' })] }) });
    await expect(gone.viewer.send('codex:77', { text: 'OK' })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('no longer running') });
    expect(gone.calls).toEqual([]);

    const otherHarness = setup({ fresh: async () => ({ kind: 'ok', rows: [fleetRow({ pid: 77, harness: 'claude' })] }) });
    await expect(otherHarness.viewer.send('codex:77', { text: 'OK' })).rejects.toMatchObject({ status: 409 });

    const failing = setup({ fresh: async () => ({ kind: 'error', message: 'fleet list timed out after 4 s' }) });
    await expect(failing.viewer.send('codex:77', { text: 'OK' })).rejects.toMatchObject({ status: 503 });
    expect(failing.calls).toEqual([]);
  });

  it('VIEW-2.1: a pid preview is checked the same way before every peek', async () => {
    const t = setup({ fresh: async () => ({ kind: 'ok', rows: [] }) });
    t.viewer.watch('tab-1', 'codex:77', true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.peeks()).toBe(0);
    expect(t.sent[0]!.event).toMatchObject({ text: null, error: expect.stringContaining('no longer running') });
  });

  it('VIEW-2.1: when the fresh list fails, the preview keeps the last screen; only a pid that is gone blanks it', async () => {
    let list: FleetListResult = { kind: 'ok', rows: [fleetRow({ pid: 77, harness: 'codex' })] };
    const t = setup({ fresh: async () => list, peek: async () => 'codex screen' });
    t.viewer.watch('tab-1', 'codex:77', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.sent.at(-1)!.event).toMatchObject({ text: 'codex screen', error: null });

    list = { kind: 'error', message: 'fleet list timed out after 4 s' };
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sent.at(-1)!.event).toMatchObject({ text: 'codex screen', error: expect.stringContaining("Couldn't check") });

    list = { kind: 'ok', rows: [] };
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sent.at(-1)!.event).toMatchObject({ text: null, error: expect.stringContaining('no longer running') });
  });

  it('a session-id target needs no extra list: Fleet matches it exactly', async () => {
    const fresh = vi.fn(async (): Promise<FleetListResult> => ({ kind: 'ok', rows: [] }));
    const t = setup({ fresh });
    await t.viewer.send('sess-a', { text: 'OK' });
    expect(fresh).not.toHaveBeenCalled();
    expect(t.calls).toHaveLength(1);
  });
});

describe('composer', () => {
  it('VIEW-3.2: sends the text through `fleet send`, line breaks included, as an argv entry after `--`', async () => {
    const t = setup();
    await t.viewer.send('sess-a', { text: '-rf line one\r\n  line two\n' });
    expect(t.calls[0]).toMatchObject({ file: '/bin/fleet', args: ['--local', 'send', '--json', '--require-empty', '--', 'sess-a', '-rf line one\n  line two\n'] });
    expect(Object.keys(t.calls[0]!.opts.env!)).toEqual(['PATH']); // nothing inherited from a Claude Session
    await t.viewer.send('codex:77', { text: 'OK' });
    expect(t.calls[1]!.args).toEqual(['--local', 'send', '--json', '--require-empty', '--', '77', 'OK']);
  });

  it('VIEW-3.7: every send asks Fleet to type only into an empty input box (`--json --require-empty`, never `--force`); exit 0 is sent, whatever it prints', async () => {
    const t = setup({ send: async () => '{"ok":true,"host":"local","target":{"session_id":"sess-a","pid":4242}}\n' });
    await t.viewer.send('sess-a', { text: '/usage' });
    expect(t.calls[0]!.args).toEqual(['--local', 'send', '--json', '--require-empty', '--', 'sess-a', '/usage']);
    expect(t.calls[0]!.args).not.toContain('--force');
    const odd = setup({ send: async () => 'sent, in some other words\n' });
    await expect(odd.viewer.send('sess-a', { text: 'hi' })).resolves.toBeUndefined();
  });

  it.each([
    ['text', "The Session's input box already holds text, so nothing was sent. Send or clear it in the terminal, then try again."],
    ['prompt', 'The Session is waiting on a prompt, so nothing was sent. Answer it, then try again.'],
    ['no_input_box', "The Session's input box isn't on screen (a panel, a menu or the transcript view is open), so nothing was sent. Press Esc to close it, then try again."],
    ['unreadable', "Fleet can't read the Session's input box, so nothing was sent. Send it from the terminal instead."],
  ] as const)('VIEW-3.7: a send Fleet held for `%s` is a 409 saying why in plain words, never with what the box holds', async (why, message) => {
    const secret = '! export TOKEN=sk-live-0123456789abcdef';
    const t = setup({
      send: async () => {
        throw Object.assign(new Error('exit 3'), {
          code: 3,
          stdout: JSON.stringify({ ok: false, host: 'local', kind: 'send_held', reason: why, error: `held: ${secret}`, input: secret }),
          stderr: `Error: held: ${secret}\n`,
        });
      },
    });
    const err = await t.viewer.send('sess-a', { text: 'hi' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ViewError);
    expect(err).toMatchObject({ status: 409, message, field: null, held: { reason: why } });
    expect(JSON.stringify({ ...(err as ViewError), message: (err as ViewError).message })).not.toContain('sk-live');
  });

  it('VIEW-3.7: a held send for a reason Lookout doesn’t know says so plainly; a Fleet without the flags says to update it; other failures are as before', async () => {
    const held = setup({
      send: async () => {
        throw Object.assign(new Error('exit 3'), { code: 3, stdout: '{"ok":false,"kind":"send_held","reason":"overlay","error":"x","input":"draft"}', stderr: '' });
      },
    });
    await expect(held.viewer.send('sess-a', { text: 'hi' })).rejects.toMatchObject({ status: 409, message: HELD_OTHER, held: { reason: null } });
    const old = setup({
      send: async () => {
        throw Object.assign(new Error('exit 2'), { code: 2, stdout: '', stderr: "error: unexpected argument '--require-empty' found\n\nUsage: fleet send <TARGET> <TEXT>\n" });
      },
    });
    await expect(old.viewer.send('sess-a', { text: 'hi' })).rejects.toMatchObject({ status: 501, message: OLD_FLEET_SEND, held: null });
    const busy = setup({
      send: async () => {
        throw Object.assign(new Error('exit 1'), { code: 1, stdout: '{"ok":false,"host":"local","kind":"busy","error":"another fleet command is typing; nothing sent"}', stderr: 'Error: another fleet command is typing; nothing sent\n' });
      },
    });
    await expect(busy.viewer.send('sess-a', { text: 'hi' })).rejects.toMatchObject({ status: 502, message: "Couldn't send: another fleet command is typing; nothing sent", held: null });
  });

  it('refuses Sessions it cannot type into, empty and oversized messages; nothing is typed', async () => {
    const t = setup();
    await expect(t.viewer.send('gone', { text: 'x' })).rejects.toMatchObject({ status: 404 });
    await expect(t.viewer.send('orca', { text: 'x' })).rejects.toMatchObject({ status: 409 });
    await expect(t.viewer.send('sess-a', { text: '  \n ' })).rejects.toMatchObject({ status: 400, field: 'text' });
    await expect(t.viewer.send('sess-a', { text: 'x'.repeat(MAX_MESSAGE + 1) })).rejects.toMatchObject({ status: 413, field: 'text' });
    await expect(t.viewer.send('sess-a', {})).rejects.toBeInstanceOf(ViewError);
    expect(t.calls).toEqual([]);
  });

  it('VIEW-3.2: in one line a tab becomes spaces (typed, it would be a keypress); other control characters are refused', async () => {
    const t = setup();
    await t.viewer.send('sess-a', { text: '\tindented' });
    expect(t.calls[0]!.args.at(-1)).toBe('    indented');
    for (const bad of ['\u001b[A', 'a\u0003', 'bell\u0007', 'x\u007f']) {
      await expect(t.viewer.send('sess-a', { text: bad })).rejects.toMatchObject({ status: 400, field: 'text' });
    }
    expect(t.calls).toHaveLength(1);
  });

  it('VIEW-3.8: a slash command goes without the blanks before it, so the Harness runs it; any other message keeps them', async () => {
    const t = setup();
    for (const text of [' /model sonnet', '\t /effort high', '\n  /usage', ' \r\n/review 42\nwith a note']) {
      await t.viewer.send('sess-a', { text });
    }
    expect(t.calls.map((c) => c.args.at(-1))).toEqual(['/model sonnet', '/effort high', '/usage', '/review 42\nwith a note']);
    await t.viewer.send('sess-a', { text: '  indented, not a command /model' });
    await t.viewer.send('sess-a', { text: ' !ls' });
    expect(t.calls.slice(4).map((c) => c.args.at(-1))).toEqual(['  indented, not a command /model', ' !ls']);
    // The tab pairs the message with its copy the way the server sends it (VIEW-1.13).
    expect(asSent(' /model sonnet')).toBe('/model sonnet');
  });

  it('VIEW-3.2: multi-line text is pasted, so its tabs arrive intact (Makefiles, Go, TSV)', async () => {
    const t = setup();
    await t.viewer.send('sess-a', { text: 'all:\n\tgo build ./...\na\tb\tc\n' });
    expect(t.calls[0]!.args.at(-1)).toBe('all:\n\tgo build ./...\na\tb\tc\n');
    await expect(t.viewer.send('sess-a', { text: 'line\n\u001b[A' })).rejects.toMatchObject({ status: 400, field: 'text' });
  });

  it('VIEW-3.4: an error that comes from tmux is reworded, so the UI never names tmux (0001)', async () => {
    const t = setup({
      send: async () => {
        throw Object.assign(new Error('x'), { code: 1, stderr: "error: tmux send-keys -t %3 -l: can't find pane: %3\n" });
      },
      peek: async () => {
        throw Object.assign(new Error('x'), { code: 1, stderr: 'error: tmux capture-pane failed\n' });
      },
    });
    await expect(t.viewer.send('sess-a', { text: 'hi' })).rejects.toMatchObject({ message: "Couldn't send: the Session host refused the message." });
    t.viewer.watch('tab-1', 'sess-a', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.sent[0]!.event).toMatchObject({ error: "Preview failed: the Session host couldn't be read." });
  });

  it('VIEW-3.4: a failed send is an error with Fleet’s reason', async () => {
    const t = setup({
      send: async () => {
        throw Object.assign(new Error('x'), { code: 1, stderr: 'error: session has no terminal handle\n' });
      },
    });
    await expect(t.viewer.send('sess-a', { text: 'hi' })).rejects.toMatchObject({ status: 502, message: "Couldn't send: session has no terminal handle" });
  });
});

describe('answering and Stop (VIEW-4)', () => {
  it('VIEW-4.3: answers and Stop go through the Viewer, with the ledger its prompt reads carry: a read after an answer has its epoch, a click from the read before is refused', async () => {
    const prompt = { kind: 'permission', id: 'p2.0badc0de', title: 'Do you want to proceed?', detail: [], choices: [{ n: 1, label: 'Yes' }], untouched: true };
    const rows = new Map<string, SessionRow>([['sess-a', row({ id: 'sess-a', status: 'needs-you' })]]);
    const runner = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args.includes('messages')) return JSON.stringify({ ok: true, entries: [], has_more_before: false, has_more_after: false, cursor: null });
      if (args.includes('--list')) return JSON.stringify({ ok: true, session_id: 'sess-a', harness: 'claude', prompt });
      if (args.includes('answer')) return JSON.stringify({ ok: true, answered: true });
      throw new Error(`unexpected ${args.join(' ')}`);
    });
    const ledger = new AnswerLedger({ now: () => 41 });
    const sent: ServerEvent[] = [];
    const viewer = new Viewer({
      runner,
      fleetBin: () => '/bin/fleet',
      lookup: (id) => rows.get(id) ?? null,
      freshList: async () => ({ kind: 'ok', rows: [] }),
      sendTo: (_c, event) => void (event.type === 'prompt' && sent.push(event)),
      ledger,
    });
    const reads = () => sent as Extract<ServerEvent, { type: 'prompt' }>[];
    viewer.watch('tab-1', 'sess-a', false);
    await vi.advanceTimersByTimeAsync(0);
    expect(reads().map((e) => e.epoch)).toEqual([41]);

    const answer = (epoch: number) => viewer.answer('sess-a', { kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch });
    expect(await answer(41)).toEqual({ epoch: 42 });
    expect(ledger.lastAnswer(rows.get('sess-a')!)).toBe(42);
    // The same prompt again, read after the answer: it reaches the tab with the answer's epoch.
    await vi.advanceTimersByTimeAsync(1000);
    expect(reads().map((e) => e.epoch)).toEqual([41, 42]);
    // A click from the read before is refused, nothing typed.
    await expect(answer(41)).rejects.toMatchObject({ status: 409, kind: 'stale' });
    expect(runner.mock.calls.filter(([, a]) => a.includes('--choice'))).toHaveLength(1);

    // Stop uses the same ledger: a second one in the same Busy spell is refused before Fleet is asked.
    rows.set('sess-a', row({ id: 'sess-a', status: 'busy' }));
    ledger.beginStop(rows.get('sess-a')!);
    await expect(viewer.stopSession('sess-a')).rejects.toMatchObject({ status: 409 });
    expect(runner.mock.calls.filter(([, a]) => a.includes('keys'))).toHaveLength(0);
    viewer.stop();
  });
});
