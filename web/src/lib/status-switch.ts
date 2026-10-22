import { SaveError } from '@/lib/client';

/** One choice in a status-line menu: its label, and what's shown dimmed beside it (an id). */
export interface MenuItem {
  value: string;
  label: string;
  detail?: string;
}

/** What a status-line menu has to offer: still loading, couldn't be read, or its choices. */
export type MenuOptions = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ready'; items: MenuItem[] };

/** No answer from Lookout's server: the request may have gone through all the same. */
export const SWITCH_LOST = 'Lookout’s server didn’t answer, so Lookout can’t tell whether it switched. Check the terminal.';

/**
 * A setting the status line switches through the server (VIEW-6's model; the Effort beside it
 * works the same way), as App keeps it per Session process, so it outlives viewing another Session:
 * one switch at a time, numbered (`op`), so only the latest one's answer or error lands. Nothing is
 * retried. `error` is why the last one failed, until the shown value changes or you pick again.
 */
export interface SwitchState {
  op: number;
  switching: boolean;
  error: string | null;
}

/**
 * Why a switch failed, for people; `uncertain` when Lookout can't be sure of the outcome (the
 * server says so, or never answered), which opens the Terminal preview (VIEW-6.8).
 */
export function switchFailure(err: unknown): { error: string; uncertain: boolean } {
  const lost = err instanceof SaveError && err.lost;
  const uncertain = lost || (err instanceof SaveError && err.kind === 'uncertain');
  const error = lost ? SWITCH_LOST : err instanceof Error && err.message ? err.message : 'Couldn’t switch it. Check the terminal.';
  return { error, uncertain };
}
