import { sameModel } from '@shared/model.ts';
import type { SessionRow } from '@shared/types.ts';
import {
  CODEX_SESSION_ONLY_NOTE,
  FROM_NEXT_REPLY,
  type MenuOptions,
  canSwitch,
  itermWhy,
  notIdleWhy,
  restartedWhy,
  switchKey,
  switchingWhy,
  SWITCH_RUNNING,
} from '@/lib/status-switch';
import type { HarnessState } from '@/lib/launch';

export { FROM_NEXT_REPLY };

/** VIEW-6.4: under a Claude Code Session's menu, as `/model` does in its terminal. */
export const MODEL_DEFAULT_NOTE = 'Also becomes the default for new Claude Code Sessions.';

/** VIEW-6.4: what the pick does beyond this Session, by its Harness. */
export const modelFootnote = (harness: string) => (harness === 'codex' ? CODEX_SESSION_ONLY_NOTE : MODEL_DEFAULT_NOTE);

/** VIEW-6.5, VIEW-7.5: the Session process a menu was opened on; the pick is for it. */
export type ModelTarget = Pick<SessionRow, 'pid' | 'procStart'>;

/** VIEW-6.3: why the model's name can't open the menu now, for its tooltip. */
export const MODEL_WHY = { ...notIdleWhy('model'), switching: switchingWhy('model') } as const;

/**
 * The model the status line shows: one a switch moved it to (VIEW-6.7, `pending`, until the next
 * reply reaches the Transcript), else Fleet's. Null when no model is known yet.
 */
export function shownModel(row: SessionRow): { id: string; pending: boolean } | null {
  if (row.pendingModel) return { id: row.pendingModel.model, pending: true };
  return row.model ? { id: row.model, pending: false } : null;
}

/** VIEW-6.2: the tooltip of a model that stays plain text in an iTerm tab, beside the model's id. */
export const MODEL_ITERM = itermWhy('model');

/** VIEW-6.7/6.8: a Session process's switch (model or Effort, VIEW-7.3) is kept by its pid and start time. */
export const modelSwitchKey = switchKey;

/** VIEW-6.8: a pick while this tab's switch for the Session is still under way; nothing is asked. */
export const MODEL_RUNNING = SWITCH_RUNNING;

/** VIEW-6.5: the Session's process changed between opening the menu and the pick; nothing is asked. */
export const MODEL_RESTARTED = restartedWhy('model');

/** VIEW-6.1/6.2: whether the model's name is a menu: a switchable Session (`canSwitch`) whose model is known. */
export function canSwitchModel(row: SessionRow, ended: boolean): boolean {
  return canSwitch(row, ended) && shownModel(row) !== null;
}

/** VIEW-6.1: the models Fleet lists for the Session's Harness (LAUNCH-3.2), by label, without its "Default" entry. */
export function modelOptions(harnesses: HarnessState, harness: string): MenuOptions {
  if (harnesses.state !== 'ready') return harnesses;
  const own = harnesses.harnesses.find((h) => h.id === harness);
  return { state: 'ready', items: (own?.models ?? []).filter((m) => m.id !== '').map((m) => ({ value: m.id, label: m.label, detail: m.id })) };
}

/** VIEW-6.1: the listed model the Session runs, a `[1m]` or a date suffix aside; null when it isn't listed. */
export function checkedModel(options: MenuOptions, current: string): string | null {
  if (options.state !== 'ready') return null;
  return options.items.find((i) => sameModel(i.value, current))?.value ?? null;
}
