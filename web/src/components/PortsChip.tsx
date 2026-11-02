import type { LocalServer } from '@shared/ports.ts';
import { Server } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { chipLabel, chipText, serverLine } from '@/lib/ports';
import { useClock } from '@/lib/time';

export interface PortsChipProps {
  /** PORTS-2.1: the Session's Local servers; none, no chip. */
  servers: readonly LocalServer[];
  /** PORTS-2.2: with more than one, a click opens the Servers tab at the Session's group. */
  onShowAll(): void;
  /** PORTS-2.3, VIEW-8.10: where focus goes when the chip goes while it has it. */
  focusFallback(): void;
  /** The status line's separator, shown before the chip. */
  dot: ReactNode;
}

/**
 * PORTS-2: the status line's Local servers: `:4301 test-pr-24926/api` for one, which a click
 * opens in a new browser tab, or `3 servers`, which opens the Servers tab. Its tooltip lists each.
 */
export function PortsChip({ servers, onShowAll, focusFallback, dot }: PortsChipProps) {
  const now = useClock();
  // A focused button that is removed may not get a blur: focus is known gone only while it's still in the page.
  const focused = useRef(false);
  const fallback = useRef(focusFallback);
  useLayoutEffect(() => {
    fallback.current = focusFallback;
    if (servers.length || !focused.current) return;
    focused.current = false;
    focusFallback();
  });
  // The status line itself may go with its last part, taking the chip with it.
  useLayoutEffect(() => () => {
    if (focused.current) fallback.current();
  }, []);
  if (!servers.length) return null;
  const one = servers.length === 1 ? servers[0]! : null;
  return (
    <>
      {dot}
      <button
        type="button"
        data-field="servers"
        aria-label={chipLabel(servers)}
        title={servers.map((s) => serverLine(s, now)).join('\n')}
        onClick={() => (one ? window.open(one.url, '_blank', 'noopener,noreferrer') : onShowAll())}
        onFocus={() => (focused.current = true)}
        onBlur={(e) => {
          if (e.currentTarget.isConnected) focused.current = false;
        }}
        // DS-7.3: a 24 px tall target in the 28 px line, as the status line's other buttons.
        className="flex h-6 min-w-0 shrink items-center gap-1 rounded-sm px-1 -mx-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Server aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{chipText(servers)}</span>
      </button>
    </>
  );
}
