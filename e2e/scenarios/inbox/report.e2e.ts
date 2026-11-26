import { expect, scenario, world } from '../../world/index.ts';

/** An invented page, as a Bot's run would write it: everything inline, as an Artifact's source is. */
const PAGE = '<!doctype html><html><head><title>Harbor week 47</title></head><body><h1>Harbor week 47</h1><p>Three boats came in.</p></body></html>';

scenario(
  'INBOX-2.10: the Inbox lists a finished run, selecting it shows the page it wrote inside the pane, and Open opens that page in a new tab',
  world()
    .outputs([{ kind: 'file', path: 'output/harbor-week.html', title: 'Harbor week 47', sessionId: 'inbox-writer', sessionTitle: 'Harbor week run', contents: PAGE }])
    .reports([{ id: 'run-harbor-1', botName: 'Harbor week', title: 'Harbor week 47', sessionId: 'inbox-writer', documents: 1, reply: 'The page is written.' }]),
  async ({ page, world }) => {
    const places = page.getByRole('navigation', { name: 'Places' });
    // INBOX-3.3: the rail counts it while it's unread.
    await world.step('the rail to count one unread Report', () => expect(places.getByRole('button', { name: 'Inbox, 1 unread' })).toBeVisible());
    await places.getByRole('button', { name: /^Inbox/ }).click();

    const row = page.getByRole('listbox', { name: 'Reports' }).getByRole('option', { name: /Harbor week 47/ });
    await world.step('the Inbox to list the finished run', () => expect(row).toBeVisible());
    await expect(row).toHaveAccessibleName(/unread/);
    await row.click();
    expect(new URL(page.url()).pathname).toBe('/inbox/run-harbor-1');

    // INBOX-2.4: the page it wrote, in place, inside its sandboxed frame.
    const frame = page.frameLocator('iframe[title="Harbor week 47"]');
    await world.step('the page to show inside the pane', () => expect(frame.getByRole('heading', { name: 'Harbor week 47' })).toBeVisible());
    await expect(frame.getByText('Three boats came in.')).toBeVisible();
    await expect(page.locator('iframe[title="Harbor week 47"]')).toHaveAttribute('sandbox', /allow-scripts/);

    // INBOX-3.1: shown, so read: the server keeps it, and the rail stops counting it.
    await world.step('the Report to be read', () => expect(places.getByRole('button', { name: 'Inbox', exact: true })).toBeVisible());
    await page.reload();
    await world.step('the Report to stay read and open after a reload', () => expect(page.frameLocator('iframe[title="Harbor week 47"]').getByRole('heading', { name: 'Harbor week 47' })).toBeVisible());
    await expect(places.getByRole('button', { name: 'Inbox', exact: true })).toBeVisible();

    // INBOX-2.8: Open, as the Library opens a page: a new tab from Lookout's file route.
    const [tab] = await Promise.all([page.waitForEvent('popup'), page.getByRole('main').getByRole('button', { name: 'Open', exact: true }).click()]);
    await tab.waitForLoadState();
    expect(new URL(tab.url()).pathname).toBe('/api/library/file');
    await expect(tab.getByRole('heading', { name: 'Harbor week 47' })).toBeVisible();
    await tab.close();
  },
);
