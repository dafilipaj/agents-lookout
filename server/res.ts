import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { RES_INTERVAL_MS, attributeJobs, parseResStatus, queueOrder, type ResSession, type ResSnapshot } from '../shared/res.ts';
import type { RunError, Runner } from './exec.ts';
import { cleanEnv } from './launcher.ts';
import { sanitizeLine } from './sanitize.ts';

/** RES-1.1: the one read. */
export const RES_ARGS = ['status', '--json'] as const;
const TIMEOUT_MS = 3000;

/**
 * RES-1.1: `res` like tb-devctl (PORTS-1.1): `LOOKOUT_RES_BIN`, then PATH, then `~/.local/bin`, where
 * it's linked; a server started by launchd has a short PATH. Unfound, the bare name, whose run fails
 * with ENOENT: no queue (RES-1.2).
 */
export function resolveResBin(env: NodeJS.ProcessEnv = process.env): string {
  if (env.LOOKOUT_RES_BIN) return env.LOOKOUT_RES_BIN;
  for (const dir of [...(env.PATH ?? '').split(delimiter).filter(Boolean), join(env.HOME || homedir(), '.local', 'bin')]) {
    const candidate = join(dir, 'res');
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return 'res';
}

/** RES-1.2: why a read failed, in a few words. */
function failure(e: unknown): string {
  const r = e as RunError;
  if (r.timedOut) return 'res status timed out';
  if (e instanceof SyntaxError) return 'res status printed something other than its JSON';
  return sanitizeLine(r.stderr?.trim().split('\n')[0] || r.message || String(e), 200) ?? 'res status failed';
}

export interface ResMonitorOptions {
  runner: Runner;
  sessions(): readonly ResSession[];
  onChange(res: ResSnapshot | null): void;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

/**
 * RES-1.1, 1.2: `res`'s queue, read every 5 s while a tab is connected, one read at a time, shared
 * by every tab. `undefined` before the first read; `null` when `res` isn't installed.
 */
export class ResMonitor {
  private current: ResSnapshot | null | undefined = undefined;
  private watchers = 0;
  private timer: NodeJS.Timeout | null = null;
  private ticking: Promise<void> | null = null;
  private lastStarted = -Infinity;
  private readonly abort = new AbortController();
  private readonly now: () => number;
  private readonly opts: ResMonitorOptions;

  constructor(opts: ResMonitorOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  /** The last read; null before the first and without `res`. */
  snapshot(): ResSnapshot | null {
    return this.current ?? null;
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
    this.timer = setTimeout(() => { this.timer = null; void this.tick(); }, Math.max(0, this.lastStarted + RES_INTERVAL_MS - this.now()));
    this.timer.unref?.();
  }

  private async poll(): Promise<void> {
    const env = cleanEnv(this.opts.env ?? process.env);
    let stdout: string;
    try {
      stdout = await this.opts.runner(resolveResBin(env), RES_ARGS, { timeoutMs: TIMEOUT_MS, env, signal: this.abort.signal });
    } catch (e) {
      if (this.abort.signal.aborted) return;
      if ((e as RunError).code === 'ENOENT') this.publish(null);
      else this.fail(e);
      return;
    }
    if (this.abort.signal.aborted) return;
    let jobs;
    try {
      jobs = parseResStatus(stdout);
    } catch (e) {
      this.fail(e);
      return;
    }
    const now = this.now();
    this.publish({ jobs: queueOrder(attributeJobs(jobs, this.opts.sessions()), now), readAt: now, error: null });
  }

  /** RES-1.2: a failed read keeps the last list, with the reason. */
  private fail(e: unknown): void {
    const last = this.current ?? null;
    this.publish({ jobs: last?.jobs ?? [], readAt: last?.readAt ?? null, error: failure(e) });
  }

  /** RES-1.1: sent only when something changed; a good read's time alone isn't a change. */
  private publish(next: ResSnapshot | null): void {
    const key = (s: ResSnapshot | null | undefined) => (s === undefined ? 'unread' : JSON.stringify(s && { ...s, readAt: s.error ? s.readAt : 0 }));
    const same = key(this.current) === key(next);
    this.current = next;
    if (!same) this.opts.onChange(next);
  }
}
