import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCargoRecord } from '../../server/cargo-record.ts';

/**
 * TEST-1.3: the real Fleet fork and tb-session, pinned in `e2e/pins.json` and installed into
 * `.cache/<package>-<rev>` by `pnpm e2e:setup`. Never the user's own binaries.
 */

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CACHE_DIR = join(REPO_ROOT, '.cache');
export const SETUP_COMMAND = 'pnpm e2e:setup';

export interface Pin {
  repo: string;
  branch?: string;
  /** The full commit the binary is built from. */
  rev: string;
  package: string;
  bin: string;
  /** When set, `<bin> --version` must print it. */
  version?: string;
}

export type PinName = 'fleet' | 'tbSession';

export function loadPins(): Record<PinName, Pin> {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'e2e', 'pins.json'), 'utf8')) as Record<PinName, Pin>;
}

/** `.cache/fleet-ce2bbe1`: one directory per pinned revision, so a bump never reuses a stale build. */
export function installRoot(pin: Pin, cache = CACHE_DIR): string {
  return join(cache, `${pin.package}-${pin.rev.slice(0, 7)}`);
}

export function pinnedBin(pin: Pin, cache = CACHE_DIR): string {
  return join(installRoot(pin, cache), 'bin', pin.bin);
}

export function installArgs(pin: Pin): string[] {
  return ['install', '--git', pin.repo, '--rev', pin.rev, '--locked', '--root', installRoot(pin), pin.package];
}

export type PinCheck = { ok: true; bin: string; version: string } | { ok: false; problem: string };

/**
 * Why `path` can't be used as a directory of the repo's own: a part of it, from the repo root
 * down, is a symlink or not a directory, or it resolves outside the repo. `cargo install --root`
 * follows links, so a `.cache`, install root or `bin/` linked to ~/.cargo would install over the
 * user's own binaries (TEST-1.3). A part that doesn't exist yet is fine.
 */
export function pathProblems(path: string, repoRoot = REPO_ROOT): string[] {
  const rel = relative(repoRoot, path);
  if (rel === '' || rel.startsWith('..') || rel.startsWith(sep)) return [`${path} is not inside the repo (${repoRoot})`];
  let base: string;
  try {
    base = realpathSync(repoRoot);
  } catch {
    return [`the repo root ${repoRoot} doesn't exist`];
  }
  let at = repoRoot;
  for (const part of rel.split(sep)) {
    at = join(at, part);
    let info;
    try {
      info = lstatSync(at);
    } catch {
      return []; // not there yet: created as a plain directory when needed
    }
    if (info.isSymbolicLink()) return [`${at} is a symlink; it must be a plain directory inside the repo`];
    if (!info.isDirectory()) return [`${at} is not a directory`];
    const real = realpathSync(at);
    if (real !== base && !real.startsWith(base + sep)) return [`${at} resolves to ${real}, outside the repo`];
  }
  return [];
}

/** Creates `path` (a directory inside the repo) part by part, refusing anything `pathProblems` names. */
export function assertInsideRepo(path: string, opts: { create?: boolean; repoRoot?: string } = {}): void {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const problems = pathProblems(path, repoRoot);
  if (problems.length) throw new Error(problems.join('\n'));
  if (!opts.create) return;
  let at = repoRoot;
  for (const part of relative(repoRoot, path).split(sep)) {
    at = join(at, part);
    if (!existsSync(at)) mkdirSync(at);
  }
  const after = pathProblems(path, repoRoot);
  if (after.length) throw new Error(after.join('\n'));
}

/** The pin's install root, `bin/` and binary are the repo's own: no symlinks, nothing outside it. */
export function layoutProblems(pin: Pin, cache = CACHE_DIR, repoRoot = REPO_ROOT): string[] {
  const problems = pathProblems(join(installRoot(pin, cache), 'bin'), repoRoot);
  if (problems.length) return problems;
  const bin = pinnedBin(pin, cache);
  try {
    if (lstatSync(bin).isSymbolicLink()) return [`${bin} is a symlink; it must be the binary cargo installed`];
  } catch {
    // not installed yet
  }
  return [];
}

/**
 * The binary is there, cargo recorded it as built from the pinned commit (`.crates2.json` in the
 * install root), and its `--version` matches when the pin names one.
 */
export function checkPin(pin: Pin, cache = CACHE_DIR, repoRoot = REPO_ROOT): PinCheck {
  const bin = pinnedBin(pin, cache);
  const short = pin.rev.slice(0, 7);
  const fail = (why: string): PinCheck => ({
    ok: false,
    problem: `${pin.package}: ${why}. The pin expects ${pin.package} from ${pin.repo} at ${short}${
      pin.version ? ` (${pin.version})` : ''
    }, in ${installRoot(pin, cache)}. Run \`${SETUP_COMMAND}\` to get it.`,
  });
  const layout = layoutProblems(pin, cache, repoRoot);
  if (layout.length) return { ok: false, problem: `${pin.package}: ${layout.join('; ')}. Remove it and run \`${SETUP_COMMAND}\`.` };
  if (!existsSync(bin)) return fail(`not installed (${bin} is missing)`);
  // e.g. `fleet 0.4.0 (git+https://github.com/dafilipaj/fleet?rev=ce2bbe1…#ce2bbe152c…)`; the
  // server reads it the same way for Settings › Tools (TOOLS-2.2).
  const record = readCargoRecord(installRoot(pin, cache), pin.package);
  if (record.state === 'no-record') return fail('cargo left no install record (.crates2.json)');
  if (record.state === 'not-installed') return fail('cargo recorded no install of it');
  const built = record.revision;
  if (!built || !(built.startsWith(pin.rev) || pin.rev.startsWith(built))) {
    return fail(`built from ${built?.slice(0, 7) ?? 'an unknown revision'}, not the pinned ${short}`);
  }
  let version: string;
  try {
    version = scratchVersion(bin, cache, repoRoot);
  } catch (err) {
    return fail(`\`${pin.bin} --version\` failed: ${(err as Error).message.split('\n')[0]}`);
  }
  if (pin.version && !version.includes(pin.version)) return fail(`--version says "${version}", not ${pin.version}`);
  return { ok: true, bin, version };
}

/**
 * `<bin> --version`, run where it can't reach the user's machine: a HOME of its own inside `.cache/`
 * (tb-session caches what it looked up under `~/Library/Caches`), a PATH holding nothing (it may run
 * `gh` to look for a newer release), and that HOME as its working directory. The HOME is removed
 * afterwards.
 */
function scratchVersion(bin: string, cache: string, repoRoot: string): string {
  assertInsideRepo(cache, { create: true, repoRoot });
  const home = mkdtempSync(join(cache, 'pin-check-'));
  try {
    const empty = join(home, 'bin');
    mkdirSync(empty);
    const env = { HOME: home, PATH: empty, TMPDIR: home, LANG: 'C', NO_COLOR: '1' };
    return execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000, cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** Both pins, or every problem at once. */
export function checkPins(cache = CACHE_DIR, repoRoot = REPO_ROOT): { ok: true; bins: Record<PinName, string> } | { ok: false; problems: string[] } {
  const pins = loadPins();
  const fleet = checkPin(pins.fleet, cache, repoRoot);
  const tbSession = checkPin(pins.tbSession, cache, repoRoot);
  if (fleet.ok && tbSession.ok) return { ok: true, bins: { fleet: fleet.bin, tbSession: tbSession.bin } };
  return { ok: false, problems: [fleet, tbSession].flatMap((c) => (c.ok ? [] : [c.problem])) };
}
