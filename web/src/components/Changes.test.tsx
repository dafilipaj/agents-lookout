import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangedCheckout, ChangedFile, ChangesView } from '@shared/types.ts';
import { SaveError } from '@/lib/client';
import { formatLines } from '@/lib/changes';
import css from '@/index.css?raw';
import { contrast, paint, solid, themeTokens, type Mode } from '@/test/contrast';
import { renderApp, row } from '@/test/helpers';
import { OPEN_ERROR_MS } from './ChangesButton';

const statusLine = () => screen.getByRole('group', { name: 'Status line' });
const option = (name: RegExp) => screen.getByRole('option', { name });

const file = (path: string, o: Partial<ChangedFile> = {}): ChangedFile => ({ path, oldPath: null, kind: 'modified', additions: 3, deletions: 1, binary: false, uncommitted: false, ...o });
const checkout = (root: string, files: ChangedFile[], o: Partial<ChangedCheckout> = {}): ChangedCheckout => ({
  root,
  repo: 'api',
  where: 'fix-rates',
  additions: files.reduce((n, f) => n + f.additions, 0),
  deletions: files.reduce((n, f) => n + f.deletions, 0),
  files,
  moreFiles: 0,
  ...o,
});
const view = (...checkouts: ChangedCheckout[]): ChangesView => ({ sessionId: 'a', checkouts });

afterEach(() => vi.useRealTimers());

describe('the count', () => {
  it('DIFF-1.1: a row shows added lines in green and removed in red, after the Subagent count and before the age; never +0 −0', () => {
    const app = renderApp('/');
    app.snapshot([
      row({ id: 'a', title: 'First', subagents: { running: 2, finished: 0 }, changes: { additions: 120, deletions: 30, files: 4 } }),
      row({ id: 'b', title: 'Second', changes: { additions: 0, deletions: 0, files: 2 } }),
      row({ id: 'c', title: 'Third', changes: null }),
    ]);
    const mark = option(/First/).querySelector<HTMLElement>('[data-field="changes"]')!;
    expect(mark.previousElementSibling).toHaveAttribute('data-field', 'subagents');
    expect(mark.nextElementSibling).toHaveAttribute('data-field', 'age');
    expect(within(mark).getByText('+120')).toHaveClass('text-diff-added-text');
    expect(within(mark).getByText('−30')).toHaveClass('text-diff-removed-text');
    expect(option(/Second/).querySelector('[data-field="changes"]')).toBeNull();
    expect(option(/Third/).querySelector('[data-field="changes"]')).toBeNull();
  });

  it('DIFF-1.2: from 1000 the count is shortened, one decimal below 10k; the tooltip has the exact numbers and the files', () => {
    expect([999, 1000, 1250, 9999, 10_000, 12_345].map(formatLines)).toEqual(['999', '1.0k', '1.2k', '9.9k', '10k', '12k']);
    const app = renderApp('/');
    app.snapshot([row({ id: 'a', title: 'First', changes: { additions: 12_345, deletions: 1250, files: 40 } })]);
    const mark = option(/First/).querySelector<HTMLElement>('[data-field="changes"]')!;
    expect(mark).toHaveTextContent('+12k−1.2k');
    expect(mark.title).toBe('12345 lines added, 1250 removed in 40 files');
  });

  it('DIFF-1.3: the status line shows the count and the files after the location, as a button; files alone without lines', () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', model: 'claude-opus-5-5', changes: { additions: 120, deletions: 30, files: 4 } })]);
    const button = within(statusLine()).getByRole('button', { name: /show changed files/ });
    expect(button).toHaveTextContent('+120−30· 4 files');
    expect(statusLine().textContent).toMatch(/\+120−30· 4 files·.*claude-opus-5-5/);
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', changes: { additions: 0, deletions: 0, files: 2 } })], remove: [] });
    expect(within(statusLine()).getByRole('button', { name: /show changed files/ })).toHaveTextContent(/^2 files$/);
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', changes: null })], remove: [] });
    expect(within(statusLine()).queryByRole('button', { name: /show changed files/ })).toBeNull();
  });

  it("DIFF-1.4: the row's name reads the lines with its numbers; the button's adds the files", () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'First', changes: { additions: 120, deletions: 30, files: 4 } })]);
    expect(option(/First/)).toHaveAccessibleName(expect.stringMatching(/120 lines added, 30 removed/));
    expect(within(statusLine()).getByRole('button', { name: '120 lines added, 30 removed in 4 files, show changed files' })).toBeInTheDocument();
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', title: 'First', changes: { additions: 0, deletions: 0, files: 2 } })], remove: [] });
    expect(within(statusLine()).getByRole('button', { name: '2 files changed, show changed files' })).toBeInTheDocument();
  });

  it('DIFF-1.6: a View only Session shows its count; an ended one shows none', () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'First', controllable: false, backend: 'unknown', changes: { additions: 5, deletions: 0, files: 1 } })]);
    expect(option(/First/).querySelector('[data-field="changes"]')).not.toBeNull();
    expect(within(statusLine()).getByRole('button', { name: /show changed files/ })).toBeInTheDocument();
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    expect(within(statusLine()).queryByRole('button', { name: /show changed files/ })).toBeNull();
  });

  it('DS-2.5: added and removed keep 4.5:1 on the background, the sidebar, every row state, the status line and the popover, in both modes', () => {
    for (const mode of ['light', 'dark'] as Mode[]) {
      const t = themeTokens(css)[mode];
      const sidebar = solid(t, 'sidebar');
      const background = solid(t, 'background');
      const surfaces = [
        background,
        sidebar,
        paint(t, 'sidebar-accent', sidebar, 0.6),
        paint(t, 'sidebar-accent', sidebar),
        paint(t, 'needs-you', sidebar, 0.12),
        paint(t, 'needs-you', sidebar, 0.2),
        paint(t, 'needs-you', sidebar, 0.26),
        paint(t, 'muted', background, 0.3),
        solid(t, 'popover'),
        paint(t, 'accent', solid(t, 'popover')),
      ];
      for (const token of ['diff-added-text', 'diff-removed-text']) {
        for (const s of surfaces) expect(contrast(solid(t, token), s), `${mode} ${token}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('the list', () => {
  async function openList(list: ChangesView | null, options: Parameters<typeof renderApp>[1] = {}, rowOptions: Partial<Parameters<typeof row>[0]> = {}) {
    // The server answers a watch with the list over the event stream (DIFF-3.6).
    const watchChanges = vi.fn(async (_clientId: string, sessionId: string | null) => {
      if (sessionId) app.emit({ type: 'changes', sessionId, changes: list });
    });
    const app = renderApp('/s/a', { watchChanges, ...options });
    app.snapshot([row({ id: 'a', changes: { additions: 9, deletions: 2, files: 3 }, ...rowOptions })]);
    const user = vi.isFakeTimers() ? userEvent.setup({ advanceTimers: vi.advanceTimersByTime }) : userEvent.setup();
    await user.click(within(statusLine()).getByRole('button', { name: /show changed files/ }));
    const panel = await screen.findByRole('dialog');
    return { app, user, panel, watchChanges };
  }

  it('DIFF-3.1: files sorted as sent, with name, folder, numbers, kind and the uncommitted mark', async () => {
    const { panel } = await openList(
      view(
        checkout('/r/api', [
          file('app/models/rates.rb', { additions: 40, deletions: 12 }),
          file('app/utils/rate.ts', { kind: 'added', additions: 24, deletions: 0, uncommitted: true }),
          file('lib/new.rb', { kind: 'renamed', oldPath: 'lib/old.rb' }),
          file('public/logo.png', { kind: 'added', binary: true, additions: 0, deletions: 0 }),
        ]),
      ),
    );
    const rows = within(panel).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual([
      'rates.rbapp/models/+40−12',
      'rate.tsapp/utils/added+24−0uncommitted',
      'new.rblib/lib/old.rb → lib/new.rb+3−1',
      'logo.pngpublic/addedbinary',
    ]);
    expect(within(rows[0]!).getByText('+40')).toHaveClass('text-diff-added-text');
    expect(rows[1]).toHaveAccessibleName('app/utils/rate.ts, added, 24 added, 0 removed, uncommitted, open in VS Code');
  });

  it('DIFF-3.2: a heading per Checkout with its own numbers when there is more than one, none with one', async () => {
    const { panel } = await openList(view(checkout('/r/api', [file('a.rb')]), checkout('/r/fe', [file('b.ts', { additions: 7, deletions: 0 })], { repo: 'frontend', where: 'main' })));
    const sections = within(panel).getAllByRole('region');
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(['api · fix-rates', 'frontend · main']);
    expect(sections[1]).toHaveTextContent(/frontend · main\+7−0/);
  });

  it('DIFF-3.2: with one Checkout there is no heading', async () => {
    const { panel } = await openList(view(checkout('/r/api', [file('a.rb')])));
    expect(within(panel).queryAllByRole('region')).toHaveLength(0);
    expect(panel).not.toHaveTextContent('fix-rates');
  });

  it('DIFF-3.3: the list updates in place; focus moves on when the focused file leaves; "No changes" when none are left', async () => {
    const { app, user, panel } = await openList(view(checkout('/r/api', [file('a.rb'), file('b.rb'), file('c.rb')])));
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toHaveTextContent(/^b\.rb/);
    app.emit({ type: 'changes', sessionId: 'a', changes: view(checkout('/r/api', [file('a.rb'), file('c.rb')])) });
    await waitFor(() => expect(document.activeElement).toHaveTextContent(/^c\.rb/));
    app.emit({ type: 'changes', sessionId: 'a', changes: view(checkout('/r/api', [file('a.rb')])) });
    await waitFor(() => expect(document.activeElement).toHaveTextContent(/^a\.rb/));
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', changes: null })], remove: [] });
    app.emit({ type: 'changes', sessionId: 'a', changes: null });
    expect(within(panel).getByText('No changes')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toHaveRole('textbox');
  });

  it('DIFF-3.3: focus moves to the next file still listed, not the one at the old position', async () => {
    const { app, user } = await openList(view(checkout('/r/api', ['a', 'b', 'c', 'd', 'e'].map((n) => file(`${n}.rb`)))));
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toHaveTextContent(/^c\.rb/);
    app.emit({ type: 'changes', sessionId: 'a', changes: view(checkout('/r/api', [file('d.rb'), file('e.rb')])) });
    await waitFor(() => expect(document.activeElement).toHaveTextContent(/^d\.rb/));
  });

  it('DIFF-3.3: a View-only Session has no composer: Esc on an emptied list returns focus to the chat', async () => {
    const { app, user, panel } = await openList(view(checkout('/r/api', [file('a.rb')])), {}, { controllable: false });
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', changes: null, controllable: false })], remove: [] });
    app.emit({ type: 'changes', sessionId: 'a', changes: null });
    expect(within(panel).getByText('No changes')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(document.activeElement).toHaveAccessibleName('Chat');
  });

  it('DIFF-3.5: a long file name or error is cut, never wider than the row', async () => {
    const long = `${'x'.repeat(240)}.ts`;
    const { panel } = await openList(view(checkout('/r/api', [file(`src/${long}`)])));
    expect(within(panel).getByText(long)).toHaveClass('min-w-0', 'max-w-full', 'truncate');
  });

  it('DIFF-3.4: Up and Down move between files, Enter opens one, Esc closes and returns focus to the count', async () => {
    const openChange = vi.fn(async () => {});
    const { user } = await openList(view(checkout('/r/api', [file('a.rb'), file('b.rb')])), { openChange });
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(document.activeElement).toHaveTextContent(/^a\.rb/);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(openChange).toHaveBeenCalledWith('a', '/r/api', 'b.rb');
    await user.keyboard('{Escape}');
    expect(document.activeElement).toHaveAccessibleName(/show changed files/);
  });

  it('DIFF-3.6: opening the list watches the Session, closing it stops', async () => {
    const { user, watchChanges } = await openList(view(checkout('/r/api', [file('a.rb')])));
    await waitFor(() => expect(watchChanges).toHaveBeenLastCalledWith('tab-1', 'a'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(watchChanges).toHaveBeenLastCalledWith('tab-1', null));
  });

  it('DIFF-3.6: watches reach the server one at a time, in order; a failed one is tried again while it is the latest', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let release!: () => void;
    const calls: (string | null)[] = [];
    let block = true;
    let failNext = false;
    const watchChanges = vi.fn(async (_c: string, sessionId: string | null) => {
      calls.push(sessionId);
      if (sessionId === 'a' && block) {
        block = false;
        await new Promise<void>((r) => (release = r));
      }
      if (sessionId === null && failNext) {
        failNext = false;
        throw new SaveError('no server', null, null);
      }
    });
    const app = renderApp('/s/a', { watchChanges });
    app.snapshot([row({ id: 'a', changes: { additions: 1, deletions: 0, files: 1 } })]);
    await waitFor(() => expect(calls).toEqual([null]));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(within(statusLine()).getByRole('button', { name: /show changed files/ }));
    await user.keyboard('{Escape}');
    await user.click(within(statusLine()).getByRole('button', { name: /show changed files/ }));
    await user.keyboard('{Escape}');
    expect(calls).toEqual([null, 'a']); // the rest wait for it
    failNext = true;
    release();
    // The close and open after it were replaced before their turn: only the latest close goes, and again after failing.
    await waitFor(() => expect(calls).toEqual([null, 'a', null]));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(calls).toEqual([null, 'a', null, null]);
  });

  it("DIFF-4.2, DIFF-4.6: a submodule has no action; a file that didn't open says why for 5 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const openChange = vi.fn(async () => {
      throw new SaveError('VS Code not found', null, null);
    });
    const { user, panel } = await openList(view(checkout('/r/api', [file('a.rb'), file('sub', { kind: 'submodule', additions: 0, deletions: 0 })])), { openChange });
    const [a, sub] = within(panel).getAllByRole('button');
    expect(sub).toHaveAttribute('aria-disabled', 'true');
    expect(sub!.title).toBe('A submodule has no diff to open.');
    await user.click(sub!);
    expect(openChange).not.toHaveBeenCalled();
    await user.click(a!);
    expect(await within(a!).findByText('VS Code not found')).toHaveClass('text-destructive-text');
    act(() => vi.advanceTimersByTime(OPEN_ERROR_MS));
    expect(within(a!).queryByText('VS Code not found')).toBeNull();
  });
});
