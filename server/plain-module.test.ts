import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareClauses, compareModules, definitionName, parseModule, wordDiff, type Clause } from '../shared/plain.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'plain', 'fantastic', 'plain');
const crm = readFileSync(join(FIXTURES, 'crm.plain'), 'utf8');

const MODULE = `---
description: Rate cards on a Deal.
import:
  - productive
requires:
  - shell
exported_concepts:
  - :RateCard:
---

> A note before the sections.

***definitions***

- :RateCard: is a list of prices for a :Deal:.
  - It belongs to one :Company:.

- :Rate: is one price on a :RateCard:.

***implementation reqs***

- Prices are kept in cents.

***test reqs***

- :ConformanceTests: cover every rate.

***functional specs***

> spec: §1.1

- A Deal shows its :RateCard: as a table, newest first.

  ***acceptance tests***

  - A Deal with two rates lists both.

> spec: §1.2

- A rate can be edited inline.
`;

const states = (nodes: readonly Clause[]): [string, string][] => nodes.flatMap((n) => [[n.state, n.text.slice(0, 30)] as [string, string], ...states(n.children)]);

describe('parsing a Module', () => {
  it('PLAIN-1.3: the frontmatter, notes, definitions, reqs, and functional specs with their acceptance tests', () => {
    const m = parseModule(MODULE);
    expect(m.description).toBe('Rate cards on a Deal.');
    expect(m.import).toEqual(['productive']);
    expect(m.requires).toEqual(['shell']);
    expect(m.exportedConcepts).toEqual(['RateCard']);
    expect(m.notes).toEqual(['A note before the sections.']);
    expect(m.sections.definitions!.map((n) => definitionName(n.text)?.name)).toEqual(['RateCard', 'Rate']);
    expect(m.sections.definitions![0]!.children.map((c) => c.text)).toEqual(['It belongs to one :Company:.']);
    expect(m.sections['implementation reqs']!.map((n) => n.text)).toEqual(['Prices are kept in cents.']);
    expect(m.sections['test reqs']!.map((n) => n.text)).toEqual([':ConformanceTests: cover every rate.']);
    expect(m.explicitIds).toBe(true);
    expect(m.specs.map((s) => [s.id, s.clauses.length, s.tests.length])).toEqual([
      ['§1.1', 1, 1],
      ['§1.2', 1, 0],
    ]);
    expect(m.loose).toEqual([]);
  });

  it('PLAIN-1.3: flow lists in the frontmatter, and specs numbered by position when the Module marks none', () => {
    const m = parseModule('---\nrequired_concepts: [":Api:", ":Screen:"]\nimport: [productive, "view-config"]\n---\n***functional specs***\n- First.\n- Second.\n');
    expect(m.import).toEqual(['productive', 'view-config']);
    expect(m.specs.map((s) => s.id)).toEqual(['#1', '#2']);
  });

  it("PLAIN-1.8: text outside every section is kept under its own name, so nothing is hidden", () => {
    const m = parseModule('---\ndescription: x\n---\nstray line\n- stray bullet\n***definitions***\n- :A: is a.\n');
    expect(m.loose).toEqual(['stray line', '- stray bullet']);
    expect(m.sections.definitions).toHaveLength(1);
  });

  it("PLAIN-1.3: fantastic-productive's crm.plain parses whole", () => {
    const m = parseModule(crm);
    expect(m.import).toEqual(['productive', 'providers/exporter/exporter-public', 'providers/realtime/realtime-public', 'view-config']);
    expect(m.requires).toEqual(['shell']);
    expect(m.sections.definitions!.length).toBe(13);
    expect(m.specs.length).toBe(137);
    expect(m.specs.every((s) => s.id.startsWith('§'))).toBe(true);
    expect(m.loose).toEqual([]);
  });
});

describe('notes', () => {
  it("PLAIN-1.8: a `>` note inside a section is kept with its spec, or its section, and none of crm.plain's is lost", () => {
    const m = parseModule(MODULE.replace('- A rate can be edited inline.', '- A rate can be edited inline.\n\n> Ember parity: rates edit in place.').replace('- Prices are kept in cents.', '> Why cents: no float drift.\n\n- Prices are kept in cents.'));
    expect(m.specs[1]!.notes.map((n) => n.text)).toEqual(['Ember parity: rates edit in place.']);
    expect(m.sectionNotes['implementation reqs']!.map((n) => n.text)).toEqual(['Why cents: no float drift.']);
    const c = parseModule(crm);
    const body = crm.slice(crm.indexOf('***'));
    const expected = body.split('\n').filter((l) => /^>\s?/.test(l) && !/^>\s?spec:/.test(l) && l.replace(/^>\s?/, '').trim()).length;
    const kept = c.specs.reduce((n, s) => n + s.notes.length, 0) + Object.values(c.sectionNotes).reduce((n, v) => n + v.length, 0);
    expect(expected).toBeGreaterThan(10);
    expect(kept).toBe(expected);
  });

  it('PLAIN-1.6: a note added to a spec marks the spec changed and is counted', () => {
    const next = MODULE.replace('- A rate can be edited inline.', '- A rate can be edited inline.\n\n> Ember parity: rates edit in place.');
    const c = compareModules(next, MODULE);
    expect(c.module.specs[1]!.state).toBe('changed');
    expect(c.module.specs[1]!.notes[0]!.state).toBe('added');
    expect(c.stats.touched.map((t) => t.where)).toEqual(['§1.2 notes']);
  });

  it('PLAIN-1.8: a note between a clause and its nested bullet leaves the nesting as it was', () => {
    const m = parseModule('---\n---\n***definitions***\n- :A: is a.\n> Why a.\n  - It nests under A.\n');
    expect(m.sections.definitions!.map((n) => [n.text, n.children.map((c) => c.text)])).toEqual([[':A: is a.', ['It nests under A.']]]);
    expect(m.sectionNotes.definitions!.map((n) => n.text)).toEqual(['Why a.']);
  });

  it('PLAIN-1.8: text before the first spec of a Module that marks its specs is kept once', () => {
    const m = parseModule('---\n---\n***functional specs***\nIntro line.\n- intro bullet\n> spec: §1.1\n- A spec.\n');
    expect(m.loose).toEqual(['Intro line.', '- intro bullet']);
  });

  it('PLAIN-1.8: text before the first bullet of a section is kept under "Not in a section"', () => {
    const m = parseModule('---\n---\n***definitions***\nA stray sentence.\n- :A: is a.\n');
    expect(m.loose).toEqual(['A stray sentence.']);
  });
});

describe('comparing a Module with its base', () => {
  it('PLAIN-1.6: added, removed and rewritten clauses are marked, counted, and listed in page order', () => {
    const next = MODULE.replace('- Prices are kept in cents.', '- Prices are kept in cents, never as floats.')
      .replace("- :Rate: is one price on a :RateCard:.\n", '')
      .replace('- A rate can be edited inline.', '- A rate can be edited inline.\n- A rate can be deleted.');
    const c = compareModules(next, MODULE);
    expect(c.diffed).toBe(true);
    expect(c.stats).toMatchObject({ added: 1, changed: 1, removed: 1 });
    expect(states(c.module.sections.definitions!)).toEqual([
      ['same', ':RateCard: is a list of prices'],
      ['same', 'It belongs to one :Company:.'],
      ['removed', ':Rate: is one price on a :Rate'],
    ]);
    const impl = c.module.sections['implementation reqs']![0]!;
    expect(impl.state).toBe('changed');
    expect(impl.oldText).toBe('Prices are kept in cents.');
    expect(states(c.module.specs[1]!.clauses)).toEqual([
      ['same', 'A rate can be edited inline.'],
      ['added', 'A rate can be deleted.'],
    ]);
    expect(c.stats.touched.map((t) => t.where)).toEqual(['definitions', 'implementation reqs', '§1.2']);
    expect(c.touchedSections.sort()).toEqual(['definitions', 'functional specs', 'implementation reqs']);
  });

  it('PLAIN-1.6: a rewritten clause carries its word-level change', () => {
    expect(wordDiff('Prices are kept in cents.', 'Prices are kept in cents, never as floats.')).toEqual([
      { k: 'eq', t: 'Prices are kept in' },
      { k: 'del', t: 'cents.' },
      { k: 'ins', t: 'cents, never as floats.' },
    ]);
  });

  it('PLAIN-1.5: a new Module is every clause added; a deleted one its base, every clause removed; an unchanged one marks nothing; no base, no diff', () => {
    const added = compareModules(MODULE, '');
    expect(added.stats.removed + added.stats.changed).toBe(0);
    expect(added.stats.added).toBe(8);
    expect(added.module.specs.every((s) => s.state === 'added')).toBe(true);

    const deleted = compareModules(null, MODULE);
    expect(deleted.stats.added + deleted.stats.changed).toBe(0);
    expect(deleted.stats.removed).toBe(8);
    expect(deleted.module.specs.every((s) => s.state === 'removed')).toBe(true);

    const same = compareModules(MODULE, MODULE);
    expect(same.stats).toMatchObject({ added: 0, changed: 0, removed: 0, touched: [] });

    const none = compareModules(MODULE, null);
    expect(none.diffed).toBe(false);
    expect(none.stats.touched).toEqual([]);
  });

  it('PLAIN-1.6: a functional spec added or removed in a Module that marks its specs is a new or removed spec', () => {
    const next = MODULE.replace('> spec: §1.2\n\n- A rate can be edited inline.\n', '> spec: §1.3\n\n- Rates export to CSV.\n');
    const c = compareModules(next, MODULE);
    expect(c.module.specs.map((s) => [s.id, s.state])).toEqual([
      ['§1.1', 'same'],
      ['§1.3', 'added'],
      ['§1.2', 'removed'],
    ]);
    expect(c.stats.touched.filter((t) => t.newSpec || t.removedSpec).map((t) => t.where).sort()).toEqual(['§1.2', '§1.3']);
  });

  it('PLAIN-2.3: two versions of a definition compare as clauses do', () => {
    const marked = compareClauses(['- :Deal: is an opportunity.', '  - It has a pipeline.'], ['- :Deal: is a sales opportunity.', '  - It has a pipeline.', '  - It has a probability.']);
    expect(states(marked)).toEqual([
      ['changed', ':Deal: is a sales opportunity.'],
      ['same', 'It has a pipeline.'],
      ['added', 'It has a probability.'],
    ]);
  });

  it("PLAIN-1.6: on crm.plain, one rewritten definition is one change and nothing else is marked", () => {
    const def = /^- :([A-Za-z]+): (.+)$/m.exec(crm)!;
    const next = crm.replace(def[0], `- :${def[1]}: ${def[2]} Edited.`);
    const c = compareModules(next, crm);
    expect(c.stats).toMatchObject({ added: 0, changed: 1, removed: 0 });
    expect(c.touchedSections).toEqual(['definitions']);
  });
});
