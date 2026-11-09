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
  const total = () => trigger().querySelector('[data-field="memory-total"]')!;
  expect(total()).not.toHaveClass('text-warning-text', 'text-destructive-text');
  app.emit({ type: 'memory', memory: sample({ pressure: 'warn' }) });
  expect(glyph()).toHaveClass('bg-warning');
  // The total takes the level's colour too: a 3 px glyph alone is easy to miss.
  expect(total()).toHaveClass('text-warning-text');
  expect(trigger()).toHaveAccessibleDescription(expect.stringContaining('memory warning'));
  expect(trigger().title).toContain('memory warning');
  app.emit({ type: 'memory', memory: sample({ pressure: 'critical' }) });
  expect(glyph()).toHaveClass('bg-destructive');
  expect(total()).toHaveClass('text-destructive-text');
  expect(trigger()).toHaveAccessibleDescription(expect.stringContaining('memory critical'));
});

it('MEM-1.4: the line is the button description, including pressure, sample age and growing Session count', () => {
  // MEM-4.1's mark: 1 GB in 10 minutes under normal pressure; 180 MB isn't counted.
  show(sample({ sessions: [mr('a', 612 * MB, 1.2 * GB), mr('b', 400 * MB, GB), mr('c', 300 * MB, 180 * MB)] }));
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

it('MEM-3.2: a verdict at the memory line\'s level with the sample\'s age, then three tiles whose Pressure and load take their levels', async () => {
  const app = show(sample({ pressure: 'warn' }));
  await userEvent.setup().click(trigger());
  const verdict = details().querySelector<HTMLElement>('[data-field="verdict"]')!;
  expect(verdict).toHaveTextContent('The Mac is getting busy');
  expect(verdict.querySelector('.rounded-full')).toHaveClass('bg-warning');
  expect(within(verdict).getByText('12s ago')).toHaveClass('text-muted-foreground');
  const tile = (name: string) => details().querySelector<HTMLElement>(`[data-field="tile-${name}"]`)!;
  expect(tile('memory')).toHaveTextContent(/^Memory2\.4 GB/);
  expect(within(tile('pressure')).getByText('warn')).toHaveClass('text-warning-text', 'tabular-nums', 'font-medium');
  expect(within(tile('pressure')).getByRole('img', { name: 'warning' })).toBeInTheDocument();
  expect(tile('pressure')).toHaveTextContent('macOS');
  expect(tile('load')).toHaveTextContent('CPU load3.3of 12 cores');
  expect(tile('load').querySelector('.font-medium')).not.toHaveClass('text-warning-text');
  app.emit({ type: 'memory', memory: sample({ pressure: 'critical', old: true, sampledAt: NOW - 60_000 }) });
  expect(verdict).toHaveTextContent('The Mac is overloaded');
  expect(within(tile('pressure')).getByText('critical')).toHaveClass('text-destructive-text');
  expect(within(verdict).getByText('stale · 1m')).toHaveClass('text-info-text');
  app.emit({ type: 'memory', memory: sample() });
  expect(verdict).toHaveTextContent('The Mac has room');
});

it('MEM-3.3: the Memory tile reads collecting, then the signed change over 30 minutes with a direction icon, and draws no sparkline', async () => {
  const app = show();
  await userEvent.setup().click(trigger());
  const trend = () => details().querySelector<HTMLElement>('[data-field="trend"]')!;
  expect(trend()).toHaveTextContent('collecting…');
  app.emit({ type: 'memory', memory: sample({ trend: [{ at: NOW - 30_000, bytes: GB }, { at: NOW, bytes: GB + 180 * MB }] }) });
  expect(trend()).toHaveTextContent('+180 MB in 30m');
  expect(trend().querySelector('svg')).toHaveClass('lucide-trending-up');
  app.emit({ type: 'memory', memory: sample({ trend: [{ at: NOW - 30_000, bytes: GB }, { at: NOW, bytes: GB - 40 * MB }] }) });
  expect(trend()).toHaveTextContent('−40 MB in 30m');
  expect(trend().querySelector('svg')).toHaveClass('lucide-trending-down');
  expect(details().querySelector('[data-field="sparkline"]')).toBeNull();
});

it('MEM-3.4: one list holds the Sessions, Lookout and Other apps, on one scale of every process\'s memory, told apart by lightness', async () => {
  show();
  await userEvent.setup().click(trigger());
  const list = screen.getByRole('region', { name: 'Who uses it' });
  expect(list).toHaveTextContent('12 GB of 24 GB in use');
  const rows = [...list.querySelectorAll<HTMLElement>('[data-row]')];
  expect(rows.map((r) => r.dataset.row)).toEqual(['a', 'b', 'lookout', 'other']);
  const bar = (r: HTMLElement) => r.querySelector<HTMLElement>('[aria-hidden] > span')!;
  expect(rows.map((r) => bar(r).className.match(/bg-foreground\/\d+/)?.[0])).toEqual(['bg-foreground/55', 'bg-foreground/55', 'bg-foreground/30', 'bg-foreground/15']);
  // 612 MB of 12 GB is 5%; Lookout's 96 MB is under 2%, so it shows at 2%; other apps 9.6 GB is 80%.
  expect(parseFloat(bar(rows[0]!).style.width)).toBeCloseTo((612 * MB) / (12 * GB) * 100);
  expect(bar(rows[2]!).style.width).toBe('2%');
  expect(parseFloat(bar(rows[3]!).style.width)).toBeCloseTo(80);
  expect(rows[3]!.closest('li')).toHaveAttribute('title', 'Every other process on this Mac, this tab too');
  expect(rows[3]).toHaveTextContent('Other apps9.6 GB');
});

it('MEM-3.5: rows carry growth and Queued marks after the name, executables in the tooltip, sort by size and freeze under the pointer, with gone at zero', async () => {
  const app = renderApp();
  app.snapshot([row({ id: 'a', title: 'First', memoryGrowthBytes: 180 * MB, queued: { tool: 'vitest', since: NOW - 120_000, position: 1 } }), row({ id: 'b', title: 'Second', harness: 'codex' })]);
  app.emit({ type: 'memory', memory: sample() });
  await userEvent.setup().click(trigger());
  const buttons = () => within(screen.getByRole('region', { name: 'Who uses it' })).getAllByRole('button');
  expect(buttons().map((b) => b.textContent)).toEqual([expect.stringContaining('First'), expect.stringContaining('Second')]);
  const first = buttons()[0]!.querySelector<HTMLElement>('[data-row]')!;
  expect(first).toHaveAttribute('title', 'node ×2 612');
  // Growing, not running away (MEM-4.1): grey, no icon.
  expect(first.querySelector('[data-field="growth"]')).toHaveTextContent('+180 MB');
  expect(first.querySelector('[data-field="growth"]')).toHaveClass('text-muted-foreground');
  expect(first.querySelector('[data-field="growth"] svg')).toBeNull();
  expect(first.querySelector('[data-field="queued"]')).toHaveTextContent('2m');
  expect(within(buttons()[0]!).getByRole('img', { name: 'Claude Code' })).not.toHaveAttribute('data-brand');
  const root = screen.getByRole('dialog', { name: 'Memory details' }).querySelector<HTMLElement>('.divide-y')!;
  fireEvent.pointerEnter(root);
  app.emit({ type: 'memory', memory: sample({ sessions: [mr('b', 900 * MB), mr('a', 0)] }) });
  expect(buttons()[0]).toHaveTextContent('First');
  expect(buttons()[0]).toHaveTextContent('gone');
  expect(buttons()[0]).toHaveTextContent('0 B');
  fireEvent.pointerLeave(root);
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

it('MEM-3.7: Loading before a sample, and no live Sessions with the Lookout and Other apps rows kept', async () => {
  const app = show(null);
  await userEvent.setup().click(trigger());
  expect(within(details()).getByText('Reading memory…')).toBeInTheDocument();
  app.snapshot([]);
  app.emit({ type: 'memory', memory: sample({ sessions: [] }) });
  expect(within(details()).getByText('No live Sessions')).toHaveClass('text-meta', 'text-muted-foreground');
  expect([...details().querySelectorAll<HTMLElement>('[data-row]')].map((r) => r.dataset.row)).toEqual(['lookout', 'other']);
});

it('MEM-3.9: Worth a look lists growing rows and waiting res jobs, and is gone when nothing needs an eye', async () => {
  const app = show();
  await userEvent.setup().click(trigger());
  const box = () => screen.queryByRole('region', { name: 'Worth a look' });
  expect(box()).toHaveTextContent('First grew +180 MB in 10 min');
  expect(box()!.querySelector('svg')).toHaveClass('lucide-trending-up', 'text-warning-text');
  expect(box()).toHaveClass('border-border', 'bg-muted/40');
  const job = (id: string, waitedMs: number) => ({ id, pid: 1, kind: 'run' as const, state: 'waiting' as const, prio: 'check', cls: 'vitest@x', cores: 1, mb: 100, since: null, waitingSince: NOW - waitedMs, queuedAt: NOW - waitedMs, session: null, sessionId: null, position: 1 });
  app.emit({ type: 'res', res: { jobs: [job('w1', 60_000), job('w2', 180_000)], readAt: NOW, error: null } });
  expect(box()).toHaveTextContent('2 jobs waiting in res, the longest 3m');
  app.emit({ type: 'res', res: { jobs: [job('w1', 60_000)], readAt: NOW, error: null } });
  expect(box()).toHaveTextContent('1 job waiting in res for 1m');
  app.emit({ type: 'res', res: null });
  app.emit({ type: 'memory', memory: sample({ sessions: [mr('a', 612 * MB), mr('b', 400 * MB)] }) });
  expect(box()).toBeNull();
});

it('MEM-3.9: Worth a look keeps one note per growing row when Sessions share a title and reorder', async () => {
  const app = renderApp();
  app.snapshot([row({ id: 'a', title: 'Same' }), row({ id: 'b', title: 'Same' }), row({ id: 'c', title: 'Other' })]);
  app.emit({ type: 'memory', memory: sample({ sessions: [mr('a', 700 * MB, 100 * MB), mr('b', 600 * MB, 90 * MB), mr('c', 500 * MB, 80 * MB)] }) });
  await userEvent.setup().click(trigger());
  const notes = () => screen.getByRole('region', { name: 'Worth a look' }).querySelectorAll('svg.lucide-trending-up');
  expect(notes()).toHaveLength(3);
  app.emit({ type: 'memory', memory: sample({ sessions: [mr('c', 900 * MB, 300 * MB), mr('a', 700 * MB, 100 * MB), mr('b', 600 * MB, 90 * MB)] }) });
  expect(notes()).toHaveLength(3);
  expect(screen.getByRole('region', { name: 'Worth a look' })).toHaveTextContent('Other grew +300 MB in 10 min');
});

it('MEM-4.1: memory running away (1 GB in 10 min, or 30 MB under warn or critical pressure) leads the second line before the Subagents, names the amount and meets contrast on every row state', () => {
  const app = renderApp();
  app.snapshot([row({ id: 'a', title: 'First', memoryGrowthBytes: 2.8 * GB, subagents: { running: 2, finished: 0 } }), row({ id: 'b', memoryGrowthBytes: 180 * MB }), row({ id: 'c', memoryGrowthBytes: 40 * MB })]);
  const option = screen.getByRole('option', { name: /First/ });
  expect(option).toHaveAccessibleName(expect.stringMatching(/memory growing, \+2\.8 GB in 10 min.*2 Subagents/));
  const mark = option.querySelector<HTMLElement>('[data-field="memory-growth"]')!;
  expect(mark.title).toBe('Memory +2.8 GB in 10 min');
  expect(mark).toHaveTextContent('+2.8 GB');
  expect(mark).toHaveClass('text-warning-text');
  expect(mark.parentElement).toHaveClass('shrink-0');
  expect(mark.parentElement).toHaveAttribute('data-field', 'marks');
  expect(mark.querySelector('svg')).toHaveClass('size-2.5');
  expect(mark.previousElementSibling).toBeNull();
  expect(mark.nextElementSibling).toHaveAttribute('data-field', 'subagents');
  // Growing, but under the bar while pressure is normal (or unknown): nothing on the row.
  expect(document.querySelector('[data-session-id="b"]')!.querySelector('[data-field="memory-growth"]')).toBeNull();
  // Under pressure, 30 MB is enough.
  app.emit({ type: 'memory', memory: sample({ pressure: 'warn' }) });
  expect(document.querySelector('[data-session-id="b"]')!.querySelector('[data-field="memory-growth"]')).toHaveTextContent('+180 MB');
  expect(document.querySelector('[data-session-id="c"]')!.querySelector('[data-field="memory-growth"]')).toHaveTextContent('+40 MB');
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
  app.emit({ type: 'sessions', upsert: [{ ...original, memoryGrowthBytes: GB }], remove: [] });
  app.emit({ type: 'memory', memory: sample({ sessions: [mr('a', 2 * GB, GB)] }) });
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

it('MEM-5.2: the CPU load tile warns with a triangle or octagon, and the glyph takes the worse level', async () => {
  const app = show(sample({ load: { one: 12, cores: 12 } }));
  await userEvent.setup().click(trigger());
  const load = () => details().querySelector<HTMLElement>('[data-field="tile-load"]')!;
  expect(within(load()).getByText('12.0')).toHaveClass('text-warning-text');
  expect(load()).toHaveTextContent('of 12 cores');
  expect(trigger().querySelector('[data-field="memory-glyph"]')).toHaveClass('bg-warning');
  app.emit({ type: 'memory', memory: sample({ load: { one: 24, cores: 12 } }) });
  expect(within(load()).getByText('24.0')).toHaveClass('text-destructive-text');
  expect(within(load()).getByRole('img', { name: 'critical' })).toBeInTheDocument();
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
  app.snapshot([row({ id: 'a', title: 'Growing', memoryGrowthBytes: GB }), row({ id: 'b', title: 'Remaining' })]);
  app.emit({ type: 'memory', memory: sample({ sessions: [mr('a', GB, GB), mr('b', GB)] }) });
  expect(trigger()).toHaveAccessibleDescription(expect.stringContaining('1 Session growing'));
  await userEvent.setup().click(trigger());
  app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
  expect(screen.queryByRole('option', { name: /Growing/ })).not.toBeInTheDocument();
  expect(within(details()).queryByRole('button', { name: /Open Growing/ })).not.toBeInTheDocument();
  expect(trigger()).not.toHaveAccessibleDescription(expect.stringContaining('growing'));
  expect(trigger().title).not.toContain('growing');
  app.emit({ type: 'sessions', upsert: [row({ id: 'b', title: 'Remaining', memoryGrowthBytes: GB })], remove: [] });
  expect(trigger()).toHaveAccessibleDescription(expect.stringContaining('1 Session growing'));
});

it('MEM-3.3: the displayed delta and collecting state ignore points older than thirty minutes', async () => {
  const app = show(sample({ old: true, trend: [{ at: NOW - 3_600_000, bytes: GB }, { at: NOW - 30_000, bytes: 2 * GB }, { at: NOW, bytes: 2 * GB + 10 * MB }] }));
  await userEvent.setup().click(trigger());
  expect(details().querySelector('[data-field="trend"]')).toHaveTextContent('+10 MB in 30m');
  app.emit({ type: 'memory', memory: sample({ old: true, trend: [{ at: NOW - 3_600_000, bytes: GB }, { at: NOW - 3_570_000, bytes: 2 * GB }] }) });
  expect(details().querySelector('[data-field="trend"]')).toHaveTextContent('collecting…');
});

it("MEM-3.10: a tile's last line wraps rather than being cut short, the tiles' tops aligned, and a line that fits looks as before", async () => {
  show(sample({ trend: [{ at: NOW - 30_000, bytes: GB }, { at: NOW, bytes: GB + 7.2 * GB }] }));
  await userEvent.setup().click(trigger());
  const tile = (name: string) => details().querySelector<HTMLElement>(`[data-field="tile-${name}"]`)!;
  const last = tile('memory').children[2]!;
  expect(last).toHaveTextContent('+7.2 GB in 30m');
  expect(last).not.toHaveClass('truncate');
  expect(last).toHaveClass('break-words', 'text-caption', 'text-muted-foreground');
  // On a second line the icon stays by the first: the trend's items start at the top, the icon 2 px down, as centring on one 16 px line put it.
  const trend = tile('memory').querySelector<HTMLElement>('[data-field="trend"]')!;
  expect(trend).toHaveClass('inline-flex', 'items-start', 'gap-0.5');
  expect(trend.querySelector('svg')).toHaveClass('mt-0.5', 'size-3', 'shrink-0');
  // The grid stretches each tile to the row, so the tops line up whoever wraps.
  const grid = tile('memory').parentElement!;
  expect(grid).toHaveClass('grid', 'grid-cols-3');
  expect([...grid.classList].filter((c) => /^(items|content|self)-/.test(c))).toEqual([]);
  expect(tile('load').children[2]).toHaveTextContent('of 12 cores');
});

it("DS-19.1: Memory's breakdown is drawn from ui/details.tsx's pieces and keeps its elements and classes", async () => {
  const app = show(sample({ pressure: 'warn' }));
  app.emit({ type: 'res', res: { readAt: NOW, error: null, jobs: [] } });
  await userEvent.setup().click(trigger());
  const verdict = details().querySelector<HTMLElement>('[data-field="verdict"]')!;
  expect(verdict.className).toBe('flex items-center justify-between gap-2');
  expect(verdict.firstElementChild!.className).toBe('flex min-w-0 items-center gap-1.5 font-medium');
  expect(within(verdict).getByText('12s ago').className).toBe('shrink-0 text-caption tabular-nums text-muted-foreground');
  const pressure = details().querySelector<HTMLElement>('[data-field="tile-pressure"]')!;
  expect(pressure.className).toBe('min-w-0 rounded-md bg-muted/60 px-2 py-1.5');
  expect(pressure.parentElement!.className).toBe('grid grid-cols-3 gap-1.5');
  expect(pressure.children[1]!.className).toBe('flex items-center gap-1 font-medium whitespace-nowrap tabular-nums text-warning-text');
  expect(within(details()).getByRole('region', { name: 'Worth a look' }).className).toBe('flex flex-col gap-1 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-meta');
  const label = within(screen.getByRole('region', { name: 'Who uses it' })).getByRole('heading', { level: 3 });
  expect(label.className).toBe('flex justify-between gap-2 text-caption font-medium tracking-wide text-muted-foreground items-baseline mb-1.5');
  expect(within(label).getByText('Who uses it').className).toBe('uppercase');
  expect(within(screen.getByRole('region', { name: 'res queue' })).getByRole('heading', { level: 3 })).toHaveClass('text-caption', 'font-medium', 'tracking-wide', 'text-muted-foreground', 'mb-1.5');
  const row = details().querySelector<HTMLElement>('[data-row="a"]')!;
  expect(row.className).toBe('min-w-0 py-1.5');
  expect(row.firstElementChild!.className).toBe('flex min-w-0 items-center gap-1.5');
  expect(row.querySelector('[aria-hidden].block')!.className).toBe('mt-1 block h-1 overflow-hidden rounded-full bg-foreground/10');
  expect(row.querySelector('[aria-hidden].block > span')!.className).toBe('block h-full rounded-full bg-foreground/55');
});
