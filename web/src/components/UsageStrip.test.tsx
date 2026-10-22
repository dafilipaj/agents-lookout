import type { ProviderUsage, UsageSnapshot, UsageWindow } from '@shared/usage.ts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BAR_EDGE, BAR_EDGE_GAP, BAR_FILL, BAR_TRACK } from '@/lib/usage';
import css from '@/index.css?raw';
import { type Mode, colourOf, contrast, paint, solid, themeTokens } from '@/test/contrast';
import { NOW, renderApp, settings } from '@/test/helpers';

const H = 3_600_000;
const win = (over: Partial<UsageWindow>): UsageWindow => ({ kind: 'session', label: 'Current session', model: null, percent: 10, resetsAt: NOW + 2 * H + 10 * 60_000, ...over });
const provider = (over: Partial<ProviderUsage> & { id: ProviderUsage['id'] }): ProviderUsage => ({
  state: 'ok',
  reason: null,
  plan: null,
  windows: [],
  extra: null,
  credits: null,
  fetchedAt: NOW - 60_000,
  observedAt: NOW - 60_000,
  stale: false,
  ...over,
});
const usage = (providers: ProviderUsage[], jev: Partial<UsageSnapshot['jev']> = {}): UsageSnapshot => ({
  providers,
  jev: { state: 'ready', version: '0.2.0', keySource: 'env TYPESAFE_API_KEY', baseUrl: 'https://api.typesafe.ai', configPath: null, reason: null, ...jev },
  checkedAt: NOW,
});

function show(u: UsageSnapshot) {
  const app = renderApp();
  app.snapshot([]);
  app.emit({ type: 'usage', usage: u });
  return app;
}

const strip = () => screen.getByTestId('usage-strip');

/**
 * Real timers for userEvent and Radix, but the clock pinned at NOW: the windows' reset times
 * are built from NOW, so they mustn't be compared with the wall clock.
 */
function pinDate() {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
}
const line = (id: string) => strip().querySelector<HTMLElement>(`[data-provider="${id}"]`)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('usage strip', () => {
  const barMark = (id: string) => line(id).querySelector(':scope > div > [data-field="mark"] [role="img"]')?.getAttribute('data-level') ?? 'normal';
  const weeklyMark = (id: string) => line(id).querySelector('[data-field="weekly"] [role="img"]')?.getAttribute('data-level') ?? 'normal';
  const field = (id: string, f: string) => line(id).querySelector<HTMLElement>(`[data-field="${f}"]`);
  const barWidth = (id: string) => line(id).querySelector<HTMLElement>('[aria-hidden] > span')?.style.width;
  // A provider's two lines: the bar's, and the one under it with the weekly limit and the age.
  const first = (id: string) => line(id).children[0] as HTMLElement;
  const second = (id: string) => line(id).children[1] as HTMLElement;

  it('USAGE-1.1: for Claude and Codex, the 5-hour window (mark, bar, % used, time to reset), and under it the tightest weekly window, then the age', () => {
    show(
      usage([
        // A weekly window tighter than the 5-hour one: the bar stays on the 5-hour one.
        provider({
          id: 'claude',
          windows: [
            win({ percent: 12 }),
            win({ kind: 'weekly_all', label: 'Weekly · all models', percent: 19, resetsAt: NOW + 50 * H }),
            win({ kind: 'weekly_scoped', label: 'Weekly · Fable', model: 'Fable', percent: 42, resetsAt: NOW + 50 * H }),
          ],
        }),
        // Codex, its weekly window listed first: the 5-hour one still takes the bar.
        provider({ id: 'codex', windows: [win({ kind: 'weekly_all', label: 'Weekly limit', percent: 63, resetsAt: NOW + 90 * H }), win({ label: '5h limit', percent: 41, resetsAt: NOW + 25 * 60_000 })] }),
      ]),
    );
    expect(within(line('claude')).getByRole('img', { name: 'Claude Code' })).toBeInTheDocument();
    expect(field('claude', 'percent')).toHaveTextContent('12%');
    expect(field('claude', 'reset')).toHaveTextContent('2h10');
    expect(barWidth('claude')).toBe('12%');
    expect(field('claude', 'weekly')!.textContent).toBe('weekly 42%'); // per-model weekly windows count
    expect(within(line('codex')).getByRole('img', { name: 'Codex' })).toBeInTheDocument();
    expect(field('codex', 'percent')).toHaveTextContent('41%');
    expect(field('codex', 'reset')).toHaveTextContent('25m');
    expect(barWidth('codex')).toBe('41%');
    expect(field('codex', 'weekly')!.textContent).toBe('weekly 63%');
    expect(first('codex').getAttribute('title')).toContain('Weekly limit: 63% used');
    // The bar is the 5-hour window's, so nothing labels it.
    expect(field('claude', 'window')).toBeNull();
    expect(field('codex', 'window')).toBeNull();
    // The weekly limit has the second line to itself, before the age; the first line is the 5-hour window's alone.
    for (const id of ['claude', 'codex']) {
      expect(first(id).querySelector('[data-field="weekly"]')).toBeNull();
      expect(second(id).firstElementChild).toBe(field(id, 'weekly'));
      expect(second(id).lastElementChild).toBe(field(id, 'age'));
    }
    expect(second('claude')).toHaveTextContent(/^weekly 42% · updated 1m ago$/);
    expect(second('codex')).toHaveTextContent(/^weekly 63% · as of last turn · 1m$/);
  });

  it('USAGE-1.1: with no 5-hour window reported, the weekly window takes the bar, % used and time to reset, labelled "w", and the second line has only the age', () => {
    show(
      usage([
        provider({ id: 'claude', windows: [win({ kind: 'weekly_all', percent: 19, resetsAt: NOW + 50 * H }), win({ kind: 'weekly_scoped', model: 'Fable', percent: 33, resetsAt: NOW + 26 * H })] }),
        provider({ id: 'codex', windows: [win({ percent: 41, resetsAt: NOW + 25 * 60_000 })] }), // no weekly window: no brackets either
      ]),
    );
    expect(field('claude', 'percent')).toHaveTextContent('33%');
    expect(field('claude', 'reset')).toHaveTextContent('1d 2h');
    expect(barWidth('claude')).toBe('33%');
    expect(field('claude', 'weekly')).toBeNull();
    // Visibly the weekly window, before the bar, so a missing 5-hour window never passes for it.
    expect(field('claude', 'window')!.textContent).toBe('w');
    // In the Harness mark's cell, the one before the bar's.
    expect(field('claude', 'window')!.parentElement!.nextElementSibling).toBe(line('claude').querySelector('[aria-hidden]'));
    expect(second('claude')).toHaveTextContent(/^updated 1m ago$/);
    expect(field('codex', 'percent')).toHaveTextContent('41%');
    expect(field('codex', 'weekly')).toBeNull();
    expect(field('codex', 'window')).toBeNull();
    expect(second('codex')).toHaveTextContent(/^as of last turn · 1m$/);
  });

  it('USAGE-1.1: the second line spells out "weekly"; the "w" before a weekly bar keeps the full word in its tooltip, as does the screen-reader description', () => {
    show(
      usage([
        provider({ id: 'claude', windows: [win({ percent: 12 }), win({ kind: 'weekly_all', label: 'Weekly · all models', percent: 58, resetsAt: NOW + 50 * H })] }),
        // No 5-hour window reported: the `w` before the bar.
        provider({ id: 'codex', windows: [win({ kind: 'weekly_all', label: 'Weekly limit', percent: 33, resetsAt: NOW + 26 * H })] }),
      ]),
    );
    expect(field('claude', 'weekly')!.textContent).toBe('weekly 58%');
    expect(field('claude', 'weekly')).toHaveAttribute('title', 'Weekly limit 58%');
    expect(field('codex', 'window')!.textContent).toBe('w');
    expect(field('codex', 'window')).toHaveAttribute('title', 'Weekly limit 33%');
    const summary = strip().parentElement!.querySelector('.sr-only')!;
    expect(summary.textContent).toContain('weekly 58%');
    expect(summary.textContent).toContain('weekly 33%');
    expect(screen.getByRole('button', { name: 'Usage details' })).toHaveAccessibleDescription(
      'Claude Code: 5-hour 12%, resets in 2h10; weekly 58%; updated 1m ago. Codex: weekly 33%, resets in 1d 2h; as of last turn · 1m. Jev: ready.',
    );
  });

  it('USAGE-1.1: short of room, the second line cuts the age short, in full in its tooltip, never the weekly limit', () => {
    show(
      usage([
        // The widest second line: a weekly limit at 100% with its mark, and Codex's longest age.
        provider({ id: 'codex', observedAt: NOW - 10_000, windows: [win({ percent: 100 }), win({ kind: 'weekly_all', percent: 100, resetsAt: NOW + 50 * H })] }),
        provider({ id: 'claude', stale: true, reason: 'fleet usage timed out', observedAt: NOW - 12 * 60_000, windows: [win({ percent: 12 }), win({ kind: 'weekly_all', percent: 85, resetsAt: NOW + 50 * H })] }),
      ]),
    );
    expect(second('codex')).toHaveTextContent(/^weekly 100% · as of last turn · just now$/);
    expect(second('codex')).toHaveClass('min-w-0', 'whitespace-nowrap');
    expect(field('codex', 'weekly')).toHaveClass('shrink-0');
    expect(field('codex', 'age')).toHaveClass('min-w-0', 'truncate');
    expect(field('codex', 'age')).toHaveAttribute('title', 'as of last turn · just now');
    // An old reading's tooltip also says why.
    expect(field('claude', 'age')).toHaveAttribute('title', 'old · 12m ago; fleet usage timed out');
    expect(field('claude', 'age')).toHaveClass('text-info-text');
  });

  it('USAGE-1.2: a warning triangle at 80% or more and a critical octagon at 95% or more, named for screen readers; nothing below 80%', () => {
    const app = show(usage([provider({ id: 'claude', windows: [win({ percent: 85 })] }), provider({ id: 'codex', windows: [win({ percent: 100 })] })]));
    const warning = within(line('claude')).getByRole('img', { name: 'Warning: 80% or more used' });
    const critical = within(line('codex')).getByRole('img', { name: 'Critical: 95% or more used' });
    // Different shapes, so they read without colour (decision 0008: lucide icons, no emoji).
    expect(warning.querySelector('svg.lucide-triangle-alert')).not.toBeNull();
    expect(critical.querySelector('svg.lucide-octagon-alert')).not.toBeNull();
    // Coloured with the text tokens, which hold 3:1 against the sidebar in both themes.
    expect(warning).toHaveAttribute('data-level', 'warning');
    expect(warning).toHaveClass('text-warning-text');
    expect(critical).toHaveAttribute('data-level', 'critical');
    expect(critical).toHaveClass('text-destructive');
    expect(warning).toHaveTextContent('');
    expect(critical).toHaveTextContent('');
    app.unmount();
    show(usage([provider({ id: 'claude', windows: [win({ percent: 79 })] }), provider({ id: 'codex', windows: [win({ percent: 0 })] })]));
    expect(strip().querySelector('[role="img"][aria-label^="Warning"], [role="img"][aria-label^="Critical"]')).toBeNull();
  });

  it('USAGE-1.2: either number is marked at 80% and 95%, by its own number: beside the bar for the 5-hour window, after the weekly limit on the second line', () => {
    const at = (five: number, weekly: number) => {
      const app = show(
        usage([
          provider({ id: 'claude', windows: [win({ percent: five }), win({ kind: 'weekly_all', percent: weekly, resetsAt: NOW + 50 * H })] }),
          // Swapped for Codex, with a per-model weekly window.
          provider({ id: 'codex', windows: [win({ percent: weekly }), win({ kind: 'weekly_scoped', model: 'gpt-6', percent: five, resetsAt: NOW + 50 * H })] }),
        ]),
      );
      const seen = { claude: [barMark('claude'), weeklyMark('claude')], codex: [barMark('codex'), weeklyMark('codex')], weekly: field('claude', 'weekly')!.textContent };
      app.unmount();
      return seen;
    };
    // A weekly window at 85% marks the weekly limit, not the bar.
    expect(at(10, 85)).toEqual({ claude: ['normal', 'warning'], codex: ['warning', 'normal'], weekly: 'weekly 85%' });
    // The boundaries, on each number: 79 / 80 and 94 / 95.
    expect(at(79, 80)).toEqual({ claude: ['normal', 'warning'], codex: ['warning', 'normal'], weekly: 'weekly 80%' });
    expect(at(80, 79)).toEqual({ claude: ['warning', 'normal'], codex: ['normal', 'warning'], weekly: 'weekly 79%' });
    expect(at(94, 95)).toEqual({ claude: ['warning', 'critical'], codex: ['critical', 'warning'], weekly: 'weekly 95%' });
    expect(at(95, 94)).toEqual({ claude: ['critical', 'warning'], codex: ['warning', 'critical'], weekly: 'weekly 94%' });
    // The weekly limit's mark has the same shapes and tokens as the bar's, so it reads without colour too.
    show(usage([provider({ id: 'claude', windows: [win({ percent: 10 }), win({ kind: 'weekly_all', percent: 97, resetsAt: NOW + 50 * H })] }), provider({ id: 'codex' })]));
    const weeklyIcon = within(field('claude', 'weekly')!).getByRole('img', { name: 'Critical: 95% or more used' });
    expect(weeklyIcon.querySelector('svg.lucide-octagon-alert')).not.toBeNull();
    expect(weeklyIcon).toHaveClass('text-destructive');
    expect(barMark('claude')).toBe('normal');
    // On the second line, between the weekly % and the age.
    expect(second('claude')).toContainElement(weeklyIcon);
    expect(second('claude')).toHaveTextContent(/^weekly 97% · updated 1m ago$/);
    // The button's name replaces its contents, so screen readers reach the marks through its description.
    expect(screen.getByRole('button', { name: 'Usage details' })).toHaveAccessibleDescription('Claude Code: 5-hour 10%, resets in 2h10; weekly 97%, critical; updated 1m ago. Codex: no data yet. Jev: ready.');
  });

  it('USAGE-1.4: whether Jev is ready, not set up, not installed, or needs an update', () => {
    const cases = [
      ['ready', 'ready'],
      ['not-set-up', 'not set up'],
      ['not-installed', 'not installed'],
      ['unavailable', 'update tb-jev'],
      ['error', 'error'],
    ] as const;
    for (const [state, text] of cases) {
      const app = show(usage([provider({ id: 'claude' }), provider({ id: 'codex' })], { state }));
      expect(strip().querySelector('[data-field="jev"]')).toHaveTextContent(new RegExp(`^${text}$`));
      expect(strip().querySelector('[data-field="jev"] svg.lucide-check') !== null).toBe(state === 'ready');
      app.unmount();
    }
  });

  it('USAGE-1.3 / 2.2: each provider says how old its numbers are; only old, unknown and skewed ages are flagged', () => {
    const age = (id: string) => line(id).querySelector<HTMLElement>('[data-field="age"]')!;
    const at = (claude: Partial<ProviderUsage>, codex: Partial<ProviderUsage> = { state: 'unavailable' }) =>
      show(usage([provider({ id: 'claude', windows: [win({ percent: 30 })], ...claude }), provider({ id: 'codex', windows: [win({ percent: 20 })], ...codex })]));

    let app = at({ observedAt: NOW - 2 * 60_000 }, { observedAt: NOW - 17 * 60_000, fetchedAt: NOW });
    expect(age('claude')).toHaveTextContent('updated 2m ago');
    expect(age('claude')).toHaveAttribute('data-flagged', 'false');
    // Codex: neutral, however long ago its last turn was.
    expect(age('codex')).toHaveTextContent('as of last turn · 17m');
    expect(age('codex')).toHaveAttribute('data-flagged', 'false');
    expect(age('codex')).not.toHaveClass('text-info-text');
    // The Jev line carries only Jev's state.
    expect(strip().querySelector('[data-field="jev"]')!.parentElement).not.toHaveTextContent('ago');
    app.unmount();

    app = at({ observedAt: NOW - 20 * 60_000, stale: true }, { observedAt: null, fetchedAt: NOW });
    expect(age('claude')).toHaveTextContent('old · 20m ago');
    expect(age('claude')).toHaveAttribute('data-flagged', 'true');
    expect(age('codex')).toHaveTextContent('age unknown'); // Codex's age comes from observed_at only
    expect(age('codex')).toHaveAttribute('data-flagged', 'true');
    act(() => vi.advanceTimersByTime(10 * 60_000)); // ages keep counting
    expect(age('claude')).toHaveTextContent('old · 30m ago');
    app.unmount();

    app = at({ observedAt: Date.now() - 6 * 60_000 }); // Claude past 5 minutes: its reads must be failing
    expect(age('claude')).toHaveTextContent('old · 6m ago');
    app.unmount();

    at({ observedAt: Date.now() + 10 * 60_000 }, { observedAt: Date.now() - 60_000, stale: true, reason: 'Fleet returned older numbers than before' });
    expect(age('claude')).toHaveTextContent('clock skew');
    expect(age('codex')).toHaveTextContent('old · 1m ago');
  });

  it('USAGE-2.2: screen readers get each line as shown, its age included, so old numbers after a failed read are never read out as current', () => {
    show(
      usage([
        // Dario's case after a reset, then a read that fails: the line is dimmed and says "old · 12m ago".
        provider({
          id: 'claude',
          state: 'signed-out',
          stale: true,
          reason: 'no Claude Code login found',
          observedAt: NOW - 12 * 60_000,
          windows: [win({ percent: 100, resetsAt: NOW - 1000 }), win({ kind: 'weekly_all', percent: 85, resetsAt: NOW + 50 * H })],
        }),
        // No 5-hour window reported: the weekly one has the bar, labelled "w" on the line and "weekly" in the description.
        provider({ id: 'codex', observedAt: NOW - 17 * 60_000, windows: [win({ kind: 'weekly_all', label: 'Weekly limit', percent: 33, resetsAt: NOW + 26 * H })] }),
      ]),
    );
    expect(field('claude', 'age')).toHaveTextContent('old · 12m ago');
    expect(field('claude', 'age')).toHaveAttribute('data-flagged', 'true');
    expect(second('claude')).toHaveTextContent(/^weekly 85% · old · 12m ago$/);
    expect(field('codex', 'age')).toHaveTextContent('as of last turn · 17m');
    expect(screen.getByRole('button', { name: 'Usage details' })).toHaveAccessibleDescription(
      'Claude Code: 5-hour 0%; weekly 85%, warning; old · 12m ago. Codex: weekly 33%, resets in 1d 2h; as of last turn · 17m. Jev: ready.',
    );
  });

  it('USAGE-2.2: a provider without numbers says why', () => {
    show(
      usage([
        provider({ id: 'claude', state: 'signed-out', reason: 'no Claude Code login found', observedAt: null, fetchedAt: null }),
        provider({ id: 'codex', state: 'unavailable', reason: 'Codex usage: not available yet', observedAt: null, fetchedAt: null }),
      ]),
    );
    expect(line('claude')).toHaveTextContent('not signed in');
    expect(line('codex')).toHaveTextContent('not available yet');
    expect(strip().querySelector('[data-field="age"]')).toBeNull();
  });

  it('USAGE-1.1 / 2.2: once the 5-hour reset passes, the strip shows it at 0% with an empty reset slot and the weekly limit still under it, the details say "reset · refreshing", and a refresh is asked for (review #2)', async () => {
    const app = show(
      usage([
        provider({ id: 'claude', windows: [win({ percent: 100, resetsAt: NOW + 30_000 }), win({ kind: 'weekly_all', percent: 42, resetsAt: NOW + 50 * H })] }),
        provider({ id: 'codex', windows: [win({ percent: 100, resetsAt: NOW + 30_000 })] }),
      ]),
    );
    expect(field('claude', 'percent')).toHaveTextContent('100%');
    expect(app.client.refreshUsage).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(31_000)); // the boundary passes
    // Dario's case: the line keeps its shape, never switching to the weekly window, until the new read.
    for (const id of ['claude', 'codex']) {
      expect(field(id, 'percent')!.textContent).toBe('0%');
      expect(field(id, 'reset')!.textContent).toBe('');
      expect(field(id, 'window')).toBeNull();
      expect(within(line(id)).queryByRole('img', { name: /^Critical/ })).toBeNull();
    }
    expect(field('claude', 'weekly')!.textContent).toBe('weekly 42%');
    expect(field('codex', 'weekly')).toBeNull();
    await vi.waitFor(() => expect(app.client.refreshUsage).toHaveBeenCalledTimes(1));
    act(() => vi.advanceTimersByTime(5_000));
    expect(app.client.refreshUsage).toHaveBeenCalledTimes(1); // once per reset, not every second
    // The details still list the passed window as resetting.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Usage details' }));
    const claude = within(await screen.findByTestId('usage-details')).getByRole('region', { name: 'Claude Code usage' });
    expect(within(claude).getAllByRole('listitem')[0]).toHaveTextContent('Current sessionreset · refreshing');
  });
});

describe('usage details', () => {
  const detailed = () =>
    usage([
      provider({
        id: 'claude',
        plan: 'Team · Max 5x',
        windows: [win({ percent: 62, label: 'Current session' }), win({ kind: 'weekly_all', label: 'Weekly · all models', percent: 19 }), win({ kind: 'weekly_scoped', label: 'Weekly · Fable', model: 'Fable', percent: 0 })],
        extra: { enabled: true, used: 12.5, limit: 50, currency: 'USD', percent: 25 },
      }),
      provider({ id: 'codex', plan: 'Plus', windows: [win({ percent: 13 })], extra: { enabled: true, used: 3, limit: null, currency: 'USD', percent: 0 }, credits: { hasCredits: true, unlimited: false, balance: '120' } }),
    ]);

  it('USAGE-2.1 (support): each plan, every window tightest first, extra usage with % and bar, credits, and Jev', async () => {
    pinDate();
    const user = userEvent.setup();
    const app = show(detailed());
    await user.click(screen.getByRole('button', { name: 'Usage details' }));
    const details = await screen.findByTestId('usage-details');
    expect(app.client.refreshJev).toHaveBeenCalledTimes(1);
    const claude = within(details).getByRole('region', { name: 'Claude Code usage' });
    expect(claude).toHaveTextContent('Team · Max 5x');
    expect(within(claude).getAllByRole('listitem').map((li) => li.textContent?.split(/\d+%/)[0])).toEqual(['Current session', 'Weekly · all models', 'Weekly · Fable']);
    const extra = within(claude).getByTestId('extra-usage');
    expect(extra).toHaveTextContent('Extra usage12.5 of 50 USD25%');
    expect(extra.querySelector('[aria-hidden] > span')).toHaveStyle({ width: '25%' });
    const codex = within(details).getByRole('region', { name: 'Codex usage' });
    expect(within(codex).getByTestId('extra-usage')).toHaveTextContent('no limit set');
    expect(codex).toHaveTextContent('Credits: 120');
    const jev = within(details).getByRole('region', { name: 'Jev' });
    expect(jev).toHaveTextContent('0.2.0');
    expect(jev).toHaveTextContent('Key fromenv TYPESAFE_API_KEY');
    expect(jev).not.toHaveTextContent('Config');
  });

  it('opens from the keyboard, is named, closes on Escape, and gives focus back (review #11)', async () => {
    pinDate();
    const user = userEvent.setup();
    show(detailed());
    const trigger = screen.getByRole('button', { name: 'Usage details' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Usage details' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Usage details' })).toBeNull());
    expect(trigger).toHaveFocus();
  });
});

describe('launcher hint', () => {
  beforeEach(pinDate); // times below are built from the (pinned) clock

  async function openLauncher(u: UsageSnapshot) {
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([], { state: 'ok' }, settings());
    app.emit({ type: 'usage', usage: u });
    await user.click(screen.getByRole('button', { name: 'New Session' }));
    const group = await screen.findByRole('radiogroup', { name: 'Harness' });
    await waitFor(() => expect(within(group).getByRole('radio', { name: /Codex/ })).toBeEnabled());
    const hint = (name: RegExp) => within(group).getByRole('radio', { name }).closest('label')!.querySelector('[data-field="limit-hint"]');
    return { user, group, hint };
  }
  const at1730 = () => {
    const d = new Date();
    d.setHours(17, 30, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  };

  it('USAGE-3.1: a Harness at 95% or more of a window shows it next to its name, and stays selectable', async () => {
    const { user, group, hint } = await openLauncher(
      usage([
        provider({ id: 'claude', windows: [win({ percent: 62, resetsAt: Date.now() + H })], observedAt: Date.now(), fetchedAt: Date.now() }),
        provider({ id: 'codex', windows: [win({ percent: 100, resetsAt: at1730() }), win({ kind: 'weekly_all', percent: 96, resetsAt: Date.now() + 50 * H })], observedAt: Date.now(), fetchedAt: Date.now() }),
      ]),
    );
    expect(hint(/Codex/)).toHaveTextContent(/^5h limit 100% · resets (\w{3} )?17:30$/);
    expect(within(hint(/Codex/) as HTMLElement).getByRole('img', { name: 'Critical: 95% or more used' }).querySelector('svg.lucide-octagon-alert')).not.toBeNull();
    expect(hint(/Claude Code/)).toBeNull();
    await user.click(within(group).getByRole('radio', { name: /Codex/ }));
    expect(within(group).getByRole('radio', { name: /Codex/ })).toBeChecked();
  });

  it('USAGE-3.1: old numbers say how old; expired windows give no hint (review #2, #5)', async () => {
    const { hint } = await openLauncher(
      usage([
        provider({ id: 'claude', windows: [win({ percent: 100, resetsAt: Date.now() - 1000 }), win({ kind: 'weekly_all', percent: 40, resetsAt: Date.now() + H })], observedAt: Date.now(), fetchedAt: Date.now() }),
        provider({ id: 'codex', windows: [win({ percent: 100, resetsAt: at1730() })], observedAt: Date.now() - 20 * 60_000, fetchedAt: Date.now(), stale: true }),
      ]),
    );
    expect(hint(/Claude Code/)).toBeNull();
    expect(hint(/Codex/)).toHaveTextContent(/5h limit 100% · resets (\w{3} )?17:30 · as of 20m ago$/);
  });

  it('USAGE-3.1: Codex as of its last turn needs no age in the hint', async () => {
    const { hint } = await openLauncher(
      usage([
        provider({ id: 'claude', windows: [win({ percent: 10, resetsAt: Date.now() + H })], observedAt: Date.now(), fetchedAt: Date.now() }),
        provider({ id: 'codex', windows: [win({ percent: 100, resetsAt: at1730() })], observedAt: Date.now() - 20 * 60_000, fetchedAt: Date.now() }),
      ]),
    );
    expect(hint(/Codex/)).toHaveTextContent(/^5h limit 100% · resets (\w{3} )?17:30$/);
    expect(within(hint(/Codex/) as HTMLElement).getByRole('img', { name: 'Critical: 95% or more used' }).querySelector('svg.lucide-octagon-alert')).not.toBeNull();
  });

  it('two critical Harnesses both show their hint (review #12)', async () => {
    const { hint } = await openLauncher(
      usage([
        provider({ id: 'claude', windows: [win({ percent: 97, resetsAt: at1730() })], observedAt: Date.now(), fetchedAt: Date.now() }),
        provider({ id: 'codex', windows: [win({ percent: 100, resetsAt: at1730() })], observedAt: Date.now(), fetchedAt: Date.now() }),
      ]),
    );
    expect(hint(/Claude Code/)).toHaveTextContent('5h limit 97%');
    expect(hint(/Codex/)).toHaveTextContent('5h limit 100%');
  });
});

describe('usage strip colours (design system)', () => {
  const fill = (root: Element) => root.querySelector<HTMLElement>('[data-field="fill"]')!;

  it('DS-3.1: the usage strip and its details draw the Harness logos monochrome', async () => {
    pinDate();
    const user = userEvent.setup();
    show(usage([provider({ id: 'claude', windows: [win({ percent: 12 })] }), provider({ id: 'codex', windows: [win({ percent: 20 })] })]));
    const logos = () => [...document.querySelectorAll<SVGElement>('svg[data-harness]')];
    expect(logos().length).toBeGreaterThanOrEqual(2);
    for (const logo of logos()) expect(logo).toHaveAttribute('fill', 'currentColor');
    await user.click(screen.getByRole('button', { name: 'Usage details' }));
    const details = await screen.findByTestId('usage-details');
    const inDetails = [...details.querySelectorAll('svg[data-harness]')];
    expect(inDetails.length).toBeGreaterThanOrEqual(2);
    for (const logo of inDetails) expect(logo).toHaveAttribute('data-tone', 'mono');
  });

  it("DS-3.2: the strip's bar keeps the foreground fill at every level, with a 3 px edge in the level's colour at 80% and 95%; the details keep solid bars", async () => {
    pinDate();
    const user = userEvent.setup();
    show(
      usage([
        provider({ id: 'claude', windows: [win({ percent: 85 })] }),
        provider({ id: 'codex', windows: [win({ percent: 97 })] }),
      ]),
    );
    const cases = [
      ['claude', 'warning', 'bg-warning'],
      ['codex', 'critical', 'bg-destructive'],
    ] as const;
    for (const [id, level, edge] of cases) {
      const f = fill(line(id));
      expect(f).toHaveAttribute('data-level', level);
      expect(f).toHaveClass('bg-foreground/55', 'overflow-hidden', 'rounded-full'); // the edge follows the rounded end
      expect(f).not.toHaveClass(edge); // never the solid block again
      const e = f.querySelector('[data-field="edge"]')!;
      expect(e).toHaveClass(edge, 'w-1', 'border-l', 'border-sidebar', 'right-0', 'absolute', 'inset-y-0'); // 4 px: a 1 px gap in the ground's colour, then 3 px of the level
    }
    // The critical octagon stays beside the bar (USAGE-1.2).
    expect(within(line('codex')).getByRole('img', { name: 'Critical: 95% or more used' })).toBeInTheDocument();
    // In the details popover, the same windows keep their solid fills, with no edge.
    await user.click(screen.getByRole('button', { name: 'Usage details' }));
    const details = await screen.findByTestId('usage-details');
    const solid = (name: string) => fill(within(details).getByRole('region', { name }));
    expect(solid('Claude Code usage')).toHaveClass('bg-warning');
    expect(solid('Codex usage')).toHaveClass('bg-destructive');
    expect(details.querySelector('[data-field="edge"]')).toBeNull();
  });

  it("DS-3.2: each level's fill keeps 3:1 or more against the track, on the sidebar and the background, in both modes", () => {
    const themes = themeTokens(css);
    const measure = (fills: Record<string, string>) =>
      (['light', 'dark'] as Mode[]).flatMap((mode) =>
        ['sidebar', 'background'].flatMap((ground) =>
          Object.entries(fills).map(([level, classes]) => {
            const t = themes[mode];
            const trackColour = colourOf(BAR_TRACK, 'bg')!;
            const track = paint(t, trackColour.token, solid(t, ground), trackColour.alpha);
            const fillColour = colourOf(classes, 'bg')!;
            return { what: `${mode} ${level} on ${ground}`, ratio: contrast(paint(t, fillColour.token, track, fillColour.alpha), track) };
          }),
        ),
      );
    const measures = measure(BAR_FILL.strip);
    expect(measures).toHaveLength(2 * 2 * 3);
    expect(measures.filter((m) => !(m.ratio >= 3)).map((m) => m.what)).toEqual([]);
    // The check can fail: a fill as pale as the old soft ones (about 1.2:1) is caught.
    expect(measure({ warning: 'bg-foreground/20' }).some((m) => m.ratio < 3)).toBe(true);
  });

  it("DS-3.2: the 1 px gap between the fill and its edge is the ground's colour and keeps 3:1 or more against the fill, in both modes", () => {
    expect(BAR_EDGE_GAP).toBe('border-l border-sidebar');
    const themes = themeTokens(css);
    const trackColour = colourOf(BAR_TRACK, 'bg')!;
    const fillColour = colourOf(BAR_FILL.strip.critical, 'bg')!;
    const measure = (gap: string) =>
      (['light', 'dark'] as Mode[]).map((mode) => {
        const t = themes[mode];
        const track = paint(t, trackColour.token, solid(t, 'sidebar'), trackColour.alpha);
        const fill = paint(t, fillColour.token, track, fillColour.alpha);
        return { what: `${mode} gap vs fill`, ratio: contrast(solid(t, gap), fill) };
      });
    // Edge against fill is 1.0 to 1.9 whatever the hue, so the gap is what makes it a separate mark.
    expect(measure('sidebar').filter((m) => !(m.ratio >= 3)).map((m) => m.what)).toEqual([]);
    // The check can fail: a gap in the fill's own colour (the old no-gap edge) is caught.
    expect(measure('foreground').some((m) => m.ratio < 3)).toBe(true);
  });

  it('DS-3.2: the edge is warning at 80% to 94% and destructive at 95% or more, and none below', () => {
    expect(BAR_EDGE).toEqual({ normal: null, warning: 'bg-warning', critical: 'bg-destructive' });
    for (const [percent, edge] of [[79, null], [80, 'bg-warning'], [94, 'bg-warning'], [95, 'bg-destructive'], [100, 'bg-destructive']] as const) {
      const app = show(usage([provider({ id: 'claude', windows: [win({ percent })] })]));
      const e = line('claude').querySelector('[data-field="edge"]');
      if (edge) expect(e, `${percent}%`).toHaveClass(edge);
      else expect(e, `${percent}%`).toBeNull();
      app.unmount();
    }
  });

  it('DS-3.2: below 80% the bar stays the foreground at 55%, with no edge', () => {
    show(usage([provider({ id: 'claude', windows: [win({ percent: 79 })] })]));
    expect(fill(line('claude'))).toHaveClass('bg-foreground/55');
    expect(fill(line('claude'))).toHaveAttribute('data-level', 'normal');
    expect(line('claude').querySelector('[data-field="edge"]')).toBeNull();
  });

  it('DS-3.3: a reading marked old says "old · …" in the info tone, not amber', () => {
    show(usage([provider({ id: 'claude', stale: true, reason: 'fleet usage timed out', observedAt: NOW - 12 * 60_000, windows: [win({ percent: 12 })] })]));
    const age = line('claude').querySelector<HTMLElement>('[data-field="age"]')!;
    expect(age).toHaveTextContent(/^old · 12m ago/);
    expect(age).toHaveClass('text-info-text');
    expect([...age.classList].filter((c) => c.includes('needs-you') || c.includes('warning'))).toEqual([]);
  });
});
