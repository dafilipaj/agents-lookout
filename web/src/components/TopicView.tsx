import type { OutputItem } from '@shared/library.ts';
import { ACTIVITY_PAGE, type ActivityEntry, MAX_NEW_SHOWN, MAX_TOPIC_NOTES, MAX_TOPIC_TITLE, OUTPUTS_FRESH_MS, type Recommendation, type RecommendationAction, type SummaryCite, type SummaryPoint, type Topic, type TopicMember, type TopicSummary, type TopicsView, activityWords, formatCost, modelName } from '@shared/topics.ts';
import type { SessionRow } from '@shared/types.ts';
import type { WorkSnapshot } from '@shared/work.ts';
import { Archive, ArchiveRestore, ArrowLeft, ArrowLeftRight, ArrowRight, ExternalLink, Link2, Maximize2, Network, Play, RefreshCw, Repeat2, Sparkles, Trash2, Unlink, X } from 'lucide-react';
import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { CommandBlock } from '@/components/ui/command-block';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton, labelledButtonLook } from '@/components/ui/icon-button';
import { RowActions } from '@/components/ui/row-actions';
import { Loading } from '@/components/ui/loading';
import { SessionMarker } from '@/components/ui/session-marker';
import { Tabs } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { STATUS_LABEL } from '@/lib/sessions';
import { OUTCOME_WORD, SUMMARY_STATE_WORD, edgesOf, liveRow, looksDone, memberCounts, orderSessions, orderWorkMembers, prState, sharedLabel, sharedPairs, taskState, topicMarker } from '@/lib/topics';
import type { TopicTab } from '@/lib/router';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';
import { OUTPUT_ICON, TYPE_LABEL, openOutput } from '@/lib/outputs';
import { type ArchivePatch, ArchiveDialog } from './ArchiveDialog';
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
  /** TOPIC-10.8: the open tab, from the path, and how to open another (replacing the history entry). */
  tab?: TopicTab;
  onTab?(tab: TopicTab): void;
  /** TOPIC-8.3: as the server last sent it; null before it did. */
  view: TopicsView | null;
  /** The Session sidebar's list, by session id (TOPIC-4.1). */
  sessions: ReadonlyMap<string, SessionRow>;
  /** Work's last read (TOPIC-4.1, TOPIC-4.2, TOPIC-1.5). */
  work: WorkSnapshot | null;
  now: number;
  updateTopic(id: string, patch: { title?: string; notes?: string } | { state: 'open' } | ArchivePatch): Promise<Topic>;
  deleteTopic(id: string): Promise<void>;
  removeMember(topicId: string, member: TopicMember): Promise<void>;
  /** TOPIC-12.3: the activity, newest first, before an entry id. */
  topicActivity(topicId: string, before: number | null): Promise<ActivityEntry[]>;
  /** TOPIC-11.10: the earlier summaries, newest first. */
  earlierSummaries(topicId: string): Promise<TopicSummary[]>;
  /** TOPIC-13.1: seen up to that entry; `keepalive` when the page goes away. */
  seenTopic(topicId: string, upto: number, keepalive?: boolean): Promise<void>;
  /** TOPIC-1.6: "superseded by <title>" opens that Topic. */
  onOpenTopic?(id: string): void;
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
  /** TOPIC-5.1: "Start Session": the launcher, pre-filled from the Topic; `opener` gets focus back when it closes. */
  onStartSession?(topic: Topic, opener: HTMLElement | null): void;
}

const openInBrowser = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/**
 * TOPIC-10: one Topic, whole, in the main pane at `/topics/<id>`: its header with the Topic's
 * buttons, then three tabs (TOPIC-10.7): Overview (what's new, the Summary, the notes in full and
 * the Edges), Members (recommendations, members by kind with their state, Outputs) and Activity.
 * Drawn from the `topics` event and the browser's joins; it reads nothing new.
 */
export function TopicView(props: TopicViewProps) {
  const { id, view } = props;
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

  return <OneTopic {...props} topic={topic} problem={problem} setProblem={setProblem} />;
}

/** TOPIC-10, with its activity (TOPIC-12) and what's new since it was last seen (TOPIC-13). */
function OneTopic({ topic, problem, setProblem, ...props }: TopicViewProps & { topic: Topic; problem: string | null; setProblem(m: string | null): void }) {
  const { view, sessions, work } = props;
  const activity = useActivity(topic, props);
  const marker = topicMarker(topic, sessions);
  const done = looksDone(topic, work);
  const act = (p: Promise<unknown>, fallback: string) => {
    setProblem(null);
    p.catch((err: unknown) => setProblem(message(err, fallback)));
  };
  const fresh = new Set(activity.fresh.flatMap((e) => (e.member ? [e.member] : [])));
  const all = view?.state === 'ok' ? view.topics : [];
  // TOPIC-10.7, 13.2: the count is kept while the view is open; it rises with new activity, but
  // another browser marking the Topic seen doesn't take it down to the page loaded here.
  const [keptNew, setKeptNew] = useState(0);
  const newTotal = Math.max(keptNew, topic.newCount, activity.fresh.length);
  if (newTotal !== keptNew) setKeptNew(newTotal);
  const tab = props.tab ?? 'overview';
  // TOPIC-10.8: a switch keeps the scroll, but brings the tab strip into view when it isn't.
  const selectTab = (next: TopicTab) => {
    document.querySelector('[data-testid="topic-view"] [data-slot="tabs"]')?.scrollIntoView?.({ block: 'nearest' });
    props.onTab?.(next);
  };
  // "+N more" and "N changes since" open Activity at its newest entries, and focus its tab: the button pressed is hidden then.
  const showActivity = () => {
    selectTab('activity');
    document.getElementById('tab-topic-view-activity')?.focus();
  };
  const entryProps = { sessions, now: props.now, act, onOpenSession: props.onOpenSession, pruned: view?.pruned ?? [] };
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
              {topic.outcome && (
                <Chip tone="info" data-field="outcome">
                  {OUTCOME_WORD[topic.outcome]}
                </Chip>
              )}
              {done && (
                <Chip tone="info" title="Every PR and Task in it has left Work. Archive it when you're done." data-field="looks-done">
                  looks done
                </Chip>
              )}
            </div>
            <span className="truncate pl-5 text-meta text-muted-foreground" data-field="counts">
              {memberCounts(topic.members)}
            </span>
            <Closing topic={topic} onOpenTopic={all.some((t) => t.id === topic.supersededBy?.id) ? props.onOpenTopic : undefined} />
          </div>
          <TopicActions topic={topic} topics={all} looksDone={done} look="header" onStartSession={props.onStartSession && ((opener) => props.onStartSession!(topic, opener))} onOpenGraph={props.onOpenGraph} onLinkTo={props.onLinkTo} updateTopic={props.updateTopic} deleteTopic={props.deleteTopic} onDeleted={props.onOpenGraph} onProblem={setProblem} />
        </>
      }
    >
      <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-5 px-8 py-6 text-body">
        {problem && <Alert title={problem} data-field="topic-problem" />}
        {/* TOPIC-10.7: three tabs; the ones not shown stay mounted, so a notes edit or Activity's pages survive a switch. */}
        <Tabs
          label="Topic view"
          selected={tab}
          onSelect={selectTab}
          className="-mt-2"
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'members', label: 'Members', count: topic.members.length, ...(topic.members.some((m) => fresh.has(m.key)) ? { dot: <FreshDot />, dotLabel: 'new activity' } : {}) },
            { id: 'activity', label: 'Activity', ...(activity.fresh.length > 0 ? { note: `${newTotal} new` } : {}) },
          ]}
          panels={{
            overview: (
              <>
                {activity.fresh.length > 0 && <SinceLooked topic={topic} entries={activity.fresh} total={newTotal} onMore={showActivity} {...entryProps} />}
                <Summary topic={topic} {...props} act={act} onShowActivity={showActivity} />
                <Notes topic={topic} save={(notes) => props.updateTopic(topic.id, { notes })} onProblem={setProblem} />
                <Edges topic={topic} view={view} act={act} linkTopics={props.linkTopics} editEdge={props.editEdge} unlinkTopics={props.unlinkTopics} />
              </>
            ),
            members: (
              <>
                <OwnRecommendations topic={topic} {...props} onProblem={setProblem} />
                <Members topic={topic} {...props} act={act} fresh={fresh} />
                <TopicOutputs topic={topic} {...props} />
              </>
            ),
            activity: <Activity topic={topic} activity={activity} {...entryProps} />,
          }}
        />
      </div>
    </PlainView>
  );
}

/** TOPIC-1.6: an archived Topic's closing line, and the Topic that superseded it. */
function Closing({ topic, onOpenTopic }: { topic: Topic; onOpenTopic?: ((id: string) => void) | undefined }) {
  if (topic.state !== 'archived' || (!topic.closing && !topic.supersededBy)) return null;
  const by = topic.supersededBy;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 pl-5 text-meta text-muted-foreground" data-field="closing">
      {by &&
        (onOpenTopic ? (
          <button type="button" className={cn(labelledButtonLook(), 'h-6 text-meta font-normal')} data-field="superseded-by" onClick={() => onOpenTopic(by.id)}>
            superseded by {by.title}
          </button>
        ) : (
          <span data-field="superseded-by">superseded by {by.title}</span>
        ))}
      {topic.closing && <span className="min-w-0">{topic.closing}</span>}
    </span>
  );
}

interface ActivityState {
  /** Newest first, as loaded: the newest pages, kept up to date, and older pages "Show more" read. */
  entries: ActivityEntry[];
  /** TOPIC-13.2: entries by Lookout past what was seen when the view opened, newest first. */
  fresh: ActivityEntry[];
  more: boolean;
  /** The first read, and a "Show more" read. */
  loading: boolean;
  paging: boolean;
  error: string | null;
  showMore(): void;
}

/** TOPIC-13.1: the newest entry each view sent as seen, so A, B, A before the server answers doesn't show A's again. */
const sentSeen = new Map<string, number>();

/** Entries by id, newest first, each once. */
function mergeEntries(a: readonly ActivityEntry[], b: readonly ActivityEntry[]): ActivityEntry[] {
  const byId = new Map([...a, ...b].map((e) => [e.id, e]));
  return [...byId.values()].sort((x, y) => y.id - x.id);
}

/**
 * TOPIC-12.3, TOPIC-13: the Topic's activity, read when the view opens and again whenever its newest
 * entry moves, paging back until it meets what it shows so none is skipped; what was new when it
 * opened stays marked while it's open. Leaving marks seen everything it showed (TOPIC-13.1): when it's
 * gone for good (not StrictMode's at-once cleanup) and on `pagehide`.
 */
function useActivity(topic: Topic, props: Pick<TopicViewProps, 'topicActivity' | 'seenTopic'>): ActivityState {
  const [seenAt] = useState(() => Math.max(topic.seenUpto, sentSeen.get(topic.id) ?? 0));
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const newest = useRef(0);
  const shown = useRef(0);
  const { topicActivity, seenTopic } = props;
  const id = topic.id;

  useEffect(() => {
    let live = true;
    const known = newest.current;
    const read = async () => {
      let page = await topicActivity(id, null);
      const got = [...page];
      // More than a page came since the last read: page back until it meets what's shown.
      for (let i = 0; known > 0 && page.length === ACTIVITY_PAGE && page.at(-1)!.id > known + 1 && i < 20; i++) {
        page = await topicActivity(id, page.at(-1)!.id);
        got.push(...page);
      }
      if (!live) return;
      setEntries((old) => mergeEntries(old, got));
      if (known === 0) setMore(page.length === ACTIVITY_PAGE);
      setError(null);
    };
    read()
      .catch((err: unknown) => live && setError(message(err, "Couldn't read the activity.")))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [id, topic.lastEntryId, topicActivity]);

  // The newest entry this view has shown, for the next read and for "seen" when it goes.
  useEffect(() => {
    newest.current = entries[0]?.id ?? 0;
    shown.current = Math.max(shown.current, newest.current);
  }, [entries]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const leave = (keepalive: boolean) => {
      if (shown.current <= 0) return;
      sentSeen.set(id, Math.max(sentSeen.get(id) ?? 0, shown.current));
      seenTopic(id, shown.current, keepalive).catch(() => {});
    };
    const onHide = () => leave(true);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      alive.current = false;
      // StrictMode runs this at once and mounts again: only a view that stays gone marks seen.
      setTimeout(() => {
        if (!alive.current) leave(false);
      }, 0);
    };
  }, [id, seenTopic]);

  const showMore = useCallback(() => {
    const oldest = entries.at(-1)?.id;
    if (oldest === undefined || paging) return;
    setPaging(true);
    topicActivity(id, oldest)
      .then((page) => {
        setEntries((old) => mergeEntries(old, page));
        setMore(page.length === ACTIVITY_PAGE);
      })
      .catch((err: unknown) => setError(message(err, "Couldn't read the activity.")))
      .finally(() => setPaging(false));
  }, [entries, id, paging, topicActivity]);

  const fresh = entries.filter((e) => e.by === 'lookout' && e.id > seenAt);
  return { entries, fresh, more, loading, paging, error, showMore };
}

type EntryProps = { sessions: ReadonlyMap<string, SessionRow>; now: number; act: Act; onOpenSession: TopicViewProps['onOpenSession']; pruned: readonly string[] };

/** TOPIC-12.3: one entry: its time, its words, and its member's name, which acts as its chip does. */
function Entry({ entry, topic, sessions, now, act, onOpenSession, pruned }: EntryProps & { entry: ActivityEntry; topic: Topic }) {
  return (
    <li className="flex min-w-0 items-center gap-2" data-field="activity-entry" data-kind={entry.kind}>
      <time className="w-14 shrink-0 text-meta text-muted-foreground tabular-nums" dateTime={new Date(entry.at).toISOString()} title={new Date(entry.at).toLocaleString()}>
        {formatAge(now - entry.at)}
      </time>
      <span className="min-w-0 truncate">{activityWords(entry)}</span>
      {entry.member && <Cite cite={{ key: entry.member, name: entry.data.name ?? '' }} topic={topic} sessions={sessions} pruned={pruned} act={act} onOpenSession={onOpenSession} />}
    </li>
  );
}

/** TOPIC-13.2: what Lookout recorded since the Topic was last seen, between the header and the Summary. */
function SinceLooked({ topic, entries, total, onMore, ...rest }: EntryProps & { topic: Topic; entries: ActivityEntry[]; total: number; onMore(): void }) {
  const shown = entries.slice(0, MAX_NEW_SHOWN);
  return (
    <section className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border p-3" data-field="since-looked" aria-label="Since you last looked">
      <h2 className="text-meta font-medium text-muted-foreground">Since you last looked</h2>
      <ul className="flex min-w-0 flex-col gap-1">
        {shown.map((e) => (
          <Entry key={e.id} entry={e} topic={topic} {...rest} />
        ))}
      </ul>
      {total > shown.length && (
        <button type="button" className={cn(labelledButtonLook(), 'h-6 self-start text-meta')} data-field="since-more" onClick={onMore}>
          +{total - shown.length} more
        </button>
      )}
    </section>
  );
}

/** TOPIC-12.3: the Topic's activity, newest first, 50 at a time; its tab names it, so no heading. */
function Activity({ topic, activity, ...rest }: EntryProps & { topic: Topic; activity: ActivityState }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-field="activity">
      {activity.error && <Alert title={activity.error} data-field="activity-error" />}
      {activity.entries.length === 0 && activity.loading ? (
        <Loading label="Loading…" />
      ) : (
        <ul className="flex min-w-0 flex-col gap-1">
          {activity.entries.map((e) => (
            <Entry key={e.id} entry={e} topic={topic} {...rest} />
          ))}
        </ul>
      )}
      {activity.more && (
        <Button variant="outline" size="sm" className="h-7 self-start" data-action="activity-more" disabled={activity.paging} onClick={activity.showMore}>
          Show more
        </Button>
      )}
    </div>
  );
}

type Act = (p: Promise<unknown>, fallback: string) => void;

/** TOPIC-10.4: Sessions, PRs and Tasks, each headed with its count, live and listed ones first. */
function Members({ topic, sessions, work, view, act, fresh, ...props }: TopicViewProps & { topic: Topic; act: Act; fresh: ReadonlySet<string> }) {
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
              <SessionChip key={m.key} member={m} row={liveRow(m, sessions)} pruned={pruned.includes(`${m.ref.harness}:${m.ref.sessionId}`)} onOpen={(live) => act(props.onOpenSession(m, live), "Couldn't open its Session.")} onRemove={() => remove(m)} removeLabel={removeLabel(m.snapshot.title)} fresh={fresh.has(m.key)} />
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
              <MemberLine key={m.key} field="pr" fresh={fresh.has(m.key)} removeLabel={removeLabel(`#${m.snapshot.number}`)} onRemove={() => remove(m)} open={{ label: 'Open on GitHub', onPress: () => openInBrowser(m.ref.url) }}>
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
              <MemberLine key={m.key} field="task" fresh={fresh.has(m.key)} removeLabel={removeLabel(title)} onRemove={() => remove(m)} open={m.snapshot.url ? { label: 'Open in Fantastic', onPress: () => openInBrowser(task?.url ?? m.snapshot.url) } : null}>
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
function Summary({ topic, view, sessions, now, act, onShowActivity, ...props }: TopicViewProps & { topic: Topic; act: Act; onShowActivity(): void }) {
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
      {summary && <SummaryBody topic={topic} summary={summary} sessions={sessions} pruned={view?.pruned ?? []} now={now} act={act} onOpenSession={props.onOpenSession} changes={topic.changesSinceSummary} onChanges={onShowActivity} />}
      {topic.earlierSummaries > 0 && <EarlierSummaries topic={topic} count={topic.earlierSummaries} now={now} load={props.earlierSummaries} />}
    </section>
  );
}

/** TOPIC-11.10: the earlier summaries, newest first: each its date, state and `what`, expanding in place, read-only. */
function EarlierSummaries({ topic, count, now, load }: { topic: Topic; count: number; now: number; load: TopicViewProps['earlierSummaries'] }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<TopicSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [whole, setWhole] = useState<number | null>(null);
  const toggle = () => {
    setOpen(!open);
    if (open || list) return;
    load(topic.id)
      .then(setList)
      .catch((err: unknown) => setError(message(err, "Couldn't read the earlier summaries.")));
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-field="earlier-summaries">
      <button type="button" className={cn(labelledButtonLook(), 'h-6 self-start text-meta')} aria-expanded={open} onClick={toggle}>
        Earlier summaries ({count})
      </button>
      {open && error && <Alert title={error} />}
      {open && !list && !error && <Loading label="Loading…" />}
      {open &&
        list?.map((s, i) => (
          <div key={s.writtenAt} className="flex min-w-0 flex-col gap-1 border-l-2 border-border pl-3" data-field="earlier-summary">
            <button type="button" className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-left" aria-expanded={whole === i} onClick={() => setWhole(whole === i ? null : i)}>
              <span className="shrink-0 text-meta text-muted-foreground" title={new Date(s.writtenAt).toLocaleString()}>
                {formatAge(now - s.writtenAt)} ago
              </span>
              <span className="shrink-0 text-meta font-medium">{SUMMARY_STATE_WORD[s.answer.state]}</span>
              <span className="min-w-0">{s.answer.what}</span>
            </button>
            {whole === i && <SummaryBody topic={topic} summary={s} sessions={new Map()} pruned={[]} now={now} act={() => {}} onOpenSession={async () => {}} readOnly />}
          </div>
        ))}
    </div>
  );
}

/**
 * TOPIC-11.4: where the work stands first: `what`, `state` with `why`, then Recent with each point's
 * date, Open with "+N more open", Next with each point's trigger, and Watch out. `readOnly`: an
 * earlier summary (TOPIC-11.10), its citations as names without buttons.
 */
function SummaryBody({ topic, summary, sessions, pruned, now, act, onOpenSession, changes = 0, onChanges, readOnly = false }: { topic: Topic; summary: TopicSummary; sessions: ReadonlyMap<string, SessionRow>; pruned: readonly string[]; now: number; act: Act; onOpenSession: TopicViewProps['onOpenSession']; changes?: number; onChanges?(): void; readOnly?: boolean }) {
  const { answer } = summary;
  const lists: [string, string, SummaryPoint[], ReactNode][] = [
    ['Recent', 'summary-recent', answer.recent, null],
    ['Open', 'summary-open', answer.open, answer.openMore ? <span className="text-meta text-muted-foreground" data-field="summary-open-more">+{answer.openMore} more open</span> : null],
    ['Next', 'summary-next', answer.next, null],
    ['Watch out', 'summary-watch', answer.watch ?? [], null],
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
      {lists.map(([label, field, points, after]) =>
        points.length ? (
          <div key={field} className="flex min-w-0 gap-3" data-field={field}>
            <span className="w-16 shrink-0 text-meta leading-5 text-muted-foreground">{label}</span>
            <ul className="flex min-w-0 flex-1 flex-col gap-1">
              {points.map((p, i) => (
                <li key={i} className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1" data-field="summary-point">
                  {p.at && (
                    <time className="shrink-0 text-meta text-muted-foreground tabular-nums" data-field="summary-at">
                      {p.at}
                    </time>
                  )}
                  <span className="min-w-0">{p.text}</span>
                  {p.when && (
                    <span className="text-meta text-muted-foreground" data-field="summary-when">
                      {/^when\b/i.test(p.when) ? p.when : `when ${p.when}`}
                    </span>
                  )}
                  {p.cites.map((c) =>
                    readOnly ? (
                      <span key={c.key} className="text-meta text-muted-foreground" data-field="summary-cite">
                        {c.name}
                      </span>
                    ) : (
                      <Cite key={c.key} cite={c} topic={topic} sessions={sessions} pruned={pruned} act={act} onOpenSession={onOpenSession} />
                    ),
                  )}
                </li>
              ))}
              {after && <li>{after}</li>}
            </ul>
          </div>
        ) : null,
      )}
      <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-meta text-muted-foreground" data-field="summary-by">
        <span>{[modelName(summary.model), summary.costUsd === null ? null : formatCost(summary.costUsd), `${formatAge(now - summary.writtenAt)} ago`].filter(Boolean).join(' · ')}</span>
        {changes > 0 && (
          <button type="button" className={cn(labelledButtonLook(), 'h-6 text-meta font-normal')} data-field="summary-changes" onClick={onChanges}>
            · {changes} {changes === 1 ? 'change' : 'changes'} since
          </button>
        )}
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
/** TOPIC-10.5: on Members, above the members, its pending recommendations (TOPIC-9.4). */
function OwnRecommendations({ topic, view, sessions, onProblem, ...props }: TopicViewProps & { topic: Topic; onProblem(m: string | null): void }) {
  const own = view?.state === 'ok' ? view.recommendations.filter((r) => r.topicId === topic.id) : [];
  if (own.length === 0) return null;
  return (
    <Section label="Recommended" count={own.length} field="topic-recommended">
      <Recommendations label={`Recommended for ${topic.title}`} recommendations={own} topics={[topic]} sessions={sessions} showTopic={false} recommend={props.recommend} onOtherTopic={props.onOtherTopic} onProblem={onProblem} />
    </Section>
  );
}

/** TOPIC-10.5: on Members, under the members, the Outputs its Sessions touched (TOPIC-4.4). */
function TopicOutputs({ topic, view, now, ...props }: TopicViewProps & { topic: Topic }) {
  if (!topic.members.some((m) => m.kind === 'session')) return null;
  return <Outputs topic={topic} now={now} readAt={view?.libraryReadAt ?? null} error={props.outputsError ?? null} onRead={props.onReadLibrary} onMore={() => props.onMoreOutputs(topic)} />;
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
  onStartSession,
  onOpenGraph,
  onLinkTo,
  updateTopic,
  deleteTopic,
  onDeleted,
  onProblem,
  topics,
  looksDone,
}: {
  topic: Topic;
  /** `header`: the view's header buttons; `row`: the tab's expanded row, Open and "More" (DS-16). */
  look: 'header' | 'row';
  onOpen?(): void;
  /** TOPIC-10.2: "Start Session" goes first (TOPIC-5.1). */
  onStartSession?(opener: HTMLElement | null): void;
  onOpenGraph(): void;
  onLinkTo(topic: Topic): void;
  updateTopic(id: string, patch: { state: 'open' } | ArchivePatch): Promise<unknown>;
  deleteTopic(id: string): Promise<void>;
  onDeleted?(): void;
  onProblem(message: string | null): void;
  /** TOPIC-1.6: the Topics "Superseded by…" picks from, and whether this one looks done (Done is picked). */
  topics: readonly Topic[];
  looksDone: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Archive's and Delete's dialogs have no trigger, so closing one gives focus back to what had it
  // when it opened: the header's button, or the tab's "More" (DS-16.3).
  const [returnTo, setReturnTo] = useState<Element | null>(null);
  const ask = (open: (yes: boolean) => void) => {
    setReturnTo(document.activeElement);
    open(true);
  };
  const giveBack = (e: Event) => {
    const el = returnTo;
    if (el instanceof HTMLElement && el.isConnected && el !== document.body) {
      e.preventDefault();
      el.focus();
    }
  };
  const button = (action: string, onClick: (e: MouseEvent<HTMLButtonElement>) => void, children: ReactNode) => (
    <Button key={action} variant="outline" size="sm" className="h-7" data-action={action} onClick={onClick}>
      {children}
    </Button>
  );
  // TOPIC-1.6: Archive asks how it ended; Unarchive doesn't ask.
  const archive = () => {
    onProblem(null);
    if (topic.state === 'open') return ask(setArchiving);
    updateTopic(topic.id, { state: 'open' }).catch((err: unknown) => onProblem(message(err, "Couldn't change it.")));
  };
  const dialogs = (
    <>
      <ArchiveDialog topic={topic} topics={topics} looksDone={looksDone} open={archiving} onOpenChange={setArchiving} archive={(patch) => updateTopic(topic.id, patch)} onCloseAutoFocus={giveBack} />
      <Dialog open={confirming} onOpenChange={(next) => !deleting && setConfirming(next)}>
        <DialogContent className="sm:max-w-md" showCloseButton={false} onCloseAutoFocus={giveBack}>
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
    </>
  );
  // TOPIC-3.4, DS-16: in the tab's expanded row, Open is labelled and the rest are under More.
  if (look === 'row')
    return (
      <>
        <RowActions
          className="mt-1"
          focusable
          name={topic.title}
          primary={onOpen ? { 'data-action': 'open', label: 'Open', icon: <Maximize2 />, tip: 'Open', onPress: onOpen } : null}
          more={[
            { id: 'open-graph', label: 'Open graph', icon: <Network />, group: 'open', shortcut: 'G', onSelect: onOpenGraph },
            { id: 'link', label: 'Link to Topic…', icon: <ArrowLeftRight />, group: 'topic', onSelect: () => onLinkTo(topic) },
            { id: 'archive', label: topic.state === 'open' ? 'Archive' : 'Unarchive', icon: topic.state === 'open' ? <Archive /> : <ArchiveRestore />, group: 'manage', onSelect: archive },
            { id: 'delete', label: 'Delete', icon: <Trash2 />, group: 'manage', destructive: true, onSelect: () => ask(setConfirming) },
          ]}
        />
        {dialogs}
      </>
    );
  return (
    <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2" data-field="actions">
      {onStartSession &&
        button(
          'start',
          (e) => onStartSession(e.currentTarget),
          <>
            <Play />
            Start Session
          </>,
        )}
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
        () => ask(setConfirming),
        <>
          <Trash2 />
          Delete
        </>,
      )}
      {dialogs}
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
/** TOPIC-13.2: a member new activity is about carries a dot. */
function FreshDot() {
  return <span role="img" aria-label="new activity" className="size-1.5 shrink-0 rounded-full bg-foreground" data-field="fresh" />;
}

function MemberLine({ field, children, open, onRemove, removeLabel, fresh = false }: { field: string; children: ReactNode; open: { label: string; onPress(): void } | null; onRemove(): void; removeLabel: string; fresh?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2 py-0.5" data-field={field}>
      {fresh && <FreshDot />}
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
export function SessionChip({ member, row, pruned, onOpen, onRemove, removeLabel, fresh = false }: { member: SessionMember; row: SessionRow | null; pruned: boolean; onOpen(live: boolean): void; onRemove?(): void; removeLabel?: string; fresh?: boolean }) {
  const title = row?.title ?? member.snapshot.title;
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-0.5" data-field="session" data-session-id={member.ref.sessionId}>
      {fresh && <FreshDot />}
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
