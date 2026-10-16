import { basename, dirname } from 'node:path';
import type { GitLocation } from '../shared/types.ts';
import type { Runner } from './exec.ts';

const GIT_TIMEOUT_MS = 3000;

/**
 * Reads where a directory sits in git, with argv only (never a shell string).
 * Returns null for a directory that isn't in a git checkout, or that git can't read.
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
  } catch {
    return null;
  }

  const linked = gitDir !== commonDir;
  return {
    repo: repoName(commonDir, topLevel),
    worktree: linked ? basename(topLevel) : null,
    branch: await readBranch(git),
  };
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
      entry = { value: null, readAt: -Infinity, lastUsed: now, inFlight: false };
      this.entries.set(cwd, entry);
    }
    entry.lastUsed = now;
    if (!entry.inFlight && now - entry.readAt >= this.ttlMs) void this.refresh(cwd, entry);
    return entry.value;
  }

  /** Drops directories nobody asked about for 5 minutes (ended Sessions). */
  prune(): void {
    const cutoff = this.now() - 5 * 60_000;
    for (const [cwd, e] of this.entries) if (e.lastUsed < cutoff && !e.inFlight) this.entries.delete(cwd);
  }

  private async refresh(cwd: string, entry: Entry): Promise<void> {
    entry.inFlight = true;
    let value: GitLocation | null;
    try {
      value = await this.opts.read(cwd);
    } catch {
      value = null;
    }
    const changed = JSON.stringify(value) !== JSON.stringify(entry.value);
    entry.value = value;
    entry.readAt = this.now();
    entry.inFlight = false;
    if (changed) this.opts.onChange(cwd);
  }
}
