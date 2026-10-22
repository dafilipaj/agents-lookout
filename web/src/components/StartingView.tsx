import type { LaunchView } from '@shared/types.ts';
import { CircleX, LoaderCircle } from 'lucide-react';
import { HARNESS_NAME } from '@/lib/sessions';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';
import { PaneHeader, PlainView, ShellCell, ShellView } from './Shell';

interface Props {
  /** The selected start, or null when this tab doesn't list it (dismissed elsewhere, or long gone). */
  launch: LaunchView | null;
  /** The first snapshot has arrived, so a missing launch really isn't listed. */
  loaded: boolean;
  now: number;
}

/**
 * LAUNCH-4.6: the main pane while a "Starting…" row is selected: what was started and how long
 * ago, then, once it failed (LAUNCH-4.5), the error and its terminal's last lines in place of the
 * waiting note. The header says the Harness and the state once each. No dock: its content
 * runs to the bottom (SIDE-8). The Session takes over the selection once Fleet reports it (App).
 */
export function StartingView({ launch, loaded, now }: Props) {
  if (!launch) {
    return (
      <PlainView>
        {loaded ? (
          <div className="mx-auto w-full max-w-3xl px-8 py-7">
            <div role="status" className="rounded-lg border border-border bg-muted/60 px-3.5 py-3">
              <p className="text-body font-medium">This start is no longer listed</p>
              <p className="text-body text-muted-foreground">
                It was dismissed in another tab, became a Session while this tab wasn&apos;t watching, or Lookout restarted.
                Select a Session in the sidebar.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-8 text-body text-muted-foreground">Loading…</div>
        )}
      </PlainView>
    );
  }

  const failed = launch.state === 'failed';
  const age = formatAge(now - launch.startedAt);
  return (
    <ShellView data-testid="starting-view">
      <PaneHeader aria-label="Starting Session">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {failed ? (
            <CircleX aria-hidden className="size-3.5 shrink-0 text-destructive" />
          ) : (
            <LoaderCircle aria-hidden className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          )}
          <h1 className="min-w-0 truncate text-title font-semibold tracking-tight" title={launch.title}>
            {launch.title}
          </h1>
          <span className="flex shrink-0 items-center gap-1.5 text-meta text-muted-foreground" data-field="harness">
            <HarnessIcon harness={launch.harness} tone="brand" className="size-4" />
            {HARNESS_NAME[launch.harness]}
          </span>
          {/* Foreground text on the pill (contrast); the icon before the name carries the red. */}
          <span
            className={cn(
              'ml-auto shrink-0 rounded-full px-2 py-0.5 text-meta font-medium text-foreground',
              failed ? 'bg-destructive/10 ring-1 ring-destructive/30 ring-inset' : 'bg-muted',
            )}
            data-field="status"
          >
            {failed ? "Didn't start" : 'Starting…'}
          </span>
        </div>
      </PaneHeader>
      <ShellCell row="body" toBottom className="overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-8 py-7">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1.5 text-body" aria-label="What was started">
            <dt className="text-muted-foreground">Directory</dt>
            <dd className="font-mono text-body break-all">
              {launch.directory}
            </dd>
            <dt className="text-muted-foreground">Started</dt>
            <dd className="tabular-nums">{age} ago</dd>
          </dl>
          {failed ? (
            <>
              {launch.error && (
                <p role="alert" className="mt-5 rounded-lg border border-destructive/30 bg-destructive/8 px-3.5 py-3 text-body">
                  {launch.error}
                </p>
              )}
              {launch.terminal && launch.terminal.length > 0 ? (
                <section className="mt-5" aria-labelledby="starting-terminal">
                  <h2 id="starting-terminal" className="mb-1.5 text-meta font-medium text-muted-foreground">
                    Its terminal&apos;s last lines
                  </h2>
                  <pre className="overflow-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-meta leading-[1.45] whitespace-pre text-foreground/90 dark:bg-black/25">
                    {launch.terminal.join('\n')}
                  </pre>
                </section>
              ) : (
                <p className="mt-3 text-body text-muted-foreground">No terminal lines to show.</p>
              )}
            </>
          ) : (
            <p role="status" className="mt-5 text-body text-muted-foreground">
              Waiting for Fleet to report the Session…
            </p>
          )}
        </div>
      </ShellCell>
    </ShellView>
  );
}
