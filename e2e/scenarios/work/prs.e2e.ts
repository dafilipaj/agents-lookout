import type { Locator, Page } from '@playwright/test';
import { TB_PR_INSTALL_COMMAND } from '../../../shared/defaults.ts';
import { PR_REASON } from '../../../server/work.ts';
import type { TbPrBoardDecl } from '../../world/builder.ts';
import { expect, scenario, world } from '../../world/index.ts';

/**
 * WORK's PRs (slice B): the Work tab against the fake tb-pr (TEST-1.5). Invented repos, numbers and
 * titles. Mine sorts most urgent first: willow#2102 is stale, anvil#2101 fresh (WORK-3.1).
 */
const BOARD: TbPrBoardDecl = {
  columns: {
    draft_mine: [{ number: 2101, repo: 'anvil', title: 'Sharpen the anvil corners', check_state: 'success' }],
    ready_to_merge_mine: [{ number: 2102, repo: 'willow', title: 'Hang the willow lanterns', age_days: 6, rotting: 'stale' }],
    waiting_on_me: [{ number: 2106, repo: 'willow', title: 'Count the willow leaves' }],
  },
};
const REVIEW_URL = 'https://github.com/productiveio/willow/pull/2106';
const MINE_URL = 'https://github.com/productiveio/anvil/pull/2101';
/** Each row's name, as a screen reader hears it: its content (WORK-3.2). */
const NAME = {
  stale: 'willow #2102 approved no CI 6d Hang the willow lanterns',
  fresh: 'anvil #2101 draft CI passing 1d Sharpen the anvil corners',
  review: 'teammate willow #2106 no CI 1d Count the willow leaves',
};

const work = (page: Page) => page.getByRole('tabpanel', { name: 'Work' });
const prRow = (page: Page, name: string) => work(page).getByRole('option', { name, exact: true });
const sessionSidebar = (page: Page) => page.getByRole('complementary', { name: 'Session sidebar' });

/** Opens Work with `W` once Lookout has listed Sessions, so focus isn't in a text field. */
async function openWork(page: Page) {
  await expect(sessionSidebar(page).getByText('No live Sessions')).toBeVisible();
  await page.keyboard.press('w');
  await expect(page.getByRole('tab', { name: 'Work' })).toHaveAttribute('aria-selected', 'true');
}

/** WORK-1.12: a row's buttons show once a click has expanded it. */
async function expand(row: Locator) {
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
}

const listCalls = (calls: string[][]) => calls.filter((c) => c.join(' ') === 'list --json');

scenario(
  'WORK-3.2: each PR shows its repo, number, title, age and CI from tb-pr, Mine with its state chip, Review requests apart',
  world().tbPr({ board: BOARD }),
  async ({ page, world }) => {
    // Nothing is read until a tab has Work open (WORK-8.1).
    await expect(sessionSidebar(page).getByText('No live Sessions')).toBeVisible();
    expect(world.tbPr.calls()).toEqual([]);
    await openWork(page);
    const mine = work(page).getByRole('group', { name: 'Mine' });
    await world.step('the PRs to show', () => expect(mine.getByRole('option')).toHaveCount(2));
    await expect(mine.getByRole('option')).toHaveText([/willow\s*#2102.*approved.*no CI.*6d.*Hang the willow lanterns/, /anvil\s*#2101.*draft.*1d.*Sharpen the anvil corners/]);
    await expect(prRow(page, NAME.fresh).getByRole('img', { name: 'CI passing' })).toBeVisible();
    const review = work(page).getByRole('group', { name: 'Review requests' });
    await expect(review.getByRole('option')).toHaveText([/willow\s*#2106.*no CI.*Count the willow leaves/]);
    // A screen reader hears each row's CI, chip and age in its name, and the keys that act on it.
    await expect(mine.getByRole('option').nth(0)).toHaveAccessibleName(NAME.stale);
    await expect(mine.getByRole('option').nth(1)).toHaveAccessibleName(NAME.fresh);
    await expect(review.getByRole('option')).toHaveAccessibleName(NAME.review);
    await expect(review.getByRole('option')).toHaveAccessibleDescription('Enter shows its details. R reviews it, O opens it on GitHub.');
    // One listbox holds both groups (UX, "Markers and buttons").
    await expect(work(page).getByRole('listbox')).toHaveCount(1);
    await expect(work(page).getByRole('region', { name: 'PRs' })).toContainText(/PRs\s*·\s*3 open\s*·\s*updated \d+s ago/);
    expect(listCalls(world.tbPr.calls())).toHaveLength(1);
  },
);

/** The launcher a Review opened: its prompt, and Claude Code as its Harness, whatever was started last. */
async function expectReviewLauncher(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'New Session' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Prompt')).toHaveValue(`/p-codex:dual-review ${REVIEW_URL}`);
  await expect(dialog.getByRole('radio', { name: /Claude Code/ })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /Codex/ })).not.toBeChecked();
  return dialog;
}

/** Codex was started last: Review still opens the launcher on Claude Code. */
const CODEX_LAST = { lastLaunch: { harness: 'codex', model: '', directory: '~/Projects/work' } } as const;

scenario(
  'WORK-5.2: Review on a Review request opens the launcher with /p-codex:dual-review and the PR URL, on Claude Code though Codex was started last, and nothing starts',
  world().tbPr({ board: BOARD }).settings(CODEX_LAST),
  async ({ page, world }) => {
    await openWork(page);
    const row = prRow(page, NAME.review);
    await world.step('the Review request to show', () => expect(row).toBeVisible());
    await expand(row);
    await row.getByTitle('Review (R)').click();
    const dialog = await expectReviewLauncher(page);
    // It can be edited before Start, and nothing started: no "Starting…" row, nothing asked of Fleet.
    await dialog.getByLabel('Prompt').fill(`/p-codex:dual-review ${REVIEW_URL} please`);
    await expect(dialog.getByLabel('Prompt')).toHaveValue(`/p-codex:dual-review ${REVIEW_URL} please`);
    await expect(sessionSidebar(page).getByText('Starting…')).toHaveCount(0);
    expect(world.calls().filter((c) => /\bfleet\b.*\bspawn\b/.test(c))).toEqual([]);
  },
);

scenario(
  'WORK-5.2: R on the selected Review request opens the launcher as Review does, on Claude Code though Codex was started last; on a PR of yours it does nothing',
  world().tbPr({ board: BOARD }).settings(CODEX_LAST),
  async ({ page, world }) => {
    await openWork(page);
    await world.step('the PRs to show', () => expect(work(page).getByRole('option')).toHaveCount(3));
    const selected = work(page).locator('[role="option"][aria-selected="true"]');
    await expect(selected).toHaveAccessibleName(NAME.stale);
    await page.keyboard.press('r');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await expect(selected).toHaveAccessibleName(NAME.review);
    await page.keyboard.press('r');
    await expectReviewLauncher(page);
    await expect(sessionSidebar(page).getByText('Starting…')).toHaveCount(0);
    expect(world.calls().filter((c) => /\bfleet\b.*\bspawn\b/.test(c))).toEqual([]);
  },
);

scenario(
  'WORK-6.3: Open on GitHub opens the PR’s URL from tb-pr in a new browser tab',
  world().tbPr({ board: BOARD }),
  async ({ page, world }) => {
    await openWork(page);
    const row = prRow(page, NAME.fresh);
    await world.step('the PR to show', () => expect(row).toBeVisible());
    await expand(row);
    const tab = page.context().waitForEvent('page');
    await row.getByTitle('Open on GitHub (O)').click();
    expect(await tab).not.toBe(page);
    await world.waitUntil('the new tab to ask for the PR', () => world.browserRequests().includes(MINE_URL));
    expect(world.browserRequests()).toEqual([MINE_URL]);
  },
);

scenario(
  'WORK-3.6: an expanded PR shows its repo, number, age, CI and state chip, and its buttons; an expanded Review request has no chip, and Review comes before Open on GitHub',
  world().tbPr({ board: BOARD }).settings(CODEX_LAST),
  async ({ page, world }) => {
    await openWork(page);
    const mine = prRow(page, NAME.fresh);
    await world.step('the PRs to show', () => expect(mine).toBeVisible());
    await expand(mine);
    await expect(mine.locator('[data-field="repo"]')).toHaveText('anvil');
    await expect(mine.locator('[data-field="number"]')).toHaveText('#2101');
    await expect(mine.locator('[data-field="age"]')).toHaveText('1d');
    await expect(mine.locator('[data-field="ci"]')).toHaveAttribute('data-ci', 'passing');
    await expect(mine.locator('[data-field="chip"]')).toHaveText('draft');
    expect(await mine.locator('[data-field="actions"] [role="button"]').allTextContents()).toEqual(['Open on GitHub']);
    // The name stays the row's content; the details are its description.
    await expect(mine).toHaveAccessibleName(NAME.fresh);
    const review = prRow(page, NAME.review);
    await expand(review);
    await expect(mine).toHaveAttribute('aria-expanded', 'false');
    await expect(review.locator('[data-field="chip"]')).toHaveCount(0);
    expect(await review.locator('[data-field="actions"] [role="button"]').allTextContents()).toEqual(['Review', 'Open on GitHub']);
    // Enter on the expanded Review request runs its first button, Review.
    await page.keyboard.press('Enter');
    await expectReviewLauncher(page);
    expect(world.calls().filter((c) => /\bfleet\b.*\bspawn\b/.test(c))).toEqual([]);
  },
);

scenario(
  'WORK-6.4: O opens the selected row in a new tab, as its button does, moving nothing and opening no launcher',
  world().tbPr({ board: BOARD }),
  async ({ page, world }) => {
    await openWork(page);
    await world.step('the PRs to show', () => expect(work(page).getByRole('option')).toHaveCount(3));
    const selected = work(page).locator('[role="option"][aria-selected="true"]');
    await expect(selected).toHaveAccessibleName(NAME.stale);
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await expect(selected).toHaveAccessibleName(NAME.review);
    const path = new URL(page.url()).pathname;
    const tab = page.context().waitForEvent('page');
    await page.keyboard.press('o');
    await tab;
    await world.waitUntil('the new tab to ask for the Review request', () => world.browserRequests().includes(REVIEW_URL));
    expect(world.browserRequests()).toEqual([REVIEW_URL]);
    await expect(selected).toHaveAccessibleName(NAME.review);
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  },
);

scenario(
  'WORK-7.1: without tb-pr, the PRs section says it isn’t installed and how to install it',
  world(),
  async ({ page, world }) => {
    await openWork(page);
    const alert = work(page).getByRole('region', { name: 'PRs' }).getByRole('alert');
    await world.step('the PRs section to say tb-pr isn’t installed', () => expect(alert).toContainText("tb-pr isn't installed"));
    await expect(alert).toContainText(TB_PR_INSTALL_COMMAND);
    await expect(work(page).getByText('No open PRs or review requests')).toHaveCount(0);
  },
);

scenario(
  'WORK-7.2: with tb-pr not signed in to GitHub, the PRs section says so once and shows gh auth login',
  world().tbPr({ board: BOARD, failure: 'gh-auth' }),
  async ({ page, world }) => {
    await openWork(page);
    const alert = work(page).getByRole('region', { name: 'PRs' }).getByRole('alert');
    await world.step('the PRs section to say tb-pr isn’t signed in', () => expect(alert).toContainText("tb-pr isn't signed in to GitHub"));
    await expect(alert.getByText('gh auth login', { exact: true })).toBeVisible();
    expect((await alert.textContent())?.match(/signed in/g)).toHaveLength(1);
    // tb-pr's own words stay in the server's log.
    await expect(alert).not.toContainText('gh auth token');
  },
);

scenario(
  'WORK-7.3: after a good read, a failed Refresh keeps the PRs shown, marked old, with the reason in plain words',
  world().tbPr({ board: BOARD }),
  async ({ page, world }) => {
    await openWork(page);
    const section = work(page).getByRole('region', { name: 'PRs' });
    await world.step('the PRs to show', () => expect(work(page).getByRole('option')).toHaveCount(3));
    await expect(section.getByText('old', { exact: true })).toHaveCount(0);
    world.tbPr.answer({ board: BOARD, refreshExit: 1 });
    await page.getByRole('button', { name: 'Refresh' }).click();
    const alert = section.getByRole('alert');
    await world.step('the PRs section to say the read failed', () => expect(alert).toContainText("Couldn't update PRs"));
    await expect(alert).toContainText(PR_REASON.failed);
    await expect(alert).toContainText(/Showing the last list, from \d+s ago\./);
    await expect(section.getByText('old', { exact: true })).toBeVisible();
    await expect(work(page).getByRole('option')).toHaveCount(3);
    // What tb-pr said is in the server's log, never on the page.
    await expect(page.locator('body')).not.toContainText('the World declared exit 1');
    expect(world.serverLog()).toContain('lookout: tb-pr: refresh failed (the World declared exit 1)');
    // The refresh failed, so no list followed it (WORK-8.2).
    expect(world.tbPr.calls().map((c) => c.join(' '))).toEqual(['list --json', 'refresh']);
  },
);

scenario(
  'WORK-7.3: a board with a PR Lookout can’t read is a failed read, never “No open PRs”',
  world().tbPr({ board: { columns: { draft_mine: [{ number: 2101, repo: 'anvil', title: 'Sharpen the anvil corners', url: '' }] } } }),
  async ({ page, world }) => {
    await openWork(page);
    const alert = work(page).getByRole('region', { name: 'PRs' }).getByRole('alert');
    await world.step('the PRs section to say it couldn’t read the PRs', () => expect(alert).toContainText("Couldn't read PRs"));
    await expect(alert).toContainText(PR_REASON.unreadable);
    await expect(work(page).getByText('No open PRs or review requests')).toHaveCount(0);
    await expect(work(page).getByRole('option')).toHaveCount(0);
  },
);

scenario(
  'WORK-7.5: a group whose tb-pr column has an issue is marked possibly out of date, in plain words',
  world().tbPr({
    board: {
      ...BOARD,
      column_issues: [{ column: 'waiting_on_me', reason: 'rate limited', restored_from: new Date(Date.now() - 20 * 60_000).toISOString() }],
    },
  }),
  async ({ page, world }) => {
    await openWork(page);
    const review = work(page).getByRole('group', { name: 'Review requests' });
    await world.step('the mark to show', () => expect(review).toHaveAccessibleDescription("Possibly out of date. GitHub's rate limit is used up, not confirmed yet."));
    await expect(work(page).getByRole('group', { name: 'Mine' })).toHaveAccessibleDescription('');
    await expect(work(page)).not.toContainText('rate limited');
  },
);

scenario(
  'WORK-8.2: Refresh runs tb-pr refresh then list, and is disabled in every tab for a minute, saying when it’s back',
  world().tbPr({ board: BOARD }),
  async ({ page, world }) => {
    await openWork(page);
    await world.step('the PRs to show', () => expect(work(page).getByRole('option')).toHaveCount(3));
    // A second tab, with Work open too (the layout is this browser's).
    const second = await page.context().newPage();
    await second.goto(world.url);
    await expect(second.getByRole('tab', { name: 'Work' })).toHaveAttribute('aria-selected', 'true');
    const refresh = (p: Page) => p.getByRole('button', { name: 'Refresh' });
    await expect(refresh(second)).not.toHaveAttribute('aria-disabled', 'true');
    await refresh(page).click();
    for (const p of [page, second]) {
      await world.step('Refresh to be disabled in both tabs', () => expect(refresh(p)).toHaveAttribute('aria-disabled', 'true'));
      await expect(refresh(p)).toHaveAttribute('title', /^Refresh was used less than a minute ago: it's back in \d+s$/);
    }
    await world.waitUntil('the forced read to end', () => world.tbPr.calls().length >= 3);
    expect(world.tbPr.calls().map((c) => c.join(' '))).toEqual(['list --json', 'refresh', 'list --json']);
    // A press during the cooldown asks nothing of tb-pr.
    await refresh(second).click({ force: true });
    await expect(refresh(second)).toHaveAttribute('aria-disabled', 'true');
    expect(world.tbPr.calls()).toHaveLength(3);
  },
);

scenario(
  'WORK-8.5: two tabs opening Work at the same moment in a fresh World run tb-pr once',
  world().tbPr({ board: BOARD }),
  async ({ page, world }) => {
    const second = await page.context().newPage();
    await second.goto(world.url);
    await expect(sessionSidebar(second).getByText('No live Sessions')).toBeVisible();
    world.tbPr.hold();
    await openWork(page);
    expect(await world.tbPr.held()).toEqual(['list', '--json']);
    // The second tab opens Work while the first tab's read is in flight.
    const watched = second.waitForResponse((r) => r.url().endsWith('/api/work/watch') && r.request().postDataJSON()?.open === true);
    await second.keyboard.press('w');
    expect((await watched).status()).toBe(200);
    world.tbPr.release();
    for (const p of [page, second]) await world.step('the PRs to show in both tabs', () => expect(work(p).getByRole('option')).toHaveCount(3));
    expect(world.tbPr.calls()).toEqual([['list', '--json']]);
  },
);

scenario(
  'WORK-1.6: switching the filter shows the PRs at once and starts no read',
  world().tbPr({ board: BOARD }),
  async ({ page, world }) => {
    await openWork(page);
    await world.step('the PRs to show', () => expect(work(page).getByRole('option')).toHaveCount(3));
    await work(page).getByRole('button', { name: 'PRs', exact: true }).click();
    await expect(work(page).getByRole('option')).toHaveCount(3);
    await work(page).getByRole('button', { name: 'All' }).click();
    await expect(work(page).getByRole('option')).toHaveCount(3);
    expect(world.tbPr.calls()).toEqual([['list', '--json']]);
  },
);
