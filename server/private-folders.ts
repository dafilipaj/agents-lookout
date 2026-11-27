import { realpath as fsRealpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';
import { comparable, literalPrefix, privateMatcher, privatePatterns } from '../shared/private-folders.ts';
import type { Settings } from '../shared/settings.ts';
import { expandHome } from './settings.ts';

type VaultSettings = Pick<Settings, 'vaultFolder' | 'privateFolders'>;

export interface PrivateFoldersOptions {
  home?: string;
  /** `fs.realpath`; tests pass their own. */
  realpath?: (path: string) => Promise<string>;
  /** How long the disk may take to say where a path really is; 2 s unless a test shortens it. */
  timeoutMs?: number;
  now?: () => number;
}

/** How long a file's physical path is remembered. */
const REAL_TTL_MS = 60_000;
const MAX_REAL = 20_000;
/** How often the disk is asked again where each entry's own folder really is. */
const FORMS_TTL_MS = 10_000;
/** How many places one entry's folder may have been found at, the newest kept. */
const MAX_FORMS = 8;
const SLOW = Symbol('slow');
type Real = string | null | typeof SLOW;

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
/** One of each folder, as paths are compared (PEOPLE-2.3): a form that differs only by letter case or encoding is the same folder. */
const distinct = (paths: readonly string[]) => [...new Map(paths.map((p) => [comparable(p), p])).values()];
const folder = (path: string) => normalize(path).replace(/(.)\/+$/, '$1');

/**
 * PEOPLE-2: which files are private, by the Private folders in Settings. Asked at every read, never
 * only when a path is listed, so a folder made private closes at once (PEOPLE-2.5, 2.6).
 *
 * A path is matched as it was recorded and as it resolves, the file's own link included, against
 * each entry as written and as it resolves (PEOPLE-2.3). Where an entry's folder really is is asked
 * again every 10 s, so a folder made, mounted or linked after the entry was saved is still met. Every
 * place the disk has answered for an entry is kept until the settings change: a volume that goes away
 * and comes back, or a slow disk, never costs a place already learned.
 */
export class PrivateFolders {
  private readonly opts: PrivateFoldersOptions;
  /** The entries as full folder patterns, as written, and the Vault folder itself (PEOPLE-2.9). */
  private written: string[] = [];
  private vault: string[] = [];
  /** Every place the disk has said each of those really is, since the settings last changed. */
  private readonly physical = new Map<string, string[]>();
  /** The rule in use: each as written and as it resolves. */
  private patterns: string[] = [];
  private vaultForms: string[] = [];
  private match: (path: string) => boolean = () => false;
  private inside: (path: string) => boolean = () => false;
  private generation = 0;
  private checkedAt = Number.NEGATIVE_INFINITY;
  private checking: Promise<void> | null = null;
  private readonly real = new Map<string, { at: number; real: Promise<Real> }>();
  private readonly listeners = new Set<() => void>();

  constructor(opts: PrivateFoldersOptions = {}) {
    this.opts = opts;
  }

  /** Whether any folder is private: with none, nothing is asked of the disk. */
  get any(): boolean {
    return this.written.length > 0;
  }

  /** Runs after every change of what is private, or of where the Vault is, once the new rule holds. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * The settings' rule, from now on. The entries hold as written before this returns its promise;
   * their resolved forms are added when the disk has answered. Settings that leave the rule as it
   * was change nothing and tell no one (PEOPLE-2.6): any other setting is saved through here too.
   */
  set(settings: VaultSettings): Promise<void> {
    const home = this.opts.home ?? homedir();
    const vault = settings.vaultFolder === null ? [] : [folder(expandHome(settings.vaultFolder, home))];
    const written = [...new Set(privatePatterns(settings.privateFolders, vault, home).map(folder))];
    if (same(written, this.written) && same(vault, this.vault)) return this.checking ?? Promise.resolve();
    this.generation++;
    this.written = written;
    this.vault = vault;
    for (const known of [...this.physical.keys()]) if (!written.includes(known) && !vault.includes(known)) this.physical.delete(known);
    // The disk is asked before anyone is told, so whoever hears and asks at once waits for its answer.
    // That answer tells no one again: nothing was drawn between the two under the rule as written alone.
    const checked = this.check(true);
    this.use(false);
    return checked;
  }

  /** The rule from what is written and every place the disk has answered; listeners hear of it only when it changed. */
  private use(quiet: boolean): void {
    const forms = (list: readonly string[]) => distinct(list.flatMap((p) => [p, ...(this.physical.get(p) ?? [])]));
    const patterns = forms(this.written);
    const vaultForms = forms(this.vault);
    if (same(patterns.map(comparable), this.patterns.map(comparable)) && same(vaultForms.map(comparable), this.vaultForms.map(comparable))) return;
    this.patterns = patterns;
    this.vaultForms = vaultForms;
    this.match = privateMatcher(patterns);
    this.inside = privateMatcher(vaultForms);
    if (quiet) return;
    // One that throws must not fail the save that changed the rule, or the read that learned of it.
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (err) {
        console.warn(`lookout: private folders: a listener failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * Asks the disk where each entry's folder, and the Vault folder, really is: the part before an
   * entry's first `*`, so a symlink on the way to it still meets. Each answer is added to what was
   * learned before, never put in its place: a link that points nowhere for a while (a volume away)
   * answers as written, and the place it pointed to still counts when the volume is back.
   */
  private check(quiet = false): Promise<void> {
    const generation = this.generation;
    const run = (async () => {
      const found = await Promise.all(
        [...this.written, ...this.vault].map(async (pattern) => {
          const { folder: prefix, rest } = literalPrefix(pattern);
          const real = await this.physicalOf(prefix);
          return [pattern, typeof real === 'string' ? (rest ? `${real.replace(/\/+$/, '')}/${rest}` : real) : null] as const;
        }),
      );
      if (generation !== this.generation) return; // a later change won
      this.checkedAt = (this.opts.now ?? Date.now)();
      for (const [pattern, form] of found) {
        if (form === null || comparable(form) === comparable(pattern)) continue;
        const known = (this.physical.get(pattern) ?? []).filter((f) => comparable(f) !== comparable(form));
        this.physical.set(pattern, [...known, form].slice(-MAX_FORMS));
      }
      this.use(quiet);
    })();
    this.checking = run;
    void run.finally(() => {
      if (this.checking === run) this.checking = null;
    });
    return run;
  }

  /** The entries' resolved forms, no older than FORMS_TTL_MS; a check under way is waited for. */
  private current(): Promise<void> {
    if (this.checking) return this.checking;
    return (this.opts.now ?? Date.now)() - this.checkedAt >= FORMS_TTL_MS ? this.check() : Promise.resolve();
  }

  /** On the path as written only. */
  matches(path: string): boolean {
    return this.any && isAbsolute(path) && this.match(normalize(path));
  }

  /** PEOPLE-2.3: whether a file is private: on its path as written, then on its physical path. */
  async covers(path: string): Promise<boolean> {
    if (!this.any || !isAbsolute(path)) return false;
    return this.under(path, () => this.match);
  }

  /** PEOPLE-2.9: whether a file lies in the Vault folder, by the same two paths; never with no Vault folder set. */
  async inVault(path: string): Promise<boolean> {
    if (this.vault.length === 0 || !isAbsolute(path)) return false;
    return this.under(path, () => this.inside);
  }

  private async under(path: string, matcher: () => (path: string) => boolean): Promise<boolean> {
    const written = normalize(path);
    if (matcher()(written)) return true;
    await this.current();
    if (matcher()(written)) return true;
    const real = await this.resolve(written);
    // A disk too slow to say where a file really is: private until it answers, never shown on a guess.
    if (real === SLOW) return true;
    return real !== null && real !== written && matcher()(real);
  }

  /** A file's physical path, remembered for a minute; a slow answer isn't kept, so the next ask tries the disk again. */
  private resolve(path: string): Promise<Real> {
    const now = (this.opts.now ?? Date.now)();
    const cached = this.real.get(path);
    if (cached && now - cached.at < REAL_TTL_MS) return cached.real;
    const real = this.physicalOf(path);
    this.real.set(path, { at: now, real });
    void real.then((r) => {
      if (r === SLOW && this.real.get(path)?.real === real) this.real.delete(path);
    });
    if (this.real.size > MAX_REAL) this.real.delete(this.real.keys().next().value!);
    return real;
  }

  /**
   * A path with every symlink resolved, its own included. A part that isn't there (a file that is
   * gone, a folder not made yet) is kept as written under its resolved parent. Null when the disk
   * refuses for another reason, SLOW when it doesn't answer in time.
   */
  private physicalOf(path: string): Promise<Real> {
    const realpath = this.opts.realpath ?? fsRealpath;
    const walk = async (): Promise<string | null> => {
      let tail = '';
      for (let at = path; ; ) {
        try {
          const real = await realpath(at);
          return tail ? join(real, tail) : real;
        } catch (err) {
          const code = (err as NodeJS.ErrnoException | null)?.code;
          if (code !== 'ENOENT' && code !== 'ENOTDIR') return null;
        }
        const up = dirname(at);
        if (up === at) return null;
        tail = tail ? join(basename(at), tail) : basename(at);
        at = up;
      }
    };
    let timer: NodeJS.Timeout | undefined;
    return Promise.race([
      walk(),
      new Promise<typeof SLOW>((r) => {
        timer = setTimeout(() => r(SLOW), this.opts.timeoutMs ?? 2000);
      }),
    ]).finally(() => clearTimeout(timer));
  }
}
