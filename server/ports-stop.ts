import { type Listener, type PortsSession, type StopResult, type StopTarget, parseDevctl, parseElapsed } from '../shared/ports.ts';

export type { StopResult, StopTarget };
import type { RunError, Runner } from './exec.ts';
import { cleanEnv } from './launcher.ts';
import { resolveMemoryBin } from './memory.ts';
import { DEVCTL_ARGS, LISTEN_ARGS, listenersFrom, resolveDevctlBin } from './ports.ts';
import { sanitizeLine } from './sanitize.ts';

/** PORTS-4.7: the whole process table, with each one's group, owner, state and command (last: it can hold spaces). */
export const STOP_PS_ARGS = ['-axo', 'pid=,ppid=,pgid=,uid=,stat=,etime=,comm='] as const;
const READ_TIMEOUT_MS = 2000;
/** tb-devctl waits 10 s before its own SIGKILL (`commands/down.rs`). */
const DEVCTL_TIMEOUT_MS = 20_000;
/** PORTS-4.7: how far the row's start time (the monitor's estimate, its reads' own lag in it) may sit from a fresh sample's window. */
const START_SLACK_MS = 5000;
/** Clock granularity between two windows of one process. */
const SAME_SLACK_MS = 250;
/** PORTS-4.3. */
export const STOP_GRACE_MS = 3000;
const POLL_MS = 250;
const SETTLE_MS = 1000;

export class StopError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** One row of `STOP_PS_ARGS`. */
export interface Proc {
  pid: number;
  ppid: number;
  pgid: number;
  uid: number;
  stat: string;
  elapsedMs: number;
  comm: string;
}

const int = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s) ? Number(s) : null);

/** `STOP_PS_ARGS`'s output; lines that don't parse are skipped, never the read. */
export function parseStopPs(stdout: string): Map<number, Proc> {
  const rows = new Map<number, Proc>();
  for (const line of stdout.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7) continue;
    const [pid, ppid, pgid, uid] = parts.slice(0, 4).map(int);
    const elapsedMs = parseElapsed(parts[5]!);
    if (!pid || ppid === null || ppid === undefined || pgid === null || pgid === undefined || uid === null || uid === undefined || elapsedMs === null) continue;
    rows.set(pid, { pid, ppid, pgid, uid, stat: parts[4]!, elapsedMs, comm: parts.slice(6).join(' ') });
  }
  return rows;
}

/** PORTS-4.7: the request body, checked before anything is read or signalled. */
export function parseStopTarget(body: unknown): StopTarget {
  const b = (typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  if (typeof b.pid !== 'number' || !Number.isSafeInteger(b.pid) || b.pid <= 1) throw new StopError(400, 'Invalid process id.');
  if (typeof b.command !== 'string' || !b.command || b.command.length > 120) throw new StopError(400, 'Invalid command.');
  if (typeof b.startedAt !== 'number' || !Number.isFinite(b.startedAt) || b.startedAt <= 0) throw new StopError(400, 'Invalid start time.');
  return { pid: b.pid, command: b.command, startedAt: b.startedAt, devctl: b.devctl === true };
}

/** A process's command as a name: the last part of its path, a login shell's leading `-` dropped. */
export const commandName = (comm: string) => (comm.split('/').pop() ?? '').replace(/^-/, '');

const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'login']);
const HARNESSES = new Set(['claude', 'codex']);
const isShell = (p: Proc) => SHELLS.has(commandName(p.comm));
/** The terminal's shell, or the shell a Harness ran a command in: each leads its own process group. */
const leadsShell = (p: Proc) => isShell(p) && p.pid === p.pgid;
const gone = (p: Proc | undefined) => !p || p.stat.startsWith('Z');

export interface JobInput {
  procs: ReadonlyMap<number, Proc>;
  listener: number;
  /** Lookout's pid and its ancestors, and every Session's pid in Fleet's list. */
  lookout: ReadonlySet<number>;
  sessions: ReadonlySet<number>;
  /** Lookout's own uid: a process of another user is never signalled. */
  uid: number;
}

export type Job = { ok: true; pids: number[] } | { ok: false; reason: string };

/** PORTS-4.2: why a process is never signalled; null when it may be. Nothing names tmux (0001). */
function protectedWhy(p: Proc, input: Pick<JobInput, 'lookout' | 'sessions' | 'uid'>): string | null {
  const name = commandName(p.comm);
  if (p.pid <= 1) return `It runs inside the system's own process (pid ${p.pid}), which Lookout never stops.`;
  if (input.lookout.has(p.pid)) return "It's part of Lookout itself, which never stops itself.";
  if (input.sessions.has(p.pid) || HARNESSES.has(name)) return `It runs inside a Session (${name}, pid ${p.pid}), which Lookout never stops this way.`;
  if (name === 'tmux') return `It runs inside a Session host (pid ${p.pid}), which Lookout never stops.`;
  if (p.uid !== input.uid) return `It runs as another user (${name}, pid ${p.pid}), so Lookout won't stop it.`;
  return null;
}

/**
 * PORTS-4.1, 4.2: the server's job. From the listener, up the `ppid` chain while the parent is in
 * the listener's process group and isn't protected, a shell leading a group included; the top of
 * that walk and all its descendants. Refused, with nothing signalled, when the job holds a
 * protected process or a shell leading a group of its own.
 */
export function findJob(input: JobInput): Job {
  const { procs } = input;
  const listener = procs.get(input.listener);
  if (!listener) return { ok: false, reason: "Lookout couldn't find its process, so nothing was stopped." };
  let top = listener;
  const walked = new Set([top.pid]);
  for (let parent = procs.get(top.ppid); parent && !walked.has(parent.pid); parent = procs.get(top.ppid)) {
    if (parent.pgid !== listener.pgid || protectedWhy(parent, input) || leadsShell(parent)) break;
    walked.add(parent.pid);
    top = parent;
  }
  const children = new Map<number, number[]>();
  for (const p of procs.values()) if (p.pid !== p.ppid) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p.pid]);
  const pids: number[] = [];
  const queue = [top.pid];
  const seen = new Set<number>();
  while (queue.length) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const p = procs.get(pid);
    if (!p) continue;
    const why = protectedWhy(p, input);
    if (why) return { ok: false, reason: why };
    if (leadsShell(p)) return { ok: false, reason: `It started a shell of its own (pid ${p.pid}), which Lookout never stops.` };
    pids.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return { ok: true, pids };
}

/** Lookout's pid and every ancestor of it, by the table. */
function lineage(pid: number, procs: ReadonlyMap<number, Proc>): Set<number> {
  const out = new Set<number>();
  for (let at: number | undefined = pid; at && at > 1 && !out.has(at); at = procs.get(at)?.ppid) out.add(at);
  return out;
}

export interface StopOptions {
  runner: Runner;
  sessions(): readonly PortsSession[];
  /** Lookout's own pid and uid. */
  pid?: number;
  uid?: number;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  sleep?: (ms: number) => Promise<void>;
  graceMs?: number;
}

const CHANGED = 'This server changed since the list was read (its process now runs something else), so nothing was stopped.';
/** A stack or service name tb-devctl gave: never one an argv parser could take for an option. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * PORTS-4: stops one Local server. Everything is read again first (PORTS-4.7); a tb-devctl service
 * goes through `tb-devctl down` (PORTS-4.4); anything else is its job, SIGTERM then, after 3 s,
 * SIGKILL to what's left (PORTS-4.1–4.3); the ports are checked free at the end.
 *
 * Every start time is a window from one `ps` sample: `etime` counts whole seconds, read sometime
 * between the run's start and end, so a slow read widens the window rather than skewing it, and two
 * samples of one process always overlap. Each signal goes out on a fresh, readable table: the
 * protections (PORTS-4.2) are checked again on it, and nothing is forced on a table Lookout couldn't read.
 */
export async function stopServer(opts: StopOptions, target: StopTarget): Promise<StopResult> {
  const env = cleanEnv(opts.env ?? process.env);
  const now = opts.now ?? Date.now;
  const kill = opts.kill ?? ((pid, signal) => process.kill(pid, signal));
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const read = { timeoutMs: READ_TIMEOUT_MS, env };
  const lsof = resolveMemoryBin('lsof', env);
  const psBin = resolveMemoryBin('ps', env);
  const readListeners = async () => listenersFrom((await Promise.allSettled([opts.runner(lsof, LISTEN_ARGS, read)]))[0]);
  const sample = async (): Promise<Sample> => {
    const from = now();
    const table = parseStopPs(await opts.runner(psBin, STOP_PS_ARGS, read));
    return { table, from, to: now() };
  };
  const lookoutPid = opts.pid ?? process.pid;
  const uid = opts.uid ?? process.getuid?.() ?? -1;
  // Fleet's list as it is now, and Lookout's ancestors in this table: each check reads both afresh.
  const context = (table: ReadonlyMap<number, Proc>) => ({ lookout: lineage(lookoutPid, table).add(lookoutPid), sessions: new Set(opts.sessions().map((s) => s.pid)), uid });

  // tb-devctl first, as the slow one; then the listeners and the processes, back to back, so what is
  // signalled is what was just seen listening.
  const devctl = await opts.runner(resolveDevctlBin(env), DEVCTL_ARGS, read).then(
    (out) => ({ ok: true as const, services: parseDevctl(out) }),
    () => ({ ok: false as const, services: [] }),
  );
  const listening = await readListeners();
  if (typeof listening === 'string') throw new StopError(503, `Couldn't read the ports: ${listening}, so nothing was stopped.`);
  const listener = listening.find((l) => l.pid === target.pid);
  if (!listener) return { how: 'gone', count: 0 };
  if (listener.command !== target.command) throw new StopError(409, CHANGED);
  const first = await sample().catch(() => {
    throw new StopError(503, "Couldn't read the processes, so nothing was stopped.");
  });
  const proc = first.table.get(target.pid);
  if (!proc || gone(proc) || distance(target.startedAt, startWindow(proc, first)) > START_SLACK_MS) {
    throw new StopError(409, 'This server was restarted since the list was read, so nothing was stopped.');
  }

  // PORTS-4.4: a tb-devctl service by PORTS-1.3's join, its recorded group the listener's own: a
  // record left by a pid now reused names another process group, and isn't this server's.
  const live = devctl.services.filter((d) => d.state !== 'dead' && (d.pgid === null || d.pgid === proc.pgid));
  const service = live.find((d) => d.listenerPid === target.pid) ?? live.find((d) => d.pgid === proc.pgid);
  if (target.devctl && !service) {
    throw new StopError(devctl.ok ? 409 : 503, devctl.ok ? 'tb-devctl no longer lists it as a service, so nothing was stopped.' : "Couldn't ask tb-devctl about it, so nothing was stopped.");
  }
  if (service) {
    if (!SAFE_NAME.test(service.stack) || !SAFE_NAME.test(service.service)) throw new StopError(409, "tb-devctl named this service oddly, so Lookout won't stop it.");
    // PORTS-4.2: tb-devctl signals the service's whole process group, so every member is checked first.
    const ctx = context(first.table);
    for (const p of first.table.values()) {
      const why = p.pgid === proc.pgid && !gone(p) ? protectedWhy(p, ctx) : null;
      if (why) throw new StopError(409, why);
    }
    try {
      await opts.runner(resolveDevctlBin(env), ['down', '--', service.stack, service.service], { timeoutMs: DEVCTL_TIMEOUT_MS, env });
    } catch (err) {
      const e = err as RunError;
      if (e.code === 'ENOENT') throw new StopError(503, "Couldn't stop it: tb-devctl isn't installed.");
      if (e.timedOut) throw new StopError(504, "Couldn't stop it: tb-devctl took too long. Check the list before trying again.");
      const said = (e.stderr ?? '').split('\n').map((l) => l.trim()).filter(Boolean).at(-1);
      throw new StopError(502, `tb-devctl couldn't stop it: ${sanitizeLine(said?.replace(/^error:\s*/i, '') ?? e.message, 200) ?? 'no details'}.`.replace(/\.\.$/, '.'));
    }
    await checkFree(listener, readListeners, sleep);
    return { how: 'devctl', count: 0 };
  }

  const job = findJob({ procs: first.table, listener: target.pid, ...context(first.table) });
  if (!job.ok) throw new StopError(409, job.reason);

  // PORTS-4.3: SIGTERM, then SIGKILL after the grace to what is still the same process.
  const signalled = new Map(job.pids.map((pid) => [pid, startWindow(first.table.get(pid)!, first)]));
  const left = (s: Sample) =>
    [...signalled].filter(([pid, window]) => {
      const p = s.table.get(pid);
      return !gone(p) && overlaps(window, startWindow(p!, s), SAME_SLACK_MS);
    }).map(([pid]) => pid);
  const send = (pids: readonly number[], signal: NodeJS.Signals) => {
    for (const pid of pids) {
      try {
        kill(pid, signal);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw new StopError(500, `Couldn't stop pid ${pid}: ${(err as Error).message}.`);
      }
    }
  };
  /** Polls until the signalled processes are gone or `ms` passes; the last readable table, or null when none was. */
  const waitGone = async (ms: number): Promise<Sample | null> => {
    const until = now() + ms;
    let last: Sample | null = null;
    while (now() < until) {
      await sleep(POLL_MS);
      last = (await sample().catch(() => null)) ?? last;
      if (last && !left(last).length) return last;
    }
    return last;
  };

  send(job.pids, 'SIGTERM');
  const settled = await waitGone(opts.graceMs ?? STOP_GRACE_MS);
  if (settled && !left(settled).length) {
    await checkFree(listener, readListeners, sleep);
    return { how: 'stopped', count: job.pids.length };
  }
  // Forced only on a table read now: a pid that went and came back as something else is never killed.
  const now2 = await sample().catch(() => {
    throw new StopError(503, "Asked it to stop, but couldn't check what is still running, so nothing was forced.");
  });
  const survivors = left(now2);
  const ctx = context(now2.table);
  for (const pid of survivors) {
    const p = now2.table.get(pid)!;
    const why = protectedWhy(p, ctx) ?? (leadsShell(p) ? `It became a shell of its own (pid ${pid}), which Lookout never stops.` : null);
    if (why) throw new StopError(409, `${why} Nothing was forced.`);
  }
  send(survivors, 'SIGKILL');
  const after = await waitGone(SETTLE_MS);
  if (!after) throw new StopError(503, "Forced it to stop, but couldn't check that it did.");
  const stuck = left(after);
  if (stuck.length) {
    const p = after.table.get(stuck[0]!);
    throw new StopError(500, `It didn't stop: ${p ? commandName(p.comm) : 'a process'} (pid ${stuck[0]}) is still running.`);
  }
  await checkFree(listener, readListeners, sleep);
  return { how: 'forced', count: job.pids.length };
}

/** A `ps` table, and when its run started and ended. */
interface Sample {
  table: ReadonlyMap<number, Proc>;
  from: number;
  to: number;
}

/**
 * When a process started, by one sample: `etime` is the whole seconds it had run when `ps` read it,
 * sometime between the run's start and end, so its start lies in this window.
 */
export const startWindow = (p: Proc, s: { from: number; to: number }): [number, number] => [s.from - p.elapsedMs - 1000, s.to - p.elapsedMs];
/** Two windows of one process overlap, within `slack`. */
export const overlaps = (a: readonly [number, number], b: readonly [number, number], slack = 0) => a[0] <= b[1] + slack && b[0] <= a[1] + slack;
/** How far `t` lies outside the window; 0 inside it. */
export const distance = (t: number, [lo, hi]: readonly [number, number]) => (t < lo ? lo - t : t > hi ? t - hi : 0);

/**
 * PORTS-4.1: the ports are free afterwards. A listener in their place fails the Stop with who holds
 * them; a listener query that can't be read fails it too, after a few tries, rather than say it's free.
 */
async function checkFree(stopped: Listener, readListeners: () => Promise<Listener[] | string>, sleep: (ms: number) => Promise<void>): Promise<void> {
  let holder: { port: number; by: Listener } | null = null;
  let unread: string | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(POLL_MS);
    const listening = await readListeners().catch((e: unknown) => (e instanceof Error ? e.message : 'lsof failed'));
    if (typeof listening === 'string') {
      unread = listening;
      continue;
    }
    unread = null;
    holder = null;
    for (const l of listening) {
      const port = stopped.ports.find((p) => l.ports.includes(p));
      if (port !== undefined) holder = { port, by: l };
    }
    // The listener itself may still be closing its socket; anything else holding the port is final.
    if (!holder || holder.by.pid !== stopped.pid) break;
  }
  if (unread !== null) throw new StopError(503, `Stopped it, but couldn't check that :${stopped.ports[0]} is free: ${unread}.`);
  if (holder) {
    const again = holder.by.pid === stopped.pid ? 'still' : 'in use again';
    throw new StopError(409, `Stopped, but :${holder.port} is ${again} by ${holder.by.command} (pid ${holder.by.pid}).`);
  }
}
