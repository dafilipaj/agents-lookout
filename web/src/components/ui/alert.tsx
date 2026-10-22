import { cva } from 'class-variance-authority';
import { CircleX, Info, type LucideIcon } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * DS-4: one look for "something went wrong" (`error`) and "something to know" (`info`), as a box
 * (a title, a detail and what to do) or inline (a `meta` line that wraps, or with `oneLine` is cut
 * short with the whole text in its tooltip: the status line's).
 * There is no amber Alert: a Needs you card is a Status, not an Alert.
 */
export const alertVariants = cva('min-w-0 text-meta', {
  variants: {
    tone: { error: '', info: 'text-info-text' },
    layout: {
      box: 'flex gap-2 rounded-md border px-2.5 py-2',
      inline: 'flex items-start gap-1',
    },
  },
  compoundVariants: [
    { tone: 'error', layout: 'box', class: 'border-destructive/30 bg-destructive-soft' },
    { tone: 'info', layout: 'box', class: 'border-info-border bg-info-soft' },
    { tone: 'error', layout: 'inline', class: 'text-destructive-text' },
  ],
  defaultVariants: { tone: 'error', layout: 'box' },
});

const ICON: Record<AlertTone, LucideIcon> = { error: CircleX, info: Info };
/** The icon's colour: `destructive` for an error, the info text's for a notice. */
const ICON_CLASS: Record<AlertTone, string> = { error: 'text-destructive', info: 'text-info-text' };

export type AlertTone = 'error' | 'info';

export interface AlertProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title' | 'role'> {
  tone?: AlertTone;
  layout?: 'box' | 'inline';
  /** Another icon for an info Alert (`WifiOff`, `TriangleAlert`); an error always has `CircleX`. */
  icon?: LucideIcon;
  /** Inline only: one line, cut short with an ellipsis (the status line's), not wrapped. */
  oneLine?: boolean;
  /**
   * The same look without the live role, for an error that is already announced where it is
   * selected (a failed Starting row, whose StartingView says it too, LAUNCH-4.5). Guarded: see the
   * DS-4.2 test.
   */
  quiet?: boolean;
  /** A box's first line, or an inline Alert's text. */
  title: ReactNode;
  /** A box's second line, under the title. */
  detail?: ReactNode;
  /** The tooltip; an inline Alert's defaults to its whole text. */
  tip?: string;
  /**
   * `presentation` where a live region can't sit, as inside a listbox (Work's "Possibly out of
   * date", WORK-7.5): its text is read through the `aria-describedby` that points at it instead.
   */
  role?: 'presentation';
}

/**
 * DS-4.1: `error` is `role="alert"` with `CircleX` in `destructive`; `info` is `role="status"` with
 * `Info` (or the icon it's given) in `info-text`. A box takes a title, a detail and children (a
 * command, a button), its icon at the first line; inline is a `meta` line with a 12 px icon, wrapping, or one cut-short line with `oneLine`.
 */
export function Alert({ tone = 'error', layout = 'box', icon, title, detail, tip, role: presentation, oneLine, quiet, className, children, ...rest }: AlertProps) {
  const Icon = tone === 'info' && icon ? icon : ICON[tone];
  const role = presentation ?? (quiet ? undefined : tone === 'error' ? 'alert' : 'status');
  if (layout === 'inline') {
    return (
      <div role={role} data-slot="alert" data-tone={tone} data-layout="inline" title={tip ?? (oneLine && typeof title === 'string' ? title : undefined)} className={cn(alertVariants({ tone, layout }), className)} {...rest}>
        <Icon aria-hidden className={cn('mt-0.5 size-3 shrink-0', ICON_CLASS[tone])} />
        <span className={cn('min-w-0', oneLine ? 'truncate' : 'break-words')}>{title}</span>
      </div>
    );
  }
  return (
    <div role={role} data-slot="alert" data-tone={tone} data-layout="box" title={tip} className={cn(alertVariants({ tone, layout }), className)} {...rest}>
      <Icon aria-hidden className={cn('mt-px size-3.5 shrink-0', ICON_CLASS[tone])} />
      {/* An error's detail and what follows it are muted, under its title in the error's colour. */}
      <div className={cn('flex min-w-0 flex-1 flex-col gap-1', tone === 'error' && 'text-muted-foreground')}>
        <p className={cn('font-medium', tone === 'error' && 'text-destructive-text')} data-slot="alert-title">
          {title}
        </p>
        {detail && <div data-slot="alert-detail">{detail}</div>}
        {children}
      </div>
    </div>
  );
}
