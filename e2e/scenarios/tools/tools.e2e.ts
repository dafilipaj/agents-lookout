import type { Page } from '@playwright/test';
import { TB_PR_INSTALL_COMMAND } from '../../../shared/defaults.ts';
import { expect, scenario, world } from '../../world/index.ts';

/**
 * TOOLS: Settings › Tools and the Settings button's dot, against a World's PATH (TEST-1.5). A default
 * World has no tb-pr, tb-prod, tb-jev or Harness; Fleet, tb-session, git and tmux are on its PATH.
 */

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Session sidebar' });
const settingsButton = (page: Page) => sidebar(page).getByRole('button', { name: 'Settings', exact: true });
const toolRow = (page: Page, id: string) => page.getByRole('region', { name: 'Tools' }).locator(`[data-tool="${id}"]`);

scenario(
  'TOOLS-1.5: without tb-pr on PATH, Settings › Tools shows tb-pr as missing, what Work needs it for and its install command to copy',
  world(),
  async ({ page, world }) => {
    await settingsButton(page).click();
    const row = toolRow(page, 'tb-pr');
    await world.step('the tb-pr row to say it is missing', () => expect(row.getByRole('alert')).toContainText('tb-pr is missing'));
    await expect(row).toContainText('Work reads PRs through it');
    await expect(row.locator('[data-slot="command-block"]')).toHaveText(TB_PR_INSTALL_COMMAND);
    // Found nowhere, so nothing was run: no tb-pr call at all, its install command included (TOOLS-3.4).
    expect(world.calls().filter((c) => /^\S+ tb-pr\b(?!od)/.test(c))).toEqual([]);
    // The rest of the list is there, each Tool once, in the spec's order.
    await expect(page.getByRole('region', { name: 'Tools' }).locator('[data-tool]')).toHaveCount(9);
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
    const row = toolRow(page, 'tb-pr');
    await expect(row.getByRole('status')).toContainText('0.3.2');
    await expect(row.getByRole('alert')).toHaveCount(0);
    // The dot stays while Settings is open: it marks the Tools, not the page.
    await expect(button.locator('[data-field="tools-dot"]')).toBeVisible();
  },
);
