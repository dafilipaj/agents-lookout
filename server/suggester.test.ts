import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type NewMember, type Proposal, type Topic, memberKey } from '../shared/topics.ts';
import type { WorkPr, WorkSnapshot, WorkTask } from '../shared/work.ts';
import type { RunError, Runner } from './exec.ts';
import type { RecentSession } from './history.ts';
import { MAX_SUGGEST_INPUT, MAX_SUGGEST_SESSIONS, SUGGEST_TIMEOUT_MS, Suggester, readSuggestion, suggestInput, suggestItems } from './suggester.ts';
import { SUGGESTED_REASON, TopicStore, Topics, TopicsError, parseProposalAction } from './topics.ts';

/** Synthetic Sessions, PRs and Tasks only: invented titles, repos and ids. */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'lookout-suggest-'));
  dirs.push(dir);
  return dir;
}
function setup() {
  const path = join(tempDir(), 'topics.db');
  const topics = new Topics({ path, open: () => new TopicStore(path), exists: () => existsSync(path), onChange: () => {} });
  return { topics };
}

const NOW = Date.parse('2026-11-03T12:00:00Z');
const DAY = 24 * 60 * 60_000;
const sid = (n: number) => `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, '0')}`;
const recent = (n: number, over: Partial<RecentSession> = {}): RecentSession => ({
  sessionId: sid(n),
  harness: 'claude',
  headless: false,
  title: `session ${n}`,
  summary: `Polish the lantern ${n}`,
  firstPrompt: `Let's polish lantern ${n}`,
  projectPath: '/Users/me/Projects/harbor',
  branch: 'main',
  messageCount: 12,
  lastActiveAt: NOW - n * 60_000,
  ...over,
});
const SESSION = (n: number): NewMember => ({ kind: 'session', ref: { harness: 'claude', sessionId: sid(n) }, snapshot: { harness: 'claude', title: `Polish the lantern ${n}`, directory: '/Users/me/Projects/harbor' } });
const prUrl = (n: number) => `https://github.com/productiveio/anvil/pull/${n}`;
function workPr(n: number): WorkPr {
  return { repo: 'anvil', number: n, title: `anvil change ${n}`, url: prUrl(n), author: null, createdAt: null, ageDays: 1, rotting: 'fresh', ci: 'passing', chip: 'draft', column: 'draft_mine', baseBranch: null, taskIds: [], links: null };
}
function workTask(id: string): WorkTask {
  return { id, title: `Task ${id}`, project: 'Lantern Works', status: 'In progress', statusCategory: 'started', statusColor: null, dueDate: null, lastActivityAt: null, milestone: false, description: null, url: `https://app.fantastic.productive.io/109-productive/tasks/${id}`, links: null };
}
function work(prs: WorkPr[], tasks: WorkTask[]): WorkSnapshot {
  const section = { state: 'ok' as const, reason: null, fix: null, stale: false, fetchedAt: 1 };
  return { prs: { ...section, mine: prs, reviewRequests: [], marks: { mine: [], reviewRequests: [] }, taskIds: true }, tasks: { ...section, tasks }, sessionLinks: { state: 'ok', reason: null, fix: null }, refresh: { cooldownUntil: null, githubBlockedUntil: null } };
}
const claudeSaid = (structured: unknown, cost = 0.07) =>
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: cost, modelUsage: { 'claude-sonnet-5-5': { costUSD: cost } }, structured_output: structured });

describe('TOPIC-14.3 what a run looks at', () => {
  it('TOPIC-14.3: Sessions in no Topic from the last 30 days, not headless, with 6 messages or more, outside /tmp, never dismissed, newest first and at most 80; the PRs and Tasks in Work in no Topic', () => {
    const { topics } = setup();
    const t = topics.create('Harbor');
    topics.addMember(t.id, SESSION(2));
    const sessions = [
      recent(1),
      recent(2), // in a Topic
      recent(3, { headless: true }),
      recent(4, { messageCount: 5 }),
      recent(5, { projectPath: '/private/tmp/scratch' }),
      recent(6, { projectPath: '/tmp' }),
      recent(7), // dismissed
      recent(8, { lastActiveAt: NOW - 31 * DAY }),
      recent(9, { lastActiveAt: NOW - 1 }),
    ];
    const dismissed = new Set([memberKey('session', { harness: 'claude', sessionId: sid(7) }), memberKey('pr', { url: prUrl(12) })]);
    const items = suggestItems(sessions, work([workPr(11), workPr(12)], [workTask('41')]), topics.view().topics, dismissed, NOW);
    expect(items.map((i) => i.key)).toEqual(['S1', 'S2', 'PR1', 'T1']);
    expect(items.map((i) => i.member.ref)).toEqual([{ harness: 'claude', sessionId: sid(9) }, { harness: 'claude', sessionId: sid(1) }, { url: prUrl(11) }, { id: '41' }]);
    expect(items[0]!.text).toBe(`S1: Polish the lantern 9\n  first prompt: Let's polish lantern 9\n  folder: harbor, branch main, 12 messages, last active 2026-11-03`);
    const many = suggestItems(Array.from({ length: 100 }, (_, i) => recent(i + 1)), null, [], new Set(), NOW);
    expect(many).toHaveLength(MAX_SUGGEST_SESSIONS);
  });

  it('TOPIC-14.3: the input keys the Open Topics, each by its title, notes’ first line and 8 newest members; past 60,000 characters the least recently active Sessions go first', () => {
    const { topics } = setup();
    const t = topics.create('Harbor lanterns');
    topics.update(t.id, { notes: 'Service every lantern\nnot sent' });
    const open = topics.view().topics;
    const items = suggestItems([recent(1), recent(2)], null, [], new Set(), NOW);
    const input = suggestInput(items, open);
    expect(input.topicKeys.get('TOPIC1')).toBe(t.id);
    expect(input.text).toContain('TOPIC1: Harbor lanterns (Service every lantern)');
    expect(input.text).not.toContain('not sent');
    const long = suggestItems(Array.from({ length: 80 }, (_, i) => recent(i + 1, { firstPrompt: 'x'.repeat(390), summary: 'y'.repeat(290) })), null, [], new Set(), NOW);
    const cut = suggestInput(long.map((i) => ({ ...i, text: i.text + 'z'.repeat(600) })), open);
    expect(cut.text.length).toBeLessThanOrEqual(MAX_SUGGEST_INPUT);
    expect(cut.items.length).toBeLessThan(80);
    // The newest stay.
    expect(cut.items[0]!.key).toBe('S1');
    // Past the limit with Topics alone: PRs and Tasks go, then the least recently changed Topics;
    // every key the answer may use is one the input showed, and no line is cut.
    const many = Array.from({ length: 120 }, (_, i) => ({ ...open[0]!, id: `t${i}`, title: `Topic ${i} ${'w'.repeat(100)}`, notes: 'n'.repeat(200), updatedAt: i, members: Array.from({ length: 8 }, (_, m) => ({ ...open[0]!.members[0], kind: 'task', ref: { id: `${i}${m}` }, snapshot: { title: 'm'.repeat(100), project: null, url: '' }, key: `task:${i}${m}`, addedAt: m, reason: '' })) })) as unknown as Topic[];
    const withWork = suggestItems([recent(1)], work([workPr(11)], [workTask('41')]), [], new Set(), NOW);
    const crowded = suggestInput(withWork, many);
    expect(crowded.text.length).toBeLessThanOrEqual(MAX_SUGGEST_INPUT);
    expect(crowded.items).toEqual([]);
    expect(crowded.topicKeys.size).toBeGreaterThan(0);
    expect(crowded.topicKeys.size).toBeLessThan(120);
    for (const [k, topicId] of crowded.topicKeys) {
      expect(crowded.text).toContain(`${k}: Topic ${topicId.slice(1)} `);
    }
    // The most recently changed are the ones kept.
    expect(crowded.topicKeys.get('TOPIC1')).toBe('t119');
  });
});

describe('TOPIC-14.4 the answer', () => {
  const items = suggestItems([recent(1), recent(2), recent(3)], work([workPr(11)], []), [], new Set(), NOW);
  const keys = new Map([['TOPIC1', 'topic-one']]);
  it('TOPIC-14.4: keys become items; an unknown key is dropped, an item stays in its first proposal, a proposal left empty is dropped, Edges keep known Topics and labels', () => {
    const out = claudeSaid({
      proposals: [
        { kind: 'new', title: 'Lantern polish', note: 'Polishing every lantern on the pier.', members: ['S1', 'S2', 'S99'], why: 'Same lanterns.', edges: [{ to: 'TOPIC1', label: 'part of' }, { to: 'TOPIC9', label: 'uses' }, { to: 'TOPIC1', label: 'related' }] },
        { kind: 'add', topic: 'TOPIC1', members: ['S2', 'PR1'], why: 'Harbor work.' },
        { kind: 'add', topic: 'TOPIC7', members: ['S3'], why: 'Unknown Topic.' },
        { kind: 'new', title: 'Empty', members: ['S1'], why: 'Taken.' },
      ],
    });
    const r = readSuggestion(out, items, keys);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.model).toBe('claude-sonnet-5-5');
    expect(r.costUsd).toBe(0.07);
    expect(r.proposals.map((p) => [p.kind, p.title ?? p.topicId, p.members.map((m) => m.ref), p.edges])).toEqual([
      ['new', 'Lantern polish', [{ harness: 'claude', sessionId: sid(1) }, { harness: 'claude', sessionId: sid(2) }], [{ to: 'topic-one', label: 'part of' }]],
      ['add', 'topic-one', [{ url: prUrl(11) }], []],
    ]);
    expect(r.proposals[0]!.members[0]!.key).toBe(memberKey('session', { harness: 'claude', sessionId: sid(1) }));
  });

  it('TOPIC-14.4, TOPIC-14.2: an answer outside the shape, or a run stopped at its budget, is refused whole with why, so the pending proposals stay', () => {
    const cant = { ok: false, reason: "Claude answered something Lookout can't read." };
    expect(readSuggestion('not json', items, keys)).toEqual(cant);
    expect(readSuggestion(claudeSaid({ proposals: [{ kind: 'merge', members: [] }] }), items, keys)).toEqual(cant);
    // A new Topic with no title, a proposal with no `why`, an addition with no Topic, a member that isn't a key.
    for (const bad of [
      { kind: 'new', members: ['S1'], why: 'x' },
      { kind: 'new', title: '  ', members: ['S1'], why: 'x' },
      { kind: 'new', title: 'T', members: ['S1'] },
      { kind: 'add', members: ['S1'], why: 'x' },
      { kind: 'new', title: 'T', members: [1], why: 'x' },
    ]) expect(readSuggestion(claudeSaid({ proposals: [{ kind: 'new', title: 'Fine', members: ['S2'], why: 'ok' }, bad] }), items, keys)).toEqual(cant);
    expect(readSuggestion(JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true }), items, keys)).toEqual({ ok: false, reason: 'It reached the $1.00 limit and was stopped.' });
  });
});

describe('TOPIC-14.2 a run', () => {
  function suggester(topics: Topics, runner: Runner, over: Partial<ConstructorParameters<typeof Suggester>[0]> = {}) {
    const log = vi.fn<(line: string) => void>();
    const s = new Suggester({
      topics,
      runner,
      claudeBin: async () => '/fake/claude',
      recent: async () => [recent(1), recent(2)],
      work: () => null,
      runDir: join(tempDir(), 'run'),
      now: () => NOW,
      log,
      ...over,
    });
    return { s, log };
  }
  const settle = async (s: Suggester) => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    await (s as unknown as { running: Promise<void> | null }).running;
  };

  it('TOPIC-14.2: what a run would look at, as counts; a run is one `claude -p` with Sonnet and no tools, cut off at 180 s and $1.00; its proposals replace the pending ones, and every tab sees it run', async () => {
    const { topics } = setup();
    const answers = [
      claudeSaid({ proposals: [{ kind: 'new', title: 'Lantern polish', note: 'Polish.', members: ['S1'], why: 'One.' }] }),
      claudeSaid({ proposals: [{ kind: 'new', title: 'Second run', members: ['S2'], why: 'Two.' }] }, 0.05),
    ];
    const runner = vi.fn<Runner>(async () => answers.shift()!);
    const { s } = suggester(topics, runner);
    expect(await s.preview()).toEqual({ sessions: 2, prs: 0, tasks: 0 });
    s.start();
    expect(topics.view().suggest?.running).toBe(true);
    expect(() => s.start()).toThrow(TopicsError);
    await settle(s);
    const [bin, args, opts] = runner.mock.calls[0]!;
    expect(bin).toBe('/fake/claude');
    expect(args.slice(0, 4)).toEqual(['-p', '--model', 'sonnet', '--tools']);
    expect(args).toContain('--no-session-persistence');
    expect(args[args.indexOf('--max-budget-usd') + 1]).toBe('1.0');
    expect(opts.timeoutMs).toBe(SUGGEST_TIMEOUT_MS);
    expect(opts.stdin).toContain('S1: Polish the lantern 1');
    expect(topics.view().suggest).toEqual(expect.objectContaining({ running: false, error: null, run: { writtenAt: expect.any(Number), model: 'claude-sonnet-5-5', costUsd: 0.07 } }));
    expect(topics.view().suggest?.proposals.map((p) => p.title)).toEqual(['Lantern polish']);
    s.start();
    await settle(s);
    expect(topics.view().suggest?.proposals.map((p) => p.title)).toEqual(['Second run']);
  });

  it('TOPIC-14.2: a run that fails, is cut off or cancelled leaves the proposals as they were and says why, with one redacted log line', async () => {
    const { topics } = setup();
    const answers: (string | RunError)[] = [
      claudeSaid({ proposals: [{ kind: 'new', title: 'Kept', members: ['S1'], why: 'Kept.' }] }),
      Object.assign(new Error('timeout'), { timedOut: true }) as RunError,
      Object.assign(new Error('aborted'), { aborted: true }) as RunError,
    ];
    const runner = vi.fn<Runner>(async () => {
      const a = answers.shift()!;
      if (typeof a !== 'string') throw a;
      return a;
    });
    const { s, log } = suggester(topics, runner);
    s.start();
    await settle(s);
    s.start();
    await settle(s);
    expect(topics.view().suggest?.error).toEqual({ reason: 'It took longer than 180 s and was stopped.', fix: null });
    expect(topics.view().suggest?.proposals.map((p) => p.title)).toEqual(['Kept']);
    s.start();
    await settle(s);
    expect(topics.view().suggest?.error?.reason).toBe('Cancelled. The proposals before it are kept.');
    expect(log).toHaveBeenCalledWith('lookout: claude -p: suggesting Topics failed: It took longer than 180 s and was stopped.');
    const none = suggester(topics, runner, { claudeBin: async () => null }).s;
    none.start();
    await settle(none);
    expect(topics.view().suggest?.error?.reason).toMatch(/^Claude Code isn't installed/);
  });
});

describe('TOPIC-14.5 and TOPIC-14.6 Accept and Dismiss', () => {
  function proposals(topics: Topics, list: Omit<Proposal, 'id' | 'status'>[]) {
    topics.saveSuggestion(list, 'claude-sonnet-5-5', 0.07);
    return topics.view().suggest!.proposals;
  }
  const withKey = (m: NewMember) => ({ ...m, key: memberKey(m.kind, m.ref) });

  it('TOPIC-14.5: Accept makes the Topic with the edited title and note, adds the ticked members "from Suggest Topics", draws the ticked Edges and keeps a pair’s own; an addition adds to its Topic', () => {
    const { topics } = setup();
    const hub = topics.create('Harbor');
    const other = topics.create('Anvil');
    const [p, add] = proposals(topics, [
      { kind: 'new', title: 'Lantern polish', note: 'Polish.', topicId: null, members: [withKey(SESSION(1)), withKey(SESSION(2))], edges: [{ to: hub.id, label: 'part of' }, { to: other.id, label: 'uses' }], why: 'Same.' },
      { kind: 'add', title: null, note: null, topicId: hub.id, members: [withKey(SESSION(3))], edges: [], why: 'Harbor.' },
    ]);
    const { topicId } = topics.acceptProposal(p!.id, { title: 'Lantern polishing', note: '  One line.  ', members: [withKey(SESSION(1)).key], edges: [hub.id] });
    const made = topics.view().topics.find((t) => t.id === topicId)!;
    expect([made.title, made.notes, made.members.map((m) => [m.ref, m.reason])]).toEqual(['Lantern polishing', 'One line.', [[SESSION(1).ref, SUGGESTED_REASON]]]);
    expect(topics.view().edges.filter((e) => e.from === topicId)).toEqual([expect.objectContaining({ to: hub.id, label: 'part of' })]);
    topics.acceptProposal(add!.id, { members: [withKey(SESSION(3)).key] });
    expect(topics.view().topics.find((t) => t.id === hub.id)!.members.map((m) => m.ref)).toEqual([SESSION(3).ref]);
    expect(topics.view().suggest!.proposals).toEqual([]);
    expect(() => topics.acceptProposal(p!.id, { members: [] })).toThrow('That proposal is no longer pending.');
  });

  it('TOPIC-14.5: Accept with nothing ticked, an empty title, or an addition to a Topic archived since is refused, and nothing is made', () => {
    const { topics } = setup();
    const hub = topics.create('Harbor');
    const [p, add] = proposals(topics, [
      { kind: 'new', title: 'Lantern polish', note: null, topicId: null, members: [withKey(SESSION(1))], edges: [], why: '' },
      { kind: 'add', title: null, note: null, topicId: hub.id, members: [withKey(SESSION(2))], edges: [], why: '' },
    ]);
    expect(() => topics.acceptProposal(p!.id, { members: [] })).toThrow('Tick at least one member to accept.');
    expect(() => topics.acceptProposal(p!.id, { title: '  ', members: [withKey(SESSION(1)).key] })).toThrow(TopicsError);
    topics.update(hub.id, { state: 'archived', outcome: 'done' });
    expect(() => topics.acceptProposal(add!.id, { members: [withKey(SESSION(2)).key] })).toThrow('That Topic was archived or deleted since: dismiss this proposal.');
    expect(topics.view().topics.map((t) => t.title)).toEqual(['Harbor']);
  });

  it('TOPIC-14.6: Dismiss removes the proposal and records its items, so no later run looks at them; parse refuses anything but Accept or Dismiss', () => {
    const { topics } = setup();
    const [p] = proposals(topics, [{ kind: 'new', title: 'Lantern polish', note: null, topicId: null, members: [withKey(SESSION(1))], edges: [], why: '' }]);
    topics.dismissProposal(p!.id);
    expect(topics.view().suggest!.proposals).toEqual([]);
    const dismissed = topics.dismissedFromSuggestions();
    expect(suggestItems([recent(1), recent(2)], null, [], dismissed, NOW).map((i) => i.member.ref)).toEqual([SESSION(2).ref]);
    expect(parseProposalAction({ action: 'dismiss' })).toEqual({ action: 'dismiss' });
    expect(parseProposalAction({ action: 'accept', title: 'T', members: ['a'] })).toEqual({ action: 'accept', accept: { title: 'T', note: undefined, members: ['a'], edges: [] } });
    expect(() => parseProposalAction({ action: 'merge' })).toThrow('Accept or Dismiss.');
  });
});
