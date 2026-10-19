import type { JevStatus, ProviderUsage, UsageSnapshot, UsageWindow } from '@shared/usage.ts';
import { freshness, hasReset, isFiveHour, isFlagged, stripWindows, usageLevel } from '@shared/usage.ts';
import { Check } from 'lucide-react';
import { useId } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HARNESS_NAME } from '@/lib/sessions';
import { formatClock, formatUntil, freshnessLabel } from '@/lib/usage';
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
export function UsageStrip({ usage, now, onOpen }: { usage: UsageSnapshot | null; now: number; onOpen?(): void }) {
  const summaryId = useId();
  return (
    <Popover onOpenChange={(open) => open && onOpen?.()}>
      <PopoverTrigger
        aria-label="Usage details"
        aria-describedby={usage ? summaryId : undefined}
        className="w-full shrink-0 px-2.5 py-2 text-left outline-none hover:bg-sidebar-accent/50 focus-visible:bg-sidebar-accent/60"
      >
        {usage ? (
          <>
            {/* The button's name replaces what's in it, so screen readers get the lines, as shown, as its description. */}
            <span id={summaryId} className="sr-only">
              {stripSummary(usage, now)}
            </span>
            <div className="flex flex-col gap-1" data-testid="usage-strip">
              {usage.providers.map((p) => (
                <ProviderLine key={p.id} provider={p} now={now} />
              ))}
              <div className="flex items-center gap-1.5 text-[11px] leading-4">
                <span className="font-medium">Jev</span>
                <span className={cn(usage.jev.state === 'ready' ? 'text-foreground/80' : 'text-muted-foreground')} data-field="jev">
                  <JevState state={usage.jev.state} />
                </span>
              </div>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">Reading usage…</p>
        )}
      </PopoverTrigger>
      <PopoverContent side="right" align="end" sideOffset={8} className="w-[22rem] p-0" aria-labelledby="usage-details-title">
        <h2 id="usage-details-title" className="sr-only">
          Usage details
        </h2>
        {usage ? <Details usage={usage} now={now} /> : <p className="p-3 text-[12.5px] text-muted-foreground">Reading usage…</p>}
      </PopoverContent>
    </Popover>
  );
}

/**
 * One provider in the strip (USAGE-1.1): its 5-hour window with the weekly one's % in brackets,
 * the weekly window alone, labelled "weekly", when no 5-hour one was reported, or why there's
 * none. A window whose reset has passed shows 0% with an empty reset slot until the new read.
 */
function ProviderLine({ provider, now }: { provider: ProviderUsage; now: number }) {
  const f = freshness(provider, now);
  const flagged = isFlagged(f);
  const pick = stripWindows(provider.windows, now);
  if (!pick) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground" data-provider={provider.id}>
        <HarnessIcon harness={provider.id} />
        <span className="truncate" title={provider.reason ?? undefined}>
          {unreadable(provider)}
        </span>
      </div>
    );
  }
  const { main: w, weekly } = pick;
  return (
    <div className="flex flex-col" data-provider={provider.id}>
      <div
        className={cn('flex items-center gap-1.5 text-[11px] leading-4', flagged && 'opacity-60')}
        title={weekly ? `${windowTitle(w, now)}; ${windowTitle(weekly, now)}` : windowTitle(w, now)}
      >
        <HarnessIcon harness={provider.id} />
        {!isFiveHour(w) && (
          // No 5-hour window was reported, so the weekly one has the bar: say so, or it passes for the 5-hour one.
          <span className="shrink-0 text-muted-foreground" data-field="window">
            weekly
          </span>
        )}
        <Bar percent={w.percent} className="min-w-6 flex-1" />
        <span className="w-8 text-right font-medium tabular-nums" data-field="percent">
          {w.percent}%
        </span>
        <Mark percent={w.percent} />
        <span className="w-10 text-right text-muted-foreground tabular-nums" data-field="reset">
          {formatUntil(w.resetsAt, now)}
        </span>
        {weekly && (
          // The weekly limit only as a %, its mark (USAGE-1.2) inside the brackets, by its number.
          <span className="inline-flex shrink-0 items-center whitespace-nowrap text-muted-foreground tabular-nums" data-field="weekly">
            (weekly {weekly.percent}%
            <Mark percent={weekly.percent} compact />)
          </span>
        )}
      </div>
      {/* USAGE-1.3: each provider says how old its numbers are; amber only when they're flagged. */}
      <span
        className={cn('pl-5 text-[10.5px] leading-3.5', flagged ? 'font-medium text-needs-you-text' : 'text-muted-foreground')}
        data-field="age"
        data-flagged={flagged}
        title={provider.reason ?? undefined}
      >
        {freshnessLabel(f, now)}
      </span>
    </div>
  );
}

/** USAGE-2: plan, every window tightest first, extra usage, credits, and Jev. */
function Details({ usage, now }: { usage: UsageSnapshot; now: number }) {
  return (
    <div className="divide-y divide-border text-[12.5px]" data-testid="usage-details">
      {usage.providers.map((p) => {
        const f = freshness(p, now);
        return (
          <section key={p.id} className="px-3.5 py-3" aria-label={`${HARNESS_NAME[p.id]} usage`}>
            <header className="mb-2 flex items-center gap-2">
              <HarnessIcon harness={p.id} className="size-4" />
              <span className="shrink-0 font-medium whitespace-nowrap">{HARNESS_NAME[p.id]}</span>
              {p.plan && (
                <span className="min-w-0 truncate text-muted-foreground" title={p.plan}>
                  · {p.plan}
                </span>
              )}
              {p.windows.length > 0 && (
                <span
                  className={cn('ml-auto shrink-0 text-[11px] whitespace-nowrap text-muted-foreground', isFlagged(f) && 'font-medium text-needs-you-text')}
                  data-field="age"
                >
                  {freshnessLabel(f, now)}
                </span>
              )}
            </header>
            {p.reason && (p.state !== 'ok' || p.stale) && <p className="mb-2 text-[12px] text-muted-foreground">{p.reason}</p>}
            {p.windows.length > 0 && (
              <ul className={cn('flex flex-col gap-2', isFlagged(f) && 'opacity-60')}>
                {p.windows.map((w) => (
                  <li key={windowKey(p, w)}>
                    {hasReset(w, now) ? (
                      <div className="flex items-baseline gap-1.5">
                        <span className="min-w-0 flex-1 truncate">{w.label}</span>
                        <span className="text-[11.5px] text-muted-foreground">reset · refreshing</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-1.5">
                          <span className="min-w-0 flex-1 truncate">{w.label}</span>
                          <span className="font-medium tabular-nums">{Math.round(w.percent)}%</span>
                          <Mark percent={w.percent} />
                        </div>
                        <Bar percent={w.percent} className="mt-1" />
                        {w.resetsAt !== null && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            resets {formatClock(w.resetsAt, now)} · in {formatUntil(w.resetsAt, now)}
                          </p>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {p.extra?.enabled && (
              <div className="mt-2" data-testid="extra-usage">
                <div className="flex items-baseline gap-1.5 text-[12px]">
                  <span className="min-w-0 flex-1">Extra usage</span>
                  {p.extra.limit !== null ? (
                    <>
                      <span className="text-muted-foreground tabular-nums">
                        {p.extra.used} of {p.extra.limit} {p.extra.currency ?? ''}
                      </span>
                      <span className="font-medium tabular-nums">{Math.round(p.extra.percent)}%</span>
                      <Mark percent={p.extra.percent} />
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {p.extra.used} {p.extra.currency ?? ''} · no limit set
                    </span>
                  )}
                </div>
                {p.extra.limit !== null && <Bar percent={p.extra.percent} className="mt-1" />}
              </div>
            )}
            {p.credits && (p.credits.hasCredits || p.credits.unlimited) && (
              <p className="mt-2 text-[12px] text-muted-foreground">
                Credits: {p.credits.unlimited ? 'unlimited' : (p.credits.balance ?? '?')}
              </p>
            )}
          </section>
        );
      })}
      <section className="px-3.5 py-3" aria-label="Jev">
        <header className="mb-1 flex items-center gap-2">
          <span className="font-medium">Jev</span>
          <span className={cn(usage.jev.state === 'ready' ? 'text-foreground/80' : 'text-muted-foreground')}><JevState state={usage.jev.state} /></span>
        </header>
        <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-0.5 text-[12px]">
          {usage.jev.version && (
            <>
              <dt className="text-muted-foreground">Version</dt>
              <dd>{usage.jev.version}</dd>
            </>
          )}
          {usage.jev.keySource && (
            <>
              <dt className="text-muted-foreground">Key from</dt>
              <dd>{usage.jev.keySource}</dd>
            </>
          )}
          {usage.jev.baseUrl && (
            <>
              <dt className="text-muted-foreground">API</dt>
              <dd className="truncate">{usage.jev.baseUrl}</dd>
            </>
          )}
          {usage.jev.configPath && (
            <>
              <dt className="text-muted-foreground">Config</dt>
              <dd className="truncate font-mono text-[11px]" title={usage.jev.configPath}>
                {usage.jev.configPath}
              </dd>
            </>
          )}
        </dl>
        {usage.jev.reason && <p className="mt-1 text-[12px] text-muted-foreground">{usage.jev.reason}</p>}
        <p className="mt-2 text-[11px] text-muted-foreground">Checked without a billed call. Balance: see the Typesafe console.</p>
      </section>
    </div>
  );
}

function Bar({ percent, className }: { percent: number; className?: string }) {
  const level = usageLevel(percent);
  return (
    <span aria-hidden className={cn('relative block h-1.5 overflow-hidden rounded-full bg-foreground/10', className)}>
      <span
        className={cn(
          'absolute inset-y-0 left-0 rounded-full',
          level === 'critical' ? 'bg-destructive' : level === 'warning' ? 'bg-needs-you' : 'bg-foreground/55',
        )}
        style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
      />
    </span>
  );
}

/**
 * USAGE-1.2: a warning triangle at 80% or more, a critical octagon at 95% or more; a fixed-width
 * slot either way, unless `compact` (the weekly bracket), where it takes room only when shown.
 */
function Mark({ percent, compact = false }: { percent: number; compact?: boolean }) {
  if (compact && usageLevel(percent) === 'normal') return null;
  return (
    <span className={cn('shrink-0 text-center text-[11px] leading-none', compact ? 'ml-0.5' : 'w-3.5')} data-field="mark">
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

function windowTitle(w: UsageWindow, now: number): string {
  return `${w.label}: ${Math.round(w.percent)}% used${w.resetsAt !== null ? `, resets ${formatClock(w.resetsAt, now)}` : ''}`;
}
