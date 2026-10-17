import { type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { type Mark, railFraction } from './marks';

/** Re-measuring the Marks runs at most this often, whatever triggers it. */
export const RAIL_THROTTLE_MS = 100;
const EMPTY: ReadonlyMap<string, number> = new Map();

/**
 * VIEW-1.11: where each Mark's entry sits in the chat's full scroll height, as a fraction. Read in
 * one batch, after the content changed (`version`) or the chat, its content or its message list resized, at
 * most once per RAIL_THROTTLE_MS, so a poll that changes nothing costs nothing and a burst of
 * changes costs one layout read.
 */
export function useMarkFractions(
  scrollRef: RefObject<HTMLElement | null>,
  listRef: RefObject<HTMLElement | null>,
  marks: readonly Mark[],
  version: unknown,
): ReadonlyMap<string, number> {
  const [fractions, setFractions] = useState<ReadonlyMap<string, number>>(EMPTY);
  const schedule = useRef<() => void>(() => {});
  const wanted = useRef<ReadonlySet<string>>(new Set());
  const observer = useRef<ResizeObserver | null>(null);
  /** The message list being observed: it comes and goes with the chat's state (empty, loaded). */
  const observedList = useRef<Element | null>(null);

  // A layout effect declared first, so the real `schedule` is in place before the one below runs.
  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = -Infinity;
    const measure = () => {
      timer = undefined;
      last = Date.now();
      const scroll = scrollRef.current;
      const list = listRef.current;
      if (!scroll || !list) return;
      // The top of the chat's scrolled content, whatever is scrolled into view.
      const base = scroll.getBoundingClientRect().top - scroll.scrollTop;
      const height = scroll.scrollHeight;
      const next = new Map<string, number>();
      for (const el of list.querySelectorAll<HTMLElement>('[data-mark]')) {
        const cursor = el.dataset.mark!;
        if (wanted.current.has(cursor)) next.set(cursor, railFraction(el.getBoundingClientRect().top - base, height));
      }
      setFractions((prev) => (sameFractions(prev, next) ? prev : next));
    };
    schedule.current = () => {
      if (timer !== undefined) return;
      timer = setTimeout(measure, Math.max(0, last + RAIL_THROTTLE_MS - Date.now()));
    };
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => schedule.current());
      observer.current = ro;
      if (scrollRef.current) ro.observe(scrollRef.current);
      // The box holding everything the chat scrolls: rows below the list (the Working row,
      // VIEW-1.10) change the full height, and so every Mark's fraction, without resizing the list.
      const content = scrollRef.current?.firstElementChild;
      if (content) ro.observe(content);
      // The list, not a box around it: in a chat shorter than its pane that box doesn't resize
      // when a row expands, though the rows below it move.
      observedList.current = listRef.current;
      if (observedList.current) ro.observe(observedList.current);
    }
    schedule.current();
    return () => {
      observer.current?.disconnect();
      observer.current = null;
      observedList.current = null;
      if (timer !== undefined) clearTimeout(timer);
      schedule.current = () => {};
    };
  }, [scrollRef, listRef]);

  useLayoutEffect(() => {
    wanted.current = new Set(marks.map((m) => m.cursor));
    const ro = observer.current;
    const list = listRef.current;
    if (ro && list !== observedList.current) {
      if (observedList.current) ro.unobserve(observedList.current);
      if (list) ro.observe(list);
      observedList.current = list;
    }
    schedule.current();
  }, [marks, version, listRef]);

  return marks.length ? fractions : EMPTY;
}

function sameFractions(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of b) if (Math.abs((a.get(k) ?? -1) - v) > 0.0005) return false;
  return true;
}
