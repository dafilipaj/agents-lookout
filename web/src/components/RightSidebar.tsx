import type { WorkSnapshot } from '@shared/work.ts';
import { BriefcaseBusiness, History as HistoryIcon, RefreshCw, X } from 'lucide-react';
import { type ComponentType, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { IconButton } from '@/components/ui/icon-button';
import { type PanelNav, RIGHT_TABS, type RightTab, TAB_KEY, TAB_LABEL, clampWidth } from '@/lib/right-sidebar';
import { cn } from '@/lib/utils';
import { refreshState } from '@/lib/work';
import { SHELL_COLUMN, ShellCell } from './Shell';

const TAB_ICON: Record<RightTab, ComponentType<{ className?: string }>> = { history: HistoryIcon, work: BriefcaseBusiness };

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
  now: number;
  /** Each tab's panel. A panel is mounted once first shown and kept, hidden, while another tab is. */
  panels: Record<RightTab, ReactNode>;
  /** Each panel's rows, for ↑/↓ and j/k on the tab strip (WORK-1.7). */
  nav: Record<RightTab, RefObject<PanelNav | null>>;
}

const tabId = (t: RightTab) => `right-tab-${t}`;
const panelId = (t: RightTab) => `right-panel-${t}`;

/** Keys that move through the open panel's rows (HIST-2.7, WORK-1.7), and which way. */
const PANEL_KEYS: Record<string, 1 | -1> = { j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 };

/**
 * HIST-1, WORK-1: the right sidebar, a container with an active tab. The tab strip sits in the
 * shell's header row (SIDE-8.1, WORK-1.8) with Refresh (Work only) and Close; each panel keeps its
 * own controls below it. On the header, j/k and ↑/↓ go to the open panel, never to the Session
 * sidebar, and ←/→ move between the tabs, as a tablist does (WORK-1.7).
 */
export function RightSidebar({ width, onResize, tab, onTab, onClose, refresh, onRefresh, now, panels, nav }: RightSidebarProps) {
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
    // A panel handles its own keys.
    if (!(e.target instanceof Element) || e.target.closest('[role="tabpanel"]')) return;
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
            return (
              <button
                key={t}
                id={tabId(t)}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={panelId(t)}
                tabIndex={active ? 0 : -1}
                title={`${TAB_LABEL[t]} (${TAB_KEY[t]})`}
                onClick={() => onTab(t, true)}
                className={cn(
                  'flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-body transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  active ? 'bg-sidebar-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{TAB_LABEL[t]}</span>
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
      </ShellCell>
    </aside>
  );
}

/** HIST-1.1, WORK-1.1: closed, the right sidebar is a narrow rail with a button per tab; its header cell carries the top line on. */
export function RightRail({ onOpen }: { onOpen(tab: RightTab): void }) {
  const button = (t: RightTab) => {
    const Icon = TAB_ICON[t];
    return (
      <IconButton size="md" label={TAB_LABEL[t]} shortcut={TAB_KEY[t]} onClick={() => onOpen(t)}>
        <Icon />
      </IconButton>
    );
  };
  return (
    <div className={cn(SHELL_COLUMN, 'w-10 border-l border-sidebar-border bg-sidebar')} data-shell-column="right">
      <ShellCell row="header" className="justify-center border-sidebar-border">
        {button('history')}
      </ShellCell>
      <ShellCell row="body" toBottom className="flex flex-col items-center pt-1.5">
        {button('work')}
      </ShellCell>
    </div>
  );
}
