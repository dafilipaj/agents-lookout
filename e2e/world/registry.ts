import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertInsideRepo, CACHE_DIR, REPO_ROOT, pathProblems } from './pins.ts';
import { type Identity, describeProc, listProcessesSync, ownedProcesses, remembered, signalVerified } from './processes.ts';

/**
 * Where a World is written down before it starts anything (TEST-1.8), so that a run that was
 * interrupted (SIGINT while a World was starting, a worker that died) can still be cleaned up:
 *
 * - `.cache/e2e/runs/<run>/run.json`: the Playwright runner of that run (pid and start time);
 * - `.cache/e2e/runs/<run>/worlds/<id>.json`: each World of the run with its token (the value of
 *   `LOOKOUT_WORLD_ID` its processes inherit), written before any of its directories or processes
 *   exist and removed once its teardown is done.
 *
 * Global setup sweeps the Worlds of runs whose runner is gone; global teardown sweeps what is
 * left of its own run, and fails the run naming it.
 */

export const E2E_CACHE = join(CACHE_DIR, 'e2e');
/** Set by global setup for the workers: this run's directory under `.cache/e2e/runs/`. */
export const RUN_DIR_ENV = 'LOOKOUT_E2E_RUN_DIR';
/** Where every World's root lives: `<it>/lookout-world-<id>`. */
export const WORLDS_DIR = tmpdir();

/** A directory of a World's: its root, or its TMUX_TMPDIR. */
export type WorldDir = 'root' | 'tmuxTmpdir';

export interface WorldEntry {
  id: string;
  /** The value of `LOOKOUT_WORLD_ID` in the environment of every process the World starts. */
  token: string;
  root: string;
  tmuxTmpdir: string;
  createdAt: number;
  /** The Behaviour test it belongs to, to name what a sweep finds. */
  label: string;
  /**
   * The directories this World created itself (exclusively, so they were nobody else's), written
   * down right after each was made. Only these are ever removed: a directory that was already there
   * when the World started is someone else's, though it has the World's name.
   */
  owns: WorldDir[];
}

interface RunInfo {
  pid: number;
  startMs: number;
}

/** A World's id: 8 hex digits, in its paths and its token. */
const WORLD_ID = /^[0-9a-f]{8}$/;

/** The directories a World with this id has: its root and its TMUX_TMPDIR. Nothing else is ever removed. */
export function worldDirs(id: string): { root: string; tmuxTmpdir: string } {
  if (!WORLD_ID.test(id)) throw new Error(`Not a World id: ${JSON.stringify(id)}`);
  // A socket path is limited to ~104 bytes, so tmux's directory is short and under /tmp.
  return { root: join(WORLDS_DIR, `lookout-world-${id}`), tmuxTmpdir: `/tmp/lw-${id}` };
}

/** When `pid` started (ms, to the second), or null when no such process runs. */
export function processStart(pid: number): number | null {
  try {
    const out = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' }, encoding: 'utf8' });
    const ms = Date.parse(`${out.trim()} UTC`);
    return Number.isNaN(ms) ? null : ms;
  } catch {
    return null;
  }
}

/**
 * This run's directory: the one global setup made, or (a World started outside `pnpm e2e`) one of
 * this process's own. It is created whole (written, then renamed into place), so a sweep never
 * sees a run without its runner.
 */
export function runDir(cacheRoot = E2E_CACHE, opts: { repoRoot?: string } = {}): string {
  const fromEnv = process.env[RUN_DIR_ENV];
  if (fromEnv) return fromEnv;
  const dir = createRunDir(cacheRoot, opts);
  process.env[RUN_DIR_ENV] = dir;
  return dir;
}

/**
 * `runs/` under `cacheRoot` is a plain directory of the repo's: no symlink from `repoRoot` down to it.
 * A sweep removes what it finds there, so a `runs` (or `.cache`, or `e2e`) linked elsewhere would
 * have it delete someone else's directories.
 */
export function createRunDir(cacheRoot = E2E_CACHE, opts: { repoRoot?: string } = {}): string {
  const runs = join(cacheRoot, 'runs');
  assertInsideRepo(runs, { create: true, repoRoot: opts.repoRoot ?? REPO_ROOT });
  const startMs = processStart(process.pid);
  if (startMs === null) throw new Error(`Can't read this process's start time (pid ${process.pid}).`);
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${randomBytes(3).toString('hex')}`;
  const staging = join(runs, `.new-${name}`);
  mkdirSync(join(staging, 'worlds'), { recursive: true });
  writeFileSync(join(staging, 'run.json'), JSON.stringify({ pid: process.pid, startMs } satisfies RunInfo));
  const dir = join(runs, name);
  renameSync(staging, dir);
  return dir;
}

/** Rewrites a World's index entry whole (written, then renamed into place). */
function rewriteEntry(path: string, entry: WorldEntry): void {
  const staging = `${path}.new`;
  writeFileSync(staging, JSON.stringify(entry, null, 2));
  renameSync(staging, path);
}

const isEexist = (err: unknown) => (err as NodeJS.ErrnoException).code === 'EEXIST';

/** How many World ids `reserveWorld` tries before it gives up. */
const RESERVE_ATTEMPTS = 8;

/**
 * Reserves a World: an id nobody has, its index entry, its root and its TMUX_TMPDIR, each created
 * exclusively. The entry is written first, before any directory of the World exists; each
 * directory is added to its `owns` once made. An id whose entry or directory already exists is
 * someone else's: what this call made for it is removed again (only that), and the next id is
 * tried. Returns the entry and where it is written.
 */
export function reserveWorld(
  label: string | ((id: string) => string),
  opts: { dir?: string; nextId?: () => string; attempts?: number } = {},
): { entry: WorldEntry; entryPath: string } {
  const dir = opts.dir ?? runDir();
  const nextId = opts.nextId ?? (() => randomBytes(4).toString('hex'));
  const taken: string[] = [];
  for (let attempt = 0; attempt < (opts.attempts ?? RESERVE_ATTEMPTS); attempt++) {
    const id = nextId();
    const { root, tmuxTmpdir } = worldDirs(id);
    const entry: WorldEntry = {
      id,
      // TEST-1.8: what makes a process the World's. Only this World's processes inherit it.
      token: `${id}.${randomBytes(12).toString('hex')}`,
      root,
      tmuxTmpdir,
      createdAt: Date.now(),
      label: typeof label === 'function' ? label(id) : label,
      owns: [],
    };
    const entryPath = join(dir, 'worlds', `${id}.json`);
    try {
      writeFileSync(entryPath, JSON.stringify(entry, null, 2), { flag: 'wx' });
    } catch (err) {
      if (!isEexist(err)) throw err;
      taken.push(entryPath);
      continue;
    }
    const made: string[] = [];
    let collided: string | null = null;
    try {
      for (const [what, path, mode] of [
        ['root', root, 0o777],
        ['tmuxTmpdir', tmuxTmpdir, 0o700],
      ] as const) {
        try {
          mkdirSync(path, { mode });
        } catch (err) {
          if (isEexist(err)) collided = path;
          throw err;
        }
        // Written down at once. Should the run die in between, the directory is left behind
        // rather than someone else's removed.
        made.push(path);
        entry.owns.push(what);
        rewriteEntry(entryPath, entry);
      }
      return { entry, entryPath };
    } catch (err) {
      // Undo only what this attempt made: never a directory that was already there.
      for (const path of made) rmSync(path, { recursive: true, force: true });
      rmSync(entryPath, { force: true });
      rmSync(`${entryPath}.new`, { force: true });
      if (!collided) throw err;
      taken.push(collided);
    }
  }
  throw new Error(`No free World id: each one tried was taken (${taken.join(', ')}).`);
}

export function readEntry(path: string): WorldEntry | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as WorldEntry;
  } catch {
    return null;
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Tears down a World from its index entry alone, synchronously: every process carrying its token
 * (and what they started) gets SIGTERM, then SIGKILL after `graceMs`, each by its pid and only
 * while its start time still matches. Once none is left, its directories and the entry are
 * removed; a directory that doesn't look like the World's own is never removed. Returns what it
 * found.
 */
export function sweepWorld(entryPath: string, opts: { graceMs?: number } = {}): string[] {
  const entry = readEntry(entryPath);
  const found: string[] = [];
  if (!entry) {
    rmSync(entryPath, { force: true });
    return found;
  }
  let known: Identity[] = [];
  const owned = () => {
    const procs = ownedProcesses(listProcessesSync(), entry.token, { known, notBefore: entry.createdAt });
    known = remembered(known, procs);
    return procs;
  };
  const waitGone = (ms: number) => {
    const deadline = Date.now() + ms;
    let left = owned();
    while (left.length && Date.now() < deadline) {
      sleepSync(100);
      left = owned();
    }
    return left;
  };

  const first = owned();
  signalVerified(first, 'SIGTERM');
  let left = waitGone(opts.graceMs ?? 2000);
  const stubborn = new Set(left.map((p) => p.pid));
  for (const p of first) if (!stubborn.has(p.pid)) found.push(`process ${describeProc(p)}`);
  for (const p of left) found.push(`process ${describeProc(p)} (needed SIGKILL)`);
  signalVerified(left, 'SIGKILL');
  left = waitGone(2000);
  if (left.length) {
    // Its directories stay until its processes are gone; the entry stays for the next sweep.
    for (const p of left) found.push(`process ${describeProc(p)} still runs after SIGKILL, so the World's directories are kept`);
    return found;
  }

  let expected: { root: string; tmuxTmpdir: string } | null = null;
  try {
    expected = worldDirs(entry.id);
  } catch {
    // not a World id: nothing is removed
  }
  const owns = Array.isArray(entry.owns) ? entry.owns : [];
  for (const [what, dir, want] of [
    ['root', entry.root, expected?.root],
    ['tmuxTmpdir', entry.tmuxTmpdir, expected?.tmuxTmpdir],
  ] as const) {
    if (!dir || !existsSync(dir)) continue;
    if (!owns.includes(what)) {
      found.push(`directory ${dir} not removed: it was there before the World, so it isn't the World's`);
      continue;
    }
    if (dir !== want) {
      found.push(`directory ${dir} not removed: a World's own are lookout-world-<id> in ${WORLDS_DIR} and /tmp/lw-<id>`);
      continue;
    }
    found.push(`directory ${dir}`);
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(entryPath, { force: true });
  return found;
}

/** Whether `path` is a directory itself, not a symlink to one (nor anything else). */
function plainDir(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/** The index entries of a run's Worlds: plain files in its plain `worlds/` directory, never through a symlink. */
export function worldEntries(dir: string): string[] {
  const worlds = join(dir, 'worlds');
  if (!plainDir(dir) || !plainDir(worlds)) return [];
  try {
    return readdirSync(worlds)
      .filter((f) => f.endsWith('.json'))
      .map((f) => join(worlds, f))
      .filter((f) => lstatSync(f, { throwIfNoEntry: false })?.isFile());
  } catch {
    return [];
  }
}

/** Whether the run's Playwright runner is still the process it recorded. */
export function runIsLive(dir: string): boolean {
  let info: RunInfo;
  try {
    info = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as RunInfo;
  } catch {
    return false;
  }
  return processStart(info.pid) === info.startMs;
}

/**
 * Sweeps every World of a run, then the run's directory once no World of it is left. A run
 * directory, or its `worlds/`, that is a symlink is never followed nor removed.
 */
export function sweepRun(dir: string, opts: { graceMs?: number } = {}): Map<string, string[]> {
  const swept = new Map<string, string[]>();
  const worlds = join(dir, 'worlds');
  if (!plainDir(dir) || (existsSync(worlds) && !plainDir(worlds))) {
    swept.set(dir, [`${dir} not swept: it or its worlds/ is not a plain directory`]);
    return swept;
  }
  for (const entry of worldEntries(dir)) {
    const found = sweepWorld(entry, opts);
    if (found.length) swept.set(entry, found);
  }
  if (worldEntries(dir).length === 0) rmSync(dir, { recursive: true, force: true });
  return swept;
}

/**
 * Global setup: the Worlds of earlier runs whose runner is gone (an interrupted run). A run
 * whose runner still lives (another `pnpm e2e` in parallel) is left alone.
 */
export function sweepDeadRuns(
  cacheRoot = E2E_CACHE,
  opts: { except?: string; graceMs?: number; repoRoot?: string } = {},
): Map<string, string[]> {
  const runs = join(cacheRoot, 'runs');
  const swept = new Map<string, string[]>();
  // The whole way from the repo down to runs/ is plain directories of the repo's own, checked
  // before anything in it is read or removed: a link anywhere on it would point the sweep at
  // someone else's directory.
  const problems = pathProblems(runs, opts.repoRoot ?? REPO_ROOT);
  if (problems.length) throw new Error(`Won't sweep ${runs}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  let names: string[];
  try {
    names = readdirSync(runs);
  } catch {
    return swept;
  }
  for (const name of names) {
    const dir = join(runs, name);
    if (dir === opts.except) continue;
    // Only a run's own directory, never a symlink to one, nor a file.
    const info = lstatSync(dir, { throwIfNoEntry: false });
    if (!info?.isDirectory()) continue;
    if (name.startsWith('.new-')) {
      // A run directory that was never renamed into place: nothing ran from it. Another run's
      // global setup may be renaming or removing it right now.
      if (Date.now() - info.mtimeMs > 60_000) rmSync(dir, { recursive: true, force: true });
      continue;
    }
    if (runIsLive(dir)) continue;
    for (const [entry, found] of sweepRun(dir, opts)) swept.set(entry, found);
  }
  return swept;
}

/** Leftovers a teardown named, for global teardown to fail the run on (TEST-1.8). */
export function recordLeftovers(title: string, leftovers: readonly string[], dir = runDir()): void {
  if (leftovers.length === 0) return;
  appendFileSync(join(dir, 'leftovers.log'), `${title}\n${leftovers.map((l) => `  ${l}\n`).join('')}`);
}

export function readLeftovers(dir: string): string {
  try {
    return readFileSync(join(dir, 'leftovers.log'), 'utf8');
  } catch {
    return '';
  }
}
