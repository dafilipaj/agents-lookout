import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, scenario, world } from '../../world/index.ts';

const places = (page: Page) => page.getByRole('navigation', { name: 'Places' });
const people = (page: Page) => page.getByRole('listbox', { name: 'People' }).getByRole('option');
const main = (page: Page) => page.locator('[data-shell-column="main"]');
const oneOnOnes = (page: Page) => main(page).getByRole('list', { name: '1on1 notes', exact: true }).getByRole('link');

scenario(
  'PEOPLE-3.7: the People button shows the Persons of the Vault, a row shows that Person’s page at its own path, a reload keeps it, a 1on1 note opens in the Document view and Esc returns to the page',
  // Two invented Persons, and a folder that is no Person.
  world().vault({
    notes: {
      'Team/Ines/Ines.md': '# Ines\n\nBackend, the import team.\n',
      'Team/Ines/1on1s/Ines 1on1 2026-11-10.md': '# Ines 1on1\n\nPlanning the rewrite.\n',
      'Team/Ines/1on1s/Ines 1on1 2026-11-24.md': '# Ines 1on1\n\nThe import rewrite is on track.\n',
      'Team/Tomo/1on1s/Tomo 1on1 2026-11-18.md': '# Tomo 1on1\n\nThe guild talk.\n',
      'Team/Archive/Vito/Vito.md': '# Vito\n',
    },
  }),
  async ({ page, world: w }) => {
    await places(page).getByRole('button', { name: 'People' }).click();
    await expect(page).toHaveURL(new URL('/people', w.url).href);
    await w.step('the list to hold the two Persons, A to Z, and not the Archive folder', () => expect(people(page)).toHaveText([/^Ines/, /^Tomo/]));
    await expect(main(page).getByText('Select a person')).toBeVisible();

    await people(page).filter({ hasText: 'Ines' }).click();
    await expect(page).toHaveURL(new URL('/people/Ines', w.url).href);
    await w.step('the page to be Ines’s, with her two 1on1 notes, newest first', async () => {
      await expect(main(page).getByRole('heading', { name: 'Ines', level: 1 })).toBeVisible();
      await expect(oneOnOnes(page)).toHaveText([/24 Nov 2026/, /10 Nov 2026/]);
    });
    await expect(main(page).getByRole('list', { name: 'Notes', exact: true }).getByRole('link')).toHaveText([/^Ines/]);

    // Its own path: a reload shows the same Person, in People.
    await page.reload();
    await w.step('a reload to keep the Person’s page', () => expect(main(page).getByRole('heading', { name: 'Ines', level: 1 })).toBeVisible());
    await expect(page).toHaveURL(new URL('/people/Ines', w.url).href);
    await expect(places(page).getByRole('button', { name: 'People' })).toHaveAttribute('aria-current', 'page');

    // A note opens in the Document view, over People.
    await oneOnOnes(page).first().click();
    const note = join(w.home, 'vault/Team/Ines/1on1s/Ines 1on1 2026-11-24.md');
    await expect(page).toHaveURL(new URL(`/people/Ines/doc/${encodeURIComponent(note)}`, w.url).href);
    await w.step('the note to show in the Document view', () => expect(main(page).getByText('The import rewrite is on track.')).toBeVisible());
    await expect(places(page).getByRole('button', { name: 'People' })).toHaveAttribute('aria-current', 'page');
    await expect(people(page).filter({ hasText: 'Ines' })).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Escape');
    await w.step('Esc to return to the Person’s page', () => expect(main(page).getByRole('heading', { name: 'Ines', level: 1 })).toBeVisible());
    await expect(page).toHaveURL(new URL('/people/Ines', w.url).href);
  },
);
