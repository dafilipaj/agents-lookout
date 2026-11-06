import { type KeyboardEvent, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentedChoice<T extends string> {
  id: T;
  /** Its word, which is also its name. */
  label: string;
  /** Its tooltip: the longer wording, or, when it's disabled, why. */
  tooltip?: string;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  /** What it chooses ("View", "Show"): the group's name. */
  label: string;
  /** Two to four choices, side by side. */
  choices: readonly SegmentedChoice<T>[];
  value: T;
  onChange(id: T): void;
  /** In a sidebar, the chosen choice is raised on `sidebar-accent`, as a sidebar's selected row is. */
  surface?: 'page' | 'sidebar';
  /** The choices share the track's width (Work's Show filter); else each is as wide as its word. */
  fill?: boolean;
  className?: string;
}

/**
 * DS-20: one of a few ways to show the same thing. A `radiogroup` of text choices in one track; the
 * chosen one is raised on `accent`, never in Primary. Only it is in the Tab order, and ←/→ (wrapping,
 * skipping a disabled one), Home and End choose another, focus following, as on a tab strip (DS-13.2).
 * A disabled choice keeps its tooltip, so it's `aria-disabled` rather than `disabled`. What a choice
 * does is the page's.
 */
export function Segmented<T extends string>({ label, choices, value, onChange, surface = 'page', fill = false, className }: SegmentedProps<T>) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const open = choices.filter((c) => !c.disabled);
    if (!open.length) return;
    const at = open.findIndex((c) => c.id === value);
    const n = open.length;
    const to =
      e.key === 'ArrowRight' ? (at + 1) % n : e.key === 'ArrowLeft' ? (at < 0 ? n - 1 : (at - 1 + n) % n) : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (to === null) return;
    e.preventDefault();
    // The view's own keys (a list's arrows, the Spec view's) never see it.
    e.stopPropagation();
    const next = open[to]!.id;
    buttons.current.get(next)?.focus();
    if (next !== value) onChange(next);
  };

  // The chosen one is the group's one Tab stop; were it disabled, the first open one would be.
  const stop = choices.find((c) => c.id === value && !c.disabled) ?? choices.find((c) => !c.disabled);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-slot="segmented"
      className={cn('flex min-w-0 rounded-md border border-input bg-background/60 p-0.5 dark:bg-input/20', !fill && 'w-fit shrink-0', className)}
      onKeyDown={onKeyDown}
    >
      {choices.map((c) => {
        const chosen = c.id === value;
        return (
          <button
            key={c.id}
            ref={(el) => {
              if (el) buttons.current.set(c.id, el);
              else buttons.current.delete(c.id);
            }}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-disabled={c.disabled || undefined}
            title={c.tooltip}
            tabIndex={c === stop ? 0 : -1}
            onClick={() => !c.disabled && !chosen && onChange(c.id)}
            className={cn(
              'rounded px-1.5 py-0.5 text-meta whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              fill && 'min-w-0 flex-auto truncate',
              chosen ? cn('font-medium text-foreground shadow-xs', surface === 'sidebar' ? 'bg-sidebar-accent' : 'bg-accent') : 'text-muted-foreground',
              !chosen && !c.disabled && 'hover:text-foreground',
              c.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
