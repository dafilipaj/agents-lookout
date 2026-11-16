import type { SessionRow } from './types.ts';

/** AWAKE-1.1: what you chose. */
export type AwakeMode = 'off' | 'awake' | 'lid';
export const AWAKE_MODES: readonly AwakeMode[] = ['off', 'awake', 'lid'];

/** AWAKE-2.2: how long keep-awake stays on with no Session At work. */
export const IDLE_OFF_MS = 5 * 60_000;
/** AWAKE-3.1: how often the power source is read. */
export const POWER_INTERVAL_MS = 10_000;

/** AWAKE-3.1: why Lid closed can't be chosen now. */
export const LID_NEEDS_CHARGER = 'Needs the charger';
export const LID_NEEDS_APP = 'Needs Amphetamine, from the Mac App Store';
export const LID_NEEDS_HELPER = "Needs Amphetamine's Power Protect helper, from Amphetamine's settings";
/** AWAKE-3.5: macOS refused the Apple event (-1743). */
export const LID_AUTOMATION = "macOS doesn't let Lookout control Amphetamine. Allow it in System Settings, under Privacy & Security, then Automation";
/** AWAKE-3.2: the refusal the corner answers with its dialog. */
export const AMPHETAMINE_BUSY = 'amphetamine-busy';

export interface AwakeNote {
  text: string;
  at: number;
}

export interface AwakeSnapshot {
  mode: AwakeMode;
  /** What holds the Mac now: Lid closed steps down to `awake` on battery or after a failed call (AWAKE-3.4, 3.5). */
  holding: AwakeMode;
  /** AWAKE-2.3: Sessions At work now. */
  atWork: number;
  /** AWAKE-2.3: when the mode turns itself off, while it's on and no Session is At work. */
  offAt: number | null;
  /** AWAKE-3.1, 3.5: whether Lid closed can be chosen, and the line its menu item shows when not, or after a refusal. */
  lid: { available: boolean; reason: string | null };
  /** AWAKE-4.3: the last thing keep-awake did on its own. */
  note: AwakeNote | null;
  /** AWAKE-1.1: one more on each change since the server started; a tab keeps the newest of its events and answers. */
  rev: number;
}

/** The snapshot of a server that holds nothing. */
export const AWAKE_OFF: AwakeSnapshot = { mode: 'off', holding: 'off', atWork: 0, offAt: null, lid: { available: false, reason: LID_NEEDS_CHARGER }, note: null, rev: 0 };

/** AWAKE-2.1: Busy, or a Subagent or background shell command still running, whatever the Status. */
export function isAtWork(row: Pick<SessionRow, 'status' | 'subagents' | 'backgroundShell'>): boolean {
  return row.status === 'busy' || (row.subagents?.running ?? 0) > 0 || row.backgroundShell;
}

export function atWorkCount(rows: readonly Pick<SessionRow, 'status' | 'subagents' | 'backgroundShell'>[]): number {
  return rows.filter(isAtWork).length;
}

/**
 * AWAKE-2.2: 5 minutes after the later of the last moment a Session was At work and the moment the
 * mode was turned on or restored; none while it's off or a Session is At work.
 */
export function offAtFor(mode: AwakeMode, atWork: number, onSince: number, lastAtWork: number | null): number | null {
  if (mode === 'off' || atWork > 0) return null;
  return Math.max(onSince, lastAtWork ?? -Infinity) + IDLE_OFF_MS;
}

/** AWAKE-1.1: `{mode, replace?}`, or null when it isn't one. */
export function parseAwakeRequest(body: unknown): { mode: AwakeMode; replace: boolean } | null {
  if (!body || typeof body !== 'object') return null;
  const { mode, replace } = body as { mode?: unknown; replace?: unknown };
  if (typeof mode !== 'string' || !(AWAKE_MODES as readonly string[]).includes(mode)) return null;
  if (replace !== undefined && typeof replace !== 'boolean') return null;
  return { mode: mode as AwakeMode, replace: replace === true };
}
