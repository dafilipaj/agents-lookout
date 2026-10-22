import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, ServerEvent, SessionRow } from '../shared/types.ts';
import { AnswerLedger } from './answerer.ts';
import type { RunOptions } from './exec.ts';
import type { FleetListResult } from './fleet.ts';
import { ViewError, Viewer } from './viewer.ts';

const row = (over: Partial<SessionRow> & { id: string }): SessionRow => ({
  pid: 4242,
  harness: 'claude',
  title: over.id,
  status: 'idle',
  waitingFor: null,
  statusSince: 0,
  contextPct: null,
  cwd: '/x',
  git: null,
  backend: 'tmux',
  controllable: true,
  ownHost: true,
  model: null,
  effort: null,
  backgroundShell: false,
  procStart: null,
  pendingModel: null, pendingEffort: null,
  modelAt: null,
  ...over,
});

type Raw = Record<string, unknown>;
const user = (i: number, text = `prompt ${i}`): Raw => ({ cursor: `c${i}`, role: 'user', kind: 'user', text, ts: null });
const reply = (i: number, text = `reply ${i}`): Raw => ({ cursor: `c${i}`, role: 'assistant', kind: 'assistant', text, ts: null, final: true });

/**
 * A Transcript Fleet reads: entries with cursors `g<generation>.<index>`. The top-level cursor adds
 * a read hint, `.r<revision>`: `--after` reports entries changed since then (their `rev`) as `updated`.
 * `queue` holds prompts typed while busy, sent last on every no-cursor and `--after` answer.
 */
class Transcript {
  entries: Raw[] = [];
  generation = 1;
  revision = 0;
  queue: string[] = [];
  constructor(n: number) {
    for (let i = 0; i < n; i++) this.entries.push(i % 2 ? reply(i) : user(i));
  }
  add(...raw: Raw[]) {
    this.entries.push(...raw);
  }
  /** Changes entry `i`, as a Harness does when a question is answered or a reply grows. */
  change(i: number, over: Raw) {
    this.revision++;
    this.entries[i] = { ...this.entries[i], ...over, rev: this.revision };
  }
}

const ok = (
  sessionId: string,
  harness: string,
  entries: Raw[],
  more: { before?: boolean; after?: boolean },
  cursor: string | null,
  updated: Raw[] = [],
) =>
  JSON.stringify({
    ok: true,
    session_id: sessionId,
    harness,
    transcript: '/t.jsonl',
    entries,
    updated,
    has_more_before: !!more.before,
    has_more_after: !!more.after,
    cursor,
  });

const failure = (kind: string, error: string) =>
  Object.assign(new Error('fleet exited with 1'), { code: 1, stderr: `error: ${error}\n`, stdout: JSON.stringify({ ok: false, kind, error }) });

function setup(opts: { fresh?: () => Promise<FleetListResult> } = {}) {
  const transcripts = new Map<string, Transcript>([
    ['sess-a', new Transcript(150)],
    ['sess-b', new Transcript(3)],
  ]);
  const rows = new Map<string, SessionRow>([
    ['sess-a', row({ id: 'sess-a' })],
    ['sess-b', row({ id: 'sess-b', harness: 'codex' })],
    ['codex:77', row({ id: 'codex:77', pid: 77, harness: 'codex' })],
    ['orca', row({ id: 'orca', backend: 'unknown', controllable: false })],
  ]);
  transcripts.set('77', new Transcript(2));
  transcripts.set('orca', new Transcript(4));
  const calls: string[][] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const perTarget = new Map<string, number>();
  /** The most calls ever running at once for one Session. */
  let maxPerTarget = 0;
  /** Calls cancelled through their signal. */
  let cancelled = 0;
  let delayMs = 0;
  /** Overrides the answer for the next calls. */
  let override: ((args: string[]) => string | Error | undefined) | null = null;

  const answer = (args: string[]): string => {
    const target = args.at(-1)!;
    const id = target === '77' ? 'codex:77' : target;
    const r = rows.get(id);
    const t = transcripts.get(target);
    if (!r) throw failure('target_not_found', `no session matches '${target}'`);
    if (!t) throw failure('transcript_not_found', `no transcript found for ${target}`);
    const withIdx = t.entries.map(({ rev: _rev, ...e }, i) => ({ ...e, cursor: `g${t.generation}.${i}` }));
    const queue = t.queue.map((text, n) => ({ cursor: `q1.${n}`, role: 'user', kind: 'user', text, ts: null, queued: true }));
    const top = (i: number) => (i < 0 ? null : `g${t.generation}.${i}.r${t.revision}`);
    const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
    const limit = Number(args[args.indexOf('--limit') + 1]);
    const sid = r.id.startsWith('codex:') ? null : r.id;
    let hint = t.revision;
    const index = (c: string) => {
      const m = /^g(\d+)\.(\d+)(?:\.r(\d+))?$/.exec(c);
      if (!m || Number(m[1]) !== t.generation || Number(m[2]) >= withIdx.length) throw failure('cursor_invalid', `cursor ${c} not found`);
      if (m[3] !== undefined) hint = Number(m[3]);
      return Number(m[2]);
    };
    const after = opt('after');
    const before = opt('before');
    if (after !== undefined) {
      const i = index(after);
      const out = withIdx.slice(i + 1, i + 1 + limit);
      const updated = withIdx.slice(0, i + 1).filter((_, k) => ((t.entries[k]!.rev as number) ?? 0) > hint);
      return ok(sid ?? 'x', r.harness, [...out, ...queue], { before: true, after: i + 1 + out.length < withIdx.length }, top(i + out.length), updated);
    }
    if (before !== undefined) {
      const i = index(before);
      const start = Math.max(0, i - limit);
      const out = withIdx.slice(start, i);
      return ok(sid ?? 'x', r.harness, out, { before: start > 0, after: true }, top(i - 1));
    }
    const start = Math.max(0, withIdx.length - limit);
    const out = withIdx.slice(start);
    return ok(sid ?? 'x', r.harness, [...out, ...queue], { before: start > 0 }, top(withIdx.length - 1));
  };

  const runner = vi.fn(async (_file: string, args: readonly string[], runOpts: RunOptions) => {
    if (!args.includes('messages')) throw new Error(`unexpected ${args.join(' ')}`);
    calls.push([...args]);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const target = args.at(-1)!;
    perTarget.set(target, (perTarget.get(target) ?? 0) + 1);
    maxPerTarget = Math.max(maxPerTarget, perTarget.get(target)!);
    try {
      if (delayMs) {
        // Like `run`: a cancel ends the call early (once the process is gone) with `aborted`.
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs);
          runOpts.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            cancelled++;
            reject(Object.assign(new Error('cancelled'), { aborted: true, code: null }));
          });
        });
      }
      const o = override?.([...args]);
      if (o instanceof Error) throw o;
      if (o !== undefined) return o;
      return answer([...args]);
    } finally {
      inFlight--;
      perTarget.set(target, perTarget.get(target)! - 1);
    }
  });
  const sent: { clientId: string; event: ServerEvent }[] = [];
  const viewer = new Viewer({
    runner,
    fleetBin: () => '/bin/fleet',
    lookup: (id) => rows.get(id) ?? null,
    freshList: opts.fresh ?? (async () => ({ kind: 'ok', rows: [] })),
    sendTo: (clientId, event) => sent.push({ clientId, event }),
    ledger: new AnswerLedger(),
    env: { PATH: '/usr/bin' },
  });
  const chat = (clientId?: string) =>
    sent.filter((s) => s.event.type === 'chat' && (!clientId || s.clientId === clientId)).map((s) => ({ to: s.clientId, ...(s.event as ChatEvent) }));
  return {
    viewer,
    calls,
    sent,
    chat,
    rows,
    transcripts,
    maxInFlight: () => maxInFlight,
    maxPerTarget: () => maxPerTarget,
    cancelled: () => cancelled,
    setDelay: (ms: number) => (delayMs = ms),
    setOverride: (f: typeof override) => (override = f),
  };
}

/** Runs zero-delay follow-ups (a reload, the rest of a burst) that a poll scheduled. */
async function settle() {
  // A timer set during a tick is due 1 ms later under fake timers.
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(1);
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());

describe('following the chat of viewed Sessions', () => {
  it('VIEW-1.6: a viewed Session loads its latest 100 entries first, with a cursor for "Show earlier"', async () => {
    const t = setup();
    t.viewer.watch('tab-1', 'sess-a', false);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls[0]).toEqual(['--local', 'messages', '--json', '--limit', '100', '--', 'sess-a']);
    const [reset] = t.chat('tab-1');
    expect(reset).toMatchObject({ op: 'reset', sessionId: 'sess-a', before: 'g1.50' });
    expect(reset!.op === 'reset' && reset!.entries.map((e) => e.cursor)).toEqual(Array.from({ length: 100 }, (_, i) => `g1.${i + 50}`));
  });

  it('VIEW-1.4: then `--after <cursor>` every second; new entries go to the tabs viewing that Session only', async () => {
    const t = setup();
    t.viewer.watch('tab-1', 'sess-b', false);
    t.viewer.watch('tab-2', 'sess-a', false);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    const bCalls = t.calls.filter((c) => c.at(-1) === 'sess-b');
    expect(bCalls[1]).toEqual(['--local', 'messages', '--json', '--after=g1.2.r0', '--limit', '500', '--', 'sess-b']);
    expect(t.chat('tab-1')).toHaveLength(1); // nothing new: nothing pushed

    t.transcripts.get('sess-b')!.add(user(3, 'Run the specs again'), reply(4, 'All green.'));
    await vi.advanceTimersByTimeAsync(1000);
    const appended = t.chat('tab-1').at(-1)!;
    expect(appended).toMatchObject({ op: 'append', sessionId: 'sess-b' });
    expect(appended.op === 'append' && appended.entries.map((e) => e.kind === 'user' || e.kind === 'assistant' ? e.text : '')).toEqual([
      'Run the specs again',
      'All green.',
    ]);
    expect(t.chat('tab-2').every((e) => e.sessionId === 'sess-a')).toBe(true);
    // The next poll continues from the newest entry.
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.calls.filter((c) => c.at(-1) === 'sess-b').at(-1)).toContain('--after=g1.4.r0');
  });

  it('VIEW-1.4: one poll per Session however many tabs view it; a tab that joins gets the entries at once', async () => {
    const t = setup();
    t.viewer.watch('tab-1', 'sess-b', false);
    await vi.advanceTimersByTimeAsync(0);
    const before = t.calls.length;
    t.viewer.watch('tab-2', 'sess-b', true);
    expect(t.calls.length).toBe(before); // no Fleet call for the joiner
    expect(t.chat('tab-2')[0]).toMatchObject({ op: 'reset', sessionId: 'sess-b' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.calls.length - before).toBe(3); // one per second, not one per tab
    // Toggling the drawer doesn't resend the chat.
    t.viewer.watch('tab-2', 'sess-b', false);
    expect(t.chat('tab-2')).toHaveLength(1);
  });

  it('VIEW-1.4: single-flight: the next call starts a second after the last one ended, never overlapping', async () => {
    const t = setup();
    t.setDelay(2500);
    t.viewer.watch('tab-1', 'sess-b', false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.maxInFlight()).toBe(1);
    expect(t.calls).toHaveLength(3); // 0–2.5 s, 3.5–6 s, 7–9.5 s
  });

  it('VIEW-1.4: stops following once no tab views the Session', async () => {
    const t = setup();
    t.viewer.watch('tab-1', 'sess-b', false);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.viewer.following()).toEqual(['sess-b']);
    t.viewer.watch('tab-1', 'sess-a', false); // switched
    await vi.advanceTimersByTimeAsync(0);
    expect(t.viewer.following()).toEqual(['sess-a']);
    t.viewer.drop('tab-1'); // tab closed
    const n = t.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.calls.length).toBe(n);
    expect(t.viewer.following()).toEqual([]);
    t.viewer.watch('tab-2', null, false);
    expect(t.viewer.following()).toEqual([]);
  });

  it('VIEW-1.4: on `cursor_invalid` (Transcript rewritten) reloads without a cursor and replaces what the tab has', async () => {
    const t = setup();
    t.viewer.watch('tab-1', 'sess-b', false);
    await vi.advanceTimersByTimeAsync(0);
    const tr = t.transcripts.get('sess-b')!;
    tr.generation = 2;
    tr.entries = [user(0, 'compacted summary')];
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    const last = t.chat('tab-1').at(-1)!;
    expect(last).toMatchObject({ op: 'reset', before: null });
    expect(last.op === 'reset' && last.entries.map((e) => e.cursor)).toEqual(['g2.0']);
    expect(t.calls.at(-1)).toEqual(['--local', 'messages', '--json', '--limit', '100', '--', 'sess-b']);
  });

  it('VIEW-1.4: a burst larger than one poll is read on at once until Fleet has no more', async () => {
    const t = setup();
    t.viewer.watch('tab-1', 'sess-b', false);
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 3; i < 1203; i++) t.transcripts.get('sess-b')!.add(reply(i));
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    const appended = t.chat('tab-1').filter((e) => e.op === 'append');
    expect(appended.map((e) => e.op === 'append' && e.entries.length)).toEqual([500, 500, 200]);
  });

  it('VIEW-1.8: no Transcript is a `missing` problem, checked every 5 s; once found the chat loads', async () => {
    const t = setup();
    const missing = t.transcripts.get('sess-b')!;
    t.transcripts.delete('sess-b');
    t.viewer.watch('tab-1', 'sess-b', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.chat('tab-1')).toEqual([
      { to: 'tab-1', type: 'chat', sessionId: 'sess-b', op: 'problem', problem: { kind: 'missing', message: 'no transcript found for sess-b' } },
    ]);
    await vi.advanceTimersByTimeAsync(4000);
    expect(t.calls).toHaveLength(1);
    t.transcripts.set('sess-b', missing);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.chat('tab-1').slice(1).map((e) => e.op)).toEqual(['reset', 'problem']);
    expect(t.chat('tab-1').at(-1)).toMatchObject({ problem: null });
  });

  it('a failing read keeps the entries, says why (bounded, redacted), and retries', async () => {
    const t = setup();
    t.viewer.watch('tab-1', 'sess-b', false);
    await vi.advanceTimersByTimeAsync(0);
    t.setOverride(() => failure('io', 'read /Users/me/.claude/x.jsonl failed: token=abcd1234secret\nmore'));
    await vi.advanceTimersByTimeAsync(1000);
    const problem = t.chat('tab-1').at(-1)!;
    expect(problem).toMatchObject({ op: 'problem', problem: { kind: 'failed' } });
    const message = problem.op === 'problem' ? problem.problem!.message : '';
    expect(message).toContain('read /Users/me/.claude/x.jsonl failed');
    expect(message).not.toContain('abcd1234secret');
    expect(message).not.toContain('more');
    t.setOverride(null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.chat('tab-1').at(-1)).toMatchObject({ op: 'problem', problem: null });
    expect(t.chat('tab-1').filter((e) => e.op === 'reset')).toHaveLength(1); // entries were kept, not reloaded
  });

  it('refuses an answer about another Session (a fuzzy target match)', async () => {
    const t = setup();
    t.setOverride((args) => (args.includes('--limit') ? ok('someone-else', 'claude', [user(0)], {}, 'g1.0') : undefined));
    t.viewer.watch('tab-1', 'sess-a', false);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.chat('tab-1')).toEqual([
      { to: 'tab-1', type: 'chat', sessionId: 'sess-a', op: 'problem', problem: { kind: 'failed', message: 'Fleet answered for another Session.' } },
    ]);
  });

  it('VIEW-5.3: once the Session ends, Fleet is not asked again and nothing is cleared', async () => {
    const t = setup();
    t.viewer.watch('tab-1', 'sess-b', false);
    await vi.advanceTimersByTimeAsync(0);
    t.rows.delete('sess-b');
    const n = t.calls.length;
    const events = t.chat('tab-1').length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.calls.length).toBe(n);
    expect(t.chat('tab-1')).toHaveLength(events);
  });

  it('VIEW-5.2: the chat of a Session that is not Controllable is followed too (reading controls nothing)', async () => {
    const t = setup();
    t.viewer.watch('tab-1', 'orca', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.chat('tab-1')[0]).toMatchObject({ op: 'reset', sessionId: 'orca' });
  });

  it('a pid target is checked against a fresh `fleet list` first; a pid that is gone is not read', async () => {
    const t = setup({ fresh: async () => ({ kind: 'ok', rows: [] }) });
    t.viewer.watch('tab-1', 'codex:77', false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.calls).toEqual([]);

    const listed = setup({
      fresh: async () => ({
        kind: 'ok',
        rows: [{ pid: 77, harness: 'codex', session_id: null, cwd: null, status: 'idle', waiting_for: null, updated_at: null, backend: 'tmux', display_title: 'x', context: null, model: null }],
      }),
    });
    listed.viewer.watch('tab-1', 'codex:77', false);
    await vi.advanceTimersByTimeAsync(0);
    expect(listed.calls[0]!.at(-1)).toBe('77');
    expect(listed.chat('tab-1')[0]).toMatchObject({ op: 'reset' });
  });
});

describe('changes, the queue, and quiet polling', () => {
  it('VIEW-1.9: a question answered later is pushed as an `updated` entry and replaced by cursor, for joiners too', async () => {
    const t = setup();
    const tr = t.transcripts.get('sess-b')!;
    tr.add({ cursor: 'x', role: 'assistant', kind: 'question', id: 'toolu_1', text: 'q', ts: null, status: 'pending', answer: null, questions: [{ question: 'Which?', header: '', multiSelect: false, options: [{ label: 'A', description: '' }, { label: 'B', description: '' }] }] });
    t.viewer.watch('tab-1', 'sess-b', false);
    await vi.advanceTimersByTimeAsync(0);
    tr.change(3, { status: 'answered', answer: { answers: ['B'], picked: [[1]] } });
    tr.add(reply(4, 'Going with B.'));
    await vi.advanceTimersByTimeAsync(1000);
    const append = t.chat('tab-1').at(-1)!;
    expect(append).toMatchObject({ op: 'append', entries: [{ cursor: 'g1.4', text: 'Going with B.' }] });
    expect(append.op === 'append' && append.updated).toEqual([
      expect.objectContaining({ cursor: 'g1.3', kind: 'question', status: 'answered', answer: { answers: ['B'], picked: [[1]] } }),
    ]);
    // Nothing changed since: the read hint moved on, so it isn't reported again.
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.chat('tab-1')).toHaveLength(2);
    // A tab that joins gets the answered card, not the pending one.
    t.viewer.watch('tab-2', 'sess-b', false);
    const reset = t.chat('tab-2')[0]!;
    expect(reset.op === 'reset' && reset.entries.find((e) => e.cursor === 'g1.3')).toMatchObject({ status: 'answered' });
  });

  it('VIEW-3.3: queued prompts are the queue, replaced as a whole; never history, never a cursor', async () => {
    const t = setup();
    const tr = t.transcripts.get('sess-b')!;
    t.viewer.watch('tab-1', 'sess-b', false);
    await vi.advanceTimersByTimeAsync(0);
    tr.queue = ['Also add a KWD spec'];
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.chat('tab-1').at(-1)).toMatchObject({ op: 'append', entries: [], updated: [], queue: [{ cursor: 'q1.0', text: 'Also add a KWD spec' }] });
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.chat('tab-1')).toHaveLength(2); // the same queue again: nothing pushed
    expect(t.calls.every((c) => !c.some((a) => /^--(after|before)=q/.test(a)))).toBe(true);

    // The Harness takes it: out of the queue, into the history, once.
    tr.queue = [];
    tr.add(user(3, 'Also add a KWD spec'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.chat('tab-1').at(-1)).toMatchObject({ op: 'append', entries: [{ cursor: 'g1.3', text: 'Also add a KWD spec' }], queue: [] });
    t.viewer.watch('tab-2', 'sess-b', false);
    const reset = t.chat('tab-2')[0]!;
    expect(reset.op === 'reset' && reset.entries.filter((e) => e.kind === 'user' && e.text === 'Also add a KWD spec')).toHaveLength(1);
    expect(reset.op === 'reset' && reset.queue).toEqual([]);
  });

  it('an empty Transcript (a new Session) is polled quietly: every 2 s, and one reset, not one per poll', async () => {
    const t = setup();
    t.transcripts.set('sess-b', new Transcript(0));
    t.viewer.watch('tab-1', 'sess-b', false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.calls).toHaveLength(3); // at 0, 2 and 4 s
    expect(t.chat('tab-1')).toEqual([{ to: 'tab-1', type: 'chat', sessionId: 'sess-b', op: 'reset', entries: [], before: null, queue: [] }]);
    t.transcripts.get('sess-b')!.add(user(0, 'first prompt'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.chat('tab-1').at(-1)).toMatchObject({ op: 'reset', entries: [{ text: 'first prompt' }] });
  });

  it('a pid target is checked with a fresh `fleet list` before every call; its empty conversation is polled every 2 s', async () => {
    const fresh = vi.fn(async (): Promise<FleetListResult> => ({
      kind: 'ok',
      rows: [{ pid: 77, harness: 'codex', session_id: null, cwd: null, status: 'idle', waiting_for: null, updated_at: null, backend: 'tmux', display_title: 'x', context: null, model: null }],
    }));
    const t = setup({ fresh });
    t.transcripts.set('77', new Transcript(0));
    t.viewer.watch('tab-1', 'codex:77', false);
    await vi.advanceTimersByTimeAsync(9500);
    expect(t.calls).toHaveLength(5); // 0, 2, 4, 6, 8 s
    expect(fresh).toHaveBeenCalledTimes(5); // no cached check: a pid that ended is never read
    t.transcripts.get('77')!.add(user(0, 'first prompt'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.chat('tab-1').at(-1)).toMatchObject({ op: 'reset', entries: [{ text: 'first prompt' }] });
  });

  it('switching A→B→A (or holding j/k) never runs two calls for one Session; a left Session is kept 5 s', async () => {
    const t = setup();
    t.setDelay(3000); // slow Fleet: calls are still running while you switch
    for (const id of ['sess-a', 'sess-b', 'sess-a', 'sess-b', 'sess-a']) {
      t.viewer.watch('tab-1', id, false);
      await vi.advanceTimersByTimeAsync(200);
    }
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.maxPerTarget()).toBe(1);
    expect(t.cancelled()).toBeGreaterThanOrEqual(4); // each switch away cancelled the call in flight
    expect(t.viewer.following()).toEqual(['sess-a']);
    t.viewer.watch('tab-1', null, false);
    await vi.advanceTimersByTimeAsync(10_000);
    const n = t.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.calls.length).toBe(n); // dropped after the grace period
  });

  it('a Session viewed again within 5 s gets its entries at once, without a new first load', async () => {
    const t = setup();
    t.viewer.watch('tab-1', 'sess-b', false);
    await vi.advanceTimersByTimeAsync(0);
    t.viewer.watch('tab-1', 'sess-a', false);
    await vi.advanceTimersByTimeAsync(1000);
    t.viewer.watch('tab-1', 'sess-b', false);
    expect(t.chat('tab-1').filter((e) => e.sessionId === 'sess-b' && e.op === 'reset')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls.filter((c) => c.at(-1) === 'sess-b' && !c.some((a) => a.startsWith('--after')))).toHaveLength(1);
  });
});

describe('"Show earlier"', () => {
  it('VIEW-1.6: a page answered with `cursor_invalid` resets the tabs even when the latest entries look the same', async () => {
    const t = setup();
    t.viewer.watch('tab-1', 'sess-b', false);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.chat('tab-1').filter((e) => e.op === 'reset')).toHaveLength(1);
    t.setOverride((args) => (args.some((x) => x.startsWith('--before=')) ? failure('cursor_invalid', 'cursor g1.1 not found') : undefined));
    await expect(t.viewer.earlier('sess-b', 'g1.1')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('reloading') });
    await settle();
    expect(t.chat('tab-1').filter((e) => e.op === 'reset')).toHaveLength(2);
  });

  it('VIEW-1.6: a page Fleet answers for another Session is refused, as polls are', async () => {
    const t = setup();
    t.setOverride((args) => (args.some((x) => x.startsWith('--before=')) ? ok('someone-else', 'claude', [user(0)], {}, null) : undefined));
    await expect(t.viewer.earlier('sess-a', 'g1.50')).rejects.toMatchObject({ status: 502, message: expect.stringContaining('another Session') });
  });

  it('VIEW-1.6: a pid that is gone says so without "nothing was sent"', async () => {
    const t = setup({ fresh: async () => ({ kind: 'ok', rows: [] }) });
    await expect(t.viewer.earlier('codex:77', 'g1.0')).rejects.toMatchObject({ status: 404, message: expect.not.stringContaining('sent') });
  });

  it('VIEW-1.6: loads the page before a cursor, and says when the start is reached', async () => {
    const t = setup();
    const page = await t.viewer.earlier('sess-a', 'g1.50');
    expect(t.calls[0]).toEqual(['--local', 'messages', '--json', '--before=g1.50', '--limit', '100', '--', 'sess-a']);
    expect(page.entries.map((e) => e.cursor)).toEqual(Array.from({ length: 50 }, (_, i) => `g1.${i}`));
    expect(page.before).toBeNull();
    const middle = await t.viewer.earlier('sess-a', 'g1.120');
    expect(middle.before).toBe('g1.20');
  });

  it('VIEW-1.6: refuses a bad cursor or a Session that is not running; nothing runs', async () => {
    const t = setup();
    for (const bad of [null, '', 'x'.repeat(513), 'c1\n--json', 42, '-c1', 'c1 2', 'cü', 'q1.0']) {
      await expect(t.viewer.earlier('sess-a', bad)).rejects.toMatchObject({ status: 400 });
    }
    await expect(t.viewer.earlier('gone', 'g1.3')).rejects.toMatchObject({ status: 404 });
    expect(t.calls).toEqual([]);
  });

  it('VIEW-1.6: a cursor from before a rewrite answers 409 and reloads the chat', async () => {
    const t = setup();
    t.viewer.watch('tab-1', 'sess-b', false);
    await vi.advanceTimersByTimeAsync(0);
    t.transcripts.get('sess-b')!.generation = 2;
    await expect(t.viewer.earlier('sess-b', 'g1.1')).rejects.toBeInstanceOf(ViewError);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.chat('tab-1').at(-1)).toMatchObject({ op: 'reset' });
  });

  it('VIEW-1.8: a page from a Transcript that is gone says so', async () => {
    const t = setup();
    t.transcripts.delete('sess-b');
    await expect(t.viewer.earlier('sess-b', 'g1.1')).rejects.toMatchObject({ status: 404, message: 'no transcript found for sess-b' });
  });
});
