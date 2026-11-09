import { describe, expect, it, vi } from 'vitest';
import type { RunError, Runner } from './exec.ts';
import { DEVCTL_ARGS, LISTEN_ARGS, PortsMonitor } from './ports.ts';
import { STOP_PS_ARGS, StopError, type StopTarget, commandName, distance, findJob, overlaps, parseStopPs, parseStopTarget, startWindow, stopServer } from './ports-stop.ts';

const NOW = 10_000_000;
const ME = 501;

interface P {
  pid: number;
  ppid: number;
  pgid: number;
  comm: string;
  /** Seconds it has run at NOW. */
  age?: number;
  uid?: number;
  /** Ignores SIGTERM (PORTS-4.3). */
  stubborn?: boolean;
  /** Never goes, even after SIGKILL. */
  stuck?: boolean;
  ports?: number[];
  /** The command `lsof` names; the comm's last part when unset. */
  lsof?: string;
}

const etime = (s: number) => {
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
};

/**
 * A Mac's process table and listeners: lsof, ps and tb-devctl answer from it, `kill` changes it, and
 * `sleep` moves the clock, so a Stop runs end to end without signalling anything real.
 */
function machine(
  procs: P[],
  opts: {
    devctl?: unknown[] | RunError;
    down?: RunError;
    lookout?: number;
    sessions?: number[];
    after?: (signal: string, pid: number) => void;
    /** Before a signal lands, whatever it is: a process can exec something else. */
    onSignal?: (signal: string, pid: number) => void;
    /** How long tb-devctl's read takes, and what happens meanwhile. */
    devctlMs?: number;
    onDevctl?: () => void;
    /** How long each ps run takes; it reads the table halfway through. */
    psMs?: number;
    psFails?: () => boolean;
    lsofFails?: () => boolean;
  } = {},
) {
  let now = NOW;
  const table = new Map(procs.map((p) => [p.pid, { uid: ME, age: 60, ...p, start: NOW - (p.age ?? 60) * 1000 }]));
  const signals: [string, number][] = [];
  const runner = vi.fn<Runner>(async (file, args) => {
    if (file.endsWith('tb-devctl')) {
      if (args[0] === 'down') {
        if (opts.down) throw opts.down;
        for (const p of table.values()) if (p.ports) table.delete(p.pid);
        return '';
      }
      now += opts.devctlMs ?? 0;
      opts.onDevctl?.();
      if (opts.devctl instanceof Error) throw opts.devctl;
      return JSON.stringify(opts.devctl ?? []);
    }
    if (file.endsWith('ps')) {
      expect(args).toEqual(STOP_PS_ARGS);
      if (opts.psFails?.()) throw Object.assign(new Error('ps'), { timedOut: true });
      now += (opts.psMs ?? 0) / 2;
      // ps counts whole seconds, as macOS's does.
      const out = [...table.values()].map((p) => `${p.pid} ${p.ppid} ${p.pgid} ${p.uid} S ${etime(Math.floor((now - p.start) / 1000))} ${p.comm}`).join('\n') + '\n';
      now += (opts.psMs ?? 0) / 2;
      return out;
    }
    expect(args).toEqual(LISTEN_ARGS);
    if (opts.lsofFails?.()) throw Object.assign(new Error('lsof timed out'), { timedOut: true });
    const listening = [...table.values()].filter((p) => p.ports?.length);
    if (!listening.length) throw Object.assign(new Error('lsof'), { code: 1, stdout: '', stderr: '' });
    return listening.map((p) => `p${p.pid}\nc${p.lsof ?? commandName(p.comm)}\n${p.ports!.map((port) => `n*:${port}`).join('\n')}\n`).join('');
  });
  const kill = vi.fn((pid: number, signal: NodeJS.Signals) => {
    signals.push([signal, pid]);
    opts.onSignal?.(signal, pid);
    const p = table.get(pid);
    if (!p) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    if (p.stuck || (signal === 'SIGTERM' && p.stubborn)) return;
    table.delete(pid);
    opts.after?.(signal, pid);
  });
  const stop = (target: Partial<StopTarget> & { pid: number }) => {
    const p = table.get(target.pid);
    return stopServer(
      {
        runner,
        sessions: () => (opts.sessions ?? []).map((pid, i) => ({ id: `s-${i}`, harness: 'claude', pid, cwd: null })),
        pid: opts.lookout ?? 9000,
        uid: ME,
        env: { PATH: '', HOME: '/Users/me', LOOKOUT_TB_DEVCTL_BIN: '/bin/tb-devctl' },
        now: () => now,
        kill,
        sleep: async (ms) => {
          now += ms;
        },
      },
      { command: p ? (p.lsof ?? commandName(p.comm)) : 'node', startedAt: p ? p.start : NOW, devctl: false, ...target },
    );
  };
  return { table, signals, runner, kill, stop, add: (p: P) => table.set(p.pid, { uid: ME, age: 0, ...p, start: now - (p.age ?? 0) * 1000 }) };
}

/** `pnpm dev` from Claude Code's Bash tool: claude → zsh -c (leading its group) → pnpm → sh -c vite → node, with esbuild under it. */
const PNPM_UNDER_CLAUDE: P[] = [
  { pid: 1, ppid: 0, pgid: 1, comm: '/sbin/launchd', uid: 0 },
  { pid: 300, ppid: 1, pgid: 300, comm: '/opt/homebrew/bin/tmux' },
  { pid: 310, ppid: 300, pgid: 310, comm: '-zsh' },
  { pid: 320, ppid: 310, pgid: 320, comm: 'claude' },
  { pid: 400, ppid: 320, pgid: 400, comm: '/bin/zsh' },
  { pid: 410, ppid: 400, pgid: 400, comm: 'node' },
  { pid: 420, ppid: 410, pgid: 400, comm: '/bin/sh' },
  { pid: 430, ppid: 420, pgid: 400, comm: '/Users/me/.nvm/versions/node/v25.2.1/bin/node', ports: [5173] },
  { pid: 440, ppid: 430, pgid: 400, comm: '/Users/me/app/node_modules/@esbuild/darwin-arm64/bin/esbuild' },
  { pid: 450, ppid: 400, pgid: 400, comm: 'node' },
];

describe('PORTS-4.1: Stop ends the server\'s job and frees its port', () => {
  it('PORTS-4.1: pnpm dev → sh -c vite → node and what node started, all stopped; the port is free afterwards', async () => {
    const m = machine(PNPM_UNDER_CLAUDE);
    await expect(m.stop({ pid: 430 })).resolves.toEqual({ how: 'stopped', count: 4 });
    expect(m.signals).toEqual([['SIGTERM', 410], ['SIGTERM', 420], ['SIGTERM', 430], ['SIGTERM', 440]]);
    expect([...m.table.keys()]).toEqual([1, 300, 310, 320, 400, 450]);
    // The last listener query found :5173 free.
    expect(m.runner.mock.calls.filter(([, args]) => args === LISTEN_ARGS).length).toBeGreaterThanOrEqual(2);
  });

  it('PORTS-4.1: a server started from the terminal is its own job: pnpm leads its group under the shell', () => {
    const procs = parseStopPs(
      ['300 1 300 501 Ss 01:00 tmux', '310 300 310 501 Ss 01:00 -zsh', '410 310 410 501 S+ 00:30 node', '420 410 410 501 S+ 00:30 /bin/sh', '430 420 410 501 S+ 00:30 node'].join('\n'),
    );
    expect(findJob({ procs, listener: 430, lookout: new Set([9000]), sessions: new Set(), uid: ME })).toEqual({ ok: true, pids: [410, 420, 430] });
  });

  it('PORTS-4.1: a detached server, its parent launchd, is the job alone', () => {
    const procs = parseStopPs(['1 0 1 0 Ss 10:00 /sbin/launchd', '700 1 700 501 S 05:00 node', '710 700 700 501 S 05:00 node'].join('\n'));
    expect(findJob({ procs, listener: 700, lookout: new Set(), sessions: new Set(), uid: ME })).toEqual({ ok: true, pids: [700, 710] });
  });

  it('PORTS-4.1: a port taken again once the job is gone fails the Stop with who holds it', async () => {
    const m = machine([{ pid: 1, ppid: 0, pgid: 1, comm: 'launchd', uid: 0 }, { pid: 700, ppid: 1, pgid: 700, comm: 'node', ports: [3000] }], {
      after: () => m.add({ pid: 800, ppid: 1, pgid: 800, comm: 'ruby', ports: [3000] }),
    });
    await expect(m.stop({ pid: 700 })).rejects.toThrow('Stopped, but :3000 is in use again by ruby (pid 800).');
  });
});

describe('PORTS-4.2: what Stop never ends', () => {
  it('PORTS-4.2: tmux, the terminal\'s shell, Claude Code and the zsh -c it ran the command in are never signalled', async () => {
    const m = machine(PNPM_UNDER_CLAUDE);
    await m.stop({ pid: 430 });
    const signalled = new Set(m.signals.map(([, pid]) => pid));
    for (const pid of [1, 300, 310, 320, 400]) expect(signalled.has(pid)).toBe(false);
    // The Harness's other work in that group isn't the server's.
    expect(signalled.has(450)).toBe(false);
  });

  it('PORTS-4.2: a Session in Fleet\'s list stops the walk even under another name, and Lookout and its ancestors are never stopped', () => {
    const procs = parseStopPs(['500 1 500 501 S 05:00 node', '510 500 500 501 S 05:00 node', '9000 8990 8990 501 S 05:00 node', '8990 1 8990 501 S 05:00 node'].join('\n'));
    expect(findJob({ procs, listener: 510, lookout: new Set([9000, 8990]), sessions: new Set([500]), uid: ME })).toEqual({ ok: true, pids: [510] });
    expect(findJob({ procs, listener: 9000, lookout: new Set([9000, 8990]), sessions: new Set(), uid: ME })).toEqual({ ok: false, reason: "It's part of Lookout itself, which never stops itself." });
  });

  it('PORTS-4.2: a job holding a Harness, a Session host or a shell leading its own group is refused, with nothing signalled and no word of tmux', async () => {
    const base: P[] = [{ pid: 1, ppid: 0, pgid: 1, comm: 'launchd', uid: 0 }, { pid: 700, ppid: 1, pgid: 700, comm: 'node', ports: [3000] }];
    for (const [child, why] of [
      [{ pid: 710, ppid: 700, pgid: 700, comm: '/Users/me/.local/bin/claude' }, 'It runs inside a Session (claude, pid 710)'],
      [{ pid: 710, ppid: 700, pgid: 700, comm: 'codex' }, 'It runs inside a Session (codex, pid 710)'],
      [{ pid: 710, ppid: 700, pgid: 700, comm: '/opt/homebrew/bin/tmux' }, 'It runs inside a Session host (pid 710)'],
      [{ pid: 710, ppid: 700, pgid: 710, comm: '/bin/zsh' }, 'It started a shell of its own (pid 710)'],
    ] as const) {
      const m = machine([...base, child]);
      const err = await m.stop({ pid: 700 }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StopError);
      expect((err as StopError).status).toBe(409);
      expect((err as Error).message).toContain(why);
      expect((err as Error).message).not.toMatch(/tmux/i);
      expect(m.signals).toEqual([]);
    }
  });

  it('PORTS-4.2: Lookout\'s own server and a process of another user are refused before any signal', async () => {
    const own = machine([{ pid: 1, ppid: 0, pgid: 1, comm: 'launchd', uid: 0 }, { pid: 9000, ppid: 1, pgid: 9000, comm: 'node', ports: [4747] }], { lookout: 9000 });
    await expect(own.stop({ pid: 9000 })).rejects.toThrow("It's part of Lookout itself");
    const other = machine([{ pid: 1, ppid: 0, pgid: 1, comm: 'launchd', uid: 0 }, { pid: 700, ppid: 1, pgid: 700, comm: 'mysqld', uid: 74, ports: [3306] }]);
    await expect(other.stop({ pid: 700 })).rejects.toThrow('It runs as another user (mysqld, pid 700)');
    expect([...own.signals, ...other.signals]).toEqual([]);
  });

  it('PORTS-4.2: a command\'s name is its path\'s last part, a login shell\'s dash dropped', () => {
    expect(['/bin/zsh', '-zsh', 'claude', '/Users/me/.local/bin/claude', 'npm exec vitest'].map(commandName)).toEqual(['zsh', 'zsh', 'claude', 'claude', 'npm exec vitest']);
  });
});

describe('PORTS-4.3: forced after 3 s', () => {
  it('PORTS-4.3: a process that ignores SIGTERM gets SIGKILL after 3 s, the others don\'t', async () => {
    const m = machine([{ pid: 1, ppid: 0, pgid: 1, comm: 'launchd', uid: 0 }, { pid: 700, ppid: 1, pgid: 700, comm: 'node', ports: [3000] }, { pid: 710, ppid: 700, pgid: 700, comm: 'node', stubborn: true }]);
    const at = Date.now();
    await expect(m.stop({ pid: 700 })).resolves.toEqual({ how: 'forced', count: 2 });
    expect(m.signals).toEqual([['SIGTERM', 700], ['SIGTERM', 710], ['SIGKILL', 710]]);
    expect(Date.now() - at).toBeLessThan(1000); // the clock is the machine's
  });

  it('PORTS-4.3: a process still there after SIGKILL fails the Stop and names it', async () => {
    const m = machine([{ pid: 1, ppid: 0, pgid: 1, comm: 'launchd', uid: 0 }, { pid: 700, ppid: 1, pgid: 700, comm: 'node', ports: [3000], stuck: true }]);
    await expect(m.stop({ pid: 700 })).rejects.toThrow("It didn't stop: node (pid 700) is still running.");
  });
});

describe('PORTS-4.4: a tb-devctl service', () => {
  const SERVICE = [{ stack: 'test-pr-24926', service: 'api', owner: 'claude:me:abc', state: 'running', url: 'http://x.localhost:4301', pgid: 700, listener_pid: 710 }];
  const PROCS: P[] = [{ pid: 1, ppid: 0, pgid: 1, comm: 'launchd', uid: 0 }, { pid: 700, ppid: 1, pgid: 700, comm: 'ruby' }, { pid: 710, ppid: 700, pgid: 700, comm: 'ruby', ports: [4301] }];

  it('PORTS-4.4: stopped through tb-devctl down <stack> <service>, never --force, with nothing signalled by Lookout', async () => {
    const m = machine(PROCS, { devctl: SERVICE });
    await expect(m.stop({ pid: 710, devctl: true })).resolves.toEqual({ how: 'devctl', count: 0 });
    const down = m.runner.mock.calls.filter(([file, args]) => file === '/bin/tb-devctl' && args !== DEVCTL_ARGS);
    expect(down.map(([, args, o]) => [args, o.timeoutMs])).toEqual([[['down', '--', 'test-pr-24926', 'api'], 20_000]]);
    expect(m.signals).toEqual([]);
  });

  it('PORTS-4.4: found by its process group too, even when the row didn\'t say it was a service', async () => {
    const m = machine(PROCS, { devctl: [{ ...SERVICE[0], listener_pid: null }] });
    await expect(m.stop({ pid: 710 })).resolves.toEqual({ how: 'devctl', count: 0 });
    expect(m.signals).toEqual([]);
  });

  it('PORTS-4.4: a service whose tb-devctl can\'t be read isn\'t stopped any other way', async () => {
    const m = machine(PROCS, { devctl: Object.assign(new Error('timeout'), { timedOut: true }) });
    await expect(m.stop({ pid: 710, devctl: true })).rejects.toThrow("Couldn't ask tb-devctl about it, so nothing was stopped.");
    expect(m.signals).toEqual([]);
  });
});

describe('PORTS-4.5: a failure says why', () => {
  it('PORTS-4.5: tb-devctl\'s refusal comes back in its own words', async () => {
    const m = machine(
      [{ pid: 1, ppid: 0, pgid: 1, comm: 'launchd', uid: 0 }, { pid: 710, ppid: 1, pgid: 710, comm: 'ruby', ports: [4301] }],
      {
        devctl: [{ stack: 's', service: 'api', owner: 'human:other', state: 'running', pgid: 710, listener_pid: 710 }],
        down: Object.assign(new Error('exit 1'), { code: 1, stderr: "Error: Stack 's' belongs to human:other; it is not yours to stop (--force overrides)\n" }),
      },
    );
    const err = (await m.stop({ pid: 710, devctl: true }).catch((e: unknown) => e)) as StopError;
    expect([err.status, err.message]).toEqual([502, "tb-devctl couldn't stop it: Stack 's' belongs to human:other; it is not yours to stop (--force overrides)."]);
  });

  it('PORTS-4.5: an unreadable process table stops nothing', async () => {
    const m = machine([{ pid: 700, ppid: 1, pgid: 700, comm: 'node', ports: [3000] }]);
    m.runner.mockImplementation(async (file, args) => {
      if (file.endsWith('ps')) throw Object.assign(new Error('ps'), { timedOut: true });
      if (file.endsWith('tb-devctl')) return '[]';
      expect(args).toEqual(LISTEN_ARGS);
      return 'p700\ncnode\nn*:3000\n';
    });
    await expect(m.stop({ pid: 700 })).rejects.toThrow("Couldn't read the processes, so nothing was stopped.");
    expect(m.signals).toEqual([]);
  });
});

describe('PORTS-4.7: the server asked for, checked again', () => {
  const PROCS: P[] = [{ pid: 1, ppid: 0, pgid: 1, comm: 'launchd', uid: 0 }, { pid: 700, ppid: 1, pgid: 700, comm: 'node', ports: [3000], age: 600 }];

  it('PORTS-4.7: a start time off by more than 5 s, or another command on the pid, is refused with nothing signalled', async () => {
    const m = machine(PROCS);
    await expect(m.stop({ pid: 700, startedAt: NOW - 600_000 + 4000 })).resolves.toMatchObject({ how: 'stopped' });
    const restarted = machine(PROCS);
    await expect(restarted.stop({ pid: 700, startedAt: NOW - 600_000 - 7000 })).rejects.toThrow('This server was restarted since the list was read, so nothing was stopped.');
    const other = machine(PROCS);
    await expect(other.stop({ pid: 700, command: 'ruby' })).rejects.toThrow('This server changed since the list was read');
    expect([...restarted.signals, ...other.signals]).toEqual([]);
  });

  it('PORTS-4.7: a server no longer listening counts as stopped', async () => {
    const m = machine([{ pid: 1, ppid: 0, pgid: 1, comm: 'launchd', uid: 0 }, { pid: 700, ppid: 1, pgid: 700, comm: 'node' }]);
    await expect(m.stop({ pid: 700, command: 'node', startedAt: NOW })).resolves.toEqual({ how: 'gone', count: 0 });
    expect(m.signals).toEqual([]);
  });

  it('PORTS-4.7: the body is checked before anything runs', () => {
    expect(parseStopTarget({ pid: 700, command: 'node', startedAt: 5, devctl: true })).toEqual({ pid: 700, command: 'node', startedAt: 5, devctl: true });
    expect(parseStopTarget({ pid: 700, command: 'node', startedAt: 5 })).toMatchObject({ devctl: false });
    for (const bad of [null, [], { pid: 1, command: 'x', startedAt: 5 }, { pid: 1.5, command: 'x', startedAt: 5 }, { pid: 700, command: '', startedAt: 5 }, { pid: 700, command: 'x'.repeat(121), startedAt: 5 }, { pid: 700, command: 'x', startedAt: null }]) {
      expect(() => parseStopTarget(bad)).toThrow(StopError);
    }
  });

  it('PORTS-4.7: ps lines that don\'t parse are skipped; a command keeps its spaces', () => {
    const rows = parseStopPs(' 24703 24629 19038 501 S+ 01:02:03 npm exec vitest related --run\nnot a line\n 1 0 1 0 Ss 3-01:00:00 /sbin/launchd\n');
    expect([...rows.values()]).toEqual([
      { pid: 24703, ppid: 24629, pgid: 19038, uid: 501, stat: 'S+', elapsedMs: 3_723_000, comm: 'npm exec vitest related --run' },
      { pid: 1, ppid: 0, pgid: 1, uid: 0, stat: 'Ss', elapsedMs: 262_800_000, comm: '/sbin/launchd' },
    ]);
  });

  it('PORTS-4.7: one Stop per server at a time, and the list is read again after it', async () => {
    let release!: () => void;
    const stop = vi.fn(() => new Promise<{ how: 'stopped'; count: number }>((r) => (release = () => r({ how: 'stopped', count: 1 }))));
    const run = vi.fn<Runner>(async () => '');
    const monitor = new PortsMonitor({ runner: run, sessions: () => [], onChange: () => {}, stop, env: { PATH: '', LOOKOUT_TB_DEVCTL_BIN: '/bin/tb-devctl' }, checkout: () => null });
    const target = { pid: 700, command: 'node', startedAt: NOW, devctl: false };
    const first = monitor.stop(target);
    await expect(monitor.stop(target)).rejects.toThrow('Already stopping it.');
    release();
    await expect(first).resolves.toEqual({ how: 'stopped', count: 1 });
    expect(run).toHaveBeenCalledWith('/usr/sbin/lsof', LISTEN_ARGS, expect.anything());
    await monitor.close();
  });
});

describe('PORTS-4: what the review of slice 2 found', () => {
  const BASE: P[] = [{ pid: 1, ppid: 0, pgid: 1, comm: 'launchd', uid: 0 }, { pid: 700, ppid: 1, pgid: 700, comm: 'node', ports: [3000] }];

  it('PORTS-4.2: a tb-devctl service whose process group holds a Harness is refused before tb-devctl down signals the group', async () => {
    const m = machine([...BASE, { pid: 710, ppid: 700, pgid: 700, comm: 'claude' }], { devctl: [{ stack: 's', service: 'api', state: 'running', pgid: 700, listener_pid: 700 }] });
    await expect(m.stop({ pid: 700, devctl: true })).rejects.toThrow('It runs inside a Session (claude, pid 710)');
    expect(m.runner.mock.calls.some(([, args]) => args[0] === 'down')).toBe(false);
  });

  it('PORTS-4.2: a process that becomes a Harness after SIGTERM is never forced', async () => {
    const m = machine([...BASE, { pid: 710, ppid: 700, pgid: 700, comm: 'node', stubborn: true }], {
      onSignal: (signal, pid) => {
        const p = m.table.get(710);
        if (signal === 'SIGTERM' && pid === 710 && p) p.comm = '/Users/me/.local/bin/claude';
      },
    });
    await expect(m.stop({ pid: 700 })).rejects.toThrow('It runs inside a Session (claude, pid 710), which Lookout never stops this way. Nothing was forced.');
    expect(m.signals).toEqual([['SIGTERM', 700], ['SIGTERM', 710]]);
  });

  it('PORTS-4.3: nothing is forced on a process table Lookout couldn\'t read', async () => {
    let failing = false;
    const m = machine([...BASE, { pid: 710, ppid: 700, pgid: 700, comm: 'node', stubborn: true }], { psFails: () => failing, onSignal: () => (failing = true) });
    await expect(m.stop({ pid: 700 })).rejects.toThrow("Asked it to stop, but couldn't check what is still running, so nothing was forced.");
    expect(m.signals.filter(([signal]) => signal === 'SIGKILL')).toEqual([]);
  });

  it('PORTS-4.7: a slow tb-devctl read doesn\'t lose a stubborn process: each start time comes from its own sample', async () => {
    const m = machine([...BASE, { pid: 710, ppid: 700, pgid: 700, comm: 'node', stubborn: true }], { devctlMs: 2900 });
    await expect(m.stop({ pid: 700 })).resolves.toEqual({ how: 'forced', count: 2 });
    expect(m.signals).toContainEqual(['SIGKILL', 710]);
  });

  it('PORTS-4.1: a port Lookout can\'t check afterwards fails the Stop instead of passing it', async () => {
    let failing = false;
    const m = machine(BASE, { after: () => (failing = true), lsofFails: () => failing });
    await expect(m.stop({ pid: 700 })).rejects.toThrow("Stopped it, but couldn't check that :3000 is free: lsof timed out.");
  });
});

describe('PORTS-4: what the second review of slice 2 found', () => {
  const BASE: P[] = [{ pid: 1, ppid: 0, pgid: 1, comm: 'launchd', uid: 0 }, { pid: 700, ppid: 1, pgid: 700, comm: 'node', ports: [3000] }];

  it('PORTS-4.7: the listeners are read again after tb-devctl, so a pid that stopped listening meanwhile is never signalled', async () => {
    const m = machine(BASE, {
      devctlMs: 1500,
      onDevctl: () => {
        const p = m.table.get(700)!;
        p.comm = 'ruby';
        p.ports = [];
      },
    });
    await expect(m.stop({ pid: 700, command: 'node' })).resolves.toEqual({ how: 'gone', count: 0 });
    expect(m.signals).toEqual([]);
  });

  it('PORTS-4.4: a tb-devctl record whose group isn\'t the listener\'s is another process\'s, left by a reused pid', async () => {
    const stale = [{ stack: 's', service: 'api', state: 'running', pgid: 999, listener_pid: 700 }];
    const asRow = machine(BASE, { devctl: stale });
    await expect(asRow.stop({ pid: 700 })).resolves.toEqual({ how: 'stopped', count: 1 });
    expect(asRow.runner.mock.calls.some(([, args]) => args[0] === 'down')).toBe(false);
    const asService = machine(BASE, { devctl: stale });
    await expect(asService.stop({ pid: 700, devctl: true })).rejects.toThrow('tb-devctl no longer lists it as a service, so nothing was stopped.');
    expect(asService.signals).toEqual([]);
  });

  it('PORTS-4.4: a stack or service named like an option is refused, and names always follow `--`', async () => {
    for (const [stack, service] of [['review', '--force'], ['-x', 'api']]) {
      const m = machine(BASE, { devctl: [{ stack, service, state: 'running', pgid: 700, listener_pid: 700 }] });
      await expect(m.stop({ pid: 700, devctl: true })).rejects.toThrow("tb-devctl named this service oddly, so Lookout won't stop it.");
      expect(m.runner.mock.calls.some(([, args]) => args[0] === 'down')).toBe(false);
    }
  });

  it('PORTS-4.3: a slow ps widens a start\'s window instead of losing a stubborn process', async () => {
    const m = machine([...BASE, { pid: 710, ppid: 700, pgid: 700, comm: 'node', stubborn: true, age: 59 }], { psMs: 1900 });
    await expect(m.stop({ pid: 700 })).resolves.toEqual({ how: 'forced', count: 2 });
    expect(m.signals).toContainEqual(['SIGKILL', 710]);
  });

  it('PORTS-4.7: a start lies in a window from one sample; two samples of a process overlap', () => {
    const p = { pid: 1, ppid: 0, pgid: 1, uid: 0, stat: 'S', elapsedMs: 60_000, comm: 'node' };
    expect(startWindow(p, { from: 100_000, to: 101_900 })).toEqual([39_000, 41_900]);
    expect(distance(45_000, [39_000, 41_900])).toBe(3100);
    expect(distance(40_000, [39_000, 41_900])).toBe(0);
    expect(overlaps([39_000, 41_900], [41_000, 42_000])).toBe(true);
    expect(overlaps([39_000, 40_000], [41_000, 42_000])).toBe(false);
  });
});
