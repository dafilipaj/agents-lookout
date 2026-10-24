import { GB, MB } from '../../../shared/memory.ts';
import { expect, scenario, world } from '../../world/index.ts';

const memory = { ramBytes: 24 * GB, pressure: 'normal' as const, processes: [{ pid: 900001, ppid: 'lookout' as const, bytes: 512 * MB, cpuPct: 0, name: 'node' }] };

scenario('MEM-1.2: the memory line follows a sample and holds the dock height', world().memory(memory), async ({ page, world }) => {
  const line = page.getByRole('button', { name: 'Memory details', exact: true });
  await expect(line).toContainText('577 MB');
  const dock = page.locator('[data-shell-column="left"] [data-shell-row="dock"]');
  const before = await dock.boundingBox();
  await line.click();
  world.memory.answer({ ...memory, processes: [{ ...memory.processes[0]!, bytes: 2.4 * GB - 65 * MB }] });
  await expect(line).toContainText('2.4 GB', { timeout: 8000 });
  await page.keyboard.press('Escape');
  expect((await dock.boundingBox())?.height).toBe(before?.height);
});

scenario('MEM-2.3: tabs share the sampler, opening reads immediately then at five seconds', world().memory(memory), async ({ page, world }) => {
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
  await second.close();
});

scenario('MEM-3.1: click and keyboard open exclusive dock popovers and closing releases the watch', world().memory(memory), async ({ page }) => {
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
  await line.click();
  await expect(details).not.toBeVisible();
});
