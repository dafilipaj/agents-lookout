import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { checkoutId, type KnownCheckout } from './changes.ts';
import type { Runner } from './exec.ts';

/** PLAIN-6.3: an entry not read for this long is dropped. */
export const CHECKOUT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** PLAIN-6.3: how often an entry that's still read is saved as used again. */
const TOUCH_MS = 24 * 60 * 60 * 1000;
/** PLAIN-6.3: how long a folder's check is reused; a view reads every few seconds. */
const CHECK_MS = 15_000;
/** Far past what one person's views read in 30 days; the least recently read go first. */
const MAX_ENTRIES = 1000;
const GIT_TIMEOUT_MS = 10_000;

/** What a read of the Checkout needs, without DIFF's changed files, and when it was last read. */
interface Remembered {
  root: string;
  repo: string;
  where: string | null;
  baseSha: string;
  commonDir: string;
  at: number;
}

export type Recalled = { checkout: KnownCheckout } | 'gone' | null;

export interface CheckoutMemoryOptions {
  /** `~/.lookout/plain-checkouts.json` in Lookout. */
  file: string;
  runner: Runner;
  now: () => number;
}

/**
 * PLAIN-6.3: the Checkouts a Spec view has read, under the link's Session and Checkout ids, so a
 * link still opens once its Session has ended. Only what DIFF counted is ever remembered (PLAIN-6.1).
 */
export class CheckoutMemory {
  private readonly opts: CheckoutMemoryOptions;
  private store: Promise<Map<string, Remembered>> | null = null;
  /** Saves run one at a time, each writing the store as it is then. */
  private saving: Promise<void> = Promise.resolve();
  private checked = new Map<string, { at: number; ok: Promise<boolean> }>();

  constructor(opts: CheckoutMemoryOptions) {
    this.opts = opts;
  }

  /** A live Session's Checkout a view read: saved when it's new, changed, or last saved a day ago. */
  async remember(sessionId: string, c: KnownCheckout): Promise<void> {
    const store = await this.load();
    const k = keyOf(sessionId, c.id);
    const was = store.get(k);
    const now = this.opts.now();
    const same = was && was.root === c.root && was.repo === c.repo && was.where === c.where && was.baseSha === c.baseSha && was.commonDir === c.commonDir;
    if (same && now - was.at < TOUCH_MS) return;
    store.delete(k); // re-inserted last: the Map's order is the order of use, for MAX_ENTRIES
    store.set(k, { root: c.root, repo: c.repo, where: c.where, baseSha: c.baseSha, commonDir: c.commonDir, at: now });
    await this.save();
  }

  /** A remembered Checkout, 'gone' when its folder is no longer the same repo's working tree, null if none. */
  async recall(sessionId: string, id: string): Promise<Recalled> {
    const store = await this.load();
    const k = keyOf(sessionId, id);
    const r = store.get(k);
    if (!r || checkoutId(r.root) !== id) return null;
    if (!(await this.stillThere(r))) return 'gone';
    const now = this.opts.now();
    if (now - r.at >= TOUCH_MS) {
      store.delete(k);
      store.set(k, { ...r, at: now });
      await this.save();
    }
    return { checkout: { id, root: r.root, repo: r.repo, where: r.where, baseSha: r.baseSha, commonDir: r.commonDir, files: [] } };
  }

  /** The folder is still the top of a working tree whose repo has the same common directory. */
  private stillThere(r: Remembered): Promise<boolean> {
    const k = `${r.root}\u0000${r.commonDir}`;
    const now = this.opts.now();
    const kept = this.checked.get(k);
    if (kept && now - kept.at < CHECK_MS) return kept.ok;
    const ok = (async () => {
      try {
        const out = await this.opts.runner('git', ['-C', r.root, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'], { timeoutMs: GIT_TIMEOUT_MS });
        const [top, common] = out.trim().split('\n');
        if (!top || !common) return false;
        const [a, b, c, d] = await Promise.all([realpath(top), realpath(r.root), realpath(common), realpath(r.commonDir)]);
        return a === b && c === d;
      } catch {
        return false; // gone, not a repo, or git failed
      }
    })();
    if (this.checked.size > 200) this.checked.clear();
    this.checked.set(k, { at: now, ok });
    return ok;
  }

  /** Read once: concurrent first calls share one load. Entries not read for 30 days go whenever it's used. */
  private load(): Promise<Map<string, Remembered>> {
    this.store ??= this.read_();
    return this.store.then((s) => {
      const now = this.opts.now();
      for (const [k, r] of s) if (now - r.at > CHECKOUT_TTL_MS) s.delete(k);
      return s;
    });
  }

  private async read_(): Promise<Map<string, Remembered>> {
    const out = new Map<string, Remembered>();
    try {
      const raw = JSON.parse(await readFile(this.opts.file, 'utf8')) as { v?: unknown; checkouts?: unknown };
      if (raw?.v === 1 && raw.checkouts && typeof raw.checkouts === 'object') {
        const valid = Object.entries(raw.checkouts as Record<string, unknown>).filter((e): e is [string, Remembered] => isRemembered(e[1]));
        for (const [k, r] of valid.sort((x, y) => x[1].at - y[1].at)) out.set(k, r);
      }
    } catch {
      // none yet, or unreadable: start empty
    }
    return out;
  }

  /** Written whole to a new file of its own, then moved over the old one, mode 0600. */
  private save(): Promise<void> {
    const next = this.saving.then(async () => {
      const store = await this.load();
      for (const k of store.keys()) {
        if (store.size <= MAX_ENTRIES) break;
        store.delete(k);
      }
      await mkdir(dirname(this.opts.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.opts.file}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify({ v: 1, checkouts: Object.fromEntries(store) }), { mode: 0o600 });
      await rename(tmp, this.opts.file);
    });
    this.saving = next.catch(() => {});
    return next;
  }
}

/** The Checkout id is 16 hex characters, so the space can't be part of it. */
const keyOf = (sessionId: string, id: string) => `${id} ${sessionId}`;

function isRemembered(v: unknown): v is Remembered {
  const r = v as Partial<Remembered> | null;
  return (
    !!r &&
    typeof r.root === 'string' &&
    isAbsolute(r.root) &&
    typeof r.commonDir === 'string' &&
    isAbsolute(r.commonDir) &&
    typeof r.repo === 'string' &&
    (r.where === null || typeof r.where === 'string') &&
    typeof r.baseSha === 'string' &&
    /^[0-9a-f]{40,64}$/.test(r.baseSha) &&
    typeof r.at === 'number'
  );
}
