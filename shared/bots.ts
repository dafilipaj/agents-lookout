import type { OutputItem, OutputType } from './library.ts';
import type { LaunchHarness } from './settings.ts';
import type { HistoryItem } from './types.ts';

/** BOT-3.1: the days of a schedule, Monday first. */
export const BOT_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type BotDay = (typeof BOT_DAYS)[number];

/** BOT-3.1: one or more days of the week and one time of day (`HH:MM`, 24 h) in this Mac's time zone. */
export interface BotSchedule {
  days: BotDay[];
  time: string;
}

/** BOT-2.1: a field's limits. */
export const BOT_NAME_MAX = 64;
export const BOT_PROMPT_MAX = 20_000;
/** BOT-4.8: the newest runs the server keeps. */
export const BOT_RUNS_MAX = 500;
/** BOT-3.2: how often the server looks for Bots that are due. */
export const BOT_TICK_MS = 30_000;
/** BOT-4.4: Idle and not At work for this long, without a break, is finished. */
export const BOT_IDLE_DONE_MS = 2 * 60_000;
/** BOT-2.6: what a second server says, in the tab and when it refuses a change. */
export const BOTS_READ_ONLY = "Another Lookout on this Mac runs the Bots. Here they can't be changed.";
/** INBOX: the last reply kept with a run, at most this many characters. */
export const REPORT_REPLY_MAX = 20_000;
/** INBOX-2.4: a Markdown Report is read up to this many bytes. */
export const REPORT_TEXT_MAX = 1024 * 1024;

/** A Bot: a saved start with a schedule (Glossary). */
export interface Bot {
  id: string;
  name: string;
  prompt: string;
  harness: LaunchHarness;
  /** '' for the Harness's own default. */
  model: string;
  effort: string | null;
  skipPermissions: boolean;
  /** A Start directory, as Settings lists it. */
  directory: string;
  /** null: only by hand. */
  schedule: BotSchedule | null;
  on: boolean;
  /** BOT-3.4: only times after this are ever run: when it was made, last turned on, or last had its schedule changed. */
  since: number;
  /** BOT-3.5: times skipped while its own run was going, since its last run started. */
  skipped: number;
  createdAt: number;
  updatedAt: number;
}

/** What New Bot and Edit send (BOT-2.1). */
export interface BotInput {
  name: string;
  prompt: string;
  harness: LaunchHarness;
  model: string;
  effort?: string | null;
  skipPermissions?: boolean;
  directory: string;
  schedule: BotSchedule | null;
  on?: boolean;
}

/** BOT-4.3 to 4.5. */
export type BotRunState = 'starting' | 'running' | 'waiting' | 'finished' | 'failed';
export const RUN_IN_FLIGHT: readonly BotRunState[] = ['starting', 'running', 'waiting'];
export const inFlight = (run: Pick<BotRun, 'state'>) => RUN_IN_FLIGHT.includes(run.state);

/** INBOX-1.2: what a Report holds, for its row. */
export interface ReportHolds {
  documents: number;
  reply: boolean;
  /** The first document's kind and Type, for the row's icon. */
  first: { kind: OutputItem['kind']; type: OutputType | null } | null;
}

/** A Bot run (Glossary), and the Report it arrives as (INBOX). */
export interface BotRun {
  id: string;
  botId: string;
  /** The Bot's name when the run started. */
  botName: string;
  /** BOT-4.1: the name its Session was started with: the Bot's and the day. */
  name: string;
  /** The scheduled time it ran for; null for Run now. */
  dueAt: number | null;
  startedAt: number;
  /** BOT-3.3: how late a scheduled run started; 0 for one on time or by hand. */
  lateMs: number;
  state: BotRunState;
  sessionId: string | null;
  harness: LaunchHarness;
  /** While it waits on you: what for (SIDE-2.3's words), when Fleet says. */
  waitingFor: string | null;
  endedAt: number | null;
  /** BOT-4.5: why it failed. */
  failure: string | null;
  /** BOT-4.6: what became of its Session: Lookout ended it, you opened it so it's yours, or ending it failed. */
  session: 'ended' | 'yours' | 'left' | null;
  /** INBOX-1.1: when it arrived in the Inbox; null while it hasn't. */
  arrivedAt: number | null;
  /** INBOX-1.2. */
  title: string;
  holds: ReportHolds | null;
  /** INBOX-3.1. */
  read: boolean;
  /** INBOX-4.1. */
  archived: boolean;
  /**
   * BOT-4.3: its start's launch id while it has no Session yet (starting, or waiting at its Trust
   * prompt), so the tab can show that start; null once it has one, or is over.
   */
  launchId: string | null;
}

/** A Bot as the tab shows it. */
export interface BotView extends Bot {
  /** BOT-3.6: its next time; null when off or only by hand. */
  nextAt: number | null;
  /** The id of its run that is starting, running or waiting on you; null for none. */
  running: string | null;
}

/** The whole set, sent to every tab when it changes. */
export interface BotsSnapshot {
  /**
   * BOT-2.3: `unreadable` when `bots.json` can't be read; then nothing can be saved. BOT-2.6:
   * `read-only` on a second server, which shows what the store's owner wrote and changes nothing.
   */
  state: 'ok' | 'unreadable' | 'read-only';
  /** The store's path with the home directory as `~`. */
  path: string;
  error: string | null;
  bots: BotView[];
  /** Newest first. */
  runs: BotRun[];
}

/**
 * INBOX-3.1, 3.2, 4.1: a mark on a Report. `arrivedAt` names the arrival it was made for: when the
 * Report arrived again since (INBOX-1.1), the mark changes nothing.
 */
export interface ReportMark {
  read?: boolean;
  archived?: boolean;
  arrivedAt?: number | null;
}

/** INBOX-2: one Report, read. */
export interface ReportDetail {
  run: BotRun;
  /** INBOX-2.5. */
  reply: string | null;
  /** INBOX-2.3: what its Session produced, the one updated last first. */
  outputs: OutputItem[];
  /** The Library couldn't be read: why, in words; null when it could. */
  outputsError: string | null;
  /**
   * INBOX-2.7: its Session as History knows it (`History.lookup`), so the Session's action says
   * Resume or Show; null for a run that never got a Session, or one History can't find.
   */
  session: HistoryItem | null;
}

const DAY_INDEX: Record<BotDay, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DAY_SHORT: Record<BotDay, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const DAY_PLURAL: Record<BotDay, string> = { mon: 'Mondays', tue: 'Tuesdays', wed: 'Wednesdays', thu: 'Thursdays', fri: 'Fridays', sat: 'Saturdays', sun: 'Sundays' };
const WEEKDAYS: readonly BotDay[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

const TIME = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

/** BOT-3.1: a schedule from anything sent: null for only by hand, or why it's refused. */
export function parseSchedule(input: unknown): { ok: true; schedule: BotSchedule | null } | { ok: false; error: string } {
  if (input === null || input === undefined) return { ok: true, schedule: null };
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'A schedule is days and a time, or nothing.' };
  const { days, time } = input as Record<string, unknown>;
  if (!Array.isArray(days) || days.length === 0) return { ok: false, error: 'Pick at least one day.' };
  if (!days.every((d): d is BotDay => (BOT_DAYS as readonly unknown[]).includes(d))) return { ok: false, error: "That isn't a day of the week." };
  if (typeof time !== 'string' || !TIME.test(time)) return { ok: false, error: 'The time is hours and minutes, like 07:30.' };
  // Each day once, Monday first, whatever order they came in.
  return { ok: true, schedule: { days: BOT_DAYS.filter((d) => days.includes(d)), time } };
}

/** BOT-3.1: a schedule in words. */
export function scheduleWords(schedule: BotSchedule | null): string {
  if (!schedule) return 'Only by hand';
  const days = BOT_DAYS.filter((d) => schedule.days.includes(d));
  const at = `at ${schedule.time}`;
  if (days.length === 7) return `Every day ${at}`;
  if (days.length === 5 && WEEKDAYS.every((d) => days.includes(d))) return `Weekdays ${at}`;
  if (days.length === 1) return `${DAY_PLURAL[days[0]!]} ${at}`;
  return `${days.map((d) => DAY_SHORT[d]).join(', ')} ${at}`;
}

/** A schedule's time on the local day `offset` days from `now`'s; null when that day isn't one of its days. */
function onDay(schedule: BotSchedule, now: number, offset: number): number | null {
  const [, hh, mm] = TIME.exec(schedule.time) ?? [];
  if (hh === undefined || mm === undefined) return null;
  const d = new Date(now);
  // Local calendar fields, so a daylight-saving change moves nothing; a time that day doesn't have rolls to the next one it does.
  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset, Number(hh), Number(mm), 0, 0);
  // The day asked for, not the one a rolled time may land on.
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset, 12).getDay();
  return schedule.days.some((name) => DAY_INDEX[name] === day) ? at.getTime() : null;
}

/** BOT-3.2, 3.3: the latest scheduled time in `(after, now]`; null for none. */
export function dueTime(schedule: BotSchedule | null, after: number, now: number): number | null {
  if (!schedule) return null;
  for (let offset = 0; offset >= -7; offset--) {
    const at = onDay(schedule, now, offset);
    if (at !== null && at <= now) return at > after ? at : null;
  }
  return null;
}

/** BOT-3.6: the next scheduled time after `now`; null for only by hand. */
export function nextTime(schedule: BotSchedule | null, now: number): number | null {
  if (!schedule) return null;
  for (let offset = 0; offset <= 7; offset++) {
    const at = onDay(schedule, now, offset);
    if (at !== null && at > now) return at;
  }
  return null;
}

/** BOT-4.1: a run's name, the Bot's and the day it started ("Team week · Nov 23"). */
export function runName(botName: string, startedAt: number): string {
  const day = new Date(startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${botName} · ${day}`;
}

/** INBOX-1.1: the Reports, newest arrival first: the runs that arrived, archived or not as asked. */
export function reportsOf(runs: readonly BotRun[], archived: boolean): BotRun[] {
  return runs.filter((r) => r.arrivedAt !== null && r.archived === archived).sort((a, b) => b.arrivedAt! - a.arrivedAt!);
}

/** INBOX-3.3: the unread Reports that aren't archived. */
export const unreadReports = (runs: readonly BotRun[]): number => runs.filter((r) => r.arrivedAt !== null && !r.archived && !r.read).length;

/** INBOX-1.2: what a Report holds, in words. */
export function holdsWords(run: Pick<BotRun, 'state' | 'holds'>): string {
  if (run.state === 'failed') return 'failed';
  if (run.state === 'waiting') return 'waiting on you';
  // It waited on you, you answered, and it goes on: the same Report, until it ends.
  if (run.state === 'running' || run.state === 'starting') return 'running';
  const n = run.holds?.documents ?? 0;
  if (n > 0) return n === 1 ? '1 document' : `${n} documents`;
  return run.holds?.reply ? 'a reply' : 'nothing';
}
