import { verdict } from '@shared/evidence.ts';
import { GB } from '@shared/memory.ts';
import type { SessionRow } from '@shared/types.ts';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionItem } from '@/components/SessionItem';
import { NOW, field, renderApp, row, rowEl, settings, visibleTitles } from '@/test/helpers';

const HIDDEN = { repo: false, where: false };
const chip = (id: string) => field(id, 'warnings');

/** One row by itself, with what the App would hand it: Unread, a ready Handover, a name's suffix. */
function item(r: SessionRow, props: Partial<Parameters<typeof SessionItem>[0]> = {}) {
  return render(
    <ul role="listbox" aria-label="Sessions">
      <SessionItem row={r} selected={false} dimmed={false} now={NOW} onSelect={() => {}} {...props} />
    </ul>,
  );
}

describe("one chip for what's wrong (SIDE-15)", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => vi.useRealTimers());

  it("SIDE-15.1: a Session with a Warning shows one warning Chip on its first line, after the title and the name's suffix and before the Done tick, the Unread dot, the Handover icon and the Harness mark, with the most urgent Warning's 12 px icon and word; none without a Warning", () => {
    item(row({ id: 'a', evidence: verdict('changed'), done: { at: NOW - 60_000, note: null }, viewedAt: NOW - 120_000, locationShown: HIDDEN }), {
      suffix: { kind: 'worktree', text: 'lantern', tip: 'Worktree lantern' },
      unread: true,
      handoverReady: true,
    });
    const c = chip('a')!;
    expect(c).toHaveAttribute('data-slot', 'chip');
    expect(c).toHaveAttribute('data-tone', 'warning');
    expect(c).toHaveClass('shrink-0', 'text-warning-text', 'border-warning/40');
    expect(c).toHaveTextContent(/^Tests$/);
    expect(c.querySelector('svg')).toHaveClass('lucide-flask-conical-off', 'size-3');
    expect(c.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    // The first line, in order: the marker, the name (title, then suffix), the chip, the end icons.
    const first = c.parentElement!;
    const name = field('a', 'title')!.parentElement!;
    expect([...name.children].map((e) => e.getAttribute('data-field'))).toEqual(['title', 'name-suffix']);
    expect([...first.children].slice(1)).toEqual([name, c, field('a', 'end-icons')]);
    expect([...field('a', 'end-icons')!.children].map((e) => e.getAttribute('data-field'))).toEqual(['done', 'unread', 'handover-ready', 'harness']);
    // The title gives way to it, never the chip.
    expect(name).toHaveClass('min-w-0', 'flex-1');
    expect(field('a', 'title')).toHaveClass('truncate');
  });

  it('SIDE-15.1: memory running away is the most urgent, its icon TrendingUp and its word "Memory"; a Session with no Warning has no chip, and its row is as it was', () => {
    const app = renderApp();
    app.snapshot([
      row({ id: 'mem', memoryGrowthBytes: 2.8 * GB, locationShown: HIDDEN }),
      row({ id: 'quiet', memoryGrowthBytes: null, evidence: verdict('passed'), done: { at: NOW - 60_000, note: null }, locationShown: HIDDEN }),
    ]);
    expect(chip('mem')).toHaveTextContent(/^Memory$/);
    expect(chip('mem')!.querySelector('svg')).toHaveClass('lucide-trending-up', 'size-3');
    expect(chip('mem')).toHaveAttribute('data-kind', 'memory');
    expect(chip('quiet')).toBeNull();
    expect(rowEl('quiet').querySelectorAll('[data-tone="warning"]')).toHaveLength(0);
    // Without a Warning Done is its chip, with its word.
    expect(field('quiet', 'done')).toHaveAttribute('data-slot', 'chip');
    expect(field('quiet', 'done')).toHaveTextContent('Done');
    expect(rowEl('quiet')).toHaveAccessibleName('IdlequietDoneClaude Code 1m');
  });

  it('SIDE-15.2: with more than one Warning the chip shows the most urgent one\'s icon and word, then "+1", the number of the others; a row never has a second warning chip', () => {
    const app = renderApp();
    app.snapshot([row({ id: 'both', memoryGrowthBytes: 2.8 * GB, evidence: verdict('failed') }), row({ id: 'one', evidence: verdict('failed') })]);
    expect(chip('both')).toHaveTextContent(/^Memory\+1$/);
    expect(field('both', 'warnings-more')).toHaveTextContent(/^\+1$/);
    expect(chip('both')!.querySelectorAll('svg')).toHaveLength(1);
    expect(chip('both')!.querySelector('svg')).toHaveClass('lucide-trending-up');
    expect(rowEl('both').querySelectorAll('[data-field="warnings"]')).toHaveLength(1);
    expect(rowEl('both').querySelectorAll('[data-tone="warning"]')).toHaveLength(1);
    // One Warning: no count.
    expect(chip('one')).toHaveTextContent(/^Tests$/);
    expect(field('one', 'warnings-more')).toBeNull();
  });

  it("SIDE-15.3: the chip's tooltip says every Warning in words, the most urgent first, one per line, and the row's accessible name says those words where the chip is, in place of its word and \"+1\"", () => {
    const app = renderApp();
    app.snapshot([
      row({ id: 'both', memoryGrowthBytes: 2.8 * GB, evidence: verdict('changed'), locationShown: HIDDEN }),
      row({ id: 'one', evidence: verdict('changed'), locationShown: HIDDEN }),
    ]);
    expect(chip('both')).toHaveAttribute('title', 'Memory +2.8 GB in 10 min\nChanged after its last test run');
    expect(chip('one')).toHaveAttribute('title', 'Changed after its last test run');
    // The chip is one image for a screen reader, named by its Warnings' words.
    expect(within(rowEl('both')).getByRole('img', { name: 'Memory +2.8 GB in 10 min, Changed after its last test run' })).toBe(chip('both'));
    expect(rowEl('both')).toHaveAccessibleName('IdlebothMemory +2.8 GB in 10 min, Changed after its last test runClaude Code 1m');
    expect(rowEl('one')).toHaveAccessibleName('IdleoneChanged after its last test runClaude Code 1m');
    expect(screen.getByRole('option', { name: /Memory \+2\.8 GB in 10 min/ })).toBe(rowEl('both'));
  });

  it("SIDE-15.4: no Warning shows on the second line: its lead holds only what is running (a queued job, the Subagent count, a background shell), 8 px apart; the first line's end icons are 6 px apart", () => {
    item(
      row({
        id: 'a', memoryGrowthBytes: 2.8 * GB, evidence: verdict('changed'), done: { at: NOW - 60_000, note: null },
        queued: { tool: 'vitest', since: NOW - 180_000, position: 2 }, subagents: { running: 2, finished: 0 }, backgroundShell: true,
      }),
      { unread: true, handoverReady: true },
    );
    const marks = field('a', 'marks')!;
    expect([...marks.children].map((e) => e.getAttribute('data-field'))).toEqual(['queued', 'subagents', 'background-shell']);
    expect(marks).toHaveClass('gap-2');
    const second = marks.parentElement!;
    expect(second.firstElementChild).toBe(marks);
    expect(second.querySelector('[data-slot="chip"], [data-tone="warning"], svg.lucide-trending-up, svg.lucide-flask-conical-off')).toBeNull();
    expect(second).not.toHaveTextContent(/GB|Memory|Tests/);
    const end = field('a', 'end-icons')!;
    expect([...end.children].map((e) => e.getAttribute('data-field'))).toEqual(['done', 'unread', 'handover-ready', 'harness']);
    expect(end).toHaveClass('shrink-0', 'gap-1.5');
    // Warnings alone leave the second line's lead to the slot.
    item(row({ id: 'b', memoryGrowthBytes: 2.8 * GB, evidence: verdict('changed') }));
    expect(field('b', 'marks')).toBeNull();
    expect(field('b', 'slot')!.previousElementSibling).toBeNull();
  });

  it("SIDE-15.5: the chip follows its Warnings (it shows, changes its word and \"+1\", and goes) and changes nothing else about the row: Status, marker, strip, age, order or dimming; a View only row shows it too", () => {
    const app = renderApp();
    const old = NOW - 5 * 3_600_000;
    const busy = row({ id: 'busy', status: 'busy', statusSince: NOW - 120_000 });
    const idle = row({ id: 'idle', statusSince: NOW - 60_000 });
    const stale = row({ id: 'stale', statusSince: old });
    const other = row({ id: 'other', backend: 'unknown', controllable: false, evidence: verdict('no-run') });
    app.snapshot([busy, idle, stale, other], { state: 'ok' }, settings({ idleThresholdHours: 4 }));
    const order = visibleTitles();
    const pinned = (id: string) => ({
      el: rowEl(id),
      status: rowEl(id).getAttribute('data-status'),
      marker: rowEl(id).querySelector('[data-session-marker]')!.outerHTML,
      strip: field(id, 'strip')!.className,
      age: field(id, 'age')!.textContent,
      dimmed: rowEl(id).getAttribute('data-dimmed'),
      classes: rowEl(id).className,
    });
    const before = { busy: pinned('busy'), idle: pinned('idle'), stale: pinned('stale') };
    expect(before.stale.dimmed).toBe('true');
    for (const id of ['busy', 'idle', 'stale']) expect(chip(id)).toBeNull();
    const same = () => {
      expect(visibleTitles()).toEqual(order);
      for (const [id, was] of Object.entries(before)) expect(pinned(id), id).toEqual(was);
    };
    // It shows.
    app.emit({ type: 'sessions', upsert: [{ ...busy, evidence: verdict('changed') }, { ...stale, evidence: verdict('failed') }], remove: [] });
    expect(chip('busy')).toHaveTextContent(/^Tests$/);
    expect(chip('stale')).toHaveTextContent(/^Tests$/);
    same();
    // A more urgent Warning takes its word; the other counts.
    app.emit({ type: 'sessions', upsert: [{ ...busy, evidence: verdict('changed'), memoryGrowthBytes: 2 * GB }], remove: [] });
    expect(chip('busy')).toHaveTextContent(/^Memory\+1$/);
    same();
    // One goes, then the other.
    app.emit({ type: 'sessions', upsert: [{ ...busy, evidence: verdict('passed'), memoryGrowthBytes: 2 * GB }], remove: [] });
    expect(chip('busy')).toHaveTextContent(/^Memory$/);
    app.emit({ type: 'sessions', upsert: [busy, stale], remove: [] });
    expect(chip('busy')).toBeNull();
    expect(chip('stale')).toBeNull();
    same();
    // View only: the same chip.
    expect(within(screen.getByRole('group', { name: 'View only' })).getByRole('option')).toBe(rowEl('other'));
    expect(chip('other')).toHaveTextContent(/^Tests$/);
    expect(chip('other')).toHaveClass('text-warning-text');
    expect(chip('other')!.className).not.toMatch(/opacity|grayscale/);
  });

  it("SIDE-15.6: the chip's text is the colour the contrast check measures on the row (warning-text on the row's own background), nothing fading or filling it, on a plain and a Needs you row", () => {
    const app = renderApp('/s/sel');
    app.snapshot([
      row({ id: 'plain', evidence: verdict('changed') }),
      row({ id: 'sel', memoryGrowthBytes: 2 * GB, evidence: verdict('changed') }),
      row({ id: 'asks', status: 'needs-you', waitingFor: 'input needed', memoryGrowthBytes: 2 * GB }),
    ]);
    const sidebar = screen.getByRole('complementary', { name: 'Session sidebar' });
    for (const id of ['plain', 'sel', 'asks']) {
      const c = chip(id)!;
      const own = (el: Element) => [...el.classList].filter((k) => /^(?:[\w-]+:)*(?:text-(?!caption$)|bg-|opacity-)/.test(k));
      expect(own(c), id).toEqual(['text-warning-text']);
      // Nothing inside paints over it, and nothing between it and the sidebar fades it.
      expect([...c.querySelectorAll('*')].flatMap(own), id).toEqual([]);
      for (let e = c.parentElement; e && e !== sidebar; e = e.parentElement) expect([...e.classList].filter((k) => k.startsWith('opacity-')), id).toEqual([]);
    }
  });
});
