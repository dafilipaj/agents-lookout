import { AMPHETAMINE_BUSY, AWAKE_OFF, type AwakeSnapshot, LID_AUTOMATION, LID_NEEDS_CHARGER } from '@shared/awake.ts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveError } from '@/lib/client';
import { NOW, renderApp, row } from '@/test/helpers';

const snap = (over: Partial<AwakeSnapshot> = {}): AwakeSnapshot => ({ ...AWAKE_OFF, lid: { available: true, reason: null }, ...over });
const on = (over: Partial<AwakeSnapshot> = {}) => snap({ mode: 'awake', holding: 'awake', atWork: 2, ...over });

function show(awake: AwakeSnapshot, options: Parameters<typeof renderApp>[1] = {}) {
  const app = renderApp('/', options);
  app.snapshot([row({ id: 'a', title: 'Rates fix' })]);
  app.emit({ type: 'awake', awake });
  return app;
}

const railButton = () => screen.getByRole('button', { name: /^Keep the Mac awake: / });
const menu = () => screen.getByRole('menu', { name: /^Keep the Mac awake: / });
const item = (name: RegExp) => within(menu()).getByRole('menuitemradio', { name });
const openSidebar = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /^History/ }));
const footer = () => screen.getByRole('button', { name: /^Keep the Mac awake: / });

beforeEach(() => {
  // The right sidebar's open state is remembered per viewer; each test starts with it closed.
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});
afterEach(() => vi.useRealTimers());

describe('AWAKE-4 the corner', () => {
  it('AWAKE-4.1: the closed rail ends in a 28 px line holding a Coffee icon button, pressed and in the foreground while on, saying the state in words', () => {
    const app = show(snap());
    const button = railButton();
    const line = button.closest('[data-slot="keep-awake"]')!;
    expect(line).toHaveClass('h-7', 'border-t', 'mt-auto');
    expect(line.closest('[data-shell-column="right"]')).not.toBeNull();
    expect(button.querySelector('svg')).toHaveClass('lucide-coffee');
    expect(button).toHaveAccessibleName('Keep the Mac awake: Sleeps as usual');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveClass('text-muted-foreground');

    app.emit({ type: 'awake', awake: on({ note: { text: 'Lid closed paused: on battery', at: NOW } }) });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveClass('bg-sidebar-accent', 'text-foreground');
    expect(button).toHaveAccessibleName('Keep the Mac awake: Awake · 2 at work');
    expect(button.title).toBe('Keep the Mac awake: Awake · 2 at work\nLid closed paused: on battery');
  });

  it('AWAKE-4.2: the open right sidebar ends in a footer line under its panels with the state in words, counting down while none is At work', async () => {
    const user = userEvent.setup();
    const app = show(snap());
    await openSidebar(user);
    const line = footer();
    expect(line).toHaveAttribute('data-field', 'keep-awake-line');
    expect(line).toHaveClass('h-7', 'border-t', 'text-caption');
    expect(line.closest('[data-testid="right-sidebar"]')).not.toBeNull();
    const text = () => line.querySelector('[data-field="keep-awake-text"]')!.textContent;
    expect(text()).toBe('Sleeps as usual');
    app.emit({ type: 'awake', awake: on() });
    expect(text()).toBe('Awake · 2 at work');
    app.emit({ type: 'awake', awake: on({ atWork: 0, offAt: NOW + 4.5 * 60_000 }) });
    expect(text()).toBe('Awake · off in 4m');
    app.emit({ type: 'awake', awake: on({ mode: 'lid', holding: 'lid' }) });
    expect(text()).toBe('Lid closed · 2 at work');
    app.emit({ type: 'awake', awake: on({ mode: 'lid', holding: 'awake', note: { text: 'Lid closed paused: on battery', at: NOW } }) });
    expect(text()).toBe('Awake · lid closed paused');
    expect(line.title).toBe('Keep the Mac awake: Awake · lid closed paused\nLid closed paused: on battery');

    // The line sits after the panels, outside them, and doesn't shrink: the panels give up its 28 px.
    const corner = line.closest('[data-slot="keep-awake"]')!;
    expect(corner).toHaveClass('shrink-0');
    expect(corner.previousElementSibling).toHaveAttribute('role', 'tabpanel');
    expect(corner.parentElement!.querySelector('[role="tabpanel"]:not([hidden])')).toHaveClass('flex-1', 'min-h-0');
    expect(corner.closest('[role="tabpanel"]')).toBeNull();
  });

  it('AWAKE-4.3: the menu lists Off, Awake and Lid closed with their lines, the mode checked, Lid closed disabled with its reason, and the last note', async () => {
    const user = userEvent.setup();
    const app = show(on({ lid: { available: false, reason: LID_NEEDS_CHARGER }, note: { text: 'Turned off: no Session at work for 5 min', at: NOW - 3 * 60_000 } }));
    await user.click(railButton());
    expect(within(menu()).getAllByRole('menuitemradio').map((e) => e.textContent)).toEqual([
      'OffThe Mac sleeps as usual',
      'AwakeNo idle sleep while Sessions are at work',
      `Lid closed${LID_NEEDS_CHARGER}`,
    ]);
    expect(item(/^Awake/)).toHaveAttribute('aria-checked', 'true');
    expect(item(/^Lid closed/)).toHaveAttribute('data-disabled');
    expect(menu().querySelector('[data-field="keep-awake-note"]')).toHaveTextContent('Turned off: no Session at work for 5 min · 3m ago');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();

    // After macOS refused the Apple event, Lid closed says how to allow it and can be tried again.
    app.emit({ type: 'awake', awake: on({ lid: { available: true, reason: LID_AUTOMATION } }) });
    await user.click(railButton());
    expect(item(/^Lid closed/)).not.toHaveAttribute('data-disabled');
    expect(item(/^Lid closed/)).toHaveTextContent(LID_AUTOMATION);
  });

  it('AWAKE-4.3: the arrows move through the items and Enter picks one', async () => {
    const user = userEvent.setup();
    const app = show(snap());
    railButton().focus();
    await user.keyboard('{Enter}');
    expect(menu()).toBeInTheDocument();
    // Opened from the keyboard, the menu focuses its first item.
    await vi.waitFor(() => expect(item(/^Off/)).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(item(/^Awake/)).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(app.client.setAwake).toHaveBeenCalledWith('awake', false);
  });

  it('AWAKE-1.1: an older snapshot never replaces a newer one, whichever way the event and the answer arrive', () => {
    const app = show(snap({ rev: 1 }));
    app.emit({ type: 'awake', awake: on({ rev: 3 }) });
    app.emit({ type: 'awake', awake: snap({ rev: 2 }) });
    expect(railButton()).toHaveAccessibleName('Keep the Mac awake: Awake · 2 at work');
    app.emit({ type: 'awake', awake: snap({ rev: 4 }) });
    expect(railButton()).toHaveAccessibleName('Keep the Mac awake: Sleeps as usual');
  });

  it('AWAKE-4.4: a pick shows the server’s answer, not the pick; a refusal says why in the menu', async () => {
    const user = userEvent.setup();
    let answer: (s: AwakeSnapshot) => void = () => {};
    const setAwake = vi.fn(() => new Promise<AwakeSnapshot>((r) => (answer = r)));
    const app = show(snap(), { setAwake });
    await user.click(railButton());
    await user.click(item(/^Awake/));
    expect(setAwake).toHaveBeenCalledWith('awake', false);
    expect(item(/^Off/)).toHaveAttribute('aria-checked', 'true');
    expect(item(/^Awake/)).toHaveTextContent('Changing…');
    answer(on());
    await vi.waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(railButton()).toHaveAttribute('aria-pressed', 'true');

    setAwake.mockImplementationOnce(() => Promise.reject(new SaveError('Needs the charger', null, 409)));
    await user.click(railButton());
    await user.click(item(/^Lid closed/));
    expect(within(menu()).getByRole('alert')).toHaveTextContent('Needs the charger');
    expect(item(/^Awake/)).toHaveAttribute('aria-checked', 'true');
    void app;
  });

  it("AWAKE-4.4: a session of Amphetamine's own opens AWAKE-3.2's dialog: Keep it stays Awake, Replace sends replace", async () => {
    const user = userEvent.setup();
    const setAwake = vi.fn(async (mode: 'off' | 'awake' | 'lid', replace?: boolean) => {
      if (mode === 'lid' && !replace) throw new SaveError('Amphetamine already has a session running.', null, 409, { kind: AMPHETAMINE_BUSY });
      return snap({ mode, holding: mode });
    });
    show(snap(), { setAwake });
    await user.click(railButton());
    await user.click(item(/^Lid closed/));
    const dialog = await screen.findByRole('dialog', { name: 'Amphetamine already has a session running' });
    expect(within(dialog).getByRole('button', { name: 'Keep it' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(setAwake).toHaveBeenLastCalledWith('awake', false);
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(railButton());
    await user.click(item(/^Lid closed/));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace' }));
    expect(setAwake).toHaveBeenLastCalledWith('lid', true);
  });
});
