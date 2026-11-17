import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * VIEW-5.9: a Status as a pill in its colours (`className`, from `STATUS_TAG_CLASS`), `meta` text, 20 px
 * tall. DS-18.9: with an `action` (the Session header's Stop or Esc, VIEW-4.4, VIEW-4.5), the action
 * follows the Status after a 1 px line in the tag's text colour at 30%, and the tag is 24 px tall, so the
 * buttons after it stay the same in every Status.
 */
export function StatusTag({ className, action, children, ...props }: Omit<ComponentProps<'span'>, 'children'> & { action?: ReactNode; children: ReactNode }) {
  return (
    <span
      data-slot="status-tag"
      className={cn('inline-flex shrink-0 items-center rounded-full text-meta font-medium whitespace-nowrap', action ? 'h-6' : 'h-5', className)}
      {...props}
    >
      {/* Its own box, so the age's leading space isn't trimmed as a flex item's would be. */}
      <span data-slot="status-tag-label" className={action ? 'pr-1.5 pl-2' : 'px-2'}>
        {children}
      </span>
      {action && (
        <>
          <span aria-hidden data-slot="status-tag-line" className="h-3.5 w-px shrink-0 bg-current opacity-30" />
          {action}
        </>
      )}
    </span>
  );
}

/**
 * DS-18.9: the action inside a `StatusTag`: its icon (14 px) and word in the tag's own colours, a 10%
 * tint of its text colour under the pointer, the focus ring of every button. It fills the tag's 24 px.
 */
export function StatusTagAction({ className, type = 'button', ...props }: ComponentProps<'button'>) {
  return (
    <button
      type={type}
      data-slot="status-tag-action"
      className={cn(
        "inline-flex h-full shrink-0 items-center gap-1 rounded-r-full pr-2.5 pl-1.5 outline-none transition-colors hover:bg-current/10 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}
