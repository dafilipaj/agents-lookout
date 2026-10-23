import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { run } from './exec.ts';
import { GitCache, readGitLocation, readGlobalGitEmail, repoName } from './git.ts';

let root: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], {
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lookout-git-')));
  const repo = join(root, 'shop');
  mkdirSync(join(repo, 'src'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/rates', join(root, 'shop-rates'));
  git(repo, 'worktree', 'add', '-q', '--detach', join(root, 'shop-detached'));
  mkdirSync(join(root, 'not-git'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('reading where a Session works', () => {
  it('SIDE-2.2: in the main checkout, the location is the branch', async () => {
    const main = { repo: 'shop', worktree: null, branch: 'main', commonDir: join(root, 'shop', '.git'), defaultBranch: 'main' };
    expect(await readGitLocation(run, join(root, 'shop'))).toEqual(main);
    // A subdirectory belongs to the same checkout.
    expect(await readGitLocation(run, join(root, 'shop', 'src'))).toEqual(main);
  });

  it('SIDE-2.2: in a linked Worktree, the location is the Worktree name, and the repo is the main repo', async () => {
    expect(await readGitLocation(run, join(root, 'shop-rates'))).toEqual({
      repo: 'shop',
      worktree: 'shop-rates',
      branch: 'feature/rates',
      commonDir: join(root, 'shop', '.git'),
      defaultBranch: 'main',
    });
  });

  describe('SIDE-2.8: the default branch', () => {
    const defaultOf = async (dir: string) => (await readGitLocation(run, dir))?.defaultBranch;
    const init = (name: string, branch: string) => {
      const dir = join(root, name);
      mkdirSync(dir);
      git(dir, 'init', '-q', '-b', branch);
      git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
      return dir;
    };

    it('SIDE-2.8: origin/HEAD wins, even over a local main, in a clone and in its Worktrees', async () => {
      const upstream = init('up-develop', 'develop');
      git(upstream, 'branch', 'main');
      const clone = join(root, 'clone-develop');
      execFileSync('git', ['clone', '-q', upstream, clone]);
      git(clone, 'branch', 'main');
      git(clone, 'worktree', 'add', '-q', '-b', 'fix/x', join(root, 'clone-develop-wt'));
      expect(await defaultOf(clone)).toBe('develop');
      expect(await defaultOf(join(root, 'clone-develop-wt'))).toBe('develop');
      // The name keeps its own slashes: only the `origin/` goes.
      git(clone, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/release/2');
      expect(await defaultOf(clone)).toBe('release/2');
    });

    it('SIDE-2.8: without origin/HEAD, a local main, else a local master', async () => {
      expect(await defaultOf(init('only-main', 'main'))).toBe('main');
      expect(await defaultOf(init('only-master', 'master'))).toBe('master');
      const both = init('both', 'master');
      git(both, 'branch', 'main');
      expect(await defaultOf(both)).toBe('main');
    });

    it('SIDE-2.8: with neither, it is unknown (null), and nothing is written to the repo', async () => {
      const dir = init('trunk-only', 'trunk');
      const before = execFileSync('git', ['-C', dir, 'config', '--list']).toString();
      expect(await defaultOf(dir)).toBeNull();
      expect(await defaultOf(dir)).toBeNull();
      expect(execFileSync('git', ['-C', dir, 'config', '--list']).toString()).toBe(before);
      expect(() => git(dir, 'symbolic-ref', '-q', 'refs/remotes/origin/HEAD')).toThrow();
    });
  });

  it('shows a short commit for a detached HEAD', async () => {
    const loc = await readGitLocation(run, join(root, 'shop-detached'));
    expect(loc?.worktree).toBe('shop-detached');
    expect(loc?.branch).toMatch(/^[0-9a-f]{7,}$/);
  });

  it('tolerates non-git and missing directories', async () => {
    expect(await readGitLocation(run, join(root, 'not-git'))).toBeNull();
    expect(await readGitLocation(run, join(root, 'gone'))).toBeNull();
  });

  it('passes the directory as an argv entry, never through a shell', async () => {
    const runner = vi.fn(async () => '');
    await readGitLocation(runner, '/tmp/$(touch pwned); rm -rf ~');
    expect(runner).toHaveBeenCalledWith(
      'git',
      ['-C', '/tmp/$(touch pwned); rm -rf ~', 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel'],
      expect.anything(),
    );
  });

  it('names repos from the common git dir', () => {
    expect(repoName('/x/work/.git', '/x/work-wt')).toBe('work');
    expect(repoName('/x/work.git', '/x/wt')).toBe('work');
    expect(repoName('/x/super/.git/modules/sub', '/x/super/sub')).toBe('sub');
  });
});

describe('the Productive email suggestion (WORK-2.5)', () => {
  /** A HOME of its own, so git reads only the `~/.gitconfig` written here, never the real one. */
  const homeWith = (gitconfig: string | null) => {
    const home = join(root, `home-${Math.random().toString(36).slice(2)}`);
    mkdirSync(home);
    if (gitconfig !== null) writeFileSync(join(home, '.gitconfig'), gitconfig);
    return { PATH: process.env.PATH, HOME: home };
  };

  it('WORK-2.5: is `git config --global user.email`, as git reads it from ~/.gitconfig', async () => {
    expect(await readGlobalGitEmail(run, homeWith('[user]\n\tname = Lamp Lighter\n\temail = "lamplighter@example.com"\n'))).toBe('lamplighter@example.com');
  });

  it('WORK-2.5: is null when git has none, or one that couldn’t be saved as is (WORK-2.7)', async () => {
    expect(await readGlobalGitEmail(run, homeWith(null))).toBeNull();
    expect(await readGlobalGitEmail(run, homeWith('[user]\n\tname = Lamp Lighter\n'))).toBeNull();
    expect(await readGlobalGitEmail(run, homeWith('[user]\n\temail = "Lamp Lighter"\n'))).toBeNull();
    expect(await readGlobalGitEmail(run, homeWith('[user]\n\temail = "x,colleague@example.com"\n'))).toBeNull();
    const failing = vi.fn(async () => {
      throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
    });
    expect(await readGlobalGitEmail(failing)).toBeNull();
  });
});

describe('GitCache', () => {
  it('caches per directory and refreshes after 30 s', async () => {
    let now = 0;
    let branch = 'main';
    const read = vi.fn(async () => ({ repo: 'r', worktree: null, branch, commonDir: '/r/.git', defaultBranch: 'main' }));
    const onChange = vi.fn();
    const cache = new GitCache({ read, onChange, now: () => now });

    expect(cache.get('/a')).toBeNull(); // not read yet
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(cache.get('/a')).toEqual({ repo: 'r', worktree: null, branch: 'main', commonDir: '/r/.git', defaultBranch: 'main' });
    expect(read).toHaveBeenCalledTimes(1);

    now = 29_000;
    branch = 'other';
    cache.get('/a');
    expect(read).toHaveBeenCalledTimes(1);

    now = 30_000;
    cache.get('/a');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(cache.get('/a')?.branch).toBe('other');
  });

  it('forgets directories nobody asked about for 5 minutes', async () => {
    let now = 0;
    const read = vi.fn(async () => null);
    const cache = new GitCache({ read, onChange: () => {}, now: () => now });
    cache.get('/a');
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    now = 6 * 60_000;
    cache.prune();
    cache.get('/a');
    expect(read).toHaveBeenCalledTimes(2);
  });
});
