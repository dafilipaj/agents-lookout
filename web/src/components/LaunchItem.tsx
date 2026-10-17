import type { LaunchView } from '@shared/types.ts';
import { CircleX, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';

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
        {failed ? (
          <CircleX aria-label="Didn't start" className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <LoaderCircle aria-label="Starting" className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] leading-5 font-medium" title={launch.title}>
          {launch.title}
        </span>
        {failed ? (
          <button
            type="button"
            aria-label={`Dismiss ${launch.title}`}
            title="Dismiss (its Session host keeps running)"
            onClick={(e) => {
              e.stopPropagation(); // dismissing isn't selecting
              onDismiss(launch.id);
            }}
            className="-mr-0.5 rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <HarnessIcon harness={launch.harness} />
        )}
      </div>
      <div className="flex items-center gap-1 pl-5.5 text-[11.5px] leading-4 text-muted-foreground">
        <span className="min-w-0 flex-1 truncate" title={launch.directory}>
          {failed ? "Didn't start" : 'Starting…'} · {dir}
        </span>
        <span className="shrink-0 tabular-nums">{formatAge(now - launch.startedAt)}</span>
      </div>
      {failed && !selected && (
        <div className="mt-1 pl-5.5">
          {launch.error && <p className="text-[11.5px] leading-4 text-destructive">{launch.error}</p>}
          {launch.terminal && launch.terminal.length > 0 && (
            <pre
              aria-label="Last lines of its terminal"
              title={launch.terminal.join('\n')}
              className="mt-1 overflow-hidden rounded border border-border bg-background px-1.5 py-1 font-mono text-[10px] leading-[14px] whitespace-pre text-muted-foreground"
            >
              {launch.terminal.join('\n')}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}
