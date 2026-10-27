import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { StartingView } from './StartingView';
import { launchView, renderApp, row } from '@/test/helpers';
import { SaveError } from '@/lib/client';

const ID = 't1.9f2c01aa';
const lines = ['Accessing workspace:', '/Users/me/new-repo', '', 'This folder pre-approves 10 tool permissions: Bash(…), and 2 more', 'These will apply without asking.', '', 'Security guide'];
const trust = (over = {}) => launchView({ id: 'l-trust', title: 'new-repo', state: 'trust', trust: { id: ID, lines, answerable: true, detail: null, answering: null, message: null, ...over } });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => window.localStorage.clear());

it('LAUNCH-6.3: shows the whole prompt in order, buttons instead of its choices, and Needs you in the view and either row', async () => {
  const app = renderApp('/l/l-trust');
  app.snapshot([row({ id: 'other' })]);
  app.emit({ type: 'launches', launches: [trust()], started: [] });
  const card = screen.getByRole('region', { name: 'Claude Code asks whether you trust this folder' });
  expect(card.querySelector('pre')!.textContent).toBe(lines.join('\n'));
  expect(within(card).getByRole('button', { name: 'Trust folder' })).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  expect(within(card).queryByText('No, exit')).toBeNull();
  expect(within(card).queryByRole('link')).toBeNull();
  const header = screen.getByRole('banner', { name: 'Starting Session' });
  expect(header.querySelector('[data-field="status"]')).toHaveTextContent('Needs you');
  expect(within(header).getByRole('img', { name: 'Needs you' })).toBeInTheDocument();
  const list = screen.getByRole('list', { name: 'Starting Sessions' });
  expect(within(list).getByRole('img', { name: 'Needs you' })).toBeInTheDocument();
  expect(list).toHaveTextContent('Asks to trust the folder');
  await userEvent.setup().click(screen.getByText('other', { selector: '[data-field="title"]' }));
  expect(list).toHaveTextContent('Asks to trust the folder');
  expect(app.client.answerTrust).not.toHaveBeenCalled();
});

it('LAUNCH-6.9: named region, polite single announcement, no autofocus, descriptions and native Tab/Enter/Space; answering keeps focus', async () => {
  const answer = vi.fn();
  const l = trust();
  const { rerender } = render(<StartingView launch={launchView({ id: 'l-trust' })} loaded now={0} onTrust={answer} />);
  const region = screen.getByRole('status');
  expect(region).toHaveTextContent('Waiting for Fleet to report the Session…');
  rerender(<StartingView launch={l} loaded now={0} onTrust={answer} />);
  expect(screen.getByRole('status')).toBe(region); // same mounted region, new text
  expect(region).toHaveTextContent('Claude Code asks whether you trust this folder');
  const yes = screen.getByRole('button', { name: 'Trust folder' });
  const no = screen.getByRole('button', { name: 'Cancel' });
  expect(yes).not.toHaveFocus();
  expect(yes).toHaveAccessibleDescription(/Yes, I trust this folder.*settings pre-approve/);
  expect(no).toHaveAccessibleDescription(/No, exit.*ends the start/);
  const user = userEvent.setup();
  await user.keyboard('{Enter} ');
  expect(answer).not.toHaveBeenCalled();
  await user.tab();
  expect(yes).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(answer).toHaveBeenLastCalledWith('accept', ID);
  rerender(<StartingView launch={trust({ answering: 'accept' })} loaded now={0} onTrust={answer} />);
  expect(screen.getByRole('button', { name: 'Trusting…' })).toHaveFocus();
  for (const b of screen.getAllByRole('button')) { expect(b).toHaveAttribute('aria-disabled', 'true'); expect(b).not.toBeDisabled(); }
  expect(screen.getByRole('status')).toBe(region);
  expect(region).toHaveTextContent('Trusting…');
  await user.keyboard('{Enter} ');
  expect(answer).toHaveBeenCalledTimes(1);
  rerender(<StartingView launch={l} loaded now={0} onTrust={answer} />);
  await user.tab();
  expect(no).toHaveFocus();
  await user.keyboard(' ');
  expect(answer).toHaveBeenLastCalledWith('decline', ID);
  rerender(<StartingView launch={trust({ answering: 'decline' })} loaded now={0} onTrust={answer} />);
  expect(screen.getByRole('status')).toHaveTextContent('Cancelling…');
});

it('LAUNCH-6.4: only a click sends the displayed id, disables both immediately, then shows waiting and lets the Session take over', async () => {
  const pending = deferred<ReturnType<typeof launchView> | null>();
  const app = renderApp('/l/l-trust', { answerTrust: () => pending.promise });
  app.snapshot([]);
  app.emit({ type: 'launches', launches: [trust()], started: [] });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Trust folder' }));
  expect(app.client.answerTrust).toHaveBeenCalledWith('l-trust', { answer: 'accept', prompt: ID });
  expect(screen.getByRole('button', { name: 'Trusting…' })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('aria-disabled', 'true');
  app.emit({ type: 'launches', launches: [launchView({ id: 'l-trust' })], started: [] });
  await act(async () => pending.resolve(launchView({ id: 'l-trust' })));
  expect(screen.getByText('Waiting for Fleet to report the Session…')).toBeInTheDocument();
  app.emit({ type: 'sessions', upsert: [row({ id: 'live' })], remove: [] });
  app.emit({ type: 'launches', launches: [], started: [{ launchId: 'l-trust', sessionId: 'live' }] });
  await waitFor(() => expect(window.location.pathname).toBe('/s/live'));
});

it('LAUNCH-6.4: an HTTP acceptance before SSE shows waiting and never restores the accepted prompt’s buttons', async () => {
  const pending = deferred<ReturnType<typeof launchView> | null>();
  const app = renderApp('/l/l-trust', { answerTrust: () => pending.promise });
  app.snapshot([]);
  app.emit({ type: 'launches', launches: [trust()], started: [] });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Trust folder' }));
  await act(async () => pending.resolve(launchView({ id: 'l-trust' })));
  expect(screen.getByText('Waiting for Fleet to report the Session…')).toBeInTheDocument();
  // Even a buffered read of the same prompt must not restore its buttons.
  app.emit({ type: 'launches', launches: [trust()], started: [] });
  expect(screen.queryByRole('button', { name: 'Trust folder' })).toBeNull();
  app.emit({ type: 'launches', launches: [launchView({ id: 'l-trust' })], started: [] });
  app.emit({ type: 'launches', launches: [trust({ id: 't1.11111111', lines: ['another folder'] })], started: [] });
  expect(screen.getByRole('button', { name: 'Trust folder' })).toBeInTheDocument();
});

it('LAUNCH-6.5: a confirmed Cancel failure shows the returned error and terminal before SSE', async () => {
  const pending = deferred<ReturnType<typeof launchView> | null>();
  const app = renderApp('/l/l-trust', { answerTrust: () => pending.promise });
  app.snapshot([]);
  app.emit({ type: 'launches', launches: [trust()], started: [] });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
  await act(async () => pending.resolve(launchView({ id: 'l-trust', state: 'failed', error: "Cancelled, but its Session host couldn't be closed.", terminal: ['the last lines'] })));
  expect(screen.getByRole('alert')).toHaveTextContent("couldn't be closed");
  expect(screen.getByRole('region', { name: "Its terminal's last lines" })).toHaveTextContent('the last lines');
  expect(screen.queryByRole('button', { name: 'Trust folder' })).toBeNull();
});

it('LAUNCH-6.8: a late HTTP answer never replaces a newer different prompt', async () => {
  const pending = deferred<ReturnType<typeof launchView> | null>();
  const app = renderApp('/l/l-trust', { answerTrust: () => pending.promise });
  app.snapshot([]);
  app.emit({ type: 'launches', launches: [trust()], started: [] });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Trust folder' }));
  app.emit({ type: 'launches', launches: [trust({ id: 't1.11111111', lines: ['another folder'] })], started: [] });
  await act(async () => pending.resolve(launchView({ id: 'l-trust' })));
  expect(screen.getByRole('region', { name: 'Claude Code asks whether you trust this folder' })).toHaveTextContent('another folder');
  expect(screen.getByRole('button', { name: 'Trust folder' })).toBeInTheDocument();
});

it.each([false, true])('LAUNCH-6.5: own Cancel selects the next start and focuses its Dismiss or the main pane (next=%s)', async (next) => {
  const pending = deferred<null>();
  const app = renderApp('/l/l-trust', { answerTrust: () => pending.promise });
  const rest = next ? [launchView({ id: 'l-failed', title: 'failed', state: 'failed' })] : [];
  app.snapshot([]);
  app.emit({ type: 'launches', launches: [trust(), ...rest], started: [] });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'Cancelling…' })).toHaveFocus();
  app.emit({ type: 'launches', launches: rest, started: [] });
  await act(async () => pending.resolve(null));
  await waitFor(() => expect(window.location.pathname).toBe(next ? '/l/l-failed' : '/'));
  expect(next ? screen.getByRole('button', { name: 'Dismiss failed' }) : screen.getByRole('main')).toHaveFocus();
});

it('LAUNCH-6.5: own Cancel removes the row even when its HTTP answer precedes SSE', async () => {
  const app = renderApp('/l/l-trust', { answerTrust: async () => null });
  app.snapshot([]);
  app.emit({ type: 'launches', launches: [trust()], started: [] });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
  expect(window.location.pathname).toBe('/');
  expect(screen.queryByRole('list', { name: 'Starting Sessions' })).toBeNull();
});

it('LAUNCH-6.5: Cancel selects another remaining start when its original neighbor finished during cancellation', async () => {
  const pending = deferred<null>();
  const app = renderApp('/l/l-trust', { answerTrust: () => pending.promise });
  app.snapshot([]);
  const neighbor = launchView({ id: 'neighbor' });
  const last = launchView({ id: 'last', title: 'last', state: 'failed' });
  app.emit({ type: 'launches', launches: [trust(), neighbor, last], started: [] });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
  app.emit({ type: 'launches', launches: [trust(), last], started: [] });
  await act(async () => pending.resolve(null));
  expect(window.location.pathname).toBe('/l/last');
  expect(screen.getByRole('button', { name: 'Dismiss last' })).toHaveFocus();
});

it('LAUNCH-6.10: reload shows buttons without answering; another tab’s Cancel leaves this tab on the unlisted start', () => {
  const app = renderApp('/l/l-trust');
  app.snapshot([]);
  app.emit({ type: 'launches', launches: [trust()], started: [] });
  expect(screen.getByRole('button', { name: 'Trust folder' })).toBeInTheDocument();
  expect(app.client.answerTrust).not.toHaveBeenCalled();
  app.emit({ type: 'launches', launches: [], started: [] });
  expect(screen.getByText('This start is no longer listed')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/l/l-trust');
});

it('LAUNCH-6.7 LAUNCH-6.9: unreadable cards announce the reason once, keep any complete text, and have Dismiss instead of answer buttons', async () => {
  const app = renderApp('/l/l-trust');
  app.snapshot([]);
  const message = "Lookout can't read this version of Claude Code's prompt.";
  app.emit({ type: 'launches', launches: [trust({ id: null, lines: null, answerable: false, message, detail: 'layout_unsupported' })], started: [] });
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(screen.queryByRole('button', { name: 'Trust folder' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Dismiss new-repo' })).toBeInTheDocument();
  app.emit({ type: 'launches', launches: [trust({ answerable: false, message, detail: 'touched' })], started: [] });
  expect(screen.getByRole('region', { name: 'Claude Code asks whether you trust this folder' }).querySelector('pre')).toHaveTextContent('and 2 more');
  app.emit({ type: 'launches', launches: [trust()], started: [] });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'Trust folder' })).toBeInTheDocument();
});

it('LAUNCH-6.6: a lost answer connection permanently removes that prompt’s buttons in this tab, including after navigation', async () => {
  const app = renderApp('/l/l-trust', { answerTrust: async () => { throw new SaveError('connection lost', null, null, { lost: true }); } });
  app.snapshot([row({ id: 'other' })]);
  app.emit({ type: 'launches', launches: [trust()], started: [] });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Trust folder' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("It may have been answered, but Lookout can't tell.");
  app.emit({ type: 'launches', launches: [trust()], started: [] });
  await user.click(screen.getByText('other', { selector: '[data-field="title"]' }));
  await user.click(within(screen.getByRole('list', { name: 'Starting Sessions' })).getByRole('listitem'));
  expect(screen.queryByRole('button', { name: 'Trust folder' })).toBeNull();
  expect(app.client.answerTrust).toHaveBeenCalledTimes(1);
});

it('LAUNCH-6.14 LAUNCH-4.7: ⌘J cycles through Trust prompts before Sessions and skips plain starts after the prompt leaves', async () => {
  const app = renderApp('/');
  app.snapshot([row({ id: 'waiting', status: 'needs-you' })]);
  app.emit({ type: 'launches', launches: [trust(), launchView({ id: 'plain' })], started: [] });
  const user = userEvent.setup();
  await user.keyboard('{Meta>}j{/Meta}');
  expect(window.location.pathname).toBe('/l/l-trust');
  await user.keyboard('{Meta>}j{/Meta}');
  expect(window.location.pathname).toBe('/s/waiting');
  await user.keyboard('{Meta>}j{/Meta}');
  expect(window.location.pathname).toBe('/l/l-trust');
  app.emit({ type: 'launches', launches: [launchView({ id: 'l-trust' }), launchView({ id: 'plain' })], started: [] });
  await user.keyboard('{Meta>}j{/Meta}');
  expect(window.location.pathname).toBe('/s/waiting');
});
