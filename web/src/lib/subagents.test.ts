import { describe, expect, it } from 'vitest';
import type { SubagentItem } from '@shared/types.ts';
import { formatRun, moreSubagents, subagentKind, subagentLabel, subagentLines, subagentTime, subagentTitle } from './subagents';

const item = (id: string, o: Partial<SubagentItem> = {}): SubagentItem => ({
  id,
  parent: null,
  depth: 1,
  state: 'running',
  task: `Task ${id}`,
  type: 'general-purpose',
  name: null,
  role: null,
  model: 'claude-opus-5-5',
  startedAt: null,
  endedAt: null,
  activity: null,
  ...o,
});
const at = (s: number) => new Date(Date.UTC(2026, 10, 2, 10, 0, s)).toISOString();
const shape = (items: SubagentItem[]) => subagentLines(items).map((l) => [l.item.id, l.indent, l.from]);

describe('the Subagents list', () => {
  it('VIEW-8.6: running ones oldest first, then finished ones latest end first; no time sorts last, then by id', () => {
    const items = [
      item('done-early', { state: 'completed', startedAt: at(0), endedAt: at(10) }),
      item('run-late', { startedAt: at(30) }),
      item('run-none-b'),
      item('done-late', { state: 'failed', startedAt: at(0), endedAt: at(40) }),
      item('run-early', { startedAt: at(5) }),
      item('run-none-a'),
      item('done-none', { state: 'stopped' }),
    ];
    expect(subagentLines(items).map((l) => l.item.id)).toEqual(['run-early', 'run-late', 'run-none-a', 'run-none-b', 'done-late', 'done-early', 'done-none']);
  });

  it('VIEW-8.6: a nested one follows the one that started it in its group, indented; across groups it keeps its place and says where it came from', () => {
    const items = [
      item('a', { startedAt: at(0) }),
      item('b', { startedAt: at(10) }),
      item('a1', { parent: 'a', depth: 2, startedAt: at(20) }),
      item('a1x', { parent: 'a1', depth: 3, startedAt: at(25) }),
      item('a2', { parent: 'a', depth: 2, startedAt: at(30) }),
      // Its parent finished: it stays among the running, by its own start.
      item('c1', { parent: 'c', depth: 2, startedAt: at(5) }),
      item('c', { state: 'completed', task: 'Review the diff', startedAt: at(0), endedAt: at(8) }),
      // Its parent isn't listed: indented, but nothing to name.
      item('orphan', { parent: 'gone', depth: 2, state: 'completed', startedAt: at(0), endedAt: at(2) }),
    ];
    expect(shape(items)).toEqual([
      ['a', 0, null],
      ['a1', 1, null],
      ['a1x', 2, null],
      ['a2', 1, null],
      ['c1', 1, 'Review the diff'],
      ['b', 0, null],
      ['c', 0, null],
      ['orphan', 1, null],
    ]);
  });

  it('VIEW-8.6: a loop of parents, a self-parent and a depth past four still list each one once', () => {
    const items = [item('x', { parent: 'y', startedAt: at(1) }), item('y', { parent: 'x', startedAt: at(2) }), item('s', { parent: 's', depth: 9, startedAt: at(3) })];
    const lines = subagentLines(items);
    expect(lines.map((l) => l.item.id).sort()).toEqual(['s', 'x', 'y']);
    expect(lines.find((l) => l.item.id === 's')!.indent).toBe(4);
  });

  it('VIEW-8.6: "and n more" counts what the counts have and the list does not', () => {
    expect(moreSubagents({ running: 18, finished: 7, items: Array.from({ length: 20 }, (_, i) => item(String(i))) })).toBe(5);
    expect(moreSubagents({ running: 1, finished: 1, items: [item('a'), item('b')] })).toBe(0);
    expect(moreSubagents({ running: 2, finished: 0 })).toBe(2);
  });

  it('VIEW-8.7, 8.9: the title falls back to the type, the nickname, then "Subagent"; the kind is the type, or the nickname and role', () => {
    expect(subagentTitle(item('a'))).toBe('Task a');
    expect(subagentTitle(item('a', { task: null }))).toBe('general-purpose');
    expect(subagentTitle(item('a', { task: null, type: null, name: 'Bohr' }))).toBe('Bohr');
    expect(subagentTitle(item('a', { task: null, type: null }))).toBe('Subagent');
    expect(subagentKind(item('a'))).toBe('general-purpose');
    expect(subagentKind(item('a', { type: null, name: 'Bohr', role: 'reviewer' }))).toBe('Bohr · reviewer');
    expect(subagentKind(item('a', { type: null, name: 'Bohr' }))).toBe('Bohr');
    expect(subagentKind(item('a', { type: null }))).toBeNull();
  });

  it('VIEW-8.7, 8.8, 8.9: a running one counts to now, a finished one to its end; no start, no time', () => {
    expect([0, 12_400, 192_000, 3_840_000].map(formatRun)).toEqual(['0s', '12s', '3m 12s', '1h 4m']);
    const now = Date.parse(at(0)) + 192_000;
    expect(subagentTime(item('a', { startedAt: at(0) }), now)).toBe('3m 12s');
    expect(subagentTime(item('a', { state: 'completed', startedAt: at(0), endedAt: at(45) }), now)).toBe('45s');
    expect(subagentTime(item('a', { state: 'completed', startedAt: at(0) }), now)).toBeNull();
    expect(subagentTime(item('a'), now)).toBeNull();
    expect(subagentLabel(item('a', { startedAt: at(0) }), now)).toBe('Task a, running for 3m 12s');
    expect(subagentLabel(item('a', { state: 'failed', startedAt: at(0), endedAt: at(45) }), now)).toBe('Task a, failed after 45s');
    expect(subagentLabel(item('a', { state: 'stopped' }), now)).toBe('Task a, stopped');
  });
});
