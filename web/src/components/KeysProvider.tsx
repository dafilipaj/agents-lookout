import { type ReactNode, useEffect, useState } from 'react';
import { KeysContext, type KeysPlace, SESSIONS, placeOf, samePlace } from '@/lib/keys';
import { useAnyModalOpen } from '@/lib/modal';

/**
 * Follows focus, however it moved: `focusin`, `focusout` to nothing (focus left for the page), and
 * a focused element taken out of the page, which fires no event at all (the page has it then). Its
 * own state, so a move re-renders the edges and the hint line, never the app.
 */
export function KeysProvider({ children }: { children: ReactNode }) {
  const modal = useAnyModalOpen();
  const [place, setPlace] = useState<KeysPlace>(() => placeOf(document.activeElement) ?? SESSIONS);
  useEffect(() => {
    let last: Element | null = document.activeElement;
    const update = () => {
      last = document.activeElement;
      const next = placeOf(last);
      if (next) setPlace((p) => (samePlace(p, next) ? p : next));
    };
    const left = (e: FocusEvent) => {
      if (!e.relatedTarget) queueMicrotask(update);
    };
    const removed = new MutationObserver(() => {
      if (document.activeElement !== last) update();
    });
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', left);
    removed.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', left);
      removed.disconnect();
    };
  }, []);
  return <KeysContext.Provider value={modal ? null : place}>{children}</KeysContext.Provider>;
}
