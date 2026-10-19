import { execFile, execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/**
 * Which processes belong to a World (TEST-1.8), decided by the environment it hands down, never
 * by a process group, a pid recorded earlier or a command line:
 *
 * - everything a World starts gets `LOOKOUT_WORLD_ID=<token>` in its environment, a value only
 *   that World has, and passes it on to whatever it starts;
 * - a process is the World's when `ps -E` shows that token in the environment it was started with;
 * - or when its parent is the World's: macOS hides the environment of its own binaries (`/bin/sh`,
 *   `/bin/sleep`, `/usr/bin/git`, `/bin/ps`, `/usr/sbin/lsof`…) from `ps -E`, though they inherit it
 *   like any other;
 * - or when it was seen as the World's before and still has the same pid and start time.
 *
 * A pid's start time is read again right before it gets a signal (`signalVerified`), so a pid
 * the system handed to someone else in between is never touched.
 */

/** The variable every process of a World inherits; its value is the World's token. */
export const WORLD_ID_ENV = 'LOOKOUT_WORLD_ID';

export interface Proc {
  pid: number;
  ppid: number;
  pgid: number;
  /** Start time, ms since the epoch, to the second (`ps -o lstart`). */
  startMs: number;
  /** Exited, waiting for its parent to reap it: it holds nothing and can't be signalled away. */
  zombie: boolean;
  /** Its arguments, as `ps` joins them. Never its environment. */
  command: string;
  /** The values of `LOOKOUT_WORLD_ID` in its environment; empty when there is none or macOS hides it. */
  worldIds: readonly string[];
}

/** A process seen earlier, identified by pid and start time. */
export interface Identity {
  pid: number;
  startMs: number;
}

/** `ps -o lstart` has a resolution of one second, and truncates. */
const START_SLACK_MS = 1000;

const PLAIN_ARGS = ['-axww', '-o', 'pid=,ppid=,pgid=,stat=,lstart=,command='];
const ENV_ARGS = ['-axwwE', '-o', 'pid=,lstart=,command='];
// lstart in a fixed format: C locale, UTC.
const PS_ENV = { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' };
const PS_OPTS = { env: PS_ENV, maxBuffer: 64 * 1024 * 1024 };
const LSTART = '(\\w{3} \\w{3} [ \\d]\\d \\d\\d:\\d\\d:\\d\\d \\d{4})';
const PLAIN_LINE = new RegExp(`^\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\S+)\\s+${LSTART}\\s+(.*)$`);
const ENV_LINE = new RegExp(`^\\s*(\\d+)\\s+${LSTART}\\s+(.*)$`);
const START_LINE = new RegExp(`^\\s*(\\d+)\\s+${LSTART}\\s*$`);
const WORLD_ID = new RegExp(`(?:^| )${WORLD_ID_ENV}=(\\S+)`, 'g');

function lstartMs(text: string): number {
  return Date.parse(`${text} UTC`);
}

/**
 * Reads `ps -axww` and `ps -axwwE` of the same moment, give or take: `-E` appends a process's
 * environment to its arguments, so the environment is what follows the arguments the plain
 * listing shows. A process that changed in between (another pid, start time or command) gets no
 * environment. Only the values of `LOOKOUT_WORLD_ID` are kept; no other variable leaves here.
 */
export function parsePs(plain: string, withEnv = ''): Proc[] {
  const envOf = new Map<number, { startMs: number; rest: string }>();
  for (const line of withEnv.split('\n')) {
    const m = ENV_LINE.exec(line);
    if (m) envOf.set(Number(m[1]), { startMs: lstartMs(m[2] ?? ''), rest: m[3] ?? '' });
  }
  const procs: Proc[] = [];
  for (const line of plain.split('\n')) {
    const m = PLAIN_LINE.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const startMs = lstartMs(m[5] ?? '');
    if (Number.isNaN(startMs)) continue;
    const command = m[6] ?? '';
    const e = envOf.get(pid);
    const env = e && e.startMs === startMs && e.rest.startsWith(command) ? e.rest.slice(command.length) : '';
    const worldIds = [...env.matchAll(WORLD_ID)].map((x) => x[1] ?? '');
    procs.push({ pid, ppid: Number(m[2]), pgid: Number(m[3]), startMs, zombie: (m[4] ?? '').startsWith('Z'), command, worldIds });
  }
  return procs;
}

/** Every process on the machine, read with the real `/bin/ps` (never a World's shim). */
export async function listProcesses(): Promise<Proc[]> {
  const [plain, withEnv] = await Promise.all([execFileP('/bin/ps', PLAIN_ARGS, PS_OPTS), execFileP('/bin/ps', ENV_ARGS, PS_OPTS)]);
  return parsePs(plain.stdout, withEnv.stdout);
}

export function listProcessesSync(): Proc[] {
  const plain = execFileSync('/bin/ps', PLAIN_ARGS, { ...PS_OPTS, encoding: 'utf8' });
  const withEnv = execFileSync('/bin/ps', ENV_ARGS, { ...PS_OPTS, encoding: 'utf8' });
  return parsePs(plain, withEnv);
}

export interface OwnedOptions {
  /** Processes seen as the World's before; they stay the World's while pid and start time match. */
  known?: readonly Identity[];
  /** When the World was created (ms): none of its processes can have started earlier. */
  notBefore?: number;
}

/**
 * The World's processes in `procs`: those whose environment carries its token, those seen as the
 * World's before, and everything they started (by ppid). Never the calling process or its
 * ancestors, and never a zombie.
 */
export function ownedProcesses(procs: readonly Proc[], token: string, opts: OwnedOptions = {}): Proc[] {
  if (!token) return [];
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const spared = new Set<number>([0, 1]);
  for (let pid: number | undefined = process.pid; pid && !spared.has(pid); pid = byPid.get(pid)?.ppid) spared.add(pid);
  const known = new Map((opts.known ?? []).map((k) => [k.pid, k.startMs]));
  const earliest = opts.notBefore === undefined ? -Infinity : Math.floor(opts.notBefore / 1000) * 1000 - START_SLACK_MS;

  const picked = new Map<number, Proc>();
  const take = (p: Proc) => {
    if (spared.has(p.pid) || picked.has(p.pid) || p.zombie || p.startMs < earliest) return false;
    picked.set(p.pid, p);
    return true;
  };
  for (const p of procs) if (p.worldIds.includes(token) || known.get(p.pid) === p.startMs) take(p);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of procs) if (!picked.has(p.pid) && picked.has(p.ppid)) grew = take(p) || grew;
  }
  return [...picked.values()];
}

export function identities(procs: readonly Proc[]): Identity[] {
  return procs.map((p) => ({ pid: p.pid, startMs: p.startMs }));
}

/** `known` with `procs` added. */
export function remembered(known: readonly Identity[], procs: readonly Proc[]): Identity[] {
  const seen = new Map(known.map((k) => [k.pid, k]));
  for (const p of procs) seen.set(p.pid, { pid: p.pid, startMs: p.startMs });
  return [...seen.values()];
}

/**
 * World processes that left the World's process tree: handed to launchd (ppid 1) as the leader of
 * a group of their own, as a daemon does (`setsid`). The World's tmux server does that by design;
 * `expected` names it.
 */
export function escapedProcesses(owned: readonly Proc[], expected: (p: Proc) => boolean): Proc[] {
  return owned.filter((p) => p.ppid === 1 && p.pid === p.pgid && !expected(p));
}

/** Real Harness binaries a World must never run: Claude Code, Codex, pi (TEST-6.3). */
export const HARNESS_NAMES: ReadonlySet<string> = new Set(['claude', 'codex', 'pi']);

/** Node and Bun options that take the next word as their value. */
const RUNTIME_VALUE_OPTIONS = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions', '--title', '--env-file', '--input-type', '--stack-size', '--max-old-space-size', '--preload', '--cwd', '--config']);
/** Options after which a runtime runs no script file. */
const RUNTIME_INLINE = new Set(['-e', '--eval', '-p', '--print']);

/**
 * What a command runs, for the guard: its argv[0], or for `node` and `bun` the script they run
 * (as pi's and Codex's npm launchers do), skipping the runtime's own options and their values.
 * `ps` joins argv with spaces, so a path with a space in it is cut short.
 */
export function programOf(command: string): string {
  const words = command.split(/\s+/).filter(Boolean);
  const argv0 = words[0] ?? '';
  if (!['node', 'bun'].includes(basename(argv0))) return argv0;
  for (let i = 1; i < words.length; i++) {
    const w = words[i] ?? '';
    if (RUNTIME_INLINE.has(w) || /^--(eval|print)=/.test(w)) return argv0;
    if (w === '--') return words[i + 1] ?? argv0;
    if (RUNTIME_VALUE_OPTIONS.has(w)) {
      i++;
      continue;
    }
    if (w.startsWith('-')) continue;
    return w;
  }
  return argv0;
}

/** A process of the World that is claude, codex or pi and isn't a Fake Harness from the World's `bin/`. */
export function realHarnesses(owned: readonly Proc[], bin: string): string[] {
  return owned
    .filter((p) => {
      const exe = programOf(p.command);
      return HARNESS_NAMES.has(basename(exe)) && !exe.startsWith(`${bin}/`);
    })
    .map((p) => `a real Harness runs in the World: ${describeProc(p)}`);
}

export function describeProc(p: Proc): string {
  return `pid ${p.pid}: ${p.command.length > 160 ? `${p.command.slice(0, 157)}…` : p.command}`;
}

/** Sends `signal`; false when the process (or group, for a negative pid) is already gone. */
export function kill(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** The start time of each of `pids` that still runs, read again from `ps`. */
function startTimes(pids: readonly number[]): Map<number, number> {
  let out: string;
  try {
    out = execFileSync('/bin/ps', ['-o', 'pid=,lstart=', '-p', pids.join(',')], { ...PS_OPTS, encoding: 'utf8' });
  } catch (err) {
    // `ps -p` exits 1 when one of the pids is gone, and still lists the others.
    out = String((err as { stdout?: unknown }).stdout ?? '');
  }
  const starts = new Map<number, number>();
  for (const line of out.split('\n')) {
    const m = START_LINE.exec(line);
    if (m) starts.set(Number(m[1]), lstartMs(m[2] ?? ''));
  }
  return starts;
}

/**
 * Signals each of `procs` by its pid alone (never its group), and only while that pid still has
 * the start time it had when it was found to be the World's. Returns the pids it signalled.
 */
export function signalVerified(procs: readonly Proc[], signal: NodeJS.Signals): number[] {
  if (procs.length === 0) return [];
  const starts = startTimes(procs.map((p) => p.pid));
  return procs.filter((p) => starts.get(p.pid) === p.startMs && kill(p.pid, signal)).map((p) => p.pid);
}
