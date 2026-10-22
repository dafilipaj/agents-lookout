import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * DS-8.4: one key, in `caption` monospace, bordered, at least 20 px wide. A sentence is never a key:
 * "Esc to close" is a `Kbd` for "Esc" and plain words after it. Its box is 16 px tall (a 14 px line
 * and the border), so it sits in a `caption` or `meta` line without growing it.
 */
export function Kbd({ className, ...rest }: ComponentPropsWithoutRef<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn('inline-block min-w-5 rounded border border-border px-1 text-center align-baseline font-mono text-caption leading-[14px]', className)}
      {...rest}
    />
  );
}
