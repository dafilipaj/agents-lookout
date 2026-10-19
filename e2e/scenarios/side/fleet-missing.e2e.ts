import { FLEET_INSTALL_COMMAND } from '../../../shared/defaults.ts';
import { expect, scenario, world } from '../../world/index.ts';

scenario(
  "SIDE-6.1: without Fleet, the sidebar says how to install it instead of an empty list",
  world().without('fleet'),
  async ({ page, world }) => {
    const sidebar = page.getByRole('complementary', { name: 'Session sidebar' });
    const alert = sidebar.getByRole('alert');
    await world.step("the sidebar to say Fleet isn't installed", () => expect(alert).toContainText("Fleet isn't installed"));
    await expect(alert).toContainText(FLEET_INSTALL_COMMAND);
    await expect(sidebar.getByText('No live Sessions')).toHaveCount(0);
    // Fleet is gone from every place Lookout looks: no wrapper on PATH, nothing was called.
    expect(world.env.LOOKOUT_FLEET_BIN).toBeUndefined();
    expect(world.calls().filter((c) => / fleet /.test(` ${c.split(' ').slice(1).join(' ')} `))).toEqual([]);
  },
);
