import type { LucideIcon } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  title: ReactNode;
  /** Under the title, muted: what to do, or why it's empty. */
  hint?: ReactNode;
  /** A 20 px icon above the title. */
  icon?: LucideIcon;
  /** Under the hint: a button. */
  action?: ReactNode;
}

/**
 * DS-8.1: a place with nothing to show: centred, the title in `body` medium, the hint in `meta`
 * `muted-foreground`, an optional 20 px icon above and an optional action below.
 */
export function EmptyState({ title, hint, icon: Icon, action, className, ...rest }: EmptyStateProps) {
  return (
    <div data-slot="empty-state" className={cn('flex flex-col items-center px-4 py-8 text-center', className)} {...rest}>
      {Icon && <Icon aria-hidden className="mb-2 size-5 text-muted-foreground" />}
      <p className="text-body font-medium">{title}</p>
      {hint && <div className="mt-1 max-w-md text-meta leading-5 text-muted-foreground">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
