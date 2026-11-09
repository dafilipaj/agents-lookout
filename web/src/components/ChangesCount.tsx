import { cn } from '@/lib/utils';
import { formatLines } from '@/lib/changes';

/**
 * DIFF-1.1, DS-2.5: lines added in green and removed in red, as a diff colours them; shortened from
 * 1000 (DIFF-1.2). `quiet` (DS-22.2): a sidebar row's, in the row's own colour. The accessible name
 * is its container's: the numbers alone say little.
 */
export function ChangesCount({ additions, deletions, className, quiet = false }: { additions: number; deletions: number; className?: string; quiet?: boolean }) {
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center gap-1 tabular-nums', className)} data-slot="changes-count">
      <span className={quiet ? undefined : 'text-diff-added-text'}>+{formatLines(additions)}</span>
      <span className={quiet ? undefined : 'text-diff-removed-text'}>−{formatLines(deletions)}</span>
    </span>
  );
}
