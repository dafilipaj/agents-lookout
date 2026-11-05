import type { ChatEntry, ChatPage, ChatQuestion, Harness } from '@shared/types.ts';
import { ArrowDown, ChevronRight, CircleHelp, type LucideIcon, MessagesSquare, TerminalSquare, Undo2, Wrench } from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, memo, useCallback, useContext, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Loading } from '@/components/ui/loading';
import { AnswerContext, type TerminalLink, hasPreviews } from '@/lib/answers';
import { type ChatFold, type ChatItem, type ChatSeen, type ChatRow, type QuestionEntry, type ToolCall, answerFor, chatItems, clockTime, foldSteps, foldSummary, newSince, timeOf, toolsLabel, workedFor } from '@/lib/chat';
import { type Echo, IN_TERMINAL, NOT_TAKEN, NO_ECHOES, isCommand } from '@/lib/echoes';
import { FileLinksContext, SessionFilesContext } from '@/lib/files';
import { linkify } from '@/lib/links';
import { JUMP_MARGIN_PX, chatMarks, firstLine, stepMark } from '@/lib/marks';
import { HARNESS_NAME } from '@/lib/sessions';
import type { Chat as ChatState } from '@/lib/store';
import { cn } from '@/lib/utils';
import { AnswerInTerminal, ChoiceIcon, type OptionRowProps, PreviewOptions, QuestionForm, TerminalNote } from './Answering';
import { ChatRail, MarkShape } from './ChatRail';
import { LinkedText } from './FilePath';
import { Markdown } from './Markdown';

/** At most this far from the bottom still counts as "at the bottom" (VIEW-1.5). */
const BOTTOM_SLACK_PX = 48;
/** VIEW-14.2: the room the latest-prompt strip takes at the chat's top; a jump lands below it. */
export const PROMPT_STRIP_PX = 36;
/** VIEW-13.2: how long a chat with nothing new yet waits for the server's next read before it settles on no divider. */
const SEEN_SETTLE_MS = 3000;
/** Where a jump puts its row: just below the strip. */
const TOP_PX = JUMP_MARGIN_PX + PROMPT_STRIP_PX;

/** VIEW-13.1, for SessionView. */
export type { ChatSeen };
const NONE: readonly ChatEntry[] = [];
/** VIEW-1.13: a message you sent, as the chat shows it: waiting for its copy, or lost. */
type ChatEcho = Pick<Echo, 'id' | 'text' | 'state'>;
/** VIEW-3.9: your message waiting to go (Undo send), from `at` until `until`, ms since epoch. */
export interface HeldMessage {
  text: string;
  at: number;
  until: number;
  /** VIEW-3.10: takes it back into the composer, unsent. */
  onUndo(): void;
}
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
  /** VIEW-3.9: the message waiting to go, after them. */
  outgoing?: HeldMessage | null;
  /** VIEW-1.10: what the Session is doing, under the last message. */
  activity?: ReactNode;
  /** A Controllable Session's terminal preview: the way to it while the Transcript is slow to read (DS-6.2). */
  terminal?: TerminalLink | null;
  /** VIEW-12.3: a turn runs, so the run at the chat's end is live. */
  running?: boolean;
  /** VIEW-13: what you saw when you last left this Session's view, and keeping it when you leave now. */
  loadSeen?(sessionId: string): Promise<ChatSeen | null>;
  saveSeen?(sessionId: string, seen: ChatSeen, keepalive: boolean): Promise<void>;
}

/** VIEW-1: the conversation from the Transcript. Mounted per Session. */
export function Chat({ sessionId, harness, chat, ended, onEarlier, onPage, onFollowing, echoes = NO_ECHOES, outgoing = null, activity, terminal = null, running = false, loadSeen, saveSeen }: ChatProps) {
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState<string | null>(null);
  const entries = chat?.entries ?? NONE;
  const queue = chat?.queue ?? NONE;
  const before = chat?.before ?? null;
  // VIEW-13.2: where the entries you haven't seen begin (an entry's cursor), and its time.
  const [divider, setDivider] = useState<{ key: string; ts: string | null } | null>(null);
  // A run of tool calls is cut at the divider, so calls you saw stay above it.
  const items = useMemo(() => chatItems(entries, divider?.key ?? null), [entries, divider]);
  // VIEW-12: runs of steps folded; a run never spans the divider. A prompt you sent that isn't in the
  // Transcript yet starts a new turn, so the one before it is over (its answer doesn't fold).
  const turnOpen = running && !ended && !echoes.some((e) => e.state === 'waiting');
  const rows = useMemo(() => foldSteps(items, turnOpen, divider?.key ?? null), [items, turnOpen, divider]);
  /** VIEW-12.4: the folds you opened, by their first item's key, while this view is open. */
  const [openFolds, setOpenFolds] = useState<ReadonlySet<string>>(() => new Set());
  const toggleFold = useCallback((key: string) => {
    setOpenFolds((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
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
  }, [entries, queue, echoes, outgoing, before, chat?.loaded, chat?.problem]);

  useEffect(() => onFollowing(sessionId, following), [onFollowing, sessionId, following]);

  // VIEW-13: what you saw when you last left this Session's view; undefined while it's read.
  const loaded = !!chat?.loaded;
  const [lastSeen, setLastSeen] = useState<ChatSeen | null | undefined>(loadSeen ? undefined : null);
  useEffect(() => {
    if (!loadSeen) return;
    let alive = true;
    // VIEW-13.4: a failed read is no record: no divider, the chat at the bottom.
    loadSeen(sessionId).then(
      (r) => alive && setLastSeen(r),
      () => alive && setLastSeen(null),
    );
    return () => {
      alive = false;
    };
  }, [loadSeen, sessionId]);
  // VIEW-13.2: the divider is placed once per opening, as soon as the chat and the record are both
  // in, and stays put while the view is open.
  // A chat cached from an earlier visit ends where you left it until the server's reset comes in, and
  // a feed viewed again soon after is sent as it was, its new entries following on the next read. So
  // the divider waits for the reset (a new epoch) or a failed read, then, while nothing new is in, up
  // to SEEN_SETTLE_MS for what follows. A problem counts only when it came after (a cached chat keeps
  // the last it had). Back from a hidden tab, the wait starts again without the reset: the chat kept
  // up while hidden, unless the stream dropped, and then its reset comes in the wait.
  const [gate, setGate] = useState<{ epoch: number | null; problem: unknown }>(() => ({ epoch: chat?.loaded ? chat.epoch : -1, problem: chat?.problem ?? null }));
  const newProblem = !!chat?.problem && chat.problem !== gate.problem;
  const fresh = loaded && (gate.epoch === null || (chat?.epoch ?? 0) !== gate.epoch || newProblem);
  const [placed, setPlaced] = useState(false);
  const [settled, setSettled] = useState(false);
  const waiting = !placed && fresh && lastSeen !== undefined;
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setSettled(true), SEEN_SETTLE_MS);
    return () => clearTimeout(t);
  }, [waiting]);
  if (waiting) {
    const at = lastSeen ? newSince(entries, lastSeen) : null;
    if (at || !lastSeen || settled || newProblem) {
      setPlaced(true);
      setDivider(at);
    }
  }
  /** VIEW-13.3: the chat opens at the divider once; a divider placed later (cameBack) doesn't scroll. */
  const opened = useRef(false);
  useLayoutEffect(() => {
    if (opened.current || !placed) return;
    opened.current = true;
    // Placed a moment after opening: not when you've already scrolled away or jumped.
    if (!divider || !atBottom.current || held.current) return;
    const el = scrollRef.current;
    const row = list.current?.querySelector<HTMLElement>('[data-new-divider]');
    if (!el || !row) return;
    const top = row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    // What's new fits: the chat stays at the bottom, as before.
    if (el.scrollHeight - top <= el.clientHeight) return;
    atBottom.current = false;
    setFollowing(false);
    el.scrollTop = Math.max(0, top - TOP_PX);
  }, [placed, divider]);

  // VIEW-13.1: the chat's last entry is what you've seen when you leave: another Session, a reload,
  // the tab closed or hidden. Coming back to a tab that was hidden moves the divider to what came since.
  const latest = useRef<ChatSeen | null>(null);
  useLayoutEffect(() => {
    const e = entries.at(-1);
    if (e && loaded) latest.current = { cursor: e.cursor, at: timeOf(e.ts) };
  });
  const cameBack = useEffectEvent((was: ChatSeen) => {
    // VIEW-13.2: placed again against what you saw when you left (none, if nothing came since).
    setLastSeen(was);
    setGate({ epoch: null, problem: chat?.problem ?? null });
    setSettled(false);
    setPlaced(false);
  });
  useEffect(() => {
    if (!saveSeen) return;
    let away: ChatSeen | null = null;
    const save = (keepalive: boolean): ChatSeen | null => {
      const now = latest.current;
      if (now) void saveSeen(sessionId, now, keepalive).catch(() => {});
      return now;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') away = save(true);
      else if (away) {
        cameBack(away);
        away = null;
      }
    };
    const onPageHide = () => void save(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      save(false);
    };
  }, [saveSeen, sessionId]);

  // Count entries that arrived at the bottom while you were scrolled up.
  // A reset (a new epoch) replaces the chat: only entries after the last one seen count.
  const epoch = chat?.epoch ?? 0;
  const [seen, setSeen] = useState({ last: lastKey, epoch });
  if (seen.last !== lastKey || seen.epoch !== epoch) {
    setSeen({ last: lastKey, epoch });
    const from = seen.last === null ? -1 : entries.findIndex((e) => e.cursor === seen.last);
    if (!following && (seen.epoch === epoch || from >= 0)) setUnseen(unseen + (entries.length - 1 - from));
  }

  /** VIEW-14.1: re-checks whether your latest prompt is out of view; set once the list exists. */
  const checkPromptRef = useRef<() => void>(() => {});
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = !held.current && el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
    atBottom.current = bottom;
    setFollowing(bottom);
    if (bottom) setUnseen(0);
    checkPromptRef.current();
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
      checkPromptRef.current();
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
  const rendered = useMemo(() => ({ entries, queue, before, problemNow, openFolds, divider }), [entries, queue, before, problemNow, openFolds, divider]);
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
    // VIEW-14.2: below where the latest-prompt strip sits.
    const top = Math.max(0, row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - TOP_PX);
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
    else el.scrollTop = top;
    if (focus) row.focus({ preventScroll: true });
  }, []);

  // VIEW-14.1: your latest prompt, and whether it's out of the chat's view.
  const latestPrompt = useMemo(() => {
    const echo = echoes.at(-1);
    if (echo) return { key: `echo:${echo.id}`, text: echo.text, ts: null as string | null };
    const it = items.findLast((i) => i.type === 'entry' && (i.entry.kind === 'user' || i.entry.kind === 'command'));
    return it?.type === 'entry' && (it.entry.kind === 'user' || it.entry.kind === 'command') ? { key: it.key, text: it.entry.text, ts: it.entry.ts } : null;
  }, [items, echoes]);
  const promptRow = useCallback(() => (latestPrompt ? (list.current?.querySelector<HTMLElement>(`[data-prompt-row="${CSS.escape(latestPrompt.key)}"]`) ?? null) : null), [latestPrompt]);
  const [promptOut, setPromptOut] = useState(false);
  const checkPrompt = useCallback(() => {
    const el = scrollRef.current;
    const row = promptRow();
    // No layout (a hidden or unmeasured chat) is no reason for a reminder.
    if (!el || !row || !el.clientHeight) return setPromptOut(false);
    const box = el.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    setPromptOut(r.bottom <= box.top + PROMPT_STRIP_PX || r.top >= box.bottom);
  }, [promptRow]);
  useLayoutEffect(() => {
    checkPromptRef.current = checkPrompt;
    checkPrompt();
  }, [checkPrompt, rows, openFolds]);
  const jumpToPrompt = () => {
    const el = scrollRef.current;
    const row = promptRow();
    if (!el || !row || !latestPrompt) return;
    const hold = { cursor: latestPrompt.key };
    held.current = hold;
    atBottom.current = false;
    setFollowing(false);
    const top = Math.max(0, row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - TOP_PX);
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
    else el.scrollTop = top;
    // The strip goes once the prompt is in view: focus moves to the prompt, not to the page.
    row.focus({ preventScroll: true });
  };
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
    // VIEW-14.2: Marks land below the strip, so the line they're measured from is lower by its room.
    const next = stepMark(tops, el.scrollTop + PROMPT_STRIP_PX, dir, from >= 0 ? from : null);
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
      <ChatProblem title="No Transcript found">
        Lookout can&apos;t find this Session&apos;s Transcript, so there&apos;s no chat to show.{' '}
        {!ended && 'The terminal preview and composer still work.'}
        <span className="mt-1 block opacity-80">{problem.message}</span>
      </ChatProblem>
    );
  } else if (!chat?.loaded && problem) {
    body = (
      <ChatProblem title="Couldn't read the Transcript">
        {problem.message} · retrying
      </ChatProblem>
    );
  } else if (!chat?.loaded) {
    body = ended ? (
      <Notice icon={MessagesSquare} title="No chat">
        The Session ended before its chat loaded.
      </Notice>
    ) : (
      <Skeleton terminal={terminal} />
    );
  } else if (items.length === 0 && queue.length === 0 && echoes.length === 0 && !outgoing && !before) {
    // A Session before its first prompt: an empty conversation, not an error.
    body = (
      <Notice icon={MessagesSquare} title="No messages yet">
        The conversation shows here once it starts.
      </Notice>
    );
  } else {
    body = (
      <ol ref={list} className="mx-auto flex w-full max-w-3xl flex-col gap-3.5 px-6 pt-11 pb-5" aria-label="Messages">
        {before && !ended && (
          <li className="flex flex-col items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 text-meta text-muted-foreground" disabled={loadingEarlier} onClick={() => void showEarlier()}>
              {loadingEarlier ? <Loading label="Loading…" /> : 'Show earlier'}
            </Button>
            {earlierError && <Alert layout="inline" title={earlierError} />}
          </li>
        )}
        {rows.map((row, i) => {
          const node =
            row.type === 'fold' ? (
              <li key={`fold:${row.key}`} data-fold={row.live ? 'live' : 'done'}>
                <Fold fold={row} open={openFolds.has(row.key)} onToggle={toggleFold} label={label} startsTurn={startsTurn(rows, i)} />
              </li>
            ) : (
              <ItemRow key={row.key} item={row} mark={markCursors.has(row.key)} label={label} startsTurn={startsTurn(rows, i)} />
            );
          // VIEW-13.2: above the first entry you haven't seen.
          if (divider?.key !== row.key) return node;
          return [
            <li key="new-since" aria-hidden={false}>
              <NewSince ts={divider.ts} />
            </li>,
            node,
          ];
        })}
        {queue.map((q) => (
          <li key={`queue:${q.cursor}`} data-queued>
            <Prompt text={q.kind === 'user' ? q.text : ''} ts={q.ts} state="queued" />
          </li>
        ))}
        {echoes.map((e) => (
          // VIEW-1.13: sent, not in the Transcript yet; its copy takes this place.
          <li key={`echo:${e.id}`} data-echo={e.state} data-prompt-row={`echo:${e.id}`} tabIndex={-1} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background">
            <Sending echo={e} />
          </li>
        ))}
        {outgoing && (
          <li key={`held:${outgoing.at}`} data-held>
            <Held held={outgoing} />
          </li>
        )}
        {problem && (
          <li>
            <Alert tone="info" title={`${problem.kind === 'missing' ? "The Transcript can't be found right now" : "Couldn't read new messages"}: ${problem.message} · retrying`} />
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
          className="h-full min-w-0 flex-1 scroll-pt-9 overflow-y-auto"
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
        {promptOut && latestPrompt && chat?.loaded && <PromptStrip text={latestPrompt.text} ts={latestPrompt.ts} onJump={jumpToPrompt} />}
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
            className="absolute right-5 bottom-3 h-7 gap-1.5 rounded-full border border-border text-meta shadow-sm"
          >
            {unseen > 0 ? `${unseen} new · Jump to latest` : 'Jump to latest'}
            <ArrowDown className="size-3.5" />
          </Button>
        )}
      </div>
    </SessionFilesContext.Provider>
  );
}

/** The Harness's name heads its first reply after a prompt that shows, tool calls and folds in between or not. */
function startsTurn(rows: readonly ChatRow[], i: number): boolean {
  for (let j = i - 1; j >= 0; j--) {
    const prev = rows[j]!;
    if (prev.type === 'tools' || prev.type === 'fold') continue; // tool calls and folded steps are part of the turn
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
          <code className="max-w-[85%] rounded-md border border-border px-2.5 py-1 font-mono text-body break-all">
            <LinkedText text={e.text} />
          </code>
        </div>
      );
    case 'assistant':
      return (
        <div data-kind="assistant">
          {startsTurn && <Meta who={label} ts={e.ts} />}
          {/* VIEW-11.1: `reading`, at most 42rem from the column's left edge. */}
          <div className="max-w-[42rem] text-reading break-words">
            <Markdown text={e.text} reading />
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
      className="flex min-w-0 items-center gap-2 rounded-md border border-dashed border-border px-2 py-0.5 text-meta leading-5 text-muted-foreground"
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

/** One item of the chat as a list row; a Mark's entry takes focus after a jump from the rail. */
function ItemRow({ item, mark, label, startsTurn }: { item: ChatItem; mark: boolean; label: string; startsTurn: boolean }) {
  const prompt = item.type === 'entry' && (item.entry.kind === 'user' || item.entry.kind === 'command');
  return (
    <li
      data-mark={mark ? item.key : undefined}
      data-prompt-row={prompt ? item.key : undefined}
      tabIndex={mark || prompt ? -1 : undefined}
      className={mark || prompt ? 'rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background' : undefined}
    >
      <Row item={item} label={label} startsTurn={startsTurn} />
    </li>
  );
}

/**
 * VIEW-12.2, 12.3: two or more steps as one row: how long they took (or "Working" while the turn
 * runs) and their counts, the last update under it; opened, the steps as they were.
 */
function Fold({ fold, open, onToggle, label, startsTurn }: { fold: ChatFold; open: boolean; onToggle(key: string): void; label: string; startsTurn: boolean }) {
  const { updates, calls, ms, hint } = foldSummary(fold);
  const counts = [updates > 0 && `${updates} ${updates === 1 ? 'update' : 'updates'}`, calls > 0 && `${calls} tool ${calls === 1 ? 'call' : 'calls'}`].filter(Boolean).join(' · ');
  const head = fold.live ? 'Working' : ms !== null ? `Worked for ${workedFor(ms)}` : null;
  return (
    <div data-kind="fold">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onToggle(fold.key)}
        className="-mx-1.5 flex w-[calc(100%+0.75rem)] min-w-0 flex-col items-start gap-0.5 rounded px-1.5 py-1 text-left hover:bg-accent/60"
      >
        <span className="flex min-w-0 items-center gap-2 text-body text-muted-foreground">
          <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
          <span>
            {head && <span className="font-medium text-foreground/80">{head}</span>}
            {head && counts ? ' · ' : ''}
            {counts}
          </span>
        </span>
        {!open && hint && (
          <span className={cn(TRUNCATED, 'max-w-full pl-5.5 text-meta text-muted-foreground')} data-field="fold-hint">
            {hint.replace(/`/g, '')}
          </span>
        )}
      </button>
      {open && (
        <ol className="mt-2 ml-[7px] flex flex-col gap-3.5 border-l border-border pl-4" aria-label="Steps">
          {fold.items.map((it, j) => (
            <li key={it.key}>
              {/* As unfolded: the first reply of a turn, after only tool calls, says who and when. */}
              <Row item={it} label={label} startsTurn={startsTurn && fold.items.slice(0, j).every((x) => x.type === 'tools')} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** VIEW-13.2: where the entries you haven't seen begin. */
function NewSince({ ts }: { ts: string | null }) {
  const time = clockTime(ts);
  return (
    <div role="separator" aria-label={`New since you looked${time ? `, ${time}` : ''}`} data-new-divider className="flex items-center gap-2 text-meta font-semibold text-foreground">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-foreground" />
      <span className="shrink-0">
        New since you looked{time && ` · ${time}`}
      </span>
      <span aria-hidden className="h-px flex-1 bg-foreground/40" />
    </div>
  );
}

/** VIEW-14.1: your latest prompt, pinned to the chat's top while it's out of view; it takes no room. */
function PromptStrip({ text, ts, onJump }: { text: string; ts: string | null; onJump(): void }) {
  const time = clockTime(ts);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center" data-slot="prompt-strip">
      <button
        type="button"
        onClick={onJump}
        className="pointer-events-auto flex w-full max-w-3xl min-w-0 items-baseline gap-1.5 border-b border-border bg-background px-6 py-2 text-left text-meta hover:bg-accent"
        data-field="prompt-strip"
      >
        <span className="shrink-0 font-medium text-foreground/80">You{time ? `, ${time}` : ''}:</span>{' '}
        <span className="min-w-0 truncate text-muted-foreground">{firstLine(text)}</span>
      </button>
    </div>
  );
}

/** A key with this target scrolls the chat: it comes from inside it, or from the page itself. */
function scrollsChat(t: EventTarget | null, chat: HTMLElement | null): boolean {
  return !!chat && t instanceof Node && (t === document.body || chat.contains(t)) && !isTextField(t);
}

/** Space or Enter presses it rather than scrolling. A link only takes Space without a modifier (above). */
function isPressable(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  // An option in a read-only listbox (a question already answered) presses nothing.
  const option = t.closest('[role="option"]');
  if (option && option.closest('[role="listbox"]')?.getAttribute('aria-readonly') === 'true' && !t.closest('button, summary, [role="button"], [role="checkbox"], [role="radio"]')) return false;
  return !!t.closest('button, summary, [role="button"], [role="checkbox"], [role="radio"], [role="option"]');
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
 * VIEW-3.9: your message waiting to go. It reads as yours and isn't dimmed, so you can still read
 * what you're about to send; its dashed edge says it hasn't gone. Under it a ring drains over the
 * wait, the seconds left count down, and Undo takes it back (VIEW-3.10).
 */
function Held({ held }: { held: HeldMessage }) {
  const [now, setNow] = useState(held.at);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const total = Math.max(1, held.until - held.at);
  const left = Math.max(1, Math.ceil((held.until - now) / 1000));
  return (
    <div className="flex flex-col items-end">
      <Meta who="You" ts={null} srLabel="waiting to send" />
      <div className="max-w-[85%] rounded-lg border border-dashed border-primary/45 bg-primary-soft px-3.5 py-2 text-reading break-words whitespace-pre-wrap">
        <LinkedText text={held.text} />
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-meta text-muted-foreground" data-field="undo-send">
        <span className="countdown-ring size-3.5 shrink-0 motion-reduce:hidden" style={{ animation: `countdown-drain ${total}ms linear forwards` }} aria-hidden />
        <span className="tabular-nums" aria-hidden>
          Sending in {left} s
        </span>
        <span className="sr-only" role="status">
          Sending in {Math.round(total / 1000)} seconds. Undo, or Backspace in the empty box, takes it back.
        </span>
        <Button type="button" variant="ghost" size="xs" className="-mr-1.5 text-foreground/80" title="Undo, or Backspace in the empty box" onClick={held.onUndo}>
          <Undo2 />
          Undo
        </Button>
      </div>
    </div>
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
          'max-w-[85%] rounded-lg bg-primary-soft px-3.5 py-2 text-reading break-words whitespace-pre-wrap',
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
    <p className="mb-1 flex items-center gap-1.5 text-meta text-muted-foreground">
      <span className="font-medium text-foreground/80">{who}</span>
      {srLabel && <span className="sr-only">{srLabel}</span>}
      {time && <time dateTime={ts!}>{time}</time>}
      {extra && <Chip className="uppercase tracking-wide">{extra}</Chip>}
    </p>
  );
}

/** VIEW-1.2: a run of tool calls as one row; expanded, one line per call. Never any output. */
function ToolCalls({ calls }: { calls: ToolCall[] }) {
  const [open, setOpen] = useState(false);
  if (calls.length === 1) {
    const c = calls[0]!;
    return (
      <div className="flex min-w-0 items-center gap-2 py-0.5 text-body text-muted-foreground" data-kind="tool_call">
        <Wrench className="size-3.5 shrink-0 opacity-70" />
        <span className="shrink-0 font-medium text-foreground/75">{c.tool}</span>
        <span className={cn(TRUNCATED, 'font-mono text-meta')} title={c.summary}>
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
        className="-mx-1.5 flex items-center gap-2 rounded px-1.5 py-0.5 text-body text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      >
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        {toolsLabel(calls)}
      </button>
      {open && (
        <ul className="mt-1 ml-[7px] space-y-0.5 border-l border-border pl-4">
          {calls.map((c) => (
            <li key={c.cursor} className="flex min-w-0 items-center gap-2 text-body text-muted-foreground">
              <span className="shrink-0 font-medium text-foreground/75">{c.tool}</span>
              <span className={cn(TRUNCATED, 'font-mono text-meta')} title={c.summary}>
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
      // VIEW-10.1: the card is the container its preview box's layout asks about.
      className={cn('@container rounded-lg border px-4 py-3', entry.status === 'pending' ? 'border-needs-you/60 bg-needs-you-soft' : 'border-border')}
    >
      <p className="mb-2 flex items-center gap-1.5 text-meta text-muted-foreground">
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
                {q.header && <p className="text-caption font-medium tracking-wide text-muted-foreground uppercase">{linkify(q.header)}</p>}
                <p className="text-prose font-medium">{linkify(q.question)}</p>
                {q.multiSelect && <p className="text-meta text-muted-foreground">Several can be picked</p>}
                <ReadOnlyOptions q={q} picked={picked} faded={entry.status !== 'pending'} />
                {other && (
                  <p className="mt-1.5 text-body">
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
      {entry.status === 'pending' && !live && <p className="mt-2.5 text-meta text-muted-foreground">Answer it in the terminal.</p>}
      {declined && (
        <p className="mt-2.5 text-meta text-muted-foreground">
          {entry.status === 'abandoned' ? 'The conversation moved on without an answer.' : 'Dismissed without an answer.'}
        </p>
      )}
    </div>
  );
}

/**
 * VIEW-1.9: a question's options, read-only, the picked ones marked. VIEW-10.6: one with previews
 * shows its box too, starting on the pick (the first option when none was picked), and following
 * the pointer and the keyboard: its options take one tab stop, and ↑/↓ move between them.
 */
function ReadOnlyOptions({ q, picked, faded }: { q: ChatQuestion; picked: Set<number>; faded: boolean }) {
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  // The option that holds the tab stop: the one last focused, else the pick, else the first.
  const [stop, setStop] = useState<number | null>(null);
  const list = (preview?: { row: (i: number) => OptionRowProps; shown: number; followed: boolean }) => {
    const tabStop = stop ?? [...picked][0] ?? 0;
    const onKeyDown = (e: ReactKeyboardEvent<HTMLLIElement>, i: number) => {
      if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const next = i + (e.key === 'ArrowDown' ? 1 : -1);
      // At the first or last option there's nowhere to go: leave the key to the page.
      if (next < 0 || next >= q.options.length) return;
      e.preventDefault();
      setStop(next);
      rows.current[next]?.focus();
    };
    return (
      <ul
        className={cn('space-y-1', !preview && 'mt-1.5')}
        role={preview ? 'listbox' : undefined}
        aria-readonly={preview ? true : undefined}
        aria-label={preview ? q.header || q.question : undefined}
      >
        {q.options.map((o, oi) => {
          const chosen = picked.has(oi);
          const hovered = !!preview && preview.followed && preview.shown === oi && !chosen;
          return (
            <li
              key={oi}
              ref={(el) => {
                rows.current[oi] = el;
              }}
              {...preview?.row(oi)}
              role={preview ? 'option' : undefined}
              aria-selected={preview ? chosen : undefined}
              tabIndex={preview ? (oi === tabStop ? 0 : -1) : undefined}
              onKeyDown={preview ? (e) => onKeyDown(e, oi) : undefined}
              onFocus={
                preview
                  ? (e) => {
                      preview.row(oi).onFocus?.(e);
                      setStop(oi);
                    }
                  : undefined
              }
              data-picked={chosen || undefined}
              data-shown={(preview && preview.shown === oi) || undefined}
              className={cn(
                'flex gap-2 rounded-md border px-2.5 py-1.5 text-body',
                chosen ? 'border-foreground/40 bg-accent font-medium' : hovered ? 'border-foreground/40 bg-accent' : 'border-border',
                faded && !chosen && !hovered && 'opacity-60',
                preview && 'outline-none hover:border-foreground/40 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <span aria-hidden className="flex h-[1lh] w-3.5 shrink-0 items-center justify-center text-muted-foreground" data-field="choice">
                <ChoiceIcon multiSelect={q.multiSelect} chosen={chosen} />
              </span>
              <span className="min-w-0">
                {/* A row with previews is a tab stop, so (VIEW-1.12) its text is plain: no links inside it. */}
                {preview ? o.label : linkify(o.label)}
                {o.description && <span className="block text-meta font-normal text-muted-foreground">{preview ? o.description : linkify(o.description)}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    );
  };
  if (!hasPreviews(q)) return list();
  return (
    <PreviewOptions question={q} picked={picked}>
      {(row, shown, followed) => list({ row, shown, followed })}
    </PreviewOptions>
  );
}

/** DS-8.1: the chat's empty states, as an EmptyState in the middle of the pane. */
function Notice({ icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return <EmptyState role="status" icon={icon} title={title} hint={children} className="flex-1 justify-center px-8" />;
}

/** DS-4.2: a Transcript that can't be found or read is an error Alert (a box) at the top of the pane, not an empty state. */
function ChatProblem({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-5">
      <Alert title={title} detail={children} />
    </div>
  );
}

/**
 * DS-6.2: the skeleton, and under it what's being done and for how long; from 15 s, that the
 * terminal preview still works, with a way to it for a Controllable Session.
 */
function Skeleton({ terminal }: { terminal: TerminalLink | null }) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-6 py-5">
      <div className="space-y-4" aria-busy="true" aria-label="Loading the chat">
        {[70, 45, 85, 35].map((w, i) => (
          <div key={i} className={cn('flex', i % 2 === 0 && 'justify-end')}>
            <div className="h-8 animate-pulse rounded-lg bg-muted" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
      <Loading
        label="Reading the Transcript…"
        className="items-center text-center"
        hint={terminal && 'This is taking a while. The terminal preview still works.'}
        action={
          terminal &&
          !terminal.open && (
            <Button variant="outline" size="xs" className="h-6 gap-1" onClick={terminal.show}>
              <TerminalSquare className="size-3.5" />
              Show terminal
            </Button>
          )
        }
      />
    </div>
  );
}
