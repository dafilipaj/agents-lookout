import type { Page } from '@playwright/test';
import { type RunningWorld, expect, scenario, world } from '../../world/index.ts';

/**
 * The `/` list's keys in a real browser (VIEW-15, LAUNCH-8). A browser lets React finish what a
 * key's earlier listener started before the next listener hears the key, and a unit test's key
 * doesn't, so what depends on the order of two listeners (the popover's and the field's own Esc)
 * is checked here.
 */

const SESSION = 'c0ffee15-0000-4000-8000-000000000015';
const SESSION_PID = 915_001;

function gainSession(w: RunningWorld) {
  w.fleet.gainSession({ pid: SESSION_PID, session_id: SESSION, cwd: w.home, status: 'idle', waiting_for: null, updated_at: Date.now(), backend: 'tmux', tmux_session: 'slash-session', display_title: 'Slash Session', context: null, harness: 'claude', model: null });
}

const list = (page: Page) => page.getByRole('listbox', { name: 'Commands and skills' });
const compact = (page: Page) => list(page).getByRole('option', { name: /^\/compact,/ });
const hint = (page: Page) => page.locator('[data-field="keys-hint"]');

async function composer(page: Page, w: RunningWorld) {
  gainSession(w);
  await page.getByRole('option', { name: /Slash Session/ }).click();
  // Its role is a combobox's while the list is open (VIEW-15.11), so it's found by its name.
  const box = page.locator('textarea[aria-label="Message"]');
  await box.click();
  return box;
}

scenario('VIEW-15.7: Esc closes the `/` list and the composer keeps focus and its text; the list stays closed, and the next Esc leaves the composer', world(), async ({ page, world }) => {
  const box = await composer(page, world);
  await page.keyboard.type('/comp');
  await expect(compact(page)).toBeVisible();
  await expect(hint(page)).toHaveAttribute('data-keys-at', 'commands');

  await page.keyboard.press('Escape');
  await expect(list(page)).toHaveCount(0);
  await expect(box).toBeFocused();
  await expect(box).toHaveValue('/comp');
  await expect(hint(page)).toHaveAttribute('data-keys-at', 'composer');

  await page.keyboard.type('a');
  await expect(box).toHaveValue('/compa');
  await expect(list(page)).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(box).not.toBeFocused();
});

scenario('VIEW-15.1: focus leaving the composer closes the `/` list but is not an Esc: back in the box, the next key opens it, and Enter picks without sending', world(), async ({ page, world }) => {
  const box = await composer(page, world);
  await page.keyboard.type('/comp');
  await expect(compact(page)).toBeVisible();

  await page.keyboard.press('Shift+Tab');
  await expect(box).not.toBeFocused();
  await expect(list(page)).toHaveCount(0);

  await box.click();
  await expect(list(page)).toHaveCount(0); // only as you type
  await page.keyboard.type('a');
  await expect(compact(page)).toBeVisible();
  await expect(compact(page)).toHaveAttribute('aria-selected', 'true');

  // VIEW-15.7: a press on the list's edge, beside its rows, takes no focus and closes nothing.
  await list(page).click({ position: { x: 2, y: 2 } });
  await expect(box).toBeFocused();
  await expect(compact(page)).toBeVisible();

  // VIEW-15.8: Enter picks; nothing is sent, so the pick is still in the box.
  await page.keyboard.press('Enter');
  await expect(box).toHaveValue('/compact ');
  await expect(box).toBeFocused();
  await expect(list(page)).toHaveCount(0);
});

scenario('LAUNCH-8.3: in the launcher Esc closes the `/` list and not the launcher; a second Esc at once closes the launcher', world(), async ({ page }) => {
  await page.getByRole('button', { name: 'New Session' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New Session' });
  const prompt = dialog.getByLabel('Prompt');
  await prompt.click();
  await page.keyboard.type('/comp');
  await expect(compact(page)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(list(page)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveValue('/comp');

  // An empty field lets the list open again. No wait between the two Escs: the closed list must
  // not still be what the second one goes to.
  await prompt.fill('');
  await page.keyboard.type('/comp');
  await expect(compact(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
