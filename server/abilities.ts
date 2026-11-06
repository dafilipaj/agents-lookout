import { ABILITY_KEY, ABILITY_LEAF_KINDS, type AbilityEntry, type AbilityLeafKind, type AbilityRule } from '../shared/plain.ts';

/**
 * PLAIN-7.6: fantastic-productive's abilities catalogue, read as text. An entry is
 * `'<scope>.can_<name>': { subject, description, when }` in a TypeScript object literal; this reads
 * those literals with a tokenizer and never evaluates the file.
 */

/** PLAIN-7.6: the catalogue's files, by path in the Checkout. */
export function isCatalogueFile(path: string): boolean {
  if (path.split('/').includes('node_modules')) return false;
  return /(^|\/)abilities\/catalogue\/[^/]+\.ts$/.test(path) || /(^|\/)abilities\/catalogue\.ts$/.test(path);
}

type Tok =
  | { t: 'str'; v: string; at: number; end: number }
  | { t: 'id'; v: string; at: number; end: number }
  | { t: 'num'; v: number; at: number; end: number }
  | { t: 'p'; v: string; at: number; end: number }
  | { t: 'doc'; v: string; at: number; end: number };

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' };

/** What a string's `\` escape stands for, read from just past the backslash, and how many characters it takes there. */
function escaped(src: string, i: number): [string, number] {
  const n = src[i]!;
  const code = (hex: string) => {
    const v = /^[0-9a-fA-F]+$/.test(hex) ? parseInt(hex, 16) : NaN;
    return v <= 0x10ffff ? String.fromCodePoint(v) : null;
  };
  if (n === 'u' && src[i + 1] === '{') {
    const close = src.indexOf('}', i + 2);
    const c = close < 0 ? null : code(src.slice(i + 2, close));
    if (c !== null) return [c, close - i + 1];
  } else if (n === 'u' || n === 'x') {
    const len = n === 'u' ? 4 : 2;
    const hex = src.slice(i + 1, i + 1 + len);
    const c = hex.length === len ? code(hex) : null;
    if (c !== null) return [c, 1 + len];
  }
  // A line continuation: the backslash and its line break stand for nothing.
  if (n === '\n') return ['', 1];
  if (n === '\r') return ['', src[i + 1] === '\n' ? 2 : 1];
  return [ESCAPES[n] ?? n, 1];
}

/** Strings, identifiers, numbers and punctuation; `/** … *\/` comments kept as `doc`, other comments dropped. */
function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl + 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close < 0 ? src.length : close + 2;
      if (src[i + 2] === '*' && src[i + 3] !== '/') out.push({ t: 'doc', v: src.slice(i + 3, close < 0 ? src.length : close), at: i, end });
      i = end;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      let v = '';
      let plain = true;
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const [ch, len] = escaped(src, j + 1);
          v += ch;
          j += 1 + len;
          continue;
        }
        // A template with a placeholder isn't a constant string.
        if (c === '`' && src[j] === '$' && src[j + 1] === '{') plain = false;
        v += src[j];
        j++;
      }
      out.push(plain ? { t: 'str', v, at: i, end: j + 1 } : { t: 'p', v: '`', at: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 200));
    if (id) {
      out.push({ t: 'id', v: id[0], at: i, end: i + id[0].length });
      i += id[0].length;
      continue;
    }
    const num = /^\d+(?:\.\d+)?/.exec(src.slice(i, i + 50));
    if (num) {
      out.push({ t: 'num', v: Number(num[0]), at: i, end: i + num[0].length });
      i += num[0].length;
      continue;
    }
    if (c === '.' && src.startsWith('...', i)) {
      out.push({ t: 'p', v: '...', at: i, end: i + 3 });
      i += 3;
      continue;
    }
    out.push({ t: 'p', v: c, at: i, end: i + 1 });
    i++;
  }
  return out;
}

const OPEN: Record<string, string> = { '{': '}', '[': ']', '(': ')' };

/** The index after a value starting at `i`: up to the first `,`, `;` or closing bracket at its own depth. */
function valueEnd(toks: readonly Tok[], i: number): number {
  let depth = 0;
  for (let j = i; j < toks.length; j++) {
    const k = toks[j]!;
    if (k.t !== 'p') continue;
    if (OPEN[k.v]) depth++;
    else if (k.v === '}' || k.v === ']' || k.v === ')') {
      if (depth === 0) return j;
      depth--;
      if (depth === 0 && j + 1 < toks.length && toks[j + 1]!.t === 'p' && (toks[j + 1]!.v === ',' || toks[j + 1]!.v === ';')) return j + 1;
    } else if (depth === 0 && (k.v === ',' || k.v === ';')) return j;
  }
  return toks.length;
}

/** The index of the bracket closing the one at `open`. */
function matchClose(toks: readonly Tok[], open: number): number {
  let depth = 0;
  for (let j = open; j < toks.length; j++) {
    const k = toks[j]!;
    if (k.t !== 'p') continue;
    if (OPEN[k.v]) depth++;
    else if (k.v === '}' || k.v === ']' || k.v === ')') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return toks.length;
}

type Lit = string | number | boolean | null | Lit[] | { [k: string]: Lit } | { ref: string } | { spread: string };
const FAIL = Symbol('fail');

/** A literal from `toks[i..end)`: objects, arrays, strings, numbers, booleans and a bare name; FAIL otherwise. */
function literal(toks: readonly Tok[], i: number, end: number): Lit | typeof FAIL {
  // `x as const` and `x satisfies T` say nothing about the value.
  let stop = end;
  for (let j = i; j < end; j++) {
    const k = toks[j]!;
    if (k.t === 'id' && (k.v === 'as' || k.v === 'satisfies') && depthAt(toks, i, j) === 0) {
      stop = j;
      break;
    }
  }
  const [v, next] = parse(toks, i, stop);
  return v === FAIL || next !== stop ? FAIL : v;
}

function depthAt(toks: readonly Tok[], from: number, to: number): number {
  let d = 0;
  for (let j = from; j < to; j++) {
    const k = toks[j]!;
    if (k.t !== 'p') continue;
    if (OPEN[k.v]) d++;
    else if (k.v === '}' || k.v === ']' || k.v === ')') d--;
  }
  return d;
}

function parse(toks: readonly Tok[], i: number, end: number): [Lit | typeof FAIL, number] {
  const k = toks[i];
  if (!k || i >= end) return [FAIL, i];
  if (k.t === 'str') return [k.v, i + 1];
  if (k.t === 'num') return [k.v, i + 1];
  if (k.t === 'id') {
    if (k.v === 'true' || k.v === 'false') return [k.v === 'true', i + 1];
    if (k.v === 'null') return [null, i + 1];
    // A bare name: a constant, read through by the caller. A call or a member isn't a literal.
    const n = toks[i + 1];
    if (n && i + 1 < end && n.t === 'p' && (n.v === '(' || n.v === '.')) return [FAIL, i];
    return [{ ref: k.v }, i + 1];
  }
  if (k.t === 'p' && k.v === '[') {
    const arr: Lit[] = [];
    let j = i + 1;
    while (j < end) {
      const c = toks[j]!;
      if (c.t === 'p' && c.v === ']') return [arr, j + 1];
      // `...NAME`: a constant list spread in, read through by the caller.
      if (c.t === 'p' && c.v === '...' && toks[j + 1]?.t === 'id') {
        arr.push({ spread: toks[j + 1]!.v });
        j += 2;
        if (toks[j]?.t === 'p' && toks[j]!.v === ',') j++;
        continue;
      }
      const [v, n] = parse(toks, j, end);
      if (v === FAIL) return [FAIL, j];
      arr.push(v);
      j = n;
      const sep = toks[j];
      if (sep?.t === 'p' && sep.v === ',') j++;
    }
    return [FAIL, j];
  }
  if (k.t === 'p' && k.v === '{') {
    const obj: { [k: string]: Lit } = {};
    let j = i + 1;
    while (j < end) {
      const c = toks[j]!;
      if (c.t === 'doc') {
        j++;
        continue;
      }
      if (c.t === 'p' && c.v === '}') return [obj, j + 1];
      if (c.t !== 'id' && c.t !== 'str') return [FAIL, j];
      const colon = toks[j + 1];
      if (colon?.t !== 'p' || colon.v !== ':') return [FAIL, j];
      const [v, n] = parse(toks, j + 2, end);
      if (v === FAIL) return [FAIL, j];
      obj[c.v] = v;
      j = n;
      const sep = toks[j];
      if (sep?.t === 'p' && sep.v === ',') j++;
    }
    return [FAIL, j];
  }
  return [FAIL, i];
}

const isRef = (v: Lit): v is { ref: string } => !!v && typeof v === 'object' && !Array.isArray(v) && 'ref' in v && Object.keys(v).length === 1;
const isSpread = (v: Lit): v is { spread: string } => !!v && typeof v === 'object' && !Array.isArray(v) && 'spread' in v && Object.keys(v).length === 1;

/**
 * A list of conditions: a constant list read through, and `...NAME` spread in place. Each item keeps
 * the constants it was read through, so one that names its own list again is a cycle, not a recursion.
 */
function listOf(v: Lit, consts: ReadonlyMap<string, Lit>, seen: ReadonlySet<string>): { item: Lit; seen: ReadonlySet<string> }[] | null {
  if (isRef(v)) {
    const c = consts.get(v.ref);
    return c === undefined || seen.has(v.ref) ? null : listOf(c, consts, new Set([...seen, v.ref]));
  }
  if (!Array.isArray(v)) return null;
  const out: { item: Lit; seen: ReadonlySet<string> }[] = [];
  for (const x of v) {
    if (!isSpread(x)) {
      out.push({ item: x, seen });
      continue;
    }
    const c = consts.get(x.spread);
    const inner = c === undefined || seen.has(x.spread) ? null : listOf(c, consts, new Set([...seen, x.spread]));
    if (!inner) return null;
    out.push(...inner);
  }
  return out;
}

/** PLAIN-7.5: a `when` as conditions, constants read through; null when it isn't one. */
function toRule(v: Lit, consts: ReadonlyMap<string, Lit>, seen: ReadonlySet<string> = new Set()): AbilityRule | null {
  if (isRef(v)) {
    const c = consts.get(v.ref);
    if (c === undefined || seen.has(v.ref)) return null;
    return toRule(c, consts, new Set([...seen, v.ref]));
  }
  if (!v || typeof v !== 'object' || Array.isArray(v) || isSpread(v)) return null;
  const o = v as { [k: string]: Lit };
  const keys = Object.keys(o);
  if (keys.length === 1 && (keys[0] === 'allOf' || keys[0] === 'anyOf')) {
    const list = listOf(o[keys[0]]!, consts, seen);
    if (!list) return null;
    const parts = list.map((x) => toRule(x.item, consts, x.seen));
    if (parts.some((x) => x === null)) return null;
    return keys[0] === 'allOf' ? { allOf: parts as AbilityRule[] } : { anyOf: parts as AbilityRule[] };
  }
  if (keys.length === 1 && keys[0] === 'not') {
    const inner = toRule(o.not!, consts, seen);
    return inner ? { not: inner } : null;
  }
  const kind = keys.find((k): k is AbilityLeafKind => (ABILITY_LEAF_KINDS as readonly string[]).includes(k));
  if (!kind || typeof o[kind] !== 'string') return null;
  const rest = keys.filter((k) => k !== kind);
  // A plan feature may say which state it asks; anything else isn't a condition this knows.
  if (rest.some((k) => !(kind === 'feature' && k === 'state'))) return null;
  const state = kind === 'feature' && typeof o.state === 'string' ? o.state : undefined;
  return state ? { kind, name: o[kind] as string, state } : { kind, name: o[kind] as string };
}

/** A doc comment's text: its leading stars and the blank lines around it removed. */
function docText(raw: string): string {
  return raw
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trimEnd())
    .join('\n')
    .replace(/^\s*\n|\n\s*$/g, '')
    .trim();
}

/** PLAIN-7.6: every entry of one catalogue file, by key. */
export function parseCatalogue(src: string, file: string): Map<string, AbilityEntry> {
  const toks = tokenize(src);
  // `const NAME = <literal>`: a `when` may name one declared in the same file.
  const consts = new Map<string, Lit>();
  for (let i = 0; i + 2 < toks.length; i++) {
    const k = toks[i]!;
    if (k.t !== 'id' || (k.v !== 'const' && k.v !== 'let')) continue;
    const name = toks[i + 1]!;
    if (name.t !== 'id') continue;
    let j = i + 2;
    // `const NAME: Type = …`
    if (toks[j]?.t === 'p' && toks[j]!.v === ':') {
      while (j < toks.length && !(toks[j]!.t === 'p' && toks[j]!.v === '=')) j++;
    }
    if (toks[j]?.t !== 'p' || toks[j]!.v !== '=') continue;
    // One literal, whatever follows it: `as const`, a `;`, or the next statement.
    const [v] = parse(toks, j + 1, toks.length);
    if (v !== FAIL) consts.set(name.v, v);
  }

  // Entries come in the file's order, so each one's line counts on from the last one's.
  let counted = 0;
  let line = 1;
  const lineOf = (at: number) => {
    for (; counted < at; counted++) if (src.charCodeAt(counted) === 10) line++;
    return line;
  };
  const out = new Map<string, AbilityEntry>();
  for (let i = 0; i + 2 < toks.length; i++) {
    const k = toks[i]!;
    if (k.t !== 'str' || !ABILITY_KEY.test(k.v)) continue;
    const colon = toks[i + 1]!;
    const open = toks[i + 2]!;
    if (colon.t !== 'p' || colon.v !== ':' || open.t !== 'p' || open.v !== '{') continue;
    const close = matchClose(toks, i + 2);
    let description = '';
    let rule: AbilityRule | null = null;
    let source = '';
    // The entry's own fields, at its depth.
    let j = i + 3;
    while (j < close) {
      const f = toks[j]!;
      if (f.t === 'doc') {
        j++;
        continue;
      }
      if ((f.t === 'id' || f.t === 'str') && toks[j + 1]?.t === 'p' && toks[j + 1]!.v === ':') {
        const end = valueEnd(toks, j + 2);
        if (f.v === 'description') {
          const parts = toks.slice(j + 2, end).filter((x) => !(x.t === 'p' && x.v === '+'));
          if (parts.every((x) => x.t === 'str')) description = parts.map((x) => x.v).join('');
        } else if (f.v === 'custom' && !source && end === j + 3 && toks[j + 2]!.t === 'str') {
          // An entry decided by a custom rule alone names it in place of a `when`.
          source = src.slice(f.at, toks[j + 2]!.end);
          rule = { kind: 'custom', name: toks[j + 2]!.v as string };
        } else if (f.v === 'when' && end > j + 2) {
          source = src.slice(toks[j + 2]!.at, toks[end - 1]!.end);
          const v = literal(toks, j + 2, end);
          rule = v === FAIL ? null : toRule(v, consts);
        }
        j = end;
        if (toks[j]?.t === 'p' && toks[j]!.v === ',') j++;
        continue;
      }
      j++;
    }
    const prev = toks[i - 1];
    const doc = prev?.t === 'doc' && !/\S/.test(src.slice(prev.end, k.at)) ? docText(prev.v) : '';
    if (!out.has(k.v)) out.set(k.v, { file, line: lineOf(k.at), description, doc, rule, source });
    i = close;
  }
  return out;
}

/** PLAIN-7.5: the abilities a rule names, which a card describes beside it. */
export function namedAbilities(rule: AbilityRule | null): string[] {
  if (!rule) return [];
  if ('allOf' in rule) return rule.allOf.flatMap(namedAbilities);
  if ('anyOf' in rule) return rule.anyOf.flatMap(namedAbilities);
  if ('not' in rule) return namedAbilities(rule.not);
  return rule.kind === 'ability' ? [rule.name] : [];
}
