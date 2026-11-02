import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { OutputItem } from '../shared/library.ts';
import {
  ACTIVITY_PAGE,
  type ActivityData,
  type ActivityEntry,
  type ActivityKind,
  MAX_CLOSING,
  MAX_EDGE_LABEL,
  MAX_TOPIC_NOTES,
  MAX_TOPIC_OUTPUTS,
  MAX_TOPIC_TITLE,
  MEMBER_KINDS,
  type MemberKind,
  type NewMember,
  type Recommendation,
  type RecommendationAction,
  type RecommendationSource,
  type SummaryAnswer,
  type SummaryError,
  acceptedReason,
  type Topic,
  type TopicEdge,
  type TopicMember,
  type TopicPosition,
  type TopicOutputs,
  type TopicState,
  type TopicSummary,
  type TopicsView,
  refText,
  rowMember,
  sortTopics,
  SUPERSEDED_LABEL,
  TOPIC_OUTCOMES,
  type TopicOutcome,
  memberName,
} from '../shared/topics.ts';
import type { Harness } from '../shared/types.ts';
import { SESSION_ID } from './history.ts';
import type { SessionRow } from '../shared/types.ts';
import type { WorkSnapshot } from '../shared/work.ts';
import { type Change, type Observed, type PrObserved, type SessionObserved, type TaskObserved, observePr, observeSession, observeTask, prSightings, taskSightings } from './topic-activity.ts';

/**
 * TOPIC-8: Topics in one SQLite database the server owns, `~/.lookout/topics.db`, through Node's
 * built-in `node:sqlite`: synchronous, one transaction per mutation, WAL. TOPIC-4.4: the Outputs of a
 * Topic's Sessions come from the Library's last read, joined here; a Session's Status and a PR's or
 * Task's state are joined in the browser, where the Session list and Work's snapshot already are.
 */

/** TOPIC-8.1: the schema this server writes and reads; a newer one is refused, never overwritten. */
export const SCHEMA_VERSION = 4;

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

const SUMMARIES = `create table summaries (topic_id text primary key references topics(id) on delete cascade,
  answer text not null, written_at integer not null, model text not null, cost_usd real,
  fingerprint text not null);`;

/**
 * TOPIC-12, TOPIC-13, TOPIC-1.6, TOPIC-11.10 (slice 7): a Topic's activity, what was last seen of each
 * member, how a Topic ended, the newest entry seen, and every summary kept with the newest entry its
 * input held. The log starts empty, so every Topic has seen everything (`seen_upto` 0).
 */
const SCHEMA_4 = `
alter table topics add column outcome text check (outcome in ('done','parked','dropped','superseded'));
alter table topics add column closing text;
alter table topics add column superseded_by text;
alter table topics add column seen_upto integer not null default 0;
alter table members add column observed text;
create table events (id integer primary key autoincrement,
  topic_id text not null references topics(id) on delete cascade, at integer not null,
  kind text not null, member text, by text not null check (by in ('you','lookout')),
  data text not null default '{}');
create index events_topic on events (topic_id, id);
create index events_by on events (topic_id, by, id);
create table summaries_4 (topic_id text not null references topics(id) on delete cascade,
  answer text not null, written_at integer not null, model text not null, cost_usd real,
  fingerprint text not null, input_upto integer, primary key (topic_id, written_at));
insert into summaries_4 select topic_id, answer, written_at, model, cost_usd, fingerprint, null from summaries;
drop table summaries;
alter table summaries_4 rename to summaries;
`;

/**
 * TOPIC-8.1: each step takes the schema one version up, inside the migration's transaction. Version 2:
 * a candidate keeps what Lookout knew of it when first seen, for the "Recommended" row (TOPIC-9.4).
 * Version 3: a Topic's summary (TOPIC-11.5). Version 4: slice 7.
 */
const MIGRATIONS: Record<number, string> = {
  2: "alter table candidates add column snapshot text not null default '{}';",
  3: SUMMARIES,
  4: SCHEMA_4,
};

/** TOPIC-8.2: schema 1; later versions are its migrations (`schemaSql`). */
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

/** TOPIC-8.1: the schema as version `v` had it: schema 1 and each migration up to `v`. A new database is made at `SCHEMA_VERSION`. */
export function schemaSql(v: number): string {
  let sql = SCHEMA;
  for (let n = 2; n <= v; n++) sql += `\n${MIGRATIONS[n]!}`;
  return sql;
}

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

/** A member key (`<kind>:<ref as stored>`) back to its kind and canonical ref. */
export function parseKey(key: unknown): { kind: MemberKind; ref: string } {
  if (typeof key !== 'string' || key.length > 4096) throw new TopicsError(400, 'Unknown item.');
  const at = key.indexOf(':');
  let ref: unknown;
  try {
    ref = JSON.parse(key.slice(at + 1));
  } catch {
    throw new TopicsError(400, 'Unknown item.');
  }
  return parseMemberRef({ kind: key.slice(0, at), ref });
}

const TOPIC_ID = /^[0-9a-f-]{36}$/;

/** TOPIC-9.4: what `POST /api/topics/recommendations` may ask. */
export function parseRecommendationAction(body: unknown): RecommendationAction {
  const b = object(body);
  if (b.action === 'judge-again') return { action: 'judge-again', member: parseMember(b.member) };
  if (b.action !== 'accept' && b.action !== 'dismiss' && b.action !== 'move') throw new TopicsError(400, 'Accept, Dismiss, Other Topic or Judge again.');
  const key = parseKey(b.key);
  const topicId = b.topicId === null ? null : typeof b.topicId === 'string' && TOPIC_ID.test(b.topicId) ? b.topicId : undefined;
  if (topicId === undefined) throw new TopicsError(400, 'Which recommendation?');
  const k = `${key.kind}:${key.ref}`;
  if (b.action !== 'move') return { action: b.action, key: k, topicId };
  if (typeof b.to !== 'string' || !TOPIC_ID.test(b.to)) throw new TopicsError(400, 'Pick a Topic.');
  return { action: 'move', key: k, topicId, to: b.to };
}

/** TOPIC-1.2, TOPIC-1.3, TOPIC-1.6: what `PUT /api/topics/<id>` may change. */
export interface TopicPatch {
  title?: string;
  notes?: string;
  state?: TopicState;
  /** TOPIC-1.6: with `state: 'archived'` only, and required there. */
  outcome?: TopicOutcome;
  closing?: string | null;
  supersededBy?: string;
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
  if (patch.state === 'archived') {
    // TOPIC-1.6: an archive says how the Topic ended.
    if (!TOPIC_OUTCOMES.includes(b.outcome as TopicOutcome)) throw new TopicsError(400, 'Say how it ended: done, parked, dropped or superseded.');
    patch.outcome = b.outcome as TopicOutcome;
    if (b.closing !== undefined && b.closing !== null && typeof b.closing !== 'string') throw new TopicsError(400, 'A closing line is text.');
    patch.closing = line(b.closing, MAX_CLOSING);
    if (patch.outcome === 'superseded') patch.supersededBy = topicId(b.supersededBy, 'Pick the Topic that superseded it.');
  } else if ('outcome' in b || 'closing' in b || 'supersededBy' in b) {
    throw new TopicsError(400, 'How a Topic ended goes with archiving it.');
  }
  if (!Object.keys(patch).length) throw new TopicsError(400, 'Nothing to change.');
  return patch;
}

/** The other Topic a request names, by id. */
function topicId(v: unknown, message: string): string {
  if (typeof v !== 'string' || !TOPIC_ID.test(v)) throw new TopicsError(400, message);
  return v;
}

/** TOPIC-6.1: an Edge's label: one line, at most 60 characters; empty is none. */
function edgeLabel(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new TopicsError(400, 'A label is text.');
  return line(v, MAX_EDGE_LABEL);
}

/** TOPIC-6.1: `POST /api/topics/<id>/edges`: the Topic it goes to, and its label. */
export function parseLink(body: unknown): { to: string; label: string | null } {
  const b = object(body);
  return { to: topicId(b.to, 'Pick a Topic to link to.'), label: edgeLabel(b.label) };
}

/** TOPIC-6.2, TOPIC-7.4: `PUT /api/topics/<id>/edges`: the Edge with that Topic, a new label, or turned around. */
export interface EdgeEdit {
  other: string;
  label?: string | null;
  reverse?: true;
}
export function parseEdgeEdit(body: unknown): EdgeEdit {
  const b = object(body);
  const edit: EdgeEdit = { other: topicId(b.other, 'Which Edge?') };
  if ('label' in b) edit.label = edgeLabel(b.label);
  if (b.reverse === true) edit.reverse = true;
  if (!('label' in edit) && !edit.reverse) throw new TopicsError(400, 'Nothing to change.');
  return edit;
}

/** TOPIC-6.2: `DELETE /api/topics/<id>/edges`: the Edge with that Topic. */
export function parseUnlink(body: unknown): { other: string } {
  return { other: topicId(object(body).other, 'Which Edge?') };
}

/** TOPIC-7.2: how far from the origin a node may be placed. */
const MAX_POSITION = 100_000;
const MAX_POSITIONS = 500;

/** TOPIC-7.2: `PUT /api/topics/positions`: nodes placed, dragged or arranged, one or many. */
export function parsePositions(body: unknown): { id: string; pos: TopicPosition }[] {
  const list = object(body).positions;
  if (!Array.isArray(list) || !list.length || list.length > MAX_POSITIONS) throw new TopicsError(400, 'Which nodes?');
  return list.map((v) => {
    const p = object(v);
    const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_POSITION;
    if (!ok(p.x) || !ok(p.y)) throw new TopicsError(400, 'A position is two numbers.');
    return { id: topicId(p.id, 'Which node?'), pos: { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 } };
  });
}

interface TopicRow {
  id: string;
  title: string;
  notes: string;
  state: TopicState;
  created_at: number;
  updated_at: number;
  pos_x: number | null;
  pos_y: number | null;
  outcome: TopicOutcome | null;
  closing: string | null;
  superseded_by: string | null;
  seen_upto: number;
}
const TOPIC_COLUMNS = 'id, title, notes, state, created_at, updated_at, pos_x, pos_y, outcome, closing, superseded_by, seen_upto';
interface EventRow {
  id: number;
  topic_id: string;
  at: number;
  kind: ActivityKind;
  member: string | null;
  by: 'you' | 'lookout';
  data: string;
}
/** TOPIC-12: per Topic, what the `topics` event carries of its activity. */
interface ActivityCounts {
  last: ActivityEntry | null;
  lastId: number;
  newCount: number;
  sinceSummary: number;
  earlier: number;
}
interface EdgeRow {
  from_id: string;
  to_id: string;
  label: string | null;
  created_at: number;
}
export interface CandidateRow {
  kind: MemberKind;
  ref: string;
  first_seen: number;
  jev: 'waiting' | 'asked' | 'off';
  judged_at: number | null;
  outcome: 'link' | 'jev' | 'none' | null;
  snapshot: string;
}
const CANDIDATE_COLUMNS = 'kind, ref, first_seen, jev, judged_at, outcome, snapshot';
interface RecommendationRow {
  kind: MemberKind;
  ref: string;
  topic_id: string | null;
  new_title: string | null;
  source: RecommendationSource;
  confidence: number | null;
  reason: string;
  created_at: number;
  snapshot: string;
}
interface SummaryRow {
  topic_id: string;
  answer: string;
  written_at: number;
  model: string;
  cost_usd: number | null;
  fingerprint: string;
  input_upto: number | null;
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
        this.db.exec(schemaSql(SCHEMA_VERSION));
        this.db.prepare('insert into schema_version (v) values (?)').run(SCHEMA_VERSION);
      });
    } else if (version < SCHEMA_VERSION) {
      this.migrate(version);
    }
  }

  /** TOPIC-8.1: an older database is copied to `topics.db.bak-<version>` first, then migrated forward in one transaction. */
  private migrate(from: number): void {
    const backup = `${this.path}.bak-${from}`;
    try {
      rmSync(backup, { force: true });
      // A consistent copy of a WAL database, unlike copying the file.
      this.db.prepare('vacuum into ?').run(backup);
      chmodSync(backup, 0o600);
      this.transaction(() => {
        for (let v = from + 1; v <= SCHEMA_VERSION; v++) {
          this.db.exec(MIGRATIONS[v]!);
          this.db.prepare('insert into schema_version (v) values (?)').run(v);
        }
      });
    } catch (err) {
      this.db.close();
      throw new TopicsError(503, `Lookout couldn't update its Topics database from schema ${from}: ${plain(err)} The file is left as it was.`);
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

  /** Every Topic with its members and place, most recently changed first (TOPIC-3.2). Outputs are joined by `Topics`. */
  list(): StoredTopic[] {
    const topics = this.db.prepare(`select ${TOPIC_COLUMNS} from topics`).all() as unknown as TopicRow[];
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
      topics.map((t) => ({
        id: t.id,
        title: t.title,
        notes: t.notes,
        state: t.state,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        members: byTopic.get(t.id) ?? [],
        outputs: null,
        pos: t.pos_x === null || t.pos_y === null ? null : { x: t.pos_x, y: t.pos_y },
        summary: null,
        summaryStale: false,
        outcome: t.state === 'archived' ? t.outcome : null,
        closing: t.state === 'archived' ? t.closing : null,
        supersededBy: t.state === 'archived' ? parseSuperseded(t.superseded_by) : null,
        lastActivity: null,
        lastEntryId: 0,
        seenUpto: t.seen_upto,
        newCount: 0,
        changesSinceSummary: 0,
        earlierSummaries: 0,
      })),
    ).map(({ outputs: _o, summary: _s, summaryStale: _st, ...t }) => t);
  }

  /**
   * TOPIC-12.1: one entry in a Topic's log, in the caller's transaction. The member's name and the
   * other Topic's title go into `data` now, so the entry reads after a Remove or a Delete.
   */
  private log(topicId: string, kind: ActivityKind, member: string | null, by: 'you' | 'lookout', data: ActivityData = {}): number {
    const r = this.db.prepare('insert into events (topic_id, at, kind, member, by, data) values (?, ?, ?, ?, ?, ?)').run(topicId, this.now(), kind, member, by, JSON.stringify(data));
    return Number(r.lastInsertRowid);
  }

  /** TOPIC-6.2: an Edge entry on both its Topics, each saying the other. */
  private logEdge(kind: ActivityKind, from: string, to: string, data: ActivityData = {}): void {
    this.log(from, kind, null, 'you', { ...data, dir: 'to', otherId: to, other: this.require(to).title });
    this.log(to, kind, null, 'you', { ...data, dir: 'from', otherId: from, other: this.require(from).title });
  }

  /** TOPIC-3.8, TOPIC-11.10, TOPIC-13.1: each Topic's latest entry by Lookout and its counts. */
  activityCounts(): Map<string, ActivityCounts> {
    const out = new Map<string, ActivityCounts>();
    const rows = this.db
      .prepare(
        `select t.id,
           (select max(id) from events where topic_id = t.id) as last_id,
           (select max(id) from events where topic_id = t.id and by = 'lookout') as last_lookout,
           (select count(*) from events where topic_id = t.id and by = 'lookout' and id > t.seen_upto) as new_count,
           (select count(*) from summaries where topic_id = t.id) as summaries,
           s.input_upto, s.written_at
         from topics t left join summaries s on s.topic_id = t.id and s.written_at = (select max(written_at) from summaries where topic_id = t.id)`,
      )
      .all() as unknown as { id: string; last_id: number | null; last_lookout: number | null; new_count: number; summaries: number; input_upto: number | null; written_at: number | null }[];
    const since = this.db.prepare("select count(*) as n from events where topic_id = ? and kind <> 'summary' and id > ?");
    const sinceAt = this.db.prepare("select count(*) as n from events where topic_id = ? and kind <> 'summary' and at > ?");
    const one = this.db.prepare('select id, topic_id, at, kind, member, by, data from events where id = ?');
    for (const r of rows) {
      const sinceSummary = r.written_at === null ? 0 : ((r.input_upto === null ? sinceAt.get(r.id, r.written_at) : since.get(r.id, r.input_upto)) as { n: number }).n;
      const lastRow = r.last_lookout === null ? undefined : (one.get(r.last_lookout) as unknown as EventRow | undefined);
      out.set(r.id, { last: lastRow ? toEntry(lastRow) : null, lastId: r.last_id ?? 0, newCount: r.new_count, sinceSummary, earlier: Math.max(0, r.summaries - 1) });
    }
    return out;
  }

  /** TOPIC-12.3: entries newest first, before an entry id (the next page) or from the newest. */
  activity(id: string, before: number | null, limit = ACTIVITY_PAGE): ActivityEntry[] {
    this.require(id);
    const rows = (before === null
      ? this.db.prepare('select id, topic_id, at, kind, member, by, data from events where topic_id = ? order by id desc limit ?').all(id, limit)
      : this.db.prepare('select id, topic_id, at, kind, member, by, data from events where topic_id = ? and id < ? order by id desc limit ?').all(id, before, limit)) as unknown as EventRow[];
    return rows.map(toEntry);
  }

  /** TOPIC-11.3: a Topic's latest entries, oldest first, for a summary's input; and the newest id it holds. */
  recentActivity(id: string, limit: number): { entries: ActivityEntry[]; upto: number } {
    const entries = this.activity(id, null, limit).reverse();
    const row = this.db.prepare('select max(id) as n from events where topic_id = ?').get(id) as { n: number | null };
    return { entries, upto: row.n ?? 0 };
  }

  /** TOPIC-13.1: seen up to that entry; only ever moved forward. */
  seenUpTo(id: string, upto: number): void {
    this.transaction(() => {
      this.require(id);
      this.db.prepare('update topics set seen_upto = max(seen_upto, ?) where id = ?').run(upto, id);
    });
  }

  /**
   * TOPIC-12.2: every member's `observed` compared with what Lookout sees now, by `step`, which says
   * nothing (null) for members this sighting doesn't cover. The entries and every `observed` that
   * changed are written in one transaction; returns how many entries.
   */
  observe(step: (m: { kind: MemberKind; ref: string; snapshot: string; observed: Observed | null }) => { next: Observed | null; changes: Change[]; name?: string | undefined } | null): number {
    return this.transaction(() => {
      const rows = this.db.prepare('select topic_id, kind, ref, snapshot, observed from members').all() as unknown as (MemberRow & { observed: string | null })[];
      const write = this.db.prepare('update members set observed = ? where topic_id = ? and kind = ? and ref = ?');
      let n = 0;
      for (const r of rows) {
        const prev = r.observed ? jsonOr<Observed | null>(r.observed, null) : null;
        const out = step({ kind: r.kind, ref: r.ref, snapshot: r.snapshot, observed: prev });
        if (!out) continue;
        if (out.next !== null) {
          const next = JSON.stringify(out.next);
          if (next !== r.observed) write.run(next, r.topic_id, r.kind, r.ref);
        }
        if (!out.changes.length) continue;
        const member = toMember(r);
        const name = out.name ?? (member ? memberName(member) : r.ref);
        for (const c of out.changes) {
          this.log(r.topic_id, c.kind, `${r.kind}:${r.ref}`, 'lookout', { name, ...c.data });
          n++;
        }
      }
      return n;
    });
  }

  /** TOPIC-1.1: an Open Topic with no members, under a new random id, never reused. */
  create(title: string): string {
    const id = randomUUID();
    const at = this.now();
    this.transaction(() => {
      this.db.prepare("insert into topics (id, title, notes, state, created_at, updated_at) values (?, ?, '', 'open', ?, ?)").run(id, title, at, at);
      // TOPIC-13.1: a new Topic starts with nothing new.
      const made = this.log(id, 'made', null, 'you');
      this.db.prepare('update topics set seen_upto = ? where id = ?').run(made, id);
    });
    return id;
  }

  /**
   * TOPIC-1.2, TOPIC-1.3: a title or notes change counts as a change (TOPIC-3.2); archiving doesn't.
   * TOPIC-1.6: archiving keeps how it ended, and "Superseded by…" draws its Edge unless the pair has
   * one; unarchiving clears how it ended. TOPIC-12.1: each is an entry.
   */
  update(id: string, patch: TopicPatch): void {
    this.transaction(() => {
      const row = this.require(id);
      if (patch.title !== undefined && patch.title !== row.title) {
        this.db.prepare('update topics set title = ?, updated_at = ? where id = ?').run(patch.title, this.now(), id);
        this.log(id, 'title', null, 'you', { to: patch.title });
      }
      if (patch.notes !== undefined && patch.notes !== row.notes) {
        this.db.prepare('update topics set notes = ?, updated_at = ? where id = ?').run(patch.notes, this.now(), id);
        this.log(id, 'notes', null, 'you');
      }
      // TOPIC-1.6: archived already (another tab did it): say so, so its outcome isn't silently dropped.
      if (patch.state === 'archived' && row.state === 'archived') throw new TopicsError(409, 'That Topic is already archived.');
      if (patch.state === 'archived') {
        let superseded: { id: string; title: string } | null = null;
        if (patch.supersededBy !== undefined) {
          if (patch.supersededBy === id) throw new TopicsError(400, "A Topic can't supersede itself.");
          superseded = { id: patch.supersededBy, title: this.require(patch.supersededBy).title };
          if (!this.edge(id, patch.supersededBy)) {
            this.db.prepare('insert into edges (from_id, to_id, label, created_at) values (?, ?, ?, ?)').run(id, patch.supersededBy, SUPERSEDED_LABEL, this.now());
            this.touch(id, patch.supersededBy);
            this.logEdge('edge-drawn', id, patch.supersededBy, { label: SUPERSEDED_LABEL });
          }
        }
        this.db
          .prepare("update topics set state = 'archived', outcome = ?, closing = ?, superseded_by = ? where id = ?")
          .run(patch.outcome ?? null, patch.closing ?? null, superseded ? JSON.stringify(superseded) : null, id);
        const data: ActivityData = { outcome: patch.outcome };
        if (patch.closing) data.closing = patch.closing;
        if (superseded) Object.assign(data, { otherId: superseded.id, other: superseded.title });
        this.log(id, 'archived', null, 'you', data);
      } else if (patch.state === 'open' && row.state !== 'open') {
        this.db.prepare("update topics set state = 'open', outcome = null, closing = null, superseded_by = null where id = ?").run(id);
        this.log(id, 'unarchived', null, 'you');
      }
    });
  }

  /** TOPIC-1.4: the Topic and its own rows (members, Edges, recommendations, its summary, by cascade); nothing else. */
  delete(id: string): void {
    this.transaction(() => {
      const row = this.require(id);
      // TOPIC-12.1: its Edges go with it; each other Topic's activity says so.
      for (const e of this.db.prepare('select from_id, to_id, label, created_at from edges where from_id = ? or to_id = ?').all(id, id) as unknown as EdgeRow[]) {
        const other = e.from_id === id ? e.to_id : e.from_id;
        this.log(other, 'edge-unlinked', null, 'you', { dir: e.from_id === id ? 'from' : 'to', otherId: id, other: row.title });
      }
      this.db.prepare('delete from topics where id = ?').run(id);
    });
  }

  /**
   * TOPIC-2.3: adds the member with its snapshot; false when it's already a member, which changes
   * nothing. A membership change is a change (TOPIC-3.2).
   */
  addMember(id: string, member: NewMember, reason = 'added by hand', by: 'you' | 'lookout' = 'you'): boolean {
    return this.transaction(() => {
      this.require(id);
      const at = this.now();
      const r = this.db
        .prepare('insert or ignore into members (topic_id, kind, ref, snapshot, added_at, reason) values (?, ?, ?, ?, ?, ?)')
        .run(id, member.kind, refText(member.kind, member.ref), JSON.stringify(member.snapshot), at, reason);
      if (Number(r.changes) === 0) return false;
      this.log(id, 'added', `${member.kind}:${refText(member.kind, member.ref)}`, by, { name: memberName(member), reason });
      this.db.prepare('update topics set updated_at = ? where id = ?').run(at, id);
      // TOPIC-9.4: added by hand to the Topic it was recommended for, the recommendation was right.
      this.db.prepare("update recommendations set status = 'accepted' where kind = ? and ref = ? and topic_id = ? and status = 'pending'").run(member.kind, refText(member.kind, member.ref), id);
      return true;
    });
  }

  /** TOPIC-2.4: that membership and nothing else; false when it wasn't one. */
  removeMember(id: string, kind: MemberKind, ref: string): boolean {
    return this.transaction(() => {
      this.require(id);
      const row = this.db.prepare('select topic_id, kind, ref, snapshot, added_at, reason from members where topic_id = ? and kind = ? and ref = ?').get(id, kind, ref) as unknown as MemberRow | undefined;
      if (!row) return false;
      this.db.prepare('delete from members where topic_id = ? and kind = ? and ref = ?').run(id, kind, ref);
      this.db.prepare('update topics set updated_at = ? where id = ?').run(this.now(), id);
      const member = toMember(row);
      this.log(id, 'removed', `${kind}:${ref}`, 'you', { name: member ? memberName(member) : ref });
      return true;
    });
  }

  title(id: string): string {
    return this.require(id).title;
  }

  /** TOPIC-6: every Edge, oldest first. */
  edges(): TopicEdge[] {
    const rows = this.db.prepare('select from_id, to_id, label, created_at from edges order by created_at, from_id, to_id').all() as unknown as EdgeRow[];
    return rows.map((e) => ({ from: e.from_id, to: e.to_id, label: e.label, createdAt: e.created_at }));
  }

  /** The Edge between two Topics, whichever way it goes, or null. */
  private edge(a: string, b: string): EdgeRow | null {
    const row = this.db.prepare('select from_id, to_id, label, created_at from edges where (from_id = ? and to_id = ?) or (from_id = ? and to_id = ?)').get(a, b, b, a);
    return (row as unknown as EdgeRow | undefined) ?? null;
  }

  /** TOPIC-3.2: an Edge change is a change to both its Topics. */
  private touch(...ids: string[]): void {
    const at = this.now();
    for (const id of ids) this.db.prepare('update topics set updated_at = ? where id = ?').run(at, id);
  }

  /**
   * TOPIC-6.1: an Edge from one Topic to another. Two Topics have at most one, whichever way it goes,
   * and a Topic can't be linked to itself.
   */
  link(from: string, to: string, label: string | null): void {
    if (from === to) throw new TopicsError(400, "A Topic can't be linked to itself.");
    this.transaction(() => {
      this.require(from);
      this.require(to);
      if (this.edge(from, to)) throw new TopicsError(409, 'Already linked.');
      this.db.prepare('insert into edges (from_id, to_id, label, created_at) values (?, ?, ?, ?)').run(from, to, label, this.now());
      this.touch(from, to);
      this.logEdge('edge-drawn', from, to, { label });
    });
  }

  /** TOPIC-6.2, TOPIC-7.4: a new label, or the Edge turned around ("Reverse"), on either of its Topics. */
  editEdge(id: string, edit: EdgeEdit): void {
    this.transaction(() => {
      this.require(id);
      const e = this.edge(id, edit.other);
      if (!e) throw new TopicsError(404, 'Those Topics are no longer linked.');
      if (edit.label !== undefined && edit.label !== e.label) {
        this.db.prepare('update edges set label = ? where from_id = ? and to_id = ?').run(edit.label, e.from_id, e.to_id);
        this.logEdge('edge-label', e.from_id, e.to_id, { label: edit.label });
      }
      // One update swaps both columns: SQLite reads the old values on the right.
      if (edit.reverse) {
        this.db.prepare('update edges set from_id = to_id, to_id = from_id where from_id = ? and to_id = ?').run(e.from_id, e.to_id);
        this.logEdge('edge-reversed', e.to_id, e.from_id);
      }
      this.touch(e.from_id, e.to_id);
    });
  }

  /** TOPIC-6.2: "Unlink" on either Topic removes the Edge. */
  unlink(id: string, other: string): void {
    this.transaction(() => {
      this.require(id);
      const e = this.edge(id, other);
      if (!e) throw new TopicsError(404, 'Those Topics are no longer linked.');
      this.db.prepare('delete from edges where from_id = ? and to_id = ?').run(e.from_id, e.to_id);
      this.touch(e.from_id, e.to_id);
      this.logEdge('edge-unlinked', e.from_id, e.to_id);
    });
  }

  /** TOPIC-7.2: nodes placed, all or none; moving a node isn't a change to its Topic (TOPIC-3.2). */
  place(positions: readonly { id: string; pos: TopicPosition }[]): void {
    this.transaction(() => {
      for (const { id, pos } of positions) {
        this.require(id);
        this.db.prepare('update topics set pos_x = ?, pos_y = ? where id = ?').run(pos.x, pos.y, id);
      }
    });
  }

  /**
   * TOPIC-5.2: a Session Lookout started for a Topic was never a candidate (TOPIC-9.1). Fleet can list
   * it before the start answers, so it may have been recorded as one meanwhile: that row and its
   * recommendations go.
   */
  forgetCandidate(kind: MemberKind, ref: string): void {
    this.transaction(() => {
      this.db.prepare('delete from candidates where kind = ? and ref = ?').run(kind, ref);
    });
  }

  /** Whether the item is a member of any Topic, or of this one. */
  isMember(kind: MemberKind, ref: string, topicId?: string): boolean {
    const row = topicId === undefined
      ? this.db.prepare('select 1 from members where kind = ? and ref = ? limit 1').get(kind, ref)
      : this.db.prepare('select 1 from members where kind = ? and ref = ? and topic_id = ?').get(kind, ref, topicId);
    return row !== undefined;
  }

  /**
   * TOPIC-9.1: the item becomes a candidate once, with what Lookout knows of it now; false when it
   * already was one. `jev` is `waiting` while "Recommend Topics with Jev" is on, `off` while it isn't.
   */
  addCandidate(member: NewMember, jev: 'waiting' | 'off'): boolean {
    return this.transaction(() => {
      const r = this.db
        .prepare('insert or ignore into candidates (kind, ref, first_seen, jev, snapshot) values (?, ?, ?, ?, ?)')
        .run(member.kind, refText(member.kind, member.ref), this.now(), jev, JSON.stringify(member.snapshot));
      return Number(r.changes) > 0;
    });
  }

  candidate(kind: MemberKind, ref: string): CandidateRow | null {
    return (this.db.prepare(`select ${CANDIDATE_COLUMNS} from candidates where kind = ? and ref = ?`).get(kind, ref) as unknown as CandidateRow | undefined) ?? null;
  }

  /** TOPIC-9.3: candidates Links haven't tied that wait for Jev, oldest first. */
  waitingForJev(): CandidateRow[] {
    // An item that joined a Topic meanwhile is no longer "in no Topic" (TOPIC-9.1): never a billed ask.
    return this.db
      .prepare(`select ${CANDIDATE_COLUMNS} from candidates c where jev = 'waiting' and judged_at is null and not exists (select 1 from members m where m.kind = c.kind and m.ref = c.ref) order by first_seen, kind, ref`)
      .all() as unknown as CandidateRow[];
  }

  /**
   * TOPIC-9.2, TOPIC-9.3: a proposal for the candidate; false when the item already has one for that
   * Topic (or a "New Topic" one), whatever its status, so a dismissed one never comes back.
   */
  recommend(r: { kind: MemberKind; ref: string; topicId: string | null; newTitle: string | null; source: RecommendationSource; confidence: number | null; reason: string }): boolean {
    return this.transaction(() => {
      const out = this.db
        .prepare("insert or ignore into recommendations (kind, ref, topic_id, new_title, source, confidence, reason, created_at, status) values (?, ?, ?, ?, ?, ?, ?, ?, 'pending')")
        .run(r.kind, r.ref, r.topicId, r.topicId === null ? r.newTitle : null, r.source, r.confidence, r.reason, this.now());
      return Number(out.changes) > 0;
    });
  }

  /** TOPIC-9.1: judged by a Link or by Jev (`asked`), once. */
  judged(kind: MemberKind, ref: string, outcome: 'link' | 'jev' | 'none', asked: boolean): void {
    this.transaction(() => {
      this.db
        // A Link that ties an item Jev already judged keeps when Jev was asked ("ran today" counts asks).
        .prepare(`update candidates set judged_at = case when ? = 0 and jev = 'asked' then judged_at else ? end, outcome = ?, jev = case when ? then 'asked' else jev end where kind = ? and ref = ?`)
        .run(asked ? 1 : 0, this.now(), outcome, asked ? 1 : 0, kind, ref);
    });
  }

  /** TOPIC-9.1: "Judge again": the item waits for Jev again; what was accepted or dismissed stays. */
  judgeAgain(member: NewMember): void {
    this.transaction(() => {
      this.addCandidate(member, 'waiting');
      this.db.prepare("update candidates set jev = 'waiting', judged_at = null, outcome = null where kind = ? and ref = ?").run(member.kind, refText(member.kind, member.ref));
    });
  }

  /** TOPIC-9.3: Jev asks since then (the Settings line's "ran today"). */
  asksSince(at: number): number {
    const row = this.db.prepare("select count(*) as n from candidates where jev = 'asked' and judged_at >= ?").get(at) as { n: number };
    return row.n;
  }

  /**
   * TOPIC-9.4: pending recommendations, newest first, without the ones for an archived Topic or one
   * the item has joined since.
   */
  pending(): Recommendation[] {
    const rows = this.db
      .prepare(
        `select r.kind, r.ref, r.topic_id, r.new_title, r.source, r.confidence, r.reason, r.created_at, c.snapshot
         from recommendations r join candidates c on c.kind = r.kind and c.ref = r.ref
         left join topics t on t.id = r.topic_id
         where r.status = 'pending' and (r.topic_id is null or t.state = 'open')
           and not exists (select 1 from members m where m.kind = r.kind and m.ref = r.ref and m.topic_id = r.topic_id)
         order by r.created_at desc, r.kind, r.ref`,
      )
      .all() as unknown as RecommendationRow[];
    return rows.flatMap((r) => {
      const member = toMember({ topic_id: '', kind: r.kind, ref: r.ref, snapshot: r.snapshot, added_at: 0, reason: '' });
      if (!member) return [];
      const { key, addedAt: _a, reason: _r, ...item } = member;
      return [{ key, member: item as NewMember, topicId: r.topic_id, newTitle: r.new_title, source: r.source, confidence: r.confidence, reason: r.reason, createdAt: r.created_at }];
    });
  }

  /** TOPIC-9.4, TOPIC-9.5: one recommendation's row, or null when there's none pending. */
  pendingOne(kind: MemberKind, ref: string, topicId: string | null): RecommendationRow | null {
    const row = topicId === null
      ? this.db.prepare("select r.*, c.snapshot from recommendations r join candidates c using (kind, ref) where r.kind = ? and r.ref = ? and r.topic_id is null and r.status = 'pending'").get(kind, ref)
      : this.db.prepare("select r.*, c.snapshot from recommendations r join candidates c using (kind, ref) where r.kind = ? and r.ref = ? and r.topic_id = ? and r.status = 'pending'").get(kind, ref, topicId);
    return (row as unknown as RecommendationRow | undefined) ?? null;
  }

  /** TOPIC-9.4, TOPIC-9.5: Accept or Dismiss records what you did with it. */
  resolve(kind: MemberKind, ref: string, topicId: string | null, status: 'accepted' | 'dismissed'): void {
    this.transaction(() => {
      if (topicId === null) this.db.prepare("update recommendations set status = ? where kind = ? and ref = ? and topic_id is null and status = 'pending'").run(status, kind, ref);
      else this.db.prepare("update recommendations set status = ? where kind = ? and ref = ? and topic_id = ? and status = 'pending'").run(status, kind, ref, topicId);
    });
  }

  /**
   * TOPIC-11.5: the summary just written becomes the Topic's, and the ones before it are kept
   * (TOPIC-11.10); `inputUpto` is the newest entry its input held. A summary is an entry by you.
   */
  saveSummary(id: string, summary: TopicSummary, fingerprint: string, inputUpto: number | null = null): void {
    this.transaction(() => {
      this.require(id);
      this.db
        .prepare('insert or replace into summaries (topic_id, answer, written_at, model, cost_usd, fingerprint, input_upto) values (?, ?, ?, ?, ?, ?, ?)')
        .run(id, JSON.stringify(summary.answer), summary.writtenAt, summary.model, summary.costUsd, fingerprint, inputUpto);
      this.log(id, 'summary', null, 'you');
    });
  }

  /** TOPIC-11.5: each Topic's newest summary, by Topic id, with the fingerprint it was written at. */
  summaries(): Map<string, { summary: TopicSummary; fingerprint: string }> {
    const rows = this.db
      .prepare('select topic_id, answer, written_at, model, cost_usd, fingerprint, input_upto from summaries s where written_at = (select max(written_at) from summaries where topic_id = s.topic_id)')
      .all() as unknown as SummaryRow[];
    const out = new Map<string, { summary: TopicSummary; fingerprint: string }>();
    for (const r of rows) {
      const summary = toSummary(r);
      if (summary) out.set(r.topic_id, { summary, fingerprint: r.fingerprint });
    }
    return out;
  }

  /** TOPIC-11.10: a Topic's earlier summaries, newest first, without its current one. */
  earlierSummaries(id: string): TopicSummary[] {
    this.require(id);
    const rows = this.db
      .prepare('select topic_id, answer, written_at, model, cost_usd, fingerprint, input_upto from summaries where topic_id = ? order by written_at desc limit -1 offset 1')
      .all(id) as unknown as SummaryRow[];
    return rows.flatMap((r) => toSummary(r) ?? []);
  }

  private require(id: string): TopicRow {
    const row = this.db.prepare(`select ${TOPIC_COLUMNS} from topics where id = ?`).get(id) as unknown as TopicRow | undefined;
    if (!row) throw new TopicsError(404, 'That Topic no longer exists.');
    return row;
  }
}

/** A Topic as the store holds it, before the Library's Outputs and its summary are joined. */
type StoredTopic = Omit<Topic, 'outputs' | 'summary' | 'summaryStale'>;

function parseSuperseded(v: string | null): { id: string; title: string } | null {
  if (!v) return null;
  try {
    const o = JSON.parse(v) as { id?: unknown; title?: unknown };
    return typeof o.id === 'string' && typeof o.title === 'string' ? { id: o.id, title: o.title } : null;
  } catch {
    return null;
  }
}

const refUrl = (ref: string): string => String((JSON.parse(ref) as { url?: unknown }).url ?? '');
const refId = (ref: string): string => String((JSON.parse(ref) as { id?: unknown }).id ?? '');

/** Stored JSON, or `fallback` when it doesn't parse. */
function jsonOr<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function toEntry(r: EventRow): ActivityEntry {
  const data = jsonOr<ActivityData>(r.data, {});
  return { id: r.id, at: r.at, kind: r.kind, member: r.member, by: r.by, data };
}

/** TOPIC-11.4: a stored answer; one from before slice 7 reads its new fields as empty. */
function toSummary(r: SummaryRow): TopicSummary | null {
  let answer: SummaryAnswer;
  try {
    answer = JSON.parse(r.answer) as SummaryAnswer;
  } catch {
    return null;
  }
  return { answer: { ...answer, openMore: answer.openMore ?? 0, watch: answer.watch ?? [] }, writtenAt: r.written_at, model: r.model, costUsd: r.cost_usd };
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

/**
 * TOPIC-11.5: what a summary was written from: the Topic's member keys, sorted, and its notes. A
 * member's Status, CI or Task status isn't in it, so a change there leaves the summary current.
 */
export function summaryFingerprint(topic: { members: readonly { key: string }[]; notes: string }): string {
  return createHash('sha256').update(JSON.stringify([topic.members.map((m) => m.key).sort(), topic.notes])).digest('hex');
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
  /** TOPIC-11.6: the Topics a summary is being written for, and why each one's last run failed. */
  private summarizing: string[] = [];
  private summaryErrors: Record<string, SummaryError> = {};
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
    this.summarizer?.deleted(id);
  }

  /** TOPIC-11: set by the server: summaries are written by the Summarizer, and a deleted Topic's run stops. */
  summarizer: { start(id: string): void; cancel(id: string): void; deleted(id: string): void } | null = null;

  /** TOPIC-11.1. */
  summarize(id: string): void {
    if (!this.summarizer) throw new TopicsError(404, 'Summaries are off here.');
    this.summarizer.start(id);
  }

  /** TOPIC-11.6. */
  cancelSummary(id: string): void {
    this.summarizer?.cancel(id);
  }

  /** TOPIC-11.6: the Summarizer's runs and errors, for every tab. */
  summaryRuns(summarizing: readonly string[], errors: Readonly<Record<string, SummaryError>>): void {
    this.summarizing = [...summarizing];
    this.summaryErrors = { ...errors };
    this.changed();
  }

  /** TOPIC-11.5: a summary just written, with the fingerprint of what it was written from. */
  saveSummary(id: string, summary: TopicSummary, fingerprint: string, inputUpto: number | null = null): void {
    this.write((s) => s.saveSummary(id, summary, fingerprint, inputUpto));
  }

  /** TOPIC-12.3: `GET /api/topics/<id>/activity`. */
  activity(id: string, before: number | null): ActivityEntry[] {
    return this.write((s) => s.activity(id, before), false);
  }

  /** TOPIC-11.3: the latest entries for a summary's input, oldest first, and the newest id held; none before the store exists. */
  recentActivity(id: string, limit: number): { entries: ActivityEntry[]; upto: number } {
    if (!this.store) return { entries: [], upto: 0 };
    return this.write((s) => s.recentActivity(id, limit), false);
  }

  /** TOPIC-11.10: `GET /api/topics/<id>/summaries`. */
  earlierSummaries(id: string): TopicSummary[] {
    return this.write((s) => s.earlierSummaries(id), false);
  }

  /** TOPIC-13.1: `PUT /api/topics/<id>/seen`. */
  seenUpTo(id: string, upto: number): void {
    this.write((s) => s.seenUpTo(id, upto));
  }

  /**
   * TOPIC-12.2: what Lookout sees now against what it last saw of each member. Nothing happens before
   * the store exists; a failure is the caller's to log (TOPIC-8.4).
   */
  observe(step: Parameters<TopicStore['observe']>[0]): void {
    if (!this.store) return;
    const n = this.write((s) => s.observe(step), false);
    if (n) this.changed();
  }

  /** TOPIC-12.1: Fleet's list: a member Session live again, or ended. */
  observeSessions(rows: readonly SessionRow[]): void {
    const live = new Map<string, string>();
    for (const r of rows) {
      const m = rowMember(r);
      if (m) live.set(refText(m.kind, m.ref), m.snapshot.title);
    }
    this.observe((m) => {
      if (m.kind !== 'session') return null;
      return { ...observeSession(m.observed as SessionObserved | null, live.has(m.ref)), name: live.get(m.ref) };
    });
  }

  /** TOPIC-12.1: a Work read: member PRs and Tasks gone, back, or changed; `email` is the one Tasks were read for. */
  observeWork(work: WorkSnapshot, email: string | null): void {
    const pr = prSightings(work);
    const task = taskSightings(work, email);
    this.observe((m) => {
      if (m.kind === 'pr') {
        const prev = m.observed as PrObserved | null;
        return observePr(prev, pr(refUrl(m.ref), prev));
      }
      if (m.kind === 'task') return observeTask(m.observed as TaskObserved | null, task(refId(m.ref)));
      return null;
    });
  }

  /** TOPIC-2.3: `added` false, and the Topic's title, when it was already a member. */
  addMember(id: string, member: NewMember): { added: boolean; title: string } {
    const added = this.write((s) => s.addMember(id, member));
    return { added, title: this.write((s) => s.title(id), false) };
  }

  removeMember(id: string, kind: MemberKind, ref: string): void {
    this.write((s) => s.removeMember(id, kind, ref));
  }

  /** TOPIC-5.2: whether a Topic of that id exists, Open or Archived. */
  has(id: string): boolean {
    return this.last.topics.some((t) => t.id === id);
  }

  /** TOPIC-5.2: a Session Lookout started for this Topic, with the reason it was added; false when it already was a member. */
  addStarted(id: string, member: NewMember, reason: string): boolean {
    return this.write((s) =>
      s.transaction(() => {
        const added = s.addMember(id, member, reason, 'lookout');
        s.forgetCandidate(member.kind, refText(member.kind, member.ref));
        return added;
      }),
    );
  }

  /** TOPIC-6.1. */
  link(from: string, to: string, label: string | null): void {
    this.write((s) => s.link(from, to, label));
  }

  /** TOPIC-6.2, TOPIC-7.4. */
  editEdge(id: string, edit: EdgeEdit): void {
    this.write((s) => s.editEdge(id, edit));
  }

  /** TOPIC-6.2. */
  unlink(id: string, other: string): void {
    this.write((s) => s.unlink(id, other));
  }

  /** TOPIC-7.2. */
  place(positions: readonly { id: string; pos: TopicPosition }[]): void {
    this.write((s) => s.place(positions));
  }

  /**
   * TOPIC-9.1: the items in no Topic become candidates, once each; returns the ones new now. Nothing
   * is recorded before the store exists (no Topic, nothing to recommend into, nothing made on disk).
   */
  seen(members: readonly NewMember[], jev: 'waiting' | 'off'): NewMember[] {
    if (!this.store || !members.length) return [];
    return this.write(
      (s) => s.transaction(() => members.filter((m) => !s.isMember(m.kind, refText(m.kind, m.ref)) && s.addCandidate(m, jev))),
      false,
    );
  }

  /**
   * TOPIC-9.2: Links that tie a candidate to a member of an Open Topic become recommendations for it,
   * each once; the candidate counts as judged by a Link. Returns how many are new.
   */
  linkTies(ties: readonly { member: NewMember; topicId: string; reason: string }[]): number {
    if (!this.store || !ties.length) return 0;
    const open = new Set(this.last.topics.filter((t) => t.state === 'open').map((t) => t.id));
    const added = this.write((s) =>
      s.transaction(() => {
        let n = 0;
        for (const t of ties) {
          const ref = refText(t.member.kind, t.member.ref);
          if (!open.has(t.topicId) || !s.candidate(t.member.kind, ref) || s.isMember(t.member.kind, ref, t.topicId)) continue;
          if (!s.recommend({ kind: t.member.kind, ref, topicId: t.topicId, newTitle: null, source: 'link', confidence: null, reason: t.reason })) continue;
          s.judged(t.member.kind, ref, 'link', false);
          n++;
        }
        return n;
      }),
    );
    return added;
  }

  /** TOPIC-9.3: candidates waiting for Jev, oldest first; none before the store exists. */
  waitingForJev(): { member: NewMember; firstSeen: number }[] {
    if (!this.store) return [];
    return this.write((s) => s.waitingForJev(), false).flatMap((c) => {
      const m = toMember({ topic_id: '', kind: c.kind, ref: c.ref, snapshot: c.snapshot, added_at: 0, reason: '' });
      if (!m) return [];
      const { key: _k, addedAt: _a, reason: _r, ...member } = m;
      return [{ member: member as NewMember, firstSeen: c.first_seen }];
    });
  }

  /**
   * TOPIC-9.3: Jev's answer for a candidate: an Open Topic, or `new` with the title it proposes, or
   * nothing (`none`, too unsure, failed). Either way the candidate is judged, once.
   */
  jevJudged(member: NewMember, pick: { topicId: string | null; newTitle: string | null; confidence: number } | null): void {
    const ref = refText(member.kind, member.ref);
    this.write((s) =>
      s.transaction(() => {
        const open = pick?.topicId ? this.last.topics.some((t) => t.id === pick.topicId && t.state === 'open') : true;
        const made = pick && open && !(pick.topicId && s.isMember(member.kind, ref, pick.topicId))
          ? s.recommend({ kind: member.kind, ref, topicId: pick.topicId, newTitle: pick.newTitle, source: 'jev', confidence: pick.confidence, reason: `Jev, ${Math.round(pick.confidence * 100)}%` })
          : false;
        s.judged(member.kind, ref, made ? 'jev' : 'none', true);
      }),
    );
  }

  /** TOPIC-9.1: set by the server: "Judge again" goes through the Recommender, which can refuse it. */
  judgeAgainWith: ((member: NewMember) => void) | null = null;

  /** TOPIC-9.4: `POST /api/topics/recommendations`. */
  recommend(action: RecommendationAction): { topicId: string | null } {
    if (action.action !== 'judge-again') return this.recommendation(action);
    if (!this.judgeAgainWith) throw new TopicsError(409, "Jev can't be asked here.");
    this.judgeAgainWith(action.member);
    return { topicId: null };
  }

  /** TOPIC-9.1: "Judge again": the item waits for Jev again. */
  judgeAgain(member: NewMember): void {
    this.write((s) => s.judgeAgain(member));
  }

  /**
   * TOPIC-9.4, TOPIC-9.5: Accept adds the member (or makes the Topic and adds it) with where it came
   * from; Dismiss records it; "Other Topic…" adds it to the Topic you picked and dismisses this one.
   */
  recommendation(action: Exclude<RecommendationAction, { action: 'judge-again' }>): { topicId: string | null } {
    const { kind, ref } = parseKey(action.key);
    return this.write((s) =>
      s.transaction(() => {
        const row = s.pendingOne(kind, ref, action.topicId);
        if (!row) throw new TopicsError(404, 'That recommendation is no longer pending.');
        const m = toMember({ topic_id: '', kind, ref, snapshot: row.snapshot, added_at: 0, reason: '' });
        if (!m) throw new TopicsError(400, "That item can't be added.");
        const { key: _k, addedAt: _a, reason: _r, ...member } = m;
        if (action.action === 'dismiss') {
          s.resolve(kind, ref, action.topicId, 'dismissed');
          return { topicId: null };
        }
        if (action.action === 'move') {
          s.addMember(action.to, member as NewMember, 'from a recommendation, other Topic');
          s.resolve(kind, ref, action.topicId, 'dismissed');
          return { topicId: action.to };
        }
        const topicId = row.topic_id ?? s.create(row.new_title ?? (member as NewMember).snapshot.title);
        s.addMember(topicId, member as NewMember, acceptedReason(row.source));
        s.resolve(kind, ref, action.topicId, 'accepted');
        return { topicId };
      }),
    );
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
    const none = { topics: [], edges: [], pruned: [], libraryReadAt: this.readAt, recommendations: [], jevAsksToday: 0, summarizing: this.summarizing, summaryErrors: this.summaryErrors };
    if (!this.store && !this.failure) return { state: 'ok', reason: null, path: this.opts.path, ...none };
    if (!this.store) return { state: 'error', reason: this.failure, path: this.opts.path, ...none };
    let stored: StoredTopic[];
    let counts: Map<string, ActivityCounts>;
    let edges: TopicEdge[];
    let recommendations: Recommendation[];
    let jevAsksToday: number;
    let summaries: Map<string, { summary: TopicSummary; fingerprint: string }>;
    try {
      stored = this.store.list();
      edges = this.store.edges();
      recommendations = this.store.pending();
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      jevAsksToday = this.store.asksSince(midnight.getTime());
      summaries = this.store.summaries();
      counts = this.store.activityCounts();
    } catch (err) {
      return { state: 'error', reason: `Lookout couldn't read its Topics database: ${plain(err)}`, path: this.opts.path, ...none };
    }
    const items = this.outputs;
    const topics = stored.map((t) => {
      const s = summaries.get(t.id);
      const c = counts.get(t.id);
      return {
        ...t,
        outputs: items ? outputsOf(t.members, items) : null,
        summary: s?.summary ?? null,
        summaryStale: s ? s.fingerprint !== summaryFingerprint(t) : false,
        lastActivity: c?.last ?? null,
        lastEntryId: c?.lastId ?? 0,
        newCount: c?.newCount ?? 0,
        changesSinceSummary: s ? (c?.sinceSummary ?? 0) : 0,
        earlierSummaries: c?.earlier ?? 0,
      };
    });
    const ids = new Set(topics.map((t) => t.id));
    const summaryErrors = Object.fromEntries(Object.entries(this.summaryErrors).filter(([id]) => ids.has(id)));
    return { state: 'ok', reason: null, path: this.opts.path, topics, edges, pruned: this.pruned, libraryReadAt: this.readAt, recommendations, jevAsksToday, summarizing: this.summarizing, summaryErrors };
  }
}

/** TOPIC-4.4: the Outputs any of these Session members touched, newest first, at most 10, and how many. */
function outputsOf(members: readonly TopicMember[], items: readonly OutputItem[]): TopicOutputs {
  const sessions = new Set(members.flatMap((m) => (m.kind === 'session' ? [`${m.ref.harness}:${m.ref.sessionId}`] : [])));
  if (!sessions.size) return { items: [], total: 0 };
  const touched = items.filter((i) => i.sessions.some((s) => sessions.has(`${s.harness}:${s.sessionId}`))).sort((a, b) => b.updatedAt - a.updatedAt);
  return { items: touched.slice(0, MAX_TOPIC_OUTPUTS), total: touched.length };
}
