import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import type { RunError, Runner } from './exec.ts';
import { cleanEnv } from './launcher.ts';
import { PlainError } from './plain.ts';
import { resolveResBin } from './res.ts';
import { sanitizeLine } from './sanitize.ts';

/** PLAIN-11.15: an install of a PR's dependencies is cut off after this. */
export const INSTALL_TIMEOUT_MS = 300_000;
const COPY_TIMEOUT_MS = 180_000;
const ADD_TIMEOUT_MS = 120_000;
const GIT_TIMEOUT_MS = 15_000;
/** The lockfiles Lookout can install from, each with its install. */
const LOCKFILES: readonly { name: string; cmd: string; args: readonly string[] }[] = [
  { name: 'package-lock.json', cmd: 'npm', args: ['ci', '--no-audit', '--no-fund', '--loglevel=error'] },
  { name: 'pnpm-lock.yaml', cmd: 'pnpm', args: ['install', '--frozen-lockfile', '--reporter=silent'] },
];

/** What a PR's worktree is being made ready by, for the wait (PLAIN-11.15). */
export type WorktreePhase = 'worktree' | 'copying' | 'installing';

export interface Worktree {
  path: string;
  head: string | null;
  bare: boolean;
  prunable: boolean;
}

/** `git worktree list --porcelain -z`, read. */
export function parseWorktrees(out: string): Worktree[] {
  const list: Worktree[] = [];
  let cur: Worktree | null = null;
  for (const field of out.split('\u0000')) {
    if (field === '') {
      if (cur) list.push(cur);
      cur = null;
      continue;
    }
    const sp = field.indexOf(' ');
    const [k, v] = sp < 0 ? [field, ''] : [field.slice(0, sp), field.slice(sp + 1)];
    if (k === 'worktree') {
      if (cur) list.push(cur);
      cur = { path: v, head: null, bare: false, prunable: false };
    } else if (!cur) continue;
    else if (k === 'HEAD') cur.head = v;
    else if (k === 'bare') cur.bare = true;
    else if (k === 'prunable') cur.prunable = true;
  }
  if (cur) list.push(cur);
  return list;
}

/**
 * PLAIN-11.4: the environment with the Node a checkout's `.nvmrc` or `.node-version` names first on
 * `PATH`, the newest nvm has that fits; as it was when there's no such file or nvm hasn't the version.
 */
export async function withRepoNode(root: string, env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  let want: string | null = null;
  for (const f of ['.nvmrc', '.node-version']) {
    const v = await readFile(join(root, f), 'utf8').then(
      (t) => t.trim().replace(/^v/, ''),
      () => null,
    );
    // `lts/*` and the like aren't a version nvm's folders name: the next file may have one.
    if (v && /^[0-9]+(?:\.[0-9]+){0,2}$/.test(v)) {
      want = v;
      break;
    }
  }
  if (!want) return env;
  const dir = join(env.NVM_DIR || join(env.HOME || homedir(), '.nvm'), 'versions', 'node');
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return env;
  }
  const fits = names
    .map((n) => n.replace(/^v/, ''))
    .filter((v) => /^[0-9]+\.[0-9]+\.[0-9]+$/.test(v) && (v === want || v.startsWith(`${want}.`)))
    .sort((a, b) => {
      const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
      return y[0]! - x[0]! || y[1]! - x[1]! || y[2]! - x[2]!;
    });
  for (const v of fits) {
    const bin = join(dir, `v${v}`, 'bin');
    try {
      await access(join(bin, 'node'), constants.X_OK);
      return { ...env, PATH: [bin, env.PATH].filter(Boolean).join(delimiter) };
    } catch {
      // a broken install: the next
    }
  }
  return env;
}

export interface PrWorktreeRequest {
  /** The clone the PR was fetched into (PLAIN-5.2). */
  clone: string;
  repo: string;
  number: number;
  headSha: string;
  signal: AbortSignal;
  onPhase(phase: WorktreePhase): void;
}

export interface PrWorktree {
  /** Where the tests run. */
  root: string;
  /** Lookout added it, so `release` removes it. */
  added: boolean;
  /** Still at the head with nothing changed: what ran is what the PR has. */
  unchanged(): Promise<boolean>;
  release(): Promise<void>;
}

export interface PlainWorktreesOptions {
  runner: Runner;
  /** `~/.lookout/plain-worktrees` unless a test says otherwise. */
  dir?: string;
  env?: NodeJS.ProcessEnv;
}

const hasPlaywright = (root: string) =>
  access(join(root, 'node_modules', '.bin', 'playwright'), constants.X_OK).then(
    () => true,
    () => false,
  );

const exists = (p: string) =>
  lstat(p).then(
    () => true,
    () => false,
  );

/**
 * PLAIN-11.15: a worktree of a PR's head to run its tests in: one already there at the head and
 * clean, else one Lookout adds and removes after the run; with its dependencies, copied from a
 * checkout with the same lockfile or installed.
 */
export class PlainWorktrees {
  private readonly opts: PlainWorktreesOptions;
  private readonly dir: string;

  constructor(opts: PlainWorktreesOptions) {
    this.opts = opts;
    this.dir = resolve(opts.dir ?? join(homedir(), '.lookout', 'plain-worktrees'));
  }

  async acquire(r: PrWorktreeRequest): Promise<PrWorktree> {
    try {
      return await this.ready(r);
    } catch (err) {
      throw failure(err, `Couldn't get #${r.number}'s worktree ready`);
    }
  }

  private async ready(r: PrWorktreeRequest): Promise<PrWorktree> {
    const all = parseWorktrees(await this.git(r.clone, ['worktree', 'list', '--porcelain', '-z'], GIT_TIMEOUT_MS, r.signal));
    // A worktree of the PR's head, as a review checks one out, is run in as it is: one with its
    // Playwright first. One at another commit is never moved: a review may be reading it.
    const reusable: { path: string; ready: boolean }[] = [];
    for (const w of all) {
      if (w.bare || w.prunable || w.head !== r.headSha || this.isMine(w.path)) continue;
      if (!(await this.clean(w.path, r.signal))) continue;
      reusable.push({ path: w.path, ready: await hasPlaywright(w.path) });
    }
    reusable.sort((a, b) => Number(b.ready) - Number(a.ready));
    let root: string;
    let added = false;
    if (reusable[0]) root = reusable[0].path;
    else {
      r.onPhase('worktree');
      root = join(this.dir, `${r.repo}-${r.number}`);
      // One left by a run Lookout didn't see end.
      await this.remove(root);
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      try {
        // `-f`: an earlier one git couldn't remove is still registered, its folder gone.
        await this.git(r.clone, ['worktree', 'add', '-f', '--detach', '--quiet', root, r.headSha], ADD_TIMEOUT_MS, r.signal);
      } catch (err) {
        await this.remove(root);
        throw failure(err, `Couldn't check out #${r.number}`);
      }
      added = true;
    }
    const release = async () => {
      if (added) await this.remove(root);
    };
    try {
      await this.dependencies(root, all, r);
    } catch (err) {
      await release();
      throw err;
    }
    const unchanged = async () => {
      try {
        return (await this.git(root, ['rev-parse', 'HEAD'])).trim() === r.headSha && (await this.clean(root, new AbortController().signal));
      } catch {
        return false;
      }
    };
    return { root, added, unchanged, release };
  }

  /** PLAIN-11.15: worktrees left by runs Lookout didn't see end; at start. */
  async prune(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return;
    }
    for (const n of names) await this.remove(join(this.dir, n)).catch(() => {});
  }

  private isMine(path: string): boolean {
    return dirname(resolve(path)) === this.dir;
  }

  /** Nothing changed or added since its HEAD, so it runs what the PR's head has. */
  private async clean(path: string, signal: AbortSignal): Promise<boolean> {
    try {
      return (await this.git(path, ['status', '--porcelain', '-z', '--untracked-files=normal'], GIT_TIMEOUT_MS, signal)) === '';
    } catch {
      return false;
    }
  }

  private async dependencies(root: string, all: readonly Worktree[], r: PrWorktreeRequest): Promise<void> {
    if (await hasPlaywright(root)) return;
    const modules = join(root, 'node_modules');
    // Someone else's node_modules isn't Lookout's to replace.
    if (await exists(modules)) throw new PlainError(400, `Install #${r.number}'s dependencies in ${root} first: its Playwright isn't there.`);
    let lock: { name: string; cmd: string; args: readonly string[]; bytes: Buffer } | null = null;
    for (const l of LOCKFILES) {
      try {
        lock = { ...l, bytes: await readFile(join(root, l.name)) };
        break;
      } catch {
        // not this one
      }
    }
    if (!lock) throw new PlainError(400, `#${r.number} has no ${LOCKFILES.map((l) => l.name).join(' or ')}, so Lookout can't get its dependencies.`);
    const donor = await this.donor(root, all, lock);
    if (donor) {
      // A copy-on-write clone, not a link: Vite serves nothing from outside the worktree. Made in
      // Lookout's folder and moved in whole, so a failure never takes out what someone else put there.
      r.onPhase('copying');
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      const tmp = join(this.dir, `.copy-${randomBytes(6).toString('hex')}`);
      try {
        const args = process.platform === 'darwin' ? ['-cR'] : ['-R', '--reflink=auto'];
        await this.opts.runner('cp', [...args, join(donor, 'node_modules'), tmp], { timeoutMs: COPY_TIMEOUT_MS, env: cleanEnv(this.opts.env ?? process.env), signal: r.signal });
        if (await exists(modules)) throw new PlainError(409, `Someone put dependencies in ${root} while Lookout copied them. Press again.`);
        await rename(tmp, modules);
      } catch (err) {
        await rm(tmp, { recursive: true, force: true }).catch(() => {});
        throw failure(err, `Copying #${r.number}'s dependencies failed`, 'cp');
      }
    } else {
      try {
        r.onPhase('installing');
        const base = cleanEnv(this.opts.env ?? process.env);
        delete base.NODE_ENV;
        delete base.npm_config_production;
        base.HUSKY = '0';
        const env = await withRepoNode(root, base);
        const res = resolveResBin(env);
        const [file, argv] = res !== 'res' ? [res, ['run', '--prio', 'live', '--', lock.cmd, ...lock.args]] : [lock.cmd, [...lock.args]];
        await this.opts.runner(file, argv, { timeoutMs: INSTALL_TIMEOUT_MS, env, cwd: root, signal: r.signal });
      } catch (err) {
        // What didn't finish goes; nothing was there before it.
        await rm(modules, { recursive: true, force: true }).catch(() => {});
        throw failure(err, `Installing #${r.number}'s dependencies failed`, lock.cmd);
      }
    }
    if (!(await hasPlaywright(root))) throw new PlainError(400, `#${r.number}'s dependencies have no Playwright.`);
  }

  /** A checkout of the same clone with the head's lockfile, byte for byte, and its Playwright. */
  private async donor(root: string, all: readonly Worktree[], lock: { name: string; bytes: Buffer }): Promise<string | null> {
    for (const w of all) {
      if (w.bare || w.prunable || w.path === root) continue;
      try {
        // A linked node_modules would be copied as the link.
        if (!(await lstat(join(w.path, 'node_modules'))).isDirectory() || !(await hasPlaywright(w.path))) continue;
        if ((await stat(join(w.path, lock.name))).size !== lock.bytes.length) continue;
        if ((await readFile(join(w.path, lock.name))).equals(lock.bytes)) return w.path;
      } catch {
        // gone, or no lockfile
      }
    }
    return null;
  }

  /** Removes a worktree Lookout added: only ever one in its own folder. */
  private async remove(path: string): Promise<void> {
    if (!this.isMine(path)) return;
    const st = await lstat(path).catch(() => null);
    if (!st) return;
    // A link is only ever unlinked: git would follow it to the worktree it names.
    if (!st.isDirectory()) return void (await rm(path, { force: true }));
    try {
      const common = (await this.git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
      if (common) await this.git(null, [`--git-dir=${common}`, 'worktree', 'remove', '--force', resolve(path)], ADD_TIMEOUT_MS);
    } catch {
      // not a worktree any more, or git couldn't: the folder goes all the same
    }
    // `rm` never follows a link out of the folder.
    await rm(path, { recursive: true, force: true });
  }

  private git(cwd: string | null, args: readonly string[], timeoutMs = GIT_TIMEOUT_MS, signal?: AbortSignal): Promise<string> {
    return this.opts.runner('git', [...(cwd ? ['-C', cwd] : []), '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], {
      timeoutMs,
      env: { ...cleanEnv(this.opts.env ?? process.env), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      ...(signal ? { signal } : {}),
    });
  }
}

/** A step that failed, as PLAIN-11.13's Alert says it: cancelled, cut off, or its first error line. */
function failure(err: unknown, what: string, program = 'git'): Error {
  const e = err as RunError & { reason?: string };
  if (err instanceof PlainError || e.reason) return err as Error;
  if (e.aborted) return Object.assign(new Error('cancelled'), { aborted: true });
  if (e.timedOut) return Object.assign(new Error('timed out'), { reason: `${what}: it took too long and was stopped.` });
  if (e.code === 'ENOENT') return Object.assign(new Error('not installed'), { reason: `${what}: ${program} isn't installed.` });
  const lines = (e.stderr ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const line = sanitizeLine(lines.find((l) => /error/i.test(l)) ?? lines[0] ?? '', 200);
  return Object.assign(new Error(what), { reason: line ? `${what}: ${line}` : `${what}.` });
}
