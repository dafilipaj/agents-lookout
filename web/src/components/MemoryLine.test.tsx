import { GB, MB, type MemorySnapshot } from '@shared/memory.ts';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import css from '@/index.css?raw';
import { NOW, renderApp, row, settings as appSettings } from '@/test/helpers';
import { type Mode, solid, contrast, paint, themeTokens } from '@/test/contrast';

const mr = (id: string, bytes: number, growthBytes: number | null = null) => ({ id, bytes, growthBytes, cpuPct: 0, top: [{ name: 'node', count: 2, bytes }] });
const sample = (over: Partial<MemorySnapshot> = {}): MemorySnapshot => ({
  sampledAt: NOW - 12_000, old: false, ramBytes: 24 * GB, pressure: 'normal', watchedBytes: 2.4 * GB, totalBytes: 12 * GB,
  lookout: mr('lookout', 96 * MB), sessions: [mr('a', 612 * MB, 180 * MB), mr('b', 400 * MB)], otherBytes: 9.6 * GB,
  trend: [], load: { one: 3.3, cores: 12 }, ...over,
});
const trigger = () => screen.getByRole('button', { name: 'Memory details' });
const details = () => screen.getByRole('dialog', { name: 'Memory details' });
function show(memory: MemorySnapshot | null = sample()) {
  const app = renderApp();
  app.snapshot([row({ id: 'a', title: 'First', memoryGrowthBytes: memory?.sessions.find((s) => s.id === 'a')?.growthBytes ?? null }), row({ id: 'b', title: 'Second', harness: 'codex', memoryGrowthBytes: memory?.sessions.find((s) => s.id === 'b')?.growthBytes ?? null })]);
  if (memory) app.emit({ type: 'memory', memory });
  return app;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

it('MEM-1.1: a sibling caption button below usage reads memory and load, with a CSS glyph and descriptive tooltip', () => {
  const app = show(null);
  expect(trigger()).toHaveTextContent('Reading memory…');
  app.emit({ type: 'memory', memory: sample() });
  expect(trigger()).toHaveTextContent('2.4 GB · load 3.3');
  expect(trigger()).toHaveClass('text-caption', 'h-7', 'items-center', 'border-t', 'border-sidebar-border/70');
  expect(trigger().title).toContain('2.4 GB watched of 24 GB, pressure normal, sampled 12 s ago');
  const glyph = trigger().querySelector('[data-field="memory-glyph"]')!;
  expect(glyph).toHaveClass('w-[3px]', 'h-3', 'rounded-full');
  const usage = screen.getByRole('button', { name: 'Usage details' });
  expect(usage.parentElement).toBe(trigger().parentElement);
  expect(usage.compareDocumentPosition(trigger()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  for (const mode of ['light', 'dark'] as Mode[]) {
    const tokens = themeTokens(css)[mode];
    const background = paint(tokens, 'muted', solid(tokens, 'sidebar'), .3);
    expect(contrast(paint(tokens, 'muted-foreground', background), background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(paint(tokens, 'sidebar-foreground', background), background)).toBeGreaterThanOrEqual(4.5);
  }
});

it('MEM-1.2: new samples update the line in a fixed-height dock slot, loading and stale included', () => {
  const app = show(null);
  const cls = trigger().className;
  app.emit({ type: 'memory', memory: sample() });
  app.emit({ type: 'memory', memory: sample({ watchedBytes: 812 * MB, old: true }) });
  expect(trigger()).toHaveTextContent('812 MB');
  expect(trigger().className).toBe(cls);
  expect(trigger()).toHaveClass('h-7', 'items-center', 'mt-auto', 'border-t', 'border-sidebar-border/70', 'bg-muted/30', 'whitespace-nowrap');
  expect(trigger()).not.toHaveClass('pb-1');
  expect(trigger().querySelector('[data-field="memory-glyph"]')).not.toHaveClass('mt-0.5');
  expect(screen.getByRole('button', { name: 'Usage details' })).toHaveClass('pt-1', 'pb-0.5');
  expect(document.querySelector('[data-dock-rest]')).toBeInTheDocument();
});

it('MEM-1.3: glyph transitions by token, with textual warning and critical descriptions and reduced motion', () => {
  const app = show();
  const glyph = () => trigger().querySelector('[data-field="memory-glyph"]')!;
  expect(glyph()).toHaveClass('bg-muted-foreground', 'transition-colors', 'duration-700', 'motion-reduce:transition-none');
  app.emit({ type: 'memory', memory: sample({ pressure: 'warn' }) });
  expect(glyph()).toHaveClass('bg-warning');
  expect(trigger()).toHaveAccessibleDescription(expect.stringContaining('memory warning'));
  expect(trigger().title).toContain('memory warning');
  app.emit({ type: 'memory', memory: sample({ pressure: 'critical' }) });
  expect(glyph()).toHaveClass('bg-destructive');
  expect(trigger()).toHaveAccessibleDescription(expect.stringContaining('memory critical'));
});

it('MEM-1.4: the line is the button description, including pressure, sample age and growing Session count', () => {
  show(sample({ sessions: [mr('a', 612 * MB, 180 * MB), mr('b', 400 * MB, 30 * MB)] }));
  expect(trigger()).toHaveAccessibleDescription('Memory: 2.4 GB watched of 24 GB, pressure normal, sampled 12 s ago, 2 Sessions growing');
});

it('MEM-3.1: click, Enter and Space open; Escape, outside and second click close; usage and memory are exclusive and watches follow', async () => {
  const app = show();
  const user = userEvent.setup();
  await user.click(trigger());
  expect(details()).toHaveAttribute('data-side', 'right');
  expect(details()).toHaveAttribute('data-align', 'end');
  expect(app.client.watchMemory).toHaveBeenLastCalledWith('tab-1', true);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: 'Memory details' })).not.toBeInTheDocument();
  expect(trigger()).toHaveFocus();
  expect(app.client.watchMemory).toHaveBeenLastCalledWith('tab-1', false);
  await user.keyboard('{Enter}');
  expect(details()).toBeVisible();
  await user.click(trigger());
  expect(screen.queryByRole('dialog', { name: 'Memory details' })).not.toBeInTheDocument();
  await user.keyboard(' ');
  expect(details()).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Usage details' }));
  expect(screen.queryByRole('dialog', { name: 'Memory details' })).not.toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Usage details' })).toBeVisible();
  await user.click(trigger());
  expect(details()).toBeVisible();
  expect(screen.queryByRole('dialog', { name: 'Usage details' })).not.toBeInTheDocument();
  app.emit({ type: 'snapshot', sessions: [], fleet: { state: 'ok' }, settings: appSettings(), launches: [], started: [], clientId: 'tab-2', usage: null, memory: sample() });
  expect(app.client.watchMemory).toHaveBeenLastCalledWith('tab-2', true);
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.queryByRole('dialog', { name: 'Memory details' })).not.toBeInTheDocument();
});

it('MEM-3.2: the header shows total, RAM, pressure icon and age, with info tone on a skipped sample', async () => {
  const app = show(sample({ pressure: 'warn' }));
  await userEvent.setup().click(trigger());
  expect(within(details()).getByText('2.4 GB')).toHaveClass('text-title', 'tabular-nums');
  expect(within(details()).getByText(/of 24 GB on this Mac/)).toBeInTheDocument();
  expect(within(details()).getByText('pressure warn')).toHaveClass('text-warning-text');
  expect(within(details()).getByRole('img', { name: 'warning' })).toBeInTheDocument();
  expect(within(details()).getByText('sampled 12s ago')).toBeInTheDocument();
  app.emit({ type: 'memory', memory: sample({ pressure: 'critical', old: true, sampledAt: NOW - 60_000 }) });
  expect(within(details()).getByText('pressure critical')).toHaveClass('text-destructive-text');
  expect(within(details()).getByRole('img', { name: 'critical' })).toBeInTheDocument();
  expect(within(details()).getByText('old · 1m')).toHaveClass('text-info-text');
});

it('MEM-3.3: collecting draws nothing, then a hidden sparkline and signed trend reading with a direction icon', async () => {
  const app = show();
  await userEvent.setup().click(trigger());
  expect(within(details()).getByText('collecting…')).toBeInTheDocument();
  expect(details().querySelector('[data-field="trend"] svg')).toBeNull();
  app.emit({ type: 'memory', memory: sample({ trend: [{ at: NOW - 30_000, bytes: GB }, { at: NOW, bytes: GB + 180 * MB }] }) });
  expect(within(details()).getByText('last 30 min')).toBeInTheDocument();
  expect(within(details()).getByText('+180 MB')).toBeInTheDocument();
  expect(details().querySelector('svg[data-field="sparkline"]')).toHaveAttribute('aria-hidden', 'true');
  app.emit({ type: 'memory', memory: sample({ trend: [{ at: NOW - 30_000, bytes: GB }, { at: NOW, bytes: GB - 40 * MB }] }) });
  expect(within(details()).getByText('−40 MB')).toBeInTheDocument();
});

it('MEM-3.4: a textured three-part split bar has a legend and explicitly puts this tab in other', async () => {
  show();
  await userEvent.setup().click(trigger());
  const slices = [...details().querySelectorAll<HTMLElement>('[data-field="split"] > span')];
  expect(slices).toHaveLength(3);
  expect(new Set(slices.map((el) => el.className)).size).toBe(3);
  expect(slices.reduce((sum, el) => sum + parseFloat(el.style.width), 0)).toBeCloseTo(100);
  expect(within(details()).getByText('this tab is in other')).toBeInTheDocument();
  expect(within(details()).getByText(/other 9.6 GB/)).toBeInTheDocument();
});

it('MEM-3.5: rows show biggest executables and warning growth chips, sort by size and freeze under the pointer, with gone at zero', async () => {
  const app = show();
  await userEvent.setup().click(trigger());
  const buttons = () => within(details()).getAllByRole('button');
  expect(buttons().map((b) => b.textContent)).toEqual([expect.stringContaining('First'), expect.stringContaining('Second')]);
  expect(within(buttons()[0]!).getByText('node ×2 612')).toHaveClass('text-caption');
  expect(within(buttons()[0]!).getByText('+180 MB in 10 min').closest('[data-slot="chip"]')).toHaveAttribute('data-tone', 'warning');
  expect(within(buttons()[0]!).getByText('+180 MB in 10 min').closest('[data-slot="chip"]')).toHaveClass('border-warning/40', 'text-warning-text');
  expect(within(buttons()[0]!).getByRole('img', { name: 'Claude Code' })).not.toHaveAttribute('data-brand');
  fireEvent.pointerEnter(details().lastElementChild!);
  app.emit({ type: 'memory', memory: sample({ sessions: [mr('b', 900 * MB), mr('a', 0)] }) });
  expect(buttons()[0]).toHaveTextContent('First');
  expect(buttons()[0]).toHaveTextContent('gone');
  expect(buttons()[0]).toHaveTextContent('0 B');
  fireEvent.pointerLeave(details().lastElementChild!);
  expect(buttons()[0]).toHaveTextContent('Second');
});

it('MEM-3.6: Session buttons select and close with focus restored, arrow keys move within rows, Lookout stays plain text', async () => {
  const app = show();
  const user = userEvent.setup();
  await user.click(trigger());
  const first = within(details()).getByRole('button', { name: 'Open First, 612 MB, growing +180 MB' });
  expect(within(details()).queryByRole('button', { name: /Lookout/ })).not.toBeInTheDocument();
  first.focus();
  await user.keyboard('{ArrowDown}');
  expect(within(details()).getByRole('button', { name: 'Open Second, 400 MB' })).toHaveFocus();
  await user.keyboard('{ArrowUp}');
  expect(first).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(window.location.pathname).toBe('/s/a');
  expect(screen.queryByRole('dialog', { name: 'Memory details' })).not.toBeInTheDocument();
  expect(trigger()).toHaveFocus();
  expect(app.client.launch).not.toHaveBeenCalled();
  expect(app.client.resume).not.toHaveBeenCalled();
  expect(app.client.sendMessage).not.toHaveBeenCalled();
});

it('MEM-3.7: Loading before a sample, and no live Sessions with the Lookout row retained', async () => {
  const app = show(null);
  await userEvent.setup().click(trigger());
  expect(within(details()).getByText('Reading memory…')).toBeInTheDocument();
  app.snapshot([]);
  app.emit({ type: 'memory', memory: sample({ sessions: [] }) });
  expect(within(details()).getByText('No live Sessions')).toHaveClass('text-meta', 'text-muted-foreground');
  expect(within(details()).getByRole('region', { name: 'Lookout memory' }).querySelector('.font-medium')).toBeInTheDocument();
});

it('MEM-4.1: growth precedes Subagents in the nonshrinking numbers group, names the amount and meets contrast on every row state', () => {
  const app = renderApp();
  app.snapshot([row({ id: 'a', title: 'First', memoryGrowthBytes: 180 * MB, subagents: { running: 2, finished: 0 } }), row({ id: 'b' })]);
  const option = screen.getByRole('option', { name: /First/ });
  expect(option).toHaveAccessibleName(expect.stringMatching(/memory growing, \+180 MB in 10 min.*2 Subagents/));
  const mark = option.querySelector<HTMLElement>('[data-field="memory-growth"]')!;
  expect(mark.title).toBe('Memory +180 MB in 10 min');
  expect(mark.parentElement).toHaveClass('shrink-0');
  expect(mark.querySelector('svg')).toHaveClass('size-2.5', 'text-warning-text');
  expect(mark.nextElementSibling).toHaveAttribute('data-field', 'subagents');
  expect(document.querySelector('[data-session-id="b"]')!.querySelector('[data-field="memory-growth"]')).toBeNull();
  // Same row surfaces SIDE-3.11 tests: rest, hover and selection, plain and Needs you.
  for (const mode of ['light', 'dark'] as Mode[]) {
    const tokens = themeTokens(css)[mode];
    const sidebar = solid(tokens, 'sidebar');
    const foreground = solid(tokens, 'warning-text');
    for (const background of [sidebar, paint(tokens, 'sidebar-accent', sidebar, .6), paint(tokens, 'sidebar-accent', sidebar), paint(tokens, 'needs-you', sidebar, .12), paint(tokens, 'needs-you', sidebar, .20), paint(tokens, 'needs-you', sidebar, .26)]) {
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it('MEM-4.2: server row updates carrying memory growth change only the mark and leave order, status, age and strip intact', () => {
  const app = renderApp();
  const original = row({ id: 'a', status: 'busy' });
  app.snapshot([original, row({ id: 'b' })]);
  const before = document.querySelector('[data-session-id="a"]')!;
  const strip = before.querySelector('[data-field="strip"]')!.className;
  const age = before.querySelector('[data-field="age"]')!.textContent;
  app.emit({ type: 'sessions', upsert: [{ ...original, memoryGrowthBytes: 30 * MB }], remove: [] });
  app.emit({ type: 'memory', memory: sample({ sessions: [mr('a', GB, 30 * MB)] }) });
  expect(before.querySelector('[data-field="memory-growth"]')).toBeInTheDocument();
  expect(before).toHaveAttribute('data-status', 'busy');
  expect(before.querySelector('[data-field="strip"]')!.className).toBe(strip);
  expect(before.querySelector('[data-field="age"]')!.textContent).toBe(age);
  app.emit({ type: 'sessions', upsert: [original], remove: [] });
  expect(before.querySelector('[data-field="memory-growth"]')).toBeNull();
  app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
  expect(before).not.toBeInTheDocument();
});

it('MEM-5.1: CPU from 10% is shown after size with the machine capacity in its tooltip', async () => {
  show(sample({ sessions: [{ ...mr('a', 612 * MB), cpuPct: 140 }, { ...mr('b', 400 * MB), cpuPct: 9.9 }] }));
  await userEvent.setup().click(trigger());
  expect(within(details()).getByText('cpu 140%')).toHaveAttribute('title', '140% of 1200%');
  expect(within(details()).queryByText('cpu 10%')).not.toBeInTheDocument();
});

it('MEM-5.2: load and cores in the header warn with a triangle or octagon, and the glyph takes the worse level', async () => {
  const app = show(sample({ load: { one: 12, cores: 12 } }));
  await userEvent.setup().click(trigger());
  expect(within(details()).getByText('load 12.0 · 12 cores')).toHaveClass('text-warning-text');
  expect(trigger().querySelector('[data-field="memory-glyph"]')).toHaveClass('bg-warning');
  app.emit({ type: 'memory', memory: sample({ load: { one: 24, cores: 12 } }) });
  expect(within(details()).getByText('load 24.0 · 12 cores')).toHaveClass('text-destructive-text');
  expect(within(details()).getByRole('img', { name: 'critical' })).toBeInTheDocument();
  expect(trigger().querySelector('[data-field="memory-glyph"]')).toHaveClass('bg-destructive');
});

it('MEM-5.3: the line rounds load to one decimal and substitutes the Pressure word only when abnormal', () => {
  const app = show(sample({ load: { one: 3.34, cores: 12 } }));
  expect(trigger()).toHaveTextContent('2.4 GB · load 3.3');
  app.emit({ type: 'memory', memory: sample({ pressure: 'warn' }) });
  expect(trigger()).toHaveTextContent('2.4 GB · pressure warn');
  expect(trigger()).not.toHaveTextContent('load');
});


it('MEM-1.4: the announced count follows current row marks when Fleet removes a growing Session between samples', async () => {
  const app = renderApp();
  app.snapshot([row({ id: 'a', title: 'Growing', memoryGrowthBytes: 30 * MB }), row({ id: 'b', title: 'Remaining' })]);
  app.emit({ type: 'memory', memory: sample({ sessions: [mr('a', GB, 30 * MB), mr('b', GB)] }) });
  expect(trigger()).toHaveAccessibleDescription(expect.stringContaining('1 Session growing'));
  await userEvent.setup().click(trigger());
  app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
  expect(screen.queryByRole('option', { name: /Growing/ })).not.toBeInTheDocument();
  expect(within(details()).queryByRole('button', { name: /Open Growing/ })).not.toBeInTheDocument();
  expect(trigger()).not.toHaveAccessibleDescription(expect.stringContaining('growing'));
  expect(trigger().title).not.toContain('growing');
  app.emit({ type: 'sessions', upsert: [row({ id: 'b', title: 'Remaining', memoryGrowthBytes: 30 * MB })], remove: [] });
  expect(trigger()).toHaveAccessibleDescription(expect.stringContaining('1 Session growing'));
});

it('MEM-3.3: the displayed delta and collecting state ignore points older than thirty minutes', async () => {
  const app = show(sample({ old: true, trend: [{ at: NOW - 3_600_000, bytes: GB }, { at: NOW - 30_000, bytes: 2 * GB }, { at: NOW, bytes: 2 * GB + 10 * MB }] }));
  await userEvent.setup().click(trigger());
  expect(within(details()).getByText('+10 MB')).toBeInTheDocument();
  app.emit({ type: 'memory', memory: sample({ old: true, trend: [{ at: NOW - 3_600_000, bytes: GB }, { at: NOW - 3_570_000, bytes: 2 * GB }] }) });
  expect(within(details()).getByText('collecting…')).toBeInTheDocument();
  expect(details().querySelector('[data-field="sparkline"]')).toBeNull();
});
