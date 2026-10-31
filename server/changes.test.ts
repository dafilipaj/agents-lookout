import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerEvent, SessionRow } from '../shared/types.ts';
import { BUSY_INTERVAL_MS, Changes, ChangesError, IDLE_INTERVAL_MS, STALE_MS, WATCHED_INTERVAL_MS, counts, parseCandidates, type FleetCandidate } from './changes.ts';
import { run, type RunError, type Runner } from './exec.ts';

type Row = Pick<SessionRow, 'id' | 'pid' | 'harness' | 'status'>;

function cand(root: string, o: Partial<FleetCandidate> = {}): FleetCandidate {
  return {
    root,
    why: ['edited'],
    repo: { common_dir: `${root}/.git`, linked_worktree: false },
    branch: 'feat',
    head: 'abc1234def0',
    on_default_branch: false,
    base: { ref: 'origin/main', sha: 'b0' },
    stats: { files: 1, additions: 3, deletions: 1 },
    files: [{ path: 'src/a.ts', kind: 'modified', old_path: null, additions: 3, deletions: 1, binary: false, uncommitted: true }],
    more_files: 0,
    ...o,
  };
}

const answer = (candidates: FleetCandidate[], fingerprint = 'f1') =>
  JSON.stringify({ ok: true, session_id: 's1', harness: 'claude', fingerprint, unchanged: false, candidates, skipped: [] });
const unchanged = (fingerprint = 'f1') => JSON.stringify({ ok: true, session_id: 's1', harness: 'claude', fingerprint, unchanged: true });

function setup(outputs: (string | RunError)[] | ((args: readonly string[]) => string | RunError), extra: Partial<ConstructorParameters<typeof Changes>[0]> = {}) {
  const queue = Array.isArray(outputs) ? [...outputs] : null;
  const runner = vi.fn<Runner>(async (_file, args) => {
    const out = queue ? (queue.shift() ?? unchanged()) : (outputs as (a: readonly string[]) => string | RunError)(args);
    if (typeof out !== 'string') throw out;
    return out;
  });
  const sent: { clientId: string; event: ServerEvent }[] = [];
  const onRowsChanged = vi.fn();
  const changes = new Changes({
    runner,
    fleetBin: () => '/bin/fleet',
    onRowsChanged,
    sendTo: (clientId, event) => sent.push({ clientId, event }),
    ...extra,
  });
  return { changes, runner, sent, onRowsChanged };
}

const row = (o: Partial<Row> = {}): Row => ({ id: 's1', pid: 10, harness: 'claude', status: 'idle', ...o });
const asks = (runner: ReturnType<typeof vi.fn<Runner>>) => runner.mock.calls.map(([, args]) => args.join(' '));

afterEach(() => vi.useRealTimers());

describe('which candidates count', () => {
  it('DIFF-2.1: a Claude Code Session counts what it edited, and its cwd when edited there or off its default branch', () => {
    expect(counts('claude', { why: ['edited'], on_default_branch: true })).toBe(true);
    expect(counts('claude', { why: ['cwd', 'edited'], on_default_branch: true })).toBe(true);
    expect(counts('claude', { why: ['cwd'], on_default_branch: false })).toBe(true);
    expect(counts('claude', { why: ['cwd'], on_default_branch: true })).toBe(false);
  });

  it("DIFF-2.2: a Codex Session counts its cwd's Checkout always, and nothing else", () => {
    expect(counts('codex', { why: ['cwd'], on_default_branch: true })).toBe(true);
    expect(counts('codex', { why: ['edited'], on_default_branch: false })).toBe(false);
  });

  it('DIFF-2.3, DIFF-2.4, DIFF-2.5, DIFF-2.7: candidates parse as reported; no Changes, skipped or not counted are left out', () => {
    const files = [
      { path: 'a.ts', kind: 'renamed', old_path: 'old.ts', additions: 2, deletions: 0, binary: false, uncommitted: false },
      { path: 'logo.png', kind: 'added', old_path: null, additions: 0, deletions: 0, binary: true, uncommitted: true },
      { path: 'run.sh', kind: 'mode_changed', old_path: null, additions: 0, deletions: 0, binary: false, uncommitted: true },
      { path: 'sub', kind: 'submodule', old_path: null, additions: 0, deletions: 0, binary: false, uncommitted: false },
      { path: 'weird', kind: 'unknown_kind' },
    ];
    const parsed = parseCandidates(
      [
        cand('/r/app-wt/feat', { repo: { common_dir: '/r/app/.git', linked_worktree: true }, files, more_files: 7, stats: { files: 11, additions: 2, deletions: 0 } }),
        cand('/r/clean', { stats: { files: 0, additions: 0, deletions: 0 }, files: [] }),
        cand('/r/main-only', { why: ['cwd'], on_default_branch: true }),
        cand('/r/detached', { branch: null }),
        { root: '/r/broken' },
      ],
      'claude',
    );
    expect(parsed.map((c) => [c.root, c.repo, c.where])).toEqual([
      ['/r/app-wt/feat', 'app', 'feat'],
      ['/r/detached', 'detached', 'abc1234'],
    ]);
    expect(parsed[0]!.files.map((f) => [f.path, f.kind, f.oldPath, f.binary])).toEqual([
      ['a.ts', 'renamed', 'old.ts', false],
      ['logo.png', 'added', null, true],
      ['run.sh', 'mode_changed', null, false],
      ['sub', 'submodule', null, false],
    ]);
    expect(parsed[0]!.moreFiles).toBe(7);
  });
});

describe('what Lookout keeps of an answer', () => {
  it('DIFF-2.4: a candidate without Changes, or one Fleet skipped, is left out and the rest still count', () => {
    const raw = JSON.parse(answer([cand('/r/a'), cand('/r/clean', { stats: { files: 0, additions: 0, deletions: 0 }, files: [] })]));
    raw.skipped = [{ root: '/r/gone', why: ['edited'], detail: 'gone' }];
    expect(parseCandidates(raw.candidates, 'claude').map((c) => c.root)).toEqual(['/r/a']);
  });

  it('DIFF-2.5: each file keeps its path, kind, old path, numbers, binary and uncommitted', () => {
    const [c] = parseCandidates([cand('/r/a', { files: [{ path: 'b.ts', kind: 'renamed', old_path: 'a.ts', additions: 4, deletions: 2, binary: false, uncommitted: true }] })], 'claude');
    expect(c!.files).toEqual([{ path: 'b.ts', oldPath: 'a.ts', kind: 'renamed', additions: 4, deletions: 2, binary: false, uncommitted: true }]);
  });
});

describe('asking Fleet', () => {
  it('DIFF-2.6: a new Session is asked at once, then every 60 s Idle and 10 s Busy, with the last fingerprint; a Status change asks at once', async () => {
    vi.useFakeTimers();
    const { changes, runner } = setup([answer([cand('/r/a')], 'f1')]);
    changes.observe([row()]);
    await vi.advanceTimersByTimeAsync(0);
    expect(asks(runner)).toEqual(['--local diff id:s1 --json']);
    await vi.advanceTimersByTimeAsync(IDLE_INTERVAL_MS - 1);
    expect(runner).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(asks(runner)[1]).toBe('--local diff id:s1 --json --since f1');
    changes.observe([row({ status: 'busy' })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(runner).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(BUSY_INTERVAL_MS);
    expect(runner).toHaveBeenCalledTimes(4);
    expect(runner.mock.calls[0]![2].timeoutMs).toBe(60_000);
    changes.stop();
  });

  it('DIFF-2.6: one ask at a time across Sessions, the most overdue first; an unchanged answer keeps the last one', async () => {
    vi.useFakeTimers();
    let release: (() => void) | null = null;
    const runner = vi.fn<Runner>(async (_f, args) => {
      if (args.includes('id:s1') && !args.includes('--since')) await new Promise<void>((r) => (release = r));
      return args.includes('--since') ? unchanged() : answer([cand('/r/a')]);
    });
    const changes = new Changes({ runner, fleetBin: () => 'fleet', onRowsChanged: () => {}, sendTo: () => {} });
    changes.observe([row(), row({ id: 's2', pid: 11 })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(runner).toHaveBeenCalledTimes(1);
    release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(asks(runner)).toEqual(['--local diff id:s1 --json', '--local diff id:s2 --json']);
    await vi.advanceTimersByTimeAsync(IDLE_INTERVAL_MS);
    expect(changes.rowChanges({ id: 's1' })).toEqual({ additions: 3, deletions: 1, files: 1 });
    changes.stop();
  });

  it('DIFF-2.7, DIFF-1.1: the row counts every file, those past 500 included, and nothing when no file changed', async () => {
    vi.useFakeTimers();
    const { changes } = setup([answer([cand('/r/a', { more_files: 4, stats: { files: 5, additions: 10, deletions: 2 } }), cand('/r/b')])]);
    changes.observe([row()]);
    await vi.advanceTimersByTimeAsync(0);
    expect(changes.rowChanges({ id: 's1' })).toEqual({ additions: 13, deletions: 3, files: 6 });
    expect(changes.rowChanges({ id: 'other' })).toBeNull();
    changes.stop();
  });

  it('DIFF-2.8: a Session without an id is asked by pid; one that left the list drops its answer and schedule', async () => {
    vi.useFakeTimers();
    const { changes, runner } = setup([answer([cand('/r/a', { why: ['cwd'] })])]);
    changes.observe([row({ id: 'codex:42', pid: 42, harness: 'codex' })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(asks(runner)).toEqual(['--local diff pid:42 --json']);
    expect(changes.rowChanges({ id: 'codex:42' })).not.toBeNull();
    changes.observe([]);
    expect(changes.rowChanges({ id: 'codex:42' })).toBeNull();
    await vi.advanceTimersByTimeAsync(IDLE_INTERVAL_MS * 2);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('DIFF-3.6: an open list is read every 3 s and sent when it changes; closing it or the stream ends that', async () => {
    vi.useFakeTimers();
    let n = 0;
    const { changes, runner, sent, onRowsChanged } = setup(() => answer([cand('/r/a', { stats: { files: 1, additions: ++n, deletions: 0 } })], `f${n}`));
    changes.observe([row()]);
    await vi.advanceTimersByTimeAsync(0);
    changes.watch('tab', 's1');
    // The list as it is now, over the tab's stream, before any newer one.
    expect(sent.at(-1)).toMatchObject({ clientId: 'tab', event: { type: 'changes', sessionId: 's1', changes: { checkouts: [{ additions: 1 }] } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(sent.at(-1)).toMatchObject({ clientId: 'tab', event: { type: 'changes', sessionId: 's1', changes: { checkouts: [{ additions: 2 }] } } });
    await vi.advanceTimersByTimeAsync(WATCHED_INTERVAL_MS);
    expect(runner).toHaveBeenCalledTimes(3);
    expect(onRowsChanged).toHaveBeenCalledTimes(3);
    changes.drop('tab');
    await vi.advanceTimersByTimeAsync(WATCHED_INTERVAL_MS * 3);
    expect(runner).toHaveBeenCalledTimes(3);
    changes.watch('tab', null);
    changes.stop();
  });

  it('DIFF-2.6: a Status change while an ask runs still asks at once after it', async () => {
    vi.useFakeTimers();
    const runner = vi.fn<Runner>(() => new Promise((resolve) => setTimeout(() => resolve(answer([cand('/r/a')])), 1000)));
    const changes = new Changes({ runner, fleetBin: () => 'fleet', onRowsChanged: () => {}, sendTo: () => {} });
    changes.observe([row()]);
    await vi.advanceTimersByTimeAsync(0);
    expect(runner).toHaveBeenCalledTimes(1);
    changes.observe([row({ status: 'busy' })]);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1); // not BUSY_INTERVAL_MS later
    expect(runner).toHaveBeenCalledTimes(2);
    changes.stop();
  });

  it("DIFF-5.1: a Fleet without `diff` shows nothing and isn't asked again", async () => {
    vi.useFakeTimers();
    const err = Object.assign(new Error('exit 2'), { stderr: "error: unrecognized subcommand 'diff'\n" }) as RunError;
    const { changes, runner } = setup([err]);
    changes.observe([row(), row({ id: 's2', pid: 11 })]);
    await vi.advanceTimersByTimeAsync(IDLE_INTERVAL_MS * 3);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(changes.rowChanges({ id: 's1' })).toBeNull();
  });

  it('DIFF-5.2: a failed ask keeps the last count for at most 2 minutes, then hides it until an ask succeeds', async () => {
    vi.useFakeTimers();
    const fail = Object.assign(new Error('timed out'), { timedOut: true }) as RunError;
    const { changes } = setup([answer([cand('/r/a')]), fail, fail, fail, answer([cand('/r/a')], 'f2')]);
    changes.observe([row({ status: 'busy' })]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(BUSY_INTERVAL_MS * 3);
    expect(changes.rowChanges({ id: 's1' })).not.toBeNull();
    await vi.advanceTimersByTimeAsync(STALE_MS - BUSY_INTERVAL_MS * 3 + 1);
    expect(changes.rowChanges({ id: 's1' })).not.toBeNull(); // the 4th ask succeeded meanwhile
    changes.stop();
    const { changes: c2 } = setup([answer([cand('/r/a')]), fail]);
    c2.observe([row({ status: 'busy' })]);
    await vi.advanceTimersByTimeAsync(0);
    c2.stop();
    await vi.advanceTimersByTimeAsync(STALE_MS + 1);
    expect(c2.rowChanges({ id: 's1' })).toBeNull();
  });
});

describe('opening a file in VS Code', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], {
      cwd,
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    })
      .toString()
      .trim();

  function world() {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lookout-diff-')));
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'src'), { recursive: true });
    git(dir, 'init', '-q', repo);
    writeFileSync(join(repo, 'src/a.ts'), 'one\n');
    writeFileSync(join(repo, 'gone.txt'), 'was here\n');
    writeFileSync(join(repo, 'old.ts'), 'moved\n');
    writeFileSync(join(repo, 'latin.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])); // "café" in Latin-1
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'init');
    const base = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'checkout', '-qb', 'feat');
    writeFileSync(join(repo, 'src/a.ts'), 'one\ntwo\n');
    writeFileSync(join(repo, 'new.ts'), 'fresh\n');
    writeFileSync(join(repo, 'latin.txt'), Buffer.from([0x74, 0xe9, 0x0a]));
    rmSync(join(repo, 'gone.txt'));
    git(repo, 'mv', 'old.ts', 'renamed.ts');
    writeFileSync(join(repo, 'logo.png'), Buffer.from([0, 1, 2]));
    symlinkSync('/etc/hosts', join(repo, 'out.txt'));
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const log = join(dir, 'code.log');
    writeFileSync(join(bin, 'code'), `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> '${log}'; done\n[ -n "$CODE_FAIL" ] && { echo "no window" >&2; exit 1; }\nexit 0\n`);
    chmodSync(join(bin, 'code'), 0o755);
    const f = (path: string, kind: string, o: Record<string, unknown> = {}) => ({ path, kind, old_path: null, additions: 1, deletions: 0, binary: false, uncommitted: true, ...o });
    const files = [
      f('src/a.ts', 'modified'),
      f('new.ts', 'added'),
      f('gone.txt', 'deleted'),
      f('renamed.ts', 'renamed', { old_path: 'old.ts' }),
      f('logo.png', 'added', { binary: true }),
      f('out.txt', 'added'),
      f('sub', 'submodule'),
      f('latin.txt', 'modified'),
    ];
    let now = 1_000_000;
    const diffsDir = join(dir, 'diffs');
    const changes = new Changes({
      runner: run,
      fleetBin: () => join(bin, 'fleet'),
      onRowsChanged: () => {},
      sendTo: () => {},
      diffsDir,
      env: { PATH: bin },
      vscodeAppCode: join(dir, 'no-such-code'),
      now: () => now,
    });
    // The answer, as Fleet would give it, put in place without running Fleet.
    const entries = (changes as unknown as { entries: Map<string, unknown> }).entries;
    entries.set('s1', {
      row: { id: 's1', pid: 1, harness: 'claude' },
      status: 'idle',
      due: Number.MAX_SAFE_INTEGER,
      fingerprint: 'f',
      okAt: now,
      askedAt: now,
      checkouts: parseCandidates([cand(repo, { base: { ref: 'main', sha: base }, files, stats: { files: files.length, additions: 7, deletions: 0 } })], 'claude'),
    });
    const logged = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
    const clearLog = () => rmSync(log, { force: true });
    return { dir, repo, bin, diffsDir, changes, logged, clearLog, tick: (ms: number) => (now += ms), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  const refused = async (p: Promise<void>, status: number, message: RegExp) => {
    const err = await p.then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ChangesError);
    expect((err as ChangesError).status).toBe(status);
    expect((err as ChangesError).message).toMatch(message);
  };

  it('DIFF-4.1: a modified or renamed file opens as `code --diff <base copy> <file>`, the base from the Branch point', async () => {
    const w = world();
    try {
      await w.changes.open('s1', { root: w.repo, path: 'src/a.ts' });
      const [flag, copy, live] = w.logged();
      expect(flag).toBe('--diff');
      expect(readFileSync(copy!, 'utf8')).toBe('one\n');
      expect(live).toBe(join(w.repo, 'src/a.ts'));
      w.clearLog();
      await w.changes.open('s1', { root: w.repo, path: 'renamed.ts' });
      const [, renamedCopy] = w.logged();
      expect(readFileSync(renamedCopy!, 'utf8')).toBe('moved\n');
      expect(renamedCopy!.endsWith('/renamed.ts')).toBe(true);
      w.clearLog();
      await w.changes.open('s1', { root: w.repo, path: 'latin.txt' });
      const [, latinCopy] = w.logged();
      expect(readFileSync(latinCopy!)).toEqual(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])); // the bytes, not U+FFFD
    } finally {
      w.cleanup();
    }
  });

  it('DIFF-4.2: added against an empty copy, deleted alone, an existing binary alone, a submodule never', async () => {
    const w = world();
    try {
      await w.changes.open('s1', { root: w.repo, path: 'new.ts' });
      const [, empty] = w.logged();
      expect(readFileSync(empty!, 'utf8')).toBe('');
      w.clearLog();
      await w.changes.open('s1', { root: w.repo, path: 'gone.txt' });
      const deleted = w.logged();
      expect(deleted).toHaveLength(1);
      expect(readFileSync(deleted[0]!, 'utf8')).toBe('was here\n');
      w.clearLog();
      await w.changes.open('s1', { root: w.repo, path: 'logo.png' });
      expect(w.logged()).toEqual([join(w.repo, 'logo.png')]);
      await refused(w.changes.open('s1', { root: w.repo, path: 'sub' }), 400, /submodule/);
    } finally {
      w.cleanup();
    }
  });

  it('DIFF-4.3: a base copy is a new read-only file under its own name in a private folder; copies older than a day go', async () => {
    const w = world();
    try {
      await w.changes.open('s1', { root: w.repo, path: 'src/a.ts' });
      const copy = w.logged()[1]!;
      expect(dirname(dirname(copy))).toBe(w.diffsDir);
      expect(copy.endsWith('/a.ts')).toBe(true);
      expect(statSync(copy).mode & 0o777).toBe(0o444);
      expect(statSync(w.diffsDir).mode & 0o777).toBe(0o700);
      expect(statSync(dirname(copy)).mode & 0o777).toBe(0o700);
      const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      utimesSync(dirname(copy), old, old);
      await w.changes.prune();
      expect(existsSync(dirname(copy))).toBe(true); // `now` is the test's clock; with the real one it goes
      const real = new Changes({ runner: run, fleetBin: () => 'fleet', onRowsChanged: () => {}, sendTo: () => {}, diffsDir: w.diffsDir });
      await real.prune();
      expect(existsSync(dirname(copy))).toBe(false);
    } finally {
      w.cleanup();
    }
  });

  it('DIFF-4.4: only a listed file of a fresh answer, inside its Checkout', async () => {
    const w = world();
    try {
      await refused(w.changes.open('s1', { root: w.repo, path: 'not-listed.ts' }), 404, /doesn't have that file/);
      await refused(w.changes.open('s1', { root: '/elsewhere', path: 'src/a.ts' }), 404, /doesn't have that file/);
      await refused(w.changes.open('s1', { root: w.repo }), 400, /root, path/);
      await refused(w.changes.open('s1', { root: w.repo, path: 'out.txt' }), 403, /outside its Checkout/);
      rmSync(join(w.repo, 'new.ts'));
      await refused(w.changes.open('s1', { root: w.repo, path: 'new.ts' }), 410, /gone/);
      w.tick(STALE_MS + 1);
      await refused(w.changes.open('s1', { root: w.repo, path: 'src/a.ts' }), 409, /out of date/);
      expect(w.logged()).toEqual([]);
    } finally {
      w.cleanup();
    }
  });

  it('DIFF-4.4: a folder swapped for a symlink out of the Checkout while the base is read never reaches VS Code', async () => {
    const w = world();
    try {
      const outside = join(w.dir, 'outside');
      mkdirSync(outside);
      writeFileSync(join(outside, 'a.ts'), 'not yours\n');
      const swapping = new Changes({
        runner: async (f, a, o) => {
          if (f === 'git') {
            rmSync(join(w.repo, 'src'), { recursive: true });
            symlinkSync(outside, join(w.repo, 'src'));
          }
          return run(f, a, o);
        },
        fleetBin: () => 'fleet',
        onRowsChanged: () => {},
        sendTo: () => {},
        diffsDir: w.diffsDir,
        env: { PATH: w.bin },
        now: () => 1_000_000,
      });
      (swapping as unknown as { entries: Map<string, unknown> }).entries = (w.changes as unknown as { entries: Map<string, unknown> }).entries;
      await refused(swapping.open('s1', { root: w.repo, path: 'src/a.ts' }), 403, /outside its Checkout/);
      expect(w.logged()).toEqual([]);
    } finally {
      w.cleanup();
    }
  });

  it('DIFF-4.5: `code` from the PATH, else VS Code’s own; without either, "VS Code not found" and nothing runs', async () => {
    const w = world();
    try {
      expect(w.changes.codeBin()).toBe(join(w.bin, 'code'));
      const none = new Changes({ runner: run, fleetBin: () => 'fleet', onRowsChanged: () => {}, sendTo: () => {}, env: { PATH: '' }, vscodeAppCode: join(w.bin, 'code') });
      expect(none.codeBin()).toBe(join(w.bin, 'code'));
      rmSync(join(w.bin, 'code'));
      await refused(w.changes.open('s1', { root: w.repo, path: 'src/a.ts' }), 404, /^VS Code not found$/);
    } finally {
      w.cleanup();
    }
  });

  it("DIFF-4.6: `code` failing says why, with its first line", async () => {
    const w = world();
    try {
      const failing = new Changes({ runner: (f, a, o) => run(f, a, { ...o, env: { ...process.env, CODE_FAIL: '1' } }), fleetBin: () => 'fleet', onRowsChanged: () => {}, sendTo: () => {}, diffsDir: w.diffsDir, env: { PATH: w.bin } });
      (failing as unknown as { entries: Map<string, unknown> }).entries = (w.changes as unknown as { entries: Map<string, unknown> }).entries;
      (failing as unknown as { now: () => number }).now = () => 1_000_000;
      await refused(failing.open('s1', { root: w.repo, path: 'src/a.ts' }), 502, /VS Code didn't open it: no window/);
    } finally {
      w.cleanup();
    }
  });
});
