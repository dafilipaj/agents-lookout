import { describe, expect, it } from 'vitest';
import { type NewMember, NO_ACTIVITY, RESTATE_LINE, type Topic, type TopicMember, type TopicPromptContext, type TopicSummary, localTime, memberKey, topicPrompt } from './topics.ts';
import type { SessionRow } from './types.ts';
import type { WorkPr, WorkSnapshot } from './work.ts';

/** TOPIC-17: invented Topics, PRs and Sessions only. */
const NOW = Date.UTC(2026, 10, 23, 12, 0);
const TOPIC_ID = '00000000-0000-4000-8000-000000000001';
const sid = (n: number) => `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, '0')}`;
const prUrl = (n: number) => `https://github.com/productiveio/anvil/pull/${n}`;

const member = (m: NewMember, addedAt: number): TopicMember => ({ ...m, key: memberKey(m.kind, m.ref), addedAt, reason: 'added by hand' }) as TopicMember;
const prMember = (n: number, addedAt = NOW - n * 1000) => member({ kind: 'pr', ref: { url: prUrl(n) }, snapshot: { repo: 'anvil', number: n, title: `Sharpen corner ${n}`, url: prUrl(n) } }, addedAt);
const sessionMember = (n: number, addedAt = NOW - n * 1000, harness: 'claude' | 'codex' = 'claude') =>
  member({ kind: 'session', ref: { harness, sessionId: sid(n) }, snapshot: { harness, title: `lantern ${n}`, directory: '~/Projects/anvil' } }, addedAt);
const topic = (over: Partial<Topic> = {}): Topic => ({
  id: TOPIC_ID, title: 'Anvil', notes: '', state: 'open', createdAt: NOW - 1e6, updatedAt: NOW, members: [], outputs: null, pos: null, summary: null, summaryStale: false, ...NO_ACTIVITY, ...over,
});

const workPr = (n: number, over: Partial<WorkPr> = {}): WorkPr => ({
  repo: 'anvil', number: n, title: `Sharpen corner ${n}`, url: prUrl(n), author: null, createdAt: null, ageDays: 1, rotting: 'fresh', ci: 'passing', chip: 'draft', column: 'draft_mine', baseBranch: null, taskIds: [], links: null, ...over,
});
const work = (mine: WorkPr[], reviewRequests: WorkPr[] = []): WorkSnapshot => ({
  prs: { state: 'ok', reason: null, fix: null, stale: false, fetchedAt: NOW, mine, reviewRequests, marks: { mine: [], reviewRequests: [] }, taskIds: true },
  tasks: { state: 'ok', reason: null, fix: null, stale: false, fetchedAt: NOW, tasks: [] },
  sessionLinks: { state: 'ok', reason: null, fix: null },
  refresh: { cooldownUntil: null, githubBlockedUntil: null },
});
const liveRow = (n: number, over: Partial<SessionRow> = {}): SessionRow =>
  ({ id: sid(n), harness: 'claude', title: `lantern ${n} now`, status: 'idle', statusSince: NOW - 60_000, cwd: '/Users/me/Projects/anvil', git: { repo: 'anvil', worktree: null, branch: 'main', commonDir: '/Users/me/Projects/anvil/.git', defaultBranch: 'main' }, ...over }) as SessionRow;
const known = (over: Partial<TopicPromptContext> = {}): TopicPromptContext => ({ work: work([]), sessions: new Map(), pruned: [], ...over });
const byId = (rows: SessionRow[]) => new Map(rows.map((r) => [r.id, r]));

const SUMMARY: TopicSummary = {
  answer: { what: 'Sharpen the anvil, corner by corner.', state: 'in progress', why: 'Two corners are sharp.', recent: [], open: [], next: [] },
  writtenAt: NOW - 3_600_000,
  model: 'claude-sonnet-5-5',
  costUsd: 0.02,
};
const parts = (t: Topic, k = known()) => topicPrompt(t, k).split('\n\n');
const tail = [`Topic: ${TOPIC_ID} Anvil`, RESTATE_LINE];

describe('TOPIC-17 what a Topic’s prompt carries', () => {
  it('TOPIC-17.1: the notes go whole, first with no summary and under "Notes:" after one; past 4,000 characters they are cut with a pointer to the rest; no notes add nothing', () => {
    const notes = 'Sharpen the corners.\n\nRounding: half up.';
    expect(topicPrompt(topic({ notes }), known())).toBe([notes, ...tail].join('\n\n'));
    expect(topicPrompt(topic({ notes, summary: SUMMARY }), known())).toBe(
      ['Sharpen the anvil, corner by corner.', 'State: in progress. Two corners are sharp.', `Notes:\n${notes}`, ...tail].join('\n\n'),
    );
    // An out-of-date summary isn't used, so the notes are first again.
    expect(topicPrompt(topic({ notes, summary: SUMMARY, summaryStale: true }), known())).toBe([notes, ...tail].join('\n\n'));
    const long = `${'a'.repeat(3_990)} ${'b'.repeat(100)}`;
    const cut = parts(topic({ notes: long }))[0]!;
    expect(cut).toBe(`${long.slice(0, 4_000).trimEnd()}… (the rest is in the Topic's notes)`);
    expect(topicPrompt(topic({ notes: '  \n ' }), known())).toBe(tail.join('\n\n'));
  });

  it("TOPIC-17.2: the PRs Work lists go as their URL with chip or review and CI, the rest named without a URL; listed first, newest added first within each; at most 10, then a count", () => {
    const members = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => prMember(n));
    const w = work([workPr(2, { ci: 'failing' }), workPr(5, { chip: 'approved', column: 'ready_to_merge_mine', ci: 'running' }), workPr(9, { chip: 'ready', column: 'review_mine', ci: 'none' })], [workPr(11, { chip: null, column: 'waiting_on_me', ci: 'unknown' })]);
    const prs = parts(topic({ members }), known({ work: w }))[0]!;
    expect(prs.split('\n')).toEqual([
      'PRs:',
      `- ${prUrl(2)} (draft, CI failing)`,
      `- ${prUrl(5)} (approved, CI running)`,
      `- ${prUrl(9)} (ready, no CI)`,
      `- ${prUrl(11)} (your review requested, CI unknown)`,
      '- anvil #1 Sharpen corner 1 (not in Work: merged, closed or not read yet)',
      '- anvil #3 Sharpen corner 3 (not in Work: merged, closed or not read yet)',
      '- anvil #4 Sharpen corner 4 (not in Work: merged, closed or not read yet)',
      '- anvil #6 Sharpen corner 6 (not in Work: merged, closed or not read yet)',
      '- anvil #7 Sharpen corner 7 (not in Work: merged, closed or not read yet)',
      '- anvil #8 Sharpen corner 8 (not in Work: merged, closed or not read yet)',
      '+2 more in the Topic',
    ]);
    // WORK-4.3: only a listed PR's URL is in the prompt.
    const words = topicPrompt(topic({ members }), known({ work: w })).split(/\s+/);
    expect(words.filter((x) => x.startsWith('https://github.com/'))).toEqual([prUrl(2), prUrl(5), prUrl(9), prUrl(11)]);
    // Before Work's first read, nothing is listed, so every PR is named.
    expect(parts(topic({ members: [prMember(2)] }), known({ work: null }))[0]).toBe('PRs:\n- anvil #2 Sharpen corner 2 (not in Work: merged, closed or not read yet)');
  });

  it("TOPIC-17.3: the Done notes come after the Task URLs, newest first, each with its local time, the Session's name and the note, at most 3", () => {
    const doneNotes = [
      { at: NOW - 60_000, name: 'lantern 3', note: 'Third corner sharp; CI green.' },
      { at: NOW - 3_600_000, name: 'lantern 2', note: 'Second corner sharp.' },
      { at: NOW - 7_200_000, name: 'lantern 1', note: 'First corner sharp.' },
      { at: NOW - 9_000_000, name: 'lantern 0', note: 'Not sent: a fourth.' },
    ];
    const task = member({ kind: 'task', ref: { id: '41000101' }, snapshot: { title: 'Light the lanterns', project: 'Lantern Works', url: 'https://app.fantastic.productive.io/109-productive/tasks/41000101' } }, NOW);
    expect(parts(topic({ members: [task], doneNotes }))).toEqual([
      'https://app.fantastic.productive.io/109-productive/tasks/41000101',
      `Done notes:\n- ${localTime(NOW - 60_000)}, lantern 3: Third corner sharp; CI green.\n- ${localTime(NOW - 3_600_000)}, lantern 2: Second corner sharp.\n- ${localTime(NOW - 7_200_000)}, lantern 1: First corner sharp.`,
      ...tail,
    ]);
    expect(topicPrompt(topic({ doneNotes: [] }), known())).toBe(tail.join('\n\n'));
  });

  it('TOPIC-17.4: the live member Session whose Status changed last says where it works, with its branch when known; none live, or no working directory, adds no line', () => {
    const members = [sessionMember(1), sessionMember(2), sessionMember(3)];
    const sessions = byId([
      liveRow(1, { statusSince: NOW - 600_000, cwd: '/Users/me/Projects/old' }),
      liveRow(2, { statusSince: NOW - 30_000, cwd: '/Users/me/Projects/anvil-worktrees/corners', git: { repo: 'anvil', worktree: 'corners', branch: 'feat/corners', commonDir: '/x', defaultBranch: 'main' } }),
    ]);
    const line = (s: ReadonlyMap<string, SessionRow>) => parts(topic({ members }), known({ sessions: s })).find((p) => p.startsWith('Working directory:'));
    expect(line(sessions)).toBe('Working directory: /Users/me/Projects/anvil-worktrees/corners (branch feat/corners), where lantern 2 now is live.');
    expect(line(byId([liveRow(1, { git: null })]))).toBe('Working directory: /Users/me/Projects/anvil, where lantern 1 now is live.');
    expect(line(byId([liveRow(1, { cwd: null })]))).toBeUndefined();
    expect(line(new Map())).toBeUndefined();
    // A row under another Harness isn't this member (TOPIC-4.1).
    expect(line(byId([liveRow(1, { harness: 'codex' })]))).toBeUndefined();
  });

  it('TOPIC-17.5: the Sessions go live first, then newest added, as `<id> <Harness> <title>`, a live one with its current title and "(live)"; one tb-session no longer has is left out; at most 8, then a count', () => {
    const members = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => sessionMember(n, NOW - n * 1000, n === 4 ? 'codex' : 'claude'));
    const sessions = byId([liveRow(9, { status: 'needs-you' }), liveRow(10)]);
    const list = parts(topic({ members }), known({ sessions, pruned: [`claude:${sid(3)}`] })).find((p) => p.startsWith('Earlier Sessions'))!;
    expect(list.split('\n')).toEqual([
      'Earlier Sessions (read one with `tb-session show <id>`):',
      `- ${sid(9)} claude lantern 9 now (live)`,
      `- ${sid(10)} claude lantern 10 now (live)`,
      `- ${sid(1)} claude lantern 1`,
      `- ${sid(2)} claude lantern 2`,
      `- ${sid(4)} codex lantern 4`,
      `- ${sid(5)} claude lantern 5`,
      `- ${sid(6)} claude lantern 6`,
      `- ${sid(7)} claude lantern 7`,
      '+2 more in the Topic',
    ]);
  });

  it('TOPIC-17.6: every part in its order, a blank line between each, and a part with nothing in it left out', () => {
    const task = member({ kind: 'task', ref: { id: '41000101' }, snapshot: { title: 'Light the lanterns', project: 'Lantern Works', url: 'https://app.fantastic.productive.io/109-productive/tasks/41000101' } }, NOW);
    const handover = { at: NOW - 60_000, from: 'lantern 1', text: 'Corner four is next.' };
    const doneNotes = [{ at: NOW - 120_000, name: 'lantern 1', note: 'Corner three sharp.' }];
    const t = topic({ notes: 'Half up.', members: [prMember(2), task, sessionMember(1)], handover, doneNotes });
    expect(parts(t, known({ work: work([workPr(2)]), sessions: byId([liveRow(1)]) }))).toEqual([
      'Half up.',
      `Latest Handover (${localTime(NOW - 60_000)}, from lantern 1):\nCorner four is next.`,
      `PRs:\n- ${prUrl(2)} (draft, CI passing)`,
      'https://app.fantastic.productive.io/109-productive/tasks/41000101',
      `Done notes:\n- ${localTime(NOW - 120_000)}, lantern 1: Corner three sharp.`,
      'Working directory: /Users/me/Projects/anvil (branch main), where lantern 1 now is live.',
      `Earlier Sessions (read one with \`tb-session show <id>\`):\n- ${sid(1)} claude lantern 1 now (live)`,
      ...tail,
    ]);
    // Nothing known beyond the Topic: the Topic line and the restate line alone.
    expect(topicPrompt(topic())).toBe(tail.join('\n\n'));
  });
});
