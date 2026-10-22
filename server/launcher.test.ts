import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Settings, defaultSettings } from '../shared/settings.ts';
import type { LaunchView } from '../shared/types.ts';
import type { RunOptions } from './exec.ts';
import type { FleetRow } from './fleet.ts';
import { DirMissingError, HARNESS_CACHE_MS, LaunchError, Launcher, MAX_TMUX_NAME, SessionLiveError, cleanEnv, parseSpawnAnswer } from './launcher.ts';

const HARNESS_JSON = JSON.stringify([
  { id: 'claude', label: 'Claude Code', command: 'claude', installed: true, models: [{ id: '', label: 'Default' }, { id: 'claude-opus-5-5', label: 'Opus 5.5' }] },
  { id: 'codex', label: 'Codex', command: 'codex', installed: false, models: [{ id: '', label: 'Default (gpt-6-astra)' }] },
  { id: 'pi', label: 'pi', command: 'pi', installed: true, models: [] },
]);

type Call = { file: string; args: readonly string[]; opts: RunOptions };

/** `fleet spawn --json`'s success object (Fleet docs/cli.md, "Spawning"). */
const spawned = (tmux: string, over: Record<string, unknown> = {}) =>
  `${JSON.stringify({ ok: true, dry_run: false, host: 'mac', backend: 'tmux', tmux_session: tmux, tmux_window: `${tmux}:0`, handle: '%12', created_session: true, dir: '/Users/me/Projects/work', harness: 'claude', model: null, name: null, command: 'claude', prompt_file: null, from: null, ...over })}\n`;
/** A failed `fleet spawn --json`: exit 1, the object on stdout, the message on stderr. */
const spawnFailed = (kind: string, error: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('exit 1'), { code: 1, stdout: JSON.stringify({ ok: false, host: 'mac', kind, error, partial: null, ...extra }), stderr: `error: ${error}\n` });

function setup(over: { spawn?: (call: Call) => Promise<string>; env?: NodeJS.ProcessEnv; settings?: Partial<Settings> } = {}) {
  const calls: Call[] = [];
  let settings: Settings = { ...defaultSettings(), ...over.settings };
  const changes: { launches: LaunchView[]; started: { launchId: string; sessionId: string }[] }[] = [];
  let now = 1_000_000;
  const runner = vi.fn(async (file: string, args: readonly string[], opts: RunOptions) => {
    const call = { file, args, opts };
    calls.push(call);
    if (args.includes('harness')) return HARNESS_JSON;
    if (args.includes('spawn')) return over.spawn ? over.spawn(call) : spawned('fix-rates');
    if (file === 'tmux') return 'Welcome\n\n Quick safety check: Is this a project you trust?\n ❯ No, exit\n   Yes, I trust this folder\n\n\n';
    throw new Error(`unexpected ${file} ${args.join(' ')}`);
  });
  const update = vi.fn(async (patch: Partial<Settings>) => (settings = { ...settings, ...patch }));
  const launcher = new Launcher({
    runner,
    fleetBin: () => '/bin/fleet',
    settings: { get: () => settings, update },
    onChange: (launches, started) => changes.push({ launches, started }),
    env: over.env ?? { PATH: '/usr/bin', HOME: '/Users/me' },
    now: () => now,
    timeoutMs: 15_000,
  });
  return { launcher, calls, changes, update, runner, advance: (ms: number) => (now += ms) };
}

const req = (over: Record<string, unknown> = {}) => ({
  directory: '~/Projects/work',
  harness: 'claude',
  model: '',
  name: '',
  prompt: '',
  ...over,
});

const spawnCall = (calls: Call[]) => calls.find((c) => c.args.includes('spawn'))!;

const row = (over: Partial<FleetRow>): FleetRow => ({
  pid: 7,
  session_id: 'sess-1',
  cwd: '/Users/me/Projects/work',
  status: 'idle',
  waiting_for: null,
  updated_at: 1,
  backend: 'tmux',
  display_title: 'fix-rates',
  context: null,
  harness: 'claude',
  model: null,
  tmux_session: 'fix-rates',
  ...over,
});

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());

describe('starting Sessions', () => {
  it('LAUNCH-4.1: starts through `fleet spawn` in its own tmux Session host, with argv only', async () => {
    const t = setup();
    await t.launcher.start(req({ model: 'claude-opus-5-5', name: 'fix rates', prompt: 'Say OK; rm -rf ~ $(whoami)' }));
    const call = spawnCall(t.calls);
    expect(call.file).toBe('/bin/fleet');
    expect(call.args).toEqual([
      '--local',
      'spawn',
      '--json',
      '--backend',
      'tmux',
      '--harness',
      'claude',
      '--dir',
      join(homedir(), 'Projects/work'),
      '--model',
      'claude-opus-5-5',
      '--name',
      'fix rates',
      '--',
      'Say OK; rm -rf ~ $(whoami)',
    ]);
  });

  it('LAUNCH-4.1: the start is done once Fleet reports a Session in its tmux session (backend tmux)', async () => {
    const t = setup();
    const launch = await t.launcher.start(req());
    expect(t.launcher.list()).toEqual([expect.objectContaining({ id: launch.id, state: 'starting' })]);
    t.launcher.observe([row({ tmux_session: 'other' })]);
    expect(t.launcher.list()).toHaveLength(1);
    t.launcher.observe([row({})]);
    expect(t.launcher.list()).toEqual([]);
    expect(t.changes.at(-1)).toEqual({ launches: [], started: [{ launchId: launch.id, sessionId: 'sess-1' }] });
  });

  it('LAUNCH-4.1: reads the Session host from `fleet spawn --json`', () => {
    expect(parseSpawnAnswer(spawned('work-2'))).toEqual({ ok: true, tmuxSession: 'work-2' });
    expect(parseSpawnAnswer(spawned('x', { tmux_session: null, backend: 'iterm' }))).toEqual({ ok: true, tmuxSession: null });
    expect(parseSpawnAnswer(spawned('bad name; rm'))).toEqual({ ok: true, tmuxSession: null });
    expect(parseSpawnAnswer('spawned tmux session work-2  (attach: tmux attach -t work-2)')).toBeNull();
    expect(parseSpawnAnswer('{"ok":false,"kind":"dir_missing","error":"nope"}')).toEqual({ ok: false, kind: 'dir_missing', error: 'nope' });
  });

  it('LAUNCH-4.1: a Session host named after a long directory (201 characters, or 255 and a suffix) is still recognized', async () => {
    const long = `${'a'.repeat(200)}b`;
    const longest = `${'c'.repeat(255)}-2`;
    expect(parseSpawnAnswer(spawned(long))).toEqual({ ok: true, tmuxSession: long });
    expect(parseSpawnAnswer(spawned(longest))).toEqual({ ok: true, tmuxSession: longest });
    expect(parseSpawnAnswer(spawned('x'.repeat(MAX_TMUX_NAME + 1)))).toEqual({ ok: true, tmuxSession: null });
    const t = setup({ spawn: async () => spawned(long) });
    const launch = await t.launcher.start(req());
    t.launcher.observe([row({ session_id: 'sess-9', tmux_session: long })]);
    expect(t.launcher.list()).toEqual([]);
    expect(t.changes.at(-1)!.started).toEqual([{ launchId: launch.id, sessionId: 'sess-9' }]);
  });

  it('LAUNCH-3.3: name and prompt are optional, and a multi-line prompt is one argument with its line breaks', async () => {
    const t = setup();
    await t.launcher.start(req());
    expect(spawnCall(t.calls).args).not.toContain('--name');
    expect(spawnCall(t.calls).args).not.toContain('--');

    const t2 = setup();
    await t2.launcher.start(req({ prompt: 'Line one: say OK.\r\nLine two: say DONE.' }));
    expect(spawnCall(t2.calls).args.at(-1)).toBe('Line one: say OK.\nLine two: say DONE.');
    expect(spawnCall(t2.calls).args.at(-2)).toBe('--');
  });

  it('LAUNCH-2.1: only a start directory from Settings is accepted', async () => {
    const t = setup();
    await expect(t.launcher.start(req({ directory: '/etc' }))).rejects.toMatchObject({ status: 400, field: 'directory' });
    expect(spawnCall(t.calls)).toBeUndefined();
  });

  it('LAUNCH-3.1: only Claude Code and Codex are offered, and one that is not installed cannot start', async () => {
    const t = setup();
    expect((await t.launcher.harnesses()).map((h) => [h.id, h.installed])).toEqual([
      ['claude', true],
      ['codex', false],
    ]);
    await expect(t.launcher.start(req({ harness: 'codex' }))).rejects.toMatchObject({ status: 400, field: 'harness' });
    await expect(t.launcher.start(req({ harness: 'pi' }))).rejects.toMatchObject({ status: 400, field: 'harness' });
  });

  it('LAUNCH-3.2: models come from Fleet; the default is the Harness’s own; others are refused', async () => {
    const t = setup();
    const claude = (await t.launcher.harnesses())[0]!;
    expect(claude.models[0]).toEqual({ id: '', label: 'Default' });
    await t.launcher.start(req({ model: '' }));
    expect(spawnCall(t.calls).args).not.toContain('--model');
    await expect(t.launcher.start(req({ model: 'gpt-9' }))).rejects.toMatchObject({ field: 'model' });
    await expect(t.launcher.start(req({ model: "x'; rm" }))).rejects.toMatchObject({ field: 'model' });
  });

  it('caches harnesses for 10 minutes', async () => {
    let now = 0;
    const runner = vi.fn(async () => HARNESS_JSON);
    const launcher = new Launcher({
      runner,
      fleetBin: () => 'fleet',
      settings: { get: defaultSettings, update: async () => defaultSettings() },
      onChange: () => {},
      now: () => now,
    });
    await launcher.harnesses();
    now = HARNESS_CACHE_MS - 1;
    await launcher.harnesses();
    expect(runner).toHaveBeenCalledTimes(1);
    now = HARNESS_CACHE_MS;
    await launcher.harnesses();
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('VIEW-6.4: a model switch drops the cached list, and a read in flight then isn’t cached, so the next read gets the new "Default (…)"', async () => {
    let answer = HARNESS_JSON;
    let release: (() => void) | null = null;
    const runner = vi.fn(async () => {
      const text = answer;
      if (release === null) await new Promise<void>((r) => (release = r));
      return text;
    });
    const launcher = new Launcher({ runner, fleetBin: () => 'fleet', settings: { get: defaultSettings, update: async () => defaultSettings() }, onChange: () => {} });
    // A read starts, then the switch drops the cache before it answers: that answer isn't kept.
    const before = launcher.harnesses();
    launcher.dropHarnesses();
    release!();
    await before;
    answer = HARNESS_JSON.replace('"Default"', '"Default (claude-sonnet-5-5)"');
    expect((await launcher.harnesses())[0]!.models[0]!.label).toBe('Default (claude-sonnet-5-5)');
    expect(runner).toHaveBeenCalledTimes(2);
    // Cached again until the next drop.
    await launcher.harnesses();
    expect(runner).toHaveBeenCalledTimes(2);
    launcher.dropHarnesses();
    await launcher.harnesses();
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it('LAUNCH-1.2: a start remembers its Harness, model and directory', async () => {
    const t = setup();
    await t.launcher.start(req({ model: 'claude-opus-5-5' }));
    expect(t.update).toHaveBeenCalledWith({ lastLaunch: { harness: 'claude', model: 'claude-opus-5-5', directory: '~/Projects/work' } }, 'server');
  });

  it('LAUNCH-4.4: when `fleet spawn` fails, the start fails with the reason, and its row goes away', async () => {
    const t = setup({
      spawn: async () => {
        throw spawnFailed('name_taken', 'tmux session `fix-rates` already exists — pick another --name');
      },
    });
    const err = await t.launcher.start(req({ name: 'fix-rates' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LaunchError);
    expect(err).toMatchObject({ status: 409, field: 'name', message: 'A Session host named fix-rates already exists. Pick another name.' });
    expect(t.launcher.list()).toEqual([]);
    // It showed a "Starting…" row at once, then removed it.
    expect(t.changes.map((c) => c.launches.length)).toEqual([1, 0]);
  });

  it('LAUNCH-4.4: any other `fleet spawn` failure comes through with Fleet’s reason', async () => {
    const t = setup({
      spawn: async () => {
        throw spawnFailed('dir_missing', 'dir does not exist: /x');
      },
    });
    await expect(t.launcher.start(req())).rejects.toMatchObject({ status: 502, message: "Couldn't start the Session: dir does not exist: /x" });
  });

  it('LAUNCH-4.5: not reported after 15 s, the start turns into an error with its terminal’s last lines; the host is left running', async () => {
    const t = setup();
    const launch = await t.launcher.start(req());
    await vi.advanceTimersByTimeAsync(14_999);
    expect(t.launcher.list()[0]!.state).toBe('starting');
    await vi.advanceTimersByTimeAsync(1);
    const failed = t.launcher.list()[0]!;
    expect(failed).toMatchObject({ id: launch.id, state: 'failed', error: expect.stringContaining('Session host is still running') });
    expect(failed.error).not.toMatch(/tmux/); // decision 0001
    expect(failed.terminal).toEqual(['Welcome', ' Quick safety check: Is this a project you trust?', ' ❯ No, exit', '   Yes, I trust this folder']);
    const capture = t.calls.find((c) => c.file === 'tmux')!;
    expect(capture.args).toEqual(['capture-pane', '-p', '-t', '=fix-rates:']);
    expect(t.calls.some((c) => c.args.includes('kill-session'))).toBe(false);

    // If it shows up after all, it still becomes the Session.
    t.launcher.observe([row({})]);
    expect(t.launcher.list()).toEqual([]);
    expect(t.changes.at(-1)!.started).toEqual([{ launchId: launch.id, sessionId: 'sess-1' }]);
  });

  it('LAUNCH-4.2: a completed start stays known for 60 s, so a tab that reconnects can still select its Session', async () => {
    const t = setup();
    const launch = await t.launcher.start(req());
    t.launcher.observe([row({})]);
    expect(t.launcher.recentStarts()).toEqual([{ launchId: launch.id, sessionId: 'sess-1' }]);
    t.advance(59_000);
    expect(t.launcher.recentStarts()).toHaveLength(1);
    t.advance(2_000);
    expect(t.launcher.recentStarts()).toEqual([]);
  });

  it('LAUNCH-4.2: a start whose Session gets its session id later (Codex) is replayed under the new id, so reloading `/l/<id>` lands on the live Session', async () => {
    const t = setup({ spawn: async () => spawned('kg-hook') });
    const launch = await t.launcher.start(req());
    // Codex has no session id before its first prompt; harness-agnostic here (codex isn't installed in this fake).
    t.launcher.observe([row({ pid: 4242, session_id: null, tmux_session: 'kg-hook' })]);
    expect(t.launcher.recentStarts()).toEqual([{ launchId: launch.id, sessionId: 'claude:4242' }]);
    t.launcher.observe([row({ pid: 4242, session_id: '12345678-aaaa-7000-8000-00000000c0de', tmux_session: 'kg-hook' })]);
    expect(t.launcher.recentStarts()).toEqual([{ launchId: launch.id, sessionId: '12345678-aaaa-7000-8000-00000000c0de' }]);
  });

  it('LAUNCH-4.2: the tab picks the launch id, so it can select the row before the start answers; a bad or taken one is refused', async () => {
    const t = setup();
    const id = '0f0e0d0c-0b0a-4000-8000-000000000001';
    const launch = await t.launcher.start(req({ launchId: id }));
    expect(launch.id).toBe(id);
    expect(t.changes[0]!.launches).toEqual([expect.objectContaining({ id, state: 'starting' })]);
    await expect(t.launcher.start(req({ launchId: id }))).rejects.toMatchObject({ status: 409 });
    t.launcher.observe([row({})]);
    // Still taken while its start is remembered (60 s).
    await expect(t.launcher.start(req({ launchId: id }))).rejects.toMatchObject({ status: 409 });
    await expect(t.launcher.start(req({ launchId: '../x' }))).rejects.toMatchObject({ status: 400, message: 'Invalid launch id.' });
    // An older tab sends none: the server makes one up.
    expect((await t.launcher.start(req())).id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('LAUNCH-4.5: the 15 s count from when "Starting…" appeared, even while `fleet spawn` is still running', async () => {
    let finishSpawn: (out: string) => void = () => {};
    const t = setup({ spawn: () => new Promise((resolve) => (finishSpawn = resolve)) });
    const started = t.launcher.start(req());
    await vi.advanceTimersByTimeAsync(15_000);
    // Failed at 15 s after the row appeared, though spawn hasn't returned yet.
    expect(t.launcher.list()[0]).toMatchObject({ state: 'failed', terminal: null });
    // When spawn returns, the terminal's last lines are attached.
    finishSpawn(spawned('slow-one'));
    await started;
    await vi.advanceTimersByTimeAsync(0);
    expect(t.launcher.list()[0]!.terminal).toEqual(['Welcome', ' Quick safety check: Is this a project you trust?', ' ❯ No, exit', '   Yes, I trust this folder']);
    expect(t.calls.find((c) => c.file === 'tmux')!.args).toEqual(['capture-pane', '-p', '-t', '=slow-one:']);
  });

  it('LAUNCH-4.3: the prompt arrives exactly as typed: indentation and trailing newline kept, only \\r\\n normalized', async () => {
    const t = setup();
    await t.launcher.start(req({ prompt: '  indented\r\n\tTabbed\r\n\nlast line\n' }));
    expect(spawnCall(t.calls).args.at(-1)).toBe('  indented\n\tTabbed\n\nlast line\n');

    const t2 = setup();
    await t2.launcher.start(req({ prompt: ' \n\t \n' })); // only whitespace: no prompt
    expect(spawnCall(t2.calls).args).not.toContain('--');
  });

  it('dismisses a failed start without touching its Session host', async () => {
    const t = setup();
    const launch = await t.launcher.start(req());
    expect(t.launcher.dismiss(launch.id)).toBe(false); // still starting
    await vi.advanceTimersByTimeAsync(15_000);
    expect(t.launcher.dismiss(launch.id)).toBe(true);
    expect(t.launcher.list()).toEqual([]);
  });

  it('rejects names Fleet cannot use and over-long input', async () => {
    const t = setup();
    await expect(t.launcher.start(req({ name: '!!!' }))).rejects.toMatchObject({ field: 'name' });
    await expect(t.launcher.start(req({ name: 'a\nb' }))).rejects.toMatchObject({ field: 'name' });
    await expect(t.launcher.start(req({ prompt: 'x'.repeat(100_001) }))).rejects.toMatchObject({ field: 'prompt' });
  });
});

describe('telemetry (decision 0002)', () => {
  const inherited = {
    PATH: '/usr/bin',
    HOME: '/Users/me',
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    CLAUDE_CODE_SESSION_ID: 'parent',
    CLAUDE_PID: '123',
    CLAUDE_EFFORT: 'high',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'https://alloy.example',
    CLAUDE_OTEL_ENABLE: '1',
  };

  it('LAUNCH-5.2: Lookout passes no OTEL_* or CLAUDE_CODE_* variables to what it starts, inherited or its own', async () => {
    const t = setup({ env: inherited });
    await t.launcher.start(req());
    for (const call of [spawnCall(t.calls), t.calls.find((c) => c.args.includes('harness'))!]) {
      const env = call.opts.env!;
      expect(Object.keys(env).filter((k) => k.startsWith('OTEL_') || k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE')).toEqual([]);
      // Nothing added: every variable it passes was already in Lookout's environment.
      for (const [k, v] of Object.entries(env)) expect(inherited[k as keyof typeof inherited]).toBe(v);
    }
  });

  it('LAUNCH-5.2: keeps the rest, including the login profile’s own opt-in switch', () => {
    expect(cleanEnv(inherited)).toEqual({ PATH: '/usr/bin', HOME: '/Users/me', CLAUDE_OTEL_ENABLE: '1' });
  });
});

describe('resuming past Sessions (HIST-3), through the same path as a start', () => {
  const resumeReq = { sessionId: 'aaaaaaaa-0000-4000-8000-000000000201', harness: 'codex' as const, directory: '/Users/me/Projects/work', title: 'kg-hook-review' };

  it('HIST-3.1: `fleet spawn --resume` in its own Session host, in the directory it started in; "Starting…", then the Session', async () => {
    const t = setup({ spawn: async () => spawned('work-2', { harness: 'codex', resumed: resumeReq.sessionId }) });
    const launch = await t.launcher.resume(resumeReq);
    expect(spawnCall(t.calls).args).toEqual([
      '--local', 'spawn', '--resume', resumeReq.sessionId, '--harness', 'codex', '--dir', '/Users/me/Projects/work', '--backend', 'tmux', '--json',
    ]);
    expect(t.launcher.list()).toEqual([expect.objectContaining({ id: launch.id, state: 'starting', title: 'kg-hook-review', harness: 'codex' })]);
    // Fleet reports it under its own session id (here before its Session host shows in the list).
    t.launcher.observe([row({ session_id: resumeReq.sessionId, harness: 'codex', tmux_session: null })]);
    expect(t.launcher.list()).toEqual([]);
    expect(t.changes.at(-1)!.started).toEqual([{ launchId: launch.id, sessionId: resumeReq.sessionId }]);
    // A resume isn't a launch: the launcher's remembered choices stay.
    expect(t.update).not.toHaveBeenCalled();
  });

  it('HIST-3.1: a resume uses the launch id the tab picked; one already under way keeps its own', async () => {
    const t = setup({ spawn: async () => spawned('work-2', { harness: 'codex' }) });
    const id = '0f0e0d0c-0b0a-4000-8000-000000000002';
    expect((await t.launcher.resume({ ...resumeReq, launchId: id })).id).toBe(id);
    expect((await t.launcher.resume({ ...resumeReq, launchId: '0f0e0d0c-0b0a-4000-8000-000000000003' })).id).toBe(id);
  });

  it('HIST-3.4: a resume Fleet hasn’t reported after 15 s fails like a start (LAUNCH-4.5), with its terminal’s last lines', async () => {
    const t = setup({ spawn: async () => spawned('work-2', { harness: 'codex' }) });
    await t.launcher.resume(resumeReq);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(t.launcher.list()[0]).toMatchObject({ state: 'failed', error: expect.stringContaining('Session host is still running') });
    expect(t.calls.find((c) => c.file === 'tmux')!.args).toEqual(['capture-pane', '-p', '-t', '=work-2:']);
  });

  it('HIST-3.4: a resume gets the same cleaned environment as a start (LAUNCH-5.2)', async () => {
    const t = setup({ env: { PATH: '/usr/bin', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://x', CLAUDE_CODE_SESSION_ID: 'p', CLAUDECODE: '1' } });
    await t.launcher.resume(resumeReq);
    expect(spawnCall(t.calls).opts.env).toEqual({ PATH: '/usr/bin' });
  });

  it('HIST-3.2: Fleet’s `session_live` (a race with the live check) is a SessionLiveError, and no row stays', async () => {
    const t = setup({
      spawn: async () => {
        throw spawnFailed('session_live', `session ${resumeReq.sessionId} is live (pid 42)`, { pid: 42 });
      },
    });
    await expect(t.launcher.resume(resumeReq)).rejects.toBeInstanceOf(SessionLiveError);
    expect(t.launcher.list()).toEqual([]);
  });

  it('HIST-3.2: a resume this Lookout already has, "Starting…" or failed, is returned as it is: a retry after 35 s never spawns again', async () => {
    const t = setup({ spawn: async () => spawned('work-2', { harness: 'codex' }) });
    const first = await t.launcher.resume(resumeReq);
    await vi.advanceTimersByTimeAsync(35_000); // stuck at a trust prompt: failed after 15 s, and Fleet's 30 s are over
    const again = await t.launcher.resume(resumeReq);
    expect(again).toMatchObject({ id: first.id, state: 'failed' });
    expect(t.calls.filter((c) => c.args.includes('spawn'))).toHaveLength(1);
    expect(t.launcher.pendingResume(resumeReq.sessionId, 'codex')).toMatchObject({ id: first.id });
    expect(t.launcher.pendingResume(resumeReq.sessionId, 'claude')).toBeNull();
    // Once its row is dismissed, a click may resume it again.
    t.launcher.dismiss(first.id);
    await t.launcher.resume(resumeReq);
    expect(t.calls.filter((c) => c.args.includes('spawn'))).toHaveLength(2);
  });

  it('HIST-3.2: Fleet\u2019s `session_starting` keeps the "Starting…" row, tied to the Session id, and isn\u2019t retried', async () => {
    const t = setup({
      spawn: async () => {
        throw spawnFailed('session_starting', `session ${resumeReq.sessionId} is starting`);
      },
    });
    const launch = await t.launcher.resume(resumeReq);
    expect(launch).toMatchObject({ state: 'starting', title: 'kg-hook-review' });
    expect(t.launcher.list()).toEqual([expect.objectContaining({ id: launch.id, state: 'starting' })]);
    t.launcher.observe([row({ session_id: resumeReq.sessionId, harness: 'codex', tmux_session: 'someone-elses' })]);
    expect(t.changes.at(-1)!.started).toEqual([{ launchId: launch.id, sessionId: resumeReq.sessionId }]);
    expect(t.calls.filter((c) => c.args.includes('spawn'))).toHaveLength(1);
  });

  it('HIST-3.4: a `session_starting` resume not reported after 15 s says it\u2019s being started elsewhere; no terminal lines to read', async () => {
    const t = setup({
      spawn: async () => {
        throw spawnFailed('session_starting', `session ${resumeReq.sessionId} is starting`);
      },
    });
    await t.launcher.resume(resumeReq);
    await vi.advanceTimersByTimeAsync(15_000);
    const failed = t.launcher.list()[0]!;
    expect(failed).toMatchObject({ state: 'failed', terminal: null, error: expect.stringContaining('being started elsewhere') });
    expect(failed.error).toMatch(/trust prompt/);
    expect(failed.error).not.toMatch(/tmux/i);
    expect(t.calls.some((c) => c.file === 'tmux')).toBe(false);
  });

  it('HIST-3.4: `session_starting` arriving after the 15 s: the failure is reworded the same way', async () => {
    let answer!: (e: Error) => void;
    const t = setup({ spawn: () => new Promise<string>((_r, reject) => (answer = reject)) });
    const pending = t.launcher.resume(resumeReq);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(t.launcher.list()[0]!.error).toContain('Session host is still running');
    answer(spawnFailed('session_starting', `session ${resumeReq.sessionId} is starting`));
    await pending;
    expect(t.launcher.list()[0]).toMatchObject({ state: 'failed', terminal: null, error: expect.stringContaining('being started elsewhere') });
  });

  it('HIST-3.3: Fleet\u2019s `dir_missing` keeps its kind (DirMissingError), and no row stays', async () => {
    const t = setup({
      spawn: async () => {
        throw spawnFailed('dir_missing', `dir does not exist: ${resumeReq.directory}`);
      },
    });
    await expect(t.launcher.resume(resumeReq)).rejects.toBeInstanceOf(DirMissingError);
    expect(t.launcher.list()).toEqual([]);
  });

  it('HIST-3.1: other refusals come through cleaned, without naming tmux', async () => {
    const t = setup({
      spawn: async () => {
        throw spawnFailed('backend_failed', 'tmux refused: sk-ant-api03-SECRETSECRETSECRET');
      },
    });
    const err = (await t.launcher.resume(resumeReq).catch((e: unknown) => e)) as LaunchError;
    expect(err.message).toMatch(/^Couldn't start the Session: /);
    expect(err.message).not.toMatch(/tmux|SECRETSECRET/);
  });
});
