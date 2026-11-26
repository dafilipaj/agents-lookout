import { type BotRun, type BotsSnapshot, holdsWords, reportsOf } from '@shared/bots.ts';
import { Bot, Search } from 'lucide-react';
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Kbd } from '@/components/ui/kbd';
import { Loading } from '@/components/ui/loading';
import { Segmented, type SegmentedChoice } from '@/components/ui/segmented';
import { matchesReport, reportAge, reportIcon, reportName, reportTitle } from '@/lib/inbox';
import { byDay } from '@/lib/time';
import { cn } from '@/lib/utils';
import { ShellCell } from './Shell';

/** INBOX-1.4: the two ways the Inbox's list shows. */
export type InboxChoice = 'inbox' | 'archived';

export interface InboxListProps {
  /** The Bots and their runs; null before the server's first answer. */
  bots: BotsSnapshot | null;
  /** The server has answered once (INBOX-1.5's "Connecting…" until then). */
  loaded: boolean;
  /** The open Report's run; null for none. */
  selectedId: string | null;
  now: number;
  /** `replace`: a keyboard step, which shouldn't flood the history. */
  onSelect(id: string, how: 'push' | 'replace'): void;
  /** INBOX-1.4: Inbox or Archived, kept by App for this page load. */
  view: InboxChoice;
  onView(view: InboxChoice): void;
  /** INBOX-1.5: the empty state's action: opens the Bots tab. */
  onOpenBots(): void;
  /** False while a dialog owns the keyboard. */
  keyboardEnabled: boolean;
  /** INBOX-4.1: told the rows as they show, filter and all, so archiving selects a neighbour that is on screen. */
  onShown?(ids: readonly string[]): void;
}

const CHOICES: readonly SegmentedChoice<InboxChoice>[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'archived', label: 'Archived' },
];

/** A Report's row as a listbox option, for `aria-activedescendant`. */
const optionId = (runId: string) => `inbox-report-${runId}`;

/** NAV-2.2: the Inbox's list, as the left column's header and body cells. */
export function InboxList({ bots, loaded, selectedId, now, onSelect, view, onView, onOpenBots, keyboardEnabled, onShown }: InboxListProps) {
  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const query = filter.trim();
  // INBOX-1.1: the Reports of the view that shows, newest arrival first.
  const all = useMemo(() => reportsOf(bots?.runs ?? [], view === 'archived'), [bots, view]);
  // INBOX-1.3: every word typed is in the title or the Bot's name.
  const rows = useMemo(() => all.filter((run) => matchesReport(run, query)), [all, query]);

  // INBOX-5.1: the list's keys are the window's, as the Session sidebar's are (SIDE-5), while the Inbox is the place.
  const latest = useRef({ rows, selectedId, onSelect, enabled: keyboardEnabled });
  useEffect(() => {
    latest.current = { rows, selectedId, onSelect, enabled: keyboardEnabled };
  });
  useEffect(() => onShown?.(rows.map((r) => r.id)), [rows, onShown]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { rows, selectedId, onSelect, enabled } = latest.current;
      if (e.isComposing || e.defaultPrevented || !enabled) return;
      // The right sidebar's panels have these keys for their own lists, and an open menu its own.
      if (e.target instanceof Element && e.target.closest('[data-shell-column="right"], [role="menu"]')) return;
      const inFilter = e.target === filterRef.current;
      const editing = !inFilter && isEditable(e.target);
      const index = rows.findIndex((r) => r.id === selectedId);
      const step = (delta: 1 | -1) => {
        if (!rows.length) return;
        const next = index === -1 ? (delta === 1 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, index + delta));
        onSelect(rows[next]!.id, 'replace');
      };

      if (e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey) {
        // ⌘1–⌘9: the first to ninth row.
        if (!/^[1-9]$/.test(e.key)) return;
        e.preventDefault();
        const row = rows[Number(e.key) - 1];
        if (row) onSelect(row.id, 'push');
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || editing) return;
      // ↑/↓ from inside a Markdown Report scroll it instead (SIDE-5.1).
      const inReport = e.target instanceof Element && !!e.target.closest('[data-scroll-keys]');

      if (inFilter) {
        // INBOX-1.3: Esc clears the filter and leaves it.
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
      } else if ((e.key === 'ArrowDown' && !inReport) || e.key === 'j') {
        e.preventDefault();
        step(1);
      } else if ((e.key === 'ArrowUp' && !inReport) || e.key === 'k') {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'Escape' && filter) {
        setFilter('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filter]);

  const body = (() => {
    // INBOX-1.5: before the server's first answer, as the Session sidebar's (DS-6.6).
    if (!loaded) return <Loading label="Connecting…" className="items-center px-4 py-8 text-center" />;
    // BOT-2.3: a store that can't be read holds no Report to list; say so, never "Nothing has arrived".
    if (bots?.state === 'unreadable') return <Alert title="Reports can't be read" detail={`${bots.error ?? ''} ${bots.path}`.trim()} className="mx-2.5 my-3" data-field="inbox-error" />;
    // INBOX-1.5: with nothing to list the column says why.
    if (rows.length === 0) {
      if (all.length > 0) return <EmptyState role="status" title="Nothing matches" hint="Esc clears the filter." />;
      if (view === 'archived') return <EmptyState role="status" title="Nothing archived" />;
      return (
        <EmptyState
          role="status"
          title="Nothing has arrived"
          hint="A Bot's Report arrives here when its run ends."
          action={
            <Button variant="secondary" size="default" onClick={onOpenBots} data-action="bots">
              <Bot aria-hidden />
              Bots
            </Button>
          }
        />
      );
    }
    // DS-9.1: the list takes focus as the Session list does: the open Report is its active option,
    // none while the filter or the other view hides it. Its keys are the window's, above.
    const active = selectedId !== null && rows.some((r) => r.id === selectedId) ? optionId(selectedId) : undefined;
    return (
      <div
        role="listbox"
        aria-label="Reports"
        tabIndex={0}
        aria-activedescendant={active}
        className="rounded-md px-2 pb-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        {/* INBOX-1.1: each day a group of the listbox, named by its heading (DS-17). */}
        {byDay(rows, (run) => run.arrivedAt, now).map((day, d) => (
          <div key={day.key} role="group" aria-labelledby={`inbox-day-${d}`} className="flex flex-col">
            <div role="presentation" className="px-2 py-1.5 text-caption font-medium text-muted-foreground">
              <span id={`inbox-day-${d}`}>{day.label}</span>
            </div>
            {day.rows.map(({ item }) => (
              <ReportRow key={item.id} run={item} now={now} selected={item.id === selectedId} onSelect={onSelect} />
            ))}
          </div>
        ))}
      </div>
    );
  })();

  return (
    <>
      {/* INBOX-1.3: the filter is this column's header cell, as the Session sidebar's is (SIDE-8.1). */}
      <ShellCell row="header" className="gap-1.5 border-sidebar-border px-2.5 py-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <Search aria-hidden className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
          <input
            ref={filterRef}
            type="search"
            aria-label="Filter Reports"
            placeholder="Filter Reports"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-7 w-full min-w-0 rounded-md border border-input bg-background/60 pr-6 pl-7 text-body outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/20 [&::-webkit-search-cancel-button]:hidden"
          />
          {!filter && <Kbd className="pointer-events-none absolute right-1.5 text-muted-foreground">/</Kbd>}
        </label>
      </ShellCell>
      <ShellCell row="body" className="flex flex-col" data-testid="inbox-list">
        {/* INBOX-1.4: Inbox or Archived, under the header, where Work has its Show filter. */}
        <div className="px-2.5 pt-2 pb-2">
          <Segmented label="Reports" choices={CHOICES} value={view} onChange={onView} surface="sidebar" fill />
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">{body}</div>
      </ShellCell>
    </>
  );
}

/**
 * INBOX-1.2: one Report's row, built as a Library row is (GUIDE, "A list row"): its 16 px icon and
 * title, then its Bot's name, what it holds and its age. INBOX-3.2: unread, it has SIDE-13.2's mark.
 */
function ReportRow({ run, now, selected, onSelect }: { run: BotRun; now: number; selected: boolean; onSelect(id: string, how: 'push' | 'replace'): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  const title = reportTitle(run);
  const unread = !run.read;
  return (
    <div
      ref={ref}
      id={optionId(run.id)}
      role="option"
      aria-selected={selected}
      aria-label={reportName(run, now)}
      onClick={() => onSelect(run.id, 'push')}
      data-slot="row"
      data-selected={selected || undefined}
      data-report-id={run.id}
      data-unread={unread || undefined}
      className={cn('flex min-w-0 cursor-default flex-col gap-0.5 rounded-md px-2 py-[7px] text-body select-none hover:bg-sidebar-accent/60', selected && 'bg-sidebar-accent')}
    >
      <div className="flex min-w-0 items-center gap-1">
        {/* LIB-2.2's place: 16 px in the text colour; 16 + 4 px keeps the line below at pl-5. */}
        <span className="flex h-5 shrink-0 items-center">{createElement(reportIcon(run), { 'aria-hidden': true, className: cn('size-4', run.state === 'failed' ? 'text-destructive' : 'text-foreground') })}</span>
        <span className={cn('min-w-0 truncate', unread ? 'font-semibold' : 'font-medium')} title={title} data-field="title">
          {title}
        </span>
        {/* INBOX-3.2: a 6 px dot in the title's colour after the title; never Primary (DS-12.4). */}
        {unread && (
          <span className="ml-0.5 flex shrink-0 items-center" data-field="unread">
            <span aria-hidden data-slot="unread-dot" className="size-1.5 rounded-full bg-sidebar-foreground" />
          </span>
        )}
      </div>
      <p className="flex min-w-0 items-center gap-1 pl-5 text-meta whitespace-nowrap text-muted-foreground">
        <span className="min-w-0 truncate" data-field="bot">
          {run.botName}
        </span>
        <span aria-hidden>·</span>
        <Holds run={run} />
        <span className="ml-auto shrink-0 pl-1 tabular-nums" data-field="age">
          {reportAge(run, now)}
        </span>
      </p>
    </div>
  );
}

/** INBOX-1.2: what a Report holds: quiet when routine; "waiting on you" in Needs you's amber (DS-3.5). */
function Holds({ run }: { run: BotRun }) {
  const words = holdsWords(run);
  // A failed run's exception is its row's icon, the triangle in the destructive colour, with its word here.
  return (
    <span className={cn('shrink-0', run.state === 'waiting' && 'font-medium text-needs-you-text')} data-field="holds">
      {words}
    </span>
  );
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}
