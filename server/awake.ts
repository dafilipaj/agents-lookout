import { spawn as nodeSpawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import {
  AMPHETAMINE_BUSY,
  type AwakeMode,
  type AwakeNote,
  type AwakeSnapshot,
  LID_AUTOMATION,
  LID_NEEDS_APP,
  LID_NEEDS_CHARGER,
  LID_NEEDS_HELPER,
  POWER_INTERVAL_MS,
  atWorkCount,
  offAtFor,
} from '../shared/awake.ts';
import type { SessionRow } from '../shared/types.ts';
import type { RunError, Runner } from './exec.ts';
import { cleanEnv } from './launcher.ts';
import { sanitizeLine } from './sanitize.ts';

/** AWAKE-3.5: room for macOS's Automation prompt on the first call. */
export const AMPHETAMINE_TIMEOUT_MS = 60_000;
/** AWAKE-1.4: what an `end session` gets while the server stops. */
const CLOSE_TIMEOUT_MS = 10_000;
const PMSET_TIMEOUT_MS = 5_000;
/** AWAKE-1.2: a second exit of `caffeinate` this soon after the first turns keep-awake off. */
export const QUICK_EXIT_MS = 5_000;

/** AWAKE-3.2: Matej's recipe's commands, in one place (AWAKE-3.6 checks them against the dictionary). */
export const AMPHETAMINE = {
  active: 'session is active',
  start: 'start new session with options {duration:0, interval:0, displaySleepAllowed:true}',
  closedDisplay: 'enable closed display mode',
  end: 'end session',
} as const;

/** The notes keep-awake leaves when it acts on its own (AWAKE-4.3). */
export const NOTE = {
  idle: 'Turned off: no Session at work for 5 min',
  battery: 'Lid closed paused: on battery',
  foreign: 'Lid closed paused: Amphetamine has a session of its own',
  failed: (reason: string) => `Lid closed failed: ${reason}`,
  caffeinate: (reason: string) => `caffeinate stopped: ${reason}`,
  ended: "Lid closed ended: Amphetamine's session was ended outside Lookout",
};

/** A running `caffeinate`; `onExit` hears its first stderr line, or why it couldn't start. */
export interface HeldProcess {
  kill(): void;
  onExit(listener: (stderr: string) => void): void;
}
export type Spawner = (file: string, args: readonly string[]) => HeldProcess;

/** AWAKE-1.2: `caffeinate` as a child of the server, its stderr kept for the note. */
export const spawnHeld: Spawner = (file, args) => {
  const child = nodeSpawn(file, [...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  let exited = false;
  const listeners: ((stderr: string) => void)[] = [];
  const done = (fallback: string) => {
    if (exited) return;
    exited = true;
    for (const l of listeners) l(stderr || fallback);
  };
  child.stderr?.on('data', (d: Buffer) => {
    if (stderr.length < 2000) stderr += d.toString('utf8');
  });
  child.on('error', (e) => done(e.message));
  child.on('close', (code, signal) => done(signal ? `ended by ${signal}` : `exited with ${code}`));
  return {
    kill: () => {
      if (!exited) child.kill('SIGTERM');
    },
    onExit: (l) => listeners.push(l),
  };
};

/**
 * AWAKE-1.2: a system command on PATH alone, which holds `/usr/bin` for a server started from a
 * terminal or by launchd, and a World's fakes only in a World (whose PATH is its `bin/`).
 */
export function resolveSystemBin(name: string, env: NodeJS.ProcessEnv = process.env): string {
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return name;
}

/** AWAKE-3.1: `pmset -g batt`'s first line names the power source. */
export function parsePowerSource(stdout: string): 'ac' | 'battery' | null {
  const m = /Now drawing from '([^']+)'/.exec(stdout);
  if (!m) return null;
  return m[1] === 'AC Power' ? 'ac' : 'battery';
}

/** A request keep-awake refuses: 409 with the reason, or `amphetamine-busy` (AWAKE-3.2). */
export class AwakeError extends Error {
  readonly status: number;
  readonly kind: string | null;
  constructor(status: number, message: string, kind: string | null = null) {
    super(message);
    this.status = status;
    this.kind = kind;
  }
}

/** An Amphetamine call that failed, in words; `refused` when macOS refused the Apple event (-1743). */
class AmphetamineError extends Error {
  readonly refused: boolean;
  constructor(message: string, refused: boolean) {
    super(message);
    this.refused = refused;
  }
}

function amphetamineFailure(e: unknown, timeoutMs: number): AmphetamineError {
  const r = e as RunError;
  if (r.timedOut) return new AmphetamineError(`Amphetamine didn't answer in ${Math.round(timeoutMs / 1000)} s`, false);
  if (r.code === 'ENOENT') return new AmphetamineError('osascript not found', false);
  const text = `${r.stderr ?? ''}`.trim();
  if (/\(-1743\)/.test(text)) return new AmphetamineError(LID_AUTOMATION, true);
  const line = text.split('\n')[0]?.replace(/^.*?execution error:\s*/, '') ?? '';
  return new AmphetamineError(sanitizeLine(line || r.message || String(e), 200) ?? 'Amphetamine failed', false);
}

export interface KeepAwakeOptions {
  runner: Runner;
  spawn?: Spawner;
  sessions(): readonly SessionRow[];
  onChange(snapshot: AwakeSnapshot): void;
  /** AWAKE-1.3: `~/.lookout/keep-awake.json`. */
  file: string;
  /** AWAKE-1.2: `caffeinate -w` waits on this process. */
  pid: number;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  exists?: (path: string) => boolean;
  /**
   * AWAKE-2.1: holds a read of Fleet's list (the Session monitor's `watch()`), as a connected tab
   * does, so who's At work stays known with no tab open; the returned function releases it.
   */
  watchSessions?(): () => void;
}

interface Saved {
  mode: AwakeMode;
  ownsAmphetamine: boolean;
}

/**
 * AWAKE: one switch for the Mac. Holds a `caffeinate -i` while on, an Amphetamine session with
 * the lid closed on the charger, and turns itself off 5 minutes after the last Session At work.
 * Every change runs through one queue, so Amphetamine's calls never interleave.
 */
export class KeepAwake {
  private mode: AwakeMode = 'off';
  /** Why Lid closed is held as Awake for now (AWAKE-3.4); resumed on the charger only after `battery`. */
  private paused: 'battery' | 'foreign' | null = null;
  private onSince = 0;
  private lastAtWork: number | null = null;
  private atWork = 0;
  private power: 'ac' | 'battery' | null = null;
  /** AWAKE-3.5: macOS refused the last Apple event. */
  private refused = false;
  private owns = false;
  private note: AwakeNote | null = null;
  private held: HeldProcess | null = null;
  private lastExit: number | null = null;
  private offTimer: NodeJS.Timeout | null = null;
  private powerTimer: NodeJS.Timeout | null = null;
  private reading: Promise<void> | null = null;
  private watchers = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private published: string | null = null;
  /** AWAKE-1.1: counts the snapshots sent, so a tab keeps the newest whichever way it arrives. */
  private rev = 0;
  /** AWAKE-2.1: the read of Fleet's list held while the mode is on. */
  private sessionsWatch: (() => void) | null = null;
  /** AWAKE-1.4: cancels Amphetamine calls still running when the server stops. */
  private readonly abort = new AbortController();
  private readonly opts: KeepAwakeOptions;
  private readonly now: () => number;
  private readonly env: NodeJS.ProcessEnv;
  private readonly spawn: Spawner;
  private readonly exists: (path: string) => boolean;

  constructor(opts: KeepAwakeOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.env = cleanEnv(opts.env ?? process.env);
    this.spawn = opts.spawn ?? spawnHeld;
    this.exists = opts.exists ?? existsSync;
  }

  /**
   * AWAKE-1.3, AWAKE-3.3: reads the saved mode back, ends an Amphetamine session a server that
   * didn't stop cleanly left, then turns the saved mode on again.
   */
  async start(): Promise<void> {
    // All of it in the queue, so a pick made meanwhile waits and isn't overwritten (AWAKE-1.3).
    await this.run(async () => {
      const saved = this.load();
      this.owns = saved.ownsAmphetamine;
      await this.readPowerSource();
      if (this.owns) await this.endLid();
      if (saved.mode === 'off') return;
      this.onSince = this.now();
      if (saved.mode === 'awake') return this.turnOn('awake');
      const lid = this.lidState();
      if (this.power !== 'ac') {
        this.turnOn('lid', 'battery');
        this.note = { text: NOTE.battery, at: this.now() };
        return;
      }
      if (!lid.available) {
        this.turnOn('awake');
        this.note = { text: NOTE.failed(lid.reason ?? LID_NEEDS_APP), at: this.now() };
        return;
      }
      await this.resumeLid();
    });
    this.reschedule();
    this.schedulePower();
    this.publish();
  }

  snapshot(): AwakeSnapshot {
    return {
      mode: this.mode,
      holding: this.mode === 'lid' && this.paused ? 'awake' : this.mode,
      atWork: this.atWork,
      offAt: offAtFor(this.mode, this.atWork, this.onSince, this.lastAtWork),
      lid: this.lidState(),
      note: this.note,
      rev: this.rev,
    };
  }

  /** AWAKE-1.1, AWAKE-3.2: what you chose; a manual pick clears the last note. */
  set(mode: AwakeMode, replace = false): Promise<AwakeSnapshot> {
    return this.run(async () => {
      if (this.closed) throw new AwakeError(503, 'Lookout is stopping.');
      if (mode === 'lid') {
        const lid = this.lidState();
        if (!lid.available) throw new AwakeError(409, lid.reason ?? LID_NEEDS_APP);
        await this.chooseLid(replace);
      } else {
        this.note = null;
        await this.endLid();
        if (mode === 'off') this.turnOff();
        else {
          this.onSince = this.now();
          this.turnOn('awake');
        }
      }
      this.reschedule();
      this.schedulePower();
      this.publish();
      return this.snapshot();
    });
  }

  /** AWAKE-2.1: Fleet's list changed; the count of Sessions At work and the 5-minute clock follow. */
  sessionsChanged(): void {
    this.recount();
    this.reschedule();
    this.publish();
  }

  private recount(): void {
    const n = atWorkCount(this.opts.sessions());
    // At work now, or just stopped: either way the last moment a Session was At work is now.
    if (n > 0 || this.atWork > 0) this.lastAtWork = this.now();
    this.atWork = n;
  }

  /** AWAKE-2.1: Fleet's list is read while the mode is on, whether or not a tab is connected. */
  private syncSessionsWatch(): void {
    const want = this.mode !== 'off' && !this.closed;
    if (want && !this.sessionsWatch) {
      this.sessionsWatch = this.opts.watchSessions?.() ?? null;
      this.recount();
    } else if (!want && this.sessionsWatch) {
      this.sessionsWatch();
      this.sessionsWatch = null;
    }
  }

  /** AWAKE-3.1: the power source is read every 10 s while a tab is connected (or the mode is Lid closed). */
  watch(): () => void {
    this.watchers++;
    if (this.watchers === 1) void this.readPower().then(() => this.schedulePower());
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.watchers = Math.max(0, this.watchers - 1);
      this.schedulePower();
    };
  }

  /** AWAKE-1.4: ends `caffeinate` and an owned Amphetamine session; the saved mode stays for the next start. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    this.syncSessionsWatch();
    // A call still running is cancelled (its process group ended), so the queue settles at once and
    // no call of its outlives the server; then the last `end session` runs alone.
    this.abort.abort();
    await this.queue.catch(() => {});
    this.stopHeld();
    if (this.owns) {
      try {
        await this.amphetamine(AMPHETAMINE.end, CLOSE_TIMEOUT_MS, null);
        this.owns = false;
      } catch {
        // Left owned: the next start ends it (AWAKE-3.3).
      }
    }
    this.save();
  }

  // --- the modes ---

  private turnOn(mode: 'awake' | 'lid', paused: 'battery' | 'foreign' | null = null): void {
    this.mode = mode;
    this.paused = mode === 'lid' ? paused : null;
    this.hold();
    this.syncSessionsWatch();
    this.save();
  }

  private turnOff(note: string | null = null): void {
    this.mode = 'off';
    this.paused = null;
    this.stopHeld();
    this.syncSessionsWatch();
    if (note) this.note = { text: note, at: this.now() };
    this.save();
  }

  /** AWAKE-3.2: asks first when a session Lookout doesn't own runs; a failed call leaves Awake (AWAKE-3.5). */
  private async chooseLid(replace: boolean): Promise<void> {
    try {
      const active = (await this.amphetamine(AMPHETAMINE.active)).trim() === 'true';
      if (active && !this.owns && !replace) throw new AwakeError(409, 'Amphetamine already has a session running.', AMPHETAMINE_BUSY);
      this.note = null;
      await this.startLid();
      this.onSince = this.now();
      this.turnOn('lid');
    } catch (e) {
      if (e instanceof AwakeError) throw e;
      await this.lidFailed(e);
    }
  }

  /** AWAKE-3.3, 3.4: Lid closed again without asking; one Lookout doesn't own keeps it paused. */
  private async resumeLid(): Promise<void> {
    try {
      const active = (await this.amphetamine(AMPHETAMINE.active)).trim() === 'true';
      if (active && !this.owns) {
        this.turnOn('lid', 'foreign');
        this.note = { text: NOTE.foreign, at: this.now() };
        return;
      }
      await this.startLid();
      this.turnOn('lid');
      if (this.note?.text === NOTE.battery || this.note?.text === NOTE.foreign) this.note = null;
    } catch (e) {
      await this.lidFailed(e);
    }
  }

  private async startLid(): Promise<void> {
    // Owned before it's asked for, so a session whose call outlives a crash is still ended on the
    // next start (AWAKE-3.2, 3.3). It's only reached with none running, or after Replace.
    this.owns = true;
    this.save();
    await this.amphetamine(AMPHETAMINE.start);
    await this.amphetamine(AMPHETAMINE.closedDisplay);
  }

  /** AWAKE-3.5: any failed call leaves Awake, with the reason. */
  private async lidFailed(e: unknown): Promise<void> {
    const err = e instanceof AmphetamineError ? e : amphetamineFailure(e, AMPHETAMINE_TIMEOUT_MS);
    if (err.refused) this.refused = true;
    await this.endLid();
    this.onSince = this.now();
    this.turnOn('awake');
    this.note = { text: NOTE.failed(err.message), at: this.now() };
  }

  /** AWAKE-3.3: only a session Lookout started; one it can't end stays owned, for the next try. */
  private async endLid(): Promise<void> {
    if (!this.owns) return;
    try {
      await this.amphetamine(AMPHETAMINE.end);
      this.owns = false;
      this.save();
    } catch (e) {
      const err = e instanceof AmphetamineError ? e : amphetamineFailure(e, AMPHETAMINE_TIMEOUT_MS);
      if (err.refused) this.refused = true;
      this.note = { text: `Couldn't end Amphetamine's session: ${err.message}`, at: this.now() };
    }
  }

  /** AWAKE-3.5: any call that succeeds clears a refusal; `signal` null only for the last call of `close()`. */
  private async amphetamine(script: string, timeoutMs = AMPHETAMINE_TIMEOUT_MS, signal: AbortSignal | null = this.abort.signal): Promise<string> {
    try {
      const out = await this.opts.runner(resolveSystemBin('osascript', this.env), ['-e', `tell application "Amphetamine" to ${script}`], { timeoutMs, env: this.env, ...(signal ? { signal } : {}) });
      this.refused = false;
      return out;
    } catch (e) {
      throw amphetamineFailure(e, timeoutMs);
    }
  }

  /** AWAKE-3.1: the charger, the app, its helper, in that order; a refusal is said but stays retryable. */
  private lidState(): AwakeSnapshot['lid'] {
    if (this.power !== 'ac') return { available: false, reason: LID_NEEDS_CHARGER };
    if (!this.appInstalled()) return { available: false, reason: LID_NEEDS_APP };
    if (!this.exists(join(this.home(), 'Library', 'Application Scripts', 'com.if.Amphetamine', 'powerProtect.scpt'))) return { available: false, reason: LID_NEEDS_HELPER };
    return { available: true, reason: this.refused ? LID_AUTOMATION : null };
  }

  private appInstalled(): boolean {
    if (this.env.LOOKOUT_AMPHETAMINE_APP) return this.exists(this.env.LOOKOUT_AMPHETAMINE_APP);
    return this.exists('/Applications/Amphetamine.app') || this.exists(join(this.home(), 'Applications', 'Amphetamine.app'));
  }

  private home(): string {
    return this.env.HOME || homedir();
  }

  // --- caffeinate ---

  /** AWAKE-1.2: one `caffeinate -i -w <pid>`, started again once if it exits on its own. */
  private hold(): void {
    if (this.held || this.closed) return;
    const proc = this.spawn(resolveSystemBin('caffeinate', this.env), ['-i', '-w', String(this.opts.pid)]);
    this.held = proc;
    proc.onExit((stderr) => {
      if (this.held !== proc) return; // ended on purpose
      this.held = null;
      if (this.mode === 'off' || this.closed) return;
      const now = this.now();
      if (this.lastExit !== null && now - this.lastExit < QUICK_EXIT_MS) {
        const reason = sanitizeLine(stderr.trim().split('\n')[0] || 'it exited', 200) ?? 'it exited';
        void this.run(async () => {
          await this.endLid();
          this.turnOff(NOTE.caffeinate(reason));
          this.reschedule();
          this.publish();
        });
        return;
      }
      this.lastExit = now;
      this.hold();
    });
  }

  private stopHeld(): void {
    const proc = this.held;
    this.held = null;
    proc?.kill();
  }

  // --- the clocks ---

  /** AWAKE-2.2: turns the mode off at its `offAt`, unless a Session is At work by then. */
  private reschedule(): void {
    if (this.offTimer) clearTimeout(this.offTimer);
    this.offTimer = null;
    if (this.closed) return;
    const at = offAtFor(this.mode, this.atWork, this.onSince, this.lastAtWork);
    if (at === null) return;
    this.offTimer = setTimeout(() => {
      this.offTimer = null;
      void this.run(async () => {
        const due = offAtFor(this.mode, this.atWork, this.onSince, this.lastAtWork);
        if (due === null || due > this.now()) return this.reschedule();
        await this.endLid();
        this.turnOff(NOTE.idle);
        this.reschedule();
        this.publish();
      });
    }, Math.max(0, at - this.now()));
    this.offTimer.unref?.();
  }

  private schedulePower(): void {
    if (this.powerTimer) clearTimeout(this.powerTimer);
    this.powerTimer = null;
    if (this.closed || (!this.watchers && this.mode !== 'lid')) return;
    this.powerTimer = setTimeout(() => {
      this.powerTimer = null;
      void this.readPower().then(() => this.schedulePower());
    }, POWER_INTERVAL_MS);
    this.powerTimer.unref?.();
  }

  /** AWAKE-3.1: `pmset -g batt`; a failed read keeps the last answer. */
  private async readPowerSource(): Promise<void> {
    try {
      const out = await this.opts.runner(resolveSystemBin('pmset', this.env), ['-g', 'batt'], { timeoutMs: PMSET_TIMEOUT_MS, env: this.env, signal: this.abort.signal });
      const source = parsePowerSource(out);
      if (source) this.power = source;
    } catch {
      // keep the last answer
    }
  }

  /** AWAKE-3.1, 3.3, 3.4: the power source, and what Lid closed does about it and about its session. */
  private readPower(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.reading ??= (async () => {
      await this.readPowerSource();
      if (this.closed) return;
      if (this.mode === 'lid' && this.power === 'battery' && !this.paused) {
        await this.run(async () => {
          if (this.mode !== 'lid' || this.paused) return;
          await this.endLid();
          this.paused = 'battery';
          this.note = { text: NOTE.battery, at: this.now() };
          this.publish();
        });
      } else if (this.mode === 'lid' && this.power === 'ac' && this.paused === 'battery') {
        await this.run(async () => {
          if (this.mode !== 'lid' || this.paused !== 'battery') return;
          await this.resumeLid();
          this.reschedule();
          this.publish();
        });
      } else if (this.mode === 'lid' && !this.paused && this.owns) {
        // AWAKE-3.3: its session ended outside Lookout (Amphetamine's own menu) is no longer its own.
        await this.run(async () => {
          if (this.mode !== 'lid' || this.paused || !this.owns) return;
          let active: boolean;
          try {
            active = (await this.amphetamine(AMPHETAMINE.active)).trim() === 'true';
          } catch {
            return; // a check that fails changes nothing
          }
          if (active) return;
          this.owns = false;
          this.turnOn('awake');
          this.note = { text: NOTE.ended, at: this.now() };
          this.reschedule();
          this.publish();
        });
      }
      this.publish();
    })().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  private clearTimers(): void {
    if (this.offTimer) clearTimeout(this.offTimer);
    if (this.powerTimer) clearTimeout(this.powerTimer);
    this.offTimer = this.powerTimer = null;
  }

  // --- plumbing ---

  private run<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  /** AWAKE-1.1: an `awake` event only when the snapshot changed, each with the next `rev`. */
  private publish(): void {
    const { rev: _rev, ...rest } = this.snapshot();
    const key = JSON.stringify(rest);
    if (key === this.published) return;
    this.published = key;
    this.rev++;
    this.opts.onChange(this.snapshot());
  }

  /** AWAKE-1.3: unreadable counts as off. */
  private load(): Saved {
    try {
      const raw = JSON.parse(readFileSync(this.opts.file, 'utf8')) as Partial<Saved>;
      const mode = raw.mode === 'awake' || raw.mode === 'lid' ? raw.mode : 'off';
      return { mode, ownsAmphetamine: raw.ownsAmphetamine === true };
    } catch {
      return { mode: 'off', ownsAmphetamine: false };
    }
  }

  /** AWAKE-1.3: written whole to a new file, then renamed over the old one. */
  private save(): void {
    try {
      mkdirSync(dirname(this.opts.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.opts.file}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify({ mode: this.mode, ownsAmphetamine: this.owns } satisfies Saved)}\n`, { mode: 0o600 });
      renameSync(tmp, this.opts.file);
    } catch (err) {
      console.warn(`lookout: keep-awake: saving failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
