import type { SessionRow } from '@shared/types.ts';
import type { Preview } from '@/lib/store';
import { PlainView } from './Shell';
import { type SessionViewProps, SessionView } from './SessionView';

interface Props extends Omit<SessionViewProps, 'row' | 'ended' | 'now' | 'preview' | 'drawerOpen'> {
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
}

/**
 * The view's identity: the Session, kept across a Codex Session getting its session id, so the
 * view (an open or pending End Session dialog included) isn't remounted by the id change.
 */
function viewKey(row: SessionRow, aliases: ReadonlyMap<string, string>): string {
  const pidId = `${row.harness}:${row.pid}`;
  return aliases.get(pidId) === row.id ? pidId : row.id;
}

/** The main pane: the selected Session (VIEW), or the hint when nothing is selected (VIEW-5.4). */
export function MainPane({ selectedId, live, lastKnown, list, now, preview, drawerOpen, aliases, ...view }: Props) {
  if (!selectedId) return <Empty />;
  if (!live && list === 'loading') {
    return (
      <PlainView>
        <div className="p-8 text-sm text-muted-foreground">Loading…</div>
      </PlainView>
    );
  }
  if (!live && list === 'unavailable') {
    return (
      <PlainView>
        <div className="mx-auto w-full max-w-3xl px-8 py-7">
          <div role="status" className="rounded-lg border border-border bg-muted/60 px-3.5 py-3">
            <p className="text-sm font-medium">Can&apos;t tell whether this Session is running</p>
            <p className="text-[13px] text-muted-foreground">Fleet isn&apos;t answering, so the Session list is unknown.</p>
          </div>
        </div>
      </PlainView>
    );
  }
  const row = live ?? lastKnown;
  if (!row) {
    return (
      <PlainView>
        <div className="mx-auto w-full max-w-3xl px-8 py-7">
          <div role="status" className="rounded-lg border border-border bg-muted/60 px-3.5 py-3">
            <p className="text-sm font-medium">This Session ended</p>
            <p className="text-[13px] text-muted-foreground">Session {selectedId} isn&apos;t running.</p>
          </div>
        </div>
      </PlainView>
    );
  }
  return (
    <SessionView
      key={viewKey(row, aliases)}
      row={row}
      ended={!live}
      now={now}
      preview={preview}
      drawerOpen={drawerOpen(row)}
      {...view}
    />
  );
}

function Empty() {
  return (
    <PlainView>
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm font-medium">Select a Session</p>
        <ul className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1.5 text-left text-[12.5px] text-muted-foreground">
          <Hint keys={['↑', '↓']} alt={['j', 'k']} text="Move" />
          <Hint keys={['⌘', '1–9']} text="Jump to a row" />
          <Hint keys={['⌘', 'J']} text="Next that needs you" />
          <Hint keys={['/']} text="Filter" />
          <Hint keys={['N']} text="New Session (⌘N in the installed app)" />
        </ul>
      </div>
    </PlainView>
  );
}

function Hint({ keys, alt, text }: { keys: string[]; alt?: string[]; text: string }) {
  const kbd = (k: string) => (
    <kbd key={k} className="min-w-5 rounded border border-border bg-muted/50 px-1 text-center font-mono text-[11px] leading-5">
      {k}
    </kbd>
  );
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
