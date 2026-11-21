import { describe, expect, it } from 'vitest';
import { type AgentRow, pathsIn, REVIEW_WORD, reviewRounds, reviewRuns, type ReviewerSession } from './reviews.ts';
import type { CommandRow } from './test-runs.ts';

// Invented commands, Subagent calls and headless Sessions.
const T = (hhmm: string, ss = 0) => Date.parse(`2026-11-21T${hhmm}:${String(ss).padStart(2, '0')}Z`);
const NOW = T('15:00');
const SHOP = '/Users/me/shop';
const cmd = (key: string, command: string, start: number, end: number, extra: Partial<CommandRow> = {}): CommandRow => ({
  key, command, timestamp: end, startedAt: start, cwd: SHOP, ended: 'exited', exitCode: 0, outputTail: null, subagent: false, ...extra,
});
const agent = (key: string, description: string | null, start: number, end: number, extra: Partial<AgentRow> = {}): AgentRow => ({
  key, description, subagentType: 'general-purpose', model: 'claude-opus-5-5', effort: null, startedAt: start, timestamp: end, ended: 'completed', ...extra,
});
let n = 0;
const headless = (harness: 'codex' | 'claude', created: number, extra: Partial<ReviewerSession> = {}): ReviewerSession => ({
  sessionId: `0000000${++n}-0000-4000-8000-000000000000`, harness, projectPath: SHOP, createdAt: created, firstPrompt: 'Review the diff against the spec.', transcriptMissing: false, model: null, effort: null, ...extra,
});
const rounds = (commands: CommandRow[], agents: AgentRow[], sessions: ReviewerSession[]) => reviewRounds(reviewRuns(commands, agents, sessions, NOW), NOW);

describe('EVID-6.1: review runs', () => {
  it('EVID-6.1: a word that starts with review, at a word’s start, in any case; "preview" is none', () => {
    for (const s of ['review', 'Reviews', 'reviewer', 're-review', 'code-review', 'p-codex-dual-review', 'port-reviewer', 'Code review round 2', 'run_review.sh']) expect(REVIEW_WORD.test(s), s).toBe(true);
    for (const s of ['preview', 'Preview the page', 'overreview', 'codeReview']) expect(REVIEW_WORD.test(s), s).toBe(false);
  });

  it('EVID-6.1: a Subagent whose description or type says review is a run; one that says preview, or nothing of review, is not', () => {
    const agents = [
      agent('a1', 'Code review round 2', T('14:00'), T('14:05')),
      agent('a2', null, T('14:10'), T('14:12'), { subagentType: 'p-fantastic:port-reviewer' }),
      agent('a3', 'Preview the landing page', T('14:20'), T('14:22')),
      agent('a4', 'Implement slice 2', T('14:30'), T('14:40')),
    ];
    const runs = reviewRuns([], agents, [], NOW);
    expect(runs.map((r) => r.key)).toEqual(['a1', 'a2']);
    expect(runs[1]!.text).toBe('p-fantastic:port-reviewer');
  });

  it('EVID-6.1: a Codex run that implements, whose words never say review, is no run', () => {
    const c = cmd('c1', 'codex exec "Implement slice 2 of the spec"', T('14:00'), T('14:20'));
    expect(reviewRuns([c], [], [headless('codex', T('14:00', 2), { firstPrompt: 'Implement slice 2 of the spec' })], NOW)).toEqual([]);
  });

  it('EVID-6.1: the review word only in the reviewer’s first prompt, started by a command that names neither a Harness nor a review', () => {
    const c = cmd('c1', './worker.sh --task 4', T('14:00'), T('14:07'));
    const s = headless('codex', T('14:00', 2), { firstPrompt: '<task>Review the worktree against the plan.</task>' });
    expect(reviewRuns([c], [], [s], NOW)).toMatchObject([{ key: 'c1', start: T('14:00'), end: T('14:07'), outcome: 'finished' }]);
  });

  it('EVID-6.1: a reviewer in a worktree the command names counts; a resume of an earlier reviewer is no new run', () => {
    const tree = '/Users/me/shop-worktrees/fix-rates';
    const review = cmd('c1', `~/.claude/plugins/p-codex/scripts/codex-run.sh /tmp/p-codex-review-x '${tree}/' gpt-6.1-sol xhigh`, T('14:00'), T('14:07'));
    const reviewer = headless('codex', T('14:00', 2), { projectPath: tree });
    // The resume continues it: the Session was created before the resuming command started.
    const resume = cmd('c2', `codex exec resume ${reviewer.sessionId} "Re-review after the fixes"`, T('14:30'), T('14:34'), { cwd: tree });
    const runs = reviewRuns([review, resume], [], [reviewer], NOW);
    expect(runs.map((r) => r.key)).toEqual(['c1']);
    expect(pathsIn(review.command)).toContain(tree);
  });

  it('EVID-6.1: a quoted path is whole, spaces included, and a path inside a quoted command counts', () => {
    const tree = '/Users/me/shop worktree';
    expect(pathsIn(`codex-run.sh /tmp/run '${tree}/' gpt-6.1-sol`)).toContain(tree);
    expect(pathsIn(`codex-run.sh --cd="${tree}" review`)).toContain(tree);
    expect(pathsIn(`sh -c 'cd /Users/me/shop && ./review.sh'`)).toContain('/Users/me/shop');
    const c = cmd('c1', `~/bin/codex-run.sh /tmp/run '${tree}/' review`, T('14:00'), T('14:07'), { cwd: '/Users/me' });
    expect(reviewRuns([c], [], [headless('codex', T('14:00', 2), { projectPath: tree })], NOW).map((r) => r.key)).toEqual(['c1']);
  });

  it('EVID-6.1: a long command overlapping a reviewer from a different directory is no run', () => {
    const c = cmd('c1', 'pnpm review:all', T('14:00'), T('14:30'));
    expect(reviewRuns([c], [], [headless('codex', T('14:10'), { projectPath: '/Users/me/other' })], NOW)).toEqual([]);
  });

  it('EVID-6.1: a refused command is no run, and a reviewer created outside the window is none of it', () => {
    const refused = cmd('c1', 'codex-run.sh review', T('14:00'), T('14:00', 1), { ended: 'refused', exitCode: null });
    const later = cmd('c2', 'codex-run.sh review', T('14:10'), T('14:15'));
    expect(reviewRuns([refused, later], [], [headless('codex', T('14:00', 0)), headless('codex', T('14:16'))], NOW)).toEqual([]);
  });

  it('EVID-6.1: a headless Session in the windows of several commands is a reviewer of each; windows are inclusive', () => {
    const s = headless('claude', T('14:05'));
    const a = cmd('c1', 'review.sh a', T('14:00'), T('14:05'));
    const b = cmd('c2', 'review.sh b', T('14:05'), T('14:09'));
    expect(reviewRuns([a, b], [], [s], NOW).map((r) => [r.key, r.reviewers.length])).toEqual([['c1', 1], ['c2', 1]]);
  });
});

describe('EVID-6.3: Review rounds', () => {
  it('EVID-6.3: a dual review, two commands and a Codex and a Claude Code reviewer, is one round with two reviewers', () => {
    const codex = cmd('c1', 'codex-run.sh /tmp/p-codex-dual-review-1 schema.json /Users/me/shop gpt-6.1-sol xhigh', T('14:14'), T('14:21'));
    const claude = cmd('c2', 'claude-run.sh /tmp/p-codex-dual-review-1 /Users/me/shop', T('14:14', 1), T('14:19'));
    const sessions = [
      headless('codex', T('14:14', 2), { model: 'gpt-6.1-sol', effort: 'xhigh' }),
      headless('claude', T('14:14', 3), { model: 'claude-opus-5-5', effort: 'high' }),
    ];
    const r = rounds([codex, claude], [], sessions);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ key: 'c1', outcome: 'finished', start: T('14:14'), end: T('14:21'), runs: [codex.command, claude.command] });
    expect(r[0]!.reviewers).toEqual([
      { kind: 'headless', harness: 'codex', sessionId: sessions[0]!.sessionId, transcriptMissing: false, model: 'gpt-6.1-sol', effort: 'xhigh' },
      { kind: 'headless', harness: 'claude', sessionId: sessions[1]!.sessionId, transcriptMissing: false, model: 'claude-opus-5-5', effort: 'high' },
    ]);
  });

  it('EVID-6.3: the fallback review by an Opus Subagent, and a review Subagent nested in another’s window, are one round; same words show once with a count', () => {
    const agents = [
      agent('a1', 'Code review of the diff', T('14:00'), T('14:10')),
      agent('a2', 'Review the tests', T('14:02'), T('14:04')),
      agent('a3', 'Review the docs', T('14:03'), T('14:05'), { model: 'claude-sonnet-5-5' }),
    ];
    const r = rounds([], agents, []);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ outcome: 'finished', start: T('14:00'), end: T('14:10'), runs: ['Code review of the diff', 'Review the tests', 'Review the docs'] });
    expect(r[0]!.reviewers).toEqual([{ kind: 'subagent', model: 'claude-opus-5-5', count: 2 }, { kind: 'subagent', model: 'claude-sonnet-5-5', count: 1 }]);
  });

  it('EVID-6.3: a run from 10:00 to 10:10 and one from 10:01 to 10:02 are one round, ending at 10:10', () => {
    const r = rounds([], [agent('a1', 'review', T('10:00'), T('10:10')), agent('a2', 'review', T('10:01'), T('10:02'))], []);
    expect(r).toEqual([expect.objectContaining({ start: T('10:00'), end: T('10:10') })]);
    // A third that starts after the second ended, but before the first did, joins it too: the latest end so far decides.
    expect(rounds([], [agent('a1', 'review', T('10:00'), T('10:10')), agent('a2', 'review', T('10:01'), T('10:02')), agent('a3', 'review', T('10:05'), T('10:12'))], [])).toHaveLength(1);
  });

  it('EVID-6.3: two rounds one after another, the latest start first', () => {
    const r = rounds([], [agent('a1', 'review', T('13:00'), T('13:05')), agent('a2', 'review round 2', T('14:00'), T('14:04'))], []);
    expect(r.map((x) => [x.key, x.start, x.end])).toEqual([['a2', T('14:00'), T('14:04')], ['a1', T('13:00'), T('13:05')]]);
  });

  it('EVID-6.3: a round still running has no end and is running; a running command’s window ends now', () => {
    const c = cmd('c1', 'codex-run.sh review', T('14:50'), T('14:50'), { ended: 'running', exitCode: null });
    const r = rounds([c], [agent('a1', 'review', T('14:40'), T('14:45'))], [headless('codex', T('14:55'))]);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ key: 'c1', outcome: 'running', start: T('14:50'), end: null });
    // A Subagent running keeps its round open to now.
    const s = rounds([], [agent('a1', 'review', T('14:00'), T('14:00'), { ended: 'running' }), agent('a2', 'review', T('14:58'), T('14:59'))], []);
    expect(s).toEqual([expect.objectContaining({ outcome: 'running', end: null, start: T('14:00') })]);
  });

  it('EVID-6.3: a headless run ends as its command did; a Subagent as its row says', () => {
    const outcome = (extra: Partial<CommandRow>) => rounds([cmd('c1', 'review.sh', T('14:00'), T('14:05'), extra)], [], [headless('codex', T('14:01'))])[0]!.outcome;
    expect(outcome({ exitCode: 0 })).toBe('finished');
    expect(outcome({ exitCode: 1 })).toBe('failed');
    expect(outcome({ ended: 'errored', exitCode: null })).toBe('failed');
    expect(outcome({ ended: 'timed_out', exitCode: null })).toBe('timed-out');
    expect(outcome({ ended: 'interrupted', exitCode: null })).toBe('stopped');
    expect(outcome({ exitCode: null })).toBe('unread');
    const sub = (ended: AgentRow['ended']) => rounds([], [agent('a1', 'review', T('14:00'), T('14:05'), { ended })], [])[0]!.outcome;
    expect([sub('completed'), sub('failed'), sub('stopped'), sub('running')]).toEqual(['finished', 'failed', 'stopped', 'running']);
  });

  it('EVID-6.3: a round finished when any run finished, else as the run that ended last; a reviewer that found problems still finished', () => {
    const one = rounds([], [agent('a1', 'review', T('14:00'), T('14:10'), { ended: 'failed' }), agent('a2', 'review', T('14:01'), T('14:03'))], []);
    expect(one[0]!.outcome).toBe('finished');
    const none = rounds([], [agent('a1', 'review', T('14:00'), T('14:10'), { ended: 'stopped' }), agent('a2', 'review', T('14:01'), T('14:03'), { ended: 'failed' })], []);
    expect(none[0]!.outcome).toBe('stopped');
  });

  it('EVID-6.3: a reviewer of two commands of one round shows once', () => {
    const s = headless('codex', T('14:01'));
    const r = rounds([cmd('c1', 'review.sh a', T('14:00'), T('14:05')), cmd('c2', 'review.sh b', T('14:01'), T('14:06'))], [], [s]);
    expect(r).toHaveLength(1);
    expect(r[0]!.reviewers).toHaveLength(1);
  });
});
