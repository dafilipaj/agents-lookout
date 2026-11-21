import { useEffect, type KeyboardEvent, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ActionIcon } from '@/lib/actions';

export interface StatusMoreProps {
  /** The folded parts' names, in the line's order, for the button's name and tooltip. */
  names: readonly string[];
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Places the button on the line (its slot and separator). */
  wrap(button: ReactNode): ReactNode;
  /** Their rows, each the part's own component in its row look. */
  children: ReactNode;
  /** VIEW-5.19: where focus goes when the list closes because its last part went. */
  focusFallback(): void;
}

/**
 * VIEW-5.19: "N more" at the seam of the status line's two ends: the parts that left it, a list that
 * opens upward, as the Subagents' does, each row doing what a click on its part does.
 */
export function StatusMore({ names, open, onOpenChange, wrap, children, focusFallback }: StatusMoreProps) {
  const count = names.length;
  // Its last part went while the list was open: the list closes, focus goes to the composer.
  useEffect(() => {
    if (!count && open) onOpenChange(false);
  }, [count, open, onOpenChange]);
  if (!count && !open) return null;
  const words = `${count} more`;
  return (
    <Popover open={open && count > 0} onOpenChange={onOpenChange}>
      {wrap(
        <PopoverTrigger asChild>
          <button
            type="button"
            data-field="more"
            aria-label={`${words}: ${names.join(', ')}`}
            title={names.join(', ')}
            // DS-7.3: a 24 px tall target in the 28 px line, as the status line's other buttons.
            className="flex h-6 shrink-0 items-center gap-1 rounded-sm px-1 -mx-1 whitespace-nowrap outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-accent aria-expanded:text-foreground"
          >
            <ActionIcon id="more" className="size-3.5 shrink-0" />
            {words}
          </button>
        </PopoverTrigger>,
      )}
      <PopoverContent
        side="top"
        align="end"
        className="flex w-72 max-w-[calc(100vw-2rem)] flex-col p-1"
        data-slot="status-more"
        aria-label="More of the status line"
        onKeyDown={onArrows}
        onCloseAutoFocus={(e) => {
          if (!count) {
            e.preventDefault();
            focusFallback();
          }
        }}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** VIEW-5.19, as VIEW-8.11's list: Up and Down move between the rows, from wherever focus is in the list. */
function onArrows(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  // Only from this list's own rows: a row's open menu or list is in its own layer, and its keys bubble here too.
  const all = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-part-row]')];
  const from = document.activeElement;
  if (!all.length || (from !== e.currentTarget && !all.some((r) => r === from))) return;
  e.preventDefault();
  const at = all.findIndex((r) => r === from);
  const to = at < 0 ? 0 : Math.max(0, Math.min(all.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
  all[to]!.focus();
}
