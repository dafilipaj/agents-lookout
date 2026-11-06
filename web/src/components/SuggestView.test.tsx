import { type NewMember, NO_ACTIVITY, type Proposal, type SuggestState, type Topic, type TopicsView, memberKey } from '@shared/topics.ts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, renderApp, row, primaryButtons } from '@/test/helpers';

/** Synthetic Topics, Sessions and PRs only. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const topic = (n: number, over: Partial<Topic> = {}): Topic => ({ id: id(n), title: `Topic ${n}`, notes: '', state: 'open', createdAt: NOW - 1e6, updatedAt: NOW - n * 1000, members: [], outputs: { items: [], total: 0 }, pos: null, summary: null, summaryStale: false, ...NO_ACTIVITY, ...over });
const sid = (n: number) => `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SESSION = (n: number): NewMember & { key: string } => {
  const m: NewMember = { kind: 'session', ref: { harness: 'claude', sessionId: sid(n) }, snapshot: { harness: 'claude', title: `Polish lantern ${n}`, directory: '~/Projects/harbor' } };
  return { ...m, key: memberKey(m.kind, m.ref) };
};
const PR: NewMember & { key: string } = (() => {
  const m: NewMember = { kind: 'pr', ref: { url: 'https://github.com/productiveio/anvil/pull/7' }, snapshot: { repo: 'anvil', number: 7, title: 'Sharpen the anvil', url: 'https://github.com/productiveio/anvil/pull/7' } };
  return { ...m, key: memberKey(m.kind, m.ref) };
})();
const NEW: Proposal = { id: '1:0', kind: 'new', title: 'Lantern polish', note: 'Polishing every lantern.', topicId: null, members: [SESSION(1), SESSION(2)], edges: [{ to: id(1), label: 'part of' }], why: 'Both polish lanterns.', status: 'pending' };
const ADD: Proposal = { id: '1:1', kind: 'add', title: null, note: null, topicId: id(1), members: [PR], edges: [], why: 'Harbor work.', status: 'pending' };
const suggestView = (suggest: Partial<SuggestState>, topics: Topic[] = [topic(1, { title: 'Harbor' })]): TopicsView => ({
  state: 'ok', reason: null, path: '/p', topics, edges: [], pruned: [], libraryReadAt: null, recommendations: [], jevAsksToday: 0, jevSetAside: { count: 0, reason: null }, summarizing: [], summaryErrors: {},
  suggest: { running: false, error: null, proposals: [], run: null, ...suggest },
});
const view = () => screen.getByTestId('suggest-view');

beforeEach(() => window.localStorage.clear());

describe('Suggest Topics (TOPIC-14)', () => {
  it('TOPIC-14.1: "Suggest Topics" in the Topics tab and the graph opens the Suggest view; the tab says how many live Sessions are in no Topic', async () => {
    const app = renderApp('/s/alpha', { topics: [topic(1, { title: 'Harbor', members: [{ ...SESSION(1), addedAt: NOW, reason: 'added by hand' }] })] });
    app.snapshot([row({ id: 'alpha' }), row({ id: sid(1), title: 'lantern' }), row({ id: sid(2), title: 'other' })]);
    const user = userEvent.setup();
    await user.keyboard('t');
    const panel = screen.getByTestId('topics-panel');
    // alpha and sid(2) are live and in no Topic; sid(1) is filed.
    const line = within(panel).getByText('2 live Sessions in no Topic').closest<HTMLElement>('[data-field="unfiled"]')!;
    await user.click(within(line).getByRole('button', { name: 'Suggest Topics' }));
    expect(window.location.pathname).toBe('/topics/suggest');
    expect(view()).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Open graph' }));
    // The graph's own, in its header.
    await user.click(screen.getAllByRole('button', { name: 'Suggest Topics' }).find((b) => !panel.contains(b))!);
    expect(window.location.pathname).toBe('/topics/suggest');
    await user.click(within(panel).getByRole('button', { name: 'Open graph' }));
    await user.click(panel.querySelector<HTMLElement>('[data-action="suggest-topics"]')!);
    expect(window.location.pathname).toBe('/topics/suggest');
  });

  it('TOPIC-14.2, DS-6.6: the view says what a run would look at (a Loading while it reads), Suggest starts one, Cancel stops it while it runs, and a failed run says why', async () => {
    const app = renderApp('/topics/suggest');
    app.snapshot([row({ id: 'alpha' })]);
    app.emit({ type: 'topics', topics: suggestView({}) });
    expect(within(view()).getByText('Reading what’s in no Topic…').closest('[data-slot="loading"]')).not.toBeNull();
    const user = userEvent.setup();
    expect(await within(view()).findByText('4 Sessions, 1 PR and 0 Tasks in no Topic')).toBeInTheDocument();
    await user.click(within(view()).getByRole('button', { name: 'Suggest' }));
    expect(app.client.suggest).toHaveBeenCalledTimes(1);
    app.emit({ type: 'topics', topics: suggestView({ running: true }) });
    expect(within(view()).getByText('Suggesting…')).toBeInTheDocument();
    await user.click(within(view()).getByRole('button', { name: 'Cancel' }));
    expect(app.client.cancelSuggest).toHaveBeenCalledTimes(1);
    app.emit({ type: 'topics', topics: suggestView({ error: { reason: 'It took longer than 180 s and was stopped.', fix: null } }) });
    const alert = within(view()).getByRole('alert');
    expect(alert).toHaveTextContent('No Topics were suggested');
    expect(alert).toHaveTextContent('It took longer than 180 s and was stopped.');
  });

  it('TOPIC-14.5: new Topics first, each with its title and note to edit, members and Edges ticked; Accept sends what was edited and ticked; the run’s line says who wrote it and what it cost', async () => {
    const app = renderApp('/topics/suggest');
    app.snapshot([row({ id: 'alpha' })]);
    app.emit({ type: 'topics', topics: suggestView({ proposals: [ADD, NEW], run: { writtenAt: NOW - 2 * 3_600_000, model: 'claude-sonnet-5-5', costUsd: 0.07 } }) });
    const user = userEvent.setup();
    const cards = view().querySelectorAll<HTMLElement>('[data-proposal]');
    expect([...cards].map((c) => c.dataset.proposal)).toEqual(['1:0', '1:1']);
    const card = cards[0]!;
    expect(within(card).getByText('Both polish lanterns.')).toBeInTheDocument();
    const title = within(card).getByRole('textbox', { name: 'Title' });
    await user.clear(title);
    await user.type(title, 'Lantern polishing');
    await user.click(within(card).getByRole('checkbox', { name: /Polish lantern 2/ }));
    await user.click(within(card).getByRole('checkbox', { name: /Harbor \(part of\)/ }));
    expect(primaryButtons(view()).length).toBeLessThanOrEqual(1); // DS-18.4: each card's Accept is Soft, a row's next step
    await user.click(within(card).getByRole('button', { name: 'Accept' }));
    expect(app.client.acceptProposal).toHaveBeenCalledWith('1:0', { title: 'Lantern polishing', note: 'Polishing every lantern.', members: [SESSION(1).key], edges: [] });
    const addition = cards[1]!;
    expect(within(addition).getByRole('heading', { name: 'Add to Harbor' })).toBeInTheDocument();
    await user.click(within(addition).getByRole('button', { name: 'Accept' }));
    expect(app.client.acceptProposal).toHaveBeenCalledWith('1:1', { members: [PR.key], edges: [] });
    expect(within(view()).getByText(/^Sonnet 5\.5 · \$0\.07 · .+ ago$/)).toBeInTheDocument();
    expect(within(view()).getByRole('button', { name: 'Suggest again' })).toBeInTheDocument();
  });

  it('TOPIC-14.5, TOPIC-14.6: an addition to a Topic archived since can only be dismissed; Dismiss sends it, and a refusal shows on the card', async () => {
    const app = renderApp('/topics/suggest');
    app.snapshot([row({ id: 'alpha' })]);
    app.emit({ type: 'topics', topics: suggestView({ proposals: [ADD] }, [topic(1, { title: 'Harbor', state: 'archived' })]) });
    const user = userEvent.setup();
    const card = view().querySelector<HTMLElement>('[data-proposal="1:1"]')!;
    expect(within(card).getByText('That Topic was archived or deleted since: this proposal can only be dismissed.')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Accept' })).toBeDisabled();
    vi.mocked(app.client.dismissProposal).mockRejectedValueOnce(new Error('That proposal is no longer pending.'));
    await user.click(within(card).getByRole('button', { name: 'Dismiss' }));
    expect(app.client.dismissProposal).toHaveBeenCalledWith('1:1');
    await waitFor(() => expect(within(card).getByText('That proposal is no longer pending.')).toBeInTheDocument());
  });
});
