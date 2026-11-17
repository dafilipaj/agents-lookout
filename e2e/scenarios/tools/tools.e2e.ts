import type { Page } from '@playwright/test';
import { AMPHETAMINE_STORE_URL, TB_PR_INSTALL_COMMAND } from '../../../shared/defaults.ts';
import { expect, scenario, world } from '../../world/index.ts';

/**
 * TOOLS: Settings › Tools and the Settings button's dot, against a World's PATH (TEST-1.5). A default
 * World has no tb-pr, tb-prod, tb-jev, Harness or Amphetamine; Fleet, tb-session, git, tmux and a
 * fake caffeinate are on its PATH.
 */

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Session sidebar' });
const settingsButton = (page: Page) => sidebar(page).getByRole('button', { name: 'Settings', exact: true });
// SIDE-7.6: Settings opens on General; Tools is its own sub-page, through the side nav.
const toolsLink = (page: Page) => page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Tools' });
const toolRow = (page: Page, id: string) => page.getByRole('region', { name: 'Tools' }).locator(`[data-tool="${id}"]`);

scenario(
  'TOOLS-1.5: without tb-pr on PATH, Settings › Tools shows tb-pr as missing, what Work needs it for and its install command to copy',
  world(),
  async ({ page, world }) => {
    await settingsButton(page).click();
    await toolsLink(page).click();
    await expect(page).toHaveURL(/\/settings\/tools$/);
    const row = toolRow(page, 'tb-pr');
    await world.step('the tb-pr row to say it is missing', () => expect(row.getByRole('alert')).toContainText('tb-pr is missing'));
    await expect(row).toContainText('Work reads PRs through it');
    await expect(row.locator('[data-slot="command-block"]')).toHaveText(TB_PR_INSTALL_COMMAND);
    // Found nowhere, so nothing was run: no tb-pr call at all, its install command included (TOOLS-3.4).
    expect(world.calls().filter((c) => /^\S+ tb-pr\b(?!od)/.test(c))).toEqual([]);
    // The rest of the list is there, each Tool once, in the spec's order.
    await expect(page.getByRole('region', { name: 'Tools' }).locator('[data-tool]')).toHaveCount(11);
    await expect(toolRow(page, 'git')).toContainText('ok');
  },
);

scenario(
  'TOOLS-2.4: a missing Tool, or no Harness at all, marks the Settings button with a dot that names it; a Tool with an update available doesn’t',
  world().tbPr({ version: 'tb-pr 0.3.1 (latest: 0.3.2 — upgrade available)' }),
  async ({ page, world }) => {
    const button = settingsButton(page);
    await world.step('the Settings button to carry its dot', () => expect(button.locator('[data-field="tools-dot"]')).toBeVisible());
    await expect(button).toHaveAttribute('title', /tb-prod is missing/);
    // This World has no Harness at all, so no Session can start: that lights the dot too (a lone missing Harness wouldn't).
    await expect(button).toHaveAttribute('title', /claude is missing, codex is missing/);
    // tb-pr has an update out: a notice on its row, never the dot.
    await expect(button).not.toHaveAttribute('title', /\btb-pr\b/);
    await button.click();
    // The Tools link carries the same dot and names the same Tools.
    await expect(toolsLink(page).locator('[data-field="tools-dot"]')).toBeVisible();
    await expect(toolsLink(page)).toHaveAttribute('title', /tb-prod is missing/);
    await toolsLink(page).click();
    const row = toolRow(page, 'tb-pr');
    await expect(row.getByRole('status')).toContainText('0.3.2');
    await expect(row.getByRole('alert')).toHaveCount(0);
    // The dot stays while Settings is open: it marks the Tools, not the page.
    await expect(button.locator('[data-field="tools-dot"]')).toBeVisible();
  },
);

scenario(
  'TOOLS-5.5: the Third-party list ends with caffeinate, found in the World, and Amphetamine, not installed, with its Mac App Store link; the Settings button doesn’t name it',
  world(),
  async ({ page, world }) => {
    await settingsButton(page).click();
    await toolsLink(page).click();
    const third = page.getByRole('region', { name: 'Tools' }).getByRole('list', { name: 'Third-party' });
    await world.step('the Third-party list to end with keep-awake’s two', () =>
      expect(third.locator('[data-tool]')).toHaveCount(6),
    );
    expect(await third.locator('[data-tool]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-tool')))).toEqual(['claude', 'codex', 'git', 'tmux', 'caffeinate', 'amphetamine']);
    const caffeinate = toolRow(page, 'caffeinate');
    await expect(caffeinate.locator('[data-field="path"]')).toContainText('/bin/caffeinate');
    await expect(caffeinate.locator('[data-field="state"]')).toHaveText('ok · Comes with macOS; any version works.');
    const amphetamine = toolRow(page, 'amphetamine');
    await expect(amphetamine.getByRole('status')).toContainText('Not installed');
    const link = amphetamine.getByRole('link', { name: 'Get it on the Mac App Store' });
    await expect(link).toHaveAttribute('href', AMPHETAMINE_STORE_URL);
    await expect(link).toHaveAttribute('target', '_blank');
    // No Harness in this World lights the dot; Amphetamine never does (TOOLS-5.4).
    await expect(settingsButton(page)).toHaveAttribute('title', /claude is missing/);
    await expect(settingsButton(page)).not.toHaveAttribute('title', /amphetamine/i);
  },
);
