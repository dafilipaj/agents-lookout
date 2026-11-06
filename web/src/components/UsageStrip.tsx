import type { JevStatus, ProviderUsage, UsageSnapshot, UsageWindow } from '@shared/usage.ts';
import { freshness, hasReset, isFiveHour, isFlagged, liveWindows, stripWindows, usageLevel } from '@shared/usage.ts';
import { Check } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { CommandBlock } from '@/components/ui/command-block';
import { Meter, SectionLabel, Tile, Tiles, Verdict, WorthALook } from '@/components/ui/details';
import { Loading } from '@/components/ui/loading';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HARNESS_NAME } from '@/lib/sessions';
import { BAR_EDGE, BAR_EDGE_GAP, BAR_FILL, formatClock, formatUntil, freshnessLabel, limits, oldestAge, usageVerdict } from '@/lib/usage';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';
import { UsageLevelIcon } from './UsageLevelIcon';

const UNREADABLE: Record<Exclude<ProviderUsage['state'], 'ok'>, string> = {
  'not-installed': 'not installed',
  'signed-out': 'not signed in',
  'no-data': 'no data yet',
  unavailable: 'not available yet',
  error: 'error',
};

const JEV_LABEL: Record<JevStatus['state'], string> = {
  ready: 'ready',
  'not-set-up': 'not set up',
  'not-installed': 'not installed',
  unavailable: 'update tb-jev',
  error: 'error',
};

const windowKey = (p: ProviderUsage, w: UsageWindow) => `${p.id}-${w.kind}-${w.model ?? ''}`;

/** USAGE-1: the always-visible strip at the bottom of the Session sidebar; click for details. */
export function UsageStrip({ usage, now, onOpen, open, onOpenChange }: { usage: UsageSnapshot | null; now: number; onOpen?(): void; open?: boolean; onOpenChange?(open: boolean): void }) {
  const summaryId = useId();
  const verdictId = useId();
  return (
    <Popover open={open} onOpenChange={(next) => { onOpenChange?.(next); if (next) onOpen?.(); }}>
      <PopoverTrigger
        aria-label="Usage details"
        aria-describedby={usage ? summaryId : undefined}
        className="w-full shrink-0 px-2.5 pt-1 pb-0.5 text-left outline-none hover:bg-sidebar-accent/50 focus-visible:bg-sidebar-accent/60"
      >
        {usage ? (
          <>
            {/* The button's name replaces what's in it, so screen readers get the lines, as shown, as its description. */}
            <span id={summaryId} className="sr-only">
              {stripSummary(usage, now)}
            </span>
            {/* One set of columns for every first line, so the bars line up: mark (and `w`), bar, %, level mark, reset. */}
            <div className="grid grid-cols-[auto_minmax(2.5rem,1fr)_auto_auto_auto] gap-x-1.5 gap-y-1" data-testid="usage-strip">
              {usage.providers.map((p) => (
                <ProviderLine key={p.id} provider={p} now={now} />
              ))}
              <div className="col-span-full flex items-center gap-1.5 text-caption leading-4">
                <span className="font-medium">Jev</span>
                <span className={cn(usage.jev.state === 'ready' ? 'text-foreground/80' : 'text-muted-foreground')} data-field="jev">
                  <JevState state={usage.jev.state} />
                </span>
              </div>
            </div>
          </>
        ) : (
          <Loading label="Reading usage…" />
        )}
      </PopoverTrigger>
      {/* USAGE-2.3: the verdict names the popover; until there's one, "Usage details" does. */}
      <PopoverContent side="right" align="end" sideOffset={8} className="max-h-[min(36rem,90vh)] w-[22rem] overflow-x-hidden overflow-y-auto p-0" aria-labelledby={usage ? verdictId : 'usage-details-title'}>
        <h2 id="usage-details-title" className="sr-only">
          Usage details
        </h2>
        {usage ? <Details usage={usage} now={now} verdictId={verdictId} /> : <Loading label="Reading usage…" className="p-3" />}
      </PopoverContent>
    </Popover>
  );
}

/**
 * One provider in the strip (USAGE-1.1), on two lines. The first: its 5-hour window, or the weekly
 * window, labelled `w`, when no 5-hour one was reported. The second: the weekly limit, `weekly 42%`,
 * when the 5-hour window has the bar, then how old the numbers are (USAGE-1.3). Or a single line
 * saying why there are no numbers. A window whose reset has passed shows 0% with an empty reset slot
 * until the new read. The first line sits on the strip's columns (a subgrid), so the bar takes what
 * the rest leave and lines up with the other lines' bars.
 */
function ProviderLine({ provider, now }: { provider: ProviderUsage; now: number }) {
  const f = freshness(provider, now);
  const flagged = isFlagged(f);
  const pick = stripWindows(provider.windows, now);
  if (!pick) {
    return (
      <div className="col-span-full flex items-center gap-1.5 text-caption leading-4 text-muted-foreground" data-provider={provider.id}>
        <HarnessIcon harness={provider.id} />
        <span className="truncate" title={provider.reason ?? undefined}>
          {unreadable(provider)}
        </span>
      </div>
    );
  }
  const { main: w, weekly } = pick;
  const age = freshnessLabel(f, now);
  return (
    <div className="col-span-full grid grid-cols-subgrid" data-provider={provider.id}>
      <div
        className={cn('col-span-full grid grid-cols-subgrid items-center text-caption leading-4', flagged && 'opacity-60')}
        title={weekly ? `${windowTitle(w, now)}; ${windowTitle(weekly, now)}` : windowTitle(w, now)}
      >
        <span className="flex items-center gap-1.5">
          <HarnessIcon harness={provider.id} />
          {!isFiveHour(w) && (
            // No 5-hour window was reported, so the weekly one has the bar: say so, or it passes for the 5-hour one.
            <span className="text-muted-foreground" title={weeklyTitle(w)} data-field="window">
              w
            </span>
          )}
        </span>
        <Bar percent={w.percent} />
        <span className="text-right font-medium tabular-nums" data-field="percent">
          {w.percent}%
        </span>
        <Mark percent={w.percent} />
        <span className="text-right text-muted-foreground tabular-nums" data-field="reset">
          {formatUntil(w.resetsAt, now)}
        </span>
      </div>
      <div className="col-span-full flex min-w-0 items-center pl-5 text-caption leading-3.5 whitespace-nowrap">
        {weekly && (
          <>
            {/* The weekly limit as a %, its mark (USAGE-1.2) after it, by its number; it never gets cut short. */}
            <span className={cn('inline-flex shrink-0 items-center text-muted-foreground tabular-nums', flagged && 'opacity-60')} title={weeklyTitle(weekly)} data-field="weekly">
              weekly {weekly.percent}%
              <Mark percent={weekly.percent} compact />
            </span>
            <span className="shrink-0 text-muted-foreground">&nbsp;·&nbsp;</span>
          </>
        )}
        {/* USAGE-1.3: each provider says how old its numbers are; amber only when they're flagged. Cut short first, in full in its tooltip. */}
        <span
          className={cn('min-w-0 truncate', flagged ? 'font-medium text-info-text' : 'text-muted-foreground')}
          data-field="age"
          data-flagged={flagged}
          title={provider.reason ? `${age}; ${provider.reason}` : age}
        >
          {age}
        </span>
      </div>
    </div>
  );
}

/**
 * USAGE-2.3 to 2.7, in Memory's anatomy (DS-19): a verdict, three tiles, "Worth a look", then a
 * section per provider (its plan and age, its windows as meters, tightest first, extra usage, credits,
 * why it can't be read), and Jev's last.
 */
function Details({ usage, now, verdictId }: { usage: UsageSnapshot; now: number; verdictId: string }) {
  const verdict = usageVerdict(usage.providers, now);
  const age = oldestAge(usage.providers, now);
  const flagged = limits(usage.providers, now).filter((l) => usageLevel(l.percent) !== 'normal');
  return (
    <div className="divide-y divide-border text-body" data-testid="usage-details">
      <header className="flex flex-col gap-2.5 px-3.5 py-3">
        <Verdict level={verdict.level} age={age?.label} flagged={age?.flagged} id={verdictId}>
          {verdict.text}
        </Verdict>
        <Tiles>
          {(['claude', 'codex'] as const).map((id) => (
            <HarnessTile key={id} id={id} provider={usage.providers.find((p) => p.id === id)} now={now} />
          ))}
          <Tile label="Jev" value={JEV_LABEL[usage.jev.state]} field="tile-jev">
            {usage.jev.version && `v${usage.jev.version}`}
          </Tile>
        </Tiles>
        <WorthALook
          lines={flagged.map((l) => ({
            key: l.key,
            icon: <UsageLevelIcon level={usageLevel(l.percent)} className="shrink-0" />,
            text: `${HARNESS_NAME[l.provider.id]} ${l.words} at ${l.percent}%${l.resetsAt !== null ? `, resets ${formatClock(l.resetsAt, now)} (in ${formatUntil(l.resetsAt, now)})` : ''}`,
          }))}
        />
      </header>
      {usage.providers.map((p) => (
        <ProviderSection key={p.id} provider={p} now={now} />
      ))}
      <section className="px-3.5 py-3" aria-label="Jev">
        <SectionLabel className="mb-1.5" note={<span className={cn(usage.jev.state === 'ready' && 'text-foreground/80')}><JevState state={usage.jev.state} /></span>}>
          Jev
        </SectionLabel>
        <dl className="flex flex-col gap-0.5 text-meta">
          <Row name="Version" value={usage.jev.version} />
          <Row name="Key from" value={usage.jev.keySource} />
          <Row name="API" value={usage.jev.baseUrl} />
          <Row name="Config" value={usage.jev.configPath} mono />
        </dl>
        {usage.jev.reason && <p className="mt-1 text-meta text-muted-foreground">{usage.jev.reason}</p>}
        {/* TOOLS-2.5: a tb-jev too old for `status`: the command that updates it, to copy. */}
        {usage.jev.fix && <CommandBlock className="mt-1.5">{usage.jev.fix}</CommandBlock>}
        <p className="mt-2 text-caption text-muted-foreground">Checked without a billed call. Balance: see the Typesafe console.</p>
      </section>
    </div>
  );
}

/**
 * USAGE-2.4: a Harness's tile: its tightest window's % used, marked from 80% (USAGE-1.2), with the
 * window and the time to its reset under it ("5h · in 2h28", "weekly · Mon"); "—" and why when it
 * can't be read. Old numbers are dimmed, as in its section.
 */
function HarnessTile({ id, provider, now }: { id: ProviderUsage['id']; provider: ProviderUsage | undefined; now: number }) {
  const field = `tile-${id}`;
  if (!provider?.windows.length) {
    return (
      <Tile label={HARNESS_NAME[id]} value="—" field={field}>
        {provider ? unreadable(provider) : UNREADABLE.unavailable}
      </Tile>
    );
  }
  const w = liveWindows(provider.windows, now)[0];
  const dim = isFlagged(freshness(provider, now)) ? 'opacity-60' : undefined;
  if (!w) {
    return (
      <Tile label={HARNESS_NAME[id]} value="0%" field={field} className={dim}>
        reset · refreshing
      </Tile>
    );
  }
  const span = `${isFiveHour(w) ? '5h' : 'weekly'}${w.model ? ` ${w.model}` : ''}`;
  // Within a day, how long; further off, the day.
  const when = w.resetsAt === null ? null : w.resetsAt - now < 24 * 3_600_000 ? `in ${formatUntil(w.resetsAt, now)}` : new Date(w.resetsAt).toLocaleDateString(undefined, { weekday: 'short' });
  return (
    <Tile label={HARNESS_NAME[id]} value={`${w.percent}%`} level={usageLevel(w.percent)} field={field} className={dim}>
      {when ? `${span} · ${when}` : span}
    </Tile>
  );
}

/**
 * USAGE-2.6, 2.7: a provider under its label (its mark, and at its right its plan and how old its
 * numbers are), why it can't be read and its credits as lines, then its windows as meters, tightest
 * first, and extra usage; old numbers dimmed.
 */
function ProviderSection({ provider: p, now }: { provider: ProviderUsage; now: number }) {
  const f = freshness(p, now);
  const aged = p.windows.length > 0;
  const note: ReactNode =
    p.plan || aged ? (
      <>
        {p.plan && <span title={p.plan}>{p.plan}</span>}
        {p.plan && aged && ' · '}
        {aged && (
          <span className={cn(isFlagged(f) && 'font-medium text-info-text')} data-field="age">
            {freshnessLabel(f, now)}
          </span>
        )}
      </>
    ) : null;
  return (
    <section className="px-3.5 py-3" aria-label={`${HARNESS_NAME[p.id]} usage`}>
      <SectionLabel className="mb-1.5" icon={<HarnessIcon harness={p.id} />} note={note}>
        {HARNESS_NAME[p.id]}
      </SectionLabel>
      {p.reason && (p.state !== 'ok' || p.stale) && <p className="mb-1.5 text-meta text-muted-foreground">{p.reason}</p>}
      {p.credits && (p.credits.hasCredits || p.credits.unlimited) && (
        <p className="mb-1.5 text-meta text-muted-foreground">Credits: {p.credits.unlimited ? 'unlimited' : (p.credits.balance ?? '?')}</p>
      )}
      {aged && (
        <ul className={cn('flex flex-col gap-2', isFlagged(f) && 'opacity-60')}>
          {p.windows.map((w) => (
            <li key={windowKey(p, w)}>
              {hasReset(w, now) ? (
                // A passed reset: its numbers no longer hold, so no %, an empty bar, and what happens now in place of when.
                <Meter name={<span className="min-w-0 truncate">{w.label}</span>} percent={0} line="reset · refreshing" />
              ) : (
                <Meter
                  name={<span className="min-w-0 truncate">{w.label}</span>}
                  value={<span className="font-medium tabular-nums">{w.percent}%</span>}
                  mark={<Mark percent={w.percent} />}
                  percent={Math.max(2, w.percent)}
                  level={usageLevel(w.percent)}
                  line={w.resetsAt !== null ? `resets ${formatClock(w.resetsAt, now)} · in ${formatUntil(w.resetsAt, now)}` : null}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {p.extra?.enabled &&
        (p.extra.limit !== null ? (
          <Meter
            className="mt-2"
            data-testid="extra-usage"
            name={<span className="min-w-0 truncate">Extra usage</span>}
            value={
              <>
                <span className="text-meta text-muted-foreground tabular-nums">
                  {p.extra.used} of {p.extra.limit} {p.extra.currency ?? ''}
                </span>
                <span className="font-medium tabular-nums">{Math.round(p.extra.percent)}%</span>
              </>
            }
            mark={<Mark percent={p.extra.percent} />}
            percent={Math.max(2, Math.min(100, p.extra.percent))}
            level={usageLevel(p.extra.percent)}
          />
        ) : (
          <p className="mt-2 text-meta text-muted-foreground" data-testid="extra-usage">
            Extra usage: {p.extra.used} {p.extra.currency ?? ''} · no limit set
          </p>
        ))}
    </section>
  );
}

/** USAGE-2.6: one of Jev's details, the name at the left and the value at the right, cut short at its start, whole in its tooltip. */
function Row({ name, value, mono = false }: { name: string; value: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <dt className="shrink-0 text-muted-foreground">{name}</dt>
      {/* Right to left, so the ellipsis is at the start and the end (a path's file, a host) stays; the value itself reads left to right. */}
      <dd dir="rtl" className={cn('min-w-0 truncate', mono && 'font-mono text-caption')} title={value}>
        <span dir="ltr">{value}</span>
      </dd>
    </div>
  );
}

/** DS-3.2: the strip's bar: the fill `foreground/55` at every level, the level a 3 px edge at its end, set off by a 1 px gap in the sidebar's colour. */
function Bar({ percent }: { percent: number }) {
  const level = usageLevel(percent);
  const edge = BAR_EDGE[level];
  return (
    <span aria-hidden className="relative block h-1.5 overflow-hidden rounded-full bg-foreground/10" data-field="track">
      <span className={cn('absolute inset-y-0 left-0 overflow-hidden rounded-full', BAR_FILL)} style={{ width: `${Math.max(2, Math.min(100, percent))}%` }} data-field="fill" data-level={level}>
        {edge && <span className={cn('absolute inset-y-0 right-0 w-1', BAR_EDGE_GAP.strip, edge)} data-field="edge" />}
      </span>
    </span>
  );
}

/**
 * USAGE-1.2: a warning triangle at 80% or more, a critical octagon at 95% or more; a fixed-width
 * slot either way, unless `compact` (the weekly limit's), where it takes room only when shown.
 */
function Mark({ percent, compact = false }: { percent: number; compact?: boolean }) {
  if (compact && usageLevel(percent) === 'normal') return null;
  return (
    <span className={cn('shrink-0 text-center text-caption leading-none', compact ? 'ml-0.5' : 'w-3.5')} data-field="mark">
      <UsageLevelIcon level={usageLevel(percent)} className="align-middle" />
    </span>
  );
}

const unreadable = (p: ProviderUsage) => (p.state === 'ok' ? UNREADABLE['no-data'] : UNREADABLE[p.state]);

/**
 * USAGE-1.1 to 1.4 for screen readers: what the strip's lines show, marks, time to reset and age
 * included, so old numbers are never read out as current (USAGE-2.2), e.g. "Claude Code: 5-hour
 * 12%, resets in 2h10; weekly 97%, critical; updated 1m ago. Codex: 5-hour 0%; weekly 63%; old ·
 * 12m ago. Jev: ready."
 */
function stripSummary(usage: UsageSnapshot, now: number): string {
  const number = (w: UsageWindow) => {
    const level = usageLevel(w.percent);
    return `${isFiveHour(w) ? '5-hour' : 'weekly'} ${w.percent}%${level === 'normal' ? '' : `, ${level}`}`;
  };
  const lines = usage.providers.map((p) => {
    const pick = stripWindows(p.windows, now);
    if (!pick) return `${HARNESS_NAME[p.id]}: ${unreadable(p)}.`;
    const reset = formatUntil(pick.main.resetsAt, now);
    const said = [`${number(pick.main)}${reset ? `, resets in ${reset}` : ''}`, ...(pick.weekly ? [number(pick.weekly)] : []), freshnessLabel(freshness(p, now), now)];
    return `${HARNESS_NAME[p.id]}: ${said.join('; ')}.`;
  });
  return [...lines, `Jev: ${JEV_LABEL[usage.jev.state]}.`].join(' ');
}

/** USAGE-1.4: Jev's state; ready carries a check (the text says it either way). */
function JevState({ state }: { state: JevStatus['state'] }) {
  return state === 'ready' ? (
    <span className="inline-flex items-center gap-0.5">
      <Check className="size-3 shrink-0" aria-hidden />
      {JEV_LABEL.ready}
    </span>
  ) : (
    JEV_LABEL[state]
  );
}

/** USAGE-1.1: the tooltip of the weekly limit, and of the `w` before a weekly window's bar. */
const weeklyTitle = (w: UsageWindow) => `Weekly limit ${w.percent}%`;

function windowTitle(w: UsageWindow, now: number): string {
  return `${w.label}: ${Math.round(w.percent)}% used${w.resetsAt !== null ? `, resets ${formatClock(w.resetsAt, now)}` : ''}`;
}
