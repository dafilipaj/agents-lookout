import type { Harness, SessionRow, Status } from '@shared/types.ts';

/** The Harnesses' full names, also their marks' accessible names. */
export const HARNESS_NAME: Record<Harness, string> = { claude: 'Claude Code', codex: 'Codex' };

export const STATUS_LABEL: Record<Status, string> = {
  'needs-you': 'Needs you',
  busy: 'Busy',
  idle: 'Idle',
  unknown: 'Unknown',
};

/** VIEW-5.5 (UX): context usage reads normal up to 40%, as a warning above 40%, as danger above 60%. */
export type ContextLevel = 'normal' | 'warning' | 'danger';

export function contextLevel(pct: number): ContextLevel {
  if (pct > 60) return 'danger';
  if (pct > 40) return 'warning';
  return 'normal';
}

/** The text colour for each level: the app's warning and danger tokens, which have light and dark values. */
export const CONTEXT_LEVEL_CLASS: Record<ContextLevel, string | null> = {
  normal: null,
  warning: 'text-needs-you-text',
  danger: 'text-destructive',
};

/** SIDE-3.5: Idle for longer than the threshold. */
export function isLongIdle(row: SessionRow, now: number, thresholdHours: number): boolean {
  return row.status === 'idle' && row.statusSince !== null && now - row.statusSince > thresholdHours * 3_600_000;
}

/** SIDE-5.4: the filter matches title, repo, Worktree or branch. */
export function matchesFilter(row: SessionRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.title, row.git?.repo, row.git?.worktree, row.git?.branch].some((f) => f?.toLowerCase().includes(q));
}

/** Where the Session works, as the row shows it (SIDE-2.2). */
export function location(row: SessionRow): { kind: 'worktree' | 'branch'; name: string } | null {
  if (!row.git) return null;
  if (row.git.worktree) return { kind: 'worktree', name: row.git.worktree };
  if (row.git.branch) return { kind: 'branch', name: row.git.branch };
  return null;
}
