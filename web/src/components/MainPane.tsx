import type { SessionRow } from '@shared/types.ts';
import { CircleSlash, FolderGit2, GitBranch } from 'lucide-react';
import type { ReactNode } from 'react';
import { HARNESS_LABEL, STATUS_LABEL } from '@/lib/sessions';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { StatusMarker } from './StatusMarker';

interface Props {
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
}

/**
 * Placeholder main pane. The Session view (chat, composer, terminal preview) is the VIEW spec;
 * this only shows the selected Session's basic facts, and that it ended (SIDE-4.3).
 */
export function MainPane({ selectedId, live, lastKnown, list, now }: Props) {
  if (!selectedId) return <Empty />;
  if (!live && list === 'loading') return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!live && list === 'unavailable') {
    return (
      <div className="mx-auto w-full max-w-3xl px-8 py-7">
        <div role="status" className="rounded-lg border border-border bg-muted/60 px-3.5 py-3">
          <p className="text-sm font-medium">Can&apos;t tell whether this Session is running</p>
          <p className="text-[13px] text-muted-foreground">Fleet isn&apos;t answering, so the Session list is unknown.</p>
        </div>
      </div>
    );
  }
  const row = live ?? lastKnown;
  const ended = !live;

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-7">
      {ended && (
        <div role="status" className="mb-5 flex items-start gap-2.5 rounded-lg border border-border bg-muted/60 px-3.5 py-3">
          <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">This Session ended</p>
            <p className="text-[13px] text-muted-foreground">Its process is gone. It stays here until you select another Session.</p>
          </div>
        </div>
      )}
      {row ? <Facts row={row} ended={ended} now={now} /> : <p className="text-sm text-muted-foreground">Session {selectedId}</p>}
    </div>
  );
}

function Facts({ row, ended, now }: { row: SessionRow; ended: boolean; now: number }) {
  const age = row.statusSince !== null ? formatAge(now - row.statusSince) : null;
  return (
    <div className={cn(ended && 'opacity-60')}>
      <div className="flex items-center gap-2.5">
        {!ended && <StatusMarker status={row.status} />}
        <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight" title={row.title}>
          {row.title}
        </h1>
      </div>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        {HARNESS_LABEL[row.harness]}
        {row.model && <> · {row.model}</>}
      </p>

      <dl className="mt-6 grid grid-cols-[8.5rem_1fr] gap-x-4 gap-y-2.5 text-[13px]">
        {!ended && (
          <Fact label="Status">
            {STATUS_LABEL[row.status]}
            {age && <span className="text-muted-foreground"> · for {age}</span>}
            {row.waitingFor && <div className="text-needs-you-text">{row.waitingFor}</div>}
          </Fact>
        )}
        {row.git && <Fact label="Repo">{row.git.repo}</Fact>}
        {row.git?.worktree && (
          <Fact label="Worktree">
            <span className="inline-flex items-center gap-1">
              <FolderGit2 className="size-3.5" />
              {row.git.worktree}
            </span>
          </Fact>
        )}
        {row.git?.branch && (
          <Fact label="Branch">
            <span className="inline-flex items-center gap-1">
              <GitBranch className="size-3.5" />
              {row.git.branch}
            </span>
          </Fact>
        )}
        {row.cwd && (
          <Fact label="Directory">
            <span className="font-mono text-[12px] break-all">{row.cwd}</span>
          </Fact>
        )}
        {row.contextPct !== null && <Fact label="Context used">{row.contextPct}%</Fact>}
        <Fact label="Terminal">
          {/* Decision 0001: the UI never names tmux. */}
          {row.controllable ? (row.backend === 'iterm' ? 'iTerm2 · Controllable' : 'Controllable') : 'Another app · not Controllable'}
        </Fact>
        <Fact label="Process">
          <span className="font-mono text-[12px]">{row.pid}</span>
        </Fact>
        <Fact label="Session ID">
          <span className="font-mono text-[12px] break-all">{row.id}</span>
        </Fact>
      </dl>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function Empty() {
  return (
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
