import { cva } from 'class-variance-authority';
import { type ComponentProps, type ComponentPropsWithoutRef, type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * DS-7.1: an icon button's two sizes, so a target never shrinks under 24 px: `sm`, a 24 px box with a
 * 14 px icon, for a button inside a line or a row; `md`, a 28 px box with a 16 px icon, for a column's
 * header and toolbars. `muted-foreground` at rest. A button with a word beside its icon has the third
 * size, `labelledButtonVariants`.
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

/**
 * DS-7.1: the labelled size, a word beside a 20 px icon in a 28 px tall target: the buttons of an
 * expanded Work row (WORK-6.5) and History result (HIST-3.6), and Work's Linked Session chips. The
 * 20 px goes to a lucide icon and to an icon that is the target's own child (a Harness logo); a
 * Session marker inside keeps its own size.
 */
export const labelledButtonVariants = cva("h-7 shrink-0 gap-1.5 rounded-md px-2 text-body text-foreground [&_svg:not([class*='size-'])]:size-5 [&>svg]:size-5");

/** The whole look of a labelled button: outline, so it reads as one beside the row's words. */
export const labelledButtonLook = () => cn(buttonVariants({ variant: 'outline', size: null }), labelledButtonVariants());

export interface RowActionProps extends Omit<ComponentPropsWithoutRef<'span'>, 'onClick' | 'title' | 'children'> {
  /** Its word, which is also its accessible name unless `aria-label` says more (a Linked Session chip's Status). */
  label: ReactNode;
  /** Drawn before the word, at 20 px. */
  icon: ReactNode;
  /** Drawn after the word at its own size: a Linked Session chip's Session marker (WORK-4.10). */
  trailing?: ReactNode;
  /** Its tooltip: the label, with the key when there is one ("Open in Fantastic (O)"). */
  tip: string;
  /** False while it can't act (a resume under way): it says so and does nothing. */
  enabled?: boolean;
  onPress(): void;
}

/**
 * WORK-1.12, HIST-3.5: how long a row's buttons wait after a click expanded it. Expanding one row
 * collapses another and scrolls, so the second click of a double click can land on a button that
 * wasn't under the pointer for the first; it is ignored, not run.
 */
export const ROW_SETTLE_MS = 400;

/** True while the row a click just expanded settles (ROW_SETTLE_MS): its RowActions ignore presses. */
export const RowSettling = createContext(false);

/**
 * The panel's side of ROW_SETTLE_MS: `settle(e)` on the click that expands a row, and `settling` for
 * RowSettling. A click with no count (`detail` 0: a test's or assistive technology's, not a pointer's)
 * can't be half of a double click, so it doesn't settle.
 */
export function useRowSettle() {
  const [clicks, setClicks] = useState(0);
  useEffect(() => {
    if (clicks === 0) return;
    const timer = setTimeout(() => setClicks(0), ROW_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [clicks]);
  const settle = (e: { detail: number }) => {
    if (e.detail > 0) setClicks((n) => n + 1);
  };
  return { settling: clicks > 0, settle };
}

/**
 * DS-7.1: a labelled button inside a listbox option, where nothing is focusable (WORK UX, "Markers
 * and buttons"; HIST UX): the keyboard reaches its action through the row's own keys, so this is a
 * mouse target with the labelled look and a button's role. Its press never reaches the row, whose
 * click only selects and expands it (WORK-1.12, HIST-3.5). It ignores the second click of a double
 * click (`detail` over 1) and any press while its row settles (RowSettling), saying it's disabled
 * meanwhile without looking it, so a double click on a row never resumes or opens anything.
 */
export function RowAction({ label, icon, trailing, tip, enabled = true, onPress, className, ...rest }: RowActionProps) {
  const settling = useContext(RowSettling);
  return (
    <span
      role="button"
      title={tip}
      aria-disabled={enabled && !settling ? undefined : true}
      data-slot="row-action"
      onClick={(e) => {
        e.stopPropagation();
        if (enabled && !settling && e.detail <= 1) onPress();
      }}
      className={cn(labelledButtonLook(), enabled ? 'cursor-pointer' : 'cursor-default opacity-50', className)}
      {...rest}
    >
      {icon}
      <span className="min-w-0 truncate">{label}</span>
      {trailing}
    </span>
  );
}

/**
 * DS-7.4: the group of labelled buttons under an expanded row's details: 8 px between buttons, 6 px
 * more above than the details' own 6 px gap, and 4 px below, so the buttons don't crowd the text
 * and chips around them.
 */
export function RowActions({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div data-field="actions" className={cn('mt-1.5 mb-1 flex min-w-0 flex-wrap items-center gap-2', className)} {...props} />;
}

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
