import { MB, formatBytes, loadLevel, splitWidths, trendShape, watchedLevel, type MemoryRow, type MemorySnapshot } from '@shared/memory.ts';
import type { SessionRow } from '@shared/types.ts';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { useId, useState } from 'react';
import { Chip } from '@/components/ui/chip';
import { Loading } from '@/components/ui/loading';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MEMORY_GLYPH, MEMORY_TEXT, memoryDescription } from '@/lib/memory';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';
import { UsageLevelIcon } from './UsageLevelIcon';

interface Props {
  memory: MemorySnapshot | null;
  sessions: readonly SessionRow[];
  now: number;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSelect(id: string): void;
}

/** MEM-1, MEM-3: a dock line and its clickable breakdown, beside the usage details. */
export function MemoryLine({ memory, sessions, now, open, onOpenChange, onSelect }: Props) {
  const summaryId = useId();
  const titleId = useId();
  const description = memory ? memoryDescription(memory, now, sessions) : 'Reading memory…';
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label="Memory details"
        aria-describedby={summaryId}
        title={description}
        className="flex h-5 w-full shrink-0 items-start gap-1.5 px-2.5 pb-1 text-left text-caption leading-4 whitespace-nowrap outline-none hover:bg-sidebar-accent/50 focus-visible:bg-sidebar-accent/60"
      >
        <span id={summaryId} className="sr-only">{description}</span>
        <span aria-hidden data-field="memory-glyph" className={cn('mt-0.5 h-3 w-[3px] shrink-0 rounded-full transition-colors duration-700 motion-reduce:transition-none', MEMORY_GLYPH[memory ? watchedLevel(memory) : 'normal'])} />
        {memory ? (
          <span>
            <span className="font-medium tabular-nums">{formatBytes(memory.watchedBytes)}</span>
            <span className="text-muted-foreground"> · {memory.pressure === 'normal' ? `load ${memory.load.one.toFixed(1)}` : `pressure ${memory.pressure}`}</span>
          </span>
        ) : <Loading label="Reading memory…" className="text-caption leading-4" />}
      </PopoverTrigger>
      <PopoverContent side="right" align="end" sideOffset={8} className="max-h-[min(36rem,90vh)] w-[22rem] overflow-x-hidden overflow-y-auto p-0" aria-labelledby={titleId}>
        <h2 id={titleId} className="sr-only">Memory details</h2>
        {memory ? <Details memory={memory} sessions={sessions} now={now} onSelect={(id) => { onSelect(id); onOpenChange(false); }} /> : <Loading label="Reading memory…" className="p-3" />}
      </PopoverContent>
    </Popover>
  );
}

function Details({ memory, sessions, now, onSelect }: { memory: MemorySnapshot; sessions: readonly SessionRow[]; now: number; onSelect(id: string): void }) {
  const [frozen, setFrozen] = useState<string[] | null>(null);
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const sorted = memory.sessions.filter((s) => byId.has(s.id)).toSorted((a, b) => b.bytes - a.bytes || a.id.localeCompare(b.id));
  const live = new Set(sorted.map((r) => r.id));
  const ids = frozen ? [...frozen.filter((id) => live.has(id)), ...sorted.filter((r) => !frozen.includes(r.id)).map((r) => r.id)] : sorted.map((r) => r.id);
  if (frozen && JSON.stringify(ids) !== JSON.stringify(frozen)) setFrozen(ids);
  const age = formatAge(now - memory.sampledAt);
  const pressureLevel = memory.pressure === 'warn' ? 'warning' : memory.pressure;
  const load = loadLevel(memory.load);
  const maxima = Math.max(1, ...sorted.map((s) => s.bytes));
  return (
    <div
      className="divide-y divide-border text-body"
      onPointerEnter={() => setFrozen(ids)}
      onPointerLeave={() => setFrozen(null)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        if (!buttons.length) return;
        event.preventDefault();
        event.stopPropagation();
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = current < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1) : Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
        buttons[next]?.focus();
      }}
    >
      <header className="px-3.5 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-title font-medium tabular-nums">{formatBytes(memory.watchedBytes)}</span>
          <span className={cn('shrink-0 text-caption tabular-nums', memory.old ? 'text-info-text' : 'text-muted-foreground')}>{memory.old ? `old · ${age}` : `sampled ${age} ago`}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1 text-meta text-muted-foreground">
          <span>of {formatBytes(memory.ramBytes).replace('.0 GB', ' GB')} on this Mac ·</span>
          <span className={cn('inline-flex items-center gap-1', MEMORY_TEXT[pressureLevel])}><UsageLevelIcon level={pressureLevel} label={pressureLevel} />pressure {memory.pressure}</span>
        </div>
        <div className={cn('mt-1 flex items-center gap-1 text-meta', MEMORY_TEXT[load])}><UsageLevelIcon level={load} label={load} /><span className={MEMORY_TEXT[load]}>load {memory.load.one.toFixed(1)} · {memory.load.cores} cores</span></div>
        <Trend memory={memory} now={now} />
        <Split memory={memory} />
      </header>
      <section className="px-3.5 py-3" aria-label="Lookout memory">
        <h3 className="mb-2 text-caption font-medium tracking-wide text-muted-foreground uppercase">Lookout</h3>
        <RowContent row={memory.lookout} name="Lookout" max={Math.max(1, memory.lookout.bytes)} cores={memory.load.cores} />
      </section>
      <section className="px-3.5 py-3" aria-label="Session memory">
        <h3 className="mb-2 text-caption font-medium tracking-wide text-muted-foreground uppercase">Sessions</h3>
        {ids.length ? (
          <ul className="flex flex-col gap-2">
            {ids.map((id) => {
              const row = sorted.find((r) => r.id === id)!;
              const session = byId.get(id)!;
              const growth = row.growthBytes === null ? '' : `, growing +${formatBytes(row.growthBytes)}`;
              return (
                <li key={id}>
                  <button className="w-full rounded-md text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50" aria-label={`Open ${session.title}, ${formatBytes(row.bytes)}${growth}`} onClick={() => onSelect(id)}>
                    <RowContent row={row} name={session.title} session={session} max={maxima} cores={memory.load.cores} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-meta text-muted-foreground">No live Sessions</p>}
      </section>
    </div>
  );
}

function RowContent({ row, name, session, max, cores }: { row: MemoryRow; name: string; session?: SessionRow; max: number; cores: number }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        {session && <HarnessIcon harness={session.harness} />}
        <span className="min-w-0 flex-1 truncate font-medium" title={name}>{name}</span>
        <span className="shrink-0 tabular-nums">{formatBytes(row.bytes)}</span>
        {row.cpuPct >= 10 && <span className="shrink-0 text-caption text-muted-foreground tabular-nums" title={`${Math.round(row.cpuPct)}% of ${cores * 100}%`}>cpu {Math.round(row.cpuPct)}%</span>}
      </div>
      <p className="mt-0.5 truncate text-caption text-muted-foreground" title={row.top.map((e) => `${e.name}${e.count > 1 ? ` ×${e.count}` : ''} ${Math.round(e.bytes / MB)}`).join(' · ')}>
        {row.bytes === 0 ? 'gone' : row.top.map((e) => `${e.name}${e.count > 1 ? ` ×${e.count}` : ''} ${Math.round(e.bytes / MB)}`).join(' · ')}
      </p>
      {row.growthBytes !== null && <Chip tone="warning" className="mt-1"><TrendingUp aria-hidden className="size-3" />+{formatBytes(row.growthBytes)} in 10 min</Chip>}
      <span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded-full bg-foreground/10"><span className="block h-full rounded-full bg-foreground/55" style={{ width: `${row.bytes / max * 100}%` }} /></span>
    </div>
  );
}

function Trend({ memory, now }: { memory: MemorySnapshot; now: number }) {
  const shape = trendShape(memory.trend, now);
  const delta = shape?.delta ?? 0;
  const Icon = delta < 0 ? TrendingDown : TrendingUp;
  return (
    <div className="my-3 flex items-center gap-2 text-caption text-muted-foreground" data-field="trend">
      {shape ? (
        <>
          <svg data-field="sparkline" className="h-7 min-w-0 flex-1" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <polyline points={shape.points.map((p) => p.join(',')).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="shrink-0">last 30 min</span>
          <span className="inline-flex shrink-0 items-center gap-0.5 tabular-nums"><Icon className="size-3" aria-hidden />{delta < 0 ? '−' : '+'}{formatBytes(Math.abs(delta))}</span>
        </>
      ) : <span>collecting…</span>}
    </div>
  );
}

function Split({ memory }: { memory: MemorySnapshot }) {
  const values = [memory.lookout.bytes, memory.sessions.reduce((n, r) => n + r.bytes, 0), memory.otherBytes];
  const widths = splitWidths(values);
  return (
    <div className="text-caption text-muted-foreground">
      <div aria-hidden data-field="split" className="mb-1 flex h-2 overflow-hidden rounded-full bg-foreground/10">
        <span className="bg-foreground/55" style={{ width: `${widths[0]}%` }} />
        <span className="bg-foreground/30 [background-image:repeating-linear-gradient(135deg,transparent,transparent_2px,currentColor_2px,currentColor_3px)]" style={{ width: `${widths[1]}%` }} />
        <span className="border-y border-dotted border-foreground/30" style={{ width: `${widths[2]}%` }} />
      </div>
      <p className="flex flex-wrap gap-x-1 tabular-nums"><span>Lookout {formatBytes(values[0]!)}</span><span>· Sessions {formatBytes(values[1]!)}</span><span>· other {formatBytes(values[2]!)}</span></p>
      <p>this tab is in other</p>
    </div>
  );
}
