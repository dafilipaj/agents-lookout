import type { OutputItem } from './library.ts';
import type { Harness, HistoryItem, LaunchTopic, SessionRow } from './types.ts';
import type { WorkPr, WorkTask } from './work.ts';

/**
 * TOPIC: a Topic, its members and its notes, as Lookout's store keeps them and the server sends
 * them (TOPIC-8.3). Contract: docs/features/topics/SPEC.md.
 */

/** TOPIC-2: what a member is; `run` waits on `tb-flow` (slice 4) and is refused until then. */
export const MEMBER_KINDS = ['session', 'pr', 'task', 'run'] as const;
export type MemberKind = (typeof MEMBER_KINDS)[number];

/** TOPIC-8.2: a member's reference, by kind; stored as JSON text with its keys in this order. */
export interface SessionRef {
  harness: Harness;
  sessionId: string;
}
export interface PrRef {
  url: string;
}
export interface TaskRef {
  id: string;
}

/** TOPIC-2.3: what Lookout knew of a member when it was added; shown once its source no longer lists it. */
export interface SessionSnapshot {
  harness: Harness;
  title: string;
  /** Its start directory, as shown (`~` for the home directory); null when unknown. */
  directory: string | null;
}
export interface PrSnapshot {
  repo: string;
  number: number;
  title: string;
  url: string;
}
export interface TaskSnapshot {
  title: string;
  project: string | null;
  url: string;
}

/** What "Add to Topic" sends (TOPIC-2.1, TOPIC-2.3): the reference and the snapshot built from the row. */
export type NewMember =
  | { kind: 'session'; ref: SessionRef; snapshot: SessionSnapshot }
  | { kind: 'pr'; ref: PrRef; snapshot: PrSnapshot }
  | { kind: 'task'; ref: TaskRef; snapshot: TaskSnapshot };

/** A stored member: a NewMember with when and why it was added. `key` is `<kind>:<ref as stored>`. */
export type TopicMember = NewMember & { key: string; addedAt: number; reason: string };

/**
 * TOPIC-4.4: the Outputs the Topic's Session members touched, from the Library's last read, newest
 * first, at most `MAX_TOPIC_OUTPUTS`; `total` counts them all.
 */
export interface TopicOutputs {
  items: OutputItem[];
  total: number;
}
export const MAX_TOPIC_OUTPUTS = 10;

export type TopicState = 'open' | 'archived';

export interface Topic {
  id: string;
  title: string;
  /** Markdown; '' when it has none (TOPIC-1.2). */
  notes: string;
  state: TopicState;
  createdAt: number;
  /** TOPIC-3.2: its last membership, title or notes change. */
  updatedAt: number;
  members: TopicMember[];
  /** TOPIC-4.4: null until the Library has been read since the server started. */
  outputs: TopicOutputs | null;
  /** TOPIC-7.2: its node's place in the graph; null until it's placed. */
  pos: TopicPosition | null;
  /** TOPIC-11.5: its last summary; null until one is written. */
  summary: TopicSummary | null;
  /** TOPIC-11.5: a member was added or removed, or the notes changed, since the summary was written. */
  summaryStale: boolean;
  /** TOPIC-1.6: how it ended, while it's archived; null when open, or archived before slice 7. */
  outcome: TopicOutcome | null;
  /** TOPIC-1.6: its closing line; null when none. */
  closing: string | null;
  /** TOPIC-1.6: the Topic that superseded it, with its title at that moment. */
  supersededBy: { id: string; title: string } | null;
  /** TOPIC-3.8: its latest activity Lookout recorded itself; null when none. */
  lastActivity: ActivityEntry | null;
  /** TOPIC-12.3: its newest entry's id, 0 when none: the view reads the log again when it moves. */
  lastEntryId: number;
  /** TOPIC-13.1: the newest entry seen, and how many entries by Lookout came after it. */
  seenUpto: number;
  newCount: number;
  /** TOPIC-11.10: activity since the summary's input, other than summaries; and how many earlier summaries are kept. */
  changesSinceSummary: number;
  earlierSummaries: number;
}

/** TOPIC-1.6: how a Topic ended. */
export const TOPIC_OUTCOMES = ['done', 'parked', 'dropped', 'superseded'] as const;
export type TopicOutcome = (typeof TOPIC_OUTCOMES)[number];
/** TOPIC-1.6: a closing line is at most this many characters. */
export const MAX_CLOSING = 300;
/** TOPIC-1.6: the label of the Edge "Superseded by…" draws. */
export const SUPERSEDED_LABEL = 'superseded by';

/** TOPIC-12.1: what an activity entry records. */
export type ActivityKind =
  | 'made'
  | 'title'
  | 'notes'
  | 'archived'
  | 'unarchived'
  | 'edge-drawn'
  | 'edge-label'
  | 'edge-reversed'
  | 'edge-unlinked'
  | 'summary'
  | 'added'
  | 'removed'
  | 'gone'
  | 'back'
  | 'ci-failing'
  | 'ci-passing'
  | 'chip'
  | 'task-status'
  | 'live'
  | 'ended';

/**
 * TOPIC-12.1: an entry's details, as it was written: the member's name and the other Topic's title
 * at that moment, so it reads after a Remove or a Delete.
 */
export interface ActivityData {
  name?: string;
  reason?: string;
  outcome?: TopicOutcome;
  closing?: string;
  /** The other Topic of an Edge or a supersede: its id and title. */
  otherId?: string;
  other?: string;
  /** An Edge's direction from this Topic: `to` the other, or `from` it. */
  dir?: 'to' | 'from';
  label?: string | null;
  /** A title's, chip's or Task status's new value. */
  to?: string | null;
}

/** TOPIC-12: one entry of a Topic's activity. `member` is its member's key, kept after a Remove. */
export interface ActivityEntry {
  id: number;
  at: number;
  kind: ActivityKind;
  member: string | null;
  by: 'you' | 'lookout';
  data: ActivityData;
}

/** TOPIC-12.3: Activity is read this many entries at a time. */
export const ACTIVITY_PAGE = 50;
/** TOPIC-13.2: "Since you last looked" shows at most this many. */
export const MAX_NEW_SHOWN = 10;

const CHIP_WORDS: Record<string, string> = { draft: 'is a draft', ready: 'ready for review', approved: 'approved' };

/** TOPIC-12.3: an entry's words: "#2711 CI failing", "Added Rates port, from a Link". */
export function activityWords(e: ActivityEntry): string {
  const d = e.data;
  const name = d.name ?? 'A member';
  const other = d.other ?? 'a Topic';
  const label = d.label ? ` (${d.label})` : '';
  switch (e.kind) {
    case 'made':
      return 'Made';
    case 'title':
      return `Renamed to "${d.to ?? ''}"`;
    case 'notes':
      return 'Notes saved';
    case 'archived':
      return `Archived: ${d.outcome === 'superseded' && d.other ? `superseded by ${d.other}` : (d.outcome ?? 'no outcome')}`;
    case 'unarchived':
      return 'Unarchived';
    case 'edge-drawn':
      return `Linked ${d.dir === 'from' ? 'from' : 'to'} ${other}${label}`;
    case 'edge-label':
      return d.label ? `Edge with ${other} labelled "${d.label}"` : `Edge with ${other} unlabelled`;
    case 'edge-reversed':
      return `Edge with ${other} reversed`;
    case 'edge-unlinked':
      return `Unlinked ${other}`;
    case 'summary':
      return 'Summary written';
    case 'added':
      return d.reason ? `Added ${name}, ${d.reason}` : `Added ${name}`;
    case 'removed':
      return `Removed ${name}`;
    case 'gone':
      return `${name} gone from Work`;
    case 'back':
      return `${name} back in Work`;
    case 'ci-failing':
      return `${name} CI failing`;
    case 'ci-passing':
      return `${name} CI passing`;
    case 'chip':
      return `${name} ${CHIP_WORDS[d.to ?? ''] ?? d.to ?? ''}`;
    case 'task-status':
      return `${name}: ${d.to ?? 'no status'}`;
    case 'live':
      return `${name} running`;
    case 'ended':
      return `${name} ended`;
  }
}

/** TOPIC-12.1: a member's name as an entry keeps it. */
export function memberName(m: NewMember): string {
  if (m.kind === 'pr') return m.snapshot.repo && m.snapshot.number ? `${m.snapshot.repo} #${m.snapshot.number}` : m.snapshot.title;
  return m.snapshot.title;
}

/** TOPIC-7.2: a node's centre, in the graph's own units (CSS pixels at scale 1). */
export interface TopicPosition {
  x: number;
  y: number;
}

/** TOPIC-6: an Edge from one Topic to another, with an optional label that reads from the first to the second. */
export interface TopicEdge {
  from: string;
  to: string;
  label: string | null;
  createdAt: number;
}

/** TOPIC-6.1: an Edge's label is at most this many characters. */
export const MAX_EDGE_LABEL = 60;

/**
 * TOPIC-8.3: the whole set, as every tab gets it. `error` (TOPIC-8.4): the store couldn't be opened,
 * and `reason` says why in plain words, with `path`, the file it tried.
 */
export interface TopicsView {
  state: 'ok' | 'error';
  reason: string | null;
  path: string;
  topics: Topic[];
  /** TOPIC-6: every Edge, oldest first. */
  edges: TopicEdge[];
  /**
   * TOPIC-4.2: Sessions the Library's last read says tb-session no longer has, as
   * `<harness>:<sessionId>`; empty before a read.
   */
  pruned: string[];
  /** TOPIC-4.4: when the Library's last read ended, ms since epoch; null before one. */
  libraryReadAt: number | null;
  /** TOPIC-9.4: pending recommendations, newest first. */
  recommendations: Recommendation[];
  /** TOPIC-9.3: Jev asks since local midnight, for the Settings switch's line. */
  jevAsksToday: number;
  /** TOPIC-11.6: the Topics a summary is being written for. */
  summarizing: string[];
  /** TOPIC-11.6: why each Topic's last summary run failed, by Topic id, until its next run. */
  summaryErrors: Record<string, SummaryError>;
}

/** TOPIC-11.4: where the work stands, as the summary says. */
export const SUMMARY_STATES = ['not started', 'in progress', 'blocked', 'waiting', 'done'] as const;
export type SummaryState = (typeof SUMMARY_STATES)[number];

/** TOPIC-11.4: a member a point cites: its member key, and its name when the summary was written. */
export interface SummaryCite {
  key: string;
  name: string;
}

/**
 * TOPIC-11.4: one point of `open`, `recent`, `next` or `watch`, with the members it comes from. `at`
 * (`recent`): when it happened, `YYYY-MM-DD HH:MM` local; `when` (`next`): what has to happen first.
 */
export interface SummaryPoint {
  text: string;
  cites: SummaryCite[];
  at?: string | null;
  when?: string | null;
}

/** TOPIC-11.4: the answer's fixed shape, its cited keys (`S1`, `PR1`, `T1`) turned into member keys. */
export interface SummaryAnswer {
  what: string;
  state: SummaryState;
  /** One sentence saying why `state`. */
  why: string;
  open: SummaryPoint[];
  recent: SummaryPoint[];
  next: SummaryPoint[];
  /** TOPIC-11.4: open threads left out of `open`; absent in a summary from before slice 7. */
  openMore?: number;
  /** TOPIC-11.4: known traps, at most three; absent in a summary from before slice 7. */
  watch?: SummaryPoint[];
}

/** TOPIC-11.4: `open` shows at most this many; the rest go to `openMore`. `watch` holds at most three. */
export const MAX_OPEN_POINTS = 4;
export const MAX_WATCH_POINTS = 3;

/** TOPIC-11.5, TOPIC-11.7: a stored summary, who wrote it and what it cost. */
export interface TopicSummary {
  answer: SummaryAnswer;
  writtenAt: number;
  /** The model as `claude -p` reports it (`claude-sonnet-5-5`). */
  model: string;
  /** `total_cost_usd`; null when it didn't say. */
  costUsd: number | null;
}

/** TOPIC-11.6: why a run left the stored summary as it was, in plain words, with a fix when there is one. */
export interface SummaryError {
  reason: string;
  fix: string | null;
}

/** TOPIC-11.6: at most this many summaries are written at once. */
export const MAX_SUMMARY_RUNS = 2;

/** TOPIC-11.7: `claude-sonnet-5-5` as "Sonnet 5.5"; an id Lookout can't read as it is. */
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (!m) return id;
  return `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}

/** TOPIC-11.7: "$0.04"; under a cent, "<$0.01". */
export function formatCost(usd: number): string {
  return usd < 0.005 ? '<$0.01' : `$${usd.toFixed(2)}`;
}

/** TOPIC-9: where a recommendation came from. */
export type RecommendationSource = 'link' | 'jev';

/**
 * TOPIC-9.4: a pending recommendation: the item (as it looked when first seen), and the Open Topic
 * it probably belongs to (`topicId`) or a new Topic (`newTitle`), with the reason shown.
 */
export interface Recommendation {
  /** The item's member key (`memberKey`). */
  key: string;
  member: NewMember;
  topicId: string | null;
  newTitle: string | null;
  source: RecommendationSource;
  /** Jev's confidence, 0 to 1; null for a Link. */
  confidence: number | null;
  /** The Link's words ("started on PR #812"), or "Jev, 82%". */
  reason: string;
  createdAt: number;
}

/** TOPIC-9.4: what a recommendation's buttons send (`POST /api/topics/recommendations`). */
export type RecommendationAction =
  | { action: 'accept' | 'dismiss'; key: string; topicId: string | null }
  /** "Other Topic…": the item goes to `to`, and this recommendation counts as dismissed. */
  | { action: 'move'; key: string; topicId: string | null; to: string }
  /** TOPIC-9.1: the one way back for an item already judged, accepted or dismissed. */
  | { action: 'judge-again'; member: NewMember };

/** TOPIC-9.3: a pick below this confidence leaves nothing. */
export const JEV_MIN_CONFIDENCE = 0.6;
/** TOPIC-9.3: at most this many asks an hour, per server process. */
export const JEV_ASKS_PER_HOUR = 30;

/** TOPIC-9.4: the reason recorded on a member a recommendation added. */
export const acceptedReason = (source: RecommendationSource): string => (source === 'link' ? 'from a Link' : 'from Jev, accepted');

/** TOPIC-5.2: the reason recorded on a Session Lookout added because it started it. */
export const STARTED_REASON: Record<LaunchTopic['via'], string> = { topic: 'started from this Topic', task: 'started on its Task' };

/**
 * TOPIC-5.1: the launcher's prompt for a Session started from a Topic, a handover: when it has a
 * summary that isn't out of date, its `what`, `state` with `why`, the three newest `recent` points
 * with their dates, `open`, `next` with each one's trigger, and `watch`; else the notes' first
 * paragraph. Then each Task member's URL, `Topic: <id> <title>`, and the line asking the agent to
 * restate before it changes anything.
 */
export function topicPrompt(topic: Topic): string {
  const parts: string[] = [];
  const summary = topic.summary && !topic.summaryStale ? topic.summary.answer : null;
  if (summary) {
    const cites = (p: SummaryPoint) => (p.cites.length ? ` (${p.cites.map((c) => c.name).join(', ')})` : '');
    const points = (label: string, list: readonly SummaryPoint[] | undefined, line: (p: SummaryPoint) => string) =>
      list?.length ? [`${label}:\n${list.map((p) => `- ${line(p)}${cites(p)}`).join('\n')}`] : [];
    parts.push(
      summary.what,
      `State: ${summary.state}. ${summary.why}`,
      ...points('Recent', summary.recent.slice(0, 3), (p) => (p.at ? `${p.at}: ${p.text}` : p.text)),
      ...points('Open', summary.open, (p) => p.text),
      ...points('Next', summary.next, (p) => (p.when ? `When ${p.when.replace(/^when\s+/i, '')}: ${p.text}` : p.text)),
      ...points('Watch out', summary.watch, (p) => p.text),
    );
  } else {
    const first = topic.notes.trim().split(/\n\s*\n/)[0]?.trim();
    if (first) parts.push(first);
  }
  const tasks = topic.members.flatMap((m) => (m.kind === 'task' ? [m.snapshot.url] : []));
  if (tasks.length) parts.push(tasks.join('\n'));
  parts.push(`Topic: ${topic.id} ${topic.title}`);
  parts.push(RESTATE_LINE);
  return parts.join('\n\n');
}

/** TOPIC-5.1: the handover's last line: the receiver restates, then carries on. */
export const RESTATE_LINE =
  "In your first reply, before you change anything, restate in a few lines what this Topic is, where it stands and what you'll do first; then carry on.";

/** TOPIC-5.2: the one Open Topic a Task is in, which a Session started on it joins; null for none or several. */
export function taskTopic(topics: readonly Topic[], taskId: string): Topic | null {
  const key = memberKey('task', { id: taskId });
  const open = topics.filter((t) => t.state === 'open' && t.members.some((m) => m.key === key));
  return open.length === 1 ? open[0]! : null;
}

/** TOPIC-4.4: expanding a Topic asks for a Library read when the last one is at least this old, as the Library tab rereads (LIB-2.7). */
export const OUTPUTS_FRESH_MS = 60_000;

/** TOPIC-1.1: a title is trimmed and cut to this many characters. */
export const MAX_TOPIC_TITLE = 120;
/** TOPIC-1.2. */
export const MAX_TOPIC_NOTES = 20_000;

/** TOPIC-8.2: a ref as stored, its keys in a fixed order, so it compares as a string. */
export function refText(kind: 'session', ref: SessionRef): string;
export function refText(kind: MemberKind, ref: SessionRef | PrRef | TaskRef): string;
export function refText(kind: MemberKind, ref: SessionRef | PrRef | TaskRef): string {
  if (kind === 'session') {
    const r = ref as SessionRef;
    return JSON.stringify({ harness: r.harness, sessionId: r.sessionId });
  }
  if (kind === 'pr') return JSON.stringify({ url: (ref as PrRef).url });
  return JSON.stringify({ id: (ref as TaskRef).id });
}

export const memberKey = (kind: MemberKind, ref: SessionRef | PrRef | TaskRef): string => `${kind}:${refText(kind, ref)}`;

/** TOPIC-3.2, TOPIC-1.3: Open Topics (or Archived ones), most recently changed first. */
export function sortTopics(topics: readonly Topic[]): Topic[] {
  return [...topics].sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));
}

/** TOPIC-2.1, TOPIC-2.2: the members "Add to Topic" sends for a row, built from what the row shows. */
export function sessionMember(s: { harness: Harness; sessionId: string; title: string; directory: string | null }): NewMember {
  return { kind: 'session', ref: { harness: s.harness, sessionId: s.sessionId }, snapshot: { harness: s.harness, title: s.title, directory: s.directory } };
}
export const historyMember = (item: HistoryItem): NewMember => sessionMember({ harness: item.harness, sessionId: item.sessionId, title: item.title, directory: item.projectDisplay ?? item.projectPath });
export const prMember = (pr: WorkPr): NewMember => ({ kind: 'pr', ref: { url: pr.url }, snapshot: { repo: pr.repo, number: pr.number, title: pr.title, url: pr.url } });
export const taskMember = (task: WorkTask): NewMember => ({ kind: 'task', ref: { id: task.id }, snapshot: { title: task.title, project: task.project, url: task.url } });
/** A live Session's row: its session id, or none yet (`<harness>:<pid>`, TOPIC-2.2). */
export function rowMember(row: SessionRow): NewMember | null {
  if (row.id === `${row.harness}:${row.pid}`) return null;
  const home = row.cwd;
  return sessionMember({ harness: row.harness, sessionId: row.id, title: row.title, directory: home });
}

/** A Topic's slice 7 fields with nothing in them: a Topic made in a test or a World's fixture. */
export const NO_ACTIVITY = {
  outcome: null,
  closing: null,
  supersededBy: null,
  lastActivity: null,
  lastEntryId: 0,
  seenUpto: 0,
  newCount: 0,
  changesSinceSummary: 0,
  earlierSummaries: 0,
} as const satisfies Partial<Topic>;
