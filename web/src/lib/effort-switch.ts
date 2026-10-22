import { effortLevels } from '@shared/model.ts';
import type { SessionRow } from '@shared/types.ts';
import type { HarnessState } from '@/lib/launch';
import { shownModel } from '@/lib/model-switch';
import { type MenuOptions, canSwitch, itermWhy, notIdleWhy, restartedWhy, switchingWhy } from '@/lib/status-switch';

/**
 * VIEW-7.4: under the menu's levels, as `/effort <level>` does in the terminal: Claude Code saves
 * `low` to `xhigh` as its default for new Sessions on the model, and keeps `max` for this Session.
 */
export const EFFORT_DEFAULT_NOTE = 'low to xhigh also become the default for new Claude Code Sessions on this model. max is for this Session only.';

/** VIEW-7.3: why the Effort can't open the menu now, for its tooltip. */
export const EFFORT_WHY = { ...notIdleWhy('effort'), switching: switchingWhy('effort') } as const;

/** VIEW-7.2: the tooltip of an Effort that stays plain text in an iTerm tab. */
export const EFFORT_ITERM = itermWhy('effort');

/** VIEW-7.8: the Session's process changed between opening the menu and the pick; nothing is asked. */
export const EFFORT_RESTARTED = restartedWhy('effort');

/** VIEW-7.1: Fleet lists no level for the model (a Fleet before `efforts`): nothing to pick. */
export const NO_LEVELS = 'Fleet lists no levels for this model. Update the Fleet fork.';

/**
 * The Effort the status line shows: one a switch moved it to (VIEW-7.7, `pending`, until the next
 * reply reaches the Transcript), else Fleet's. Null when no Effort is known (VIEW-5.11).
 */
export function shownEffort(row: SessionRow): { level: string; pending: boolean } | null {
  if (row.pendingEffort) return { level: row.pendingEffort.effort, pending: true };
  return row.effort ? { level: row.effort, pending: false } : null;
}

/** VIEW-7.1/7.2: whether the Effort is a menu: a switchable Session (`canSwitch`) whose Effort is known. */
export function canSwitchEffort(row: SessionRow, ended: boolean): boolean {
  return canSwitch(row, ended) && shownEffort(row) !== null;
}

/**
 * VIEW-7.1: the levels Fleet lists for the Session's model (the one the status line shows), each by
 * its bare word, lowest first; every Claude Code level for a model Fleet doesn't list.
 */
export function effortOptions(harnesses: HarnessState, row: SessionRow): MenuOptions {
  if (harnesses.state !== 'ready') return harnesses;
  const claude = harnesses.harnesses.find((h) => h.id === 'claude');
  const levels = effortLevels(claude?.models ?? [], shownModel(row)?.id ?? null);
  if (!levels.length) return { state: 'error', error: NO_LEVELS };
  return { state: 'ready', items: levels.map((level) => ({ value: level, label: level })) };
}

/**
 * VIEW-7.1: whether the shown Effort may not be what the Session runs: a model switch is pending and
 * no Effort switch is newer than it, and Claude Code may have moved the Session to the new model's
 * saved level (unverified on 2.1.308: Known gap under "Switching the Effort").
 */
export function effortUnverified(row: SessionRow): boolean {
  if (!row.pendingModel) return false;
  if (!row.pendingEffort) return true;
  return Date.parse(row.pendingEffort.since) <= Date.parse(row.pendingModel.since);
}

/** VIEW-7.1: the listed level the Session runs; null when it isn't listed, or while it's unverified. */
export function checkedEffort(options: MenuOptions, current: string, unverified = false): string | null {
  if (unverified || options.state !== 'ready') return null;
  return options.items.find((i) => i.value === current)?.value ?? null;
}
