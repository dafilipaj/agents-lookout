import { SETUP_KINDS, type SetupError, type SetupItem, type SetupKind, type SetupOff, type SetupSnapshot, type SetupSource } from '@shared/setup.ts';

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

export const sourceLabel = (s: SetupSource) => (s.type === 'yours' ? 'Yours' : s.type === 'claude-ai' ? 'claude.ai' : s.name);
const sourceId = (s: SetupSource) => (s.type === 'plugin' ? `plugin:${s.id}` : s.type);
const sourceOrder = (s: SetupSource) => (s.type === 'yours' ? 0 : s.type === 'claude-ai' ? 1 : 2);
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
