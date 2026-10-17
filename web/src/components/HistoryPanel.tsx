import { BLOCK_REASON } from '@shared/history.ts';
import type { Harness, HistoryItem, HistoryPage, SessionRow } from '@shared/types.ts';
import { Circle, CircleDot, CircleSlash, History as HistoryIcon, Search, X } from 'lucide-react';
import { type KeyboardEvent, type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { HistoryQuery } from '@/lib/client';
import { type HarnessFilter, clampWidth, filterHarness, isLive, itemKey, loadHarnessFilter, saveHarnessFilter, snippetParts } from '@/lib/history';
import { HARNESS_NAME } from '@/lib/sessions';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';
import { SHELL_COLUMN, ShellCell } from './Shell';

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
  width: number;
  /** HIST-1.3: the width once a drag ends. */
  onResize(width: number): void;
  onClose(): void;
  /** Bumped to focus the search box (HIST-1.1). */
  focusKey: number;
  /** The live Sessions, for the live marker (HIST-2.3) and the live check (HIST-3.2). */
  sessions: ReadonlyMap<string, SessionRow>;
  now: number;
  search(q: HistoryQuery): Promise<HistoryPage>;
  /** HIST-3: a click or Enter on a result. Rejects with a message for people. */
  onOpen(item: HistoryItem, live: boolean): Promise<void>;
}

type Results =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'not-installed'; command: string }
  /**
   * `gen`: the request (query and toggle) these pages answer; only that one pages further.
   * `auto`: pages fetched on their own since the first page or the last scroll or click.
   */
  | { state: 'ok'; gen: number; items: HistoryItem[]; page: number; hasMore: boolean; loadingMore: boolean; auto: number };

/** HIST: the right sidebar, with History as its only panel (no tab strip until a second one). */
export function HistoryPanel({ width, onResize, onClose, focusKey, sessions, now, search, onOpen }: HistoryPanelProps) {
  const [query, setQuery] = useState('');
  const [headless, setHeadless] = useState(false);
  // HIST-2.8: both by default; one can be switched off, never both. Remembered across reloads.
  const [harnesses, setHarnesses] = useState<HarnessFilter>(loadHarnessFilter);
  const harness = filterHarness(harnesses);
  const toggleHarness = (h: Harness) => {
    const next = { ...harnesses, [h]: !harnesses[h] };
    if (!next.claude && !next.codex) return;
    setHarnesses(next);
    saveHarnessFilter(next);
  };
  const [results, setResults] = useState<Results>({ state: 'loading' });
  const [active, setActive] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
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
  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(
      () => {
        searchRef.current({ query: q, page: 1, headless, harness }).then(
          (page) => {
            if (seq.current !== mine) return;
            setActive(0);
            setResults(
              page.state === 'ok'
                ? { state: 'ok', gen: mine, items: page.items, page: page.page, hasMore: page.hasMore, loadingMore: false, auto: 0 }
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
  const open = (item: HistoryItem) => {
    const key = itemKey(item);
    if (opening) return;
    setOpening(key);
    setOpenError(null);
    onOpen(item, isLive(item, sessions)).then(
      () => setOpening(null),
      (err: unknown) => {
        setOpening(null);
        setOpenError(err instanceof Error ? err.message : "Couldn't resume it.");
      },
    );
  };

  // HIST-2.7: ↑/↓ (and j/k outside the search box) move; only Enter or a click acts. Enter opens
  // a result only from the search box or the result list: on a button or the toggle, it's theirs.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    const inSearch = e.target === inputRef.current;
    const inResults = inSearch || (listboxRef.current !== null && e.target === listboxRef.current);
    const move = (delta: number) => {
      e.preventDefault(); // the Session sidebar's own ↑/↓ and j/k stay put
      if (!items.length) return;
      const next = Math.min(items.length - 1, Math.max(0, active + delta));
      setActive(next);
      listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView?.({ block: 'nearest' });
    };
    if (e.key === 'ArrowDown' || (!inSearch && e.key === 'j')) move(1);
    else if (e.key === 'ArrowUp' || (!inSearch && e.key === 'k')) move(-1);
    else if (e.key === 'Enter' && inResults && items[active]) {
      e.preventDefault();
      open(items[active]);
    } else if (e.key === 'Escape' && inSearch && query) {
      e.preventDefault();
      setQuery('');
    }
  };

  // HIST-1.3: drag the left edge to resize.
  const startResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    let latest = startWidth;
    const onMove = (m: MouseEvent) => {
      latest = clampWidth(startWidth + (startX - m.clientX));
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

  const activeId = items[active] ? `history-${itemKey(items[active])}` : undefined;
  let body;
  if (results.state === 'loading') body = <Message title="Loading…" />;
  else if (results.state === 'error') body = <Message title="Couldn't search History" hint={results.message} />;
  else if (results.state === 'not-installed') body = <NotInstalled command={results.command} />;
  else if (items.length === 0 && (results.loadingMore || (results.hasMore && results.auto < AUTO_FILL_PAGES))) body = <Message title="Loading…" />;
  else if (items.length === 0 && results.hasMore) body = <LoadMore onClick={() => loadMore()} hint="None of the newest past Sessions can be shown here; older ones may." />;
  else if (items.length === 0) body = q ? <Message title={`Nothing matches “${q}”`} /> : <Message title="No past Sessions" />;
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
            live={isLive(item, sessions)}
            active={i === active}
            opening={opening === itemKey(item)}
            now={now}
            onClick={() => {
              setActive(i);
              open(item);
            }}
          />
        ))}
        {results.loadingMore && <p className="px-2 py-2 text-[12px] text-muted-foreground">Loading more…</p>}
        {!results.loadingMore && results.hasMore && results.auto >= AUTO_FILL_PAGES && <LoadMore onClick={() => loadMore()} />}
      </div>
    );
  }

  return (
    <aside
      aria-label="History sidebar"
      className={cn(SHELL_COLUMN, 'relative border-l border-sidebar-border bg-sidebar text-sidebar-foreground')}
      style={{ width }}
      data-shell-column="right"
      onKeyDown={onKeyDown}
      data-testid="history-panel"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize History"
        aria-valuenow={width}
        onMouseDown={startResize}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-ring/20"
      />
      {/* SIDE-8.1: the search field is this column's header cell, mirroring the Filter bar on the
          left; the panel's name stays for assistive tech (the tab strip waits for a second panel). */}
      <ShellCell row="header" className="gap-1.5 border-sidebar-border px-2.5 py-2">
        <h2 className="sr-only">History</h2>
        <HistoryIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <label className="relative flex min-w-0 flex-1 items-center">
          <Search aria-hidden className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
          <input
            ref={inputRef}
            type="search"
            aria-label="Search past Sessions"
            aria-controls="history-results"
            placeholder="Search past Sessions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 w-full min-w-0 rounded-md border border-input bg-background/60 pr-2 pl-7 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/20 [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
        <Button variant="ghost" size="icon-sm" aria-label="Close History" title="Close History (H)" onClick={onClose} className="size-7 shrink-0 text-muted-foreground">
          <X className="size-4" />
        </Button>
      </ShellCell>
      {/* The list runs on past the dock line, to the bottom. */}
      <ShellCell row="body" toBottom className="flex flex-col">
        <div className="flex flex-col gap-1.5 px-2.5 pt-2 pb-2">
          <div className="flex min-w-0 items-center gap-2">
            <label className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
              <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} className="size-3.5" />
              <span className="truncate">Show Headless Sessions</span>
            </label>
            <div role="group" aria-label="Harnesses" className="ml-auto flex shrink-0 items-center gap-0.5">
              {(['claude', 'codex'] as const).map((h) => {
                const on = harnesses[h];
                const last = on && !harnesses[h === 'claude' ? 'codex' : 'claude'];
                return (
                  <button
                    key={h}
                    type="button"
                    aria-pressed={on}
                    aria-label={HARNESS_NAME[h]}
                    aria-disabled={last || undefined}
                    title={last ? `${HARNESS_NAME[h]}: at least one Harness stays on` : `${on ? 'Hide' : 'Show'} ${HARNESS_NAME[h]} Sessions`}
                    onClick={() => toggleHarness(h)}
                    className={cn(
                      'flex size-6 items-center justify-center rounded-md border transition-colors',
                      on ? 'border-border bg-background text-foreground dark:bg-input/30' : 'border-transparent text-muted-foreground opacity-45 grayscale hover:opacity-80',
                      last && 'cursor-default',
                    )}
                  >
                    <HarnessIcon harness={h} className="size-3.5" />
                  </button>
                );
              })}
            </div>
          </div>
          {openError && (
            <p role="alert" className="rounded-md border border-destructive/30 px-2 py-1.5 text-[12px] text-destructive">
              {openError}
            </p>
          )}
        </div>
        <div id="history-results" ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          {body}
        </div>
      </ShellCell>
    </aside>
  );
}

interface ResultProps {
  index: number;
  item: HistoryItem;
  live: boolean;
  active: boolean;
  opening: boolean;
  now: number;
  onClick(): void;
}

/** HIST-2.3: one past Session. Markers: a circle with a dot live, an empty circle resumable, a slashed circle can't be resumed. */
function Result({ index, item, live, active, opening, now, onClick }: ResultProps) {
  const state = live ? 'live' : item.blocked ? 'blocked' : 'resumable';
  const what = live ? 'Live: select it' : item.blocked ? `Can't be resumed: ${BLOCK_REASON[item.blocked]} Opens read-only.` : 'Resume it';
  return (
    <div
      id={`history-${itemKey(item)}`}
      role="option"
      aria-selected={active}
      data-index={index}
      data-state={state}
      data-session-id={item.sessionId}
      title={what}
      onClick={onClick}
      className={cn(
        'flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-sidebar-accent/60',
        active && 'bg-sidebar-accent',
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span aria-hidden className={cn('flex w-3 shrink-0 justify-center', live ? 'text-busy' : 'text-muted-foreground')} data-field="marker">
          {live ? <CircleDot className="size-3" /> : item.blocked ? <CircleSlash className="size-3" /> : <Circle className="size-3" />}
        </span>
        <span className={cn('min-w-0 flex-1 truncate font-medium', item.blocked && 'text-muted-foreground')} data-field="title">
          {item.title}
        </span>
        {live && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] font-medium" data-field="live">
            live
          </span>
        )}
        {opening && <span className="shrink-0 text-[11px] text-muted-foreground">Resuming…</span>}
      </div>
      <div className="flex min-w-0 items-center gap-1 pl-4.5 text-[12px] text-muted-foreground">
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
        {item.headless && <span className="shrink-0 rounded bg-muted px-1 text-[10.5px]">headless</span>}
      </div>
      {item.blocked === 'folder-gone' && <p className="pl-4.5 text-[11.5px] text-muted-foreground">folder gone</p>}
      {item.blocked === 'transcript-missing' && <p className="pl-4.5 text-[11.5px] text-muted-foreground">Transcript deleted</p>}
      {item.snippet && (
        <p className="line-clamp-2 pl-4.5 text-[12px] text-muted-foreground" data-field="snippet">
          {snippetParts(item.snippet).map((p, i) =>
            p.hit ? (
              <mark key={i} className="rounded-sm bg-needs-you-soft px-0.5 text-foreground">
                {p.text}
              </mark>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </p>
      )}
    </div>
  );
}

function Message({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-8 text-center" role="status">
      <p className="text-[13px] font-medium">{title}</p>
      {hint && <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** HIST-2.1: after AUTO_FILL_PAGES pages on their own, more only on request. */
function LoadMore({ onClick, hint }: { onClick(): void; hint?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-1.5 px-2', hint ? 'py-8 text-center' : 'py-2')}>
      {hint && <p className="text-[12px] leading-5 text-muted-foreground">{hint}</p>}
      <Button variant="ghost" size="sm" onClick={onClick} className="text-[12px]">
        Load more
      </Button>
    </div>
  );
}

/** Like SIDE-6.1: how to install tb-session instead of an empty list. */
function NotInstalled({ command }: { command: string }) {
  return (
    <div className="px-3 py-6" role="alert">
      <p className="text-[13px] font-medium">tb-session isn&apos;t installed</p>
      <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
        History searches past Sessions through tb-session. Install it, then reopen History:
      </p>
      <pre className="mt-2 rounded-md border border-border bg-background p-2 font-mono text-[11px] leading-4 break-all whitespace-pre-wrap select-all">
        {command}
      </pre>
      <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
        Needs an authenticated <code className="rounded bg-muted px-1 font-mono text-[11px]">gh</code>; it installs into ~/.local/bin.
      </p>
    </div>
  );
}
