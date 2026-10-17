import type { ChatEntry, ChatPage, Harness } from '@shared/types.ts';
import { ArrowDown, ChevronRight, CircleHelp, FileX, MessagesSquare, Wrench } from 'lucide-react';
import { type ReactNode, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/ui/button';
import { type ChatItem, type QuestionEntry, type ToolCall, answerFor, chatItems, clockTime, toolsLabel } from '@/lib/chat';
import { HARNESS_NAME } from '@/lib/sessions';
import type { Chat as ChatState } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Markdown } from './Markdown';

/** At most this far from the bottom still counts as "at the bottom" (VIEW-1.5). */
const BOTTOM_SLACK_PX = 48;
const NONE: readonly ChatEntry[] = [];

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
}

/** VIEW-1: the conversation from the Transcript. Mounted per Session. */
export function Chat({ sessionId, harness, chat, ended, onEarlier, onPage, onFollowing }: ChatProps) {
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState<string | null>(null);
  const entries = chat?.entries ?? NONE;
  const queue = chat?.queue ?? NONE;
  const before = chat?.before ?? null;
  const items = useMemo(() => chatItems(entries), [entries]);

  // VIEW-1.5: follow new entries while at the bottom; once scrolled up, stay put.
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [following, setFollowing] = useState(true);
  const [unseen, setUnseen] = useState(0);
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
  }, [entries, queue, before, chat?.loaded, chat?.problem]);

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
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
    atBottom.current = bottom;
    setFollowing(bottom);
    if (bottom) setUnseen(0);
  };

  // Sizes change without a scroll: the pane shrinks (the terminal drawer opens), or a row
  // expands. A shrinking pane keeps following the bottom; anything else just re-checks where
  // you are, so "Jump to latest" shows when the bottom moved out of view.
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let height = el.clientHeight;
    const ro = new ResizeObserver(() => {
      if (el.clientHeight !== height && atBottom.current) el.scrollTop = el.scrollHeight;
      height = el.clientHeight;
      const bottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
      atBottom.current = bottom;
      setFollowing(bottom);
    });
    ro.observe(el);
    if (content.current) ro.observe(content.current);
    return () => ro.disconnect();
  }, [chat?.loaded]);

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    // Instantly: a smooth scroll would pass through "not at the bottom" and flicker the button.
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
  } else if (items.length === 0 && queue.length === 0 && !before) {
    // A Session before its first prompt: an empty conversation, not an error.
    body = (
      <Notice icon={<MessagesSquare className="size-5 opacity-60" />} title="No messages yet">
        The conversation shows here once it starts.
      </Notice>
    );
  } else {
    body = (
      <ol className="mx-auto flex w-full max-w-3xl flex-col gap-3.5 px-6 py-5" aria-label="Messages">
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
        {items.map((item, i) => (
          <li key={item.key}>
            <Row item={item} label={label} startsTurn={startsTurn(items, i)} />
          </li>
        ))}
        {queue.map((q) => (
          <li key={`queue:${q.cursor}`} data-queued>
            <Prompt entry={q} queued />
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
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto" aria-label="Chat" data-testid="chat">
        <div ref={content} className="flex min-h-full flex-col">
          {body}
        </div>
      </div>
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
  );
}

/** The Harness's name heads its first reply after a prompt, tool calls in between or not. */
function startsTurn(items: ChatItem[], i: number): boolean {
  for (let j = i - 1; j >= 0; j--) {
    const prev = items[j]!;
    if (prev.type === 'tools') continue; // tool calls before the first reply are part of the turn
    return prev.entry.kind === 'user' || prev.entry.kind === 'command';
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
      return <Prompt entry={e} queued={false} />;
    case 'command':
      return (
        <div className="flex flex-col items-end" data-kind="command">
          <Meta who="You" ts={e.ts} />
          <code className="max-w-[85%] rounded-md border border-border px-2.5 py-1 font-mono text-[12.5px] break-all">{e.text}</code>
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
  }
}

/** Your prompt; a queued one waits in the Harness's queue and isn't part of the history yet (VIEW-3.3). */
function Prompt({ entry, queued }: { entry: ChatEntry; queued: boolean }) {
  const text = entry.kind === 'user' ? entry.text : '';
  return (
    <div className="flex flex-col items-end" data-kind="user">
      <Meta who="You" ts={entry.ts} extra={queued ? 'queued' : null} />
      <div
        className={cn(
          'max-w-[85%] rounded-lg bg-muted px-3.5 py-2 text-[13.5px] leading-[1.6] break-words whitespace-pre-wrap',
          queued && 'border border-dashed border-border bg-transparent text-muted-foreground',
        )}
      >
        {text}
      </div>
    </div>
  );
}

function Meta({ who, ts, extra = null }: { who: string; ts: string | null; extra?: string | null }) {
  const time = clockTime(ts);
  return (
    <p className="mb-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
      <span className="font-medium text-foreground/80">{who}</span>
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
        <span className="min-w-0 truncate font-mono text-[11.5px]" title={c.summary}>
          {c.summary}
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
              <span className="min-w-0 truncate font-mono text-[11.5px]" title={c.summary}>
                {c.summary}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** VIEW-1.9: a question with its options; once answered, the answer. Answering is VIEW-4. */
function Question({ entry, label }: { entry: QuestionEntry; label: string }) {
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
      <div className="space-y-3">
        {entry.questions.map((q, qi) => {
          const { picked, other } = answerFor(q, entry.status === 'answered' ? entry.answer : null, qi);
          return (
            <section key={qi} aria-label={q.header || q.question}>
              {q.header && <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{q.header}</p>}
              <p className="text-[13.5px] font-medium">{q.question}</p>
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
                      <span aria-hidden className="w-3.5 shrink-0 text-center text-muted-foreground">
                        {q.multiSelect ? (chosen ? '☑' : '☐') : chosen ? '●' : '○'}
                      </span>
                      <span className="min-w-0">
                        {o.label}
                        {o.description && <span className="block text-[12px] font-normal text-muted-foreground">{o.description}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {other && (
                <p className="mt-1.5 text-[13px]">
                  <span className="text-muted-foreground">Answered: </span>
                  {other}
                </p>
              )}
            </section>
          );
        })}
      </div>
      {entry.status === 'pending' && (
        <p className="mt-2.5 text-[12px] text-muted-foreground">Answer it in the terminal; answering from here comes later.</p>
      )}
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
