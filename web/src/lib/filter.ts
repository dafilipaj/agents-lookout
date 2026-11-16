import type { WorkSnapshot } from '@shared/work.ts';
import { foldPoint, libraryMatches } from '@shared/library-search.ts';
import type { SessionRow } from '@shared/types.ts';
import { HARNESS_NAME } from '@/lib/sessions';

/** A `[start, end)` range of a field's text, in UTF-16 units of the text as shown. */
export type Range = [number, number];

/** SIDE-12.2: what a field is, so the row knows which it shows. */
export type FieldKey =
  | 'title'
  | 'repo'
  | 'worktree'
  | 'branch'
  | 'harness'
  | 'model'
  | 'topic'
  | 'pr-number'
  | 'pr-title'
  | 'task'
  | 'first-prompt'
  | 'waiting-for'
  | 'activity'
  | 'done-note';

export interface FilterField {
  /** Unique in the row: the key, and for a Topic its place among the row's Topics. */
  id: string;
  key: FieldKey;
  /** What starts the extra line for a hidden match (SIDE-12.6): `Prompt:`, `PR #3719:`. */
  label: string;
  text: string;
  /** SIDE-12.3: a name matches fuzzily too, text only as a substring. */
  kind: 'name' | 'text';
}

/** A field that some word matched, with every word's ranges in it, merged and in order. */
export interface FieldHit {
  field: FilterField;
  ranges: Range[];
}

/** A field one word matched: its index into `RowMatch.hits`, and that word's own ranges in it. */
export interface WordHit {
  hit: number;
  ranges: Range[];
}

export interface RowMatch {
  /** In SIDE-12.2's order. */
  hits: FieldHit[];
  /** Per word of the query: the fields it matched, in SIDE-12.2's order. */
  words: WordHit[][];
}

/** SIDE-12.6: the field the extra line names, and where in it the match to keep in view starts. */
export interface HiddenHit extends FieldHit {
  at: number;
}

/** What Work's list says of a live Session (WORK-4): its Linked PR and Task, the first in Work's order. */
export interface SessionWork {
  pr?: { number: number; title: string };
  task?: { title: string };
}

/** SIDE-12.2: each Session's Linked PR and Task from Work's list; empty until it has loaded. */
export function sessionWork(work: WorkSnapshot | null): Map<string, SessionWork> {
  const out = new Map<string, SessionWork>();
  if (!work) return out;
  const entry = (id: string) => {
    let e = out.get(id);
    if (!e) out.set(id, (e = {}));
    return e;
  };
  for (const pr of [...work.prs.mine, ...work.prs.reviewRequests]) {
    for (const s of pr.links?.sessions ?? []) {
      // Linked through a Task, the PR is the Task's, not the Session's (as `linkedPrs`).
      if (s.reason.startsWith('through')) continue;
      const e = entry(s.sessionId);
      e.pr ??= { number: pr.number, title: pr.title };
    }
  }
  for (const task of work.tasks.tasks) {
    for (const s of task.links?.sessions ?? []) {
      if (s.reason.startsWith('through')) continue;
      const e = entry(s.sessionId);
      e.task ??= { title: task.title };
    }
  }
  return out;
}

/** SIDE-12.2: a row's fields, names first, then text, in the order the extra line picks from. */
export function rowFields(row: SessionRow, topics: readonly string[] = [], work: SessionWork | undefined = undefined): FilterField[] {
  const fields: FilterField[] = [];
  const add = (key: FieldKey, label: string, text: string | null | undefined, kind: FilterField['kind'], id: string = key) => {
    if (text) fields.push({ id, key, label, text, kind });
  };
  add('title', 'Title:', row.title, 'name');
  add('repo', 'Repo:', row.git?.repo, 'name');
  add('worktree', 'Worktree:', row.git?.worktree, 'name');
  add('branch', 'Branch:', row.git?.branch, 'name');
  add('harness', 'Harness:', HARNESS_NAME[row.harness], 'name');
  add('model', 'Model:', row.model, 'name');
  topics.forEach((t, i) => add('topic', 'Topic:', t, 'name', `topic-${i}`));
  if (work?.pr) {
    add('pr-number', 'PR', `#${work.pr.number}`, 'name');
    add('pr-title', `PR #${work.pr.number}:`, work.pr.title, 'name');
  }
  add('task', 'Task:', work?.task?.title, 'name');
  add('first-prompt', 'Prompt:', row.firstPrompt, 'text');
  add('waiting-for', 'Waiting for:', row.waitingFor, 'text');
  add('activity', 'Doing:', row.activity, 'text');
  add('done-note', 'Done:', row.done?.note, 'text');
  return fields;
}

/** SIDE-12.1: the query's words, split at whitespace. */
export const queryWords = (query: string): string[] => query.trim().split(/\s+/u).filter(Boolean);

/** SIDE-12.3: a word of this many code points or more also matches a name fuzzily. */
export const FUZZY_FROM = 3;

/**
 * SIDE-12.1–12.3: whether every word matches one of the fields, and where. A word matches a field
 * that contains it (LIB-2.4's folding), or, from `FUZZY_FROM` code points, a name with its letters
 * in order. Null when some word matches nothing; an empty query matches with no hits.
 */
export function matchFields(fields: readonly FilterField[], words: readonly string[]): RowMatch | null {
  const ranges = fields.map(() => [] as Range[]);
  const perWord: WordHit[][] = [];
  for (const word of words) {
    const matched: WordHit[] = [];
    fields.forEach((f, i) => {
      let found = libraryMatches(f.text, word);
      if (!found.length && f.kind === 'name' && [...word].length >= FUZZY_FROM) found = fuzzyRanges(f.text, word);
      if (found.length) {
        // The field's index for now; its index into `hits` below.
        matched.push({ hit: i, ranges: found });
        ranges[i]!.push(...found);
      }
    });
    if (!matched.length) return null;
    perWord.push(matched);
  }
  const hits: FieldHit[] = [];
  const at = new Map<number, number>();
  fields.forEach((field, i) => {
    if (!ranges[i]!.length) return;
    at.set(i, hits.length);
    hits.push({ field, ranges: merge(ranges[i]!) });
  });
  return { hits, words: perWord.map((w) => w.map((m) => ({ hit: at.get(m.hit)!, ranges: m.ranges }))) };
}

/** SIDE-12: whether a row passes the filter, and where it matched. */
export function filterRow(row: SessionRow, query: string, topics: readonly string[] = [], work?: SessionWork): RowMatch | null {
  return matchFields(rowFields(row, topics, work), queryWords(query));
}

/**
 * SIDE-12.6: the field to name on the extra line: of the words that matched nothing the row
 * shows, the first field one of them matched, in SIDE-12.2's order, with where the first of those
 * words' matches in it starts (not a shown word's, earlier in the same text). Null when every word shows.
 */
export function hiddenHit(match: RowMatch | null, shown: (field: FilterField) => boolean): HiddenHit | null {
  if (!match) return null;
  const hidden = match.words.filter((word) => !word.some((w) => shown(match.hits[w.hit]!.field)));
  let first: number | null = null;
  for (const word of hidden) for (const w of word) if (first === null || w.hit < first) first = w.hit;
  if (first === null) return null;
  let at = Infinity;
  for (const word of hidden) for (const w of word) if (w.hit === first) for (const [from] of w.ranges) at = Math.min(at, from);
  return { ...match.hits[first]!, at };
}

/** The ranges marked in the field with this id, or none. */
export function rangesOf(match: RowMatch | null, id: string): Range[] {
  return match?.hits.find((h) => h.field.id === id)?.ranges ?? [];
}

/**
 * SIDE-12.3: fzf's v1. A forward scan finds where the word's letters, folded, first all appear in
 * order; a backward scan from there finds the latest start, so the letters sit as close together as
 * that finds. The ranges cover the whole characters the letters came from.
 */
export function fuzzyRanges(text: string, word: string): Range[] {
  const t = foldMap(text);
  const needle = foldMap(word).points;
  if (!needle.length) return [];
  // Code point against code point: a UTF-16 unit of one emoji never stands for part of another.
  let j = 0;
  let end = -1;
  for (let i = 0; i < t.points.length; i++) {
    if (t.points[i] === needle[j] && ++j === needle.length) {
      end = i;
      break;
    }
  }
  if (end < 0) return [];
  const at: number[] = [];
  j = needle.length - 1;
  for (let i = end; i >= 0 && j >= 0; i--) {
    if (t.points[i] === needle[j]) {
      at.push(i);
      j--;
    }
  }
  return merge(at.reverse().map((i) => [t.start[i]!, t.end[i]!] as Range));
}

/** LIB-2.4's folding, as code points, and for each the source range of the character it came from. */
function foldMap(text: string): { points: string[]; start: number[]; end: number[] } {
  const points: string[] = [];
  const start: number[] = [];
  const end: number[] = [];
  let at = 0;
  for (const c of text) {
    for (const p of foldPoint(c)) {
      points.push(p);
      start.push(at);
      end.push(at + c.length);
    }
    at += c.length;
  }
  return { points, start, end };
}

/** Sorted, with touching and overlapping ranges joined. */
function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}
