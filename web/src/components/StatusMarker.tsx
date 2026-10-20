import type { Status } from '@shared/types.ts';
import { STATUS_LABEL } from '@/lib/sessions';
import { cn } from '@/lib/utils';

/**
 * SIDE-3.2: one shape per Status, so each reads without colour.
 * ◆ Needs you (largest, filled) · ● Busy (filled, pulsing) · ○ Idle (ring) · ? Unknown.
 * The box sets the size (14 px unless `className` says otherwise; the sidebar's is 18 px, SIDE-3.8),
 * and each shape keeps its share of it: the dot and ring 10/14, the dashed ring 12/14.
 */
export function StatusMarker({ status, className }: { status: Status; className?: string }) {
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
      {status === 'busy' && (
        <svg viewBox="0 0 14 14" className="animate-busy size-[calc(100%*5/7)] text-busy">
          <circle cx="7" cy="7" r="6" fill="currentColor" />
        </svg>
      )}
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
