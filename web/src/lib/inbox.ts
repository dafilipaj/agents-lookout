import { type BotRun, holdsWords } from '@shared/bots.ts';
import type { OutputItem, OutputType } from '@shared/library.ts';
import type { HistoryItem, SessionRow } from '@shared/types.ts';
import { CircleHelp, MessageSquareText, TriangleAlert } from 'lucide-react';
import type { ActionId } from './actions.ts';
import { queryWords } from './filter.ts';
import { OUTPUT_ICON, TYPE_LABEL } from './outputs.ts';
import { formatAge } from './time.ts';

/** A row's or a document's icon, as the Library draws its own (LIB-2.2). */
type ReportIcon = (typeof OUTPUT_ICON)[keyof typeof OUTPUT_ICON];

/** INBOX-1.2: a Report's title: its first document's, else its run's name ("Team week · Nov 23"). */
export const reportTitle = (run: Pick<BotRun, 'title' | 'name'>): string => run.title || run.name;

/** INBOX-1.3: every word typed is in the title or the Bot's name, whatever its case. */
export function matchesReport(run: Pick<BotRun, 'title' | 'name' | 'botName'>, query: string): boolean {
  const text = `${reportTitle(run)}\n${run.botName}`.toLowerCase();
  return queryWords(query).every((word) => text.includes(word.toLowerCase()));
}

/** LIB-2.2: an Output's Type as its row and its tab name it: a file's own, else Artifact or Share. */
export const outputType = (item: Pick<OutputItem, 'kind' | 'type'>): keyof typeof TYPE_LABEL | null => (item.kind === 'file' ? item.type : item.kind);

/**
 * INBOX-1.2: a row's icon: a warning triangle for a failed run, a question for one waiting on you,
 * the Library's for its first document's Type, else a reply's.
 */
export function reportIcon(run: Pick<BotRun, 'state' | 'holds'>): ReportIcon {
  if (run.state === 'failed') return TriangleAlert;
  if (run.state === 'waiting') return CircleHelp;
  const type = run.holds?.first ? outputType(run.holds.first) : null;
  return type ? OUTPUT_ICON[type] : MessageSquareText;
}

/** INBOX-1.2: a row's age: how long ago it arrived. */
export const reportAge = (run: Pick<BotRun, 'arrivedAt'>, now: number): string => formatAge(now - (run.arrivedAt ?? now));

/** INBOX-1.2: a row's accessible name: its title, its Bot, what it holds, its age and "unread" when it is. */
export function reportName(run: BotRun, now: number): string {
  return [reportTitle(run), run.botName, holdsWords(run), reportAge(run, now), !run.read && 'unread'].filter(Boolean).join(', ');
}

/** INBOX-2.2: a time as the header says it, in the browser's local time: "Mon 23 Nov, 07:34". */
export function stampWords(at: number): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'short' })}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** INBOX-2.2: a length of time in words: "40 s", "4 min", "1 h 25 min". */
export function spanWords(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${Math.floor(minutes / 60)} h`;
}

/**
 * INBOX-2.2: when the run ended and how long it took ("Mon 23 Nov, 07:34 · took 4 min"), with
 * "started 1 h 25 min late" when it did (BOT-3.3). A run that hasn't ended says when it started.
 */
export function whenWords(run: Pick<BotRun, 'startedAt' | 'endedAt' | 'lateMs'> & Partial<Pick<BotRun, 'session'>>): string {
  const late = run.lateMs > 0 ? `${spanWords(run.lateMs)} late` : null;
  if (run.endedAt === null) return [`started ${stampWords(run.startedAt)}`, late].filter(Boolean).join(' · ');
  // BOT-4.6: a Session Lookout didn't end, because you opened it or the end failed, is said.
  const open = run.session === 'yours' || run.session === 'left' ? 'its Session is still open' : null;
  return [stampWords(run.endedAt), `took ${spanWords(run.endedAt - run.startedAt)}`, late && `started ${late}`, open].filter(Boolean).join(' · ');
}

/** INBOX-2.7: the Session's one action, by what the Session is, as LIB-3.5's. */
export interface SessionAction {
  /** `start`: the run has no Session yet; its start is where its Trust prompt is answered (BOT-4.3). */
  kind: 'open' | 'resume' | 'show' | 'start';
  /** DS-18.6: the table action whose icon it draws. */
  action: ActionId;
  word: string;
}

const SESSION_ACTIONS: Record<SessionAction['kind'], SessionAction> = {
  open: { kind: 'open', action: 'open', word: 'Open Session' },
  resume: { kind: 'resume', action: 'resume', word: 'Resume Session' },
  show: { kind: 'show', action: 'show', word: 'Show Session' },
  start: { kind: 'start', action: 'open', word: 'Open its start' },
};

/**
 * INBOX-2.7: Open Session when it's live, Show Session when History says it can't be resumed
 * (HIST-3.3), else Resume Session. A run still without a Session opens its start; one that never
 * got a Session has none.
 */
export function sessionAction(run: Pick<BotRun, 'sessionId'> & Partial<Pick<BotRun, 'launchId'>>, sessions: ReadonlyMap<string, SessionRow>, session: HistoryItem | null): SessionAction | null {
  // BOT-4.3: a run that waits at its Trust prompt has no Session yet: its start is where it's answered.
  if (run.sessionId === null) return run.launchId ? SESSION_ACTIONS.start : null;
  if (sessions.has(run.sessionId)) return SESSION_ACTIONS.open;
  return session?.blocked ? SESSION_ACTIONS.show : SESSION_ACTIONS.resume;
}

/**
 * INBOX-2.4: how a document shows in place, by its Type: a Markdown file as text, an HTML file as a
 * page in a frame, an image as itself, each from a path; a file that is gone says so; anything
 * else (a PDF, a Share, an Artifact whose source file is gone) is a card with Open.
 */
export type DocumentShown = { as: 'markdown' | 'page' | 'image'; path: string; version: number } | { as: 'gone' } | { as: 'card' };

const IN_PLACE: Partial<Record<OutputType, 'markdown' | 'page' | 'image'>> = { markdown: 'markdown', html: 'page', image: 'image' };

export function documentShown(item: OutputItem): DocumentShown {
  if (item.kind === 'file') {
    if (!item.exists) return { as: 'gone' };
    const as = item.type && IN_PLACE[item.type];
    return as && item.path ? { as, path: item.path, version: item.updatedAt } : { as: 'card' };
  }
  // An Artifact shows its source file by the same rules while that file exists.
  const source = item.kind === 'artifact' && item.source?.exists ? item.source : null;
  const as = source && IN_PLACE[source.type];
  return source && as ? { as, path: source.path, version: source.updatedAt } : { as: 'card' };
}
