import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';
import { ACTIONS, type ActionId } from '@/lib/actions';
import { launchView, renderApp, row } from '@/test/helpers';

/**
 * DS-18: buttons by role, in the places that use them. A surface (a view, a dialog, a form with its
 * own Save) has at most one `primary` button (DS-18.4); the Session header's actions are three kinds,
 * End Session last after its divider (DS-18.5).
 */

const main = () => document.querySelector<HTMLElement>('main')!;
const header = () => screen.getByRole('banner', { name: 'Session' });
const role = (el: Element) => el.closest('[data-slot="button"]')?.getAttribute('data-variant');
const sizeOf = (el: Element) => el.closest('[data-slot="button"]')?.getAttribute('data-size');
const primaries = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('[data-slot="button"][data-variant="primary"]')];

beforeEach(() => window.localStorage.clear());

describe('one primary per surface (DS-18.4)', () => {
  it('DS-18.4: the empty main pane has one primary, Start a Session, 28 px', () => {
    const app = renderApp('/');
    app.snapshot([]);
    expect(primaries(main()).map((b) => b.textContent)).toEqual(['Start a Session']);
    expect(sizeOf(primaries(main())[0]!)).toBe('default');
  });

  it("DS-18.4: the Session view's one primary is Send, at 28 px", () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', ownHost: true })]);
    const send = within(main()).getByRole('button', { name: /Send/ });
    expect(primaries(main())).toEqual([send]);
    expect(sizeOf(send)).toBe('default');
  });

  it("DS-18.4: the launcher's one primary is Start; Cancel is secondary; both at the form's 32 px", async () => {
    const user = userEvent.setup();
    const app = renderApp('/');
    app.snapshot([row({ id: 'a' })]);
    await user.keyboard('n');
    const dialog = await screen.findByRole('dialog', { name: 'New Session' });
    expect(primaries(dialog).map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([expect.stringMatching(/^Start/)]);
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    expect(role(cancel)).toBe('secondary');
    expect([sizeOf(cancel), sizeOf(primaries(dialog)[0]!)]).toEqual(['form', 'form']);
  });

  it("DS-18.4: the Starting view's one primary is Trust folder, Cancel beside it secondary", () => {
    const app = renderApp('/l/l-trust');
    app.snapshot([]);
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-trust', title: 'new-repo', state: 'trust', trust: { id: 't1', lines: ['Accessing workspace:'], answerable: true, detail: null, answering: null, message: null } })], started: [] });
    const view = screen.getByRole('region', { name: 'Claude Code asks whether you trust this folder' });
    expect(primaries(main()).map((b) => b.textContent)).toEqual(['Trust folder']);
    expect(role(within(view).getByRole('button', { name: 'Cancel' }))).toBe('secondary');
  });

  it("DS-18.4: each of Settings' forms has at most one primary, its Save, at 32 px", async () => {
    const app = renderApp('/settings');
    app.snapshot([]);
    const forms = await waitFor(() => {
      const found = [...main().querySelectorAll('form')];
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    for (const form of forms) {
      const own = primaries(form);
      expect(own.length, form.getAttribute('aria-label') ?? 'a form').toBeLessThanOrEqual(1);
      for (const b of own) {
        expect(b).toHaveTextContent('Save');
        expect(sizeOf(b)).toBe('form');
      }
    }
  });
});

describe('the Session header (DS-18.5)', () => {
  it('DS-18.5: Stop is secondary, Add to Topic and Copy session ID quiet, End Session danger, last, after a divider; all 28 px', () => {
    const app = renderApp('/s/3f2b8c1e-9a47-4d6e-b0c5-7e1d2a9f4b68');
    app.snapshot([row({ id: '3f2b8c1e-9a47-4d6e-b0c5-7e1d2a9f4b68', status: 'busy', ownHost: true })]);
    const actions = header().querySelector<HTMLElement>('[data-slot="header-actions"]')!;
    const stop = within(actions).getByRole('button', { name: 'Stop' });
    const copy = within(actions).getByRole('button', { name: 'Copy session ID' });
    const end = within(actions).getByRole('button', { name: 'End Session' });
    expect(role(stop)).toBe('secondary');
    expect(role(copy)).toBe('quiet');
    expect(role(end)).toBe('danger');
    const addToTopic = actions.querySelector('[data-action="add-to-topic"]');
    if (addToTopic) expect(role(addToTopic)).toBe('quiet');
    const children = [...actions.children];
    expect(children.at(-1)).toBe(end);
    expect(children.at(-2)).toHaveAttribute('data-slot', 'button-divider');
    for (const b of within(actions).getAllByRole('button')) expect(sizeOf(b), b.textContent ?? '').toBe('default');
    expect(primaries(actions)).toEqual([]);
  });

  it('DS-18.5: without End Session there is no divider', () => {
    const app = renderApp('/s/3f2b8c1e-9a47-4d6e-b0c5-7e1d2a9f4b68');
    app.snapshot([row({ id: '3f2b8c1e-9a47-4d6e-b0c5-7e1d2a9f4b68', ownHost: false })]);
    const actions = header().querySelector<HTMLElement>('[data-slot="header-actions"]')!;
    expect(within(actions).queryByRole('button', { name: 'End Session' })).toBeNull();
    expect(actions.querySelector('[data-slot="button-divider"]')).toBeNull();
  });
});

describe('roles, sizes and the action table (DS-18.1, 18.3, 18.6)', () => {
  it("DS-18.1: each role has its one look: primary's fill, soft's primary-soft and primary-text, secondary's outline, quiet's and danger's none until the pointer is over them; secondary by default", () => {
    render(
      <>
        {(['primary', 'soft', 'secondary', 'quiet', 'danger', 'destructive', 'link'] as const).map((v) => (
          <Button key={v} variant={v}>
            {v}
          </Button>
        ))}
        <Button>plain</Button>
      </>,
    );
    const b = (name: string) => screen.getByRole('button', { name });
    expect(b('primary')).toHaveClass('bg-primary', 'text-primary-foreground');
    expect(b('soft')).toHaveClass('bg-primary-soft', 'text-primary-text');
    expect(b('secondary')).toHaveClass('border', 'bg-background');
    expect(b('quiet')).toHaveClass('text-muted-foreground', 'hover:bg-accent');
    expect(b('quiet').className).not.toMatch(/(?:^|\s)(?:border|bg-[a-z])/);
    expect(b('danger')).toHaveClass('text-destructive-text', 'hover:bg-accent');
    expect(b('danger').className).not.toMatch(/(?:^|\s)(?:border|bg-[a-z])/);
    expect(b('destructive')).toHaveClass('bg-destructive');
    expect(b('plain')).toHaveAttribute('data-variant', 'secondary');
    expect(b('plain').className).not.toMatch(/bg-secondary/); // shadcn's grey fill is gone
  });

  it('DS-18.3: three sizes named by place: line 24 px with meta text and a 14 px icon, default 28 px, form 32 px, both with body text', () => {
    render(
      <>
        <Button size="line">line</Button>
        <Button size="default">default</Button>
        <Button size="form">form</Button>
      </>,
    );
    const b = (name: string) => screen.getByRole('button', { name });
    expect(b('line')).toHaveClass('h-6', 'text-meta', "[&_svg:not([class*='size-'])]:size-3.5");
    expect(b('default')).toHaveClass('h-7', 'text-body', "[&_svg:not([class*='size-'])]:size-4");
    expect(b('form')).toHaveClass('h-8', 'text-body');
  });

  it('DS-18.6: each action has one icon and a word; opening inside Lookout and leaving it have different icons; the shortcuts that run one show its icon in the Keyboard shortcuts dialog', async () => {
    const ids = Object.keys(ACTIONS) as ActionId[];
    for (const id of ids) expect(ACTIONS[id].word, id).not.toBe('');
    expect(ACTIONS.open.icon).not.toBe(ACTIONS['open-external'].icon);
    expect(ACTIONS.review.icon).not.toBe(ACTIONS.start.icon);
    const user = userEvent.setup();
    const app = renderApp('/');
    app.snapshot([row({ id: 'a' })]);
    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    const dialog = await screen.findByRole('dialog', { name: /Keyboard shortcuts/ });
    expect(dialog.querySelector('[data-shortcut="panel-review"] [data-action-icon]')).toHaveAttribute('data-action-icon', 'review');
    expect(dialog.querySelector('[data-shortcut="panel-add"] [data-action-icon]')).toHaveAttribute('data-action-icon', 'add-to-topic');
    expect(dialog.querySelector('[data-shortcut="move"] [data-action-icon]')).toBeNull();
  });
});
