import {
  CLAUDE_UPDATE_COMMAND,
  CODEX_UPDATE_COMMAND,
  FLEET_INSTALL_COMMAND,
  TB_JEV_INSTALL_COMMAND,
  TB_PR_INSTALL_COMMAND,
  TB_PROD_INSTALL_COMMAND,
  TB_SESSION_INSTALL_COMMAND,
} from './defaults.ts';

/**
 * TOOLS: the CLIs Lookout runs, what each is for, and what Lookout needs of it. One table
 * (TOOLS-2.1), read by Settings › Tools and by every section that says its Tool is too old
 * (TOOLS-2.5), so a needed version is written down once.
 */

/** TOOLS-1.1: every Tool, in the order Settings › Tools lists them. */
export const TOOL_IDS = ['fleet', 'claude', 'codex', 'tb-session', 'tb-pr', 'tb-prod', 'tb-jev', 'git', 'tmux'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export const TOOL_STATES = ['ok', 'missing', 'behind', 'update-available', 'newer-than-known', 'unknown'] as const;
export type ToolState = (typeof TOOL_STATES)[number];

/** One feature's need of a Tool (TOOLS-2.1): the lowest version it works with, and why. */
export interface ToolNeed {
  /** The feature, as a sentence names it: "the Library", "Work". */
  feature: string;
  version: string;
  why: string;
}

export interface ToolDefinition {
  id: ToolId;
  /** What Lookout runs it for, one short sentence. */
  purpose: string;
  /** TOOLS-2.1: empty when any version works (git, tmux) or when a pin judges it instead (Fleet, TOOLS-2.2). */
  needs: readonly ToolNeed[];
  /**
   * TOOLS-4.1, a Harness only: the version Fleet's model and Effort tables and its screen fixtures
   * were last checked against. Moves with each Fleet pin bump, in the same change.
   */
  checkedUpTo: string | null;
  /**
   * TOOLS-1.3: what Lookout runs to read the version; null where it comes from elsewhere: Fleet's
   * `harness list` for a Harness, `tb-jev status --json` for tb-jev, which is never run with `--version`.
   */
  versionArgv: readonly string[] | null;
  /** The version number in its first line, or null for a line Lookout can't read. The rest of the line stays text. */
  parse(line: string): string | null;
  /** TOOLS-2.1: the command that installs or updates it, from `shared/defaults.ts`; null when Lookout knows none. */
  fix: string | null;
}

const match = (re: RegExp) => (line: string) => re.exec(line.trim())?.[1] ?? null;

/** `fleet 0.1.0`, or with the fork commit that adds it, `fleet 0.1.0 (5e2afd8)` (docs/contracts/fleet-tools.md, F1). */
export const FLEET_VERSION_LINE = /^fleet (\S+)(?: \(([0-9a-f]{7,40})\))?$/;
/** cli-toolbox's `format_version_line`: `tb-pr 0.3.1`, then `(latest)`, `(latest: X — upgrade available)` or `(install gh to check for updates)`. */
const tbLine = (id: string) => new RegExp(`^${id} (\\S+)(?: \\((.*)\\))?$`);

export const TOOLS: Readonly<Record<ToolId, ToolDefinition>> = {
  fleet: {
    id: 'fleet',
    purpose: 'Lookout finds, starts and steers every Session through it',
    needs: [],
    checkedUpTo: null,
    versionArgv: ['--version'],
    parse: match(FLEET_VERSION_LINE),
    fix: FLEET_INSTALL_COMMAND,
  },
  claude: {
    id: 'claude',
    purpose: 'Claude Code, a Harness Sessions run in',
    needs: [{ feature: "the sidebar's Subagent count", version: '2.1.301', why: 'Subagent sidecars (SIDE-9)' }],
    checkedUpTo: '2.1.312',
    versionArgv: null,
    // `2.1.314 (Claude Code)`
    parse: match(/^(\d\S*) \(Claude Code\)$/),
    fix: CLAUDE_UPDATE_COMMAND,
  },
  codex: {
    id: 'codex',
    purpose: 'Codex, a Harness Sessions run in',
    needs: [{ feature: 'Fleet', version: '0.163.0', why: "Fleet's `request_user_input` and rollout reading" }],
    checkedUpTo: '0.163.0',
    versionArgv: null,
    // `codex-cli 0.164.0`
    parse: match(/^codex-cli (\S+)$/),
    fix: CODEX_UPDATE_COMMAND,
  },
  'tb-session': {
    id: 'tb-session',
    purpose: 'History and the Library read past Sessions through it',
    needs: [
      { feature: 'History', version: '0.3.0', why: "HIST's Harness and Headless filters; 0.2 still lists" },
      { feature: 'the Library', version: '0.4.0', why: '`events` (LIB-2.1)' },
    ],
    checkedUpTo: null,
    versionArgv: ['--version'],
    parse: match(tbLine('tb-session')),
    fix: TB_SESSION_INSTALL_COMMAND,
  },
  'tb-pr': {
    id: 'tb-pr',
    purpose: 'Work reads PRs through it',
    needs: [{ feature: 'Work', version: '0.3.1', why: '`column_issues` (WORK-3)' }],
    checkedUpTo: null,
    versionArgv: ['--version'],
    parse: match(tbLine('tb-pr')),
    fix: TB_PR_INSTALL_COMMAND,
  },
  'tb-prod': {
    id: 'tb-prod',
    purpose: 'Work reads Tasks through it',
    needs: [{ feature: 'Work', version: '1.2.0', why: '`folder_status` (WORK-7.8)' }],
    checkedUpTo: null,
    versionArgv: ['--version'],
    parse: match(tbLine('tb-prod')),
    fix: TB_PROD_INSTALL_COMMAND,
  },
  'tb-jev': {
    id: 'tb-jev',
    purpose: "The usage strip reads Jev's status through it",
    needs: [{ feature: 'the usage strip', version: '0.2.0', why: '`status` (USAGE-1.4)' }],
    checkedUpTo: null,
    versionArgv: null,
    parse: match(/^(\d\S*)$/),
    fix: TB_JEV_INSTALL_COMMAND,
  },
  git: {
    id: 'git',
    purpose: "Lookout reads each Session's repo, branch and Worktree through it",
    needs: [],
    checkedUpTo: null,
    versionArgv: ['--version'],
    // `git version 2.54.0 (Apple Git-157)`
    parse: match(/^git version (\d[\w.]*)/),
    fix: null,
  },
  tmux: {
    id: 'tmux',
    purpose: 'Every Session Lookout starts runs in it, out of sight',
    needs: [],
    checkedUpTo: null,
    versionArgv: ['-V'],
    // `tmux 3.6a`: kept as text, never compared.
    parse: match(/^tmux (\S+)$/),
    fix: null,
  },
};

/** What a tb-* `--version` line says of the latest release (TOOLS-3.1). */
export type TbLatest = { kind: 'latest' } | { kind: 'newer'; version: string } | { kind: 'no-gh' } | { kind: 'none' };

export function parseTbLatest(id: 'tb-session' | 'tb-pr' | 'tb-prod', line: string): TbLatest {
  const note = tbLine(id).exec(line.trim())?.[2];
  if (note === undefined) return { kind: 'none' };
  if (note === 'latest') return { kind: 'latest' };
  if (note === 'install gh to check for updates') return { kind: 'no-gh' };
  const newer = /^latest: (\S+) — upgrade available$/.exec(note)?.[1];
  return newer ? { kind: 'newer', version: newer } : { kind: 'none' };
}

/** `0.3.1` as numbers; null for anything else, a pre-release included (Technical approach, "Comparing"). */
export function semver(v: string | null): [number, number, number] | null {
  const m = v === null ? null : /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Below 0, equal 0, above 1; null when either isn't a plain triple. */
export function compareVersions(a: string | null, b: string | null): number | null {
  const x = semver(a);
  const y = semver(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return 0;
}

/** The version `feature` needs of `tool`, from the one table (TOOLS-2.1). Throws for a pair that isn't in it. */
export function neededVersion(tool: ToolId, feature: string): string {
  const need = TOOLS[tool].needs.find((n) => n.feature === feature);
  if (!need) throw new Error(`TOOLS-2.1 has no need of ${tool} for ${feature}`);
  return need.version;
}

/**
 * TOOLS-2.5: what a section says when its Tool answers as one too old for it, never "isn't
 * installed": the version installed when known, and the one it needs from the table.
 * `tooOld('tb-session', 'the Library', '0.3.0')` is "tb-session 0.3.0 is older than the Library needs (0.4.0)".
 */
export function tooOld(tool: ToolId, feature: string, installed: string | null): string {
  return `${tool}${installed ? ` ${installed}` : ''} is older than ${feature} needs (${neededVersion(tool, feature)})`;
}

/** One row of Settings › Tools (TOOLS-1.1). */
export interface ToolRow {
  id: ToolId;
  purpose: string;
  /** Where it was found, the home directory as `~`; null when it was found nowhere, or isn't known. */
  path: string | null;
  /** TOOLS-1.2: how it was found, when not on PATH: the environment variable that named it, or `Fleet` for a Harness. */
  via: string | null;
  /** TOOLS-1.3: the first line it printed, cut to 60 characters and redacted; null when unknown. */
  version: string | null;
  /** The version number read from `version` (`0.3.0`, `2.1.314`, `3.6a`); null when unknown. */
  number: string | null;
  /** TOOLS-2.2, Fleet only: the revision the running build came from, null when it can't be read. */
  revision: string | null;
  /** TOOLS-2.2, Fleet only: the revision Lookout is tested against (`e2e/pins.json`), 7 characters. */
  pin: string | null;
  needs: ToolNeed[];
  state: ToolState;
  /** A plain sentence. */
  reason: string;
  /** A command to copy, never run (TOOLS-3.4); null when there's nothing to run. */
  fix: string | null;
  /** When this row was read; null before the first read. */
  checkedAt: number | null;
}

/** `GET /api/tools`: one row per Tool, always all of them (UX, "Empty: never"). */
export interface ToolsSnapshot {
  rows: ToolRow[];
  /** When the last read ended; null before the first. */
  checkedAt: number | null;
  /** A read is running now. */
  reading: boolean;
}

/** The Harnesses: Lookout starts a Session with either of them (TOOLS-2.4). */
const HARNESS_IDS: readonly ToolId[] = ['claude', 'codex'];

/**
 * TOOLS-2.4: only `missing` and `behind` mark the Settings button; `update-available` and
 * `newer-than-known` don't. A missing Harness counts only when no Harness is installed, because
 * then Lookout can't start a Session (Dario, 2026-10-30); a too-old one always counts.
 */
export function needsAttention(row: ToolRow, rows: readonly ToolRow[]): boolean {
  if (row.state === 'behind') return true;
  if (row.state !== 'missing') return false;
  if (!HARNESS_IDS.includes(row.id)) return true;
  return rows.filter((r) => HARNESS_IDS.includes(r.id)).every((r) => r.state === 'missing');
}

/** TOOLS-2.4: the Settings button's tooltip lines, "tb-pr is missing", one per Tool that needs attention. */
export function toolsAttention(tools: ToolsSnapshot | null): string[] {
  const rows = tools?.rows ?? [];
  return rows.filter((r) => needsAttention(r, rows)).map((r) => `${r.id} is ${r.state}`);
}
