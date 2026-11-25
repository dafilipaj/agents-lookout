import type { Harness } from './types.ts';

/**
 * VIEW-15, LAUNCH-8: what typing `/` in the composer or the launcher's prompt lists: a Harness's
 * Built-in commands (`builtin-commands.ts`) and its skills, which Setup's reader reads (SETUP-2,
 * SETUP-9.1).
 */

/** VIEW-15.5: where an item is from, in the order rows go by (VIEW-15.6). */
export type CommandSource = 'repo' | 'yours' | 'plugin' | 'claude-ai' | 'builtin';
export const COMMAND_SOURCES: readonly CommandSource[] = ['repo', 'yours', 'plugin', 'claude-ai', 'builtin'];

export interface CommandItem {
  /** As it's called, and what picking types: `/compact`, `/p-dev:code`, `$review` (VIEW-15.5, VIEW-15.8). */
  call: string;
  /** The call without its `/` or `$`: what the word is matched against (VIEW-15.6). */
  name: string;
  /** Its argument hint, one line; null when it takes none. */
  hint: string | null;
  /** One line (VIEW-15.12). */
  description: string;
  source: CommandSource;
  /** The plugin's name, for a plugin's skill. */
  plugin: string | null;
  /** VIEW-15.4: sent as the list inserts it, it opens a dialog, a picker or a panel in the terminal. */
  dialog: boolean;
}

export interface CommandList {
  harness: Harness;
  items: CommandItem[];
  /** VIEW-15.10: why the skills couldn't all be read, in one line; what could be read still lists. */
  error: string | null;
  readAt: number;
}

/** VIEW-15.12: what a list may hold. */
export const MAX_COMMANDS = 2000;
export const MAX_COMMAND_NAME = 128;
export const MAX_COMMAND_DESCRIPTION = 240;
export const MAX_COMMAND_HINT = 120;

/**
 * VIEW-15.12: a name Lookout will type into a Session: letters, digits and `_ . : -`. A skill's
 * name comes from a file on disk, a repo's included, so anything else isn't listed.
 */
export const isCommandName = (name: string) => name.length <= MAX_COMMAND_NAME && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(name);

/** VIEW-15.12: a text's first line with something on it, its blanks single, cut to `max` with `…`. */
export function oneLine(text: string, max: number): string {
  const line = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** VIEW-15.5: where an item is from, in words. */
export function sourceLabel(item: Pick<CommandItem, 'source' | 'plugin'>): string {
  switch (item.source) {
    case 'repo':
      return 'This repo';
    case 'yours':
      return 'Yours';
    case 'plugin':
      return item.plugin ?? 'Plugin';
    case 'claude-ai':
      return 'claude.ai';
    case 'builtin':
      return 'Built-in';
  }
}

/** VIEW-15.5: the words a marked command shows before you send it. */
export const OPENS_IN_TERMINAL = 'opens in terminal';

/**
 * VIEW-15.1: the word a `/` list works on: the box's whole text when it is one word that starts with
 * `/`, has no second `/` (a path, VIEW-9.7) and no blank after it; null otherwise. Blanks before the
 * `/` don't count (VIEW-3.8). `query` is what follows the `/`.
 */
export function commandWord(text: string): { word: string; query: string; start: number } | null {
  const m = /^(\s*)(\/[^\s/]*)$/.exec(text);
  return m ? { word: m[2]!, query: m[2]!.slice(1), start: m[1]!.length } : null;
}
