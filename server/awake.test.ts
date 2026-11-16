import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AMPHETAMINE_BUSY, type AwakeSnapshot, LID_AUTOMATION, LID_NEEDS_APP, LID_NEEDS_CHARGER, LID_NEEDS_HELPER } from '../shared/awake.ts';
import type { SessionRow } from '../shared/types.ts';
import { AMPHETAMINE, AMPHETAMINE_TIMEOUT_MS, AwakeError, type HeldProcess, KeepAwake, NOTE, parsePowerSource } from './awake.ts';
import type { RunOptions } from './exec.ts';

const T0 = Date.UTC(2026, 10, 16, 9, 0, 0);
const MIN = 60_000;
const PID = 4747;
const HOME = '/Users/someone';
const APP = '/Applications/Amphetamine.app';
const HELPER = `${HOME}/Library/Application Scripts/com.if.Amphetamine/powerProtect.scpt`;
const AC = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true\n";
const BATTERY = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t88%; discharging; 5:10 remaining present: true\n";

type Row = Pick<SessionRow, 'status' | 'subagents' | 'backgroundShell'>;
const idle: Row = { status: 'idle', subagents: null, backgroundShell: false };
const busy: Row = { status: 'busy', subagents: null, backgroundShell: false };

interface Held extends HeldProcess {
  args: readonly string[];
  file: string;
  killed: boolean;
  exit(stderr: string): void;
}

let dir: string;
let file: string;
let rows: Row[];
let power: string;
let active: boolean;
let installed: Set<string>;
let fail: Partial<Record<keyof typeof AMPHETAMINE, Error>>;
let calls: { file: string; args: readonly string[]; opts: RunOptions }[];
let held: Held[];
let events: AwakeSnapshot[];
/** Amphetamine calls that wait until they're cancelled, and how long `pmset` takes. */
let slow: Partial<Record<keyof typeof AMPHETAMINE, boolean>>;
let pmsetDelay: number;
let watching: number;
let ownedWhenStarted: boolean[];

const cancelled = () => Object.assign(new Error('osascript was cancelled'), { aborted: true, code: null });

function runner(f: string, args: readonly string[], opts: RunOptions): Promise<string> {
  calls.push({ file: f, args, opts });
  if (opts.signal?.aborted) return Promise.reject(cancelled());
  if (f.endsWith('pmset')) return pmsetDelay ? new Promise((r) => setTimeout(() => r(power), pmsetDelay)) : Promise.resolve(power);
  const script = args[1]!.replace('tell application "Amphetamine" to ', '');
  const key = (Object.keys(AMPHETAMINE) as (keyof typeof AMPHETAMINE)[]).find((k) => AMPHETAMINE[k] === script);
  if (!key) return Promise.reject(new Error(`unexpected ${script}`));
  if (key === 'start') ownedWhenStarted.push(saved().ownsAmphetamine);
  if (slow[key]) return new Promise((_, reject) => opts.signal?.addEventListener('abort', () => reject(cancelled())));
  if (fail[key]) return Promise.reject(fail[key]);
  if (key === 'active') return Promise.resolve(`${active}\n`);
  if (key === 'start') active = true;
  if (key === 'end') active = false;
  return Promise.resolve('');
}

function spawn(f: string, args: readonly string[]): HeldProcess {
  const listeners: ((s: string) => void)[] = [];
  const h: Held = {
    file: f,
    args,
    killed: false,
    kill: () => {
      h.killed = true;
    },
    onExit: (l) => listeners.push(l),
    exit: (stderr) => {
      h.killed = true; // gone, as a process that exited
      listeners.forEach((l) => l(stderr));
    },
  };
  held.push(h);
  return h;
}

function make(env: NodeJS.ProcessEnv = {}) {
  return new KeepAwake({
    runner,
    spawn,
    sessions: () => rows as SessionRow[],
    onChange: (s) => events.push(s),
    file,
    pid: PID,
    env: { PATH: '', HOME, ...env },
    exists: (p) => installed.has(p),
    watchSessions: () => {
      watching++;
      let released = false;
      return () => {
        if (!released) watching--;
        released = true;
      };
    },
  });
}

const amphetamineCalls = () => calls.filter((c) => !c.file.endsWith('pmset')).map((c) => c.args[1]!.replace('tell application "Amphetamine" to ', ''));
const running = () => held.filter((h) => !h.killed);
const saved = () => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as { mode: string; ownsAmphetamine: boolean };
  } catch {
    return { mode: 'none', ownsAmphetamine: false };
  }
};

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  dir = mkdtempSync(join(tmpdir(), 'awake-'));
  file = join(dir, '.lookout', 'keep-awake.json');
  rows = [];
  power = AC;
  active = false;
  installed = new Set([APP, HELPER]);
  fail = {};
  calls = [];
  held = [];
  events = [];
  slow = {};
  pmsetDelay = 0;
  watching = 0;
  ownedWhenStarted = [];
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

describe('AWAKE-1 the switch', () => {
  it('AWAKE-1.2: Awake runs one `caffeinate -i -w <the server pid>`, never -d; Off ends it', async () => {
    const k = make();
    await k.start();
    await k.set('awake');
    await k.set('awake');
    expect(running().map((h) => [h.file, h.args])).toEqual([['caffeinate', ['-i', '-w', String(PID)]]]);
    expect(held.flatMap((h) => h.args)).not.toContain('-d');
    await k.set('off');
    expect(running()).toEqual([]);
    expect(k.snapshot().mode).toBe('off');
  });

  it('AWAKE-1.2: a caffeinate that exits on its own is started again; a second exit within 5 s turns keep-awake off, saying why', async () => {
    const k = make();
    await k.start();
    await k.set('awake');
    held[0]!.exit('');
    expect(running()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    held[1]!.exit('');
    expect(running()).toHaveLength(1);
    expect(k.snapshot().mode).toBe('awake');
    await vi.advanceTimersByTimeAsync(2_000);
    held[2]!.exit('caffeinate: failed to assert\nmore');
    await vi.advanceTimersByTimeAsync(0);
    expect(k.snapshot()).toMatchObject({ mode: 'off', note: { text: 'caffeinate stopped: caffeinate: failed to assert' } });
    expect(running()).toEqual([]);
  });

  it('AWAKE-1.3: the mode is saved whole, private, and comes back on the next start with the 5-minute clock starting then', async () => {
    const k = make();
    await k.start();
    await k.set('awake');
    expect(saved()).toEqual({ mode: 'awake', ownsAmphetamine: false });
    expect(statSync(file).mode & 0o777).toBe(0o600);

    held = [];
    vi.setSystemTime(T0 + 60 * MIN);
    const next = make();
    await next.start();
    expect(next.snapshot()).toMatchObject({ mode: 'awake', holding: 'awake', offAt: T0 + 65 * MIN });
    expect(running()).toHaveLength(1);
  });

  it("AWAKE-1.3: a file it can't read counts as off", async () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{not json');
    const k = make();
    await k.start();
    expect(k.snapshot().mode).toBe('off');
    expect(held).toEqual([]);
  });

  it('AWAKE-1.4: stopping ends caffeinate and an owned Amphetamine session, and keeps the mode for the next start', async () => {
    const k = make();
    await k.start();
    await k.set('lid');
    expect(saved()).toEqual({ mode: 'lid', ownsAmphetamine: true });
    await k.close();
    expect(running()).toEqual([]);
    expect(amphetamineCalls().at(-1)).toBe(AMPHETAMINE.end);
    expect(saved()).toEqual({ mode: 'lid', ownsAmphetamine: false });
    await expect(k.set('awake')).rejects.toMatchObject({ status: 503 });
  });
});

describe('AWAKE-1 after review', () => {
  it('AWAKE-1.1: each change sends the next rev; a read with nothing new sends nothing', async () => {
    const k = make();
    await k.start();
    const before = events.length;
    await k.set('awake');
    expect(events.length).toBe(before + 1);
    expect(events.at(-1)!.rev).toBe(k.snapshot().rev);
    k.sessionsChanged();
    expect(events.length).toBe(before + 1);
    rows = [busy];
    k.sessionsChanged();
    expect(events.at(-1)!.rev).toBe(events.at(-2)!.rev + 1);
  });

  it('AWAKE-1.3: a pick made while the saved mode is being restored waits for it, and stands', async () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ mode: 'awake', ownsAmphetamine: false }));
    pmsetDelay = 200;
    const k = make();
    const starting = k.start();
    const picked = k.set('off');
    await vi.advanceTimersByTimeAsync(200);
    await starting;
    expect((await picked).mode).toBe('off');
    expect(k.snapshot().mode).toBe('off');
    expect(saved().mode).toBe('off');
    expect(running()).toEqual([]);
  });

  it('AWAKE-1.4: stopping cancels an Amphetamine call still running, then ends the session it owns, alone', async () => {
    slow.start = true;
    const k = make();
    await k.start();
    const picking = k.set('lid');
    await vi.advanceTimersByTimeAsync(0);
    expect(amphetamineCalls()).toEqual([AMPHETAMINE.active, AMPHETAMINE.start]);
    delete slow.start;
    await k.close();
    await picking;
    const start = calls.find((c) => c.args[1]?.endsWith(AMPHETAMINE.start))!;
    expect(start.opts.signal?.aborted).toBe(true);
    // The last call is close()'s own `end session`, not cancelled, after the cancelled ones.
    const last = calls.at(-1)!;
    expect(last.args[1]).toContain(AMPHETAMINE.end);
    expect(last.opts.signal).toBeUndefined();
    expect(saved().ownsAmphetamine).toBe(false);
    expect(running()).toEqual([]);
  });
});

describe('AWAKE-2 it turns itself off', () => {
  it('AWAKE-2.1: the count of Sessions At work follows the rows: Busy, or a running Subagent or background shell command, whatever the Status', async () => {
    const k = make();
    await k.start();
    rows = [busy, idle, { ...idle, subagents: { running: 1, finished: 0 } }, { ...idle, backgroundShell: true }, { status: 'needs-you', subagents: null, backgroundShell: false }];
    k.sessionsChanged();
    expect(k.snapshot().atWork).toBe(3);
  });

  it('AWAKE-2.1: while on, it holds a read of Fleet’s list, so who’s At work is known with no tab open; off and stopping release it', async () => {
    rows = [busy];
    const k = make();
    await k.start();
    expect(watching).toBe(0);
    await k.set('awake');
    expect(watching).toBe(1);
    expect(k.snapshot().atWork).toBe(1); // counted at once, not at the next change
    await k.set('lid');
    expect(watching).toBe(1);
    await k.set('off');
    expect(watching).toBe(0);
    await k.set('awake');
    await k.close();
    expect(watching).toBe(0);

    // A restored mode holds it too.
    const next = make();
    await next.start();
    expect(watching).toBe(1);
  });

  it('AWAKE-2.2: with no Session At work, it turns off 5 minutes after it was turned on, saying why', async () => {
    const k = make();
    await k.start();
    await k.set('awake');
    await vi.advanceTimersByTimeAsync(5 * MIN - 1);
    expect(k.snapshot().mode).toBe('awake');
    await vi.advanceTimersByTimeAsync(1);
    expect(k.snapshot()).toMatchObject({ mode: 'off', note: { text: NOTE.idle, at: T0 + 5 * MIN } });
    expect(running()).toEqual([]);
    expect(saved().mode).toBe('off');
  });

  it('AWAKE-2.2: a Session At work stops the clock; the 5 minutes run from the moment it stopped', async () => {
    const k = make();
    await k.start();
    await k.set('awake');
    await vi.advanceTimersByTimeAsync(4 * MIN);
    rows = [busy];
    k.sessionsChanged();
    await vi.advanceTimersByTimeAsync(2 * MIN);
    rows = [idle];
    k.sessionsChanged();
    await vi.advanceTimersByTimeAsync(5 * MIN - 1);
    expect(k.snapshot().mode).toBe('awake');
    await vi.advanceTimersByTimeAsync(1);
    expect(k.snapshot().mode).toBe('off');
  });

  it('AWAKE-2.2: Lid closed turns off the same way, ending its Amphetamine session', async () => {
    const k = make();
    await k.start();
    await k.set('lid');
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(k.snapshot().mode).toBe('off');
    expect(amphetamineCalls().at(-1)).toBe(AMPHETAMINE.end);
  });

  it('AWAKE-2.3: the snapshot says how many are At work and, while none is, when it turns off', async () => {
    const k = make();
    await k.start();
    await k.set('awake');
    expect(k.snapshot()).toMatchObject({ atWork: 0, offAt: T0 + 5 * MIN });
    rows = [busy, busy];
    k.sessionsChanged();
    expect(k.snapshot()).toMatchObject({ atWork: 2, offAt: null });
    expect(events.at(-1)).toMatchObject({ atWork: 2, offAt: null });
  });
});

describe('AWAKE-3 Lid closed', () => {
  it('AWAKE-3.1: available only on the charger, with Amphetamine and its helper; otherwise the reason, in that order, and choosing it is a 409', async () => {
    power = BATTERY;
    installed = new Set();
    const k = make();
    await k.start();
    expect(k.snapshot().lid).toEqual({ available: false, reason: LID_NEEDS_CHARGER });
    await expect(k.set('lid')).rejects.toMatchObject({ status: 409, message: LID_NEEDS_CHARGER });

    power = AC;
    const w = k.watch();
    await vi.advanceTimersByTimeAsync(0);
    expect(k.snapshot().lid).toEqual({ available: false, reason: LID_NEEDS_APP });
    installed.add(`${HOME}/Applications/Amphetamine.app`);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(k.snapshot().lid).toEqual({ available: false, reason: LID_NEEDS_HELPER });
    installed.add(HELPER);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(k.snapshot().lid).toEqual({ available: true, reason: null });
    w();
    expect(amphetamineCalls()).toEqual([]);
  });

  it('AWAKE-3.1: LOOKOUT_AMPHETAMINE_APP overrides where the app is looked for', async () => {
    const k = make({ LOOKOUT_AMPHETAMINE_APP: '/nowhere/Amphetamine.app' });
    await k.start();
    expect(k.snapshot().lid).toEqual({ available: false, reason: LID_NEEDS_APP });
    expect(parsePowerSource(AC)).toBe('ac');
    expect(parsePowerSource(BATTERY)).toBe('battery');
  });

  it('AWAKE-3.2: with no session running it starts one, display sleep allowed, then closed display mode; it owns it, and caffeinate runs beside it', async () => {
    const k = make();
    await k.start();
    const snap = await k.set('lid');
    expect(amphetamineCalls()).toEqual([AMPHETAMINE.active, AMPHETAMINE.start, AMPHETAMINE.closedDisplay]);
    expect(AMPHETAMINE.start).toContain('displaySleepAllowed:true');
    expect(snap).toMatchObject({ mode: 'lid', holding: 'lid', note: null });
    expect(saved()).toEqual({ mode: 'lid', ownsAmphetamine: true });
    expect(running()).toHaveLength(1);
  });

  it("AWAKE-3.2: a session Lookout doesn't own is refused as amphetamine-busy until you say replace", async () => {
    active = true;
    const k = make();
    await k.start();
    const refused = await k.set('lid').catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(AwakeError);
    expect(refused).toMatchObject({ status: 409, kind: AMPHETAMINE_BUSY });
    expect(amphetamineCalls()).toEqual([AMPHETAMINE.active]);
    expect(k.snapshot().mode).toBe('off');
    expect(held).toEqual([]);

    await k.set('lid', true);
    expect(amphetamineCalls()).toEqual([AMPHETAMINE.active, AMPHETAMINE.active, AMPHETAMINE.start, AMPHETAMINE.closedDisplay]);
    expect(k.snapshot().holding).toBe('lid');
  });

  it("AWAKE-3.3: it never ends a session it didn't start", async () => {
    const k = make();
    await k.start();
    await k.set('awake');
    active = true; // your own Amphetamine session
    await k.set('off');
    await k.close();
    expect(amphetamineCalls()).toEqual([]);
  });

  it('AWAKE-3.3: an owned session left by a server that stopped badly is ended first, then the saved mode comes back', async () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ mode: 'lid', ownsAmphetamine: true }));
    active = true;
    const k = make();
    await k.start();
    expect(amphetamineCalls()).toEqual([AMPHETAMINE.end, AMPHETAMINE.active, AMPHETAMINE.start, AMPHETAMINE.closedDisplay]);
    expect(k.snapshot()).toMatchObject({ mode: 'lid', holding: 'lid' });
  });

  it('AWAKE-3.4: on battery it ends its session and runs as Awake; back on the charger it starts one again', async () => {
    const k = make();
    await k.start();
    await k.set('lid');
    power = BATTERY;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(k.snapshot()).toMatchObject({ mode: 'lid', holding: 'awake', note: { text: NOTE.battery } });
    expect(amphetamineCalls().at(-1)).toBe(AMPHETAMINE.end);
    expect(running()).toHaveLength(1);

    power = AC;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(k.snapshot()).toMatchObject({ mode: 'lid', holding: 'lid', note: null });
    expect(amphetamineCalls().slice(-3)).toEqual([AMPHETAMINE.active, AMPHETAMINE.start, AMPHETAMINE.closedDisplay]);
  });

  it("AWAKE-3.4: back on the charger with a session of Amphetamine's own, it stays Awake without asking", async () => {
    const k = make();
    await k.start();
    await k.set('lid');
    power = BATTERY;
    await vi.advanceTimersByTimeAsync(10_000);
    active = true; // started by you meanwhile
    power = AC;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(k.snapshot()).toMatchObject({ mode: 'lid', holding: 'awake', note: { text: NOTE.foreign } });
    expect(amphetamineCalls().at(-1)).toBe(AMPHETAMINE.active);
  });

  it('AWAKE-3.5: a failed call leaves Awake, with the reason; every call waits up to 60 s', async () => {
    fail.closedDisplay = Object.assign(new Error('osascript failed'), { stderr: '0:42: execution error: Amphetamine got an error: Can’t continue. (-1708)\n' });
    const k = make();
    await k.start();
    const snap = await k.set('lid');
    expect(snap).toMatchObject({ mode: 'awake', holding: 'awake', note: { text: NOTE.failed('Amphetamine got an error: Can’t continue. (-1708)') } });
    // The session it started is its own, so it ends it.
    expect(amphetamineCalls()).toEqual([AMPHETAMINE.active, AMPHETAMINE.start, AMPHETAMINE.closedDisplay, AMPHETAMINE.end]);
    expect(calls.filter((c) => !c.file.endsWith('pmset')).every((c) => c.opts.timeoutMs === AMPHETAMINE_TIMEOUT_MS)).toBe(true);
    expect(AMPHETAMINE_TIMEOUT_MS).toBe(60_000);
    expect(running()).toHaveLength(1);
  });

  it('AWAKE-3.5: refused by macOS (-1743), Lid closed says how to allow it, stays choosable, and a later success clears it', async () => {
    fail.active = Object.assign(new Error('osascript failed'), { stderr: '0:31: execution error: Not authorized to send Apple events to Amphetamine. (-1743)\n' });
    const k = make();
    await k.start();
    const snap = await k.set('lid');
    expect(snap).toMatchObject({ mode: 'awake', lid: { available: true, reason: LID_AUTOMATION }, note: { text: NOTE.failed(LID_AUTOMATION) } });
    delete fail.active;
    const again = await k.set('lid');
    expect(again).toMatchObject({ mode: 'lid', holding: 'lid', lid: { available: true, reason: null }, note: null });
  });

  it('AWAKE-3.2: it saves that it owns the session before it asks for one', async () => {
    const k = make();
    await k.start();
    await k.set('lid');
    expect(ownedWhenStarted).toEqual([true]);
  });

  it('AWAKE-3.3: a session of its own ended outside Lookout is no longer its own: Awake, with a note, and nothing ended', async () => {
    const k = make();
    await k.start();
    await k.set('lid');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(k.snapshot().mode).toBe('lid');
    active = false; // ended from Amphetamine's menu
    await vi.advanceTimersByTimeAsync(10_000);
    expect(k.snapshot()).toMatchObject({ mode: 'awake', holding: 'awake', note: { text: NOTE.ended } });
    expect(saved()).toEqual({ mode: 'awake', ownsAmphetamine: false });
    await k.set('off');
    expect(amphetamineCalls()).not.toContain(AMPHETAMINE.end);
  });

  it('AWAKE-3.5: any call that succeeds clears a refusal, even one answered with amphetamine-busy', async () => {
    fail.active = Object.assign(new Error('osascript failed'), { stderr: 'execution error: Not authorized to send Apple events to Amphetamine. (-1743)\n' });
    const k = make();
    await k.start();
    await k.set('lid');
    expect(k.snapshot().lid.reason).toBe(LID_AUTOMATION);
    delete fail.active;
    active = true;
    await expect(k.set('lid')).rejects.toMatchObject({ kind: AMPHETAMINE_BUSY });
    expect(k.snapshot().lid).toEqual({ available: true, reason: null });
  });

  it('AWAKE-3.5: a call that times out says so', async () => {
    fail.active = Object.assign(new Error('timed out'), { timedOut: true });
    const k = make();
    await k.start();
    expect((await k.set('lid')).note?.text).toBe(NOTE.failed("Amphetamine didn't answer in 60 s"));
  });
});
