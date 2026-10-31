import { MAX_TOPIC_TITLE, type Recommendation, type RecommendationAction, type Topic, type TopicsView, sortTopics } from '@shared/topics.ts';
import type { SessionRow } from '@shared/types.ts';
import type { WorkSnapshot } from '@shared/work.ts';
import { Network, Plus, Search } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, type ReactNode, type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Loading } from '@/components/ui/loading';
import { SessionMarker } from '@/components/ui/session-marker';
import type { PanelNav } from '@/lib/right-sidebar';
import { SUMMARY_STATE_WORD, liveRow, looksDone, matchesTopic, memberCounts, orderSessions, topicMarker } from '@/lib/topics';
import { cn } from '@/lib/utils';
import { Markdown } from './Markdown';
import { Recommendations } from './Recommendations';
import { type SessionMember, SessionChip, TopicActions } from './TopicView';

/** TOPIC-3.4: the expanded Topic shows this many lines of its notes. */
const NOTES_LINES = 3;

export interface TopicsPanelProps {
  /** TOPIC-8.3: as the server last sent it; null before it did (TOPIC-3.6's Loading). */
  view: TopicsView | null;
  /** The Session sidebar's list, by session id (TOPIC-4.1). */
  sessions: ReadonlyMap<string, SessionRow>;
  /** Work's last read (TOPIC-4.1, TOPIC-4.2, TOPIC-1.5). */
  work: WorkSnapshot | null;
  /** Bumped to move focus into Topics (opening it with `T` or its tab). */
  focusKey: number;
  /** TOPIC-8.1: the one thing the browser keeps: which Topic is selected. */
  selected: string | null;
  onSelect(id: string | null): void;
  /** TOPIC-7.1: the Topic last picked in the graph; a new object per pick, even of the same Topic. */
  picked?: { id: string } | null;
  /** TOPIC-2.5: a chip asked for this Topic: it's selected and expanded, then `onRevealed` clears the ask. */
  reveal: { id: string; at: number } | null;
  onRevealed(): void;
  createTopic(title: string): Promise<Topic>;
  /** TOPIC-1.3: Archive and Unarchive. */
  updateTopic(id: string, patch: { state: Topic['state'] }): Promise<unknown>;
  deleteTopic(id: string): Promise<void>;
  /** TOPIC-3.4: a Session chip opens a live Session, or resumes a past one (LIB-3.5). */
  onOpenSession(member: SessionMember, live: boolean): Promise<void>;
  /** TOPIC-9.4: Accept, Dismiss or Other Topic… on a recommendation. */
  recommend(action: RecommendationAction): Promise<unknown>;
  /** TOPIC-9.4: "Other Topic…" opens the Topic picker for this recommendation. */
  onOtherTopic(rec: Recommendation): void;
  /** TOPIC-1.3, TOPIC-7.1: the "Archived" toggle, shared with the graph. */
  archived: boolean;
  onArchived(archived: boolean): void;
  /** TOPIC-7.1: "Open graph" or `G`. */
  onOpenGraph(): void;
  /** TOPIC-10.1: "Open", or Enter on an expanded Topic: its view. */
  onOpenTopic(id: string): void;
  /** TOPIC-6.1: "Link to Topic…" opens the Topic picker for this Topic. */
  onLinkTo(topic: Topic): void;
  keyboardEnabled: boolean;
  navRef?: Ref<PanelNav>;
}

function isTextField(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}

const headerId = (id: string) => `topic-${id}`;
const openInBrowser = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

/**
 * TOPIC-3: the Topics tab. A filter, the Archived toggle and New Topic, then the Topics. Select, then
 * act (TOPIC-3.3): a click or Enter on a Topic selects and expands it in place, Esc collapses it, ↑/↓
 * and j/k move without acting. Each Topic's header is a button, and its expanded details hold real
 * controls (the title, the notes, the members' buttons), so they're reached with Tab as well.
 */
export function TopicsPanel(props: TopicsPanelProps) {
  const { view, sessions, work, focusKey, selected, onSelect, reveal, keyboardEnabled, navRef, archived, onArchived: setArchived } = props;
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const all = sortTopics(view?.topics ?? []);
  const shown = all.filter((t) => (archived || t.state === 'open') && matchesTopic(t, query));
  const current = shown.some((t) => t.id === selected) ? selected : (shown[0]?.id ?? null);
  const open = expanded !== null && shown.some((t) => t.id === expanded) ? expanded : null;
  // TOPIC-7.1: a Topic picked in the graph that the filter hides clears the filter, so the tab marks
  // that one and not the first it shows: adjusted while rendering, once per pick.
  const [seenPick, setSeenPick] = useState(props.picked);
  if (props.picked !== seenPick) {
    setSeenPick(props.picked);
    const t = props.picked ? all.find((x) => x.id === props.picked!.id) : undefined;
    if (t && (archived || t.state === 'open') && !matchesTopic(t, query)) setQuery('');
  }

  // Opening Topics focuses the selected Topic, else the filter.
  useEffect(() => {
    const el = current ? document.getElementById(headerId(current)) : null;
    (el ?? filterRef.current)?.focus();
    // Only when Topics is opened, not when the selection moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);
  // TOPIC-2.5: a chip in another tab opens this one on its Topic, Archived or not: adjusted while
  // rendering, once per ask, as React's "storing information from previous renders".
  const [revealed, setRevealed] = useState<TopicsPanelProps['reveal']>(null);
  if (reveal !== revealed) {
    setRevealed(reveal);
    const t = reveal ? (view?.topics ?? []).find((x) => x.id === reveal.id) : undefined;
    if (t) {
      if (!matchesTopic(t, query)) setQuery('');
      setExpanded(t.id);
    }
  }
  useEffect(() => {
    if (!reveal) return;
    // The toggle is the graph's too (TOPIC-7.1), so it's set here rather than while rendering.
    if ((view?.topics ?? []).find((x) => x.id === reveal.id)?.state === 'archived') setArchived(true);
    setTimeout(() => document.getElementById(headerId(reveal.id))?.focus(), 0);
    props.onRevealed();
    // Once per ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);
  useEffect(() => {
    if (open) document.getElementById(headerId(open))?.parentElement?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);

  const select = (id: string, focus: boolean) => {
    onSelect(id);
    if (focus) document.getElementById(headerId(id))?.focus();
    document.getElementById(headerId(id))?.scrollIntoView?.({ block: 'nearest' });
  };
  /** ↑/↓ and j/k: the next or previous Topic, without acting; the one left collapses (TOPIC-3.3). */
  const move = (delta: number) => {
    if (!shown.length) return;
    const at = shown.findIndex((t) => t.id === current);
    const next = shown[Math.max(0, Math.min(shown.length - 1, at + delta))]!.id;
    if (next !== current) setExpanded(null);
    const inList = rootRef.current?.contains(document.activeElement) && document.activeElement?.closest('[role="list"]');
    select(next, !!inList);
  };
  const collapse = () => {
    if (open === null) return false;
    setExpanded(null);
    document.getElementById(headerId(open))?.focus();
    return true;
  };
  useImperativeHandle(navRef, () => ({ move, collapse }));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!keyboardEnabled || e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    const text = isTextField(e.target);
    const topic = shown.find((t) => t.id === current);
    const letter = e.shiftKey ? null : e.key.toLowerCase();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || (!text && (e.key === 'j' || e.key === 'k'))) {
      if (text && e.target !== filterRef.current) return;
      e.preventDefault(); // the Session sidebar's own ↑/↓ and j/k stay put
      move(e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1);
    } else if (e.key === 'Escape' && !text && open !== null) {
      e.preventDefault();
      collapse();
    } else if (e.key === 'Enter' && e.target === filterRef.current && topic) {
      e.preventDefault();
      select(topic.id, true);
      setExpanded(topic.id);
    } else if (!text && !e.repeat && topic && letter === 'o') {
      // TOPIC UX, Shortcuts: O opens the selected Topic's first PR or Task.
      const first = topic.members.find((m) => m.kind === 'pr' || m.kind === 'task');
      if (!first) return;
      e.preventDefault();
      openInBrowser(first.kind === 'pr' ? first.ref.url : first.kind === 'task' ? first.snapshot.url : '');
    } else if (!text && !e.repeat && letter === 'g' && view?.state === 'ok') {
      // TOPIC-7.1: G, with focus in Topics, the graph.
      e.preventDefault();
      props.onOpenGraph();
    } else if (!text && !e.repeat && topic && letter === 's') {
      // …and S its first Session chip, as the chip does: the summary's first live one (TOPIC-3.4), else the newest past one.
      const pruned = view?.pruned ?? [];
      const first = orderSessions(topic.members.filter((m): m is SessionMember => m.kind === 'session' && !pruned.includes(`${m.ref.harness}:${m.ref.sessionId}`)), sessions)[0];
      if (!first) return;
      e.preventDefault();
      void props.onOpenSession(first, liveRow(first, sessions) !== null).catch((err: unknown) => setProblem(err instanceof Error ? err.message : "Couldn't open its Session."));
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return setProblem('A Topic needs a title.');
    setProblem(null);
    props.createTopic(newTitle).then(
      (t) => {
        setCreating(false);
        setNewTitle('');
        setQuery('');
        onSelect(t.id);
        setExpanded(t.id);
        setTimeout(() => document.getElementById(headerId(t.id))?.focus(), 0);
      },
      (err: unknown) => setProblem(err instanceof Error ? err.message : "Couldn't make the Topic."),
    );
  };
  const newTopic = () => {
    setCreating(true);
    setProblem(null);
  };

  // TOPIC-9.4: at the top, only while something is pending.
  const pending = view?.state === 'ok' ? view.recommendations : [];
  const recommended = pending.length > 0 && (
    <section aria-labelledby="topics-recommended" className="flex flex-col gap-1 border-b border-border px-2.5 pt-1 pb-2 text-meta" data-field="recommended">
      <h3 id="topics-recommended" className="font-medium text-muted-foreground">
        Recommended
      </h3>
      <Recommendations recommendations={pending} topics={all} sessions={sessions} showTopic recommend={props.recommend} onOtherTopic={props.onOtherTopic} onProblem={setProblem} />
    </section>
  );

  let body: ReactNode;
  if (!view) body = <Loading label="Loading…" className="items-center px-4 py-8 text-center" />;
  else if (view.state === 'error') body = null;
  else if (all.length === 0) {
    body = (
      <EmptyState
        role="status"
        title="No Topics yet"
        hint="A Topic gathers the Sessions, PRs and Tasks of one piece of work, with your notes."
        action={
          <Button variant="outline" size="sm" onClick={newTopic}>
            <Plus />
            New Topic
          </Button>
        }
      />
    );
  } else if (shown.length === 0) body = <EmptyState role="status" title="Nothing matches" hint={archived ? undefined : 'Archived Topics are hidden. Turn on Archived to show them.'} />;
  else {
    body = (
      <div role="list" aria-label="Topics" className="flex flex-col gap-px px-1.5 pb-2">
        {shown.map((t) => (
          <TopicItem
            key={t.id}
            topic={t}
            selected={t.id === current}
            expanded={t.id === open}
            sessions={sessions}
            work={work}
            onHeader={(keyboard) => {
              // TOPIC-3.4: Enter on an expanded Topic runs its first button, "Open"; a click only selects.
              if (keyboard && t.id === open) return props.onOpenTopic(t.id);
              select(t.id, false);
              setExpanded(t.id);
            }}
            panel={props}
            onProblem={setProblem}
          />
        ))}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown} data-testid="topics-panel">
      <div className="flex flex-col gap-1.5 px-2.5 pt-2 pb-2">
        <label className="relative flex min-w-0 items-center">
          <Search aria-hidden className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
          <input
            ref={filterRef}
            type="search"
            aria-label="Filter Topics"
            placeholder="Filter Topics"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 w-full min-w-0 rounded-md border border-input bg-background/60 pr-2 pl-7 text-body outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/20"
          />
        </label>
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="outline" size="xs" className="h-7 gap-1.5 px-2 text-meta" onClick={newTopic} disabled={view?.state !== 'ok'}>
            <Plus className="size-3.5" />
            New Topic
          </Button>
          <Button variant="outline" size="xs" className="h-7 gap-1.5 px-2 text-meta" onClick={props.onOpenGraph} disabled={view?.state !== 'ok'} data-action="open-graph">
            <Network className="size-3.5" />
            Open graph
          </Button>
          <label className="ml-auto flex shrink-0 items-center gap-1.5 text-meta text-muted-foreground">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="size-3.5" />
            Archived
          </label>
        </div>
        {creating && (
          <form onSubmit={create} className="flex min-w-0 items-center gap-1.5" data-field="new-topic">
            <input
              autoFocus
              aria-label="New Topic title"
              placeholder="Title"
              maxLength={MAX_TOPIC_TITLE}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setCreating(false);
                  setNewTitle('');
                  setProblem(null);
                }
              }}
              className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-body outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            <Button type="submit" size="xs" className="h-7 px-2 text-meta">
              Make
            </Button>
          </form>
        )}
      </div>
      {view?.state === 'error' && (
        <Alert title="Topics can't be opened" detail={`${view.reason ?? ''} ${view.path}`.trim()} className="mx-2.5 mb-2" data-field="topics-error" />
      )}
      {problem && <Alert title={problem} className="mx-2.5 mb-2" data-field="topics-problem" />}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {recommended}
        {body}
      </div>
    </div>
  );
}

interface TopicItemProps {
  topic: Topic;
  selected: boolean;
  expanded: boolean;
  sessions: ReadonlyMap<string, SessionRow>;
  work: WorkSnapshot | null;
  /** `keyboard`: pressed with Enter or Space, not clicked. */
  onHeader(keyboard: boolean): void;
  panel: TopicsPanelProps;
  onProblem(message: string | null): void;
}

/**
 * TOPIC-3.2: one Topic: its marker, title and member counts, and "looks done" (TOPIC-1.5). Expanded
 * (TOPIC-3.4), its title and notes to edit, its members grouped by kind, its Outputs and its buttons.
 */
function TopicItem({ topic, selected, expanded, sessions, work, onHeader, panel, onProblem }: TopicItemProps) {
  const marker = topicMarker(topic, sessions);
  const done = looksDone(topic, work);
  const counts = memberCounts(topic.members);
  return (
    <div role="listitem" data-topic-id={topic.id} className={cn('flex min-w-0 flex-col rounded-md', selected && 'bg-sidebar-accent')}>
      <button
        id={headerId(topic.id)}
        type="button"
        aria-expanded={expanded}
        aria-current={selected || undefined}
        aria-label={[topic.title, counts, topic.state === 'archived' && 'archived', done && 'looks done'].filter(Boolean).join(', ')}
        // A click from the keyboard has no pointer, so `detail` is 0.
        onClick={(e) => onHeader(e.detail === 0)}
        className="flex min-w-0 cursor-default flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-body outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <span className="inline-flex size-3.5 shrink-0" data-field="marker">
            {marker && <SessionMarker aria-hidden state={marker.state} status={marker.state === 'live' ? marker.status : undefined} since={marker.state === 'live' ? marker.since : null} />}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium" data-field="title">
            {topic.title}
          </span>
          {topic.state === 'archived' && <Chip tone="muted">archived</Chip>}
          {done && (
            <Chip tone="info" title="Every PR and Task in it has left Work. Archive it when you're done." data-field="looks-done">
              looks done
            </Chip>
          )}
        </span>
        <span className="truncate pl-5 text-meta text-muted-foreground" data-field="counts">
          {counts}
        </span>
      </button>
      {expanded && <TopicSummary topic={topic} sessions={sessions} panel={panel} onProblem={onProblem} />}
    </div>
  );
}

/**
 * TOPIC-3.4: an expanded Topic is a summary; the whole Topic is its view (TOPIC-10). The notes' first
 * lines, its live Sessions as chips and how many past ones, then its buttons, "Open" first.
 */
function TopicSummary({ topic, sessions, panel, onProblem }: Omit<TopicItemProps, 'selected' | 'expanded' | 'onHeader' | 'work'>) {
  const sessionMembers = topic.members.filter((m): m is SessionMember => m.kind === 'session');
  const live = orderSessions(sessionMembers, sessions).filter((m) => liveRow(m, sessions) !== null);
  const past = sessionMembers.length - live.length;
  const openSession = (m: SessionMember) => {
    onProblem(null);
    panel.onOpenSession(m, true).catch((err: unknown) => onProblem(err instanceof Error ? err.message : "Couldn't open its Session."));
  };
  const notes = topic.notes.split('\n').slice(0, NOTES_LINES).join('\n').trim();
  const summary = topic.summary?.answer;
  return (
    <div className="flex min-w-0 flex-col gap-2 px-2 pt-0.5 pb-2 pl-7 text-meta" data-field="details">
      {summary && (
        // TOPIC-11.8: the summary's `what` and `state`, above the notes.
        <div className="flex min-w-0 flex-col gap-0.5 text-body text-foreground" data-field="summary">
          <p className="min-w-0">{summary.what}</p>
          <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-meta text-muted-foreground">
            <span>{SUMMARY_STATE_WORD[summary.state]}</span>
            {topic.summaryStale && (
              <Chip tone="info" title="A member was added or removed, or the notes changed, since it was written." data-field="summary-stale">
                Out of date
              </Chip>
            )}
          </p>
        </div>
      )}
      {notes && (
        <div className="min-w-0 text-body text-foreground" data-field="notes-text">
          <Markdown text={notes} />
        </div>
      )}
      {sessionMembers.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-1 text-muted-foreground" data-field="sessions">
          {live.map((m) => (
            <SessionChip key={m.key} member={m} row={liveRow(m, sessions)} pruned={false} onOpen={() => openSession(m)} />
          ))}
          {past > 0 && <span data-field="past-sessions">{live.length ? `+${past} past` : `${past} past ${past === 1 ? 'Session' : 'Sessions'}`}</span>}
        </div>
      )}
      <TopicActions topic={topic} look="row" onOpen={() => panel.onOpenTopic(topic.id)} onOpenGraph={panel.onOpenGraph} onLinkTo={panel.onLinkTo} updateTopic={panel.updateTopic} deleteTopic={panel.deleteTopic} onProblem={onProblem} />
    </div>
  );
}
