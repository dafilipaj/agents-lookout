import type { Pressure } from '@shared/memory.ts';
import type { SessionRow } from '@shared/types.ts';
import { Bot, CircleCheck, FolderGit2, GitBranch, Hourglass, SquareTerminal } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { ActionIcon } from '@/lib/actions';
import { clockTime } from '@/lib/chat';
import { type HiddenHit, hiddenHit, rangesOf, type RowMatch } from '@/lib/filter';
import type { NameSuffix } from '@/lib/names';
import { BACKGROUND_SHELL_TIP, CONTEXT_LEVEL_CLASS, queuedTip, ROW_TONE, STATUS_LABEL, STATUS_STRIP_CLASS, contextLevel, location, locationTip, sessionOptionId } from '@/lib/sessions';
import { Chip } from '@/components/ui/chip';
import { Hits } from '@/components/ui/hits';
import { SessionMarker } from '@/components/ui/session-marker';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { warningsOf } from '@/lib/warnings';
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
  /** MEM-4.1: the Mac's memory pressure, which lowers the bar for memory running away (a Warning, SIDE-15); null before a sample. */
  pressure?: Pressure | null;
  /** SIDE-12: where the filter's query matched this row; null without a query. */
  match?: RowMatch | null;
  /** SIDE-13.5: Unread: it went Idle after you last saw it. */
  unread?: boolean;
  /** HAND-6.3: a Handover this Session wrote waits for you. */
  handoverReady?: boolean;
}

const NOT_CONTROLLABLE = 'Not Controllable: this Session runs in another app, so Lookout can only show it.';
/** DS-22.1: what the second line's slot holds goes whole once the slot is under 46 px: 40 px of room and its own 6 px before the numbers. */
const SLOT_GONE = '@max-[46px]:hidden';

/** One sidebar row (SIDE-2). */
export const SessionItem = memo(function SessionItem({ row, selected, dimmed, now, onSelect, suffix = null, pressure = null, match = null, unread = false, handoverReady = false }: Props) {
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
  // SIDE-12.5: the filter's hits, marked where the row shows them; SIDE-12.6: a word that matched
  // only what the row doesn't show names that field on a line of its own.
  const shownIds = new Set<string>(['title']);
  // A Worktree or branch the row shows, by its text: a plain checkout's Worktree suffix is its branch
  // (SIDE-10.3), and a Worktree may be named as its branch is.
  const gitFields = (text: string) => (['worktree', 'branch'] as const).filter((k) => row.git?.[k] === text);
  const suffixFields = suffix?.kind === 'pr' ? ['pr-number'] : suffix?.kind === 'worktree' || suffix?.kind === 'branch' ? gitFields(suffix.text) : [];
  const suffixField = suffixFields[0] ?? null;
  for (const id of suffixFields) shownIds.add(id);
  if (showRepo && row.git) shownIds.add('repo');
  if (loc) for (const id of gitFields(loc.name)) shownIds.add(id);
  if (words) shownIds.add(words.field);
  const hidden = hiddenHit(match, (f) => shownIds.has(f.id));
  const marked = (id: string | null, text: string) => (match && id ? <Hits tight text={text} ranges={rangesOf(match, id)} /> : text);
  const wordsLine = (className: string, title: string) => words && (
    <span className={cn(className, words.className)} title={title} data-field={words.field}>
      {marked(words.field, words.text)}
    </span>
  );
  const subagentLabel = `${running} Subagent${running === 1 ? '' : 's'} running`;
  // DS-22.3: what is running leads the second line; what is wrong is the first line's one chip (SIDE-15).
  const hasMarks = !!row.queued || running > 0 || row.backgroundShell;
  // RES-3.1: with all three the queued mark is its Hourglass alone, so the line holds its numbers (DS-22.1).
  const crowded = !!row.queued && running > 0 && row.backgroundShell;
  const warnings = warningsOf(row, pressure);
  const urgent = warnings[0];
  const doneTip = row.done ? [`Done at ${doneAt}`, row.done.note].filter(Boolean).join('\n') : undefined;

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
      data-unread={unread || undefined}
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
            className={cn('min-w-0 shrink-[1000] truncate text-body leading-5', row.controllable ? 'font-medium' : tone.quiet, unread && 'font-semibold')}
            title={row.title}
            data-field="title"
          >
            {marked('title', row.title)}
          </span>
          {suffix && (
            <span className={cn('min-w-0 max-w-[calc(100%-12ch)] truncate text-body leading-5', tone.quiet)} title={suffix.tip} data-field="name-suffix" data-kind={suffix.kind}>
              <span aria-hidden>·</span> {marked(suffixField, suffix.text)}
            </span>
          )}
        </span>
        {/* SIDE-15: everything that is wrong with the Session, in one chip: the most urgent Warning's
            icon and word, "+N" for the others; every one in words in its tooltip and, as the chip's
            name, in the row's (SIDE-15.3). */}
        {urgent && (
          <Chip tone="warning" role="img" aria-label={warnings.map((w) => w.text).join(', ')} title={warnings.map((w) => w.text).join('\n')} data-field="warnings" data-kind={urgent.kind}>
            <urgent.icon aria-hidden className="size-3" />
            {urgent.word}
            {warnings.length > 1 && <span data-field="warnings-more">+{warnings.length - 1}</span>}
          </Chip>
        )}
        {/* SIDE-2.17: it reported its work finished and wasn't prompted since. */}
        {row.done && !urgent && (
          <Chip tone="ok" title={doneTip} data-field="done">
            <CircleCheck aria-hidden className="size-3" />
            Done
          </Chip>
        )}
        {/* SIDE-15.4: the line's end icons, 6 px apart. */}
        <span className="flex shrink-0 items-center gap-1.5" data-field="end-icons">
          {/* SIDE-2.17: beside a warning chip Done is its tick alone, so the title keeps its room. */}
          {row.done && urgent && (
            <span className="flex shrink-0 items-center" title={doneTip} data-field="done">
              <CircleCheck aria-hidden className="size-3 text-ok" />
              <span className="sr-only">Done</span>
            </span>
          )}
          {/* SIDE-13.5: Unread, a dot in the title's colour (a "new" mark is never Primary, DS-12.4),
              before the Harness mark, its word for screen readers only. */}
          {unread && row.statusSince !== null && (
            <span className="flex shrink-0 items-center" title={`Finished at ${clockTime(new Date(row.statusSince).toISOString())}, after you last looked`} data-field="unread">
              <span aria-hidden data-slot="unread-dot" className="size-1.5 rounded-full bg-sidebar-foreground" />
              <span className="sr-only">unread</span>
            </span>
          )}
          {/* HAND-6.3: a ready Handover, the Hand off icon in `ok`, its words for screen readers. */}
          {handoverReady && (
            <span className="flex shrink-0 items-center" title="Handover ready" data-field="handover-ready">
              <ActionIcon id="hand-off" className="size-3 text-ok" />
              <span className="sr-only">Handover ready</span>
            </span>
          )}
          {/* DS-3.1: the Harness mark in the row's quiet colour; Status carries the colour in a list. */}
          <span className={cn('flex shrink-0 items-center', tone.quiet)} data-field="harness">
            <HarnessIcon harness={row.harness} className={cn(!row.controllable && 'opacity-70')} />
          </span>
        </span>
      </div>
      {/* SIDE-2.7–2.14, DS-22: what is running leads the line, with an icon and its count, 8 px apart,
          never cut (DS-22.3, SIDE-15.4); then the slot, what varies (where the Session works, and the
          Session's words when nothing else is there), which truncates first; then the numbers in three
          fixed columns, grey (DS-22.1, 22.2). Empty at the default location, the slot is aria-hidden
          so its tooltip (the full location) isn't read. */}
      <div className={cn('flex min-h-4 items-center gap-1.5 pl-6.5 text-meta leading-4', tone.quiet)}>
        {hasMarks && (
          <span className="flex shrink-0 items-center gap-2 tabular-nums" data-field="marks">
            {/* RES-3.1: a job of this Session waits in res; its Status unchanged. */}
            {row.queued && (
              <span data-field="queued" role="img" aria-label={queuedTip(row.queued, now)} title={queuedTip(row.queued, now)} className="flex items-center gap-0.5">
                <Hourglass aria-hidden className="size-3" />
                {!crowded && formatAge(Math.max(0, now - row.queued.since))}
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
        {/* DS-22.1: the slot clips what it holds and carries the 6 px before the first column itself
            (its last 2 px, after its 4 px gap, over the line's own gap), so that gap goes when the slot does.
            With under 40 px of room (46 px with that gap) what it holds goes whole (`SLOT_GONE`), not as
            half an icon against the numbers. */}
        <span
          className="@container -mr-1.5 flex min-w-0 flex-1 items-center gap-1 overflow-hidden after:w-0.5 after:shrink-0 after:content-['']"
          title={tip ?? undefined}
          aria-hidden={slotEmpty || undefined}
          data-field="slot"
        >
          {showRepo && (
            <span className={cn('max-w-[45%] shrink-0 truncate', SLOT_GONE)} data-field={row.git ? 'repo' : 'cwd'}>
              {row.git ? marked('repo', row.git.repo) : basename(row.cwd!)}
            </span>
          )}
          {showRepo && loc && <span aria-hidden className={SLOT_GONE}>·</span>}
          {loc && (
            <span className={cn('flex min-w-0 items-center gap-0.5', SLOT_GONE)}>
              {loc.kind === 'worktree' ? (
                <FolderGit2 aria-label="Worktree" data-icon="worktree" className="size-3 shrink-0" />
              ) : (
                <GitBranch aria-label="Branch" data-icon="branch" className="size-3 shrink-0" />
              )}
              <span className="truncate" data-field="location">
                {marked(loc.kind, loc.name)}
              </span>
            </span>
          )}
          {wordsInSlot && wordsLine(cn('min-w-0 truncate', SLOT_GONE), tip ? `${words.text}\n${tip}` : words.text)}
        </span>
        {/* DS-22.1: changes, time in its Status, context; each right-aligned in its own width, so a
            value's place says what it is; empty without one, never cut (a wider one grows its own).
            When what leads the line leaves them less, each gives back the room its value doesn't
            fill (`shrink` down to `min-w-fit`), after the slot is gone, so the numbers stay on the row. */}
        <span className="w-16 min-w-fit shrink text-right tabular-nums" data-column="changes">
          {/* DIFF-1.1: the Session's changed lines, grey on the row (DS-22.2). */}
          {hasLines(row.changes) && (
            <span data-field="changes" role="img" aria-label={linesLabel(row.changes)} title={changesTip(row.changes)} className="flex justify-end">
              <ChangesCount quiet additions={row.changes.additions} deletions={row.changes.deletions} />
            </span>
          )}
        </span>
        <span className="w-6.5 min-w-fit shrink text-right tabular-nums" data-column="age">
          {age && (
            <span title={`${STATUS_LABEL[row.status]} for ${age}`} data-field="age">
              {age}
            </span>
          )}
        </span>
        <span className="flex w-11 min-w-fit shrink justify-end tabular-nums" data-column="context">
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
      {hidden && <MatchLine hit={hidden} className={tone.quiet} />}
    </li>
  );
});

/** Characters kept before a hidden match, so the line starts near it and the match stays in view. */
const MATCH_LEAD = 16;

/**
 * SIDE-12.6: the field a word matched that the row doesn't show: its label, then its text from a
 * little before that word's match (not a shown word's, earlier in the text), the hits marked, cut to one line.
 */
function MatchLine({ hit, className }: { hit: HiddenHit; className: string }) {
  let cut = hit.at > MATCH_LEAD ? hit.at - MATCH_LEAD : 0;
  // Never split a surrogate pair.
  if (cut > 0 && /[\uDC00-\uDFFF]/.test(hit.field.text[cut] ?? '')) cut--;
  const text = hit.field.text.slice(cut);
  const ranges = hit.ranges.filter(([, to]) => to > cut).map(([from, to]) => [Math.max(0, from - cut), to - cut] as const);
  return (
    <span className={cn('block truncate pl-6.5 text-meta leading-4', className)} title={`${hit.field.label} ${hit.field.text}`} data-field="match" data-key={hit.field.key}>
      {hit.field.label} {cut > 0 && '…'}
      <Hits tight text={text} ranges={ranges} />
    </span>
  );
}

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
