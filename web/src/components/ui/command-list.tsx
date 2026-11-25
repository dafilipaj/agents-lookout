import { type CommandItem, OPENS_IN_TERMINAL, sourceLabel } from '@shared/commands.ts';
import { SquareTerminal } from 'lucide-react';
import { type MouseEvent, type ReactNode, useEffect, useRef } from 'react';
import { Hits } from '@/components/ui/hits';
import { optionId } from '@/lib/command-list';
import { cn } from '@/lib/utils';

export interface CommandRow {
  item: CommandItem;
  /** What matched, in the item as it's called and in its description (DS-3.4). */
  call: readonly (readonly [number, number])[];
  description: readonly (readonly [number, number])[];
}

export interface CommandListProps {
  /** The listbox's id, which the field's `aria-controls` names; a row's is `optionId(id, its call)`. */
  id: string;
  rows: readonly CommandRow[];
  /** The highlighted row. */
  active: number;
  onActive(index: number): void;
  onPick(index: number): void;
  /** Above the rows, or in their place: a wait (`Loading`) or a failed read (`Alert`), each of which says itself. */
  note?: ReactNode;
  /** In place of the rows when the word leaves none: "No command or skill matches". */
  empty?: string | null;
}

/** VIEW-15.11: a row as a screen reader hears it: the item, its description, the mark, its source. */
export const commandLabel = (item: CommandItem) => [item.call, item.description, item.dialog ? OPENS_IN_TERMINAL : null, sourceLabel(item)].filter(Boolean).join(', ');

/**
 * A move of the pointer itself. Chrome also sends a `mousemove` to whatever comes under a pointer
 * at rest when the page scrolls or changes under it, with no movement in it.
 */
const pointerMoved = (e: MouseEvent) => e.nativeEvent.movementX !== 0 || e.nativeEvent.movementY !== 0;

/**
 * VIEW-15.5: a list that completes what you type: the composer's and the launcher's `/` list. A
 * listbox whose rows are options, as the pickers' are (`ui/picker.tsx`), but the field that filters
 * it is its owner's: focus stays there, and what holds the list keeps a press in it from taking
 * focus (`CommandsPopover`). The highlighted row is on `accent`, never Primary, and is kept in view.
 * At most eight rows show (eight of 28 px, their gaps and the list's edge fit in 15rem); the rest scroll.
 *
 * The listbox holds only its options. What it says in their place sits above it: "nothing matches"
 * in a status region that is there from the start, so it's said when it comes (VIEW-15.11).
 */
export function CommandList({ id, rows, active, onActive, onPick, note, empty }: CommandListProps) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, rows]);
  return (
    <div data-slot="command-list" className="@container flex min-w-0 flex-col">
      {note && (
        <div data-part="note" className="px-3 py-2.5 text-meta text-muted-foreground">
          {note}
        </div>
      )}
      <div role="status" data-part="empty" className={cn('text-meta text-muted-foreground', empty && 'px-3 py-2.5')}>
        {empty}
      </div>
      <div ref={box} id={id} role="listbox" aria-label="Commands and skills" className={cn('flex max-h-60 min-w-0 flex-col gap-px overflow-y-auto', rows.length > 0 && (note ? 'px-1 pb-1' : 'p-1'))}>
        {rows.map(({ item, call, description }, i) => (
          <div
            key={item.call}
            id={optionId(id, item.call)}
            role="option"
            aria-selected={i === active}
            aria-label={commandLabel(item)}
            data-source={item.source}
            // The highlight follows the pointer only when the pointer moves: the list scrolling under
            // it as the arrows move the highlight must not take the highlight back (VIEW-15.7).
            onMouseMove={(e) => i !== active && pointerMoved(e) && onActive(i)}
            onClick={() => onPick(i)}
            className={cn('flex h-7 min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-body', i === active && 'bg-accent')}
          >
            {/* One column for what's typed and its hint, so the descriptions start level down the list (VIEW-15.13). */}
            <span className="flex w-[38%] max-w-88 min-w-0 shrink-0 items-baseline gap-2 @max-[32rem]:w-[52%]">
              <span data-part="call" className="max-w-full shrink-0 truncate font-mono">
                <Hits text={item.call} ranges={call} tight />
              </span>
              {item.hint && (
                <span data-part="hint" className="min-w-0 truncate font-mono text-meta text-muted-foreground">
                  {item.hint}
                </span>
              )}
            </span>
            <span data-part="description" className="min-w-0 flex-1 truncate text-meta text-muted-foreground">
              <Hits text={item.description} ranges={description} tight />
            </span>
            {item.dialog && (
              <span data-part="dialog" className="flex shrink-0 items-center gap-1 text-meta text-muted-foreground">
                <SquareTerminal aria-hidden className="size-3.5" />
                {OPENS_IN_TERMINAL}
              </span>
            )}
            {/* In a narrow list the source gives its room to the description; the row's name keeps it. */}
            <span data-part="source" className="shrink-0 text-meta text-muted-foreground @max-[32rem]:sr-only">
              {sourceLabel(item)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
