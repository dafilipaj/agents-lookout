import type { SessionRow, SubagentItem } from '@shared/types.ts';

/** VIEW-8.6: how far a nested Subagent is indented, at most. */
const MAX_INDENT = 4;

/** One row of the Subagents list, in the order it shows. */
export interface SubagentLine {
  item: SubagentItem;
  /** VIEW-8.6: steps of indentation, one per level of nesting. */
  indent: number;
  /** VIEW-8.6: the title of the Subagent that started it, when that one is listed elsewhere. */
  from: string | null;
}

/** VIEW-8.9: what it was asked, else its type, else its nickname, else "Subagent". */
export function subagentTitle(item: SubagentItem): string {
  return item.task ?? item.type ?? item.name ?? 'Subagent';
}

/** VIEW-8.7: Claude Code's type, or Codex's nickname and its role. */
export function subagentKind(item: SubagentItem): string | null {
  const parts = item.type ? [item.type] : [item.name, item.role];
  const kind = parts.filter((p): p is string => !!p).join(' · ');
  return kind || null;
}

const time = (at: string | null): number | null => {
  const ms = at === null ? NaN : Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
};

/**
 * VIEW-8.6: the running ones, oldest start first, then the finished ones, most recently ended first;
 * a time Fleet didn't give sorts last, then by id. Within each group a Subagent comes right after the
 * one that started it (after that one's earlier children) when that one is in the same group;
 * otherwise it keeps its place and names the one that started it, if listed.
 */
export function subagentLines(items: readonly SubagentItem[]): SubagentLine[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const order = (at: (i: SubagentItem) => number | null, latestFirst: boolean) => (a: SubagentItem, b: SubagentItem) => {
    const x = at(a);
    const y = at(b);
    if (x !== y) {
      if (x === null) return 1;
      if (y === null) return -1;
      return latestFirst ? y - x : x - y;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  const running = items.filter((i) => i.state === 'running').sort(order((i) => time(i.startedAt), false));
  const done = items.filter((i) => i.state !== 'running').sort(order((i) => time(i.endedAt), true));
  const lines: SubagentLine[] = [];
  for (const group of [running, done]) {
    const inGroup = new Set(group.map((i) => i.id));
    const children = new Map<string, SubagentItem[]>();
    for (const i of group) {
      if (i.parent !== null && i.parent !== i.id && inGroup.has(i.parent)) children.set(i.parent, [...(children.get(i.parent) ?? []), i]);
    }
    const placed = new Set<string>();
    const place = (i: SubagentItem) => {
      if (placed.has(i.id)) return;
      placed.add(i.id);
      const parent = i.parent === null ? undefined : byId.get(i.parent);
      const nested = parent !== undefined && inGroup.has(parent.id);
      lines.push({
        item: i,
        indent: Math.min(MAX_INDENT, Math.max(0, (i.depth ?? 1) - 1)),
        from: parent && !nested ? subagentTitle(parent) : null,
      });
      for (const c of children.get(i.id) ?? []) place(c);
    };
    // Roots first, in order; a child whose chain loops back is placed where it stands.
    for (const i of group) if (i.parent === null || !inGroup.has(i.parent) || i.parent === i.id) place(i);
    for (const i of group) place(i);
  }
  return lines;
}

/** VIEW-8.6: how many Subagents the counts have that the list doesn't. */
export function moreSubagents(subagents: NonNullable<SessionRow['subagents']>): number {
  return Math.max(0, subagents.running + subagents.finished - (subagents.items?.length ?? 0));
}

/** VIEW-8.7: `12s`, `3m 12s`, `1h 4m`. */
export function formatRun(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** VIEW-8.7, 8.8: how long it has run (to `now`) or ran; null without a start (VIEW-8.9). */
export function subagentTime(item: SubagentItem, now: number): string | null {
  const start = time(item.startedAt);
  if (start === null) return null;
  const end = item.state === 'running' ? now : time(item.endedAt);
  return end === null ? null : formatRun(end - start);
}

/** VIEW-8.11: a row's accessible name: its title, state and time. */
export function subagentLabel(item: SubagentItem, now: number): string {
  const t = subagentTime(item, now);
  const state = item.state === 'running' ? (t ? `running for ${t}` : 'running') : t ? `${item.state} after ${t}` : item.state;
  return `${subagentTitle(item)}, ${state}`;
}
