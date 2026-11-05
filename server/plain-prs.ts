import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { RunError, Runner } from './exec.ts';
import { checkoutId } from './changes.ts';
import { PlainError, type PlainPrSource, type PlainTree } from './plain.ts';
import { branchName } from './work.ts';

/** PLAIN-5.3: while the Spec view or the "Specs" list is open, a newer push is fetched this often. */
export const PR_REFETCH_MS = 60_000;
/** A fetch this recent counts as fresh: the list and then the view opening fetch once, not twice. */
export const PR_FRESH_MS = 5_000;
/** PLAIN-5.2: Lookout's refs of a PR not fetched for this long are deleted. */
export const PR_REF_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 60_000;
const GIT_TIMEOUT_MS = 10_000;
const GH_TIMEOUT_MS = 20_000;
/** How long what a directory is (its clone and `origin`) is trusted before it's read again. */
const DIR_TTL_MS = 5 * 60_000;

export interface PlainPrsOptions {
  runner: Runner;
  /** PLAIN-5.2: directories that may be in a clone: the Start directories and live Sessions' Checkouts. */
  candidates(): readonly string[];
  /** PLAIN-5.2: the PR's base branch from Work's last read; null when Work hasn't read the PR. */
  baseBranch(repo: string, number: number): string | null;
  /** `gh`, asked for the base branch of a PR Work hasn't read. */
  ghBin?: () => string;
  /** Clones found once, remembered across restarts: `~/.lookout/plain-clones.json` unless a test says otherwise. */
  clonesFile?: string;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
}

interface Clone {
  root: string;
  commonDir: string;
}

interface Fetched {
  headSha: string;
  baseSha: string;
  baseBranch: string;
  paths: string[];
  /** When this fetch ended. */
  at: number;
}

interface PrState {
  clone: Clone;
  fetched: Fetched | null;
  /** PLAIN-5.4: why the last fetch failed; null after one that worked. */
  error: string | null;
  /** When the last fetch was tried, whatever came of it. */
  tried: number;
  running: Promise<void> | null;
}

/** A GitHub URL of a `productiveio` repo, as `origin` may be written (https, ssh, scp-like); its name, lower-case, or null. */
export function productiveioRepo(url: string): string | null {
  const m = /^(?:https:\/\/(?:[^@/\s]+@)?github\.com\/|ssh:\/\/git@github\.com(?::22)?\/|git@github\.com:)productiveio\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m?.[1] ? m[1].toLowerCase() : null;
}

/**
 * PLAIN-5.2, 5.3: a PR's commits, fetched into a clone of its repo that Lookout already knows, found
 * by its `origin`: `refs/pull/<n>/head` and the PR's base branch go to Lookout's own refs,
 * `refs/lookout/pr/<n>/head` and `…/base`, and nothing else in the clone changes. The base is the
 * merge-base of the two, as GitHub's "Files changed" compares.
 */
export class PlainPrs implements PlainPrSource {
  private readonly opts: PlainPrsOptions;
  private readonly now: () => number;
  private readonly clonesFile: string;
  /** What each directory is: its clone and the `productiveio` repo its `origin` names. */
  private dirs = new Map<string, { at: number; clone: (Clone & { repo: string }) | null }>();
  /** Clones found, by repo (lower-case); read from the clones file once. */
  private remembered: Promise<Map<string, string>> | null = null;
  private prs = new Map<string, PrState>();
  private sweeping = new Map<string, Promise<void>>();
  /** Per clone (common dir): fetches and sweeps of `refs/lookout/pr/*` run one at a time. */
  private locks = new Map<string, Promise<unknown>>();

  constructor(opts: PlainPrsOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.clonesFile = opts.clonesFile ?? join(homedir(), '.lookout', 'plain-clones.json');
  }

  /** PLAIN-5.1, 5.4: the repos (lower-case) Lookout has a local clone of. */
  async clones(): Promise<string[]> {
    const found = await this.scan();
    return [...found.keys()].sort();
  }

  async tree(repo: string, number: number, fresh: boolean): Promise<{ tree: PlainTree; paths: string[]; error: string | null }> {
    const clone = (await this.scan()).get(repo.toLowerCase());
    if (!clone) throw new PlainError(404, `No local clone of ${repo}.`);
    const key = `${clone.commonDir}\u0000${number}`;
    let st = this.prs.get(key);
    if (!st || st.clone.root !== clone.root) {
      st = { clone, fetched: st?.fetched ?? null, error: null, tried: 0, running: null };
      this.prs.set(key, st);
    }
    const since = this.now() - st.tried;
    // A Retry, or the list or view opening, fetches unless one just did; an open one every minute.
    const due = !st.fetched || (fresh ? st.error !== null || since > PR_FRESH_MS : since > PR_REFETCH_MS);
    if (due) {
      const state = st;
      state.running ??= this.fetch(repo, number, state).finally(() => {
        state.running = null;
      });
      // A newer push is looked for in the background while the view is open; on opening, first.
      if (!state.fetched || fresh) await state.running;
    }
    if (!st.fetched) throw new PlainError(502, st.error ?? `Couldn't fetch #${number}.`);
    const f = st.fetched;
    return {
      tree: {
        id: checkoutId(`pr\u0000${clone.commonDir}\u0000${number}`),
        root: clone.root,
        repo,
        where: `#${number}`,
        baseSha: f.baseSha,
        baseName: `merge-base with ${f.baseBranch}`,
        commonDir: clone.commonDir,
        headSha: f.headSha,
      },
      paths: f.paths,
      error: st.error,
    };
  }

  /** PLAIN-5.2: Lookout's refs of PRs not fetched for a day go, in every clone it knows; at start, and once a day. */
  async prune(): Promise<void> {
    const now = this.now();
    for (const [key, st] of this.prs) if (!st.running && now - st.tried > PR_REF_TTL_MS) this.prs.delete(key);
    const clones = new Map<string, Clone>();
    for (const c of (await this.scan()).values()) clones.set(c.commonDir, c);
    for (const st of this.prs.values()) clones.set(st.clone.commonDir, st.clone);
    for (const c of clones.values()) await this.sweep(c).catch(() => {});
  }

  private async fetch(repo: string, number: number, st: PrState): Promise<void> {
    st.tried = this.now();
    const { root } = st.clone;
    try {
      // Work's read, else GitHub's answer now (a PR can be retargeted), else the last one known.
      const base =
        this.opts.baseBranch(repo, number) ??
        (await this.ghBase(repo, number).catch((err: unknown) => {
          if (st.fetched) return st.fetched.baseBranch;
          throw err;
        }));
      const head = `refs/lookout/pr/${number}/head`;
      const baseRef = `refs/lookout/pr/${number}/base`;
      // Writing the refs and reading them back is one step a sweep of this clone never splits.
      const fetched = await this.locked(st.clone.commonDir, async () => {
      try {
        await this.git(
          root,
          ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', 'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', '--refmap=', 'origin', `+refs/pull/${number}/head:${head}`, `+refs/heads/${base}:${baseRef}`],
          FETCH_TIMEOUT_MS,
        );
      } catch (err) {
        throw new PlainError(502, fetchReason(err, repo, number, base));
      }
      let headSha: string, baseTip: string;
      try {
        headSha = (await this.git(root, ['rev-parse', '--verify', `${head}^{commit}`])).trim();
        baseTip = (await this.git(root, ['rev-parse', '--verify', `${baseRef}^{commit}`])).trim();
      } catch {
        throw new PlainError(502, `git couldn't read #${number}'s commits.`);
      }
      let baseSha: string;
      try {
        baseSha = (await this.git(root, ['merge-base', headSha, baseTip])).trim();
      } catch {
        throw new PlainError(502, `#${number} has no commit in common with ${base}.`);
      }
      const diff = await this.git(root, ['-c', 'core.quotePath=false', 'diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', baseSha, headSha, '--', '*.plain']);
      const paths = diff.split('\u0000').filter(Boolean).sort();
      return { headSha, baseSha, baseBranch: base, paths, at: this.now() };
      });
      st.fetched = fetched;
      st.error = null;
      void this.sweep(st.clone).catch(() => {});
    } catch (err) {
      st.error = err instanceof PlainError ? err.message : `Couldn't fetch #${number}.`;
    }
  }

  /** Runs `fn` once every earlier fetch or sweep of this clone has ended. */
  private locked<T>(commonDir: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(commonDir) ?? Promise.resolve()).catch(() => {}).then(fn);
    const tail = run.catch(() => {});
    this.locks.set(commonDir, tail);
    void tail.then(() => {
      if (this.locks.get(commonDir) === tail) this.locks.delete(commonDir);
    });
    return run;
  }

  /** The base branch of a PR Work hasn't read, from GitHub through `gh`. */
  private async ghBase(repo: string, number: number): Promise<string> {
    let out: string;
    try {
      out = await this.opts.runner(this.opts.ghBin?.() ?? 'gh', ['pr', 'view', String(number), '--repo', `productiveio/${repo}`, '--json', 'baseRefName', '--jq', '.baseRefName'], {
        timeoutMs: GH_TIMEOUT_MS,
        env: { ...(this.opts.env ?? process.env), GH_PROMPT_DISABLED: '1' },
      });
    } catch {
      throw new PlainError(502, `Lookout doesn't know #${number}'s base branch, and gh couldn't say. Open Work, then Retry.`);
    }
    const base = branchName(out.trim());
    if (!base) throw new PlainError(502, `gh gave #${number} a base branch Lookout can't fetch.`);
    return base;
  }

  /** PLAIN-5.2: deletes this clone's `refs/lookout/pr/*` of PRs not fetched for a day (or by an earlier run). */
  private sweep(c: Clone): Promise<void> {
    const running = this.sweeping.get(c.commonDir);
    if (running) return running;
    const run = this.locked(c.commonDir, async () => {
      const refs = (await this.git(c.root, ['for-each-ref', '--format=%(refname)', 'refs/lookout/pr/'])).split('\n').filter(Boolean);
      const now = this.now();
      const old = refs.filter((ref) => {
        const m = /^refs\/lookout\/pr\/([0-9]+)\/(?:head|base)$/.exec(ref);
        const st = m ? this.prs.get(`${c.commonDir}\u0000${Number(m[1])}`) : undefined;
        // A fetch in flight has written its refs and not yet read them: they stay.
        if (st?.running) return false;
        return !st?.fetched || now - st.fetched.at > PR_REF_TTL_MS;
      });
      if (old.length) await this.git(c.root, ['update-ref', '--stdin'], GIT_TIMEOUT_MS, old.map((ref) => `delete ${ref}\n`).join(''));
    }).finally(() => this.sweeping.delete(c.commonDir));
    this.sweeping.set(c.commonDir, run);
    return run;
  }

  /** PLAIN-5.2: the clones of `productiveio` repos among the candidates and the ones remembered, by repo. */
  private async scan(): Promise<Map<string, Clone>> {
    const remembered = await this.loadRemembered();
    const found = new Map<string, Clone>();
    const dirs = [...remembered.values(), ...this.opts.candidates()];
    for (const dir of new Set(dirs)) {
      const c = await this.dir(dir);
      if (c && !found.has(c.repo)) found.set(c.repo, { root: c.root, commonDir: c.commonDir });
    }
    let changed = false;
    for (const [repo, c] of found) {
      if (remembered.get(repo) === c.root) continue;
      remembered.set(repo, c.root);
      changed = true;
    }
    if (changed) void this.saveRemembered(remembered).catch(() => {});
    return found;
  }

  /** What a directory is, read again after five minutes: its clone's top level and common dir, and `origin`'s repo. */
  private async dir(dir: string): Promise<(Clone & { repo: string }) | null> {
    const kept = this.dirs.get(dir);
    if (kept && this.now() - kept.at < DIR_TTL_MS) return kept.clone;
    let clone: (Clone & { repo: string }) | null = null;
    try {
      const [root, commonDir] = (await this.git(dir, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'])).trim().split('\n');
      const url = (await this.git(dir, ['config', '--get', 'remote.origin.url'])).trim();
      const repo = productiveioRepo(url);
      if (root && commonDir && repo) clone = { root, commonDir, repo };
    } catch {
      // not a git directory, gone, or no origin
    }
    this.dirs.set(dir, { at: this.now(), clone });
    if (this.dirs.size > 500) this.dirs.clear();
    return clone;
  }

  private loadRemembered(): Promise<Map<string, string>> {
    this.remembered ??= (async () => {
      const out = new Map<string, string>();
      try {
        const raw = JSON.parse(await readFile(this.clonesFile, 'utf8')) as { v?: unknown; clones?: unknown };
        if (raw?.v === 1 && raw.clones && typeof raw.clones === 'object') {
          for (const [repo, root] of Object.entries(raw.clones as Record<string, unknown>)) if (typeof root === 'string' && root.startsWith('/')) out.set(repo, root);
        }
      } catch {
        // none yet, or unreadable: start empty
      }
      return out;
    })();
    return this.remembered;
  }

  private async saveRemembered(clones: Map<string, string>): Promise<void> {
    await mkdir(dirname(this.clonesFile), { recursive: true, mode: 0o700 });
    const tmp = `${this.clonesFile}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify({ v: 1, clones: Object.fromEntries(clones) }), { mode: 0o600 });
    await rename(tmp, this.clonesFile);
  }

  /**
   * PLAIN-6.2: git with the clone's hooks and fsmonitor off, never asking for anything: no terminal
   * prompt, no askpass dialog, no interactive credential helper, ssh in batch mode. Saved
   * credentials (a keychain helper, an ssh agent) still work.
   */
  private async git(cwd: string, args: readonly string[], timeoutMs = GIT_TIMEOUT_MS, stdin?: string): Promise<string> {
    const env = { ...(this.opts.env ?? process.env) };
    if (args.includes('fetch')) {
      // ssh in batch mode, so a locked key fails instead of asking, keeping git's own order: the
      // GIT_SSH_COMMAND environment variable, then core.sshCommand, then GIT_SSH, then ssh. A
      // GIT_SSH program, or a command that isn't OpenSSH's, is left as it is.
      const own = env.GIT_SSH_COMMAND || (await this.git(cwd, ['config', '--get', 'core.sshCommand']).catch(() => '')).trim();
      if (own) {
        if (/^(?:\S*\/)?ssh(?:\s|$)/.test(own)) env.GIT_SSH_COMMAND = `${own} -o BatchMode=yes`;
      } else if (!env.GIT_SSH) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes';
    }
    return this.opts.runner('git', ['-C', cwd, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'credential.interactive=never', ...args], {
      timeoutMs,
      env: { ...env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/false', SSH_ASKPASS: '/usr/bin/false', SSH_ASKPASS_REQUIRE: 'never', GCM_INTERACTIVE: 'never' },
      ...(stdin !== undefined ? { stdin } : {}),
    });
  }
}

/** PLAIN-5.4: why a fetch failed, in plain words, from git's first line. */
function fetchReason(err: unknown, repo: string, number: number, base: string): string {
  const e = err as RunError;
  if (e.timedOut) return `Fetching #${number} took longer than a minute. Retry later.`;
  const stderr = e.stderr ?? '';
  if (/couldn't find remote ref refs\/pull\//i.test(stderr)) return `GitHub has no PR #${number} in ${repo}.`;
  if (/couldn't find remote ref refs\/heads\//i.test(stderr)) return `${base}, #${number}'s base branch, isn't on GitHub.`;
  const line = stderr
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean)
    ?.replace(/^(fatal|error):\s*/i, '')
    .slice(0, 200);
  return line ? `Couldn't fetch #${number}: ${line}` : `Couldn't fetch #${number}.`;
}
