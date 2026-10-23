import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../shared/settings.ts';
import type { GitLocation } from '../shared/types.ts';
import { startRepoSet, trackStartDirectories } from './start-repos.ts';

const loc = (commonDir: string): GitLocation => ({ repo: 'r', worktree: null, branch: 'main', commonDir, defaultBranch: 'main' });

/** A git cache stand-in: a directory missing from `reads` is pending (or failed), so unknown. */
function fakeGit(reads: Record<string, GitLocation | null>) {
  return {
    get: vi.fn((cwd: string) => reads[cwd] ?? null),
    known: (cwd: string) => cwd in reads,
  };
}

describe('the Start directories\' repos', () => {
  it('SIDE-2.9: are the common git dirs of the directories in git; one outside git counts for none', () => {
    const git = fakeGit({ '/a': loc('/a/.git'), '/b': loc('/b/.git'), '/plain': null });
    expect([...startRepoSet(['/a', '/plain'], git, (d) => d)]).toEqual(['/a/.git']);
    expect([...startRepoSet(['/a', '/b'], git, (d) => d)].sort()).toEqual(['/a/.git', '/b/.git']);
  });

  it('SIDE-2.9: are unknown while any directory\'s read is pending or failed, so no repo name hides on a guess', () => {
    const git = fakeGit({ '/a': loc('/a/.git') });
    // /b isn't known: with /a alone the set would be one repo and hide its name.
    expect(startRepoSet(['/a', '/b'], git, (d) => d).size).toBe(0);
    expect(git.get).toHaveBeenCalledWith('/b'); // and asking starts its read
  });

  it('SIDE-2.9: expands ~ before reading a directory', () => {
    const git = fakeGit({ [join(homedir(), 'work')]: loc('/w/.git') });
    expect([...startRepoSet(['~/work'], git)]).toEqual(['/w/.git']);
  });
});

describe('wiring the Start directories', () => {
  const settings = (dirs: string[]) => {
    const listeners: ((s: Settings) => void)[] = [];
    return {
      get: () => ({ startDirectories: dirs }),
      onChange: (fn: (s: Settings) => void) => void listeners.push(fn),
      fire: () => listeners.forEach((fn) => fn({} as Settings)),
    };
  };

  it('SIDE-2.9: a changed setting re-derives the rows', () => {
    const s = settings(['/a']);
    const monitor = { refreshDerived: vi.fn() };
    trackStartDirectories(s, fakeGit({}), () => monitor);
    expect(monitor.refreshDerived).not.toHaveBeenCalled();
    s.fire();
    expect(monitor.refreshDerived).toHaveBeenCalledTimes(1);
  });

  it('SIDE-2.9: the repos follow the current settings, with ~ expanded', () => {
    const s = settings(['~/work']);
    const git = fakeGit({ [join(homedir(), 'work')]: loc('/w/.git') });
    const startRepos = trackStartDirectories(s, git, () => ({ refreshDerived: () => {} }));
    expect([...startRepos()]).toEqual(['/w/.git']);
  });
});
