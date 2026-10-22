import type { Status } from '@shared/types.ts';
import { usePulse } from '@/lib/pulse';
import { STATUS_LABEL } from '@/lib/sessions';
import { useClock } from '@/lib/time';
import { cn } from '@/lib/utils';

/**
 * SIDE-3.2: one shape per Status, so each reads without colour.
 * ◆ Needs you (largest, filled) · ● Busy (filled) · ○ Idle (ring) · ? Unknown.
 * The box sets the size (14 px unless `className` says otherwise; the sidebar's is 18 px, SIDE-3.8),
 * and each shape keeps its share of it: the dot and ring 10/14, the dashed ring 12/14.
 *
 * DS-10.1: Busy's dot pulses only for 10 s after the Session became Busy (`since`, the Status's last
 * change), by the app's clock, then holds steady; with no `since` it doesn't pulse.
 */
export function StatusMarker({ status, since, className }: { status: Status; since?: number | null; className?: string }) {
  return (
    <span
      role="img"
      aria-label={STATUS_LABEL[status]}
      data-status={status}
      className={cn('inline-flex size-3.5 shrink-0 items-center justify-center', className)}
    >
      {status === 'needs-you' && (
        <svg viewBox="0 0 14 14" className="size-full text-needs-you">
          <path d="M7 0.8 13.2 7 7 13.2 0.8 7Z" fill="currentColor" />
          <path d="M7 4.2v3.4" stroke="var(--color-background)" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="7" cy="9.6" r="0.9" fill="var(--color-background)" />
        </svg>
      )}
      {status === 'busy' && <BusyDot since={since} />}
      {status === 'idle' && (
        <svg viewBox="0 0 14 14" className="size-[calc(100%*5/7)] text-idle">
          <circle cx="7" cy="7" r="5.2" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      )}
      {status === 'unknown' && (
        <svg viewBox="0 0 14 14" className="size-[calc(100%*6/7)] text-idle">
          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.2 1.6" />
          <text x="7" y="10" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor">
            ?
          </text>
        </svg>
      )}
    </span>
  );
}

/** Busy's dot. Its own component so only Busy markers read the clock and re-render on its tick. */
function BusyDot({ since }: { since?: number | null }) {
  const pulse = usePulse(since, useClock());
  return (
    <svg viewBox="0 0 14 14" className={cn('size-[calc(100%*5/7)] text-busy', pulse && 'animate-busy')} style={pulse ?? undefined} data-pulse={pulse ? '' : undefined}>
      <circle cx="7" cy="7" r="6" fill="currentColor" />
    </svg>
  );
}
