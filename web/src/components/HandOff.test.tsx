import type { ChatEntry, ChatPage, SessionRow } from '@shared/types.ts';
import { NO_ACTIVITY, type Topic, memberKey } from '@shared/topics.ts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HANDOFF_ENDED, HANDOFF_NEEDS_YOU, HANDOFF_NOT_FOUND, HANDOFF_NO_TEXT, HANDOFF_READS, HANDOFF_READ_MS, RESTATE_LINE, type WritingWait, afterRead, handoffPrompt, handoffRequest, handoverFrom, replyAfter } from '@/lib/handoff';
import { SaveError } from '@/lib/client';
import { NOW, renderApp, row, settings } from '@/test/helpers';
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
const launcher = () => screen.findByRole('dialog', { name: 'New Session' });

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
  it('HAND-2.1: while the Session writes, the popover says so, with the piece and when the launcher opens; Cancel stops waiting, not the Session', async () => {
    const { status, app, latestMessages } = open();
    await writeHandover("the PDF export's date format");
    const dialog = await popover();
    expect(await within(dialog).findByText('Writing the Handover…')).toBeInTheDocument();
    expect(within(dialog).getByText(/The piece: the PDF export's date format\. The launcher opens when the Session is Idle again\./)).toBeInTheDocument();
    status('busy');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Hand off' })).toBeNull());
    expect(app.client.stopSession).not.toHaveBeenCalled();
    status('idle');
    await act(async () => {});
    expect(latestMessages).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'New Session' })).toBeNull();
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

  it('HAND-2.3: Busy, then Idle again: the Handover between its markers opens the launcher, and the popover closes', async () => {
    const { status, latestMessages } = open();
    await writeHandover();
    status('busy');
    expect(latestMessages).not.toHaveBeenCalled();
    status('idle');
    const dialog = await launcher();
    expect(screen.queryByRole('dialog', { name: 'Hand off' })).toBeNull();
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
    const dialog = await screen.findByRole('dialog', { name: 'New Session' }, { timeout: 4000 });
    expect(within(dialog).getByRole('textbox', { name: 'Prompt' })).toHaveValue(handoffPrompt(HANDOVER, { sessionId: OLD, title: 'Add CSV export to reports' }));
    expect(t.latestMessages).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("HAND-2.3: an update on the way isn't the Handover: with no Busy seen, a reply that isn't the Turn's answer is read again until it is", async () => {
    let answered = false;
    const t = open();
    t.latestMessages.mockImplementation(async () => ({ entries: [user(handoffRequest('')), update('Reading the diff first.', 'g1.2'), ...(answered ? [said(reply, 'g1.3')] : [])], before: null }));
    await writeHandover();
    await waitFor(() => expect(t.latestMessages).toHaveBeenCalled(), { timeout: 3000 });
    expect(screen.queryByRole('dialog', { name: 'New Session' })).toBeNull();
    answered = true;
    const dialog = await screen.findByRole('dialog', { name: 'New Session' }, { timeout: 4000 });
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
    expect(screen.queryByRole('dialog', { name: 'New Session' })).toBeNull();
    second = true;
    const dialog = await screen.findByRole('dialog', { name: 'New Session' }, { timeout: 4000 });
    expect(within(dialog).getByRole('textbox', { name: 'Prompt' })).toHaveValue(handoffPrompt(HANDOVER, { sessionId: OLD, title: 'Add CSV export to reports' }));
  }, 10_000);

  it("HAND-2.3: an Idle before any Busy reads the chat from 2 s after the send, and waits while the reply isn't there; a whole Turn between two lists is found; a reply without markers is taken whole", async () => {
    let turn = false;
    const t = open({}, {}, (request) => [user(request), said('Fix the dates.\nStart with a test.')]);
    t.latestMessages.mockImplementation(async () => ({ entries: turn ? [user(handoffRequest('')), said('Fix the dates.\nStart with a test.')] : [user(handoffRequest(''))], before: null }));
    await writeHandover();
    expect(t.latestMessages).not.toHaveBeenCalled();
    await waitFor(() => expect(t.latestMessages).toHaveBeenCalled(), { timeout: 3000 });
    expect(screen.queryByRole('dialog', { name: 'New Session' })).toBeNull();
    // The Session ran its Turn between two lists: no Busy was seen, and the reply is in the chat.
    turn = true;
    const dialog = await screen.findByRole('dialog', { name: 'New Session' }, { timeout: 4000 });
    expect(within(dialog).getByRole('textbox', { name: 'Prompt' })).toHaveValue(handoffPrompt('Fix the dates.\nStart with a test.', { sessionId: OLD, title: 'Add CSV export to reports' }));
  }, 10_000);

  it('HAND-2.3: a Handover ready while another Session is selected waits on the button, and opens the launcher on a press or when that Session is selected again', async () => {
    const { status, app } = open();
    const u = await writeHandover();
    status('busy');
    await u.keyboard('{Escape}');
    await u.click(screen.getByText('Other work', { selector: '[data-field="title"]' }));
    status('idle');
    await act(async () => {});
    await waitFor(() => expect(app.client.latestMessages).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: 'New Session' })).toBeNull();
    await u.click(screen.getByText('Add CSV export to reports', { selector: '[data-field="title"]' }));
    expect(await launcher()).toBeInTheDocument();
  });

  it('HAND-2.3: a ready Handover opens the launcher when its button is pressed', async () => {
    const { status, app } = open();
    const u = await writeHandover();
    status('busy');
    await u.keyboard('{Escape}');
    await u.click(screen.getByText('Other work', { selector: '[data-field="title"]' }));
    status('idle');
    await waitFor(() => expect(app.client.latestMessages).toHaveBeenCalled());
    // Selecting it opens the launcher; closed without a start, the wait is gone with it.
    await u.click(screen.getByText('Add CSV export to reports', { selector: '[data-field="title"]' }));
    await launcher();
    await u.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New Session' })).toBeNull());
    expect(button()).not.toHaveAttribute('data-wait');
    await waitFor(() => expect(button()).toHaveFocus());
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
    const dialog = await launcher();
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
    const dialog = await launcher();
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
    const dialog = await launcher();
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
    expect(afterRead(w, { asked: true, reply, done: true }, at)).toEqual({ state: 'ready', piece: '', handover: HANDOVER });
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
    expect(afterRead(last, going, at)).toEqual({ state: 'ready', piece: '', handover: 'Looking.' });
    expect(afterRead(last, { asked: true, reply: null, done: false }, at)).toEqual({ state: 'failed', piece: '', reason: HANDOFF_NO_TEXT });
    expect(afterRead(last, { asked: false, reply: null, done: false }, at)).toEqual({ state: 'failed', piece: '', reason: HANDOFF_NOT_FOUND });
  });
});
