import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { RunError, Runner } from './exec.ts';

/**
 * One row of `fleet list --json` (Fleet docs/architecture.md, "JSON contracts"; add-only).
 * Only the fields Lookout reads are typed; the rest are ignored.
 */
export interface FleetRow {
  pid: number;
  session_id: string | null;
  cwd: string | null;
  /** `busy` | `idle` | `waiting` | `unknown` */
  status: string;
  waiting_for: string | null;
  /** Claude: the registry's last status change. Codex: its Transcript's mtime (or process start). */
  updated_at: number | null;
  /** `tmux` | `iterm` | `unknown` */
  backend: string;
  /** The tmux session the pane lives in (LAUNCH matches a start to its Session by it). */
  tmux_session?: string | null;
  display_title: string;
  context: { pct: number } | null;
  /** `claude` | `codex` | `pi` */
  harness: string;
  model: string | null;
  /**
   * VIEW-5.11: the reasoning effort the Transcript last recorded (`high`, `xhigh` …); null when
   * unknown. Missing from a Fleet older than the fork's `effort` field.
   */
  effort?: string | null;
  /** SIDE-9, VIEW-8: running now and finished in this Turn; missing on an older Fleet. */
  subagents?: { running: number; finished: number | null } | null;
  /** The agent process's start time, RFC 3339 UTC; null when Fleet can't read it (VIEW-5.6). */
  proc_start?: string | null;
  /**
   * VIEW-6.7: the `timestamp` of the Transcript entry `model` was read from (Claude Code: its last
   * reply), as written; null without one. Missing from a Fleet older than the fork's `fleet model`.
   */
  model_at?: string | null;
}

export type FleetListResult =
  | { kind: 'ok'; rows: FleetRow[] }
  | { kind: 'not-installed' }
  | { kind: 'error'; message: string };

export const FLEET_TIMEOUT_MS = 4000;

/**
 * Finds the `fleet` binary: LOOKOUT_FLEET_BIN, then PATH, then cargo's default install dir
 * (a server started by launchd has a short PATH). Falls back to the bare name.
 */
export function resolveFleetBin(env: NodeJS.ProcessEnv = process.env): string {
  if (env.LOOKOUT_FLEET_BIN) return env.LOOKOUT_FLEET_BIN;
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  dirs.push(join(env.CARGO_HOME ?? join(homedir(), '.cargo'), 'bin'));
  for (const dir of dirs) {
    const candidate = join(dir, 'fleet');
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return 'fleet';
}

/** Calls `fleet --local list --json` and classifies the outcome. Never throws. */
export async function fetchFleetList(
  runner: Runner,
  bin: string,
  timeoutMs = FLEET_TIMEOUT_MS,
): Promise<FleetListResult> {
  let stdout: string;
  try {
    stdout = await runner(bin, ['--local', 'list', '--json'], { timeoutMs });
  } catch (err) {
    const e = err as RunError;
    if (e.code === 'ENOENT') return { kind: 'not-installed' };
    if (e.timedOut) return { kind: 'error', message: `fleet list timed out after ${timeoutMs / 1000} s` };
    const detail = firstLine(e.stderr) ?? firstLine(e.message) ?? 'unknown error';
    return { kind: 'error', message: `fleet list failed: ${detail}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { kind: 'error', message: 'fleet list returned invalid JSON' };
  }
  if (!Array.isArray(parsed)) return { kind: 'error', message: 'fleet list returned something other than a list' };
  return { kind: 'ok', rows: parsed.filter(isFleetRow) };
}

/** One JSON object a Fleet command printed (`--json`), or null for anything else. */
export function fleetObject(text: string | undefined): Record<string, unknown> | null {
  if (!text?.trim()) return null;
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isFleetRow(v: unknown): v is FleetRow {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.pid === 'number' && typeof r.status === 'string' && typeof r.harness === 'string';
}

function firstLine(s: string | undefined): string | undefined {
  const line = s?.trim().split('\n')[0]?.trim();
  return line ? line : undefined;
}
