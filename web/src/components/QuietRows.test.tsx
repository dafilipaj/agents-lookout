import { verdict } from '@shared/evidence.ts';
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

  it('DS-22.1: the numbers sit in three fixed columns at the end of the second line, changes, time, context, each right-aligned in its width, empty without a value, never cut, in every Status; when the line is full the location goes whole, then each column gives back its spare room', () => {
    const app = renderApp();
    app.snapshot([...STATUSES.map((status) => routine(status, { status, waitingFor: status === 'needs-you' ? 'input needed' : null })), row({ id: 'bare', changes: null, contextPct: null, statusSince: null })]);
    for (const id of [...STATUSES, 'bare']) {
      const cols = columns(id);
      expect(cols.map((c) => c.dataset.column), id).toEqual(['changes', 'age', 'context']);
      expect(cols[0]).toHaveClass('w-16', 'text-right');
      expect(cols[1]).toHaveClass('w-6.5', 'text-right');
      expect(cols[2]).toHaveClass('w-11', 'justify-end');
      // Never cut: a column can't be narrower than its value. It may give back the rest (`shrink`), which
      // it does only once the slot, whose own size is nothing, has no room left.
      for (const c of cols) {
        expect(c).toHaveClass('shrink', 'min-w-fit', 'tabular-nums');
        expect(c).not.toHaveClass('shrink-0');
      }
      const slot = field(id, 'slot')!;
      expect(slot).toHaveClass('min-w-0', 'flex-1', 'overflow-hidden', '@container');
      // What it holds goes whole when the slot has no room for it, never as a piece.
      for (const c of slot.children) expect(c).toHaveClass('@max-[46px]:hidden');
      // The gap before the first column is the slot's own, so it goes with the slot.
      expect(slot).toHaveClass('-mr-1.5', 'gap-1', 'after:w-0.5', 'after:shrink-0');
      expect(slot.nextElementSibling).toBe(cols[0]);
      expect(slot.parentElement).toHaveClass('gap-1.5');
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

  it('DS-22.3: an exception has its colour and an icon or words, in one of two places: what is running leads the second line (a queued job, Subagents, a background shell, in that order, 8 px apart, before the slot), and what is wrong is the one warning Chip after the title, never on the second line', () => {
    const app = renderApp();
    app.snapshot([
      routine('all', {
        memoryGrowthBytes: 2.8 * GB,
        queued: { tool: 'vitest', since: NOW - 180_000, position: 2 },
        subagents: { running: 2, finished: 0 },
        backgroundShell: true,
        evidence: verdict('changed'),
        git: { repo: 'work', worktree: 'crm-rates', branch: 'fix/rates', commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' },
      }),
    ]);
    // What is running: the second line's lead.
    const marks = field('all', 'marks')!;
    expect([...marks.children].map((c) => c.getAttribute('data-field'))).toEqual(['queued', 'subagents', 'background-shell']);
    expect(marks).toHaveClass('shrink-0', 'gap-2');
    expect(marks.previousElementSibling).toBeNull();
    expect(marks.nextElementSibling).toBe(field('all', 'slot'));
    expect(field('all', 'queued')).toHaveTextContent(/^$/); // RES-3.1: its Hourglass alone, with all three on the row
    expect(field('all', 'queued')).toHaveAccessibleName('Queued in res: vitest, waiting 3m, #2 in the queue');
    expect(field('all', 'subagents')).toHaveClass('text-busy-text');
    expect(field('all', 'subagents')).toHaveTextContent('2');
    expect(field('all', 'background-shell')).toHaveClass('text-idle-text');
    // What is wrong: one warning Chip on the first line, after the title; memory first, Evidence in its "+1".
    const chip = field('all', 'warnings')!;
    expect(chip).toHaveAttribute('data-slot', 'chip');
    expect(chip).toHaveAttribute('data-tone', 'warning');
    expect(chip).toHaveClass('text-warning-text');
    expect(chip).toHaveTextContent(/^Memory\+1$/);
    expect(chip.previousElementSibling).toBe(field('all', 'title')!.parentElement);
    expect(rowEl('all').querySelectorAll('[data-tone="warning"]')).toHaveLength(1);
    // Never on the second line.
    const second = marks.parentElement!;
    expect(second.contains(chip)).toBe(false);
    expect(second.querySelector('[data-slot="chip"], svg.lucide-trending-up, svg.lucide-flask-conical-off, [data-field="memory-growth"], [data-field="evidence"]')).toBeNull();
    expect(second).not.toHaveTextContent('GB');
    // Each has its icon: colour is never alone.
    for (const f of ['queued', 'subagents', 'background-shell', 'warnings']) expect(field('all', f)!.querySelector('svg'), f).not.toBeNull();
    // The slot truncates first.
    expect(field('all', 'slot')).toHaveClass('min-w-0', 'flex-1');
    expect(field('all', 'location')).toHaveClass('truncate');
  });

  it('DS-22.4: a row with routine values only has no coloured text besides its Status\'s marker, strip and tag, and no chip, in every Status; each exception on shows in its place and colour: what is running at the second line\'s lead, a Warning in the first line\'s chip and nowhere on the second line', () => {
    const app = renderApp();
    app.snapshot(['busy', 'idle', 'unknown'].map((status) => routine(status, { status: status as Status })));
    for (const id of ['busy', 'idle', 'unknown']) {
      expect(coloured(rowEl(id)), id).toEqual([]);
      expect(field(id, 'marks')).toBeNull();
      expect(rowEl(id).querySelector('[data-slot="chip"]'), id).toBeNull();
    }
    // One exception at a time: it alone has colour, in its place.
    app.snapshot([
      routine('mem', { memoryGrowthBytes: GB }),
      routine('queue', { queued: { tool: 'vitest', since: NOW - 180_000, position: 1 } }),
      routine('sub', { subagents: { running: 1, finished: 0 } }),
      routine('shell', { backgroundShell: true }),
      routine('ctx', { contextPct: 81 }),
      routine('evid', { evidence: verdict('no-run') }),
      routine('ok', { evidence: verdict('passed') }),
    ]);
    const secondLine = (id: string) => field(id, 'slot')!.parentElement!;
    // A Warning: the first line's chip, the second line as it is without it.
    for (const id of ['mem', 'evid']) {
      expect(coloured(rowEl(id)).map((e) => e.dataset.field), id).toEqual(['warnings']);
      expect(field(id, 'warnings')!.parentElement, id).toBe(field(id, 'title')!.parentElement!.parentElement);
      expect(field(id, 'marks'), id).toBeNull();
      expect(coloured(secondLine(id)), id).toEqual([]);
      expect(secondLine(id).firstElementChild, id).toBe(field(id, 'slot'));
    }
    expect(field('mem', 'warnings')).toHaveTextContent(/^Memory$/);
    expect(field('evid', 'warnings')).toHaveTextContent(/^Tests$/);
    // EVID-5.6: a backed row stays quiet.
    expect(coloured(rowEl('ok'))).toEqual([]);
    expect(rowEl('ok').querySelector('[data-slot="chip"]')).toBeNull();
    // What is running: at the second line's lead, and no chip.
    for (const [id, mark] of [['queue', 'queued'], ['sub', 'subagents'], ['shell', 'background-shell']] as const) {
      expect(secondLine(id).firstElementChild, id).toBe(field(id, 'marks'));
      expect([...field(id, 'marks')!.children].map((c) => c.getAttribute('data-field')), id).toEqual([mark]);
      expect(rowEl(id).querySelector('[data-slot="chip"]'), id).toBeNull();
    }
    expect(coloured(rowEl('queue'))).toEqual([]); // a queued job is in the row's grey, with its Hourglass
    expect(field('queue', 'queued')!.querySelector('svg')).not.toBeNull();
    expect(coloured(rowEl('sub')).map((e) => e.dataset.field)).toEqual(['subagents']);
    expect(coloured(rowEl('shell')).map((e) => e.dataset.field)).toEqual(['background-shell']);
    expect(coloured(rowEl('ctx')).map((e) => e.dataset.field)).toEqual(['context']);
    // The columns keep their order and widths in every Status (DS-22.1 measures them one by one).
    app.snapshot(STATUSES.map((status) => routine(status, { status, waitingFor: status === 'needs-you' ? 'input needed' : null, memoryGrowthBytes: GB })));
    for (const id of STATUSES) {
      expect(columns(id).map((c) => c.dataset.column), id).toEqual(['changes', 'age', 'context']);
      expect(columns(id).map((c) => [...c.classList].find((k) => /^w-/.test(k))), id).toEqual(['w-16', 'w-6.5', 'w-11']);
    }
  });
});
