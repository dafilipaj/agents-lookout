import type { Harness, SessionRow, Status } from '@shared/types.ts';

/** The Harnesses' full names, also their marks' accessible names. */
export const HARNESS_NAME: Record<Harness, string> = { claude: 'Claude Code', codex: 'Codex' };

export const STATUS_LABEL: Record<Status, string> = {
  'needs-you': 'Needs you',
  busy: 'Busy',
  idle: 'Idle',
  unknown: 'Unknown',
};

/**
 * Each Status's colour, from the theme's Status tokens (light and dark values in index.css), so a
 * Status has one colour wherever it shows. SIDE-3.6: the sidebar row's strip; Unknown's is dashed,
 * like its marker's ring.
 */
export const STATUS_STRIP_CLASS: Record<Status, string> = {
  'needs-you': 'bg-needs-you',
  busy: 'bg-busy',
  idle: 'bg-idle',
  unknown: 'bg-[repeating-linear-gradient(to_bottom,var(--color-idle)_0_3px,transparent_3px_6px)]',
};

/**
 * SIDE-3.7, 3.9, 3.11: a sidebar row's background at rest, under the pointer and selected, and the
 * colour of its quieter text (the second line, a View only title). On the Needs you tint that text is
 * the foreground at 70%, since `muted-foreground` fell to 3.6:1 on the selected tint in dark mode.
 * Every text on every background here keeps 4.5:1 or more in both modes (sessions.test.ts).
 */
export const ROW_TONE = {
  needsYou: {
    rest: 'bg-needs-you/12',
    hover: 'hover:bg-needs-you/20',
    selected: 'bg-needs-you/26 hover:bg-needs-you/26 ring-needs-you/70',
    quiet: 'text-foreground/70',
  },
  plain: {
    rest: '',
    hover: 'hover:bg-sidebar-accent/60',
    selected: 'bg-sidebar-accent hover:bg-sidebar-accent ring-foreground/15',
    quiet: 'text-muted-foreground',
  },
} as const;

/** SIDE-2.6, VIEW-5.16: the tooltip of an Idle Session's background shell mark. */
export const BACKGROUND_SHELL_TIP = 'A background shell command is still running';

/** VIEW-5.9: the header's Status tag, tinted in its Status's colour with text in its readable shade. */
export const STATUS_TAG_CLASS: Record<Status, string> = {
  'needs-you': 'bg-needs-you-soft text-needs-you-text',
  busy: 'bg-busy-soft text-busy-text',
  idle: 'bg-idle-soft text-idle-text',
  unknown: 'bg-idle-soft text-idle-text',
};

/** VIEW-5.5 (UX): context usage reads normal up to 40%, as a warning above 40%, as danger above 60%. */
export type ContextLevel = 'normal' | 'warning' | 'danger';

export function contextLevel(pct: number): ContextLevel {
  if (pct > 60) return 'danger';
  if (pct > 40) return 'warning';
  return 'normal';
}

/** The text colour for each level: the warning and destructive families (DS-2), which have light and dark values. */
export const CONTEXT_LEVEL_CLASS: Record<ContextLevel, string | null> = {
  normal: null,
  warning: 'text-warning-text',
  danger: 'text-destructive-text',
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
