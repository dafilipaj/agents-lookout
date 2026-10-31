import { BLOCK_REASON } from '@shared/history.ts';
import { libraryMatches } from '@shared/library-search.ts';
import { LIBRARY_TYPES, type LibraryFilter, type LibraryPage, type LibraryQuery, type LibraryType, type OutputItem, type OutputSession } from '@shared/library.ts';
import type { HistoryItem, SessionRow } from '@shared/types.ts';
import { Copy, ExternalLink, CircleSlash, Search, X } from 'lucide-react';
import { type KeyboardEvent, type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { CommandBlock } from '@/components/ui/command-block';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton, RowAction, RowActions, RowSettling, useRowSettle } from '@/components/ui/icon-button';
import { Loading } from '@/components/ui/loading';
import { SessionMarker } from '@/components/ui/session-marker';
import { useCopy } from '@/lib/copy';
import { isLive } from '@/lib/history';
import type { PanelNav } from '@/lib/right-sidebar';
import { STATUS_LABEL } from '@/lib/sessions';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { SEARCH_DEBOUNCE_MS } from './HistoryPanel';
import { HarnessIcon } from './HarnessIcon';
import { AddToTopicAction, TopicChips } from './TopicLinks';
import { outputSessionMembers, useTopics } from '@/lib/topics';
import { OUTPUT_ICON, TYPE_LABEL, openFile, openOutput } from '@/lib/outputs';

const FILTER_LABEL: Record<LibraryType, string> = { pages: 'Pages', pdf: 'PDF', markdown: 'Markdown', image: 'Image', share: 'Share' };
const EVENT: Record<OutputSession['event'], string> = { write: 'wrote it', edit: 'edited it', publish: 'published it', upload: 'uploaded it' };
const key = (i: OutputItem) => `${i.kind}:${i.key}`;
const stamp = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function day(at: number, now: number): string {
  const date = new Date(at), today = new Date(now), yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  return date.toDateString() === today.toDateString() ? 'Today' : date.toDateString() === yesterday.toDateString() ? 'Yesterday' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** LIB-2.7: starts, ends, replacement processes and Subagent completions can add Outputs.
 * Activity, context, model and Status updates during normal polling wait for the 60-second read.
 */
function outputsChanged(before: ReadonlyMap<string, SessionRow>, after: ReadonlyMap<string, SessionRow>): boolean {
  if (before.size !== after.size) return true;
  for (const [id, row] of after) {
    const previous = before.get(id);
    if (!previous || previous.harness !== row.harness || previous.pid !== row.pid || previous.procStart !== row.procStart) return true;
    // Finished counts are per Turn: a reset or a new running Subagent is not a completion.
    if ((row.subagents?.finished ?? 0) > (previous.subagents?.finished ?? 0)) return true;
    // Running counts also catch completions from earlier Turns; an unknown reading is not zero.
    if (previous.subagents && row.subagents && row.subagents.running < previous.subagents.running) return true;
  }
  return false;
}

export interface LibraryPanelProps {
  focusKey: number;
  visible: boolean;
  sessions: ReadonlyMap<string, SessionRow>;
  now: number;
  search(q: LibraryQuery): Promise<LibraryPage>;
  status(): Promise<{ indexing: boolean }>;
  filter: LibraryFilter;
  onFilter(filter: LibraryFilter): void;
  headless: boolean;
  onHeadless(value: boolean): void;
  onSession(item: HistoryItem, live: boolean): Promise<void>;
  keyboardEnabled: boolean;
  navRef?: Ref<PanelNav>;
  /** TOPIC-4.4: only the Outputs of a Topic's Sessions, named by the Topic, until cleared. */
  sessionFilter?: { label: string; keys: string[] } | null;
  onClearSessionFilter?(): void;
}
type Page = Extract<LibraryPage, { state: 'ok' }>;
interface Results { pages: Page[]; gen: number; limit?: number }
interface Actions { open(): void; copy(): void; session(): void }

/** LIB-2.8: what the Library says instead of Outputs when tb-session can't give them. */
interface Install { title: string; detail: string; command: string }

/** TOOLS-2.5: a tb-session that's too old says so, with the version it needs, never that it isn't installed. */
function installHint(page: Extract<LibraryPage, { state: 'not-installed' | 'too-old' }>): Install {
  return page.state === 'too-old'
    ? { title: page.reason, detail: 'Update it, then reopen Library:', command: page.installCommand }
    : { title: 'tb-session needs events', detail: 'Install a tb-session with events, then reopen Library:', command: page.installCommand };
}

/** LIB: the tab renders the server's held read. It never mines a Transcript or fetches an external URL. */
export function LibraryPanel({ focusKey, visible, sessions, now, search, status, filter, onFilter, headless, onHeadless, onSession, keyboardEnabled, navRef, sessionFilter = null, onClearSessionFilter }: LibraryPanelProps) {
  const [query, setQuery] = useState('');
  const topics = useTopics();
  const [results, setResults] = useState<Results | null>(null);
  const [busy, setBusy] = useState(true), [moreBusy, setMoreBusy] = useState(false), [indexing, setIndexing] = useState(false);
  const [error, setError] = useState<string | null>(null), [install, setInstall] = useState<Install | null>(null);
  const [active, setActive] = useState<string | null>(null), [expanded, setExpanded] = useState<string | null>(null), [hovered, setHovered] = useState<string | null>(null);
  const [opening, setOpening] = useState(false), [actionError, setActionError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null), scroll = useRef<HTMLDivElement>(null);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refreshQueued = useRef(false);
  const heldRead = useRef<string | undefined>(undefined);
  const readScope = useRef({ visible: false, headless });
  const seq = useRef(0), pending = useRef<Results | null>(null), reading = useRef(false);
  const frozen = useRef(false);
  useLayoutEffect(() => { frozen.current = expanded !== null || hovered !== null; });
  const current = useRef(results);
  useLayoutEffect(() => { current.current = results; });
  const actions = useRef(new Map<string, Actions>());
  const { settling, settle } = useRowSettle();
  const q = query.trim(), types = filter.types.join(',');
  const only = sessionFilter?.keys.join(',') ?? null;
  // TOPIC-4.4: a Topic's "+N more" shows all its Sessions' Outputs, so a text filter left from before clears.
  const [previousOnly, setPreviousOnly] = useState(only);
  if (previousOnly !== only) {
    setPreviousOnly(only);
    if (only) setQuery('');
  }
  const request = useRef({ search, status, q, filter, headless, sessionFilter });
  useLayoutEffect(() => { request.current = { search, status, q, filter, headless, sessionFilter }; });
  const ask = (page: number, readId?: string) => { const r = request.current; return r.search({ ...r.filter, query: r.q, page, ...(readId ? { readId } : {}), headless: r.headless, ...(r.sessionFilter ? { sessions: r.sessionFilter.keys } : {}) }); };
  const apply = (next: Results) => {
    if (next.gen !== seq.current) return;
    if (frozen.current) pending.current = next;
    else { pending.current = null; setResults(next); }
  };
  useEffect(() => {
    if (expanded || hovered) return;
    const next = pending.current;
    pending.current = null;
    if (next?.gen === seq.current) setResults(next);
  }, [expanded, hovered]);
  useEffect(() => { if (visible) input.current?.focus(); }, [focusKey, visible]);

  const refresh = useRef<(readId?: string) => void>(() => { });
  const refreshNow = (readId?: string) => {
    if (!visible || !alive.current) return;
    if (reading.current) { refreshQueued.current = true; return; }
    const mine = seq.current;
    const previous = pending.current ?? current.current;
    const target = previous?.gen === mine ? previous.limit ?? previous.pages.reduce((n, page) => n + page.items.length, 0) : 0;
    reading.current = true; setBusy(true); setError(null);
    // Rebuild the whole loaded range from one read before replacing any rows. An edit can
    // move a later row onto page one, shifting every page that follows it.
    const read = async () => {
      let pages: Page[] = [], count = 0, pageNumber = 1, id = readId;
      while (mine === seq.current) {
        const page = await ask(pageNumber, id);
        if (mine !== seq.current) return;
        if (page.state === 'not-installed' || page.state === 'too-old') { setInstall(installHint(page)); setResults(null); return; }
        if (page.state === 'read-again') { pages = []; count = 0; pageNumber = 1; id = undefined; continue; }
        heldRead.current = page.readId; setInstall(null);
        pages.push(page); count += page.items.length;
        if (!page.hasMore || count >= target) { apply({ pages, gen: mine, ...(target > 0 && count > target ? { limit: target } : {}) }); return; }
        pageNumber = page.nextPage; id = page.readId;
      }
    };
    void read().catch((err: unknown) => { if (seq.current === mine) setError(err instanceof Error ? err.message : "Couldn't read Library."); }).finally(() => {
      if (seq.current === mine) {
        reading.current = false; setBusy(false); setIndexing(false);
        if (refreshQueued.current) { refreshQueued.current = false; setTimeout(() => { if (seq.current === mine) refresh.current(); }, 0); }
      }
    });
  };
  useLayoutEffect(() => { refresh.current = refreshNow; });
  const signature = JSON.stringify([q, types, filter.project, filter.hideGone, headless, visible, only]);
  const [previousFilter, setPreviousFilter] = useState(signature);
  if (previousFilter !== signature) {
    setPreviousFilter(signature); setResults(null); setExpanded(null); setHovered(null); setActive(null); setBusy(true); setMoreBusy(false); setError(null); setInstall(null);
  }
  // Invalidate before the passive thaw effect: collapsing on a new filter must not restore its old buffer.
  useLayoutEffect(() => {
    const fresh = !readScope.current.visible || readScope.current.headless !== headless;
    readScope.current = { visible, headless };
    if (!visible) { seq.current++; reading.current = false; return; }
    ++seq.current; reading.current = false; refreshQueued.current = false; pending.current = null;
    const readId = fresh ? undefined : heldRead.current;
    if (fresh) heldRead.current = undefined;
    const timer = setTimeout(() => refresh.current(readId), q ? SEARCH_DEBOUNCE_MS : 0);
    const invalidate = () => { seq.current++; };
    return () => { clearTimeout(timer); invalidate(); };
  }, [q, types, filter.project, filter.hideGone, headless, visible, only]);
  // Comparing whole rows would index growing Transcripts on every two-second activity update.
  const previousFleet = useRef(sessions);
  useEffect(() => {
    const changed = outputsChanged(previousFleet.current, sessions);
    previousFleet.current = sessions;
    if (changed && visible) refresh.current();
  }, [sessions, visible]);
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh.current(); }, 60_000);
    return () => clearInterval(timer);
  }, [visible]);
  // A slow first call may be migrating the index. Its status contains no rows or paths.
  useEffect(() => {
    if (!busy && !moreBusy) return;
    let stopped = false;
    const check = () => request.current.status().then((s) => { if (!stopped) setIndexing(s.indexing); }, () => { });
    const timer = setInterval(() => void check(), 500);
    return () => { stopped = true; clearInterval(timer); };
  }, [busy, moreBusy]);

  const last = results?.pages.at(-1), items = (results?.pages.flatMap((p) => p.items) ?? []).slice(0, results?.limit);
  const load = useRef(() => { });
  const loadMore = () => {
    const r = pending.current ?? current.current, tail = r?.pages.at(-1);
    if (!r || r.gen !== seq.current || reading.current) return;
    // A refresh can fill the last page past the previous visible row count. Reveal its
    // retained rows first, so the next request still starts at a whole-page boundary.
    if (r.limit !== undefined) { apply({ ...r, limit: undefined }); return; }
    if (!tail?.hasMore) return;
    const mine = r.gen; reading.current = true; setMoreBusy(true); setError(null);
    let restart = false;
    void ask(tail.nextPage, tail.readId).then((page) => {
      if (mine !== seq.current) return;
      if (page.state === 'not-installed' || page.state === 'too-old') { setInstall(installHint(page)); return; }
      if (page.state === 'read-again') { restart = true; return; }
      const old = pending.current ?? current.current;
      if (!old || old.gen !== mine) return;
      const seen = new Set(old.pages.flatMap((p) => p.items.map(key)));
      apply({ ...old, pages: [...old.pages, { ...page, items: page.items.filter((i) => !seen.has(key(i))) }] });
    }).catch((err: unknown) => { if (mine === seq.current) setError(err instanceof Error ? err.message : "Couldn't load more Outputs."); }).finally(() => {
      if (mine !== seq.current) return;
      reading.current = false; setMoreBusy(false); setIndexing(false);
      // Start the queued read now, before the auto-fill effect can ask the old read for another page.
      if (restart || refreshQueued.current) { refreshQueued.current = false; refresh.current(); }
    });
  };
  useLayoutEffect(() => { load.current = loadMore; });
  useEffect(() => {
    const el = scroll.current;
    if (!busy && !moreBusy && !error && results && (items.length === 0 || (el && el.clientHeight > 0 && el.scrollHeight <= el.clientHeight + 200))) load.current();
  }, [results, items.length, busy, moreBusy, error]);
  // Retain selection by key when a refresh moves rows, including across day headings.
  const selected = items.findIndex((i) => key(i) === active);
  const index = selected >= 0 ? selected : 0;
  const move = (delta: number) => { const item = items[Math.max(0, Math.min(items.length - 1, index + delta))]; if (item) { if (key(item) !== active) setExpanded(null); setActive(key(item)); document.getElementById(`library-${encodeURIComponent(key(item))}`)?.scrollIntoView?.({ block: 'nearest' }); } };
  const collapse = () => { if (!expanded) return false; setExpanded(null); return true; };
  useImperativeHandle(navRef, () => ({ move, collapse }));
  useEffect(() => { if (expanded) document.getElementById(`library-${encodeURIComponent(expanded)}`)?.scrollIntoView?.({ block: 'nearest' }); }, [expanded]);
  const onKey = (e: KeyboardEvent) => {
    if (!keyboardEnabled || e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
    if (e.target instanceof HTMLSelectElement) return;
    const text = e.target instanceof HTMLElement && (e.target.matches('input:not([type="checkbox"]):not([type="radio"]),textarea,select') || e.target.isContentEditable);
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowDown' || (!text && k === 'j')) { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp' || (!text && k === 'k')) { e.preventDefault(); move(-1); }
    else if (e.key === 'Escape') { if (collapse()) e.preventDefault(); }
    else if (e.key === 'Enter' && (e.target === input.current || e.target === list.current) && items[index] && !e.repeat) {
      e.preventDefault(); const id = key(items[index]!); setActive(id); if (expanded !== id) setExpanded(id); else actions.current.get(id)?.open();
    } else if (!text && !e.repeat && items[index] && k === 'a' && topics) {
      // TOPIC-2.1: A opens the Topic picker for the selected row's Sessions.
      e.preventDefault(); const members = outputSessionMembers(items[index]!.sessions); if (members.length) topics.addTo(members, items[index]!.title);
    } else if (!text && !e.repeat && items[index] && ['o', 'c', 's'].includes(k)) {
      e.preventDefault(); const a = actions.current.get(key(items[index]!)); if (k === 'o') a?.open(); else if (k === 'c') a?.copy(); else a?.session();
    }
  };
  const session = async (s: OutputSession) => {
    if (opening || s.pruned || !keyboardEnabled) return;
    setOpening(true); setActionError(null);
    try { await onSession(s, isLive(s, sessions)); } catch (e) { setActionError(e instanceof Error ? e.message : "Couldn't open its Session."); } finally { setOpening(false); }
  };
  const hidden = results?.pages[0]?.hiddenGone ?? 0;
  const projects = new Set([...(results?.pages.flatMap((p) => p.projects) ?? []), ...(filter.project ? [filter.project] : [])]);
  const typeToggle = (t: LibraryType, only: boolean) => {
    const next = only ? [t] : filter.types.includes(t) ? filter.types.filter((v) => v !== t) : LIBRARY_TYPES.filter((v) => v === t || filter.types.includes(v));
    if (next.length) onFilter({ ...filter, types: next });
  };
  return <section className="relative flex min-h-0 flex-1 flex-col" data-testid="library-panel" onKeyDown={onKey}>
    <div className="flex flex-col gap-2 border-b border-sidebar-border px-2.5 py-2">
      <label className="relative flex items-center">
        <Search aria-hidden className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
        <input ref={input} type="search" aria-label="Filter Outputs" placeholder="Filter Outputs" value={query} onChange={(e) => setQuery(e.target.value)} className="h-7 w-full min-w-0 rounded-md border border-input bg-background/60 pr-2 pl-7 text-body outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30" />
      </label>
      {sessionFilter && <div className="flex min-w-0 items-center gap-1 text-meta text-muted-foreground" data-field="session-filter">
        <span className="min-w-0 truncate">Sessions of {sessionFilter.label}</span>
        <IconButton label={`Show every Output, not only ${sessionFilter.label}'s`} tip="Show every Output" onClick={() => onClearSessionFilter?.()}>
          <X />
        </IconButton>
      </div>}
      <div role="group" aria-label="Output Types" className="flex flex-wrap gap-1">
        {LIBRARY_TYPES.map((t) => <Button key={t} variant="ghost" size="xs" className="px-1" type="button" aria-pressed={filter.types.includes(t)} title={t === 'pages' ? 'HTML files and Artifacts' : FILTER_LABEL[t]} onClick={(e) => typeToggle(t, e.altKey)}>
          <Chip tone={filter.types.includes(t) ? 'neutral' : 'muted'}>
            {FILTER_LABEL[t]}
          </Chip>
        </Button>)}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-meta text-muted-foreground">
        <select aria-label="Repo" value={filter.project} onChange={(e) => onFilter({ ...filter, project: e.target.value })} className="h-6 min-w-0 flex-1 rounded border border-input bg-background text-meta">
          <option value="">All repos</option>
          {[...projects].sort().map((p) => <option key={p} value={p}>
            {p.split('/').pop()}
          </option>)}
        </select>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={filter.hideGone} onChange={(e) => onFilter({ ...filter, hideGone: e.target.checked })} />Hide gone</label>
        <label className="flex items-center gap-1" title="Show Headless Sessions">
          <input type="checkbox" aria-label="Show Headless Sessions" checked={headless} onChange={(e) => onHeadless(e.target.checked)} />
          <CircleSlash aria-hidden className="size-3.5" />
        </label>
      </div>
    </div>
    {error && <Alert title="Couldn't read Library" detail={error} className="mx-2.5 my-3" />}
    {actionError && <Alert title={actionError} className="mx-2.5 my-2" />}
    {install ? <Alert title={install.title} detail={install.detail} className="mx-2.5 my-3">
      <CommandBlock>
        {install.command}
      </CommandBlock>
    </Alert> : <>
      {busy && <Loading label={indexing ? 'Indexing Transcripts…' : 'Loading…'} className={cn('items-center px-4 py-3', results && 'absolute right-2 bottom-2 z-10 rounded-md bg-sidebar')} />}
      <div ref={scroll} onScroll={() => { const el = scroll.current; if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 200) load.current(); }} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {!busy && !error && results && items.length === 0 && !moreBusy && !last?.hasMore && <EmptyState role="status" title={results.pages[0]?.unfilteredEmpty ? 'Nothing produced yet' : q ? `Nothing matches “${q}”` : 'Nothing matches'} hint={hidden ? `${hidden} gone Outputs are hidden. Turn off Hide gone to show them.` : undefined} />}
        <div ref={list} role="listbox" aria-label="Outputs" tabIndex={0} aria-activedescendant={items[index] ? `library-${encodeURIComponent(key(items[index]!))}` : undefined} className="outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
          <RowSettling value={settling}>
            {items.map((item, n) => <div key={key(item)}>
              {(n === 0 || day(item.updatedAt, now) !== day(items[n - 1]!.updatedAt, now)) && <p className="px-2 py-1.5 text-caption font-medium text-muted-foreground">
                {day(item.updatedAt, now)}
              </p>}
              <OutputRow item={item} now={now} query={q} active={n === index} expanded={expanded === key(item)} sessions={sessions} enabled={!opening && keyboardEnabled} onSession={(s) => void session(s)} onRow={(e) => { settle(e); setActive(key(item)); setExpanded(key(item)); list.current?.focus(); }} onHover={(on) => setHovered(on ? key(item) : null)} register={(a) => { if (a) actions.current.set(key(item), a); else actions.current.delete(key(item)); }} />
            </div>)}
          </RowSettling>
        </div>
        {moreBusy && <Loading label={indexing ? 'Indexing Transcripts…' : 'Loading more…'} className="items-center py-2" />}
      </div>
    </>}
  </section>;
}

/** Literal hits (LIB-2.4), marked by the same folding the server searched with; no regex or HTML from the query. */
function Hit({ text, query }: { text: string; query: string }) {
  const hits = libraryMatches(text, query);
  if (!hits.length) return text;
  const parts = []; let at = 0;
  for (const [from, to] of hits) {
    parts.push(text.slice(at, from), <mark key={from} className="rounded-sm bg-highlight px-0.5 text-foreground">
      {text.slice(from, to)}
    </mark>); at = to;
  }
  parts.push(text.slice(at)); return parts;
}
interface RowProps {
  item: OutputItem; now: number; query: string; active: boolean; expanded: boolean; sessions: ReadonlyMap<string, SessionRow>; enabled: boolean;
  onSession(s: OutputSession): void; onRow(e: { detail: number }): void; onHover(on: boolean): void; register(actions: Actions | null): void;
}
function OutputRow({ item, now, query, active, expanded, sessions, enabled, onSession, onRow, onHover, register }: RowProps) {
  const copy = useCopy(item.kind === 'file' ? item.path! : item.url!);
  const sorted = [...item.sessions].sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
  const open = () => { if (enabled) openOutput(item); }, openSession = () => { if (enabled && sorted[0] && !sorted[0].pruned) onSession(sorted[0]); };
  useEffect(() => { register({ open, copy: () => { if (enabled) void copy.copy(); }, session: openSession }); return () => register(null); });
  const t = item.kind === 'file' ? item.type! : item.kind, Icon = OUTPUT_ICON[t], id = `library-${encodeURIComponent(key(item))}`;
  const gone = item.kind === 'file' && !item.exists, live = sorted.some((s) => isLive(s, sessions));
  const age = formatAge(now - item.updatedAt);
  return <div id={id} role="option" aria-selected={active} aria-expanded={expanded} aria-label={[item.title, TYPE_LABEL[t], item.repo, age, item.display, gone && 'gone', live && 'live'].filter(Boolean).join(' ')} aria-describedby={`${id}-keys${expanded ? ` ${id}-details` : ''}`} onClick={onRow} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} className={cn('flex min-w-0 cursor-default flex-col gap-0.5 rounded-md px-2 py-1.5 text-body hover:bg-sidebar-accent/60', active && 'bg-sidebar-accent')}>
    <span id={`${id}-keys`} aria-hidden className="sr-only">O opens it, C copies its link, S opens its Session</span>
    <div className="flex min-w-0 items-center gap-1.5">
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-medium" data-field="title">
        <Hit text={item.title} query={query} />
      </span>
      {gone && <Chip>gone</Chip>}{live && <Chip>live</Chip>}
    </div>
    <p className="truncate pl-5 text-meta text-muted-foreground">
      {[TYPE_LABEL[t], item.repo, age, item.version ? `v${item.version}` : null].filter(Boolean).join(' · ')}
    </p>
    <p className={cn('pl-5 text-meta text-muted-foreground', expanded ? 'break-all' : 'truncate')}>
      <Hit text={item.display} query={query} />
    </p>
    <span role="status" aria-live="polite" className={expanded || !copy.said ? 'sr-only' : 'pl-5 text-meta text-muted-foreground'}>
      {copy.said}
    </span>
    {expanded && <div id={`${id}-details`} className="mt-1 flex min-w-0 flex-col gap-1.5 pl-5 text-meta text-muted-foreground">
      <p className="break-all">
        {item.path ?? item.url}
      </p>
      <p>
        {stamp(item.createdAt)} · updated {stamp(item.updatedAt)} · {item.events} times</p>
      {(item.sourceDisplay || item.source) && <p className="break-all">from <Hit text={item.sourceDisplay ?? item.source!.display} query={query} />
      </p>}
      {item.source && <p>edited {stamp(item.source.updatedAt)}{item.source.updatedAt > item.updatedAt ? ', newer than published' : ''}
      </p>}
      {gone && <p>This file no longer exists.</p>}
      <RowActions>
        {!gone && <RowAction label="Open" icon={<ExternalLink />} tip="Open (O)" enabled={enabled} onPress={open} />}
        {item.kind === 'artifact' && item.source?.exists && <RowAction label="Open file" icon={<ExternalLink />} tip="Open file" enabled={enabled} onPress={() => openFile(item.source!.path, item.source!.type)} />}
        <RowAction label={copy.said || 'Copy link'} icon={<Copy />} tip="Copy link (C)" enabled={enabled} onPress={() => void copy.copy()} />
        <AddToTopicAction members={outputSessionMembers(item.sessions)} label={item.title} enabled={enabled} />
      </RowActions>
      <TopicChips members={outputSessionMembers(item.sessions)} />
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {sorted.slice(0, 8).map((s, n) => {
          if (s.pruned) return <span key={`${s.harness}:${s.sessionId}`} title="removed from tb-session's index">
            {s.sessionId.slice(0, 8)}
          </span>;
          const listed = isLive(s, sessions) ? sessions.get(s.sessionId) : null;
          const label = listed ? 'Open' : s.blocked ? 'Show' : 'Resume';
          return <RowAction key={`${s.harness}:${s.sessionId}`} data-action="session" aria-label={`${label} ${s.title}, ${listed ? STATUS_LABEL[listed.status] : 'past'}`} label={s.title} icon={<HarnessIcon harness={s.harness} />} trailing={<SessionMarker aria-hidden="true" state={listed ? 'live' : s.blocked ? 'blocked' : 'past'} status={listed?.status} since={listed?.statusSince ?? null} />} tip={`${EVENT[s.event]}${n === 0 ? ' (S)' : ''}${s.blocked && !listed ? ` · ${BLOCK_REASON[s.blocked]}` : ''}`} enabled={enabled} onPress={() => onSession(s)} className="max-w-full font-normal" />;
        })}{sorted.length > 8 && <span>+{sorted.length - 8} older</span>}
      </div>
    </div>}
  </div>;
}
