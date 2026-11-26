import type { WorkSnapshot } from '@shared/work.ts';
import { BookOpen, Bot, BriefcaseBusiness, History as HistoryIcon, Layers, Puzzle, RefreshCw, Server, X } from 'lucide-react';
import { type ComponentType, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { IconButton } from '@/components/ui/icon-button';
import { type PanelNav, RIGHT_TABS, type RightTab, TAB_KEY, TAB_LABEL, clampWidth } from '@/lib/right-sidebar';
import { cn } from '@/lib/utils';
import { refreshState } from '@/lib/work';
import { KeysEdge, SHELL_COLUMN, ShellCell } from './Shell';

const TAB_ICON: Record<RightTab, ComponentType<{ className?: string }>> = { history: HistoryIcon, work: BriefcaseBusiness, library: BookOpen, topics: Layers, bots: Bot, servers: Server, setup: Puzzle };

/**
 * BOT-1.6: the narrowest right sidebar whose open tab still shows its name. The strip is given the
 * sidebar's width, so it needs no container query (SIDE-8.3).
 */
export const TAB_NAME_MIN_WIDTH = 352;

/** PORTS-3.1: a tab's title, with the shown Local servers counted on Servers'. */
const tabTitle = (t: RightTab, servers: number | undefined) => (t === 'servers' && servers !== undefined ? `${TAB_LABEL[t]}, ${servers} running` : TAB_LABEL[t]);

export interface RightSidebarProps {
  width: number;
  /** HIST-1.3: the width as it's dragged, and once the drag ends. */
  onResize(width: number): void;
  tab: RightTab;
  /** A tab chosen: clicked (focus moves into its panel) or reached with ←/→ (focus stays on the tab strip). */
  onTab(tab: RightTab, focusPanel: boolean): void;
  onClose(): void;
  /** WORK-8.2: Work's Refresh, shown while Work is the tab. */
  refresh: WorkSnapshot['refresh'] | null;
  /** Resolves with what to say when the server didn't run it, in plain words, or null when it did. */
  onRefresh(): Promise<string | null>;
  /** SETUP-6.4: Setup's Refresh, shown while Setup is the tab: it reads the view that shows again. */
  onSetupRefresh?(): void;
  now: number;
  /** Each tab's panel. A panel is mounted once first shown and kept, hidden, while another tab is. */
  panels: Record<RightTab, ReactNode>;
  /** Each panel's rows, for ↑/↓ and j/k on the tab strip (WORK-1.7). */
  nav: Record<RightTab, RefObject<PanelNav | null>>;
  /** TOPIC-9.4: a neutral count beside a tab's title (Topics' pending recommendations); none at 0. */
  counts?: Partial<Record<RightTab, number>>;
  /** PORTS-3.1: the shown Local servers, counted in the Servers tab's tooltip. */
  servers?: number;
  /** AWAKE-4.2: the keep-awake footer line under the panels, in the bottom-right corner. */
  corner?: ReactNode;
}

/** TOPIC-9.4: a neutral count, never Needs you's amber (UX, Markers). */
function Count({ n, className }: { n: number; className?: string }) {
  return (
    <span data-field="count" className={cn('rounded-full bg-muted px-1.5 text-meta leading-4 font-medium text-muted-foreground tabular-nums', className)}>
      {n}
    </span>
  );
}

const tabId = (t: RightTab) => `right-tab-${t}`;
const panelId = (t: RightTab) => `right-panel-${t}`;

/** Keys that move through the open panel's rows (HIST-2.7, WORK-1.7), and which way. */
const PANEL_KEYS: Record<string, 1 | -1> = { j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 };

/**
 * HIST-1, WORK-1: the right sidebar, a container with an active tab. The tab strip sits in the
 * shell's header row (SIDE-8.1, WORK-1.8) with Refresh (Work and Setup) and Close; each panel keeps its
 * own controls below it. On the header, j/k and ↑/↓ go to the open panel, never to the Session
 * sidebar, and ←/→ move between the tabs, as a tablist does (WORK-1.7).
 */
export function RightSidebar({ width, onResize, tab, onTab, onClose, refresh, onRefresh, onSetupRefresh, now, panels, nav, counts, servers, corner }: RightSidebarProps) {
  // A hidden panel stays mounted, so History keeps its query while you look at Work.
  const [shown, setShown] = useState<ReadonlySet<RightTab>>(() => new Set([tab]));
  if (!shown.has(tab)) setShown(new Set(shown).add(tab));
  const [refreshing, setRefreshing] = useState(false);
  /** A Refresh the server refused or couldn't run, said until the next press (WORK UX, Errors). */
  const [refreshProblem, setRefreshProblem] = useState<string | null>(null);
  const r = refreshState(refresh, now);

  // ←/→ keep focus on the tab strip; a panel shown for the first time focuses itself as it mounts,
  // and this runs after it (a parent's effects follow its children's), so the tab gets it back.
  const keepTabFocus = useRef<RightTab | null>(null);
  useEffect(() => {
    if (keepTabFocus.current === tab) document.getElementById(tabId(tab))?.focus();
    keepTabFocus.current = null;
  }, [tab]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    // A panel handles its own keys; a dialog a row opened (portaled, so outside the sidebar) its own too,
    // though they reach here through React's tree: Esc there cancels it, never collapses the row.
    if (!(e.target instanceof Element) || e.target.closest('[role="tabpanel"]') || !e.currentTarget.contains(e.target)) return;
    if (e.target.getAttribute('role') === 'tab' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const next = RIGHT_TABS[(RIGHT_TABS.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1) + RIGHT_TABS.length) % RIGHT_TABS.length]!;
      keepTabFocus.current = next;
      onTab(next, false);
      document.getElementById(tabId(next))?.focus();
    } else if (Object.hasOwn(PANEL_KEYS, e.key)) {
      // The open panel moves its rows; held back from the Session sidebar.
      e.preventDefault();
      nav[tab].current?.move(PANEL_KEYS[e.key]!);
    } else if (e.key === 'Escape' && nav[tab].current?.collapse?.()) {
      // WORK-1.12: Esc collapses Work's expanded row, from the tab strip too.
      e.preventDefault();
    }
  };

  // HIST-1.3: drag the left edge to resize.
  const startResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    let latest = width;
    const onMove = (m: MouseEvent) => {
      latest = clampWidth(width + (startX - m.clientX));
      onResize(latest);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      onResize(latest);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const refreshNow = () => {
    if (refreshing || r.disabled) return;
    setRefreshing(true);
    setRefreshProblem(null);
    onRefresh()
      .then(setRefreshProblem)
      .finally(() => setRefreshing(false));
  };

  return (
    <aside
      aria-label="Right sidebar"
      // SIDE-8.3: never `@container` here: containment turns the column's subgrid off, and the header cell grows off the header line.
      className={cn(SHELL_COLUMN, 'relative border-l border-sidebar-border bg-sidebar text-sidebar-foreground')}
      style={{ width }}
      data-shell-column="right"
      data-testid="right-sidebar"
      onKeyDown={onKeyDown}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the right sidebar"
        aria-valuenow={width}
        onMouseDown={startResize}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-ring/20"
      />
      {/* WORK-1.8: the tab strip is this column's header cell, where History's search field was. */}
      <ShellCell row="header" className="gap-1 border-sidebar-border px-2 py-2">
        <div role="tablist" aria-label="Right sidebar" className="flex min-w-0 items-center gap-0.5">
          {RIGHT_TABS.map((t) => {
            const Icon = TAB_ICON[t];
            const active = t === tab;
            // PORTS-3.1: the tabs' names don't all fit, so only the open one shows its name. BOT-1.6: under
            // 352 px seven tabs leave that name no room either, and it shows its icon alone, as the others do.
            const iconOnly = !active || width < TAB_NAME_MIN_WIDTH;
            return (
              <button
                key={t}
                id={tabId(t)}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={panelId(t)}
                tabIndex={active ? 0 : -1}
                title={`${tabTitle(t, servers)} (${TAB_KEY[t]})`}
                onClick={() => onTab(t, true)}
                className={cn(
                  'relative flex h-7 min-w-0 items-center gap-1.5 rounded-md text-body transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  active ? 'bg-sidebar-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
                  // BOT-1.6: seven tabs fit the strip because a tab that shows only its icon is a 28 px square.
                  iconOnly ? 'w-7 shrink-0 justify-center' : 'px-2',
                )}
              >
                <Icon className="size-4 shrink-0" />
                {/* A tab that shows its icon alone keeps its name for screen readers, and in its tooltip. */}
                <span className={cn('truncate', iconOnly && 'sr-only')} data-slot="tab-name">{TAB_LABEL[t]}</span>
                {/* An icon-only tab wears its count on the icon's corner, as the rail's buttons do, so it reads as that tab's. */}
                {!!counts?.[t] && <Count n={counts[t]!} className={cn(iconOnly && 'absolute -top-1 -right-0.5 px-1')} />}
              </button>
            );
          })}
        </div>
        {/* DS-7.4: Close keeps 8 px from Refresh, so the two are hard to mix up. */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {tab === 'work' && (
            // WORK-8.2, WORK-8.4: disabled while the server would refuse it, saying why and when it's back.
            <IconButton
              size="md"
              label="Refresh"
              tip={refreshing ? 'Refreshing…' : r.title}
              aria-disabled={r.disabled || refreshing || undefined}
              onClick={refreshNow}
              className={cn((r.disabled || refreshing) && 'cursor-default opacity-50 hover:bg-transparent')}
            >
              <RefreshCw className={cn(refreshing && 'motion-safe:animate-spin')} />
            </IconButton>
          )}
          {tab === 'setup' && onSetupRefresh && (
            // SETUP-6.4: read again now; Setup reads its files, so there's no limit to wait out.
            <IconButton size="md" label="Refresh" tip="Refresh" onClick={onSetupRefresh}>
              <RefreshCw />
            </IconButton>
          )}
          <IconButton size="md" label={`Close ${TAB_LABEL[tab]}`} shortcut={TAB_KEY[tab]} onClick={onClose}>
            <X />
          </IconButton>
        </div>
      </ShellCell>
      {/* The panels run on past the dock line, to the bottom. */}
      <ShellCell row="body" toBottom className="flex flex-col">
        {RIGHT_TABS.filter((t) => shown.has(t)).map((t) => (
          <div
            key={t}
            id={panelId(t)}
            role="tabpanel"
            aria-labelledby={tabId(t)}
            hidden={t !== tab}
            className={cn('min-h-0 flex-1 flex-col', t === tab ? 'flex' : 'hidden')}
          >
            {t === 'work' && refreshProblem && <Alert title={refreshProblem} className="mx-2.5 mt-2" data-field="refresh-problem" />}
            {panels[t]}
          </div>
        ))}
        {/* AWAKE-4.2: the corner's footer line, under the panels, level with the Memory line. */}
        {corner}
      </ShellCell>
      <KeysEdge column="right" />
    </aside>
  );
}

/** HIST-1.1, WORK-1.1: closed, the right sidebar is a narrow rail with a button per tab; its header cell carries the top line on. */
export function RightRail({ onOpen, counts, servers, corner }: { onOpen(tab: RightTab): void; counts?: Partial<Record<RightTab, number>>; servers?: number; corner?: ReactNode }) {
  const button = (t: RightTab) => {
    const Icon = TAB_ICON[t];
    const n = counts?.[t] ?? 0;
    return (
      <IconButton size="md" label={n ? `${TAB_LABEL[t]}, ${n} recommended` : tabTitle(t, servers)} shortcut={TAB_KEY[t]} onClick={() => onOpen(t)} className="relative">
        <Icon />
        {n > 0 && <Count n={n} className="absolute -top-1 -right-1 px-1" />}
      </IconButton>
    );
  };
  return (
    <div className={cn(SHELL_COLUMN, 'relative w-10 border-l border-sidebar-border bg-sidebar')} data-shell-column="right">
      <ShellCell row="header" className="justify-center border-sidebar-border">
        {button('history')}
      </ShellCell>
      <ShellCell row="body" toBottom className="flex flex-col items-center pt-1.5">
        {button('work')}
        {button('library')}
        {button('topics')}
        {button('bots')}
        {button('servers')}
        {button('setup')}
        {/* AWAKE-4.1: the rail ends in the corner's line, level with the Memory line. */}
        {corner}
      </ShellCell>
      <KeysEdge column="right" />
    </div>
  );
}
