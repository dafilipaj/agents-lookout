import { type Pressure, runsAway } from '@shared/memory.ts';
import type { SessionRow } from '@shared/types.ts';
import { Bot, CircleCheck, FolderGit2, GitBranch, Hourglass, SquareTerminal, TrendingUp } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { clockTime } from '@/lib/chat';
import type { NameSuffix } from '@/lib/names';
import { BACKGROUND_SHELL_TIP, CONTEXT_LEVEL_CLASS, queuedTip, ROW_TONE, STATUS_LABEL, STATUS_STRIP_CLASS, contextLevel, location, locationTip, sessionOptionId } from '@/lib/sessions';
import { Chip } from '@/components/ui/chip';
import { SessionMarker } from '@/components/ui/session-marker';
import { formatBytes } from '@/lib/memory';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';
import { ChangesCount } from './ChangesCount';
import { changesTip, hasLines, linesLabel } from '@/lib/changes';

interface Props {
  row: SessionRow;
  selected: boolean;
  /** SIDE-3.5: Idle past the threshold. */
  dimmed: boolean;
  now: number;
  onSelect(id: string): void;
  /** SIDE-10.3: another live row has this name; what tells this one apart. Null when the name is its alone. */
  suffix?: NameSuffix | null;
  /** MEM-4.1: the Mac's memory pressure, which lowers the bar for memory running away; null before a sample. */
  pressure?: Pressure | null;
}

const NOT_CONTROLLABLE = 'Not Controllable: this Session runs in another app, so Lookout can only show it.';

/** One sidebar row (SIDE-2). */
export const SessionItem = memo(function SessionItem({ row, selected, dimmed, now, onSelect, suffix = null, pressure = null }: Props) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  const shown = row.locationShown;
  // SIDE-10.3: the second line doesn't repeat a Worktree or branch the name's suffix shows.
  const where = shown.where ? location(row) : null;
  const loc = where && !((suffix?.kind === 'worktree' || suffix?.kind === 'branch') && suffix.text === where.name) ? where : null;
  const showRepo = shown.repo && (row.git !== null || row.cwd !== null);
  const tip = locationTip(row);
  const needsYou = row.status === 'needs-you';
  const tone = needsYou ? ROW_TONE.needsYou : ROW_TONE.plain;
  // The Session's words: what a Needs you row waits for (SIDE-2.3), a Busy row's activity (SIDE-2.11),
  // or else a Done Session's note (SIDE-2.17).
  const words = needsYou && row.waitingFor
    ? { text: row.waitingFor, field: 'waiting-for', className: 'font-medium text-needs-you-text' }
    : row.status === 'busy' && row.activity
      ? { text: row.activity, field: 'activity', className: tone.quiet }
      : !needsYou && row.status !== 'busy' && row.done?.note
        ? { text: row.done.note, field: 'done-note', className: tone.quiet }
        : null;
  const doneAt = row.done ? clockTime(new Date(row.done.at).toISOString()) : null;
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
  // DS-22.3: the exceptions that lead the second line.
  const runaway = runsAway(row.memoryGrowthBytes, pressure);
  const hasMarks = runaway || !!row.queued || running > 0 || row.backgroundShell;

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
        {/* SIDE-10.3: at 280 px the name gives way first, down to 12 characters (the suffix never
            takes more than the rest), then the suffix. */}
        <span className="flex min-w-0 flex-1 items-baseline gap-1">
          <span
            className={cn('min-w-0 shrink-[1000] truncate text-body leading-5', row.controllable ? 'font-medium' : tone.quiet)}
            title={row.title}
            data-field="title"
          >
            {row.title}
          </span>
          {suffix && (
            <span className={cn('min-w-0 max-w-[calc(100%-12ch)] truncate text-body leading-5', tone.quiet)} title={suffix.tip} data-field="name-suffix" data-kind={suffix.kind}>
              <span aria-hidden>·</span> {suffix.text}
            </span>
          )}
        </span>
        {/* SIDE-2.17: it reported its work finished and wasn't prompted since. */}
        {row.done && (
          <Chip tone="ok" title={[`Done at ${doneAt}`, row.done.note].filter(Boolean).join('\n')} data-field="done">
            <CircleCheck aria-hidden className="size-3" />
            Done
          </Chip>
        )}
        {/* DS-3.1: the Harness mark in the row's quiet colour; Status carries the colour in a list. */}
        <span className={cn('flex shrink-0 items-center', tone.quiet)} data-field="harness">
          <HarnessIcon harness={row.harness} className={cn(!row.controllable && 'opacity-70')} />
        </span>
      </div>
      {/* SIDE-2.7–2.14, DS-22: the exceptions lead the line, in colour and with an icon or words, never
          cut (DS-22.3); then the slot, what varies (where the Session works, and the Session's words
          when nothing else is there), which truncates first; then the numbers in three fixed columns,
          grey (DS-22.1, 22.2). Empty at the default location, the slot is aria-hidden so its tooltip
          (the full location) isn't read. */}
      <div className={cn('flex min-h-4 items-center gap-1.5 pl-6.5 text-meta leading-4', tone.quiet)}>
        {hasMarks && (
          <span className="flex shrink-0 items-center gap-1 tabular-nums" data-field="marks">
            {/* MEM-4.1: memory running away. */}
            {runaway && (
              <span data-field="memory-growth" role="img" aria-label={`memory growing, +${formatBytes(row.memoryGrowthBytes!)} in 10 min`} title={`Memory +${formatBytes(row.memoryGrowthBytes!)} in 10 min`} className="flex items-center gap-0.5 text-warning-text">
                <TrendingUp aria-hidden className="size-2.5" />+{formatBytes(row.memoryGrowthBytes!)}
              </span>
            )}
            {/* RES-3.1: a job of this Session waits in res; its Status unchanged. */}
            {row.queued && (
              <span data-field="queued" role="img" aria-label={queuedTip(row.queued, now)} title={queuedTip(row.queued, now)} className="flex items-center gap-0.5">
                <Hourglass aria-hidden className="size-3" />
                {formatAge(Math.max(0, now - row.queued.since))}
              </span>
            )}
            {running > 0 && (
              // SIDE-9.7: Busy's blue, as the status line's count (VIEW-8.1); not a Status, so the strip stays.
              <span data-field="subagents" role="img" aria-label={subagentLabel} title={subagentLabel} className="flex items-center gap-0.5 text-busy-text">
                <Bot aria-hidden className="size-3" />
                {running}
              </span>
            )}
            {/* SIDE-2.6: Idle, with a background shell command still running; a mark, not a Status. */}
            {row.backgroundShell && (
              <span title={BACKGROUND_SHELL_TIP} className="flex items-center text-idle-text" data-field="background-shell">
                <SquareTerminal role="img" aria-label="background shell running" className="size-3" />
              </span>
            )}
          </span>
        )}
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
        {/* DS-22.1: changes, time in its Status, context; each right-aligned in its own width, so a
            value's place says what it is; empty without one, never cut (a wider one grows its own). */}
        <span className="w-16 min-w-fit shrink-0 text-right tabular-nums" data-column="changes">
          {/* DIFF-1.1: the Session's changed lines, grey on the row (DS-22.2). */}
          {hasLines(row.changes) && (
            <span data-field="changes" role="img" aria-label={linesLabel(row.changes)} title={changesTip(row.changes)} className="flex justify-end">
              <ChangesCount quiet additions={row.changes.additions} deletions={row.changes.deletions} />
            </span>
          )}
        </span>
        <span className="w-6.5 min-w-fit shrink-0 text-right tabular-nums" data-column="age">
          {age && (
            <span title={`${STATUS_LABEL[row.status]} for ${age}`} data-field="age">
              {age}
            </span>
          )}
        </span>
        <span className="flex w-11 min-w-fit shrink-0 justify-end tabular-nums" data-column="context">
          {row.contextPct !== null && (
            // DS-3.5, DS-22.2: grey up to 40%, the status line's levels past it (VIEW-5.5), from the same contextLevel.
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
