import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FakeCommand, FakeViolation } from './index.ts';

/**
 * How a World and its fake `tb-prod` and `tb-pr` talk (TEST-1.5, TEST-1.6): through files in the
 * fake's own directory, `<World root>/fakes/<name>/`, which its `bin/` wrapper names.
 *
 * - `answer.json`: what the fake answers. A call reads it once, when it starts. The World replaces it
 *   whole (a rename, so no call reads half of it), and the next call answers what it says.
 * - `hold`: a hold the test armed, holding its id. The next call takes it (renaming it away, so only
 *   one call can), writes `held-<id>.json` with its argv, and waits until `release-<id>` exists. It
 *   then answers what it read when it started.
 * - `calls.jsonl`: each call's argv, one JSON array per line.
 * - `hanging-<pid>.json`: written by a call that read an answer it never gives (a declared timeout),
 *   with its argv, once it has read it and is about to wait: a test measures the silence from there.
 *
 * A call the fake doesn't answer is a violation: it goes to the World's violations log, and the
 * Behaviour test fails naming it (`RunningWorld.violations`).
 */

/** The fakes a test steers this way. */
export type FakeName = Extract<FakeCommand, 'tb-prod' | 'tb-pr' | 'tb-session'>;

/** Set by the fake's `bin/` wrapper: its directory, and the World's violations log. */
export const STATE_ENV = 'LOOKOUT_FAKE_STATE';
export const VIOLATIONS_ENV = 'LOOKOUT_FAKE_VIOLATIONS';

const ANSWER = 'answer.json';
const HOLD = 'hold';
const CALLS = 'calls.jsonl';
const heldFile = (id: string) => `held-${id}.json`;
const HANGING = /^hanging-\d+\.json$/;
const releaseFile = (id: string) => `release-${id}`;
/** How long a fake that never answers (a declared timeout, a call nobody releases) waits before it gives up. */
const HANG_MS = 10 * 60_000;

/** What a call prints and how it exits. */
export interface Printed {
  stdout?: string;
  stderr?: string;
  code: number;
}
/** What a call prints and how it exits, or that it never answers. */
export type Outcome = Printed | { hang: true };
/**
 * A call the fake doesn't answer, and why. `outcome` is what the real command prints where it
 * refuses the call itself (a usage error, a filter it rejects); without it, the fake says it refused.
 */
export interface Refusal {
  refused: string;
  outcome?: Printed;
}

function writeWhole(path: string, text: string): void {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function readLines<T>(path: string): T[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The fake's side of one call: logs its argv, reads the answer, refuses what it doesn't answer,
 * waits while it is held, then prints `respond`'s outcome. `respond` gets the declaration read when
 * the call started, and the moment it started.
 */
export async function serveCall<A>(name: FakeName, respond: (argv: string[], answer: A, now: Date) => Outcome | Refusal): Promise<void> {
  const argv = process.argv.slice(2);
  const dir = process.env[STATE_ENV];
  const violations = process.env[VIOLATIONS_ENV];
  if (!dir || !violations) {
    process.stderr.write(`fake ${name}: runs only from a World's bin/ (${STATE_ENV} is not set)\n`);
    process.exitCode = 2;
    return;
  }
  appendFileSync(join(dir, CALLS), `${JSON.stringify(argv)}\n`);
  const outcome = respond(argv, JSON.parse(readFileSync(join(dir, ANSWER), 'utf8')) as A, new Date());

  if ('refused' in outcome) {
    const v: FakeViolation = { command: name, argv, why: outcome.refused };
    appendFileSync(violations, `${JSON.stringify(v)}\n`);
    const shown = outcome.outcome ?? { stderr: `fake ${name}: refused \`${[name, ...argv].join(' ')}\`: ${outcome.refused}\n`, code: 2 };
    if (shown.stdout) process.stdout.write(shown.stdout);
    if (shown.stderr) process.stderr.write(shown.stderr);
    process.exitCode = shown.code;
    return;
  }

  // Held: take the armed hold, if there is one, and wait for its release.
  const taking = join(dir, `taking-${process.pid}`);
  let holdId: string | null = null;
  try {
    renameSync(join(dir, HOLD), taking);
    holdId = readFileSync(taking, 'utf8').trim();
    rmSync(taking, { force: true });
  } catch {
    // no hold armed, or another call took it
  }
  if (holdId) {
    writeWhole(join(dir, heldFile(holdId)), JSON.stringify({ pid: process.pid, argv }));
    for (const until = Date.now() + HANG_MS; !existsSync(join(dir, releaseFile(holdId))) && Date.now() < until; ) await sleep(20);
  }

  if ('hang' in outcome) {
    writeWhole(join(dir, `hanging-${process.pid}.json`), JSON.stringify({ argv }));
    process.exitCode = 1;
    setTimeout(() => {}, HANG_MS);
    return;
  }
  // Pipes are written asynchronously on macOS: the process ends once they're flushed, not before.
  if (outcome.stdout) process.stdout.write(outcome.stdout);
  if (outcome.stderr) process.stderr.write(outcome.stderr);
  process.exitCode = outcome.code;
}

/** The violations a World's fakes recorded (TEST-1.5); each fails the Behaviour test. */
export function readViolations(path: string): FakeViolation[] {
  return readLines<FakeViolation>(path);
}

/**
 * A test's controls for one fake (TEST-1.6): `world.tbProd`, `world.tbPr`. Every method throws when
 * the World doesn't have the fake.
 */
export class FakeControl<A> {
  readonly name: FakeName;
  /** The fake's directory, or null when the World doesn't declare it. */
  private readonly dir: string | null;
  private readonly check: (answer: A) => A;
  private readonly waitUntil: (what: string, check: () => boolean, opts?: { timeoutMs?: number }) => Promise<void>;
  private armed: string | null = null;
  private holds = 0;
  /** The `hanging-<pid>.json` files `hanging()` already returned. */
  private readonly hung = new Set<string>();
  /** Every answer the World gave it, the declared one first, each with the time it was set. */
  private readonly answers: { at: string; answer: A }[] = [];

  constructor(name: FakeName, dir: string | null, check: (answer: A) => A, waitUntil: FakeControl<A>['waitUntil']) {
    this.name = name;
    this.dir = dir;
    this.check = check;
    this.waitUntil = waitUntil;
  }

  private need(): string {
    if (this.dir === null) {
      const method = this.name === 'tb-prod' ? 'tbProd' : this.name === 'tb-pr' ? 'tbPr' : 'outputs';
      throw new Error(`This World has no ${this.name}: declare it with world().${method}(…).`);
    }
    return this.dir;
  }

  /** From the next call on, the fake answers this. A call already running keeps what it read. */
  answer(next: A): void {
    const checked = this.check(next);
    writeWhole(join(this.need(), ANSWER), JSON.stringify(checked));
    // The calls log's time of day, to line the two up (TEST-2.4).
    this.answers.push({ at: new Date().toTimeString().slice(0, 8), answer: checked });
  }

  /** For the failure report (TEST-2.4): its answers in the order they were set; the last is current. */
  history(): { at: string; answer: A }[] {
    return structuredClone(this.answers);
  }

  /** Holds the next call in flight, after it read its answer, until `release()`. One hold at a time. */
  hold(): void {
    const dir = this.need();
    if (this.armed !== null) throw new Error(`A ${this.name} call is already held: release() it first.`);
    this.armed = String(++this.holds);
    writeWhole(join(dir, HOLD), this.armed);
  }

  /** Waits until the held call is in flight, and returns its argv. */
  async held(opts: { timeoutMs?: number } = {}): Promise<string[]> {
    const dir = this.need();
    const id = this.armed;
    if (id === null) throw new Error(`No ${this.name} call is held: hold() one first.`);
    const path = join(dir, heldFile(id));
    await this.waitUntil(`a ${this.name} call to be held in flight`, () => existsSync(path), opts);
    return (JSON.parse(readFileSync(path, 'utf8')) as { argv: string[] }).argv;
  }

  /** Lets the held call answer; a hold no call took yet is dropped. */
  release(): void {
    const dir = this.need();
    if (this.armed === null) throw new Error(`No ${this.name} call is held: hold() one first.`);
    writeFileSync(join(dir, releaseFile(this.armed)), '');
    rmSync(join(dir, HOLD), { force: true });
    this.armed = null;
  }

  /**
   * Waits until a call that read a timeout answer is in flight, never to answer, and returns its
   * argv: from then on, its silence is the fake's, not a slow start's. Each call is returned once.
   */
  async hanging(opts: { timeoutMs?: number } = {}): Promise<string[]> {
    const dir = this.need();
    const next = () => readdirSync(dir).find((f) => HANGING.test(f) && !this.hung.has(f));
    await this.waitUntil(`a ${this.name} call to read its timeout answer`, () => next() !== undefined, opts);
    const file = next();
    if (file === undefined) throw new Error(`No ${this.name} call read its timeout answer.`);
    this.hung.add(file);
    return (JSON.parse(readFileSync(join(dir, file), 'utf8')) as { argv: string[] }).argv;
  }

  /** The argv of every call so far, in the order they started. */
  calls(): string[][] {
    return readLines<string[]>(join(this.need(), CALLS));
  }
}
