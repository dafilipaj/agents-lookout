import type { OutputItem } from './library.ts';
import type { Harness, HistoryItem, SessionRow } from './types.ts';
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
}

/**
 * TOPIC-8.3: the whole set, as every tab gets it. `error` (TOPIC-8.4): the store couldn't be opened,
 * and `reason` says why in plain words, with `path`, the file it tried.
 */
export interface TopicsView {
  state: 'ok' | 'error';
  reason: string | null;
  path: string;
  topics: Topic[];
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
