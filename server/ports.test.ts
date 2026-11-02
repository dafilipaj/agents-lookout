import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PortsSnapshot } from '../shared/ports.ts';
import type { RunError, Runner } from './exec.ts';
import { DEVCTL_ARGS, LISTEN_ARGS, PS_PORTS_ARGS, PortsMonitor, cwdArgs, findCheckout, resolveDevctlBin } from './ports.ts';

const LISTEN = 'p501\nR40\ncnode\nf10\nn127.0.0.1:5173\nf11\nn[::1]:5173\n';
const CWDS = 'p501\nfcwd\nn/tmp/elsewhere\n';
const PS = '  501    40   501       01:00\n   40    10    40       02:00\n';
const DEVCTL = '[]';
const fail = (patch: Partial<RunError>): RunError => Object.assign(new Error(patch.message ?? 'failed'), patch);

interface Answers { listen?: string | RunError; cwds?: string | RunError; ps?: string | RunError; devctl?: string | RunError }
function setup(answers: () => Answers = () => ({}), now = () => 1_000_000) {
  const changed = vi.fn<(p: PortsSnapshot) => void>();
  const answer = (v: string | RunError | undefined, fallback: string) => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v ?? fallback));
  const run = vi.fn<Runner>(async (file, args) => {
    const a = answers();
    if (file.endsWith('tb-devctl')) return answer(a.devctl, DEVCTL);
    if (file.endsWith('ps')) return answer(a.ps, PS);
    return args.includes('-iTCP') ? answer(a.listen, LISTEN) : answer(a.cwds, CWDS);
  });
  const monitor = new PortsMonitor({
    runner: run,
    sessions: () => [{ id: 's-1', harness: 'claude', pid: 10, cwd: '/tmp' }],
    onChange: changed,
    pid: 100,
    now,
    env: { PATH: '', HOME: '/Users/me', LOOKOUT_TB_DEVCTL_BIN: '/bin/tb-devctl' },
    checkout: () => null,
  });
  return { monitor, run, changed };
}
afterEach(() => vi.useRealTimers());

describe('PORTS-1.1: the reads', () => {
  it('PORTS-1.1: lsof, the listeners\' working directories, ps and tb-devctl, each through the runner with a 2 s timeout', async () => {
    const { monitor, run } = setup();
    await monitor.tick();
    expect(run.mock.calls.map(([file, args]) => [file, args])).toEqual([
      ['/usr/sbin/lsof', LISTEN_ARGS],
      ['/bin/ps', PS_PORTS_ARGS],
      ['/bin/tb-devctl', DEVCTL_ARGS],
      ['/usr/sbin/lsof', cwdArgs([501])],
    ]);
    expect(cwdArgs([501, 502])).toEqual(['-nP', '-a', '-d', 'cwd', '-Fpn', '-p', '501,502']);
    for (const [, , options] of run.mock.calls) {
      expect(options.timeoutMs).toBe(2000);
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
    expect(monitor.snapshot()).toEqual({
      readAt: 1_000_000,
      error: null,
      servers: [expect.objectContaining({ pid: 501, ports: [5173], name: 'node', cwd: '/tmp/elsewhere', sessionId: 's-1', by: 'tree', startedAt: 940_000, url: 'http://localhost:5173', shown: true })],
    });
    await monitor.close();
  });

  it('PORTS-1.1: lsof exiting 1 with no output is no listener; another failure keeps the last list and says why', async () => {
    let answers: Answers = { listen: fail({ code: 1, stdout: '' }) };
    let now = 1_000_000;
    const { monitor, run } = setup(() => answers, () => now);
    await monitor.tick();
    expect(monitor.snapshot()).toEqual({ servers: [], readAt: 1_000_000, error: null });
    // Its warnings say nothing of the listeners.
    answers = { listen: fail({ code: 1, stdout: '', stderr: 'lsof: WARNING: can\'t stat() nfs file system /Volumes/x\n' }) };
    await monitor.tick();
    expect(monitor.snapshot()).toEqual({ servers: [], readAt: 1_000_000, error: null });
    expect(run.mock.calls.some(([, args]) => args.includes('cwd'))).toBe(false);

    answers = {};
    now = 1_005_000;
    await monitor.tick();
    expect(monitor.snapshot()?.servers).toHaveLength(1);
    now = 1_010_000;
    answers = { listen: fail({ timedOut: true, code: null }) };
    await monitor.tick();
    expect(monitor.snapshot()).toMatchObject({ readAt: 1_005_000, error: 'lsof timed out', servers: [{ pid: 501 }] });
    answers = { listen: fail({ code: 'ENOENT' }) };
    await monitor.tick();
    expect(monitor.snapshot()?.error).toBe('lsof was not found');
    answers = { listen: fail({ code: 1, stdout: '', stderr: 'lsof: status error on /dev/x\n' }) };
    await monitor.tick();
    expect(monitor.snapshot()).toMatchObject({ error: 'lsof: status error on /dev/x', servers: [{ pid: 501 }] });
    answers = { listen: fail({ code: 2, stderr: 'lsof: bad option\nmore\n' }) };
    await monitor.tick();
    expect(monitor.snapshot()?.error).toBe('lsof: bad option');
    answers = {};
    await monitor.tick();
    expect(monitor.snapshot()?.error).toBeNull();
    await monitor.close();
  });

  it('PORTS-1.1: the other reads failing only leave out what they add', async () => {
    const { monitor } = setup(() => ({ cwds: fail({ code: 1, stdout: '' }), ps: fail({ timedOut: true }), devctl: fail({ code: 'ENOENT' }) }));
    await monitor.tick();
    expect(monitor.snapshot()?.servers).toEqual([expect.objectContaining({ pid: 501, cwd: null, dir: null, startedAt: null, sessionId: null, shown: false })]);
    await monitor.close();
  });

  it('PORTS-1.1: a pid gone between the two lsof runs leaves the others\' directories', async () => {
    const { monitor } = setup(() => ({ cwds: fail({ code: 1, stdout: CWDS }) }));
    await monitor.tick();
    expect(monitor.snapshot()?.servers[0]?.cwd).toBe('/tmp/elsewhere');
    await monitor.close();
  });

  it('PORTS-1.1: tb-devctl from its variable, PATH or ~/.local/bin; a checkout by its .git folder or a Worktree\'s .git file', () => {
    expect(resolveDevctlBin({ PATH: '', HOME: '/nowhere' })).toBe('tb-devctl');
    const root = mkdtempSync(join(tmpdir(), 'ports-'));
    try {
      mkdirSync(join(root, 'repo', '.git', 'worktrees', 'wt'), { recursive: true });
      writeFileSync(join(root, 'repo', '.git', 'worktrees', 'wt', 'commondir'), '../..\n');
      mkdirSync(join(root, 'wt', 'src'), { recursive: true });
      writeFileSync(join(root, 'wt', '.git'), `gitdir: ${join(root, 'repo', '.git', 'worktrees', 'wt')}\n`);
      mkdirSync(join(root, 'repo', 'web'));
      expect(findCheckout(join(root, 'repo', 'web'))).toEqual({ root: join(root, 'repo'), commonDir: join(root, 'repo', '.git') });
      expect(findCheckout(join(root, 'wt', 'src'))).toEqual({ root: join(root, 'wt'), commonDir: join(root, 'repo', '.git') });
      mkdirSync(join(root, 'plain'));
      expect(findCheckout(join(root, 'plain'))).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('PORTS-1.2, PORTS-1.5: the schedule and what changes', () => {
  it('PORTS-1.2: every 5 s while a tab is connected, one read for every tab, none once the last goes', async () => {
    vi.useFakeTimers();
    const { monitor, run } = setup();
    expect(run).not.toHaveBeenCalled();
    const tab1 = monitor.watch();
    const tab2 = monitor.watch();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(4999);
    expect(run).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(8);
    tab1(); tab1(); tab2();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(8);
    await monitor.close();
  });

  it('PORTS-1.2: reads never overlap, and close cancels the read in flight', async () => {
    vi.useFakeTimers();
    let release: (() => void) | null = null;
    const runner = vi.fn<Runner>((_file, _args, opts) => new Promise<string>((resolve, reject) => {
      release = () => resolve('');
      opts.signal?.addEventListener('abort', () => reject(fail({ aborted: true })));
    }));
    const monitor = new PortsMonitor({ runner, sessions: () => [], onChange: vi.fn(), env: { PATH: '' } });
    monitor.watch();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(runner).toHaveBeenCalledTimes(3);
    expect(release).not.toBeNull();
    await monitor.close();
    expect(monitor.snapshot()).toBeNull();
  });

  it('PORTS-1.2, PORTS-1.5: an unchanged read sends nothing; the start time is kept per pid and command', async () => {
    let now = 1_000_000;
    let ps = PS;
    let listen = LISTEN;
    const { monitor, changed } = setup(() => ({ ps, listen }), () => now);
    await monitor.tick();
    expect(changed).toHaveBeenCalledTimes(1);
    now += 5000;
    ps = '  501    40   501       01:06\n   40    10    40       02:06\n';
    await monitor.tick();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(monitor.snapshot()?.servers[0]?.startedAt).toBe(940_000);
    // Another command under the same pid is another server, with its own start time.
    listen = LISTEN.replace('cnode', 'cvite');
    await monitor.tick();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(monitor.snapshot()?.servers[0]).toMatchObject({ command: 'vite', startedAt: 939_000 });
    // A failed ps shows no start time, and the next good read finds the one it knew.
    let psFails = true;
    const flaky = setup(() => ({ ps: psFails ? fail({ timedOut: true }) : PS }), () => now);
    psFails = false;
    await flaky.monitor.tick();
    expect(flaky.monitor.snapshot()?.servers[0]?.startedAt).toBe(now - 60_000);
    const first = now - 60_000;
    now += 30_000;
    psFails = true;
    await flaky.monitor.tick();
    expect(flaky.monitor.snapshot()?.servers[0]?.startedAt).toBeNull();
    psFails = false;
    await flaky.monitor.tick();
    expect(flaky.monitor.snapshot()?.servers[0]?.startedAt).toBe(first);
    await flaky.monitor.close();
    await monitor.close();
  });
});
