import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLAUDE_UPDATE_COMMAND,
  CODEX_UPDATE_COMMAND,
  FLEET_INSTALL_COMMAND,
  TB_JEV_INSTALL_COMMAND,
  TB_PROD_INSTALL_COMMAND,
  TB_PR_INSTALL_COMMAND,
  TB_SESSION_INSTALL_COMMAND,
} from '../shared/defaults.ts';
import { FLEET_VERSION_LINE, TOOLS, TOOL_IDS, TOOL_STATES, type ToolId, type ToolRow, type ToolsSnapshot, compareVersions, parseTbLatest, toolsAttention } from '../shared/tools.ts';
import type { JevStatus } from '../shared/usage.ts';
import { type RunOptions, run } from './exec.ts';
import { type HarnessFact, Launcher } from './launcher.ts';
import { refusedAsTooOld } from './too-old.ts';
import { TOOLS_READ_MIN_MS, ToolsMonitor, cargoRevisionFor, onPath } from './tools.ts';

const FIXTURES = new URL('./fixtures/tools/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, FIXTURES), 'utf8');
type Line = { line: string; number: string; revision?: string | null; latest?: unknown };
const LINES = JSON.parse(fixture('version-lines.json')) as Record<ToolId, Line[]>;
const FAKE_FLEET = new URL('./fixtures/fleet/messages/fake-fleet.mjs', import.meta.url).pathname;
/** `e2e/pins.json`'s Fleet revision today. */
const PIN = '5e2afd8c9d532c700d1ae48a802d6d87f1202b5a';
const NOW = Date.parse('2026-10-30T12:00:00Z');
const FIELDS = ['checkedAt', 'fix', 'id', 'needs', 'number', 'path', 'pin', 'purpose', 'reason', 'revision', 'state', 'version', 'via'];

let dir: string;
let home: string;
let bin: string;
let cargo: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lookout-tools-'));
  home = join(dir, 'home');
  bin = join(dir, 'bin');
  cargo = join(dir, 'cargo');
  for (const d of [home, bin, cargo]) mkdirSync(d);
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

/** An executable that does nothing: tests read its version through a fake runner, never by running it. */
function exe(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '#!/bin/sh\nexit 0\n');
  chmodSync(path, 0o755);
  return path;
}

type Answer = string | Record<string, unknown>;
/** Answers each binary's version read by its name; an object is thrown as the run's error. */
function fakeRunner(answers: Record<string, Answer>) {
  return vi.fn(async (file: string, _args: readonly string[], _opts: RunOptions) => {
    const a = answers[basename(file)];
    if (a === undefined) throw Object.assign(new Error('undeclared'), { code: 1, stderr: `undeclared ${file}` });
    if (typeof a !== 'string') throw Object.assign(new Error('failed'), a);
    return `${a}\n`;
  });
}

const READY_JEV: JevStatus = { state: 'ready', version: '0.2.0', keySource: 'config file', baseUrl: null, configPath: null, reason: null };
const fact = (id: 'claude' | 'codex', over: Partial<HarnessFact> = {}): HarnessFact => ({
  id,
  installed: true,
  path: join(home, '.local', 'bin', id),
  version: id === 'claude' ? '2.1.312 (Claude Code)' : 'codex-cli 0.163.0',
  ...over,
});
const GOOD_LINES: Record<string, string> = {
  fleet: 'fleet 0.1.0 (5e2afd8)',
  'tb-session': 'tb-session 0.4.0 (latest)',
  'tb-pr': 'tb-pr 0.3.1 (latest)',
  'tb-prod': 'tb-prod 1.2.0 (latest)',
  git: 'git version 2.54.0 (Apple Git-157)',
  tmux: 'tmux 3.6a',
};

interface Setup {
  env?: NodeJS.ProcessEnv;
  answers?: Record<string, Answer>;
  facts?: HarnessFact[] | Error;
  jev?: JevStatus;
  now?: () => number;
  pin?: string | null;
}
/** Every Tool on `bin` (PATH), new enough, unless the test says otherwise. */
function everything(): Setup {
  for (const name of ['fleet', 'tb-session', 'tb-pr', 'tb-prod', 'tb-jev', 'git', 'tmux']) exe(join(bin, name));
  return { answers: GOOD_LINES, facts: [fact('claude'), fact('codex')] };
}
function monitor(setup: Setup = {}) {
  const runner = fakeRunner(setup.answers ?? {});
  const changes: ToolsSnapshot[] = [];
  const jev = vi.fn(async () => setup.jev ?? READY_JEV);
  const harnesses = vi.fn(async () => {
    if (setup.facts instanceof Error) throw setup.facts;
    return setup.facts ?? [];
  });
  const m = new ToolsMonitor({
    runner,
    env: setup.env ?? { HOME: home, PATH: bin, CARGO_HOME: cargo },
    now: setup.now ?? (() => NOW),
    harnesses,
    jev,
    onChange: (t) => changes.push(t),
    pin: setup.pin === undefined ? PIN : setup.pin,
    cacheDir: join(home, 'Library', 'Caches'),
    tmuxDirs: [],
  });
  return { m, runner, changes, jev, harnesses };
}
const rowOf = (t: ToolsSnapshot, id: ToolId): ToolRow => t.rows.find((r) => r.id === id)!;
const readWith = async (setup: Setup) => (await monitor(setup).m.read());

describe('Settings › Tools: the rows (TOOLS-1)', () => {
  it('TOOLS-1.1: one row per Tool in the spec’s order, each with what it is for, its path and version (null when unknown), its state, a plain reason, a fix or null, and when it was read', async () => {
    const t = await readWith(everything());
    expect(t.rows.map((r) => r.id)).toEqual(['fleet', 'claude', 'codex', 'tb-session', 'tb-pr', 'tb-prod', 'tb-jev', 'git', 'tmux']);
    expect(TOOL_IDS).toEqual(t.rows.map((r) => r.id));
    expect(t).toMatchObject({ checkedAt: NOW, reading: false });
    for (const r of t.rows) {
      expect(Object.keys(r).sort(), r.id).toEqual(FIELDS);
      expect(TOOL_STATES, r.id).toContain(r.state);
      expect(r.purpose).toBe(TOOLS[r.id].purpose);
      expect(r.reason, r.id).toMatch(/\S/);
      expect(r.fix === null || typeof r.fix === 'string').toBe(true);
      expect(r.checkedAt).toBe(NOW);
    }
    expect(t.rows.map((r) => [r.id, r.state])).toEqual(TOOL_IDS.map((id) => [id, 'ok']));
    // Found nowhere: every path and version is null, and every Tool still has its row.
    const none = await readWith({ env: { HOME: home, PATH: join(dir, 'empty'), CARGO_HOME: cargo } });
    expect(none.rows).toHaveLength(9);
    for (const r of none.rows) expect([r.id, r.path, r.version]).toEqual([r.id, null, null]);
    expect(rowOf(none, 'tb-pr')).toMatchObject({ state: 'missing', reason: 'Not found on PATH or in ~/.local/bin.', fix: TB_PR_INSTALL_COMMAND });
  });

  it('TOOLS-1.1: before the first read, every Tool has a row that is still being checked', () => {
    const { m } = monitor();
    expect(m.snapshot()).toMatchObject({ checkedAt: null, reading: false });
    expect(m.snapshot().rows.map((r) => [r.id, r.checkedAt, r.state])).toEqual(TOOL_IDS.map((id) => [id, null, 'unknown']));
    expect(rowOf(m.snapshot(), 'fleet').pin).toBe('5e2afd8');
  });

  it('TOOLS-1.2: each Tool is looked for where the code that runs it looks: its LOOKOUT_*_BIN, then PATH, then ~/.cargo/bin for Fleet and ~/.local/bin for tb-*; git on PATH only; the path with ~, and the variable that named it', async () => {
    const own = exe(join(dir, 'own', 'fleet'));
    exe(join(bin, 'fleet'));
    exe(join(home, '.local', 'bin', 'tb-session'));
    const pr = exe(join(dir, 'pr', 'tb-pr'));
    exe(join(home, '.local', 'bin', 'tb-prod'));
    exe(join(home, '.local', 'bin', 'tb-jev'));
    exe(join(home, '.local', 'bin', 'git'));
    const env = { HOME: home, PATH: bin, CARGO_HOME: cargo, LOOKOUT_FLEET_BIN: own, LOOKOUT_TB_PR_BIN: pr };
    const t = await readWith({ env, answers: GOOD_LINES, facts: [fact('claude'), fact('codex', { installed: false })] });
    expect(rowOf(t, 'fleet')).toMatchObject({ path: own, via: 'LOOKOUT_FLEET_BIN' });
    expect(rowOf(t, 'tb-session')).toMatchObject({ path: '~/.local/bin/tb-session', via: null });
    expect(rowOf(t, 'tb-pr')).toMatchObject({ path: pr, via: 'LOOKOUT_TB_PR_BIN' });
    expect(rowOf(t, 'tb-prod')).toMatchObject({ path: '~/.local/bin/tb-prod', via: null });
    expect(rowOf(t, 'tb-jev')).toMatchObject({ path: '~/.local/bin/tb-jev', via: null });
    // git is looked for on PATH alone: one in ~/.local/bin isn't the one Lookout runs.
    expect(rowOf(t, 'git')).toMatchObject({ path: null, state: 'missing', reason: 'Not found on PATH.' });
    // A Harness is where Fleet found it, through its login shell.
    expect(rowOf(t, 'claude')).toMatchObject({ path: '~/.local/bin/claude', via: 'Fleet', state: 'ok' });
    expect(rowOf(t, 'codex')).toMatchObject({ path: null, state: 'missing', reason: "Fleet doesn't find it." });

    // Fleet in cargo's directory; an env variable naming a file that isn't there is missing, even with one on PATH.
    rmSync(join(bin, 'fleet'));
    exe(join(cargo, 'bin', 'fleet'));
    expect(rowOf(await readWith({ env: { HOME: home, PATH: bin, CARGO_HOME: cargo }, answers: GOOD_LINES }), 'fleet')).toMatchObject({ path: join(cargo, 'bin', 'fleet'), via: null });
    const gone = await readWith({ env: { ...env, LOOKOUT_FLEET_BIN: join(home, 'nowhere', 'fleet') }, answers: GOOD_LINES });
    expect(rowOf(gone, 'fleet')).toMatchObject({ state: 'missing', path: null, reason: "LOOKOUT_FLEET_BIN names ~/nowhere/fleet, which isn't there.", fix: FLEET_INSTALL_COMMAND });
    // Without Fleet, nothing can say where a Harness is.
    expect(rowOf(gone, 'claude')).toMatchObject({ state: 'unknown', path: null, reason: "Fleet finds it, and Fleet isn't installed." });

    // tmux: PATH, then Homebrew's directories.
    const brew = join(dir, 'brew');
    exe(join(brew, 'tmux'));
    expect(onPath('tmux', { PATH: join(dir, 'empty') }, [brew])).toBe(join(brew, 'tmux'));
    expect(onPath('tmux', { PATH: join(dir, 'empty') }, [])).toBeNull();
  });

  it('TOOLS-1.3: versions are read with argv only, 5 s and the cleaned environment: --version, tmux -V; a Harness from Fleet, tb-jev from its status, never run; the first line cut to 60 characters and redacted; a failed read is unknown with why', async () => {
    const setup = everything();
    const env = { HOME: home, PATH: bin, CARGO_HOME: cargo, CLAUDECODE: '1', OTEL_EXPORTER_OTLP_HEADERS: 'secret' };
    const { m, runner, jev } = monitor({ ...setup, env });
    const t = await m.read();
    const calls = runner.mock.calls.map(([file, args, opts]) => [basename(file), [...args], opts.timeoutMs]);
    expect(calls.sort()).toEqual(
      [
        ['fleet', ['--version'], 5000],
        ['git', ['--version'], 5000],
        ['tb-pr', ['--version'], 5000],
        ['tb-prod', ['--version'], 5000],
        ['tb-session', ['--version'], 5000],
        ['tmux', ['-V'], 5000],
      ].sort(),
    );
    for (const [, , opts] of runner.mock.calls) {
      expect(opts.env?.CLAUDECODE).toBeUndefined();
      expect(opts.env?.OTEL_EXPORTER_OTLP_HEADERS).toBeUndefined();
    }
    expect(jev).toHaveBeenCalledTimes(1);
    expect(rowOf(t, 'tb-jev')).toMatchObject({ version: '0.2.0', number: '0.2.0' });
    expect(rowOf(t, 'claude')).toMatchObject({ version: '2.1.312 (Claude Code)', number: '2.1.312' });
    expect(rowOf(t, 'tmux')).toMatchObject({ version: 'tmux 3.6a', number: '3.6a' });

    // Cut to 60 and redacted, like a usage reason.
    const long = `git version 2.54.0 (Apple Git-157) ${'and more '.repeat(10)}`;
    const secret = 'tb-pr 0.3.1 (latest) token=ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    const odd = await readWith({ ...everything(), answers: { ...GOOD_LINES, git: long, 'tb-pr': secret } });
    expect(rowOf(odd, 'git').version).toHaveLength(60);
    expect(rowOf(odd, 'git').version?.endsWith('…')).toBe(true);
    expect(rowOf(odd, 'tb-pr').version).not.toContain('ghp_abcdef');

    // A read that fails leaves `unknown`, with the reason; its path still shows.
    const failed = await readWith({
      ...everything(),
      answers: { ...GOOD_LINES, git: { code: 1, stderr: 'xcrun: error: invalid active developer path' }, tmux: { timedOut: true } },
    });
    expect(rowOf(failed, 'git')).toMatchObject({ state: 'unknown', path: join(bin, 'git'), version: null, reason: 'git --version failed (exit 1): xcrun: error: invalid active developer path' });
    expect(rowOf(failed, 'tmux')).toMatchObject({ state: 'unknown', reason: 'tmux -V took longer than 5 s.' });
  });

  it('TOOLS-1.3: each parser reads the version number out of its recorded first line, the rest kept as text', () => {
    for (const id of TOOL_IDS) {
      for (const { line, number } of LINES[id]) expect(TOOLS[id].parse(line), `${id}: ${line}`).toBe(number);
    }
    for (const { line, revision } of LINES.fleet) expect(FLEET_VERSION_LINE.exec(line)?.[2] ?? null).toBe(revision);
    for (const id of ['tb-session', 'tb-pr', 'tb-prod'] as const) {
      for (const { line, latest } of LINES[id]) expect(parseTbLatest(id, line), line).toEqual(latest);
    }
    expect(TOOLS.git.parse('something else')).toBeNull();
    expect(compareVersions('0.3.10', '0.3.9')).toBe(1);
    expect(compareVersions('0.4.0-beta', '0.4.0')).toBeNull();
  });

  it('TOOLS-1.4: read on start and when the page opens, at most once a minute; Refresh reads now; a read in flight is shared; nothing on a timer', async () => {
    vi.useFakeTimers();
    let now = NOW;
    const { m, runner, changes } = monitor({ ...everything(), now: () => now });
    const reads = () => runner.mock.calls.filter(([file]) => basename(file) === 'git').length;
    await Promise.all([m.start(), m.read(), m.read()]);
    expect(reads()).toBe(1);
    expect(changes.map((c) => c.reading)).toEqual([true, false]);
    // Hours pass with nothing showing the rows: no read.
    await vi.advanceTimersByTimeAsync(3 * 3_600_000);
    expect(reads()).toBe(1);
    now += TOOLS_READ_MIN_MS - 1;
    expect((await m.read()).checkedAt).toBe(NOW);
    expect(reads()).toBe(1);
    now += 1;
    await m.read();
    expect(reads()).toBe(2);
    await m.read({ force: true });
    expect(reads()).toBe(3);
    expect(m.snapshot().checkedAt).toBe(now);
  });

  it('TOOLS-1.4: Refresh asks the launcher for a forced read, bypassing and refreshing its 10-minute cache; a read on open does not', async () => {
    const { m, harnesses } = monitor({ ...everything(), facts: [fact('claude'), fact('codex')] });
    await m.read();
    expect(harnesses).toHaveBeenLastCalledWith(false);
    await m.read({ force: true });
    expect(harnesses).toHaveBeenLastCalledWith(true);
  });

  it('TOOLS-1.4: Refresh twice within a minute re-reads every installed version both times, but asks GitHub for newer releases once; the last answer stands', async () => {
    const setup = everything();
    const ghDir = join(dir, 'gh-bin');
    exe(join(ghDir, 'gh'));
    // tb's `--version` calls gh when it can find it, as cli-toolbox's does.
    const runner = vi.fn(async (file: string, _a: readonly string[], opts: RunOptions) => {
      const name = basename(file);
      if (name.startsWith('tb-')) {
        const sees = (opts.env?.PATH ?? '').split(':').includes(ghDir);
        return sees ? `${name} 9.0.0 (latest: 9.1.0 — upgrade available)\n` : `${name} 9.0.0 (install gh to check for updates)\n`;
      }
      return `${GOOD_LINES[name] ?? 'ok'}\n`;
    });
    const m = new ToolsMonitor({
      runner,
      env: { HOME: home, PATH: `${bin}:${ghDir}`, CARGO_HOME: cargo },
      now: () => NOW,
      harnesses: async () => setup.facts as HarnessFact[],
      jev: async () => READY_JEV,
      onChange: () => {},
      pin: PIN,
      cacheDir: join(home, 'Library', 'Caches'),
      tmuxDirs: [],
    });
    const calls = (name: string) => runner.mock.calls.filter(([f]) => basename(f) === name);
    const ghCalls = () => runner.mock.calls.filter(([f, , o]) => basename(f).startsWith('tb-') && (o.env?.PATH ?? '').split(':').includes(ghDir)).length;
    await m.read();
    const first = await m.read({ force: true });
    const second = await m.read({ force: true });
    // Local reads ran every time...
    expect(calls('git')).toHaveLength(3);
    expect(calls('tb-pr')).toHaveLength(3);
    // ...GitHub was asked once per Tool (tb-session, tb-pr, tb-prod), by the first read only.
    expect(ghCalls()).toBe(3);
    // The refreshed rows still say what the one check found.
    for (const t of [first, second]) expect(rowOf(t, 'tb-pr')).toMatchObject({ state: 'update-available', reason: '9.1.0 is out.' });
    // A minute on, the check runs again.
    const later = new ToolsMonitor({ runner, env: { HOME: home, PATH: `${bin}:${ghDir}`, CARGO_HOME: cargo }, now: (() => { let n = NOW; return () => (n += TOOLS_READ_MIN_MS); })(), harnesses: async () => setup.facts as HarnessFact[], jev: async () => READY_JEV, onChange: () => {}, pin: PIN, tmuxDirs: [] });
    await later.read();
    await later.read({ force: true });
    expect(ghCalls()).toBe(9);
  });

  it('TOOLS-1.4: closing cancels the read in flight and reads no more', async () => {
    const setup = everything();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const runner = vi.fn(async (_f: string, _a: readonly string[], opts: RunOptions) => {
      await held;
      if (opts.signal?.aborted) throw Object.assign(new Error('cancelled'), { aborted: true });
      return 'git version 2.54.0';
    });
    const m = new ToolsMonitor({ runner, env: { HOME: home, PATH: bin, CARGO_HOME: cargo }, harnesses: async () => setup.facts as HarnessFact[], jev: async () => READY_JEV, onChange: () => {}, pin: PIN, tmuxDirs: [] });
    const reading = m.read();
    const closed = m.close();
    release();
    await closed;
    await reading;
    const before = runner.mock.calls.length;
    await m.read({ force: true });
    expect(runner.mock.calls.length).toBe(before);
  });
});

describe('what Lookout needs (TOOLS-2)', () => {
  it('TOOLS-2.1: one table holds the lowest version each feature works with, and why; below the highest is behind, naming each feature that doesn’t work, with the install command from defaults.ts', async () => {
    const needs = Object.fromEntries(TOOL_IDS.map((id) => [id, TOOLS[id].needs.map((n) => [n.feature, n.version])]));
    expect(needs).toEqual({
      fleet: [],
      claude: [["the sidebar's Subagent count", '2.1.301']],
      codex: [['Fleet', '0.163.0']],
      'tb-session': [['History', '0.3.0'], ['the Library', '0.4.0']],
      'tb-pr': [['Work', '0.3.1']],
      'tb-prod': [['Work', '1.2.0']],
      'tb-jev': [['the usage strip', '0.2.0']],
      git: [],
      tmux: [],
    });
    for (const id of TOOL_IDS) for (const n of TOOLS[id].needs) expect(n.why, `${id} ${n.feature}`).toMatch(/\S/);
    const setup = everything();
    const t = await readWith({
      ...setup,
      answers: { ...GOOD_LINES, 'tb-session': 'tb-session 0.2.0 (latest: 0.4.0 — upgrade available)', 'tb-pr': 'tb-pr 0.3.0 (latest)', 'tb-prod': 'tb-prod 1.1.1 (install gh to check for updates)' },
      facts: [fact('claude', { version: '2.1.300 (Claude Code)' }), fact('codex', { version: 'codex-cli 0.162.0' })],
      jev: { ...READY_JEV, state: 'unavailable', version: null },
    });
    expect(rowOf(t, 'tb-session')).toMatchObject({ state: 'behind', reason: 'History needs 0.3.0; the Library needs 0.4.0.', fix: TB_SESSION_INSTALL_COMMAND });
    expect(rowOf(t, 'tb-pr')).toMatchObject({ state: 'behind', reason: 'Work needs 0.3.1.', fix: TB_PR_INSTALL_COMMAND });
    // `(install gh to check for updates)` leaves the state as it is, with the reason (TOOLS-3.1).
    expect(rowOf(t, 'tb-prod')).toMatchObject({ state: 'behind', reason: 'Work needs 1.2.0. Install gh to check for updates.', fix: TB_PROD_INSTALL_COMMAND });
    expect(rowOf(t, 'claude')).toMatchObject({ state: 'behind', reason: "The sidebar's Subagent count needs 2.1.301.", fix: CLAUDE_UPDATE_COMMAND });
    expect(rowOf(t, 'codex')).toMatchObject({ state: 'behind', reason: 'Fleet needs 0.163.0.', fix: CODEX_UPDATE_COMMAND });
    expect(rowOf(t, 'tb-jev')).toMatchObject({ state: 'behind', reason: 'The usage strip needs 0.2.0; this tb-jev has no status.', fix: TB_JEV_INSTALL_COMMAND });
    // Only the Library's need unmet.
    const library = await readWith({ ...everything(), answers: { ...GOOD_LINES, 'tb-session': 'tb-session 0.3.0 (latest)' } });
    // `(latest)` says nothing beside a need a release doesn't meet.
    expect(rowOf(library, 'tb-session')).toMatchObject({ state: 'behind', reason: 'The Library needs 0.4.0.' });
    // git and tmux: any version; a pre-release elsewhere is unknown.
    const any = await readWith({ ...everything(), answers: { ...GOOD_LINES, git: 'git version 1.0.0', tmux: 'tmux next-3.7', 'tb-pr': 'tb-pr 0.4.0-rc.1 (latest)' } });
    expect([rowOf(any, 'git').state, rowOf(any, 'tmux').state]).toEqual(['ok', 'ok']);
    expect(rowOf(any, 'tb-pr')).toMatchObject({ state: 'unknown', reason: "0.4.0-rc.1 isn't a version Lookout can compare." });
  });

  it('TOOLS-2.2: Fleet is judged by revision against the pin, from `fleet --version` once it prints one, else cargo’s install record; another revision is behind, none unknown with the pinned install command', async () => {
    const setup = everything();
    const fleet = async (line: Answer, pin = PIN) => rowOf(await readWith({ ...setup, answers: { ...GOOD_LINES, fleet: line }, pin }), 'fleet');
    expect(await fleet('fleet 0.1.0 (5e2afd8)')).toMatchObject({ state: 'ok', number: '0.1.0', revision: '5e2afd8', pin: '5e2afd8', reason: 'Built from the pinned revision 5e2afd8.', fix: null });
    expect(await fleet('fleet 0.1.0 (38a461c)')).toMatchObject({ state: 'behind', revision: '38a461c', pin: '5e2afd8', reason: 'Built from 38a461c; Lookout is tested against 5e2afd8.', fix: FLEET_INSTALL_COMMAND });
    // A newer one is "another revision" too: the pin is what the tests ran against.
    expect(await fleet('fleet 0.1.0 (5e2afd8)', 'aaaaaaa1111')).toMatchObject({ state: 'behind', pin: 'aaaaaaa' });
    // Today's pin prints no revision, and this one has no cargo record next to it.
    expect(await fleet('fleet 0.1.0')).toMatchObject({ state: 'unknown', revision: null, reason: expect.stringMatching(/^Revision unknown/), fix: FLEET_INSTALL_COMMAND });
    // With the record cargo leaves in the install root: `<root>/bin/fleet` → `<root>/.crates2.json`.
    rmSync(join(bin, 'fleet'));
    const root = join(dir, 'cargo-root');
    exe(join(root, 'bin', 'fleet'));
    copyFileSync(new URL('crates2.json', FIXTURES), join(root, '.crates2.json'));
    symlinkSync(join(root, 'bin', 'fleet'), join(bin, 'fleet'));
    expect(cargoRevisionFor(join(bin, 'fleet'))).toBe(PIN);
    expect(await fleet('fleet 0.1.0')).toMatchObject({ state: 'ok', revision: '5e2afd8' });
  });

  it('TOOLS-2.2: against the fake fleet, the fork commit’s `--version` and today’s plain one, through the real runner', async () => {
    const read = async (version: string | undefined) => {
      // node on PATH for the fake's shebang; nothing else.
      const env = { HOME: home, PATH: dirname(process.execPath), CARGO_HOME: cargo, LOOKOUT_FLEET_BIN: FAKE_FLEET, ...(version ? { FAKE_FLEET_VERSION: version } : {}) };
      const m = new ToolsMonitor({ runner: run, env, harnesses: async () => [], jev: async () => READY_JEV, onChange: () => {}, pin: PIN, tmuxDirs: [] });
      return rowOf(await m.read(), 'fleet');
    };
    expect(await read('fleet 0.1.0 (5e2afd8)')).toMatchObject({ state: 'ok', version: 'fleet 0.1.0 (5e2afd8)', revision: '5e2afd8', via: 'LOOKOUT_FLEET_BIN' });
    expect(await read(undefined)).toMatchObject({ state: 'unknown', version: 'fleet 0.1.0', revision: null });
  });

  it('TOOLS-2.4: only missing and behind need attention, each named in the Settings button’s tooltip; update-available and newer-than-known don’t', async () => {
    const t = await readWith({
      ...everything(),
      answers: { ...GOOD_LINES, 'tb-session': 'tb-session 0.4.0 (latest: 0.4.1 — upgrade available)', 'tb-prod': 'tb-prod 1.1.1 (latest)' },
      facts: [fact('claude', { version: '2.1.314 (Claude Code)' }), fact('codex', { installed: false })],
    });
    expect(t.rows.map((r) => [r.id, r.state]).filter(([, s]) => s !== 'ok')).toEqual([
      ['claude', 'newer-than-known'],
      ['codex', 'missing'],
      ['tb-session', 'update-available'],
      ['tb-prod', 'behind'],
    ]);
    // Codex alone missing is not attention: Claude Code can start a Session (Dario, 2026-10-30).
    expect(toolsAttention(t)).toEqual(['tb-prod is behind']);
    expect(toolsAttention(null)).toEqual([]);
  });

  it('TOOLS-2.4: a missing Harness lights the dot only when neither Claude Code nor Codex is installed; a too-old one always does, and other Tools keep the rule', async () => {
    const attention = async (facts: HarnessFact[], extra: Record<string, Answer> = {}) => toolsAttention(await readWith({ ...everything(), answers: { ...GOOD_LINES, ...extra }, facts }));
    expect(await attention([fact('claude'), fact('codex', { installed: false })])).toEqual([]);
    expect(await attention([fact('claude', { installed: false }), fact('codex')])).toEqual([]);
    expect(await attention([fact('claude', { installed: false }), fact('codex', { installed: false })])).toEqual(['claude is missing', 'codex is missing']);
    // Too old: lights it even though the other Harness is fine.
    expect(await attention([fact('claude', { version: '2.1.300 (Claude Code)' }), fact('codex')])).toEqual(['claude is behind']);
    expect(await attention([fact('claude'), fact('codex', { version: 'codex-cli 0.100.0' })])).toEqual(['codex is behind']);
    // Another missing Tool still does, whatever the Harnesses.
    expect(await attention([fact('claude'), fact('codex')], { 'tb-prod': 'tb-prod 1.1.1 (latest)' })).toEqual(['tb-prod is behind']);
  });

  it('TOOLS-2.5: clap’s refusal of a subcommand or long flag (exit 2) reads as too old; a short one is a value it misread, and anything else is not', () => {
    const e = (code: unknown, stderr: string) => ({ code, stderr });
    expect(refusedAsTooOld(e(2, "error: unrecognized subcommand 'events'\n\nUsage: tb-session <COMMAND>"))).toBe(true);
    expect(refusedAsTooOld(e(2, "\u001b[1m\u001b[31merror:\u001b[0m unexpected argument '--harness' found"))).toBe(true);
    expect(refusedAsTooOld(e(2, "error: unexpected argument '-l' found"))).toBe(false);
    expect(refusedAsTooOld(e(1, "error: unrecognized subcommand 'events'"))).toBe(false);
    expect(refusedAsTooOld(e('ENOENT', ''))).toBe(false);
    expect(refusedAsTooOld(null)).toBe(false);
  });
});

describe('a newer one exists (TOOLS-3)', () => {
  it('TOOLS-3.1: tb-session, tb-pr and tb-prod’s own `--version` says when a newer release is out; `(latest)` and `(install gh …)` leave the state as it is, the latter with the reason', async () => {
    const t = await readWith({
      ...everything(),
      answers: { ...GOOD_LINES, 'tb-session': LINES['tb-session'][2]!.line, 'tb-pr': LINES['tb-pr'][1]!.line },
    });
    expect(rowOf(t, 'tb-pr')).toMatchObject({ state: 'update-available', version: 'tb-pr 0.4.0 (latest: 0.4.1 — upgrade available)', number: '0.4.0', reason: '0.4.1 is out.', fix: TB_PR_INSTALL_COMMAND });
    expect(rowOf(t, 'tb-session')).toMatchObject({ state: 'ok', reason: 'Install gh to check for updates.' });
    expect(rowOf(t, 'tb-prod')).toMatchObject({ state: 'ok', reason: 'The latest release.' });
  });

  it('TOOLS-3.1: tb-jev’s newer release comes from cli-toolbox’s cache file alone, and an unreadable one is ignored', async () => {
    const caches = join(home, 'Library', 'Caches', 'tb-jev');
    mkdirSync(caches, { recursive: true });
    const write = (text: string) => writeFileSync(join(caches, 'version-check.json'), text);
    write(fixture('tb-jev-version-check.json'));
    expect(rowOf(await readWith(everything()), 'tb-jev')).toMatchObject({ state: 'ok' });
    write(JSON.stringify({ latest_version: '0.2.1', checked_at: '2026-10-28T12:00:00Z' }));
    expect(rowOf(await readWith(everything()), 'tb-jev')).toMatchObject({ state: 'update-available', reason: '0.2.1 is out (checked 2 days ago).', fix: TB_JEV_INSTALL_COMMAND });
    for (const bad of ['not json', '{"latest_version":"9.9.9-beta"}', '[]', JSON.stringify({ latest_version: 'x'.repeat(70_000) })]) {
      write(bad);
      expect(rowOf(await readWith(everything()), 'tb-jev').state, bad.slice(0, 30)).toBe('ok');
    }
  });

  it('TOOLS-3.2: Codex’s newer release comes from ~/.codex/version.json, which Codex writes, with `codex update` and when Codex checked', async () => {
    mkdirSync(join(home, '.codex'));
    copyFileSync(new URL('codex-version.json', FIXTURES), join(home, '.codex', 'version.json'));
    expect(rowOf(await readWith(everything()), 'codex')).toMatchObject({ state: 'update-available', reason: '0.164.0 is out (Codex checked 7 days ago).', fix: CODEX_UPDATE_COMMAND });
    // Installed already: newer than Fleet knows instead (TOOLS-4.1), never an update.
    const current = await readWith({ ...everything(), facts: [fact('claude'), fact('codex', { version: 'codex-cli 0.164.0' })] });
    expect(rowOf(current, 'codex').state).toBe('newer-than-known');
    writeFileSync(join(home, '.codex', 'version.json'), JSON.stringify({ latest_version: '0.165.0', last_checked_at: '2026-10-30T11:00:00Z', dismissed_version: '0.165.0' }));
    expect(rowOf(await readWith(everything()), 'codex')).toMatchObject({ state: 'update-available', reason: '0.165.0 is out (Codex checked 1 h ago; dismissed there).' });
    writeFileSync(join(home, '.codex', 'version.json'), '{"latest_version": 3}');
    expect(rowOf(await readWith(everything()), 'codex').state).toBe('ok');
  });

  it('TOOLS-3.3: Claude Code’s row says what its auto-updater last did: a failure with `claude update`, a success to another version waiting for a restart', async () => {
    mkdirSync(join(home, '.claude'));
    const file = join(home, '.claude', '.last-update-result.json');
    copyFileSync(new URL('claude-last-update-failed.json', FIXTURES), file);
    const stuck = { ...everything(), facts: [fact('claude', { version: '2.1.309 (Claude Code)' }), fact('codex')] };
    expect(rowOf(await readWith(stuck), 'claude')).toMatchObject({ state: 'update-available', reason: 'Auto-update failed 7 days ago (from 2.1.309).', fix: CLAUDE_UPDATE_COMMAND });
    // Updated by hand since: 2.1.314 is above the failure's `version_from` (2.1.309), so it no longer shows.
    const byHand = rowOf(await readWith({ ...everything(), facts: [fact('claude', { version: '2.1.314 (Claude Code)' }), fact('codex')] }), 'claude');
    expect(byHand.reason ?? '').not.toContain('Auto-update failed');
    expect(byHand.fix).toBeNull();
    // 2.1.312 → 2.1.314, recorded on Dario's Mac: the running 2.1.312 waits for a restart.
    copyFileSync(new URL('claude-last-update-success.json', FIXTURES), file);
    expect(rowOf(await readWith(everything()), 'claude')).toMatchObject({ state: 'update-available', reason: '2.1.314 was installed 10 h ago and waits for a restart.', fix: null });
    // Running 2.1.314 already: nothing waits; it's newer than Fleet knows (TOOLS-4.1).
    const running = await readWith({ ...everything(), facts: [fact('claude', { version: '2.1.314 (Claude Code)' }), fact('codex')] });
    expect(rowOf(running, 'claude')).toMatchObject({ state: 'newer-than-known', fix: null });
  });

  it('TOOLS-3.4: Lookout never runs an install or update command: a read runs `--version` and `tmux -V` only, and every fix is text for the page to show', async () => {
    mkdirSync(join(home, '.claude'));
    copyFileSync(new URL('claude-last-update-failed.json', FIXTURES), join(home, '.claude', '.last-update-result.json'));
    const { m, runner } = monitor({ ...everything(), facts: [fact('claude', { version: '2.1.309 (Claude Code)' }), fact('codex')], answers: { ...GOOD_LINES, 'tb-pr': 'tb-pr 0.2.0 (latest: 0.3.1 — upgrade available)', fleet: 'fleet 0.1.0 (38a461c)' } });
    const t = await m.read();
    await m.read({ force: true });
    const fixes = t.rows.flatMap((r) => (r.fix ? [r.fix] : []));
    expect(fixes).toEqual(expect.arrayContaining([FLEET_INSTALL_COMMAND, TB_PR_INSTALL_COMMAND, CLAUDE_UPDATE_COMMAND]));
    for (const [file, args] of runner.mock.calls) {
      expect([['--version'], ['-V']], basename(file)).toContainEqual([...args]);
      expect(fixes.some((f) => f.includes(basename(file)) && args.length > 1)).toBe(false);
    }
  });
});

describe('a Harness newer than Fleet knows (TOOLS-4)', () => {
  it('TOOLS-4.1: the table holds the version Fleet was checked against per Harness; above it is newer-than-known, with the re-check reason and no fix', async () => {
    expect([TOOLS.claude.checkedUpTo, TOOLS.codex.checkedUpTo]).toEqual(['2.1.312', '0.163.0']);
    const read = async (claude: string, codex: string) =>
      readWith({ ...everything(), facts: [fact('claude', { version: `${claude} (Claude Code)` }), fact('codex', { version: `codex-cli ${codex}` })] });
    const at = await read('2.1.312', '0.163.0');
    expect([rowOf(at, 'claude').state, rowOf(at, 'codex').state]).toEqual(['ok', 'ok']);
    const past = await read('2.1.313', '0.164.0');
    expect(rowOf(past, 'claude')).toMatchObject({
      state: 'newer-than-known',
      reason: "Fleet's model and Effort lists and its prompt reading were checked up to 2.1.312; re-check them.",
      fix: null,
    });
    expect(rowOf(past, 'codex')).toMatchObject({ state: 'newer-than-known', reason: expect.stringContaining('checked up to 0.163.0'), fix: null });
  });

  it('TOOLS-1.2: a Harness Fleet found without a path or version, as today’s pin lists it, is unknown: found by Fleet, version unreadable', async () => {
    const t = await readWith({ ...everything(), facts: [fact('claude', { path: null, version: null }), fact('codex', { version: null })] });
    expect(rowOf(t, 'claude')).toMatchObject({ state: 'unknown', path: null, via: 'Fleet', reason: 'Found by Fleet; version unreadable.' });
    expect(rowOf(t, 'codex')).toMatchObject({ state: 'unknown', path: '~/.local/bin/codex', reason: 'Found by Fleet; version unreadable.' });
    const failed = await readWith({ ...everything(), facts: new Error('fleet harness list failed: boom') });
    expect(rowOf(failed, 'claude')).toMatchObject({ state: 'unknown', reason: "Fleet couldn't list the Harnesses: fleet harness list failed: boom" });
  });

  it('TOOLS-1.4: a forced `harnessFacts` reads `harness list` again inside the cache window and caches the new answer', async () => {
    let version = 'claude 2.1.314';
    const runner = vi.fn(async () => JSON.stringify([{ id: 'claude', installed: true, path: '/bin/claude', version }]));
    const launcher = new Launcher({ runner, fleetBin: () => 'fleet', settings: { get: () => ({}) } as never, onChange: () => {} });
    expect((await launcher.harnessFacts())[0]!.version).toBe('claude 2.1.314');
    version = 'claude 2.1.320';
    expect((await launcher.harnessFacts())[0]!.version).toBe('claude 2.1.314');
    expect((await launcher.harnessFacts(true))[0]!.version).toBe('claude 2.1.320');
    expect((await launcher.harnessFacts())[0]!.version).toBe('claude 2.1.320');
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('TOOLS-1.2: the launcher keeps the path and version `harness list --json` gives (contract F2) from its one cached read, through the fake fleet', async () => {
    const fixtures = join(dir, 'fleet');
    mkdirSync(fixtures);
    copyFileSync(new URL('harnesses-f2.json', FIXTURES), join(fixtures, 'harnesses.json'));
    const runner = vi.fn(run);
    const launcher = new Launcher({ runner, fleetBin: () => FAKE_FLEET, settings: { get: () => ({}) } as never, onChange: () => {}, env: { ...process.env, FAKE_FLEET_DIR: fixtures } });
    const facts = await launcher.harnessFacts();
    expect(facts).toEqual([
      { id: 'claude', installed: true, path: '/Users/me/.local/bin/claude', version: '2.1.314 (Claude Code)' },
      { id: 'codex', installed: true, path: '/Users/me/.nvm/versions/node/v24.22.1/bin/codex', version: 'codex-cli 0.163.0' },
    ]);
    await launcher.harnesses();
    await launcher.harnessFacts();
    expect(runner).toHaveBeenCalledTimes(1);
    // Today's pin: no `path` or `version`.
    const old = new Launcher({ runner: run, fleetBin: () => FAKE_FLEET, settings: { get: () => ({}) } as never, onChange: () => {} });
    expect((await old.harnessFacts()).map((f) => [f.id, f.path, f.version])).toEqual([
      ['claude', null, null],
      ['codex', null, null],
    ]);
  });
});
