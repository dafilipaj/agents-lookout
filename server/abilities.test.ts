import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isCatalogueFile, namedAbilities, parseCatalogue } from './abilities.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'abilities');
const fixture = (name: string) => readFileSync(join(FIXTURES, `${name}.ts.fixture`), 'utf8');

describe('the abilities catalogue', () => {
  it('PLAIN-7.6: its files are abilities/catalogue/*.ts and abilities/catalogue.ts, outside node_modules', () => {
    expect(isCatalogueFile('apps/web/src/lib/abilities/catalogue/person.ts')).toBe(true);
    expect(isCatalogueFile('packages/time/abilities/catalogue.ts')).toBe(true);
    expect(isCatalogueFile('abilities/catalogue.ts')).toBe(true);
    expect(isCatalogueFile('node_modules/x/abilities/catalogue.ts')).toBe(false);
    expect(isCatalogueFile('apps/web/src/lib/abilities/catalogue/deep/person.ts')).toBe(false);
    expect(isCatalogueFile('apps/web/src/lib/abilities/resolver.ts')).toBe(false);
  });

  it('PLAIN-7.5, PLAIN-7.6: an entry gives its description, the comment above it, its rule as conditions, its line and its source', () => {
    const entries = parseCatalogue(fixture('person'), 'catalogue/person.ts');
    const e = entries.get('person.can_log_hours')!;
    expect(e.description).toBe('Log and edit this person’s hours');
    expect(e.doc).toBe("Logging hours for this person: a member who logs hours, the reader's own on its own, anyone\nelse's on `hours_manage`.");
    expect(e.rule).toEqual({ allOf: [{ kind: 'fact', name: 'logsHours' }, { anyOf: [{ kind: 'fact', name: 'self' }, { kind: 'permission', name: 'hours_manage' }] }] });
    expect(e.source).toBe("{ allOf: [{ fact: 'logsHours' }, { anyOf: [{ fact: 'self' }, { permission: 'hours_manage' }] }] }");
    expect(e.file).toBe('catalogue/person.ts');
    expect(fixture('person').split('\n')[e.line - 1]).toContain("'person.can_log_hours': {");
    // An ability a rule names is listed, for its own description beside it.
    expect(namedAbilities(entries.get('person.can_open_day_in_team_hours')!.rule)).toEqual(['person.can_log_hours']);
    // Every entry of a catalogue-sized file reads.
    for (const [key, x] of entries) expect({ key, rule: x.rule !== null, description: !!x.description }).toEqual({ key, rule: true, description: true });
  });

  it('PLAIN-7.6: a rule naming a constant of the same file, a spread list, a list constant and a lone custom rule are read through', () => {
    const entries = parseCatalogue(fixture('expense'), 'catalogue/expense.ts');
    expect(entries.get('expense.can_manage')!.rule).toEqual({
      anyOf: [
        { allOf: [{ kind: 'fact', name: 'own' }, { kind: 'permission', name: 'costs_manage_self' }] },
        { allOf: [{ not: { kind: 'fact', name: 'own' } }, { kind: 'permission', name: 'costs_manage' }] },
      ],
    });
    const src = `
const STATE = [{ fact: 'open' }, { not: { fact: 'locked' } }] as const
const BOTH = [{ flag: 'a' }, { addon: 'b' }]
export const CATALOGUE = {
  /** Spread. */
  'x.can_spread': { subject: 'x', description: 'Spread ' + 'in', when: { allOf: [{ permission: 'p' }, ...STATE] } },
  'x.can_list': { subject: 'x', description: 'List', when: { anyOf: BOTH } },
  'x.can_custom': { subject: 'x', description: 'Custom', custom: 'x.rule', inputs: ['x.id'] },
  'x.can_feature': { subject: 'x', description: "Feature", when: { feature: 'budgets', state: 'limit' } },
}`;
    const e = parseCatalogue(src, 'c.ts');
    expect(e.get('x.can_spread')).toMatchObject({ description: 'Spread in', doc: 'Spread.', rule: { allOf: [{ kind: 'permission', name: 'p' }, { kind: 'fact', name: 'open' }, { not: { kind: 'fact', name: 'locked' } }] } });
    expect(e.get('x.can_list')!.rule).toEqual({ anyOf: [{ kind: 'flag', name: 'a' }, { kind: 'addon', name: 'b' }] });
    expect(e.get('x.can_custom')).toMatchObject({ rule: { kind: 'custom', name: 'x.rule' }, source: "custom: 'x.rule'" });
    expect(e.get('x.can_feature')!.rule).toEqual({ kind: 'feature', name: 'budgets', state: 'limit' });
  });

  it('PLAIN-7.6: a rule that is not conditions keeps its source and no rule; nothing is evaluated', () => {
    const src = `
const LOOP = [{ allOf: LOOP }]
export const C = {
  'x.can_loop': { subject: 'x', description: 'Loop', when: { anyOf: LOOP } },
  'x.can_call': { subject: 'x', description: 'Call', when: build({ fact: 'a' }) },
  'x.can_member': { subject: 'x', description: 'Member', when: RULES.open },
  'x.can_unknown': { subject: 'x', description: 'Unknown', when: { someday: 'x' } },
  'x.can_missing': { subject: 'x', description: 'Missing', when: { allOf: [...NOWHERE] } },
  'x.can_template': { subject: 'x', description: \`Template \${1}\`, when: { fact: \`a\${b}\` } },
  'x.can_ok': { subject: 'x', description: 'Ok', when: { fact: 'a' } },
}`;
    const e = parseCatalogue(src, 'c.ts');
    // A list constant naming itself is a cycle: no rule, and every other entry still reads.
    expect(e.get('x.can_loop')).toMatchObject({ rule: null, source: '{ anyOf: LOOP }' });
    expect(e.get('x.can_call')).toMatchObject({ rule: null, source: "build({ fact: 'a' })" });
    expect(e.get('x.can_member')).toMatchObject({ rule: null, source: 'RULES.open' });
    expect(e.get('x.can_unknown')).toMatchObject({ rule: null, source: "{ someday: 'x' }" });
    expect(e.get('x.can_missing')!.rule).toBeNull();
    expect(e.get('x.can_template')).toMatchObject({ description: '', rule: null });
    expect(e.get('x.can_ok')!.rule).toEqual({ kind: 'fact', name: 'a' });
  });

  it("PLAIN-7.5: a description's escapes read as the characters they stand for", () => {
    const src = String.raw`export const C = {
  'x.can_esc': { subject: 'x', description: 'It\u2019s \x41 \u{1D400} \'quoted\' tab\there, one \
line', when: { fact: 'a' } },
}`;
    expect(parseCatalogue(src, 'c.ts').get('x.can_esc')!.description).toBe("It’s A 𝐀 'quoted' tab\there, one line");
  });
});
