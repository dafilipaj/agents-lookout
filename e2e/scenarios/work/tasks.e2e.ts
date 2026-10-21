import { request } from 'node:http';
import type { Page, Request } from '@playwright/test';
import type { WorkSnapshot } from '../../../shared/work.ts';
import { TB_PROD_INSTALL_COMMAND } from '../../../shared/defaults.ts';
import { TASK_REASON, tasksQueryArgv } from '../../../server/work.ts';
import type { TaskDecl, TbPrBoardDecl } from '../../world/builder.ts';
import { type RunningWorld, expect, scenario, world } from '../../world/index.ts';

/**
 * WORK's Tasks (slice C): the Work tab against the fake tb-prod (TEST-1.5), next to the fake tb-pr.
 * Invented projects, Tasks and people.
 */
const ME = 'lamplighter@example.com';
const OTHER = 'keeper@example.com';
const BOARD: TbPrBoardDecl = {
  columns: {
    draft_mine: [{ number: 2101, repo: 'anvil', title: 'Sharpen the anvil corners', check_state: 'success' }],
    ready_to_merge_mine: [{ number: 2102, repo: 'willow', title: 'Hang the willow lanterns', age_days: 6, rotting: 'stale' }],
    waiting_on_me: [{ number: 2106, repo: 'willow', title: 'Count the willow leaves' }],
  },
};
/** 23 open Tasks: two pages of tb-prod's 20. */
const TASKS: TaskDecl[] = Array.from({ length: 23 }, (_, i) => ({
  id: String(41_000_100 + i),
  title: `Light lantern ${i + 1}`,
  project: i % 2 ? 'Harbor Bells' : 'Lantern Works',
  lastActivityAt: `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
}));
/** A few Tasks of every kind a row shows (WORK-2.2), declared out of order: tb-prod sorts them. */
const YEAR = new Date().getFullYear();
const MINE: TaskDecl[] = [
  { id: '41000301', title: 'Trim the lamp wicks', project: 'Lantern Works', lastActivityAt: '2026-10-12T09:00:00Z' },
  { id: '41000302', title: 'Ship the harbor bells', project: 'Harbor Bells', status: 'Not started', statusCategory: 1, milestone: true, dueDate: `${YEAR}-11-04`, lastActivityAt: '2026-10-18T09:00:00Z' },
  { id: '41000303', title: 'Paint the pier posts', project: 'Lantern Works', status: 'In review', dueDate: `${YEAR}-12-01`, lastActivityAt: '2026-10-15T09:00:00Z' },
];
/** Each row's name, as a screen reader hears it: its content (WORK-2.2), most recently active first. */
const NAMES = [
  'Ship the harbor bells Harbor Bells Not started milestone due Nov 4',
  'Paint the pier posts Lantern Works In review due Dec 1',
  'Trim the lamp wicks Lantern Works In progress',
];
const THEIRS: TaskDecl[] = [{ id: '41000401', title: 'Wind the clock tower', project: 'Harbor Bells', lastActivityAt: '2026-10-19T09:00:00Z' }];
const taskUrl = (id: string) => `https://app.fantastic.productive.io/109-productive/tasks/${id}`;

const work = (page: Page) => page.getByRole('tabpanel', { name: 'Work' });
const tasksSection = (page: Page) => work(page).getByRole('region', { name: 'Tasks' });
const taskRows = (page: Page) => work(page).getByRole('listbox', { name: 'Tasks' }).getByRole('option');
const prRows = (page: Page) => work(page).getByRole('listbox', { name: 'PRs' }).getByRole('option');
const sessionSidebar = (page: Page) => page.getByRole('complementary', { name: 'Session sidebar' });
const emailField = (page: Page) => page.getByLabel('Productive email');
const saveEmail = (page: Page) => page.locator('form', { has: emailField(page) }).getByRole('button', { name: 'Save' });

/** Opens Work with `W` once Lookout has listed Sessions, so focus isn't in a text field. */
async function openWork(page: Page) {
  await expect(sessionSidebar(page).getByText('No live Sessions')).toBeVisible();
  await page.keyboard.press('w');
  await expect(page.getByRole('tab', { name: 'Work' })).toHaveAttribute('aria-selected', 'true');
}

/** Saves a Productive email on the Settings page, opened from the Session sidebar; Work stays as it is. */
async function saveProductiveEmail(page: Page, email: string) {
  await sessionSidebar(page).getByRole('button', { name: 'Settings' }).click();
  await emailField(page).fill(email);
  await saveEmail(page).click();
  await expect(page.locator('form', { has: emailField(page) }).getByRole('status')).toHaveText('Saved');
}

/**
 * The server's Work, as the first event of a new event stream carries it (its `snapshot`). The stream
 * opens no Work, so it starts no read.
 */
function serverWork(w: RunningWorld): Promise<WorkSnapshot> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: w.port, path: '/api/events', headers: { host: `127.0.0.1:${w.port}` } }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buf += chunk;
        const block = buf.split('\n\n').find((b) => b.startsWith('data: '));
        if (block === undefined) return;
        req.destroy();
        const event = JSON.parse(block.slice('data: '.length)) as { type: string; work?: WorkSnapshot };
        if (event.type === 'snapshot' && event.work) resolve(event.work);
        else reject(new Error(`the event stream began with ${event.type}`));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/** The settings as the server sends them to the page (WORK-2.5). */
const serverSettings = (page: Page) => page.evaluate(async () => (await fetch('/api/settings')).json() as Promise<{ productiveEmail: string | null; productiveEmailSuggestion: string | null }>);

const tasksRead = (w: RunningWorld) => w.waitUntil('the Tasks read to end', async () => (await serverWork(w)).tasks.state === 'ok');

scenario(
  'WORK-4.9: each Tasks or PRs read searches tb-session with --limit 200 for every current item',
  world().tbProd({ tasks: { [ME]: MINE.slice(0, 1) } }).tbPr({ board: { columns: { draft_mine: [BOARD.columns!.draft_mine![0]!] } } }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    await openWork(page);
    await world.step('the Task and PR to show', async () => {
      await expect(taskRows(page)).toHaveCount(1);
      await expect(prRows(page)).toHaveCount(1);
    });
    const linkSearches = () => world.calls().filter((call) => /\btb-session search\b/.test(call));
    const finished = () => world.calls().filter((call) => /\btb-session-finished 0\b/.test(call));
    await world.waitUntil('the three Link searches to end', () => linkSearches().length === 3 && finished().length === 3);
    expect(linkSearches()).toHaveLength(3);
    expect(linkSearches().every((call) => /--limit 200/.test(call))).toBe(true);

    await page.getByRole('button', { name: 'Refresh' }).click();
    await world.waitUntil('Refresh and its three more Link searches to end', () => world.tbProd.calls().length === 2 && world.tbPr.calls().length === 3 && linkSearches().length === 6 && finished().length === 6);
    expect(linkSearches()).toHaveLength(6);
    expect(linkSearches().every((call) => /--limit 200/.test(call))).toBe(true);
  },
);

const fleetRow = (id: string, title: string, cwd: string) => ({
  pid: 43000 + id.length, session_id: id, cwd, status: 'idle' as const, waiting_for: null, updated_at: Date.now(),
  backend: 'tmux' as const, tmux_session: id, display_title: title, context: null, harness: 'claude' as const, model: null,
});
const indexed = (id: string, prompt: string, createdAt: string, modifiedAt: string, cwd: string) => ({
  session_id: id, harness: 'claude', summary: id, first_prompt: prompt, created_at: createdAt, modified_at: modifiedAt, project_path: cwd,
});
const WICKS = taskUrl('41000301');

scenario(
  'WORK-2.4: a Task with a live Linked Session shows a live marker, and a click selects the live one with the latest activity, a tie going to the later-created',
  world().tbProd({ tasks: { [ME]: MINE.slice(0, 1) } }).tbPr({ board: { columns: {} } }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    // A past Session is the most recent of all; a live one still wins. Two live ones tie on activity.
    world.tbSession.indexSession(indexed('00000000-0000-4000-8000-0000000000a1', `Start ${WICKS}`, '2026-10-20T10:00:00Z', '2026-10-21T09:00:00Z', world.home));
    world.tbSession.indexSession(indexed('00000000-0000-4000-8000-0000000000a2', `Start ${WICKS}`, '2026-10-19T10:00:00Z', '2026-10-20T12:00:00Z', world.home));
    world.tbSession.indexSession(indexed('00000000-0000-4000-8000-0000000000a3', `Start ${WICKS}`, '2026-10-19T11:00:00Z', '2026-10-20T12:00:00Z', world.home));
    world.fleet.gainSession(fleetRow('00000000-0000-4000-8000-0000000000a2', 'Wicks old', world.home));
    world.fleet.gainSession(fleetRow('00000000-0000-4000-8000-0000000000a3', 'Wicks new', world.home));
    await expect(sessionSidebar(page).getByText('Wicks new')).toBeVisible();
    await page.keyboard.press('w');
    await expect(page.getByRole('tab', { name: 'Work' })).toHaveAttribute('aria-selected', 'true');
    const row = taskRows(page).filter({ hasText: 'Trim the lamp wicks' });
    await expect(row.locator('[data-session-marker] svg')).toHaveClass(/text-ok-text/);
    await row.locator('[data-session-marker]').click();
    await expect(page).toHaveURL(/\/s\/00000000-0000-4000-8000-0000000000a3$/);
    expect(world.calls().filter((call) => /\bspawn\b/.test(call))).toEqual([]);
  },
);

scenario(
  'WORK-2.4: with no live Linked Session the marker is past, and a click resumes the one with the latest activity',
  world().tbProd({ tasks: { [ME]: MINE.slice(0, 1) } }).tbPr({ board: { columns: {} } }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    world.tbSession.indexSession(indexed('00000000-0000-4000-8000-0000000000b1', `Start ${WICKS}`, '2026-10-20T10:00:00Z', '2026-10-20T11:00:00Z', world.home));
    world.tbSession.indexSession(indexed('00000000-0000-4000-8000-0000000000b2', `Start ${WICKS}`, '2026-10-19T10:00:00Z', '2026-10-20T12:00:00Z', world.home));
    await openWork(page);
    const row = taskRows(page).filter({ hasText: 'Trim the lamp wicks' });
    await expect(row.locator('[data-session-marker] svg')).toHaveClass(/text-muted-foreground/);
    await row.click();
    await world.waitUntil('Fleet to be asked to resume the latest past Session', () => world.calls().some((call) => /\bspawn --resume 00000000-0000-4000-8000-0000000000b2\b/.test(call)));
    expect(world.calls().filter((call) => /\bspawn --resume 00000000-0000-4000-8000-0000000000b1\b/.test(call))).toEqual([]);
  },
);

const ANVIL_PR = 'https://github.com/productiveio/anvil/pull/2101';
const ANVIL_BOARD: TbPrBoardDecl = {
  columns: { draft_mine: [{ number: 2101, repo: 'anvil', title: 'Sharpen the anvil corners', check_state: 'success', task_ids: [{ id: '41000301', source: 'body' }] }] },
};

scenario(
  'WORK-3.4: a PR shows its Linked Task, and its marker and click act as a Task’s do: a live Linked Session is selected over a more recent past one',
  world().tbProd({ tasks: { [ME]: MINE.slice(0, 1) } }).tbPr({ board: ANVIL_BOARD }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    world.tbSession.indexSession(indexed('00000000-0000-4000-8000-0000000000c1', `Review ${ANVIL_PR}`, '2026-10-20T10:00:00Z', '2026-10-21T09:00:00Z', world.home));
    world.tbSession.indexSession(indexed('00000000-0000-4000-8000-0000000000c2', `Review ${ANVIL_PR}`, '2026-10-19T10:00:00Z', '2026-10-20T12:00:00Z', world.home));
    world.fleet.gainSession(fleetRow('00000000-0000-4000-8000-0000000000c2', 'Anvil review', world.home));
    await expect(sessionSidebar(page).getByText('Anvil review')).toBeVisible();
    await page.keyboard.press('w');
    await expect(page.getByRole('tab', { name: 'Work' })).toHaveAttribute('aria-selected', 'true');
    const row = prRows(page).filter({ hasText: 'Sharpen the anvil corners' });
    await expect(row.locator('[data-field="linked-task"]')).toContainText('Trim the lamp wicks');
    await expect(row.locator('[data-session-marker] svg')).toHaveClass(/text-ok-text/);
    await row.click();
    await expect(page).toHaveURL(/\/s\/00000000-0000-4000-8000-0000000000c2$/);
    expect(world.calls().filter((call) => /\bspawn\b/.test(call))).toEqual([]);
  },
);

scenario(
  'WORK-3.4: a PR with only past Linked Sessions shows a past marker, and a click resumes the one with the latest activity',
  world().tbProd({ tasks: { [ME]: MINE.slice(0, 1) } }).tbPr({ board: ANVIL_BOARD }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    world.tbSession.indexSession(indexed('00000000-0000-4000-8000-0000000000d1', `Review ${ANVIL_PR}`, '2026-10-20T10:00:00Z', '2026-10-20T11:00:00Z', world.home));
    world.tbSession.indexSession(indexed('00000000-0000-4000-8000-0000000000d2', `Review ${ANVIL_PR}`, '2026-10-19T10:00:00Z', '2026-10-20T12:00:00Z', world.home));
    await openWork(page);
    const row = prRows(page).filter({ hasText: 'Sharpen the anvil corners' });
    await expect(row.locator('[data-session-marker] svg')).toHaveClass(/text-muted-foreground/);
    await row.click();
    await world.waitUntil('Fleet to be asked to resume the latest past Session', () => world.calls().some((call) => /\bspawn --resume 00000000-0000-4000-8000-0000000000d2\b/.test(call)));
    expect(world.calls().filter((call) => /\bspawn --resume 00000000-0000-4000-8000-0000000000d1\b/.test(call))).toEqual([]);
  },
);

scenario(
  'WORK-4.9: a newly listed Session links after tb-session indexes its Task prompt',
  world().tbProd({ tasks: { [ME]: MINE.slice(0, 1) } }).tbPr({ board: { columns: { draft_mine: [BOARD.columns!.draft_mine![0]!] } } }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    world.tbSession.indexSession({
      session_id: 'older-task-session', harness: 'claude', summary: 'Earlier lamp work',
      first_prompt: `Start ${taskUrl('41000301')}`,
      created_at: '2026-10-20T10:00:00Z', modified_at: '2026-10-20T11:00:00Z',
    });
    await openWork(page);
    const taskRow = taskRows(page).filter({ hasText: 'Trim the lamp wicks' });
    await expect(taskRow).toHaveCount(1);
    // A past marker proves the initial searches have returned before Fleet gains a Session.
    await expect(taskRow.locator('[data-session-marker] svg')).toHaveClass(/text-muted-foreground/);
    const linkSearches = () => world.calls().filter((call) => /\btb-session search\b/.test(call));
    const finished = () => world.calls().filter((call) => /\btb-session-finished 0\b/.test(call));
    await world.waitUntil('the initial Link searches to finish', () => linkSearches().length === 3 && finished().length === 3);

    world.fleet.gainSession({
      pid: 42321,
      session_id: 'work-link-task-session',
      cwd: world.home,
      status: 'idle',
      waiting_for: null,
      updated_at: Date.now(),
      backend: 'tmux',
      tmux_session: 'work-link-task-session',
      display_title: 'Task link session',
      context: null,
      harness: 'claude',
      model: null,
    });
    await expect(sessionSidebar(page).getByText('Task link session')).toBeVisible();
    const fleetObservedAt = Date.now();

    await world.waitUntil('Fleet to finish fresh Link searches', () => linkSearches().length >= 6 && finished().length >= 6);
    await expect(taskRow.locator('[data-session-marker] svg')).toHaveClass(/text-muted-foreground/);
    world.tbSession.indexSession({
      session_id: 'work-link-task-session',
      harness: 'claude',
      summary: 'Trim the lamp wicks',
      first_prompt: `Start ${taskUrl('41000301')}`,
      created_at: new Date(fleetObservedAt - 60_000).toISOString(),
      modified_at: new Date(fleetObservedAt).toISOString(),
    });

    await world.step('the Task Link to appear within 10 s of Fleet listing its Session', async () => {
      await expect(taskRow.locator('[data-session-marker] svg')).toHaveClass(/text-ok-text/, { timeout: Math.max(1, 10_000 - (Date.now() - fleetObservedAt)) });
    });
    expect(Date.now() - fleetObservedAt).toBeLessThanOrEqual(10_000);
    await expect(taskRow.locator('[data-session-marker]')).toHaveAttribute('title', 'started on this Task');
  },
);

scenario(
  'WORK-7.4: without tb-session, Tasks and PRs remain visible without Session markers and Work explains why',
  world().without('tb-session').tbProd({ tasks: { [ME]: MINE.slice(0, 1) } }).tbPr({ board: { columns: { draft_mine: [BOARD.columns!.draft_mine![0]!] } } }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    await openWork(page);
    await world.step('both Work lists to show', async () => {
      await expect(taskRows(page)).toHaveCount(1);
      await expect(prRows(page)).toHaveCount(1);
    });
    await expect(work(page).locator('[data-field="session-link-problem"]')).toContainText("tb-session isn't installed");
    await expect(work(page).locator('[data-session-marker]')).toHaveCount(0);
  },
);

scenario(
  'WORK-8.5: two tabs opening Work at the same moment in a fresh World run tb-prod once per page of Tasks',
  world().tbProd({ tasks: { [ME]: TASKS } }).tbPr({ board: BOARD }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    const second = await page.context().newPage();
    await second.goto(world.url);
    await expect(sessionSidebar(second).getByText('No live Sessions')).toBeVisible();
    // Nothing is read until a tab has Work open (WORK-8.1).
    expect(world.tbProd.calls()).toEqual([]);
    world.tbProd.hold();
    await openWork(page);
    expect(await world.tbProd.held()).toEqual(tasksQueryArgv(ME, 1));
    // The second tab opens Work while the first tab's Tasks read is in flight.
    const watched = second.waitForResponse((r) => r.url().endsWith('/api/work/watch') && r.request().postDataJSON()?.open === true);
    await second.keyboard.press('w');
    expect((await watched).status()).toBe(200);
    world.tbProd.release();
    await tasksRead(world);
    const read = (await serverWork(world)).tasks;
    expect(read.tasks).toHaveLength(23);
    expect(read.tasks[0]).toMatchObject({ title: 'Light lantern 23', url: taskUrl('41000122') });
    // Once per page: 23 Tasks are two pages of 20.
    expect(world.tbProd.calls()).toEqual([tasksQueryArgv(ME, 1), tasksQueryArgv(ME, 2)]);
    for (const p of [page, second]) {
      await world.step('the Tasks and PRs to show in both tabs', async () => {
        await expect(taskRows(p)).toHaveCount(23);
        await expect(prRows(p)).toHaveCount(3);
      });
    }
    expect(world.tbPr.calls()).toEqual([['list', '--json']]);
  },
);

scenario(
  'WORK-8.2: Refresh reads Tasks from Productive too, once, beside tb-pr refresh and list',
  world().tbProd({ tasks: { [ME]: TASKS.slice(0, 3) } }).tbPr({ board: BOARD }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    await openWork(page);
    await world.step('the PRs to show', () => expect(prRows(page)).toHaveCount(3));
    await tasksRead(world);
    const opened = (await serverWork(world)).tasks.fetchedAt!;
    // 20 Tasks or fewer: one page, one call (WORK-8.5).
    expect(world.tbProd.calls()).toEqual([tasksQueryArgv(ME, 1)]);
    const refresh = page.getByRole('button', { name: 'Refresh' });
    await refresh.click();
    await world.step('Refresh to be disabled', () => expect(refresh).toHaveAttribute('aria-disabled', 'true'));
    await world.waitUntil('the forced reads to end', async () => world.tbPr.calls().length >= 3 && (await serverWork(world)).tasks.fetchedAt! > opened);
    expect(world.tbProd.calls()).toEqual([tasksQueryArgv(ME, 1), tasksQueryArgv(ME, 1)]);
    expect(world.tbPr.calls().map((c) => c.join(' '))).toEqual(['list --json', 'refresh', 'list --json']);
    // A press during the cooldown asks nothing of either.
    await refresh.click({ force: true });
    await expect(refresh).toHaveAttribute('aria-disabled', 'true');
    expect(world.tbProd.calls()).toHaveLength(2);
    expect(world.tbPr.calls()).toHaveLength(3);
  },
);

scenario(
  'WORK-2.2: each Task shows its title, project, status, due date and milestone from tb-prod, most recently active first, above the PRs',
  world().tbProd({ tasks: { [ME]: MINE, [OTHER]: THEIRS } }).tbPr({ board: BOARD }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    await openWork(page);
    await world.step('the Tasks to show', () => expect(taskRows(page)).toHaveCount(3));
    for (const [i, name] of NAMES.entries()) await expect(taskRows(page).nth(i)).toHaveAccessibleName(name);
    await expect(taskRows(page).nth(0)).toHaveAccessibleDescription('S starts a Session on it, O opens it in Fantastic.');
    await expect(tasksSection(page)).toContainText(/Tasks\s*·\s*3 open\s*·\s*updated \d+s ago/);
    // Only the saved email's Tasks.
    await expect(work(page)).not.toContainText('Wind the clock tower');
    // Tasks first, then PRs (UX).
    await expect(work(page).getByRole('region')).toHaveCount(2);
    await expect(work(page).getByRole('region').first()).toHaveAccessibleName('Tasks');
    expect(world.tbProd.calls()).toEqual([tasksQueryArgv(ME, 1)]);
  },
);

scenario(
  'WORK-1.6: switching the filter shows the hidden section’s latest data at once and starts no read; a hidden section is read like a shown one',
  world().tbProd({ tasks: { [ME]: MINE.slice(0, 1) } }).tbPr({ board: BOARD }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    await openWork(page);
    await world.step('the Tasks and PRs to show', async () => {
      await expect(taskRows(page)).toHaveCount(1);
      await expect(prRows(page)).toHaveCount(3);
    });
    // What the page asks the server about Work from here on: only the Refresh below. The page sends
    // a watch only when it differs from the last one the server took, so a switch that closed the
    // watch and opened it again shows here, but one that said the same watch again sends nothing:
    // the component test's count of watch calls catches that (WORK-1.6 support).
    const asked: string[] = [];
    const record = (r: Request) => {
      const { pathname } = new URL(r.url());
      if (pathname.startsWith('/api/work/')) asked.push(`${r.method()} ${pathname}`);
    };
    page.on('request', record);
    const choice = (name: string) => work(page).getByRole('group', { name: 'Show' }).getByRole('button', { name, exact: true });
    await choice('PRs').click();
    await expect(work(page).getByRole('region', { name: 'Tasks' })).toHaveCount(0);
    // While Tasks is hidden, Productive gains two Tasks and Refresh reads both sources.
    world.tbProd.answer({ tasks: { [ME]: MINE } });
    await page.getByRole('button', { name: 'Refresh' }).click();
    await world.waitUntil('the forced reads to end', async () => world.tbPr.calls().length >= 3 && (await serverWork(world)).tasks.tasks.length === 3);
    const calls = { tbProd: world.tbProd.calls().length, tbPr: world.tbPr.calls().length };
    expect(calls).toEqual({ tbProd: 2, tbPr: 3 });
    // Switching shows the latest Tasks at once, without a read.
    await choice('Tasks').click();
    await expect(taskRows(page)).toHaveCount(3);
    await expect(work(page).getByRole('region', { name: 'PRs' })).toHaveCount(0);
    await choice('All').click();
    await expect(taskRows(page)).toHaveCount(3);
    await expect(prRows(page)).toHaveCount(3);
    // A request the page makes after the switches is seen after any request they made.
    const last = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/settings');
    await page.evaluate(() => fetch('/api/settings'));
    await last;
    page.off('request', record);
    expect(asked).toEqual(['POST /api/work/refresh']);
    expect({ tbProd: world.tbProd.calls().length, tbPr: world.tbPr.calls().length }).toEqual(calls);
  },
);

scenario(
  'WORK-2.5: Settings holds the git config address as a suggestion, unsaved until Save; saved, Tasks are read for it',
  world().gitIdentity({ name: 'Lamp Lighter', email: ME }).tbProd({ tasks: { [ME]: MINE } }).tbPr({ board: BOARD }),
  async ({ page, world }) => {
    await openWork(page);
    await world.step('the PRs to show', () => expect(prRows(page)).toHaveCount(3));
    await sessionSidebar(page).getByRole('button', { name: 'Settings' }).click();
    await expect(emailField(page)).toHaveValue(ME);
    await expect(page.getByText('From your git config. Not saved yet: press Save to use it.')).toBeVisible();
    // Shown, not saved: the server keeps no email, and Tasks isn't read.
    expect(await serverSettings(page)).toMatchObject({ productiveEmail: null, productiveEmailSuggestion: ME });
    await expect(tasksSection(page)).toContainText('Set your Productive email in Settings');
    expect(world.tbProd.calls()).toEqual([]);
    await saveEmail(page).click();
    await world.step('the saved email’s Tasks to show', () => expect(taskRows(page)).toHaveCount(3));
    expect(await serverSettings(page)).toMatchObject({ productiveEmail: ME });
    await expect(page.getByText('From your git config. Not saved yet: press Save to use it.')).toHaveCount(0);
    expect(world.tbProd.calls()).toEqual([tasksQueryArgv(ME, 1)]);
  },
);

scenario(
  'WORK-2.6: without a saved email, Tasks says to set it in Settings, linking there, and tb-prod never runs; PRs works as usual',
  world().tbProd({ tasks: { [ME]: MINE } }).tbPr({ board: BOARD }),
  async ({ page, world }) => {
    await openWork(page);
    await world.step('the PRs to show', () => expect(prRows(page)).toHaveCount(3));
    await expect(tasksSection(page)).toContainText('Set your Productive email in Settings');
    await expect(work(page).getByRole('listbox', { name: 'Tasks' })).toHaveCount(0);
    // Refresh reads PRs, never Tasks.
    await page.getByRole('button', { name: 'Refresh' }).click();
    await world.waitUntil('the forced read to end', () => world.tbPr.calls().length >= 3);
    expect(world.tbPr.calls().map((c) => c.join(' '))).toEqual(['list --json', 'refresh', 'list --json']);
    await tasksSection(page).getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(emailField(page)).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Work' })).toHaveAttribute('aria-selected', 'true');
    expect(world.tbProd.calls()).toEqual([]);
  },
);

scenario(
  'WORK-2.8: saving a different email drops the previous email’s Tasks at once, shows “Loading” until the new email’s read ends, then its Tasks',
  world().tbProd({ tasks: { [ME]: MINE, [OTHER]: THEIRS } }).tbPr({ board: BOARD }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    await openWork(page);
    await world.step('the first email’s Tasks to show', () => expect(taskRows(page)).toHaveCount(3));
    world.tbProd.hold();
    await saveProductiveEmail(page, OTHER);
    // The new email's read runs at once, Work being open; until it ends, Loading and no list.
    expect(await world.tbProd.held()).toEqual(tasksQueryArgv(OTHER, 1));
    await expect(tasksSection(page)).toContainText('Loading');
    await expect(taskRows(page)).toHaveCount(0);
    await expect(work(page)).not.toContainText('Trim the lamp wicks');
    world.tbProd.release();
    await world.step('the new email’s Tasks to show', () => expect(taskRows(page)).toHaveCount(1));
    await expect(taskRows(page)).toHaveAccessibleName('Wind the clock tower Harbor Bells In progress');
    expect(world.tbProd.calls()).toEqual([tasksQueryArgv(ME, 1), tasksQueryArgv(OTHER, 1)]);
  },
);

scenario(
  'WORK-2.8: a different email saved while the previous email’s read is in flight waits for it, whose Tasks are discarded, never shown',
  world().tbProd({ tasks: { [ME]: MINE, [OTHER]: THEIRS } }).tbPr({ board: BOARD }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    world.tbProd.hold();
    await openWork(page);
    expect(await world.tbProd.held()).toEqual(tasksQueryArgv(ME, 1));
    await saveProductiveEmail(page, OTHER);
    await expect(tasksSection(page)).toContainText('Loading');
    // The previous email's read is still running: the new one waits for it.
    expect(world.tbProd.calls()).toEqual([tasksQueryArgv(ME, 1)]);
    world.tbProd.release();
    world.tbProd.hold();
    expect(await world.tbProd.held()).toEqual(tasksQueryArgv(OTHER, 1));
    // The previous email's read ended, and its Tasks were discarded: still Loading, no list.
    await expect(tasksSection(page)).toContainText('Loading');
    await expect(taskRows(page)).toHaveCount(0);
    expect((await serverWork(world)).tasks).toMatchObject({ state: 'loading', tasks: [] });
    world.tbProd.release();
    await world.step('the new email’s Tasks to show', () => expect(taskRows(page)).toHaveCount(1));
    await expect(work(page)).not.toContainText('Trim the lamp wicks');
    expect(world.tbProd.calls()).toEqual([tasksQueryArgv(ME, 1), tasksQueryArgv(OTHER, 1)]);
  },
);

scenario(
  'WORK-2.8: with Work closed, a different email’s read waits until Work opens; when it fails, Tasks gives its reason without the previous list',
  world().tbProd({ tasks: { [ME]: MINE, [OTHER]: THEIRS } }).tbPr({ board: BOARD }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    await openWork(page);
    await world.step('the first email’s Tasks to show', () => expect(taskRows(page)).toHaveCount(3));
    await page.getByRole('button', { name: 'Close Work' }).click();
    await expect(page.getByRole('tab', { name: 'Work' })).toHaveCount(0);
    // Productive now refuses: the next read fails.
    world.tbProd.answer({ tasks: { [ME]: MINE, [OTHER]: THEIRS }, failure: 403 });
    await saveProductiveEmail(page, OTHER);
    // No tab has Work open: nothing is read for the new email. There's no event to wait for when
    // nothing happens, so this gives a read the time to show: one would start while the server
    // handles the save and fail with the declared 403 within a few hundred ms. Through that second,
    // tb-prod isn't called and the server's Tasks stay "Loading" for the new email, never failed.
    await page.waitForTimeout(1000);
    expect(world.tbProd.calls()).toEqual([tasksQueryArgv(ME, 1)]);
    expect((await serverWork(world)).tasks).toMatchObject({ state: 'loading', tasks: [] });
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    const alert = tasksSection(page).getByRole('alert');
    await world.step('the failed read to show', () => expect(alert).toContainText("Couldn't read Tasks"));
    await expect(alert).toContainText(TASK_REASON.denied);
    await expect(taskRows(page)).toHaveCount(0);
    await expect(tasksSection(page).getByText('old', { exact: true })).toHaveCount(0);
    await expect(work(page)).not.toContainText('Trim the lamp wicks');
    expect(world.tbProd.calls()).toEqual([tasksQueryArgv(ME, 1), tasksQueryArgv(OTHER, 1)]);
  },
);

scenario(
  'WORK-5.1: Start Session on a Task opens the launcher with the Task’s URL as its prompt and nothing else; it can be edited, and nothing starts',
  world().tbProd({ tasks: { [ME]: MINE } }).tbPr({ board: BOARD }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    await openWork(page);
    const row = taskRows(page).filter({ hasText: 'Paint the pier posts' });
    await world.step('the Task to show', () => expect(row).toBeVisible());
    await row.getByTitle('Start Session (S)').click();
    const dialog = page.getByRole('dialog', { name: 'New Session' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Prompt')).toHaveValue(taskUrl('41000303'));
    await expect(dialog.getByLabel('Name')).toHaveValue('');
    await dialog.getByLabel('Prompt').fill(`${taskUrl('41000303')} and plan it`);
    await expect(dialog.getByLabel('Prompt')).toHaveValue(`${taskUrl('41000303')} and plan it`);
    await expect(sessionSidebar(page).getByText('Starting…')).toHaveCount(0);
    expect(world.calls().filter((c) => /\bfleet\b.*\bspawn\b/.test(c))).toEqual([]);
  },
);

scenario(
  'WORK-5.1: S on the selected Task opens the launcher as Start Session does, and on a PR does nothing; Escape gives focus back to Work',
  world().tbProd({ tasks: { [ME]: MINE } }).tbPr({ board: BOARD }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    await openWork(page);
    await world.step('the Tasks and PRs to show', async () => {
      await expect(taskRows(page)).toHaveCount(3);
      await expect(prRows(page)).toHaveCount(3);
    });
    const selected = work(page).locator('[role="option"][aria-selected="true"]');
    // To the top: whichever list read first holds the selection (WORK-1.9).
    for (let i = 0; i < 6; i++) await page.keyboard.press('k');
    await expect(selected).toHaveAttribute('data-task', '41000302');
    // Past the three Tasks to the first PR: S does nothing there.
    for (let i = 0; i < 3; i++) await page.keyboard.press('j');
    await expect(prRows(page).first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('s');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('k');
    await expect(selected).toHaveAttribute('data-task', '41000301');
    await page.keyboard.press('s');
    const dialog = page.getByRole('dialog', { name: 'New Session' });
    await expect(dialog.getByLabel('Prompt')).toHaveValue(taskUrl('41000301'));
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    // Focus is back in the Tasks, so k moves Work's selection.
    await page.keyboard.press('k');
    await expect(selected).toHaveAttribute('data-task', '41000303');
    await expect(sessionSidebar(page).getByText('Starting…')).toHaveCount(0);
    expect(world.calls().filter((c) => /\bfleet\b.*\bspawn\b/.test(c))).toEqual([]);
  },
);

scenario(
  'WORK-6.2: Open in Fantastic opens the Task’s Fantastic URL in a new browser tab',
  world().tbProd({ tasks: { [ME]: MINE } }).tbPr({ board: BOARD }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    await openWork(page);
    const row = taskRows(page).filter({ hasText: 'Ship the harbor bells' });
    await world.step('the Task to show', () => expect(row).toBeVisible());
    const tab = page.context().waitForEvent('page');
    await row.getByTitle('Open in Fantastic (O)').click();
    expect(await tab).not.toBe(page);
    await world.waitUntil('the new tab to ask for the Task', () => world.browserRequests().includes(taskUrl('41000302')));
    expect(world.browserRequests()).toEqual([taskUrl('41000302')]);
  },
);

scenario(
  'WORK-6.4: O opens the selected Task in a new tab, as its button does, moving nothing and opening no launcher',
  world().tbProd({ tasks: { [ME]: MINE } }).tbPr({ board: BOARD }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    await openWork(page);
    await world.step('the Tasks to show', () => expect(taskRows(page)).toHaveCount(3));
    // Whichever source answered first holds the selection (WORK-1.9): a click puts it on the first Task.
    await taskRows(page).first().click();
    const selected = work(page).locator('[role="option"][aria-selected="true"]');
    await expect(selected).toHaveAccessibleName(NAMES[0]!);
    await page.keyboard.press('j');
    await expect(selected).toHaveAccessibleName(NAMES[1]!);
    const path = new URL(page.url()).pathname;
    const tab = page.context().waitForEvent('page');
    await page.keyboard.press('o');
    await tab;
    await world.waitUntil('the new tab to ask for the Task', () => world.browserRequests().includes(taskUrl('41000303')));
    expect(world.browserRequests()).toEqual([taskUrl('41000303')]);
    await expect(selected).toHaveAccessibleName(NAMES[1]!);
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  },
);

scenario(
  'WORK-7.1: without tb-prod, the Tasks section says it isn’t installed and gives the command that builds it from cli-toolbox’s main; PRs works as usual',
  world().tbPr({ board: BOARD }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    await openWork(page);
    const alert = tasksSection(page).getByRole('alert');
    await world.step('the Tasks section to say tb-prod isn’t installed', () => expect(alert).toContainText("tb-prod isn't installed"));
    await expect(alert).toContainText(TB_PROD_INSTALL_COMMAND);
    await expect(work(page).getByText('No open tasks')).toHaveCount(0);
    await expect(prRows(page)).toHaveCount(3);
  },
);

scenario(
  'WORK-7.1: without tb-pr, the PRs section says so while the Tasks section works as usual',
  world().tbProd({ tasks: { [ME]: MINE } }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    await openWork(page);
    await world.step('the Tasks to show', () => expect(taskRows(page)).toHaveCount(3));
    await expect(work(page).getByRole('region', { name: 'PRs' }).getByRole('alert')).toContainText("tb-pr isn't installed");
    await expect(tasksSection(page).getByRole('alert')).toHaveCount(0);
  },
);

scenario(
  'WORK-7.2: with tb-prod not signed in to Productive, the Tasks section says so once and shows tb-prod config init',
  world().tbProd({ tasks: { [ME]: MINE }, failure: 'no-config' }).tbPr({ board: BOARD }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    await openWork(page);
    const alert = tasksSection(page).getByRole('alert');
    await world.step('the Tasks section to say tb-prod isn’t signed in', () => expect(alert).toContainText("tb-prod isn't signed in to Productive"));
    await expect(alert.getByText('tb-prod config init', { exact: true })).toBeVisible();
    expect((await alert.textContent())?.match(/signed in/g)).toHaveLength(1);
    // tb-prod's own words stay in the server's log.
    await expect(alert).not.toContainText('No config found');
    await expect(prRows(page)).toHaveCount(3);
  },
);

scenario(
  'WORK-7.3: after a good read, a failed Refresh keeps the Tasks shown, marked old, with the reason in plain words',
  world().tbProd({ tasks: { [ME]: MINE } }).tbPr({ board: BOARD }).settings({ productiveEmail: ME }),
  async ({ page, world }) => {
    await openWork(page);
    await world.step('the Tasks to show', () => expect(taskRows(page)).toHaveCount(3));
    await expect(tasksSection(page).getByText('old', { exact: true })).toHaveCount(0);
    world.tbProd.answer({ tasks: { [ME]: MINE }, failure: 403 });
    await page.getByRole('button', { name: 'Refresh' }).click();
    const alert = tasksSection(page).getByRole('alert');
    await world.step('the Tasks section to say the read failed', () => expect(alert).toContainText("Couldn't update Tasks"));
    await expect(alert).toContainText(TASK_REASON.denied);
    await expect(alert).toContainText(/Showing the last list, from \d+s ago\./);
    await expect(tasksSection(page).getByText('old', { exact: true })).toBeVisible();
    await expect(taskRows(page)).toHaveCount(3);
    // Productive's answer stays out of the page.
    await expect(page.locator('body')).not.toContainText('API error');
    // The PRs read fine: no failure there.
    await expect(work(page).getByRole('region', { name: 'PRs' }).getByRole('alert')).toHaveCount(0);
  },
);
