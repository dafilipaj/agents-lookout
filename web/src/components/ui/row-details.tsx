import { ChevronRight } from 'lucide-react';
import { Fragment, type KeyboardEvent, type MouseEvent, type ReactNode, useContext, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { IconButton, RowSettling } from '@/components/ui/icon-button';
import { ActionIcon, type ActionId, actionWord } from '@/lib/actions';
import { cn } from '@/lib/utils';

/**
 * DS-21.1: a row's title, whole when the row is expanded (wrapped, never cut), cut to one line when
 * it isn't. The row keeps its own leading icon and what sits beside the title.
 */
export function RowTitle({ expanded, className, children, ...rest }: { expanded: boolean; className?: string; children: ReactNode; title?: string }) {
  return (
    <span data-field="title" className={cn('min-w-0', expanded ? 'break-words whitespace-normal' : 'truncate', className)} {...rest}>
      {children}
    </span>
  );
}

/**
 * DS-21.2: an item waiting on you, a Topic's recommendation (TOPIC-9.4): why, under its name, and
 * what you can do with it.
 */
export interface RowLinkDecision {
  /** Its reason, in `meta`, cut to its line; the whole in its hover. */
  why: string;
  /** Its one action, a Secondary `line` button: the row's Soft action stays its only one (DS-18.4). */
  primary: { action: ActionId; label?: string; onPress(): void };
  /** The rest, under a More of its own. */
  more: readonly { id: string; action: ActionId; label?: string; onSelect(): void }[];
}

/** DS-21.2: one link of a row: a Session, a PR, a Task or a Topic, or an item waiting on you. */
export interface RowLink {
  key: string;
  /** A Session's Status marker (DS-5.1), or the kind's icon. */
  glyph: ReactNode;
  name: string;
  /** Its state at the end, in `meta`: "live", its age, "past", "wrote it". */
  state?: ReactNode;
  /** A button's accessible name, saying what a press does: "Open fix-rounding, Busy". */
  label: string;
  /** Its hover: a Link's reason, a source. */
  tip?: string;
  /** What a press does; without it the line is text, not a button (a pruned Session). */
  onPress?(): void;
  /** False while it can't act (a resume under way). */
  enabled?: boolean;
  /** Its `data-action` (`session` for a Session, as WORK-4.10's chip had). */
  action?: string;
  sessionId?: string;
  topicId?: string;
  /** An item waiting on you: its line puts its reason and actions under its name. */
  decide?: RowLinkDecision;
}

/** DS-21.2: the links of one kind, as a count: "3 Sessions". */
export interface RowLinkGroup {
  kind: 'sessions' | 'prs' | 'tasks' | 'topics' | 'recommended' | 'runs';
  /** The noun, one and many: ["Session", "Sessions"]. */
  noun: readonly [string, string];
  items: readonly RowLink[];
  /** Items waiting on you: open when the row expands, however many it holds. */
  eager?: boolean;
}

/** DS-21.2: an open count lists this many lines, then "Show all N". */
export const LINKS_SHOWN = 3;

/**
 * A press on a part of an expanded row: never the row's (WORK-1.12), not the second click of a
 * double click, and not while the row a click just expanded settles (ROW_SETTLE_MS). In a list whose
 * rows aren't listbox options (`focusable`, TOPIC-3.4), Enter and Space press it too.
 */
function usePress(run: (() => void) | undefined, focusable: boolean, enabled = true) {
  const settling = useContext(RowSettling);
  const able = enabled && !settling;
  return {
    'aria-disabled': able ? undefined : true,
    tabIndex: focusable ? 0 : undefined,
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      if (able && e.detail <= 1) run?.();
    },
    onKeyDown: focusable
      ? (e: KeyboardEvent) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          e.stopPropagation();
          if (able) run?.();
        }
      : undefined,
  };
}

/**
 * DS-21.2: one link's line, the same in every row: its marker or icon, its name, its state at the
 * end. A press does what WORK-4.10's chip did, with the same accessible name and hover.
 */
export function LinkLine({ link, focusable = false }: { link: RowLink; focusable?: boolean }) {
  if (link.decide) return <DecisionLine link={link} decide={link.decide} focusable={focusable} />;
  return <PlainLine link={link} focusable={focusable} />;
}

function PlainLine({ link, focusable }: { link: RowLink; focusable: boolean }) {
  const press = usePress(link.onPress, focusable, link.enabled !== false);
  const body = (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5">{link.glyph}</span>
      <span className="min-w-0 flex-1 truncate">{link.name}</span>
      {link.state && <span className="shrink-0 text-meta text-muted-foreground">{link.state}</span>}
    </>
  );
  const data = { 'data-field': 'link', 'data-action': link.action, 'data-session-id': link.sessionId, 'data-topic-id': link.topicId };
  if (!link.onPress)
    return (
      <span {...data} title={link.tip} className="flex h-6 min-w-0 items-center gap-1.5 px-1 text-body text-muted-foreground">
        {body}
      </span>
    );
  return (
    <span
      role="button"
      {...data}
      {...press}
      title={link.tip}
      aria-label={link.label}
      className={cn(
        'flex h-6 min-w-0 items-center gap-1.5 rounded px-1 text-body outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring/50',
        press['aria-disabled'] ? 'cursor-default' : 'cursor-pointer',
        link.enabled === false && 'opacity-50',
      )}
    >
      {body}
    </span>
  );
}

/**
 * DS-21.2: an item waiting on you: its marks and name, then its reason with its one action, a
 * Secondary `line` button, and a More of its own. Its presses are its own, never the row's.
 */
function DecisionLine({ link, decide, focusable }: { link: RowLink; decide: RowLinkDecision; focusable: boolean }) {
  const settling = useContext(RowSettling);
  const off = settling || link.enabled === false;
  const tab = focusable ? undefined : -1;
  const own = (e: { stopPropagation(): void }) => e.stopPropagation();
  // As RowActions' home(): focus is on More before an item acts, so a dialog the item opens (the
  // Topic picker) has a place to give it back to once the menu and its items are gone.
  const moreRef = useRef<HTMLButtonElement>(null);
  return (
    <div role="group" aria-label={link.label} data-field="link" data-decide="" className={cn('flex min-w-0 flex-col py-0.5', link.enabled === false && 'opacity-50')}>
      <span className="flex h-6 min-w-0 items-center gap-1.5 px-1 text-body" title={link.tip}>
        <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5">{link.glyph}</span>
        <span className="min-w-0 flex-1 truncate" data-field="item">
          {link.name}
        </span>
        {link.state && <span className="shrink-0 text-meta text-muted-foreground">{link.state}</span>}
      </span>
      <span className="flex min-w-0 items-center gap-1 pr-1 pl-6">
        <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground" title={decide.why} data-field="reason">
          {decide.why}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="line"
          tabIndex={tab}
          disabled={off}
          data-action={decide.primary.action}
          onClick={(e) => {
            own(e);
            if (e.detail <= 1) decide.primary.onPress();
          }}
        >
          <ActionIcon id={decide.primary.action} />
          {decide.primary.label ?? actionWord(decide.primary.action)}
        </Button>
        {decide.more.length > 0 && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <IconButton ref={moreRef} size="sm" label={`More for ${link.name}`} tip={actionWord('more')} tabIndex={tab} disabled={off} data-action="more" onClick={own}>
                <ActionIcon id="more" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-44 [&_svg:not([class*='size-'])]:size-4"
              data-slot="row-menu"
              onClick={own}
              onKeyDown={own}
              onCloseAutoFocus={(e) => {
                // Back to More, unless focus went on to another control (the picker's filter).
                e.preventDefault();
                const now = document.activeElement;
                if (!now || now === document.body || !now.isConnected || !!now.closest('[data-slot="row-menu"]')) moreRef.current?.focus();
              }}
            >
              {decide.more.map((m) => (
                <DropdownMenuItem
                  key={m.id}
                  data-action={m.id}
                  onSelect={() => {
                    moreRef.current?.focus();
                    m.onSelect();
                  }}
                >
                  <ActionIcon id={m.action} />
                  <span className="min-w-0 truncate">{m.label ?? actionWord(m.action)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </span>
    </div>
  );
}

/** "3 Sessions", "1 PR". */
export const countWords = (n: number, [one, many]: readonly [string, string]) => `${n} ${n === 1 ? one : many}`;

function Count({ group, open, focusable, onToggle }: { group: RowLinkGroup; open: boolean; focusable: boolean; onToggle(): void }) {
  const press = usePress(onToggle, focusable);
  return (
    <span
      role="button"
      {...press}
      aria-expanded={open}
      data-field="count"
      data-kind={group.kind}
      className={cn(
        'inline-flex h-6 shrink-0 cursor-pointer items-center gap-0.5 rounded pr-1.5 pl-0.5 text-meta text-foreground outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring/50',
        open && 'bg-foreground/5 font-medium',
      )}
    >
      <ChevronRight aria-hidden className={cn('size-3.5 text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-90')} />
      {countWords(group.items.length, group.noun)}
    </span>
  );
}

/**
 * DS-21.2: a row's links as counts on one line, each a disclosure. A count of items waiting on you
 * (`eager`) is open when the row expands; else the first is, if it holds LINKS_SHOWN or fewer.
 * Opening one closes the other. An open one lists its links in place, LINKS_SHOWN of them, then
 * "Show all N".
 */
export function RowLinks({ groups, focusable = false }: { groups: readonly RowLinkGroup[]; focusable?: boolean }) {
  const shown = groups.filter((g) => g.items.length > 0);
  const first = shown[0];
  // Until a count is pressed, the first is open when it holds LINKS_SHOWN or fewer, so links that
  // arrive after the row expands (Topics read, a Session linked by a poll) open it too.
  const [picked, setPicked] = useState<{ kind: RowLinkGroup['kind'] | null } | null>(null);
  // Once open on its own, it stays open as it grows past LINKS_SHOWN: no list closes under the pointer.
  const [auto, setAuto] = useState<RowLinkGroup['kind'] | null>(null);
  const eager = shown.find((g) => g.eager);
  const derived = eager ? eager.kind : first && first.items.length <= LINKS_SHOWN ? first.kind : null;
  // One that opened on its own and has gone (the last recommendation accepted) gives way to the rule.
  const live = auto !== null && shown.some((g) => g.kind === auto) ? auto : null;
  if (!picked && !live && derived && derived !== auto) setAuto(derived);
  const open = picked ? picked.kind : (live ?? derived);
  const [all, setAll] = useState(false);
  const showAll = usePress(() => setAll(true), focusable);
  if (!shown.length) return null;
  const list = shown.find((g) => g.kind === open);
  const lines = list ? (all ? list.items : list.items.slice(0, LINKS_SHOWN)) : [];
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-field="links">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {shown.map((g) => (
          <Count
            key={g.kind}
            group={g}
            open={g.kind === open}
            focusable={focusable}
            onToggle={() => {
              setPicked({ kind: g.kind === open ? null : g.kind });
              setAll(false);
            }}
          />
        ))}
      </div>
      {list && (
        <div className="flex min-w-0 flex-col" data-field="link-list" data-kind={list.kind}>
          {lines.map((l) => (
            <LinkLine key={l.key} link={l} focusable={focusable} />
          ))}
          {list.items.length > lines.length && (
            <span role="button" {...showAll} data-field="show-all" className="flex h-6 cursor-pointer items-center self-start rounded px-1 text-meta text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
              Show all {list.items.length}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export interface RowDetailsProps {
  /** The id a screen reader reaches the summary, links and actions by (the row's `aria-describedby`); the state line's is `<id>-state`. */
  id: string;
  /** The kind's facts, joined by " · "; a falsy one is left out. */
  state: readonly ReactNode[];
  /** DS-21.3: facts you rarely need, as the state line's tooltip (dates, a full path). */
  stateTip?: string;
  /** At most three lines of the kind's own text; left out when it has none. */
  summary?: ReactNode;
  links: readonly RowLinkGroup[];
  /** The row's `RowActions` (DS-16), always last. */
  actions: ReactNode;
  /** In a list whose rows aren't listbox options (TOPIC-3.4): the counts and lines are in the Tab order. */
  focusable?: boolean;
  /**
   * Hidden from screen readers, heard only as the row's description (`aria-describedby`): Work's and
   * History's rows, whose keys reach every action (WORK-1.13, HIST-3.2).
   */
  described?: boolean;
  className?: string;
}

/**
 * DS-21.1: what an expanded row shows under its title, in one order: its state, one line in `meta`;
 * its summary; its links (DS-21.2); its actions last. No part has a label in a column beside it. The
 * state is part of the row's name; the rest, when `described`, its description.
 */
export function RowDetails({ id, state, stateTip, summary, links, actions, focusable = false, described = false, className }: RowDetailsProps) {
  const facts = state.filter((f) => f !== null && f !== undefined && f !== false && f !== '');
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)} data-slot="row-details">
      {facts.length > 0 && (
        <p id={`${id}-state`} className="flex min-w-0 items-center gap-1 overflow-hidden text-meta whitespace-nowrap text-muted-foreground" title={stateTip} data-field="state">
          {facts.map((f, i) => (
            // Fragments, not a wrapper: the spaces stay beside the facts in the row's accessible name.
            <Fragment key={i}>
              {i > 0 && (
                <>
                  {' '}
                  <span aria-hidden>·</span>{' '}
                </>
              )}
              {typeof f === 'string' ? <span className="min-w-0 truncate">{f}</span> : f}
            </Fragment>
          ))}
        </p>
      )}
      <div id={id} aria-hidden={described || undefined} className="flex min-w-0 flex-col gap-1.5" data-field="details">
        {summary && (
          <div className="flex min-w-0 flex-col gap-1 text-meta text-muted-foreground" data-field="row-summary">
            {summary}
          </div>
        )}
        <RowLinks groups={links} focusable={focusable} />
        {actions}
      </div>
    </div>
  );
}
