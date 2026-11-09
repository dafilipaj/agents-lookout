import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RowSettling } from '@/components/ui/icon-button';
import { type RowLink, type RowLinkGroup, RowDetails, RowTitle } from '@/components/ui/row-details';

const link = (n: number, over: Partial<RowLink> = {}): RowLink => ({ key: `s${n}`, glyph: <svg data-glyph />, name: `Session ${n}`, state: 'past', label: `Resume Session ${n}, past`, tip: `reason ${n}`, onPress: () => {}, ...over });
const group = (kind: RowLinkGroup['kind'], count: number, over: Partial<RowLink> = {}): RowLinkGroup => ({
  kind,
  noun: kind === 'sessions' ? ['Session', 'Sessions'] : kind === 'prs' ? ['PR', 'PRs'] : kind === 'tasks' ? ['Task', 'Tasks'] : ['Topic', 'Topics'],
  items: Array.from({ length: count }, (_, i) => link(i + 1, { key: `${kind}${i}`, ...over })),
});

function Row({ settling = false, ...props }: Partial<Parameters<typeof RowDetails>[0]> & { settling?: boolean }) {
  return (
    <div role="listbox" aria-label="Rows">
      <div role="option" aria-selected aria-expanded>
        <RowTitle expanded>Port the deal rates table to the new pricing model</RowTitle>{' '}
        <RowSettling.Provider value={settling}>
          <RowDetails id="d" state={['Lantern Works', 'In progress']} links={[]} actions={<div data-field="actions" />} {...props} />
        </RowSettling.Provider>
      </div>
    </div>
  );
}

const counts = () => [...document.querySelectorAll<HTMLElement>('[data-field="count"]')];
const lines = () => [...document.querySelectorAll<HTMLElement>('[data-field="link-list"] [data-field="link"]')];

describe('RowDetails (DS-21)', () => {
  it('DS-21.1: an expanded row is its title, whole; its state, one meta line of facts joined by " · "; its summary; its links; its actions last; a part with nothing is left out, and no part has a label beside it', () => {
    const { rerender } = render(<Row described state={['Lantern Works', null, false, 'In progress', <span data-field="due">due Nov 12</span>]} stateTip="Created Oct 30" summary={<p>Rates move to the pricing model.</p>} links={[group('sessions', 2)]} />);
    const title = document.querySelector('[data-field="title"]')!;
    expect(title).not.toHaveClass('truncate');
    expect(title).toHaveClass('whitespace-normal', 'break-words');
    const state = document.querySelector<HTMLElement>('[data-field="state"]')!;
    expect(state).toHaveClass('text-meta', 'whitespace-nowrap', 'overflow-hidden');
    expect(state.textContent).toBe('Lantern Works · In progress · due Nov 12');
    expect(state).toHaveAttribute('title', 'Created Oct 30');
    // The state is part of the row's name, the separators aren't; described, the rest is its description.
    expect(screen.getByRole('option')).toHaveAccessibleName('Port the deal rates table to the new pricing model Lantern Works In progress due Nov 12');
    const details = document.getElementById('d')!;
    expect([...details.children].map((c) => c.getAttribute('data-field'))).toEqual(['row-summary', 'links', 'actions']);
    expect(details.parentElement!.firstElementChild).toBe(state);
    // Without a summary or links, the state and the actions only.
    rerender(<Row />);
    expect([...document.getElementById('d')!.children].map((c) => c.getAttribute('data-field'))).toEqual(['actions']);
    // A collapsed row's title is cut to one line.
    render(<RowTitle expanded={false}>Port the deal rates table</RowTitle>);
    expect(screen.getByText('Port the deal rates table')).toHaveClass('truncate');
  });

  it('DS-21.1: described, the summary, links and actions are hidden and heard as the row\'s description; otherwise they stay in the tree', () => {
    const { rerender } = render(<Row described />);
    expect(document.getElementById('d')).toHaveAttribute('aria-hidden', 'true');
    rerender(<Row />);
    expect(document.getElementById('d')).not.toHaveAttribute('aria-hidden');
  });

  it('DS-21.2: links are counts on one line, each a disclosure; the first opens when it holds three or fewer; opening one closes the other; an open one lists three, then "Show all N"', () => {
    render(<Row links={[group('sessions', 3), group('prs', 5), group('topics', 0)]} />);
    // A kind with no links has no count.
    expect(counts().map((c) => [c.textContent, c.getAttribute('aria-expanded')])).toEqual([['3 Sessions', 'true'], ['5 PRs', 'false']]);
    expect(counts()[0]!.parentElement).toHaveClass('flex-wrap', 'gap-2');
    expect(lines()).toHaveLength(3);
    expect(document.querySelector('[data-field="show-all"]')).toBeNull();
    fireEvent.click(counts()[1]!);
    expect(counts().map((c) => c.getAttribute('aria-expanded'))).toEqual(['false', 'true']);
    expect(lines()).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 5' }));
    expect(lines()).toHaveLength(5);
    fireEvent.click(counts()[1]!);
    expect(lines()).toHaveLength(0);
    // Links that arrive after the row expanded open the first count, until a count is pressed.
    const late = render(<Row links={[]} />);
    late.rerender(<Row links={[group('topics', 2)]} />);
    expect(late.container.querySelector('[data-field="count"]')).toHaveAttribute('aria-expanded', 'true');
    // Open on its own, it stays open as it grows past three.
    late.rerender(<Row links={[group('topics', 5)]} />);
    expect(late.container.querySelector('[data-field="count"]')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(late.container.querySelector('[data-field="count"]')!);
    late.rerender(<Row links={[group('topics', 3)]} />);
    expect(late.container.querySelector('[data-field="count"]')).toHaveAttribute('aria-expanded', 'false');
    late.unmount();
    // The first count stays closed when it holds more than three.
    render(<Row links={[group('sessions', 4), group('prs', 1)]} />);
    expect(counts().slice(2).map((c) => c.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
  });

  it('DS-21.2: a link\'s line is its marker or icon, its name and its state at the end; a press does what its label says, its hover the tip; one without a press is text', () => {
    const open = vi.fn();
    render(<Row links={[{ kind: 'sessions', noun: ['Session', 'Sessions'], items: [link(1, { onPress: open, state: 'live', label: 'Open Session 1, Busy', action: 'session', sessionId: 'one' }), link(2, { onPress: undefined, label: 'Session 2, removed from the index' })] }]} />);
    const [live, pruned] = lines();
    expect(live).toHaveAttribute('role', 'button');
    expect(live).toHaveAccessibleName('Open Session 1, Busy');
    expect(live).toHaveAttribute('title', 'reason 1');
    expect(live).toHaveAttribute('data-action', 'session');
    expect(live).toHaveAttribute('data-session-id', 'one');
    expect([...live!.children].map((c) => c.textContent)).toEqual(['', 'Session 1', 'live']);
    expect(live!.querySelector('[data-glyph]')).not.toBeNull();
    expect(live!.lastElementChild).toHaveClass('text-meta', 'text-muted-foreground', 'shrink-0');
    expect(live).toHaveClass('h-6');
    fireEvent.click(live!, { detail: 1 });
    expect(open).toHaveBeenCalledTimes(1);
    expect(pruned).not.toHaveAttribute('role');
  });

  it('DS-21.2: a count, a line and "Show all" never act on the row under them, on a double click\'s second click or while the row settles; focusable, Enter and Space press them', async () => {
    const open = vi.fn(), row = vi.fn();
    const { rerender } = render(
      <div onClick={row}>
        <Row settling links={[group('sessions', 2, { onPress: open })]} />
      </div>,
    );
    fireEvent.click(lines()[0]!, { detail: 1 });
    fireEvent.click(counts()[0]!, { detail: 1 });
    expect(open).not.toHaveBeenCalled();
    expect(lines()[0]).toHaveAttribute('aria-disabled', 'true');
    expect(counts()[0]).toHaveAttribute('aria-expanded', 'true');
    rerender(
      <div onClick={row}>
        <Row links={[group('sessions', 2, { onPress: open })]} />
      </div>,
    );
    fireEvent.click(lines()[0]!, { detail: 2 });
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(lines()[0]!, { detail: 1 });
    expect(open).toHaveBeenCalledTimes(1);
    expect(row).not.toHaveBeenCalled();
    // In the Topics tab (TOPIC-3.4) they're in the Tab order.
    rerender(<Row focusable links={[group('sessions', 5, { onPress: open })]} />);
    const user = userEvent.setup();
    expect(counts()[0]).toHaveAttribute('tabindex', '0');
    counts()[0]!.focus();
    await user.keyboard('{Enter}');
    expect(counts()[0]).toHaveAttribute('aria-expanded', 'true');
    expect(lines()[0]).toHaveAttribute('tabindex', '0');
    lines()[0]!.focus();
    await user.keyboard(' ');
    expect(open).toHaveBeenCalledTimes(2);
    within(document.body).getByRole('button', { name: 'Show all 5' }).focus();
    await user.keyboard('{Enter}');
    expect(lines()).toHaveLength(5);
  });
});
