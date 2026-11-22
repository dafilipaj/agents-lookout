import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { Harness, HistoryItem, SessionRow } from '../shared/types.ts';
import { HANDOFF_LAUNCH_TTL_MS, HandoffLaunches, Handoffs, type HandoffsOptions, MAX_HANDOFFS, REBUILD_RETRY_MS, REBUILD_TRIES, continuedFromLine, historyHarness, sessionDirectory } from './handoffs.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const OLD = 'a1b2c3d4-0000-4000-8000-000000000001';
const NEW = 'b1b2c3d4-0000-4000-8000-000000000002';
const OTHER = 'c1b2c3d4-0000-4000-8000-000000000003';
const LAUNCH = '00000000-0000-4000-8000-0000000000aa';
const FROM = { sessionId: OLD, harness: 'claude' as const, title: 'Add CSV export to reports' };

/** What the hand-offs read of a row: its id, Harness, process and title. */
const row = (over: Partial<SessionRow> & Pick<SessionRow, 'id' | 'pid'>): SessionRow => ({ harness: 'claude', title: over.id, ...over }) as SessionRow;

function setup(firstPrompt?: (id: string) => Promise<string | null>, more: Partial<HandoffsOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lookout-handoffs-'));
  dirs.push(dir);
  const path = join(dir, '.lookout', 'handoffs.json');
  let now = 1_000_000;
  const warnings: string[] = [];
  const changed = vi.fn();
  const make = () => {
    const h = new Handoffs({ path, now: () => now, warn: (m) => warnings.push(m), onChange: changed, ...(firstPrompt ? { firstPrompt: (id) => firstPrompt(id) } : {}), ...more });
    h.load();
    return h;
  };
  const handoffs = make();
  const launches = new HandoffLaunches(handoffs, () => now);
  return { path, handoffs, launches, warnings, changed, make, tick: (ms: number) => (now += ms) };
}

/** Lets the one-at-a-time reads of first prompts finish. */
const settle = () => new Promise((r) => setTimeout(r, 0));

it('HAND-3.3: a start from a Handover is recorded once Fleet reports the new Session with its session id: the old id, the new one, and when', () => {
  const t = setup();
  t.launches.expect(LAUNCH, FROM);
  t.launches.observe([]);
  expect(t.handoffs.list()).toEqual([]);
  const rows = [row({ id: OLD, pid: 41, title: 'Add CSV export to reports' }), row({ id: NEW, pid: 42, title: 'Fix date format in PDF export' })];
  t.launches.started([{ launchId: LAUNCH, sessionId: NEW }], rows);
  t.tick(5_000);
  t.launches.observe(rows);
  expect(t.handoffs.list()).toEqual([
    { from: OLD, fromHarness: 'claude', fromTitle: 'Add CSV export to reports', to: NEW, toHarness: 'claude', toTitle: 'Fix date format in PDF export', at: 1_005_000 },
  ]);
  expect(JSON.parse(readFileSync(t.path, 'utf8'))).toEqual(t.handoffs.list());
  expect(t.changed).toHaveBeenCalled();
  // Once: a later list records nothing again.
  t.launches.observe(rows);
  expect(t.handoffs.list()).toHaveLength(1);
});

it('HAND-3.3: a Codex Session is followed by its process until its first prompt gives it a session id, then recorded', () => {
  const t = setup();
  t.launches.expect(LAUNCH, { ...FROM, harness: 'codex' });
  const before = row({ id: 'codex:77', pid: 77, harness: 'codex' });
  t.launches.started([{ launchId: LAUNCH, sessionId: 'codex:77' }], [before]);
  t.launches.observe([before]);
  expect(t.handoffs.list()).toEqual([]);
  t.launches.observe([row({ id: NEW, pid: 77, harness: 'codex' })]);
  expect(t.handoffs.list()).toEqual([expect.objectContaining({ from: OLD, fromHarness: 'codex', to: NEW, toHarness: 'codex' })]);
});

it('HAND-3.3: a start that fails, or that Fleet never reports, records nothing; nor one that ends before it has an id', () => {
  const t = setup();
  t.launches.expect(LAUNCH, FROM);
  expect(t.launches.expect(LAUNCH, FROM)).toBe(false);
  t.launches.forget(LAUNCH);
  t.launches.started([{ launchId: LAUNCH, sessionId: NEW }], [row({ id: NEW, pid: 42 })]);
  t.launches.observe([row({ id: NEW, pid: 42 })]);
  expect(t.handoffs.list()).toEqual([]);

  t.launches.expect('00000000-0000-4000-8000-0000000000bb', FROM);
  t.tick(HANDOFF_LAUNCH_TTL_MS + 1);
  t.launches.observe([]);
  t.launches.started([{ launchId: '00000000-0000-4000-8000-0000000000bb', sessionId: NEW }], [row({ id: NEW, pid: 42 })]);
  t.launches.observe([row({ id: NEW, pid: 42 })]);
  expect(t.handoffs.list()).toEqual([]);

  t.launches.expect('00000000-0000-4000-8000-0000000000cc', FROM);
  t.launches.started([{ launchId: '00000000-0000-4000-8000-0000000000cc', sessionId: 'codex:9' }], [row({ id: 'codex:9', pid: 9, harness: 'codex' })]);
  t.launches.observe([]); // ended before its first prompt
  t.launches.observe([row({ id: NEW, pid: 9, harness: 'codex' })]);
  expect(t.handoffs.list()).toEqual([]);
});

it("HAND-3.3: the request's `continues` is checked: a session id and a Harness, its title bounded", () => {
  const t = setup();
  expect(t.launches.check(undefined)).toBeNull();
  expect(t.launches.check(null)).toBeNull();
  expect(t.launches.check({ sessionId: OLD, harness: 'codex', title: ' Fix\nit ' })).toEqual({ sessionId: OLD, harness: 'codex', title: 'Fix it', piece: '' });
  expect(t.launches.check({ sessionId: OLD, harness: 'claude' })).toEqual({ sessionId: OLD, harness: 'claude', title: OLD, piece: '' });
  // TOPIC-15.1: the piece handed off, trimmed and capped; anything but a string is all the work.
  expect(t.launches.check({ sessionId: OLD, harness: 'claude', piece: '  the export test ' })).toMatchObject({ piece: 'the export test' });
  expect(t.launches.check({ sessionId: OLD, harness: 'claude', piece: 'x'.repeat(5_000) })!.piece).toHaveLength(2_000);
  expect(t.launches.check({ sessionId: OLD, harness: 'claude', piece: 7 })).toMatchObject({ piece: '' });
  for (const bad of [{}, 'x', { sessionId: '../x', harness: 'claude' }, { sessionId: OLD, harness: 'pi' }, { sessionId: OLD }]) {
    expect(() => t.launches.check(bad)).toThrow('Invalid Session to continue.');
  }
});

it('HAND-4.1, HAND-4.2 (support): each Session has the one it continues and those that continue it, newest first', () => {
  const t = setup();
  t.handoffs.record({ from: OLD, fromHarness: 'claude', fromTitle: 'CSV', to: NEW, toHarness: 'claude', toTitle: 'PDF dates', at: 1 });
  t.handoffs.record({ from: OLD, fromHarness: 'claude', fromTitle: 'CSV', to: OTHER, toHarness: 'codex', toTitle: 'Totals row', at: 2 });
  expect(t.handoffs.links(OLD)).toEqual({
    continuedFrom: null,
    continuedIn: [
      { sessionId: OTHER, harness: 'codex', title: 'Totals row', at: 2 },
      { sessionId: NEW, harness: 'claude', title: 'PDF dates', at: 1 },
    ],
  });
  expect(t.handoffs.links(NEW)).toEqual({ continuedFrom: { sessionId: OLD, harness: 'claude', title: 'CSV', at: 1 }, continuedIn: [] });
  expect(t.handoffs.links('nobody')).toEqual({ continuedFrom: null, continuedIn: [] });
});

it("HAND-4.3: the links survive a restart of Lookout's server; a linked Session's title is kept as last seen live", () => {
  const t = setup();
  t.handoffs.record({ from: OLD, fromHarness: 'claude', fromTitle: 'CSV', to: NEW, toHarness: 'claude', toTitle: null, at: 1 });
  t.handoffs.observe([row({ id: NEW, pid: 42, title: 'Fix date format in PDF export' })]);
  const again = t.make();
  expect(again.links(NEW).continuedFrom).toEqual({ sessionId: OLD, harness: 'claude', title: 'CSV', at: 1 });
  expect(again.links(OLD).continuedIn).toEqual([{ sessionId: NEW, harness: 'claude', title: 'Fix date format in PDF export', at: 1 }]);
});

it('HAND-4.3 (support): the record keeps the newest 5,000 hand-offs; an older one goes, from the file too', () => {
  const id = (n: number) => `d1b2c3d4-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const entry = (n: number) => ({ from: OLD, fromHarness: 'claude' as const, fromTitle: null, to: id(n), toHarness: 'claude' as const, toTitle: null, at: n });
  // A full file, then one hand-off more.
  const seeded = setup();
  mkdirSync(dirname(seeded.path), { recursive: true });
  writeFileSync(seeded.path, JSON.stringify(Array.from({ length: MAX_HANDOFFS }, (_, i) => entry(i + 1))));
  const t = { ...seeded, handoffs: seeded.make() };
  expect(t.handoffs.list()).toHaveLength(MAX_HANDOFFS);
  t.handoffs.record(entry(MAX_HANDOFFS + 1));
  expect(MAX_HANDOFFS).toBe(5000);
  expect(t.handoffs.list()).toHaveLength(MAX_HANDOFFS);
  expect(t.handoffs.links(id(1)).continuedFrom).toBeNull();
  expect(t.make().links(id(MAX_HANDOFFS + 1)).continuedFrom).toEqual(expect.objectContaining({ sessionId: OLD, at: MAX_HANDOFFS + 1 }));
  expect(t.make().list()).toHaveLength(MAX_HANDOFFS);
});

it("HAND-4.3: a file that can't be read starts without links, and the next hand-off writes a new one", () => {
  const t = setup();
  t.handoffs.record({ from: OLD, fromHarness: 'claude', fromTitle: null, to: NEW, toHarness: 'claude', toTitle: null, at: 1 });
  writeFileSync(t.path, '{ not json');
  const broken = t.make();
  expect(broken.list()).toEqual([]);
  expect(t.warnings).toEqual([expect.stringContaining("isn't JSON")]);
  writeFileSync(t.path, JSON.stringify([{ from: OLD, to: NEW, at: 1 }, { from: OLD, fromHarness: 'claude', to: OLD, toHarness: 'claude', at: 2 }, 'x']));
  expect(t.make().list()).toEqual([]); // no Harnesses, or a Session continuing itself
  broken.record({ from: OLD, fromHarness: 'claude', fromTitle: null, to: OTHER, toHarness: 'claude', toTitle: null, at: 3 });
  expect(JSON.parse(readFileSync(t.path, 'utf8'))).toHaveLength(1);
});

it("HAND-4.3: a Session started from a Handover before the record existed is linked by its first prompt's `Continued from:` line, read once", async () => {
  const prompts: Record<string, string> = {
    [NEW]: `Fix the PDF export's date format.\n\nContinued from: ${OTHER} Something it quoted\n\nContinued from: ${OLD} Add CSV export to reports\nIn your first reply, restate the work.`,
    [OLD]: 'Add CSV export to reports',
  };
  const firstPrompt = vi.fn(async (id: string) => prompts[id] ?? null);
  const t = setup(firstPrompt);
  const rows = [row({ id: OLD, pid: 41, title: 'CSV export' }), row({ id: NEW, pid: 42, title: 'PDF dates' }), row({ id: 'claude:43', pid: 43 })];
  t.handoffs.observe(rows);
  await settle();
  expect(t.handoffs.list()).toEqual([{ from: OLD, fromHarness: 'claude', fromTitle: 'CSV export', to: NEW, toHarness: 'claude', toTitle: 'PDF dates', at: 1_000_000 }]);
  // Each Session with a session id once; a Session without one isn't read.
  expect(firstPrompt.mock.calls.map((c) => c[0]).sort()).toEqual([OLD, NEW].sort());
  t.handoffs.observe(rows);
  await settle();
  expect(firstPrompt).toHaveBeenCalledTimes(2);
});

it("HAND-4.3: a first prompt that can't be read yet is read again later, a few times; an old Session that isn't live keeps the line's title", async () => {
  let fail = true;
  const firstPrompt = vi.fn(async () => {
    if (fail) throw new Error('not indexed yet');
    return `Handover\n\nContinued from: ${OLD} Add CSV export to reports\nRestate.`;
  });
  const t = setup(firstPrompt);
  const rows = [row({ id: NEW, pid: 42, harness: 'codex' })];
  t.handoffs.observe(rows);
  await settle();
  t.handoffs.observe(rows); // too soon: not read again
  await settle();
  expect(firstPrompt).toHaveBeenCalledTimes(1);
  t.tick(REBUILD_RETRY_MS);
  fail = false;
  t.handoffs.observe(rows);
  await settle();
  expect(t.handoffs.list()).toEqual([expect.objectContaining({ from: OLD, fromHarness: 'codex', fromTitle: 'Add CSV export to reports', to: NEW })]);

  const never = setup(vi.fn(async () => { throw new Error('gone'); }));
  for (let i = 0; i < REBUILD_TRIES + 2; i++) {
    never.handoffs.observe(rows);
    await settle();
    never.tick(REBUILD_RETRY_MS);
  }
  expect(never.handoffs.list()).toEqual([]);
});

it("HAND-4.3, HAND-4.1: a rebuilt link to an old Session that ended has the Harness History knows it under, so it opens; the new Session's when History doesn't know it", async () => {
  const firstPrompt = vi.fn(async () => `Handover\n\nContinued from: ${OLD} Add CSV export to reports\nRestate.`);
  const rows = [row({ id: NEW, pid: 42, harness: 'codex' })];
  // Claude Code to Codex: the launcher's Harness was changed.
  const sessionHarness = vi.fn(async (): Promise<Harness | null> => 'claude');
  const t = setup(firstPrompt, { sessionHarness });
  t.handoffs.observe(rows);
  await settle();
  expect(sessionHarness).toHaveBeenCalledWith(OLD, 'codex');
  expect(t.handoffs.list()).toEqual([expect.objectContaining({ from: OLD, fromHarness: 'claude', to: NEW, toHarness: 'codex' })]);

  for (const unknown of [async () => null, async () => { throw new Error('tb-session failed'); }]) {
    const u = setup(firstPrompt, { sessionHarness: unknown });
    u.handoffs.observe(rows);
    await settle();
    expect(u.handoffs.list()).toEqual([expect.objectContaining({ from: OLD, fromHarness: 'codex', to: NEW })]);
  }

  // A live old Session gives its own Harness; History isn't asked.
  const live = vi.fn(async (): Promise<Harness | null> => 'codex');
  const l = setup(firstPrompt, { sessionHarness: live });
  l.handoffs.observe([...rows, row({ id: OLD, pid: 41, harness: 'claude' })]);
  await settle();
  expect(l.handoffs.list()).toEqual([expect.objectContaining({ from: OLD, fromHarness: 'claude', to: NEW })]);
  expect(live).not.toHaveBeenCalled();
});

it('HAND-4.3 (support): History is asked for an ended Session under the likely Harness first, then the other', async () => {
  const lookup = vi.fn(async (_id: string, h: Harness): Promise<HistoryItem> => {
    if (h === 'claude') return {} as HistoryItem;
    throw new Error('not found');
  });
  expect(await historyHarness({ lookup })(OLD, 'codex')).toBe('claude');
  expect(lookup.mock.calls.map((c) => c[1])).toEqual(['codex', 'claude']);
  expect(await historyHarness({ lookup: async () => { throw new Error('gone'); } })(OLD, 'claude')).toBeNull();
});

it("HAND-3.4: the old Session's directory is read from a Fleet list made at that moment; a list that fails isn't trusted, and History answers", async () => {
  const rows = new Map<string, SessionRow>([[OLD, row({ id: OLD, pid: 41, cwd: '/Users/me/Projects/shop-old' })]]);
  let fleet: 'ok' | 'failing' = 'ok';
  const monitor = {
    // The fresh list: the Session has moved on since the last poll's.
    pollNow: vi.fn(async () => {
      if (fleet === 'ok') rows.set(OLD, row({ id: OLD, pid: 41, cwd: '/Users/me/Projects/shop' }));
    }),
    snapshot: () => ({ sessions: [...rows.values()], fleet: fleet === 'ok' ? ({ state: 'ok' } as const) : ({ state: 'failing', lastOkAt: 1, error: 'timed out' } as const) }),
    get: (id: string) => rows.get(id) ?? null,
  };
  const lookup = vi.fn(async (_id: string, h: Harness): Promise<HistoryItem> => {
    if (h !== 'claude') throw new Error('not found');
    return { projectPath: '/Users/me/Projects/shop-history' } as HistoryItem;
  });
  const directory = sessionDirectory({ monitor, history: { lookup } });
  expect(await directory(OLD, 'claude')).toBe('/Users/me/Projects/shop');
  expect(monitor.pollNow).toHaveBeenCalledTimes(1);
  expect(lookup).not.toHaveBeenCalled();
  // A row of another Harness isn't this Session; neither Fleet nor History knows it then.
  expect(await directory(OLD, 'codex')).toBeNull();
  fleet = 'failing';
  rows.set(OLD, row({ id: OLD, pid: 41, cwd: '/Users/me/Projects/stale' }));
  expect(await directory(OLD, 'claude')).toBe('/Users/me/Projects/shop-history');
});

it('HAND-3.2 (support): the last `Continued from:` line of a first prompt names the Session it continues', () => {
  expect(continuedFromLine(`Handover\nContinued from: ${OLD} Add CSV export\nRestate.`)).toEqual({ sessionId: OLD, title: 'Add CSV export' });
  expect(continuedFromLine(`Continued from: ${OLD}`)).toEqual({ sessionId: OLD, title: null });
  expect(continuedFromLine('Continued from: ../etc nothing')).toBeNull();
  expect(continuedFromLine('No line here')).toBeNull();
});
