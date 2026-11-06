import type { SessionRow } from '@shared/types.ts';
import type { WorkSnapshot } from '@shared/work.ts';
import { clockTime } from './chat.ts';
import { location } from './sessions.ts';

/**
 * SIDE-10.3: what a row adds after its name when another live row has the same name: the first of
 * these that isn't the same on all of them.
 */
export type SuffixKind = 'worktree' | 'branch' | 'pr' | 'start';

export interface NameSuffix {
  kind: SuffixKind;
  /** `crm-rates`, `fix/rates`, `#3426`, `from 11:07` (`from 11:07:42` when the minute is shared). */
  text: string;
  /** Its tooltip: what the words are. */
  tip: string;
}

/** WORK-4: each Session's Linked PR, the first in Work's order (Mine, then Review requests); empty until Work's list has loaded. */
export function linkedPrs(work: WorkSnapshot | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!work) return out;
  for (const pr of [...work.prs.mine, ...work.prs.reviewRequests]) {
    for (const s of pr.links?.sessions ?? []) {
      // Linked through a Task, the PR is the Task's, not the Session's.
      if (!s.reason.startsWith('through') && !out.has(s.sessionId)) out.set(s.sessionId, pr.number);
    }
  }
  return out;
}

const seconds = (ts: string | null) => {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

interface Key {
  kind: SuffixKind;
  /** What's compared across the rows. */
  value(row: SessionRow): string | null;
  /** What the row shows, given the group. */
  suffix(row: SessionRow, group: readonly SessionRow[]): NameSuffix | null;
}

function keys(prs: ReadonlyMap<string, number>): Key[] {
  return [
    {
      kind: 'worktree',
      value: (r) => r.git?.worktree ?? null,
      // A row outside a Worktree says where it is instead: its branch.
      suffix: (r) => {
        const loc = location(r);
        return loc ? { kind: 'worktree', text: loc.name, tip: loc.kind === 'worktree' ? `Worktree ${loc.name}` : `Branch ${loc.name}` } : null;
      },
    },
    {
      kind: 'branch',
      value: (r) => r.git?.branch ?? null,
      suffix: (r) => (r.git?.branch ? { kind: 'branch', text: r.git.branch, tip: `Branch ${r.git.branch}` } : null),
    },
    {
      kind: 'pr',
      value: (r) => {
        const n = prs.get(r.id);
        return n === undefined ? null : String(n);
      },
      suffix: (r) => {
        const n = prs.get(r.id);
        return n === undefined ? null : { kind: 'pr', text: `#${n}`, tip: `Linked PR #${n}` };
      },
    },
    {
      kind: 'start',
      value: (r) => seconds(r.procStart),
      suffix: (r, group) => {
        const minute = clockTime(r.procStart);
        if (!minute) return null;
        const shared = group.some((o) => o !== r && clockTime(o.procStart) === minute);
        const at = shared ? (seconds(r.procStart) ?? minute) : minute;
        return { kind: 'start', text: `from ${at}`, tip: `Started ${at}` };
      },
    },
  ];
}

/**
 * SIDE-10.3: the suffix of each live row whose name another live row has too, by the first key
 * that tells all of them apart, else the first whose value isn't the same on all of them (three
 * rows, two in one Worktree: the start time tells all three apart, the Worktree only one). A row
 * with nothing to say for that key gets none.
 */
export function nameSuffixes(rows: readonly SessionRow[], prs: ReadonlyMap<string, number> = new Map()): Map<string, NameSuffix> {
  const byName = new Map<string, SessionRow[]>();
  for (const r of rows) byName.set(r.title, [...(byName.get(r.title) ?? []), r]);
  const out = new Map<string, NameSuffix>();
  const order = keys(prs);
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const kinds = (k: Key) => new Set(group.map(k.value)).size;
    const key = order.find((k) => kinds(k) === group.length) ?? order.find((k) => kinds(k) > 1);
    if (!key) continue;
    for (const r of group) {
      const s = key.suffix(r, group);
      if (s) out.set(r.id, s);
    }
  }
  return out;
}
