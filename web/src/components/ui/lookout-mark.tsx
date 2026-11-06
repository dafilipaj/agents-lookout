import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * DS-14.1 (0014): Lookout's own mark, the Lens: a ring and a solid dot set off toward the top right,
 * in lucide's grammar (24 px box, 2 px stroke, round caps and joins). It's the brand, so it takes the
 * text colour around it (`currentColor`), never a Status or Primary token, and screen readers skip it.
 * Its size comes from `className`. The favicon (`web/public/favicon.svg`) draws the same two circles.
 *
 * DS-14.4: `orbiting`, the Lens looking: its dot turns around the ring's centre, one turn every
 * 1.6 s at a steady speed (`animate-orbit`, `index.css`), only when motion is welcome; with reduced
 * motion it's the still Lens. It's the loader of `Loading` and of a start (LAUNCH-7), nothing else.
 */
export function LookoutMark({ orbiting = false, className, ...rest }: Omit<ComponentPropsWithoutRef<'svg'>, 'children'> & { orbiting?: boolean }) {
  const dot = <circle cx="14.25" cy="9.75" r="2.75" fill="currentColor" stroke="none" />;
  return (
    <svg
      data-slot="lookout-mark"
      data-orbiting={orbiting || undefined}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={cn('shrink-0', className)}
      {...rest}
    >
      <circle cx="12" cy="12" r="8.5" />
      {orbiting ? <g className="animate-orbit">{dot}</g> : dot}
    </svg>
  );
}
