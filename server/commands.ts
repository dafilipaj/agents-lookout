import { BUILTIN_COMMANDS } from '../shared/builtin-commands.ts';
import { type CommandItem, type CommandList, type CommandSource, MAX_COMMANDS, MAX_COMMAND_DESCRIPTION, MAX_COMMAND_HINT, isCommandName, oneLine } from '../shared/commands.ts';
import type { SetupError, SetupItem } from '../shared/setup.ts';
import type { Harness } from '../shared/types.ts';
import type { Setup } from './setup.ts';

/**
 * VIEW-15, LAUNCH-8: what a `/` lists for a Harness in a directory: its skills, from Setup's reader
 * (0010), and its Built-in commands, from the list Lookout keeps (VIEW-15.4).
 */

export interface CommandsOptions {
  setup: Pick<Setup, 'readSkills'>;
  now?(): number;
}

/** How a Harness calls a skill: Claude Code as a Slash command, Codex as `$name` (VIEW-15.3). */
const SIGIL: Record<Harness, string> = { claude: '/', codex: '$' };

/** Which of two items with one call the Harness runs: yours before a directory's, a skill before a Built-in command (VIEW-15.2). */
const RUNS_FIRST: readonly CommandSource[] = ['yours', 'repo', 'plugin', 'claude-ai', 'builtin'];

const SOURCE: Record<SetupItem['source']['type'], CommandSource> = { yours: 'yours', repo: 'repo', plugin: 'plugin', 'claude-ai': 'claude-ai' };

function skillItem(harness: Harness, skill: SetupItem): CommandItem | null {
  // VIEW-15.2: off (SETUP-5.1), or the model's alone, isn't offered; VIEW-15.12: nor is a name Lookout won't type.
  if (skill.off !== null || skill.userInvocable === false || !isCommandName(skill.name)) return null;
  const call = `${SIGIL[harness]}${skill.name}`;
  // Setup keeps a Claude Code skill's call as `/<name> <hint>` (SETUP-3.1).
  const hint = harness === 'claude' && skill.call?.startsWith(`${call} `) ? oneLine(skill.call.slice(call.length), MAX_COMMAND_HINT) : '';
  return {
    call,
    name: skill.name,
    hint: hint || null,
    description: oneLine(skill.description, MAX_COMMAND_DESCRIPTION),
    source: SOURCE[skill.source.type],
    plugin: skill.source.type === 'plugin' ? skill.source.name : null,
    dialog: false,
  };
}

/** A directory's skill folder before its command file of the same name, as Claude Code runs them. */
const skillFolderFirst = (a: SetupItem, b: SetupItem) => Number(b.file.endsWith('/SKILL.md')) - Number(a.file.endsWith('/SKILL.md'));

/**
 * VIEW-15.2 to 15.4, 15.12: the list for a Harness: its skills that are on and can be called, then
 * its Built-in commands, each call once, as the one the Harness runs. `dialogs: false` leaves out
 * the Built-in commands that open a dialog (LAUNCH-8.2).
 */
export function commandList(harness: Harness, skills: readonly SetupItem[], errors: readonly SetupError[], at: number, opts: { dialogs?: boolean } = {}): CommandList {
  const found = [...skills].sort(skillFolderFirst).map((s) => skillItem(harness, s)).filter((i): i is CommandItem => i !== null);
  const builtin: CommandItem[] = BUILTIN_COMMANDS[harness].commands
    .filter((c) => opts.dialogs !== false || !c.dialog)
    .map((c) => ({ call: `/${c.name}`, name: c.name, hint: c.hint ?? null, description: c.description, source: 'builtin', plugin: null, dialog: c.dialog === true }));
  const byCall = new Map<string, CommandItem>();
  for (const item of [...found, ...builtin].sort((a, b) => RUNS_FIRST.indexOf(a.source) - RUNS_FIRST.indexOf(b.source))) {
    if (!byCall.has(item.call)) byCall.set(item.call, item);
  }
  const first = errors[0];
  return {
    harness,
    items: [...byCall.values()].slice(0, MAX_COMMANDS),
    error: first ? oneLine(`${first.file}: ${first.error}`, MAX_COMMAND_DESCRIPTION) : null,
    readAt: at,
  };
}

export class Commands {
  private readonly opts: CommandsOptions;
  /** A read under way, by Harness and directory: the tabs that ask meanwhile share it. */
  private readonly reading = new Map<string, Promise<{ items: SetupItem[]; errors: SetupError[] }>>();

  constructor(opts: CommandsOptions) {
    this.opts = opts;
  }

  /** VIEW-15.10: a fresh read of a Harness's skills, with what a directory adds; never throws. */
  async list(harness: Harness, directory: string | null, opts: { dialogs?: boolean } = {}): Promise<CommandList> {
    const key = `${harness}\0${directory ?? ''}`;
    let read = this.reading.get(key);
    if (!read) {
      read = this.opts.setup
        .readSkills(harness, directory)
        .catch((err: unknown) => ({ items: [] as SetupItem[], errors: [{ kind: 'skill' as const, file: 'skills', error: err instanceof Error ? err.message.split('\n')[0]! : String(err) }] }))
        .finally(() => this.reading.delete(key));
      this.reading.set(key, read);
    }
    const { items, errors } = await read;
    return commandList(harness, items, errors, this.opts.now?.() ?? Date.now(), opts);
  }
}
