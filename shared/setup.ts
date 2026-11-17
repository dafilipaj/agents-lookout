import type { Harness } from './types.ts';

/**
 * SETUP: what Claude Code and Codex load for every Session on this Mac, read by Lookout's server
 * from the Harnesses' own files (SETUP-2). An MCP server's environment and header values never
 * appear here: only their names (SETUP-2.4).
 */

export type SetupKind = 'skill' | 'agent' | 'hook' | 'mcp';
export const SETUP_KINDS: readonly SetupKind[] = ['skill', 'agent', 'hook', 'mcp'];

/** SETUP-1.3: where an item comes from. */
export type SetupSource = { type: 'yours' } | { type: 'claude-ai' } | { type: 'plugin'; name: string; id: string; version: string | null };

/**
 * SETUP-5.1: why an item is off: turned off in `skillOverrides` (`override-missing` when the entry
 * names no skill on disk), its plugin is off, a Codex hook with no trust recorded, or `enabled =
 * false` in Codex's `config.toml`.
 */
export type SetupOff = 'override' | 'override-missing' | 'plugin' | 'untrusted' | 'config';

/** SETUP-4.1: a `skillOverrides` value that leaves a skill on. */
export type SetupListing = 'name-only' | 'user-invocable-only';

export interface SetupHookEvent {
  event: string;
  matcher: string | null;
}

export interface SetupItem {
  /** Unique within a read. */
  key: string;
  kind: SetupKind;
  harness: Harness;
  /** SETUP-1.5: as it's called (`p-codex:dual-review`), a hook's script (SETUP-1.6), an MCP server's name. */
  name: string;
  /** Whole; the row shows its first line (SETUP-1.5). */
  description: string;
  source: SetupSource;
  /** Absolute; what Open in VS Code opens (SETUP-3.2). */
  file: string;
  /** 1-based, in a settings, `hooks.json` or config file; null for a file of its own. */
  line: number | null;
  off: SetupOff | null;
  /** A skill: `/<name> <hint>`, or `$<name>` in Codex (SETUP-3.1). */
  call?: string;
  /** A skill: a `skillOverrides` value other than `off` (SETUP-4.1). */
  listing?: SetupListing;
  /** A skill turned off in `skillOverrides`: the entry's key, which Turn on removes (SETUP-4.1). */
  overrideKey?: string;
  /** An agent (SETUP-3.1). */
  model?: string | null;
  effort?: string | null;
  tools?: string[] | null;
  /** A hook: every event it runs on, in its file's order (SETUP-1.6). */
  events?: SetupHookEvent[];
  /** A hook's whole command, or an MCP server's (stdio). */
  command?: string;
  /** A hook's timeout, in seconds. */
  timeout?: number | null;
  /** An MCP server (SETUP-3.1). */
  transport?: 'stdio' | 'http' | 'sse';
  args?: string[];
  url?: string | null;
  /** SETUP-2.4: names only. */
  env?: string[];
  headers?: string[];
}

/** SETUP-2.3: a file that couldn't be read or parsed, shown as a row of its section. */
export interface SetupError {
  kind: SetupKind;
  file: string;
  error: string;
}

export interface SetupSnapshot {
  items: SetupItem[];
  errors: SetupError[];
  readAt: number;
}

/** SETUP-4: a switch's answer: the read that followed it. */
export interface SetupSwitchResult {
  snapshot: SetupSnapshot;
}

/** SETUP-4.1: a Claude Code skill has a switch unless its plugin is what turns it off. */
export const skillSwitchable = (i: SetupItem) => i.kind === 'skill' && i.harness === 'claude' && i.off !== 'plugin';

/** SETUP-4.2: a Claude Code plugin's items carry its switch. */
export const pluginOf = (i: SetupItem) => (i.harness === 'claude' && i.source.type === 'plugin' ? i.source : null);

/** A request body's skill switch, or null. */
export function parseSkillSwitch(body: unknown): { name: string; on: boolean } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { name, on } = body as Record<string, unknown>;
  if (typeof name !== 'string' || typeof on !== 'boolean') return null;
  if (!/^[\w.:@+-]{1,200}$/.test(name)) return null;
  return { name, on };
}

/** A request body's plugin switch, or null: an id as `claude plugin list` gives it (`name@marketplace`). */
export function parsePluginSwitch(body: unknown): { id: string; on: boolean } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { id, on } = body as Record<string, unknown>;
  if (typeof id !== 'string' || typeof on !== 'boolean') return null;
  if (!/^[\w.-]{1,100}@[\w.-]{1,100}$/.test(id)) return null;
  return { id, on };
}
