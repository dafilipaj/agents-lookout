import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { SessionRow } from '../shared/types.ts';
import { TOPIC_LAUNCH_TTL_MS, TopicLaunches } from './topic-launches.ts';
import { TopicStore, Topics, TopicsError } from './topics.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'lookout-topic-launches-'));
  dirs.push(dir);
  const path = join(dir, 'topics.db');
  const topics = new Topics({ path, open: () => new TopicStore(path), onChange: () => {} });
  let now = 1_000_000;
  const warnings: string[] = [];
  const launches = new TopicLaunches({ topics, now: () => now, warn: (m) => warnings.push(m) });
  return { topics, launches, warnings, tick: (ms: number) => (now += ms) };
}

/** What TopicLaunches reads of a row: its id, Harness, process, title and start directory. */
const row = (over: Partial<SessionRow> & Pick<SessionRow, 'id' | 'pid'>): SessionRow => ({ harness: 'claude', title: 'rates-port', cwd: '~/Projects/work', ...over }) as SessionRow;
const SESSION_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const LAUNCH = '00000000-0000-4000-8000-0000000000aa';
const sessions = (topics: Topics, id: string) => topics.view().topics.find((t) => t.id === id)!.members.filter((m) => m.kind === 'session');

it('TOPIC-5.2 (support): a Session started from a Topic is added once Fleet reports it, with "started from this Topic" and its snapshot; one started on its Task with "started on its Task"', () => {
  const { topics, launches } = setup();
  const a = topics.create('Proposals rates');
  const b = topics.create('Lanterns');
  launches.expect(LAUNCH, { id: a.id, via: 'topic' });
  launches.expect('00000000-0000-4000-8000-0000000000bb', { id: b.id, via: 'task' });
  // Not reported yet: nothing is added.
  launches.observe([]);
  expect(sessions(topics, a.id)).toEqual([]);
  const rows = [row({ id: SESSION_ID, pid: 41 }), row({ id: 'b1b2c3d4-0000-4000-8000-000000000002', pid: 42, title: 'lanterns' })];
  launches.started([{ launchId: LAUNCH, sessionId: SESSION_ID }, { launchId: '00000000-0000-4000-8000-0000000000bb', sessionId: rows[1]!.id }], rows);
  launches.observe(rows);
  expect(sessions(topics, a.id)).toEqual([
    expect.objectContaining({ ref: { harness: 'claude', sessionId: SESSION_ID }, snapshot: { harness: 'claude', title: 'rates-port', directory: '~/Projects/work' }, reason: 'started from this Topic' }),
  ]);
  expect(sessions(topics, b.id)).toEqual([expect.objectContaining({ reason: 'started on its Task' })]);
  // Added once: a later list adds nothing again.
  launches.observe(rows);
  expect(sessions(topics, a.id)).toHaveLength(1);
});

it('TOPIC-5.2 (support): a Codex Session is followed by its process until it has a session id, then added', () => {
  const { topics, launches } = setup();
  const a = topics.create('Proposals rates');
  launches.expect(LAUNCH, { id: a.id, via: 'topic' });
  const before = row({ id: 'codex:77', pid: 77, harness: 'codex' });
  launches.started([{ launchId: LAUNCH, sessionId: 'codex:77' }], [before]);
  launches.observe([before]);
  expect(sessions(topics, a.id)).toEqual([]);
  launches.observe([row({ id: SESSION_ID, pid: 77, harness: 'codex' })]);
  expect(sessions(topics, a.id)).toEqual([expect.objectContaining({ ref: { harness: 'codex', sessionId: SESSION_ID } })]);
});

it('TOPIC-5.2 (support): nothing is added for a start that failed, a Session that ended before it had an id, a Topic deleted meanwhile, or a start never reported within an hour', () => {
  const { topics, launches, tick } = setup();
  const a = topics.create('Proposals rates');
  const gone = topics.create('Gone');
  // Failed: forgotten.
  launches.expect(LAUNCH, { id: a.id, via: 'topic' });
  launches.forget(LAUNCH);
  launches.started([{ launchId: LAUNCH, sessionId: SESSION_ID }], [row({ id: SESSION_ID, pid: 1 })]);
  launches.observe([row({ id: SESSION_ID, pid: 1 })]);
  // Ended before its id.
  launches.expect('00000000-0000-4000-8000-0000000000b1', { id: a.id, via: 'topic' });
  launches.started([{ launchId: '00000000-0000-4000-8000-0000000000b1', sessionId: 'codex:2' }], [row({ id: 'codex:2', pid: 2, harness: 'codex' })]);
  launches.observe([]);
  launches.observe([row({ id: 'c1b2c3d4-0000-4000-8000-000000000003', pid: 2, harness: 'codex' })]);
  // Its Topic deleted.
  launches.expect('00000000-0000-4000-8000-0000000000b2', { id: gone.id, via: 'topic' });
  topics.delete(gone.id);
  launches.started([{ launchId: '00000000-0000-4000-8000-0000000000b2', sessionId: 'd1b2c3d4-0000-4000-8000-000000000004' }], [row({ id: 'd1b2c3d4-0000-4000-8000-000000000004', pid: 3 })]);
  launches.observe([row({ id: 'd1b2c3d4-0000-4000-8000-000000000004', pid: 3 })]);
  // Reported after an hour.
  launches.expect('00000000-0000-4000-8000-0000000000b3', { id: a.id, via: 'topic' });
  tick(TOPIC_LAUNCH_TTL_MS + 1);
  launches.observe([]);
  launches.started([{ launchId: '00000000-0000-4000-8000-0000000000b3', sessionId: 'e1b2c3d4-0000-4000-8000-000000000005' }], [row({ id: 'e1b2c3d4-0000-4000-8000-000000000005', pid: 4 })]);
  launches.observe([row({ id: 'e1b2c3d4-0000-4000-8000-000000000005', pid: 4 })]);
  expect(sessions(topics, a.id)).toEqual([]);
});

it('TOPIC-5.2 (support): a Topic is checked before the start; one that is gone or malformed is refused with a reason', () => {
  const { topics, launches } = setup();
  const a = topics.create('Proposals rates');
  topics.update(a.id, { state: 'archived' });
  expect(launches.check(undefined)).toBeNull();
  expect(launches.check({ id: a.id, via: 'task' })).toEqual({ id: a.id, via: 'task' });
  expect(() => launches.check({ id: '00000000-0000-4000-8000-000000000999', via: 'topic' })).toThrow(new TopicsError(400, 'That Topic is gone: pick another, or none.'));
  expect(() => launches.check({ id: a.id, via: 'jev' })).toThrow('Invalid Topic.');
  expect(() => launches.check('x')).toThrow('Invalid Topic.');
});

it('TOPIC-5.2 (support): a store that fails while adding is one log line, and Lookout keeps running', () => {
  const { topics, launches, warnings } = setup();
  const a = topics.create('Proposals rates');
  launches.expect(LAUNCH, { id: a.id, via: 'topic' });
  topics.addStarted = () => {
    throw new TopicsError(500, "Lookout couldn't save that to its Topics database: disk I/O error");
  };
  launches.started([{ launchId: LAUNCH, sessionId: SESSION_ID }], [row({ id: SESSION_ID, pid: 1 })]);
  expect(() => launches.observe([row({ id: SESSION_ID, pid: 1 })])).not.toThrow();
  expect(warnings).toEqual(["lookout: adding a started Session to its Topic failed: Lookout couldn't save that to its Topics database: disk I/O error"]);
});

it('TOPIC-5.2 (support): a reported Codex Session is followed past the hour until its first prompt gives it an id', () => {
  const { topics, launches, tick } = setup();
  const a = topics.create('Proposals rates');
  launches.expect(LAUNCH, { id: a.id, via: 'topic' });
  const before = row({ id: 'codex:77', pid: 77, harness: 'codex' });
  launches.started([{ launchId: LAUNCH, sessionId: 'codex:77' }], [before]);
  tick(TOPIC_LAUNCH_TTL_MS + 1);
  launches.observe([before]);
  launches.observe([row({ id: SESSION_ID, pid: 77, harness: 'codex' })]);
  expect(sessions(topics, a.id)).toEqual([expect.objectContaining({ ref: { harness: 'codex', sessionId: SESSION_ID } })]);
});

it('TOPIC-5.2 (support), TOPIC-9.1: a started Session Fleet listed before the start answered, recorded as a candidate meanwhile, stops being one once it is added', () => {
  const { topics, launches } = setup();
  const a = topics.create('Proposals rates');
  const b = topics.create('Lanterns');
  const r = row({ id: SESSION_ID, pid: 41 });
  launches.expect(LAUNCH, { id: a.id, via: 'topic' });
  // Listed before the start answered: nothing ties it to its launch yet, so it's a candidate…
  const member = { kind: 'session' as const, ref: { harness: 'claude' as const, sessionId: SESSION_ID }, snapshot: { harness: 'claude' as const, title: 'rates-port', directory: '~/Projects/work' } };
  expect(topics.seen([member], 'waiting')).toHaveLength(1);
  topics.linkTies([{ member, topicId: b.id, reason: 'started on PR #812' }]);
  expect(topics.view().recommendations).toHaveLength(1);
  // …until the launcher reports it.
  launches.started([{ launchId: LAUNCH, sessionId: SESSION_ID }], [r]);
  launches.observe([r]);
  expect(sessions(topics, a.id)).toHaveLength(1);
  expect(topics.view().recommendations).toEqual([]);
  expect(topics.waitingForJev()).toEqual([]);
});

it('TOPIC-5.2 (support): a launch id already expected is refused, and the start it belongs to is kept', () => {
  const { topics, launches } = setup();
  const a = topics.create('Proposals rates');
  const b = topics.create('Lanterns');
  expect(launches.expect(LAUNCH, { id: a.id, via: 'topic' })).toBe(true);
  expect(launches.expect(LAUNCH, { id: b.id, via: 'topic' })).toBe(false);
  const r = row({ id: SESSION_ID, pid: 41 });
  launches.started([{ launchId: LAUNCH, sessionId: SESSION_ID }], [r]);
  launches.observe([r]);
  expect(sessions(topics, a.id)).toHaveLength(1);
  expect(sessions(topics, b.id)).toEqual([]);
});
