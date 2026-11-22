import {
  SETUP_KINDS,
  type SessionInstruction,
  type SessionMemoryEntry,
  type SessionNotLoadedWhy,
  type SessionRan,
  type SessionSetup,
  type SetupError,
  type SetupItem,
  type SetupKind,
  type SetupOff,
  type SetupSnapshot,
  type SetupSource,
  isSessionId,
} from '@shared/setup.ts';
import type { Harness, Status } from '@shared/types.ts';
import { clock } from './evidence';

/**
 * SETUP-1: the Setup tab's list: four sections by kind, each item in its source's group, Yours
 * first, then claude.ai, then each plugin in alphabetical order; what's off at a section's end.
 */

/** SETUP-1.2: the kind filter: All and the four kinds. */
export type SetupFilter = 'all' | SetupKind;
export const SETUP_FILTERS: readonly SetupFilter[] = ['all', ...SETUP_KINDS];
export const SETUP_FILTER_LABEL: Record<SetupFilter, string> = { all: 'All', skill: 'Skills', agent: 'Agents', hook: 'Hooks', mcp: 'MCP' };
export const SECTION_LABEL: Record<SetupKind, string> = { skill: 'Skills', agent: 'Agents', hook: 'Hooks', mcp: 'MCP servers' };

/** SETUP-5.1: why an item is off, in words. */
export const OFF_REASON: Record<SetupOff, string> = {
  override: 'off in skillOverrides',
  'override-missing': 'off in skillOverrides, not found on disk',
  plugin: 'its plugin is off',
  untrusted: 'not trusted in Codex yet',
  config: 'off in config.toml',
};

export const HARNESS_NAME = { claude: 'Claude Code', codex: 'Codex' } as const;

export interface SetupGroup {
  /** Its kind and source: what "open" is remembered by (SETUP-1.4). */
  key: string;
  kind: SetupKind;
  source: SetupSource;
  label: string;
  /** A plugin's version, at the group line's right. */
  version: string | null;
  rows: SetupItem[];
}

export interface SetupSection {
  kind: SetupKind;
  /** SETUP-1.2: its rows that are on (and match the filter). */
  count: number;
  groups: SetupGroup[];
  off: SetupItem[];
  errors: SetupError[];
}

export const sourceLabel = (s: SetupSource) => (s.type === 'yours' ? 'Yours' : s.type === 'claude-ai' ? 'claude.ai' : s.type === 'repo' ? 'This repo' : s.name);
const sourceId = (s: SetupSource) => (s.type === 'plugin' ? `plugin:${s.id}` : s.type);
const sourceOrder = (s: SetupSource) => (s.type === 'repo' ? -1 : s.type === 'yours' ? 0 : s.type === 'claude-ai' ? 1 : 2);
export const groupKey = (kind: SetupKind, source: SetupSource) => `${kind}:${sourceId(source)}`;
/** SETUP-5.1: the off line's key, remembered like a group's. */
export const offKey = (kind: SetupKind) => `${kind}:off`;

/** SETUP-1.5: a description's first line. */
export const firstLine = (text: string) => text.split('\n')[0]!.trim();

/** Where `query` occurs in `text`, ignoring case: `[start, end)` ranges, apart. */
export function matchRanges(text: string, query: string): [number, number][] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const t = text.toLowerCase();
  const out: [number, number][] = [];
  for (let at = t.indexOf(q); at >= 0; at = t.indexOf(q, at + q.length)) out.push([at, at + q.length]);
  return out;
}

/** SETUP-1.2: the text filter matches a row's name and its description. */
export const setupMatches = (item: SetupItem, query: string) => !query.trim() || matchRanges(item.name, query).length > 0 || matchRanges(item.description, query).length > 0;

/**
 * SETUP-1.2 to 1.4, SETUP-5.1: the sections the filter shows, in order. With text in the filter, a
 * section with no match is left out, its errors with it until the filter is cleared.
 */
export function setupSections(snapshot: SetupSnapshot, filter: SetupFilter, query: string): SetupSection[] {
  const kinds = filter === 'all' ? SETUP_KINDS : [filter];
  const q = query.trim();
  const out: SetupSection[] = [];
  for (const kind of kinds) {
    const items = snapshot.items.filter((i) => i.kind === kind && setupMatches(i, q));
    const errors = snapshot.errors.filter((e) => e.kind === kind);
    if (q && !items.length) continue;
    const on = items.filter((i) => !i.off);
    const groups = new Map<string, SetupGroup>();
    for (const item of on) {
      const key = groupKey(kind, item.source);
      const g = groups.get(key) ?? { key, kind, source: item.source, label: sourceLabel(item.source), version: item.source.type === 'plugin' ? item.source.version : null, rows: [] };
      g.rows.push(item);
      groups.set(key, g);
    }
    const byName = (a: SetupItem, b: SetupItem) => a.name.localeCompare(b.name) || a.harness.localeCompare(b.harness);
    for (const g of groups.values()) g.rows.sort(byName);
    out.push({
      kind,
      count: on.length,
      groups: [...groups.values()].sort((a, b) => sourceOrder(a.source) - sourceOrder(b.source) || a.label.localeCompare(b.label)),
      off: items.filter((i) => i.off).sort((a, b) => sourceOrder(a.source) - sourceOrder(b.source) || sourceLabel(a.source).localeCompare(sourceLabel(b.source)) || byName(a, b)),
      errors,
    });
  }
  return out;
}

/** SETUP-4.2: a plugin's items by kind, for the confirmation: "3 skills, 1 agent and 1 hook". */
export function pluginContents(snapshot: SetupSnapshot, id: string): string {
  const nouns: Record<SetupKind, [string, string]> = { skill: ['skill', 'skills'], agent: ['agent', 'agents'], hook: ['hook', 'hooks'], mcp: ['MCP server', 'MCP servers'] };
  const parts = SETUP_KINDS.flatMap((k) => {
    const n = snapshot.items.filter((i) => i.kind === k && i.source.type === 'plugin' && i.source.id === id).length;
    return n ? [`${n} ${nouns[k][n === 1 ? 0 : 1]}`] : [];
  });
  if (!parts.length) return 'nothing Lookout can see';
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** SETUP-6.1: what the tab shows: Everywhere, slice 1's list, or This Session. */
export type SetupView = 'everywhere' | 'session';
export const SETUP_VIEWS: readonly SetupView[] = ['everywhere', 'session'];
export const SETUP_VIEW_LABEL: Record<SetupView, string> = { everywhere: 'Everywhere', session: 'This Session' };

/** SETUP-6.1: the Session open in the main pane, live or past, as This Session follows it. */
export interface SetupSessionTarget {
  id: string;
  harness: Harness;
  /** The main pane's title, which wins over the Transcript's. */
  title: string | null;
  /** A live Session's Status, so a turn's end reads it again (SETUP-6.4); null for a past one. */
  status: Status | null;
}

/** SETUP-6.1: why This Session can't be chosen, or null when it can. */
export function sessionUnavailable(target: SetupSessionTarget | null): string | null {
  if (target?.harness === 'codex') return 'Claude Code Sessions only, for now';
  // A Session without its session id yet has no Transcript to read.
  if (!target || !isSessionId(target.id)) return 'Open a Session to see what it loaded';
  return null;
}

/** SETUP-7.1: a size in tokens, an estimate: "~0.9k tokens", "~40 tokens". */
export const tokensWord = (t: number) => (t < 100 ? `~${t} tokens` : `~${(t / 1000).toFixed(1)}k tokens`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** SETUP-7.1, 7.2: a file row's `meta`: "imports 2 · 48 lines · ~0.9k tokens · loaded at 10:42". */
export function fileMeta(f: SessionInstruction): string {
  return [f.imports ? `imports ${f.imports}` : null, plural(f.lines, 'line'), tokensWord(f.tokens), f.later ? `loaded at ${clock(f.loadedAt)}` : null].filter(Boolean).join(' · ');
}

/** SETUP-7.4: a changed file's summary. */
export const changedSummary = (f: SessionInstruction) =>
  f.changedAt ? `Edited on disk at ${clock(f.changedAt)}, after the Session loaded it at ${clock(f.loadedAt)}. It works from the ${clock(f.loadedAt)} text until it compacts.` : null;

/** SETUP-8.1: a ran row's count: "212×", an MCP server's "9 calls". */
export const ranCount = (r: SessionRan) => (r.kind === 'mcp' ? plural(r.count, 'call') : `${r.count}×`);

/** SETUP-8.1: a ran row's `meta`: its source and, for a hook, its events and failed runs ("Yours · 15 events · 2 failed"). */
export function ranMeta(r: SessionRan): string {
  const source = r.item ? sourceLabel(r.item.source) : r.builtIn ? 'Built into Claude Code' : (r.origin ?? 'Not in Setup');
  const events = r.kind === 'hook' ? (r.item?.events?.length ?? r.events.length) : 0;
  const one = r.kind === 'hook' && events === 1 ? (r.item?.events?.[0]?.event ?? r.events[0]) : null;
  return [source, r.kind === 'hook' ? (one ?? plural(events, 'event')) : null, r.failed ? `${r.failed} failed` : null].filter(Boolean).join(' · ');
}

const KIND_WORD: Record<SetupKind, string> = { skill: 'Skill', agent: 'Agent', hook: 'Hook', mcp: 'MCP' };

/** SETUP-9.1: a repo item's `meta`: its kind and where it's defined ("Skill · .claude/skills", "MCP · .mcp.json · stdio"). */
export function repoMeta(item: SetupItem, directory: string | null): string {
  if (item.source.type === 'plugin') return `${KIND_WORD[item.kind]} · plugin ${item.source.name}`;
  const rel = directory && item.file.startsWith(`${directory}/`) ? item.file.slice(directory.length + 1) : item.file;
  const where = /^\.claude\/(skills|commands|agents)\//.exec(rel)?.[0].slice(0, -1) ?? rel;
  return [KIND_WORD[item.kind], where, item.kind === 'mcp' ? (item.transport ?? 'stdio') : null].filter(Boolean).join(' · ');
}

/** SETUP-9.2: why an item isn't loaded, in words. */
export function notLoadedWhy(why: SessionNotLoadedWhy): string {
  if (why.reason === 'added') return `added at ${clock(why.at)}, after it started`;
  if (why.reason === 'not-approved') return 'not approved for this repo';
  return 'not in its lists';
}

/** One selectable line of This Session: a group's (or the not loaded line), or a row. */
export type SessionRow =
  | { type: 'file'; key: string; file: SessionInstruction; depth: number }
  | { type: 'memory'; key: string; entry: SessionMemoryEntry }
  | { type: 'ran'; key: string; ran: SessionRan }
  | { type: 'item'; key: string; item: SetupItem; why: SessionNotLoadedWhy | null };

export interface SessionGroup {
  key: string;
  icon: 'yours' | 'repo' | 'memory';
  label: string;
  rows: SessionRow[];
}

export interface SessionSection {
  id: 'instructions' | 'memory' | 'ran' | 'repo';
  label: string;
  note: string;
  /** Instructions' and Memory's groups. */
  groups: SessionGroup[];
  /** Ran's kinds, each under a quiet label (SETUP-8.1). */
  kinds: { kind: SetupKind; label: string; rows: SessionRow[] }[];
  /** This repo's own rows, and the ones not loaded (SETUP-9.2). */
  rows: SessionRow[];
  notLoaded: SessionRow[];
}

/** SETUP-7, 9.2: the keys of This Session's groups; its file groups and memory start open, the not loaded line folded. */
export const SESSION_GROUP = { yours: 'session:yours', repo: 'session:repo', memory: 'session:memory', notLoaded: 'session:not-loaded' } as const;
const OPEN_FIRST: ReadonlySet<string> = new Set([SESSION_GROUP.yours, SESSION_GROUP.repo, SESSION_GROUP.memory]);
/** Whether a group shows open: a filter with text opens all; `open` holds the ones toggled from how they start. */
export const groupOpen = (key: string, open: readonly string[], query: string) => !!query.trim() || (OPEN_FIRST.has(key) ? !open.includes(key) : open.includes(key));

const RAN_LABEL: Record<SetupKind, string> = { skill: 'Skills', agent: 'Agents', mcp: 'MCP servers', hook: 'Hooks' };
const RAN_ORDER: readonly SetupKind[] = ['skill', 'agent', 'mcp', 'hook'];

/**
 * SETUP-6.3 to 9: This Session's sections, in order: Instructions, Memory, Ran in this Session and
 * This repo's own, each left out when it has nothing (or, with text in the filter, no match).
 */
export function sessionSections(s: SessionSetup, query: string): SessionSection[] {
  const q = query.trim();
  const hit = (...texts: (string | null | undefined)[]) => !q || texts.some((t) => !!t && matchRanges(t, q).length > 0);
  const empty = { groups: [], kinds: [], rows: [], notLoaded: [] };
  const out: SessionSection[] = [];

  const byKey = new Map(s.instructions.map((f) => [f.key, f]));
  const depth = (f: SessionInstruction) => {
    let d = 0;
    for (let at = f.importer; at && d < 8; at = byKey.get(at)?.importer ?? null) d++;
    return d;
  };
  const files = s.instructions.filter((f) => hit(f.shown));
  if (files.length) {
    const group = (g: 'yours' | 'repo'): SessionGroup[] => {
      const rows = files.filter((f) => f.group === g).map((f): SessionRow => ({ type: 'file', key: f.key, file: f, depth: depth(f) }));
      return rows.length ? [{ key: SESSION_GROUP[g], icon: g, label: g === 'yours' ? 'Yours' : 'This repo', rows }] : [];
    };
    const all = s.instructions;
    out.push({ ...empty, id: 'instructions', label: 'Instructions', note: `${plural(all.length, 'file')} · ${tokensWord(all.reduce((n, f) => n + f.tokens, 0))}`, groups: [...group('yours'), ...group('repo')] });
  }

  const entries = (s.memory?.entries ?? []).filter((e) => hit(e.title, e.type));
  if (s.memory && entries.length) {
    out.push({
      ...empty,
      id: 'memory',
      label: 'Memory',
      note: `${plural(s.memory.entries.length, 'entry', 'entries')} · ${tokensWord(s.memory.tokens)}`,
      groups: [{ key: SESSION_GROUP.memory, icon: 'memory', label: 'MEMORY.md', rows: entries.map((entry): SessionRow => ({ type: 'memory', key: entry.key, entry })) }],
    });
  }

  const ran = s.ran.filter((r) => hit(r.name, r.item?.description));
  if (ran.length) {
    const kinds = RAN_ORDER.map((kind) => ({ kind, label: RAN_LABEL[kind], rows: ran.filter((r) => r.kind === kind).map((r): SessionRow => ({ type: 'ran', key: r.key, ran: r })) })).filter((k) => k.rows.length);
    out.push({ ...empty, id: 'ran', label: 'Ran in this Session', note: String(ran.length), kinds });
  }

  const order = (a: SetupItem, b: SetupItem) => RAN_ORDER.indexOf(a.kind) - RAN_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name);
  const repo = s.repo.filter((i) => hit(i.name, i.description)).sort(order);
  const notLoaded = s.notLoaded.filter((n) => hit(n.item.name, n.item.description)).sort((a, b) => order(a.item, b.item));
  const repoErrors = s.errors.some((e) => e.where === 'repo');
  if (repo.length || notLoaded.length || (!q && repoErrors)) {
    out.push({
      ...empty,
      id: 'repo',
      label: 'This repo’s own',
      note: String(repo.length),
      rows: repo.map((item): SessionRow => ({ type: 'item', key: `repo:${item.key}`, item, why: null })),
      notLoaded: notLoaded.map((n): SessionRow => ({ type: 'item', key: `not-loaded:${n.item.key}`, item: n.item, why: n.why })),
    });
  }
  return out;
}

/** SETUP-6.3: the closing line: "It also loaded 97 skills, 8 agents, 16 hooks and 3 MCP servers from Everywhere". */
export function everywhereLine(counts: Record<SetupKind, number>): string {
  const parts = ([['skill', 'skill'], ['agent', 'agent'], ['hook', 'hook'], ['mcp', 'MCP server']] as const).filter(([k]) => counts[k] > 0).map(([k, word]) => plural(counts[k], word));
  if (!parts.length) return 'What every Session loads is in Everywhere';
  return `It also loaded ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`} from Everywhere`;
}

/** A list line's DOM id, for `aria-activedescendant`. */
export const domId = (key: string) => `setup-${encodeURIComponent(key)}`;

/** SETUP-3.1: the expanded row's facts, by kind. */
export function stateOf(item: SetupItem): string[] {
  const off = item.off ? [OFF_REASON[item.off]] : [];
  switch (item.kind) {
    case 'skill': {
      const s = item.source;
      return [s.type === 'plugin' ? [s.name, s.version].filter(Boolean).join(' ') : sourceLabel(s), HARNESS_NAME[item.harness], ...(item.listing ? [`${item.listing} in skillOverrides`] : []), ...off];
    }
    case 'agent':
      return [item.model ?? 'default model', ...(item.effort ? [`${item.effort} Effort`] : []), item.tools ? `${item.tools.length} ${item.tools.length === 1 ? 'tool' : 'tools'}` : 'all tools', ...off];
    case 'hook': {
      const ev = item.events ?? [];
      return [ev.length === 1 ? [ev[0]!.event, ev[0]!.matcher].filter((x) => x && x !== '*').join(' · ') : `${ev.length} events`, ...(item.timeout ? [`${item.timeout} s`] : []), ...off];
    }
    case 'mcp':
      return [item.transport ?? 'stdio', ...(item.env?.length ? [`${item.env.length} env ${item.env.length === 1 ? 'var' : 'vars'}`] : []), ...(item.headers?.length ? [`${item.headers.length} ${item.headers.length === 1 ? 'header' : 'headers'}`] : []), ...off];
  }
}

/** SETUP-3.1: what the state line's tooltip names, then the file. */
export function tipOf(item: SetupItem): string {
  const where = `${item.file}${item.line ? `:${item.line}` : ''}`;
  const lines: string[] = [];
  if (item.kind === 'agent' && item.tools?.length) lines.push(`Tools: ${item.tools.join(', ')}`);
  if (item.kind === 'hook' && item.events?.length) lines.push(`Events: ${item.events.map((e) => (e.matcher && e.matcher !== '*' ? `${e.event} (${e.matcher})` : e.event)).join(', ')}`);
  if (item.kind === 'mcp' && item.env?.length) lines.push(`Environment: ${item.env.join(', ')}`);
  if (item.kind === 'mcp' && item.headers?.length) lines.push(`Headers: ${item.headers.join(', ')}`);
  return [...lines, where].join('\n');
}
