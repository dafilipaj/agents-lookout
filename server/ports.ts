import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { PORTS_INTERVAL_MS, attribute, parseCwds, parseDevctl, parseListeners, parseProcessTimes, type Checkout, type Listener, type PortsSession, type PortsSnapshot } from '../shared/ports.ts';
import type { RunError, Runner } from './exec.ts';
import { cleanEnv } from './launcher.ts';
import { type StopResult, type StopTarget, StopError, stopServer } from './ports-stop.ts';
import { resolveMemoryBin } from './memory.ts';
import { sanitizeLine } from './sanitize.ts';

/** PORTS-1.1: the four reads, argv only. */
export const LISTEN_ARGS = ['-nP', '-iTCP', '-sTCP:LISTEN', '-FpcRn'] as const;
/** `-nP` tells it from Fleet's own working-directory read, which a World passes to the real lsof. */
export const cwdArgs = (pids: readonly number[]) => ['-nP', '-a', '-d', 'cwd', '-Fpn', '-p', pids.join(',')];
export const PS_PORTS_ARGS = ['-axo', 'pid=,ppid=,pgid=,etime='] as const;
export const DEVCTL_ARGS = ['ps', '--json'] as const;
const TIMEOUT_MS = 2000;
const CHECKOUT_TTL_MS = 60_000;

/**
 * tb-devctl like the Work tools: `LOOKOUT_TB_DEVCTL_BIN`, then PATH, then `~/.local/bin` (where
 * cli-toolbox installs it; a server started by launchd has a short PATH). Unfound, the bare name,
 * whose run fails with ENOENT: no labels and no owners (PORTS-1.1).
 */
export function resolveDevctlBin(env: NodeJS.ProcessEnv = process.env): string {
  if (env.LOOKOUT_TB_DEVCTL_BIN) return env.LOOKOUT_TB_DEVCTL_BIN;
  for (const dir of [...(env.PATH ?? '').split(delimiter).filter(Boolean), join(env.HOME || homedir(), '.local', 'bin')]) {
    const candidate = join(dir, 'tb-devctl');
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return 'tb-devctl';
}

/** PORTS-1.4: the checkout holding `cwd`, by the `.git` folder or file above it; a Worktree's names its common git directory. */
export function findCheckout(cwd: string): Checkout | null {
  for (let dir = cwd; ; dir = dirname(dir)) {
    const dotGit = join(dir, '.git');
    try {
      const stat = statSync(dotGit);
      if (stat.isDirectory()) return { root: dir, commonDir: dotGit };
      if (stat.isFile()) {
        const gitDir = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'))?.[1];
        if (!gitDir) return null;
        const own = resolve(dir, gitDir);
        try {
          return { root: dir, commonDir: resolve(own, readFileSync(join(own, 'commondir'), 'utf8').trim()) };
        } catch {
          return { root: dir, commonDir: own };
        }
      }
    } catch {
      // no .git here
    }
    if (dir === dirname(dir)) return null;
  }
}

/** Why the listener query failed, in a few words. */
function failure(e: RunError): string {
  if (e.timedOut) return 'lsof timed out';
  if (e.code === 'ENOENT') return 'lsof was not found';
  return sanitizeLine(e.stderr?.trim().split('\n')[0] || e.message, 200) ?? 'lsof failed';
}

/**
 * PORTS-1.1: the listener query's answer: lsof exits 1 and prints nothing when nothing listens (its
 * warnings say nothing of that), an empty list; any other failure is why it failed.
 */
export function listenersFrom(result: PromiseSettledResult<string>): Listener[] | string {
  if (result.status === 'fulfilled') return parseListeners(result.value);
  const e = result.reason as RunError;
  const said = (e.stderr ?? '').split('\n').filter((l) => l.trim() && !/^lsof: WARNING:/.test(l));
  if (e.code === 1 && !e.timedOut && !e.stdout?.trim() && !said.length) return [];
  return failure(e);
}

export interface PortsMonitorOptions {
  runner: Runner;
  sessions(): readonly PortsSession[];
  onChange(ports: PortsSnapshot): void;
  pid?: number;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  checkout?: (cwd: string) => Checkout | null;
  /** PORTS-4: the Stop itself; `stopServer` unless a test replaces it. */
  stop?: typeof stopServer;
}

/**
 * PORTS-1.1, 1.2: the Local servers, read every 5 s while a tab is connected, one read at a time,
 * shared by every tab; the Runner owns and cancels each read's process group.
 */
export class PortsMonitor {
  private current: PortsSnapshot | null = null;
  private watchers = 0;
  private timer: NodeJS.Timeout | null = null;
  private ticking: Promise<void> | null = null;
  private lastStarted = -Infinity;
  private readonly abort = new AbortController();
  private readonly now: () => number;
  /** PORTS-1.5: each pid and command's start time, from the first read that saw them. */
  private starts = new Map<string, number>();
  private readonly checkouts = new Map<string, { value: Checkout | null; at: number }>();
  private readonly stopping = new Set<number>();
  private readonly opts: PortsMonitorOptions;

  constructor(opts: PortsMonitorOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  snapshot(): PortsSnapshot | null {
    return this.current;
  }

  watch(): () => void {
    this.watchers++;
    if (this.watchers === 1) void this.tick();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.watchers = Math.max(0, this.watchers - 1);
      if (!this.watchers) this.clearTimer();
    };
  }

  /**
   * PORTS-4: stops one Local server, one Stop per pid at a time, then reads the list again so the
   * row goes without waiting for the next read.
   */
  async stop(target: StopTarget): Promise<StopResult> {
    if (this.stopping.has(target.pid)) throw new StopError(409, 'Already stopping it.');
    this.stopping.add(target.pid);
    try {
      const result = await (this.opts.stop ?? stopServer)({ runner: this.opts.runner, sessions: this.opts.sessions, pid: this.opts.pid, env: this.opts.env, now: this.opts.now }, target);
      // A read under way may have started before the Stop; the one after it sees the change.
      await this.ticking;
      await this.tick();
      return result;
    } finally {
      this.stopping.delete(target.pid);
    }
  }

  async close(): Promise<void> {
    this.watchers = 0;
    this.clearTimer();
    this.abort.abort();
    await this.ticking;
  }

  tick(): Promise<void> {
    if (this.abort.signal.aborted) return Promise.resolve();
    if (!this.ticking) {
      this.clearTimer();
      this.lastStarted = this.now();
      this.ticking = this.poll().finally(() => {
        this.ticking = null;
        this.schedule();
      });
    }
    return this.ticking;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.clearTimer();
    if (!this.watchers || this.abort.signal.aborted) return;
    this.timer = setTimeout(() => { this.timer = null; void this.tick(); }, Math.max(0, this.lastStarted + PORTS_INTERVAL_MS - this.now()));
    this.timer.unref?.();
  }

  private checkout(cwd: string): Checkout | null {
    const now = this.now();
    const kept = this.checkouts.get(cwd);
    if (kept && now - kept.at < CHECKOUT_TTL_MS) return kept.value;
    const value = (this.opts.checkout ?? findCheckout)(cwd);
    this.checkouts.set(cwd, { value, at: now });
    return value;
  }

  private async poll(): Promise<void> {
    const env = cleanEnv(this.opts.env ?? process.env);
    const options = { timeoutMs: TIMEOUT_MS, env, signal: this.abort.signal };
    const lsof = resolveMemoryBin('lsof', env);
    const [listen, ps, devctl] = await Promise.allSettled([
      this.opts.runner(lsof, LISTEN_ARGS, options),
      this.opts.runner(resolveMemoryBin('ps', env), PS_PORTS_ARGS, options),
      this.opts.runner(resolveDevctlBin(env), DEVCTL_ARGS, options),
    ]);
    if (this.abort.signal.aborted) return;
    const listeners = listenersFrom(listen);
    if (typeof listeners === 'string') {
      this.publish({ servers: this.current?.servers ?? [], readAt: this.current?.readAt ?? null, error: listeners });
      return;
    }
    let cwds = new Map<number, string>();
    if (listeners.length) {
      try {
        cwds = parseCwds(await this.opts.runner(lsof, cwdArgs(listeners.map((l) => l.pid)), options));
      } catch (e) {
        if (this.abort.signal.aborted) return;
        // A pid gone since the first query fails the run; the others are still printed.
        cwds = parseCwds((e as RunError).stdout ?? '');
      }
    }
    const readAt = this.now();
    const seen = new Map<string, number>();
    const servers = attribute({
      listeners,
      cwds,
      ps: ps.status === 'fulfilled' ? parseProcessTimes(ps.value) : null,
      devctl: devctl.status === 'fulfilled' ? parseDevctl(devctl.value) : [],
      sessions: this.opts.sessions(),
      lookoutPid: this.opts.pid ?? process.pid,
      home: env.HOME || homedir(),
      checkout: (cwd) => this.checkout(cwd),
      startedAt: (pid, command, elapsedMs) => {
        const key = `${pid}\0${command}`;
        const at = this.starts.get(key) ?? Math.round((readAt - elapsedMs) / 1000) * 1000;
        seen.set(key, at);
        return at;
      },
    });
    // A failed `ps` shows no start time, but keeps the ones it knew for the next good read.
    if (ps.status === 'rejected') for (const l of listeners) {
      const key = `${l.pid}\0${l.command}`;
      const kept = this.starts.get(key);
      if (kept !== undefined) seen.set(key, kept);
    }
    this.starts = seen;
    for (const [cwd, kept] of this.checkouts) if (readAt - kept.at >= CHECKOUT_TTL_MS) this.checkouts.delete(cwd);
    this.publish({ servers, readAt, error: null });
  }

  /** PORTS-1.2: sent only when something changed; a good read's time alone isn't a change. */
  private publish(next: PortsSnapshot): void {
    const key = (s: PortsSnapshot) => JSON.stringify({ ...s, readAt: s.error ? s.readAt : 0 });
    const same = this.current && key(this.current) === key(next);
    this.current = next;
    if (!same) this.opts.onChange(next);
  }
}
