import type { LaunchView } from '@shared/types.ts';
import { CircleX, LoaderCircle, X } from 'lucide-react';
import { formatAge } from '@/lib/time';

const HARNESS = { claude: 'Claude', codex: 'Codex' } as const;

/** LAUNCH-4.2 / 4.5: a "Starting…" row, or the error it turns into. */
export function LaunchItem({ launch, now, onDismiss }: { launch: LaunchView; now: number; onDismiss(id: string): void }) {
  const failed = launch.state === 'failed';
  const dir = launch.directory.replace(/\/+$/, '').split('/').pop() || launch.directory;
  return (
    <li
      data-launch-id={launch.id}
      data-state={launch.state}
      className={failed ? 'rounded-md bg-destructive/8 px-2 py-1.5' : 'rounded-md px-2 py-1.5'}
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
            onClick={() => onDismiss(launch.id)}
            className="-mr-0.5 rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <span className="shrink-0 text-[11px] text-muted-foreground">{HARNESS[launch.harness]}</span>
        )}
      </div>
      <div className="flex items-center gap-1 pl-5.5 text-[11.5px] leading-4 text-muted-foreground">
        <span className="min-w-0 flex-1 truncate" title={launch.directory}>
          {failed ? "Didn't start" : 'Starting…'} · {dir}
        </span>
        <span className="shrink-0 tabular-nums">{formatAge(now - launch.startedAt)}</span>
      </div>
      {failed && (
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
