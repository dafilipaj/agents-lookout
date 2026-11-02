import type { MouseEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SideNavItem<T extends string> {
  id: T;
  label: string;
  /** The sub-page's path: a real link, so ⌘-click opens it in a new browser tab. */
  href: string;
  /** Drawn after the label; the page brings its own (TOOLS-2.4's). */
  dot?: ReactNode;
  /** The link's tooltip, saying what its dot means. */
  tip?: string;
}

/**
 * DS-13.1: a page's sub-pages, as links in a `nav` named after the page, on the left of its content,
 * or above it as one wrapping row in a main pane narrower than 640 px (a container query: the side
 * columns take their own width). The page marks its main pane `@container`, outside its padding, so
 * the query measures the pane rather than the content. A plain click opens the sub-page in place through `onOpen`, which
 * replaces the history entry; any other click is the browser's.
 */
export function SideNav<T extends string>({ label, items, open, onOpen, children }: { label: string; items: readonly SideNavItem<T>[]; open: T; onOpen(id: T): void; children: ReactNode }) {
  const click = (e: MouseEvent<HTMLAnchorElement>, id: T) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (id !== open) onOpen(id);
  };
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-col gap-4 @min-[640px]:flex-row @min-[640px]:items-start @min-[640px]:gap-6">
        <nav aria-label={label} data-slot="side-nav" className="flex shrink-0 flex-row flex-wrap gap-1 @min-[640px]:w-40 @min-[640px]:flex-col @min-[640px]:gap-0.5">
          {items.map((item) => {
            const current = item.id === open;
            return (
              <a
                key={item.id}
                href={item.href}
                aria-current={current ? 'page' : undefined}
                title={item.tip}
                onClick={(e) => click(e, item.id)}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-md px-2 text-body outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  current ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                {item.label}
                {item.dot}
              </a>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
