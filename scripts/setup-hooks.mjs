// `pnpm install` runs this (`prepare`): it points git at .githooks, so a fresh clone or Worktree has the
// pre-push hook (TEST-4.2). It does nothing without git, or when this package isn't the top of its git
// checkout, so an install from a tarball or inside another repo never changes that repo's hooks.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// What git reads from its environment to pick a repo or its config. An install run from another repo's
// hook inherits that repo's (`GIT_DIR` and friends), and would otherwise write to that repo's config.
const INHERITED = /^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|CEILING_DIRECTORIES|CONFIG\w*)$/;

/** Returns `{ set: true }`, or `{ skipped }` with the reason it did nothing. */
export function setupHooks(root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), env = process.env) {
  const own = Object.fromEntries(Object.entries(env).filter(([name]) => !INHERITED.test(name)));
  const git = (...args) => spawnSync('git', args, { cwd: root, env: own, encoding: 'utf8' });
  const top = git('rev-parse', '--show-toplevel');
  if (top.error) return { skipped: 'git is not installed' };
  if (top.status !== 0) return { skipped: 'not a git checkout' };
  if (realpathSync(top.stdout.trim()) !== realpathSync(root)) return { skipped: `inside another git checkout, ${top.stdout.trim()}` };
  const set = git('config', '--local', 'core.hooksPath', '.githooks');
  if (set.status !== 0) throw new Error(`git config --local core.hooksPath .githooks failed:\n${set.stderr}`);
  return { set: true };
}

if (import.meta.main) {
  const result = setupHooks();
  if (result.skipped) console.log(`setup-hooks: ${result.skipped}, so the pre-push hook isn't set up.`);
}
