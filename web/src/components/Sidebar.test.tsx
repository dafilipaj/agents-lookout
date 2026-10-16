import { FLEET_INSTALL_COMMAND } from '@shared/defaults.ts';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, field, renderApp, row, rowEl, settings, visibleTitles } from '@/test/helpers';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('sidebar rows', () => {
  it('SIDE-2.1: a row shows title, Harness, Status, repo, where it works, and time since the status changed', () => {
    const app = renderApp();
    app.snapshot([
      row({ id: 'a', title: 'fix-deal-rates', harness: 'codex', status: 'busy', statusSince: NOW - 12_000 }),
    ]);
    const r = rowEl('a');
    expect(field('a', 'title')).toHaveTextContent('fix-deal-rates');
    expect(field('a', 'harness')).toHaveTextContent('Codex');
    expect(within(r).getByRole('img', { name: 'Busy' })).toBeInTheDocument();
    expect(field('a', 'repo')).toHaveTextContent('work');
    expect(field('a', 'location')).toHaveTextContent('main');
    expect(field('a', 'age')).toHaveTextContent('12s');

    act(() => vi.advanceTimersByTime(60_000));
    expect(field('a', 'age')).toHaveTextContent('1m');
  });

  it('SIDE-2.2: a linked Worktree shows its name with the worktree icon; otherwise the branch with the branch icon', () => {
    const app = renderApp();
    app.snapshot([
      row({ id: 'wt', git: { repo: 'work', worktree: 'crm-rates', branch: 'feature/crm-rates' } }),
      row({ id: 'br', git: { repo: 'work', worktree: null, branch: 'main' } }),
    ]);
    expect(field('wt', 'location')).toHaveTextContent('crm-rates');
    expect(within(rowEl('wt')).getByLabelText('Worktree')).toHaveAttribute('data-icon', 'worktree');
    expect(within(rowEl('wt')).queryByLabelText('Branch')).toBeNull();

    expect(field('br', 'location')).toHaveTextContent('main');
    expect(within(rowEl('br')).getByLabelText('Branch')).toHaveAttribute('data-icon', 'branch');
    expect(within(rowEl('br')).queryByLabelText('Worktree')).toBeNull();

    // Two different icons, not the same one twice.
    const svg = (id: string) => rowEl(id).querySelector('svg[data-icon]')!.innerHTML;
    expect(svg('wt')).not.toBe(svg('br'));
  });

  it('SIDE-2.3: a Needs you row shows what it waits for, on one line', () => {
    const app = renderApp();
    const waitingFor = 'permission: Bash(bundle exec rspec spec/models/deal_spec.rb --format documentation)';
    app.snapshot([row({ id: 'n', status: 'needs-you', waitingFor }), row({ id: 'i', status: 'idle' })]);
    const line = field('n', 'waiting-for')!;
    expect(line).toHaveTextContent(waitingFor);
    expect(line).toHaveClass('truncate');
    expect(line).toHaveAttribute('title', waitingFor);
    expect(field('i', 'waiting-for')).toBeNull();
  });

  it('SIDE-2.4: context usage shows as a percentage when reported, and not at all otherwise', () => {
    const app = renderApp();
    app.snapshot([row({ id: 'c', contextPct: 41 }), row({ id: 'none', contextPct: null })]);
    expect(field('c', 'context')).toHaveTextContent('41%');
    expect(field('none', 'context')).toBeNull();
    expect(rowEl('none').textContent).not.toContain('%');
  });

  it('SIDE-1.5: Sessions that are not Controllable are shown greyed out', () => {
    const app = renderApp();
    app.snapshot([row({ id: 'orca', backend: 'unknown', controllable: false }), row({ id: 'tmux' })]);
    expect(rowEl('orca')).toHaveAttribute('data-controllable', 'false');
    expect(field('orca', 'title')).toHaveClass('text-muted-foreground');
    expect(within(rowEl('orca')).getByLabelText('Not Controllable')).toBeInTheDocument();
    expect(rowEl('orca').title).toMatch(/Not Controllable/);
    expect(rowEl('tmux')).toHaveAttribute('data-controllable', 'true');
    expect(field('tmux', 'title')).not.toHaveClass('text-muted-foreground');
  });

  it('SIDE-2.5 (support): long text is truncated with the full text on hover', () => {
    const app = renderApp();
    const title = 'a-very-long-session-title-that-cannot-possibly-fit-in-a-280-px-sidebar';
    app.snapshot([row({ id: 'l', title, git: { repo: 'work', worktree: 'a-very-long-worktree-name-too', branch: 'x' } })]);
    expect(field('l', 'title')).toHaveClass('truncate');
    expect(field('l', 'title')).toHaveAttribute('title', title);
    expect(field('l', 'location')).toHaveClass('truncate');
  });
});

describe('status at a glance', () => {
  it('SIDE-3.1: rows are ordered Needs you → Busy → Idle → Unknown, newest status change first', () => {
    const app = renderApp();
    app.snapshot([
      row({ id: 'idle-old', status: 'idle', statusSince: NOW - 9000 }),
      row({ id: 'unknown', status: 'unknown', statusSince: NOW }),
      row({ id: 'busy', status: 'busy', statusSince: NOW - 5000 }),
      row({ id: 'idle-new', status: 'idle', statusSince: NOW - 1000 }),
      row({ id: 'needs', status: 'needs-you', statusSince: NOW - 8000 }),
    ]);
    expect(visibleTitles()).toEqual(['needs', 'busy', 'idle-new', 'idle-old', 'unknown']);
  });

  it('SIDE-3.4 (support): while the pointer is over the sidebar, statuses update but rows keep their places', () => {
    const app = renderApp();
    app.snapshot([row({ id: 'a', status: 'busy' }), row({ id: 'b', status: 'idle' })]);
    const aside = screen.getByRole('complementary', { name: 'Session sidebar' });
    act(() => aside.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    app.emit({ type: 'sessions', upsert: [row({ id: 'b', status: 'needs-you', statusSince: NOW })], remove: [] });
    expect(visibleTitles()).toEqual(['a', 'b']);
    expect(rowEl('b')).toHaveAttribute('data-status', 'needs-you');
    act(() => aside.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body })));
    expect(visibleTitles()).toEqual(['b', 'a']);
  });

  it('SIDE-3.4 (support): rows that arrive during a hover keep their places too', () => {
    const app = renderApp();
    app.snapshot([row({ id: 'a', status: 'busy' })]);
    const aside = screen.getByRole('complementary', { name: 'Session sidebar' });
    act(() => aside.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    app.emit({
      type: 'sessions',
      upsert: [row({ id: 'b', status: 'idle', statusSince: NOW - 1000 }), row({ id: 'c', status: 'idle', statusSince: NOW - 2000 })],
      remove: [],
    });
    expect(visibleTitles()).toEqual(['a', 'b', 'c']);
    app.emit({ type: 'sessions', upsert: [row({ id: 'c', status: 'needs-you', statusSince: NOW })], remove: [] });
    expect(visibleTitles()).toEqual(['a', 'b', 'c']);
    act(() => aside.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body })));
    expect(visibleTitles()).toEqual(['c', 'a', 'b']);
  });

  it('SIDE-3.3: the tab title counts the Sessions that need you, and shows no count when none do', () => {
    const app = renderApp();
    app.snapshot([row({ id: 'a', status: 'needs-you' }), row({ id: 'b', status: 'needs-you' }), row({ id: 'c', status: 'busy' })]);
    expect(document.title).toBe('(2) Lookout');
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'busy' })], remove: [] });
    expect(document.title).toBe('(1) Lookout');
    app.emit({ type: 'sessions', upsert: [], remove: ['b'] });
    expect(document.title).toBe('Lookout');
  });

  it('SIDE-3.5: a Session Idle longer than the threshold is dimmed, and returns to normal when its Status changes', () => {
    const app = renderApp();
    app.snapshot(
      [row({ id: 'old', status: 'idle', statusSince: NOW - 5 * 3_600_000 }), row({ id: 'fresh', status: 'idle', statusSince: NOW - 3 * 3_600_000 })],
      { state: 'ok' },
      settings({ idleThresholdHours: 4 }),
    );
    expect(rowEl('old')).toHaveAttribute('data-dimmed', 'true');
    expect(rowEl('fresh')).toHaveAttribute('data-dimmed', 'false');

    act(() => vi.advanceTimersByTime(3_600_000 + 1000)); // fresh crosses 4 h
    expect(rowEl('fresh')).toHaveAttribute('data-dimmed', 'true');

    app.emit({ type: 'sessions', upsert: [row({ id: 'old', status: 'busy', statusSince: Date.now() })], remove: [] });
    expect(rowEl('old')).toHaveAttribute('data-dimmed', 'false');
  });

  it('SIDE-3.5 / SIDE-7.2: a changed idle threshold applies without reloading', () => {
    const app = renderApp();
    app.snapshot([row({ id: 'x', status: 'idle', statusSince: NOW - 2 * 3_600_000 })]);
    expect(rowEl('x')).toHaveAttribute('data-dimmed', 'false');
    app.emit({ type: 'settings', settings: settings({ idleThresholdHours: 1 }) });
    expect(rowEl('x')).toHaveAttribute('data-dimmed', 'true');
  });
});

describe('filter', () => {
  it('SIDE-5.4: `/` focuses the filter; typing filters by title, repo, Worktree or branch; Esc clears it', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([
      row({ id: 'by-title', title: 'deal rates', git: { repo: 'work', worktree: null, branch: 'main' } }),
      row({ id: 'by-repo', title: 'one', git: { repo: 'fantastic', worktree: null, branch: 'main' } }),
      row({ id: 'by-wt', title: 'two', git: { repo: 'work', worktree: 'invoice-pdf', branch: 'feature/x' } }),
      row({ id: 'by-branch', title: 'three', git: { repo: 'work', worktree: null, branch: 'fix/timesheets' } }),
    ]);
    const input = screen.getByRole('searchbox', { name: 'Filter Sessions' });

    await user.keyboard('/');
    expect(input).toHaveFocus();
    expect(input).toHaveValue(''); // the slash itself isn't typed

    await user.keyboard('deal');
    expect(visibleTitles()).toEqual(['deal rates']);
    await user.clear(input);
    await user.type(input, 'FANTASTIC');
    expect(visibleTitles()).toEqual(['one']);
    await user.clear(input);
    await user.type(input, 'invoice');
    expect(visibleTitles()).toEqual(['two']);
    await user.clear(input);
    await user.type(input, 'timesheets');
    expect(visibleTitles()).toEqual(['three']);

    await user.keyboard('{Escape}');
    expect(input).toHaveValue('');
    expect(input).not.toHaveFocus();
    expect(visibleTitles()).toHaveLength(4);
  });
});

describe('when Fleet fails', () => {
  it('SIDE-6.1: if fleet is not installed, the sidebar says how to install it instead of an empty list', () => {
    const app = renderApp();
    app.snapshot([], { state: 'not-installed', installCommand: FLEET_INSTALL_COMMAND });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Fleet isn't installed");
    expect(alert).toHaveTextContent(FLEET_INSTALL_COMMAND);
    expect(screen.queryByText('No live Sessions')).toBeNull();
  });

  it('SIDE-6.2: when fleet list fails, the last list stays, dimmed, with a banner saying how stale it is; it recovers', () => {
    const app = renderApp();
    app.snapshot([row({ id: 'a' }), row({ id: 'b' })]);
    app.emit({ type: 'fleet', fleet: { state: 'failing', lastOkAt: NOW - 2000, error: 'fleet list timed out after 4 s' } });
    act(() => vi.advanceTimersByTime(10_000));

    expect(visibleTitles()).toEqual(expect.arrayContaining(['a', 'b']));
    expect(screen.getByRole('listbox', { name: 'Sessions' })).toHaveAttribute('data-stale', 'true');
    expect(screen.getByRole('status')).toHaveTextContent("Fleet isn't answering. List is 12s old.");
    expect(screen.getByRole('status')).toHaveAttribute('title', 'fleet list timed out after 4 s');

    app.emit({ type: 'fleet', fleet: { state: 'ok' } });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('listbox', { name: 'Sessions' })).toHaveAttribute('data-stale', 'false');
  });

  it('shows the empty state when no Sessions run', () => {
    const app = renderApp();
    app.snapshot([]);
    expect(screen.getByText('No live Sessions')).toBeInTheDocument();
  });

  it('keeps the list, dimmed, while the Lookout server is unreachable', () => {
    const app = renderApp();
    app.snapshot([row({ id: 'a' })]);
    app.connection(false);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
    expect(screen.getByRole('listbox', { name: 'Sessions' })).toHaveAttribute('data-stale', 'true');
  });
});
