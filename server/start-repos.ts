import type { Settings } from '../shared/settings.ts';
import type { GitCache } from './git.ts';
import { expandHome } from './settings.ts';

/**
 * SIDE-2.9: the common git dirs of the repos the Start directories are in, read through the git
 * cache. A directory outside git counts for no repo; one whose read is pending or has failed makes
 * the whole set unknown, which is the empty set (every row then shows its repo). A refresh that
 * fails keeps the last good read, so the set doesn't flip back to unknown.
 */
export function startRepoSet(
  dirs: readonly string[],
  git: Pick<GitCache, 'get' | 'known'>,
  expand: (dir: string) => string = expandHome,
): ReadonlySet<string> {
  const repos = new Set<string>();
  let unknown = false;
  for (const dir of dirs) {
    const path = expand(dir);
    const location = git.get(path); // also starts the read of a directory not read yet
    if (!git.known(path)) unknown = true;
    else if (location) repos.add(location.commonDir);
  }
  return unknown ? new Set() : repos;
}

/**
 * The monitor's `startRepos`, and the wiring that a changed Start directory re-derives the rows
 * (their repo part may now show or hide).
 */
export function trackStartDirectories(
  settings: { get(): Pick<Settings, 'startDirectories'>; onChange(fn: (s: Settings) => void): unknown },
  git: Pick<GitCache, 'get' | 'known'>,
  monitor: () => { refreshDerived(): void },
  expand: (dir: string) => string = expandHome,
): () => ReadonlySet<string> {
  settings.onChange(() => monitor().refreshDerived());
  return () => startRepoSet(settings.get().startDirectories, git, expand);
}
