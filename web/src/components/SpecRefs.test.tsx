import type { AbilityEntry, PlainAnswer } from '@shared/plain.ts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderApp, row } from '@/test/helpers';

const CHECKOUT = '0123456789abcdef';
const SRC = { kind: 'session', session: 'a', checkout: CHECKOUT } as const;
const URL = `/plain/a/${CHECKOUT}/${encodeURIComponent('plain/rates.plain')}`;
const href = (path: string) => `/plain/a/${CHECKOUT}/${encodeURIComponent(path)}`;

const BASE = `---
description: Rates.
---

***functional specs***

> spec: §1.1

- A rate names §1.2, §2.1, §2.2–§2.3 and §9.9, and asks \`x.can_do\`, \`x.can_new\`, \`x.can_gone\`, \`x.can_raw\`, \`x.can_const\`, \`x.can_never\` and \`plain_code\`.

> spec: §1.2

- A rate can be edited inline.
  - Its cell opens on a press.

  ***acceptance tests***
  - An admin edits a rate.

> why: inline is faster
`;
const TEXT = BASE.replace('- A rate can be edited inline.', '- A rate can be edited in place.');

const entry = (over: Partial<AbilityEntry> = {}): AbilityEntry => ({ file: 'apps/web/src/lib/abilities/catalogue/x.ts', line: 12, description: 'Do it', doc: 'Doing it, for\nthe reader.\n\nA second `x.can_new` paragraph.', rule: { kind: 'fact', name: 'a' }, source: "{ fact: 'a' }", ...over });

function answer(over: Partial<PlainAnswer> = {}): PlainAnswer {
  return {
    source: SRC,
    checkout: { id: CHECKOUT, repo: 'shop', where: 'feature/rates' },
    baseName: 'Branch point',
    fetchError: null,
    path: 'plain/rates.plain',
    text: TEXT,
    baseText: BASE,
    base: 'abc1234',
    concepts: {},
    missing: [],
    specs: {
      '§2.1': { module: 'plain/sub/b.plain', lines: ['- A spec in a sub folder.', '  - Its detail.'], baseLines: ['- A spec in a sub folder.', '  - Its detail.'], tests: 2, notes: 0 },
      '§2.2': { module: 'plain/sub/b.plain', lines: ['- After the branch.'], baseLines: ['- Before the branch.'], tests: 0, notes: 0 },
      '§2.3': { module: 'plain/sub/b.plain', lines: null, baseLines: ['- Gone in the branch.'], tests: 0, notes: 0 },
    },
    abilities: {
      'x.can_do': {
        head: entry({ rule: { allOf: [{ kind: 'fact', name: 'a' }, { anyOf: [{ kind: 'permission', name: 'p' }, { not: { kind: 'flag', name: 'f' } }] }, { kind: 'ability', name: 'x.can_new' }, { kind: 'feature', name: 'budgets', state: 'limit' }] }, source: 'changed' }),
        base: entry({ description: 'Did it', rule: { kind: 'fact', name: 'a' } }),
      },
      'x.can_new': { head: entry({ description: 'New one', doc: '', line: 40 }), base: null },
      'x.can_gone': { head: null, base: entry({ description: 'Gone one', doc: '' }) },
      'x.can_raw': { head: entry({ description: 'Raw', doc: '', rule: null, source: 'build(RULES)' }), base: entry({ description: 'Raw', doc: '', rule: null, source: 'build(RULES)' }) },
      // Its rule names a constant, which only the constant's own lines change.
      'x.can_const': { head: entry({ description: 'Const', doc: '', rule: { kind: 'fact', name: 'b' }, source: 'STATE' }), base: entry({ description: 'Const', doc: '', rule: { kind: 'fact', name: 'a' }, source: 'STATE' }) },
    },
    catalogue: true,
    key: 'k'.repeat(64),
    viewed: false,
    changedSinceViewed: false,
    ...over,
  };
}

function open(over: Partial<PlainAnswer> = {}) {
  const readPlain = vi.fn(async () => answer(over));
  const app = renderApp(URL, { readPlain });
  app.snapshot([row({ id: 'a', title: 'fix-deal-rates' })]);
  return { app, readPlain };
}
const module = () => document.querySelector<HTMLElement>('[data-slot="spec-module"]')!;
const first = () => module().querySelector<HTMLElement>('[data-spec-id="§1.1"]')!;
/** PLAIN-10.2: the view opens on Changes, which folds the unchanged §1.1 these references sit in. */
const whole = () => act(() => screen.getByRole('radio', { name: 'Whole' }).click());

describe('references explained in place', () => {
  it('PLAIN-7.1, PLAIN-7.3: a § to this Module still scrolls there, and hovered or focused shows the spec, its change, its counts and Go to', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText('Rates.');
    whole();
    const ref = within(first()).getByRole('link', { name: '§1.2' });
    expect(ref).toHaveAttribute('href', '#plain-s-1-2');
    await user.hover(ref);
    const card = await screen.findByRole('dialog', { name: '§1.2, in this Module' });
    expect(within(card).getByText('A rate can be edited in place')).toBeInTheDocument();
    expect(card).toHaveTextContent('Changed in this branch');
    expect(card.querySelector('ins')).toHaveTextContent('in place');
    expect(within(card).getByText('Its cell opens on a press.')).toBeInTheDocument();
    expect(card.querySelector('[data-field="spec-counts"]')).toHaveTextContent('1 acceptance test and 1 note, not shown here.');
    expect(card).not.toHaveTextContent('An admin edits a rate.');
    expect(within(card).getByRole('link', { name: 'Go to §1.2' })).toHaveAttribute('href', '#plain-s-1-2');
    await user.unhover(ref);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^§1\.2/ })).toBeNull());
    act(() => ref.focus());
    expect(await screen.findByRole('dialog', { name: '§1.2, in this Module' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^§1\.2/ })).toBeNull());
    expect(ref).toHaveFocus();
  });

  it('PLAIN-7.2: a § to another Module links to it at that spec, a range is two references, and its card opens it there as a new entry', async () => {
    const user = userEvent.setup();
    const { readPlain } = open();
    await screen.findByText('Rates.');
    whole();
    const ref = within(first()).getByRole('link', { name: '§2.1' });
    expect(ref).toHaveAttribute('href', `${href('plain/sub/b.plain')}#plain-s-2-1`);
    expect(within(first()).getByRole('link', { name: '§2.2' })).toHaveAttribute('href', `${href('plain/sub/b.plain')}#plain-s-2-2`);
    expect(within(first()).getByRole('link', { name: '§2.3' })).toBeInTheDocument();
    await user.hover(ref);
    const card = await screen.findByRole('dialog', { name: '§2.1, in b' });
    expect(card).toHaveTextContent('§2.1 in plain/sub/b.plain');
    expect(within(card).getByText('A spec in a sub folder')).toBeInTheDocument();
    expect(card.querySelector('[data-field="ref-changed"]')).toBeNull();
    expect(card.querySelector('[data-field="spec-counts"]')).toHaveTextContent('2 acceptance tests, not shown here.');
    const go = within(card).getByRole('link', { name: 'Open b at §2.1' });
    expect(go).toHaveAttribute('href', `${href('plain/sub/b.plain')}#plain-s-2-1`);
    const entries = window.history.length;
    await user.click(go);
    expect(window.location.pathname).toBe(href('plain/sub/b.plain'));
    expect(window.location.hash).toBe('#plain-s-2-1');
    expect(window.history.length).toBe(entries + 1);
    await waitFor(() => expect(readPlain).toHaveBeenLastCalledWith(SRC, 'plain/sub/b.plain', true));
  });

  it('PLAIN-7.3: another Module\'s spec changed or removed in this branch says so, marked', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText('Rates.');
    whole();
    await user.hover(within(first()).getByRole('link', { name: '§2.2' }));
    const changed = await screen.findByRole('dialog', { name: '§2.2, in b' });
    expect(changed).toHaveTextContent('Changed in this branch');
    expect(changed.querySelector('ins')).toHaveTextContent('After');
    expect(changed.querySelector('del')).toHaveTextContent('Before');
    await user.hover(within(first()).getByRole('link', { name: '§2.3' }));
    const removed = await screen.findByRole('dialog', { name: '§2.3, in b' });
    expect(removed).toHaveTextContent('Removed in this branch');
    expect(removed.querySelector('li[data-state="removed"]')).toHaveTextContent('Gone in the branch.');
  });

  it('PLAIN-7.4: a § in no Module stays text, saying so in its tooltip', async () => {
    open();
    await screen.findByText('Rates.');
    whole();
    expect(within(first()).queryByRole('link', { name: '§9.9' })).toBeNull();
    expect(within(first()).getByText('§9.9')).toHaveAttribute('title', "No functional spec §9.9 in this repo's Modules");
  });

  it('PLAIN-7.5: an ability key stays code and opens its description, comment, rule in words with the abilities it names described, and its file', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText('Rates.');
    whole();
    const key = within(first()).getByRole('button', { name: 'x.can_do' });
    expect(key).toHaveAttribute('data-term', 'ability');
    expect(key).toHaveClass('font-mono', 'bg-muted');
    await user.hover(key);
    const card = await screen.findByRole('dialog', { name: 'x.can_do, an ability' });
    expect(within(card).getByText('Doing it, for the reader.')).toBeInTheDocument();
    expect(card).toHaveTextContent('A second x.can_new paragraph.');
    const rule = card.querySelector<HTMLElement>('[data-field="rule"]')!;
    expect(rule).toHaveTextContent('Allowed when');
    expect(rule).toHaveTextContent('All of');
    expect(rule).toHaveTextContent('Any of');
    expect(rule).toHaveTextContent('Not');
    const leaves = [...rule.querySelectorAll('[data-field="rule-leaf"]')].map((l) => l.textContent);
    expect(leaves).toEqual(['fact a', 'permission p', 'flag f', 'ability x.can_new: New one', 'plan feature budgets (limit)']);
    expect(card.querySelector('[data-field="ability-file"]')).toHaveTextContent('apps/web/src/lib/abilities/catalogue/x.ts:12');
  });

  it('PLAIN-7.7: an ability changed in this branch says so with what was before; an added one and a removed one say so', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText('Rates.');
    whole();
    await user.hover(within(first()).getByRole('button', { name: 'x.can_do' }));
    const card = await screen.findByRole('dialog', { name: 'x.can_do, an ability' });
    expect(card).toHaveTextContent('Changed in this branch');
    const before = card.querySelector<HTMLElement>('[data-field="ability-before"]')!;
    expect(before).toHaveTextContent('Before');
    expect(before).toHaveTextContent('Did it');
    expect(before.querySelector('[data-field="rule-leaf"]')).toHaveTextContent('fact a');

    await user.hover(within(first()).getByRole('button', { name: 'x.can_new' }));
    const added = await screen.findByRole('dialog', { name: 'x.can_new, an ability' });
    expect(added).toHaveTextContent('Added in this branch');
    expect(added.querySelector('[data-field="ability-before"]')).toBeNull();
    await user.hover(within(first()).getByRole('button', { name: 'x.can_gone' }));
    const gone = await screen.findByRole('dialog', { name: 'x.can_gone, an ability' });
    expect(gone).toHaveTextContent('Removed in this branch');
    expect(gone).toHaveTextContent('Gone one');
    await user.hover(within(first()).getByRole('button', { name: 'x.can_const' }));
    const viaConst = await screen.findByRole('dialog', { name: 'x.can_const, an ability' });
    expect(viaConst).toHaveTextContent('Changed in this branch');
    expect(viaConst.querySelector('[data-field="ability-before"] [data-field="rule-leaf"]')).toHaveTextContent('fact a');
  });

  it('PLAIN-7.6: a rule that is not conditions is shown as written', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText('Rates.');
    whole();
    await user.hover(within(first()).getByRole('button', { name: 'x.can_raw' }));
    const card = await screen.findByRole('dialog', { name: 'x.can_raw, an ability' });
    expect(card.querySelector('[data-field="ref-changed"]')).toBeNull();
    expect(card.querySelector('[data-field="rule"]')).toBeNull();
    expect(card.querySelector('[data-field="rule-source"]')).toHaveTextContent('Rule as written');
    expect(card.querySelector('[data-field="rule-source"] pre')).toHaveTextContent('build(RULES)');
  });

  it("PLAIN-7.8: a key the catalogue doesn't hold says so; other code stays code; with no catalogue every key stays code", async () => {
    const user = userEvent.setup();
    const { app } = open();
    await screen.findByText('Rates.');
    whole();
    await user.hover(within(first()).getByRole('button', { name: 'x.can_never' }));
    expect(await screen.findByRole('dialog', { name: 'x.can_never, an ability' })).toHaveTextContent("Not in this Checkout's abilities catalogue.");
    expect(within(first()).getByText('plain_code').tagName).toBe('CODE');
    app.unmount();

    open({ catalogue: false, abilities: {} });
    await screen.findByText('Rates.');
    whole();
    expect(within(first()).queryByRole('button', { name: 'x.can_do' })).toBeNull();
    expect(within(first()).getByText('x.can_do').tagName).toBe('CODE');
  });
});
