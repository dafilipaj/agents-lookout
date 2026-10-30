import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderUsage, UsageSnapshot } from '../shared/usage.ts';
import { freshness, liveWindows, stripWindows, tightestFirst, usageLevel } from '../shared/usage.ts';
import { TB_JEV_INSTALL_COMMAND } from '../shared/defaults.ts';
import { neededVersion } from '../shared/tools.ts';
import { type RunOptions, run } from './exec.ts';
import { sanitizeLine } from './sanitize.ts';
import {
  CODEX_NOT_YET,
  JEV_UPDATE_NEEDED,
  UsageMonitor,
  UsageShapeError,
  acceptReading,
  parseFleetUsage,
  probeJev,
  resolveJevBin,
  usageFailure,
} from './usage.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/usage/${name}`, import.meta.url), 'utf8');
const providers = fixture('fleet-providers-2026-10-16.json'); // the fork: providers[]
const upstream = fixture('claude-2026-10-16.json'); // upstream Fleet: top-level Claude only

describe('reading `fleet usage --json` (the fork’s providers[])', () => {
  it('USAGE-1.1: Claude and Codex, each with plan and windows tightest first, keeping kind and label', () => {
    const { claude, codex } = parseFleetUsage(providers);
    expect(claude).toMatchObject({ id: 'claude', state: 'ok', plan: 'Team · Max 5x', stale: false, reason: null, credits: null });
    expect(claude!.windows.map((w) => [w.kind, w.label, w.model])).toEqual([
      ['session', 'Current session', null],
      ['weekly_all', 'Weekly · all models', null],
      ['weekly_scoped', 'Weekly · Fable', 'Fable'],
    ]);
    expect(claude!.extra).toEqual({ enabled: false, used: 0, limit: null, currency: 'USD', percent: 0 });
    expect(codex).toMatchObject({ id: 'codex', state: 'ok', plan: 'Plus', extra: null, credits: { hasCredits: false, unlimited: false, balance: '0' } });
    expect(codex!.windows.map((w) => [w.kind, w.label]).sort()).toEqual([
      ['session', '5h limit'],
      ['weekly_all', 'Weekly limit'],
    ]);
    expect(codex!.windows[0]!.percent).toBeGreaterThanOrEqual(codex!.windows[1]!.percent); // tightest first
    // Codex's age comes from its last turn, not from when Fleet read it.
    const raw = JSON.parse(providers).providers[1];
    expect(codex!.observedAt).toBe(Date.parse(raw.observed_at));
    expect(codex!.fetchedAt).toBe(Date.parse(raw.fetched_at));
    expect(codex!.observedAt).toBeLessThan(codex!.fetchedAt!);
  });

  it('maps every provider status', () => {
    const one = (entry: Record<string, unknown>) =>
      parseFleetUsage(JSON.stringify({ providers: [{ id: 'codex', label: 'Codex', plan: null, limits: [], fetched_at: null, observed_at: null, error: null, credits: null, ...entry }] })).codex!;
    const limit = { kind: 'session', group: 'session', label: '5h limit', model: null, percent: 40, severity: 'normal', resets_at: '2026-10-16T18:00:00Z', active: true };
    expect(one({ status: 'ok', limits: [limit] })).toMatchObject({ state: 'ok', stale: false });
    expect(one({ status: 'stale', limits: [limit], error: 'rate limited' })).toMatchObject({ state: 'ok', stale: true, reason: 'rate limited' });
    expect(one({ status: 'no_data' })).toMatchObject({ state: 'no-data' });
    expect(one({ status: 'not_installed' })).toMatchObject({ state: 'not-installed' });
    expect(one({ status: 'error', limits: [limit], error: 'boom' })).toMatchObject({ state: 'error', reason: 'boom', windows: [] });
    expect(one({ status: 'error', error: 'login expired' })).toMatchObject({ state: 'signed-out' });
    expect(one({ status: 'sideways' })).toMatchObject({ state: 'error', windows: [] }); // unknown enum
    // A Codex window whose reset passed comes back at 0% with no reset time.
    expect(one({ status: 'ok', limits: [{ ...limit, percent: 0, resets_at: null }] }).windows[0]).toMatchObject({ percent: 0, resetsAt: null });
    // Unknown kinds, and envelopes the contract doesn't have, are dropped.
    expect(one({ status: 'ok', limits: [{ ...limit, kind: 'monthly' }, limit] }).windows).toHaveLength(1);
    // A list with entries that are all rejected is an error, not "no data" (review #3).
    for (const bad of [[{ ...limit, kind: 'monthly' }], [{ ...limit, percent: '98' }], [{ ...limit, percent: null }], ['x']]) {
      expect(one({ status: 'ok', limits: bad })).toMatchObject({ state: 'error', reason: "Fleet sent limits Lookout doesn't understand" });
    }
    expect(parseFleetUsage(JSON.stringify({ limits: [{ kind: 'monthly', percent: 5 }] })).claude).toMatchObject({ state: 'error' });
    // Codex per-model windows: the short one is `session_scoped`.
    const scoped = one({
      status: 'ok',
      limits: [
        { ...limit, kind: 'session_scoped', model: 'gpt-6-luna', label: '5h limit · gpt-6-luna', percent: 71 },
        { ...limit, kind: 'weekly_scoped', model: 'gpt-6-luna', label: 'Weekly limit · gpt-6-luna', percent: 30 },
      ],
    });
    expect(scoped.windows.map((w) => [w.kind, w.model, w.label])).toEqual([
      ['session_scoped', 'gpt-6-luna', '5h limit · gpt-6-luna'],
      ['weekly_scoped', 'gpt-6-luna', 'Weekly limit · gpt-6-luna'],
    ]);
    expect(parseFleetUsage(JSON.stringify({ providers: [], claude: {} }))).toEqual({});
  });

  it('falls back to the top-level Claude fields only without providers[] (upstream Fleet)', () => {
    const { claude, codex } = parseFleetUsage(upstream);
    expect(codex).toBeUndefined();
    expect(claude).toMatchObject({ state: 'ok', plan: 'Team · Max 5x' });
    expect(claude!.windows.map((w) => w.percent)).toEqual([23, 19, 0]);
  });

  it('USAGE-2.2: structured failures are failures, and shapes it doesn’t know are errors', () => {
    expect(parseFleetUsage(JSON.stringify({ limits: [], error: 'login expired — run claude' })).claude).toMatchObject({ state: 'signed-out', windows: [] });
    // Limits that come with an error aren't "ok".
    const withError = parseFleetUsage(JSON.stringify({ ...JSON.parse(upstream), error: 'usage endpoint answered HTTP 500' })).claude!;
    expect(withError).toMatchObject({ state: 'error', windows: [] });
    for (const garbage of ['{}', '[]', '"x"', 'not json', JSON.stringify({ providers: 'no' })]) {
      expect(() => parseFleetUsage(garbage)).toThrow(UsageShapeError);
    }
  });

  it('USAGE-2.2: a failure keeps the newest numbers, marked old, with the reason', () => {
    const good = parseFleetUsage(providers).claude!;
    const failed = parseFleetUsage(JSON.stringify({ limits: [], error: 'login expired' })).claude!;
    expect(acceptReading(good, failed).shown).toMatchObject({ state: 'signed-out', stale: true, reason: 'login expired', windows: good.windows });
    expect(acceptReading(undefined, failed).shown).toEqual(failed);
  });

  it('USAGE-2.2: an older reading never becomes current again, however often it repeats (review #2)', () => {
    const codex = (percent: number, at: string): ProviderUsage => ({
      id: 'codex', state: 'ok', reason: null, plan: 'Plus', extra: null, credits: null, stale: false,
      windows: [{ kind: 'session', label: '5h limit', model: null, percent, resetsAt: null }],
      fetchedAt: Date.parse('2026-10-16T14:05:00Z'), observedAt: Date.parse(at),
    });
    let hw: ProviderUsage | undefined;
    const step = (r: ProviderUsage) => {
      const out = acceptReading(hw, r);
      hw = out.highWater;
      return out.shown;
    };
    expect(step(codex(98, '2026-10-16T14:00:00Z'))).toMatchObject({ stale: false, windows: [{ percent: 98 }] });
    for (let i = 0; i < 2; i++) {
      // 13:59 twice: the 14:00 numbers stay, marked old.
      expect(step(codex(10, '2026-10-16T13:59:00Z'))).toMatchObject({ stale: true, reason: 'Fleet returned older numbers than before', windows: [{ percent: 98 }], observedAt: Date.parse('2026-10-16T14:00:00Z') });
    }
    // Something at least as new is current again.
    expect(step(codex(20, '2026-10-16T14:01:00Z'))).toMatchObject({ stale: false, windows: [{ percent: 20 }] });
    expect(step(codex(25, '2026-10-16T14:01:00Z'))).toMatchObject({ stale: false, windows: [{ percent: 25 }] });
  });

  it('USAGE-1.2: 80% or more is a warning, 95% or more critical; tightest is highest %, then soonest reset', () => {
    expect([79.9, 80, 94.9, 95, 100].map(usageLevel)).toEqual(['normal', 'warning', 'warning', 'critical', 'critical']);
    const w = (percent: number, resetsAt: number | null) => ({ kind: 'session' as const, label: 'l', model: null, percent, resetsAt });
    expect(tightestFirst([w(50, 9), w(90, 5), w(90, 2), w(90, null)]).map((x) => [x.percent, x.resetsAt])).toEqual([
      [90, 2],
      [90, 5],
      [90, null],
      [50, 9],
    ]);
    // A window whose reset passed no longer counts.
    expect(liveWindows([w(100, 1000), w(40, 5000)], 2000).map((x) => x.percent)).toEqual([40]);
  });

  it('USAGE-1.2: each % is rounded once, on reading, so a mark goes by the number shown', () => {
    const limit = (percent: number) => ({ kind: 'session', group: 'session', label: '5h limit', model: null, percent, severity: 'normal', resets_at: null, active: true });
    const read = (percent: number) => {
      const out = parseFleetUsage(
        JSON.stringify({
          extra_usage: { enabled: true, used: 1, limit: 10, currency: 'USD', percent },
          providers: [{ id: 'claude', label: 'Claude', status: 'ok', plan: null, limits: [limit(percent)], fetched_at: null, observed_at: null, error: null, credits: null }],
        }),
      ).claude!;
      return [out.windows[0]!.percent, out.extra!.percent];
    };
    expect([79.4, 79.6, 94.4, 94.5].map(read)).toEqual([[79, 79], [80, 80], [94, 94], [95, 95]]);
    // 79.6 shows as 80% with a warning, 94.5 as 95% with the critical mark.
    expect([79.6, 94.5].map((p) => usageLevel(read(p)[0]!))).toEqual(['warning', 'critical']);
  });

  it('USAGE-1.1: the strip shows the tightest 5-hour window, and the tightest weekly one (per-model counted) beside it; weekly alone only when no 5-hour one was reported', () => {
    type Kind = 'session' | 'session_scoped' | 'weekly_all' | 'weekly_scoped';
    const w = (kind: Kind, percent: number, resetsAt: number | null = 9000) => ({ kind, label: kind, model: kind.endsWith('scoped') ? 'm' : null, percent, resetsAt });
    const pick = (ws: ReturnType<typeof w>[], now = 0) => {
      const p = stripWindows(ws, now);
      return p && [p.main.kind, p.main.percent, p.weekly?.kind ?? null, p.weekly?.percent ?? null];
    };
    expect(pick([w('weekly_all', 42), w('session', 3)])).toEqual(['session', 3, 'weekly_all', 42]);
    expect(pick([w('session', 30), w('weekly_all', 20), w('weekly_scoped', 64)])).toEqual(['session', 30, 'weekly_scoped', 64]);
    expect(pick([w('session', 10), w('session_scoped', 50), w('weekly_all', 5)])).toEqual(['session_scoped', 50, 'weekly_all', 5]);
    expect(pick([w('session', 10)])).toEqual(['session', 10, null, null]);
    // No 5-hour window reported at all: the weekly window takes its place.
    expect(pick([w('weekly_all', 19), w('weekly_scoped', 33)])).toEqual(['weekly_scoped', 33, null, null]);
    // A 5-hour window whose reset passed counts as 0% with no reset time until the new read, as
    // Fleet reports a passed Codex window: it keeps the bar, and the weekly one stays in brackets.
    expect(pick([w('session', 100, 1000), w('weekly_all', 20)], 2000)).toEqual(['session', 0, 'weekly_all', 20]);
    expect(stripWindows([w('session', 100, 1000), w('weekly_all', 20)], 2000)!.main).toMatchObject({ kind: 'session', percent: 0, resetsAt: null });
    expect(pick([w('session', 100, 1000)], 2000)).toEqual(['session', 0, null, null]);
    // One that still holds is tighter than one at 0%; a passed weekly window stays in brackets at 0%.
    expect(pick([w('session', 100, 1000), w('session_scoped', 30)], 2000)).toEqual(['session_scoped', 30, null, null]);
    expect(pick([w('session', 10), w('weekly_all', 90, 1000)], 2000)).toEqual(['session', 10, 'weekly_all', 0]);
    expect(pick([])).toBeNull();
  });
});

describe('freshness (USAGE-2.2): missing, invalid, future and old times never look fresh', () => {
  const now = Date.parse('2026-10-16T14:00:00Z');
  const p = (over: Partial<ProviderUsage>) => ({ id: 'claude' as const, observedAt: null, fetchedAt: null, stale: false, state: 'ok' as const, ...over });
  it('reads them right', () => {
    expect(freshness(p({ observedAt: now - 60_000 }), now)).toEqual({ kind: 'fresh', at: now - 60_000 });
    expect(freshness(p({ fetchedAt: now - 10 * 60_000 }), now)).toEqual({ kind: 'old', at: now - 10 * 60_000 });
    expect(freshness(p({}), now)).toEqual({ kind: 'unknown' });
    expect(freshness(p({ observedAt: Number.NaN }), now)).toEqual({ kind: 'unknown' });
    expect(freshness(p({ observedAt: now + 30_000 }), now).kind).toBe('fresh'); // within skew
    expect(freshness(p({ observedAt: now + 5 * 60_000 }), now).kind).toBe('skew');
    expect(freshness(p({ observedAt: now - 1000, stale: true }), now).kind).toBe('old');
    // Codex: its numbers are as of its last turn, shown neutrally however long ago that was…
    expect(freshness(p({ id: 'codex', observedAt: now - 17 * 60_000, fetchedAt: now }), now)).toEqual({ kind: 'last-turn', at: now - 17 * 60_000 });
    // …but only from `observed_at`: the read time is no stand-in (review #4).
    expect(freshness(p({ id: 'codex', observedAt: null, fetchedAt: now }), now)).toEqual({ kind: 'unknown' });
    expect(freshness(p({ id: 'codex', observedAt: now - 60_000, stale: true }), now).kind).toBe('old');
    // Legacy Claude data may fall back to the read time.
    expect(freshness(p({ observedAt: null, fetchedAt: now - 60_000 }), now).kind).toBe('fresh');
    // Invalid times from Fleet become "unknown", not "now".
    const bad = parseFleetUsage(JSON.stringify({ providers: [{ id: 'codex', status: 'ok', limits: [{ kind: 'session', label: 'x', percent: 1 }], fetched_at: '2026-10-16T13:59:00+00:00', observed_at: 12 }] })).codex!;
    expect(freshness(bad, now)).toEqual({ kind: 'unknown' });
  });
});

describe('secrets never reach the UI (review #1)', () => {
  const secrets = ['sk-ant-api03-AbCdEf123456', 'Bearer eyJhbGciOiJIUzI1NiJ9.abc', 'hunter2', 'Zm9vYmFyYmF6cXV4cXV1eHF1dXhxdXV4cXV1eA', 'deadbeefdeadbeefdeadbeefdeadbeef'];
  const leaks = (s: string) => secrets.filter((x) => s.includes(x));

  it('redacts and bounds reasons', () => {
    expect(sanitizeLine('error: auth failed for https://dario:hunter2@api.example.com with sk-ant-api03-AbCdEf123456')).toBe(
      'auth failed for https://…@api.example.com with sk-…',
    );
    expect(sanitizeLine('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc')).not.toContain('eyJ');
    expect(sanitizeLine('token=Zm9vYmFyYmF6cXV4cXV1eHF1dXhxdXV4cXV1eA rest')).toBe('token=… rest');
    expect(sanitizeLine('word '.repeat(100))!.length).toBe(160);
    expect(sanitizeLine('x'.repeat(500))).toBe('…'); // one long run is token-like
    expect(sanitizeLine('first\nsecond')).toBe('first');
  });

  it('decodes JSON escapes and redacts the whole text before picking a line and cutting it (review nit)', () => {
    expect(sanitizeLine('key sk\\u002dant-api03-AbCdEf123456 refused')).toBe('key sk-… refused');
    const cut = sanitizeLine(`${'word '.repeat(30)}sk-ant-api03-AbCdEf123456`, 160)!;
    expect(cut).not.toMatch(/sk-a/);
    expect(sanitizeLine('Authorization: Bearer\\u0020eyJhbGciOiJIUzI1NiJ9.abc')).not.toContain('eyJ');
  });

  it('nothing token-like from Fleet or tb-jev reaches the snapshot that is sent to tabs', async () => {
    const fleetOut = JSON.stringify({
      providers: [
        { id: 'claude', status: 'error', plan: 'sk-ant-api03-AbCdEf123456', limits: [], error: 'HTTP 401 Bearer eyJhbGciOiJIUzI1NiJ9.abc deadbeefdeadbeefdeadbeefdeadbeef', fetched_at: null, observed_at: null, credits: null },
        { id: 'codex', status: 'ok', plan: 'Plus', limits: [{ kind: 'session', label: 'https://u:hunter2@x.io', percent: 3, resets_at: null }], error: null, fetched_at: null, observed_at: null, credits: null },
      ],
    });
    const jevOut = JSON.stringify({
      version: '0.2.0', ready: false, key_present: false, key_source: 'none', base_url: 'https://u:hunter2@api.typesafe.ai/v1?key=sk-ant-api03-AbCdEf123456',
      base_url_has_path: true, base_url_hidden: 'Zm9vYmFyYmF6cXV4cXV1eHF1dXhxdXV4cXV1eA', base_url_source: 'env', config_path: null, config_exists: false,
      config_valid: null, config_used: false, error_reason: 'key sk-ant-api03-AbCdEf123456 rejected (Zm9vYmFyYmF6cXV4cXV1eHF1dXhxdXV4cXV1eA)',
    });
    const sent: UsageSnapshot[] = [];
    const monitor = new UsageMonitor({
      runner: async (file) => {
        if (file === '/bin/fleet') return fleetOut;
        throw Object.assign(new Error('x'), { code: 4, stdout: jevOut, stderr: '' });
      },
      fleetBin: () => '/bin/fleet',
      jevBin: () => '/bin/tb-jev',
      onChange: (u) => sent.push(u),
    });
    await monitor.tick();
    const wire = JSON.stringify(sent);
    expect(leaks(wire)).toEqual([]);
    expect(sent[0]!.jev).toMatchObject({ state: 'not-set-up', baseUrl: null });

    // Fleet failing outright, with secrets on stderr.
    const failing = usageFailure(Object.assign(new Error('x'), { code: 1, stderr: 'error: request to https://u:hunter2@api.anthropic.com failed: Bearer eyJhbGciOiJIUzI1NiJ9.abc\n' }));
    expect(leaks(JSON.stringify(failing))).toEqual([]);
    expect(failing.claude.reason).toMatch(/^usage unavailable: request to https:\/\/…@api.anthropic.com failed: Bearer …$/);
  });
});

describe('Jev (USAGE-1.4): `tb-jev status --json` through a fake tb-jev on PATH', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lookout-jev-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function fakeJev(name: string, script: string): { env: NodeJS.ProcessEnv; argsFile: string } {
    const bin = join(dir, name, 'bin');
    mkdirSync(bin, { recursive: true });
    const argsFile = join(dir, name, 'args');
    writeFileSync(join(bin, 'tb-jev'), `#!/bin/sh\necho "$@" >> '${argsFile}'\n${script}\n`);
    chmodSync(join(bin, 'tb-jev'), 0o755);
    return { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: join(dir, name, 'home') }, argsFile };
  }
  /** tb-jev 0.2.0's 13 fields. */
  const status = (over: Record<string, unknown>) =>
    JSON.stringify({
      version: '0.2.0',
      ready: true,
      key_present: true,
      key_source: 'env',
      base_url: 'https://api.typesafe.ai',
      base_url_source: 'default',
      base_url_has_path: false,
      base_url_hidden: null,
      config_path: '/Users/me/.config/tb-jev/config.toml',
      config_exists: false,
      config_valid: null,
      config_used: false,
      error_reason: null,
      ...over,
    });
  const probe = (env: NodeJS.ProcessEnv) => probeJev(run, resolveJevBin(env), env);

  it('missing binary: "not installed", nothing run', async () => {
    const env = { PATH: join(dir, 'nowhere'), HOME: join(dir, 'nohome') };
    expect(resolveJevBin(env)).toBeNull();
    expect(await probe(env)).toMatchObject({ state: 'not-installed', reason: 'not installed' });
  });

  it('TOOLS-2.5: a tb-jev exit 2 that is not clap refusing a subcommand or long flag is a failure, not "too old"', async () => {
    const { env } = fakeJev('other', `echo "error: something else" >&2; exit 2`);
    expect(await probe(env)).toMatchObject({ state: 'error', reason: 'tb-jev status failed (exit 2)' });
  });

  it('TOOLS-2.5: an old binary (0.1: clap exits 2 on `status`) is older than the usage strip needs, the version from the table, with its update command; never "not installed"', async () => {
    const { env } = fakeJev('old', `echo "error: unrecognized subcommand 'status'" >&2; exit 2`);
    expect(await probe(env)).toEqual({ state: 'unavailable', reason: JEV_UPDATE_NEEDED, version: null, keySource: null, baseUrl: null, configPath: null, fix: TB_JEV_INSTALL_COMMAND });
    expect(JEV_UPDATE_NEEDED).toBe(`tb-jev is older than the usage strip needs (${neededVersion('tb-jev', 'the usage strip')})`);
    expect(JEV_UPDATE_NEEDED).toBe('tb-jev is older than the usage strip needs (0.2.0)');
  });

  it('not ready (exit 4, the object still printed): "not set up: <error_reason>"', async () => {
    const { env } = fakeJev(
      'not-ready',
      `echo '${status({ ready: false, key_present: false, key_source: 'none', config_valid: false, error_reason: 'no TYPESAFE_API_KEY and no config file' })}'; exit 4`,
    );
    expect(await probe(env)).toEqual({
      state: 'not-set-up',
      reason: 'not set up: no TYPESAFE_API_KEY and no config file',
      version: '0.2.0',
      keySource: 'none',
      baseUrl: 'https://api.typesafe.ai',
      configPath: null,
    });
  });

  it('ready (exit 0): version, key source and base URL; only `status --json` is ever run', async () => {
    const { env, argsFile } = fakeJev('ready', `echo '${status({ key_source: 'config', config_used: true, config_exists: true, config_valid: true })}'`);
    expect(await probe(env)).toEqual({
      state: 'ready',
      reason: null,
      version: '0.2.0',
      keySource: 'config file',
      baseUrl: 'https://api.typesafe.ai',
      configPath: '/Users/me/.config/tb-jev/config.toml',
    });
    expect(readFileSync(argsFile, 'utf8')).toBe('status --json\n'); // never doctor, ask or --version
    expect((await probe(fakeJev('ready-env', `echo '${status({})}'`).env)).keySource).toBe('env TYPESAFE_API_KEY');
  });

  it('a malformed or contradictory object is an error, never ready (review #10)', async () => {
    const cases: [string, string][] = [
      ['no-ready', `echo '${status({ ready: 'yes' })}'`],
      ['bad-source', `echo '${status({ key_source: 'vault' })}'`],
      ['no-version', `echo '${status({ version: 2 })}'`],
      ['ready-exit-4', `echo '${status({})}'; exit 4`],
      ['not-ready-exit-0', `echo '${status({ ready: false })}'`],
      ['ready-no-key', `echo '${status({ key_source: 'none' })}'`],
      ['ready-key-absent', `echo '${status({ key_present: false })}'`],
      ['garbled', `echo 'not json'`],
      ['broken', `echo "disk full" >&2; exit 1`],
    ];
    for (const [name, script] of cases) {
      const result = await probe(fakeJev(name, script).env);
      expect(result.state, name).toBe('error');
    }
    // A base URL with a path or credentials isn't shown at all.
    expect((await probe(fakeJev('pathy', `echo '${status({ base_url: 'https://api.typesafe.ai/v1/secret' })}'`).env)).baseUrl).toBeNull();
  });
});

describe('UsageMonitor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(fleet: () => Promise<string>, jev?: () => Promise<string>) {
    const calls: { file: string; args: readonly string[]; opts: RunOptions }[] = [];
    const runner = vi.fn(async (file: string, args: readonly string[], opts: RunOptions) => {
      calls.push({ file, args, opts });
      if (file === '/bin/fleet') return fleet();
      if (jev) return jev();
      throw Object.assign(new Error('x'), { code: 2, stderr: "error: unrecognized subcommand 'status'" });
    });
    const changes: UsageSnapshot[] = [];
    const monitor = new UsageMonitor({
      runner,
      fleetBin: () => '/bin/fleet',
      jevBin: () => '/bin/tb-jev',
      onChange: (u) => changes.push(u),
      env: { PATH: '/usr/bin', CLAUDECODE: '1', OTEL_X: 'y' },
    });
    const count = (file: string) => calls.filter((c) => c.file === file).length;
    return { monitor, calls, changes, count };
  }

  it('USAGE-1.3: one poller for every tab, every 60 s, only while a tab is connected', async () => {
    const t = setup(async () => providers);
    const a = t.monitor.watch();
    const b = t.monitor.watch();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.count('/bin/fleet')).toBe(1);
    expect(t.calls[0]).toMatchObject({ args: ['--local', 'usage', '--json'] });
    expect(Object.keys(t.calls[0]!.opts.env!)).toEqual(['PATH']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.count('/bin/fleet')).toBe(2);
    a();
    b();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(t.count('/bin/fleet')).toBe(2);
    expect(t.calls.some((c) => c.args.includes('doctor') || c.args.includes('--version') || c.args.includes('ask'))).toBe(false);
  });

  it('the 60 s cadence counts from each read’s start, so a slow read doesn’t make it drift (review #13)', async () => {
    const t = setup(() => new Promise((r) => setTimeout(() => r(providers), 5000)));
    t.monitor.watch();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(t.count('/bin/fleet')).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.count('/bin/fleet')).toBe(2); // at 60 s, not 65 s
  });

  it('USAGE-2.2: Codex missing from Fleet’s answer is "not available yet"; a failed read keeps old numbers marked old', async () => {
    let answer: () => string = () => upstream;
    const t = setup(async () => answer());
    await t.monitor.tick();
    expect(t.monitor.snapshot()!.providers[1]).toMatchObject({ id: 'codex', state: 'unavailable', reason: CODEX_NOT_YET });

    answer = () => providers;
    await t.monitor.tick();
    answer = () => {
      throw Object.assign(new Error('x'), { code: 1, stderr: 'error: usage endpoint answered HTTP 503\n' });
    };
    await t.monitor.tick();
    const [claude, codex] = t.monitor.snapshot()!.providers;
    // Fleet exits 1 with no JSON when Claude can't be read, so Codex is lost too: both keep old numbers.
    expect(claude).toMatchObject({ state: 'error', stale: true, reason: 'usage unavailable: usage endpoint answered HTTP 503' });
    expect(claude!.windows).toHaveLength(3);
    expect(codex).toMatchObject({ state: 'error', stale: true, reason: 'usage unavailable: usage endpoint answered HTTP 503' });
    expect(codex!.windows).toHaveLength(2);

    answer = () => '{}';
    await t.monitor.tick();
    expect(t.monitor.snapshot()!.providers[0]).toMatchObject({ state: 'error', stale: true, reason: "usage unavailable: Fleet's usage answer has no limits" });
  });

  it('Fleet exiting 1 with providers JSON: Claude gets its error with old numbers, Codex stays live', async () => {
    let fail = false;
    const t = setup(async () => {
      if (!fail) return providers;
      const answer = JSON.parse(providers);
      const err = 'usage endpoint answered HTTP 503';
      answer.error = err;
      answer.providers[0] = { ...answer.providers[0], status: 'error', error: err, limits: [] };
      answer.providers[1].limits[0].percent = 77;
      throw Object.assign(new Error('exit 1'), { code: 1, stdout: JSON.stringify(answer), stderr: '' });
    });
    await t.monitor.tick();
    fail = true;
    await t.monitor.tick();
    const [claude, codex] = t.monitor.snapshot()!.providers;
    expect(claude).toMatchObject({ state: 'error', stale: true, reason: 'usage endpoint answered HTTP 503' });
    expect(claude!.windows).toHaveLength(3); // the last good numbers, marked old
    expect(codex).toMatchObject({ state: 'ok', stale: false });
    expect(codex!.windows.some((w) => w.percent === 77)).toBe(true); // live
  });

  it('no Fleet means "not installed" for both providers', async () => {
    const t = setup(async () => {
      throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    });
    await t.monitor.tick();
    expect(t.monitor.snapshot()!.providers.map((p) => p.state)).toEqual(['not-installed', 'not-installed']);
  });

  it('one Jev probe and one Fleet read in flight, shared by every caller (review #6)', async () => {
    let finishJev: (s: string) => void = () => {};
    let finishFleet: (s: string) => void = () => {};
    const jevOut = JSON.stringify({ version: '0.2.0', ready: true, key_present: true, key_source: 'env', base_url: null });
    const t = setup(
      () => new Promise((r) => (finishFleet = r)),
      () => new Promise((r) => (finishJev = r)),
    );
    const ticks = [t.monitor.tick(), t.monitor.tick(), t.monitor.refresh()];
    const refreshes = [t.monitor.refreshJev(), t.monitor.refreshJev()];
    await vi.advanceTimersByTimeAsync(0);
    expect(t.count('/bin/fleet')).toBe(1);
    expect(t.count('/bin/tb-jev')).toBe(1);
    finishJev(jevOut);
    finishFleet(providers);
    await Promise.all([...ticks, ...refreshes]);
    expect(t.count('/bin/tb-jev')).toBe(1);
    expect(t.monitor.snapshot()!.jev.state).toBe('ready');
  });

  it('USAGE-1.4: Jev is checked on start, when the details open (at most every 10 s), and otherwise every 5 min at most', async () => {
    const t = setup(async () => providers);
    t.monitor.watch();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.count('/bin/tb-jev')).toBe(1);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(t.count('/bin/tb-jev')).toBe(1);
    await t.monitor.refreshJev();
    expect(t.count('/bin/tb-jev')).toBe(2);
    await t.monitor.refreshJev();
    expect(t.count('/bin/tb-jev')).toBe(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(t.count('/bin/tb-jev')).toBe(3);
  });

  it('TOOLS-1.3: Settings › Tools takes tb-jev’s version from this monitor’s status read, never running tb-jev again within its 5 minutes', async () => {
    const jevOut = JSON.stringify({ version: '0.2.0', ready: true, key_present: true, key_source: 'env', base_url: null });
    const t = setup(async () => providers, async () => jevOut);
    await t.monitor.tick();
    expect(t.count('/bin/tb-jev')).toBe(1);
    const [a, b] = await Promise.all([t.monitor.jevStatus(), t.monitor.jevStatus()]);
    expect(a).toBe(b);
    expect(a).toMatchObject({ state: 'ready', version: '0.2.0' });
    expect(t.count('/bin/tb-jev')).toBe(1);
  });

  it('a refresh after a window reset reads again, at most every 15 s', async () => {
    const t = setup(async () => providers);
    await t.monitor.tick();
    await t.monitor.refresh();
    expect(t.count('/bin/fleet')).toBe(1); // just read
    await vi.advanceTimersByTimeAsync(15_000);
    await t.monitor.refresh();
    expect(t.count('/bin/fleet')).toBe(2);
  });
});

describe('shutdown (review #7)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lookout-usage-close-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const pids = (marker: string) => {
    try {
      return execFileSync('pgrep', ['-f', marker], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  };

  it('a timed-out read holds its single flight until the process has exited, and close() waits for it (review #1)', async () => {
    const marker = `lookout-usage-trap-${process.pid}`;
    const fleet = join(dir, 'fleet-trap');
    writeFileSync(fleet, `#!/bin/sh\ntrap '' TERM\nsh -c 'sleep 60; : ${marker}-child' &\nsleep 60\n`);
    chmodSync(fleet, 0o755);
    const calls: string[] = [];
    const runner: typeof run = (file, args, opts) => {
      calls.push(file);
      return run(file, args, opts);
    };
    const monitor = new UsageMonitor({ runner, fleetBin: () => fleet, jevBin: () => null, onChange: () => {}, fleetTimeoutMs: 200 });
    const first = monitor.tick();
    await new Promise((r) => setTimeout(r, 400)); // timed out; inside the SIGKILL grace
    expect(pids(marker).length).toBeGreaterThanOrEqual(1);
    expect(monitor.tick()).toBe(first); // still the same read in flight
    await monitor.close();
    expect(pids(marker)).toEqual([]);
    expect(calls.filter((f) => f === fleet)).toHaveLength(1);
  });

  it('close() kills the running reads’ process groups and resolves once they have exited', async () => {
    const marker = `lookout-usage-close-${process.pid}`;
    const fleet = join(dir, 'fleet');
    const jev = join(dir, 'tb-jev');
    writeFileSync(fleet, `#!/bin/sh\nsh -c 'sleep 60; : ${marker}-child' &\nsleep 60\n`);
    writeFileSync(jev, `#!/bin/sh\nsh -c 'sleep 60; : ${marker}-jev' &\nsleep 60\n`);
    chmodSync(fleet, 0o755);
    chmodSync(jev, 0o755);
    const monitor = new UsageMonitor({ runner: run, fleetBin: () => fleet, jevBin: () => jev, onChange: () => {} });
    void monitor.tick();
    await vi.waitFor(() => expect(pids(marker).length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    await monitor.close();
    expect(pids(marker)).toEqual([]);
    await monitor.tick(); // nothing starts after close
    expect(pids(marker)).toEqual([]);
  });
});
