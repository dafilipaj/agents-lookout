import type { HarnessOption, ModelSwitchResult } from '@shared/types.ts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SaveError } from '@/lib/client';
import { FROM_NEXT_REPLY, MODEL_DEFAULT_NOTE, MODEL_ITERM, MODEL_RESTARTED, MODEL_WHY } from '@/lib/model-switch';
import { SWITCH_LOST } from '@/lib/status-switch';
import { HARNESSES, NOW, renderApp, row } from '@/test/helpers';

const statusLine = () => screen.getByRole('group', { name: 'Status line' });
const modelButton = () => within(statusLine()).getByRole('button', { name: /^Model: / });
const modelButtonOrNull = () => within(statusLine()).queryByRole('button', { name: /^Model: / });
const drawerToggle = () => screen.getByRole('button', { name: /Terminal/ });
const menu = () => screen.getByRole('menu', { name: /^Model: / });
const items = () => within(menu()).getAllByRole('menuitemradio');
/** Views another Session, as a click in the sidebar does. */
const view = (id: string) => {
  act(() => window.history.pushState(null, '', `/s/${id}`));
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
};

const WITH_HAIKU: HarnessOption[] = [
  {
    ...HARNESSES[0]!,
    models: [...HARNESSES[0]!.models, { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: [], defaultEffort: null }],
  },
  HARNESSES[1]!,
];

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

describe('switching the model from the status line (VIEW-6)', () => {
  it('VIEW-6.1: a Controllable, live Claude Code Session’s model is a button opening Fleet’s Claude Code models by label, without "Default", the current one checked', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', model: 'claude-opus-5-5' })]);
    expect(modelButton()).toHaveTextContent('claude-opus-5-5');
    await user.click(modelButton());
    expect(items().map((i) => i.textContent)).toEqual(['Opus 5.5claude-opus-5-5', 'Sonnet 5.5claude-sonnet-5-5']);
    expect(within(menu()).queryByText(/Default/)).toBeNull();
    expect(within(menu()).getByRole('menuitemradio', { name: /Opus 5\.5/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(menu()).getByRole('menuitemradio', { name: /Sonnet 5\.5/ })).toHaveAttribute('aria-checked', 'false');
    // The list is read again on opening (the default may have changed since).
    expect(app.client.harnesses).toHaveBeenCalled();
  });

  it('VIEW-6.1: a `[1m]` or a date suffix counts as the same model; a model Fleet doesn’t list checks nothing, and the line still shows its id', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a', { harnesses: async () => WITH_HAIKU });
    app.snapshot([row({ id: 'a', model: 'claude-opus-5-5[1m]' })]);
    await user.click(modelButton());
    expect(within(menu()).getByRole('menuitemradio', { name: /Opus 5\.5/ })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Escape}');

    app.emit({ type: 'sessions', upsert: [row({ id: 'a', model: 'claude-haiku-4-5-20251001' })], remove: [] });
    await user.click(modelButton());
    expect(within(menu()).getByRole('menuitemradio', { name: /Haiku 4\.5/ })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Escape}');

    app.emit({ type: 'sessions', upsert: [row({ id: 'a', model: 'claude-mythos-1' })], remove: [] });
    expect(modelButton()).toHaveTextContent('claude-mythos-1');
    await user.click(modelButton());
    expect(items().every((i) => i.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(items()).toHaveLength(3); // no extra row for it
  });

  it('VIEW-6.1: with no model known yet, the line shows no model and there’s no button', () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', model: null, contextPct: 12 })]);
    expect(statusLine().querySelector('[data-field="model"]')).toBeNull();
    expect(modelButtonOrNull()).toBeNull();
  });

  it('VIEW-6.2: a Codex Session’s model, a View only one’s, one in an iTerm tab (its tooltip says why) and an ended one’s stay plain text', () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', harness: 'codex', model: 'gpt-6-astra' }), row({ id: 'b', controllable: false, backend: 'unknown', model: 'claude-opus-5-5' })]);
    expect(statusLine().querySelector('[data-field="model"]')).toHaveTextContent('gpt-6-astra');
    expect(modelButtonOrNull()).toBeNull();
    app.unmount();

    const viewOnly = renderApp('/s/b');
    viewOnly.snapshot([row({ id: 'b', controllable: false, backend: 'unknown', model: 'claude-opus-5-5' })]);
    expect(statusLine().querySelector('[data-field="model"]')).toHaveTextContent('claude-opus-5-5');
    expect(modelButtonOrNull()).toBeNull();
    viewOnly.unmount();

    // In an iTerm tab Fleet can't read the input box: plain text, its tooltip saying why.
    const iterm = renderApp('/s/d');
    iterm.snapshot([row({ id: 'd', backend: 'iterm', model: 'claude-opus-5-5' })]);
    expect(statusLine().querySelector('[data-field="model"]')).toHaveTextContent('claude-opus-5-5');
    expect(statusLine().querySelector('[data-field="model"]')).toHaveAttribute('title', `claude-opus-5-5\n${MODEL_ITERM}`);
    expect(modelButtonOrNull()).toBeNull();
    iterm.unmount();

    const ended = renderApp('/s/c');
    ended.snapshot([row({ id: 'c', model: 'claude-opus-5-5' })]);
    expect(modelButton()).toBeInTheDocument();
    ended.emit({ type: 'sessions', upsert: [], remove: ['c'] });
    expect(statusLine().querySelector('[data-field="model"]')).toHaveTextContent('claude-opus-5-5');
    expect(modelButtonOrNull()).toBeNull();
  });

  it('VIEW-6.3: while the Session isn’t Idle the button is disabled and its tooltip says why; an open menu closes when it stops being Idle', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    for (const status of ['busy', 'needs-you', 'unknown'] as const) {
      app.snapshot([row({ id: 'a', model: 'claude-opus-5-5', status })]);
      expect(modelButton()).toHaveAttribute('aria-disabled', 'true');
      expect(modelButton()).toHaveAttribute('title', MODEL_WHY[status]);
      await user.click(modelButton());
      expect(screen.queryByRole('menu')).toBeNull();
    }
    app.snapshot([row({ id: 'a', model: 'claude-opus-5-5', status: 'idle' })]);
    expect(modelButton()).not.toHaveAttribute('aria-disabled');
    await user.click(modelButton());
    expect(menu()).toBeInTheDocument();
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', model: 'claude-opus-5-5', status: 'busy' })], remove: [] });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(app.client.switchModel).not.toHaveBeenCalled();
  });

  it('VIEW-6.7: while the switch runs the name reads "Switching…", disabled; once done the new model shows at once, marked "from the next reply", until the next reply', async () => {
    const user = userEvent.setup();
    const pending = deferred<ModelSwitchResult>();
    const app = renderApp('/s/a', { switchModel: () => pending.promise });
    const base = row({ id: 'a', model: 'claude-opus-5-5', pid: 4242, procStart: '2026-10-14T09:30:00Z' });
    app.snapshot([base]);
    await user.click(modelButton());
    await user.click(within(menu()).getByRole('menuitemradio', { name: /Sonnet 5\.5/ }));
    expect(app.client.switchModel).toHaveBeenCalledWith('a', { model: 'claude-sonnet-5-5', pid: 4242, procStart: '2026-10-14T09:30:00Z' });
    expect(modelButton()).toHaveTextContent('Switching…');
    expect(modelButton()).toHaveAttribute('aria-disabled', 'true');
    expect(modelButton()).toHaveAttribute('title', MODEL_WHY.switching);
    await user.click(modelButton());
    expect(screen.queryByRole('menu')).toBeNull();

    // The server sends the row with its pending model, then answers.
    app.emit({ type: 'sessions', upsert: [{ ...base, pendingModel: { model: 'claude-sonnet-5-5', since: '2026-10-22T10:00:00Z' } }], remove: [] });
    await act(async () => pending.resolve({ model: 'claude-sonnet-5-5', confirmed: true }));
    expect(modelButton()).toHaveTextContent('claude-sonnet-5-5');
    expect(statusLine().querySelector('[data-slot="model-note"]')).toHaveTextContent(`· ${FROM_NEXT_REPLY}`);
    // VIEW-5.5: at narrow widths it truncates like the line's other parts.
    expect(statusLine().querySelector('[data-slot="model-note"]')).toHaveClass('min-w-0', 'truncate');
    expect(statusLine().querySelector('[data-slot="model-note"]')).not.toHaveClass('shrink-0');
    expect(statusLine()).toHaveAttribute('title', expect.stringContaining(`claude-sonnet-5-5 (${FROM_NEXT_REPLY})`));
    expect(modelButton()).not.toHaveAttribute('aria-disabled');

    // The next reply reached the Transcript: Fleet's model, whichever it is, unmarked.
    app.emit({ type: 'sessions', upsert: [{ ...base, model: 'claude-sonnet-5-5', pendingModel: null }], remove: [] });
    expect(modelButton()).toHaveTextContent('claude-sonnet-5-5');
    expect(statusLine().querySelector('[data-slot="model-note"]')).toBeNull();
  });

  it('VIEW-6.4: the menu says the pick also becomes the default for new Claude Code Sessions', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', model: 'claude-opus-5-5' })]);
    await user.click(modelButton());
    expect(within(menu()).getByText(MODEL_DEFAULT_NOTE)).toBeInTheDocument();
    expect(MODEL_DEFAULT_NOTE).toBe('Also becomes the default for new Claude Code Sessions.');
  });

  it('VIEW-6.4: the launcher reads the models each time it opens, keeping the list it has until the new one comes', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const second = deferred<HarnessOption[]>();
    const app = renderApp('/', { harnesses: () => (++calls === 1 ? Promise.resolve(HARNESSES) : second.promise) });
    app.snapshot([]);
    await user.keyboard('n');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('radio', { name: /Claude Code/ })).toBeEnabled());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.keyboard('n');
    expect(app.client.harnesses).toHaveBeenCalledTimes(2);
    // Still the list it had while the new one is on its way.
    expect(screen.getByRole('radio', { name: /Claude Code/ })).toBeEnabled();
    await act(async () => second.resolve(HARNESSES));
  });

  it('VIEW-6.5: picking a model asks for the switch once, for that model and the process the menu opened on; picking the current one asks nothing', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', model: 'claude-opus-5-5', pid: 61004, procStart: '2026-10-14T09:30:00Z' })]);
    await user.click(modelButton());
    await user.click(within(menu()).getByRole('menuitemradio', { name: /Opus 5\.5/ }));
    expect(app.client.switchModel).not.toHaveBeenCalled();
    await user.click(modelButton());
    await user.click(within(menu()).getByRole('menuitemradio', { name: /Sonnet 5\.5/ }));
    await waitFor(() => expect(app.client.switchModel).toHaveBeenCalledTimes(1));
    expect(app.client.switchModel).toHaveBeenCalledWith('a', { model: 'claude-sonnet-5-5', pid: 61004, procStart: '2026-10-14T09:30:00Z' });
    // Nothing else is answered or pressed from the tab.
    expect(app.client.answer).not.toHaveBeenCalled();
    expect(app.client.escSession).not.toHaveBeenCalled();
    expect(app.client.sendMessage).not.toHaveBeenCalled();
  });

  it('VIEW-6.6, VIEW-6.8: a failed switch keeps the model it had and shows why beside it, cut to fit, the whole text in its tooltip; nothing is retried', async () => {
    const user = userEvent.setup();
    const held = 'The Session’s input box holds text, so the model wasn’t switched. Send or clear it in the terminal, then try again.';
    const switchModel = vi.fn(async () => {
      throw new SaveError(held, null, 409);
    });
    const app = renderApp('/s/a', { switchModel });
    app.snapshot([row({ id: 'a', model: 'claude-opus-5-5' })]);
    await user.click(modelButton());
    await user.click(within(menu()).getByRole('menuitemradio', { name: /Sonnet 5\.5/ }));
    const error = await within(statusLine()).findByRole('alert');
    expect(error).toHaveTextContent(held);
    expect(error).toHaveAttribute('title', held);
    // An inline Alert (DS-4.1): its one line is cut to fit.
    expect(error).toHaveClass('min-w-0');
    expect(error.querySelector('.truncate')).toHaveTextContent(held);
    expect(modelButton()).toHaveTextContent('claude-opus-5-5');
    expect(modelButton().getAttribute('title')).toContain(held);
    expect(switchModel).toHaveBeenCalledTimes(1);
    // A refusal Lookout is sure of leaves the terminal closed.
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('VIEW-6.8: an outcome Lookout can’t be sure of opens the Terminal preview, as does no answer from the server', async () => {
    const user = userEvent.setup();
    const uncertain = 'Lookout can’t tell whether the model was switched. Check the terminal.';
    let lost = false;
    const app = renderApp('/s/a', {
      switchModel: async () => {
        throw lost ? new SaveError('x', null, null, { lost: true }) : new SaveError(uncertain, null, 502, { kind: 'uncertain' });
      },
    });
    app.snapshot([row({ id: 'a', model: 'claude-opus-5-5' })]);
    await user.click(modelButton());
    await user.click(within(menu()).getByRole('menuitemradio', { name: /Sonnet 5\.5/ }));
    expect(await within(statusLine()).findByRole('alert')).toHaveTextContent(uncertain);
    await waitFor(() => expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true'));

    await user.click(drawerToggle());
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false');
    lost = true;
    await user.click(modelButton());
    await user.click(within(menu()).getByRole('menuitemradio', { name: /Sonnet 5\.5/ }));
    await waitFor(() => expect(within(statusLine()).getByRole('alert')).toHaveTextContent(SWITCH_LOST));
    await waitFor(() => expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true'));
  });

  it('VIEW-6.8: a "can’t tell" answer opens the Terminal preview even when the Session’s Status changed while the switch ran', async () => {
    const user = userEvent.setup();
    const pending = deferred<ModelSwitchResult>();
    const app = renderApp('/s/a', { switchModel: () => pending.promise });
    const base = row({ id: 'a', model: 'claude-opus-5-5' });
    app.snapshot([base]);
    await user.click(modelButton());
    await user.click(within(menu()).getByRole('menuitemradio', { name: /Sonnet 5\.5/ }));
    // A prompt typed in the terminal: Busy, a new Status spell.
    app.emit({ type: 'sessions', upsert: [{ ...base, status: 'busy', statusSince: NOW }], remove: [] });
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false');
    await act(async () => pending.reject(new SaveError('Lookout can’t tell whether the model was switched. Check the terminal.', null, 502, { kind: 'uncertain' })));
    await waitFor(() => expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true'));
  });

  it('VIEW-6.3, VIEW-6.7, VIEW-6.8: a switch outlives viewing another Session: still "Switching…" and disabled when you come back, and its error still shows', async () => {
    const user = userEvent.setup();
    const first = deferred<ModelSwitchResult>();
    const app = renderApp('/s/a', { switchModel: () => first.promise });
    app.snapshot([row({ id: 'a', pid: 101, model: 'claude-opus-5-5' }), row({ id: 'b', pid: 102, model: 'claude-opus-5-5' })]);
    await user.click(modelButton());
    await user.click(within(menu()).getByRole('menuitemradio', { name: /Sonnet 5\.5/ }));
    view('b');
    expect(modelButton()).toHaveTextContent('claude-opus-5-5');
    view('a');
    expect(modelButton()).toHaveTextContent('Switching…');
    expect(modelButton()).toHaveAttribute('aria-disabled', 'true');
    expect(modelButton()).toHaveAttribute('title', MODEL_WHY.switching);

    // It fails while another Session is in view: the error waits for you.
    view('b');
    const notIdle = 'The Session isn’t Idle now, so the model wasn’t switched. Try again once it is.';
    await act(async () => first.reject(new SaveError(notIdle, null, 409)));
    expect(within(statusLine()).queryByRole('alert')).toBeNull();
    view('a');
    expect(within(statusLine()).getByRole('alert')).toHaveTextContent(notIdle);
    expect(modelButton()).toHaveTextContent('claude-opus-5-5');
    expect(modelButton()).not.toHaveAttribute('aria-disabled');
    expect(app.client.switchModel).toHaveBeenCalledTimes(1);
  });

  it('VIEW-6.8: a switch’s error goes with the next reply after it, whatever its model, with the Session’s next change of model, or at once with the next pick', async () => {
    const user = userEvent.setup();
    const uncertain = 'Lookout can’t tell whether the model was switched. Check the terminal.';
    const notIdle = 'The Session isn’t Idle now, so the model wasn’t switched. Try again once it is.';
    let answer: () => Promise<ModelSwitchResult> = async () => {
      throw new SaveError(uncertain, null, 502, { kind: 'uncertain' });
    };
    const app = renderApp('/s/a', { switchModel: () => answer() });
    const base = row({ id: 'a', model: 'claude-opus-5-5', modelAt: '2026-10-22T10:00:00Z' });
    const pick = async (name: RegExp) => {
      await user.click(modelButton());
      await user.click(within(menu()).getByRole('menuitemradio', { name }));
    };
    app.snapshot([base]);
    await pick(/Sonnet 5\.5/);
    expect(await within(statusLine()).findByRole('alert')).toHaveTextContent(uncertain);
    // A list with nothing new keeps it.
    app.emit({ type: 'sessions', upsert: [{ ...base, contextPct: 40 }], remove: [] });
    expect(within(statusLine()).getByRole('alert')).toHaveTextContent(uncertain);
    // The next reply came from Opus again: it didn't switch, and the error goes all the same.
    app.emit({ type: 'sessions', upsert: [{ ...base, modelAt: '2026-10-22T10:05:00Z' }], remove: [] });
    await waitFor(() => expect(within(statusLine()).queryByRole('alert')).toBeNull());
    expect(modelButton()).toHaveTextContent('claude-opus-5-5');

    // "Not Idle" goes with the reply that ends the turn, here one from Sonnet (a switch made in the terminal).
    answer = async () => {
      throw new SaveError(notIdle, null, 409);
    };
    await pick(/Sonnet 5\.5/);
    expect(await within(statusLine()).findByRole('alert')).toHaveTextContent(notIdle);
    app.emit({ type: 'sessions', upsert: [{ ...base, model: 'claude-sonnet-5-5', modelAt: '2026-10-22T10:09:00Z' }], remove: [] });
    await waitFor(() => expect(within(statusLine()).queryByRole('alert')).toBeNull());

    // Another failure; a new pick clears it at once, while that switch still runs.
    await pick(/Opus 5\.5/);
    expect(await within(statusLine()).findByRole('alert')).toHaveTextContent(notIdle);
    const running = deferred<ModelSwitchResult>();
    answer = () => running.promise;
    await pick(/Opus 5\.5/);
    expect(modelButton()).toHaveTextContent('Switching…');
    expect(within(statusLine()).queryByRole('alert')).toBeNull();
    await act(async () => running.resolve({ model: 'claude-opus-5-5', confirmed: false }));
    expect(within(statusLine()).queryByRole('alert')).toBeNull();
  });

  it('VIEW-6.8: a switch’s error is its process’s: a Session that ended takes it along, and another process given the same pid never shows it', async () => {
    const user = userEvent.setup();
    const unconfirmed = 'Lookout can’t confirm it’s the same Session, so it won’t switch its model. Use /model in the terminal.';
    const app = renderApp('/s/a', {
      switchModel: async () => {
        throw new SaveError(unconfirmed, null, 409);
      },
    });
    // Fleet couldn't read either process's start time: only the pid tells them apart, and it's reused.
    app.snapshot([row({ id: 'a', pid: 4242, procStart: null, model: 'claude-opus-5-5' }), row({ id: 'b', pid: 4343, model: 'claude-opus-5-5' })]);
    await user.click(modelButton());
    await user.click(within(menu()).getByRole('menuitemradio', { name: /Sonnet 5\.5/ }));
    expect(await within(statusLine()).findByRole('alert')).toHaveTextContent(unconfirmed);
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    app.emit({ type: 'sessions', upsert: [row({ id: 'c', pid: 4242, procStart: null, model: 'claude-opus-5-5' })], remove: [] });
    view('c');
    expect(modelButton()).toHaveTextContent('claude-opus-5-5');
    expect(within(statusLine()).queryByRole('alert')).toBeNull();

    // With start times, a reused pid is another process at once, listed or not.
    view('b');
    await user.click(modelButton());
    await user.click(within(menu()).getByRole('menuitemradio', { name: /Sonnet 5\.5/ }));
    expect(await within(statusLine()).findByRole('alert')).toHaveTextContent(unconfirmed);
    app.emit({ type: 'sessions', upsert: [row({ id: 'b', pid: 4343, procStart: '2026-10-22T11:00:00Z', model: 'claude-opus-5-5' })], remove: [] });
    expect(within(statusLine()).queryByRole('alert')).toBeNull();
  });

  it('VIEW-6.8: a pick is for the process the menu was opened on: one restarted while it was open is refused, and Fleet isn’t asked', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    const base = row({ id: 'a', model: 'claude-opus-5-5', pid: 61004, procStart: '2026-10-14T09:30:00Z' });
    app.snapshot([base]);
    await user.click(modelButton());
    app.emit({ type: 'sessions', upsert: [{ ...base, pid: 61099, procStart: '2026-10-14T10:02:00Z' }], remove: [] });
    await user.click(within(menu()).getByRole('menuitemradio', { name: /Sonnet 5\.5/ }));
    expect(await within(statusLine()).findByRole('alert')).toHaveTextContent(MODEL_RESTARTED);
    expect(app.client.switchModel).not.toHaveBeenCalled();
    // Opened again, on the process it runs now: that one is switched.
    await user.click(modelButton());
    await user.click(within(menu()).getByRole('menuitemradio', { name: /Sonnet 5\.5/ }));
    await waitFor(() => expect(app.client.switchModel).toHaveBeenCalledWith('a', { model: 'claude-sonnet-5-5', pid: 61099, procStart: '2026-10-14T10:02:00Z' }));
  });

  it('VIEW-6.9: from the keyboard: Enter or Space opens it, the arrows move, Enter picks, Esc closes it and gives focus back to the model’s name', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', model: 'claude-opus-5-5' })]);
    modelButton().focus();
    await user.keyboard('{Enter}');
    expect(menu()).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(modelButton()).toHaveFocus();

    await user.keyboard(' ');
    expect(menu()).toBeInTheDocument();
    await waitFor(() => expect(items()[0]).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(items()[1]).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(app.client.switchModel).toHaveBeenCalledWith('a', expect.objectContaining({ model: 'claude-sonnet-5-5' })));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});
