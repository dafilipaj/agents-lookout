import { type LucideIcon, OctagonAlert, TriangleAlert } from 'lucide-react';
import { formatAge } from '@/lib/time';
import { HARNESS_NAME } from '@/lib/sessions';
import {
  type Freshness,
  type ProviderUsage,
  type UsageLevel,
  type UsageWindow,
  freshness,
  isFiveHour,
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

/**
 * How fresh, for people, worded as Memory words a sample's age (USAGE-1.5, DS-19.3): `12s ago`,
 * `last turn · 17m` (Codex from its Transcripts), `stale · 6m`, `age unknown`, `clock skew`.
 */
export function freshnessLabel(f: Freshness, now: number): string {
  switch (f.kind) {
    case 'fresh':
      return `${formatAge(now - f.at)} ago`;
    case 'last-turn':
      return `last turn · ${formatAge(now - f.at)}`;
    case 'old':
      return `stale · ${formatAge(now - f.at)}`;
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
  const age = !isFlagged(f) ? '' : f.kind === 'old' ? ` · as of ${formatAge(now - f.at)} ago` : ` · ${freshnessLabel(f, now)}`;
  return `${shortWindowLabel(w)} ${Math.round(w.percent)}%${reset ? ` · resets ${reset}` : ''}${age}`;
}

/**
 * A usage bar's track and fill (DS-3.2): the fill is `foreground/55` at every level, so it stays 3:1
 * against the track in both modes, and the level shows as a 3 px edge at the fill's end (`warning` at
 * 80% to 94%, `destructive` at 95% or more), set off from the fill by a 1 px gap in the ground's colour
 * so it reads as its own mark whatever the hue, with the triangle or octagon beside it. The strip's bar
 * and a details popover's `Meter` (DS-19.1) both draw it; the classes are written where they're drawn,
 * so the guard sees them (check 10), and these are what the contrast tests measure.
 */
export const BAR_TRACK = 'bg-foreground/10';
export const BAR_FILL = 'bg-foreground/55';
export const BAR_EDGE: Record<UsageLevel, string | null> = { normal: null, warning: 'bg-warning', critical: 'bg-destructive' };

/** The 1 px gap between the fill and its edge, in the ground's colour, so the edge is a separate mark: the sidebar's on the strip, the popover's in a `Meter`. */
export const BAR_EDGE_GAP = { strip: 'border-l border-sidebar', popover: 'border-l border-popover' } as const;

/** A window in words, as the details name it: "5-hour", "weekly", "weekly Fable". */
export function windowWords(w: UsageWindow): string {
  const span = isFiveHour(w) ? '5-hour' : 'weekly';
  return w.model ? `${span} ${w.model}` : span;
}

/** One thing with a limit, for the verdict and "Worth a look": a live window, or extra usage with a limit. */
export interface Limit {
  key: string;
  provider: ProviderUsage;
  /** "weekly", "5-hour Fable", "extra usage". */
  words: string;
  percent: number;
  resetsAt: number | null;
}

/** USAGE-2.3, 2.5: every live window and every extra usage with a limit, tightest first across providers. */
export function limits(providers: readonly ProviderUsage[], now: number): Limit[] {
  const all: Limit[] = providers.flatMap((p) => [
    ...liveWindows(p.windows, now).map((w) => ({ key: `${p.id}-${w.kind}-${w.model ?? ''}`, provider: p, words: windowWords(w), percent: w.percent, resetsAt: w.resetsAt })),
    ...(p.extra?.enabled && p.extra.limit !== null ? [{ key: `${p.id}-extra`, provider: p, words: 'extra usage', percent: Math.round(p.extra.percent), resetsAt: null }] : []),
  ]);
  return all.sort((a, b) => b.percent - a.percent || (a.resetsAt ?? Infinity) - (b.resetsAt ?? Infinity));
}

/**
 * USAGE-2.3: the details' verdict: "All limits fine" under 80% everywhere, else the worst limit by
 * name ("Codex's weekly limit is getting close", "… is nearly used up", "… is used up"), with "and 1
 * more" when others share its level; "Limits can't be read" when no provider has numbers.
 */
export function usageVerdict(providers: readonly ProviderUsage[], now: number): { level: UsageLevel; text: string } {
  const all = limits(providers, now);
  if (!all.length && !providers.some((p) => p.windows.length)) return { level: 'normal', text: "Limits can't be read" };
  const worst = all[0];
  if (!worst || usageLevel(worst.percent) === 'normal') return { level: 'normal', text: 'All limits fine' };
  const level = usageLevel(worst.percent);
  const how = worst.percent >= 100 ? 'is used up' : level === 'critical' ? 'is nearly used up' : 'is getting close';
  const name = worst.words === 'extra usage' ? 'extra usage' : `${worst.words} limit`;
  const more = all.filter((l) => l !== worst && usageLevel(l.percent) === level).length;
  return { level, text: `${HARNESS_NAME[worst.provider.id]}'s ${name} ${how}${more ? `, and ${more} more` : ''}` };
}

/**
 * USAGE-2.3: the verdict's age, the oldest provider's, worded as USAGE-1.5 says. A flagged age (old
 * numbers, an unknown age, clock skew) comes first however recent, so numbers that are old never read
 * as current behind another provider's older but sound "last turn · 17m"; an age that can't be placed
 * comes before a dated one. Null when no provider has numbers (a window, or extra usage with a limit).
 */
export function oldestAge(providers: readonly ProviderUsage[], now: number): { label: string; flagged: boolean } | null {
  const ages = providers.filter((p) => p.windows.length || (p.extra?.enabled && p.extra.limit !== null)).map((p) => freshness(p, now));
  const rank = (f: Freshness) => (f.kind === 'unknown' || f.kind === 'skew' ? 0 : isFlagged(f) ? 1 : 2);
  const oldest = ages.toSorted((a, b) => rank(a) - rank(b) || ('at' in a ? a.at : 0) - ('at' in b ? b.at : 0))[0];
  return oldest ? { label: freshnessLabel(oldest, now), flagged: isFlagged(oldest) } : null;
}
