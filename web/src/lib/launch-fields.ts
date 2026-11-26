import { sameModel } from '@shared/model.ts';
import type { LastLaunch, LaunchChoices, LaunchHarness, Settings } from '@shared/settings.ts';
import type { HarnessModel, HarnessOption } from '@shared/types.ts';
import type { HarnessState } from './launch';

/**
 * The rules of the fields a start is made of: Directory (LAUNCH-2.1), Harness (LAUNCH-3.1), Model
 * with Effort (LAUNCH-3.2, 3.4) and Skip permissions (LAUNCH-3.5). The launcher and the Bot dialog
 * (BOT-2.1) both go by them, and draw the fields from `components/LaunchFields.tsx`.
 */

/** What the fields hold between them. */
export interface LaunchPick {
  directory: string;
  harness: LaunchHarness;
  /** Model id; '' is the Harness's own default. */
  model: string;
  /** Each Harness's Effort and Skip permissions as picked here; a Harness without an entry has the last start's (LAUNCH-3.4, 3.5). */
  byHarness?: LastLaunch['byHarness'];
}

/** What the fields show for a pick, once the rules have had their say. */
export interface LaunchFieldsState {
  /** Fleet's Harnesses; null until they're read. */
  list: HarnessOption[] | null;
  installed(id: LaunchHarness): boolean;
  harness: LaunchHarness;
  models: HarnessModel[];
  model: string;
  /** The chosen model's Effort levels, lowest first; none shows no picker. */
  levels: string[];
  effort: string | null;
  skipPermissions: boolean;
  directory: string;
}

/** LAUNCH-3.4: the Effort a model starts on: the level held when it lists it, else `high`, else its own default. */
export function effortOn(model: HarnessModel | undefined, held: string | null | undefined): string | null {
  return held && model?.efforts.includes(held) ? held : model?.efforts.includes('high') ? 'high' : (model?.defaultEffort ?? null);
}

/**
 * What the fields show for `pick`. `own` is a directory to accept though Settings doesn't list it:
 * the old Session's, for a start from a Handover (HAND-3.4).
 */
export function launchFields(pick: LaunchPick, settings: Pick<Settings, 'startDirectories' | 'lastLaunch'>, harnesses: HarnessState, own: string | null = null): LaunchFieldsState {
  const list = harnesses.state === 'ready' ? harnesses.harnesses : null;
  const installed = (id: LaunchHarness) => !list || list.some((h) => h.id === id && h.installed);
  // A remembered Harness that's no longer installed falls back to one that is.
  const harness: LaunchHarness = installed(pick.harness) ? pick.harness : (list?.find((h) => h.installed)?.id ?? pick.harness);
  const models = list?.find((h) => h.id === harness)?.models ?? [{ id: '', label: 'Default', efforts: [], defaultEffort: null }];
  // HAND-3.1: a Session's own model (`claude-opus-5-5[1m]`, say) picks the listed one it is.
  const model = models.find((m) => m.id === pick.model)?.id ?? models.find((m) => m.id !== '' && pick.model !== '' && sameModel(m.id, pick.model))?.id ?? '';
  const chosen = models.find((m) => m.id === model);
  const held = pick.byHarness?.[harness] ?? settings.lastLaunch?.byHarness?.[harness];
  const directory = settings.startDirectories.includes(pick.directory) || (own !== null && pick.directory === own) ? pick.directory : (settings.startDirectories[0] ?? '');
  return { list, installed, harness, models, model, levels: chosen?.efforts ?? [], effort: effortOn(chosen, held?.effort), skipPermissions: held?.skipPermissions ?? harness === 'claude', directory };
}

/** The pick as the fields show it: what every change to the form keeps, so a fallback you saw is the one that's sent. */
export function shownPick(pick: LaunchPick, f: LaunchFieldsState): LaunchPick {
  return { directory: f.directory, harness: f.harness, model: f.model, byHarness: { ...pick.byHarness, [f.harness]: { effort: f.effort, skipPermissions: f.skipPermissions } } };
}

/** LAUNCH-3.4, 3.5: the chosen Harness's Effort or Skip permissions, changed. */
export function pickChoices(pick: LaunchPick, f: LaunchFieldsState, patch: Partial<LaunchChoices>): Pick<LaunchPick, 'byHarness'> {
  return { byHarness: { ...pick.byHarness, [f.harness]: { effort: f.effort, skipPermissions: f.skipPermissions, ...patch } } };
}

/** LAUNCH-3.4: another model keeps the Effort when it lists it, else `high`, else its own default. */
export function pickModel(pick: LaunchPick, f: LaunchFieldsState, id: string): Pick<LaunchPick, 'model' | 'byHarness'> {
  return { model: id, ...pickChoices(pick, f, { effort: effortOn(f.models.find((m) => m.id === id), f.effort) }) };
}

/** LAUNCH-3.2: another Harness starts on its own default model. */
export const pickHarness = (id: LaunchHarness): Pick<LaunchPick, 'harness' | 'model'> => ({ harness: id, model: '' });
