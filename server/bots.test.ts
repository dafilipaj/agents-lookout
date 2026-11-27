import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOTS_READ_ONLY, BOT_IDLE_DONE_MS, BOT_RUNS_MAX, BOT_TICK_MS, REPORT_REPLY_MAX, REPORT_TEXT_MAX, type BotInput, type BotsSnapshot } from '../shared/bots.ts';
import type { LibraryPage, LibraryQuery, OutputItem } from '../shared/library.ts';
import { type Settings, defaultSettings } from '../shared/settings.ts';
import type { ChatEntry, EndTarget, HistoryItem, SessionRow } from '../shared/types.ts';
import { Bots, BotsError, REPORT_OUTPUTS_MAX, RUNNING, RUN_CANCELLED, RUN_ENDED_EARLY, RUN_RESTARTED, WAITING_FOR_TRUST, botsLockPath, defaultBotsPath, mayRunBots } from './bots.ts';
import { EndError } from './closer.ts';
import type { FleetRow } from './fleet.ts';
import { Launcher } from './launcher.ts';
import { LibraryError } from './library.ts';

/** A local time in November 2026, so the tests hold in any time zone. The 23rd is a Monday. */
const at = (day: number, hh: number, mm = 0, ss = 0) => new Date(2026, 10, day, hh, mm, ss).getTime();
const MINUTE = 60_000;

const HARNESS_JSON = JSON.stringify([
  { id: 'claude', label: 'Claude Code', installed: true, models: [
    { id: '', label: 'Default', efforts: ['medium', 'high'], default_effort: 'medium' },
    { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high'], default_effort: 'medium' },
  ] },
  { id: 'codex', label: 'Codex', installed: false, models: [{ id: '', label: 'Default' }] },
]);
/** `fleet spawn --json`'s success object, and `fleet trust --list` with no Trust prompt. */
const spawned = (host: string) => JSON.stringify({ ok: true, backend: 'tmux', tmux_session: host, handle: '%12', harness: 'claude' });
const NO_TRUST = JSON.stringify({ ok: true, prompt: null, answerable: false, detail: 'no_prompt' });
const TRUST = JSON.stringify({
  ok: true, answerable: true, detail: null,
  prompt: { kind: 'trust', harness: 'claude', id: 't1.9f2c01aa', lines: ['Accessing workspace:', '/Users/me/Projects/reports'], untouched: true },
});

/** New Bot's fields: a weekly report, Mondays at 07:30. */
const input = (over: Record<string, unknown> = {}): BotInput =>
  ({ name: 'Tide tables', prompt: '/tide-tables for last week, as a page', harness: 'claude', model: '', directory: '~/Projects/reports', schedule: { days: ['mon'], time: '07:30' }, ...over }) as BotInput;
const EVERY_DAY = { days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], time: '07:30' };

/** The nth run's Session as Fleet lists it: `sess-<n>`, in the Session host the nth start made. */
const session = (n = 1, over: Partial<SessionRow> = {}): SessionRow => ({
  id: `sess-${n}`, pid: 500 + n, harness: 'claude', title: 'Tide tables · Nov 23', status: 'busy', waitingFor: null, statusSince: null, contextPct: null,
  cwd: '/Users/me/Projects/reports', git: null, locationShown: { repo: true, where: false }, backend: 'tmux', controllable: true, ownHost: true, model: null,
  effort: null, memoryGrowthBytes: null, subagents: null, activity: null, backgroundShell: false, procStart: '2026-11-23T06:30:00Z', pendingModel: null,
  pendingEffort: null, modelAt: null, done: null, viewedAt: null, ...over,
});
const idle = (n = 1, over: Partial<SessionRow> = {}) => session(n, { status: 'idle', ...over });
const done = (n = 1, over: Partial<SessionRow> = {}) => idle(n, { done: { at: 1, note: 'Tide tables written' }, ...over });

const output = (over: Partial<OutputItem> = {}): OutputItem => ({
  kind: 'file', key: '/Users/me/Projects/reports/tides-47.html', type: 'html', title: 'Tide tables, week 47', path: '/Users/me/Projects/reports/tides-47.html', url: null,
  display: '~/Projects/reports/tides-47.html', projectPath: '/Users/me/Projects/reports', repo: 'reports', createdAt: 1, updatedAt: 2, events: 1, exists: true, source: null,
  sourcePath: null, sourceDisplay: null, version: null, sessions: [], ...over,
});
const page = (items: OutputItem[]): LibraryPage => ({ state: 'ok', items, readId: 'read-1', total: items.length, nextPage: 2, hasMore: false, projects: [], hiddenGone: 0, unfilteredEmpty: items.length === 0 });
const reply = (text: string, cursor = 'c9'): ChatEntry => ({ kind: 'assistant', cursor, ts: null, text, final: true });
const PAST: HistoryItem = {
  sessionId: 'sess-1', harness: 'claude', headless: false, title: 'Tide tables · Nov 23', projectPath: '/Users/me/Projects/reports', projectDisplay: '~/Projects/reports',
  repo: 'reports', branch: null, lastActiveAt: 1, snippet: null, firstPrompt: null, blocked: null,
};

/** What a call threw, for a refusal's status, words and field. */
const thrown = (call: () => unknown): unknown => {
  try {
    call();
  } catch (err) {
    return err;
  }
  return null;
};
/** Lets what the fakes answered be acted on (they answer without waiting on anything). */
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

const dirs: string[] = [];
const stops: (() => void)[] = [];
/** BOT-2.6: the Lookout servers that are running, by process id. */
const servers = new Set<number>();
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  servers.clear();
  vi.useRealTimers();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * The Bots over the real launcher, whose `fleet` is a fake runner (nothing is ever started), with a
 * clock and a timer the test moves by hand, a store under a temporary home, and fakes for Fleet's
 * list, the Library, the chat's reader, History and End Session.
 */
function world(over: { dir?: string; now?: number; settings?: Partial<Settings>; history?: boolean; pid?: number; file?: string; mayOwn?: boolean; bootedAt?: number } = {}) {
  const dir = over.dir ?? mkdtempSync(join(tmpdir(), 'lookout-bots-'));
  if (!over.dir) dirs.push(dir);
  const path = join(dir, '.lookout', over.file ?? 'bots.json');
  // One server, restarted, unless a test says another one runs beside it (BOT-2.6).
  const pid = over.pid ?? 7001;
  servers.add(pid);
  let now = over.now ?? at(23, 7);
  let settings: Settings = { ...defaultSettings(), startDirectories: ['~/Projects/reports'], ...over.settings };
  let spawns = 0;
  const w = {
    dir, path,
    /** What `fleet spawn` and `fleet trust --list` answer. */
    spawn: null as (() => Promise<string>) | null,
    trust: NO_TRUST,
    harnesses: HARNESS_JSON,
    /** What the Library, the chat's reader, History and End Session answer. */
    outputs: [] as OutputItem[],
    library: null as (() => Promise<LibraryPage>) | null,
    /** PEOPLE-2.5: files under this folder are private; none while null. */
    privatePrefix: null as string | null,
    entries: [] as ChatEntry[],
    history: (async () => PAST) as (id: string) => Promise<HistoryItem>,
    latestFails: false,
    endFails: null as Error | null,
    /** BOT-4.6: the Session as the end's own fresh list shows it; the last list's row when null. */
    fresh: null as SessionRow | null,
    viewedNow: null as number | null,
    /** The order a finish read the reply and the Outputs and ended the Session in. */
    order: [] as string[],
    /** BOT-2.6: set while this server watches the store's file as a second one; calling it says the file changed. */
    storeChanged: null as (() => void) | null,
    spawnArgs: [] as (readonly string[])[],
    finds: [] as LibraryQuery[],
    latest: [] as string[],
    ended: [] as { id: string; target: EndTarget }[],
    watches: 0,
    snapshots: [] as BotsSnapshot[],
    logs: [] as string[],
    timers: [] as { tick: () => void; ms: number }[],
    cleared: [] as unknown[],
    rows: new Map<string, SessionRow>(),
    update: vi.fn(async (patch: Partial<Settings>) => (settings = { ...settings, ...patch })),
    settings: (patch: Partial<Settings>) => void (settings = { ...settings, ...patch }),
    to: (time: number) => void (now = time),
    go: (ms: number) => void (now += ms),
    now: () => now,
  };
  const runner = vi.fn(async (file: string, args: readonly string[]) => {
    if (args.includes('harness')) return w.harnesses;
    if (args.includes('spawn')) {
      w.spawnArgs.push(args);
      return w.spawn ? w.spawn() : spawned(`host-${++spawns}`);
    }
    if (args.includes('trust')) return w.trust;
    if (file === 'tmux') return 'Welcome\n';
    throw new Error(`unexpected ${file} ${args.join(' ')}`);
  });
  const launcher: Launcher = new Launcher({
    runner, fleetBin: () => '/fake/fleet', settings: { get: () => settings, update: w.update }, env: { PATH: '/usr/bin', HOME: '/Users/me' }, now: () => now, timeoutMs: 15_000,
    onChange: (launches, started) => bots.launches(launches, started),
  });
  const bots: Bots = new Bots({
    path, home: dir, launcher, now: () => now,
    monitor: { watch: () => (w.watches++, () => void w.watches--), get: (id) => w.rows.get(id) ?? null },
    library: { find: async (q) => (w.finds.push(q), w.order.push('outputs'), w.library ? w.library() : page(w.outputs)), isPrivate: async (path) => w.privatePrefix !== null && path.startsWith(w.privatePrefix) },
    latest: async (id) => {
      w.latest.push(id);
      w.order.push('reply');
      if (w.latestFails) throw new Error("Couldn't read the chat");
      return { entries: w.entries, before: null };
    },
    end: async (id, target, only) => {
      w.order.push('end');
      // End Session reads Fleet's list once more, and the end is asked about that row (BOT-4.6).
      const fresh = w.fresh ?? w.rows.get(id);
      if (fresh && !only(fresh)) throw new EndError(409, 'This Session is in use again; nothing was closed.');
      if (w.endFails) throw w.endFails;
      w.ended.push({ id, target });
      return { how: 'exit' };
    },
    ...(over.history === false ? {} : { history: { lookup: (id: string) => w.history(id) } }),
    viewedAt: () => w.viewedNow,
    onChange: (s) => void w.snapshots.push(s),
    timer: { set: (tick, ms) => w.timers.push({ tick, ms }), clear: (handle) => void w.cleared.push(handle) },
    pid,
    ...(over.mayOwn === undefined ? {} : { mayOwn: over.mayOwn }),
    alive: (p) => servers.has(p),
    ...(over.bootedAt === undefined ? {} : { bootedAt: () => over.bootedAt! }),
    watchStore: (_path, changed) => ((w.storeChanged = changed), () => void (w.storeChanged = null)),
    log: (line) => void w.logs.push(line),
  });
  stops.push(() => (bots.stop(), launcher.stop()));
  bots.start();
  /** Fleet's list as of now: the launcher hears of its starts first, then the Bots follow their runs, as `main.ts` wires them. */
  const live = (...rows: SessionRow[]) => {
    w.rows = new Map(rows.map((r) => [r.id, r]));
    launcher.observe(rows.map((r): FleetRow => ({
      pid: r.pid, session_id: r.id.includes(':') ? null : r.id, cwd: r.cwd, status: r.status, waiting_for: null, updated_at: 1, backend: 'tmux',
      display_title: r.title, context: null, harness: r.harness, model: null, tmux_session: `host-${r.pid - 500}`,
    })));
    bots.observe(rows);
  };
  return Object.assign(w, {
    bots, launcher, live,
    bot: (fields: Record<string, unknown> = {}) => bots.create(input(fields)),
    runs: () => bots.snapshot().runs,
    run: () => bots.snapshot().runs[0]!,
    view: (id: string) => bots.snapshot().bots.find((b) => b.id === id)!,
    stored: () => JSON.parse(readFileSync(path, 'utf8')) as { version: number; bots: Record<string, unknown>[]; runs: Record<string, unknown>[] },
    /** One look of the schedule, and its starts answered. */
    look: async () => {
      bots.tick();
      await bots.settled();
    },
    /** Run now, its Session reported by Fleet as `rows` (Busy without any). */
    running: async (botId: string, n = 1, ...rows: SessionRow[]) => {
      const run = await bots.runNow(botId);
      live(...(rows.length ? rows : [session(n)]));
      return run;
    },
  });
}

describe('making, changing and deleting a Bot', () => {
  it('BOT-2.2: a saved Bot is checked as a start is, and its name, prompt and schedule by their own rules; a refusal names its field', async () => {
    const w = world();
    const refused = async (fields: Record<string, unknown>, field: string) => {
      const err = await w.bot(fields).catch((e: unknown) => e);
      expect(err, field).toBeInstanceOf(BotsError);
      expect(err, field).toMatchObject({ status: 400, field });
    };
    await refused({ name: '   ' }, 'name');
    await refused({ name: 'x'.repeat(65) }, 'name');
    await refused({ name: 'Two\nlines' }, 'name');
    await refused({ prompt: ' \n ' }, 'prompt');
    await refused({ prompt: 'x'.repeat(20_001) }, 'prompt');
    await refused({ schedule: { days: [], time: '07:30' } }, 'schedule');
    await refused({ schedule: { days: ['mon'], time: '7:30' } }, 'schedule');
    // The launcher's own rules (LAUNCH-2.1, LAUNCH-3.1 to 3.5), with its words.
    await refused({ directory: '/etc' }, 'directory');
    await refused({ harness: 'codex' }, 'harness');
    await refused({ harness: 'pi' }, 'harness');
    await refused({ model: 'gpt-9' }, 'model');
    await refused({ effort: 'max' }, 'effort');
    await refused({ skipPermissions: 'yes' }, 'skipPermissions');
    await refused({ on: 'yes' }, 'on');
    await expect(w.bot({ directory: '/etc' })).rejects.toMatchObject({ message: 'Pick one of the start directories from Settings.' });
    expect(w.runs()).toEqual([]);
    expect(w.bots.snapshot().bots).toEqual([]);
    expect(existsSync(w.path)).toBe(false);

    const bot = await w.bot({ name: '  Tide tables ', prompt: 'One\r\nTwo', effort: 'high', skipPermissions: true, schedule: { days: ['wed', 'mon', 'mon'], time: '07:30' } });
    expect(bot).toMatchObject({
      name: 'Tide tables', prompt: 'One\nTwo', harness: 'claude', model: '', effort: 'high', skipPermissions: true, directory: '~/Projects/reports',
      schedule: { days: ['mon', 'wed'], time: '07:30' }, on: true, since: at(23, 7), skipped: 0, createdAt: at(23, 7), updatedAt: at(23, 7), running: null,
    });
    // A name of 64 characters and a prompt of 20,000 are the most; no Effort is null, and only by hand is no schedule.
    expect(await w.bot({ name: 'n'.repeat(64), prompt: 'p'.repeat(20_000), effort: null, schedule: null })).toMatchObject({ effort: null, schedule: null, skipPermissions: false });
    // A change is checked the same way, and only what is sent is changed.
    await expect(w.bots.update(bot.id, { model: 'gpt-9' })).rejects.toMatchObject({ status: 400, field: 'model' });
    await expect(w.bots.update(bot.id, { name: '' })).rejects.toMatchObject({ status: 400, field: 'name' });
    expect(await w.bots.update(bot.id, { model: 'claude-opus-5-5' })).toMatchObject({ name: 'Tide tables', model: 'claude-opus-5-5', effort: 'high', skipPermissions: true });
    await expect(w.bots.update('00000000-0000-4000-8000-000000000000', { on: false })).rejects.toMatchObject({ status: 404 });
    // Nothing was started by any of it.
    expect(w.spawnArgs).toEqual([]);
  });

  it('BOT-2.3: Bots are kept in ~/.lookout/bots.json, written whole with mode 0600, survive a restart, and every change is sent as the whole set', async () => {
    const w = world();
    expect(w.bots.snapshot()).toEqual({ state: 'ok', path: '~/.lookout/bots.json', error: null, bots: [], runs: [] });
    const bot = await w.bot();
    expect(w.snapshots.at(-1)!.bots).toEqual([expect.objectContaining({ id: bot.id, name: 'Tide tables' })]);
    expect(w.stored()).toEqual({ version: 1, bots: [expect.objectContaining({ id: bot.id, name: 'Tide tables', since: at(23, 7) })], runs: [] });
    expect(statSync(w.path).mode & 0o777).toBe(0o600);
    // Renamed into place: no temporary file is left beside it, only the store's lock (BOT-2.6).
    expect(readdirSync(dirname(w.path)).sort()).toEqual(['bots.json', 'bots.lock']);
    const sent = w.snapshots.length;
    await w.bots.update(bot.id, { name: 'Tides' });
    w.bots.remove((await w.bot({ name: 'Flaky lanterns' })).id);
    expect(w.snapshots.length).toBe(sent + 3);

    const again = world({ dir: w.dir });
    expect(again.bots.snapshot()).toMatchObject({ state: 'ok', bots: [{ id: bot.id, name: 'Tides', schedule: { days: ['mon'], time: '07:30' }, on: true }] });
    expect(again.snapshots.at(-1)!.bots).toHaveLength(1);
  });

  it("BOT-2.3: a file that can't be read leaves the tab saying so with its path, refuses every write and is never overwritten; a missing file is an empty store", async () => {
    const seed = world();
    const bot = await seed.bot({ schedule: EVERY_DAY });
    const run = await seed.running(bot.id);
    const good = readFileSync(seed.path, 'utf8');
    for (const [text, why] of [
      ['{ "version": 1, "bots": [', /JSON/],
      [JSON.stringify({ version: 2, bots: [], runs: [] }), /newer Lookout/],
      [JSON.stringify({ version: 1, bots: [{ id: 'b1', name: 'No prompt' }], runs: [] }), /Bots/],
      ['[]', /store/],
    ] as const) {
      writeFileSync(seed.path, text);
      const w = world({ dir: seed.dir, now: at(24, 9) });
      expect(w.bots.snapshot()).toEqual({ state: 'unreadable', path: '~/.lookout/bots.json', error: expect.stringMatching(why), bots: [], runs: [] });
      expect(w.snapshots.at(-1)!.state).toBe('unreadable');
      await expect(w.bot()).rejects.toMatchObject({ status: 503, message: expect.stringContaining('~/.lookout/bots.json') });
      await expect(w.bots.update(bot.id, { on: false })).rejects.toMatchObject({ status: 503 });
      await expect(w.bots.runNow(bot.id)).rejects.toMatchObject({ status: 503 });
      expect(thrown(() => w.bots.remove(bot.id))).toMatchObject({ status: 503 });
      expect(thrown(() => w.bots.mark(run.id, { read: true }))).toMatchObject({ status: 503 });
      // Lookout keeps running: a look starts nothing and reads no list of Fleet's.
      await w.look();
      w.live();
      expect(w.spawnArgs).toEqual([]);
      expect(w.watches).toBe(0);
      expect(readFileSync(seed.path, 'utf8')).toBe(text);
    }
    // Put right, it's read again at the next look, without a restart.
    writeFileSync(seed.path, '{');
    const w = world({ dir: seed.dir, now: at(23, 7, 10) });
    writeFileSync(seed.path, good);
    await w.look();
    expect(w.bots.snapshot()).toMatchObject({ state: 'ok', error: null, bots: [{ id: bot.id }], runs: [{ id: run.id }] });
    expect(w.snapshots.at(-1)!.state).toBe('ok');

    const none = world();
    expect(none.bots.snapshot()).toMatchObject({ state: 'ok', bots: [], runs: [] });
    expect(existsSync(none.path)).toBe(false);
  });

  it('BOT-2.2: changes to one Bot are checked one at a time, each against the Bot as the one before left it', async () => {
    const w = world();
    // A model that takes only its own Effort.
    w.harnesses = JSON.stringify([{ id: 'claude', label: 'Claude Code', installed: true, models: [
      { id: '', label: 'Default', efforts: ['medium', 'high'], default_effort: 'medium' },
      { id: 'claude-haiku-5-5', label: 'Haiku 5.5', efforts: ['low'], default_effort: 'low' },
    ] }]);
    const bot = await w.bot({ effort: 'high' });
    // Two tabs at once: each is fine against the Bot as it was, and together they are a pair nobody checked.
    const [model, effort] = await Promise.allSettled([
      w.bots.update(bot.id, { model: 'claude-haiku-5-5', effort: 'low' }),
      w.bots.update(bot.id, { effort: 'medium' }),
    ]);
    expect(model).toMatchObject({ status: 'fulfilled', value: { model: 'claude-haiku-5-5', effort: 'low' } });
    expect(effort).toMatchObject({ status: 'rejected', reason: { status: 400, field: 'effort' } });
    expect(w.view(bot.id)).toMatchObject({ model: 'claude-haiku-5-5', effort: 'low' });
    expect(w.stored().bots[0]).toMatchObject({ model: 'claude-haiku-5-5', effort: 'low' });
    // A refused change doesn't hold up the next one.
    expect(await w.bots.update(bot.id, { on: false })).toMatchObject({ on: false });
  });

  it("BOT-2.3: a file that stops being a store while the server runs is never written over: the next change is refused, the tab says so, and it's read again once put right", async () => {
    const w = world();
    const bot = await w.bot();
    const good = readFileSync(w.path, 'utf8');
    // Edited by hand, and broken, while Lookout runs.
    writeFileSync(w.path, '{ "version": 1, "bots": [');
    await expect(w.bot({ name: 'Goals check' })).rejects.toMatchObject({ status: 503, message: expect.stringContaining("can't read ~/.lookout/bots.json") });
    expect(readFileSync(w.path, 'utf8')).toBe('{ "version": 1, "bots": [');
    expect(w.bots.snapshot()).toMatchObject({ state: 'unreadable', error: "It isn't JSON.", bots: [], runs: [] });
    expect(w.snapshots.at(-1)!.state).toBe('unreadable');
    await expect(w.bots.runNow(bot.id)).rejects.toMatchObject({ status: 503 });
    expect(w.spawnArgs).toEqual([]);
    // Put right: the next look reads it, and changes are saved again.
    writeFileSync(w.path, good);
    await w.look();
    expect(w.bots.snapshot()).toMatchObject({ state: 'ok', bots: [{ id: bot.id }] });
    expect(await w.bot({ name: 'Goals check' })).toMatchObject({ name: 'Goals check' });
    expect(w.stored().bots).toHaveLength(2);
    // A file changed by hand that still reads is the server's to write: its own state stands.
    writeFileSync(w.path, JSON.stringify({ version: 1, bots: [], runs: [] }));
    await w.bots.update(bot.id, { on: false });
    expect(w.stored().bots.map((b) => b.name)).toEqual(['Tide tables', 'Goals check']);
  });

  it("BOT-2.4: a Bot with a run going can't be deleted; once it's over it can, and its Reports stay", async () => {
    const w = world();
    const bot = await w.bot();
    const run = await w.running(bot.id);
    expect(thrown(() => w.bots.remove(bot.id))).toMatchObject({ status: 409, message: expect.stringContaining('end its Session') });
    expect(w.bots.snapshot().bots).toHaveLength(1);
    w.live(done());
    await w.bots.settled();
    w.bots.remove(bot.id);
    expect(w.bots.snapshot().bots).toEqual([]);
    expect(w.runs()).toEqual([expect.objectContaining({ id: run.id, botId: bot.id, botName: 'Tide tables', state: 'finished', arrivedAt: expect.any(Number) })]);
    expect(w.stored().runs).toHaveLength(1);
    expect(thrown(() => w.bots.remove(bot.id))).toMatchObject({ status: 404 });
  });

  it('BOT-2.5: turning a Bot off stops its scheduled runs and nothing else; turning it on, or changing its schedule, never runs a time that passed (BOT-3.4)', async () => {
    const w = world();
    const bot = await w.bot({ schedule: EVERY_DAY });
    await w.running(bot.id);
    w.to(at(23, 7, 10));
    expect(await w.bots.update(bot.id, { on: false })).toMatchObject({ on: false, nextAt: null, since: at(23, 7), running: w.run().id });
    // The run that's going goes on, and is followed to its end.
    expect(w.run().state).toBe('running');
    w.live(done());
    await w.bots.settled();
    expect(w.run().state).toBe('finished');
    // Off: its times pass without a run.
    w.to(at(23, 7, 31));
    await w.look();
    w.to(at(24, 7, 31));
    await w.look();
    expect(w.runs()).toHaveLength(1);
    // Run now still works.
    expect(await w.bots.runNow(bot.id)).toMatchObject({ dueAt: null, state: 'starting' });
    w.live(done(2));
    await w.bots.settled();
    // Turned on a minute after Tuesday's time: that time is not run, the next one is.
    expect(await w.bots.update(bot.id, { on: true })).toMatchObject({ on: true, since: at(24, 7, 31), nextAt: at(25, 7, 30) });
    await w.look();
    expect(w.runs()).toHaveLength(2);
    // A schedule changed to a time that already passed today doesn't run it either.
    w.to(at(24, 12));
    expect(await w.bots.update(bot.id, { schedule: { ...EVERY_DAY, time: '11:00' } })).toMatchObject({ since: at(24, 12), nextAt: at(25, 11) });
    await w.look();
    expect(w.runs()).toHaveLength(2);
    w.to(at(25, 11));
    await w.look();
    expect(w.runs()).toHaveLength(3);
    expect(w.run()).toMatchObject({ dueAt: at(25, 11), lateMs: 0 });
  });
});

describe('one server runs the Bots', () => {
  it("BOT-2.6: the first server to start takes the store's lock; a second one on the same store starts no run, follows none, saves nothing, and refuses every change", async () => {
    const owner = world({ pid: 4101 });
    const lock = join(dirname(owner.path), 'bots.lock');
    expect(readFileSync(lock, 'utf8')).toBe('4101\n');
    expect(statSync(lock).mode & 0o777).toBe(0o600);
    expect(owner.bots.snapshot().state).toBe('ok');
    const bot = await owner.bot({ schedule: EVERY_DAY });
    const run = await owner.running(bot.id);

    // A `pnpm dev` beside the installed Lookout: it shows the Bots and Reports as the owner wrote them.
    const second = world({ dir: owner.dir, pid: 4202, now: at(23, 7, 10) });
    expect(second.bots.snapshot()).toMatchObject({
      state: 'read-only', path: '~/.lookout/bots.json', error: null,
      bots: [{ id: bot.id, name: 'Tide tables', running: run.id, nextAt: at(23, 7, 30) }], runs: [{ id: run.id, state: 'running', sessionId: 'sess-1' }],
    });
    expect(second.snapshots.at(-1)!.state).toBe('read-only');
    expect(readFileSync(lock, 'utf8')).toBe('4101\n');
    // Every change is refused with its words: a Bot made, changed or deleted, Run now, a Report's marks.
    const refusal = { status: 409, message: "Another Lookout on this Mac runs the Bots. Here they can't be changed." };
    expect(BOTS_READ_ONLY).toBe(refusal.message);
    await expect(second.bot()).rejects.toMatchObject(refusal);
    await expect(second.bots.update(bot.id, { on: false })).rejects.toMatchObject(refusal);
    await expect(second.bots.runNow(bot.id)).rejects.toMatchObject(refusal);
    expect(thrown(() => second.bots.remove(bot.id))).toMatchObject(refusal);
    expect(thrown(() => second.bots.mark(run.id, { read: true }))).toMatchObject(refusal);
    // It starts no run at a Bot's time, and follows none: nothing ended, Fleet's list not read, nothing saved.
    const written = readFileSync(owner.path, 'utf8');
    second.to(at(23, 7, 30));
    await second.look();
    second.live(done());
    second.live();
    await second.bots.settled();
    expect(second.spawnArgs).toEqual([]);
    expect(second.ended).toEqual([]);
    expect(second.watches).toBe(0);
    expect(second.run()).toMatchObject({ state: 'running', arrivedAt: null });
    // A Report is still read there, without a save.
    second.outputs = [output()];
    expect(await second.bots.detail(run.id)).toMatchObject({ run: { id: run.id }, outputs: [{ title: 'Tide tables, week 47' }], outputsError: null });
    expect(readFileSync(owner.path, 'utf8')).toBe(written);
    expect(readdirSync(dirname(owner.path)).sort()).toEqual(['bots.json', 'bots.lock']);

    // Read again when the file changes: the owner finishes the run, and every tab of the second server hears it once.
    owner.go(4 * MINUTE);
    owner.live(done());
    await owner.bots.settled();
    const sent = second.snapshots.length;
    second.storeChanged!();
    expect(second.run()).toMatchObject({ id: run.id, state: 'finished', session: 'ended', read: false });
    expect(second.snapshots.length).toBe(sent + 1);
    expect(second.snapshots.at(-1)).toMatchObject({ state: 'read-only', bots: [{ running: null }] });
    second.storeChanged!();
    expect(second.snapshots.length).toBe(sent + 1);
    // And at its 30 s look, should the file's change go unseen.
    owner.bots.mark(run.id, { read: true });
    await second.look();
    expect(second.run().read).toBe(true);
    expect(second.snapshots.length).toBe(sent + 2);
  });

  it("BOT-2.6: a lock whose process is gone is taken over; the server that takes it runs the Bots from there, and gives the lock up when it stops", async () => {
    const first = world({ pid: 4101 });
    const lock = join(dirname(first.path), 'bots.lock');
    const bot = await first.bot({ schedule: EVERY_DAY });
    await first.running(bot.id);
    await first.bots.runNow((await first.bot({ name: 'Flaky lanterns' })).id);
    const second = world({ dir: first.dir, pid: 4202, now: at(23, 7, 5) });
    expect(second.bots.snapshot().state).toBe('read-only');
    expect(second.storeChanged).not.toBeNull();
    // The owner is killed: its lock still names it, and the second server's next look takes it over.
    servers.delete(4101);
    expect(readFileSync(lock, 'utf8')).toBe('4101\n');
    await second.look();
    expect(readFileSync(lock, 'utf8')).toBe('4202\n');
    expect(second.bots.snapshot().state).toBe('ok');
    expect(second.snapshots.at(-1)!.state).toBe('ok');
    expect(second.storeChanged).toBeNull();
    // The runs left going are picked up as after a restart (BOT-4.5, BOT-4.7), and changes are saved again.
    expect(second.runs().map((r) => [r.botName, r.state, r.failure])).toEqual([['Flaky lanterns', 'failed', RUN_RESTARTED], ['Tide tables', 'running', null]]);
    expect(second.watches).toBe(1);
    expect(await second.bot({ name: 'Goals check' })).toMatchObject({ name: 'Goals check' });
    expect(second.stored().bots).toHaveLength(3);
    second.to(at(23, 7, 30));
    await second.look();
    expect(second.view(bot.id)).toMatchObject({ skipped: 1 });

    // A server started now is the second one. When the owner stops, its lock goes, and the next look takes it.
    const third = world({ dir: first.dir, pid: 4303, now: at(23, 8) });
    expect(third.bots.snapshot().state).toBe('read-only');
    second.bots.stop();
    expect(existsSync(lock)).toBe(false);
    await third.look();
    expect(readFileSync(lock, 'utf8')).toBe('4303\n');
    expect(third.bots.snapshot()).toMatchObject({ state: 'ok', bots: [{ name: 'Tide tables' }, { name: 'Flaky lanterns' }, { name: 'Goals check' }] });
    // A lock that names no process is nobody's.
    third.bots.stop();
    writeFileSync(lock, 'not a process id');
    const fourth = world({ dir: first.dir, pid: 4404 });
    expect(fourth.bots.snapshot().state).toBe('ok');
    expect(readFileSync(lock, 'utf8')).toBe('4404\n');
    // The killed server's own stop, should it come, leaves the new owner's lock alone.
    first.bots.stop();
    expect(readFileSync(lock, 'utf8')).toBe('4404\n');
  });

  it('BOT-2.6: a stale lock is replaced by one server at a time, so two servers that find it never both run the Bots', async () => {
    const first = world({ pid: 4101 });
    const lock = botsLockPath(first.path);
    const gate = `${lock}.taking`;
    const second = world({ dir: first.dir, pid: 4202 });
    servers.delete(4101);
    // Another server is replacing the stale lock right now: this one stands by, and writes nothing.
    writeFileSync(gate, '4303\n');
    await second.look();
    expect(second.bots.snapshot().state).toBe('read-only');
    expect(readFileSync(lock, 'utf8')).toBe('4101\n');
    expect(existsSync(gate)).toBe(true);
    // That server took it meanwhile: under the gate the lock is read again, and it's theirs.
    rmSync(gate);
    servers.add(4303);
    writeFileSync(lock, '4303\n');
    await second.look();
    expect(second.bots.snapshot().state).toBe('read-only');
    expect(readFileSync(lock, 'utf8')).toBe('4303\n');
    // A server that died while replacing it left its gate: 10 s old, it's cleared, and the look after takes the lock.
    servers.delete(4303);
    writeFileSync(gate, '4303\n');
    const old = new Date(Date.now() - 11_000);
    utimesSync(gate, old, old);
    await second.look();
    expect(existsSync(gate)).toBe(false);
    expect(second.bots.snapshot().state).toBe('read-only');
    await second.look();
    expect(second.bots.snapshot().state).toBe('ok');
    expect(readFileSync(lock, 'utf8')).toBe('4202\n');
    // Nothing is left beside the lock: it was written whole beside it and moved into place.
    expect(readdirSync(dirname(lock)).filter((f) => f !== 'bots.json')).toEqual(['bots.lock']);
    expect(second.logs).toEqual([]);
  });

  it('BOT-2.6: a lock from before this Mac last started is nobody’s, whatever process has its number now; so is one that names this server’s number from an earlier life', async () => {
    const first = world({ pid: 4101 });
    const lock = botsLockPath(first.path);
    await first.bot();
    // The Mac restarted without the server stopping: 4101 is some other process now, and still there.
    const after = world({ dir: first.dir, pid: 4202, bootedAt: Date.now() + 5 * MINUTE });
    expect(after.bots.snapshot()).toMatchObject({ state: 'ok', bots: [{ name: 'Tide tables' }] });
    expect(readFileSync(lock, 'utf8')).toBe('4202\n');
    // Without a restart of the Mac, the same lock is its owner's.
    const beside = world({ dir: first.dir, pid: 4303 });
    expect(beside.bots.snapshot().state).toBe('read-only');
    expect(readFileSync(lock, 'utf8')).toBe('4202\n');
    // A server that got the number the lock names never wrote it: it writes its own, so the lock's age is this server's.
    const longAgo = new Date(Date.now() - 60 * MINUTE);
    utimesSync(lock, longAgo, longAgo);
    const again = world({ dir: first.dir, pid: 4202 });
    expect(again.bots.snapshot().state).toBe('ok');
    expect(readFileSync(lock, 'utf8')).toBe('4202\n');
    expect(Date.now() - statSync(lock).mtimeMs).toBeLessThan(MINUTE);
  });

  it("BOT-2.6: a lock that can't be written leaves this server running no Bots, and the tab says why; once it can be, the next look takes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lookout-bots-'));
    dirs.push(dir);
    mkdirSync(join(dir, '.lookout'));
    chmodSync(join(dir, '.lookout'), 0o500);
    stops.push(() => chmodSync(join(dir, '.lookout'), 0o700));
    const w = world({ dir, pid: 4101 });
    const why = "Lookout couldn't write the lock beside ~/.lookout/bots.json (EACCES), so the Bots don't run.";
    expect(w.bots.snapshot()).toMatchObject({ state: 'read-only', error: why });
    await expect(w.bot()).rejects.toMatchObject({ status: 409, message: why });
    await w.look();
    expect(w.logs).toEqual(["lookout: bots: the store's lock couldn't be written (EACCES)"]);
    chmodSync(join(dir, '.lookout'), 0o700);
    await w.look();
    expect(w.bots.snapshot()).toMatchObject({ state: 'ok', error: null });
    expect(await w.bot()).toMatchObject({ name: 'Tide tables' });
  });

  it("BOT-2.6, BOT-4.6: a server that stopped while a run's reply and Outputs were read ends nothing and saves nothing: the run is the next server's to finish", async () => {
    const w = world();
    const bot = await w.bot();
    await w.running(bot.id);
    // The server is stopped while the Library is read.
    w.library = async () => (w.bots.stop(), page([]));
    w.live(done());
    await w.bots.settled();
    expect(w.ended).toEqual([]);
    expect(w.stored().runs[0]).toMatchObject({ state: 'running', arrivedAt: null });
    // The next server follows the run again, finishes it and ends its Session.
    const next = world({ dir: w.dir, now: at(23, 7, 10) });
    next.entries = [reply('Week 47 is written.')];
    next.live(done());
    await next.bots.settled();
    expect(next.run()).toMatchObject({ id: w.run().id, state: 'finished', session: 'ended', holds: { reply: true } });
    expect(next.ended).toHaveLength(1);
  });

  it('BOT-2.6: a server started for development never takes the default store’s lock, free or not, so it never runs those Bots', async () => {
    const dev = world({ pid: 4202, mayOwn: false });
    // The lock is free, and the installed Lookout isn't there: still not this one's.
    expect(dev.bots.snapshot().state).toBe('read-only');
    expect(existsSync(botsLockPath(dev.path))).toBe(false);
    await expect(dev.bot()).rejects.toMatchObject({ status: 409, message: BOTS_READ_ONLY });
    await dev.look();
    expect(dev.bots.snapshot().state).toBe('read-only');
    expect(existsSync(botsLockPath(dev.path))).toBe(false);
    // The installed one starts beside it and runs them; the development one shows what it wrote.
    const installed = world({ dir: dev.dir, pid: 4101 });
    expect(installed.bots.snapshot().state).toBe('ok');
    await installed.bot();
    dev.storeChanged?.();
    await dev.look();
    expect(dev.bots.snapshot()).toMatchObject({ state: 'read-only', bots: [{ name: 'Tide tables' }] });
    expect(dev.spawnArgs).toEqual([]);
    // Which server is which: `pnpm start` runs its own store's Bots; `pnpm dev` only a store that isn't the default one.
    const HOME = '/Users/me';
    const DEV = { HOME, LOOKOUT_DEV_ORIGINS: 'http://127.0.0.1:4748' };
    expect(mayRunBots({ HOME, NODE_ENV: 'production' })).toBe(true);
    expect(mayRunBots({ HOME })).toBe(false);
    expect(mayRunBots(DEV)).toBe(false);
    // `pnpm dev` from a shell that has NODE_ENV=production is still a development server.
    expect(mayRunBots({ ...DEV, NODE_ENV: 'production' })).toBe(false);
    // LOOKOUT_BOTS gives it a store of its own, unless it names the default one after all.
    expect(mayRunBots({ ...DEV, LOOKOUT_BOTS: '/Users/me/.lookout/bots-dev.json' })).toBe(true);
    expect(mayRunBots({ ...DEV, LOOKOUT_BOTS: '/Users/me/.lookout/bots.json' })).toBe(false);
    expect(mayRunBots({ ...DEV, LOOKOUT_BOTS: '/Users/me/.lookout/../.lookout/bots.json' })).toBe(false);
    expect(mayRunBots({ HOME, NODE_ENV: 'production', LOOKOUT_BOTS: '/Users/me/.lookout/bots.json' })).toBe(true);
  });

  it('BOT-2.6: LOOKOUT_BOTS names another store file, with its own lock, for a server that should run its own Bots', async () => {
    expect(defaultBotsPath({ HOME: '/Users/me' })).toBe('/Users/me/.lookout/bots.json');
    expect(defaultBotsPath({ HOME: '/Users/me', LOOKOUT_BOTS: '/Users/me/.lookout/bots-dev.json' })).toBe('/Users/me/.lookout/bots-dev.json');
    expect(botsLockPath('/Users/me/.lookout/bots.json')).toBe('/Users/me/.lookout/bots.lock');
    expect(botsLockPath('/Users/me/.lookout/bots-dev.json')).toBe('/Users/me/.lookout/bots-dev.lock');
    // Two servers, each with its own store in one folder: both run their own.
    const installed = world({ pid: 4101 });
    const dev = world({ dir: installed.dir, pid: 4202, file: 'bots-dev.json' });
    expect([installed.bots.snapshot().state, dev.bots.snapshot().state]).toEqual(['ok', 'ok']);
    await installed.bot();
    await dev.bot({ name: 'Flaky lanterns' });
    await dev.bots.runNow(dev.bots.snapshot().bots[0]!.id);
    expect(installed.bots.snapshot()).toMatchObject({ bots: [{ name: 'Tide tables' }], runs: [] });
    expect(dev.bots.snapshot()).toMatchObject({ path: '~/.lookout/bots-dev.json', bots: [{ name: 'Flaky lanterns' }], runs: [{ state: 'starting' }] });
    expect(readdirSync(dirname(installed.path)).sort()).toEqual(['bots-dev.json', 'bots-dev.lock', 'bots.json', 'bots.lock']);
    expect(readFileSync(join(dirname(installed.path), 'bots-dev.lock'), 'utf8')).toBe('4202\n');
  });
});

describe('the schedule', () => {
  it("BOT-3.2: the server looks every 30 seconds, with no tab connected, and starts a due Bot's run within a minute of its time", async () => {
    const w = world();
    // Its own timer, armed when the server starts: nothing here is a tab.
    expect(w.timers.map((t) => t.ms)).toEqual([BOT_TICK_MS]);
    const bot = await w.bot();
    const look = async () => {
      w.timers[0]!.tick();
      await w.bots.settled();
    };
    w.to(at(23, 7, 29, 45));
    await look();
    expect(w.runs()).toEqual([]);
    w.to(at(23, 7, 30, 15));
    await look();
    expect(w.runs()).toEqual([expect.objectContaining({ botId: bot.id, dueAt: at(23, 7, 30), startedAt: at(23, 7, 30, 15), lateMs: 0, state: 'starting' })]);
    expect(w.spawnArgs).toHaveLength(1);
    // Once: the next looks start nothing more for that time.
    w.to(at(23, 7, 30, 45));
    await look();
    expect(w.runs()).toHaveLength(1);
    // Stopped with the server: the timer is cleared, and a look does nothing.
    w.bots.stop();
    expect(w.cleared).toHaveLength(1);
  });

  it("BOT-3.3: times that passed while the server wasn't running are run once, on the first look after, and the run says how late it started", async () => {
    const before = world({ now: at(20, 18) });
    const bot = await before.bot({ schedule: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '07:30' } });
    before.bots.stop();
    // Back on Wednesday at 09:00: Monday's, Tuesday's and Wednesday's times passed.
    const w = world({ dir: before.dir, now: at(25, 9) });
    await w.bots.settled();
    expect(w.runs()).toEqual([expect.objectContaining({ botId: bot.id, dueAt: at(25, 7, 30), startedAt: at(25, 9), lateMs: 90 * MINUTE, state: 'starting' })]);
    w.live(done());
    await w.bots.settled();
    await w.look();
    expect(w.runs()).toHaveLength(1);
    // Within a minute of its time is on time; a look that comes later (the Mac slept) says by how much.
    w.to(at(26, 7, 30, 59));
    await w.look();
    expect(w.run()).toMatchObject({ dueAt: at(26, 7, 30), lateMs: 0 });
    w.live(done(2));
    await w.bots.settled();
    w.to(at(27, 7, 31, 1));
    await w.look();
    expect(w.run()).toMatchObject({ dueAt: at(27, 7, 30), lateMs: MINUTE + 1000 });
  });

  it("BOT-3.4: only times after the Bot was made, last turned on or last had its schedule changed are run, and only times after its last scheduled run's", async () => {
    const w = world({ now: at(23, 8) });
    // Made on Monday at 08:00: that morning's 07:30 is never run.
    const bot = await w.bot();
    w.to(at(23, 9));
    await w.look();
    expect(w.runs()).toEqual([]);
    w.to(at(30, 7, 30));
    await w.look();
    expect(w.runs()).toEqual([expect.objectContaining({ dueAt: at(30, 7, 30) })]);
    w.live(done());
    await w.bots.settled();
    // Its last scheduled run was for this very time: later looks don't run it again, even after a restart.
    w.to(at(30, 12));
    await w.look();
    const again = world({ dir: w.dir, now: at(30, 13) });
    await again.bots.settled();
    expect(again.runs()).toHaveLength(1);
    // A run by hand has no time: it moves nothing.
    await again.bots.runNow(bot.id);
    again.live(done());
    await again.bots.settled();
    expect(again.view(bot.id)).toMatchObject({ since: at(23, 8) });
    expect(again.runs().map((r) => r.dueAt)).toEqual([null, at(30, 7, 30)]);
  });

  it("BOT-3.4: a time whose run was dropped with the oldest runs (BOT-4.8) is still never run again", async () => {
    const seed = world({ now: at(16, 8) });
    const bot = await seed.bot();
    seed.bots.stop();
    // Its Monday run, and 499 runs by hand since.
    const past = (n: number, over: Record<string, unknown>) => ({ id: `run-${n}`, botId: bot.id, botName: 'Tide tables', name: 'Tide tables · Nov 23', state: 'finished', harness: 'claude', startedAt: at(23, 7, 30) + n, endedAt: at(23, 7, 31) + n, ...over });
    writeFileSync(seed.path, JSON.stringify({ ...seed.stored(), runs: [past(0, { dueAt: at(23, 7, 30) }), ...Array.from({ length: BOT_RUNS_MAX - 1 }, (_, n) => past(n + 1, { dueAt: null }))] }));
    const w = world({ dir: seed.dir, now: at(23, 20) });
    await w.bots.settled();
    expect(w.runs()).toHaveLength(BOT_RUNS_MAX);
    // One more run drops the Monday one; its time stays run.
    await w.bots.runNow(bot.id);
    w.live(done());
    await w.bots.settled();
    expect(w.runs().map((r) => r.id)).not.toContain('run-0');
    await w.look();
    expect(w.runs().filter((r) => r.dueAt !== null)).toEqual([]);
    expect(w.view(bot.id)).toMatchObject({ since: at(23, 7, 30), nextAt: at(30, 7, 30) });
  });

  it("BOT-3.5: a time that comes while the Bot's own run is going is skipped, not queued, and counted until its next run starts", async () => {
    const w = world();
    const bot = await w.bot({ schedule: EVERY_DAY });
    w.to(at(23, 7, 30));
    await w.look();
    w.live(session());
    // Still going on Tuesday at its time: skipped once, however many looks see it.
    w.to(at(24, 7, 30));
    await w.look();
    w.go(30_000);
    await w.look();
    expect(w.runs()).toHaveLength(1);
    expect(w.view(bot.id)).toMatchObject({ skipped: 1, nextAt: at(25, 7, 30), running: w.run().id });
    expect(w.stored().bots[0]).toMatchObject({ skipped: 1 });
    // It finishes later that morning: the skipped time doesn't run after all.
    w.to(at(24, 8));
    w.live(done());
    await w.bots.settled();
    await w.look();
    expect(w.runs()).toHaveLength(1);
    expect(w.view(bot.id)).toMatchObject({ skipped: 1, running: null });
    // The next time stands, and its run clears the count.
    w.to(at(25, 7, 30));
    await w.look();
    expect(w.runs()).toHaveLength(2);
    expect(w.run()).toMatchObject({ dueAt: at(25, 7, 30) });
    expect(w.view(bot.id)).toMatchObject({ skipped: 0 });
  });

  it("BOT-3.5: a time that came during a run that was over by the next look is skipped too, not run late", async () => {
    const w = world({ now: at(23, 7, 29, 50) });
    const bot = await w.bot({ schedule: EVERY_DAY });
    // Run by hand ten seconds before its time, and over ten seconds after it, between two looks.
    await w.running(bot.id);
    await w.look();
    w.to(at(23, 7, 30, 10));
    w.live();
    await w.bots.settled();
    expect(w.run()).toMatchObject({ state: 'failed', failure: RUN_ENDED_EARLY });
    w.to(at(23, 7, 30, 20));
    await w.look();
    expect(w.runs()).toHaveLength(1);
    expect(w.spawnArgs).toHaveLength(1);
    expect(w.view(bot.id)).toMatchObject({ skipped: 1, running: null, nextAt: at(24, 7, 30) });
    // A run that was over before the time came doesn't skip it.
    const early = world({ now: at(23, 7, 20) });
    const other = await early.bot({ schedule: EVERY_DAY });
    await early.running(other.id);
    early.to(at(23, 7, 25));
    early.live();
    await early.bots.settled();
    early.to(at(23, 7, 30));
    await early.look();
    expect(early.runs().map((r) => r.dueAt)).toEqual([at(23, 7, 30), null]);
  });

  it('BOT-3.6: a Bot\'s next time is the next one its schedule gives after now; a Bot that is off, or only by hand, has none', async () => {
    const w = world();
    const weekly = await w.bot();
    const byHand = await w.bot({ name: 'Goals check', schedule: null });
    const off = await w.bot({ name: 'Flaky lanterns', schedule: EVERY_DAY, on: false });
    expect(weekly.nextAt).toBe(at(23, 7, 30));
    expect(byHand.nextAt).toBeNull();
    expect(off).toMatchObject({ on: false, nextAt: null });
    w.to(at(23, 7, 30));
    expect(w.view(weekly.id).nextAt).toBe(at(30, 7, 30));
    expect((await w.bots.update(off.id, { on: true })).nextAt).toBe(at(24, 7, 30));
  });
});

describe('a run', () => {
  it("BOT-4.1: a run starts a Session as the launcher does, with the Bot's choices, named after the Bot and the day, and changes nothing the launcher remembers", async () => {
    const w = world();
    const bot = await w.bot({ model: 'claude-opus-5-5', effort: 'high', skipPermissions: true });
    const run = await w.bots.runNow(bot.id);
    expect(w.spawnArgs).toEqual([[
      '--local', 'spawn', '--json', '--backend', 'tmux', '--harness', 'claude', '--dir', join(homedir(), 'Projects/reports'), '--model', 'claude-opus-5-5',
      '--effort', 'high', '--skip-permissions', '--name', 'Tide tables · Nov 23', '--', '/tide-tables for last week, as a page',
    ]]);
    expect(run).toMatchObject({ botId: bot.id, botName: 'Tide tables', name: 'Tide tables · Nov 23', title: 'Tide tables · Nov 23', harness: 'claude', state: 'starting', sessionId: null, dueAt: null, lateMs: 0 });
    // LAUNCH-1.2: nothing the launcher remembers changed.
    expect(w.update).not.toHaveBeenCalled();
    // LAUNCH-4.2: its "Starting…" row is the launcher's, under the run's own launch id, and then its Session.
    expect(w.launcher.list()).toEqual([expect.objectContaining({ id: w.stored().runs[0]!.launchId, title: 'Tide tables · Nov 23', state: 'starting' })]);
    w.live(session());
    expect(w.launcher.list()).toEqual([]);
    expect(w.run()).toMatchObject({ state: 'running', sessionId: 'sess-1' });
  });

  it('BOT-4.1: a Bot’s second run on one day adds its time to its name, and its seconds if it must, so each Session’s name is its own', async () => {
    const w = world({ now: at(23, 14, 5) });
    const bot = await w.bot({ schedule: null });
    const names: string[] = [];
    for (let n = 1; n <= 3; n++) {
      names.push((await w.running(bot.id, n)).name);
      // Its Session ends while Busy: the run is over, and the next one can start.
      w.live();
      await w.bots.settled();
    }
    expect(names).toEqual(['Tide tables · Nov 23', 'Tide tables · Nov 23 14:05', 'Tide tables · Nov 23 14:05:00']);
    expect(w.spawnArgs.map((args) => args[args.indexOf('--name') + 1])).toEqual(names);
    // Another Bot's runs, and another day's, don't count.
    const other = await w.bot({ name: 'Flaky lanterns', schedule: null });
    expect((await w.running(other.id, 4)).name).toBe('Flaky lanterns · Nov 23');
    w.live();
    await w.bots.settled();
    w.to(at(24, 9));
    expect((await w.running(bot.id, 5)).name).toBe('Tide tables · Nov 24');
    w.live();
    await w.bots.settled();
    // A long name gives way to the day and the time: the launcher takes 80 characters.
    const long = await w.bot({ name: 'L'.repeat(64), schedule: null });
    await w.running(long.id, 6);
    w.live();
    await w.bots.settled();
    await w.running(long.id, 7);
    w.live();
    await w.bots.settled();
    const third = (await w.running(long.id, 8)).name;
    expect(third).toBe(`${'L'.repeat(61)}… · Nov 24 09:00:00`);
    expect(third).toHaveLength(80);
  });

  it('BOT-4.1: two Bots with one name start Sessions with names of their own', async () => {
    const w = world();
    const first = await w.bot();
    const second = await w.bot({ prompt: 'the same name, another prompt' });
    await w.bots.runNow(first.id);
    await w.bots.runNow(second.id);
    expect(w.runs().map((r) => r.name).reverse()).toEqual(['Tide tables · Nov 23', 'Tide tables · Nov 23 07:00']);
    const name = (args: readonly string[]) => args[args.indexOf('--name') + 1];
    expect(w.spawnArgs.map(name)).toEqual(['Tide tables · Nov 23', 'Tide tables · Nov 23 07:00']);
    // A long name gives way to the time before it's compared, so two cut names never meet either.
    const long = world();
    const a = await long.bot({ name: 'n'.repeat(64) });
    const b = await long.bot({ name: 'n'.repeat(64) });
    await long.bots.runNow(a.id);
    await long.bots.runNow(b.id);
    await long.bots.runNow((await long.bot({ name: 'n'.repeat(64) })).id);
    const names = long.runs().map((r) => r.name);
    expect(new Set(names).size).toBe(3);
    expect(names.every((n) => n.length <= 80)).toBe(true);
  });

  it("BOT-3.4, BOT-4.1: a run the store can't keep isn't started: Fleet is never asked, and its time is still due at the next look", async () => {
    const w = world();
    const bot = await w.bot({ schedule: EVERY_DAY });
    const lookout = dirname(w.path);
    const before = readFileSync(w.path, 'utf8');
    chmodSync(lookout, 0o500);
    stops.push(() => chmodSync(lookout, 0o700));
    w.to(at(23, 7, 30));
    await w.look();
    expect(w.spawnArgs).toEqual([]);
    expect(w.runs()).toEqual([]);
    expect(w.view(bot.id)).toMatchObject({ running: null, skipped: 0 });
    expect(w.logs).toContain('lookout: bots: starting a run failed');
    // By hand it says so, and starts nothing.
    await expect(w.bots.runNow(bot.id)).rejects.toMatchObject({ status: 500, message: "Lookout couldn't save its Bots, so nothing was changed." });
    expect(w.spawnArgs).toEqual([]);
    expect(readFileSync(w.path, 'utf8')).toBe(before);
    // Once it can be kept, the time that passed is run, late.
    chmodSync(lookout, 0o700);
    w.to(at(23, 7, 33));
    await w.look();
    expect(w.spawnArgs).toHaveLength(1);
    expect(w.run()).toMatchObject({ dueAt: at(23, 7, 30), lateMs: 3 * MINUTE });
    expect(w.stored().runs).toHaveLength(1);
  });

  it("BOT-4.2: Run now starts a run at once, on or off, unless one of that Bot's runs is going", async () => {
    const w = world();
    const bot = await w.bot({ schedule: null, on: false });
    const other = await w.bot({ name: 'Flaky lanterns' });
    const run = await w.bots.runNow(bot.id);
    expect(run).toMatchObject({ dueAt: null, startedAt: at(23, 7), state: 'starting' });
    expect(w.view(bot.id).running).toBe(run.id);
    // Starting, running or waiting on you: it's running.
    await expect(w.bots.runNow(bot.id)).rejects.toMatchObject({ status: 409, message: RUNNING });
    w.live(session());
    await expect(w.bots.runNow(bot.id)).rejects.toMatchObject({ status: 409, message: "It's running" });
    w.live(session(1, { status: 'needs-you', waitingFor: 'permission: Bash(ls)' }));
    await expect(w.bots.runNow(bot.id)).rejects.toMatchObject({ status: 409 });
    expect(w.spawnArgs).toHaveLength(1);
    // Another Bot's run doesn't hold this one back.
    await w.bots.runNow(other.id);
    expect(w.spawnArgs).toHaveLength(2);
    w.live(done(), session(2));
    await w.bots.settled();
    expect((await w.bots.runNow(bot.id)).id).not.toBe(run.id);
    await expect(w.bots.runNow('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404 });
  });

  it('BOT-4.3: a run is starting until Fleet reports its Session, then running; waiting on you while its Session Needs you, and running again after', async () => {
    const w = world();
    const bot = await w.bot();
    await w.bots.runNow(bot.id);
    // Fleet's list without it yet: still starting.
    w.live(session(7, { id: 'someone-elses' }));
    expect(w.run()).toMatchObject({ state: 'starting', sessionId: null, waitingFor: null, arrivedAt: null });
    w.live(session());
    expect(w.run()).toMatchObject({ state: 'running', sessionId: 'sess-1', arrivedAt: null });
    w.go(MINUTE);
    w.live(session(1, { status: 'needs-you', waitingFor: 'permission: Bash(make tides)' }));
    expect(w.run()).toMatchObject({ state: 'waiting', waitingFor: 'permission: Bash(make tides)', arrivedAt: at(23, 7, 1), read: false });
    w.live(session());
    expect(w.run()).toMatchObject({ state: 'running', waitingFor: null });
    w.live(idle());
    expect(w.run()).toMatchObject({ state: 'running' });
    expect(w.snapshots.at(-1)!.runs[0]).toMatchObject({ state: 'running' });
  });

  it('BOT-4.3: a start that waits at its Trust prompt is waiting on you, starting again once it is answered, and running when Fleet reports its Session', async () => {
    const w = world();
    const bot = await w.bot();
    w.trust = TRUST;
    expect(await w.bots.runNow(bot.id)).toMatchObject({ state: 'waiting', waitingFor: WAITING_FOR_TRUST, sessionId: null, arrivedAt: at(23, 7), read: false });
    // Its start is named while it has no Session, so the tab can show where the prompt is answered.
    expect(w.run().launchId).toBe(w.launcher.list()[0]!.id);
    await expect(w.bots.runNow(bot.id)).rejects.toMatchObject({ status: 409 });
    // Nothing answers it for you: it waits, well past 15 s.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.run()).toMatchObject({ state: 'waiting' });
    // You accept it in the launcher's card: the prompt goes.
    w.trust = NO_TRUST;
    await w.launcher.readTrusts();
    expect(w.run()).toMatchObject({ state: 'starting', waitingFor: null });
    w.live(session());
    expect(w.run()).toMatchObject({ state: 'running', sessionId: 'sess-1', launchId: null });
  });

  it("BOT-4.4: the 2 minutes of a Done Session still At work count from Fleet's own mark, so a restart doesn't start them again", async () => {
    const before = world();
    const bot = await before.bot();
    await before.running(bot.id);
    const lingering = (saidDoneAt: number) => done(1, { backgroundShell: true, done: { at: saidDoneAt, note: null } });
    before.go(MINUTE);
    before.live(lingering(before.now()));
    before.bots.stop();
    // Back three minutes after it said Done, still At work: it has finished as it is.
    const w = world({ dir: before.dir, now: at(23, 7, 4) });
    w.live(lingering(at(23, 7, 1)));
    await w.bots.settled();
    expect(w.run()).toMatchObject({ state: 'finished', session: 'left' });
    // A mark from before the run started (a resumed Session's) counts from the run's start.
    const old = world();
    await old.running((await old.bot()).id);
    old.live(lingering(at(22, 18)));
    old.go(BOT_IDLE_DONE_MS - 1);
    old.live(lingering(at(22, 18)));
    await old.bots.settled();
    expect(old.run().state).toBe('running');
    old.go(1);
    old.live(lingering(at(22, 18)));
    await old.bots.settled();
    expect(old.run().state).toBe('finished');
  });

  it('BOT-4.4: a run has finished when its Session is Done, once it is at rest: its reply is whole and it is never ended At work', async () => {
    const w = world();
    const bot = await w.bot();
    await w.running(bot.id);
    // `fleet done` ran, and the Session is still writing its last reply.
    w.go(4 * MINUTE);
    w.live(session(1, { done: { at: w.now(), note: 'Tide tables written' } }));
    await w.bots.settled();
    expect(w.run()).toMatchObject({ state: 'running', endedAt: null });
    expect(w.ended).toEqual([]);
    // Done with a Subagent still running: At work, so not yet.
    w.live(done(1, { subagents: { running: 1, finished: 0 } }));
    await w.bots.settled();
    expect(w.run().state).toBe('running');
    w.go(5_000);
    w.live(done());
    await w.bots.settled();
    expect(w.run()).toMatchObject({ state: 'finished', endedAt: at(23, 7, 4, 5), failure: null, session: 'ended', arrivedAt: at(23, 7, 4, 5), read: false });
    expect(w.view(bot.id).running).toBeNull();
    // Done with a background shell command it never stops: after 2 minutes it has finished all the same, and its Session is left (BOT-4.6).
    const busy = world();
    const other = await busy.bot();
    await busy.running(other.id);
    const lingering = done(1, { backgroundShell: true });
    busy.live(lingering);
    busy.go(BOT_IDLE_DONE_MS - 1);
    busy.live(lingering);
    await busy.bots.settled();
    expect(busy.run().state).toBe('running');
    busy.go(1);
    busy.live(lingering);
    await busy.bots.settled();
    expect(busy.run()).toMatchObject({ state: 'finished', endedAt: at(23, 7, 2), session: 'left' });
    expect(busy.ended).toEqual([]);
  });

  it('BOT-4.4: a run has finished when its Session has been Idle and not At work for 2 minutes without a break', async () => {
    const w = world();
    const bot = await w.bot();
    await w.running(bot.id);
    w.go(MINUTE);
    w.live(idle());
    w.go(BOT_IDLE_DONE_MS - 1000);
    w.live(idle());
    await w.bots.settled();
    expect(w.run().state).toBe('running');
    // A break: Busy again, then Idle with a background shell command still running (At work).
    w.live(session());
    w.go(BOT_IDLE_DONE_MS);
    w.live(idle(1, { backgroundShell: true }));
    w.go(BOT_IDLE_DONE_MS);
    w.live(idle(1, { backgroundShell: true }));
    await w.bots.settled();
    expect(w.run().state).toBe('running');
    // At rest from here: two minutes on, it has finished, and took until it came to rest.
    w.go(1000);
    const rested = w.now();
    w.live(idle());
    w.go(BOT_IDLE_DONE_MS - 1);
    w.live(idle());
    await w.bots.settled();
    expect(w.run().state).toBe('running');
    w.go(1);
    w.live(idle());
    await w.bots.settled();
    expect(w.run()).toMatchObject({ state: 'finished', endedAt: rested, arrivedAt: rested + BOT_IDLE_DONE_MS, session: 'ended', failure: null });
    expect(w.ended).toHaveLength(1);
  });

  it('BOT-4.4, BOT-4.5: a Session that ended while Idle or Done finished its run; one that ended while Busy or Needing you failed it', async () => {
    const ending = async (...last: SessionRow[]) => {
      const w = world();
      const bot = await w.bot();
      await w.running(bot.id);
      for (const row of last) w.live(row);
      w.go(MINUTE);
      w.live();
      await w.bots.settled();
      // It's gone already: nothing is ended, and no chat is left to read.
      expect(w.ended).toEqual([]);
      expect(w.latest).toEqual([]);
      expect(w.run()).toMatchObject({ arrivedAt: at(23, 7, 1), read: false, session: null });
      expect(w.view(bot.id).running).toBeNull();
      return w.run();
    };
    // Idle since 07:00 when it went: it took until then.
    expect(await ending(idle())).toMatchObject({ state: 'finished', failure: null, endedAt: at(23, 7) });
    expect(await ending(session(1, { done: { at: 1, note: null } }))).toMatchObject({ state: 'finished', failure: null, endedAt: at(23, 7, 1) });
    expect(await ending(session())).toMatchObject({ state: 'failed', failure: RUN_ENDED_EARLY, endedAt: at(23, 7, 1) });
    expect(await ending(idle(), session(1, { status: 'needs-you', waitingFor: 'question: which week?' }))).toMatchObject({ state: 'failed', failure: 'Its Session ended before it finished', waitingFor: null });
  });

  it("BOT-4.5: a start the launcher refuses fails the run with the launcher's reason, and nothing retries it", async () => {
    const w = world();
    const bot = await w.bot({ schedule: EVERY_DAY });
    // The Start directory went from Settings since the Bot was saved.
    w.settings({ startDirectories: ['~/Projects/elsewhere'] });
    w.to(at(23, 7, 30));
    await w.look();
    expect(w.run()).toMatchObject({ state: 'failed', failure: 'Pick one of the start directories from Settings.', dueAt: at(23, 7, 30), sessionId: null, session: null, endedAt: at(23, 7, 30), arrivedAt: at(23, 7, 30), read: false, holds: { documents: 0, reply: false, first: null } });
    expect(w.spawnArgs).toEqual([]);
    expect(w.view(bot.id).running).toBeNull();
    // Nothing retries it: the looks after start nothing for that time.
    w.settings({ startDirectories: ['~/Projects/reports'] });
    w.go(30_000);
    await w.look();
    w.go(30_000);
    await w.look();
    expect(w.runs()).toHaveLength(1);
    expect(w.watches).toBe(0);
    // Fleet missing, and Fleet's own refusal, in the launcher's words.
    w.spawn = async () => {
      throw Object.assign(new Error('spawn fleet ENOENT'), { code: 'ENOENT' });
    };
    expect(await w.bots.runNow(bot.id)).toMatchObject({ state: 'failed', failure: "Fleet isn't installed." });
    w.spawn = async () => {
      throw Object.assign(new Error('exit 1'), { code: 1, stdout: JSON.stringify({ ok: false, kind: 'dir_missing', error: 'dir does not exist' }), stderr: 'error: dir does not exist\n' });
    };
    expect(await w.bots.runNow(bot.id)).toMatchObject({ state: 'failed', failure: "Couldn't start the Session: dir does not exist" });
    expect(w.launcher.list()).toEqual([]);
  });

  it("BOT-4.5: no Session after 15 s fails the run with the launcher's reason; a start that went away without one has failed too", async () => {
    const w = world();
    const bot = await w.bot();
    await w.bots.runNow(bot.id);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(w.run().state).toBe('starting');
    w.go(15_000);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(w.run()).toMatchObject({ state: 'failed', failure: expect.stringContaining("Fleet hasn't reported it after 15 s"), sessionId: null, endedAt: at(23, 7, 0, 15), arrivedAt: at(23, 7, 0, 15) });
    expect(w.run().failure).not.toMatch(/tmux/);
    // Reported after all, it's a Session like any other; the run stays failed, and the Bot can run again.
    w.live(session());
    expect(w.run()).toMatchObject({ state: 'failed', sessionId: null });
    expect(await w.bots.runNow(bot.id)).toMatchObject({ state: 'starting' });
    // Its Trust prompt's row dismissed: the start is gone, with no Session.
    const waits = world();
    waits.trust = TRUST;
    const other = await waits.bot();
    await waits.bots.runNow(other.id);
    expect(waits.launcher.dismiss(waits.launcher.list()[0]!.id)).toBe(true);
    expect(waits.run()).toMatchObject({ state: 'failed', failure: RUN_CANCELLED, waitingFor: null });
  });

  it("BOT-4.5, BOT-4.7: after a restart, a run that was starting has failed, and a running or waiting one is followed again from its Session's id", async () => {
    const before = world();
    const starting = await before.bot({ name: 'Flaky lanterns' });
    const running = await before.bot({ name: 'Tide tables' });
    const waiting = await before.bot({ name: 'Goals check' });
    await before.bots.runNow(running.id);
    await before.bots.runNow(waiting.id);
    before.live(session(1), session(2, { status: 'needs-you', waitingFor: 'question: which goals?' }));
    await before.bots.runNow(starting.id);
    expect(before.runs().map((r) => r.state)).toEqual(['starting', 'waiting', 'running']);
    before.bots.stop();
    expect(before.watches).toBe(0);

    const w = world({ dir: before.dir, now: at(23, 7, 20) });
    expect(w.runs().map((r) => [r.botName, r.state, r.failure])).toEqual([
      ['Flaky lanterns', 'failed', RUN_RESTARTED],
      ['Goals check', 'waiting', null],
      ['Tide tables', 'running', null],
    ]);
    expect(w.runs()[0]).toMatchObject({ failure: 'Lookout restarted while it was starting', endedAt: at(23, 7, 20), arrivedAt: at(23, 7, 20), read: false });
    expect(w.stored().runs.map((r) => r.state)).toEqual(['running', 'waiting', 'failed']);
    // Fleet's list is read again for the two still going, with no tab connected.
    expect(w.watches).toBe(1);
    w.live(done(1), session(2));
    await w.bots.settled();
    expect(w.runs().map((r) => r.state)).toEqual(['failed', 'running', 'finished']);
    expect(w.ended).toEqual([{ id: 'sess-1', target: { pid: 501, procStart: '2026-11-23T06:30:00Z' } }]);
    // The other one ends while Busy.
    w.live();
    await w.bots.settled();
    expect(w.runs()[1]).toMatchObject({ botName: 'Goals check', state: 'failed', failure: RUN_ENDED_EARLY });
    expect(w.watches).toBe(0);
    // Nothing was started by the restart.
    expect(w.spawnArgs).toEqual([]);
  });

  it("BOT-4.3: a Session that gets its session id after its first prompt (Codex) is followed by its process, not taken for one that ended", async () => {
    const w = world();
    const bot = await w.bot();
    await w.bots.runNow(bot.id);
    w.live(session(1, { id: 'claude:501' }));
    expect(w.run()).toMatchObject({ state: 'running', sessionId: 'claude:501' });
    w.live(session(1, { id: 'sess-late' }));
    await w.bots.settled();
    expect(w.run()).toMatchObject({ state: 'running', sessionId: 'sess-late', failure: null });
    // Another process under the same pid isn't it.
    w.live(session(1, { id: 'sess-other', procStart: '2026-11-23T09:00:00Z' }));
    await w.bots.settled();
    expect(w.run()).toMatchObject({ state: 'failed', failure: RUN_ENDED_EARLY, sessionId: 'sess-late' });
  });

  it("BOT-4.6: a finished run's Session, still live, is ended the way End Session does, with the process its row names, after its reply and Outputs are read", async () => {
    const w = world();
    const bot = await w.bot();
    await w.running(bot.id);
    w.entries = [reply('Week 47 is written.')];
    w.outputs = [output()];
    w.live(done());
    await w.bots.settled();
    expect(w.order).toEqual(['reply', 'outputs', 'end']);
    expect(w.ended).toEqual([{ id: 'sess-1', target: { pid: 501, procStart: '2026-11-23T06:30:00Z' } }]);
    expect(w.run()).toMatchObject({ state: 'finished', session: 'ended' });
    // Once: later lists end nothing more.
    w.live(done());
    w.live();
    await w.bots.settled();
    expect(w.ended).toHaveLength(1);
    expect(w.run()).toMatchObject({ state: 'finished', session: 'ended' });
  });

  it("BOT-4.6: a Session resumed under another process isn't the run's: the run ends as its own process did, and the resumed Session is never read or ended", async () => {
    // Its Session ended while Idle and was resumed from a terminal between two of Fleet's lists: the same id, another process.
    const resumed = (over: Partial<SessionRow> = {}) => done(1, { pid: 777, procStart: '2026-11-23T08:00:00Z', ...over });
    const w = world();
    await w.running((await w.bot()).id);
    w.live(idle());
    w.entries = [reply('Typed into the resumed Session')];
    w.live(resumed());
    await w.bots.settled();
    expect(w.run()).toMatchObject({ state: 'finished', failure: null, session: null, sessionId: 'sess-1', holds: { reply: false } });
    expect(w.latest).toEqual([]);
    expect(w.ended).toEqual([]);
    // Later lists of the resumed Session, Done and at rest, end nothing either.
    w.go(5 * MINUTE);
    w.live(resumed());
    await w.bots.settled();
    expect(w.ended).toEqual([]);

    // Its own process went while Busy: the run failed, whatever the resumed one says.
    const busy = world();
    await busy.running((await busy.bot()).id);
    busy.live(resumed());
    await busy.bots.settled();
    expect(busy.run()).toMatchObject({ state: 'failed', failure: RUN_ENDED_EARLY, session: null });
    expect(busy.ended).toEqual([]);

    // The same pid started at another time is another process too, and a restart of the server keeps the one it followed.
    const before = world();
    await before.running((await before.bot()).id);
    before.live(idle());
    before.bots.stop();
    const after = world({ dir: before.dir, now: at(23, 7, 20) });
    after.live(done(1, { procStart: '2026-11-23T07:10:00Z' }));
    await after.bots.settled();
    expect(after.run()).toMatchObject({ state: 'finished', session: null });
    expect(after.ended).toEqual([]);
  });

  it("BOT-4.6: a Session you opened after the run started is yours; one that Needs you or is At work is never ended; a failed end leaves it, with one log line without its name", async () => {
    const finishing = async (row: SessionRow, arrange: (w: ReturnType<typeof world>) => void = () => {}) => {
      const w = world();
      const bot = await w.bot();
      await w.running(bot.id);
      w.go(5 * MINUTE);
      arrange(w);
      w.live(row);
      await w.bots.settled();
      expect(w.run()).toMatchObject({ state: 'finished', failure: null });
      return w;
    };
    // Opened in Lookout after the run started (SIDE-13.1's record): it's yours.
    const yours = await finishing(done(1, { viewedAt: at(23, 7, 2) }));
    expect(yours.run().session).toBe('yours');
    expect(yours.ended).toEqual([]);
    // Opened since its row was last listed.
    const justNow = await finishing(done(), (w) => (w.viewedNow = at(23, 7, 4)));
    expect(justNow.run().session).toBe('yours');
    expect(justNow.ended).toEqual([]);
    // Seen only before the run started (a resumed Session, say): Lookout ends it.
    const before = await finishing(done(1, { viewedAt: at(23, 6, 59) }));
    expect(before.run().session).toBe('ended');
    // Prompted again while its reply and Outputs were read: it Needs you, or is At work, and is never ended.
    for (const now of [session(), session(1, { status: 'needs-you', waitingFor: 'input needed' }), idle(1, { subagents: { running: 2, finished: 1 } })]) {
      const w = await finishing(done(), (world) => (world.library = async () => (world.rows.set('sess-1', now), page([]))));
      expect(w.run().session).toBe('left');
      expect(w.ended).toEqual([]);
    }
    // Prompted, or opened, in the moment between the last list and the end: the end's own fresh list says so, and nothing is closed.
    for (const [fresh, kept] of [[session(), 'left'], [session(1, { status: 'needs-you' }), 'left'], [done(1, { viewedAt: at(23, 7, 4) }), 'yours']] as const) {
      const w = await finishing(done(), (world) => (world.fresh = fresh));
      expect(w.run().session).toBe(kept);
      expect(w.ended).toEqual([]);
      expect(w.logs).toEqual([]);
    }
    // The end fails (Fleet is typing into it, say): the run has still finished, and the Session stays.
    const failed = await finishing(done(1, { title: 'Tide tables · Nov 23' }), (w) => (w.endFails = new EndError(409, 'Fleet is typing into it; try again.')));
    expect(failed.run()).toMatchObject({ state: 'finished', session: 'left', arrivedAt: at(23, 7, 5) });
    expect(failed.logs).toEqual(["lookout: bots: ending a finished run's Session failed (409)"]);
    expect(failed.logs.join()).not.toMatch(/Tide|sess-1|reports/);
    // Ended by someone else meanwhile: there's nothing to end.
    const gone = await finishing(done(), (w) => (w.library = async () => (w.rows.clear(), page([]))));
    expect(gone.run().session).toBeNull();
    expect(gone.ended).toEqual([]);
  });

  it("BOT-4.7: the server follows a run with no tab connected, reading Fleet's list while any run is starting, running or waiting on you, and no longer", async () => {
    const w = world();
    const bot = await w.bot();
    const other = await w.bot({ name: 'Flaky lanterns' });
    expect(w.watches).toBe(0);
    await w.bots.runNow(bot.id);
    expect(w.watches).toBe(1);
    await w.bots.runNow(other.id);
    w.live(session(1, { status: 'needs-you', waitingFor: 'input needed' }), session(2));
    // One read however many runs are going.
    expect(w.watches).toBe(1);
    w.live(session(1, { status: 'needs-you', waitingFor: 'input needed' }), done(2));
    await w.bots.settled();
    expect(w.watches).toBe(1);
    w.live(done(1));
    await w.bots.settled();
    expect(w.runs().map((r) => r.state)).toEqual(['finished', 'finished']);
    expect(w.watches).toBe(0);
    // A run going when the server stops lets go of the list too.
    await w.bots.runNow(bot.id);
    expect(w.watches).toBe(1);
    w.bots.stop();
    expect(w.watches).toBe(0);
  });

  it('BOT-4.8: a run that finished, failed or began waiting on you arrives in the Inbox; the newest 500 runs are kept and older ones dropped', async () => {
    const seed = world();
    const bot = await seed.bot({ schedule: null });
    const old = (n: number) => ({ id: `run-${n}`, botId: bot.id, botName: 'Tide tables', name: `Tide tables · run ${n}`, startedAt: at(1, 0) + n * MINUTE, endedAt: at(1, 0) + n * MINUTE + 1000, state: 'finished', harness: 'claude', sessionId: `old-${n}`, read: true });
    const store = seed.stored();
    writeFileSync(seed.path, JSON.stringify({ ...store, runs: Array.from({ length: BOT_RUNS_MAX }, (_, n) => old(n + 1)) }));
    const w = world({ dir: seed.dir });
    expect(w.runs()).toHaveLength(BOT_RUNS_MAX);
    // Read from a file written by hand: a run that is over is a Report, arrived when it ended.
    expect(w.runs().at(-1)).toMatchObject({ id: 'run-1', arrivedAt: at(1, 0) + MINUTE + 1000, title: 'Tide tables · run 1', read: true, archived: false, holds: null });
    await w.running(bot.id);
    expect(w.runs()).toHaveLength(BOT_RUNS_MAX);
    expect(w.runs().map((r) => r.id)).not.toContain('run-1');
    expect(w.runs().at(-1)!.id).toBe('run-2');
    expect(w.stored().runs).toHaveLength(BOT_RUNS_MAX);
    // Not arrived while it runs; arrived, unread, when it has finished.
    expect(w.run()).toMatchObject({ state: 'running', arrivedAt: null });
    w.go(MINUTE);
    w.live(done());
    await w.bots.settled();
    expect(w.run()).toMatchObject({ state: 'finished', arrivedAt: at(23, 7, 1), read: false, archived: false });
    expect(w.snapshots.at(-1)!.runs[0]).toMatchObject({ state: 'finished', arrivedAt: at(23, 7, 1) });
  });
});

describe('Reports', () => {
  /** A Bot whose run has started and is listed by Fleet. */
  const started = async (over: Parameters<typeof world>[0] = {}) => {
    const w = world(over);
    const bot = await w.bot();
    const run = await w.running(bot.id);
    return Object.assign(w, { botId: bot.id, runId: run.id });
  };
  /** One whose run has finished, with what its Session produced. */
  const finished = async (outputs: OutputItem[] = [], entries: ChatEntry[] = []) => {
    const w = await started();
    w.outputs = outputs;
    w.entries = entries;
    w.go(4 * MINUTE);
    w.live(done());
    await w.bots.settled();
    return w;
  };

  it('INBOX-1.1: a run that was waiting on you and then finished arrives again: at the top, and unread again', async () => {
    const w = await started();
    w.go(MINUTE);
    w.live(session(1, { status: 'needs-you', waitingFor: 'permission: Bash(make tides)' }));
    expect(w.run()).toMatchObject({ state: 'waiting', arrivedAt: at(23, 7, 1), read: false, title: 'Tide tables · Nov 23', holds: null });
    // You read it, even archive it, and answer in its Session.
    w.bots.mark(w.runId, { archived: true });
    expect(w.run()).toMatchObject({ read: true, archived: true });
    w.go(MINUTE);
    w.live(session(1, { status: 'needs-you', waitingFor: 'permission: Bash(make tides)' }));
    expect(w.run()).toMatchObject({ arrivedAt: at(23, 7, 1), read: true });
    w.live(session());
    expect(w.run()).toMatchObject({ state: 'running', arrivedAt: at(23, 7, 1), read: true });
    w.go(3 * MINUTE);
    w.live(done());
    await w.bots.settled();
    expect(w.run()).toMatchObject({ state: 'finished', arrivedAt: at(23, 7, 5), read: false, archived: false });
    expect(w.stored().runs[0]).toMatchObject({ arrivedAt: at(23, 7, 5), read: false });
  });

  it("INBOX-1.2: a Report's title is that of the first document its run produced, else its run's name, and it says what it holds", async () => {
    const notes = output({ kind: 'artifact', key: 'https://claude.ai/artifact/tides', type: null, title: 'Tides, in short', path: null, url: 'https://claude.ai/artifact/tides', updatedAt: 1 });
    const w = await finished([output(), notes], [reply('Week 47 is written.')]);
    expect(w.run()).toMatchObject({ title: 'Tide tables, week 47', holds: { documents: 2, reply: true, first: { kind: 'file', type: 'html' } } });
    // The Library is asked for the Outputs this Session touched: every Type, gone ones too.
    expect(w.finds).toEqual([{ query: '', page: 1, headless: false, types: ['pages', 'pdf', 'markdown', 'image', 'share'], project: '', hideGone: false, sessions: ['claude:sess-1'] }]);
    expect((await finished([notes])).run()).toMatchObject({ title: 'Tides, in short', holds: { documents: 1, reply: false, first: { kind: 'artifact', type: null } } });
    expect((await finished([], [reply('Nothing to report.')])).run()).toMatchObject({ title: 'Tide tables · Nov 23', holds: { documents: 0, reply: true, first: null } });
    expect((await finished()).run()).toMatchObject({ title: 'Tide tables · Nov 23', holds: { documents: 0, reply: false, first: null } });
  });

  it("INBOX-2.3: reading a Report reads its Session's Outputs again from the Library, so a document published since shows", async () => {
    const w = await finished([output()], [reply('Week 47 is written.')]);
    const first = await w.bots.detail(w.runId);
    expect(first).toMatchObject({ run: { id: w.runId, state: 'finished', title: 'Tide tables, week 47' }, reply: 'Week 47 is written.', outputs: [{ title: 'Tide tables, week 47' }], outputsError: null });
    const later = output({ key: '/Users/me/Projects/reports/tides-47-notes.md', type: 'markdown', title: 'Notes on week 47', path: '/Users/me/Projects/reports/tides-47-notes.md', updatedAt: 9 });
    w.outputs = [later, output()];
    expect((await w.bots.detail(w.runId)).outputs.map((o) => o.title)).toEqual(['Notes on week 47', 'Tide tables, week 47']);
    expect(w.finds).toHaveLength(3);
    expect(w.finds.at(-1)).toMatchObject({ sessions: ['claude:sess-1'], hideGone: false });
    // A run still going reads too: what it has produced so far, and no reply yet.
    const going = await started();
    going.outputs = [output()];
    expect(await going.bots.detail(going.runId)).toMatchObject({ run: { state: 'running' }, reply: null, outputs: [{ title: 'Tide tables, week 47' }] });
    await expect(w.bots.detail('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404, message: 'This Report is gone.' });
  });

  it('INBOX-2.3: a Report holds every page the Library has for its Session, up to 200 documents, and says it holds what it shows', async () => {
    const w = world();
    const bot = await w.bot();
    await w.running(bot.id);
    const all = Array.from({ length: 230 }, (_, i) => output({ key: `/Users/me/Projects/reports/tide-${i}.html`, path: `/Users/me/Projects/reports/tide-${i}.html`, title: `Tide ${i}` }));
    // The Library answers 50 at a time.
    w.library = async () => {
      const q = w.finds.at(-1)!;
      const items = all.slice((q.page - 1) * 50, q.page * 50);
      return { ...page(items), total: all.length, nextPage: q.page + 1, hasMore: q.page * 50 < all.length };
    };
    w.live(done());
    await w.bots.settled();
    expect(REPORT_OUTPUTS_MAX).toBe(200);
    expect(w.finds.map((q) => [q.page, q.readId])).toEqual([[1, undefined], [2, 'read-1'], [3, 'read-1'], [4, 'read-1']]);
    expect(w.run()).toMatchObject({ title: 'Tide 0', holds: { documents: 200 } });
    const detail = await w.bots.detail(w.run().id);
    expect(detail.outputs).toHaveLength(200);
    expect(detail.outputs.at(-1)!.title).toBe('Tide 199');
  });

  it("INBOX-2.5: the Session's last reply is kept with its run, at most 20,000 characters, read with its Report and never sent with the set", async () => {
    const w = await finished([], [
      reply('An earlier reply.', 'c1'),
      { kind: 'tool_call', cursor: 'c2', ts: null, id: 't1', tool: 'Bash', summary: 'make tides' },
      reply(`Week 47: ${'~'.repeat(REPORT_REPLY_MAX)}`, 'c3'),
      { kind: 'user', cursor: 'c4', ts: null, text: 'thanks', queued: true },
      reply('  ', 'c5'),
    ]);
    expect(w.latest).toEqual(['sess-1']);
    const { reply: kept } = await w.bots.detail(w.runId);
    expect(kept).toHaveLength(REPORT_REPLY_MAX);
    expect(kept!.startsWith('Week 47: ~~')).toBe(true);
    expect(w.stored().runs[0]!.reply).toBe(kept);
    expect(w.run()).not.toHaveProperty('reply');
    expect(Object.keys(w.snapshots.at(-1)!.runs[0]!).sort()).toEqual(
      ['archived', 'arrivedAt', 'botId', 'botName', 'dueAt', 'endedAt', 'failure', 'harness', 'holds', 'id', 'lateMs', 'launchId', 'name', 'read', 'sessionId', 'session', 'startedAt', 'state', 'title', 'waitingFor'].sort(),
    );
    // No reply either: the Report says it finished without one. A chat that can't be read is the same.
    const silent = await finished();
    expect((await silent.bots.detail(silent.runId)).reply).toBeNull();
    const unread = await started();
    unread.latestFails = true;
    unread.live(done());
    await unread.bots.settled();
    expect(unread.run()).toMatchObject({ state: 'finished', holds: { documents: 0, reply: false, first: null }, session: 'ended' });
  });

  it("INBOX-2.6: a failed run arrives saying why, with whatever its Session did produce", async () => {
    const w = await started();
    w.outputs = [output()];
    w.go(MINUTE);
    w.live();
    await w.bots.settled();
    expect(w.run()).toMatchObject({ state: 'failed', failure: RUN_ENDED_EARLY, title: 'Tide tables, week 47', holds: { documents: 1, reply: false, first: { kind: 'file', type: 'html' } }, arrivedAt: at(23, 7, 1), read: false });
    expect(await w.bots.detail(w.runId)).toMatchObject({ run: { failure: 'Its Session ended before it finished' }, reply: null, outputs: [{ title: 'Tide tables, week 47' }], outputsError: null });
    // A run whose start failed has no Session to have produced anything: the Library isn't asked.
    const never = world();
    const bot = await never.bot();
    never.settings({ startDirectories: [] });
    const failed = await never.bots.runNow(bot.id);
    expect(failed).toMatchObject({ state: 'failed', failure: 'Pick one of the start directories from Settings.', title: 'Tide tables · Nov 23', holds: { documents: 0, reply: false, first: null }, arrivedAt: at(23, 7) });
    expect(await never.bots.detail(failed.id)).toMatchObject({ run: { state: 'failed' }, reply: null, outputs: [], outputsError: null });
    expect(never.finds).toEqual([]);
  });

  it("INBOX-2.3: a Library that fails doesn't fail the finish or the read: the Report keeps its reply and its run's name, says why, and gets its title when it's next read", async () => {
    const w = await started();
    w.entries = [reply('Week 47 is written.')];
    w.library = async () => {
      throw new LibraryError(504, 'tb-session took too long to answer.');
    };
    w.go(MINUTE);
    w.live(done());
    await w.bots.settled();
    expect(w.run()).toMatchObject({ state: 'finished', session: 'ended', title: 'Tide tables · Nov 23', holds: { documents: 0, reply: true, first: null }, arrivedAt: at(23, 7, 1) });
    expect(await w.bots.detail(w.runId)).toMatchObject({ reply: 'Week 47 is written.', outputs: [], outputsError: 'tb-session took too long to answer.' });
    // tb-session missing or too old, in words; anything else never leaks.
    w.library = async () => ({ state: 'not-installed', installCommand: 'install tb-session' });
    expect((await w.bots.detail(w.runId)).outputsError).toMatch(/tb-session isn't installed/);
    w.library = async () => ({ state: 'too-old', reason: 'tb-session 0.3.0 is older than the Library needs (0.4.0)', installCommand: 'install tb-session' });
    expect((await w.bots.detail(w.runId)).outputsError).toBe('tb-session 0.3.0 is older than the Library needs (0.4.0)');
    w.library = async () => {
      throw new Error('ENOENT /Users/me/.cache/tb-session/index.db');
    };
    expect((await w.bots.detail(w.runId)).outputsError).toBe("The Library couldn't be read.");
    expect(w.run().title).toBe('Tide tables · Nov 23');
    // Read again once the Library answers: its title and what it holds reach every tab, and it stays as read as it was.
    w.bots.mark(w.runId, { read: true });
    w.library = null;
    w.outputs = [output()];
    const sent = w.snapshots.length;
    expect(await w.bots.detail(w.runId)).toMatchObject({ run: { title: 'Tide tables, week 47', holds: { documents: 1, reply: true }, read: true, arrivedAt: at(23, 7, 1) }, outputsError: null });
    expect(w.snapshots.length).toBe(sent + 1);
    expect(w.stored().runs[0]).toMatchObject({ title: 'Tide tables, week 47', holdsPending: false });
    await w.bots.detail(w.runId);
    expect(w.snapshots.length).toBe(sent + 1);
  });

  it("INBOX-2.7: a Report names its Session as History knows it, so its button says Resume or Show; none for a run that never got one, or when History can't say", async () => {
    const w = await finished();
    const asked: string[] = [];
    w.history = async (id) => (asked.push(id), { ...PAST, blocked: 'folder-gone' });
    expect((await w.bots.detail(w.runId)).session).toEqual({ ...PAST, blocked: 'folder-gone' });
    expect(asked).toEqual(['sess-1']);
    // History fails, or doesn't know it: the read still answers, without one.
    w.history = async () => {
      throw new Error('tb-session has no such Session.');
    };
    expect(await w.bots.detail(w.runId)).toMatchObject({ run: { id: w.runId }, session: null, outputsError: null });
    // A run that never got a Session, and one known only by its process, aren't asked about.
    const never = world();
    never.spawn = async () => {
      throw Object.assign(new Error('spawn fleet ENOENT'), { code: 'ENOENT' });
    };
    const failed = await never.bots.runNow((await never.bot()).id);
    never.history = async (id) => (asked.push(id), PAST);
    expect(await never.bots.detail(failed.id)).toMatchObject({ run: { state: 'failed', sessionId: null }, session: null, outputs: [], outputsError: null });
    const early = world();
    await early.bots.runNow((await early.bot()).id);
    early.history = async (id) => (asked.push(id), PAST);
    early.live(session(1, { id: 'claude:501' }));
    expect(await early.bots.detail(early.run().id)).toMatchObject({ run: { sessionId: 'claude:501' }, session: null, outputs: [] });
    expect(asked).toEqual(['sess-1']);
    expect(never.finds.concat(early.finds)).toEqual([]);
    // Without History wired at all, a Report names none.
    const bare = world({ dir: w.dir, history: false });
    expect(await bare.bots.detail(w.runId)).toMatchObject({ run: { id: w.runId, sessionId: 'sess-1' }, session: null });
  });

  it("INBOX-3.1: a Report is unread from when it arrives until it's marked read; the server keeps it, so every tab and a reload agree", async () => {
    const w = await finished([output()]);
    expect(w.run().read).toBe(false);
    const sent = w.snapshots.length;
    expect(w.bots.mark(w.runId, { read: true })).toMatchObject({ id: w.runId, read: true, archived: false });
    expect(w.snapshots.length).toBe(sent + 1);
    expect(w.snapshots.at(-1)!.runs[0]).toMatchObject({ read: true });
    expect(w.stored().runs[0]).toMatchObject({ read: true });
    // Shown again in another tab: nothing changes, and nothing is sent.
    w.bots.mark(w.runId, { read: true });
    expect(w.snapshots.length).toBe(sent + 1);
    expect(world({ dir: w.dir }).run()).toMatchObject({ id: w.runId, read: true, arrivedAt: at(23, 7, 4) });
    expect(thrown(() => w.bots.mark(w.runId, { read: 'yes' }))).toMatchObject({ status: 400, field: 'read' });
    expect(thrown(() => w.bots.mark(w.runId, {}))).toMatchObject({ status: 400 });
    expect(thrown(() => w.bots.mark('00000000-0000-4000-8000-000000000000', { read: true }))).toMatchObject({ status: 404 });
  });

  it('INBOX-1.1, INBOX-3.1: a mark made for an earlier arrival changes nothing once the Report arrived again', async () => {
    const w = world();
    const bot = await w.bot();
    await w.running(bot.id, 1, session(1, { status: 'needs-you', waitingFor: 'question: which week?' }));
    const waited = w.run();
    expect(waited).toMatchObject({ state: 'waiting', arrivedAt: at(23, 7), read: false });
    // It finishes, and arrives again, before the tab's mark for the waiting Report reaches the server.
    w.go(MINUTE);
    w.live(done());
    await w.bots.settled();
    expect(w.run()).toMatchObject({ state: 'finished', arrivedAt: at(23, 7, 1), read: false });
    expect(w.bots.mark(waited.id, { read: true, arrivedAt: waited.arrivedAt })).toMatchObject({ read: false });
    expect(w.bots.mark(waited.id, { archived: true, arrivedAt: waited.arrivedAt })).toMatchObject({ archived: false, read: false });
    // A mark for the arrival that shows is kept; one that names none is, as before.
    expect(w.bots.mark(waited.id, { read: true, arrivedAt: at(23, 7, 1) })).toMatchObject({ read: true });
    expect(w.bots.mark(waited.id, { read: false })).toMatchObject({ read: false });
    expect(thrown(() => w.bots.mark(waited.id, { read: true, arrivedAt: 'now' }))).toMatchObject({ status: 400, field: 'arrivedAt' });
  });

  it('INBOX-3.2: Mark unread makes a Report unread again, where it is, for every tab and a reload', async () => {
    const w = await finished([output()]);
    w.bots.mark(w.runId, { read: true });
    expect(w.bots.mark(w.runId, { read: false })).toMatchObject({ read: false, archived: false, arrivedAt: at(23, 7, 4) });
    expect(w.snapshots.at(-1)!.runs[0]).toMatchObject({ id: w.runId, read: false, arrivedAt: at(23, 7, 4) });
    expect(world({ dir: w.dir }).run()).toMatchObject({ read: false });
    // Read again the next time it's shown.
    expect(w.bots.mark(w.runId, { read: true }).read).toBe(true);
  });

  it('INBOX-4.1: archiving moves a Report out of the Inbox and marks it read; Move to Inbox brings it back', async () => {
    const w = await finished([output()]);
    expect(w.bots.mark(w.runId, { archived: true })).toMatchObject({ archived: true, read: true, arrivedAt: at(23, 7, 4) });
    expect(w.snapshots.at(-1)!.runs[0]).toMatchObject({ archived: true, read: true });
    expect(world({ dir: w.dir }).run()).toMatchObject({ archived: true, read: true });
    expect(w.bots.mark(w.runId, { archived: false })).toMatchObject({ archived: false, read: true });
    // Archived and marked unread at once: archived is read.
    expect(w.bots.mark(w.runId, { archived: true, read: false })).toMatchObject({ archived: true, read: true });
    expect(thrown(() => w.bots.mark(w.runId, { archived: 1 }))).toMatchObject({ status: 400, field: 'archived' });
  });

  it("INBOX-4.2: archiving deletes nothing: the Report stays a run of its Bot, with all it arrived with", async () => {
    const w = await finished([output()], [reply('Week 47 is written.')]);
    w.bots.mark(w.runId, { archived: true });
    expect(w.runs()).toEqual([expect.objectContaining({ id: w.runId, botId: w.botId, archived: true, state: 'finished', title: 'Tide tables, week 47', holds: { documents: 1, reply: true, first: { kind: 'file', type: 'html' } } })]);
    expect(await w.bots.detail(w.runId)).toMatchObject({ run: { archived: true }, reply: 'Week 47 is written.', outputs: [{ title: 'Tide tables, week 47' }] });
    expect(w.stored().runs).toHaveLength(1);
    expect(w.ended).toHaveLength(1);
  });

  it("INBOX-2.4: a Markdown Report's text is served only for a `.md` a Report's read of the Library listed, a regular file, at most its first megabyte", async () => {
    const w = await started();
    const folder = join(w.dir, 'reports');
    mkdirSync(folder);
    const notes = join(folder, 'tides-47.md');
    const source = join(folder, 'tides-page.md');
    const unlisted = join(folder, 'private.md');
    const page47 = join(folder, 'tides-47.html');
    const link = join(folder, 'link.md');
    const big = join(folder, 'tides-all.md');
    const mislabelled = join(folder, 'tides-47.txt');
    writeFileSync(mislabelled, 'Listed as Markdown, but not a .md\n');
    writeFileSync(notes, '# Tide tables, week 47\n\nHigh water at 06:12.\n');
    writeFileSync(source, '# The page, as written\n');
    writeFileSync(unlisted, '# Not a Report\n');
    writeFileSync(page47, '<!doctype html><title>Tide tables</title>');
    symlinkSync(unlisted, link);
    // A megabyte and a bit, the cut falling inside a three-byte character.
    writeFileSync(big, `${'a'.repeat(REPORT_TEXT_MAX - 1)}€ and the rest`);
    const md = (path: string) => output({ key: path, type: 'markdown', title: 'Notes', path });
    w.outputs = [
      md(notes), md(link), md(big), md(join(folder, 'gone.md')), md(mislabelled),
      output({ key: page47, path: page47 }),
      output({ kind: 'artifact', key: 'https://claude.ai/artifact/tides', type: null, path: null, url: 'https://claude.ai/artifact/tides', source: { path: source, display: source, type: 'markdown', createdAt: 1, updatedAt: 1, events: 1, exists: true } }),
    ];
    // Before any Report was read, nothing is listed.
    expect(await w.bots.text(notes)).toBeNull();
    await w.bots.detail(w.runId);
    const read = await w.bots.text(notes);
    expect(read).toMatchObject({ truncated: false });
    expect(read!.body.toString('utf8')).toBe('# Tide tables, week 47\n\nHigh water at 06:12.\n');
    // An Artifact's source file, by the same rules.
    expect((await w.bots.text(source))!.body.toString('utf8')).toBe('# The page, as written\n');
    const cut = await w.bots.text(big);
    expect(cut!.truncated).toBe(true);
    expect(cut!.body.length).toBe(REPORT_TEXT_MAX - 1);
    expect(cut!.body.toString('utf8')).toBe('a'.repeat(REPORT_TEXT_MAX - 1));
    // Not listed, another extension, a symlink, a file that's gone, a path that isn't plain or exact.
    for (const path of [unlisted, page47, mislabelled, link, join(folder, 'gone.md'), `${notes}/`, 'reports/tides-47.md', '', `~${notes}`, folder]) {
      expect(await w.bots.text(path), path).toBeNull();
    }
  });

  it("PEOPLE-2.5: a Report's Markdown file listed before its folder became private is refused as one never listed", async () => {
    const w = await started();
    const folder = join(w.dir, 'reviews');
    mkdirSync(folder);
    const notes = join(folder, 'q3.md');
    writeFileSync(notes, '# Q3\n');
    w.outputs = [output({ key: notes, type: 'markdown', title: 'Q3', path: notes })];
    await w.bots.detail(w.runId);
    expect((await w.bots.text(notes))!.body.toString('utf8')).toBe('# Q3\n');
    w.privatePrefix = folder;
    expect(await w.bots.text(notes)).toBeNull();
    w.privatePrefix = null;
    expect(await w.bots.text(notes)).not.toBeNull();
  });

  it("PEOPLE-2.6: when what is private changes, a Report named after a file that is private now shows its next document's title, or its Bot's name, counts one fewer, and doesn't arrive again", async () => {
    const review = output({ key: '/Users/me/notes/Reviews/q3.md', type: 'markdown', title: 'Q3 review', path: '/Users/me/notes/Reviews/q3.md', updatedAt: 9 });
    const w = await finished([review, output()], [reply('Written.')]);
    expect(w.run()).toMatchObject({ title: 'Q3 review', holds: { documents: 2, first: { kind: 'file', type: 'markdown' } } });
    w.bots.mark(w.runId, { read: true });
    const arrived = w.run().arrivedAt;

    // The folder became private: the Library leaves the review out from now on.
    w.outputs = [output()];
    const sent = w.snapshots.length;
    w.bots.privacyChanged();
    await w.bots.settled();
    expect(w.run()).toMatchObject({ title: 'Tide tables, week 47', holds: { documents: 1, reply: true, first: { kind: 'file', type: 'html' } }, arrivedAt: arrived, read: true });
    expect(w.stored().runs[0]).toMatchObject({ title: 'Tide tables, week 47' });
    expect(w.snapshots.length).toBeGreaterThan(sent);
    expect(JSON.stringify(w.snapshots.at(-1))).not.toContain('Q3 review');
    expect(JSON.stringify(w.stored())).not.toContain('Q3 review');

    // Its only document private: its Bot's own name. Nothing changed: nothing sent.
    w.outputs = [];
    w.bots.privacyChanged();
    await w.bots.settled();
    expect(w.run()).toMatchObject({ title: 'Tide tables · Nov 23', holds: { documents: 0, reply: true, first: null }, arrivedAt: arrived, read: true });
    const quiet = w.snapshots.length;
    w.bots.privacyChanged();
    await w.bots.settled();
    expect(w.snapshots.length).toBe(quiet);

    // The Library can't be read. A title whose own file isn't private stands: nothing is wiped on a failed read.
    const down = await finished([review, output()], [reply('Written.')]);
    down.library = async () => {
      throw new Error('down');
    };
    down.bots.privacyChanged();
    await down.bots.settled();
    expect(down.run()).toMatchObject({ title: 'Q3 review', holds: { documents: 2 } });
    // One whose own file is private goes all the same, since that is asked of the file's path and needs no read.
    down.privatePrefix = '/Users/me/notes/Reviews/';
    down.bots.privacyChanged();
    await down.bots.settled();
    expect(down.run()).toMatchObject({ title: 'Tide tables · Nov 23', holds: { documents: 1, first: null } });
    // Opened once the Library reads again, it is named after its next document.
    down.library = null;
    down.outputs = [output()];
    await down.bots.detail(down.runId);
    expect(down.run()).toMatchObject({ title: 'Tide tables, week 47', holds: { documents: 1, first: { kind: 'file', type: 'html' } } });

    // When the server starts, the same is asked with no read of the Library at all.
    const boot = await finished([review]);
    boot.privatePrefix = '/Users/me/notes/Reviews/';
    const finds = boot.finds.length;
    boot.bots.privacyChanged({ reread: false });
    await boot.bots.settled();
    expect(boot.finds).toHaveLength(finds);
    expect(boot.run()).toMatchObject({ title: 'Tide tables · Nov 23' });

    // A run held before its title's file was kept can't be vouched for while the Library can't be read: its Bot's name.
    const old = await finished([review]);
    old.bots.stop();
    const kept = old.stored();
    delete kept.runs[0]!.titleFrom;
    writeFileSync(old.path, JSON.stringify(kept));
    const next = world({ dir: old.dir });
    expect(next.run()).toMatchObject({ title: 'Q3 review' });
    next.library = async () => {
      throw new Error('down');
    };
    next.bots.privacyChanged();
    await next.bots.settled();
    expect(next.run()).toMatchObject({ title: 'Tide tables · Nov 23' });

    // A run still going has no title from a document yet, and is left as it is.
    const going = await started();
    const before = JSON.stringify(going.run());
    going.bots.privacyChanged();
    await going.bots.settled();
    expect(JSON.stringify(going.run())).toBe(before);
  });

  it('PEOPLE-2.6: a run that finishes while what is private changes arrives under the rule that holds by then, never named after the private file', async () => {
    const review = output({ key: '/Users/me/notes/Reviews/q3.md', type: 'markdown', title: 'Q3 review', path: '/Users/me/notes/Reviews/q3.md', updatedAt: 9 });
    const w = await started();
    w.outputs = [review];
    w.entries = [reply('Written.')];
    // The folder is made private while the run's Session is being ended: after its Outputs were read.
    Object.defineProperty(w, 'fresh', {
      configurable: true,
      get: () => {
        if (w.outputs.length) {
          w.outputs = [];
          w.bots.privacyChanged();
        }
        return null;
      },
    });
    w.go(4 * MINUTE);
    w.live(done());
    await w.bots.settled();
    expect(w.order.filter((step) => step === 'outputs').length).toBeGreaterThanOrEqual(2);
    expect(w.run()).toMatchObject({ state: 'finished', title: 'Tide tables · Nov 23', holds: { documents: 0, first: null } });
    expect(JSON.stringify(w.snapshots)).not.toContain('Q3 review');
    expect(JSON.stringify(w.stored())).not.toContain('Q3 review');
  });
});
