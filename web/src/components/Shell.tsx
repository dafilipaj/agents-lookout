import type { ComponentPropsWithoutRef, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * SIDE-8.1: the app shell is one CSS grid, rows header / content / dock, shared by every column.
 * Each column is a subgrid spanning all three rows, so the header's bottom line and the dock's
 * top line are the grid's own row edges: they line up across the columns by construction, and a
 * taller cell on either side (a growing composer, more usage rows) grows the whole row. Columns: the Session sidebar, the main pane, and the right sidebar (History).
 *
 * The dock row grows only up to 40% of the window (`fit-content(40dvh)`) and its cells scroll past
 * that, so text that wraps in a narrow main pane can't squeeze the content row (the Session list).
 */
export const SHELL_GRID = 'grid h-dvh overflow-hidden grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[minmax(3rem,auto)_minmax(0,1fr)_fit-content(40dvh)]';

/** A column of the shell: a subgrid over all three rows. */
export const SHELL_COLUMN = 'row-span-full grid grid-rows-subgrid min-h-0 min-w-0';

type Row = 'header' | 'body' | 'dock';

const ROW_CLASS: Record<Row, string> = {
  header: 'row-start-1 flex min-w-0 items-center border-b',
  body: 'row-start-2 min-h-0 min-w-0',
  dock: 'row-start-3 flex min-h-0 min-w-0 flex-col overflow-y-auto border-t',
};

interface CellProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'header' | 'section';
  row: Row;
  /** Body only: runs on through the dock row, for a view or column without a dock of its own. */
  toBottom?: boolean;
}

/** One cell of a shell column, placed in its row. */
export function ShellCell({ as: Tag = 'div', row, toBottom, className, ...rest }: CellProps) {
  return (
    <Tag
      data-shell-row={row}
      data-shell-to-bottom={toBottom ? '' : undefined}
      className={cn(ROW_CLASS[row], toBottom && 'row-end-4', className)}
      {...rest}
    />
  );
}

/** The main pane's header cell, the same for every view (a Session, a past Session, Settings, nothing selected). */
export function PaneHeader({ className, ...rest }: Omit<CellProps, 'row' | 'as' | 'toBottom'>) {
  return <ShellCell as="header" row="header" className={cn('gap-2.5 px-5 py-2', className)} {...rest} />;
}

/** A main-pane view's root: a subgrid in the main column, so its cells land in the shell's rows. */
export function ShellView({ className, ...rest }: ComponentPropsWithoutRef<'div'>) {
  return <div data-shell-view="" className={cn(SHELL_COLUMN, className)} {...rest} />;
}

/**
 * A main-pane view with no dock (nothing selected, loading, Settings): its header cell carries the
 * top line on, empty unless `header` is given, and its content scrolls down to the bottom.
 */
export function PlainView({ header, children, ...rest }: { header?: ReactNode; children: ReactNode } & ComponentPropsWithoutRef<'div'>) {
  return (
    <ShellView {...rest}>
      <PaneHeader aria-hidden={header ? undefined : true}>{header}</PaneHeader>
      <ShellCell row="body" toBottom className="overflow-y-auto">
        {children}
      </ShellCell>
    </ShellView>
  );
}
