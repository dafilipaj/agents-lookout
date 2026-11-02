import type { Page } from '@playwright/test';
import type { PortsDecl } from '../../world/builder.ts';
import { type RunningWorld, expect, scenario, world } from '../../world/index.ts';

const SESSION = '00000000-0000-4000-8000-0000000000b1';
const SESSION_PID = 900_101;
const VITE = 900_201;
const API = 900_202;

/** A Session the World's Fleet reports, whose process the servers below are started under. */
function gainSession(w: RunningWorld) {
  w.fleet.gainSession({ pid: SESSION_PID, session_id: SESSION, cwd: w.home, status: 'idle', waiting_for: null, updated_at: Date.now(), backend: 'tmux', tmux_session: 'ports-session', display_title: 'Ports Session', context: null, harness: 'claude', model: null });
}

const vite = (w: RunningWorld): PortsDecl => ({
  listeners: [{ pid: VITE, ppid: SESSION_PID, command: 'node', addresses: ['127.0.0.1:5173', '[::1]:5173', '*:24678'] }],
  cwds: { [VITE]: `${w.home}/fantastic` },
  processes: [{ pid: VITE, ppid: SESSION_PID, etime: '14:05' }],
  devctl: [],
});

const listenReads = (w: RunningWorld) => w.ports.calls().filter((argv) => argv.includes('-iTCP')).length;
const panel = (page: Page) => page.locator('#right-panel-servers');
const chip = (page: Page) => page.getByRole('group', { name: 'Status line', exact: true }).locator('[data-field="servers"]');

scenario('PORTS-1.1: the listeners, their directories, ps and tb-devctl make one Local server per process, with all its ports', world(), async ({ page, world }) => {
  gainSession(world);
  world.ports.answer({
    ...vite(world),
    listeners: [...vite(world).listeners, { pid: API, ppid: 1, command: 'ruby', addresses: ['127.0.0.1:4301'] }],
    cwds: { ...vite(world).cwds, [API]: `${world.home}/api-worktrees/pr-1` },
    processes: [...vite(world).processes, { pid: API, ppid: 1, pgid: API, etime: '02:10:00' }],
    devctl: [{ stack: 'pr-1', service: 'api', owner: `claude:me:${SESSION}`, state: 'running', url: 'http://agent-pr-1-api.localhost:4301', pgid: API, listener_pid: API, port: 4301 }],
  });
  await page.keyboard.press('p');
  const rows = panel(page).getByRole('option');
  await expect(rows).toHaveCount(2);
  await expect(panel(page).getByRole('group', { name: 'Ports Session' }).getByRole('option')).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(':4301pr-1/api~/api-worktrees/pr-12h 10m');
  await expect(rows.nth(1)).toContainText(':5173:24678node~/fantastic14m');
  await expect(rows.nth(0).getByRole('link')).toHaveAttribute('href', 'http://agent-pr-1-api.localhost:4301');

  // The other reads failing only leave out what they add.
  world.ports.answer({ ...vite(world), fail: { cwds: 'refused', ps: 'timeout', devctl: 'refused' } });
  await expect(rows).toHaveCount(0, { timeout: 8000 });
  await page.getByRole('checkbox', { name: 'Show all' }).check();
  await expect(rows).toHaveCount(1, { timeout: 8000 });
  await expect(rows.nth(0)).toContainText('unknown directory');

  // lsof exiting 1 with no output: nothing listens.
  world.ports.answer({ listeners: [], cwds: {}, processes: [], devctl: [] });
  await expect(panel(page).getByRole('status')).toHaveText('No Local servers running.', { timeout: 8000 });
  expect(world.violations()).toEqual([]);
});

scenario('PORTS-1.2: one read every 5 s for every tab while one is connected, none once none is', world(), async ({ page, world }) => {
  await expect.poll(() => listenReads(world)).toBeGreaterThan(0);
  const second = await page.context().newPage();
  await second.goto(world.url);
  const start = listenReads(world);
  const since = Date.now();
  await world.waitUntil('11 s of reads with two tabs', () => Date.now() - since >= 11_000, { timeoutMs: 13_000 });
  // About two reads in 11 s, not four: the tabs share them.
  expect(listenReads(world) - start).toBeGreaterThanOrEqual(2);
  expect(listenReads(world) - start).toBeLessThanOrEqual(3);
  await second.close();
  await page.close();
  await world.waitUntil('the last tab disconnected', () => true);
  const stopped = listenReads(world);
  const quiet = Date.now();
  await world.waitUntil('no read for 7 s with no tab', () => {
    expect(listenReads(world)).toBeLessThanOrEqual(stopped + 1);
    return Date.now() - quiet >= 7000;
  }, { timeoutMs: 9000 });
});

scenario('PORTS-2.3: the chip follows the reads, and hands focus to the composer when it goes', world(), async ({ page, world }) => {
  gainSession(world);
  await page.getByRole('option', { name: /Ports Session/ }).click();
  await expect(page.getByRole('group', { name: 'Status line', exact: true })).toBeVisible();
  await expect(chip(page)).toHaveCount(0);
  world.ports.answer(vite(world));
  await expect(chip(page)).toHaveText(':5173 node', { timeout: 6000 });
  await chip(page).focus();
  world.ports.answer({ listeners: [], cwds: {}, processes: [], devctl: [] });
  await expect(chip(page)).toHaveCount(0, { timeout: 6000 });
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeFocused();
});

scenario('PORTS-3.5: a failed read after a good one keeps the list with an Alert, until the next good read', world(), async ({ page, world }) => {
  gainSession(world);
  world.ports.answer(vite(world));
  await page.getByRole('option', { name: /Ports Session/ }).click();
  await expect(chip(page)).toHaveText(':5173 node');
  await page.keyboard.press('p');
  await expect(panel(page).getByRole('option')).toHaveCount(1);
  world.ports.answer({ ...vite(world), fail: { listen: 'refused' } });
  const alert = panel(page).locator('[data-field="ports-error"]');
  await expect(alert).toContainText("Couldn't read the ports: lsof: refused. Showing the list from", { timeout: 6000 });
  await expect(panel(page).getByRole('option')).toHaveCount(1);
  await expect(chip(page)).toHaveText(':5173 node');
  world.ports.answer(vite(world));
  await expect(alert).toHaveCount(0, { timeout: 6000 });
});
