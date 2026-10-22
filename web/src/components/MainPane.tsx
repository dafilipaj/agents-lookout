import type { SessionRow } from '@shared/types.ts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Kbd } from '@/components/ui/kbd';
import { Loading } from '@/components/ui/loading';
import { type AnswerAttempt, type ScreenState, type StopRequest, processKey } from '@/lib/answers';
import { type SwitchState, switchKey } from '@/lib/status-switch';
import { type FileLinks, FileLinksContext } from '@/lib/files';
import type { Preview } from '@/lib/store';
import { PlainView } from './Shell';
import { type SessionViewProps, SessionView } from './SessionView';

interface Props extends Omit<SessionViewProps, 'row' | 'ended' | 'now' | 'preview' | 'drawerOpen' | 'screen' | 'attempt' | 'stopRequest' | 'statusSwitch'> {
  drawerOpen(row: SessionRow): boolean;
  /** The selected Session's id, or null when nothing is selected. */
  selectedId: string | null;
  /** The live row, when the Session is running. */
  live: SessionRow | null;
  /** The last row seen for it, when it ended. */
  lastKnown: SessionRow | null;
  /**
   * Whether the Session list can be trusted to say a Session ended: `loading` until Fleet's first
   * answer, `unavailable` while Fleet is missing or has never answered.
   */
  list: 'loading' | 'unavailable' | 'known';
  now: number;
  preview: Preview | null;
  /** Old id -> new id of the same process (a Codex Session that got its session id). */
  aliases: ReadonlyMap<string, string>;
  /** VIEW-4.2: the prompt on each viewed Session's terminal. */
  prompts: ReadonlyMap<string, ScreenState>;
  /** VIEW-4: the latest answer and the last Stop per Session, by its process (`processKey`). */
  attempts: ReadonlyMap<string, AnswerAttempt>;
  stops: ReadonlyMap<string, StopRequest>;
  /** VIEW-6, VIEW-7: each Session process's switch of its model or Effort (`switchKey`). */
  switches: ReadonlyMap<string, SwitchState>;
  /** VIEW-1.17: the live Sessions' file links, for the chat; a past Session's view has none. */
  fileLinks: FileLinks;
  /** DS-6.4: a live Session or a Starting row exists, so the hint, not "No Sessions running", shows when nothing is selected. */
  running: boolean;
  /** DS-6.4: "Start a Session", as `N` does. */
  onNewSession(): void;
}

/**
 * The view's identity: the Session, kept across a Codex Session getting its session id, so the
 * view (an open or pending End Session dialog included) isn't remounted by the id change.
 */
function viewKey(row: SessionRow, aliases: ReadonlyMap<string, string>): string {
  const pidId = `${row.harness}:${row.pid}`;
  return aliases.get(pidId) === row.id ? pidId : row.id;
}

/**
 * The main pane: the selected Session (VIEW), or the hint when nothing is selected (VIEW-5.4), or,
 * with no Session at all, "No Sessions running" and a way to start one (DS-6.4).
 */
export function MainPane({ selectedId, live, lastKnown, list, now, preview, drawerOpen, aliases, prompts, attempts, stops, switches, fileLinks, running, onNewSession, ...view }: Props) {
  // Before the first snapshot nothing is known: not the hint, which would give way to "No Sessions running" a moment later.
  if (!selectedId && list !== 'loading') return list === 'known' && !running ? <NoSessions onNewSession={onNewSession} /> : <Empty />;
  if (!live && list === 'loading') {
    return (
      <PlainView>
        <Loading label="Loading…" className="p-8" />
      </PlainView>
    );
  }
  if (!live && list === 'unavailable') {
    return (
      <PlainView>
        <div className="mx-auto w-full max-w-3xl px-8 py-7">
          <Alert tone="info" title="Can't tell whether this Session is running" detail="Fleet isn't answering, so the Session list is unknown." />
        </div>
      </PlainView>
    );
  }
  const row = live ?? lastKnown;
  if (!row) {
    return (
      <PlainView>
        <div className="mx-auto w-full max-w-3xl px-8 py-7">
          <Alert tone="info" title="This Session ended" detail={`Session ${selectedId} isn't running.`} />
        </div>
      </PlainView>
    );
  }
  return (
    <FileLinksContext.Provider value={fileLinks}>
      <SessionView
        key={viewKey(row, aliases)}
        row={row}
        ended={!live}
        now={now}
        preview={preview}
        drawerOpen={drawerOpen(row)}
        screen={prompts.get(row.id)}
        attempt={attempts.get(processKey(row))}
        stopRequest={stops.get(processKey(row))}
        statusSwitch={switches.get(switchKey(row))}
        {...view}
      />
    </FileLinksContext.Provider>
  );
}

/** VIEW-5.4: nothing selected among the Sessions there are: the keys that move through them. */
function Empty() {
  return (
    <PlainView>
      <EmptyState
        className="h-full justify-center p-8"
        title="Select a Session"
        hint={
          <ul className="mt-3 grid grid-cols-[auto_auto] gap-x-3 gap-y-1.5 text-left">
            <Hint keys={['↑', '↓']} alt={['j', 'k']} text="Move" />
            <Hint keys={['⌘', '1–9']} text="Jump to a row" />
            <Hint keys={['⌘', 'J']} text="Next that needs you" />
            <Hint keys={['/']} text="Filter" />
            <Hint keys={['N']} text="New Session (⌘N in the installed app)" />
          </ul>
        }
      />
    </PlainView>
  );
}

/** DS-6.4: no live Session and no Starting row: say so, with the launcher a click away and `N` under it. */
function NoSessions({ onNewSession }: { onNewSession(): void }) {
  return (
    <PlainView>
      <EmptyState
        className="h-full justify-center p-8"
        title="No Sessions running"
        action={
          <div className="flex flex-col items-center gap-3">
            <Button size="sm" onClick={onNewSession}>
              Start a Session
            </Button>
            <ul className="grid grid-cols-[auto_auto] gap-x-3 text-left text-meta text-muted-foreground">
              <Hint keys={['N']} text="New Session (⌘N in the installed app)" />
            </ul>
          </div>
        }
      />
    </PlainView>
  );
}

function Hint({ keys, alt, text }: { keys: string[]; alt?: string[]; text: string }) {
  const kbd = (k: string) => <Kbd key={k}>{k}</Kbd>;
  return (
    <li className="contents">
      <span className="flex items-center justify-end gap-1">
        {keys.map(kbd)}
        {alt && <span className="px-0.5">or</span>}
        {alt?.map(kbd)}
      </span>
      <span className="leading-5">{text}</span>
    </li>
  );
}
