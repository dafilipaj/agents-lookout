import type { PlainAnswer, PlainPrFiles } from '@shared/plain.ts';
import type { PrSection, WorkPr, WorkSnapshot } from '@shared/work.ts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveError } from '@/lib/client';
import { renderApp, row, settings } from '@/test/helpers';

/** Synthetic PRs only: invented repos and titles. */
const pr = (over: Partial<WorkPr> & { repo: string; number: number }): WorkPr => ({
  title: `${over.repo} change ${over.number}`,
  url: `https://github.com/productiveio/${over.repo}/pull/${over.number}`,
  author: null,
  createdAt: Date.now() - 2 * 86_400_000,
  ageDays: 2,
  rotting: 'fresh',
  ci: 'none',
  chip: 'draft',
  column: 'draft_mine',
  baseBranch: 'develop',
  taskIds: [],
  links: null,
  ...over,
});
const MINE = pr({ repo: 'shop', number: 7, title: 'Rates on the deal board' });
const OTHER = pr({ repo: 'lantern', number: 12, title: 'Light the lanterns' });
const REVIEW = pr({ repo: 'shop', number: 8, title: 'Count the willow leaves', chip: null, column: 'waiting_on_me' });

const section: PrSection = { state: 'ok', reason: null, fix: null, stale: false, fetchedAt: Date.now(), mine: [MINE, OTHER], reviewRequests: [REVIEW], marks: { mine: [], reviewRequests: [] }, taskIds: true };
const work: WorkSnapshot = {
  prs: section,
  tasks: { state: 'no-email', reason: null, fix: null, stale: false, fetchedAt: null, tasks: [] },
  sessionLinks: { state: 'ok', reason: null, fix: null },
  refresh: { cooldownUntil: null, githubBlockedUntil: null },
};

const files = (over: Partial<PlainPrFiles> = {}): PlainPrFiles => ({
  repo: 'shop',
  number: 7,
  files: [
    { path: 'plain/crm.plain', viewed: true },
    { path: 'plain/rates.plain', viewed: false },
  ],
  error: null,
  ...over,
});

function openApp(path: string, options: Parameters<typeof renderApp>[1] = {}) {
  const app = renderApp(path, { plainClones: async () => ['shop'], ...options });
  app.snapshot([row({ id: 'alpha', title: 'fix-deal-rates' })], { state: 'ok' }, settings());
  app.emit({ type: 'work', work });
  return app;
}

const panel = () => screen.getByTestId('work-panel');
const option = (id: string) => within(panel()).getAllByRole('option', { hidden: true }).find((o) => o.getAttribute('data-pr') === id)!;
const expand = (id: string) => {
  const el = option(id);
  if (el.getAttribute('aria-expanded') !== 'true') fireEvent.click(el);
  return el;
};
const specsButton = (id: string) => expand(id).querySelector<HTMLElement>('[data-field="actions"] [data-action="specs"]');
const list = () => document.querySelector<HTMLElement>('[data-slot="pr-specs"]');

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("Work's Specs on a PR", () => {
  it('PLAIN-5.1 (support): an expanded PR or Review request in a cloned repo has "Specs", listing its changed Modules with their Viewed marks', async () => {
    const plainPr = vi.fn(async () => files());
    openApp('/s/alpha', { plainPr });
    await userEvent.setup().keyboard('w');
    await waitFor(() => expect(specsButton('shop#7')).not.toBeNull());
    expect([...option('shop#7').querySelectorAll('[data-field="actions"] [data-action]')].map((b) => b.textContent)).toEqual(['Open on GitHub', 'Specs', 'Add to Topic']);
    expect(specsButton('shop#8')).not.toBeNull(); // a Review request too
    fireEvent.click(specsButton('shop#7')!);
    expect(plainPr).toHaveBeenCalledWith('shop', 7, true);
    await waitFor(() => expect(list()?.querySelectorAll('button[data-file]')).toHaveLength(2));
    const [crm, rates] = [...list()!.querySelectorAll<HTMLElement>('button[data-file]')];
    expect(crm).toHaveAttribute('aria-label', 'plain/crm.plain, viewed, open the spec');
    expect(crm!.querySelector('[data-icon="viewed"]')).not.toBeNull();
    expect(rates).toHaveAttribute('aria-label', 'plain/rates.plain, open the spec');
    expect(option('shop#7')).toHaveAttribute('aria-expanded', 'true'); // a click in the list isn't the row's
  });

  it('PLAIN-5.1 (support): a Module opens the Spec view at its PR URL; Back returns to what the main pane showed', async () => {
    const readPlain = vi.fn(async (): Promise<PlainAnswer> => {
      throw new SaveError('stop', null, 404);
    });
    openApp('/s/alpha', { plainPr: async () => files(), readPlain });
    const user = userEvent.setup();
    await user.keyboard('w');
    await waitFor(() => expect(specsButton('shop#7')).not.toBeNull());
    fireEvent.click(specsButton('shop#7')!);
    await waitFor(() => expect(list()?.querySelector('button[data-file="plain/rates.plain"]')).not.toBeNull());
    fireEvent.click(list()!.querySelector('button[data-file="plain/rates.plain"]')!);
    expect(window.location.pathname).toBe('/plain/pr/shop/7/plain%2Frates.plain');
    expect(readPlain).toHaveBeenCalledWith({ kind: 'pr', repo: 'shop', number: 7 }, 'plain/rates.plain', true);
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(window.location.pathname).toBe('/s/alpha');
  });

  it('PLAIN-5.1 (support): S on the selected PR opens its Specs; Esc closes them and gives focus back to Work\'s list', async () => {
    const plainPr = vi.fn(async () => files());
    openApp('/s/alpha', { plainPr });
    const user = userEvent.setup();
    await user.keyboard('w');
    await waitFor(() => expect(option('shop#7')).toHaveAttribute('aria-selected', 'true'));
    // Once the clones are known, S lists the specs of the selected PR, expanding it.
    await waitFor(async () => {
      await user.keyboard('s');
      expect(list()).not.toBeNull();
    });
    expect(option('shop#7')).toHaveAttribute('aria-expanded', 'true');
    expect(plainPr).toHaveBeenCalledWith('shop', 7, true);
    await waitFor(() => expect(list()!.querySelectorAll('button[data-file]')).toHaveLength(2));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveAttribute('data-file', 'plain/crm.plain');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(list()).toBeNull());
    expect(document.activeElement).toHaveAttribute('role', 'listbox');
    expect(option('shop#7')).toHaveAttribute('aria-expanded', 'true'); // Esc closed the list, not the row
  });

  it('PLAIN-5.1 (support): Back returns to the view Work opened it from, another Spec view included', async () => {
    const readPlain = vi.fn(async (): Promise<PlainAnswer> => {
      throw new SaveError('stop', null, 404);
    });
    openApp('/plain/pr/shop/8/plain%2Fapi.plain', { plainPr: async () => files(), readPlain });
    const user = userEvent.setup();
    await user.keyboard('w');
    await waitFor(() => expect(specsButton('shop#7')).not.toBeNull());
    fireEvent.click(specsButton('shop#7')!);
    await waitFor(() => expect(list()?.querySelector('button[data-file="plain/rates.plain"]')).not.toBeNull());
    fireEvent.click(list()!.querySelector('button[data-file="plain/rates.plain"]')!);
    expect(window.location.pathname).toBe('/plain/pr/shop/7/plain%2Frates.plain');
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(window.location.pathname).toBe('/plain/pr/shop/8/plain%2Fapi.plain');
  });

  it('PLAIN-5.1 (support): Back steps through nested PR Spec views, each to its own opener', async () => {
    const readPlain = vi.fn(async (): Promise<PlainAnswer> => {
      throw new SaveError('stop', null, 404);
    });
    openApp('/s/alpha', { plainPr: async (_repo: string, number: number) => files({ number }), readPlain });
    const user = userEvent.setup();
    await user.keyboard('w');
    const openFrom = async (id: string) => {
      await waitFor(() => expect(specsButton(id)).not.toBeNull());
      fireEvent.click(specsButton(id)!);
      await waitFor(() => expect(list()?.querySelector('button[data-file="plain/rates.plain"]')).not.toBeNull());
      fireEvent.click(list()!.querySelector('button[data-file="plain/rates.plain"]')!);
    };
    await openFrom('shop#7');
    expect(window.location.pathname).toBe('/plain/pr/shop/7/plain%2Frates.plain');
    await openFrom('shop#8');
    expect(window.location.pathname).toBe('/plain/pr/shop/8/plain%2Frates.plain');
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(window.location.pathname).toBe('/plain/pr/shop/7/plain%2Frates.plain');
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(window.location.pathname).toBe('/s/alpha');
  });

  it('PLAIN-5.1 (support): closing Specs by focusing another control leaves focus there', async () => {
    openApp('/s/alpha', { plainPr: async () => files() });
    const user = userEvent.setup();
    await user.keyboard('w');
    await waitFor(() => expect(specsButton('shop#7')).not.toBeNull());
    const outside = document.body.appendChild(document.createElement('input'));
    try {
      fireEvent.click(specsButton('shop#7')!);
      await waitFor(() => expect(list()?.querySelectorAll('button[data-file]')).toHaveLength(2));
      await user.click(outside);
      await waitFor(() => expect(list()).toBeNull());
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });

  it('PLAIN-5.1 (support): a PR without spec changes says so', async () => {
    openApp('/s/alpha', { plainPr: async () => files({ files: [] }) });
    await userEvent.setup().keyboard('w');
    await waitFor(() => expect(specsButton('shop#7')).not.toBeNull());
    fireEvent.click(specsButton('shop#7')!);
    await waitFor(() => expect(list()).toHaveTextContent('No spec changes in this PR'));
  });

  it("PLAIN-5.4: without a clone of the PR's repo there's no button, and the row's tooltip says why; a failed fetch says why, with Retry", async () => {
    let fail = true;
    const plainPr = vi.fn(async () => {
      if (fail) throw new SaveError("Couldn't fetch #7: Could not resolve host: github.com", null, 502);
      return files();
    });
    openApp('/s/alpha', { plainPr });
    await userEvent.setup().keyboard('w');
    await waitFor(() => expect(specsButton('shop#7')).not.toBeNull());
    expect(specsButton('lantern#12')).toBeNull();
    expect(option('lantern#12')).toHaveAttribute('title', 'No local clone of lantern');
    expect(option('shop#7')).not.toHaveAttribute('title');
    fireEvent.click(specsButton('shop#7')!);
    const error = await waitFor(() => {
      const el = list()?.querySelector<HTMLElement>('[data-field="pr-specs-error"]');
      if (!el) throw new Error('no error shown yet');
      return el;
    });
    expect(error).toHaveTextContent("Couldn't fetch #7: Could not resolve host: github.com");
    fail = false;
    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(list()!.querySelectorAll('button[data-file]')).toHaveLength(2));
    expect(plainPr).toHaveBeenLastCalledWith('shop', 7, true);
    expect(list()!.querySelector('[data-field="pr-specs-error"]')).toBeNull();
  });
});

describe("a PR's Module in the Spec view", () => {
  const TEXT = '---\ndescription: Rates.\n---\n***definitions***\n- :Rate: is a price.\n';
  const answer = (over: Partial<PlainAnswer> = {}): PlainAnswer => ({
    source: { kind: 'pr', repo: 'shop', number: 7 },
    checkout: { id: '0123456789abcdef', repo: 'shop', where: '#7' },
    path: 'plain/rates.plain',
    text: TEXT,
    baseText: TEXT.replace('a price', 'one price'),
    base: 'abc1234',
    baseName: 'merge-base with develop',
    fetchError: null,
    concepts: {},
    missing: [],
    key: 'k'.repeat(64),
    viewed: false,
    changedSinceViewed: false,
    ...over,
  });

  it('PLAIN-5.3 (support): it compares with the merge-base, says so, and a failed later fetch says it shows the PR as fetched before; Viewed saves for the PR', async () => {
    const readPlain = vi.fn(async () => answer({ fetchError: "Couldn't fetch #7: Could not resolve host: github.com" }));
    const setPlainViewed = vi.fn(async () => {});
    openApp('/plain/pr/shop/7/plain%2Frates.plain', { readPlain, setPlainViewed });
    await waitFor(() => expect(document.querySelector('[data-view="spec"] [data-slot="spec-changes"]')).not.toBeNull());
    const view = document.querySelector<HTMLElement>('[data-view="spec"]')!;
    expect(view.querySelector('[data-slot="spec-changes"] h2')).toHaveTextContent('against abc1234 (merge-base with develop)');
    expect(view.querySelector('[data-field="spec-where"]')).toHaveTextContent('plain/rates.plain · shop · #7');
    expect(view.querySelector('[data-field="spec-fetch-error"]')).toHaveTextContent('Showing #7 as fetched before');
    await userEvent.setup().click(within(view).getByRole('checkbox', { name: /Viewed/ }));
    expect(setPlainViewed).toHaveBeenCalledWith({ kind: 'pr', repo: 'shop', number: 7 }, 'plain/rates.plain', 'k'.repeat(64), true);
  });
});
