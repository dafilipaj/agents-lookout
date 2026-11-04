import type { PlainAnswer } from '@shared/plain.ts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaveError } from '@/lib/client';
import { parseRoute, routePath } from '@/lib/router';
import { renderApp, row } from '@/test/helpers';
import { JUST_CHANGED_MS, SPEC_POLL_MS } from './SpecView';

const CHECKOUT = '0123456789abcdef';
const URL = `/plain/a/${CHECKOUT}/${encodeURIComponent('plain/rates.plain')}`;

const BASE = `---
description: Rate cards on a Deal.
import:
  - productive
  - providers/exporter/exporter-public
---

***definitions***

- :RateCard: is a list of prices for a :Deal:, checked by :ConformanceTests:.

- :Rate: is one price.

***implementation reqs***

- Prices are kept in cents.

***functional specs***

> spec: §1.1

- A Deal shows its :RateCard: as a table, as §1.2 says.

> spec: §1.2

- A rate can be edited inline.
`;
const TEXT = BASE.replace('- Prices are kept in cents.', '- Prices are kept in cents, never as floats.')
  .replace('- :Rate: is one price.\n', '')
  .replace('- A rate can be edited inline.', '- A rate can be edited inline.\n- A rate can be deleted by :Mystery:.');

function answer(over: Partial<PlainAnswer> = {}): PlainAnswer {
  return {
    sessionId: 'a',
    checkout: { id: CHECKOUT, repo: 'shop', where: 'feature/rates' },
    path: 'plain/rates.plain',
    text: TEXT,
    baseText: BASE,
    base: 'abc1234',
    concepts: {
      Deal: { module: 'plain/api', lines: ['- :Deal: is a sales opportunity.', '  - It has a pipeline.'], baseLines: ['- :Deal: is an opportunity.', '  - It has a pipeline.'] },
    },
    missing: ['providers/exporter/exporter-public'],
    key: 'k'.repeat(64),
    viewed: false,
    changedSinceViewed: false,
    ...over,
  };
}

function open(over: Partial<PlainAnswer> = {}, options: Parameters<typeof renderApp>[1] = {}) {
  const readPlain = vi.fn(async () => answer(over));
  const app = renderApp(URL, { readPlain, ...options });
  app.snapshot([row({ id: 'a', title: 'fix-deal-rates' })]);
  return { app, readPlain, view: () => screen.getByRole('region', { name: /^Spec / }) };
}

const module = () => document.querySelector<HTMLElement>('[data-slot="spec-module"]')!;
const clause = (text: string) => within(module()).getByText((_, el) => el?.tagName === 'LI' && (el.textContent ?? '').replace(/^(added|removed|changed)/, '').startsWith(text));

afterEach(() => vi.useRealTimers());

describe('the Spec view', () => {
  it('PLAIN-1.1: a Module of a Checkout has its own URL, and reading it names the Session, the Checkout id and the path', async () => {
    const route = { name: 'plain' as const, session: 'a', checkout: CHECKOUT, path: 'plain/rates.plain' };
    expect(routePath(route)).toBe(URL);
    expect(parseRoute(URL)).toEqual(route);
    expect(parseRoute('/plain/a/not-an-id/x.plain')).toEqual({ name: 'home' });
    const { readPlain } = open();
    await screen.findByText('Rate cards on a Deal.');
    expect(readPlain).toHaveBeenCalledWith('a', CHECKOUT, 'plain/rates.plain');
  });

  it("PLAIN-1.2: the header names the Module, its path, its Checkout and description, and links its imports", async () => {
    open();
    await screen.findByText('Rate cards on a Deal.');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('rates.plain');
    expect(document.querySelector('[data-field="spec-where"]')).toHaveTextContent('plain/rates.plain · shop · feature/rates');
    const imports = document.querySelector<HTMLElement>('[data-field="spec-imports"]')!;
    // A real link, so ⌘-click opens it in a new browser tab (PLAIN-1.1).
    expect(within(imports).getByRole('link', { name: 'productive' })).toHaveAttribute('href', `/plain/a/${CHECKOUT}/${encodeURIComponent('plain/productive.plain')}`);
    // A Module that isn't in the Checkout is named, not linked (PLAIN-2.4).
    expect(within(imports).queryByRole('link', { name: 'providers/exporter/exporter-public' })).toBeNull();
    expect(imports).toHaveTextContent('providers/exporter/exporter-public');
  });

  it('PLAIN-1.3: sections in page order, each in the nav with its count, the touched ones marked', async () => {
    open();
    await screen.findByText('Rate cards on a Deal.');
    const sections = within(module()).getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(sections).toEqual(['Changes', 'Definitions', 'Implementation requirements', 'Functional specs']);
    const nav = screen.getByRole('navigation', { name: 'Module' });
    const links = within(nav).getAllByRole('link').map((a) => a.textContent);
    expect(links.slice(0, 4)).toEqual(['Changes', 'Definitions1', 'Implementation reqs1', 'Functional specs2']);
    expect(within(nav).getByRole('link', { name: /^Definitions/ })).toHaveAttribute('data-touched');
  });

  it("PLAIN-1.4: a Concept of the Module links to its definition, a predefined one is marked so, and § links to its spec", async () => {
    open();
    await screen.findByText('Rate cards on a Deal.');
    const own = within(module()).getAllByRole('link', { name: 'RateCard' })[0]!;
    expect(own).toHaveAttribute('href', '#plain-def-RateCard');
    expect(within(module()).getByText('ConformanceTests')).toHaveAttribute('title', 'Predefined by plain');
    expect(within(clause('A Deal shows its')).getByRole('link', { name: '§1.2' })).toHaveAttribute('href', '#plain-s-1-2');
    expect(within(module()).getByRole('button', { name: 'Deal' })).toHaveAttribute('data-term', 'other');
  });

  it('PLAIN-1.6: changed clauses are marked in place, counted in the Changes card, and "Only what changed" hides the rest', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText('Rate cards on a Deal.');
    const card = screen.getByRole('region', { name: 'Changes' });
    expect(within(card).getByText(/against abc1234/)).toBeInTheDocument();
    expect(card.querySelector('[data-field="spec-tally"]')).toHaveTextContent('1 added1 changed1 removed');
    expect(within(card).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['definitions1 removed', 'implementation reqs1 changed', '§1.21 added']);

    expect(clause('A rate can be deleted')).toHaveAttribute('data-state', 'added');
    const rewritten = clause('Prices are kept in');
    expect(rewritten).toHaveAttribute('data-state', 'changed');
    expect(rewritten.querySelector('ins')).toHaveTextContent('cents, never as floats.');
    expect(rewritten.querySelector('del')).toHaveTextContent('cents.');
    expect(module().querySelector('[data-state="removed"]')).toHaveTextContent('Rate');

    await user.click(screen.getByRole('checkbox', { name: 'Only what changed' }));
    expect(within(module()).queryByText(/A Deal shows its/)).toBeNull();
    expect(clause('A rate can be deleted')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Only what changed' }));
    await user.click(screen.getByRole('checkbox', { name: 'Highlight changes' }));
    expect(module().querySelector('[data-state="removed"]')).toBeNull();
    expect(module().querySelector('ins')).toBeNull();
  });

  it('PLAIN-1.5: a deleted Module shows its base, a new one says so, and an unchanged one has no Changes card', async () => {
    const gone = open({ text: null });
    expect(await screen.findByText('This Module was deleted since the Branch point.')).toBeInTheDocument();
    expect(module().querySelectorAll('[data-state="removed"]').length).toBeGreaterThan(3);
    gone.app.unmount();

    const added = open({ baseText: null });
    expect(await screen.findByText('New since the Branch point.')).toBeInTheDocument();
    added.app.unmount();

    open({ baseText: TEXT });
    await screen.findByText('Rate cards on a Deal.');
    expect(screen.queryByRole('region', { name: 'Changes' })).toBeNull();
    expect(module().querySelector('[data-state]:not([data-state="same"])')).toBeNull();
  });

  it('PLAIN-1.7: an open Module is read again every 3 s; a change updates it in place and marks the new clauses for a moment', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const readPlain = vi.fn(async () => answer());
    renderApp(URL, { readPlain }).snapshot([row({ id: 'a', title: 'fix-deal-rates' })]);
    await screen.findByText('Rate cards on a Deal.');
    expect(readPlain).toHaveBeenCalledTimes(1);
    readPlain.mockImplementation(async () => answer({ text: TEXT.replace('- A rate can be edited inline.', '- A rate can be edited inline.\n- A rate can be copied.') }));
    await act(async () => vi.advanceTimersByTimeAsync(SPEC_POLL_MS));
    expect(readPlain).toHaveBeenCalledTimes(2);
    const fresh = clause('A rate can be copied');
    expect(fresh).toHaveAttribute('data-just-changed');
    expect(clause('A rate can be deleted')).not.toHaveAttribute('data-just-changed');
    await act(async () => vi.advanceTimersByTimeAsync(JUST_CHANGED_MS));
    expect(clause('A rate can be copied')).not.toHaveAttribute('data-just-changed');
  });

  it('PLAIN-6.2: a Module\'s text is shown as text: markup in it is never rendered', async () => {
    open({ text: TEXT.replace('- Prices are kept in cents, never as floats.', '- Prices <img src=x onerror="alert(1)"> are <b>bold</b>.'), baseText: null });
    await screen.findByText('Rate cards on a Deal.');
    expect(module().querySelector('img, b')).toBeNull();
    expect(module()).toHaveTextContent('Prices <img src=x onerror="alert(1)"> are <b>bold</b>.');
  });

  it("PLAIN-1.8: a Module that can't be read says why", async () => {
    renderApp(URL, { readPlain: async () => Promise.reject(new Error('plain/rates.plain is larger than 1 MB.')) }).snapshot([row({ id: 'a' })]);
    expect(await screen.findByText('plain/rates.plain is larger than 1 MB.')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="spec-module"]')).toBeNull();
  });

  it('PLAIN-1.8: a Module the server refuses on a later read shows no content any more; a lost connection keeps it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const readPlain = vi.fn(async (): Promise<PlainAnswer> => answer());
    renderApp(URL, { readPlain }).snapshot([row({ id: 'a' })]);
    await screen.findByText('Rate cards on a Deal.');
    readPlain.mockImplementation(async () => Promise.reject(new SaveError("Couldn't reach the Lookout server.", null, null, { lost: true })));
    await act(async () => vi.advanceTimersByTimeAsync(SPEC_POLL_MS));
    expect(screen.getByText("Couldn't reach the Lookout server.")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="spec-module"]')).not.toBeNull();
    readPlain.mockImplementation(async () => Promise.reject(new SaveError('plain/rates.plain is larger than 1 MB.', null, 413)));
    await act(async () => vi.advanceTimersByTimeAsync(SPEC_POLL_MS));
    expect(screen.getByText('plain/rates.plain is larger than 1 MB.')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="spec-module"]')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Viewed' })).toBeDisabled();
  });

  it('PLAIN-1.7: a read that only changes which Modules are missing still updates the view', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const readPlain = vi.fn(async (): Promise<PlainAnswer> => answer());
    renderApp(URL, { readPlain }).snapshot([row({ id: 'a' })]);
    await screen.findByText('Rate cards on a Deal.');
    const imports = () => document.querySelector<HTMLElement>('[data-field="spec-imports"]')!;
    expect(within(imports()).queryByRole('link', { name: 'providers/exporter/exporter-public' })).toBeNull();
    readPlain.mockImplementation(async () => answer({ missing: [] }));
    await act(async () => vi.advanceTimersByTimeAsync(SPEC_POLL_MS));
    expect(within(imports()).getByRole('link', { name: 'providers/exporter/exporter-public' })).toBeInTheDocument();
  });

  it('PLAIN-1.8: a section that holds only notes is still shown', async () => {
    open({ text: '---\ndescription: Notes only.\n---\n***definitions***\n> Rationale for the definitions.\n', baseText: null });
    expect(await screen.findByRole('region', { name: 'Definitions' })).toHaveTextContent('Rationale for the definitions.');
    expect(screen.queryByText('This Module is empty.')).toBeNull();
  });

  it('PLAIN-1.8: text outside every section shows under "Not in a section"', async () => {
    open({ text: `${TEXT.replace('***definitions***', 'a stray line\n\n***definitions***')}`, baseText: null });
    expect(await screen.findByRole('region', { name: 'Not in a section' })).toHaveTextContent('a stray line');
  });
});

describe("other Modules' Concepts", () => {
  it('PLAIN-2.2, 2.3: hovering or focusing a Concept from another Module shows its definition, its Module, and its change in this branch', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText('Rate cards on a Deal.');
    const term = within(module()).getByRole('button', { name: 'Deal' });
    await user.hover(term);
    const card = await screen.findByRole('dialog', { name: 'Deal, defined in api' });
    expect(card).toHaveTextContent('Defined in plain/api');
    expect(card).toHaveTextContent('Changed in this branch');
    expect(card.querySelector('ins')).toHaveTextContent('a sales');
    expect(card.querySelector('del')).toHaveTextContent('an');
    expect(within(card).getByText('It has a pipeline.')).toBeInTheDocument();
    await user.unhover(term);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Deal/ })).toBeNull());

    act(() => term.focus());
    expect(await screen.findByRole('dialog', { name: 'Deal, defined in api' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Deal/ })).toBeNull());
    expect(term).toHaveFocus();
  });

  it("PLAIN-2.4: a Concept found in no Module names the Modules that aren't there, or says it's defined nowhere", async () => {
    const user = userEvent.setup();
    const first = open();
    await screen.findByText('Rate cards on a Deal.');
    await user.hover(within(module()).getByRole('button', { name: 'Mystery' }));
    expect(await screen.findByRole('dialog', { name: /^Mystery/ })).toHaveTextContent("it may be defined in `providers/exporter/exporter-public`, which isn't in this Checkout");
    first.app.unmount();

    open({ missing: [] });
    await screen.findByText('Rate cards on a Deal.');
    await user.hover(within(module()).getByRole('button', { name: 'Mystery' }));
    expect(await screen.findByRole('dialog', { name: /^Mystery/ })).toHaveTextContent('Not defined in any Module this one reads.');
  });

  it("PLAIN-2.5: \"Open <module>\" and the header's imports open that Module in the same Checkout, as a new history entry", async () => {
    const user = userEvent.setup();
    const { readPlain } = open();
    await screen.findByText('Rate cards on a Deal.');
    await user.hover(within(module()).getByRole('button', { name: 'Deal' }));
    const openApi = within(await screen.findByRole('dialog', { name: /^Deal/ })).getByRole('link', { name: 'Open api' });
    expect(openApi).toHaveAttribute('href', `/plain/a/${CHECKOUT}/${encodeURIComponent('plain/api.plain')}`);
    await user.click(openApi);
    expect(window.location.pathname).toBe(`/plain/a/${CHECKOUT}/${encodeURIComponent('plain/api.plain')}`);
    await waitFor(() => expect(readPlain).toHaveBeenLastCalledWith('a', CHECKOUT, 'plain/api.plain'));
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe(URL));

    await screen.findByText('Rate cards on a Deal.');
    await user.click(within(document.querySelector<HTMLElement>('[data-field="spec-imports"]')!).getByRole('link', { name: 'productive' }));
    expect(window.location.pathname).toBe(`/plain/a/${CHECKOUT}/${encodeURIComponent('plain/productive.plain')}`);
  });
});

describe('scroll and saves', () => {
  it('PLAIN-2.5: Back returns each visit of a Module to the scroll position it was left at', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText('Rate cards on a Deal.');
    const box = () => document.querySelector<HTMLElement>('[data-slot="spec-module"]')!.closest('[data-shell-row="body"]') as HTMLElement;
    box().scrollTop = 640;
    box().dispatchEvent(new Event('scroll'));
    await user.click(within(document.querySelector<HTMLElement>('[data-field="spec-imports"]')!).getByRole('link', { name: 'productive' }));
    await waitFor(() => expect(window.location.pathname).toContain('productive'));
    act(() => window.history.back());
    await screen.findByText('Rate cards on a Deal.');
    await waitFor(() => expect(box().scrollTop).toBe(640));
    // A second visit of the same Module is its own entry: its position doesn't overwrite the first's.
    await user.click(within(document.querySelector<HTMLElement>('[data-field="spec-imports"]')!).getByRole('link', { name: 'productive' }));
    await waitFor(() => expect(window.location.pathname).toContain('productive'));
    act(() => window.history.pushState(null, '', URL));
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await screen.findByText('Rate cards on a Deal.');
    expect(box().scrollTop).not.toBe(640);
    box().scrollTop = 900;
    box().dispatchEvent(new Event('scroll'));
    act(() => window.history.go(-2));
    await waitFor(() => expect(window.location.pathname).toBe(URL));
    await screen.findByText('Rate cards on a Deal.');
    await waitFor(() => expect(box().scrollTop).toBe(640));
  });

  it('PLAIN-4.1: a Viewed save that ends after a read brought a newer text leaves the newer answer as it is', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let finish!: () => void;
    const setPlainViewed = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const readPlain = vi.fn(async (): Promise<PlainAnswer> => answer());
    renderApp(URL, { readPlain, setPlainViewed }).snapshot([row({ id: 'a' })]);
    await screen.findByText('Rate cards on a Deal.');
    await act(async () => screen.getByRole('checkbox', { name: 'Viewed' }).click());
    readPlain.mockImplementation(async () => answer({ text: TEXT.replace('A rate can be deleted', 'A rate can be removed'), key: 'n'.repeat(64) }));
    await act(async () => vi.advanceTimersByTimeAsync(SPEC_POLL_MS));
    expect(clause('A rate can be removed')).toBeInTheDocument();
    await act(async () => finish());
    expect(clause('A rate can be removed')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Viewed' })).not.toBeChecked();
  });
});

describe('back and Viewed', () => {
  it("PLAIN-3.2: \"Back to <Session>\" returns to that Session's view", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Back to fix-deal-rates' }));
    expect(window.location.pathname).toBe('/s/a');
  });

  it('PLAIN-4.1: opening a Module leaves Viewed clear; the box and V tick and clear it for the text that was read', async () => {
    const user = userEvent.setup();
    const setPlainViewed = vi.fn(async () => {});
    open({}, { setPlainViewed });
    await screen.findByText('Rate cards on a Deal.');
    const box = screen.getByRole('checkbox', { name: 'Viewed' });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(setPlainViewed).toHaveBeenLastCalledWith('a', CHECKOUT, 'plain/rates.plain', 'k'.repeat(64), true);
    expect(box).toBeChecked();
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('v');
    expect(setPlainViewed).toHaveBeenLastCalledWith('a', CHECKOUT, 'plain/rates.plain', 'k'.repeat(64), false);
    await waitFor(() => expect(box).not.toBeChecked());
  });

  it('PLAIN-4.3: a Module that changed since it was Viewed says so', async () => {
    open({ changedSinceViewed: true });
    expect(await screen.findByText('Changed since you viewed it')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Viewed' })).not.toBeChecked();
  });
});
