import { expect, scenario, world } from '../../world/index.ts';

scenario(
  'NAV-2.7: the Inbox button shows the Inbox and its path, the Sessions button brings Sessions back, and Back and Forward step through the two',
  world(),
  async ({ page, world }) => {
    const places = page.getByRole('navigation', { name: 'Places' });
    const inbox = places.getByRole('button', { name: /^Inbox/ });
    const sessions = places.getByRole('button', { name: /^Sessions/ });
    const path = () => new URL(page.url()).pathname;

    await world.step('Sessions to be the place that shows', () => expect(sessions).toHaveAttribute('aria-current', 'page'));
    await expect(page.getByRole('complementary', { name: 'Session sidebar' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Filter Sessions' })).toBeVisible();

    await inbox.click();
    await world.step('the Inbox to take the left column', () => expect(page.getByRole('complementary', { name: 'Inbox' })).toBeVisible());
    await expect(inbox).toHaveAttribute('aria-current', 'page');
    expect(path()).toBe('/inbox');
    await expect(page.getByRole('searchbox', { name: 'Filter Sessions' })).toBeHidden();

    // A reload on the Inbox's path keeps the place.
    await page.reload();
    await world.step('the Inbox to show again after a reload', () => expect(page.getByRole('complementary', { name: 'Inbox' })).toBeVisible());
    await expect(places.getByRole('button', { name: /^Inbox/ })).toHaveAttribute('aria-current', 'page');

    await places.getByRole('button', { name: /^Sessions/ }).click();
    await world.step('Sessions to come back', () => expect(page.getByRole('complementary', { name: 'Session sidebar' })).toBeVisible());
    expect(path()).toBe('/');

    await page.goBack();
    await world.step('Back to show the Inbox', () => expect(page.getByRole('complementary', { name: 'Inbox' })).toBeVisible());
    expect(path()).toBe('/inbox');
    await page.goForward();
    await world.step('Forward to show Sessions', () => expect(page.getByRole('complementary', { name: 'Session sidebar' })).toBeVisible());
    expect(path()).toBe('/');

    // The keys do what the buttons do (NAV-4.1).
    await page.keyboard.press('1');
    await world.step('1 to show the Inbox', () => expect(page.getByRole('complementary', { name: 'Inbox' })).toBeVisible());
    await page.keyboard.press('2');
    await world.step('2 to show Sessions', () => expect(page.getByRole('complementary', { name: 'Session sidebar' })).toBeVisible());
  },
);
