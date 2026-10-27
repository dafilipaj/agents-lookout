import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings } from '../shared/settings.ts';
import type { RunOptions } from './exec.ts';
import { Launcher } from './launcher.ts';
import type { FleetListResult, FleetRow } from './fleet.ts';
import { SessionMonitor } from './monitor.ts';

const ID = 't1.9f2c01aa';
const lines = ['Accessing workspace:', '/Users/me/new-repo', '', 'This folder pre-approves 10 tool permissions: Bash(…), and 2 more', 'These will apply without asking.', '', 'Security guide'];
const screen = (over: Record<string, unknown> = {}) => ({ ok: true, tmux_session: 'new-repo', handle: '%12', prompt: {
  kind: 'trust', harness: 'claude', id: ID, lines,
  choices: [{ label: 'No, exit', accept: false }, { label: 'Yes, I trust this folder', accept: true }], selected: 0, untouched: true,
}, answerable: true, detail: null, pane: { cols: 200, rows: 50 }, ...over });
const failure = (kind: string, detail: unknown = null, typed = false) => Object.assign(new Error('Fleet failed'), {
  stdout: JSON.stringify({ ok: false, kind, detail, typed, error: 'tmux SECRET screen text', pane: { cols: 80, rows: 24 } }), code: 1,
});
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
function setup() {
  let read: () => Promise<string> = async () => JSON.stringify(screen());
  let answer: () => Promise<string> = async () => JSON.stringify({ ok: true, answered: true, answer: 'accept', id: ID, closed: null });
  let spawn: () => Promise<string> = async () => JSON.stringify({ ok: true, tmux_session: 'new-repo', handle: '%12' });
  let terminal: () => Promise<string> = async () => 'last terminal lines\n';
  const log = vi.fn();
  const onChange = vi.fn();
  const runner = vi.fn(async (file: string, args: readonly string[], _opts: RunOptions) => {
    if (args.includes('harness')) return JSON.stringify(['claude', 'codex'].map((id) => ({ id, installed: true, models: [{ id: '', label: 'Default' }] })));
    if (args.includes('spawn')) return spawn();
    if (args.includes('trust')) return args.includes('--list') ? read() : answer();
    if (file === 'tmux') return terminal(); // injected runner only; no real terminal
    throw new Error('Unexpected command');
  });
  const launcher = new Launcher({ runner, fleetBin: () => '/fake/fleet', settings: { get: defaultSettings, update: async () => defaultSettings() }, onChange, log });
  const start = (harness = 'claude') => launcher.start({ harness, directory: '~/Projects/work', model: '' });
  return { launcher, runner, log, onChange, start, read: (fn: typeof read) => { read = fn; }, answer: (fn: typeof answer) => { answer = fn; }, spawn: (fn: typeof spawn) => { spawn = fn; }, terminal: (fn: typeof terminal) => { terminal = fn; } };
}
const request = (answer = 'accept', prompt = ID) => ({ answer, prompt });
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each([
  { ok: false, kind: { toString: null } },
  { ok: false, kind: ['target_changed'] },
  { ok: false, kind: 'target_changed', detail: { toString: null } },
  screen({ detail: { toString: null } }),
])('LAUNCH-6.1: malformed Fleet reason fields keep the last state and never reject a background read (%j)', async (payload) => {
  const t = setup();
  await t.start();
  const before = structuredClone(t.launcher.list());
  t.read(async () => JSON.stringify(payload));
  await expect(t.launcher.readTrusts()).resolves.toBeUndefined();
  expect(t.launcher.list()).toEqual(before);
  expect(t.log).not.toHaveBeenCalled();
});

it('LAUNCH-6.1: an unexpected background-read failure cannot reject the polling task', async () => {
  const t = setup();
  await t.start();
  t.onChange.mockImplementation(() => { throw new Error('subscriber failed'); });
  await expect(t.launcher.readTrusts()).resolves.toBeUndefined();
});

it.each(['failed', 'pending'])('LAUNCH-6.1: a start shows its Trust prompt within 3 s while Fleet list polls are %s', async (poll) => {
  const t = setup();
  t.read(async () => JSON.stringify(screen({ prompt: null, answerable: false, detail: 'no_prompt' })));
  const pending = deferred<FleetListResult>();
  const fetchList = vi.fn(async (): Promise<FleetListResult> => poll === 'pending' ? pending.promise : { kind: 'error', message: 'Fleet list failed' });
  // The real startup paths: Launcher follows spawn; SessionMonitor follows Fleet's list.
  // Trust polling must continue even when the monitor never gets a successful list.
  const monitor = new SessionMonitor({ fetchList, git: { get: () => null, prune: () => {} }, onList: (rows) => t.launcher.observe(rows), onEvent: vi.fn() });
  const unwatch = monitor.watch();
  try {
    expect((await t.start()).state).toBe('starting');
    await vi.advanceTimersByTimeAsync(500);
    t.read(async () => JSON.stringify(screen())); // Claude Code draws the prompt after spawn's read.
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.launcher.list()[0]).toMatchObject({ state: 'trust', trust: { id: ID } });
    expect(t.runner.mock.calls.filter((c) => c[1].includes('--list'))).toHaveLength(2);
    expect(fetchList).toHaveBeenCalledTimes(poll === 'pending' ? 1 : 2);
    expect(monitor.snapshot().fleet.state).toBe(poll === 'pending' ? 'starting' : 'failing');
  } finally {
    unwatch(); monitor.stop(); t.launcher.stop();
    pending.resolve({ kind: 'ok', rows: [] });
  }
});

it('LAUNCH-6.1: reads once after spawn, and on monitor ticks, only for pending Claude Code hosts and one read at a time', async () => {
  const t = setup();
  const l = await t.start();
  expect(l).toMatchObject({ state: 'trust', trust: { id: ID, lines, answerable: true } });
  expect(t.runner).toHaveBeenCalledWith('/fake/fleet', ['--local', 'trust', 'new-repo', '--pane', '%12', '--json', '--list'], expect.objectContaining({ timeoutMs: 5000 }));
  const pending = deferred<string>();
  t.read(() => pending.promise);
  const a = t.launcher.readTrusts();
  const b = t.launcher.readTrusts();
  expect(t.runner.mock.calls.filter((c) => c[1].includes('trust'))).toHaveLength(2);
  pending.resolve(JSON.stringify(screen()));
  await Promise.all([a, b]);
  const codex = setup();
  await codex.start('codex');
  await codex.launcher.readTrusts();
  expect(codex.runner.mock.calls.some((c) => c[1].includes('trust'))).toBe(false);
  t.launcher.stop();
  await t.launcher.readTrusts();
  expect(t.runner.mock.calls.filter((c) => c[1].includes('trust'))).toHaveLength(2);
});

it('LAUNCH-6.2: holds indefinitely at a prompt, resets the 15 s after it leaves, and reads once more at the deadline', async () => {
  const t = setup();
  await t.start();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(t.launcher.list()[0]!.state).toBe('trust');
  t.read(async () => JSON.stringify(screen({ prompt: null, answerable: false, detail: 'no_prompt' })));
  await t.launcher.readTrusts();
  await vi.advanceTimersByTimeAsync(14_999);
  expect(t.launcher.list()[0]!.state).toBe('starting');
  t.read(async () => JSON.stringify(screen()));
  await vi.advanceTimersByTimeAsync(1);
  expect(t.launcher.list()[0]!.state).toBe('trust');
  t.read(async () => JSON.stringify(screen({ prompt: null, answerable: false, detail: 'shell' })));
  await t.launcher.readTrusts();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(t.launcher.list()[0]).toMatchObject({ state: 'failed', terminal: ['last terminal lines'] });
});

it('LAUNCH-6.2: the deadline waits out an older read, then captures a fresh screen before failing', async () => {
  const t = setup();
  t.read(async () => JSON.stringify(screen({ prompt: null, answerable: false, detail: 'no_prompt' })));
  await t.start();
  await vi.advanceTimersByTimeAsync(14_000);
  const old = deferred<string>();
  t.read(() => old.promise);
  const reading = t.launcher.readTrusts();
  await vi.advanceTimersByTimeAsync(1000);
  t.read(async () => JSON.stringify(screen())); // the prompt was drawn after the old capture
  old.resolve(JSON.stringify(screen({ prompt: null, answerable: false, detail: 'no_prompt' })));
  await reading;
  await vi.advanceTimersByTimeAsync(0);
  expect(t.launcher.list()[0]!.state).toBe('trust');
});

it('LAUNCH-6.4: accept uses the clicked id and pinned pane, then starts a fresh 15 s and yields the row to Fleet', async () => {
  const t = setup();
  const l = await t.start();
  const pending = deferred<string>();
  t.answer(() => pending.promise);
  const answering = t.launcher.answerTrust(l.id, request());
  expect(t.launcher.list()[0]!.trust!.answering).toBe('accept');
  expect(t.runner).toHaveBeenLastCalledWith('/fake/fleet', ['--local', 'trust', 'new-repo', '--pane', '%12', '--json', '--accept', '--prompt', ID, '--allow-attached'], expect.objectContaining({ timeoutMs: 15_000 }));
  await vi.advanceTimersByTimeAsync(20_000);
  pending.resolve(JSON.stringify({ ok: true, answered: true, id: ID, answer: 'accept', closed: null }));
  await answering;
  expect(t.launcher.list()[0]).toMatchObject({ state: 'starting', trust: null });
  // The answer cleared the prompt from the screen; the launcher's own 2 s reads now see none.
  t.read(async () => JSON.stringify(screen({ prompt: null, answerable: false, detail: 'no_prompt' })));
  await vi.advanceTimersByTimeAsync(14_999);
  expect(t.launcher.list()[0]!.state).toBe('starting');
  t.launcher.observe([{ harness: 'claude', tmux_session: 'new-repo', session_id: 'session', pid: 1 } as FleetRow]);
  expect(t.launcher.recentStarts()).toEqual([{ launchId: l.id, sessionId: 'session' }]);
});

it('LAUNCH-6.5: Cancel declines with --close and removes the row only when Fleet confirms closed', async () => {
  for (const close_detail of [null, 'still_running', 'pane_changed']) {
    const t = setup();
    const l = await t.start();
    t.answer(async () => JSON.stringify({ ok: true, answered: true, answer: 'decline', id: ID, closed: close_detail === null, close_detail }));
    const result = await t.launcher.answerTrust(l.id, request('decline'));
    expect(t.runner.mock.calls.find((c) => c[1].includes('--decline'))![1]).toContain('--close');
    if (close_detail === null) {
      expect(result).toBeNull();
      expect(t.launcher.list()).toEqual([]);
    } else {
      expect(result).toMatchObject({ state: 'failed', terminal: ['last terminal lines'], error: expect.stringContaining(close_detail === 'still_running' ? "didn't exit" : "couldn't be closed") });
    }
  }
});

it.each([
  ['prompt_not_on_screen', 'different_prompt', 'changed before'], ['prompt_not_on_screen', 'no_prompt', 'gone'],
  ['prompt_not_on_screen', 'shell', 'gone'], ['target_changed', null, 'gone'],
  ['prompt_not_on_screen', 'touched', 'changed in a terminal'], ['prompt_not_on_screen', 'not_alone', 'Something else'],
  ['prompt_incomplete', 'clipped', '80×24'], ['prompt_incomplete', 'layout_unsupported', "this version"], ['busy', null, 'being typed'],
])('LAUNCH-6.6: a no-keys refusal %s/%s gives plain words and recovers on the next answerable read', async (kind, detail, words) => {
  const t = setup();
  const l = await t.start();
  t.answer(async () => { throw failure(kind!, detail); });
  await expect(t.launcher.answerTrust(l.id, request())).rejects.toMatchObject({ status: 409 });
  expect(t.launcher.list()[0]!.trust!.message).toContain(words);
  expect(t.launcher.list()[0]!.trust!.message).not.toMatch(/tmux|SECRET/);
  await t.launcher.readTrusts();
  expect(t.launcher.list()[0]!.trust).toMatchObject({ message: null, answerable: true });
});

it.each([
  failure('prompt_changed', 'touched', true), failure('outcome_uncertain', null, false),
  Object.assign(new Error('timeout'), { timedOut: true }), new Error('connection failed'),
])('LAUNCH-6.6: possible typing never retries or enables the same id again, even after a different prompt', async (error) => {
  const t = setup();
  const l = await t.start();
  t.answer(async () => { throw error; });
  await expect(t.launcher.answerTrust(l.id, request())).rejects.toMatchObject({ kind: 'uncertain' });
  expect(t.launcher.list()[0]).toMatchObject({ terminal: ['last terminal lines'], trust: { answerable: false, message: "It may have been answered, but Lookout can't tell." } });
  for (const id of [ID, 't1.11111111', ID]) {
    t.read(async () => JSON.stringify(screen({ prompt: { ...screen().prompt, id } })));
    await t.launcher.readTrusts();
    expect(t.launcher.list()[0]!.trust!.answerable).toBe(id !== ID);
  }
  await expect(t.launcher.answerTrust(l.id, request())).rejects.toMatchObject({ status: 409 });
  expect(t.runner.mock.calls.filter((c) => c[1].includes('--accept'))).toHaveLength(1);
});

it('LAUNCH-6.7: incomplete and unanswerable prompts hold the timeout, can be dismissed, and recover when answerable', async () => {
  const t = setup();
  t.read(async () => JSON.stringify(screen({ prompt: { kind: 'trust', harness: 'claude', incomplete: true, id: null, lines: null, choices: null, selected: null, untouched: false }, answerable: false, detail: 'clipped' })));
  const l = await t.start();
  expect(l).toMatchObject({ state: 'trust', trust: { id: null, lines: null, answerable: false, message: expect.stringContaining("doesn't fit") } });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(t.launcher.list()[0]!.state).toBe('trust');
  t.read(async () => JSON.stringify(screen()));
  await t.launcher.readTrusts();
  expect(t.launcher.list()[0]!.trust!.answerable).toBe(true);
  t.read(async () => JSON.stringify(screen({ answerable: false, detail: 'touched' })));
  await t.launcher.readTrusts();
  expect(t.launcher.dismiss(l.id)).toBe(true);
  await t.launcher.readTrusts();
  expect(t.launcher.list()).toEqual([]);
});

it('LAUNCH-6.7: Dismiss from an unanswerable card still works if the next read recovered before the click arrived', async () => {
  const t = setup();
  t.read(async () => JSON.stringify(screen({ answerable: false, detail: 'touched' })));
  const l = await t.start();
  t.read(async () => JSON.stringify(screen()));
  await t.launcher.readTrusts();
  expect(t.launcher.dismiss(l.id)).toBe(true);
  expect(t.runner.mock.calls.some((c) => c[1].includes('--accept') || c[1].includes('--decline'))).toBe(false);
});

it('LAUNCH-6.8: a new id replaces the text; stale clicks are refused before Fleet; departure restores waiting', async () => {
  const t = setup();
  const l = await t.start();
  t.read(async () => JSON.stringify(screen({ prompt: { ...screen().prompt, id: 't1.11111111', lines: ['other folder'] } })));
  await t.launcher.readTrusts();
  expect(t.launcher.list()[0]!.trust).toMatchObject({ id: 't1.11111111', lines: ['other folder'] });
  await expect(t.launcher.answerTrust(l.id, request())).rejects.toMatchObject({ status: 409 });
  expect(t.runner.mock.calls.some((c) => c[1].includes('--accept'))).toBe(false);
  t.read(async () => JSON.stringify(screen({ prompt: null, answerable: false, detail: 'shell' })));
  await t.launcher.readTrusts();
  expect(t.launcher.list()[0]).toMatchObject({ state: 'starting', trust: null });
});

it('LAUNCH-6.8: late terminal lines from an uncertain answer never appear beside a different prompt', async () => {
  const t = setup();
  const l = await t.start();
  t.answer(async () => { throw failure('outcome_uncertain', null, true); });
  const terminal = deferred<string>();
  t.terminal(() => terminal.promise);
  const answering = t.launcher.answerTrust(l.id, request());
  const refused = expect(answering).rejects.toMatchObject({ kind: 'uncertain' });
  await vi.advanceTimersByTimeAsync(0);
  t.read(async () => JSON.stringify(screen({ prompt: { ...screen().prompt, id: 't1.11111111' } })));
  await t.launcher.readTrusts();
  terminal.resolve('old screen\n');
  await refused;
  expect(t.launcher.list()[0]).toMatchObject({ terminal: null, trust: { id: 't1.11111111', answerable: true } });
});

it('LAUNCH-6.10: no automatic answers, validates clicks, and serializes every tab for a launch', async () => {
  const t = setup();
  const l = await t.start();
  await t.launcher.readTrusts();
  expect(t.runner.mock.calls.some((c) => c[1].includes('--accept') || c[1].includes('--decline'))).toBe(false);
  for (const bad of [null, {}, { answer: 'yes', prompt: ID }, request('accept', '../bad')]) await expect(t.launcher.answerTrust(l.id, bad)).rejects.toMatchObject({ status: 400 });
  const pending = deferred<string>();
  t.answer(() => pending.promise);
  const first = t.launcher.answerTrust(l.id, request());
  await expect(t.launcher.answerTrust(l.id, request('decline'))).rejects.toMatchObject({ status: 409, message: 'Another tab is answering…' });
  await t.launcher.readTrusts();
  expect(t.launcher.list()[0]!.trust!.answering).toBe('accept');
  pending.resolve(JSON.stringify({ ok: true, answered: true, answer: 'accept', id: ID, closed: null }));
  await first;
});

it('LAUNCH-6.6: losing the HTTP connection holds that id uncertain even if Fleet later refuses before typing', async () => {
  const t = setup();
  const l = await t.start();
  const pending = deferred<string>();
  t.answer(() => pending.promise);
  const result = t.launcher.answerTrust(l.id, request());
  t.launcher.trustDisconnected(l.id, ID);
  pending.resolve(JSON.stringify({ ok: false, kind: 'busy', detail: null, typed: false }));
  await expect(result).rejects.toMatchObject({ kind: 'uncertain' });
  await t.launcher.readTrusts();
  expect(t.launcher.list()[0]).toMatchObject({ trust: { answerable: false, message: "It may have been answered, but Lookout can't tell." }, terminal: ['last terminal lines'] });
});

it('LAUNCH-6.1: a read completing after reporting or dismissal never resurrects its row', async () => {
  for (const remove of ['observe', 'dismiss']) {
    const t = setup();
    const l = await t.start();
    t.read(async () => JSON.stringify(screen({ answerable: false, detail: 'touched' })));
    await t.launcher.readTrusts();
    const pending = deferred<string>();
    t.read(() => pending.promise);
    const reading = t.launcher.readTrusts();
    if (remove === 'dismiss') expect(t.launcher.dismiss(l.id)).toBe(true);
    else t.launcher.observe([{ harness: 'claude', tmux_session: 'new-repo', session_id: 'session', pid: 1 } as FleetRow]);
    pending.resolve(JSON.stringify(screen()));
    await reading;
    expect(t.launcher.list()).toEqual([]);
  }
});

it('LAUNCH-6.11: resumes and externally starting resumes show the same card; Cancel allows another resume', async () => {
  const req = { sessionId: 'past', harness: 'claude' as const, directory: '/work', title: 'past' };
  for (const elsewhere of [false, true]) {
    const t = setup();
    if (elsewhere) t.spawn(async () => { throw Object.assign(failure('session_starting'), { stdout: JSON.stringify({ ok: false, kind: 'session_starting', starting: { tmux_session: 'new-repo', handle: '%12' } }) }); });
    const l = await t.launcher.resume(req);
    expect(l).toMatchObject({ state: 'trust', trust: { id: ID } });
    t.answer(async () => JSON.stringify({ ok: true, answered: true, answer: 'decline', id: ID, closed: true }));
    await t.launcher.answerTrust(l.id, request('decline'));
    expect(t.launcher.pendingResume('past', 'claude')).toBeNull();
    expect((await t.launcher.resume(req)).state).toBe('trust');
  }
});

it('LAUNCH-6.11: an externally starting resume whose host arrives after the deadline still attaches its failure’s terminal lines', async () => {
  const t = setup();
  const spawn = deferred<string>();
  t.spawn(async () => {
    await spawn.promise;
    throw Object.assign(failure('session_starting'), { stdout: JSON.stringify({ ok: false, kind: 'session_starting', starting: { tmux_session: 'new-repo', handle: '%12' } }) });
  });
  const starting = t.launcher.resume({ sessionId: 'past', harness: 'claude', directory: '/work', title: 'past' });
  await vi.advanceTimersByTimeAsync(15_000);
  expect(t.launcher.list()[0]!.state).toBe('failed');
  spawn.resolve('');
  await starting;
  await vi.advanceTimersByTimeAsync(0);
  expect(t.launcher.list()[0]!.terminal).toEqual(['last terminal lines']);
});

it('LAUNCH-6.12: logs content-free refusal codes, and logs unanswerable reads only when their reason changes', async () => {
  const t = setup();
  const l = await t.start();
  t.read(async () => JSON.stringify(screen({ answerable: false, detail: 'touched', error: 'SECRET' })));
  await t.launcher.readTrusts();
  await t.launcher.readTrusts();
  expect(t.log).toHaveBeenCalledTimes(1);
  expect(t.log).toHaveBeenLastCalledWith(`lookout: trust refused: launch=${l.id} answer=read kind=none detail=touched typed=false`);
  t.read(async () => JSON.stringify(screen()));
  await t.launcher.readTrusts();
  t.answer(async () => { throw failure('prompt_not_on_screen', 'SECRET\nunsafe'); });
  await expect(t.launcher.answerTrust(l.id, request())).rejects.toThrow();
  expect(t.log).toHaveBeenLastCalledWith(`lookout: trust refused: launch=${l.id} answer=accept kind=prompt_not_on_screen detail=other typed=false`);
  expect(JSON.stringify(t.log.mock.calls)).not.toMatch(/SECRET|tmux|screen text/);
});

it('LAUNCH-6.1: old Fleet is logged once and disables further reads; unusable reads preserve the card, target loss clears it', async () => {
  const t = setup();
  await t.start();
  for (const out of ['bad JSON', JSON.stringify({ ok: true }), JSON.stringify(screen({ prompt: { ...screen().prompt, lines: ['x'.repeat(2001)] } }))]) {
    t.read(async () => out);
    await t.launcher.readTrusts();
    expect(t.launcher.list()[0]!.state).toBe('trust');
  }
  t.read(async () => { throw failure('backend_failed'); });
  await t.launcher.readTrusts();
  expect(t.launcher.list()[0]!.state).toBe('trust');
  t.read(async () => { throw failure('target_changed'); });
  await t.launcher.readTrusts();
  expect(t.launcher.list()[0]!.state).toBe('starting');
  t.read(async () => { throw Object.assign(new Error('old'), { code: 2, stderr: "error: unrecognized subcommand 'trust'" }); });
  await t.launcher.readTrusts();
  const count = t.runner.mock.calls.length;
  await t.launcher.readTrusts();
  expect(t.runner).toHaveBeenCalledTimes(count);
  expect(t.log).toHaveBeenCalledTimes(1);
});
