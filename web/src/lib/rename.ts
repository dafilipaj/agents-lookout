import type { SessionRow } from '@shared/types.ts';
import { SaveError } from '@/lib/client';
import { processKey } from '@/lib/answers';

/** VIEW-5.14: after Fleet answers, how long "Renaming…" waits for the list to show the new title. */
export const RENAME_SETTLE_MS = 5000;

/** VIEW-5.14: Fleet typed the name, but the list still shows the old title. */
export const RENAME_NOT_SHOWN = 'Sent the new name, but the Session doesn’t show it yet.';
/** VIEW-5.14: no answer from Lookout's server: Fleet may have typed it all the same. */
export const RENAME_LOST = 'Lookout’s server didn’t answer, so the Session may have been renamed. Check its title in a moment.';

/** VIEW-5.13: why a live Session's title can't be renamed now, for its tooltip. */
export const RENAME_WHY = {
  busy: 'Rename it once it’s Idle; it’s working now.',
  'needs-you': 'Rename it once it’s Idle; it’s waiting on you now.',
  unknown: 'Lookout can’t tell whether it’s Idle, so it can’t rename it now.',
  otherApp: 'Lookout can’t rename a Session that runs in another app.',
  noId: 'It can be renamed after its first prompt, once it has a session ID.',
} as const;

export type Renaming = { can: true } | { can: false; why: string | null };

/**
 * VIEW-5.12/5.13: whether the header's title renames the Session: only a live, Controllable, Idle
 * one with a session ID (a Codex Session before its first prompt has `<harness>:<pid>` for its id).
 * `why` is for a live one's tooltip; an ended one has none.
 */
export function renaming(row: SessionRow, ended: boolean): Renaming {
  if (ended) return { can: false, why: null };
  if (!row.controllable) return { can: false, why: RENAME_WHY.otherApp };
  if (row.id === processKey(row)) return { can: false, why: RENAME_WHY.noId };
  if (row.status !== 'idle') return { can: false, why: RENAME_WHY[row.status] };
  return { can: true };
}

/** VIEW-5.14: what a failed rename says: the server's reason, or that it may have gone through. */
export function renameFailure(err: unknown): string {
  if (err instanceof SaveError && err.lost) return RENAME_LOST;
  return err instanceof Error && err.message ? err.message : 'Couldn’t rename it. Check the terminal.';
}
