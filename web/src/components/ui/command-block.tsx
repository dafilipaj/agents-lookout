import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * DS-8.2: a command to copy: monospace `caption`, wrapped anywhere, and selected whole on click
 * (`select-all`), so one click and ⌘C copy it.
 */
export function CommandBlock({ children, className, ...rest }: Omit<ComponentPropsWithoutRef<'pre'>, 'children'> & { children: string }) {
  return (
    <pre
      data-slot="command-block"
      className={cn(
        'rounded-md border border-border bg-background p-2 font-mono text-caption leading-4 whitespace-pre-wrap text-foreground select-all [overflow-wrap:anywhere]',
        className,
      )}
      {...rest}
    >
      {children}
    </pre>
  );
}
