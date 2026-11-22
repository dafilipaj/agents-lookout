import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  SessionFileGroup,
  SessionInstruction,
  SessionMemory,
  SessionNotLoaded,
  SessionRan,
  SessionSetup,
  SessionSetupError,
  SetupItem,
  SetupKind,
  SetupSnapshot,
} from '../shared/setup.ts';
import { type LoadedFile, type TranscriptFacts, mcpToolName } from './setup-transcript.ts';

/**
 * SETUP-6 to SETUP-9, Lookout's rules over what a Transcript recorded: the groups and imports of
 * the instruction files, which changed on disk, the memory index's entries, what ran matched to
 * the items Setup lists, what the repo adds that the Session's lists don't name, and the closing
 * line's counts.
 */

export interface SessionInput {
  id: string;
  home: string;
  facts: TranscriptFacts | null;
  errors: SessionSetupError[];
  everywhere: SetupSnapshot;
  /** SETUP-9.1: what the Session's directory adds, read as SETUP-2 reads the rest. */
  repo: SetupItem[];
  /** SETUP-9.2: whether an `.mcp.json` server was approved for the directory; null when unknown. */
  mcpApproved(name: string): boolean | null;
  /** SETUP-1.6: a hook's name, for one that matches no item. */
  hookName(command: string): string;
  now: number;
}

const inside = (path: string, dir: string) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);

/** SETUP-6.2, 7.1: a path from the repo when inside it, else from `~`. */
export function shownPath(path: string, dir: string | null, home: string): string {
  if (dir && inside(path, dir) && path !== dir) return relative(dir, path);
  if (inside(path, home)) return path === home ? '~' : `~/${relative(home, path)}`;
  return path;
}

const lineCount = (text: string) => (text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0);
const tokens = (text: string) => Math.round(text.length / 4);
const withoutFrontmatter = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
const withoutComments = (text: string) => text.replace(/<!--[\s\S]*?-->/g, '');
/** The loaded text against the disk's: Claude Code drops the last newline, and may drop front matter and comments. */
const sameText = (loaded: string, disk: string) => {
  const a = loaded.trim();
  return disk.trim() === a || withoutFrontmatter(disk).trim() === a || withoutComments(withoutFrontmatter(disk)).trim() === withoutComments(a).trim();
};

/** SETUP-7.2: the `@path` references in a loaded text, resolved from its file's folder (`~/` from home). */
export function importsOf(text: string, file: string, home: string): string[] {
  const out: string[] = [];
  // Not in code: fenced blocks and inline code are dropped first.
  const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const m of prose.matchAll(/(?:^|[\s(])@((?:~\/|\.{1,2}\/|\/)?[\w.-][\w./-]*)/g)) {
    const ref = m[1]!.replace(/[.,;:]+$/, '');
    if (!ref || ref.includes('@')) continue;
    out.push(ref.startsWith('~/') ? join(home, ref.slice(2)) : isAbsolute(ref) ? ref : resolve(dirname(file), ref));
  }
  return out;
}

const GROUP: Record<string, SessionFileGroup | undefined> = { User: 'yours', Project: 'repo', Local: 'repo' };

async function diskState(path: string, text: string): Promise<Pick<SessionInstruction, 'disk' | 'changedAt'>> {
  try {
    const [disk, st] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    return sameText(text, disk) ? { disk: 'same', changedAt: null } : { disk: 'changed', changedAt: st.mtimeMs };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? { disk: 'gone', changedAt: null } : { disk: 'same', changedAt: null };
  }
}

/** SETUP-7.1 to 7.3: the latest load's files, then those loaded later, an import right under its importer. */
async function instructions(facts: TranscriptFacts, dir: string | null, home: string): Promise<SessionInstruction[]> {
  const loaded = [...facts.files.map((f) => ({ f, later: false })), ...facts.later.map((f) => ({ f, later: true }))].filter(({ f }) => GROUP[f.type]);
  const byPath = new Map(loaded.map(({ f }, i) => [f.path, i]));
  const importer = new Map<number, number>();
  const imports = new Map<number, number>();
  loaded.forEach(({ f }, i) => {
    for (const path of importsOf(f.text, f.path, home)) {
      const j = byPath.get(path);
      if (j === undefined || j === i || importer.has(j)) continue;
      importer.set(j, i);
      imports.set(i, (imports.get(i) ?? 0) + 1);
    }
  });
  const order: number[] = [];
  const placed = new Set<number>();
  const place = (i: number) => {
    if (placed.has(i)) return;
    placed.add(i);
    order.push(i);
    loaded.forEach((_, j) => importer.get(j) === i && place(j));
  };
  loaded.forEach((_, i) => !importer.has(i) && place(i));
  // An import cycle has no top: what's left is placed in load order.
  loaded.forEach((_, i) => place(i));
  const key = (i: number) => `file:${loaded[i]!.f.path}`;
  return Promise.all(
    order.map(async (i): Promise<SessionInstruction> => {
      const { f, later } = loaded[i]!;
      const by = importer.get(i);
      return {
        key: key(i),
        path: f.path,
        shown: shownPath(f.path, dir, home),
        group: GROUP[f.type]!,
        importer: by === undefined || !placed.has(by) || order.indexOf(by) > order.indexOf(i) ? null : key(by),
        imports: imports.get(i) ?? 0,
        lines: lineCount(f.text),
        tokens: tokens(f.text),
        loadedAt: f.at,
        later,
        ...(await diskState(f.path, f.text)),
      };
    }),
  );
}

/** SETUP-7.5: the memory index the Session loaded, an entry per `- [Title](file.md)` line, its type from the file's front matter. */
async function memory(files: LoadedFile[]): Promise<SessionMemory | null> {
  const index = files.find((f) => f.type === 'AutoMem');
  if (!index) return null;
  const entries = await Promise.all(
    [...index.text.matchAll(/^\s*[-*]\s*\[([^\]]+)\]\(([^)\s]+)\)/gm)].map(async (m, n) => {
      const file = resolve(dirname(index.path), m[2]!);
      const text = await readFile(file, 'utf8').catch(() => '');
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
      const type = /^(?:\s+)?type:\s*["']?([\w-]+)/m.exec(fm)?.[1] ?? null;
      return { key: `memory:${n}:${m[2]}`, title: m[1]!.trim(), file, type };
    }),
  );
  return { path: index.path, entries, tokens: tokens(index.text) };
}

const RAN_ORDER: readonly SetupKind[] = ['skill', 'agent', 'mcp', 'hook'];

/** The name Claude Code lists an MCP server by: a plugin's is `plugin:<plugin>:<server>`. */
const listedMcpName = (i: SetupItem) => (i.source.type === 'plugin' ? `plugin:${i.source.name}:${i.name}` : i.name);

/** SETUP-8: what ran, by kind in SETUP-8.1's order, the most first, each matched to the item Setup lists. */
function ran(facts: TranscriptFacts, everywhere: SetupItem[], repo: SetupItem[], hookName: (command: string) => string): SessionRan[] {
  const claude = [...repo, ...everywhere.filter((i) => i.harness === 'claude')];
  const find = (kind: SetupKind, test: (i: SetupItem) => boolean) => claude.find((i) => i.kind === kind && test(i)) ?? null;
  const out: SessionRan[] = [];
  const row = (r: Omit<SessionRan, 'failed' | 'events' | 'builtIn' | 'origin'> & Partial<SessionRan>): SessionRan => ({ failed: 0, events: [], builtIn: false, origin: null, ...r });

  // A slash command counts when it names a skill the Session was given, or one Setup lists.
  const skillNames = new Set([...facts.skills, ...claude.filter((i) => i.kind === 'skill').map((i) => i.name)]);
  const skills = new Map(facts.skillCalls);
  for (const [name, n] of facts.slashCommands) if (skillNames.has(name)) skills.set(name, (skills.get(name) ?? 0) + n);
  for (const [name, count] of skills) out.push(row({ key: `ran:skill:${name}`, kind: 'skill', name, count, item: find('skill', (i) => i.name === name) }));

  for (const [name, count] of facts.agentCalls) {
    const item = find('agent', (i) => i.name === name);
    out.push(row({ key: `ran:agent:${name}`, kind: 'agent', name, count, item, builtIn: !item && facts.builtInAgents.has(name) }));
  }

  const listed = new Map([...facts.mcp].map((n) => [mcpToolName(n), n]));
  for (const [server, count] of facts.mcpCalls) {
    const item = find('mcp', (i) => mcpToolName(listedMcpName(i)) === server);
    const name = listed.get(server) ?? server;
    const claudeAi = /^claude\.ai\s+(.+)$/.exec(name);
    out.push(row({ key: `ran:mcp:${server}`, kind: 'mcp', name: item?.name ?? claudeAi?.[1] ?? name, count, item, origin: !item && claudeAi ? 'claude.ai' : null }));
  }

  const hooks = new Map<string, { count: number; failed: number; events: string[] }>();
  for (const r of facts.hookRuns) {
    const h = hooks.get(r.command) ?? { count: 0, failed: 0, events: [] };
    h.count++;
    if (r.failed) h.failed++;
    if (r.event && !h.events.includes(r.event)) h.events.push(r.event);
    hooks.set(r.command, h);
  }
  for (const [command, h] of hooks) {
    const item = find('hook', (i) => i.command === command);
    out.push(row({ key: `ran:hook:${command}`, kind: 'hook', name: item?.name ?? hookName(command), count: h.count, failed: h.failed, events: h.events, item }));
  }
  return out.sort((a, b) => RAN_ORDER.indexOf(a.kind) - RAN_ORDER.indexOf(b.kind) || b.count - a.count || a.name.localeCompare(b.name));
}

/** SETUP-9.2: an item of the repo's the Session's lists don't name, and why when it's known. */
async function notLoaded(facts: TranscriptFacts, repo: SetupItem[], mcpApproved: SessionInput['mcpApproved']): Promise<SessionNotLoaded[]> {
  const loadedAt = facts.loadedAt;
  const mcpListed = new Set([...[...facts.mcp].map(mcpToolName), ...facts.mcpTools]);
  const out: SessionNotLoaded[] = [];
  for (const item of repo) {
    let listed: boolean;
    // A Transcript with no list recorded says nothing about it; an empty list names nothing.
    if (item.kind === 'skill') listed = !facts.skillsListed || facts.skills.has(item.name);
    else if (item.kind === 'agent') listed = !facts.agentsListed || facts.agents.has(item.name);
    // MCP servers are listed only when they give instructions or deferred tools: unlisted counts only while tools are deferred.
    else if (item.kind === 'mcp') listed = mcpListed.has(mcpToolName(listedMcpName(item))) || (!facts.mcpTools.size && mcpApproved(item.name) !== false);
    // Hooks aren't in any list.
    else listed = true;
    if (listed) continue;
    const born = item.source.type === 'repo' && item.kind !== 'mcp' ? await stat(item.file).then((s) => (s.birthtimeMs > 0 ? s.birthtimeMs : s.mtimeMs), () => null) : null;
    if (loadedAt !== null && born !== null && born > loadedAt) out.push({ item, why: { reason: 'added', at: born } });
    else if (item.kind === 'mcp' && item.source.type === 'repo' && mcpApproved(item.name) === false) out.push({ item, why: { reason: 'not-approved' } });
    else out.push({ item, why: { reason: 'not-listed' } });
  }
  return out;
}

/** SETUP-6.3: what the Session's lists named from outside its repo; hooks aren't listed, so they're Everywhere's that are on. */
function everywhereCounts(facts: TranscriptFacts, everywhere: SetupItem[], repo: SetupItem[]): Record<SetupKind, number> {
  const repoNames = (kind: SetupKind) => new Set(repo.filter((i) => i.kind === kind).map((i) => (kind === 'mcp' ? mcpToolName(listedMcpName(i)) : i.name)));
  const skills = repoNames('skill');
  const agents = repoNames('agent');
  const mcp = repoNames('mcp');
  const servers = new Set([...[...facts.mcp].map(mcpToolName), ...facts.mcpTools]);
  return {
    skill: [...facts.skills].filter((n) => !skills.has(n)).length,
    agent: [...facts.agents].filter((n) => !facts.builtInAgents.has(n) && !agents.has(n)).length,
    hook: everywhere.filter((i) => i.kind === 'hook' && i.harness === 'claude' && !i.off).length,
    mcp: [...servers].filter((n) => !mcp.has(n)).length,
  };
}

export async function sessionSetup(input: SessionInput): Promise<SessionSetup> {
  const { facts, home, everywhere } = input;
  const dir = facts?.cwd ?? null;
  const repoListed = facts ? input.repo : [];
  const missing = facts ? await notLoaded(facts, input.repo, input.mcpApproved) : [];
  const out = new Set(missing.map((m) => m.item.key));
  return {
    sessionId: input.id,
    title: facts?.title ?? null,
    directory: dir,
    directoryShown: dir ? shownPath(dir, null, home) : null,
    loadedAt: facts?.loadedAt ?? null,
    instructions: facts ? await instructions(facts, dir, home) : [],
    memory: facts ? await memory(facts.files) : null,
    ran: facts ? ran(facts, everywhere.items, input.repo, input.hookName) : [],
    repo: repoListed.filter((i) => !out.has(i.key)),
    notLoaded: missing,
    everywhere: facts ? everywhereCounts(facts, everywhere.items, input.repo) : { skill: 0, agent: 0, hook: 0, mcp: 0 },
    errors: input.errors,
    readAt: input.now,
  };
}
