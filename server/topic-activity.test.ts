import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActivityEntry, NewMember } from '../shared/topics.ts';
import type { SessionRow } from '../shared/types.ts';
import type { WorkPr, WorkSnapshot, WorkTask } from '../shared/work.ts';
import { type PrObserved, observePr, observeSession, observeTask, prSightings, taskSightings } from './topic-activity.ts';
import { TopicStore, Topics } from './topics.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const sid = (n: number) => `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, '0')}`;
const prUrl = (n: number) => `https://github.com/productiveio/anvil/pull/${n}`;
const SESSION = (n: number): NewMember => ({ kind: 'session', ref: { harness: 'claude', sessionId: sid(n) }, snapshot: { harness: 'claude', title: `session ${n}`, directory: '~/Projects/work' } });
const PR = (n: number): NewMember => ({ kind: 'pr', ref: { url: prUrl(n) }, snapshot: { repo: 'anvil', number: n, title: `anvil change ${n}`, url: prUrl(n) } });
const TASK = (id: string): NewMember => ({ kind: 'task', ref: { id }, snapshot: { title: `Task ${id}`, project: 'Lantern Works', url: `https://app.fantastic.productive.io/109-productive/tasks/${id}` } });
const row = (n: number, title = `session ${n}`) => ({ id: sid(n), harness: 'claude', pid: 100 + n, title, cwd: '~/Projects/work', status: 'idle' }) as unknown as SessionRow;

function workPr(n: number, over: Partial<WorkPr> = {}): WorkPr {
  return { repo: 'anvil', number: n, title: `anvil change ${n}`, url: prUrl(n), author: null, createdAt: null, ageDays: 1, rotting: 'fresh', ci: 'passing', chip: 'draft', column: 'draft_mine', taskIds: [], links: null, ...over };
}
function workTask(id: string, over: Partial<WorkTask> = {}): WorkTask {
  return { id, title: `Task ${id}`, project: 'Lantern Works', status: 'In progress', statusCategory: 'started', statusColor: null, dueDate: null, lastActivityAt: null, milestone: false, description: null, url: `https://app.fantastic.productive.io/109-productive/tasks/${id}`, links: null, ...over };
}
function work(prs: WorkPr[] = [], tasks: WorkTask[] = [], over: { prs?: Partial<WorkSnapshot['prs']>; tasks?: Partial<WorkSnapshot['tasks']> } = {}): WorkSnapshot {
  const section = { state: 'ok' as const, reason: null, fix: null, stale: false, fetchedAt: 1 };
  return {
    prs: { ...section, mine: prs, reviewRequests: [], marks: { mine: [], reviewRequests: [] }, taskIds: true, ...over.prs },
    tasks: { ...section, tasks, ...over.tasks },
    sessionLinks: { state: 'ok', reason: null, fix: null },
    refresh: { cooldownUntil: null, githubBlockedUntil: null },
  };
}

describe('TOPIC-12.2 what counts as a change', () => {
  it('TOPIC-12.2: a first sighting records nothing; a Session missing from one list and back records nothing, from two in a row it ended', () => {
    let s = observeSession(null, true);
    expect(s.changes).toEqual([]);
    s = observeSession(s.next, false);
    expect(s.changes).toEqual([]);
    s = observeSession(s.next, true);
    expect(s.changes).toEqual([]);
    s = observeSession(s.next, false);
    s = observeSession(s.next, false);
    expect(s.changes).toEqual([{ kind: 'ended' }]);
    s = observeSession(s.next, false);
    expect(s.changes).toEqual([]);
    expect(observeSession(s.next, true).changes).toEqual([{ kind: 'live' }]);
  });

  it('TOPIC-12.2: CI failing is recorded once until a passing follows it; unknown, none and running say nothing; failing at the first sighting is never recorded, nor the passing after it', () => {
    const at = (ci: WorkPr['ci']) => ({ inWork: true as const, ci, chip: 'ready' as const, column: 'review_mine' as const });
    const run = (first: WorkPr['ci'], seq: readonly WorkPr['ci'][]) => {
      let p = observePr(null, at(first));
      expect(p.changes).toEqual([]);
      return seq.map((ci) => {
        p = observePr(p.next, at(ci));
        return p.changes.map((c) => c.kind);
      });
    };
    expect(run('failing', ['running', 'failing', 'passing', 'failing', 'running', 'unknown', 'none', 'failing', 'passing'])).toEqual([[], [], [], ['ci-failing'], [], [], [], [], ['ci-passing']]);
    expect(run('passing', ['failing', 'failing', 'passing'])).toEqual([['ci-failing'], [], ['ci-passing']]);
  });

  it('TOPIC-12.2: an unknown first sighting keeps nothing, so the first good read is a first sighting, not "back"', () => {
    expect(observePr(null, 'unknown')).toEqual({ next: null, changes: [] });
    expect(observeTask(null, 'unknown')).toEqual({ next: null, changes: [] });
    expect(observePr(null, { inWork: true, ci: 'failing', chip: 'ready', column: 'review_mine' }).changes).toEqual([]);
  });

  it('TOPIC-12.2: a PR gone from Work and back, its chip changing, and a review request’s missing chip being no change', () => {
    let p = observePr(null, { inWork: true, ci: 'passing', chip: 'draft', column: 'draft_mine' });
    p = observePr(p.next, { inWork: true, ci: 'passing', chip: 'ready', column: 'review_mine' });
    expect(p.changes).toEqual([{ kind: 'chip', data: { to: 'ready' } }]);
    p = observePr(p.next, { inWork: true, ci: 'passing', chip: null, column: 'waiting_on_me' });
    expect(p.changes).toEqual([]);
    p = observePr(p.next, { inWork: false });
    expect(p.changes).toEqual([{ kind: 'gone' }]);
    p = observePr(p.next, { inWork: false });
    expect(p.changes).toEqual([]);
    p = observePr(p.next, 'unknown');
    expect(p.changes).toEqual([]);
    expect(observePr(p.next, { inWork: true, ci: 'passing', chip: 'approved', column: 'ready_to_merge_mine' }).changes).toEqual([{ kind: 'back' }, { kind: 'chip', data: { to: 'approved' } }]);
  });

  it('TOPIC-12.2: a failed or stale read, and a column tb-pr put back (now or when last seen), say nothing about a PR', () => {
    const prev: PrObserved = { inWork: true, ci: 'passing', failing: false, chip: 'ready', column: 'review_mine' };
    expect(prSightings(work([], [], { prs: { state: 'error' } }))(prUrl(1), prev)).toBe('unknown');
    expect(prSightings(work([], [], { prs: { stale: true } }))(prUrl(1), prev)).toBe('unknown');
    const marked = work([workPr(2, { column: 'draft_mine' })], [], { prs: { marks: { mine: [{ columns: ['review_mine', 'draft_mine'], reason: 'kept from an earlier fetch', confirmedAt: null }], reviewRequests: [] } } });
    // Gone from a column that was put back: maybe still there.
    expect(prSightings(marked)(prUrl(1), prev)).toBe('unknown');
    // Listed in a column that was put back: maybe stale.
    expect(prSightings(marked)(prUrl(2), null)).toBe('unknown');
    expect(prSightings(work([workPr(2)]))(prUrl(1), prev)).toEqual({ inWork: false });
    expect(prSightings(work([workPr(2)]))(prUrl(2), null)).toEqual({ inWork: true, ci: 'passing', chip: 'draft', column: 'draft_mine' });
  });

  it('TOPIC-12.2: a Task read at the cap says nothing of a Task it doesn’t list; another email starts over; a status change is recorded', () => {
    const full = work([], Array.from({ length: 100 }, (_, i) => workTask(String(i + 1))));
    expect(taskSightings(full, 'me@x')('999')).toBe('unknown');
    expect(taskSightings(work([], [workTask('1')]), 'me@x')('999')).toEqual({ inWork: false, email: 'me@x' });
    expect(taskSightings(work([], [workTask('1')]), null)('1')).toBe('unknown');
    let t = observeTask(null, { inWork: true, status: 'Open', email: 'me@x' });
    t = observeTask(t.next, { inWork: true, status: 'In review', email: 'me@x' });
    expect(t.changes).toEqual([{ kind: 'task-status', data: { to: 'In review' } }]);
    t = observeTask(t.next, { inWork: false, email: 'other@x' });
    expect(t.changes).toEqual([]);
    t = observeTask(t.next, { inWork: true, status: 'Open', email: 'other@x' });
    expect(t.changes).toEqual([{ kind: 'back' }]);
    expect(observeTask(t.next, { inWork: false, email: 'other@x' }).changes).toEqual([{ kind: 'gone' }]);
  });
});

describe('TOPIC-12.1 recording', () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'lookout-activity-'));
    dirs.push(dir);
    const path = join(dir, 'topics.db');
    const topics = new Topics({ path, open: () => new TopicStore(path), exists: () => existsSync(path), onChange: () => {} });
    return { topics, path };
  }
  const words = (entries: ActivityEntry[]) => entries.map((e) => [e.kind, e.by, e.data.name ?? null]);

  it('TOPIC-12.1, TOPIC-12.2: Fleet’s list and Work’s reads write entries by Lookout, in every Topic the member is in, named as the member is', () => {
    const { topics } = setup();
    const a = topics.create('A').id;
    const b = topics.create('B').id;
    for (const id of [a, b]) {
      topics.addMember(id, SESSION(1));
      topics.addMember(id, PR(7));
    }
    topics.addMember(a, TASK('41'));
    // First sightings: nothing.
    topics.observeSessions([row(1, 'fix the lanterns')]);
    topics.observeWork(work([workPr(7, { ci: 'passing' })], [workTask('41')]), 'me@x');
    expect(topics.activity(a, null).filter((e) => e.by === 'lookout')).toEqual([]);
    topics.observeWork(work([workPr(7, { ci: 'failing' })], [workTask('41', { status: 'Done' })]), 'me@x');
    topics.observeSessions([]);
    topics.observeSessions([]);
    expect(words(topics.activity(a, null).filter((e) => e.by === 'lookout'))).toEqual([
      ['ended', 'lookout', 'session 1'],
      ['task-status', 'lookout', 'Task 41'],
      ['ci-failing', 'lookout', 'anvil #7'],
    ]);
    expect(words(topics.activity(b, null).filter((e) => e.by === 'lookout')).map((w) => w[0])).toEqual(['ended', 'ci-failing']);
    // TOPIC-3.8: the row's latest activity by Lookout.
    expect(topics.view().topics.find((t) => t.id === a)!.lastActivity).toMatchObject({ kind: 'ended', data: { name: 'session 1' } });
  });

  it('TOPIC-12.2: nothing is recorded, or made on disk, before the store exists', () => {
    const { topics, path } = setup();
    topics.observeSessions([row(1)]);
    topics.observeWork(work([workPr(7)]), 'me@x');
    expect(existsSync(path)).toBe(false);
  });

  it('TOPIC-12.2: a member removed and added again starts over from its new first sighting', () => {
    const { topics } = setup();
    const a = topics.create('A').id;
    topics.addMember(a, PR(7));
    topics.observeWork(work([workPr(7, { ci: 'failing' })]), 'me@x');
    topics.removeMember(a, 'pr', JSON.stringify({ url: prUrl(7) }));
    topics.addMember(a, PR(7));
    topics.observeWork(work([workPr(7, { ci: 'passing' })]), 'me@x');
    expect(topics.activity(a, null).map((e) => e.kind)).toEqual(['added', 'removed', 'added', 'made']);
  });
});
