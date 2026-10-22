import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelSwitchRequest, SessionRow } from '../shared/types.ts';
import { sameModel } from '../shared/model.ts';
import { type RunOptions, type Runner, run } from './exec.ts';
import { type FleetRow, fetchFleetList } from './fleet.ts';
import { Launcher } from './launcher.ts';
import { MODEL_HELD, MODEL_HELD_OTHER, MODEL_IO, MODEL_TIMEOUT_MS, MODEL_UNCERTAIN, ModelSwitchError, ModelSwitches, switchModel } from './model-switch.ts';
import { SessionMonitor } from './monitor.ts';

/**
 * VIEW-6 against the fake `fleet` (`model --json`, the Fleet fork's contract, docs/cli.md
 * "Switching the model"): real processes, synthetic Sessions only. Nothing is ever typed.
 */
const FAKE_FLEET = new URL('./fixtures/fleet/messages/fake-fleet.mjs', import.meta.url).pathname;
const FLEET_FIXTURES = new URL('./fixtures/fleet/messages/', import.meta.url).pathname;

const CLAUDE = 'dddddddd-0000-4000-8000-000000000104'; // Claude Code, Idle, tmux, pid 61004
const PROC = { pid: 61004, procStart: '2026-10-14T09:30:00Z' };
const CODEX = 'bbbbbbbb-0000-4000-8000-000000000102'; // Codex, Idle, tmux
const WAITING = 'aaaaaaaa-0000-4000-8000-000000000101'; // Claude Code, Needs you
const VIEW_ONLY = 'cccccccc-0000-4000-8000-000000000103'; // Claude Code, backend unknown

let dir: string;
let env: NodeJS.ProcessEnv;
let fleetLog: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lookout-model-'));
  cpSync(FLEET_FIXTURES, join(dir, 'fleet'), { recursive: true });
  fleetLog = join(dir, 'fleet.log');
  env = { PATH: process.env.PATH, FAKE_FLEET_DIR: join(dir, 'fleet'), FAKE_FLEET_LOG: fleetLog };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const runner: Runner = (f, a, o: RunOptions) => run(f, a, { ...o, env: { ...o.env, ...env } });
const list = () => fetchFleetList(runner, FAKE_FLEET);
/** Every Fleet command run, but the list reads. */
const calls = (): string[][] => {
  try {
    return readFileSync(fleetLog, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string[])
      .filter((c) => c.find((x) => !x.startsWith('-')) !== 'list');
  } catch {
    return [];
  }
};
const switches = () => calls().filter((c) => c.includes('model'));
/** Changes the fake `fleet`'s rows (by session id). */
const editRow = (sessionId: string, patch: Partial<FleetRow> & Record<string, unknown>) => {
  const file = join(dir, 'fleet', 'list.json');
  const all = JSON.parse(readFileSync(file, 'utf8')) as FleetRow[];
  writeFileSync(file, JSON.stringify(all.map((r) => (r.session_id === sessionId ? { ...r, ...patch } : r))));
};

/**
 * The server's wiring: the monitor (polled by hand) carries the switches' `pendingModel`, and
 * LAUNCH's launcher holds the cached `harness list`.
 */
async function setup(over: { runner?: Runner; harnessRunner?: Runner } = {}) {
  const models = new ModelSwitches();
  const upserts: SessionRow[] = [];
  const monitor = new SessionMonitor({
    fetchList: list,
    git: { get: () => null, prune: () => {} },
    models,
    onEvent: (e) => void (e.type === 'sessions' && upserts.push(...e.upsert)),
  });
  await monitor.tick();
  const launcher = new Launcher({ runner: over.harnessRunner ?? runner, fleetBin: () => FAKE_FLEET, settings: { get: () => ({}) as never, update: async () => ({}) as never }, onChange: () => {}, env });
  const drop = vi.spyOn(launcher, 'dropHarnesses');
  // What had gone out to the tabs by each list made after a switch (that list sends it all again).
  const atRefresh: SessionRow[][] = [];
  const refresh = vi.fn(() => {
    atRefresh.push([...upserts]);
    return monitor.pollNow();
  });
  const opts = {
    runner: over.runner ?? runner,
    fleetBin: () => FAKE_FLEET,
    lookup: (id: string) => monitor.get(id),
    freshList: list,
    harnesses: () => launcher.harnesses(),
    dropHarnesses: () => launcher.dropHarnesses(),
    switches: models,
    changed: () => monitor.refreshDerived(),
    refresh,
    env,
  };
  const req = (model: string, proc = PROC): ModelSwitchRequest => ({ model, ...proc });
  return {
    monitor,
    models,
    upserts,
    drop,
    refresh,
    atRefresh,
    launcher,
    switchTo: (model: string, id = CLAUDE, proc = PROC) => switchModel(opts, id, req(model, proc)),
  };
}

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof ModelSwitchError) return { status: err.status, message: err.message, uncertain: err.uncertain };
    throw err;
  }
  throw new Error('expected a refusal');
};

/** Fleet's `io` words (docs/cli.md, cli/model.rs): before typing, and while typing `/model`. */
const IO_UNTYPED = 'session id:x: its process’s start time cannot be read; nothing typed';
const IO_TYPING = 'tmux send-keys failed; `/model claude-sonnet-5-5` may be partly typed, nothing pressed after it';

/** A runner that answers `model` with a failure of Fleet's, and the rest as the fake does. */
const failingModel = (fail: Record<string, unknown>): Runner => (f, a, o) => (a.includes('model') ? Promise.reject(Object.assign(new Error('fleet failed'), fail)) : runner(f, a, o));

// Real `fleet` processes, several per test: room for a busy machine.
describe('switching the model (VIEW-6)', { timeout: 30_000 }, () => {
  it('VIEW-6.5: an Idle Claude Code Session switches through `fleet --local model --json --require-empty --expect-pid … --expect-start … -- id:<session_id> <model>`, and nothing else is typed or answered', async () => {
    const t = await setup();
    expect(await t.switchTo('claude-sonnet-5-5')).toEqual({ model: 'claude-sonnet-5-5', confirmed: false });
    expect(switches()).toEqual([
      ['--local', 'model', '--json', '--require-empty', '--expect-pid', '61004', '--expect-start', '2026-10-14T09:30:00Z', '--', `id:${CLAUDE}`, 'claude-sonnet-5-5'],
    ]);
    // Only the models list and the switch: no `answer`, `keys` or `send` of Lookout's own.
    expect(calls().map((c) => c.find((a) => !a.startsWith('-')))).toEqual(['harness', 'model']);
  });

  it('VIEW-6.5: when Claude Code asked to confirm the switch, the pick was the confirmation: Fleet answered it, and Lookout answers nothing more', async () => {
    editRow(CLAUDE, { fake_model_confirm: true });
    const t = await setup();
    expect(await t.switchTo('claude-haiku-5-5')).toEqual({ model: 'claude-haiku-5-5', confirmed: true });
    expect(calls().filter((c) => c.includes('answer') || c.includes('keys') || c.includes('send'))).toEqual([]);
  });

  it('VIEW-6.1: only a model Fleet lists for Claude Code, never its "Default" entry (`""`); nothing runs otherwise', async () => {
    const t = await setup();
    for (const model of ['gpt-6-astra', 'opus', 'claude-opus-5-5[1m]']) {
      expect(await refusal(t.switchTo(model))).toEqual({ status: 400, message: 'Fleet doesn’t list this model for Claude Code, so the Session wasn’t switched.', uncertain: false });
    }
    expect(switches()).toEqual([]);
  });

  it('VIEW-6.1: the models come from LAUNCH’s cached `harness list`: one read for many switches; when it can’t be read, nothing runs', async () => {
    const t = await setup();
    await t.launcher.harnesses();
    await t.launcher.harnesses();
    expect(calls().filter((c) => c.includes('harness'))).toHaveLength(1);
    const broken: Runner = (f, a, o) => (a.includes('harness') ? Promise.reject(Object.assign(new Error('x'), { code: 1, stderr: 'boom' })) : runner(f, a, o));
    const u = await setup({ runner: broken, harnessRunner: broken });
    const res = await refusal(u.switchTo('claude-sonnet-5-5'));
    expect(res).toEqual({ status: 503, message: 'Couldn’t read the models Fleet lists, so the model wasn’t switched. Try again.', uncertain: false });
    expect(switches()).toEqual([]);
  });

  it('VIEW-6.1: the current model matches with case, a `[1m]` suffix and a date suffix aside', () => {
    expect(sameModel('claude-opus-5-5', 'claude-opus-5-5[1m]')).toBe(true);
    expect(sameModel('claude-haiku-4-5', 'claude-haiku-4-5-20251001')).toBe(true);
    expect(sameModel('Claude-Haiku-4-5-20251001[1m]', 'claude-haiku-4-5')).toBe(true);
    expect(sameModel('claude-opus-5-5', 'claude-opus-5')).toBe(false);
    expect(sameModel('claude-sonnet-5-5', 'claude-opus-5-5')).toBe(false);
  });

  it('VIEW-6.2: a Codex Session, and one that isn’t Controllable, isn’t switched; nothing runs', async () => {
    const t = await setup();
    expect(await refusal(t.switchTo('claude-sonnet-5-5', CODEX, { pid: 61002, procStart: '2026-10-14T07:55:41Z' }))).toMatchObject({ status: 409, message: 'Lookout switches the model only in a Claude Code Session.' });
    expect(await refusal(t.switchTo('claude-sonnet-5-5', VIEW_ONLY, { pid: 61003, procStart: '2026-10-14T08:01:17.250Z' }))).toMatchObject({ status: 409, message: 'This Session runs in another app, so Lookout can’t switch its model.' });
    expect(switches()).toEqual([]);
    // In an iTerm tab (Fleet's `model` reads the box only in its own terminal host), as listed, or by
    // the fresh list right before typing.
    const iterm = 'This Session runs in an iTerm tab, where Lookout can’t switch its model. Use /model in its terminal.';
    editRow(CLAUDE, { backend: 'iterm' });
    const u = await setup();
    expect(await refusal(u.switchTo('claude-sonnet-5-5'))).toEqual({ status: 409, message: iterm, uncertain: false });
    editRow(CLAUDE, { backend: 'tmux' });
    const v = await setup();
    editRow(CLAUDE, { backend: 'iterm' });
    expect(await refusal(v.switchTo('claude-sonnet-5-5'))).toEqual({ status: 409, message: iterm, uncertain: false });
    expect(switches()).toEqual([]);
  });

  it('VIEW-6.3: a fresh `fleet list` right before typing must still show it Idle; otherwise nothing runs', async () => {
    const t = await setup();
    editRow(CLAUDE, { status: 'busy' });
    expect(await refusal(t.switchTo('claude-sonnet-5-5'))).toEqual({ status: 409, message: 'The Session isn’t Idle now, so the model wasn’t switched. Try again once it is.', uncertain: false });
    expect(await refusal(t.switchTo('claude-sonnet-5-5', WAITING, { pid: 61001, procStart: '2026-10-14T08:12:03Z' }))).toMatchObject({ status: 409 });
    expect(switches()).toEqual([]);
  });

  it('VIEW-6.3: one switch per Session at a time, whichever tab asks; the next can start once it’s over', async () => {
    let release: (() => void) | null = null;
    const slow: Runner = async (f, a, o) => {
      if (a.includes('model')) await new Promise<void>((r) => (release = r));
      return runner(f, a, o);
    };
    const t = await setup({ runner: slow });
    const first = t.switchTo('claude-sonnet-5-5');
    await vi.waitFor(() => expect(release).not.toBeNull());
    expect(await refusal(t.switchTo('claude-haiku-5-5'))).toEqual({ status: 409, message: 'A switch for this Session is already under way.', uncertain: false });
    release!();
    await first;
    release = null;
    const second = t.switchTo('claude-haiku-5-5');
    await vi.waitFor(() => expect(release).not.toBeNull());
    release!();
    expect(await second).toMatchObject({ model: 'claude-haiku-5-5' });
    expect(switches().map((c) => c.at(-1))).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
  });

  it('VIEW-6.3: the process the menu opened on is the one switched: a restarted Session is refused, here and by Fleet (`target_changed`)', async () => {
    const t = await setup();
    expect(await refusal(t.switchTo('claude-sonnet-5-5', CLAUDE, { pid: 61004, procStart: '2026-10-14T09:29:00Z' }))).toMatchObject({ status: 409, message: 'This Session was restarted since you picked the model, so it wasn’t switched.' });
    expect(await refusal(t.switchTo('claude-sonnet-5-5', CLAUDE, { pid: 61004, procStart: null } as never))).toMatchObject({ status: 409 });
    expect(switches()).toEqual([]);
    // Changed between the fresh list and Fleet's own check (restarted, or `/clear` gave it a new
    // session id under the lock): Fleet refuses it, and Lookout can't tell which, so it says neither.
    const late = failingModel({ code: 1, stdout: JSON.stringify({ ok: false, kind: 'target_changed', error: 'now runs session …, not … (its id changed, as `/clear` changes it, since it was looked up)' }) });
    const u = await setup({ runner: late });
    expect(await refusal(u.switchTo('claude-sonnet-5-5'))).toEqual({ status: 409, message: 'This Session changed since you picked the model (restarted or cleared), so it wasn’t switched. Try again.', uncertain: false });
  });

  it('VIEW-6.8: a `/clear` between the pick and the switch reads as ended or cleared, never as only “no longer running”', async () => {
    // The fresh list no longer has the session id the pick was for (`/clear` gave the process a new one).
    const t = await setup();
    editRow(CLAUDE, { session_id: 'dddddddd-0000-4000-8000-000000000999' });
    expect(await refusal(t.switchTo('claude-sonnet-5-5'))).toEqual({ status: 409, message: 'This Session ended or was cleared since you picked the model, so it wasn’t switched.', uncertain: false });
    expect(switches()).toEqual([]);
  });

  it('VIEW-6.6: a held switch says why by Fleet’s reason and what to do in the terminal; what the box holds is never read or shown', async () => {
    for (const reason of ['text', 'prompt', 'no_input_box', 'unreadable'] as const) {
      editRow(CLAUDE, { fake_model_held: reason, fake_input: 'SECRET-DRAFT' });
      const t = await setup();
      const r = await refusal(t.switchTo('claude-sonnet-5-5'));
      expect(r).toEqual({ status: 409, message: MODEL_HELD[reason], uncertain: false });
      expect(JSON.stringify(r)).not.toContain('SECRET');
    }
    expect(MODEL_HELD.text).toMatch(/Send or clear it in the terminal, then try again/);
    expect(MODEL_HELD.prompt).toMatch(/Answer it, then try again/);
    expect(MODEL_HELD.no_input_box).toMatch(/close it with Esc, then try again/i);
    expect(MODEL_HELD.unreadable).toMatch(/Switch with \/model in the terminal instead/);
    // A reason this Lookout doesn't know, or none at all (exit 3 without a report): said plainly.
    const odd = await setup({ runner: failingModel({ code: 3, stdout: JSON.stringify({ ok: false, kind: 'send_held', reason: 'newfangled', input: 'SECRET' }) }) });
    expect(await refusal(odd.switchTo('claude-sonnet-5-5'))).toEqual({ status: 409, message: MODEL_HELD_OTHER, uncertain: false });
    const bare = await setup({ runner: failingModel({ code: 3, stdout: '' }) });
    expect(await refusal(bare.switchTo('claude-sonnet-5-5'))).toEqual({ status: 409, message: MODEL_HELD_OTHER, uncertain: false });
  });

  it('VIEW-6.8: each failure says what happened in plain words by its kind, never naming tmux, and is never retried', async () => {
    const cases: [Record<string, unknown>, string, boolean][] = [
      [{ fake_model: 'model_not_found' }, 'Claude Code doesn’t know this model, so the Session wasn’t switched.', false],
      [{ fake_model: 'not_idle', fake_model_reason: 'busy' }, 'The Session is working, so the model wasn’t switched. Try again once it’s Idle.', false],
      [{ fake_model: 'not_idle', fake_model_reason: 'waiting' }, 'The Session isn’t Idle now, so the model wasn’t switched. Try again once it is.', false],
      [{ fake_model: 'busy', fake_model_reason: 'editor_open' }, 'An editor is open in this Session, so the model wasn’t switched. Close it in the terminal, then try again.', false],
      [{ fake_model: 'busy', fake_model_reason: 'locked' }, 'Fleet is typing into it; try again.', false],
      [{ fake_model: 'host_shared', fake_model_reason: 'suspended' }, 'This Session is paused in its terminal, so the model wasn’t switched. Bring it back there, then try again.', false],
      [{ fake_model: 'host_shared', fake_model_reason: 'job_in_front' }, 'This Session is paused behind another program in its terminal, so the model wasn’t switched. Bring it back there, then try again.', false],
      [{ fake_model: 'switch_refused' }, 'A hook in Claude Code refused the switch, so the model wasn’t switched.', false],
      [{ fake_model: 'target_not_found' }, 'This Session ended or was cleared since you picked the model, so it wasn’t switched.', false],
      [{ fake_model: 'outcome_uncertain' }, MODEL_UNCERTAIN, true],
      [{ fake_model: 'confirm_unrecognized' }, MODEL_UNCERTAIN, true],
      [{ fake_model: 'something_new' }, MODEL_UNCERTAIN, true],
    ];
    for (const [patch, message, uncertain] of cases) {
      editRow(CLAUDE, { fake_model: undefined, fake_model_reason: undefined, fake_model_error: undefined, ...patch });
      const t = await setup();
      const before = switches().length;
      const r = await refusal(t.switchTo('claude-sonnet-5-5'));
      expect(r.message).toBe(message);
      expect(r.uncertain).toBe(uncertain);
      expect(r.message).not.toMatch(/tmux/i);
      expect(switches().length - before).toBe(1); // nothing retried
    }
  });

  it('VIEW-6.8: Fleet’s `io` with `typed: false` is a plain failure, whatever its words; `typed: true`, or no `typed` (a Fleet before e187158), can’t tell', async () => {
    const typing = 'Fleet couldn’t finish typing /model, so Lookout can’t tell whether the model was switched. Check the terminal.';
    // [error, typed (null: left out), message, uncertain]
    const cases: [string | undefined, boolean | null, string, boolean][] = [
      [IO_UNTYPED, false, MODEL_IO, false],
      // Only `typed` is read, never the words.
      ['tmux capture-pane failed', false, MODEL_IO, false],
      [undefined, false, MODEL_IO, false],
      [IO_TYPING, true, typing, true],
      [IO_UNTYPED, true, typing, true],
      // An older Fleet: no `typed`, so even "nothing typed" in its words can’t be told.
      [IO_UNTYPED, null, typing, true],
      [undefined, null, typing, true],
    ];
    for (const [error, typed, message, uncertain] of cases) {
      editRow(CLAUDE, { fake_model: 'io', fake_model_error: error, fake_model_typed: typed });
      const t = await setup();
      expect(await refusal(t.switchTo('claude-sonnet-5-5'))).toEqual({ status: 502, message, uncertain });
    }
    expect(MODEL_IO).toMatch(/nothing was typed/);
  });

  it('VIEW-6.8: no answer in 20 s, Fleet missing, a Fleet without `model`, or an answer that doesn’t say it switched', async () => {
    const timeoutAt: RunOptions[] = [];
    const timedOut: Runner = (f, a, o) => {
      if (!a.includes('model')) return runner(f, a, o);
      timeoutAt.push(o);
      return Promise.reject(Object.assign(new Error('timed out'), { timedOut: true }));
    };
    const t = await setup({ runner: timedOut });
    expect(await refusal(t.switchTo('claude-sonnet-5-5'))).toEqual({ status: 504, message: 'Fleet took too long, so Lookout can’t tell whether the model was switched. Check the terminal.', uncertain: true });
    expect(timeoutAt[0]?.timeoutMs).toBe(MODEL_TIMEOUT_MS);
    expect(MODEL_TIMEOUT_MS).toBe(20_000);

    const missing = await setup({ runner: failingModel({ code: 'ENOENT' }) });
    expect(await refusal(missing.switchTo('claude-sonnet-5-5'))).toEqual({ status: 503, message: 'Fleet isn’t installed, so the model wasn’t switched.', uncertain: false });
    const old = await setup({ runner: failingModel({ code: 2, stderr: "error: unrecognized subcommand 'model'\n" }) });
    expect(await refusal(old.switchTo('claude-sonnet-5-5'))).toEqual({ status: 501, message: 'This Fleet can’t switch models yet. Update the Fleet fork.', uncertain: false });
    const odd: Runner = (f, a, o) => (a.includes('model') ? Promise.resolve('switched, probably\n') : runner(f, a, o));
    const u = await setup({ runner: odd });
    expect(await refusal(u.switchTo('claude-sonnet-5-5'))).toEqual({ status: 502, message: MODEL_UNCERTAIN, uncertain: true });
  });

  it('VIEW-6.4: whenever the switch may have changed Claude Code’s saved default, LAUNCH’s cached list goes; a plain refusal keeps it', async () => {
    const ok = await setup();
    await ok.switchTo('claude-sonnet-5-5');
    expect(ok.drop).toHaveBeenCalledOnce();
    for (const [kind, error, typed] of [['outcome_uncertain', undefined, undefined], ['io', IO_TYPING, true], ['io', IO_UNTYPED, null]] as const) {
      editRow(CLAUDE, { fake_model: kind, fake_model_error: error, fake_model_typed: typed });
      const t = await setup();
      await refusal(t.switchTo('claude-sonnet-5-5'));
      expect(t.drop).toHaveBeenCalledOnce();
    }
    const timedOut = await setup({ runner: failingModel({ timedOut: true }) });
    await refusal(timedOut.switchTo('claude-sonnet-5-5'));
    expect(timedOut.drop).toHaveBeenCalledOnce();
    for (const [kind, error, typed] of [['model_not_found', undefined, undefined], ['not_idle', undefined, undefined], ['switch_refused', undefined, undefined], ['io', IO_UNTYPED, false]] as const) {
      editRow(CLAUDE, { fake_model: kind, fake_model_error: error, fake_model_typed: typed });
      const t = await setup();
      await refusal(t.switchTo('claude-sonnet-5-5'));
      expect(t.drop).not.toHaveBeenCalled();
    }
  });

  it('VIEW-6.7: once switched, the row carries the new model as `pendingModel` at once, before the answer, and keeps it until a reply after the switch reaches the Transcript', async () => {
    editRow(CLAUDE, { fake_switched_at: '2026-10-14T10:00:00.120Z' });
    const t = await setup();
    await t.switchTo('claude-sonnet-5-5');
    // Out before the list made after the switch: the row went out again at once.
    expect(t.atRefresh[0]!.findLast((r) => r.id === CLAUDE)?.pendingModel).toEqual({ model: 'claude-sonnet-5-5', since: '2026-10-14T10:00:00.120Z' });
    expect(t.monitor.get(CLAUDE)?.model).toBe('claude-opus-5-5');
    // A list with no reply since: it stays.
    await t.monitor.tick();
    expect(t.monitor.get(CLAUDE)?.pendingModel?.model).toBe('claude-sonnet-5-5');
    // The next reply reaches the Transcript: Fleet's own model shows, whichever it is.
    editRow(CLAUDE, { model: 'claude-opus-5-5', model_at: '2026-10-14T10:00:05Z' });
    await t.monitor.tick();
    expect(t.monitor.get(CLAUDE)?.pendingModel).toBeNull();
    expect(t.monitor.get(CLAUDE)?.model).toBe('claude-opus-5-5');
  });

  it('VIEW-6.7: the pending model goes when the Session’s process ends or changes, and a newer switch replaces it', async () => {
    editRow(CLAUDE, { fake_switched_at: '2026-10-14T10:00:00Z' });
    const t = await setup();
    await t.switchTo('claude-sonnet-5-5');
    editRow(CLAUDE, { fake_switched_at: '2026-10-14T10:01:00Z' });
    await t.switchTo('claude-haiku-5-5');
    expect(t.monitor.get(CLAUDE)?.pendingModel).toEqual({ model: 'claude-haiku-5-5', since: '2026-10-14T10:01:00Z' });
    editRow(CLAUDE, { pid: 61099, proc_start: '2026-10-14T10:02:00Z' });
    await t.monitor.tick();
    expect(t.monitor.get(CLAUDE)?.pendingModel).toBeNull();
  });

  it('VIEW-6.7: the pending model is kept per Session process: after `/clear` (a new session id, the same process) the row still shows it, from the next reply', async () => {
    editRow(CLAUDE, { fake_switched_at: '2026-10-14T10:00:00Z' });
    const t = await setup();
    await t.switchTo('claude-sonnet-5-5');
    const CLEARED = 'eeeeeeee-0000-4000-8000-000000000105';
    editRow(CLAUDE, { session_id: CLEARED, model: null, model_at: null });
    await t.monitor.tick();
    expect(t.monitor.get(CLAUDE)).toBeNull();
    expect(t.monitor.get(CLEARED)?.pendingModel).toEqual({ model: 'claude-sonnet-5-5', since: '2026-10-14T10:00:00Z' });
    // Its first reply reaches the new Transcript: Fleet's model from then on.
    editRow(CLEARED, { model: 'claude-sonnet-5-5', model_at: '2026-10-14T10:00:09Z' });
    await t.monitor.tick();
    expect(t.monitor.get(CLEARED)?.pendingModel).toBeNull();
    expect(t.monitor.get(CLEARED)?.model).toBe('claude-sonnet-5-5');
  });

  it('VIEW-6.7: a late answer brings nothing back: not once a reply after the switch is listed, not for a process that changed', () => {
    const models = new ModelSwitches();
    const listed = (modelAt: string | null, proc = PROC): [SessionRow[], FleetRow[]] => [
      [{ id: CLAUDE, harness: 'claude', ...proc } as SessionRow],
      [{ session_id: CLAUDE, harness: 'claude', pid: proc.pid, proc_start: proc.procStart, model_at: modelAt } as FleetRow],
    ];
    const row = { id: CLAUDE, ...PROC } as SessionRow;
    // A reply after the switch was listed before its answer came: nothing is installed.
    models.observe(...listed('2026-10-14T10:00:05Z'));
    expect(models.settle(PROC, 'claude-sonnet-5-5', '2026-10-14T10:00:00Z')).toBe(false);
    expect(models.pendingFor(row)).toBeNull();
    // Another process is listed now.
    models.observe(...listed(null, { pid: 61099, procStart: '2026-10-14T10:02:00Z' }));
    expect(models.settle(PROC, 'claude-sonnet-5-5', '2026-10-14T10:00:00Z')).toBe(false);
    expect(models.pendingFor(row)).toBeNull();
    // Still that process, no reply since: installed.
    models.observe(...listed('2026-10-14T09:31:00Z'));
    expect(models.settle(PROC, 'claude-haiku-5-5', '2026-10-14T10:00:00Z')).toBe(true);
    expect(models.pendingFor(row)).toEqual({ model: 'claude-haiku-5-5', since: '2026-10-14T10:00:00Z' });
  });
});
