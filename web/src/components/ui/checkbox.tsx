import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A native checkbox with the Design system's focus ring and foreground colour. */
export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return <input {...props} type="checkbox" data-slot="checkbox" className={cn('size-3.5 shrink-0 accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', className)} />;
}
