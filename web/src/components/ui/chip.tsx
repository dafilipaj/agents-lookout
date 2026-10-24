import type { Status } from '@shared/types.ts';
import { cva } from 'class-variance-authority';
import type { ComponentPropsWithoutRef } from 'react';
import { STATUS_TAG_CLASS } from '@/lib/sessions';
import { cn } from '@/lib/utils';

export type ChipTone = 'neutral' | 'muted' | 'info' | 'ok' | 'warning' | Status;

/**
 * DS-8.3: one pill, `rounded-full px-1.5`, `caption` medium on a 16 px line, with a tone. `neutral`:
 * `bg-muted`, the foreground. `muted`: a border and muted text (a draft PR). `info`: the info tone's
 * (staleness, "old"). `ok`: something passed (an approved PR, WORK-3.2). A Status's: its tag's `-soft`
 * and `-text` (VIEW-5.9, from `STATUS_TAG_CLASS`). Every tone has the 1 px border, transparent where
 * it shows none, so chips are one height.
 */
export const chipVariants = cva('inline-flex shrink-0 items-center gap-0.5 rounded-full border border-transparent px-1.5 text-caption leading-4 font-medium whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-muted text-foreground',
      muted: 'border-border text-muted-foreground',
      info: 'bg-info-soft text-info-text',
      ok: 'border-ok/40 text-ok',
      warning: 'border-warning/40 text-warning-text',
      'needs-you': STATUS_TAG_CLASS['needs-you'],
      busy: STATUS_TAG_CLASS.busy,
      idle: STATUS_TAG_CLASS.idle,
      unknown: STATUS_TAG_CLASS.unknown,
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Chip({ tone = 'neutral', className, ...rest }: ComponentPropsWithoutRef<'span'> & { tone?: ChipTone }) {
  return <span data-slot="chip" data-tone={tone} className={cn(chipVariants({ tone }), className)} {...rest} />;
}
