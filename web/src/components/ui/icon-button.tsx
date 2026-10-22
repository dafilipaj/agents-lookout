import { cva } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * DS-7.1: an icon button's two sizes, so a target never shrinks under 24 px: `sm`, a 24 px box with a
 * 14 px icon, for a button inside a line or a row; `md`, a 28 px box with a 16 px icon, for a column's
 * header and toolbars. `muted-foreground` at rest. Work's row buttons, which can't be focusable inside
 * an option, take the `sm` look from here too, with `iconButtonLook` (DS-7.2).
 */
export const iconButtonVariants = cva('shrink-0 rounded-md text-muted-foreground', {
  variants: {
    size: {
      sm: "size-6 [&_svg:not([class*='size-'])]:size-3.5",
      md: "size-7 [&_svg:not([class*='size-'])]:size-4",
    },
  },
  defaultVariants: { size: 'sm' },
});

/** The whole look of a ghost icon button of a size, for a mouse-only target that can't be a `button` (Work's rows). */
export const iconButtonLook = (size: 'sm' | 'md') => cn(buttonVariants({ variant: 'ghost', size: null }), iconButtonVariants({ size }));

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'aria-label' | 'title'> {
  /** Its accessible name, required: an icon says nothing to a screen reader. */
  label: string;
  /** Its key, shown in the tooltip after the name ("Close History (H)"). */
  shortcut?: string;
  /** A tooltip that says more than the name (why it's disabled, the whole ID it copies). */
  tip?: string;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'outline';
}

/**
 * DS-7.1: a button that is only an icon. Ghost by default, `accent` under the pointer, with the
 * Button's focus ring. Its name is a required prop and its tooltip says the same, with the key when
 * there is one. Its `className` never sets a size (the guard, DS-7.2): that's `size`. The icon inside
 * takes the size's own, so it carries no size class either.
 */
export function IconButton({ label, shortcut, tip, size = 'sm', variant = 'ghost', className, type = 'button', ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      data-slot="icon-button"
      data-size={size}
      aria-label={label}
      title={tip ?? (shortcut ? `${label} (${shortcut})` : label)}
      className={cn(buttonVariants({ variant, size: null }), iconButtonVariants({ size }), className)}
      {...props}
    />
  );
}
