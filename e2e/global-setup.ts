import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, REPO_ROOT, checkPins } from './world/pins.ts';
import { RUN_DIR_ENV, createRunDir, readLeftovers, sweepDeadRuns, sweepRun } from './world/registry.ts';
import { realTmux } from './world/runtime.ts';

/**
 * What stops a run before its first Behaviour test (TEST-1.3, TEST-4.3): a pinned binary that is
 * missing or doesn't match its pin, no tmux, no built UI. Each names the command that fixes it.
 */
export function preflight(opts: { cache?: string; repoRoot?: string } = {}): string[] {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const problems: string[] = [];
  const pins = checkPins(opts.cache ?? CACHE_DIR, repoRoot);
  if (!pins.ok) problems.push(...pins.problems);
  try {
    realTmux();
  } catch (err) {
    problems.push((err as Error).message);
  }
  if (!existsSync(join(repoRoot, 'dist', 'web', 'index.html'))) problems.push('The UI is not built. Run `pnpm build` (`pnpm e2e` does it for you).');
  return problems;
}

/**
 * Before the first Behaviour test: the preflight passes, or the run stops naming what's wrong.
 *
 * TEST-1.8: Worlds left by an interrupted run (its runner is gone) are swept first, and this run
 * gets its own directory in `.cache/e2e/runs/`. The returned teardown sweeps what this run's
 * Worlds left, and fails the run naming it.
 */
export default function globalSetup(): () => void {
  const problems = preflight();
  if (problems.length) throw new Error(`Behaviour tests can't run:\n${problems.map((p) => `  - ${p}`).join('\n')}`);

  const swept = sweepDeadRuns();
  if (swept.size) {
    console.log(`Swept ${swept.size} World(s) an interrupted run left behind:`);
    for (const [entry, found] of swept) console.log(`  ${entry}\n${found.map((f) => `    ${f}`).join('\n')}`);
  }

  const dir = createRunDir();
  process.env[RUN_DIR_ENV] = dir;

  return () => {
    const named = readLeftovers(dir);
    const left = sweepRun(dir);
    const lines = [...left].map(([entry, found]) => `  ${entry}\n${found.map((f) => `    ${f}`).join('\n')}`);
    if (named || lines.length) {
      throw new Error(
        `Behaviour tests left things behind (TEST-1.8):\n${named}${lines.length ? `Worlds whose teardown didn't finish, now swept:\n${lines.join('\n')}` : ''}`,
      );
    }
  };
}
