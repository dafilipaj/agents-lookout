import { expect, scenario, world } from '../../world/index.ts';

scenario(
  'SIDE-8.4: every column’s header cell ends on one line, with the right sidebar open on a tab, at its narrowest and closed, in Sessions and in the Inbox',
  world(),
  async ({ page, world }) => {
    const right = page.locator('[data-shell-column="right"]');
    /** Each header cell that shows: its column, and where its bottom edge is. */
    const cells = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-shell-row="header"]')]
          .filter((cell) => cell.getClientRects().length > 0)
          .map((cell) => ({ column: cell.closest('[data-shell-column]')?.getAttribute('data-shell-column') ?? 'none', bottom: Math.round(cell.getBoundingClientRect().bottom) })),
      );
    const onOneLine = (when: string) =>
      world.step(`the header line to hold ${when}`, async () => {
        const found = await cells();
        expect(found.map((c) => c.column).sort(), when).toEqual(['left', 'main', 'rail', 'right']);
        expect(found.map((c) => c.bottom), when).toEqual([48, 48, 48, 48]);
      });

    await world.step('Lookout to show', () => expect(page.getByRole('navigation', { name: 'Places' })).toBeVisible());
    // Closed, the right sidebar is its rail.
    await expect(page.getByTestId('right-sidebar')).toHaveCount(0);
    await onOneLine('with the right sidebar closed, in Sessions');

    await right.getByRole('button', { name: /^History/ }).click();
    await world.step('the right sidebar to open', () => expect(page.getByTestId('right-sidebar')).toBeVisible());
    for (const tab of ['History', 'Work', 'Library', 'Topics', 'Bots', 'Servers', 'Setup']) {
      await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
      await expect(page.getByRole('tab', { name: new RegExp(`^${tab}`) })).toHaveAttribute('aria-selected', 'true');
      await onOneLine(`with ${tab} open`);
    }

    // Dragged to its narrowest, where the open tab shows its icon alone (BOT-1.6).
    const edge = (await page.getByRole('separator', { name: 'Resize the right sidebar' }).boundingBox())!;
    await page.mouse.move(edge.x + edge.width / 2, 400);
    await page.mouse.down();
    await page.mouse.move(edge.x + 400, 400, { steps: 8 });
    await page.mouse.up();
    await world.step('the right sidebar to be 280 px wide', async () => expect((await page.getByTestId('right-sidebar').boundingBox())!.width).toBe(280));
    await onOneLine('with the right sidebar at its narrowest');
    const open = (await page.getByRole('tab', { selected: true }).boundingBox())!;
    expect([open.width, open.height]).toEqual([28, 28]);

    await page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: /^Inbox/ }).click();
    await world.step('the Inbox to show', () => expect(page.getByRole('complementary', { name: 'Inbox' })).toBeVisible());
    await onOneLine('with the right sidebar open, in the Inbox');

    await right.getByRole('button', { name: /^Close / }).click();
    await expect(page.getByTestId('right-sidebar')).toHaveCount(0);
    await onOneLine('with the right sidebar closed, in the Inbox');
  },
);
