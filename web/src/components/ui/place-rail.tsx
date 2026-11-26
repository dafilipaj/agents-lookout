import type { ComponentType } from 'react';
import { LookoutMark } from '@/components/ui/lookout-mark';
import { cn } from '@/lib/utils';

/**
 * DS-24.2: a count on a rail button's icon: how much waits in that place. Neutral, as a tab's count is
 * (TOPIC-9.4), or Needs you's amber for the Sessions that Need you (NAV-3.2): amber means act on it.
 */
export function RailCount({ n, tone = 'neutral' }: { n: number; tone?: 'neutral' | 'needs-you' }) {
  return (
    <span
      data-field="count"
      data-tone={tone}
      className={cn(
        'absolute -top-1.5 left-2.5 rounded-full px-1 text-caption leading-4 font-medium tabular-nums',
        tone === 'needs-you' ? 'bg-needs-you text-needs-you-foreground' : 'bg-muted text-muted-foreground',
      )}
    >
      {n}
    </span>
  );
}

export interface PlaceButtonProps {
  /** The place's name, under its icon and in its accessible name. */
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** NAV-1.2: this is the place that shows. */
  current: boolean;
  /** NAV-4.1: its key, named in the tooltip. */
  shortcut: string;
  /** NAV-3: what waits there; none at 0. */
  count?: number;
  /** The count in words, for the accessible name ("4 unread", "2 need you"). */
  countWords?: string;
  tone?: 'neutral' | 'needs-you';
  onPress(): void;
}

/**
 * DS-24.1: a place's button on the rail (NAV-1.2): its icon over its name, 48 by 44 px. The current
 * place is where you are, so it takes the selected row's neutral wash and `aria-current`, never
 * Primary (DS-12.4).
 */
export function PlaceButton({ label, icon: Icon, current, shortcut, count = 0, countWords, tone, onPress }: PlaceButtonProps) {
  return (
    <button
      type="button"
      data-slot="place-button"
      aria-current={current ? 'page' : undefined}
      aria-label={count > 0 && countWords ? `${label}, ${countWords}` : label}
      title={`${label} (${shortcut})`}
      onClick={onPress}
      className={cn(
        'flex h-11 w-12 flex-col items-center justify-center gap-1 rounded-md transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        // The same weight in both states: a place's name doesn't change width as you switch, and "Sessions" keeps its room at 48 px.
        current ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
      )}
    >
      <span className="relative flex">
        <Icon className="size-4" />
        {count > 0 && <RailCount n={count} tone={tone} />}
      </span>
      <span aria-hidden className="text-caption leading-none">
        {label}
      </span>
    </button>
  );
}

/** DS-24.3: Lookout's mark at the rail's top (NAV-1.1): the Lens at 20 px, the brand, in the text colour around it (DS-14.1). */
export function RailMark() {
  return <LookoutMark className="size-5" />;
}
