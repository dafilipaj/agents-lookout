import { type LucideIcon, OctagonAlert, TriangleAlert } from 'lucide-react';
import {
  type Freshness,
  type ProviderUsage,
  type UsageLevel,
  freshness,
  isFlagged,
  liveWindows,
  shortWindowLabel,
  usageLevel,
} from '@shared/usage.ts';

/** Time to a reset, compact: `45m`, `2h10`, `3d 4h`. */
export function formatUntil(resetsAt: number | null, now: number): string {
  if (resetsAt === null) return '';
  const min = Math.ceil((resetsAt - now) / 60_000);
  if (min <= 0) return 'now';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${String(min % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** A reset as a clock time: `17:30` today, `Tue 22:00` on another day. */
export function formatClock(resetsAt: number | null, now: number): string {
  if (resetsAt === null) return '';
  const d = new Date(resetsAt);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (new Date(now).toDateString() === d.toDateString()) return time;
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

/** How old numbers are: `just now`, `3m ago`, `2h ago`. */
export function formatAgeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/** A compact age: `just now`, `17m`, `3h`, `2d`. */
export function formatAgeShort(at: number, now: number): string {
  const m = Math.floor(Math.max(0, now - at) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/**
 * How fresh, for people: `updated 1m ago`, `as of last turn · 17m` (Codex), `old · 20m ago`,
 * `age unknown`, `clock skew`.
 */
export function freshnessLabel(f: Freshness, now: number): string {
  switch (f.kind) {
    case 'fresh':
      return `updated ${formatAgeAgo(f.at, now)}`;
    case 'last-turn':
      return `as of last turn · ${formatAgeShort(f.at, now)}`;
    case 'old':
      return `old · ${formatAgeAgo(f.at, now)}`;
    case 'unknown':
      return 'age unknown';
    case 'skew':
      return 'clock skew';
  }
}

/**
 * USAGE-1.2: the level icon that reads without colour, by its shape: a triangle for a warning, an
 * octagon for critical ([0008](../../../docs/decisions/0008-lucide-icons-only.md)).
 */
export const LEVEL_ICON: Record<UsageLevel, { icon: LucideIcon; className: string; label: string } | null> = {
  normal: null,
  warning: { icon: TriangleAlert, className: 'text-warning-text', label: 'Warning: 80% or more used' },
  critical: { icon: OctagonAlert, className: 'text-destructive', label: 'Critical: 95% or more used' },
};

/**
 * USAGE-3.1: the launcher's hint for a Harness with a window at 95% or more. Windows whose
 * reset has passed don't count; old numbers say how old they are.
 */
export function criticalHint(provider: ProviderUsage | undefined, now: number): string | null {
  if (!provider) return null;
  const w = liveWindows(provider.windows, now).find((x) => usageLevel(x.percent) === 'critical');
  if (!w) return null;
  const reset = formatClock(w.resetsAt, now);
  // Only numbers that are flagged (old, unknown age, clock skew) say how old they are here.
  const f = freshness(provider, now);
  const age = !isFlagged(f) ? '' : f.kind === 'old' ? ` · as of ${formatAgeAgo(f.at, now)}` : ` · ${freshnessLabel(f, now)}`;
  return `${shortWindowLabel(w)} ${Math.round(w.percent)}%${reset ? ` · resets ${reset}` : ''}${age}`;
}

/**
 * A usage bar's fill by level. On the strip (DS-3.2) the fill is `foreground/55` at every level, so
 * it stays 3:1 against the track in both modes, and the level shows as a 3 px edge at the fill's end
 * (`warning` at 80% to 94%, `destructive` at 95% or more), set off from the fill by a 1 px gap in the
 * sidebar's colour so it reads as its own mark whatever the hue, with the triangle or octagon beside it.
 * The details popover (`solid`) keeps solid fills.
 */
export const BAR_TRACK = 'bg-foreground/10';
export const BAR_FILL: Record<'strip' | 'solid', Record<UsageLevel, string>> = {
  strip: { normal: 'bg-foreground/55', warning: 'bg-foreground/55', critical: 'bg-foreground/55' },
  solid: { normal: 'bg-foreground/55', warning: 'bg-warning', critical: 'bg-destructive' },
};
export const BAR_EDGE: Record<UsageLevel, string | null> = { normal: null, warning: 'bg-warning', critical: 'bg-destructive' };

/** The 1 px gap between the fill and its edge: the strip's ground (the sidebar), so the edge is a separate mark. */
export const BAR_EDGE_GAP = 'border-l border-sidebar';
