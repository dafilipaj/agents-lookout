import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { OutputDecl } from '../../world/builder.ts';
import { expect, scenario, world } from '../../world/index.ts';

/** Contract fake until the real outputs release exists; LIB tags and pins deliberately stay put. */
const FIXTURES: OutputDecl[] = [
  { kind: 'file', path: 'output/notes.md', title: 'Harbor notes', events: 2, updatedAt: '2026-10-23T12:00:00Z' },
  { kind: 'file', path: 'output/map.html', title: 'Map source', updatedAt: '2026-10-23T13:00:00Z' },
  { kind: 'artifact', sourcePath: 'output/map.html', title: 'Harbor map' },
  { kind: 'artifact', sourcePath: 'output/refused.html', refused: true, title: 'Refused publish' },
  { kind: 'share', sourcePath: 'output/share.html', title: 'Harbor share', json: true },
  { kind: 'share', sourcePath: 'output/plain.html', title: 'Plain share', json: false },
  { kind: 'file', path: 'output/subagent.md', title: 'Subagent notes', subagent: true },
  { kind: 'file', path: 'output/gone.pdf', title: 'Gone report', exists: false },
  { kind: 'file', path: 'output/quiet.pdf', title: 'Headless report', headless: true },
];
const library = (page: Page) => page.getByRole('tabpanel', { name: 'Library' });
const rows = (page: Page) => library(page).getByRole('listbox', { name: 'Outputs' }).getByRole('option');
async function open(page: Page) {
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Filter Outputs' })).toBeFocused();
}
const fleetRow = (id: string, cwd: string) => ({ pid: 43001, session_id: id, cwd, status: 'idle' as const, waiting_for: null, updated_at: Date.now(), backend: 'tmux' as const, tmux_session: id, display_title: 'World writer', context: null, harness: 'claude' as const, model: null });

scenario('LIB-2.1: server fills pages of Outputs and scrolling uses the next CLI cursor without totals or duplicates', world().outputs(Array.from({ length: 70 }, (_, n) => ({ kind: 'file', path: `output/report-${n}.pdf`, title: `Report ${n}` }))), async ({ page, world: w }) => {
  await open(page); await expect(rows(page)).toHaveCount(50);
  await rows(page).last().scrollIntoViewIfNeeded(); await expect(rows(page)).toHaveCount(70);
  expect(w.tbOutputs.calls().filter((a) => a[0] === 'outputs').every((a) => a.includes('--all-projects') && a.includes('--json'))).toBe(true);
});
scenario('LIB-2.3: Type, repo, Hide gone and shared headless choices reach the CLI and survive reload', world().outputs(FIXTURES), async ({ page, world: w }) => {
  await open(page); await expect(rows(page)).toHaveCount(1);
  await library(page).getByRole('button', { name: 'Markdown', exact: true }).click({ modifiers: ['Alt'] });
  await expect(rows(page)).toHaveCount(2);
  await library(page).getByRole('combobox', { name: 'Repo' }).selectOption(join(w.home, 'Projects/work'));
  await library(page).getByRole('checkbox', { name: 'Hide gone' }).uncheck();
  await library(page).getByRole('checkbox', { name: 'Show Headless Sessions' }).check();
  await w.waitUntil('the selected filters to reach outputs', () => w.tbOutputs.calls().some((a) => a.includes('markdown') && a.includes(join(w.home, 'Projects/work')) && a.includes('include')));
  await page.reload(); await expect(library(page).getByRole('button', { name: 'Markdown', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(library(page).getByRole('checkbox', { name: 'Hide gone' })).not.toBeChecked();
  await page.getByRole('tab', { name: 'History' }).click(); await expect(page.getByRole('checkbox', { name: 'Show Headless Sessions' })).toBeChecked();
});
scenario('LIB-2.7: a Fleet change refreshes page one while an expanded hovered row freezes moves until both end', world().outputs([{ kind: 'file', path: 'output/first.html', title: 'First report' }, { kind: 'file', path: 'output/second.html', title: 'Second report', updatedAt: '2026-10-22T10:00:00Z' }]), async ({ page, world: w }) => {
  await open(page); const first = rows(page).filter({ hasText: 'First report' }); await first.click();
  const changed = w.tbOutputs.history().at(-1)!.answer;
  changed.results[1]!.updated_at = '2026-10-24T10:00:00Z'; w.tbOutputs.answer(changed);
  const before = w.tbOutputs.calls().length; w.fleet.gainSession(fleetRow('library-writer', w.home));
  await w.waitUntil('Library to read after Fleet changed', () => w.tbOutputs.calls().length > before);
  await expect(rows(page).first()).toContainText('First report');
  await library(page).getByRole('listbox').press('Escape'); await expect(rows(page).first()).toContainText('First report');
  await page.mouse.move(1, 1); await expect(rows(page).first()).toContainText('Second report');
});
scenario('LIB-2.9: file liveness is the server stat, folded Artifacts survive gone sources, and Subagent credits stay with the parent', world().outputs(FIXTURES), async ({ page, world: w }) => {
  await open(page); await expect(rows(page)).toHaveCount(1);
  await rm(join(w.home, 'output/map.html'));
  await page.getByRole('button', { name: 'Close Library' }).click(); await open(page);
  const artifact = rows(page).filter({ hasText: 'Harbor map' }); await artifact.click(); await expect(artifact.getByRole('button', { name: 'Open file', exact: true })).toHaveCount(0);
  await library(page).getByRole('checkbox', { name: 'Hide gone' }).uncheck(); await expect(rows(page).filter({ hasText: 'Gone report' })).toContainText('gone');
  await library(page).getByRole('button', { name: 'Markdown', exact: true }).click({ modifiers: ['Alt'] });
  const subagent = rows(page).filter({ hasText: 'Subagent notes' }); await subagent.click(); await expect(subagent.getByRole('button', { name: 'Resume World report writer, past' })).toBeVisible();
});
scenario('LIB-3.3: opened HTML runs scripts in an opaque origin, cannot read Lookout’s API or storage, and keeps sandbox headers on errors', world().outputs([{ kind: 'file', path: 'output/sandbox.html', title: 'Sandbox report', contents: '<!doctype html><title>Sandbox report</title><script>document.body || document.write("<body>");window.scriptRan=true</script>' }]), async ({ page, world: w }) => {
  await open(page); const row = rows(page).first(); await row.click();
  await writeFile(join(w.home, 'output/sandbox.html'), '<!doctype html><title>Sandbox report</title><script>window.scriptRan=true</script>');
  // Keyboard Open avoids the row's pointer double-click settling period.
  const popup = page.waitForEvent('popup'); await library(page).getByRole('listbox').press('o'); const report = await popup; await report.waitForLoadState();
  expect(await report.evaluate(() => (window as unknown as { scriptRan: boolean }).scriptRan)).toBe(true);
  expect(await report.evaluate(() => { try { localStorage.getItem('lookout.right'); return 'read'; } catch { return 'blocked'; } })).toBe('blocked');
  expect(await report.evaluate(async () => { try { return await (await fetch('/api/bootstrap')).text(); } catch { return 'blocked'; } })).toBe('blocked');
  expect(await report.evaluate(() => window.opener === null)).toBe(true);
  const response = await page.request.get(`${w.url}/api/library/file?path=${encodeURIComponent(join(w.home, 'output/not-listed.html'))}`);
  expect(response.status()).toBe(404); expect(response.headers()['content-security-policy']).toBe('sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox'); expect(response.headers()['x-content-type-options']).toBe('nosniff');
});
scenario('LIB-3.5: live Session chips select the existing Session, deleted Transcripts Show read-only and pruned chips have no button', world().outputs([{ kind: 'file', path: 'output/live.html', title: 'Live report', sessionId: 'library-live' }, { kind: 'file', path: 'output/missing.html', title: 'Missing Transcript report', transcriptMissing: true, sessionId: 'library-missing' }, { kind: 'file', path: 'output/pruned.html', title: 'Pruned report', pruned: true, sessionId: 'library-pruned' }]), async ({ page, world: w }) => {
  w.fleet.gainSession(fleetRow('library-live', w.home)); await open(page);
  const live = rows(page).filter({ hasText: 'Live report' }); await live.click(); await expect(live.getByRole('button', { name: 'Open World report writer, Idle' })).toBeVisible();
  await library(page).getByRole('listbox').press('s'); await expect(page).toHaveURL(`${w.url}/s/library-live`); expect(w.calls().some((c) => c.includes('spawn'))).toBe(false);
  const missing = rows(page).filter({ hasText: 'Missing Transcript report' }); await missing.click(); await library(page).getByRole('listbox').press('s'); await expect(page).toHaveURL(`${w.url}/h/claude/library-missing`);
  const pruned = rows(page).filter({ hasText: 'Pruned report' }); await pruned.click(); await expect(pruned.getByText('library-', { exact: true })).toHaveAttribute('title', "removed from tb-session's index"); await expect(pruned.getByRole('button', { name: /World report writer/ })).toHaveCount(0);
});
scenario('LIB-2.8: a pre-outputs tb-session gives Library its own upgrade hint while History still answers', world().outputs([], { unsupported: true }), async ({ page }) => {
  await open(page); await expect(library(page).getByRole('alert')).toContainText('tb-session needs outputs'); await expect(library(page).locator('[data-slot="command-block"]')).toContainText('tb-session');
  await page.getByRole('tab', { name: 'History' }).click(); await expect(page.getByText('No past Sessions')).toBeVisible();
});
