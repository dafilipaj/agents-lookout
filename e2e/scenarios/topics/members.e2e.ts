import type { Page } from '@playwright/test';
import type { NewMember } from '../../../shared/topics.ts';
import type { TbPrBoardDecl } from '../../world/builder.ts';
import { expect, scenario, world } from '../../world/index.ts';

/** TOPIC slice 1 against the fake tb-pr: invented repos, numbers and titles. */
const BOARD: TbPrBoardDecl = {
  columns: {
    draft_mine: [{ number: 2101, repo: 'anvil', title: 'Sharpen the anvil corners', check_state: 'success' }],
  },
};
const pr = (repo: string, number: number, title: string): NewMember => {
  const url = `https://github.com/productiveio/${repo}/pull/${number}`;
  return { kind: 'pr', ref: { url }, snapshot: { repo, number, title, url } };
};

const listCalls = (calls: string[][]) => calls.filter((c) => c.join(' ') === 'list --json');
const sessionSidebar = (page: Page) => page.getByRole('complementary', { name: 'Session sidebar' });
const topicsPanel = (page: Page) => page.getByRole('tabpanel', { name: 'Topics' });

scenario(
  'TOPIC-4.3: with Topics open, Work is read as if Work were open, once per source, and its PR members show Loading until the first read lands',
  world()
    .tbPr({ board: BOARD })
    .topics([{ title: 'Proposals rates', members: [pr('anvil', 2101, 'Sharpen the anvil corners'), pr('kettle', 2299, 'Merged last week')] }]),
  async ({ page, world }) => {
    // Nothing is read while no tab has Work or Topics open (WORK-8.1).
    await expect(sessionSidebar(page).getByText('No live Sessions')).toBeVisible();
    expect(world.tbPr.calls()).toEqual([]);
    world.tbPr.hold();
    await page.keyboard.press('t');
    await expect(page.getByRole('tab', { name: 'Topics' })).toHaveAttribute('aria-selected', 'true');
    expect(await world.step('Topics to ask for a Work read', () => world.tbPr.held())).toEqual(['list', '--json']);
    await topicsPanel(page).getByRole('button', { name: /^Proposals rates,/ }).click();
    // Its members are in its view (TOPIC-10).
    await topicsPanel(page).getByRole('button', { name: 'Open', exact: true }).click();
    const prs = page.getByTestId('topic-view').locator('[data-field="pr"]');
    await expect(prs).toHaveCount(2);
    await expect(prs.getByText('Loading…')).toHaveCount(2);
    world.tbPr.release();
    // The listed one shows Work's state and CI; the one the board doesn't have, its snapshot.
    await world.step('the read to land', () => expect(prs.nth(0)).toContainText('draft'));
    await expect(prs.nth(0).getByRole('img', { name: 'CI passing' })).toBeVisible();
    await expect(prs.nth(1)).toContainText('Merged last week');
    await expect(prs.nth(1).getByText('not in Work')).toBeVisible();
    // One read per source, shared with Work: opening Work too reads nothing more.
    await page.getByRole('tab', { name: 'Work' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Work' }).getByRole('option')).toHaveCount(1);
    expect(listCalls(world.tbPr.calls())).toHaveLength(1);
  },
);
