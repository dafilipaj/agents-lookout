import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  type Credits,
  type ExtraUsage,
  type JevStatus,
  type ProviderState,
  type ProviderUsage,
  type UsageProviderId,
  type UsageSnapshot,
  type UsageWindow,
  WINDOW_KINDS,
  type WindowKind,
  tightestFirst,
} from '../shared/usage.ts';
import type { RunError, Runner } from './exec.ts';
import { cleanEnv } from './launcher.ts';
import { sanitizeLine } from './sanitize.ts';

/** USAGE-1.3: the limits are re-read this often (Fleet caches them for 60 s anyway). */
export const USAGE_INTERVAL_MS = 60_000;
/** An explicit refresh (a window just reset) re-reads at most this often. */
export const USAGE_REFRESH_MIN_MS = 15_000;
const FLEET_USAGE_TIMEOUT_MS = 15_000;
const JEV_TIMEOUT_MS = 3000;

export const CODEX_NOT_YET = 'Codex usage: not available yet';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const label = (v: unknown, max = 60): string | null => sanitizeLine(v, max);

/** An RFC 3339 time, or null when missing or unreadable. */
function rfc3339(v: unknown): number | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** Fleet answered with something that isn't the documented shape. */
export class UsageShapeError extends Error {}

const PROVIDER_STATUS = ['ok', 'stale', 'no_data', 'not_installed', 'error'] as const;
type ProviderStatus = (typeof PROVIDER_STATUS)[number];

/**
 * `fleet usage --json`. The fork adds `providers[]` (Claude and Codex, each with `status`,
 * `limits[]`, `fetched_at`, `observed_at`, `error`, `credits`), which is preferred. Without it
 * (upstream Fleet) only the top-level Claude fields exist. Enums are allowlisted, texts bounded
 * and redacted; any other shape throws UsageShapeError.
 */
export function parseFleetUsage(stdout: string): Partial<Record<UsageProviderId, ProviderUsage>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new UsageShapeError("Fleet's usage answer isn't JSON");
  }
  if (!isObj(parsed)) throw new UsageShapeError("Fleet's usage answer has an unknown shape");
  const extra = readExtra(parsed.extra_usage);

  if ('providers' in parsed) {
    if (!Array.isArray(parsed.providers)) throw new UsageShapeError("Fleet's usage providers aren't a list");
    const out: Partial<Record<UsageProviderId, ProviderUsage>> = {};
    for (const entry of parsed.providers) {
      if (!isObj(entry) || (entry.id !== 'claude' && entry.id !== 'codex') || out[entry.id]) continue;
      out[entry.id] = fromProviderEntry(entry.id, entry, entry.id === 'claude' ? extra : null);
    }
    return out;
  }

  // Upstream Fleet: the top-level fields are Claude's.
  if (!Array.isArray(parsed.limits)) throw new UsageShapeError("Fleet's usage answer has no limits");
  const { windows, rejected } = readWindows(parsed.limits);
  const error = sanitizeLine(parsed.error) ?? (rejected && !windows.length ? NOT_UNDERSTOOD : null);
  const at = rfc3339(parsed.fetched_at);
  const stale = parsed.stale === true;
  const account = isObj(parsed.account) ? parsed.account : {};
  let state: ProviderState = windows.length ? 'ok' : error ? classifyReason(error) : 'no-data';
  if (windows.length && error && !stale) state = 'error'; // limits with an error are not "ok"
  return {
    claude: {
      id: 'claude',
      state,
      reason: error,
      plan: label(account.plan_label),
      windows: state === 'ok' ? windows : [],
      extra,
      credits: null,
      fetchedAt: at,
      observedAt: at,
      stale,
    },
  };
}

function fromProviderEntry(id: UsageProviderId, e: Json, extra: ExtraUsage | null): ProviderUsage {
  const status = PROVIDER_STATUS.includes(e.status as ProviderStatus) ? (e.status as ProviderStatus) : null;
  const error = sanitizeLine(e.error);
  const base = {
    id,
    plan: label(e.plan),
    extra,
    credits: readCredits(e.credits),
    fetchedAt: rfc3339(e.fetched_at),
    observedAt: rfc3339(e.observed_at),
  };
  if (!status || !Array.isArray(e.limits)) {
    return { ...base, state: 'error', reason: "Fleet sent usage Lookout doesn't understand", windows: [], stale: false };
  }
  const { windows, rejected } = readWindows(e.limits);
  // A list that wasn't empty but held nothing Lookout understands is an error, not "no data".
  if (rejected && !windows.length && (status === 'ok' || status === 'stale')) {
    return { ...base, state: 'error', reason: error ?? NOT_UNDERSTOOD, windows: [], stale: false };
  }
  switch (status) {
    case 'ok':
      if (!windows.length) return { ...base, state: 'no-data', reason: error ?? 'No usage recorded yet.', windows, stale: false };
      return { ...base, state: 'ok', reason: error, windows, stale: error !== null };
    case 'stale':
      if (!windows.length) return { ...base, state: 'error', reason: error ?? 'Fleet has only old usage, and no numbers', windows, stale: true };
      return { ...base, state: 'ok', reason: error ?? 'Fleet served its last numbers', windows, stale: true };
    case 'no_data':
      return { ...base, state: 'no-data', reason: error ?? 'No usage recorded yet.', windows: [], stale: false };
    case 'not_installed':
      return { ...base, state: 'not-installed', reason: error ?? 'not installed', windows: [], stale: false };
    case 'error':
      return { ...base, state: error ? classifyReason(error) : 'error', reason: error ?? 'Fleet could not read usage', windows: [], stale: false };
  }
}

/** The windows Lookout understands, and how many entries it had to reject. */
function readWindows(limits: unknown[]): { windows: UsageWindow[]; rejected: number } {
  const windows: UsageWindow[] = [];
  let rejected = 0;
  for (const l of limits) {
    const percent = isObj(l) ? num(l.percent) : null;
    if (!isObj(l) || !WINDOW_KINDS.includes(l.kind as WindowKind) || percent === null) {
      rejected++;
      continue;
    }
    windows.push({
      kind: l.kind as WindowKind,
      label: label(l.label) ?? String(l.kind),
      model: label(l.model, 40),
      percent: Math.max(0, Math.min(100, percent)),
      resetsAt: rfc3339(l.resets_at),
    });
  }
  return { windows: tightestFirst(windows), rejected };
}

const NOT_UNDERSTOOD = "Fleet sent limits Lookout doesn't understand";

function readExtra(x: unknown): ExtraUsage | null {
  if (!isObj(x) || typeof x.enabled !== 'boolean') return null;
  const currency = typeof x.currency === 'string' && /^[A-Z]{3}$/.test(x.currency) ? x.currency : null;
  return { enabled: x.enabled, used: num(x.used) ?? 0, limit: num(x.limit), currency, percent: Math.max(0, Math.min(100, num(x.percent) ?? 0)) };
}

function readCredits(c: unknown): Credits | null {
  if (!isObj(c) || typeof c.has_credits !== 'boolean' || typeof c.unlimited !== 'boolean') return null;
  const balance = typeof c.balance === 'string' && /^-?\d+(\.\d+)?$/.test(c.balance) ? c.balance : num(c.balance)?.toString() ?? null;
  return { hasCredits: c.has_credits, unlimited: c.unlimited, balance };
}

function classifyReason(reason: string): 'signed-out' | 'error' {
  return /login|sign(ed)? ?in|expired|credential/i.test(reason) ? 'signed-out' : 'error';
}

const blank = { plan: null, windows: [], extra: null, credits: null, fetchedAt: null, observedAt: null, stale: false };

/** Both providers when `fleet usage` itself failed (it exits 1 with no JSON when Claude can't be read). */
export function usageFailure(err: unknown): Record<UsageProviderId, ProviderUsage> {
  const e = err as RunError;
  if (e.code === 'ENOENT') {
    const reason = "Fleet isn't installed.";
    return {
      claude: { id: 'claude', state: 'not-installed', reason, ...blank },
      codex: { id: 'codex', state: 'not-installed', reason, ...blank },
    };
  }
  const why =
    err instanceof UsageShapeError
      ? err.message
      : e.timedOut
        ? 'Fleet took too long'
        : (sanitizeLine(e.stderr) ?? sanitizeLine(e.message) ?? 'unknown error');
  const reason = `usage unavailable: ${why}`.slice(0, 180);
  return {
    claude: { id: 'claude', state: 'error', reason, ...blank },
    codex: { id: 'codex', state: 'error', reason, ...blank },
  };
}

export function codexNotYet(): ProviderUsage {
  return { id: 'codex', state: 'unavailable', reason: CODEX_NOT_YET, ...blank };
}

/** When a provider's numbers were true: Codex's last turn; Claude's read (or legacy fetch). */
export function observedAt(p: ProviderUsage): number | null {
  return p.id === 'codex' ? p.observedAt : (p.observedAt ?? p.fetchedAt);
}

const OLDER_THAN_SHOWN = 'Fleet returned older numbers than before';

/**
 * USAGE-2.2: what to show for a new reading, given the high-water mark: the newest numbers
 * accepted so far. A failure keeps those numbers, marked old, with the new reason. A reading
 * older than the mark keeps showing the mark's numbers, marked old, until Fleet returns
 * something at least as new.
 */
export function acceptReading(
  highWater: ProviderUsage | undefined,
  next: ProviderUsage,
): { shown: ProviderUsage; highWater: ProviderUsage | undefined } {
  const hwAt = highWater ? observedAt(highWater) : null;
  const nextAt = observedAt(next);
  const olderThanMark = hwAt !== null && nextAt !== null && nextAt < hwAt - 1000;

  if (next.state === 'error' || next.state === 'signed-out') {
    if (!highWater) return { shown: next, highWater };
    return { shown: { ...highWater, state: next.state, reason: next.reason, stale: true }, highWater };
  }
  if (next.state !== 'ok') return { shown: next, highWater };
  if (olderThanMark) return { shown: { ...highWater!, stale: true, reason: next.reason ?? OLDER_THAN_SHOWN }, highWater };
  // Only a good, current reading moves the mark.
  return { shown: next, highWater: next.stale ? highWater : next };
}

/** tb-jev on PATH, or in ~/.local/bin (where cli-toolbox installs it); found without running it. */
export function resolveJevBin(env: NodeJS.ProcessEnv = process.env): string | null {
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  dirs.push(join(env.HOME || homedir(), '.local', 'bin'));
  for (const dir of dirs) {
    const candidate = join(dir, 'tb-jev');
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

/** Jev is re-checked at most this often, besides on start and when the details open. */
export const JEV_INTERVAL_MS = 5 * 60_000;
/** Opening the details re-checks Jev at most this often. */
export const JEV_REFRESH_MIN_MS = 10_000;

export const JEV_UPDATE_NEEDED = 'update tb-jev (needs 0.2+ for status)';
const JEV_NOT_UNDERSTOOD = "tb-jev status printed something Lookout doesn't understand";

const KEY_SOURCES = ['env', 'config', 'none'] as const;
const KEY_SOURCE_LABEL: Record<(typeof KEY_SOURCES)[number], string> = { env: 'env TYPESAFE_API_KEY', config: 'config file', none: 'none' };

/**
 * USAGE-1.4: `tb-jev status --json` only. It makes no network call and never prints the key.
 * Never `doctor` (a billed evaluation), `ask`, nor `--version` (checks for updates online).
 * Exit 0: ready; 4: not ready (the object still printed); 2: clap refused `status` (tb-jev
 * 0.1); anything else: an error. The object is validated: a malformed or self-contradicting
 * one is an error, never "ready".
 */
export async function probeJev(runner: Runner, bin: string | null, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<JevStatus> {
  const none = { version: null, keySource: null, baseUrl: null, configPath: null };
  if (!bin) return { state: 'not-installed', reason: 'not installed', ...none };
  let out: string;
  let exit = 0;
  try {
    out = await runner(bin, ['status', '--json'], { timeoutMs: JEV_TIMEOUT_MS, env, signal });
  } catch (err) {
    const e = err as RunError;
    if (e.aborted) return { state: 'error', reason: 'cancelled', ...none };
    if (e.code === 'ENOENT') return { state: 'not-installed', reason: 'not installed', ...none };
    if (e.timedOut) return { state: 'error', reason: 'tb-jev status took too long', ...none };
    if (e.code === 2) return { state: 'unavailable', reason: JEV_UPDATE_NEEDED, ...none };
    if (e.code !== 4) return { state: 'error', reason: `tb-jev status failed (exit ${typeof e.code === 'number' ? e.code : '?'})`, ...none };
    exit = 4;
    out = e.stdout ?? '';
  }
  let j: unknown;
  try {
    j = JSON.parse(out);
  } catch {
    return { state: 'error', reason: JEV_NOT_UNDERSTOOD, ...none };
  }
  if (
    !isObj(j) ||
    typeof j.ready !== 'boolean' ||
    typeof j.version !== 'string' ||
    !/^[0-9A-Za-z.+-]{1,32}$/.test(j.version) ||
    !KEY_SOURCES.includes(j.key_source as (typeof KEY_SOURCES)[number])
  ) {
    return { state: 'error', reason: JEV_NOT_UNDERSTOOD, ...none };
  }
  const source = j.key_source as (typeof KEY_SOURCES)[number];
  // Ready must agree with the exit code and with having a key.
  if (j.ready !== (exit === 0) || (j.ready && (source === 'none' || j.key_present !== true))) {
    return { state: 'error', reason: 'tb-jev status contradicts itself', ...none };
  }
  const details = {
    version: j.version,
    keySource: KEY_SOURCE_LABEL[source],
    // tb-jev already reduces it to scheme://host[:port]; anything else isn't shown.
    baseUrl: typeof j.base_url === 'string' && /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(j.base_url) ? j.base_url : null,
    configPath: j.config_used === true ? sanitizeLine(j.config_path, 200) : null,
  };
  if (j.ready) return { state: 'ready', reason: null, ...details };
  return { state: 'not-set-up', reason: `not set up: ${sanitizeLine(j.error_reason, 140) ?? 'no key found'}`, ...details };
}

export interface UsageMonitorOptions {
  runner: Runner;
  fleetBin: () => string;
  jevBin?: () => string | null;
  onChange(usage: UsageSnapshot): void;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  intervalMs?: number;
  /** How long `fleet usage` may take (15 s). */
  fleetTimeoutMs?: number;
}

/**
 * One poller for every tab: `fleet usage --json` every 60 s while a tab is connected, and the
 * Jev probe rarely. Each has one run in flight at most, shared by every caller. `close()`
 * cancels what runs (killing its process group) and waits until it has exited.
 */
export class UsageMonitor {
  private current: UsageSnapshot | null = null;
  private readonly highWater = new Map<UsageProviderId, ProviderUsage>();
  private jev: { at: number; value: JevStatus } | null = null;
  private jevInFlight: Promise<JevStatus> | null = null;
  private ticking: Promise<void> | null = null;
  private lastTickAt = -Infinity;
  private watchers = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly abort = new AbortController();
  private readonly opts: UsageMonitorOptions;
  private readonly now: () => number;

  constructor(opts: UsageMonitorOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  snapshot(): UsageSnapshot | null {
    return this.current;
  }

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

  /** Stops polling, cancels running commands, and resolves once they have exited. */
  async close(): Promise<void> {
    this.stop();
    this.abort.abort();
    await Promise.allSettled([this.ticking, this.jevInFlight]);
  }

  /** One read; concurrent callers share the read in flight. */
  tick(): Promise<void> {
    if (this.abort.signal.aborted) return Promise.resolve();
    this.ticking ??= this.poll().finally(() => {
      this.ticking = null;
    });
    return this.ticking;
  }

  /** A window just reset (USAGE-2.2): read again now, at most every 15 s. */
  async refresh(): Promise<void> {
    if (this.ticking) return this.ticking;
    if (this.now() - this.lastTickAt < USAGE_REFRESH_MIN_MS) return;
    return this.tick();
  }

  /** The details opened: check Jev again now (at most every 10 s). */
  async refreshJev(): Promise<void> {
    const jev = await this.readJev(true);
    if (this.current) this.publish({ ...this.current, jev });
  }

  private async loop(): Promise<void> {
    if (this.timer || this.abort.signal.aborted) return;
    const started = this.now();
    await this.tick();
    if (this.watchers === 0 || this.timer || this.abort.signal.aborted) return;
    // The next read is due a full interval after this one started, so the cadence doesn't drift.
    const wait = Math.max(0, (this.opts.intervalMs ?? USAGE_INTERVAL_MS) - (this.now() - started));
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.loop();
    }, wait);
    this.timer.unref?.();
  }

  private async poll(): Promise<void> {
    this.lastTickAt = this.now();
    const [providers, jev] = await Promise.all([this.readProviders(), this.readJev(false)]);
    if (this.abort.signal.aborted) return;
    this.publish({ providers, jev, checkedAt: this.now() });
  }

  private readJev(asked: boolean): Promise<JevStatus> {
    const age = this.jev ? this.now() - this.jev.at : Infinity;
    if (this.jev && age < (asked ? JEV_REFRESH_MIN_MS : JEV_INTERVAL_MS)) return Promise.resolve(this.jev.value);
    this.jevInFlight ??= probeJev(this.opts.runner, (this.opts.jevBin ?? resolveJevBin)(), this.env, this.abort.signal)
      .then((value) => {
        this.jev = { at: this.now(), value };
        return value;
      })
      .finally(() => {
        this.jevInFlight = null;
      });
    return this.jevInFlight;
  }

  private get env() {
    return cleanEnv(this.opts.env ?? process.env);
  }

  private async readProviders(): Promise<ProviderUsage[]> {
    let read: Partial<Record<UsageProviderId, ProviderUsage>>;
    try {
      const out = await this.opts.runner(this.opts.fleetBin(), ['--local', 'usage', '--json'], {
        timeoutMs: this.opts.fleetTimeoutMs ?? FLEET_USAGE_TIMEOUT_MS,
        env: this.env,
        signal: this.abort.signal,
      });
      read = parseFleetUsage(out);
    } catch (err) {
      read = this.failedRead(err);
    }
    const shown = (id: UsageProviderId, next: ProviderUsage) => {
      const { shown, highWater } = acceptReading(this.highWater.get(id), next);
      if (highWater) this.highWater.set(id, highWater);
      return shown;
    };
    return [
      shown('claude', read.claude ?? { id: 'claude', state: 'error', reason: 'No Claude usage in Fleet’s answer', ...blank }),
      shown('codex', read.codex ?? codexNotYet()),
    ];
  }

  /**
   * Fleet exits 1 when Claude can't be read, but still prints JSON with `providers` (Claude
   * with its error, Codex live). Only when there's no such JSON are both providers unavailable.
   */
  private failedRead(err: unknown): Partial<Record<UsageProviderId, ProviderUsage>> {
    const e = err as RunError;
    const out = e.code === 1 ? (e.stdout ?? '').trim() : '';
    if (out.startsWith('{')) {
      try {
        const j = JSON.parse(out) as unknown;
        if (isObj(j) && Array.isArray(j.providers)) return parseFleetUsage(out);
      } catch {
        // fall through
      }
    }
    return usageFailure(err);
  }

  private publish(next: UsageSnapshot): void {
    const same = this.current && JSON.stringify({ ...this.current, checkedAt: 0 }) === JSON.stringify({ ...next, checkedAt: 0 });
    this.current = next;
    if (!same) this.opts.onChange(next);
  }
}
