/**
 * PLAIN: a PlainLang Module's parser and its clause diff, ported from p-plain 0.6.1's
 * `scripts/page-template.html` (`parseClauses`, `parse`, `lcs`, `wordDiff`, `diffContainer`), so the
 * Spec view marks a change as `/p-plain:page` does (PLAIN-1.3, 1.6). Pure: every call parses its
 * own copy, so nothing is shared between a read and the next.
 */

export type ClauseState = 'same' | 'added' | 'removed' | 'changed';

export interface Clause {
  text: string;
  children: Clause[];
  state: ClauseState;
  /** A rewritten clause's text before (state `changed`). */
  oldText?: string;
}

export interface FunctionalSpec {
  /** `§12.3` when the Module marks its specs (`> spec: §12.3`), else `#1`, `#2` by position. */
  id: string;
  clauses: Clause[];
  tests: Clause[];
  /** PLAIN-1.8: its `>` lines other than `spec:` (rationale, parity notes), one per line. */
  notes: Clause[];
  state: ClauseState;
}

export interface Module {
  description: string;
  import: string[];
  requires: string[];
  exportedConcepts: string[];
  notes: string[];
  /** `definitions`, `implementation reqs`, `test reqs`, and any other section by its name. */
  sections: Record<string, Clause[]>;
  /** PLAIN-1.8: a section's `>` lines outside any functional spec, by section. */
  sectionNotes: Record<string, Clause[]>;
  specs: FunctionalSpec[];
  explicitIds: boolean;
  /** PLAIN-1.8: lines outside any section that aren't notes, kept so nothing is hidden. */
  loose: string[];
}

export interface Touched {
  /** A section's name, a spec's id (`§12.3`, `§12.3 tests`), or `description`. */
  where: string;
  added?: number;
  changed?: number;
  removed?: number;
  newSpec?: boolean;
  removedSpec?: boolean;
}

export interface Compared {
  module: Module;
  /** The description before, when it changed. */
  oldDescription: string | null;
  /** False with no base to compare with: nothing is marked and there is no Changes card. */
  diffed: boolean;
  stats: { added: number; changed: number; removed: number; touched: Touched[] };
  touchedSections: string[];
}

/** The sections a Module's clauses are diffed in, in page order (PLAIN-1.3). */
export const CLAUSE_SECTIONS = ['definitions', 'implementation reqs', 'test reqs'] as const;

/** Clause bullets (`- text`, nested by indent; a following line without a bullet continues it). */
export function parseClauses(block: readonly string[]): Clause[] {
  return parseBlock(block).clauses;
}

/** PLAIN-1.8: the clauses, and the text before the first bullet, which no clause holds. */
function parseBlock(block: readonly string[]): { clauses: Clause[]; orphans: string[] } {
  const orphans: string[] = [];
  const root: Clause = { text: '', children: [], state: 'same' };
  const stack: { node: Clause; indent: number }[] = [{ node: root, indent: -1 }];
  let last: Clause | null = null;
  for (const line of block) {
    const m = /^(\s*)-\s+(.*)$/.exec(line);
    if (m) {
      const indent = m[1]!.length;
      const node: Clause = { text: m[2]!, children: [], state: 'same' };
      while (stack.length > 1 && stack[stack.length - 1]!.indent >= indent) stack.pop();
      stack[stack.length - 1]!.node.children.push(node);
      stack.push({ node, indent });
      last = node;
    } else if (last && line.trim()) last.text += ' ' + line.trim();
    else if (line.trim()) orphans.push(line.trim());
  }
  return { clauses: root.children, orphans };
}

export function parseModule(text: string): Module {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const mod: Module = { description: '', import: [], requires: [], exportedConcepts: [], notes: [], sections: {}, sectionNotes: {}, specs: [], explicitIds: false, loose: [] };
  const front: Record<string, string | string[]> = {};
  let i = 0;
  if (lines[0] === '---') {
    let key: string | null = null;
    i = 1;
    for (; i < lines.length && lines[i] !== '---'; i++) {
      const line = lines[i]!;
      const m = /^(\w+):\s*(.*)$/.exec(line);
      if (m) {
        key = m[1]!;
        front[key] = m[2] ? m[2] : [];
      } else if (key && /^\s+-\s+/.test(line)) {
        const v = front[key];
        if (Array.isArray(v)) v.push(line.replace(/^\s+-\s+/, '').trim());
      }
    }
    i++;
  }
  // A list is YAML's block form (`- a` lines) or its flow form (`[a, "b"]`).
  const list = (k: string): string[] => {
    const v = front[k];
    if (Array.isArray(v)) return v.map(unquote);
    if (typeof v !== 'string' || !v.trim()) return [];
    const flow = /^\[(.*)\]$/.exec(v.trim());
    return (flow ? flow[1]!.split(',') : [v]).map(unquote).filter(Boolean);
  };
  mod.description = typeof front.description === 'string' ? unquote(front.description) : '';
  mod.import = list('import');
  mod.requires = list('requires');
  mod.exportedConcepts = list('exported_concepts').map((c) => c.replace(/^:|:$/g, ''));

  // A repo that marks its specs (`> spec: §12.3`) keeps those ids; otherwise each top-level bullet
  // of ***functional specs*** is one spec, numbered by position.
  mod.explicitIds = /^>\s?spec:\s*\S+\s*$/m.test(text);
  let section: string | null = null;
  let note: string[] = [];
  let buffer: string[] = [];
  let spec: FunctionalSpec | null = null;
  let sub: string | null = null;
  let position = 0;
  const flush = () => {
    if (!buffer.length) return;
    const block = buffer;
    buffer = [];
    const { clauses, orphans } = parseBlock(block);
    if (section === 'functional specs' && !spec) {
      // Before the first spec: no spec holds any of it, so it's kept whole.
      mod.loose.push(...block.filter((l) => l.trim()));
      return;
    }
    // Text no clause holds: before a section's first bullet (outside every section, below, whole).
    if (section) mod.loose.push(...orphans);
    if (section === 'functional specs' && spec) {
      (sub === 'acceptance tests' ? spec.tests : spec.clauses).push(...clauses);
    } else if (section) (mod.sections[section] ??= []).push(...clauses);
    else mod.loose.push(...block.filter((l) => l.trim()));
  };
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const sec = /^\s*\*\*\*(.+?)\*\*\*\s*$/.exec(line);
    if (sec) {
      flush();
      const name = sec[1]!.trim();
      if (name === 'acceptance tests') sub = name;
      else {
        section = name;
        sub = null;
        spec = null;
      }
      continue;
    }
    if (section === 'functional specs' && !mod.explicitIds && /^-\s/.test(line)) {
      flush();
      spec = { id: `#${++position}`, clauses: [], tests: [], notes: [], state: 'same' };
      mod.specs.push(spec);
      sub = null;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      const s = /^spec:\s*(\S+)\s*$/.exec(q[1]!);
      if (s) {
        flush();
        spec = { id: s[1]!, clauses: [], tests: [], notes: [], state: 'same' };
        mod.specs.push(spec);
        sub = null;
      } else if (!section) note.push(q[1]!);
      else if (q[1]!.trim()) {
        // PLAIN-1.8: a note inside a section belongs to its spec, else to its section. The clauses
        // around it stay one block, so a bullet after the note still nests under the one before.
        const n: Clause = { text: q[1]!.trim(), children: [], state: 'same' };
        if (section === 'functional specs' && spec) spec.notes.push(n);
        else (mod.sectionNotes[section] ??= []).push(n);
      }
      continue;
    }
    if (!line.trim() && !section) {
      if (note.length) {
        mod.notes.push(note.join(' '));
        note = [];
      }
      continue;
    }
    buffer.push(line);
  }
  flush();
  if (note.length) mod.notes.push(note.join(' '));
  return mod;
}

function unquote(s: string): string {
  const t = s.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1) : t;
}

/** A definition clause's Concept name and its text after it (`:Deal: is …` → `Deal`, `is …`). */
export function definitionName(text: string): { name: string; body: string } | null {
  const m = /^:([A-Za-z0-9+.\-_]+):\s*(.*)$/.exec(text);
  return m ? { name: m[1]!, body: m[2]! } : null;
}

/** A Clause tree written back as bullets, two spaces per level: what a definition's popover parses. */
export function clauseLines(nodes: readonly Clause[], depth = 0): string[] {
  return nodes.flatMap((n) => [`${'  '.repeat(depth)}- ${n.text}`, ...clauseLines(n.children, depth + 1)]);
}

interface Flat {
  n: Clause;
  depth: number;
  parent: Clause | null;
}

function flat(nodes: readonly Clause[], out: Flat[] = [], depth = 0, parent: Clause | null = null): Flat[] {
  for (const n of nodes) {
    out.push({ n, depth, parent });
    flat(n.children, out, depth + 1, n);
  }
  return out;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean);

function similar(a: string, b: string): number {
  const A = new Set(words(a));
  const B = new Set(words(b));
  let c = 0;
  for (const w of A) if (B.has(w)) c++;
  return c / Math.max(1, Math.max(A.size, B.size));
}

function lcs<T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean): [number, number][] {
  const m = a.length;
  const n = b.length;
  const T = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) T[i]![j] = eq(a[i]!, b[j]!) ? T[i + 1]![j + 1]! + 1 : Math.max(T[i + 1]![j]!, T[i]![j + 1]!);
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (eq(a[i]!, b[j]!)) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (T[i + 1]![j]! >= T[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

export interface WordPart {
  k: 'eq' | 'ins' | 'del';
  t: string;
}

/** PLAIN-1.6: a rewritten clause's word-level change. */
export function wordDiff(a: string, b: string): WordPart[] {
  const A = words(a);
  const B = words(b);
  const pairs = lcs(A, B, (x, y) => x === y);
  const out: WordPart[] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of pairs) {
    if (i < pi) out.push({ k: 'del', t: A.slice(i, pi).join(' ') });
    if (j < pj) out.push({ k: 'ins', t: B.slice(j, pj).join(' ') });
    out.push({ k: 'eq', t: A[pi]! });
    i = pi + 1;
    j = pj + 1;
  }
  if (i < A.length) out.push({ k: 'del', t: A.slice(i).join(' ') });
  if (j < B.length) out.push({ k: 'ins', t: B.slice(j).join(' ') });
  const merged: WordPart[] = [];
  for (const p of out) {
    const last = merged[merged.length - 1];
    if (last && last.k === p.k) last.t += ' ' + p.t;
    else merged.push({ ...p });
  }
  return merged;
}

type Stats = Compared['stats'];

/**
 * Clause trees matched by text, then near matches paired as changes; a removed clause goes back in
 * after the nearest preceding old clause that survived. Marks `newNodes` in place; true if touched.
 */
function diffContainer(oldNodes: Clause[], newNodes: Clause[], where: string, stats: Stats): boolean {
  const O = flat(oldNodes);
  const N = flat(newNodes);
  const pairs = lcs(O, N, (x, y) => x.n.text === y.n.text);
  const matchedO = new Set(pairs.map((p) => p[0]));
  const matchedN = new Set(pairs.map((p) => p[1]));
  const oToN = new Map(pairs);
  const unmatchedO = O.map((_, i) => i).filter((i) => !matchedO.has(i));
  const unmatchedN = N.map((_, i) => i).filter((i) => !matchedN.has(i));
  const usedN = new Set<number>();
  let added = 0;
  let changed = 0;
  let removed = 0;
  for (const oi of unmatchedO) {
    let best: number | null = null;
    let bestS = 0.45;
    for (const ni of unmatchedN) {
      if (usedN.has(ni)) continue;
      const s = similar(O[oi]!.n.text, N[ni]!.n.text);
      if (s > bestS) {
        bestS = s;
        best = ni;
      }
    }
    if (best !== null) {
      usedN.add(best);
      N[best]!.n.state = 'changed';
      N[best]!.n.oldText = O[oi]!.n.text;
      oToN.set(oi, best);
      changed++;
    }
  }
  for (const ni of unmatchedN) {
    if (!usedN.has(ni)) {
      N[ni]!.n.state = 'added';
      added++;
    }
  }
  for (const oi of unmatchedO) {
    if (oToN.has(oi)) continue;
    const ghost: Clause = { text: O[oi]!.n.text, children: [], state: 'removed' };
    removed++;
    let anchorIdx = oi - 1;
    while (anchorIdx >= 0 && !oToN.has(anchorIdx)) anchorIdx--;
    if (anchorIdx < 0) {
      newNodes.unshift(ghost);
      continue;
    }
    const anchor = N[oToN.get(anchorIdx)!]!;
    const siblings = anchor.parent ? anchor.parent.children : newNodes;
    if (O[oi]!.depth > O[anchorIdx]!.depth) anchor.n.children.push(ghost);
    else siblings.splice(siblings.indexOf(anchor.n) + 1, 0, ghost);
  }
  stats.added += added;
  stats.changed += changed;
  stats.removed += removed;
  const touched = added + changed + removed > 0;
  if (touched) stats.touched.push({ where, added, changed, removed });
  return touched;
}

/** PLAIN-2.3: two bullet lists compared, as a definition's popover shows its change. */
export function compareClauses(oldLines: readonly string[], newLines: readonly string[]): Clause[] {
  const next = parseClauses(newLines);
  diffContainer(parseClauses(oldLines), next, '', { added: 0, changed: 0, removed: 0, touched: [] });
  return next;
}

const allClauses = (s: FunctionalSpec) => flat(s.clauses).concat(flat(s.tests), flat(s.notes));

/**
 * PLAIN-1.5, 1.6: the Module now, its clauses marked against `oldText`. `oldText` null: nothing to
 * compare with (no base); an empty string: a Module new since the base, every clause added. `text`
 * null: a deleted Module, its base shown with every clause removed.
 */
export function compareModules(text: string | null, oldText: string | null): Compared {
  const stats: Stats = { added: 0, changed: 0, removed: 0, touched: [] };
  const touchedSections = new Set<string>();
  if (text === null) {
    const mod = parseModule(oldText ?? '');
    for (const key of Object.keys(mod.sections)) {
      const n = flat(mod.sections[key]!).length;
      for (const x of flat(mod.sections[key]!)) x.n.state = 'removed';
      if (n) {
        stats.removed += n;
        stats.touched.push({ where: key, removed: n });
        touchedSections.add(key);
      }
    }
    for (const key of Object.keys(mod.sectionNotes)) for (const x of flat(mod.sectionNotes[key]!)) x.n.state = 'removed';
    for (const s of mod.specs) {
      s.state = 'removed';
      for (const x of allClauses(s)) x.n.state = 'removed';
      stats.removed += allClauses(s).length;
      stats.touched.push({ where: s.id, removedSpec: true });
    }
    return { module: mod, oldDescription: null, diffed: true, stats, touchedSections: [...touchedSections] };
  }
  const mod = parseModule(text);
  if (oldText === null) return { module: mod, oldDescription: null, diffed: false, stats, touchedSections: [] };
  const old = parseModule(oldText);
  let oldDescription: string | null = null;
  if (old.description !== mod.description && (old.description || oldText.trim())) {
    oldDescription = old.description;
    stats.touched.push({ where: 'description', changed: 1 });
    stats.changed++;
  }
  const keys = [...new Set([...CLAUSE_SECTIONS, ...Object.keys(mod.sections), ...Object.keys(old.sections)])].filter((k) => k !== 'functional specs');
  for (const key of keys) {
    if (!mod.sections[key] && !old.sections[key]) continue;
    mod.sections[key] ??= [];
    if (diffContainer(old.sections[key] ?? [], mod.sections[key], key, stats)) touchedSections.add(key);
  }
  for (const key of new Set([...Object.keys(mod.sectionNotes), ...Object.keys(old.sectionNotes)])) {
    mod.sectionNotes[key] ??= [];
    if (diffContainer(old.sectionNotes[key] ?? [], mod.sectionNotes[key], `${key} notes`, stats)) touchedSections.add(key);
  }
  const oldSpecs = new Map(old.specs.map((s) => [s.id, s]));
  if (!mod.explicitIds) {
    // Position ids shift on every insertion, so specs pair by text: identical first, then the closest.
    const textOf = (s: FunctionalSpec) => allClauses(s).map((x) => x.n.text).join(' ');
    const pairs = lcs(old.specs, mod.specs, (a, b) => textOf(a) === textOf(b));
    const newFor = new Map(pairs);
    const usedN = new Set(pairs.map((p) => p[1]));
    old.specs.forEach((o, oi) => {
      if (newFor.has(oi)) return;
      let best: number | null = null;
      let bestS = 0.3;
      mod.specs.forEach((s, ni) => {
        if (usedN.has(ni)) return;
        const v = similar(textOf(o), textOf(s));
        if (v > bestS) {
          bestS = v;
          best = ni;
        }
      });
      if (best !== null) {
        newFor.set(oi, best);
        usedN.add(best);
      }
    });
    oldSpecs.clear();
    for (const [oi, ni] of newFor) oldSpecs.set(mod.specs[ni]!.id, old.specs[oi]!);
    old.specs.forEach((o, oi) => {
      if (!newFor.has(oi)) o.id = `old ${o.id}`;
    });
    const live = mod.specs.slice();
    old.specs.forEach((o, oi) => {
      if (newFor.has(oi)) return;
      removeSpec(o, stats);
      let k = oi - 1;
      while (k >= 0 && !newFor.has(k)) k--;
      mod.specs.splice(k < 0 ? 0 : mod.specs.indexOf(live[newFor.get(k)!]!) + 1, 0, o);
    });
  }
  for (const s of mod.specs) {
    if (s.state === 'removed') continue;
    const o = oldSpecs.get(s.id);
    if (!o) {
      s.state = 'added';
      stats.touched.push({ where: s.id, newSpec: true });
      for (const x of allClauses(s)) x.n.state = 'added';
      stats.added += allClauses(s).length;
      continue;
    }
    const a = diffContainer(o.clauses, s.clauses, s.id, stats);
    const b = diffContainer(o.tests, s.tests, `${s.id} tests`, stats);
    const c = diffContainer(o.notes, s.notes, `${s.id} notes`, stats);
    if (a || b || c) s.state = 'changed';
  }
  if (mod.explicitIds) {
    for (const o of old.specs) {
      if (mod.specs.some((s) => s.id === o.id)) continue;
      removeSpec(o, stats);
      mod.specs.push(o);
    }
  }
  const order = (t: Touched) => {
    if (t.where === 'description') return -3;
    const where = t.where.replace(/ (tests|notes)$/, '');
    const k = (CLAUSE_SECTIONS as readonly string[]).indexOf(where);
    if (k >= 0) return k - CLAUSE_SECTIONS.length;
    return mod.specs.findIndex((s) => s.id === where);
  };
  stats.touched.sort((a, b) => order(a) - order(b));
  if (mod.specs.some((s) => s.state !== 'same')) touchedSections.add('functional specs');
  return { module: mod, oldDescription, diffed: true, stats, touchedSections: [...touchedSections] };
}

function removeSpec(o: FunctionalSpec, stats: Stats): void {
  o.state = 'removed';
  stats.touched.push({ where: o.id, removedSpec: true });
  for (const x of allClauses(o)) x.n.state = 'removed';
  stats.removed += allClauses(o).length;
}

/** PLAIN-1.4: the Concepts plain predefines. */
export const PREDEFINED_CONCEPTS: ReadonlySet<string> = new Set(['UnitTests', 'ConformanceTests', 'AcceptanceTest', 'AcceptanceTests', 'Implementation']);

/** A spec's short title, as `/p-plain:page`'s nav shows it: its first clause up to the first stop. */
export function gist(s: string): string {
  const t = s.replace(/:([A-Za-z0-9+.\-_]+):/g, '$1').replace(/`/g, '');
  const cut = t.search(/[:;.—]|\s-\s/);
  return (cut > 20 ? t.slice(0, cut) : t).slice(0, 72);
}

/** PLAIN-2: a Concept from another Module, as the server resolved it. */
export interface PlainConcept {
  /** The Module it's defined in, as a path in the Checkout without `.plain` (`plain/productive`). */
  module: string;
  /** Its definition clause and nested bullets, as `clauseLines` writes them. */
  lines: string[];
  /** The same at the base; null when the base doesn't define it there. */
  baseLines: string[] | null;
}

/** PLAIN: what `GET /api/plain` answers for one Module of a Checkout. */
/**
 * PLAIN-1.1, PLAIN-5: where a Module is read from: a live Session's Checkout, by the id DIFF gave it,
 * or a PR's commits, fetched into a local clone of its repo (in `productiveio`), by repo and number.
 */
export type PlainSource = { kind: 'session'; session: string; checkout: string } | { kind: 'pr'; repo: string; number: number };

export interface PlainAnswer {
  source: PlainSource;
  checkout: { id: string; repo: string; where: string | null };
  /** The Module's path in the Checkout (`plain/crm.plain`). */
  path: string;
  /** The working tree's text; null when the file is gone (a deleted Module). */
  text: string | null;
  /** The base's text; null when the base doesn't have it (a new Module). */
  baseText: string | null;
  /** The base commit, short. */
  base: string;
  /** What the base is: "Branch point" (PLAIN-1.5), or "merge-base with develop" for a PR (PLAIN-5.3). */
  baseName: string;
  /** PLAIN-5.4: a PR whose last fetch failed is shown as fetched before, and this says why; null otherwise. */
  fetchError: string | null;
  /** PLAIN-2.1: every Concept the Module sees from other Modules, by name. */
  concepts: Record<string, PlainConcept>;
  /** PLAIN-2.4: import and requires paths with no Module in the Checkout or its base. */
  missing: string[];
  /** PLAIN-4.2: this text and base's Viewed key. */
  key: string;
  viewed: boolean;
  /** PLAIN-4.3: a mark exists for an earlier text or base of this Module. */
  changedSinceViewed: boolean;
}

/** PLAIN-5.1: a PR's changed Modules, from its fetched commits, each with its Viewed mark (PLAIN-4). */
export interface PlainPrFiles {
  repo: string;
  number: number;
  files: { path: string; viewed: boolean }[];
  /** PLAIN-5.4: why the last fetch failed; the files are then an earlier fetch's, or none. Null when it worked. */
  error: string | null;
}
