import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preflight } from '../../global-setup.ts';
import { acquireRunLock, parseRunArgs } from '../../run.ts';
import { BudgetExceeded, Waits, checkBudget, withinBudget } from '../../world/budget.ts';
import { checkTitle, expect, runScenario, scenario, test, world } from '../../world/index.ts';
import { assertInsideRepo, checkPin, installRoot, loadPins, pinnedBin } from '../../world/pins.ts';
import { type Proc, WORLD_ID_ENV, listProcesses, ownedProcesses, programOf, signalVerified } from '../../world/processes.ts';
import {
  type WorldEntry,
  createRunDir,
  readEntry,
  recordLeftovers,
  reserveWorld,
  runDir,
  sweepDeadRuns,
  sweepWorld,
  worldDirs,
  worldEntries,
} from '../../world/registry.ts';
import {
  ABSENT_TOOLS,
  FLEET_PATH_ONLY,
  REAL_TOOLS,
  RESERVED_PORTS,
  USER_HOME,
  type StopReport,
  checkBootstrap,
  realTmux,
  startWorld,
} from '../../world/runtime.ts';

/** The World's own guarantees (TEST-1, TEST-2), proved on empty Worlds. */

const alive = (p: { pid: number; startMs: number }, procs: readonly Proc[]) => procs.some((q) => q.pid === p.pid && q.startMs === p.startMs);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A process that carries `token`, or descends from one that does. */
const carrying = async (token: string) => ownedProcesses(await listProcesses(), token);
const pidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

scenario(
  'TEST-1.1: a World has its own HOME, settings file, private tmux server and a port the OS picked',
  world(),
  async ({ page, world }) => {
    expect(world.home.startsWith(world.root)).toBe(true);
    expect(world.env.HOME).toBe(world.home);
    expect(world.settingsPath.startsWith(world.home)).toBe(true);
    expect(world.serverLog()).toContain(`Settings: ${world.settingsPath}`);
    expect(page.url()).toBe(world.url);

    // The port is the one the server bound and reported, never 4747 or 4748, and the server on it
    // answers with the World's token.
    expect(world.env.LOOKOUT_PORT).toBe('0');
    expect(world.serverLog()).toContain(`Lookout server on http://127.0.0.1:${world.port}`);
    expect(RESERVED_PORTS.has(world.port)).toBe(false);
    await checkBootstrap(world.port, world.token);

    // The private server answers on its own socket, under the World's TMUX_TMPDIR.
    const where = await world.tmux(['display', '-p', '#{socket_path}']);
    expect(where.code).toBe(0);
    expect(where.stdout.trim()).toMatch(new RegExp(`/tmux-\\d+/${world.socket}$`));
    expect(where.stdout.trim()).toContain(world.tmuxTmpdir.replace(/^\/tmp\//, ''));

    // Nothing points at the user's HOME, tmux, keychain or settings.
    for (const [key, value] of Object.entries(world.env)) {
      expect(value === USER_HOME || value.startsWith(`${USER_HOME}/.`), `${key} points into the user's HOME`).toBe(false);
    }
    for (const key of ['TMUX', 'TMUX_PANE', 'XDG_CONFIG_HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'FLEET_HOST']) {
      expect(world.env[key], key).toBeUndefined();
    }
    const list = await world.run('fleet', ['--local', 'list', '--json']);
    expect(list.code).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([]);
    // tb-session indexes the World's HOME, and finds nothing there.
    const past = await world.run('tb-session', ['list', '--all-projects', '--json', '--limit', '5']);
    expect(past.code, past.stderr).toBe(0);
    expect(JSON.parse(past.stdout)).toMatchObject({ total_results: 0, results: [] });
    expect(existsSync(join(world.home, 'Library', 'Caches', 'tb-session', 'index.db'))).toBe(true);
    expect(world.trapKnocks).toBe(0);
  },
);

test('TEST-1.1: the World takes only a server that answers with its own token', async () => {
  const other = createServer((_req, res) => res.end(JSON.stringify({ token: 'someone-elses' })));
  const port = await new Promise<number>((resolve) => other.listen(0, '127.0.0.1', () => resolve((other.address() as { port: number }).port)));
  try {
    await expect(checkBootstrap(port, 'the-worlds-token')).rejects.toThrow(/isn't the World's Lookout/);
  } finally {
    other.close();
  }
  await expect(checkBootstrap(port, 'the-worlds-token', 500)).rejects.toThrow();
});

scenario('TEST-1.2: PATH holds only the tools the World declares', world(), async ({ world }) => {
  // `type -P` searches PATH only, never a shell builtin such as `echo`.
  const lookup = async (name: string) => (await world.run('bash', ['-c', `type -P ${name} || true`])).stdout.trim();
  for (const name of [...Object.keys(REAL_TOOLS), 'tmux', 'ps', 'fleet', 'tb-session']) {
    expect(await lookup(name), name).toBe(join(world.bin, name));
  }
  for (const name of [...ABSENT_TOOLS, 'claude', 'codex', 'pi', 'curl', 'tb-jev']) {
    expect(await lookup(name), name).toBe('');
  }
  expect(readdirSync(world.bin).sort()).toEqual([...Object.keys(REAL_TOOLS), 'tmux', 'ps', 'fleet', 'tb-session'].sort());

  // Fleet looks on PATH alone, and no per-binary override sends it anywhere else.
  expect(world.env[FLEET_PATH_ONLY]).toBe('1');
  for (const name of ['FLEET_TMUX', 'FLEET_CMD', 'FLEET_GH', 'FLEET_NODE', 'FLEET_BIN']) expect(world.env[name], name).toBeUndefined();
  expect(JSON.parse(readFileSync(world.env.FLEET_CONFIG ?? '', 'utf8'))).toEqual({
    version: 1,
    naming: { enabled: false },
    grouping: { enabled: false },
    stacks: { enabled: false },
  });
  // Fleet finds no Harness, pi included: their launchers are the bare names, and none is on PATH.
  const harnesses = await world.run('fleet', ['--local', 'harness', 'list', '--json']);
  expect(harnesses.code, harnesses.stderr).toBe(0);
  const rows = JSON.parse(harnesses.stdout) as { id: string; installed: boolean; command: string }[];
  for (const id of ['claude', 'codex', 'pi']) {
    const row = rows.find((r) => r.id === id);
    expect(row?.installed, id).toBe(false);
    expect(row?.command, id).toBe(id);
  }
});

scenario("TEST-1.2: Fleet can't find a command the World leaves out, even one in /opt/homebrew/bin", world(), async ({ world }) => {
  // gh is in one of Fleet's fallback directories on this Mac, so only FLEET_PATH_ONLY keeps Fleet
  // from finding it there. ssh, security and osascript are in /usr/bin, which a pane's login shell
  // puts back on PATH (path_helper) unless the World's profile takes it out again.
  const kept = ['gh', ...ABSENT_TOOLS.filter((t) => t !== 'gh')];
  expect(existsSync('/opt/homebrew/bin/gh'), 'this test needs gh in /opt/homebrew/bin, where Fleet looks without FLEET_PATH_ONLY').toBe(true);
  const fleetBin = pinnedBin(loadPins().fleet);

  // The probe only looks a name up and never runs it: `FLEET_CMD=<name>` makes the name Claude
  // Code's launcher, and `harness list --no-models` says whether it resolves (Claude's row runs
  // nothing even with models). Were the switch to fail, no real gh, ssh, security or osascript
  // would run here with the user's keychain, tokens or ssh keys: the test would only fail.
  const probeArgs = ['--local', 'harness', 'list', '--json', '--no-models'];
  const claudeRow = (stdout: string) => (JSON.parse(stdout) as { id: string; installed: boolean; command: string }[]).find((r) => r.id === 'claude');

  // The probe can tell: the pinned Fleet without the switch finds /opt/homebrew/bin/gh.
  const control = await world.run('env', ['-u', FLEET_PATH_ONLY, 'FLEET_CMD=gh', fleetBin, ...probeArgs]);
  expect(control.code, control.stderr).toBe(0);
  expect(claudeRow(control.stdout)).toMatchObject({ command: 'gh', installed: true });

  // Through the World's `fleet`, also for a caller that drops the switch: the wrapper sets it.
  for (const name of kept) {
    const r = await world.run('env', ['-u', FLEET_PATH_ONLY, `FLEET_CMD=${name}`, 'fleet', ...probeArgs]);
    expect(r.code, `${name}: ${r.stderr}`).toBe(0);
    expect(claudeRow(r.stdout), name).toMatchObject({ command: name, installed: false });
  }

  // In a pane Fleet opens: tmux starts it with Fleet's PATH and the switch (`-e`), and it runs the
  // World's SHELL as a login shell. The pinned binary runs there directly, not through the
  // wrapper, so only the pane's own environment keeps it to PATH.
  const out = join(world.root, 'work', 'probe');
  mkdirSync(out);
  const opened = await world.run('fleet', ['--local', 'tmux', 'new', '-d', 'probe']);
  expect(opened.code, opened.stderr).toBe(0);
  const sessionEnv = (await world.tmux(['show-environment', '-t', 'probe'])).stdout.split('\n');
  expect(sessionEnv).toEqual(expect.arrayContaining([`PATH=${world.bin}`, `${FLEET_PATH_ONLY}=1`]));
  expect((await world.tmux(['show', '-gv', 'default-shell'])).stdout.trim()).toBe(world.env.SHELL);
  const script = [
    `for c in ${kept.join(' ')}; do FLEET_CMD=$c '${fleetBin}' ${probeArgs.join(' ')} > '${out}'/$c.json 2> '${out}'/$c.err; done`,
    `{ echo "argv0=$0"; echo "SHELL=$SHELL"; echo "${FLEET_PATH_ONLY}=$${FLEET_PATH_ONLY}"; echo "PATH=$PATH"; } > '${out}/env.txt'`,
    `echo done > '${out}/done'`,
  ].join('; ');
  expect((await world.tmux(['send-keys', '-t', 'probe', script, 'Enter'])).code).toBe(0);
  await world.waitUntil('the pane to run the probe', () => existsSync(join(out, 'done')));
  expect(readFileSync(join(out, 'env.txt'), 'utf8').trim().split('\n')).toEqual(['argv0=-sh', `SHELL=${world.env.SHELL}`, `${FLEET_PATH_ONLY}=1`, `PATH=${world.bin}`]);
  for (const name of kept) {
    expect(readFileSync(join(out, `${name}.err`), 'utf8'), name).toBe('');
    expect(claudeRow(readFileSync(join(out, `${name}.json`), 'utf8')), name).toMatchObject({ command: name, installed: false });
  }
});

scenario('TEST-1.2: a login shell in a World pane finds none of the tools the World keeps out', world(), async ({ world }) => {
  const absent = [...ABSENT_TOOLS, 'curl'];
  const probe = `echo "argv0=$0"; echo "HOME=$HOME"; echo "PATH=$PATH"; for t in ${absent.join(' ')}; do command -v "$t"; done; echo done`;

  // A pane's shell, as tmux starts it: a login shell, which reads /etc/profile and its path_helper.
  // Fake Harnesses will run here, so this is also what they see (TEST-1.1).
  const out = join(world.root, 'work', 'pane.txt');
  expect((await world.tmux(['new-session', '-d', '-s', 'probe', '-x', '160', '-y', '40'])).code).toBe(0);
  expect((await world.tmux(['send-keys', '-t', 'probe', `{ ${probe}; } > '${out}' 2>&1`, 'Enter'])).code).toBe(0);
  await world.waitUntil('the pane to run the probe', () => existsSync(out) && readFileSync(out, 'utf8').includes('done'));
  const pane = readFileSync(out, 'utf8').trim().split('\n');
  expect(pane[0]).toBe('argv0=-sh');
  expect(pane.slice(1)).toEqual([`HOME=${world.home}`, `PATH=${world.bin}`, 'done']);

  // An interactive login shell of the World's SHELL, as a spawned pane's `$SHELL -l` is. (Fleet no
  // longer asks one whether a launcher exists: under FLEET_PATH_ONLY, PATH alone decides.)
  const fleetStyle = await world.run(world.env.SHELL ?? '/bin/sh', ['-l', '-i', '-c', probe.replace('echo "argv0=$0"; ', '')]);
  expect(fleetStyle.stdout.trim().split('\n')).toEqual([`HOME=${world.home}`, `PATH=${world.bin}`, 'done']);
});

scenario('TEST-1.2: the guard names a real Harness running in the World', world(), async ({ world }) => {
  // Stand-ins, by the names Fleet and the guard go by: argv[0], or the script a `node` runs past
  // its own options. They are node, whose environment `ps -E` shows; their parent exits at once.
  const script = join(world.root, 'tmp', 'stand-in', 'pi');
  await mkdir(join(world.root, 'tmp', 'stand-in'), { recursive: true });
  await writeFile(script, 'setTimeout(() => {}, 30_000);\n');
  const wait = (n: number) => `-e 'setTimeout(()=>{},${n}000)'`;
  const started = await world.run('bash', [
    '-c',
    `(exec -a claude node ${wait(31)}) >/dev/null 2>&1 & (exec -a codex node ${wait(32)}) >/dev/null 2>&1 & node --no-warnings '${script}' >/dev/null 2>&1 &`,
  ]);
  expect(started.code).toBe(0);
  await world.waitUntil('three stand-ins to run', async () => (await world.guard()).length === 3);
  expect((await world.guard()).sort()).toEqual([
    expect.stringMatching(/^a real Harness runs in the World: pid \d+: claude -e setTimeout\(\(\)=>\{\},31000\)$/),
    expect.stringMatching(/^a real Harness runs in the World: pid \d+: codex -e setTimeout\(\(\)=>\{\},32000\)$/),
    expect.stringMatching(new RegExp(`^a real Harness runs in the World: pid \\d+: node --no-warnings ${esc(script)}$`)),
  ]);
  // Gone again, so the guard after the test passes.
  signalVerified((await world.processes()).filter((p) => /^(claude|codex) -e |^node --no-warnings .*\/pi$/.test(p.command)), 'SIGKILL');
  await world.waitUntil('the stand-ins to be gone', async () => (await world.guard()).length === 0);
});

test('TEST-1.2: the guard reads the script a node or bun runs past their own options', () => {
  expect(programOf('/opt/homebrew/bin/codex resume 42')).toBe('/opt/homebrew/bin/codex');
  expect(programOf('claude --resume x')).toBe('claude');
  expect(programOf('node /opt/homebrew/bin/codex')).toBe('/opt/homebrew/bin/codex');
  expect(programOf('node --no-warnings --max-old-space-size 4096 /x/pi --model y')).toBe('/x/pi');
  expect(programOf('node -r ts-node/register --import=tsx /x/claude')).toBe('/x/claude');
  expect(programOf('/usr/local/bin/bun --preload ./a.ts /x/codex')).toBe('/x/codex');
  expect(programOf('node -- /x/pi')).toBe('/x/pi');
  // No script: the runtime runs code from its arguments.
  expect(programOf('node -e setTimeout(()=>{},1) pi')).toBe('node');
  expect(programOf('node --eval=1 /x/pi')).toBe('node');
});

scenario('TEST-1.5: an empty World has no Sessions, no Harness, no History and no Jev', world(), async ({ page, world }) => {
  const sidebar = page.getByRole('complementary', { name: 'Session sidebar' });
  await world.step('the sidebar to say no Session is live', () => expect(sidebar.getByText('No live Sessions')).toBeVisible());
  await expect(sidebar.getByRole('option')).toHaveCount(0);
  // Nothing but what every World has: the default Start directory, Lookout's settings and the
  // login profile that keeps PATH the World's (TEST-1.2).
  expect(readdirSync(world.home).sort()).toEqual(['.config', '.profile', 'Projects']);
  expect(readdirSync(join(world.home, 'Projects'))).toEqual(['work']);
  expect(world.calls().some((c) => c.includes(' fleet --local list --json'))).toBe(true);
});

test('TEST-1.3: a binary that does not match its pin is refused, naming the pin and the command that gets it', async () => {
  const pins = loadPins();
  for (const pin of Object.values(pins)) {
    const ok = checkPin(pin);
    expect(ok.ok, ok.ok ? '' : ok.problem).toBe(true);
  }

  // A repo of its own, with a Fleet built from another commit in its .cache.
  const repo = await mkdtemp(join(tmpdir(), 'lookout-pins-'));
  try {
    const cache = join(repo, '.cache');
    const pin = pins.fleet;
    const root = installRoot(pin, cache);
    await mkdir(join(root, 'bin'), { recursive: true });
    await writeFile(join(root, 'bin', pin.bin), '#!/bin/sh\necho "fleet 0.1.0"\n');
    await chmod(join(root, 'bin', pin.bin), 0o755);
    const other = '0123456789abcdef0123456789abcdef01234567';
    await writeFile(join(root, '.crates2.json'), JSON.stringify({ installs: { [`fleet 0.1.0 (git+${pin.repo}?rev=${other}#${other})`]: {} } }));
    const wrong = checkPin(pin, cache, repo);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) {
      expect(wrong.problem).toContain(`built from 0123456, not the pinned ${pin.rev.slice(0, 7)}`);
      expect(wrong.problem).toContain(`${pin.repo} at ${pin.rev.slice(0, 7)}`);
      expect(wrong.problem).toContain('pnpm e2e:setup');
    }
    const missing = checkPin({ ...pins.tbSession }, cache, repo);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.problem).toMatch(/not installed.*pnpm e2e:setup/);
    // The run stops before its first test, naming both.
    const problems = preflight({ cache, repoRoot: repo });
    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining('built from 0123456'), expect.stringMatching(/tb-session: not installed/)]));

    // `--version` runs with a HOME of its own inside .cache/ and a PATH holding nothing, never the
    // user's (tb-session caches a lookup under ~/Library/Caches, and may run gh).
    await writeFile(join(root, 'bin', pin.bin), '#!/bin/sh\necho "fleet 0.4.0 home=$HOME path=$PATH cwd=$(pwd)"; command -v gh git curl ls; exit 0\n');
    await writeFile(join(root, '.crates2.json'), JSON.stringify({ installs: { [`fleet 0.4.0 (git+${pin.repo}?rev=${pin.rev}#${pin.rev})`]: {} } }));
    const scratch = checkPin(pin, cache, repo);
    expect(scratch.ok, scratch.ok ? '' : scratch.problem).toBe(true);
    const [, home = '', path = '', cwd = ''] = /home=(\S+) path=(\S+) cwd=(\S+)/.exec(scratch.ok ? scratch.version : '') ?? [];
    expect(home.startsWith(join(cache, 'pin-check-'))).toBe(true);
    expect(path).toBe(join(home, 'bin'));
    expect(cwd.endsWith(home.slice(home.lastIndexOf('/.cache/')))).toBe(true);
    // Nothing on that PATH: no gh, git or curl; and the scratch HOME is gone again.
    expect(scratch.ok && scratch.version.split('\n')).toHaveLength(1);
    expect(existsSync(home)).toBe(false);
    expect(readdirSync(cache).filter((n) => n.startsWith('pin-check-'))).toEqual([]);

    // Never the user's own binaries: no symlink on the way from the repo to the binary, and
    // nothing that resolves outside the repo.
    const elsewhere = await mkdtemp(join(tmpdir(), 'lookout-elsewhere-'));
    try {
      const cases: [string, (r: string) => void, RegExp][] = [
        ['.cache', (r) => symlinkSync(elsewhere, join(r, '.cache')), /\.cache is a symlink/],
        ['the install root', (r) => (mkdirSync(join(r, '.cache')), symlinkSync(elsewhere, installRoot(pin, join(r, '.cache')))), /fleet-[0-9a-f]{7} is a symlink/],
        ['bin/', (r) => (mkdirSync(installRoot(pin, join(r, '.cache')), { recursive: true }), symlinkSync(elsewhere, join(installRoot(pin, join(r, '.cache')), 'bin'))), /bin is a symlink/],
        [
          'the binary',
          (r) => {
            mkdirSync(join(installRoot(pin, join(r, '.cache')), 'bin'), { recursive: true });
            symlinkSync('/bin/echo', join(installRoot(pin, join(r, '.cache')), 'bin', pin.bin));
          },
          /fleet is a symlink/,
        ],
      ];
      for (const [what, make, problem] of cases) {
        const r = await mkdtemp(join(tmpdir(), 'lookout-repo-'));
        try {
          make(r);
          const check = checkPin(pin, join(r, '.cache'), r);
          expect(check.ok, what).toBe(false);
          if (!check.ok) expect(check.problem, what).toMatch(problem);
        } finally {
          await rm(r, { recursive: true, force: true });
        }
      }
      // A cache outside the repo, and creating one through a symlink.
      const outside = checkPin(pin, join(elsewhere, '.cache'), repo);
      expect(!outside.ok && outside.problem).toMatch(/is not inside the repo/);
      const linked = await mkdtemp(join(tmpdir(), 'lookout-repo-'));
      try {
        symlinkSync(elsewhere, join(linked, '.cache'));
        expect(() => assertInsideRepo(join(linked, '.cache', 'e2e', 'runs'), { create: true, repoRoot: linked })).toThrow(/is a symlink/);
        expect(existsSync(join(elsewhere, 'e2e'))).toBe(false);
      } finally {
        await rm(linked, { recursive: true, force: true });
      }
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

scenario('TEST-1.8: a stopped World kills what it owns, nothing else, and names what outlived it', world(), async ({ world: outer }) => {
  const inner = await startWorld(world().declaration(), { stopGraceMs: 500, label: 'TEST-1.8 (the inner World of a stopped World)' });
  const entryPath = join(runDir(), 'worlds', `${inner.id}.json`);
  // A developer reading the World's log: it names the World, but doesn't carry its token.
  const tail = spawn('/usr/bin/tail', ['-f', join(inner.logs, 'server.log')], { stdio: 'ignore' });
  // Arguments unique to this World, so parallel repeats of this test can't be mistaken for it.
  const tag = (n: number) => `3000.${parseInt(inner.id.slice(0, 5), 16)}${n}`;
  const idle = `setInterval(()=>{},1e9)`;
  const orphanCmd = `node -e ${idle} ${tag(1)}`;
  const stubbornCmd = `node -e process.on('SIGTERM',()=>{});process.on('SIGHUP',()=>{});${idle} ${tag(2)}`;
  const paneCmd = `/bin/sleep ${tag(3)}`;
  const escapedCmd = `lookout-escaped -e ${idle} ${tag(4)}`;
  let orphan: Proc | undefined;
  let stopped: StopReport | undefined;
  try {
    expect(existsSync(entryPath)).toBe(true);
    // A pane in its tmux that shrugs off the SIGHUP of `kill-server` and SIGTERM: /bin/sleep, whose
    // environment macOS hides from `ps -E`, the World's through its parent, the tmux server.
    expect((await inner.tmux(['new-session', '-d', '-s', 'pane', `trap '' HUP TERM; exec ${paneCmd}`])).code).toBe(0);
    expect((await inner.run('fleet', ['--local', 'list', '--json'])).code).toBe(0);
    // An orphan: its parent exits at once, and nothing on its command line names the World.
    expect((await inner.run('bash', ['-c', `node -e '${idle}' ${tag(1)} >/dev/null 2>&1 &`])).code).toBe(0);
    // A process that ignores SIGTERM and SIGHUP.
    expect((await inner.run('bash', ['-c', `node -e "process.on('SIGTERM',()=>{});process.on('SIGHUP',()=>{});${idle}" ${tag(2)} >/dev/null 2>&1 &`])).code).toBe(0);
    // A process that left the World's process tree: a session of its own, handed to launchd, with
    // nothing of the World on its command line.
    const daemon = `open STDOUT, ">/dev/null"; open STDERR, ">/dev/null"; exit 0 if fork; POSIX::setsid(); exec { "${REAL_TOOLS.node}" } "lookout-escaped", "-e", "${idle}", "${tag(4)}";`;
    expect((await inner.run('/usr/bin/perl', ['-MPOSIX', '-e', daemon])).code).toBe(0);
    let escaped: Proc | undefined;
    await outer.waitUntil('the orphan, the stubborn process, the pane and the escaped one to run', async () => {
      const mine = await inner.processes();
      orphan = mine.find((p) => p.command === orphanCmd && p.ppid === 1);
      escaped = mine.find((p) => p.command === escapedCmd && p.ppid === 1 && p.pgid === p.pid);
      return !!orphan && !!escaped && mine.some((p) => p.command === stubbornCmd) && mine.some((p) => p.command === paneCmd);
    });
    expect(await inner.guard()).toEqual([`escaped the World's process tree: pid ${escaped?.pid}: ${escapedCmd}`]);

    stopped = await inner.stop({ collect: true });
    const procs = await listProcesses();
    // Named and killed: the escaped one, and the two that needed SIGKILL.
    expect([...stopped.leftovers].sort()).toEqual([
      `escaped the World's process tree: pid ${escaped?.pid}: ${escapedCmd} (killed)`,
      expect.stringMatching(new RegExp(`^process pid \\d+: ${esc(paneCmd)} \\(needed SIGKILL\\)$`)),
      expect.stringMatching(new RegExp(`^process pid \\d+: ${esc(stubbornCmd)} \\(needed SIGKILL\\)$`)),
    ]);
    // The orphan was the World's by its environment, and is gone without being named.
    expect(orphan && alive(orphan, procs)).toBe(false);
    expect(procs.filter((p) => [orphanCmd, stubbornCmd, paneCmd, escapedCmd].includes(p.command))).toEqual([]);
    expect(await carrying(inner.worldToken)).toEqual([]);
    // The developer's tail is untouched.
    expect(tail.exitCode).toBeNull();
    expect(pidAlive(tail.pid ?? 0)).toBe(true);

    // TEST-2.4: what a failure report holds (Playwright adds the trace and the screenshot).
    expect(stopped.report?.panes).toMatch(/── pane:0\.0 \(%\d+, sleep\) ──/);
    expect(stopped.report?.serverLog).toContain('Lookout server on http://127.0.0.1:');
    expect(stopped.report?.calls).toMatch(/^\d\d:\d\d:\d\d fleet --local list --json$/m);
    expect(JSON.parse(stopped.report?.declaration ?? '{}')).toEqual(world().declaration());
    // Its directories go only once its processes are gone.
    expect(existsSync(inner.root)).toBe(false);
    expect(existsSync(inner.tmuxTmpdir)).toBe(false);
    expect(existsSync(entryPath)).toBe(false);
    // Stopping twice is harmless.
    expect((await inner.stop()).leftovers).toHaveLength(3);
  } catch (err) {
    // Whatever the inner World left is killed and named, so global teardown fails the run on it.
    const r = stopped ?? (await inner.stop());
    recordLeftovers('TEST-1.8 (the inner World of a stopped World)', r.leftovers);
    throw err;
  } finally {
    tail.kill('SIGKILL');
    // Anything still carrying the inner World's token (its escaped daemon, should teardown have
    // missed it) dies here, by pid and start time, and is named.
    const left = await carrying(inner.worldToken);
    signalVerified(left, 'SIGKILL');
    recordLeftovers('TEST-1.8 (the inner World of a stopped World)', left.map((p) => `process pid ${p.pid}: ${p.command} (killed after the test)`));
  }
});

test('TEST-1.8: a World whose start is interrupted leaves nothing behind', async () => {
  const cancel = new AbortController();
  let entry: WorldEntry | undefined;
  // In this run's own directory, which goes with the run even when this test is interrupted.
  const pauseFile = join(runDir(), `pause-${randomBytes(4).toString('hex')}`);
  const starting = startWorld(world().declaration(), { signal: cancel.signal, onEntry: (e) => (entry = e), pauseFile });
  starting.then((w) => w.stop()).catch(() => {});
  try {
    // Interrupted while it is still starting, with its tmux server and Lookout server up.
    await expect.poll(() => existsSync(pauseFile), { timeout: 10_000 }).toBe(true);
  } finally {
    await rm(pauseFile, { force: true });
  }
  const mine = await carrying(entry?.token ?? '');
  expect(mine.some((p) => p.command.includes(' -L lookout-world-'))).toBe(true);
  expect(mine.some((p) => p.command.includes('/server/main.ts'))).toBe(true);
  cancel.abort(new Error('interrupted while starting'));
  await expect(starting).rejects.toThrow('interrupted while starting');

  const procs = await listProcesses();
  for (const p of mine) expect(alive(p, procs), p.command).toBe(false);
  expect(await carrying(entry?.token ?? '')).toEqual([]);
  expect(existsSync(entry?.root ?? '')).toBe(false);
  expect(existsSync(entry?.tmuxTmpdir ?? '')).toBe(false);
  expect(worldEntries(runDir()).some((e) => e.endsWith(`/${entry?.id}.json`))).toBe(false);
});

test("TEST-1.8: global setup sweeps an interrupted run's Worlds by their token, and nothing else", async () => {
  const cache = await mkdtemp(join(tmpdir(), 'lookout-sweep-'));
  const id = randomBytes(4).toString('hex');
  const token = `${id}.${randomBytes(12).toString('hex')}`;
  const { root, tmuxTmpdir } = worldDirs(id);
  const tag = `304.${parseInt(id.slice(0, 5), 16)}`;
  const env = (extra: Record<string, string> = {}) => ({ PATH: '/usr/bin:/bin', ...extra });
  // The World's: a node carrying its token, and the /bin/sleep it started, whose environment macOS
  // hides (the World's through its parent).
  const mine = spawn(process.execPath, ['-e', `require('child_process').spawn('/bin/sleep', ['${tag}1'], { stdio: 'inherit' }); setInterval(() => {}, 1e9)`, `${tag}0`], {
    detached: true,
    stdio: 'ignore',
    env: env({ [WORLD_ID_ENV]: token }),
  });
  // Not the World's: another World's token, none at all, and one whose arguments spell out the
  // World's token (`ps -E` prints arguments and environment on one line).
  const strangers = [
    spawn('/bin/sleep', [`${tag}2`], { detached: true, stdio: 'ignore', env: env({ [WORLD_ID_ENV]: `${token}x` }) }),
    spawn('/bin/sleep', [`${tag}3`], { detached: true, stdio: 'ignore', env: env() }),
    spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)', `${WORLD_ID_ENV}=${token}`], { detached: true, stdio: 'ignore', env: env({ [WORLD_ID_ENV]: 'someone-else' }) }),
  ];
  try {
    // A run whose runner is gone, with a World that never got torn down…
    const dead = join(cache, 'runs', 'interrupted');
    mkdirSync(join(dead, 'worlds'), { recursive: true });
    const exited = spawnSync('/usr/bin/true').pid;
    writeFileSync(join(dead, 'run.json'), JSON.stringify({ pid: exited, startMs: 0 }));
    mkdirSync(root);
    mkdirSync(tmuxTmpdir);
    const entry: WorldEntry = { id, token, root, tmuxTmpdir, createdAt: Date.now() - 5000, label: 'an interrupted test', owns: ['root', 'tmuxTmpdir'] };
    writeFileSync(join(dead, 'worlds', `${id}.json`), JSON.stringify(entry));
    // …and one whose directories don't look like a World's own: they are never removed.
    const precious = join(cache, 'precious');
    mkdirSync(precious);
    writeFileSync(join(dead, 'worlds', 'odd.json'), JSON.stringify({ ...entry, id: 'odd', token: `${token}-odd`, root: precious, tmuxTmpdir: cache }));
    // A run still going (this process is its runner) is left alone.
    const live = createRunDir(cache, { repoRoot: cache });
    writeFileSync(join(live, 'worlds', 'going.json'), JSON.stringify({ ...entry, id: 'going' }));
    await expect.poll(async () => (await carrying(token)).map((p) => p.command).sort()).toEqual([`${process.execPath} -e ${mine.spawnargs[2]} ${tag}0`, `/bin/sleep ${tag}1`].sort());

    const gone = new Promise((resolve) => mine.once('exit', resolve));
    const swept = sweepDeadRuns(cache, { graceMs: 500, repoRoot: cache });
    await gone;
    const found = swept.get(join(dead, 'worlds', `${id}.json`)) ?? [];
    expect(found).toHaveLength(4);
    expect(found).toEqual(
      expect.arrayContaining([
        `directory ${root}`,
        `directory ${tmuxTmpdir}`,
        expect.stringMatching(new RegExp(`^process pid ${mine.pid}: ${esc(process.execPath)} -e `)),
        expect.stringMatching(new RegExp(`^process pid \\d+: /bin/sleep ${esc(tag)}1$`)),
      ]),
    );
    expect(swept.get(join(dead, 'worlds', 'odd.json'))).toEqual([
      `directory ${precious} not removed: a World's own are lookout-world-<id> in ${tmpdir()} and /tmp/lw-<id>`,
      `directory ${cache} not removed: a World's own are lookout-world-<id> in ${tmpdir()} and /tmp/lw-<id>`,
    ]);
    expect(existsSync(precious)).toBe(true);
    expect(await carrying(token)).toEqual([]);
    for (const s of strangers) expect(pidAlive(s.pid ?? 0), s.spawnargs.join(' ')).toBe(true);
    expect(existsSync(root) || existsSync(tmuxTmpdir)).toBe(false);
    expect(existsSync(join(dead, 'worlds', `${id}.json`))).toBe(false);
    expect(existsSync(join(live, 'worlds', 'going.json'))).toBe(true);
  } finally {
    // The World's first, while its /bin/sleep is still found through its parent; then the strangers.
    signalVerified(await carrying(token), 'SIGKILL');
    for (const p of [mine, ...strangers]) p.kill('SIGKILL');
    await rm(cache, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
    await rm(tmuxTmpdir, { recursive: true, force: true });
  }
});

test('TEST-1.8: a sweep follows no symlink on its way to the runs, and removes nothing outside them', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'lookout-sweep-link-'));
  try {
    // Outside the repo: what a symlinked `.cache`, `e2e`, `runs`, run or `worlds/` would lead to.
    // A directory without run metadata looks like a dead run; an old `.new-` one like a run never
    // renamed into place; an unreadable `.json` like a broken index entry. Each would be removed.
    const outside = join(scratch, 'outside');
    const sentinels = [join(outside, 'precious', 'keep.txt'), join(outside, '.new-old', 'keep.txt'), join(outside, 'cache', 'e2e', 'runs', 'precious', 'keep.txt'), join(outside, 'junk.json')];
    for (const f of sentinels) {
      mkdirSync(join(f, '..'), { recursive: true });
      writeFileSync(f, 'keep');
    }
    utimesSync(join(outside, '.new-old'), new Date(0), new Date(0));
    const survives = () => {
      for (const f of sentinels) expect(readFileSync(f, 'utf8'), f).toBe('keep');
    };
    const sweepIn = (repo: string) => sweepDeadRuns(join(repo, '.cache', 'e2e'), { graceMs: 100, repoRoot: repo });

    // A link anywhere on the way from the repo to runs/: the sweep refuses before reading it.
    let n = 0;
    const linkTo = { runs: outside, e2e: join(outside, 'cache', 'e2e'), '.cache': join(outside, 'cache') };
    const repoWith = (link: keyof typeof linkTo) => {
      const repo = join(scratch, `repo-${n++}`);
      const parts = ['.cache', 'e2e', 'runs'];
      const upTo = parts.slice(0, parts.indexOf(link) + 1);
      mkdirSync(join(repo, ...upTo.slice(0, -1)), { recursive: true });
      symlinkSync(linkTo[link], join(repo, ...upTo));
      return repo;
    };
    for (const link of ['runs', 'e2e', '.cache'] as const) {
      const repo = repoWith(link);
      expect(() => sweepIn(repo), link).toThrow(new RegExp(`Won't sweep .*\\n.*${esc(link)} is a symlink`));
      // Nor does this run make its directory there.
      expect(() => createRunDir(join(repo, '.cache', 'e2e'), { repoRoot: repo }), link).toThrow(/is a symlink/);
      survives();
    }

    // Plain runs/, but a run in it that is a symlink, and a dead run whose worlds/ is one.
    const repo = join(scratch, 'repo-plain');
    const runs = join(repo, '.cache', 'e2e', 'runs');
    mkdirSync(join(runs, 'dead'), { recursive: true });
    writeFileSync(join(runs, 'dead', 'run.json'), JSON.stringify({ pid: spawnSync('/usr/bin/true').pid, startMs: 0 }));
    symlinkSync(outside, join(runs, 'dead', 'worlds'));
    symlinkSync(join(outside, 'precious'), join(runs, 'linked'));
    symlinkSync(join(outside, '.new-old'), join(runs, '.new-linked'));
    const swept = sweepIn(repo);
    expect(swept.get(join(runs, 'dead'))).toEqual([`${join(runs, 'dead')} not swept: it or its worlds/ is not a plain directory`]);
    survives();
    // The links themselves are left alone too.
    expect(readdirSync(runs).sort()).toEqual(['.new-linked', 'dead', 'linked']);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("TEST-1.8: a World reserves its directories exclusively, and takes another id when one is already there", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lookout-reserve-'));
  mkdirSync(join(dir, 'worlds'));
  const fresh = () => randomBytes(4).toString('hex');
  const taken = [fresh(), fresh(), fresh()];
  const dirs = taken.map(worldDirs);
  const strangers = [join(dirs[0]?.root ?? '', 'keep.txt'), join(dirs[1]?.tmuxTmpdir ?? '', 'keep.txt')];
  const made: string[] = [];
  try {
    // Someone else's root for the first id, someone else's TMUX_TMPDIR for the second, and an
    // index entry already there for the third.
    for (const f of strangers) {
      mkdirSync(join(f, '..'));
      writeFileSync(f, 'keep');
    }
    writeFileSync(join(dir, 'worlds', `${taken[2]}.json`), 'someone else\'s');
    const ids = [...taken, fresh()];
    const { entry, entryPath } = reserveWorld('reserve', { dir, nextId: () => ids.shift() ?? fresh() });
    made.push(entry.root, entry.tmuxTmpdir);
    expect(taken).not.toContain(entry.id);
    expect(entry.owns).toEqual(['root', 'tmuxTmpdir']);
    expect(readEntry(entryPath)).toEqual(entry);
    expect(statSync(entry.tmuxTmpdir).mode & 0o777).toBe(0o700);
    // What it made for an id it then gave up on is gone again; what was there before is not.
    for (const f of strangers) expect(readFileSync(f, 'utf8')).toBe('keep');
    expect(existsSync(dirs[1]?.root ?? '')).toBe(false);
    expect(readFileSync(join(dir, 'worlds', `${taken[2]}.json`), 'utf8')).toBe("someone else's");
    expect(worldEntries(dir).map((e) => e.slice(e.lastIndexOf('/') + 1)).sort()).toEqual([`${entry.id}.json`, `${taken[2]}.json`].sort());
    expect(() => reserveWorld('reserve', { dir, nextId: () => taken[0] ?? '', attempts: 2 })).toThrow(/No free World id/);

    // A sweep removes only what an entry says the World made: a directory it didn't make stays.
    const unowned: WorldEntry = { ...entry, id: taken[0] ?? '', ...dirs[0], token: `${entry.token}-unowned`, owns: ['tmuxTmpdir'] };
    const unownedPath = join(dir, 'worlds', 'unowned.json');
    writeFileSync(unownedPath, JSON.stringify(unowned));
    expect(sweepWorld(unownedPath, { graceMs: 100 })).toEqual([`directory ${dirs[0]?.root} not removed: it was there before the World, so it isn't the World's`]);
    expect(readFileSync(strangers[0] ?? '', 'utf8')).toBe('keep');
    expect(sweepWorld(entryPath, { graceMs: 100 })).toEqual([`directory ${entry.root}`, `directory ${entry.tmuxTmpdir}`]);
    expect(existsSync(entry.root) || existsSync(entry.tmuxTmpdir) || existsSync(entryPath)).toBe(false);
  } finally {
    for (const d of [...made, ...dirs.flatMap((d) => [d.root, d.tmuxTmpdir])]) await rm(d, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});

test("TEST-1.8: a World whose directories are already there starts on another id, and leaves them and their tmux server alone", async () => {
  const fresh = () => randomBytes(4).toString('hex');
  const [rootTaken = '', tmuxTaken = ''] = [fresh(), fresh()];
  const theirRoot = worldDirs(rootTaken);
  const theirTmux = worldDirs(tmuxTaken);
  // Someone else's root under the first id; under the second, someone else's TMUX_TMPDIR with a
  // tmux server on the very socket the World would use.
  const sentinels = [join(theirRoot.root, 'keep.txt'), join(theirTmux.tmuxTmpdir, 'keep.txt')];
  const uid = process.getuid?.() ?? 0;
  const theirSocket = join(theirTmux.tmuxTmpdir, `tmux-${uid}`, `lookout-world-${tmuxTaken}`);
  const theirTmuxCall = (args: string[]) => spawnSync(realTmux(), ['-S', theirSocket, '-f', '/dev/null', ...args], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
  try {
    for (const f of sentinels) {
      mkdirSync(join(f, '..'));
      writeFileSync(f, 'keep');
    }
    mkdirSync(join(theirSocket, '..'), { mode: 0o700 });
    expect(theirTmuxCall(['new-session', '-d', '-s', 'theirs', '/bin/sleep', '120']).status).toBe(0);

    for (const taken of [rootTaken, tmuxTaken]) {
      const ids = [taken, fresh()];
      const started = await startWorld(world().declaration(), { nextId: () => ids.shift() ?? fresh(), stopGraceMs: 500, label: 'TEST-1.8 (a World whose directories are taken)' }).catch(
        (e: unknown) => e as Error,
      );
      const stopped = started instanceof Error ? null : await started.stop();
      // Whether it started or not: what was there before it is untouched.
      for (const f of sentinels) expect(existsSync(f) && readFileSync(f, 'utf8'), f).toBe('keep');
      expect(theirTmuxCall(['has-session', '-t', 'theirs']).status, 'their tmux server').toBe(0);
      if (started instanceof Error) throw started;
      expect(started.id).not.toBe(taken);
      expect(stopped?.leftovers).toEqual([]);
      expect(existsSync(started.root) || existsSync(started.tmuxTmpdir)).toBe(false);
    }
    // The root the World made for the id whose TMUX_TMPDIR was taken is gone again.
    expect(existsSync(theirTmux.root)).toBe(false);
  } finally {
    if (existsSync(theirSocket)) theirTmuxCall(['kill-server']);
    // Should its socket have been removed under it, the server this test started still goes.
    signalVerified((await listProcesses()).filter((p) => p.command.includes(` -S ${theirSocket} `)), 'SIGKILL');
    for (const d of [theirRoot.root, theirRoot.tmuxTmpdir, theirTmux.root, theirTmux.tmuxTmpdir]) await rm(d, { recursive: true, force: true });
  }
});

test("TEST-1.8: a stranger that reuses a World's former process group or pid is never the World's", async () => {
  const token = 'cafe0001.0123456789abcdef01234567';
  const createdAt = Date.UTC(2026, 9, 19, 10, 0, 0);
  const at = (s: number) => createdAt + s * 1000;
  // Pids no machine hands out (macOS stops at 99998), so the table can't touch this process's own.
  const proc = (pid: number, o: Partial<Proc> = {}): Proc => ({ pid, ppid: 1, pgid: pid, startMs: at(1), zombie: false, command: `stand-in ${pid}`, worldIds: [], ...o });
  // Seen as the World's before: a process that led its own group (900100), and one in a pane (900200).
  const known = [
    { pid: 900100, startMs: at(1) },
    { pid: 900200, startMs: at(2) },
  ];
  const table = [
    // Still the World's: it carries the token, and what it started.
    proc(900300, { startMs: at(3), worldIds: [token] }),
    proc(900301, { ppid: 900300, pgid: 900300, startMs: at(4) }),
    // A reused former group: 900100 exited with its group, and its pid now leads a stranger's
    // group of the same id, with a child and a member that isn't its child.
    proc(900100, { startMs: at(60) }),
    proc(900101, { ppid: 900100, pgid: 900100, startMs: at(61) }),
    proc(900102, { ppid: 1, pgid: 900100, startMs: at(62) }),
    // A recorded pid whose start time changed: someone else's now, with what it started.
    proc(900200, { pgid: 900250, startMs: at(90) }),
    proc(900201, { ppid: 900200, pgid: 900250, startMs: at(91) }),
    proc(900250, { ppid: 1, startMs: at(89) }),
  ];
  const pids = (procs: readonly Proc[]) => procs.map((p) => p.pid).sort();
  expect(pids(ownedProcesses(table, token, { known, notBefore: createdAt }))).toEqual([900300, 900301]);
  // The same identities, still running with the start times they were seen with, stay the World's.
  const same = [proc(900100, { startMs: at(1) }), proc(900110, { ppid: 900100, pgid: 900100, startMs: at(5) }), proc(900200, { startMs: at(2) })];
  expect(pids(ownedProcesses(same, token, { known, notBefore: createdAt }))).toEqual([900100, 900110, 900200]);

  // A pid that is someone else's by the time the signal goes out: its start time is read again,
  // and it isn't signalled. Only with the start time it really has is it.
  const stranger = spawn('/bin/sleep', ['30'], { detached: true, stdio: 'ignore', env: { PATH: '/usr/bin:/bin' } });
  try {
    let seen: Proc | undefined;
    await expect.poll(async () => (seen = (await listProcesses()).find((p) => p.pid === stranger.pid)) !== undefined).toBe(true);
    if (!seen) throw new Error('the stand-in is not listed');
    expect(signalVerified([{ ...seen, startMs: seen.startMs - 60_000 }], 'SIGKILL')).toEqual([]);
    expect(pidAlive(seen.pid)).toBe(true);
    const gone = new Promise((resolve) => stranger.once('exit', resolve));
    expect(signalVerified([seen], 'SIGKILL')).toEqual([seen.pid]);
    await gone;
  } finally {
    stranger.kill('SIGKILL');
  }
});

scenario(
  'TEST-1.9: nothing in a World reaches the default tmux socket or the user\'s Sessions',
  world(),
  async ({ page, world }) => {
    // Lookout lists through the real Fleet…
    await world.step('Lookout to list Sessions through Fleet', () =>
      expect(page.getByRole('complementary', { name: 'Session sidebar' }).getByText('No live Sessions')).toBeVisible(),
    );
    // …and Fleet starts, lists and closes a tmux session, all on the private server.
    const fleet = (...args: string[]) => world.run('fleet', ['--local', ...args]);
    const created = await fleet('tmux', 'new', '-d', 'guard', '--', '/bin/sleep', '60');
    expect(created.code, created.stderr).toBe(0);
    const listed = await world.tmux(['list-sessions', '-F', '#{session_name}']);
    expect(listed.stdout.split('\n')).toContain('guard');
    const killed = await fleet('tmux', 'kill', 'guard', '-f');
    expect(killed.code, killed.stderr).toBe(0);
    expect((await world.tmux(['list-sessions', '-F', '#{session_name}'])).stdout).not.toContain('guard');
    // TODO(TEST-1.9 with TEST-1.4): start and close a Session through Lookout with a Fake Harness.

    const uid = statSync(world.tmuxTmpdir).uid;
    expect(existsSync(join(world.tmuxTmpdir, `tmux-${uid}`, world.socket))).toBe(true);
    expect(world.trapKnocks).toBe(0);
    // No real registry or Transcript leaked in.
    expect(JSON.parse((await fleet('list', '--json')).stdout)).toEqual([]);
  },
);

scenario('TEST-2.1: a Behaviour test drives the built Lookout in headless Chromium at 1440×900', world(), async ({ page, world }) => {
  expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
  expect(await page.evaluate(() => navigator.userAgent)).toContain('HeadlessChrome');
  expect(world.env.NODE_ENV).toBe('production');
  // The page is dist/web, served by the World's own server (in development it serves no page).
  const html = await (await page.request.get(world.url)).text();
  expect(html).toMatch(/<script type="module" crossorigin src="\/assets\/[^"]+\.js">/);
});

test('TEST-2.1: pnpm e2e passes options with their values, and matches criterion ids in any case', () => {
  expect(parseRunArgs(['--workers', '1', 'side-6.1'])).toEqual({ options: ['--workers', '1'], words: ['side-6.1'], grep: '/side-6\\.1/i' });
  expect(parseRunArgs(['--repeat-each', '5', '-x', 'usage', '--reporter=line'])).toEqual({
    options: ['--repeat-each', '5', '-x', '--reporter=line'],
    words: ['usage'],
    grep: '/usage/i',
  });
  expect(parseRunArgs(['-j', '2', '--debug', 'cli', 'world']).options).toEqual(['-j', '2', '--debug', 'cli']);
  expect(parseRunArgs(['--debug', 'world']).words).toEqual(['world']);
  expect(parseRunArgs(['--', '--odd']).words).toEqual(['--odd']);
  expect(parseRunArgs(['--list']).grep).toBeNull();
  // `--only-changed [ref]`: the next word is its ref only when git knows it as a commit.
  const isRef = (w: string) => ['main', 'HEAD~1'].includes(w);
  expect(parseRunArgs(['--only-changed', 'main', 'usage'], { isRef })).toMatchObject({ options: ['--only-changed', 'main'], words: ['usage'] });
  expect(parseRunArgs(['--only-changed', 'usage'], { isRef })).toMatchObject({ options: ['--only-changed'], words: ['usage'] });
  expect(parseRunArgs(['--only-changed', '--workers', '1'], { isRef })).toMatchObject({ options: ['--only-changed', '--workers', '1'], words: [] });
  expect(parseRunArgs(['--only-changed', 'HEAD'])).toMatchObject({ options: ['--only-changed', 'HEAD'], words: [] });
  expect(parseRunArgs(['--only-changed', 'side-6.1'])).toMatchObject({ options: ['--only-changed'], words: ['side-6.1'] });
  // Playwright reads `/…/i` as a regular expression with its flags.
  const grep = parseRunArgs(['side-6.1', 'TEST-1.8']).grep ?? '';
  const [, body = '', flags = ''] = /^\/(.*)\/([gi]*)$/.exec(grep) ?? [];
  const re = new RegExp(body, flags);
  expect(re.test('SIDE-6.1: without Fleet')).toBe(true);
  expect(re.test('test-1.8: a stopped World')).toBe(true);
  expect(re.test('SIDE-641: the dot is a dot')).toBe(false);
});

test('TEST-2.1: a second pnpm e2e in the same checkout waits for the first, and names it when it gives up', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lookout-lock-'));
  const lock = join(dir, 'run.lock');
  try {
    const release = await acquireRunLock(lock, { waitMs: 0 });
    // Held by a live run (this process): the second one waits, then fails naming it.
    const waited: number[] = [];
    await expect(acquireRunLock(lock, { waitMs: 300, pollMs: 50, onWait: (h) => waited.push(h.pid) })).rejects.toThrow(
      new RegExp(`^Another \`pnpm e2e\` \\(pid ${process.pid}\\) runs in this checkout`),
    );
    expect(waited).toEqual([process.pid]);
    // It goes on as soon as the first one is done.
    setTimeout(release, 200);
    const second = await acquireRunLock(lock, { waitMs: 5000, pollMs: 50 });
    expect(JSON.parse(readFileSync(lock, 'utf8'))).toMatchObject({ pid: process.pid });
    second();
    expect(existsSync(lock)).toBe(false);
    // A lock left by a run that is gone is taken over at once.
    writeFileSync(lock, JSON.stringify({ pid: spawnSync('/usr/bin/true').pid, startMs: 0 }));
    (await acquireRunLock(lock, { waitMs: 0 }))();
    expect(existsSync(lock)).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('TEST-2.2: a Behaviour test title starts with its criterion id', () => {
  expect(() => checkTitle('SIDE-6.1: Fleet missing')).not.toThrow();
  expect(() => checkTitle('TEST-1.10: processes outside')).not.toThrow();
  for (const bad of ['Fleet missing', 'SIDE-6.1 Fleet missing', 'side-6.1: lower case', 'UTF-8 names']) {
    expect(() => checkTitle(bad), bad).toThrow(/starts with its criterion id/);
  }
});

test('TEST-2.6: a Behaviour test that runs past its budget fails, naming what it was waiting for', async () => {
  const waits = new Waits();
  const late = await withinBudget(300, waits, () => waits.step('a Session called nope to appear', () => new Promise<never>(() => {}))).catch((e: unknown) => e);
  expect(late).toBeInstanceOf(BudgetExceeded);
  expect((late as Error).message).toBe('The Behaviour test ran past 300 ms, waiting for a Session called nope to appear.');

  const fresh = new Waits();
  const unnamed = await withinBudget(100, fresh, () => new Promise<never>(() => {})).catch((e: Error) => e.message);
  expect(unnamed).toMatch(/ran past 100 ms, without naming what it waited for/);

  const polled = await fresh.waitUntil('the sidebar to list 3 Sessions', () => false, { timeoutMs: 200, intervalMs: 50 }).catch((e: Error) => e.message);
  expect(polled).toBe('Timed out after 200 ms waiting for the sidebar to list 3 Sessions.');

  // Time spent where no timer can fire still counts.
  const busy = new Waits();
  const blocked = await withinBudget(100, busy, () =>
    busy.step('the sidebar to render', async () => {
      const until = performance.now() + 150;
      while (performance.now() < until) {
        // a synchronous stretch
      }
    }),
  ).catch((e: unknown) => e);
  expect(blocked).toBeInstanceOf(BudgetExceeded);
  expect((blocked as Error).message).toBe('The Behaviour test ran past 100 ms, after waiting for the sidebar to render.');

  // A scenario may shorten its budget, never lengthen it.
  expect(() => checkBudget(30_000)).not.toThrow();
  expect(() => checkBudget(30_001)).toThrow(/can only be shortened/);
  expect(() => scenario('TEST-2.6: longer', world(), async () => {}, { budgetMs: 60_000 })).toThrow(/can only be shortened/);
});

test('TEST-2.6: a scenario past its budget fails naming its wait, with Lookout open', async ({ page, world: w }) => {
  const late = await runScenario(1500, { page, world: w }, ({ world }) =>
    world.step('a Session called nope to appear', () => new Promise<never>(() => {})),
  ).catch((e: unknown) => e);
  expect(late).toBeInstanceOf(BudgetExceeded);
  expect((late as Error).message).toBe('The Behaviour test ran past 1.5 s, waiting for a Session called nope to appear.');
  expect(page.url()).toBe(w.url);
});
