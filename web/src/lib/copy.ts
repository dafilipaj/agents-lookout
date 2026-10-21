import { useEffect, useRef, useState } from 'react';

/** VIEW-1.14, VIEW-5.10: how long "Copied" or "Couldn't copy" shows. */
export const COPY_FEEDBACK_MS = 2000;

export type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Copies text to the clipboard and reports the outcome for COPY_FEEDBACK_MS, as the code blocks'
 * copy button (VIEW-1.14) and the header's "Copy session ID" (VIEW-5.10) do. `said` is the words
 * to show and to read out politely; empty while idle.
 */
export function useCopy(text: string) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      // No clipboard, or the browser refused.
    }
    clearTimeout(timer.current);
    setState(copied ? 'copied' : 'failed');
    timer.current = setTimeout(() => setState('idle'), COPY_FEEDBACK_MS);
  };
  const said = state === 'copied' ? 'Copied' : state === 'failed' ? "Couldn't copy" : '';
  return { state, said, copy };
}
