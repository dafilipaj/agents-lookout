import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkoutId, type KnownCheckout } from './changes.ts';
import { run } from './exec.ts';
import { Plain } from './plain.ts';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8' }).trim();
const S = (session: string, checkout: string) => ({ kind: 'session', session, checkout });
const PLAIN_FIXTURES = join(import.meta.dirname, 'fixtures', 'plain', 'shop', 'plain');
const ABILITY_FIXTURES = join(import.meta.dirname, 'fixtures', 'abilities');

let root: string;
let checkout: KnownCheckout;

const put = (repo: string, path: string, text: string) => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
};
const mod = (specs: string) => `---\ndescription: m\n---\n\n***functional specs***\n\n${specs}`;

const CATALOGUE = (rule: string, extra = '') => `
export const X = {
  /** Doing it. */
  'x.can_do': { subject: 'x', description: 'Do it', when: ${rule} },
  'x.can_gone': { subject: 'x', description: 'Gone soon', when: { flag: 'g' } },
  ${extra}
}`;

function plain(c: KnownCheckout = checkout) {
  return new Plain({ runner: run, checkout: (s, id) => (s === 'sess' && id === c.id ? c : null), viewedFile: join(root, `viewed-${Math.random()}.json`) });
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lookout-plain-refs-')));
  const repo = join(root, 'shop');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  put(repo, 'plain/a.plain', mod('> spec: §1.1\n- The first names §1.2, §2.1, §2.2–§2.3, §9.9 and §3.1, and `x.can_do`, `x.can_gone`, `x.can_new`, `x.can_never`, `y.can_x` and `x.can_lead`.\n\n> spec: §1.2\n- The second.\n'));
  put(repo, 'plain/sub/b.plain', mod('> spec: §2.1\n- A spec in a sub folder.\n  - Its detail.\n\n  ***acceptance tests***\n  - It works.\n\n> why it is\n\n> spec: §2.2\n- Before the branch.\n\n> spec: §2.3\n- Gone in the branch.\n'));
  put(repo, 'other/c.plain', mod('> spec: §3.1\n- Outside the folder.\n'));
  put(repo, 'apps/web/src/lib/abilities/catalogue/x.ts', CATALOGUE("{ fact: 'a' }", "'x.can_lead': { subject: 'x', description: 'Leads', when: { ability: 'x.can_do' } },"));
  put(repo, 'node_modules/z/abilities/catalogue.ts', "export const Z = { 'y.can_x': { description: 'Hidden', when: { fact: 'a' } } }");
  git(repo, 'add', '-f', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'switch', '-q', '-c', 'feature');
  // The branch changes §2.2, removes §2.3, changes x.can_do's rule, drops x.can_gone and adds x.can_new, in a package's catalogue.
  put(repo, 'plain/sub/b.plain', mod('> spec: §2.1\n- A spec in a sub folder.\n  - Its detail.\n\n  ***acceptance tests***\n  - It works.\n\n> why it is\n\n> spec: §2.2\n- After the branch.\n'));
  put(repo, 'apps/web/src/lib/abilities/catalogue/x.ts', CATALOGUE("{ allOf: [{ fact: 'a' }, { permission: 'p' }] }", "'x.can_lead': { subject: 'x', description: 'Leads', when: { ability: 'x.can_do' } },").replace(/\s*'x\.can_gone'.*\n/, '\n'));
  put(repo, 'packages/time/abilities/catalogue.ts', "export const T = { 'x.can_new': { subject: 'x', description: 'New', when: { addon: 'n' } } }");
  checkout = { id: checkoutId(repo), root: repo, repo: 'shop', where: 'feature', baseSha: base, commonDir: join(repo, '.git'), files: [] };
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('references explained in place', () => {
  it('PLAIN-7.2, PLAIN-7.3: a § in another Module under the folder is found, with its clauses at head and base and its counts', async () => {
    const a = await plain().read(S('sess', checkout.id), 'plain/a.plain');
    expect(a.specs['§2.1']).toEqual({ module: 'plain/sub/b.plain', lines: ['- A spec in a sub folder.', '  - Its detail.'], baseLines: ['- A spec in a sub folder.', '  - Its detail.'], tests: 1, notes: 1 });
    expect(a.specs['§2.2']).toMatchObject({ lines: ['- After the branch.'], baseLines: ['- Before the branch.'] });
    expect(a.specs['§2.3']).toMatchObject({ lines: null, baseLines: ['- Gone in the branch.'] });
    // This Module's own specs aren't looked up; a Module outside the folder isn't read.
    expect(a.specs['§1.2']).toBeUndefined();
    expect(a.specs['§3.1']).toBeUndefined();
  });

  it('PLAIN-7.4: a § no Module under the folder has is absent from the answer', async () => {
    const a = await plain().read(S('sess', checkout.id), 'plain/a.plain');
    expect(a.specs['§9.9']).toBeUndefined();

    // A marker the parser doesn't read as one (in an unclosed front matter, or split over two lines) is no spec, and no error.
    put(checkout.root, 'plain/sub/draft.plain', '---\ndescription: d\n\n> spec: §9.8\n- Half written.\n');
    put(checkout.root, 'plain/sub/wrapped.plain', mod('> spec:\n§9.7\n- Wrapped.\n'));
    put(checkout.root, 'plain/refs.plain', mod('> spec: §1.1\n- Names §9.8 and §9.7.\n'));
    try {
      const r = await plain().read(S('sess', checkout.id), 'plain/refs.plain');
      expect(r.specs).toEqual({});
    } finally {
      for (const f of ['plain/sub/draft.plain', 'plain/sub/wrapped.plain', 'plain/refs.plain']) rmSync(join(checkout.root, f));
    }
  });

  it('PLAIN-7.5, PLAIN-7.7: each key gets its entry at head and base, those its rule names too, from either catalogue file', async () => {
    const a = await plain().read(S('sess', checkout.id), 'plain/a.plain');
    expect(a.catalogue).toBe(true);
    expect(a.abilities['x.can_do']!.head).toMatchObject({ description: 'Do it', doc: 'Doing it.', file: 'apps/web/src/lib/abilities/catalogue/x.ts', rule: { allOf: [{ kind: 'fact', name: 'a' }, { kind: 'permission', name: 'p' }] } });
    expect(a.abilities['x.can_do']!.base).toMatchObject({ rule: { kind: 'fact', name: 'a' } });
    expect(a.abilities['x.can_new']).toMatchObject({ head: { description: 'New', file: 'packages/time/abilities/catalogue.ts' }, base: null });
    expect(a.abilities['x.can_gone']).toMatchObject({ head: null, base: { description: 'Gone soon' } });
    expect(a.abilities['x.can_lead']!.head!.rule).toEqual({ kind: 'ability', name: 'x.can_do' });
  });

  it('PLAIN-7.8: a key no catalogue holds is absent, one only node_modules holds too; with no catalogue, `catalogue` is false', async () => {
    const a = await plain().read(S('sess', checkout.id), 'plain/a.plain');
    expect(a.abilities['x.can_never']).toBeUndefined();
    expect(a.abilities['y.can_x']).toBeUndefined();

    const bare = join(root, 'bare');
    mkdirSync(bare);
    git(bare, 'init', '-q', '-b', 'main');
    put(bare, 'plain/a.plain', mod('> spec: §1.1\n- Names `x.can_do`.\n'));
    git(bare, 'add', '.');
    git(bare, 'commit', '-q', '-m', 'base');
    const c: KnownCheckout = { id: checkoutId(bare), root: bare, repo: 'bare', where: 'main', baseSha: git(bare, 'rev-parse', 'HEAD'), commonDir: join(bare, '.git'), files: [] };
    const b = await plain(c).read(S('sess', c.id), 'plain/a.plain');
    expect(b.catalogue).toBe(false);
    expect(b.abilities).toEqual({});
  });

  it("PLAIN-7.9: crm.plain with its § in other Modules and its keys in a fantastic-sized catalogue takes under 500 ms", async () => {
    const repo = join(root, 'big');
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    cpSync(PLAIN_FIXTURES, join(repo, 'plain'), { recursive: true });
    // Every § crm.plain names outside itself, in Modules as big as fantastic-productive's (2.2 MB in all).
    const crm = readFileSync(join(repo, 'plain', 'crm.plain'), 'utf8');
    const own = new Set([...crm.matchAll(/^>\s?spec:\s*(§[\d.]*\d)\s*$/gm)].map((m) => m[1]));
    const wanted = [...new Set(crm.match(/§\d+(?:\.\d+)*/g) ?? [])].filter((id) => !own.has(id));
    expect(wanted.length).toBeGreaterThan(5);
    const filler = Array.from({ length: 400 }, (_, i) => `- Filler clause ${i} names :Deal: and \`deal.can_x\`, as §${i}.1 says.\n  - Detail.\n`).join('');
    for (let m = 0; m < 45; m++) {
      const mine = wanted.filter((_, i) => i % 45 === m);
      put(repo, `plain/filler-${m}.plain`, mod([...mine.map((id) => `> spec: ${id}\n- The spec ${id}.\n`), `> spec: §${900 + m}.1\n${filler}`].join('\n')));
    }
    // A catalogue as big as fantastic-productive's (27 files, 458 KB): person.ts and expense.ts, as big as its own, many times.
    const person = readFileSync(join(ABILITY_FIXTURES, 'person.ts.fixture'), 'utf8');
    const expense = readFileSync(join(ABILITY_FIXTURES, 'expense.ts.fixture'), 'utf8');
    for (let i = 0; i < 13; i++) {
      put(repo, `apps/web/src/lib/abilities/catalogue/person${i}.ts`, person);
      put(repo, `packages/p${i}/abilities/catalogue.ts`, expense);
    }
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'base');
    const c: KnownCheckout = { id: checkoutId(repo), root: repo, repo: 'big', where: 'main', baseSha: git(repo, 'rev-parse', 'HEAD'), commonDir: join(repo, '.git'), files: [] };
    const p = plain(c);
    const cold = performance.now();
    const first = await p.read(S('sess', c.id), 'plain/crm.plain');
    const coldMs = performance.now() - cold;
    expect(Object.keys(first.specs).length).toBe(wanted.length);
    const warm = performance.now();
    await p.read(S('sess', c.id), 'plain/crm.plain'); // as a view's later reads are
    expect(performance.now() - warm).toBeLessThan(500);
    expect(coldMs).toBeLessThan(500);
  });

  it("PLAIN-7.9: a view's later reads reuse the working tree's file list for 15 s, yet read each file's text fresh", async () => {
    const calls: (readonly string[])[] = [];
    const counting: typeof run = (cmd, args, opts) => {
      calls.push(args);
      return run(cmd, args, opts);
    };
    const p = new Plain({ runner: counting, checkout: (s, id) => (s === 'sess' && id === checkout.id ? checkout : null), viewedFile: join(root, `viewed-${Math.random()}.json`) });
    const lists = () => calls.filter((a) => a.includes('ls-files')).length;
    const now = vi.spyOn(Date, 'now');
    const t0 = 1_000_000;
    const file = join(checkout.root, 'apps/web/src/lib/abilities/catalogue/x.ts');
    const before = readFileSync(file, 'utf8');
    try {
      now.mockReturnValue(t0);
      await p.read(S('sess', checkout.id), 'plain/a.plain');
      const first = lists();
      expect(first).toBeGreaterThan(0);
      writeFileSync(file, before.replace("description: 'Do it'", "description: 'Do it now'"));
      now.mockReturnValue(t0 + 14_000);
      const again = await p.read(S('sess', checkout.id), 'plain/a.plain');
      expect(lists()).toBe(first);
      expect(again.abilities['x.can_do']!.head!.description).toBe('Do it now');
      now.mockReturnValue(t0 + 15_000);
      await p.read(S('sess', checkout.id), 'plain/a.plain');
      expect(lists()).toBe(first * 2);
    } finally {
      now.mockRestore();
      writeFileSync(file, before);
    }
  });
});
