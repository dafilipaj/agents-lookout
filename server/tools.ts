import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path';
import {
  FLEET_VERSION_LINE,
  TOOLS,
  TOOL_IDS,
  type TbLatest,
  type ToolId,
  type ToolRow,
  type ToolsSnapshot,
  compareVersions,
  parseTbLatest,
  semver,
} from '../shared/tools.ts';
import type { JevStatus } from '../shared/usage.ts';
import { readCargoRecord } from './cargo-record.ts';
import type { RunError, Runner } from './exec.ts';
import { resolveFleetBin } from './fleet.ts';
import { resolveTbSessionBin } from './history.ts';
import { type HarnessFact, cleanEnv } from './launcher.ts';
import { sanitizeLine } from './sanitize.ts';
import { resolveJevBin } from './usage.ts';
import { resolveWorkBin } from './work.ts';

/**
 * TOOLS: every CLI Lookout runs, where it was found, its version, and whether it's missing, behind,
 * has an update out or is newer than Fleet knows. Lookout shows and explains; it never installs
 * or updates anything (TOOLS-3.4): the only commands it runs here are `--version` (and `tmux -V`).
 */

/** TOOLS-1.4: the start's read and a page opening read at most this often; so does the GitHub release check, Refresh included. */
export const TOOLS_READ_MIN_MS = 60_000;
/** TOOLS-1.3: each version read. */
export const TOOL_TIMEOUT_MS = 5000;
const MAX_VERSION = 60;
/** Bounds what's read of a Tool's own record before it's parsed (TOOLS-3). */
const MAX_FILE_BYTES = 64 * 1024;

type Located = Exclude<ToolId, 'claude' | 'codex'>;

/** Where a Tool was found: its path, and the environment variable that named it, if one did (TOOLS-1.2). */
export interface Found {
  path: string;
  via: string | null;
}
/** Found, or where it was looked for. */
export type Lookup = { found: Found } | { found: null; reason: string };

const ENV_VAR: Partial<Record<Located, string>> = {
  fleet: 'LOOKOUT_FLEET_BIN',
  'tb-session': 'LOOKOUT_TB_SESSION_BIN',
  'tb-pr': 'LOOKOUT_TB_PR_BIN',
  'tb-prod': 'LOOKOUT_TB_PROD_BIN',
};
const LOOKED_IN: Record<Located, string> = {
  fleet: 'on PATH or in ~/.cargo/bin',
  'tb-session': 'on PATH or in ~/.local/bin',
  'tb-pr': 'on PATH or in ~/.local/bin',
  'tb-prod': 'on PATH or in ~/.local/bin',
  'tb-jev': 'on PATH or in ~/.local/bin',
  git: 'on PATH',
  tmux: 'on PATH, in /opt/homebrew/bin or in /usr/local/bin',
};
/** tmux as the World finds it: PATH, then Homebrew's directories. */
const TMUX_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];

function executable(path: string): boolean {
  if (!isAbsolute(path)) return false;
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The first executable `name` on PATH, then in `extra`. */
export function onPath(name: string, env: NodeJS.ProcessEnv, extra: readonly string[] = []): string | null {
  for (const dir of [...(env.PATH ?? '').split(delimiter).filter(Boolean), ...extra]) {
    const candidate = join(dir, name);
    if (executable(candidate)) return candidate;
  }
  return null;
}

/** The home directory as `~` (TOOLS-1.2). */
export function tildify(path: string, home: string): string {
  if (!home || home === '/') return path;
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/**
 * TOOLS-1.2: each Tool exactly where the code that runs it looks: the same resolvers, so a Tool
 * this finds is the one Lookout runs. A Harness is Fleet's to find (`harnessRow`).
 */
export function findTool(id: Located, env: NodeJS.ProcessEnv, tmuxDirs: readonly string[] = TMUX_DIRS): Lookup {
  const variable = ENV_VAR[id];
  const named = variable && env[variable] ? variable : null;
  const bin =
    id === 'fleet' ? resolveFleetBin(env)
    : id === 'tb-session' ? resolveTbSessionBin(env)
    : id === 'tb-pr' || id === 'tb-prod' ? resolveWorkBin(id, env)
    : id === 'tb-jev' ? resolveJevBin(env)
    : id === 'git' ? onPath('git', env)
    : onPath('tmux', env, tmuxDirs);
  if (bin && executable(bin)) return { found: { path: bin, via: named } };
  const home = env.HOME || homedir();
  return {
    found: null,
    reason: named ? `${named} names ${tildify(String(env[named]), home)}, which isn't there.` : `Not found ${LOOKED_IN[id]}.`,
  };
}

/** What a version read gave: its first line, raw (bounded), or why there's none. */
export type VersionRead = { line: string } | { error: string };

/** TOOLS-1.3: argv only, LAUNCH's cleaned environment, 5 s. Never throws. */
export async function readVersion(runner: Runner, id: ToolId, path: string, argv: readonly string[], env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<VersionRead> {
  const what = `${id} ${argv.join(' ')}`;
  try {
    const out = await runner(path, argv, { timeoutMs: TOOL_TIMEOUT_MS, env, signal });
    const line = out.split(/\r?\n/).find((l) => l.trim() !== '')?.trim().slice(0, 200);
    return line ? { line } : { error: `${what} printed nothing.` };
  } catch (err) {
    const e = err as RunError;
    if (e.aborted) return { error: 'The read was cancelled.' };
    if (e.timedOut) return { error: `${what} took longer than ${TOOL_TIMEOUT_MS / 1000} s.` };
    if (e.code === 'ENOENT') return { error: `${what} couldn't be run.` };
    const exit = typeof e.code === 'number' ? ` (exit ${e.code})` : '';
    return { error: `${what} failed${exit}: ${sanitizeLine(e.stderr, 120) ?? 'no details'}` };
  }
}

/** A newer release, or an update waiting: the row's `update-available` (TOOLS-3). */
export interface Update {
  reason: string;
  fix: string | null;
}

/** "3 h ago", for when a Tool's own check ran (TOOLS-3.2, TOOLS-3.3). */
export function ago(at: number | null, now: number): string {
  if (at === null) return "at a time Lookout can't read";
  const minutes = Math.round(Math.max(0, now - at) / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const sentence = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
const PLAIN_VERSION = /^\d{1,9}\.\d{1,9}\.\d{1,9}$/;
const time = (v: unknown): number | null => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};
const version = (v: unknown): string | null => (typeof v === 'string' && PLAIN_VERSION.test(v) ? v : null);
const object = (text: string | null): Record<string, unknown> | null => {
  if (text === null) return null;
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** `~/.codex/version.json`, written by Codex's own check (TOOLS-3.2): its allowlisted fields, or null. */
export interface CodexVersionFile {
  latest: string;
  checkedAt: number | null;
  dismissed: string | null;
}
export function parseCodexVersionFile(text: string | null): CodexVersionFile | null {
  const j = object(text);
  const latest = version(j?.latest_version);
  return j && latest ? { latest, checkedAt: time(j.last_checked_at), dismissed: version(j.dismissed_version) } : null;
}

export function codexUpdate(file: CodexVersionFile | null, installed: string | null, now: number): Update | null {
  if (!file || (compareVersions(file.latest, installed) ?? 0) <= 0) return null;
  const dismissed = file.dismissed === file.latest ? '; dismissed there' : '';
  return { reason: `${file.latest} is out (Codex checked ${ago(file.checkedAt, now)}${dismissed}).`, fix: TOOLS.codex.fix };
}

/** `~/.claude/.last-update-result.json`, what Claude Code's auto-updater last did (TOOLS-3.3). */
export interface ClaudeUpdateFile {
  at: number | null;
  /** `success`, or how it failed (`install_failed`). */
  outcome: string;
  from: string | null;
  to: string | null;
}
export function parseClaudeUpdateFile(text: string | null): ClaudeUpdateFile | null {
  const j = object(text);
  if (!j || typeof j.outcome !== 'string' || !/^[a-z_]{1,40}$/.test(j.outcome)) return null;
  return { at: time(j.timestamp), outcome: j.outcome, from: version(j.version_from), to: version(j.version_to) };
}

export function claudeUpdate(file: ClaudeUpdateFile | null, installed: string | null, now: number): Update | null {
  if (!file) return null;
  if (file.outcome !== 'success') {
    // Updated by hand since: the failure is history.
    if (file.from && installed && (compareVersions(installed, file.from) ?? 0) > 0) return null;
    return { reason: `Auto-update failed ${ago(file.at, now)}${file.from ? ` (from ${file.from})` : ''}.`, fix: TOOLS.claude.fix };
  }
  if (file.to && (compareVersions(file.to, installed) ?? 0) > 0) {
    return { reason: `${file.to} was installed ${ago(file.at, now)} and waits for a restart.`, fix: null };
  }
  return null;
}

/** `~/Library/Caches/<tool>/version-check.json`, cli-toolbox's own 24 h cache (TOOLS-3.1). */
export interface TbCacheFile {
  latest: string;
  checkedAt: number | null;
}
export function parseTbCacheFile(text: string | null): TbCacheFile | null {
  const j = object(text);
  const latest = version(j?.latest_version);
  return j && latest ? { latest, checkedAt: time(j.checked_at) } : null;
}

function blank(id: ToolId, checkedAt: number | null, pin: string | null): ToolRow {
  return {
    id,
    purpose: TOOLS[id].purpose,
    path: null,
    via: null,
    version: null,
    number: null,
    revision: null,
    pin: id === 'fleet' ? pin : null,
    needs: TOOLS[id].needs.map((n) => ({ ...n })),
    state: 'unknown',
    reason: checkedAt === null ? 'Checking…' : '',
    fix: null,
    checkedAt,
  };
}

/** Before the first read lands: every Tool, "checking…" (UX, Loading). */
export function placeholderRows(pin: string | null): ToolRow[] {
  return TOOL_IDS.map((id) => blank(id, null, pin));
}

function located(row: ToolRow, lookup: Lookup, home: string): ToolRow {
  return lookup.found ? { ...row, path: tildify(lookup.found.path, home), via: lookup.found.via } : row;
}

function missing(row: ToolRow, reason: string, fix: string | null): ToolRow {
  return { ...row, state: 'missing', reason, fix };
}

/** The first line as the row shows it, and the number read from it (TOOLS-1.3). */
function versioned(row: ToolRow, line: string): ToolRow {
  const parsed = TOOLS[row.id].parse(line);
  return { ...row, version: sanitizeLine(line, MAX_VERSION), number: parsed === null ? null : sanitizeLine(parsed, 40) };
}

/**
 * TOOLS-2.1, TOOLS-4.1: one comparison against two numbers of the table. Below a need is
 * `behind`, naming each feature that doesn't work; an update out is `update-available`; a Harness
 * past what Fleet was checked against is `newer-than-known`. A version that can't be read or
 * compared is `unknown`. `ok`: the reason for an `ok` row; `also`: said after any state's reason
 * (tb's "Install gh to check for updates.", TOOLS-3.1).
 */
export function judge(row: ToolRow, opts: { update?: Update | null; ok?: string | null; also?: string | null } = {}): ToolRow {
  const def = TOOLS[row.id];
  const note = opts.also ? ` ${opts.also}` : '';
  if (row.number === null) {
    return { ...row, state: 'unknown', reason: `${row.version ? `Lookout can't read a version in "${row.version}".` : 'Version unknown.'}${note}` };
  }
  const compares = def.needs.length > 0 || def.checkedUpTo !== null || !!opts.update;
  if (compares && semver(row.number) === null) {
    return { ...row, state: 'unknown', reason: `${row.number} isn't a version Lookout can compare.${note}` };
  }
  const unmet = def.needs.filter((n) => (compareVersions(row.number, n.version) ?? 0) < 0);
  if (unmet.length) {
    return { ...row, state: 'behind', reason: `${sentence(unmet.map((n) => `${n.feature} needs ${n.version}`).join('; '))}.${note}`, fix: def.fix };
  }
  if (opts.update) return { ...row, state: 'update-available', reason: `${opts.update.reason}${note}`, fix: opts.update.fix };
  if (def.checkedUpTo && (compareVersions(row.number, def.checkedUpTo) ?? 0) > 0) {
    return {
      ...row,
      state: 'newer-than-known',
      reason: `Fleet's model and Effort lists and its prompt reading were checked up to ${def.checkedUpTo}; re-check them.${note}`,
      fix: null,
    };
  }
  const ok = opts.ok ?? opts.also ?? (def.needs.length ? 'New enough for everything Lookout does.' : 'Any version works.');
  return { ...row, state: 'ok', reason: ok };
}

interface RowInput {
  lookup: Lookup;
  read: VersionRead | null;
  home: string;
  checkedAt: number;
  /** TOOLS-1.4: tb's last answer about newer releases, used while `gh` is kept from the read. */
  latest?: TbLatest;
}

/** TOOLS-1.4: `env` with every PATH directory that holds `gh` left out, so a tb `--version` can't call GitHub. */
export function withoutGh(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const dirs = (env.PATH ?? '').split(delimiter).filter((d) => d && !executable(join(d, 'gh')));
  return { ...env, PATH: dirs.join(delimiter) };
}

/**
 * TOOLS-2.2: Fleet is judged by revision against Lookout's pin, never by version (every build
 * prints `fleet 0.1.0`). The revision comes from `fleet --version` once it prints one (contract
 * F1), else from cargo's install record (`cargoRevision`); one that can't be read is `unknown`.
 */
export function fleetRow(input: RowInput & { cargoRevision: string | null; pin: string }): ToolRow {
  const pin = input.pin.slice(0, 7);
  const fix = TOOLS.fleet.fix;
  const row = located(blank('fleet', input.checkedAt, pin), input.lookup, input.home);
  if (!input.lookup.found) return missing(row, input.lookup.reason, fix);
  if (!input.read) return { ...row, reason: 'Revision unknown.', fix };
  if ('error' in input.read) return { ...row, reason: input.read.error, fix };
  const withVersion = versioned(row, input.read.line);
  const m = FLEET_VERSION_LINE.exec(input.read.line);
  if (!m) return { ...withVersion, reason: `Lookout can't read a version in "${withVersion.version}".`, fix };
  const revision = (m[2] ?? input.cargoRevision)?.slice(0, 7) ?? null;
  if (!revision) return { ...withVersion, reason: 'Revision unknown: this build names none, and cargo left no record of it.', fix };
  if (revision === pin) return { ...withVersion, revision, state: 'ok', reason: `Built from the pinned revision ${pin}.` };
  return { ...withVersion, revision, state: 'behind', reason: `Built from ${revision}; Lookout is tested against ${pin}.`, fix };
}

/**
 * TOOLS-1.2, TOOLS-1.3: a Harness as Fleet's `harness list` found it, with the path and version
 * Fleet read through its login-shell lookup (contract F2). A Fleet without those fields gives
 * `unknown`. Its update comes from the Harness's own record (TOOLS-3.2, TOOLS-3.3).
 */
export function harnessRow(
  id: 'claude' | 'codex',
  input: { fleet: boolean; facts: HarnessFact[] | { error: string } | null; update: (installed: string | null) => Update | null; home: string; checkedAt: number },
): ToolRow {
  const row = blank(id, input.checkedAt, null);
  if (!input.fleet || input.facts === null) return { ...row, reason: "Fleet finds it, and Fleet isn't installed." };
  if ('error' in input.facts) return { ...row, reason: `Fleet couldn't list the Harnesses: ${input.facts.error}` };
  const fact = input.facts.find((f) => f.id === id);
  if (!fact?.installed) return missing(row, "Fleet doesn't find it.", null);
  const found = { ...row, path: fact.path ? tildify(fact.path, input.home) : null, via: 'Fleet' };
  if (!fact.version) return { ...found, reason: 'Found by Fleet; version unreadable.' };
  const withVersion = versioned(found, fact.version);
  return judge(withVersion, { update: input.update(withVersion.number) });
}

/**
 * TOOLS-3.1: tb-session, tb-pr and tb-prod say their latest release in `--version`. `(latest)` and
 * `(install gh to check for updates)` leave the state as it is, the latter in the reason.
 */
export function tbRow(id: 'tb-session' | 'tb-pr' | 'tb-prod', input: RowInput): ToolRow {
  const def = TOOLS[id];
  const row = located(blank(id, input.checkedAt, null), input.lookup, input.home);
  if (!input.lookup.found) return missing(row, input.lookup.reason, def.fix);
  if (!input.read || 'error' in input.read) return { ...row, reason: input.read?.error ?? 'Version unknown.' };
  const withVersion = versioned(row, input.read.line);
  const latest = input.latest ?? parseTbLatest(id, input.read.line);
  const update = latest.kind === 'newer' && (compareVersions(latest.version, withVersion.number) ?? 0) > 0 ? { reason: `${latest.version} is out.`, fix: def.fix } : null;
  // `(latest)` only says so on an `ok` row: a release still below a need is no comfort.
  return judge(withVersion, { update, ok: latest.kind === 'latest' ? 'The latest release.' : null, also: latest.kind === 'no-gh' ? 'Install gh to check for updates.' : null });
}

/**
 * TOOLS-1.3: tb-jev's version from `status --json`, read by USAGE (never `--version`); its latest
 * from cli-toolbox's cache file alone (TOOLS-3.1). One too old for `status` is `behind`.
 */
export function jevRow(input: { lookup: Lookup; jev: JevStatus | null; cache: TbCacheFile | null; home: string; now: number; checkedAt: number }): ToolRow {
  const def = TOOLS['tb-jev'];
  const row = located(blank('tb-jev', input.checkedAt, null), input.lookup, input.home);
  if (!input.lookup.found || input.jev?.state === 'not-installed') return missing(row, input.lookup.found ? 'It went away while Lookout read it.' : input.lookup.reason, def.fix);
  const jev = input.jev;
  if (!jev) return { ...row, reason: 'Version unknown.' };
  if (jev.state === 'unavailable') {
    const need = def.needs[0]!;
    return { ...row, state: 'behind', reason: `${sentence(need.feature)} needs ${need.version}; this tb-jev has no status.`, fix: def.fix };
  }
  if (jev.state === 'error' || !jev.version) return { ...row, reason: jev.reason ? `tb-jev status: ${jev.reason}.` : 'Version unknown.' };
  const withVersion = versioned(row, jev.version);
  const cache = input.cache;
  const update = cache && (compareVersions(cache.latest, withVersion.number) ?? 0) > 0 ? { reason: `${cache.latest} is out (checked ${ago(cache.checkedAt, input.now)}).`, fix: def.fix } : null;
  return judge(withVersion, { update });
}

/** git and tmux: any version works; tmux's `3.6a` is text, never compared. */
export function plainRow(id: 'git' | 'tmux', input: RowInput): ToolRow {
  const row = located(blank(id, input.checkedAt, null), input.lookup, input.home);
  if (!input.lookup.found) return missing(row, input.lookup.reason, null);
  if (!input.read || 'error' in input.read) return { ...row, reason: input.read?.error ?? 'Version unknown.' };
  return judge(versioned(row, input.read.line));
}

/** cargo's record of the binary at `path`: `<root>/bin/fleet` → `<root>/.crates2.json`, the link's target too. */
export function cargoRevisionFor(path: string, pkg = 'fleet'): string | null {
  const candidates = [path];
  try {
    const real = realpathSync(path);
    if (real !== path) candidates.push(real);
  } catch {
    // gone: only the path itself
  }
  for (const p of candidates) {
    if (basename(dirname(p)) !== 'bin') continue;
    const record = readCargoRecord(dirname(dirname(p)), pkg);
    if (record.state === 'installed' && record.revision) return record.revision;
  }
  return null;
}

/** Lookout's pin (`e2e/pins.json`'s `fleet.rev`, TOOLS-2.2), or null when it can't be read. */
export function loadFleetPin(path = new URL('../e2e/pins.json', import.meta.url)): string | null {
  try {
    const rev = (JSON.parse(readFileSync(path, 'utf8')) as { fleet?: { rev?: unknown } }).fleet?.rev;
    return typeof rev === 'string' && /^[0-9a-f]{7,40}$/.test(rev) ? rev : null;
  } catch {
    return null;
  }
}

/** `dirs::cache_dir()`, where cli-toolbox keeps its version check. */
export function defaultCacheDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
  const home = env.HOME || homedir();
  return platform === 'darwin' ? join(home, 'Library', 'Caches') : env.XDG_CACHE_HOME || join(home, '.cache');
}

/** A Tool's own record: read whole when small, else ignored; never an error (Technical approach, "Latest versions"). */
async function readSmall(path: string): Promise<string | null> {
  try {
    if ((await stat(path)).size > MAX_FILE_BYTES) return null;
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export interface ToolsMonitorOptions {
  runner: Runner;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** LAUNCH's cached `fleet harness list --json`, with each Harness's path and version (contract F2). */
  harnesses(force?: boolean): Promise<HarnessFact[]>;
  /** USAGE's last `tb-jev status --json`, or the read it makes anyway; tb-jev is never run here. */
  jev(): Promise<JevStatus>;
  onChange(tools: ToolsSnapshot): void;
  /** Lookout's Fleet pin; `e2e/pins.json`'s when unset. */
  pin?: string | null;
  /** Where cli-toolbox caches its version check; `dirs::cache_dir()` when unset. */
  cacheDir?: string;
  /** Where tmux is looked for after PATH; Homebrew's directories when unset. */
  tmuxDirs?: readonly string[];
}

/**
 * TOOLS-1.4: shaped like `UsageMonitor`: one read at a time, shared by every caller, on start and
 * when the Settings page opens, at most once a minute, and never on a timer. Refresh reads now
 * (joining a read in flight). `close()` cancels the read and waits for it.
 */
export class ToolsMonitor {
  private current: ToolsSnapshot;
  private flight: Promise<ToolsSnapshot> | null = null;
  private lastStart = -Infinity;
  /** TOOLS-1.4: when tb's `--version` last ran with `gh` (its release check), and what it said. */
  private lastGh = -Infinity;
  private readonly latest = new Map<ToolId, TbLatest>();
  private readonly abort = new AbortController();
  private readonly opts: ToolsMonitorOptions;
  private readonly now: () => number;
  private readonly pin: string | null;

  constructor(opts: ToolsMonitorOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.pin = opts.pin === undefined ? loadFleetPin() : opts.pin;
    this.current = { rows: placeholderRows(this.pin?.slice(0, 7) ?? null), checkedAt: null, reading: false };
  }

  snapshot(): ToolsSnapshot {
    return this.current;
  }

  /** TOOLS-2.5: the version number the last read found, for a section that says its Tool is too old; null when unknown. */
  version(id: ToolId): string | null {
    const row = this.current.rows.find((r) => r.id === id);
    return row && row.checkedAt !== null ? row.number : null;
  }

  /** TOOLS-1.4: the server's first read. */
  start(): Promise<ToolsSnapshot> {
    return this.read();
  }

  /**
   * A read when the last one began a minute ago or more, or `force`d (Refresh); one in flight is
   * joined. Every read re-reads the installed versions; the GitHub release check runs at most once a minute.
   */
  read(opts: { force?: boolean } = {}): Promise<ToolsSnapshot> {
    if (this.flight) return this.flight;
    if (this.abort.signal.aborted || (!opts.force && this.now() - this.lastStart < TOOLS_READ_MIN_MS)) return Promise.resolve(this.current);
    this.lastStart = this.now();
    this.publish({ ...this.current, reading: true });
    const flight = this.gather(opts.force === true)
      .then((rows) => {
        if (!this.abort.signal.aborted) this.publish({ rows, checkedAt: this.now(), reading: false });
        return this.current;
      })
      .catch(() => {
        this.publish({ ...this.current, reading: false });
        return this.current;
      })
      .finally(() => {
        if (this.flight === flight) this.flight = null;
      });
    this.flight = flight;
    return flight;
  }

  /** Cancels the read in flight (its processes too) and resolves once it has ended. */
  async close(): Promise<void> {
    this.abort.abort();
    await this.flight?.catch(() => {});
  }

  private publish(next: ToolsSnapshot): void {
    const same = JSON.stringify(next) === JSON.stringify(this.current);
    this.current = next;
    if (!same) this.opts.onChange(next);
  }

  private async gather(force: boolean): Promise<ToolRow[]> {
    const env = this.opts.env ?? process.env;
    const home = env.HOME || homedir();
    const clean = cleanEnv(env);
    const signal = this.abort.signal;
    const checkedAt = this.now();
    const lookups = Object.fromEntries((TOOL_IDS.filter((id) => id !== 'claude' && id !== 'codex') as Located[]).map((id) => [id, findTool(id, env, this.opts.tmuxDirs)])) as Record<Located, Lookup>;
    // TOOLS-1.4: every read re-reads the installed versions, but tb's `--version` calls `gh` for the
    // latest release; within a minute of the last such call it runs without `gh` and the last answer stands.
    const withinMinute = this.now() - this.lastGh < TOOLS_READ_MIN_MS;
    // Reuse only an answer there is; a Tool first seen within the minute asks GitHub once.
    const reuse = (id: Located) => withinMinute && this.latest.has(id);
    if (!withinMinute) this.lastGh = this.now();
    const read = (id: Located): Promise<VersionRead | null> => {
      const lookup = lookups[id];
      const argv = TOOLS[id].versionArgv;
      const env = reuse(id) ? withoutGh(clean) : clean;
      return lookup.found && argv ? readVersion(this.opts.runner, id, lookup.found.path, argv, env, signal) : Promise.resolve(null);
    };
    const latestOf = (id: 'tb-session' | 'tb-pr' | 'tb-prod', r: VersionRead | null): TbLatest | undefined => {
      if (!r || 'error' in r) return undefined;
      if (reuse(id)) return this.latest.get(id);
      this.latest.set(id, parseTbLatest(id, r.line));
      return undefined;
    };
    const fleet = !!lookups.fleet.found;
    const [fleetRead, sessionRead, prRead, prodRead, gitRead, tmuxRead, facts, jev, codexFile, claudeFile, jevCache] = await Promise.all([
      read('fleet'),
      read('tb-session'),
      read('tb-pr'),
      read('tb-prod'),
      read('git'),
      read('tmux'),
      fleet ? this.opts.harnesses(force).catch((err: unknown) => ({ error: sanitizeLine(err instanceof Error ? err.message : String(err), 160) ?? 'unknown error' })) : Promise.resolve(null),
      lookups['tb-jev'].found ? this.opts.jev().catch(() => null) : Promise.resolve(null),
      readSmall(join(env.CODEX_HOME || join(home, '.codex'), 'version.json')),
      readSmall(join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), '.last-update-result.json')),
      readSmall(join(this.opts.cacheDir ?? defaultCacheDir(env), 'tb-jev', 'version-check.json')),
    ]);
    const now = this.now();
    const base = { home, checkedAt };
    const codex = parseCodexVersionFile(codexFile);
    const claude = parseClaudeUpdateFile(claudeFile);
    const fleetFound = lookups.fleet.found;
    const rows: Record<ToolId, ToolRow> = {
      fleet: fleetRow({
        ...base,
        lookup: lookups.fleet,
        read: fleetRead,
        pin: this.pin ?? '',
        cargoRevision: fleetFound && fleetRead && 'line' in fleetRead && !FLEET_VERSION_LINE.exec(fleetRead.line)?.[2] ? cargoRevisionFor(fleetFound.path) : null,
      }),
      claude: harnessRow('claude', { ...base, fleet, facts, update: (installed) => claudeUpdate(claude, installed, now) }),
      codex: harnessRow('codex', { ...base, fleet, facts, update: (installed) => codexUpdate(codex, installed, now) }),
      'tb-session': tbRow('tb-session', { ...base, lookup: lookups['tb-session'], read: sessionRead, latest: latestOf('tb-session', sessionRead) }),
      'tb-pr': tbRow('tb-pr', { ...base, lookup: lookups['tb-pr'], read: prRead, latest: latestOf('tb-pr', prRead) }),
      'tb-prod': tbRow('tb-prod', { ...base, lookup: lookups['tb-prod'], read: prodRead, latest: latestOf('tb-prod', prodRead) }),
      'tb-jev': jevRow({ ...base, lookup: lookups['tb-jev'], jev, cache: parseTbCacheFile(jevCache), now }),
      git: plainRow('git', { ...base, lookup: lookups.git, read: gitRead }),
      tmux: plainRow('tmux', { ...base, lookup: lookups.tmux, read: tmuxRead }),
    };
    if (!this.pin) rows.fleet = { ...rows.fleet, state: rows.fleet.state === 'missing' ? 'missing' : 'unknown', reason: rows.fleet.state === 'missing' ? rows.fleet.reason : "Lookout's pin (e2e/pins.json) can't be read." };
    return TOOL_IDS.map((id) => rows[id]);
  }
}
