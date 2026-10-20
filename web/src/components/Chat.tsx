import type { ChatEntry, ChatPage, Harness } from '@shared/types.ts';
import { ArrowDown, ChevronRight, CircleHelp, FileX, MessagesSquare, Wrench } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, type ReactNode, memo, useCallback, useContext, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/ui/button';
import { AnswerContext } from '@/lib/answers';
import { type ChatItem, type QuestionEntry, type ToolCall, answerFor, chatItems, clockTime, toolsLabel } from '@/lib/chat';
import { type Echo, IN_TERMINAL, NOT_TAKEN, NO_ECHOES, isCommand } from '@/lib/echoes';
import { FileLinksContext, SessionFilesContext } from '@/lib/files';
import { linkify } from '@/lib/links';
import { JUMP_MARGIN_PX, chatMarks, firstLine, stepMark } from '@/lib/marks';
import { HARNESS_NAME } from '@/lib/sessions';
import type { Chat as ChatState } from '@/lib/store';
import { cn } from '@/lib/utils';
import { AnswerInTerminal, ChoiceIcon, QuestionForm, TerminalNote } from './Answering';
import { ChatRail, MarkShape } from './ChatRail';
import { LinkedText } from './FilePath';
import { Markdown } from './Markdown';

/** At most this far from the bottom still counts as "at the bottom" (VIEW-1.5). */
const BOTTOM_SLACK_PX = 48;
const NONE: readonly ChatEntry[] = [];
/** VIEW-1.13: a message you sent, as the chat shows it: waiting for its copy, or lost. */
type ChatEcho = Pick<Echo, 'id' | 'text' | 'state'>;
/** Keys that scroll the chat when focus is in it, or on the page: pressing one releases a jump's hold (VIEW-1.11). */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
/**
 * A row cut to one line with an ellipsis. While a link in it has keyboard focus it shows whole, so
 * Tab to a link past the ellipsis doesn't scroll the row sideways for good (VIEW-1.12). Not on a
 * click, which focuses the link too: the row would rewrap under the pointer.
 */
const TRUNCATED = 'min-w-0 truncate has-focus-visible:whitespace-normal has-focus-visible:break-words';

export interface ChatProps {
  sessionId: string;
  harness: Harness;
  chat: ChatState | null;
  /** The Session's process is gone: nothing new will be read. */
  ended: boolean;
  /** VIEW-1.6: fetches the page before `before`… */
  onEarlier(sessionId: string, before: string): Promise<ChatPage>;
  /** …and hands it to the store, once the scroll position is noted. */
  onPage(sessionId: string, before: string, epoch: number, page: ChatPage): void;
  /** VIEW-1.5: whether you're at the bottom. */
  onFollowing(sessionId: string, following: boolean): void;
  /** VIEW-1.13: messages you sent that the Transcript hasn't shown yet, oldest first. */
  echoes?: readonly ChatEcho[];
  /** VIEW-1.10: what the Session is doing, under the last message. */
  activity?: ReactNode;
}

/** VIEW-1: the conversation from the Transcript. Mounted per Session. */
export function Chat({ sessionId, harness, chat, ended, onEarlier, onPage, onFollowing, echoes = NO_ECHOES, activity }: ChatProps) {
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState<string | null>(null);
  const entries = chat?.entries ?? NONE;
  const queue = chat?.queue ?? NONE;
  const before = chat?.before ?? null;
  const items = useMemo(() => chatItems(entries), [entries]);
  // VIEW-1.17: this Session's file links; none in a past Session's chat, which has no registry.
  const fileLinks = useContext(FileLinksContext);
  const files = useMemo(() => fileLinks?.session(sessionId) ?? null, [fileLinks, sessionId]);

  // VIEW-1.5: follow new entries while at the bottom; once scrolled up, stay put.
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [following, setFollowing] = useState(true);
  const [unseen, setUnseen] = useState(0);
  /**
   * VIEW-1.11: set by a jump to a Mark, which counts as scrolling up (VIEW-1.5) even when it lands
   * near the bottom; your own next scroll clears it. `cursor` is the Mark jumped to.
   */
  const held = useRef<{ cursor: string } | null>(null);
  /** The last jump, for the rail's tab stop; a new object per jump, even to the same Mark. */
  const [jumped, setJumped] = useState<{ cursor: string } | null>(null);
  /** Set while a "Show earlier" page goes in: where you were, so it stays in view. */
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const lastKey = entries.at(-1)?.cursor ?? null;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (anchor.current) {
      // Older entries went in above: keep what you were looking at in place.
      el.scrollTop = anchor.current.top + (el.scrollHeight - anchor.current.height);
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries, queue, echoes, before, chat?.loaded, chat?.problem]);

  useEffect(() => onFollowing(sessionId, following), [onFollowing, sessionId, following]);

  // Count entries that arrived at the bottom while you were scrolled up.
  // A reset (a new epoch) replaces the chat: only entries after the last one seen count.
  const epoch = chat?.epoch ?? 0;
  const [seen, setSeen] = useState({ last: lastKey, epoch });
  if (seen.last !== lastKey || seen.epoch !== epoch) {
    setSeen({ last: lastKey, epoch });
    const from = seen.last === null ? -1 : entries.findIndex((e) => e.cursor === seen.last);
    if (!following && (seen.epoch === epoch || from >= 0)) setUnseen(unseen + (entries.length - 1 - from));
  }

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = !held.current && el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
    atBottom.current = bottom;
    setFollowing(bottom);
    if (bottom) setUnseen(0);
  };
  /** You scroll yourself (wheel, touch, scroll bar, keys): a jump no longer holds the chat. */
  const release = () => {
    held.current = null;
  };
  // Only a press on the scroll bar itself: clicking or selecting text in the chat isn't scrolling.
  const releaseOnScrollBar = (e: ReactPointerEvent) => {
    if (e.target === e.currentTarget) release();
  };

  // Sizes change without a scroll: the pane shrinks (the terminal drawer opens), or a row
  // expands. A shrinking pane keeps following the bottom; anything else just re-checks where
  // you are, so "Jump to latest" shows when the bottom moved out of view.
  const content = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const tail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let height = el.clientHeight;
    const ro = new ResizeObserver((resized) => {
      // The activity row (VIEW-1.10) appearing or changing is like a new message: followed.
      const grewAtTail = resized.some((r) => r.target === tail.current);
      if ((el.clientHeight !== height || grewAtTail) && atBottom.current) el.scrollTop = el.scrollHeight;
      height = el.clientHeight;
      const bottom = !held.current && el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
      atBottom.current = bottom;
      setFollowing(bottom);
    });
    ro.observe(el);
    if (content.current) ro.observe(content.current);
    if (tail.current) ro.observe(tail.current);
    return () => ro.disconnect();
  }, [chat?.loaded]);

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    // Instantly: a smooth scroll would pass through "not at the bottom" and flicker the button.
    held.current = null;
    atBottom.current = true;
    setFollowing(true);
    setUnseen(0);
    el.scrollTop = el.scrollHeight;
  };

  const showEarlier = async () => {
    if (!before || loadingEarlier || !chat) return;
    setLoadingEarlier(true);
    setEarlierError(null);
    const { epoch } = chat;
    try {
      const page = await onEarlier(sessionId, before);
      const el = scrollRef.current;
      anchor.current = el ? { height: el.scrollHeight, top: el.scrollTop } : null;
      // Rendered now, so the anchor applies to this page only (a page the store drops changes nothing).
      flushSync(() => onPage(sessionId, before, epoch, page));
    } catch (err) {
      setEarlierError(err instanceof Error ? err.message : "Couldn't load earlier messages.");
    } finally {
      anchor.current = null;
      setLoadingEarlier(false);
    }
  };

  // The rail gets a loader that keeps its identity, so it doesn't re-render with Chat.
  const latestShowEarlier = useRef(showEarlier);
  useLayoutEffect(() => {
    latestShowEarlier.current = showEarlier;
  });
  const loadEarlier = useCallback(() => void latestShowEarlier.current(), []);

  // VIEW-1.11: Marks for your prompts, subagent results and questions, on a rail by the scroll bar.
  const marks = useMemo(() => chatMarks(entries), [entries]);
  const markCursors = useMemo(() => new Set(marks.map((m) => m.cursor)), [marks]);
  // Re-measured when what's rendered changes; sizes changing otherwise (rows expanding, the
  // activity row, the pane resizing) reach it through a ResizeObserver.
  const problemNow = chat?.problem ?? null;
  const rendered = useMemo(() => ({ entries, queue, before, problemNow }), [entries, queue, before, problemNow]);
  const canLoadEarlier = !!before && !ended && !!chat?.loaded;

  /**
   * Scrolls to a Mark's entry; a jump counts as scrolling up, so new messages don't pull you away.
   * A jump from the rail also moves focus to the entry, as a link to it would.
   */
  const jumpTo = useCallback((cursor: string, focus: boolean) => {
    const el = scrollRef.current;
    const row = list.current?.querySelector<HTMLElement>(`[data-mark="${CSS.escape(cursor)}"]`);
    if (!el || !row) return;
    const hold = { cursor };
    held.current = hold;
    setJumped(hold);
    atBottom.current = false;
    setFollowing(false);
    const top = Math.max(0, row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - JUMP_MARGIN_PX);
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
    else el.scrollTop = top;
    if (focus) row.focus({ preventScroll: true });
  }, []);
  const step = useEffectEvent((dir: 1 | -1) => {
    const el = scrollRef.current;
    const box = list.current;
    if (!el || !box || marks.length === 0) {
      if (dir === -1 && canLoadEarlier) void showEarlier();
      return;
    }
    const base = el.getBoundingClientRect().top - el.scrollTop;
    const rows = new Map([...box.querySelectorAll<HTMLElement>('[data-mark]')].map((r) => [r.dataset.mark!, r.getBoundingClientRect().top - base]));
    const tops = marks.map((m) => rows.get(m.cursor) ?? 0);
    const from = held.current ? marks.findIndex((m) => m.cursor === held.current!.cursor) : -1;
    const next = stepMark(tops, el.scrollTop, dir, from >= 0 ? from : null);
    if (next !== null) jumpTo(marks[next]!.cursor, false);
    else if (dir === -1 && canLoadEarlier) void showEarlier();
  });
  // `[` and `]`: the previous and next Mark, when focus isn't in a text field or a dialog. Option
  // or AltGr is allowed: some layouts need it to type `[` (`e.key` is the character either way),
  // and Windows reports AltGr as Ctrl+Alt.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      // VIEW-1.12: Space on a link in the chat opens it, as Enter does, instead of scrolling the chat.
      // Not with a modifier: Shift+Space scrolls up.
      const modified = e.shiftKey || e.altKey || e.ctrlKey || e.metaKey;
      if (e.key === ' ' && !modified && e.target instanceof HTMLAnchorElement && e.target.hasAttribute('href') && scrollRef.current?.contains(e.target)) {
        e.preventDefault();
        if (!e.repeat) e.target.click();
        return;
      }
      // A key that scrolls the chat releases a jump's hold: with focus in the chat, or on the page
      // after clicking its text (the key then scrolls the chat, but its target is <body>). Not
      // Space or Enter on a button: that presses it.
      if (SCROLL_KEYS.has(e.key)) {
        if (scrollsChat(e.target, scrollRef.current) && !(e.key === ' ' && isPressable(e.target))) held.current = null;
        return;
      }
      if (e.metaKey || (e.ctrlKey && !e.altKey) || (e.key !== '[' && e.key !== ']')) return;
      if (isTextField(e.target) || (e.target instanceof Element && e.target.closest('[role="dialog"]'))) return;
      e.preventDefault();
      step(e.key === ']' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const problem = chat?.problem ?? null;
  const label = HARNESS_NAME[harness];
  let body;
  if (!chat?.loaded && problem?.kind === 'missing') {
    body = (
      <Notice icon={<FileX className="size-5 opacity-60" />} title="No Transcript found">
        Lookout can&apos;t find this Session&apos;s Transcript, so there&apos;s no chat to show.{' '}
        {!ended && 'The terminal preview and composer still work.'}
        <span className="mt-1 block text-[11.5px] opacity-80">{problem.message}</span>
      </Notice>
    );
  } else if (!chat?.loaded && problem) {
    body = (
      <Notice icon={<MessagesSquare className="size-5 opacity-60" />} title="Couldn't read the Transcript">
        {problem.message} · retrying
      </Notice>
    );
  } else if (!chat?.loaded) {
    body = ended ? (
      <Notice icon={<MessagesSquare className="size-5 opacity-60" />} title="No chat">
        The Session ended before its chat loaded.
      </Notice>
    ) : (
      <Skeleton />
    );
  } else if (items.length === 0 && queue.length === 0 && echoes.length === 0 && !before) {
    // A Session before its first prompt: an empty conversation, not an error.
    body = (
      <Notice icon={<MessagesSquare className="size-5 opacity-60" />} title="No messages yet">
        The conversation shows here once it starts.
      </Notice>
    );
  } else {
    body = (
      <ol ref={list} className="mx-auto flex w-full max-w-3xl flex-col gap-3.5 px-6 py-5" aria-label="Messages">
        {before && !ended && (
          <li className="flex flex-col items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 text-[12px] text-muted-foreground" disabled={loadingEarlier} onClick={() => void showEarlier()}>
              {loadingEarlier ? 'Loading…' : 'Show earlier'}
            </Button>
            {earlierError && (
              <p role="alert" className="text-[12px] text-destructive">
                {earlierError}
              </p>
            )}
          </li>
        )}
        {items.map((item, i) => {
          const mark = markCursors.has(item.key);
          return (
            // A Mark's entry takes focus after a jump from the rail.
            <li
              key={item.key}
              data-mark={mark ? item.key : undefined}
              tabIndex={mark ? -1 : undefined}
              className={mark ? 'rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background' : undefined}
            >
              <Row item={item} label={label} startsTurn={startsTurn(items, i)} />
            </li>
          );
        })}
        {queue.map((q) => (
          <li key={`queue:${q.cursor}`} data-queued>
            <Prompt text={q.kind === 'user' ? q.text : ''} ts={q.ts} state="queued" />
          </li>
        ))}
        {echoes.map((e) => (
          // VIEW-1.13: sent, not in the Transcript yet; its copy takes this place.
          <li key={`echo:${e.id}`} data-echo={e.state}>
            <Sending echo={e} />
          </li>
        ))}
        {problem && (
          <li role="status" className="rounded-md border border-border bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground">
            {problem.kind === 'missing' ? "The Transcript can't be found right now" : "Couldn't read new messages"}: {problem.message} · retrying
          </li>
        )}
      </ol>
    );
  }

  return (
    <SessionFilesContext.Provider value={files}>
      <div className="@container relative flex min-h-24 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          onWheel={release}
          onTouchMove={release}
          onPointerDown={releaseOnScrollBar}
          // VIEW-1.16: the scroll bar's track takes the chat's background, with no border.
          className="scrollbar-blend h-full min-w-0 flex-1 overflow-y-auto"
          aria-label="Chat"
          // SIDE-5 leaves the arrow keys to the chat when they come from inside it: they scroll it.
          data-scroll-keys
          data-testid="chat"
        >
          <div ref={content} className="flex min-h-full flex-col">
            {body}
            <div ref={tail}>{activity}</div>
          </div>
        </div>
        {chat?.loaded && (
          <ChatRail
            scrollRef={scrollRef}
            listRef={list}
            marks={marks}
            version={rendered}
            jumped={jumped}
            canLoadEarlier={canLoadEarlier}
            loadingEarlier={loadingEarlier}
            onEarlier={loadEarlier}
            onJump={jumpTo}
          />
        )}
        {!following && chat?.loaded && items.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={jumpToLatest}
            className="absolute right-5 bottom-3 h-7 gap-1.5 rounded-full border border-border text-[12px] shadow-sm"
          >
            {unseen > 0 ? `${unseen} new · Jump to latest` : 'Jump to latest'}
            <ArrowDown className="size-3.5" />
          </Button>
        )}
      </div>
    </SessionFilesContext.Provider>
  );
}

/** The Harness's name heads its first reply after a prompt, tool calls in between or not. */
function startsTurn(items: ChatItem[], i: number): boolean {
  for (let j = i - 1; j >= 0; j--) {
    const prev = items[j]!;
    if (prev.type === 'tools') continue; // tool calls before the first reply are part of the turn
    // A subagent's result is handed to the agent like a prompt: its reply starts a turn.
    return prev.entry.kind === 'user' || prev.entry.kind === 'command' || prev.entry.kind === 'system';
  }
  return true;
}

interface RowProps {
  item: ChatItem;
  label: string;
  startsTurn: boolean;
}

/** A row re-renders only when its entries changed (they keep their identity in the store). */
const Row = memo(Item, (a, b) => a.label === b.label && a.startsTurn === b.startsTurn && sameItem(a.item, b.item));

function sameItem(a: ChatItem, b: ChatItem): boolean {
  if (a.type === 'entry') return b.type === 'entry' && a.entry === b.entry;
  return b.type === 'tools' && a.calls.length === b.calls.length && a.calls.every((c, i) => c === b.calls[i]);
}

function Item({ item, label, startsTurn }: RowProps) {
  if (item.type === 'tools') return <ToolCalls calls={item.calls} />;
  const e = item.entry;
  switch (e.kind) {
    case 'user':
      return <Prompt text={e.text} ts={e.ts} state="sent" />;
    case 'command':
      return (
        <div className="flex flex-col items-end" data-kind="command">
          <Meta who="You" ts={e.ts} />
          <code className="max-w-[85%] rounded-md border border-border px-2.5 py-1 font-mono text-[12.5px] break-all">
            <LinkedText text={e.text} />
          </code>
        </div>
      );
    case 'assistant':
      return (
        <div data-kind="assistant">
          {startsTurn && <Meta who={label} ts={e.ts} />}
          <div className="text-[13.5px] leading-[1.65] break-words">
            <Markdown text={e.text} />
          </div>
        </div>
      );
    case 'question':
      return <Question entry={e} label={label} />;
    case 'system':
      return <SubagentResult text={e.text} ts={e.ts} />;
  }
}

/** VIEW-1.3: a subagent's result (Claude Code's task notification), one compact line. */
function SubagentResult({ text, ts }: { text: string; ts: string | null }) {
  const time = clockTime(ts);
  const line = firstLine(text);
  return (
    <div
      data-kind="system"
      className="flex min-w-0 items-center gap-2 rounded-md border border-dashed border-border px-2 py-0.5 text-[11.5px] leading-5 text-muted-foreground"
    >
      <MarkShape kind="subagent" className="shrink-0 group-hover:scale-100" />
      <span className={TRUNCATED} title={text}>
        {linkify(line)}
      </span>
      {time && (
        <time dateTime={ts!} className="ml-auto shrink-0 tabular-nums opacity-80">
          {time}
        </time>
      )}
    </div>
  );
}

/** A key with this target scrolls the chat: it comes from inside it, or from the page itself. */
function scrollsChat(t: EventTarget | null, chat: HTMLElement | null): boolean {
  return !!chat && t instanceof Node && (t === document.body || chat.contains(t)) && !isTextField(t);
}

/** Space or Enter presses it rather than scrolling. A link only takes Space without a modifier (above). */
function isPressable(t: EventTarget | null): boolean {
  return t instanceof Element && !!t.closest('button, summary, [role="button"], [role="checkbox"], [role="radio"], [role="option"]');
}

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

/**
 * VIEW-1.13: your message before its copy from the Transcript arrives. One whose copy never came
 * says so under it, with the way to the terminal, as an answer Lookout can't be sure of does
 * (VIEW-4.3); a slash command's says, not as a problem, that its result shows there.
 */
function Sending({ echo }: { echo: ChatEcho }) {
  const terminal = useContext(AnswerContext)?.terminal ?? null;
  const lost = echo.state === 'lost';
  const command = lost && isCommand(echo.text);
  return (
    <>
      <Prompt text={echo.text} ts={null} state={lost ? 'lost' : 'sending'} />
      {lost && <TerminalNote message={command ? IN_TERMINAL : NOT_TAKEN} terminal={terminal} info={command} className="mt-1.5 justify-end" />}
    </>
  );
}

/**
 * Your prompt. A queued one waits in the Harness's queue and isn't part of the history yet
 * (VIEW-3.3); a sending one is your message before its copy from the Transcript arrives, and a lost
 * one never got a copy (VIEW-1.13): both dimmed.
 */
function Prompt({ text, ts, state }: { text: string; ts: string | null; state: 'sent' | 'queued' | 'sending' | 'lost' }) {
  const queued = state === 'queued';
  const echo = state === 'sending' || state === 'lost';
  return (
    <div className={cn('flex flex-col items-end', echo && 'opacity-60')} data-kind={echo ? undefined : 'user'}>
      <Meta who="You" ts={ts} extra={queued ? 'queued' : null} srLabel={state === 'sending' ? 'sending' : null} />
      <div
        className={cn(
          'max-w-[85%] rounded-lg bg-muted px-3.5 py-2 text-[13.5px] leading-[1.6] break-words whitespace-pre-wrap',
          queued && 'border border-dashed border-border bg-transparent text-muted-foreground',
        )}
      >
        <LinkedText text={text} />
      </div>
    </div>
  );
}

function Meta({ who, ts, extra = null, srLabel = null }: { who: string; ts: string | null; extra?: string | null; srLabel?: string | null }) {
  const time = clockTime(ts);
  return (
    <p className="mb-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
      <span className="font-medium text-foreground/80">{who}</span>
      {srLabel && <span className="sr-only">{srLabel}</span>}
      {time && <time dateTime={ts!}>{time}</time>}
      {extra && <span className="rounded bg-muted px-1 text-[10.5px] uppercase tracking-wide">{extra}</span>}
    </p>
  );
}

/** VIEW-1.2: a run of tool calls as one row; expanded, one line per call. Never any output. */
function ToolCalls({ calls }: { calls: ToolCall[] }) {
  const [open, setOpen] = useState(false);
  if (calls.length === 1) {
    const c = calls[0]!;
    return (
      <div className="flex min-w-0 items-center gap-2 py-0.5 text-[12.5px] text-muted-foreground" data-kind="tool_call">
        <Wrench className="size-3.5 shrink-0 opacity-70" />
        <span className="shrink-0 font-medium text-foreground/75">{c.tool}</span>
        <span className={cn(TRUNCATED, 'font-mono text-[11.5px]')} title={c.summary}>
          <LinkedText text={c.summary} />
        </span>
      </div>
    );
  }
  return (
    <div data-kind="tool_calls">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="-mx-1.5 flex items-center gap-2 rounded px-1.5 py-0.5 text-[12.5px] text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      >
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        {toolsLabel(calls)}
      </button>
      {open && (
        <ul className="mt-1 ml-[7px] space-y-0.5 border-l border-border pl-4">
          {calls.map((c) => (
            <li key={c.cursor} className="flex min-w-0 items-center gap-2 text-[12.5px] text-muted-foreground">
              <span className="shrink-0 font-medium text-foreground/75">{c.tool}</span>
              <span className={cn(TRUNCATED, 'font-mono text-[11.5px]')} title={c.summary}>
                <LinkedText text={c.summary} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * VIEW-1.9: a question with its options; once answered, the answer. VIEW-4.1: while it's the one
 * the Session waits on, its options are buttons (the Session view says so through AnswerContext).
 */
function Question({ entry, label }: { entry: QuestionEntry; label: string }) {
  const answering = useContext(AnswerContext);
  const live = entry.status === 'pending' && answering?.panel?.id === entry.id ? answering : null;
  const panel = live?.panel ?? null;
  // Declined, or abandoned (never answered and the conversation moved on): not answered either way.
  const declined = entry.status === 'declined' || entry.status === 'abandoned';
  return (
    <div
      data-kind="question"
      data-status={entry.status}
      className={cn('rounded-lg border px-4 py-3', entry.status === 'pending' ? 'border-needs-you/60 bg-needs-you-soft' : 'border-border')}
    >
      <p className="mb-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <CircleHelp className="size-3.5" />
        <span className="font-medium text-foreground/80">{label} asks</span>
        <span className="ml-auto">
          {entry.status === 'pending' ? (
            <span className="font-medium text-needs-you-text">Waiting for your answer</span>
          ) : declined ? (
            'Not answered'
          ) : (
            'Answered'
          )}
        </span>
      </p>
      {live && panel && panel.phase !== 'blocked' ? (
        <QuestionForm entry={entry} panel={panel} onSubmit={(answers) => live.submit(entry.id, answers)} kept={live.drafts} />
      ) : (
        <div className="space-y-3">
          {entry.questions.map((q, qi) => {
            const { picked, other } = answerFor(q, entry.status === 'answered' ? entry.answer : null, qi);
            return (
              <section key={qi} aria-label={q.header || q.question}>
                {q.header && <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{linkify(q.header)}</p>}
                <p className="text-[13.5px] font-medium">{linkify(q.question)}</p>
                {q.multiSelect && <p className="text-[11.5px] text-muted-foreground">Several can be picked</p>}
                <ul className="mt-1.5 space-y-1">
                  {q.options.map((o, oi) => {
                    const chosen = picked.has(oi);
                    return (
                      <li
                        key={oi}
                        data-picked={chosen || undefined}
                        className={cn(
                          'flex gap-2 rounded-md border px-2.5 py-1.5 text-[13px]',
                          chosen ? 'border-foreground/40 bg-accent font-medium' : 'border-border',
                          entry.status !== 'pending' && !chosen && 'opacity-60',
                        )}
                      >
                        <span aria-hidden className="flex h-[1lh] w-3.5 shrink-0 items-center justify-center text-muted-foreground" data-field="choice">
                          <ChoiceIcon multiSelect={q.multiSelect} chosen={chosen} />
                        </span>
                        <span className="min-w-0">
                          {linkify(o.label)}
                          {o.description && <span className="block text-[12px] font-normal text-muted-foreground">{linkify(o.description)}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {other && (
                  <p className="mt-1.5 text-[13px]">
                    <span className="text-muted-foreground">Answered: </span>
                    {linkify(other)}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
      {live && panel?.phase === 'blocked' && panel.message && <AnswerInTerminal message={panel.message} terminal={live.terminal} />}
      {entry.status === 'pending' && !live && <p className="mt-2.5 text-[12px] text-muted-foreground">Answer it in the terminal.</p>}
      {declined && (
        <p className="mt-2.5 text-[12px] text-muted-foreground">
          {entry.status === 'abandoned' ? 'The conversation moved on without an answer.' : 'Dismissed without an answer.'}
        </p>
      )}
    </div>
  );
}

function Notice({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div role="status" className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center text-muted-foreground">
      {icon}
      <p className="text-[13px] font-medium text-foreground/85">{title}</p>
      <p className="max-w-md text-[12.5px] leading-5">{children}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-6 py-5" aria-busy="true" aria-label="Loading the chat">
      {[70, 45, 85, 35].map((w, i) => (
        <div key={i} className={cn('flex', i % 2 === 0 && 'justify-end')}>
          <div className="h-8 animate-pulse rounded-lg bg-muted" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}
