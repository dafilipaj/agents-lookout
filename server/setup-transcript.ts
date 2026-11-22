import { createReadStream } from 'node:fs';

/**
 * SETUP-6.5: what a Claude Code Transcript records about what its Session loaded and what ran,
 * read in one pass. Claude Code records each load of the instruction files as an `instructions`
 * attachment (at the start and after each compaction), a subfolder's `CLAUDE.md` loaded later as
 * `nested_memory`, the lists the model was given (`skill_listing`, `agent_listing_delta`,
 * `mcp_instructions_delta`, `deferred_tools_delta`), each hook run (`hook_success`,
 * `hook_non_blocking_error`, `hook_cancelled`), and the tool calls and slash commands. An entry
 * Lookout doesn't know is skipped. A Consequence of 0005: one file on demand, no index.
 */

export interface LoadedFile {
  path: string;
  /** Claude Code's type: `User`, `Project`, `Local`, `AutoMem`, … */
  type: string;
  text: string;
  /** ms */
  at: number;
}

export interface HookRun {
  command: string;
  event: string;
  failed: boolean;
}

export interface TranscriptFacts {
  /** The latest load's files, in Claude Code's order; empty when none was recorded. */
  files: LoadedFile[];
  /** When the latest load happened, ms. */
  loadedAt: number | null;
  /** Files loaded after the latest load (`nested_memory`), in order, the first load of each. */
  later: LoadedFile[];
  /** The directory of the latest load (else the first one recorded). */
  cwd: string | null;
  title: string | null;
  /** The lists the model was given, as of the end of the Transcript. */
  skills: Set<string>;
  agents: Set<string>;
  /** Whether a skill or agent list was recorded at all: an empty one names nothing, a missing one says nothing (SETUP-9.2). */
  skillsListed: boolean;
  agentsListed: boolean;
  builtInAgents: Set<string>;
  /** MCP server names as Claude Code lists them (`plugin:p-kit:tracker`, `claude.ai Docs`). */
  mcp: Set<string>;
  /** Normalized server names with deferred tools left (`mcp__<server>__<tool>`), as added and removed. */
  mcpTools: Set<string>;
  /** Calls across the whole Session (SETUP-8.3). */
  skillCalls: Map<string, number>;
  /** Slash commands typed, by name without the slash; the caller keeps the ones that are skills. */
  slashCommands: Map<string, number>;
  agentCalls: Map<string, number>;
  /** By the server's normalized name in `mcp__<server>__<tool>`. */
  mcpCalls: Map<string, number>;
  hookRuns: HookRun[];
}

const ms = (ts: unknown): number | null => {
  if (typeof ts !== 'string') return null;
  const t = Date.parse(ts);
  return Number.isNaN(t) ? null : t;
};
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

/**
 * What a line must hold to be worth parsing: most lines are messages, tool results and the other
 * tools' calls. One regex, as a list of substrings scanned each line several times over.
 */
const WANTED = /"(?:instructions|nested_memory|skill_listing|agent_listing_delta|mcp_instructions_delta|deferred_tools_delta|hook_[a-z_]+|ai-title|custom-title)"|"name":\s*"(?:Skill|Agent|Task|mcp__[^"]*)"|<command-name>/;
const MCP_TOOL = /^mcp__(.+?)__/;
const COMMAND = /<command-name>\/?([^<\s]+)<\/command-name>/;

export class TranscriptReader {
  readonly facts: TranscriptFacts = {
    files: [],
    loadedAt: null,
    later: [],
    cwd: null,
    title: null,
    skills: new Set(),
    agents: new Set(),
    skillsListed: false,
    agentsListed: false,
    builtInAgents: new Set(),
    mcp: new Set(),
    mcpTools: new Set(),
    skillCalls: new Map(),
    slashCommands: new Map(),
    agentCalls: new Map(),
    mcpCalls: new Map(),
    hookRuns: [],
  };
  private laterSeen = new Set<string>();
  /** Each server's deferred tools, so a server goes when its last tool is removed. */
  private deferred = new Map<string, Set<string>>();
  private customTitle = false;

  /** One line of the Transcript; anything it doesn't know, or can't parse, is skipped. */
  line(text: string) {
    if (!WANTED.test(text)) return;
    let e: Record<string, unknown> | null;
    try {
      e = obj(JSON.parse(text));
    } catch {
      return;
    }
    if (!e) return;
    const f = this.facts;
    if (!f.cwd && typeof e.cwd === 'string') f.cwd = e.cwd;
    const at = ms(e.timestamp);
    if (e.type === 'custom-title' && typeof e.customTitle === 'string') {
      f.title = e.customTitle;
      this.customTitle = true;
    } else if (e.type === 'ai-title' && typeof e.aiTitle === 'string' && !this.customTitle) f.title = e.aiTitle;
    const a = obj(e.attachment);
    if (a) return this.attachment(a, at ?? 0, typeof e.cwd === 'string' ? e.cwd : null);
    const message = obj(e.message);
    if (e.type === 'assistant' && message && Array.isArray(message.content)) {
      for (const raw of message.content) {
        const b = obj(raw);
        if (!b || b.type !== 'tool_use' || typeof b.name !== 'string') continue;
        const input = obj(b.input) ?? {};
        if (b.name === 'Skill' && typeof input.skill === 'string' && input.skill.trim()) bump(f.skillCalls, input.skill.trim().replace(/^\//, ''));
        else if (b.name === 'Agent' || b.name === 'Task') bump(f.agentCalls, typeof input.subagent_type === 'string' && input.subagent_type.trim() ? input.subagent_type.trim() : 'general-purpose');
        else {
          const m = MCP_TOOL.exec(b.name);
          if (m) bump(f.mcpCalls, m[1]!);
        }
      }
    } else if (e.type === 'user' && message) {
      const c = message.content;
      const body = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof obj(x)?.text === 'string' ? (obj(x)!.text as string) : '')).join('\n') : '';
      const m = COMMAND.exec(body);
      if (m) bump(f.slashCommands, m[1]!);
    }
  }

  private attachment(a: Record<string, unknown>, at: number, cwd: string | null) {
    const f = this.facts;
    switch (a.type) {
      case 'instructions': {
        if (!Array.isArray(a.files)) return;
        const files: LoadedFile[] = [];
        for (const raw of a.files) {
          const x = obj(raw);
          if (x && typeof x.path === 'string' && typeof x.type === 'string' && typeof x.content === 'string') files.push({ path: x.path, type: x.type, text: x.content, at });
        }
        // A newer load replaces what the Session works from; what loaded later is dropped with it.
        f.files = files;
        f.loadedAt = at;
        f.later = [];
        this.laterSeen = new Set(files.map((x) => x.path));
        if (cwd) f.cwd = cwd;
        return;
      }
      case 'nested_memory': {
        const c = obj(a.content);
        const path = typeof a.path === 'string' ? a.path : typeof c?.path === 'string' ? c.path : null;
        if (!path || typeof c?.content !== 'string' || this.laterSeen.has(path)) return;
        this.laterSeen.add(path);
        f.later.push({ path, type: typeof c.type === 'string' ? c.type : 'Project', text: c.content, at });
        return;
      }
      case 'skill_listing':
        f.skillsListed = true;
        if (a.isInitial !== false) f.skills.clear();
        for (const n of strs(a.names)) f.skills.add(n);
        return;
      case 'agent_listing_delta':
        f.agentsListed = true;
        if (a.isInitial === true) {
          f.agents.clear();
          f.builtInAgents.clear();
        }
        for (const n of strs(a.addedTypes)) f.agents.add(n);
        for (const n of [...strs(a.builtInTypes), ...strs(a.builtInPluginTypes)]) f.builtInAgents.add(n);
        for (const n of strs(a.removedTypes)) f.agents.delete(n);
        return;
      case 'mcp_instructions_delta':
        for (const n of strs(a.addedNames)) f.mcp.add(n);
        for (const n of strs(a.removedNames)) f.mcp.delete(n);
        return;
      case 'deferred_tools_delta':
        for (const [names, added] of [[strs(a.addedNames), true], [strs(a.removedNames), false]] as const)
          for (const n of names) {
            const server = MCP_TOOL.exec(n)?.[1];
            if (!server) continue;
            const tools = this.deferred.get(server) ?? new Set<string>();
            if (added) tools.add(n);
            else tools.delete(n);
            this.deferred.set(server, tools);
            if (tools.size) f.mcpTools.add(server);
            else f.mcpTools.delete(server);
          }
        return;
      case 'hook_success':
      case 'hook_non_blocking_error':
      case 'hook_blocking_error':
      case 'hook_cancelled': {
        if (typeof a.command !== 'string' || !a.command.trim()) return;
        const event = typeof a.hookEvent === 'string' ? a.hookEvent : typeof a.hookName === 'string' ? a.hookName.split(':')[0]! : '';
        // A blocking error is the hook doing its job (it stopped a tool), not a failure.
        f.hookRuns.push({ command: a.command, event, failed: a.type === 'hook_non_blocking_error' || a.type === 'hook_cancelled' });
        return;
      }
    }
  }
}

/**
 * SETUP-6.5: reads a Transcript in one pass, a chunk at a time, so a big one never sits in memory
 * whole; split by hand, as readline costs more than the reading (0.2 s for 211 MB).
 */
export async function readTranscript(file: string): Promise<TranscriptFacts> {
  const reader = new TranscriptReader();
  let rest = '';
  for await (const chunk of createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 })) {
    const text = rest + (chunk as string);
    let start = 0;
    for (let end = text.indexOf('\n'); end >= 0; end = text.indexOf('\n', start)) {
      reader.line(text.slice(start, end));
      start = end + 1;
    }
    rest = text.slice(start);
  }
  if (rest) reader.line(rest);
  return reader.facts;
}

/** An MCP server's name as Claude Code puts it in its tools' names: `plugin:p-kit:tracker` is `plugin_p-kit_tracker`. */
export const mcpToolName = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, '_');
