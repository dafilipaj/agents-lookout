import type { WorkPr, WorkSnapshot } from '@shared/work.ts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, field, renderApp, row, rowEl, visibleTitles } from '@/test/helpers';

/** Real timers for userEvent, but the clock pinned at NOW, which the rows' times are built from. */
beforeEach(() => {
  // The right sidebar remembers being open (HIST-1.3); each test starts with it closed.
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const git = (repo: string, worktree: string | null, branch: string | null) => ({ repo, worktree, branch, commonDir: `/Users/me/Projects/${repo}/.git`, defaultBranch: 'main' });
const filterBox = () => screen.getByRole('searchbox', { name: 'Filter Sessions' });
const marks = (el: Element | null) => [...(el?.querySelectorAll('mark') ?? [])].map((m) => m.textContent);
const handOff = () => document.querySelector<HTMLElement>('[data-field="search-messages"]');

const pr = (number: number, title: string, sessionId: string): WorkPr =>
  ({
    repo: 'anvil', number, title, url: `https://github.com/productiveio/anvil/pull/${number}`, author: null, createdAt: NOW, ageDays: 1, rotting: 'fresh', ci: 'none', chip: 'draft', column: 'draft_mine', baseBranch: 'develop', taskIds: [],
    links: { tasks: [], sessions: [{ sessionId, harness: 'claude', title: 't', createdAt: NOW, modifiedAt: NOW, live: true, reason: 'started on this PR' }], incomplete: false },
  }) as WorkPr;
const work = (prs: WorkPr[]): WorkSnapshot => ({
  prs: { state: 'ok', reason: null, fix: null, stale: false, fetchedAt: NOW, mine: prs, reviewRequests: [], marks: { mine: [], reviewRequests: [] }, taskIds: true },
  tasks: { state: 'no-email', reason: null, fix: null, stale: false, fetchedAt: null, tasks: [] },
  sessionLinks: { state: 'ok', reason: null, fix: null },
  refresh: { cooldownUntil: null, githubBlockedUntil: null },
});

describe('SIDE-12 the filter', () => {
  it('SIDE-12.1: `rates fix` finds a Session on fix/rates, and `work rates` one in the repo work on it', async () => {
    const user = userEvent.setup();
    renderApp().snapshot([row({ id: 'rates', title: 'Rounding', git: git('work', null, 'fix/rates') }), row({ id: 'other', title: 'Invoices', git: git('harbor', null, 'main') })]);
    await user.type(filterBox(), 'rates fix');
    expect(visibleTitles()).toEqual(['Rounding']);
    await user.clear(filterBox());
    await user.type(filterBox(), 'WORK rates');
    expect(visibleTitles()).toEqual(['Rounding']);
  });

  it('SIDE-12.4: the rows that match keep their order and sections, the Needs you header and its count included', async () => {
    const user = userEvent.setup();
    const view = { controllable: false, backend: 'unknown' as const };
    renderApp().snapshot([
      row({ id: 'n1', title: 'rates one', status: 'needs-you', waitingFor: 'permission', statusSince: NOW - 1000 }),
      row({ id: 'n2', title: 'invoices', status: 'needs-you', waitingFor: 'permission', statusSince: NOW - 2000 }),
      row({ id: 'n3', title: 'rates three', status: 'needs-you', waitingFor: 'permission', statusSince: NOW - 3000 }),
      row({ id: 'b1', title: 'rates busy', status: 'busy', statusSince: NOW - 500 }),
      row({ id: 'i1', title: 'rates idle', status: 'idle', statusSince: NOW - 100 }),
      row({ id: 'v1', title: 'rates elsewhere', status: 'busy', ...view }),
    ]);
    await user.type(filterBox(), 'rates');
    // An Idle row matching best (the whole title is short) still sits below Busy and Needs you.
    expect(visibleTitles()).toEqual(['rates one', 'rates three', 'rates busy', 'rates idle', 'rates elsewhere']);
    const heading = document.getElementById('needs-you-heading')!;
    expect(heading.nextElementSibling).toHaveTextContent('2');
    expect(screen.getByRole('group', { name: 'View only' })).toContainElement(rowEl('v1'));
  });

  it('SIDE-12.5: what matched is marked where the row shows it: the title, the suffix, the repo, the Worktree or branch, and the words', async () => {
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([
      row({ id: 'a', title: 'Fix the rates', git: git('harbor', 'crm-rates', 'fix/rates'), locationShown: { repo: true, where: true } }),
      row({ id: 'b', title: 'Waiting', status: 'needs-you', waitingFor: 'permission: Bash(rspec rates)', locationShown: { repo: false, where: false } }),
      row({ id: 'c', title: 'Twin', git: git('work', 'rates-wt', 'x') }),
      row({ id: 'd', title: 'Twin', git: git('work', 'other-wt', 'y') }),
      row({ id: 'e', title: 'Pair', git: git('work', null, 'release') }),
      row({ id: 'f', title: 'Pair', git: git('work', 'pair-wt', 'z') }),
    ]);
    await user.type(filterBox(), 'rates');
    expect(marks(field('a', 'title'))).toEqual(['rates']);
    expect(marks(field('a', 'location'))).toEqual(['rates']);
    expect(marks(field('b', 'waiting-for'))).toEqual(['rates']);
    expect(marks(field('c', 'name-suffix'))).toEqual(['rates']);
    await user.clear(filterBox());
    await user.type(filterBox(), 'harbor');
    expect(marks(field('a', 'repo'))).toEqual(['harbor']);
    // A plain checkout's suffix beside a Worktree twin is its branch (SIDE-10.3): marked, no extra line.
    await user.clear(filterBox());
    await user.type(filterBox(), 'release');
    expect(marks(field('e', 'name-suffix'))).toEqual(['release']);
    expect(field('e', 'match')).toBeNull();
    // Fuzzy: the letters, each marked; touching ones as one mark.
    await user.clear(filterBox());
    await user.type(filterBox(), 'crmrt');
    expect(marks(field('a', 'location'))).toEqual(['crm', 'r', 't']);
    // Cleared, nothing is marked.
    await user.clear(filterBox());
    expect(document.querySelectorAll('[role="option"] mark')).toHaveLength(0);
  });

  it("DS-3.4: the Session filter's hits are marked through ui/hits.tsx in the highlight token, adding no width in a sidebar row", async () => {
    const user = userEvent.setup();
    renderApp().snapshot([row({ id: 'a', title: 'Fix the rates' })]);
    await user.type(filterBox(), 'rates');
    const mark = field('a', 'title')!.querySelector('mark')!;
    expect(mark).toHaveAttribute('data-slot', 'hit');
    expect(mark).toHaveClass('bg-highlight', 'text-foreground', 'rounded-sm');
    expect([...mark.classList].filter((c) => /^(p|px|pl|pr|m|mx)-/.test(c))).toEqual([]);
    expect([...mark.classList].some((c) => /needs-you|warning|primary/.test(c))).toBe(false);
  });

  it('SIDE-12.6: a word that matched only what the row hides adds a quiet line naming the field and its text around the match', async () => {
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([
      row({ id: 'p', title: 'Invoices export', firstPrompt: 'please look at the invoices export and then fix the rates rounding on the quarterly report' }),
      row({ id: 'm', title: 'Model one', model: 'claude-opus-5-5' }),
      row({ id: 'shown', title: 'rates shown', firstPrompt: 'rates too' }),
      row({ id: 'pr', title: 'Anvil change' }),
    ]);
    app.emit({ type: 'work', work: work([pr(3719, 'Fix rates rounding', 'pr')]) });
    await user.type(filterBox(), 'rates');
    const line = field('p', 'match')!;
    expect(line).toHaveTextContent(/^Prompt: …nd then fix the rates rounding on the quarterly report$/);
    expect(marks(line)).toEqual(['rates']);
    expect(line).toHaveClass('truncate', 'text-meta', 'pl-6.5');
    expect(line.closest('li')).toBe(rowEl('p'));
    expect(line).toHaveAttribute('title', `Prompt: ${'please look at the invoices export and then fix the rates rounding on the quarterly report'}`);
    // The title shows `rates`: no line, though the prompt matched too.
    expect(field('shown', 'match')).toBeNull();
    expect(field('pr', 'match')).toHaveTextContent('PR #3719: Fix rates rounding');

    // The hidden word's match stays in view, though a shown word matched earlier in the same text.
    await user.clear(filterBox());
    await user.type(filterBox(), 'export rounding');
    expect(field('p', 'match')).toHaveTextContent(/^Prompt: …n fix the rates rounding on the quarterly report$/);
    expect(marks(field('p', 'match'))).toEqual(['rounding']);

    await user.clear(filterBox());
    await user.type(filterBox(), 'opus');
    expect(field('m', 'match')).toHaveTextContent('Model: claude-opus-5-5');
    // The first hidden field in SIDE-12.2's order: the Harness before the prompt.
    await user.clear(filterBox());
    await user.type(filterBox(), 'export claude');
    expect(field('p', 'match')).toHaveTextContent('Harness: Claude Code');

    await user.clear(filterBox());
    expect(document.querySelectorAll('[data-field="match"]')).toHaveLength(0);
  });

  it('SIDE-12.7: with a query the list ends with "Search all messages for", which a click or Enter in the filter hands to History; without one there is none', async () => {
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([row({ id: 'a', title: 'Fix the rates' })]);
    expect(handOff()).toBeNull();
    await user.type(filterBox(), '  ');
    expect(handOff()).toBeNull();
    await user.keyboard('{Enter}');
    expect(app.client.history).not.toHaveBeenCalledWith(expect.objectContaining({ query: expect.stringMatching(/\S/) }));

    await user.clear(filterBox());
    await user.type(filterBox(), 'rates ');
    expect(handOff()).toHaveTextContent('Search all messages for “rates”');
    expect(handOff()!.querySelector('svg')).toHaveClass('lucide-search');
    // After the list, not one of its options.
    const list = screen.getByRole('listbox', { name: 'Sessions' });
    expect(list).not.toContainElement(handOff());
    expect(list.compareDocumentPosition(handOff()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(handOff()!);
    const search = await screen.findByRole('searchbox', { name: 'Search past Sessions' });
    expect(search).toHaveValue('rates');
    expect(search).toHaveFocus();
    expect(filterBox()).toHaveValue('rates ');

    // Nothing matches: the row sits under "No matching Sessions", and Enter hands the query over.
    await user.clear(filterBox());
    await user.type(filterBox(), 'zzz qqq');
    expect(screen.getByText('No matching Sessions')).toBeInTheDocument();
    expect(handOff()).toHaveTextContent('Search all messages for “zzz qqq”');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(search).toHaveValue('zzz qqq'));
    expect(search).toHaveFocus();
    expect(filterBox()).toHaveValue('zzz qqq');
  });

  it('SIDE-12.7: with no live Sessions, a query still ends the list with "Search all messages for", under "No live Sessions"', async () => {
    const user = userEvent.setup();
    renderApp().snapshot([]);
    await user.type(filterBox(), 'rates');
    expect(screen.getByText('No live Sessions')).toBeInTheDocument();
    expect(handOff()).toHaveTextContent('Search all messages for “rates”');
    await user.click(handOff()!);
    expect(await screen.findByRole('searchbox', { name: 'Search past Sessions' })).toHaveValue('rates');
  });

  it('HIST-2.13: a query handed over from the Session filter replaces what was typed in History, is searched as if typed there, and focuses the box, the same query twice too', async () => {
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([row({ id: 'a', title: 'Fix the rates' })]);
    await user.keyboard('h');
    const search = await screen.findByRole('searchbox', { name: 'Search past Sessions' });
    await user.type(search, 'typed before');
    await user.click(filterBox());
    await user.type(filterBox(), 'rates{Enter}');
    expect(search).toHaveValue('rates');
    expect(search).toHaveFocus();
    await waitFor(() => expect(app.client.history).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'rates', page: 1 })));
    // The same query again, with focus moved away: History takes it again.
    await user.click(filterBox());
    await user.keyboard('{Enter}');
    expect(search).toHaveFocus();
    expect(within(screen.getByTestId('history-panel')).getByRole('searchbox')).toHaveValue('rates');
  });
});
