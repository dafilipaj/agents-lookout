import { MB, formatBytes, loadLevel, trendShape, watchedLevel, type MemoryRow, type MemorySnapshot } from '@shared/memory.ts';
import { jobTool, waitStart, waitingCount, type ResJob, type ResSnapshot } from '@shared/res.ts';
import type { SessionRow } from '@shared/types.ts';
import { Hourglass, TrendingDown, TrendingUp } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import type { UsageLevel } from '@shared/usage.ts';
import { Loading } from '@/components/ui/loading';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { clockTime } from '@/lib/chat';
import { MEMORY_GLYPH, MEMORY_TEXT, memoryDescription } from '@/lib/memory';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';
import { UsageLevelIcon } from './UsageLevelIcon';

interface Props {
  memory: MemorySnapshot | null;
  /** RES-2: `res`'s queue; null without `res`. */
  res?: ResSnapshot | null;
  sessions: readonly SessionRow[];
  now: number;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSelect(id: string): void;
}

/** MEM-1, MEM-3: a dock line and its clickable breakdown, beside the usage details. */
export function MemoryLine({ memory, res = null, sessions, now, open, onOpenChange, onSelect }: Props) {
  const summaryId = useId();
  const titleId = useId();
  const waiting = waitingCount(res);
  // RES-2.1: the jobs waiting in res, said with the rest of the line.
  const description = `${memory ? memoryDescription(memory, now, sessions) : 'Reading memory…'}${waiting ? `, ${waiting} waiting in res` : ''}`;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label="Memory details"
        aria-describedby={summaryId}
        title={description}
        className="mt-auto flex h-7 w-full shrink-0 items-center gap-1.5 border-t border-sidebar-border/70 bg-muted/30 px-2.5 text-left text-caption leading-4 whitespace-nowrap outline-none hover:bg-sidebar-accent/50 focus-visible:bg-sidebar-accent/60"
      >
        <span id={summaryId} className="sr-only">{description}</span>
        <span aria-hidden data-field="memory-glyph" className={cn('h-3 w-[3px] shrink-0 rounded-full transition-colors duration-700 motion-reduce:transition-none', MEMORY_GLYPH[memory ? watchedLevel(memory) : 'normal'])} />
        {memory ? (
          <span>
            {/* MEM-1.3: at a warning or critical level the total takes the level's text colour too, so the 3 px glyph isn't the only sign. */}
            <span className={cn('font-medium tabular-nums', watchedLevel(memory) !== 'normal' && MEMORY_TEXT[watchedLevel(memory)])} data-field="memory-total">{formatBytes(memory.watchedBytes)}</span>
            <span className="text-muted-foreground"> · {memory.pressure === 'normal' ? `load ${memory.load.one.toFixed(1)}` : `pressure ${memory.pressure}`}</span>
          </span>
        ) : <Loading label="Reading memory…" className="text-caption leading-4" />}
        {waiting > 0 && (
          <span aria-hidden data-field="res-waiting" className="ml-auto flex shrink-0 items-center gap-0.5 font-medium tabular-nums">
            <Hourglass className="size-3" />
            {waiting}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent side="right" align="end" sideOffset={8} className="max-h-[min(36rem,90vh)] w-[22rem] overflow-x-hidden overflow-y-auto p-0" aria-labelledby={titleId}>
        <h2 id={titleId} className="sr-only">Memory details</h2>
        {memory ? <Details memory={memory} res={res} sessions={sessions} now={now} onSelect={(id) => { onSelect(id); onOpenChange(false); }} /> : <Loading label="Reading memory…" className="p-3" />}
      </PopoverContent>
    </Popover>
  );
}

const VERDICT: Record<UsageLevel, string> = { normal: 'The Mac has room', warning: 'The Mac is getting busy', critical: 'The Mac is overloaded' };
const HOURGLASS = <Hourglass aria-hidden className="size-3 shrink-0" />;

/** MEM-3.2 to 3.9: a verdict, three tiles, what's worth a look, who uses the memory, then res's queue. */
function Details({ memory, res, sessions, now, onSelect }: { memory: MemorySnapshot; res: ResSnapshot | null; sessions: readonly SessionRow[]; now: number; onSelect(id: string): void }) {
  const [frozen, setFrozen] = useState<string[] | null>(null);
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const sorted = memory.sessions.filter((s) => byId.has(s.id)).toSorted((a, b) => b.bytes - a.bytes || a.id.localeCompare(b.id));
  const live = new Set(sorted.map((r) => r.id));
  const ids = frozen ? [...frozen.filter((id) => live.has(id)), ...sorted.filter((r) => !frozen.includes(r.id)).map((r) => r.id)] : sorted.map((r) => r.id);
  if (frozen && JSON.stringify(ids) !== JSON.stringify(frozen)) setFrozen(ids);
  const level = watchedLevel(memory);
  const age = formatAge(now - memory.sampledAt);
  const pressureLevel: UsageLevel = memory.pressure === 'warn' ? 'warning' : memory.pressure;
  const load = loadLevel(memory.load);
  const total = Math.max(1, memory.totalBytes);
  const width = (bytes: number) => (bytes > 0 ? `${Math.max(2, (bytes / total) * 100)}%` : '0%');
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
      <header className="flex flex-col gap-2.5 px-3.5 py-3">
        <div className="flex items-center justify-between gap-2" data-field="verdict">
          <span className="flex min-w-0 items-center gap-1.5 font-medium">
            <span aria-hidden className={cn('size-2 shrink-0 rounded-full', MEMORY_GLYPH[level])} />
            {VERDICT[level]}
          </span>
          <span className={cn('shrink-0 text-caption tabular-nums', memory.old ? 'text-info-text' : 'text-muted-foreground')}>{memory.old ? `stale · ${age}` : `${age} ago`}</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <Tile label="Memory" value={formatBytes(memory.watchedBytes)} field="tile-memory"><Trend memory={memory} now={now} /></Tile>
          <Tile label="Pressure" value={memory.pressure} level={pressureLevel} field="tile-pressure">macOS</Tile>
          <Tile label="CPU load" value={memory.load.one.toFixed(1)} level={load} field="tile-load">of {memory.load.cores} cores</Tile>
        </div>
        <WorthALook memory={memory} res={res} byId={byId} now={now} />
      </header>
      <section className="px-3.5 py-3" aria-label="Who uses it">
        <h3 className="mb-1.5 flex items-baseline justify-between gap-2 text-caption font-medium tracking-wide text-muted-foreground">
          <span className="uppercase">Who uses it</span>
          <span className="font-normal tabular-nums">{formatBytes(memory.totalBytes).replace('.0 GB', ' GB')} of {formatBytes(memory.ramBytes).replace('.0 GB', ' GB')} in use</span>
        </h3>
        <ul className="flex flex-col">
          {ids.length ? ids.map((id) => {
            const row = sorted.find((r) => r.id === id)!;
            const session = byId.get(id)!;
            const growth = row.growthBytes === null ? '' : `, growing +${formatBytes(row.growthBytes)}`;
            return (
              <li key={id}>
                <button className="w-full rounded-md text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50" aria-label={`Open ${session.title}, ${formatBytes(row.bytes)}${growth}`} onClick={() => onSelect(id)}>
                  <UseRow row={row} name={session.title} session={session} bar="bg-foreground/55" width={width(row.bytes)} cores={memory.load.cores} now={now} />
                </button>
              </li>
            );
          }) : <li className="py-1.5 text-meta text-muted-foreground">No live Sessions</li>}
          <li><UseRow row={memory.lookout} name="Lookout" bar="bg-foreground/30" width={width(memory.lookout.bytes)} cores={memory.load.cores} now={now} /></li>
          <li title="Every other process on this Mac, this tab too">
            <UseRow row={{ id: 'other', bytes: memory.otherBytes, growthBytes: null, cpuPct: 0, top: [] }} name="Other apps" bar="bg-foreground/15" width={width(memory.otherBytes)} cores={memory.load.cores} now={now} quiet />
          </li>
        </ul>
      </section>
      {res && <Queue res={res} sessions={sessions} now={now} onSelect={onSelect} />}
    </div>
  );
}

/** MEM-3.2: one of the three tiles; a level colours its value and adds the level icon. */
function Tile({ label, value, level = 'normal', field, children }: { label: string; value: string; level?: UsageLevel; field: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/60 px-2 py-1.5" data-field={field}>
      <div className="text-caption text-muted-foreground">{label}</div>
      <div className={cn('flex items-center gap-1 font-medium whitespace-nowrap tabular-nums', level !== 'normal' && MEMORY_TEXT[level])}>
        {level !== 'normal' && <UsageLevelIcon level={level} label={level} />}
        {value}
      </div>
      <div className="truncate text-caption text-muted-foreground">{children}</div>
    </div>
  );
}

/** MEM-3.3: the change over the last 30 minutes, as a number. */
function Trend({ memory, now }: { memory: MemorySnapshot; now: number }) {
  const shape = trendShape(memory.trend, now);
  if (!shape) return <span data-field="trend">collecting…</span>;
  const Icon = shape.delta < 0 ? TrendingDown : TrendingUp;
  return (
    <span data-field="trend" className="inline-flex items-center gap-0.5 tabular-nums" title={`${shape.delta < 0 ? '−' : '+'}${formatBytes(Math.abs(shape.delta))} in the last 30 min`}>
      <Icon className="size-3 shrink-0" aria-hidden />
      {shape.delta < 0 ? '−' : '+'}{formatBytes(Math.abs(shape.delta))} in 30m
    </span>
  );
}

/** MEM-3.9: what needs an eye, shown only when something does. */
function WorthALook({ memory, res, byId, now }: { memory: MemorySnapshot; res: ResSnapshot | null; byId: ReadonlyMap<string, SessionRow>; now: number }) {
  const growing = [
    ...memory.sessions.filter((r) => r.growthBytes !== null && byId.has(r.id)).map((r) => ({ id: r.id, name: byId.get(r.id)!.title, bytes: r.growthBytes! })),
    ...(memory.lookout.growthBytes !== null ? [{ id: memory.lookout.id, name: 'Lookout', bytes: memory.lookout.growthBytes }] : []),
  ];
  const waiting = res?.jobs.filter((j) => j.state === 'waiting') ?? [];
  const longest = Math.max(0, ...waiting.map((j) => now - (waitStart(j) ?? now)));
  if (!growing.length && !waiting.length) return null;
  return (
    <section aria-label="Worth a look" className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-meta">
      <h3 className="font-medium">Worth a look</h3>
      {growing.map((g) => (
        <p key={g.id} className="flex min-w-0 items-center gap-1.5">
          <TrendingUp aria-hidden className={cn('size-3 shrink-0', MEMORY_TEXT.warning)} />
          <span className="truncate">{g.name} grew +{formatBytes(g.bytes)} in 10 min</span>
        </p>
      ))}
      {waiting.length > 0 && (
        <p className="flex min-w-0 items-center gap-1.5" data-field="res-waiting-note">
          {HOURGLASS}
          <span className="truncate">{waiting.length} job{waiting.length === 1 ? '' : 's'} waiting in res{waiting.length === 1 ? ` for ${formatAge(longest)}` : `, the longest ${formatAge(longest)}`}</span>
        </p>
      )}
    </section>
  );
}

/** MEM-3.5: a name, its marks, its size, and a bar on the list's one scale; its executables in the tooltip. */
function UseRow({ row, name, session, bar, width, cores, now, quiet = false }: { row: MemoryRow; name: string; session?: SessionRow; bar: string; width: string; cores: number; now: number; quiet?: boolean }) {
  const top = row.top.map((e) => `${e.name}${e.count > 1 ? ` ×${e.count}` : ''} ${Math.round(e.bytes / MB)}`).join(' · ');
  const gone = !!session && row.bytes === 0;
  return (
    <div className="min-w-0 py-1.5" title={top || undefined} data-row={row.id}>
      <div className="flex min-w-0 items-center gap-1.5">
        {session && <HarnessIcon harness={session.harness} />}
        <span className={cn('min-w-0 truncate', quiet ? 'text-muted-foreground' : 'font-medium')}>{name}</span>
        {gone && <span className="shrink-0 text-caption text-muted-foreground">gone</span>}
        {row.growthBytes !== null && (
          <span className={cn('flex shrink-0 items-center gap-0.5 text-caption tabular-nums', MEMORY_TEXT.warning)} data-field="growth">
            <TrendingUp aria-hidden className="size-3" />+{formatBytes(row.growthBytes)}
          </span>
        )}
        {session?.queued && (
          <span className="flex shrink-0 items-center gap-0.5 text-caption text-muted-foreground tabular-nums" data-field="queued" title={`Queued in res: ${session.queued.tool}`}>
            {HOURGLASS}{formatAge(Math.max(0, now - session.queued.since))}
          </span>
        )}
        <span className="flex-1" />
        {row.cpuPct >= 10 && <span className="shrink-0 text-caption text-muted-foreground tabular-nums" title={`${Math.round(row.cpuPct)}% of ${cores * 100}%`}>cpu {Math.round(row.cpuPct)}%</span>}
        <span className={cn('shrink-0 tabular-nums', quiet && 'text-muted-foreground')}>{formatBytes(row.bytes)}</span>
      </div>
      <span aria-hidden className="mt-1 block h-1 overflow-hidden rounded-full bg-foreground/10"><span className={cn('block h-full rounded-full', bar)} style={{ width }} /></span>
    </div>
  );
}

/** RES-2.2: what res runs and what waits, one line each, under their Sessions. */
function Queue({ res, sessions, now, onSelect }: { res: ResSnapshot; sessions: readonly SessionRow[]; now: number; onSelect(id: string): void }) {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  return (
    <section className="px-3.5 py-3" aria-label="res queue" data-section="res">
      <h3 className="mb-1.5 text-caption font-medium tracking-wide text-muted-foreground uppercase">res queue</h3>
      {res.error && (
        <p className="mb-1.5 text-meta text-info-text">
          Couldn't read res: {res.error}.{res.readAt !== null && ` Showing the list from ${clockTime(new Date(res.readAt).toISOString())}.`}
        </p>
      )}
      {res.jobs.length ? (
        <ul className="flex flex-col gap-1 text-meta">
          {res.jobs.map((job) => <JobRow key={job.id} job={job} session={job.sessionId ? byId.get(job.sessionId) ?? null : null} now={now} onSelect={onSelect} />)}
        </ul>
      ) : <p className="text-meta text-muted-foreground">Nothing running or waiting.</p>}
    </section>
  );
}

function JobRow({ job, session, now, onSelect }: { job: ResJob; session: SessionRow | null; now: number; onSelect(id: string): void }) {
  const waiting = job.state === 'waiting';
  const from = waiting ? waitStart(job) : job.since;
  const age = from !== null ? formatAge(Math.max(0, now - from)) : null;
  const tip = `${job.cls} · ${job.prio} · ${waiting ? 'needs ' : ''}${job.cores} core${job.cores === 1 ? '' : 's'}, ${formatBytes(job.mb * MB)}`;
  return (
    <li className="flex min-w-0 items-center gap-2" data-job={job.id} title={tip}>
      <span className="w-14 shrink-0 text-muted-foreground tabular-nums">{waiting ? `#${job.position} waits` : 'running'}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <span className="shrink-0 font-medium">{jobTool(job)}</span>
        <span aria-hidden className="text-muted-foreground">·</span>
        {session ? (
          <button
            className="min-w-0 truncate rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label={`Open ${session.title}, ${waiting ? 'waiting for' : 'running'} ${jobTool(job)}`}
            onClick={() => onSelect(session.id)}
          >
            {session.title}
          </button>
        ) : <span className="text-muted-foreground">No Session</span>}
      </span>
      <span className="shrink-0 text-muted-foreground tabular-nums">{[formatBytes(job.mb * MB), age].filter(Boolean).join(' · ')}</span>
    </li>
  );
}
