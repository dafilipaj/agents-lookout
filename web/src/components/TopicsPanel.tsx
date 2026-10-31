import type { OutputItem } from '@shared/library.ts';
import { MAX_TOPIC_NOTES, MAX_TOPIC_TITLE, OUTPUTS_FRESH_MS, type Recommendation, type RecommendationAction, type Topic, type TopicMember, type TopicsView, sortTopics } from '@shared/topics.ts';
import type { SessionRow } from '@shared/types.ts';
import type { WorkSnapshot } from '@shared/work.ts';
import { Archive, ArchiveRestore, ExternalLink, Plus, Search, Trash2, X } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, type ReactNode, type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton, labelledButtonLook } from '@/components/ui/icon-button';
import { Loading } from '@/components/ui/loading';
import { SessionMarker } from '@/components/ui/session-marker';
import { Textarea } from '@/components/ui/textarea';
import type { PanelNav } from '@/lib/right-sidebar';
import { STATUS_LABEL } from '@/lib/sessions';
import { liveRow, looksDone, matchesTopic, memberCounts, prState, taskState, topicMarker } from '@/lib/topics';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';
import { OUTPUT_ICON, TYPE_LABEL, openOutput } from '@/lib/outputs';
import { Markdown } from './Markdown';
import { Recommendations } from './Recommendations';
import { TaskStatusDot } from './TaskStatusDot';
import { Ci, PrIcon } from './WorkPanel';
import { CHIP_TONE } from '@/lib/work';

/** TOPIC-1.2: "Saved" shows this long after notes are saved. */
export const SAVED_MS = 2000;
/** TOPIC-3.4: rendered notes show this many lines until "more". */
const NOTES_LINES = 6;

type SessionMember = Extract<TopicMember, { kind: 'session' }>;

export interface TopicsPanelProps {
  /** TOPIC-8.3: as the server last sent it; null before it did (TOPIC-3.6's Loading). */
  view: TopicsView | null;
  /** The Session sidebar's list, by session id (TOPIC-4.1). */
  sessions: ReadonlyMap<string, SessionRow>;
  /** Work's last read (TOPIC-4.1, TOPIC-4.2, TOPIC-1.5). */
  work: WorkSnapshot | null;
  now: number;
  /** Bumped to move focus into Topics (opening it with `T` or its tab). */
  focusKey: number;
  /** TOPIC-8.1: the one thing the browser keeps: which Topic is selected. */
  selected: string | null;
  onSelect(id: string | null): void;
  /** TOPIC-2.5: a chip asked for this Topic: it's selected and expanded, then `onRevealed` clears the ask. */
  reveal: { id: string; at: number } | null;
  onRevealed(): void;
  createTopic(title: string): Promise<Topic>;
  updateTopic(id: string, patch: { title?: string; notes?: string; state?: Topic['state'] }): Promise<Topic>;
  deleteTopic(id: string): Promise<void>;
  removeMember(topicId: string, member: TopicMember): Promise<void>;
  /** TOPIC-3.4: a Session chip opens a live Session, or resumes a past one (LIB-3.5). */
  onOpenSession(member: SessionMember, live: boolean): Promise<void>;
  /** TOPIC-4.4: no Library read yet: ask for one, as opening the Library does (LIB-2.7). */
  onReadLibrary(): void;
  /** TOPIC-4.4: why the last read `onReadLibrary` asked for failed; null when it didn't. */
  outputsError?: string | null;
  /** TOPIC-9.4: Accept, Dismiss or Other Topic… on a recommendation. */
  recommend(action: RecommendationAction): Promise<unknown>;
  /** TOPIC-9.4: "Other Topic…" opens the Topic picker for this recommendation. */
  onOtherTopic(rec: Recommendation): void;
  /** TOPIC-4.4: "+N more" opens the Library on these Sessions' Outputs. */
  onMoreOutputs(topic: Topic): void;
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
  const { view, sessions, work, now, focusKey, selected, onSelect, reveal, keyboardEnabled, navRef } = props;
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
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
      if (t.state === 'archived') setArchived(true);
      if (!matchesTopic(t, query)) setQuery('');
      setExpanded(t.id);
    }
  }
  useEffect(() => {
    if (!reveal) return;
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
    } else if (!text && !e.repeat && topic && letter === 's') {
      // …and S its first Session chip, as the chip does.
      const first = topic.members.find((m): m is SessionMember => m.kind === 'session' && !(view?.pruned ?? []).includes(`${m.ref.harness}:${m.ref.sessionId}`));
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
            pruned={view.pruned}
            now={now}
            onHeader={() => {
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
  pruned: readonly string[];
  now: number;
  onHeader(): void;
  panel: TopicsPanelProps;
  onProblem(message: string | null): void;
}

/**
 * TOPIC-3.2: one Topic: its marker, title and member counts, and "looks done" (TOPIC-1.5). Expanded
 * (TOPIC-3.4), its title and notes to edit, its members grouped by kind, its Outputs and its buttons.
 */
function TopicItem({ topic, selected, expanded, sessions, work, pruned, now, onHeader, panel, onProblem }: TopicItemProps) {
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
        onClick={onHeader}
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
      {expanded && <TopicDetails topic={topic} sessions={sessions} work={work} pruned={pruned} now={now} panel={panel} onProblem={onProblem} />}
    </div>
  );
}

function TopicDetails({ topic, sessions, work, pruned, now, panel, onProblem }: Omit<TopicItemProps, 'selected' | 'expanded' | 'onHeader'>) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const sessionMembers = topic.members.filter((m): m is SessionMember => m.kind === 'session');
  const prs = topic.members.filter((m) => m.kind === 'pr');
  const tasks = topic.members.filter((m) => m.kind === 'task');
  const act = (p: Promise<unknown>, fallback: string) => {
    onProblem(null);
    p.catch((err: unknown) => onProblem(err instanceof Error ? err.message : fallback));
  };
  const remove = (m: TopicMember) => act(panel.removeMember(topic.id, m), "Couldn't remove it.");
  const removeLabel = (title: string) => `Remove ${title} from ${topic.title}`;
  return (
    <div className="flex min-w-0 flex-col gap-2 px-2 pt-0.5 pb-2 pl-7 text-meta" data-field="details">
      <TitleField topic={topic} save={(title) => panel.updateTopic(topic.id, { title })} onProblem={onProblem} />
      <Notes topic={topic} save={(notes) => panel.updateTopic(topic.id, { notes })} onProblem={onProblem} />
      {sessionMembers.length > 0 && (
        <Group label="Sessions" field="sessions">
          {sessionMembers.map((m) => (
            <SessionChip key={m.key} member={m} row={liveRow(m, sessions)} pruned={pruned.includes(`${m.ref.harness}:${m.ref.sessionId}`)} onOpen={(live) => act(panel.onOpenSession(m, live), "Couldn't open its Session.")} onRemove={() => remove(m)} removeLabel={removeLabel(m.snapshot.title)} />
          ))}
        </Group>
      )}
      {prs.length > 0 && (
        <Group label="PRs" field="prs" column>
          {prs.map((m) => {
            if (m.kind !== 'pr') return null;
            const s = prState(m.ref.url, work);
            const pr = s.state === 'listed' ? s.pr : null;
            const title = pr?.title ?? m.snapshot.title;
            return (
              <MemberLine key={m.key} field="pr" removeLabel={removeLabel(`#${m.snapshot.number}`)} onRemove={() => remove(m)} open={{ label: 'Open on GitHub', onPress: () => openInBrowser(m.ref.url) }}>
                <PrIcon chip={pr?.chip ?? null} />
                <span className="shrink-0">{pr?.repo ?? m.snapshot.repo}</span>
                <span className="shrink-0 font-medium text-foreground tabular-nums">#{pr?.number ?? m.snapshot.number}</span>
                {pr?.chip && <Chip tone={CHIP_TONE[pr.chip]}>{pr.chip}</Chip>}
                {pr && <Ci ci={pr.ci} />}
                <State state={s.state} />
                <span className="min-w-0 truncate" title={title}>
                  {title}
                </span>
              </MemberLine>
            );
          })}
        </Group>
      )}
      {tasks.length > 0 && (
        <Group label="Tasks" field="tasks" column>
          {tasks.map((m) => {
            if (m.kind !== 'task') return null;
            const s = taskState(m.ref.id, work);
            const task = s.state === 'listed' ? s.task : null;
            const title = task?.title ?? m.snapshot.title;
            return (
              <MemberLine key={m.key} field="task" removeLabel={removeLabel(title)} onRemove={() => remove(m)} open={m.snapshot.url ? { label: 'Open in Fantastic', onPress: () => openInBrowser(task?.url ?? m.snapshot.url) } : null}>
                <TaskStatusDot color={task?.statusColor ?? null} milestone={task?.milestone ?? false} />
                <span className="min-w-0 truncate text-foreground" title={title}>
                  {title}
                </span>
                {task?.status && <span className="shrink-0">· {task.status}</span>}
                <State state={s.state} />
              </MemberLine>
            );
          })}
        </Group>
      )}
      {(() => {
        // TOPIC-3.4: its own pending recommendations, repeated here.
        const own = panel.view?.recommendations.filter((r) => r.topicId === topic.id) ?? [];
        return own.length > 0 ? (
          <div className="flex min-w-0 flex-col gap-1 text-muted-foreground" data-field="topic-recommended">
            <span>Recommended</span>
            <Recommendations label={`Recommended for ${topic.title}`} recommendations={own} topics={[topic]} sessions={sessions} showTopic={false} recommend={panel.recommend} onOtherTopic={panel.onOtherTopic} onProblem={onProblem} />
          </div>
        ) : null;
      })()}
      {sessionMembers.length > 0 && <Outputs topic={topic} now={now} readAt={panel.view?.libraryReadAt ?? null} error={panel.outputsError ?? null} onRead={panel.onReadLibrary} onMore={() => panel.onMoreOutputs(topic)} />}
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2" data-field="actions">
        <button type="button" className={labelledButtonLook()} data-action="archive" onClick={() => act(panel.updateTopic(topic.id, { state: topic.state === 'open' ? 'archived' : 'open' }), "Couldn't change it.")}>
          {topic.state === 'open' ? <Archive /> : <ArchiveRestore />}
          {topic.state === 'open' ? 'Archive' : 'Unarchive'}
        </button>
        <button type="button" className={labelledButtonLook()} data-action="delete" onClick={() => setConfirming(true)}>
          <Trash2 />
          Delete
        </button>
      </div>
      <Dialog open={confirming} onOpenChange={(next) => !deleting && setConfirming(next)}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogTitle className="text-title">Delete “{topic.title}”?</DialogTitle>
          <DialogDescription className="text-body leading-5">Its notes and the list of what's in it go. No Session, PR, Task or Output is changed, closed or deleted.</DialogDescription>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={() => {
                setDeleting(true);
                onProblem(null);
                panel
                  .deleteTopic(topic.id)
                  .catch((err: unknown) => onProblem(err instanceof Error ? err.message : "Couldn't delete it."))
                  .finally(() => {
                    setDeleting(false);
                    setConfirming(false);
                  });
              }}
            >
              {deleting ? 'Deleting…' : 'Delete Topic'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** TOPIC-1.2: the title, edited in place: Enter or leaving saves it, Esc puts it back. */
function TitleField({ topic, save, onProblem }: { topic: Topic; save(title: string): Promise<unknown>; onProblem(m: string | null): void }) {
  const [value, setValue] = useState(topic.title);
  const [editing, setEditing] = useState(false);
  if (!editing && value !== topic.title) setValue(topic.title);
  const commit = () => {
    setEditing(false);
    const next = value.trim();
    if (!next) {
      setValue(topic.title);
      return onProblem('A Topic needs a title.');
    }
    if (next === topic.title) return;
    onProblem(null);
    save(next).catch((err: unknown) => {
      setValue(topic.title);
      onProblem(err instanceof Error ? err.message : "Couldn't rename it.");
    });
  };
  return (
    <input
      aria-label="Topic title"
      value={value}
      maxLength={MAX_TOPIC_TITLE}
      onFocus={() => setEditing(true)}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setValue(topic.title);
          setEditing(false);
          const input = e.currentTarget;
          setTimeout(() => input.blur(), 0);
        }
      }}
      className="h-7 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 -ml-1.5 text-body font-medium text-foreground outline-none hover:border-input focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      data-field="title-input"
    />
  );
}

/**
 * TOPIC-1.2, TOPIC-3.4: the notes, rendered with the chat's Markdown (the first six lines, then
 * "more"); "Edit" switches to a text area, saved on leaving it or ⌘Enter, "Saved" for 2 s; Esc cancels.
 */
function Notes({ topic, save, onProblem }: { topic: Topic; save(notes: string): Promise<unknown>; onProblem(m: string | null): void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(topic.notes);
  const [more, setMore] = useState(false);
  const [saved, setSaved] = useState(false);
  const cancelled = useRef(false);
  // ⌘Enter and Esc leave the text area from the keyboard: focus goes to Edit, not the page, so the
  // panel's keys keep working.
  const editButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    editButton.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), SAVED_MS);
    return () => clearTimeout(timer);
  }, [saved]);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    setEditing(false);
    if (draft === topic.notes) return;
    onProblem(null);
    save(draft).then(
      () => setSaved(true),
      (err: unknown) => {
        setEditing(true);
        onProblem(err instanceof Error ? err.message : "Couldn't save the notes.");
      },
    );
  };
  const lines = topic.notes.split('\n');
  const long = lines.length > NOTES_LINES;
  return (
    <div className="flex min-w-0 flex-col gap-1" data-field="notes">
      {editing ? (
        <Textarea
          autoFocus
          aria-label="Notes"
          value={draft}
          maxLength={MAX_TOPIC_NOTES}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.metaKey) {
              e.preventDefault();
              refocus.current = true;
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              refocus.current = true;
              cancelled.current = true;
              setDraft(topic.notes);
              setEditing(false);
            }
          }}
          className="max-h-80 min-h-20 px-2 py-1.5 text-body"
        />
      ) : topic.notes ? (
        <div className="min-w-0 text-body text-foreground" data-field="notes-text">
          <Markdown text={more || !long ? topic.notes : lines.slice(0, NOTES_LINES).join('\n')} />
        </div>
      ) : null}
      {!editing && (
        <div className="flex items-center gap-2 text-muted-foreground">
          {long && (
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => setMore(!more)}>
              {more ? 'less' : 'more'}
            </button>
          )}
          <button
            ref={editButton}
            type="button"
            className="underline-offset-2 hover:underline"
            onClick={() => {
              // An Esc that unmounted the text area left no blur behind to clear it.
              cancelled.current = false;
              setDraft(topic.notes);
              setEditing(true);
            }}
          >
            {topic.notes ? 'Edit' : 'Add notes'}
          </button>
          {saved && (
            <span role="status" data-field="saved">
              Saved
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ label, field, column, children }: { label: string; field: string; column?: boolean; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-muted-foreground" data-field={field}>
      <span className="w-14 shrink-0 pt-1">{label}</span>
      <div className={cn('flex min-w-0 flex-1 gap-1', column ? 'flex-col' : 'flex-wrap items-center')}>{children}</div>
    </div>
  );
}

/** TOPIC-4.1, TOPIC-4.2: Work's state for a PR or Task member, or why it isn't there. */
function State({ state }: { state: 'loading' | 'gone' | 'listed' }) {
  if (state === 'loading') return <span className="shrink-0" data-field="member-loading">Loading…</span>;
  if (state === 'gone') {
    return (
      <Chip tone="info" title="Work lists open items only, so this may be merged, closed or not read yet." data-field="not-in-work">
        not in Work
      </Chip>
    );
  }
  return null;
}

/** A PR or Task member: its line, then its button and Remove. */
function MemberLine({ field, children, open, onRemove, removeLabel }: { field: string; children: ReactNode; open: { label: string; onPress(): void } | null; onRemove(): void; removeLabel: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 py-0.5" data-field={field}>
      <div className="flex min-w-0 items-center gap-1">{children}</div>
      <div className="flex items-center gap-1.5">
        {open && (
          <button type="button" className={cn(labelledButtonLook(), 'h-6 text-meta [&>svg]:size-3.5')} onClick={open.onPress}>
            <ExternalLink />
            {open.label}
          </button>
        )}
        <IconButton label={removeLabel} tip="Remove from this Topic" onClick={onRemove}>
          <X />
        </IconButton>
      </div>
    </div>
  );
}

/**
 * TOPIC-3.4: a Session member as WORK-4.10's chip: its Harness, title and Status marker; Open, Resume
 * by what it is (LIB-3.5). TOPIC-4.2: one tb-session no longer has shows its snapshot and no button.
 */
function SessionChip({ member, row, pruned, onOpen, onRemove, removeLabel }: { member: SessionMember; row: SessionRow | null; pruned: boolean; onOpen(live: boolean): void; onRemove(): void; removeLabel: string }) {
  const title = row?.title ?? member.snapshot.title;
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-0.5" data-field="session" data-session-id={member.ref.sessionId}>
      {pruned && !row ? (
        <span className="inline-flex min-w-0 items-center gap-1 px-1" title={member.snapshot.directory ?? undefined}>
          <HarnessIcon harness={member.ref.harness} className="size-3.5" />
          <span className="truncate">{title}</span>
          <span className="shrink-0">· removed from the index</span>
        </span>
      ) : (
        <button
          type="button"
          aria-label={`${row ? 'Open' : 'Resume'} ${title}, ${row ? STATUS_LABEL[row.status] : 'past'}`}
          title={member.snapshot.directory ?? undefined}
          onClick={() => onOpen(row !== null)}
          className={cn(labelledButtonLook(), 'max-w-full font-normal')}
        >
          <HarnessIcon harness={member.ref.harness} />
          <span className="min-w-0 truncate">{title}</span>
          <SessionMarker aria-hidden state={row ? 'live' : 'past'} status={row?.status} since={row?.statusSince ?? null} />
        </button>
      )}
      <IconButton label={removeLabel} tip="Remove from this Topic" onClick={onRemove}>
        <X />
      </IconButton>
    </span>
  );
}

/**
 * TOPIC-4.4: the Outputs the Topic's Sessions touched, from the Library's last read, newest first, at
 * most 10, then "+N more". Before any read, it asks for one, as opening the Library does.
 */
function Outputs({ topic, now, readAt, error, onRead, onMore }: { topic: Topic; now: number; readAt: number | null; error: string | null; onRead(): void; onMore(): void }) {
  // Once per expansion: a Topic expanded asks for a read when the Library hasn't read in the last
  // minute, so Outputs its Sessions wrote since show without opening the Library.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    if (readAt === null || Date.now() - readAt >= OUTPUTS_FRESH_MS) onRead();
  }, [readAt, onRead]);
  if (topic.outputs === null) {
    return (
      <Group label="Outputs" field="outputs">
        {error ? <span data-field="outputs-error">{error}</span> : <Loading label="Reading the Library…" />}
      </Group>
    );
  }
  if (topic.outputs.total === 0) return null;
  const more = topic.outputs.total - topic.outputs.items.length;
  return (
    <Group label="Outputs" field="outputs" column>
      {topic.outputs.items.map((item) => (
        <OutputLine key={`${item.kind}:${item.key}`} item={item} now={now} />
      ))}
      {more > 0 && (
        <button type="button" className="self-start underline-offset-2 hover:underline" onClick={onMore} data-field="more-outputs">
          +{more} more
        </button>
      )}
    </Group>
  );
}

/** A Library row's first line with its Open button (LIB-3.3). */
function OutputLine({ item, now }: { item: OutputItem; now: number }) {
  const t = item.kind === 'file' ? item.type! : item.kind;
  const Icon = OUTPUT_ICON[t];
  const gone = item.kind === 'file' && !item.exists;
  return (
    <div className="flex min-w-0 items-center gap-1.5" data-field="output">
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-foreground" title={item.display}>
        {item.title}
      </span>
      <span className="shrink-0">{formatAge(now - item.updatedAt)}</span>
      {gone ? (
        <Chip>gone</Chip>
      ) : (
        <button type="button" className={cn(labelledButtonLook(), 'h-6 text-meta [&>svg]:size-3.5')} aria-label={`Open ${item.title}, ${TYPE_LABEL[t]}`} onClick={() => openOutput(item)}>
          <ExternalLink />
          Open
        </button>
      )}
    </div>
  );
}
