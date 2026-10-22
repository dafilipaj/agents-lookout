import type { EffortSwitchResult, HarnessOption, ModelSwitchResult } from '@shared/types.ts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SaveError } from '@/lib/client';
import { EFFORT_DEFAULT_NOTE, EFFORT_ITERM, EFFORT_RESTARTED, EFFORT_WHY, NO_LEVELS } from '@/lib/effort-switch';
import { FROM_NEXT_REPLY, MODEL_WHY } from '@/lib/model-switch';
import { HARNESSES, renderApp, row } from '@/test/helpers';

const statusLine = () => screen.getByRole('group', { name: 'Status line' });
const effortButton = () => within(statusLine()).getByRole('button', { name: /^Effort: / });
const effortButtonOrNull = () => within(statusLine()).queryByRole('button', { name: /^Effort: / });
const modelButton = () => within(statusLine()).getByRole('button', { name: /^Model: / });
const drawerToggle = () => screen.getByRole('button', { name: /Terminal/ });
const menu = () => screen.getByRole('menu', { name: /^Effort: / });
const items = () => within(menu()).getAllByRole('menuitemradio');
const level = (name: string) => within(menu()).getByRole('menuitemradio', { name });
const effortField = () => statusLine().querySelector('[data-field="effort"]');
/** Views another Session, as a click in the sidebar does. */
const view = (id: string) => {
  act(() => window.history.pushState(null, '', `/s/${id}`));
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
};

/** A promise the test settles by hand, for a switch that's still running. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Fleet's levels differ by model here, so a test can tell which model's list the menu shows. */
const MIXED: HarnessOption[] = [
  {
    ...HARNESSES[0]!,
    models: [
      { id: '', label: 'Default', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' },
      { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' },
      { id: 'claude-opus-4-6', label: 'Opus 4.6', efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high' },
      { id: 'claude-mythos-1', label: 'Mythos 1', efforts: ['minimal', 'ultra'], defaultEffort: null },
    ],
  },
  HARNESSES[1]!,
];

const claude = (over: Parameters<typeof row>[0]) => row({ model: 'claude-opus-5-5', effort: 'medium', ...over });

describe('switching the Effort from the status line (VIEW-7)', () => {
  it('VIEW-7.1: a Controllable, live Claude Code Session’s Effort is a button opening the levels Fleet lists for its model, bare words, lowest first, the current one checked', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([claude({ id: 'a' })]);
    expect(effortButton()).toHaveTextContent('medium');
    await user.click(effortButton());
    expect(items().map((i) => i.textContent)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(level('medium')).toHaveAttribute('aria-checked', 'true');
    expect(items().filter((i) => i.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    // The list is read again on opening (a switch may have changed a default since).
    expect(app.client.harnesses).toHaveBeenCalled();
  });

  it('VIEW-7.1: the model is matched as VIEW-6.1 matches it; a model Fleet doesn’t list gets every level Fleet lists for Claude Code; a level not listed checks nothing and still shows', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a', { harnesses: async () => MIXED });
    app.snapshot([claude({ id: 'a', model: 'claude-opus-4-6[1m]', effort: 'high' })]);
    await user.click(effortButton());
    expect(items().map((i) => i.textContent)).toEqual(['low', 'medium', 'high', 'max']);
    await user.keyboard('{Escape}');

    app.emit({ type: 'sessions', upsert: [claude({ id: 'a', model: 'claude-unlisted-9', effort: 'high' })], remove: [] });
    await user.click(effortButton());
    expect(items().map((i) => i.textContent)).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    await user.keyboard('{Escape}');

    // Claude Code ran a level Fleet doesn't list for the model: nothing checked, no extra row.
    app.emit({ type: 'sessions', upsert: [claude({ id: 'a', model: 'claude-opus-4-6', effort: 'xhigh' })], remove: [] });
    expect(effortButton()).toHaveTextContent('xhigh');
    await user.click(effortButton());
    expect(items()).toHaveLength(4);
    expect(items().every((i) => i.getAttribute('aria-checked') === 'false')).toBe(true);
  });

  it('VIEW-7.1: with no Effort known the line shows none and there’s no button; a Fleet that lists no levels says so in the menu', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a', {
      harnesses: async () => [{ ...HARNESSES[0]!, models: HARNESSES[0]!.models.map((m) => ({ ...m, efforts: [], defaultEffort: null })) }, HARNESSES[1]!],
    });
    app.snapshot([claude({ id: 'a', effort: null, contextPct: 12 })]);
    expect(effortField()).toBeNull();
    expect(effortButtonOrNull()).toBeNull();
    app.emit({ type: 'sessions', upsert: [claude({ id: 'a' })], remove: [] });
    await user.click(effortButton());
    expect(await within(menu()).findByText(NO_LEVELS)).toBeInTheDocument();
    expect(within(menu()).queryAllByRole('menuitemradio')).toEqual([]);
  });

  it('VIEW-7.2: a Codex Session’s Effort, a View only one’s, one in an iTerm tab (its tooltip says why) and an ended one’s stay plain text', () => {
    const codex = renderApp('/s/a');
    codex.snapshot([row({ id: 'a', harness: 'codex', model: 'gpt-6-astra', effort: 'xhigh' })]);
    expect(effortField()).toHaveTextContent('xhigh');
    expect(effortButtonOrNull()).toBeNull();
    codex.unmount();

    const viewOnly = renderApp('/s/b');
    viewOnly.snapshot([claude({ id: 'b', controllable: false, backend: 'unknown' })]);
    expect(effortField()).toHaveTextContent('medium');
    expect(effortButtonOrNull()).toBeNull();
    viewOnly.unmount();

    const iterm = renderApp('/s/d');
    iterm.snapshot([claude({ id: 'd', backend: 'iterm' })]);
    expect(effortField()).toHaveAttribute('title', `medium\n${EFFORT_ITERM}`);
    expect(EFFORT_ITERM).toBe('Lookout can’t switch the Effort of a Session in an iTerm tab. Use /effort in its terminal.');
    expect(effortButtonOrNull()).toBeNull();
    iterm.unmount();

    const ended = renderApp('/s/c');
    ended.snapshot([claude({ id: 'c' })]);
    expect(effortButton()).toBeInTheDocument();
    ended.emit({ type: 'sessions', upsert: [], remove: ['c'] });
    expect(effortField()).toHaveTextContent('medium');
    expect(effortButtonOrNull()).toBeNull();
  });

  it('VIEW-7.3: while the Session isn’t Idle the button is disabled and its tooltip says why; an open menu closes when it stops being Idle', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    for (const status of ['busy', 'needs-you', 'unknown'] as const) {
      app.snapshot([claude({ id: 'a', status })]);
      expect(effortButton()).toHaveAttribute('aria-disabled', 'true');
      expect(effortButton()).toHaveAttribute('title', EFFORT_WHY[status]);
      await user.click(effortButton());
      expect(screen.queryByRole('menu')).toBeNull();
    }
    expect(EFFORT_WHY.busy).toBe('Switch the Effort once it’s Idle; it’s working now.');
    app.snapshot([claude({ id: 'a' })]);
    await user.click(effortButton());
    expect(menu()).toBeInTheDocument();
    app.emit({ type: 'sessions', upsert: [claude({ id: 'a', status: 'busy' })], remove: [] });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(app.client.switchEffort).not.toHaveBeenCalled();
  });

  it('VIEW-7.3: one switch per Session at a time, whichever menu: each disables the other while it runs, saying why', async () => {
    const user = userEvent.setup();
    const model = deferred<ModelSwitchResult>();
    const effort = deferred<EffortSwitchResult>();
    const app = renderApp('/s/a', { switchModel: () => model.promise, switchEffort: () => effort.promise });
    app.snapshot([claude({ id: 'a' })]);
    await user.click(modelButton());
    await user.click(screen.getByRole('menuitemradio', { name: /Sonnet 5\.5/ }));
    expect(modelButton()).toHaveTextContent('Switching…');
    expect(effortButton()).toHaveTextContent('medium');
    expect(effortButton()).toHaveAttribute('aria-disabled', 'true');
    expect(effortButton()).toHaveAttribute('title', MODEL_WHY.switching);
    await user.click(effortButton());
    expect(screen.queryByRole('menu')).toBeNull();
    await act(async () => model.resolve({ model: 'claude-sonnet-5-5', confirmed: false }));
    expect(effortButton()).not.toHaveAttribute('aria-disabled');

    await user.click(effortButton());
    await user.click(level('high'));
    expect(effortButton()).toHaveTextContent('Switching…');
    expect(effortButton()).toHaveAttribute('title', EFFORT_WHY.switching);
    expect(modelButton()).toHaveAttribute('aria-disabled', 'true');
    expect(modelButton()).toHaveAttribute('title', EFFORT_WHY.switching);
    expect(EFFORT_WHY.switching).toBe('A switch of its Effort is under way.');
    await act(async () => effort.resolve({ effort: 'high', confirmed: false, saved: true }));
    expect(modelButton()).not.toHaveAttribute('aria-disabled');
    expect(app.client.switchModel).toHaveBeenCalledTimes(1);
    expect(app.client.switchEffort).toHaveBeenCalledTimes(1);
  });

  it('VIEW-7.4: the menu says low to xhigh also become the default for new Claude Code Sessions on this model, and max is for this Session only', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([claude({ id: 'a' })]);
    await user.click(effortButton());
    expect(within(menu()).getByText(EFFORT_DEFAULT_NOTE)).toBeInTheDocument();
    expect(EFFORT_DEFAULT_NOTE).toBe('low to xhigh also become the default for new Claude Code Sessions on this model. max is for this Session only.');
  });

  it('VIEW-7.5: picking a level asks for the switch once, for that level and the process the menu opened on; picking the checked one types nothing and closes the menu', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([claude({ id: 'a', pid: 61004, procStart: '2026-10-14T09:30:00Z' })]);
    await user.click(effortButton());
    await user.click(level('medium'));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(app.client.switchEffort).not.toHaveBeenCalled();
    await user.click(effortButton());
    await user.click(level('xhigh'));
    await waitFor(() => expect(app.client.switchEffort).toHaveBeenCalledTimes(1));
    expect(app.client.switchEffort).toHaveBeenCalledWith('a', { effort: 'xhigh', pid: 61004, procStart: '2026-10-14T09:30:00Z' });
    // Nothing else is answered, pressed or sent from the tab.
    expect(app.client.answer).not.toHaveBeenCalled();
    expect(app.client.escSession).not.toHaveBeenCalled();
    expect(app.client.sendMessage).not.toHaveBeenCalled();
    expect(app.client.switchModel).not.toHaveBeenCalled();
  });

  it('VIEW-7.6, VIEW-7.8: a failed switch keeps the Effort it had and shows why beside it, cut to fit, the whole text in its tooltip; nothing is retried', async () => {
    const user = userEvent.setup();
    const held = 'The Session’s input box holds text, so the Effort wasn’t switched. Send or clear it in the terminal, then try again.';
    const switchEffort = vi.fn(async () => {
      throw new SaveError(held, null, 409);
    });
    const app = renderApp('/s/a', { switchEffort });
    app.snapshot([claude({ id: 'a' })]);
    await user.click(effortButton());
    await user.click(level('high'));
    const error = await within(statusLine()).findByRole('alert');
    expect(error).toHaveTextContent(held);
    expect(error).toHaveAttribute('data-slot', 'effort-error');
    expect(error).toHaveAttribute('title', held);
    expect(error).toHaveClass('truncate', 'min-w-0');
    expect(effortButton()).toHaveTextContent('medium');
    expect(effortButton().getAttribute('title')).toContain(held);
    // The model's name shows no error: the two never show at once.
    expect(modelButton().getAttribute('title')).not.toContain(held);
    expect(switchEffort).toHaveBeenCalledTimes(1);
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('VIEW-7.7: while the switch runs the Effort reads "Switching…", disabled; once done the level shows at once, marked "from the next reply", until the next reply', async () => {
    const user = userEvent.setup();
    const pending = deferred<EffortSwitchResult>();
    const app = renderApp('/s/a', { switchEffort: () => pending.promise });
    const base = claude({ id: 'a', contextPct: 41 });
    app.snapshot([base]);
    await user.click(effortButton());
    await user.click(level('xhigh'));
    expect(effortButton()).toHaveTextContent('Switching…');
    expect(effortButton()).toHaveAttribute('aria-disabled', 'true');

    app.emit({ type: 'sessions', upsert: [{ ...base, pendingEffort: { effort: 'xhigh', since: '2026-10-22T10:00:00Z' } }], remove: [] });
    await act(async () => pending.resolve({ effort: 'xhigh', confirmed: true, saved: true }));
    expect(effortButton()).toHaveTextContent('xhigh');
    expect(statusLine().querySelector('[data-slot="effort-note"]')).toHaveTextContent(`· ${FROM_NEXT_REPLY}`);
    expect(statusLine().querySelector('[data-slot="effort-note"]')).toHaveClass('min-w-0', 'truncate');
    expect(statusLine()).toHaveAttribute('title', expect.stringContaining(`claude-opus-5-5 · xhigh (${FROM_NEXT_REPLY}) · 41% context`));
    expect(effortButton()).toHaveAttribute('title', `Effort: xhigh (${FROM_NEXT_REPLY})`);

    // The next reply ran at what Claude Code made of it (a level the model lacks runs as its highest): Fleet's, unmarked.
    app.emit({ type: 'sessions', upsert: [{ ...base, effort: 'high', pendingEffort: null }], remove: [] });
    expect(effortButton()).toHaveTextContent('high');
    expect(statusLine().querySelector('[data-slot$="-note"]')).toBeNull();
  });

  it('VIEW-7.7: a pending model and a pending Effort share one mark, after the Effort, whichever is pending', () => {
    const app = renderApp('/s/a');
    const base = claude({ id: 'a' });
    const notes = () => [...statusLine().querySelectorAll('[data-slot$="-note"]')].map((n) => n.getAttribute('data-slot'));
    const pendingModel = { model: 'claude-sonnet-5-5', since: '2026-10-22T10:00:00Z' };
    const pendingEffort = { effort: 'xhigh', since: '2026-10-22T10:00:01Z' };
    app.snapshot([{ ...base, pendingModel }]);
    expect(notes()).toEqual(['effort-note']);
    expect(statusLine().getAttribute('title')).toContain(`claude-sonnet-5-5 · medium (${FROM_NEXT_REPLY})`);
    expect(modelButton()).toHaveAttribute('title', `Model: claude-sonnet-5-5 (${FROM_NEXT_REPLY})`);
    app.emit({ type: 'sessions', upsert: [{ ...base, pendingEffort }], remove: [] });
    expect(notes()).toEqual(['effort-note']);
    expect(modelButton()).toHaveAttribute('title', 'Model: claude-opus-5-5');
    app.emit({ type: 'sessions', upsert: [{ ...base, pendingModel, pendingEffort }], remove: [] });
    expect(notes()).toEqual(['effort-note']);
    expect(statusLine().getAttribute('title')).toContain(`claude-sonnet-5-5 · xhigh (${FROM_NEXT_REPLY})`);
    // With no Effort shown, the model carries it, as VIEW-6.7 says.
    app.emit({ type: 'sessions', upsert: [{ ...base, effort: null, pendingModel }], remove: [] });
    expect(notes()).toEqual(['model-note']);
  });

  it('VIEW-7.7: a pending model keeps its mark while an Effort switch runs; an ended Session shows no mark', async () => {
    const user = userEvent.setup();
    const pending = deferred<EffortSwitchResult>();
    const app = renderApp('/s/a', { switchEffort: () => pending.promise });
    const pendingModel = { model: 'claude-sonnet-5-5', since: '2026-10-22T10:00:00Z' };
    const base = claude({ id: 'a', pendingModel });
    app.snapshot([base]);
    await user.click(effortButton());
    await user.click(level('xhigh'));
    expect(effortButton()).toHaveTextContent('Switching…');
    expect([...statusLine().querySelectorAll('[data-slot$="-note"]')].map((n) => n.getAttribute('data-slot'))).toEqual(['model-note']);
    await act(async () => pending.resolve({ effort: 'xhigh', confirmed: true, saved: true }));

    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    expect(statusLine().querySelector('[data-slot$="-note"]')).toBeNull();
    expect(statusLine().getAttribute('title')).not.toContain(FROM_NEXT_REPLY);
  });

  it('VIEW-7.1: while a model switch is pending and no Effort switch is newer, the menu checks no level and any pick is typed; a newer Effort switch checks again', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    const pendingModel = { model: 'claude-sonnet-5-5', since: '2026-10-22T10:00:00Z' };
    app.snapshot([claude({ id: 'a', pendingModel })]);
    await user.click(effortButton());
    expect(items().filter((i) => i.getAttribute('aria-checked') === 'true')).toHaveLength(0);
    await user.click(level('medium'));
    expect(app.client.switchEffort).toHaveBeenCalledTimes(1);

    const pendingEffort = { effort: 'high', since: '2026-10-22T10:00:05Z' };
    app.emit({ type: 'sessions', upsert: [claude({ id: 'a', pendingModel, pendingEffort })], remove: [] });
    await user.click(effortButton());
    expect(level('high')).toHaveAttribute('aria-checked', 'true');
  });

  it('VIEW-7.8: an outcome Lookout can’t be sure of opens the Terminal preview; a pick after the process changed is refused without asking', async () => {
    const user = userEvent.setup();
    const uncertain = 'Lookout can’t tell whether the Effort was switched. Check the terminal.';
    const app = renderApp('/s/a', {
      switchEffort: async () => {
        throw new SaveError(uncertain, null, 502, { kind: 'uncertain' });
      },
    });
    const base = claude({ id: 'a', pid: 61004, procStart: '2026-10-14T09:30:00Z' });
    app.snapshot([base]);
    await user.click(effortButton());
    await user.click(level('high'));
    expect(await within(statusLine()).findByRole('alert')).toHaveTextContent(uncertain);
    await waitFor(() => expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true'));
    expect(app.client.switchEffort).toHaveBeenCalledTimes(1);

    await user.click(effortButton());
    app.emit({ type: 'sessions', upsert: [{ ...base, pid: 61099, procStart: '2026-10-14T10:02:00Z' }], remove: [] });
    await user.click(level('high'));
    expect(await within(statusLine()).findByText(EFFORT_RESTARTED)).toBeInTheDocument();
    expect(app.client.switchEffort).toHaveBeenCalledTimes(1);
  });

  it('VIEW-7.8: the error stays while you view another Session, and goes with the next reply, a change of Effort, or a new pick from either menu', async () => {
    const user = userEvent.setup();
    const notIdle = 'The Session isn’t Idle now, so the Effort wasn’t switched. Try again once it is.';
    let answer: () => Promise<EffortSwitchResult> = async () => {
      throw new SaveError(notIdle, null, 409);
    };
    const app = renderApp('/s/a', { switchEffort: () => answer() });
    const base = claude({ id: 'a', pid: 101, modelAt: '2026-10-22T10:00:00Z' });
    app.snapshot([base, claude({ id: 'b', pid: 102 })]);
    const pick = async (name: string) => {
      await user.click(effortButton());
      await user.click(level(name));
    };
    await pick('high');
    expect(await within(statusLine()).findByRole('alert')).toHaveTextContent(notIdle);
    view('b');
    expect(within(statusLine()).queryByRole('alert')).toBeNull();
    view('a');
    expect(within(statusLine()).getByRole('alert')).toHaveTextContent(notIdle);
    // The next reply reaches the Transcript: it goes, whatever it ran at.
    app.emit({ type: 'sessions', upsert: [{ ...base, modelAt: '2026-10-22T10:05:00Z' }], remove: [] });
    await waitFor(() => expect(within(statusLine()).queryByRole('alert')).toBeNull());

    // Again; the Effort changes (a `/effort` typed in the terminal, then a reply): it goes.
    await pick('high');
    expect(await within(statusLine()).findByRole('alert')).toHaveTextContent(notIdle);
    app.emit({ type: 'sessions', upsert: [{ ...base, effort: 'low', modelAt: '2026-10-22T10:05:00Z' }], remove: [] });
    await waitFor(() => expect(within(statusLine()).queryByRole('alert')).toBeNull());

    // Again; a pick from the model's menu clears it at once.
    await pick('high');
    expect(await within(statusLine()).findByRole('alert')).toHaveTextContent(notIdle);
    answer = () => new Promise(() => {});
    await user.click(modelButton());
    await user.click(screen.getByRole('menuitemradio', { name: /Sonnet 5\.5/ }));
    expect(within(statusLine()).queryByRole('alert')).toBeNull();
  });

  it('VIEW-7.9: from the keyboard: Enter or Space opens it, the arrows move, Enter picks, Esc closes it and gives focus back to the Effort', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([claude({ id: 'a', effort: 'low' })]);
    effortButton().focus();
    await user.keyboard('{Enter}');
    expect(menu()).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(effortButton()).toHaveFocus();

    await user.keyboard(' ');
    expect(menu()).toBeInTheDocument();
    await waitFor(() => expect(items()[0]).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(items()[1]).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(app.client.switchEffort).toHaveBeenCalledWith('a', expect.objectContaining({ effort: 'medium' })));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});
