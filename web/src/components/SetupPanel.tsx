import { type SessionSetup, type SetupItem, type SetupSnapshot, type SetupSwitchResult, pluginOf, skillSwitchable } from '@shared/setup.ts';
import { ChevronRight, CircleOff, Cloud, FolderGit2, Package, Search, User } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, type Ref, type RefObject, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/ui/details';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { RowSettling, useRowSettle } from '@/components/ui/icon-button';
import { Loading } from '@/components/ui/loading';
import { Segmented } from '@/components/ui/segmented';
import { ActionIcon } from '@/lib/actions';
import { clock } from '@/lib/evidence';
import { vscodeHref } from '@/lib/files';
import { type PanelNav, focusTab } from '@/lib/right-sidebar';
import {
  SECTION_LABEL,
  SETUP_FILTERS,
  SETUP_FILTER_LABEL,
  SETUP_VIEWS,
  SETUP_VIEW_LABEL,
  type SessionRow,
  type SetupFilter,
  type SetupGroup,
  type SetupSection,
  type SetupSessionTarget,
  type SetupView,
  domId,
  groupOpen,
  offKey,
  pluginContents,
  sessionSections,
  sessionUnavailable,
  setupSections,
} from '@/lib/setup';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';
import { SetupRow } from './SetupRow';
import { EVERYWHERE_LINE, SetupSession } from './SetupSession';

export interface SetupPanelProps {
  /** SETUP-1.8: the tab is showing; Setup is read each time it comes into view. */
  visible: boolean;
  /** Bumped to move focus into the filter (HIST-1.1). */
  focusKey: number;
  read(): Promise<SetupSnapshot>;
  switchSkill(name: string, on: boolean): Promise<SetupSwitchResult>;
  switchPlugin(id: string, on: boolean): Promise<SetupSwitchResult>;
  filter: SetupFilter;
  onFilter(filter: SetupFilter): void;
  /** SETUP-1.4: the open groups' keys, kept across reloads. */
  open: readonly string[];
  onOpen(open: string[]): void;
  keyboardEnabled: boolean;
  navRef?: Ref<PanelNav>;
  /** SETUP-6.1: Everywhere or This Session, kept across reloads. */
  view: SetupView;
  onView(view: SetupView): void;
  /** SETUP-6.1: the Session open in the main pane, which This Session follows; null with none. */
  session: SetupSessionTarget | null;
  readSession(sessionId: string): Promise<SessionSetup>;
  /** SETUP-6.4: bumped by the tab's Refresh, which reads the view that shows again. */
  refreshKey: number;
}

/** One selectable line of the list: a group's (or the off and not loaded lines), or a row. */
type Entry = { type: 'group'; key: string } | { type: 'row'; key: string; item: SetupItem | null; open: (() => void) | null };

const GROUP_ICON = { yours: User, 'claude-ai': Cloud, plugin: Package, repo: FolderGit2 } as const;

/** SETUP-4.3: what a switch says, in words. */
const switched = (what: string, on: boolean) =>
  on ? `Turned on ${what}. Sessions started from now on load it; running ones keep what they loaded.` : `Turned off ${what}. Sessions started from now on won’t load it; running ones keep what they loaded.`;

/**
 * SETUP: what Claude Code and Codex load for every Session, by kind, then by source, each source a
 * group that folds (canvas B); or, in This Session, what the open Session loaded and what ran in it
 * (slice 2, canvas A). j/k and ↑/↓ move through group lines and rows; Enter opens a group, expands
 * a row, then opens it in VS Code.
 */
export function SetupPanel({ visible, focusKey, read, switchSkill, switchPlugin, filter, onFilter, open, onOpen, keyboardEnabled, navRef, view, onView, session, readSession, refreshKey }: SetupPanelProps) {
  const [snapshot, setSnapshot] = useState<SetupSnapshot | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; name: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const { settling, settle } = useRowSettle();
  const q = query.trim();

  // SETUP-6.1: This Session follows the main pane's Session; with none, or a Codex one, the tab shows Everywhere.
  const unavailable = sessionUnavailable(session);
  const shown: SetupView = view === 'session' && !unavailable ? 'session' : 'everywhere';
  const sessionId = shown === 'session' ? session!.id : null;

  // SETUP-6.4: a live Session's turn ended (Busy to anything else) while This Session shows: read it again.
  const [turns, setTurns] = useState(0);
  const lastStatus = useRef<{ id: string | null; status: string | null }>({ id: null, status: null });
  useEffect(() => {
    const was = lastStatus.current;
    const status = session?.status ?? null;
    if (sessionId && was.id === sessionId && was.status === 'busy' && status !== 'busy') setTurns((n) => n + 1);
    lastStatus.current = { id: sessionId, status };
  }, [sessionId, session?.status]);

  // SETUP-1.8: read when the tab comes into view; a late answer for an earlier view is dropped.
  const readSeq = useRef(0);
  const reader = useRef(read);
  const sessionReader = useRef(readSession);
  useEffect(() => {
    reader.current = read;
    sessionReader.current = readSession;
  });
  useEffect(() => {
    if (!visible || shown !== 'everywhere') return;
    const mine = ++readSeq.current;
    reader.current().then(
      (s) => {
        if (readSeq.current !== mine) return;
        setSnapshot(s);
        setReadError(null);
      },
      (err: unknown) => {
        if (readSeq.current === mine) setReadError(err instanceof Error ? err.message : 'Couldn’t read the Setup.');
      },
    );
  }, [visible, shown, refreshKey]);

  // SETUP-6.4: This Session is read when it's chosen, when another Session opens, on Refresh and when a turn ends.
  const [sessionData, setSessionData] = useState<SessionSetup | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const sessionSeq = useRef(0);
  useEffect(() => {
    if (!visible || !sessionId) return;
    const mine = ++sessionSeq.current;
    sessionReader.current(sessionId).then(
      (s) => {
        if (sessionSeq.current !== mine) return;
        setSessionData(s);
        setSessionError(null);
      },
      (err: unknown) => {
        if (sessionSeq.current === mine) setSessionError(err instanceof Error ? err.message : 'Couldn’t read what the Session loaded.');
      },
    );
  }, [visible, sessionId, refreshKey, turns]);
  // Another Session's answer never shows under this one's line.
  const data = sessionData && sessionData.sessionId === sessionId ? sessionData : null;

  useEffect(() => {
    if (visible && focusKey) input.current?.focus();
  }, [focusKey, visible]);

  const sections = snapshot ? setupSections(snapshot, filter, q) : [];
  const sessionModel = data ? sessionSections(data, q) : [];
  const isOpen = (key: string) => (key.startsWith('session:') ? groupOpen(key, open, q) : !!q || open.includes(key));
  const openPath = (file: string, line: number | null) => window.open(vscodeHref(file, line, null), '_self');
  const openFile = (item: SetupItem) => openPath(item.file, item.line);

  const sessionEntry = (r: SessionRow): Entry => {
    if (r.type === 'file') return { type: 'row', key: r.key, item: null, open: r.file.disk === 'gone' ? null : () => openPath(r.file.path, null) };
    if (r.type === 'memory') return { type: 'row', key: r.key, item: null, open: () => openPath(r.entry.file, null) };
    const item = r.type === 'ran' ? r.ran.item : r.item;
    return { type: 'row', key: r.key, item: null, open: item ? () => openFile(item) : null };
  };
  const entries: Entry[] =
    shown === 'session'
      ? sessionModel.flatMap((s) => [
          ...s.groups.flatMap((g): Entry[] => [{ type: 'group', key: g.key }, ...(isOpen(g.key) ? g.rows.map(sessionEntry) : [])]),
          ...s.kinds.flatMap((k) => k.rows.map(sessionEntry)),
          ...s.rows.map(sessionEntry),
          ...(s.notLoaded.length ? [{ type: 'group', key: 'session:not-loaded' } as Entry, ...(isOpen('session:not-loaded') ? s.notLoaded.map(sessionEntry) : [])] : []),
        ]).concat(data && !q && !data.errors.some((e) => e.where === 'transcript') ? [{ type: 'row', key: EVERYWHERE_LINE, item: null, open: () => onView('everywhere') }] : [])
      : sections.flatMap((s) => [
          ...s.groups.flatMap((g): Entry[] => [{ type: 'group', key: g.key }, ...(isOpen(g.key) ? g.rows.map((item): Entry => ({ type: 'row', key: item.key, item, open: () => openFile(item) })) : [])]),
          ...(s.off.length ? [{ type: 'group', key: offKey(s.kind) } as Entry, ...(isOpen(offKey(s.kind)) ? s.off.map((item): Entry => ({ type: 'row', key: item.key, item, open: () => openFile(item) })) : [])] : []),
        ]);
  const at = Math.max(0, entries.findIndex((e) => e.key === selected));
  const active = entries[at] ?? null;

  const toggle = (key: string, to?: boolean) => {
    if (q) return; // While filtering, every group with a match shows open (SETUP-1.4).
    const now = isOpen(key);
    const next = to ?? !now;
    if (next === now) return;
    // `open` holds what's toggled from how a group starts: folded in Everywhere, a file group open in This Session.
    onOpen(open.includes(key) ? open.filter((k) => k !== key) : [...open, key]);
  };
  const select = (key: string) => {
    if (key !== selected) setExpanded(null);
    setSelected(key);
    document.getElementById(domId(key))?.scrollIntoView?.({ block: 'nearest' });
  };
  const move = (delta: number) => {
    const next = entries[Math.max(0, Math.min(entries.length - 1, at + delta))];
    if (next) select(next.key);
  };
  const collapse = () => {
    if (!expanded) return false;
    setExpanded(null);
    return true;
  };
  useImperativeHandle(navRef, () => ({ move, collapse }));

  const run = async (what: string, on: boolean, call: () => Promise<SetupSwitchResult>) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const { snapshot: next } = await call();
      readSeq.current++;
      setSnapshot(next);
      setNotice({ tone: 'info', text: switched(what, on) });
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : `Couldn’t turn ${on ? 'on' : 'off'} ${what}.` });
    } finally {
      setBusy(false);
    }
  };
  const turnSkill = (item: SetupItem, on: boolean) => void run(item.name, on, () => switchSkill(on ? (item.overrideKey ?? item.name) : item.name, on));
  const turnPlugin = (id: string, name: string, on: boolean) => void run(`plugin ${name}`, on, () => switchPlugin(id, on));
  const pluginSwitch = (item: SetupItem, on: boolean) => {
    const p = pluginOf(item)!;
    if (on) turnPlugin(p.id, p.name, true);
    else setConfirming({ id: p.id, name: p.name });
  };
  /** SETUP-4.5: what X runs on a row: its skill's switch, else its plugin's, else nothing; This Session has none (SETUP-9.3). */
  const switchKey = (item: SetupItem) => {
    if (skillSwitchable(item)) turnSkill(item, item.off === 'override' || item.off === 'override-missing');
    else if (pluginOf(item)) pluginSwitch(item, item.off === 'plugin');
  };

  const onKey = (e: KeyboardEvent) => {
    if (!keyboardEnabled || e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
    // The plugin confirmation is portalled out of the panel, but React still bubbles its keys here.
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
    const text = e.target instanceof HTMLElement && (e.target.matches('input,textarea,select') || e.target.isContentEditable);
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowDown' || (!text && k === 'j')) {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp' || (!text && k === 'k')) {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Escape') {
      if (collapse()) e.preventDefault();
      else if (e.target === input.current && !query) {
        e.preventDefault();
        focusTab('setup');
      }
    } else if (e.target === list.current && active?.type === 'group' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      toggle(active.key, e.key === 'ArrowRight');
    } else if (k === 'x' && !text && active?.type === 'row' && active.item && !e.repeat) {
      e.preventDefault();
      if (!busy) switchKey(active.item);
    } else if (e.key === 'Enter' && (e.target === input.current || e.target === list.current) && active && !e.repeat) {
      e.preventDefault();
      setSelected(active.key);
      if (active.type === 'group') toggle(active.key);
      else if (active.key === EVERYWHERE_LINE) active.open?.();
      else if (expanded !== active.key) setExpanded(active.key);
      else active.open?.();
    }
  };

  const press = (key: string, e: { detail: number }) => {
    settle(e);
    setSelected(key);
    setExpanded(key);
    list.current?.focus();
  };
  const row = (item: SetupItem) => (
    <SetupRow
      key={item.key}
      item={item}
      query={q}
      active={active?.key === item.key}
      expanded={expanded === item.key}
      busy={busy}
      onPress={(e) => press(item.key, e)}
      onOpen={() => openFile(item)}
      onSkill={(on) => turnSkill(item, on)}
      onPlugin={(on) => pluginSwitch(item, on)}
    />
  );
  const groupLine = (key: string, body: ReactNode, label: string) => (
    <div
      key={key}
      id={domId(key)}
      role="option"
      aria-selected={active?.key === key}
      aria-expanded={isOpen(key)}
      aria-label={label}
      data-field="group"
      data-key={key}
      onClick={() => {
        setSelected(key);
        toggle(key);
        list.current?.focus();
      }}
      className={cn('mt-1 flex h-8 min-w-0 cursor-default items-center gap-1.5 rounded-md px-2 text-body font-medium hover:bg-sidebar-accent/60', active?.key === key && 'bg-sidebar-accent')}
    >
      <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', isOpen(key) && 'rotate-90')} />
      {body}
    </div>
  );

  const loading = shown === 'session' ? !data && !sessionError : !snapshot && !readError;
  const title = session?.title || data?.title || 'Untitled Session';
  return (
    <section className="relative flex min-h-0 flex-1 flex-col" data-testid="setup-panel" data-view={shown} onKeyDown={onKey}>
      <div className="flex flex-col gap-2 border-b border-sidebar-border px-2.5 py-2">
        {/* SETUP-6.1: Everywhere or This Session; This Session disabled, saying why, with no Claude Code Session open. */}
        <Segmented
          label="Show"
          surface="sidebar"
          fill
          choices={SETUP_VIEWS.map((v) => ({ id: v, label: SETUP_VIEW_LABEL[v], ...(v === 'session' && unavailable ? { disabled: true, tooltip: unavailable } : {}) }))}
          value={shown}
          onChange={onView}
        />
        {shown === 'session' && session ? (
          // SETUP-6.2: the Session's line, in place of the kind filter.
          <div className="flex min-w-0 flex-col" data-field="session-line">
            <div className="flex min-w-0 items-center gap-1.5">
              <HarnessIcon harness={session.harness} />
              <span className="min-w-0 truncate text-body font-medium" title={title}>
                {title}
              </span>
            </div>
            {data && (data.directoryShown || data.loadedAt) && (
              <p className="truncate pl-5 text-meta text-muted-foreground" data-field="loaded">
                {[data.directoryShown, data.loadedAt ? `as it loaded at ${clock(data.loadedAt)}` : null].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        ) : (
          <Segmented label="Kind" surface="sidebar" fill choices={SETUP_FILTERS.map((f) => ({ id: f, label: SETUP_FILTER_LABEL[f] }))} value={filter} onChange={onFilter} />
        )}
        <label className="relative flex items-center">
          <Search aria-hidden className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
          <input
            ref={input}
            type="search"
            aria-label={shown === 'session' ? 'Filter this Session’s Setup' : 'Filter Setup'}
            placeholder={shown === 'session' ? 'Filter this Session’s Setup' : 'Filter Setup'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 w-full min-w-0 rounded-md border border-input bg-background/60 pr-2 pl-7 text-body outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </label>
      </div>
      {shown === 'everywhere' && notice && <Alert tone={notice.tone} layout="inline" title={notice.text} className="mx-2.5 mt-2" data-field="setup-notice" />}
      {shown === 'everywhere' && readError && <Alert title="Couldn’t read the Setup" detail={readError} className="mx-2.5 my-3" />}
      {shown === 'session' && sessionError && <Alert title="Couldn’t read what the Session loaded" detail={sessionError} className="mx-2.5 my-3" />}
      {loading ? (
        <Loading label={shown === 'session' ? 'Reading what the Session loaded…' : 'Reading skills, agents, hooks and MCP servers…'} className="items-center px-4 py-3" />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {shown === 'everywhere' && snapshot && q && sections.length === 0 && <EmptyState role="status" title={`Nothing matches “${q}”`} />}
          {shown === 'session' && data && q && sessionModel.length === 0 && <EmptyState role="status" title={`Nothing matches “${q}”`} />}
          <div
            ref={list}
            role="listbox"
            aria-label={shown === 'session' ? 'This Session’s Setup' : 'Setup'}
            tabIndex={0}
            aria-activedescendant={active ? domId(active.key) : undefined}
            className="outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <RowSettling value={settling}>
              {shown === 'session'
                ? data && (
                    <SetupSession
                      data={data}
                      sections={sessionModel}
                      query={q}
                      active={active?.key ?? null}
                      expanded={expanded}
                      isOpen={isOpen}
                      groupLine={groupLine}
                      onPress={press}
                      onOpenFile={openPath}
                      onEverywhere={() => onView('everywhere')}
                    />
                  )
                : sections.map((s) => <Section key={s.kind} section={s} groupLine={groupLine} isOpen={isOpen} row={row} />)}
            </RowSettling>
          </div>
        </div>
      )}
      <PluginDialog
        plugin={confirming}
        contents={confirming && snapshot ? pluginContents(snapshot, confirming.id) : ''}
        onConfirm={() => {
          if (confirming) turnPlugin(confirming.id, confirming.name, false);
          setConfirming(null);
        }}
        onClose={() => setConfirming(null)}
        returnFocus={list}
      />
    </section>
  );
}

/** SETUP-1.2, 1.3, 1.7, 5.1: a kind's label and count, its note, its errors, its groups, its off line. */
function Section({ section: s, groupLine, isOpen, row }: { section: SetupSection; groupLine(key: string, body: ReactNode, label: string): ReactNode; isOpen(key: string): boolean; row(item: SetupItem): ReactNode }) {
  const labelId = `setup-section-${s.kind}`;
  return (
    <div role="group" aria-labelledby={labelId} data-kind={s.kind} className="flex flex-col">
      <div role="presentation" className="px-2 pt-3 pb-1">
        <SectionLabel as="p" note={s.count}>
          <span id={labelId}>{SECTION_LABEL[s.kind]}</span>
        </SectionLabel>
      </div>
      {(s.kind === 'skill' || s.kind === 'agent') && (
        <p role="presentation" className="px-2 pb-1 text-meta text-muted-foreground" data-field="built-in">
          Plus the ones built into Claude Code, which Lookout can’t read.
        </p>
      )}
      {s.errors.map((e) => (
        <Alert key={e.file} layout="inline" title={`Couldn’t read ${e.file}: ${e.error}`} className="mx-2 my-1" data-field="setup-error" />
      ))}
      {s.groups.map((g) => (
        <GroupRows key={g.key} group={g} line={groupLine(g.key, <GroupBody group={g} />, `${g.label}, ${g.rows.length}${g.version ? `, ${g.version}` : ''}`)} open={isOpen(g.key)} row={row} />
      ))}
      {s.off.length > 0 && (
        <>
          {groupLine(
            offKey(s.kind),
            <>
              <CircleOff aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{s.off.length} off</span>
            </>,
            `${s.off.length} off`,
          )}
          {isOpen(offKey(s.kind)) && (
            <div role="presentation" className="flex flex-col opacity-60" data-field="off-rows">
              {s.off.map(row)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GroupRows({ line, open, group, row }: { line: ReactNode; open: boolean; group: SetupGroup; row(item: SetupItem): ReactNode }) {
  return (
    <>
      {line}
      {open && (
        <div role="presentation" className="flex flex-col" data-field="group-rows" data-group={group.key}>
          {group.rows.map(row)}
        </div>
      )}
    </>
  );
}

/** SETUP-1.3: the source's icon, its name, its count, a plugin's version at the right. */
function GroupBody({ group: g }: { group: SetupGroup }) {
  const Icon = GROUP_ICON[g.source.type];
  return (
    <>
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{g.label}</span>
      <span className="shrink-0 font-normal text-muted-foreground tabular-nums">{g.rows.length}</span>
      {g.version && <span className="ml-auto shrink-0 text-meta font-normal text-muted-foreground tabular-nums">{g.version}</span>}
    </>
  );
}

/** SETUP-4.2: turning a plugin off asks first, as Stop does (PORTS-4.6), saying what it turns off. */
function PluginDialog({ plugin, contents, onConfirm, onClose, returnFocus }: { plugin: { id: string; name: string } | null; contents: string; onConfirm(): void; onClose(): void; returnFocus: RefObject<HTMLElement | null> }) {
  return (
    <Dialog open={plugin !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        {plugin && (
          <>
            <DialogTitle className="text-title">Turn off plugin {plugin.name}?</DialogTitle>
            <DialogDescription className="text-body leading-5">
              It turns off {contents}, for Sessions started from now on. Running Sessions keep what they loaded. Lookout runs claude plugin disable {plugin.id}.
            </DialogDescription>
            <DialogFooter>
              <Button variant="secondary" size="form" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" size="form" onClick={onConfirm}>
                <ActionIcon id="turn-off" />
                Turn off
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

