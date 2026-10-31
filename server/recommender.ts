import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  JEV_ASKS_PER_HOUR,
  JEV_MIN_CONFIDENCE,
  MAX_TOPIC_TITLE,
  type NewMember,
  type Topic,
  type TopicMember,
  memberKey,
  prMember,
  rowMember,
  sessionMember,
  taskMember,
} from '../shared/topics.ts';
import type { Harness, SessionRow } from '../shared/types.ts';
import { type LinkedPr, type LinkedTask, type WorkPr, type WorkSessionLink, type WorkSnapshot, type WorkTask, taskUrl } from '../shared/work.ts';
import type { RunError, Runner } from './exec.ts';
import { cleanEnv } from './launcher.ts';
import { sanitizeLine } from './sanitize.ts';
import { type Topics, TopicsError } from './topics.ts';

/**
 * TOPIC-9: recommendations. Candidates come from what the server already reads (Fleet's list, Work's
 * reads); Links tie what they can (TOPIC-9.2), and `tb-jev ask` judges the rest, one at a time and
 * bounded (TOPIC-9.3). Nothing here adds a member: a recommendation waits for Accept (TOPIC-9.5).
 */

/** A candidate waits this long before Jev is asked, so a Work read can tie it by a Link first and a new Session has its first prompt. */
export const JEV_SETTLE_MS = 6 * 60_000;
const HOUR_MS = 60 * 60_000;
/** `--timeout-ms`: tb-jev's own deadline, retries included; the process gets a little more. */
const JEV_DEADLINE_MS = 3_000;
const JEV_PROCESS_MS = 5_000;
/** Jev's choice options are 1 to 255; two of them are `new` and `none`. */
const MAX_JEV_TOPICS = 253;
const MAX_TEXT = 600;
const MAX_NOTES = 300;

export interface Tie {
  member: NewMember;
  topicId: string;
  reason: string;
}

const linkedSession = (s: WorkSessionLink) => sessionMember({ harness: s.harness, sessionId: s.sessionId, title: s.title, directory: null });
const linkedTask = (t: LinkedTask): NewMember => ({ kind: 'task', ref: { id: t.id }, snapshot: { title: t.title, project: null, url: taskUrl(t.id) } });
const linkedPr = (p: LinkedPr): NewMember => ({ kind: 'pr', ref: { url: p.url }, snapshot: { repo: p.repo, number: p.number, title: `${p.repo} #${p.number}`, url: p.url } });
const named = (sources: readonly ('branch' | 'body')[]) => (sources[0] === 'branch' ? 'branch' : 'description');

/** WORK-4.5's reason, said from the Session's side ("started on PR #812") and from the PR's or Task's. */
function sessionReasons(link: WorkSessionLink, other: { kind: 'pr'; number: number } | { kind: 'task'; title: string }): [forSession: string, forOther: string] {
  const r = link.reason;
  if (other.kind === 'pr') {
    if (r === 'started on this PR') return [`started on PR #${other.number}`, `${link.title} started on it`];
    if (r.startsWith('probably opened')) return [`probably opened PR #${other.number}`, `probably opened by ${link.title}`];
    return [`Linked to PR #${other.number}`, `Linked to ${link.title}`];
  }
  if (r === 'started on this Task') return [`started on Task ${other.title}`, `${link.title} started on it`];
  if (r.startsWith('through PR #')) return [`${r}, on Task ${other.title}`, `${link.title}, ${r}`];
  return [`Linked to Task ${other.title}`, `Linked to ${link.title}`];
}

/**
 * TOPIC-9.2: every Link in Work's read, read both ways: an item Linked to a member of an Open Topic
 * is tied to that Topic, with the Link's reason. Whether the item is a candidate is the store's call.
 */
export function linkTies(work: WorkSnapshot, topics: readonly Topic[]): Tie[] {
  const topicsOf = new Map<string, string[]>();
  for (const t of topics) {
    if (t.state !== 'open') continue;
    for (const m of t.members) topicsOf.set(m.key, [...(topicsOf.get(m.key) ?? []), t.id]);
  }
  const key = (m: NewMember) => memberKey(m.kind, m.ref);
  const out = new Map<string, Tie>();
  const pair = (a: NewMember, b: NewMember, aReason: string, bReason: string) => {
    for (const topicId of topicsOf.get(key(b)) ?? []) out.set(`${key(a)} ${topicId}`, { member: a, topicId, reason: aReason });
    for (const topicId of topicsOf.get(key(a)) ?? []) out.set(`${key(b)} ${topicId}`, { member: b, topicId, reason: bReason });
  };
  const prs: WorkPr[] = [...work.prs.mine, ...work.prs.reviewRequests];
  for (const p of prs) {
    const pm = prMember(p);
    for (const s of p.links?.sessions ?? []) pair(linkedSession(s), pm, ...sessionReasons(s, { kind: 'pr', number: p.number }));
    for (const t of p.links?.tasks ?? []) {
      const where = named(t.sources);
      pair(pm, linkedTask(t), `its ${where} names Task ${t.title}`, `PR #${p.number}'s ${where} names it`);
    }
  }
  for (const t of work.tasks.tasks as WorkTask[]) {
    const tm = taskMember(t);
    for (const s of t.links?.sessions ?? []) pair(linkedSession(s), tm, ...sessionReasons(s, { kind: 'task', title: t.title }));
    for (const p of t.links?.prs ?? []) {
      const where = named(p.sources);
      pair(linkedPr(p), tm, `its ${where} names Task ${t.title}`, `PR #${p.number}'s ${where} names it`);
    }
  }
  return [...out.values()];
}

export interface RecommenderOptions {
  topics: Topics;
  runner: Runner;
  jevBin: () => string | null;
  /** TOPIC-9.3: `UsageMonitor`'s last Jev read says ready; never a new `status` call. */
  jevReady: () => boolean;
  /** "Recommend Topics with Jev" in Settings. */
  enabled: () => boolean;
  /** HIST's peek: a Session's first prompt, for the text Jev judges. */
  firstPrompt: (sessionId: string, harness: Harness) => Promise<string | null>;
  /** Work's last read, for a PR's or Task's text. */
  work: () => WorkSnapshot | null;
  /** Where the question set is written before each ask (`~/.lookout/jev/questions`). */
  questionsDir: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** The server's log: one redacted line per failed ask (TOPIC-9.7). */
  log?: (line: string) => void;
  /** tb-jev said it isn't set up: USAGE reads its status again, so the switch says so. */
  onNotReady?: () => void;
}

type Pick = { topicId: string | null; newTitle: string | null; confidence: number } | null;
/** TOPIC-9.7: tb-jev said it isn't set up (exit 4): the item isn't judged, and asks stop for a while. */
const NOT_READY = Symbol('not ready');
const NOT_READY_PAUSE_MS = 10 * 60_000;

export class Recommender {
  private readonly opts: RecommenderOptions;
  private readonly now: () => number;
  /** TOPIC-9.3: when each ask of the last hour ran; per server process (Known gaps). */
  private asks: number[] = [];
  /** "Judge again": asked before the rest, without waiting to settle. */
  private readonly first = new Set<string>();
  private running: Promise<void> | null = null;
  private again = false;
  private timer: NodeJS.Timeout | null = null;
  private pausedUntil = -Infinity;
  private closed = false;
  private readonly abort = new AbortController();

  constructor(opts: RecommenderOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  /** TOPIC-9.1: Fleet's list; a Session with a session id is a candidate once. */
  observeSessions(rows: readonly SessionRow[]): void {
    const members = rows.flatMap((r) => {
      const m = rowMember(r);
      return m ? [m] : [];
    });
    // TOPIC-8.4: a store that fails here leaves the rest of Lookout running.
    try {
      if (this.opts.topics.seen(members, this.jevMode()).length) this.kick();
    } catch (err) {
      this.warn(`recording Sessions failed: ${message(err)}`);
    }
  }

  /** TOPIC-9.1, TOPIC-9.2: a Work read: its PRs and Tasks are candidates once, and its Links tie what they can. */
  observeWork(work: WorkSnapshot): void {
    const members = [...work.prs.mine, ...work.prs.reviewRequests].map(prMember).concat(work.tasks.tasks.map(taskMember));
    try {
      this.opts.topics.seen(members, this.jevMode());
      this.opts.topics.linkTies(linkTies(work, this.opts.topics.view().topics));
    } catch (err) {
      this.warn(`recording Work's items failed: ${message(err)}`);
    }
    this.kick();
  }

  /** TOPIC-9.1: "Judge again": refused unless Jev can be asked; the item is asked next. */
  judgeAgain(member: NewMember): void {
    if (!this.opts.enabled()) throw new TopicsError(409, 'Turn on "Recommend Topics with Jev" in Settings first.');
    if (!this.opts.jevReady()) throw new TopicsError(409, "Jev isn't set up: Settings says how.");
    this.opts.topics.judgeAgain(member);
    this.first.add(memberKey(member.kind, member.ref));
    this.kick();
  }

  /** Something changed that may let an ask run: a candidate, the switch, Jev's readiness. */
  kick(): void {
    if (this.closed) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.drain()
      .catch((err: unknown) => this.warn(`asking Jev failed: ${message(err)}`))
      .finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        this.kick();
      }
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.abort.abort();
    if (this.timer) clearTimeout(this.timer);
    await this.running?.catch(() => {});
  }

  private jevMode(): 'waiting' | 'off' {
    return this.opts.enabled() ? 'waiting' : 'off';
  }

  private later(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.kick();
    }, Math.max(1_000, ms));
    this.timer.unref?.();
  }

  /** TOPIC-9.3: one ask at a time, oldest first, at most 30 an hour, never with no Open Topic. */
  private async drain(): Promise<void> {
    while (!this.closed && this.opts.enabled() && this.opts.jevReady()) {
      const open = this.opts.topics.view().topics.filter((t) => t.state === 'open');
      if (!open.length) return;
      const now = this.now();
      if (now < this.pausedUntil) return this.later(this.pausedUntil - now);
      this.asks = this.asks.filter((t) => now - t < HOUR_MS);
      if (this.asks.length >= JEV_ASKS_PER_HOUR) return this.later(this.asks[0]! + HOUR_MS - now);
      const waiting = this.opts.topics.waitingForJev();
      const key = (c: { member: NewMember }) => memberKey(c.member.kind, c.member.ref);
      const next = waiting.find((c) => this.first.has(key(c))) ?? waiting.find((c) => now - c.firstSeen >= JEV_SETTLE_MS);
      if (!next) {
        const due = waiting.map((c) => c.firstSeen + JEV_SETTLE_MS - now);
        if (due.length) this.later(Math.min(...due));
        return;
      }
      this.first.delete(key(next));
      this.asks.push(now);
      const pick = await this.ask(next.member, open);
      if (this.closed) return;
      if (pick === NOT_READY) {
        this.pausedUntil = this.now() + NOT_READY_PAUSE_MS;
        return this.later(NOT_READY_PAUSE_MS);
      }
      this.opts.topics.jevJudged(next.member, pick);
    }
  }

  private async ask(member: NewMember, open: readonly Topic[]): Promise<Pick | typeof NOT_READY> {
    const topics = open.slice(0, MAX_JEV_TOPICS);
    const state = {
      item: { kind: member.kind, title: member.snapshot.title, text: await this.text(member) },
      topics: topics.map((t) => ({ id: t.id, title: t.title, notes: t.notes.slice(0, MAX_TEXT), members: t.members.map(memberTitle) })),
    };
    const questions = {
      id: 'topics',
      version: '1',
      questions: {
        topic: {
          type: 'choice',
          instructions:
            'Which Topic is this item part of? Pick `new` when it is a distinct piece of work that no listed Topic covers, and `none` when it is routine or unrelated to any.',
          criteria: {
            ...Object.fromEntries(topics.map((t) => [t.id, `${t.title}: ${t.notes.slice(0, MAX_NOTES)}; members: ${t.members.map(memberTitle).join(', ')}`])),
            new: 'A distinct piece of work no listed Topic covers.',
            none: 'Routine, or unrelated to every listed Topic.',
          },
        },
      },
    };
    const subject = `${member.kind}:${member.kind === 'session' ? member.ref.sessionId : member.kind === 'pr' ? member.ref.url : member.ref.id}`;
    const bin = this.opts.jevBin();
    if (!bin) return this.failed(member, 'tb-jev is not installed');
    let out: string;
    try {
      mkdirSync(this.opts.questionsDir, { recursive: true, mode: 0o700 });
      const file = join(this.opts.questionsDir, 'topics@1.json');
      writeFileSync(file, JSON.stringify(questions), { mode: 0o600 });
      chmodSync(file, 0o600);
      out = await this.opts.runner(
        bin,
        ['ask', '--questions', 'topics@1', '--questions-dir', this.opts.questionsDir, '--state', '-', '--timeout-ms', String(JEV_DEADLINE_MS), '--caller', 'lookout-topics', '--subject', subject, '--on-error', 'closed', '--format', 'json'],
        { timeoutMs: JEV_PROCESS_MS, env: cleanEnv(this.opts.env ?? process.env), stdin: JSON.stringify(state), signal: this.abort.signal },
      );
    } catch (err) {
      const e = err as RunError;
      if (e.aborted) return null;
      const said = answer(e.stdout ?? '');
      if (e.code === 4) {
        this.warn(`tb-jev isn't set up (${sanitizeLine((said?.error_reason as string | undefined) ?? e.stderr ?? '') ?? 'no reason given'}); asks stop for now`);
        this.opts.onNotReady?.();
        return NOT_READY;
      }
      const why = e.timedOut ? 'took too long' : (said?.error_reason as string | undefined) ?? e.stderr ?? `exit ${String(e.code ?? '?')}`;
      return this.failed(member, why);
    }
    const result = answer(out);
    if (!result) return this.failed(member, "printed something Lookout doesn't understand");
    if (result.status !== 'ok') return this.failed(member, (result.error_reason as string | undefined) ?? String(result.status));
    const topic = (result.answers as Record<string, Record<string, unknown>> | undefined)?.topic;
    const choice = topic?.choice;
    const confidence = topic?.confidence;
    if (typeof choice !== 'string' || typeof confidence !== 'number' || !Number.isFinite(confidence)) return this.failed(member, "printed something Lookout doesn't understand");
    if (confidence < JEV_MIN_CONFIDENCE || choice === 'none') return null;
    if (choice === 'new') return { topicId: null, newTitle: member.snapshot.title.slice(0, MAX_TOPIC_TITLE), confidence };
    return topics.some((t) => t.id === choice) ? { topicId: choice, newTitle: null, confidence } : null;
  }

  /** TOPIC-9.7: one redacted line; the candidate is judged with nothing. */
  private failed(member: NewMember, why: string): null {
    this.warn(`ask for a ${member.kind} failed: ${sanitizeLine(why) ?? 'no reason given'}`);
    return null;
  }

  private warn(line: string): void {
    (this.opts.log ?? ((l: string) => console.warn(l)))(`lookout: tb-jev: ${line}`);
  }

  /** TOPIC-9.3: what Jev reads about the item, at most 600 characters. */
  private async text(member: NewMember): Promise<string> {
    if (member.kind === 'session') {
      const prompt = await this.opts.firstPrompt(member.ref.sessionId, member.ref.harness).catch(() => null);
      return (prompt ?? '').slice(0, MAX_TEXT);
    }
    const work = this.opts.work();
    if (member.kind === 'pr') {
      const url = member.ref.url;
      const pr = work ? [...work.prs.mine, ...work.prs.reviewRequests].find((p) => p.url === url) : undefined;
      const tasks = pr?.taskIds?.length ? `; Tasks ${pr.taskIds.map((t) => t.id).join(', ')}` : '';
      return `${member.snapshot.repo} #${member.snapshot.number}: ${member.snapshot.title}${tasks}`.slice(0, MAX_TEXT);
    }
    const id = member.ref.id;
    const task = work?.tasks.tasks.find((t) => t.id === id);
    return [member.snapshot.project ?? task?.project, member.snapshot.title, task?.description].filter(Boolean).join('. ').slice(0, MAX_TEXT);
  }
}

/** An error in plain words, never a path or SQLite's own text. */
function message(err: unknown): string {
  return err instanceof TopicsError ? err.message : 'the Topics database failed';
}

function memberTitle(m: TopicMember): string {
  return m.kind === 'pr' ? `${m.snapshot.repo} #${m.snapshot.number} ${m.snapshot.title}` : m.snapshot.title;
}

function answer(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
