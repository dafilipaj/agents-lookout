import type { PlainAnswer, PlainExample, PlainExamples, PlainExamplesAnswer, PlainSimple, PlainSimpleAnswer, PlainSimpleBlock } from '@shared/plain.ts';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaveError } from '@/lib/client';
import { parseRoute, routePath } from '@/lib/router';
import { fakeResizeObserver, movePointer, renderApp, row } from '@/test/helpers';
import { cropRegion } from '@/lib/plain-shots';
import css from '@/index.css?raw';
import { contrast, paint, solid, themeTokens, type Mode } from '@/test/contrast';
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
  it('PLAIN-2.2, PLAIN-2.3: hovering or focusing a Concept from another Module shows its definition, its Module, and its change in this branch', async () => {
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

  it('PLAIN-8.5, PLAIN-8.6: a deleted description is a change; a read that renumbers the changes lets go of the hold; Space on a link scrolls', async () => {
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

const EXAMPLE_KEY = 'e'.repeat(64);
function kept(over: Partial<PlainExample> = {}, more: Partial<PlainExamples> = {}): PlainExamplesAnswer {
  return {
    examples: {
      key: EXAMPLE_KEY,
      writtenAt: Date.now() - 2 * 60 * 60 * 1000,
      model: 'claude-sonnet-5-5',
      costUsd: 0.04,
      rowsChecked: 2,
      rowsTotal: 2,
      groups: [
        {
          spec: '§1.2',
          example: 'You open Acme\'s rate card and delete a rate; it leaves the table.',
          refused: null,
          shows: null,
          frames: [
            { name: `${'a'.repeat(40)}.jpg`, test: '§1.2 a rate can be deleted', caption: 'The rate card with two rates' },
            { name: `${'b'.repeat(40)}.jpg`, test: '§1.2 a rate can be deleted', caption: 'The rate is gone' },
          ],
          tests: [{ title: '§1.2 a rate can be deleted', file: 'e2e/rates.spec.ts', line: 12, problem: null }],
          ported: true,
          mentionedIn: [],
          rows: [
            { doc: 'knowledge/port/rates.md', line: 7, capability: 'Delete a rate', answer: 'keep', source: 'rates.gts:40', parity: null, verdict: 'covered', missing: null },
            { doc: 'knowledge/port/rates.md', line: 8, capability: 'Undo a deleted rate', answer: 'keep', source: 'undo.ts:3', parity: '⚠️ partial', verdict: 'partly', missing: 'It says nothing of Undo.' },
          ],
          outOfDate: false,
          ...over,
        },
      ],
      ...more,
    },
    running: null,
    error: null,
  };
}

describe('each change beside what it does (PLAIN-11, 12)', () => {
  const card = () => document.querySelector<HTMLElement>('[data-slot="spec-example"]');

  it('PLAIN-11.1: the Changes card offers "Show examples"; nothing makes them on its own; a press starts them for this Module', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { app } = open();
    const show = await screen.findByRole('button', { name: 'Show examples' });
    await act(async () => vi.advanceTimersByTime(SPEC_POLL_MS * 2));
    expect(app.client.startPlainExamples).not.toHaveBeenCalled();
    await act(async () => show.click());
    expect(app.client.startPlainExamples).toHaveBeenCalledWith(SRC, 'plain/rates.plain');
    vi.useRealTimers();
  });

  it('PLAIN-11.1: a Module with examples offers "Show examples again"; one with no changed spec offers nothing', async () => {
    open({}, { plainExamples: async () => kept() });
    expect(await screen.findByRole('button', { name: 'Show examples again' })).toBeTruthy();
    cleanup();
    const { app } = open({ text: BASE });
    await waitFor(() => expect(module()).not.toBeNull());
    expect(screen.queryByRole('button', { name: /Show examples/ })).toBeNull();
    expect(app.client.plainExamples).not.toHaveBeenCalled();
  });

  it("PLAIN-11.9: in Changes and Whole a changed spec's card sits between its heading and its clauses: picture, example, tests, who wrote it; Clean has none; a card is no change", async () => {
    open({}, { plainExamples: async () => kept() });
    await waitFor(() => expect(card()).not.toBeNull());
    const spec = card()!.closest('article')!;
    expect(spec.getAttribute('data-spec-id')).toBe('§1.2');
    expect(card()!.previousElementSibling!.matches('[data-spec-head]')).toBe(true);
    expect(within(card()!).getByText("You open Acme's rate card and delete a rate; it leaves the table.")).toBeTruthy();
    expect(within(card()!).getByRole('img', { name: 'The rate card with two rates' }).getAttribute('src')).toBe(`/api/plain/examples/frame?key=${EXAMPLE_KEY}&name=${'a'.repeat(40)}.jpg`);
    const testsLine = card()!.querySelector('[data-field="spec-example-tests"]')!;
    expect(testsLine.textContent).toBe('1 Playwright test: passed');
    expect(testsLine.getAttribute('title')).toBe('§1.2 a rate can be deleted · e2e/rates.spec.ts:12');
    expect(card()!.querySelector('[data-field="spec-example-by"]')!.textContent).toBe('Written by Claude from §1.2 and its test · Sonnet 5.5 · $0.04 · 2h ago');
    expect(card()!.querySelector('[data-change]')).toBeNull();
    choose('Whole');
    expect(card()).not.toBeNull();
    choose('Clean');
    expect(card()).toBeNull();
  });

  it('PLAIN-11.10: the picture opens the frames large, each with its caption and test; ←/→ step; Esc closes', async () => {
    const user = userEvent.setup();
    open({}, { plainExamples: async () => kept() });
    await waitFor(() => expect(card()).not.toBeNull());
    await user.click(within(card()!).getByRole('button', { name: "Show §1.2's pictures large" }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('§1.2 · The rate card with two rates')).toBeTruthy();
    expect(within(dialog).getByText('From the Playwright test “§1.2 a rate can be deleted” · 1 of 2')).toBeTruthy();
    await user.keyboard('{ArrowRight}');
    expect(within(screen.getByRole('dialog')).getByText('§1.2 · The rate is gone')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('PLAIN-11.10: a newer answer with fewer frames closes the dialog rather than breaking the view', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let state = kept();
    open({}, { plainExamples: async () => state });
    await waitFor(() => expect(card()).not.toBeNull());
    await user.click(within(card()!).getByRole('button', { name: "Show §1.2's pictures large" }));
    await user.keyboard('{ArrowRight}');
    expect(within(screen.getByRole('dialog')).getByText('§1.2 · The rate is gone')).toBeTruthy();
    state = kept({ frames: kept().examples!.groups[0]!.frames.slice(0, 1) });
    await act(async () => vi.advanceTimersByTime(SPEC_POLL_MS + 10));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(card()).not.toBeNull();
    // Closed for good: a later answer with the frame back doesn't open it again.
    state = kept();
    await act(async () => vi.advanceTimersByTime(SPEC_POLL_MS + 10));
    await waitFor(() => expect(document.querySelector('[data-field="spec-example-picture"]')).not.toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
    vi.useRealTimers();
  });

  it('PLAIN-11.17: a picture from a test that failed says what the change adds that it doesn\'t show yet, in the card and the dialog', async () => {
    const user = userEvent.setup();
    const [a, b] = kept().examples!.groups[0]!.frames;
    open({}, { plainExamples: async () => kept({ frames: [{ ...a!, failed: true, missing: 'the "Undo" link under the table' }, { ...b!, failed: true, missing: null }] }) });
    await waitFor(() => expect(card()).not.toBeNull());
    expect(card()!.querySelector('figcaption')!.textContent).toBe('The rate card with two ratesNot there yet: the "Undo" link under the table');
    await user.click(within(card()!).getByRole('button', { name: "Show §1.2's pictures large" }));
    expect(within(await screen.findByRole('dialog')).getByText('Not there yet: the "Undo" link under the table')).toBeTruthy();
    await user.keyboard('{ArrowRight}');
    expect(within(screen.getByRole('dialog')).getByText('Its test failed after this picture.')).toBeTruthy();
    cleanup();
    open({}, { plainExamples: async () => kept() });
    await waitFor(() => expect(card()).not.toBeNull());
    expect(document.querySelector('[data-field="spec-example-not-yet"]')).toBeNull();
  });

  it("PLAIN-11.9: a spec with acceptance tests points at them in place of an example; its tests are one line, failures counted", async () => {
    const withTests = TEXT.replace('- A rate can be deleted by :Mystery:.', '- A rate can be deleted by :Mystery:.\n\n***acceptance tests***\n\n- Deleting a rate removes its row.');
    const [t] = kept().examples!.groups[0]!.tests;
    open(
      { text: withTests },
      { plainExamples: async () => kept({ example: null, tests: [t!, { ...t!, title: '§1.2 a rate asks first', line: 30, problem: 'Its test failed: TimeoutError: locator.click' }] }) },
    );
    await waitFor(() => expect(card()).not.toBeNull());
    expect(within(card()!).getByText('Its acceptance tests, below, walk through it.')).toBeTruthy();
    expect(within(card()!).queryByText('Example')).toBeNull();
    expect(card()!.querySelector('[data-field="spec-example-by"]')).toBeNull();
    const line = card()!.querySelector('[data-field="spec-example-tests"]')!;
    expect(line.textContent).toBe('2 Playwright tests: 1 passed, 1 failed');
    expect(line.getAttribute('title')).toBe('§1.2 a rate can be deleted · e2e/rates.spec.ts:12\n§1.2 a rate asks first · e2e/rates.spec.ts:30 · Its test failed: TimeoutError: locator.click');
  });

  it("PLAIN-12.8: the old app from the spec's own notes, under \"From its notes\"; a spec no port doc covers says so", async () => {
    const withNotes = TEXT.replace('- A rate can be deleted by :Mystery:.', '- A rate can be deleted by :Mystery:.\n\n> Ember parity (rate-row.gts): the old app greys the button.\n\n> A note about pricing.');
    open({ text: withNotes }, { plainExamples: async () => kept({ ported: false, rows: [] }) });
    await waitFor(() => expect(card()).not.toBeNull());
    const old = card()!.querySelector<HTMLElement>('[data-field="spec-example-old-app"]')!;
    expect(within(old).getByText('No port doc covers §1.2')).toBeTruthy();
    expect(within(old).getByText('From its notes')).toBeTruthy();
    expect(old.querySelector('[data-field="spec-example-old-notes"]')!.textContent).toBe('From its notesEmber parity (rate-row.gts): the old app greys the button.');
    cleanup();
    open({}, { plainExamples: async () => kept({ ported: false, rows: [] }) });
    await waitFor(() => expect(card()).not.toBeNull());
    expect(card()!.querySelector('[data-field="spec-example-old-app"]')).toBeNull();
  });

  it("PLAIN-11.11, PLAIN-11.8, PLAIN-11.12: a refused example says why; a spec no test names says so; an out-of-date card says so", async () => {
    open({}, { plainExamples: async () => kept({ example: null, refused: "Claude's example quoted words the spec doesn't have, so it isn't shown.", frames: [], tests: [], outOfDate: true, shows: 'The tests show another Deal.' }) });
    await waitFor(() => expect(card()).not.toBeNull());
    expect(within(card()!).getByText("Claude's example quoted words the spec doesn't have, so it isn't shown.")).toBeTruthy();
    expect(within(card()!).getByText('No Playwright test names §1.2')).toBeTruthy();
    expect(within(card()!).getByText('Out of date')).toBeTruthy();
    expect(within(card()!).getByText('The tests show another Deal.')).toBeTruthy();
    expect(within(card()!).queryByRole('img')).toBeNull();
  });

  it("PLAIN-11.13: while this Module's run goes the card shows the wait with Cancel; another Module's run disables the press; a failure says why", async () => {
    const answers: PlainExamplesAnswer[] = [{ ...kept(), running: { module: 'plain/rates.plain', mine: true, phase: 'tests', tests: 2 } }];
    const { app } = open({}, { plainExamples: async () => answers[0]! });
    expect(await screen.findByText('Running 2 Playwright tests…')).toBeTruthy();
    await act(async () => screen.getByRole('button', { name: 'Cancel' }).click());
    expect(app.client.cancelPlainExamples).toHaveBeenCalled();
    cleanup();
    open({}, { plainExamples: async () => ({ examples: null, running: { module: 'plain/other.plain', mine: false, phase: 'writing', tests: 0 }, error: null }) });
    const show = await screen.findByRole('button', { name: 'Show examples' });
    expect((show as HTMLButtonElement).disabled).toBe(true);
    expect(show.getAttribute('title')).toBe('Examples for plain/other.plain are being made');
    cleanup();
    open({}, { plainExamples: async () => ({ examples: null, running: null, error: 'It reached the $0.50 limit and was stopped.' }) });
    expect(await screen.findByText('It reached the $0.50 limit and was stopped.')).toBeTruthy();
  });

  it("PLAIN-11.13: before the tests are found the wait says so, from the press on; a refused press's Alert goes when the run it met ends", async () => {
    open({}, { plainExamples: async () => ({ examples: null, running: { module: 'plain/rates.plain', mine: true, phase: 'tests', tests: 0 }, error: null }) });
    expect(await screen.findByText('Finding the Playwright tests…')).toBeTruthy();
    cleanup();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let state: PlainExamplesAnswer = { examples: null, running: null, error: null };
    let refuse!: (e: Error) => void;
    open({}, { plainExamples: async () => state, startPlainExamples: () => new Promise<void>((_, reject) => (refuse = reject)) });
    const show = await screen.findByRole('button', { name: 'Show examples' });
    await act(async () => show.click());
    expect(screen.getByText('Finding the Playwright tests…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show examples' })).toBeNull();
    state = { examples: null, running: { module: 'plain/other.plain', mine: false, phase: 'tests', tests: 0 }, error: null };
    await act(async () => refuse(new Error('Examples for plain/other.plain are being made.')));
    expect(await screen.findByText('Examples for plain/other.plain are being made.')).toBeTruthy();
    state = { examples: null, running: null, error: null };
    await act(async () => vi.advanceTimersByTime(SPEC_POLL_MS + 10));
    await waitFor(() => expect(screen.queryByText('Examples for plain/other.plain are being made.')).toBeNull());
    expect((screen.getByRole('button', { name: 'Show examples' }) as HTMLButtonElement).disabled).toBe(false);
    vi.useRealTimers();
  });

  it("PLAIN-11.15: a PR's Module has the press too, saying its tests run on this Mac; its wait first says it checks out the PR and gets its dependencies", async () => {
    const pr = { kind: 'pr' as const, repo: 'shop', number: 7 };
    const readPlain = vi.fn(async () => answer({ source: pr, checkout: { id: '0123456789abcdef', repo: 'shop', where: '#7' }, baseName: 'merge-base with develop' }));
    const startPlainExamples = vi.fn(async () => {});
    renderApp('/plain/pr/shop/7/plain%2Frates.plain', { readPlain, plainExamples: async () => ({ examples: null, running: null, error: null }), startPlainExamples });
    const show = await screen.findByRole('button', { name: 'Show examples' });
    expect(show.getAttribute('title')).toBe("Runs #7's Playwright tests that name each changed spec on this Mac, in a worktree of its head, and writes an example of each with Claude");
    await act(async () => show.click());
    expect(startPlainExamples).toHaveBeenCalledWith(pr, 'plain/rates.plain');
    for (const [phase, label] of [
      ['worktree', 'Checking out the PR…'],
      ['copying', "Copying the PR's dependencies…"],
      ['installing', "Installing the PR's dependencies…"],
    ] as const) {
      cleanup();
      renderApp('/plain/pr/shop/7/plain%2Frates.plain', { readPlain, plainExamples: async () => ({ examples: null, running: { module: 'plain/rates.plain', mine: true, phase, tests: 0 }, error: null }) });
      expect(await screen.findByText(label)).toBeTruthy();
    }
  });

  it("PLAIN-12.5: after a run the Changes card counts the verdicts, only the kinds it has, and the rows left unchecked", async () => {
    open({}, { plainExamples: async () => kept({}, { rowsChecked: 2, rowsTotal: 5 }) });
    expect(await screen.findByText('Port: 1 covered · 1 partly (2 of 5 rows checked)')).toBeTruthy();
    cleanup();
    open({}, { plainExamples: async () => kept({ rows: [] }) });
    await waitFor(() => expect(card()).not.toBeNull());
    expect(document.querySelector('[data-field="spec-port-tally"]')).toBeNull();
  });

  it("PLAIN-12.4: the old app's rows under the example, a verdict that needs you at full strength; the Changes card counts them; a spec mentioned in no row says where", async () => {
    open({}, { plainExamples: async () => kept() });
    await waitFor(() => expect(card()).not.toBeNull());
    const rows = card()!.querySelectorAll('[data-field="spec-example-row"]');
    expect([...rows].map((r) => [r.getAttribute('data-verdict'), r.getAttribute('title')])).toEqual([
      ['covered', 'knowledge/port/rates.md:7'],
      ['partly', 'knowledge/port/rates.md:8'],
    ]);
    expect(rows[0]!.querySelector('[data-field="spec-example-verdict"]')!.className).toContain('text-muted-foreground');
    expect(rows[1]!.querySelector('[data-field="spec-example-verdict"]')!.className).toContain('text-foreground');
    expect(within(rows[1] as HTMLElement).getByText('Missing: It says nothing of Undo.')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('keep · Parity: ⚠️ partial · undo.ts:3')).toBeTruthy();
    cleanup();
    open({}, { plainExamples: async () => kept({ rows: [], mentionedIn: ['knowledge/port/rates.md'] }) });
    await waitFor(() => expect(card()).not.toBeNull());
    expect(within(card()!).getByText('No port-doc row names §1.2; rates.md mentions it')).toBeTruthy();
    cleanup();
    open({}, { plainExamples: async () => kept({ rows: [], ported: false }) });
    await waitFor(() => expect(card()).not.toBeNull());
    expect(card()!.querySelector('[data-field="spec-example-old-app"]')).toBeNull();
  });
});

describe('proof shots and a storyboard (PLAIN-13)', () => {
  const card = () => document.querySelector<HTMLElement>('[data-slot="spec-example"]');
  const story = () => card()!.querySelector<HTMLElement>('[data-field="spec-story"]')!;
  const screen1440 = { w: 1440, h: 900 };
  const panels = (): Partial<PlainExample> => ({
    example: null,
    frames: [
      { name: `${'a'.repeat(40)}.jpg`, test: '§1.2 a rate can be deleted', caption: 'The rate card with two rates', box: { x: 0.4, y: 0.4, w: 0.1, h: 0.05 }, absent: false, screen: screen1440, steps: [], newTest: false },
      { name: `${'b'.repeat(40)}.jpg`, test: '§1.2 a rate can be deleted', caption: 'The rate is gone', box: { x: 0.3, y: 0.1, w: 0.4, h: 0.5 }, absent: true, screen: screen1440, steps: ['Press Delete', 'Pick Yes', 'Press Confirm', 'Press Escape', 'Open the page'], newTest: false },
      { name: `${'c'.repeat(40)}.jpg`, test: '§1.2 a deleted rate can be undone', caption: 'The dialog is closed', box: null, absent: true, screen: screen1440, steps: [], newTest: true },
    ],
  });

  it('PLAIN-13.5: the region a panel shows is its box with room around it, 16:10, centred where the screen allows', () => {
    const mid = cropRegion({ x: 0.45, y: 0.45, w: 0.05, h: 0.05 }, screen1440);
    expect(mid.w * 1440).toBeCloseTo(360);
    expect(mid.h * 900).toBeCloseTo(225);
    expect(mid.x + mid.w / 2).toBeCloseTo(0.475);
    const corner = cropRegion({ x: 0, y: 0, w: 0.02, h: 0.02 }, screen1440);
    expect([corner.x, corner.y]).toEqual([0, 0]);
    const big = cropRegion({ x: 0.1, y: 0.1, w: 0.9, h: 0.9 }, screen1440);
    expect(big).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    // A box 16:10 can't hold on a 4:3 or a portrait screen is kept whole.
    expect(cropRegion({ x: 0, y: 0, w: 1, h: 1 }, { w: 800, h: 600 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    const tall = cropRegion({ x: 0.1, y: 0.05, w: 0.8, h: 0.9 }, { w: 390, h: 844 });
    expect(tall.y).toBeCloseTo(0.05);
    expect(tall.y + tall.h).toBeCloseTo(0.95);
    expect([tall.x, tall.w]).toEqual([0, 1]);
  });

  it('PLAIN-13.6, 13.5: a pictured spec has its pictures for an example, as a storyboard: panels in order, cropped and ringed, the steps between them, "Next test" between tests; no written example', async () => {
    open({}, { plainExamples: async () => kept(panels()) });
    await waitFor(() => expect(card()?.querySelector('[data-field="spec-story"]') ?? null).not.toBeNull());
    const s = story();
    expect([...s.querySelectorAll('figcaption')].map((f) => f.textContent)).toEqual(['The rate card with two rates', 'The rate is gone', 'The dialog is closed']);
    const steps = [...s.querySelectorAll<HTMLElement>('[data-field="spec-story-step"]')];
    expect(steps.map((x) => x.textContent)).toEqual(['Press Delete, Pick Yes, Press Confirm, +2 more', 'Next test']);
    expect(steps[0]!.getAttribute('title')).toBe('Press Delete\nPick Yes\nPress Confirm\nPress Escape\nOpen the page');
    expect(steps[1]!.getAttribute('title')).toBe('§1.2 a deleted rate can be undone');
    const shots = [...s.querySelectorAll<HTMLElement>('[data-field="spec-shot"]')];
    expect(shots.map((x) => x.dataset.crop)).toEqual(['box', 'box', 'none']);
    // The first is cropped around its box and ringed; the absence rings where it searched, and says so.
    expect(shots[0]!.querySelector('[data-field="spec-shot-ring"]')).not.toBeNull();
    expect(shots[0]!.querySelector('img')!.style.width).not.toBe('');
    expect(shots[1]!.querySelector('[data-field="spec-shot-ring"]')).not.toBeNull();
    expect(within(shots[1]!).getByText('Not there')).toBeTruthy();
    expect(shots[2]!.querySelector('[data-field="spec-shot-ring"]')).toBeNull();
    // An absence that searched the whole page is the whole screen, and says so too.
    expect(within(shots[2]!).getByText('Not there')).toBeTruthy();
    expect(within(s).getByRole('img', { name: 'The rate card with two rates' }).getAttribute('src')).toBe(`/api/plain/examples/frame?key=${EXAMPLE_KEY}&name=${'a'.repeat(40)}.jpg`);
    // PLAIN-13.6: its pictures are its example.
    expect(card()!.querySelector('[data-field="spec-example-text"]')).toBeNull();
    expect(card()!.querySelector('[data-field="spec-example-by"]')).toBeNull();
    expect(within(card()!).queryByText('Example')).toBeNull();
    expect(card()!.querySelector('[data-field="spec-example-tests"]')!.textContent).toBe('1 Playwright test: passed');
    // Narrow: the first panel and how many steps, which open the dialog.
    expect(within(card()!.querySelector<HTMLElement>('[data-field="spec-story-narrow"]')!).getByRole('button', { name: '3 steps' })).toBeTruthy();
  });

  it('PLAIN-13.5: two panels ringing two things on one picture are both drawn, each its own', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const p = panels();
      const [first] = p.frames!;
      open({}, { plainExamples: async () => kept({ ...p, frames: [first!, { ...first!, caption: 'Its second rate', box: { x: 0.4, y: 0.5, w: 0.1, h: 0.05 }, steps: [] }, ...p.frames!.slice(1)] }) });
      await waitFor(() => expect(card()?.querySelector('[data-field="spec-story"]') ?? null).not.toBeNull());
      expect([...story().querySelectorAll('figcaption')].map((f) => f.textContent)).toEqual(['The rate card with two rates', 'Its second rate', 'The rate is gone', 'The dialog is closed']);
      expect(err.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false);
    } finally {
      err.mockRestore();
    }
  });

  it('PLAIN-13.7: the dialog shows a panel whole, ringed with the rest dimmed (where an absence searched too), the steps that led to it, "Not there" for an absence', async () => {
    const user = userEvent.setup();
    open({}, { plainExamples: async () => kept(panels()) });
    await waitFor(() => expect(card()?.querySelector('[data-field="spec-story"]') ?? null).not.toBeNull());
    await user.click(within(story()).getByRole('button', { name: "Show §1.2's pictures large, at step 1" }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('§1.2 · The rate card with two rates')).toBeTruthy();
    expect(dialog.querySelector('[data-field="spec-example-after"]')).toBeNull();
    const ring = dialog.querySelector<HTMLElement>('[data-field="spec-example-large"] [data-field="spec-shot-ring"]')!;
    expect([ring.style.left, ring.style.top, ring.style.width, ring.style.height]).toEqual(['40%', '40%', '10%', '5%']);
    await user.keyboard('{ArrowRight}');
    dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('[data-field="spec-example-after"]')!.textContent).toBe('After: Press Delete, Pick Yes, Press Confirm, Press Escape, Open the page');
    // An absence: where it searched, ringed, the rest dimmed, and "Not there".
    const searched = dialog.querySelector<HTMLElement>('[data-field="spec-shot-ring"]')!;
    expect([searched.style.left, searched.style.top, searched.style.width, searched.style.height]).toEqual(['30%', '10%', '40%', '50%']);
    expect(within(dialog).getByText('Not there')).toBeTruthy();
    await user.keyboard('{ArrowRight}');
    dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('[data-field="spec-example-after"]')!.textContent).toBe('Next test');
    expect(dialog.querySelector('[data-field="spec-shot-ring"]')).toBeNull();
    expect(within(dialog).getByText('Not there')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

// PLAIN-14: §1.2 gains two clauses, 2 and its 2.1; §1.1 is unchanged.
const TEXT_14 = BASE.replace('- A rate can be edited inline.', '- A rate can be edited inline.\n- A rate can be deleted by :Mystery:.\n  - Deleting asks "Delete rate?" first.');
function simpleKept(over: Partial<PlainSimpleBlock> = {}, more: Partial<PlainSimple> = {}, answerMore: Partial<PlainSimpleAnswer> = {}): PlainSimpleAnswer {
  return {
    simple: {
      blocks: [
        {
          spec: '§1.2',
          stale: false,
          title: 'You can delete a rate',
          paragraphs: [
            { text: 'Someone who may delete rates can delete one from a deal.', cites: ['2'], terms: [{ phrase: 'may delete rates', name: 'Mystery' }, { phrase: 'a deal', name: 'Deal' }] },
            { text: 'Deleting asks "Delete rate?" first.', cites: ['2.1'], terms: [] },
          ],
          leftOut: [],
          failed: null,
          ...over,
        },
      ],
      lead: { stale: false, lines: [{ slot: 'changes', text: 'You can delete a rate.', cites: ['§1.2'] }, { slot: 'who', text: 'Someone who may delete rates.', cites: ['§1.2'] }] },
      writtenAt: Date.now() - 2 * 60 * 60 * 1000,
      model: 'claude-sonnet-5-5',
      costUsd: 0.04,
      readingEase: 84,
      specs: 1,
      ...more,
    },
    running: null,
    error: null,
    ...answerMore,
  };
}

describe('a simplified version beside the spec (PLAIN-14)', () => {
  const side = () => document.querySelector<HTMLElement>('[data-slot="spec-simple"][data-spec="§1.2"]');
  const toggle = () => screen.queryByRole('button', { name: 'Simplified' });
  const openSimple = (answer14: PlainSimpleAnswer = simpleKept(), options: Parameters<typeof renderApp>[1] = {}) => open({ text: TEXT_14 }, { plainSimple: async () => answer14, ...options });
  const paragraph = (text: string) => screen.getByText((_, el) => el?.getAttribute('data-field') === 'spec-simple-p' && (el.textContent ?? '').startsWith(text));
  const numbered = (n: string) => document.getElementById(`plain-s-1-2-n${n.replace(/\./g, '-')}`)!;
  afterEach(() => vi.unstubAllGlobals());

  it('PLAIN-14.1: the Changes card has "Simplify" after "Show examples"; nothing simplifies on its own; a press starts it for this Module; then it reads "Simplify again"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { app } = open({ text: TEXT_14 });
    const simplify = await screen.findByRole('button', { name: 'Simplify' });
    expect(simplify.getAttribute('title')).toBe('Claude rewrites the changed specs in simple words, shown beside them. Each paragraph cites its clauses.');
    expect(simplify.previousElementSibling?.textContent).toBe('Show examples');
    await act(async () => vi.advanceTimersByTime(SPEC_POLL_MS * 2));
    expect(app.client.startPlainSimple).not.toHaveBeenCalled();
    await act(async () => simplify.click());
    expect(app.client.startPlainSimple).toHaveBeenCalledWith(SRC, 'plain/rates.plain');
    vi.useRealTimers();
    cleanup();
    openSimple();
    expect(await screen.findByRole('button', { name: 'Simplify again' })).toBeTruthy();
  });

  it('PLAIN-14.13: while it is written the card shows the wait with Cancel, which cancels this Module; a failure shows why', async () => {
    const { app } = openSimple(simpleKept({}, {}, { running: { specs: 1 } }));
    expect(await screen.findByText('Simplifying 1 spec…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Simplify again' })).toBeNull();
    await act(async () => document.querySelector<HTMLElement>('[data-field="spec-simplify-cancel"]')!.click());
    expect(app.client.cancelPlainSimple).toHaveBeenCalledWith(SRC, 'plain/rates.plain');
    cleanup();
    openSimple(simpleKept({}, {}, { error: 'It took longer than 120 s and was stopped.' }));
    expect((await screen.findByText('It took longer than 120 s and was stopped.')).closest('[data-field="spec-simplify-error"]')).not.toBeNull();
  });

  it('PLAIN-14.10: once there is a version the header has "Simplified", pressed while it shows; it opens shown, hides and shows again; Clean has neither', async () => {
    openSimple();
    await waitFor(() => expect(side()).not.toBeNull());
    expect(toggle()!.getAttribute('aria-pressed')).toBe('true');
    expect(toggle()!.querySelector('span')!.className).toContain('@max-[40rem]/header:sr-only');
    act(() => toggle()!.click());
    expect(side()).toBeNull();
    expect(toggle()!.getAttribute('aria-pressed')).toBe('false');
    act(() => toggle()!.click());
    expect(side()).not.toBeNull();
    choose('Clean');
    expect(side()).toBeNull();
    expect(toggle()).toBeNull();
    cleanup();
    open({ text: TEXT_14 });
    await screen.findByRole('button', { name: 'Simplify' });
    expect(toggle()).toBeNull();
  });

  it('PLAIN-14.10: a press shows the side when its run ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let state: PlainSimpleAnswer = { simple: null, running: null, error: null };
    open({ text: TEXT_14 }, { plainSimple: async () => state, startPlainSimple: async () => void (state = { simple: null, running: { specs: 1 }, error: null }) });
    const simplify = await screen.findByRole('button', { name: 'Simplify' });
    await act(async () => simplify.click());
    expect(await screen.findByText('Simplifying 1 spec…')).toBeTruthy();
    state = simpleKept();
    await act(async () => vi.advanceTimersByTime(SPEC_POLL_MS * 2));
    await waitFor(() => expect(side()).not.toBeNull());
    expect(toggle()!.getAttribute('aria-pressed')).toBe('true');
    vi.useRealTimers();
  });

  it('PLAIN-14.8: two columns, a changed spec\'s row with its block on the right; the example card moves there; nothing on the right of an unchanged spec; ids above headings; "On this page" is a header menu', async () => {
    const user = userEvent.setup();
    openSimple(simpleKept(), { plainExamples: async () => kept() });
    await waitFor(() => expect(side()).not.toBeNull());
    expect(document.querySelector('[data-slot="spec-layout"]')!.getAttribute('data-side')).toBe('beside');
    const row = side()!.closest<HTMLElement>('[data-slot="spec-row"]')!;
    expect(within(row).getByRole('article', { name: '§1.2' })).toBeTruthy();
    expect(row.className).toContain('grid-cols-[minmax(0,34fr)_1px_minmax(0,30fr)]');
    expect(side()!.getAttribute('aria-label')).toBe('§1.2 simplified');
    expect(within(side()!).getByRole('heading', { name: 'You can delete a rate' })).toBeTruthy();
    expect(side()!.querySelector('[data-slot="spec-example"]')).not.toBeNull();
    expect(within(row).getByRole('article', { name: '§1.2' }).querySelector('[data-slot="spec-example"]')).toBeNull();
    expect(side()!.className).toContain('sticky');
    expect(within(module()).getByRole('article', { name: '§1.2' }).querySelector('[data-field="spec-id"]')!.className).not.toContain('absolute');
    // A fold line, and in Whole an unchanged spec, have nothing on the right.
    const foldRow = within(module()).getByRole('button', { name: /unchanged spec/ }).closest('[data-slot="spec-row"]')!;
    expect(foldRow.querySelector('[data-slot="spec-row-side"]')!.childElementCount).toBe(0);
    choose('Whole');
    const unchanged = within(module()).getByRole('article', { name: '§1.1' }).closest('[data-slot="spec-row"]')!;
    expect(unchanged.querySelector('[data-slot="spec-row-side"]')!.childElementCount).toBe(0);
    choose('Changes');
    // A paragraph from an added clause takes the added bar.
    expect(paragraph('Someone who may delete rates').className).toContain('before:bg-diff-added-text');
    expect(paragraph('Someone who may delete rates').hasAttribute('data-change')).toBe(false);
    expect(document.querySelector('[data-slot="spec-nav"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'On this page' }));
    expect(await screen.findByRole('navigation', { name: 'On this page' })).toBeTruthy();
  });

  it('PLAIN-14.6: with the side shown a clause\'s bullet is its number, a test\'s T1, removed ones among the others; each paragraph ends with the numbers it cites', async () => {
    openSimple();
    await waitFor(() => expect(side()).not.toBeNull());
    const spec = within(module()).getByRole('article', { name: '§1.2' });
    // In Changes the unchanged clause 1 folds; Whole shows it with its number.
    expect([...spec.querySelectorAll('[data-field="spec-clause-n"]')].map((n) => n.textContent)).toEqual(['2', '2.1']);
    expect(spec.querySelector('ul')!.className).toContain('list-none');
    choose('Whole');
    expect([...within(module()).getByRole('article', { name: '§1.2' }).querySelectorAll('[data-field="spec-clause-n"]')].map((n) => n.textContent)).toEqual(['1', '2', '2.1']);
    choose('Changes');
    expect(within(paragraph('Someone who may delete rates')).getByRole('button', { name: 'Clause 2' }).textContent).toBe('2');
    act(() => toggle()!.click());
    expect(within(module()).getByRole('article', { name: '§1.2' }).querySelector('[data-field="spec-clause-n"]')).toBeNull();
  });

  it('PLAIN-14.13: a Cancel too late to stop the save says so, and the version it saved shows', async () => {
    let running = true;
    openSimple(simpleKept(), {
      plainSimple: async () => simpleKept({}, {}, running ? { running: { specs: 1 } } : {}),
      cancelPlainSimple: async () => {
        running = false;
        throw new Error('Too late to cancel: the new version was already saved.');
      },
    });
    expect(await screen.findByText('Simplifying 1 spec…')).toBeTruthy();
    await act(async () => document.querySelector<HTMLElement>('[data-field="spec-simplify-cancel"]')!.click());
    await waitFor(() => expect(document.querySelector('[data-field="spec-simplify-error"]')?.textContent).toContain('Too late to cancel: the new version was already saved.'));
    expect(side()).not.toBeNull();
  });

  it('PLAIN-14.7: hovering a paragraph lights the clauses it cites, hovering a clause lights its paragraphs; a number goes to its clause; a term opens its card or names what it stands for', async () => {
    const user = userEvent.setup();
    openSimple();
    await waitFor(() => expect(side()).not.toBeNull());
    const first = paragraph('Someone who may delete rates');
    movePointer(document.body, first);
    expect(numbered('2').className).toContain('bg-spec/10');
    expect(numbered('2.1').className).not.toContain('bg-spec/10');
    movePointer(first, document.body);
    expect(numbered('2').className).not.toContain('bg-spec/10');
    movePointer(document.body, numbered('2.1'));
    expect(paragraph('Deleting asks').getAttribute('data-lit')).toBe('true');
    expect(first.hasAttribute('data-lit')).toBe(false);
    movePointer(numbered('2.1'), document.body);
    await user.click(within(first).getByRole('button', { name: 'Clause 2' }));
    await waitFor(() => expect(document.activeElement).toBe(numbered('2')));
    expect(within(first).getByText('may delete rates').getAttribute('title')).toBe('Mystery');
    await user.hover(within(first).getByRole('button', { name: 'a deal' }));
    expect(await screen.findByRole('dialog', { name: 'Deal, defined in api' })).toBeTruthy();
  });

  it('PLAIN-14.7: a citation\'s leave or blur doesn\'t put out its paragraph while the pointer is on it, nor what another hover lit since', async () => {
    openSimple();
    await waitFor(() => expect(side()).not.toBeNull());
    const first = paragraph('Someone who may delete rates');
    const cite = within(first).getByRole('button', { name: 'Clause 2' });
    movePointer(document.body, first);
    movePointer(first, cite);
    movePointer(cite, first);
    expect(numbered('2').className).toContain('bg-spec/10');
    act(() => cite.focus());
    movePointer(first, document.body);
    expect(numbered('2').className).toContain('bg-spec/10');
    movePointer(document.body, numbered('2.1'));
    act(() => cite.blur());
    expect(numbered('2.1').className).toContain('bg-spec/10');
    expect(paragraph('Deleting asks').getAttribute('data-lit')).toBe('true');
    movePointer(numbered('2.1'), document.body);
    expect(numbered('2.1').className).not.toContain('bg-spec/10');
  });

  it('PLAIN-14.7, 14.5: a citation of a note in closed Notes opens them and goes to it', async () => {
    const user = userEvent.setup();
    const withNote = simpleKept({ paragraphs: [...simpleKept().simple!.blocks[0]!.paragraphs, { text: 'A task asked for it.', cites: ['N1'], terms: [] }] });
    open({ text: `${TEXT_14}\n> Deleting was asked for in a task.\n` }, { plainSimple: async () => withNote });
    await waitFor(() => expect(side()).not.toBeNull());
    await user.click(within(module()).getByRole('button', { name: /^Notes/ }));
    expect(numbered('N1')).toBeNull();
    await user.click(within(paragraph('A task asked for it.')).getByRole('button', { name: 'Note N1' }));
    await waitFor(() => expect(document.activeElement).toBe(numbered('N1')));
  });

  it('PLAIN-14.12: a read that sees the spec change reads the version again; one that can\'t is shown no longer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const plainSimple = vi.fn(async () => simpleKept());
    const { readPlain } = open({ text: TEXT_14 }, { plainSimple });
    await waitFor(() => expect(side()).not.toBeNull());
    plainSimple.mockRejectedValue(new Error('gone'));
    readPlain.mockImplementation(async () => answer({ text: TEXT_14.replace('Delete rate?', 'Remove rate?') }));
    await act(async () => vi.advanceTimersByTime(SPEC_POLL_MS));
    await waitFor(() => expect(side()).toBeNull());
    vi.useRealTimers();
  });

  it('PLAIN-14.9: In short is beside the Changes card with the side shown, at the top of the card with it hidden; a citation lights its spec\'s heading and goes to it', async () => {
    openSimple();
    await waitFor(() => expect(side()).not.toBeNull());
    const short = () => document.querySelector<HTMLElement>('[data-slot="spec-in-short"]')!;
    expect(short().closest('[data-slot="spec-changes"]')).toBeNull();
    expect(short().closest('[data-slot="spec-row"]')!.querySelector('[data-slot="spec-changes"]')).not.toBeNull();
    expect(short().querySelector('[data-field="spec-in-short-changes"]')!.textContent).toBe('You can delete a rate.§1.2');
    expect(within(short()).getByText('What changes')).toBeTruthy();
    expect(within(short()).getByText('Who gets it')).toBeTruthy();
    expect(within(short()).queryByText('Unlike before')).toBeNull();
    expect(short().querySelector('[data-field="spec-in-short-by"]')!.textContent).toBe('Written by Claude from 1 spec · Sonnet 5.5 · $0.04 · 2h ago');
    const cite = within(short()).getAllByRole('button', { name: 'Go to §1.2' })[0]!;
    act(() => cite.focus());
    expect(within(module()).getByRole('article', { name: '§1.2' }).querySelector('h3')!.className).toContain('bg-spec/10');
    act(() => cite.blur());
    act(() => toggle()!.click());
    expect(short().closest('[data-slot="spec-changes"]')).not.toBeNull();
    // With the side hidden, its citations still light the heading.
    act(() => within(short()).getAllByRole('button', { name: 'Go to §1.2' })[0]!.focus());
    expect(within(module()).getByRole('article', { name: '§1.2' }).querySelector('h3')!.className).toContain('bg-spec/10');
  });

  it('PLAIN-14.11: the column\'s head says who wrote it and what was checked; a gap and a low reading ease say so', async () => {
    openSimple(simpleKept({ leftOut: ['2.1'] }, { readingEase: 52 }));
    await waitFor(() => expect(document.querySelector('[data-slot="spec-simple-head"]')).not.toBeNull());
    const head = document.querySelector<HTMLElement>('[data-slot="spec-simple-head"]')!;
    expect(head.querySelector('[data-field="spec-simple-by"]')!.textContent).toBe('Written by Claude from the changed spec · Sonnet 5.5 · $0.04 · 2h ago');
    const checks = head.querySelector('[data-field="spec-simple-checks"]')!.textContent;
    expect(checks).toContain('Each paragraph cites its clauses');
    expect(checks).toContain('Numbers and quotes kept');
    expect(checks).toContain('Reading ease 52, harder than it should be');
    expect(within(head).getByRole('link', { name: '1 spec leaves out clauses' }).getAttribute('href')).toBe('#plain-s-1-2-simple');
  });

  it('PLAIN-14.5: a clause no paragraph cites is outlined; the block says which, with Show them and Simplify again', async () => {
    const { app } = openSimple(simpleKept({ paragraphs: simpleKept().simple!.blocks[0]!.paragraphs.slice(0, 1), leftOut: ['2.1'] }));
    await waitFor(() => expect(side()).not.toBeNull());
    expect(numbered('2.1').className).toContain('outline-dashed');
    expect(numbered('2').className).not.toContain('outline-dashed');
    const gap = side()!.querySelector<HTMLElement>('[data-field="spec-simple-left-out"]')!;
    expect(gap.textContent).toContain('Leaves out 1 clause: 2.1');
    expect(gap.className).not.toMatch(/warning|destructive/);
    act(() => within(gap).getByRole('button', { name: 'Show them' }).click());
    expect(numbered('2.1').className).toContain('bg-spec/10');
    await act(async () => within(gap).getByRole('button', { name: 'Simplify again' }).click());
    expect(app.client.startPlainSimple).toHaveBeenCalledWith(SRC, 'plain/rates.plain');
  });

  it('PLAIN-14.12: a block whose spec changed since says so with Simplify again; In short out of date says so; a spec with none kept is not simplified yet', async () => {
    openSimple(simpleKept({ stale: true, title: null, paragraphs: [] }, { lead: { stale: true, lines: [] } }));
    await waitFor(() => expect(side()).not.toBeNull());
    expect(side()!.querySelector('[data-field="spec-simple-missing"]')!.textContent).toBe('§1.2 changed since it was simplified.Simplify again');
    expect(document.querySelector('[data-field="spec-in-short-stale"]')!.textContent).toBe('In short is out of date.Simplify again');
    cleanup();
    openSimple(simpleKept({ spec: '§9.9' }));
    await waitFor(() => expect(side()).not.toBeNull());
    expect(side()!.querySelector('[data-field="spec-simple-missing"]')!.textContent).toBe('Not simplified yet.Simplify');
  });

  it('PLAIN-14.15: in a narrow pane the block takes the spec text\'s place, its title the heading\'s and the rows\'; a number opens the clauses; "Show the spec text" opens them; a jump to a hidden change shows it', async () => {
    const ro = fakeResizeObserver();
    const user = userEvent.setup();
    openSimple();
    await waitFor(() => expect(document.querySelector('[data-slot="spec-layout"]')?.getAttribute('data-side')).toBe('in-place'));
    void ro;
    const spec = within(module()).getByRole('article', { name: '§1.2' });
    expect(within(spec).getByRole('heading', { name: 'You can delete a rate' }).getAttribute('title')).toBe('A rate can be edited inline');
    const text = spec.querySelector<HTMLElement>('[data-spec-text]')!;
    expect(text.hidden).toBe(true);
    expect(document.querySelector('[data-slot="spec-changes"] li')!.textContent).toContain('You can delete a rate');
    await user.click(within(paragraph('Deleting asks')).getByRole('button', { name: 'Clause 2.1' }));
    const card = await screen.findByRole('dialog', { name: '§1.2, Clause 2.1' });
    expect(card.textContent).toContain('Deleting asks "Delete rate?" first.');
    await user.keyboard('{Escape}');
    await user.click(within(spec).getByRole('button', { name: 'Show the spec text' }));
    expect(text.hidden).toBe(false);
    await user.click(within(spec).getByRole('button', { name: 'Hide the spec text' }));
    expect(text.hidden).toBe(true);
    // The stepper still counts the hidden changes, and a jump to one shows its spec text.
    const at = screen.getByText((_, el) => el?.getAttribute('data-field') === 'spec-at');
    expect(at.textContent).toMatch(/(^| of )2( changes)?$/);
    await user.keyboard('[[');
    await user.keyboard(']');
    expect(text.hidden).toBe(false);
  });

  it('DS-2.6: the Spec view\'s numbers and citations in spec-text, and its text on a lit clause\'s spec/10 and a citation\'s spec/16 over the background, keep 4.5:1 in both modes', () => {
    for (const mode of ['light', 'dark'] as Mode[]) {
      const t = themeTokens(css)[mode];
      const background = solid(t, 'background');
      expect(contrast(solid(t, 'spec-text'), background), `${mode} spec-text on background`).toBeGreaterThanOrEqual(4.5);
      for (const alpha of [0.1, 0.16]) {
        const on = paint(t, 'spec', background, alpha);
        for (const text of ['foreground', 'muted-foreground', 'spec-text']) expect(contrast(solid(t, text), on), `${mode} ${text} on spec/${alpha}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
