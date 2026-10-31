import { cn } from '@/lib/utils';
import { formatLines } from '@/lib/changes';

/**
 * DIFF-1.1, DS-2.5: lines added in green and removed in red, as a diff colours them; shortened from
 * 1000 (DIFF-1.2). The accessible name is its container's: the numbers alone say little.
 */
export function ChangesCount({ additions, deletions, className }: { additions: number; deletions: number; className?: string }) {
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center gap-1 tabular-nums', className)} data-slot="changes-count">
      <span className="text-diff-added-text">+{formatLines(additions)}</span>
      <span className="text-diff-removed-text">−{formatLines(deletions)}</span>
    </span>
  );
}
