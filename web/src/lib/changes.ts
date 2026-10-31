import type { ChangedFile, RowChanges } from '@shared/types.ts';

/** DIFF-1.2: 999, then `1.2k` (one decimal, never rounded up) below 10k, then `12k`. */
export function formatLines(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(Math.floor(n / 100) / 10).toFixed(1)}k`;
  return `${Math.floor(n / 1000)}k`;
}

const files = (n: number) => `${n} file${n === 1 ? '' : 's'}`;

/** DIFF-1.4: the row's accessible name part, "120 lines added, 30 removed". */
export function linesLabel(c: Pick<RowChanges, 'additions' | 'deletions'>): string {
  return `${c.additions} line${c.additions === 1 ? '' : 's'} added, ${c.deletions} removed`;
}

/** DIFF-1.2: the tooltip, with the exact numbers and the files. */
export function changesTip(c: RowChanges): string {
  return c.additions || c.deletions ? `${linesLabel(c)} in ${files(c.files)}` : `${files(c.files)} changed`;
}

/** DIFF-1.3: the status line's text after the count, `· 4 files`. */
export function filesPart(c: RowChanges): string {
  return files(c.files);
}

/** DIFF-1.4: the status line button's accessible name. */
export function changesButtonLabel(c: RowChanges): string {
  return c.additions || c.deletions ? `${linesLabel(c)} in ${files(c.files)}, show changed files` : `${files(c.files)} changed, show changed files`;
}

/** DIFF-1.1: the row shows lines only when some changed. */
export function hasLines(c: RowChanges | null | undefined): c is RowChanges {
  return !!c && (c.additions > 0 || c.deletions > 0);
}

/** DIFF-3.1: a file's kind as the list says it, nothing for a plain modification. */
export function kindLabel(f: ChangedFile): string | null {
  switch (f.kind) {
    case 'modified':
      return null;
    case 'renamed':
      return `${f.oldPath ?? '?'} → ${f.path}`;
    case 'type_changed':
      return 'type changed';
    case 'mode_changed':
      return 'mode changed';
    default:
      return f.kind;
  }
}

/** DIFF-4.2: why a file has no action, or null when it opens. */
export function noOpenReason(f: ChangedFile): string | null {
  if (f.kind === 'submodule') return 'A submodule has no diff to open.';
  if (f.kind === 'deleted' && f.binary) return 'A deleted binary file has nothing to open.';
  return null;
}

/** DIFF-3.1, 3.5: a path as its file name and its folder. */
export function splitPath(path: string): { name: string; folder: string } {
  const i = path.lastIndexOf('/');
  return i < 0 ? { name: path, folder: '' } : { name: path.slice(i + 1), folder: path.slice(0, i + 1) };
}
