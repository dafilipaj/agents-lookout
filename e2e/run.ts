// `pnpm e2e [filter…] [playwright options]` (TEST-2.1): builds the UI when `dist/web` is older than
// its sources, then runs the Behaviour tests with Playwright. `pnpm e2e --report` opens the last
// failure report. Two runs in one checkout would clobber each other's `dist/web`, `e2e/.results`
// and `e2e/.report`, so a second one waits for the first (a lock in `.cache/e2e/`).
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, assertInsideRepo } from './world/pins.ts';
import { E2E_CACHE, processStart } from './world/registry.ts';

/** `playwright test` options that take a value (`--workers 1`), from its `--help` (1.63). */
const WITH_VALUE = new Set([
  '--add-reporter',
  '--browser',
  '-c',
  '--config',
  '-g',
  '--grep',
  '-G',
  '--grep-invert',
  '--global-timeout',
  '-j',
  '--workers',
  '--last-failed-file',
  '--max-failures',
  '--output',
  '--project',
  '--repeat-each',
  '--reporter',
  '--retries',
  '--run-agents',
  '--shard',
  '--test-list',
  '--test-list-invert',
  '--timeout',
  '--trace',
  '--tsconfig',
  '--ui-host',
  '--ui-port',
  '--update-source-method',
]);
/** Whether git knows `word` as a commit in this checkout (a branch, tag, sha, `HEAD~1`…). */
export function gitKnowsRef(word: string): boolean {
  return spawnSync('git', ['rev-parse', '--verify', '--quiet', '--end-of-options', `${word}^{commit}`], { cwd: REPO_ROOT, stdio: 'ignore' }).status === 0;
}

const oneOf = (values: readonly string[]) => (word: string) => values.includes(word);
/** Options whose value is optional; the next word is theirs only when this says so. */
const OPTIONAL_VALUE: Readonly<Record<string, (word: string, isRef: (word: string) => boolean) => boolean>> = {
  '--debug': oneOf(['inspector', 'cli']),
  '-u': oneOf(['all', 'changed', 'missing', 'none']),
  '--update-snapshots': oneOf(['all', 'changed', 'missing', 'none']),
  // `--only-changed [ref]`: a ref is any commit git knows; anything else is a filter word.
  '--only-changed': (word, isRef) => isRef(word),
};

/**
 * Splits `pnpm e2e`'s arguments into Playwright options (with their values) and filter words.
 * The words match a Behaviour test's file or title, any of them, ignoring case: `side-6.1`
 * finds `SIDE-6.1: …`.
 */
export function parseRunArgs(
  args: readonly string[],
  { isRef = gitKnowsRef }: { isRef?: (word: string) => boolean } = {},
): { options: string[]; words: string[]; grep: string | null } {
  const options: string[] = [];
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--') {
      words.push(...args.slice(i + 1));
      break;
    }
    if (!a.startsWith('-') || a === '-') {
      words.push(a);
      continue;
    }
    options.push(a);
    if (a.includes('=')) continue;
    const next = args[i + 1];
    if (next === undefined) continue;
    if (WITH_VALUE.has(a) || (!next.startsWith('-') && OPTIONAL_VALUE[a]?.(next, isRef))) {
      options.push(next);
      i++;
    }
  }
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
  // Playwright reads `/…/i` as a regular expression with its flags.
  return { options, words, grep: words.length ? `/${escaped.join('|')}/i` : null };
}

/** The newest modification time under `path` (a file or a directory), skipping tests. */
function newest(path: string): number {
  const info = statSync(path, { throwIfNoEntry: false });
  if (!info) return 0;
  if (!info.isDirectory()) return info.mtimeMs;
  let max = info.mtimeMs;
  for (const entry of readdirSync(path)) {
    if (entry === 'node_modules' || /\.test\.tsx?$/.test(entry)) continue;
    max = Math.max(max, newest(join(path, entry)));
  }
  return max;
}

interface LockHolder {
  pid: number;
  startMs: number;
}

/**
 * Takes the run lock at `path`, a file naming the `pnpm e2e` that holds it (pid and start time).
 * While another live run holds it, waits for up to `waitMs` (telling `onWait` once), then fails
 * naming that run. A lock whose run is gone is taken over. Returns the release.
 */
export async function acquireRunLock(
  path: string,
  { waitMs, pollMs = 500, onWait }: { waitMs: number; pollMs?: number; onWait?: (holder: LockHolder) => void },
): Promise<() => void> {
  const me: LockHolder = { pid: process.pid, startMs: processStart(process.pid) ?? 0 };
  const mine = JSON.stringify(me);
  const deadline = Date.now() + waitMs;
  let told = false;
  for (;;) {
    try {
      writeFileSync(path, mine, { flag: 'wx' });
      return () => {
        // Only our own lock: never one another run took over.
        if (readText(path) === mine) rmSync(path, { force: true });
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const text = readText(path);
    let holder: LockHolder | null = null;
    try {
      holder = JSON.parse(text) as LockHolder;
    } catch {
      // being written, or cut short by a crash
    }
    const stale = holder ? processStart(holder.pid) !== holder.startMs : Date.now() - (statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0) > 5000;
    if (stale) {
      if (readText(path) === text) rmSync(path, { force: true });
      continue;
    }
    if (holder && !told) {
      told = true;
      onWait?.(holder);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Another \`pnpm e2e\` (pid ${holder?.pid ?? '?'}) runs in this checkout. Two runs would clobber each other's dist/web, e2e/.results and e2e/.report: wait for it to finish, or stop it.`,
      );
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

async function main(args: readonly string[]): Promise<number> {
  const playwright = join(REPO_ROOT, 'node_modules', '.bin', 'playwright');
  const config = join(REPO_ROOT, 'e2e', 'playwright.config.ts');

  if (args.includes('--report')) {
    return spawnSync(playwright, ['show-report', join(REPO_ROOT, 'e2e', '.report')], { stdio: 'inherit' }).status ?? 1;
  }

  assertInsideRepo(E2E_CACHE, { create: true });
  let release: () => void;
  try {
    release = await acquireRunLock(join(E2E_CACHE, 'run.lock'), {
      waitMs: 15 * 60_000,
      onWait: (h) => console.log(`Another \`pnpm e2e\` (pid ${h.pid}) runs in this checkout; waiting for it to finish.`),
    });
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
  // Ctrl-C reaches Playwright too; this process waits for it to finish, then lets the lock go.
  const ignore = () => {};
  process.on('SIGINT', ignore);
  process.on('SIGTERM', ignore);
  try {
    const built = statSync(join(REPO_ROOT, 'dist', 'web', 'index.html'), { throwIfNoEntry: false })?.mtimeMs ?? 0;
    const sources = Math.max(
      ...['web', 'shared', 'vite.config.ts', 'package.json', 'pnpm-lock.yaml', 'tsconfig.web.json', 'components.json'].map((p) => newest(join(REPO_ROOT, p))),
    );
    if (sources > built) {
      console.log(built ? 'The UI is older than its sources: building it.' : 'The UI is not built: building it.');
      const b = spawnSync('pnpm', ['build'], { cwd: REPO_ROOT, stdio: 'inherit' });
      if (b.status !== 0) return b.status ?? 1;
    }

    const { options, grep } = parseRunArgs(args);
    const r = spawnSync(playwright, ['test', '-c', config, ...(grep ? ['--grep', grep] : []), ...options], { cwd: REPO_ROOT, stdio: 'inherit' });
    return r.status ?? 1;
  } finally {
    release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
