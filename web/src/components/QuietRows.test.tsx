import { GB, MB } from '@shared/memory.ts';
import type { SessionRow, Status } from '@shared/types.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, field, renderApp, row, rowEl } from '@/test/helpers';

const STATUSES: Status[] = ['needs-you', 'busy', 'idle', 'unknown'];
/** Text in a colour of its own: the diff's, a warning, an error, a Status's text shades. */
const COLOURED = /\btext-(?:diff-[a-z-]+|warning-text|destructive-text|busy-text|needs-you-text|idle-text|ok-text|primary(?:-text)?)\b/;
const coloured = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLElement>('*')].filter((e) => COLOURED.test(e.getAttribute('class') ?? '') && !e.closest('[data-field="strip"], [data-slot="session-marker"]'));
const columns = (id: string) => [...rowEl(id).querySelectorAll<HTMLElement>('[data-column]')];

/** A row with routine values only: changes, an age, context at 40%, memory growing under MEM-4.1's bar. */
const routine = (id: string, over: Partial<SessionRow> = {}) =>
  row({ id, changes: { additions: 2700, deletions: 392, files: 9 }, contextPct: 40, memoryGrowthBytes: 300 * MB, statusSince: NOW - 59 * 60_000, ...over });

describe('quiet rows, loud exceptions (DS-22)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => vi.useRealTimers());

  it('DS-22.1: the numbers sit in three fixed columns at the end of the second line, changes, time, context, each right-aligned in its width, empty without a value, never cut, in every Status', () => {
    const app = renderApp();
    app.snapshot([...STATUSES.map((status) => routine(status, { status, waitingFor: status === 'needs-you' ? 'input needed' : null })), row({ id: 'bare', changes: null, contextPct: null, statusSince: null })]);
    for (const id of [...STATUSES, 'bare']) {
      const cols = columns(id);
      expect(cols.map((c) => c.dataset.column), id).toEqual(['changes', 'age', 'context']);
      expect(cols[0]).toHaveClass('w-16', 'text-right');
      expect(cols[1]).toHaveClass('w-6.5', 'text-right');
      expect(cols[2]).toHaveClass('w-11', 'justify-end');
      for (const c of cols) expect(c).toHaveClass('shrink-0', 'min-w-fit', 'tabular-nums');
      expect(cols[2]).toBe(cols[0]!.parentElement!.lastElementChild);
    }
    expect(field('idle', 'changes')).toHaveTextContent('+2.7k−392');
    expect(field('idle', 'age')).toHaveTextContent('59m');
    expect(field('idle', 'context')).toHaveTextContent('40%');
    // No value, an empty column: the next value keeps its place.
    for (const c of columns('bare')) expect(c).toBeEmptyDOMElement();
  });

  it('DS-22.2: routine values are in the row\'s quiet colour: the changes grey on the row, context grey up to 40%', () => {
    const app = renderApp();
    app.snapshot([routine('a'), routine('hot', { contextPct: 41 })]);
    expect(field('a', 'changes')!.querySelectorAll('[class*="text-diff"]')).toHaveLength(0);
    expect(field('a', 'context')!.className).not.toMatch(COLOURED);
    expect(field('hot', 'context')).toHaveClass('text-warning-text');
  });

  it('DS-22.3: an exception leads the second line in its colour with an icon or words: memory running away, a queued job, Subagents running, a background shell, in that order, before the slot', () => {
    const app = renderApp();
    app.snapshot([
      routine('all', {
        memoryGrowthBytes: 2.8 * GB,
        queued: { tool: 'vitest', since: NOW - 180_000, position: 2 },
        subagents: { running: 2, finished: 0 },
        backgroundShell: true,
        git: { repo: 'work', worktree: 'crm-rates', branch: 'fix/rates', commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' },
      }),
    ]);
    const marks = field('all', 'marks')!;
    expect([...marks.children].map((c) => c.getAttribute('data-field'))).toEqual(['memory-growth', 'queued', 'subagents', 'background-shell']);
    expect(marks).toHaveClass('shrink-0', 'gap-1');
    expect(marks.previousElementSibling).toBeNull();
    expect(marks.nextElementSibling).toBe(field('all', 'slot'));
    expect(field('all', 'memory-growth')).toHaveClass('text-warning-text');
    expect(field('all', 'memory-growth')).toHaveTextContent('+2.8 GB');
    expect(field('all', 'queued')).toHaveTextContent('3m');
    expect(field('all', 'subagents')).toHaveClass('text-busy-text');
    expect(field('all', 'subagents')).toHaveTextContent('2');
    expect(field('all', 'background-shell')).toHaveClass('text-idle-text');
    // Each has its icon: colour is never alone.
    for (const f of ['memory-growth', 'queued', 'subagents', 'background-shell']) expect(field('all', f)!.querySelector('svg'), f).not.toBeNull();
    // The slot truncates first.
    expect(field('all', 'slot')).toHaveClass('min-w-0', 'flex-1');
    expect(field('all', 'location')).toHaveClass('truncate');
  });

  it('DS-22.4: a row with routine values only has no coloured text besides its Status\'s marker, strip and tag, in every Status; each exception on shows in its place and colour', () => {
    const app = renderApp();
    app.snapshot(['busy', 'idle', 'unknown'].map((status) => routine(status, { status: status as Status })));
    for (const id of ['busy', 'idle', 'unknown']) {
      expect(coloured(rowEl(id)), id).toEqual([]);
      expect(field(id, 'marks')).toBeNull();
    }
    // One exception at a time: it alone has colour, in the marks' place.
    app.snapshot([routine('mem', { memoryGrowthBytes: GB }), routine('sub', { subagents: { running: 1, finished: 0 } }), routine('ctx', { contextPct: 81 })]);
    expect(coloured(rowEl('mem')).map((e) => e.dataset.field)).toEqual(['memory-growth']);
    expect(coloured(rowEl('sub')).map((e) => e.dataset.field)).toEqual(['subagents']);
    expect(coloured(rowEl('ctx')).map((e) => e.dataset.field)).toEqual(['context']);
  });
});
