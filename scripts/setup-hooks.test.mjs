import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupHooks } from './setup-hooks.mjs';

let dir;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'lookout-setup-hooks-')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
const hooksPath = (cwd) => {
  try {
    return git(cwd, 'config', '--local', '--get', 'core.hooksPath').trim();
  } catch {
    return null;
  }
};

describe('setup-hooks', () => {
  it('TEST-4.2: points git at .githooks when the package is the top of its checkout', () => {
    git(dir, 'init', '-q');
    expect(setupHooks(dir)).toEqual({ set: true });
    expect(hooksPath(dir)).toBe('.githooks');
  });

  it('TEST-4.2: works in a Worktree, whose root is the top of its own checkout', () => {
    const main = join(dir, 'main');
    mkdirSync(main);
    git(main, 'init', '-q');
    git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
    git(main, 'worktree', 'add', '-q', join(dir, 'wt'));
    expect(setupHooks(join(dir, 'wt'))).toEqual({ set: true });
    expect(hooksPath(main)).toBe('.githooks');
  });

  it('TEST-4.2: leaves another checkout\'s hooks alone when the package sits inside it', () => {
    git(dir, 'init', '-q');
    mkdirSync(join(dir, 'pkg'));
    expect(setupHooks(join(dir, 'pkg')).skipped).toMatch(/inside another git checkout/);
    expect(hooksPath(dir)).toBeNull();
  });

  it('TEST-4.2: an inherited GIT_DIR, as in another repo\'s hook, never sends it to that repo\'s config', () => {
    const parent = join(dir, 'parent');
    mkdirSync(join(parent, 'pkg'), { recursive: true });
    git(parent, 'init', '-q');
    const inherited = { ...process.env, GIT_DIR: join(parent, '.git') };
    expect(setupHooks(join(parent, 'pkg'), inherited).skipped).toMatch(/inside another git checkout/);
    const own = join(dir, 'own');
    mkdirSync(own);
    git(own, 'init', '-q');
    expect(setupHooks(own, inherited)).toEqual({ set: true });
    expect(hooksPath(own)).toBe('.githooks');
    expect(hooksPath(parent)).toBeNull();
  });

  it('TEST-4.2: does nothing outside a git checkout or without git', () => {
    expect(setupHooks(dir)).toEqual({ skipped: 'not a git checkout' });
    expect(setupHooks(dir, { ...process.env, PATH: dir })).toEqual({ skipped: 'git is not installed' });
  });
});
