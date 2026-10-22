import type { AnswerRequest, ChatPage, EndTarget, RenameResult, SessionRow } from '@shared/types.ts';
import { Check, ChevronDown, CircleSlash, CircleStop, Copy, FolderGit2, GitBranch, Info, OctagonX, Power, SendHorizontal, TerminalSquare } from 'lucide-react';
import { type ComponentPropsWithRef, type ComponentPropsWithoutRef, type KeyboardEvent, type ReactNode, type RefObject, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { turnRunning } from '@/lib/activity';
import { useCopy } from '@/lib/copy';
import { type Echo, NO_ECHOES, settleEchoes, shown } from '@/lib/echoes';
import {
  type AnswerAttempt,
  AnswerContext,
  type Answering,
  type Draft,
  type DraftKeeper,
  ESC_HINT,
  type QuestionDrafts,
  type ScreenState,
  type SendFailure,
  type StopRequest,
  escButton,
  permissionPanel,
  processKey,
  questionPanel,
  sendErrorText,
  stopButton,
} from '@/lib/answers';
import type { HarnessState } from '@/lib/launch';
import { FROM_NEXT_REPLY, MODEL_DEFAULT_NOTE, MODEL_WHY, type ModelTarget, canSwitchModel, checkedModel, modelOptions, plainModelWhy, shownModel } from '@/lib/model-switch';
import type { SwitchState } from '@/lib/status-switch';
import type { Chat as ChatState, Preview } from '@/lib/store';
import { CONTEXT_LEVEL_CLASS, HARNESS_NAME, STATUS_LABEL, STATUS_TAG_CLASS, contextLevel, location } from '@/lib/sessions';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';
import { PromptCard } from './Answering';
import { Chat } from './Chat';
import { ChatActivity } from './ChatActivity';
import { HarnessIcon } from './HarnessIcon';
import { useSessionTitle } from './SessionTitle';
import { PaneHeader, ShellCell, ShellView } from './Shell';
import { StatusMarker } from './StatusMarker';
import { StatusMenu } from './StatusMenu';

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
  /** VIEW-4.6: a question's picks and text per Session, then question, kept while switching. */
  questionDrafts: QuestionDrafts;
  /** Sessions with a send in flight. */
  sending: ReadonlySet<string>;
  /** VIEW-3.4: the last failed send per Session; VIEW-3.7: with why Fleet held it, when it did. */
  sendErrors: ReadonlyMap<string, SendFailure>;
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
  /** VIEW-5.12: renames the Session through Fleet; rejects with a message for people (VIEW-5.14). */
  onRename(row: SessionRow, name: string): Promise<RenameResult>;
  /** VIEW-6.1: the Harnesses and their models (LAUNCH-3.2), for the model menu. */
  models: HarnessState;
  /** VIEW-6.1: the model menu opened: read the models again. */
  onLoadModels(): void;
  /**
   * VIEW-6: switches the Session's model through Fleet, for the process the menu was opened on
   * (`opened`); App keeps how it went per Session process, and opens the Terminal preview when it
   * can't tell (VIEW-6.8).
   */
  onSwitchModel(row: SessionRow, model: string, opened: ModelTarget): void;
  /** VIEW-6.3/6.7/6.8: the Session process's model switch, as App keeps it. */
  modelSwitch: SwitchState | undefined;
  /** VIEW-4.2: the prompt on the Session's terminal, as the server last read it. */
  screen: ScreenState | undefined;
  /** VIEW-4: the latest answer sent to this Session, and what came of it. */
  attempt: AnswerAttempt | undefined;
  /** VIEW-4.1–4.3: answers the prompt; App keeps the outcome (and opens the terminal on a refusal). */
  onAnswer(row: SessionRow, req: AnswerRequest): void;
  /** VIEW-4.4/4.5: the last Stop, or Esc, pressed for this Session. */
  stopRequest: StopRequest | undefined;
  onStop(row: SessionRow): void;
  /** VIEW-4.5: presses Esc in a Session that Needs you with no answer buttons. */
  onEsc(row: SessionRow): void;
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
  questionDrafts,
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
  onRename,
  models,
  onLoadModels,
  onSwitchModel,
  modelSwitch,
  screen,
  attempt,
  onAnswer,
  stopRequest,
  onStop,
  onEsc,
}: SessionViewProps) {
  const controls = row.controllable && !ended;

  // VIEW-4: the permission prompt's buttons under the chat, and the question that can be answered in it.
  const permission = permissionPanel(row, ended, screen, attempt);
  const question = questionPanel(row, ended, chat?.entries ?? [], screen, attempt, now);
  const questionId = question?.id ?? null;
  const questionPhase = question?.phase ?? null;
  const questionMessage = question?.message ?? null;
  // VIEW-4.5: Esc, where Lookout offers no answer buttons for what the Session waits on.
  const esc = escButton(row, ended, screen, { permission, question }, attempt, stopRequest, now);
  const showTerminal = () => onToggleDrawer(row, true);
  // The epoch of the last read of the screen goes with every answer: the server refuses one read
  // before another tab's answer, or before it started (0 before any read: the question's buttons
  // wait, locked, for the first one).
  const epoch = screen?.epoch ?? 0;
  const latest = useRef({ row, onAnswer, showTerminal, epoch });
  useLayoutEffect(() => {
    latest.current = { row, onAnswer, showTerminal, epoch };
  });
  // VIEW-4.6: a question's picks and text, kept by App while a read takes its form away, or
  // another Session is viewed.
  const keptDrafts = useMemo<DraftKeeper>(
    () => ({
      get: (id) => questionDrafts.get(row.id)?.get(id),
      set: (id, d) => {
        const kept = questionDrafts.get(row.id) ?? new Map<string, readonly Draft[]>();
        questionDrafts.set(row.id, kept.set(id, d));
      },
    }),
    [questionDrafts, row.id],
  );
  // Stable while nothing it holds changes, so the chat's memoized rows don't re-render every second.
  const answering = useMemo<Answering>(
    () => ({
      panel: questionId && questionPhase ? { id: questionId, phase: questionPhase, message: questionMessage } : null,
      submit: (id, answers) => latest.current.onAnswer(latest.current.row, { kind: 'question', question: id, answers, epoch: latest.current.epoch }),
      terminal: { open: drawerOpen, show: () => latest.current.showTerminal() },
      drafts: keptDrafts,
    }),
    [questionId, questionPhase, questionMessage, drawerOpen, keptDrafts],
  );

  // VIEW-1.10: "Working…" shows the moment you send, before Status catches up. A send while a turn
  // runs is queued behind it and keeps the turn's time. A failed send puts back the time it
  // replaced, unless a newer send has replaced it since.
  const sentAt = sentAtBySession.get(row.id) ?? null;

  // VIEW-1.13: your message shows at once, dimmed, until its copy from the Transcript reaches the
  // chat. Local state: this view is mounted per Session, so selecting another drops them. While the
  // chat can't show them they're hidden, not dropped, and don't time out: the Session reads as ended
  // (a Codex Session getting its session id reads so for a render before App follows it, and this
  // view keeps its key across that), or its chat hasn't loaded (no Transcript, VIEW-1.8). While the
  // chat shows a feed problem they show but don't time out: a copy may be on its way.
  const [echoes, setEchoes] = useState<readonly Echo[]>(NO_ECHOES);
  const echoIds = useRef(0);
  const hidden = ended || !chat?.loaded;
  const settled = settleEchoes(echoes, {
    entries: chat?.entries ?? [],
    queue: chat?.queue ?? [],
    status: row.status,
    statusSince: row.statusSince,
    hidden,
    paused: !!chat?.problem,
    now,
  });
  if (settled !== echoes) setEchoes(settled);
  const visible = useMemo(() => (hidden ? NO_ECHOES : shown(settled)), [hidden, settled]);
  // A message whose copy never came opens the Terminal preview once, as an outcome Lookout can't be
  // sure of does (VIEW-4.3).
  const lost = visible.reduce((max, e) => (e.state === 'lost' ? Math.max(max, e.id) : max), 0);
  const lostShown = useRef(0);
  useEffect(() => {
    if (lost <= lostShown.current) return;
    lostShown.current = lost;
    latest.current.showTerminal();
  }, [lost]);

  const send = async (sessionId: string, text: string) => {
    const at = Date.now();
    const id = ++echoIds.current;
    setEchoes((list) => [...list, { id, text, at, since: at, state: 'waiting' }]);
    const entries = chat?.entries ?? [];
    let sent: boolean;
    if (turnRunning({ status: row.status, statusSince: row.statusSince, entries, sentAt, now: at })) {
      sent = await onSend(sessionId, text);
    } else {
      const previous = sentAt ?? undefined;
      onSentAt(sessionId, () => at);
      sent = await onSend(sessionId, text);
      if (!sent) onSentAt(sessionId, (current) => (current === at ? previous : current));
    }
    // A failed send takes its message away; one that went through drops the lost ones: you've seen
    // them, and moved on.
    const drop = (e: Echo) => (sent ? e.state === 'lost' : e.id === id);
    setEchoes((list) => (list.some(drop) ? list.filter((e) => !drop(e)) : list));
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
      <Header
        row={row}
        ended={ended}
        now={now}
        onEnd={onEnd}
        onRename={onRename}
        stop={stopButton(row, ended, stopRequest, now)}
        onStop={() => onStop(row)}
        esc={esc}
        onEsc={() => onEsc(row)}
      />
      <ShellCell row="body" className="flex flex-col overflow-hidden">
        <AnswerContext.Provider value={answering}>
          <Chat
            sessionId={row.id}
            harness={row.harness}
            chat={chat}
            ended={ended}
            onEarlier={onEarlier}
            onPage={onPage}
            onFollowing={onFollowing}
            echoes={visible}
            activity={
              <>
                {permission && (
                  <PromptCard
                    panel={permission}
                    label={HARNESS_NAME[row.harness]}
                    onChoose={(n) => permission.prompt && onAnswer(row, { kind: 'permission', prompt: permission.prompt.id, choice: n, epoch })}
                    terminal={answering.terminal}
                  />
                )}
                <ChatActivity row={row} ended={ended} entries={chat?.entries} sentAt={sentAt} />
              </>
            }
          />
        </AnswerContext.Provider>
        {controls && <Drawer open={drawerOpen} onToggle={() => onToggleDrawer(row, !drawerOpen)} preview={preview} />}
      </ShellCell>
      <ShellCell row="dock">
        {ended ? (
          <DockNote
            role="status"
            icon={<CircleSlash className="size-4" />}
            title="This Session ended"
            detail="Its process is gone. The composer and terminal preview are closed; it stays here until you select another Session."
          />
        ) : !row.controllable ? (
          <DockNote
            role="status"
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
            error={sendErrorText(sendErrors.get(row.id), esc !== null)}
            onEdit={onEdit}
            onSend={send}
            inputRef={composerRef}
          />
        )}
        <StatusLine
          row={row}
          ended={ended}
          models={models}
          onLoadModels={onLoadModels}
          onSwitchModel={onSwitchModel}
          modelSwitch={modelSwitch}
        />
      </ShellCell>
    </ShellView>
  );
}

/**
 * VIEW-5.1: title, Harness, Status and actions, on one line. Where it works, and its model, are in
 * the status line (VIEW-5.5); what a Needs you Session waits for is in the chat's Needs you row
 * (VIEW-1.10), so the header row keeps one height for every Session.
 */
function Header({
  row,
  ended,
  now,
  onEnd,
  onRename,
  stop,
  onStop,
  esc,
  onEsc,
}: {
  row: SessionRow;
  ended: boolean;
  now: number;
  onEnd: SessionViewProps['onEnd'];
  onRename: SessionViewProps['onRename'];
  stop: ReturnType<typeof stopButton>;
  onStop(): void;
  esc: ReturnType<typeof escButton>;
  onEsc(): void;
}) {
  const age = row.statusSince !== null ? formatAge(now - row.statusSince) : null;
  const title = useRef<HTMLHeadingElement>(null);
  // VIEW-5.12–5.14: the title renames the Session in place; why a rename failed sits beside it.
  const renamed = useSessionTitle({ row, ended, now, onRename, headingRef: title });
  const stopErrorId = useId();
  // VIEW-4.4 Stop while Busy, or VIEW-4.5 Esc while it Needs you: never both (one Status at a time).
  const key: EscKeyProps | null = stop
    ? { label: 'Stop', pressingLabel: 'Stopping…', hint: null, icon: <CircleStop className="size-3.5" />, pressing: stop.stopping, error: stop.error, onPress: onStop }
    : esc
      ? { label: 'Esc', pressingLabel: 'Pressing Esc…', hint: ESC_HINT, icon: <OctagonX className="size-3.5" />, pressing: esc.pressing, error: esc.error, onPress: onEsc }
      : null;
  return (
    // Positioned, so the bubble with Stop's whole error sizes to the pane and stays inside it.
    <PaneHeader aria-label="Session" className="@container relative">
      {/* One line, whatever is in it, and the buttons always whole: only they never shrink. Stop's
          error gets only the room left over (at least 3rem) and is cut to fit; the title gives way
          next, down to an ellipsis. A narrow header drops the Harness's name and the Status's age
          (below 32rem), then the buttons' words (below 26rem; they keep them as their names and
          tooltips), then the inline error (below 20rem; Stop's tooltip and description keep it).
          Narrower still, what's left of the line before the buttons is cut off, never the buttons:
          it's a box of its own (its 4 px of padding keep the error's focus ring). */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap" data-slot="header-row">
        <div data-slot="header-info" className="flex min-w-0 flex-1 items-center gap-2.5 overflow-x-clip pr-1">
          {!ended && <StatusMarker status={row.status} />}
          {renamed.title}
          <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-muted-foreground" data-field="harness">
            <HarnessIcon harness={row.harness} className="size-4" />
            <span className="@max-[32rem]:sr-only">{HARNESS_NAME[row.harness]}</span>
          </span>
          <span
            className={cn(
              'ml-auto shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium',
              // VIEW-5.9: in its Status's colour; the age in the same colour (dimmed, it fell below 4.5:1).
              ended ? 'bg-muted text-muted-foreground' : STATUS_TAG_CLASS[row.status],
            )}
            data-field="status"
          >
            {ended ? 'Ended' : STATUS_LABEL[row.status]}
            {!ended && age && <span className="font-normal @max-[32rem]:hidden"> · {age}</span>}
          </span>
          {renamed.note && <HeaderNote slot="rename-note" id={renamed.note.id} message={renamed.note.message} tone={renamed.note.tone} />}
          {key?.error && <HeaderNote slot="stop-error" id={stopErrorId} message={key.error} />}
        </div>
        {/* ITERM's "Open in iTerm2" goes here too. */}
        <div data-slot="header-actions" className="flex shrink-0 items-center gap-1.5 empty:hidden">
          {key && <EscKey {...key} errorId={stopErrorId} />}
          <EndSession row={row} eligible={!ended && row.controllable && row.ownHost} onEnd={onEnd} fallbackFocus={title} />
          {/* VIEW-5.10: last, so it keeps its place whether Stop, Esc or End Session show. A
              Session without a session_id has `<harness>:<pid>` for its id: no button then. */}
          {row.id !== processKey(row) && <CopySessionId sessionId={row.id} />}
        </div>
      </div>
    </PaneHeader>
  );
}

/**
 * VIEW-5.10: copies the Session's session_id, for resuming it or finding it with `tb-session`.
 * Icon-only, its tooltip the whole ID; "Copied" (or "Couldn't copy") shows beside the icon for 2 s
 * as the code blocks' copy button does (VIEW-1.14), and goes below 26rem like the other buttons'
 * words. The button keeps its name; the outcome is read out in a polite status.
 */
function CopySessionId({ sessionId }: { sessionId: string }) {
  const { state, said, copy } = useCopy(sessionId);
  return (
    <>
      <Button
        variant="outline"
        size="xs"
        className={cn('h-7 shrink-0 gap-1.5 px-2 text-[12px]', state === 'failed' && 'text-destructive hover:text-destructive')}
        aria-label="Copy session ID"
        title={`Copy session ID: ${sessionId}`}
        data-copy={state}
        onClick={() => void copy()}
      >
        {state === 'copied' ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        {said && (
          <span aria-hidden className="@max-[26rem]:sr-only">
            {said}
          </span>
        )}
      </Button>
      <span role="status" className="sr-only">
        {said}
      </span>
    </>
  );
}

interface EscKeyProps {
  label: string;
  /** What it reads while the Esc is on its way and for 10 s after. */
  pressingLabel: string;
  /** Its tooltip when it isn't pressing: what it does (VIEW-4.5's Esc); null to show its label. */
  hint: string | null;
  icon: ReactNode;
  pressing: boolean;
  error: string | null;
  onPress(): void;
}

/**
 * VIEW-4.4: Stop, while the Session is Busy: one click, one Esc. Then "Stopping…", disabled until
 * the Status leaves Busy or 10 s pass, since in Claude Code a second Esc opens its rewind menu.
 * VIEW-4.5: the Esc button is the same for a Session that Needs you with no answer buttons
 * ("Pressing Esc…" until the Status leaves Needs you), its tooltip saying what Esc does there.
 * Why the last one failed is its tooltip and its description too, so it's there when the header
 * is too narrow to show it beside the button; there, the button turns the error's colour instead.
 */
function EscKey({ label, pressingLabel, hint, icon, pressing, error, errorId, onPress }: EscKeyProps & { errorId: string }) {
  const shown = pressing ? pressingLabel : label;
  const tip = pressing ? pressingLabel : (hint ?? label);
  return (
    <Button
      variant="outline"
      size="xs"
      className={cn('h-7 shrink-0 gap-1.5 px-2 text-[12px]', error && '@max-[20rem]:text-destructive')}
      title={error ? `${tip}\n${error}` : tip}
      aria-describedby={error ? errorId : undefined}
      disabled={pressing}
      onClick={onPress}
    >
      {icon}
      <span className="@max-[26rem]:sr-only">{shown}</span>
    </Button>
  );
}

/**
 * VIEW-4.4: why Stop failed, beside it; VIEW-5.14: why a rename failed, or that it was sent but
 * doesn't show yet (`info`, muted rather than the error colour). It gets only the room the header has
 * left over (flex basis 0, at least 3rem) and is cut to fit, so the header stays one line and the
 * buttons stay whole; the whole text shows on hover or focus, in a bubble under the header that
 * moves nothing and stays inside the pane. Below 20rem of header it isn't shown (it and its gap go):
 * Stop's tooltip and description carry it, as the title's tooltip does a rename's, and a hidden
 * alert (or status, for `info`) says it to assistive tech.
 */
function HeaderNote({ slot, id, message, tone = 'error' }: { slot: 'stop-error' | 'rename-note'; id: string; message: string; tone?: 'error' | 'info' }) {
  const role = tone === 'error' ? 'alert' : 'status';
  return (
    <>
      <span role={role} data-slot={`${slot}-narrow`} className="sr-only hidden @max-[20rem]:block">
        {message}
      </span>
      <div role={role} data-slot={slot} data-tone={tone} className="group flex min-w-12 flex-[1_1_0] justify-end @max-[20rem]:hidden">
        <span
          id={id}
          tabIndex={0}
          className={cn(
            'min-w-0 truncate rounded-sm text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring',
            tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {message}
        </span>
        {/* Placed against the header (positioned): right-5 and the width cap (the pane less 1.25rem on each side) keep it inside the pane. */}
        <span
          aria-hidden
          data-slot={`${slot}-full`}
          className="pointer-events-none absolute top-full right-5 z-30 mt-1 hidden w-max max-w-[min(28rem,calc(100%-2.5rem))] rounded-md border border-border bg-popover px-2.5 py-1.5 text-[12px] whitespace-normal text-popover-foreground shadow-md group-focus-within:block group-hover:block"
        >
          {message}
        </span>
      </div>
    </>
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
          className="h-7 shrink-0 gap-1.5 px-2 text-[12px]"
          title="End Session"
          onClick={() => {
            setError(null);
            endedHere.current = false;
            setTarget({ pid: row.pid, procStart: row.procStart });
          }}
        >
          <Power className="size-3.5" />
          <span className="@max-[26rem]:sr-only">End Session</span>
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
 * each part truncates; the whole line is in its tooltip. VIEW-5.11: the Effort follows the model.
 * VIEW-6: for a Controllable Claude Code Session, the model's name is a menu that switches it.
 */
function StatusLine({
  row,
  ended,
  models,
  onLoadModels,
  onSwitchModel,
  modelSwitch,
}: {
  row: SessionRow;
  ended: boolean;
  models: HarnessState;
  onLoadModels(): void;
  onSwitchModel: SessionViewProps['onSwitchModel'];
  modelSwitch: SwitchState | undefined;
}) {
  const loc = location(row);
  const where = row.git ? row.git.repo : row.cwd;
  const context = row.contextPct !== null ? `${row.contextPct}% context` : null;
  const ctxLevel = row.contextPct !== null ? contextLevel(row.contextPct) : null;
  const effort = row.effort;
  // VIEW-6.7: a switched model shows at once, marked, until the next reply reaches the Transcript.
  const model = shownModel(row);
  const modelPart = model ? (model.pending ? `${model.id} (${FROM_NEXT_REPLY})` : model.id) : null;
  const plainWhy = plainModelWhy(row, ended);
  const parts = [where, loc?.name, modelPart, effort, context].filter((p): p is string => !!p);
  if (!parts.length) return null;
  const dot = (
    <span aria-hidden className="shrink-0 opacity-60">
      ·
    </span>
  );
  return (
    <StatusBar role="group" aria-label="Status line" title={parts.join(' · ')}>
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
      {model && (
        <>
          {(where || loc) && dot}
          {canSwitchModel(row, ended) ? (
            <ModelMenu row={row} model={model} models={models} onLoadModels={onLoadModels} onSwitchModel={onSwitchModel} modelSwitch={modelSwitch} />
          ) : (
            <span className="min-w-0 truncate" data-field="model" title={plainWhy ? `${model.id}\n${plainWhy}` : model.id}>
              {model.id}
            </span>
          )}
        </>
      )}
      {effort && (
        <>
          {(where || loc || model) && dot}
          <span className="min-w-0 truncate" data-field="effort" title={effort}>
            {effort}
          </span>
        </>
      )}
      {context && (
        <>
          {(where || loc || model || effort) && dot}
          <span
            className={cn('shrink-0', ctxLevel && CONTEXT_LEVEL_CLASS[ctxLevel])}
            data-field="context"
            data-level={ctxLevel ?? undefined}
          >
            {context}
          </span>
        </>
      )}
    </StatusBar>
  );
}

/**
 * VIEW-6.1–6.9: the model's name as a menu of the other Claude models Fleet lists. Disabled, its
 * tooltip saying why, while the Session isn't Idle or a switch runs; the pick also becomes Claude
 * Code's default, and the menu says so. A pick is for the process the menu was opened on.
 */
function ModelMenu({
  row,
  model,
  models,
  onLoadModels,
  onSwitchModel,
  modelSwitch,
}: {
  row: SessionRow;
  model: { id: string; pending: boolean };
  models: HarnessState;
  onLoadModels(): void;
  onSwitchModel: SessionViewProps['onSwitchModel'];
  modelSwitch: SwitchState | undefined;
}) {
  const options = modelOptions(models);
  const switching = modelSwitch?.switching ?? false;
  const opened = useRef<ModelTarget | null>(null);
  const why = switching ? MODEL_WHY.switching : row.status === 'idle' ? null : MODEL_WHY[row.status];
  return (
    <StatusMenu
      field="model"
      name="Model"
      value={model.id}
      note={model.pending ? FROM_NEXT_REPLY : null}
      why={why}
      switching={switching}
      options={options}
      checked={checkedModel(options, model.id)}
      footnote={MODEL_DEFAULT_NOTE}
      error={modelSwitch?.error ?? null}
      onOpen={() => {
        opened.current = { pid: row.pid, procStart: row.procStart };
        onLoadModels();
      }}
      onPick={(value) => onSwitchModel(row, value, opened.current ?? { pid: row.pid, procStart: row.procStart })}
    />
  );
}

/** The status line's one-line bar, also a past Session's "where it ran" and part of DockRest (SIDE-8.1). */
export function StatusBar({ className, ...rest }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn(
        'flex h-7 min-w-0 shrink-0 items-center gap-1.5 overflow-hidden border-t border-border/70 bg-muted/30 px-5 font-mono text-[11.5px] whitespace-nowrap text-muted-foreground',
        className,
      )}
      {...rest}
    />
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
    <ComposerFrame
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      error={error}
      field={{
        ref: inputRef,
        'aria-label': 'Message',
        placeholder: `Message ${title}…`,
        value: text,
        onChange: (e) => update(e.target.value),
        onKeyDown,
        'aria-invalid': error ? true : undefined,
      }}
      send={{
        disabled: sending || text.trim() === '',
        children: (
          <>
            {sending ? 'Sending…' : 'Send'}
            <SendHorizontal className="size-3.5" />
          </>
        ),
      }}
      hint={
        <>
          Enter sends · Shift+Enter for a new line · <kbd className="font-mono">i</kbd> to type here · Esc to leave
        </>
      }
      hintTitle="Enter sends · Shift+Enter for a new line · i to type here · Esc to leave"
    />
  );
}

interface ComposerFrameProps extends Omit<ComponentPropsWithoutRef<'form'>, 'children'> {
  /** VIEW-3.4: the last failed send's error, above the box. */
  error?: string | null;
  /** The message field. */
  field?: ComponentPropsWithRef<'textarea'>;
  /** The Send button, its label included. */
  send?: ComponentPropsWithoutRef<typeof Button>;
  /** The one-line hint under the box, its full text in `hintTitle`. */
  hint?: ReactNode;
  hintTitle?: string;
}

/**
 * The composer's layout: the box with the field and Send, and the hint under it. The Composer fills
 * it in; DockRest draws it empty, so the dock row's resting height is this layout's own (SIDE-8.1).
 * An empty field is one line high whatever its placeholder: it sizes to its content only once it
 * holds text, and the placeholder stays on one line, cut short with an ellipsis.
 */
function ComposerFrame({ error, field, send, hint, hintTitle, className, ...form }: ComposerFrameProps) {
  return (
    <form className={cn('flex-1 px-4 py-3', className)} {...form}>
      {error && (
        <p role="alert" className="mb-2 text-[12.5px] text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-end gap-2 rounded-lg border border-input bg-background px-3 py-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25 dark:bg-input/20">
        <textarea
          rows={1}
          {...field}
          className={cn(
            'max-h-[min(12rem,20dvh)] min-h-6 flex-1 resize-none bg-transparent text-[13.5px] leading-6 outline-none placeholder:text-muted-foreground',
            field?.value ? 'field-sizing-content' : 'field-sizing-fixed truncate placeholder:truncate',
          )}
        />
        <Button type="submit" size="sm" className="h-7 shrink-0 gap-1.5" {...send} />
      </div>
      <p className="mt-1.5 h-4 truncate text-[11px] leading-4 text-muted-foreground" title={hintTitle}>
        {hint}
      </p>
    </form>
  );
}

/**
 * SIDE-8.1: the dock row's resting height, drawn by the real parts: an empty one-line composer with
 * the status line's bar under it, invisible. The Session sidebar's dock cell holds it under the usage
 * panel, so the row has this height at rest in every view, with or without a main-pane dock, and it
 * can't drift from the composer: a change to either is a change to both.
 */
export function DockRest() {
  return (
    <div aria-hidden inert data-dock-rest="" className="invisible flex flex-col">
      <ComposerFrame />
      <StatusBar />
    </div>
  );
}

/**
 * SIDE-8.1: a note in the dock where the composer would be (the ended / View only banner, a past
 * Session's note). Its title stays on one line and its detail on two, focused or not, so it fits the
 * resting dock and never grows it. When that cuts the text short, hovering the text or Tabbing to it
 * shows the full text in an overlay that opens upward over the chat; Esc, or a click on the overlay,
 * closes it. Its containing block is the view (ShellView), outside the dock cell's scroll box, so it
 * neither moves the dock nor is cut off by it, and it stays inside the main pane: 1.25rem in from
 * either side and no taller than the room above the dock line, so it never covers History. It takes
 * the pointer, so a click on it never reaches what is underneath. Screen readers read the full text
 * in the note itself; the overlay repeats it and is hidden from them, like the chat rail's tooltip.
 */
export function DockNote({ role, icon, title, detail }: { role: 'status' | 'note'; icon: ReactNode; title: string; detail: string }) {
  // Hover and focus are kept apart, like the chat rail's tooltip: the pointer leaving doesn't hide
  // it while the text has focus. Only keyboard focus counts: a mouse click focuses the text too,
  // but doesn't hold the overlay open once the pointer leaves.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // Esc or a click on the overlay closes it until the text is hovered or focused again.
  const [dismissed, setDismissed] = useState(false);
  // Whether the clamp cuts the text short: with nothing hidden there is nothing to show.
  const [clipped, setClipped] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const open = clipped && (hovered || focused) && !dismissed;

  const measure = useCallback(() => {
    const text = textRef.current;
    if (!text) return;
    setClipped([...text.children].some((p) => p.scrollWidth > p.clientWidth || p.scrollHeight > p.clientHeight));
    // The overlay's bottom edge sits just above the dock line whatever its height, so the room
    // above it in the view, less a small margin, caps its height (it scrolls past that).
    const overlay = overlayRef.current;
    const view = text.closest('[data-shell-view]');
    if (overlay && view) {
      const room = overlay.getBoundingClientRect().bottom - view.getBoundingClientRect().top - 8;
      overlay.style.maxHeight = room > 0 ? `${room}px` : '';
    }
  }, []);
  useLayoutEffect(() => measure(), [measure, open, title, detail]);
  // Re-measured when the text or the view resizes (the window, History opening or closing).
  useEffect(() => {
    const text = textRef.current;
    if (!text || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(text);
    const view = text.closest('[data-shell-view]');
    if (view) ro.observe(view);
    return () => ro.disconnect();
  }, [measure]);
  // Esc closes it wherever focus is, so an overlay opened by hover can be closed too.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setDismissed(true);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div role={role} className="flex flex-1 items-start gap-2.5 bg-muted/50 px-5 py-3.5">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <div
        ref={textRef}
        tabIndex={0}
        data-dock-note-text=""
        onMouseEnter={() => {
          measure();
          setDismissed(false);
          setHovered(true);
        }}
        onMouseLeave={() => setHovered(false)}
        onFocus={(e) => {
          measure();
          setDismissed(false);
          setFocused(e.currentTarget.matches(':focus-visible'));
        }}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          // Esc with the overlay open only closes it: it doesn't also reach the app's own Esc keys.
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setDismissed(true);
          }
        }}
        className="min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <p className="truncate text-[13px] font-medium">{title}</p>
        <p className="line-clamp-2 text-[12.5px] leading-5 text-muted-foreground">{detail}</p>
      </div>
      {open && (
        // -mt-5 lifts it by the note's top padding (py-3.5) and 6 px more, clear of the dock line.
        // left-5 and the width caps (the pane less 1.25rem on each side) keep it inside the pane at
        // any width. A press on it keeps focus where it is, so the click lands on it and only closes it.
        <div
          ref={overlayRef}
          role="tooltip"
          aria-hidden
          data-dock-note-overlay=""
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setDismissed(true)}
          className="absolute left-5 z-30 -mt-5 w-max max-w-[min(40rem,calc(100%-2.5rem))] min-w-[min(16rem,calc(100%-2.5rem))] -translate-y-full cursor-default overflow-y-auto rounded-md border border-border bg-popover px-3 py-2 break-words text-popover-foreground shadow-md"
        >
          <p className="text-[13px] font-medium">{title}</p>
          <p className="text-[12.5px] leading-5 text-muted-foreground">{detail}</p>
        </div>
      )}
    </div>
  );
}

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}
