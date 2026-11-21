import type { EvidenceView, VerdictTone } from '@shared/evidence.ts';
import { clockTime } from './chat';

/** EVID-5.1, EVID-5.5: a verdict's words in its tone. */
export const TONE_TEXT: Record<VerdictTone, string> = { ok: 'text-ok-text', warning: 'text-warning-text', quiet: 'text-muted-foreground' };

/** A time of day, as the chat shows one ("14:26"). */
export const clock = (ms: number) => clockTime(new Date(ms).toISOString()) ?? '';
/** "2,180" */
export const number = (n: number) => n.toLocaleString('en-US');
/** "1 file", "3 files" */
export const plural = (n: number, one: string, many = `${one}s`) => `${number(n)} ${n === 1 ? one : many}`;

/** EVID-5.5: the first two tiles in words, for the Done card's line; empty with no Test run. */
export function doneFacts(view: EvidenceView): string {
  if (view.lastPass) return view.changedSince ? `last pass ${clock(view.lastPass.end)}, ${plural(view.changedSince, 'file')} changed since` : `last pass ${clock(view.lastPass.end)}`;
  return view.runCount ? 'no run passed' : '';
}
