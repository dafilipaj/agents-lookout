import { expect, scenario, world } from '../../world/index.ts';

const caffeinates = async (w: { processes(): Promise<{ command: string }[]> }) => (await w.processes()).filter((p) => p.command.includes('fakes/caffeinate.ts')).length;

scenario('AWAKE-4.5: picking Awake starts `caffeinate -i -w <the server’s pid>` and the corner counts down; Off ends it; without Amphetamine, Lid closed says what it needs', world(), async ({ page, world }) => {
  const corner = page.getByRole('button', { name: /^Keep the Mac awake: / });
  await expect(corner).toHaveAccessibleName('Keep the Mac awake: Sleeps as usual');

  await corner.click();
  const lid = page.getByRole('menuitemradio', { name: /^Lid closed/ });
  await expect(lid).toHaveAttribute('data-disabled', '');
  await expect(lid).toContainText('Needs Amphetamine, from the Mac App Store');
  await page.getByRole('menuitemradio', { name: /^Awake/ }).click();
  await expect(corner).toHaveAccessibleName(/^Keep the Mac awake: Awake · off in [45]m$/);
  await expect(corner).toHaveAttribute('aria-pressed', 'true');

  const server = (await world.processes()).find((p) => p.command.includes('server/main.ts'));
  expect(server).toBeDefined();
  // The corner answers once the server spawned it; the fake logs its call as it starts.
  await expect.poll(() => world.calls().filter((line) => / caffeinate /.test(line)).map((line) => line.replace(/^\S+ /, ''))).toEqual([`caffeinate -i -w ${server!.pid}`]);
  await expect.poll(() => caffeinates(world)).toBe(1);

  await corner.click();
  await page.getByRole('menuitemradio', { name: /^Off/ }).click();
  await expect(corner).toHaveAccessibleName('Keep the Mac awake: Sleeps as usual');
  await expect(corner).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => caffeinates(world)).toBe(0);
  expect(world.violations()).toEqual([]);
});
