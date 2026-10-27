import { FLEET_INSTALL_COMMAND } from '@shared/defaults.ts';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROW_TONE } from '@/lib/sessions';
import { NOW, field, renderApp, row, rowEl, settings, visibleTitles } from '@/test/helpers';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

/** The sidebar's banner (SIDE-6.2): an info Alert (DS-4) above the list. The usage strip has a status region of its own. */
const banner = () => document.querySelector<HTMLElement>('aside[aria-label="Session sidebar"] [data-slot="alert"]');

/** Real timers for userEvent, but the clock pinned at NOW, which the rows' times are built from. */
function pinDate() {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
}

describe('sidebar rows', () => {
  it('SIDE-9.1: only running Subagents show, first in the numbers group before age and context', () => {
    const app = renderApp();
    app.snapshot([1, 2, 0, null].map((running, i) => row({ id: `s${i}`, contextPct: 23,
      subagents: running === null ? null : { running, finished: 3 } })));
    for (const [id, count] of [['s0', '1'], ['s1', '2']] as const) {
      const chip = field(id, 'subagents')!;
      expect(chip).toHaveTextContent(count);
      expect(chip.parentElement).toHaveClass('shrink-0', 'tabular-nums');
      expect(chip.parentElement!.firstElementChild).toBe(chip);
      expect(chip.nextElementSibling).toBe(field(id, 'age'));
      expect(chip.nextElementSibling!.nextElementSibling).toBe(field(id, 'context'));
      expect(chip.querySelector('svg')).toHaveClass('size-2.5');
    }
    for (const id of ['s2', 's3']) expect(field(id, 'subagents')).toBeNull();
    // At the default location the count is still first among the numbers, with the slot empty before it.
    app.snapshot([row({ id: 'h', contextPct: 23, subagents: { running: 2, finished: 0 }, locationShown: { repo: false, where: false } })]);
    const chip = field('h', 'subagents')!;
    expect(chip.previousElementSibling).toBeNull();
    expect(chip.parentElement!.previousElementSibling).toBe(field('h', 'slot'));
    expect(field('h', 'slot')).toBeEmptyDOMElement();
    expect(chip.nextElementSibling).toBe(field('h', 'age'));
  });

  it('SIDE-9.2: count updates keep the row order, Status, marker, strip and age, also under the pointer', () => {
    const app = renderApp();
    const a = row({ id: 'a', status: 'idle', subagents: { running: 1, finished: 0 } });
    const b = row({ id: 'b', status: 'busy' });
    app.snapshot([a, b]);
    const before = visibleTitles();
    const r = rowEl('a');
    const marker = within(r).getByRole('img', { name: 'Idle' });
    const strip = field('a', 'strip');
    const age = field('a', 'age')!.textContent;
    for (const hovered of [false, true]) {
      if (hovered) fireEvent.pointerEnter(screen.getByRole('complementary', { name: 'Session sidebar' }));
      app.emit({ type: 'sessions', upsert: [{ ...a, subagents: { running: hovered ? 3 : 2, finished: 1 } }], remove: [] });
      expect(visibleTitles()).toEqual(before);
      expect(rowEl('a')).toBe(r);
      expect(r).toHaveAttribute('data-status', 'idle');
      expect(within(r).getByRole('img', { name: 'Idle' })).toBe(marker);
      expect(field('a', 'strip')).toBe(strip);
      expect(strip).toHaveClass('bg-idle');
      expect(field('a', 'age')).toHaveTextContent(age!);
      expect(field('a', 'subagents')).toHaveTextContent(hovered ? '3' : '2');
    }
  });

  it('SIDE-9.3: a View only row shows the same count and loses it with its Session', () => {
    const app = renderApp();
    app.snapshot([row({ id: 'a', backend: 'unknown', controllable: false, subagents: { running: 2, finished: 0 } })]);
    expect(within(screen.getByRole('group', { name: 'View only' })).getByRole('option')).toBe(rowEl('a'));
    expect(field('a', 'subagents')).toHaveTextContent('2');
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    expect(document.querySelector('[data-field="subagents"]')).toBeNull();
  });

  it('SIDE-9.6: the count has a singular or plural name and tooltip before the age, with a hidden icon and the row\'s quiet colour', () => {
    const app = renderApp();
    app.snapshot([row({ id: 'a', subagents: { running: 1, finished: 0 } }),
      row({ id: 'b', status: 'needs-you', subagents: { running: 2, finished: 0 } }), row({ id: 'c' })]);
    for (const [id, label, tone] of [['a', '1 Subagent running', ROW_TONE.plain], ['b', '2 Subagents running', ROW_TONE.needsYou]] as const) {
      const chip = field(id, 'subagents')!;
      expect(chip).toHaveAttribute('title', label);
      expect(chip).toHaveAccessibleName(label);
      expect(chip.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(chip.closest('.text-meta')).toHaveClass(tone.quiet);
      expect(rowEl(id)).toHaveAccessibleName(new RegExp(`${label}.*1m`));
    }
    expect(rowEl('c')).not.toHaveAccessibleName(/Subagent/);
  });

  it('SIDE-2.1: a row shows title, Harness, Status, repo, where it works, and time since the status changed', () => {
    const app = renderApp();
    app.snapshot([
      row({ id: 'a', title: 'fix-deal-rates', harness: 'codex', status: 'busy', statusSince: NOW - 12_000 }),
    ]);
    const r = rowEl('a');
    expect(field('a', 'title')).toHaveTextContent('fix-deal-rates');
    expect(within(field('a', 'harness')!).getByRole('img', { name: 'Codex' })).toHaveAttribute('data-harness', 'codex');
    expect(within(r).getByRole('img', { name: 'Busy' })).toBeInTheDocument();
    expect(field('a', 'repo')).toHaveTextContent('work');
    expect(field('a', 'location')).toHaveTextContent('main');
    expect(field('a', 'age')).toHaveTextContent('12s');

    act(() => vi.advanceTimersByTime(60_000));
    expect(field('a', 'age')).toHaveTextContent('1m');
  });

  it('SIDE-2.1: the second line shows the location only away from the default, and what the Session waits for or, when Busy, does', () => {
    const app = renderApp();
    const hidden = { repo: false, where: false };
    app.snapshot([
      row({ id: 'quiet', status: 'idle', locationShown: hidden }),
      row({ id: 'away', status: 'idle', git: { repo: 'work', worktree: null, branch: 'fix/rates', commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' }, locationShown: { repo: false, where: true } }),
      row({ id: 'waits', status: 'needs-you', waitingFor: 'input needed', locationShown: hidden }),
      row({ id: 'does', status: 'busy', activity: 'Edit: web/src/lantern.ts', locationShown: hidden }),
    ]);
    expect(field('quiet', 'slot')).toBeEmptyDOMElement();
    expect(field('away', 'location')).toHaveTextContent('fix/rates');
    expect(field('away', 'repo')).toBeNull();
    expect(field('waits', 'waiting-for')).toHaveTextContent('input needed');
    expect(field('does', 'activity')).toHaveTextContent('Edit: web/src/lantern.ts');
    for (const id of ['quiet', 'away', 'waits', 'does']) expect(field(id, 'age')).toHaveTextContent('1m');
  });

  it('SIDE-2.2: a linked Worktree shows its name with the worktree icon; otherwise the branch with the branch icon', () => {
    const app = renderApp();
    app.snapshot([
      row({ id: 'wt', git: { repo: 'work', worktree: 'crm-rates', branch: 'feature/crm-rates', commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' } }),
      row({ id: 'br', git: { repo: 'work', worktree: null, branch: 'main', commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' } }),
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

  describe('what varies (SIDE-2.7 – 2.15)', () => {
    const repoGit = (repo: string, worktree: string | null, branch: string | null) =>
      ({ repo, worktree, branch, commonDir: `/p/${repo}/.git`, defaultBranch: 'main' });
    const HIDDEN = { repo: false, where: false };
    const slot = (id: string) => field(id, 'slot')!;

    it('SIDE-2.7: a row at the default location shows no repo, Worktree or branch: its second line is the numbers alone', () => {
      const app = renderApp();
      app.snapshot([row({ id: 'idle', status: 'idle', locationShown: HIDDEN, contextPct: 23 }),
        row({ id: 'unknown', status: 'unknown', locationShown: HIDDEN })]);
      for (const id of ['idle', 'unknown']) {
        expect(field(id, 'repo')).toBeNull();
        expect(field(id, 'location')).toBeNull();
        expect(rowEl(id).querySelector('svg[data-icon]')).toBeNull();
        expect(slot(id)).toBeEmptyDOMElement();
        expect(field(id, 'age')).toBeInTheDocument();
      }
      expect(rowEl('idle')).toHaveAccessibleName('IdleidleClaude Code 1m23%');
    });

    it('SIDE-2.7: the where part shows by itself when the repo part is hidden (a Worktree or another branch in the only repo)', () => {
      const app = renderApp();
      app.snapshot([
        row({ id: 'wt', git: repoGit('work', 'crm-rates', 'fix/rates'), locationShown: { repo: false, where: true } }),
        row({ id: 'br', git: repoGit('work', null, 'fix/rates'), locationShown: { repo: false, where: true } }),
      ]);
      expect(field('wt', 'repo')).toBeNull();
      expect(field('wt', 'location')).toHaveTextContent('crm-rates');
      expect(within(rowEl('wt')).getByLabelText('Worktree')).toBeInTheDocument();
      expect(field('br', 'location')).toHaveTextContent('fix/rates');
      expect(within(rowEl('br')).getByLabelText('Branch')).toBeInTheDocument();
    });

    it('SIDE-2.10: another repo shows its name first: `other-repo · [br] fix/x`, and on its default branch the name alone', () => {
      const app = renderApp();
      app.snapshot([
        row({ id: 'branch', git: repoGit('other-repo', null, 'fix/x'), locationShown: { repo: true, where: true } }),
        row({ id: 'default', git: repoGit('other-repo', null, 'main'), locationShown: { repo: true, where: false } }),
      ]);
      expect(slot('branch').textContent).toBe('other-repo·fix/x');
      expect(slot('branch').children[0]).toBe(field('branch', 'repo'));
      expect(field('branch', 'location')).toHaveTextContent('fix/x');
      expect(slot('default').textContent).toBe('other-repo');
      expect(field('default', 'location')).toBeNull();
      expect(slot('default')).not.toHaveAttribute('aria-hidden');
    });

    it('SIDE-2.3 / 2.10: with no location to show, what a Needs you row waits for takes the slot, in the Needs you colour, with no third line', () => {
      const app = renderApp();
      app.snapshot([row({ id: 'n', status: 'needs-you', waitingFor: 'permission: Bash(ls)', locationShown: HIDDEN })]);
      const words = field('n', 'waiting-for')!;
      expect(words.parentElement).toBe(slot('n'));
      expect(words).toHaveTextContent('permission: Bash(ls)');
      expect(words).toHaveClass('truncate', 'font-medium', 'text-needs-you-text');
      expect(slot('n')).not.toHaveAttribute('aria-hidden');
      expect(rowEl('n').querySelectorAll('[data-field="waiting-for"]')).toHaveLength(1);
      expect(rowEl('n').lastElementChild).toBe(slot('n').parentElement);
    });

    it('SIDE-2.3 / 2.10: when the location shows, the waiting-for goes on a third line under it, as before', () => {
      const app = renderApp();
      app.snapshot([
        row({ id: 'wt', status: 'needs-you', waitingFor: 'input needed', git: repoGit('work', 'crm-rates', 'x'), locationShown: { repo: false, where: true } }),
        row({ id: 'repo', status: 'needs-you', waitingFor: 'input needed', git: repoGit('other', null, 'main'), locationShown: { repo: true, where: false } }),
      ]);
      for (const id of ['wt', 'repo']) {
        const words = field(id, 'waiting-for')!;
        expect(words.parentElement).toBe(rowEl(id));
        expect(words.previousElementSibling).toBe(slot(id).parentElement);
        expect(words).toHaveClass('truncate', 'font-medium', 'text-needs-you-text');
      }
    });

    it('SIDE-2.10 / 2.11: at the default location a Busy row\'s activity takes the slot, in the row\'s quieter colour, with no third line', () => {
      const app = renderApp();
      app.snapshot([row({ id: 'busy', status: 'busy', activity: 'Bash: pnpm vitest run', locationShown: HIDDEN })]);
      const words = field('busy', 'activity')!;
      expect(words.parentElement).toBe(slot('busy'));
      expect(slot('busy').textContent).toBe('Bash: pnpm vitest run');
      expect(words).toHaveClass('min-w-0', 'truncate', ROW_TONE.plain.quiet);
      expect(words).not.toHaveClass('font-medium', 'text-needs-you-text');
      expect(slot('busy')).not.toHaveAttribute('aria-hidden');
      expect(rowEl('busy').lastElementChild).toBe(slot('busy').parentElement);
    });

    it('SIDE-2.10 / 2.11: a Busy row with no activity reported looks like an Idle one with the same location', () => {
      const app = renderApp();
      app.snapshot([
        row({ id: 'busy', status: 'busy', locationShown: HIDDEN }),
        row({ id: 'codex', status: 'busy', harness: 'codex', locationShown: HIDDEN }),
        row({ id: 'idle', status: 'idle', locationShown: HIDDEN }),
        row({ id: 'busy-wt', status: 'busy', git: repoGit('work', 'crm-rates', 'x'), locationShown: { repo: false, where: true } }),
        row({ id: 'idle-wt', status: 'idle', git: repoGit('work', 'crm-rates', 'x'), locationShown: { repo: false, where: true } }),
      ]);
      for (const [busy, idle] of [['busy', 'idle'], ['codex', 'idle'], ['busy-wt', 'idle-wt']] as const) {
        expect(field(busy, 'activity')).toBeNull();
        expect(slot(busy).innerHTML).toBe(slot(idle).innerHTML);
        expect(rowEl(busy).lastElementChild!.className).toBe(rowEl(idle).lastElementChild!.className);
        expect(rowEl(busy).querySelectorAll(':scope > div')).toHaveLength(2);
      }
      expect(slot('busy')).toHaveAttribute('aria-hidden', 'true');
    });

    it('SIDE-2.10 / 2.11: when the location shows, the activity goes on a third line under it, in the row\'s quieter colour', () => {
      const app = renderApp();
      app.snapshot([
        row({ id: 'wt', status: 'busy', activity: 'Grep: needle', git: repoGit('work', 'crm-rates', 'x'), locationShown: { repo: false, where: true } }),
        row({ id: 'repo', status: 'busy', activity: 'Grep: needle', git: repoGit('other', null, 'main'), locationShown: { repo: true, where: false } }),
      ]);
      for (const id of ['wt', 'repo']) {
        const words = field(id, 'activity')!;
        expect(words.parentElement).toBe(rowEl(id));
        expect(words.previousElementSibling).toBe(slot(id).parentElement);
        expect(words).toHaveClass('block', 'truncate', 'text-meta', ROW_TONE.plain.quiet);
        expect(words).toHaveAttribute('title', 'Grep: needle');
        expect(slot(id)).not.toHaveTextContent('Grep');
      }
    });

    it('SIDE-2.11: the activity shows only while Busy; an Idle, Needs you or Unknown row ignores it', () => {
      const app = renderApp();
      const activity = 'Edit: web/src/stale.ts';
      app.snapshot([
        row({ id: 'idle', status: 'idle', activity, locationShown: HIDDEN }),
        row({ id: 'unknown', status: 'unknown', activity, locationShown: HIDDEN }),
        row({ id: 'needs', status: 'needs-you', activity, locationShown: HIDDEN }),
        row({ id: 'needs-w', status: 'needs-you', waitingFor: 'input needed', activity, locationShown: HIDDEN }),
      ]);
      for (const id of ['idle', 'unknown', 'needs', 'needs-w']) {
        expect(field(id, 'activity')).toBeNull();
        expect(rowEl(id)).not.toHaveTextContent('stale');
      }
      expect(slot('idle')).toBeEmptyDOMElement();
      expect(field('needs-w', 'waiting-for')).toHaveTextContent('input needed');
    });

    it('SIDE-2.11: an activity change changes the row\'s text only: not its Status, order, marker, strip or age, also under the pointer', () => {
      const app = renderApp();
      const a = row({ id: 'a', status: 'busy', activity: 'Thinking', locationShown: HIDDEN, statusSince: NOW - 30_000 });
      const b = row({ id: 'b', status: 'busy', statusSince: NOW - 10_000 });
      app.snapshot([a, b]);
      const before = visibleTitles();
      const r = rowEl('a');
      const marker = within(r).getByRole('img', { name: 'Busy' });
      const strip = field('a', 'strip');
      const age = field('a', 'age')!.textContent;
      for (const [hovered, activity] of [[false, 'Bash: pnpm lint'], [true, 'Edit: web/src/lantern.ts'], [true, null]] as const) {
        if (hovered) fireEvent.pointerEnter(screen.getByRole('complementary', { name: 'Session sidebar' }));
        app.emit({ type: 'sessions', upsert: [{ ...a, activity }], remove: [] });
        expect(visibleTitles()).toEqual(before);
        expect(rowEl('a')).toBe(r);
        expect(r).toHaveAttribute('data-status', 'busy');
        expect(within(r).getByRole('img', { name: 'Busy' })).toBe(marker);
        expect(field('a', 'strip')).toBe(strip);
        expect(strip).toHaveClass('bg-busy');
        expect(field('a', 'age')).toHaveTextContent(age!);
        if (activity) expect(field('a', 'activity')).toHaveTextContent(activity);
        else expect(slot('a')).toBeEmptyDOMElement();
      }
    });

    it('SIDE-2.10: the numbers group sits at the line\'s end in every case, after the slot', () => {
      const app = renderApp();
      app.snapshot([
        row({ id: 'a', locationShown: HIDDEN, subagents: { running: 2, finished: 0 }, contextPct: 9 }),
        row({ id: 'b', git: repoGit('other', null, 'x'), locationShown: { repo: true, where: true }, subagents: { running: 2, finished: 0 }, contextPct: 9 }),
        row({ id: 'c', status: 'needs-you', waitingFor: 'w', locationShown: HIDDEN, subagents: { running: 2, finished: 0 }, contextPct: 9 }),
      ]);
      for (const id of ['a', 'b', 'c']) {
        const numbers = field(id, 'subagents')!.parentElement!;
        expect(numbers).toHaveClass('shrink-0');
        expect(numbers).toBe(slot(id).parentElement!.lastElementChild);
        expect(numbers.previousElementSibling).toBe(slot(id));
        expect(numbers.children).toHaveLength(3); // Subagents, age, context
      }
    });

    it('SIDE-2.12: the slot\'s tooltip has the full location, shown or not; outside git, the working directory\'s path', () => {
      const app = renderApp();
      app.snapshot([
        row({ id: 'hidden', locationShown: HIDDEN }),
        row({ id: 'wt', git: repoGit('work', 'crm-rates', 'fix/rates'), locationShown: { repo: false, where: true } }),
        row({ id: 'detached', git: repoGit('work', null, 'a1b2c3d'), locationShown: { repo: false, where: true } }),
        row({ id: 'nogit', git: null, cwd: '/Users/me/field-notes/deep', locationShown: { repo: true, where: false } }),
        row({ id: 'words', status: 'needs-you', waitingFor: 'input needed', locationShown: HIDDEN }),
      ]);
      expect(slot('hidden')).toHaveAttribute('title', 'work · main');
      expect(slot('wt')).toHaveAttribute('title', 'work · Worktree crm-rates (branch fix/rates)');
      expect(slot('detached')).toHaveAttribute('title', 'work · a1b2c3d');
      expect(slot('nogit')).toHaveAttribute('title', '/Users/me/field-notes/deep');
      expect(field('nogit', 'cwd')).toHaveTextContent('deep');
      // The words fill the slot, so their own tooltip carries the location after them; the slot has it too.
      expect(slot('words')).toHaveAttribute('title', 'work · main');
      expect(field('words', 'waiting-for')).toHaveAttribute('title', 'input needed\nwork · main');
    });

    it('SIDE-2.11 / 2.12: the activity\'s tooltip is its whole text, then the location on a second line', () => {
      const app = renderApp();
      const activity = `Bash: ${'pnpm vitest run web/src/components '.repeat(3).trim()}`;
      app.snapshot([row({ id: 'busy', status: 'busy', activity, locationShown: HIDDEN })]);
      expect(field('busy', 'activity')).toHaveAttribute('title', `${activity}\nwork · main`);
      expect(field('busy', 'activity')).toHaveTextContent(activity);
      expect(slot('busy')).toHaveAttribute('title', 'work · main');
    });

    it('SIDE-2.13: the filter matches the title, repo, Worktree and branch whether or not the row shows them', async () => {
      pinDate();
      const user = userEvent.setup();
      const app = renderApp();
      app.snapshot([
        row({ id: 'on-main', locationShown: HIDDEN }),
        row({ id: 'in-wt', git: repoGit('work', 'crm-rates', 'fix/rates'), locationShown: { repo: false, where: true } }),
        row({ id: 'other', git: repoGit('harbor', null, 'main'), locationShown: { repo: true, where: false } }),
      ]);
      const input = screen.getByRole('searchbox', { name: 'Filter Sessions' });
      await user.type(input, 'main');
      expect(visibleTitles().sort()).toEqual(['on-main', 'other']);
      await user.clear(input);
      await user.type(input, 'work');
      expect(visibleTitles().sort()).toEqual(['in-wt', 'on-main']);
      await user.clear(input);
      await user.type(input, 'fix/rates');
      expect(visibleTitles()).toEqual(['in-wt']);
    });

    it('SIDE-2.14 (support): the numbers never shrink; the where part shrinks before the repo part, which keeps its 45% cap; the line keeps its height empty', () => {
      const app = renderApp();
      app.snapshot([row({ id: 'long', git: repoGit('a-repo-with-a-rather-long-name', null, 'fix/a-branch-name-that-is-long'), locationShown: { repo: true, where: true }, contextPct: 12 }),
        row({ id: 'empty', locationShown: HIDDEN }),
        row({ id: 'busy', status: 'busy', activity: 'Bash: a command line long enough to need cutting at 280 px', locationShown: HIDDEN, contextPct: 12 })]);
      expect(field('long', 'repo')).toHaveClass('max-w-[45%]', 'shrink-0', 'truncate');
      expect(field('long', 'location')!.parentElement).toHaveClass('min-w-0');
      expect(field('long', 'location')).toHaveClass('truncate');
      expect(field('long', 'age')!.parentElement).toHaveClass('shrink-0');
      for (const id of ['long', 'empty', 'busy']) expect(slot(id).parentElement).toHaveClass('min-h-4', 'leading-4');
      // The Session's words truncate in the slot, beside numbers that never shrink.
      expect(field('busy', 'activity')).toHaveClass('min-w-0', 'truncate');
      expect(field('busy', 'age')!.parentElement).toHaveClass('shrink-0');
    });

    it('SIDE-2.15: the accessible name says what the row shows: repo, Worktree or branch, what it waits for, then the numbers', () => {
      const app = renderApp();
      app.snapshot([
        row({ id: 'hidden', locationShown: HIDDEN, contextPct: 5 }),
        row({ id: 'other', git: repoGit('harbor', null, 'fix/x'), locationShown: { repo: true, where: true } }),
        row({ id: 'wt', git: repoGit('work', 'lantern', 'x'), locationShown: { repo: false, where: true }, subagents: { running: 2, finished: 0 } }),
        row({ id: 'words', status: 'needs-you', waitingFor: 'input needed', locationShown: HIDDEN, contextPct: 41 }),
        row({ id: 'third', status: 'needs-you', waitingFor: 'input needed', git: repoGit('work', 'lantern', 'x'), locationShown: { repo: false, where: true } }),
      ]);
      expect(rowEl('hidden')).toHaveAccessibleName('IdlehiddenClaude Code 1m5%');
      expect(rowEl('other')).toHaveAccessibleName('IdleotherClaude Code harborBranchfix/x1m');
      expect(rowEl('wt')).toHaveAccessibleName('IdlewtClaude Code Worktreelantern2 Subagents running1m');
      expect(rowEl('words')).toHaveAccessibleName('Needs youwordsClaude Code input needed1m41%');
      // A third line comes after the numbers, in the order the row shows them.
      expect(rowEl('third')).toHaveAccessibleName('Needs youthirdClaude Code Worktreelantern1m input needed');
    });

    it('SIDE-2.15: a Busy row\'s activity is read where it shows: in the slot before the numbers, or after them from a third line', () => {
      const app = renderApp();
      app.snapshot([
        row({ id: 'slot', status: 'busy', activity: 'Edit: web/src/lantern.ts', locationShown: HIDDEN, contextPct: 12 }),
        row({ id: 'third', status: 'busy', activity: 'Edit: web/src/lantern.ts', git: repoGit('work', 'lantern', 'x'), locationShown: { repo: false, where: true } }),
        row({ id: 'none', status: 'busy', locationShown: HIDDEN }),
        row({ id: 'idle', status: 'idle', activity: 'Edit: web/src/lantern.ts', locationShown: HIDDEN }),
      ]);
      expect(rowEl('slot')).toHaveAccessibleName('BusyslotClaude Code Edit: web/src/lantern.ts1m12%');
      expect(rowEl('third')).toHaveAccessibleName('BusythirdClaude Code Worktreelantern1m Edit: web/src/lantern.ts');
      // Nothing is read for an activity the row doesn't show, nor the hidden default location.
      expect(rowEl('none')).toHaveAccessibleName('BusynoneClaude Code 1m');
      expect(rowEl('idle')).toHaveAccessibleName('IdleidleClaude Code 1m');
    });
  });

  it('SIDE-2.4: context usage shows as a percentage when reported, and not at all otherwise', () => {
    const app = renderApp();
    app.snapshot([row({ id: 'c', contextPct: 41 }), row({ id: 'none', contextPct: null })]);
    expect(field('c', 'context')).toHaveTextContent('41%');
    expect(field('none', 'context')).toBeNull();
    expect(rowEl('none').textContent).not.toContain('%');
  });

  it('SIDE-2.6: an Idle row with a background shell running is an Idle row with a terminal mark before the age', () => {
    const app = renderApp();
    app.snapshot([
      row({ id: 'busy', status: 'busy', statusSince: NOW - 5000 }),
      row({ id: 'shell', status: 'idle', backgroundShell: true, contextPct: 12, statusSince: NOW - 120_000 }),
      row({ id: 'plain', status: 'idle', statusSince: NOW - 1000 }),
      row({ id: 'unknown', status: 'unknown', statusSince: NOW }),
    ]);
    expect(visibleTitles()).toEqual(['busy', 'plain', 'shell', 'unknown']);
    const r = rowEl('shell');
    expect(r).toHaveAttribute('data-status', 'idle');
    expect(within(r).getByRole('img', { name: 'Idle' })).toBeInTheDocument();
    expect(field('shell', 'strip')).toHaveClass('bg-idle');
    const mark = field('shell', 'background-shell')!;
    expect(mark).toHaveAttribute('title', 'A background shell command is still running');
    expect(mark).toHaveClass('text-idle-text');
    expect(within(mark).getByRole('img', { name: 'background shell running' })).toBeInTheDocument();
    expect(mark.nextElementSibling).toBe(field('shell', 'age'));
    expect(r).toHaveAccessibleName('IdleshellClaude Code workBranchmainbackground shell running2m12%');
    expect(field('plain', 'background-shell')).toBeNull();
    expect(rowEl('plain')).toHaveAccessibleName('IdleplainClaude Code workBranchmain1s');
  });

  it('SIDE-1.5: Sessions that are not Controllable are shown in their own "View only" section', () => {
    const app = renderApp();
    app.snapshot([row({ id: 'orca', backend: 'unknown', controllable: false, status: 'needs-you' }), row({ id: 'tmux', status: 'idle' })]);
    const viewOnly = screen.getByRole('group', { name: 'View only' });
    expect(within(viewOnly).getAllByRole('option').map((o) => o.getAttribute('data-session-id'))).toEqual(['orca']);
    const controllable = screen.getByRole('group', { name: 'Controllable' });
    expect(within(controllable).getAllByRole('option').map((o) => o.getAttribute('data-session-id'))).toEqual(['tmux']);
    // A Needs you Session in another app still comes after the Controllable ones.
    expect(visibleTitles()).toEqual(['tmux', 'orca']);
    expect(rowEl('orca').title).toMatch(/Not Controllable/);
    expect(document.querySelector('[data-icon="watch-only"]')).toBeNull(); // no eye: it read as the opposite
  });

  it('SIDE-1.5: no "View only" header without such Sessions; with only them, the start hint stays above it', () => {
    const app = renderApp();
    app.snapshot([row({ id: 'a' })]);
    expect(screen.queryByRole('group', { name: 'View only' })).toBeNull();
    app.snapshot([row({ id: 'orca', backend: 'unknown', controllable: false })]);
    expect(screen.getByText('No Sessions Lookout can control')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'View only' })).toBeInTheDocument();
    const hint = screen.getByText('No Sessions Lookout can control');
    expect(hint.compareDocumentPosition(screen.getByRole('group', { name: 'View only' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('SIDE-2.5 (support): long text is truncated with the full text on hover', () => {
    const app = renderApp();
    const title = 'a-very-long-session-title-that-cannot-possibly-fit-in-a-280-px-sidebar';
    app.snapshot([row({ id: 'l', title, git: { repo: 'work', worktree: 'a-very-long-worktree-name-too', branch: 'x', commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' } })]);
    expect(field('l', 'title')).toHaveClass('truncate');
    expect(field('l', 'title')).toHaveAttribute('title', title);
    expect(field('l', 'location')).toHaveClass('truncate');
  });
});

describe('status at a glance', () => {
  it('SIDE-3.1: Controllable Sessions first, then "View only"; each ordered Needs you → Busy → Idle → Unknown, newest first', () => {
    const app = renderApp();
    const other = { backend: 'unknown' as const, controllable: false };
    app.snapshot([
      row({ id: 'v-idle', status: 'idle', ...other }),
      row({ id: 'c-idle', status: 'idle' }),
      row({ id: 'v-needs', status: 'needs-you', ...other }),
      row({ id: 'c-busy', status: 'busy' }),
      row({ id: 'v-busy', status: 'busy', ...other }),
    ]);
    expect(visibleTitles()).toEqual(['c-busy', 'c-idle', 'v-needs', 'v-busy', 'v-idle']);
  });

  it('SIDE-3.1: within a section, rows are ordered Needs you → Busy → Idle → Unknown, newest status change first', () => {
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

  it("SIDE-3.6: each row has a strip down its left edge in its Status's colour; a View only row's is fainter", () => {
    const app = renderApp();
    app.snapshot([
      row({ id: 'n', status: 'needs-you' }),
      row({ id: 'b', status: 'busy' }),
      row({ id: 'i', status: 'idle' }),
      row({ id: 'u', status: 'unknown' }),
      row({ id: 'v', status: 'busy', backend: 'unknown', controllable: false }),
    ]);
    const strip = (id: string) => field(id, 'strip')!;
    for (const id of ['n', 'b', 'i', 'u', 'v']) {
      expect(strip(id)).toHaveClass('absolute', 'left-0.5', 'w-[3px]');
      expect(rowEl(id).firstElementChild).toBe(strip(id));
    }
    expect(strip('n')).toHaveClass('bg-needs-you');
    expect(strip('b')).toHaveClass('bg-busy');
    expect(strip('i')).toHaveClass('bg-idle');
    expect(strip('u').className).toMatch(/bg-\[repeating-linear-gradient\(.*var\(--color-idle\)/); // dashed, like its marker
    expect(strip('v')).toHaveClass('bg-busy', 'opacity-60');
    expect(strip('b')).not.toHaveClass('opacity-60');

    // It follows the Status live.
    app.emit({ type: 'sessions', upsert: [row({ id: 'b', status: 'needs-you', statusSince: NOW })], remove: [] });
    expect(strip('b')).toHaveClass('bg-needs-you');
    expect(strip('b')).not.toHaveClass('bg-busy');
  });

  it('SIDE-3.7: a Needs you row is tinted with the Needs you colour, Controllable or View only; no other Status tints its row', () => {
    const app = renderApp();
    const other = { backend: 'unknown' as const, controllable: false };
    app.snapshot([
      row({ id: 'n', status: 'needs-you' }),
      row({ id: 'vn', status: 'needs-you', ...other }),
      row({ id: 'b', status: 'busy' }),
      row({ id: 'i', status: 'idle' }),
      row({ id: 'u', status: 'unknown' }),
      row({ id: 'vb', status: 'busy', ...other }),
    ]);
    // The background at rest: classes without a variant (`hover:` is SIDE-3.9's).
    const background = (id: string) => [...rowEl(id).classList].filter((c) => c.startsWith('bg-'));
    expect(background('n')).toEqual(['bg-needs-you/16']);
    expect(background('vn')).toEqual(['bg-needs-you/16']);
    for (const id of ['b', 'i', 'u', 'vb']) expect(background(id)).toEqual([]);

    app.emit({ type: 'sessions', upsert: [row({ id: 'b', status: 'needs-you', statusSince: NOW })], remove: [] });
    expect(background('b')).toEqual(['bg-needs-you/16']);
    app.emit({ type: 'sessions', upsert: [row({ id: 'n', status: 'idle', statusSince: NOW })], remove: [] });
    expect(background('n')).toEqual([]);
  });

  it('SIDE-3.9 (support): the selected row has a ring on every Status, and the pointer changes a Needs you row too', () => {
    const app = renderApp('/s/n');
    app.snapshot([row({ id: 'n', status: 'needs-you' }), row({ id: 'n2', status: 'needs-you' }), row({ id: 'b', status: 'busy' })]);
    expect(rowEl('n')).toHaveClass('ring-1', 'bg-needs-you/28');
    expect(rowEl('n2')).not.toHaveClass('ring-1');
    // Under the pointer, a tinted row gets more tint than at rest, but less than the selected one.
    expect(rowEl('n2')).toHaveClass('bg-needs-you/16', 'hover:bg-needs-you/22');
    expect(rowEl('b')).not.toHaveClass('ring-1');

    app.emit({ type: 'sessions', upsert: [row({ id: 'n', status: 'busy', statusSince: NOW })], remove: [] });
    expect(rowEl('n')).toHaveClass('ring-1', 'bg-sidebar-accent');
    expect(rowEl('b')).toHaveClass('hover:bg-sidebar-accent/60');
  });

  it("SIDE-3.11: a row's texts and backgrounds are the colours the contrast check measures (ROW_TONE), in both sections", () => {
    const app = renderApp('/s/n-sel');
    const other = { backend: 'unknown' as const, controllable: false };
    app.snapshot([
      row({ id: 'n', status: 'needs-you', waitingFor: 'input needed' }),
      row({ id: 'n-sel', status: 'needs-you' }),
      row({ id: 'b', status: 'busy' }),
      row({ id: 'vn', status: 'needs-you', waitingFor: 'input needed', ...other }),
      row({ id: 'vb', status: 'busy', ...other }),
    ]);
    const classes = (s: string) => s.split(/\s+/).filter(Boolean);
    // A class without its variants (`dark:text-x` → `text-x`); brackets keep theirs (`text-[color:red]`).
    const base = (c: string) => c.replace(/^(?:[\w-]+:)*/, '');
    // Text colours, arbitrary ones (`text-[#abc]`, `text-(--x)`) included; sizes and alignment aren't.
    const NOT_COLOUR = /^text-(?:xs|sm|base|lg|\d?xl|caption|meta|body|prose|title|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|\[[\d.]+(?:px|rem|em)\])$/;
    const colours = (el: Element) => [...el.classList].filter((c) => base(c).startsWith('text-') && !NOT_COLOUR.test(base(c)));
    const opacities = (el: Element) => [...el.classList].filter((c) => base(c).startsWith('opacity-'));
    const sidebar = screen.getByRole('complementary', { name: 'Session sidebar' });
    // What paints a text: every colour and opacity class from it up to the sidebar, which sets the
    // foreground. None of these rows is dimmed, so no opacity belongs anywhere on the way.
    const painted = (el: Element) => {
      const out: string[] = [];
      for (let e: Element | null = el; e && e !== sidebar; e = e.parentElement) out.push(...colours(e), ...opacities(e));
      return out;
    };
    const secondLine = (id: string) => field(id, 'repo')!.closest('div')!;
    const tones = { n: ROW_TONE.needsYou, 'n-sel': ROW_TONE.needsYou, vn: ROW_TONE.needsYou, b: ROW_TONE.plain, vb: ROW_TONE.plain };
    for (const [id, tone] of Object.entries(tones)) {
      expect(painted(secondLine(id)), id).toEqual([tone.quiet]);
      // Nothing inside the line paints its own colour or fades over the measured one.
      expect([...secondLine(id).querySelectorAll('*')].flatMap((e) => [...colours(e), ...opacities(e)]), id).toEqual([]);
    }
    // A View only title is the quieter text; a Controllable one takes the sidebar's foreground.
    expect(painted(field('vn', 'title')!)).toEqual([ROW_TONE.needsYou.quiet]);
    expect(painted(field('vb', 'title')!)).toEqual([ROW_TONE.plain.quiet]);
    for (const id of ['n', 'n-sel', 'b']) expect(painted(field(id, 'title')!), id).toEqual([]);
    expect(sidebar).toHaveClass('text-sidebar-foreground');
    expect(opacities(sidebar)).toEqual([]);
    for (const id of ['n', 'vn']) expect(painted(field(id, 'waiting-for')!), id).toEqual(['text-needs-you-text']);
    // The backgrounds measured: at rest and under the pointer, and selected.
    expect(rowEl('n')).toHaveClass(...classes(ROW_TONE.needsYou.rest), ...classes(ROW_TONE.needsYou.hover));
    expect(rowEl('n-sel')).toHaveClass(...classes(ROW_TONE.needsYou.selected));
    expect(rowEl('b')).toHaveClass(...classes(ROW_TONE.plain.hover));
  });

  it("SIDE-3.10: the strip is hidden from screen readers, and a row's accessible name is what it was", () => {
    const app = renderApp();
    app.snapshot([
      row({ id: 'fix-rates', status: 'needs-you', waitingFor: 'input needed', contextPct: 41, statusSince: NOW - 120_000, git: { repo: 'harbor', worktree: 'lantern', branch: 'x', commonDir: '/Users/me/Projects/harbor/.git', defaultBranch: 'main' } }),
      row({ id: 'port-search', status: 'busy', harness: 'codex' }),
      row({ id: 'notes', status: 'idle', git: null, cwd: '/tmp/field-notes' }),
      row({ id: 'pane', status: 'unknown', backend: 'unknown', controllable: false }),
      row({ id: 'quiet', status: 'idle', locationShown: { repo: false, where: false } }),
      row({ id: 'doing', status: 'busy', activity: 'Bash: pnpm lint', locationShown: { repo: false, where: false } }),
    ]);
    for (const id of ['fix-rates', 'port-search', 'notes', 'pane', 'quiet', 'doing']) expect(field(id, 'strip')).toHaveAttribute('aria-hidden', 'true');
    // The names the rows had before the strip, pinned: the marker's Status, title, Harness, repo,
    // where it works, age, context and what it waits for.
    expect(rowEl('fix-rates')).toHaveAccessibleName('Needs youfix-ratesClaude Code harborWorktreelantern2m41% input needed');
    expect(rowEl('port-search')).toHaveAccessibleName('Busyport-searchCodex workBranchmain1m');
    expect(rowEl('notes')).toHaveAccessibleName('IdlenotesClaude Code field-notes1m');
    expect(rowEl('pane')).toHaveAccessibleName('UnknownpaneClaude Code workBranchmain1m');
    // A hidden default location is not read (SIDE-2.15).
    expect(rowEl('quiet')).toHaveAccessibleName('IdlequietClaude Code 1m');
    // The activity a Busy row shows is read with it (SIDE-2.15).
    expect(rowEl('doing')).toHaveAccessibleName('BusydoingClaude Code Bash: pnpm lint1m');
    expect(screen.getByRole('option', { name: /^Busyport-search/ })).toBe(rowEl('port-search'));
  });

  it('SIDE-3.5 / SIDE-7.2: a changed idle threshold applies without reloading', () => {
    const app = renderApp();
    app.snapshot([row({ id: 'x', status: 'idle', statusSince: NOW - 2 * 3_600_000 })]);
    expect(rowEl('x')).toHaveAttribute('data-dimmed', 'false');
    app.emit({ type: 'settings', settings: settings({ idleThresholdHours: 1 }) });
    expect(rowEl('x')).toHaveAttribute('data-dimmed', 'true');
  });
});

describe('both sections', () => {
  const other = { backend: 'unknown' as const, controllable: false };

  it('DS-12.6: the Needs you header counts only visible Controllable Sessions and follows live Status changes and the filter', async () => {
    pinDate();
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([row({ id: 'wait-a', status: 'needs-you' }), row({ id: 'wait-b', status: 'needs-you' }), row({ id: 'busy', status: 'busy' }), row({ id: 'view', status: 'needs-you', ...other })]);
    const group = screen.getByRole('group', { name: 'Controllable' });
    const heading = () => within(screen.getByRole('group', { name: 'Controllable' })).queryByText('Needs you', { selector: 'span' });
    expect(group).toHaveAccessibleDescription('Needs you');
    expect(heading()).toHaveClass('text-title', 'font-semibold', 'text-needs-you-text');
    const header = heading()!.closest('li')!;
    expect(header).toHaveAttribute('role', 'presentation');
    expect(header).toHaveClass('flex', 'items-baseline', 'gap-1.5', 'px-2', 'pt-1', 'pb-1');
    expect(header).toHaveTextContent('Needs you2');
    expect(header.nextElementSibling).toBe(rowEl('wait-a'));
    expect(header.querySelector('button, [tabindex]')).toBeNull();
    expect(within(screen.getByRole('group', { name: 'View only' })).getAllByRole('option')).toEqual([rowEl('view')]);
    expect(screen.getAllByRole('option')).toHaveLength(4);

    await user.keyboard('/wait-a');
    expect(heading()!.closest('li')).toHaveTextContent('Needs you1');
    await user.clear(screen.getByRole('searchbox', { name: 'Filter Sessions' }));
    await user.keyboard('busy');
    expect(heading()).toBeNull();
    await user.clear(screen.getByRole('searchbox', { name: 'Filter Sessions' }));
    await user.keyboard('Needs you');
    expect(screen.getByText('No matching Sessions')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    app.emit({ type: 'sessions', upsert: [row({ id: 'wait-a', status: 'busy' }), row({ id: 'wait-b', status: 'idle' })], remove: [] });
    expect(heading()).toBeNull();
    app.emit({ type: 'sessions', upsert: [row({ id: 'busy', status: 'needs-you' })], remove: [] });
    expect(heading()!.closest('li')).toHaveTextContent('Needs you1');
  });

  it('DS-12.6: during a hover the header neither comes nor goes, so rows stay put (SIDE-3.4); it catches up when the pointer leaves', () => {
    const app = renderApp();
    app.snapshot([row({ id: 'a', status: 'busy' }), row({ id: 'b', status: 'idle' })]);
    const aside = screen.getByRole('complementary', { name: 'Session sidebar' });
    const header = () => within(screen.getByRole('group', { name: 'Controllable' })).queryByText('Needs you', { selector: 'span' })?.closest('li') ?? null;
    const enter = () => act(() => aside.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    const leave = () => act(() => aside.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body })));

    // None when the pointer came in: a Session that starts to Need you adds no header until it leaves.
    enter();
    app.emit({ type: 'sessions', upsert: [row({ id: 'b', status: 'needs-you', statusSince: NOW })], remove: [] });
    expect(header()).toBeNull();
    expect(rowEl('a').previousElementSibling).toBeNull();
    leave();
    expect(header()).toHaveTextContent('Needs you1');
    expect(header()!.nextElementSibling).toBe(rowEl('b'));

    // One when the pointer came in: the last one going leaves the header's room, empty and unread.
    enter();
    app.emit({ type: 'sessions', upsert: [row({ id: 'b', status: 'idle', statusSince: NOW })], remove: [] });
    expect(header()).toHaveClass('invisible');
    expect(header()).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('group', { name: 'Controllable' })).not.toHaveAccessibleDescription();
    leave();
    expect(header()).toBeNull();
  });

  it('DS-12.6: arrows, j/k, every ⌘1–9 and ⌘J skip both section headers', async () => {
    pinDate();
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot(Array.from({ length: 9 }, (_, i) => row({ id: `s${i + 1}`, status: i === 0 || i === 7 ? 'needs-you' : 'idle', ...(i >= 7 ? other : {}) })));
    const ids = visibleTitles();
    expect(ids).toHaveLength(9);
    for (const key of ['{ArrowDown}', 'j']) {
      for (const id of ids) {
        await user.keyboard(key);
        expect(window.location.pathname).toBe(`/s/${id}`);
      }
      for (const id of ids.slice(0, -1).reverse()) {
        await user.keyboard(key === 'j' ? 'k' : '{ArrowUp}');
        expect(window.location.pathname).toBe(`/s/${id}`);
      }
      await user.keyboard('{Meta>}1{/Meta}');
      // Reset to nothing selected for the next complete walk.
      act(() => { window.history.pushState(null, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); });
    }
    for (let i = 1; i <= 9; i++) {
      await user.keyboard(`{Meta>}${i}{/Meta}`);
      expect(window.location.pathname).toBe(`/s/${ids[i - 1]}`);
    }
    await user.keyboard('{Meta>}j{/Meta}');
    expect(window.location.pathname).toBe('/s/s1');
    await user.keyboard('{Meta>}j{/Meta}');
    expect(window.location.pathname).toBe('/s/s8');
  });

  it('SIDE-5 (support): keyboard moves through both sections, and ⌘J finds Needs you in either', async () => {
    pinDate();
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([row({ id: 'c1', status: 'busy' }), row({ id: 'v1', status: 'needs-you', ...other }), row({ id: 'v2', status: 'idle', ...other })]);
    await user.keyboard('j');
    expect(window.location.pathname).toBe('/s/c1');
    await user.keyboard('j');
    expect(window.location.pathname).toBe('/s/v1');
    await user.keyboard('{Meta>}3{/Meta}');
    expect(window.location.pathname).toBe('/s/v2');
    await user.keyboard('{Meta>}j{/Meta}');
    expect(window.location.pathname).toBe('/s/v1');
    expect(document.title).toBe('(1) Lookout');
  });

  it('SIDE-5.4 (support): the filter applies to both sections', async () => {
    pinDate();
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([row({ id: 'deal-a', title: 'deal-a' }), row({ id: 'deal-b', title: 'deal-b', ...other }), row({ id: 'misc', title: 'misc', ...other })]);
    await user.keyboard('/deal');
    expect(visibleTitles()).toEqual(['deal-a', 'deal-b']);
  });

  it('SIDE-3.4 (support): during a hover, rows keep their places in both sections', () => {
    const app = renderApp();
    app.snapshot([row({ id: 'c1', status: 'busy' }), row({ id: 'c2', status: 'idle' }), row({ id: 'v1', status: 'busy', ...other }), row({ id: 'v2', status: 'idle', ...other })]);
    const aside = screen.getByRole('complementary', { name: 'Session sidebar' });
    act(() => aside.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    app.emit({ type: 'sessions', upsert: [row({ id: 'c2', status: 'needs-you', statusSince: NOW }), row({ id: 'v2', status: 'needs-you', statusSince: NOW, ...other })], remove: [] });
    expect(visibleTitles()).toEqual(['c1', 'c2', 'v1', 'v2']);
    act(() => aside.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body })));
    expect(visibleTitles()).toEqual(['c2', 'c1', 'v2', 'v1']);
  });
});

describe('filter', () => {
  it('SIDE-5.4: `/` focuses the filter; typing filters by title, repo, Worktree or branch; Esc clears it', async () => {
    pinDate();
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([
      row({ id: 'by-title', title: 'deal rates', git: { repo: 'work', worktree: null, branch: 'main', commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' } }),
      row({ id: 'by-repo', title: 'one', git: { repo: 'fantastic', worktree: null, branch: 'main', commonDir: '/Users/me/Projects/fantastic/.git', defaultBranch: 'main' } }),
      row({ id: 'by-wt', title: 'two', git: { repo: 'work', worktree: 'invoice-pdf', branch: 'feature/x', commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' } }),
      row({ id: 'by-branch', title: 'three', git: { repo: 'work', worktree: null, branch: 'fix/timesheets', commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' } }),
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
    expect(banner()!).toHaveTextContent("Fleet isn't answering. List is 12s old.");
    expect(banner()!).toHaveAttribute('role', 'status');
    expect(banner()!).toHaveAttribute('title', 'fleet list timed out after 4 s');

    app.emit({ type: 'fleet', fleet: { state: 'ok' } });
    expect(banner()).toBeNull();
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
    expect(banner()!).toHaveTextContent('Reconnecting');
    expect(banner()!).toHaveAttribute('role', 'status');
    expect(screen.getByRole('listbox', { name: 'Sessions' })).toHaveAttribute('data-stale', 'true');
  });
});

describe('design system colours in the sidebar', () => {
  it("DS-3.1: a row's Harness logo is monochrome, in the row's quiet colour", () => {
    const app = renderApp();
    app.snapshot([row({ id: 'c', harness: 'claude', status: 'busy' }), row({ id: 'n', harness: 'codex', status: 'needs-you' })]);
    for (const [id, tone] of [['c', ROW_TONE.plain], ['n', ROW_TONE.needsYou]] as const) {
      const logo = within(field(id, 'harness')!).getByRole('img');
      expect(logo).toHaveAttribute('data-tone', 'mono');
      expect(logo).toHaveAttribute('fill', 'currentColor');
      expect(field(id, 'harness')).toHaveClass(tone.quiet);
    }
  });

  it('DS-3.3: the banners for a stale Fleet list and a lost server are in the info tone, not amber', () => {
    const app = renderApp();
    app.snapshot([row({ id: 'a' })]);
    app.emit({ type: 'fleet', fleet: { state: 'failing', lastOkAt: NOW - 2000, error: 'fleet list timed out after 4 s' } });
    const info = ['border-info-border', 'bg-info-soft', 'text-info-text'];
    const amber = (el: HTMLElement) => [...el.classList].filter((c) => c.includes('needs-you'));
    expect(banner()!).toHaveClass(...info);
    expect(amber(banner()!)).toEqual([]);
    app.emit({ type: 'fleet', fleet: { state: 'ok' } });
    app.connection(false);
    expect(banner()!).toHaveTextContent('Reconnecting');
    expect(banner()!).toHaveClass(...info);
    expect(amber(banner()!)).toEqual([]);
  });

  it("DS-3.5: a row's context number and ring take the status line's colours: quiet up to 40%, warning above 40%, destructive above 60%", () => {
    const app = renderApp();
    app.snapshot([
      row({ id: 'p40', contextPct: 40 }),
      row({ id: 'p41', contextPct: 41 }),
      row({ id: 'p60', contextPct: 60 }),
      row({ id: 'p61', contextPct: 61 }),
      row({ id: 'n61', status: 'needs-you', contextPct: 61 }),
    ]);
    const levels = ['text-warning-text', 'text-destructive-text'];
    const cases = [
      ['p40', null],
      ['p41', 'text-warning-text'],
      ['p60', 'text-warning-text'],
      ['p61', 'text-destructive-text'],
      ['n61', 'text-destructive-text'],
    ] as const;
    for (const [id, cls] of cases) {
      const ctx = field(id, 'context')!;
      for (const c of levels) expect(ctx.classList.contains(c), `${id} ${c}`).toBe(c === cls);
      // The ring is drawn in the number's colour (currentColor), so it takes the same level.
      expect(ctx.querySelectorAll('circle[stroke="currentColor"]'), id).toHaveLength(2);
    }
    // Up to 40% the number paints nothing of its own: it is the line's quiet colour.
    expect([...field('p40', 'context')!.classList].filter((c) => c.startsWith('text-'))).toEqual([]);
  });
});
