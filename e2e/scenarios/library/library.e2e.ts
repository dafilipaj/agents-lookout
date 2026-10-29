import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { OutputDecl } from '../../world/builder.ts';
import { expect, scenario, world, type RunningWorld } from '../../world/index.ts';

/** Invented Transcript facts, mined by the real pinned tb-session in each World's HOME. */
const FIXTURES: OutputDecl[] = [
  { kind: 'file', path: 'output/notes.md', title: 'Harbor notes', events: 2 },
  { kind: 'file', path: 'output/map.html', title: 'Map source' },
  { kind: 'artifact', sourcePath: 'output/map.html', title: 'Harbor map' },
  { kind: 'artifact', sourcePath: 'output/refused.html', refused: true, title: 'Refused publish' },
  { kind: 'share', sourcePath: 'output/share.html', title: 'Harbor share', json: true },
  { kind: 'share', title: 'Plain share', json: false },
  { kind: 'file', path: 'output/subagent.md', title: 'Subagent notes', subagent: true },
  { kind: 'file', path: 'output/gone.pdf', exists: false },
  { kind: 'file', path: 'output/quiet.pdf', headless: true, sessionId: 'library-headless' },
  { kind: 'file', path: 'output/other.html', projectPath: 'Projects/other', title: 'Other repo' },
  { kind: 'file', path: 'scratch/removed/report.html', directoryGone: true },
  { kind: 'file', path: 'Projects/git-owned/report.md', title: 'Owned file', git: 'tracked' },
  { kind: 'file', path: 'Projects/git-owned/ignored/report.md', title: 'Ignored report', git: 'ignored' },
  { kind: 'file', path: '.claude/output/internal.html', title: 'Harness internal' },
  { kind: 'file', path: 'output/notes.md', title: 'Harbor notes', events: 2, forkOf: 'library-writer', sessionId: 'library-fork', sessionCreatedAt: '2026-10-24T10:00:00Z' },
];
const library = (page: Page) => page.getByRole('tabpanel', { name: 'Library' });
const rows = (page: Page) => library(page).getByRole('listbox', { name: 'Outputs' }).getByRole('option');
const eventCalls = (w: RunningWorld) => w.calls().filter((a) => /tb-session events\b/.test(a));
async function open(page: Page) {
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Filter Outputs' })).toBeFocused();
}
async function read(page: Page, w: RunningWorld, query: Record<string, string> = {}) {
  const url = new URL('/api/library', w.url);
  url.search = new URLSearchParams(query).toString();
  const response = await page.request.get(url.href);
  expect(response.ok()).toBe(true);
  return response.json();
}
async function nextReadWindow(w: RunningWorld) {
  const at = Date.now();
  await w.waitUntil('the two-second Library read cache to expire', () => Date.now() - at > 2100);
}
const fleetRow = (id: string, cwd: string) => ({ pid: 43001, session_id: id, cwd, status: 'idle' as const, waiting_for: null, updated_at: Date.now(), backend: 'tmux' as const, tmux_session: id, display_title: 'World writer', context: null, harness: 'claude' as const, model: null });

scenario('LIB-2.1: one complete read gives exact pages, newest first by local day, and scroll continues that read without mining again', world().outputs(Array.from({ length: 70 }, (_, n) => ({ kind: 'file', path: `output/report-${n}.html`, title: `Report ${n}`, updatedAt: new Date(Date.now() - n * 3_600_000).toISOString() }))), async ({ page, world: w }) => {
  await open(page);
  await expect(rows(page)).toHaveCount(50);
  await expect(rows(page).first()).toContainText('Report 0');
  await expect(library(page).getByText('Today', { exact: true })).toBeVisible();
  await expect(library(page).getByText('Yesterday', { exact: true })).toBeVisible();
  const first = await read(page, w);
  expect(first).toMatchObject({ state: 'ok', total: 70, hasMore: true, nextPage: 2 });
  expect(typeof first.readId).toBe('string');
  const mined = eventCalls(w).length;
  expect(mined).toBe(2);
  expect(eventCalls(w).every((a) => a.includes('--all-projects') && a.includes('--json') && a.includes('--limit 100000') && a.includes('--headless exclude'))).toBe(true);
  expect(eventCalls(w).filter((a) => a.includes('write') && a.includes('edit') && a.includes('--ext'))).toHaveLength(1);
  expect(eventCalls(w).filter((a) => a.includes('artifact') && a.includes('share') && !a.includes('--ext'))).toHaveLength(1);
  expect(w.calls().some((a) => /tb-session list\b/.test(a) && a.includes('--all-projects') && a.includes('--limit 100000'))).toBe(true);
  await rows(page).last().scrollIntoViewIfNeeded();
  await expect(rows(page)).toHaveCount(70);
  expect(new Set(await rows(page).allTextContents()).size).toBe(70);
  expect(eventCalls(w)).toHaveLength(mined);
  expect((await read(page, w, { page: '2', readId: first.readId })).items).toHaveLength(20);
  expect(await read(page, w, { page: '2', readId: 'evicted-world-read' })).toMatchObject({ state: 'read-again' });
});

scenario('LIB-2.3: Type, repo, text and Hide gone filter the held read; only headless mines again and the choices survive reload', world().outputs(FIXTURES), async ({ page, world: w }) => {
  await open(page); await expect(rows(page)).toHaveCount(2);
  const mined = eventCalls(w).length;
  await library(page).getByRole('button', { name: 'Markdown', exact: true }).click({ modifiers: ['Alt'] });
  await expect(rows(page)).toHaveCount(3);
  await library(page).getByRole('button', { name: 'Markdown', exact: true }).click();
  await expect(library(page).getByRole('button', { name: 'Markdown', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await library(page).getByRole('combobox', { name: 'Repo' }).selectOption(join(w.home, 'Projects/work'));
  await library(page).getByRole('checkbox', { name: 'Hide gone' }).uncheck();
  await page.getByRole('searchbox', { name: 'Filter Outputs' }).fill('HARBOR NOTES');
  await expect(rows(page)).toHaveCount(1); await expect(rows(page).first()).toContainText('Harbor notes');
  expect(eventCalls(w)).toHaveLength(mined);
  await library(page).getByRole('checkbox', { name: 'Show Headless Sessions' }).check();
  await w.waitUntil('a new include-headless event read', () => eventCalls(w).length === mined + 2);
  expect(eventCalls(w).slice(-2).every((a) => a.includes('--headless include'))).toBe(true);
  await page.reload();
  await expect(library(page).getByRole('button', { name: 'Markdown', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(library(page).getByRole('combobox', { name: 'Repo' })).toHaveValue(join(w.home, 'Projects/work'));
  await expect(library(page).getByRole('checkbox', { name: 'Hide gone' })).not.toBeChecked();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByRole('checkbox', { name: 'Show Headless Sessions' })).toBeChecked();
});

scenario('LIB-2.7: Fleet refresh replaces every loaded page from one new read while expansion and hover freeze moves across days', world().outputs(Array.from({ length: 70 }, (_, n) => ({ kind: 'file', path: `output/report-${n}.html`, title: `Report ${n}`, updatedAt: new Date(Date.parse('2026-10-23T12:00:00Z') - n * 3_600_000).toISOString() }))), async ({ page, world: w }) => {
  await open(page); await expect(rows(page)).toHaveCount(50);
  await rows(page).last().scrollIntoViewIfNeeded(); await expect(rows(page)).toHaveCount(70);
  const first = library(page).getByRole('option', { name: /^Report 0 HTML / });
  await rows(page).first().click();
  await w.tbSession.produce([{ kind: 'file', path: 'output/report-69.html', title: 'Report 69', updatedAt: '2026-10-24T12:00:00Z' }]);
  await nextReadWindow(w);
  const before = eventCalls(w).length;
  w.fleet.gainSession(fleetRow('library-writer', w.home));
  await w.waitUntil('Library to mine again after Fleet changed', () => eventCalls(w).length > before);
  await expect(rows(page).first()).toContainText('Report 0');
  await library(page).getByRole('listbox').press('Escape');
  await expect(rows(page).first()).toContainText('Report 0');
  await page.mouse.move(1, 1);
  await expect(rows(page).first()).toContainText('Report 69');
  await expect(rows(page)).toHaveCount(70);
  expect(new Set(await rows(page).allTextContents()).size).toBe(70);
  expect(eventCalls(w).every((a) => !a.includes('--after'))).toBe(true);
  await expect(first).toHaveCount(1);
});

scenario('LIB-2.9: complete-read stats give exact hidden counts and full pages; missing directories drop files and an Artifact survives its gone source', world().outputs([...FIXTURES, ...Array.from({ length: 60 }, (_, n): OutputDecl => ({ kind: 'file', path: `output/page-${n}.html`, title: `Page ${n}`, exists: n % 2 === 0 }))]), async ({ page, world: w }) => {
  await open(page); await expect(rows(page)).toHaveCount(32);
  const first = await read(page, w);
  expect(first).toMatchObject({ total: 32, hiddenGone: 31, hasMore: false });
  await library(page).getByRole('checkbox', { name: 'Hide gone' }).uncheck();
  await expect(rows(page)).toHaveCount(50);
  await rows(page).last().scrollIntoViewIfNeeded(); await expect(rows(page)).toHaveCount(63);
  expect((await read(page, w, { hideGone: '0', readId: first.readId })).total).toBe(63);
  await expect(rows(page).filter({ hasText: 'removed/report.html' })).toHaveCount(0);
  await rm(join(w.home, 'output/map.html'));
  await nextReadWindow(w); await page.getByRole('button', { name: 'Close Library' }).click(); await open(page);
  await page.getByRole('searchbox', { name: 'Filter Outputs' }).fill('Harbor map');
  const artifact = rows(page).filter({ hasText: 'Harbor map' }); await artifact.click();
  await expect(artifact.getByRole('button', { name: 'Open', exact: true })).toBeVisible();
  await expect(artifact.getByRole('button', { name: 'Open file', exact: true })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Filter Outputs' }).fill('');
  await library(page).getByRole('button', { name: 'Markdown', exact: true }).click({ modifiers: ['Alt'] });
  await expect(rows(page).filter({ hasText: 'Owned file' })).toHaveCount(0);
  await expect(rows(page).filter({ hasText: 'Ignored report' })).toHaveCount(1);
  const subagent = rows(page).filter({ hasText: 'Subagent notes' }); await subagent.click();
  await expect(subagent.getByRole('button', { name: /Resume World report writer, past/ })).toBeVisible();
});

scenario('LIB-3.3: HTML opens from a listed route with scripts, opaque storage and API isolation, no opener, and sandbox headers on errors', world().outputs([{ kind: 'file', path: 'output/sandbox.html', title: 'Sandbox report', contents: '<!doctype html><title>Sandbox report</title><script>window.scriptRan=true</script>' }]), async ({ page, world: w }) => {
  await open(page); const row = rows(page).first(); await row.click();
  const popup = page.waitForEvent('popup'); await library(page).getByRole('listbox').press('o'); const report = await popup; await report.waitForLoadState();
  expect(await report.evaluate(() => (window as unknown as { scriptRan: boolean }).scriptRan)).toBe(true);
  expect(await report.evaluate(() => { try { localStorage.getItem('lookout.right'); return 'read'; } catch { return 'blocked'; } })).toBe('blocked');
  expect(await report.evaluate(async () => { try { return await (await fetch('/api/bootstrap')).text(); } catch { return 'blocked'; } })).toBe('blocked');
  expect(await report.evaluate(() => window.opener === null)).toBe(true);
  await writeFile(join(w.home, 'output/not-listed.html'), '<title>Not listed</title>');
  for (const path of ['output/not-listed.html', 'output/missing.html']) {
    const fileUrl = new URL('/api/library/file', w.url); fileUrl.searchParams.set('path', join(w.home, path));
    const response = await page.request.get(fileUrl.href);
    expect(response.status()).toBe(404); expect(response.headers()['content-security-policy']).toBe('sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox'); expect(response.headers()['x-content-type-options']).toBe('nosniff');
  }
});

scenario('LIB-3.5: a live Session chip selects its Session without spawning, a deleted Transcript shows read-only, and a pruned Session has no button', world().outputs([{ kind: 'file', path: 'output/live.html', title: 'Live report', sessionId: 'library-live' }, { kind: 'file', path: 'output/missing.html', title: 'Missing Transcript report', transcriptMissing: true, sessionId: 'library-missing' }, { kind: 'file', path: 'output/pruned.html', title: 'Pruned report', pruned: true, sessionId: 'library-pruned' }]), async ({ page, world: w }) => {
  w.fleet.gainSession(fleetRow('library-live', w.home)); await open(page);
  const live = rows(page).filter({ hasText: 'Live report' }); await live.click(); await expect(live.getByRole('button', { name: 'Open World report writer, Idle' })).toBeVisible();
  await library(page).getByRole('listbox').press('s'); await expect(page).toHaveURL(new URL('/s/library-live', w.url).href);
  expect(w.calls().some((c) => /fleet.*spawn/.test(c))).toBe(false);
  const missing = rows(page).filter({ hasText: 'Missing Transcript report' }); await missing.click(); await expect(missing.getByRole('button', { name: 'Show World report writer, past' })).toBeVisible();
  await library(page).getByRole('listbox').press('s'); await expect(page).toHaveURL(new URL('/h/claude/library-missing', w.url).href);
  const pruned = rows(page).filter({ hasText: 'Pruned report' }); await pruned.click(); await expect(pruned.getByText('library-', { exact: true })).toHaveAttribute('title', "removed from tb-session's index"); await expect(pruned.getByRole('button', { name: /World report writer/ })).toHaveCount(0);
});

scenario('LIB-3.5: Resume goes through History, selects one Starting row and fails after 15 s if Fleet never reports the Session', world().outputs([{ kind: 'file', path: 'output/resume.html', title: 'Resume report', sessionId: 'library-resume' }]).fleetResume('library-resume'), async ({ page, world: w }) => {
  await open(page); const row = rows(page).first(); await row.click();
  await expect(row.getByRole('button', { name: 'Resume World report writer, past' })).toBeVisible();
  const resumed = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/history/resume');
  await library(page).getByRole('listbox').press('s');
  expect((await (await resumed).json()).kind).toBe('started');
  await expect(page.getByTestId('starting-view').getByText('Starting…', { exact: true })).toBeVisible();
  expect(w.calls().filter((a) => /fleet.*spawn.*--resume library-resume/.test(a))).toHaveLength(1);
  // A second action follows the pending start, rather than asking Fleet for another spawn.
  await row.click(); await library(page).getByRole('listbox').press('s');
  expect(w.calls().filter((a) => /fleet.*spawn.*--resume library-resume/.test(a))).toHaveLength(1);
  await expect(page.getByTestId('starting-view').getByText("Didn't start", { exact: true })).toBeVisible({ timeout: 18000 });
  await expect(page.getByTestId('starting-view').getByRole('alert')).toContainText("Fleet hasn't reported it after 15 s.");
  expect(w.calls().filter((a) => /fleet.*spawn.*--resume library-resume/.test(a))).toHaveLength(1);
});

scenario('LIB-2.8: a pre-events tb-session gives Library its own upgrade hint while History still answers', world().outputs([], { unsupported: true }), async ({ page }) => {
  await open(page); await expect(library(page).getByRole('alert')).toContainText('tb-session needs events'); await expect(library(page).locator('[data-slot="command-block"]')).toContainText('tb-session');
  await page.getByRole('tab', { name: 'History' }).click(); await expect(page.getByText('No past Sessions')).toBeVisible();
});
