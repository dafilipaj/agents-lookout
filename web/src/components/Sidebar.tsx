import { sortSessions } from '@shared/order.ts';
import type { FleetHealth, LaunchView, SessionRow } from '@shared/types.ts';
import type { UsageSnapshot } from '@shared/usage.ts';
import { Plus, Search, Settings as SettingsIcon, TriangleAlert, WifiOff } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { isLongIdle, matchesFilter } from '@/lib/sessions';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { LaunchItem } from './LaunchItem';
import { SessionItem } from './SessionItem';
import { DockRest } from './SessionView';
import { SHELL_COLUMN, ShellCell } from './Shell';
import { UsageStrip } from './UsageStrip';

export interface SidebarProps {
  sessions: readonly SessionRow[];
  fleet: FleetHealth;
  loaded: boolean;
  connected: boolean;
  idleThresholdHours: number;
  selectedId: string | null;
  now: number;
  /** `replace`: a keyboard step, which shouldn't flood the history. */
  onSelect(id: string, how: 'push' | 'replace'): void;
  onOpenSettings(): void;
  settingsOpen: boolean;
  /** LAUNCH-1.1: the "+" button. */
  onNewSession(): void;
  /** LAUNCH-4: starts in flight, shown above the Sessions. */
  launches: readonly LaunchView[];
  /** LAUNCH-4.2: the selected "Starting…" row, if any (then `selectedId` is null). */
  selectedLaunchId: string | null;
  onSelectLaunch(id: string, how: 'push' | 'replace'): void;
  /** Nothing selected: the selected start was dismissed and no other start is left. */
  onSelectNone(): void;
  onDismissLaunch(id: string): void;
  /** False while a dialog owns the keyboard. */
  keyboardEnabled: boolean;
  /** USAGE-1: the strip at the bottom. */
  usage: UsageSnapshot | null;
  /** USAGE-2.1: its details opened. */
  onUsageOpen?(): void;
}

export function Sidebar(props: SidebarProps) {
  const { sessions, fleet, loaded, connected, idleThresholdHours, selectedId, now, onSelect, launches, selectedLaunchId, onSelectLaunch } = props;
  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);

  // SIDE-3.4: while the pointer is over the sidebar, rows keep their places; new ones go last.
  const [frozenOrder, setFrozenOrder] = useState<string[] | null>(null);
  // SIDE-1.5 / SIDE-3.1: Controllable Sessions first, then the "View only" section; each in
  // Status order.
  const sortedIds = useMemo(
    () => [...sortSessions(sessions.filter((s) => s.controllable)), ...sortSessions(sessions.filter((s) => !s.controllable))].map((s) => s.id),
    [sessions],
  );
  const orderedIds = useMemo(() => (frozenOrder ? keepOrder(frozenOrder, sortedIds) : sortedIds), [frozenOrder, sortedIds]);
  // Rows that arrived (or left) during the hover join the frozen order, so they don't move among
  // themselves either. Adjusting state while rendering, as React documents for derived state.
  if (frozenOrder && !sameOrder(frozenOrder, orderedIds)) setFrozenOrder(orderedIds);

  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const { controllable, viewOnly, visible } = useMemo(() => {
    const rows = orderedIds.map((id) => byId.get(id)).filter((r): r is SessionRow => !!r && matchesFilter(r, filter));
    const controllable = rows.filter((r) => r.controllable);
    const viewOnly = rows.filter((r) => !r.controllable);
    // Keyboard order follows what's on screen: the first section, then the second.
    return { controllable, viewOnly, visible: [...controllable, ...viewOnly] };
  }, [orderedIds, byId, filter]);

  // SIDE-5: keyboard. Rows in screen order: "Starting…" rows first (LAUNCH-4.7), then the Sessions.
  const rows = useMemo<NavRow[]>(
    () => [...launches.map((l) => ({ kind: 'launch' as const, id: l.id, failed: l.state === 'failed' })), ...visible.map((r) => ({ kind: 'session' as const, id: r.id, needsYou: r.status === 'needs-you' }))],
    [launches, visible],
  );
  const latest = useRef({ rows, selectedId, selectedLaunchId, onSelect, onSelectLaunch, enabled: props.keyboardEnabled });
  useEffect(() => {
    latest.current = { rows, selectedId, selectedLaunchId, onSelect, onSelectLaunch, enabled: props.keyboardEnabled };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented || !latest.current.enabled) return;
      const { rows, selectedId, selectedLaunchId, onSelect, onSelectLaunch } = latest.current;
      const inFilter = e.target === filterRef.current;
      const editing = !inFilter && isEditable(e.target);
      const index = rows.findIndex((r) => (r.kind === 'launch' ? r.id === selectedLaunchId : r.id === selectedId));
      const select = (row: NavRow | undefined, how: 'push' | 'replace') => {
        if (!row) return;
        if (row.kind === 'launch') onSelectLaunch(row.id, how);
        else onSelect(row.id, how);
      };
      const step = (delta: 1 | -1) => {
        if (!rows.length) return;
        const next = index === -1 ? (delta === 1 ? 0 : rows.length - 1) : clamp(index + delta, 0, rows.length - 1);
        select(rows[next], 'replace');
      };

      if (e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey) {
        if (/^[1-9]$/.test(e.key)) {
          e.preventDefault();
          // A failed start stays until it's dismissed, so it doesn't take a number (LAUNCH-4.7).
          select(rows.filter((r) => r.kind === 'session' || !r.failed)[Number(e.key) - 1], 'push');
        } else if (e.key.toLowerCase() === 'j') {
          // "Starting…" rows never Need you, so ⌘J skips them.
          e.preventDefault();
          const needsYou = (r: NavRow) => r.kind === 'session' && r.needsYou;
          const waiting = rows.filter(needsYou);
          if (!waiting.length) return;
          select(rows.slice(index + 1).find(needsYou) ?? waiting[0], 'push');
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || editing) return;
      // Arrow keys from inside the chat scroll it (VIEW-1.11 moves focus there after a jump).
      const inChat = e.target instanceof Element && !!e.target.closest('[data-scroll-keys]');

      if (inFilter) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setFilter('');
          filterRef.current?.blur();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          step(e.key === 'ArrowDown' ? 1 : -1);
        }
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        filterRef.current?.focus();
      } else if ((e.key === 'ArrowDown' && !inChat) || e.key === 'j') {
        e.preventDefault();
        step(1);
      } else if ((e.key === 'ArrowUp' && !inChat) || e.key === 'k') {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'Escape' && filter) {
        setFilter('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filter]);

  // LAUNCH UX: dismissing the selected start selects the next start (else the one before); with no
  // other start left, nothing is selected. Once its row is gone, focus goes to the Dismiss button
  // of the start that took its place, if it failed too, else to the main pane, never to <body>.
  const launchesRef = useRef<HTMLUListElement>(null);
  const dismissed = useRef<{ id: string; then: string | null } | null>(null);
  const dismiss = (id: string) => {
    const i = launches.findIndex((l) => l.id === id);
    const then = launches[i + 1]?.id ?? launches[i - 1]?.id ?? null;
    if (id === selectedLaunchId) {
      if (then) onSelectLaunch(then, 'replace');
      else props.onSelectNone();
    }
    dismissed.current = { id, then };
    props.onDismissLaunch(id);
  };
  useEffect(() => {
    const d = dismissed.current;
    if (!d || launches.some((l) => l.id === d.id)) return;
    dismissed.current = null;
    const next = d.then && launchesRef.current?.querySelector<HTMLElement>(`[data-launch-id="${CSS.escape(d.then)}"] button`);
    (next || document.querySelector<HTMLElement>('main[tabindex]'))?.focus();
  }, [launches]);

  const stale = fleet.state === 'failing' || (loaded && !connected);
  const body = (() => {
    if (!loaded) return <Message title="Connecting…" />;
    if (fleet.state === 'not-installed') return <NotInstalled command={fleet.installCommand} />;
    if (fleet.state === 'starting' && sessions.length === 0) return <Message title="Looking for Sessions…" />;
    if (fleet.state === 'failing' && fleet.lastOkAt === null && sessions.length === 0) {
      return <Message title="Fleet isn't answering" hint={fleet.error} />;
    }
    const startHint = (
      <>
        Press <Code>N</Code> to start one here, or run <Code>claude</Code> or <Code>codex</Code> in iTerm2.
      </>
    );
    if (sessions.length === 0) {
      if (props.launches.length) return null;
      return <Message title="No live Sessions" hint={startHint} />;
    }
    if (visible.length === 0) return <Message title="No matching Sessions" hint="Esc clears the filter." />;
    const item = (row: SessionRow) => (
      <SessionItem
        key={row.id}
        row={row}
        selected={row.id === selectedId}
        dimmed={isLongIdle(row, now, idleThresholdHours)}
        now={now}
        onSelect={selectId}
      />
    );
    return (
      <div role="listbox" aria-label="Sessions" className={cn('pb-2', stale && 'opacity-50')} data-stale={stale}>
        {controllable.length > 0 ? (
          <ul role="group" aria-label="Controllable" className="flex flex-col gap-px px-1.5">
            {controllable.map(item)}
          </ul>
        ) : (
          !filter && props.launches.length === 0 && <Message title="No Sessions Lookout can control" hint={startHint} />
        )}
        {viewOnly.length > 0 && (
          <ul role="group" aria-labelledby="view-only-heading" className="mt-2 flex flex-col gap-px px-1.5">
            <li role="presentation" className="flex items-baseline gap-1.5 px-2 pt-1 pb-1">
              <span
                id="view-only-heading"
                className="text-caption font-medium tracking-wide text-muted-foreground uppercase"
                title="Running in another app (an IDE, Claude Desktop, another terminal app): Lookout shows them but can't type into them."
              >
                View only
              </span>
              <span className="text-caption text-muted-foreground/70 tabular-nums">{viewOnly.length}</span>
            </li>
            {viewOnly.map(item)}
          </ul>
        )}
      </div>
    );
  })();

  function selectId(id: string) {
    onSelect(id, 'push');
  }

  return (
    <aside
      aria-label="Session sidebar"
      className={cn(SHELL_COLUMN, 'w-[280px] border-r border-sidebar-border bg-sidebar text-sidebar-foreground')}
      data-shell-column="left"
      onPointerEnter={() => setFrozenOrder(orderedIds)}
      onPointerLeave={() => setFrozenOrder(null)}
    >
      {/* SIDE-8.1: the Filter bar is this column's header cell. */}
      <ShellCell row="header" className="gap-1.5 border-sidebar-border px-2.5 py-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <Search aria-hidden className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
          <input
            ref={filterRef}
            type="search"
            aria-label="Filter Sessions"
            placeholder="Filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-7 w-full min-w-0 rounded-md border border-input bg-background/60 pr-6 pl-7 text-body outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/20 [&::-webkit-search-cancel-button]:hidden"
          />
          {!filter && (
            <kbd className="pointer-events-none absolute right-1.5 rounded border border-border px-1 font-mono text-caption leading-4 text-muted-foreground">
              /
            </kbd>
          )}
        </label>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New Session"
          title="New Session (N, or ⌘N in the installed app)"
          onClick={props.onNewSession}
          className="size-7 text-muted-foreground"
        >
          <Plus className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Settings"
          aria-pressed={props.settingsOpen}
          onClick={props.onOpenSettings}
          className={cn('size-7 text-muted-foreground', props.settingsOpen && 'bg-sidebar-accent text-foreground')}
        >
          <SettingsIcon className="size-4" />
        </Button>
      </ShellCell>
      <ShellCell row="body" className="flex flex-col">
        {loaded && !connected ? (
          <Banner icon={<WifiOff className="size-3.5" />} text="Lost the Lookout server. Reconnecting…" />
        ) : fleet.state === 'failing' && fleet.lastOkAt !== null ? (
          <Banner
            icon={<TriangleAlert className="size-3.5" />}
            text={`Fleet isn't answering. List is ${formatAge(now - fleet.lastOkAt)} old.`}
            detail={fleet.error}
          />
        ) : null}
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-1.5">
          {launches.length > 0 && (
            // A plain list, not a listbox: a failed row holds a Dismiss button, which an option can't.
            <ul ref={launchesRef} aria-label="Starting Sessions" className="flex flex-col gap-px px-1.5 pb-px">
              {launches.map((l) => (
                <LaunchItem
                  key={l.id}
                  launch={l}
                  now={now}
                  selected={l.id === selectedLaunchId}
                  onSelect={(id) => onSelectLaunch(id, 'push')}
                  onDismiss={dismiss}
                />
              ))}
            </ul>
          )}
          {body}
        </div>
      </ShellCell>
      {/* SIDE-8.1: the usage panel sits in the dock row, so its top line is the composer's. DockRest,
          stacked under it, keeps the row at the resting composer's height in every view. */}
      <ShellCell row="dock" className="grid items-start border-sidebar-border *:col-start-1 *:row-start-1">
        <DockRest />
        <UsageStrip usage={props.usage} now={now} onOpen={props.onUsageOpen} />
      </ShellCell>
    </aside>
  );
}

function Banner({ icon, text, detail }: { icon: ReactNode; text: string; detail?: string }) {
  return (
    <div
      role="status"
      title={detail}
      className="mx-2.5 my-2 flex items-center gap-1.5 rounded-md border border-info-border bg-info-soft px-2 py-1.5 text-meta leading-4 text-info-text"
    >
      {icon}
      <span>{text}</span>
    </div>
  );
}

function Message({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-body font-medium">{title}</p>
      {hint && <p className="mt-1 text-meta leading-5 text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NotInstalled({ command }: { command: string }) {
  return (
    <div className="px-3 py-6" role="alert">
      <p className="text-body font-medium">Fleet isn't installed</p>
      <p className="mt-1 text-meta leading-5 text-muted-foreground">
        Lookout finds Sessions through Fleet. Install it, and the list appears here on its own:
      </p>
      <pre className="mt-2 rounded-md border border-border bg-background p-2 font-mono text-caption leading-4 break-all whitespace-pre-wrap select-all">
        {command}
      </pre>
      <p className="mt-2 text-meta leading-5 text-muted-foreground">
        Needs Rust&apos;s <Code>cargo</Code>, and <Code>tmux</Code> for Sessions Lookout can control.
      </p>
    </div>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 font-mono text-caption">{children}</code>;
}

/** A row keyboard navigation can land on: a "Starting…" row or a Session's. */
type NavRow = { kind: 'launch'; id: string; failed: boolean } | { kind: 'session'; id: string; needsYou: boolean };

/** The frozen order, minus rows that are gone, plus new rows at the end. */
function keepOrder(frozen: readonly string[], current: readonly string[]): string[] {
  const live = new Set(current);
  const kept = frozen.filter((id) => live.has(id));
  const keptSet = new Set(kept);
  return [...kept, ...current.filter((id) => !keptSet.has(id))];
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}
