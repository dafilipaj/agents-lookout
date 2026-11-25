import type { LocalServer, PortsSnapshot } from '@shared/ports.ts';
import type { EvidenceView } from '@shared/evidence.ts';
import type { AnswerRequest, ChangesView, ChatPage, EndTarget, Harness, RenameResult, SessionRow } from '@shared/types.ts';
import { Check, ChevronDown, CircleCheck, CircleSlash, FolderGit2, GitBranch, Hourglass, Info, Paperclip, SendHorizontal, TerminalSquare } from 'lucide-react';
import { type ComponentPropsWithRef, type ComponentPropsWithoutRef, Fragment, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button, ButtonDivider } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { StatusTag, StatusTagAction } from '@/components/ui/status-tag';
import { PART_ROW_STATIC, PartRowContent, type PartLook } from '@/components/ui/status-part';
import { Loading } from '@/components/ui/loading';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { turnRunning } from '@/lib/activity';
import { type ComposerAttachments, attachmentDrag, carriesFileUri, fromDrop, fromPaste, insertion } from '@/lib/attachments';
import { type CommandListControl, useCommandList } from '@/lib/command-list';
import type { ComposerCommands } from '@/lib/commands';
import { insertText } from '@/lib/insert-text';
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
  unreadQuestion,
} from '@/lib/answers';
import type { HarnessState } from '@/lib/launch';
import { canSwitchEffort, checkedEffort, effortFootnote, effortOptions, effortUnverified, shownEffort } from '@/lib/effort-switch';
import { type ModelTarget, canSwitchModel, checkedModel, modelFootnote, modelLabel, modelOptions, shownModel } from '@/lib/model-switch';
import { FROM_NEXT_REPLY, type MenuOptions, type SwitchState, type SwitchWhat, plainWhy, switchWhy } from '@/lib/status-switch';
import type { Chat as ChatState, Preview } from '@/lib/store';
import { chipText, sessionServers } from '@/lib/ports';
import { BACKGROUND_SHELL_TIP, CONTEXT_LEVEL_CLASS, HARNESS_NAME, STATUS_LABEL, STATUS_TAG_CLASS, contextLevel, location, locationTip, queuedTip } from '@/lib/sessions';
import { FOLD_RANK, type FoldingPart, LOCATION_MIN_CHARS, MORE_ORDER, type StatusPart, foldParts } from '@/lib/status-fold';
import { HEIGHT_STEP, clampHeight, drawerHeight, heightBounds, keepHeight, parseHeights, readHeightsRaw, subscribeHeights } from '@/lib/terminal-height';
import { clockTime } from '@/lib/chat';
import { formatAge, useClock } from '@/lib/time';
import { cn } from '@/lib/utils';
import { PromptCard } from './Answering';
import { Chat, type ChatSeen, type HeldMessage } from './Chat';
import { ChatActivity } from './ChatActivity';
import { HarnessIcon } from './HarnessIcon';
import { CommandsPopover } from './Commands';
import { KeysHint } from './KeysHint';
import { useSessionTitle } from './SessionTitle';
import { PaneHeader, ShellCell, ShellView } from './Shell';
import { StatusMarker } from './StatusMarker';
import { StatusMenu } from './StatusMenu';
import { ChangesButton, type ChangesButtonProps } from './ChangesButton';
import { DoneEvidenceLine, EvidenceButton, EvidencePart, EvidencePopover } from './Evidence';
import { PortsChip } from './PortsChip';
import { StatusMore } from './StatusMore';
import { SubagentsButton, type SubagentsButtonProps } from './SubagentsButton';
import { changesTip, hasLines } from '@/lib/changes';
import { AddToTopicButton, TopicHeaderLinks } from './TopicLinks';
import { rowMember } from '@/lib/topics';
import { ActionIcon } from '@/lib/actions';
import { type HandoffWait, type ShownLink, canHandOff } from '@/lib/handoff';
import { HandOffButton, HandoffLinks } from './HandOff';

/** HAND: each Session's wait for its Handover, and what can be done with it and with its links (App keeps them). */
export interface HandoffControls {
  waits: ReadonlyMap<string, HandoffWait>;
  /** HAND-1.3: sends the request, with the piece when one is given. */
  write(row: SessionRow, piece: string): void;
  /** HAND-2.1: stops waiting. */
  cancel(row: SessionRow): void;
  /** HAND-2.3: opens the launcher with the Handover; `opener` gets focus back if it closes without a start. */
  launch(row: SessionRow, opener: HTMLElement | null): void;
  /** HAND-4: the Session's links, resolved against the live Sessions. */
  links(row: SessionRow): { from: ShownLink | null; into: ShownLink[] };
  /** HAND-4.1, HAND-4.2: opens a linked Session: live, or past, read-only. */
  open(link: ShownLink): void;
}

export interface SessionViewProps {
  attachments: ComposerAttachments;
  /** VIEW-15: the `/` lists the tab has read, for the composer. */
  commands?: ComposerCommands;
  /** VIEW-13: what you saw of a Session's chat when you last left it, and keeping it as you leave. */
  loadChatSeen?(sessionId: string): Promise<ChatSeen | null>;
  saveChatSeen?(sessionId: string, seen: ChatSeen, keepalive: boolean): Promise<void>;
  /** VIEW-3.9: a sent message waits 3 s in the composer, with Undo (SIDE-7.7). */
  undoSend?: boolean;
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
  /** LAUNCH-7.4: the first prompt of the start this Session took over from, and when it started; read once, when the view mounts. */
  arrival?: { text: string; at: number } | null;
  /** Sets a Session's send time from its current one; undefined clears it. */
  onSentAt(sessionId: string, update: (current: number | undefined) => number | undefined): void;
  /** VIEW-5.6: ends the confirmed process of the Session; rejects with a message for people. */
  onEnd(sessionId: string, target: EndTarget): Promise<void>;
  /** VIEW-5.12: renames the Session through Fleet; rejects with a message for people (VIEW-5.14). */
  onRename(row: SessionRow, name: string): Promise<RenameResult>;
  /** VIEW-6.1, VIEW-7.1: the Harnesses, their models and levels (LAUNCH-3.2), for the status line's menus. */
  models: HarnessState;
  /** VIEW-6.1, VIEW-7.1: a status-line menu opened: read the models again. */
  onLoadModels(): void;
  /**
   * VIEW-6, VIEW-7: switches the Session's model or Effort through Fleet, for the process the menu
   * was opened on (`opened`); App keeps how it went per Session process, and opens the Terminal
   * preview when it can't tell (VIEW-6.8, VIEW-7.8).
   */
  onSwitch(what: SwitchWhat, row: SessionRow, value: string, opened: ModelTarget): void;
  /** VIEW-6.3/6.7/6.8, VIEW-7.3/7.7/7.8: the Session process's switch, model or Effort, as App keeps it. */
  statusSwitch: SwitchState | undefined;
  /** DIFF-3: the changed files of the Session whose list is open, as the server last sent them. */
  changes?: ReadonlyMap<string, ChangesView | null>;
  /** DIFF-3.6: the Session's list of changed files opened or closed. */
  onChangesOpen?(sessionId: string, open: boolean): void;
  /** EVID: each Session's Evidence, as the server last sent it. */
  evidence?: ReadonlyMap<string, EvidenceView>;
  /** DIFF-4: opens a changed file's Changes in VS Code; rejects with the reason to show. */
  onOpenChange?(sessionId: string, root: string, path: string): Promise<void>;
  /** PLAIN-3.1: a changed `.plain` file opens in the Spec view. */
  onOpenSpec?(sessionId: string, checkout: string, path: string): void;
  /** EVID-6.6: a headless reviewer's Session opens read-only, as HIST-3.3's Show opens one. */
  onShowReviewer?(harness: Harness, sessionId: string): void;
  /** PLAIN-3.3: the Checkout's changed Modules that are Viewed. */
  plainViewed?(sessionId: string, checkout: string): Promise<string[]>;
  /** PORTS-2: the Local servers, as the server last sent them; the chip shows this Session's. */
  ports?: PortsSnapshot | null;
  /** PORTS-2.2: opens the Servers tab at a Session's group. */
  onShowServers?(sessionId: string): void;
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
  /** HAND: "Hand off…" and the links; absent, neither shows. */
  handoff?: HandoffControls;
  /** TOPIC-16.4: the Session sidebar's list, for the header's Topics' markers; absent, no Topic link. */
  sessions?: ReadonlyMap<string, SessionRow>;
}

/** VIEW: the selected Session. Mounted per Session (`key`), so its local state is its own. */
export function SessionView({
  loadChatSeen,
  saveChatSeen,
  undoSend = false,
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
  arrival = null,
  onEnd,
  onRename,
  models,
  onLoadModels,
  onSwitch,
  statusSwitch,
  changes,
  onChangesOpen,
  evidence,
  onOpenChange,
  onOpenSpec,
  onShowReviewer,
  plainViewed,
  ports,
  onShowServers,
  screen,
  attempt,
  onAnswer,
  stopRequest,
  onStop,
  onEsc,
  attachments,
  commands,
  handoff,
  sessions,
}: SessionViewProps) {
  const controls = row.controllable && !ended;
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const resetDrag = () => { dragDepth.current = 0; setDragging(false); };
  useEffect(() => {
    const reset = () => { dragDepth.current = 0; setDragging(false); };
    const cancel = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') reset(); };
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
    window.addEventListener('blur', reset);
    window.addEventListener('keydown', cancel);
    return () => { window.removeEventListener('dragend', reset); window.removeEventListener('drop', reset); window.removeEventListener('blur', reset); window.removeEventListener('keydown', cancel); };
  }, []);
  const accepts = (target: EventTarget) => controls && target instanceof Element && target.closest('[data-shell-row]')?.getAttribute('data-shell-row') !== 'header';

  // VIEW-4: the permission prompt's buttons under the chat, and the question that can be answered in it.
  const permission = permissionPanel(row, ended, screen, attempt);
  const question = questionPanel(row, ended, chat?.entries ?? [], screen, attempt, now);
  // VIEW-4.10: a question form the chat doesn't have yet: say so where its options would be.
  const unread = unreadQuestion(row, ended, chat?.entries ?? [], screen, attempt, now);
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
  // VIEW-12.3: a turn runs, so the chat's last run of steps is live.
  const running = !ended && turnRunning({ status: row.status, statusSince: row.statusSince, entries: chat?.entries ?? [], sentAt, now });

  // VIEW-1.13: your message shows at once, dimmed, until its copy from the Transcript reaches the
  // chat. Local state: this view is mounted per Session, so selecting another drops them. While the
  // chat can't show them they're hidden, not dropped, and don't time out: the Session reads as ended
  // (a Codex Session getting its session id reads so for a render before App follows it, and this
  // view keeps its key across that), or its chat hasn't loaded (no Transcript, VIEW-1.8). While the
  // chat shows a feed problem they show but don't time out: a copy may be on its way.
  //
  // LAUNCH-7.4: a start's first prompt is one of them from the moment its Session takes over, and
  // shows even before the chat loads, with "Working…" counted from Start in place of the chat's
  // skeleton, until its copy takes its place.
  const [arrivedAt] = useState(arrival?.at ?? null);
  const [echoes, setEchoes] = useState<readonly Echo[]>(() => (arrival ? [{ id: ARRIVAL, text: arrival.text, at: arrival.at, since: arrival.at, state: 'waiting' }] : NO_ECHOES));
  // VIEW-3.9: the composer's message waiting to go (Undo send), shown after the echoes.
  const [held, setHeld] = useState<Omit<HeldMessage, 'onUndo'> | null>(null);
  const undoHeld = useRef<() => void>(() => {});
  const echoIds = useRef(arrival ? ARRIVAL : 0);
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
  // Until the chat shows a problem before it loaded (no Transcript, VIEW-1.8): then the chat says
  // so, and "Working…" follows the Session's Status, as for any Session.
  const arriving =
    arrivedAt !== null && !ended && !(hidden && chat?.problem) && settled.some((e) => e.id === ARRIVAL && e.state === 'waiting') ? arrivedAt : null;
  const visible = useMemo(() => (!hidden ? shown(settled) : arriving !== null ? settled.filter((e) => e.id === ARRIVAL) : NO_ECHOES), [hidden, settled, arriving]);
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

  // EVID-5: the Session's Evidence, its popover open from the status line or the Done card, never both.
  const evidenceView = !ended ? (evidence?.get(row.id) ?? null) : null;
  const [evidenceOpen, setEvidenceOpen] = useState<'status' | 'card' | null>(null);
  const [changesRequest, setChangesRequest] = useState(0);
  // What the popover shows while it closes after the Evidence went (EVID-5.8).
  const [shownEvidence, setShownEvidence] = useState<EvidenceView | null>(evidenceView);
  if (evidenceView && evidenceView !== shownEvidence) setShownEvidence(evidenceView);
  const toChanges = useRef(false);
  // EVID-5.8: whether each opener is still there when a popover's focus returns (it returns after the commit).
  const cardShown = !!row.done && !ended;
  if (evidenceOpen === 'card' && !cardShown) setEvidenceOpen(null);
  const openers = useRef({ view: evidenceView, card: cardShown });
  useLayoutEffect(() => {
    openers.current = { view: evidenceView, card: cardShown };
  });
  const evidenceShown = (from: 'status' | 'card') => !!shownEvidence && (!!evidenceView || evidenceOpen === from);
  const evidencePopover = (from: 'status' | 'card', trigger: (view: EvidenceView) => ReactNode, look: PartLook = 'line') =>
    shownEvidence && evidenceShown(from) ? (
      <EvidencePopover
        view={shownEvidence}
        // EVID-5.8: the Evidence went: it closes, and stays mounted until its focus has moved.
        open={!!evidenceView && evidenceOpen === from}
        // Opening one opener's popover closes the other's, whose own close mustn't undo it.
        onOpenChange={(open) => setEvidenceOpen((cur) => (open ? from : cur === from ? null : cur))}
        // VIEW-5.19: from a row of the status line's "N more", beside the row.
        side={look === 'row' ? 'right' : 'top'}
        align={from === 'status' && look === 'line' ? 'start' : 'end'}
        trigger={trigger(shownEvidence)}
        onOpenFile={(f) => {
          // PLAIN-3.1: a `.plain` Module opens in the Spec view, as the changed-files list opens it.
          if (onOpenSpec && f.path.endsWith('.plain') && !f.binary) {
            setEvidenceOpen(null);
            onOpenSpec(row.id, f.checkout, f.path);
            return Promise.resolve();
          }
          return onOpenChange ? onOpenChange(row.id, f.root, f.path) : Promise.reject(new Error("Lookout can't open files here."));
        }}
        onOpenChanges={() => {
          toChanges.current = true;
          setEvidenceOpen(null);
        }}
        onShowReviewer={(harness, id) => {
          // EVID-6.6: the popover closes and the reviewer opens in the main pane.
          setEvidenceOpen(null);
          onShowReviewer?.(harness, id);
        }}
        onCloseAutoFocus={(e) => {
          if (toChanges.current) {
            // EVID-5.4: the changed-files list opens and takes focus (DIFF-3.4).
            toChanges.current = false;
            e.preventDefault();
            setChangesRequest((n) => n + 1);
          } else if (!openers.current.view || (from === 'card' && !openers.current.card)) {
            // EVID-5.8: its opener is going (the Evidence went, or the Done card), so focus goes where the
            // Session view would have it (DIFF-3.3).
            e.preventDefault();
            setEvidenceOpen((cur) => (cur === from ? null : cur));
            focusComposerOrChat(composerRef.current);
          }
        }}
      />
    ) : null;
  const statusEvidence = evidenceShown('status') ? (look: PartLook) => evidencePopover('status', (view) => <EvidencePart evidence={view.verdict} look={look} />, look) : null;
  const cardEvidence = evidencePopover('card', () => <EvidenceButton />);

  // VIEW-3.6: `i` (or `I` with Caps Lock on, never with Shift) focuses the composer when focus isn't in a text field.
  useEffect(() => {
    if (!controls) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'i' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing || e.defaultPrevented) return;
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
    <ShellView
      onDragEnter={e => {
        if (accepts(e.target) && attachmentDrag(e.dataTransfer)) { e.preventDefault(); dragDepth.current++; setDragging(true); }
      }}
      onDragOver={e => {
        if (accepts(e.target) && attachmentDrag(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
      }}
      onDragLeave={e => {
        if (dragDepth.current > 0 && --dragDepth.current === 0) resetDrag();
        if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) resetDrag();
      }}
      onDrop={e => {
        resetDrag();
        if (!accepts(e.target)) return;
        const inputs = fromDrop(e.dataTransfer);
        attachments.clear(row.id);
        if (inputs.length || attachmentDrag(e.dataTransfer)) {
          e.preventDefault();
          void attachments.add(row.id, inputs);
          if (!inputs.length && !carriesFileUri(e.dataTransfer) && e.target === composerRef.current) insertText(composerRef.current, e.dataTransfer.getData('text/plain'));
        }
      }}
    >
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
        handoff={handoff}
        sessions={sessions}
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
            outgoing={held && { ...held, onUndo: () => undoHeld.current() }}
            terminal={controls ? answering.terminal : null}
            running={running}
            loadSeen={loadChatSeen}
            saveSeen={saveChatSeen}
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
                {unread && <PromptCard what="question" panel={{ kind: 'message', prompt: null, message: unread }} label={HARNESS_NAME[row.harness]} onChoose={() => {}} terminal={answering.terminal} />}
                {row.done && !ended && (
                  <DoneCard
                    row={row}
                    onEnd={onEnd}
                    fallbackFocus={composerRef}
                    evidence={shownEvidence && cardEvidence ? <DoneEvidenceLine view={shownEvidence} button={cardEvidence} /> : null}
                  />
                )}
                <ChatActivity row={row} ended={ended} entries={chat?.entries} sentAt={sentAt} arriving={arriving} />
              </>
            }
          />
        </AnswerContext.Provider>
        {controls && <Drawer sessionId={row.id} open={drawerOpen} onToggle={() => onToggleDrawer(row, !drawerOpen)} preview={preview} />}
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
            undoSend={undoSend}
            onHold={setHeld}
            undoRef={undoHeld}
            attachments={attachments}
            dragging={dragging}
            commands={commands}
          />
        )}
        <StatusLine
          row={row}
          ended={ended}
          models={models}
          onLoadModels={onLoadModels}
          onSwitch={onSwitch}
          statusSwitch={statusSwitch}
          focusFallback={() => focusComposerOrChat(composerRef.current)}
          servers={!ended && onShowServers ? sessionServers(ports ?? null, row.id) : []}
          onCompact={compactOffered(row, ended) && !sending.has(row.id) ? () => void send(row.id, '/compact') : null}
          onShowServers={() => onShowServers?.(row.id)}
          evidence={statusEvidence}
          evidenceText={evidenceView?.verdict.short ?? null}
          changes={
            !ended && onChangesOpen && onOpenChange
              ? {
                  sessionId: row.id,
                  changes: row.changes ?? null,
                  list: changes?.get(row.id),
                  onOpenChange: (open) => onChangesOpen(row.id, open),
                  onOpenFile: (root, path) => onOpenChange(row.id, root, path),
                  ...(onOpenSpec ? { onOpenSpec: (checkout: string, path: string) => onOpenSpec(row.id, checkout, path) } : {}),
                  ...(plainViewed ? { plainViewed: (checkout: string) => plainViewed(row.id, checkout) } : {}),
                  // DIFF-3.3: the count went away while its list was open.
                  focusFallback: () => focusComposerOrChat(composerRef.current),
                  openRequest: changesRequest,
                }
              : null
          }
        />
      </ShellCell>
    </ShellView>
  );
}

/** LAUNCH-7.4: the id of a start's first prompt among a view's echoes; the composer's come after it. */
const ARRIVAL = 1;

/** VIEW-5.18: Compact is offered from this much context usage, as Fleet's web app does. */
export const COMPACT_FROM_PCT = 30;

/** VIEW-5.18: a Controllable, Idle, live Session at 30% context or more. */
function compactOffered(row: SessionRow, ended: boolean): boolean {
  return !ended && row.controllable && row.status === 'idle' && row.contextPct !== null && row.contextPct >= COMPACT_FROM_PCT;
}

/**
 * VIEW-5.17: a Done Session's chat ends with what it reported: when, its note, and End Session when
 * the header offers it (its own dialog, the same as the header's).
 */
function DoneCard({ row, onEnd, fallbackFocus, evidence }: { row: SessionRow; onEnd: SessionViewProps['onEnd']; fallbackFocus: RefObject<HTMLElement | null>; evidence: ReactNode }) {
  const at = clockTime(new Date(row.done!.at).toISOString());
  return (
    // The chat's column, as the permission card (PromptCard) sits in it.
    <div className="mx-auto w-full max-w-3xl px-6 pb-3">
      <div role="status" aria-label="Done" className="flex items-start gap-2 rounded-lg border border-ok/40 px-4 py-3 text-body" data-testid="done-card">
        <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Done{at ? ` · ${at}` : ''}</p>
          {row.done!.note && <p className="text-muted-foreground" data-field="done-note">{row.done!.note}</p>}
          {/* EVID-5.5: one line, however many runs; the card never grows past it. */}
          {evidence}
        </div>
        <EndSession row={row} eligible={row.controllable && row.ownHost} onEnd={onEnd} fallbackFocus={fallbackFocus} />
      </div>
    </div>
  );
}

/** DIFF-3.3: the composer, or the chat when the Session is View-only and has none. */
function focusComposerOrChat(composer: HTMLTextAreaElement | null): void {
  if (composer) return composer.focus();
  const chat = document.querySelector<HTMLElement>('[aria-label="Chat"]');
  if (!chat) return;
  if (!chat.hasAttribute('tabindex')) chat.tabIndex = -1;
  chat.focus();
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
  handoff,
  sessions,
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
  handoff?: HandoffControls;
  sessions?: ReadonlyMap<string, SessionRow>;
}) {
  const age = row.statusSince !== null ? formatAge(now - row.statusSince) : null;
  const title = useRef<HTMLHeadingElement>(null);
  // VIEW-5.12–5.14: the title renames the Session in place; why a rename failed sits beside it.
  const renamed = useSessionTitle({ row, ended, now, onRename, headingRef: title });
  const stopErrorId = useId();
  // VIEW-4.4 Stop while Busy, or VIEW-4.5 Esc while it Needs you: never both (one Status at a time).
  const key: EscKeyProps | null = stop
    ? { label: 'Stop', pressingLabel: 'Stopping…', hint: null, icon: <ActionIcon id="stop" />, pressing: stop.stopping, error: stop.error, onPress: onStop }
    : esc
      ? { label: 'Esc', pressingLabel: 'Pressing Esc…', hint: ESC_HINT, icon: <ActionIcon id="esc" />, pressing: esc.pressing, error: esc.error, onPress: onEsc }
      : null;
  const handOff = useHandOff(row, ended, handoff);
  return (
    // Positioned, so the bubble with Stop's whole error sizes to the pane and stays inside it.
    <PaneHeader aria-label="Session" className="@container relative">
      {/* One line, whatever is in it, with the Status tag and the buttons always whole: only they never
          shrink. Stop's error gets only the room left over (at least 3rem), beside the tag that holds Stop,
          and is cut to fit; the title gives way next, down to an ellipsis. A narrow header drops the
          Harness's name and the Status's age (below 32rem), then Stop's or Esc's word (below 26rem; it
          stays its name and tooltip), then the inline error (below 20rem; Stop's tooltip and description
          keep it). Narrower still, what's left of the line before the tag is cut off, never the tag or the
          buttons: it's a box of its own (its 4 px of padding keep the error's focus ring). */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap" data-slot="header-row">
        <div data-slot="header-info" className="flex min-w-0 flex-1 items-center gap-2.5 overflow-x-clip pr-1">
          {!ended && <StatusMarker status={row.status} since={row.statusSince} />}
          {renamed.title}
          <span className="flex shrink-0 items-center gap-1.5 text-meta text-muted-foreground" data-field="harness">
            <HarnessIcon harness={row.harness} tone="brand" className="size-4" />
            <span className="@max-[32rem]:sr-only">{HARNESS_NAME[row.harness]}</span>
          </span>
          {/* HAND-4.1, HAND-4.2: what this Session continues, and what continues it. */}
          {handoff && <HandoffLinks {...handoff.links(row)} onOpen={handoff.open} />}
          {/* TOPIC-16.4: the Topics it's in, after them. */}
          {sessions && <TopicHeaderLinks member={rowMember(row)} sessions={sessions} />}
          {renamed.note && <HeaderNote slot="rename-note" id={renamed.note.id} message={renamed.note.message} tone={renamed.note.tone} />}
          {key?.error && <HeaderNote slot="stop-error" id={stopErrorId} message={key.error} />}
        </div>
        {/* VIEW-5.9: in its Status's colour; the age in the same colour (dimmed, it fell below 4.5:1).
            VIEW-4.4, VIEW-4.5: Stop or Esc sits in it (DS-18.9), so the buttons after it never move. */}
        <StatusTag
          data-field="status"
          className={ended ? 'bg-muted text-muted-foreground' : STATUS_TAG_CLASS[row.status]}
          action={key && <EscKey {...key} errorId={stopErrorId} />}
        >
          {ended ? 'Ended' : STATUS_LABEL[row.status]}
          {!ended && age && (
            <span data-slot="status-age" className="font-normal @max-[32rem]:hidden">
              {' '}
              · {age}
            </span>
          )}
        </StatusTag>
        {/* DS-18.5: the actions are icon buttons, 4 px apart; End Session last, after its divider. ITERM's "Open in iTerm2" goes here too. */}
        <div data-slot="header-actions" className="flex shrink-0 items-center gap-1 empty:hidden">
          {/* HAND-1.1: the first action, for a Controllable Session with a session id that hasn't ended, or that ended with a wait. */}
          {handOff && <HandOffButton {...handOff} />}
          {/* TOPIC-2.2: disabled, saying why, for a Session with no session id yet. */}
          <AddToTopicButton member={rowMember(row)} label={row.title} />
          {/* VIEW-5.10: a Session without a session_id has `<harness>:<pid>` for its id: no button then. */}
          {row.id !== processKey(row) && <CopySessionId sessionId={row.id} />}
          <EndSession row={row} eligible={!ended && row.controllable && row.ownHost} onEnd={onEnd} fallbackFocus={title} inHeader />
        </div>
      </div>
    </PaneHeader>
  );
}

/**
 * HAND-1, HAND-2: "Hand off…"'s state in the header: its popover, opened by the button or `F` (HAND-1.4)
 * when focus isn't in a text field; null where it isn't offered. The popover closes once the wait it
 * showed ends (the launcher opened, or Cancel), and opening it on a ready Handover opens the launcher.
 */
function useHandOff(row: SessionRow, ended: boolean, handoff: HandoffControls | undefined) {
  const [open, setOpen] = useState(false);
  const wait = handoff?.waits.get(row.id);
  // A Session that ended with a wait keeps the button, so its failure, or its Handover, still shows (HAND-2.4).
  const offered = !!handoff && (canHandOff(row, ended) || !!wait);
  const press = useCallback(() => {
    if (!handoff || !offered) return;
    if (wait?.state === 'ready') {
      setOpen(false);
      handoff.launch(row, document.querySelector<HTMLElement>('[data-slot="header-actions"] [data-action="hand-off"]'));
      return;
    }
    if (!wait && row.status !== 'idle') return;
    setOpen(true);
  }, [handoff, offered, wait, row]);
  // A wait that ends while the popover shows it (the launcher opened, or another tab's Cancel) closes it.
  const [shown, setShown] = useState(wait);
  if (shown !== wait) {
    setShown(wait);
    if (open && shown && (shown.state === 'sending' || shown.state === 'writing') && (!wait || wait.state === 'ready')) setOpen(false);
  }
  useEffect(() => {
    if (!offered) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'f' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing || e.defaultPrevented) return;
      if (isTextField(e.target) || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      press();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [offered, press]);
  if (!handoff || !offered) return null;
  return {
    status: row.status,
    ended,
    wait,
    open,
    onPress: press,
    onClose: () => setOpen(false),
    onWrite: (piece: string) => handoff.write(row, piece),
    onCancel: () => {
      handoff.cancel(row);
      setOpen(false);
    },
  };
}

/**
 * VIEW-5.10: copies the Session's session_id, for resuming it or finding it with `tb-session`.
 * An icon button (DS-18.5), its tooltip the whole ID. For 2 s after a click its icon is a check
 * ("Copied"), or the copy icon in the destructive colour ("Couldn't copy"); the button keeps its name,
 * and the outcome is read out in a polite status.
 */
function CopySessionId({ sessionId }: { sessionId: string }) {
  const { state, said, copy } = useCopy(sessionId);
  return (
    <>
      <IconButton
        size="md"
        label="Copy session ID"
        tip={said ? `${said}: ${sessionId}` : `Copy session ID: ${sessionId}`}
        className={cn(state === 'failed' && 'text-destructive hover:text-destructive')}
        data-copy={state}
        onClick={() => void copy()}
      >
        {state === 'copied' ? <Check aria-hidden /> : <ActionIcon id="copy" />}
      </IconButton>
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
 * Both sit in the Status tag, after the Status (DS-18.9). Why the last one failed is its tooltip and
 * its description too, so it's there when the header is too narrow to show it beside the tag.
 */
function EscKey({ label, pressingLabel, hint, icon, pressing, error, errorId, onPress }: EscKeyProps & { errorId: string }) {
  const shown = pressing ? pressingLabel : label;
  const tip = pressing ? pressingLabel : (hint ?? label);
  return (
    <StatusTagAction title={error ? `${tip}\n${error}` : tip} aria-describedby={error ? errorId : undefined} disabled={pressing} onClick={onPress}>
      {icon}
      <span className="@max-[26rem]:sr-only">{shown}</span>
    </StatusTagAction>
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
            'min-w-0 truncate rounded-sm text-meta outline-none focus-visible:ring-2 focus-visible:ring-ring',
            tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {message}
        </span>
        {/* Placed against the header (positioned): right-5 and the width cap (the pane less 1.25rem on each side) keep it inside the pane. */}
        <span
          aria-hidden
          data-slot={`${slot}-full`}
          className="pointer-events-none absolute top-full right-5 z-30 mt-1 hidden w-max max-w-[min(28rem,calc(100%-2.5rem))] rounded-md border border-border bg-popover px-2.5 py-1.5 text-meta whitespace-normal text-popover-foreground shadow-md group-focus-within:block group-hover:block"
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
  inHeader = false,
}: {
  row: SessionRow;
  eligible: boolean;
  onEnd: SessionViewProps['onEnd'];
  fallbackFocus: RefObject<HTMLElement | null>;
  /** DS-18.5: in the header, its icon alone, as the actions beside it; in the Done card, its word too. */
  inHeader?: boolean;
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
  const ask = () => {
    setError(null);
    endedHere.current = false;
    setTarget({ pid: row.pid, procStart: row.procStart });
  };
  return (
    <>
      {/* The header's actions are 4 px apart, so its divider needs no margin of its own to sit 4 px from each. */}
      {eligible && <ButtonDivider className={inHeader ? 'mx-0' : undefined} />}
      {eligible &&
        (inHeader ? (
          <IconButton size="md" variant="danger" ref={trigger} label="End Session" onClick={ask}>
            <ActionIcon id="end-session" />
          </IconButton>
        ) : (
          <Button variant="danger" size="default" className="shrink-0" ref={trigger} title="End Session" onClick={ask}>
            <ActionIcon id="end-session" />
            End Session
          </Button>
        ))}
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
          <DialogTitle className="text-title">End “{row.title}”?</DialogTitle>
          <DialogDescription className="text-body leading-5">
            {HARNESS_NAME[row.harness]} is asked to exit, then its Session host is closed. Work it hasn&apos;t finished stops. Its chat stays
            readable here, and you can resume it from History.
          </DialogDescription>
          {(unconfirmed || error) && (
            <Alert title={unconfirmed ? 'Lookout can’t confirm it’s the same Session, so it won’t end it. Close it in the terminal.' : error} />
          )}
          <DialogFooter>
            <Button variant="secondary" size="form" onClick={close} disabled={ending}>
              Cancel
            </Button>
            <Button variant="destructive" size="form" onClick={() => void confirm()} disabled={ending || unconfirmed}>
              <ActionIcon id="end-session" />
              {ending ? 'Ending…' : 'End Session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** VIEW-5.16: the status line's part for an Idle Session's background shell command. */
const SHELL_RUNNING = 'shell running';

/** VIEW-5.19: what the line knows of its parts' widths; a folded part keeps its last one. */
interface Measured {
  widths: Partial<Record<StatusPart, number>>;
  /** A separator between two parts of an end: the end's gap, the dot and the slot's gap. */
  separator: number;
  /** One character of the line's monospace face. */
  char: number;
  /** The location's least width: its icon and 8 characters, or its whole name when shorter. */
  locationMin: number | null;
  /** "from the next reply", with its gap. */
  note: number | null;
  /** "N more" as last drawn. */
  more: { count: number; width: number } | null;
}

const NO_FOLD: ReadonlySet<FoldingPart> = new Set();
const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));
const gapOf = (el: Element | null) => (el ? parseFloat(getComputedStyle(el).columnGap) || 0 : 0);

/** VIEW-5.19: a folded part's name, in "N more"'s button and tooltip. */
const PART_NAME: Record<(typeof MORE_ORDER)[number], string> = {
  changes: 'Changes',
  evidence: 'Evidence',
  queued: 'Queued',
  servers: 'Local servers',
  subagents: 'Subagents',
  shell: 'Background shell',
  model: 'Model',
  effort: 'Effort',
};

/**
 * VIEW-5.5: where the Session works and what it changed on the left, how the agent is doing on the
 * right, on one line under the composer (at the bottom of the pane when there's none), like a
 * terminal's status line; the whole line is in its tooltip. VIEW-5.19: when it runs out of room its
 * parts leave whole by rank, into "N more", and only the Worktree or branch is cut.
 * VIEW-6, VIEW-7: for a Controllable Claude Code or Codex Session, the model and the Effort are menus
 * that switch them, on the line or from their rows in "N more".
 */
function StatusLine({
  row,
  ended,
  models,
  onLoadModels,
  onSwitch,
  statusSwitch,
  changes,
  evidence,
  evidenceText,
  servers,
  onShowServers,
  focusFallback,
  onCompact = null,
}: {
  row: SessionRow;
  ended: boolean;
  /** VIEW-5.18: sends `/compact`; null when Compact isn't offered. */
  onCompact?: (() => void) | null;
  models: HarnessState;
  onLoadModels(): void;
  onSwitch: SessionViewProps['onSwitch'];
  statusSwitch: SwitchState | undefined;
  /** DIFF-1.3: the count and its list; null for an ended Session or without the feature. */
  changes: ChangesButtonProps | null;
  /** EVID-5.1: the Evidence part and its popover, on the line or as a row; null without Evidence. */
  evidence: ((look: PartLook) => ReactNode) | null;
  /** EVID-5.1: its short words, for the whole line's tooltip. */
  evidenceText: string | null;
  /** PORTS-2.1: the Session's Local servers; none for an ended Session or without the feature. */
  servers: readonly LocalServer[];
  onShowServers(): void;
  /** VIEW-8.10: where focus goes when a list closes because its part went away. */
  focusFallback(): void;
}) {
  const loc = location(row);
  const where = row.git ? row.git.repo : row.cwd;
  const context = row.contextPct !== null ? `${row.contextPct}% context` : null;
  const ctxLevel = row.contextPct !== null ? contextLevel(row.contextPct) : null;
  const model = shownModel(row);
  const effort = shownEffort(row);
  // VIEW-6.1: the model by its label in Fleet's list, read once a Session view shows a model.
  const label = model ? modelLabel(models, row.harness, model.id) : null;
  const hasModel = model !== null;
  useEffect(() => {
    if (hasModel && models.state === 'loading') onLoadModels();
  }, [hasModel, models.state, onLoadModels]);
  // VIEW-6.7, VIEW-7.7: a switched model or Effort shows at once, until the next reply reaches the
  // Transcript, marked once for both (they go with the same reply). An ended Session has no next reply.
  const pending = !ended && !!(model?.pending || effort?.pending);
  const effortSwitching = statusSwitch?.what === 'effort' && statusSwitch.switching;
  const shell = row.backgroundShell && !ended ? SHELL_RUNNING : null;
  const running = row.subagents?.running ?? 0;
  const count = running || row.subagents?.finished || 0;
  const subagents = !ended && count > 0 ? `${count} subagent${count === 1 ? '' : 's'}${running ? '' : ' done'}` : null;
  const changed = changes?.changes ? changesTip(changes.changes) : null;
  const serversPart = servers.length ? chipText(servers) : null;
  // RES-3.2: a job of this Session waits in res; its wait counts on the app's one-second clock.
  const now = useClock();
  const queued = row.queued && !ended ? row.queued : null;
  const queuedAge = queued ? formatAge(Math.max(0, now - queued.since)) : null;
  const queuedPart = queued ? `Queued: ${queued.tool} · ${queuedAge}` : null;

  // VIEW-5.19: the parts that left the line, from the widths measured below.
  const [folded, setFolded] = useState<ReadonlySet<FoldingPart>>(NO_FOLD);
  const on = (p: FoldingPart) => !folded.has(p);
  const [line, setLine] = useState<HTMLDivElement | null>(null);
  const [, setResized] = useState(0);
  const measured = useRef<Measured>({ widths: {}, separator: 0, char: 0, locationMin: null, note: null, more: null });
  const [moreOpen, setMoreOpen] = useState(false);

  // The parts the line has now; a folded one is still here, in "N more".
  const present: Partial<Record<StatusPart, boolean>> = {
    repo: !!where,
    location: !!loc,
    changes: !!changes?.changes,
    files: hasLines(changes?.changes),
    evidence: !!evidence,
    queued: !!queued,
    servers: servers.length > 0,
    subagents: !!subagents,
    shell: !!shell,
    model: !!model,
    effort: !!effort,
    context: !!context,
  };
  const shows = (p: FoldingPart) => !!present[p] && on(p);
  // "from the next reply" goes with the Effort while it's on the line, else with the model; with both
  // folded, on the Effort's row (the model's without one). While the Effort switches its note is hidden,
  // so a pending model carries it then.
  const effortCarries = !!effort && !(effortSwitching && model?.pending) && (on('effort') || !model || !on('model'));
  const effortNote = pending && effortCarries;
  const modelNote = pending && !effortNote && !!model;
  const moreNames = MORE_ORDER.filter((p) => present[p] && folded.has(p)).map((p) => PART_NAME[p]);

  // EVID-5.4: the Evidence popover's Test files tile opens the changed-files list; folded, from its row.
  const request = changes?.openRequest;
  const [seenRequest, setSeenRequest] = useState(request);
  const [rowRequest, setRowRequest] = useState(0);
  // With "N more" closed, its Changes row mounts with the list open; until "N more" closes again.
  const [rowOpens, setRowOpens] = useState(false);
  if (request !== seenRequest) {
    setSeenRequest(request);
    if (request !== undefined && folded.has('changes')) {
      if (moreOpen) setRowRequest((n) => n + 1);
      else {
        setRowOpens(true);
        setMoreOpen(true);
      }
    }
  }
  const onMoreOpen = useCallback((open: boolean) => {
    setMoreOpen(open);
    if (!open) setRowOpens(false);
  }, []);

  // After every render, before the browser paints: it measures what the render drew. It sets the
  // fold only when it changes, and the widths it reads don't change with it, so it settles.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- every render, on purpose
  useLayoutEffect(() => {
    if (!line) return;
    const m = measured.current;
    for (const slot of line.querySelectorAll<HTMLElement>('[data-part]')) {
      const id = slot.dataset.part as StatusPart;
      const inner = gapOf(slot);
      const dot = slot.querySelector<HTMLElement>(':scope > [data-slot="status-dot"]');
      if (dot) m.separator = gapOf(slot.parentElement) + dot.offsetWidth + inner;
      let w = slot.offsetWidth - (dot ? dot.offsetWidth + inner : 0);
      const files = slot.querySelector<HTMLElement>('[data-subpart="files"]');
      if (files) {
        m.widths.files = files.offsetWidth + gapOf(files.parentElement);
        w -= m.widths.files;
      }
      const note = slot.querySelector<HTMLElement>('[data-subpart="note"]');
      if (note) {
        m.note = note.offsetWidth + inner;
        w -= m.note;
      }
      const name = slot.querySelector<HTMLElement>('[data-subpart="location-name"]');
      if (id === 'location' && name) {
        // The line is monospace: a character is the name's width over its length.
        const whole = name.scrollWidth;
        m.char = whole / Math.max(1, name.textContent?.length ?? 1);
        m.locationMin = w - name.offsetWidth + Math.min(whole, LOCATION_MIN_CHARS * m.char);
      } else if (id === 'more') m.more = { count: moreNames.length, width: w };
      else if (id !== 'location') {
        m.widths[id] = w;
        if (id === 'repo' && !m.char) m.char = w / Math.max(1, slot.textContent?.length ?? 1);
      }
    }
    // VIEW-5.19: nothing folds or comes back while one of the line's menus, lists or popovers is open.
    if (line.querySelector('[aria-expanded="true"]')) return;
    const style = getComputedStyle(line);
    const room = line.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    const widths: Partial<Record<StatusPart, number>> = {};
    for (const p of [...FOLD_RANK, 'context' as const]) if (present[p] && m.widths[p] !== undefined) widths[p] = m.widths[p];
    const char = m.char;
    const next = foldParts({
      room,
      widths,
      locationMin: present.location ? m.locationMin : null,
      separator: m.separator,
      seam: gapOf(line),
      // The Ellipsis, its gap and its words; as last drawn when it was, for another count.
      more: (n) => (m.more ? m.more.width + (String(n).length - String(m.more.count).length) * char : 18 + `${n} more`.length * char),
      note: pending ? (m.note ?? (FROM_NEXT_REPLY.length + 2) * char) : null,
    });
    if (!sameSet(next, folded)) setFolded(next);
  });
  // Again when the line's width changes: the window, a sidebar opening or closing.
  useEffect(() => {
    if (!line || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setResized((n) => n + 1));
    ro.observe(line);
    return () => ro.disconnect();
  }, [line]);

  const marked = (value: string, note: boolean) => (note ? `${value} (${FROM_NEXT_REPLY})` : value);
  const modelPart = label ? marked(label, modelNote) : null;
  const effortPart = effort ? marked(effort.level, effortNote) : null;
  const parts = [where, loc?.name, changed, evidenceText, queuedPart, serversPart, subagents, shell, modelPart, effortPart, context].filter((p): p is string => !!p);
  if (!parts.length) return null;

  const menu = { row, onLoadModels, onSwitch, statusSwitch };
  const modelMenu = (look: PartLook) =>
    model && label ? (
      canSwitchModel(row, ended) ? (
        <SwitchMenu
          {...menu}
          what="model"
          value={label}
          detail={model.id}
          pending={model.pending && !ended}
          note={modelNote}
          options={modelOptions(models, row.harness)}
          checked={(options) => checkedModel(options, model.id)}
          footnote={modelFootnote(row.harness)}
          look={look}
        />
      ) : (
        <PlainPart field="model" value={label} detail={model.id} why={plainWhy('model', row, ended)} note={modelNote} look={look} />
      )
    ) : null;
  const effortMenu = (look: PartLook) =>
    effort ? (
      canSwitchEffort(row, ended) ? (
        <SwitchMenu
          {...menu}
          what="effort"
          value={effort.level}
          pending={effort.pending && !ended}
          note={effortNote}
          options={effortOptions(models, row)}
          checked={(options) => checkedEffort(options, effort.level, effortUnverified(row))}
          footnote={effortFootnote(row.harness)}
          look={look}
        />
      ) : (
        <PlainPart field="effort" value={effort.level} why={plainWhy('effort', row, ended)} note={effortNote} look={look} />
      )
    ) : null;
  const subagentsColour = running ? 'text-busy-text' : 'text-idle-text';

  // VIEW-5.5: each end's parts in order, a separator before each that has one shown before it.
  const leftOn = { repo: shows('repo'), location: !!loc, changes: shows('changes'), evidence: shows('evidence'), queued: shows('queued'), servers: shows('servers') };
  const leftBefore = (p: keyof typeof leftOn | 'more') => {
    const order = ['repo', 'location', 'changes', 'evidence', 'queued', 'servers'] as const;
    const at = p === 'more' ? order.length : order.indexOf(p);
    return order.slice(0, at).some((q) => leftOn[q]);
  };
  const rightOn = { subagents: shows('subagents'), shell: shows('shell'), model: shows('model'), effort: shows('effort') };
  const rightBefore = (p: keyof typeof rightOn | 'context') => {
    const order = ['subagents', 'shell', 'model', 'effort'] as const;
    const at = p === 'context' ? order.length : order.indexOf(p);
    return order.slice(0, at).some((q) => rightOn[q]);
  };

  // VIEW-5.19: "N more"'s rows, in the line's order, each the part's own component in its row look.
  const rows: ReactNode[] = [];
  for (const p of MORE_ORDER) {
    if (!folded.has(p)) continue;
    // DIFF-3.3, VIEW-8.10: a Changes or Subagents row whose part went stays while its list is open, as
    // on the line, so the list closes itself and sends focus on; nothing folds while it's open.
    const lingers = (p === 'changes' && !!changes && changes.list !== undefined) || (p === 'subagents' && !!row.subagents?.items);
    if (!present[p] && !lingers) continue;
    if (p === 'changes' && changes) rows.push(<ChangesSlot key={p} look="row" dot={false} {...changes} openRequest={rowRequest} initialOpen={rowOpens} />);
    else if (p === 'evidence' && evidence) rows.push(<Fragment key={p}>{evidence('row')}</Fragment>);
    else if (p === 'queued' && queued)
      rows.push(<StaticRow key={p} field="queued" name="Queued" title={queuedTip(queued, now)} icon={<Hourglass className="size-3.5" />} value={`${queued.tool} · ${queuedAge}`} />);
    else if (p === 'servers') rows.push(<PortsChip key={p} look="row" servers={servers} onShowAll={onShowServers} focusFallback={focusFallback} />);
    else if (p === 'subagents')
      rows.push(
        row.subagents?.items ? (
          <SubagentsSlot key={p} look="row" dot={false} text={subagents} running={running > 0} subagents={row.subagents} focusFallback={focusFallback} />
        ) : (
          <StaticRow key={p} field="subagents" state={running ? 'running' : 'done'} name="Subagents" value={<span className={subagentsColour}>{subagents}</span>} />
        ),
      );
    else if (p === 'shell') rows.push(<StaticRow key={p} field="background-shell" name="Background shell" title={BACKGROUND_SHELL_TIP} value="running" />);
    else if (p === 'model') rows.push(<Fragment key={p}>{modelMenu('row')}</Fragment>);
    else if (p === 'effort') rows.push(<Fragment key={p}>{effortMenu('row')}</Fragment>);
  }

  return (
    <StatusBar ref={setLine} role="group" aria-label="Status line" title={parts.join(' · ')}>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden" data-slot="status-left">
        {leftOn.repo && (
          <PartSlot id="repo" dot={false}>
            <span className="whitespace-nowrap" data-field={row.git ? 'repo' : 'cwd'} title={row.cwd ?? undefined}>
              {where}
            </span>
          </PartSlot>
        )}
        {loc && (
          // VIEW-5.19: the one part that's cut; its tooltip names the repo, which may have left.
          <PartSlot id="location" dot={leftBefore('location')} className="min-w-0 shrink">
            <span className="flex min-w-0 items-center gap-1" data-field="location" title={locationTip(row) ?? loc.name}>
              {loc.kind === 'worktree' ? <FolderGit2 aria-label="Worktree" className="size-3.5 shrink-0" /> : <GitBranch aria-label="Branch" className="size-3.5 shrink-0" />}
              <span className="truncate" data-subpart="location-name">
                {loc.name}
              </span>
            </span>
          </PartSlot>
        )}
        {changes && on('changes') && (changes.changes || changes.list !== undefined) && <ChangesSlot dot={leftBefore('changes')} filesFolded={folded.has('files')} {...changes} />}
        {/* EVID-5.1: right after the Changes count, before RES-3.2's Queued part. */}
        {evidence && on('evidence') && (
          <PartSlot id="evidence" dot={leftBefore('evidence')}>
            {evidence('line')}
          </PartSlot>
        )}
        {leftOn.queued && queued && (
          <PartSlot id="queued" dot={leftBefore('queued')}>
            <span className="flex shrink-0 items-center gap-1 whitespace-nowrap" data-field="queued" title={queuedTip(queued, now)}>
              <Hourglass aria-hidden className="size-3.5 shrink-0" />
              {queuedPart}
            </span>
          </PartSlot>
        )}
        {leftOn.servers && (
          <PartSlot id="servers" dot={leftBefore('servers')}>
            <PortsChip servers={servers} onShowAll={onShowServers} focusFallback={focusFallback} />
          </PartSlot>
        )}
        <StatusMore
          names={moreNames}
          open={moreOpen}
          onOpenChange={onMoreOpen}
          focusFallback={focusFallback}
          wrap={(button) => (
            <PartSlot id="more" dot={leftBefore('more')}>
              {button}
            </PartSlot>
          )}
        >
          {rows}
        </StatusMore>
      </div>
      <div className="flex shrink-0 items-center gap-1.5" data-slot="status-right">
        {row.subagents?.items
          ? // VIEW-8.6: with Fleet's list, the part opens it; an ended Session's has no part (VIEW-8.4), which
            // closes an open list (VIEW-8.10).
            on('subagents') && <SubagentsSlot look="line" dot={false} text={subagents} running={running > 0} subagents={row.subagents} focusFallback={focusFallback} />
          : rightOn.subagents && (
              <PartSlot id="subagents" dot={false}>
                <span className={cn('shrink-0 whitespace-nowrap', subagentsColour)} data-field="subagents" data-state={running ? 'running' : 'done'}>
                  {subagents}
                </span>
              </PartSlot>
            )}
        {rightOn.shell && (
          <PartSlot id="shell" dot={rightBefore('shell')}>
            <span className="shrink-0 whitespace-nowrap text-idle-text" data-field="background-shell" title={BACKGROUND_SHELL_TIP}>
              {shell}
            </span>
          </PartSlot>
        )}
        {rightOn.model && (
          <PartSlot id="model" dot={rightBefore('model')}>
            {modelMenu('line')}
          </PartSlot>
        )}
        {rightOn.effort && (
          <PartSlot id="effort" dot={rightBefore('effort')}>
            {effortMenu('line')}
          </PartSlot>
        )}
        {context && (
          <PartSlot id="context" dot={rightBefore('context')}>
            <span className={cn('shrink-0 whitespace-nowrap', ctxLevel && CONTEXT_LEVEL_CLASS[ctxLevel])} data-field="context" data-level={ctxLevel ?? undefined}>
              {context}
            </span>
            {onCompact && (
              <Button variant="secondary" size="line" className="shrink-0" title="Compact the conversation (/compact)" onClick={onCompact} data-field="compact">
                Compact
              </Button>
            )}
          </PartSlot>
        )}
      </div>
    </StatusBar>
  );
}

/** VIEW-5.5: the line's separator between two parts of an end. */
const Dot = () => (
  <span aria-hidden className="shrink-0 opacity-60" data-slot="status-dot">
    ·
  </span>
);

/** VIEW-5.19: one part of the line, measured by its box (`data-part`), its separator before it. */
function PartSlot({ id, dot, className, children }: { id: StatusPart; dot: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn('flex shrink-0 items-center gap-1.5', className)} data-part={id}>
      {dot && <Dot />}
      {children}
    </span>
  );
}

/** VIEW-5.19: a folded part that opens nothing (a queued job, a background shell, a plain model): a row read by its words. */
function StaticRow({ field, state, name, value, icon, title }: { field?: string; state?: string; name: string; value: ReactNode; icon?: ReactNode; title?: string }) {
  return (
    <div className={PART_ROW_STATIC} tabIndex={-1} data-part-row data-field={field} data-state={state} title={title}>
      <PartRowContent name={name} value={value} icon={icon} />
    </div>
  );
}

/** VIEW-8.6: the Subagents part and its list; it stays while the list is open, to close it (VIEW-8.10). */
function SubagentsSlot({ look, dot, ...props }: Omit<SubagentsButtonProps, 'open' | 'onOpenChange'> & { look: PartLook; dot: boolean }) {
  const [open, setOpen] = useState(false);
  if (!props.text && !open) return null;
  const button = <SubagentsButton {...props} look={look} open={open} onOpenChange={setOpen} />;
  if (look === 'row') return button;
  return (
    <PartSlot id="subagents" dot={dot && !!props.text}>
      {button}
    </PartSlot>
  );
}

/** DIFF-1.3: the count, with its separator only while the button shows; it stays while its list is open (DIFF-3.3). */
function ChangesSlot({ dot, look = 'line', ...props }: ChangesButtonProps & { dot: boolean }) {
  const [open, setOpen] = useState(false);
  if (!props.changes && !open) return null;
  const button = (
    <ChangesButton
      {...props}
      look={look}
      onOpenChange={(next) => {
        setOpen(next);
        props.onOpenChange(next);
      }}
    />
  );
  if (look === 'row') return button;
  return (
    <PartSlot id="changes" dot={dot && !!props.changes}>
      {button}
    </PartSlot>
  );
}

/** A status-line value that isn't a menu (VIEW-6.2, VIEW-7.2): its tooltip says why where it's only its terminal host. */
function PlainPart({ field, value, detail = null, why, note, look }: { field: SwitchWhat; value: string; detail?: string | null; why: string | null; note: boolean; look: PartLook }) {
  const shown = detail && detail !== value ? `${value} · ${detail}` : value;
  const title = why ? `${shown}\n${why}` : shown;
  if (look === 'row')
    return (
      <StaticRow
        name={SWITCH_NAME[field]}
        title={title}
        value={
          <>
            <span data-field={field}>{value}</span>
            {note && <span data-slot={`${field}-note`}> · {FROM_NEXT_REPLY}</span>}
          </>
        }
      />
    );
  return (
    <>
      <span className="shrink-0 whitespace-nowrap" data-field={field} title={title}>
        {value}
      </span>
      {note && <NextReplyNote field={field} />}
    </>
  );
}

/** VIEW-6.7, VIEW-7.7: "· from the next reply", muted and whole; the line measures it on its own (VIEW-5.19). */
function NextReplyNote({ field }: { field: string }) {
  return (
    <span className="shrink-0 whitespace-nowrap opacity-70" data-slot={`${field}-note`} data-subpart="note" title={FROM_NEXT_REPLY}>
      · {FROM_NEXT_REPLY}
    </span>
  );
}

const SWITCH_NAME: Record<SwitchWhat, string> = { model: 'Model', effort: 'Effort' };

/**
 * VIEW-6.1–6.9, VIEW-7.1–7.9: the model's name or the Effort as a menu of what Fleet lists.
 * Disabled, its tooltip saying why, while the Session isn't Idle or a switch of either runs (one per
 * Session at a time, VIEW-7.3); the menu says what becomes Claude Code's default. A pick is for the
 * process the menu was opened on. The switch's "Switching…" and error show by the menu it came from.
 */
function SwitchMenu({
  what,
  row,
  value,
  detail = null,
  pending,
  note,
  options,
  checked,
  footnote,
  onLoadModels,
  onSwitch,
  statusSwitch,
  look,
}: {
  what: SwitchWhat;
  row: SessionRow;
  value: string;
  /** VIEW-6.1: the model's id, in its tooltip, when the line shows its label. */
  detail?: string | null;
  /** This value is a switch's (VIEW-6.7, VIEW-7.7): its tooltip says from the next reply. */
  pending: boolean;
  /** This part carries the line's one "from the next reply". */
  note: boolean;
  options: MenuOptions;
  checked(options: MenuOptions): string | null;
  footnote: string;
  onLoadModels(): void;
  onSwitch: SessionViewProps['onSwitch'];
  statusSwitch: SwitchState | undefined;
  look: PartLook;
}) {
  const opened = useRef<ModelTarget | null>(null);
  const mine = statusSwitch?.what === what;
  return (
    <StatusMenu
      field={what}
      name={SWITCH_NAME[what]}
      value={value}
      detail={detail}
      note={note ? FROM_NEXT_REPLY : null}
      tipNote={pending ? FROM_NEXT_REPLY : null}
      why={switchWhy(what, row.status, statusSwitch)}
      switching={mine && statusSwitch.switching}
      options={options}
      checked={checked(options)}
      footnote={footnote}
      error={mine ? statusSwitch.error : null}
      look={look}
      onOpen={() => {
        opened.current = { pid: row.pid, procStart: row.procStart };
        onLoadModels();
      }}
      onPick={(v) => onSwitch(what, row, v, opened.current ?? { pid: row.pid, procStart: row.procStart })}
    />
  );
}

/** The status line's one-line bar, also a past Session's "where it ran" and part of DockRest (SIDE-8.1); its two ends 12 px apart (VIEW-5.5). */
export function StatusBar({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return (
    <div
      className={cn(
        'flex h-7 min-w-0 shrink-0 items-center gap-3 overflow-hidden border-t border-border/70 bg-muted/30 px-5 font-mono text-meta whitespace-nowrap text-muted-foreground',
        className,
      )}
      {...rest}
    />
  );
}

/** VIEW-2: the terminal's last lines, as plain text. */
function Drawer({ sessionId, open, onToggle, preview }: { sessionId: string; open: boolean; onToggle(): void; preview: Preview | null }) {
  const sectionRef = useRef<HTMLElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight; // the bottom is what matters
  }, [preview?.text, open]);

  // DS-11: this Session's kept height (or the default), clamped to the main pane; while you drag,
  // the height you're dragging to, kept when you let go.
  const kept = parseHeights(useSyncExternalStore(subscribeHeights, readHeightsRaw, () => null))[sessionId];
  const { pane, room } = useDrawerSpace(sectionRef);
  const [drag, setDrag] = useState<{ sessionId: string; startY: number; from: number; height: number } | null>(null);
  const dragging = drag?.sessionId === sessionId ? drag : null;
  const height = drawerHeight(pane, dragging?.height ?? kept, room);
  const { min, max } = heightBounds(pane, room);
  const onHandleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    // Not the Session sidebar's ↑/↓ (SIDE-5): its window handler skips a handled key.
    e.preventDefault();
    keepHeight(sessionId, clampHeight(height + (e.key === 'ArrowUp' ? HEIGHT_STEP : -HEIGHT_STEP), pane, room));
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.focus();
    setDrag({ sessionId, startY: e.clientY, from: height, height });
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDrag({ ...dragging, height: clampHeight(dragging.from + dragging.startY - e.clientY, pane, room) });
  };
  const onPointerUp = () => {
    if (!dragging) return;
    if (dragging.height !== dragging.from) keepHeight(sessionId, dragging.height);
    setDrag(null);
  };
  // A cancelled drag (the OS, a touch gesture) goes back to where it began.
  const onPointerCancel = () => setDrag(null);

  return (
    // SIDE-8.1: on a short window the preview gives way, down to its Terminal row, before the chat does.
    <section
      ref={sectionRef}
      className="relative flex min-h-0 flex-col border-t border-border"
      aria-label="Terminal preview"
      style={open ? { height } : undefined}
      data-height={open ? height : undefined}
    >
      {open && (
        // DS-11.2: the top edge is the handle: drag it, or focus it and press ↑/↓.
        <div
          role="separator"
          aria-orientation="horizontal"
          data-preview-handle=""
          aria-label="Terminal preview height"
          aria-valuenow={height}
          aria-valuemin={min}
          aria-valuemax={max}
          tabIndex={0}
          title="Drag, or press ↑/↓, to resize"
          data-dragging={dragging ? '' : undefined}
          onKeyDown={onHandleKey}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          className="group absolute inset-x-0 -top-[3.5px] z-10 h-1.5 cursor-row-resize touch-none outline-none"
        >
          <span
            aria-hidden
            className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-border group-focus-visible:bg-ring group-data-dragging:bg-ring"
          />
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full shrink-0 items-center gap-2 px-5 py-1.5 text-meta font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      >
        <TerminalSquare className="size-3.5" />
        Terminal
        {open && preview?.error && <span className="truncate font-normal text-info-text">{preview.error} · retrying</span>}
        <ChevronDown className={cn('ml-auto size-3.5 transition-transform', !open && '-rotate-90')} />
      </button>
      {open && (
        <pre
          ref={preRef}
          data-testid="terminal-preview"
          className="min-h-0 flex-1 overflow-auto bg-muted/40 px-5 py-2 font-mono text-meta leading-[1.45] whitespace-pre text-foreground/90 dark:bg-black/25"
        >
          {preview?.text ?? (preview?.error ? '' : <Loading label="Reading the terminal…" />)}
        </pre>
      )}
    </section>
  );
}

/**
 * DS-11: the room the preview has. `pane` is the main pane's height (the view this element sits in,
 * the window's until it's measured), for the 70% maximum; `room` is the content row's height, which
 * the chat and the preview share (undefined until measured), so the handle's value and a drag start
 * from the height the preview really has, not one the layout has shrunk. Both are followed as the
 * window, the dock (a growing composer) or History resize them.
 */
function useDrawerSpace(ref: RefObject<HTMLElement | null>): { pane: number; room: number | undefined } {
  const [space, setSpace] = useState<{ pane: number; room: number | undefined }>(() => ({ pane: window.innerHeight, room: undefined }));
  useLayoutEffect(() => {
    const pane = ref.current?.closest<HTMLElement>('[data-shell-view]') ?? null;
    const content = ref.current?.closest<HTMLElement>('[data-shell-row="body"]') ?? null;
    const read = () => {
      const next = { pane: pane?.clientHeight || window.innerHeight, room: content?.clientHeight || undefined };
      setSpace((s) => (s.pane === next.pane && s.room === next.room ? s : next));
    };
    read();
    window.addEventListener('resize', read);
    const observer = typeof ResizeObserver !== 'undefined' && (pane || content) ? new ResizeObserver(read) : null;
    if (pane) observer?.observe(pane);
    if (content) observer?.observe(content);
    return () => {
      window.removeEventListener('resize', read);
      observer?.disconnect();
    };
  }, [ref]);
  return space;
}

interface ComposerProps {
  attachments: ComposerAttachments;
  dragging: boolean;
  sessionId: string;
  title: string;
  drafts: Map<string, string>;
  sending: boolean;
  error: string | null;
  onEdit(sessionId: string): void;
  onSend(sessionId: string, text: string): Promise<boolean>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** VIEW-3.9: a sent message waits UNDO_SEND_MS, with Undo, before it goes. */
  undoSend: boolean;
  /** VIEW-3.9: the message now waiting to go, for the chat to show; null once it went or came back. */
  onHold(held: Omit<HeldMessage, 'onUndo'> | null): void;
  /** VIEW-3.10: set to what takes the waiting message back, for the chat's Undo. */
  undoRef: RefObject<() => void>;
  /** VIEW-15: the `/` lists the tab has read; without it the box has no list. */
  commands?: ComposerCommands;
}

/** VIEW-3.9: how long a sent message waits in the composer, with Undo, before it goes. */
export const UNDO_SEND_MS = 3000;

/** VIEW-3: Enter sends, Shift+Enter adds a line; a failed send keeps the text. */
function Composer({ sessionId, title, drafts, sending, error, onEdit, onSend, inputRef, attachments, dragging, undoSend, onHold, undoRef, commands }: ComposerProps) {
  const attachmentState = useSyncExternalStore(attachments.subscribe, () => attachments.state(sessionId));
  const attaching = attachmentState.loading !== null;
  const issue = [error, attachmentState.error].filter(Boolean).join(' ') || null;
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
  const edit = useRef(update);
  useLayoutEffect(() => { edit.current = update; });
  useLayoutEffect(() => attachments.bind(sessionId, (paths, append) => {
    const box = inputRef.current;
    if (!box) return;
    const focused = !append && document.activeElement === box;
    const start = focused ? box.selectionStart : box.value.length;
    const end = focused ? box.selectionEnd : box.value.length;
    const result = insertion(box.value, start, end, paths);
    box.focus(); box.setSelectionRange(start, end);
    insertText(box, result.text.slice(start, result.caret));
    edit.current(box.value);
  }), [attachments, sessionId, inputRef]);

  // VIEW-3.9–3.11: the message waiting to go and its timer, and what delivering it needs, kept
  // current so an unmount (another Session selected) can still send it. The chat shows it (onHold).
  const pending = useRef<{ text: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const live = useRef({ onSend, sessionId, drafts, onHold });
  useLayoutEffect(() => { live.current = { onSend, sessionId, drafts, onHold }; });
  const deliver = async (sent: string) => {
    const { onSend: send, sessionId: id, drafts: kept } = live.current;
    if (await send(id, sent)) return;
    // VIEW-3.11: a failed send's text comes back, before what was typed since; App keeps its error.
    const now = kept.get(id) ?? '';
    const back = now ? `${sent}\n${now}` : sent;
    kept.set(id, back);
    setText(back);
  };
  const take = (): string | null => {
    const p = pending.current;
    if (!p) return null;
    clearTimeout(p.timer);
    pending.current = null;
    live.current.onHold(null);
    return p.text;
  };
  const flush = () => {
    const sent = take();
    if (sent !== null) void deliver(sent);
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps -- only on unmount
  const undo = () => {
    const back = take();
    if (back === null) return;
    update(text ? `${back}\n${text}` : back);
    inputRef.current?.focus();
  };
  useLayoutEffect(() => { undoRef.current = undo; });

  const submit = async () => {
    if (sending || attachments.state(sessionId).loading || text.trim() === '') return;
    attachments.clear(sessionId);
    const sent = text;
    if (undoSend) {
      // VIEW-3.9: Enter again sends the one waiting at once; the new one waits its own 3 s.
      flush();
      update('');
      const timer = setTimeout(flush, UNDO_SEND_MS);
      pending.current = { text: sent, timer };
      const at = Date.now();
      onHold({ text: sent, at, until: at + UNDO_SEND_MS });
      return;
    }
    // On success, clear the box only if it still holds what was sent (App does the same for the
    // stored draft), so text typed meanwhile stays. A failure's error is kept by App.
    if (await onSend(sessionId, sent)) setText((current) => (current === sent ? '' : current));
  };

  // VIEW-15: the `/` list of this box, read for this Session.
  const list = useCommandList({ store: commands, source: { session: sessionId }, text, field: inputRef, enterSendsWhole: true });

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    // VIEW-15.7: while its list is open, the list has the arrows, Tab, Enter and Esc.
    if (list.keyDown(e)) return;
    if (e.key === 'Backspace' && pending.current && text === '') {
      // VIEW-3.10: Backspace in an empty box takes the waiting message back.
      e.preventDefault();
      undo();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
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
      error={issue}
      loading={attachmentState.loading}
      dragging={dragging}
      commands={list}
      field={{
        ref: inputRef,
        'aria-label': 'Message',
        placeholder: `Message ${title}…`,
        value: text,
        onChange: (e) => {
          update(e.target.value);
          list.typed(e.target.value);
        },
        onBlur: list.blurred,
        ...list.field,
        onKeyDown,
        onPaste: e => {
          attachments.clear(sessionId);
          const inputs = fromPaste(e.clipboardData);
          if (!inputs.length) return;
          e.preventDefault(); void attachments.add(sessionId, inputs);
        },
        'aria-invalid': issue ? true : undefined,
      }}
      send={{
        disabled: sending || attaching || text.trim() === '',
        children: (
          <>
            {sending ? 'Sending…' : 'Send'}
            <SendHorizontal className="size-3.5" />
          </>
        ),
      }}
      hint={<KeysHint commands={list.open} />}
    />
  );
}

interface ComposerFrameProps extends Omit<ComponentPropsWithoutRef<'form'>, 'children'> {
  loading?: string | null;
  dragging?: boolean;
  /** VIEW-3.4: the last failed send's error, above the box. */
  error?: string | null;
  /** The message field. */
  field?: ComponentPropsWithRef<'textarea'>;
  /** The Send button, its label included. */
  send?: ComponentPropsWithoutRef<typeof Button>;
  /** The one-line hint under the box (VIEW-3.12), its full text in its own tooltip. */
  hint?: ReactNode;
  /** VIEW-15: the box's `/` list, which opens upward from it. */
  commands?: CommandListControl;
}

/**
 * The composer's layout: the box with the field and Send, and the hint under it. The Composer fills
 * it in; DockRest draws it empty, so the dock row's resting height is this layout's own (SIDE-8.1).
 * An empty field is one line high whatever its placeholder: it sizes to its content only once it
 * holds text, and the placeholder stays on one line, cut short with an ellipsis.
 */
export function ComposerFrame({ error, field, send, hint, className, loading, dragging, commands, ...form }: ComposerFrameProps) {
  const box = (
    <div className={cn('relative flex items-end gap-2 rounded-lg border px-3 py-2 focus-within:ring-2 focus-within:ring-ring/25', dragging ? 'border-dashed border-primary bg-primary-soft' : 'border-input bg-background focus-within:border-ring dark:bg-input/20')}>
      {dragging && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-1.5 rounded-lg bg-primary-soft text-meta text-primary"><Paperclip className="size-3.5" />Drop to attach</div>}
      <textarea
        rows={1}
        data-composer=""
        {...field}
        className={cn(
          'max-h-[min(12rem,20dvh)] min-h-6 flex-1 resize-none bg-transparent text-prose leading-6 outline-none placeholder:text-muted-foreground',
          field?.value ? 'field-sizing-content' : 'field-sizing-fixed truncate placeholder:truncate',
        )}
      />
      <Button variant="primary" size="default" className="shrink-0" type="submit" {...send} />
    </div>
  );
  return (
    <form className={cn('flex-1 px-4 py-3', className)} {...form}>
      {error && <Alert layout="inline" title={error} className="mb-2" />}
      {loading && <Loading label={loading} className="mb-2" />}
      {commands ? <CommandsPopover control={commands} side="top">{box}</CommandsPopover> : box}
      <p className="mt-1.5 h-4 truncate text-caption leading-4 text-muted-foreground">
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
        <p className="truncate text-body font-medium">{title}</p>
        <p className="line-clamp-2 text-meta leading-5 text-muted-foreground">{detail}</p>
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
          <p className="text-body font-medium">{title}</p>
          <p className="text-meta leading-5 text-muted-foreground">{detail}</p>
        </div>
      )}
    </div>
  );
}

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}
