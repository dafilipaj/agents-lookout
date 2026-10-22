import { sameModel } from '@shared/model.ts';
import type { SessionRow } from '@shared/types.ts';
import { processKey } from '@/lib/answers';
import type { MenuOptions } from '@/lib/status-switch';
import type { HarnessState } from '@/lib/launch';

/** VIEW-6.4: under the menu's models, as `/model` does in the terminal. */
export const MODEL_DEFAULT_NOTE = 'Also becomes the default for new Claude Code Sessions.';
/** VIEW-6.7: after the new model, until the next reply reaches the Transcript. */
export const FROM_NEXT_REPLY = 'from the next reply';

/** VIEW-6.5: the Session process a model menu was opened on; the pick is for it. */
export type ModelTarget = Pick<SessionRow, 'pid' | 'procStart'>;

/** VIEW-6.3: why the model's name can't open the menu now, for its tooltip. */
export const MODEL_WHY = {
  busy: 'Switch the model once it’s Idle; it’s working now.',
  'needs-you': 'Switch the model once it’s Idle; it’s waiting on you now.',
  unknown: 'Lookout can’t tell whether it’s Idle, so it can’t switch the model now.',
  switching: 'A switch of its model is under way.',
} as const;

/**
 * The model the status line shows: one a switch moved it to (VIEW-6.7, `pending`, until the next
 * reply reaches the Transcript), else Fleet's. Null when no model is known yet.
 */
export function shownModel(row: SessionRow): { id: string; pending: boolean } | null {
  if (row.pendingModel) return { id: row.pendingModel.model, pending: true };
  return row.model ? { id: row.model, pending: false } : null;
}

/** VIEW-6.2: the tooltip of a model that stays plain text in an iTerm tab, beside the model's id. */
export const MODEL_ITERM = 'Lookout can’t switch the model of a Session in an iTerm tab. Use /model in its terminal.';

/**
 * VIEW-6.7/6.8: a Session process's model switch is kept by its pid and start time, so a pid reused
 * by another process never shows an old switch's error.
 */
export const modelSwitchKey = (row: Pick<SessionRow, 'harness' | 'pid' | 'procStart'>) => `${processKey(row)}:${row.procStart ?? ''}`;

/** VIEW-6.8: a pick while this tab's switch for the Session is still under way; nothing is asked. */
export const MODEL_RUNNING = 'A switch for this Session is already under way.';

/** VIEW-6.5: the Session's process changed between opening the menu and the pick; nothing is asked. */
export const MODEL_RESTARTED = 'This Session was restarted since you opened the menu, so the model wasn’t switched.';

/**
 * VIEW-6.1/6.2: whether the model's name is a menu: a live, Controllable Claude Code Session in a
 * tmux pane (where Fleet's `model` reads the input box) whose model is known. A Codex Session's, a
 * View only one's, one in an iTerm tab and an ended one's stay plain text.
 */
export function canSwitchModel(row: SessionRow, ended: boolean): boolean {
  return !ended && row.controllable && row.harness === 'claude' && row.backend === 'tmux' && shownModel(row) !== null;
}

/** VIEW-6.2: why a live Claude Code Session's model stays plain text when it's only its terminal host; null otherwise. */
export function plainModelWhy(row: SessionRow, ended: boolean): string | null {
  return !ended && row.controllable && row.harness === 'claude' && row.backend !== 'tmux' ? MODEL_ITERM : null;
}

/** VIEW-6.1: the models Fleet lists for Claude Code (LAUNCH-3.2), by label, without its "Default" entry. */
export function modelOptions(harnesses: HarnessState): MenuOptions {
  if (harnesses.state !== 'ready') return harnesses;
  const claude = harnesses.harnesses.find((h) => h.id === 'claude');
  return { state: 'ready', items: (claude?.models ?? []).filter((m) => m.id !== '').map((m) => ({ value: m.id, label: m.label, detail: m.id })) };
}

/** VIEW-6.1: the listed model the Session runs, a `[1m]` or a date suffix aside; null when it isn't listed. */
export function checkedModel(options: MenuOptions, current: string): string | null {
  if (options.state !== 'ready') return null;
  return options.items.find((i) => sameModel(i.value, current))?.value ?? null;
}
