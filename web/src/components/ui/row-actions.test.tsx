import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RowSettling } from '@/components/ui/icon-button';
import { type RowMenuItem, RowActions } from '@/components/ui/row-actions';

const menu = () => document.querySelector<HTMLElement>('[data-slot="row-menu"]');
const item = (over: Partial<RowMenuItem> & Pick<RowMenuItem, 'id' | 'group'>): RowMenuItem => ({ action: 'more', onSelect: () => {}, ...over });

/** A listbox option holding the actions, as Work's, History's and Library's rows do. */
function Row({ onRow = () => {}, onKeys = () => {}, settling = false, ...props }: Partial<Parameters<typeof RowActions>[0]> & { onRow?(): void; onKeys?(key: string): void; settling?: boolean }) {
  return (
    <div role="listbox" tabIndex={0} aria-label="Rows" onKeyDown={(e) => onKeys(e.key)}>
      <div role="option" aria-selected onClick={onRow}>
        <RowSettling.Provider value={settling}>
          <RowActions name="Harbor bells" primary={{ 'data-action': 'start', action: 'start', tip: 'Start Session (S)', onPress: () => {} }} more={[]} {...props} />
        </RowSettling.Provider>
      </div>
    </div>
  );
}

describe('RowActions (DS-16)', () => {
  it('DS-16.1, DS-18.4: the first action is a labelled Soft button with ↵ after its word, the rest one "More" on the same line that never wraps; without others, no More', () => {
    const { rerender } = render(<Row more={[item({ id: 'open', group: 'open' })]} />);
    const actions = document.querySelector<HTMLElement>('[data-field="actions"]')!;
    expect(actions).toHaveClass('flex-nowrap');
    expect(actions).not.toHaveClass('flex-wrap');
    const [first, more] = [...actions.querySelectorAll<HTMLElement>('[data-slot="row-action"]')];
    expect(first).toHaveAttribute('data-action', 'start');
    expect(first).toHaveAccessibleName('Start Session'); // ↵ is shown, not read
    expect(first!.querySelector('kbd')).toHaveTextContent('↵');
    expect(first).toHaveClass('min-w-0', 'shrink');
    expect(more).toHaveAttribute('data-action', 'more');
    expect(more).toHaveAccessibleName('More');
    expect(more).toHaveAttribute('aria-haspopup', 'menu');
    expect(more!.textContent).toBe('More'); // no count
    // DS-18.4: the first action is Soft, More is Quiet with its word; DS-18.6: their icons come from the action table.
    expect(first).toHaveClass('bg-primary-soft', 'text-primary-text');
    expect(more).toHaveClass('text-muted-foreground');
    expect(more).not.toHaveClass('border');
    expect(first!.querySelector('[data-action-icon]')).toHaveAttribute('data-action-icon', 'start');
    expect(more!.querySelector('[data-action-icon]')).toHaveAttribute('data-action-icon', 'more');
    rerender(<Row more={[null, false]} />);
    expect(document.querySelector('[data-action="more"]')).toBeNull();
  });

  it('DS-16.2: the menu groups run, open elsewhere, Topics, then managing after a divider, each in the order given, with its key; Delete in destructive-text; a submenu item opens its own list', async () => {
    const user = userEvent.setup();
    render(
      <Row
        more={[
          item({ id: 'delete', group: 'manage', action: 'delete', destructive: true }),
          item({ id: 'add-to-topic', group: 'topic', label: 'Add to Topic', shortcut: 'A' }),
          item({ id: 'open', group: 'open', action: 'open-external', label: 'Open on GitHub', shortcut: 'O' }),
          item({ id: 'archive', group: 'manage', action: 'archive' }),
          item({ id: 'review', group: 'run', label: 'Review', shortcut: 'R' }),
          item({ id: 'specs', group: 'open', label: 'Specs', shortcut: 'S', submenu: { label: 'Specs in shop #7', content: <p data-field="sub">the list</p> } }),
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More' }));
    const m = await waitFor(() => menu()!);
    expect(m).toHaveAccessibleName('More for Harbor bells');
    const order = [...m.querySelectorAll<HTMLElement>('[role="menuitem"], [role="separator"]')].map((el) => (el.getAttribute('role') === 'separator' ? '---' : `${el.getAttribute('data-action')}${el.querySelector('kbd') ? `(${el.querySelector('kbd')!.textContent})` : ''}`));
    expect(order).toEqual(['review(R)', 'open(O)', 'specs(S)', 'add-to-topic(A)', '---', 'delete', 'archive']);
    expect(m.querySelector('[data-action="delete"]')).toHaveClass('text-destructive-text');
    expect(m.querySelector('[data-action="archive"]')).not.toHaveClass('text-destructive-text');
    expect(m.querySelector('[data-action="specs"]')).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(m.querySelector<HTMLElement>('[data-action="specs"]')!);
    expect(await screen.findByRole('menu', { name: 'Specs in shop #7' })).toHaveTextContent('the list');
    // Focus on another item closes it, as Radix's does.
    act(() => m.querySelector<HTMLElement>('[data-action="add-to-topic"]')!.focus());
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Specs in shop #7' })).toBeNull());
    expect(menu()).not.toBeNull();
  });

  it("DS-16.3: picking runs it and closes the menu, with focus back on the panel's list; a disabled item does nothing; the menu's clicks and Esc never reach the row", async () => {
    const user = userEvent.setup();
    const onRow = vi.fn();
    const keys = vi.fn();
    const ran = vi.fn();
    const blocked = vi.fn();
    render(<Row onRow={onRow} onKeys={keys} more={[item({ id: 'open', group: 'open', action: 'open-external', label: 'open', onSelect: ran }), item({ id: 'review', group: 'run', action: 'review', label: 'review', enabled: false, onSelect: blocked })]} />);
    await user.click(screen.getByRole('button', { name: 'More' }));
    const m = await waitFor(() => menu()!);
    await user.click(within(m).getByRole('menuitem', { name: 'review' }));
    expect(blocked).not.toHaveBeenCalled();
    expect(m.querySelector('[data-action="review"]')).toHaveAttribute('aria-disabled', 'true');
    await user.click(within(m).getByRole('menuitem', { name: 'open' }));
    expect(ran).toHaveBeenCalledOnce();
    await waitFor(() => expect(menu()).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('listbox'));
    expect(onRow).not.toHaveBeenCalled();
    // A key in it and Esc, which closes it: the row's list, under it in React's tree, hears neither.
    await user.click(screen.getByRole('button', { name: 'More' }));
    await waitFor(() => expect(menu()).not.toBeNull());
    await user.keyboard('a{Escape}');
    await waitFor(() => expect(menu()).toBeNull());
    expect(keys).not.toHaveBeenCalled();
    expect(onRow).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('listbox'));
  });

  it("DS-16.3: More opens and closes on a click, one with no count (assistive technology's) too, never on a press; it does nothing while its row settles, nor on a double click's second click however slow", () => {
    const { rerender } = render(<Row settling more={[item({ id: 'open', group: 'open' })]} />);
    const more = () => screen.getByRole('button', { name: 'More' });
    expect(more()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(more(), { detail: 1 });
    expect(menu()).toBeNull();
    rerender(<Row more={[item({ id: 'open', group: 'open' })]} />);
    fireEvent.pointerDown(more(), { button: 0, pointerType: 'mouse' });
    expect(menu()).toBeNull();
    fireEvent.click(more(), { detail: 1 });
    expect(menu()).not.toBeNull();
    fireEvent.pointerDown(more(), { button: 0, pointerType: 'mouse' }); // the double click's second press…
    fireEvent.click(more(), { detail: 2 }); // …and click
    expect(menu()).not.toBeNull();
    fireEvent.pointerDown(more(), { button: 0, pointerType: 'mouse' }); // a click on More while it's open closes it
    fireEvent.click(more(), { detail: 1 });
    expect(menu()).toBeNull();
    fireEvent.click(more(), { detail: 0 });
    expect(menu()).not.toBeNull();
  });

  it('DS-16.3, TOPIC-3.4: focusable, outside a listbox, its buttons are in the Tab order, Enter and Space press them, and closing the menu, or picking an item, leaves focus on More', async () => {
    const user = userEvent.setup();
    const opened = vi.fn();
    const asked = vi.fn();
    render(
      <div>
        <button type="button">Header</button>
        <RowActions focusable name="Harbor bells" primary={{ 'data-action': 'open', action: 'open', tip: 'Open', onPress: opened }} more={[item({ id: 'archive', group: 'manage', onSelect: asked })]} />
      </div>,
    );
    screen.getByRole('button', { name: 'Header' }).focus();
    await user.tab();
    expect(document.activeElement).toHaveAttribute('data-action', 'open');
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(opened).toHaveBeenCalledTimes(2);
    await user.tab();
    const more = screen.getByRole('button', { name: 'More' });
    expect(document.activeElement).toBe(more);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(menu()).not.toBeNull());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(menu()).toBeNull());
    expect(document.activeElement).toBe(more);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(menu()).not.toBeNull());
    await user.keyboard('{Enter}'); // the first item, Archive
    expect(asked).toHaveBeenCalledOnce();
    await waitFor(() => expect(menu()).toBeNull());
    expect(document.activeElement).toBe(more);
  });
});
