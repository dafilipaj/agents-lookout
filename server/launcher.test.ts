import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Settings, defaultSettings } from '../shared/settings.ts';
import type { LaunchView } from '../shared/types.ts';
import type { RunOptions } from './exec.ts';
import type { FleetRow } from './fleet.ts';
import { HARNESS_CACHE_MS, LaunchError, Launcher, cleanEnv, parseSpawnedSession } from './launcher.ts';

const HARNESS_JSON = JSON.stringify([
  { id: 'claude', label: 'Claude Code', command: 'claude', installed: true, models: [{ id: '', label: 'Default' }, { id: 'claude-opus-5-5', label: 'Opus 5.5' }] },
  { id: 'codex', label: 'Codex', command: 'codex', installed: false, models: [{ id: '', label: 'Default (gpt-6-astra)' }] },
  { id: 'pi', label: 'pi', command: 'pi', installed: true, models: [] },
]);

type Call = { file: string; args: readonly string[]; opts: RunOptions };

function setup(over: { spawn?: (call: Call) => Promise<string>; env?: NodeJS.ProcessEnv; settings?: Partial<Settings> } = {}) {
  const calls: Call[] = [];
  let settings: Settings = { ...defaultSettings(), ...over.settings };
  const changes: { launches: LaunchView[]; started: { launchId: string; sessionId: string }[] }[] = [];
  let now = 1_000_000;
  const runner = vi.fn(async (file: string, args: readonly string[], opts: RunOptions) => {
    const call = { file, args, opts };
    calls.push(call);
    if (args.includes('harness')) return HARNESS_JSON;
    if (args.includes('spawn')) return over.spawn ? over.spawn(call) : 'spawned tmux session fix-rates  (attach: tmux attach -t fix-rates) in ~/Projects/work\n';
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

  it('parses the tmux session from what `fleet spawn` prints', () => {
    expect(parseSpawnedSession('spawned tmux session work-2  (attach: tmux attach -t work-2) in ~/Projects/work\n')).toBe('work-2');
    expect(parseSpawnedSession('spawned iTerm tab in ~/x')).toBeNull();
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

  it('LAUNCH-1.2: a start remembers its Harness, model and directory', async () => {
    const t = setup();
    await t.launcher.start(req({ model: 'claude-opus-5-5' }));
    expect(t.update).toHaveBeenCalledWith({ lastLaunch: { harness: 'claude', model: 'claude-opus-5-5', directory: '~/Projects/work' } }, 'server');
  });

  it('LAUNCH-4.4: when `fleet spawn` fails, the start fails with the reason, and its row goes away', async () => {
    const t = setup({
      spawn: async () => {
        throw Object.assign(new Error('exit 1'), { code: 1, stderr: 'error: tmux session `fix-rates` already exists — pick another --name\n' });
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
        throw Object.assign(new Error('exit 1'), { code: 1, stderr: 'error: dir does not exist: /x\n' });
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

  it('LAUNCH-4.5: the 15 s count from when "Starting…" appeared, even while `fleet spawn` is still running', async () => {
    let finishSpawn: (out: string) => void = () => {};
    const t = setup({ spawn: () => new Promise((resolve) => (finishSpawn = resolve)) });
    const started = t.launcher.start(req());
    await vi.advanceTimersByTimeAsync(15_000);
    // Failed at 15 s after the row appeared, though spawn hasn't returned yet.
    expect(t.launcher.list()[0]).toMatchObject({ state: 'failed', terminal: null });
    // When spawn returns, the terminal's last lines are attached.
    finishSpawn('spawned tmux session slow-one  (attach: tmux attach -t slow-one) in ~/Projects/work\n');
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
