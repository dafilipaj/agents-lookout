import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { OutputItem, OutputSession } from '../shared/library.ts';
import type { NewMember, TopicsView } from '../shared/topics.ts';
import { SCHEMA_VERSION, TopicStore, Topics, TopicsError, parseMember, parsePatch, parseTitle } from './topics.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempPath() {
  const dir = mkdtempSync(join(tmpdir(), 'lookout-topics-'));
  dirs.push(dir);
  return join(dir, 'lookout', 'topics.db');
}
const sqlite = () => process.getBuiltinModule('node:sqlite');

const SESSION: NewMember = { kind: 'session', ref: { harness: 'claude', sessionId: 'a1b2c3d4-0000-4000-8000-000000000001' }, snapshot: { harness: 'claude', title: 'rates-port', directory: '~/Projects/work' } };
const PR: NewMember = { kind: 'pr', ref: { url: 'https://github.com/productiveio/fantastic/pull/812' }, snapshot: { repo: 'fantastic', number: 812, title: 'Port the rates table', url: 'https://github.com/productiveio/fantastic/pull/812' } };
const TASK: NewMember = { kind: 'task', ref: { id: '4410' }, snapshot: { title: 'Rates table port', project: 'Fantastic', url: 'https://app.fantastic.productive.io/109-productive/tasks/4410' } };

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, tick: (ms = 1) => (t += ms) };
}

describe('TOPIC-8 storage', () => {
  it('TOPIC-8.1: one SQLite file the server owns, the directory 0700 and the file 0600, in WAL mode, with a schema version', () => {
    const path = tempPath();
    const store = new TopicStore(path);
    store.close();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(path, '..')).mode & 0o777).toBe(0o700);
    const db = new (sqlite().DatabaseSync)(path);
    expect(db.prepare('pragma journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(db.prepare('select v from schema_version').all()).toEqual([{ v: SCHEMA_VERSION }]);
    db.close();
    // Opened again, it's the same database: nothing is made twice.
    new TopicStore(path).close();
  });

  it('TOPIC-8.1: a database from a newer schema is refused with a reason and left as it is', () => {
    const path = tempPath();
    new TopicStore(path).close();
    const db = new (sqlite().DatabaseSync)(path);
    db.exec(`insert into schema_version (v) values (${SCHEMA_VERSION + 1})`);
    db.exec("insert into topics (id, title, notes, state, created_at, updated_at) values ('x', 'kept', '', 'open', 1, 1)");
    db.exec('pragma journal_mode = delete');
    db.close();
    const bytes = readFileSync(path);
    expect(() => new TopicStore(path)).toThrow(/written by a newer Lookout \(schema 2; this one reads 1\)/);
    // Not even its journal mode changes.
    expect(readFileSync(path).equals(bytes)).toBe(true);
    const again = new (sqlite().DatabaseSync)(path);
    expect(again.prepare('pragma journal_mode').get()).toEqual({ journal_mode: 'delete' });
    expect(again.prepare('select title from topics').all()).toEqual([{ title: 'kept' }]);
    expect(again.prepare('select max(v) as v from schema_version').get()).toEqual({ v: SCHEMA_VERSION + 1 });
    again.close();
  });

  it('TOPIC-8.2: the tables, one member row per Topic, kind and ref, one Edge per pair whichever way it goes, and refs with their keys in a fixed order', () => {
    const path = tempPath();
    const store = new TopicStore(path);
    const a = store.create('A');
    const b = store.create('B');
    // The keys arrive in another order: the stored ref is the same string, so it's the same member.
    store.addMember(a, { ...SESSION, ref: { sessionId: SESSION.ref.sessionId, harness: 'claude' } as never });
    expect(store.addMember(a, SESSION)).toBe(false);
    store.close();
    const db = new (sqlite().DatabaseSync)(path);
    const tables = (db.prepare("select name from sqlite_master where type = 'table' order by name").all() as { name: string }[]).map((t) => t.name);
    expect(tables).toEqual(['candidates', 'edges', 'members', 'recommendations', 'schema_version', 'topics']);
    const columns = (t: string) => (db.prepare(`pragma table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(columns('topics')).toEqual(['id', 'title', 'notes', 'state', 'created_at', 'updated_at', 'pos_x', 'pos_y']);
    expect(columns('members')).toEqual(['topic_id', 'kind', 'ref', 'snapshot', 'added_at', 'reason']);
    expect(columns('edges')).toEqual(['from_id', 'to_id', 'label', 'created_at']);
    expect(db.prepare('select ref from members').all()).toEqual([{ ref: `{"harness":"claude","sessionId":"${SESSION.ref.sessionId}"}` }]);
    db.exec(`insert into edges (from_id, to_id, created_at) values ('${a}', '${b}', 1)`);
    expect(() => db.exec(`insert into edges (from_id, to_id, created_at) values ('${b}', '${a}', 1)`)).toThrow(/UNIQUE/);
    expect(() => db.exec(`insert into edges (from_id, to_id, created_at) values ('${a}', '${a}', 1)`)).toThrow(/CHECK/);
    // A candidate's "New Topic" proposal can't be inserted twice, null topic_id or not.
    db.exec("insert into candidates (kind, ref, first_seen, jev) values ('pr', '{\"url\":\"u\"}', 1, 'off')");
    const proposal = "insert into recommendations (kind, ref, new_title, source, reason, created_at, status) values ('pr', '{\"url\":\"u\"}', 'T', 'jev', 'r', 1, 'pending')";
    db.exec(proposal);
    expect(() => db.exec(proposal)).toThrow(/UNIQUE/);
    db.close();
  });

  it('TOPIC-8.4: a write that fails leaves the database as it was', () => {
    const store = new TopicStore(tempPath());
    const id = store.create('Proposals rates');
    expect(() =>
      store.transaction(() => {
        store.addMember(id, TASK);
        throw new Error('half way');
      }),
    ).toThrow('half way');
    expect(store.list()[0]!.members).toEqual([]);
    store.close();
  });

  it("TOPIC-8.4: a database that can't be opened leaves the Topics view with that reason, and nothing else breaks", () => {
    const path = tempPath();
    new TopicStore(path).close();
    writeFileSync(path, 'not a database at all, but long enough to have a header'.repeat(10));
    const events: TopicsView[] = [];
    const topics = new Topics({ path, open: () => new TopicStore(path), onChange: (v) => events.push(v) });
    expect(topics.view()).toMatchObject({ state: 'error', path, topics: [] });
    expect(topics.view().reason).toMatch(/^Lookout couldn't (open|read) its Topics database/);
    expect(() => topics.create('A')).toThrow(TopicsError);
    expect(events).toEqual([]);
  });
});

describe('TOPIC-1 a Topic', () => {
  it('TOPIC-1.1: a title is trimmed, must not be empty and is cut to 120 characters; the Topic is Open with no members and a random id', () => {
    expect(parseTitle('  Proposals rates  ')).toBe('Proposals rates');
    expect(parseTitle('x'.repeat(130))).toHaveLength(120);
    for (const empty of ['', '   ', null, 7]) expect(() => parseTitle(empty)).toThrow('A Topic needs a title.');
    const store = new TopicStore(tempPath());
    const a = store.create('Proposals rates');
    const b = store.create('Proposals rates');
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).not.toBe(a);
    expect(store.list().find((t) => t.id === a)).toMatchObject({ title: 'Proposals rates', notes: '', state: 'open', members: [] });
    store.close();
  });

  it('TOPIC-1.2: notes are at most 20,000 characters; saving empty notes clears them; a title or notes change counts as a change', () => {
    expect(parsePatch({ notes: '   \n ' })).toEqual({ notes: '' });
    expect(parsePatch({ notes: 'a\r\nb' })).toEqual({ notes: 'a\nb' });
    expect(() => parsePatch({ notes: 'x'.repeat(20_001) })).toThrow('Notes can be at most 20,000 characters.');
    expect(() => parsePatch({})).toThrow('Nothing to change.');
    const c = clock();
    const store = new TopicStore(tempPath(), { now: c.now });
    const id = store.create('A');
    c.tick();
    store.update(id, { notes: 'Rounding: half up.' });
    expect(store.list()[0]).toMatchObject({ notes: 'Rounding: half up.', updatedAt: 1_001 });
    c.tick();
    store.update(id, { title: 'B', notes: '' });
    expect(store.list()[0]).toMatchObject({ title: 'B', notes: '', updatedAt: 1_002 });
    store.close();
  });

  it('TOPIC-1.3: Archive keeps the members and notes and Unarchive brings it back', () => {
    const c = clock();
    const store = new TopicStore(tempPath(), { now: c.now });
    const id = store.create('A');
    store.update(id, { notes: 'kept' });
    store.addMember(id, PR);
    c.tick(10);
    store.update(id, { state: 'archived' });
    expect(store.list()[0]).toMatchObject({ state: 'archived', notes: 'kept', members: [expect.objectContaining({ kind: 'pr' })], updatedAt: 1_000 });
    store.update(id, { state: 'open' });
    expect(store.list()[0]!.state).toBe('open');
    store.close();
  });

  it('TOPIC-1.4: Delete removes the Topic, its memberships, its Edges and its recommendations, and nothing else', () => {
    const path = tempPath();
    const store = new TopicStore(path);
    const a = store.create('A');
    const b = store.create('B');
    store.addMember(a, PR);
    store.addMember(b, PR);
    store.close();
    const db = new (sqlite().DatabaseSync)(path);
    db.exec(`insert into edges (from_id, to_id, created_at) values ('${a}', '${b}', 1)`);
    db.exec("insert into candidates (kind, ref, first_seen, jev) values ('pr', 'r', 1, 'off')");
    db.exec(`insert into recommendations (kind, ref, topic_id, source, reason, created_at, status) values ('pr', 'r', '${a}', 'link', 'r', 1, 'pending')`);
    db.close();
    const again = new TopicStore(path);
    again.delete(a);
    expect(again.list().map((t) => [t.title, t.members.length])).toEqual([['B', 1]]);
    again.close();
    const check = new (sqlite().DatabaseSync)(path);
    expect(check.prepare('select count(*) as n from edges').get()).toEqual({ n: 0 });
    expect(check.prepare('select count(*) as n from recommendations').get()).toEqual({ n: 0 });
    expect(check.prepare('select count(*) as n from candidates').get()).toEqual({ n: 1 });
    check.close();
  });
});

describe('TOPIC-2 members', () => {
  it('TOPIC-2.3: adding stores the reference and a bounded snapshot of known fields; adding it again changes nothing', () => {
    const member = parseMember({
      kind: 'pr',
      ref: { url: PR.ref.url, extra: 'dropped' },
      snapshot: { repo: 'fantastic', number: 812, title: `Port\u0000 the ${'x'.repeat(400)}`, url: 'https://evil.example/', secret: 'dropped' },
    });
    expect(member).toEqual({ kind: 'pr', ref: { url: PR.ref.url }, snapshot: { repo: 'fantastic', number: 812, title: expect.stringMatching(/^Port the x+$/), url: PR.ref.url } });
    expect(member.snapshot.title).toHaveLength(300);
    expect(parseMember({ kind: 'task', ref: { id: '4410' }, snapshot: { title: 'Rates', project: 'Fantastic', url: TASK.snapshot.url } })).toEqual({ kind: 'task', ref: { id: '4410' }, snapshot: { title: 'Rates', project: 'Fantastic', url: TASK.snapshot.url } });
    expect(parseMember({ kind: 'session', ref: SESSION.ref, snapshot: { harness: 'codex', title: 'rates-port', directory: '~/x' } })).toEqual({ ...SESSION, snapshot: { harness: 'claude', title: 'rates-port', directory: '~/x' } });
    const c = clock();
    const store = new TopicStore(tempPath(), { now: c.now });
    const id = store.create('A');
    c.tick();
    expect(store.addMember(id, member)).toBe(true);
    c.tick();
    expect(store.addMember(id, member)).toBe(false);
    expect(store.list()[0]).toMatchObject({ updatedAt: 1_001, members: [{ kind: 'pr', key: `pr:{"url":"${PR.ref.url}"}`, addedAt: 1_001, reason: 'added by hand', snapshot: member.snapshot }] });
    store.close();
  });

  it("TOPIC-2.2: a Session without a session id (<harness>:<pid>) can't be added", () => {
    expect(() => parseMember({ kind: 'session', ref: { harness: 'codex', sessionId: 'codex:4242' }, snapshot: {} })).toThrow("This Session has no session id yet, so it can't be added. Send it a first prompt.");
  });

  it('TOPIC-2.6: a run is refused until tb-flow exists', () => {
    expect(() => parseMember({ kind: 'run', ref: { runId: 'r1' }, snapshot: {} })).toThrow('A run can be added once tb-flow exists.');
  });

  it('TOPIC-2.4: an item can be in any number of Topics, and Remove takes away that membership only', () => {
    const store = new TopicStore(tempPath());
    const a = store.create('A');
    const b = store.create('B');
    for (const id of [a, b]) {
      store.addMember(id, SESSION);
      store.addMember(id, TASK);
    }
    expect(store.removeMember(a, 'session', `{"harness":"claude","sessionId":"${SESSION.ref.sessionId}"}`)).toBe(true);
    const list = store.list();
    expect(list.find((t) => t.id === a)!.members.map((m) => m.kind)).toEqual(['task']);
    expect(list.find((t) => t.id === b)!.members.map((m) => m.kind)).toEqual(['session', 'task']);
    store.close();
  });
});

function output(key: string, updatedAt: number, sessions: Partial<OutputSession>[]): OutputItem {
  return {
    kind: 'file', key, type: 'markdown', title: key, path: `/tmp/${key}.md`, url: null, display: `~/${key}.md`, projectPath: null, repo: null, createdAt: updatedAt, updatedAt, events: 1, exists: true,
    source: null, sourcePath: null, sourceDisplay: null, version: null,
    sessions: sessions.map((s) => ({ sessionId: 'x', harness: 'claude', headless: false, title: 't', projectPath: null, projectDisplay: null, repo: null, branch: null, lastActiveAt: null, snippet: null, firstPrompt: null, blocked: null, event: 'write', pruned: false, ...s })),
  };
}

describe('TOPIC-4.4 and TOPIC-8.3 the view', () => {
  it("TOPIC-4.4: a Topic lists the Outputs its Sessions touched, from the Library's last read, newest first, at most 10, with how many there are", () => {
    const path = tempPath();
    const views: TopicsView[] = [];
    const topics = new Topics({ path, open: () => new TopicStore(path), onChange: (v) => views.push(v) });
    const t = topics.create('A');
    topics.addMember(t.id, SESSION);
    topics.addMember(t.id, PR);
    const empty = topics.create('No Sessions');
    expect(topics.view().topics.every((x) => x.outputs === null)).toBe(true);
    const mine = { sessionId: SESSION.ref.sessionId, harness: 'claude' as const };
    const items = [
      ...Array.from({ length: 12 }, (_, i) => output(`o${i}`, 100 + i, [mine])),
      output('other', 999, [{ sessionId: 'someone-else' }]),
      output('codex-same-id', 998, [{ ...mine, harness: 'codex' }]),
      output('gone', 50, [{ sessionId: 'pruned-one', pruned: true }]),
    ];
    topics.libraryRead(items);
    const view = topics.view();
    const outputs = view.topics.find((x) => x.id === t.id)!.outputs!;
    expect(outputs.total).toBe(12);
    expect(outputs.items.map((i) => i.key)).toEqual(['o11', 'o10', 'o9', 'o8', 'o7', 'o6', 'o5', 'o4', 'o3', 'o2']);
    expect(view.topics.find((x) => x.id === empty.id)!.outputs).toEqual({ items: [], total: 0 });
    expect(view.pruned).toEqual(['claude:pruned-one']);
    expect(view.libraryReadAt).toEqual(expect.any(Number));
    expect(views.at(-1)).toBe(view);
    // TOPIC-4.2: the Library says which Sessions its events had pruned, Outputs it kept or not.
    topics.libraryRead(items, ['codex:dropped-output', 'claude:pruned-one']);
    expect(topics.view().pruned).toEqual(['claude:pruned-one', 'codex:dropped-output']);
  });

  it('TOPIC-8.1: nothing is made on disk until the first change', () => {
    const path = tempPath();
    const topics = new Topics({ path, open: () => new TopicStore(path), exists: () => existsSync(path), onChange: () => {} });
    expect(topics.view()).toMatchObject({ state: 'ok', topics: [] });
    expect(existsSync(join(path, '..'))).toBe(false);
    topics.create('A');
    expect(existsSync(path)).toBe(true);
    expect(new Topics({ path, open: () => new TopicStore(path), exists: () => existsSync(path), onChange: () => {} }).view().topics.map((t) => t.title)).toEqual(['A']);
  });

  it('TOPIC-8.3: every change sends the whole set once; a write that changes nothing sends nothing', () => {
    const path = tempPath();
    const views: TopicsView[] = [];
    const topics = new Topics({ path, open: () => new TopicStore(path), onChange: (v) => views.push(v) });
    const t = topics.create('A');
    expect(views).toHaveLength(1);
    expect(topics.addMember(t.id, TASK)).toEqual({ added: true, title: 'A' });
    expect(topics.addMember(t.id, TASK)).toEqual({ added: false, title: 'A' });
    expect(views).toHaveLength(2);
    expect(views[1]!.topics[0]!.members).toHaveLength(1);
    expect(() => topics.update('00000000-0000-4000-8000-000000000000', { title: 'x' })).toThrow('That Topic no longer exists.');
  });
});
