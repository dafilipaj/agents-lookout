import type { Page } from '@playwright/test';
import { type NewMember, RESTATE_LINE, type TopicSummary } from '../../../shared/topics.ts';
import { expect, scenario, world } from '../../world/index.ts';

/** TOPIC slice 6: invented titles, Tasks and summaries. */
const TASK_URL = 'https://app.fantastic.productive.io/109-productive/tasks/41000301';
const task: NewMember = { kind: 'task', ref: { id: '41000301' }, snapshot: { title: 'Light the harbor lanterns', project: 'Lantern Works', url: TASK_URL } };
const SUMMARY: TopicSummary = {
  answer: {
    what: 'Light the harbor lanterns, pier by pier.',
    state: 'in progress',
    why: 'The north pier is lit.',
    open: [{ text: 'The south pier has no wicks.', cites: [{ key: 'task:{"id":"41000301"}', name: 'Light the harbor lanterns' }] }],
    recent: [{ text: 'The north pier was lit.', cites: [] }],
    next: [{ text: 'Order wicks.', cites: [] }],
  },
  writtenAt: Date.now() - 3_600_000,
  model: 'claude-sonnet-5-5',
  costUsd: 0.02,
};

const topicsPanel = (page: Page) => page.getByRole('tabpanel', { name: 'Topics' });
const sessionSidebar = (page: Page) => page.getByRole('complementary', { name: 'Session sidebar' });

scenario(
  'TOPIC-5.1: Start Session in a Topic view opens the launcher with the summary as a handover, the Task’s URL, the Topic line and the restate line; it can be edited, and nothing starts',
  world().topics([{ title: 'Harbor lanterns', notes: 'Not used while the summary is current.', members: [task], summary: SUMMARY }]),
  async ({ page, world }) => {
    await page.keyboard.press('t');
    await world.step('the Topic to show', () => expect(topicsPanel(page).getByRole('button', { name: /^Harbor lanterns,/ })).toBeVisible());
    await topicsPanel(page).getByRole('button', { name: /^Harbor lanterns,/ }).click();
    await topicsPanel(page).getByRole('button', { name: 'Open', exact: true }).click();
    const view = page.getByTestId('topic-view');
    await view.getByRole('button', { name: 'Start Session' }).click();
    const dialog = page.getByRole('dialog', { name: 'New Session' });
    await expect(dialog).toBeVisible();
    const prompt = dialog.getByLabel('Prompt');
    const value = await prompt.inputValue();
    expect(value.split('\n\n')).toEqual([
      'Light the harbor lanterns, pier by pier.',
      'State: in progress. The north pier is lit.',
      'Recent:\n- The north pier was lit.',
      'Open:\n- The south pier has no wicks. (Light the harbor lanterns)',
      'Next:\n- Order wicks.',
      TASK_URL,
      expect.stringMatching(/^Topic: [0-9a-f-]{36} Harbor lanterns$/),
      RESTATE_LINE,
    ]);
    await expect(dialog.getByLabel('Topic')).toHaveValue(/^[0-9a-f-]{36}$/);
    await prompt.fill(`${value}\nStart at the south pier.`);
    await expect(prompt).toHaveValue(`${value}\nStart at the south pier.`);
    await expect(sessionSidebar(page).getByText('Starting…')).toHaveCount(0);
    expect(world.calls().filter((c) => /\bfleet\b.*\bspawn\b/.test(c))).toEqual([]);
    // Esc discards it and gives focus back to Start Session.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(view.getByRole('button', { name: 'Start Session' })).toBeFocused();
  },
);
