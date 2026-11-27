import { randomUUID } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import { homedir, uptime } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, normalize, resolve } from 'node:path';
import { isAtWork } from '../shared/awake.ts';
import {
  BOTS_READ_ONLY, BOT_IDLE_DONE_MS, BOT_NAME_MAX, BOT_PROMPT_MAX, BOT_RUNS_MAX, BOT_TICK_MS, REPORT_REPLY_MAX, REPORT_TEXT_MAX, RUN_IN_FLIGHT,
  type Bot, type BotRun, type BotRunState, type BotSchedule, type BotView, type BotsSnapshot, type ReportDetail, type ReportHolds,
  dueTime, inFlight, nextTime, parseSchedule, runName,
} from '../shared/bots.ts';
import { LIBRARY_TYPES, type LibraryPage, type LibraryQuery, type OutputItem, type OutputType } from '../shared/library.ts';
import type { LaunchHarness } from '../shared/settings.ts';
import type { ChatPage, EndResult, EndTarget, HistoryItem, LaunchView, SessionRow, Status } from '../shared/types.ts';
import { isPlainPath } from './files.ts';
import { readTextFile } from './output-files.ts';
import { SESSION_ID } from './history.ts';
import { LaunchError, MAX_NAME } from './launcher.ts';
import { LibraryError } from './library.ts';

/**
 * BOT-2.3: where the Bots and their runs are kept, next to the Topics. BOT-2.6: `LOOKOUT_BOTS` names
 * another store file, for a server that should run its own Bots beside the installed Lookout.
 */
export const defaultBotsPath = (env: NodeJS.ProcessEnv = process.env) => (env.LOOKOUT_BOTS ? resolve(env.LOOKOUT_BOTS) : join(env.HOME || homedir(), '.lookout', 'bots.json'));

/**
 * BOT-2.6: whether a server may run its store's Bots. The installed Lookout (`pnpm start`) runs its
 * own; one started for development (`pnpm dev`, whatever `NODE_ENV` it inherited) only a store that
 * isn't the default one, which `LOOKOUT_BOTS` names.
 */
export function mayRunBots(env: NodeJS.ProcessEnv = process.env): boolean {
  const development = env.NODE_ENV !== 'production' || !!env.LOOKOUT_DEV_ORIGINS;
  return !development || defaultBotsPath(env) !== defaultBotsPath({ ...env, LOOKOUT_BOTS: undefined });
}

/** BOT-2.6: a store's lock, beside it and named after it: `bots.lock` for `bots.json`. */
export const botsLockPath = (path: string) => join(dirname(path), `${basename(path).replace(/\.json$/i, '')}.lock`);

/** BOT-4.5: why a run failed, apart from the launcher's own reasons. */
export const RUN_ENDED_EARLY = 'Its Session ended before it finished';
export const RUN_RESTARTED = 'Lookout restarted while it was starting';
/** Its start went away without a Session: its Trust prompt was declined, or its failed start was dismissed. */
export const RUN_CANCELLED = 'Its start was cancelled';
/** BOT-4.3: what a run waits for while its start waits at a Trust prompt (LAUNCH-6). */
export const WAITING_FOR_TRUST = 'Trust prompt';
/** BOT-4.2: Run now, while one of that Bot's runs is going. */
export const RUNNING = "It's running";
/** BOT-3.3: a scheduled run that starts more than this after its time says how late it started. */
export const LATE_MS = 60_000;

/** A Bot's or a run's id: the server's are UUIDs; a store written by hand may name them plainly. */
export const BOT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const HARNESSES: readonly string[] = ['claude', 'codex'] satisfies LaunchHarness[];
const STATES: readonly string[] = ['starting', 'running', 'waiting', 'finished', 'failed'] satisfies BotRunState[];
const STATUSES: readonly string[] = ['needs-you', 'busy', 'idle', 'unknown'] satisfies Status[];
const SESSION_FATES: readonly string[] = ['ended', 'yours', 'left'] satisfies NonNullable<BotRun['session']>[];
const OUTPUT_KINDS: readonly string[] = ['file', 'artifact', 'share'] satisfies OutputItem['kind'][];
const OUTPUT_TYPES: readonly string[] = ['markdown', 'html', 'pdf', 'image'] satisfies OutputType[];
/** INBOX-2.3: a Report shows at most this many documents; the Library has the rest. */
export const REPORT_OUTPUTS_MAX = 200;
/** INBOX-2.4: the Markdown files remembered for `text`, oldest out, as the Library's file route keeps its own. */
const MAX_TEXT_PATHS = 10_000;
/** The fields a Bot shares with a start, checked by the launcher's rules (BOT-2.2). */
const START_FIELDS = ['directory', 'harness', 'model', 'effort', 'skipPermissions'] as const;
const INPUT_FIELDS = ['name', 'prompt', 'schedule', 'on', ...START_FIELDS] as const;

/** A refusal with its status and, for a field of the dialog, its name (as `LaunchError`). */
export class BotsError extends Error {
  readonly status: number;
  readonly field: string | null;
  constructor(status: number, message: string, field: string | null = null) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

/** A run as the store keeps it: the run every tab gets, and what only the server follows it by. */
interface StoredRun extends BotRun {
  /** BOT-4.4, 4.5: the Status its Session was last listed in, and whether it was Done then. */
  lastStatus: Status | null;
  lastDone: boolean;
  /** BOT-4.4: since when it has been Idle and not At work without a break; null while it isn't. */
  idleSince: number | null;
  /** BOT-4.4: since when its Session has been Done; null while it isn't. */
  doneSince: number | null;
  /** INBOX-2.5: its Session's last reply, at most REPORT_REPLY_MAX characters. */
  reply: string | null;
  /** BOT-4.6: its Session's process, so one that got its session id later (Codex) is still the one followed. */
  pid: number | null;
  procStart: string | null;
  /** INBOX: the Library couldn't be read when it arrived, so its title and what it holds are read when it's opened. */
  holdsPending: boolean;
  /**
   * PEOPLE-2.6: the file its title was read from, so the title can be taken back without the Library
   * when that file turns private; null when the title is its own name, or a document's with no file.
   * Absent on a run held before this was kept.
   */
  titleFrom?: string | null;
}

interface Fields {
  name: string;
  prompt: string;
  harness: LaunchHarness;
  model: string;
  effort: string | null;
  skipPermissions: boolean;
  directory: string;
  schedule: BotSchedule | null;
  on: boolean;
}

/** A Session's Outputs as the Library gave them, or why it couldn't, in words. */
type Outputs = { items: OutputItem[]; total: number } | string;

export interface BotsOptions {
  /** BOT-2.3: `~/.lookout/bots.json`. */
  path: string;
  /** The home directory the snapshot's path shows as `~`. */
  home?: string;
  /** BOT-4.1, BOT-2.2: a run starts as the launcher starts a Session, and a Bot is checked by its rules. */
  launcher: {
    start(input: unknown, opts?: { remember?: boolean }): Promise<LaunchView>;
    check(input: unknown): Promise<{ directory: string; harness: LaunchHarness; model: string; effort: string | undefined; skipPermissions: boolean }>;
  };
  /** BOT-4.7: Fleet's list is read while a run is going (`watch`), and a Session's row as last listed (`get`). */
  monitor: { watch(): () => void; get(sessionId: string): SessionRow | null };
  /** INBOX: the Outputs a run's Session touched (LIB's `sessions` filter). */
  /** `isPrivate` (PEOPLE-2.5): asked before a Report's Markdown file is read; nothing is private without it. */
  library: { find(q: LibraryQuery): Promise<LibraryPage>; isPrivate?(path: string): Promise<boolean> };
  /** INBOX: a live Session's latest chat entries, through the chat feed's reader; its last reply is read from them. */
  latest(sessionId: string): Promise<ChatPage>;
  /**
   * BOT-4.6: End Session's own way (VIEW-5.6), with the process the row named. `only` is asked of
   * the row as a fresh list shows it, right before the close: false leaves the Session alone.
   */
  end(sessionId: string, target: EndTarget, only: (row: SessionRow) => boolean): Promise<EndResult>;
  /** INBOX-2.7: a run's Session as History knows it; without it a Report names none. */
  history?: { lookup(sessionId: string, harness: LaunchHarness): Promise<HistoryItem> };
  /** SIDE-13.1: when you last saw a Session's chat, as known now (a row carries it as of its last list). */
  viewedAt?(sessionId: string): number | null;
  /** BOT-2.3, INBOX-3.1: the whole set, on every change. */
  onChange(snapshot: BotsSnapshot): void;
  now?: () => number;
  /** BOT-3.2: the 30 s timer; a test passes its own, so nothing sleeps. */
  timer?: { set(tick: () => void, ms: number): unknown; clear(handle: unknown): void };
  /** BOT-2.6: this server's process id, which the store's lock holds, and whether a process is still there. */
  pid?: number;
  /**
   * BOT-2.6: false for a server that must never run this store's Bots (a `pnpm dev` beside the
   * installed Lookout, on the default store): it never takes the lock. True when absent.
   */
  mayOwn?: boolean;
  alive?(pid: number): boolean;
  /** BOT-2.6: when this Mac last started; a lock written before it names a process that is gone, whatever has its number now. */
  bootedAt?(): number;
  /** BOT-2.6: tells a second server that the store's file changed; the returned function stops telling. */
  watchStore?(path: string, changed: () => void): () => void;
  log?: (line: string) => void;
}

/** A process is there when it can be signalled, or when only its owner may (EPERM). */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** When a file was last written; null when it isn't there. */
function writtenAt(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/** A file's time and size, to tell whether it was written since; null when it isn't there. */
function stamp(path: string): string | null {
  try {
    const s = statSync(path);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return null;
  }
}

/** BOT-2.6: a gate left by a server that died while replacing a lock is cleared once it is this old. */
const LOCK_GATE_STALE_MS = 10_000;
/** BOT-2.6: the clock may have been set since this Mac started; a lock counts as from before only when it is older by this much. */
const BOOT_MARGIN_MS = 60_000;

/** BOT-2.6: the store is written whole and renamed into place, which its folder reports; the 30 s look reads it again anyway. */
function watchStoreFile(path: string, changed: () => void): () => void {
  try {
    const name = basename(path);
    const watcher = watch(dirname(path), (_event, file) => {
      if (file === null || file === name) changed();
    });
    watcher.on('error', () => {});
    watcher.unref();
    return () => watcher.close();
  } catch {
    return () => {};
  }
}

const DEFAULT_TIMER: NonNullable<BotsOptions['timer']> = {
  set: (tick, ms) => {
    const t = setInterval(tick, ms);
    t.unref();
    return t;
  },
  clear: (handle) => clearInterval(handle as NodeJS.Timeout),
};

/**
 * BOT, INBOX: the Bots and their runs, in `~/.lookout/bots.json` (`{ version: 1, bots, runs }`,
 * written whole to a temporary file and renamed, mode 0600). It looks every 30 s for Bots that are
 * due, starts a run through the launcher, follows it by the launcher's changes and Fleet's list
 * until it has finished or failed, ends a finished run's Session, and keeps what the run arrives
 * with in the Inbox. A file that can't be read is never written over (BOT-2.3). One server runs a
 * store's Bots, the one holding its lock; any other only shows what that one wrote (BOT-2.6).
 */
export class Bots {
  private bots: Bot[] = [];
  /** Oldest first, as they started. */
  private runs: StoredRun[] = [];
  /** BOT-2.3: why the file can't be read; null while it can (or isn't there). */
  private unreadable: string | null = null;
  /** BOT-2.6: this server holds the store's lock, so it runs the Bots; a second server never writes. */
  private owner = false;
  /** BOT-2.6: the file as last read, so a second server sends the set only when it changed; and its watch of the file. */
  private storeText: string | null = null;
  /** BOT-2.3: the file's time and size as this server last read or wrote it; another's change shows as a difference. */
  private storeStamp: string | null = null;
  private unwatchStore: (() => void) | null = null;
  /** BOT-2.6: why the lock couldn't be written, for the tab; null while it can. Logged once. */
  private lockError: string | null = null;
  /** BOT-2.6: this server wrote the lock that names it; one it only found (its number was another server's once) is stale. */
  private lockWritten = false;
  private handle: unknown = null;
  private stopped = false;
  /** PEOPLE-2.6: the Reports are being read again after a change of what is private, and whether another came meanwhile. */
  private reholding = false;
  private reholdAgain = false;
  private rereadWanted = false;
  /** PEOPLE-2.6: moves on with each such change; Outputs read for a run before it are read again before they name it. */
  private privacyEpoch = 0;
  /** BOT-4.7: the read of Fleet's list held while a run is in flight. */
  private unwatch: (() => void) | null = null;
  /** BOT-2.2: the change to a Bot being checked and saved; the next one waits for it. */
  private editing: Promise<unknown> = Promise.resolve();
  /** Runs whose start hasn't answered yet: the launcher's list may not hold them yet. */
  private readonly starting = new Set<string>();
  /** Runs being finished: their reply and Outputs read, their Session ended. */
  private readonly concluding = new Set<string>();
  /** The starts and finishes under way, for `settled`. */
  private readonly work = new Set<Promise<unknown>>();
  /** INBOX-2.4: the Markdown files a Report's read of the Library listed. */
  private readonly texts = new Set<string>();
  private readonly opts: BotsOptions;
  private readonly now: () => number;
  private readonly home: string;
  private readonly pid: number;

  constructor(opts: BotsOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.home = opts.home ?? homedir();
    this.pid = opts.pid ?? process.pid;
  }

  /**
   * Reads the store, picks up the runs a server before this one left (BOT-4.5, BOT-4.7), and
   * starts looking for Bots that are due (BOT-3.2), at once and then every 30 s.
   */
  start(): void {
    this.stopped = false;
    this.own(this.takeLock());
    this.handle ??= (this.opts.timer ?? DEFAULT_TIMER).set(() => this.tick(), BOT_TICK_MS);
    this.emit();
    this.tick();
  }

  /**
   * The timer stops, Fleet's list is let go and the store's lock is given up (BOT-2.6); a run going
   * is picked up by the next server to run the Bots (BOT-4.7).
   */
  stop(): void {
    this.stopped = true;
    if (this.handle !== null) (this.opts.timer ?? DEFAULT_TIMER).clear(this.handle);
    this.handle = null;
    this.unwatchStore?.();
    this.unwatchStore = null;
    this.syncWatch();
    if (!this.owner) return;
    this.owner = false;
    this.lockWritten = false;
    try {
      if (this.lockHolder() === this.pid) unlinkSync(botsLockPath(this.opts.path));
    } catch {
      // Left behind, it names a process that is gone, and the next server takes it over.
    }
  }

  /** Every start the schedule made has answered and every run being finished has arrived (for tests, which don't sleep). */
  async settled(): Promise<void> {
    while (this.work.size) await Promise.allSettled([...this.work]);
  }

  snapshot(): BotsSnapshot {
    return {
      state: this.unreadable !== null ? 'unreadable' : this.owner ? 'ok' : 'read-only',
      path: this.displayPath(),
      error: this.unreadable ?? (this.owner ? null : this.lockError),
      bots: this.bots.map((b) => this.view(b)),
      runs: this.runs.map(publicRun).reverse(),
    };
  }

  /** BOT-2.1, BOT-2.2: New Bot. `since` is now, so no time that already passed is run (BOT-3.4). */
  async create(input: unknown): Promise<BotView> {
    this.writable();
    const { fields } = await this.fields(input, null);
    const now = this.now();
    const bot: Bot = { id: randomUUID(), ...fields, since: now, skipped: 0, createdAt: now, updatedAt: now };
    this.bots.push(bot);
    if (!this.save()) throw this.unsaved(() => this.bots.splice(this.bots.indexOf(bot), 1));
    this.emit();
    return this.view(bot);
  }

  /**
   * BOT-2.1, BOT-2.5: Edit, Turn off and Turn on: any of a Bot's fields. Turning it on or changing
   * its schedule moves `since` to now (BOT-3.4); turning it off changes nothing else.
   */
  update(id: string, input: unknown): Promise<BotView> {
    // BOT-2.2: one change at a time: each is checked against the Bot as the change before left it,
    // so two tabs can't save a Harness and a model that were never checked together.
    const turn = this.editing.then(() => this.change(id, input));
    this.editing = turn.catch(() => undefined);
    return turn;
  }

  private async change(id: string, input: unknown): Promise<BotView> {
    this.writable();
    const bot = this.bot(id);
    const { fields, given } = await this.fields(input, bot);
    // The check may have asked Fleet for its Harnesses: the Bot could have been deleted meanwhile.
    if (!this.bots.includes(bot)) throw new BotsError(404, NO_BOT);
    const before = { ...bot };
    const now = this.now();
    const patch: Partial<Fields> = {};
    for (const key of given) Object.assign(patch, { [key]: fields[key] });
    const turnedOn = patch.on === true && !bot.on;
    const rescheduled = 'schedule' in patch && JSON.stringify(patch.schedule) !== JSON.stringify(bot.schedule);
    Object.assign(bot, patch, { updatedAt: now });
    if (turnedOn || rescheduled) bot.since = now;
    if (!this.save()) throw this.unsaved(() => Object.assign(bot, before));
    this.emit();
    return this.view(bot);
  }

  /** BOT-2.4: Delete. Refused while one of its runs is going; its runs stay, so its Reports stay in the Inbox. */
  remove(id: string): void {
    this.writable();
    const bot = this.bot(id);
    if (this.running(bot.id)) throw new BotsError(409, `${RUNNING}. Wait for it, or end its Session.`);
    const at = this.bots.indexOf(bot);
    this.bots.splice(at, 1);
    if (!this.save()) throw this.unsaved(() => this.bots.splice(at, 0, bot));
    this.emit();
  }

  /** BOT-4.2: Run now, on or off; refused while one of that Bot's runs is going. Answers once its start has. */
  async runNow(id: string): Promise<BotRun> {
    this.writable();
    const bot = this.bot(id);
    if (this.running(bot.id)) throw new BotsError(409, RUNNING);
    return publicRun(await this.begin(bot, null));
  }

  /**
   * BOT-3.2 to 3.5: one look. A Bot that is on is due at the latest of its times after its floor
   * (`since`, or its last scheduled run's time) and up to now: one run however many were missed.
   * A time that comes while its own run is going is skipped: counted, and the floor moves past it.
   */
  tick(): void {
    if (this.stopped) return;
    // BOT-2.6: one server runs the Bots: the lock is still this one's, or its holder is gone and this one takes over.
    const owns = this.takeLock();
    if (owns !== this.owner) {
      this.own(owns);
      this.emit();
    }
    if (!this.owner) return this.reread();
    if (this.unreadable !== null) {
      // BOT-2.3: a file put right is read again without a restart.
      this.load();
      if (this.unreadable !== null) return;
      this.resume();
      this.emit();
    }
    const now = this.now();
    let skipped = false;
    for (const bot of [...this.bots]) {
      if (!bot.on) continue;
      const due = dueTime(bot.schedule, this.floor(bot), now);
      if (due === null) continue;
      if (this.running(bot.id) || this.goingAt(bot.id, due)) {
        bot.skipped++;
        bot.since = due;
        skipped = true;
      } else this.track(this.begin(bot, due).catch(() => this.log('starting a run failed')));
    }
    if (skipped) this.changed();
  }

  /**
   * BOT-3.5: one of the Bot's runs was going at `time`: it had started by then, and is still going
   * or stopped being so after it. So a time that came during a run that ended before the next look
   * is skipped too.
   */
  private goingAt(botId: string, time: number): boolean {
    return this.runs.some((r) => r.botId === botId && r.startedAt <= time && (inFlight(r) || (r.arrivedAt ?? r.endedAt ?? 0) >= time));
  }

  /**
   * BOT-4.3, BOT-4.5: the launcher's starts changed: a run's start became a Session (`started`),
   * waits at its Trust prompt, waits for Fleet again, failed, or went away.
   */
  launches(launches: readonly LaunchView[], started: readonly { launchId: string; sessionId: string }[]): void {
    if (!this.owner) return;
    let changed = false;
    for (const run of this.runs) {
      if (!inFlight(run) || run.sessionId !== null || run.launchId === null) continue;
      const became = started.find((s) => s.launchId === run.launchId);
      if (became) {
        run.sessionId = became.sessionId;
        run.state = 'running';
        run.waitingFor = null;
        changed = true;
        continue;
      }
      const launch = launches.find((l) => l.id === run.launchId);
      if (launch) changed = this.followLaunch(run, launch) || changed;
      else if (!this.starting.has(run.id)) {
        this.failNow(run, RUN_CANCELLED);
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  /**
   * BOT-4.3 to 4.5: after every list of Fleet's: each run's Session by its id, or by its process
   * once the id changed (a Codex Session gets its session id after its first prompt).
   */
  observe(rows: readonly SessionRow[]): void {
    if (!this.owner) return;
    const now = this.now();
    let stored = false;
    let shown = false;
    for (const run of this.runs) {
      if (!inFlight(run) || run.sessionId === null || this.concluding.has(run.id)) continue;
      const byId = rows.find((r) => r.id === run.sessionId && r.harness === run.harness);
      // BOT-4.6: its Session's id under another process is a Session someone resumed, not the run's: the run's own has ended.
      const row = (byId && !replaced(run, byId) ? byId : undefined) ?? rows.find((r) => sameProcess(run, r));
      if (!row) {
        // BOT-4.4, 4.5: it ended: finished when it was last seen Idle or Done, failed when Busy or Needing you.
        this.conclude(run, run.lastDone || run.lastStatus === 'idle' ? null : RUN_ENDED_EARLY);
        continue;
      }
      const was = JSON.stringify(run);
      const wasShown = JSON.stringify(publicRun(run));
      run.sessionId = row.id;
      run.pid = row.pid;
      run.procStart = row.procStart;
      run.lastStatus = row.status;
      run.lastDone = Boolean(row.done);
      // BOT-4.4: Done since Fleet's own mark, so a look that came late, or a restart, doesn't start the 2 minutes again.
      run.doneSince = row.done ? (run.doneSince ?? Math.min(now, Math.max(row.done.at, run.startedAt))) : null;
      if (row.status === 'needs-you') {
        // BOT-4.3, INBOX-1.1: a run that begins waiting on you arrives.
        if (run.state !== 'waiting') this.arrive(run);
        run.state = 'waiting';
        run.waitingFor = row.waitingFor;
        run.idleSince = null;
      } else {
        run.state = 'running';
        run.waitingFor = null;
        const resting = row.status === 'idle' && !isAtWork(row);
        run.idleSince = resting ? (run.idleSince ?? now) : null;
        // BOT-4.4: Done, or Idle and not At work for 2 minutes without a break. A Done Session still At
        // work (it's writing its last reply, say) is given those 2 minutes to come to rest, so the
        // reply read is whole and the Session can be ended (BOT-4.6); after them it has finished as it is.
        const done = run.doneSince !== null && (resting || now - run.doneSince >= BOT_IDLE_DONE_MS);
        const idle = run.idleSince !== null && now - run.idleSince >= BOT_IDLE_DONE_MS;
        if (done || idle) this.conclude(run, null);
      }
      if (JSON.stringify(run) !== was) stored = true;
      if (JSON.stringify(publicRun(run)) !== wasShown) shown = true;
    }
    if (stored) this.save();
    if (shown) this.emit();
  }

  /**
   * INBOX "Reading one": the run, its last reply, the Outputs its Session touched, read again from
   * the Library so a document edited or published since shows as it is now, and its Session as
   * History knows it (INBOX-2.7). Neither read fails the answer.
   */
  async detail(runId: string): Promise<ReportDetail> {
    const run = this.run(runId);
    const read = () => Promise.all([this.outputs(run), this.session(run)]);
    let epoch = this.privacyEpoch;
    let answer = await read();
    // PEOPLE-2.6: what is private changed while it was read: read again, so nothing of the old rule is shown or held.
    while (epoch !== this.privacyEpoch) {
      epoch = this.privacyEpoch;
      answer = await read();
    }
    const [outputs, session] = answer;
    const failed = typeof outputs === 'string';
    // INBOX: the Library failed as it arrived: its title and what it holds come from this read.
    if (!failed && run.holdsPending && !inFlight(run) && this.owner && this.unreadable === null) {
      this.hold(run, outputs);
      this.changed();
    }
    return { run: publicRun(run), reply: run.reply, outputs: failed ? [] : outputs.items, outputsError: failed ? outputs : null, session };
  }

  /**
   * PEOPLE-2.4, 2.6: what is private changed. A Report's title and what it holds were read when it
   * arrived, so they are looked at again, in two steps. First what needs no read: a title whose own
   * file is private now goes back to the Bot's name at once. Then, unless `reread` is false, each is
   * read again from the Library, which gives the next document's title and the counts; a Library that
   * can't be read leaves them, since the first step already vouched for the title (only a run held
   * before its title's file was kept falls back to the Bot's name). No Report arrives again for it,
   * and a change that comes while this runs is one more pass.
   */
  privacyChanged(opts: { reread?: boolean } = {}): void {
    this.privacyEpoch++;
    if (opts.reread !== false) this.rereadWanted = true;
    if (this.reholding) {
      this.reholdAgain = true;
      return;
    }
    this.reholding = true;
    const held = (run: StoredRun) => run.arrivedAt !== null && !inFlight(run) && run.sessionId !== null && this.mine(run) && !this.concluding.has(run.id);
    const state = (run: StoredRun) => JSON.stringify([run.title, run.holds, run.holdsPending, run.titleFrom]);
    this.track(
      (async () => {
        do {
          this.reholdAgain = false;
          const reread = this.rereadWanted;
          this.rereadWanted = false;
          let changed = false;
          for (const run of [...this.runs]) {
            if (!held(run) || !run.titleFrom) continue;
            const hidden = (await this.opts.library.isPrivate?.(run.titleFrom)) ?? false;
            if (!hidden || !held(run)) continue;
            this.unname(run);
            changed = true;
          }
          if (changed) this.changed();
          changed = false;
          for (const run of reread ? [...this.runs] : []) {
            if (!held(run)) continue;
            const was = state(run);
            const outputs = await this.outputs(run);
            if (!held(run)) continue;
            if (typeof outputs !== 'string') this.hold(run, outputs);
            else if (run.titleFrom === undefined && run.title !== run.name) this.unname(run);
            if (state(run) !== was) changed = true;
          }
          if (changed) this.changed();
        } while (this.reholdAgain);
      })()
        .catch(() => this.log('reading the Reports again failed'))
        .finally(() => {
          this.reholding = false;
        }),
    );
  }

  /** PEOPLE-2.6: the Report's title is its own name again, and what it holds is read when it's next opened or read. */
  private unname(run: StoredRun): void {
    run.title = run.name;
    run.titleFrom = null;
    if (run.holds) run.holds = { ...run.holds, documents: Math.max(0, run.holds.documents - 1), first: null };
    run.holdsPending = true;
  }

  /** INBOX-3.1, 3.2, 4.1: read or unread, archived or back in the Inbox. Archiving also marks it read. */
  mark(runId: string, input: unknown): BotRun {
    this.writable();
    const run = this.run(runId);
    const v = (typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
    if (v.read !== undefined && typeof v.read !== 'boolean') throw new BotsError(400, 'Read is true or false.', 'read');
    if (v.archived !== undefined && typeof v.archived !== 'boolean') throw new BotsError(400, 'Archived is true or false.', 'archived');
    if (v.read === undefined && v.archived === undefined) throw new BotsError(400, 'Say whether it is read, or archived.');
    if (v.arrivedAt !== undefined && v.arrivedAt !== null && typeof v.arrivedAt !== 'number') throw new BotsError(400, 'The arrival is a time, or nothing.', 'arrivedAt');
    // INBOX-1.1: a mark made for an earlier arrival changes nothing: the Report arrived again since, unread and in the Inbox.
    if (v.arrivedAt !== undefined && v.arrivedAt !== run.arrivedAt) return publicRun(run);
    const before = { read: run.read, archived: run.archived };
    if (typeof v.read === 'boolean') run.read = v.read;
    if (typeof v.archived === 'boolean') run.archived = v.archived;
    if (v.archived === true) run.read = true;
    if (run.read !== before.read || run.archived !== before.archived) {
      if (!this.save()) throw this.unsaved(() => Object.assign(run, before));
      this.emit();
    }
    return publicRun(run);
  }

  /**
   * INBOX-2.4: a Markdown file, for a Report shown in place: only a path a Report's read of the
   * Library listed (the file route's exact-string rule), only a `.md`, a regular file by `lstat`,
   * and at most REPORT_TEXT_MAX bytes of it. Null for anything else.
   */
  async text(path: string): Promise<{ body: Buffer; truncated: boolean } | null> {
    if (!isAbsolute(path) || !isPlainPath(path)) return null;
    const file = normalize(path);
    if (extname(file).toLowerCase() !== '.md' || !this.texts.has(file)) return null;
    // PEOPLE-2.5: a file listed for a Report before its folder became private is refused as unlisted.
    if (await this.opts.library.isPrivate?.(file)) return null;
    return readTextFile(file, REPORT_TEXT_MAX);
  }

  /**
   * BOT-2.6: the store's lock is this server's: it was free, it is ours already, or its holder is
   * gone and this server took it over. False while another server that is still there holds it.
   */
  private takeLock(): boolean {
    // BOT-2.6: a server started for development never runs the default store's Bots.
    if (this.opts.mayOwn === false) return false;
    const lock = botsLockPath(this.opts.path);
    try {
      const held = this.lockState();
      if (held === 'theirs') this.lockWritten = false;
      else if (held !== 'ours') mkdirSync(dirname(lock), { recursive: true });
      const owns = held === 'ours' || (held === 'free' ? this.claimLock(lock) : held === 'stale' && this.takeOverLock(lock));
      this.lockError = null;
      return owns;
    } catch (err) {
      // Without its lock this server can't know it is the only one: it runs no Bots, and the tab says why.
      const code = (err as NodeJS.ErrnoException).code ?? 'unknown error';
      if (this.lockError === null) this.log(`the store's lock couldn't be written (${code})`);
      this.lockError = `Lookout couldn't write the lock beside ${this.displayPath()} (${code}), so the Bots don't run.`;
      return false;
    }
  }

  /**
   * BOT-2.6: whose the store's lock is. `stale` when its holder is gone: it names no process, or
   * one that isn't there, or it was written before this Mac last started (that number may be
   * another process's now), or it names this server's number and this server never wrote it.
   */
  private lockState(): 'free' | 'ours' | 'theirs' | 'stale' {
    const at = writtenAt(botsLockPath(this.opts.path));
    if (at === null) return 'free';
    const holder = this.lockHolder();
    if (holder === null) return 'stale';
    if (holder === this.pid) return this.lockWritten ? 'ours' : 'stale';
    const booted = this.opts.bootedAt?.() ?? Date.now() - uptime() * 1000;
    if (at < booted - BOOT_MARGIN_MS) return 'stale';
    return (this.opts.alive ?? processAlive)(holder) ? 'theirs' : 'stale';
  }

  /**
   * BOT-2.6: a free lock is made whole in one step (written beside it, then linked into place), so
   * no server ever reads it half-written and only one server's link succeeds. True when it was this one's.
   */
  private claimLock(lock: string): boolean {
    const tmp = `${lock}.${this.pid}.tmp`;
    writeFileSync(tmp, `${this.pid}\n`, { mode: 0o600 });
    try {
      linkSync(tmp, lock);
      this.lockWritten = true;
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      return false;
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  /**
   * BOT-2.6: a stale lock is replaced by one server at a time, the one that made the gate beside
   * it. Under the gate the lock is read again, so a server that came second finds the first one's
   * and stands down; without it, two servers that found the same stale lock would both run the Bots
   * until their next look.
   */
  private takeOverLock(lock: string): boolean {
    const gate = `${lock}.taking`;
    try {
      writeFileSync(gate, `${this.pid}\n`, { flag: 'wx', mode: 0o600 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // Another server is replacing the lock right now: the next look sees whose it is. A gate left
      // by a server that died replacing it is cleared, and the look after that takes the lock.
      const since = writtenAt(gate);
      if (since !== null && Date.now() - since > LOCK_GATE_STALE_MS) rmSync(gate, { force: true });
      return false;
    }
    try {
      const held = this.lockState();
      if (held === 'ours') return true;
      if (held === 'theirs') return false;
      if (held === 'free') return this.claimLock(lock);
      const tmp = `${lock}.${this.pid}.tmp`;
      writeFileSync(tmp, `${this.pid}\n`, { mode: 0o600 });
      renameSync(tmp, lock);
      this.lockWritten = true;
      return true;
    } finally {
      rmSync(gate, { force: true });
    }
  }

  /** The process id the store's lock holds; null when there is no lock, or it names none. */
  private lockHolder(): number | null {
    try {
      const text = readFileSync(botsLockPath(this.opts.path), 'utf8').trim();
      return /^[1-9]\d{0,9}$/.test(text) ? Number(text) : null;
    } catch {
      return null;
    }
  }

  /**
   * BOT-2.6: this server runs the Bots (it picks up the runs left going), or it's a second one: it
   * starts and follows nothing, lets Fleet's list go, and reads the store again when its file changes.
   */
  private own(owner: boolean): void {
    this.owner = owner;
    this.unwatchStore?.();
    this.unwatchStore = null;
    this.load();
    if (owner) {
      if (this.unreadable === null) this.resume();
      return;
    }
    this.starting.clear();
    this.syncWatch();
    this.unwatchStore = (this.opts.watchStore ?? watchStoreFile)(this.opts.path, () => this.reread());
  }

  /** BOT-2.6: a second server shows the Bots and Reports as the owner last wrote them. */
  private reread(): void {
    if (this.owner || this.stopped) return;
    let text: string | null = null;
    try {
      text = readFileSync(this.opts.path, 'utf8');
    } catch {
      // Gone, or unreadable: `load` says which.
    }
    if (text === this.storeText && text !== null) return;
    const before = JSON.stringify([this.unreadable, this.bots, this.runs]);
    this.load();
    if (JSON.stringify([this.unreadable, this.bots, this.runs]) !== before) this.emit();
  }

  /** BOT-2.3: a missing file is an empty store; one that can't be read or isn't a store is left as it is. */
  private load(): void {
    let text: string;
    this.storeText = null;
    this.storeStamp = stamp(this.opts.path);
    try {
      text = readFileSync(this.opts.path, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      this.bots = [];
      this.runs = [];
      this.unreadable = code === 'ENOENT' ? null : `Lookout couldn't read it (${code ?? 'unknown error'}).`;
      return;
    }
    this.storeText = text;
    try {
      const store = parseStore(JSON.parse(text));
      this.bots = store.bots;
      this.runs = store.runs;
      this.unreadable = null;
    } catch (err) {
      this.bots = [];
      this.runs = [];
      this.unreadable = err instanceof StoreError ? err.message : "It isn't JSON.";
    }
  }

  /**
   * BOT-4.5, BOT-4.7: the runs a server before this one left going. One with a Session is followed
   * again by its id; one that hadn't got its Session has failed, its start being gone with that server.
   */
  private resume(): void {
    let changed = false;
    for (const run of this.runs) {
      if (!inFlight(run)) continue;
      // "Without a break" (BOT-4.4) can't be said of the time nobody was watching.
      run.idleSince = null;
      run.doneSince = null;
      if (run.sessionId !== null && run.state !== 'starting') continue;
      this.failNow(run, RUN_RESTARTED);
      changed = true;
    }
    if (changed) this.save();
    this.syncWatch();
  }

  /** BOT-4.1: a run starts as the launcher starts a Session, under its own launch id, remembering nothing. */
  private async begin(bot: Bot, dueAt: number | null): Promise<StoredRun> {
    const now = this.now();
    // BOT-4.1: a second run on one day adds its time, and its seconds if it must, so its Session's
    // name is its own while an earlier run's Session is still live. Among every Bot's runs: two Bots
    // may share a name. The launcher takes at most 80 characters: a long name gives way to the day and time.
    const taken = (name: string) => this.runs.some((r) => r.name === name);
    const at = new Date(now);
    const two = (n: number) => String(n).padStart(2, '0');
    const day = runName('', now);
    const fit = (suffix: string) => (bot.name.length + suffix.length <= MAX_NAME ? `${bot.name}${suffix}` : `${bot.name.slice(0, MAX_NAME - suffix.length - 1)}…${suffix}`);
    const names = [day, `${day} ${two(at.getHours())}:${two(at.getMinutes())}`, `${day} ${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`].map(fit);
    const name = names.find((n) => !taken(n)) ?? names[2]!;
    const run: StoredRun = {
      id: randomUUID(), botId: bot.id, botName: bot.name, name, dueAt, startedAt: now,
      // BOT-3.3: how late a scheduled run started, when it's over a minute.
      lateMs: dueAt !== null && now - dueAt > LATE_MS ? now - dueAt : 0,
      state: 'starting', sessionId: null, harness: bot.harness, waitingFor: null, endedAt: null, failure: null, session: null,
      arrivedAt: null, title: name, holds: null, read: false, archived: false,
      launchId: randomUUID(), lastStatus: null, lastDone: false, idleSince: null, doneSince: null, reply: null, pid: null, procStart: null, holdsPending: false,
    };
    const kept = { runs: [...this.runs], floors: this.bots.map((b) => b.since), skipped: bot.skipped };
    // BOT-3.5: the count of skipped times is of those since its last run started.
    bot.skipped = 0;
    this.runs.push(run);
    this.trim();
    // BOT-3.4: the run, and the time it runs for, are kept before Fleet is asked: a start the store
    // doesn't hold would be made a second time after a restart.
    if (!this.save()) {
      throw this.unsaved(() => {
        this.runs = kept.runs;
        this.bots.forEach((b, i) => (b.since = kept.floors[i] ?? b.since));
        bot.skipped = kept.skipped;
      });
    }
    this.starting.add(run.id);
    this.syncWatch();
    this.emit();
    let launch: LaunchView | null = null;
    let failure: string | null = null;
    try {
      launch = await this.opts.launcher.start({
        directory: bot.directory, harness: bot.harness, model: bot.model, ...(bot.effort ? { effort: bot.effort } : {}),
        skipPermissions: bot.skipPermissions, name, prompt: bot.prompt, launchId: run.launchId,
      }, { remember: false });
    } catch (err) {
      // BOT-4.5: the launcher's own reason (LAUNCH-4.4); anything else isn't for the Report.
      failure = err instanceof LaunchError ? err.message : "Couldn't start the Session.";
    }
    this.starting.delete(run.id);
    // Fleet may have reported its Session before the start answered: then it's followed already.
    if (!inFlight(run) || run.sessionId !== null) return run;
    if (failure !== null) this.failNow(run, failure);
    else if (launch && !this.followLaunch(run, launch)) return run;
    this.changed();
    return run;
  }

  /** BOT-4.3, BOT-4.5: a run by its start, before Fleet reports its Session. True when it changed. */
  private followLaunch(run: StoredRun, launch: LaunchView): boolean {
    if (launch.state === 'failed') {
      this.failNow(run, launch.error ?? "Couldn't start the Session.");
      return true;
    }
    if (launch.state === 'trust') {
      if (run.state === 'waiting') return false;
      run.state = 'waiting';
      run.waitingFor = WAITING_FOR_TRUST;
      this.arrive(run);
      return true;
    }
    if (run.state === 'starting') return false;
    // Its Trust prompt was answered: it's starting until Fleet reports its Session.
    run.state = 'starting';
    run.waitingFor = null;
    return true;
  }

  /** BOT-4.5: a run that never got a Session has failed: nothing to read, nothing to end. */
  private failNow(run: StoredRun, failure: string): void {
    run.state = 'failed';
    run.failure = failure;
    run.endedAt = this.now();
    run.waitingFor = null;
    run.idleSince = null;
    run.doneSince = null;
    run.holds = { documents: 0, reply: false, first: null };
    this.arrive(run);
  }

  /** A run with a Session has finished, or failed with `failure`: what it arrives with is read first. */
  private conclude(run: StoredRun, failure: string | null): void {
    if (this.concluding.has(run.id)) return;
    this.concluding.add(run.id);
    this.track(
      this.finish(run, failure)
        .catch(() => this.log('finishing a run failed'))
        .finally(() => {
          this.concluding.delete(run.id);
          this.syncWatch();
        }),
    );
  }

  private track(work: Promise<unknown>): void {
    this.work.add(work);
    void work.finally(() => this.work.delete(work));
  }

  /**
   * BOT-4.4, 4.6, INBOX "When it arrives": the Session's last reply and the Outputs it touched are
   * read before it's ended; then the run arrives. A read that fails leaves the Report without it.
   */
  private async finish(run: StoredRun, failure: string | null): Promise<void> {
    // When it came to rest, for how long it took; now for one that ended by itself.
    const endedAt = run.idleSince ?? this.now();
    const reply = this.row(run) ? await this.lastReply(run) : null;
    let epoch = this.privacyEpoch;
    let outputs = await this.outputs(run);
    // BOT-2.6: this server stopped, or gave the Bots up, while those were read: the run is the next
    // owner's to finish, and its Session theirs to end.
    if (!this.mine(run)) return;
    const session = failure === null ? await this.endSession(run) : null;
    if (!this.mine(run)) return;
    // PEOPLE-2.6: what is private changed while its Session was ended: its Outputs are read again, so it
    // never arrives named after a file that is private by now.
    while (epoch !== this.privacyEpoch) {
      epoch = this.privacyEpoch;
      outputs = await this.outputs(run);
      if (!this.mine(run)) return;
    }
    run.state = failure === null ? 'finished' : 'failed';
    run.failure = failure;
    run.endedAt = endedAt;
    run.waitingFor = null;
    run.idleSince = null;
    run.doneSince = null;
    run.session = session;
    run.reply = reply;
    this.hold(run, outputs);
    this.arrive(run);
    this.changed();
  }

  /** BOT-2.6: the run is still this server's to change: it runs the Bots, and the run is the one it holds. */
  private mine(run: StoredRun): boolean {
    return !this.stopped && this.owner && this.unreadable === null && this.runs.includes(run);
  }

  /** INBOX-1.2: a Report's title and what it holds, from its Session's Outputs; its own name when the Library failed. */
  private hold(run: StoredRun, outputs: Outputs): void {
    const failed = typeof outputs === 'string';
    const first = failed ? undefined : outputs.items[0];
    run.title = first?.title || run.name;
    run.titleFrom = first?.title ? (first.path ?? first.sourcePath ?? null) : null;
    run.holds = { documents: failed ? 0 : outputs.total, reply: run.reply !== null, first: first ? { kind: first.kind, type: first.type } : null };
    run.holdsPending = failed;
  }

  /** INBOX-1.1, INBOX-3.1: it arrives, or arrives again: at the top of the Inbox, unread. */
  private arrive(run: StoredRun): void {
    run.arrivedAt = this.now();
    run.read = false;
    run.archived = false;
  }

  /** INBOX-2.5: the Session's last reply, cut to REPORT_REPLY_MAX characters; null when it has none, or it can't be read. */
  private async lastReply(run: StoredRun): Promise<string | null> {
    try {
      const page = await this.opts.latest(run.sessionId!);
      const last = page.entries.findLast((e) => e.kind === 'assistant' && e.text.trim() !== '');
      return last?.kind === 'assistant' ? last.text.slice(0, REPORT_REPLY_MAX) : null;
    } catch {
      return null;
    }
  }

  /** INBOX-2.3: the Outputs the run's Session touched, every Type, gone ones too; or why the Library couldn't say. */
  private async outputs(run: StoredRun): Promise<Outputs> {
    // A Session Lookout knows only by its process (`codex:<pid>`) has no Transcript to ask about yet.
    if (run.sessionId === null || !SESSION_ID.test(run.sessionId)) return { items: [], total: 0 };
    const items: OutputItem[] = [];
    let readId: string | undefined;
    // INBOX-2.3: every page the Library has for the Session, up to REPORT_OUTPUTS_MAX documents.
    for (let n = 1; items.length < REPORT_OUTPUTS_MAX; n++) {
      let page: LibraryPage;
      try {
        page = await this.opts.library.find({
          query: '', page: n, headless: false, types: [...LIBRARY_TYPES], project: '', hideGone: false,
          sessions: [`${run.harness}:${run.sessionId}`], ...(readId === undefined ? {} : { readId }),
        });
      } catch (err) {
        return err instanceof LibraryError ? err.message : "The Library couldn't be read.";
      }
      if (page.state === 'not-installed') return "tb-session isn't installed, so what it produced can't be listed.";
      if (page.state === 'too-old') return page.reason;
      if (page.state !== 'ok') {
        // The read behind a later page is gone: what the pages before it held stands.
        if (n > 1) break;
        return "The Library couldn't be read.";
      }
      items.push(...page.items);
      readId = page.readId;
      if (!page.hasMore || page.items.length === 0) break;
    }
    const shown = items.slice(0, REPORT_OUTPUTS_MAX);
    for (const item of shown) {
      if (item.kind === 'file' && item.type === 'markdown' && item.path) this.allowText(item.path);
      if (item.source?.type === 'markdown') this.allowText(item.source.path);
    }
    // What the Report can show is what it says it holds.
    return { items: shown, total: shown.length };
  }

  /** INBOX-2.7: the run's Session as History knows it; null when it has none, or History can't say. */
  private async session(run: StoredRun): Promise<HistoryItem | null> {
    if (run.sessionId === null || !SESSION_ID.test(run.sessionId) || !this.opts.history) return null;
    try {
      return await this.opts.history.lookup(run.sessionId, run.harness);
    } catch {
      return null;
    }
  }

  /**
   * BOT-4.6: a finished run's Session, still live, is ended the way End Session does, with the
   * process its row names so a replacement is never closed. Not one you opened in Lookout since the
   * run started (it's yours), and never one that Needs you or is At work. An end that fails leaves
   * the Session, and one line in the log without its name.
   */
  private async endSession(run: StoredRun): Promise<BotRun['session']> {
    const row = this.row(run);
    if (!row) return null;
    const kept = this.keeps(run, row);
    if (kept) return kept;
    // The row above is a few seconds old: the end reads Fleet's list once more and asks again right before it closes.
    const late: { kept: BotRun['session'] } = { kept: null };
    try {
      await this.opts.end(row.id, { pid: row.pid, procStart: row.procStart }, (fresh) => (late.kept = this.keeps(run, fresh)) === null);
      return 'ended';
    } catch (err) {
      if (late.kept) return late.kept;
      const status = (err as { status?: unknown } | null)?.status;
      this.log(`ending a finished run's Session failed (${typeof status === 'number' ? status : 'unknown'})`);
      return 'left';
    }
  }

  /** BOT-4.6: why a finished run's Session isn't ended: you opened it since the run started (`yours`), or it Needs you or is At work (`left`). */
  private keeps(run: StoredRun, row: SessionRow): 'yours' | 'left' | null {
    const viewed = Math.max(row.viewedAt ?? -Infinity, this.opts.viewedAt?.(row.id) ?? -Infinity);
    if (viewed > run.startedAt) return 'yours';
    return row.status === 'needs-you' || isAtWork(row) ? 'left' : null;
  }

  /** The run's Session as Fleet last listed it. */
  private row(run: StoredRun): SessionRow | null {
    const row = run.sessionId === null ? null : this.opts.monitor.get(run.sessionId);
    // BOT-4.6: a Session resumed under another process isn't the run's: nothing of it is read, and it's never ended.
    return row && row.harness === run.harness && !replaced(run, row) ? row : null;
  }

  private allowText(path: string): void {
    if (!isAbsolute(path) || !isPlainPath(path)) return;
    this.texts.add(normalize(path));
    if (this.texts.size > MAX_TEXT_PATHS) this.texts.delete(this.texts.values().next().value!);
  }

  /**
   * BOT-2.1, BOT-2.2: a Bot's fields from what was sent, over the Bot being changed (none for a new
   * one). Its name, prompt and schedule by their own rules; what it shares with a start by the
   * launcher's (a Harness Fleet has, a Start directory from Settings, a model and Effort that
   * Harness lists), asked only when one of those is sent, so a Bot can always be turned off.
   */
  private async fields(input: unknown, base: Bot | null): Promise<{ fields: Fields; given: (keyof Fields)[] }> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new BotsError(400, 'Expected a Bot.');
    const v = input as Record<string, unknown>;
    const given = INPUT_FIELDS.filter((k) => v[k] !== undefined);
    const pick = (k: keyof Fields): unknown => (v[k] !== undefined ? v[k] : base?.[k]);

    const rawName = pick('name');
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name) throw new BotsError(400, 'Give the Bot a name.', 'name');
    if (name.length > BOT_NAME_MAX || /\p{Cc}/u.test(name)) throw new BotsError(400, `A name is one line of at most ${BOT_NAME_MAX} characters.`, 'name');

    const rawPrompt = pick('prompt');
    // As a start's (LAUNCH-4.3): as typed, only line endings normalized.
    const prompt = typeof rawPrompt === 'string' ? rawPrompt.replace(/\r\n?/g, '\n') : '';
    if (prompt.trim() === '') throw new BotsError(400, 'Give the Bot a prompt.', 'prompt');
    if (prompt.includes('\0')) throw new BotsError(400, 'Invalid prompt.', 'prompt');
    if (prompt.length > BOT_PROMPT_MAX) throw new BotsError(400, `A prompt is at most ${BOT_PROMPT_MAX.toLocaleString('en-US')} characters.`, 'prompt');

    const parsed = parseSchedule(pick('schedule'));
    if (!parsed.ok) throw new BotsError(400, parsed.error, 'schedule');

    const on = v.on !== undefined ? v.on : (base?.on ?? true);
    if (typeof on !== 'boolean') throw new BotsError(400, 'On is true or false.', 'on');

    let start: Pick<Fields, (typeof START_FIELDS)[number]>;
    if (base && !START_FIELDS.some((k) => v[k] !== undefined)) {
      start = { directory: base.directory, harness: base.harness, model: base.model, effort: base.effort, skipPermissions: base.skipPermissions };
    } else {
      try {
        const checked = await this.opts.launcher.check({
          // A Bot's "no Effort" is null; a start's is to send none.
          directory: pick('directory'), harness: pick('harness'), model: pick('model'), effort: pick('effort') ?? undefined,
          skipPermissions: pick('skipPermissions'), name: runName(name, this.now()), prompt,
        });
        start = { directory: checked.directory, harness: checked.harness, model: checked.model, effort: checked.effort ?? null, skipPermissions: checked.skipPermissions };
      } catch (err) {
        if (err instanceof LaunchError) throw new BotsError(err.status, err.message, err.field);
        throw err;
      }
    }
    return { fields: { name, prompt, schedule: parsed.schedule, on, ...start }, given };
  }

  private view(bot: Bot): BotView {
    // BOT-3.6: a Bot that is off, or only by hand, has no next time.
    return { ...bot, nextAt: bot.on ? nextTime(bot.schedule, this.now()) : null, running: this.running(bot.id) };
  }

  /** The id of the Bot's run that is starting, running or waiting on you; null for none. */
  private running(botId: string): string | null {
    return this.runs.find((r) => r.botId === botId && inFlight(r))?.id ?? null;
  }

  /** BOT-3.4: only times after this are run: the later of `since` and its last scheduled run's time. */
  private floor(bot: Bot): number {
    let floor = bot.since;
    for (const r of this.runs) if (r.botId === bot.id && r.dueAt !== null && r.dueAt > floor) floor = r.dueAt;
    return floor;
  }

  private bot(id: string): Bot {
    const bot = this.bots.find((b) => b.id === id);
    if (!bot) throw new BotsError(404, NO_BOT);
    return bot;
  }

  private run(id: string): StoredRun {
    const run = this.runs.find((r) => r.id === id);
    if (!run) throw new BotsError(404, 'This Report is gone.');
    return run;
  }

  /** BOT-2.6: a second server changes nothing. BOT-2.3: while the file can't be read, nothing is saved. */
  private writable(): void {
    if (!this.owner) throw new BotsError(409, this.lockError ?? BOTS_READ_ONLY);
    if (this.unreadable !== null) throw this.cantRead();
  }

  private cantRead(): BotsError {
    return new BotsError(503, `Lookout can't read ${this.displayPath()}, so nothing can be saved. ${this.unreadable}`);
  }

  /**
   * A change the store didn't keep: `undo` puts memory back as it was. Not when the file turned out
   * unreadable (BOT-2.3): then memory was emptied with it, and the refusal says so.
   */
  private unsaved(undo: () => void): BotsError {
    if (this.unreadable !== null) return this.cantRead();
    undo();
    return new BotsError(500, SAVE_FAILED);
  }

  private displayPath(): string {
    const p = this.opts.path;
    return p === this.home || p.startsWith(`${this.home}/`) ? `~${p.slice(this.home.length)}` : p;
  }

  /** BOT-4.8: the newest BOT_RUNS_MAX runs are kept; one still going is never the one dropped. */
  private trim(): void {
    while (this.runs.length > BOT_RUNS_MAX) {
      const oldest = this.runs.findIndex((r) => !inFlight(r));
      if (oldest < 0) return;
      const [dropped] = this.runs.splice(oldest, 1);
      // BOT-3.4: the time it ran for stays run: its Bot's floor keeps it once the run is gone.
      const bot = this.bots.find((b) => b.id === dropped!.botId);
      if (bot && dropped!.dueAt !== null && dropped!.dueAt > bot.since) bot.since = dropped!.dueAt;
    }
  }

  /** Something every tab shows changed: kept, sent, and Fleet's list held or let go. */
  private changed(): void {
    this.save();
    this.syncWatch();
    this.emit();
  }

  private emit(): void {
    this.opts.onChange(this.snapshot());
  }

  /** BOT-4.7: Fleet's list is read while any run is starting, running or waiting on you, with or without a tab. */
  private syncWatch(): void {
    const want = !this.stopped && this.owner && this.unreadable === null && this.runs.some(inFlight);
    if (want && !this.unwatch) this.unwatch = this.opts.monitor.watch();
    else if (!want && this.unwatch) {
      this.unwatch();
      this.unwatch = null;
    }
  }

  /**
   * Written whole to a temporary file and renamed, mode 0600. False when it couldn't be; never
   * while unreadable (BOT-2.3), and never by a second server (BOT-2.6).
   */
  private save(): boolean {
    if (this.unreadable !== null || !this.owner) return false;
    // BOT-2.3: something else changed the file since this server last read or wrote it. If it can't
    // be read now it is left as it is, the tab says so, and nothing here is kept; a file that still
    // reads is this server's to write (edit it by hand only while Lookout is stopped).
    if (stamp(this.opts.path) !== this.storeStamp && this.brokenNow()) {
      this.load();
      this.syncWatch();
      this.emit();
      return false;
    }
    try {
      mkdirSync(dirname(this.opts.path), { recursive: true });
      const tmp = `${this.opts.path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: STORE_VERSION, bots: this.bots, runs: this.runs }, null, 2) + '\n', { mode: 0o600 });
      renameSync(tmp, this.opts.path);
      this.storeStamp = stamp(this.opts.path);
      return true;
    } catch (err) {
      // What's in memory still shows and is followed; the next change writes it all again.
      this.log(`saving the store failed (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`);
      return false;
    }
  }

  /** BOT-2.3: the file is there and isn't a store Lookout reads, as `load` would find it. */
  private brokenNow(): boolean {
    try {
      parseStore(JSON.parse(readFileSync(this.opts.path, 'utf8')));
      return false;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code !== 'ENOENT';
    }
  }

  /** A category only: never a Bot's or a Session's name, a prompt or a path. */
  private log(text: string): void {
    try {
      (this.opts.log ?? ((line: string) => console.warn(line)))(`lookout: bots: ${text}`);
    } catch {
      // A logger cannot change what a run does.
    }
  }
}

const STORE_VERSION = 1;
const NO_BOT = 'This Bot is gone.';
const SAVE_FAILED = "Lookout couldn't save its Bots, so nothing was changed.";

/** BOT-2.3: the file isn't a store this Lookout reads, and why, in words for the tab. */
class StoreError extends Error {}

/** The run every tab gets: without its reply and what only the server follows it by. */
function publicRun(r: StoredRun): BotRun {
  return {
    id: r.id, botId: r.botId, botName: r.botName, name: r.name, dueAt: r.dueAt, startedAt: r.startedAt, lateMs: r.lateMs, state: r.state,
    sessionId: r.sessionId, harness: r.harness, waitingFor: r.waitingFor, endedAt: r.endedAt, failure: r.failure, session: r.session,
    arrivedAt: r.arrivedAt, title: r.title, holds: r.holds, read: r.read, archived: r.archived,
    // BOT-4.3: its start, while it has no Session: where a Trust prompt is answered.
    launchId: r.sessionId === null && inFlight(r) ? r.launchId : null,
  };
}

/**
 * BOT-4.6: the row is another process than the one the run's Session was last listed with (another
 * pid, or the same pid started at another time): the Session was resumed since, and isn't the run's.
 */
function replaced(run: StoredRun, row: SessionRow): boolean {
  if (run.pid === null) return false;
  if (row.pid !== run.pid) return true;
  return run.procStart !== null && row.procStart !== null && row.procStart !== run.procStart;
}

/** The same process as the run's Session was last listed with: its Harness, pid and, when both are known, start time. */
function sameProcess(run: StoredRun, row: SessionRow): boolean {
  if (run.pid === null || row.pid !== run.pid || row.harness !== run.harness) return false;
  return run.procStart === null || row.procStart === null || row.procStart === run.procStart;
}

const record = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const time = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const orNull = <T>(v: unknown, is: (v: unknown) => v is T): T | null => (is(v) ? v : null);

/**
 * BOT-2.3: the store from its file. What identifies a Bot or a run must be there and right, or the
 * whole file is left alone (a save would drop what this Lookout can't read); the rest has defaults,
 * so a file from an older Lookout, or one written by hand, still reads.
 */
function parseStore(v: unknown): { bots: Bot[]; runs: StoredRun[] } {
  const store = record(v);
  if (!store) throw new StoreError("It isn't a Bots store.");
  if (store.version !== STORE_VERSION) {
    throw new StoreError(time(store.version) && store.version > STORE_VERSION ? `It was written by a newer Lookout (version ${store.version}).` : "It isn't a Bots store.");
  }
  if (!Array.isArray(store.bots) || !Array.isArray(store.runs)) throw new StoreError("It isn't a Bots store.");
  const bots = store.bots.map((b) => {
    const bot = parseBot(b);
    if (!bot) throw new StoreError("One of its Bots isn't one Lookout can read.");
    return bot;
  });
  const runs = store.runs.map((r) => {
    const run = parseRun(r);
    if (!run) throw new StoreError("One of its runs isn't one Lookout can read.");
    return run;
  });
  if (new Set(bots.map((b) => b.id)).size !== bots.length || new Set(runs.map((r) => r.id)).size !== runs.length) throw new StoreError('Two of its Bots or runs have the same id.');
  runs.sort((a, b) => a.startedAt - b.startedAt);
  return { bots, runs };
}

function parseBot(v: unknown): Bot | null {
  const r = record(v);
  if (!r) return null;
  const schedule = parseSchedule(r.schedule);
  if (typeof r.id !== 'string' || !BOT_ID.test(r.id) || !schedule.ok) return null;
  if (!text(r.name, BOT_NAME_MAX) || !r.name.trim() || !text(r.prompt, BOT_PROMPT_MAX) || !r.prompt.trim()) return null;
  if (typeof r.harness !== 'string' || !HARNESSES.includes(r.harness) || typeof r.directory !== 'string' || !r.directory) return null;
  const since = time(r.since) ? r.since : 0;
  return {
    id: r.id, name: r.name, prompt: r.prompt, harness: r.harness as LaunchHarness,
    model: typeof r.model === 'string' ? r.model : '', effort: typeof r.effort === 'string' && r.effort ? r.effort : null,
    skipPermissions: r.skipPermissions === true, directory: r.directory, schedule: schedule.schedule, on: r.on !== false,
    since, skipped: time(r.skipped) && r.skipped > 0 ? Math.floor(r.skipped) : 0,
    createdAt: time(r.createdAt) ? r.createdAt : since, updatedAt: time(r.updatedAt) ? r.updatedAt : since,
  };
}

function parseHolds(v: unknown): ReportHolds | null {
  const r = record(v);
  if (!r) return null;
  const first = record(r.first);
  const kind = first && typeof first.kind === 'string' && OUTPUT_KINDS.includes(first.kind) ? (first.kind as OutputItem['kind']) : null;
  return {
    documents: time(r.documents) && r.documents > 0 ? Math.floor(r.documents) : 0,
    reply: r.reply === true,
    first: kind ? { kind, type: typeof first!.type === 'string' && OUTPUT_TYPES.includes(first!.type) ? (first!.type as OutputType) : null } : null,
  };
}

function parseRun(v: unknown): StoredRun | null {
  const r = record(v);
  if (!r) return null;
  if (typeof r.id !== 'string' || !BOT_ID.test(r.id) || typeof r.botId !== 'string' || !BOT_ID.test(r.botId)) return null;
  if (typeof r.state !== 'string' || !STATES.includes(r.state) || !time(r.startedAt)) return null;
  if (typeof r.harness !== 'string' || !HARNESSES.includes(r.harness)) return null;
  const state = r.state as BotRunState;
  const live = (RUN_IN_FLIGHT as readonly string[]).includes(state);
  const name = text(r.name, 200) && r.name ? r.name : text(r.botName, 200) && r.botName ? r.botName : 'A run';
  const reply = typeof r.reply === 'string' && r.reply ? r.reply.slice(0, REPORT_REPLY_MAX) : null;
  return {
    id: r.id, botId: r.botId, botName: text(r.botName, 200) ? r.botName : name, name,
    dueAt: orNull(r.dueAt, time), startedAt: r.startedAt, lateMs: time(r.lateMs) && r.lateMs > 0 ? r.lateMs : 0, state,
    sessionId: typeof r.sessionId === 'string' && r.sessionId.length <= 200 && r.sessionId ? r.sessionId : null,
    harness: r.harness as LaunchHarness,
    waitingFor: state === 'waiting' && text(r.waitingFor, 2000) ? r.waitingFor : null,
    endedAt: orNull(r.endedAt, time), failure: text(r.failure, 2000) && r.failure ? r.failure : state === 'failed' ? 'It failed' : null,
    session: typeof r.session === 'string' && SESSION_FATES.includes(r.session) ? (r.session as BotRun['session']) : null,
    // A run that is over is a Report, whatever the file says of when it arrived.
    arrivedAt: time(r.arrivedAt) ? r.arrivedAt : live ? null : (orNull(r.endedAt, time) ?? r.startedAt),
    title: text(r.title, 500) && r.title ? r.title : name, holds: parseHolds(r.holds), read: r.read === true, archived: r.archived === true,
    launchId: typeof r.launchId === 'string' ? r.launchId : null,
    lastStatus: typeof r.lastStatus === 'string' && STATUSES.includes(r.lastStatus) ? (r.lastStatus as Status) : null,
    lastDone: r.lastDone === true, idleSince: orNull(r.idleSince, time), doneSince: orNull(r.doneSince, time), reply,
    pid: typeof r.pid === 'number' && Number.isSafeInteger(r.pid) && r.pid > 0 ? r.pid : null,
    procStart: typeof r.procStart === 'string' && r.procStart.length <= 40 ? r.procStart : null,
    holdsPending: r.holdsPending === true,
    ...(r.titleFrom === null || (typeof r.titleFrom === 'string' && r.titleFrom.length <= 4096) ? { titleFrom: r.titleFrom as string | null } : {}),
  };
}
