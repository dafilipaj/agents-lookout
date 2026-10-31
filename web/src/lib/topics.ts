import type { OutputSession } from '@shared/library.ts';
import { type MemberKind, type NewMember, type Topic, type TopicEdge, type TopicMember, type TopicsView, historyMember, memberKey, sortTopics } from '@shared/topics.ts';
export { historyMember, prMember, rowMember, sessionMember, taskMember } from '@shared/topics.ts';
import type { SessionRow, Status } from '@shared/types.ts';
import type { WorkPr, WorkSnapshot, WorkTask } from '@shared/work.ts';
import { createContext, useContext } from 'react';

/**
 * TOPIC: what the browser joins to a Topic's members (TOPIC-4.1, TOPIC-4.2): the Session list's
 * Status and Work's last read, where both already are. Nothing here reads anything new.
 */

export const outputSessionMembers = (sessions: readonly OutputSession[]): NewMember[] => sessions.map(historyMember);

export const keyOf = (m: NewMember): string => memberKey(m.kind, m.ref);

/** TOPIC-2.5: which Topics each member is in, by member key. */
export function topicsByMember(view: TopicsView | null): ReadonlyMap<string, Topic[]> {
  const out = new Map<string, Topic[]>();
  for (const t of sortTopics(view?.topics ?? [])) {
    for (const m of t.members) {
      const list = out.get(m.key) ?? [];
      list.push(t);
      out.set(m.key, list);
    }
  }
  return out;
}

/** TOPIC-2.5: the Topics any of these members is in, each once, most recently changed first. */
export function topicsOf(byMember: ReadonlyMap<string, Topic[]>, members: readonly NewMember[]): Topic[] {
  const seen = new Map<string, Topic>();
  for (const m of members) for (const t of byMember.get(keyOf(m)) ?? []) seen.set(t.id, t);
  return sortTopics([...seen.values()]);
}

const KIND_WORD: Record<MemberKind, [string, string]> = { session: ['Session', 'Sessions'], pr: ['PR', 'PRs'], task: ['Task', 'Tasks'], run: ['Run', 'Runs'] };

/** TOPIC-3.2: "2 Sessions · 1 PR · 1 Task"; "No members" for none. */
export function memberCounts(members: readonly TopicMember[]): string {
  const parts = (['session', 'pr', 'task', 'run'] as const).flatMap((k) => {
    const n = members.filter((m) => m.kind === k).length;
    return n ? [`${n} ${KIND_WORD[k][n === 1 ? 0 : 1]}`] : [];
  });
  return parts.join(' · ') || 'No members';
}

/** DS-5.3: which live Status needs action most, first (WORK-2.4's order). */
const URGENCY: readonly Status[] = ['needs-you', 'busy', 'idle', 'unknown'];

/** A Session member is live when the Session list has its id under its Harness (TOPIC-4.1, HIST-3.2). */
export function liveRow(m: Extract<TopicMember, { kind: 'session' }>, sessions: ReadonlyMap<string, SessionRow>): SessionRow | null {
  const row = sessions.get(m.ref.sessionId);
  return row && row.harness === m.ref.harness ? row : null;
}

/**
 * TOPIC-3.2: the Topic's Session marker, as WORK-2.4 draws it: the most urgent live member Session's
 * Status (and when the latest Busy one became Busy, DS-10.1), else the past marker, else nothing.
 */
export function topicMarker(topic: Topic, sessions: ReadonlyMap<string, SessionRow>): { state: 'live'; status: Status; since: number | null } | { state: 'past' } | null {
  const rows = topic.members.flatMap((m) => (m.kind === 'session' ? [liveRow(m, sessions)] : []));
  if (!rows.length) return null;
  const live = rows.filter((r): r is SessionRow => r !== null);
  const status = URGENCY.find((s) => live.some((r) => r.status === s));
  if (!status) return { state: 'past' };
  const since = live.reduce<number | null>((at, r) => (r.status === 'busy' && r.statusSince !== null && (at === null || r.statusSince > at) ? r.statusSince : at), null);
  return { state: 'live', status, since };
}

/** TOPIC-4.1, TOPIC-4.2: a PR member as Work's last read has it, `loading` before any read, or `gone` from it. */
export function prState(url: string, work: WorkSnapshot | null): { state: 'loading' } | { state: 'gone' } | { state: 'listed'; pr: WorkPr } {
  if (!work || work.prs.state === 'loading') return { state: 'loading' };
  const pr = [...work.prs.mine, ...work.prs.reviewRequests].find((p) => p.url === url);
  return pr ? { state: 'listed', pr } : { state: 'gone' };
}
export function taskState(id: string, work: WorkSnapshot | null): { state: 'loading' } | { state: 'gone' } | { state: 'listed'; task: WorkTask } {
  if (!work || work.tasks.state === 'loading') return { state: 'loading' };
  const task = work.tasks.tasks.find((t) => t.id === id);
  return task ? { state: 'listed', task } : { state: 'gone' };
}

/** TOPIC-10.4: live Sessions first, most urgent Status first (DS-5.3), then the rest; newest added first within each. */
export function orderSessions<M extends Extract<TopicMember, { kind: 'session' }>>(members: readonly M[], sessions: ReadonlyMap<string, SessionRow>): M[] {
  const rank = (m: M) => {
    const row = liveRow(m, sessions);
    return row ? URGENCY.indexOf(row.status) : URGENCY.length;
  };
  return [...members].sort((a, b) => rank(a) - rank(b) || b.addedAt - a.addedAt);
}

/** TOPIC-10.4: PRs and Tasks in Work's last read first, then the rest; newest added first within each. */
export function orderWorkMembers<M extends TopicMember>(members: readonly M[], work: WorkSnapshot | null): M[] {
  const rank = (m: M) => ((m.kind === 'pr' ? prState(m.ref.url, work) : m.kind === 'task' ? taskState(m.ref.id, work) : null)?.state === 'listed' ? 0 : 1);
  return [...members].sort((a, b) => rank(a) - rank(b) || b.addedAt - a.addedAt);
}

/**
 * TOPIC-1.5: every PR member is off tb-pr's board and every Task member is out of Tasks, with at least
 * one of either. Only once Work has read each list (Known gaps): never before.
 */
export function looksDone(topic: Topic, work: WorkSnapshot | null): boolean {
  const prs = topic.members.filter((m) => m.kind === 'pr');
  const tasks = topic.members.filter((m) => m.kind === 'task');
  if (!work || prs.length + tasks.length === 0) return false;
  if (prs.length && work.prs.state !== 'ok') return false;
  if (tasks.length && work.tasks.state !== 'ok') return false;
  return prs.every((m) => prState(m.ref.url, work).state === 'gone') && tasks.every((m) => taskState(m.ref.id, work).state === 'gone');
}

/** TOPIC-3.2: the filter matches titles and notes, ignoring case. */
export function matchesTopic(topic: Topic, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || topic.title.toLowerCase().includes(q) || topic.notes.toLowerCase().includes(q);
}

/** TOPIC-3.5: the titles of the Topics a live Session is in, for the Session sidebar's filter. */
export function sessionTopicTitles(byMember: ReadonlyMap<string, Topic[]>, row: SessionRow): string[] {
  return (byMember.get(memberKey('session', { harness: row.harness, sessionId: row.id })) ?? []).map((t) => t.title);
}

/** A member as a line names it: a PR by its repo and number, a Session or Task by its title. */
export const memberName = (m: NewMember): string => (m.kind === 'pr' ? `${m.snapshot.repo} #${m.snapshot.number}` : m.snapshot.title);

/** TOPIC-6.2: a Topic's Edges, as seen from it: `out` when it starts there ("→"), else `in` ("←"). */
export function edgesOf(topicId: string, edges: readonly TopicEdge[]): { edge: TopicEdge; other: string; dir: 'out' | 'in' }[] {
  return edges.flatMap((e): { edge: TopicEdge; other: string; dir: 'out' | 'in' }[] => (e.from === topicId ? [{ edge: e, other: e.to, dir: 'out' }] : e.to === topicId ? [{ edge: e, other: e.from, dir: 'in' }] : []));
}

/** Whether two Topics have an Edge, whichever way it goes. */
export const linked = (a: string, b: string, edges: readonly TopicEdge[]): boolean => edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));

/**
 * TOPIC-6.3: pairs of these Topics, both Open, that share a member and have no Edge yet, with the
 * first shared member's name and how many more there are. A suggestion only: never stored, no direction.
 */
export function sharedPairs(all: readonly Topic[], edges: readonly TopicEdge[]): { a: string; b: string; item: string; more: number }[] {
  const out: { a: string; b: string; item: string; more: number }[] = [];
  const topics = all.filter((t) => t.state === 'open');
  for (let i = 0; i < topics.length; i++) {
    for (let j = i + 1; j < topics.length; j++) {
      const a = topics[i]!;
      const b = topics[j]!;
      const keys = new Set(b.members.map((m) => m.key));
      const shared = a.members.filter((m) => keys.has(m.key));
      if (!shared.length || linked(a.id, b.id, edges)) continue;
      out.push({ a: a.id, b: b.id, item: memberName(shared[0]!), more: shared.length - 1 });
    }
  }
  return out;
}

/** "shared: api #4410", "shared: api #4410 and 2 more". */
export const sharedLabel = (p: { item: string; more: number }): string => `shared: ${p.item}${p.more ? ` and ${p.more} more` : ''}`;

/** What the panels ask of Topics (TOPIC-2.1, TOPIC-2.5): the picker for some members, and opening one Topic. */
export interface TopicsApi {
  byMember: ReadonlyMap<string, Topic[]>;
  /** Opens the Topic picker for these members; `label` names them in the picker's title. */
  addTo(members: readonly NewMember[], label: string): void;
  /** TOPIC-2.5: the Topics tab, on that Topic. */
  open(topicId: string): void;
}

export const TopicsContext = createContext<TopicsApi | null>(null);
export const useTopics = () => useContext(TopicsContext);
