import type { ColumnMark, PrSection, WorkPr, WorkSnapshot } from '@shared/work.ts';
import { CircleCheck, CircleDashed, CircleX, ExternalLink, LoaderCircle, Play, TriangleAlert } from 'lucide-react';
import { type KeyboardEvent, type MouseEvent, type ReactNode, type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { type PanelNav, WORK_FILTERS, WORK_FILTER_LABEL, type WorkFilter } from '@/lib/right-sidebar';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { PR_GROUPS, PR_GROUP_LABEL, type PrGroup, type WorkRow, backIn, describeMark, hasPrLists, keepSelection, prKey, showsPrs, visibleRows } from '@/lib/work';

export interface WorkPanelProps {
  work: WorkSnapshot | null;
  /** WORK-1.5: which sections show; remembered by the caller. */
  filter: WorkFilter;
  onFilter(filter: WorkFilter): void;
  now: number;
  /** Bumped to move focus into Work (opening it with `W` or its tab). */
  focusKey: number;
  /** WORK-5.2: "Review" on a Review request. */
  onReview(pr: WorkPr): void;
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

/** WORK-6.3: a PR's GitHub URL in a new browser tab, with no way back to Lookout. */
function openInBrowser(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * WORK: the Work tab of the right sidebar. Its filter, then its sections: PRs, with Mine and Review
 * requests (WORK-3). Tasks come with slice C; until then the Tasks section isn't shown.
 *
 * As in History, the rows are the options of one focusable listbox (a `group` per PR group), and an
 * option holds nothing focusable: its Review and Open buttons are mouse targets, and the keyboard
 * acts on the selected row with Enter, `O` and `R` (WORK UX, "Markers and buttons").
 */
export function WorkPanel({ work, filter, onFilter, now, focusKey, onReview, keyboardEnabled, navRef }: WorkPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // WORK-1.9: the selection follows its item while it's visible, else the first visible row.
  const rows = visibleRows(work, filter);
  const [selected, setSelected] = useState<string | null>(null);
  const current = keepSelection(selected, rows);
  if (current !== selected) setSelected(current);

  useEffect(() => (listRef.current ?? rootRef.current)?.focus(), [focusKey]);
  // The listbox comes and goes with the PRs, and focus follows it (WORK-1.7): once it shows, it takes
  // focus from the panel, where opening Work put it while nothing was read yet; when it goes while
  // focused, the panel takes it back, so focus never drops to the page, where j/k move the Session
  // sidebar. React detaches this ref before it removes the listbox.
  const attachList = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      listRef.current = el;
      if (document.activeElement === rootRef.current) el.focus();
      return;
    }
    if (listRef.current && document.activeElement === listRef.current) rootRef.current?.focus();
    listRef.current = null;
  }, []);

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
  // A row acts on its Linked Sessions (WORK-2.4, WORK-3.4). Links come with WORK-4; until then no row
  // has one, and a row without a Linked Session does nothing: its buttons do (UX, "Row clicks").
  const activate = (row: WorkRow) => {
    void row;
  };
  const review = (row: WorkRow) => {
    if (row.group === 'reviewRequests') onReview(row.pr);
  };

  // WORK-1.7: ↑/↓ and j/k move through the visible rows without acting; Enter acts like a click, from
  // the list only. WORK-6.4: O opens the selected row as its button does, without moving anything;
  // WORK-5.2: R reviews it. O and R count with Caps Lock on, never with Shift, and once per press:
  // a held key's repeats open no more tabs.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!keyboardEnabled || e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey || isTextField(e.target)) return;
    const row = rows.find((r) => r.key === current);
    const letter = e.shiftKey ? null : e.key.toLowerCase();
    if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault(); // the Session sidebar's own ↑/↓ and j/k stay put
      move(e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1);
    } else if (e.key === 'Enter' && e.target === listRef.current && row) {
      e.preventDefault();
      activate(row);
    } else if (letter === 'o' && row) {
      e.preventDefault();
      if (!e.repeat) openInBrowser(row.pr.url);
    } else if (letter === 'r' && row?.group === 'reviewRequests') {
      e.preventDefault();
      if (!e.repeat) review(row);
    }
  };

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
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-2">
        {showsPrs(filter) && prs && (
          <PrsSection
            prs={prs}
            blockedUntil={work?.refresh.githubBlockedUntil ?? null}
            now={now}
            selected={current}
            listRef={attachList}
            onRow={(row) => {
              select(row.key);
              activate(row);
            }}
            onOpen={(row) => {
              select(row.key);
              openInBrowser(row.pr.url);
            }}
            onReview={(row) => {
              select(row.key);
              review(row);
            }}
          />
        )}
      </div>
    </div>
  );
}

interface PrsSectionProps {
  prs: PrSection;
  /** WORK-8.4: until when GitHub is rate limited, for how long a failed read waits. */
  blockedUntil: number | null;
  now: number;
  selected: string | null;
  listRef: Ref<HTMLDivElement>;
  onRow(row: WorkRow): void;
  onOpen(row: WorkRow): void;
  onReview(row: WorkRow): void;
}

/** WORK-3: PRs, with its count and age (WORK-1.3), its problems (WORK-7) and its two groups in one listbox. */
function PrsSection({ prs, blockedUntil, now: clock, selected, listRef, onRow, onOpen, onReview }: PrsSectionProps) {
  // The page's clock ticks once a second, so it can be just behind the data it shows: never show ages from before the fetch.
  const now = Math.max(clock, prs.fetchedAt ?? clock);
  const lists = hasPrLists(prs);
  const count = prs.mine.length + prs.reviewRequests.length;
  const updated = prs.fetchedAt === null ? null : `updated ${formatAge(now - prs.fetchedAt)} ago`;
  const groups = PR_GROUPS.filter((g) => prs[g].length > 0 || prs.marks[g].length > 0);
  const active = selected !== null && PR_GROUPS.some((g) => prs[g].some((pr) => prKey(pr) === selected)) ? selected : null;
  return (
    <section aria-labelledby="work-prs-heading" data-section="prs" className="flex flex-col">
      <header className="flex min-w-0 items-center gap-1 px-3 pt-1 pb-1 text-[12px] text-muted-foreground">
        <h3 id="work-prs-heading" className="font-semibold text-foreground">
          PRs
        </h3>
        {lists && (
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
        {prs.state === 'loading' && <span className="truncate">· Loading…</span>}
        {prs.stale && (
          <span data-field="old" className="ml-auto shrink-0 rounded-full bg-needs-you-soft px-1.5 text-[11px] font-medium text-needs-you-text" title="From an earlier read: the last one failed">
            old
          </span>
        )}
      </header>
      {prs.state !== 'ok' && prs.state !== 'loading' && <PrProblem prs={prs} blockedUntil={blockedUntil} now={now} />}
      {lists && groups.length === 0 && <p className="px-3 py-3 text-[12px] text-muted-foreground">No open PRs or review requests</p>}
      {lists && groups.length > 0 && (
        <div
          ref={listRef}
          role="listbox"
          aria-label="PRs and review requests"
          aria-activedescendant={active ? rowId(active) : undefined}
          tabIndex={0}
          className="flex flex-col outline-none"
        >
          {groups.map((g) => (
            <PrGroupView key={g} group={g} prs={prs[g]} marks={prs.marks[g]} now={now} selected={active} onRow={onRow} onOpen={onOpen} onReview={onReview} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * WORK-7.1 to 7.3, UX "Errors": what's wrong and what to do, in plain words; a list kept from
 * before is marked old. Signed out is said once: the title, then the command.
 */
function PrProblem({ prs, blockedUntil, now }: { prs: PrSection; blockedUntil: number | null; now: number }) {
  const title =
    prs.state === 'not-installed' ? "tb-pr isn't installed" : prs.state === 'signed-out' ? "tb-pr isn't signed in to GitHub" : prs.stale ? "Couldn't update PRs" : "Couldn't read PRs";
  const how = prs.state === 'not-installed' ? 'Work reads your PRs through tb-pr. Install it, then press Refresh:' : prs.state === 'signed-out' ? 'Run this, then press Refresh:' : null;
  // WORK-8.4: a rate limit says when it frees up.
  const frees = prs.state === 'error' && blockedUntil !== null && blockedUntil > now ? `That's in ${backIn(blockedUntil - now)}.` : null;
  return (
    <div role="alert" className="mx-2 mb-1.5 rounded-md border border-destructive/30 px-2 py-1.5 text-[12px]" data-field="problem">
      <p className="font-medium text-destructive">{title}</p>
      {prs.state === 'error' && prs.reason && (
        <p className="mt-0.5 text-muted-foreground" data-field="reason">
          {prs.reason}
          {frees && ` ${frees}`}
        </p>
      )}
      {how && <p className="mt-1 text-muted-foreground">{how}</p>}
      {prs.fix && (
        <pre className="mt-1 rounded-md border border-border bg-background p-1.5 font-mono text-[11px] leading-4 break-all whitespace-pre-wrap select-all">{prs.fix}</pre>
      )}
      {prs.stale && (
        <p className="mt-1 text-muted-foreground">
          Showing the last list{prs.fetchedAt === null ? '' : `, from ${formatAge(now - prs.fetchedAt)} ago`}.
        </p>
      )}
    </div>
  );
}

interface PrGroupProps {
  group: PrGroup;
  prs: WorkPr[];
  marks: ColumnMark[];
  now: number;
  selected: string | null;
  onRow(row: WorkRow): void;
  onOpen(row: WorkRow): void;
  onReview(row: WorkRow): void;
}

/** WORK-3.1: one PR group, a `group` of the listbox, labelled by its name and described by its mark (WORK-7.5). */
function PrGroupView({ group, prs, marks, now, selected, onRow, onOpen, onReview }: PrGroupProps) {
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
            return <PrRow key={row.key} row={row} now={now} active={row.key === selected} onClick={() => onRow(row)} onOpen={() => onOpen(row)} onReview={() => onReview(row)} />;
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
  row: WorkRow;
  now: number;
  active: boolean;
  onClick(): void;
  onOpen(): void;
  onReview(): void;
}

/**
 * WORK-3.2: repo, number, Mine's state chip, CI, age, and the title, all of which a screen reader
 * hears as the option's name; Review and Open in browser as mouse targets, which the keyboard
 * reaches as `R` and `O` (the row's description says so).
 */
function PrRow({ row, now, active, onClick, onOpen, onReview }: PrRowProps) {
  const { pr } = row;
  const age = pr.createdAt !== null ? formatAge(now - pr.createdAt) : pr.ageDays !== null ? formatAge(pr.ageDays * DAY_MS) : null;
  const isReview = row.group === 'reviewRequests';
  const keysId = `${rowId(row.key)}-keys`;
  const act = (then: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    then();
  };
  return (
    <div
      id={rowId(row.key)}
      role="option"
      aria-selected={active}
      aria-describedby={keysId}
      data-pr={`${pr.repo}#${pr.number}`}
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
            <span className="shrink-0 text-[12px] text-muted-foreground" data-field="age" title={pr.createdAt !== null ? `Opened ${new Date(pr.createdAt).toLocaleString()}` : undefined}>
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
