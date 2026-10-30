import { CircleDashed } from 'lucide-react';
import { cn } from '@/lib/utils';

/** DS-2.4: Productive's palette, by `color_id`; written out whole so Tailwind sees every class. */
const FILL = [
  'bg-palette-0', 'bg-palette-1', 'bg-palette-2', 'bg-palette-3', 'bg-palette-4', 'bg-palette-5', 'bg-palette-6', 'bg-palette-7', 'bg-palette-8',
  'bg-palette-9', 'bg-palette-10', 'bg-palette-11', 'bg-palette-12', 'bg-palette-13', 'bg-palette-14', 'bg-palette-15', 'bg-palette-16',
] as const;

/**
 * WORK-2.12 (0012): a Task's status as Fantastic draws it, a filled circle in the colour its workflow
 * status has in Productive, a diamond for a milestone, or a dashed circle when the status or its
 * colour is unknown. The thin border keeps White and Canary visible on a light row. A sign, not a
 * button, and hidden from screen readers: the row says the status in words.
 */
export function TaskStatusDot({ color, milestone, className }: { color: number | null; milestone: boolean; className?: string }) {
  const fill = color === null ? undefined : FILL[color];
  return (
    <span aria-hidden data-slot="task-status-dot" data-color={color ?? 'none'} data-shape={milestone ? 'diamond' : 'circle'} className={cn('inline-flex size-3.5 shrink-0 items-center justify-center', className)}>
      {fill ? (
        <span className={cn('border border-foreground/20', fill, milestone ? 'size-2 rotate-45 rounded-xs' : 'size-2.5 rounded-full')} />
      ) : (
        <CircleDashed className="size-3 text-muted-foreground" />
      )}
    </span>
  );
}
