import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NewMember, TopicsView } from '../shared/topics.ts';
import type { SessionRow } from '../shared/types.ts';
import type { WorkPr, WorkSessionLink, WorkSnapshot, WorkTask } from '../shared/work.ts';
import type { RunError, Runner } from './exec.ts';
import { JEV_SETTLE_MS, Recommender, linkTies } from './recommender.ts';
import { SCHEMA_VERSION, TopicStore, Topics, TopicsError, parseRecommendationAction } from './topics.ts';

/** Synthetic Sessions, PRs and Tasks only: invented titles, repos and ids. */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.useRealTimers();
});
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'lookout-recommend-'));
  dirs.push(dir);
  return dir;
}
const sqlite = () => process.getBuiltinModule('node:sqlite');

const sid = (n: number) => `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SESSION = (n: number, title = `session ${n}`): NewMember => ({ kind: 'session', ref: { harness: 'claude', sessionId: sid(n) }, snapshot: { harness: 'claude', title, directory: '~/Projects/work' } });
const prUrl = (n: number) => `https://github.com/productiveio/anvil/pull/${n}`;
const PR = (n: number, title = `anvil change ${n}`): NewMember => ({ kind: 'pr', ref: { url: prUrl(n) }, snapshot: { repo: 'anvil', number: n, title, url: prUrl(n) } });
const TASK = (id: string, title = `Task ${id}`): NewMember => ({ kind: 'task', ref: { id }, snapshot: { title, project: 'Lantern Works', url: `https://app.fantastic.productive.io/109-productive/tasks/${id}` } });
const key = (m: NewMember) => `${m.kind}:${JSON.stringify(m.kind === 'session' ? { harness: m.ref.harness, sessionId: m.ref.sessionId } : m.ref)}`;

const link = (n: number, reason: WorkSessionLink['reason'], title = `session ${n}`): WorkSessionLink => ({ sessionId: sid(n), harness: 'claude', title, createdAt: null, modifiedAt: null, live: true, reason });
function workPr(n: number, over: Partial<WorkPr> = {}): WorkPr {
  return { repo: 'anvil', number: n, title: `anvil change ${n}`, url: prUrl(n), author: null, createdAt: null, ageDays: 1, rotting: 'fresh', ci: 'passing', chip: 'draft', column: 'draft_mine', taskIds: [], links: null, ...over };
}
function workTask(id: string, over: Partial<WorkTask> = {}): WorkTask {
  return { id, title: `Task ${id}`, project: 'Lantern Works', status: 'In progress', statusCategory: 'started', statusColor: null, dueDate: null, lastActivityAt: null, milestone: false, description: `Light the lanterns of ${id}`, url: `https://app.fantastic.productive.io/109-productive/tasks/${id}`, links: null, ...over };
}
function work(prs: WorkPr[] = [], tasks: WorkTask[] = []): WorkSnapshot {
  const section = { state: 'ok' as const, reason: null, fix: null, stale: false, fetchedAt: 1 };
  return {
    prs: { ...section, mine: prs, reviewRequests: [], marks: { mine: [], reviewRequests: [] }, taskIds: true },
    tasks: { ...section, tasks },
    sessionLinks: { state: 'ok', reason: null, fix: null },
    refresh: { cooldownUntil: null, githubBlockedUntil: null },
  };
}
const row = (n: number, over: Partial<SessionRow> = {}): SessionRow => ({ id: sid(n), harness: 'claude', pid: 100 + n, title: `session ${n}`, cwd: '~/Projects/work', status: 'working', statusSince: 0, ...over }) as unknown as SessionRow;

function setup(opts: { now?: () => number } = {}) {
  const dir = tempDir();
  const path = join(dir, 'topics.db');
  const views: TopicsView[] = [];
  const topics = new Topics({ path, open: () => new TopicStore(path, opts), exists: () => existsSync(path), onChange: (v) => views.push(v) });
  return { dir, path, topics, views };
}

/** A fake tb-jev: logs argv and stdin, answers `ask` from the queue, and refuses anything else. */
function fakeJev(answers: (string | RunError | ((args: readonly string[]) => string))[]) {
  const calls: { args: readonly string[]; stdin: string | undefined }[] = [];
  const runner = vi.fn<Runner>(async (_bin, args, o) => {
    if (args[0] !== 'ask') throw Object.assign(new Error('refused'), { code: 2 });
    calls.push({ args, stdin: o.stdin });
    const a = answers.shift();
    if (a === undefined) throw new Error('no answer queued');
    if (typeof a === 'function') return a(args);
    if (typeof a !== 'string') throw a;
    return a;
  });
  return { runner, calls };
}
const picked = (choice: string, confidence: number) =>
  JSON.stringify({ status: 'ok', answers: { topic: { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } } }, decisions: {}, error_reason: null });

function recommender(topics: Topics, runner: Runner, over: Partial<ConstructorParameters<typeof Recommender>[0]> = {}) {
  const log = vi.fn<(line: string) => void>();
  const r = new Recommender({
    topics,
    runner,
    jevBin: () => '/fake/tb-jev',
    jevReady: () => true,
    enabled: () => true,
    firstPrompt: async () => 'Replace the lantern wicks before tonight',
    work: () => null,
    questionsDir: join(tempDir(), 'questions'),
    log,
    ...over,
  });
  return { r, log };
}
/** Lets the queue run every ask it can now. */
async function settled(r: Recommender) {
  for (let i = 0; i < 20; i++) await new Promise((res) => setImmediate(res));
  await (r as unknown as { running: Promise<void> | null }).running;
}

describe('TOPIC-8.1 and TOPIC-9.6 the store', () => {
  it('TOPIC-8.1: an older database is copied to topics.db.bak-<version>, then migrated forward in a transaction, keeping what it held', () => {
    const { path } = setup();
    const store = new TopicStore(path);
    const id = store.create('Kept');
    store.close();
    const db = new (sqlite().DatabaseSync)(path);
    db.exec('alter table candidates drop column snapshot; update schema_version set v = 1');
    db.close();
    const migrated = new TopicStore(path);
    expect(migrated.list().map((t) => t.id)).toEqual([id]);
    migrated.close();
    const bak = new (sqlite().DatabaseSync)(`${path}.bak-1`);
    expect(bak.prepare('select max(v) as v from schema_version').get()).toEqual({ v: 1 });
    expect((bak.prepare('pragma table_info(candidates)').all() as { name: string }[]).map((c) => c.name)).not.toContain('snapshot');
    bak.close();
    const now = new (sqlite().DatabaseSync)(path);
    expect(now.prepare('select max(v) as v from schema_version').get()).toEqual({ v: SCHEMA_VERSION });
    expect((now.prepare('pragma table_info(candidates)').all() as { name: string }[]).map((c) => c.name)).toContain('snapshot');
    now.close();
  });

  it('TOPIC-9.6: one candidate row per item, at most one recommendation per Topic and one "New Topic", and a dismissed one never comes back', () => {
    const { path } = setup();
    const s = new TopicStore(path);
    const a = s.create('A');
    expect(s.addCandidate(SESSION(1), 'off')).toBe(true);
    expect(s.addCandidate(SESSION(1), 'waiting')).toBe(false);
    const ref = JSON.stringify({ harness: 'claude', sessionId: sid(1) });
    expect(s.candidate('session', ref)).toMatchObject({ jev: 'off', judged_at: null, outcome: null });
    const rec = { kind: 'session' as const, ref, source: 'link' as const, confidence: null, reason: 'started on PR #1' };
    expect(s.recommend({ ...rec, topicId: a, newTitle: null })).toBe(true);
    expect(s.recommend({ ...rec, topicId: a, newTitle: null })).toBe(false);
    expect(s.recommend({ ...rec, topicId: null, newTitle: 'One' })).toBe(true);
    expect(s.recommend({ ...rec, topicId: null, newTitle: 'Two' })).toBe(false);
    s.resolve('session', ref, a, 'dismissed');
    expect(s.recommend({ ...rec, topicId: a, newTitle: null })).toBe(false);
    expect(s.pending().map((r) => [r.topicId, r.newTitle])).toEqual([[null, 'One']]);
    s.close();
  });
});

describe('TOPIC-9.1 candidates', () => {
  it('TOPIC-9.1: a Session with a session id, a PR and a Task in no Topic are candidates once; one without a session id, or already in a Topic, never; nothing is recorded before Topics are used', () => {
    const { topics, path } = setup();
    const { r } = recommender(topics, fakeJev([]).runner, { enabled: () => false });
    r.observeSessions([row(1)]);
    expect(existsSync(path)).toBe(false);
    const t = topics.create('Lanterns');
    topics.addMember(t.id, SESSION(2));
    r.observeSessions([row(1), row(2), { ...row(3), id: 'claude:103', pid: 103 } as SessionRow]);
    r.observeWork(work([workPr(7)], [workTask('41')]));
    r.observeSessions([row(1)]);
    const db = new (sqlite().DatabaseSync)(path, { readOnly: true });
    const rows = db.prepare('select kind, ref, jev from candidates order by kind, ref').all();
    db.close();
    expect(rows).toEqual([
      { kind: 'pr', ref: JSON.stringify({ url: prUrl(7) }), jev: 'off' },
      { kind: 'session', ref: JSON.stringify({ harness: 'claude', sessionId: sid(1) }), jev: 'off' },
      { kind: 'task', ref: JSON.stringify({ id: '41' }), jev: 'off' },
    ]);
  });
});

describe('TOPIC-9.2 Links first', () => {
  it('TOPIC-9.2: Links read both ways, with the Link’s reason; tied to members of two Topics, one per Topic', () => {
    const a = { id: 'a', title: 'A', notes: '', state: 'open' as const, createdAt: 0, updatedAt: 0, outputs: null, pos: null, members: [{ ...PR(812), key: key(PR(812)), addedAt: 0, reason: '' }] };
    const b = { ...a, id: 'b', members: [{ ...PR(812), key: key(PR(812)), addedAt: 0, reason: '' }, { ...SESSION(9), key: key(SESSION(9)), addedAt: 0, reason: '' }] };
    const archived = { ...a, id: 'c', state: 'archived' as const };
    const w = work(
      [workPr(812, { links: { tasks: [{ id: '41', title: 'Light the lanterns', sources: ['branch'] }], sessions: [link(1, 'started on this PR', 'fix-ci')], incomplete: false } })],
      [workTask('77', { title: 'Oil the hinges', links: { prs: [], sessions: [link(9, 'started on this Task', 'hinge work')], incomplete: false } })],
    );
    const ties = linkTies(w, [a, b, archived]).map((t) => [key(t.member), t.topicId, t.reason]);
    expect(ties).toEqual(
      expect.arrayContaining([
        [key(SESSION(1)), 'a', 'started on PR #812'],
        [key(SESSION(1)), 'b', 'started on PR #812'],
        [key(TASK('41')), 'a', "PR #812's branch names it"],
        [key(TASK('77')), 'b', 'hinge work started on it'],
      ]),
    );
    expect(ties).toHaveLength(5);
    expect(ties.some(([, t]) => t === 'c')).toBe(false);
  });

  it('TOPIC-9.2: a candidate a Work read Links to a member becomes a recommendation for that Topic with no Jev call, and isn’t asked later', async () => {
    const { topics } = setup();
    const t = topics.create('Rates');
    topics.addMember(t.id, PR(812));
    const jev = fakeJev([]);
    let now = Date.now();
    const { r } = recommender(topics, jev.runner, { now: () => now });
    r.observeSessions([row(1, { title: 'fix-ci' })]);
    r.observeWork(work([workPr(812, { links: { tasks: [], sessions: [link(1, 'started on this PR', 'fix-ci')], incomplete: false } })]));
    now += JEV_SETTLE_MS + 1_000;
    r.kick();
    await settled(r);
    expect(topics.view().recommendations).toEqual([expect.objectContaining({ key: key(SESSION(1)), topicId: t.id, source: 'link', confidence: null, reason: 'started on PR #812' })]);
    expect(jev.calls).toEqual([]);
  });
});

describe('TOPIC-9.3 Jev second', () => {
  it('TOPIC-9.3: one ask with the Open Topics as choices plus new and none, and the item’s text and each Topic as state; a pick at 0.6 or above is a recommendation, "Jev, 82%"', async () => {
    const { topics } = setup();
    const t = topics.create('Harbor lanterns');
    topics.update(t.id, { notes: 'Service every lantern on the pier' });
    topics.addMember(t.id, TASK('41', 'Light the harbor lanterns'));
    topics.create('Anvil work');
    const jev = fakeJev([picked(t.id, 0.82)]);
    const { r } = recommender(topics, jev.runner, { now: () => Date.now() + JEV_SETTLE_MS });
    r.observeSessions([row(1, { title: 'replace wicks' })]);
    await settled(r);
    expect(jev.calls).toHaveLength(1);
    const { args, stdin } = jev.calls[0]!;
    expect(args).toEqual(['ask', '--questions', 'topics@1', '--questions-dir', expect.any(String), '--state', '-', '--timeout-ms', '3000', '--caller', 'lookout-topics', '--subject', `session:${sid(1)}`, '--on-error', 'closed', '--format', 'json']);
    expect(JSON.parse(stdin!)).toEqual({
      item: { kind: 'session', title: 'replace wicks', text: 'Replace the lantern wicks before tonight' },
      // Most recently changed first, as the tab lists them.
      topics: [expect.objectContaining({ title: 'Anvil work', members: [] }), expect.objectContaining({ title: 'Harbor lanterns', notes: 'Service every lantern on the pier', members: ['Light the harbor lanterns'] })],
    });
    const set = JSON.parse(readFileSync(join(args[4]!, 'topics@1.json'), 'utf8'));
    expect(Object.keys(set.questions.topic.criteria)).toEqual([expect.any(String), expect.any(String), 'new', 'none']);
    expect(set.questions.topic.criteria[t.id]).toBe('Harbor lanterns: Service every lantern on the pier; members: Light the harbor lanterns');
    expect(topics.view().recommendations).toEqual([expect.objectContaining({ topicId: t.id, source: 'jev', confidence: 0.82, reason: 'Jev, 82%' })]);
    expect(topics.view().jevAsksToday).toBe(1);
  });

  it('TOPIC-9.7, TOPIC-9.3: "new" proposes a Topic titled after the item; below 0.6, "none", a timeout or unreadable output leaves nothing and the item judged, a failure one redacted log line', async () => {
    const { topics } = setup();
    topics.create('Harbor lanterns');
    const timeout = Object.assign(new Error('timeout'), { timedOut: true, code: null }) as RunError;
    const jev = fakeJev([picked('new', 0.71), picked('none', 0.9), picked('new', 0.59), timeout, 'not json']);
    const { r, log } = recommender(topics, jev.runner, { now: () => Date.now() + JEV_SETTLE_MS });
    r.observeSessions([1, 2, 3, 4, 5].map((n) => row(n, { title: `item ${n}` })));
    await settled(r);
    expect(jev.calls).toHaveLength(5);
    expect(topics.view().recommendations).toEqual([expect.objectContaining({ topicId: null, newTitle: 'item 1', reason: 'Jev, 71%' })]);
    // TOPIC-9.7: one redacted line per failure; the switch stays as it was.
    expect(log.mock.calls.map(([l]) => l)).toEqual(['lookout: tb-jev: ask for a session failed: took too long', "lookout: tb-jev: ask for a session failed: printed something Lookout doesn't understand"]);
    r.observeSessions([1, 2, 3, 4, 5].map((n) => row(n)));
    await settled(r);
    expect(jev.calls).toHaveLength(5);
  });

  it('TOPIC-9.3: only candidates first seen while the switch is on are asked; never while it is off, Jev isn’t ready, or no Topic is Open; at most 30 an hour, one at a time', async () => {
    const { topics } = setup();
    let on = false;
    let ready = true;
    const jev = fakeJev(Array.from({ length: 40 }, () => picked('none', 0.9)));
    const { r } = recommender(topics, jev.runner, { enabled: () => on, jevReady: () => ready, now: () => Date.now() + JEV_SETTLE_MS });
    const t = topics.create('Lanterns');
    r.observeSessions([row(1)]);
    on = true;
    r.kick();
    await settled(r);
    expect(jev.calls).toEqual([]);
    topics.update(t.id, { state: 'archived' });
    r.observeSessions([row(1), row(2)]);
    await settled(r);
    expect(jev.calls).toEqual([]);
    topics.update(t.id, { state: 'open' });
    ready = false;
    r.kick();
    await settled(r);
    expect(jev.calls).toEqual([]);
    ready = true;
    r.observeSessions(Array.from({ length: 35 }, (_, i) => row(i + 2)));
    await settled(r);
    expect(jev.calls).toHaveLength(30);
    expect(jev.calls[0]!.args).toContain(`session:${sid(2)}`);
    await r.close();
  });

  it('TOPIC-9.3: a new candidate waits to settle before it is asked, so a Work read can tie it first', async () => {
    const { topics } = setup();
    topics.create('Lanterns');
    let now = Date.now();
    const jev = fakeJev([picked('none', 0.9)]);
    const { r } = recommender(topics, jev.runner, { now: () => now });
    r.observeSessions([row(1)]);
    await settled(r);
    expect(jev.calls).toEqual([]);
    // The store stamps first_seen with its own clock, a moment after `now` was read.
    now += JEV_SETTLE_MS + 1_000;
    r.kick();
    await settled(r);
    expect(jev.calls).toHaveLength(1);
    await r.close();
  });

  it('TOPIC-9.1: "Judge again" asks for an item at once, even one first seen while the switch was off; refused while Jev can’t be asked', async () => {
    const { topics } = setup();
    const t = topics.create('Lanterns');
    let on = false;
    const jev = fakeJev([picked(t.id, 0.9)]);
    const { r } = recommender(topics, jev.runner, { enabled: () => on });
    topics.judgeAgainWith = (m) => r.judgeAgain(m);
    r.observeSessions([row(1)]);
    expect(() => topics.recommend(parseRecommendationAction({ action: 'judge-again', member: SESSION(1) }))).toThrow(/Turn on "Recommend Topics with Jev"/);
    on = true;
    topics.recommend(parseRecommendationAction({ action: 'judge-again', member: SESSION(1) }));
    await settled(r);
    expect(jev.calls).toHaveLength(1);
    expect(topics.view().recommendations).toEqual([expect.objectContaining({ topicId: t.id, source: 'jev' })]);
  });
});

describe('TOPIC-9.4 and TOPIC-9.5 what you do with one', () => {
  function withRecommendations() {
    const ctx = setup();
    const { topics } = ctx;
    const a = topics.create('A');
    const b = topics.create('B');
    topics.addMember(a.id, PR(1));
    topics.addMember(b.id, PR(1));
    topics.seen([SESSION(1), SESSION(2)], 'off');
    topics.linkTies([
      { member: SESSION(1), topicId: a.id, reason: 'started on PR #1' },
      { member: SESSION(1), topicId: b.id, reason: 'started on PR #1' },
      { member: SESSION(2), topicId: a.id, reason: 'started on PR #1' },
    ]);
    topics.jevJudged(SESSION(2), { topicId: null, newTitle: 'Wick work', confidence: 0.8 });
    return { ...ctx, a, b };
  }

  it('TOPIC-9.4: Accept adds the member with where it came from, or makes the Topic and adds it; the rest stay pending', () => {
    const { topics, a, b } = withRecommendations();
    expect(topics.view().recommendations.map((r) => [r.key, r.topicId ?? r.newTitle])).toHaveLength(4);
    topics.recommend(parseRecommendationAction({ action: 'accept', key: key(SESSION(1)), topicId: a.id }));
    expect(topics.view().topics.find((t) => t.id === a.id)!.members.find((m) => m.key === key(SESSION(1)))).toMatchObject({ reason: 'from a Link' });
    const made = topics.recommend(parseRecommendationAction({ action: 'accept', key: key(SESSION(2)), topicId: null }));
    const wick = topics.view().topics.find((t) => t.id === made.topicId)!;
    expect(wick).toMatchObject({ title: 'Wick work', state: 'open' });
    expect(wick.members).toEqual([expect.objectContaining({ key: key(SESSION(2)), reason: 'from Jev, accepted' })]);
    expect(topics.view().recommendations.map((r) => [r.key, r.topicId])).toEqual(expect.arrayContaining([[key(SESSION(1)), b.id], [key(SESSION(2)), a.id]]));
  });

  it('TOPIC-9.5: Dismiss records it and adds nothing; "Other Topic…" adds it where you picked and dismisses this one; an archived Topic’s wait, hidden', () => {
    const { topics, a, b, path } = withRecommendations();
    topics.recommend(parseRecommendationAction({ action: 'dismiss', key: key(SESSION(1)), topicId: a.id }));
    const c = topics.create('C');
    topics.recommend(parseRecommendationAction({ action: 'move', key: key(SESSION(2)), topicId: a.id, to: c.id }));
    expect(topics.view().topics.find((t) => t.id === a.id)!.members.map((m) => m.key)).toEqual([key(PR(1))]);
    expect(topics.view().topics.find((t) => t.id === c.id)!.members).toEqual([expect.objectContaining({ key: key(SESSION(2)), reason: 'from a recommendation, other Topic' })]);
    topics.update(b.id, { state: 'archived' });
    expect(topics.view().recommendations.map((r) => [r.key, r.topicId ?? r.newTitle])).toEqual([[key(SESSION(2)), 'Wick work']]);
    expect(() => topics.recommend(parseRecommendationAction({ action: 'dismiss', key: key(SESSION(1)), topicId: a.id }))).toThrow(TopicsError);
    const db = new (sqlite().DatabaseSync)(path, { readOnly: true });
    expect(db.prepare("select status from recommendations where topic_id = ?").all(a.id)).toEqual([{ status: 'dismissed' }, { status: 'dismissed' }]);
    db.close();
  });

  it('TOPIC-9.4: added by hand to the Topic it was recommended for, the recommendation counts as accepted', () => {
    const { topics, a, path } = withRecommendations();
    topics.addMember(a.id, SESSION(1));
    expect(topics.view().recommendations.some((r) => r.key === key(SESSION(1)) && r.topicId === a.id)).toBe(false);
    const db = new (sqlite().DatabaseSync)(path, { readOnly: true });
    expect(db.prepare("select status from recommendations where topic_id = ? and ref like '%000000000001%'").get(a.id)).toEqual({ status: 'accepted' });
    db.close();
  });
});

describe('review fixes', () => {
  it('TOPIC-9.1: an item added to a Topic while it waits is never sent to Jev', async () => {
    const { topics } = setup();
    const t = topics.create('Lanterns');
    const jev = fakeJev([picked('none', 0.9)]);
    let now = Date.now();
    const { r } = recommender(topics, jev.runner, { now: () => now });
    r.observeSessions([row(1)]);
    topics.addMember(t.id, SESSION(1));
    now += JEV_SETTLE_MS + 1_000;
    r.kick();
    await settled(r);
    expect(jev.calls).toEqual([]);
  });

  it('TOPIC-9.7: a tb-jev that isn’t set up (exit 4) stops the asks and leaves the item waiting', async () => {
    const { topics } = setup();
    topics.create('Lanterns');
    const misconfigured = Object.assign(new Error('exit 4'), { code: 4, stdout: JSON.stringify({ status: 'misconfigured', error_reason: 'no key' }) }) as RunError;
    const jev = fakeJev([misconfigured]);
    const onNotReady = vi.fn();
    const { r, log } = recommender(topics, jev.runner, { now: () => Date.now() + JEV_SETTLE_MS, onNotReady });
    r.observeSessions([row(1), row(2)]);
    await settled(r);
    expect(jev.calls).toHaveLength(1);
    expect(onNotReady).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.map(([l]) => l)).toEqual(["lookout: tb-jev: tb-jev isn't set up (no key); asks stop for now"]);
    expect(topics.waitingForJev()).toHaveLength(2);
    await r.close();
  });

  it('TOPIC-8.4: a Topics database that fails while recording candidates is logged, and Lookout keeps running', async () => {
    const { topics } = setup();
    topics.create('Lanterns');
    const { r, log } = recommender(topics, fakeJev([]).runner);
    topics.close();
    expect(() => r.observeSessions([row(1)])).not.toThrow();
    expect(() => r.observeWork(work([workPr(7)]))).not.toThrow();
    await settled(r);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^lookout: tb-jev: recording Sessions failed: Lookout couldn't save that/));
  });

  it('TOPIC-9.3: a Link that later ties an item Jev was asked about keeps when it was asked, for "ran today"', () => {
    const dir = tempDir();
    let now = 1_000;
    const s = new TopicStore(join(dir, 'topics.db'), { now: () => now });
    const t = s.create('A');
    s.addCandidate(SESSION(1), 'waiting');
    const ref = JSON.stringify({ harness: 'claude', sessionId: sid(1) });
    s.judged('session', ref, 'none', true);
    now = 5_000;
    s.recommend({ kind: 'session', ref, topicId: t, newTitle: null, source: 'link', confidence: null, reason: 'started on PR #1' });
    s.judged('session', ref, 'link', false);
    expect(s.candidate('session', ref)).toMatchObject({ judged_at: 1_000, outcome: 'link', jev: 'asked' });
    expect(s.asksSince(2_000)).toBe(0);
    s.close();
  });
});
