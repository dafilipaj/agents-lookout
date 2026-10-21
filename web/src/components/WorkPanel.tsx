import type { ColumnMark, PrSection, TaskSection, WorkPr, WorkSessionLink, WorkSnapshot, WorkTask } from '@shared/work.ts';
import { Circle, CircleCheck, CircleDashed, CircleDot, CircleX, ExternalLink, LoaderCircle, Milestone, Play, TriangleAlert } from 'lucide-react';
import { type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref, type RefObject, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { type PanelNav, WORK_FILTERS, WORK_FILTER_LABEL, type WorkFilter } from '@/lib/right-sidebar';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import {
  AGE_LEVEL_CLASS,
  PR_GROUPS,
  PR_GROUP_LABEL,
  type PrGroup,
  type WorkRow,
  ageLevel,
  backIn,
  describeMark,
  formatDue,
  hasPrLists,
  hasTaskList,
  keepSelection,
  prKey,
  rowUrl,
  sessionToOpen,
  showsPrs,
  showsTasks,
  taskKey,
  visibleRows,
} from '@/lib/work';

export interface WorkPanelProps {
  work: WorkSnapshot | null;
  /** WORK-1.5: which sections show; remembered by the caller. */
  filter: WorkFilter;
  onFilter(filter: WorkFilter): void;
  now: number;
  /** Bumped to move focus into Work (opening it with `W` or its tab). */
  focusKey: number;
  /** WORK-5.1: "Start Session" on a Task. */
  onStart(task: WorkTask): void;
  /** WORK-5.2: "Review" on a Review request. */
  onReview(pr: WorkPr): void;
  /** WORK-2.4, WORK-3.4: open the selected Linked Session. */
  onOpenSession(session: WorkSessionLink): Promise<void>;
  /** WORK-2.6: the link to Settings, while no Productive email is saved. */
  onOpenSettings(): void;
  /** False while a modal is open: Work's keys stand down (WORK-6.4). */
  keyboardEnabled: boolean;
  /** WORK-1.7: how the tab strip moves Work's rows. */
  navRef?: Ref<PanelNav>;
}

const DAY_MS = 86_400_000;

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

const rowId = (key: string) => `work-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`;

type ListRef = RefObject<HTMLDivElement | null>;

/** The listbox that holds the selected row, if any. */
const selectedList = (root: HTMLElement | null) => root?.querySelector('[role="option"][aria-selected="true"]')?.closest<HTMLElement>('[role="listbox"]') ?? null;

/**
 * Each section's listbox comes and goes with its rows, and focus follows it (WORK-1.7): once one
 * shows, focus moves from the panel, where opening Work, or a click on a heading, put it, to the list
 * that holds the selected row, else to the new list, so a list showing up never moves the selection;
 * when one goes while focused, the other list takes it, or the panel, so focus never drops to the
 * page, where j/k move the Session sidebar. React detaches a ref before it removes the listbox.
 */
function followList(el: HTMLDivElement | null, own: ListRef, other: ListRef, root: ListRef) {
  if (el) {
    own.current = el;
    if (document.activeElement === root.current) (selectedList(root.current) ?? el).focus();
    return;
  }
  const was = own.current;
  own.current = null;
  if (was && document.activeElement === was) (other.current ?? root.current)?.focus();
}

/** WORK-6.2, WORK-6.3: a Task in Fantastic or a PR on GitHub, in a new browser tab, with no way back to Lookout. */
function openInBrowser(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * WORK: the Work tab of the right sidebar. Its filter, then its sections: Tasks (WORK-2), then PRs,
 * with Mine and Review requests (WORK-3).
 *
 * As in History, each section's rows are the options of one focusable listbox (a `group` per PR
 * group), and an option holds nothing focusable: its buttons are mouse targets, and the keyboard acts
 * on the selected row with Enter, `O`, `R` and `S` (WORK UX, "Markers and buttons"). ↑/↓ and j/k run
 * through both sections' rows, and focus follows the selection into the list that holds it, the only
 * list in the Tab order (UX, Focus).
 */
export function WorkPanel({ work, filter, onFilter, now, focusKey, onStart, onReview, onOpenSession, onOpenSettings, keyboardEnabled, navRef }: WorkPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tasksList = useRef<HTMLDivElement | null>(null);
  const prsList = useRef<HTMLDivElement | null>(null);

  // WORK-1.9: the selection follows its item while it's visible, else the first visible row.
  const rows = visibleRows(work, filter);
  const [selected, setSelected] = useState<string | null>(null);
  const [sessionOpenError, setSessionOpenError] = useState<string | null>(null);
  const current = keepSelection(selected, rows);
  if (current !== selected) setSelected(current);
  // Which list holds the selected row: the only one in the Tab order (UX, Focus).
  const holding = rows.find((r) => r.key === current)?.kind ?? null;

  // Opening Work focuses the list that holds the selected row, else the first list, else Work itself.
  useEffect(() => {
    const root = rootRef.current;
    (selectedList(root) ?? root?.querySelector<HTMLElement>('[role="listbox"]') ?? root)?.focus();
  }, [focusKey]);
  const attachTasks = useCallback((el: HTMLDivElement | null) => followList(el, tasksList, prsList, rootRef), []);
  const attachPrs = useCallback((el: HTMLDivElement | null) => followList(el, prsList, tasksList, rootRef), []);
  const isList = (t: EventTarget | null) => t !== null && (t === tasksList.current || t === prsList.current);

  // From a list, focus follows the selection into the other list, whether a key or a read (WORK-1.9)
  // moved it there, so the list in focus always shows its selected row. Focus elsewhere, such as on
  // the tab strip, stays where it is.
  useEffect(() => {
    const holder = holding === 'task' ? tasksList.current : holding === 'pr' ? prsList.current : null;
    const focused = document.activeElement;
    if (holder && focused !== holder && (focused === tasksList.current || focused === prsList.current)) holder.focus();
  }, [current, holding]);

  // The last press in a list: the list, and the option it's on, so the focus it brings selects that row rather than the first.
  const pressed = useRef<{ list: EventTarget; option: string | null } | null>(null);
  const onListPress = (e: MouseEvent<HTMLDivElement>) => {
    pressed.current = { list: e.currentTarget, option: e.target instanceof Element ? (e.target.closest('[role="option"]')?.id ?? null) : null };
  };
  /**
   * Focus that a press brings to the list without the selection selects a row of its own: the one
   * pressed, or its first for a press elsewhere in it, such as a group's heading (UX, Focus). Focus
   * that reaches it any other way moves no selection: it goes on to the list that holds it, so the
   * list in focus always shows its selected row. It doesn't scroll, so the press's click still lands
   * on what it was pressed on.
   */
  const onListFocus = (kind: WorkRow['kind']) => (e: FocusEvent<HTMLDivElement>) => {
    const press = pressed.current;
    pressed.current = null;
    if (e.target !== e.currentTarget || holding === null || holding === kind) return;
    if (press?.list !== e.currentTarget) {
      (holding === 'task' ? tasksList.current : prsList.current)?.focus();
      return;
    }
    const own = rows.filter((r) => r.kind === kind);
    const row = own.find((r) => rowId(r.key) === press.option) ?? own[0];
    if (row) setSelected(row.key);
  };

  const select = (key: string) => {
    setSelected(key);
    document.getElementById(rowId(key))?.scrollIntoView?.({ block: 'nearest' });
  };
  /** ↑/↓ and j/k: the next or previous visible row, without acting (WORK-1.7). */
  const move = (delta: number) => {
    if (!rows.length) return;
    const index = rows.findIndex((r) => r.key === current);
    select(rows[Math.min(rows.length - 1, Math.max(0, index + delta))]!.key);
  };
  // The tab strip moves the rows through this, not through a key event of its own (WORK-1.7).
  useImperativeHandle(navRef, () => ({ move }));
  // A row acts on its newest live Linked Session, or newest past one if none is live (WORK-2.4, WORK-3.4).
  const activate = (row: WorkRow) => {
    if (work?.sessionLinks.state !== 'ok') return;
    const linked = row.kind === 'task' ? row.task.links?.sessions : row.pr.links?.sessions;
    const session = linked?.length ? sessionToOpen(linked) : null;
    if (session) {
      setSessionOpenError(null);
      void onOpenSession(session).catch((err: unknown) => setSessionOpenError(err instanceof Error ? err.message : "Couldn't open the linked Session."));
    }
  };
  const review = (row: WorkRow) => {
    if (row.kind === 'pr' && row.group === 'reviewRequests') onReview(row.pr);
  };
  const start = (row: WorkRow) => {
    if (row.kind === 'task') onStart(row.task);
  };
  const open = (row: WorkRow) => {
    select(row.key);
    openInBrowser(rowUrl(row));
  };

  // WORK-1.7: ↑/↓ and j/k move through the visible rows without acting; Enter acts like a click, from
  // a list only. WORK-6.4: O opens the selected row as its button does, without moving anything;
  // WORK-5.2: R reviews it; WORK-5.1: S starts a Session on it. O, R and S count with Caps Lock on,
  // never with Shift, and once per press: a held key's repeats open no more tabs or launchers.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!keyboardEnabled || e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey || isTextField(e.target)) return;
    const row = rows.find((r) => r.key === current);
    const letter = e.shiftKey ? null : e.key.toLowerCase();
    if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault(); // the Session sidebar's own ↑/↓ and j/k stay put
      move(e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1);
    } else if (e.key === 'Enter' && isList(e.target) && row) {
      e.preventDefault();
      activate(row);
    } else if (letter === 'o' && row) {
      e.preventDefault();
      if (!e.repeat) openInBrowser(rowUrl(row));
    } else if (letter === 'r' && row?.kind === 'pr' && row.group === 'reviewRequests') {
      e.preventDefault();
      if (!e.repeat) review(row);
    } else if (letter === 's' && row?.kind === 'task') {
      e.preventDefault();
      if (!e.repeat) start(row);
    }
  };
  const onRow = (row: WorkRow) => {
    select(row.key);
    activate(row);
  };

  const tasks = work?.tasks ?? null;
  const prs = work?.prs ?? null;
  return (
    // Named, as it holds focus while there's no list to focus (WORK-1.7).
    <div ref={rootRef} role="group" aria-label="Work" tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none" onKeyDown={onKeyDown} data-testid="work-panel">
      {/* WORK-1.5: what Work shows, below the tab strip where History has its search field (WORK-1.8). */}
      <div className="px-2.5 pt-2 pb-2">
        <div role="group" aria-label="Show" className="flex rounded-md border border-input bg-background/60 p-0.5 dark:bg-input/20">
          {WORK_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => onFilter(f)}
              className={cn(
                'min-w-0 flex-auto truncate rounded px-1.5 py-0.5 text-[12px] whitespace-nowrap transition-colors',
                filter === f ? 'bg-sidebar-accent font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {WORK_FILTER_LABEL[f]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto pb-2">
        {sessionOpenError && <p role="alert" className="mx-2 rounded-md border border-destructive/30 px-2 py-1.5 text-[12px] text-destructive">{sessionOpenError}</p>}
        {showsTasks(filter) && tasks && (
          <TasksSection
            tasks={tasks}
            sessionsAvailable={work?.sessionLinks.state === 'ok'}
            now={now}
            selected={current}
            listRef={attachTasks}
            onListFocus={onListFocus('task')}
            onListPress={onListPress}
            onRow={onRow}
            onOpen={open}
            onStart={(row) => {
              select(row.key);
              start(row);
            }}
            onOpenSettings={onOpenSettings}
          />
        )}
        {showsPrs(filter) && prs && (
          <PrsSection
            prs={prs}
            sessionsAvailable={work?.sessionLinks.state === 'ok'}
            blockedUntil={work?.refresh.githubBlockedUntil ?? null}
            now={now}
            selected={current}
            listRef={attachPrs}
            onListFocus={onListFocus('pr')}
            onListPress={onListPress}
            onRow={onRow}
            onOpen={open}
            onReview={(row) => {
              select(row.key);
              review(row);
            }}
          />
        )}
        {work && work.sessionLinks.state !== 'ok' && work.sessionLinks.state !== 'loading' && (
          <p role="status" className="mx-2 mb-1 rounded-md border border-needs-you/30 px-2 py-1.5 text-[12px] text-muted-foreground" data-field="session-link-problem">
            <span className="font-medium text-foreground">Session links are unavailable.</span>{' '}
            {work.sessionLinks.reason}{work.sessionLinks.fix ? ` ${work.sessionLinks.fix}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}

interface SectionHeaderProps {
  id: string;
  title: string;
  /** The rows listed, or null while there's no list to count. */
  count: number | null;
  fetchedAt: number | null;
  now: number;
  loading: boolean;
  stale: boolean;
}

/** WORK-1.3: a section's name, its count and how old its data is; "old" over a list kept from an earlier read (WORK-7.3). */
function SectionHeader({ id, title, count, fetchedAt, now, loading, stale }: SectionHeaderProps) {
  const updated = fetchedAt === null ? null : `updated ${formatAge(now - fetchedAt)} ago`;
  return (
    <header className="flex min-w-0 items-center gap-1 px-3 pt-1 pb-1 text-[12px] text-muted-foreground">
      <h3 id={id} className="font-semibold text-foreground">
        {title}
      </h3>
      {count !== null && (
        <>
          <span aria-hidden>·</span>
          <span data-field="count">
            {count}
            <span className="sr-only"> open</span>
          </span>
        </>
      )}
      {updated && (
        <>
          <span aria-hidden>·</span>
          <span data-field="updated" className="truncate">
            {updated}
          </span>
        </>
      )}
      {loading && <span className="truncate">· Loading…</span>}
      {stale && (
        <span data-field="old" className="ml-auto shrink-0 rounded-full bg-needs-you-soft px-1.5 text-[11px] font-medium text-needs-you-text" title="From an earlier read: the last one failed">
          old
        </span>
      )}
    </header>
  );
}

interface ProblemProps {
  title: string;
  /** Why the read failed, in plain words; null when the title says it all. */
  reason: string | null;
  /** What to do before the command, when there's one to run. */
  how: string | null;
  fix: string | null;
  stale: boolean;
  fetchedAt: number | null;
  now: number;
}

/**
 * WORK-7.1 to 7.3, UX "Errors": what's wrong and what to do, in plain words; a list kept from
 * before is marked old. Signed out is said once: the title, then the command.
 */
function Problem({ title, reason, how, fix, stale, fetchedAt, now }: ProblemProps) {
  return (
    <div role="alert" className="mx-2 mb-1.5 rounded-md border border-destructive/30 px-2 py-1.5 text-[12px]" data-field="problem">
      <p className="font-medium text-destructive">{title}</p>
      {reason && (
        <p className="mt-0.5 text-muted-foreground" data-field="reason">
          {reason}
        </p>
      )}
      {how && <p className="mt-1 text-muted-foreground">{how}</p>}
      {fix && <pre className="mt-1 rounded-md border border-border bg-background p-1.5 font-mono text-[11px] leading-4 whitespace-pre-wrap select-all [overflow-wrap:anywhere]">{fix}</pre>}
      {stale && (
        <p className="mt-1 text-muted-foreground">
          Showing the last list{fetchedAt === null ? '' : `, from ${formatAge(now - fetchedAt)} ago`}.
        </p>
      )}
    </div>
  );
}

interface TasksSectionProps {
  tasks: TaskSection;
  sessionsAvailable: boolean;
  now: number;
  selected: string | null;
  listRef: Ref<HTMLDivElement>;
  onListFocus(e: FocusEvent<HTMLDivElement>): void;
  onListPress(e: MouseEvent<HTMLDivElement>): void;
  onRow(row: WorkRow): void;
  onOpen(row: WorkRow): void;
  onStart(row: WorkRow): void;
  onOpenSettings(): void;
}

/** WORK-2: Tasks, with its count and age (WORK-1.3), the email it needs (WORK-2.6), its problems (WORK-7) and its rows in one listbox. */
function TasksSection({ tasks, sessionsAvailable, now: clock, selected, listRef, onListFocus, onListPress, onRow, onOpen, onStart, onOpenSettings }: TasksSectionProps) {
  // The page's clock ticks once a second, so it can be just behind the data it shows: never show ages from before the read.
  const now = Math.max(clock, tasks.fetchedAt ?? clock);
  const list = hasTaskList(tasks);
  const active = selected !== null && tasks.tasks.some((t) => taskKey(t) === selected) ? selected : null;
  const failed = tasks.state === 'not-installed' || tasks.state === 'signed-out' || tasks.state === 'error';
  return (
    <section aria-labelledby="work-tasks-heading" data-section="tasks" className="flex flex-col">
      <SectionHeader id="work-tasks-heading" title="Tasks" count={list ? tasks.tasks.length : null} fetchedAt={tasks.fetchedAt} now={now} loading={tasks.state === 'loading'} stale={tasks.stale} />
      {/* WORK-2.6: no email, no read; Settings opens in the main pane, Work staying open. */}
      {tasks.state === 'no-email' && (
        <p className="px-3 py-2 text-[12px] text-muted-foreground" data-field="no-email">
          Set your Productive email in{' '}
          <a
            href="/settings"
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              onOpenSettings();
            }}
            className="font-medium text-foreground underline underline-offset-2 hover:text-foreground/80"
          >
            Settings
          </a>
        </p>
      )}
      {failed && (
        <Problem
          title={tasks.state === 'not-installed' ? "tb-prod isn't installed" : tasks.state === 'signed-out' ? "tb-prod isn't signed in to Productive" : tasks.stale ? "Couldn't update Tasks" : "Couldn't read Tasks"}
          reason={tasks.state === 'error' ? tasks.reason : null}
          how={
            tasks.state === 'not-installed'
              ? "Work reads your Tasks through tb-prod. Build it from cli-toolbox's main, then press Refresh:"
              : tasks.state === 'signed-out'
                ? 'Run this, then press Refresh:'
                : null
          }
          fix={tasks.fix}
          stale={tasks.stale}
          fetchedAt={tasks.fetchedAt}
          now={now}
        />
      )}
      {list && tasks.tasks.length === 0 && <p className="px-3 py-3 text-[12px] text-muted-foreground">No open tasks</p>}
      {list && tasks.tasks.length > 0 && (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Tasks"
          aria-activedescendant={active ? rowId(active) : undefined}
          tabIndex={active ? 0 : -1}
          onFocus={onListFocus}
          onMouseDown={onListPress}
          className="flex flex-col gap-px px-1.5 outline-none"
        >
          {tasks.tasks.map((task) => {
            const row: WorkRow = { key: taskKey(task), kind: 'task', task };
            return <TaskRow key={row.key} task={task} rowKey={row.key} now={now} active={row.key === active} sessionsAvailable={sessionsAvailable} onClick={() => onRow(row)} onOpen={() => onOpen(row)} onStart={() => onStart(row)} />;
          })}
        </div>
      )}
    </section>
  );
}

interface TaskRowProps {
  task: WorkTask;
  rowKey: string;
  now: number;
  active: boolean;
  sessionsAvailable: boolean;
  onClick(): void;
  onOpen(): void;
  onStart(): void;
}

/**
 * WORK-2.2: the title; the project and status; a milestone's chip and the due date, when it has
 * either. A screen reader hears them all as the option's name. Start Session and Open in browser are
 * mouse targets; the keyboard reaches Open as `O` (the row's description says so).
 */
function TaskRow({ task, rowKey, now, active, sessionsAvailable, onClick, onOpen, onStart }: TaskRowProps) {
  const due = task.dueDate === null ? null : formatDue(task.dueDate, now);
  const keysId = `${rowId(rowKey)}-keys`;
  const act = (then: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    then();
  };
  return (
    <div
      id={rowId(rowKey)}
      role="option"
      aria-selected={active}
      aria-describedby={keysId}
      data-task={task.id}
      title={task.links?.incomplete ? 'Links may be incomplete' : undefined}
      onClick={onClick}
      className={cn('flex min-w-0 cursor-default flex-col gap-0.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-sidebar-accent/60', active && 'bg-sidebar-accent')}
    >
      {/* The row's description only: its name is its content (WORK-2.2). */}
      <span id={keysId} className="sr-only" aria-hidden>
        S starts a Session on it, O opens it in Fantastic.
      </span>
      {/* The spaces keep the row's name (from its content) from running the fields together. */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate" data-field="title" title={task.title}>
          {task.title}
        </span>{' '}
        <SessionMarker sessions={sessionsAvailable ? task.links?.sessions ?? [] : []} incomplete={task.links?.incomplete ?? false} />
        <span className="ml-auto flex shrink-0 items-center gap-0.5" aria-hidden>
          {/* WORK-5.1: the launcher, its prompt the Task's URL; you press Start. */}
          <RowButton title="Start Session (S)" action="start" onClick={act(onStart)}>
            <Play className="size-3" />
          </RowButton>
          {/* WORK-6.2: the Task in Fantastic, in a new tab; `O` does the same (WORK-6.4). */}
          <RowButton title="Open in Fantastic (O)" action="open" onClick={act(onOpen)}>
            <ExternalLink className="size-3" />
          </RowButton>
        </span>
      </div>
      {(task.project !== null || task.status !== null) && (
        <div className="flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground">
          {task.project !== null && (
            <span className="min-w-0 truncate" data-field="project" title={task.project}>
              {task.project}
            </span>
          )}{' '}
          {task.project !== null && task.status !== null && (
            <span aria-hidden className="shrink-0">
              ·
            </span>
          )}
          {task.status !== null && (
            <span className="min-w-0 truncate" data-field="status" title={task.status}>
              {task.status}
            </span>
          )}{' '}
        </div>
      )}
      {task.links && task.links.prs.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-1 text-[12px] text-muted-foreground" data-field="linked-prs">
          {task.links.prs.map((linked) => (
            <span key={linked.url} className="inline-flex items-center gap-1" title={linked.sources.map((source) => (source === 'body' ? 'PR body' : 'branch')).join(', ')} data-field="linked-pr">
              <span className="font-medium text-foreground">#{linked.number}</span>
              {linked.chip ? <span className={cn('rounded-full border px-1.5 text-[10.5px] leading-4 font-medium', CHIP_CLASS[linked.chip])}>{linked.chip}</span> : <span>Review request</span>}
              <Ci ci={linked.ci} />
            </span>
          ))}
        </div>
      )}
      {(task.milestone || due) && (
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
          {task.milestone && (
            <>
              <span className="flex shrink-0 items-center gap-0.5 rounded-full border border-busy/40 px-1.5 text-[10.5px] leading-4 font-medium text-busy-text" data-field="milestone">
                <Milestone aria-hidden className="size-3" />
                milestone
              </span>{' '}
            </>
          )}
          {due && (
            <span className="truncate" data-field="due" title={due.title}>
              {due.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** WORK-2.4, WORK-3.4, WORK-4.5: one status marker; its hover lists the reason for each Linked Session. */
function SessionMarker({ sessions, incomplete }: { sessions: readonly WorkSessionLink[]; incomplete: boolean }) {
  if (sessions.length === 0) return null;
  const live = sessions.some((session) => session.live);
  const reasons: string[] = [...new Set(sessions.map((session) => session.reason))];
  if (incomplete) reasons.push('Links may be incomplete');
  const title = reasons.join('\n');
  const Marker = live ? CircleDot : Circle;
  return (
    <span data-session-marker title={title} aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
      <Marker className={cn('size-3.5', live ? 'text-ok-text' : 'text-muted-foreground')} />
    </span>
  );
}

interface PrsSectionProps {
  prs: PrSection;
  sessionsAvailable: boolean;
  /** WORK-8.4: until when GitHub is rate limited, for how long a failed read waits. */
  blockedUntil: number | null;
  now: number;
  selected: string | null;
  listRef: Ref<HTMLDivElement>;
  onListFocus(e: FocusEvent<HTMLDivElement>): void;
  onListPress(e: MouseEvent<HTMLDivElement>): void;
  onRow(row: WorkRow): void;
  onOpen(row: WorkRow): void;
  onReview(row: WorkRow): void;
}

/** WORK-3: PRs, with its count and age (WORK-1.3), its problems (WORK-7) and its two groups in one listbox. */
function PrsSection({ prs, sessionsAvailable, blockedUntil, now: clock, selected, listRef, onListFocus, onListPress, onRow, onOpen, onReview }: PrsSectionProps) {
  // The page's clock ticks once a second, so it can be just behind the data it shows: never show ages from before the fetch.
  const now = Math.max(clock, prs.fetchedAt ?? clock);
  const lists = hasPrLists(prs);
  const count = prs.mine.length + prs.reviewRequests.length;
  const groups = PR_GROUPS.filter((g) => prs[g].length > 0 || prs.marks[g].length > 0);
  const active = selected !== null && PR_GROUPS.some((g) => prs[g].some((pr) => prKey(pr) === selected)) ? selected : null;
  // WORK-8.4: a rate limit says when it frees up.
  const frees = prs.state === 'error' && blockedUntil !== null && blockedUntil > now ? `That's in ${backIn(blockedUntil - now)}.` : null;
  return (
    <section aria-labelledby="work-prs-heading" data-section="prs" className="flex flex-col">
      <SectionHeader id="work-prs-heading" title="PRs" count={lists ? count : null} fetchedAt={prs.fetchedAt} now={now} loading={prs.state === 'loading'} stale={prs.stale} />
      {prs.taskIds === false && <p className="px-3 pb-1 text-[12px] text-muted-foreground" data-field="task-link-version">Task links need a newer tb-pr.</p>}
      {prs.state !== 'ok' && prs.state !== 'loading' && (
        <Problem
          title={prs.state === 'not-installed' ? "tb-pr isn't installed" : prs.state === 'signed-out' ? "tb-pr isn't signed in to GitHub" : prs.stale ? "Couldn't update PRs" : "Couldn't read PRs"}
          reason={prs.state === 'error' && prs.reason ? (frees ? `${prs.reason} ${frees}` : prs.reason) : null}
          how={prs.state === 'not-installed' ? 'Work reads your PRs through tb-pr. Install it, then press Refresh:' : prs.state === 'signed-out' ? 'Run this, then press Refresh:' : null}
          fix={prs.fix}
          stale={prs.stale}
          fetchedAt={prs.fetchedAt}
          now={now}
        />
      )}
      {lists && groups.length === 0 && <p className="px-3 py-3 text-[12px] text-muted-foreground">No open PRs or review requests</p>}
      {lists && groups.length > 0 && (
        <div
          ref={listRef}
          role="listbox"
          aria-label="PRs"
          aria-activedescendant={active ? rowId(active) : undefined}
          // In the Tab order while it holds the selection, or while no list does, as when it has only marks (UX, Focus).
          tabIndex={active || selected === null ? 0 : -1}
          onFocus={onListFocus}
          onMouseDown={onListPress}
          className="flex flex-col outline-none"
        >
          {groups.map((g) => (
            <PrGroupView key={g} group={g} prs={prs[g]} marks={prs.marks[g]} sessionsAvailable={sessionsAvailable} now={now} selected={active} onRow={onRow} onOpen={onOpen} onReview={onReview} />
          ))}
        </div>
      )}
    </section>
  );
}

interface PrGroupProps {
  group: PrGroup;
  prs: WorkPr[];
  marks: ColumnMark[];
  sessionsAvailable: boolean;
  now: number;
  selected: string | null;
  onRow(row: WorkRow): void;
  onOpen(row: WorkRow): void;
  onReview(row: WorkRow): void;
}

/** WORK-3.1: one PR group, a `group` of the listbox, labelled by its name and described by its mark (WORK-7.5). */
function PrGroupView({ group, prs, marks, sessionsAvailable, now, selected, onRow, onOpen, onReview }: PrGroupProps) {
  const label = `work-group-${group}`;
  const markId = `work-marks-${group}`;
  return (
    <div role="group" aria-labelledby={label} aria-describedby={marks.length > 0 ? markId : undefined} data-group={group} className="flex flex-col">
      <div role="presentation" className="px-3 pt-1.5 pb-0.5 text-[11.5px] font-medium text-muted-foreground">
        <span id={label}>{PR_GROUP_LABEL[group]}</span>
      </div>
      {/* WORK-7.5: a column with an issue is possibly out of date, even when tb-pr succeeded. */}
      {marks.length > 0 && (
        <div role="presentation" className="mx-2 mb-1 flex gap-1.5 rounded-md bg-needs-you-soft px-2 py-1.5 text-[11.5px] text-needs-you-text">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {/* The spaces keep the group's description (aria-describedby) from running the lines together. */}
          <span id={markId} className="min-w-0" data-field="marks">
            <span className="block font-medium">Possibly out of date.</span>{' '}
            {marks.map((m) => (
              <span key={`${m.reason}:${m.confirmedAt}`}>
                <span className="block" data-field="mark">
                  {describeMark(m, group, now)}.
                </span>{' '}
              </span>
            ))}
          </span>
        </div>
      )}
      {prs.length > 0 && (
        <div role="presentation" className="flex flex-col gap-px px-1.5">
          {prs.map((pr) => {
            const row: WorkRow = { key: prKey(pr), kind: 'pr', group, pr };
            return <PrRow key={row.key} rowKey={row.key} group={group} pr={pr} now={now} active={row.key === selected} sessionsAvailable={sessionsAvailable} onClick={() => onRow(row)} onOpen={() => onOpen(row)} onReview={() => onReview(row)} />;
          })}
        </div>
      )}
    </div>
  );
}

const CHIP_CLASS: Record<NonNullable<WorkPr['chip']>, string> = {
  draft: 'border-border text-muted-foreground',
  ready: 'border-busy/40 text-busy',
  approved: 'border-ok/40 text-ok',
};

interface PrRowProps {
  rowKey: string;
  group: PrGroup;
  pr: WorkPr;
  now: number;
  active: boolean;
  sessionsAvailable: boolean;
  onClick(): void;
  onOpen(): void;
  onReview(): void;
}

/**
 * WORK-3.2: repo, number, Mine's state chip, CI, age, and the title, all of which a screen reader
 * hears as the option's name; Review and Open in browser as mouse targets, which the keyboard
 * reaches as `R` and `O` (the row's description says so).
 */
function PrRow({ rowKey, group, pr, now, active, sessionsAvailable, onClick, onOpen, onReview }: PrRowProps) {
  const age = pr.createdAt !== null ? formatAge(now - pr.createdAt) : pr.ageDays !== null ? formatAge(pr.ageDays * DAY_MS) : null;
  // WORK-3.5: coloured by the time since it was opened; without an opening time, muted as before.
  const level = pr.createdAt !== null ? ageLevel(now - pr.createdAt) : null;
  const isReview = group === 'reviewRequests';
  const keysId = `${rowId(rowKey)}-keys`;
  const act = (then: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    then();
  };
  return (
    <div
      id={rowId(rowKey)}
      role="option"
      aria-selected={active}
      aria-describedby={keysId}
      data-pr={`${pr.repo}#${pr.number}`}
      title={pr.links?.incomplete ? 'Links may be incomplete' : undefined}
      onClick={onClick}
      className={cn('flex min-w-0 cursor-default flex-col gap-0.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-sidebar-accent/60', active && 'bg-sidebar-accent')}
    >
      {/* The row's description only: its name is its content, as History's rows' (WORK-3.2). */}
      <span id={keysId} className="sr-only" aria-hidden>
        {isReview ? 'R reviews it, O opens it on GitHub.' : 'O opens it on GitHub.'}
      </span>
      {/* The spaces keep the row's name (from its content: repo, number, chip, CI, age, title) from running the fields together. */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate text-muted-foreground" data-field="repo">
          {pr.repo}
        </span>{' '}
        <span className="shrink-0 font-medium tabular-nums" data-field="number">
          #{pr.number}
        </span>{' '}
        <SessionMarker sessions={sessionsAvailable ? pr.links?.sessions ?? [] : []} incomplete={pr.links?.incomplete ?? false} />
        {pr.chip && (
          <>
            <span className={cn('shrink-0 rounded-full border px-1.5 text-[10.5px] leading-4 font-medium', CHIP_CLASS[pr.chip])} data-field="chip">
              {pr.chip}
            </span>{' '}
          </>
        )}
        <Ci ci={pr.ci} />{' '}
        {age && (
          <>
            <span
              className={cn('shrink-0 text-[12px]', level ? AGE_LEVEL_CLASS[level] : 'text-muted-foreground')}
              data-field="age"
              data-level={level ?? undefined}
              title={pr.createdAt !== null ? `Opened ${new Date(pr.createdAt).toLocaleString()}` : undefined}
            >
              {age}
            </span>{' '}
          </>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-0.5" aria-hidden>
          {isReview && (
            <RowButton title="Review (R)" action="review" onClick={act(onReview)}>
              <Play className="size-3" />
            </RowButton>
          )}
          {/* WORK-6.3: tb-pr's URL, in a new tab; `O` does the same (WORK-6.4). */}
          <RowButton title="Open on GitHub (O)" action="open" onClick={act(onOpen)}>
            <ExternalLink className="size-3" />
          </RowButton>
        </span>
      </div>
      <p className="truncate" data-field="title" title={pr.title}>
        {pr.title}
      </p>
      {pr.links && pr.links.tasks.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-1 text-[12px] text-muted-foreground" data-field="linked-tasks">
          {pr.links.tasks.map((linked) => (
            <span key={linked.id} className="truncate" title={linked.sources.map((source) => (source === 'body' ? 'PR body' : 'branch')).join(', ')} data-field="linked-task">
              {linked.title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A row's button, for the mouse only: inside an option nothing is focusable (UX, "Markers and buttons"). */
function RowButton({ title, action, onClick, children }: { title: string; action: string; onClick(e: MouseEvent): void; children: ReactNode }) {
  return (
    <span
      title={title}
      data-action={action}
      onClick={onClick}
      className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50"
    >
      {children}
    </span>
  );
}

const CI_LABEL: Record<WorkPr['ci'], string> = { passing: 'CI passing', failing: 'CI failing', running: 'CI running', none: 'No CI state from tb-pr' };

/** WORK-3.2, WORK-3.3: CI as an icon; "no CI" is spelled out and grey, so it never reads as passing. */
function Ci({ ci }: { ci: WorkPr['ci'] }) {
  const icon =
    ci === 'passing' ? (
      <CircleCheck aria-hidden className="size-3.5 text-ok" />
    ) : ci === 'failing' ? (
      <CircleX aria-hidden className="size-3.5 text-destructive" />
    ) : ci === 'running' ? (
      <LoaderCircle aria-hidden className="size-3.5 text-busy motion-safe:animate-spin" />
    ) : (
      <CircleDashed aria-hidden className="size-3.5" />
    );
  return (
    <span
      role="img"
      aria-label={ci === 'none' ? 'no CI' : CI_LABEL[ci]}
      title={CI_LABEL[ci]}
      data-field="ci"
      data-ci={ci}
      className={cn('flex shrink-0 items-center gap-0.5', ci === 'none' && 'text-[11.5px] text-muted-foreground')}
    >
      {icon}
      {ci === 'none' && <span aria-hidden>no CI</span>}
    </span>
  );
}
