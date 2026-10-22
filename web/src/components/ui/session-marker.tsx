import type { Status } from '@shared/types.ts';
import { CircleSlash, History } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import { StatusMarker } from '@/components/StatusMarker';
import { cn } from '@/lib/utils';

/** What a Session marker can show: a live Session (with its Status), a past one that can be resumed, or one that can't. */
export type SessionMarkerState = 'live' | 'past' | 'blocked';

export interface SessionMarkerProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  state: SessionMarkerState;
  /** A live Session's Status; ignored for a past one. */
  status?: Status;
  /** When that Status began (the row's `statusSince`): a Busy marker pulses for 10 s after it (DS-10.1). */
  since?: number | null;
}

/**
 * DS-5.1: one marker for a Session, in every list. Live, its Status marker (StatusMarker, SIDE-3.2);
 * past and resumable, lucide's `History` in `muted-foreground`, which can't pass for Idle's ring; past
 * and blocked, `CircleSlash`. It fills the box its list gives it (`className`: 18 px in the sidebar,
 * SIDE-3.8; 14 px by default, as History and Work have), so titles line up whichever shape shows.
 */
export function SessionMarker({ state, status = 'unknown', since, className, ...rest }: SessionMarkerProps) {
  return (
    <span
      data-session-marker=""
      data-state={state}
      data-status={state === 'live' ? status : undefined}
      className={cn('inline-flex size-3.5 shrink-0 items-center justify-center', className)}
      {...rest}
    >
      {state === 'live' ? (
        <StatusMarker status={status} since={since} className="size-full" />
      ) : state === 'past' ? (
        <History role="img" aria-label="Past Session" className="size-full text-muted-foreground" />
      ) : (
        <CircleSlash role="img" aria-label="Can't be resumed" className="size-full text-muted-foreground" />
      )}
    </span>
  );
}
