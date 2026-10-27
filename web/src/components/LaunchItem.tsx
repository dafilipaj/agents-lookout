import type { LaunchView } from '@shared/types.ts';
import { CircleX, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Alert } from '@/components/ui/alert';
import { IconButton } from '@/components/ui/icon-button';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';
import { SessionMarker } from '@/components/ui/session-marker';

interface Props {
  launch: LaunchView;
  now: number;
  /** LAUNCH-4.2: selected, showing the start in the main pane (LAUNCH-4.6), which then carries the detail. */
  selected: boolean;
  onSelect(id: string): void;
  onDismiss(id: string): void;
}

/**
 * LAUNCH-4.2 / 4.5: a "Starting…" row, or the error it turns into. Selectable like a Session's row,
 * but a plain list item (`aria-current` when selected): a failed one holds a Dismiss button, and
 * an option can't hold controls. Selected, a failed row stays compact; the view shows its detail.
 */
export function LaunchItem({ launch, now, selected, onSelect, onDismiss }: Props) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  const failed = launch.state === 'failed';
  const trust = launch.state === 'trust';
  const dismissible = failed || (trust && !!launch.trust?.message && !launch.trust.answering);
  const dir = launch.directory.replace(/\/+$/, '').split('/').pop() || launch.directory;
  return (
    <li
      ref={ref}
      aria-current={selected ? 'true' : undefined}
      data-launch-id={launch.id}
      data-state={launch.state}
      onClick={() => onSelect(launch.id)}
      className={cn(
        'cursor-default select-none rounded-md px-2 py-1.5 transition-[background-color] duration-150',
        failed ? 'bg-destructive/8' : 'hover:bg-sidebar-accent/70',
        selected && (failed ? 'ring-1 ring-destructive/40 ring-inset' : 'bg-sidebar-accent hover:bg-sidebar-accent'),
      )}
    >
      <div className="flex items-center gap-2">
        {/* As wide as a Session row's marker (18 px), so the titles line up (SIDE-3.8). */}
        {trust ? <SessionMarker state="live" status="needs-you" className="size-4.5" /> : failed ? (
          <CircleX aria-label="Didn't start" className="mx-px size-4 shrink-0 text-destructive" />
        ) : (
          <LoaderCircle aria-label="Starting" className="mx-px size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-body leading-5 font-medium" title={launch.title}>
          {launch.title}
        </span>
        {dismissible ? (
          // DS-7: a 24 px target; the negative margins keep the row as tall as a Session's.
          <IconButton
            label={`Dismiss ${launch.title}`}
            tip="Dismiss (its Session host keeps running)"
            onClick={(e) => {
              e.stopPropagation(); // dismissing isn't selecting
              onDismiss(launch.id);
            }}
            className="-my-0.5 -mr-1 hover:bg-sidebar-accent"
          >
            <X />
          </IconButton>
        ) : (
          <HarnessIcon harness={launch.harness} />
        )}
      </div>
      <div className="flex items-center gap-1 pl-6.5 text-meta leading-4 text-muted-foreground">
        <span className={cn('min-w-0 flex-1', trust || failed ? 'break-words' : 'truncate')} title={launch.directory}>
          {trust ? 'Asks to trust the folder' : failed ? "Didn't start" : 'Starting…'} · {dir}
        </span>
        <span className="shrink-0 tabular-nums">{formatAge(now - launch.startedAt)}</span>
      </div>
      {failed && !selected && (
        <div className="mt-1 pl-6.5">
          {launch.error && <Alert layout="inline" quiet title={launch.error} />}
          {launch.terminal && launch.terminal.length > 0 && (
            <pre
              aria-label="Last lines of its terminal"
              title={launch.terminal.join('\n')}
              className="mt-1 overflow-hidden rounded border border-border bg-background px-1.5 py-1 font-mono text-caption leading-[14px] whitespace-pre text-muted-foreground"
            >
              {launch.terminal.join('\n')}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}
