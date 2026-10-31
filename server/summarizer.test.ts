import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NewMember, Topic, TopicMember, TopicsView } from '../shared/topics.ts';
import { memberKey } from '../shared/topics.ts';
import type { SessionRow } from '../shared/types.ts';
import type { WorkSnapshot } from '../shared/work.ts';
import type { RunOptions } from './exec.ts';
import type { SessionBrief } from './history.ts';
import { MAX_INPUT, NOT_INSTALLED, SUMMARY_SCHEMA, SUMMARY_SYSTEM_PROMPT, SUMMARY_TIMEOUT_MS, Summarizer, readAnswer, summaryInput } from './summarizer.ts';
import { TopicStore, Topics, TopicsError } from './topics.ts';

const ANSWER = readFileSync(new URL('./fixtures/claude/summary-answer.json', import.meta.url), 'utf8');
const BUDGET = readFileSync(new URL('./fixtures/claude/summary-budget.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-31T12:00:00Z');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'lookout-summary-'));
  dirs.push(dir);
  return dir;
}

const sid = (n: number) => `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SESSION = (n: number, title = `session ${n}`): NewMember => ({ kind: 'session', ref: { harness: 'claude', sessionId: sid(n) }, snapshot: { harness: 'claude', title, directory: '~/Projects/fantastic' } });
const PR: NewMember = { kind: 'pr', ref: { url: 'https://github.com/productiveio/fantastic/pull/812' }, snapshot: { repo: 'fantastic', number: 812, title: 'Rates table', url: 'https://github.com/productiveio/fantastic/pull/812' } };
const TASK: NewMember = { kind: 'task', ref: { id: '123' }, snapshot: { title: 'Rates table port', project: 'Fantastic', url: 'https://app.fantastic.productive.io/109-productive/tasks/123' } };
const key = (m: NewMember) => memberKey(m.kind, m.ref);
const brief = (over: Partial<SessionBrief> = {}): SessionBrief => ({ summary: 'Port rates table to React', branch: 'feature/rates-table', messageCount: 84, lastActiveAt: NOW - 2 * 3_600_000, firstPrompt: 'Port the Rates table screen.', lastAssistant: 'The table renders and sorts.', ...over });

const WORK = {
  prs: { state: 'ok', mine: [{ repo: 'fantastic', number: 812, title: 'Rates table', url: PR.ref.url, chip: 'draft', ci: 'failing' }], reviewRequests: [] },
  tasks: { state: 'ok', tasks: [{ id: '123', title: 'Rates table port', project: 'Fantastic', status: 'In progress', description: null }] },
} as unknown as WorkSnapshot;

const member = (m: NewMember, addedAt: number): TopicMember => ({ ...m, key: key(m), addedAt, reason: 'added by hand' }) as TopicMember;
const topicOf = (members: TopicMember[], over: Partial<Topic> = {}): Topic => ({ id: 't1', title: 'Rates table port', notes: 'Port the Rates table.\nRounding: half up.', state: 'open', createdAt: 0, updatedAt: 0, members, outputs: null, pos: null, summary: null, summaryStale: false, ...over });

interface Call {
  file: string;
  args: readonly string[];
  opts: RunOptions;
}

/** A fake `claude`: logs its argv, working directory and stdin; each run waits until the test answers it. */
function fakeClaude() {
  const calls: (Call & { answer(out: string): void; fail(err: Record<string, unknown>): void })[] = [];
  const runner = (file: string, args: readonly string[], opts: RunOptions) =>
    new Promise<string>((resolve, reject) => {
      opts.signal?.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { aborted: true })), { once: true });
      calls.push({ file, args, opts, answer: resolve, fail: (e) => reject(Object.assign(new Error('failed'), e)) });
    });
  return { runner, calls };
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

function setup(opts: { claudeBin?: string | null; briefs?: Record<string, SessionBrief | null | Error>; sessions?: SessionRow[] } = {}) {
  const dir = tempDir();
  const path = join(dir, 'topics.db');
  const views: TopicsView[] = [];
  const topics = new Topics({ path, open: () => new TopicStore(path, { now: () => NOW }), onChange: (v) => views.push(v) });
  const claude = fakeClaude();
  const logs: string[] = [];
  const asked: string[] = [];
  const runDir = join(dir, 'claude-run');
  const summarizer = new Summarizer({
    topics,
    runner: claude.runner,
    claudeBin: async () => (opts.claudeBin === undefined ? '/Users/me/.local/bin/claude' : opts.claudeBin),
    brief: async (id) => {
      asked.push(id);
      const b = opts.briefs?.[id];
      if (b instanceof Error) throw b;
      return b === undefined ? brief() : b;
    },
    sessions: () => opts.sessions ?? [],
    work: () => WORK,
    runDir,
    env: { HOME: dir, PATH: '/usr/bin', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://x' },
    now: () => NOW,
    log: (l) => logs.push(l),
  });
  topics.summarizer = summarizer;
  return { topics, summarizer, claude, logs, asked, runDir, views };
}

describe('TOPIC-11 a summary of the Topic', () => {
  it('TOPIC-11.2: one claude -p run with Sonnet, no tools, MCP servers, slash commands, settings or saved session, from an empty directory Lookout owns, cut off at 120 s and $0.50', async () => {
    const { topics, summarizer, claude, runDir } = setup();
    const t = topics.create('Rates table port');
    topics.addMember(t.id, PR);
    summarizer.start(t.id);
    await settle();
    expect(claude.calls).toHaveLength(1);
    const { file, args, opts } = claude.calls[0]!;
    expect(file).toBe('/Users/me/.local/bin/claude');
    expect(args).toEqual([
      '-p', '--model', 'sonnet', '--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', '', '--no-session-persistence',
      '--output-format', 'json', '--json-schema', JSON.stringify(SUMMARY_SCHEMA), '--max-budget-usd', '0.5', '--system-prompt', SUMMARY_SYSTEM_PROMPT,
    ]);
    // Never `--mcp-config`, `--allowedTools` (not a sandbox) or `--resume`.
    expect(args.some((a) => /^--(mcp-config|allowedTools|resume|continue|bare)$/.test(a))).toBe(false);
    expect(opts.cwd).toBe(runDir);
    expect(statSync(runDir).mode & 0o777).toBe(0o700);
    expect(opts.timeoutMs).toBe(SUMMARY_TIMEOUT_MS);
    expect(SUMMARY_TIMEOUT_MS).toBe(120_000);
    // LAUNCH's cleaned environment: no Claude Code or telemetry variables from the server's own.
    expect(opts.env).toEqual({ HOME: expect.any(String), PATH: '/usr/bin' });
    expect(opts.stdin).toContain('# Topic: Rates table port');
    claude.calls[0]!.answer(ANSWER);
    await settle();
  });

  it('TOPIC-11.3: the input is the Topic, its Edges, each member under a short key with its snapshot and live state, the Sessions as tb-session says, and the Outputs', () => {
    const live: SessionRow = { id: sid(2), harness: 'claude', title: 'spec, live', status: 'needs-you' } as SessionRow;
    const members = [member(SESSION(1, 'rates-port'), 10), member(SESSION(2, 'spec'), 20), member(SESSION(3, 'old fix'), 30), member(PR, 40), member(TASK, 50)];
    const other = topicOf([], { id: 't2', title: 'Proposals v2' });
    const topic = topicOf(members, {
      outputs: { items: [{ kind: 'file', type: 'doc', key: 'a', title: 'Rates port doc', updatedAt: NOW - 5 * 3_600_000 } as never], total: 3 },
    });
    const briefs = new Map<string, SessionBrief | null>([
      [key(SESSION(1)), brief({ lastAssistant: 'Rounding of the totals row still differs.' })],
      [key(SESSION(2)), brief({ summary: 'Spec the rates', firstPrompt: 'x'.repeat(600) })],
      [key(SESSION(3)), null],
    ]);
    const { text, keys } = summaryInput({ topic, topics: [topic, other], edges: [{ from: 't1', to: 't2', label: 'part of', createdAt: 0 }], sessions: new Map([[sid(2), live]]), work: WORK, briefs, now: NOW });
    expect([...keys.keys()]).toEqual(['S1', 'S2', 'S3', 'PR1', 'T1']);
    expect(keys.get('PR1')).toEqual({ key: key(PR), name: 'fantastic #812' });
    expect(keys.get('S2')).toEqual({ key: key(SESSION(2)), name: 'spec, live' });
    expect(text).toContain('# Topic: Rates table port');
    expect(text).toContain('Rounding: half up.');
    expect(text).toContain('- This Topic part of "Proposals v2"');
    expect(text).toMatch(/### S1 · Session: rates-port\n- Added: 1970-01-01 00:00 UTC \(added by hand\)/);
    expect(text).toContain('- Summary: Port rates table to React\n- Branch: feature/rates-table\n- Messages: 84; last active: 2026-10-31 10:00 UTC');
    expect(text).toContain('- Last reply:\n> Rounding of the totals row still differs.');
    expect(text).toContain('### S2 · Session: spec, live');
    expect(text).toContain('- State: running, Needs you');
    // A Session tb-session no longer has: its snapshot, and that its history is gone.
    expect(text).toMatch(/### S3 · Session: old fix\n.*\n.*\n- State: ended; its history is gone\n\n/);
    expect(text).toContain('### PR1 · PR: fantastic #812 Rates table\n- Added: 1970-01-01 00:00 UTC (added by hand)\n- State: draft, CI failing');
    expect(text).toContain('### T1 · Task: Rates table port\n- Added: 1970-01-01 00:00 UTC (added by hand)\n- Project: Fantastic\n- Status: In progress');
    expect(text).toContain('- Rates port doc · doc · 2026-10-31 07:00 UTC\n- and 2 more');
    // A member Work doesn't list.
    const gone = summaryInput({ topic, topics: [topic], edges: [], sessions: new Map(), work: { ...WORK, prs: { ...WORK.prs, mine: [] } } as WorkSnapshot, briefs, now: NOW }).text;
    expect(gone).toContain('- State: not in Work (merged, closed, or not on the board)');
  });

  it('TOPIC-11.3: past 60,000 characters, the least recently active Sessions lose their last messages first, then their first prompts', () => {
    // A 46-member Topic, as Proposals porting has: 40 Sessions with long prompts and replies, 4 PRs, 2 Tasks.
    const members = [
      ...Array.from({ length: 40 }, (_, i) => member(SESSION(i + 1), i)),
      ...[1, 2, 3, 4].map((n) => member({ ...PR, ref: { url: `${PR.ref.url}${n}` } } as NewMember, 100 + n)),
      member(TASK, 200),
      member({ ...TASK, ref: { id: '124' } } as NewMember, 201),
    ];
    const briefs = new Map(members.filter((m) => m.kind === 'session').map((m, i) => [m.key, brief({ lastActiveAt: NOW - (40 - i) * 60_000, firstPrompt: 'p'.repeat(600), lastAssistant: 'r'.repeat(1200) })]));
    const input = (b: typeof briefs) => summaryInput({ topic: topicOf(members), topics: [], edges: [], sessions: new Map(), work: WORK, briefs: b, now: NOW }).text;
    const whole = input(new Map([...briefs].map(([k, v]) => [k, { ...v, firstPrompt: 'p'.repeat(600), lastAssistant: 'r'.repeat(1200) }])));
    const text = input(briefs);
    expect(text.length).toBeLessThanOrEqual(MAX_INPUT);
    expect(text.length).toBeLessThan(whole.length + 1);
    const section = (n: number) => text.slice(text.indexOf(`### S${n} ·`), text.indexOf('\n\n', text.indexOf(`### S${n} ·`)));
    // S1 was least recently active: its reply went first; S40, most recently active, keeps both.
    expect(section(1)).not.toContain('Last reply');
    expect(section(40)).toContain('Last reply');
    expect(section(40)).toContain('First prompt');
    // Prompts go only once every reply has.
    const bigger = new Map([...briefs].map(([k, v]) => [k, { ...v, summary: 's'.repeat(300) }]));
    const tight = summaryInput({ topic: topicOf(members, { notes: 'n'.repeat(20_000) }), topics: [], edges: [], sessions: new Map(), work: WORK, briefs: bigger, now: NOW }).text;
    expect(tight.length).toBeLessThanOrEqual(MAX_INPUT);
    expect(tight).not.toContain('Last reply');
    expect(tight.match(/First prompt/g)?.length ?? 0).toBeLessThan(40);
    expect(tight).toContain('### S40 ·');
  });

  it('TOPIC-11.3, TOPIC-11.4: when even the cut leaves too much, the members it took out can’t be cited', () => {
    const long = (n: number) => member({ ...TASK, ref: { id: String(1000 + n) }, snapshot: { ...TASK.snapshot, title: `t${n}` } } as NewMember, n);
    const tasks = Array.from({ length: 46 }, (_, i) => long(i));
    const work = { ...WORK, tasks: { state: 'ok', tasks: tasks.map((t) => ({ id: (t.ref as { id: string }).id, title: t.snapshot.title, project: 'P', status: 'Open', description: 'd'.repeat(1500) })) } } as unknown as WorkSnapshot;
    const { text, keys } = summaryInput({ topic: topicOf(tasks, { notes: 'n'.repeat(20_000) }), topics: [], edges: [], sessions: new Map(), work, briefs: new Map(), now: NOW });
    expect(text.length).toBeLessThanOrEqual(MAX_INPUT);
    expect(text.endsWith('…(cut off)')).toBe(true);
    expect(keys.size).toBeGreaterThan(0);
    expect(keys.size).toBeLessThan(46);
    for (const k of keys.keys()) expect(text).toContain(`\n### ${k} · `);
    expect(keys.has('T46')).toBe(false);
  });

  it('TOPIC-11.3: a Session read that fails is sent with its snapshot, and the reads run for Session members only', async () => {
    const { topics, summarizer, claude, asked } = setup({ briefs: { [sid(2)]: new Error('tb-session took too long to answer.') } });
    const t = topics.create('A');
    topics.addMember(t.id, SESSION(1, 'one'));
    topics.addMember(t.id, SESSION(2, 'two'));
    topics.addMember(t.id, PR);
    summarizer.start(t.id);
    await settle();
    expect(asked.sort()).toEqual([sid(1), sid(2)]);
    const stdin = claude.calls[0]!.opts.stdin!;
    expect(stdin).toContain('### S1 · Session: one');
    expect(stdin).toMatch(/### S2 · Session: two\n- Added: .*\n- Claude Code, in ~\/Projects\/fantastic\n- State: ended\n\n/);
    claude.calls[0]!.answer(ANSWER);
    await settle();
  });

  it('TOPIC-11.4: the answer has a fixed shape; cited keys become the members they stand for, and a key the input didn’t have is dropped', () => {
    const keys = new Map([
      ['S1', { key: key(SESSION(1)), name: 'rates-port' }],
      ['PR1', { key: key(PR), name: 'fantastic #812' }],
    ]);
    const read = readAnswer(ANSWER, keys);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.answer.what).toMatch(/^Port the Rates table screen/);
    expect(read.answer.state).toBe('in progress');
    expect(read.answer.why).toMatch(/draft with failing CI/);
    expect(read.answer.open[2]).toEqual({ text: 'PR #812 is still a draft and CI is failing.', cites: [{ key: key(PR), name: 'fantastic #812' }] });
    expect(read.answer.recent[1]!.cites.map((c) => c.name)).toEqual(['rates-port', 'fantastic #812']);
    expect(read.answer.recent[2]!.cites).toEqual([]);
    expect(read.model).toBe('claude-sonnet-5-5');
    expect(read.costUsd).toBeCloseTo(0.014656, 6);
    // A key the input didn't have.
    const made = JSON.parse(ANSWER) as { structured_output: { next: { cites: string[] }[] } };
    made.structured_output.next[0]!.cites = ['S1', 'S9', 'T4'];
    const dropped = readAnswer(JSON.stringify(made), keys);
    expect(dropped.ok && dropped.answer.next[0]!.cites.map((c) => c.name)).toEqual(['rates-port']);
    // Something that isn't the shape, anywhere in it: the whole answer is refused, nothing is dropped quietly.
    const shaped = (o: Record<string, unknown>) => JSON.stringify({ ...JSON.parse(ANSWER), structured_output: { what: 'x', state: 'done', why: 'y', open: [], recent: [], next: [], ...o } });
    for (const bad of [
      'not json',
      '{}',
      shaped({ state: 'finished' }),
      shaped({ why: undefined }),
      shaped({ open: [42] }),
      shaped({ recent: [{ text: 'no cites' }] }),
      shaped({ next: [{ text: '', cites: [] }] }),
      shaped({ next: [{ text: 'x', cites: [1] }] }),
      JSON.stringify({ ...JSON.parse(ANSWER), structured_output: null }),
    ]) {
      expect(readAnswer(bad, keys)).toEqual({ ok: false, reason: "Claude answered something Lookout can't read." });
    }
  });

  it('TOPIC-11.5: a summary is stored with when, the model, its cost and a fingerprint; a member or notes change makes it out of date, a Status or CI change doesn’t; Delete takes it', async () => {
    const { topics, summarizer, claude } = setup();
    const t = topics.create('A');
    topics.addMember(t.id, PR);
    summarizer.start(t.id);
    await settle();
    claude.calls[0]!.answer(ANSWER);
    await settle();
    const stored = () => topics.view().topics.find((x) => x.id === t.id)!;
    expect(stored().summary).toMatchObject({ writtenAt: NOW, model: 'claude-sonnet-5-5', costUsd: expect.closeTo(0.014656, 6), answer: { state: 'in progress' } });
    expect(stored().summary!.answer.open[2]!.cites).toEqual([{ key: key(PR), name: 'fantastic #812' }]);
    expect(stored().summaryStale).toBe(false);
    topics.update(t.id, { title: 'A, renamed' });
    expect(stored().summaryStale).toBe(false);
    topics.addMember(t.id, TASK);
    expect(stored().summaryStale).toBe(true);
    topics.removeMember(t.id, 'task', JSON.stringify({ id: '123' }));
    expect(stored().summaryStale).toBe(false);
    topics.update(t.id, { notes: 'Changed.' });
    expect(stored().summaryStale).toBe(true);
    topics.delete(t.id);
    expect(topics.view().topics).toEqual([]);
  });

  it('TOPIC-11.5: the summary survives a restart, and deleting its Topic deletes the row', async () => {
    const dir = tempDir();
    const path = join(dir, 'topics.db');
    const store = new TopicStore(path);
    const id = store.create('A');
    store.saveSummary(id, { answer: { what: 'w', state: 'done', why: 'y', open: [], recent: [], next: [] }, writtenAt: 5, model: 'claude-sonnet-5-5', costUsd: 0.02 }, 'f');
    store.close();
    const again = new TopicStore(path);
    expect(again.summaries().get(id)).toEqual({ summary: { answer: { what: 'w', state: 'done', why: 'y', open: [], recent: [], next: [] }, writtenAt: 5, model: 'claude-sonnet-5-5', costUsd: 0.02 }, fingerprint: 'f' });
    again.delete(id);
    expect(again.summaries().size).toBe(0);
    again.close();
  });

  it('TOPIC-11.6: while it runs every tab sees it; one run per Topic, at most two at once; Cancel stops it and keeps the summary before', async () => {
    const { topics, summarizer, claude, views } = setup();
    const [a, b, c] = ['A', 'B', 'C'].map((title) => topics.create(title));
    summarizer.start(a!.id);
    expect(topics.view().summarizing).toEqual([a!.id]);
    expect(() => summarizer.start(a!.id)).toThrow(new TopicsError(409, 'A summary of this Topic is already being written.'));
    summarizer.start(b!.id);
    expect(() => summarizer.start(c!.id)).toThrow('2 summaries are being written; try again when one is done.');
    await settle();
    claude.calls[0]!.answer(ANSWER);
    await settle();
    const first = topics.view().topics.find((t) => t.id === a!.id)!.summary;
    expect(first).not.toBeNull();
    expect(topics.view().summarizing).toEqual([b!.id]);
    summarizer.start(a!.id);
    await settle();
    summarizer.cancel(a!.id);
    await settle();
    expect(topics.view().summarizing).toEqual([b!.id]);
    expect(topics.view().summaryErrors[a!.id]).toEqual({ reason: 'Cancelled. The summary before it is kept.', fix: null });
    expect(topics.view().topics.find((t) => t.id === a!.id)!.summary).toEqual(first);
    // Every change went to every tab as a `topics` event.
    expect(views.some((v) => v.summarizing.includes(b!.id))).toBe(true);
    // A new run clears the last one's error.
    summarizer.start(a!.id);
    expect(topics.view().summaryErrors[a!.id]).toBeUndefined();
    await summarizer.close();
    expect(topics.view().summarizing).toEqual([]);
  });

  it('TOPIC-11.6: a run cut off at the budget or the timeout, a failed one, or one that answers something unreadable says why, logs one redacted line and keeps the summary', async () => {
    const { topics, summarizer, claude, logs } = setup();
    const t = topics.create('A');
    const runOnce = async (finish: (call: (typeof claude.calls)[number]) => void) => {
      summarizer.start(t.id);
      await settle();
      finish(claude.calls.at(-1)!);
      await settle();
      return topics.view().summaryErrors[t.id];
    };
    // `claude -p` prints its result and exits 1 when it stops at the budget.
    expect(await runOnce((c) => c.fail({ code: 1, stdout: BUDGET, stderr: '' }))).toEqual({ reason: 'It reached the $0.50 limit and was stopped.', fix: null });
    expect(await runOnce((c) => c.fail({ timedOut: true, code: null }))).toEqual({ reason: 'It took longer than 120 s and was stopped.', fix: null });
    expect(await runOnce((c) => c.answer('{"type":"result"'))).toEqual({ reason: "Claude answered something Lookout can't read.", fix: null });
    expect(await runOnce((c) => c.fail({ code: 1, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key: sk-ant-abcdef123456' }), stderr: '' }))).toEqual({ reason: 'Claude said: Invalid API key: sk-…', fix: null });
    expect(await runOnce((c) => c.fail({ code: 2, stdout: '', stderr: 'error: token=abc123secret\nmore' }))).toEqual({ reason: 'claude failed: token=…', fix: null });
    expect(topics.view().topics[0]!.summary).toBeNull();
    expect(logs).toHaveLength(5);
    expect(logs.every((l) => l.startsWith('lookout: claude -p: a summary failed: '))).toBe(true);
    expect(logs.join('\n')).not.toMatch(/abc123secret|abcdef123456/);
  });

  it('TOPIC-11.6: a claude Fleet can’t find says it isn’t installed, and nothing runs', async () => {
    const { topics, summarizer, claude } = setup({ claudeBin: null });
    const t = topics.create('A');
    summarizer.start(t.id);
    await settle();
    expect(claude.calls).toEqual([]);
    expect(topics.view().summaryErrors[t.id]).toEqual(NOT_INSTALLED);
    expect(NOT_INSTALLED.reason).toMatch(/isn't installed/);
    // Gone between Fleet's list and the run.
    const again = setup();
    const u = again.topics.create('B');
    again.summarizer.start(u.id);
    await settle();
    again.claude.calls[0]!.fail({ code: 'ENOENT' });
    await settle();
    expect(again.topics.view().summaryErrors[u.id]).toEqual(NOT_INSTALLED);
  });

  it('TOPIC-11.6: deleting the Topic stops its run, and nothing of it is kept', async () => {
    const { topics, summarizer, claude, logs } = setup();
    const t = topics.create('A');
    summarizer.start(t.id);
    await settle();
    expect(claude.calls).toHaveLength(1);
    topics.delete(t.id);
    await settle();
    expect(topics.view().summarizing).toEqual([]);
    expect(topics.view().summaryErrors).toEqual({});
    expect(logs).toEqual([]);
    expect(() => summarizer.start(t.id)).toThrow(new TopicsError(404, 'That Topic no longer exists.'));
  });
});
