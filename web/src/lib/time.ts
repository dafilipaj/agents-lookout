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
