import { chmodSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import {
  MAX_SUGGEST_NOTE,
  MAX_TOPIC_TITLE,
  type NewMember,
  type Proposal,
  SUGGEST_EDGE_LABELS,
  type SuggestEdgeLabel,
  type SuggestPreview,
  type SummaryError,
  type Topic,
  type TopicMember,
  memberKey,
  prMember,
  taskMember,
} from '../shared/topics.ts';
import type { WorkSnapshot } from '../shared/work.ts';
import type { RunError, Runner } from './exec.ts';
import type { RecentSession } from './history.ts';
import { cleanEnv } from './launcher.ts';
import { sanitizeLine } from './sanitize.ts';
import { CANT_READ, NOT_INSTALLED, modelOf, object, oneShotArgs, parseJson, prose, resultError } from './summarizer.ts';
import { type Topics, TopicsError } from './topics.ts';

/**
 * TOPIC-14: Suggest Topics. One `claude -p` run with Sonnet (decision 0013, set up as a summary is)
 * over the Sessions, PRs and Tasks in no Topic, proposing new Topics and additions to Open ones.
 * It runs only when asked, one at a time; nothing is made or added until a proposal is accepted.
 */

/** TOPIC-14.2: the run is cut off at these. */
export const SUGGEST_TIMEOUT_MS = 180_000;
export const SUGGEST_BUDGET_USD = '1.0';
/** TOPIC-14.3: what a run looks at. */
export const SUGGEST_DAYS = 30;
export const MIN_MESSAGES = 6;
export const MAX_SUGGEST_SESSIONS = 80;
/** tb-session rows read to find them: enough for 80 after the filters drop the short and the filed ones. */
const LISTED = 400;
export const MAX_SUGGEST_INPUT = 60_000;
const MAX_PROPOSALS = 12;
const MAX_EDGES = 3;
const MAX_WHY = 300;
const TOPIC_MEMBERS = 8;
const DAY_MS = 24 * 60 * 60_000;

/** TOPIC-14.4: the answer's shape. */
export const SUGGEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['proposals'],
  properties: {
    proposals: {
      type: 'array',
      maxItems: MAX_PROPOSALS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'members', 'why'],
        properties: {
          kind: { type: 'string', enum: ['new', 'add'] },
          title: { type: 'string', description: 'A new Topic: a short, specific name for the piece of work, at most 120 characters.' },
          note: { type: 'string', description: 'A new Topic: one line saying what the work is, at most 200 characters.' },
          topic: { type: 'string', description: 'An addition: the key of the Open Topic, such as TOPIC3.' },
          members: { type: 'array', items: { type: 'string' }, description: 'Keys of the items, such as S4, PR2, T1.' },
          why: { type: 'string', description: 'One sentence: why these belong together.' },
          edges: {
            type: 'array',
            maxItems: MAX_EDGES,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['to', 'label'],
              properties: { to: { type: 'string' }, label: { type: 'string', enum: [...SUGGEST_EDGE_LABELS] } },
            },
          },
        },
      },
    },
  },
};

export const SUGGEST_SYSTEM_PROMPT = [
  "You sort a developer's recent work items into Topics. A Topic is one piece of work: a feature, a fix, a research question, a recurring duty.",
  'The input lists items in no Topic (Sessions S1…, PRs PR1…, Tasks T1…) and the Open Topics (TOPIC1…).',
  'Propose an addition ("add") when items clearly belong to an Open Topic. Propose a new Topic ("new") for items that are one piece of work no Open Topic covers; a single item only when it is substantial work on its own.',
  'Leave out routine or throwaway items: quick checks, one-off questions, test runs. An item goes in at most one proposal. Use only keys from the input.',
  'A new Topic\'s title names the work in plain words ("Deal panel write guards"), never a Session\'s name, a slug or a number. Its note is one line saying what the work is, with no reasoning, counts or references to this list.',
  'A new Topic may have edges to Open Topics: "part of" when it is a piece of that Topic, "uses" when it builds on it, "related" otherwise. Only when the link is clear.',
  'Answer only through the given schema.',
].join('\n');

/** TOPIC-14.3: one item a run looks at, with its key in the input. */
interface Item {
  key: string;
  member: NewMember;
  /** The input's lines for it. */
  text: string;
}

export interface SuggesterOptions {
  topics: Pick<Topics, 'view' | 'suggestRun' | 'saveSuggestion' | 'dismissedFromSuggestions'>;
  runner: Runner;
  claudeBin: () => Promise<string | null>;
  /** TOPIC-14.3: tb-session's Sessions active since a day, newest first. */
  recent: (afterDay: string, limit: number) => Promise<RecentSession[]>;
  /** Work's last read. */
  work: () => WorkSnapshot | null;
  runDir: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  log?: (line: string) => void;
}

const sessionRef = (s: RecentSession) => ({ kind: 'session' as const, ref: { harness: s.harness, sessionId: s.sessionId } });
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const underTmp = (p: string | null) => !!p && /^\/(private\/)?tmp(\/|$)/.test(p);

/** TOPIC-14.3: the Sessions, PRs and Tasks a run looks at, keyed for the input. */
export function suggestItems(sessions: readonly RecentSession[], work: WorkSnapshot | null, topics: readonly Topic[], dismissed: ReadonlySet<string>, now: number): Item[] {
  const filed = new Set(topics.flatMap((t) => t.members.map((m) => m.key)));
  const fresh = (m: NewMember) => {
    const k = memberKey(m.kind, m.ref);
    return !filed.has(k) && !dismissed.has(k);
  };
  const since = now - SUGGEST_DAYS * DAY_MS;
  const items: Item[] = [];
  const picked = sessions
    .filter((s) => s.headless !== true && (s.messageCount ?? 0) >= MIN_MESSAGES && !underTmp(s.projectPath) && (s.lastActiveAt ?? 0) >= since)
    .filter((s) => fresh({ ...sessionRef(s), snapshot: { harness: s.harness, title: s.title, directory: s.projectPath } }))
    .sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0))
    .slice(0, MAX_SUGGEST_SESSIONS);
  picked.forEach((s, i) => {
    const lines = [
      `S${i + 1}: ${s.summary ?? s.title}`,
      s.firstPrompt ? `  first prompt: ${s.firstPrompt}` : null,
      `  folder: ${s.projectPath ? basename(s.projectPath) : 'unknown'}${s.branch ? `, branch ${s.branch}` : ''}, ${s.messageCount ?? '?'} messages, last active ${s.lastActiveAt ? day(s.lastActiveAt) : 'unknown'}`,
    ];
    items.push({ key: `S${i + 1}`, member: { ...sessionRef(s), snapshot: { harness: s.harness, title: s.summary ?? s.title, directory: s.projectPath } }, text: lines.filter(Boolean).join('\n') });
  });
  const prs = work ? [...work.prs.mine, ...work.prs.reviewRequests].map(prMember).filter(fresh) : [];
  prs.forEach((m, i) => {
    if (m.kind !== 'pr') return;
    items.push({ key: `PR${i + 1}`, member: m, text: `PR${i + 1}: ${m.snapshot.repo} #${m.snapshot.number} ${m.snapshot.title}` });
  });
  const tasks = work ? work.tasks.tasks.map(taskMember).filter(fresh) : [];
  tasks.forEach((m, i) => {
    if (m.kind !== 'task') return;
    items.push({ key: `T${i + 1}`, member: m, text: `T${i + 1}: ${m.snapshot.project ? `${m.snapshot.project}: ` : ''}${m.snapshot.title}` });
  });
  return items;
}

function memberTitle(m: TopicMember): string {
  return m.kind === 'pr' ? `${m.snapshot.repo} #${m.snapshot.number} ${m.snapshot.title}` : m.snapshot.title;
}

/** TOPIC-14.3: the input, at most 60,000 characters, the least recently active Sessions going first. */
export function suggestInput(items: readonly Item[], open: readonly Topic[]): { text: string; items: Item[]; topicKeys: Map<string, string> } {
  // Most recently changed first, so the last is the one to leave out first.
  const topics = [...open].sort((a, b) => b.updatedAt - a.updatedAt).map((t, i) => {
    const key = `TOPIC${i + 1}`;
    const line = t.notes.split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 200);
    const newest = [...t.members].sort((a, b) => b.addedAt - a.addedAt).slice(0, TOPIC_MEMBERS).map((m) => memberTitle(m).slice(0, 100));
    return { key, id: t.id, text: `${key}: ${t.title}${line ? ` (${line})` : ''}${newest.length ? `\n  members: ${newest.join('; ')}` : ''}` };
  });
  const kept = [...items];
  const render = () => ['# Open Topics', ...(topics.length ? topics.map((t) => t.text) : ['(none)']), '', '# Items in no Topic', ...kept.map((i) => i.text)].join('\n');
  let text = render();
  // TOPIC-14.3: past the limit, the least recently active Sessions go first (they're newest first),
  // then PRs and Tasks from the end, then the least recently changed Topics. Nothing is cut
  // mid-line, so every key the answer may use is one the input showed.
  while (text.length > MAX_SUGGEST_INPUT && (kept.length || topics.length)) {
    const session = kept.map((i) => i.member.kind).lastIndexOf('session');
    if (session >= 0) kept.splice(session, 1);
    else if (kept.length) kept.pop();
    else topics.pop();
    text = render();
  }
  return { text, items: kept, topicKeys: new Map(topics.map((t) => [t.key, t.id])) };
}

/**
 * TOPIC-14.4: the answer, read: keys turned into the items and Topics they stand for, an unknown key
 * dropped, an item kept in its first proposal only, a proposal left empty dropped.
 */
export function readSuggestion(out: string, items: readonly Item[], topicKeys: ReadonlyMap<string, string>):
  | { ok: true; proposals: Omit<Proposal, 'id' | 'status'>[]; model: string; costUsd: number | null }
  | { ok: false; reason: string } {
  const r = parseJson(out);
  if (!r) return { ok: false, reason: CANT_READ };
  const error = resultError(r, SUGGEST_BUDGET_USD);
  if (error) return { ok: false, reason: error };
  const s = object(r.structured_output);
  if (!s || !Array.isArray(s.proposals)) return { ok: false, reason: CANT_READ };
  const byKey = new Map(items.map((i) => [i.key, i]));
  const used = new Set<string>();
  const proposals: Omit<Proposal, 'id' | 'status'>[] = [];
  for (const raw of s.proposals.slice(0, MAX_PROPOSALS)) {
    const p = object(raw);
    // Anything outside the schema's shape refuses the whole answer, so the pending proposals stay (TOPIC-14.2).
    if (!p || (p.kind !== 'new' && p.kind !== 'add') || !Array.isArray(p.members) || !p.members.every((k) => typeof k === 'string') || typeof p.why !== 'string') return { ok: false, reason: CANT_READ };
    if (p.kind === 'new' && (!prose(p.title, MAX_TOPIC_TITLE) || (p.note !== undefined && typeof p.note !== 'string') || (p.edges !== undefined && !Array.isArray(p.edges)))) return { ok: false, reason: CANT_READ };
    if (p.kind === 'add' && typeof p.topic !== 'string') return { ok: false, reason: CANT_READ };
    const members = (p.members as unknown[]).flatMap((k) => {
      const item = typeof k === 'string' ? byKey.get(k.trim()) : undefined;
      if (!item || used.has(item.key)) return [];
      used.add(item.key);
      return [{ ...item.member, key: memberKey(item.member.kind, item.member.ref) }];
    });
    const why = prose(p.why, MAX_WHY) ?? '';
    if (p.kind === 'add') {
      const topicId = typeof p.topic === 'string' ? topicKeys.get(p.topic.trim()) : undefined;
      if (!topicId || !members.length) continue;
      proposals.push({ kind: 'add', title: null, note: null, topicId, members, edges: [], why });
      continue;
    }
    const title = prose(p.title, MAX_TOPIC_TITLE);
    if (!title || !members.length) continue;
    const edges = (Array.isArray(p.edges) ? p.edges : []).slice(0, MAX_EDGES).flatMap((e) => {
      const o = object(e);
      const to = typeof o?.to === 'string' ? topicKeys.get(o.to.trim()) : undefined;
      const label = o?.label;
      return to && SUGGEST_EDGE_LABELS.includes(label as SuggestEdgeLabel) ? [{ to, label: label as SuggestEdgeLabel }] : [];
    });
    proposals.push({ kind: 'new', title, note: prose(p.note, MAX_SUGGEST_NOTE), topicId: null, members, edges: edges.filter((e, i) => edges.findIndex((x) => x.to === e.to) === i), why });
  }
  const cost = r.total_cost_usd;
  return { ok: true, proposals, model: modelOf(r), costUsd: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null };
}

/** TOPIC-14.2: one run at a time, when asked; Cancel and the server's exit stop it. */
export class Suggester {
  private readonly opts: SuggesterOptions;
  private readonly now: () => number;
  private abort: AbortController | null = null;
  private running: Promise<void> | null = null;

  constructor(opts: SuggesterOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  /** TOPIC-14.2: what a run would look at, as counts. */
  async preview(): Promise<SuggestPreview> {
    const items = await this.items();
    const count = (kind: NewMember['kind']) => items.filter((i) => i.member.kind === kind).length;
    return { sessions: count('session'), prs: count('pr'), tasks: count('task') };
  }

  /** TOPIC-14.2: "Suggest"; refused while one runs. */
  start(): void {
    if (this.abort) throw new TopicsError(409, 'Topics are already being suggested.');
    const view = this.opts.topics.view();
    if (view.state !== 'ok') throw new TopicsError(503, view.reason ?? "Lookout couldn't open its Topics database.");
    const abort = new AbortController();
    this.abort = abort;
    this.opts.topics.suggestRun(true, null);
    this.running = this.run(abort.signal)
      .then(
        () => this.opts.topics.suggestRun(false, null),
        (err: unknown) => this.opts.topics.suggestRun(false, this.error(err)),
      )
      .finally(() => {
        this.abort = null;
        this.running = null;
      });
  }

  /** TOPIC-14.2: Cancel; nothing when no run goes. */
  cancel(): void {
    this.abort?.abort();
  }

  async close(): Promise<void> {
    this.abort?.abort();
    await this.running;
  }

  private async items(): Promise<Item[]> {
    const view = this.opts.topics.view();
    const now = this.now();
    const sessions = await this.opts.recent(day(now - SUGGEST_DAYS * DAY_MS), LISTED);
    return suggestItems(sessions, this.opts.work(), view.topics, this.opts.topics.dismissedFromSuggestions(), now);
  }

  private async run(signal: AbortSignal): Promise<void> {
    const bin = await this.opts.claudeBin().catch(() => null);
    if (!bin) throw Object.assign(new Error('not installed'), { summaryError: NOT_INSTALLED });
    const items = await this.items();
    if (signal.aborted) throw Object.assign(new Error('cancelled'), { aborted: true });
    if (!items.length) throw Object.assign(new Error('nothing'), { summaryError: { reason: 'Everything from the last 30 days is in a Topic or was dismissed.', fix: null } });
    const open = this.opts.topics.view().topics.filter((t) => t.state === 'open');
    const input = suggestInput(items, open);
    mkdirSync(this.opts.runDir, { recursive: true, mode: 0o700 });
    chmodSync(this.opts.runDir, 0o700);
    const out = await this.opts.runner(bin, oneShotArgs(SUGGEST_SCHEMA, SUGGEST_SYSTEM_PROMPT, SUGGEST_BUDGET_USD), {
      timeoutMs: SUGGEST_TIMEOUT_MS,
      env: cleanEnv(this.opts.env ?? process.env),
      cwd: this.opts.runDir,
      stdin: input.text,
      signal,
    });
    const answer = readSuggestion(out, input.items, input.topicKeys);
    if (!answer.ok) throw Object.assign(new Error(answer.reason), { summaryError: { reason: answer.reason, fix: null } });
    this.opts.topics.saveSuggestion(answer.proposals, answer.model, answer.costUsd);
  }

  /** TOPIC-14.2: why a run failed, in TOPIC-11.6's words; one redacted log line. */
  private error(err: unknown): SummaryError {
    const e = err as RunError & { summaryError?: SummaryError };
    let error: SummaryError;
    if (e.summaryError) error = e.summaryError;
    else if (err instanceof TopicsError) error = { reason: err.message, fix: null };
    else if (e.aborted) error = { reason: 'Cancelled. The proposals before it are kept.', fix: null };
    else if (e.timedOut) error = { reason: `It took longer than ${SUGGEST_TIMEOUT_MS / 1000} s and was stopped.`, fix: null };
    else if (e.code === 'ENOENT') error = NOT_INSTALLED;
    else {
      const said = parseJson(e.stdout);
      const why = said ? resultError(said, SUGGEST_BUDGET_USD) : null;
      error = { reason: why ?? `claude failed: ${sanitizeLine(e.stderr ?? '', 200) ?? `exit ${String(e.code ?? '?')}`}`, fix: null };
    }
    (this.opts.log ?? ((l: string) => console.warn(l)))(`lookout: claude -p: suggesting Topics failed: ${sanitizeLine(error.reason) ?? 'no reason given'}`);
    return error;
  }
}
