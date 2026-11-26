import { BOTS_READ_ONLY, type BotInput, type BotRun, type BotView, type BotsSnapshot, inFlight, scheduleWords } from '@shared/bots.ts';
import type { SettingsView } from '@shared/settings.ts';
import type { SessionRow } from '@shared/types.ts';
import { Check, CircleDashed, TriangleAlert } from 'lucide-react';
import { type KeyboardEvent, type RefObject, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { RowSettling, useRowSettle } from '@/components/ui/icon-button';
import { Loading } from '@/components/ui/loading';
import { RowActions } from '@/components/ui/row-actions';
import { RowDetails, type RowLinkGroup, RowTitle } from '@/components/ui/row-details';
import { SessionMarker } from '@/components/ui/session-marker';
import { ActionIcon } from '@/lib/actions';
import { RUN_WORD, botFact, botRuns, dayTime, skippedWords, sortBots } from '@/lib/bots';
import type { HarnessState } from '@/lib/launch';
import type { PanelNav } from '@/lib/right-sidebar';
import { HARNESS_NAME } from '@/lib/sessions';
import { cn } from '@/lib/utils';
import { BotDialog, DeleteBotDialog } from './BotDialog';

export interface BotsPanelProps {
  /** The Bots and their runs; null before the server's first answer. */
  bots: BotsSnapshot | null;
  sessions: ReadonlyMap<string, SessionRow>;
  now: number;
  /** Bumped to move focus into the panel, only by your key or click (SIDE-11.1). */
  focusKey: number;
  /** INBOX-2.2: a Bot to select and expand, from its Report's header; taken once. */
  reveal: string | null;
  onRevealed(): void;
  /** BOT-2.1: what the dialog's launcher fields choose from. */
  settings: SettingsView;
  harnesses: HarnessState;
  onLoadHarnesses(): void;
  create(input: BotInput): Promise<BotView>;
  update(id: string, patch: Partial<BotInput>): Promise<BotView>;
  remove(id: string): Promise<void>;
  /** BOT-4.2: Run now. */
  run(id: string): Promise<BotRun>;
  /** BOT-1.5: a run's line: its Report in the Inbox, or its Session while it's going. */
  onOpenRun(run: BotRun): void;
  /** False while a dialog owns the keyboard. */
  keyboardEnabled: boolean;
  navRef: RefObject<PanelNav | null>;
}

const rowId = (id: string) => `bot-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;

/** BOT-4.2: what Run now says while one of the Bot's runs is going. */
const RUNNING = "It's running";

/**
 * BOT-1: the Bots tab of the right sidebar. "New Bot", then every Bot as a row of one listbox
 * (BOT-1.2), built as Setup's and Work's rows are: a click or Enter selects a row and expands it in
 * place, Enter on the expanded row runs its first button, Run now, Esc collapses it, and `X` turns
 * the selected Bot off or on (BOT-1.4). A row holds nothing focusable: its buttons are mouse targets
 * and the keys above are the keyboard's way.
 */
export function BotsPanel({ bots, sessions, now, focusKey, reveal, onRevealed, settings, harnesses, onLoadHarnesses, create, update, remove, run, onOpenRun, keyboardEnabled, navRef }: BotsPanelProps) {
  const rows = sortBots(bots?.bots ?? []);
  const runs = bots?.runs ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const active = rows.find((b) => b.id === selected) ?? rows[0] ?? null;
  // BOT-1.4: one row expanded at a time, and only while it's listed.
  const open = expanded !== null && rows.some((b) => b.id === expanded) ? expanded : null;
  const { settling, settle } = useRowSettle();
  const root = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // BOT-2.3, BOT-2.6: nothing can be saved while the store can't be read, or on a second server; why, in words.
  const locked = !bots ? null : bots.state === 'read-only' ? (bots.error ?? BOTS_READ_ONLY) : bots.state === 'unreadable' ? `Nothing can be saved while ${bots.path} can’t be read.` : null;
  /** The Bot whose Run now or switch is on its way to the server. */
  const [busy, setBusy] = useState<{ id: string; what: 'run' | 'switch' } | null>(null);
  /** What the server refused, said at the panel's top until the next try. */
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ bot: BotView | null } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deleting = deletingId === null ? null : (rows.find((b) => b.id === deletingId) ?? null);

  // SIDE-11.1: the panel takes focus only for a request, when `focusKey` rises above what it was:
  // its list, or itself while there's no list yet. Never as it mounts unasked or as its Bots change.
  const asked = useRef(0);
  useEffect(() => {
    if (focusKey > asked.current) (list.current ?? root.current)?.focus();
    asked.current = focusKey;
  }, [focusKey]);
  // Focus the panel held while the Bots were read goes on to the list once it shows.
  const listed = bots !== null;
  useEffect(() => {
    if (listed && document.activeElement === root.current) list.current?.focus();
  }, [listed]);

  // INBOX-2.2: a Report's header shows its Bot here, selected and expanded, once. Adjusting state
  // while rendering, as React documents for derived state.
  const [revealed, setRevealed] = useState<string | null>(null);
  if (reveal !== revealed) {
    setRevealed(reveal);
    if (reveal && rows.some((b) => b.id === reveal)) {
      setSelected(reveal);
      setExpanded(reveal);
    }
  }
  useLayoutEffect(() => {
    if (!reveal) return;
    document.getElementById(rowId(reveal))?.scrollIntoView?.({ block: 'nearest' });
    onRevealed();
  }, [reveal, onRevealed]);

  const select = (id: string) => {
    if (id !== active?.id) setExpanded(null);
    setSelected(id);
    document.getElementById(rowId(id))?.scrollIntoView?.({ block: 'nearest' });
  };
  /** BOT-1.4: select a row and expand it, collapsing any other. Its model's name comes from Fleet's list, read when it isn't here. */
  const expand = (id: string) => {
    setSelected(id);
    setExpanded(id);
    if (harnesses.state !== 'ready') onLoadHarnesses();
  };
  // The list scrolls to keep all of an expanded row in view, and only as far as it must (WORK-1.15).
  useEffect(() => {
    if (open) document.getElementById(rowId(open))?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);
  const move = (delta: 1 | -1) => {
    if (!rows.length) return;
    const at = active ? rows.indexOf(active) : -1;
    select(rows[Math.max(0, Math.min(rows.length - 1, at + delta))]!.id);
  };
  const collapse = () => {
    if (open === null) return false;
    setExpanded(null);
    return true;
  };
  // The tab strip moves the rows, and collapses one, through this (WORK-1.7).
  useImperativeHandle(navRef, () => ({ move, collapse }));

  const send = (bot: BotView, what: 'run' | 'switch', call: () => Promise<unknown>, failed: string) => {
    if (busy || locked !== null) return;
    setBusy({ id: bot.id, what });
    setProblem(null);
    call()
      .catch((err: unknown) => setProblem(err instanceof Error ? err.message : failed))
      .finally(() => setBusy(null));
  };
  /** BOT-4.2: Run now, on or off, unless one of the Bot's runs is going. */
  const runNow = (bot: BotView) => {
    if (bot.running === null) send(bot, 'run', () => run(bot.id), `Couldn’t start a run of ${bot.name}.`);
  };
  /** BOT-2.5: off or on, and nothing else: a run that's going goes on, and Run now still works. */
  const toggle = (bot: BotView) => send(bot, 'switch', () => update(bot.id, { on: !bot.on }), `Couldn’t turn ${bot.name} ${bot.on ? 'off' : 'on'}.`);

  // The dialogs have no trigger, so closing one gives focus back to what had it when it opened (the
  // list, when More did), else to the list, never to the page, where j/k move the Session sidebar.
  const returnTo = useRef<Element | null>(null);
  const giveBack = (e: Event) => {
    e.preventDefault();
    const el = returnTo.current;
    (el instanceof HTMLElement && el.isConnected && el !== document.body ? el : list.current)?.focus();
  };
  /** BOT-2.1: New Bot (null) or Edit; the launcher's fields read Fleet's Harnesses as the launcher does when it opens. */
  const edit = (bot: BotView | null) => {
    if (locked !== null) return;
    returnTo.current = document.activeElement;
    onLoadHarnesses();
    setEditing({ bot });
  };
  const askDelete = (bot: BotView) => {
    if (locked !== null) return;
    returnTo.current = document.activeElement;
    setDeletingId(bot.id);
  };

  // BOT-1.4: ↑/↓ and j/k move through the rows; Enter, from the list, expands the selected row, and on
  // the expanded one runs its first button; Esc collapses it; X turns the selected Bot off or on.
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (!keyboardEnabled || e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
    // A dialog is portalled out of the panel, but React still bubbles its keys here.
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowDown' || k === 'j') {
      e.preventDefault(); // the Session sidebar's own ↑/↓ and j/k stay put
      move(1);
    } else if (e.key === 'ArrowUp' || k === 'k') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Escape') {
      if (collapse()) e.preventDefault();
    } else if (k === 'x' && active && !e.repeat) {
      e.preventDefault();
      toggle(active);
    } else if (e.key === 'Enter' && e.target === list.current && active && !e.repeat) {
      e.preventDefault();
      if (open !== active.id) expand(active.id);
      else runNow(active);
    }
  };

  const newBot = (
    // BOT-1.3: Secondary, with a plus; disabled, saying why, while nothing can be saved.
    <Button variant="secondary" size="default" onClick={() => edit(null)} disabled={!bots || locked !== null} title={locked ?? undefined} data-action="new-bot">
      <ActionIcon id="new-bot" />
      New Bot
    </Button>
  );

  return (
    // Named, as it holds focus while there's no list to focus.
    <section ref={root} role="group" aria-label="Bots" tabIndex={-1} className="relative flex min-h-0 flex-1 flex-col outline-none" data-testid="bots-panel" onKeyDown={onKey}>
      <div className="flex min-w-0 items-center gap-2 px-2.5 pt-2 pb-2">{newBot}</div>
      {/* BOT-2.3: a store that can't be read: what, why, and what puts it right. It's read again by itself. */}
      {bots?.state === 'unreadable' && (
        <Alert title={`Lookout can’t read ${bots.path}`} detail={bots.error} className="mx-2.5 mb-2" data-field="bots-unreadable">
          <p>It’s left as it is, and nothing is saved until it can be read. Put the file right, or move it away to start with no Bots: Lookout reads it again within a minute.</p>
        </Alert>
      )}
      {/* BOT-2.6: a second server shows the Bots and changes nothing. */}
      {/* BOT-2.6: another server runs them; or this one couldn't write the lock, and says so. */}
      {bots?.state === 'read-only' && <Alert tone={bots.error ? 'error' : 'info'} title={bots.error ?? BOTS_READ_ONLY} className="mx-2.5 mb-2" data-field="bots-read-only" />}
      {problem && <Alert layout="inline" title={problem} className="mx-2.5 mb-2" data-field="bots-problem" />}
      {!bots ? (
        <Loading label="Reading Bots…" className="items-center px-4 py-3" />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {/* BOT-1.3: with no Bot, what one is and the way to make one; a store that can't be read isn't empty. */}
          {rows.length === 0 && bots.state !== 'unreadable' && <EmptyState role="status" title="No Bots yet" hint="A Bot starts a Session on a schedule, and its Report arrives in the Inbox." action={newBot} />}
          <div
            ref={list}
            role="listbox"
            aria-label="Bots"
            tabIndex={0}
            aria-activedescendant={active ? rowId(active.id) : undefined}
            className="flex flex-col rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <RowSettling.Provider value={settling}>
              {rows.map((bot) => (
                <BotRow
                  key={bot.id}
                  bot={bot}
                  runs={runs}
                  sessions={sessions}
                  now={now}
                  harnesses={harnesses}
                  active={bot.id === active?.id}
                  expanded={bot.id === open}
                  locked={locked}
                  busy={busy === null ? null : busy.id === bot.id ? busy.what : 'other'}
                  onPress={(e) => {
                    if (open !== bot.id) settle(e);
                    expand(bot.id);
                    list.current?.focus();
                  }}
                  onRun={() => runNow(bot)}
                  onEdit={() => edit(bot)}
                  onToggle={() => toggle(bot)}
                  onDelete={() => askDelete(bot)}
                  onOpenRun={onOpenRun}
                />
              ))}
            </RowSettling.Provider>
          </div>
        </div>
      )}
      <BotDialog target={editing} settings={settings} harnesses={harnesses} create={create} update={update} onCreated={(bot) => setSelected(bot.id)} onClose={() => setEditing(null)} onCloseAutoFocus={giveBack} />
      <DeleteBotDialog bot={deleting} remove={remove} onClose={() => setDeletingId(null)} onCloseAutoFocus={giveBack} />
    </section>
  );
}

interface BotRowProps {
  bot: BotView;
  /** Every run the server keeps, newest first. */
  runs: readonly BotRun[];
  sessions: ReadonlyMap<string, SessionRow>;
  now: number;
  harnesses: HarnessState;
  active: boolean;
  expanded: boolean;
  /** Why nothing can be changed (BOT-2.3, BOT-2.6); null when it can. */
  locked: string | null;
  /** What's on its way to the server: this Bot's Run now or switch, another Bot's, or nothing. */
  busy: 'run' | 'switch' | 'other' | null;
  onPress(e: { detail: number }): void;
  onRun(): void;
  onEdit(): void;
  onToggle(): void;
  onDelete(): void;
  onOpenRun(run: BotRun): void;
}

/**
 * BOT-1.2: a Bot's row: its name with what its run is doing, or its "Off" chip, at the right; under
 * it its schedule in words (BOT-3.1) and its one other fact, "next Mon 07:30" or its last run's age.
 * A Bot that is off is dimmed. Expanded (BOT-1.5), it is built as DS-21 says, from `ui/row-details`.
 */
function BotRow({ bot, runs, sessions, now, harnesses, active, expanded, locked, busy, onPress, onRun, onEdit, onToggle, onDelete, onOpenRun }: BotRowProps) {
  const id = rowId(bot.id);
  const schedule = scheduleWords(bot.schedule);
  const fact = botFact(bot, runs, now);
  const going = fact?.kind === 'running' || fact?.kind === 'waiting';
  const next = bot.nextAt !== null ? `next ${dayTime(bot.nextAt, now)}` : null;
  const own = botRuns(bot, runs);
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-expanded={expanded}
      aria-label={[bot.name, schedule, fact?.words, !bot.on && 'off'].filter(Boolean).join(', ')}
      aria-describedby={expanded ? `${id}-details-state ${id}-details` : undefined}
      onClick={onPress}
      // DS-17.1: the line between rows starts at the name.
      data-slot="row"
      data-selected={active || undefined}
      data-field="bot"
      data-bot={bot.id}
      className={cn('flex min-w-0 cursor-default flex-col gap-0.5 rounded-md px-2 py-[7px] text-body [--row-inset:8px] hover:bg-sidebar-accent/60', active && 'bg-sidebar-accent', !bot.on && !expanded && 'opacity-60')}
    >
      <div className={cn('flex min-w-0 gap-1.5', expanded ? 'items-start' : 'items-center')}>
        <RowTitle expanded={expanded} className="flex-1 font-medium">
          {bot.name}
        </RowTitle>
        {/* BOT-1.2: "waiting on you" is Needs you's amber, with its words; "running" is quiet. */}
        {going && (
          <span className={cn('shrink-0 text-meta', fact.kind === 'waiting' ? 'text-needs-you-text' : 'text-muted-foreground')} data-field="fact" data-kind={fact.kind}>
            {fact.words}
          </span>
        )}
        {/* Expanded, the state line says On or Off. */}
        {!bot.on && !expanded && (
          <Chip tone="muted" data-field="off">
            Off
          </Chip>
        )}
      </div>
      {expanded ? (
        <RowDetails
          id={`${id}-details`}
          // BOT-1.5: on or off, its schedule, its next time (BOT-3.6).
          state={[bot.on ? 'On' : 'Off', schedule, next]}
          summary={<Summary bot={bot} harnesses={harnesses} />}
          links={[runLinks(own, sessions, now, onOpenRun)]}
          actions={
            // BOT-1.5: Run now is what Enter runs; Edit, the switch and Delete are under More, Delete in the danger role.
            <RowActions
              name={bot.name}
              primary={{
                'data-action': 'run-now',
                action: 'run-now',
                // BOT-4.2: disabled, and saying so, while one of the Bot's runs is going.
                ...(bot.running !== null ? { label: RUNNING } : busy === 'run' ? { label: 'Starting…' } : {}),
                tip: bot.running !== null ? RUNNING : (locked ?? 'Run now (Enter)'),
                enabled: bot.running === null && locked === null && busy === null,
                onPress: onRun,
              }}
              more={[
                { id: 'edit', action: 'edit', group: 'open', enabled: locked === null, onSelect: onEdit },
                // BOT-1.4: X runs it on the selected row, expanded or not.
                { id: bot.on ? 'turn-off' : 'turn-on', action: bot.on ? 'turn-off' : 'turn-on', group: 'manage', shortcut: 'X', enabled: locked === null && busy === null, onSelect: onToggle },
                { id: 'delete', action: 'delete', group: 'manage', destructive: true, enabled: locked === null, onSelect: onDelete },
              ]}
            />
          }
        />
      ) : (
        <p className="flex min-w-0 items-center gap-1 text-meta text-muted-foreground" data-field="second-line">
          <span className="min-w-0 truncate" data-field="schedule">
            {schedule}
          </span>
          {fact && !going && (
            <>
              <span aria-hidden className="shrink-0">
                ·
              </span>
              {fact.kind === 'failed' ? (
                // BOT-1.2: a failed last run has the warning triangle and its word, never colour alone.
                <span className="inline-flex shrink-0 items-center gap-1 text-destructive-text" data-field="fact" data-kind="failed">
                  <TriangleAlert aria-hidden className="size-3.5" />
                  {fact.words}
                </span>
              ) : (
                <span className="shrink-0" data-field="fact" data-kind={fact.kind}>
                  {fact.words}
                </span>
              )}
            </>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * BOT-1.5: the prompt's first three lines, the whole of it in its tooltip; where and with what the
 * Bot starts; and BOT-3.5's skipped times, until its next run starts.
 */
function Summary({ bot, harnesses }: { bot: BotView; harnesses: HarnessState }) {
  const harness = harnesses.state === 'ready' ? harnesses.harnesses.find((h) => h.id === bot.harness) : undefined;
  // The model as the launcher names it; its id until Fleet's list is read.
  const model = harness?.models.find((m) => m.id === bot.model)?.label ?? (bot.model || 'Default');
  const start = [bot.directory, harness?.label ?? HARNESS_NAME[bot.harness], model, bot.effort, bot.skipPermissions && 'skips permissions'].filter(Boolean).join(' · ');
  return (
    <>
      <p className="line-clamp-3 whitespace-pre-line text-foreground" title={bot.prompt} data-field="prompt">
        {bot.prompt}
      </p>
      <p className="truncate" title={start} data-field="start">
        {start}
      </p>
      {bot.skipped > 0 && <p data-field="skipped">{skippedWords(bot.skipped)}</p>}
    </>
  );
}

/**
 * BOT-1.5, DS-21.2: a Bot's newest runs as a count that lists them in place, each a line with its
 * state and when it started. A press opens its Report in the Inbox (INBOX-2.1), or its Session while
 * it's going; before Fleet reports the Session, its start, where a Trust prompt is answered (BOT-4.3).
 * A run with none of them is a line of text.
 */
function runLinks(runs: readonly BotRun[], sessions: ReadonlyMap<string, SessionRow>, now: number, onOpen: (run: BotRun) => void): RowLinkGroup {
  return {
    // A run is a Session a Bot started; the links' kinds have no other name for it.
    kind: 'runs',
    noun: ['run', 'runs'],
    items: runs.map((run) => {
      const session = inFlight(run) && run.sessionId !== null ? sessions.get(run.sessionId) : undefined;
      const word = RUN_WORD[run.state];
      const start = !session && run.launchId !== null;
      return {
        key: run.id,
        // A live Session's own Status marker (DS-5.1); else the run's state, a failure in the error's colour with its word.
        glyph: session ? (
          <SessionMarker aria-hidden="true" state="live" status={session.status} since={session.statusSince} />
        ) : run.state === 'failed' ? (
          <TriangleAlert aria-hidden className="text-destructive-text" />
        ) : run.state === 'finished' ? (
          <Check aria-hidden />
        ) : (
          <CircleDashed aria-hidden />
        ),
        name: word,
        state: dayTime(run.startedAt, now),
        label: session ? `Open ${run.name}, ${word}` : start ? `Open the start of ${run.name}, ${word}` : `Open the Report of ${run.name}, ${word}`,
        tip: run.failure ?? undefined,
        action: 'run',
        ...(session || start || run.arrivedAt !== null ? { onPress: () => onOpen(run) } : {}),
      };
    }),
  };
}
