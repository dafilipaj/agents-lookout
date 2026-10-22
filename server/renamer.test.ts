import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_NAME, checkName } from '../shared/rename.ts';
import type { SessionRow } from '../shared/types.ts';
import { type RunError, type RunOptions, type Runner, run } from './exec.ts';
import { type FleetRow, fetchFleetList } from './fleet.ts';
import { normalizeRows } from './normalize.ts';
import { RENAME_HELD, RENAME_HELD_OTHER, RENAME_TIMEOUT_MS, RENAME_UNCLEAR, RenameError, parseRenameRequest, renameSession } from './renamer.ts';

/**
 * VIEW-5.12–5.14 against the fake `fleet` (`rename --json --require-empty`, the Fleet fork's
 * contract): real processes, synthetic Sessions only. Nothing is ever typed.
 */
const FAKE_FLEET = new URL('./fixtures/fleet/messages/fake-fleet.mjs', import.meta.url).pathname;
const FLEET_FIXTURES = new URL('./fixtures/fleet/messages/', import.meta.url).pathname;

const CLAUDE = 'dddddddd-0000-4000-8000-000000000104'; // Claude Code, Idle, tmux
const CODEX = 'bbbbbbbb-0000-4000-8000-000000000102'; // Codex, Idle, tmux
const WAITING = 'aaaaaaaa-0000-4000-8000-000000000101'; // Claude Code, Needs you
const VIEW_ONLY = 'cccccccc-0000-4000-8000-000000000103'; // backend unknown
const NO_ID = 'claude:61005'; // no session id yet

let dir: string;
let env: NodeJS.ProcessEnv;
let fleetLog: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lookout-rename-'));
  cpSync(FLEET_FIXTURES, join(dir, 'fleet'), { recursive: true });
  fleetLog = join(dir, 'fleet.log');
  env = { PATH: process.env.PATH, FAKE_FLEET_DIR: join(dir, 'fleet'), FAKE_FLEET_LOG: fleetLog };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const runner: Runner = (f, a, o: RunOptions) => run(f, a, { ...o, env: { ...o.env, ...env } });
const list = () => fetchFleetList(runner, FAKE_FLEET);
const rows = async (): Promise<SessionRow[]> => {
  const l = await list();
  if (l.kind !== 'ok') throw new Error('list');
  return normalizeRows(l.rows, { git: () => null, statusSince: () => null });
};
const renames = (): string[][] => {
  try {
    return readFileSync(fleetLog, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string[])
      .filter((c) => c.includes('rename'));
  } catch {
    return [];
  }
};
/** Changes the fake `fleet`'s rows (by session id) after the server's last poll. */
const editRow = (sessionId: string, patch: Partial<FleetRow> & Record<string, unknown>) => {
  const file = join(dir, 'fleet', 'list.json');
  const all = JSON.parse(readFileSync(file, 'utf8')) as FleetRow[];
  writeFileSync(file, JSON.stringify(all.map((r) => (r.session_id === sessionId ? { ...r, ...patch } : r))));
};

async function setup(over: { runner?: Runner } = {}) {
  const known = await rows();
  const refresh = vi.fn(async () => {});
  const opts = {
    runner: over.runner ?? runner,
    fleetBin: () => FAKE_FLEET,
    lookup: (id: string) => known.find((r) => r.id === id) ?? null,
    freshList: list,
    refresh,
    env,
  };
  return { refresh, rename: (id: string, name: string) => renameSession(opts, id, name) };
}

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof RenameError) return { status: err.status, message: err.message, field: err.field };
    throw err;
  }
  throw new Error('expected a refusal');
};

describe('renaming a Session (VIEW-5.12)', () => {
  it('VIEW-5.12: an Idle Claude Code Session is renamed through `fleet --local rename --json --require-empty -- id:<session_id> <name>`', async () => {
    const t = await setup();
    expect(await t.rename(CLAUDE, 'Invoice rounding')).toEqual({ result: 'renamed' });
    expect(renames()).toEqual([['--local', 'rename', '--json', '--require-empty', '--', `id:${CLAUDE}`, 'Invoice rounding']]);
    // The new title comes back through the list, polled at once so the tabs hear it without waiting.
    expect((await rows()).find((r) => r.id === CLAUDE)?.title).toBe('Invoice rounding');
    expect(t.refresh).toHaveBeenCalledOnce();
  });

  it('VIEW-5.16: a Session Idle with a background shell running (`shell`) is renamed as any Idle one', async () => {
    editRow(CLAUDE, { status: 'shell' });
    const t = await setup();
    expect(await t.rename(CLAUDE, 'Invoice rounding')).toEqual({ result: 'renamed' });
    expect(renames()).toEqual([['--local', 'rename', '--json', '--require-empty', '--', `id:${CLAUDE}`, 'Invoice rounding']]);
  });

  it('VIEW-5.12: a Codex Session is renamed the same way', async () => {
    const t = await setup();
    expect(await t.rename(CODEX, 'PDF export')).toEqual({ result: 'renamed' });
    expect(renames()).toEqual([['--local', 'rename', '--json', '--require-empty', '--', `id:${CODEX}`, 'PDF export']]);
    expect((await rows()).find((r) => r.id === CODEX)?.title).toBe('PDF export');
  });

  it('VIEW-5.12: a name that starts with `-` or `/` stays a name: it comes after `--`', async () => {
    const t = await setup();
    await t.rename(CLAUDE, '--force');
    await t.rename(CLAUDE, '/clear');
    expect(renames().map((c) => c.slice(-3))).toEqual([
      ['--', `id:${CLAUDE}`, '--force'],
      ['--', `id:${CLAUDE}`, '/clear'],
    ]);
  });

  it('VIEW-5.12: the name is checked before anything runs: trimmed, not empty, one line, no control characters, at most 64 characters', () => {
    expect(parseRenameRequest({ title: '  Invoice rounding  ' })).toBe('Invoice rounding');
    const bad = (body: unknown) => {
      try {
        parseRenameRequest(body);
      } catch (err) {
        if (err instanceof RenameError) return { status: err.status, field: err.field, message: err.message };
        throw err;
      }
      throw new Error('expected a refusal');
    };
    expect(bad({ title: '   ' })).toEqual({ status: 400, field: 'title', message: 'Type a name first.' });
    expect(bad({ title: 'two\nlines' })).toMatchObject({ status: 400, field: 'title', message: expect.stringMatching(/one line/) });
    expect(bad({ title: 'a\u2028b' })).toMatchObject({ message: expect.stringMatching(/one line/) });
    expect(bad({ title: 'tab\there' })).toMatchObject({ status: 400, message: expect.stringMatching(/can't be typed/) });
    expect(bad({ title: 'esc\u001b[2J' })).toMatchObject({ status: 400 });
    expect(bad({ title: 'x'.repeat(MAX_NAME + 1) })).toMatchObject({ status: 400, message: `A name is at most 64 characters; this one has 65.` });
    expect(bad({})).toMatchObject({ status: 400, field: 'title' });
    expect(bad({ title: 42 })).toMatchObject({ status: 400 });
    expect(bad(null)).toMatchObject({ status: 400 });
    expect(bad(['x'])).toMatchObject({ status: 400 });
    // Characters as Fleet counts them: 64 emoji are 64 characters (128 UTF-16 units).
    expect(checkName('🚀'.repeat(64))).toEqual({ ok: true, name: '🚀'.repeat(64) });
    expect(checkName('🚀'.repeat(65))).toMatchObject({ ok: false });
    expect(checkName('x'.repeat(64))).toMatchObject({ ok: true });
  });
});

describe('who can be renamed (VIEW-5.13)', () => {
  it('VIEW-5.13: a Session without a session ID, a View only one, or one Lookout doesn’t know is refused before Fleet is asked', async () => {
    const t = await setup();
    expect(await refusal(t.rename(NO_ID, 'x'))).toMatchObject({ status: 409, message: expect.stringMatching(/no session ID yet.*after its first prompt/) });
    expect(await refusal(t.rename(VIEW_ONLY, 'x'))).toMatchObject({ status: 409, message: expect.stringMatching(/another app/) });
    expect(await refusal(t.rename('nope', 'x'))).toMatchObject({ status: 404 });
    expect(renames()).toEqual([]);
  });

  it('VIEW-5.13: a fresh list is read first: a Session no longer Idle, no longer listed, or no longer Controllable isn’t renamed', async () => {
    const t = await setup();
    editRow(CLAUDE, { status: 'busy' });
    expect(await refusal(t.rename(CLAUDE, 'x'))).toEqual({ status: 409, field: null, message: 'The Session isn’t Idle now, so it wasn’t renamed. Try again once it is.' });
    expect(await refusal(t.rename(WAITING, 'x'))).toMatchObject({ status: 409, message: expect.stringMatching(/isn’t Idle now/) });
    editRow(CODEX, { backend: 'unknown' });
    expect(await refusal(t.rename(CODEX, 'x'))).toMatchObject({ status: 409, message: expect.stringMatching(/another app/) });
    const file = join(dir, 'fleet', 'list.json');
    writeFileSync(file, JSON.stringify((JSON.parse(readFileSync(file, 'utf8')) as FleetRow[]).filter((r) => r.session_id !== CLAUDE)));
    expect(await refusal(t.rename(CLAUDE, 'x'))).toMatchObject({ status: 409, message: 'This Session is no longer running, so it wasn’t renamed.' });
    expect(renames()).toEqual([]);
  });

  it('VIEW-5.13: when the fresh list can’t be read, nothing is typed', async () => {
    const known = await rows();
    const t = renameSession(
      { runner, fleetBin: () => FAKE_FLEET, lookup: (id) => known.find((r) => r.id === id) ?? null, freshList: async () => ({ kind: 'error', message: 'fleet list timed out' }), refresh: async () => {}, env },
      CLAUDE,
      'x',
    );
    expect(await refusal(t)).toMatchObject({ status: 503 });
    expect(renames()).toEqual([]);
  });
});

describe('what came of it (VIEW-5.14)', () => {
  it('VIEW-5.14: Fleet typed it but its registry didn’t show it in time: `sent`, and the title stays as the list has it', async () => {
    editRow(CLAUDE, { fake_rename_confirm: false });
    const t = await setup();
    expect(await t.rename(CLAUDE, 'Invoice rounding')).toEqual({ result: 'sent' });
    expect((await rows()).find((r) => r.id === CLAUDE)?.title).toBe('fresh-session');
    expect(t.refresh).toHaveBeenCalledOnce();
  });

  it.each(['input', 'waiting', 'no_input_box', 'unreadable', 'busy'])(
    'VIEW-5.14: Fleet holding the rename for `%s` is a 409 in Lookout’s own words; nothing is retried',
    async (why) => {
      editRow(CLAUDE, { fake_rename_held: why });
      const t = await setup();
      const res = await refusal(t.rename(CLAUDE, 'Invoice rounding'));
      expect(res).toEqual({ status: 409, field: null, message: RENAME_HELD[why] });
      expect(res.message).toMatch(/wasn’t renamed/);
      expect(res.message).not.toMatch(/tmux|fresh-session|force|fake/i);
      expect(renames()).toHaveLength(1);
      expect(t.refresh).not.toHaveBeenCalled();
    },
  );

  it('VIEW-5.14: the held messages follow VIEW-3.7’s, for renaming', () => {
    expect(RENAME_HELD.input).toMatch(/input box holds text.*Send or clear it in the terminal, then try again/);
    expect(RENAME_HELD.waiting).toMatch(/waiting on a prompt.*Answer it, then try again/);
    expect(RENAME_HELD.no_input_box).toMatch(/isn’t on screen \(a panel, a menu or the transcript view is open\).*Press Esc to close it, then try again/);
    expect(RENAME_HELD.unreadable).toMatch(/can’t read the Session’s input box.*\/rename in the terminal instead/);
    expect(RENAME_HELD.busy).toMatch(/working.*once it’s Idle/);
  });

  it('VIEW-5.14: a hold Lookout doesn’t know says Fleet held it; a box Fleet can’t read is typed into only without `--require-empty`', async () => {
    const held: Runner = async () => {
      throw Object.assign(new Error('exit 3'), { code: 3, stdout: JSON.stringify({ ok: false, result: 'held', held: 'something_new', message: 'tmux x' }), stderr: '' });
    };
    expect(await refusal((await setup({ runner: held })).rename(CLAUDE, 'x'))).toMatchObject({ status: 409, message: RENAME_HELD_OTHER });
    // The fake `fleet`, as the fork does: without the flag, a box it can't see holds nothing.
    editRow(CLAUDE, { fake_rename_held: 'no_input_box' });
    const out = await run(FAKE_FLEET, ['--local', 'rename', '--json', '--', `id:${CLAUDE}`, 'x'], { timeoutMs: 5000, env });
    expect(JSON.parse(out)).toMatchObject({ ok: true, result: 'renamed' });
  });

  it.each([
    ['busy', 'Fleet is typing into it; try again.'],
    ['target_not_found', 'This Session is no longer running, so it wasn’t renamed.'],
    ['target_invalid', 'Fleet couldn’t tell which Session this is, so it wasn’t renamed.'],
    ['backend_unsupported', 'Lookout can’t reach this Session’s terminal, so it wasn’t renamed.'],
    ['io', 'Couldn’t rename it. Check the terminal.'],
  ])('VIEW-5.14: Fleet failing with `%s` before typing says so in plain words, never Fleet’s own text', async (kind, message) => {
    editRow(CLAUDE, { fake_rename: kind });
    const t = await setup();
    expect(await refusal(t.rename(CLAUDE, 'x'))).toMatchObject({ status: kind === 'io' ? 502 : 409, message });
    expect(t.refresh).not.toHaveBeenCalled();
  });

  it('VIEW-5.14: Fleet missing, too slow, without `rename`, or without its `--require-empty`, each says so; nothing names tmux', async () => {
    const failing = (e: Partial<RunError>): Runner => async () => {
      throw Object.assign(new Error('failed'), e);
    };
    const said = async (e: Partial<RunError>) => (await refusal((await setup({ runner: failing(e) })).rename(CLAUDE, 'x')));
    expect(await said({ code: 'ENOENT' })).toMatchObject({ status: 503, message: 'Fleet isn’t installed, so the Session wasn’t renamed.' });
    expect(await said({ timedOut: true, code: null })).toMatchObject({ status: 504, message: expect.stringMatching(/took too long.*can’t tell whether it was renamed/) });
    expect(await said({ code: 2, stderr: "error: unexpected argument '--require-empty' found\n" })).toMatchObject({
      status: 501,
      message: 'This Fleet can’t check the Session’s input box before renaming, so it wasn’t renamed. Update the Fleet fork.',
    });
    expect(await said({ code: 2, stderr: "error: unrecognized subcommand 'rename'\n" })).toMatchObject({ status: 501, message: expect.stringMatching(/can’t rename Sessions yet/) });
    const tmux = await said({ code: 1, stdout: JSON.stringify({ ok: false, kind: 'io', error: "tmux rename-session -t 'fresh-session' failed" }), stderr: 'error: tmux rename-session failed' });
    expect(tmux).toEqual({ status: 502, field: null, message: 'Couldn’t rename it. Check the terminal.' });
  });

  it('VIEW-5.14: on exit 0 only Fleet’s report decides: `renamed` or `sent` when it says so', async () => {
    const answering = (stdout: string): Runner => async (f, a, o) => (a.includes('rename') ? stdout : runner(f, a, o));
    expect(await (await setup({ runner: answering('{"ok":true,"result":"renamed"}') })).rename(CLAUDE, 'x')).toEqual({ result: 'renamed' });
    expect(await (await setup({ runner: answering('{"ok":true,"result":"sent"}') })).rename(CLAUDE, 'x')).toEqual({ result: 'sent' });
  });

  it.each([
    ['not JSON', 'not json'],
    ['nothing', ''],
    ['an array', '[]'],
    ['`ok: false`', '{"ok":false,"result":"renamed"}'],
    ['`ok: false`, held', '{"ok":false,"result":"held","held":"input"}'],
    ['no `result`', '{"ok":true}'],
    ['another `result`', '{"ok":true,"result":"held"}'],
    ['`ok` not true', '{"ok":"true","result":"sent"}'],
  ])('VIEW-5.14: a report on exit 0 that isn’t `ok: true` with `renamed` or `sent` (%s) isn’t a success: Lookout can’t tell whether it was renamed', async (_, stdout) => {
    const answering: Runner = async (f, a, o) => (a.includes('rename') ? stdout : runner(f, a, o));
    const t = await setup({ runner: answering });
    expect(await refusal(t.rename(CLAUDE, 'x'))).toEqual({ status: 502, field: null, message: RENAME_UNCLEAR });
    expect(RENAME_UNCLEAR).toMatch(/can’t tell whether it was renamed\. Check the Session list\.$/);
    // It may have been typed all the same: the list is read at once, so a new title shows.
    expect(t.refresh).toHaveBeenCalledOnce();
  });

  it('VIEW-5.14: Fleet gets room for its 10 s registry wait', () => {
    expect(RENAME_TIMEOUT_MS).toBeGreaterThan(12_000);
  });
});
