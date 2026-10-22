import { FLEET_INSTALL_COMMAND } from '../shared/defaults.ts';
import type { FleetHealth, PendingEffort, PendingModel, SessionRow, Status } from '../shared/types.ts';
import type { FleetListResult, FleetRow } from './fleet.ts';
import type { GitCache } from './git.ts';
import { normalizeRows } from './normalize.ts';

export type MonitorEvent =
  | { type: 'sessions'; upsert: SessionRow[]; remove: string[] }
  | { type: 'fleet'; fleet: FleetHealth };

export interface MonitorOptions {
  fetchList(): Promise<FleetListResult>;
  git: Pick<GitCache, 'get' | 'prune'>;
  onEvent(event: MonitorEvent): void;
  /** After each successful poll, once its changes are out (LAUNCH follows its starts here). */
  onList?(rows: readonly FleetRow[]): void;
  /** VIEW-6.7, VIEW-7.7: switches still waiting for the Session's next reply, carried as `pendingModel` and `pendingEffort`. */
  models?: {
    observe(rows: readonly SessionRow[], raw: readonly FleetRow[]): void;
    pendingFor(row: SessionRow): PendingModel | null;
    pendingEffortFor(row: SessionRow): PendingEffort | null;
  };
  intervalMs?: number;
  now?: () => number;
}

/** How often the monitor polls `fleet list`: a status change can reach Lookout up to this late. */
export const MONITOR_INTERVAL_MS = 2000;

/**
 * Polls `fleet list --json` every 2 s while anyone is watching, keeps the current rows, and
 * reports changes as diffs. On a failed poll the last rows stay (SIDE-6.2).
 */
export class SessionMonitor {
  private rows = new Map<string, SessionRow>();
  private serialized = new Map<string, string>();
  private since = new Map<string, { status: Status; at: number }>();
  private lastRaw: FleetRow[] = [];
  private health: FleetHealth = { state: 'starting' };
  private lastOkAt: number | null = null;
  private watchers = 0;
  private timer: NodeJS.Timeout | null = null;
  private ticking: Promise<void> | null = null;
  private readonly opts: MonitorOptions;
  private readonly intervalMs: number;
  private readonly now: () => number;

  constructor(opts: MonitorOptions) {
    this.opts = opts;
    this.intervalMs = opts.intervalMs ?? MONITOR_INTERVAL_MS;
    this.now = opts.now ?? Date.now;
  }

  /** A Session as Fleet listed it in the last poll. */
  get(id: string): SessionRow | null {
    return this.rows.get(id) ?? null;
  }

  snapshot(): { sessions: SessionRow[]; fleet: FleetHealth } {
    return { sessions: [...this.rows.values()], fleet: this.health };
  }

  /** Starts polling for one more watcher; the returned function stops watching. */
  watch(): () => void {
    this.watchers++;
    if (this.watchers === 1) void this.loop();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.watchers--;
      if (this.watchers === 0 && this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    };
  }

  stop(): void {
    this.watchers = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** One poll. Exposed for tests; concurrent calls share the poll in flight. */
  tick(): Promise<void> {
    this.ticking ??= this.poll().finally(() => {
      this.ticking = null;
    });
    return this.ticking;
  }

  /**
   * A poll that starts now: one already in flight may have listed Fleet before a change (a close,
   * say), so it's waited for and a new one follows.
   */
  async pollNow(): Promise<void> {
    if (this.ticking) await this.ticking.catch(() => {});
    return this.tick();
  }

  /** Re-derives rows from the last list, e.g. after git info for a directory arrived. */
  refreshDerived(): void {
    this.apply(this.lastRaw);
  }

  private async loop(): Promise<void> {
    if (this.timer) return;
    const started = this.now();
    await this.tick();
    // Nobody watching any more, or a second loop (re-watched mid-poll) already scheduled.
    if (this.watchers === 0 || this.timer) return;
    const wait = Math.max(0, this.intervalMs - (this.now() - started));
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.loop();
    }, wait);
  }

  private async poll(): Promise<void> {
    const result = await this.opts.fetchList();
    if (result.kind === 'ok') {
      this.lastOkAt = this.now();
      this.lastRaw = result.rows;
      this.apply(result.rows);
      this.setHealth({ state: 'ok' });
      this.opts.onList?.(result.rows);
      this.opts.git.prune();
    } else if (result.kind === 'not-installed') {
      this.lastRaw = [];
      this.apply([]);
      this.setHealth({ state: 'not-installed', installCommand: FLEET_INSTALL_COMMAND });
    } else {
      this.setHealth({ state: 'failing', lastOkAt: this.lastOkAt, error: result.message });
    }
  }

  private apply(raw: FleetRow[]): void {
    const now = this.now();
    const seen = new Set<string>();
    const next = normalizeRows(raw, {
      git: (cwd) => this.opts.git.get(cwd),
      statusSince: (id, status, fleetUpdatedAt) => {
        seen.add(id);
        return this.statusSince(id, status, fleetUpdatedAt, now);
      },
    });
    for (const id of this.since.keys()) if (!seen.has(id)) this.since.delete(id);
    const models = this.opts.models;
    if (models) {
      models.observe(next, raw);
      for (const row of next) {
        row.pendingModel = models.pendingFor(row);
        row.pendingEffort = models.pendingEffortFor(row);
      }
    }

    const upsert: SessionRow[] = [];
    const nextRows = new Map<string, SessionRow>();
    const nextSerialized = new Map<string, string>();
    for (const row of next) {
      if (nextRows.has(row.id)) continue; // Fleet reports a Session once; be safe anyway.
      const json = JSON.stringify(row);
      nextRows.set(row.id, row);
      nextSerialized.set(row.id, json);
      if (this.serialized.get(row.id) !== json) upsert.push(row);
    }
    const remove = [...this.rows.keys()].filter((id) => !nextRows.has(id));
    this.rows = nextRows;
    this.serialized = nextSerialized;
    if (upsert.length || remove.length) this.opts.onEvent({ type: 'sessions', upsert, remove });
  }

  /**
   * Fleet's `updated_at` is the registry's status-change time for Claude, but a Transcript
   * mtime (or a jittery process start) for Codex. So Lookout tracks status changes itself and
   * uses Fleet's time only when it falls in the window where the change happened.
   */
  private statusSince(id: string, status: Status, fleetAt: number | null, now: number): number {
    const prev = this.since.get(id);
    let at: number;
    if (!prev) at = fleetAt !== null && fleetAt <= now ? fleetAt : now;
    else if (prev.status === status) at = prev.at;
    else at = fleetAt !== null && fleetAt > prev.at && fleetAt <= now ? fleetAt : now;
    this.since.set(id, { status, at });
    return at;
  }

  private setHealth(next: FleetHealth): void {
    if (JSON.stringify(next) === JSON.stringify(this.health)) return;
    this.health = next;
    this.opts.onEvent({ type: 'fleet', fleet: next });
  }
}
