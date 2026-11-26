import { type BotRun, type BotRunState, type BotView, inFlight } from '@shared/bots.ts';
import { formatAge } from './time';

/** BOT: the Bots tab's words and order. */

/** BOT-1.5: an expanded row lists this many of its runs, the newest. */
export const BOT_RUNS_SHOWN = 5;

/** A run's state, in the Glossary's words (Bot run). */
export const RUN_WORD: Record<BotRunState, string> = { starting: 'starting', running: 'running', waiting: 'waiting on you', finished: 'finished', failed: 'failed' };

/** BOT-1.2: Bots that are on by their next time, soonest first, then those with no time, then Bots that are off; each group by name. */
export function sortBots(bots: readonly BotView[]): BotView[] {
  const group = (b: BotView) => (!b.on ? 2 : b.nextAt !== null ? 0 : 1);
  return [...bots].sort((a, b) => group(a) - group(b) || (group(a) === 0 ? a.nextAt! - b.nextAt! : 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const two = (n: number) => String(n).padStart(2, '0');
const DAY_MS = 86_400_000;

/**
 * BOT-3.6, BOT-1.5: a time as a day and a time of day, in this Mac's time zone: "today 07:30", the
 * day of the week within a week ("Mon 07:30": up to seven days ahead, six back, so a day is never
 * read as another week's), the date beyond ("Nov 16 07:30").
 */
export function dayTime(at: number, now: number): string {
  const d = new Date(at);
  const n = new Date(now);
  // Whole calendar days between the two, whatever a daylight-saving change did to the hours.
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()) / DAY_MS);
  const day = days === 0 ? 'today' : days > -7 && days <= 7 ? DAY_SHORT[d.getDay()]! : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${day} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** BOT-1.2: the one fact a row says about its Bot's runs, and which it is. */
export interface BotFact {
  kind: 'running' | 'waiting' | 'next' | 'ran' | 'failed';
  words: string;
}

/**
 * BOT-1.2: "running" or "waiting on you" while one of its runs is going; else "next Mon 07:30"
 * (BOT-3.6); else, for a Bot with no time ahead, its last run's age: "ran 2d ago", "failed 2d ago".
 * Null for a Bot with no time ahead that never ran. `runs` are newest first, as the server sends them.
 */
export function botFact(bot: BotView, runs: readonly BotRun[], now: number): BotFact | null {
  if (bot.running !== null) {
    const run = runs.find((r) => r.id === bot.running);
    return run?.state === 'waiting' ? { kind: 'waiting', words: RUN_WORD.waiting } : { kind: 'running', words: RUN_WORD.running };
  }
  if (bot.nextAt !== null) return { kind: 'next', words: `next ${dayTime(bot.nextAt, now)}` };
  const last = runs.find((r) => r.botId === bot.id && !inFlight(r));
  if (!last) return null;
  const age = `${formatAge(now - last.startedAt)} ago`;
  return last.state === 'failed' ? { kind: 'failed', words: `failed ${age}` } : { kind: 'ran', words: `ran ${age}` };
}

/** BOT-1.5: a Bot's newest runs, newest first. */
export function botRuns(bot: BotView, runs: readonly BotRun[]): BotRun[] {
  return runs.filter((r) => r.botId === bot.id).slice(0, BOT_RUNS_SHOWN);
}

/** BOT-3.5: what an expanded row says of the times skipped while the Bot's own run was going. */
export const skippedWords = (n: number) => `Skipped ${n} ${n === 1 ? 'time' : 'times'} while it was running`;
