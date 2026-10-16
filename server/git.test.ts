import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { run } from './exec.ts';
import { GitCache, readGitLocation, repoName } from './git.ts';

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
    expect(await readGitLocation(run, join(root, 'shop'))).toEqual({ repo: 'shop', worktree: null, branch: 'main' });
    // A subdirectory belongs to the same checkout.
    expect(await readGitLocation(run, join(root, 'shop', 'src'))).toEqual({ repo: 'shop', worktree: null, branch: 'main' });
  });

  it('SIDE-2.2: in a linked Worktree, the location is the Worktree name, and the repo is the main repo', async () => {
    expect(await readGitLocation(run, join(root, 'shop-rates'))).toEqual({
      repo: 'shop',
      worktree: 'shop-rates',
      branch: 'feature/rates',
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

describe('GitCache', () => {
  it('caches per directory and refreshes after 30 s', async () => {
    let now = 0;
    let branch = 'main';
    const read = vi.fn(async () => ({ repo: 'r', worktree: null, branch }));
    const onChange = vi.fn();
    const cache = new GitCache({ read, onChange, now: () => now });

    expect(cache.get('/a')).toBeNull(); // not read yet
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(cache.get('/a')).toEqual({ repo: 'r', worktree: null, branch: 'main' });
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
