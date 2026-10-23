import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerRequest, ScreenPrompt, ServerEvent, SessionRow } from '../shared/types.ts';
import { AnswerError, AnswerLedger, PromptWatch, STOP_SETTLE_MS, answerPrompt, listPrompt, parseAnswerRequest, parseScreenPrompt, sameProcess, stopSession } from './answerer.ts';
import { type RunOptions, run } from './exec.ts';
import { type FleetRow, fetchFleetList } from './fleet.ts';
import { MONITOR_INTERVAL_MS } from './monitor.ts';
import { normalizeRows } from './normalize.ts';

/**
 * VIEW-4 against the fake `fleet` (`answer --json` and `keys --json`, the Fleet fork's contract):
 * real processes, synthetic Sessions only. Nothing is ever typed into a real terminal.
 */
const FAKE_FLEET = new URL('./fixtures/fleet/messages/fake-fleet.mjs', import.meta.url).pathname;
const FLEET_FIXTURES = new URL('./fixtures/fleet/messages/', import.meta.url).pathname;

const CLAUDE = 'aaaaaaaa-0000-4000-8000-000000000101'; // tmux, Needs you on question toolu_13
const CODEX = 'bbbbbbbb-0000-4000-8000-000000000102'; // tmux, idle
const VIEW_ONLY = 'cccccccc-0000-4000-8000-000000000103'; // backend unknown, busy
const IDLE = 'dddddddd-0000-4000-8000-000000000104'; // tmux, idle
const NO_ID = 'claude:61005'; // tmux, no session id yet

const PERMISSION = {
  kind: 'permission',
  id: 'p2.0badc0de',
  title: 'Do you want to proceed?',
  detail: ['Bash command', '', '  bundle exec rspec spec/models/deal_spec.rb', '  Run the deal specs'],
  choices: [
    { n: 1, label: 'Yes' },
    { n: 2, label: 'Yes, and don’t ask again for bundle exec rspec commands in /Users/me/Projects/work' },
    { n: 3, label: 'No, and tell Claude what to do differently (esc)' },
  ],
  selected: 1,
  untouched: true,
};

let dir: string;
let env: NodeJS.ProcessEnv;
let fleetLog: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lookout-answer-'));
  mkdirSync(join(dir, 'fleet'));
  cpSync(FLEET_FIXTURES, join(dir, 'fleet'), { recursive: true });
  fleetLog = join(dir, 'fleet.log');
  env = { PATH: process.env.PATH, FAKE_FLEET_DIR: join(dir, 'fleet'), FAKE_FLEET_LOG: fleetLog };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const runner = (f: string, a: readonly string[], o: RunOptions) => run(f, a, { ...o, env: { ...o.env, ...env } });
const list = () => fetchFleetList(runner, FAKE_FLEET);
const rows = async (): Promise<SessionRow[]> => {
  const l = await list();
  if (l.kind !== 'ok') throw new Error('list');
  return normalizeRows(l.rows, { git: () => null, statusSince: () => null });
};
const fleetCalls = (): string[][] => {
  try {
    return readFileSync(fleetLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]);
  } catch {
    return [];
  }
};
const typed = () => fleetCalls().filter((c) => (c.includes('answer') && !c.includes('--list')) || c.includes('keys'));
const editRow = (match: (r: FleetRow) => boolean, patch: Record<string, unknown>) => {
  const file = join(dir, 'fleet', 'list.json');
  const all = JSON.parse(readFileSync(file, 'utf8')) as FleetRow[];
  writeFileSync(file, JSON.stringify(all.map((r) => (match(r) ? { ...r, ...patch } : r))));
};
const bySession = (id: string) => (r: FleetRow) => r.session_id === id;

/** A ledger whose epoch starts at 41, so the first answer's is 42; `answered` hears each answer that typed, or may have. */
function ledgerAt41() {
  const ledger = new AnswerLedger({ now: () => 41 });
  const answered = vi.fn();
  const end = ledger.endAnswer.bind(ledger);
  ledger.endAnswer = (row, key, outcome) => {
    if (outcome !== 'none') answered(outcome);
    return end(row, key, outcome);
  };
  return { ledger, answered };
}

async function setup() {
  const known = await rows();
  const { ledger, answered } = ledgerAt41();
  /** VIEW-4.8: what the server logged about refused answers. */
  const logged: string[] = [];
  const opts = {
    runner,
    fleetBin: () => FAKE_FLEET,
    lookup: (id: string) => known.find((r) => r.id === id) ?? null,
    freshList: list,
    ledger,
    env,
    log: (line: string) => void logged.push(line),
  };
  return {
    opts,
    ledger,
    answered,
    known,
    logged,
    answer: (id: string, req: AnswerRequest) => answerPrompt(opts, id, req),
    stop: (id: string) => stopSession(opts, id),
  };
}

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof AnswerError) return { status: err.status, message: err.message };
    throw err;
  }
  throw new Error('expected a refusal');
};

describe('reading the prompt on screen (VIEW-4.2)', () => {
  it('VIEW-4.2: `fleet answer id:<session_id> --list --json` reads a permission prompt off the terminal, choices in its wording', async () => {
    editRow(bySession(CODEX), { status: 'waiting', fake_prompt: PERMISSION });
    const t = await setup();
    const row = t.known.find((r) => r.id === CODEX)!;
    expect(await listPrompt(t.opts, row)).toEqual({
      ok: true,
      prompt: {
        kind: 'permission',
        id: 'p2.0badc0de',
        title: 'Do you want to proceed?',
        detail: PERMISSION.detail,
        choices: PERMISSION.choices,
        untouched: true,
      },
      answerable: true,
      detail: null,
      pane: { cols: 200, rows: 50 },
    });
    expect(fleetCalls().filter((c) => c.includes('answer'))).toEqual([['--local', 'answer', `id:${CODEX}`, '--list', '--json']]);
  });

  it('VIEW-4.2: a question form is reported by id only (its options come from the chat); nothing on screen is null', async () => {
    const t = await setup();
    expect(await listPrompt(t.opts, t.known.find((r) => r.id === CLAUDE)!)).toEqual({
      ok: true,
      prompt: { kind: 'question', id: 'toolu_13', untouched: true },
      answerable: true,
      detail: null,
      pane: { cols: 200, rows: 50 },
    });
    expect(await listPrompt(t.opts, t.known.find((r) => r.id === IDLE)!)).toEqual({ ok: true, prompt: null, answerable: false, detail: 'no_form', pane: { cols: 200, rows: 50 } });
    // A Session without a session id is read by its exact pid.
    await listPrompt(t.opts, t.known.find((r) => r.id === NO_ID)!);
    expect(fleetCalls().at(-1)).toEqual(['--local', 'answer', 'pid:61005', '--list', '--json']);
  });

  it('VIEW-4.3: a prompt Fleet can’t read whole, or whose id or choices don’t check out, gets no buttons; a moved cursor is touched', () => {
    expect(parseScreenPrompt({ kind: 'permission', incomplete: true, reason: 'its top is out of reach' })).toEqual({ kind: 'incomplete' });
    expect(parseScreenPrompt({ ...PERMISSION, id: '--json' })).toEqual({ kind: 'incomplete' });
    expect(parseScreenPrompt({ ...PERMISSION, id: undefined })).toEqual({ kind: 'incomplete' });
    expect(parseScreenPrompt({ ...PERMISSION, choices: [] })).toEqual({ kind: 'incomplete' });
    expect(parseScreenPrompt({ ...PERMISSION, choices: [{ n: 1, label: 'Yes' }, { n: 1, label: 'No' }] })).toEqual({ kind: 'incomplete' });
    expect(parseScreenPrompt({ ...PERMISSION, choices: [{ n: 0, label: 'Yes' }] })).toEqual({ kind: 'incomplete' });
    expect(parseScreenPrompt({ ...PERMISSION, choices: [{ n: 1, label: '' }] })).toEqual({ kind: 'incomplete' });
    expect(parseScreenPrompt({ ...PERMISSION, selected: 2, untouched: false })).toMatchObject({ kind: 'permission', untouched: false });
    expect(parseScreenPrompt({ ...PERMISSION, selected: 2 })).toMatchObject({ untouched: false });
    expect(parseScreenPrompt({ kind: 'question', id: null, questions: null, active: null, untouched: false })).toEqual({ kind: 'question', id: null, untouched: false });
    for (const v of [null, 'x', [], { kind: 'trust' }]) expect(parseScreenPrompt(v)).toBeNull();
  });

  it('VIEW-4.2: the wording is bounded: control characters out, long lines and long details cut', () => {
    const p = parseScreenPrompt({
      ...PERMISSION,
      title: 'Do you\u0007 want to proceed?\nsecond line',
      detail: [...Array.from({ length: 70 }, (_, i) => `line ${i}`), 'x'.repeat(900)],
      choices: [{ n: 1, label: `Yes${'!'.repeat(400)}` }],
    }) as Extract<ScreenPrompt, { kind: 'permission' }>;
    expect(p.title).toBe('Do you want to proceed?');
    expect(p.detail).toHaveLength(61);
    expect(p.detail.at(-1)).toBe('…');
    expect(p.choices[0]!.label).toHaveLength(300);
  });

  it('VIEW-4.2: an answer for another Session or Harness, malformed output, or a failing Fleet, shows nothing, and isn’t taken as a screen without a prompt', async () => {
    const t = await setup();
    const row = t.known.find((r) => r.id === CLAUDE)!;
    const answering = (stdout: string) => ({ ...t.opts, runner: vi.fn(async () => stdout) });
    expect(await listPrompt(answering(JSON.stringify({ ok: true, session_id: CODEX, harness: 'claude', prompt: PERMISSION })), row)).toEqual({ ok: false });
    expect(await listPrompt(answering(JSON.stringify({ ok: true, session_id: CLAUDE, harness: 'codex', prompt: PERMISSION })), row)).toEqual({ ok: false });
    for (const prompt of [undefined, 'x', [], { id: 'p2.0badc0de' }]) {
      expect(await listPrompt(answering(JSON.stringify({ ok: true, session_id: CLAUDE, harness: 'claude', prompt })), row)).toEqual({ ok: false });
    }
    expect(await listPrompt(answering('not json'), row)).toEqual({ ok: false });
    const failing = { ...t.opts, runner: vi.fn(async () => Promise.reject(Object.assign(new Error('exit 2'), { code: 2, stderr: "error: unrecognized subcommand 'answer'" }))) };
    expect(await listPrompt(failing, row)).toEqual({ ok: false });
    // Another kind of prompt Fleet reports is a read: the screen shows something Lookout doesn't answer.
    expect(await listPrompt(answering(JSON.stringify({ ok: true, session_id: CLAUDE, harness: 'claude', prompt: { kind: 'trust' }, answerable: false, detail: null })), row)).toEqual({
      ok: true,
      prompt: null,
      answerable: false,
      detail: null,
      pane: null,
    });
  });

  it('VIEW-4.6: beside the prompt, whether Fleet could answer it now, why not, and the terminal’s size; a form cut off by a small pane has no id', async () => {
    const CUT = { kind: 'question', incomplete: true, id: null, questions: null, active: null, untouched: false };
    editRow(bySession(CLAUDE), { fake_prompt: CUT, fake_pane: { cols: 80, rows: 24 } });
    const t = await setup();
    const row = t.known.find((r) => r.id === CLAUDE)!;
    expect(await listPrompt(t.opts, row)).toEqual({
      ok: true,
      prompt: { kind: 'question', id: null, untouched: false },
      answerable: false,
      detail: 'clipped',
      pane: { cols: 80, rows: 24 },
    });
    // Only Fleet's `true` is answerable; a code Lookout doesn't know, or a size that isn't one, is nothing.
    const answering = (extra: Record<string, unknown>) => ({
      ...t.opts,
      runner: vi.fn(async () => JSON.stringify({ ok: true, session_id: CLAUDE, harness: 'claude', prompt: { kind: 'question', id: 'toolu_13', untouched: true }, answerable: false, ...extra })),
    });
    for (const answerable of ['true', 1, null]) expect(await listPrompt(answering({ answerable }), row)).toEqual(expect.objectContaining({ ok: true, answerable: false }));
    for (const answerable of ['true', 1, null]) expect(await listPrompt(answering({ answerable }), row)).not.toHaveProperty('oldFleet');
    expect(await listPrompt(answering({ detail: 'the form says: Push?' }), row)).toMatchObject({ detail: null });
    expect(await listPrompt(answering({ detail: 'layout_unsupported' }), row)).toMatchObject({ detail: 'layout_unsupported' });
    for (const pane of [{ cols: 0, rows: 24 }, { cols: 80.5, rows: 24 }, { cols: 80, rows: 10_001 }, { cols: '80', rows: 24 }, [80, 24], 'x'])
      expect(await listPrompt(answering({ pane }), row)).toMatchObject({ pane: null });
    expect(await listPrompt(answering({ pane: { cols: 80, rows: 24, x: 1 } }), row)).toMatchObject({ pane: { cols: 80, rows: 24 } });
  });

  it('VIEW-4.6: a read without `answerable` comes from a Fleet older than the pin: its own state, never answerable, whatever else it says', async () => {
    const t = await setup();
    const row = t.known.find((r) => r.id === CLAUDE)!;
    // e0d4612, the pin before VIEW-4.6: the form, untouched, and nothing of whether it can be answered.
    const old = { ...t.opts, runner: vi.fn(async () => JSON.stringify({ ok: true, session_id: CLAUDE, harness: 'claude', prompt: { kind: 'question', id: 'toolu_13', untouched: true } })) };
    expect(await listPrompt(old, row)).toEqual({ ok: true, prompt: { kind: 'question', id: 'toolu_13', untouched: true }, answerable: false, detail: null, pane: null, oldFleet: true });
  });
});

describe('following the prompt (VIEW-4.2)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  const baseRow = (id: string, over: Partial<SessionRow> = {}): SessionRow => ({
    id, pid: 4242, harness: 'claude', title: id, status: 'needs-you', waitingFor: null, statusSince: 0, contextPct: null, cwd: '/x', git: null, locationShown: { repo: true, where: false },
    backend: 'tmux', controllable: true, ownHost: true, model: null, effort: null, subagents: null, activity: null, backgroundShell: false, procStart: null, pendingModel: null, pendingEffort: null, modelAt: null, ...over,
  });

  /** A PromptWatch over Sessions `sess-a` (and `sess-b`), with a Fleet whose reads take `delayMs`. */
  function watch(initial: Partial<SessionRow> = {}, delayMs = 0) {
    const state = {
      row: baseRow('sess-a', initial),
      other: baseRow('sess-b', { pid: 4343 }),
      prompt: PERMISSION as unknown,
      /** The next reads fail: Fleet times out, or its output is cut short. */
      fail: null as 'timeout' | 'malformed' | null,
    };
    let running = 0;
    const calls: string[] = [];
    const overlaps: string[] = [];
    const runner = vi.fn(async (_f: string, args: readonly string[]) => {
      if (!args.includes('--list')) throw new Error(`unexpected ${args.join(' ')}`);
      const id = args[2]!.slice(3);
      if (calls.filter((c) => c === `start ${id}`).length > calls.filter((c) => c === `end ${id}`).length) overlaps.push(id);
      calls.push(`start ${id}`);
      running++;
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      running--;
      calls.push(`end ${id}`);
      if (state.fail === 'timeout') throw Object.assign(new Error('timed out'), { timedOut: true });
      if (state.fail === 'malformed') return `{"ok":true,"session_id":"${id}","harness":"claude","prompt":{"kind":"perm`;
      // A Fleet from the pin, which says whether it could answer (VIEW-4.6); these reads don't need it.
      return JSON.stringify({ ok: true, session_id: id, harness: 'claude', prompt: id === 'sess-a' ? state.prompt : null, answerable: false, detail: null });
    });
    const sent: { clientId: string; event: ServerEvent }[] = [];
    const ledger = new AnswerLedger();
    const w = new PromptWatch({
      runner,
      fleetBin: () => '/bin/fleet',
      lookup: (id) => (id === state.row.id ? state.row : id === state.other.id ? state.other : null),
      sendTo: (clientId, event) => void sent.push({ clientId, event }),
      ledger,
    });
    const reads = (id: string) => calls.filter((c) => c === `start ${id}`).length;
    return { w, runner, sent, state, ledger, reads, overlaps, running: () => running };
  }
  const prompts = (sent: { event: ServerEvent }[]) => sent.map((s) => s.event as Extract<ServerEvent, { type: 'prompt' }>);

  it('VIEW-4.2: while a viewed, Controllable Session Needs you, its prompt is read every second and pushed to its tabs only when it changed', async () => {
    const t = watch();
    t.w.view('tab-1', 'sess-a');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.runner).toHaveBeenCalledTimes(1);
    expect(t.runner.mock.calls[0]![1]).toEqual(['--local', 'answer', 'id:sess-a', '--list', '--json']);
    expect(t.sent).toEqual([
      {
        clientId: 'tab-1',
        event: {
          type: 'prompt',
          sessionId: 'sess-a',
          prompt: expect.objectContaining({ id: 'p2.0badc0de' }),
          epoch: expect.any(Number),
          uncertain: null,
          since: 0,
          answerable: false,
          detail: null,
          pane: null,
          oldFleet: false,
        },
      },
    ]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(t.runner).toHaveBeenCalledTimes(2);
    expect(t.sent).toHaveLength(1); // the same prompt: nothing new

    // A second tab gets it at once, without a Fleet call.
    t.w.view('tab-2', 'sess-a');
    expect(t.sent.at(-1)).toMatchObject({ clientId: 'tab-2', event: { type: 'prompt', prompt: { id: 'p2.0badc0de' } } });
    expect(t.runner).toHaveBeenCalledTimes(2);

    // Answered in the terminal: the prompt goes, in both tabs.
    t.state.prompt = null;
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sent.slice(-2).map((s) => [s.clientId, (s.event as { prompt: unknown }).prompt])).toEqual([
      ['tab-1', null],
      ['tab-2', null],
    ]);
  });

  it('VIEW-4.2: Fleet is asked only while the Session Needs you and is Controllable, and only while some tab views it', async () => {
    const t = watch({ status: 'busy' });
    t.w.view('tab-1', 'sess-a');
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.runner).not.toHaveBeenCalled();
    expect(t.sent).toEqual([]);

    // Needs you: read, and sent even with nothing on screen, so the tab has an epoch to answer a question with.
    t.state.row = { ...t.state.row, status: 'needs-you' };
    t.state.prompt = null;
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.runner).toHaveBeenCalledTimes(1);
    expect(prompts(t.sent)).toEqual([
      { type: 'prompt', sessionId: 'sess-a', prompt: null, epoch: expect.any(Number), uncertain: null, since: 0, answerable: false, detail: null, pane: null, oldFleet: false },
    ]);
    t.state.prompt = PERMISSION;
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.runner).toHaveBeenCalledTimes(2);
    expect(t.sent).toHaveLength(2);

    // It stops Needing you: the buttons go, and Fleet isn't asked again.
    t.state.row = { ...t.state.row, status: 'busy' };
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.runner).toHaveBeenCalledTimes(2);
    expect((t.sent.at(-1)!.event as { prompt: unknown }).prompt).toBeNull();

    t.state.row = { ...t.state.row, status: 'needs-you', controllable: false, backend: 'unknown' };
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.runner).toHaveBeenCalledTimes(2);

    t.state.row = { ...t.state.row, controllable: true, backend: 'tmux' };
    t.w.drop('tab-1');
    expect(t.w.following()).toEqual([]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.runner).toHaveBeenCalledTimes(2);
  });

  it('VIEW-4.5: a read carries the Needs you spell it was made in; a new spell reaches the tabs even when the screen reads the same; none is read outside Needs you', async () => {
    const t = watch({ statusSince: 1_000 });
    t.state.prompt = null; // a panel: nothing Lookout answers
    t.w.view('tab-1', 'sess-a');
    await vi.advanceTimersByTimeAsync(0);
    expect(prompts(t.sent)).toEqual([
      { type: 'prompt', sessionId: 'sess-a', prompt: null, epoch: expect.any(Number), uncertain: null, since: 1_000, answerable: false, detail: null, pane: null, oldFleet: false },
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sent).toHaveLength(1);

    // Busy for a moment, between two polls of the read: it says nothing was read.
    t.state.row = { ...t.state.row, status: 'busy', statusSince: 2_000 };
    await vi.advanceTimersByTimeAsync(1000);
    expect(prompts(t.sent).at(-1)).toMatchObject({ prompt: null, since: null });
    // A new Needs you spell, the same screen: sent again, with its spell.
    t.state.row = { ...t.state.row, status: 'needs-you', statusSince: 3_000 };
    await vi.advanceTimersByTimeAsync(1000);
    expect(prompts(t.sent).at(-1)).toMatchObject({ prompt: null, since: 3_000 });
    expect(t.sent).toHaveLength(3);
    // A tab that starts viewing gets it, spell included.
    t.w.view('tab-2', 'sess-a');
    expect(t.sent.at(-1)).toMatchObject({ clientId: 'tab-2', event: { since: 3_000 } });
  });

  it('VIEW-4.3: after an answer to this Session, the next read reaches the tabs even when the prompt looks the same; an answer to another doesn’t', async () => {
    const t = watch();
    t.w.view('tab-1', 'sess-a');
    await vi.advanceTimersByTimeAsync(0);
    const first = prompts(t.sent)[0]!.epoch;
    const after = t.ledger.endAnswer(t.state.row, 'p:p2.0badc0de', 'typed');
    expect(after).toBeGreaterThan(first);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1]!.event).toMatchObject({ type: 'prompt', prompt: { id: 'p2.0badc0de' }, epoch: after });
    // An answer to another Session: nothing to send here.
    t.ledger.endAnswer(t.state.other, 'p:p2.feedf00d', 'typed');
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.sent).toHaveLength(2);
    // With nothing on screen, an answer here still sends the new epoch (a question is answered with it).
    t.state.prompt = null;
    await vi.advanceTimersByTimeAsync(1000);
    const count = t.sent.length;
    const later = t.ledger.endAnswer(t.state.row, 'q:toolu_13', 'typed');
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sent).toHaveLength(count + 1);
    expect(prompts(t.sent).at(-1)).toMatchObject({ prompt: null, epoch: later });
  });

  it('VIEW-4.3: after an uncertain answer, every tab hears the prompt is uncertain while it stays on screen; it clears once the screen shows something else', async () => {
    const t = watch();
    t.w.view('tab-1', 'sess-a');
    t.w.view('tab-2', 'sess-a');
    await vi.advanceTimersByTimeAsync(0);
    t.ledger.endAnswer(t.state.row, 'p:p2.0badc0de', 'uncertain');
    await vi.advanceTimersByTimeAsync(1000);
    expect(prompts(t.sent).slice(-2)).toEqual([
      expect.objectContaining({ prompt: expect.objectContaining({ id: 'p2.0badc0de' }), uncertain: 'p:p2.0badc0de' }),
      expect.objectContaining({ uncertain: 'p:p2.0badc0de' }),
    ]);
    expect(t.ledger.uncertainFor(t.state.row)).toBe('p:p2.0badc0de');
    // The prompt goes: so does the mark, and an identical prompt later is a new one.
    t.state.prompt = null;
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.ledger.uncertainFor(t.state.row)).toBeNull();
    t.state.prompt = PERMISSION;
    await vi.advanceTimersByTimeAsync(1000);
    expect(prompts(t.sent).at(-1)).toMatchObject({ prompt: { id: 'p2.0badc0de' }, uncertain: null });
  });

  it('VIEW-4.3: after an uncertain answer, a read that fails or can’t be trusted keeps the mark: the same prompt read again gets no buttons, and an answer to it is refused', async () => {
    for (const failure of ['timeout', 'malformed'] as const) {
      const t = watch();
      t.w.view('tab-1', 'sess-a');
      await vi.advanceTimersByTimeAsync(0);
      t.ledger.endAnswer(t.state.row, 'p:p2.0badc0de', 'uncertain');
      await vi.advanceTimersByTimeAsync(1000);
      expect(prompts(t.sent).at(-1), failure).toMatchObject({ prompt: { id: 'p2.0badc0de' }, uncertain: 'p:p2.0badc0de' });
      // One read fails: the tab sees no prompt, but that's no proof the prompt has gone.
      t.state.fail = failure;
      await vi.advanceTimersByTimeAsync(1000);
      expect(prompts(t.sent).at(-1), failure).toMatchObject({ prompt: null, uncertain: 'p:p2.0badc0de' });
      expect(t.ledger.uncertainFor(t.state.row), failure).toBe('p:p2.0badc0de');
      // The same prompt, untouched, read again: still no buttons.
      t.state.fail = null;
      await vi.advanceTimersByTimeAsync(1000);
      const last = prompts(t.sent).at(-1)!;
      expect(last, failure).toMatchObject({ prompt: { id: 'p2.0badc0de' }, uncertain: 'p:p2.0badc0de' });
      // A click from that read is refused, nothing typed.
      const opts = { runner: t.runner, fleetBin: () => '/bin/fleet', lookup: () => t.state.row, freshList: list, ledger: t.ledger };
      await expect(answerPrompt(opts, 'sess-a', { kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: last.epoch }), failure).rejects.toMatchObject({
        status: 409,
        message: 'It may have been answered, but Lookout can’t tell, so nothing was typed. Check the terminal.',
      });
      expect(t.runner.mock.calls.every(([, args]) => args.includes('--list')), failure).toBe(true);
      t.w.stop();
    }
  });

  it('VIEW-4.3: after an uncertain answer, a read that can’t tell which prompt is there (one Fleet can’t read whole, a form without its id) keeps the mark; one showing another prompt clears it', async () => {
    const cases = [
      { mark: 'p:p2.0badc0de', unsure: { ...PERMISSION, incomplete: true }, other: { ...PERMISSION, id: 'p2.feedf00d' } },
      { mark: 'q:toolu_13', unsure: { kind: 'question', untouched: true }, other: { kind: 'question', id: 'toolu_14', untouched: true } },
    ];
    for (const { mark, unsure, other } of cases) {
      const t = watch();
      t.w.view('tab-1', 'sess-a');
      await vi.advanceTimersByTimeAsync(0);
      t.ledger.endAnswer(t.state.row, mark, 'uncertain');
      // Read after the mark: the screen shows something Lookout can't name. It may still be that prompt.
      t.state.prompt = unsure;
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(t.ledger.uncertainFor(t.state.row), mark).toBe(mark);
      expect(prompts(t.sent).at(-1), mark).toMatchObject({ uncertain: mark });
      // A read showing another prompt: that one has gone.
      t.state.prompt = other;
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(t.ledger.uncertainFor(t.state.row), mark).toBeNull();
      t.w.stop();
    }
  });

  it('VIEW-4.3: an answer that typed nothing still sends every tab a fresh read, so a tab refused while it was typed answers from that read', async () => {
    const t = watch();
    t.w.view('tab-1', 'sess-a');
    t.w.view('tab-2', 'sess-a');
    await vi.advanceTimersByTimeAsync(0);
    const read = prompts(t.sent)[0]!.epoch;
    const refused = (f: () => void) => {
      try {
        f();
      } catch (err) {
        return err;
      }
      return null;
    };
    // Tab 1's answer is being typed; tab 2's click meanwhile is refused, nothing typed.
    t.ledger.beginAnswer(t.state.row, read, 'p:p2.0badc0de');
    expect(refused(() => t.ledger.beginAnswer(t.state.row, read, 'p:p2.0badc0de'))).toMatchObject({ status: 409, kind: 'stale', message: expect.stringMatching(/^Another tab is answering/) });
    await vi.advanceTimersByTimeAsync(1000);
    const before = t.sent.length;
    // Fleet refused tab 1's answer before typing (`busy`, say): the Session's last answer stays as it was.
    const after = t.ledger.endAnswer(t.state.row, 'p:p2.0badc0de', 'none');
    expect(after).toBeGreaterThan(read);
    expect(t.ledger.lastAnswer(t.state.row)).toBe(0);
    // The next read reaches both tabs, though the screen shows the same prompt, with an epoch newer than tab 2's click.
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sent.slice(before).map((s) => [s.clientId, (s.event as Extract<ServerEvent, { type: 'prompt' }>).epoch])).toEqual([
      ['tab-1', after],
      ['tab-2', after],
    ]);
    expect(prompts(t.sent).at(-1)).toMatchObject({ prompt: { id: 'p2.0badc0de' }, uncertain: null });
    // Nothing was typed, so a click from that read, or from the one before, may answer it.
    expect(refused(() => t.ledger.beginAnswer(t.state.row, after, 'p:p2.0badc0de'))).toBeNull();
    t.ledger.endAnswer(t.state.row, 'p:p2.0badc0de', 'none');
    expect(refused(() => t.ledger.beginAnswer(t.state.row, read, 'p:p2.0badc0de'))).toBeNull();
  });

  it('VIEW-4.3: a read that began before an answer to the Session landed isn’t sent (it may show the prompt after it with the old epoch); it’s read again at once', async () => {
    const t = watch({}, 500);
    t.w.view('tab-1', 'sess-a');
    await vi.advanceTimersByTimeAsync(500);
    const first = prompts(t.sent)[0]!.epoch;
    // The next read runs from 1.5 s to 2 s; the answer lands during it, and the next prompt shows.
    await vi.advanceTimersByTimeAsync(1100);
    expect(t.reads('sess-a')).toBe(2);
    const NEXT = { ...PERMISSION, id: 'p2.feedf00d' };
    t.state.prompt = NEXT;
    const after = t.ledger.endAnswer(t.state.row, 'p:p2.0badc0de', 'typed');
    await vi.advanceTimersByTimeAsync(450);
    // That read ended showing the next prompt: dropped, and another started at once.
    expect(t.reads('sess-a')).toBe(3);
    expect(t.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(prompts(t.sent).map((e) => [e.prompt && 'id' in e.prompt ? e.prompt.id : null, e.epoch])).toEqual([
      ['p2.0badc0de', first],
      ['p2.feedf00d', after],
    ]);
    expect(t.overlaps).toEqual([]);
  });

  it('VIEW-4.2: a slow Fleet never has two reads of one Session running: the next starts a second after the last ended', async () => {
    const t = watch({}, 2500);
    t.w.view('tab-1', 'sess-a');
    t.w.view('tab-2', 'sess-a');
    await vi.advanceTimersByTimeAsync(20_000);
    // Reads of 2.5 s, a second apart: about one every 3.5 s.
    expect(t.reads('sess-a')).toBeGreaterThanOrEqual(5);
    expect(t.reads('sess-a')).toBeLessThanOrEqual(6);
    expect(t.overlaps).toEqual([]);
  });

  it('VIEW-4.2: switching A→B→A while A’s read runs picks that read up instead of starting another; B’s reads stop', async () => {
    const t = watch({}, 2500);
    t.w.view('tab-1', 'sess-a');
    await vi.advanceTimersByTimeAsync(100); // A's first read is running
    t.w.view('tab-1', 'sess-b');
    expect(t.w.following()).toEqual(['sess-b']);
    await vi.advanceTimersByTimeAsync(100);
    t.w.view('tab-1', 'sess-a');
    expect(t.w.following()).toEqual(['sess-a']);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.overlaps).toEqual([]);
    // B was read once, when it was viewed, and never again.
    expect(t.reads('sess-b')).toBe(1);
    // A's read that ran across the switch reached the tab.
    expect(prompts(t.sent).some((e) => e.sessionId === 'sess-a' && e.prompt !== null)).toBe(true);
    // Left for good: a read still running ends, and no other starts.
    t.w.view('tab-1', null);
    const reads = t.reads('sess-a');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.reads('sess-a')).toBe(reads);
    expect(t.running()).toBe(0);
    expect(t.w.following()).toEqual([]);
  });
});

describe('answering (VIEW-4.1–4.3)', () => {
  it('VIEW-4.3: a permission prompt is answered by exact target with `--allow-attached --choice <n> --prompt <id>`, while that prompt is on screen', async () => {
    editRow(bySession(CODEX), { status: 'waiting', fake_prompt: PERMISSION });
    const t = await setup();
    expect(await t.answer(CODEX, { kind: 'permission', prompt: 'p2.0badc0de', choice: 2, epoch: 41 })).toEqual({ epoch: 42 });
    expect(typed()).toEqual([['--local', 'answer', `id:${CODEX}`, '--json', '--allow-attached', '--choice', '2', '--prompt', 'p2.0badc0de']]);
    expect(t.answered).toHaveBeenCalledOnce();
    // The fake took it as Fleet would: the prompt is gone and the Session works on.
    expect((await rows()).find((r) => r.id === CODEX)).toMatchObject({ status: 'busy' });
  });

  it('VIEW-4.9: Claude Code’s confirmation of a command from the composer, as the fork reads it, gets its choices as buttons in the terminal’s wording and is answered by its number', async () => {
    // What the fork's `answer --list` gives for the dialog `/effort high` opens while the prompt cache is warm.
    const confirm = {
      kind: 'permission',
      id: 'p2.6a955058',
      title: 'Change effort level?',
      detail: [
        'Your next response will be slower and use more tokens',
        'This conversation is cached for the current effort level. Switching to high',
        'means the full history gets re-read on your next message.',
      ],
      choices: [
        { n: 1, label: 'Yes, switch to high' },
        { n: 2, label: 'No, go back' },
      ],
      selected: 1,
      untouched: true,
    };
    editRow(bySession(IDLE), { status: 'waiting', fake_prompt: confirm });
    const t = await setup();
    expect(await listPrompt(t.opts, t.known.find((r) => r.id === IDLE)!)).toMatchObject({
      ok: true,
      prompt: { kind: 'permission', id: 'p2.6a955058', title: 'Change effort level?', detail: confirm.detail, choices: confirm.choices, untouched: true },
      answerable: true,
    });
    expect(await t.answer(IDLE, { kind: 'permission', prompt: 'p2.6a955058', choice: 1, epoch: 41 })).toEqual({ epoch: 42 });
    expect(typed()).toEqual([['--local', 'answer', `id:${IDLE}`, '--json', '--allow-attached', '--choice', '1', '--prompt', 'p2.6a955058']]);
  });

  it('VIEW-4.3: another prompt on screen, or the same one touched in the terminal, is refused: nothing is typed and the pane says to answer in the terminal', async () => {
    editRow(bySession(CODEX), { status: 'waiting', fake_prompt: { ...PERMISSION, id: 'p2.feedf00d' } });
    let t = await setup();
    const other = await refusal(t.answer(CODEX, { kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: 41 }));
    expect(other).toEqual({ status: 409, message: 'The terminal no longer shows this prompt as it was, so nothing was typed. Answer it in the terminal.' });
    editRow(bySession(CODEX), { fake_prompt: { ...PERMISSION, selected: 2, untouched: false } });
    t = await setup();
    expect(await refusal(t.answer(CODEX, { kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: 41 }))).toEqual(other);
    editRow(bySession(CODEX), { fake_prompt: { kind: 'permission', incomplete: true, reason: 'its frame is ambiguous' }, fake_detail: 'layout_unsupported' });
    t = await setup();
    expect(await refusal(t.answer(CODEX, { kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: 41 }))).toMatchObject({
      status: 409,
      message: 'Lookout can’t read this prompt whole, so nothing was typed. Answer it in the terminal.',
    });
    expect(t.answered).not.toHaveBeenCalled();
    expect((await rows()).find((r) => r.id === CODEX)).toMatchObject({ status: 'needs-you' });
  });

  it('VIEW-4.3: a question is answered with `--question <tool_use_id> --answers <json>`, and the chat then shows the answer', async () => {
    const t = await setup();
    expect(await t.answer(CLAUDE, { kind: 'question', question: 'toolu_13', answers: [{ options: [1] }], epoch: 41 })).toEqual({ epoch: 42 });
    expect(typed()).toEqual([['--local', 'answer', `id:${CLAUDE}`, '--json', '--allow-attached', '--question', 'toolu_13', '--answers', '[{"options":[1]}]']]);
    const session = JSON.parse(readFileSync(join(dir, 'fleet', 'sessions', `${CLAUDE}.json`), 'utf8')) as { entries: { id?: string; status?: string; answer?: unknown }[] };
    expect(session.entries.find((e) => e.id === 'toolu_13')).toMatchObject({ status: 'answered', answer: { answers: ['Only push'], picked: [[1]] } });
  });

  it('VIEW-4.1: typed text goes as one trimmed line; an answer the form can’t take is refused by Fleet, nothing typed', async () => {
    let t = await setup();
    await t.answer(CLAUDE, { kind: 'question', question: 'toolu_13', answers: [{ options: [], text: 'Push, but to a fork' }], epoch: 41 });
    expect(typed()[0]).toContain('[{"options":[],"text":"Push, but to a fork"}]');
    // Fresh fixtures: one option and text for a single-select question is two answers.
    cpSync(FLEET_FIXTURES, join(dir, 'fleet'), { recursive: true });
    t = await setup();
    expect(await refusal(t.answer(CLAUDE, { kind: 'question', question: 'toolu_13', answers: [{ options: [0], text: 'and more' }], epoch: 41 }))).toEqual({
      status: 409,
      message: 'Lookout can’t type this answer safely (it could read as another option), so nothing was typed. Answer it in the terminal.',
    });
  });

  it('VIEW-4.3: an earlier, already answered question is refused, nothing typed', async () => {
    const t = await setup();
    expect(await refusal(t.answer(CLAUDE, { kind: 'question', question: 'toolu_07', answers: [{ options: [0] }], epoch: 41 }))).toEqual({
      status: 409,
      message: 'This question was already answered, so nothing was typed.',
    });
    expect(await refusal(t.answer(CLAUDE, { kind: 'question', question: 'toolu_99', answers: [{ options: [0] }], epoch: 41 }))).toMatchObject({ status: 409, message: expect.stringMatching(/can’t find this question/) });
  });

  it('VIEW-4.3: each refusal Fleet makes before typing is said in plain words, by kind; nothing names tmux', async () => {
    const cases: [string, RegExp][] = [
      ['busy', /^Fleet is typing into this Session right now, so nothing was typed\. Answer it in the terminal\.$/],
      ['prompt_not_on_screen', /no longer shows this prompt.*nothing was typed/],
      ['prompt_incomplete', /can’t read this prompt whole.*nothing was typed/],
      ['question_not_active', /isn’t the one waiting any more.*nothing was typed/],
      ['answer_invalid', /can’t type this answer safely.*nothing was typed/],
      ['choice_invalid', /isn’t on the prompt any more.*nothing was typed/],
      ['not_waiting', /isn’t waiting on this question any more.*nothing was typed/],
      ['human_attached', /attached to this Session’s terminal.*nothing was typed/],
      ['target_not_found', /^This Session is no longer running, so nothing was typed\.$/],
      ['target_ambiguous', /couldn’t tell which Session.*nothing was typed/],
      ['backend_unsupported', /can’t reach this Session’s terminal.*nothing was typed/],
      ['transcript_not_found', /can’t find this Session’s Transcript.*nothing was typed/],
    ];
    for (const [kind, message] of cases) {
      editRow(bySession(CODEX), { status: 'waiting', fake_prompt: PERMISSION, fake_answer: kind });
      const t = await setup();
      const got = await refusal(t.answer(CODEX, { kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: 41 }));
      expect(got.status, kind).toBe(409);
      expect(got.message, kind).toMatch(message);
      expect(got.message).not.toMatch(/tmux/i);
      // Nothing was typed: the buttons the tab read stay valid.
      expect(t.answered, kind).not.toHaveBeenCalled();
    }
  });

  it('VIEW-4.3: when keys went out but the outcome isn’t certain, it says it may have been answered and to check the terminal', async () => {
    const cases: [string, string][] = [
      ['outcome_uncertain', 'It may have been answered, but Lookout can’t tell. Check the terminal.'],
      ['prompt_changed', 'The prompt changed while Lookout was answering, so it stopped part-way. Check the terminal and finish there.'],
      ['send_failed', 'Typing failed part-way. Check the terminal and finish there.'],
    ];
    for (const [kind, message] of cases) {
      editRow(bySession(CODEX), { status: 'waiting', fake_prompt: PERMISSION, fake_answer: kind });
      const t = await setup();
      expect(await refusal(t.answer(CODEX, { kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: 41 })), kind).toEqual({ status: 502, message });
      // Keys may have landed: what the tabs read before is stale.
      expect(t.answered, kind).toHaveBeenCalledOnce();
    }
    // `outcome_uncertain` carries what's on screen now, as the contract has it.
    editRow(bySession(CODEX), { fake_answer: 'outcome_uncertain' });
    const raw = await run(FAKE_FLEET, ['--local', 'answer', `id:${CODEX}`, '--json', '--choice', '1'], { timeoutMs: 5000, env }).catch((e: { stdout: string }) => e.stdout);
    expect(JSON.parse(raw)).toMatchObject({ ok: false, kind: 'outcome_uncertain', screen: { id: 'p2.0badc0de' }, prompt_kind: 'permission', steps: [] });
  });

  it('VIEW-4.3: `--allow-attached` is always passed: a terminal someone is attached to is still answered, Fleet still checks the prompt', async () => {
    editRow(bySession(CODEX), { status: 'waiting', fake_prompt: PERMISSION, fake_attached: true });
    const t = await setup();
    await t.answer(CODEX, { kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: 41 });
    expect(typed()[0]).toContain('--allow-attached');
    // Without it, the fake refuses as Fleet does.
    editRow(bySession(CODEX), { status: 'waiting', fake_prompt: PERMISSION });
    const raw = await run(FAKE_FLEET, ['--local', 'answer', `id:${CODEX}`, '--json', '--choice', '1', '--prompt', 'p2.0badc0de'], { timeoutMs: 5000, env }).catch((e: { stdout: string }) => e.stdout);
    expect(JSON.parse(raw)).toMatchObject({ ok: false, kind: 'human_attached' });
  });

  it('VIEW-4.3: a pid target is checked against a fresh list right before typing; a pid that is gone gets nothing', async () => {
    editRow((r) => r.pid === 61005, { status: 'waiting', fake_prompt: PERMISSION });
    let t = await setup();
    await t.answer(NO_ID, { kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: 41 });
    expect(typed()).toEqual([['--local', 'answer', 'pid:61005', '--json', '--allow-attached', '--choice', '1', '--prompt', 'p2.0badc0de']]);
    // It exits after Lookout's last poll: the fresh list no longer has it.
    editRow((r) => r.pid === 61005, { status: 'waiting', fake_prompt: PERMISSION });
    t = await setup();
    const file = join(dir, 'fleet', 'list.json');
    writeFileSync(file, JSON.stringify((JSON.parse(readFileSync(file, 'utf8')) as FleetRow[]).filter((r) => r.pid !== 61005)));
    expect(await refusal(t.answer(NO_ID, { kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: 41 }))).toEqual({
      status: 409,
      message: 'This Session is no longer running, so nothing was typed.',
    });
    expect(typed()).toHaveLength(1);
  });

  it('VIEW-4.1: Codex questions, Sessions in another app and Sessions not running are refused before Fleet is asked', async () => {
    const t = await setup();
    expect(await refusal(t.answer(CODEX, { kind: 'question', question: 'call_01', answers: [{ options: [0] }], epoch: 41 }))).toMatchObject({
      status: 409,
      message: expect.stringMatching(/only answer Claude Code’s questions/),
    });
    expect(await refusal(t.answer(VIEW_ONLY, { kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: 41 }))).toMatchObject({ status: 409, message: expect.stringMatching(/another app/) });
    expect(await refusal(t.answer('nope', { kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: 41 }))).toMatchObject({ status: 404 });
    expect(typed()).toEqual([]);
  });

  it('VIEW-4.3: a Fleet without `answer`, a missing Fleet, or another failure says so on one line, redacted, without naming tmux', async () => {
    const t = await setup();
    const failing = (stdout: string, stderr: string, extra: Record<string, unknown> = {}) => ({
      ...t.opts,
      // Each its own: a failure that may have typed makes the next answer from the same read stale.
      ledger: ledgerAt41().ledger,
      runner: vi.fn(async () => Promise.reject(Object.assign(new Error('exit 1'), { code: 1, stdout, stderr, ...extra }))),
    });
    const req: AnswerRequest = { kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: 41 };
    expect(await refusal(answerPrompt(failing('', "error: unrecognized subcommand 'answer'"), CODEX, req))).toEqual({
      status: 501,
      message: 'This Fleet can’t answer prompts yet. Update the Fleet fork.',
    });
    expect(await refusal(answerPrompt(failing('', '', { code: 'ENOENT' }), CODEX, req))).toMatchObject({ status: 503 });
    expect(await refusal(answerPrompt(failing('{"ok":false,"kind":"io","error":"tmux capture-pane failed"}', ''), CODEX, req))).toEqual({
      status: 502,
      message: 'Couldn’t answer: the Session host refused. Check the terminal.',
    });
    expect(await refusal(answerPrompt(failing('{"ok":false,"kind":"io","error":"token=abc123 refused"}', ''), CODEX, req))).toEqual({
      status: 502,
      message: 'Couldn’t answer: token=… refused. Check the terminal.',
    });
    expect(await refusal(answerPrompt(failing('', '', { timedOut: true, code: null }), CODEX, req))).toMatchObject({ status: 504, message: expect.stringMatching(/may have been answered/) });
  });

  it('VIEW-4.3: the request is checked before argv is built', () => {
    expect(parseAnswerRequest({ kind: 'permission', prompt: 'p2.0badc0de', choice: 3, epoch: 41 })).toEqual({ kind: 'permission', prompt: 'p2.0badc0de', choice: 3, epoch: 41 });
    expect(parseAnswerRequest({ kind: 'question', question: 'toolu_13', answers: [{ options: [2, 0, 2] }, { options: [], text: '  typed  ' }], epoch: 41 })).toEqual({
      kind: 'question',
      question: 'toolu_13',
      answers: [{ options: [0, 2] }, { options: [], text: 'typed' }],
      epoch: 41,
    });
    const bad: unknown[] = [
      null,
      [],
      { kind: 'trust' },
      { kind: 'permission', prompt: '--json', choice: 1, epoch: 41 },
      { kind: 'permission', prompt: 'p2.1', choice: 0, epoch: 41 },
      { kind: 'permission', prompt: 'p2.1', choice: 1.5, epoch: 41 },
      { kind: 'permission', prompt: 'p2.1', choice: '1', epoch: 41 },
      { kind: 'question', question: '-x', answers: [{ options: [0] }], epoch: 41 },
      { kind: 'question', question: 'toolu_1', answers: [], epoch: 41 },
      { kind: 'question', question: 'toolu_1', answers: Array.from({ length: 11 }, () => ({ options: [0] })), epoch: 41 },
      { kind: 'question', question: 'toolu_1', answers: [{ options: [] }], epoch: 41 },
      { kind: 'question', question: 'toolu_1', answers: [{ options: [], text: '   ' }], epoch: 41 },
      { kind: 'question', question: 'toolu_1', answers: [{ options: [-1] }], epoch: 41 },
      { kind: 'question', question: 'toolu_1', answers: [{ options: [20] }], epoch: 41 },
      { kind: 'question', question: 'toolu_1', answers: [{ options: ['0'] }], epoch: 41 },
      { kind: 'question', question: 'toolu_1', answers: [{ options: [0], text: 7 }], epoch: 41 },
    ];
    for (const b of bad) expect(() => parseAnswerRequest(b), JSON.stringify(b)).toThrow('Invalid answer.');
    expect(() => parseAnswerRequest({ kind: 'question', question: 'toolu_1', answers: [{ options: [], text: 'a\nb' }], epoch: 41 })).toThrow('can’t be typed');
    expect(() => parseAnswerRequest({ kind: 'question', question: 'toolu_1', answers: [{ options: [], text: 'a\u001b[A' }], epoch: 41 })).toThrow('can’t be typed');
    expect(() => parseAnswerRequest({ kind: 'question', question: 'toolu_1', answers: [{ options: [], text: 'x'.repeat(2001) }], epoch: 41 })).toThrow('too long');
    // The epoch of the read it answers is required.
    expect(() => parseAnswerRequest({ kind: 'permission', prompt: 'p2.0badc0de', choice: 1 })).toThrow('Invalid answer.');
    expect(() => parseAnswerRequest({ kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: -1 })).toThrow('Invalid answer.');
    expect(() => parseAnswerRequest({ kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: '41' })).toThrow('Invalid answer.');
  });
});

describe('a prompt Fleet can’t answer now (VIEW-4.6, VIEW-4.8)', () => {
  const CUT = { kind: 'question', incomplete: true, id: null, questions: null, active: null, untouched: false };
  /** Fleet's `error` for a cut-off form: free text, which may quote the screen. */
  const CUT_ERROR = "the question form's answers run off the captured screen (taller than the terminal) — answer it there; nothing typed";

  it('VIEW-4.6: a refusal for a form taller than the terminal says it doesn’t fit, with the terminal’s size, and to answer it from a terminal app, where a bigger terminal lets Lookout answer it', async () => {
    editRow(bySession(CLAUDE), { fake_prompt: CUT, fake_pane: { cols: 80, rows: 24 } });
    let t = await setup();
    expect(await refusal(t.answer(CLAUDE, { kind: 'question', question: 'toolu_13', answers: [{ options: [1] }], epoch: 41 }))).toEqual({
      status: 409,
      message:
        'This question doesn’t fit in the terminal (80×24), so nothing was typed. Open the Session in a terminal app and answer it there. A bigger terminal lets Lookout answer questions like this.',
    });
    editRow(bySession(CODEX), { status: 'waiting', fake_prompt: { kind: 'permission', incomplete: true, reason: 'its top is out of reach' }, fake_pane: null });
    t = await setup();
    expect(await refusal(t.answer(CODEX, { kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: 41 }))).toEqual({
      status: 409,
      message: 'This prompt doesn’t fit in the terminal, so nothing was typed. Open the Session in a terminal app and answer it there. A bigger terminal lets Lookout answer prompts like this.',
    });
    expect(typed().every((c) => !c.includes('--list'))).toBe(true);
    expect(t.answered).not.toHaveBeenCalled();
  });

  it('VIEW-4.8: a refused answer logs one line: what was answered, Fleet’s kind and reason code, the Session, the id and the pane’s size; never Fleet’s error, the screen or the Transcript', async () => {
    editRow(bySession(CLAUDE), { fake_prompt: CUT, fake_pane: { cols: 80, rows: 24 } });
    let t = await setup();
    await refusal(t.answer(CLAUDE, { kind: 'question', question: 'toolu_13', answers: [{ options: [1] }], epoch: 41 }));
    expect(t.logged).toEqual([`lookout: answer refused: question kind=prompt_incomplete detail=clipped session=${CLAUDE} id=toolu_13 pane=80x24`]);
    const line = t.logged[0]!;
    expect(line).not.toContain(CUT_ERROR);
    for (const words of ['captured screen', 'nothing typed', 'Push the branch', 'Next step', 'Only push']) expect(line).not.toContain(words);

    // A permission prompt someone moved the cursor on, in a Session Fleet reports outside tmux (no pane).
    editRow(bySession(CODEX), { status: 'waiting', fake_prompt: { ...PERMISSION, selected: 2, untouched: false }, fake_pane: null });
    t = await setup();
    await refusal(t.answer(CODEX, { kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: 41 }));
    expect(t.logged).toEqual([`lookout: answer refused: permission kind=prompt_not_on_screen detail=cursor_moved session=${CODEX} id=p2.0badc0de pane=none`]);
    expect(t.logged[0]).not.toContain('bundle exec rspec');

    // A refusal that isn't a screen check has no code.
    editRow(bySession(CODEX), { fake_prompt: PERMISSION, fake_answer: 'busy', fake_pane: { cols: 200, rows: 50 } });
    t = await setup();
    await refusal(t.answer(CODEX, { kind: 'permission', prompt: 'p2.0badc0de', choice: 1, epoch: 41 }));
    expect(t.logged).toEqual([`lookout: answer refused: permission kind=busy detail=none session=${CODEX} id=p2.0badc0de pane=200x50`]);
  });

  it('VIEW-4.8: values that aren’t what Fleet’s contract says are logged as `other`, and Fleet’s error still never is; an answer Fleet didn’t refuse logs nothing', async () => {
    const t = await setup();
    const failing = (stdout: string) => ({
      ...t.opts,
      runner: vi.fn(async (_f: string, args: readonly string[]) => {
        if (args.includes('--list')) return '';
        throw Object.assign(new Error('exit 1'), { code: 1, stdout, stderr: 'error: Do you want to proceed? rm -rf ~' });
      }),
    });
    const hostile = JSON.stringify({
      ok: false,
      kind: 'prompt_not_on_screen\nlookout: answer typed',
      error: 'Do you want to proceed? rm -rf ~',
      detail: 'Clipped: Push the branch?',
      pane: { cols: -1, rows: 'x' },
    });
    await refusal(answerPrompt(failing(hostile), CLAUDE, { kind: 'question', question: 'toolu_13', answers: [{ options: [1] }], epoch: 41 }));
    expect(t.logged).toEqual([`lookout: answer refused: question kind=other detail=other session=${CLAUDE} id=toolu_13 pane=other`]);
    expect(t.logged[0]).not.toContain('rm -rf');
    t.logged.length = 0;
    // No failure object (a crash, a timeout), or one without a kind: nothing to log.
    await refusal(answerPrompt(failing('not json'), CLAUDE, { kind: 'question', question: 'toolu_13', answers: [{ options: [1] }], epoch: 41 }));
    await refusal(answerPrompt(failing(JSON.stringify({ ok: false, error: 'Do you want to proceed?' })), CLAUDE, { kind: 'question', question: 'toolu_13', answers: [{ options: [1] }], epoch: 41 }));
    const timeout = { ...t.opts, runner: vi.fn(async () => Promise.reject(Object.assign(new Error('timed out'), { timedOut: true }))) };
    await refusal(answerPrompt(timeout, CLAUDE, { kind: 'question', question: 'toolu_13', answers: [{ options: [1] }], epoch: 41 }));
    expect(t.logged).toEqual([]);
    // Answered: nothing either (a fresh server: the failures above may have typed, so their epoch is spent).
    const fresh = await setup();
    await fresh.answer(CLAUDE, { kind: 'question', question: 'toolu_13', answers: [{ options: [1] }], epoch: 41 });
    expect(fresh.logged).toEqual([]);
    // A `detail` outside Fleet's fixed set is `other`, however much it looks like a code.
    const other = await setup();
    const push = JSON.stringify({ ok: false, kind: 'prompt_not_on_screen', detail: 'push', pane: null });
    await refusal(answerPrompt({ ...failing(push), ledger: other.opts.ledger, log: other.opts.log }, CLAUDE, { kind: 'question', question: 'toolu_13', answers: [{ options: [1] }], epoch: 41 }));
    expect(other.logged).toEqual([`lookout: answer refused: question kind=prompt_not_on_screen detail=other session=${CLAUDE} id=toolu_13 pane=none`]);
  });

  it('VIEW-4.8: a log that throws changes nothing: the refusal and what may have been typed are as without it', async () => {
    const t = await setup();
    const opts = {
      ...t.opts,
      log: () => {
        throw new Error('log full');
      },
    };
    // Keys may have gone out: the outcome is uncertain, so every tab's read from before is stale.
    editRow(bySession(CLAUDE), { fake_answer: 'prompt_changed', fake_detail: 'cursor_moved' });
    expect(await refusal(answerPrompt(opts, CLAUDE, { kind: 'question', question: 'toolu_13', answers: [{ options: [1] }], epoch: 41 }))).toEqual({
      status: 502,
      message: 'The prompt changed while Lookout was answering, so it stopped part-way. Check the terminal and finish there.',
    });
    expect(t.answered).toHaveBeenCalledExactlyOnceWith('uncertain');
  });

  it('VIEW-4.8: without a log of its own, the line goes to the server’s console as a warning', async () => {
    editRow(bySession(CLAUDE), { fake_prompt: CUT, fake_pane: { cols: 80, rows: 24 } });
    const t = await setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await refusal(answerPrompt({ ...t.opts, log: undefined }, CLAUDE, { kind: 'question', question: 'toolu_13', answers: [{ options: [1] }], epoch: 41 }));
      expect(warn).toHaveBeenCalledExactlyOnceWith(`lookout: answer refused: question kind=prompt_incomplete detail=clipped session=${CLAUDE} id=toolu_13 pane=80x24`);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('following whether it can be answered (VIEW-4.6)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('VIEW-4.6: the tabs get whether Fleet could answer the prompt, why not and the pane’s size, and hear when any of them changes', async () => {
    const row: SessionRow = {
      id: 'sess-a', pid: 4242, harness: 'claude', title: 'a', status: 'needs-you', waitingFor: null, statusSince: 0, contextPct: null, cwd: '/x', git: null, locationShown: { repo: true, where: false },
      backend: 'tmux', controllable: true, ownHost: true, model: null, effort: null, subagents: null, activity: null, backgroundShell: false, procStart: null, pendingModel: null, pendingEffort: null, modelAt: null,
    };
    const CUT_PROMPT = { kind: 'question', incomplete: true, id: null, questions: null, active: null, untouched: false };
    let list: Record<string, unknown> = { prompt: CUT_PROMPT, answerable: false, detail: 'clipped', pane: { cols: 80, rows: 24 }, error: 'should never travel' };
    const runner = vi.fn(async () => JSON.stringify({ ok: true, session_id: 'sess-a', harness: 'claude', ...list }));
    const sent: Extract<ServerEvent, { type: 'prompt' }>[] = [];
    const w = new PromptWatch({ runner, fleetBin: () => '/bin/fleet', lookup: () => row, sendTo: (_c, e) => void sent.push(e), ledger: new AnswerLedger() });
    w.view('tab-1', 'sess-a');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([
      {
        type: 'prompt',
        sessionId: 'sess-a',
        prompt: { kind: 'question', id: null, untouched: false },
        epoch: expect.any(Number),
        uncertain: null,
        since: 0,
        answerable: false,
        detail: 'clipped',
        pane: { cols: 80, rows: 24 },
        oldFleet: false,
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain('should never travel');
    // The window made bigger: the same Session, now the whole form, which Fleet can answer.
    list = { prompt: { kind: 'question', id: 'toolu_13', questions: [], active: 0, untouched: true }, answerable: true, detail: null, pane: { cols: 200, rows: 50 } };
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent.at(-1)).toMatchObject({ prompt: { kind: 'question', id: 'toolu_13', untouched: true }, answerable: true, detail: null, pane: { cols: 200, rows: 50 } });
    // Only the size changes: still news.
    list = { ...list, pane: { cols: 160, rows: 50 } };
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(3);
    expect(sent.at(-1)).toMatchObject({ answerable: true, pane: { cols: 160, rows: 50 } });
    // Nothing new: nothing sent.
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(3);
    // A failed read: nothing answerable, no reason, no size.
    runner.mockRejectedValue(Object.assign(new Error('timed out'), { timedOut: true }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent.at(-1)).toMatchObject({ prompt: null, answerable: false, detail: null, pane: null, oldFleet: false });
    // A Fleet older than the pin (no `answerable`): news, and said as such.
    runner.mockResolvedValue(JSON.stringify({ ok: true, session_id: 'sess-a', harness: 'claude', prompt: { kind: 'question', id: 'toolu_13', untouched: true } }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent.at(-1)).toMatchObject({ prompt: { kind: 'question', id: 'toolu_13', untouched: true }, answerable: false, detail: null, oldFleet: true });
    w.stop();
  });
});

describe('across tabs (VIEW-4.3, VIEW-4.4)', () => {
  const perm = (epoch: number, choice = 1, prompt = 'p2.0badc0de'): AnswerRequest => ({ kind: 'permission', prompt, choice, epoch });

  it('VIEW-4.3: two tabs answer the same prompt: the second, read before the first landed, is refused with nothing typed, even when an identical prompt follows', async () => {
    editRow(bySession(CODEX), { status: 'waiting', fake_prompt: PERMISSION });
    const t = await setup();
    // Both tabs read the prompt now.
    const read = t.ledger.current();
    expect(await t.answer(CODEX, perm(read, 1))).toEqual({ epoch: 42 });
    // The next prompt is the same command again: same wording, same id.
    editRow(bySession(CODEX), { status: 'waiting', fake_prompt: PERMISSION });
    await expect(t.answer(CODEX, perm(read, 2))).rejects.toMatchObject({
      status: 409,
      kind: 'stale',
      message: 'This was already answered from another tab, so nothing was typed.',
    });
    expect(typed()).toHaveLength(1);
    // A tab that read it after the answer landed answers the new one.
    expect(await t.answer(CODEX, perm(42, 2))).toEqual({ epoch: 43 });
    expect(typed().map((c) => c[6])).toEqual(['1', '2']);
  });

  it('VIEW-4.3: a stale epoch is refused for a question too, and a tab with no read yet (epoch 0) can’t answer once the Session was answered', async () => {
    const t = await setup();
    const read = t.ledger.current();
    await t.answer(CLAUDE, { kind: 'question', question: 'toolu_13', answers: [{ options: [1] }], epoch: read });
    for (const epoch of [read, 0]) {
      await expect(t.answer(CLAUDE, { kind: 'question', question: 'toolu_13', answers: [{ options: [0] }], epoch })).rejects.toMatchObject({ status: 409, kind: 'stale' });
    }
    expect(typed()).toHaveLength(1);
  });

  it('VIEW-4.3: one answer per Session at a time: a second one while the first is typed is refused, nothing typed', async () => {
    editRow(bySession(CODEX), { status: 'waiting', fake_prompt: PERMISSION });
    const t = await setup();
    const read = t.ledger.current();
    const [first, second] = await Promise.allSettled([t.answer(CODEX, perm(read, 1)), t.answer(CODEX, perm(read, 3))]);
    expect(first).toMatchObject({ status: 'fulfilled', value: { epoch: 42 } });
    expect(second).toMatchObject({ status: 'rejected', reason: { status: 409, kind: 'stale', message: 'Another tab is answering this Session right now, so nothing was typed.' } });
    expect(typed()).toHaveLength(1);
    // Two Sessions answered at once don't hold each other up.
    editRow(bySession(IDLE), { status: 'waiting', fake_prompt: PERMISSION });
    editRow(bySession(CODEX), { status: 'waiting', fake_prompt: PERMISSION });
    const known = await rows();
    const opts = { ...t.opts, lookup: (id: string) => known.find((r) => r.id === id) ?? null };
    const both = await Promise.allSettled([answerPrompt(opts, IDLE, perm(read, 1)), answerPrompt(opts, CODEX, perm(42, 1))]);
    expect(both.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(typed()).toHaveLength(3);
  });

  it('VIEW-4.3: an answer Fleet refused before typing (`busy`) leaves the Session’s last answer as it was, but moves the epoch: the tab refused meanwhile answers from the next read', async () => {
    editRow(bySession(CODEX), { status: 'waiting', fake_prompt: PERMISSION, fake_answer: 'busy' });
    const t = await setup();
    const read = t.ledger.current();
    const [first, second] = await Promise.allSettled([t.answer(CODEX, perm(read, 1)), t.answer(CODEX, perm(read, 2))]);
    expect(first).toMatchObject({ status: 'rejected', reason: { status: 409, kind: null, message: expect.stringMatching(/^Fleet is typing into this Session right now/) } });
    expect(second).toMatchObject({ status: 'rejected', reason: { status: 409, kind: 'stale', message: 'Another tab is answering this Session right now, so nothing was typed.' } });
    const row = t.known.find((r) => r.id === CODEX)!;
    expect(t.answered).not.toHaveBeenCalled();
    expect(t.ledger.lastAnswer(row)).toBe(0);
    // Every tab's next read carries a newer epoch, so tab 2's refusal ends there, and its click from it is typed.
    expect(t.ledger.current()).toBeGreaterThan(read);
    expect(t.ledger.lastChange(row)).toBe(t.ledger.current());
    editRow(bySession(CODEX), { fake_answer: null });
    expect(await t.answer(CODEX, perm(t.ledger.current(), 2))).toEqual({ epoch: expect.any(Number) });
    expect(typed().map((c) => c[6])).toEqual(['1', '2']);
  });

  it('VIEW-4.3: after an uncertain outcome, no tab answers that prompt again: a read from before is stale, and a newer one is refused while it stays on screen', async () => {
    editRow(bySession(CODEX), { status: 'waiting', fake_prompt: PERMISSION, fake_answer: 'outcome_uncertain' });
    const t = await setup();
    const read = t.ledger.current();
    await expect(t.answer(CODEX, perm(read))).rejects.toMatchObject({ status: 502 });
    expect(t.answered).toHaveBeenCalledWith('uncertain');
    // Another tab's buttons, from the read before it.
    editRow(bySession(CODEX), { fake_answer: null });
    await expect(t.answer(CODEX, perm(read, 2))).rejects.toMatchObject({
      status: 409,
      kind: 'stale',
      message: 'Another tab’s answer to this may have gone through, so nothing was typed. Check the terminal.',
    });
    // A read after it still shows that prompt: no answer to it from any tab.
    await expect(t.answer(CODEX, perm(t.ledger.current(), 2))).rejects.toMatchObject({
      status: 409,
      message: 'It may have been answered, but Lookout can’t tell, so nothing was typed. Check the terminal.',
    });
    expect(t.ledger.uncertainFor(t.known.find((r) => r.id === CODEX)!)).toBe('p:p2.0badc0de');
    expect(typed()).toHaveLength(1);
    // Another prompt is answered as usual.
    editRow(bySession(CODEX), { fake_prompt: { ...PERMISSION, id: 'p2.feedf00d' } });
    expect(await t.answer(CODEX, perm(t.ledger.current(), 1, 'p2.feedf00d'))).toEqual({ epoch: 43 });
  });

  it('VIEW-4.3: nothing read before a restart answers after it: a read older than the server is refused as stale, nothing typed', async () => {
    editRow(bySession(CODEX), { status: 'waiting', fake_prompt: PERMISSION });
    editRow(bySession(CLAUDE), { status: 'waiting' });
    // The server before the restart: its tabs read at 41.
    const before = (await setup()).ledger.current();
    // The server after it: a new, empty ledger, started later.
    const t = await setup();
    const after = new AnswerLedger({ now: () => before + 1_000 });
    const opts = { ...t.opts, ledger: after };
    const RESTARTED = { status: 409, kind: 'stale', message: 'Lookout restarted since this was read, so nothing was typed.' };
    await expect(answerPrompt(opts, CODEX, perm(before, 1))).rejects.toMatchObject(RESTARTED);
    await expect(answerPrompt(opts, CLAUDE, { kind: 'question', question: 'toolu_13', answers: [{ options: [1] }], epoch: before })).rejects.toMatchObject(RESTARTED);
    await expect(answerPrompt(opts, CODEX, perm(0, 1))).rejects.toMatchObject(RESTARTED);
    expect(typed()).toEqual([]);
    // A read from this server answers as usual.
    expect(await answerPrompt(opts, CODEX, perm(after.current(), 1))).toEqual({ epoch: before + 1_001 });
    expect(typed()).toHaveLength(1);
  });

  it('VIEW-4.4: two Stops for one Busy spell within 10 s, from any tab: Esc is pressed once; the second is refused', async () => {
    editRow(bySession(IDLE), { status: 'busy' });
    const t = await setup();
    let clock = 1_000_000;
    const opts = { ...t.opts, ledger: new AnswerLedger({ now: () => clock }) };
    const esc = [['--local', 'keys', `id:${IDLE}`, 'Escape', '--json']];
    const STOPPED = 'Esc was just pressed in this Session, so it wasn’t pressed again. Give it a few seconds to stop.';
    // Two tabs, 0 ms apart.
    const [a, b] = await Promise.allSettled([stopSession(opts, IDLE), stopSession(opts, IDLE)]);
    expect(a.status).toBe('fulfilled');
    expect(b).toMatchObject({ status: 'rejected', reason: { status: 409, message: STOPPED } });
    expect(typed()).toEqual(esc);
    // A reload 5 s later.
    clock += 5_000;
    expect(await refusal(stopSession(opts, IDLE))).toEqual({ status: 409, message: STOPPED });
    expect(typed()).toEqual(esc);
    // 10 s after the Esc, still Busy: it can be pressed again.
    clock += STOP_SETTLE_MS - 5_000;
    await stopSession(opts, IDLE);
    expect(typed()).toHaveLength(2);
    // A new Busy spell, begun more than a monitor poll after that Esc: at once.
    clock += MONITOR_INTERVAL_MS + 1_000;
    t.known.find((r) => r.id === IDLE)!.statusSince = clock - 500;
    await stopSession(opts, IDLE);
    expect(typed()).toHaveLength(3);
  });

  it('VIEW-4.4: a Busy spell that begins while Stop reads the fresh list is the one its Esc reaches: a second Stop in it within 10 s is refused', async () => {
    editRow(bySession(IDLE), { status: 'busy' });
    const t = await setup();
    let clock = 1_000_000;
    // As Lookout's monitor has it: Busy since 995 000 (spell A).
    let monitored: SessionRow = { ...t.known.find((r) => r.id === IDLE)!, statusSince: 995_000 };
    let release!: () => void;
    const listed = new Promise<void>((r) => (release = r));
    const opts = {
      ...t.opts,
      lookup: (id: string) => (id === IDLE ? monitored : null),
      freshList: async () => {
        await listed;
        return list();
      },
      ledger: new AnswerLedger({ now: () => clock }),
    };
    const STOPPED = 'Esc was just pressed in this Session, so it wasn’t pressed again. Give it a few seconds to stop.';
    const first = stopSession(opts, IDLE);
    // While the fresh list runs, A ends and Busy spell B begins: the Esc lands in B.
    clock += 300;
    monitored = { ...monitored, statusSince: clock };
    release();
    await first;
    expect(typed()).toHaveLength(1);
    // Another tab's Stop, asked in B 2 s later: refused, nothing pressed.
    clock += 2_000;
    expect(await refusal(stopSession(opts, IDLE))).toEqual({ status: 409, message: STOPPED });
    expect(typed()).toHaveLength(1);
    // A spell that begins more than a monitor poll after the Esc is a new one: Esc at once.
    clock += MONITOR_INTERVAL_MS + 1_000;
    monitored = { ...monitored, statusSince: clock - 500 };
    await stopSession(opts, IDLE);
    expect(typed()).toHaveLength(2);
  });

  it('VIEW-4.4: a Busy spell the monitor dates up to one poll after the Esc (a Codex Session with no time from Fleet) is the one the Esc reached: a second Stop in it within 10 s is refused', async () => {
    editRow(bySession(IDLE), { status: 'busy' });
    const t = await setup();
    let clock = 1_000_000;
    // Spell A, as Lookout's monitor has it.
    let monitored: SessionRow = { ...t.known.find((r) => r.id === IDLE)!, statusSince: 995_000 };
    const opts = { ...t.opts, lookup: (id: string) => (id === IDLE ? monitored : null), ledger: new AnswerLedger({ now: () => clock }) };
    const STOPPED = 'Esc was just pressed in this Session, so it wasn’t pressed again. Give it a few seconds to stop.';
    await stopSession(opts, IDLE);
    expect(typed()).toHaveLength(1);
    // Spell B began before the Esc landed, but the monitor first saw it at its next poll and, with
    // no time from Fleet, dated it then: after the Esc, within one interval.
    clock += MONITOR_INTERVAL_MS;
    monitored = { ...monitored, statusSince: clock };
    clock += 1_000;
    expect(await refusal(stopSession(opts, IDLE))).toEqual({ status: 409, message: STOPPED });
    expect(typed()).toHaveLength(1);
    // 10 s after the Esc it can be pressed again.
    clock = 1_000_000 + STOP_SETTLE_MS;
    await stopSession(opts, IDLE);
    expect(typed()).toHaveLength(2);
  });

  it('VIEW-4.4: a Stop Fleet refused before pressing doesn’t hold back the next one', async () => {
    editRow(bySession(IDLE), { status: 'busy', fake_keys: 'busy' });
    const t = await setup();
    expect(await refusal(t.stop(IDLE))).toMatchObject({ status: 409, message: expect.stringMatching(/Fleet is typing/) });
    editRow(bySession(IDLE), { fake_keys: null });
    await t.stop(IDLE);
    expect(typed()).toHaveLength(2);
  });

  it('VIEW-4.3, VIEW-4.4: the pid guard compares the start time too: a pid now running another process is “no longer running”', async () => {
    editRow((r) => r.pid === 61005, { status: 'waiting', fake_prompt: PERMISSION });
    const t = await setup();
    // The same pid, started at another time: a different process.
    editRow((r) => r.pid === 61005, { proc_start: '2026-10-17T10:00:00Z' });
    expect(await refusal(t.answer(NO_ID, perm(t.ledger.current())))).toEqual({ status: 409, message: 'This Session is no longer running, so nothing was typed.' });
    editRow((r) => r.pid === 61005, { status: 'busy' });
    expect(await refusal(t.stop(NO_ID))).toEqual({ status: 409, message: 'This Session is no longer running, so Esc wasn’t pressed.' });
    expect(typed()).toEqual([]);
    // Where Lookout has no start time, pid and Harness decide, as before.
    const known = { pid: 61005, harness: 'claude' as const, procStart: null };
    expect(sameProcess(known, { ...known, procStart: '2026-10-17T10:00:00Z' })).toBe(true);
    expect(sameProcess({ ...known, procStart: '2026-10-14T09:42:09Z' }, { ...known, procStart: null })).toBe(false);
    expect(sameProcess({ ...known, procStart: '2026-10-14T09:42:09Z' }, { ...known, procStart: '2026-10-14T09:42:09Z' })).toBe(true);
  });
});

describe('Stop (VIEW-4.4)', () => {
  it('VIEW-4.4: Stop presses Esc with `fleet keys id:<session_id> Escape --json`, only while a fresh list still has the Session Busy', async () => {
    editRow(bySession(IDLE), { status: 'busy' });
    const t = await setup();
    await t.stop(IDLE);
    expect(typed()).toEqual([['--local', 'keys', `id:${IDLE}`, 'Escape', '--json']]);
  });

  it('VIEW-4.4: a Session that stopped being Busy gets no key (Esc on a prompt would decline it), nor one that ended or is in another app', async () => {
    editRow(bySession(IDLE), { status: 'busy' });
    const t = await setup();
    editRow(bySession(IDLE), { status: 'waiting' });
    expect(await refusal(t.stop(IDLE))).toEqual({ status: 409, message: 'This Session isn’t working on anything now, so Esc wasn’t pressed.' });
    const file = join(dir, 'fleet', 'list.json');
    writeFileSync(file, JSON.stringify((JSON.parse(readFileSync(file, 'utf8')) as FleetRow[]).filter((r) => r.session_id !== IDLE)));
    expect(await refusal(t.stop(IDLE))).toEqual({ status: 409, message: 'This Session is no longer running, so Esc wasn’t pressed.' });
    expect(await refusal(t.stop(VIEW_ONLY))).toMatchObject({ status: 409, message: expect.stringMatching(/another app/) });
    expect(typed()).toEqual([]);
  });

  it('VIEW-4.4: a pid target is pressed by its exact pid, after the fresh list', async () => {
    editRow((r) => r.pid === 61005, { status: 'busy' });
    const t = await setup();
    await t.stop(NO_ID);
    expect(typed()).toEqual([['--local', 'keys', 'pid:61005', 'Escape', '--json']]);
  });

  it('VIEW-4.4: Fleet’s refusals are said in plain words; nothing names tmux', async () => {
    editRow(bySession(IDLE), { status: 'busy', fake_keys: 'busy' });
    let t = await setup();
    expect(await refusal(t.stop(IDLE))).toEqual({ status: 409, message: 'Fleet is typing into this Session right now, so Esc wasn’t pressed. Try again.' });
    editRow(bySession(IDLE), { fake_keys: 'backend_unsupported' });
    t = await setup();
    expect(await refusal(t.stop(IDLE))).toMatchObject({ status: 409, message: expect.stringMatching(/can’t reach this Session’s terminal/) });
    const failing = (stdout: string, stderr: string) => ({
      ...t.opts,
      // Each its own: an Esc that may have gone out holds back the next one for 10 s.
      ledger: new AnswerLedger(),
      runner: vi.fn(async (f: string, a: readonly string[], o: RunOptions) =>
        a.includes('keys') ? Promise.reject(Object.assign(new Error('exit 1'), { code: 1, stdout, stderr })) : runner(f, a, o),
      ),
    });
    expect(await refusal(stopSession(failing('{"ok":false,"kind":"backend_failed","error":"tmux send-keys failed"}', ''), IDLE))).toEqual({
      status: 502,
      message: 'Couldn’t stop it: the Session host refused. Check the terminal.',
    });
    expect(await refusal(stopSession(failing('', "error: unrecognized subcommand 'keys'"), IDLE))).toEqual({
      status: 501,
      message: 'This Fleet can’t press keys yet. Update the Fleet fork.',
    });
    // The fake checks key names as Fleet does.
    const raw = await run(FAKE_FLEET, ['--local', 'keys', `id:${IDLE}`, 'Esc', '--json'], { timeoutMs: 5000, env }).catch((e: { stdout: string }) => e.stdout);
    expect(JSON.parse(raw)).toMatchObject({ ok: false, kind: 'invalid_key' });
  });
});

describe('Esc (VIEW-4.5)', () => {
  const esc = (t: Awaited<ReturnType<typeof setup>>, id: string) => stopSession(t.opts, id, 'needs-you');
  const ESCAPED = 'Esc was just pressed in this Session, so it wasn’t pressed again. Give it a few seconds.';

  it('VIEW-4.5: Esc presses `fleet keys id:<session_id> Escape --json`, only while a fresh list still has the Session Needs you', async () => {
    editRow(bySession(IDLE), { status: 'waiting' });
    const t = await setup();
    await esc(t, IDLE);
    expect(typed()).toEqual([['--local', 'keys', `id:${IDLE}`, 'Escape', '--json']]);
  });

  it('VIEW-4.5: a Session that no longer Needs you gets no key, nor one that ended or is in another app; Stop never presses for one that Needs you', async () => {
    editRow(bySession(IDLE), { status: 'waiting' });
    const t = await setup();
    // Stop's check holds: Esc on a prompt would decline it.
    expect(await refusal(t.stop(IDLE))).toEqual({ status: 409, message: 'This Session isn’t working on anything now, so Esc wasn’t pressed.' });
    for (const status of ['busy', 'idle']) {
      editRow(bySession(IDLE), { status });
      expect(await refusal(esc(t, IDLE))).toEqual({ status: 409, message: 'This Session isn’t waiting on you now, so Esc wasn’t pressed.' });
    }
    const file = join(dir, 'fleet', 'list.json');
    writeFileSync(file, JSON.stringify((JSON.parse(readFileSync(file, 'utf8')) as FleetRow[]).filter((r) => r.session_id !== IDLE)));
    expect(await refusal(esc(t, IDLE))).toEqual({ status: 409, message: 'This Session is no longer running, so Esc wasn’t pressed.' });
    expect(await refusal(esc(t, VIEW_ONLY))).toEqual({ status: 409, message: 'This Session runs in another app, so Lookout can’t press Esc in it.' });
    expect(await refusal(esc(t, 'nope'))).toEqual({ status: 404, message: 'This Session isn’t running.' });
    expect(typed()).toEqual([]);
  });

  it('VIEW-4.5: a pid target is pressed by its exact pid, after the fresh list', async () => {
    editRow((r) => r.pid === 61005, { status: 'waiting' });
    const t = await setup();
    await esc(t, NO_ID);
    expect(typed()).toEqual([['--local', 'keys', 'pid:61005', 'Escape', '--json']]);
  });

  it('VIEW-4.5: one Esc per spell every 10 s, from either button and any tab: a second is refused, and so is one right after Stop’s', async () => {
    editRow(bySession(IDLE), { status: 'waiting' });
    const t = await setup();
    let clock = 1_000_000;
    let monitored: SessionRow = { ...t.known.find((r) => r.id === IDLE)!, statusSince: 990_000 };
    const opts = { ...t.opts, lookup: (id: string) => (id === IDLE ? monitored : null), ledger: new AnswerLedger({ now: () => clock }) };
    // Two tabs, 0 ms apart.
    const [a, b] = await Promise.allSettled([stopSession(opts, IDLE, 'needs-you'), stopSession(opts, IDLE, 'needs-you')]);
    expect(a.status).toBe('fulfilled');
    expect(b).toMatchObject({ status: 'rejected', reason: { status: 409, message: ESCAPED } });
    expect(typed()).toHaveLength(1);
    clock += 5_000;
    expect(await refusal(stopSession(opts, IDLE, 'needs-you'))).toEqual({ status: 409, message: ESCAPED });
    // 10 s after the Esc, still Needs you: it can be pressed again.
    clock += STOP_SETTLE_MS - 5_000;
    await stopSession(opts, IDLE, 'needs-you');
    expect(typed()).toHaveLength(2);

    // Stop in a Busy spell, then Needs you within one monitor poll of its Esc: that's the spell it reached.
    clock += 60_000;
    editRow(bySession(IDLE), { status: 'busy' });
    monitored = { ...monitored, status: 'busy', statusSince: clock - 3_000 };
    await stopSession(opts, IDLE, 'busy');
    editRow(bySession(IDLE), { status: 'waiting' });
    monitored = { ...monitored, status: 'needs-you', statusSince: clock + MONITOR_INTERVAL_MS };
    clock += MONITOR_INTERVAL_MS + 500;
    expect(await refusal(stopSession(opts, IDLE, 'needs-you'))).toEqual({ status: 409, message: ESCAPED });
    expect(typed()).toHaveLength(3);
  });

  it('VIEW-4.5: Fleet’s refusals are said in plain words for Esc; nothing names tmux', async () => {
    editRow(bySession(IDLE), { status: 'waiting', fake_keys: 'busy' });
    let t = await setup();
    expect(await refusal(esc(t, IDLE))).toEqual({ status: 409, message: 'Fleet is typing into this Session right now, so Esc wasn’t pressed. Try again.' });
    editRow(bySession(IDLE), { fake_keys: 'backend_unsupported' });
    t = await setup();
    expect(await refusal(esc(t, IDLE))).toEqual({ status: 409, message: 'Lookout can’t reach this Session’s terminal, so Esc wasn’t pressed. Press it there.' });
    editRow(bySession(IDLE), { fake_keys: 'target_ambiguous' });
    t = await setup();
    expect(await refusal(esc(t, IDLE))).toEqual({ status: 409, message: 'Fleet couldn’t tell which Session this is, so Esc wasn’t pressed. Press Esc in the terminal.' });
    editRow(bySession(IDLE), { fake_keys: null });
    const failing = (stdout: string) => ({
      ...t.opts,
      ledger: new AnswerLedger(),
      runner: vi.fn(async (f: string, a: readonly string[], o: RunOptions) =>
        a.includes('keys') ? Promise.reject(Object.assign(new Error('exit 1'), { code: 1, stdout, stderr: '' })) : runner(f, a, o),
      ),
    });
    expect(await refusal(stopSession(failing('{"ok":false,"kind":"backend_failed","error":"tmux send-keys failed"}'), IDLE, 'needs-you'))).toEqual({
      status: 502,
      message: 'Couldn’t press Esc: the Session host refused. Check the terminal.',
    });
    const fresh = { ...t.opts, ledger: new AnswerLedger(), freshList: async () => ({ kind: 'error' as const, message: 'fleet failed' }) };
    expect(await refusal(stopSession(fresh as typeof t.opts, IDLE, 'needs-you'))).toEqual({
      status: 503,
      message: 'Couldn’t check that the Session is still waiting on you, so Esc wasn’t pressed. Try again.',
    });
  });
});
