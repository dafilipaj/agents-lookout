import type { UsageLevel } from './usage.ts';

export const MB = 1024 * 1024;
export const GB = 1024 * MB;
export const GROWTH_BYTES = 30 * MB;
export const GROWTH_WINDOW_MS = 10 * 60_000;
export const MEMORY_INTERVAL_MS = 30_000;
export const TREND_WINDOW_MS = 30 * 60_000;

export type Pressure = 'normal' | 'warn' | 'critical';
export interface MemoryPoint { at: number; bytes: number }
export interface MemoryRow {
  id: string;
  bytes: number;
  top: { name: string; count: number; bytes: number }[];
  growthBytes: number | null;
  cpuPct: number;
}
export interface MemorySnapshot {
  sampledAt: number;
  old: boolean;
  ramBytes: number;
  pressure: Pressure;
  watchedBytes: number;
  totalBytes: number;
  lookout: MemoryRow;
  sessions: MemoryRow[];
  otherBytes: number;
  trend: MemoryPoint[];
  load: { one: number; cores: number };
}
export interface MemoryProcess { pid: number; ppid: number; bytes: number; cpuPct: number; name: string }
export interface MemoryRoot { id: string; pid: number }

/** `comm` is last: paths, including app bundle helpers, may contain spaces. Never read argv. */
export function parseProcesses(stdout: string): MemoryProcess[] {
  const rows = new Map<number, MemoryProcess>();
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const [, pid, ppid, rss, cpu, comm] = m;
    const values = [Number(pid), Number(ppid), Number(rss) * 1024, Number(cpu)];
    if (!values.every(Number.isFinite) || !Number.isSafeInteger(values[2]) || values[0] === 0) continue;
    const name = comm!.split('/').pop()!.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120); // eslint-disable-line no-control-regex -- process names are one line
    if (!name) continue;
    rows.set(values[0]!, { pid: values[0]!, ppid: values[1]!, bytes: values[2]!, cpuPct: values[3]!, name });
  }
  return [...rows.values()];
}

/** Roots cut every other tree, so the nearest Session owns a process even inside Lookout. */
export function buildOwners(processes: readonly MemoryProcess[], lookoutPid: number, sessions: readonly MemoryRoot[]) {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const children = new Map<number, number[]>();
  for (const p of processes) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p.pid]);
  const roots = [...sessions, { id: 'lookout', pid: lookoutPid }];
  const rootPids = new Set(roots.map((r) => r.pid));
  const owned = new Set<number>();
  const rows = new Map<string, MemoryRow>();
  for (const root of roots) {
    const row: MemoryRow = { id: root.id, bytes: 0, top: [], growthBytes: null, cpuPct: 0 };
    const executables = new Map<string, { name: string; count: number; bytes: number }>();
    const stack = byPid.has(root.pid) ? [root.pid] : [];
    const visited = new Set<number>();
    while (stack.length) {
      const pid = stack.pop()!;
      if (visited.has(pid) || owned.has(pid) || (pid !== root.pid && rootPids.has(pid))) continue;
      visited.add(pid);
      const p = byPid.get(pid);
      if (!p) continue;
      owned.add(pid);
      row.bytes += p.bytes;
      row.cpuPct += p.cpuPct;
      const exe = executables.get(p.name) ?? { name: p.name, count: 0, bytes: 0 };
      exe.count++;
      exe.bytes += p.bytes;
      executables.set(p.name, exe);
      stack.push(...(children.get(pid) ?? []));
    }
    row.top = [...executables.values()].filter((e) => e.bytes >= MB).sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name)).slice(0, 3);
    rows.set(root.id, row);
  }
  const lookout = rows.get('lookout')!;
  const sessionRows = sessions.map((s) => rows.get(s.id)!).sort((a, b) => b.bytes - a.bytes || a.id.localeCompare(b.id));
  const watchedBytes = lookout.bytes + sessionRows.reduce((n, r) => n + r.bytes, 0);
  const totalBytes = processes.reduce((n, p) => n + p.bytes, 0);
  return { lookout, sessions: sessionRows, watchedBytes, totalBytes, otherBytes: totalBytes - watchedBytes };
}

export class MemoryHistory {
  trend: MemoryPoint[] = [];
  private rows = new Map<string, { pid: number; points: MemoryPoint[] }>();

  prune(roots: readonly MemoryRoot[]): void {
    const live = new Map(roots.map((r) => [r.id, r.pid]));
    for (const [id, row] of this.rows) if (live.get(id) !== row.pid) this.rows.delete(id);
  }

  readTrend(at: number): MemoryPoint[] {
    this.trend = recentTrend(this.trend, at);
    return this.trend;
  }

  record(at: number, watchedBytes: number, rows: readonly (MemoryRoot & { bytes: number })[]): Map<string, number | null> {
    this.readTrend(at);
    if (!this.trend.length || at - this.trend.at(-1)!.at >= MEMORY_INTERVAL_MS) {
      this.trend = [...this.trend, { at, bytes: watchedBytes }].slice(-60);
    }
    const live = new Set(rows.map((r) => r.id));
    for (const id of this.rows.keys()) if (!live.has(id)) this.rows.delete(id);
    const growth = new Map<string, number | null>();
    for (const r of rows) {
      const previous = this.rows.get(r.id);
      const points = previous?.pid === r.pid ? previous.points.filter((p) => p.at >= at - GROWTH_WINDOW_MS) : [];
      points.push({ at, bytes: r.bytes });
      this.rows.set(r.id, { pid: r.pid, points });
      const delta = r.bytes - points[0]!.bytes;
      growth.set(r.id, delta >= GROWTH_BYTES ? delta : null);
    }
    return growth;
  }
}

export function memoryLevel(bytes: number, ram: number, pressure: Pressure): UsageLevel {
  if (pressure === 'critical' || bytes >= ram * 2 / 3) return 'critical';
  if (pressure === 'warn' || bytes >= ram / 3) return 'warning';
  return 'normal';
}
export function loadLevel(load: MemorySnapshot['load']): UsageLevel {
  return load.one >= load.cores * 2 ? 'critical' : load.one >= load.cores ? 'warning' : 'normal';
}
export function watchedLevel(memory: MemorySnapshot): UsageLevel {
  const levels: UsageLevel[] = ['normal', 'warning', 'critical'];
  return levels[Math.max(levels.indexOf(memoryLevel(memory.watchedBytes, memory.ramBytes, memory.pressure)), levels.indexOf(loadLevel(memory.load)))]!;
}
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  return bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.round(bytes / MB)} MB`;
}

/** A minimum slice borrows proportionally from the remaining slices; the whole stays 100%. */
export function splitWidths(values: number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (!total) return values.map(() => 0);
  const widths = values.map(() => 0);
  const remaining = values.map((value, index) => ({ value, index })).filter((r) => r.value > 0);
  let available = 100;
  while (remaining.length) {
    const sum = remaining.reduce((n, r) => n + r.value, 0);
    const small = remaining.filter((r) => r.value / sum * available < 2);
    if (!small.length) {
      for (const r of remaining) widths[r.index] = r.value / sum * available;
      break;
    }
    for (const r of small) {
      widths[r.index] = 2;
      available -= 2;
      remaining.splice(remaining.indexOf(r), 1);
    }
  }
  return widths;
}

export function recentTrend(trend: readonly MemoryPoint[], now: number): MemoryPoint[] {
  return trend.filter((p) => p.at >= now - TREND_WINDOW_MS);
}

export function trendShape(history: MemoryPoint[], now = history.at(-1)?.at ?? 0) {
  const trend = recentTrend(history, now);
  if (trend.length < 2) return null;
  const min = Math.min(...trend.map((p) => p.bytes));
  const max = Math.max(...trend.map((p) => p.bytes));
  const span = Math.max(50 * MB, max - min);
  const bottom = (max + min - span) / 2;
  const start = Math.max(trend[0]!.at, trend.at(-1)!.at - TREND_WINDOW_MS);
  const points = trend.map((p) => [(p.at - start) / TREND_WINDOW_MS * 100, 100 - (p.bytes - bottom) / span * 100]);
  return { span, points, delta: trend.at(-1)!.bytes - trend[0]!.bytes };
}
