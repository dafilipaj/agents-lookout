import type { SessionRow, Status } from '@shared/types.ts';
import { processKey } from '@/lib/answers';
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

/** What the status line switches: VIEW-6's model, or VIEW-7's Effort beside it. */
export type SwitchWhat = 'model' | 'effort';

/** How a sentence names it (the Glossary's Effort is capitalized), and its slash command. */
const NOUN: Readonly<Record<SwitchWhat, string>> = { model: 'model', effort: 'Effort' };
const COMMAND: Readonly<Record<SwitchWhat, string>> = { model: '/model', effort: '/effort' };

/**
 * A switch the status line runs through the server, as App keeps it per Session process, so it
 * outlives viewing another Session: one at a time, model or Effort (VIEW-7.3), numbered (`op`), so
 * only the latest one's answer or error lands. Nothing is retried. `what` is the menu it came from,
 * which reads "Switching…" and shows its error; `error` is why the last one failed, until the
 * shown values change or you pick again from either menu.
 */
export interface SwitchState {
  op: number;
  what: SwitchWhat;
  switching: boolean;
  error: string | null;
}

/**
 * VIEW-6.7/6.8, VIEW-7.7/7.8: a Session process's switch is kept by its pid and start time, so a
 * pid reused by another process never shows an old switch's error.
 */
export const switchKey = (row: Pick<SessionRow, 'harness' | 'pid' | 'procStart'>) => `${processKey(row)}:${row.procStart ?? ''}`;

/** VIEW-6.3, VIEW-7.3: why a menu can't open now, by the Session's Status, for its tooltip. */
export function notIdleWhy(what: SwitchWhat): Readonly<Record<Exclude<Status, 'idle'>, string>> {
  const noun = NOUN[what];
  return {
    busy: `Switch the ${noun} once it’s Idle; it’s working now.`,
    'needs-you': `Switch the ${noun} once it’s Idle; it’s waiting on you now.`,
    unknown: `Lookout can’t tell whether it’s Idle, so it can’t switch the ${noun} now.`,
  };
}

/** VIEW-6.3, VIEW-7.3: a switch of the model or the Effort is under way: both menus wait for it. */
export const switchingWhy = (what: SwitchWhat) => `A switch of its ${NOUN[what]} is under way.`;

/**
 * Why the menu for `what` can't open now (its tooltip), or null when it can: a switch of either
 * runs, or the Session isn't Idle.
 */
export function switchWhy(what: SwitchWhat, status: Status, sw: SwitchState | undefined): string | null {
  if (sw?.switching) return switchingWhy(sw.what);
  return status === 'idle' ? null : notIdleWhy(what)[status];
}

/** VIEW-6.2: the tooltip of a value that stays plain text in an iTerm tab. */
export const itermWhy = (what: SwitchWhat) => `Lookout can’t switch the ${NOUN[what]} of a Session in an iTerm tab. Use ${COMMAND[what]} in its terminal.`;

/** VIEW-6.8: a pick while this tab's switch for the Session is still under way; nothing is asked. */
export const SWITCH_RUNNING = 'A switch for this Session is already under way.';

/** VIEW-6.5: the Session's process changed between opening the menu and the pick; nothing is asked. */
export const restartedWhy = (what: SwitchWhat) => `This Session was restarted since you opened the menu, so the ${NOUN[what]} wasn’t switched.`;

/** VIEW-6.7, VIEW-7.7: after a switched value, until the next reply reaches the Transcript. */
export const FROM_NEXT_REPLY = 'from the next reply';

/**
 * VIEW-6.1/6.2, VIEW-7.1/7.2: whether a Session's model or Effort can be a menu: a live,
 * Controllable Claude Code Session in a tmux pane (where Fleet reads the input box). A Codex
 * Session's, a View only one's, one in an iTerm tab and an ended one's stay plain text.
 */
export function canSwitch(row: SessionRow, ended: boolean): boolean {
  return !ended && row.controllable && row.harness === 'claude' && row.backend === 'tmux';
}

/** VIEW-6.2: why a live Claude Code Session's value stays plain text when it's only its terminal host; null otherwise. */
export function plainWhy(what: SwitchWhat, row: SessionRow, ended: boolean): string | null {
  return !ended && row.controllable && row.harness === 'claude' && row.backend !== 'tmux' ? itermWhy(what) : null;
}

/**
 * Why a switch failed, for people; `uncertain` when Lookout can't be sure of the outcome (the
 * server says so, or never answered), which opens the Terminal preview (VIEW-6.8, VIEW-7.8).
 */
export function switchFailure(err: unknown): { error: string; uncertain: boolean } {
  const lost = err instanceof SaveError && err.lost;
  const uncertain = lost || (err instanceof SaveError && err.kind === 'uncertain');
  const error = lost ? SWITCH_LOST : err instanceof Error && err.message ? err.message : 'Couldn’t switch it. Check the terminal.';
  return { error, uncertain };
}
