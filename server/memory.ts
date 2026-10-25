import { accessSync, constants } from 'node:fs';
import { cpus, loadavg, totalmem } from 'node:os';
import { delimiter, join } from 'node:path';
import { MEMORY_INTERVAL_MS, MemoryHistory, buildOwners, parseProcesses, type MemoryRoot, type MemorySnapshot, type Pressure } from '../shared/memory.ts';
import type { Runner } from './exec.ts';
import { cleanEnv } from './launcher.ts';
import { sanitizeLine } from './sanitize.ts';

export const PS_ARGS = ['-axo', 'pid=,ppid=,rss=,%cpu=,comm='] as const;
export const SYSCTL_ARGS = ['-n', 'hw.memsize', 'kern.memorystatus_vm_pressure_level'] as const;
const OPEN_INTERVAL_MS = 5000;
const OPEN_MIN_MS = 2000;

/** A launchd PATH can lack the system directories; tests and Worlds put their fakes first. */
export function resolveMemoryBin(name: 'ps' | 'sysctl', env: NodeJS.ProcessEnv = process.env): string {
  const fallback = name === 'ps' ? '/bin' : '/usr/sbin';
  for (const dir of [...(env.PATH ?? '').split(delimiter).filter(Boolean), fallback]) {
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return join(fallback, name);
}

export interface MemoryMonitorOptions {
  runner: Runner;
  sessions(): readonly MemoryRoot[];
  onChange(memory: MemorySnapshot): void;
  pid?: number;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  totalmem?: () => number;
  load?: () => MemorySnapshot['load'];
}

/** One machine-wide read shared by all tabs; the Runner owns and cancels both process groups. */
export class MemoryMonitor {
  private current: MemorySnapshot | null = null;
  private readonly history = new MemoryHistory();
  private readonly generations = new Map<string, number>();
  private readonly open = new Set<string>();
  private watchers = 0;
  private timer: NodeJS.Timeout | null = null;
  private ticking: Promise<void> | null = null;
  private lastStarted = -Infinity;
  private readonly abort = new AbortController();
  private readonly now: () => number;
  private ramBytes: number;

  private readonly opts: MemoryMonitorOptions;

  constructor(opts: MemoryMonitorOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.ramBytes = (opts.totalmem ?? totalmem)();
  }

  snapshot(): MemorySnapshot | null {
    return this.current ? { ...this.current, trend: this.history.readTrend(this.now()) } : null;
  }

  growthFor(root: MemoryRoot): number | null {
    if (this.generations.get(root.id) !== root.pid) return null;
    return this.current?.sessions.find((r) => r.id === root.id)?.growthBytes ?? null;
  }

  /** A row disappearing between samples drops its history too, even if it returns before the next. */
  prune(): void {
    const roots = this.opts.sessions();
    this.history.prune([...roots, { id: 'lookout', pid: this.opts.pid ?? process.pid }]);
    const live = new Map(roots.map((r) => [r.id, r.pid]));
    for (const [id, pid] of this.generations) if (live.get(id) !== pid) this.generations.delete(id);
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

  setOpen(clientId: string, open: boolean): void {
    if (this.open.has(clientId) === open) return;
    if (open) this.open.add(clientId);
    else this.open.delete(clientId);
    if (!this.watchers || this.ticking || this.abort.signal.aborted) return;
    this.schedule(open ? Math.max(0, OPEN_MIN_MS - (this.now() - this.lastStarted)) : undefined);
  }

  drop(clientId: string): void { this.setOpen(clientId, false); }

  async close(): Promise<void> {
    this.watchers = 0;
    this.open.clear();
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

  private schedule(delay?: number): void {
    this.clearTimer();
    if (!this.watchers || this.abort.signal.aborted) return;
    const cadence = this.open.size ? OPEN_INTERVAL_MS : MEMORY_INTERVAL_MS;
    this.timer = setTimeout(() => { this.timer = null; void this.tick(); }, delay ?? Math.max(0, this.lastStarted + cadence - this.now()));
    this.timer.unref?.();
  }

  private async poll(): Promise<void> {
    const env = cleanEnv(this.opts.env ?? process.env);
    const options = { timeoutMs: 2000, env, signal: this.abort.signal };
    const [ps, sysctl] = await Promise.allSettled([
      this.opts.runner(resolveMemoryBin('ps', env), PS_ARGS, options),
      this.opts.runner(resolveMemoryBin('sysctl', env), SYSCTL_ARGS, options),
    ]);
    if (this.abort.signal.aborted) return;
    if (ps.status === 'rejected') {
      if (this.current) this.publish({ ...this.current, old: true, trend: this.history.readTrend(this.now()) });
      return;
    }
    let pressure: Pressure = 'normal';
    if (sysctl.status === 'fulfilled') {
      const [ram, level] = sysctl.value.trim().split(/\s+/).map(Number);
      if (ram && Number.isSafeInteger(ram) && ram > 0) this.ramBytes = ram;
      pressure = level === 4 ? 'critical' : level === 2 ? 'warn' : 'normal';
    }
    const processes = parseProcesses(ps.value).map((p) => ({ ...p, name: sanitizeLine(p.name, 120) ?? 'unknown' }));
    const roots = this.opts.sessions();
    const pid = this.opts.pid ?? process.pid;
    const owners = buildOwners(processes, pid, roots);
    const sampledAt = this.now();
    const growth = this.history.record(sampledAt, owners.watchedBytes, [
      { id: 'lookout', pid, bytes: owners.lookout.bytes },
      ...roots.map((r) => ({ ...r, bytes: owners.sessions.find((s) => s.id === r.id)!.bytes })),
    ]);
    this.generations.clear();
    for (const root of roots) this.generations.set(root.id, root.pid);
    for (const row of [owners.lookout, ...owners.sessions]) row.growthBytes = growth.get(row.id) ?? null;
    const load = (this.opts.load ?? (() => ({ one: loadavg()[0]!, cores: cpus().length })))();
    this.publish({ ...owners, sampledAt, old: false, ramBytes: this.ramBytes, pressure, trend: [...this.history.trend], load });
  }

  private publish(next: MemorySnapshot): void {
    const same = this.current && JSON.stringify({ ...this.current, sampledAt: 0 }) === JSON.stringify({ ...next, sampledAt: 0 });
    this.current = next;
    if (!same) this.opts.onChange(next);
  }
}
