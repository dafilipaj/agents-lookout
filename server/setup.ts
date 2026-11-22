import { randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { TomlError, parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { type SessionSetup, type SessionSetupError, type SetupError, type SetupHookEvent, type SetupItem, type SetupKind, type SetupListing, type SetupOff, type SetupSnapshot, type SetupSource, isSessionId } from '../shared/setup.ts';
import type { Harness } from '../shared/types.ts';
import type { Runner } from './exec.ts';
import { sessionSetup } from './setup-session.ts';
import { type TranscriptFacts, readTranscript } from './setup-transcript.ts';

/**
 * SETUP-2: reads what Claude Code and Codex load for every Session, from their own files and
 * `claude plugin list --json`. Lookout is the one consumer, so the reading lives here (0010); it
 * moves to a Building block when a second one appears (0005). SETUP-4: the two switches Claude Code
 * has, a skill's `skillOverrides` entry and a plugin's `claude plugin enable|disable`. SETUP-6 to 9:
 * what one Session loaded and what ran in it, from its Transcript, and what its directory adds.
 */

export interface SetupOptions {
  home: string;
  runner: Runner;
  /** The `claude` binary, or null when it isn't installed. */
  claudeBin(): Promise<string | null>;
  now?(): number;
}

/** SETUP-4: a switch Lookout refused or couldn't make; `status` is the HTTP answer. */
export class SetupFailure extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const LIST_TIMEOUT_MS = 30_000;
const SWITCH_TIMEOUT_MS = 60_000;

interface Plugin {
  id: string;
  name: string;
  version: string | null;
  enabled: boolean;
  installPath: string;
  mcpServers: Record<string, unknown>;
  /** `user` applies to every Session; `project` and `local` to one directory's (SETUP-9.1). */
  scope: string;
  projectPath: string | null;
}

/** Collects a read's items and the files it couldn't read (SETUP-2.3). */
class Read {
  items: SetupItem[] = [];
  errors: SetupError[] = [];
  private seen = new Set<string>();
  add(item: Omit<SetupItem, 'key'>, key: string) {
    let k = key;
    for (let n = 2; this.seen.has(k); n++) k = `${key}#${n}`;
    this.seen.add(k);
    this.items.push({ ...item, key: k });
  }
  fail(kind: SetupKind, file: string, err: unknown) {
    this.errors.push({ kind, file, error: message(err) });
  }
}

/**
 * An error in one line. SETUP-2.4: a parse error says where, never what: JSON's and TOML's own
 * messages quote the file's text, which can hold an MCP server's environment or headers.
 */
function message(err: unknown): string {
  if (err instanceof SyntaxError) {
    const at = /line (\d+) column (\d+)/.exec(err.message);
    return `not valid JSON${at ? ` (line ${at[1]}, column ${at[2]})` : ''}`;
  }
  if (err instanceof TomlError) return `not valid TOML (line ${err.line}, column ${err.column})`;
  return scrub((err instanceof Error ? err.message.split('\n')[0]! : String(err)).slice(0, 300));
}
const isMissing = (err: unknown) => (err as NodeJS.ErrnoException)?.code === 'ENOENT' || (err as NodeJS.ErrnoException)?.code === 'ENOTDIR';
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The text of a file, or null when it isn't there; any other failure throws. */
async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

/** A directory's entries that are directories (following links), sorted; none when it isn't there. */
async function subdirs(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  const dirs = await Promise.all(names.map(async (n) => ((await stat(join(dir, n)).catch(() => null))?.isDirectory() ? n : null)));
  return dirs.filter((n): n is string => n !== null && !n.startsWith('.')).sort();
}

async function files(dir: string, ext: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((n) => n.endsWith(ext) && !n.startsWith('.')).sort();
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

/**
 * A Markdown file's frontmatter as a map. YAML first; a skill's frontmatter isn't always valid YAML
 * (an unquoted `: ` in a description), and Claude Code reads it anyway, so a line-by-line read is
 * the fallback.
 */
export function frontmatter(text: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return {};
  try {
    return obj(parseYaml(m[1]!)) ?? {};
  } catch {
    const fields: Record<string, unknown> = {};
    for (const line of m[1]!.split(/\r?\n/)) {
      const f = /^([\w-]+):\s*(.*)$/.exec(line);
      if (f) fields[f[1]!] = f[2]!.replace(/^(['"])(.*)\1$/, '$2');
    }
    return fields;
  }
}

/** The 1-based line of the first `needle` at or after `from`, or null. */
function lineOf(text: string, needle: string, from = 0): number | null {
  const at = text.indexOf(needle, from);
  return at < 0 ? null : text.slice(0, at).split('\n').length;
}

/**
 * The 1-based line of the key at `path` in a JSON text, through objects only, or null: so a
 * top-level `mcpServers` entry is found, not a project's of the same name before it.
 */
export function keyLine(text: string, path: readonly string[]): number | null {
  const stack: { object: boolean; key: string | null; expectKey: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const top = stack.at(-1);
      if (top?.object && top.expectKey) {
        let key: string;
        try {
          key = JSON.parse(text.slice(i, j + 1)) as string;
        } catch {
          return null;
        }
        top.key = key;
        top.expectKey = false;
        if (stack.length === path.length && stack.every((f, n) => f.key === path[n])) return text.slice(0, i).split('\n').length;
      }
      i = j;
    } else if (c === '{' || c === '[') stack.push({ object: c === '{', key: null, expectKey: c === '{' });
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',' && stack.at(-1)?.object) stack.at(-1)!.expectKey = true;
  }
  return null;
}

/** SETUP-1.6: a hook's name: the script it runs (with its folder for `hook` and `index`), else the first path in it, else its first word. */
export function hookName(command: string): string {
  const script = /([^\s"'`;|&<>()=]*?)([\w.-]+\.(?:sh|bash|zsh|mjs|cjs|js|mts|ts|py|rb|pl))(?=$|[\s"'`;|&<>)])/.exec(command);
  if (script) {
    const [, dir, file] = script;
    if (/^(hook|index)\./.test(file!)) {
      const parent = dir!.replace(/\/+$/, '').split('/').pop();
      if (parent && !parent.includes('$')) return `${parent}/${file}`;
    }
    return file!;
  }
  // A script without an extension (`node "$CLAUDE_PLUGIN_ROOT/scripts/workspaces"`): the first path in it.
  const path = /(?:\$\{?\w+\}?|~)?(?:\/[\w.@+-]+)+/.exec(command.replace(/\w+:\/\/\S+/g, ''));
  if (path) return basename(path[0]);
  const first = command.trim().split(/\s+/)[0] ?? command;
  return basename(first) || first;
}

const snake = (event: string) => event.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/** One hook entry as a Harness's hooks file has it. */
interface HookEntry {
  event: string;
  matcher: string | null;
  command: string;
  timeout: number | null;
  group: number;
  index: number;
}

/** The `{ hooks: { Event: [{ matcher, hooks: [{ command, timeout }] }] } }` shape both Harnesses use. */
function hookEntries(json: unknown): HookEntry[] {
  const hooks = obj(obj(json)?.hooks);
  if (!hooks) return [];
  const out: HookEntry[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((g, group) => {
      const m = obj(g);
      if (!m) return;
      const list = Array.isArray(m.hooks) ? m.hooks : [];
      list.forEach((h, index) => {
        const e = obj(h);
        if (!e) return;
        const command = str(e.command) ?? str(e.url) ?? str(e.prompt) ?? str(e.type);
        if (!command) return;
        out.push({ event, matcher: str(m.matcher), command, timeout: typeof e.timeout === 'number' ? e.timeout : null, group, index });
      });
    });
  }
  return out;
}

/**
 * SETUP-1.6: one item per command: the same command on several events is one hook. `offOf` says
 * whether one entry is off (Codex's trust); the item is off only when every entry is.
 */
function addHooks(read: Read, entries: HookEntry[], at: { harness: Harness; source: SetupSource; file: string; text: string; offOf?: (e: HookEntry) => SetupOff | null }) {
  const byCommand = new Map<string, HookEntry[]>();
  for (const e of entries) byCommand.set(e.command, [...(byCommand.get(e.command) ?? []), e]);
  for (const [command, list] of byCommand) {
    const events: SetupHookEvent[] = list.map((e) => ({ event: e.event, matcher: e.matcher }));
    const offs = at.offOf ? list.map(at.offOf) : [null];
    const off = offs.every((o) => o !== null) ? offs[0]! : null;
    const description = events.length === 1 ? [events[0]!.event, events[0]!.matcher].filter((x) => x && x !== '*').join(' · ') : `${events.length} events`;
    read.add(
      {
        kind: 'hook',
        harness: at.harness,
        name: hookName(command),
        description,
        source: at.source,
        file: at.file,
        line: lineOf(at.text, JSON.stringify(command)) ?? lineOf(at.text, `"${list[0]!.event}"`),
        off,
        events,
        command,
        timeout: list.find((e) => e.timeout !== null)?.timeout ?? null,
      },
      `hook:${at.harness}:${sourceKey(at.source)}:${command}`,
    );
  }
}

const sourceKey = (s: SetupSource) => (s.type === 'plugin' ? `plugin:${s.id}` : s.type);

/** A name that says its value is a credential: `--api-key`, `GITHUB_TOKEN`, `Authorization`. */
const SECRET_NAME = /token|secret|passw|api[-_]?key|apikey|auth|bearer|credential|cookie|private[-_]?key|header|^-H$/i;
const HIDDEN = '…';

/** SETUP-2.4: a URL without its user info (a password, or a token given as the user) or its query's values. */
export const redactUrl = (text: string) =>
  text
    // Through the authority's last `@`: a password can hold one.
    .replace(/(\w+:\/\/)[^\s/?#]*@/g, `$1${HIDDEN}@`)
    .replace(/(\w+:\/\/[^\s?#]*\?)([^\s#]*)/g, (_, base: string, query: string) => base + query.replace(/(^|&)([^=&]+)=[^&]*/g, `$1$2=${HIDDEN}`));

/**
 * SETUP-2.4: free text (an argument, a CLI's diagnostic) without what looks like a credential: a
 * secret-named `NAME=value`, `"name": "value"`, `Name: value` or `--flag value`, a bearer token, a
 * URL's user info and query values.
 */
export const scrub = (text: string) =>
  redactUrl(text)
    .replace(/(--?[\w-]*(?:token|secret|passw|api[-_]?key|apikey|auth|credential|cookie|private[-_]?key)[\w-]*\s+)(?![-…])("[^"]*"|'[^']*'|\S+)/gi, `$1${HIDDEN}`)
    .replace(/(\b[\w-]*(?:token|secret|passw|api[-_]?key|apikey|auth|credential|cookie|private[-_]?key)[\w-]*["']?\s*[=:]\s*)(?:(?:Bearer|Basic)\s+)?("[^"]*"|'[^']*'|[^\s,;}]+)/gi, `$1${HIDDEN}`)
    .replace(/\b(Bearer|Basic)\s+(?!…)[^\s"',;]+/gi, `$1 ${HIDDEN}`);

/**
 * SETUP-2.4: an MCP server's arguments without what looks like a credential: a secret-named flag's
 * value (`--token x`, `--api-key=x`, `-H "Authorization: Bearer x"`), and what `scrub` hides, in
 * an argument or in a flag's value (`--env=API_TOKEN=x`).
 */
export function redactArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  let hideNext = false;
  for (const a of args) {
    if (hideNext) {
      hideNext = false;
      out.push(HIDDEN);
      continue;
    }
    const flag = /^(--?[\w-]+)(?:=(.*))?$/.exec(a);
    if (flag && SECRET_NAME.test(flag[1]!)) {
      if (flag[2] === undefined) {
        hideNext = true;
        out.push(a);
      } else out.push(`${flag[1]}=${HIDDEN}`);
    } else if (flag && flag[2] !== undefined) out.push(`${flag[1]}=${scrub(flag[2])}`);
    else out.push(scrub(a));
  }
  return out;
}

/** SETUP-2.4: an MCP server's facts, its environment and headers by name only, its arguments and URL without credentials. */
function mcpFacts(config: Record<string, unknown>): Pick<SetupItem, 'transport' | 'command' | 'args' | 'url' | 'env' | 'headers' | 'description'> {
  const url = str(config.url) && redactUrl(str(config.url)!);
  const type = str(config.type);
  const transport = type === 'sse' ? 'sse' : type === 'http' || type === 'streamable_http' || (url && !config.command) ? 'http' : 'stdio';
  const command = str(config.command) ?? undefined;
  const args = redactArgs(strs(config.args));
  const env = [...Object.keys(obj(config.env) ?? {}), ...strs(config.env_vars), ...(str(config.bearer_token_env_var) ? [str(config.bearer_token_env_var)!] : [])];
  const headers = [...Object.keys(obj(config.headers) ?? {}), ...Object.keys(obj(config.http_headers) ?? {}), ...Object.keys(obj(config.env_http_headers) ?? {})];
  const description = url ?? [command, ...args].filter(Boolean).join(' ');
  return { transport, ...(command ? { command } : {}), args, url, env: [...new Set(env)], headers: [...new Set(headers)], description };
}

const SKILL_WRITE_TRIES = 3;

export class Setup {
  private readonly opts: SetupOptions;
  /** SETUP-4.1: switches run one at a time: both change `~/.claude/settings.json`. */
  private switching: Promise<unknown> = Promise.resolve();
  constructor(opts: SetupOptions) {
    this.opts = opts;
  }

  private oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.switching.then(fn, fn);
    this.switching = run.catch(() => {});
    return run;
  }

  private get home() {
    return this.opts.home;
  }
  private get settingsFile() {
    return join(this.home, '.claude', 'settings.json');
  }

  /**
   * SETUP-1.8, SETUP-2: a fresh read of everything, never throwing; a failure is an error row. A read
   * while a switch is under way (the tab closed and opened again) waits for it.
   */
  async read(): Promise<SetupSnapshot> {
    await this.switching;
    return this.readNow();
  }

  /** `all`: every scope's plugins, listed once by the caller (SETUP-9.1 reads the project's too). */
  private async readNow(all?: Plugin[]): Promise<SetupSnapshot> {
    const read = new Read();
    const settings = await this.readJson(read, 'skill', this.settingsFile);
    const overrides = new Map(Object.entries(obj(settings?.json.skillOverrides) ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string'));
    const used = new Set<string>();
    const plugins = (all ?? (await this.plugins(read))).filter((p) => p.scope === 'user');
    const skillOff = (name: string, bare: string | null): Pick<SetupItem, 'off' | 'listing'> & { key?: string } => {
      for (const k of bare ? [name, bare] : [name]) {
        const v = overrides.get(k);
        if (v === undefined) continue;
        used.add(k);
        if (v === 'off') return { off: 'override', key: k };
        if (v === 'name-only' || v === 'user-invocable-only') return { off: null, listing: v as SetupListing };
        return { off: null };
      }
      return { off: null };
    };

    await Promise.all([
      // Your Claude Code skills, and claude.ai's under synced/ (SETUP-2.1).
      this.skills(read, join(this.home, '.claude', 'skills'), { harness: 'claude', source: { type: 'yours' }, skip: 'synced', named: (n) => n, off: (n) => skillOff(n, null) }),
      (async () => {
        const synced = join(this.home, '.claude', 'skills', 'synced');
        for (const space of await subdirs(synced).catch((err) => (read.fail('skill', synced, err), [] as string[])))
          await this.skills(read, join(synced, space), { harness: 'claude', source: { type: 'claude-ai' }, named: (n) => `anthropic-skills:${n}`, off: (n) => skillOff(`anthropic-skills:${n}`, n) });
      })(),
      this.agents(read, join(this.home, '.claude', 'agents'), { source: { type: 'yours' }, named: (n) => n, off: null }),
      this.claudeHooks(read, settings),
      this.claudeMcp(read),
      ...plugins.map((p) => this.plugin(read, p, skillOff)),
      this.codex(read),
    ]);

    // SETUP-5.1: an entry that turns off a skill Lookout didn't find on disk.
    for (const [k, v] of overrides)
      if (v === 'off' && !used.has(k))
        read.add(
          { kind: 'skill', harness: 'claude', name: k, description: 'Not found on disk: only its skillOverrides entry', source: { type: 'yours' }, file: this.settingsFile, line: settings ? keyLine(settings.text, ['skillOverrides', k]) : null, off: 'override-missing', overrideKey: k },
          `skill:override:${k}`,
        );
    return { items: read.items, errors: read.errors, readAt: this.opts.now?.() ?? Date.now() };
  }

  /**
   * SETUP-6.5: what one Claude Code Session loaded and what ran in it, from its Transcript (found by
   * its id under `~/.claude/projects`), with what its directory adds (SETUP-9) and Everywhere's
   * items to match what ran against (SETUP-8.2). Never throws: a failure is an error row.
   */
  async readSession(id: string): Promise<SessionSetup> {
    await this.switching;
    const errors: SessionSetupError[] = [];
    let facts: TranscriptFacts | null = null;
    const projects = join(this.home, '.claude', 'projects');
    const file = isSessionId(id) ? await this.transcriptOf(projects, id) : null;
    if (!file) errors.push({ where: 'transcript', kind: null, file: join(projects, '…', `${id}.jsonl`), error: 'no such Transcript' });
    else
      facts = await readTranscript(file).catch((err: unknown) => {
        errors.push({ where: 'transcript', kind: null, file, error: message(err) });
        return null;
      });
    const listed = new Read();
    const plugins = await this.plugins(listed);
    const dir = facts?.cwd ?? null;
    const [everywhere, repo, approved] = await Promise.all([this.readNow(plugins), dir ? this.readRepo(dir, plugins) : new Read(), dir ? this.mcpApproval(dir) : () => null]);
    for (const e of [...listed.errors, ...repo.errors]) errors.push({ where: 'repo', ...e });
    return sessionSetup({ id, home: this.home, facts, errors, everywhere, repo: repo.items, mcpApproved: approved, hookName, now: this.opts.now?.() ?? Date.now() });
  }

  /** SETUP-6.5: `~/.claude/projects/<folder>/<id>.jsonl`, whichever folder holds it. */
  private async transcriptOf(projects: string, id: string): Promise<string | null> {
    const folders = await readdir(projects).catch(() => [] as string[]);
    const found = await Promise.all(folders.map(async (f) => ((await stat(join(projects, f, `${id}.jsonl`)).catch(() => null))?.isFile() ? join(projects, f, `${id}.jsonl`) : null)));
    return found.find((f) => f !== null) ?? null;
  }

  /**
   * SETUP-9.1: what a directory adds to Claude Code: `.claude/skills`, `.claude/commands`,
   * `.claude/agents`, hooks in `.claude/settings.json` and `settings.local.json`, `.mcp.json`, and
   * the plugins installed for it, read as SETUP-2 reads the rest.
   */
  private async readRepo(dir: string, plugins: Plugin[]): Promise<Read> {
    const read = new Read();
    const source: SetupSource = { type: 'repo' };
    const claude = join(dir, '.claude');
    await Promise.all([
      this.skills(read, join(claude, 'skills'), { harness: 'claude', source, named: (n) => n, off: () => null }),
      this.commands(read, join(claude, 'commands')),
      this.agents(read, join(claude, 'agents'), { source, named: (n) => n, off: null }),
      ...['settings.json', 'settings.local.json'].map(async (n) => {
        const file = join(claude, n);
        const settings = await this.readJson(read, 'hook', file);
        if (settings) addHooks(read, hookEntries(settings.json), { harness: 'claude', source, file, text: settings.text });
      }),
      (async () => {
        const file = join(dir, '.mcp.json');
        const config = await this.readJson(read, 'mcp', file);
        if (!config) return;
        for (const [name, raw] of Object.entries(obj(config.json.mcpServers) ?? {})) {
          const c = obj(raw);
          if (c) read.add({ kind: 'mcp', harness: 'claude', name, source, file, line: keyLine(config.text, ['mcpServers', name]), off: null, ...mcpFacts(c) }, `mcp:claude:repo:${name}`);
        }
      })(),
      ...plugins.filter((p) => p.scope !== 'user' && p.projectPath === dir).map((p) => this.plugin(read, p, () => ({ off: null }))),
    ]);
    return read;
  }

  /**
   * SETUP-9.1: a repo's own commands, `.claude/commands/<name>.md` and in its subfolders, called as
   * skills are. A subfolder organizes them and doesn't change the name (`tools/check.md` is `/check`).
   */
  private async commands(read: Read, dir: string) {
    const found: string[] = [];
    const walk = async (at: string, depth: number) => {
      found.push(...(await files(at, '.md')).map((n) => join(at, n)));
      if (depth < 3) for (const sub of await subdirs(at)) await walk(join(at, sub), depth + 1);
    };
    try {
      await walk(dir, 0);
    } catch (err) {
      read.fail('skill', dir, err);
      return;
    }
    await Promise.all(
      found.map(async (file) => {
        try {
          const text = await readText(file);
          if (text === null) return;
          const fm = frontmatter(text);
          const name = basename(file).replace(/\.md$/, '');
          const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
          const description = str(fm.description) ?? body.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) ?? '';
          read.add({ kind: 'skill', harness: 'claude', name, description, source: { type: 'repo' }, file, line: null, off: null, call: [`/${name}`, str(fm['argument-hint'])].filter(Boolean).join(' ') }, `skill:claude:repo:${name}`);
        } catch (err) {
          read.fail('skill', file, err);
        }
      }),
    );
  }

  /**
   * SETUP-9.2: whether an `.mcp.json` server was approved for the directory: `~/.claude.json`'s
   * project entry and the project's settings name the ones turned on and off; null when neither
   * says.
   */
  private async mcpApproval(dir: string): Promise<(name: string) => boolean | null> {
    const read = new Read();
    const [config, ...settings] = await Promise.all([
      this.readJson(read, 'mcp', join(this.home, '.claude.json')),
      this.readJson(read, 'mcp', join(dir, '.claude', 'settings.json')),
      this.readJson(read, 'mcp', join(dir, '.claude', 'settings.local.json')),
    ]);
    const sources = [obj(obj(config?.json.projects)?.[dir]), ...settings.map((s) => s?.json ?? null)].filter((x): x is Record<string, unknown> => x !== null);
    const on = new Set(sources.flatMap((x) => strs(x.enabledMcpjsonServers)));
    const off = new Set(sources.flatMap((x) => strs(x.disabledMcpjsonServers)));
    const all = sources.some((x) => x.enableAllProjectMcpServers === true);
    const known = sources.some((x) => 'enabledMcpjsonServers' in x || 'disabledMcpjsonServers' in x || 'enableAllProjectMcpServers' in x);
    return (name) => (off.has(name) ? false : all || on.has(name) ? true : known ? false : null);
  }

  /** A JSON file and its text; null when it isn't there; an error row when it can't be read. */
  private async readJson(read: Read, kind: SetupKind, file: string): Promise<{ json: Record<string, unknown>; text: string } | null> {
    try {
      const text = await readText(file);
      if (text === null) return null;
      const json = obj(JSON.parse(text));
      if (!json) throw new Error('not a JSON object');
      return { json, text };
    } catch (err) {
      read.fail(kind, file, err);
      return null;
    }
  }

  /** SETUP-2.1: `claude plugin list --json`, every scope; its user scope is what every Session loads. */
  private async plugins(read: Read): Promise<Plugin[]> {
    const bin = await this.opts.claudeBin().catch(() => null);
    if (!bin) return [];
    try {
      const out = await this.opts.runner(bin, ['plugin', 'list', '--json'], { timeoutMs: LIST_TIMEOUT_MS });
      const list: unknown = JSON.parse(out);
      if (!Array.isArray(list)) throw new Error('not a JSON list');
      const seen = new Set<string>();
      const plugins: Plugin[] = [];
      for (const raw of list) {
        const p = obj(raw);
        const id = str(p?.id);
        const installPath = str(p?.installPath);
        const scope = str(p?.scope) ?? 'user';
        const projectPath = str(p?.projectPath);
        const at = `${id}:${scope}:${projectPath ?? ''}`;
        if (!p || !id || !installPath || seen.has(at)) continue;
        seen.add(at);
        plugins.push({ id, name: id.split('@')[0]!, version: str(p.version), enabled: p.enabled !== false, installPath, mcpServers: obj(p.mcpServers) ?? {}, scope, projectPath });
      }
      return plugins.sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      read.fail('skill', 'claude plugin list --json', err);
      return [];
    }
  }

  private async skills(
    read: Read,
    dir: string,
    at: { harness: Harness; source: SetupSource; skip?: string; named(name: string): string; off(name: string): (Pick<SetupItem, 'off' | 'listing'> & { key?: string }) | null; call?(name: string, hint: string | null): string },
  ) {
    let names: string[];
    try {
      names = await subdirs(dir);
    } catch (err) {
      read.fail('skill', dir, err);
      return;
    }
    await Promise.all(
      names
        .filter((n) => n !== at.skip)
        .map(async (n) => {
          const file = join(dir, n, 'SKILL.md');
          try {
            const text = await readText(file);
            if (text === null) return;
            const fm = frontmatter(text);
            const own = str(fm.name) ?? n;
            const name = at.named(own);
            // An unquoted `[issue-number]` is a YAML list; the hint is its text.
            const rawHint = fm['argument-hint'];
            const hint = Array.isArray(rawHint) ? `[${rawHint.map(String).join(', ')}]` : str(rawHint);
            const off = at.off(own);
            read.add(
              {
                kind: 'skill',
                harness: at.harness,
                name,
                description: str(fm.description) ?? '',
                source: at.source,
                file,
                line: null,
                off: off?.off ?? null,
                ...(off?.listing ? { listing: off.listing } : {}),
                ...(off?.key ? { overrideKey: off.key } : {}),
                call: at.call ? at.call(name, hint) : [`/${name}`, hint].filter(Boolean).join(' '),
              },
              `skill:${at.harness}:${sourceKey(at.source)}:${name}`,
            );
          } catch (err) {
            read.fail('skill', file, err);
          }
        }),
    );
  }

  private async agents(read: Read, dir: string, at: { source: SetupSource; named(name: string): string; off: SetupOff | null }) {
    let names: string[];
    try {
      names = await files(dir, '.md');
    } catch (err) {
      read.fail('agent', dir, err);
      return;
    }
    await Promise.all(
      names.map(async (n) => {
        const file = join(dir, n);
        try {
          const text = await readText(file);
          if (text === null) return;
          const fm = frontmatter(text);
          const tools = typeof fm.tools === 'string' ? fm.tools.split(',').map((t) => t.trim()).filter(Boolean) : Array.isArray(fm.tools) ? strs(fm.tools) : null;
          const name = at.named(str(fm.name) ?? n.replace(/\.md$/, ''));
          read.add(
            { kind: 'agent', harness: 'claude', name, description: str(fm.description) ?? '', source: at.source, file, line: null, off: at.off, model: str(fm.model), effort: str(fm.effort), tools },
            `agent:${sourceKey(at.source)}:${name}`,
          );
        } catch (err) {
          read.fail('agent', file, err);
        }
      }),
    );
  }

  private async claudeHooks(read: Read, settings: { json: Record<string, unknown>; text: string } | null) {
    if (!settings) return;
    addHooks(read, hookEntries(settings.json), { harness: 'claude', source: { type: 'yours' }, file: this.settingsFile, text: settings.text });
  }

  private async claudeMcp(read: Read) {
    const file = join(this.home, '.claude.json');
    const config = await this.readJson(read, 'mcp', file);
    if (!config) return;
    const servers = obj(config.json.mcpServers) ?? {};
    for (const [name, raw] of Object.entries(servers)) {
      const c = obj(raw);
      if (!c) continue;
      read.add({ kind: 'mcp', harness: 'claude', name, source: { type: 'yours' }, file, line: keyLine(config.text, ['mcpServers', name]), off: null, ...mcpFacts(c) }, `mcp:claude:yours:${name}`);
    }
  }

  /** SETUP-2.1: a plugin's skills, agents, hooks and MCP servers, all off while it is (SETUP-5.1). */
  private async plugin(read: Read, p: Plugin, skillOff: (name: string, bare: string | null) => Pick<SetupItem, 'off' | 'listing'> & { key?: string }) {
    const source: SetupSource = { type: 'plugin', name: p.name, id: p.id, version: p.version };
    const pluginOff: SetupOff | null = p.enabled ? null : 'plugin';
    await Promise.all([
      this.skills(read, join(p.installPath, 'skills'), { harness: 'claude', source, named: (n) => `${p.name}:${n}`, off: (n) => {
          // Its skillOverrides entry counts as found even while the plugin is what turns it off (SETUP-5.1).
          const own = skillOff(`${p.name}:${n}`, n);
          return pluginOff ? { off: pluginOff } : own;
        },
      }),
      this.agents(read, join(p.installPath, 'agents'), { source, named: (n) => `${p.name}:${n}`, off: pluginOff }),
      (async () => {
        const file = join(p.installPath, 'hooks', 'hooks.json');
        const hooks = await this.readJson(read, 'hook', file);
        if (hooks) addHooks(read, hookEntries(hooks.json), { harness: 'claude', source, file, text: hooks.text, offOf: pluginOff ? () => pluginOff : undefined });
      })(),
      (async () => {
        const names = Object.keys(p.mcpServers);
        if (!names.length) return;
        // Where the servers are declared: the plugin's .mcp.json, else its manifest.
        const candidates = [join(p.installPath, '.mcp.json'), join(p.installPath, '.claude-plugin', 'plugin.json')];
        let file = candidates[0]!;
        let text = '';
        for (const c of candidates) {
          const t = await readText(c).catch(() => null);
          if (t !== null) {
            file = c;
            text = t;
            break;
          }
        }
        for (const name of names) {
          const c = obj(p.mcpServers[name]);
          if (!c) continue;
          read.add({ kind: 'mcp', harness: 'claude', name, source, file, line: text ? (keyLine(text, ['mcpServers', name]) ?? keyLine(text, [name])) : null, off: pluginOff, ...mcpFacts(c) }, `mcp:claude:${p.id}:${name}`);
        }
      })(),
    ]);
  }

  /** SETUP-2.2: Codex's skills, hooks (with their trust) and MCP servers. */
  private async codex(read: Read) {
    const codex = join(this.home, '.codex');
    const configFile = join(codex, 'config.toml');
    let config: Record<string, unknown> | null = null;
    let configText = '';
    /** False when config.toml is there but can't be read: then whether a hook is trusted isn't known. */
    let trustKnown = true;
    try {
      const text = await readText(configFile);
      if (text !== null) {
        configText = text;
        config = parseToml(text) as Record<string, unknown>;
      }
    } catch (err) {
      trustKnown = false;
      read.fail('mcp', configFile, err);
    }
    const codexSkills = { harness: 'codex' as const, source: { type: 'yours' } as SetupSource, named: (n: string) => n, off: () => null, call: (name: string) => `$${name}` };
    const hooksFile = join(codex, 'hooks.json');
    await Promise.all([
      this.skills(read, join(codex, 'skills'), codexSkills),
      this.skills(read, join(this.home, '.agents', 'skills'), codexSkills),
      (async () => {
        const hooks = await this.readJson(read, 'hook', hooksFile);
        if (!hooks) return;
        const state = obj(obj(config?.hooks)?.state) ?? {};
        addHooks(read, hookEntries(hooks.json), {
          harness: 'codex',
          source: { type: 'yours' },
          file: hooksFile,
          text: hooks.text,
          // A hook Codex hasn't been told to trust doesn't run, with no config.toml too; `enabled = false` turns one off.
          offOf: trustKnown
            ? (e) => {
                const s = obj(state[`${hooksFile}:${snake(e.event)}:${e.group}:${e.index}`]);
                if (s?.enabled === false) return 'config';
                return s && str(s.trusted_hash) ? null : 'untrusted';
              }
            : undefined,
        });
      })(),
    ]);
    for (const [name, raw] of Object.entries(obj(config?.mcp_servers) ?? {})) {
      const c = obj(raw);
      if (!c) continue;
      read.add(
        { kind: 'mcp', harness: 'codex', name, source: { type: 'yours' }, file: configFile, line: lineOf(configText, `[mcp_servers.${name}]`) ?? lineOf(configText, `[mcp_servers."${name}"]`), off: c.enabled === false ? 'config' : null, ...mcpFacts(c) },
        `mcp:codex:${name}`,
      );
    }
  }

  /**
   * SETUP-4.1: adds `"<name>": "off"` to `skillOverrides`, or removes the entry, and changes nothing
   * else in the file: its keys keep their order and its indent, written to a temporary file and
   * renamed over it, as Claude Code writes it. A link to the file stays a link: its target is what's
   * written. When the file changes while Lookout writes it, Lookout starts again from what's there.
   */
  async setSkill(name: string, on: boolean): Promise<SetupSnapshot> {
    await this.oneAtATime(() => this.writeSkill(name, on));
    return this.readNow();
  }

  private async writeSkill(name: string, on: boolean) {
    const link = this.settingsFile;
    let file: string;
    try {
      file = await realpath(link);
    } catch (err) {
      if (!isMissing(err)) throw new SetupFailure(`Couldn't read ${link}: ${message(err)}`, 500);
      if ((await lstat(link).catch(() => null))?.isSymbolicLink()) throw new SetupFailure(`${link} links to a file that isn't there, so Lookout won't change it.`, 409);
      file = link;
    }
    for (let attempt = 0; attempt < SKILL_WRITE_TRIES; attempt++) {
      let text: string | null;
      try {
        text = await readText(file);
      } catch (err) {
        throw new SetupFailure(`Couldn't read ${link}: ${message(err)}`, 500);
      }
      let json: Record<string, unknown>;
      try {
        json = obj(JSON.parse(text ?? '{}')) ?? (() => { throw new Error('not a JSON object'); })();
      } catch (err) {
        throw new SetupFailure(`${link} isn't valid JSON (${message(err)}), so Lookout won't change it.`, 409);
      }
      const overrides = { ...(obj(json.skillOverrides) ?? {}) };
      if (on) delete overrides[name];
      else overrides[name] = 'off';
      if (Object.keys(overrides).length) json.skillOverrides = overrides;
      else delete json.skillOverrides;
      const indent = /\n([ \t]+)"/.exec(text ?? '')?.[1] ?? '  ';
      const out = JSON.stringify(json, null, indent) + (text === null || text.endsWith('\n') ? '\n' : '');
      const mode = (await stat(file).catch(() => null))?.mode;
      const tmp = `${file}.lookout-${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, out, { flag: 'wx', ...(mode === undefined ? {} : { mode: mode & 0o777 }) });
        if ((await readText(file)) !== text) {
          await unlink(tmp);
          continue;
        }
        await rename(tmp, file);
        return;
      } catch (err) {
        await unlink(tmp).catch(() => {});
        throw new SetupFailure(`Couldn't write ${link}: ${message(err)}`, 500);
      }
    }
    throw new SetupFailure(`${link} kept changing while Lookout wrote it; try again.`, 409);
  }

  /** SETUP-4.2: `claude plugin enable|disable --scope user <id>`, never an edit of `enabledPlugins`. */
  async setPlugin(id: string, on: boolean): Promise<SetupSnapshot> {
    // In the queue from the start, so a read meanwhile waits for it (SETUP-1.8).
    await this.oneAtATime(async () => {
      const bin = await this.opts.claudeBin().catch(() => null);
      if (!bin) throw new SetupFailure("Claude Code isn't installed, so Lookout can't switch its plugins.", 409);
      try {
        await this.opts.runner(bin, ['plugin', on ? 'enable' : 'disable', '--scope', 'user', id], { timeoutMs: SWITCH_TIMEOUT_MS });
      } catch (err) {
        const e = err as { stderr?: string; stdout?: string };
        // SETUP-2.4: its diagnostic can quote a configuration, so it's scrubbed like an error row.
        const why = scrub((str(e.stderr) ?? str(e.stdout) ?? message(err)).split('\n')[0]!.slice(0, 300));
        throw new SetupFailure(`claude plugin ${on ? 'enable' : 'disable'} ${id} failed: ${why}`, 502);
      }
    });
    return this.readNow();
  }
}
