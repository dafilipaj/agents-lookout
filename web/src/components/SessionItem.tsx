import { GROWTH_BYTES } from '@shared/memory.ts';
import type { SessionRow } from '@shared/types.ts';
import { Bot, FolderGit2, GitBranch, SquareTerminal, TrendingUp } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { BACKGROUND_SHELL_TIP, CONTEXT_LEVEL_CLASS, ROW_TONE, STATUS_LABEL, STATUS_STRIP_CLASS, contextLevel, location, locationTip, sessionOptionId } from '@/lib/sessions';
import { SessionMarker } from '@/components/ui/session-marker';
import { formatBytes } from '@/lib/memory';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';

interface Props {
  row: SessionRow;
  selected: boolean;
  /** SIDE-3.5: Idle past the threshold. */
  dimmed: boolean;
  now: number;
  onSelect(id: string): void;
}

const NOT_CONTROLLABLE = 'Not Controllable: this Session runs in another app, so Lookout can only show it.';

/** One sidebar row (SIDE-2). */
export const SessionItem = memo(function SessionItem({ row, selected, dimmed, now, onSelect }: Props) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  const shown = row.locationShown;
  const loc = shown.where ? location(row) : null;
  const showRepo = shown.repo && (row.git !== null || row.cwd !== null);
  const tip = locationTip(row);
  const needsYou = row.status === 'needs-you';
  const tone = needsYou ? ROW_TONE.needsYou : ROW_TONE.plain;
  // The Session's words: what a Needs you row waits for (SIDE-2.3), or a Busy row's activity (SIDE-2.11).
  const words = needsYou && row.waitingFor
    ? { text: row.waitingFor, field: 'waiting-for', className: 'font-medium text-needs-you-text' }
    : row.status === 'busy' && row.activity
      ? { text: row.activity, field: 'activity', className: tone.quiet }
      : null;
  // SIDE-2.10: with no location to show, the words take the slot; otherwise they go on a line under it.
  const wordsInSlot = !!words && !showRepo && !loc;
  const slotEmpty = !showRepo && !loc && !wordsInSlot;
  const age = row.statusSince !== null ? formatAge(now - row.statusSince) : null;
  const running = row.subagents?.running ?? 0;
  const wordsLine = (className: string, title: string) => words && (
    <span className={cn(className, words.className)} title={title} data-field={words.field}>
      {words.text}
    </span>
  );
  const subagentLabel = `${running} Subagent${running === 1 ? '' : 's'} running`;

  return (
    <li
      ref={ref}
      id={sessionOptionId(row.id)}
      role="option"
      aria-selected={selected}
      data-session-id={row.id}
      data-status={row.status}
      data-controllable={row.controllable}
      data-dimmed={dimmed}
      title={row.controllable ? undefined : NOT_CONTROLLABLE}
      onClick={() => onSelect(row.id)}
      className={cn(
        'group relative cursor-default select-none rounded-md px-2 py-1.5 transition-[background-color,opacity] duration-150',
        // SIDE-3.7 / 3.9: a Needs you row is tinted, more under the pointer, most when selected; the
        // ring is what tells the selected row from the one under the pointer, on every Status.
        tone.rest,
        tone.hover,
        selected && cn(tone.selected, 'ring-1 ring-inset'),
        dimmed && 'opacity-45',
      )}
    >
      {/* SIDE-3.6: the Status's colour down the left edge; decoration, so screen readers skip it. */}
      <span
        aria-hidden
        data-field="strip"
        className={cn('absolute inset-y-1 left-0.5 w-[3px] rounded-full', STATUS_STRIP_CLASS[row.status], !row.controllable && 'opacity-60')}
      />
      <div className="flex items-center gap-2">
        {/* DS-5.1: the Session marker, its Status shape at the sidebar's 18 px (SIDE-3.8). */}
        <SessionMarker state="live" status={row.status} since={row.statusSince} className={cn('size-4.5', !row.controllable && 'opacity-60 grayscale')} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-body leading-5',
            row.controllable ? 'font-medium' : tone.quiet,
          )}
          title={row.title}
          data-field="title"
        >
          {row.title}
        </span>
        {/* DS-3.1: the Harness mark in the row's quiet colour; Status carries the colour in a list. */}
        <span className={cn('flex shrink-0 items-center', tone.quiet)} data-field="harness">
          <HarnessIcon harness={row.harness} className={cn(!row.controllable && 'opacity-70')} />
        </span>
      </div>
      {/* SIDE-2.7–2.14: the left slot takes what varies (where the Session works, and the Session's
          words when nothing else is there); the numbers group sits at the end. Empty at
          the default location, it is aria-hidden so its tooltip (the full location) isn't read. */}
      <div className={cn('flex min-h-4 items-center gap-1 pl-6.5 text-meta leading-4', tone.quiet)}>
        <span
          className="flex min-w-0 flex-1 items-center gap-1"
          title={tip ?? undefined}
          aria-hidden={slotEmpty || undefined}
          data-field="slot"
        >
          {showRepo && (
            <span className="max-w-[45%] shrink-0 truncate" data-field={row.git ? 'repo' : 'cwd'}>
              {row.git ? row.git.repo : basename(row.cwd!)}
            </span>
          )}
          {showRepo && loc && <span aria-hidden>·</span>}
          {loc && (
            <span className="flex min-w-0 items-center gap-0.5">
              {loc.kind === 'worktree' ? (
                <FolderGit2 aria-label="Worktree" data-icon="worktree" className="size-3 shrink-0" />
              ) : (
                <GitBranch aria-label="Branch" data-icon="branch" className="size-3 shrink-0" />
              )}
              <span className="truncate" data-field="location">
                {loc.name}
              </span>
            </span>
          )}
          {wordsInSlot && wordsLine('min-w-0 truncate', tip ? `${words.text}\n${tip}` : words.text)}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
          {(row.memoryGrowthBytes ?? 0) >= GROWTH_BYTES && (
            <span data-field="memory-growth" title={`Memory +${formatBytes(row.memoryGrowthBytes!)} in 10 min`}>
              <TrendingUp role="img" aria-label={`memory growing, +${formatBytes(row.memoryGrowthBytes!)} in 10 min`} className="size-2.5 text-warning-text" />
            </span>
          )}
          {running > 0 && (
            <span data-field="subagents" role="img" aria-label={subagentLabel} title={subagentLabel} className="flex items-center gap-0.5">
              <Bot aria-hidden className="size-2.5" />
              {running}
            </span>
          )}
          {/* SIDE-2.6: Idle, with a background shell command still running; a mark, not a Status. */}
          {row.backgroundShell && (
            <span title={BACKGROUND_SHELL_TIP} className="flex items-center text-idle-text" data-field="background-shell">
              <SquareTerminal role="img" aria-label="background shell running" className="size-3" />
            </span>
          )}
          {age && (
            <span title={`${STATUS_LABEL[row.status]} for ${age}`} data-field="age">
              {age}
            </span>
          )}
          {row.contextPct !== null && (
            // DS-3.5: the status line's levels (VIEW-5.5), from the same contextLevel; quiet up to 40%.
            <span
              title={`Context used: ${row.contextPct}%`}
              className={cn('flex items-center gap-0.5', CONTEXT_LEVEL_CLASS[contextLevel(row.contextPct)])}
              data-field="context"
            >
              <ContextRing pct={row.contextPct} />
              {row.contextPct}%
            </span>
          )}
        </span>
      </div>
      {words && !wordsInSlot && wordsLine('block truncate pl-6.5 text-meta leading-4', words.text)}
    </li>
  );
});

/** A tiny pie of the context window used. */
function ContextRing({ pct }: { pct: number }) {
  const r = 4;
  const c = 2 * Math.PI * r;
  const filled = (Math.min(100, Math.max(0, pct)) / 100) * c;
  return (
    <svg viewBox="0 0 12 12" className="size-2.5 -rotate-90" aria-hidden>
      <circle cx="6" cy="6" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <circle cx="6" cy="6" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray={`${filled} ${c}`} />
    </svg>
  );
}

function basename(p: string): string {
  return p.replace(/\/+$/, '').split('/').pop() || p;
}
