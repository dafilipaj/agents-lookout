import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * DS-14.1 (0014): Lookout's own mark, the Lens: a ring and a solid dot set off toward the top right,
 * in lucide's grammar (24 px box, 2 px stroke, round caps and joins). It's the brand, so it takes the
 * text colour around it (`currentColor`), never a Status or Primary token, and screen readers skip it.
 * Its size comes from `className`. The favicon (`web/public/favicon.svg`) draws the same two circles.
 */
export function LookoutMark({ className, ...rest }: Omit<ComponentPropsWithoutRef<'svg'>, 'children'>) {
  return (
    <svg
      data-slot="lookout-mark"
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
      <circle cx="14.25" cy="9.75" r="2.75" fill="currentColor" stroke="none" />
    </svg>
  );
}
