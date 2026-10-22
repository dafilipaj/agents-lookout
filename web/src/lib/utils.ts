import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** The type scale's steps (DS-1), named by role: `text-caption` … `text-title`, from `--text-*` in index.css. */
export const TYPE_SCALE = ['caption', 'meta', 'body', 'prose', 'title'] as const;

/**
 * tailwind-merge has to know the steps are font sizes: otherwise it takes `text-meta` for a colour
 * and drops it next to `text-muted-foreground`, or keeps it next to a `text-body` that should win.
 */
const twMerge = extendTailwindMerge({ extend: { theme: { text: [...TYPE_SCALE] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
