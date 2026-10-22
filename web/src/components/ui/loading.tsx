import { type ReactNode, useState } from 'react';
import { formatElapsed } from '@/lib/activity';
import { useClock } from '@/lib/time';
import { cn } from '@/lib/utils';

/** From this long, Loading says how long it has taken. */
export const LOADING_ELAPSED_MS = 3_000;
/** From this long, Loading shows the place's hint, when it gives one. */
export const LOADING_HINT_MS = 15_000;

export interface LoadingProps {
  /** What it's doing, at once ("Reading the Transcript…"). */
  label: string;
  /** When it began; when it was first shown, by default. */
  since?: number;
  /** From 15 s: what to know or do meanwhile. */
  hint?: ReactNode;
  /** Under the hint: a button, when there's something to do. */
  action?: ReactNode;
  className?: string;
}

/**
 * DS-6.1: loading that admits time passes. The label shows at once, in a polite status region, so
 * it's announced once; from 3 s the seconds follow it ("· 4s"), outside that region, as VIEW-1's
 * "Working…" row has them; from 15 s the hint, when the place gives one. It ticks on the app's
 * one-second clock (ClockContext), not a timer of its own. Spans only, so it fits in a line, a
 * button or a `pre`.
 */
export function Loading({ label, since, hint, action, className }: LoadingProps) {
  const now = useClock();
  const [shown] = useState(now);
  const elapsed = Math.max(0, now - (since ?? shown));
  return (
    <span data-slot="loading" className={cn('flex min-w-0 flex-col gap-1.5 text-meta text-muted-foreground', className)}>
      <span className="block truncate">
        <span role="status" aria-live="polite" aria-atomic="true">
          {label}
        </span>
        {elapsed >= LOADING_ELAPSED_MS && (
          <span className="tabular-nums" data-field="elapsed">
            {` · ${formatElapsed(elapsed)}`}
          </span>
        )}
      </span>
      {elapsed >= LOADING_HINT_MS && (hint || action) && (
        <span className="flex flex-col items-center gap-1.5" data-field="hint">
          {hint && <span className="block">{hint}</span>}
          {action}
        </span>
      )}
    </span>
  );
}
