import type { ChatPage, SessionRow } from '@shared/types.ts';
import { ChevronDown, CircleSlash, FolderGit2, GitBranch, Info, SendHorizontal, TerminalSquare } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { turnRunning } from '@/lib/activity';
import type { Chat as ChatState, Preview } from '@/lib/store';
import { HARNESS_NAME, STATUS_LABEL, location } from '@/lib/sessions';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Chat } from './Chat';
import { ChatActivity } from './ChatActivity';
import { HarnessIcon } from './HarnessIcon';
import { StatusMarker } from './StatusMarker';

export interface SessionViewProps {
  row: SessionRow;
  /** The Session's process is gone (SIDE-4.3); `row` is the last one seen. */
  ended: boolean;
  now: number;
  preview: Preview | null;
  /** VIEW-2.2: whether the terminal drawer is open (App decides, so it reports one state). */
  drawerOpen: boolean;
  onToggleDrawer(row: SessionRow, open: boolean): void;
  /** Unsent drafts per Session, kept while switching (VIEW-3.5). */
  drafts: Map<string, string>;
  /** Sessions with a send in flight. */
  sending: ReadonlySet<string>;
  /** VIEW-3.4: the last failed send per Session. */
  sendErrors: ReadonlyMap<string, string>;
  /** The box was edited: its error is stale. */
  onEdit(sessionId: string): void;
  /** Resolves true once sent; false when it failed (App keeps the error) or one is in flight. */
  onSend(sessionId: string, text: string): Promise<boolean>;
  /** VIEW-1: the chat as the server pushed it; null until it starts. */
  chat: ChatState | null;
  /** VIEW-1.6: "Show earlier": fetches a page, then hands it back with `onPage`. */
  onEarlier(sessionId: string, before: string): Promise<ChatPage>;
  onPage(sessionId: string, before: string, epoch: number, page: ChatPage): void;
  /** VIEW-1.5: whether you're at the bottom of the chat. */
  onFollowing(sessionId: string, following: boolean): void;
  /** VIEW-1.10: when you last sent to each Session from the composer, kept while switching. */
  sentAt: ReadonlyMap<string, number>;
  /** Sets a Session's send time from its current one; undefined clears it. */
  onSentAt(sessionId: string, update: (current: number | undefined) => number | undefined): void;
}

/** VIEW: the selected Session. Mounted per Session (`key`), so its local state is its own. */
export function SessionView({
  row,
  ended,
  now,
  preview,
  drawerOpen,
  onToggleDrawer,
  drafts,
  sending,
  sendErrors,
  onEdit,
  onSend,
  chat,
  onEarlier,
  onPage,
  onFollowing,
  sentAt: sentAtBySession,
  onSentAt,
}: SessionViewProps) {
  const controls = row.controllable && !ended;

  // VIEW-1.10: "Working…" shows the moment you send, before Status catches up. A send while a turn
  // runs is queued behind it and keeps the turn's time. A failed send puts back the time it
  // replaced, unless a newer send has replaced it since.
  const sentAt = sentAtBySession.get(row.id) ?? null;
  const send = async (sessionId: string, text: string) => {
    const at = Date.now();
    const entries = chat?.entries ?? [];
    if (turnRunning({ status: row.status, statusSince: row.statusSince, entries, sentAt, now: at })) return onSend(sessionId, text);
    const previous = sentAt ?? undefined;
    onSentAt(sessionId, () => at);
    const sent = await onSend(sessionId, text);
    if (!sent) onSentAt(sessionId, (current) => (current === at ? previous : current));
    return sent;
  };

  const composerRef = useRef<HTMLTextAreaElement>(null);
  // VIEW-3.6: `i` focuses the composer when focus isn't in a text field.
  useEffect(() => {
    if (!controls) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'i' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing || e.defaultPrevented) return;
      if (isTextField(e.target) || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      composerRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controls]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header row={row} ended={ended} now={now} />
      <Chat
        sessionId={row.id}
        harness={row.harness}
        chat={chat}
        ended={ended}
        onEarlier={onEarlier}
        onPage={onPage}
        onFollowing={onFollowing}
        activity={<ChatActivity row={row} ended={ended} entries={chat?.entries} sentAt={sentAt} />}
      />
      {ended ? (
        <Footer icon={<CircleSlash className="size-4" />} title="This Session ended">
          Its process is gone. The composer and terminal preview are closed; it stays here until you select another Session.
        </Footer>
      ) : !row.controllable ? (
        <Footer icon={<Info className="size-4" />} title="View only: this Session runs in another app">
          Lookout can show it, but can&apos;t type into it or read its terminal, so there&apos;s no composer, preview or answer
          buttons. Sessions started from Lookout are Controllable.
        </Footer>
      ) : (
        <>
          <Drawer open={drawerOpen} onToggle={() => onToggleDrawer(row, !drawerOpen)} preview={preview} />
          <Composer
            key={row.id}
            sessionId={row.id}
            title={row.title}
            drafts={drafts}
            sending={sending.has(row.id)}
            error={sendErrors.get(row.id) ?? null}
            onEdit={onEdit}
            onSend={send}
            inputRef={composerRef}
          />
        </>
      )}
    </div>
  );
}

/** VIEW-5.1: title, Harness, model, Status, repo, Worktree or branch, context usage. */
function Header({ row, ended, now }: { row: SessionRow; ended: boolean; now: number }) {
  const loc = location(row);
  const age = row.statusSince !== null ? formatAge(now - row.statusSince) : null;
  return (
    <header className="shrink-0 border-b border-border px-5 py-3" aria-label="Session">
      <div className="flex items-center gap-2.5">
        {!ended && <StatusMarker status={row.status} />}
        <h1 className={cn('min-w-0 truncate text-[15px] font-semibold tracking-tight', ended && 'text-muted-foreground')} title={row.title}>
          {row.title}
        </h1>
        <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-muted-foreground" data-field="harness-model">
          <HarnessIcon harness={row.harness} className="size-4" />
          {HARNESS_NAME[row.harness]}
          {row.model && <> · {row.model}</>}
        </span>
        <span
          className={cn(
            'ml-auto shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium',
            ended
              ? 'bg-muted text-muted-foreground'
              : row.status === 'needs-you'
                ? 'bg-needs-you-soft text-needs-you-text'
                : 'bg-muted text-foreground/80',
          )}
          data-field="status"
        >
          {ended ? 'Ended' : STATUS_LABEL[row.status]}
          {!ended && age && <span className="font-normal opacity-70"> · {age}</span>}
        </span>
        {/* ITERM's "Open in iTerm2" and VIEW-4's Stop go here. */}
        <div data-slot="header-actions" className="flex shrink-0 items-center gap-1.5 empty:hidden" />
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
        {row.git ? (
          <span className="shrink-0" data-field="repo">
            {row.git.repo}
          </span>
        ) : (
          row.cwd && (
            <span className="min-w-0 truncate" title={row.cwd}>
              {row.cwd}
            </span>
          )
        )}
        {loc && (
          <>
            <span aria-hidden>·</span>
            <span className="flex min-w-0 items-center gap-1" data-field="location">
              {loc.kind === 'worktree' ? (
                <FolderGit2 aria-label="Worktree" className="size-3.5 shrink-0" />
              ) : (
                <GitBranch aria-label="Branch" className="size-3.5 shrink-0" />
              )}
              <span className="truncate">{loc.name}</span>
            </span>
          </>
        )}
        {row.contextPct !== null && (
          <>
            <span aria-hidden>·</span>
            <span className="shrink-0 whitespace-nowrap" data-field="context">
              {row.contextPct}% context
            </span>
          </>
        )}
      </div>
      {!ended && row.status === 'needs-you' && row.waitingFor && (
        <p className="mt-1 truncate text-[12.5px] font-medium text-needs-you-text" title={row.waitingFor}>
          Waiting for: {row.waitingFor}
        </p>
      )}
    </header>
  );
}

/** VIEW-2: the terminal's last lines, as plain text. */
function Drawer({ open, onToggle, preview }: { open: boolean; onToggle(): void; preview: Preview | null }) {
  const preRef = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight; // the bottom is what matters
  }, [preview?.text, open]);
  return (
    <section className="shrink-0 border-t border-border" aria-label="Terminal preview">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      >
        <TerminalSquare className="size-3.5" />
        Terminal
        {open && preview?.error && <span className="truncate font-normal text-needs-you-text">{preview.error} · retrying</span>}
        <ChevronDown className={cn('ml-auto size-3.5 transition-transform', !open && '-rotate-90')} />
      </button>
      {open && (
        <pre
          ref={preRef}
          data-testid="terminal-preview"
          className="h-64 overflow-auto bg-muted/40 px-5 py-2 font-mono text-[11.5px] leading-[1.45] whitespace-pre text-foreground/90 dark:bg-black/25"
        >
          {preview?.text ?? (preview?.error ? '' : 'Loading…')}
        </pre>
      )}
    </section>
  );
}

interface ComposerProps {
  sessionId: string;
  title: string;
  drafts: Map<string, string>;
  sending: boolean;
  error: string | null;
  onEdit(sessionId: string): void;
  onSend(sessionId: string, text: string): Promise<boolean>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

/** VIEW-3: Enter sends, Shift+Enter adds a line; a failed send keeps the text. */
function Composer({ sessionId, title, drafts, sending, error, onEdit, onSend, inputRef }: ComposerProps) {
  const [text, setText] = useState(() => drafts.get(sessionId) ?? '');
  // A send that finished while this box was remounted: App cleared the stored draft only if it
  // was still exactly what was sent, so an empty draft means the box holds the sent text.
  const [wasSending, setWasSending] = useState(sending);
  if (wasSending !== sending) {
    setWasSending(sending);
    if (!sending && text !== '' && !drafts.has(sessionId)) setText('');
  }

  const update = (value: string) => {
    setText(value);
    onEdit(sessionId);
    if (value) drafts.set(sessionId, value);
    else drafts.delete(sessionId);
  };

  const submit = async () => {
    if (sending || text.trim() === '') return;
    const sent = text;
    // On success, clear the box only if it still holds what was sent (App does the same for the
    // stored draft), so text typed meanwhile stays. A failure's error is kept by App.
    if (await onSend(sessionId, sent)) setText((current) => (current === sent ? '' : current));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  return (
    <form
      className="shrink-0 border-t border-border px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {error && (
        <p role="alert" className="mb-2 text-[12.5px] text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-end gap-2 rounded-lg border border-input bg-background px-3 py-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25 dark:bg-input/20">
        <textarea
          ref={inputRef}
          aria-label="Message"
          placeholder={`Message ${title}…`}
          rows={1}
          value={text}
          onChange={(e) => update(e.target.value)}
          onKeyDown={onKeyDown}
          aria-invalid={error ? true : undefined}
          className="field-sizing-content max-h-48 min-h-6 flex-1 resize-none bg-transparent text-[13.5px] leading-6 outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" size="sm" className="h-7 shrink-0 gap-1.5" disabled={sending || text.trim() === ''}>
          {sending ? 'Sending…' : 'Send'}
          <SendHorizontal className="size-3.5" />
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Enter sends · Shift+Enter for a new line · <kbd className="font-mono">i</kbd> to type here · Esc to leave
      </p>
    </form>
  );
}

function Footer({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div role="status" className="flex shrink-0 items-start gap-2.5 border-t border-border bg-muted/50 px-5 py-3.5">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div>
        <p className="text-[13px] font-medium">{title}</p>
        <p className="text-[12.5px] leading-5 text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}
