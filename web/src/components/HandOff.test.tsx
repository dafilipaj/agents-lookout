import type { ChatEntry, ChatPage, SessionRow } from '@shared/types.ts';
import { NO_ACTIVITY, type Topic, memberKey } from '@shared/topics.ts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KEPT_HANDOVER_PREFIX, HANDOFF_ENDED, HANDOFF_NEEDS_YOU, HANDOFF_NOT_FOUND, HANDOFF_NO_TEXT, HANDOFF_READS, HANDOFF_READ_MS, RESTATE_LINE, type WritingWait, afterRead, handoffPrompt, handoffRequest, handoverFrom, replyAfter } from '@/lib/handoff';
import { SaveError } from '@/lib/client';
import { NOW, field, launchView, renderApp, row, rowEl, settings } from '@/test/helpers';
import { HAND_OFF_ENDED, HAND_OFF_WAITS, PIECE_PLACEHOLDER } from './HandOff';

const OLD = 'a1b2c3d4-0000-4000-8000-000000000001';
const NEW = 'b1b2c3d4-0000-4000-8000-000000000002';
const THIRD = 'c1b2c3d4-0000-4000-8000-000000000003';
const WORKTREE = '/Users/me/Projects/shop-worktrees/csv-export';

const oldRow = (over: Partial<SessionRow> = {}) => row({ id: OLD, title: 'Add CSV export to reports', cwd: WORKTREE, model: 'claude-opus-5-5', effort: 'xhigh', ...over });
const user = (text: string, cursor = 'g1.1'): ChatEntry => ({ kind: 'user', cursor, ts: null, text, queued: false });
const said = (text: string, cursor = 'g1.2'): ChatEntry => ({ kind: 'assistant', cursor, ts: null, text, final: true });
/** A reply on the way: not the Turn's answer (Fleet's `final`). */
const update = (text: string, cursor = 'g1.2'): ChatEntry => ({ kind: 'assistant', cursor, ts: null, text, final: false });
const HANDOVER = "Fix the PDF export's date format in ~/Projects/shop.\n\nFirst move: a failing test for a de-DE account.";
const reply = `<handover>\n${HANDOVER}\n</handover>`;

/** The app on the old Session, its chat answering the request with `answer` once the Turn ends. */
function open(over: Partial<SessionRow> = {}, options: Parameters<typeof renderApp>[1] = {}, answer: (request: string) => ChatEntry[] = (request) => [user(request), said(reply)]) {
  let request = '';
  // The Turn: the request shows in the chat once sent; the reply once the Session was Busy and is Idle again.
  let busy = false;
  let replied = false;
  const sendMessage = vi.fn(async (_id: string, text: string) => {
    request = text;
    busy = replied = false;
  });
  const latestMessages = vi.fn(async (): Promise<ChatPage> => ({ entries: !request ? [] : replied ? answer(request) : [user(request)], before: null }));
  const app = renderApp(`/s/${OLD}`, { sendMessage, latestMessages, ...options });
  app.snapshot([oldRow(over), row({ id: 'other', title: 'Other work' })]);
  const status = (s: SessionRow['status'], more: Partial<SessionRow> = {}) => {
    if (s === 'busy') busy = true;
    if (s === 'idle' && busy) replied = true;
    app.emit({ type: 'sessions', upsert: [oldRow({ ...over, status: s, ...more })], remove: [] });
  };
  return { app, sendMessage, latestMessages, status };
}

const button = () => screen.getByRole('button', { name: 'Hand off…' });
const popover = () => screen.findByRole('dialog', { name: 'Hand off' });
const launcher = () => screen.findByRole('dialog', { name: 'Hand off from Add CSV export to reports' });
const noLauncher = () => screen.queryByRole('dialog', { name: /^(Hand off from |New Session$)/ });
/** HAND-6.1: once the Handover is ready, the button says so, and a press opens the launcher with it. */
async function openReady(timeout = 1000) {
  await waitFor(() => expect(button()).toHaveAttribute('data-wait', 'ready'), { timeout });
  await userEvent.click(button());
  return launcher();
}

async function writeHandover(piece = '') {
  const u = userEvent.setup();
  await u.click(button());
  const dialog = await popover();
  if (piece) await u.type(within(dialog).getByRole('textbox', { name: 'What to hand off' }), piece);
  await u.click(within(dialog).getByRole('button', { name: /Write Handover/ }));
  return u;
}

describe('HAND-1: asking for a Handover', () => {
  it('HAND-1.1: "Hand off…" is the header\'s first action for a Controllable Claude Code or Codex Session with a session id; it waits, saying so, while Busy or Needs you', async () => {
    const { app, status } = open();
    const actions = document.querySelector('[data-slot="header-actions"]')!;
    expect(within(actions as HTMLElement).getAllByRole('button')[0]).toBe(button());
    expect(button()).not.toHaveAttribute('aria-disabled');
    for (const s of ['busy', 'needs-you'] as const) {
      status(s);
      expect(button()).toHaveAttribute('aria-disabled', 'true');
      expect(button()).toHaveAttribute('title', HAND_OFF_WAITS);
      await userEvent.click(button());
      expect(screen.queryByRole('dialog', { name: 'Hand off' })).toBeNull();
    }
    // Codex too.
    app.snapshot([oldRow({ harness: 'codex' })]);
    expect(button()).toBeInTheDocument();
  });

  it('HAND-1.1: an open form waits too: "Write Handover" is disabled, saying why, while the Session is Busy or Needs you, and Enter sends nothing', async () => {
    const t = open();
    const u = userEvent.setup();
    await u.click(button());
    const dialog = await popover();
    const write = within(dialog).getByRole('button', { name: /Write Handover/ });
    for (const s of ['busy', 'needs-you'] as const) {
      t.status(s);
      await waitFor(() => expect(write).toBeDisabled());
      expect(write).toHaveAttribute('title', HAND_OFF_WAITS);
      expect(within(dialog).getByText(HAND_OFF_WAITS)).toBeInTheDocument();
      await u.type(within(dialog).getByRole('textbox', { name: 'What to hand off' }), 'x{Enter}');
      expect(t.sendMessage).not.toHaveBeenCalled();
    }
    t.status('idle');
    await waitFor(() => expect(write).toBeEnabled());
    await u.click(write);
    expect(t.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('HAND-1.1: not offered for a Session that is View only, has no session id yet, or has ended', () => {
    const { app } = open({ controllable: false });
    expect(screen.queryByRole('button', { name: 'Hand off…' })).toBeNull();
    app.snapshot([row({ id: 'claude:100', pid: 100 })]);
    window.history.replaceState(null, '', '/s/claude:100');
    expect(screen.queryByRole('button', { name: 'Hand off…' })).toBeNull();
  });

  it('HAND-1.1: an ended Session has no "Hand off…"', () => {
    const { app } = open();
    app.emit({ type: 'sessions', upsert: [], remove: [OLD] });
    expect(screen.queryByRole('button', { name: 'Hand off…' })).toBeNull();
  });

  it('HAND-1.2: "Hand off…" opens "Hand off" with one optional field; Esc or Cancel closes it and sends nothing', async () => {
    const { sendMessage } = open();
    const u = userEvent.setup();
    await u.click(button());
    const dialog = await popover();
    const field = within(dialog).getByRole('textbox', { name: 'What to hand off' });
    expect(field).toHaveAttribute('placeholder', PIECE_PLACEHOLDER);
    expect(field).toHaveFocus();
    expect(button()).toHaveAttribute('data-state', 'open');
    await u.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Hand off' })).toBeNull());
    await u.click(button());
    await u.click(within(await popover()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Hand off' })).toBeNull());
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("HAND-1.2, HAND-1.3: Enter writes: the request goes to the Session in Lookout's fixed wording, covering all of the work, or the piece when one is given", async () => {
    const { sendMessage, app } = open();
    const u = userEvent.setup();
    await u.click(button());
    await u.keyboard('{Enter}');
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(OLD, handoffRequest('')));
    expect(handoffRequest('')).toContain("continue all of this Session's work.");
    app.unmount();

    const again = open();
    await writeHandover("the PDF export's date format");
    await waitFor(() => expect(again.sendMessage).toHaveBeenCalledWith(OLD, handoffRequest("the PDF export's date format")));
    expect(handoffRequest("the PDF export's date format")).toMatch(/^Write a Handover for a new Session that will continue this piece of it: the PDF export's date format\. It starts with an empty context/);
    expect(handoffRequest('x').split('\n').at(-1)).toBe("Don't change anything now. Reply with the Handover alone, between a line <handover> and a line </handover>.");
  });

  it('HAND-1.3: a send that fails says why, as the composer\'s do (VIEW-3.7)', async () => {
    open({}, { sendMessage: async () => { throw new SaveError("Couldn't send: the Session's input box holds text. Send or clear it in the terminal, then try again.", null, 409); } });
    await writeHandover();
    const dialog = await popover();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("the Session's input box holds text");
    expect(within(dialog).getByRole('button', { name: /Try again/ })).toBeEnabled();
  });

  it('HAND-1.4: F opens "Hand off…" for the selected Session, but not from a text field', async () => {
    open();
    const u = userEvent.setup();
    await u.click(screen.getByRole('textbox', { name: 'Message' }));
    await u.keyboard('f');
    expect(screen.queryByRole('dialog', { name: 'Hand off' })).toBeNull();
    (document.activeElement as HTMLElement).blur();
    await u.keyboard('f');
    expect(await popover()).toBeInTheDocument();
  });
});

describe('HAND-2: the Session writes it', () => {
  it('HAND-2.1: while the Session writes, the popover says so, with the piece and that the button says when it\'s ready; Cancel stops waiting, not the Session', async () => {
    const { status, app, latestMessages } = open();
    await writeHandover("the PDF export's date format");
    const dialog = await popover();
    expect(await within(dialog).findByText('Writing the Handover…')).toBeInTheDocument();
    expect(within(dialog).getByText(/The piece: the PDF export's date format\. This button says when it's ready\./)).toBeInTheDocument();
    status('busy');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Hand off' })).toBeNull());
    expect(app.client.stopSession).not.toHaveBeenCalled();
    status('idle');
    await act(async () => {});
    expect(latestMessages).not.toHaveBeenCalled();
    expect(noLauncher()).toBeNull();
    expect(button()).not.toHaveAttribute('data-wait');
  });

  it('HAND-2.2: closing the popover keeps the wait: the button shows it, another Session selected and back keeps it, and opening it shows "Writing the Handover…"', async () => {
    const { status } = open();
    const u = await writeHandover();
    status('busy');
    await u.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Hand off' })).toBeNull());
    expect(button()).toHaveAttribute('data-wait', 'writing');
    expect(button().querySelector('[data-slot="wait-dot"]')).toHaveClass('bg-busy');
    await u.click(screen.getByText('Other work', { selector: '[data-field="title"]' }));
    await u.click(screen.getByText('Add CSV export to reports', { selector: '[data-field="title"]' }));
    expect(button()).toHaveAttribute('data-wait', 'writing');
    await u.click(button());
    expect(await within(await popover()).findByText('Writing the Handover…')).toBeInTheDocument();
  });

  it('HAND-2.3: Busy, then Idle again: the Handover between its markers is ready, the popover closes, and the launcher opens only when asked', async () => {
    const { status, latestMessages } = open();
    await writeHandover();
    status('busy');
    expect(latestMessages).not.toHaveBeenCalled();
    status('idle');
    await waitFor(() => expect(button()).toHaveAttribute('data-wait', 'ready'));
    expect(screen.queryByRole('dialog', { name: 'Hand off' })).toBeNull();
    expect(noLauncher()).toBeNull();
    const dialog = await openReady();
    expect(within(dialog).getByRole('textbox', { name: 'Prompt' })).toHaveValue(handoffPrompt(HANDOVER, { sessionId: OLD, title: 'Add CSV export to reports' }));
    expect(latestMessages).toHaveBeenCalledWith(OLD);
  });

  it("HAND-2.3: a reply that isn't in the chat yet when the Session is Idle again is read again, and taken once it shows (the Transcript can lag the Status)", async () => {
    const t = open();
    t.latestMessages.mockImplementationOnce(async () => ({ entries: [user(handoffRequest(''))], before: null }));
    await writeHandover();
    t.status('busy');
    t.status('idle');
    await waitFor(() => expect(t.latestMessages).toHaveBeenCalledTimes(1));
    expect(within(await popover()).queryByRole('alert')).toBeNull();
    const dialog = await openReady(4000);
    expect(within(dialog).getByRole('textbox', { name: 'Prompt' })).toHaveValue(handoffPrompt(HANDOVER, { sessionId: OLD, title: 'Add CSV export to reports' }));
    expect(t.latestMessages).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("HAND-2.3: an update on the way isn't the Handover: with no Busy seen, a reply that isn't the Turn's answer is read again until it is", async () => {
    let answered = false;
    const t = open();
    t.latestMessages.mockImplementation(async () => ({ entries: [user(handoffRequest('')), update('Reading the diff first.', 'g1.2'), ...(answered ? [said(reply, 'g1.3')] : [])], before: null }));
    await writeHandover();
    await waitFor(() => expect(t.latestMessages).toHaveBeenCalled(), { timeout: 3000 });
    expect(noLauncher()).toBeNull();
    answered = true;
    const dialog = await openReady(4000);
    expect(within(dialog).getByRole('textbox', { name: 'Prompt' })).toHaveValue(handoffPrompt(HANDOVER, { sessionId: OLD, title: 'Add CSV export to reports' }));
  }, 10_000);

  it("HAND-2.3: the same request asked again moments after a Cancel isn't answered by the first one's Handover while the chat lags", async () => {
    let second = false;
    const t = open();
    const req = handoffRequest('');
    t.latestMessages.mockImplementation(async () => ({
      entries: [user(req, 'g1.1'), said("<handover>\nThe first Turn's Handover.\n</handover>", 'g1.2'), ...(second ? [user(req, 'g1.3'), said(reply, 'g1.4')] : [])],
      before: null,
    }));
    const u = await writeHandover();
    await u.click(within(await popover()).getByRole('button', { name: 'Cancel' }));
    await u.click(button());
    await u.click(within(await popover()).getByRole('button', { name: /Write Handover/ }));
    expect(t.sendMessage).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(t.latestMessages).toHaveBeenCalled(), { timeout: 3000 });
    expect(noLauncher()).toBeNull();
    second = true;
    const dialog = await openReady(4000);
    expect(within(dialog).getByRole('textbox', { name: 'Prompt' })).toHaveValue(handoffPrompt(HANDOVER, { sessionId: OLD, title: 'Add CSV export to reports' }));
  }, 10_000);

  it("HAND-2.3: an Idle before any Busy reads the chat from 2 s after the send, and waits while the reply isn't there; a whole Turn between two lists is found; a reply without markers is taken whole", async () => {
    let turn = false;
    const t = open({}, {}, (request) => [user(request), said('Fix the dates.\nStart with a test.')]);
    t.latestMessages.mockImplementation(async () => ({ entries: turn ? [user(handoffRequest('')), said('Fix the dates.\nStart with a test.')] : [user(handoffRequest(''))], before: null }));
    await writeHandover();
    expect(t.latestMessages).not.toHaveBeenCalled();
    await waitFor(() => expect(t.latestMessages).toHaveBeenCalled(), { timeout: 3000 });
    expect(noLauncher()).toBeNull();
    // The Session ran its Turn between two lists: no Busy was seen, and the reply is in the chat.
    turn = true;
    const dialog = await openReady(4000);
    expect(within(dialog).getByRole('textbox', { name: 'Prompt' })).toHaveValue(handoffPrompt('Fix the dates.\nStart with a test.', { sessionId: OLD, title: 'Add CSV export to reports' }));
  }, 10_000);

  it('HAND-2.3: a Handover ready while another Session is selected waits on the button; selecting the Session again opens nothing, a press does', async () => {
    const { status, app } = open();
    const u = await writeHandover();
    status('busy');
    await u.keyboard('{Escape}');
    await u.click(screen.getByText('Other work', { selector: '[data-field="title"]' }));
    status('idle');
    await waitFor(() => expect(app.client.latestMessages).toHaveBeenCalled());
    expect(noLauncher()).toBeNull();
    await u.click(screen.getByText('Add CSV export to reports', { selector: '[data-field="title"]' }));
    await waitFor(() => expect(button()).toHaveAttribute('data-wait', 'ready'));
    expect(noLauncher()).toBeNull();
    await u.click(button());
    expect(await launcher()).toBeInTheDocument();
  });

  it.each([
    ['Needs you before replying', (t: ReturnType<typeof open>) => t.status('needs-you'), HANDOFF_NEEDS_YOU],
    ['ends before replying', (t: ReturnType<typeof open>) => t.app.emit({ type: 'sessions', upsert: [], remove: [OLD] }), HANDOFF_ENDED],
  ])('HAND-2.4: a Session that %s fails the wait, with why; the button shows it while the popover is closed', async (_what, happen, reason) => {
    const t = open();
    const u = await writeHandover();
    t.status('busy');
    await u.keyboard('{Escape}');
    happen(t);
    await waitFor(() => expect(button()).toHaveAttribute('data-wait', 'failed'));
    expect(button().querySelector('[data-slot="wait-dot"]')).toHaveClass('bg-destructive');
    expect(button()).toHaveAttribute('title', `Writing the Handover failed: ${reason}`);
    // An ended Session keeps its button while the wait shows (HAND-1.1), but can't be asked again.
    const ended = reason === HANDOFF_ENDED;
    if (!ended) t.status('idle');
    await u.click(button());
    const dialog = await popover();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(reason);
    const again = within(dialog).getByRole('button', { name: /Try again/ });
    if (ended) {
      expect(again).toBeDisabled();
      expect(again).toHaveAttribute('title', HAND_OFF_ENDED);
      await u.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Hand off…' })).toBeNull());
      expect(t.sendMessage).toHaveBeenCalledTimes(1);
      return;
    }
    await u.click(again);
    expect(t.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('HAND-2.4: a reply with no text fails the wait, with why, and "Try again"', async () => {
    const { status } = open({}, {}, (request) => [user(request), said('<handover>\n</handover>')]);
    await writeHandover();
    status('busy');
    status('idle');
    const dialog = await popover();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(HANDOFF_NO_TEXT);
    expect(within(dialog).getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });

  it('HAND-2.4: a Turn that ends without any text: its chat is read again, five reads in all, before the wait fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const t = open({}, {}, (request) => [user(request), { kind: 'tool_call', cursor: 'g1.3', ts: null, id: 't1', tool: 'Read', summary: 'a.ts' }]);
      await writeHandover();
      t.status('busy');
      t.status('idle');
      await waitFor(() => expect(t.latestMessages).toHaveBeenCalledTimes(1));
      for (let read = 2; read <= HANDOFF_READS; read++) {
        await act(() => vi.advanceTimersByTimeAsync(HANDOFF_READ_MS));
        await waitFor(() => expect(t.latestMessages).toHaveBeenCalledTimes(read));
      }
      const dialog = await popover();
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(HANDOFF_NO_TEXT);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('HAND-3: the new Session', () => {
  const topic = (n: number, members: Topic['members'], over: Partial<Topic> = {}): Topic => ({ id: `t${n}`, title: `Topic ${n}`, notes: '', state: 'open', createdAt: NOW - 1e6, updatedAt: NOW - n * 1000, members, outputs: { items: [], total: 0 }, pos: null, summary: null, summaryStale: false, ...NO_ACTIVITY, ...over });
  const member = (harness: 'claude' | 'codex' = 'claude'): Topic['members'][number] => ({ kind: 'session', ref: { harness, sessionId: OLD }, snapshot: { harness, title: 'Add CSV export to reports', directory: WORKTREE }, key: memberKey('session', { harness, sessionId: OLD }), addedAt: NOW, reason: '' });

  it("HAND-3.1, HAND-3.4: the launcher opens pre-filled with the old Session's directory first, as \"<path> · from <title>\", its Harness, model and Effort, its one Open Topic, no name and Skip permissions as last had; nothing starts until Start", async () => {
    const { status, app } = open({}, { topics: [topic(1, [member()]), topic(2, [member()], { state: 'archived' })] });
    app.snapshot([oldRow(), row({ id: 'other', title: 'Other work' })], { state: 'ok' }, settings({ lastLaunch: { harness: 'codex', model: '', directory: '~/Projects/work', byHarness: { claude: { effort: 'low', skipPermissions: false } } } }));
    await writeHandover();
    status('busy');
    status('idle');
    const dialog = await openReady();
    const directory = within(dialog).getByRole('combobox', { name: 'Directory' });
    expect(directory).toHaveValue(WORKTREE);
    expect(within(directory).getAllByRole('option').map((o) => o.textContent)).toEqual([`${WORKTREE} · from Add CSV export to reports`, '~/Projects/work']);
    expect(within(dialog).getByRole('radio', { name: /Claude Code/ })).toBeChecked();
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Model' })).toHaveValue('claude-opus-5-5'));
    expect(within(dialog).getByRole('combobox', { name: 'Effort' })).toHaveValue('xhigh');
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('');
    expect(within(dialog).getByRole('combobox', { name: 'Topic' })).toHaveValue('t1');
    expect(within(dialog).getByRole('checkbox', { name: 'Skip permissions' })).not.toBeChecked();
    expect(app.client.launch).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: /Start/ }));
    await waitFor(() => expect(app.client.launch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(app.client.launch).mock.calls[0]![0]).toEqual({
      directory: WORKTREE,
      harness: 'claude',
      model: 'claude-opus-5-5',
      name: '',
      prompt: handoffPrompt(HANDOVER, { sessionId: OLD, title: 'Add CSV export to reports' }),
      effort: 'xhigh',
      skipPermissions: false,
      topic: { id: 't1', via: 'topic' },
      continues: { sessionId: OLD, harness: 'claude', title: 'Add CSV export to reports', piece: '' },
    });
  });

  it('HAND-3.1: a Codex Session hands off to Codex, in no Topic when it is in two Open Topics', async () => {
    const { status, app } = open({ harness: 'codex', model: 'gpt-6-astra', effort: 'high' }, { topics: [topic(1, [member('codex')]), topic(2, [member('codex')])] });
    await writeHandover();
    status('busy');
    status('idle');
    const dialog = await openReady();
    expect(within(dialog).getByRole('radio', { name: /Codex/ })).toBeChecked();
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Model' })).toHaveValue('gpt-6-astra'));
    expect(within(dialog).getByRole('combobox', { name: 'Effort' })).toHaveValue('high');
    expect(within(dialog).getByRole('combobox', { name: 'Topic' })).toHaveValue('');
    await userEvent.click(within(dialog).getByRole('button', { name: /Start/ }));
    await waitFor(() => expect(app.client.launch).toHaveBeenCalledWith(expect.objectContaining({ harness: 'codex', continues: { sessionId: OLD, harness: 'codex', title: 'Add CSV export to reports', piece: '' } }), expect.any(String)));
  });

  it('TOPIC-15.1 (support): a Handover of a piece starts with that piece in `continues`, so the Topic that keeps it knows', async () => {
    const { status, app } = open({}, { topics: [topic(1, [member()])] });
    await writeHandover("the PDF export's date format");
    status('busy');
    status('idle');
    const dialog = await openReady();
    await userEvent.click(within(dialog).getByRole('button', { name: /Start/ }));
    await waitFor(() => expect(app.client.launch).toHaveBeenCalledWith(expect.objectContaining({ topic: { id: 't1', via: 'topic' }, continues: expect.objectContaining({ piece: "the PDF export's date format" }) }), expect.any(String)));
  });

  it('HAND-3.2: the prompt is the Handover, then `Continued from: <session id> <title>` on its own line, then the restate line', () => {
    expect(handoffPrompt('  Do the thing.  \n', { sessionId: OLD, title: 'Add CSV\nexport' })).toBe(`Do the thing.\n\nContinued from: ${OLD} Add CSV export\n${RESTATE_LINE}`);
    expect(RESTATE_LINE).toBe("In your first reply, before you change anything, say what the work is, where it stands and what you'll do first; then carry on.");
  });
});

describe('HAND-4: linked both ways', () => {
  it('HAND-4.1: the new Session\'s header shows "from <old title>", named "Continued from <old title>", which opens the old Session live', async () => {
    const app = renderApp(`/s/${NEW}`);
    app.snapshot([oldRow(), row({ id: NEW, title: 'Fix date format in PDF export', continuedFrom: { sessionId: OLD, harness: 'claude', title: 'An old title', at: NOW } })]);
    const link = screen.getByRole('button', { name: 'Continued from Add CSV export to reports' });
    expect(link).toHaveTextContent('from Add CSV export to reports');
    await userEvent.click(link);
    expect(window.location.pathname).toBe(`/s/${OLD}`);
  });

  it('HAND-4.1: an old Session that ended opens read-only, by its title as last seen', async () => {
    const app = renderApp(`/s/${NEW}`, { pastSession: vi.fn(async () => { throw new Error('not read in this test'); }) });
    app.snapshot([row({ id: NEW, harness: 'codex', continuedFrom: { sessionId: OLD, harness: 'claude', title: 'An old title', at: NOW } })]);
    await userEvent.click(screen.getByRole('button', { name: 'Continued from An old title' }));
    expect(window.location.pathname).toBe(`/h/claude/${OLD}`);
  });

  it('HAND-4.2: the old Session\'s header shows "Continued in <new title>", which opens it; with more than one, "Continued in N Sessions", a menu newest first with each one\'s Status', async () => {
    const app = renderApp(`/s/${OLD}`);
    app.snapshot([oldRow({ continuedIn: [{ sessionId: NEW, harness: 'claude', title: null, at: NOW }] }), row({ id: NEW, title: 'Fix date format in PDF export', status: 'busy' })]);
    await userEvent.click(screen.getByRole('button', { name: 'Continued in Fix date format in PDF export' }));
    expect(window.location.pathname).toBe(`/s/${NEW}`);

    app.unmount();
    const two = renderApp(`/s/${OLD}`);
    two.snapshot([
      oldRow({ continuedIn: [{ sessionId: THIRD, harness: 'codex', title: 'Add the totals row', at: NOW }, { sessionId: NEW, harness: 'claude', title: 'PDF dates', at: NOW - 1000 }] }),
      row({ id: NEW, title: 'Fix date format in PDF export', status: 'busy' }),
    ]);
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Continued in 2 Sessions' }));
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Add the totals rowEnded', 'Fix date format in PDF exportBusy']);
    expect(items.map((i) => i.querySelector('[data-session-marker]')?.getAttribute('data-state'))).toEqual(['past', 'live']);
    await u.click(items[1]!);
    expect(window.location.pathname).toBe(`/s/${NEW}`);
  });
});

describe('HAND-4 (support): a past Session', () => {
  it("HAND-4.1, HAND-4.2: a past Session's view shows its links from the record when History opens it", async () => {
    const detail = {
      item: { sessionId: NEW, harness: 'claude' as const, headless: null, title: 'Fix date format in PDF export', projectPath: null, repo: null, branch: null, lastActiveAt: null, snippet: null, firstPrompt: null, projectDisplay: null, blocked: null },
      entries: [],
      source: 'transcript' as const,
      preview: 'latest' as const,
      totalMessages: 0,
      continuedFrom: { sessionId: OLD, harness: 'claude' as const, title: 'Add CSV export to reports', at: NOW },
      continuedIn: [{ sessionId: THIRD, harness: 'codex' as const, title: 'Add the totals row', at: NOW }],
    };
    const app = renderApp(`/h/claude/${NEW}`, { pastSession: vi.fn(async () => detail) });
    app.snapshot([oldRow()]);
    await userEvent.click(await screen.findByRole('button', { name: 'Continued from Add CSV export to reports' }));
    expect(window.location.pathname).toBe(`/s/${OLD}`);
  });
});

describe('HAND-2.3 (support): reading the reply', () => {
  it('the Handover is the text between its marker lines, else the whole reply', () => {
    expect(handoverFrom('Sure.\n<handover>\n  Fix it.\n</handover>\nDone.')).toBe('Fix it.');
    expect(handoverFrom('Fix it.\nThen test.')).toBe('Fix it.\nThen test.');
    expect(handoverFrom('<handover>\nno end')).toBe('<handover>\nno end');
  });

  it('the reply is the text after the last request: its marked text, else the Turn\'s last', () => {
    const req = handoffRequest('');
    expect(replyAfter([said('old'), user(req, 'g1.1'), said('Looking.', 'g1.2'), said(reply, 'g1.3'), said('Anything else?', 'g1.4')], req)).toEqual({ asked: true, reply, done: true });
    expect(replyAfter([user(req), said('Looking.', 'g1.2'), said('All done.', 'g1.3')], req)).toEqual({ asked: true, reply: 'All done.', done: true });
    expect(replyAfter([user(req)], req)).toEqual({ asked: true, reply: null, done: false });
    expect(replyAfter([user('something else')], req)).toEqual({ asked: false, reply: null, done: false });
    // A request from before this send (Try again's earlier one, the same words) isn't this one.
    const at = (ms: number) => new Date(ms).toISOString();
    expect(replyAfter([{ ...user(req), ts: at(NOW - 60_000) }, said('old Handover', 'g1.2')], req, NOW)).toEqual({ asked: false, reply: null, done: false });
    expect(replyAfter([{ ...user(req), ts: at(NOW + 500) }, said('new', 'g1.2')], req, NOW)).toEqual({ asked: true, reply: 'new', done: true });
    // A Harness that keeps the prompt's lines differently still matches by its first line.
    expect(replyAfter([user(req.replace(/\n/g, '\n\n')), said('x', 'g1.2')], req)).toEqual({ asked: true, reply: 'x', done: true });
  });

  it("the reply is the request's own Turn's, up to the next prompt or command; it's done once it has both markers, is final, or a later prompt closed the Turn", () => {
    const req = handoffRequest('');
    // An update on the way isn't the answer yet.
    expect(replyAfter([user(req), update('Reading the diff first.')], req)).toEqual({ asked: true, reply: 'Reading the diff first.', done: false });
    // A later Turn's answer isn't this one's.
    expect(replyAfter([user(req), update('Looking.', 'g1.2'), user('And the tests?', 'g1.3'), said('They pass.', 'g1.4')], req)).toEqual({ asked: true, reply: 'Looking.', done: true });
    expect(replyAfter([user(req), { kind: 'command', cursor: 'g1.2', ts: null, text: '/compact' }, said('Compacted.', 'g1.3')], req)).toEqual({ asked: true, reply: null, done: true });
    // A prompt queued behind the Turn doesn't end it.
    expect(replyAfter([user(req), update('Looking.', 'g1.2'), { kind: 'user', cursor: 'q1', ts: null, text: 'Next thing', queued: true }], req)).toEqual({ asked: true, reply: 'Looking.', done: false });
    // The same request sent from the page moments before: this one shows only once there's one more.
    const first = said('<handover>\nThe first Turn\'s.\n</handover>', 'g1.2');
    expect(replyAfter([user(req, 'g1.1'), first], req, undefined, 1)).toEqual({ asked: false, reply: null, done: false });
    expect(replyAfter([user(req, 'g1.1'), first, user(req, 'g1.3')], req, undefined, 1)).toEqual({ asked: true, reply: null, done: false });
    expect(replyAfter([user(req, 'g1.1'), first, user(req, 'g1.3'), said(reply, 'g1.4')], req, undefined, 1)).toEqual({ asked: true, reply, done: true });
    // Both markers are the Handover, final or not.
    expect(replyAfter([user(req), update(reply, 'g1.2')], req)).toEqual({ asked: true, reply, done: true });
    expect(replyAfter([user(req), update('<handover>\nno end yet', 'g1.2')], req)).toEqual({ asked: true, reply: '<handover>\nno end yet', done: false });
  });

  it('after a read: a done reply is the Handover; once the Turn has ended, a reply not done is read again, up to five reads, the last taking what there is', () => {
    const at = NOW + 5000;
    const w: WritingWait = { state: 'writing', piece: '', request: 'r', sentAt: NOW, skip: 0, busy: false, reads: 0, readAfter: NOW + HANDOFF_READ_MS };
    expect(afterRead(w, { asked: true, reply, done: true }, at)).toEqual({ state: 'ready', piece: '', handover: HANDOVER, at });
    expect(afterRead(w, { asked: true, reply: '<handover>\n</handover>', done: true }, at)).toEqual({ state: 'failed', piece: '', reason: HANDOFF_NO_TEXT });
    // No Busy seen and the request not in the chat (or the read failed): the Turn hasn't begun; read again, uncounted.
    expect(afterRead(w, { asked: false, reply: null, done: false }, at)).toEqual({ ...w, readAfter: at + HANDOFF_READ_MS });
    expect(afterRead(w, null, at)).toEqual({ ...w, readAfter: at + HANDOFF_READ_MS });
    // The request shows with the Session Idle, or a Busy was seen: the Turn has ended, and reads count.
    const going = { asked: true, reply: 'Looking.', done: false };
    expect(afterRead(w, going, at)).toEqual({ ...w, reads: 1, readAfter: at + HANDOFF_READ_MS });
    const busy = { ...w, busy: true };
    expect(afterRead(busy, { asked: false, reply: null, done: false }, at)).toEqual({ ...busy, reads: 1, readAfter: at + HANDOFF_READ_MS });
    const last = { ...w, busy: true, reads: HANDOFF_READS - 1 };
    expect(afterRead(last, going, at)).toEqual({ state: 'ready', piece: '', handover: 'Looking.', at });
    expect(afterRead(last, { asked: true, reply: null, done: false }, at)).toEqual({ state: 'failed', piece: '', reason: HANDOFF_NO_TEXT });
    expect(afterRead(last, { asked: false, reply: null, done: false }, at)).toEqual({ state: 'failed', piece: '', reason: HANDOFF_NOT_FOUND });
  });
});

describe('HAND-6: a ready Handover waits for you', () => {
  const topic = (n: number): Topic => ({ id: `t${n}`, title: `Topic ${n}`, notes: '', state: 'open', createdAt: NOW - 1e6, updatedAt: NOW - n * 1000, members: [], outputs: { items: [], total: 0 }, pos: null, summary: null, summaryStale: false, ...NO_ACTIVITY });
  const PROMPT = handoffPrompt(HANDOVER, { sessionId: OLD, title: 'Add CSV export to reports' });
  /** The old Session's Handover, written and ready. */
  async function ready(options: Parameters<typeof renderApp>[1] = {}) {
    const t = open({}, options);
    await writeHandover();
    t.status('busy');
    t.status('idle');
    await waitFor(() => expect(button()).toHaveAttribute('data-wait', 'ready'));
    return t;
  }

  it('HAND-6.1: a ready Handover never opens the launcher by itself; the button says "Handover ready (F)", and F opens it', async () => {
    await ready();
    await act(async () => {});
    expect(noLauncher()).toBeNull();
    expect(button()).toHaveAttribute('title', 'Handover ready (F)');
    expect(button().querySelector('[data-slot="wait-dot"]')).toHaveClass('bg-ok');
    await userEvent.keyboard('f');
    const dialog = await launcher();
    expect(within(dialog).getByRole('textbox', { name: 'Prompt' })).toHaveValue(PROMPT);
  });

  it('HAND-6.2: closing the launcher keeps the Handover with your edits; N opens its own draft; Discard drops it', async () => {
    const t = await ready();
    const u = userEvent.setup();
    await u.click(button());
    let dialog = await launcher();
    expect(within(dialog).getByText(/your Handover is kept/)).toBeInTheDocument();
    const prompt = within(dialog).getByRole('textbox', { name: 'Prompt' });
    await u.clear(prompt);
    await u.type(prompt, 'Edited Handover.');
    await u.keyboard('{Escape}');
    await waitFor(() => expect(noLauncher()).toBeNull());
    expect(button()).toHaveAttribute('data-wait', 'ready');
    // N: the launcher's own draft, and the Handover stays ready.
    await u.keyboard('n');
    const own = await screen.findByRole('dialog', { name: 'New Session' });
    expect(within(own).getByRole('textbox', { name: 'Prompt' })).toHaveValue('');
    await u.keyboard('{Escape}');
    await waitFor(() => expect(noLauncher()).toBeNull());
    // Again: the fields as you left them.
    await u.click(button());
    dialog = await launcher();
    expect(within(dialog).getByRole('textbox', { name: 'Prompt' })).toHaveValue('Edited Handover.');
    await u.click(within(dialog).getByRole('button', { name: 'Discard Handover' }));
    await waitFor(() => expect(noLauncher()).toBeNull());
    expect(button()).not.toHaveAttribute('data-wait');
    expect(t.app.client.launch).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEPT_HANDOVER_PREFIX + OLD)).toBeNull();
  });

  it('HAND-6.2: a start uses the Handover up only once it completes; one that fails leaves it ready, with its fields', async () => {
    const t = await ready();
    const u = userEvent.setup();
    const startFrom = async () => {
      await u.click(screen.getByText('Add CSV export to reports', { selector: '[data-field="title"]' }));
      await u.click(button());
      const dialog = await launcher();
      await u.click(within(dialog).getByRole('button', { name: /Start/ }));
      await waitFor(() => expect(noLauncher()).toBeNull());
      return vi.mocked(t.app.client.launch).mock.calls.at(-1)![1] as string;
    };
    const first = await startFrom();
    // Under way, then failed: still ready, as it was.
    t.app.emit({ type: 'launches', launches: [launchView({ id: first, state: 'starting' })], started: [] });
    t.app.emit({ type: 'launches', launches: [launchView({ id: first, state: 'failed', error: "Fleet hasn't reported it after 15 s." })], started: [] });
    await act(async () => {});
    expect(field(OLD, 'handover-ready')).not.toBeNull();
    expect(window.localStorage.getItem(KEPT_HANDOVER_PREFIX + OLD)).not.toBeNull();
    // Again, and it completes: used up.
    const second = await startFrom();
    expect(vi.mocked(t.app.client.launch).mock.calls[1]![0].prompt).toBe(PROMPT);
    t.app.emit({ type: 'launches', launches: [launchView({ id: second, state: 'starting' })], started: [] });
    expect(field(OLD, 'handover-ready')).not.toBeNull();
    t.app.emit({ type: 'launches', launches: [], started: [{ launchId: second, sessionId: NEW }] });
    await waitFor(() => expect(field(OLD, 'handover-ready')).toBeNull());
    expect(window.localStorage.getItem(KEPT_HANDOVER_PREFIX + OLD)).toBeNull();
  });

  it('HAND-6.3: the row shows a ready Handover: the Hand off icon in ok, 12 px, after the Unread dot and before the Harness mark, "Handover ready" in its name; it goes with the Handover', async () => {
    await ready();
    const mark = field(OLD, 'handover-ready')!;
    expect(mark).toHaveAttribute('title', 'Handover ready');
    expect(mark.querySelector('[data-action-icon="hand-off"]')).toHaveClass('size-3', 'text-ok');
    expect(mark.nextElementSibling).toBe(field(OLD, 'harness'));
    expect(mark.parentElement).toHaveClass('gap-1.5'); // SIDE-15.4: the line's end icons, 6 px apart
    expect(rowEl(OLD)).toHaveAccessibleName(/Add CSV export to reports.*Handover ready.*Claude Code/);
    expect(field('other', 'handover-ready')).toBeNull();
    await userEvent.click(button());
    await userEvent.click(within(await launcher()).getByRole('button', { name: 'Discard Handover' }));
    await waitFor(() => expect(field(OLD, 'handover-ready')).toBeNull());
  });

  it('HAND-6.4: a ready Handover, with its launcher fields, outlives a reload; one whose Session is gone from the list goes from storage', async () => {
    const t = await ready();
    const u = userEvent.setup();
    await u.click(button());
    const prompt = within(await launcher()).getByRole('textbox', { name: 'Prompt' });
    await u.type(prompt, ' Kept.');
    await u.keyboard('{Escape}');
    await waitFor(() => expect(noLauncher()).toBeNull());
    expect(JSON.parse(window.localStorage.getItem(KEPT_HANDOVER_PREFIX + OLD)!)).toMatchObject({ v: 1, handover: HANDOVER, piece: '', draft: { prompt: `${PROMPT} Kept.` } });
    // Reloaded: ready again, its fields as left.
    t.app.unmount();
    const again = open();
    expect(button()).toHaveAttribute('data-wait', 'ready');
    expect(field(OLD, 'handover-ready')).not.toBeNull();
    await u.click(button());
    expect(within(await launcher()).getByRole('textbox', { name: 'Prompt' })).toHaveValue(`${PROMPT} Kept.`);
    await u.keyboard('{Escape}');
    await waitFor(() => expect(noLauncher()).toBeNull());
    // Reloaded with the Session gone: dropped once the list is known.
    again.app.unmount();
    const app = renderApp('/');
    app.snapshot([row({ id: 'other', title: 'Other work' })]);
    await waitFor(() => expect(window.localStorage.getItem(KEPT_HANDOVER_PREFIX + OLD)).toBeNull());
    // Storage that can't be read keeps nothing, and breaks nothing.
    app.unmount();
    window.localStorage.setItem(KEPT_HANDOVER_PREFIX + OLD, '{not json');
    open();
    expect(button()).not.toHaveAttribute('data-wait');
  });

  it('HAND-6.4: tabs share what\'s kept: another tab\'s Handover shows here, its discard goes from here, and this tab never writes over another Session\'s', async () => {
    const other = { v: 1, piece: '', handover: 'Ship the other work.', at: NOW };
    const fromTab = (key: string, value: string | null) =>
      act(() => {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
        window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
      });
    const t = open();
    fromTab(KEPT_HANDOVER_PREFIX + 'other', JSON.stringify(other));
    expect(field('other', 'handover-ready')).not.toBeNull();
    // This tab's own Handover is kept beside it, and the other is left as it was.
    await writeHandover();
    t.status('busy');
    t.status('idle');
    await waitFor(() => expect(button()).toHaveAttribute('data-wait', 'ready'));
    expect(JSON.parse(window.localStorage.getItem(KEPT_HANDOVER_PREFIX + 'other')!)).toEqual(other);
    expect(window.localStorage.getItem(KEPT_HANDOVER_PREFIX + OLD)).not.toBeNull();
    // Discarded in the other tab: gone here too.
    fromTab(KEPT_HANDOVER_PREFIX + OLD, null);
    expect(button()).not.toHaveAttribute('data-wait');
    expect(field(OLD, 'handover-ready')).toBeNull();
    // A key that isn't a Handover's changes nothing.
    fromTab('lookout.layout', '{}');
    expect(field('other', 'handover-ready')).not.toBeNull();
  });

  it('HAND-6.4: a late storage event can\'t bring back a Handover discarded since, and a Handover from another tab isn\'t written back', async () => {
    await ready();
    const key = KEPT_HANDOVER_PREFIX + OLD;
    const stale = window.localStorage.getItem(key)!;
    // Discarded here; then another tab's earlier change arrives.
    await userEvent.click(button());
    await userEvent.click(within(await launcher()).getByRole('button', { name: 'Discard Handover' }));
    await waitFor(() => expect(noLauncher()).toBeNull());
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key, newValue: stale })));
    expect(button()).not.toHaveAttribute('data-wait');
    expect(window.localStorage.getItem(key)).toBeNull();
    // Another tab keeps one: it shows here, and this tab doesn't write it again.
    window.localStorage.setItem(key, stale);
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key, newValue: stale })));
    await waitFor(() => expect(button()).toHaveAttribute('data-wait', 'ready'));
    await act(async () => {});
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
  });

  it('HAND-6.2: an earlier start that completes uses up only its own Handover, and closes a launcher showing it', async () => {
    const t = await ready();
    const u = userEvent.setup();
    const select = () => u.click(screen.getByText('Add CSV export to reports', { selector: '[data-field="title"]' }));
    await u.click(button());
    await u.click(within(await launcher()).getByRole('button', { name: /Start/ }));
    await waitFor(() => expect(noLauncher()).toBeNull());
    const first = vi.mocked(t.app.client.launch).mock.calls[0]![1] as string;
    t.app.emit({ type: 'launches', launches: [launchView({ id: first, state: 'trust' })], started: [] });
    // Still ready while it waits at its Trust prompt; opened again, the launcher closes once that start completes.
    await select();
    await u.click(button());
    await launcher();
    t.app.emit({ type: 'launches', launches: [], started: [{ launchId: first, sessionId: NEW }] });
    await waitFor(() => expect(noLauncher()).toBeNull());
    expect(field(OLD, 'handover-ready')).toBeNull();
    // A second start waits; meanwhile that Handover is discarded and a newer one written.
    const req = handoffRequest('');
    t.latestMessages.mockImplementation(async () => ({ entries: [user(req, 'g1.1'), said(reply, 'g1.2'), user(req, 'g1.3'), said(reply, 'g1.4')], before: null }));
    await select();
    await writeHandover();
    t.status('busy');
    t.status('idle');
    await u.click(within(await openReady()).getByRole('button', { name: /Start/ }));
    await waitFor(() => expect(noLauncher()).toBeNull());
    const second = vi.mocked(t.app.client.launch).mock.calls[1]![1] as string;
    t.app.emit({ type: 'launches', launches: [launchView({ id: second, state: 'trust' })], started: [] });
    await select();
    await u.click(button());
    await u.click(within(await launcher()).getByRole('button', { name: 'Discard Handover' }));
    await waitFor(() => expect(noLauncher()).toBeNull());
    t.latestMessages.mockImplementation(async () => ({ entries: [user(req, 'g1.1'), said(reply, 'g1.2'), user(req, 'g1.3'), said(reply, 'g1.4'), user(req, 'g1.5'), said(reply, 'g1.6')], before: null }));
    await writeHandover();
    t.status('busy');
    t.status('idle');
    await waitFor(() => expect(button()).toHaveAttribute('data-wait', 'ready'));
    // The second start completes: the newer Handover stays.
    t.app.emit({ type: 'launches', launches: [], started: [{ launchId: second, sessionId: THIRD }] });
    await act(async () => {});
    expect(button()).toHaveAttribute('data-wait', 'ready');
    expect(field(OLD, 'handover-ready')).not.toBeNull();
  });

  it('HAND-6.2: a launcher showing a Handover that another tab discards closes', async () => {
    await ready();
    await userEvent.click(button());
    await launcher();
    act(() => {
      window.localStorage.removeItem(KEPT_HANDOVER_PREFIX + OLD);
      window.dispatchEvent(new StorageEvent('storage', { key: KEPT_HANDOVER_PREFIX + OLD, newValue: null }));
    });
    await waitFor(() => expect(noLauncher()).toBeNull());
    expect(screen.getByRole('button', { name: 'Hand off…' })).not.toHaveAttribute('data-wait');
  });

  it('HAND-6.5: the launcher with a Handover is titled, and its form named, "Hand off from <old title>"', async () => {
    await ready();
    await userEvent.click(button());
    const dialog = await launcher();
    expect(within(dialog).getByRole('heading', { name: 'Hand off from Add CSV export to reports' })).toBeInTheDocument();
    expect(within(dialog).getByRole('form', { name: 'Hand off from Add CSV export to reports' })).toBeInTheDocument();
  });

  it('TOPIC-15.7: "Keep in Topic" waits for a Topic, keeps the Handover in it without a start, and uses it up; a refusal stays in the launcher', async () => {
    let refuse = true;
    const keepHandover = vi.fn(async () => {
      if (refuse) throw new SaveError('That Topic no longer exists.', null, 404);
    });
    const t = await ready({ topics: [topic(1)], keepHandover });
    const u = userEvent.setup();
    await u.click(button());
    const dialog = await launcher();
    const keep = within(dialog).getByRole('button', { name: 'Keep in Topic' });
    expect(keep).toBeDisabled();
    expect(keep).toHaveAttribute('title', 'Pick a Topic to keep it in');
    await u.selectOptions(within(dialog).getByRole('combobox', { name: 'Topic' }), 't1');
    expect(keep).toBeEnabled();
    await u.click(keep);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That Topic no longer exists.');
    // The dialog hides the page from a screen reader while it's open.
    expect(screen.getByRole('button', { name: 'Hand off…', hidden: true })).toHaveAttribute('data-wait', 'ready');
    refuse = false;
    await u.click(keep);
    await waitFor(() => expect(noLauncher()).toBeNull());
    expect(keepHandover).toHaveBeenLastCalledWith('t1', { prompt: PROMPT, from: 'Add CSV export to reports', piece: '' });
    expect(button()).not.toHaveAttribute('data-wait');
    expect(t.app.client.launch).not.toHaveBeenCalled();
  });
});
