import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { OutputItem } from '../shared/library.ts';
import {
  MAX_TOPIC_NOTES,
  MAX_TOPIC_OUTPUTS,
  MAX_TOPIC_TITLE,
  MEMBER_KINDS,
  type MemberKind,
  type NewMember,
  type Topic,
  type TopicMember,
  type TopicOutputs,
  type TopicState,
  type TopicsView,
  refText,
  sortTopics,
} from '../shared/topics.ts';
import type { Harness } from '../shared/types.ts';
import { SESSION_ID } from './history.ts';

/**
 * TOPIC-8: Topics in one SQLite database the server owns, `~/.lookout/topics.db`, through Node's
 * built-in `node:sqlite`: synchronous, one transaction per mutation, WAL. TOPIC-4.4: the Outputs of a
 * Topic's Sessions come from the Library's last read, joined here; a Session's Status and a PR's or
 * Task's state are joined in the browser, where the Session list and Work's snapshot already are.
 */

/** TOPIC-8.1: the schema this server writes and reads; a newer one is refused, never overwritten. */
export const SCHEMA_VERSION = 1;

/** TOPIC-2.3: snapshots are bounded on write. */
const MAX_SNAPSHOT_TITLE = 300;
const MAX_SNAPSHOT_PATH = 1024;

export const defaultTopicsPath = (env: NodeJS.ProcessEnv = process.env) => join(env.HOME || homedir(), '.lookout', 'topics.db');

/** A refused or failed request, with a plain reason and the HTTP status that says what kind. */
export class TopicsError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const SCHEMA = `
create table schema_version (v integer not null);
create table topics (id text primary key, title text not null, notes text not null default '',
  state text not null check (state in ('open','archived')), created_at integer not null,
  updated_at integer not null, pos_x real, pos_y real);
create table members (topic_id text not null references topics(id) on delete cascade,
  kind text not null check (kind in ('session','pr','task','run')), ref text not null,
  snapshot text not null, added_at integer not null, reason text not null,
  primary key (topic_id, kind, ref));
create table edges (from_id text not null references topics(id) on delete cascade,
  to_id text not null references topics(id) on delete cascade, label text, created_at integer not null,
  primary key (from_id, to_id), check (from_id <> to_id));
create unique index edges_pair on edges (min(from_id, to_id), max(from_id, to_id));
create table candidates (kind text not null, ref text not null, first_seen integer not null,
  jev text not null check (jev in ('waiting','asked','off')), judged_at integer,
  outcome text check (outcome in ('link','jev','none')), primary key (kind, ref));
create table recommendations (kind text not null, ref text not null,
  topic_id text references topics(id) on delete cascade, new_title text,
  source text not null check (source in ('link','jev')), confidence real, reason text not null,
  created_at integer not null, status text not null check (status in ('pending','accepted','dismissed')),
  check ((topic_id is null) <> (new_title is null)),
  foreign key (kind, ref) references candidates(kind, ref) on delete cascade);
create unique index recommendations_topic on recommendations (kind, ref, topic_id) where topic_id is not null;
create unique index recommendations_new on recommendations (kind, ref) where topic_id is null;
`;

/**
 * `node:sqlite` is experimental in Node 25 and says so once, on stderr, when it's first loaded
 * (Known gaps): that one warning is dropped; every other goes through.
 */
function loadSqlite(): typeof import('node:sqlite') {
  const emit = process.emitWarning;
  process.emitWarning = function (warning: string | Error, ...rest: unknown[]) {
    const message = typeof warning === 'string' ? warning : warning.message;
    if (/^SQLite is an experimental feature/.test(message)) return;
    return (emit as (...args: unknown[]) => void).call(process, warning, ...rest);
  } as typeof process.emitWarning;
  try {
    return process.getBuiltinModule('node:sqlite');
  } finally {
    process.emitWarning = emit;
  }
}

/** Plain text on one line, without control or format characters, cut to `max`. */
function line(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

const object = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const HARNESSES: readonly Harness[] = ['claude', 'codex'];
const TASK_ID = /^[0-9]{1,20}$/;

function httpsUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 2048) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password ? v : null;
  } catch {
    return null;
  }
}

/** TOPIC-1.1: trimmed, not empty, cut to 120 characters. */
export function parseTitle(v: unknown): string {
  const t = line(v, MAX_TOPIC_TITLE);
  if (!t) throw new TopicsError(400, 'A Topic needs a title.');
  return t;
}

/**
 * TOPIC-2.3: a member as "Add to Topic" sends it, with only the fields the server knows and every
 * string bounded. TOPIC-2.2: a Session without a session_id (`<harness>:<pid>`) is refused, and
 * TOPIC-2.6: so is a run, until `tb-flow` exists.
 */
export function parseMember(body: unknown): NewMember {
  const b = object(body);
  const kind = b.kind;
  if (!MEMBER_KINDS.includes(kind as MemberKind)) throw new TopicsError(400, 'Unknown member kind.');
  if (kind === 'run') throw new TopicsError(400, 'A run can be added once tb-flow exists.');
  const ref = object(b.ref);
  const snap = object(b.snapshot);
  if (kind === 'session') {
    const harness = ref.harness as Harness;
    if (!HARNESSES.includes(harness)) throw new TopicsError(400, 'Unknown Harness.');
    if (typeof ref.sessionId !== 'string' || !SESSION_ID.test(ref.sessionId)) {
      throw new TopicsError(400, "This Session has no session id yet, so it can't be added. Send it a first prompt.");
    }
    return {
      kind,
      ref: { harness, sessionId: ref.sessionId },
      snapshot: { harness, title: line(snap.title, MAX_SNAPSHOT_TITLE) ?? ref.sessionId, directory: line(snap.directory, MAX_SNAPSHOT_PATH) },
    };
  }
  if (kind === 'pr') {
    const url = httpsUrl(ref.url);
    if (!url) throw new TopicsError(400, 'A PR needs its https URL.');
    const n = snap.number;
    return {
      kind,
      ref: { url },
      snapshot: {
        repo: line(snap.repo, MAX_SNAPSHOT_TITLE) ?? '',
        number: typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : 0,
        title: line(snap.title, MAX_SNAPSHOT_TITLE) ?? url,
        url,
      },
    };
  }
  if (typeof ref.id !== 'string' || !TASK_ID.test(ref.id)) throw new TopicsError(400, 'A Task needs its Productive id.');
  return {
    kind: 'task',
    ref: { id: ref.id },
    snapshot: { title: line(snap.title, MAX_SNAPSHOT_TITLE) ?? `Task ${ref.id}`, project: line(snap.project, MAX_SNAPSHOT_TITLE), url: httpsUrl(snap.url) ?? '' },
  };
}

/** TOPIC-2.4: the member "Remove" names: its kind and ref, as stored. */
export function parseMemberRef(body: unknown): { kind: MemberKind; ref: string } {
  const b = object(body);
  if (!MEMBER_KINDS.includes(b.kind as MemberKind) || b.kind === 'run') throw new TopicsError(400, 'Unknown member kind.');
  const kind = b.kind as Exclude<MemberKind, 'run'>;
  const ref = object(b.ref);
  if (kind === 'session') return { kind, ref: refText(kind, { harness: ref.harness as Harness, sessionId: String(ref.sessionId) }) };
  if (kind === 'pr') return { kind, ref: refText(kind, { url: String(ref.url) }) };
  return { kind, ref: refText(kind, { id: String(ref.id) }) };
}

/** TOPIC-1.2, TOPIC-1.3: what `PUT /api/topics/<id>` may change. */
export interface TopicPatch {
  title?: string;
  notes?: string;
  state?: TopicState;
}
export function parsePatch(body: unknown): TopicPatch {
  const b = object(body);
  const patch: TopicPatch = {};
  if ('title' in b) patch.title = parseTitle(b.title);
  if ('notes' in b) {
    if (typeof b.notes !== 'string') throw new TopicsError(400, 'Notes are text.');
    if (b.notes.length > MAX_TOPIC_NOTES) throw new TopicsError(400, `Notes can be at most ${MAX_TOPIC_NOTES.toLocaleString('en-US')} characters.`);
    // TOPIC-1.2: empty notes clear them; whitespace only counts as empty.
    patch.notes = b.notes.trim() ? b.notes.replace(/\r\n?/g, '\n') : '';
  }
  if ('state' in b) {
    if (b.state !== 'open' && b.state !== 'archived') throw new TopicsError(400, 'A Topic is open or archived.');
    patch.state = b.state;
  }
  if (!Object.keys(patch).length) throw new TopicsError(400, 'Nothing to change.');
  return patch;
}

interface TopicRow {
  id: string;
  title: string;
  notes: string;
  state: TopicState;
  created_at: number;
  updated_at: number;
}
interface MemberRow {
  topic_id: string;
  kind: MemberKind;
  ref: string;
  snapshot: string;
  added_at: number;
  reason: string;
}

/** TOPIC-8: the store. Every method is synchronous; a mutation is one transaction (TOPIC-8.4). */
export class TopicStore {
  readonly path: string;
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private depth = 0;

  /** Opens (or makes) the database; throws a TopicsError saying why it can't (TOPIC-8.1, TOPIC-8.4). */
  constructor(path: string, opts: { now?: () => number } = {}) {
    this.path = path;
    this.now = opts.now ?? Date.now;
    const { DatabaseSync } = loadSqlite();
    try {
      // As `~/.lookout/attachments/` is made: the directory 0700, the file 0600.
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      chmodSync(dirname(path), 0o700);
      this.db = new DatabaseSync(path);
      chmodSync(path, 0o600);
      this.db.exec('pragma busy_timeout = 2000;');
    } catch (err) {
      throw new TopicsError(503, `Lookout couldn't open its Topics database: ${plain(err)}`);
    }
    // The version is read before any pragma that writes, so a newer database is left as it is (TOPIC-8.1).
    const version = this.version();
    if (version !== null && version > SCHEMA_VERSION) {
      this.db.close();
      throw new TopicsError(503, `The Topics database was written by a newer Lookout (schema ${version}; this one reads ${SCHEMA_VERSION}). Update Lookout; the file is left as it is.`);
    }
    this.db.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
    if (version === null) {
      this.transaction(() => {
        this.db.exec(SCHEMA);
        this.db.prepare('insert into schema_version (v) values (?)').run(SCHEMA_VERSION);
      });
    }
  }

  close(): void {
    this.db.close();
  }

  /** The stored schema version, or null for a database with none yet. */
  private version(): number | null {
    const table = this.db.prepare("select name from sqlite_master where type = 'table' and name = 'schema_version'").get();
    if (!table) return null;
    const row = this.db.prepare('select max(v) as v from schema_version').get() as { v: number | null } | undefined;
    return row?.v ?? null;
  }

  /** TOPIC-8.4: the whole of `fn`, or nothing of it; a transaction inside one is part of it. */
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.db.exec('begin immediate');
    this.depth++;
    try {
      const out = fn();
      this.db.exec('commit');
      return out;
    } catch (err) {
      this.db.exec('rollback');
      throw err;
    } finally {
      this.depth--;
    }
  }

  /** Every Topic with its members, most recently changed first (TOPIC-3.2). Outputs are joined by `Topics`. */
  list(): Omit<Topic, 'outputs'>[] {
    const topics = this.db.prepare('select id, title, notes, state, created_at, updated_at from topics').all() as unknown as TopicRow[];
    const members = this.db.prepare('select topic_id, kind, ref, snapshot, added_at, reason from members order by added_at, kind, ref').all() as unknown as MemberRow[];
    const byTopic = new Map<string, TopicMember[]>();
    for (const m of members) {
      const member = toMember(m);
      if (!member) continue;
      const list = byTopic.get(m.topic_id) ?? [];
      list.push(member);
      byTopic.set(m.topic_id, list);
    }
    return sortTopics(
      topics.map((t) => ({ id: t.id, title: t.title, notes: t.notes, state: t.state, createdAt: t.created_at, updatedAt: t.updated_at, members: byTopic.get(t.id) ?? [], outputs: null })),
    ).map(({ outputs: _, ...t }) => t);
  }

  /** TOPIC-1.1: an Open Topic with no members, under a new random id, never reused. */
  create(title: string): string {
    const id = randomUUID();
    const at = this.now();
    this.transaction(() => {
      this.db.prepare("insert into topics (id, title, notes, state, created_at, updated_at) values (?, ?, '', 'open', ?, ?)").run(id, title, at, at);
    });
    return id;
  }

  /** TOPIC-1.2, TOPIC-1.3: a title or notes change counts as a change (TOPIC-3.2); archiving doesn't. */
  update(id: string, patch: TopicPatch): void {
    this.transaction(() => {
      this.require(id);
      if (patch.title !== undefined) this.db.prepare('update topics set title = ?, updated_at = ? where id = ?').run(patch.title, this.now(), id);
      if (patch.notes !== undefined) this.db.prepare('update topics set notes = ?, updated_at = ? where id = ?').run(patch.notes, this.now(), id);
      if (patch.state !== undefined) this.db.prepare('update topics set state = ? where id = ?').run(patch.state, id);
    });
  }

  /** TOPIC-1.4: the Topic and its own rows (members, Edges, recommendations, by cascade); nothing else. */
  delete(id: string): void {
    this.transaction(() => {
      this.require(id);
      this.db.prepare('delete from topics where id = ?').run(id);
    });
  }

  /**
   * TOPIC-2.3: adds the member with its snapshot; false when it's already a member, which changes
   * nothing. A membership change is a change (TOPIC-3.2).
   */
  addMember(id: string, member: NewMember, reason = 'added by hand'): boolean {
    return this.transaction(() => {
      this.require(id);
      const at = this.now();
      const r = this.db
        .prepare('insert or ignore into members (topic_id, kind, ref, snapshot, added_at, reason) values (?, ?, ?, ?, ?, ?)')
        .run(id, member.kind, refText(member.kind, member.ref), JSON.stringify(member.snapshot), at, reason);
      if (Number(r.changes) === 0) return false;
      this.db.prepare('update topics set updated_at = ? where id = ?').run(at, id);
      return true;
    });
  }

  /** TOPIC-2.4: that membership and nothing else; false when it wasn't one. */
  removeMember(id: string, kind: MemberKind, ref: string): boolean {
    return this.transaction(() => {
      this.require(id);
      const r = this.db.prepare('delete from members where topic_id = ? and kind = ? and ref = ?').run(id, kind, ref);
      if (Number(r.changes) === 0) return false;
      this.db.prepare('update topics set updated_at = ? where id = ?').run(this.now(), id);
      return true;
    });
  }

  title(id: string): string {
    return this.require(id).title;
  }

  private require(id: string): TopicRow {
    const row = this.db.prepare('select id, title, notes, state, created_at, updated_at from topics where id = ?').get(id) as unknown as TopicRow | undefined;
    if (!row) throw new TopicsError(404, 'That Topic no longer exists.');
    return row;
  }
}

function toMember(m: MemberRow): TopicMember | null {
  try {
    const ref = JSON.parse(m.ref) as Record<string, unknown>;
    const snapshot = JSON.parse(m.snapshot) as Record<string, unknown>;
    const base = { key: `${m.kind}:${m.ref}`, addedAt: m.added_at, reason: m.reason };
    if (m.kind === 'session') return { ...base, kind: 'session', ref: ref as never, snapshot: snapshot as never };
    if (m.kind === 'pr') return { ...base, kind: 'pr', ref: ref as never, snapshot: snapshot as never };
    if (m.kind === 'task') return { ...base, kind: 'task', ref: ref as never, snapshot: snapshot as never };
    return null; // a run (slice 4)
  } catch {
    return null;
  }
}

/** An error's message without paths beyond the one Lookout names itself. */
function plain(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EACCES' || code === 'EPERM') return 'permission denied.';
  if (code === 'ENOSPC') return 'the disk is full.';
  const message = err instanceof Error ? err.message : String(err);
  return /not a database|malformed/i.test(message) ? 'the file is not a SQLite database Lookout can read.' : 'it could not be read.';
}

export interface TopicsOptions {
  /** Opens the store; a TopicsError leaves the Topics tab with its reason and the rest of Lookout working (TOPIC-8.4). */
  open(): TopicStore;
  path: string;
  /** Whether the file is there yet: until it is, and until the first change, nothing is made on disk. */
  exists?(): boolean;
  /** TOPIC-8.3: the whole set, to every tab, when it changes. */
  onChange(view: TopicsView): void;
}

/** TOPIC-8.3: the store as the server serves it, with the Library's Outputs joined (TOPIC-4.4). */
export class Topics {
  private store: TopicStore | null = null;
  private failure: string | null = null;
  private readonly opts: TopicsOptions;
  /** TOPIC-4.4: the Library's last read, or null before one. */
  private outputs: OutputItem[] | null = null;
  private readAt: number | null = null;
  /** TOPIC-4.2: Sessions the last read's events say tb-session pruned, as `<harness>:<sessionId>`. */
  private pruned: string[] = [];
  private last: TopicsView;

  constructor(opts: TopicsOptions) {
    this.opts = opts;
    if (opts.exists?.() ?? true) this.openStore();
    this.last = this.build();
  }

  private openStore(): void {
    try {
      this.store = this.opts.open();
    } catch (err) {
      this.failure = err instanceof TopicsError ? err.message : `Lookout couldn't open its Topics database: ${plain(err)}`;
    }
  }

  view(): TopicsView {
    return this.last;
  }

  /**
   * TOPIC-4.4: the Library read again; its Outputs are joined to every Topic's Sessions. `pruned`
   * comes from every event the read saw, kept Output or not (TOPIC-4.2); without it, from the Outputs.
   */
  libraryRead(items: OutputItem[], pruned?: readonly string[]): void {
    this.outputs = items;
    this.pruned = [...new Set(pruned ?? items.flatMap((i) => i.sessions.flatMap((s) => (s.pruned ? [`${s.harness}:${s.sessionId}`] : []))))].sort();
    this.readAt = Date.now();
    this.changed();
  }

  create(title: string): Topic {
    const id = this.write((s) => s.create(title));
    return this.last.topics.find((t) => t.id === id)!;
  }

  update(id: string, patch: TopicPatch): Topic {
    this.write((s) => s.update(id, patch));
    return this.last.topics.find((t) => t.id === id)!;
  }

  delete(id: string): void {
    this.write((s) => s.delete(id));
  }

  /** TOPIC-2.3: `added` false, and the Topic's title, when it was already a member. */
  addMember(id: string, member: NewMember): { added: boolean; title: string } {
    const added = this.write((s) => s.addMember(id, member));
    return { added, title: this.write((s) => s.title(id), false) };
  }

  removeMember(id: string, kind: MemberKind, ref: string): void {
    this.write((s) => s.removeMember(id, kind, ref));
  }

  close(): void {
    this.store?.close();
  }

  private write<T>(fn: (store: TopicStore) => T, changes = true): T {
    // No file yet: the first change makes it (`~/.lookout` stays untouched until Topics are used).
    if (!this.store && !this.failure) this.openStore();
    if (!this.store) throw new TopicsError(503, this.failure ?? "Lookout couldn't open its Topics database.");
    let out: T;
    try {
      out = fn(this.store);
    } catch (err) {
      if (err instanceof TopicsError) throw err;
      // TOPIC-8.4: the transaction rolled back; say so plainly, never SQLite's own words.
      throw new TopicsError(500, `Lookout couldn't save that to its Topics database: ${plain(err)}`);
    }
    if (changes) this.changed();
    return out;
  }

  private changed(): void {
    const next = this.build();
    if (JSON.stringify(next) === JSON.stringify(this.last)) return;
    this.last = next;
    this.opts.onChange(next);
  }

  private build(): TopicsView {
    if (!this.store && !this.failure) return { state: 'ok', reason: null, path: this.opts.path, topics: [], pruned: [], libraryReadAt: this.readAt };
    if (!this.store) return { state: 'error', reason: this.failure, path: this.opts.path, topics: [], pruned: [], libraryReadAt: this.readAt };
    let stored: Omit<Topic, 'outputs'>[];
    try {
      stored = this.store.list();
    } catch (err) {
      return { state: 'error', reason: `Lookout couldn't read its Topics database: ${plain(err)}`, path: this.opts.path, topics: [], pruned: [], libraryReadAt: this.readAt };
    }
    const items = this.outputs;
    const topics = stored.map((t) => ({ ...t, outputs: items ? outputsOf(t.members, items) : null }));
    return { state: 'ok', reason: null, path: this.opts.path, topics, pruned: this.pruned, libraryReadAt: this.readAt };
  }
}

/** TOPIC-4.4: the Outputs any of these Session members touched, newest first, at most 10, and how many. */
function outputsOf(members: readonly TopicMember[], items: readonly OutputItem[]): TopicOutputs {
  const sessions = new Set(members.flatMap((m) => (m.kind === 'session' ? [`${m.ref.harness}:${m.ref.sessionId}`] : [])));
  if (!sessions.size) return { items: [], total: 0 };
  const touched = items.filter((i) => i.sessions.some((s) => sessions.has(`${s.harness}:${s.sessionId}`))).sort((a, b) => b.updatedAt - a.updatedAt);
  return { items: touched.slice(0, MAX_TOPIC_OUTPUTS), total: touched.length };
}
