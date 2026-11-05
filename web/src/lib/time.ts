import { createContext, useContext, useEffect, useState } from 'react';

/** Compact age: `12s`, `5m`, `3h`, `2d`. */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** LIB-2.1, HIST-2.12: a day heading in the browser's local time: "Today", "Yesterday", then the date. */
export function dayLabel(at: number, now: number): string {
  const date = new Date(at);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** A day of `byDay`: its heading and its rows, each with its index in the whole list. */
export interface DayRun<T> {
  /**
   * Its React key: the calendar day, not the label, so a run keeps its rows mounted (an open menu,
   * "Copied") when "Today" turns into "Yesterday" at midnight or a newer row arrives above it.
   */
  key: string;
  label: string;
  rows: { item: T; index: number }[];
}

/**
 * LIB-2.1, HIST-2.12: a newest-first list cut into runs of one day (DS-17), in order. A row with no
 * time is under "No date". Two runs can share a label only if the list isn't in date order.
 */
export function byDay<T>(items: readonly T[], at: (item: T) => number | null, now: number): DayRun<T>[] {
  const runs: DayRun<T>[] = [];
  const seen = new Map<string, number>();
  items.forEach((item, index) => {
    const t = at(item);
    const day = t === null ? 'none' : new Date(t).toDateString();
    const last = runs[runs.length - 1];
    if (last && last.key.split('#')[0] === day) return last.rows.push({ item, index });
    const n = seen.get(day) ?? 0;
    seen.set(day, n + 1);
    runs.push({ key: n ? `${day}#${n}` : day, label: t === null ? 'No date' : dayLabel(t, now), rows: [{ item, index }] });
  });
  return runs;
}

/** The current time, re-read every `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * The app's one-second clock (App's `useNow(1000)`), for parts that show how long something has
 * taken without a timer of their own (DS-6's `Loading`). Null outside App, where `useClock` falls
 * back to the time it was first read.
 */
export const ClockContext = createContext<number | null>(null);

/** The app's clock, or, without one, the time this component first rendered. */
export function useClock(): number {
  const app = useContext(ClockContext);
  const [mounted] = useState(() => Date.now());
  return app ?? mounted;
}
