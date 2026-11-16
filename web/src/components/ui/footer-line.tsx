import { cn } from '@/lib/utils';

/**
 * DS-23.1: a line at the bottom of a column, about the Mac: 28 px, a top border, the muted wash.
 * Lines at the bottom of two columns sit level, so their borders make one line across the window:
 * the Session sidebar's Memory line and keep-awake's line, open or on the closed rail (AWAKE-4).
 */
export const FOOTER_LINE = 'flex h-7 w-full shrink-0 items-center border-t border-sidebar-border/70 bg-muted/30';

/** DS-23.1: the line as the trigger of what it opens: its caption text, its hover and focus. */
export const FOOTER_LINE_TRIGGER = cn(FOOTER_LINE, 'gap-1.5 px-2.5 text-left text-caption leading-4 whitespace-nowrap outline-none hover:bg-sidebar-accent/50 focus-visible:bg-sidebar-accent/60');
