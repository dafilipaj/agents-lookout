import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutId } from './changes.ts';
import { run, type Runner } from './exec.ts';
import { Plain, PlainError } from './plain.ts';
import { PR_REF_TTL_MS, PR_REFETCH_MS, PlainPrs, productiveioRepo } from './plain-prs.ts';
import { branchName } from './work.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'plain', 'fantastic', 'plain');
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8' }).trim();
const URL = 'https://github.com/productiveio/shop.git';

let root: string;
let upstream: string;
let origin: string;
let clone: string;
let notAClone: string;
let prHead: string;
let branchPoint: string;

/** A push to the PR: a new commit on the feature branch, set as GitHub's `refs/pull/7/head`. */
function push(file: string, text: string) {
  git(upstream, 'switch', '-q', 'feature/rates');
  writeFileSync(join(upstream, file), text);
  git(upstream, 'commit', '-qam', 'push');
  prHead = git(upstream, 'rev-parse', 'HEAD');
  git(upstream, 'push', '-q', origin, 'feature/rates');
  git(origin, 'update-ref', 'refs/pull/7/head', prHead);
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lookout-plain-prs-')));
  upstream = join(root, 'upstream');
  origin = join(root, 'origin.git');
  clone = join(root, 'shop');
  notAClone = join(root, 'elsewhere');
  mkdirSync(upstream);
  mkdirSync(notAClone);
  git(upstream, 'init', '-q', '-b', 'main');
  cpSync(FIXTURES, join(upstream, 'plain'), { recursive: true });
  writeFileSync(join(upstream, 'README.md'), 'shop\n');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '-qm', 'specs');
  branchPoint = git(upstream, 'rev-parse', 'HEAD');
  // The PR: rewrites :Deal: in api.plain, adds rates.plain, and touches a file that isn't a Module.
  git(upstream, 'switch', '-q', '-c', 'feature/rates');
  const api = readFileSync(join(upstream, 'plain', 'api.plain'), 'utf8');
  writeFileSync(join(upstream, 'plain', 'api.plain'), api.replace(/^- :Deal: .*$/m, (l) => `${l} It has a pipeline.`));
  writeFileSync(join(upstream, 'plain', 'rates.plain'), '---\ndescription: Rates.\nimport:\n  - productive\n---\n***definitions***\n- :Rate: is a price on a :Deal:.\n');
  writeFileSync(join(upstream, 'README.md'), 'shop, with rates\n');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '-qm', 'rates');
  prHead = git(upstream, 'rev-parse', 'HEAD');
  // main moves on after the PR branched: its change isn't the PR's, so the base is the merge-base.
  git(upstream, 'switch', '-q', 'main');
  writeFileSync(join(upstream, 'plain', 'shell.plain'), `${readFileSync(join(upstream, 'plain', 'shell.plain'), 'utf8')}\n- A later line on main.\n`);
  git(upstream, 'commit', '-qam', 'main moves on');
  execFileSync('git', ['clone', '-q', '--bare', upstream, origin], { env });
  git(origin, 'update-ref', 'refs/pull/7/head', prHead);
  execFileSync('git', ['clone', '-q', origin, clone], { env });
  // origin says GitHub, and git is sent to the local bare repo instead.
  git(clone, 'remote', 'set-url', 'origin', URL);
  git(clone, 'config', `url.${origin}.insteadOf`, URL);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** git as it is; never the real gh, which would ask GitHub. */
const noGh: Runner = (file, args, opts) => (file === 'gh' ? Promise.reject(Object.assign(new Error('gh'), { code: 1 })) : run(file, args, opts));

function prs(over: { now?: () => number; base?: string | null; runner?: Runner; candidates?: string[] } = {}) {
  return new PlainPrs({
    runner: over.runner ?? noGh,
    candidates: () => over.candidates ?? [notAClone, join(clone, 'plain')],
    baseBranch: (repo) => (repo === 'shop' ? (over.base === undefined ? 'main' : over.base) : null),
    clonesFile: join(root, `clones-${Math.random()}.json`),
    now: over.now ?? (() => 1_000_000),
    env,
  });
}

const refs = (...prefixes: string[]) => git(clone, 'for-each-ref', '--format=%(refname) %(objectname)', ...prefixes);

describe('finding a clone', () => {
  it('PLAIN-5.2: a productiveio repo by its origin URL, written any way git takes', () => {
    for (const url of ['https://github.com/productiveio/shop.git', 'https://github.com/productiveio/Shop', 'git@github.com:productiveio/shop.git', 'ssh://git@github.com/productiveio/shop', 'https://x-access-token@github.com/productiveio/shop/']) {
      expect(productiveioRepo(url), url).toBe('shop');
    }
    for (const url of ['https://github.com/someone/shop.git', 'https://gitlab.com/productiveio/shop', 'git@github.com:productiveio/shop/sub', '/local/shop.git']) {
      expect(productiveioRepo(url), url).toBeNull();
    }
    expect(branchName('develop')).toBe('develop');
    expect(branchName('release/2026-11')).toBe('release/2026-11');
    for (const bad of ['-x', '../main', 'a..b', 'a.lock', '.hidden', 'a b', '', null]) expect(branchName(bad), String(bad)).toBeNull();
  });

  it("PLAIN-5.1, 5.4: the repos Lookout has a clone of, and a PR of another repo says there's none", async () => {
    const p = prs();
    expect(await p.clones()).toEqual(['shop']);
    await expect(p.tree('lantern', 7, true)).rejects.toMatchObject({ status: 404, message: 'No local clone of lantern.' });
  });

  it('PLAIN-5.2: a clone found once is remembered, after its Session ended', async () => {
    const file = join(root, 'clones-remembered.json');
    const opts = { runner: run, baseBranch: () => 'main', clonesFile: file, now: () => 1_000_000, env };
    expect(await new PlainPrs({ ...opts, candidates: () => [clone] }).clones()).toEqual(['shop']);
    await new Promise((r) => setTimeout(r, 50));
    expect(await new PlainPrs({ ...opts, candidates: () => [] }).clones()).toEqual(['shop']);
  });
});

describe("fetching a PR's commits", () => {
  it('PLAIN-5.2: only into refs/lookout/pr/<n>: no checkout, working tree, index, branch or FETCH_HEAD changes', async () => {
    // main moves on upstream after the clone: fetching the base must not move origin/main.
    git(upstream, 'switch', '-q', 'main');
    writeFileSync(join(upstream, 'README.md'), 'shop, later\n');
    git(upstream, 'commit', '-qam', 'later on main');
    git(upstream, 'push', '-q', origin, 'main');
    const before = { head: git(clone, 'rev-parse', 'HEAD'), status: git(clone, 'status', '--porcelain'), refs: refs('refs/heads', 'refs/remotes', 'refs/tags') };
    expect(before.refs).toContain('refs/remotes/origin/main');
    const { tree } = await prs().tree('shop', 7, true);
    expect(refs('refs/lookout/')).toBe(`refs/lookout/pr/7/base ${git(origin, 'rev-parse', 'main')}\nrefs/lookout/pr/7/head ${prHead}`);
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(before.head);
    expect(git(clone, 'status', '--porcelain')).toBe(before.status);
    expect(refs('refs/heads', 'refs/remotes', 'refs/tags')).toBe(before.refs);
    expect(existsSync(join(clone, '.git', 'FETCH_HEAD'))).toBe(false);
    expect(tree).toMatchObject({ root: clone, repo: 'shop', where: '#7', headSha: prHead, baseSha: branchPoint, baseName: 'merge-base with main', commonDir: join(clone, '.git') });
    expect(tree.id).toBe(checkoutId(`pr\u0000${join(clone, '.git')}\u0000${7}`));
  });

  it("PLAIN-5.3: the PR's changed Modules against the merge-base, not main's later commits", async () => {
    const { paths } = await prs().tree('shop', 7, true);
    expect(paths).toEqual(['plain/api.plain', 'plain/rates.plain']);
  });

  it('PLAIN-5.3: a newer push is fetched on opening, and every 60 s while open, not on every read', async () => {
    let now = 2_000_000;
    const calls: string[][] = [];
    const counting: Runner = (file, args, opts) => {
      if (args.includes('fetch')) calls.push([...args]);
      return noGh(file, args, opts);
    };
    const p = prs({ now: () => now, runner: counting });
    await p.tree('shop', 7, true);
    expect(calls).toHaveLength(1);
    push('plain/rates.plain', '---\ndescription: Rates, pushed again.\n---\n***definitions***\n- :Rate: is a price.\n');
    now += 3000;
    expect((await p.tree('shop', 7, false)).tree.headSha).not.toBe(prHead); // the view's 3 s reads keep what was fetched
    expect(calls).toHaveLength(1);
    now += PR_REFETCH_MS;
    await p.tree('shop', 7, false); // due: fetched in the background, this read answers with the last fetch
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toHaveLength(2);
    expect((await p.tree('shop', 7, false)).tree.headSha).toBe(prHead);
    now += 10_000;
    await p.tree('shop', 7, true); // reopening fetches again
    expect(calls).toHaveLength(3);
  });

  it("PLAIN-5.4: a fetch that fails says why; once fetched, a later failure keeps the last fetch and says why", async () => {
    await expect(prs().tree('shop', 99, true)).rejects.toMatchObject({ status: 502 });
    const none = await prs()
      .tree('shop', 99, true)
      .catch((e: PlainError) => e.message);
    expect(none).toBe('GitHub has no PR #99 in shop.');
    let now = 3_000_000;
    let offline = false;
    const flaky: Runner = (file, args, opts) => (offline && args.includes('fetch') ? Promise.reject(Object.assign(new Error('x'), { stderr: 'fatal: unable to access: Could not resolve host: github.com\n' })) : noGh(file, args, opts));
    const p = prs({ now: () => now, runner: flaky });
    const first = await p.tree('shop', 7, true);
    offline = true;
    now += 10_000;
    const later = await p.tree('shop', 7, true);
    expect(later.error).toBe("Couldn't fetch #7: unable to access: Could not resolve host: github.com");
    expect(later.tree.headSha).toBe(first.tree.headSha);
    offline = false;
    expect((await p.tree('shop', 7, true)).error).toBeNull(); // Retry right away fetches again
  });

  it("PLAIN-5.2: without Work's base branch, gh is asked, through the repo flag", async () => {
    const asked: string[][] = [];
    let gh: string | null = 'main\n';
    const withGh: Runner = (file, args, opts) => {
      if (file === 'gh') {
        asked.push([...args]);
        return gh === null ? Promise.reject(Object.assign(new Error('gh'), { code: 1 })) : Promise.resolve(gh);
      }
      return run(file, args, opts);
    };
    let now = 6_000_000;
    const p = prs({ base: null, runner: withGh, now: () => now });
    const { tree } = await p.tree('shop', 7, true);
    expect(asked).toEqual([['pr', 'view', '7', '--repo', 'productiveio/shop', '--json', 'baseRefName', '--jq', '.baseRefName']]);
    expect(tree.baseName).toBe('merge-base with main');
    // Asked again on every fetch, so a PR retargeted on GitHub is compared with its new base.
    git(origin, 'branch', '-f', 'release', branchPoint);
    gh = 'release\n';
    now += 10_000;
    expect((await p.tree('shop', 7, true)).tree.baseName).toBe('merge-base with release');
    // gh failing keeps the base last known.
    gh = null;
    now += 10_000;
    expect((await p.tree('shop', 7, true)).tree.baseName).toBe('merge-base with release');
  });

  it('PLAIN-5.2: a sweep spares the refs of a fetch still in flight', async () => {
    let release: () => void = () => {};
    const held: Runner = async (file, args, opts) => {
      const out = await noGh(file, args, opts);
      // Between the fetch writing its refs and reading them, another PR's sweep runs.
      if (args.includes('fetch') && args.some((a) => a.includes('pr/7/head'))) await new Promise<void>((r) => (release = r));
      return out;
    };
    const p = prs({ runner: held, now: () => 7_000_000 });
    const pending = p.tree('shop', 7, true);
    await new Promise((r) => setTimeout(r, 400));
    const sweeping = p.prune(); // queued behind the fetch's lock on the clone
    await new Promise((r) => setTimeout(r, 100));
    release();
    await sweeping;
    expect(refs('refs/lookout/')).toContain('pr/7/head');
    expect((await pending).tree.headSha).toBe(prHead);
  });

  it('PLAIN-5.2: a fetch that starts while a sweep runs waits for it, so the sweep never deletes its new refs', async () => {
    git(clone, 'update-ref', 'refs/lookout/pr/7/head', prHead); // an earlier run's, so the sweep picks it
    let release: () => void = () => {};
    const held: Runner = async (file, args, opts) => {
      if (args.includes('update-ref')) await new Promise<void>((r) => (release = r));
      return noGh(file, args, opts);
    };
    const p = prs({ runner: held, now: () => 9_000_000 });
    const sweeping = p.prune();
    await new Promise((r) => setTimeout(r, 300)); // the sweep has chosen pr/7/head and waits to delete it
    const pending = p.tree('shop', 7, true);
    await new Promise((r) => setTimeout(r, 300));
    release();
    await sweeping;
    const { tree } = await pending;
    expect(tree.headSha).toBe(prHead);
    expect(refs('refs/lookout/')).toContain('pr/7/head');
  });

  it('PLAIN-6.2: ssh keeps git\'s own order: a GIT_SSH program is left as it is, a GIT_SSH_COMMAND gets batch mode', async () => {
    const seen: NodeJS.ProcessEnv[] = [];
    const spy: Runner = (file, args, opts) => {
      if (args.includes('fetch')) seen.push(opts.env ?? {});
      return noGh(file, args, opts);
    };
    const base = { runner: spy, candidates: () => [clone], baseBranch: () => 'main', clonesFile: join(root, `c-${Math.random()}.json`), now: () => 9_500_000 };
    await new PlainPrs({ ...base, env: { ...env, GIT_SSH: '/opt/my ssh/wrapper' } }).tree('shop', 7, true);
    await new PlainPrs({ ...base, env: { ...env, GIT_SSH_COMMAND: 'ssh -i ~/.ssh/work' } }).tree('shop', 7, true);
    await new PlainPrs({ ...base, env: { ...env, GIT_SSH_COMMAND: 'plink -batch' } }).tree('shop', 7, true);
    expect(seen.map((e) => [e.GIT_SSH, e.GIT_SSH_COMMAND])).toEqual([
      ['/opt/my ssh/wrapper', undefined],
      [undefined, 'ssh -i ~/.ssh/work -o BatchMode=yes'],
      [undefined, 'plink -batch'],
    ]);
  });

  it('PLAIN-6.2: a fetch never asks for a password: no terminal prompt, askpass or interactive helper, ssh in batch mode', async () => {
    const seen: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const spy: Runner = (file, args, opts) => {
      if (args.includes('fetch')) seen.push({ args: [...args], env: opts.env ?? {} });
      return noGh(file, args, opts);
    };
    await prs({ runner: spy, now: () => 8_000_000 }).tree('shop', 7, true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.args).toEqual(expect.arrayContaining(['credential.interactive=never', 'core.hooksPath=/dev/null', '--refmap=', '--no-write-fetch-head']));
    expect(seen[0]!.env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/false', SSH_ASKPASS_REQUIRE: 'never', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' });
  });

  it("PLAIN-5.2: refs of a PR not fetched for a day go, and so do an earlier run's", async () => {
    git(clone, 'update-ref', 'refs/lookout/pr/41/head', prHead); // an earlier run's
    let now = 5_000_000;
    const p = prs({ now: () => now });
    await p.tree('shop', 7, true);
    await new Promise((r) => setTimeout(r, 300));
    expect(refs('refs/lookout/')).not.toContain('pr/41/');
    expect(refs('refs/lookout/')).toContain('pr/7/head');
    now += PR_REF_TTL_MS + 1;
    await p.prune();
    expect(refs('refs/lookout/')).toBe('');
  });
});

describe("reading a PR's Module (PLAIN-5.3)", () => {
  it("the text at the PR's head, the base at the merge-base, imports from the same commits, Viewed shared with a Worktree", async () => {
    const p = prs();
    const viewedFile = join(root, 'viewed-pr.json');
    const plain = new Plain({ runner: run, checkout: () => null, prs: p, viewedFile, now: () => 1_000_000 });
    const src = { kind: 'pr', repo: 'shop', number: 7 };
    const crm = await plain.read(src, 'plain/crm.plain', true);
    expect(crm).toMatchObject({ source: { kind: 'pr', repo: 'shop', number: 7 }, checkout: { repo: 'shop', where: '#7' }, baseName: 'merge-base with main', base: branchPoint.slice(0, 7), fetchError: null });
    expect(crm.text).toBe(crm.baseText); // crm.plain itself is unchanged
    expect(crm.concepts.Deal?.lines.join('\n')).toContain('It has a pipeline.');
    expect(crm.concepts.Deal?.baseLines?.join('\n')).not.toContain('It has a pipeline.');
    const shell = await plain.read(src, 'plain/shell.plain');
    expect(shell.text).not.toContain('A later line on main.'); // main's later commit isn't the PR's head
    const rates = await plain.read(src, 'plain/rates.plain');
    expect(rates.baseText).toBeNull();
    expect((await plain.prFiles('shop', '7', false)).files).toEqual([
      { path: 'plain/api.plain', viewed: false },
      { path: 'plain/rates.plain', viewed: false },
    ]);
    await plain.setViewed(src, 'plain/rates.plain', rates.key, true);
    expect((await plain.prFiles('shop', 7, false)).files[1]).toEqual({ path: 'plain/rates.plain', viewed: true });
    // PLAIN-4.2: the same change in a Worktree of the clone, at the same base, shares the mark.
    const wt = join(root, 'wt');
    git(clone, 'worktree', 'add', '-q', wt, prHead);
    const known = { id: checkoutId(wt), root: wt, repo: 'shop', where: 'wt', baseSha: branchPoint, commonDir: join(clone, '.git'), files: [] };
    const session = new Plain({ runner: run, checkout: (s, id) => (s === 'sess' && id === known.id ? known : null), viewedFile, now: () => 1_000_000 });
    expect((await session.read({ kind: 'session', session: 'sess', checkout: known.id }, 'plain/rates.plain')).viewed).toBe(true);
  });

  it('PLAIN-6.1: a PR is named by a repo and a number, nothing else', async () => {
    const plain = new Plain({ runner: run, checkout: () => null, prs: prs(), viewedFile: join(root, 'v.json') });
    for (const bad of [
      { kind: 'pr', repo: '../shop', number: 7 },
      { kind: 'pr', repo: 'shop', number: 0 },
      { kind: 'pr', repo: 'shop', number: '7; rm' },
      { kind: 'pr', repo: '..', number: 7 },
      { kind: 'pr', repo: 'shop' },
    ]) {
      await expect(plain.read(bad, 'plain/crm.plain'), JSON.stringify(bad)).rejects.toMatchObject({ status: 400 });
    }
    await expect(new Plain({ runner: run, checkout: () => null, viewedFile: join(root, 'v.json') }).read({ kind: 'pr', repo: 'shop', number: 7 }, 'plain/crm.plain')).rejects.toMatchObject({ status: 404 });
  });
});
