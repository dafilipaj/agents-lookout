import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MB, GB, MemoryHistory, buildOwners, formatBytes, loadLevel, memoryLevel, parseProcesses, splitWidths, trendShape } from '../shared/memory.ts';

const fixture = readFileSync(new URL('./fixtures/memory/ps.txt', import.meta.url), 'utf8');
const roots = [{ id: 'outer', pid: 200 }, { id: 'inner', pid: 300 }, { id: 'gone', pid: 500 }];

describe('memory accounting', () => {
  it('MEM-2.1: parses RSS as bytes, CPU and executable basenames, skipping malformed lines', () => {
    const rows = parseProcesses(fixture);
    expect(rows).toHaveLength(10);
    expect(rows.find((p) => p.pid === 200)).toEqual({ pid: 200, ppid: 100, bytes: 456 * MB, cpuPct: 97.5, name: 'claude' });
    expect(rows.find((p) => p.pid === 400)?.name).toBe('Google Chrome Helper (Renderer)');
    expect(parseProcesses('2 1 -10 1 node\n3 1 12 NaN node\n4 1 0 0 /bin/sh')).toHaveLength(1);
  });

  it('MEM-2.2: Sessions own their nested trees, including View only roots, and every process is counted once', () => {
    const owners = buildOwners(parseProcesses(fixture), 100, roots);
    expect(owners.lookout.bytes).toBe(63 * MB);
    expect(owners.sessions.map((r) => [r.id, r.bytes])).toEqual([['outer', 766.5 * MB], ['inner', 408 * MB], ['gone', 0]]);
    expect(owners.sessions[0]?.top).toEqual([
      { name: 'claude', count: 1, bytes: 456 * MB },
      { name: 'vitest', count: 1, bytes: 214 * MB },
      { name: 'node', count: 1, bytes: 96 * MB },
    ]);
    expect(owners.otherBytes).toBe(224 * MB);
    expect(owners.watchedBytes + owners.otherBytes).toBe(owners.totalBytes);
    const grouped = buildOwners(parseProcesses('1 0 2048 0 node\n2 1 3072 0 /bin/node\n3 2 512 0 sh'), 1, []);
    expect(grouped.lookout.top).toEqual([{ name: 'node', count: 2, bytes: 5 * MB }]);
    // A corrupt parent cycle can't double count or hang, nor can a missing root own an orphan.
    expect(buildOwners(parseProcesses('1 2 1024 0 node\n2 1 1024 0 node'), 1, []).watchedBytes).toBe(2 * MB);
    expect(buildOwners(parseProcesses('2 99 1024 0 node'), 1, [{ id: 'missing', pid: 99 }]).otherBytes).toBe(MB);
  });

  it('MEM-2.4: keeps 60 trend points at least 30 seconds apart, empty on restart', () => {
    const history = new MemoryHistory();
    expect(history.trend).toEqual([]);
    for (let at = 0; at <= 1_805_000; at += 5000) history.record(at, at, []);
    expect(history.trend).toHaveLength(60);
    expect(history.trend[0]?.at).toBe(30_000);
    expect(history.trend.at(-1)?.at).toBe(1_800_000);
    expect(new MemoryHistory().trend).toEqual([]);
  });

  it('MEM-2.5: compares each process generation with its oldest sample in ten minutes and drops vanished rows', () => {
    const history = new MemoryHistory();
    const record = (at: number, bytes: number, pid = 200) => history.record(at, bytes, [{ id: 's', pid, bytes }]).get('s');
    expect(record(0, 100 * MB)).toBeNull();
    expect(record(5000, 129 * MB)).toBeNull();
    expect(record(30_000, 130 * MB)).toBe(30 * MB);
    expect(record(605_001, 130 * MB)).toBeNull();
    expect(record(610_000, 300 * MB, 201)).toBeNull();
    history.record(615_000, 0, []);
    expect(record(620_000, 500 * MB, 201)).toBeNull();
    expect(new MemoryHistory().record(0, 600 * MB, [{ id: 's', pid: 201, bytes: 600 * MB }]).get('s')).toBeNull();
  });

  it('MEM-1.1: formats whole MB below a GB and one decimal from a GB, with zero in bytes', () => {
    expect([0, 812 * MB, GB, 2.4 * GB].map(formatBytes)).toEqual(['0 B', '812 MB', '1.0 GB', '2.4 GB']);
  });

  it('MEM-1.3: thirds of RAM and Pressure set the memory level at their inclusive thresholds', () => {
    expect(memoryLevel(GB - 1, 3 * GB, 'normal')).toBe('normal');
    expect(memoryLevel(GB, 3 * GB, 'normal')).toBe('warning');
    expect(memoryLevel(2 * GB, 3 * GB, 'normal')).toBe('critical');
    expect(memoryLevel(0, 3 * GB, 'warn')).toBe('warning');
    expect(memoryLevel(0, 3 * GB, 'critical')).toBe('critical');
    expect(memoryLevel(2 * GB, 3 * GB, 'warn')).toBe('critical');
  });

  it('MEM-3.3: the trend spans 30 minutes and at least 50 MB, including flat and falling lines', () => {
    expect(trendShape([{ at: 0, bytes: GB }])).toBeNull();
    const shape = trendShape([{ at: 0, bytes: GB }, { at: 30_000, bytes: GB + MB }])!;
    expect(shape.span).toBe(50 * MB);
    expect(shape.points[1]![0]).toBeCloseTo(100 / 60);
    expect(shape.points[1]![1]).toBeCloseTo(49);
    expect(trendShape([{ at: 0, bytes: GB }, { at: 1_800_000, bytes: 0 }])?.span).toBe(GB);
  });

  it('MEM-3.4: nonzero slices get at least 2% and all slices still sum to 100%', () => {
    expect(splitWidths([1, 1, 998])).toEqual([2, 2, 96]);
    expect(splitWidths([0, 10, 90])).toEqual([0, 10, 90]);
    expect(splitWidths([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('MEM-5.1: CPU is summed through each owned tree', () => {
    const owners = buildOwners(parseProcesses(fixture), 100, roots);
    expect(owners.sessions[0]?.cpuPct).toBe(140);
    expect(owners.sessions[1]?.cpuPct).toBe(10);
  });

  it('MEM-5.2: load warns from one per core and is critical from two', () => {
    expect([11.9, 12, 23.9, 24].map((one) => loadLevel({ one, cores: 12 }))).toEqual(['normal', 'warning', 'warning', 'critical']);
  });
});

it('MEM-2.4: recording after a disconnect gap expires old points even below the 60-point cap', () => {
  const history = new MemoryHistory();
  history.record(0, GB, []);
  history.record(30_000, GB + MB, []);
  history.record(3_600_000, 2 * GB, []);
  expect(history.trend).toEqual([{ at: 3_600_000, bytes: 2 * GB }]);
  history.record(3_630_000, 2 * GB + MB, []);
  expect(history.trend).toHaveLength(2);
  const sparse = new MemoryHistory();
  sparse.record(0, GB, []);
  sparse.record(1_790_000, 2 * GB, []);
  sparse.record(1_800_001, 2 * GB, []);
  expect(sparse.trend).toEqual([{ at: 1_790_000, bytes: 2 * GB }]);
});

it('MEM-3.3: expired trend points affect neither the chart coordinates nor its delta after a gap', () => {
  const points = [{ at: 0, bytes: GB }, { at: 3_570_000, bytes: 2 * GB }, { at: 3_600_000, bytes: 2 * GB + 10 * MB }];
  const shape = trendShape(points)!;
  expect(shape.points).toHaveLength(2);
  expect(shape.points.every(([x]) => x! >= 0 && x! <= 100)).toBe(true);
  expect(shape).toHaveProperty('delta', 10 * MB);
});

it('MEM-3.4: redistributing a tiny slice keeps boundary slices at the 2% minimum', () => {
  expect(splitWidths([2, 1, 97])).toEqual([2, 2, 96]);
  expect(splitWidths([97, 1, 2])).toEqual([96, 2, 2]);
  expect(splitWidths([2.01, 1, 96.99])).toEqual([2, 2, 96]);
});
