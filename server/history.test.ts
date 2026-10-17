import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../shared/settings.ts';
import { TB_SESSION_INSTALL_COMMAND } from '../shared/defaults.ts';
import { type RunOptions, run } from './exec.ts';
import { fetchFleetList } from './fleet.ts';
import { HISTORY_PAGE, History, HistoryError, parseFindQuery, resolveTbSessionBin, resumePast } from './history.ts';
import { Launcher } from './launcher.ts';

/**
 * HIST against a fake `tb-session` (the 0.3.0 contract, and 0.2.0's) and the fake `fleet`
 * (`spawn --json`, `spawn --resume`): real processes, synthetic Sessions only.
 */
const FAKE_TB = new URL('./fixtures/tb-session/fake-tb-session.mjs', import.meta.url).pathname;
const FAKE_FLEET = new URL('./fixtures/fleet/messages/fake-fleet.mjs', import.meta.url).pathname;
const FLEET_FIXTURES = new URL('./fixtures/fleet/messages/', import.meta.url).pathname;

const LIVE = 'aaaaaaaa-0000-4000-8000-000000000101';
const CODEX = 'cccccccc-0000-7000-8000-000000000201';
const GONE = 'dddddddd-0000-4000-8000-000000000301';
const NO_TRANSCRIPT = 'eeeeeeee-0000-4000-8000-000000000401';
const HEADLESS = 'ffffffff-0000-4000-8000-000000000501';

let dir: string;
let env: NodeJS.ProcessEnv;
let tbLog: string;
let fleetLog: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lookout-history-'));
  mkdirSync(join(dir, 'work'));
  mkdirSync(join(dir, 'fleet'));
  cpSync(FLEET_FIXTURES, join(dir, 'fleet'), { recursive: true });
  tbLog = join(dir, 'tb.log');
  fleetLog = join(dir, 'fleet.log');
  env = { PATH: process.env.PATH, FAKE_TB_SESSION_ROOT: dir, FAKE_TB_SESSION_LOG: tbLog, FAKE_FLEET_DIR: join(dir, 'fleet'), FAKE_FLEET_LOG: fleetLog };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const history = (over: Partial<NodeJS.ProcessEnv> = {}) => new History({ runner: run, bin: () => FAKE_TB, env: { ...env, ...over } });
const calls = (log: string): string[][] => {
  try {
    return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]);
  } catch {
    return [];
  }
};
const find = (h: History, query = '', over: Partial<{ page: number; headless: boolean; harness: 'claude' | 'codex' | null }> = {}) =>
  h.find({ query, page: 1, headless: false, harness: null, ...over });
const ok = async (p: ReturnType<History['find']>) => {
  const page = await p;
  if (page.state !== 'ok') throw new Error(page.state);
  return page;
};

/** A runner that prints `stdout` for tb-session, to feed rows the fake wouldn't. */
const printing = (stdout: unknown) => vi.fn(async (_f: string, _a: readonly string[], _o: RunOptions) => JSON.stringify(stdout));

describe('finding past Sessions (HIST-2)', () => {
  it('HIST-2.1: an empty query lists past Sessions, most recent first, and the next page loads more', async () => {
    const h = history();
    const page = await ok(find(h));
    expect(page.items.map((i) => i.sessionId)).toEqual([LIVE, CODEX, GONE, NO_TRANSCRIPT]);
    expect(calls(tbLog)[0]).toEqual(['list', '--all-projects', '--json', '--limit', String(HISTORY_PAGE), '--page', '1', '--headless', 'exclude']);

    // 120 Sessions: pages of 50, then the rest.
    const many = Array.from({ length: 120 }, (_, i) => ({
      session_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      harness: 'claude',
      headless: false,
      summary: `session ${i}`,
      first_prompt: `prompt ${i}`,
      project_path: '@root/work',
      modified_at: new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString(),
      messages: [],
    }));
    writeFileSync(join(dir, 'many.json'), JSON.stringify(many));
    const m = history({ FAKE_TB_SESSION_FILE: join(dir, 'many.json') });
    const p1 = await ok(find(m));
    expect(p1).toMatchObject({ page: 1, hasMore: true });
    expect(p1.items[0]!.title).toBe('session 119');
    const p3 = await ok(find(m, '', { page: 3 }));
    expect(p3).toMatchObject({ page: 3, hasMore: false });
    expect(p3.items).toHaveLength(20);
    expect(p3.items.at(-1)!.title).toBe('session 0');
  });

  it('HIST-2.2: a query searches the full text across all projects, best match first, within 1 s', async () => {
    const h = history();
    const started = performance.now();
    const page = await ok(find(h, 'rate card'));
    expect(performance.now() - started).toBeLessThan(1000);
    // The Codex Session mentions it once, pr641-review once, fix-deal-rates once: tb-session's order is kept.
    expect(page.items.length).toBeGreaterThan(1);
    expect(calls(tbLog)[0]).toEqual(['search', '--all-projects', '--json', '--limit', String(HISTORY_PAGE), '--headless', 'exclude', '--', 'rate card']);
    // A query that looks like a flag is still the query.
    await find(h, '--help');
    expect(calls(tbLog)[1]!.slice(-2)).toEqual(['--', '--help']);
    expect(page.hasMore).toBe(false);
  });

  it('HIST-2.2: best match first: tb-session’s ranking is kept as is', async () => {
    const h = new History({
      runner: printing({
        results: [
          { session_id: 'b-1', harness: 'claude', first_prompt: 'best', project_path: '/x', relevance_score: -9 },
          { session_id: 'a-2', harness: 'codex', first_prompt: 'second', project_path: '/x', relevance_score: -1 },
        ],
      }),
      bin: () => 'tb-session',
      isDirectory: async () => true,
    });
    expect((await ok(find(h, 'x'))).items.map((i) => i.title)).toEqual(['best', 'second']);
  });

  it('HIST-2.3: each result has its title, Harness, repo, branch, last activity and the matching snippet', async () => {
    const page = await ok(find(history(), 'hook fires'));
    expect(page.items).toEqual([
      {
        sessionId: CODEX,
        harness: 'codex',
        headless: false,
        title: 'kg-hook-review',
        projectPath: join(dir, 'work'),
        repo: 'work',
        branch: 'feature/kg-hook',
        lastActiveAt: Date.UTC(2026, 9, 13, 11),
        snippet: expect.stringContaining('«hook fires»'),
        blocked: null,
      },
    ]);
  });

  it('HIST-2.4: Claude Code and Codex Sessions both appear; a tb-session 0.2 row (no `harness`) is Claude Code', async () => {
    const page = await ok(find(history()));
    expect(new Set(page.items.map((i) => i.harness))).toEqual(new Set(['claude', 'codex']));

    const legacy = await ok(find(history({ FAKE_TB_SESSION_VERSION: '0.2.0' })));
    expect(legacy.items.length).toBeGreaterThan(0);
    for (const i of legacy.items) expect(i).toMatchObject({ harness: 'claude', headless: null });
  });

  it('HIST-2.5: Headless Sessions are hidden unless the toggle is on; unknown (`null`) ones stay', async () => {
    const h = history();
    const hidden = await ok(find(h));
    expect(hidden.items.map((i) => i.sessionId)).not.toContain(HEADLESS);
    expect(hidden.items.find((i) => i.sessionId === NO_TRANSCRIPT)?.headless).toBeNull();
    const shown = await ok(find(h, '', { headless: true }));
    expect(shown.items.map((i) => i.sessionId)).toContain(HEADLESS);
    expect(calls(tbLog)[1]).not.toContain('--headless');

    // tb-session 0.2 refuses `--headless`: asked again without it, and from then on.
    const legacy = history({ FAKE_TB_SESSION_VERSION: '0.2.0' });
    await ok(find(legacy));
    await ok(find(legacy, 'rate'));
    const [refused, retried, next] = calls(tbLog).slice(2);
    expect(refused).toContain('--headless');
    expect(retried).not.toContain('--headless');
    expect(next).not.toContain('--headless');
    // Even when tb-session can't filter, a row it marks headless is hidden.
    const unfiltered = new History({
      runner: printing({ results: [{ session_id: 'h-1', harness: 'claude', headless: true, first_prompt: 'x' }, { session_id: 'i-1', harness: 'claude', headless: false, first_prompt: 'y' }] }),
      bin: () => 'tb-session',
    });
    expect((await ok(find(unfiltered))).items.map((i) => i.sessionId)).toEqual(['i-1']);
  });

  it('HIST-2.8: one Harness only: tb-session 0.3 is passed `--harness`; 0.2, which has no such flag, is filtered here, its rows counting as Claude Code', async () => {
    const h = history();
    const codex = await ok(find(h, '', { harness: 'codex' }));
    expect(codex.items.map((i) => i.sessionId)).toEqual([CODEX]);
    expect(calls(tbLog)[0]).toEqual(['list', '--all-projects', '--json', '--limit', String(HISTORY_PAGE), '--page', '1', '--headless', 'exclude', '--harness', 'codex']);
    const claude = await ok(find(h, '', { harness: 'claude' }));
    expect(claude.items.length).toBeGreaterThan(0);
    for (const i of claude.items) expect(i.harness).toBe('claude');
    // A search keeps the query last, after `--`.
    await ok(find(h, 'rate', { harness: 'claude' }));
    expect(calls(tbLog)[2]!.slice(-4)).toEqual(['--harness', 'claude', '--', 'rate']);
    // Both: no flag at all.
    await ok(find(h));
    expect(calls(tbLog)[3]).not.toContain('--harness');

    // tb-session 0.2 refuses `--harness`: asked again without it, and the rows filtered here.
    const legacy = history({ FAKE_TB_SESSION_VERSION: '0.2.0' });
    const legacyClaude = await ok(find(legacy, '', { harness: 'claude' }));
    expect(legacyClaude.items.length).toBeGreaterThan(0);
    for (const i of legacyClaude.items) expect(i.harness).toBe('claude');
    expect((await ok(find(legacy, '', { harness: 'codex' }))).items).toEqual([]);
    expect(calls(tbLog).slice(4).filter((c) => c.includes('--harness'))).toHaveLength(1); // the one refusal
    // Rows from a tb-session that ignored the flag are filtered too.
    const unfiltered = new History({
      runner: printing({ results: [{ session_id: 'c-1', harness: 'codex', first_prompt: 'x' }, { session_id: 'l-1', first_prompt: 'y' }] }),
      bin: () => 'tb-session',
    });
    expect((await ok(find(unfiltered, '', { harness: 'claude' }))).items.map((i) => i.sessionId)).toEqual(['l-1']);
    expect((await ok(find(unfiltered, '', { harness: 'codex' }))).items.map((i) => i.sessionId)).toEqual(['c-1']);
  });

  it('HIST-2.6: subagent Sessions and Sessions without a prompt never appear', async () => {
    const page = await ok(find(history(), '', { headless: true }));
    const ids = page.items.map((i) => i.sessionId);
    expect(ids).not.toContain('99999999-0000-4000-8000-000000000601');
    expect(ids).not.toContain('88888888-0000-4000-8000-000000000701');
    // Even if tb-session printed them.
    const h = new History({
      runner: printing({
        results: [
          { session_id: 's-1', harness: 'claude', is_sidechain: true, first_prompt: 'subagent' },
          { session_id: 's-2', harness: 'claude', first_prompt: '' },
          { session_id: 's-3', harness: 'claude', first_prompt: '   ' },
          { session_id: 's-4', harness: 'claude' },
          { session_id: 's-5', harness: 'claude', first_prompt: 'kept' },
        ],
      }),
      bin: () => 'tb-session',
    });
    expect((await ok(find(h))).items.map((i) => i.sessionId)).toEqual(['s-5']);
  });

  it('HIST-2.6 with tb-session 0.2: its `list` rows have no `first_prompt`; Sessions with messages show, empty ones don\u2019t, and no row needs a `show`', async () => {
    const legacy = await ok(find(history({ FAKE_TB_SESSION_VERSION: '0.2.0' }), '', { headless: true }));
    const ids = legacy.items.map((i) => i.sessionId);
    expect(ids).toEqual(expect.arrayContaining([LIVE, GONE, NO_TRANSCRIPT, HEADLESS]));
    expect(ids).not.toContain('88888888-0000-4000-8000-000000000701'); // listed by 0.2, but empty
    expect(ids).not.toContain('99999999-0000-4000-8000-000000000601'); // subagent
    expect(ids).not.toContain(CODEX); // 0.2 knows Claude Code only
    expect(legacy.items.find((i) => i.sessionId === LIVE)!.title).toBe('fix-deal-rates');
    expect(calls(tbLog).filter((a) => a[0] === 'show')).toEqual([]);
    // Rows exactly as the real 0.2.0 prints them (run against cli-toolbox's synthetic fixtures).
    const h = new History({
      runner: printing({
        total_results: 3,
        page: 1,
        results: [
          { session_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', project_path: '/work/example-app', message_count: 0, created_at: '2026-01-01T10:00:00.000Z', modified_at: '2026-01-01T10:00:00.000Z' },
          { session_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', summary: 'Score: 3', git_branch: 'main', project_path: '/work/example-app', message_count: 2, created_at: '2026-01-01T09:00:01.000Z', modified_at: '2026-01-01T09:00:03.000Z' },
          { session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', git_branch: 'main', project_path: '/work/example-app', message_count: 2, created_at: '2026-01-01T08:00:00.000Z', modified_at: '2026-01-01T08:00:05.000Z' },
        ],
      }),
      bin: () => 'tb-session',
      isDirectory: async () => true,
    });
    const page = await ok(find(h));
    expect(page.items.map((i) => [i.sessionId.slice(0, 8), i.title, i.harness, i.headless])).toEqual([
      ['bbbbbbbb', 'Score: 3', 'claude', null],
      ['aaaaaaaa', 'Untitled Session aaaaaaaa', 'claude', null],
    ]);
  });

  it('HIST-2.6 with tb-session 0.2: a listed row without a prompt (assistant-only, empty messages) is neither resumed nor opened', async () => {
    const NO_PROMPT = '77777777-0000-4000-8000-000000000801';
    // 0.3 never lists it.
    expect((await ok(find(history(), '', { headless: true }))).items.map((i) => i.sessionId)).not.toContain(NO_PROMPT);
    // 0.2 counts its messages, so it's listed until tb-session 0.3 is installed (Technical approach)…
    const legacy = history({ FAKE_TB_SESSION_VERSION: '0.2.0' });
    expect((await ok(find(legacy))).items.map((i) => i.sessionId)).toContain(NO_PROMPT);
    // …but a click reads its `show`, finds no prompt, and says so.
    await expect(legacy.detail(NO_PROMPT, 'claude')).rejects.toMatchObject({ status: 422, message: 'This Session has no prompt.' });
    const launcher = { resume: vi.fn(), pendingResume: vi.fn(() => null) };
    const deps = { history: legacy, launcher, isLive: async () => false };
    await expect(resumePast(deps, { sessionId: NO_PROMPT, harness: 'claude' })).rejects.toMatchObject({ status: 422, message: 'This Session has no prompt.' });
    expect(launcher.resume).not.toHaveBeenCalled();
    // One with a prompt still resumes and opens through 0.2.
    expect((await legacy.detail(LIVE, 'claude')).entries.length).toBeGreaterThan(0);
  });

  it('never more than a page of rows, whatever tb-session prints; bounded before any directory is checked', async () => {
    const isDirectory = vi.fn(async () => true);
    const results = Array.from({ length: HISTORY_PAGE * 2 + 1 }, (_, n) => ({ session_id: `row-${n}`, harness: 'claude', first_prompt: `prompt ${n}`, project_path: '/work' }));
    const h = new History({ runner: printing({ results }), bin: () => 'tb-session', isDirectory });
    expect((await ok(find(h))).items).toHaveLength(HISTORY_PAGE);
    expect((await ok(find(h, 'prompt'))).items).toHaveLength(HISTORY_PAGE);
    expect(isDirectory).toHaveBeenCalledTimes(HISTORY_PAGE * 2);
  });

  it('validates and bounds everything tb-session prints before the browser sees it', async () => {
    const h = new History({
      runner: printing({
        results: [
          { session_id: 'bad id; rm -rf', harness: 'claude', first_prompt: 'x' },
          { session_id: 'p-1', harness: 'pi', first_prompt: 'x' },
          { session_id: 42, first_prompt: 'x' },
          'not a row',
          {
            session_id: 'ok-1',
            harness: 'claude',
            headless: 'yes',
            first_prompt: `${'long '.repeat(500)}\u0007`,
            summary: 'line one\nline two\u001b[31m',
            project_path: 'relative/path',
            git_branch: 7,
            modified_at: 'not a date',
            matched_snippet: 'x'.repeat(5000),
          },
        ],
      }),
      bin: () => 'tb-session',
    });
    const [item, ...rest] = (await ok(find(h, 'q'))).items;
    expect(rest).toEqual([]);
    expect(item).toMatchObject({ sessionId: 'ok-1', headless: null, projectPath: null, repo: null, branch: null, lastActiveAt: null, blocked: 'no-folder' });
    expect(item!.title).toBe('line one line two [31m');
    expect(item!.snippet!.length).toBeLessThanOrEqual(400);

    const garbage = new History({ runner: vi.fn(async () => 'not json'), bin: () => 'tb-session' });
    await expect(find(garbage)).rejects.toMatchObject({ status: 502 });
  });

  it('tb-session missing: says how to install it (like SIDE-6.1)', async () => {
    const h = new History({ runner: run, bin: () => join(dir, 'no-such-tb-session'), env });
    expect(await find(h)).toEqual({ state: 'not-installed', installCommand: TB_SESSION_INSTALL_COMMAND });
  });

  it('tb-session failing: its reason, redacted and on one line', async () => {
    const h = new History({
      runner: vi.fn(async () => {
        throw Object.assign(new Error('exit 1'), { code: 1, stderr: 'Error: database locked token=abc123secret\nmore', stdout: '' });
      }),
      bin: () => 'tb-session',
    });
    const err = (await find(h).catch((e: unknown) => e)) as HistoryError;
    expect(err).toBeInstanceOf(HistoryError);
    expect(err.message).toBe('tb-session failed: database locked token=…');
  });

  it('reads the query string, clamped', () => {
    expect(parseFindQuery(new URLSearchParams('q=a%0Ab&page=2&headless=1&harness=codex'))).toEqual({ query: 'a b', page: 2, headless: true, harness: 'codex' });
    expect(parseFindQuery(new URLSearchParams('page=x&harness=pi'))).toEqual({ query: '', page: 1, headless: false, harness: null });
    expect(parseFindQuery(new URLSearchParams('page=99999')).page).toBe(1000);
  });

  it('finds tb-session like Fleet: LOOKOUT_TB_SESSION_BIN, then PATH, then ~/.local/bin', () => {
    expect(resolveTbSessionBin({ LOOKOUT_TB_SESSION_BIN: '/opt/tb', PATH: '' })).toBe('/opt/tb');
    const bin = join(dir, 'bin');
    const local = join(dir, 'home', '.local', 'bin');
    mkdirSync(bin);
    mkdirSync(local, { recursive: true });
    writeFileSync(join(local, 'tb-session'), '#!/bin/sh\n');
    chmodSync(join(local, 'tb-session'), 0o755);
    expect(resolveTbSessionBin({ PATH: bin, HOME: join(dir, 'home') })).toBe(join(local, 'tb-session'));
    writeFileSync(join(bin, 'tb-session'), '#!/bin/sh\n');
    chmodSync(join(bin, 'tb-session'), 0o755);
    expect(resolveTbSessionBin({ PATH: bin, HOME: join(dir, 'home') })).toBe(join(bin, 'tb-session'));
    expect(resolveTbSessionBin({ PATH: '', HOME: join(dir, 'nobody') })).toBe('tb-session');
  });
});

describe('a past Session read-only (HIST-3.3)', () => {
  it('HIST-3.3: its latest messages, through `show --harness … --tail 20 --json`, and why it can’t be resumed', async () => {
    const d = await history().detail(GONE, 'claude');
    expect(calls(tbLog)[0]).toEqual(['show', '--json', '--harness', 'claude', '--tail', '20', '--', GONE]);
    expect(d.item).toMatchObject({ sessionId: GONE, blocked: 'folder-gone', title: 'pr641-review' });
    expect(d.source).toBe('transcript');
    expect(d.entries.map((e) => e.kind)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(d.entries[1]).toMatchObject({ kind: 'assistant', text: 'Two findings: a missing **null check** and a stale test name.' });
  });

  it('HIST-3.3: a Session whose Transcript is gone reads from the index, and says so', async () => {
    const d = await history().detail(NO_TRANSCRIPT, 'claude');
    expect(d).toMatchObject({ source: 'index', item: { blocked: 'transcript-missing' } });
  });

  it('HIST-3.3: unknown and ambiguous ids are errors; an odd id never reaches tb-session', async () => {
    await expect(history().detail(CODEX, 'claude')).rejects.toMatchObject({ status: 404 });
    const ambiguous = new History({
      runner: vi.fn(async () => {
        throw Object.assign(new Error('exit 1'), { code: 1, stderr: 'Error: ambiguous', stdout: JSON.stringify({ error: 'ambiguous_session_id', message: 'x', candidates: [] }) });
      }),
      bin: () => 'tb-session',
    });
    await expect(ambiguous.detail('abc', 'claude')).rejects.toMatchObject({ status: 409 });
    const runner = vi.fn(async () => '{}');
    await expect(new History({ runner, bin: () => 'tb' }).detail('--help', 'claude')).rejects.toMatchObject({ status: 400 });
    expect(runner).not.toHaveBeenCalled();
  });

  it('HIST-3.3: a conversation longer than 20: 0.3 gives its latest 20; 0.2, which can\u2019t tail, its first 20, labelled so', async () => {
    const LONG = 'abababab-0000-4000-8000-000000000901';
    const messages = Array.from({ length: 24 }, (_, n) => ({ role: n % 2 ? 'assistant' : 'user', content: `message ${n + 1}`, timestamp: '2026-10-16T08:00:00.000Z' }));
    const file = join(dir, 'long.json');
    writeFileSync(file, JSON.stringify([{ session_id: LONG, harness: 'claude', headless: false, summary: 'long', first_prompt: 'message 1', project_path: '@root/gone', messages }]));
    const latest = await history({ FAKE_TB_SESSION_FILE: file }).detail(LONG, 'claude');
    expect(latest).toMatchObject({ preview: 'latest', totalMessages: 24 });
    expect(latest.entries.map((e) => (e.kind === 'user' || e.kind === 'assistant' ? e.text : ''))).toEqual(messages.slice(-20).map((m) => m.content));
    const first = await history({ FAKE_TB_SESSION_FILE: file, FAKE_TB_SESSION_VERSION: '0.2.0' }).detail(LONG, 'claude');
    expect(first).toMatchObject({ preview: 'first', totalMessages: 24 });
    expect(first.entries.map((e) => (e.kind === 'user' || e.kind === 'assistant' ? e.text : ''))).toEqual(messages.slice(0, 20).map((m) => m.content));
    // A short one from 0.2 is the whole conversation.
    expect(await history({ FAKE_TB_SESSION_VERSION: '0.2.0' }).detail(GONE, 'claude')).toMatchObject({ preview: 'all', totalMessages: 4 });
  });

  it('HIST-3.3: with tb-session 0.2 (no `--harness`, no `--tail`) it still opens', async () => {
    const d = await history({ FAKE_TB_SESSION_VERSION: '0.2.0' }).detail(GONE, 'claude');
    expect(d.entries.length).toBeGreaterThan(0);
    expect(calls(tbLog).at(-1)).toEqual(['show', '--json', '--', GONE]);
  });
});

describe('clicking a past Session (HIST-3), end to end through fake tb-session and fleet', () => {
  function setup(over: Partial<NodeJS.ProcessEnv> = {}) {
    const fleetEnv = { ...env, ...over };
    const events: { launches: number; started: { launchId: string; sessionId: string }[] }[] = [];
    const launcher = new Launcher({
      runner: run,
      fleetBin: () => FAKE_FLEET,
      settings: { get: defaultSettings, update: async () => defaultSettings() },
      onChange: (l, started) => events.push({ launches: l.length, started }),
      env: fleetEnv,
    });
    const list = () => fetchFleetList((f, a, o) => run(f, a, { ...o, env: fleetEnv }), FAKE_FLEET);
    const isLive = vi.fn(async (id: string, harness: string) => {
      const l = await list();
      return l.kind === 'ok' && l.rows.some((r) => r.session_id === id && r.harness === harness);
    });
    const h = history();
    const spawns = () => calls(fleetLog).filter((a) => a.includes('spawn'));
    /** FAKE_FLEET_REGISTER=later: the spawned Sessions register now. */
    const register = () => run(FAKE_FLEET, ['fake', 'register'], { timeoutMs: 5000, env: fleetEnv });
    return { launcher, list, isLive, deps: { history: h, launcher, isLive }, events, spawns, register, fleetEnv };
  }
  const observeFleet = async (t: ReturnType<typeof setup>, launcher = t.launcher) => {
    const l = await t.list();
    if (l.kind !== 'ok') throw new Error('list');
    launcher.observe(l.rows);
  };

  it('HIST-3.1: a resumable one starts again in its own Session host, in its start directory, then becomes the live Session', async () => {
    const t = setup();
    const result = await resumePast(t.deps, { sessionId: CODEX, harness: 'codex' });
    expect(result).toMatchObject({ kind: 'started', launch: { state: 'starting', title: 'kg-hook-review', harness: 'codex', directory: join(dir, 'work') } });
    expect(t.spawns()).toEqual([['--local', 'spawn', '--resume', CODEX, '--harness', 'codex', '--dir', join(dir, 'work'), '--backend', 'tmux', '--json']]);
    expect(t.launcher.list()).toHaveLength(1); // the "Starting…" row
    const l = await t.list();
    if (l.kind !== 'ok') throw new Error('list');
    t.launcher.observe(l.rows);
    expect(t.launcher.list()).toEqual([]);
    expect(t.events.at(-1)!.started).toEqual([{ launchId: (result as { launch: { id: string } }).launch.id, sessionId: CODEX }]);
    t.launcher.stop();
  });

  it('HIST-3.2: a live one is selected; a second process is never started', async () => {
    const t = setup();
    expect(await resumePast(t.deps, { sessionId: LIVE, harness: 'claude' })).toEqual({ kind: 'live', sessionId: LIVE });
    expect(t.spawns()).toEqual([]);
    // A race: it went live after the check. Fleet refuses (`session_live`), and it's selected all the same.
    t.isLive.mockResolvedValueOnce(false);
    expect(await resumePast(t.deps, { sessionId: LIVE, harness: 'claude' })).toEqual({ kind: 'live', sessionId: LIVE });
    expect(t.spawns()).toHaveLength(1);
    expect(t.launcher.list()).toEqual([]);
  });

  it('HIST-3.3: one whose start directory is gone, or whose Transcript is, is never resumed: it opens read-only', async () => {
    const t = setup();
    expect(await resumePast(t.deps, { sessionId: GONE, harness: 'claude' })).toEqual({ kind: 'blocked', harness: 'claude', sessionId: GONE, blocked: 'folder-gone' });
    expect(await resumePast(t.deps, { sessionId: NO_TRANSCRIPT, harness: 'claude' })).toMatchObject({ kind: 'blocked', blocked: 'transcript-missing' });
    expect(t.spawns()).toEqual([]);
  });

  it('HIST-3.3: a start directory deleted between listing and clicking: read-only, not an error, and never resumed', async () => {
    const t = setup();
    const listed = await ok(find(history()));
    expect(listed.items.find((i) => i.sessionId === CODEX)!.blocked).toBeNull();
    rmSync(join(dir, 'work'), { recursive: true });
    expect(await resumePast(t.deps, { sessionId: CODEX, harness: 'codex' })).toEqual({ kind: 'blocked', harness: 'codex', sessionId: CODEX, blocked: 'folder-gone' });
    expect(t.spawns()).toEqual([]);
  });

  it('HIST-3.3: a start directory deleted after the check but before the spawn: Fleet\u2019s `dir_missing` opens it read-only too', async () => {
    const t = setup();
    const h = history();
    // The directory goes right after tb-session's answer was checked.
    const lookup = async (id: string, harness: 'claude' | 'codex') => {
      const item = await h.lookup(id, harness);
      rmSync(join(dir, 'work'), { recursive: true });
      return item;
    };
    const result = await resumePast({ ...t.deps, history: { lookup } }, { sessionId: CODEX, harness: 'codex' });
    expect(result).toEqual({ kind: 'blocked', harness: 'codex', sessionId: CODEX, blocked: 'folder-gone' });
    expect(t.spawns()).toHaveLength(1); // Fleet refused it
    expect(t.launcher.list()).toEqual([]);
    t.launcher.stop();
  });

  it('HIST-3.2: concurrent clicks while the Session is slow to register start one process; both get its "Starting…" row', async () => {
    const t = setup({ FAKE_FLEET_REGISTER: 'later' });
    const [a, b] = await Promise.all([
      resumePast(t.deps, { sessionId: CODEX, harness: 'codex' }),
      resumePast(t.deps, { sessionId: CODEX, harness: 'codex' }),
    ]);
    expect(t.spawns()).toHaveLength(1);
    expect(a).toMatchObject({ kind: 'started' });
    expect(b).toEqual(a);
    expect(t.launcher.list()).toHaveLength(1);
    // A third click, after the first resolved: still that row; no tb-session or Fleet call at all.
    const before = { tb: calls(tbLog).length, fleet: calls(fleetLog).length };
    expect(await resumePast(t.deps, { sessionId: CODEX, harness: 'codex' })).toEqual(a);
    expect({ tb: calls(tbLog).length, fleet: calls(fleetLog).length }).toEqual(before);
    await t.register();
    await observeFleet(t);
    expect(t.events.at(-1)!.started).toEqual([{ launchId: (a as { launch: { id: string } }).launch.id, sessionId: CODEX }]);
    t.launcher.stop();
  });

  it('HIST-3.2: Fleet\u2019s `session_starting` (another Lookout\u2019s resume not registered yet) keeps a "Starting…" row tied to the Session, never retried', async () => {
    const t = setup({ FAKE_FLEET_REGISTER: 'later' });
    await resumePast(t.deps, { sessionId: CODEX, harness: 'codex' });
    // Another Lookout, sharing the machine's Fleet.
    const otherEvents: { started: { launchId: string; sessionId: string }[] }[] = [];
    const other = new Launcher({
      runner: run,
      fleetBin: () => FAKE_FLEET,
      settings: { get: defaultSettings, update: async () => defaultSettings() },
      onChange: (_l, started) => otherEvents.push({ started }),
      env: t.fleetEnv,
    });
    const result = await resumePast({ ...t.deps, launcher: other }, { sessionId: CODEX, harness: 'codex' });
    expect(result).toMatchObject({ kind: 'started', launch: { state: 'starting', harness: 'codex' } });
    expect(t.spawns()).toHaveLength(2); // Fleet refused the second; nothing was started twice
    expect(other.list()).toHaveLength(1);
    await t.register();
    await observeFleet(t, other);
    expect(other.list()).toEqual([]);
    expect(otherEvents.at(-1)!.started).toEqual([{ launchId: (result as { launch: { id: string } }).launch.id, sessionId: CODEX }]);
    t.launcher.stop();
    other.stop();
  });

  it('refuses a request it can’t trust; the directory never comes from the browser', async () => {
    const t = setup();
    await expect(resumePast(t.deps, { sessionId: '-rf', harness: 'claude' })).rejects.toMatchObject({ status: 400 });
    await expect(resumePast(t.deps, { sessionId: CODEX, harness: 'pi' })).rejects.toMatchObject({ status: 400 });
    await resumePast(t.deps, { sessionId: CODEX, harness: 'codex', directory: '/etc' }).catch(() => {});
    expect(t.spawns()[0]).toContain(join(dir, 'work'));
    expect(t.spawns()[0]).not.toContain('/etc');
    t.launcher.stop();
  });
});
