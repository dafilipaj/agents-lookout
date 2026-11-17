import { type SetupItem, type SetupSnapshot, type SetupSwitchResult, pluginOf, skillSwitchable } from '@shared/setup.ts';
import { ChevronRight, CircleOff, Cloud, Package, Search, User } from 'lucide-react';
import { type CSSProperties, type KeyboardEvent, type ReactNode, type Ref, type RefObject, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/ui/details';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Hits } from '@/components/ui/hits';
import { RowSettling, useRowSettle } from '@/components/ui/icon-button';
import { Loading } from '@/components/ui/loading';
import { RowActions } from '@/components/ui/row-actions';
import { RowDetails, RowTitle } from '@/components/ui/row-details';
import { Segmented } from '@/components/ui/segmented';
import { ActionIcon } from '@/lib/actions';
import { vscodeHref } from '@/lib/files';
import { type PanelNav, focusTab } from '@/lib/right-sidebar';
import {
  HARNESS_NAME,
  OFF_REASON,
  SECTION_LABEL,
  SETUP_FILTERS,
  SETUP_FILTER_LABEL,
  type SetupFilter,
  type SetupGroup,
  type SetupSection,
  firstLine,
  matchRanges,
  offKey,
  pluginContents,
  setupSections,
  sourceLabel,
} from '@/lib/setup';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';

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
}

/** One selectable line of the list: a group's (or the off line's), or an item's row. */
type Entry = { type: 'group'; key: string } | { type: 'row'; key: string; item: SetupItem };

const domId = (key: string) => `setup-${encodeURIComponent(key)}`;
const GROUP_ICON = { yours: User, 'claude-ai': Cloud, plugin: Package } as const;
/** DS-17.1: the hairline between rows starts where a row's name does, under its group's name. */
const ROW_INSET = { '--row-inset': '48px' } as CSSProperties;

/** SETUP-4.3: what a switch says, in words. */
const switched = (what: string, on: boolean) =>
  on ? `Turned on ${what}. Sessions started from now on load it; running ones keep what they loaded.` : `Turned off ${what}. Sessions started from now on won’t load it; running ones keep what they loaded.`;

/**
 * SETUP: what Claude Code and Codex load for every Session, by kind, then by source, each source a
 * group that folds (canvas B). j/k and ↑/↓ move through group lines and rows; Enter opens a group,
 * expands a row, then opens it in VS Code.
 */
export function SetupPanel({ visible, focusKey, read, switchSkill, switchPlugin, filter, onFilter, open, onOpen, keyboardEnabled, navRef }: SetupPanelProps) {
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

  // SETUP-1.8: read when the tab comes into view; a late answer for an earlier view is dropped.
  const readSeq = useRef(0);
  const reader = useRef(read);
  useEffect(() => {
    reader.current = read;
  });
  useEffect(() => {
    if (!visible) return;
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
  }, [visible]);
  useEffect(() => {
    if (visible && focusKey) input.current?.focus();
  }, [focusKey, visible]);

  const sections = snapshot ? setupSections(snapshot, filter, q) : [];
  const isOpen = (key: string) => !!q || open.includes(key);
  const entries: Entry[] = sections.flatMap((s) => [
    ...s.groups.flatMap((g): Entry[] => [{ type: 'group', key: g.key }, ...(isOpen(g.key) ? g.rows.map((item): Entry => ({ type: 'row', key: item.key, item })) : [])]),
    ...(s.off.length ? [{ type: 'group', key: offKey(s.kind) } as Entry, ...(isOpen(offKey(s.kind)) ? s.off.map((item): Entry => ({ type: 'row', key: item.key, item })) : [])] : []),
  ]);
  const at = Math.max(0, entries.findIndex((e) => e.key === selected));
  const active = entries[at] ?? null;

  const toggle = (key: string, to?: boolean) => {
    if (q) return; // While filtering, every group with a match shows open (SETUP-1.4).
    const now = open.includes(key);
    const next = to ?? !now;
    if (next !== now) onOpen(next ? [...open, key] : open.filter((k) => k !== key));
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

  const openFile = (item: SetupItem) => window.open(vscodeHref(item.file, item.line, null), '_self');

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
  /** SETUP-4.5: what X runs on a row: its skill's switch, else its plugin's, else nothing. */
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
    } else if (k === 'x' && !text && active?.type === 'row' && !e.repeat) {
      e.preventDefault();
      if (!busy) switchKey(active.item);
    } else if (e.key === 'Enter' && (e.target === input.current || e.target === list.current) && active && !e.repeat) {
      e.preventDefault();
      setSelected(active.key);
      if (active.type === 'group') toggle(active.key);
      else if (expanded !== active.key) setExpanded(active.key);
      else openFile(active.item);
    }
  };

  const row = (item: SetupItem) => (
    <SetupRow
      key={item.key}
      item={item}
      query={q}
      active={active?.key === item.key}
      expanded={expanded === item.key}
      busy={busy}
      onPress={(e) => {
        settle(e);
        setSelected(item.key);
        setExpanded(item.key);
        list.current?.focus();
      }}
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

  return (
    <section className="relative flex min-h-0 flex-1 flex-col" data-testid="setup-panel" onKeyDown={onKey}>
      <div className="flex flex-col gap-2 border-b border-sidebar-border px-2.5 py-2">
        <Segmented label="Kind" surface="sidebar" fill choices={SETUP_FILTERS.map((f) => ({ id: f, label: SETUP_FILTER_LABEL[f] }))} value={filter} onChange={onFilter} />
        <label className="relative flex items-center">
          <Search aria-hidden className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
          <input
            ref={input}
            type="search"
            aria-label="Filter Setup"
            placeholder="Filter Setup"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 w-full min-w-0 rounded-md border border-input bg-background/60 pr-2 pl-7 text-body outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </label>
      </div>
      {notice && <Alert tone={notice.tone} layout="inline" title={notice.text} className="mx-2.5 mt-2" data-field="setup-notice" />}
      {readError && <Alert title="Couldn’t read the Setup" detail={readError} className="mx-2.5 my-3" />}
      {!snapshot && !readError ? (
        <Loading label="Reading skills, agents, hooks and MCP servers…" className="items-center px-4 py-3" />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {snapshot && q && sections.length === 0 && <EmptyState role="status" title={`Nothing matches “${q}”`} />}
          <div
            ref={list}
            role="listbox"
            aria-label="Setup"
            tabIndex={0}
            aria-activedescendant={active ? domId(active.key) : undefined}
            className="outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <RowSettling value={settling}>
              {sections.map((s) => (
                <Section key={s.kind} section={s} groupLine={groupLine} isOpen={isOpen} row={row} />
              ))}
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

/** SETUP-3.1: the expanded row's facts, by kind. */
function stateOf(item: SetupItem): string[] {
  const off = item.off ? [OFF_REASON[item.off]] : [];
  switch (item.kind) {
    case 'skill': {
      const s = item.source;
      return [s.type === 'plugin' ? [s.name, s.version].filter(Boolean).join(' ') : sourceLabel(s), HARNESS_NAME[item.harness], ...(item.listing ? [`${item.listing} in skillOverrides`] : []), ...off];
    }
    case 'agent':
      return [item.model ?? 'default model', ...(item.effort ? [`${item.effort} Effort`] : []), item.tools ? `${item.tools.length} ${item.tools.length === 1 ? 'tool' : 'tools'}` : 'all tools', ...off];
    case 'hook': {
      const ev = item.events ?? [];
      return [ev.length === 1 ? [ev[0]!.event, ev[0]!.matcher].filter((x) => x && x !== '*').join(' · ') : `${ev.length} events`, ...(item.timeout ? [`${item.timeout} s`] : []), ...off];
    }
    case 'mcp':
      return [item.transport ?? 'stdio', ...(item.env?.length ? [`${item.env.length} env ${item.env.length === 1 ? 'var' : 'vars'}`] : []), ...(item.headers?.length ? [`${item.headers.length} ${item.headers.length === 1 ? 'header' : 'headers'}`] : []), ...off];
  }
}

/** SETUP-3.1: what the state line's tooltip names, then the file. */
function tipOf(item: SetupItem): string {
  const where = `${item.file}${item.line ? `:${item.line}` : ''}`;
  const lines: string[] = [];
  if (item.kind === 'agent' && item.tools?.length) lines.push(`Tools: ${item.tools.join(', ')}`);
  if (item.kind === 'hook' && item.events?.length) lines.push(`Events: ${item.events.map((e) => (e.matcher && e.matcher !== '*' ? `${e.event} (${e.matcher})` : e.event)).join(', ')}`);
  if (item.kind === 'mcp' && item.env?.length) lines.push(`Environment: ${item.env.join(', ')}`);
  if (item.kind === 'mcp' && item.headers?.length) lines.push(`Headers: ${item.headers.join(', ')}`);
  return [...lines, where].join('\n');
}

function Hit({ text, query }: { text: string; query: string }) {
  return <Hits text={text} ranges={matchRanges(text, query)} tight />;
}

interface RowProps {
  item: SetupItem;
  query: string;
  active: boolean;
  expanded: boolean;
  busy: boolean;
  onPress(e: { detail: number }): void;
  onOpen(): void;
  onSkill(on: boolean): void;
  onPlugin(on: boolean): void;
}

/** SETUP-1.5: one line, its Harness, its name as it's called, its description's first line; expanded, SETUP-3. */
function SetupRow({ item, query, active, expanded, busy, onPress, onOpen, onSkill, onPlugin }: RowProps) {
  const id = domId(item.key);
  const plugin = pluginOf(item);
  const description = item.off ? [sourceLabel(item.source), OFF_REASON[item.off]].join(' · ') : firstLine(item.description);
  const offSkill = item.off === 'override' || item.off === 'override-missing';
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-expanded={expanded}
      aria-label={[item.name, firstLine(item.description), HARNESS_NAME[item.harness], item.off && `off, ${OFF_REASON[item.off]}`].filter(Boolean).join(', ')}
      aria-describedby={expanded ? `${id}-details-state ${id}-details` : undefined}
      onClick={onPress}
      data-slot="row"
      data-selected={active || undefined}
      data-field="item"
      data-kind={item.kind}
      style={ROW_INSET}
      className={cn('flex min-w-0 cursor-default flex-col gap-0.5 rounded-md py-[7px] pr-2 pl-7 text-body hover:bg-sidebar-accent/60', active && 'bg-sidebar-accent')}
    >
      <div className={cn('flex min-w-0 gap-1.5', expanded ? 'items-start' : 'items-center')}>
        <span className="flex h-5 shrink-0 items-center">
          <HarnessIcon harness={item.harness} />
        </span>
        <RowTitle expanded={expanded} className={cn('font-medium', expanded ? 'flex-1' : 'max-w-[62%] shrink-0')}>
          <Hit text={item.name} query={query} />
        </RowTitle>
        {!expanded && (
          <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground" data-field="description">
            <Hit text={description} query={item.off ? '' : query} />
          </span>
        )}
      </div>
      {expanded && (
        <RowDetails
          id={`${id}-details`}
          className="pl-5"
          state={stateOf(item)}
          stateTip={tipOf(item)}
          summary={<Summary item={item} query={query} />}
          links={[]}
          actions={
            // SETUP-3.2: Open in VS Code is what Enter runs; SETUP-4: the switches Claude Code has, under More.
            <RowActions
              name={item.name}
              primary={{ 'data-action': 'open-vscode', action: 'open-vscode', tip: 'Open in VS Code (Enter)', enabled: true, onPress: onOpen }}
              more={[
                // SETUP-4.5: X runs the first of them, the skill's own switch before its plugin's.
                skillSwitchable(item) && (offSkill ? { id: 'turn-on', action: 'turn-on', group: 'manage', shortcut: 'X', enabled: !busy, onSelect: () => onSkill(true) } : { id: 'turn-off', action: 'turn-off', group: 'manage', shortcut: 'X', enabled: !busy, onSelect: () => onSkill(false) }),
                plugin && (item.off === 'plugin'
                  ? { id: 'turn-on-plugin', action: 'turn-on', label: `Turn on plugin ${plugin.name}`, group: 'manage', ...(skillSwitchable(item) ? {} : { shortcut: 'X' }), enabled: !busy, onSelect: () => onPlugin(true) }
                  : { id: 'turn-off-plugin', action: 'turn-off', label: `Turn off plugin ${plugin.name}…`, group: 'manage', ...(skillSwitchable(item) ? {} : { shortcut: 'X' }), enabled: !busy, onSelect: () => onPlugin(false) }),
              ]}
            />
          }
        />
      )}
    </div>
  );
}

/** SETUP-3.1: at most three lines: a skill's call and description, a hook's command, a server's command or URL. */
function Summary({ item, query }: { item: SetupItem; query: string }) {
  const mono = 'font-mono break-all';
  if (item.kind === 'skill')
    return (
      <>
        {item.call && (
          <p className={cn(mono, 'truncate text-foreground')} title={item.call} data-field="call">
            {item.call}
          </p>
        )}
        {item.description && (
          <p className="line-clamp-2" title={item.description}>
            <Hit text={item.description} query={query} />
          </p>
        )}
      </>
    );
  if (item.kind === 'hook')
    return (
      <p className={cn(mono, 'line-clamp-3')} title={item.command} data-field="command">
        {item.command}
      </p>
    );
  if (item.kind === 'mcp')
    return (
      <p className={cn(mono, 'line-clamp-3')} data-field="command">
        {item.description}
      </p>
    );
  return item.description ? (
    <p className="line-clamp-3" title={item.description}>
      <Hit text={item.description} query={query} />
    </p>
  ) : null;
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

