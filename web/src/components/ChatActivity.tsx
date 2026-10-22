import type { ChatEntry, SessionRow } from '@shared/types.ts';
import { activityOf, formatElapsed } from '@/lib/activity';
import { usePulse } from '@/lib/pulse';
import { useNow } from '@/lib/time';
import { cn } from '@/lib/utils';

const NONE: readonly ChatEntry[] = [];

export interface ChatActivityProps {
  row: SessionRow;
  ended: boolean;
  entries: readonly ChatEntry[] | undefined;
  /** When you last sent from the composer (VIEW-1.10's optimistic start). */
  sentAt: number | null;
}

/**
 * VIEW-1.10: "Working… 12s" or "Needs you" at the bottom of the chat. It keeps its own clock, so
 * the seconds tick here without re-rendering the chat. The live region holds only the state, so a
 * screen reader hears "Working…" once, not every second; it stays mounted (empty while there's
 * nothing to say) so the first change is announced too.
 */
export function ChatActivity({ row, ended, entries, sentAt }: ChatActivityProps) {
  const now = useNow(1000);
  const activity = activityOf({
    status: row.status,
    waitingFor: row.waitingFor,
    statusSince: row.statusSince,
    ended,
    entries: entries ?? NONE,
    sentAt,
    now,
  });
  const label = !activity ? '' : activity.kind === 'working' ? 'Working…' : `Needs you${activity.waitingFor ? ` · ${activity.waitingFor}` : ''}`;
  const since = activity?.kind === 'working' ? activity.since : null;
  // DS-10.1: the dot pulses for 10 s after the Turn began, then holds steady, as a Busy marker does.
  const pulse = usePulse(since, now);
  return (
    <div
      data-testid="chat-activity"
      data-activity={activity?.kind}
      className={cn('mx-auto flex w-full max-w-3xl items-center gap-2 px-6 text-meta', activity && 'pb-5')}
    >
      {activity && (
        <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
          <span
            className={cn('size-2 rounded-full', activity.kind === 'working' ? cn('bg-busy', pulse && 'animate-busy') : 'bg-needs-you')}
            style={(activity.kind === 'working' && pulse) || undefined}
            data-pulse={activity.kind === 'working' && pulse ? '' : undefined}
          />
        </span>
      )}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        title={label || undefined}
        className={cn('min-w-0 truncate', activity?.kind === 'needs-you' ? 'font-medium text-needs-you-text' : 'text-muted-foreground')}
      >
        {label}
      </span>
      {/* A real space, so the text reads "Working… 12s" (flex ignores it in layout). */}
      {since !== null && ' '}
      {since !== null && (
        <span className="shrink-0 text-muted-foreground tabular-nums" data-field="elapsed">
          {formatElapsed(now - since)}
        </span>
      )}
    </div>
  );
}
