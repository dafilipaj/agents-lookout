import { COMMAND_SOURCES, type CommandItem, type CommandList } from '@shared/commands.ts';
import type { LaunchHarness } from '@shared/settings.ts';
import type { Harness } from '@shared/types.ts';
import { type Range, fuzzyRanges } from '@/lib/filter';

/**
 * VIEW-15, LAUNCH-8: the `/` list in the tab: the lists it has read, kept per Session or per Harness
 * and directory (VIEW-15.10), and how a word narrows and orders one (VIEW-15.6).
 */

/** What a list is read for: a Session's composer, or the launcher's Harness and start directory (LAUNCH-8.1). */
export type CommandsKey = { session: string } | { harness: LaunchHarness; directory: string; continues?: { sessionId: string; harness: Harness } | null };

export const commandsId = (key: CommandsKey): string => ('session' in key ? `s:${key.session}` : `l:${key.harness}:${key.directory}:${key.continues?.sessionId ?? ''}`);

/** VIEW-15.10: a list read this recently isn't read again when the list opens. */
export const COMMANDS_FRESH_MS = 30_000;

export interface CommandsState {
  /** The last list read; it shows while a newer one is read. */
  list: CommandList | null;
  /** Why the last read failed, or that it couldn't read every skill and why, in one line. */
  error: string | null;
  reading: boolean;
}

const NONE: CommandsState = { list: null, error: null, reading: false };

/** VIEW-15.10: what a list says above what it did read, when a skill's file or the plugin list couldn't be. */
export const couldntReadEvery = (reason: string) => `Couldn't read every command and skill: ${reason}`;

/** The lists the tab has read, by what each was read for; a Composer or the launcher subscribes to its own. */
export class ComposerCommands {
  private readonly read: (key: CommandsKey) => Promise<CommandList>;
  private readonly now: () => number;
  private readonly states = new Map<string, CommandsState>();
  private readonly readAt = new Map<string, number>();
  private readonly listeners = new Set<() => void>();

  constructor(read: (key: CommandsKey) => Promise<CommandList>, now: () => number = Date.now) {
    this.read = read;
    this.now = now;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  state = (id: string): CommandsState => this.states.get(id) ?? NONE;

  private set(id: string, state: CommandsState) {
    this.states.set(id, state);
    for (const fn of this.listeners) fn();
  }

  /**
   * VIEW-15.10: the list opened. It's read unless it was read in the last 30 s; the earlier list
   * shows meanwhile. A failed read keeps the earlier list and its reason, and the next opening
   * reads again.
   */
  open(key: CommandsKey): void {
    const id = commandsId(key);
    const was = this.state(id);
    if (was.reading) return;
    const last = this.readAt.get(id);
    if (was.list && last !== undefined && this.now() - last < COMMANDS_FRESH_MS) return;
    this.set(id, { ...was, reading: true });
    this.read(key).then(
      (list) => {
        this.readAt.set(id, this.now());
        this.set(id, { list, error: list.error === null ? null : couldntReadEvery(list.error), reading: false });
      },
      (err: unknown) => {
        this.readAt.delete(id);
        this.set(id, { list: this.state(id).list, error: err instanceof Error ? err.message : String(err), reading: false });
      },
    );
  }
}

export interface RankedCommand {
  item: CommandItem;
  /** What matched in the item as it's called (`call`), and in its description (DS-3.4). */
  call: Range[];
  description: Range[];
}

const PART_AFTER = new Set([':', '-', '_']);

/** Where `query` starts a part of `name` after its first: a part follows `:`, `-` or `_`. */
function partStart(name: string, query: string): number {
  for (let i = name.indexOf(query, 1); i > 0; i = name.indexOf(query, i + 1)) if (PART_AFTER.has(name[i - 1]!)) return i;
  return -1;
}

/**
 * VIEW-15.6: the items a word leaves, the best match first: the item that is the word, whole; a name
 * that starts with what follows the `/`; a name with a part that starts with it; a name that holds
 * it; a name that holds its letters in order, from 3 letters (SIDE-12.3); then a description that
 * holds it. Equal matches, and every item while nothing follows the `/`, go by source and then by
 * name. Case is ignored, except for the whole word.
 */
export function rankCommands(items: readonly CommandItem[], word: string): RankedCommand[] {
  const query = word.replace(/^\//, '').toLowerCase();
  const ranked: (RankedCommand & { rank: number })[] = [];
  for (const item of items) {
    const sigil = item.call.length - item.name.length;
    const inCall = (from: number, to: number): Range[] => [[from + sigil, to + sigil]];
    if (!query) {
      ranked.push({ item, call: [], description: [], rank: 1 });
      continue;
    }
    const name = item.name.toLowerCase();
    const at = name.indexOf(query);
    if (item.call === word) ranked.push({ item, call: inCall(0, name.length), description: [], rank: 0 });
    else if (at === 0) ranked.push({ item, call: inCall(0, query.length), description: [], rank: 1 });
    else if (partStart(name, query) > 0) ranked.push({ item, call: inCall(partStart(name, query), partStart(name, query) + query.length), description: [], rank: 2 });
    else if (at > 0) ranked.push({ item, call: inCall(at, at + query.length), description: [], rank: 3 });
    else {
      const fuzzy = query.length >= 3 ? fuzzyRanges(item.name, query) : [];
      const inDescription = item.description.toLowerCase().indexOf(query);
      if (fuzzy.length) ranked.push({ item, call: fuzzy.map(([a, b]) => [a + sigil, b + sigil] as Range), description: [], rank: 4 });
      else if (inDescription >= 0) ranked.push({ item, call: [], description: [[inDescription, inDescription + query.length]], rank: 5 });
    }
  }
  const source = (i: CommandItem) => COMMAND_SOURCES.indexOf(i.source);
  return ranked
    .sort((a, b) => a.rank - b.rank || source(a.item) - source(b.item) || (a.item.plugin ?? '').localeCompare(b.item.plugin ?? '') || a.item.name.localeCompare(b.item.name))
    .map(({ item, call, description }) => ({ item, call, description }));
}
