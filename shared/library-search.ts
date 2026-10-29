/**
 * LIB-2.4: literal, case-insensitive text search for all of Unicode, shared by the server's
 * filter and the panel's hit marks so both agree on what matches. Each code point is folded
 * on its own (no locale, no final-sigma context): lower, upper, then lower case gives full case
 * folding's expansions (ß and ẞ → ss, ﬃ → ffi, İ → i̇), with dotless ı kept apart from I as
 * Unicode's default folding does, and final ς folded with σ.
 */
function foldPoint(c: string): string {
  if (c === 'ı') return c;
  return c.toLowerCase().toUpperCase().toLowerCase().replace(/ς/g, 'σ');
}

export function foldLibraryText(text: string): string {
  let out = '';
  for (const c of text) out += foldPoint(c);
  return out;
}

/** Whether the folded query occurs in the folded text. An empty query matches everything. */
export function libraryIncludes(text: string, query: string): boolean {
  return foldLibraryText(text).includes(foldLibraryText(query));
}

/**
 * The hits of `query` in `text` as [start, end) ranges of the original string. A hit that
 * starts or ends inside one character's expansion covers that whole character; overlapping
 * ranges merge. An empty query has no hits.
 */
export function libraryMatches(text: string, query: string): [number, number][] {
  const q = foldLibraryText(query);
  if (!q) return [];
  let folded = '';
  const start: number[] = [], end: number[] = [];
  let at = 0;
  for (const c of text) {
    const f = foldPoint(c);
    for (let n = 0; n < f.length; n++) { start.push(at); end.push(at + c.length); }
    folded += f; at += c.length;
  }
  const ranges: [number, number][] = [];
  for (let hit = folded.indexOf(q); hit >= 0; hit = folded.indexOf(q, hit + q.length)) {
    const range: [number, number] = [start[hit]!, end[hit + q.length - 1]!];
    const last = ranges.at(-1);
    if (last && range[0] < last[1]) last[1] = Math.max(last[1], range[1]);
    else ranges.push(range);
  }
  return ranges;
}
