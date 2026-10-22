import { type CSSProperties, useState } from 'react';

/** DS-10.1: how long a Busy marker pulses after its Session became Busy. */
export const PULSE_MS = 10_000;

/** Whether something that started at `since` still pulses at `now`: under 10 s old. No start known, no pulse. */
export function pulsing(since: number | null | undefined, now: number): boolean {
  return since != null && now - since < PULSE_MS;
}

/**
 * DS-10.1: the pulse of a Busy marker or the chat's "Working…" dot, by the age of what it marks, not
 * by when the page loaded: the style for `animate-busy` while it's under 10 s old, null after (or with
 * no start known). The animation's delay is set negative by the age when the pulse first shows, and
 * kept, so a re-render or a tick of the clock doesn't restart or shift it. The age is taken from the
 * real time at that moment, not the app's clock (up to a second old), so two markers of one Session
 * pulse in step whenever each mounts. The clock only decides when the pulse ends. With reduced motion,
 * `animate-busy` animates nothing (`index.css`).
 */
const delayFor = (since: number | null | undefined): number => (since == null ? 0 : Math.min(0, since - Date.now()));

export function usePulse(since: number | null | undefined, now: number): CSSProperties | null {
  const [phase, setPhase] = useState(() => ({ since, delay: delayFor(since) }));
  // A new start (the Session became Busy again, a new Turn): its own delay. Adjusted while
  // rendering, as React documents for state derived from props.
  const delay = phase.since === since ? phase.delay : delayFor(since);
  if (phase.since !== since) setPhase({ since, delay });
  return pulsing(since, now) ? { animationDelay: `${delay}ms` } : null;
}
