import type { Settings } from '@shared/settings.ts';
import type { HarnessOption, LaunchRequest } from '@shared/types.ts';

/** What's typed into the launcher. Lives in App, so closing keeps it (LAUNCH-1.3). */
export type LaunchDraft = LaunchRequest;

export type HarnessState =
  | { state: 'loading' }
  | { state: 'ready'; harnesses: HarnessOption[] }
  | { state: 'error'; error: string };

/** LAUNCH-1.2: start from the last-used Harness, model and directory. */
export function initialDraft(settings: Settings): LaunchDraft {
  const last = settings.lastLaunch;
  const directory =
    last && settings.startDirectories.includes(last.directory) ? last.directory : (settings.startDirectories[0] ?? '');
  return { directory, harness: last?.harness ?? 'claude', model: last?.model ?? '', name: '', prompt: '' };
}

