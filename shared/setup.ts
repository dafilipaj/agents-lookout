import type { Harness } from './types.ts';

/**
 * SETUP: what Claude Code and Codex load for every Session on this Mac, read by Lookout's server
 * from the Harnesses' own files (SETUP-2). An MCP server's environment and header values never
 * appear here: only their names (SETUP-2.4).
 */

export type SetupKind = 'skill' | 'agent' | 'hook' | 'mcp';
export const SETUP_KINDS: readonly SetupKind[] = ['skill', 'agent', 'hook', 'mcp'];

/** SETUP-1.3: where an item comes from; `repo` is a Session's directory's own (SETUP-9.1). */
export type SetupSource = { type: 'yours' } | { type: 'claude-ai' } | { type: 'repo' } | { type: 'plugin'; name: string; id: string; version: string | null };

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
  /** A skill whose frontmatter says `user-invocable: false`: the model's alone, so no `/` list offers it (VIEW-15.2). */
  userInvocable?: false;
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

/**
 * SETUP-6 to SETUP-9: what one Claude Code Session loaded and what ran in it, read from its
 * Transcript, and what its directory adds, read from disk.
 */

/** SETUP-7.1: an instruction file's group: `~/.claude/CLAUDE.md`, or the repo's `CLAUDE.md` files and `CLAUDE.local.md`. */
export type SessionFileGroup = 'yours' | 'repo';

export interface SessionInstruction {
  /** Unique within a read. */
  key: string;
  /** Absolute; what Open in VS Code opens (SETUP-7.4). */
  path: string;
  /** From the repo, else from `~` (SETUP-7.1). */
  shown: string;
  group: SessionFileGroup;
  /** SETUP-7.2: the key of the file whose `@path` imports it. */
  importer: string | null;
  /** SETUP-7.2: how many of the loaded files it imports. */
  imports: number;
  lines: number;
  /** Its loaded text's length / 4, an estimate (SETUP-7.1). */
  tokens: number;
  /** When the Session loaded it, ms. */
  loadedAt: number;
  /** SETUP-7.1: loaded after the latest load, a subfolder's `CLAUDE.md`. */
  later: boolean;
  /** SETUP-7.3: its text on disk against what the Session loaded. */
  disk: 'same' | 'changed' | 'gone';
  /** When a changed file was last written, ms. */
  changedAt: number | null;
}

/** SETUP-7.5: one entry line of the memory index. */
export interface SessionMemoryEntry {
  key: string;
  title: string;
  /** Absolute. */
  file: string;
  /** Its front matter's type (`user`, `feedback`, `project`, `reference`), or null. */
  type: string | null;
}

export interface SessionMemory {
  /** The index, `MEMORY.md`. */
  path: string;
  entries: SessionMemoryEntry[];
  tokens: number;
}

/** SETUP-8.1: one thing that ran: a skill, a Subagent type, an MCP server or a hook command. */
export interface SessionRan {
  key: string;
  kind: SetupKind;
  /** As SETUP-1.5 shows it; a hook's script (SETUP-1.6). */
  name: string;
  /** Skill and Subagent calls, an MCP server's tool calls, a hook's runs. */
  count: number;
  /** A hook's runs that failed or were cancelled. */
  failed: number;
  /** A hook's events, in the order first seen, when it matches no item. */
  events: string[];
  /** SETUP-8.2: the item Setup lists, Everywhere or in This repo's own; null when none matches. */
  item: SetupItem | null;
  /** SETUP-8.2: a Subagent type built into Claude Code. */
  builtIn: boolean;
  /** Where an unmatched MCP server comes from (`claude.ai`), else null. */
  origin: string | null;
}

/** SETUP-9.2: why an item of the repo's isn't in the Session's lists. */
export type SessionNotLoadedWhy = { reason: 'added'; at: number } | { reason: 'not-approved' } | { reason: 'not-listed' };

export interface SessionNotLoaded {
  item: SetupItem;
  why: SessionNotLoadedWhy;
}

/** SETUP-6.5: a Transcript or repo file that couldn't be read, one row naming it. */
export interface SessionSetupError {
  where: 'transcript' | 'repo';
  kind: SetupKind | null;
  file: string;
  error: string;
}

export interface SessionSetup {
  sessionId: string;
  /** From the Transcript; the main pane's title wins when it has one. */
  title: string | null;
  /** The directory it loaded in, and the same from `~` (SETUP-6.2). */
  directory: string | null;
  directoryShown: string | null;
  /** SETUP-6.2: its latest load, its start or latest compaction, ms; null when none was recorded. */
  loadedAt: number | null;
  instructions: SessionInstruction[];
  memory: SessionMemory | null;
  ran: SessionRan[];
  /** SETUP-9.1: what its directory adds, the ones its lists named. */
  repo: SetupItem[];
  notLoaded: SessionNotLoaded[];
  /** SETUP-6.3: what its lists named from outside its repo, by kind. */
  everywhere: Record<SetupKind, number>;
  errors: SessionSetupError[];
  readAt: number;
}

/** SETUP-6.5: a Claude Code session id, as its Transcript's file is named. */
export const isSessionId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
