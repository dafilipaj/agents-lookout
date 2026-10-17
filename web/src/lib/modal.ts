import { useEffect, useSyncExternalStore } from 'react';

/**
 * How many modal dialogs are open. Every `DialogContent` counts itself while mounted, so the
 * page's background shortcuts (Session list navigation, N, H) stand down while any modal owns
 * the keyboard: a keypress meant for the dialog must never change what's behind it.
 */
let open = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Counts the calling component as an open modal while it's mounted. */
export function useModalRegistration(): void {
  useEffect(() => {
    open++;
    emit();
    return () => {
      open--;
      emit();
    };
  }, []);
}

/** True while any modal dialog is open. */
export function useAnyModalOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open > 0);
}
