/**
 * VIEW-5.5, VIEW-5.19: the status line's parts, which end each sits in, in what order, and which
 * leave first when the line runs out of room. A new part names its end and its rank here (the
 * guide's "A part of the status line"); the guard in `status-fold.test.ts` checks the line's parts
 * against this table.
 */

/** A part of the status line, by its `data-part`. */
export type StatusPart =
  | 'repo'
  | 'location'
  | 'changes'
  | 'files'
  | 'evidence'
  | 'queued'
  | 'servers'
  | 'more'
  | 'subagents'
  | 'shell'
  | 'model'
  | 'effort'
  | 'context';

/** VIEW-5.5: the left end says where the Session works and what it changed, the right how the agent is doing. */
export const LEFT_END = ['repo', 'location', 'changes', 'evidence', 'queued', 'servers', 'more'] as const satisfies readonly StatusPart[];
export const RIGHT_END = ['subagents', 'shell', 'model', 'effort', 'context'] as const satisfies readonly StatusPart[];

/**
 * VIEW-5.19: first to leave first. What the Session is doing now (Subagents, a shell, a queued job)
 * outranks what it did (Evidence, Changes), which outranks how it's set up (model, servers, Effort, repo).
 */
export const FOLD_RANK = ['repo', 'files', 'effort', 'servers', 'model', 'changes', 'evidence', 'queued', 'shell', 'subagents'] as const satisfies readonly StatusPart[];
export type FoldingPart = (typeof FOLD_RANK)[number];

/** VIEW-5.19: these leave without a row in "N more": the location's tooltip names the repo, the count's the files. */
export const SILENT: ReadonlySet<StatusPart> = new Set(['repo', 'files']);

/** VIEW-5.19: never leave. The location is cut instead, down to its minimum; the rest stay whole. */
export const NEVER_FOLD = ['location', 'context', 'more'] as const satisfies readonly StatusPart[];

/** VIEW-5.19: the parts in "N more"'s list, in the line's order. */
export const MORE_ORDER = ['changes', 'evidence', 'queued', 'servers', 'subagents', 'shell', 'model', 'effort'] as const satisfies readonly FoldingPart[];

/** VIEW-5.19: the location keeps its icon and this many characters before a part folds. */
export const LOCATION_MIN_CHARS = 8;

export interface FoldInput {
  /** The width the two ends share: the line's, less its padding. */
  room: number;
  /** Each part the line has, whole, by its width (no separator); the files count is its own part, beside `changes`. */
  widths: Partial<Record<StatusPart, number>>;
  /** The location's least width, cut (its icon and 8 characters, or all of it when shorter); null without one. */
  locationMin: number | null;
  /** The width a separator adds between two parts of an end: the dot and the gaps either side. */
  separator: number;
  /** The gap between the two ends. */
  seam: number;
  /** "N more"'s width for a count. */
  more(count: number): number;
  /** VIEW-5.19: "from the next reply", carried by the Effort when it's on the line, else by the model; null without one. */
  note: number | null;
}

/**
 * VIEW-5.19: the parts that leave so the line fits: none, then one more at a time by rank, the first
 * set whose two ends fit. The files count leaves with the Changes. When nothing fits, every part that
 * can leave has.
 */
export function foldParts(input: FoldInput): Set<FoldingPart> {
  const present = FOLD_RANK.filter((p) => input.widths[p] !== undefined);
  for (let k = 0; k <= present.length; k++) {
    const folded = new Set<FoldingPart>(present.slice(0, k));
    if (folded.has('changes')) folded.add('files');
    if (lineWidth(input, folded) <= input.room) return folded;
  }
  const all = new Set<FoldingPart>(present);
  if (all.has('changes')) all.add('files');
  return all;
}

/** The two ends' width with these parts folded. */
export function lineWidth(input: FoldInput, folded: ReadonlySet<FoldingPart>): number {
  const { widths } = input;
  const on = (p: StatusPart) => widths[p] !== undefined && !folded.has(p as FoldingPart);
  const inMore = MORE_ORDER.filter((p) => widths[p] !== undefined && folded.has(p)).length;
  const left: number[] = [];
  for (const p of LEFT_END) {
    if (p === 'location') {
      if (input.locationMin !== null) left.push(input.locationMin);
    } else if (p === 'more') {
      if (inMore) left.push(input.more(inMore));
    } else if (p === 'changes') {
      if (on('changes')) left.push(widths.changes! + (on('files') ? (widths.files ?? 0) : 0));
    } else if (on(p)) left.push(widths[p]!);
  }
  // The note goes with the Effort while it's on the line, else with the model; folded, it's on their row.
  const carrier = on('effort') ? 'effort' : on('model') ? 'model' : null;
  const right: number[] = [];
  for (const p of RIGHT_END) {
    if (!on(p)) continue;
    right.push(widths[p]! + (p === carrier && input.note !== null ? input.note : 0));
  }
  const end = (parts: number[]) => (parts.length ? parts.reduce((a, b) => a + b, 0) + (parts.length - 1) * input.separator : 0);
  return end(left) + end(right) + (left.length && right.length ? input.seam : 0);
}
