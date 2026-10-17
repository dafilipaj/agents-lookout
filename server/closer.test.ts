import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../shared/settings.ts';
import type { EndTarget, SessionRow } from '../shared/types.ts';
import { EndError, closeTarget, endSession, parseEndTarget } from './closer.ts';
import { type RunOptions, run } from './exec.ts';
import { type FleetRow, fetchFleetList } from './fleet.ts';
import { History, resumePast } from './history.ts';
import { Launcher } from './launcher.ts';
import { normalizeRows } from './normalize.ts';

/**
 * VIEW-5.6/5.7/5.8 against the fake `fleet` (`close --json`, the Fleet fork's contract) and the
 * fake `tb-session`: real processes, synthetic Sessions only. Nothing real is ever closed.
 */
const FAKE_FLEET = new URL('./fixtures/fleet/messages/fake-fleet.mjs', import.meta.url).pathname;
const FAKE_TB = new URL('./fixtures/tb-session/fake-tb-session.mjs', import.meta.url).pathname;
const FLEET_FIXTURES = new URL('./fixtures/fleet/messages/', import.meta.url).pathname;

const OWN = 'aaaaaaaa-0000-4000-8000-000000000101'; // tmux, alone in `fix-deal-rates`
const VIEW_ONLY = 'cccccccc-0000-4000-8000-000000000103'; // backend unknown
const NO_ID_PID = 61005; // tmux, no session id yet
const OWN_START = '2026-10-14T08:12:03Z';
const NO_ID_START = '2026-10-14T09:42:09Z';
const expectFlags = (pid: number, start: string) => ['--expect-pid', String(pid), '--expect-start', start];

let dir: string;
let env: NodeJS.ProcessEnv;
let fleetLog: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lookout-close-'));
  mkdirSync(join(dir, 'work'));
  mkdirSync(join(dir, 'fleet'));
  cpSync(FLEET_FIXTURES, join(dir, 'fleet'), { recursive: true });
  fleetLog = join(dir, 'fleet.log');
  env = { PATH: process.env.PATH, FAKE_FLEET_DIR: join(dir, 'fleet'), FAKE_FLEET_LOG: fleetLog, FAKE_TB_SESSION_ROOT: dir };
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
const closes = () => fleetCalls().filter((c) => c.includes('close'));
const editList = (edit: (rows: FleetRow[]) => FleetRow[]) => {
  const file = join(dir, 'fleet', 'list.json');
  writeFileSync(file, JSON.stringify(edit(JSON.parse(readFileSync(file, 'utf8')) as FleetRow[])));
};

async function setup() {
  const known = await rows();
  const refresh = vi.fn(async () => {});
  const opts = {
    runner,
    fleetBin: () => FAKE_FLEET,
    lookup: (id: string) => known.find((r) => r.id === id) ?? null,
    freshList: list,
    refresh,
    env,
  };
  // The dialog's target: the row as the user confirmed it.
  const confirmed = (id: string): EndTarget => {
    const r = known.find((k) => k.id === id);
    return { pid: r?.pid ?? 1, procStart: r?.procStart ?? null };
  };
  return { opts, refresh, confirmed, end: (id: string, target: EndTarget = confirmed(id)) => endSession(opts, id, target) };
}

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof EndError) return { status: err.status, message: err.message };
    throw err;
  }
  throw new Error('expected a refusal');
};

describe('ending a Session (VIEW-5.6)', () => {
  it('VIEW-5.6: a Session alone in its own Session host ends through `fleet --local close id:<session_id> --json`', async () => {
    const t = await setup();
    expect(await t.end(OWN)).toEqual({ how: 'exit' });
    expect(closes()).toEqual([['--local', 'close', `id:${OWN}`, '--json', ...expectFlags(61001, OWN_START)]]);
    expect((await rows()).map((r) => r.id)).not.toContain(OWN);
    expect(t.refresh).toHaveBeenCalledOnce(); // the tabs hear of it without waiting for the next poll
  });

  it('VIEW-5.6: a Session without a session id is closed by `pid:<n>`, checked against a fresh list first', async () => {
    const t = await setup();
    expect(await t.end(`claude:${NO_ID_PID}`)).toEqual({ how: 'exit' });
    expect(closes()).toEqual([['--local', 'close', `pid:${NO_ID_PID}`, '--json', ...expectFlags(NO_ID_PID, NO_ID_START)]]);
  });

  it('VIEW-5.6: only own-host, Controllable Sessions: anything else is refused before Fleet is asked', async () => {
    // Another Session moved into the same tmux session after the last poll.
    editList((r) => [...r, { ...r[0]!, pid: 61099, session_id: 'abcd0000-0000-4000-8000-000000000999', harness: 'codex' }]);
    const t = await setup();
    expect(await refusal(t.end(OWN))).toMatchObject({ status: 409, message: expect.stringMatching(/shares its Session host.*Close it in the terminal/) });
    expect(await refusal(t.end(VIEW_ONLY))).toMatchObject({ status: 409, message: expect.stringMatching(/another app/) });
    expect(await refusal(t.end('nope'))).toMatchObject({ status: 404 });
    expect(closes()).toEqual([]);
  });

  it('VIEW-5.6: the target is validated before argv is built: exact forms only, never a flag', () => {
    expect(closeTarget({ id: OWN, pid: 1, harness: 'claude' })).toBe(`id:${OWN}`);
    expect(closeTarget({ id: 'codex:42', pid: 42, harness: 'codex' })).toBe('pid:42');
    expect(() => closeTarget({ id: '-rf', pid: 1, harness: 'claude' })).toThrow(EndError);
    expect(() => closeTarget({ id: 'a b', pid: 1, harness: 'claude' })).toThrow(EndError);
    expect(() => closeTarget({ id: 'codex:0', pid: 0, harness: 'codex' })).toThrow(EndError);
    expect(() => closeTarget({ id: 'codex:x', pid: Number.NaN, harness: 'codex' })).toThrow(EndError);
  });

  it('VIEW-5.6: the fake follows the contract: a bare or fuzzy target is `usage`, and `-n` closes nothing', async () => {
    const bare = await run(FAKE_FLEET, ['--local', 'close', OWN, '--json'], { timeoutMs: 5000, env }).catch((e: { stdout: string }) => e.stdout);
    expect(JSON.parse(bare)).toMatchObject({ ok: false, kind: 'usage' });
    const dry = JSON.parse(await run(FAKE_FLEET, ['--local', '-n', 'close', `id:${OWN}`, '--json'], { timeoutMs: 5000, env }));
    expect(dry).toMatchObject({ ok: true, dry_run: true, how: 'exit' });
    expect((await rows()).map((r) => r.id)).toContain(OWN);
  });
});

describe('the confirmed process only (VIEW-5.6)', () => {
  const CHANGED = 'This Session was restarted since you asked; nothing was closed.';

  it('VIEW-5.6: a Session asked for by pid that got its session id since is still found, by pid and Harness, and closed by its id', async () => {
    const NEW_ID = 'dddddddd-0000-4000-8000-000000000105';
    const asked: EndTarget = { pid: NO_ID_PID, procStart: NO_ID_START };
    // The last poll already lists it under its session id: the old pid id is unknown to it.
    editList((r) => r.map((x) => (x.pid === NO_ID_PID ? { ...x, session_id: NEW_ID } : x)));
    const t = await setup();
    expect(t.opts.lookup(`claude:${NO_ID_PID}`)).toBeNull();
    // Another Harness under that pid, or a malformed id, is still refused.
    expect(await refusal(t.end(`codex:${NO_ID_PID}`, asked))).toMatchObject({ status: 409 });
    expect(await refusal(t.end('claude:0', asked))).toMatchObject({ status: 404 });
    expect(closes()).toEqual([]);
    expect(await t.end(`claude:${NO_ID_PID}`, asked)).toEqual({ how: 'exit' });
    expect(closes()).toEqual([['--local', 'close', `id:${NEW_ID}`, '--json', ...expectFlags(NO_ID_PID, NO_ID_START)]]);
  });

  it('VIEW-5.6: a replacement process is never closed: the Session resumed under a new process since the dialog opened', async () => {
    const t = await setup();
    const asked = t.confirmed(OWN);
    // Another tab ended it and resumed it from History: same session id, a new process.
    editList((r) => r.map((x) => (x.session_id === OWN ? { ...x, pid: 62001, proc_start: '2026-10-17T10:00:00Z' } : x)));
    expect(await refusal(t.end(OWN, asked))).toEqual({ status: 409, message: CHANGED });
    expect(closes()).toEqual([]);
    expect((await rows()).map((r) => r.id)).toContain(OWN);
  });

  it('VIEW-5.6: a reused pid is never closed: same pid, another process start', async () => {
    const t = await setup();
    const asked = t.confirmed(`claude:${NO_ID_PID}`);
    editList((r) => r.map((x) => (x.pid === NO_ID_PID ? { ...x, proc_start: '2026-10-17T10:00:00.5Z' } : x)));
    expect(await refusal(t.end(`claude:${NO_ID_PID}`, asked))).toEqual({ status: 409, message: CHANGED });
    expect(closes()).toEqual([]);
  });

  it('VIEW-5.6: Fleet checks the same identity atomically: a replacement between Lookout’s check and the close is `target_changed`', async () => {
    const t = await setup();
    // The replacement lands after Lookout's fresh list, just before Fleet resolves the target.
    const racing = vi.fn(async (f: string, a: readonly string[], o: RunOptions) => {
      if (a.includes('close')) editList((r) => r.map((x) => (x.session_id === OWN ? { ...x, pid: 62001, proc_start: '2026-10-17T10:00:00Z' } : x)));
      return runner(f, a, o);
    });
    expect(await refusal(endSession({ ...t.opts, runner: racing }, OWN, t.confirmed(OWN)))).toEqual({ status: 409, message: CHANGED });
    expect(closes()).toEqual([['--local', 'close', `id:${OWN}`, '--json', ...expectFlags(61001, OWN_START)]]);
    expect((await rows()).map((r) => r.id)).toContain(OWN); // nothing was closed
    expect(t.refresh).not.toHaveBeenCalled();
  });

  it('VIEW-5.6: without a process start time Lookout refuses, and says to close it in the terminal', async () => {
    editList((r) => r.map((x) => (x.session_id === OWN ? { ...x, proc_start: null } : x)));
    const t = await setup();
    const unconfirmed = await refusal(t.end(OWN));
    expect(unconfirmed).toEqual({ status: 409, message: expect.stringMatching(/can’t confirm it’s the same Session.*Close it in the terminal/) });
    // Fleet lost the start time after the dialog opened: refused the same way.
    editList((r) => r.map((x) => (x.session_id === OWN ? { ...x, proc_start: OWN_START } : x)));
    const t2 = await setup();
    editList((r) => r.map((x) => (x.session_id === OWN ? { ...x, proc_start: null } : x)));
    expect(await refusal(t2.end(OWN))).toEqual(unconfirmed);
    expect(closes()).toEqual([]);
  });

  it('VIEW-5.6: the request’s pid and start time are validated before argv is built', () => {
    expect(parseEndTarget({ pid: 61001, procStart: OWN_START })).toEqual({ pid: 61001, procStart: OWN_START });
    expect(parseEndTarget({ pid: 61001, procStart: null })).toEqual({ pid: 61001, procStart: null });
    for (const bad of [null, [], {}, { pid: '61001', procStart: OWN_START }, { pid: 0, procStart: OWN_START }, { pid: 1.5, procStart: OWN_START }]) {
      expect(() => parseEndTarget(bad)).toThrow('Invalid process id.');
    }
    for (const start of [undefined, '', '--json', `${OWN_START} `, '2026-10-14 08:12:03Z', '2026-10-14T08:12:03+02:00', '2026-02-30T08:12:03Z', `2026-10-14T08:12:03.${'1'.repeat(40)}Z`]) {
      expect(() => parseEndTarget({ pid: 1, procStart: start })).toThrow(EndError);
    }
  });

  it('VIEW-5.6: the fake follows the amended contract: one expect flag without the other is `usage`', async () => {
    const half = await run(FAKE_FLEET, ['--local', 'close', `id:${OWN}`, '--json', '--expect-pid', '61001'], { timeoutMs: 5000, env }).catch((e: { stdout: string }) => e.stdout);
    expect(JSON.parse(half)).toMatchObject({ ok: false, kind: 'usage' });
    expect((await rows()).map((r) => r.id)).toContain(OWN);
  });
});

describe('after ending (VIEW-5.7)', () => {
  it('VIEW-5.7: the ended Session is gone from Fleet’s list, so History resumes it in its start directory', async () => {
    const t = await setup();
    await t.end(OWN);
    const launcher = new Launcher({
      runner: run,
      fleetBin: () => FAKE_FLEET,
      settings: { get: defaultSettings, update: async () => defaultSettings() },
      onChange: () => {},
      env,
    });
    const isLive = async (id: string, harness: string) => (await rows()).some((r) => r.id === id && r.harness === harness);
    const history = new History({ runner: run, bin: () => FAKE_TB, env });
    const result = await resumePast({ history, launcher, isLive }, { sessionId: OWN, harness: 'claude' });
    expect(result).toMatchObject({ kind: 'started', launch: { directory: join(dir, 'work') } });
    expect(fleetCalls().filter((c) => c.includes('spawn'))[0]).toEqual(expect.arrayContaining(['--resume', OWN]));
    launcher.stop();
  });
});

describe('when Fleet refuses (VIEW-5.8)', () => {
  const failWith = (kind: string) => editList((r) => r.map((x) => (x.session_id === OWN ? { ...x, fake_close: kind } : x)));

  it('VIEW-5.8: `busy` says Fleet is typing into it; try again', async () => {
    failWith('busy');
    const t = await setup();
    expect(await refusal(t.end(OWN))).toEqual({ status: 409, message: 'Fleet is typing into it; try again.' });
    expect(t.refresh).not.toHaveBeenCalled();
  });

  it('VIEW-5.8: `host_shared` and `backend_unsupported` explain why, and say to close it in the terminal', async () => {
    failWith('host_shared');
    let t = await setup();
    const shared = await refusal(t.end(OWN));
    expect(shared.message).toMatch(/shares its Session host with other windows.*Close it in the terminal/);
    expect(shared.message).not.toMatch(/tmux/i);

    editList((r) => r.map((x) => (x.session_id === OWN ? { ...x, fake_close: undefined } : x)));
    // Fleet saw another backend than the list did: `backend_unsupported`.
    const fakeRunner = vi.fn(async (_f: string, a: readonly string[], o: RunOptions) => {
      if (a.includes('close')) throw Object.assign(new Error('exit 1'), { code: 1, stdout: '{"ok":false,"kind":"backend_unsupported","error":"iterm"}', stderr: 'error: iterm' });
      return runner(_f, a, o);
    });
    t = await setup();
    const unsupported = await refusal(endSession({ ...t.opts, runner: fakeRunner }, OWN, t.confirmed(OWN)));
    expect(unsupported).toEqual({ status: 409, message: expect.stringMatching(/a Session host of its own.*Close this one in its terminal/) });
  });

  it('VIEW-5.8: other failures give Fleet’s reason on one line, redacted, without naming tmux; an older Fleet without `close` says to update it', async () => {
    const failing = (stdout: string, stderr: string) =>
      vi.fn(async (_f: string, a: readonly string[], o: RunOptions) => {
        if (a.includes('close')) throw Object.assign(new Error('exit 1'), { code: 1, stdout, stderr });
        return runner(_f, a, o);
      });
    const t = await setup();
    const io = await refusal(endSession({ ...t.opts, runner: failing('{"ok":false,"kind":"io","error":"tmux kill-session failed"}', '') }, OWN, t.confirmed(OWN)));
    expect(io).toEqual({ status: 502, message: "Couldn't end it: the Session host refused." });
    const secret = await refusal(endSession({ ...t.opts, runner: failing('{"ok":false,"kind":"io","error":"token=abc123 refused\\nmore"}', '') }, OWN, t.confirmed(OWN)));
    expect(secret.message).toBe("Couldn't end it: token=… refused.");
    const old = await refusal(endSession({ ...t.opts, runner: failing('', "error: unrecognized subcommand 'close'") }, OWN, t.confirmed(OWN)));
    expect(old).toEqual({ status: 501, message: 'This Fleet can’t end Sessions yet. Update the Fleet fork.' });
  });
});
