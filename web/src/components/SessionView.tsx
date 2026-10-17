import type { ChatPage, EndTarget, SessionRow } from '@shared/types.ts';
import { ChevronDown, CircleSlash, FolderGit2, GitBranch, Info, Power, SendHorizontal, TerminalSquare } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { turnRunning } from '@/lib/activity';
import type { Chat as ChatState, Preview } from '@/lib/store';
import { HARNESS_NAME, STATUS_LABEL, location } from '@/lib/sessions';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Chat } from './Chat';
import { ChatActivity } from './ChatActivity';
import { HarnessIcon } from './HarnessIcon';
import { PaneHeader, ShellCell, ShellView } from './Shell';
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
  /** VIEW-5.6: ends the confirmed process of the Session; rejects with a message for people. */
  onEnd(sessionId: string, target: EndTarget): Promise<void>;
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
  onEnd,
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

  // SIDE-8.1: header, then the chat with the Terminal row in the content row, then the dock: the
  // composer (or the ended / View only banner) and the status line, under the shell's dock line.
  return (
    <ShellView>
      <Header row={row} ended={ended} now={now} onEnd={onEnd} />
      <ShellCell row="body" className="flex flex-col overflow-hidden">
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
        {controls && <Drawer open={drawerOpen} onToggle={() => onToggleDrawer(row, !drawerOpen)} preview={preview} />}
      </ShellCell>
      <ShellCell row="dock">
        {ended ? (
          <Footer
            icon={<CircleSlash className="size-4" />}
            title="This Session ended"
            detail="Its process is gone. The composer and terminal preview are closed; it stays here until you select another Session."
          />
        ) : !row.controllable ? (
          <Footer
            icon={<Info className="size-4" />}
            title="View only: this Session runs in another app"
            detail="Lookout can show it, but can't type into it or read its terminal, so there's no composer, preview or answer buttons. Sessions started from Lookout are Controllable."
          />
        ) : (
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
        )}
        <StatusLine row={row} />
      </ShellCell>
    </ShellView>
  );
}

/**
 * VIEW-5.1: title, Harness, Status and actions, on one line. Where it works, and its model, are in
 * the status line (VIEW-5.5); what a Needs you Session waits for is in the chat's Needs you row
 * (VIEW-1.10), so the header row keeps one height for every Session.
 */
function Header({ row, ended, now, onEnd }: { row: SessionRow; ended: boolean; now: number; onEnd: SessionViewProps['onEnd'] }) {
  const age = row.statusSince !== null ? formatAge(now - row.statusSince) : null;
  const title = useRef<HTMLHeadingElement>(null);
  return (
    <PaneHeader aria-label="Session">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {!ended && <StatusMarker status={row.status} />}
        <h1
          ref={title}
          tabIndex={-1}
          className={cn('min-w-0 truncate text-[15px] font-semibold tracking-tight outline-none', ended && 'text-muted-foreground')}
          title={row.title}
        >
          {row.title}
        </h1>
        <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-muted-foreground" data-field="harness">
          <HarnessIcon harness={row.harness} className="size-4" />
          {HARNESS_NAME[row.harness]}
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
        {/* ITERM's "Open in iTerm2" and VIEW-4's Stop go here too. */}
        <div data-slot="header-actions" className="flex shrink-0 items-center gap-1.5 empty:hidden">
          <EndSession row={row} eligible={!ended && row.controllable && row.ownHost} onEnd={onEnd} fallbackFocus={title} />
        </div>
      </div>
    </PaneHeader>
  );
}

/**
 * VIEW-5.6: "End Session", for a Controllable Session in a Session host of its own, after an
 * in-app confirmation. Once Fleet has closed it, the Session list drops it and the view shows it
 * as ended (VIEW-5.3, VIEW-5.7).
 *
 * The dialog binds to the process it opened on (pid and start time), so a Session restarted
 * meanwhile is never the one closed. It stays mounted while open or ending even when the button
 * goes (another Session joins the host, say), so the refusal that follows is still shown. It is
 * mounted per view, not per id, so a Codex Session getting its session id keeps it too.
 *
 * On close, focus goes back to the button; once it's gone, or about to go after a successful
 * end, to the header's title.
 */
function EndSession({
  row,
  eligible,
  onEnd,
  fallbackFocus,
}: {
  row: SessionRow;
  eligible: boolean;
  onEnd: SessionViewProps['onEnd'];
  fallbackFocus: RefObject<HTMLElement | null>;
}) {
  const [target, setTarget] = useState<EndTarget | null>(null);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const endedHere = useRef(false);
  const open = target !== null;
  const unconfirmed = target?.procStart === null;
  const close = () => setTarget(null);
  const confirm = async () => {
    if (ending || !target || unconfirmed) return;
    setEnding(true);
    setError(null);
    try {
      await onEnd(row.id, target);
      endedHere.current = true;
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't end it.");
    } finally {
      setEnding(false);
    }
  };
  return (
    <>
      {eligible && (
        <Button
          ref={trigger}
          variant="outline"
          size="xs"
          className="h-7 gap-1.5 px-2 text-[12px]"
          onClick={() => {
            setError(null);
            endedHere.current = false;
            setTarget({ pid: row.pid, procStart: row.procStart });
          }}
        >
          <Power className="size-3.5" />
          End Session
        </Button>
      )}
      <Dialog open={open} onOpenChange={(next) => !ending && !next && close()}>
        <DialogContent
          className="sm:max-w-md"
          showCloseButton={false}
          // The button opens it from outside Radix's trigger, so focus goes back to it by hand.
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const back = !endedHere.current && trigger.current?.isConnected ? trigger.current : fallbackFocus.current;
            back?.focus();
          }}
        >
          <DialogTitle className="text-[15px]">End “{row.title}”?</DialogTitle>
          <DialogDescription className="text-[13px] leading-5">
            {HARNESS_NAME[row.harness]} is asked to exit, then its Session host is closed. Work it hasn&apos;t finished stops. Its chat stays
            readable here, and you can resume it from History.
          </DialogDescription>
          {(unconfirmed || error) && (
            <p role="alert" className="rounded-md border border-destructive/30 px-2.5 py-2 text-[12.5px] text-destructive">
              {unconfirmed ? 'Lookout can’t confirm it’s the same Session, so it won’t end it. Close it in the terminal.' : error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={close} disabled={ending}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void confirm()} disabled={ending || unconfirmed}>
              {ending ? 'Ending…' : 'End Session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * VIEW-5.5: where the Session works, its model and context use, on one line under the composer
 * (at the bottom of the pane when there's none), like a terminal's status line. At narrow widths
 * each part truncates; the whole line is in its tooltip.
 */
function StatusLine({ row }: { row: SessionRow }) {
  const loc = location(row);
  const where = row.git ? row.git.repo : row.cwd;
  const context = row.contextPct !== null ? `${row.contextPct}% context` : null;
  const parts = [where, loc?.name, row.model, context].filter((p): p is string => !!p);
  if (!parts.length) return null;
  const dot = (
    <span aria-hidden className="shrink-0 opacity-60">
      ·
    </span>
  );
  return (
    <div
      role="group"
      aria-label="Status line"
      title={parts.join(' · ')}
      className="flex h-7 min-w-0 shrink-0 items-center gap-1.5 overflow-hidden border-t border-border/70 bg-muted/30 px-5 font-mono text-[11.5px] whitespace-nowrap text-muted-foreground"
    >
      {where && (
        <span className="min-w-0 truncate" data-field={row.git ? 'repo' : 'cwd'} title={row.cwd ?? undefined}>
          {where}
        </span>
      )}
      {loc && (
        <>
          {where && dot}
          <span className="flex min-w-0 items-center gap-1" data-field="location" title={loc.name}>
            {loc.kind === 'worktree' ? (
              <FolderGit2 aria-label="Worktree" className="size-3.5 shrink-0" />
            ) : (
              <GitBranch aria-label="Branch" className="size-3.5 shrink-0" />
            )}
            <span className="truncate">{loc.name}</span>
          </span>
        </>
      )}
      {row.model && (
        <>
          {(where || loc) && dot}
          <span className="min-w-0 truncate" data-field="model" title={row.model}>
            {row.model}
          </span>
        </>
      )}
      {context && (
        <>
          {(where || loc || row.model) && dot}
          <span className="shrink-0" data-field="context">
            {context}
          </span>
        </>
      )}
    </div>
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
    // SIDE-8.1: on a short window the preview gives way, down to its Terminal row, before the chat does.
    <section className="flex min-h-0 flex-col border-t border-border" aria-label="Terminal preview">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full shrink-0 items-center gap-2 px-5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground"
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
          className="h-64 min-h-0 overflow-auto bg-muted/40 px-5 py-2 font-mono text-[11.5px] leading-[1.45] whitespace-pre text-foreground/90 dark:bg-black/25"
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
      className="flex-1 px-4 py-3"
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
          className="field-sizing-content max-h-[min(12rem,20dvh)] min-h-6 flex-1 resize-none bg-transparent text-[13.5px] leading-6 outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" size="sm" className="h-7 shrink-0 gap-1.5" disabled={sending || text.trim() === ''}>
          {sending ? 'Sending…' : 'Send'}
          <SendHorizontal className="size-3.5" />
        </Button>
      </div>
      {/* One line, so a narrow main pane doesn't grow the dock row (SIDE-8.1). */}
      <p className="mt-1.5 truncate text-[11px] text-muted-foreground" title="Enter sends · Shift+Enter for a new line · i to type here · Esc to leave">
        Enter sends · Shift+Enter for a new line · <kbd className="font-mono">i</kbd> to type here · Esc to leave
      </p>
    </form>
  );
}

/** The ended / View only banner. Its detail stops at two lines (full text on hover), so a narrow main pane doesn't grow the dock row (SIDE-8.1). */
function Footer({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div role="status" className="flex flex-1 items-start gap-2.5 bg-muted/50 px-5 py-3.5">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{title}</p>
        <p className="line-clamp-2 text-[12.5px] leading-5 text-muted-foreground" title={detail}>
          {detail}
        </p>
      </div>
    </div>
  );
}

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}
