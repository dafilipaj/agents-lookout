import { describe, expect, it } from 'vitest';
import sessionView from '@/components/SessionView.tsx?raw';
import { FOLD_RANK, type FoldInput, LEFT_END, MORE_ORDER, NEVER_FOLD, RIGHT_END, SILENT, foldParts, lineWidth } from './status-fold';

/** The Artifact's "Idle, everything on" Session, in made-up widths: 7 px a character, separators 13 px, a 12 px seam. */
const base = (over: Partial<FoldInput> = {}): FoldInput => ({
  room: 10_000,
  widths: { repo: 42, changes: 77, files: 63, evidence: 154, servers: 112, subagents: 77, model: 77, effort: 28, context: 84 },
  locationMin: 74,
  separator: 13,
  seam: 12,
  more: (n) => 18 + `${n} more`.length * 7,
  note: null,
  ...over,
});
const whole = (over: Partial<FoldInput> = {}) => lineWidth(base(over), new Set());
const folds = (room: number, over: Partial<FoldInput> = {}) => [...foldParts(base({ ...over, room }))];

describe('the status line folds parts whole by rank (VIEW-5.19)', () => {
  it('VIEW-5.19: with room for every part nothing folds; one pixel short, the repo leaves first', () => {
    const all = whole();
    expect(folds(all)).toEqual([]);
    expect(folds(all - 1)).toEqual(['repo']);
  });

  it('VIEW-5.19: parts leave lowest rank first: repo, files, Effort, servers, model, Changes, Evidence, queued, shell, Subagents', () => {
    const input = base({ widths: { ...base().widths, queued: 140, shell: 91 } });
    const seen: string[][] = [];
    for (let room = lineWidth(input, new Set()); room > 0; room--) {
      const f = [...foldParts({ ...input, room })];
      if (!seen.length || seen.at(-1)!.join() !== f.join()) seen.push(f);
    }
    // Each step is the rank's first parts, one more or several ("N more" costs room too, so one alone may not fit).
    for (const step of seen) expect(step).toEqual(FOLD_RANK.slice(0, step.length));
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.length).toBeGreaterThan(seen[i - 1]!.length);
    expect(seen.at(-1)).toEqual([...FOLD_RANK]);
  });

  it('VIEW-5.19: the number of files leaves with the Changes; without lines there is no files count to fold', () => {
    const all = base();
    const changesOut = foldParts({ ...all, room: lineWidth(all, new Set(['repo', 'files', 'effort', 'servers', 'model', 'changes', 'files'])) });
    expect(changesOut.has('changes') && changesOut.has('files')).toBe(true);
    const noLines = base({ widths: { ...base().widths, files: undefined } });
    expect(folds(whole({ widths: noLines.widths }) - 1, { widths: noLines.widths })).toEqual(['repo']);
    // Next by rank after the repo is the Effort, and "N more" costs more than it frees, so the servers go too.
    expect(folds(whole({ widths: noLines.widths }) - 56, { widths: noLines.widths })).toEqual(['repo', 'effort', 'servers']);
  });

  it('VIEW-5.19: the location counts at its least width and never leaves; the context and "N more" never leave; the silent ones add no "N more"', () => {
    expect(new Set<string>(FOLD_RANK).has('location')).toBe(false);
    for (const p of NEVER_FOLD) expect(new Set<string>(FOLD_RANK).has(p)).toBe(false);
    // Folding only the silent ones draws no "N more".
    const all = base();
    expect(lineWidth(all, new Set(['repo', 'files']))).toBe(whole() - 42 - 13 - 63);
    // A folding part that isn't silent draws it, at the seam.
    expect(lineWidth(all, new Set(['repo', 'files', 'effort']))).toBe(whole() - 42 - 13 - 63 - 28 - 13 + all.more(1) + 13);
    // Nothing fits: every part that can leave has; the rest stay.
    expect(folds(10)).toEqual(FOLD_RANK.filter((p) => all.widths[p] !== undefined));
    expect(lineWidth(all, new Set(FOLD_RANK))).toBe(74 + 13 + all.more(6) + 12 + 84);
  });

  it('VIEW-5.19: "from the next reply" counts with the Effort while it is on the line, else with the model, else not on the line', () => {
    const note = 140;
    const all = base({ note });
    expect(lineWidth(all, new Set())).toBe(whole() + note);
    expect(lineWidth(all, new Set(['effort']))).toBe(lineWidth(base(), new Set(['effort'])) + note);
    expect(lineWidth(all, new Set(['effort', 'model']))).toBe(lineWidth(base(), new Set(['effort', 'model'])));
    // The line needs the note's width too: one pixel short of it all, the repo leaves.
    expect(folds(whole() + note - 1, { note })).toEqual(['repo']);
  });

  it('VIEW-5.19: every part on the line has an end, and every part that can leave has a rank (the guide\'s "A part of the status line")', () => {
    const ids = new Set([...sessionView.matchAll(/<PartSlot id="([a-z-]+)"/g)].map((m) => m[1]!));
    expect(ids.size).toBeGreaterThan(8);
    const ends = new Set<string>([...LEFT_END, ...RIGHT_END]);
    for (const id of ids) expect(ends.has(id), `${id} has no end in lib/status-fold.ts`).toBe(true);
    for (const id of ends) {
      if ((NEVER_FOLD as readonly string[]).includes(id)) continue;
      expect((FOLD_RANK as readonly string[]).includes(id), `${id} has no rank in lib/status-fold.ts`).toBe(true);
    }
    // A folded part that isn't silent has a row in "N more", in the line's order.
    expect(FOLD_RANK.filter((p) => !SILENT.has(p))).toEqual(expect.arrayContaining([...MORE_ORDER]));
    const lineOrder = [...LEFT_END, ...RIGHT_END].filter((p) => (MORE_ORDER as readonly string[]).includes(p));
    expect([...MORE_ORDER]).toEqual(lineOrder);
  });
});
