import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '../../world/index.ts';
import { REPO_ROOT } from '../../world/pins.ts';
import { kill, listProcesses, ownedProcesses, signalVerified } from '../../world/processes.ts';
import { type WorldEntry, readEntry, readLeftovers, runDir, sweepWorld } from '../../world/registry.ts';

/**
 * The World's own tests that need a whole run: each starts Playwright on e2e/selftest/ the way
 * `pnpm e2e` does, interrupts it or lets it time out, and checks what was left and what was named
 * (TEST-1.5, TEST-1.7, TEST-1.8, TEST-2.2, TEST-2.6). Each of the three mechanisms that clean up after an interrupted
 * start has a test that fails without it: the fixture's SIGINT handler, the worker's exit sweep,
 * and the next run's global-setup sweep.
 */

const CLI = join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const CONFIG = join(REPO_ROOT, 'e2e', 'selftest', 'playwright.config.ts');

interface InnerRun {
  child: ChildProcess;
  /** stdout and stderr so far. */
  output: () => string;
  exited: Promise<number | null>;
  /** The JSON report, once the run is over (when it got to write one). */
  report: () => JsonReport | null;
}

interface JsonResult {
  status: string;
  errors: { message?: string }[];
}
interface JsonSpec {
  title: string;
  tests: { results: JsonResult[] }[];
}
interface JsonSuite {
  specs?: JsonSpec[];
  suites?: JsonSuite[];
}
interface JsonReport {
  suites: JsonSuite[];
  errors: { message?: string }[];
}

/** The environment of a run started from inside a worker: none of this run's own variables. */
function innerEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || /^(TEST_|PW_|PLAYWRIGHT_|LOOKOUT_E2E_|LOOKOUT_WORLD_ID$|FORCE_COLOR$|DEBUG_COLORS$)/.test(k)) continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

/**
 * A scratch directory inside this run's own directory under `.cache/e2e/runs/`: global teardown
 * removes it with the run, and if this run is killed the next run's global setup does.
 */
async function scratch(): Promise<string> {
  const base = join(runDir(), 'selftest');
  await mkdir(base, { recursive: true });
  return mkdtemp(join(base, 'run-'));
}

/** Runs this worker started that haven't ended. Ctrl-C reaches only this run's own group, so they get it from here. */
const live = new Set<ChildProcess>();
const forward = () => {
  for (const c of live) if (c.pid !== undefined && c.exitCode === null && c.signalCode === null) kill(-c.pid, 'SIGINT');
};
process.on('SIGINT', forward);
process.on('SIGTERM', forward);
process.on('exit', forward);

/** Starts a run of `file` (in e2e/selftest/) in a process group of its own, as a terminal would. */
async function startRun(file: string, extra: Record<string, string> = {}, args: readonly string[] = []): Promise<InnerRun & { dir: string }> {
  const dir = await scratch();
  const env = innerEnv({ LOOKOUT_SELFTEST_OUTPUT: join(dir, 'results'), PLAYWRIGHT_JSON_OUTPUT_NAME: join(dir, 'report.json'), ...extra });
  const child = spawn(process.execPath, [CLI, 'test', '-c', CONFIG, file, ...args], { cwd: REPO_ROOT, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  live.add(child);
  let out = '';
  child.stdout?.on('data', (b: Buffer) => (out += b.toString('utf8')));
  child.stderr?.on('data', (b: Buffer) => (out += b.toString('utf8')));
  const exited = new Promise<number | null>((resolve) =>
    child.once('close', (code) => {
      live.delete(child);
      resolve(code);
    }),
  );
  return {
    child,
    dir,
    output: () => out,
    exited,
    report: () => {
      try {
        return JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as JsonReport;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Ends a run this test started, runner and workers: its process group, while the test still
 * holds its leader (the run's own Worlds live in groups of their own and are left to the checks).
 */
function stopGroup(run: InnerRun): void {
  if (run.child.pid !== undefined && run.child.exitCode === null && run.child.signalCode === null) kill(-run.child.pid, 'SIGKILL');
}

/** Waits for `run` to end, killing its whole group if it takes longer than `ms`. */
async function finish(run: InnerRun, ms: number): Promise<number | null> {
  const late = setTimeout(() => stopGroup(run), ms);
  try {
    return await run.exited;
  } finally {
    clearTimeout(late);
  }
}

/** Each test of a report by title: its last result's status and error messages. */
function results(report: JsonReport | null): Map<string, { status: string; errors: string }> {
  const byTitle = new Map<string, { status: string; errors: string }>();
  const walk = (s: JsonSuite) => {
    for (const spec of s.specs ?? []) {
      const r = spec.tests[0]?.results.at(-1);
      byTitle.set(spec.title, { status: r?.status ?? 'none', errors: (r?.errors ?? []).map((e) => e.message ?? '').join('\n') });
    }
    for (const c of s.suites ?? []) walk(c);
  };
  for (const s of report?.suites ?? []) walk(s);
  return byTitle;
}

/** Waits for the paused World's index entry: written once all of it has started. */
async function pausedEntry(run: InnerRun, pauseFile: string): Promise<{ path: string; entry: WorldEntry }> {
  await expect.poll(() => existsSync(pauseFile) || run.child.exitCode !== null, { timeout: 20_000 }).toBe(true);
  expect(existsSync(pauseFile), run.output()).toBe(true);
  const path = readFileSync(pauseFile, 'utf8');
  const entry = readEntry(path);
  if (!entry) throw new Error(`No World entry at ${path}`);
  return { path, entry };
}

const carrying = async (token: string) => ownedProcesses(await listProcesses(), token);

/** What's left of a World: its processes, directories and index entry. */
async function remains(entryPath: string, entry: WorldEntry): Promise<string[]> {
  return [
    ...(await carrying(entry.token)).map((p) => `process ${p.pid}: ${p.command}`),
    ...[entry.root, entry.tmuxTmpdir, entryPath].filter((p) => existsSync(p)),
  ];
}

/** Whatever a failed check left of the World goes, so the next tests start clean. */
async function cleanUp(entryPath: string | undefined, entry: WorldEntry | undefined): Promise<void> {
  if (entryPath && existsSync(entryPath)) sweepWorld(entryPath, { graceMs: 500 });
  if (entry) {
    signalVerified(await carrying(entry.token), 'SIGKILL');
    for (const dir of [entry.root, entry.tmuxTmpdir]) await rm(dir, { recursive: true, force: true });
  }
}

test("TEST-1.8: a SIGINT while a World starts: the worker tears it down itself, and nothing is named", async () => {
  const pauses = await scratch();
  const pauseFile = join(pauses, 'paused');
  const run = await startRun('interrupt.selftest.ts', { LOOKOUT_SELFTEST_PAUSE_FILE: pauseFile });
  let paused: { path: string; entry: WorldEntry } | undefined;
  try {
    paused = await pausedEntry(run, pauseFile);
    expect((await carrying(paused.entry.token)).length).toBeGreaterThan(1);
    // Ctrl-C in a terminal: the whole foreground group, runner and workers.
    kill(-(run.child.pid ?? 0), 'SIGINT');
    await finish(run, 30_000);
    // Gone, before any later run could have swept it.
    expect(await remains(paused.path, paused.entry)).toEqual([]);
    // Torn down by the worker as the start was cancelled: the exit sweep found nothing, so neither
    // the run nor its run directory names anything it left.
    const named = [run.output(), ...(run.report()?.errors ?? []).map((e) => e.message ?? '')].join('\n');
    expect(named).toContain('The World start was interrupted (SIGINT).');
    expect(named).not.toContain('left things behind');
    expect(named).not.toContain('swept as the worker exited');
    const runDir = paused.path.slice(0, paused.path.lastIndexOf('/worlds/'));
    expect(readLeftovers(runDir)).toBe('');
  } finally {
    stopGroup(run);
    await cleanUp(paused?.path, paused?.entry);
    await rm(pauses, { recursive: true, force: true });
    await rm(run.dir, { recursive: true, force: true });
  }
});

test("TEST-1.8: a run killed while a World starts: the next run's global setup sweeps it", async () => {
  const pauses = await scratch();
  const pauseFile = join(pauses, 'paused');
  const killed = await startRun('interrupt.selftest.ts', { LOOKOUT_SELFTEST_PAUSE_FILE: pauseFile });
  let paused: { path: string; entry: WorldEntry } | undefined;
  let next: Awaited<ReturnType<typeof startRun>> | undefined;
  try {
    paused = await pausedEntry(killed, pauseFile);
    // SIGKILL: no handler, no exit sweep, no global teardown. The World's processes live on.
    kill(-(killed.child.pid ?? 0), 'SIGKILL');
    await finish(killed, 10_000);
    const left = await remains(paused.path, paused.entry);
    // Another run's global setup (a parallel repeat of these tests) may have swept it already.
    if (existsSync(paused.path)) expect(left.some((l) => l.startsWith('process '))).toBe(true);

    next = await startRun('next.selftest.ts');
    expect(await finish(next, 30_000), next.output()).toBe(0);
    expect(await remains(paused.path, paused.entry)).toEqual([]);
  } finally {
    stopGroup(killed);
    await cleanUp(paused?.path, paused?.entry);
    await rm(pauses, { recursive: true, force: true });
    await rm(killed.dir, { recursive: true, force: true });
    if (next) await rm(next.dir, { recursive: true, force: true });
  }
});

test("TEST-1.8: a test that times out with its teardown unfinished: the worker's exit sweep kills and names what it left", async () => {
  const tag = `selftest-${randomBytes(4).toString('hex')}`;
  const run = await startRun('timeout.selftest.ts', { LOOKOUT_SELFTEST_TIMEOUT: '1000', LOOKOUT_SELFTEST_TAG: tag });
  try {
    expect(await finish(run, 40_000)).not.toBe(0);
    const title = 'TEST-1.8: a test that times out with a process that ignores SIGTERM';
    const result = results(run.report()).get(title);
    expect(result?.status, run.output()).toBe('timedOut');
    expect(result?.errors).toContain('Tearing down "world" exceeded the test timeout');
    // Named under its test, by the sweep as the worker exited, so global teardown failed the run.
    const named = (run.report()?.errors ?? []).map((e) => e.message ?? '').join('\n');
    expect(named).toMatch(
      new RegExp(`left things behind \\(TEST-1\\.8\\):\\n(?:.*\\n)*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n(?:  .*\\n)*  process pid \\d+: node -e .* ${tag} \\(needed SIGKILL\\) \\(swept as the worker exited\\)\\n`),
    );
    // And it is gone.
    expect((await listProcesses()).filter((p) => p.command.endsWith(` ${tag}`))).toEqual([]);
  } finally {
    stopGroup(run);
    for (const p of await listProcesses()) if (p.command.endsWith(` ${tag}`)) signalVerified([p], 'SIGKILL');
    await rm(run.dir, { recursive: true, force: true });
  }
});

test('TEST-1.5: a Behaviour test that asks the fake tb-prod or tb-pr for a subcommand it does not answer fails, naming the call', async () => {
  const run = await startRun('fixture.selftest.ts', {}, ['--grep', 'TEST-1\\.5']);
  try {
    await finish(run, 40_000);
    const byTitle = results(run.report());
    // Each body passed (the refused call exited 2); the World failed the test after it, with this
    // message alone (its stack follows a blank line).
    const message = (title: string) => byTitle.get(title)?.errors.split('\n\n')[0];
    const prod = byTitle.get('TEST-1.5: a plain test that asks the fake tb-prod for another subcommand');
    expect(prod?.status, run.output()).toBe('failed');
    expect(message('TEST-1.5: a plain test that asks the fake tb-prod for another subcommand')).toBe(
      'Error: The fake tb-prod refused `tb-prod create tasks --data {}`: only `query tasks` is answered.',
    );
    const pr = byTitle.get('TEST-1.5: a plain test that asks the fake tb-pr for another subcommand');
    expect(pr?.status).toBe('failed');
    expect(message('TEST-1.5: a plain test that asks the fake tb-pr for another subcommand')).toBe(
      [
        'Error: The fake tb-pr refused `tb-pr open 812`: only `list --json` and `refresh` are answered.',
        'The fake tb-pr refused `tb-pr list`: only `list --json` and `refresh` are answered.',
      ].join('\n'),
    );
    expect((run.report()?.errors ?? []).map((e) => e.message ?? '').join('\n')).not.toContain('left things behind');
  } finally {
    stopGroup(run);
    await rm(run.dir, { recursive: true, force: true });
  }
});

test("TEST-1.7: a Behaviour test whose page gets past the World's route, by a redirect from its Lookout, fails naming the URL", async () => {
  const run = await startRun('fixture.selftest.ts', {}, ['--grep', 'TEST-1\\.7']);
  try {
    await finish(run, 40_000);
    const r = results(run.report()).get("TEST-1.7: a plain test whose page follows a redirect from the World's Lookout to outside it");
    // The body passed; the World failed the test after it, with this message alone.
    expect(r?.status, run.output()).toBe('failed');
    expect(r?.errors.split('\n\n')[0]).toMatch(
      /^Error: A page asked for https:\/\/github\.com\/productiveio\/anvil\/pull\/2101 \(a redirect from http:\/\/127\.0\.0\.1:\d+\/away\), outside the World's Lookout origin, and the World's route never aborted it\.$/,
    );
    expect((run.report()?.errors ?? []).map((e) => e.message ?? '').join('\n')).not.toContain('left things behind');
  } finally {
    stopGroup(run);
    await rm(run.dir, { recursive: true, force: true });
  }
});

test('TEST-2.2: a plain test() with a World fails without a criterion id in its title', async () => {
  const run = await startRun('fixture.selftest.ts', {}, ['--grep', 'no criterion id']);
  try {
    await finish(run, 40_000);
    const untitled = results(run.report()).get('a plain test with a World but no criterion id');
    expect(untitled?.status, run.output()).toBe('failed');
    expect(untitled?.errors).toContain(`A Behaviour test's title starts with its criterion id, like "SIDE-6.1: what holds". Got: "a plain test with a World but no criterion id"`);
  } finally {
    stopGroup(run);
    await rm(run.dir, { recursive: true, force: true });
  }
});

test('TEST-2.6: a plain test() with a World fails past its budget, naming what it waited for', async () => {
  const run = await startRun('fixture.selftest.ts', {}, ['--grep', 'TEST-2\\.6']);
  try {
    await finish(run, 40_000);
    const byTitle = results(run.report());
    // A wait that never ends fails when the budget runs out…
    const stuck = byTitle.get('TEST-2.6: a plain test stuck in a wait past its budget');
    expect(stuck?.status, run.output()).toBe('failed');
    expect(stuck?.errors).toContain('The Behaviour test ran past 1 s, waiting for a Session called nope to appear.');
    // …and time spent where no timer could fire is caught when the test ends.
    const busy = byTitle.get('TEST-2.6: a plain test busy past its budget where no timer can fire');
    expect(busy?.status).toBe('failed');
    expect(busy?.errors).toContain('The Behaviour test ran past 1 s, after waiting for the sidebar to render.');
    // TEST-1.8: failed tests' Worlds were torn down whole; the run names nothing they left.
    expect((run.report()?.errors ?? []).map((e) => e.message ?? '').join('\n')).not.toContain('left things behind');
  } finally {
    stopGroup(run);
    await rm(run.dir, { recursive: true, force: true });
  }
});
