import { GB, MB, type MemorySnapshot } from '@shared/memory.ts';
import type { LocalServer } from '@shared/ports.ts';
import type { ResJob, ResSnapshot } from '@shared/res.ts';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NOW, field, renderApp, row } from '@/test/helpers';

const job = (over: Partial<ResJob> & { id: string }): ResJob => ({
  pid: 300, kind: 'run', state: 'waiting', prio: 'check', cls: 'vitest@agents-lookout', cores: 3, mb: 2600,
  since: null, waitingSince: NOW - 120_000, queuedAt: NOW - 120_000, session: null, sessionId: null, position: null, ...over,
});
const queue = (jobs: ResJob[], over: Partial<ResSnapshot> = {}): ResSnapshot => ({ jobs, readAt: NOW, error: null, ...over });
const memory: MemorySnapshot = {
  sampledAt: NOW, old: false, ramBytes: 24 * GB, pressure: 'normal', watchedBytes: 2.4 * GB, totalBytes: 12 * GB,
  lookout: { id: 'lookout', bytes: 96 * MB, growthBytes: null, cpuPct: 0, top: [] }, sessions: [], otherBytes: 9.6 * GB, trend: [], load: { one: 3.3, cores: 12 },
};
const trigger = () => screen.getByRole('button', { name: 'Memory details' });

function show(res: ResSnapshot | null, rows = [row({ id: 'a', title: 'Rates fix' }), row({ id: 'b', title: 'Lookout RES' })]) {
  const app = renderApp();
  app.snapshot(rows);
  app.emit({ type: 'memory', memory });
  app.emit({ type: 'res', res });
  return app;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

it('RES-2.1: the Memory line shows the jobs waiting in res, with an Hourglass, and says so in its description', () => {
  const app = show(queue([job({ id: 'h', state: 'holding', since: NOW - 60_000 }), job({ id: 'w1', position: 1 }), job({ id: 'w2', position: 2 })]));
  const count = trigger().querySelector('[data-field="res-waiting"]')!;
  expect(count).toHaveTextContent('2');
  expect(count.querySelector('svg')).toHaveClass('lucide-hourglass');
  expect(trigger().title).toMatch(/, 2 waiting in res$/);
  app.emit({ type: 'res', res: queue([job({ id: 'h', state: 'holding' })]) });
  expect(trigger().querySelector('[data-field="res-waiting"]')).toBeNull();
  expect(trigger().title).not.toContain('waiting in res');
});

it('RES-2.2: the Memory details end with one line per job, its Session a button, the details in its tooltip', async () => {
  vi.useRealTimers();
  const user = userEvent.setup();
  show(queue([
    job({ id: 'h', state: 'holding', since: Date.now() - 60_000, sessionId: 'b', prio: 'live', cores: 2.5, mb: 1800 }),
    job({ id: 'w1', position: 1, sessionId: 'a', cls: 'tsc@fantastic', cores: 1.5, mb: 3000, waitingSince: Date.now() - 125_000 }),
    job({ id: 'w2', position: 2, sessionId: null, waitingSince: Date.now() - 5_000 }),
  ]));
  await user.click(trigger());
  const section = screen.getByRole('region', { name: 'res queue' });
  expect(section.parentElement!.lastElementChild).toBe(section);
  expect([...section.querySelectorAll('[data-job]')].map((e) => e.getAttribute('data-job'))).toEqual(['h', 'w1', 'w2']);
  const running = section.querySelector<HTMLElement>('[data-job="h"]')!;
  expect(running).toHaveTextContent('runningvitest·Lookout RES1.8 GB · 1m');
  expect(running.title).toBe('vitest@agents-lookout · live · 2.5 cores, 1.8 GB');
  const first = section.querySelector<HTMLElement>('[data-job="w1"]')!;
  expect(first).toHaveTextContent('#1 waitstsc·Rates fix2.9 GB · 2m');
  expect(first.title).toBe('tsc@fantastic · check · needs 1.5 cores, 2.9 GB');
  expect(section.querySelector('[data-job="w2"]')).toHaveTextContent('No Session');
  await user.click(within(first).getByRole('button', { name: 'Open Rates fix, waiting for tsc' }));
  expect(window.location.pathname).toBe('/s/a');
});

it('RES-2.2: an empty queue says so, and a failed read says why and from when the list is', async () => {
  vi.useRealTimers();
  const user = userEvent.setup();
  const app = show(queue([]));
  await user.click(trigger());
  expect(screen.getByRole('region', { name: 'res queue' })).toHaveTextContent('Nothing running or waiting.');
  app.emit({ type: 'res', res: queue([job({ id: 'h', state: 'holding' })], { error: 'res status timed out', readAt: Date.UTC(2026, 9, 16, 11, 58) }) });
  expect(screen.getByRole('region', { name: 'res queue' })).toHaveTextContent(/Couldn't read res: res status timed out\. Showing the list from \d{1,2}:58/);
});

it('RES-2.3: without res, no count and no Queue section', async () => {
  vi.useRealTimers();
  const user = userEvent.setup();
  show(null);
  expect(trigger().querySelector('[data-field="res-waiting"]')).toBeNull();
  await user.click(trigger());
  expect(screen.queryByRole('region', { name: 'res queue' })).toBeNull();
});

it('RES-3.1: a Queued Session\'s row shows the Hourglass and its wait before the Subagent count, its Status unchanged', () => {
  show(null, [
    row({ id: 'a', status: 'busy', queued: { tool: 'vitest', since: NOW - 180_000, position: 2 }, subagents: { running: 1, finished: 0 } }),
    row({ id: 'b', status: 'busy' }),
  ]);
  const mark = field('a', 'queued')!;
  expect(mark).toHaveTextContent('3m');
  expect(mark.title).toBe('Queued in res: vitest, waiting 3m, #2 in the queue');
  expect(mark).toHaveAccessibleName('Queued in res: vitest, waiting 3m, #2 in the queue');
  expect(mark.compareDocumentPosition(field('a', 'subagents')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(field('b', 'queued')).toBeNull();
});

it('RES-3.2: the status line says Queued with the tool and the wait, before the Local servers chip', () => {
  const app = show(null, [row({ id: 'a', status: 'busy', queued: { tool: 'vitest', since: NOW - 120_000, position: 1 } })]);
  const vite: LocalServer = {
    pid: 400, command: 'node', ports: [5173], name: 'vite', cwd: '/w/a', dir: 'a', repo: null, startedAt: NOW - 60_000,
    sessionId: 'a', by: 'cwd', url: 'http://localhost:5173', devctl: false, lookout: false, shown: true,
  };
  app.emit({ type: 'ports', ports: { servers: [vite], readAt: NOW, error: null } });
  act(() => window.history.pushState(null, '', '/s/a'));
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  const line = screen.getByRole('group', { name: 'Status line' });
  const part = line.querySelector<HTMLElement>('[data-field="queued"]')!;
  expect(part).toHaveTextContent('Queued: vitest · 2m');
  expect(part.title).toBe('Queued in res: vitest, waiting 2m, #1 in the queue');
  expect(line.title).toContain('Queued: vitest · 2m');
  const servers = line.querySelector<HTMLElement>('[data-field="servers"]')!;
  expect(part.compareDocumentPosition(servers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  app.snapshot([row({ id: 'a', status: 'busy', queued: null })]);
  expect(line.querySelector('[data-field="queued"]')).toBeNull();
});
