import type { LocalServer, PortsSnapshot } from '@shared/ports.ts';
import type { SessionRow } from '@shared/types.ts';
import { type KeyboardEvent, type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Loading } from '@/components/ui/loading';
import { SessionMarker } from '@/components/ui/session-marker';
import { clockTime } from '@/lib/chat';
import { groupServers, upFor } from '@/lib/ports';
import type { PanelNav } from '@/lib/right-sidebar';
import { cn } from '@/lib/utils';

export interface ServersPanelProps {
  ports: PortsSnapshot | null;
  /** Every Session, in any order: the groups follow the sidebar's. */
  sessions: readonly SessionRow[];
  now: number;
  showAll: boolean;
  onShowAll(value: boolean): void;
  /** Bumped to move focus into the list (HIST-1.1). */
  focusKey: number;
  /** PORTS-2.2: the Session whose group to scroll to and select, once. */
  reveal: string | null;
  onRevealed(): void;
  onSelectSession(id: string): void;
  navRef?: Ref<PanelNav>;
}

const rowId = (s: LocalServer) => `server-${s.pid}`;
const open = (s: LocalServer) => window.open(s.url, '_blank', 'noopener,noreferrer');

/**
 * PORTS-3: every Local server, grouped by the Session it belongs to, then "Not in a Session" by
 * repo, then "Elsewhere"; "Show all" adds the other listeners, dimmed. j/k and ↑/↓ move through the
 * rows, Enter opens the selected one's URL.
 */
export function ServersPanel({ ports, sessions, now, showAll, onShowAll, focusKey, reveal, onRevealed, onSelectSession, navRef }: ServersPanelProps) {
  const groups = groupServers(ports, sessions, showAll);
  const rows = [...groups.sessions.flatMap((g) => g.servers), ...groups.repos.flatMap((g) => g.servers), ...groups.elsewhere, ...groups.others];
  const [selected, setSelected] = useState<number | null>(null);
  const active = rows.find((s) => s.pid === selected) ?? rows[0] ?? null;
  const list = useRef<HTMLDivElement>(null);

  // SIDE-11.1: opening Servers focuses its list, only when you open it (`focusKey` above 0), never as it mounts.
  useEffect(() => {
    if (focusKey) list.current?.focus();
  }, [focusKey]);

  // PORTS-2.2: the chip of a Session with several servers opens this tab at its group, its first
  // row selected. Adjusting state while rendering, as React documents for derived state.
  const [revealed, setRevealed] = useState<string | null>(null);
  if (reveal !== revealed) {
    setRevealed(reveal);
    const first = reveal ? groups.sessions.find((g) => g.session.id === reveal)?.servers[0] : undefined;
    if (first) setSelected(first.pid);
  }
  useLayoutEffect(() => {
    if (!reveal) return;
    document.getElementById(`servers-group-${reveal}`)?.scrollIntoView?.({ block: 'start' });
    onRevealed();
  }, [reveal, onRevealed]);

  const move = (delta: 1 | -1) => {
    if (!rows.length) return;
    const at = active ? rows.indexOf(active) : -1;
    const next = rows[Math.max(0, Math.min(rows.length - 1, at + delta))]!;
    setSelected(next.pid);
    document.getElementById(rowId(next))?.scrollIntoView?.({ block: 'nearest' });
  };
  useImperativeHandle(navRef, () => ({ move }));

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.target !== e.currentTarget) return;
    const delta = ({ j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 } as const)[e.key as 'j'];
    if (delta) {
      e.preventDefault();
      move(delta);
    } else if (e.key === 'Enter' && active) {
      e.preventDefault();
      open(active);
    }
  };

  const failed = ports?.error ?? null;
  const row = (s: LocalServer, dim = false) => <ServerRow key={s.pid} server={s} now={now} active={s === active} dim={dim} onSelect={() => setSelected(s.pid)} />;
  const heading = (text: string) => <p className="px-2 pt-3 pb-1 text-caption font-medium text-muted-foreground">{text}</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-end gap-2 border-b border-sidebar-border px-3 py-1.5 text-meta text-muted-foreground">
        <label className="flex items-center gap-1.5">
          <Checkbox checked={showAll} onChange={(e) => onShowAll(e.target.checked)} />
          Show all
        </label>
      </div>
      {failed && ports?.readAt !== null && ports?.readAt !== undefined && (
        <Alert className="mx-2.5 mt-2" data-field="ports-error" title={`Couldn't read the ports: ${failed}. Showing the list from ${clockTime(new Date(ports.readAt).toISOString())}.`} />
      )}
      {!ports ? (
        <Loading label="Reading ports…" className="items-center px-4 py-3" />
      ) : failed && ports.readAt === null ? (
        <Alert className="mx-2.5 mt-2" data-field="ports-error" title={`Couldn't read the ports: ${failed}.`} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {!rows.length && (
            <EmptyState role="status" title="No Local servers running." hint={!showAll && groups.hidden ? `${groups.hidden} other listener${groups.hidden === 1 ? '' : 's'} hidden` : undefined} />
          )}
          <div
            ref={list}
            role="listbox"
            aria-label="Local servers"
            tabIndex={0}
            aria-activedescendant={active ? rowId(active) : undefined}
            onKeyDown={onKeyDown}
            className="outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            {groups.sessions.map(({ session, servers }) => (
              <div key={session.id} role="group" aria-label={session.title} id={`servers-group-${session.id}`}>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => onSelectSession(session.id)}
                  className="mt-2 flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-body font-medium hover:bg-sidebar-accent/60"
                >
                  <SessionMarker aria-hidden state="live" status={session.status} since={session.statusSince} />
                  <span className="truncate">{session.title}</span>
                </button>
                {servers.map((s) => row(s))}
              </div>
            ))}
            {(groups.repos.length > 0 || groups.elsewhere.length > 0) && (
              <div role="group" aria-label="Not in a Session">
                {heading('Not in a Session')}
                {groups.repos.map((g) => (
                  <div key={g.commonDir} role="group" aria-label={g.name}>
                    <p className="truncate px-2 pt-1 text-meta font-medium" title={g.commonDir}>{g.name}</p>
                    {g.servers.map((s) => row(s))}
                  </div>
                ))}
                {groups.elsewhere.length > 0 && (
                  <div role="group" aria-label="Elsewhere">
                    <p className="px-2 pt-1 text-meta font-medium">Elsewhere</p>
                    {groups.elsewhere.map((s) => row(s))}
                  </div>
                )}
              </div>
            )}
            {groups.others.length > 0 && (
              <div role="group" aria-label="Other listeners">
                {heading('Other listeners')}
                {groups.others.map((s) => row(s, true))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** PORTS-3.2: the port as a link to the URL, the name, the working directory and how long it's been up. */
function ServerRow({ server: s, now, active, dim, onSelect }: { server: LocalServer; now: number; active: boolean; dim: boolean; onSelect(): void }) {
  const age = s.startedAt !== null ? upFor(s.startedAt, now) : null;
  return (
    <div
      id={rowId(s)}
      role="option"
      aria-selected={active}
      aria-label={[`:${s.ports.join(', :')}`, s.name, s.dir ?? 'unknown directory', age && `up ${age}`].filter(Boolean).join(' ')}
      data-pid={s.pid}
      onClick={onSelect}
      className={cn('flex min-w-0 cursor-default items-baseline gap-2 rounded-md px-2 py-1 hover:bg-sidebar-accent/60', active && 'bg-sidebar-accent', dim && 'opacity-60')}
    >
      <a href={s.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} className="shrink-0 text-body tabular-nums underline-offset-2 hover:underline" data-field="port">
        :{s.ports[0]}
      </a>
      {s.ports.length > 1 && <span className="shrink-0 text-meta text-muted-foreground tabular-nums">{s.ports.slice(1).map((p) => `:${p}`).join(' ')}</span>}
      {/* PORTS-3.2: the port and the name are the server's identity, so the name keeps up to 60% of the
          row and the directory gives way first, cut from its start: a Worktree's name ends in what tells it apart. */}
      <span className="max-w-[60%] shrink-0 truncate text-body" data-field="name">{dim ? s.command : s.name}</span>
      <span
        // An rtl box puts the ellipsis at the start; the ltr span inside keeps a leading `~/` or trailing `/` in place.
        className="ml-auto min-w-0 truncate text-left text-meta text-muted-foreground [direction:rtl]"
        title={s.cwd ?? undefined}
        data-field="dir"
      >
        <span dir="ltr">{s.dir ?? 'unknown directory'}</span>
      </span>
      {age && <span className="shrink-0 text-meta text-muted-foreground tabular-nums" data-field="age">{age}</span>}
    </div>
  );
}
