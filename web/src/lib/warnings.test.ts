import { verdict, type VerdictKey } from '@shared/evidence.ts';
import { GB, MB } from '@shared/memory.ts';
import { FlaskConicalOff, TrendingUp } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { warningsOf } from './warnings';

describe("a Session's Warnings (SIDE-15)", () => {
  it('SIDE-15.1: the Warnings come most urgent first: memory running away ("Memory", TrendingUp), then work its Evidence doesn\'t back ("Tests", FlaskConicalOff); none without either', () => {
    const both = warningsOf({ memoryGrowthBytes: 2.8 * GB, evidence: verdict('changed') }, 'normal');
    expect(both.map((w) => [w.kind, w.word, w.icon])).toEqual([['memory', 'Memory', TrendingUp], ['evidence', 'Tests', FlaskConicalOff]]);
    expect(warningsOf({ memoryGrowthBytes: 2.8 * GB, evidence: null }, 'normal').map((w) => w.kind)).toEqual(['memory']);
    expect(warningsOf({ memoryGrowthBytes: null, evidence: verdict('failed') }, 'normal').map((w) => w.kind)).toEqual(['evidence']);
    expect(warningsOf({ memoryGrowthBytes: null, evidence: null }, 'normal')).toEqual([]);
    expect(warningsOf({ memoryGrowthBytes: null }, null)).toEqual([]);
  });

  it('SIDE-15.3: each Warning has its words: the growth in 10 minutes, and the Evidence verdict', () => {
    const texts = (row: Parameters<typeof warningsOf>[0]) => warningsOf(row, 'normal').map((w) => w.text);
    expect(texts({ memoryGrowthBytes: 2.8 * GB, evidence: verdict('changed') })).toEqual(['Memory +2.8 GB in 10 min', 'Changed after its last test run']);
    // EVID-3.4's "last readable" comes through as the verdict says it.
    expect(texts({ memoryGrowthBytes: null, evidence: verdict('failed', true) })).toEqual(['Its last readable test run failed']);
  });

  it('SIDE-15.5: a Warning is there exactly while its rule holds: memory by MEM-4.1\'s bar and the pressure, Evidence by a warning verdict alone', () => {
    const memory = (bytes: number | null, pressure: Parameters<typeof warningsOf>[1]) => warningsOf({ memoryGrowthBytes: bytes, evidence: null }, pressure).length;
    expect(memory(GB, 'normal')).toBe(1);
    expect(memory(GB - MB, 'normal')).toBe(0);
    // Under pressure 30 MB is enough; unknown pressure keeps the 1 GB bar.
    expect(memory(40 * MB, 'warn')).toBe(1);
    expect(memory(40 * MB, 'critical')).toBe(1);
    expect(memory(40 * MB, null)).toBe(0);
    expect(memory(20 * MB, 'critical')).toBe(0);
    const warns: VerdictKey[] = ['no-run', 'changed', 'failed', 'timed-out', 'stopped', 'no-tests', 'unread'];
    for (const key of warns) expect(warningsOf({ memoryGrowthBytes: null, evidence: verdict(key) }, 'normal').map((w) => w.word), key).toEqual(['Tests']);
    for (const key of ['passed', 'running'] as VerdictKey[]) expect(warningsOf({ memoryGrowthBytes: null, evidence: verdict(key) }, 'normal'), key).toEqual([]);
  });
});
