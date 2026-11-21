import type { EvidenceReviewer, EvidenceRound, EvidenceView, VerdictTone } from '@shared/evidence.ts';
import { clockTime } from './chat';
import { HARNESS_NAME } from './sessions';

/** EVID-5.1, EVID-5.5: a verdict's words in its tone. */
export const TONE_TEXT: Record<VerdictTone, string> = { ok: 'text-ok-text', warning: 'text-warning-text', quiet: 'text-muted-foreground' };

/** A time of day, as the chat shows one ("14:26"). */
export const clock = (ms: number) => clockTime(new Date(ms).toISOString()) ?? '';
/** "2,180" */
export const number = (n: number) => n.toLocaleString('en-US');
/** "1 file", "3 files" */
export const plural = (n: number, one: string, many = `${one}s`) => `${number(n)} ${n === 1 ? one : many}`;

/** EVID-5.5, EVID-6.7: the first two tiles in words, then the rounds, for the Done card's line. */
export function doneFacts(view: EvidenceView): string {
  const tiles = view.lastPass
    ? view.changedSince ? `last pass ${clock(view.lastPass.end)}, ${plural(view.changedSince, 'file')} changed since` : `last pass ${clock(view.lastPass.end)}`
    : view.runCount ? 'no run passed' : '';
  return [tiles, reviewWords(view.rounds ?? [])].filter(Boolean).join(' · ');
}

/** EVID-6.4: the latest finished round (by its end), the latest round (by its start), and a running one. */
export function reviewState(rounds: readonly EvidenceRound[]) {
  const running = rounds.find((r) => r.outcome === 'running') ?? null;
  const finished = rounds.filter((r) => r.outcome === 'finished' && r.end !== null).sort((a, b) => b.end! - a.end!)[0] ?? null;
  return { running, finished, latest: rounds[0] ?? null };
}

/** EVID-6.4: an unfinished round's outcome, capitalised for the tile. */
export const ROUND_VALUE: Record<Exclude<EvidenceRound['outcome'], 'finished' | 'running'>, string> = { failed: 'Failed', 'timed-out': 'Timed out', stopped: 'Stopped', unread: 'Unread' };

/** EVID-6.7: the rounds in words, for the Done card's line. */
export function reviewWords(rounds: readonly EvidenceRound[]): string {
  if (!rounds.length) return 'no review';
  if (rounds.some((r) => r.outcome === 'running')) return 'a review is running';
  const done = rounds.filter((r) => r.outcome === 'finished').length;
  if (done) return done === 1 ? 'reviewed once' : done === 2 ? 'reviewed twice' : `reviewed ${number(done)} times`;
  const words: Record<string, string> = { failed: 'the review failed', 'timed-out': 'the review timed out', stopped: 'the review was stopped', unread: 'the review is unread' };
  return words[rounds[0]!.outcome] ?? 'no review';
}

/** EVID-6.5: a reviewer's words: its Harness, then its model and effort when tb-session gives them; a Subagent and its model, with a count. */
export function reviewerWords(r: EvidenceReviewer): string {
  if (r.kind === 'subagent') return `${['Subagent', r.model].filter(Boolean).join(' · ')}${r.count > 1 ? ` × ${number(r.count)}` : ''}`;
  return [HARNESS_NAME[r.harness], r.model, r.effort].filter(Boolean).join(' · ');
}
