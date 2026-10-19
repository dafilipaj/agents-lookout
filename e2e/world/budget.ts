/**
 * TEST-2.6: a Behaviour test that runs past its budget fails, naming what it was waiting for.
 * The World remembers what a test said it waits for (`world.step`, `world.waitUntil`).
 */

/** A Behaviour test's own budget; Playwright's timeout sits above it to cover World start and teardown. */
export const SCENARIO_BUDGET_MS = 30_000;

/** A scenario may shorten its budget, never lengthen it. */
export function checkBudget(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0 || ms > SCENARIO_BUDGET_MS) {
    throw new Error(`A Behaviour test's budget can only be shortened: budgetMs must be in (0, ${SCENARIO_BUDGET_MS}], got ${ms}.`);
  }
}

export interface Waiting {
  /** What the test is waiting for right now; null between waits. */
  readonly waitingFor: string | null;
  /** What it waited for last, also after that wait ended. */
  readonly lastWait: string | null;
}

export class BudgetExceeded extends Error {
  constructor(ms: number, waiting: Waiting) {
    const what = waiting.waitingFor
      ? `waiting for ${waiting.waitingFor}`
      : waiting.lastWait
        ? `after waiting for ${waiting.lastWait}`
        : 'without naming what it waited for (wrap the wait in world.step)';
    super(`The Behaviour test ran past ${fmt(ms)}, ${what}.`);
    this.name = 'BudgetExceeded';
  }
}

export class WaitTimedOut extends Error {
  constructor(ms: number, what: string) {
    super(`Timed out after ${fmt(ms)} waiting for ${what}.`);
    this.name = 'WaitTimedOut';
  }
}

/** A Behaviour test's budget, running (`Waits.budget`). */
export interface Budget {
  /**
   * Ends it. Returns the overrun when the test ran past it, by the monotonic clock: that also
   * catches time spent where no timer could fire (a synchronous stretch).
   */
  end(): BudgetExceeded | null;
}

/** Names the waits of one Behaviour test. */
export class Waits implements Waiting {
  waitingFor: string | null = null;
  lastWait: string | null = null;
  /** Set once the budget ran out: every later wait fails at once. */
  private expiredMs: number | null = null;
  private readonly pending = new Set<(err: Error) => void>();

  /** Runs `fn` as a wait for `what`. Once the budget runs out, the wait fails naming `what`. */
  async step<T>(what: string, fn: () => Promise<T>): Promise<T> {
    if (this.expiredMs !== null) throw new BudgetExceeded(this.expiredMs, { waitingFor: what, lastWait: what });
    const outer = this.waitingFor;
    this.waitingFor = what;
    this.lastWait = what;
    let cancel: (err: Error) => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      cancel = reject;
    });
    cancelled.catch(() => {});
    this.pending.add(cancel);
    try {
      return await Promise.race([fn(), cancelled]);
    } finally {
      this.pending.delete(cancel);
      this.waitingFor = outer;
    }
  }

  /** Starts a budget of `ms`: when it runs out, the waits in progress fail naming the innermost. */
  budget(ms: number): Budget {
    checkBudget(ms);
    const started = performance.now();
    const timer = setTimeout(() => {
      this.expiredMs = ms;
      const err = new BudgetExceeded(ms, this);
      for (const cancel of this.pending) cancel(err);
    }, ms);
    return {
      end: () => {
        clearTimeout(timer);
        return performance.now() - started > ms ? new BudgetExceeded(ms, this) : null;
      },
    };
  }

  /** Polls `check` until it returns true, or fails naming `what`. */
  waitUntil(what: string, check: () => Promise<boolean> | boolean, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? 5000;
    return this.step(what, async () => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (await check()) return;
        if (Date.now() > deadline) throw new WaitTimedOut(timeoutMs, what);
        await new Promise((r) => setTimeout(r, opts.intervalMs ?? 100));
      }
    });
  }
}

/**
 * Runs `fn`, failing with BudgetExceeded once it runs past `ms`. The timer catches a wait that
 * never ends; the monotonic clock checked afterwards catches time spent where no timer can fire
 * (a synchronous stretch).
 */
export async function withinBudget<T>(ms: number, waiting: Waiting, fn: () => Promise<T>): Promise<T> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BudgetExceeded(ms, waiting)), ms);
  });
  try {
    const result = await Promise.race([fn(), expired]);
    if (performance.now() - started > ms) throw new BudgetExceeded(ms, waiting);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function fmt(ms: number): string {
  return ms >= 1000 ? `${Number((ms / 1000).toFixed(1))} s` : `${ms} ms`;
}
