import type { OutputItem } from '@shared/library.ts';
import { MAX_TOPIC_NOTES, MAX_TOPIC_TITLE, OUTPUTS_FRESH_MS, type Recommendation, type RecommendationAction, type SummaryCite, type SummaryPoint, type Topic, type TopicMember, type TopicSummary, type TopicsView, formatCost, modelName } from '@shared/topics.ts';
import type { SessionRow } from '@shared/types.ts';
import type { WorkSnapshot } from '@shared/work.ts';
import { Archive, ArchiveRestore, ArrowLeft, ArrowLeftRight, ArrowRight, ExternalLink, Link2, Maximize2, Network, RefreshCw, Repeat2, Sparkles, Trash2, Unlink, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { CommandBlock } from '@/components/ui/command-block';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton, labelledButtonLook } from '@/components/ui/icon-button';
import { Loading } from '@/components/ui/loading';
import { SessionMarker } from '@/components/ui/session-marker';
import { Textarea } from '@/components/ui/textarea';
import { STATUS_LABEL } from '@/lib/sessions';
import { SUMMARY_STATE_WORD, edgesOf, liveRow, looksDone, memberCounts, orderSessions, orderWorkMembers, prState, sharedLabel, sharedPairs, taskState, topicMarker } from '@/lib/topics';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';
import { OUTPUT_ICON, TYPE_LABEL, openOutput } from '@/lib/outputs';
import { Markdown } from './Markdown';
import { Recommendations } from './Recommendations';
import { PlainView } from './Shell';
import { TaskStatusDot } from './TaskStatusDot';
import { Ci, PrIcon } from './WorkPanel';
import { CHIP_TONE } from '@/lib/work';

/** TOPIC-1.2: "Saved" shows this long after notes are saved. */
export const SAVED_MS = 2000;

export type SessionMember = Extract<TopicMember, { kind: 'session' }>;

export interface TopicViewProps {
  /** The route's Topic id. */
  id: string;
  /** TOPIC-8.3: as the server last sent it; null before it did. */
  view: TopicsView | null;
  /** The Session sidebar's list, by session id (TOPIC-4.1). */
  sessions: ReadonlyMap<string, SessionRow>;
  /** Work's last read (TOPIC-4.1, TOPIC-4.2, TOPIC-1.5). */
  work: WorkSnapshot | null;
  now: number;
  updateTopic(id: string, patch: { title?: string; notes?: string; state?: Topic['state'] }): Promise<Topic>;
  deleteTopic(id: string): Promise<void>;
  removeMember(topicId: string, member: TopicMember): Promise<void>;
  /** TOPIC-3.4: a Session chip opens a live Session, or resumes a past one (LIB-3.5). */
  onOpenSession(member: SessionMember, live: boolean): Promise<void>;
  /** TOPIC-4.4: ask for a Library read, as opening the Library does (LIB-2.7). */
  onReadLibrary(): void;
  /** TOPIC-4.4: why the last read `onReadLibrary` asked for failed; null when it didn't. */
  outputsError?: string | null;
  /** TOPIC-9.4: Accept, Dismiss or Other Topic… on a recommendation. */
  recommend(action: RecommendationAction): Promise<unknown>;
  onOtherTopic(rec: Recommendation): void;
  /** TOPIC-4.4: "+N more" opens the Library on these Sessions' Outputs. */
  onMoreOutputs(topic: Topic): void;
  /** TOPIC-7.1: "Open graph"; also where Delete lands (TOPIC-10.2). */
  onOpenGraph(): void;
  /** TOPIC-6.1: "Link to Topic…" opens the Topic picker for this Topic. */
  onLinkTo(topic: Topic): void;
  /** TOPIC-6.3: "Link" on a shared-member line. */
  linkTopics(from: string, to: string, label: string | null): Promise<void>;
  /** TOPIC-6.2: "Reverse". */
  editEdge(topicId: string, edit: { other: string; reverse: true }): Promise<void>;
  /** TOPIC-6.2: "Unlink". */
  unlinkTopics(topicId: string, other: string): Promise<void>;
  /** TOPIC-11.1: "Summarize" and "Summarize again". */
  summarize(topicId: string): Promise<void>;
  /** TOPIC-11.6: "Cancel". */
  cancelSummary(topicId: string): Promise<void>;
}

const openInBrowser = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/**
 * TOPIC-10: one Topic, whole, in the main pane at `/topics/<id>`: its header with the Topic's
 * buttons, its notes in full, its members by kind with their state, then its recommendations,
 * Outputs and Edges. Drawn from the `topics` event and the browser's joins; it reads nothing new.
 */
export function TopicView(props: TopicViewProps) {
  const { id, view, sessions, work } = props;
  const [problem, setProblem] = useState<string | null>(null);
  const topic = view?.state === 'ok' ? view.topics.find((t) => t.id === id) : undefined;

  if (!view || view.state === 'error' || !topic) {
    let body: ReactNode;
    if (!view) body = <Loading label="Loading…" className="items-center px-4 py-8 text-center" />;
    else if (view.state === 'error') body = <Alert title="Topics can't be opened" detail={`${view.reason ?? ''} ${view.path}`.trim()} className="m-5" data-field="topics-error" />;
    else {
      body = (
        <EmptyState
          role="status"
          title="This Topic is gone"
          hint="It was deleted, or its link is wrong."
          action={
            <Button variant="outline" size="sm" onClick={props.onOpenGraph}>
              <Network />
              Open graph
            </Button>
          }
        />
      );
    }
    return (
      <PlainView aria-label="Topic" header={<h1 className="text-title font-semibold tracking-tight">Topic</h1>}>
        {body}
      </PlainView>
    );
  }

  const marker = topicMarker(topic, sessions);
  const done = looksDone(topic, work);
  const act = (p: Promise<unknown>, fallback: string) => {
    setProblem(null);
    p.catch((err: unknown) => setProblem(message(err, fallback)));
  };
  return (
    <PlainView
      aria-label={`Topic ${topic.title}`}
      data-testid="topic-view"
      header={
        <>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="inline-flex size-3.5 shrink-0" data-field="marker">
                {marker && <SessionMarker aria-hidden state={marker.state} status={marker.state === 'live' ? marker.status : undefined} since={marker.state === 'live' ? marker.since : null} />}
              </span>
              <TitleField topic={topic} save={(title) => props.updateTopic(topic.id, { title })} onProblem={setProblem} />
              {topic.state === 'archived' && <Chip tone="muted">archived</Chip>}
              {done && (
                <Chip tone="info" title="Every PR and Task in it has left Work. Archive it when you're done." data-field="looks-done">
                  looks done
                </Chip>
              )}
            </div>
            <span className="truncate pl-5 text-meta text-muted-foreground" data-field="counts">
              {memberCounts(topic.members)}
            </span>
          </div>
          <TopicActions topic={topic} look="header" onOpenGraph={props.onOpenGraph} onLinkTo={props.onLinkTo} updateTopic={props.updateTopic} deleteTopic={props.deleteTopic} onDeleted={props.onOpenGraph} onProblem={setProblem} />
        </>
      }
    >
      <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-5 px-8 py-6 text-body">
        {problem && <Alert title={problem} data-field="topic-problem" />}
        <Summary topic={topic} {...props} act={act} />
        <Notes topic={topic} save={(notes) => props.updateTopic(topic.id, { notes })} onProblem={setProblem} />
        <Members topic={topic} {...props} act={act} />
        <Extras topic={topic} {...props} act={act} onProblem={setProblem} />
      </div>
    </PlainView>
  );
}

type Act = (p: Promise<unknown>, fallback: string) => void;

/** TOPIC-10.4: Sessions, PRs and Tasks, each headed with its count, live and listed ones first. */
function Members({ topic, sessions, work, view, act, ...props }: TopicViewProps & { topic: Topic; act: Act }) {
  const pruned = view?.pruned ?? [];
  const sessionMembers = orderSessions(topic.members.filter((m): m is SessionMember => m.kind === 'session'), sessions);
  const prs = orderWorkMembers(topic.members.filter((m) => m.kind === 'pr'), work);
  const tasks = orderWorkMembers(topic.members.filter((m) => m.kind === 'task'), work);
  const remove = (m: TopicMember) => act(props.removeMember(topic.id, m), "Couldn't remove it.");
  const removeLabel = (title: string) => `Remove ${title} from ${topic.title}`;
  return (
    <>
      {sessionMembers.length > 0 && (
        <Section label="Sessions" count={sessionMembers.length} field="sessions">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {sessionMembers.map((m) => (
              <SessionChip key={m.key} member={m} row={liveRow(m, sessions)} pruned={pruned.includes(`${m.ref.harness}:${m.ref.sessionId}`)} onOpen={(live) => act(props.onOpenSession(m, live), "Couldn't open its Session.")} onRemove={() => remove(m)} removeLabel={removeLabel(m.snapshot.title)} />
            ))}
          </div>
        </Section>
      )}
      {prs.length > 0 && (
        <Section label="PRs" count={prs.length} field="prs">
          {prs.map((m) => {
            if (m.kind !== 'pr') return null;
            const s = prState(m.ref.url, work);
            const pr = s.state === 'listed' ? s.pr : null;
            const title = pr?.title ?? m.snapshot.title;
            return (
              <MemberLine key={m.key} field="pr" removeLabel={removeLabel(`#${m.snapshot.number}`)} onRemove={() => remove(m)} open={{ label: 'Open on GitHub', onPress: () => openInBrowser(m.ref.url) }}>
                <PrIcon chip={pr?.chip ?? null} />
                <span className="shrink-0 text-muted-foreground">{pr?.repo ?? m.snapshot.repo}</span>
                <span className="shrink-0 font-medium tabular-nums">#{pr?.number ?? m.snapshot.number}</span>
                {pr?.chip && <Chip tone={CHIP_TONE[pr.chip]}>{pr.chip}</Chip>}
                {pr && <Ci ci={pr.ci} />}
                <State state={s.state} />
                <span className="min-w-0 truncate" title={title} data-field="member-title">
                  {title}
                </span>
              </MemberLine>
            );
          })}
        </Section>
      )}
      {tasks.length > 0 && (
        <Section label="Tasks" count={tasks.length} field="tasks">
          {tasks.map((m) => {
            if (m.kind !== 'task') return null;
            const s = taskState(m.ref.id, work);
            const task = s.state === 'listed' ? s.task : null;
            const title = task?.title ?? m.snapshot.title;
            return (
              <MemberLine key={m.key} field="task" removeLabel={removeLabel(title)} onRemove={() => remove(m)} open={m.snapshot.url ? { label: 'Open in Fantastic', onPress: () => openInBrowser(task?.url ?? m.snapshot.url) } : null}>
                <TaskStatusDot color={task?.statusColor ?? null} milestone={task?.milestone ?? false} />
                <span className="min-w-0 truncate" title={title} data-field="member-title">
                  {title}
                </span>
                {task?.status && <span className="shrink-0 text-muted-foreground">· {task.status}</span>}
                <State state={s.state} />
              </MemberLine>
            );
          })}
        </Section>
      )}
    </>
  );
}

/**
 * TOPIC-11: the Topic's summary, between the header and the notes: written only when asked, "Out of
 * date" once a member or the notes changed, "Summarizing…" with Cancel while a run writes it, and why
 * the last run failed. Each point's cited members show by name, and a click does what their chip or
 * line does.
 */
function Summary({ topic, view, sessions, now, act, ...props }: TopicViewProps & { topic: Topic; act: Act }) {
  const running = view?.summarizing.includes(topic.id) ?? false;
  const error = view?.summaryErrors[topic.id] ?? null;
  const summary = topic.summary;
  return (
    <section className="flex min-w-0 flex-col gap-1.5" data-field="summary" aria-label="Summary">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="text-meta font-medium text-muted-foreground">Summary</h2>
        {summary && topic.summaryStale && (
          <Chip tone="info" title="A member was added or removed, or the notes changed, since it was written." data-field="summary-stale">
            Out of date
          </Chip>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {running ? (
            <>
              <Loading label="Summarizing…" />
              <Button variant="outline" size="sm" className="h-7" data-action="cancel-summary" onClick={() => act(props.cancelSummary(topic.id), "Couldn't cancel it.")}>
                <X />
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" className="h-7" data-action="summarize" onClick={() => act(props.summarize(topic.id), "Couldn't start the summary.")}>
              {summary ? <RefreshCw /> : <Sparkles />}
              {summary ? 'Summarize again' : 'Summarize'}
            </Button>
          )}
        </div>
      </div>
      {error && !running && (
        <Alert title="The summary wasn't written" detail={error.reason} data-field="summary-error">
          {error.fix && <CommandBlock>{error.fix}</CommandBlock>}
        </Alert>
      )}
      {summary && <SummaryBody topic={topic} summary={summary} sessions={sessions} pruned={view?.pruned ?? []} now={now} act={act} onOpenSession={props.onOpenSession} />}
    </section>
  );
}

function SummaryBody({ topic, summary, sessions, pruned, now, act, onOpenSession }: { topic: Topic; summary: TopicSummary; sessions: ReadonlyMap<string, SessionRow>; pruned: readonly string[]; now: number; act: Act; onOpenSession: TopicViewProps['onOpenSession'] }) {
  const { answer } = summary;
  const lists: [string, string, SummaryPoint[]][] = [
    ['Open', 'summary-open', answer.open],
    ['Recent', 'summary-recent', answer.recent],
    ['Next', 'summary-next', answer.next],
  ];
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-body">
      <p className="min-w-0" data-field="summary-what">
        {answer.what}
      </p>
      <p className="min-w-0" data-field="summary-state">
        <span className="font-medium">{SUMMARY_STATE_WORD[answer.state]}</span>
        {answer.why && `: ${answer.why}`}
      </p>
      {lists.map(([label, field, points]) =>
        points.length ? (
          <div key={field} className="flex min-w-0 gap-3" data-field={field}>
            <span className="w-14 shrink-0 text-meta leading-5 text-muted-foreground">{label}</span>
            <ul className="flex min-w-0 flex-1 flex-col gap-1">
              {points.map((p, i) => (
                <li key={i} className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1" data-field="summary-point">
                  <span className="min-w-0">{p.text}</span>
                  {p.cites.map((c) => (
                    <Cite key={c.key} cite={c} topic={topic} sessions={sessions} pruned={pruned} act={act} onOpenSession={onOpenSession} />
                  ))}
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      <p className="text-meta text-muted-foreground" data-field="summary-by">
        {[modelName(summary.model), summary.costUsd === null ? null : formatCost(summary.costUsd), `${formatAge(now - summary.writtenAt)} ago`].filter(Boolean).join(' · ')}
      </p>
    </div>
  );
}

/**
 * TOPIC-11.4: a cited member by its chip's or line's name; a click opens its Session, or its PR or
 * Task, as that chip or line does. A member since removed, or a past Session tb-session no longer
 * has (its chip has no button either, TOPIC-4.2), is its name alone.
 */
function Cite({ cite, topic, sessions, pruned, act, onOpenSession }: { cite: SummaryCite; topic: Topic; sessions: ReadonlyMap<string, SessionRow>; pruned: readonly string[]; act: Act; onOpenSession: TopicViewProps['onOpenSession'] }) {
  const m = topic.members.find((x) => x.key === cite.key);
  const look = cn(labelledButtonLook(), 'h-6 max-w-full text-meta font-normal [&>svg]:size-3.5');
  if (!m) {
    return (
      <span className="text-meta text-muted-foreground" title="No longer in this Topic" data-field="summary-cite">
        {cite.name}
      </span>
    );
  }
  if (m.kind === 'session') {
    const row = liveRow(m, sessions);
    const name = row?.title ?? cite.name;
    if (!row && pruned.includes(`${m.ref.harness}:${m.ref.sessionId}`)) {
      return (
        <span className="text-meta text-muted-foreground" title="Removed from the index" data-field="summary-cite">
          {name}
        </span>
      );
    }
    return (
      <button type="button" className={look} aria-label={`${row ? 'Open' : 'Resume'} ${name}`} data-field="summary-cite" onClick={() => act(onOpenSession(m, row !== null), "Couldn't open its Session.")}>
        <HarnessIcon harness={m.ref.harness} />
        <span className="min-w-0 truncate">{name}</span>
      </button>
    );
  }
  const url = m.kind === 'pr' ? m.ref.url : m.kind === 'task' ? m.snapshot.url : '';
  if (!url) return <span className="text-meta text-muted-foreground" data-field="summary-cite">{cite.name}</span>;
  return (
    <button type="button" className={look} aria-label={`${m.kind === 'pr' ? 'Open on GitHub' : 'Open in Fantastic'}: ${cite.name}`} data-field="summary-cite" onClick={() => openInBrowser(url)}>
      {m.kind === 'pr' ? <PrIcon chip={null} /> : <ExternalLink />}
      <span className="min-w-0 truncate">{cite.name}</span>
    </button>
  );
}

/** TOPIC-10.5: its own pending recommendations, its Sessions' Outputs and its Edges. */
function Extras({ topic, view, sessions, now, act, onProblem, ...props }: TopicViewProps & { topic: Topic; act: Act; onProblem(m: string | null): void }) {
  const own = view?.state === 'ok' ? view.recommendations.filter((r) => r.topicId === topic.id) : [];
  const hasSessions = topic.members.some((m) => m.kind === 'session');
  return (
    <>
      {own.length > 0 && (
        <Section label="Recommended" count={own.length} field="topic-recommended">
          <Recommendations label={`Recommended for ${topic.title}`} recommendations={own} topics={[topic]} sessions={sessions} showTopic={false} recommend={props.recommend} onOtherTopic={props.onOtherTopic} onProblem={onProblem} />
        </Section>
      )}
      {hasSessions && <Outputs topic={topic} now={now} readAt={view?.libraryReadAt ?? null} error={props.outputsError ?? null} onRead={props.onReadLibrary} onMore={() => props.onMoreOutputs(topic)} />}
      <Edges topic={topic} view={view} act={act} linkTopics={props.linkTopics} editEdge={props.editEdge} unlinkTopics={props.unlinkTopics} />
    </>
  );
}

function Section({ label, count, field, children }: { label: string; count?: number; field: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5" data-field={field} aria-label={label}>
      <h2 className="flex items-baseline gap-1.5 text-meta font-medium text-muted-foreground">
        {label}
        {count !== undefined && <span className="tabular-nums">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

/**
 * TOPIC-10.2, TOPIC-3.4: a Topic's buttons, in their order: "Open" (the tab only), "Open graph",
 * "Link to Topic…", "Archive" or "Unarchive", "Delete", which asks first, naming the Topic (TOPIC-1.4).
 */
export function TopicActions({
  topic,
  look,
  onOpen,
  onOpenGraph,
  onLinkTo,
  updateTopic,
  deleteTopic,
  onDeleted,
  onProblem,
}: {
  topic: Topic;
  /** `header`: the view's header buttons; `row`: the tab's labelled buttons. */
  look: 'header' | 'row';
  onOpen?(): void;
  onOpenGraph(): void;
  onLinkTo(topic: Topic): void;
  updateTopic(id: string, patch: { state: Topic['state'] }): Promise<unknown>;
  deleteTopic(id: string): Promise<void>;
  onDeleted?(): void;
  onProblem(message: string | null): void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const button = (action: string, onClick: () => void, children: ReactNode) =>
    look === 'header' ? (
      <Button key={action} variant="outline" size="sm" className="h-7" data-action={action} onClick={onClick}>
        {children}
      </Button>
    ) : (
      <button key={action} type="button" className={labelledButtonLook()} data-action={action} onClick={onClick}>
        {children}
      </button>
    );
  const archive = () => {
    onProblem(null);
    updateTopic(topic.id, { state: topic.state === 'open' ? 'archived' : 'open' }).catch((err: unknown) => onProblem(message(err, "Couldn't change it.")));
  };
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-2', look === 'header' ? 'ml-auto justify-end' : 'mt-1')} data-field="actions">
      {onOpen &&
        button(
          'open',
          onOpen,
          <>
            <Maximize2 />
            Open
          </>,
        )}
      {button(
        'open-graph',
        onOpenGraph,
        <>
          <Network />
          Open graph
        </>,
      )}
      {button(
        'link',
        () => onLinkTo(topic),
        <>
          <ArrowLeftRight />
          Link to Topic…
        </>,
      )}
      {button(
        'archive',
        archive,
        <>
          {topic.state === 'open' ? <Archive /> : <ArchiveRestore />}
          {topic.state === 'open' ? 'Archive' : 'Unarchive'}
        </>,
      )}
      {button(
        'delete',
        () => setConfirming(true),
        <>
          <Trash2 />
          Delete
        </>,
      )}
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
                deleteTopic(topic.id)
                  .then(() => onDeleted?.())
                  .catch((err: unknown) => onProblem(message(err, "Couldn't delete it.")))
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
      onProblem(message(err, "Couldn't rename it."));
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
      className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 -ml-1.5 text-title font-semibold tracking-tight text-foreground outline-none hover:border-input focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      data-field="title-input"
    />
  );
}

/**
 * TOPIC-1.2, TOPIC-10.3: the notes, rendered in full with the chat's Markdown; "Edit" switches to a
 * text area, saved on leaving it or ⌘Enter, "Saved" for 2 s; Esc cancels.
 */
function Notes({ topic, save, onProblem }: { topic: Topic; save(notes: string): Promise<unknown>; onProblem(m: string | null): void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(topic.notes);
  const [saved, setSaved] = useState(false);
  const cancelled = useRef(false);
  // ⌘Enter and Esc leave the text area from the keyboard: focus goes to Edit, not the page.
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
        onProblem(message(err, "Couldn't save the notes."));
      },
    );
  };
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
          className="min-h-32 px-2.5 py-2 text-body"
        />
      ) : topic.notes ? (
        <div className="min-w-0 text-body text-foreground" data-field="notes-text">
          <Markdown text={topic.notes} />
        </div>
      ) : null}
      {!editing && (
        <div className="flex items-center gap-2 text-meta text-muted-foreground">
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

/**
 * TOPIC-6.2: the Topic's Edges, "→ <other> (<label>)" from it and "← <other> (<label>)" to it, each
 * with Reverse and Unlink; TOPIC-6.3: an Open Topic sharing a member with it and not linked shows a
 * dashed "shared: <item>" line with Link, which makes an Edge from this Topic.
 */
function Edges({ topic, view, act, linkTopics, editEdge, unlinkTopics }: { topic: Topic; view: TopicsView | null; act: Act } & Pick<TopicViewProps, 'linkTopics' | 'editEdge' | 'unlinkTopics'>) {
  const topics = view?.topics ?? [];
  const edges = view?.edges ?? [];
  const title = (id: string) => topics.find((t) => t.id === id)?.title ?? 'a Topic';
  const own = edgesOf(topic.id, edges);
  const others = topics.filter((t) => t.id !== topic.id && t.state === 'open');
  const shared = sharedPairs([topic, ...others], edges).filter((p) => p.a === topic.id);
  if (!own.length && !shared.length) return null;
  return (
    <Section label="Edges" field="edges">
      {own.map(({ edge, other, dir }) => {
        // "→ <other> (<label>)" from this Topic, "← <other> (<label>)" to it.
        const text = `${title(other)}${edge.label ? ` (${edge.label})` : ''}`;
        const Arrow = dir === 'out' ? ArrowRight : ArrowLeft;
        return (
          <div key={`${edge.from}>${edge.to}`} role="group" aria-label={`${dir === 'out' ? 'Edge to' : 'Edge from'} ${text}`} className="flex min-w-0 items-center gap-1.5" data-field="edge" data-dir={dir}>
            <Arrow aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" title={text}>
              {text}
            </span>
            <IconButton label={`Reverse the Edge with ${title(other)}`} tip="Reverse" onClick={() => act(editEdge(topic.id, { other, reverse: true }), "Couldn't reverse it.")}>
              <Repeat2 />
            </IconButton>
            <IconButton label={`Unlink ${title(other)}`} tip="Unlink" onClick={() => act(unlinkTopics(topic.id, other), "Couldn't unlink it.")}>
              <Unlink />
            </IconButton>
          </div>
        );
      })}
      {shared.map((p) => (
        <div key={p.b} className="flex min-w-0 items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-0.5 text-muted-foreground" data-field="shared">
          <span className="min-w-0 flex-1 truncate" title={`${title(p.b)}, ${sharedLabel(p)}`}>
            {title(p.b)} · {sharedLabel(p)}
          </span>
          <button type="button" className={cn(labelledButtonLook(), 'h-6 text-meta [&>svg]:size-3.5')} aria-label={`Link to ${title(p.b)}`} onClick={() => act(linkTopics(topic.id, p.b, null), "Couldn't link them.")}>
            <Link2 />
            Link
          </button>
        </div>
      ))}
    </Section>
  );
}

/** TOPIC-4.1, TOPIC-4.2: Work's state for a PR or Task member, or why it isn't there. */
function State({ state }: { state: 'loading' | 'gone' | 'listed' }) {
  if (state === 'loading')
    return (
      <span className="shrink-0 text-muted-foreground" data-field="member-loading">
        Loading…
      </span>
    );
  if (state === 'gone') {
    return (
      <Chip tone="info" title="Work lists open items only, so this may be merged, closed or not read yet." data-field="not-in-work">
        not in Work
      </Chip>
    );
  }
  return null;
}

/** A PR or Task member: its line, then its button and Remove, on one row at the view's width. */
function MemberLine({ field, children, open, onRemove, removeLabel }: { field: string; children: ReactNode; open: { label: string; onPress(): void } | null; onRemove(): void; removeLabel: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 py-0.5" data-field={field}>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
      {open && (
        <button type="button" className={cn(labelledButtonLook(), 'h-6 shrink-0 text-meta [&>svg]:size-3.5')} onClick={open.onPress}>
          <ExternalLink />
          {open.label}
        </button>
      )}
      <IconButton label={removeLabel} tip="Remove from this Topic" onClick={onRemove}>
        <X />
      </IconButton>
    </div>
  );
}

/**
 * TOPIC-3.4: a Session member as WORK-4.10's chip: its Harness, title and Status marker; Open, Resume
 * by what it is (LIB-3.5). TOPIC-4.2: one tb-session no longer has shows its snapshot and no button.
 * Remove only where the view draws it.
 */
export function SessionChip({ member, row, pruned, onOpen, onRemove, removeLabel }: { member: SessionMember; row: SessionRow | null; pruned: boolean; onOpen(live: boolean): void; onRemove?(): void; removeLabel?: string }) {
  const title = row?.title ?? member.snapshot.title;
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-0.5" data-field="session" data-session-id={member.ref.sessionId}>
      {pruned && !row ? (
        <span className="inline-flex min-w-0 items-center gap-1 px-1 text-muted-foreground" title={member.snapshot.directory ?? undefined}>
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
      {onRemove && (
        <IconButton label={removeLabel ?? 'Remove'} tip="Remove from this Topic" onClick={onRemove}>
          <X />
        </IconButton>
      )}
    </span>
  );
}

/**
 * TOPIC-4.4: the Outputs the Topic's Sessions touched, from the Library's last read, newest first, at
 * most 10, then "+N more". Opening the view asks for a read when none ran in the last minute.
 */
function Outputs({ topic, now, readAt, error, onRead, onMore }: { topic: Topic; now: number; readAt: number | null; error: string | null; onRead(): void; onMore(): void }) {
  // Once per view: when the Library hasn't read in the last minute, so Outputs its Sessions wrote
  // since show without opening the Library.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    if (readAt === null || Date.now() - readAt >= OUTPUTS_FRESH_MS) onRead();
  }, [readAt, onRead]);
  if (topic.outputs === null) {
    return (
      <Section label="Outputs" field="outputs">
        {error ? (
          <span className="text-muted-foreground" data-field="outputs-error">
            {error}
          </span>
        ) : (
          <Loading label="Reading the Library…" />
        )}
      </Section>
    );
  }
  if (topic.outputs.total === 0) return null;
  const more = topic.outputs.total - topic.outputs.items.length;
  return (
    <Section label="Outputs" count={topic.outputs.total} field="outputs">
      {topic.outputs.items.map((item) => (
        <OutputLine key={`${item.kind}:${item.key}`} item={item} now={now} />
      ))}
      {more > 0 && (
        <button type="button" className="self-start text-meta text-muted-foreground underline-offset-2 hover:underline" onClick={onMore} data-field="more-outputs">
          +{more} more
        </button>
      )}
    </Section>
  );
}

/** A Library row's first line with its Open button (LIB-3.3). */
function OutputLine({ item, now }: { item: OutputItem; now: number }) {
  const t = item.kind === 'file' ? item.type! : item.kind;
  const Icon = OUTPUT_ICON[t];
  const gone = item.kind === 'file' && !item.exists;
  return (
    <div className="flex min-w-0 items-center gap-1.5" data-field="output">
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate" title={item.display}>
        {item.title}
      </span>
      <span className="shrink-0 text-meta text-muted-foreground">{formatAge(now - item.updatedAt)}</span>
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
