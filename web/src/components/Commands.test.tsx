import type { CommandItem, CommandList } from '@shared/commands.ts';
import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { flushSync } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';
import { renderApp, row, settings } from '@/test/helpers';
import { NO_COMMAND_MATCHES, READING_COMMANDS } from '@/lib/command-list';

// Invented look-alikes; no real skill is copied here.
const item = (call: string, over: Partial<CommandItem> = {}): CommandItem => ({ call, name: call.slice(1), hint: null, description: `What ${call} does`, source: 'builtin', plugin: null, dialog: false, ...over });
const CLAUDE: CommandList = {
  harness: 'claude',
  error: null,
  readAt: 1,
  items: [
    item('/compact', { hint: '[instructions]', description: 'Summarize the conversation to free context' }),
    item('/config', { description: 'Open settings', dialog: true }),
    item('/copy', { description: 'Copy the last reply', dialog: true }),
    item('/notes', { source: 'yours', hint: 'add | list', description: 'Keep notes for later' }),
    item('/ship-it', { source: 'repo', description: 'Ship the ledger' }),
    item('/p-kit:code', { source: 'plugin', plugin: 'p-kit', description: 'Write the change' }),
  ],
};
const CODEX: CommandList = { harness: 'codex', error: null, readAt: 1, items: [item('$cx-review', { source: 'yours', description: 'Review, in Codex' }), item('/compact', { description: 'Summarize the conversation' })] };

const listbox = () => screen.queryByRole('listbox', { name: 'Commands and skills' });
/** The list with what it says above its rows: a wait, a failed read, "nothing matches". */
const list = () => document.querySelector<HTMLElement>('[data-slot="command-list"]');

/**
 * A browser lets React finish what a key's earlier listener started before its next listener runs;
 * a test's key doesn't. This makes the field's key behave as a browser's, for what depends on the
 * order of two listeners (VIEW-15.7).
 */
const asInABrowser = (field: HTMLElement) => field.addEventListener('keydown', () => flushSync(() => {}), { capture: true });

/** A `mousemove` as the browser sends it: with the pointer's own movement, or with none when the page moved under it. */
function mouseMove(el: Element, moved: boolean) {
  const event = createEvent.mouseMove(el);
  Object.defineProperty(event, 'movementX', { value: moved ? 3 : 0 });
  Object.defineProperty(event, 'movementY', { value: 0 });
  fireEvent(el, event);
}
const options = () => within(listbox()!).getAllByRole('option');
const shown = () => options().map((o) => o.querySelector('[data-part="call"]')!.textContent);
const highlighted = () => options().find((o) => o.getAttribute('aria-selected') === 'true')?.querySelector('[data-part="call"]')?.textContent;

function start(commands: CommandList | (() => Promise<CommandList>) = CLAUDE, rows = [row({ id: 'a' })]) {
  const user = userEvent.setup();
  const read = vi.fn(typeof commands === 'function' ? commands : async () => commands);
  const app = renderApp('/s/a', { commands: read });
  app.snapshot(rows);
  const box = screen.getByRole('textbox', { name: 'Message' });
  return { user, app, box, read };
}

describe('the `/` list in the composer (VIEW-15)', () => {
  it('VIEW-15.1: it opens as you type a `/` first, narrows with the word, and closes on a blank, a deleted `/` or a second `/`', async () => {
    const { user, box, read } = start();
    expect(listbox()).toBeNull();
    await user.type(box, '/');
    await waitFor(() => expect(listbox()).not.toBeNull());
    expect(read).toHaveBeenCalledWith('a');
    await waitFor(() => expect(shown()).toEqual(['/ship-it', '/notes', '/p-kit:code', '/compact', '/config', '/copy']));
    await user.type(box, 'co');
    expect(shown()).toEqual(['/compact', '/config', '/copy', '/p-kit:code']);

    await user.type(box, ' ');
    await waitFor(() => expect(listbox()).toBeNull());
    await user.type(box, '{Backspace}');
    await waitFor(() => expect(listbox()).not.toBeNull()); // one word again, as you type
    await user.type(box, '{Backspace}{Backspace}{Backspace}');
    await waitFor(() => expect(listbox()).toBeNull());
    expect(box).toHaveValue('');

    // A path's first word holds a second `/` (VIEW-9.7).
    await user.type(box, '/Users');
    await waitFor(() => expect(listbox()).not.toBeNull());
    await user.type(box, '/ana');
    await waitFor(() => expect(listbox()).toBeNull());
  });

  it('VIEW-15.1: a `/` later in the text opens nothing, and focus leaving the box closes the list', async () => {
    const { user, box, read } = start();
    await user.type(box, 'look at src/');
    expect(listbox()).toBeNull();
    expect(read).not.toHaveBeenCalled();
    await user.clear(box);
    await user.type(box, '/co');
    await waitFor(() => expect(listbox()).not.toBeNull());
    fireEvent.blur(box);
    await waitFor(() => expect(listbox()).toBeNull());
    expect(box).toHaveValue('/co');
  });

  it('VIEW-15.1: focus leaving is not an Esc: back in the box, the next key opens the list again', async () => {
    const { user, box } = start();
    await user.type(box, '/co');
    await waitFor(() => expect(listbox()).not.toBeNull());
    await user.tab({ shift: true });
    expect(box).not.toHaveFocus();
    await waitFor(() => expect(listbox()).toBeNull());
    await user.click(box);
    expect(listbox()).toBeNull(); // not by itself: as you type
    await user.keyboard('m');
    await waitFor(() => expect(shown()).toEqual(['/compact']));

    // Nor is a press somewhere else on the page.
    await user.click(document.body);
    await waitFor(() => expect(listbox()).toBeNull());
    await user.click(box);
    await user.keyboard('{Backspace}');
    await waitFor(() => expect(shown()).toEqual(['/compact', '/config', '/copy', '/p-kit:code']));
  });

  it("VIEW-15.1: a draft that comes back into the box doesn't open the list until you type", async () => {
    const { user, box } = start(CLAUDE, [row({ id: 'a', title: 'Alpha' }), row({ id: 'b', title: 'Beta' })]);
    await user.type(box, '/co');
    await waitFor(() => expect(listbox()).not.toBeNull());
    await user.click(screen.getByRole('option', { name: /Beta/ }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''));
    await user.click(screen.getByRole('option', { name: /Alpha/ }));
    const back = await screen.findByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(back).toHaveValue('/co'));
    expect(listbox()).toBeNull();
    await user.type(back, 'm');
    await waitFor(() => expect(listbox()).not.toBeNull());
  });

  it("VIEW-15.1: a message taken back into the box (VIEW-3.10) doesn't open the list until you type", async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a', { commands: async () => CLAUDE });
    app.snapshot([row({ id: 'a' })], { state: 'ok' }, settings({ undoSend: true }));
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.type(box, '/compact');
    await waitFor(() => expect(highlighted()).toBe('/compact'));
    await user.keyboard('{Enter}'); // the word, whole: it waits to go, with Undo (VIEW-3.9)
    await waitFor(() => expect(box).toHaveValue(''));
    expect(listbox()).toBeNull();
    await user.keyboard('{Backspace}');
    await waitFor(() => expect(box).toHaveValue('/compact'));
    expect(listbox()).toBeNull();
    expect(app.client.sendMessage).not.toHaveBeenCalled();
    await user.keyboard('{Backspace}');
    await waitFor(() => expect(listbox()).not.toBeNull());
    expect(shown()).toEqual(['/compact']);
  });

  it('VIEW-15.5: a row shows the item as called, its hint, its description, the dialog mark and where it is from', async () => {
    const { user, box } = start();
    await user.type(box, '/');
    await waitFor(() => expect(listbox()).not.toBeNull());
    const part = (call: string, name: string) => options().find((o) => o.querySelector('[data-part="call"]')!.textContent === call)!.querySelector(`[data-part="${name}"]`);
    await waitFor(() => expect(part('/compact', 'call')).toHaveClass('font-mono'));
    expect(part('/compact', 'hint')).toHaveTextContent('[instructions]');
    expect(part('/compact', 'description')).toHaveTextContent('Summarize the conversation to free context');
    expect(part('/compact', 'source')).toHaveTextContent('Built-in');
    expect(part('/compact', 'dialog')).toBeNull();
    expect(part('/config', 'dialog')).toHaveTextContent('opens in terminal');
    expect(part('/config', 'dialog')!.querySelector('svg.lucide-square-terminal')).not.toBeNull();
    expect(part('/notes', 'source')).toHaveTextContent('Yours');
    expect(part('/notes', 'hint')).toHaveTextContent('add | list');
    expect(part('/ship-it', 'source')).toHaveTextContent('This repo');
    expect(part('/p-kit:code', 'source')).toHaveTextContent('p-kit');
    expect(part('/ship-it', 'hint')).toBeNull();
  });

  it('VIEW-15.6: what matched is marked, and when nothing matches the list says so and Enter sends what you typed', async () => {
    const { user, app, box } = start();
    await user.type(box, '/comp');
    await waitFor(() => expect(shown()).toEqual(['/compact']));
    expect(options()[0]!.querySelector('[data-slot="hit"]')).toHaveTextContent('comp');
    await user.type(box, 'zzz');
    await waitFor(() => expect(list()).toHaveTextContent(NO_COMMAND_MATCHES));
    expect(within(listbox()!).queryAllByRole('option')).toHaveLength(0);
    await user.keyboard('{Enter}');
    expect(app.client.sendMessage).toHaveBeenCalledWith('a', '/compzzz');
  });

  it('VIEW-15.7: the arrows move the highlight between the ends, and a change to the word puts it back on the first row', async () => {
    const { user, box } = start();
    await user.type(box, '/co');
    await waitFor(() => expect(highlighted()).toBe('/compact'));
    await user.keyboard('{ArrowUp}');
    expect(highlighted()).toBe('/compact'); // it stops at the top
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(highlighted()).toBe('/copy');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(highlighted()).toBe('/p-kit:code'); // and at the bottom
    await user.keyboard('p');
    await waitFor(() => expect(highlighted()).toBe('/copy')); // `/cop`: one row, the first
    expect(box).toHaveValue('/cop');
  });

  it('VIEW-15.7: Tab picks the highlighted row, a click picks the row clicked, and focus stays in the box', async () => {
    const { user, app, box } = start();
    await user.type(box, '/co');
    await waitFor(() => expect(highlighted()).toBe('/compact'));
    await user.keyboard('{ArrowDown}{Tab}');
    expect(box).toHaveValue('/config ');
    expect(box).toHaveFocus();
    await waitFor(() => expect(listbox()).toBeNull());

    await user.clear(box);
    await user.type(box, '/');
    await waitFor(() => expect(listbox()).not.toBeNull());
    await user.click(options().find((o) => o.textContent!.includes('/notes'))!);
    expect(box).toHaveValue('/notes ');
    expect(box).toHaveFocus();
    expect(app.client.sendMessage).not.toHaveBeenCalled();
  });

  it('VIEW-15.7: a press in the list beside its rows keeps focus in the box and the list open, so what you type next is text', async () => {
    const { user, app, box } = start({ ...CLAUDE, error: 'claude plugin list --json: timed out' });
    await user.type(box, '/co');
    await waitFor(() => expect(highlighted()).toBe('/compact'));
    // The list's own edge and gaps, and the failed read above its rows.
    for (const beside of [listbox()!, within(list()!).getByRole('alert'), document.querySelector<HTMLElement>('[data-slot="commands-popover"]')!]) {
      await user.click(beside);
      expect(box).toHaveFocus();
      expect(shown()).toEqual(['/compact', '/config', '/copy', '/p-kit:code']);
    }
    // "Nothing matches", in place of the rows.
    await user.keyboard('zzz');
    await waitFor(() => expect(within(list()!).getByRole('status')).toHaveTextContent(NO_COMMAND_MATCHES));
    await user.click(within(list()!).getByRole('status'));
    expect(box).toHaveFocus();
    expect(listbox()).not.toBeNull();
    // `p` and `t` are shortcuts of the page (Servers, Topics): here they are letters.
    await user.keyboard('{Backspace}{Backspace}{Backspace}pt');
    expect(box).toHaveValue('/copt');
    expect(screen.queryByRole('tabpanel', { name: 'Topics' })).toBeNull();
    expect(app.client.sendMessage).not.toHaveBeenCalled();
  });

  it('VIEW-15.7: Esc closes the list and keeps the text; it stays closed until the box is empty, and the next Esc leaves the composer', async () => {
    const { user, box } = start();
    await user.type(box, '/co');
    await waitFor(() => expect(listbox()).not.toBeNull());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(listbox()).toBeNull());
    expect(box).toHaveValue('/co');
    expect(box).toHaveFocus();
    await user.keyboard('m');
    expect(box).toHaveValue('/com');
    expect(listbox()).toBeNull();

    await user.clear(box);
    await user.type(box, '/');
    await waitFor(() => expect(listbox()).not.toBeNull());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(listbox()).toBeNull());
    await user.keyboard('{Escape}');
    expect(box).not.toHaveFocus();
  });

  it('VIEW-15.7: Esc closes only the list when the key reaches the page before the box, as in a browser', async () => {
    const { user, box } = start();
    asInABrowser(box);
    const hint = () => document.querySelector('[data-field="keys-hint"]')!;
    await user.type(box, '/co');
    await waitFor(() => expect(listbox()).not.toBeNull());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(listbox()).toBeNull());
    expect(box).toHaveFocus();
    expect(box).toHaveValue('/co');
    expect(hint()).toHaveAttribute('data-keys-at', 'composer');
    await user.keyboard('{Escape}');
    expect(box).not.toHaveFocus();
  });

  it('VIEW-15.7: the highlight follows the pointer when the pointer moves, not when the list moves under it', async () => {
    const { user, box } = start();
    await user.type(box, '/co');
    await waitFor(() => expect(highlighted()).toBe('/compact'));
    // The list scrolled or changed under a pointer at rest: the browser's own `mousemove`, with no movement.
    mouseMove(options()[2]!, false);
    expect(highlighted()).toBe('/compact');
    mouseMove(options()[2]!, true);
    expect(highlighted()).toBe('/copy');
    expect(box).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(box).toHaveValue('/copy ');
  });

  it('VIEW-15.7: a box that sending emptied counts as empty: after Esc and a send, the next `/` opens the list', async () => {
    const { user, app, box } = start();
    await user.type(box, '/co');
    await waitFor(() => expect(listbox()).not.toBeNull());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(listbox()).toBeNull());
    await user.keyboard('mpact{Enter}');
    expect(app.client.sendMessage).toHaveBeenCalledWith('a', '/compact');
    await waitFor(() => expect(box).toHaveValue(''));
    await user.type(box, '/');
    await waitFor(() => expect(listbox()).not.toBeNull());
  });

  it('VIEW-15.8: Enter picks the highlighted row into the box with a space after it and sends nothing; Enter again sends', async () => {
    const { user, app, box } = start();
    await user.type(box, '/not');
    await waitFor(() => expect(highlighted()).toBe('/notes'));
    await user.keyboard('{Enter}');
    expect(box).toHaveValue('/notes ');
    expect((box as HTMLTextAreaElement).selectionStart).toBe('/notes '.length);
    expect(app.client.sendMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(listbox()).toBeNull());
    await user.keyboard('add buy milk{Enter}');
    expect(app.client.sendMessage).toHaveBeenCalledWith('a', '/notes add buy milk');
  });

  it('VIEW-15.8: when the word already is the highlighted item, whole, Enter sends it at once', async () => {
    const { user, app, box } = start();
    await user.type(box, '/compact');
    await waitFor(() => expect(highlighted()).toBe('/compact'));
    await user.keyboard('{Enter}');
    expect(app.client.sendMessage).toHaveBeenCalledWith('a', '/compact');
  });

  it('VIEW-15.3: in a Codex Session a skill is listed and picked as `$name`', async () => {
    const { user, box } = start(CODEX, [row({ id: 'a', harness: 'codex' })]);
    await user.type(box, '/rev');
    await waitFor(() => expect(shown()).toEqual(['$cx-review']));
    await user.keyboard('{Enter}');
    expect(box).toHaveValue('$cx-review ');
  });

  it('VIEW-15.9: while the list is open the hint line names its keys, and the composer\'s again once it closes', async () => {
    const { user, box } = start();
    const hint = () => document.querySelector('[data-field="keys-hint"]')!;
    await user.click(box);
    expect(hint()).toHaveAttribute('data-keys-at', 'composer');
    await user.type(box, '/');
    await waitFor(() => expect(hint()).toHaveAttribute('data-keys-at', 'commands'));
    expect(hint()).toHaveTextContent('Commands · ↑ ↓ move · Tab pick · Esc close');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(hint()).toHaveAttribute('data-keys-at', 'composer'));
  });

  it('VIEW-15.10: while there is no list yet it says what it reads, and typing and sending go on', async () => {
    let finish!: (list: CommandList) => void;
    const { user, app, box } = start(() => new Promise<CommandList>((resolve) => { finish = resolve; }));
    await user.type(box, '/co');
    await waitFor(() => expect(list()).toHaveTextContent(READING_COMMANDS.replace('…', '')));
    expect(within(listbox()!).queryAllByRole('option')).toHaveLength(0);
    await user.type(box, 'mpact');
    expect(box).toHaveValue('/compact');
    finish(CLAUDE);
    await waitFor(() => expect(shown()).toEqual(['/compact']));
    await user.keyboard(' now{Enter}');
    expect(app.client.sendMessage).toHaveBeenCalledWith('a', '/compact now');
  });

  it('VIEW-15.10: a read that fails says why in the list, and the next opening reads again; a list read a moment ago is not read again', async () => {
    let fail = true;
    const { user, box, read } = start(async () => {
      if (fail) throw new Error("Reading the commands and skills failed: the server didn't answer.");
      return CLAUDE;
    });
    await user.type(box, '/');
    // Its own reason, once: nothing was read, so it isn't "couldn't read every".
    await waitFor(() => expect(within(list()!).getByRole('alert')).toHaveTextContent(/^Reading the commands and skills failed: the server didn't answer\.$/));
    fail = false;
    await user.type(box, ' {Backspace}'); // closes, then opens again
    await waitFor(() => expect(shown()).toContain('/compact'));
    expect(read).toHaveBeenCalledTimes(2);
    await user.type(box, ' {Backspace}');
    await waitFor(() => expect(shown()).toContain('/compact'));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('VIEW-15.10: a list that could not read every skill says so above what it did read', async () => {
    const { user, box } = start({ ...CLAUDE, error: 'claude plugin list --json: timed out' });
    await user.type(box, '/');
    await waitFor(() => expect(within(list()!).getByRole('alert')).toHaveTextContent("Couldn't read every command and skill: claude plugin list --json: timed out"));
    expect(shown()).toContain('/compact');
    // When the word leaves no row it says both.
    await user.type(box, 'zzz');
    await waitFor(() => expect(within(list()!).getByRole('status')).toHaveTextContent(NO_COMMAND_MATCHES));
    expect(within(list()!).getByRole('alert')).toBeInTheDocument();
  });

  it('VIEW-15.11: the box is a combobox and the list its listbox, the highlighted row named with its description, mark and source', async () => {
    const { user, box } = start();
    expect(box).not.toHaveAttribute('aria-expanded');
    await user.type(box, '/co');
    await waitFor(() => expect(highlighted()).toBe('/compact'));
    expect(box).toHaveAttribute('role', 'combobox');
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(box).toHaveAttribute('aria-controls', listbox()!.id);
    // The list is the box's own popup, not a dialog.
    expect(listbox()!.closest('[role="dialog"]')).toBeNull();
    expect(box).toHaveAttribute('aria-activedescendant', options()[0]!.id);
    await user.keyboard('{ArrowDown}');
    const config = options()[1]!;
    expect(box).toHaveAttribute('aria-activedescendant', config.id);
    expect(config).toHaveAccessibleName('/config, Open settings, opens in terminal, Built-in');
    expect(options()[0]!).toHaveAccessibleName('/compact, Summarize the conversation to free context, Built-in');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(box).not.toHaveAttribute('role'));
    expect(box).not.toHaveAttribute('aria-activedescendant');
  });

  it("VIEW-15.11: the highlighted row's id is its item's, so a new first row is said as you type; \"nothing matches\" is said too", async () => {
    const { user, box } = start();
    await user.type(box, '/co');
    await waitFor(() => expect(highlighted()).toBe('/compact'));
    const first = box.getAttribute('aria-activedescendant');
    expect(document.getElementById(first!)).toBe(options()[0]);
    await user.keyboard('p'); // `/cop`: the first row is now another item
    await waitFor(() => expect(highlighted()).toBe('/copy'));
    expect(box.getAttribute('aria-activedescendant')).not.toBe(first);
    expect(document.getElementById(box.getAttribute('aria-activedescendant')!)).toBe(options()[0]);
    await user.keyboard('{Backspace}'); // the item it was on comes back under the id it had
    await waitFor(() => expect(box).toHaveAttribute('aria-activedescendant', first));

    // The listbox holds only options; what it says in their place is in a status region that was there before.
    const status = within(list()!).getByRole('status');
    expect(status).toBeEmptyDOMElement();
    await user.keyboard('zzz');
    await waitFor(() => expect(status).toHaveTextContent(NO_COMMAND_MATCHES));
    expect(listbox()).toBeEmptyDOMElement();
    expect(box).not.toHaveAttribute('aria-activedescendant');
    expect(box).toHaveAttribute('aria-controls', listbox()!.id);
  });
});

describe("the `/` list in the launcher's prompt (LAUNCH-8)", () => {
  async function openLauncher(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'New Session' }));
    return screen.findByRole('dialog');
  }

  async function launcher(lists: { claude?: CommandList; codex?: CommandList } = {}) {
    const user = userEvent.setup();
    const launchCommands = vi.fn(async (harness: 'claude' | 'codex') => lists[harness] ?? (harness === 'claude' ? CLAUDE : CODEX));
    const app = renderApp('/', { launchCommands });
    app.snapshot([]);
    await openLauncher(user);
    await waitFor(() => expect(screen.getByRole('button', { name: /Start/ })).toBeEnabled());
    const prompt = screen.getByLabelText('Prompt');
    return { user, app, prompt, launchCommands };
  }

  it('LAUNCH-8.1: the prompt field takes the list, for the Harness and start directory chosen, and reads it again for another Harness', async () => {
    const { user, prompt, launchCommands } = await launcher();
    await user.type(prompt, '/');
    await waitFor(() => expect(listbox()).not.toBeNull());
    expect(launchCommands).toHaveBeenLastCalledWith('claude', '~/Projects/work', null);
    await waitFor(() => expect(shown()).toContain('/notes'));
    await user.type(prompt, 'not');
    expect(shown()).toEqual(['/notes']);
    expect(prompt).toHaveAttribute('aria-expanded', 'true');

    // Choosing another Harness with the list open closes it, as focus leaves; the next key opens the other Harness's.
    await user.click(screen.getByRole('radio', { name: /Codex/ }));
    await waitFor(() => expect(listbox()).toBeNull());
    await user.click(prompt);
    await user.keyboard('{Backspace}{Backspace}{Backspace}rev');
    await waitFor(() => expect(launchCommands).toHaveBeenLastCalledWith('codex', '~/Projects/work', null));
    await waitFor(() => expect(shown()).toEqual(['$cx-review']));
  });

  it('LAUNCH-8.1: focus leaving the prompt is not an Esc, and a press in the list beside its rows keeps focus in the prompt', async () => {
    const { user, prompt } = await launcher();
    await user.type(prompt, '/co');
    await waitFor(() => expect(listbox()).not.toBeNull());
    await user.tab({ shift: true });
    expect(prompt).not.toHaveFocus();
    await waitFor(() => expect(listbox()).toBeNull());
    await user.click(prompt);
    await user.keyboard('m');
    await waitFor(() => expect(shown()).toEqual(['/compact']));

    await user.keyboard('zzz');
    await waitFor(() => expect(within(list()!).getByRole('status')).toHaveTextContent(NO_COMMAND_MATCHES));
    await user.click(within(list()!).getByRole('status'));
    await user.click(listbox()!);
    expect(prompt).toHaveFocus();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    expect(listbox()).not.toBeNull();
  });

  it('LAUNCH-8.3: Enter and Tab pick and never start; with no row to pick Enter adds a line', async () => {
    const { user, app, prompt } = await launcher();
    await user.type(prompt, '/not');
    await waitFor(() => expect(highlighted()).toBe('/notes'));
    await user.keyboard('{Enter}');
    expect(prompt).toHaveValue('/notes ');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(app.client.launch).not.toHaveBeenCalled();

    await user.clear(prompt);
    await user.type(prompt, '/compact');
    await waitFor(() => expect(highlighted()).toBe('/compact'));
    await user.keyboard('{Enter}'); // the word, whole: still a pick here, never a start
    expect(prompt).toHaveValue('/compact ');
    expect(app.client.launch).not.toHaveBeenCalled();

    await user.clear(prompt);
    await user.type(prompt, '/co{Tab}');
    expect(prompt).toHaveValue('/compact ');
    expect(prompt).toHaveFocus();

    await user.clear(prompt);
    await user.type(prompt, '/zzz');
    await waitFor(() => expect(list()).toHaveTextContent(NO_COMMAND_MATCHES));
    await user.keyboard('{Enter}');
    expect(prompt).toHaveValue('/zzz\n');
    expect(app.client.launch).not.toHaveBeenCalled();
  });

  it('LAUNCH-8.3: Esc closes the list and not the launcher; the next Esc closes the launcher', async () => {
    const { user, prompt } = await launcher();
    await user.type(prompt, '/co');
    await waitFor(() => expect(listbox()).not.toBeNull());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(listbox()).toBeNull());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(prompt).toHaveValue('/co');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
