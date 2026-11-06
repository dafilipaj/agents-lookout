import type { UsageLevel } from '@shared/usage.ts';
import type { HTMLAttributes, ReactNode } from 'react';
import { UsageLevelIcon } from '@/components/UsageLevelIcon';
import { MEMORY_GLYPH, MEMORY_TEXT } from '@/lib/memory';
import { BAR_EDGE } from '@/lib/usage';
import { cn } from '@/lib/utils';

/**
 * DS-19: the pieces of a details popover, the ones Memory's breakdown was drawn with (MEM-3.2 to
 * 3.9), so every details popover reads as one family: a verdict line, up to three tiles, a "Worth a
 * look" box, uppercase section labels and thin meters. What a piece says is the popover's.
 */

/**
 * DS-19.1: the verdict line: a dot in its level's colour, the verdict in `body` medium, and how old
 * the reading is at its end in `caption` ("4s ago"; flagged, "stale · 1m" in the info tone). `id`
 * names the verdict, so a popover can be labelled by it.
 */
export function Verdict({ level, age, flagged = false, id, children }: { level: UsageLevel; age?: string | null; flagged?: boolean; id?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2" data-field="verdict">
      <span className="flex min-w-0 items-center gap-1.5 font-medium">
        <span aria-hidden className={cn('size-2 shrink-0 rounded-full', MEMORY_GLYPH[level])} />
        {id ? <span id={id}>{children}</span> : children}
      </span>
      {age && <span className={cn('shrink-0 text-caption tabular-nums', flagged ? 'text-info-text' : 'text-muted-foreground')} data-field="verdict-age">{age}</span>}
    </div>
  );
}

/** DS-19.1: up to three tiles, side by side, their tops aligned. */
export function Tiles({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-3 gap-1.5">{children}</div>;
}

/**
 * DS-19.1: one tile: a label in `caption`, a value in `body` medium `tabular-nums` (in its level's
 * text colour, with its icon, when it isn't normal), and a line in `caption` under it, which wraps
 * rather than being cut short (MEM-3.10).
 */
export function Tile({ label, value, level = 'normal', field, className, children }: { label: string; value: ReactNode; level?: UsageLevel; field?: string; className?: string; children?: ReactNode }) {
  return (
    <div className={cn('min-w-0 rounded-md bg-muted/60 px-2 py-1.5', className)} data-field={field}>
      <div className="text-caption text-muted-foreground">{label}</div>
      <div className={cn('flex items-center gap-1 font-medium whitespace-nowrap tabular-nums', level !== 'normal' && MEMORY_TEXT[level])}>
        {level !== 'normal' && <UsageLevelIcon level={level} label={level} />}
        {value}
      </div>
      <div className="text-caption break-words text-muted-foreground">{children}</div>
    </div>
  );
}

/** One line of "Worth a look": its icon, and its words, cut short with the whole in its tooltip. */
export interface WorthALine {
  key: string;
  icon: ReactNode;
  text: string;
  field?: string;
}

/**
 * DS-19.1: what needs an eye, one line each with its icon, in a neutral box (`border`, `muted/40`),
 * not an Alert: the icons carry the level (DS-4). Nothing at all when there's nothing to look at.
 */
export function WorthALook({ lines }: { lines: readonly WorthALine[] }) {
  if (!lines.length) return null;
  return (
    <section aria-label="Worth a look" className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-meta">
      <h3 className="font-medium">Worth a look</h3>
      {lines.map((l) => (
        <p key={l.key} className="flex min-w-0 items-center gap-1.5" data-field={l.field}>
          {l.icon}
          <span className="truncate" title={l.text}>{l.text}</span>
        </p>
      ))}
    </section>
  );
}

/**
 * DS-19.1, DS-19.2: a section's label: `caption`, medium, uppercase, `tracking-wide`, muted, with an
 * optional mark before it and a note at its right in normal case. The one place a label is uppercase.
 */
export function SectionLabel({ as: Tag = 'h3', icon, note, className, children }: { as?: 'h3' | 'p'; icon?: ReactNode; note?: ReactNode; className?: string; children: ReactNode }) {
  const label = <span className="uppercase">{children}</span>;
  return (
    <Tag className={cn('flex justify-between gap-2 text-caption font-medium tracking-wide text-muted-foreground', icon ? 'items-center' : 'items-baseline', className)}>
      {icon ? <span className="flex min-w-0 items-center gap-1.5">{icon}{label}</span> : label}
      {note !== undefined && note !== null && <span className="font-normal tabular-nums">{note}</span>}
    </Tag>
  );
}

/** A meter's fill: `foreground` at 55% (the main thing), 30% or 15%, so kinds differ in lightness, not hue. */
export type MeterTone = 'strong' | 'mid' | 'faint';
const TONE: Record<MeterTone, string> = { strong: 'bg-foreground/55', mid: 'bg-foreground/30', faint: 'bg-foreground/15' };

interface MeterProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** What it measures, at the start of its line; a row may put its marks after it. */
  name: ReactNode;
  /** Its value at the end of the line, and a mark after it. */
  value?: ReactNode;
  mark?: ReactNode;
  /** How full, 0 to 100. */
  percent: number;
  tone?: MeterTone;
  /** The level, drawn as a 3 px edge at the fill's end, set off by a 1 px gap in the popover's colour (DS-3.2). */
  level?: UsageLevel;
  /** A line in `caption` under the bar. */
  line?: ReactNode;
}

/**
 * DS-19.1: a name, a value and a mark on one line, and a 4 px bar under it on a `foreground/10`
 * track, its fill one of three tones; the level as an edge, as the strip draws it (DS-3.2); an
 * optional `caption` line under it.
 */
export function Meter({ name, value, mark, percent, tone = 'strong', level = 'normal', line, className, ...rest }: MeterProps) {
  const edge = BAR_EDGE[level];
  return (
    <div className={cn('min-w-0', className)} {...rest}>
      <div className="flex min-w-0 items-center gap-1.5">
        {name}
        <span className="flex-1" />
        {value}
        {mark}
      </div>
      <span aria-hidden className="mt-1 block h-1 overflow-hidden rounded-full bg-foreground/10">
        <span className={cn('block h-full rounded-full', TONE[tone], edge && 'relative overflow-hidden')} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} data-field="fill" data-level={level}>
          {edge && <span className={cn('absolute inset-y-0 right-0 w-1 border-l border-popover', edge)} data-field="edge" />}
        </span>
      </span>
      {line && <p className="mt-0.5 text-caption text-muted-foreground">{line}</p>}
    </div>
  );
}
