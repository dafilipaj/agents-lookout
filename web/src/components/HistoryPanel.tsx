import { BLOCK_REASON } from '@shared/history.ts';
import type { Harness, HistoryItem, HistoryPage, HistoryPeek, SessionRow, Status } from '@shared/types.ts';
import { Eye, History, Play, Search } from 'lucide-react';
import { type KeyboardEvent, type MouseEvent, type ReactNode, type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { CommandBlock } from '@/components/ui/command-block';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton, RowAction, RowActions, RowSettling, useRowSettle } from '@/components/ui/icon-button';
import { Loading } from '@/components/ui/loading';
import { SessionMarker } from '@/components/ui/session-marker';
import type { HistoryQuery } from '@/lib/client';
import { type HarnessFilter, filterHarness, isLive, itemKey, loadHarnessFilter, saveHarnessFilter, snippetParts } from '@/lib/history';
import type { PanelNav } from '@/lib/right-sidebar';
import { HARNESS_NAME } from '@/lib/sessions';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';

/** HIST-2.2: typing waits this long before searching, well within the 1 s. */
export const SEARCH_DEBOUNCE_MS = 150;
/** HIST-2.1: the next page loads once you're this close to the bottom. */
const LOAD_MORE_PX = 200;
/**
 * HIST-2.1: pages fetched on their own while the list shows nothing or doesn't fill the panel
 * (a page can come back empty once Lookout has filtered it), before "Load more" takes over.
 */
export const AUTO_FILL_PAGES = 5;

export interface HistoryPanelProps {
  /** Bumped to focus the search box (HIST-1.1). */
  focusKey: number;
  headless: boolean;
  onHeadless(value: boolean): void;
  /** The live Sessions, for the live marker (HIST-2.3) and the live check (HIST-3.2). */
  sessions: ReadonlyMap<string, SessionRow>;
  now: number;
  search(q: HistoryQuery): Promise<HistoryPage>;
  /** HIST-2.10: an expanded result's first prompt and last message, read when it's expanded. */
  peek(harness: Harness, sessionId: string): Promise<HistoryPeek>;
  /** HIST-3: an expanded result's button, or Enter on it. Rejects with a message for people. */
  onOpen(item: HistoryItem, live: boolean): Promise<void>;
  /** WORK-1.7: how the tab strip moves History's results. */
  navRef?: Ref<PanelNav>;
}

type Results =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'not-installed'; command: string }
  /** TOOLS-2.5: tb-session is too old for what History asked; `reason` names the version it needs. */
  | { state: 'too-old'; reason: string; command: string }
  /**
   * `gen`: the request (query and toggle) these pages answer; only that one pages further.
   * `auto`: pages fetched on their own since the first page or the last scroll or click.
   */
  | { state: 'ok'; gen: number; items: HistoryItem[]; page: number; hasMore: boolean; loadingMore: boolean; auto: number };

/** HIST-2.10: an expanded result's read: under way, done, or failed with a reason. */
type Peek = { state: 'loading' } | { state: 'ok'; peek: HistoryPeek } | { state: 'error'; message: string };

/**
 * HIST: the History tab of the right sidebar (RightSidebar): its search field, toggles and results.
 * A click or Enter selects a result and expands it in place (HIST-3.5); its one button, or Enter on
 * the expanded result, resumes, opens or shows it (HIST-3.1 to 3.3).
 */
export function HistoryPanel({ focusKey, sessions, now, search, peek, onOpen, navRef, headless, onHeadless }: HistoryPanelProps) {
  const [query, setQuery] = useState('');
  // HIST-2.8: both by default; one can be switched off, never both. Remembered across reloads.
  const [harnesses, setHarnesses] = useState<HarnessFilter>(loadHarnessFilter);
  const harness = filterHarness(harnesses);
  const toggleHarness = (h: Harness) => {
    const next = { ...harnesses, [h]: !harnesses[h] };
    if (!next.claude && !next.codex) return;
    setExpanded(null);
    setHarnesses(next);
    saveHarnessFilter(next);
  };
  const [results, setResults] = useState<Results>({ state: 'loading' });
  const [active, setActive] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  // HIST-3.6: a failed resume, under that result's button.
  const [openError, setOpenError] = useState<{ key: string; message: string } | null>(null);
  // HIST-2.11: the one expanded result, by its key.
  const [expanded, setExpanded] = useState<string | null>(null);
  // HIST-3.5: a click that expands a result holds its button back a moment, so a double click resumes nothing.
  const { settling, settle } = useRowSettle();
  // HIST-2.10: what each expanded result read, kept per Session while the list shows it; a new search clears them.
  const [peeks, setPeeks] = useState<ReadonlyMap<string, Peek>>(new Map());
  const peekRef = useRef(peek);
  useEffect(() => {
    peekRef.current = peek;
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  /** The latest request; answers to older ones are dropped. */
  const seq = useRef(0);
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });

  // HIST-1.1: opening it focuses the search box.
  useEffect(() => inputRef.current?.focus(), [focusKey]);

  // HIST-2.1/2.2: the first page, again on every change of query or toggle.
  const q = query.trim();
  /** HIST-2.11: a new query or toggle collapses the expanded result, which may not be in its answer. */
  const changeQuery = (next: string) => {
    setQuery(next);
    setExpanded(null);
  };
  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(
      () => {
        searchRef.current({ query: q, page: 1, headless, harness }).then(
          (page) => {
            if (seq.current !== mine) return;
            setActive(0);
            setExpanded(null);
            setPeeks(new Map());
            setResults(
              page.state === 'ok'
                ? { state: 'ok', gen: mine, items: page.items, page: page.page, hasMore: page.hasMore, loadingMore: false, auto: 0 }
                : page.state === 'too-old'
                  ? { state: 'too-old', reason: page.reason, command: page.installCommand }
                  : { state: 'not-installed', command: page.installCommand },
            );
          },
          (err: unknown) => {
            if (seq.current === mine) setResults({ state: 'error', message: err instanceof Error ? err.message : 'Searching failed.' });
          },
        );
      },
      q ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [q, headless, harness]);

  // HIST-2.1: more as you scroll (listing only; a search returns its best matches). Results of an
  // older query or toggle never page: once either changes, paging waits for the new first page,
  // so a later page can't land after another request's first.
  // `auto`: fetched because the list doesn't fill the panel, at most AUTO_FILL_PAGES in a row.
  const loadMore = (auto = false) => {
    if (results.state !== 'ok' || !results.hasMore || results.loadingMore || results.gen !== seq.current) return;
    if (auto && results.auto >= AUTO_FILL_PAGES) return;
    const mine = results.gen;
    const next = results.page + 1;
    setResults({ ...results, loadingMore: true, auto: auto ? results.auto + 1 : 0 });
    searchRef.current({ query: q, page: next, headless, harness }).then(
      (page) => {
        if (seq.current !== mine) return;
        setResults((r) => {
          if (r.state !== 'ok' || r.gen !== mine || page.state !== 'ok') return r;
          const seen = new Set(r.items.map(itemKey));
          return { ...r, items: [...r.items, ...page.items.filter((i) => !seen.has(itemKey(i)))], page: next, hasMore: page.hasMore, loadingMore: false };
        });
      },
      () => {
        if (seq.current === mine) setResults((r) => (r.state === 'ok' && r.gen === mine ? { ...r, loadingMore: false, hasMore: false } : r));
      },
    );
  };
  const onScroll = () => {
    const el = listRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - LOAD_MORE_PX) loadMore();
  };
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  });
  // HIST-2.1: a list that shows nothing, or doesn't reach the bottom of the panel, can't be
  // scrolled for more, so it fetches the next page itself (this request's pages only).
  useEffect(() => {
    if (results.state !== 'ok' || !results.hasMore || results.loadingMore) return;
    const el = listRef.current;
    const unfilled = results.items.length === 0 || (el !== null && el.clientHeight > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - LOAD_MORE_PX);
    if (unfilled) loadMoreRef.current(true);
  }, [results]);

  const items = results.state === 'ok' ? results.items : [];
  /** HIST-3.1 to HIST-3.3: the expanded result's button, or Enter on it: resume, open or show it. */
  const open = (item: HistoryItem) => {
    const key = itemKey(item);
    if (opening) return;
    setOpening(key);
    setOpenError(null);
    onOpen(item, isLive(item, sessions)).then(
      () => setOpening(null),
      (err: unknown) => {
        setOpening(null);
        setOpenError({ key, message: err instanceof Error ? err.message : "Couldn't resume it." });
      },
    );
  };

  /**
   * HIST-3.5, HIST-2.11: select a result and expand it, collapsing any other; nothing else. Its first
   * prompt and last message are read once per Session (HIST-2.10).
   */
  const expand = (index: number) => {
    const item = items[index];
    if (!item) return;
    const key = itemKey(item);
    setActive(index);
    setExpanded(key);
    if (openError && openError.key !== key) setOpenError(null);
    if (peeks.has(key) && peeks.get(key)!.state !== 'error') return;
    const gen = seq.current;
    setPeeks((m) => new Map(m).set(key, { state: 'loading' }));
    const settle = (p: Peek) => {
      if (seq.current === gen) setPeeks((m) => (m.has(key) ? new Map(m).set(key, p) : m));
    };
    peekRef.current(item.harness, item.sessionId).then(
      (peek) => settle({ state: 'ok', peek }),
      (err: unknown) => settle({ state: 'error', message: err instanceof Error ? err.message : "Couldn't read this Session." }),
    );
  };
  // HIST-2.11: the list scrolls to keep all of the expanded result in view, only as far as it must.
  useEffect(() => {
    if (expanded) document.getElementById(`history-${expanded}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [expanded]);

  /** HIST-2.7: the next or previous result, without acting; the result left collapses. */
  const step = (delta: number) => {
    if (!items.length) return;
    const next = Math.min(items.length - 1, Math.max(0, active + delta));
    if (next !== active) setExpanded(null);
    setActive(next);
    listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView?.({ block: 'nearest' });
  };
  // The tab strip moves the results through this, not through a key event of its own (WORK-1.7).
  useImperativeHandle(navRef, () => ({ move: step }));

  // HIST-2.7: ↑/↓ (and j/k outside the search box) move. Enter, only from the search box or the
  // result list (on a button or the toggle it's theirs), expands the selected result, or on the
  // expanded one runs its button (HIST-3.5); while a new query's or toggle's search hasn't answered,
  // Enter waits for it, so it never acts on a result of the old one. Esc there collapses the
  // expanded result (HIST-2.11), else clears the query.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    const inSearch = e.target === inputRef.current;
    const inResults = inSearch || (listboxRef.current !== null && e.target === listboxRef.current);
    const move = (delta: number) => {
      e.preventDefault(); // the Session sidebar's own ↑/↓ and j/k stay put
      step(delta);
    };
    if (e.key === 'ArrowDown' || (!inSearch && e.key === 'j')) move(1);
    else if (e.key === 'ArrowUp' || (!inSearch && e.key === 'k')) move(-1);
    else if (e.key === 'Enter' && inResults && items[active]) {
      e.preventDefault();
      if (results.state === 'ok' && results.gen !== seq.current) return;
      if (expanded !== itemKey(items[active])) expand(active);
      else if (!e.repeat) open(items[active]);
    } else if (e.key === 'Escape' && inResults && expanded !== null) {
      e.preventDefault();
      setExpanded(null);
    } else if (e.key === 'Escape' && inSearch && query) {
      e.preventDefault();
      changeQuery('');
    }
  };

  const activeId = items[active] ? `history-${itemKey(items[active])}` : undefined;
  let body;
  if (results.state === 'loading') body = <Loading label="Loading…" className="items-center px-4 py-8 text-center" />;
  else if (results.state === 'error') body = <Alert title="Couldn't search History" detail={results.message} className="mx-2.5 my-3" />;
  else if (results.state === 'not-installed') body = <NotInstalled command={results.command} />;
  else if (results.state === 'too-old') body = <NotInstalled command={results.command} tooOld={results.reason} />;
  else if (items.length === 0 && (results.loadingMore || (results.hasMore && results.auto < AUTO_FILL_PAGES))) body = <Loading label="Loading…" className="items-center px-4 py-8 text-center" />;
  else if (items.length === 0 && results.hasMore) body = <LoadMore onClick={() => loadMore()} hint="None of the newest past Sessions can be shown here; older ones may." />;
  else if (items.length === 0) body = <EmptyState role="status" title={q ? `Nothing matches “${q}”` : 'No past Sessions'} />;
  else {
    body = (
      <div
        ref={listboxRef}
        role="listbox"
        aria-label="Past Sessions"
        aria-activedescendant={activeId}
        tabIndex={0}
        className="flex flex-col gap-px px-1.5 pb-2 outline-none"
      >
        {items.map((item, i) => (
          <Result
            key={itemKey(item)}
            index={i}
            item={item}
            status={isLive(item, sessions) ? (sessions.get(item.sessionId)?.status ?? 'unknown') : null}
            since={sessions.get(item.sessionId)?.statusSince ?? null}
            active={i === active}
            expanded={expanded === itemKey(item)}
            peek={peeks.get(itemKey(item)) ?? null}
            opening={opening === itemKey(item)}
            busy={opening !== null}
            openError={openError?.key === itemKey(item) ? openError.message : null}
            now={now}
            onClick={(e) => {
              if (expanded !== itemKey(item)) settle(e);
              expand(i);
            }}
            onOpen={() => open(item)}
          />
        ))}
        {results.loadingMore && <Loading label="Loading more…" className="px-2 py-2" />}
        {!results.loadingMore && results.hasMore && results.auto >= AUTO_FILL_PAGES && <LoadMore onClick={() => loadMore()} />}
      </div>
    );
  }

  // WORK-1.8: below the tab strip, History keeps its search field at the top of its panel.
  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown} data-testid="history-panel">
      <div className="flex flex-col gap-1.5 px-2.5 pt-2 pb-2">
        <label className="relative flex min-w-0 items-center">
          <Search aria-hidden className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
          <input
            ref={inputRef}
            type="search"
            aria-label="Search past Sessions"
            aria-controls="history-results"
            placeholder="Search past Sessions"
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            className="h-7 w-full min-w-0 rounded-md border border-input bg-background/60 pr-2 pl-7 text-body outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/20 [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
        <div className="flex min-w-0 items-center gap-2">
          <label className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground">
            <input
              type="checkbox"
              checked={headless}
              onChange={(e) => {
                onHeadless(e.target.checked);
                setExpanded(null);
              }}
              className="size-3.5"
            />
            <span className="truncate">Show Headless Sessions</span>
          </label>
          <div role="group" aria-label="Harnesses" className="ml-auto flex shrink-0 items-center gap-0.5">
            {(['claude', 'codex'] as const).map((h) => {
              const on = harnesses[h];
              const last = on && !harnesses[h === 'claude' ? 'codex' : 'claude'];
              return (
                <IconButton
                  key={h}
                  label={HARNESS_NAME[h]}
                  tip={last ? `${HARNESS_NAME[h]}: at least one Harness stays on` : `${on ? 'Hide' : 'Show'} ${HARNESS_NAME[h]} Sessions`}
                  aria-pressed={on}
                  aria-disabled={last || undefined}
                  onClick={() => toggleHarness(h)}
                  className={cn(
                    'border transition-colors',
                    on ? 'border-border bg-background text-foreground dark:bg-input/30' : 'border-transparent opacity-45 grayscale hover:opacity-80',
                    last && 'cursor-default',
                  )}
                >
                  <HarnessIcon harness={h} className="size-3.5" />
                </IconButton>
              );
            })}
          </div>
        </div>
      </div>
      <div id="history-results" ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <RowSettling.Provider value={settling}>{body}</RowSettling.Provider>
      </div>
    </div>
  );
}

interface ResultProps {
  index: number;
  item: HistoryItem;
  /** A live Session's Status, from the Session sidebar's list (DS-5.2); null for a past one. */
  status: Status | null;
  /** When that Status began, for the Busy pulse (DS-10.1). */
  since: number | null;
  active: boolean;
  /** HIST-2.11: the one result expanded. */
  expanded: boolean;
  /** HIST-2.10: what its expansion read, once it has been expanded. */
  peek: Peek | null;
  opening: boolean;
  /** A resume runs (this result's or another's): the button waits. */
  busy: boolean;
  /** HIST-3.6: why its resume failed. */
  openError: string | null;
  now: number;
  /** A click on it (HIST-3.5). */
  onClick(e: MouseEvent): void;
  onOpen(): void;
}

/** HIST-3.5: the expanded result's one button, by what it is. */
const BUTTON = {
  live: { label: 'Open', tip: 'Open: select the live Session', icon: <Play /> },
  resumable: { label: 'Resume', tip: 'Resume it in its own Session host', icon: <History /> },
  blocked: { label: 'Show', tip: 'Show it read-only', icon: <Eye /> },
} as const;

/** HIST-2.9: when it was last active, as "Oct 20, 14:12". */
const lastActive = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * HIST-2.3: one past Session. Its marker (DS-5.2) is a live Session's Status marker, following its
 * Status; the past marker when it can be resumed; the slashed circle when it can't. The row's words
 * say which, so the marker is hidden from screen readers (DS-5.5). A click only selects and expands
 * it (HIST-3.5); expanded (HIST-2.9), it adds its start directory, when it was last active, whether
 * it can be resumed (not the Harness or branch again: its second line has them), its first prompt and last message, and its button, as its description.
 */
function Result({ index, item, status, since, active, expanded, peek, opening, busy, openError, now, onClick, onOpen }: ResultProps) {
  const live = status !== null;
  const state = live ? 'live' : item.blocked ? 'blocked' : 'resumable';
  const id = `history-${itemKey(item)}`;
  const button = BUTTON[state];
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-expanded={expanded}
      aria-describedby={expanded ? `${id}-details` : undefined}
      data-index={index}
      data-state={state}
      data-session-id={item.sessionId}
      title={expanded ? undefined : 'Show its details'}
      onClick={onClick}
      className={cn(
        'flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5 text-body hover:bg-sidebar-accent/60',
        active && 'bg-sidebar-accent',
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <SessionMarker aria-hidden state={status !== null ? 'live' : item.blocked ? 'blocked' : 'past'} status={status ?? undefined} since={since} data-field="marker" />
        <span className={cn('min-w-0 flex-1 truncate font-medium', item.blocked && 'text-muted-foreground')} data-field="title">
          {item.title}
        </span>
        {live && <Chip data-field="live">live</Chip>}
        {opening && <span className="shrink-0 text-caption text-muted-foreground">Resuming…</span>}
      </div>
      <div className="flex min-w-0 items-center gap-1 pl-5 text-meta text-muted-foreground">
        <HarnessIcon harness={item.harness} className="size-3" />
        <span className="shrink-0" data-field="harness">
          {HARNESS_NAME[item.harness]}
        </span>
        {item.repo && (
          <>
            <span aria-hidden>·</span>
            <span className="min-w-0 truncate" data-field="repo" title={item.projectPath ?? undefined}>
              {item.repo}
            </span>
          </>
        )}
        {item.branch && (
          <>
            <span aria-hidden>·</span>
            <span className="min-w-0 truncate" data-field="branch">
              {item.branch}
            </span>
          </>
        )}
        {item.lastActiveAt !== null && (
          <>
            <span aria-hidden>·</span>
            <span className="shrink-0" data-field="age">
              {formatAge(now - item.lastActiveAt)}
            </span>
          </>
        )}
        {item.headless && <Chip>headless</Chip>}
      </div>
      {!expanded && item.blocked === 'folder-gone' && <p className="pl-5 text-meta text-muted-foreground">folder gone</p>}
      {!expanded && item.blocked === 'transcript-missing' && <p className="pl-5 text-meta text-muted-foreground">Transcript deleted</p>}
      {item.snippet && (
        <p className="line-clamp-2 pl-5 text-meta text-muted-foreground" data-field="snippet">
          {snippetParts(item.snippet).map((p, i) =>
            p.hit ? (
              <mark key={i} className="rounded-sm bg-highlight px-0.5 text-foreground">
                {p.text}
              </mark>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </p>
      )}
      {expanded && (
        <>
          <div id={`${id}-details`} aria-hidden className="mt-1 flex min-w-0 flex-col gap-1.5 pl-5 text-meta text-muted-foreground" data-field="details">
            {item.projectDisplay && (
              <p className="truncate" data-field="start-dir" title={item.projectPath ?? undefined}>
                {item.projectDisplay}
              </p>
            )}
            <p data-field="state">
              {[item.lastActiveAt !== null ? lastActive(item.lastActiveAt) : null, live ? 'live' : item.blocked ? "can't be resumed" : 'can resume'].filter(Boolean).join(' · ')}
            </p>
            {!live && item.blocked && <p data-field="blocked">{BLOCK_REASON[item.blocked]}</p>}
            <Said item={item} peek={peek} />
            <RowActions>
              <RowAction data-action={state === 'live' ? 'open' : state === 'blocked' ? 'show' : 'resume'} label={opening ? 'Resuming…' : button.label} icon={button.icon} tip={button.tip} enabled={!busy} onPress={onOpen} />
            </RowActions>
          </div>
          {openError && <Alert title={openError} className="mt-1" />}
        </>
      )}
    </div>
  );
}

/** One labelled line of an expanded result: "First", "Last". */
function Line({ label, field, children }: { label: string; field: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2" data-field={field}>
      <span className="w-9 shrink-0">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * HIST-2.9, HIST-2.10: the first prompt (from the row, else the read) and the last message with who
 * said it, each its first three lines. "Loading…" while the read runs; a failed read is a line of its
 * own, and the button still works. tb-session 0.2 can't tail, so its last message is left out.
 */
function Said({ item, peek }: { item: HistoryItem; peek: Peek | null }) {
  const first = item.firstPrompt ?? (peek?.state === 'ok' ? peek.peek.firstPrompt : null);
  const quote = (text: string) => <p className="line-clamp-3 whitespace-pre-line text-foreground">{text}</p>;
  return (
    <>
      {first && <Line label="First" field="first-prompt">{quote(first)}</Line>}
      {(!peek || peek.state === 'loading') && <Loading label="Loading…" />}
      {peek?.state === 'error' && <p data-field="peek-error">Couldn't read its messages: {peek.message}</p>}
      {peek?.state === 'ok' && peek.peek.last && (
        <Line label="Last" field="last-message">
          <span className="text-caption font-medium">{peek.peek.last.role === 'user' ? 'You' : HARNESS_NAME[item.harness]}</span>
          {quote(peek.peek.last.text)}
        </Line>
      )}
    </>
  );
}

/** HIST-2.1: after AUTO_FILL_PAGES pages on their own, more only on request. */
function LoadMore({ onClick, hint }: { onClick(): void; hint?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-1.5 px-2', hint ? 'py-8 text-center' : 'py-2')}>
      {hint && <p className="text-meta leading-5 text-muted-foreground">{hint}</p>}
      <Button variant="ghost" size="sm" onClick={onClick} className="text-meta">
        Load more
      </Button>
    </div>
  );
}

/**
 * Like SIDE-6.1: how to install tb-session instead of an empty list. With `tooOld` (TOOLS-2.5), one
 * that answered as too old says so, and the version History needs, never that it isn't installed.
 */
function NotInstalled({ command, tooOld }: { command: string; tooOld?: string }) {
  return (
    <Alert
      title={tooOld ?? "tb-session isn't installed"}
      detail={tooOld ? 'History searches past Sessions through tb-session. Update it, then reopen History:' : 'History searches past Sessions through tb-session. Install it, then reopen History:'}
      className="mx-2.5 my-3"
    >
      <CommandBlock>{command}</CommandBlock>
      <p>
        Needs an authenticated <code className="rounded bg-muted px-1 font-mono text-caption">gh</code>; it installs into ~/.local/bin.
      </p>
    </Alert>
  );
}
