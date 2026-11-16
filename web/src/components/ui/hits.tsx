import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * DS-3.4: a search hit, in `highlight` with the foreground on it: a match isn't something to act
 * on, so never Needs you's amber. `tight` adds no width, for a sidebar row whose truncation must
 * not move as you type (SIDE-12.5).
 */
export function Hit({ children, tight = false }: { children: ReactNode; tight?: boolean }) {
  return (
    <mark data-slot="hit" className={cn('rounded-sm bg-highlight text-foreground', !tight && 'px-0.5')}>
      {children}
    </mark>
  );
}

/** `text` with its `ranges` (`[start, end)`, sorted, apart) marked as hits. */
export function Hits({ text, ranges, tight }: { text: string; ranges: readonly (readonly [number, number])[]; tight?: boolean }) {
  if (!ranges.length) return text;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [from, to] of ranges) {
    if (from > at) parts.push(text.slice(at, from));
    parts.push(
      <Hit key={from} tight={tight}>
        {text.slice(from, to)}
      </Hit>,
    );
    at = to;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}
