import type { SessionRow } from '@shared/types.ts';
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { moreSubagents, subagentKind, subagentLabel, subagentLines, subagentTime, subagentTitle, type SubagentLine } from '@/lib/subagents';
import { useClock } from '@/lib/time';
import { cn } from '@/lib/utils';

export interface SubagentsButtonProps {
  /** The part's words (`2 subagents`, `3 subagents done`); null once it's gone (VIEW-8.10). */
  text: string | null;
  running: boolean;
  /** The row's Subagents, with their list. */
  subagents: SessionRow['subagents'];
  open: boolean;
  onOpenChange(open: boolean): void;
  /** VIEW-8.10: where focus goes when the list closes after the part went away. */
  focusFallback(): void;
}

/**
 * VIEW-8.6–8.13: the status line's Subagents part as a button that opens the list of the Subagents it
 * counts: what each was asked, its type and model, its time, and its last tool call or how it ended.
 */
export function SubagentsButton({ text, running, subagents, open, onOpenChange, focusFallback }: SubagentsButtonProps) {
  // VIEW-8.10: the part went while its list was open: close it, focus goes to the composer.
  useEffect(() => {
    if (!text && open) onOpenChange(false);
  }, [text, open, onOpenChange]);
  if (!text && !open) return null;
  return (
    <Popover open={open && !!text} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-field="subagents"
          data-state={running ? 'running' : 'done'}
          aria-label={text ? `${text}, show them` : 'Subagents'}
          className={cn(
            'min-w-0 truncate',
            running ? 'text-busy-text' : 'text-idle-text',
            // DS-7.3: a 24 px tall target in the 28 px line, as the status line's other buttons.
            'h-6 shrink rounded-sm px-1 -mx-1 outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-accent aria-expanded:bg-accent',
          )}
        >
          {text}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="max-h-[60vh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto p-1"
        data-slot="subagents-list"
        onKeyDown={onArrows}
        onCloseAutoFocus={(e) => {
          if (!text) {
            e.preventDefault();
            focusFallback();
          }
        }}
      >
        {subagents && <SubagentsList subagents={subagents} />}
      </PopoverContent>
    </Popover>
  );
}

/** VIEW-8.11: Up and Down move between the rows, from wherever focus is in the popover. */
function onArrows(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const all = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-subagent]')];
  if (!all.length) return;
  e.preventDefault();
  const at = all.findIndex((r) => r === document.activeElement);
  const to = at < 0 ? 0 : Math.max(0, Math.min(all.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
  all[to]!.focus();
}

function SubagentsList({ subagents }: { subagents: NonNullable<SessionRow['subagents']> }) {
  const now = useClock();
  const ref = useRef<HTMLDivElement>(null);
  /** VIEW-8.10: the focused row, so focus stays on it, or moves on when it leaves the list. */
  const focused = useRef<string | null>(null);
  const shown = useRef<string[]>([]);
  const lines = subagentLines(subagents.items ?? []);
  const more = moreSubagents(subagents);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const all = [...ref.current.querySelectorAll<HTMLElement>('[data-subagent]')];
    const keys = all.map((r) => r.dataset.subagent!);
    const before = shown.current;
    shown.current = keys;
    const was = focused.current;
    if (!was || keys.includes(was)) return;
    const at = before.indexOf(was);
    const to = before.slice(at + 1).find((k) => keys.includes(k)) ?? before.slice(0, Math.max(0, at)).reverse().find((k) => keys.includes(k));
    focused.current = to ?? null;
    if (to) all[keys.indexOf(to)]!.focus();
    else ref.current.focus();
  });

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-label="Subagents"
      className="outline-none"
      onFocus={(e) => {
        const key = (e.target as HTMLElement).dataset.subagent;
        if (key) focused.current = key;
      }}
    >
      <ul className="flex flex-col">
        {lines.map((line) => (
          <SubagentRow key={line.item.id} line={line} now={now} />
        ))}
      </ul>
      {more > 0 && (
        <p className="px-2 py-1 text-meta text-muted-foreground" data-slot="subagents-more">
          and {more} more
        </p>
      )}
    </div>
  );
}

function SubagentRow({ line: { item, indent, from }, now }: { line: SubagentLine; now: number }) {
  const title = subagentTitle(item);
  const kind = subagentKind(item);
  const t = subagentTime(item, now);
  const running = item.state === 'running';
  const meta = [kind, item.model, from && `from ${from}`].filter((p): p is string => !!p);
  const when = running ? t : [t, item.state].filter(Boolean).join(' · ');
  return (
    <li
      tabIndex={-1}
      data-subagent={item.id}
      data-state={item.state}
      aria-label={subagentLabel(item, now)}
      className="flex min-w-0 flex-col gap-0.5 rounded-sm px-2 py-1 text-meta outline-none focus-visible:bg-accent"
      style={indent ? { paddingLeft: `calc(${indent} * 1rem + 0.5rem)` } : undefined}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-medium" title={title} data-slot="subagent-title">
          {title}
        </span>
        {when && (
          <span className={cn('shrink-0 tabular-nums', running ? 'text-busy-text' : 'text-muted-foreground')} data-slot="subagent-time">
            {when}
          </span>
        )}
      </div>
      {meta.length > 0 && (
        <span className="min-w-0 truncate text-muted-foreground" title={meta.join(' · ')} data-slot="subagent-meta">
          {meta.join(' · ')}
        </span>
      )}
      {running && item.activity && (
        <span className="min-w-0 truncate text-muted-foreground" title={item.activity} data-slot="subagent-activity">
          {item.activity}
        </span>
      )}
    </li>
  );
}
