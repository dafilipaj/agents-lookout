import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, scenario, world } from '../../world/index.ts';

const library = (page: Page) => page.getByRole('tabpanel', { name: 'Library' });
const rows = (page: Page) => library(page).getByRole('listbox', { name: 'Outputs' }).getByRole('option');
const main = (page: Page) => page.locator('[data-shell-column="main"]');

scenario(
  'DOC-1.5: the Library’s Open shows a Markdown Output rendered in the main pane at its own path, a reload keeps it, Esc returns, and a page opens in the pane’s frame',
  world().outputs([
    { kind: 'file', path: 'output/notes.md', title: 'Harbor notes', contents: '# Harbor notes\n\nThe tide table is **ready**.\n' },
    { kind: 'file', path: 'output/map.html', title: 'Harbor map', contents: '<!doctype html><title>Harbor map</title><h1>Map of the harbor</h1>' },
  ]),
  async ({ page, world: w }) => {
    const pathOf = (file: string) => `/doc/${encodeURIComponent(join(w.home, file))}`;
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Filter Outputs' })).toBeFocused();
    await library(page).getByRole('button', { name: 'Markdown', exact: true }).click();

    // A Markdown file: rendered in the main pane, at its own path.
    const notes = rows(page).filter({ hasText: 'Harbor notes' });
    await notes.click();
    await library(page).getByRole('listbox').press('o');
    await w.step('the Markdown file to show in the main pane', async () => {
      await expect(page).toHaveURL(new URL(pathOf('output/notes.md'), w.url).href);
      await expect(main(page).getByRole('heading', { name: 'notes.md' })).toBeVisible();
      await expect(main(page).getByRole('heading', { name: 'Harbor notes' })).toBeVisible();
      await expect(main(page).locator('strong', { hasText: 'ready' })).toBeVisible();
    });

    await page.reload();
    await w.step('the reload to keep the document', () => expect(main(page).locator('strong', { hasText: 'ready' })).toBeVisible());

    await main(page).getByRole('region', { name: 'notes.md' }).focus();
    await page.keyboard.press('Escape');
    await w.step('Esc to return to Sessions', () => expect(page).toHaveURL(new URL('/', w.url).href));

    // A page: in the pane's frame, under the same header.
    const map = rows(page).filter({ hasText: 'Harbor map' });
    await map.click();
    await library(page).getByRole('listbox').press('o');
    await w.step('the page to show in the pane’s frame', async () => {
      await expect(page).toHaveURL(new URL(pathOf('output/map.html'), w.url).href);
      await expect(main(page).getByRole('heading', { name: 'map.html' })).toBeVisible();
      await expect(main(page).frameLocator('iframe').getByRole('heading', { name: 'Map of the harbor' })).toBeVisible();
    });
    await main(page).getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(new URL('/', w.url).href);
  },
);
