import { GB, MB } from '../../../shared/memory.ts';
import type { Locator, Page } from '@playwright/test';
import { type RunningWorld, expect, scenario, world } from '../../world/index.ts';

const memory = { ramBytes: 24 * GB, pressure: 'normal' as const, processes: [{ pid: 900001, ppid: 'lookout' as const, bytes: 512 * MB, cpuPct: 0, name: 'node' }] };

const usage = { claude: { session: 6, weekly_all: 66 }, codex: { session: 0, weekly_all: 39 }, jev: 'ready' as const };
const memoryReads = (w: RunningWorld) => w.memory.calls().filter((argv) => argv[0] === '-axo').length;

/** A full fast interval must stay quiet after release; API tests check the exact 30 s boundary. */
async function expectReleased(w: RunningWorld) {
  const count = memoryReads(w);
  const since = Date.now();
  await w.waitUntil('no fast memory sample after releasing the watch', () => {
    expect(memoryReads(w)).toBe(count);
    return Date.now() - since >= 6500;
  }, { timeoutMs: 8000 });
}

async function changeWatch(page: Page, open: boolean, action: () => Promise<unknown>) {
  const changed = page.waitForResponse((response) => response.url().endsWith('/api/memory/watch') && response.request().postDataJSON()?.open === open);
  await action();
  expect((await changed).ok()).toBe(true);
}

async function expectRestingDock(page: Page, dock: Locator) {
  const bounds = await dock.boundingBox();
  const composerDock = await page.locator('[data-shell-column="main"] [data-shell-row="dock"]').boundingBox();
  const rest = await page.locator('[data-dock-rest]').boundingBox();
  expect(rest?.height).toBe(120);
  expect(bounds?.height).toBe(121); // DockRest plus the shared top border, SIDE-8.1.
  expect(bounds?.y).toBe(composerDock?.y);
  expect(bounds?.height).toBe(composerDock?.height);
  expect(await page.getByRole('textbox', { name: 'Message', exact: true }).getAttribute('rows')).toBe('1');
}

scenario('MEM-1.2: populated Claude, Codex and Jev usage plus memory fit the composer’s resting dock', world().memory(memory).usage(usage), async ({ page, world }) => {
  const id = '00000000-0000-4000-8000-0000000000aa';
  world.fleet.gainSession({ pid: 900002, session_id: id, cwd: world.home, status: 'idle', waiting_for: null, updated_at: Date.now(), backend: 'tmux', tmux_session: 'dock-session', display_title: 'Dock Session', context: null, harness: 'claude', model: null });
  await page.getByRole('option', { name: /Dock Session/ }).click();
  const line = page.getByRole('button', { name: 'Memory details', exact: true });
  await expect(line).toContainText('577 MB');
  const strip = page.getByTestId('usage-strip');
  await expect(strip.locator('[data-provider="claude"] [data-field="weekly"]')).toHaveText('weekly 66%');
  await expect(strip.locator('[data-provider="codex"] [data-field="weekly"]')).toHaveText('weekly 39%');
  await expect(strip.locator('[data-field="jev"]')).toHaveText('ready');
  await expect(strip.locator('[data-provider="claude"] [data-field="reset"]')).not.toBeEmpty();
  await expect(strip.locator('[data-provider="codex"] [data-field="reset"]')).not.toBeEmpty();
  const dock = page.locator('[data-shell-column="left"] [data-shell-row="dock"]');
  await expectRestingDock(page, dock);
  await line.click();
  world.memory.answer({ ...memory, processes: [{ ...memory.processes[0]!, bytes: 2.4 * GB - 65 * MB }] });
  await expect(line).toContainText('2.4 GB', { timeout: 8000 });
  await page.keyboard.press('Escape');
  await expectRestingDock(page, dock);
});

scenario('MEM-2.3: disconnecting the watching tab leaves the other tab on the background cadence', world().memory(memory), async ({ page, world }) => {
  const line = page.getByRole('button', { name: 'Memory details', exact: true });
  await expect(line).toContainText('577 MB');
  const second = await page.context().newPage();
  await second.goto(world.url);
  await expect(second.getByRole('button', { name: 'Memory details', exact: true })).toContainText('577 MB');
  world.memory.answer({ ...memory, pressure: 'warn' });
  await line.click();
  await expect(line).toContainText('pressure warn');
  await expect(second.getByRole('button', { name: 'Memory details', exact: true })).toContainText('pressure warn');
  const reads = world.memory.calls().filter((argv) => argv[0] === '-axo').length;
  world.memory.answer({ ...memory, pressure: 'critical' });
  await expect(line).toContainText('pressure critical', { timeout: 8000 });
  expect(world.memory.calls().filter((argv) => argv[0] === '-axo').length).toBe(reads + 1);
  await page.close();
  await expectReleased(world);
  await expect(second.getByRole('button', { name: 'Memory details', exact: true })).toBeVisible();
  await second.close();
});

scenario('MEM-3.1: click and keyboard open exclusive dock popovers and closing releases the watch', world().memory(memory), async ({ page, world }) => {
  const line = page.getByRole('button', { name: 'Memory details', exact: true });
  const details = page.getByRole('dialog', { name: 'Memory details' });
  await line.focus();
  await page.keyboard.press('Enter');
  await expect(details).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(details).not.toBeVisible();
  await expect(line).toBeFocused();
  await page.keyboard.press('Space');
  await expect(details).toBeVisible();
  await page.getByRole('button', { name: 'Usage details', exact: true }).click();
  await expect(details).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Usage details' })).toBeVisible();
  await line.click();
  await expect(details).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Usage details' })).not.toBeVisible();
  await changeWatch(page, false, () => line.click());
  await expect(details).not.toBeVisible();
  await expectReleased(world);
});

scenario('MEM-2.3: closing the last tab stops the shared sampler', world().memory(memory), async ({ page, world }) => {
  const line = page.getByRole('button', { name: 'Memory details', exact: true });
  await expect(line).toContainText('577 MB');
  await changeWatch(page, true, () => line.click());
  world.memory.answer({ ...memory, pressure: 'warn' });
  await expect(line).toContainText('pressure warn', { timeout: 8000 });
  await page.close();
  await expectReleased(world);
});
