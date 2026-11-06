import type { LaunchView } from '@shared/types.ts';
import { CircleX, SendHorizontal } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Loading } from '@/components/ui/loading';
import { LookoutMark } from '@/components/ui/lookout-mark';
import { HARNESS_NAME } from '@/lib/sessions';
import { STATUS_TAG_CLASS } from '@/lib/sessions';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';
import { SessionMarker } from '@/components/ui/session-marker';
import { TerminalNote } from './Answering';
import { useState } from 'react';
import { CHAT_COLUMN, Prompt, SkeletonBar } from './Chat';
import { ComposerFrame, StatusBar } from './SessionView';
import { PaneHeader, PlainView, ShellCell, ShellView } from './Shell';

/** LAUNCH-7.3, DS-6.7: a start fails at 15 s (LAUNCH-4.5), so its hint shows at 10 s. */
export const START_HINT_MS = 10_000;

/** LAUNCH-7.3: where the reply will be, three of the chat's skeleton bars (DS-6.2). */
const BARS = [85, 60, 40];

interface Props {
  /** The selected start, or null when this tab doesn't list it (dismissed elsewhere, or long gone). */
  launch: LaunchView | null;
  /** The first snapshot has arrived, so a missing launch really isn't listed. */
  loaded: boolean;
  now: number;
  onTrust?(answer: 'accept' | 'decline', prompt: string): void;
}

/**
 * LAUNCH-4.6, LAUNCH-7: the main pane while a "Starting…" row is selected, as the Session it will
 * become: the Session view's header, chat column and dock (SIDE-8.1), so nothing moves when the
 * Session takes over (App). Your first prompt is already in the chat as a message you sent
 * (VIEW-1.13's look), and under it, where the reply will be, a `Loading` with the orbiting Lens
 * (DS-14.4) and the chat's skeleton bars; a Trust prompt's card (LAUNCH-6) or a failure's error and
 * terminal lines (LAUNCH-4.5) take its place. The composer waits, disabled, until it's ready.
 */
export function StartingView({ launch, loaded, now, onTrust }: Props) {
  const trustEnd = useTrustEnd(launch, now);
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
          <Loading label="Finding the start…" className="p-8" />
        )}
      </PlainView>
    );
  }

  const failed = launch.state === 'failed';
  const trust = launch.state === 'trust' ? launch.trust : null;
  const harness = HARNESS_NAME[launch.harness];
  const folder = launch.directory.replace(/\/+$/, '').split('/').pop() || launch.directory;
  // LAUNCH-7.3: the Harness, and the directory's name; its full path is the tooltip.
  const waiting = `${harness} is ${launch.resume ? 'resuming' : 'starting'} in ${folder}…`;
  const statusText = trust
    ? trust.answering === 'accept' ? 'Trusting…' : trust.answering === 'decline' ? 'Cancelling…' : `${harness} asks whether you trust this folder`
    : failed ? '' : waiting;
  return (
    <ShellView data-testid="starting-view">
      <PaneHeader aria-label="Starting Session">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {/* Where the Session's Status marker will be: the Lens, looking, until it's a Session. */}
          {trust ? <SessionMarker state="live" status="needs-you" /> : failed ? (
            <CircleX aria-hidden className="size-3.5 shrink-0 text-destructive" />
          ) : (
            <LookoutMark orbiting className="size-3.5 text-muted-foreground" />
          )}
          <h1 className="min-w-0 truncate text-title font-semibold tracking-tight" title={launch.title}>
            {launch.title}
          </h1>
          <span className="flex shrink-0 items-center gap-1.5 text-meta text-muted-foreground" data-field="harness">
            <HarnessIcon harness={launch.harness} tone="brand" className="size-4" />
            {harness}
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
      {/* The chat's column (Chat's list): the same width, padding and gaps, so your prompt stays put. */}
      <ShellCell row="body" toBottom={failed} className="overflow-y-auto">
        <div className={CHAT_COLUMN}>
          {/* LAUNCH-6.9: one polite region stays mounted for the whole start; only its text changes, so the first announcement is reliable. */}
          <p role="status" className="sr-only">{statusText}</p>
          {launch.prompt && (
            <div data-field="first-prompt">
              <Prompt text={launch.prompt} ts={null} state="sending" />
            </div>
          )}
          {trust ? (
            <section aria-labelledby="starting-trust-heading">
              <h2 id="starting-trust-heading" className="text-body font-semibold">{harness} asks whether you trust this folder</h2>
              {trust.lines && <pre className="mt-2 max-h-[calc(14*1.45em)] overflow-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-meta leading-[1.45] whitespace-pre-wrap break-words text-foreground/90 dark:bg-black/25">{trust.lines.join('\n')}</pre>}
              {trust.message ? <TerminalNote message={trust.message} terminal={null} className="mt-3" /> : (
                <div className="mt-3 flex gap-2">
                  <Button variant="primary" size="default" aria-disabled={trust.answering ? true : undefined} aria-describedby="starting-trust-accept" onClick={() => { if (!trust.answering && trust.answerable && trust.id) onTrust?.('accept', trust.id); }}>
                    {trust.answering === 'accept' ? 'Trusting…' : 'Trust folder'}
                  </Button>
                  <Button variant="secondary" size="default" aria-disabled={trust.answering ? true : undefined} aria-describedby="starting-trust-decline" onClick={() => { if (!trust.answering && trust.answerable && trust.id) onTrust?.('decline', trust.id); }}>
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
            <div data-field="failure">
              {/* LAUNCH-7.5: where and when, once, above the error. */}
              <p className="text-body text-muted-foreground" data-field="started">
                Started in <span className="font-mono break-all text-foreground">{launch.directory}</span> <span className="tabular-nums">{formatAge(now - launch.startedAt)}</span> ago
              </p>
              {launch.error && <Alert title={launch.error} className="mt-3" />}
              {launch.terminal && launch.terminal.length > 0 ? (
                <TerminalLines lines={launch.terminal} />
              ) : (
                <p className="mt-3 text-body text-muted-foreground">No terminal lines to show.</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4" data-field="arriving">
              {/* LAUNCH-7.3: announced through the region above, so not a region of its own. */}
              <Loading
                label={waiting}
                title={launch.directory}
                since={launch.startedAt}
                hintAfter={START_HINT_MS + (trustEnd === null ? 0 : Math.max(0, trustEnd - launch.startedAt))}
                hint="Taking longer than usual. At 15 s, its terminal shows here."
                live={false}
              />
              <div className="flex flex-col gap-4" aria-hidden>
                {BARS.map((w) => (
                  <SkeletonBar key={w} width={w} />
                ))}
              </div>
            </div>
          )}
        </div>
      </ShellCell>
      {/* LAUNCH-7.2: the Session view's dock, the composer disabled until the Session is ready, the
          status line empty. A failed start has nothing to type to: its content runs to the bottom. */}
      {!failed && (
        <ShellCell row="dock">
          <ComposerFrame
            onSubmit={(e) => e.preventDefault()}
            field={{ 'aria-label': 'Message', placeholder: "You can type once it's ready", disabled: true }}
            send={{
              disabled: true,
              // DS-18.4: one primary per surface; while the Trust card asks, its Trust folder is it.
              ...(trust ? { variant: 'secondary' as const } : {}),
              children: (
                <>
                  Send
                  <SendHorizontal className="size-3.5" />
                </>
              ),
            }}
          />
          <StatusBar data-field="status-line" />
        </ShellCell>
      )}
    </ShellView>
  );
}

/**
 * LAUNCH-4.5: a start's 15 s run again from the answer to its Trust prompt (the server's
 * `waitAgain`), so its hint (DS-6.7) counts 10 s from there too: when this tab last saw the start
 * leave its Trust prompt, or null.
 */
function useTrustEnd(launch: LaunchView | null, now: number): number | null {
  const id = launch?.id ?? null;
  const asking = launch?.state === 'trust';
  const [seen, setSeen] = useState<{ id: string | null; asking: boolean; end: number | null }>({ id, asking, end: null });
  if (seen.id !== id) setSeen({ id, asking, end: null });
  else if (seen.asking !== asking) setSeen({ id, asking, end: asking ? seen.end : now });
  return seen.end;
}

function TerminalLines({ lines }: { lines: string[] }) {
  return (
    <section className="mt-5" aria-labelledby="starting-terminal">
      <h2 id="starting-terminal" className="mb-1.5 text-meta font-medium text-muted-foreground">Its terminal&apos;s last lines</h2>
      <pre className="overflow-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-meta leading-[1.45] whitespace-pre text-foreground/90 dark:bg-black/25">{lines.join('\n')}</pre>
    </section>
  );
}
