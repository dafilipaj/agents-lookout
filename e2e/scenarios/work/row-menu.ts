import type { Locator, Page } from '@playwright/test';
import { expect } from '../../world/index.ts';

/** DS-16: an expanded row's "More". */
const more = (row: Locator) => row.locator('[data-field="actions"] [data-action="more"]');
/** DS-16: the open "More" menu. */
export const rowMenu = (page: Page) => page.locator('[data-slot="row-menu"]');

/** DS-16: opens an expanded row's "More", once the click that expanded the row has settled (ROW_SETTLE_MS). */
export async function openMore(page: Page, row: Locator): Promise<Locator> {
  await expect(more(row)).not.toHaveAttribute('aria-disabled', 'true');
  await more(row).click();
  await expect(rowMenu(page)).toBeVisible();
  return rowMenu(page);
}

/** DS-16: picks an action, by its `data-action`, from an expanded row's "More". */
export async function pickMore(page: Page, row: Locator, action: string): Promise<void> {
  await (await openMore(page, row)).locator(`[data-action="${action}"]`).click();
}

/** DS-16 (WORK-2.10, WORK-3.6): an expanded row's actions' words in order: the labelled one, then More's. */
export async function actionWords(page: Page, row: Locator): Promise<string[]> {
  const first = await row.locator('[data-field="actions"] [data-slot="row-action"]:not([data-action="more"]) > span').first().textContent();
  const menu = await openMore(page, row);
  const rest = await menu.locator('[role="menuitem"] > span:first-of-type').allTextContents();
  await page.keyboard.press('Escape');
  await expect(rowMenu(page)).toHaveCount(0);
  return [first ?? '', ...rest];
}
