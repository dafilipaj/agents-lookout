import type { HistoryDetail, RenameResult } from '@shared/types.ts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaveError } from '@/lib/client';
import { RENAME_LOST, RENAME_NOT_SHOWN, RENAME_SETTLE_MS, RENAME_WHY } from '@/lib/rename';
import { NOW, field, launchView, renderApp, row, rowEl } from '@/test/helpers';

const header = () => screen.getByRole('banner', { name: 'Session' });
const heading = () => within(header()).getByRole('heading', { level: 1 });
const renameButton = () => within(header()).queryByRole('button', { name: /^fix-rates|^Invoice rounding/ });
const nameField = () => within(header()).queryByRole('textbox', { name: 'Session name' });
const note = () => header().querySelector<HTMLElement>('[data-slot="rename-note"]');

/** A rename the test answers when it wants to. */
function pendingRename() {
  let resolve!: (r: RenameResult) => void;
  let reject!: (e: unknown) => void;
  const renameSession = vi.fn(
    () =>
      new Promise<RenameResult>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  return { renameSession, resolve: (r: RenameResult) => act(() => resolve(r)), reject: (e: unknown) => act(() => reject(e)) };
}

/** Renames the test answers one by one, each when it wants to: the Nth call is `calls[N]`. */
function pendingRenames() {
  const calls: { resolve(r: RenameResult): void; reject(e: unknown): void }[] = [];
  const renameSession = vi.fn(
    () =>
      new Promise<RenameResult>((res, rej) => {
        calls.push({ resolve: (r) => act(() => res(r)), reject: (e) => act(() => rej(e)) });
      }),
  );
  return { renameSession, calls };
}

afterEach(() => vi.useRealTimers());

describe('renaming from the header (VIEW-5.12)', () => {
  it('VIEW-5.12: at rest the title looks like the title; a pencil shows on hover or keyboard focus and its tooltip says "Rename"', () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates', status: 'idle' })]);
    expect(heading()).toHaveTextContent('fix-rates');
    const button = renameButton()!;
    expect(heading()).toContainElement(button);
    expect(button).toHaveAttribute('title', 'Rename');
    expect(button).toHaveAccessibleName('fix-rates');
    expect(button).toHaveAccessibleDescription('Rename');
    // The pencil is lucide's, hidden until hover or keyboard focus (class contract; jsdom can't hover).
    const pencil = button.querySelector('[data-slot="title-pencil"]')!;
    expect(pencil).toHaveClass('lucide-pencil', 'opacity-0', 'group-hover/title:opacity-100', 'group-focus-visible/title:opacity-100');
    expect(pencil).toHaveAttribute('aria-hidden', 'true');
    expect(nameField()).toBeNull();
  });

  it('VIEW-5.12: a click opens a field as wide as the title with the whole name selected; Enter saves the trimmed name', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates' })]);
    await user.click(renameButton()!);
    const input = nameField() as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input).toHaveValue('fix-rates');
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'fix-rates'.length]);
    // As wide as the title was (jsdom measures 0), at least 8rem; it gives way like the title.
    expect(input.style.width).toBe('max(8rem, 0px)');
    expect(input).toHaveClass('max-w-full', 'min-w-0', 'h-7');
    expect(heading()).toContainElement(input);
    await user.keyboard('  Invoice rounding  {Enter}');
    expect(app.client.renameSession).toHaveBeenCalledExactlyOnceWith('a', 'Invoice rounding');
  });

  it('VIEW-5.12: Enter on the focused title opens the field too; Esc cancels and puts focus back on the title', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates' })]);
    renameButton()!.focus();
    await user.keyboard('{Enter}');
    expect(nameField()).toHaveFocus();
    await user.keyboard('something else{Escape}');
    expect(nameField()).toBeNull();
    expect(heading()).toHaveTextContent('fix-rates');
    expect(renameButton()).toHaveFocus();
    expect(app.client.renameSession).not.toHaveBeenCalled();
    // Esc in the field is the field's: the composer (VIEW-3.6) and the page's shortcuts don't see it.
    expect(screen.getByRole('textbox', { name: 'Message' })).not.toHaveFocus();
  });

  it('VIEW-5.12: leaving the field saves when the name changed, and only then', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates' })]);
    await user.click(renameButton()!);
    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    expect(nameField()).toBeNull();
    expect(app.client.renameSession).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus(); // the title doesn't take focus back

    await user.click(renameButton()!);
    await user.keyboard('Invoice rounding');
    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    expect(app.client.renameSession).toHaveBeenCalledExactlyOnceWith('a', 'Invoice rounding');
  });

  it('VIEW-5.12: an empty or unchanged name renames nothing', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates' })]);
    await user.click(renameButton()!);
    await user.keyboard('{Backspace}   {Enter}');
    expect(nameField()).toBeNull();
    await user.click(renameButton()!);
    await user.keyboard('  fix-rates {Enter}');
    expect(nameField()).toBeNull();
    expect(app.client.renameSession).not.toHaveBeenCalled();
    expect(note()).toBeNull();
  });

  it('VIEW-5.12: a name over 64 characters, or with characters that can’t be typed, isn’t sent: the field stays open and says why', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates' })]);
    await user.click(renameButton()!);
    fireEvent.change(nameField()!, { target: { value: 'x'.repeat(65) } });
    await user.keyboard('{Enter}');
    expect(app.client.renameSession).not.toHaveBeenCalled();
    expect(nameField()).toHaveValue('x'.repeat(65));
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
    expect(note()).toHaveTextContent('A name is at most 64 characters; this one has 65.');
    expect(note()).toHaveAttribute('role', 'alert');
    expect(nameField()).toHaveAccessibleDescription('A name is at most 64 characters; this one has 65.');

    fireEvent.change(nameField()!, { target: { value: 'tab\there' } });
    await user.keyboard('{Enter}');
    expect(note()).toHaveTextContent("can't be typed");
    // 64 emoji are 64 characters, as Fleet counts them.
    fireEvent.change(nameField()!, { target: { value: '🚀'.repeat(64) } });
    await user.keyboard('{Enter}');
    expect(app.client.renameSession).toHaveBeenCalledExactlyOnceWith('a', '🚀'.repeat(64));
  });

  it('VIEW-5.12: a Codex Session with a session ID is renamed the same way', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/uuid-1');
    app.snapshot([row({ id: 'uuid-1', harness: 'codex', title: 'fix-rates' })]);
    await user.click(renameButton()!);
    await user.keyboard('Invoice rounding{Enter}');
    expect(app.client.renameSession).toHaveBeenCalledExactlyOnceWith('uuid-1', 'Invoice rounding');
  });

  it('VIEW-5.12: the header stays one line: the title and its field truncate and give way, the buttons don’t (class contract; jsdom can’t measure)', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates', ownHost: true })]);
    expect(header().querySelector('[data-slot="header-row"]')).toHaveClass('whitespace-nowrap');
    expect(heading()).toHaveClass('truncate', 'min-w-5');
    expect(renameButton()).toHaveClass('max-w-full', 'min-w-0');
    expect(renameButton()!.querySelector('span')).toHaveClass('truncate', 'min-w-0');
    await user.click(renameButton()!);
    expect(heading()).toHaveClass('truncate', 'min-w-5');
    expect(nameField()).not.toHaveClass('shrink-0');
  });
  it('VIEW-5.12: line breaks in a pasted name become spaces, a run of them one space (CR, LF or CRLF), and the caret goes after the paste', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates' })]);
    await user.click(renameButton()!);
    // The whole name is selected: the paste takes its place.
    await user.paste('Invoice\nrounding\r\n\r\nfor\rMarch');
    expect(nameField()).toHaveValue('Invoice rounding for March');
    // Pasted mid-name, it lands at the caret, and the caret goes after it.
    const input = nameField() as HTMLInputElement;
    input.setSelectionRange('Invoice'.length, 'Invoice'.length);
    await user.paste('\n2026\n');
    expect(input).toHaveValue('Invoice 2026  rounding for March');
    expect([input.selectionStart, input.selectionEnd]).toEqual(['Invoice 2026 '.length, 'Invoice 2026 '.length]);
    // A paste without a line break is the browser's own.
    await user.paste('Q1');
    expect(input).toHaveValue('Invoice 2026 Q1 rounding for March');
    expect(note()).toBeNull();
    await user.keyboard('{Enter}');
    expect(app.client.renameSession).toHaveBeenCalledExactlyOnceWith('a', 'Invoice 2026 Q1 rounding for March');
  });
});

describe('who can be renamed (VIEW-5.13)', () => {
  it.each([
    ['busy', RENAME_WHY.busy],
    ['needs-you', RENAME_WHY['needs-you']],
    ['unknown', RENAME_WHY.unknown],
  ] as const)('VIEW-5.13: a Session whose Status is %s keeps a plain title whose tooltip says why', (status, why) => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates', status })]);
    expect(heading()).toHaveTextContent('fix-rates');
    expect(within(heading()).queryByRole('button')).toBeNull();
    expect(heading()).toHaveAttribute('title', `fix-rates\n${why}`);
  });

  it('VIEW-5.13: a View only Session, and a Codex Session before its first prompt, keep a plain title whose tooltip says why', () => {
    const app = renderApp('/s/orca');
    app.snapshot([
      row({ id: 'orca', title: 'docs-cleanup', backend: 'unknown', controllable: false }),
      row({ id: 'codex:42', pid: 42, harness: 'codex', title: 'starting-codex' }),
    ]);
    expect(within(heading()).queryByRole('button')).toBeNull();
    expect(heading()).toHaveAttribute('title', `docs-cleanup\n${RENAME_WHY.otherApp}`);
    act(() => window.history.pushState(null, '', '/s/codex%3A42'));
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(heading()).toHaveTextContent('starting-codex');
    expect(within(heading()).queryByRole('button')).toBeNull();
    expect(heading()).toHaveAttribute('title', `starting-codex\n${RENAME_WHY.noId}`);
  });

  it('VIEW-5.13: the title turns renameable once the Session is Idle, and plain again when it starts a turn', () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates', status: 'busy' })]);
    expect(renameButton()).toBeNull();
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', title: 'fix-rates', status: 'idle' })], remove: [] });
    expect(renameButton()).not.toBeNull();
    expect(heading()).not.toHaveAttribute('title');
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', title: 'fix-rates', status: 'busy' })], remove: [] });
    expect(renameButton()).toBeNull();
  });

  it('VIEW-5.13: an ended Session keeps a plain title, with no reason in its tooltip', () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates' })]);
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    expect(screen.getByText('This Session ended')).toBeInTheDocument();
    expect(within(heading()).queryByRole('button')).toBeNull();
    expect(heading()).toHaveAttribute('title', 'fix-rates');
  });

  it('VIEW-5.13: a past Session (HIST-3.3) keeps a plain title', async () => {
    const detail: HistoryDetail = {
      item: { sessionId: 'past-1', harness: 'claude', headless: false, title: 'old-review', projectPath: '/Users/me/Projects/work', repo: 'work', branch: 'main', lastActiveAt: NOW - 3_600_000, snippet: null, blocked: null },
      source: 'transcript',
      preview: 'latest',
      totalMessages: 0,
      entries: [],
    };
    const app = renderApp('/h/claude/past-1', { pastSession: async () => detail });
    app.snapshot([]);
    const view = await screen.findByTestId('past-session');
    await waitFor(() => expect(within(view).getByRole('heading', { level: 1 })).toHaveTextContent('old-review'));
    expect(within(view).queryByRole('button', { name: 'old-review' })).toBeNull();
    expect(within(view).queryByRole('textbox', { name: 'Session name' })).toBeNull();
  });
  it.each([
    ['Busy', { status: 'busy' }, RENAME_WHY.busy],
    ['Needs you', { status: 'needs-you' }, RENAME_WHY['needs-you']],
    ['Status unknown', { status: 'unknown' }, RENAME_WHY.unknown],
    ['View only', { controllable: false, backend: 'unknown' }, RENAME_WHY.otherApp],
  ] as const)('VIEW-5.13: an edit started while Idle is cancelled once the Session is %s: nothing is saved, and the plain title says why', async (_, change, why) => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates' })]);
    await user.click(renameButton()!);
    await user.keyboard('Invoice rounding');
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', title: 'fix-rates', ...change })], remove: [] });
    expect(nameField()).toBeNull();
    expect(heading()).toHaveTextContent('fix-rates');
    expect(within(heading()).queryByRole('button')).toBeNull();
    expect(heading()).toHaveAttribute('title', `fix-rates\n${why}`);
    expect(heading()).toHaveFocus(); // the field had it: it goes back to the title, not the page
    await user.keyboard('{Enter}');
    await user.click(document.body);
    expect(app.client.renameSession).not.toHaveBeenCalled();
    expect(note()).toBeNull();
    // Idle again, the title is renameable, and the cancelled edit doesn't come back.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', title: 'fix-rates' })], remove: [] });
    expect(renameButton()).not.toBeNull();
    expect(nameField()).toBeNull();
    expect(app.client.renameSession).not.toHaveBeenCalled();
  });

  it('VIEW-5.13: an edit is cancelled when the Session ends: nothing is saved', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates' })]);
    await user.click(renameButton()!);
    await user.keyboard('Invoice rounding');
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    expect(screen.getByText('This Session ended')).toBeInTheDocument();
    expect(nameField()).toBeNull();
    expect(heading()).toHaveAttribute('title', 'fix-rates');
    await user.keyboard('{Enter}');
    await user.click(document.body);
    expect(app.client.renameSession).not.toHaveBeenCalled();
  });

  it.each([
    ['another Session’s row', () => rowEl('b')],
    ['a start’s row', () => document.querySelector<HTMLElement>('[data-launch-id]')!],
  ])('VIEW-5.13: going to %s mid-edit cancels the edit without saving it', async (_, target) => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates' }), row({ id: 'b', title: 'docs-cleanup' })]);
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-1', title: 'new-start' })], started: [] });
    await user.click(renameButton()!);
    await user.keyboard('Invoice rounding');
    await user.click(target());
    expect(app.client.renameSession).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Session name' })).toBeNull();
    await user.click(rowEl('a'));
    expect(heading()).toHaveTextContent('fix-rates');
    expect(renameButton()).not.toBeNull();
    expect(nameField()).toBeNull();
    expect(app.client.renameSession).not.toHaveBeenCalled();
  });
});

describe('what came of it (VIEW-5.14)', () => {
  it('VIEW-5.14: while it runs the field reads "Renaming…", disabled; the new title shows once the list reports it, in the header and the sidebar', async () => {
    const user = userEvent.setup();
    const rename = pendingRename();
    const app = renderApp('/s/a', { renameSession: rename.renameSession });
    app.snapshot([row({ id: 'a', title: 'fix-rates' })]);
    await user.click(renameButton()!);
    await user.keyboard('Invoice rounding{Enter}');
    expect(nameField()).toHaveValue('Renaming…');
    expect(nameField()).toBeDisabled();
    rename.resolve({ result: 'renamed' });
    // Fleet answered, but the list hasn't shown it yet: still "Renaming…".
    expect(nameField()).toHaveValue('Renaming…');
    expect(field('a', 'title')).toHaveTextContent('fix-rates');
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', title: 'Invoice rounding' })], remove: [] });
    expect(nameField()).toBeNull();
    expect(heading()).toHaveTextContent('Invoice rounding');
    expect(field('a', 'title')).toHaveTextContent('Invoice rounding');
    expect(note()).toBeNull();
    expect(app.client.renameSession).toHaveBeenCalledOnce();
  });

  it('VIEW-5.14: a new title from the list ends "Renaming…" even before Fleet answers', async () => {
    const user = userEvent.setup();
    const rename = pendingRename();
    const app = renderApp('/s/a', { renameSession: rename.renameSession });
    app.snapshot([row({ id: 'a', title: 'fix-rates' })]);
    await user.click(renameButton()!);
    await user.keyboard('Invoice rounding{Enter}');
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', title: 'Invoice rounding' })], remove: [] });
    expect(nameField()).toBeNull();
    expect(heading()).toHaveTextContent('Invoice rounding');
    rename.resolve({ result: 'renamed' });
    expect(nameField()).toBeNull();
    expect(note()).toBeNull();
  });

  it('VIEW-5.14: sent but not shown: "Renaming…" stays 5 s after Fleet’s answer, then a muted line says so', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const app = renderApp('/s/a', { renameSession: async () => ({ result: 'sent' }) });
    app.snapshot([row({ id: 'a', title: 'fix-rates' })]);
    await user.click(renameButton()!);
    await user.keyboard('Invoice rounding{Enter}');
    await waitFor(() => expect(app.client.renameSession).toHaveBeenCalled());
    act(() => vi.advanceTimersByTime(RENAME_SETTLE_MS - 1_000));
    expect(nameField()).toHaveValue('Renaming…');
    act(() => vi.advanceTimersByTime(2_000));
    expect(nameField()).toBeNull();
    expect(heading()).toHaveTextContent('fix-rates');
    expect(note()).toHaveTextContent(RENAME_NOT_SHOWN);
    expect(note()).toHaveAttribute('role', 'status');
    expect(note()).toHaveAttribute('data-tone', 'info');
    expect(note()!.querySelector('span')).toHaveClass('text-muted-foreground');
    expect(renameButton()).toHaveAttribute('title', `Rename\n${RENAME_NOT_SHOWN}`);
    // The title it shows later still arrives, and the next rename starts clean.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', title: 'Invoice rounding' })], remove: [] });
    expect(heading()).toHaveTextContent('Invoice rounding');
    await user.click(renameButton()!);
    expect(note()).toBeNull();
  });

  it('VIEW-5.14: a failure keeps the old title, says why beside it as Stop’s error does, and isn’t retried', async () => {
    const user = userEvent.setup();
    const why = 'The Session’s input box holds text, so it wasn’t renamed. Send or clear it in the terminal, then try again.';
    const renameSession = vi.fn(async (): Promise<RenameResult> => {
      throw new SaveError(why, null, 409);
    });
    const app = renderApp('/s/a', { renameSession });
    app.snapshot([row({ id: 'a', title: 'fix-rates', status: 'busy' }), row({ id: 'b' })]);
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', title: 'fix-rates', status: 'idle' })], remove: [] });
    await user.click(renameButton()!);
    await user.keyboard('Invoice rounding{Enter}');
    await waitFor(() => expect(note()).toHaveTextContent(why));
    expect(note()).toHaveAttribute('role', 'alert');
    expect(note()).toHaveClass('min-w-12', 'flex-[1_1_0]');
    expect(header().querySelector('[data-slot="rename-note-full"]')).toHaveTextContent(why);
    expect(nameField()).toBeNull();
    expect(heading()).toHaveTextContent('fix-rates');
    expect(renameButton()).toHaveAttribute('title', `Rename\n${why}`);
    expect(renameButton()).toHaveFocus();
    expect(renameSession).toHaveBeenCalledOnce();
    // The next try starts clean.
    await user.click(renameButton()!);
    expect(note()).toBeNull();
  });

  it('VIEW-5.14: no answer from Lookout’s server says it may have been renamed', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a', {
      renameSession: async () => {
        throw new SaveError("Couldn't reach the Lookout server.", null, null, { lost: true });
      },
    });
    app.snapshot([row({ id: 'a', title: 'fix-rates' })]);
    await user.click(renameButton()!);
    await user.keyboard('Invoice rounding{Enter}');
    await waitFor(() => expect(note()).toHaveTextContent(RENAME_LOST));
  });
  it('VIEW-5.14: an answer for a rename that’s no longer current changes nothing: its title read back, then a new edit open', async () => {
    const user = userEvent.setup();
    const why = 'The Session’s input box holds text, so it wasn’t renamed. Send or clear it in the terminal, then try again.';
    const rename = pendingRename();
    const app = renderApp('/s/a', { renameSession: rename.renameSession });
    app.snapshot([row({ id: 'a', title: 'fix-rates' })]);
    await user.click(renameButton()!);
    await user.keyboard('Invoice rounding{Enter}');
    const rejectFirst = rename.reject;
    // The list shows the new title before Fleet answers: that rename is done.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', title: 'Invoice rounding' })], remove: [] });
    await user.click(renameButton()!);
    await user.keyboard('{End} v2');
    // Then the first request fails late: the new edit isn't marked invalid, and nothing says it failed.
    await rejectFirst(new SaveError(why, null, 409));
    expect(nameField()).toHaveValue('Invoice rounding v2');
    expect(nameField()).not.toHaveAttribute('aria-invalid');
    expect(nameField()).not.toHaveAccessibleDescription();
    expect(note()).toBeNull();
    await user.keyboard('{Enter}');
    expect(rename.renameSession).toHaveBeenLastCalledWith(expect.anything(), 'Invoice rounding v2');
    expect(nameField()).toHaveValue('Renaming…');
  });

  it('VIEW-5.14: a late failure for a rename whose title was already read back doesn’t show beside the new title', async () => {
    const user = userEvent.setup();
    const rename = pendingRename();
    const app = renderApp('/s/a', { renameSession: rename.renameSession });
    app.snapshot([row({ id: 'a', title: 'fix-rates' })]);
    await user.click(renameButton()!);
    await user.keyboard('Invoice rounding{Enter}');
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', title: 'Invoice rounding' })], remove: [] });
    await rename.reject(new SaveError('Couldn’t rename it. Check the terminal.', null, 502));
    expect(heading()).toHaveTextContent('Invoice rounding');
    expect(note()).toBeNull();
    expect(renameButton()).toHaveAttribute('title', 'Rename');
  });

  describe('an answer for an earlier rename while a newer one is out', () => {
    // Rename A is out; its new title is read back through the list (A is over); rename B is submitted
    // and is out too; only now does A's request settle. B is the current rename: A's answer is not for it.
    async function aOverBOut() {
      const user = userEvent.setup();
      const renames = pendingRenames();
      const app = renderApp('/s/a', { renameSession: renames.renameSession });
      app.snapshot([row({ id: 'a', title: 'fix-rates' })]);
      await user.click(renameButton()!);
      await user.keyboard('Invoice rounding{Enter}');
      app.emit({ type: 'sessions', upsert: [row({ id: 'a', title: 'Invoice rounding' })], remove: [] });
      expect(nameField()).toBeNull();
      await user.click(renameButton()!);
      await user.keyboard('{End} v2{Enter}');
      expect(renames.renameSession).toHaveBeenCalledTimes(2);
      expect(renames.renameSession).toHaveBeenLastCalledWith(expect.anything(), 'Invoice rounding v2');
      expect(nameField()).toHaveValue('Renaming…');
      return { app, a: renames.calls[0]!, b: renames.calls[1]! };
    }

    it('VIEW-5.14: rename A’s success arriving while rename B is out leaves B "Renaming…", until B’s own answer', async () => {
      const { app, a, b } = await aOverBOut();
      await a.resolve({ result: 'renamed' });
      // A's success must not move B on: B is still waiting for Fleet, and nothing is shown.
      expect(nameField()).toHaveValue('Renaming…');
      expect(nameField()).toBeDisabled();
      expect(note()).toBeNull();
      // B's own answer lands normally: Fleet answered, the list hasn't shown it yet, then it does.
      await b.resolve({ result: 'renamed' });
      expect(nameField()).toHaveValue('Renaming…');
      app.emit({ type: 'sessions', upsert: [row({ id: 'a', title: 'Invoice rounding v2' })], remove: [] });
      expect(nameField()).toBeNull();
      expect(heading()).toHaveTextContent('Invoice rounding v2');
      expect(note()).toBeNull();
      expect(app.client.renameSession).toHaveBeenCalledTimes(2);
    });

    it('VIEW-5.14: rename A’s failure arriving while rename B is out leaves B "Renaming…", until B’s own answer', async () => {
      const { a, b } = await aOverBOut();
      await a.reject(new SaveError('The Session’s input box holds text, so it wasn’t renamed.', null, 409));
      // A's failure must not end B or show beside the title.
      expect(nameField()).toHaveValue('Renaming…');
      expect(nameField()).toBeDisabled();
      expect(note()).toBeNull();
      // B's own answer lands normally: its failure shows beside the title it kept.
      const why = 'Couldn’t rename it. Check the terminal.';
      await b.reject(new SaveError(why, null, 502));
      expect(nameField()).toBeNull();
      expect(heading()).toHaveTextContent('Invoice rounding');
      expect(note()).toHaveTextContent(why);
      expect(note()).toHaveAttribute('role', 'alert');
    });
  });
});
