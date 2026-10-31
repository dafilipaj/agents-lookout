import type { OutputSession } from '@shared/library.ts';
import { type MemberKind, type NewMember, type Topic, type TopicMember, type TopicsView, memberKey, sortTopics } from '@shared/topics.ts';
import type { HistoryItem, SessionRow, Status } from '@shared/types.ts';
import type { WorkPr, WorkSnapshot, WorkTask } from '@shared/work.ts';
import { createContext, useContext } from 'react';

/**
 * TOPIC: what the browser joins to a Topic's members (TOPIC-4.1, TOPIC-4.2): the Session list's
 * Status and Work's last read, where both already are. Nothing here reads anything new.
 */

/** TOPIC-2.1, TOPIC-2.2: the members "Add to Topic" sends for a row, built from what the row shows. */
export function sessionMember(s: { harness: SessionRow['harness']; sessionId: string; title: string; directory: string | null }): NewMember {
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
