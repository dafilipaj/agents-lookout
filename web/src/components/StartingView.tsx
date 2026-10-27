import type { LaunchView } from '@shared/types.ts';
import { CircleX, LoaderCircle } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Loading } from '@/components/ui/loading';
import { HARNESS_NAME } from '@/lib/sessions';
import { STATUS_TAG_CLASS } from '@/lib/sessions';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';
import { SessionMarker } from '@/components/ui/session-marker';
import { TerminalNote } from './Answering';
import { PaneHeader, PlainView, ShellCell, ShellView } from './Shell';

interface Props {
  /** The selected start, or null when this tab doesn't list it (dismissed elsewhere, or long gone). */
  launch: LaunchView | null;
  /** The first snapshot has arrived, so a missing launch really isn't listed. */
  loaded: boolean;
  now: number;
  onTrust?(answer: 'accept' | 'decline', prompt: string): void;
}

/**
 * LAUNCH-4.6: the main pane while a "Starting…" row is selected: what was started and how long
 * ago, then, once it failed (LAUNCH-4.5), the error and its terminal's last lines in place of the
 * waiting note. The header says the Harness and the state once each. No dock: its content
 * runs to the bottom (SIDE-8). The Session takes over the selection once Fleet reports it (App).
 */
export function StartingView({ launch, loaded, now, onTrust }: Props) {
  if (!launch) {
    return (
      <PlainView>
        {loaded ? (
          <div className="mx-auto w-full max-w-3xl px-8 py-7">
            <Alert
              tone="info"
              title="This start is no longer listed"
              detail="It was dismissed in another tab, became a Session while this tab wasn't watching, or Lookout restarted. Select a Session in the sidebar."
            />
          </div>
        ) : (
          <Loading label="Loading…" className="p-8" />
        )}
      </PlainView>
    );
  }

  const failed = launch.state === 'failed';
  const trust = launch.state === 'trust' ? launch.trust : null;
  const statusText = trust
    ? trust.answering === 'accept' ? 'Trusting…' : trust.answering === 'decline' ? 'Cancelling…' : 'Claude Code asks whether you trust this folder'
    : failed ? '' : 'Waiting for Fleet to report the Session…';
  const age = formatAge(now - launch.startedAt);
  return (
    <ShellView data-testid="starting-view">
      <PaneHeader aria-label="Starting Session">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {trust ? <SessionMarker state="live" status="needs-you" /> : failed ? (
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
              trust ? STATUS_TAG_CLASS['needs-you'] : failed ? 'bg-destructive/10 ring-1 ring-destructive/30 ring-inset' : 'bg-muted',
            )}
            data-field="status"
          >
            {trust ? 'Needs you' : failed ? "Didn't start" : 'Starting…'}
          </span>
        </div>
      </PaneHeader>
      <ShellCell row="body" toBottom className="overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-8 py-7">
          {/* LAUNCH-6.9: one polite region stays mounted for the whole start; only its text changes, so the first announcement is reliable. */}
          <p role="status" className={trust || failed ? 'sr-only' : 'mt-5 text-body text-muted-foreground'}>{statusText}</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1.5 text-body" aria-label="What was started">
            <dt className="text-muted-foreground">Directory</dt>
            <dd className="font-mono text-body break-all">
              {launch.directory}
            </dd>
            <dt className="text-muted-foreground">Started</dt>
            <dd className="tabular-nums">{age} ago</dd>
          </dl>
          {trust ? (
            <section className="mt-5" aria-labelledby="starting-trust-heading">
              <h2 id="starting-trust-heading" className="text-body font-semibold">Claude Code asks whether you trust this folder</h2>
              {trust.lines && <pre className="mt-2 max-h-[calc(14*1.45em)] overflow-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-meta leading-[1.45] whitespace-pre-wrap break-words text-foreground/90 dark:bg-black/25">{trust.lines.join('\n')}</pre>}
              {trust.message ? <TerminalNote message={trust.message} terminal={null} className="mt-3" /> : (
                <div className="mt-3 flex gap-2">
                  <Button aria-disabled={trust.answering ? true : undefined} aria-describedby="starting-trust-accept" onClick={() => { if (!trust.answering && trust.answerable && trust.id) onTrust?.('accept', trust.id); }}>
                    {trust.answering === 'accept' ? 'Trusting…' : 'Trust folder'}
                  </Button>
                  <Button variant="outline" aria-disabled={trust.answering ? true : undefined} aria-describedby="starting-trust-decline" onClick={() => { if (!trust.answering && trust.answerable && trust.id) onTrust?.('decline', trust.id); }}>
                    {trust.answering === 'decline' ? 'Cancelling…' : 'Cancel'}
                  </Button>
                </div>
              )}
              <p id="starting-trust-accept" className="sr-only">Answers “Yes, I trust this folder”, after which Claude Code runs in the folder with what its settings pre-approve.</p>
              <p id="starting-trust-decline" className="sr-only">Answers “No, exit”, which ends the start.</p>
              <p className="mt-2 text-meta text-muted-foreground">Claude Code remembers your answer for this folder.</p>
              {launch.terminal && <TerminalLines lines={launch.terminal} />}
            </section>
          ) : failed ? (
            <>
              {launch.error && <Alert title={launch.error} className="mt-5" />}
              {launch.terminal && launch.terminal.length > 0 ? (
                <TerminalLines lines={launch.terminal} />
              ) : (
                <p className="mt-3 text-body text-muted-foreground">No terminal lines to show.</p>
              )}
            </>
          ) : null}
        </div>
      </ShellCell>
    </ShellView>
  );
}

function TerminalLines({ lines }: { lines: string[] }) {
  return (
    <section className="mt-5" aria-labelledby="starting-terminal">
      <h2 id="starting-terminal" className="mb-1.5 text-meta font-medium text-muted-foreground">Its terminal&apos;s last lines</h2>
      <pre className="overflow-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-meta leading-[1.45] whitespace-pre text-foreground/90 dark:bg-black/25">{lines.join('\n')}</pre>
    </section>
  );
}
