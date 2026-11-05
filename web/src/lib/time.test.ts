import { describe, expect, it } from 'vitest';
import { byDay, dayLabel } from '@/lib/time';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('day groups (LIB-2.1, HIST-2.12)', () => {
  it('LIB-2.1, HIST-2.12: a newest-first list in runs of one local day, "Today", "Yesterday", then the date; no time is "No date"', () => {
    const now = at(2026, 11, 5, 9);
    const rows = [at(2026, 11, 5, 8), at(2026, 11, 5, 1), at(2026, 11, 4, 23), at(2026, 11, 2), null];
    const runs = byDay(rows, (t) => t, now);
    expect(runs.map((r) => [r.label, r.rows.map((x) => x.index)])).toEqual([
      ['Today', [0, 1]],
      ['Yesterday', [2]],
      [dayLabel(at(2026, 11, 2), now), [3]],
      ['No date', [4]],
    ]);
    expect(dayLabel(at(2026, 11, 2), now)).toBe(new Date(2026, 10, 2).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
  });

  it('HIST-2.12: a run is keyed by its calendar day, so its rows stay mounted when "Today" turns into "Yesterday" at midnight or a newer row arrives above; a day seen twice gets its own key', () => {
    const rows = [at(2026, 11, 5, 8), at(2026, 11, 4)];
    const before = byDay(rows, (t) => t, at(2026, 11, 5, 23));
    const after = byDay([at(2026, 11, 6, 0), ...rows], (t) => t, at(2026, 11, 6, 0));
    expect(before.map((r) => [r.key, r.label])).toEqual([[new Date(2026, 10, 5).toDateString(), 'Today'], [new Date(2026, 10, 4).toDateString(), 'Yesterday']]);
    expect(after.map((r) => r.label)).toEqual(['Today', 'Yesterday', dayLabel(at(2026, 11, 4), at(2026, 11, 6, 0))]);
    expect(after.slice(1).map((r) => r.key)).toEqual(before.map((r) => r.key));
    const keys = byDay([at(2026, 11, 5), at(2026, 11, 4), at(2026, 11, 5)], (t) => t, at(2026, 11, 5)).map((r) => r.key);
    expect(new Set(keys).size).toBe(3);
  });
});
