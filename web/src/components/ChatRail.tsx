import { ChevronUp } from 'lucide-react';
import { type KeyboardEvent, type RefObject, memo, useRef, useState } from 'react';
import { clockTime } from '@/lib/chat';
import { type Mark, type MarkKind, MARK_KIND_LABEL, markName } from '@/lib/marks';
import { useMarkFractions } from '@/lib/rail';
import { cn } from '@/lib/utils';

export interface ChatRailProps {
  /** The chat's scroll area, and the message list in it: where the Marks are measured. */
  scrollRef: RefObject<HTMLElement | null>;
  listRef: RefObject<HTMLElement | null>;
  marks: readonly Mark[];
  /** Changes when what the chat renders changes: the Marks are re-measured. */
  version: unknown;
  /** The last jump, by click or `[`/`]` (a new object each time): the rail's tab stop follows it. */
  jumped: { cursor: string } | null;
  /** "Show earlier" is available: a Mark at the top loads the earlier page. */
  canLoadEarlier: boolean;
  loadingEarlier: boolean;
  onEarlier(): void;
  /** Jumps to a Mark's entry; `focus` moves focus to the entry (a jump from the rail). */
  onJump(cursor: string, focus: boolean): void;
}

/**
 * VIEW-1.11: the rail beside the chat's scroll bar. One button per Mark in a vertical toolbar; the
 * Marks are one tab stop, and the arrow keys move between them. Hidden when there are no Marks,
 * and when the chat is too narrow for it (a container query on the chat). Memoized with stable
 * props: Chat's re-renders don't reach it, and its measurements don't re-render Chat.
 */
export const ChatRail = memo(function ChatRail({
  scrollRef,
  listRef,
  marks,
  version,
  jumped,
  canLoadEarlier,
  loadingEarlier,
  onEarlier,
  onJump,
}: ChatRailProps) {
  const fractions = useMarkFractions(scrollRef, listRef, marks, version);
  // Hover and focus are kept apart: a click moves focus to the entry, and the tooltip stays while
  // the pointer is still on the Mark.
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  // A jump moves the tab stop to its Mark, whether it came from the rail or from `[`/`]`.
  const [lastJumped, setLastJumped] = useState(jumped);
  if (jumped !== lastJumped) {
    setLastJumped(jumped);
    if (jumped) setCurrent(jumped.cursor);
  }
  const toolbar = useRef<HTMLDivElement>(null);
  const placed = marks.filter((m) => fractions.has(m.cursor));
  const tabStop = placed.some((m) => m.cursor === current) ? current : (placed[0]?.cursor ?? null);

  if (marks.length === 0) return null;

  const focusAt = (i: number) => {
    const at = Math.max(0, Math.min(placed.length - 1, i));
    const m = placed[at];
    if (!m) return;
    setCurrent(m.cursor);
    toolbar.current?.querySelectorAll<HTMLButtonElement>('button[data-mark-kind]')[at]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === 'ArrowDown') focusAt(i + 1);
    else if (e.key === 'ArrowUp') focusAt(i - 1);
    else if (e.key === 'Home') focusAt(0);
    else if (e.key === 'End') focusAt(placed.length - 1);
    else return;
    e.preventDefault();
  };
  const shown = hovered ?? focused;
  const tip = placed.find((m) => m.cursor === shown) ?? null;

  return (
    <nav aria-label="Bookmarks" className="relative hidden w-4 shrink-0 @md:block" data-testid="chat-rail">
      {canLoadEarlier && (
        <button
          type="button"
          aria-label="Load earlier messages"
          title="Load earlier messages"
          disabled={loadingEarlier}
          onClick={onEarlier}
          className="absolute inset-x-0 top-1 flex h-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
        >
          <ChevronUp className="size-3" aria-hidden />
        </button>
      )}
      <div
        ref={toolbar}
        role="toolbar"
        aria-label="Marks"
        aria-orientation="vertical"
        className={cn('absolute inset-x-0 bottom-2', canLoadEarlier ? 'top-6' : 'top-2')}
      >
        {placed.map((m, i) => (
          <div key={m.cursor} className="absolute inset-x-0 -translate-y-1/2" style={{ top: `${fractions.get(m.cursor)! * 100}%` }}>
            <button
              type="button"
              data-mark-kind={m.kind}
              aria-label={markName(m)}
              tabIndex={m.cursor === tabStop ? 0 : -1}
              onClick={() => {
                setCurrent(m.cursor);
                onJump(m.cursor, true);
              }}
              onKeyDown={(e) => onKeyDown(e, i)}
              onMouseEnter={() => setHovered(m.cursor)}
              onMouseLeave={() => setHovered((s) => (s === m.cursor ? null : s))}
              onFocus={() => {
                setCurrent(m.cursor);
                setFocused(m.cursor);
              }}
              onBlur={() => setFocused((s) => (s === m.cursor ? null : s))}
              className="group flex h-3 w-full items-center justify-center rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <MarkShape kind={m.kind} />
            </button>
          </div>
        ))}
      </div>
      {tip && (
        // It shows what the Mark's name already says: hidden from assistive tech, so it isn't read twice.
        <div
          role="tooltip"
          aria-hidden
          className="pointer-events-none absolute right-full z-20 mr-1.5 max-w-72 -translate-y-1/2 rounded-md border border-border bg-popover px-2 py-1 text-[11.5px] text-popover-foreground shadow-md"
          style={{ top: `calc(${canLoadEarlier ? '1.5rem' : '0.5rem'} + (100% - ${canLoadEarlier ? '2rem' : '1rem'}) * ${fractions.get(tip.cursor)!})` }}
        >
          <span className="block truncate">{tip.text || MARK_KIND_LABEL[tip.kind]}</span>
          <span className="block text-[10.5px] text-muted-foreground">
            {MARK_KIND_LABEL[tip.kind]}
            {clockTime(tip.ts) && ` · ${clockTime(tip.ts)}`}
          </span>
        </div>
      )}
    </nav>
  );
});

/** A dot for your prompts, a diamond for subagent results, a triangle for questions. */
export function MarkShape({ kind, className }: { kind: MarkKind; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'block group-hover:scale-125 group-focus-visible:scale-125 motion-safe:transition-transform',
        kind === 'prompt' && 'size-2 rounded-full bg-muted-foreground',
        kind === 'subagent' && 'size-[7px] rotate-45 rounded-[1px] bg-busy',
        kind === 'question' && 'h-2 w-[9px] bg-needs-you [clip-path:polygon(50%_0,100%_100%,0_100%)]',
        className,
      )}
    />
  );
}
