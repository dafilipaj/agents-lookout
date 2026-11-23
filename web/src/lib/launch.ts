import type { LastLaunch, Settings } from '@shared/settings.ts';
import { type Topic, topicPrompt } from '@shared/topics.ts';
import type { HarnessOption, LaunchContinues, LaunchRequest } from '@shared/types.ts';

/** What's typed into the launcher. Lives in App, so closing keeps it (LAUNCH-1.3); Work's launcher has its own. */
export type LaunchDraft = Omit<LaunchRequest, 'effort' | 'skipPermissions' | 'continues'> & {
  byHarness?: LastLaunch['byHarness'];
  /** TOPIC-5.1: opened from a Topic view: its Topic stays listed even once archived. */
  fromTopicView?: boolean;
  /** HAND-3.4: a start from a Handover, and the old Session's directory, listed first ('' when unknown). */
  continues?: LaunchContinues & { directory: string };
  /** TOPIC-15.4: the text the Topic field put at the top of the prompt; absent when it put none. */
  topicText?: string;
};

/**
 * TOPIC-15.4: the prompt after a Topic is picked in the field (null for None): that Topic's prompt
 * (TOPIC-5.1) at the top, with what was there under it after a blank line, in place of what the field
 * put there before. Null when the field leaves the prompt as it is: you changed what it put there,
 * and the prompt isn't empty.
 */
export function topicFill(prompt: string, put: string | undefined, topic: Topic | null): { prompt: string; topicText: string | undefined } | null {
  let rest: string;
  if (!prompt.trim()) rest = '';
  else if (put === undefined) rest = prompt;
  else if (prompt.startsWith(put)) rest = prompt.slice(put.length).replace(/^\n\n?/, '');
  else return null;
  if (!topic) return { prompt: rest, topicText: undefined };
  const text = topicPrompt(topic);
  return { prompt: rest ? `${text}\n\n${rest}` : text, topicText: text };
}

/**
 * TOPIC-16.3: N, ⌘N or "+" while an Open Topic's view shows: that Topic picked in the draft's Topic
 * field, as a pick there does (TOPIC-15.4), unless the draft already has one as the field shows it
 * (`topics`, all of them): a pick of a Topic archived since shows as None, so it counts as none; one
 * deleted shows as "A deleted Topic", so it stays. The same draft when nothing changes.
 */
export function withViewedTopic(draft: LaunchDraft, topic: Topic | null | undefined, topics: readonly Topic[]): LaunchDraft {
  if (!topic || topic.state !== 'open') return draft;
  const held = draft.topic ? topics.find((t) => t.id === draft.topic!.id) : undefined;
  if (draft.topic && (!held || held.state === 'open')) return draft;
  const fill = topicFill(draft.prompt, draft.topicText, topic);
  return { ...draft, topic: { id: topic.id, via: 'topic' }, ...(fill ?? {}) };
}

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

