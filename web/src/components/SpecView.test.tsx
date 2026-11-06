import type { PlainAnswer } from '@shared/plain.ts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaveError } from '@/lib/client';
import { parseRoute, routePath } from '@/lib/router';
import { renderApp, row } from '@/test/helpers';
import { JUST_CHANGED_MS, SPEC_POLL_MS, STRIP_PX } from './SpecView';

const CHECKOUT = '0123456789abcdef';
const SRC = { kind: 'session', session: 'a', checkout: CHECKOUT } as const;
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
    source: { kind: 'session', session: 'a', checkout: CHECKOUT },
    checkout: { id: CHECKOUT, repo: 'shop', where: 'feature/rates' },
    baseName: 'Branch point',
    fetchError: null,
    path: 'plain/rates.plain',
    text: TEXT,
    baseText: BASE,
    base: 'abc1234',
    concepts: {
      Deal: { module: 'plain/api', lines: ['- :Deal: is a sales opportunity.', '  - It has a pipeline.'], baseLines: ['- :Deal: is an opportunity.', '  - It has a pipeline.'] },
    },
    missing: ['providers/exporter/exporter-public'],
    specs: {},
    abilities: {},
    catalogue: false,
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
/** PLAIN-10.1: the header's view switch. */
const viewSwitch = () => screen.getByRole('radiogroup', { name: 'View' });
const choose = (name: 'Changes' | 'Whole' | 'Clean') => act(() => within(viewSwitch()).getByRole('radio', { name }).click());
const chosen = () => within(viewSwitch()).getByRole('radio', { checked: true }).textContent;
const clause = (text: string) => within(module()).getByText((_, el) => el?.tagName === 'LI' && (el.textContent ?? '').replace(/^(added|removed|changed) /, '').startsWith(text));

afterEach(() => vi.useRealTimers());

describe('the Spec view', () => {
  it('PLAIN-1.1: a Module of a Checkout has its own URL, and reading it names the Session, the Checkout id and the path', async () => {
    const route = { name: 'plain' as const, session: 'a', checkout: CHECKOUT, path: 'plain/rates.plain' };
    expect(routePath(route)).toBe(URL);
    expect(parseRoute(URL)).toEqual(route);
    expect(parseRoute('/plain/a/not-an-id/x.plain')).toEqual({ name: 'home' });
    const { readPlain } = open();
    await screen.findByText('Rate cards on a Deal.');
    expect(readPlain).toHaveBeenCalledWith(SRC, 'plain/rates.plain', true);
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
    const nav = screen.getByRole('navigation', { name: 'On this page' });
    const links = within(nav).getAllByRole('link').map((a) => a.textContent);
    expect(links.slice(0, 4)).toEqual(['Changes', 'Definitions1~', 'Implementation reqs1~', 'Functional specs2~']);
    expect(within(nav).getByRole('link', { name: /^Definitions/ })).toHaveAttribute('data-touched');
  });

  it("PLAIN-1.4: a Concept of the Module links to its definition, a predefined one is marked so, and § links to its spec", async () => {
    open();
    await screen.findByText('Rate cards on a Deal.');
    choose('Whole');
    const own = within(module()).getAllByRole('link', { name: 'RateCard' })[0]!;
    expect(own).toHaveAttribute('href', '#plain-def-RateCard');
    expect(within(module()).getByText('ConformanceTests')).toHaveAttribute('title', 'Predefined by plain');
    expect(within(clause('A Deal shows its')).getByRole('link', { name: '§1.2' })).toHaveAttribute('href', '#plain-s-1-2');
    expect(within(module()).getByRole('button', { name: 'Deal' })).toHaveAttribute('data-term', 'other');
  });

  it('PLAIN-1.6: changed clauses are marked in place and counted in the Changes card; which show, and whether marked, is the view switch\'s', async () => {
    open();
    await screen.findByText('Rate cards on a Deal.');
    choose('Whole');
    const card = screen.getByRole('region', { name: 'Changes' });
    expect(within(card).getByText(/against abc1234/)).toBeInTheDocument();
    expect(card.querySelector('[data-field="spec-tally"]')).toHaveTextContent('1 added1 changed1 removed');
    expect(within(card).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Definitions−1', 'Implementation requirements~1', '§1.2A rate can be edited inline+1']);

    expect(clause('A rate can be deleted')).toHaveAttribute('data-state', 'added');
    const rewritten = clause('Prices are kept in');
    expect(rewritten).toHaveAttribute('data-state', 'changed');
    expect(rewritten.querySelector('ins')).toHaveTextContent('cents, never as floats.');
    expect(rewritten.querySelector('del')).toHaveTextContent('cents.');
    expect(module().querySelector('[data-state="removed"]')).toHaveTextContent('Rate');

    // No checkbox chooses what shows any more: the switch does.
    expect(screen.queryByRole('checkbox', { name: 'Only what changed' })).toBeNull();
    expect(within(card).queryByRole('checkbox')).toBeNull();
    choose('Changes');
    expect(within(module()).queryByText(/A Deal shows its/)).toBeNull();
    expect(clause('A rate can be deleted')).toBeInTheDocument();
    choose('Clean');
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
    await screen.findByRole('region', { name: 'Not in a section' });
    choose('Whole');
    expect(screen.getByRole('region', { name: 'Not in a section' })).toHaveTextContent('a stray line');
  });
});

describe("other Modules' Concepts", () => {
  it('PLAIN-2.2, 2.3: hovering or focusing a Concept from another Module shows its definition, its Module, and its change in this branch', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText('Rate cards on a Deal.');
    choose('Whole');
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
    choose('Whole');
    await user.hover(within(module()).getByRole('button', { name: 'Deal' }));
    const openApi = within(await screen.findByRole('dialog', { name: /^Deal/ })).getByRole('link', { name: 'Open api' });
    expect(openApi).toHaveAttribute('href', `/plain/a/${CHECKOUT}/${encodeURIComponent('plain/api.plain')}`);
    await user.click(openApi);
    expect(window.location.pathname).toBe(`/plain/a/${CHECKOUT}/${encodeURIComponent('plain/api.plain')}`);
    await waitFor(() => expect(readPlain).toHaveBeenLastCalledWith(SRC, 'plain/api.plain', true));
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
    const box = () => document.querySelector<HTMLElement>('[data-slot="spec-module"]')!.closest('[data-slot="pane-scroll"]') as HTMLElement;
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
    expect(setPlainViewed).toHaveBeenLastCalledWith(SRC, 'plain/rates.plain', 'k'.repeat(64), true);
    expect(box).toBeChecked();
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('v');
    expect(setPlainViewed).toHaveBeenLastCalledWith(SRC, 'plain/rates.plain', 'k'.repeat(64), false);
    await waitFor(() => expect(box).not.toBeChecked());
  });

  it('PLAIN-4.3: a Module that changed since it was Viewed says so', async () => {
    open({ changedSinceViewed: true });
    expect(await screen.findByText('Changed since you viewed it')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Viewed' })).not.toBeChecked();
  });
});

/**
 * jsdom has no layout: the view's scroll box is at 0, and each element named in `tops` (by its id,
 * or its Mark's cursor) sits that far down its content; scrollTo is recorded and moves the box.
 */
function fakeLayout(tops: Record<string, number>) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const scrolled = document.querySelector<HTMLElement>('[data-slot="pane-scroll"]')?.scrollTop ?? 0;
    const key = this.getAttribute('data-mark') ?? this.id;
    const top = key in tops ? tops[key]! - scrolled : 0;
    return { top, bottom: top + 20, left: 0, right: 0, width: 0, height: 20, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
  const scrollTo = vi.fn(function (this: HTMLElement, o: ScrollToOptions) {
    this.scrollTop = o.top ?? 0;
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
  return { scrollTo };
}

const CHANGES = { c0: 300, c1: 500, c2: 900 };

describe('reading and stepping through a change', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
  });

  it("PLAIN-8.1: the text is one column of the chat's width, centred with the outline on its right, and a long code span wraps", async () => {
    open();
    await screen.findByText('Rate cards on a Deal.');
    expect(document.querySelector('[data-slot="spec-layout"]')).toHaveClass('@min-[640px]:grid-cols-[minmax(0,1fr)_minmax(0,48rem)_minmax(15rem,1fr)]');
    expect(module()).toHaveClass('@min-[640px]:col-start-2', '[overflow-wrap:anywhere]');
    expect(screen.getByRole('navigation', { name: 'On this page' })).toHaveClass('@min-[640px]:col-start-3');
  });

  it('PLAIN-8.2: "On this page" lists the sections and the changed specs, every spec on request, and marks where you are', async () => {
    const user = userEvent.setup();
    fakeLayout({ changes: 0, 'plain-definitions': 200, 'plain-implementation-reqs': 400, 'plain-functional-specs': 600, 'plain-s-1-1': 650, 'plain-s-1-2': 800 });
    open();
    await screen.findByText('Rate cards on a Deal.');
    choose('Whole');
    const nav = screen.getByRole('navigation', { name: 'On this page' });
    const specLinks = () => within(nav).getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('#plain-s-'));
    expect(specLinks().map((a) => a.textContent)).toEqual(['§1.2A rate can be edited inline~']);
    await user.click(within(nav).getByRole('button', { name: 'Show all 2 specs' }));
    expect(specLinks().map((a) => a.textContent)).toEqual(['§1.1A Deal shows its RateCard as a table, as §1', '§1.2A rate can be edited inline~']);

    const box = module().closest<HTMLElement>('[data-slot="pane-scroll"]')!;
    box.scrollTop = 660;
    box.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(within(nav).getByRole('link', { current: 'location' })).toHaveAttribute('href', '#plain-s-1-1'));
    // Listed no more, the spec at the top marks its section.
    await user.click(within(nav).getByRole('button', { name: 'Show changed specs only' }));
    await waitFor(() => expect(within(nav).getByRole('link', { current: 'location' })).toHaveAttribute('href', '#plain-functional-specs'));
    box.scrollTop = 210;
    box.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(within(nav).getByRole('link', { current: 'location' })).toHaveAttribute('href', '#plain-definitions'));
  });

  it('PLAIN-8.2: a Module with no change lists every spec', async () => {
    open({ text: BASE });
    await screen.findByText('Rate cards on a Deal.');
    const nav = screen.getByRole('navigation', { name: 'On this page' });
    expect(within(nav).getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('#plain-s-'))).toHaveLength(2);
    expect(within(nav).queryByRole('button', { name: /^Show all/ })).toBeNull();
  });

  it('PLAIN-8.3: a changed clause has a bar in its colour, its state for screen readers only; a changed spec counts its changes', async () => {
    open();
    await screen.findByText('Rate cards on a Deal.');
    const added = clause('A rate can be deleted');
    expect(added.querySelector('[data-change]')).toHaveAttribute('data-change', 'added');
    expect(added.querySelector('[data-change]')).toHaveClass('before:bg-diff-added-text');
    expect(within(added).getByText('added')).toHaveClass('sr-only');
    expect(added.querySelector('.bg-diff-added-soft')).toBeNull();
    expect(clause('Prices are kept in').querySelector('[data-change]')).toHaveClass('before:bg-muted-foreground');
    expect(module().querySelector('[data-state="removed"] [data-change]')).toHaveClass('before:bg-diff-removed-text');
    const spec = within(module()).getByRole('article', { name: '§1.2' });
    expect(spec).not.toHaveClass('border');
    expect(spec.querySelector('[data-field="spec-counts"]')).toHaveTextContent('+1');
  });

  it('PLAIN-8.4: the Changes card has one row per spec, its clauses, tests and notes counted together', async () => {
    open({ text: TEXT.replace('- A rate can be deleted by :Mystery:.', '- A rate can be deleted by :Mystery:.\n> Parity: as the old app.') });
    await screen.findByText('Rate cards on a Deal.');
    const card = screen.getByRole('region', { name: 'Changes' });
    const rows = within(card).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toBe('§1.2A rate can be edited inline+2· notes');
  });

  it('PLAIN-8.5: each change is a Mark on the rail, in order, named by its kind, place and first line; a click jumps there and focuses it', async () => {
    const user = userEvent.setup();
    const { scrollTo } = fakeLayout(CHANGES);
    open();
    await screen.findByText('Rate cards on a Deal.');
    const rail = screen.getByRole('navigation', { name: 'Changes' });
    await waitFor(() => expect(within(rail).getAllByRole('button')).toHaveLength(3));
    expect(within(rail).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Removed in Definitions: Rate is one price.',
      'Rewritten in Implementation requirements: Prices are kept in cents, never as floats',
      'Added in §1.2: A rate can be deleted by Mystery',
    ]);
    await user.click(within(rail).getByRole('button', { name: /^Added/ }));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 888 - STRIP_PX, behavior: 'smooth' });
    expect(document.activeElement).toHaveAttribute('data-mark', 'c2');
    expect(document.querySelector('[data-field="spec-at"]')).toHaveTextContent('3 of 3');
    choose('Clean');
    expect(screen.queryByRole('navigation', { name: 'Changes' })).toBeNull();
    expect(document.querySelector('[data-field="spec-stepper"]')).toBeNull();
  });

  it('PLAIN-8.5: a change gone on a later read takes its Mark with it; the description is a change when rewritten, added or removed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fakeLayout({ c0: 100, c1: 300, c2: 500, c3: 900 });
    const rewritten = answer({ text: TEXT.replace('description: Rate cards on a Deal.', 'description: Rate cards on a Deal, per currency.') });
    const readPlain = vi.fn(async () => rewritten);
    renderApp(URL, { readPlain }).snapshot([row({ id: 'a', title: 'fix-deal-rates' })]);
    await screen.findByText('per currency.', { exact: false });
    const description = document.querySelector<HTMLElement>('[data-field="spec-description"]')!;
    await waitFor(() => expect(description).toHaveAttribute('data-change', 'changed'));
    await waitFor(() => expect(description).toHaveAttribute('data-mark', 'c0'));
    readPlain.mockImplementation(async () => answer());
    await act(async () => vi.advanceTimersByTimeAsync(SPEC_POLL_MS));
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Changes' })).getAllByRole('button')).toHaveLength(3));
    expect(document.querySelector('[data-field="spec-description"]')).not.toHaveAttribute('data-mark');
    expect(document.querySelectorAll('[data-mark="c0"]')).toHaveLength(1);
  });

  it('PLAIN-8.5: a new Module\'s description is added, a deleted one\'s removed', async () => {
    const fresh = open({ baseText: null });
    await screen.findByText('Rate cards on a Deal.');
    expect(document.querySelector('[data-field="spec-description"]')).toHaveAttribute('data-change', 'added');
    fresh.app.unmount();
    open({ text: null });
    await screen.findByText('This Module was deleted since the Branch point.');
    expect(document.querySelector('[data-field="spec-description"]')).toHaveAttribute('data-change', 'removed');
  });

  it('PLAIN-8.5: after a jump from the rail, the arrow keys scroll the view rather than switching Sessions', async () => {
    const user = userEvent.setup();
    fakeLayout(CHANGES);
    const readPlain = vi.fn(async () => answer());
    renderApp(URL, { readPlain }).snapshot([row({ id: 'a', title: 'fix-deal-rates' }), row({ id: 'b', title: 'other' })]);
    await screen.findByText('Rate cards on a Deal.');
    const rail = screen.getByRole('navigation', { name: 'Changes' });
    await waitFor(() => expect(within(rail).getAllByRole('button')).toHaveLength(3));
    await user.click(within(rail).getByRole('button', { name: /^Added/ }));
    expect(document.activeElement).toHaveAttribute('data-mark', 'c2');
    await user.keyboard('{ArrowDown}');
    expect(window.location.pathname).toBe(URL);
  });

  it('PLAIN-8.6: [ and ] step through the changes, as in the chat; the header says where you are and holds the view switch', async () => {
    const user = userEvent.setup();
    const { scrollTo } = fakeLayout(CHANGES);
    open();
    await screen.findByText('Rate cards on a Deal.');
    const at = () => document.querySelector('[data-field="spec-at"]');
    await waitFor(() => expect(at()).toHaveTextContent('3 changes'));
    fireEvent.keyDown(document.body, { key: ']' });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 288 - STRIP_PX, behavior: 'smooth' });
    expect(at()).toHaveTextContent('1 of 3');
    fireEvent.keyDown(document.body, { key: ']' });
    expect(at()).toHaveTextContent('2 of 3');
    fireEvent.keyDown(document.body, { key: '[' });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 288 - STRIP_PX, behavior: 'smooth' });
    await user.click(screen.getByRole('button', { name: 'Next change' }));
    expect(at()).toHaveTextContent('2 of 3');
    // ⌘[ is the browser's Back, not a step.
    fireEvent.keyDown(document.body, { key: ']', metaKey: true });
    expect(at()).toHaveTextContent('2 of 3');

    expect(screen.getByRole('button', { name: 'Back to fix-deal-rates' }).parentElement).toContainElement(viewSwitch());
    expect(within(screen.getByRole('region', { name: 'Changes' })).queryByRole('radiogroup')).toBeNull();
    choose('Whole');
    expect(clause('A Deal shows its')).toBeInTheDocument();
  });

  it('PLAIN-8.6: the hold on a change survives Space pressing Next at the bottom, and goes with an outline link or Back', async () => {
    const user = userEvent.setup();
    const { scrollTo } = fakeLayout({ ...CHANGES, 'plain-definitions': 200 });
    // The view can't scroll past 400: the last two changes land at the same position.
    scrollTo.mockImplementation(function (this: HTMLElement, o: ScrollToOptions) {
      this.scrollTop = Math.min(o.top ?? 0, 400);
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value(this: HTMLElement) {
        const box = document.querySelector<HTMLElement>('[data-slot="pane-scroll"]')!;
        box.scrollTop = this.id === 'plain-definitions' ? 200 : 0;
      },
    });
    open();
    await screen.findByText('Rate cards on a Deal.');
    const at = () => document.querySelector('[data-field="spec-at"]');
    await waitFor(() => expect(at()).toHaveTextContent('3 changes'));
    for (let i = 0; i < 3; i++) fireEvent.keyDown(document.body, { key: ']' });
    expect(at()).toHaveTextContent('3 of 3');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Next change' }), { key: ' ' });
    fireEvent.keyDown(document.body, { key: '[' });
    expect(at()).toHaveTextContent('2 of 3');

    await user.click(within(screen.getByRole('navigation', { name: 'On this page' })).getByRole('link', { name: /^Definitions/ }));
    fireEvent.keyDown(document.body, { key: ']' });
    expect(at()).toHaveTextContent('1 of 3');
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('PLAIN-8.5, 8.6: a deleted description is a change; a read that renumbers the changes lets go of the hold; Space on a link scrolls', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fakeLayout({ c0: 100, c1: 300, c2: 500, c3: 900 });
    const emptied = answer({ text: TEXT.replace('description: Rate cards on a Deal.\n', '') });
    const readPlain = vi.fn(async () => emptied);
    renderApp(URL, { readPlain }).snapshot([row({ id: 'a', title: 'fix-deal-rates' })]);
    await waitFor(() => expect(document.querySelector('[data-field="spec-description"]')).toHaveAttribute('data-change', 'changed'));
    const at = () => document.querySelector('[data-field="spec-at"]');
    await waitFor(() => expect(at()).toHaveTextContent('4 changes'));
    fireEvent.keyDown(document.body, { key: ']' });
    fireEvent.keyDown(document.body, { key: ']' });
    expect(at()).toHaveTextContent('2 of 4');
    // The description comes back: every change after it moves up one cursor.
    readPlain.mockImplementation(async () => answer());
    await act(async () => vi.advanceTimersByTimeAsync(SPEC_POLL_MS));
    await waitFor(() => expect(at()).not.toHaveTextContent('of 4'));
    fireEvent.keyDown(document.body, { key: ']' });
    expect(at()).toHaveTextContent('of 3');

    fireEvent.keyDown(document.body, { key: ']' });
    const held = at()!.textContent;
    fireEvent.keyDown(within(screen.getByRole('navigation', { name: 'On this page' })).getAllByRole('link')[0]!, { key: ' ', shiftKey: true });
    const box = module().closest<HTMLElement>('[data-slot="pane-scroll"]')!;
    box.scrollTop = 0;
    box.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(at()!.textContent).not.toBe(held));
  });

  it("PLAIN-8.6: [ and ] don't step while a Concept's card is open", async () => {
    const user = userEvent.setup();
    fakeLayout(CHANGES);
    open();
    await screen.findByText('Rate cards on a Deal.');
    choose('Whole');
    await user.hover(within(module()).getByRole('button', { name: 'Deal' }));
    await screen.findByRole('dialog');
    fireEvent.keyDown(document.body, { key: ']' });
    expect(document.querySelector('[data-field="spec-at"]')).toHaveTextContent('3 changes');
  });

  it('PLAIN-10.7: in a header narrower than 40rem, Back and Viewed show their arrow and box alone (PLAIN-8.6) and the name gives way; the switch and the count stay', async () => {
    fakeLayout(CHANGES);
    open();
    await screen.findByText('Rate cards on a Deal.');
    expect(screen.getByRole('button', { name: 'Back to fix-deal-rates' }).querySelector('span')).toHaveClass('@max-[40rem]/header:sr-only');
    const viewed = screen.getByRole('checkbox', { name: 'Viewed' }).closest('label')!;
    expect(viewed).toHaveAttribute('title', 'Viewed (V)');
    expect(within(viewed).getByText('Viewed')).toHaveClass('@max-[40rem]/header:sr-only');
    // The name truncates from its end: its `.plain` goes first, then its letters.
    const name = screen.getByRole('heading', { level: 1 });
    expect(name).toHaveClass('min-w-0', 'flex-1', 'truncate');
    expect(name.lastElementChild).toHaveTextContent('.plain');
    for (const radio of within(viewSwitch()).getAllByRole('radio')) expect(radio.className).not.toMatch(/sr-only|hidden/);
    expect(viewSwitch()).toHaveClass('shrink-0');
    await waitFor(() => expect(document.querySelector('[data-field="spec-at"]')).toHaveTextContent('3 changes'));
    expect(document.querySelector('[data-field="spec-stepper"]')).toHaveClass('shrink-0');
    expect(document.querySelector('[data-field="spec-at"]')!.className).not.toMatch(/sr-only|hidden/);
  });
});

// PLAIN-9: §1.1 with a nested clause, an unchanged note and acceptance tests; §1.2 gains a note.
const BASE_9 = BASE.replace(
  '- A Deal shows its :RateCard: as a table, as §1.2 says.\n',
  '- A Deal shows its :RateCard: as a table, as §1.2 says.\n  - Each row is a `rate_id`.\n\n> Parity: as the old app.\n\n***acceptance tests***\n\n- A Deal with two rates shows two rows.\n',
);
const TEXT_9 = BASE_9.replace('- Prices are kept in cents.', '- Prices are kept in cents, never as floats.')
  .replace('  - Each row is a `rate_id`.\n', '  - Each row is a `rate_id`.\n  - Each row can be deleted.\n')
  .replace('- A Deal with two rates shows two rows.\n', '- A Deal with two rates shows two rows.\n- A Deal with no rates shows "No rates".\n')
  .replace('- A rate can be edited inline.', '- A rate can be edited inline.\n\n> Parity: inline, as in Ember.');

const spec9 = (id: string) => within(module()).getByRole('article', { name: id });

describe('reading a Module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('PLAIN-9.1: the Module reads in `reading`, at most 42rem wide; its notes and code spans are `prose`', async () => {
    open({ text: TEXT_9, baseText: BASE_9 });
    await screen.findByText('Rate cards on a Deal.');
    choose('Whole');
    expect(module()).toHaveClass('max-w-[42rem]');
    expect(screen.getByText('Rate cards on a Deal.').closest('p')).toHaveClass('text-reading');
    expect(clause('A Deal shows its').closest('ul')).toHaveClass('text-reading');
    expect(clause('Each row can be deleted').closest('ul')).toHaveClass('text-reading');
    expect(within(module()).getByText('RateCard', { selector: 'dt' })).toHaveClass('text-reading');
    expect(within(module()).getByText('rate_id', { selector: 'code' })).toHaveClass('text-prose');
    expect(within(spec9('§1.2')).getByText('Parity: inline, as in Ember.').closest('[data-slot="spec-notes"]')).toHaveClass('text-prose');
  });

  it('PLAIN-9.2: a spec opens with its gist as a `reading-title` heading, its change under it and its id hanging in the margin', async () => {
    open({ text: TEXT_9, baseText: BASE_9 });
    await screen.findByText('Rate cards on a Deal.');
    const heading = within(spec9('§1.1')).getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent(/^A Deal shows its RateCard as a table, as §1$/);
    expect(heading).toHaveClass('text-reading-title');
    expect(heading).not.toHaveClass('truncate');
    const id = spec9('§1.1').querySelector('[data-field="spec-id"]')!;
    expect(id).toHaveTextContent('§1.1');
    expect(id).toHaveClass('font-mono', 'text-meta', '@min-[73rem]:absolute', '@min-[73rem]:right-full');
    expect(spec9('§1.2').querySelector('[data-spec-head] [data-field="spec-counts"]')).toHaveTextContent('+1');
  });

  it('PLAIN-9.3: a strip names the spec the view is inside once its heading has scrolled away, takes no room, and leads back to it', async () => {
    const user = userEvent.setup();
    let headBottom = -50;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      const box = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
      if (el.dataset.specId === '§1.1') return box(-100, 400);
      if (el.dataset.specId === '§1.2') return box(400, 600);
      if (el.hasAttribute('data-spec-head') && el.closest('[data-spec-id="§1.1"]')) return box(-100, headBottom);
      return box(0, 20);
    });
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    open({ text: TEXT_9, baseText: BASE_9 });
    await screen.findByText('Rate cards on a Deal.');
    const strip = document.querySelector('[data-slot="spec-strip"]')!;
    expect(strip).toHaveClass('sticky', 'top-0', 'h-0');
    const box = module().closest<HTMLElement>('[data-slot="pane-scroll"]')!;
    box.dispatchEvent(new Event('scroll'));
    const link = await within(strip as HTMLElement).findByRole('link');
    expect(link).toHaveTextContent('§1.1A Deal shows its RateCard as a table, as §1+2');
    await user.click(link);
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(spec9('§1.1'));
    // Its heading back in sight, the strip goes.
    headBottom = 30;
    box.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(within(strip as HTMLElement).queryByRole('link')).toBeNull());
    // What the view scrolls into sight, a link's target or a focused element, lands below the strip.
    expect(box).toHaveClass('scroll-pt-9');
  });

  it('PLAIN-9.3: a spec that lands below the strip is where you are in "On this page"', async () => {
    fakeLayout({ 'plain-functional-specs': 600, 'plain-s-1-1': 650, 'plain-s-1-2': 800 });
    open({ text: TEXT_9, baseText: BASE_9 });
    await screen.findByText('Rate cards on a Deal.');
    const nav = screen.getByRole('navigation', { name: 'On this page' });
    const box = module().closest<HTMLElement>('[data-slot="pane-scroll"]')!;
    box.scrollTop = 800 - STRIP_PX;
    box.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(within(nav).getByRole('link', { current: 'location' })).toHaveAttribute('href', '#plain-s-1-2'));
  });

  it('PLAIN-9.4: a spec\'s acceptance tests follow its clauses in a box headed "Acceptance tests"', async () => {
    open({ text: TEXT_9, baseText: BASE_9 });
    await screen.findByText('Rate cards on a Deal.');
    choose('Whole');
    const tests = within(spec9('§1.1')).getByRole('region', { name: 'Acceptance tests' });
    expect(tests).toHaveClass('rounded-md', 'border');
    expect(within(tests).getByRole('heading', { level: 4 })).toHaveTextContent('Acceptance tests');
    expect(tests).toHaveTextContent('A Deal with two rates shows two rows.');
    expect(clause('A Deal shows its').compareDocumentPosition(tests) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const notes = within(spec9('§1.1')).getByRole('button', { name: /^Notes/ });
    expect(tests.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('PLAIN-9.5: a spec\'s notes are behind a button, closed when unchanged, open when one changed, then as you leave them', async () => {
    const user = userEvent.setup();
    open({ text: TEXT_9, baseText: BASE_9 });
    await screen.findByText('Rate cards on a Deal.');
    choose('Whole');
    const same = within(spec9('§1.1')).getByRole('button', { name: 'Notes 1' });
    expect(same).toHaveAttribute('aria-expanded', 'false');
    expect(within(module()).queryByText('Parity: as the old app.')).toBeNull();
    await user.click(same);
    expect(same).toHaveAttribute('aria-expanded', 'true');
    expect(within(module()).getByText('Parity: as the old app.')).toBeInTheDocument();
    const changed = within(spec9('§1.2')).getByRole('button', { name: 'Notes 1' });
    expect(changed).toHaveAttribute('aria-expanded', 'true');
    expect(within(module()).getByText('Parity: inline, as in Ember.')).toBeInTheDocument();
    // The changed note is a Mark while it shows, and none while it's folded away.
    const rail = screen.getByRole('navigation', { name: 'Changes' });
    await waitFor(() => expect(within(rail).getAllByRole('button')).toHaveLength(4));
    await user.click(changed);
    expect(within(module()).queryByText('Parity: inline, as in Ember.')).toBeNull();
    await waitFor(() => expect(within(rail).getAllByRole('button')).toHaveLength(3));
    await user.click(changed);
    await waitFor(() => expect(within(rail).getAllByRole('button')).toHaveLength(4));
    expect(within(module()).getByText('Parity: inline, as in Ember.').closest('[data-change]')).toHaveAttribute('data-mark');
    await user.click(changed);
    // In Changes, a spec none of whose notes changed has no button: its notes fold into a line.
    choose('Changes');
    expect(within(spec9('§1.1')).queryByRole('button', { name: /^Notes/ })).toBeNull();
    expect(within(spec9('§1.1')).getByRole('button', { name: '1 unchanged note' })).toBeInTheDocument();
    expect(within(spec9('§1.2')).getByRole('button', { name: /^Notes/ })).toBeInTheDocument();
  });

  it('PLAIN-9.6: every change bar in the Module sits in one gutter, whatever its depth; a Concept card keeps its own', async () => {
    const user = userEvent.setup();
    open({ text: TEXT_9, baseText: BASE_9 });
    await screen.findByText('Rate cards on a Deal.');
    choose('Whole');
    const bar = (text: string) => clause(text).querySelector<HTMLElement>(':scope > [data-change]')!;
    // A bulleted clause's text sits its list's inset plus one indent in, the gutter 0.75rem left of the Module's edge.
    expect(bar('Prices are kept in')).toHaveClass('before:left-(--bar-x)');
    expect(bar('Prices are kept in').style.getPropertyValue('--bar-x')).toBe('-2rem');
    expect(bar('Each row can be deleted').style.getPropertyValue('--bar-x')).toBe('-3.25rem');
    expect(bar('A Deal with no rates').style.getPropertyValue('--bar-x')).toBe('-2.8125rem');
    // A note and a definition have no bullet: their bar is 0.75rem left of their own edge, which is the Module's.
    expect(within(spec9('§1.2')).getByText('Parity: inline, as in Ember.').closest('[data-change]')).toHaveClass('before:-left-3');
    await user.hover(within(module()).getAllByRole('button', { name: 'Deal' })[0]!);
    const card = await screen.findByRole('dialog', { name: 'Deal, defined in api' });
    for (const el of card.querySelectorAll<HTMLElement>('[data-change]')) expect(el.style.getPropertyValue('--bar-x')).toBe('');
  });
});

// PLAIN-10: a Module notes, lines in no section, an untouched section, and §1.3 changed among four specs.
const BASE_10 = `---
description: Rate cards on a Deal.
---

> A note on the Module.

a stray line

***definitions***

- :RateCard: is a list of prices.

- :Rate: is one price.

***test reqs***

- Tests run against a seeded Deal.

- Each test cleans up its rates.

***functional specs***

> spec: §1.1

- A Deal shows its :RateCard:.

> spec: §1.2

- A rate can be edited inline.

> spec: §1.3

- A rate can be copied.
  - The copy keeps its currency.
  - The copy keeps its amount, as a :Rate: does, and as §1.1 and §1.4 say.

> Parity: as the old app.

***acceptance tests***

- Copying a rate adds a row.

- Copying twice adds two rows.

> spec: §1.4

- A rate can be archived.
`;
const TEXT_10 = BASE_10.replace('keeps its amount, as a', 'keeps its amount, rounded, as a');

const fold = (name: string) => within(module()).getByRole('button', { name });

describe('one view switch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('PLAIN-10.1: the header has one switch, a Segmented named View, Changes · Whole · Clean with their longer wording, after the stepper; Viewed is last, after a divider', async () => {
    fakeLayout(CHANGES);
    open();
    await screen.findByText('Rate cards on a Deal.');
    const radios = within(viewSwitch()).getAllByRole('radio');
    expect(radios.map((r) => [r.textContent, r.getAttribute('title')])).toEqual([
      ['Changes', 'Only what changed, marked'],
      ['Whole', 'The whole Module, its changes marked'],
      ['Clean', 'The Module as it reads after the change, unmarked'],
    ]);
    expect(viewSwitch()).toHaveAttribute('data-slot', 'segmented');
    expect(screen.queryAllByRole('checkbox').map((c) => c.getAttribute('aria-label') ?? c.closest('label')?.textContent)).toEqual(['Viewed']);
    await waitFor(() => expect(document.querySelector('[data-field="spec-stepper"]')).not.toBeNull());
    const header = viewSwitch().parentElement!;
    const order = [document.querySelector('[data-field="spec-stepper"]')!, viewSwitch(), header.querySelector('[data-slot="button-divider"]')!, screen.getByRole('checkbox', { name: 'Viewed' }).closest('label')!];
    for (const el of order) expect(el.parentElement).toBe(header);
    expect(order.map((el) => [...header.children].indexOf(el))).toEqual([...order.map((el) => [...header.children].indexOf(el))].sort((a, b) => a - b));
    expect(header.lastElementChild).toBe(order[3]);
    expect(header.querySelector('[data-slot="button-divider"]')).toHaveClass('h-4', 'w-px', 'bg-border', '-mx-2');
  });

  it('PLAIN-10.2: a Module with a change opens on Changes; the view chosen holds through reads and is kept with the history entry, so Back returns in it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const readPlain = vi.fn(async () => answer());
    renderApp(URL, { readPlain }).snapshot([row({ id: 'a', title: 'fix-deal-rates' })]);
    await screen.findByText('Rate cards on a Deal.');
    expect(chosen()).toBe('Changes');
    choose('Whole');
    readPlain.mockImplementation(async () => answer({ text: TEXT.replace('- A rate can be edited inline.', '- A rate can be edited inline.\n- A rate can be copied.') }));
    await act(async () => vi.advanceTimersByTimeAsync(SPEC_POLL_MS));
    expect(clause('A rate can be copied')).toBeInTheDocument();
    expect(chosen()).toBe('Whole');
    // Another Module, opened from a link, opens on Changes.
    await user.click(within(document.querySelector<HTMLElement>('[data-field="spec-imports"]')!).getByRole('link', { name: 'productive' }));
    await waitFor(() => expect(window.location.pathname).toContain('productive'));
    await screen.findByText('Rate cards on a Deal.');
    expect(chosen()).toBe('Changes');
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe(URL));
    await screen.findByText('Rate cards on a Deal.');
    expect(chosen()).toBe('Whole');
  });

  it('PLAIN-10.2: Back and Forward between two entries of the same Module move to the view each was left in', async () => {
    open();
    await screen.findByText('Rate cards on a Deal.');
    choose('Clean');
    act(() => window.history.pushState(null, '', URL));
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(chosen()).toBe('Changes');
    choose('Whole');
    act(() => window.history.back());
    await waitFor(() => expect(chosen()).toBe('Clean'));
  });

  it('PLAIN-10.3: a Module with no change, or whose text differs where nothing is marked, opens on Clean with no switch; a new one shows every clause added in Changes and Whole', async () => {
    const same = open({ text: BASE, baseText: BASE });
    await screen.findByText('Rate cards on a Deal.');
    expect(screen.queryByRole('radiogroup', { name: 'View' })).toBeNull();
    expect(document.querySelector('[data-slot="spec-layout"]')).toHaveAttribute('data-view', 'clean');
    expect(document.querySelector('[data-field="spec-text-only"]')).toBeNull();
    same.app.unmount();

    const spaced = open({ text: BASE.replace('***definitions***', '***definitions***\n'), baseText: BASE });
    await screen.findByText('Rate cards on a Deal.');
    expect(screen.queryByRole('radiogroup', { name: 'View' })).toBeNull();
    expect(document.querySelector('[data-field="spec-text-only"]')).toHaveTextContent('Its text differs from the base, but no clause, note or definition does.');
    spaced.app.unmount();

    open({ text: TEXT_10, baseText: null });
    await screen.findByText('Rate cards on a Deal.');
    expect(chosen()).toBe('Changes');
    // The Module's notes and its lines in no section are all new too: nothing folds.
    expect(module()).toHaveTextContent('A note on the Module.');
    expect(screen.getByRole('region', { name: 'Not in a section' })).toHaveTextContent('a stray line');
    const states = () => [...module().querySelectorAll('[data-state]')].map((el) => el.getAttribute('data-state'));
    const inChanges = states();
    expect(within(module()).queryAllByRole('button').filter((b) => b.dataset.slot === 'spec-fold')).toEqual([]);
    choose('Whole');
    expect(states()).toEqual(inChanges);
    expect(new Set(inChanges)).toEqual(new Set(['added']));
  });

  it('PLAIN-10.3: a deleted Module opens on Changes, its Clean disabled with why', async () => {
    open({ text: null });
    await screen.findByText('This Module was deleted since the Branch point.');
    expect(chosen()).toBe('Changes');
    const clean = within(viewSwitch()).getByRole('radio', { name: 'Clean' });
    expect(clean).toHaveAttribute('aria-disabled', 'true');
    expect(clean).toHaveAttribute('title', 'Deleted in this branch');
    choose('Clean');
    expect(chosen()).toBe('Changes');
  });

  it('PLAIN-10.3: a first change arriving by a read shows the switch on Clean; a read that takes the last away makes the view Clean and the switch goes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const readPlain = vi.fn(async () => answer({ text: BASE, baseText: BASE }));
    renderApp(URL, { readPlain }).snapshot([row({ id: 'a' })]);
    await screen.findByText('Rate cards on a Deal.');
    expect(screen.queryByRole('radiogroup', { name: 'View' })).toBeNull();
    readPlain.mockImplementation(async () => answer());
    await act(async () => vi.advanceTimersByTimeAsync(SPEC_POLL_MS));
    expect(chosen()).toBe('Clean');
    choose('Whole');
    readPlain.mockImplementation(async () => answer({ text: BASE, baseText: BASE }));
    await act(async () => vi.advanceTimersByTimeAsync(SPEC_POLL_MS));
    expect(screen.queryByRole('radiogroup', { name: 'View' })).toBeNull();
    expect(document.querySelector('[data-slot="spec-layout"]')).toHaveAttribute('data-view', 'clean');
  });

  it('PLAIN-10.4: Clean reads as a Module with no change; "Changed since you viewed it" and a failed fetch still show', async () => {
    fakeLayout(CHANGES);
    open({ changedSinceViewed: true, fetchError: 'git fetch failed' });
    await screen.findByText('Rate cards on a Deal.');
    choose('Clean');
    expect(module().querySelector('[data-change]')).toBeNull();
    expect(module().querySelector('ins, del')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Changes' })).toBeNull();
    expect(document.querySelector('[data-field="spec-stepper"]')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Changes' })).toBeNull();
    expect(within(module()).queryByText('Rate', { selector: 'dt' })).toBeNull();
    expect(clause('Prices are kept in')).toHaveTextContent(/^Prices are kept in cents, never as floats\.$/);
    expect(module().querySelector('[data-field="spec-counts"]')).toBeNull();
    const nav = screen.getByRole('navigation', { name: 'On this page' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Definitions1', 'Implementation reqs1', 'Functional specs2', '§1.1A Deal shows its RateCard as a table, as §1', '§1.2A rate can be edited inline']);
    expect(within(nav).queryByRole('button')).toBeNull();
    expect(screen.getByText('Changed since you viewed it')).toBeInTheDocument();
    expect(document.querySelector('[data-field="spec-fetch-error"]')).toBeInTheDocument();
  });

  it('PLAIN-10.5: Changes shows each change with what holds it, and folds the rest into quiet lines at every level that say what they hold', async () => {
    open({ text: TEXT_10, baseText: BASE_10 });
    await screen.findByText('Rate cards on a Deal.');
    expect(chosen()).toBe('Changes');
    const lines = [...module().querySelectorAll<HTMLElement>('[data-slot="spec-fold"]')];
    expect(lines.map((l) => l.textContent)).toEqual([
      '1 note on the Module',
      '2 unchanged definitions',
      '2 unchanged clauses',
      '2 unchanged specs, §1.1 to §1.2',
      '1 unchanged clause',
      '2 unchanged acceptance tests',
      '1 unchanged note',
      '1 unchanged spec, §1.4',
      '1 line',
    ]);
    for (const line of lines) {
      expect(line).toHaveClass('text-meta', 'text-muted-foreground');
      expect(line.querySelector('svg')).toHaveClass('lucide-chevron-right');
      expect(line.closest('[data-change]')).toBeNull();
      expect(line).not.toHaveAttribute('data-mark');
    }
    // An untouched section keeps its heading, its line under it.
    expect(within(screen.getByRole('region', { name: 'Test requirements' })).getByRole('heading', { level: 2 })).toHaveTextContent('Test requirements2');
    // A changed clause shows with its unchanged parent; a changed spec with its heading.
    expect(clause('A rate can be copied')).toHaveAttribute('data-state', 'same');
    expect(clause('The copy keeps its amount')).toHaveAttribute('data-state', 'changed');
    expect(within(spec9('§1.3')).getByRole('heading', { level: 3 })).toHaveTextContent('A rate can be copied');
    expect(within(spec9('§1.3')).queryByRole('region', { name: 'Acceptance tests' })).toBeNull();
    // "On this page" lists the sections and the changed specs, as Whole does, each landing on a heading.
    const nav = screen.getByRole('navigation', { name: 'On this page' });
    expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['#changes', '#plain-definitions', '#plain-test-reqs', '#plain-functional-specs', '#plain-s-1-3']);
    for (const a of within(nav).getAllByRole('link')) expect(document.getElementById(a.getAttribute('href')!.slice(1))).not.toBeNull();
    expect(within(nav).queryByRole('button')).toBeNull();
  });

  it('PLAIN-10.6: a line shows its whole run in place, focus on it; it stays through reads and Whole, until a read changes it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const readPlain = vi.fn(async () => answer({ text: TEXT_10, baseText: BASE_10 }));
    renderApp(URL, { readPlain }).snapshot([row({ id: 'a' })]);
    await screen.findByText('Rate cards on a Deal.');
    await user.click(fold('2 unchanged specs, §1.1 to §1.2'));
    expect(spec9('§1.1')).toHaveFocus();
    expect(spec9('§1.2')).toBeInTheDocument();
    // Enter on a line opens it too; a run opened shows whole, nothing folded inside it.
    fold('2 unchanged acceptance tests').focus();
    await user.keyboard('{Enter}');
    const tests = within(spec9('§1.3')).getByRole('region', { name: 'Acceptance tests' });
    expect(tests).toHaveFocus();
    expect(tests).toHaveTextContent('Copying twice adds two rows.');
    // A read that changes something else keeps both runs open.
    readPlain.mockImplementation(async () => answer({ text: TEXT_10.replace('description: Rate cards on a Deal.', 'description: Rate cards on a Deal, per currency.'), baseText: BASE_10 }));
    await act(async () => vi.advanceTimersByTimeAsync(SPEC_POLL_MS));
    await screen.findByText('per currency.', { exact: false });
    expect(spec9('§1.1')).toBeInTheDocument();
    expect(within(spec9('§1.3')).getByRole('region', { name: 'Acceptance tests' })).toBeInTheDocument();
    choose('Whole');
    choose('Changes');
    expect(spec9('§1.2')).toBeInTheDocument();
    // A read that changes §1.2 breaks the run: what's left of it folds again.
    readPlain.mockImplementation(async () => answer({ text: TEXT_10.replace('- A rate can be edited inline.', '- A rate can be edited inline, or in a dialog.').replace('description: Rate cards on a Deal.', 'description: Rate cards on a Deal, per currency.'), baseText: BASE_10 }));
    await act(async () => vi.advanceTimersByTimeAsync(SPEC_POLL_MS));
    expect(fold('1 unchanged spec, §1.1')).toBeInTheDocument();
    expect(within(module()).getByRole('region', { name: 'Acceptance tests' })).toBeInTheDocument();
  });

  it('PLAIN-10.6: a link to something folded shows its run first and lands on it: a §, a Concept\'s own definition, "Go to" in a card', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    open({ text: TEXT_10, baseText: BASE_10 });
    await screen.findByText('Rate cards on a Deal.');
    const amount = () => clause('The copy keeps its amount');
    await user.click(within(amount()).getByRole('link', { name: '§1.1' }));
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(spec9('§1.1'));
    expect(within(module()).queryByRole('button', { name: /^2 unchanged specs/ })).toBeNull();
    await user.click(within(amount()).getByRole('link', { name: 'Rate' }));
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(document.getElementById('plain-def-Rate'));
    expect(within(module()).queryByRole('button', { name: '2 unchanged definitions' })).toBeNull();
    await user.hover(within(amount()).getByRole('link', { name: '§1.4' }));
    const card = await screen.findByRole('dialog', { name: /^§1\.4/ });
    await user.click(within(card).getByRole('link', { name: 'Go to §1.4' }));
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(spec9('§1.4'));
    expect(within(module()).queryByRole('button', { name: /unchanged spec, §1\.4/ })).toBeNull();
  });

  it('PLAIN-10.6: a Module opened at a spec Changes folds shows it first and lands on it', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    const readPlain = vi.fn(async () => answer({ text: TEXT_10, baseText: BASE_10 }));
    renderApp(`${URL}#plain-s-1-1`, { readPlain }).snapshot([row({ id: 'a' })]);
    await screen.findByText('Rate cards on a Deal.');
    await waitFor(() => expect(scrollIntoView.mock.contexts.at(-1)).toBe(spec9('§1.1')));
  });

  it('PLAIN-10.8: the switch is one Tab stop and ←/→ choose; it has no key of its own', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText('Rate cards on a Deal.');
    const radios = within(viewSwitch()).getAllByRole('radio');
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    act(() => radios[0]!.focus());
    await user.keyboard('{ArrowRight}');
    expect(chosen()).toBe('Whole');
    expect(radios[1]).toHaveFocus();
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(chosen()).toBe('Clean');
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('c123');
    expect(chosen()).toBe('Clean');
  });
});
