import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRow, SubagentItem } from '@shared/types.ts';
import { renderApp, row } from '@/test/helpers';

const statusLine = () => screen.getByRole('group', { name: 'Status line' });
const part = () => statusLine().querySelector<HTMLElement>('[data-field="subagents"]');
const list = () => screen.getByRole('group', { name: 'Subagents' });
const rows = () => [...list().querySelectorAll<HTMLElement>('[data-subagent]')];

const START = Date.UTC(2026, 10, 2, 10, 0, 0);
const at = (s: number) => new Date(START + s * 1000).toISOString();
const item = (id: string, o: Partial<SubagentItem> = {}): SubagentItem => ({
  id,
  parent: null,
  depth: 1,
  state: 'running',
  task: `Task ${id}`,
  type: 'general-purpose',
  name: null,
  role: null,
  model: 'claude-opus-5-5',
  startedAt: at(0),
  endedAt: null,
  activity: null,
  ...o,
});
const counted = (items: SubagentItem[], more = 0): SessionRow['subagents'] => ({
  running: items.filter((i) => i.state === 'running').length + more,
  finished: items.filter((i) => i.state !== 'running').length,
  items,
});

afterEach(() => vi.useRealTimers());

async function openList(subagents: SessionRow['subagents'], o: Partial<SessionRow> = {}) {
  const user = userEvent.setup();
  const app = renderApp('/s/a');
  app.snapshot([row({ id: 'a', contextPct: 23, subagents, ...o })]);
  await user.click(part()!);
  return { app, user };
}

describe('the Subagents list', () => {
  it('VIEW-8.6: the part, running or done, opens the list: running ones first, then the finished ones, nested ones indented, "and n more" from the counts', async () => {
    const items = [
      item('late', { startedAt: at(30) }),
      item('early', { startedAt: at(5) }),
      item('child', { parent: 'early', depth: 2, startedAt: at(40) }),
      item('done', { state: 'completed', startedAt: at(1), endedAt: at(20) }),
    ];
    const { app, user } = await openList(counted(items, 2));
    expect(part()).toHaveTextContent('5 subagents');
    expect(part()).toHaveAttribute('data-state', 'running');
    expect(rows().map((r) => r.dataset.subagent)).toEqual(['early', 'child', 'late', 'done']);
    expect(rows()[1]!.getAttribute('style')).toContain('1.5rem');
    expect(rows()[0]!.getAttribute('style')).toBeNull();
    expect(list()).toHaveTextContent('and 2 more');
    await user.keyboard('{Escape}');
    // Done: the part opens the same list.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', contextPct: 23, subagents: counted([item('done', { state: 'stopped', startedAt: at(1), endedAt: at(20) })]) })], remove: [] });
    expect(part()).toHaveTextContent('1 subagent done');
    expect(part()).toHaveAttribute('data-state', 'done');
    await user.click(part()!);
    expect(rows().map((r) => r.dataset.subagent)).toEqual(['done']);
    expect(list()).not.toHaveTextContent('more');
  });

  it('VIEW-8.6: a Subagent whose starter finished stays among the running and says which one started it', async () => {
    await openList(counted([item('kid', { parent: 'p', depth: 2, startedAt: at(5) }), item('p', { state: 'completed', task: 'Review the diff', endedAt: at(9) })]));
    const kid = rows()[0]!;
    expect(kid.dataset.subagent).toBe('kid');
    expect(within(kid).getByText(/from Review the diff/)).toHaveClass('text-muted-foreground');
  });

  it('VIEW-8.7: a running row: title, its time counting every second, type and model, and its last tool call in the quieter colour', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(START + 192_000);
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', subagents: counted([item('a1', { task: 'Review the diff', type: 'Explore', model: 'haiku', activity: 'Bash: run the tests' })]) })]);
    fireEvent.click(part()!);
    const r = rows()[0]!;
    expect(within(r).getByText('Review the diff')).toHaveClass('truncate', 'font-medium');
    expect(r.querySelector('[data-slot="subagent-time"]')).toHaveTextContent(/^3m 12s$/);
    expect(r.querySelector('[data-slot="subagent-meta"]')).toHaveTextContent(/^Explore · haiku$/);
    expect(r.querySelector('[data-slot="subagent-activity"]')).toHaveTextContent('Bash: run the tests');
    expect(r.querySelector('[data-slot="subagent-activity"]')).toHaveClass('text-muted-foreground');
    act(() => vi.advanceTimersByTime(1000));
    expect(r.querySelector('[data-slot="subagent-time"]')).toHaveTextContent(/^3m 13s$/);
    // Codex: its nickname and role stand for the type.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', harness: 'codex', subagents: counted([item('c1', { task: 'fill_review', type: null, name: 'Bohr', role: 'reviewer', model: 'gpt-6-luna' })]) })], remove: [] });
    expect(rows()[0]!.querySelector('[data-slot="subagent-meta"]')).toHaveTextContent(/^Bohr · reviewer · gpt-6-luna$/);
  });

  it('VIEW-8.8: a finished row says how long it ran and how it ended, with no last tool call', async () => {
    await openList(
      counted(['completed', 'failed', 'stopped'].map((state, i) => item(`d${i}`, { state: state as SubagentItem['state'], endedAt: at(45 - i), activity: 'Bash: x' }))),
    );
    expect(rows().map((r) => r.querySelector('[data-slot="subagent-time"]')!.textContent)).toEqual(['45s · completed', '44s · failed', '43s · stopped']);
    expect(list().querySelector('[data-slot="subagent-activity"]')).toBeNull();
  });

  it('VIEW-8.9: what Fleet does not give is left out, never "unknown"', async () => {
    await openList(counted([item('bare', { task: null, type: null, model: null, startedAt: null })]));
    const r = rows()[0]!;
    expect(r).toHaveTextContent(/^Subagent$/);
    expect(r.querySelector('[data-slot="subagent-time"]')).toBeNull();
    expect(r.querySelector('[data-slot="subagent-meta"]')).toBeNull();
    expect(list()).not.toHaveTextContent(/unknown/i);
  });

  it('VIEW-8.10: the list follows Fleet in place; one that ends moves to the finished ones, one from an earlier Turn leaves; focus stays on its row', async () => {
    const a = item('a', { startedAt: at(1) });
    const b = item('b', { startedAt: at(2) });
    const { app, user } = await openList(counted([a, b]));
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toHaveAttribute('data-subagent', 'b');
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', contextPct: 23, subagents: counted([{ ...a, state: 'completed', endedAt: at(9) }, { ...b, activity: 'Read: a.rs' }]) })], remove: [] });
    expect(rows().map((r) => [r.dataset.subagent, r.dataset.state])).toEqual([['b', 'running'], ['a', 'completed']]);
    expect(document.activeElement).toHaveAttribute('data-subagent', 'b');
    expect(rows()[0]).toHaveTextContent('Read: a.rs');
    // `b` started in an earlier Turn: once it ends Fleet lists it no more; focus moves on.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', contextPct: 23, subagents: counted([{ ...a, state: 'completed', endedAt: at(9) }]) })], remove: [] });
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-subagent', 'a'));
  });

  it('VIEW-8.10: when the part goes (the next prompt, the Session ends) the list closes and focus returns to the composer, or the chat without one', async () => {
    const { app } = await openList(counted([item('a', { state: 'completed', endedAt: at(9) })]));
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', contextPct: 23, subagents: { running: 0, finished: 0, items: [] } })], remove: [] });
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Subagents' })).toBeNull());
    expect(part()).toBeNull();
    expect(document.activeElement).toHaveRole('textbox');
  });

  it('VIEW-8.10: a View only Session has no composer: when it ends, focus returns to the chat', async () => {
    const view = await openList(counted([item('a')]), { controllable: false, backend: 'unknown' });
    view.app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Subagents' })).toBeNull());
    expect(document.activeElement).toHaveAccessibleName('Chat');
  });

  it('VIEW-8.11: Enter opens it, Up and Down move, a row does nothing, Esc closes and returns focus to the part; each row is named by title, state and time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START + 65_000);
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', subagents: counted([item('a1', { task: 'Review the diff' }), item('a2', { task: 'Fix it', state: 'failed', endedAt: at(30) })]) })]);
    part()!.focus();
    await user.keyboard('{Enter}');
    expect(list()).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(document.activeElement).toHaveAccessibleName('Review the diff, running for 1m 5s');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveAccessibleName('Fix it, failed after 30s');
    await user.keyboard('{Enter}');
    expect(list()).toBeInTheDocument();
    expect(document.activeElement).toHaveAccessibleName('Fix it, failed after 30s');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Subagents' })).toBeNull();
    expect(document.activeElement).toBe(part());
    expect(part()).toHaveAccessibleName('1 subagent, show them');
  });

  it('VIEW-8.12: a long title or tool call is cut on its row, the whole text in its tooltip', async () => {
    const long = 'x'.repeat(300);
    await openList(counted([item('a', { task: long, activity: `Bash: ${long}` })]));
    const title = within(rows()[0]!).getByText(long);
    expect(title).toHaveClass('min-w-0', 'truncate');
    expect(title).toHaveAttribute('title', long);
    expect(rows()[0]!.querySelector('[data-slot="subagent-activity"]')).toHaveAttribute('title', `Bash: ${long}`);
  });

  it('VIEW-8.13: without Fleet\'s list the part stays plain text and opens nothing', () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', subagents: { running: 2, finished: 0 } })]);
    expect(part()!.tagName).toBe('SPAN');
    expect(statusLine().querySelector('button[data-field="subagents"]')).toBeNull();
  });
});
