import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, closeSync, constants, existsSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { type Server, createServer } from 'node:net';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { FakeControl, readViolations } from '../fakes/control.ts';
import type { FakeViolation } from '../fakes/index.ts';
import { BrowserGuard } from './browser.ts';
import type { FleetRow } from '../../server/fleet.ts';
import { type GitIdentityDecl, type TbPrDecl, type TbProdDecl, type WorldSpec, checkTbPr, checkTbProd } from './builder.ts';
import { type Budget, WaitTimedOut, type Waiting, Waits } from './budget.ts';
import { REPO_ROOT, checkPins } from './pins.ts';
import {
  type Identity,
  type Proc,
  WORLD_ID_ENV,
  describeProc,
  escapedProcesses,
  kill,
  listProcesses,
  ownedProcesses,
  realHarnesses,
  remembered,
  signalVerified,
} from './processes.ts';
import { type WorldEntry, recordLeftovers, reserveWorld, sweepWorld } from './registry.ts';

const execFileP = promisify(execFile);

export function readJsonArray<T>(path: string): T[] {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(value)) throw new Error(`World sidecar must be a JSON array: ${path}`);
  return value as T[];
}

function writeWorldJson(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temporary, JSON.stringify(value));
  renameSync(temporary, path);
}

/**
 * A running World (TEST-1): a temporary HOME and settings, a PATH holding only what the World
 * declares, a private tmux server, and a Lookout server on a port the OS picked. Built fresh for
 * each Behaviour test, and torn down after it by `stop()`.
 *
 * Every process it starts inherits `LOOKOUT_WORLD_ID=<token>`, a value only this World has.
 * Teardown kills the processes carrying it and what they started, and nothing else
 * (processes.ts); only a child the World spawned and still holds is signalled as a whole group.
 */

const SHIMS = join(REPO_ROOT, 'e2e', 'shims');
const FAKES = join(REPO_ROOT, 'e2e', 'fakes');
const SERVER_MAIN = join(REPO_ROOT, 'server', 'main.ts');
/** The user's own Lookout and its Vite: a World never takes them (TEST-1.1). */
export const RESERVED_PORTS: ReadonlySet<number> = new Set([4747, 4748]);
const READY_TIMEOUT_MS = 10_000;
const STOP_GRACE_MS = 3_000;
/** The line the Lookout server prints once it listens; the World reads its port from it. */
const LISTENING = /^Lookout server on http:\/\/127\.0\.0\.1:(\d+)/m;

/**
 * TEST-1.2, real: the plain system tools Lookout, Fleet and a login shell need, linked into the
 * World's `bin/`. Fleet and tb-session come in as logged wrappers, tmux and ps as shims. Nothing
 * else is on PATH: never security, gh, ssh or osascript, and the fakes (claude, codex, tb-jev, curl,
 * tb-prod and tb-pr) only when declared.
 */
export const REAL_TOOLS: Readonly<Record<string, string>> = {
  git: '/usr/bin/git',
  lsof: '/usr/sbin/lsof',
  sh: '/bin/sh',
  bash: '/bin/bash',
  node: process.execPath,
  env: '/usr/bin/env',
  hostname: '/bin/hostname',
  sleep: '/bin/sleep',
  cat: '/bin/cat',
  date: '/bin/date',
  echo: '/bin/echo',
  sysctl: '/usr/sbin/sysctl',
  uname: '/usr/bin/uname',
  id: '/usr/bin/id',
};
/** TEST-1.2, absent: they would reach the keychain, the network or iTerm2. */
export const ABSENT_TOOLS = ['security', 'gh', 'ssh', 'osascript'] as const;

/**
 * TEST-1.2: every Fleet the World runs (the Lookout server's, the logged wrapper's, one run in a
 * pane) has `FLEET_PATH_ONLY=1`. Fleet then finds binaries on PATH alone: not in its fallback
 * directories (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, …), not at hard-coded install
 * locations, not through a login shell. It refuses what reaches past PATH by design (web serve,
 * service installs, other hosts, iTerm, a local exec or ssh) and an empty or relative PATH entry.
 * Panes it opens get its PATH and the switch through `tmux -e`, and run the tmux server's
 * `default-shell`, which the World sets to its own SHELL.
 */
export const FLEET_PATH_ONLY = 'FLEET_PATH_ONLY';

export interface WorldCall {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface StopReport {
  /** What outlived the World's teardown or escaped its process tree (TEST-1.8); each one was killed. */
  leftovers: string[];
  /** Connections to the default tmux socket in the World's TMUX_TMPDIR (TEST-1.9). */
  trapKnocks: number;
  /**
   * The failure report's parts (TEST-2.4): when collected, or when the fakes refused a call, which
   * fails the test. A call refused while the World stopped is found only then, once its panes are
   * gone, so that report has the rest without them.
   */
  report?: FailureReport;
  /** Calls the World's fakes refused, read once nothing of the World runs any more (TEST-1.5). */
  violations: FakeViolation[];
}

export interface FailureReport {
  declaration: string;
  serverLog: string;
  calls: string;
  panes: string;
  /** Each declared fake's answers in the order the test set them, the last one current; null without fakes. */
  fakes: string | null;
}

export interface StartOptions {
  /** Cancels the start: whatever was started is torn down and `startWorld` rejects. */
  signal?: AbortSignal;
  /** The guard on the test's browser context (TEST-1.7); told the World's origin once it is known. */
  browser?: BrowserGuard;
  /** How long teardown waits after SIGTERM before SIGKILL. */
  stopGraceMs?: number;
  /** Called once the World is in its run's index, before anything of it exists. */
  onEntry?: (entry: WorldEntry) => void;
  /** The Behaviour test the World belongs to; names what a sweep finds of it. */
  label?: string;
  /**
   * For the World's own tests (e2e/selftest): once everything is started, write the World's index
   * entry path here and keep starting until the start is cancelled (or 30 s have passed).
   */
  pauseFile?: string;
  /** For the World's own tests: the World ids to try, in order (`reserveWorld`). */
  nextId?: () => string;
}

export interface RunningWorld extends Waiting {
  readonly id: string;
  /** The value of `LOOKOUT_WORLD_ID` every process of the World inherits (processes.ts). */
  readonly worldToken: string;
  /** `lookout-world-<id>`, in the World's paths and the tmux socket's name; diagnostics only. */
  readonly marker: string;
  readonly root: string;
  readonly home: string;
  readonly bin: string;
  readonly logs: string;
  readonly tmuxTmpdir: string;
  readonly socket: string;
  /** The private tmux server's socket path. */
  readonly tmuxSocket: string;
  readonly port: number;
  readonly url: string;
  readonly token: string;
  readonly settingsPath: string;
  /** The environment the Lookout server, Fleet and everything they start get. */
  readonly env: Readonly<Record<string, string>>;
  readonly declaration: WorldSpec;
  /** How long the World took to start, until Lookout answered (TEST-2.5). */
  readonly startMs: number;
  /** Connections so far to the trap on the default tmux socket (TEST-1.9). */
  readonly trapKnocks: number;
  /** Names a wait, so a Behaviour test that runs out of time says what it was waiting for (TEST-2.6). */
  step<T>(what: string, fn: () => Promise<T>): Promise<T>;
  /** Polls `check` until it returns true, or fails naming `what`. */
  waitUntil(what: string, check: () => Promise<boolean> | boolean, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<void>;
  /** Runs a command with the World's environment, in a process group of its own; a bare name is looked up in the World's `bin/` only. */
  run(command: string, args: readonly string[], opts?: { timeoutMs?: number }): Promise<WorldCall>;
  /** `tmux …` on the World's private server. */
  tmux(args: readonly string[]): Promise<WorldCall>;
  /** The processes the World owns right now: those carrying its token, and what they started. */
  processes(): Promise<Proc[]>;
  /** What's wrong right now: a process that escaped the World's process tree, or a real Harness in it (TEST-1.2, TEST-1.8). */
  guard(): Promise<string[]>;
  /** Starts the Behaviour test's budget (TEST-2.6): past it, a pending or later wait fails naming itself. */
  budget(ms: number): Budget;
  /** The argv of every Fleet, tb-session and fake call so far, one per line (TEST-2.4). */
  calls(): string[];
  /** The fake `tb-prod`'s controls (TEST-1.6): change its answer, hold a call in flight. They throw when the World has no tb-prod. */
  readonly tbProd: FakeControl<TbProdDecl>;
  /** The fake `tb-pr`'s controls (TEST-1.6), as `tbProd`'s. */
  readonly tbPr: FakeControl<TbPrDecl>;
  /** Test controls that add CLI JSON rows without bypassing Fleet or tb-session's command boundary. */
  readonly fleet: { gainSession(row: FleetRow): void };
  readonly tbSession: { indexSession(row: Record<string, unknown>): void };
  /** Calls the World's fakes refused to answer so far; each fails the Behaviour test (TEST-1.5, `StopReport.violations`). */
  violations(): FakeViolation[];
  /** The URLs the World's pages asked for outside its Lookout origin, each aborted (TEST-1.7). */
  browserRequests(): string[];
  serverLog(): string;
  /** Tears the World down; safe to call twice. `collect` gathers the failure report first. */
  stop(opts?: { collect?: boolean }): Promise<StopReport>;
  // TODO(TEST-1.6): controls for a running World's Sessions:
  //   session(id): { busy(), ask(question), say(reply), exit(), limits(numbers) }, through the
  //   control file each Fake Harness watches; startOutside(decl) for a Session Lookout didn't start.
}

let pinsChecked: ReturnType<typeof checkPins> | undefined;

/** TEST-1.3: the World refuses a Fleet or tb-session that doesn't match its pin. */
function pinnedBins(spec: WorldSpec): { fleet: string | null; tbSession: string | null } {
  pinsChecked ??= checkPins();
  if (!pinsChecked.ok) throw new Error(`The World refuses to start:\n${pinsChecked.problems.map((p) => `  - ${p}`).join('\n')}`);
  return {
    fleet: spec.without.includes('fleet') ? null : pinsChecked.bins.fleet,
    tbSession: spec.without.includes('tb-session') ? null : pinsChecked.bins.tbSession,
  };
}

/** The real tmux binary, found like Fleet finds it: PATH, then Homebrew's directories. */
export function realTmux(): string {
  const dirs = [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), '/opt/homebrew/bin', '/usr/local/bin'];
  for (const dir of dirs) {
    const candidate = join(dir, 'tmux');
    // Never a World's own shim, when a test runner's PATH happens to hold one.
    if (candidate.includes('lookout-world-')) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  throw new Error('tmux is not installed. Install it with `brew install tmux`.');
}

/**
 * TEST-1.1: the server on `port` is the World's own: `/api/bootstrap` answers with the World's
 * token. Anything else (no answer, another server, another token) is refused.
 */
export function checkBootstrap(port: number, token: string, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/bootstrap', timeout: timeoutMs, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        let sent: unknown;
        try {
          sent = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { token?: unknown }).token;
        } catch {
          sent = undefined;
        }
        if (res.statusCode === 200 && sent === token) resolve();
        else reject(new Error(`Port ${port} answered /api/bootstrap with ${res.statusCode}, but not with the World's token: it isn't the World's Lookout.`));
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Port ${port} didn't answer /api/bootstrap within ${timeoutMs} ms.`)));
    req.on('error', reject);
    req.end();
  });
}

function fillTemplate(name: string, values: Record<string, string>): string {
  let text = readFileSync(join(SHIMS, name), 'utf8');
  for (const [k, v] of Object.entries(values)) {
    if (v.includes("'")) throw new Error(`A World path can't contain a quote: ${v}`);
    text = text.replaceAll(`@${k}@`, v);
  }
  return text;
}

async function writeExecutable(path: string, text: string): Promise<void> {
  await writeFile(path, text);
  await chmod(path, 0o755);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Worlds this process started and hasn't torn down (entry path → test title). If it exits first,
 * each is swept synchronously, and what was left of it is named for global teardown, which fails
 * the run on it (TEST-1.8): a test whose teardown ran out of time loses nothing.
 */
const unfinished = new Map<string, string>();
process.on('exit', () => {
  for (const [entryPath, label] of unfinished) {
    try {
      const found = sweepWorld(entryPath, { graceMs: 500 });
      recordLeftovers(label, found.map((f) => `${f} (swept as the worker exited)`));
    } catch {
      // nothing more can be done while exiting
    }
  }
});

/** Teardowns in progress, including those of cancelled starts. */
const stopping = new Set<Promise<unknown>>();

/** Waits for every teardown in progress; a worker does this before it exits. */
export async function settleWorlds(): Promise<void> {
  await Promise.allSettled([...stopping]);
}

/** Builds and starts a World. On any failure or cancellation, whatever it started is torn down before it throws. */
export async function startWorld(spec: WorldSpec, opts: StartOptions = {}): Promise<RunningWorld> {
  const started = performance.now();
  const { signal } = opts;
  signal?.throwIfAborted();
  const bins = pinnedBins(spec);
  const tmuxBin = realTmux();

  // TEST-1.8: the World is written down before anything of it exists, so an interrupted run can
  // still find and remove it (global setup and teardown, registry.ts). Its root and TMUX_TMPDIR
  // are then created exclusively: an id whose directory is already there is someone else's, and
  // another id is tried. Teardown removes only what the World created (`entry.owns`).
  const { entry, entryPath } = reserveWorld((id) => opts.label ?? `World ${id}`, opts.nextId ? { nextId: opts.nextId } : {});
  const { id, token: worldToken, root, tmuxTmpdir, createdAt, label } = entry;
  const owns = (dir: 'root' | 'tmuxTmpdir') => entry.owns.includes(dir);
  unfinished.set(entryPath, label);
  opts.onEntry?.(entry);
  const marker = `lookout-world-${id}`;

  const uid = process.getuid?.() ?? 0;
  const tmuxSocketDir = join(tmuxTmpdir, `tmux-${uid}`);
  const socket = marker;
  const tmuxSocket = join(tmuxSocketDir, socket);
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const logs = join(root, 'logs');
  const fleetDir = join(root, 'fleet');
  const tbSessionDir = join(root, 'tb-session');
  const fleetExtrasPath = join(fleetDir, 'extra-rows.json');
  const tbSessionExtrasPath = join(tbSessionDir, 'extra-results.json');
  const callsLog = join(logs, 'calls.log');
  const violationsLog = join(logs, 'violations.jsonl');
  const serverLogPath = join(logs, 'server.log');
  const settingsPath = join(home, '.config', 'lookout', 'settings.json');
  const graceMs = opts.stopGraceMs ?? STOP_GRACE_MS;

  let server: ChildProcess | null = null;
  let tmuxServerPid = 0;
  let trap: Server | null = null;
  let trapKnocks = 0;
  let stopped: Promise<StopReport> | null = null;
  const waits = new Waits();
  const browser = opts.browser ?? new BrowserGuard();
  // TEST-1.6: a fake's controls; it has a directory only when the World declares it.
  const fakeDir = (name: string) => join(root, 'fakes', name);
  const waitUntil = (what: string, check: () => boolean, o?: { timeoutMs?: number }) => waits.waitUntil(what, check, o);
  const tbProd = new FakeControl<TbProdDecl>('tb-prod', spec.tbProd ? fakeDir('tb-prod') : null, checkTbProd, waitUntil);
  const tbPr = new FakeControl<TbPrDecl>('tb-pr', spec.tbPr ? fakeDir('tb-pr') : null, checkTbPr, waitUntil);
  let worldPort: number;
  let worldUrl: string;
  const token = randomBytes(24).toString('base64url');

  // Everything the World starts gets this environment, and passes LOOKOUT_WORLD_ID on.
  const env: Record<string, string> = { [WORLD_ID_ENV]: worldToken };

  const readText = (path: string) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return '';
    }
  };

  /** A child the World spawned, while it still holds it: its pid can't belong to anyone else yet. */
  const holds = (child: ChildProcess | null): child is ChildProcess & { pid: number } =>
    !!child && child.pid !== undefined && child.exitCode === null && child.signalCode === null;

  /** Runs a command in a process group of its own. */
  const call = (file: string, args: readonly string[], timeoutMs = 10_000): Promise<WorldCall> =>
    new Promise((resolve) => {
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let done = false;
      let child: ChildProcess;
      try {
        child = spawn(file, [...args], { env, cwd: home, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        resolve({ stdout: '', stderr: (e as Error).message, code: null });
        return;
      }
      const finish = (code: number | null, extra = '') => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        child.stdout?.destroy();
        child.stderr?.destroy();
        resolve({ stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') + extra, code });
      };
      const timer = setTimeout(() => {
        if (holds(child)) kill(-child.pid, 'SIGKILL');
      }, timeoutMs);
      child.stdout?.on('data', (b: Buffer) => out.push(b));
      child.stderr?.on('data', (b: Buffer) => err.push(b));
      child.on('error', (e) => finish(null, e.message));
      child.on('close', (code) => finish(code));
      // A process it left behind may hold the pipes open; the command itself has ended.
      child.on('exit', (code) => setTimeout(() => finish(code), 200));
    });

  const tmux = (args: readonly string[]) => call(join(bin, 'tmux'), args);

  /** Processes seen as the World's: they stay its own while pid and start time match. */
  let known: Identity[] = [];
  const owned = async () => {
    const procs = ownedProcesses(await listProcesses(), worldToken, { known, notBefore: createdAt });
    known = remembered(known, procs);
    return procs;
  };
  /** The private tmux server daemonizes by design; nothing else of the World may. */
  const isTmux = (p: Proc) => p.pid === tmuxServerPid || p.command.startsWith(`${tmuxBin} `);
  const escapedOf = (procs: readonly Proc[]) => escapedProcesses(procs, isTmux);

  const guard = async () => {
    const mine = await owned();
    return [...escapedOf(mine).map((p) => `escaped the World's process tree: ${describeProc(p)}`), ...realHarnesses(mine, bin)];
  };

  /** TEST-2.4: what each fake answered, as the test changed it, not only what it was declared with. */
  const fakesReport = (): string | null => {
    const fakes = Object.fromEntries([...(spec.tbProd ? [[tbProd.name, tbProd.history()]] : []), ...(spec.tbPr ? [[tbPr.name, tbPr.history()]] : [])]);
    return Object.keys(fakes).length ? JSON.stringify(fakes, null, 2) : null;
  };

  /** The report's parts that are files in the World's root: readable until its directories go. */
  const reportFiles = (panes: string): FailureReport => ({
    declaration: JSON.stringify(spec, null, 2),
    serverLog: readText(serverLogPath),
    calls: readText(callsLog),
    panes,
    fakes: fakesReport(),
  });

  const collectReport = async (): Promise<FailureReport> => {
    const panes: string[] = [];
    const list = await tmux(['list-panes', '-a', '-F', '#{pane_id}\t#{session_name}:#{window_index}.#{pane_index}\t#{pane_current_command}']);
    if (list.code === 0) {
      for (const line of list.stdout.split('\n').filter(Boolean)) {
        const [paneId = '', where = '', cmd = ''] = line.split('\t');
        const screen = await tmux(['capture-pane', '-p', '-t', paneId]);
        panes.push(`── ${where} (${paneId}, ${cmd}) ──\n${screen.stdout.trimEnd()}`);
      }
    }
    return reportFiles(panes.length ? panes.join('\n\n') : '(no tmux panes)');
  };

  const doStop = async (collect: boolean): Promise<StopReport> => {
    let report = collect ? await collectReport().catch((e: Error) => reportFiles(`(could not read: ${e.message})`)) : undefined;
    const leftovers: string[] = [];

    // TEST-1.8: a World process that daemonized itself away from the World (a `setsid` helper)
    // is named, and killed with the rest.
    const escaped = new Set(escapedOf(await owned()).map((p) => p.pid));

    // The Lookout server first, so it stops starting Fleet calls. It is the World's own child,
    // still held, so its whole group can be signalled.
    if (holds(server)) {
      const lookout = server;
      const exited = new Promise<void>((resolve) => lookout.once('exit', () => resolve()));
      kill(-lookout.pid, 'SIGTERM');
      if ((await Promise.race([exited, sleep(graceMs).then(() => 'late' as const)])) === 'late' && holds(lookout)) kill(-lookout.pid, 'SIGKILL');
    }
    // The private tmux server and its panes, through its own socket: only in a TMUX_TMPDIR the
    // World created, so a socket there can be no one else's.
    if (owns('tmuxTmpdir') && existsSync(tmuxSocket)) await execFileP(tmuxBin, ['-S', tmuxSocket, 'kill-server'], { timeout: 5000, env: { PATH: '/usr/bin:/bin' } }).catch(() => {});

    // Everything else carrying the World's token gets SIGTERM, and SIGKILL after the grace
    // period; whatever needed that is named.
    let left = await owned();
    for (const p of left) if (escaped.has(p.pid)) leftovers.push(`escaped the World's process tree: ${describeProc(p)} (killed)`);
    signalVerified(left, 'SIGTERM');
    const deadline = Date.now() + graceMs;
    while (left.length && Date.now() < deadline) {
      await sleep(100);
      left = await owned();
    }
    for (const p of left) if (!escaped.has(p.pid)) leftovers.push(`process ${describeProc(p)} (needed SIGKILL)`);
    signalVerified(left, 'SIGKILL');
    for (const until = Date.now() + 2000; left.length && Date.now() < until; ) {
      await sleep(50);
      left = await owned();
    }
    const stillRunning = left;
    // TEST-1.5: nothing of the World can call a fake any more, and its logs are still there.
    const violations = readViolations(violationsLog);
    // TEST-2.4: the report's files are read again now, before the directories go, so they hold the
    // calls made while the World stopped, such as one a fake refused. A collected report keeps the
    // panes it captured before shutdown; without one, a refused call still gets its report, without panes.
    if (report) report = reportFiles(report.panes);
    else if (violations.length) report = reportFiles('(World stopped: its tmux panes were gone when the refused calls were read)');

    if (trap) await new Promise<void>((resolve) => trap?.close(() => resolve()));
    unfinished.delete(entryPath);
    if (stillRunning.length) {
      // Its directories go only once its processes are gone: the entry stays, so global teardown
      // sweeps it again and fails the run naming it.
      for (const p of stillRunning) leftovers.push(`process ${describeProc(p)} still runs after SIGKILL, so ${root} and ${tmuxTmpdir} are kept`);
      return { leftovers, trapKnocks, violations, ...(report ? { report } : {}) };
    }
    for (const dir of [root, tmuxTmpdir]) {
      // Only a directory the World created itself (reserveWorld), never one that was already there.
      if (!owns(dir === root ? 'root' : 'tmuxTmpdir')) continue;
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      if (existsSync(dir)) leftovers.push(`directory ${dir}`);
    }
    await rm(entryPath, { force: true });
    return { leftovers, trapKnocks, violations, ...(report ? { report } : {}) };
  };

  const stop = (o: { collect?: boolean } = {}) => {
    if (!stopped) {
      const s = doStop(o.collect ?? false);
      stopped = s;
      stopping.add(s);
      void s.finally(() => stopping.delete(s)).catch(() => {});
    }
    return stopped;
  };

  /** Rejects as soon as `signal` aborts, so a wait in the start can be cancelled. */
  const cancelled = new Promise<never>((_, reject) => {
    if (!signal) return;
    const onAbort = () => reject(signal.reason ?? new Error('The World start was cancelled.'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  cancelled.catch(() => {});
  const step = async <T>(p: Promise<T>): Promise<T> => {
    signal?.throwIfAborted();
    const r = await Promise.race([p, cancelled]);
    signal?.throwIfAborted();
    return r;
  };

  try {
    await step(
      Promise.all(
        [bin, logs, join(root, 'tmp'), join(root, 'work'), fleetDir, join(fleetDir, 'locks'), tbSessionDir, join(home, 'Projects', 'work'), join(home, '.config', 'lookout')].map((d) =>
          mkdir(d, { recursive: true }),
        ),
      ),
    );
    await writeFile(callsLog, '');
    await writeFile(fleetExtrasPath, '[]');
    await writeFile(tbSessionExtrasPath, '[]');

    // TEST-1.9: a trap on the default socket in the World's TMUX_TMPDIR. Anything that ignored the
    // `-L` server would knock here.
    await mkdir(tmuxSocketDir, { recursive: true, mode: 0o700 });
    await chmod(tmuxSocketDir, 0o700);
    trap = createServer((conn) => {
      trapKnocks++;
      conn.destroy();
    });
    await step(
      new Promise<void>((resolve, reject) => {
        trap?.once('error', reject);
        trap?.listen(join(tmuxSocketDir, 'default'), () => resolve());
      }),
    );

    // bin/: real tools, shims, logged wrappers. Nothing else.
    await step(Promise.all(Object.entries(REAL_TOOLS).map(([name, target]) => symlink(target, join(bin, name)))));
    await writeExecutable(join(bin, 'tmux'), fillTemplate('tmux', { TMUX_TMPDIR: tmuxTmpdir, REAL_TMUX: tmuxBin, SOCKET: socket }));
    await writeExecutable(join(bin, 'ps'), fillTemplate('ps', {}));
    for (const [name, real] of [['fleet', bins.fleet], ['tb-session', bins.tbSession]] as const) {
      if (!real) continue;
      const extras = name === 'fleet' ? fleetExtrasPath : tbSessionExtrasPath;
      await writeExecutable(join(bin, name), fillTemplate('logged', {
        NAME: name,
        LOG: callsLog,
        REAL: real,
        SELF: join(bin, name),
        NODE: process.execPath,
        MERGE_SCRIPT: join(REPO_ROOT, 'e2e/shims/merge-json.mjs'),
        EXTRAS: extras,
      }));
    }
    // TEST-1.2, TEST-1.5: the declared fakes, each run by node from e2e/fakes/ through a wrapper that
    // logs its argv, with a directory of its own for the answer it reads when a call starts (TEST-1.6).
    const installFake = async <A>(fake: FakeControl<A>, decl: A | null) => {
      if (decl === null) return;
      await mkdir(fakeDir(fake.name), { recursive: true });
      fake.answer(decl);
      const values = { NAME: fake.name, LOG: callsLog, NODE: process.execPath, SCRIPT: join(FAKES, `${fake.name}.ts`), STATE: fakeDir(fake.name), VIOLATIONS: violationsLog };
      await writeExecutable(join(bin, fake.name), fillTemplate('fake', values));
    };
    await installFake(tbProd, spec.tbProd);
    await installFake(tbPr, spec.tbPr);
    // TODO(TEST-1.4, TEST-1.7): the other declared fakes from e2e/fakes/ (claude, codex, tb-jev, curl).

    // TEST-1.2: a login shell (a tmux pane, Fleet's `$SHELL -l`) runs /etc/profile, whose
    // path_helper puts /usr/bin, /usr/local/bin and /opt/homebrew/bin back on PATH, with
    // security, ssh, osascript, curl and gh. The World's own profile, read after it, takes them out.
    // SHELL is /bin/sh, and every sh (bash, dash, zsh as sh) reads ~/.profile as a login shell.
    await writeFile(
      join(home, '.profile'),
      `# The World's login shells: /etc/profile's path_helper put the system directories back on PATH.\nPATH='${bin}'\nexport PATH\n`,
    );

    // Fleet's config. Launchers, tmux and gh are Fleet's defaults, found on PATH alone
    // (FLEET_PATH_ONLY): a Harness is installed exactly when the World puts it in bin/.
    // Naming, grouping and stacks would run `claude -p`: off.
    await writeFile(
      join(fleetDir, 'config.json'),
      JSON.stringify({ version: 1, naming: { enabled: false }, grouping: { enabled: false }, stacks: { enabled: false } }, null, 2),
    );

    // Lookout's own settings file (TEST-1.1).
    await writeFile(settingsPath, JSON.stringify({ version: 1, ...spec.settings }, null, 2) + '\n', { mode: 0o600 });

    // Built from nothing, so none of the runner's variables leak in (Fleet's UNSET list included).
    Object.assign(env, {
      HOME: home,
      PATH: bin,
      SHELL: '/bin/sh',
      TMPDIR: join(root, 'tmp'),
      LANG: 'en_US.UTF-8',
      NO_COLOR: '1',
      NODE_ENV: 'production',
      // TEST-1.1: the OS picks the port; it's never 4747 or 4748 (checked below).
      LOOKOUT_PORT: '0',
      LOOKOUT_TOKEN: token,
      LOOKOUT_SETTINGS: settingsPath,
      ...(bins.fleet ? { LOOKOUT_FLEET_BIN: join(bin, 'fleet') } : {}),
      ...(bins.tbSession ? { LOOKOUT_TB_SESSION_BIN: join(bin, 'tb-session') } : {}),
      TMUX_TMPDIR: tmuxTmpdir,
      FLEET_CONFIG: join(fleetDir, 'config.json'),
      FLEET_SNAPSHOT: join(fleetDir, 'snapshot.json'),
      FLEET_LOCK_DIR: join(fleetDir, 'locks'),
      FLEET_MUX: '0',
      FLEET_CONNECT_TIMEOUT: '2',
      [FLEET_PATH_ONLY]: '1',
    });

    // The private tmux server, kept alive while it has no sessions. It daemonizes, which no other
    // process of the World may (escapedProcesses), so its pid is kept. It starts with the World's
    // environment, so a pane gets the World's PATH and FLEET_PATH_ONLY; and every pane, whoever
    // opens it, runs `default-shell`, set here to the World's SHELL rather than left to whatever
    // tmux would pick.
    const started_ = await step(tmux(['start-server', ';', 'set', '-g', 'exit-empty', 'off', ';', 'set', '-g', 'default-shell', env.SHELL ?? '/bin/sh']));
    if (started_.code !== 0) throw new Error(`tmux didn't start: ${started_.stderr.trim()}`);
    tmuxServerPid = Number((await step(tmux(['display', '-p', '#{pid}']))).stdout.trim());
    if (!tmuxServerPid) throw new Error("tmux didn't report its server's pid");

    // TEST-1.5: a global git identity (WORK-2.5).
    if (spec.gitIdentity) await writeFile(join(home, '.gitconfig'), gitConfig(spec.gitIdentity));
    // TODO(TEST-1.5): repos, History and usage fixtures go into home/ and work/ here.
    // TODO(TEST-1.4): live Sessions start here as Fake Harnesses; wait until Fleet lists them.

    // The Lookout server, in its own process group. The marker argument is for diagnostics.
    signal?.throwIfAborted();
    const logFd = openSync(serverLogPath, 'a');
    try {
      server = spawn(process.execPath, [SERVER_MAIN, `--${marker}`], { cwd: home, env, detached: true, stdio: ['ignore', logFd, logFd] });
    } finally {
      closeSync(logFd);
    }
    const lookout = server;
    const exited = new Promise<void>((resolve) => lookout.once('exit', () => resolve()));
    const readyBy = Date.now() + READY_TIMEOUT_MS;
    // TEST-1.1: the port the server itself reports, never one picked ahead and raced for.
    for (;;) {
      const m = LISTENING.exec(readText(serverLogPath));
      if (m) {
        worldPort = Number(m[1]);
        break;
      }
      if (lookout.exitCode !== null || lookout.signalCode !== null) {
        throw new Error(`The Lookout server exited while starting:\n${readText(serverLogPath).trim()}`);
      }
      if (Date.now() > readyBy) throw new WaitTimedOut(READY_TIMEOUT_MS, 'the Lookout server to say which port it listens on');
      await step(Promise.race([exited, sleep(25)]));
    }
    if (RESERVED_PORTS.has(worldPort)) throw new Error(`The Lookout server got port ${worldPort}, which a World never uses.`);
    await step(checkBootstrap(worldPort, token));
    worldUrl = `http://127.0.0.1:${worldPort}/`;
    // TEST-1.7: from now on the test's pages reach this origin, and only this one.
    browser.allow(new URL(worldUrl).origin);
    if (opts.pauseFile) {
      writeFileSync(opts.pauseFile, entryPath);
      await step(sleep(30_000));
    }
  } catch (err) {
    // A cancelled or failed start is torn down here; what outlived it is named all the same.
    const r = await stop().catch(() => null);
    if (r?.leftovers.length) recordLeftovers(label, r.leftovers);
    throw err;
  }

  const startMs = Math.round(performance.now() - started);

  return {
    id,
    worldToken,
    marker,
    root,
    home,
    bin,
    logs,
    tmuxTmpdir,
    socket,
    tmuxSocket,
    port: worldPort,
    url: worldUrl,
    token,
    settingsPath,
    env,
    declaration: spec,
    startMs,
    get trapKnocks() {
      return trapKnocks;
    },
    get waitingFor() {
      return waits.waitingFor;
    },
    get lastWait() {
      return waits.lastWait;
    },
    step: (what, fn) => waits.step(what, fn),
    waitUntil: (what, check, o) => waits.waitUntil(what, check, o),
    budget: (ms) => waits.budget(ms),
    run: (command, args, o = {}) => call(command.includes('/') ? command : join(bin, command), args, o.timeoutMs),
    tmux,
    processes: owned,
    guard,
    calls: () => readText(callsLog).split('\n').filter(Boolean),
    tbProd,
    tbPr,
    fleet: {
      gainSession: (row) => writeWorldJson(fleetExtrasPath, [...readJsonArray<FleetRow>(fleetExtrasPath).filter((existing) => existing.session_id !== row.session_id), row]),
    },
    tbSession: {
      indexSession: (row) => writeWorldJson(tbSessionExtrasPath, [...readJsonArray<Record<string, unknown>>(tbSessionExtrasPath).filter((existing) => existing.session_id !== row.session_id), row]),
    },
    violations: () => readViolations(violationsLog),
    browserRequests: () => browser.requests(),
    serverLog: () => readText(serverLogPath),
    stop,
  };
}

/** `~/.gitconfig` with a global identity, each value quoted as git reads it. */
export function gitConfig(identity: GitIdentityDecl): string {
  const quote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return `[user]\n\tname = ${quote(identity.name)}\n\temail = ${quote(identity.email)}\n`;
}

/** The user's real home, only to prove nothing in a World points at it (TEST-1.1). */
export const USER_HOME = homedir();

/** Reads a file a World wrote; for assertions. */
export function readWorldFile(path: string): Promise<string> {
  return readFile(path, 'utf8');
}
