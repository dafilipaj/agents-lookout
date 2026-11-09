import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run, type RunOptions } from './exec.ts';
import { PlainError } from './plain.ts';
import { INSTALL_TIMEOUT_MS, parseWorktrees, PlainWorktrees, type PrWorktreeRequest, type WorktreePhase, withRepoNode } from './plain-worktrees.ts';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8' }).trim();

/** A node_modules with its Playwright, as an install leaves one. */
function installed(at: string) {
  mkdirSync(join(at, 'node_modules', '.bin'), { recursive: true });
  mkdirSync(join(at, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(join(at, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1\n');
  writeFileSync(join(at, 'node_modules', '.bin', 'playwright'), '#!/bin/sh\n');
  chmodSync(join(at, 'node_modules', '.bin', 'playwright'), 0o755);
}

let root: string;
let clone: string;
let dir: string;
let base: string;
let head: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lookout-plain-wt-')));
  clone = join(root, 'shop');
  dir = join(root, 'lookout', 'plain-worktrees');
  mkdirSync(clone);
  git(clone, 'init', '-q', '-b', 'main');
  writeFileSync(join(clone, '.gitignore'), 'node_modules\n');
  writeFileSync(join(clone, 'package-lock.json'), '{"lockfileVersion":3}\n');
  writeFileSync(join(clone, 'README.md'), 'shop\n');
  git(clone, 'add', '.');
  git(clone, 'commit', '-qm', 'base');
  base = git(clone, 'rev-parse', 'HEAD');
  git(clone, 'switch', '-q', '-c', 'feature');
  writeFileSync(join(clone, 'README.md'), 'shop, with rates\n');
  git(clone, 'commit', '-qam', 'the PR');
  head = git(clone, 'rev-parse', 'HEAD');
  git(clone, 'switch', '-q', 'main');
  // The clone has the base's dependencies, and its lockfile is the PR's.
  installed(clone);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function request(over: Partial<PrWorktreeRequest> = {}): PrWorktreeRequest & { phases: WorktreePhase[] } {
  const phases: WorktreePhase[] = [];
  return { clone, repo: 'shop', number: 7, headSha: head, signal: new AbortController().signal, onPhase: (p) => phases.push(p), phases, ...over };
}

const listed = () => parseWorktrees(execFileSync('git', ['-C', clone, 'worktree', 'list', '--porcelain', '-z'], { encoding: 'utf8' })).map((w) => w.path);

describe('a PR\'s worktree (PLAIN-11.15)', () => {
  it('PLAIN-11.15: a clean worktree at the head is run in as it is, one with its Playwright first; one at an older commit and one with changes are left alone', async () => {
    const old = join(root, 'review-old');
    const dirty = join(root, 'review-dirty');
    const bare = join(root, 'review-bare');
    const ready = join(root, 'review-ready');
    git(clone, 'worktree', 'add', '-q', '--detach', old, base);
    for (const w of [dirty, bare, ready]) git(clone, 'worktree', 'add', '-q', '--detach', w, head);
    writeFileSync(join(dirty, 'README.md'), 'a reviewer was here\n');
    installed(dirty);
    installed(ready);
    const wts = new PlainWorktrees({ runner: run, dir, env });
    const r = request();
    const wt = await wts.acquire(r);
    expect(wt).toMatchObject({ root: ready, added: false });
    expect(r.phases).toEqual([]);
    expect(await wt.unchanged()).toBe(true);
    writeFileSync(join(ready, 'README.md'), 'edited during the run\n');
    expect(await wt.unchanged()).toBe(false);
    git(ready, 'checkout', '-q', '--', 'README.md');
    await wt.release();
    expect(existsSync(join(ready, 'node_modules', '.bin', 'playwright'))).toBe(true);
    expect(git(old, 'rev-parse', 'HEAD')).toBe(base);
    expect(git(dirty, 'status', '--porcelain')).toBe('M README.md');

    // Without its Playwright, the one at the head gets the dependencies of a checkout with its
    // lockfile: a copy, not a link, and it keeps them.
    git(clone, 'worktree', 'remove', '--force', ready);
    // A copy that fails leaves nothing in the worktree, nor in Lookout's folder.
    const failing = new PlainWorktrees({
      runner: (file, args, opts) => (file === 'cp' ? Promise.reject(Object.assign(new Error('cp'), { code: 1, stderr: 'cp: No space left on device\n' })) : run(file, args, opts)),
      dir,
      env,
    });
    await expect(failing.acquire(request())).rejects.toMatchObject({ reason: "Copying #7's dependencies failed: cp: No space left on device" });
    expect(existsSync(join(bare, 'node_modules'))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
    const r2 = request();
    const wt2 = await wts.acquire(r2);
    expect(wt2).toMatchObject({ root: bare, added: false });
    expect(r2.phases).toEqual(['copying']);
    expect(lstatSync(join(bare, 'node_modules')).isDirectory()).toBe(true);
    expect(lstatSync(join(bare, 'node_modules', 'pkg')).isSymbolicLink()).toBe(false);
    await wt2.release();
    expect(existsSync(join(bare, 'node_modules', '.bin', 'playwright'))).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("PLAIN-11.15: with none at the head, Lookout adds one in its own folder, copies the dependencies in, and removes it after; the donor's stay", async () => {
    const wts = new PlainWorktrees({ runner: run, dir, env });
    const r = request();
    const wt = await wts.acquire(r);
    expect(wt).toMatchObject({ root: join(dir, 'shop-7'), added: true });
    expect(r.phases).toEqual(['worktree', 'copying']);
    expect(git(wt.root, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(wt.root, 'status', '--porcelain')).toBe('');
    expect(lstatSync(join(wt.root, 'node_modules')).isSymbolicLink()).toBe(false);
    expect(existsSync(join(wt.root, 'node_modules', '.bin', 'playwright'))).toBe(true);
    expect(listed()).toContain(wt.root);
    await wt.release();
    expect(existsSync(wt.root)).toBe(false);
    expect(listed()).not.toContain(wt.root);
    expect(existsSync(join(clone, 'node_modules', 'pkg', 'index.js'))).toBe(true);
    // One git couldn't remove stays registered with its folder gone: the next is added over it.
    git(clone, 'worktree', 'add', '-q', '--detach', wt.root, base);
    rmSync(wt.root, { recursive: true, force: true });
    const again = await wts.acquire(request());
    expect(git(again.root, 'rev-parse', 'HEAD')).toBe(head);
    await again.release();
    // What git can't do is said as such.
    await expect(wts.acquire(request({ clone: join(root, 'nowhere') }))).rejects.toMatchObject({ reason: expect.stringMatching(/^Couldn't get #7's worktree ready: /) });
  });

  it("PLAIN-11.15: with no checkout of the head's lockfile, they're installed through res on .nvmrc's Node, NODE_ENV unset and Husky off; an install that fails or is cancelled leaves nothing", async () => {
    git(clone, 'switch', '-q', 'feature');
    writeFileSync(join(clone, 'package-lock.json'), '{"lockfileVersion":3,"packages":{"x":{}}}\n');
    writeFileSync(join(clone, '.nvmrc'), '24\n');
    git(clone, 'add', '.');
    git(clone, 'commit', '-qm', 'a new dependency');
    head = git(clone, 'rev-parse', 'HEAD');
    git(clone, 'switch', '-q', 'main');
    const nvm = join(root, 'nvm');
    for (const v of ['v24.1.0', 'v24.10.0', 'v25.0.0']) {
      mkdirSync(join(nvm, 'versions', 'node', v, 'bin'), { recursive: true });
      writeFileSync(join(nvm, 'versions', 'node', v, 'bin', 'node'), '');
      chmodSync(join(nvm, 'versions', 'node', v, 'bin', 'node'), 0o755);
    }
    const calls: { file: string; args: readonly string[]; opts: RunOptions }[] = [];
    let install = (cwd: string): Promise<string> => {
      installed(cwd);
      return Promise.resolve('');
    };
    const runner = (file: string, args: readonly string[], opts: RunOptions) => {
      if (file !== '/opt/res') return run(file, args, opts);
      calls.push({ file, args, opts });
      return install(opts.cwd!);
    };
    const wts = new PlainWorktrees({ runner, dir, env: { ...env, NVM_DIR: nvm, LOOKOUT_RES_BIN: '/opt/res', NODE_ENV: 'production', PATH: '/usr/bin:/bin' } });
    const r = request({ headSha: head });
    const wt = await wts.acquire(r);
    expect(r.phases).toEqual(['worktree', 'installing']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(['run', '--prio', 'live', '--', 'npm', 'ci', '--no-audit', '--no-fund', '--loglevel=error']);
    expect(calls[0]!.opts).toMatchObject({ cwd: wt.root, timeoutMs: INSTALL_TIMEOUT_MS });
    expect(calls[0]!.opts.env).not.toHaveProperty('NODE_ENV');
    expect(calls[0]!.opts.env).toMatchObject({ HUSKY: '0', PATH: `${join(nvm, 'versions', 'node', 'v24.10.0', 'bin')}:/usr/bin:/bin` });
    await wt.release();
    expect(existsSync(wt.root)).toBe(false);

    install = (cwd) => {
      mkdirSync(join(cwd, 'node_modules', 'half'), { recursive: true });
      return Promise.reject(Object.assign(new Error('npm'), { code: 1, stderr: 'npm warn deprecated x\nnpm error code EBADENGINE\nnpm error engine Unsupported engine\n' }));
    };
    await expect(wts.acquire(request({ headSha: head }))).rejects.toMatchObject({ reason: "Installing #7's dependencies failed: npm error code EBADENGINE" });
    expect(existsSync(join(dir, 'shop-7'))).toBe(false);
    expect(listed()).not.toContain(join(dir, 'shop-7'));

    install = () => Promise.reject(Object.assign(new Error('cancelled'), { aborted: true }));
    await expect(wts.acquire(request({ headSha: head }))).rejects.toMatchObject({ aborted: true });
    expect(existsSync(join(dir, 'shop-7'))).toBe(false);

    // In a worktree Lookout didn't add, an install that didn't finish is taken out again.
    const review = join(root, 'review-7');
    git(clone, 'worktree', 'add', '-q', '--detach', review, head);
    install = (cwd) => {
      mkdirSync(join(cwd, 'node_modules', 'half'), { recursive: true });
      return Promise.reject(Object.assign(new Error('npm'), { code: 1, stderr: 'npm error network\n' }));
    };
    await expect(wts.acquire(request({ headSha: head }))).rejects.toMatchObject({ reason: "Installing #7's dependencies failed: npm error network" });
    expect(existsSync(review)).toBe(true);
    expect(existsSync(join(review, 'node_modules'))).toBe(false);
  });

  it("PLAIN-11.15: someone else's node_modules without Playwright is refused, not replaced; leftovers in Lookout's folder go at start, and nothing outside it", async () => {
    const review = join(root, 'review-7');
    git(clone, 'worktree', 'add', '-q', '--detach', review, head);
    mkdirSync(join(review, 'node_modules', 'theirs'), { recursive: true });
    const wts = new PlainWorktrees({ runner: run, dir, env });
    const err = await wts.acquire(request()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlainError);
    expect((err as PlainError).message).toBe(`Install #7's dependencies in ${review} first: its Playwright isn't there.`);
    expect(existsSync(join(review, 'node_modules', 'theirs'))).toBe(true);

    mkdirSync(dir, { recursive: true });
    git(clone, 'worktree', 'add', '-q', '--detach', join(dir, 'shop-9'), head);
    installed(join(dir, 'shop-9'));
    mkdirSync(join(dir, 'junk'));
    // A link there is only unlinked, never followed to the worktree it names.
    symlinkSync(review, join(dir, 'shop-8'));
    await wts.prune();
    expect(existsSync(join(dir, 'shop-8'))).toBe(false);
    expect(existsSync(join(review, 'node_modules', 'theirs'))).toBe(true);
    expect(listed()).toContain(review);
    expect(existsSync(join(dir, 'shop-9'))).toBe(false);
    expect(existsSync(join(dir, 'junk'))).toBe(false);
    expect(listed()).not.toContain(join(dir, 'shop-9'));
    expect(existsSync(review)).toBe(true);
    expect(existsSync(join(clone, 'node_modules', 'pkg', 'index.js'))).toBe(true);
  });

  it(".nvmrc's Node, the newest nvm has that fits; past an .nvmrc that names no version, .node-version's (PLAIN-11.4)", async () => {
    const nvm = join(root, 'nvm');
    for (const v of ['v22.3.0', 'v24.1.0']) {
      mkdirSync(join(nvm, 'versions', 'node', v, 'bin'), { recursive: true });
      writeFileSync(join(nvm, 'versions', 'node', v, 'bin', 'node'), '');
      chmodSync(join(nvm, 'versions', 'node', v, 'bin', 'node'), 0o755);
    }
    const e = { NVM_DIR: nvm, PATH: '/usr/bin' };
    expect(await withRepoNode(clone, e)).toBe(e);
    writeFileSync(join(clone, '.nvmrc'), 'lts/*\n');
    writeFileSync(join(clone, '.node-version'), 'v22\n');
    expect((await withRepoNode(clone, e)).PATH).toBe(`${join(nvm, 'versions', 'node', 'v22.3.0', 'bin')}:/usr/bin`);
    writeFileSync(join(clone, '.nvmrc'), '20\n');
    expect(await withRepoNode(clone, e)).toBe(e);
  });

  it('PLAIN-11.15: git worktree list, read', () => {
    expect(parseWorktrees('worktree /a\u0000HEAD abc\u0000branch refs/heads/main\u0000\u0000worktree /b\u0000HEAD def\u0000detached\u0000prunable gitdir file points to non-existent location\u0000\u0000worktree /c\u0000bare\u0000\u0000')).toEqual([
      { path: '/a', head: 'abc', bare: false, prunable: false },
      { path: '/b', head: 'def', bare: false, prunable: true },
      { path: '/c', head: null, bare: true, prunable: false },
    ]);
  });
});
