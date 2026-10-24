import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GB, MB, type MemorySnapshot } from '../shared/memory.ts';
import type { Runner } from './exec.ts';
import { MemoryMonitor, PS_ARGS, SYSCTL_ARGS, resolveMemoryBin } from './memory.ts';

const ps = readFileSync(new URL('./fixtures/memory/ps.txt', import.meta.url), 'utf8');
function setup(runner?: Runner) {
  const changed = vi.fn();
  const run = vi.fn<Runner>(runner ?? (async (file) => file.endsWith('ps') ? ps : `${24 * GB}\n1\n`));
  const monitor = new MemoryMonitor({ runner: run, sessions: () => [{ id: 's', pid: 200 }], pid: 100, totalmem: () => 8 * GB, load: () => ({ one: 3.3, cores: 12 }), onChange: changed });
  return { monitor, run, changed };
}
afterEach(() => vi.useRealTimers());

describe('memory sampler', () => {
  it('MEM-2.1: runs exactly one ps and sysctl through the runner with cleaned env, 2s timeout and cancellation', async () => {
    const { monitor, run } = setup();
    await monitor.tick();
    expect(run.mock.calls.map(([file, args]) => [file.split('/').pop(), args])).toEqual([['ps', PS_ARGS], ['sysctl', SYSCTL_ARGS]]);
    for (const [, , options] of run.mock.calls) {
      expect(options.timeoutMs).toBe(2000);
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.env).not.toHaveProperty('CLAUDECODE');
    }
    expect(resolveMemoryBin('ps', { PATH: '' })).toBe('/bin/ps');
    expect(resolveMemoryBin('sysctl', { PATH: '' })).toBe('/usr/sbin/sysctl');
    expect(monitor.snapshot()?.ramBytes).toBe(24 * GB);
    expect(monitor.snapshot()?.pressure).toBe('normal');
    await monitor.close();
  });

  it('MEM-2.3: shares one flight, schedules from start at 30s or 5s, throttles opens, and stops with the last tab', async () => {
    vi.useFakeTimers();
    const { monitor, run } = setup();
    expect(run).not.toHaveBeenCalled();
    const tab1 = monitor.watch();
    const tab2 = monitor.watch();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(2000);
    monitor.setOpen('one', true);
    monitor.setOpen('two', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(4999);
    expect(run).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(8);
    monitor.setOpen('one', false);
    monitor.drop('two');
    await vi.advanceTimersByTimeAsync(29_999);
    expect(run).toHaveBeenCalledTimes(8);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(10);
    tab1(); tab1(); tab2();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(10);
    await monitor.close();
  });

  it('MEM-2.3: slow reads never overlap, and close aborts the runner and awaits its exit', async () => {
    vi.useFakeTimers();
    const exits: (() => void)[] = [];
    let aborted = false;
    const { monitor, run, changed } = setup(async (_file, _args, opts) => new Promise<string>((_resolve, reject) => {
      opts.signal!.addEventListener('abort', () => { aborted = true; exits.push(() => reject(Object.assign(new Error('cancelled'), { aborted: true })));  });
    }));
    const unwatch = monitor.watch();
    expect(monitor.tick()).toBe(monitor.tick());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    let closed = false;
    const closing = monitor.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(aborted).toBe(true);
    expect(closed).toBe(false);
    expect(exits).toHaveLength(2);
    exits.forEach((exit) => exit());
    await closing;
    expect(closed).toBe(true);
    unwatch();
    expect(changed).not.toHaveBeenCalled();
  });

  it('MEM-2.6: ps failure preserves the last snapshot marked old; sysctl failure keeps RAM and normal Pressure', async () => {
    let psFails = false;
    let sysFails = false;
    const { monitor, changed } = setup(async (file) => {
      if (file.endsWith('ps')) {
        if (psFails) throw Object.assign(new Error('refused sk-secret123\nprivate output'), { stderr: 'Authorization: Bearer secret\nprivate output' });
        return ps;
      }
      if (sysFails) throw new Error('refused');
      return `${24 * GB}\n4\n`;
    });
    await monitor.tick();
    const good = monitor.snapshot()!;
    expect(good.pressure).toBe('critical');
    psFails = true;
    await monitor.tick();
    expect(monitor.snapshot()).toEqual({ ...good, old: true });
    expect(JSON.stringify(changed.mock.calls)).not.toMatch(/secret|private output|Authorization/);
    psFails = false; sysFails = true;
    await monitor.tick();
    expect(monitor.snapshot()).toMatchObject({ ramBytes: 24 * GB, pressure: 'normal', old: false });
    const fallback = setup(async (file) => { if (file.endsWith('ps')) return ps; throw new Error('no sysctl'); });
    await fallback.monitor.tick();
    expect(fallback.monitor.snapshot()?.ramBytes).toBe(8 * GB);
    await fallback.monitor.close();
    await monitor.close();
  });

  it('MEM-2.7: publishes changed values and trend points, never a sample whose only change is sampledAt', async () => {
    vi.useFakeTimers();
    const { monitor, changed } = setup();
    await monitor.tick();
    await vi.advanceTimersByTimeAsync(5000);
    await monitor.tick();
    expect(changed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(25_000);
    await monitor.tick();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(monitor.snapshot()?.trend).toHaveLength(2);
    expect(monitor.snapshot()?.load).toEqual({ one: 3.3, cores: 12 });
    await monitor.close();
  });

  it('MEM-4.2: growth is merged by process identity and expires without changing Session state', async () => {
    vi.useFakeTimers();
    let bytes = 100 * MB;
    let sessions = [{ id: 's', pid: 200 }];
    const snapshots: MemorySnapshot[] = [];
    const monitor = new MemoryMonitor({ runner: async (file) => file.endsWith('ps') ? `200 1 ${bytes / 1024} 0 claude` : `${24 * GB}\n1`, sessions: () => sessions, pid: 100, load: () => ({ one: 0, cores: 12 }), onChange: (s) => snapshots.push(s) });
    await monitor.tick();
    bytes += 30 * MB;
    await vi.advanceTimersByTimeAsync(30_000);
    await monitor.tick();
    expect(monitor.growthFor(sessions[0]!)).toBe(30 * MB);
    expect(monitor.growthFor({ id: 's', pid: 201 })).toBeNull();
    await vi.advanceTimersByTimeAsync(600_001);
    await monitor.tick();
    expect(monitor.growthFor(sessions[0]!)).toBeNull();
    sessions = [];
    monitor.prune();
    expect(monitor.growthFor({ id: 's', pid: 200 })).toBeNull();
    await monitor.close();
  });
});

it('MEM-2.3: opening within two seconds waits out the throttle and the faster cadence is counted from a slow read’s start', async () => {
  vi.useFakeTimers();
  const { monitor, run } = setup(async (file) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return file.endsWith('ps') ? ps : `${24 * GB}\n1`;
  });
  const release = monitor.watch();
  monitor.setOpen('first', true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(run).toHaveBeenCalledTimes(2);
  monitor.setOpen('second', true);
  await vi.advanceTimersByTimeAsync(999);
  expect(run).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(4999);
  expect(run).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(6);
  release();
  await vi.advanceTimersByTimeAsync(1000);
  await monitor.close();
});

it('MEM-2.6: unknown Pressure is normal, a first failed ps leaves Loading, and names reaching events are bounded basenames and redacted', async () => {
  let output = '100 1 2048 0 /private/home/Applications/Helper sk-secret123';
  let level = 2;
  let fail = true;
  const { monitor, changed } = setup(async (file) => {
    if (file.endsWith('ps')) {
      if (fail) throw Object.assign(new Error('refused'), { timedOut: true });
      return output;
    }
    return `${24 * GB}\n${level}`;
  });
  await monitor.tick();
  expect(monitor.snapshot()).toBeNull();
  expect(changed).not.toHaveBeenCalled();
  fail = false;
  await monitor.tick();
  expect(monitor.snapshot()?.pressure).toBe('warn');
  expect(monitor.snapshot()?.lookout.top[0]?.name).toBe('Helper sk-…');
  expect(JSON.stringify(changed.mock.calls)).not.toMatch(/secret123|private\/home/);
  level = 8;
  output = '100 1 3072 0 node\nbroken';
  await monitor.tick();
  expect(monitor.snapshot()).toMatchObject({ pressure: 'normal', watchedBytes: 3 * MB });
  await monitor.close();
});
