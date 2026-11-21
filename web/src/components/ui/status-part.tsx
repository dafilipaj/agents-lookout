import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * VIEW-5.19, DS-7.3: where a part of the status line is drawn: on the line, in the line's own look (a
 * 24 px target in the 28 px line), or folded, as a row of "N more"'s list. A part's component takes
 * its `look` and draws its one button in it, so the row does what a click on the part does.
 */
export type PartLook = 'line' | 'row';

/** VIEW-5.19: a row of "N more"'s list, 28 px, its name in the body text. */
const ROW = 'flex h-7 w-full min-w-0 shrink-0 items-center gap-2 rounded-sm px-2 text-left text-body text-foreground outline-none';

/** A folded part that does nothing on a click (a queued job, a background shell): reachable with the arrows, read by its words. */
export const PART_ROW_STATIC = cn(ROW, 'focus-visible:bg-accent');

/** A folded part that opens its menu, list, popover or page: a neutral wash on hover, on focus and while it's open. */
export const PART_ROW = cn(ROW, 'hover:bg-accent focus-visible:bg-accent data-[state=open]:bg-accent aria-expanded:bg-accent aria-disabled:cursor-default aria-disabled:opacity-70 aria-disabled:hover:bg-transparent');

/**
 * VIEW-5.19: a folded part's row: an icon slot, its name, its value as the line shows it (the line's
 * monospace `meta` in the quieter colour, cut when long), then what a click does: a chevron down for
 * a menu, right for a list or a popover, `ExternalLink` for a page in the browser, `ArrowRight` for
 * the Servers tab, nothing for a part that opens nothing.
 */
export function PartRowContent({ name, value, icon, trail, valueTitle }: { name: string; value: ReactNode; icon?: ReactNode; trail?: ReactNode; valueTitle?: string }) {
  return (
    <>
      <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground" data-slot="part-icon">
        {icon}
      </span>
      <span className="shrink-0" data-slot="part-name">
        {name}
      </span>
      <span className="min-w-0 flex-1 truncate text-right font-mono text-meta text-muted-foreground" data-slot="part-value" title={valueTitle}>
        {value}
      </span>
      <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground" data-slot="part-trail">
        {trail}
      </span>
    </>
  );
}
