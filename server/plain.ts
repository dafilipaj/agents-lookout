import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, posix, sep } from 'node:path';
import { abilityKeysIn, clauseLines, definitionName, parseModule, type AbilityEntry, type Clause, type PlainAbility, type PlainAnswer, type PlainConcept, type PlainPrFiles, type PlainSource, type PlainSpecRef } from '../shared/plain.ts';
import { isCatalogueFile, namedAbilities, parseCatalogue } from './abilities.ts';
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
/** PLAIN-7.2, 7.6: how many files a lookup reads: far past fantastic-productive's 54 Modules and 27 catalogue files. */
const MAX_LOOKUP_FILES = 400;
/**
 * PLAIN-7.9: how long a working tree's list of Modules and catalogue files is reused. A view reads every
 * few seconds, the files' text is read fresh each time, and a new file is rare, so it shows within this.
 */
const WORKTREE_LIST_MS = 15_000;
/** PLAIN-7.1: a `§` reference, one id of a range included. */
const SPEC_REF = /§\d+(?:\.\d+)*/g;
/** PLAIN-7.2: a Module's spec marker, as `parseModule` reads it: on one line, never across a line break. */
const SPEC_MARK = /^>[^\S\n]?spec:[^\S\n]*(§\d+(?:\.\d+)*)[^\S\n]*$/gm;

export class PlainError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * PLAIN-6.1: what a Module is read from: a live Session's Checkout, at its working tree, or a PR's
 * commits in a local clone of its repo, at the PR's head (PLAIN-5.3).
 */
export interface PlainTree {
  /** The id the answer names it by (PLAIN-6.1): DIFF's for a Checkout, from the repo and number for a PR. */
  id: string;
  /** Where git runs: the Checkout, or the clone the PR was fetched into. */
  root: string;
  repo: string;
  where: string | null;
  baseSha: string;
  /** "Branch point", or "merge-base with <base branch>" for a PR. */
  baseName: string;
  /** The repo's common directory: PLAIN-4.2's Viewed key. */
  commonDir: string;
  /** Null: the text is the working tree's. Else the commit it's read at, a PR's head. */
  headSha: string | null;
}

/** PLAIN-5: a PR's commits, fetched into a local clone of its repo. */
export interface PlainPrSource {
  /**
   * PLAIN-5.2, 5.3: the PR's tree and its changed `.plain` paths; `fresh` when the Spec view or the
   * "Specs" list has just opened, so a newer push is fetched first. `error` is why the last fetch
   * failed, the tree then being an earlier fetch's; a PR never fetched rejects with a PlainError.
   */
  tree(repo: string, number: number, fresh: boolean): Promise<{ tree: PlainTree; paths: string[]; error: string | null }>;
}

export interface PlainOptions {
  runner: Runner;
  /** PLAIN-6.1: a live Session's counted Checkout by id, or null (the Changes it last reported). */
  checkout(sessionId: string, id: string): KnownCheckout | null;
  /** PLAIN-5: a PR's commits; without it, a PR is refused. */
  prs?: PlainPrSource;
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
  /** A commit's file never changes: `<root>\0<sha>\0<path>` → its text, or null. */
  private baseCache = new Map<string, string | null>();
  /** PLAIN-7: a commit's file list never changes: `<root>\0<sha>` → its Modules and catalogue files, read once. */
  private listCache = new Map<string, Promise<string[]>>();
  private worktreeLists = new Map<string, { at: number; listed: Promise<string[]> }>();
  /** PLAIN-7.6: a catalogue file's entries, by `<path>` and the text they were read from. */
  private catalogueCache = new Map<string, { text: string; entries: Map<string, AbilityEntry> }>();

  constructor(opts: PlainOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.viewedFile = opts.viewedFile ?? join(homedir(), '.lookout', 'plain-viewed.json');
  }

  /** PLAIN-1, PLAIN-2: one Module, its base, and the Concepts it sees; `fresh` as PlainPrSource's. */
  async read(source: unknown, path: unknown, fresh = false): Promise<PlainAnswer> {
    const src = plainSource(source);
    const p = modulePath(path);
    const { tree: c, error: fetchError } = await this.tree(src, fresh);
    const realRoot = c.headSha === null ? await this.realRoot(c) : null;
    const text = await this.headText(c, realRoot, p);
    const baseText = await this.baseText(c, p);
    if (text === null && baseText === null) throw new PlainError(404, src.kind === 'pr' ? `${p} isn't in this PR or at its base.` : `${p} isn't in this Checkout or at its Branch point.`);

    const [{ concepts, missing }, specs, { abilities, catalogue }] = await Promise.all([
      this.resolve(c, realRoot, p, text ?? baseText!),
      this.specRefs(c, realRoot, p, text, baseText),
      this.abilities(c, realRoot, text, baseText),
    ]);
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
      source: src,
      checkout: { id: c.id, repo: c.repo, where: c.where },
      path: p,
      text,
      baseText,
      base: c.baseSha.slice(0, 7),
      baseName: c.baseName,
      fetchError,
      concepts,
      missing,
      specs,
      abilities,
      catalogue,
      key,
      viewed: !!mark,
      changedSinceViewed: !mark && marks.length > 0,
    };
  }

  /** PLAIN-4.1, 4.2: ticks or clears a Module's Viewed mark for the text and base it was read with. */
  async setViewed(source: unknown, path: unknown, key: unknown, viewed: unknown): Promise<void> {
    const src = plainSource(source);
    const p = modulePath(path);
    const { tree: c } = await this.tree(src, false);
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
    const known = this.known(sessionId, checkoutId);
    const paths = known.files.filter((f) => f.path.endsWith('.plain') && f.kind !== 'submodule').map((f) => f.path);
    return this.viewedOf(checkoutTree(known), paths);
  }

  /** PLAIN-5.1: a PR's changed Modules, each with its Viewed mark; `fresh` as PlainPrSource's. */
  async prFiles(repo: unknown, number: unknown, fresh: boolean): Promise<PlainPrFiles> {
    const src = plainSource({ kind: 'pr', repo, number });
    if (src.kind !== 'pr' || !this.opts.prs) throw new PlainError(404, "Lookout can't read PRs here.");
    const { tree, paths, error } = await this.opts.prs.tree(src.repo, src.number, fresh);
    const viewed = new Set(await this.viewedOf(tree, paths));
    return { repo: src.repo, number: src.number, files: paths.map((path) => ({ path, viewed: viewed.has(path) })), error };
  }

  /** PLAIN-3.3, 5.1: which of these Modules carry a Viewed mark for their text now. */
  private async viewedOf(c: PlainTree, paths: readonly string[]): Promise<string[]> {
    const marks = (await this.load()).marks;
    let realRoot: string | null = null;
    const out: string[] = [];
    for (const path of paths) {
      const kept = marks[modKey(c.commonDir, path)];
      if (!kept?.length) continue;
      let p: string;
      try {
        p = modulePath(path);
      } catch {
        continue;
      }
      if (c.headSha === null) realRoot ??= await this.realRoot(c);
      const text = await this.headText(c, realRoot, p).catch(() => null);
      const baseText = await this.baseText(c, p).catch(() => null);
      const key = viewedKey(c.commonDir, p, text, baseText);
      if (kept.some((m) => m.key === key)) out.push(p);
    }
    return out;
  }

  /** PLAIN-6.1: the tree a source names, if Lookout knows it. */
  private async tree(src: PlainSource, fresh: boolean): Promise<{ tree: PlainTree; error: string | null }> {
    if (src.kind === 'session') return { tree: checkoutTree(this.known(src.session, src.checkout)), error: null };
    if (!this.opts.prs) throw new PlainError(404, "Lookout can't read PRs here.");
    return this.opts.prs.tree(src.repo, src.number, fresh);
  }

  private known(sessionId: string, checkoutId: string): KnownCheckout {
    if (typeof sessionId !== 'string' || typeof checkoutId !== 'string' || !/^[0-9a-f]{16}$/.test(checkoutId)) throw new PlainError(400, 'Unknown Checkout.');
    const c = this.opts.checkout(sessionId, checkoutId);
    if (!c) throw new PlainError(404, "This Checkout isn't one of a live Session's any more.");
    return c;
  }

  private async realRoot(c: PlainTree): Promise<string> {
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
  private async headText(c: PlainTree, realRoot: string | null, p: string): Promise<string | null> {
    if (c.headSha !== null) return this.commitText(c, c.headSha, p);
    if (realRoot === null) throw new PlainError(500, 'No Checkout to read.');
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

  /** PLAIN-1.5, 5.3: the text at the base; null when the base doesn't have it. */
  private baseText(c: PlainTree, p: string): Promise<string | null> {
    return this.commitText(c, c.baseSha, p);
  }

  /** A commit's file, which never changes, so it's read once; null when the commit doesn't have it. */
  private async commitText(c: PlainTree, commit: string, p: string): Promise<string | null> {
    const k = `${c.root}\u0000${commit}\u0000${p}`;
    if (this.baseCache.has(k)) return this.baseCache.get(k)!;
    const at = commit === c.baseSha ? `at its ${c.baseName}` : "at the PR's head";
    let text: string | null;
    try {
      text = await this.opts.runner('git', ['-C', c.root, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'show', `${commit}:${p}`], { timeoutMs: GIT_TIMEOUT_MS });
    } catch (err) {
      const stderr = (err as RunError).stderr ?? '';
      if (!/does not exist in|exists on disk, but not in|bad revision|invalid object name/i.test(stderr)) throw new PlainError(500, `git couldn't read the Module ${at}.`);
      text = null;
    }
    if (text !== null && Buffer.byteLength(text) > MAX_MODULE_BYTES) throw new PlainError(413, `${p} is larger than 1 MB ${at}.`);
    if (this.baseCache.size > 2000) this.baseCache.clear();
    this.baseCache.set(k, text);
    return text;
  }

  /**
   * PLAIN-2.1, 2.4, 2.6: imports transitively, `requires` one level for its `exported_concepts`, each
   * path from the importing Module's folder; every Module read at the working tree and the base.
   */
  private async resolve(c: PlainTree, realRoot: string | null, p: string, text: string): Promise<{ concepts: Record<string, PlainConcept>; missing: string[] }> {
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

  /**
   * PLAIN-7.2, 7.3, 7.9: the specs of other Modules this one names by `§`, from every `.plain` file under
   * its folder, at the working tree (a PR's head) and the base. Only a Module holding one is parsed.
   */
  private async specRefs(c: PlainTree, realRoot: string | null, p: string, text: string | null, baseText: string | null): Promise<Record<string, PlainSpecRef>> {
    const texts = [text, baseText].filter((t): t is string => t !== null);
    const own = new Set(texts.flatMap((t) => [...t.matchAll(SPEC_MARK)].map((m) => m[1]!)));
    const wanted = new Set(texts.flatMap((t) => t.match(SPEC_REF) ?? []).filter((id) => !own.has(id)));
    const out: Record<string, PlainSpecRef> = {};
    if (!wanted.size) return out;
    const dir = posix.dirname(p);
    const under = (f: string) => f !== p && f.endsWith('.plain') && (dir === '.' || f.startsWith(`${dir}/`));
    const [head, base] = await Promise.all([this.listHead(c, dir === '.' ? [] : [dir]), this.listAt(c, c.baseSha)]);
    const paths = [...new Set([...head.filter(under), ...base.filter(under)])].sort().slice(0, MAX_LOOKUP_FILES);
    await Promise.all([this.prefetch(c, c.baseSha, paths), c.headSha === null ? null : this.prefetch(c, c.headSha, paths)]);
    for (const path of paths) {
      if (![...wanted].some((id) => !out[id])) break;
      const [h, b] = await Promise.all([this.headText(c, realRoot, path).catch(() => null), this.baseText(c, path).catch(() => null)]);
      const ids = new Set([h, b].flatMap((t) => (t === null ? [] : [...t.matchAll(SPEC_MARK)].map((m) => m[1]!))).filter((id) => wanted.has(id) && !out[id]));
      if (!ids.size) continue;
      const hm = h === null ? null : parseModule(h);
      const bm = b === null ? null : parseModule(b);
      for (const id of ids) {
        const hs = hm?.specs.find((s) => s.id === id) ?? null;
        const bs = bm?.specs.find((s) => s.id === id) ?? null;
        // The marker matched, yet the parser found no spec there (inside an unclosed front matter, say).
        const some = hs ?? bs;
        if (!some) continue;
        out[id] = { module: path, lines: hs ? clauseLines(hs.clauses) : null, baseLines: bs ? clauseLines(bs.clauses) : null, tests: some.tests.length, notes: some.notes.length };
      }
    }
    return out;
  }

  /**
   * PLAIN-7.5 to 7.8: the ability keys this Module names, and those their rules name, from the
   * Checkout's catalogue at the working tree (a PR's head) and the base.
   */
  private async abilities(c: PlainTree, realRoot: string | null, text: string | null, baseText: string | null): Promise<{ abilities: Record<string, PlainAbility>; catalogue: boolean }> {
    const keys = new Set([text, baseText].flatMap((t) => (t === null ? [] : abilityKeysIn(t))));
    if (!keys.size) return { abilities: {}, catalogue: false };
    const [headFiles, baseFiles] = await Promise.all([
      this.listHead(c, [':(glob)**/abilities/catalogue/*.ts', ':(glob)**/abilities/catalogue.ts']).then((l) => l.filter(isCatalogueFile).slice(0, MAX_LOOKUP_FILES)),
      this.listAt(c, c.baseSha).then((l) => l.filter(isCatalogueFile).slice(0, MAX_LOOKUP_FILES)),
    ]);
    await Promise.all([this.prefetch(c, c.baseSha, baseFiles), c.headSha === null ? null : this.prefetch(c, c.headSha, headFiles)]);
    const read = async (files: readonly string[], at: 'head' | 'base') => {
      const all = new Map<string, AbilityEntry>();
      for (const f of files) {
        const t = at === 'head' ? await this.headText(c, realRoot, f).catch(() => null) : await this.baseText(c, f).catch(() => null);
        if (t === null) continue;
        const k = `${c.root}\u0000${at === 'head' ? (c.headSha ?? 'wt') : c.baseSha}\u0000${f}`;
        let hit = this.catalogueCache.get(k);
        if (!hit || hit.text !== t) {
          let entries: Map<string, AbilityEntry>;
          try {
            entries = parseCatalogue(t, f);
          } catch {
            // A file the reader can't follow (nested too deep, say) explains nothing, and fails nothing else.
            entries = new Map();
          }
          hit = { text: t, entries };
          if (this.catalogueCache.size > 200) this.catalogueCache.clear();
          this.catalogueCache.set(k, hit);
        }
        for (const [key, e] of hit.entries) if (!all.has(key)) all.set(key, e);
      }
      return all;
    };
    const [head, base] = await Promise.all([read(headFiles, 'head'), read(baseFiles, 'base')]);
    const abilities: Record<string, PlainAbility> = {};
    const add = (key: string) => {
      if (abilities[key]) return;
      const h = head.get(key) ?? null;
      const b = base.get(key) ?? null;
      if (h || b) abilities[key] = { head: h, base: b };
    };
    for (const key of keys) add(key);
    // PLAIN-7.5: an ability a rule names shows its own description beside it.
    for (const key of keys) for (const e of [abilities[key]?.head, abilities[key]?.base]) for (const n of namedAbilities(e?.rule ?? null)) add(n);
    return { abilities, catalogue: headFiles.length > 0 || baseFiles.length > 0 };
  }

  /**
   * PLAIN-7.9: a commit's files read in one `git cat-file --batch`, into the cache `commitText` reads,
   * rather than one `git show` each. A file it can't give is left for `commitText`, which says why.
   */
  private async prefetch(c: PlainTree, commit: string, paths: readonly string[]): Promise<void> {
    const key = (p: string) => `${c.root}\u0000${commit}\u0000${p}`;
    const want = paths.filter((p) => !this.baseCache.has(key(p)) && !/[\n\r]/.test(p));
    if (!want.length) return;
    let out: string;
    try {
      out = await this.opts.runner('git', ['-C', c.root, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'cat-file', '--batch'], { timeoutMs: GIT_TIMEOUT_MS, stdin: want.map((p) => `${commit}:${p}\n`).join(''), encoding: 'latin1' });
    } catch {
      return;
    }
    // Each object is `<oid> <type> <size>\n<bytes>\n`, or `<name> missing\n`; latin1 keeps the bytes.
    const buf = Buffer.from(out, 'latin1');
    let at = 0;
    if (this.baseCache.size + want.length > 2000) this.baseCache.clear();
    for (const p of want) {
      const nl = buf.indexOf(10, at);
      if (nl < 0) return;
      const header = buf.subarray(at, nl).toString('latin1');
      at = nl + 1;
      if (header.endsWith(' missing')) {
        this.baseCache.set(key(p), null);
        continue;
      }
      const m = /^[0-9a-f]+ (\w+) (\d+)$/.exec(header);
      if (!m) return;
      const size = Number(m[2]);
      const body = buf.subarray(at, at + size);
      at += size + 1;
      if (m[1] === 'blob' && size <= MAX_MODULE_BYTES) this.baseCache.set(key(p), body.toString('utf8'));
    }
  }

  /** PLAIN-7: the files a Checkout's working tree has, tracked or new and not ignored, under these pathspecs; a PR's at its head. */
  private async listHead(c: PlainTree, pathspecs: readonly string[]): Promise<string[]> {
    if (c.headSha !== null) return this.listAt(c, c.headSha);
    const k = `${c.root}\u0000${pathspecs.join('\u0000')}`;
    const now = Date.now();
    const hit = this.worktreeLists.get(k);
    if (hit && now - hit.at < WORKTREE_LIST_MS) return hit.listed;
    const listed: Promise<string[]> = this.opts
      .runner('git', ['-C', c.root, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...pathspecs], { timeoutMs: GIT_TIMEOUT_MS })
      .then(
        (out) => [...new Set(out.split('\0').filter(Boolean))],
        () => {
          if (this.worktreeLists.get(k)?.listed === listed) this.worktreeLists.delete(k);
          return [];
        },
      );
    if (this.worktreeLists.size > 50) this.worktreeLists.clear();
    this.worktreeLists.set(k, { at: now, listed });
    return listed;
  }

  /**
   * PLAIN-7: a commit's Modules and catalogue files, the only paths a lookup asks for, read once:
   * concurrent first calls share one `ls-tree`, and a failed one is tried again next time.
   */
  private listAt(c: PlainTree, commit: string): Promise<string[]> {
    const k = `${c.root}\u0000${commit}`;
    const hit = this.listCache.get(k);
    if (hit) return hit;
    const listed: Promise<string[]> = this.opts
      .runner('git', ['-C', c.root, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'ls-tree', '-r', '-z', '--name-only', commit], { timeoutMs: GIT_TIMEOUT_MS })
      .then(
        (out) => out.split('\0').filter((f) => f.endsWith('.plain') || isCatalogueFile(f)),
        () => {
          if (this.listCache.get(k) === listed) this.listCache.delete(k);
          return [];
        },
      );
    if (this.listCache.size > 50) this.listCache.clear();
    this.listCache.set(k, listed);
    return listed;
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

/** A live Session's Checkout as a tree: its working tree, at DIFF's Branch point. */
function checkoutTree(c: KnownCheckout): PlainTree {
  return { id: c.id, root: c.root, repo: c.repo, where: c.where, baseSha: c.baseSha, baseName: 'Branch point', commonDir: c.commonDir, headSha: null };
}

/** PLAIN-6.1: a Session's Checkout by its id, or a PR by its repo (in `productiveio`) and number; anything else is refused. */
export function plainSource(v: unknown): PlainSource {
  const o = (typeof v === 'object' && v ? v : {}) as Record<string, unknown>;
  if (o.kind === 'session' && typeof o.session === 'string' && o.session.length <= 512 && typeof o.checkout === 'string' && /^[0-9a-f]{16}$/.test(o.checkout)) {
    return { kind: 'session', session: o.session, checkout: o.checkout };
  }
  const number = typeof o.number === 'string' && /^[1-9][0-9]{0,9}$/.test(o.number) ? Number(o.number) : o.number;
  if (o.kind === 'pr' && typeof o.repo === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(o.repo) && o.repo !== '.' && o.repo !== '..' && typeof number === 'number' && Number.isSafeInteger(number) && number > 0) {
    return { kind: 'pr', repo: o.repo, number };
  }
  throw new PlainError(400, 'Unknown Checkout.');
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
