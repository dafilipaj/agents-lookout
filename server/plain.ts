import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, posix, sep } from 'node:path';
import { clauseLines, definitionName, parseModule, type Clause, type PlainAnswer, type PlainConcept } from '../shared/plain.ts';
import type { RunError, Runner } from './exec.ts';
import type { KnownCheckout } from './changes.ts';

/** PLAIN-1.8: a larger file isn't read. */
export const MAX_MODULE_BYTES = 1024 * 1024;
/** PLAIN-4.2: a mark not set again for this long is dropped. */
export const VIEWED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const GIT_TIMEOUT_MS = 10_000;
/** PLAIN-4.2: how often a mark that's still read is saved as used again. */
const TOUCH_MS = 24 * 60 * 60 * 1000;
/** How deep imports are followed: far past any real chain, short of a runaway one. */
const MAX_MODULES = 200;

export class PlainError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface PlainOptions {
  runner: Runner;
  /** PLAIN-6.1: a live Session's counted Checkout by id, or null (the Changes it last reported). */
  checkout(sessionId: string, id: string): KnownCheckout | null;
  /** PLAIN-4.2: `~/.lookout/plain-viewed.json` unless a test says otherwise. */
  viewedFile?: string;
  now?: () => number;
}

/** One Viewed change of a Module, by its key (repo, path, text and base), and when it was last used. */
interface Mark {
  key: string;
  at: number;
}

/** v2: every Viewed change of a Module, by the Module (repo and path). v1 kept one per Module. */
interface Store {
  v: 2;
  marks: Record<string, Mark[]>;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * PLAIN-1, 2, 4, 6: reads a Module of a Checkout a live Session counts, at the working tree and at its
 * Branch point, resolves the Concepts it sees from other Modules, and keeps Viewed marks.
 */
export class Plain {
  private readonly opts: PlainOptions;
  private readonly now: () => number;
  private readonly viewedFile: string;
  private store: Promise<Store> | null = null;
  /** PLAIN-4.2: saves run one at a time, each writing the store as it is then. */
  private saving: Promise<void> = Promise.resolve();
  /** A base commit's file never changes: `<root>\0<sha>\0<path>` → its text, or null. */
  private baseCache = new Map<string, string | null>();

  constructor(opts: PlainOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.viewedFile = opts.viewedFile ?? join(homedir(), '.lookout', 'plain-viewed.json');
  }

  /** PLAIN-1, PLAIN-2: one Module, its base, and the Concepts it sees. */
  async read(sessionId: string, checkoutId: string, path: unknown): Promise<PlainAnswer> {
    const c = this.known(sessionId, checkoutId);
    const p = modulePath(path);
    const realRoot = await this.realRoot(c);
    const text = await this.headText(c, realRoot, p);
    const baseText = await this.baseText(c, p);
    if (text === null && baseText === null) throw new PlainError(404, `${p} isn't in this Checkout or at its Branch point.`);

    const { concepts, missing } = await this.resolve(c, realRoot, p, text ?? baseText!);
    const key = viewedKey(c.commonDir, p, text, baseText);
    const store = await this.load();
    const marks = store.marks[modKey(c.commonDir, p)] ?? [];
    const mark = marks.find((m) => m.key === key);
    // PLAIN-4.2: a mark that's read is in use; saved as such at most once a day.
    if (mark && this.now() - mark.at > TOUCH_MS) {
      mark.at = this.now();
      void this.save().catch(() => {});
    }
    return {
      sessionId,
      checkout: { id: c.id, repo: c.repo, where: c.where },
      path: p,
      text,
      baseText,
      base: c.baseSha.slice(0, 7),
      concepts,
      missing,
      key,
      viewed: !!mark,
      changedSinceViewed: !mark && marks.length > 0,
    };
  }

  /** PLAIN-4.1, 4.2: ticks or clears a Module's Viewed mark for the text and base it was read with. */
  async setViewed(sessionId: string, checkoutId: string, path: unknown, key: unknown, viewed: unknown): Promise<void> {
    const c = this.known(sessionId, checkoutId);
    const p = modulePath(path);
    if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key) || typeof viewed !== 'boolean') throw new PlainError(400, 'Expected { key, viewed }.');
    const store = await this.load();
    const k = modKey(c.commonDir, p);
    const kept = (store.marks[k] ?? []).filter((m) => m.key !== key);
    // Unticking clears this change's mark; other changes of the Module stay as they were.
    if (viewed) kept.unshift({ key, at: this.now() });
    if (kept.length) store.marks[k] = kept;
    else delete store.marks[k];
    await this.save();
  }

  /** PLAIN-3.3: which of a Checkout's changed Modules carry a Viewed mark for their text now. */
  async viewedPaths(sessionId: string, checkoutId: string): Promise<string[]> {
    const c = this.known(sessionId, checkoutId);
    const marks = (await this.load()).marks;
    const realRoot = await this.realRoot(c);
    const out: string[] = [];
    for (const f of c.files) {
      if (!f.path.endsWith('.plain') || f.kind === 'submodule') continue;
      const kept = marks[modKey(c.commonDir, f.path)];
      if (!kept?.length) continue;
      let p: string;
      try {
        p = modulePath(f.path);
      } catch {
        continue;
      }
      const text = await this.headText(c, realRoot, p).catch(() => null);
      const baseText = await this.baseText(c, p).catch(() => null);
      const key = viewedKey(c.commonDir, p, text, baseText);
      if (kept.some((m) => m.key === key)) out.push(p);
    }
    return out;
  }

  private known(sessionId: string, checkoutId: string): KnownCheckout {
    if (typeof sessionId !== 'string' || typeof checkoutId !== 'string' || !/^[0-9a-f]{16}$/.test(checkoutId)) throw new PlainError(400, 'Unknown Checkout.');
    const c = this.opts.checkout(sessionId, checkoutId);
    if (!c) throw new PlainError(404, "This Checkout isn't one of a live Session's any more.");
    return c;
  }

  private async realRoot(c: KnownCheckout): Promise<string> {
    try {
      return await realpath(c.root);
    } catch {
      throw new PlainError(410, 'Its Checkout is gone.');
    }
  }

  /**
   * PLAIN-1.5, 6.1: the working tree's text, never through a link out of the Checkout; null if gone.
   * The resolved path is opened without following a link, read from that one handle, and resolved
   * again afterwards, so a file or folder swapped for a link meanwhile is refused, as DIFF-4.4 does.
   */
  private async headText(c: KnownCheckout, realRoot: string, p: string): Promise<string | null> {
    let real: string;
    try {
      real = await realpath(join(c.root, p));
    } catch {
      return null;
    }
    if (!real.startsWith(realRoot + sep)) throw new PlainError(403, 'The file is outside its Checkout.');
    let handle;
    try {
      handle = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch {
      throw new PlainError(403, 'The file is outside its Checkout.');
    }
    try {
      const s = await handle.stat();
      if (!s.isFile()) throw new PlainError(400, `${p} isn't a file.`);
      if (s.size > MAX_MODULE_BYTES) throw new PlainError(413, `${p} is larger than 1 MB.`);
      const text = await handle.readFile('utf8');
      // A folder on the way swapped for a link and back again: the path then resolves where it did,
      // but names another file than the one opened, so the opened file must be the path's file now.
      let again: string | null = null;
      let named: { dev: number; ino: number } | null = null;
      try {
        again = await realpath(join(c.root, p));
        named = await stat(real);
      } catch {
        // gone meanwhile
      }
      const moved = again !== real || (await realpath(c.root).catch(() => null)) !== realRoot || !named || named.dev !== s.dev || named.ino !== s.ino;
      if (moved) throw new PlainError(403, 'The file is outside its Checkout.');
      return text;
    } finally {
      await handle.close();
    }
  }

  /** PLAIN-1.5: the text at the Branch point; null when the base doesn't have it. */
  private async baseText(c: KnownCheckout, p: string): Promise<string | null> {
    const k = `${c.root}\u0000${c.baseSha}\u0000${p}`;
    if (this.baseCache.has(k)) return this.baseCache.get(k)!;
    let text: string | null;
    try {
      text = await this.opts.runner('git', ['-C', c.root, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'show', `${c.baseSha}:${p}`], { timeoutMs: GIT_TIMEOUT_MS });
    } catch (err) {
      const stderr = (err as RunError).stderr ?? '';
      if (!/does not exist in|exists on disk, but not in|bad revision|invalid object name/i.test(stderr)) throw new PlainError(500, "git couldn't read the Module at the Branch point.");
      text = null;
    }
    if (text !== null && Buffer.byteLength(text) > MAX_MODULE_BYTES) throw new PlainError(413, `${p} is larger than 1 MB at the Branch point.`);
    if (this.baseCache.size > 500) this.baseCache.clear();
    this.baseCache.set(k, text);
    return text;
  }

  /**
   * PLAIN-2.1, 2.4, 2.6: imports transitively, `requires` one level for its `exported_concepts`, each
   * path from the importing Module's folder; every Module read at the working tree and the base.
   */
  private async resolve(c: KnownCheckout, realRoot: string, p: string, text: string): Promise<{ concepts: Record<string, PlainConcept>; missing: string[] }> {
    const concepts: Record<string, PlainConcept> = {};
    const missing: string[] = [];
    const own = new Set(definitionsOf(parseModule(text)).map((d) => d.name));
    const seen = new Set<string>([p]);
    const add = (module: string, head: Def[], base: Def[], only: ReadonlySet<string> | null) => {
      const before = new Map(base.map((d) => [d.name, d]));
      const names = new Set([...head.map((d) => d.name)]);
      for (const d of head) {
        if (only && !only.has(d.name)) continue;
        if (own.has(d.name) || concepts[d.name]) continue;
        concepts[d.name] = { module, lines: d.lines, baseLines: before.get(d.name)?.lines ?? null };
      }
      // A definition the branch removed from the other Module is still what the base meant.
      for (const d of base) {
        if (names.has(d.name) || (only && !only.has(d.name)) || own.has(d.name) || concepts[d.name]) continue;
        concepts[d.name] = { module, lines: [], baseLines: d.lines };
      }
    };
    const read = async (from: string, name: string): Promise<{ path: string; head: string | null; base: string | null } | null> => {
      const target = posix.normalize(posix.join(posix.dirname(from), `${name}.plain`));
      if (target.startsWith('../') || target === '..' || posix.isAbsolute(target)) return null;
      const head = await this.headText(c, realRoot, target).catch(() => null);
      const base = await this.baseText(c, target).catch(() => null);
      return head === null && base === null ? null : { path: target, head, base };
    };
    const top = parseModule(text);
    const queue: { from: string; name: string }[] = top.import.map((name) => ({ from: p, name }));
    while (queue.length && seen.size < MAX_MODULES) {
      const { from, name } = queue.shift()!;
      const m = await read(from, name);
      if (!m) {
        if (!missing.includes(name)) missing.push(name);
        continue;
      }
      if (seen.has(m.path)) continue;
      seen.add(m.path);
      const head = m.head === null ? null : parseModule(m.head);
      const base = m.base === null ? null : parseModule(m.base);
      add(m.path.replace(/\.plain$/, ''), head ? definitionsOf(head) : [], base ? definitionsOf(base) : [], null);
      for (const next of (head ?? base)!.import) queue.push({ from: m.path, name: next });
    }
    for (const name of top.requires) {
      const m = await read(p, name);
      if (!m) {
        if (!missing.includes(name)) missing.push(name);
        continue;
      }
      const head = m.head === null ? null : parseModule(m.head);
      const base = m.base === null ? null : parseModule(m.base);
      const exported = new Set([...(head?.exportedConcepts ?? []), ...(base?.exportedConcepts ?? [])]);
      add(m.path.replace(/\.plain$/, ''), head ? definitionsOf(head) : [], base ? definitionsOf(base) : [], exported);
    }
    return { concepts, missing };
  }

  /** Read once: concurrent first calls share one load, so there is only ever one store. */
  private load(): Promise<Store> {
    this.store ??= this.read_();
    return this.store.then((s) => this.prune(s));
  }

  private async read_(): Promise<Store> {
    const store: Store = { v: 2, marks: {} };
    try {
      const raw = JSON.parse(await readFile(this.viewedFile, 'utf8')) as { v?: unknown; marks?: unknown };
      if (raw && raw.v === 2 && typeof raw.marks === 'object' && raw.marks) {
        for (const [k, list] of Object.entries(raw.marks as Record<string, unknown>)) {
          const ok = Array.isArray(list) ? list.filter((m): m is Mark => typeof m?.key === 'string' && typeof m.at === 'number') : [];
          if (ok.length) store.marks[k] = ok;
        }
      }
    } catch {
      // none yet, or unreadable: start empty
    }
    return store;
  }

  /** PLAIN-4.2: marks not used for 30 days go, whenever the store is used, not only at start. */
  private prune(store: Store): Store {
    const now = this.now();
    for (const [k, list] of Object.entries(store.marks)) {
      const kept = list.filter((m) => now - m.at <= VIEWED_TTL_MS);
      if (kept.length) store.marks[k] = kept;
      else delete store.marks[k];
    }
    return store;
  }

  /**
   * PLAIN-4.2: written whole to a new file of its own, then moved over the old one, mode 0600. Saves
   * are queued, and each writes the store as it is when its turn comes, so a later change is never
   * overwritten by an earlier one.
   */
  private save(): Promise<void> {
    const next = this.saving.then(async () => {
      const store = await this.load();
      await mkdir(dirname(this.viewedFile), { recursive: true, mode: 0o700 });
      const tmp = `${this.viewedFile}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify(store), { mode: 0o600 });
      await rename(tmp, this.viewedFile);
    });
    this.saving = next.catch(() => {});
    return next;
  }
}

interface Def {
  name: string;
  lines: string[];
}

function definitionsOf(mod: ReturnType<typeof parseModule>): Def[] {
  return (mod.sections.definitions ?? []).flatMap((n: Clause) => {
    const d = definitionName(n.text);
    return d ? [{ name: d.name, lines: clauseLines([n]) }] : [];
  });
}

/** PLAIN-6.1: a relative `.plain` path inside the Checkout, written plainly; anything else is refused. */
export function modulePath(path: unknown): string {
  if (typeof path !== 'string' || !path || path.length > 1024 || !path.endsWith('.plain') || /[\0\\]/.test(path)) throw new PlainError(400, 'Not a .plain file.');
  const n = posix.normalize(path);
  if (n !== path || posix.isAbsolute(path) || path.split('/').some((s) => s === '..' || s === '.' || s === '')) throw new PlainError(400, 'Not a path inside the Checkout.');
  return path;
}

function modKey(commonDir: string, path: string): string {
  return sha(`${commonDir}\u0000${path}`);
}

/** PLAIN-4.2: the repo, the path, and the text and base as read: the same change shares one mark. */
export function viewedKey(commonDir: string, path: string, text: string | null, baseText: string | null): string {
  return sha(`${commonDir}\u0000${path}\u0000${text === null ? '-' : sha(text)}\u0000${baseText === null ? '-' : sha(baseText)}`);
}
