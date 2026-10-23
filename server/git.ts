import { basename, dirname } from 'node:path';
import { parseProductiveEmail } from '../shared/settings.ts';
import type { GitLocation } from '../shared/types.ts';
import type { Runner } from './exec.ts';

const GIT_TIMEOUT_MS = 3000;

/**
 * WORK-2.5: the suggestion for the Productive email, `git config --global user.email`, kept only when
 * it would be saved as is (WORK-2.7). Null when git has none, or can't be run.
 */
export async function readGlobalGitEmail(runner: Runner, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  try {
    const out = await runner('git', ['config', '--global', 'user.email'], { timeoutMs: GIT_TIMEOUT_MS, env: { ...env, GIT_OPTIONAL_LOCKS: '0' } });
    return parseProductiveEmail(out);
  } catch {
    return null;
  }
}

/**
 * Reads where a directory sits in git, with argv only (never a shell string).
 * Returns null for a directory that isn't in a git checkout; throws when git couldn't be run or
 * timed out, so "outside git" is never a guess (SIDE-2.9).
 */
export async function readGitLocation(runner: Runner, cwd: string): Promise<GitLocation | null> {
  // Optional locks off: Lookout only reads, and must never contend with the agent's own git use.
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  const git = (...args: string[]) => runner('git', ['-C', cwd, ...args], { timeoutMs: GIT_TIMEOUT_MS, env });

  let gitDir: string, commonDir: string, topLevel: string;
  try {
    const out = await git('rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel');
    const lines = out.split('\n').map((l) => l.trim());
    if (!lines[0] || !lines[1] || !lines[2]) return null;
    [gitDir, commonDir, topLevel] = [lines[0], lines[1], lines[2]];
  } catch (e) {
    // git ran and said no (exit 128: not a repository, or no such directory): not in git. A timeout,
    // a missing `git` or a cancelled run says nothing about the directory, so it is a failure.
    if (typeof (e as { code?: unknown }).code === 'number') return null;
    throw e;
  }

  const linked = gitDir !== commonDir;
  return {
    repo: repoName(commonDir, topLevel),
    worktree: linked ? basename(topLevel) : null,
    branch: await readBranch(git),
    commonDir,
    defaultBranch: await readDefaultBranch(git),
  };
}

/**
 * SIDE-2.8: the branch `origin/HEAD` points at; without it a local `main`, else `master`; else null.
 * Reads only: `git remote set-head` is never run.
 */
async function readDefaultBranch(git: (...args: string[]) => Promise<string>): Promise<string | null> {
  let out: string;
  try {
    // One process for all three: `<refname> <symref target>` per ref that exists.
    out = await git('for-each-ref', '--format=%(refname) %(symref)', 'refs/remotes/origin/HEAD', 'refs/heads/main', 'refs/heads/master');
  } catch {
    return null;
  }
  const refs = new Map<string, string>();
  for (const line of out.split('\n')) {
    const [name, target = ''] = line.trim().split(' ');
    if (name) refs.set(name, target);
  }
  const target = refs.get('refs/remotes/origin/HEAD') ?? '';
  const prefix = 'refs/remotes/origin/';
  if (target.startsWith(prefix) && target.length > prefix.length) return target.slice(prefix.length);
  for (const name of ['main', 'master']) if (refs.has(`refs/heads/${name}`)) return name;
  return null;
}

/** The repo name is the common git dir's parent (`~/x/work/.git` → `work`). */
export function repoName(commonDir: string, topLevel: string): string {
  if (basename(commonDir) === '.git') return basename(dirname(commonDir));
  // A bare repo's common dir is the repo itself (`work.git`); anything else (submodules) falls
  // back to the checkout's own name.
  if (commonDir.endsWith('.git')) return basename(commonDir).slice(0, -'.git'.length);
  return basename(topLevel);
}

async function readBranch(git: (...args: string[]) => Promise<string>): Promise<string | null> {
  try {
    const branch = (await git('branch', '--show-current')).trim();
    if (branch) return branch;
    // Detached HEAD: show the short commit instead.
    const sha = (await git('rev-parse', '--short', 'HEAD')).trim();
    return sha || null;
  } catch {
    return null;
  }
}

interface Entry {
  value: GitLocation | null;
  /** True once a read has succeeded (a directory outside git succeeds with null); a failed one keeps the last good value. */
  known: boolean;
  readAt: number;
  lastUsed: number;
  inFlight: boolean;
}

export interface GitCacheOptions {
  read(cwd: string): Promise<GitLocation | null>;
  /** Called when a refresh changed a directory's location. */
  onChange(cwd: string): void;
  ttlMs?: number;
  now?: () => number;
}

/** Per-directory cache of git locations, refreshed in the background every 30 s. */
export class GitCache {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly opts: GitCacheOptions;

  constructor(opts: GitCacheOptions) {
    this.opts = opts;
    this.ttlMs = opts.ttlMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  /** The cached location (null until first read), and a background refresh when stale. */
  get(cwd: string): GitLocation | null {
    const now = this.now();
    let entry = this.entries.get(cwd);
    if (!entry) {
      entry = { value: null, known: false, readAt: -Infinity, lastUsed: now, inFlight: false };
      this.entries.set(cwd, entry);
    }
    entry.lastUsed = now;
    if (!entry.inFlight && now - entry.readAt >= this.ttlMs) void this.refresh(cwd, entry);
    return entry.value;
  }

  /** SIDE-2.9: whether the directory's location is known: read at least once without failing. */
  known(cwd: string): boolean {
    return this.entries.get(cwd)?.known ?? false;
  }

  /** Drops directories nobody asked about for 5 minutes (ended Sessions). */
  prune(): void {
    const cutoff = this.now() - 5 * 60_000;
    for (const [cwd, e] of this.entries) if (e.lastUsed < cutoff && !e.inFlight) this.entries.delete(cwd);
  }

  private async refresh(cwd: string, entry: Entry): Promise<void> {
    entry.inFlight = true;
    const wasKnown = entry.known;
    let value = entry.value;
    try {
      value = await this.opts.read(cwd);
      entry.known = true;
    } catch {
      // A failed read says nothing new: keep the last good value, and retry after the TTL.
    }
    const changed = JSON.stringify(value) !== JSON.stringify(entry.value) || entry.known !== wasKnown;
    entry.value = value;
    entry.readAt = this.now();
    entry.inFlight = false;
    if (changed) this.opts.onChange(cwd);
  }
}
