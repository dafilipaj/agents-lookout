import type { LastLaunch, Settings } from '@shared/settings.ts';
import type { HarnessOption, LaunchContinues, LaunchRequest } from '@shared/types.ts';

/** What's typed into the launcher. Lives in App, so closing keeps it (LAUNCH-1.3); Work's launcher has its own. */
export type LaunchDraft = Omit<LaunchRequest, 'effort' | 'skipPermissions' | 'continues'> & {
  byHarness?: LastLaunch['byHarness'];
  /** TOPIC-5.1: opened from a Topic view: its Topic stays listed even once archived. */
  fromTopicView?: boolean;
  /** HAND-3.4: a start from a Handover, and the old Session's directory, listed first ('' when unknown). */
  continues?: LaunchContinues & { directory: string };
};

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

