import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, scenario, world } from '../../world/index.ts';

const library = (page: Page) => page.getByRole('tabpanel', { name: 'Library' });
const rows = (page: Page) => library(page).getByRole('listbox', { name: 'Outputs' }).getByRole('option');
const main = (page: Page) => page.locator('[data-shell-column="main"]');
const privateCard = (page: Page) => page.getByRole('region', { name: 'Private folders' });
const reports = (page: Page) => page.getByRole('listbox', { name: 'Reports' }).getByRole('option');
const inbox = (page: Page) => page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: /^Inbox/ });

scenario(
  'PEOPLE-2.7: a folder added to Private folders in Settings leaves the Library, the Document view and the name of the Report that wrote into it, and comes back when it is removed',
  // Invented notes: one person's review, written by a Bot's run, and one of their 1on1s, both in the Vault.
  world()
    .outputs([
      { kind: 'file', path: 'vault/Team/Tomo/Reviews/q3.md', title: 'Q3 review', contents: '# Q3 review\n\nKeep this off the screen.\n', sessionId: 'review-writer', sessionTitle: 'Review prep run' },
      { kind: 'file', path: 'vault/Team/Tomo/1on1s/2026-11-24.md', title: 'Tomo 1on1', contents: '# Tomo 1on1\n\nThe import rewrite.\n' },
    ])
    .reports([{ id: 'run-review-1', botName: 'Review prep', title: 'Q3 review', sessionId: 'review-writer', documents: 1, reply: 'The review is written.', read: true }]),
  async ({ page, world: w }) => {
    const review = `/doc/${encodeURIComponent(join(w.home, 'vault/Team/Tomo/Reviews/q3.md'))}`;
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Filter Outputs' })).toBeFocused();
    await library(page).getByRole('button', { name: 'Markdown', exact: true }).click();
    await w.step('the Library to list both notes', () => expect(rows(page)).toHaveCount(2));

    // Before the folder is private, its note opens in the Document view.
    await page.goto(new URL(review, w.url).href);
    await w.step('the review to show while its folder is not private', () => expect(main(page).getByRole('heading', { name: 'Q3 review' })).toBeVisible());

    // Settings › Vault: the Vault folder, then the folder to keep private, for every person at once.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Vault' }).click();
    await expect(page).toHaveURL(new URL('/settings/vault', w.url).href);
    await page.getByLabel('Vault folder').fill('~/vault');
    await page.getByLabel('Vault folder').press('Enter');
    await w.step('the Vault folder to be saved', () => expect(page.getByLabel('Vault folder').locator('xpath=ancestor::form').getByRole('status')).toHaveText('Saved'));
    await page.getByLabel('Folder to make private').fill('Team/*/Reviews');
    await page.getByLabel('Folder to make private').press('Enter');
    await w.step('the Private folder to be listed in Settings', () => expect(privateCard(page).getByRole('list', { name: 'Private folders' }).getByRole('listitem')).toHaveText(['Team/*/Reviews']));

    await w.step('the Library to list only the 1on1 note', async () => {
      await expect(rows(page)).toHaveCount(1);
      await expect(rows(page)).toContainText('Tomo 1on1');
    });
    await expect(library(page)).not.toContainText('Q3 review');

    // The Report its run left was named after the review: it goes back to its run's own name.
    await inbox(page).click();
    await w.step('the Report to be named after its run, not after the private note', () => expect(reports(page)).toHaveText([/Review prep run/]));
    await expect(reports(page)).not.toContainText('Q3 review');

    // Its own path says only that Lookout can't show it, on a reload too.
    await page.goto(new URL(review, w.url).href);
    await w.step('the private note’s path to be refused', () => expect(main(page).getByText("Lookout can't show this file.")).toBeVisible());
    await expect(main(page)).not.toContainText('Keep this off the screen.');

    // Removed from the list, it is an Output again.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Vault' }).click();
    await privateCard(page).getByRole('button', { name: 'Remove Team/*/Reviews' }).click();
    await w.step('the Private folder to leave the list', () => expect(privateCard(page).getByRole('list', { name: 'Private folders' })).toHaveCount(0));
    await w.step('the Library to list both notes again', async () => {
      await expect(rows(page)).toHaveCount(2);
      await expect(library(page)).toContainText('Q3 review');
    });
    await inbox(page).click();
    await w.step('the Report to be named after the review again', () => expect(reports(page)).toHaveText([/Q3 review/]));
  },
);
