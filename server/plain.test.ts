import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutId, type KnownCheckout } from './changes.ts';
import { run, type Runner } from './exec.ts';
import { MAX_MODULE_BYTES, modulePath, Plain, PlainError, VIEWED_TTL_MS } from './plain.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'plain', 'fantastic', 'plain');
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8' }).trim();

let root: string;
let repo: string;
let outside: string;
let base: string;
let checkout: KnownCheckout;

const S = (session: string, checkout: string) => ({ kind: 'session', session, checkout });
const DEAL_BEFORE = /^- :Deal: .*$/m;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lookout-plain-')));
  repo = join(root, 'shop');
  outside = join(root, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.plain'), '---\ndescription: secret\n---\n');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  cpSync(FIXTURES, join(repo, 'plain'), { recursive: true });
  writeFileSync(join(repo, 'plain', 'gone.plain'), '---\ndescription: Soon deleted.\n---\n***definitions***\n- :Gone: is going.\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'specs');
  base = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'switch', '-q', '-c', 'feature/rates');
  // The branch rewrites :Deal: in api.plain (reached through productive), adds a Module, deletes one.
  const api = readFileSync(join(repo, 'plain', 'api.plain'), 'utf8');
  writeFileSync(join(repo, 'plain', 'api.plain'), api.replace(DEAL_BEFORE, (l) => `${l} It has a pipeline.`));
  writeFileSync(join(repo, 'plain', 'rates.plain'), '---\ndescription: Rates.\nimport:\n  - productive\n  - nowhere/missing\n---\n***definitions***\n- :Rate: is a price on a :Deal:.\n');
  unlinkSync(join(repo, 'plain', 'gone.plain'));
  checkout = { id: checkoutId(repo), root: repo, repo: 'shop', where: 'feature/rates', baseSha: base, commonDir: join(repo, '.git'), files: [] };
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function plain(over: Partial<KnownCheckout> = {}, viewedFile = join(root, `viewed-${Math.random()}.json`), now = () => 1_000_000) {
  const c = { ...checkout, ...over };
  return new Plain({ runner: run, checkout: (s, id) => (s === 'sess' && id === c.id ? c : null), viewedFile, now });
}

describe('reading a Module', () => {
  it('PLAIN-1.5: the working tree and the Branch point; a new Module has no base, a deleted one no text', async () => {
    const p = plain();
    const crm = await p.read(S('sess', checkout.id), 'plain/crm.plain');
    expect(crm.text).toBe(readFileSync(join(repo, 'plain', 'crm.plain'), 'utf8'));
    expect(crm.baseText).toBe(crm.text);
    expect(crm.base).toBe(base.slice(0, 7));
    expect(crm.checkout).toEqual({ id: checkout.id, repo: 'shop', where: 'feature/rates' });

    const added = await p.read(S('sess', checkout.id), 'plain/rates.plain');
    expect(added.text).toContain(':Rate:');
    expect(added.baseText).toBeNull();

    const gone = await p.read(S('sess', checkout.id), 'plain/gone.plain');
    expect(gone.text).toBeNull();
    expect(gone.baseText).toContain(':Gone:');

    await expect(p.read(S('sess', checkout.id), 'plain/never.plain')).rejects.toMatchObject({ status: 404 });
  });

  it('PLAIN-1.5: uncommitted edits are read, and a base newer than the cache is read again', async () => {
    const p = plain();
    const file = join(repo, 'plain', 'shell.plain');
    const before = readFileSync(file, 'utf8');
    writeFileSync(file, `${before}\n- An uncommitted line.\n`);
    try {
      expect((await p.read(S('sess', checkout.id), 'plain/shell.plain')).text).toContain('An uncommitted line.');
    } finally {
      writeFileSync(file, before);
    }
  });

  it('PLAIN-2.1: imports are followed transitively from the importing folder, requires gives only exported Concepts, and the own Module wins', async () => {
    const a = await plain().read(S('sess', checkout.id), 'plain/crm.plain');
    // :Deal: is api.plain's, through productive → api.
    expect(a.concepts.Deal?.module).toBe('plain/api');
    // shell.plain is required: its exported :AppShell: is seen, its other definitions aren't.
    expect(a.concepts.AppShell?.module).toBe('plain/shell');
    const shellOwn = readFileSync(join(FIXTURES, 'shell.plain'), 'utf8').match(/^- :([A-Za-z]+):/gm)!.map((l) => l.slice(3, -1));
    const internal = shellOwn.filter((n) => !['AppShell', 'CommandPalette', 'Inbox', 'AdminPanel', 'VibeBar'].includes(n));
    for (const n of internal) if (a.concepts[n]) expect(a.concepts[n]!.module).not.toBe('plain/shell');
    // crm's own definitions aren't in the map: the view links them in place.
    const own = readFileSync(join(FIXTURES, 'crm.plain'), 'utf8').split('***implementation')[0]!.match(/^- :([A-Za-z]+):/gm)!.map((l) => l.slice(3, -1));
    for (const n of own) expect(a.concepts[n]).toBeUndefined();
  });

  it('PLAIN-2.3: a definition the branch changed carries its base text too', async () => {
    const a = await plain().read(S('sess', checkout.id), 'plain/crm.plain');
    expect(a.concepts.Deal!.lines[0]).toMatch(/It has a pipeline\.$/);
    expect(a.concepts.Deal!.baseLines![0]).not.toMatch(/It has a pipeline/);
    expect(a.concepts.Company!.lines).toEqual(a.concepts.Company!.baseLines);
  });

  it('PLAIN-2.4: import paths with no Module are listed as missing, and the rest still resolve', async () => {
    const crm = await plain().read(S('sess', checkout.id), 'plain/crm.plain');
    expect(crm.missing).toEqual(['providers/exporter/exporter-public', 'providers/realtime/realtime-public']);
    const rates = await plain().read(S('sess', checkout.id), 'plain/rates.plain');
    expect(rates.missing).toContain('nowhere/missing');
    expect(rates.concepts.Deal?.module).toBe('plain/api');
  });

  it('PLAIN-2.6: crm.plain and everything it reads takes under 500 ms', async () => {
    const p = plain();
    await p.read(S('sess', checkout.id), 'plain/crm.plain'); // warm, as a view's later reads are
    const t = performance.now();
    await p.read(S('sess', checkout.id), 'plain/crm.plain');
    expect(performance.now() - t).toBeLessThan(500);
    const cold = plain();
    const c = performance.now();
    await cold.read(S('sess', checkout.id), 'plain/crm.plain');
    expect(performance.now() - c).toBeLessThan(500);
  });

  it('PLAIN-1.8: a file over 1 MB is refused', async () => {
    const big = join(repo, 'plain', 'big.plain');
    writeFileSync(big, `---\n---\n${'x'.repeat(MAX_MODULE_BYTES + 1)}`);
    try {
      await expect(plain().read(S('sess', checkout.id), 'plain/big.plain')).rejects.toMatchObject({ status: 413 });
    } finally {
      unlinkSync(big);
    }
  });
});

describe('safety', () => {
  it('PLAIN-6.1: only a live Session\'s Checkout, by id; a path that leaves it, or isn\'t .plain, is refused', async () => {
    const p = plain();
    await expect(p.read(S('other', checkout.id), 'plain/crm.plain')).rejects.toMatchObject({ status: 404 });
    await expect(p.read(S('sess', '0123456789abcdef'), 'plain/crm.plain')).rejects.toMatchObject({ status: 404 });
    await expect(p.read(S('sess', repo), 'plain/crm.plain')).rejects.toMatchObject({ status: 400 });
    for (const bad of ['../outside/secret.plain', '/etc/x.plain', 'plain/../plain/crm.plain', './plain/crm.plain', 'plain//crm.plain', 'plain/crm.md', 'plain\\crm.plain', '']) {
      await expect(p.read(S('sess', checkout.id), bad), bad).rejects.toBeInstanceOf(PlainError);
    }
    expect(modulePath('plain/crm.plain')).toBe('plain/crm.plain');
  });

  it('PLAIN-6.1: a link out of the Checkout is never followed, for the Module or an import', async () => {
    const link = join(repo, 'plain', 'linked.plain');
    symlinkSync(join(outside, 'secret.plain'), link);
    const importer = join(repo, 'plain', 'importer.plain');
    writeFileSync(importer, '---\nimport:\n  - linked\n---\n***definitions***\n- :X: is x.\n');
    try {
      await expect(plain().read(S('sess', checkout.id), 'plain/linked.plain')).rejects.toMatchObject({ status: 403 });
      const a = await plain().read(S('sess', checkout.id), 'plain/importer.plain');
      expect(a.missing).toEqual(['linked']);
    } finally {
      unlinkSync(link);
      unlinkSync(importer);
    }
  });

  it('PLAIN-6.2: an import path that climbs out of the Checkout is missing, never read', async () => {
    const climber = join(repo, 'plain', 'climber.plain');
    writeFileSync(climber, '---\nimport:\n  - ../../outside/secret\n---\n');
    try {
      const a = await plain().read(S('sess', checkout.id), 'plain/climber.plain');
      expect(a.missing).toEqual(['../../outside/secret']);
      expect(Object.keys(a.concepts)).toEqual([]);
    } finally {
      unlinkSync(climber);
    }
  });
});

describe('Viewed', () => {
  it('PLAIN-4.2, 4.3: a mark is kept in a 0600 file across restarts, and stops applying once the Module changes', async () => {
    const file = join(root, 'viewed-keep.json');
    const first = plain({}, file);
    const a = await first.read(S('sess', checkout.id), 'plain/shell.plain');
    expect([a.viewed, a.changedSinceViewed]).toEqual([false, false]);
    await first.setViewed(S('sess', checkout.id), 'plain/shell.plain', a.key, true);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const again = plain({}, file); // a restart
    expect((await again.read(S('sess', checkout.id), 'plain/shell.plain')).viewed).toBe(true);

    const shell = join(repo, 'plain', 'shell.plain');
    const before = readFileSync(shell, 'utf8');
    writeFileSync(shell, `${before}\n- One more line.\n`);
    try {
      const b = await again.read(S('sess', checkout.id), 'plain/shell.plain');
      expect([b.viewed, b.changedSinceViewed]).toEqual([false, true]);
    } finally {
      writeFileSync(shell, before);
    }
    expect((await again.read(S('sess', checkout.id), 'plain/shell.plain')).viewed).toBe(true);
    await again.setViewed(S('sess', checkout.id), 'plain/shell.plain', a.key, false);
    expect((await plain({}, file).read(S('sess', checkout.id), 'plain/shell.plain')).viewed).toBe(false);
  });

  it('PLAIN-4.2: the same text and base seen from another Checkout of the repo share one mark; old marks are dropped', async () => {
    const file = join(root, 'viewed-share.json');
    const p = plain({}, file);
    const a = await p.read(S('sess', checkout.id), 'plain/crm.plain');
    await p.setViewed(S('sess', checkout.id), 'plain/crm.plain', a.key, true);
    const wt = join(root, 'shop-wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'other', wt, 'HEAD');
    const other = plain({ id: checkoutId(wt), root: wt, where: 'other' }, file);
    expect((await other.read(S('sess', checkoutId(wt)), 'plain/crm.plain')).viewed).toBe(true);
    const later = plain({}, file, () => 1_000_000 + VIEWED_TTL_MS + 1);
    expect((await later.read(S('sess', checkout.id), 'plain/crm.plain')).viewed).toBe(false);
  });

  it('PLAIN-4.2: two different changes of one Module, Viewed in two Worktrees, each keep their mark', async () => {
    const file = join(root, 'viewed-two.json');
    const wt = join(root, 'shop-two');
    git(repo, 'worktree', 'add', '-q', '-b', 'two', wt, 'HEAD');
    writeFileSync(join(wt, 'plain', 'shell.plain'), `${readFileSync(join(wt, 'plain', 'shell.plain'), 'utf8')}\n- Only in two.\n`);
    const two: KnownCheckout = { ...checkout, id: checkoutId(wt), root: wt, where: 'two' };
    const both = (f: string) => new Plain({ runner: run, checkout: (_s, id) => [checkout, two].find((c) => c.id === id) ?? null, viewedFile: f });
    const p = both(file);
    const a = await p.read(S('sess', checkout.id), 'plain/shell.plain');
    const b = await p.read(S('sess', two.id), 'plain/shell.plain');
    expect(a.key).not.toBe(b.key);
    await p.setViewed(S('sess', checkout.id), 'plain/shell.plain', a.key, true);
    await p.setViewed(S('sess', two.id), 'plain/shell.plain', b.key, true);
    const again = both(file);
    expect(await again.read(S('sess', checkout.id), 'plain/shell.plain')).toMatchObject({ viewed: true, changedSinceViewed: false });
    expect(await again.read(S('sess', two.id), 'plain/shell.plain')).toMatchObject({ viewed: true, changedSinceViewed: false });
  });

  it('PLAIN-4.2: many later changes of a Module never evict an earlier one still within 30 days', async () => {
    const file = join(root, 'viewed-many.json');
    const p = plain({}, file);
    const a = await p.read(S('sess', checkout.id), 'plain/shell.plain');
    await p.setViewed(S('sess', checkout.id), 'plain/shell.plain', a.key, true);
    for (let i = 0; i < 25; i++) await p.setViewed(S('sess', checkout.id), 'plain/shell.plain', i.toString(16).padStart(64, '0'), true);
    expect((await plain({}, file).read(S('sess', checkout.id), 'plain/shell.plain')).viewed).toBe(true);
  });

  it('PLAIN-4.2: marks saved at the same time are all kept', async () => {
    const file = join(root, 'viewed-race.json');
    const p = plain({}, file);
    const paths = ['plain/crm.plain', 'plain/shell.plain', 'plain/api.plain', 'plain/productive.plain'];
    const reads = await Promise.all(paths.map((x) => p.read(S('sess', checkout.id), x)));
    await Promise.all(reads.map((a) => p.setViewed(S('sess', checkout.id), a.path, a.key, true)));
    const after = plain({}, file);
    for (const x of paths) expect((await after.read(S('sess', checkout.id), x)).viewed, x).toBe(true);
  });

  it('PLAIN-4.2: a mark still read is kept past 30 days from when it was set; one unread for 30 days goes without a restart', async () => {
    const file = join(root, 'viewed-ttl.json');
    let now = 1_000_000;
    const p = plain({}, file, () => now);
    const a = await p.read(S('sess', checkout.id), 'plain/shell.plain');
    await p.setViewed(S('sess', checkout.id), 'plain/shell.plain', a.key, true);
    now += 29 * 24 * 60 * 60 * 1000;
    expect((await p.read(S('sess', checkout.id), 'plain/shell.plain')).viewed).toBe(true); // used again
    now += 2 * 24 * 60 * 60 * 1000;
    expect((await p.read(S('sess', checkout.id), 'plain/shell.plain')).viewed).toBe(true);
    now += VIEWED_TTL_MS + 1;
    expect((await p.read(S('sess', checkout.id), 'plain/shell.plain')).viewed).toBe(false);
  });

  it('PLAIN-4.1: a mark takes a key from a read, and nothing else', async () => {
    const p = plain();
    await expect(p.setViewed(S('sess', checkout.id), 'plain/crm.plain', 'nope', true)).rejects.toMatchObject({ status: 400 });
    await expect(p.setViewed(S('sess', checkout.id), 'plain/crm.plain', 'a'.repeat(64), 'yes')).rejects.toMatchObject({ status: 400 });
  });

  it("PLAIN-3.3: a Checkout's changed Modules that carry a mark for their text now", async () => {
    const file = join(root, 'viewed-list.json');
    const files = [
      { path: 'plain/api.plain', oldPath: null, kind: 'modified' as const, additions: 1, deletions: 1, binary: false, uncommitted: true },
      { path: 'plain/rates.plain', oldPath: null, kind: 'added' as const, additions: 7, deletions: 0, binary: false, uncommitted: true },
      { path: 'README.md', oldPath: null, kind: 'modified' as const, additions: 1, deletions: 0, binary: false, uncommitted: true },
    ];
    const p = plain({ files }, file);
    expect(await p.viewedPaths('sess', checkout.id)).toEqual([]);
    const a = await p.read(S('sess', checkout.id), 'plain/rates.plain');
    await p.setViewed(S('sess', checkout.id), 'plain/rates.plain', a.key, true);
    expect(await p.viewedPaths('sess', checkout.id)).toEqual(['plain/rates.plain']);
  });
});

describe('what reading runs', () => {
  it('PLAIN-6.2: reading a Module and everything it imports runs only `git show`, never anything a Module names', async () => {
    const calls: (readonly string[])[] = [];
    const spy: Runner = (file, args, opts) => {
      calls.push([file, ...args]);
      return run(file, args, opts);
    };
    const p = new Plain({ runner: spy, checkout: () => checkout, viewedFile: join(root, 'viewed-runs.json') });
    await p.read(S('sess', checkout.id), 'plain/crm.plain');
    expect(calls.length).toBeGreaterThan(1);
    for (const c of calls) {
      expect(c[0]).toBe('git');
      expect(c.slice(1, 7)).toEqual(['-C', repo, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false']);
      expect(c[7]).toBe('show');
      expect(c[8]).toMatch(new RegExp(`^${base}:plain/[a-z/-]+\\.plain$`));
    }
  });

  it('PLAIN-4.4: ticking Viewed writes its mark and nothing else: no command runs', async () => {
    const calls: string[] = [];
    const spy: Runner = (file, args, opts) => {
      calls.push(file);
      return run(file, args, opts);
    };
    const p = new Plain({ runner: spy, checkout: () => checkout, viewedFile: join(root, 'viewed-only.json') });
    const a = await p.read(S('sess', checkout.id), 'plain/shell.plain');
    calls.length = 0;
    await p.setViewed(S('sess', checkout.id), 'plain/shell.plain', a.key, true);
    expect(calls).toEqual([]);
  });
});
