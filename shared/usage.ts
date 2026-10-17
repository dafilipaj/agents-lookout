/** USAGE: how close each Harness is to its limits, and whether Jev is set up. Provider-neutral. */

export type UsageProviderId = 'claude' | 'codex';

/** Window kinds Fleet reports (`fleet usage --json`); anything else is dropped. */
export const WINDOW_KINDS = ['session', 'session_scoped', 'weekly_all', 'weekly_scoped'] as const;
export type WindowKind = (typeof WINDOW_KINDS)[number];

/** One limit window, e.g. Claude's 5-hour session or a weekly limit. */
export interface UsageWindow {
  kind: WindowKind;
  label: string;
  /** Model a scoped window is for, when there is one. */
  model: string | null;
  /** % used, 0–100. */
  percent: number;
  /** When it resets, ms since epoch; null when unknown (or, for Codex, already passed). */
  resetsAt: number | null;
}

export interface ExtraUsage {
  enabled: boolean;
  used: number;
  limit: number | null;
  currency: string | null;
  percent: number;
}

/** Codex's credits, as Fleet reports them. */
export interface Credits {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
}

export type ProviderState =
  /** Numbers are present (possibly old: see `stale` and the times). */
  | 'ok'
  /** The Harness, or Fleet itself, isn't installed. */
  | 'not-installed'
  | 'signed-out'
  /** Read fine, but nothing to show yet. */
  | 'no-data'
  /** This Fleet doesn't report the provider. */
  | 'unavailable'
  | 'error';

export interface ProviderUsage {
  id: UsageProviderId;
  state: ProviderState;
  /** Why the numbers are missing or old, for people (one line, sanitized). */
  reason: string | null;
  plan: string | null;
  /** Tightest first: highest % used, then soonest reset. */
  windows: UsageWindow[];
  extra: ExtraUsage | null;
  credits: Credits | null;
  /** When Fleet read the numbers, ms since epoch. */
  fetchedAt: number | null;
  /** When the numbers were last true at the source (Codex: its last turn), ms since epoch. */
  observedAt: number | null;
  /** Old numbers, kept after a failed read or served stale by Fleet. */
  stale: boolean;
}

export type JevState = 'ready' | 'not-set-up' | 'not-installed' | 'unavailable' | 'error';

export interface JevStatus {
  state: JevState;
  version: string | null;
  /** Where its key comes from, for people: "env TYPESAFE_API_KEY", "config file" or "none". */
  keySource: string | null;
  /** scheme://host[:port], exactly as tb-jev reports it. */
  baseUrl: string | null;
  /** The config file's path (never its contents), when tb-jev uses one. */
  configPath: string | null;
  reason: string | null;
}

export interface UsageSnapshot {
  providers: ProviderUsage[];
  jev: JevStatus;
  /** When Lookout last asked, ms since epoch. */
  checkedAt: number;
}

/** USAGE-1.2: warning at 80% or more, critical at 95% or more. */
export type UsageLevel = 'normal' | 'warning' | 'critical';

export function usageLevel(percent: number): UsageLevel {
  if (percent >= 95) return 'critical';
  if (percent >= 80) return 'warning';
  return 'normal';
}

/** Tightest first: highest % used, then the soonest reset. */
export function tightestFirst(windows: readonly UsageWindow[]): UsageWindow[] {
  return [...windows].sort((a, b) => b.percent - a.percent || (a.resetsAt ?? Infinity) - (b.resetsAt ?? Infinity));
}

/** A window whose reset time has passed: its numbers no longer hold. */
export function hasReset(w: UsageWindow, now: number): boolean {
  return w.resetsAt !== null && w.resetsAt <= now;
}

/** The windows that still hold, tightest first (expired ones are left out of picks and hints). */
export function liveWindows(windows: readonly UsageWindow[], now: number): UsageWindow[] {
  return tightestFirst(windows.filter((w) => !hasReset(w, now)));
}

/** A short name for a window, e.g. "5h limit", "Weekly limit", "Weekly Fable limit". */
export function shortWindowLabel(w: UsageWindow): string {
  if (w.kind === 'session') return '5h limit';
  if (w.kind === 'session_scoped' && w.model) return `5h ${w.model} limit`;
  if (w.kind === 'weekly_all') return 'Weekly limit';
  if (w.kind === 'weekly_scoped' && w.model) return `Weekly ${w.model} limit`;
  return w.label;
}

/** Claude's numbers older than this are marked old: its 60 s reads must have been failing. */
export const USAGE_STALE_MS = 5 * 60_000;
/** A time this far in the future is clock skew, not freshness. */
export const CLOCK_SKEW_MS = 2 * 60_000;

export type Freshness =
  /** Claude, read in the last 5 minutes. */
  | { kind: 'fresh'; at: number }
  /**
   * Codex, read fine: its numbers are as of its last turn, and stay correct between turns.
   * Shown neutrally, however long ago that turn was.
   */
  | { kind: 'last-turn'; at: number }
  /** Old numbers: a failed or stale read, older than ones already shown, or Claude past 5 min. */
  | { kind: 'old'; at: number }
  /** No usable time: treated as old. */
  | { kind: 'unknown' }
  /** The time is in the future beyond allowed skew: treated as old. */
  | { kind: 'skew'; at: number };

/**
 * USAGE-1.3 / 2.2: how fresh a provider's numbers are. Codex's come from `observed_at` (its last
 * turn) only; falling back to the read time is only for legacy Claude data.
 */
export function freshness(
  p: Pick<ProviderUsage, 'id' | 'observedAt' | 'fetchedAt' | 'stale' | 'state'>,
  now: number,
): Freshness {
  const at = p.id === 'codex' ? p.observedAt : (p.observedAt ?? p.fetchedAt);
  if (at === null || !Number.isFinite(at)) return { kind: 'unknown' };
  if (at - now > CLOCK_SKEW_MS) return { kind: 'skew', at };
  if (p.stale || p.state !== 'ok') return { kind: 'old', at };
  if (p.id === 'codex') return { kind: 'last-turn', at };
  if (now - at > USAGE_STALE_MS) return { kind: 'old', at };
  return { kind: 'fresh', at };
}

/** Whether a freshness should be flagged (amber): everything but fresh and last-turn. */
export function isFlagged(f: Freshness): boolean {
  return f.kind !== 'fresh' && f.kind !== 'last-turn';
}
