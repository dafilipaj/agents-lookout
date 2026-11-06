import { type ReactNode, useState } from 'react';
import { formatElapsed } from '@/lib/activity';
import { useClock } from '@/lib/time';
import { cn } from '@/lib/utils';
import { LookoutMark } from './lookout-mark';

/** From this long, Loading says how long it has taken. */
export const LOADING_ELAPSED_MS = 3_000;
/** From this long, Loading shows the place's hint, when it gives one (DS-6.1); a place may give its own (DS-6.7). */
export const LOADING_HINT_MS = 15_000;

/** DS-6.5: the text Loading sits in, and its Lens at that text's icon size (DS-7). */
const TEXT = {
  caption: { text: 'text-caption leading-4', lens: 'size-3' },
  meta: { text: 'text-meta', lens: 'size-3.5' },
  body: { text: 'text-body', lens: 'size-4' },
} as const;

export interface LoadingProps {
  /** What it's reading or waiting for, at once ("Reading the Transcript…"), in the words of DS's "Loading words". */
  label: string;
  /** When it began; when it was first shown, by default. */
  since?: number;
  /** From `hintAfter`: what to know or do meanwhile. */
  hint?: ReactNode;
  /** DS-6.7: when the hint shows, for a place that knows when its wait becomes a failure; 15 s by default. */
  hintAfter?: number;
  /** Under the hint: a button, when there's something to do. */
  action?: ReactNode;
  /** DS-6.5: the text it sits in, which sizes its Lens; `meta` by default. */
  size?: keyof typeof TEXT;
  /** The label's tooltip, when the words shorten something (a directory's full path). */
  title?: string;
  /**
   * The label in its own polite status region (the default). False where the place announces the
   * words itself, through a region that stays mounted (a start's, LAUNCH-6.9).
   */
  live?: boolean;
  className?: string;
}

/**
 * DS-6.1, DS-6.5: loading that admits time passes. The orbiting Lens (DS-14.4) comes first, then
 * the label, at once, in a polite status region, so it's announced once; from 3 s the seconds
 * follow it ("· 4s"), outside that region, as VIEW-1's "Working…" row has them; from 15 s the
 * hint, when the place gives one. It ticks on the app's one-second clock (ClockContext), not a
 * timer of its own. Spans only, so it fits in a line, a button or a `pre`.
 */
export function Loading({ label, since, hint, hintAfter = LOADING_HINT_MS, action, size = 'meta', title, live = true, className }: LoadingProps) {
  const now = useClock();
  const [shown] = useState(now);
  const elapsed = Math.max(0, now - (since ?? shown));
  return (
    <span data-slot="loading" className={cn('group/loading flex min-w-0 flex-col gap-1.5 text-muted-foreground', TEXT[size].text, className)}>
      <span className="flex min-w-0 items-center gap-1.5">
        <LookoutMark orbiting className={TEXT[size].lens} />
        <span className="min-w-0 truncate" title={title}>
          <span {...(live ? { role: 'status', 'aria-live': 'polite' as const, 'aria-atomic': true } : {})} data-field="loading-label">
            {label}
          </span>
          {elapsed >= LOADING_ELAPSED_MS && (
            <span className="tabular-nums" data-field="elapsed">
              {` · ${formatElapsed(elapsed)}`}
            </span>
          )}
        </span>
      </span>
      {elapsed >= hintAfter && (hint || action) && (
        // Under the label, as it's aligned: centred where the place centres it.
        <span className="flex flex-col items-start gap-1.5 group-[.items-center]/loading:items-center" data-field="hint">
          {hint && <span className="block">{hint}</span>}
          {action}
        </span>
      )}
    </span>
  );
}
