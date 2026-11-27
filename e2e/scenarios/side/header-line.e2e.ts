import { expect, scenario, world } from '../../world/index.ts';

/** SIDE-8.4: the header row's height in every view, whether a header holds one line or a title with its facts. */
const HEADER_LINE = 60;

scenario(
  'SIDE-8.4: every column’s header cell ends on one line, 60 px down, with the right sidebar open on a tab, at its narrowest and closed, in Sessions and in the Inbox, and with a Topic view or a Report open',
  world()
    .outputs([{ kind: 'file', path: 'output/tide-table.md', title: 'Tide table', sessionId: 'tide-writer', sessionTitle: 'Tide table run', contents: '# Tide table\n\nHigh water at six.\n' }])
    .reports([{ id: 'run-tide-1', botName: 'Tide table', title: 'Tide table', sessionId: 'tide-writer', documents: 1, reply: 'The table is written.' }])
    .topics([{ title: 'Tide marks' }]),
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
        expect(found.map((c) => c.bottom), when).toEqual([HEADER_LINE, HEADER_LINE, HEADER_LINE, HEADER_LINE]);
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

    // A Topic view's header is two lines, its title and its counts: the line stays where it is.
    await page.getByRole('tab', { name: /^Topics/ }).click();
    const topics = page.getByRole('tabpanel', { name: 'Topics' });
    await topics.getByRole('button', { name: /^Tide marks,/ }).click();
    await topics.getByRole('button', { name: 'Open', exact: true }).click();
    await world.step('the Topic view to show, its counts under its title', () => expect(page.getByTestId('topic-view').locator('[data-field="counts"]')).toBeVisible());
    await onOneLine('with a Topic view open');

    // Dragged to its narrowest, where the open tab shows its icon alone (BOT-1.6).
    const edge = (await page.getByRole('separator', { name: 'Resize the right sidebar' }).boundingBox())!;
    await page.mouse.move(edge.x + edge.width / 2, 400);
    await page.mouse.down();
    await page.mouse.move(edge.x + 400, 400, { steps: 8 });
    await page.mouse.up();
    await world.step('the right sidebar to be 280 px wide', async () => expect((await page.getByTestId('right-sidebar').boundingBox())!.width).toBe(280));
    await onOneLine('with the right sidebar at its narrowest');
    const open = (await right.getByRole('tab', { selected: true }).boundingBox())!;
    expect([open.width, open.height]).toEqual([28, 28]);

    await page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: /^Inbox/ }).click();
    await world.step('the Inbox to show', () => expect(page.getByRole('complementary', { name: 'Inbox' })).toBeVisible());
    await onOneLine('with the right sidebar open, in the Inbox');

    // A Report's header is a title with its facts under it: two lines, and the line stays where it is.
    await page.getByRole('listbox', { name: 'Reports' }).getByRole('option', { name: /Tide table/ }).click();
    const report = page.locator('[data-shell-column="main"] [data-shell-row="header"]');
    await world.step('the Report to show, its facts under its title', async () => {
      await expect(report.getByRole('heading', { name: 'Tide table' })).toBeVisible();
      await expect(report.locator('[data-field="facts"]')).toBeVisible();
    });
    const lines = await report.evaluate((cell) => {
      const top = (el: Element | null) => Math.round(el!.getBoundingClientRect().top);
      return { title: top(cell.querySelector('h1')), facts: top(cell.querySelector('[data-field="facts"]')) };
    });
    expect(lines.facts, 'the facts sit under the title').toBeGreaterThan(lines.title);
    await onOneLine('with a Report open, the right sidebar open');

    await right.getByRole('button', { name: /^Close / }).click();
    await expect(page.getByTestId('right-sidebar')).toHaveCount(0);
    await onOneLine('with a Report open, the right sidebar closed');

    // Back in Sessions, with nothing selected: a one-line header, on the same line.
    await page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: /^Sessions/ }).click();
    await world.step('Sessions to show', () => expect(page.getByRole('complementary', { name: 'Session sidebar' })).toBeVisible());
    await onOneLine('back in Sessions, with the right sidebar closed');
  },
);
