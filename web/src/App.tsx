import type { AwakeMode } from '@shared/awake.ts';
import { LibraryPanel } from '@/components/LibraryPanel';
import type { LocalServer } from '@shared/ports.ts';
import type { LaunchHarness } from '@shared/settings.ts';
import { type BotRun, type ReportMark, inFlight as runInFlight, unreadReports } from '@shared/bots.ts';
import { toolsAttention } from '@shared/tools.ts';
import type { AnswerRequest, ChatPage, EndTarget, EscStatus, HistoryItem, LaunchRequest, LaunchView, LaunchTrust, ResumeResult, SessionRow, Status } from '@shared/types.ts';
import type { WorkPr, WorkSessionLink, WorkTask } from '@shared/work.ts';
import { hasReset } from '@shared/usage.ts';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HistoryPanel } from '@/components/HistoryPanel';
import { Launcher } from '@/components/Launcher';
import { ShortcutsDialog } from '@/components/ShortcutsDialog';
import { MainPane } from '@/components/MainPane';
import { PastSessionView } from '@/components/PastSessionView';
import { RightRail, RightSidebar } from '@/components/RightSidebar';
import { KeepAwakeFooter, KeepAwakeRail } from '@/components/KeepAwake';
import { SettingsPage } from '@/components/SettingsPage';
import { KeysProvider } from '@/components/KeysProvider';
import { KeysEdge, SHELL_COLUMN, SHELL_GRID } from '@/components/Shell';
import { Sidebar } from '@/components/Sidebar';
import { PlaceRail } from '@/components/PlaceRail';
import { InboxList, type InboxChoice } from '@/components/InboxList';
import { DocumentView } from '@/components/DocumentView';
import { ReportView } from '@/components/ReportView';
import { BotsPanel } from '@/components/BotsPanel';
import { StartingView } from '@/components/StartingView';
import { WorkPanel } from '@/components/WorkPanel';
import { type PickTarget, TopicPicker } from '@/components/TopicPicker';
import { SuggestView } from '@/components/SuggestView';
import { TopicGraph } from '@/components/TopicGraph';
import { TopicView } from '@/components/TopicView';
import { type ExamplesApi, type SimpleApi, SpecView } from '@/components/SpecView';
import type { PrSpecsApi } from '@/lib/pr-specs';
import { tabTitle, unreadIds, usePageVisible, wentIdleUnseen } from '@/lib/unread';
import type { PlainSource } from '@shared/plain.ts';
import { ViewErrorBoundary } from '@/components/ViewErrorBoundary';
import { TopicsPanel } from '@/components/TopicsPanel';
import { ServersPanel } from '@/components/ServersPanel';
import { SetupPanel } from '@/components/SetupPanel';
import { type LookoutClient, SaveError } from '@/lib/client';
import { ComposerAttachments, preventDropNavigation } from '@/lib/attachments';
import { ComposerCommands } from '@/lib/commands';
import { tidySentAt } from '@/lib/activity';
import {
  type AnswerAttempt,
  LOST_ANSWER,
  LOST_STOP,
  type QuestionDrafts,
  type SendFailure,
  type StopRequest,
  processKey,
  promptKey,
  questionKey,
  tidyQuestionDrafts,
} from '@/lib/answers';
import { FileLinks } from '@/lib/files';
import { shownCount } from '@/lib/ports';
import { type PanelNav, type RightLayout, type RightTab, loadLayout, saveLayout, toggleTab } from '@/lib/right-sidebar';
import { useAnyModalOpen } from '@/lib/modal';
import { type HarnessState, type LaunchDraft, initialDraft, withViewedTopic } from '@/lib/launch';
import { type FoundReply, HANDOFF_READ_MS, SENT_SKEW_MS, type HandoffWait, type ShownLink, type WritingWait, afterRead, handoffDraft, handoffRequest, keepHandovers, keptHandoverChange, readKeptHandovers, replyAfter, showLink, waitStep, withReadyDraft, withoutReady } from '@/lib/handoff';
import type { HandoffControls } from '@/components/SessionView';
import { shownEffort } from '@/lib/effort-switch';
import { type ModelTarget, shownModel } from '@/lib/model-switch';
import { SWITCH_RUNNING, type SwitchState, type SwitchWhat, restartedWhy, switchFailure, switchKey } from '@/lib/status-switch';
import { canGoBack, parseRoute, routePath, specHash, useRoute, type Route } from '@/lib/router';
import { type Place, loadPlace, ownsRoute, placeOfRoute, savePlace } from '@/lib/places';
import { HARNESS_NAME } from '@/lib/sessions';
import type { SetupSessionTarget } from '@/lib/setup';
import { cn } from '@/lib/utils';
import { listKnown, shownLaunches, useLookout } from '@/lib/store';
import { pruneHeights } from '@/lib/terminal-height';
import { ClockContext, useNow } from '@/lib/time';
import { PAGE_BUILD } from '@/lib/build';
import { reviewPrompt } from '@/lib/work';
import { type TopicsApi, TopicsContext, sessionTopicTitles, topicsByMember } from '@/lib/topics';
import { type NewMember, type Recommendation, type Topic, type TopicMember, type TopicPromptContext, taskTopic, topicPrompt } from '@shared/topics.ts';
import { DEFAULT_LIBRARY_TYPES, LIBRARY_TYPES } from '@shared/library.ts';

/**
 * VIEW-6.8, VIEW-7.8: the model and the Effort a Session's status line shows, and whether each is
 * a switch's, as one value.
 */
function switchedShown(row: SessionRow): string {
  const m = shownModel(row);
  const e = shownEffort(row);
  return `${m ? `${m.pending ? 'pending' : 'replied'}:${m.id}` : ''} ${e ? `${e.pending ? 'pending' : 'replied'}:${e.level}` : ''}`;
}

/** DIFF-3.6: a list's watch is tried this many times, this far apart, while it's still the latest. */
const WATCH_ATTEMPTS = 3;
const WATCH_RETRY_MS = 2000;

/** A manual drawer toggle, valid while the Session keeps the Status it had then. */
interface DrawerOverride {
  open: boolean;
  status: Status;
  since: number | null;
}

/** LAUNCH-4.2: the row this tab shows for its own start until the server lists it; LAUNCH-7.1: with its first prompt. */
function ownLaunch(id: string, title: string, harness: LaunchHarness, directory: string, prompt: string | null, resume: boolean): LaunchView {
  return { id, title, harness, directory, startedAt: Date.now(), state: 'starting', trust: null, error: null, terminal: null, prompt, resume };
}

/** The server's title for a start (LAUNCH-3.3): its name, else "<Harness> in <folder>". */
function startTitle(req: LaunchRequest): string {
  const folder = req.directory.replace(/\/+$/, '').split('/').pop() || req.directory;
  return req.name.trim() || `${HARNESS_NAME[req.harness]} in ${folder}`;
}

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

/** HAND-6.2: a start from a ready Handover under way: the old Session, the Handover's `at`, and whether `launches` has shown it yet. */
interface HandoffStart {
  from: string;
  at: number;
  seen: boolean;
}

function reloadPage(): void {
  window.location.reload();
}

/** `pageBuild` and `reload` are this tab's build and how it reloads (SIDE-14); tests give their own. */
export function App({ client, pageBuild = PAGE_BUILD, reload = reloadPage }: { client: LookoutClient; pageBuild?: string | null; reload?: () => void }) {
  const [state, dispatch] = useLookout(client);
  // SIDE-14: the server serves a newer page than this tab runs. Said, never acted on (SIDE-14.2).
  const outdated = state.connected && pageBuild !== null && state.build !== null && state.build !== pageBuild;
  const [route, navigate] = useRoute();
  const now = useNow(1000);
  const sessions = useMemo(() => [...state.sessions.values()], [state.sessions]);
  const selectedId = route.name === 'session' ? route.id : null;
  // DOC-2.6: a document opened from a Session's chat keeps that Session the selected row, and nothing else of a selection.
  const docSession = route.name === 'doc' ? (route.session ?? null) : null;
  const selectedLaunchId = route.name === 'launch' ? route.id : null;

  // SIDE-13: Unread. Only this tab knows what it shows; the server keeps when you last saw each
  // Session (`viewedAt`). SIDE-13.3: leaving a Session's view (another selection, a page, nothing, or
  // the tab hidden) counts it seen here at once. Adjusted while rendering, so no frame shows it Unread.
  const visible = usePageVisible();
  const shown = selectedId && visible ? selectedId : null;
  const [leftAt, setLeftAt] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [onScreen, setOnScreen] = useState(shown);
  if (onScreen !== shown) {
    if (onScreen) setLeftAt(new Map(leftAt).set(onScreen, Date.now()));
    setOnScreen(shown);
  }
  // SIDE-13.4: the Session you select keeps its place while it stays selected: Unread for the order
  // if it was when you selected it.
  const [held, setHeld] = useState<{ id: string | null; unread: boolean }>({ id: null, unread: false });
  if (held.id !== selectedId) {
    const row = selectedId ? state.sessions.get(selectedId) : undefined;
    setHeld({ id: selectedId, unread: !!row && wentIdleUnseen(row, leftAt) });
  }
  const unread = useMemo(() => unreadIds(sessions, shown, leftAt), [sessions, shown, leftAt]);
  const orderUnread = useMemo(() => (held.unread && held.id && !unread.has(held.id) ? new Set(unread).add(held.id) : unread), [unread, held]);

  // SIDE-3.3, SIDE-13.6: the tab title counts the Sessions that need you, and adds a dot for Unread.
  const needsYou = sessions.filter((s) => s.status === 'needs-you').length;
  const anyUnread = unread.size > 0 ? 1 : 0;
  useEffect(() => {
    document.title = tabTitle(needsYou, anyUnread);
  }, [needsYou, anyUnread]);

  // VIEW: per-Session view state, kept here so it outlives switching and follows a Codex
  // Session whose id changes. Drafts and in-flight sends are plain mutable records.
  const [drafts] = useState(() => new Map<string, string>());
  // VIEW-4.6: a question's picks and text, by Session, then question, as the composer's drafts.
  const [questionDrafts] = useState<QuestionDrafts>(() => new Map());
  const inFlight = useRef(new Set<string>());
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  // VIEW-3.4: the last failed send per Session, so it shows whichever composer is mounted; VIEW-3.7:
  // with why Fleet held it, so the composer can point to the Esc button while it shows.
  const [sendErrors, setSendErrors] = useState<ReadonlyMap<string, SendFailure>>(new Map());
  const [overrides, setOverrides] = useState<ReadonlyMap<string, DrawerOverride>>(new Map());
  // VIEW-1.10: when you last sent to each Session from the composer.
  const [sentAt, setSentAt] = useState<ReadonlyMap<string, number>>(new Map());
  // VIEW-4: the latest answer and the last Stop per Session, by its process, so they outlive
  // switching away and a Codex Session getting its session id.
  const [attempts, setAttempts] = useState<ReadonlyMap<string, AnswerAttempt>>(new Map());
  const [stops, setStops] = useState<ReadonlyMap<string, StopRequest>>(new Map());
  const answersInFlight = useRef(new Set<string>());
  const stopsInFlight = useRef(new Set<string>());
  // VIEW-6, VIEW-7: each Session process's switch of its model or Effort (one at a time, VIEW-7.3),
  // kept here as answers and stops are, so "Switching…" and its error outlive viewing another Session.
  const [switches, setSwitches] = useState<ReadonlyMap<string, SwitchState>>(new Map());
  const switchesInFlight = useRef(new Set<string>());
  const switchOps = useRef(0);
  // The rows as last listed, for what a switch does once its answer comes (the Status may have moved on).
  const liveSessions = useRef(state.sessions);
  const [attachments] = useState(() => new ComposerAttachments((file, name) => client.attach(file, name), drafts));
  // VIEW-15, LAUNCH-8: the `/` lists read so far, for the composer and the launcher's prompt.
  const [commands] = useState(() => new ComposerCommands((key) => ('session' in key ? client.commands(key.session) : client.launchCommands(key.harness, key.directory, key.continues))));
  useLayoutEffect(() => { attachments.setLive(id => liveSessions.current.get(id)?.controllable === true); }, [attachments]);
  // VIEW-9.9: uploads follow a Codex Session's id change, by the aliases its draft moves by, before
  // its composer mounts under the new id (the draft's move below is a passive effect).
  useLayoutEffect(() => attachments.follow(state.aliases, state.sessions), [attachments, state.aliases, state.sessions]);
  useEffect(() => {
    window.addEventListener('dragover', preventDropNavigation);
    window.addEventListener('drop', preventDropNavigation);
    return () => { window.removeEventListener('dragover', preventDropNavigation); window.removeEventListener('drop', preventDropNavigation); };
  }, []);
  useLayoutEffect(() => {
    liveSessions.current = state.sessions;
  });
  // VIEW-6.8, VIEW-7.8: a switch's error goes once a reply reaches the Transcript after it (Fleet's
  // `modelAt` moves, whatever the reply's model and Effort: it settles a "can't tell", and ends a
  // "not Idle"), with the Session's next change of model or Effort in the status line (Fleet's, or
  // a switch's `pendingModel` or `pendingEffort`), or with the next pick from either menu. A switch
  // whose process is no longer listed goes altogether, unless it's under way or the list isn't known.
  // Adjusted while rendering, from the list before (as React's "storing information from previous
  // renders"), so a stale error never shows.
  const [modelsListed, setModelsListed] = useState(state.sessions);
  if (modelsListed !== state.sessions) {
    setModelsListed(state.sessions);
    const seen = (rows: ReadonlyMap<string, SessionRow>) => new Map([...rows.values()].map((r) => [switchKey(r), `${switchedShown(r)} ${r.modelAt ?? ''}`]));
    const before = seen(modelsListed);
    const now = seen(state.sessions);
    const listed = listKnown(state);
    let out: Map<string, SwitchState> | null = null;
    for (const [key, sw] of switches) {
      const gone = listed && !now.has(key) && !sw.switching;
      const moved = sw.error !== null && before.has(key) && now.has(key) && before.get(key) !== now.get(key);
      if (!gone && !moved) continue;
      out ??= new Map(switches);
      if (gone) out.delete(key);
      else out.set(key, { ...sw, error: null });
    }
    if (out) setSwitches(out);
  }

  // A Codex Session's id changes once it gets a session id: keep it selected, and move its
  // view state to the new id.
  const successor = selectedId && !state.sessions.has(selectedId) ? state.aliases.get(selectedId) : undefined;
  const successorRow = successor ? state.sessions.get(successor) : undefined;
  if (selectedId && successorRow && overrides.has(selectedId)) {
    const o = overrides.get(selectedId)!;
    const next = new Map(overrides);
    next.delete(selectedId);
    // Same Status as before the id changed: the override still holds for the new id.
    if (o.status === successorRow.status) next.set(successorRow.id, { ...o, since: successorRow.statusSince });
    setOverrides(next);
  }
  if (selectedId && successor && sending.has(selectedId) && !sending.has(successor)) {
    setSending(new Set(sending).add(successor));
  }
  if (selectedId && successor && sendErrors.has(selectedId) && !sendErrors.has(successor)) {
    setSendErrors(new Map(sendErrors).set(successor, sendErrors.get(selectedId)!));
  }
  // VIEW-1.10: send times follow every Codex id change (selected or not) and go once a Session
  // has definitely ended; in-flight sends and anything while the list isn't known stay.
  const tidyCtx = { live: state.sessions, aliases: state.aliases, listKnown: listKnown(state), inFlight: sending };
  if (tidySentAt(sentAt, tidyCtx) !== sentAt) setSentAt((m) => tidySentAt(m, tidyCtx));
  // VIEW-4.6: a question's draft goes once it's answered or dismissed, or its Session ended.
  const known = listKnown(state);
  // DS-11.5: kept terminal heights for Sessions no longer listed go, once the list is known; a Codex
  // Session's follows its id change. Before paint, so a preview never shows a height it's about to lose.
  useLayoutEffect(() => {
    if (known) pruneHeights(new Set(state.sessions.keys()), state.aliases);
  }, [known, state.sessions, state.aliases]);
  useEffect(() => tidyQuestionDrafts(questionDrafts, { live: state.sessions, listKnown: known, chats: state.chats }), [questionDrafts, state.sessions, known, state.chats]);
  useEffect(() => {
    if (!selectedId || !successor || !state.sessions.has(successor)) return;
    const draft = drafts.get(selectedId);
    if (draft !== undefined && !drafts.has(successor)) drafts.set(successor, draft);
    drafts.delete(selectedId);
    if (inFlight.current.has(selectedId)) inFlight.current.add(successor);
    navigate({ name: 'session', id: successor }, { replace: true });
  }, [selectedId, successor, state.sessions, navigate, drafts]);

  const onSelect = useCallback(
    (id: string, how: 'push' | 'replace') => navigate({ name: 'session', id }, { replace: how === 'replace' }),
    [navigate],
  );
  const onSelectLaunch = useCallback(
    (id: string, how: 'push' | 'replace') => navigate({ name: 'launch', id }, { replace: how === 'replace' }),
    [navigate],
  );
  // LAUNCH-4.2: the server's launches, then this tab's own it doesn't list yet.
  const listedLaunches = useMemo(() => shownLaunches(state), [state]);
  const [trustAttempts, setTrustAttempts] = useState<ReadonlyMap<string, { prompt: string; base: LaunchTrust | null; answering: 'accept' | 'decline' | null; message: string | null }>>(new Map());
  // HTTP and SSE use separate connections. Keep a confirmed answer visible until the stream
  // reaches it; an older buffered read must not restore the answered prompt's buttons.
  const [trustResults, setTrustResults] = useState<ReadonlyMap<string, { prompt: string; launch: LaunchView | null }>>(new Map());
  const [uncertainTrust, setUncertainTrust] = useState<ReadonlySet<string>>(new Set());
  const trustInFlight = useRef(new Set<string>());
  const [cancelFocus, setCancelFocus] = useState<{ id: string | null } | null>(null);
  useEffect(() => {
    setTrustResults((results) => {
      const next = new Map(results);
      for (const [id, r] of next) if (!listedLaunches.some((l) => l.id === id && l.state === 'trust' && l.trust?.id === r.prompt)) next.delete(id);
      return next.size === results.size ? results : next;
    });
  }, [listedLaunches]);
  const launches = useMemo(() => listedLaunches.flatMap((l) => {
    const result = trustResults.get(l.id);
    if (result && l.state === 'trust' && l.trust?.id === result.prompt) return result.launch ? [result.launch] : [];
    if (!l.trust) return [l];
    const a = trustAttempts.get(l.id);
    if (uncertainTrust.has(`${l.id}:${l.trust.id}`)) return [{ ...l, trust: { ...l.trust, answerable: false, answering: null, message: "It may have been answered, but Lookout can't tell." } }];
    if (!a || a.prompt !== l.trust.id || (!a.answering && a.base !== l.trust)) return [l];
    return [{ ...l, trust: { ...l.trust, answering: a.answering, message: a.message ?? l.trust.message } }];
  }), [listedLaunches, trustAttempts, trustResults, uncertainTrust]);
  const latestLaunches = useRef(listedLaunches);
  useLayoutEffect(() => { latestLaunches.current = listedLaunches; }, [listedLaunches]);
  // NAV-2: the place that shows, from the path; Settings and the Topic views keep the one before
  // them, which is also kept in the browser (NAV-2.3).
  const [lastPlace, setLastPlace] = useState<Place>(loadPlace);
  const place = placeOfRoute(route, lastPlace);
  if (place !== lastPlace) setLastPlace(place);
  useEffect(() => savePlace(place), [place]);
  // NAV-2.4: where each place was left in this page load.
  const placeLeftAt = useRef<Record<Place, Route | null>>({ inbox: null, sessions: null });
  useEffect(() => {
    if (ownsRoute(route)) placeLeftAt.current[place] = route;
  }, [route, place]);
  const runs = state.bots?.runs;
  const showPlace = useCallback(
    (to: Place) => {
      const at = placeLeftAt.current[to];
      // NAV-2.4: a Session that got its session id while you were away (Codex, after its first prompt) is the same Session.
      const successor = at?.name === 'session' && !state.sessions.has(at.id) ? state.aliases.get(at.id) : undefined;
      const left = at?.name === 'session' && successor ? { ...at, id: successor } : at;
      // What was open there, when it still exists; else the place's own start.
      const still =
        left &&
        (left.name === 'inbox'
          ? !left.id || !!runs?.some((r) => r.id === left.id && r.arrivedAt !== null)
          : left.name === 'session'
            ? state.sessions.has(left.id)
            : left.name === 'launch'
              ? latestLaunches.current.some((l) => l.id === left.id)
              : true);
      navigate(left && still ? left : to === 'inbox' ? { name: 'inbox' } : { name: 'home' });
    },
    [navigate, runs, state.sessions, state.aliases],
  );
  // NAV-3.1, INBOX-3.3: what the Inbox's button counts.
  const unreadCount = useMemo(() => unreadReports(runs ?? []), [runs]);
  // INBOX-1.4: Inbox or Archived, for this page load.
  const [inboxChoice, setInboxChoice] = useState<InboxChoice>('inbox');

  useLayoutEffect(() => {
    if (!cancelFocus) return;
    const button = cancelFocus.id && document.querySelector<HTMLElement>(`[data-launch-id="${CSS.escape(cancelFocus.id)}"] button`);
    (button || document.querySelector<HTMLElement>('main[tabindex]'))?.focus();
    setCancelFocus(null);
  }, [cancelFocus, route]);
  const answerTrust = async (id: string, answer: 'accept' | 'decline', prompt: string) => {
    const l = latestLaunches.current.find((l) => l.id === id);
    if (!l?.trust || !l.trust.answerable || l.trust.id !== prompt || trustInFlight.current.has(id) || uncertainTrust.has(`${id}:${prompt}`)) return;
    trustInFlight.current.add(id);
    const index = latestLaunches.current.indexOf(l);
    setTrustAttempts((m) => new Map(m).set(id, { prompt, base: l.trust, answering: answer, message: null }));
    try {
      const launch = await client.answerTrust(id, { answer, prompt });
      const current = latestLaunches.current.find((l) => l.id === id);
      if (current?.state === 'trust' && current.trust?.id === prompt) setTrustResults((m) => new Map(m).set(id, { prompt, launch }));
      if (answer === 'decline' && launch === null && window.location.pathname === routePath({ name: 'launch', id })) {
        const rows = latestLaunches.current;
        const at = rows.findIndex((l) => l.id === id);
        const remaining = rows.filter((l) => l.id !== id);
        const position = at < 0 ? Math.min(index, remaining.length) : at;
        const next = remaining[position]?.id ?? remaining[position - 1]?.id ?? null;
        navigate(next ? { name: 'launch', id: next } : { name: 'home' }, { replace: true });
        setCancelFocus({ id: next });
      }
      setTrustAttempts((m) => { const out = new Map(m); out.delete(id); return out; });
    } catch (err) {
      const uncertain = !(err instanceof SaveError) || err.lost || err.kind === 'uncertain' || err.status === null || err.status >= 500;
      if (uncertain) setUncertainTrust((s) => new Set(s).add(`${id}:${prompt}`));
      setTrustAttempts((m) => new Map(m).set(id, { prompt, base: latestLaunches.current.find((l) => l.id === id)?.trust ?? null, answering: null, message: uncertain ? "It may have been answered, but Lookout can't tell." : err.message }));
    } finally { trustInFlight.current.delete(id); }
  };
  // The save's answer shows at once, before the server's `settings` event (WORK-2.5, UX Settings).
  const savedSince = state.settings;
  // TOOLS-1.4: what the page's own requests answer goes into the store too, as a `tools` event would.
  const loadTools = useCallback(async () => dispatch({ type: 'event', event: { type: 'tools', tools: await client.tools() } }), [client, dispatch]);
  const refreshTools = useCallback(async () => dispatch({ type: 'event', event: { type: 'tools', tools: await client.refreshTools() } }), [client, dispatch]);

  const save = useCallback(
    async (patch: Parameters<LookoutClient['saveSettings']>[0]) => {
      const settings = await client.saveSettings(patch);
      dispatch({ type: 'settings-saved', since: savedSince, settings });
      return settings;
    },
    [client, dispatch, savedSince],
  );

  // LAUNCH: the launcher. Its draft outlives closing it (LAUNCH-1.3); null = start fresh. A launcher
  // opened from Work has a draft of its own, never that one: it lasts until the next open (WORK-5.1).
  const [launcherOpen, setLauncherOpen] = useState(false);
  // Opened from Work (Review, Start Session): closing it without a start gives focus back to Work.
  const launchedFromWork = useRef(false);
  // TOPIC-5.1: opened from a Topic view's "Start Session": that button, which gets focus back when it
  // closes without a start. Its draft is Work's kind, kept apart from LAUNCH-1.3's.
  const launchedFromTopic = useRef<HTMLElement | null>(null);
  // Background shortcuts stand down while any modal (the launcher, End Session) is open.
  const modalOpen = useAnyModalOpen();
  // SIDE-7.4, SIDE-7.5: the Keyboard shortcuts dialog, and the button that opened it, which gets focus back.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [shortcutsOpener, setShortcutsOpener] = useState<HTMLElement | null>(null);
  const showShortcuts = useCallback((opener: HTMLElement) => {
    setShortcutsOpener(opener);
    setShortcutsOpen(true);
  }, []);
  const [draft, setDraft] = useState<LaunchDraft | null>(null);
  const [workDraft, setWorkDraft] = useState<LaunchDraft | null>(null);
  /** HAND-6.2: the Session whose ready Handover the launcher holds, its fields kept with it; null for none. */
  const [handoffOpen, setHandoffOpen] = useState<string | null>(null);
  /** HAND-6.2: starts from a ready Handover under way, by launch id, with the old Session's id. */
  const [handoffStarts, setHandoffStarts] = useState<ReadonlyMap<string, HandoffStart>>(new Map());
  const [harnesses, setHarnesses] = useState<HarnessState>({ state: 'loading' });
  const harnessRequest = useRef(false);
  // LAUNCH-3, VIEW-6.1, VIEW-7.1: the Harnesses, their models and levels, read each time the launcher
  // or a status-line menu opens (a switch can change Claude Code's default, VIEW-6.4, VIEW-7.4); the list already here stays
  // until the new one comes, and stays too if that read fails. One read at a time.
  const loadHarnesses = useCallback(() => {
    if (harnessRequest.current) return;
    harnessRequest.current = true;
    client.harnesses().then(
      (list) => {
        harnessRequest.current = false;
        setHarnesses({ state: 'ready', harnesses: list });
      },
      (err: unknown) => {
        harnessRequest.current = false;
        setHarnesses((h) => (h.state === 'ready' ? h : { state: 'error', error: err instanceof Error ? err.message : "Couldn't load the Harnesses." }));
      },
    );
  }, [client]);
  const openLauncher = useCallback(() => {
    setLauncherOpen(true);
    loadHarnesses();
  }, [loadHarnesses]);

  // TOPIC-17: a Topic's prompt joins what the tab holds when it's built: Work's last read, Fleet's
  // list, the pruned Sessions. Read through a ref, so a Fleet poll doesn't make new handlers.
  const promptKnown = useRef<TopicPromptContext>({ work: null, sessions: new Map(), pruned: [] });
  promptKnown.current = { work: state.work, sessions: state.sessions, pruned: state.topics?.pruned ?? [] };
  const promptFor = useCallback((topic: Topic) => topicPrompt(topic, promptKnown.current), []);

  // LAUNCH-1.1: N, ⌘N and "+" open the launcher on its own draft; Work's draft goes. Opening it over
  // an open launcher changes nothing.
  const openOwnLauncher = useCallback(() => {
    if (!launcherOpen) {
      setWorkDraft(null);
      setHandoffOpen(null);
      launchedFromTopic.current = null;
      // TOPIC-16.3: in an Open Topic's view, that Topic is picked, unless the draft has one already.
      const shown = route.name === 'topic' ? state.topics?.topics.find((t) => t.id === route.id) : undefined;
      if (shown)
        setDraft((d) => {
          const base = d ?? initialDraft(state.settings);
          const next = withViewedTopic(base, shown, state.topics?.topics ?? [], promptKnown.current);
          return next === base ? d : next;
        });
    }
    openLauncher();
  }, [launcherOpen, openLauncher, route, state.topics, state.settings]);

  // LAUNCH-1.1: N opens the launcher when focus isn't in a text field. ⌘N does too, but a normal
  // Chrome tab keeps ⌘N for itself; it reaches the page only in an installed-app window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented || e.ctrlKey || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'n') return;
      if (!e.metaKey && (modalOpen || isTextField(e.target))) return;
      // ⌘N keeps working in the launcher, but never opens it over another dialog.
      if (modalOpen && !launcherOpen) return;
      e.preventDefault();
      openOwnLauncher();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openOwnLauncher, launcherOpen, modalOpen]);

  // LAUNCH-4.2: Start (or a resume, HIST-3.1) selects its "Starting…" row the moment you press
  // it: the tab picks the launch id and shows the row itself until the server lists it. Whatever
  // answers later moves the selection only while that row is still selected; if you moved to
  // another Session or view meanwhile, you stay there.
  const requestLaunch = useCallback(
    (launch: LaunchView) => {
      const from = window.location.pathname;
      const path = routePath({ name: 'launch', id: launch.id });
      dispatch({ type: 'launch-requested', launch });
      navigate({ name: 'launch', id: launch.id });
      const here = () => window.location.pathname === path;
      return {
        here,
        /** The launch the server answered with, or null when there's none (it failed, or went live). */
        answered: (served: LaunchView | null) => dispatch({ type: 'launch-answered', id: launch.id, launch: served }),
        /** It failed: back to where you pressed it, unless you've moved on. */
        back: () => {
          if (here()) navigate(parseRoute(from), { replace: true });
        },
      };
    },
    [dispatch, navigate],
  );
  // LAUNCH-4.2: once Fleet reports it, the Session takes over the selection, but only while its
  // "Starting…" row is still selected: whatever you moved to meanwhile stays. Replaced, so Back
  // doesn't return to a start that's gone; before paint, so the start never shows as unlisted.
  const takeOver = selectedLaunchId ? state.started.get(selectedLaunchId) : undefined;
  // LAUNCH-7.4: and the start's first prompt goes with it, to the Session view, as a message you sent.
  const arriving = selectedLaunchId ? state.arrivals.get(selectedLaunchId) : undefined;
  const [arrival, setArrival] = useState<{ sessionId: string; text: string; at: number } | null>(null);
  useLayoutEffect(() => {
    if (!takeOver) return;
    setArrival(arriving ? { sessionId: takeOver, text: arriving.prompt, at: arriving.startedAt } : null);
    navigate({ name: 'session', id: takeOver }, { replace: true });
  }, [takeOver, arriving, navigate]);
  // It's the view's to keep from there (VIEW-1.13): once you select something else, it goes.
  const arrivalShown = arrival && (selectedId === arrival.sessionId || state.aliases.get(arrival.sessionId) === selectedId) ? arrival : null;
  if (arrival && !arrivalShown && !(route.name === 'launch' && takeOver === arrival.sessionId)) setArrival(null);

  const start = useCallback(
    async (req: LaunchRequest) => {
      const id = crypto.randomUUID();
      // Which launcher this start came from, read now: Esc may close it, and reset the ref, before the answer.
      const fromWork = launchedFromWork.current || launchedFromTopic.current !== null;
      const pending = requestLaunch(ownLaunch(id, startTitle(req), req.harness, req.directory, req.prompt.trim() === '' ? null : req.prompt, false));
      // HAND-6.2: the Handover this start is from, read now: a newer one may be written before it completes.
      const from = req.continues ? handoffWaitsRef.current.get(req.continues.sessionId) : undefined;
      const startedFrom = req.continues && from?.state === 'ready' ? { from: req.continues.sessionId, at: from.at } : null;
      let launch: LaunchView;
      try {
        launch = await client.launch(req, id);
      } catch (err) {
        // LAUNCH-4.4: the launcher stays open with the error; the row goes.
        pending.answered(null);
        pending.back();
        throw err;
      }
      pending.answered(launch);
      // HAND-6.2: a start from a ready Handover uses it up once it completes (`handoffStarts`).
      if (startedFrom) setHandoffStarts((m) => new Map(m).set(launch.id, { ...startedFrom, seen: false }));
      // A server that picked its own id: follow it while the row is still selected.
      if (launch.id !== id && pending.here()) navigate({ name: 'launch', id: launch.id }, { replace: true });
      // A start from Work leaves LAUNCH-1.3's draft alone, as it never read it.
      if (!fromWork) setDraft(null);
      launchedFromWork.current = false; // the new Session's row is selected now
      launchedFromTopic.current = null;
      setLauncherOpen(false);
    },
    [client, requestLaunch, navigate],
  );

  // HIST-1, WORK-1: the right sidebar; open or not, its width, its tab and Work's filter, kept in
  // this browser (HIST-1.3, WORK-1.2, WORK-1.5).
  const [layout, setLayout] = useState<RightLayout>(loadLayout);
  /** Bumped to move focus into the panel just opened or switched to (HIST-1.1), only by your key or click; at 0, never asked, a panel takes none (SIDE-11.1). */
  const [rightFocus, setRightFocus] = useState<Record<RightTab, number>>({ history: 0, work: 0, library: 0, topics: 0, bots: 0, servers: 0, setup: 0 });
  const updateLayout = useCallback((patch: Partial<RightLayout>) => {
    setLayout((l) => {
      const next = { ...l, ...patch };
      saveLayout(next);
      return next;
    });
  }, []);
  // WORK-1.1: `W` and `H` (and the rail's buttons) open the sidebar on their tab, or close it when
  // that tab is already showing.
  const toggleRight = useCallback((tab: RightTab) => {
    setLayout((l) => {
      const next = toggleTab(l, tab);
      saveLayout(next);
      return next;
    });
    setRightFocus((f) => ({ ...f, [tab]: f[tab] + 1 }));
  }, []);
  // A tab clicked moves focus into its panel; one reached with ←/→ leaves it on the tab strip (WORK-1.7).
  const showTab = useCallback(
    (tab: RightTab, focusPanel: boolean) => {
      updateLayout({ open: true, tab });
      if (focusPanel) setRightFocus((f) => ({ ...f, [tab]: f[tab] + 1 }));
    },
    [updateLayout],
  );
  // SIDE-12.7, HIST-2.13: the Session filter hands its query to History's search, which takes it once.
  const [historyAsk, setHistoryAsk] = useState<{ query: string } | null>(null);
  const searchMessages = useCallback(
    (query: string) => {
      setHistoryAsk({ query });
      showTab('history', true);
    },
    [showTab],
  );
  // HIST-1.1, WORK-1.1: H and W, when focus isn't in a text field and no modal is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const tab = ({ h: 'history', w: 'work', l: 'library', t: 'topics', b: 'bots', p: 'servers', u: 'setup' } as const)[key as 'h' | 'w' | 'l' | 't' | 'b' | 'p' | 'u'];
      // NAV-4.1: `1` and `2` show a place, as its button does.
      const to = ({ '1': 'inbox', '2': 'sessions' } as const)[key as '1' | '2'];
      if (!tab && !to) return;
      if (modalOpen || isTextField(e.target) || e.shiftKey) return;
      e.preventDefault();
      if (tab) toggleRight(tab);
      else if (to) showPlace(to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleRight, modalOpen, showPlace]);
  // WORK-8.1: the server reads Work only while some tab has it open: this one says whether it does.
  // A new event stream (reconnect) has a new client id, so this re-runs.
  const [memoryOpen, setMemoryOpen] = useState(false);
  useEffect(() => {
    if (state.clientId) void client.watchMemory(state.clientId, memoryOpen);
  }, [client, state.clientId, memoryOpen]);
  // DIFF-3.6: the Session whose list of changed files this tab has open; the server reads it every 3 s
  // while it's open and sends each list over the event stream. A reconnect re-sends it under the new
  // client id. One watch at a time, so they reach the server in order; one already replaced isn't
  // sent, and one that failed is tried again while it's still the latest.
  const [changesOpen, setChangesOpen] = useState<string | null>(null);
  const changesWatch = useRef(Promise.resolve());
  useEffect(() => {
    const clientId = state.clientId;
    if (!clientId) return;
    let latest = true;
    changesWatch.current = changesWatch.current.then(async () => {
      for (let attempt = 0; latest && attempt < WATCH_ATTEMPTS; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, WATCH_RETRY_MS));
        if (!latest) return;
        try {
          return await client.watchChanges(clientId, changesOpen);
        } catch {
          // tried again below
        }
      }
    });
    return () => {
      latest = false;
    };
  }, [client, state.clientId, changesOpen]);
  const onChangesOpen = useCallback((sessionId: string, open: boolean) => setChangesOpen((cur) => (open ? sessionId : cur === sessionId ? null : cur)), []);
  const openChange = useCallback((sessionId: string, root: string, path: string) => client.openChange(sessionId, root, path), [client]);
  // PLAIN-3.1: a changed Module opens in the Spec view, as a new history entry (Back returns, PLAIN-3.2).
  const openSpec = useCallback((session: string, checkout: string, path: string) => navigate({ name: 'plain', session, checkout, path }), [navigate]);
  // VIEW-13: the last entry of a Session's chat you saw.
  const loadChatSeen = useCallback((sessionId: string) => client.chatSeen(sessionId), [client]);
  const saveChatSeen = useCallback((sessionId: string, seen: { cursor: string; at: number | null }, keepalive: boolean) => client.setChatSeen(sessionId, seen, keepalive), [client]);
  const readPlain = useCallback((source: PlainSource, p: string, fresh: boolean) => client.readPlain(source, p, fresh), [client]);
  const setPlainViewed = useCallback((source: PlainSource, p: string, key: string, viewed: boolean) => client.setPlainViewed(source, p, key, viewed), [client]);
  // PLAIN-11: a Module's examples, offered on a Session's Checkout and on a PR (PLAIN-11.15).
  const plainExamples = useMemo<ExamplesApi>(
    () => ({ load: (source, p) => client.plainExamples(source, p), start: (source, p) => client.startPlainExamples(source, p), cancel: () => client.cancelPlainExamples() }),
    [client],
  );
  // PLAIN-14: a Module's changed specs in simple words, beside it.
  const plainSimple = useMemo<SimpleApi>(
    () => ({ load: (source, p) => client.plainSimple(source, p), start: (source, p) => client.startPlainSimple(source, p), cancel: (source, p) => client.cancelPlainSimple(source, p) }),
    [client],
  );
  // PLAIN-5: Work's "Specs" on a PR; a Module opens in the Spec view, and Back returns to what the main pane showed.
  const prSpecs = useMemo<PrSpecsApi>(
    () => ({
      clones: () => client.plainClones(),
      list: (repo, number, fresh) => client.plainPr(repo, number, fresh),
      onOpen: (repo, number, path) => {
        // Back returns to what the main pane showed when Work opened it, a Spec view included. Kept
        // per Spec view, so Back from a PR opened from another PR's Spec view, then Back again, steps
        // through both.
        const to: Route = { name: 'plain-pr', repo, number, path };
        const from = currentRoute.current;
        if (routePath(from) !== routePath(to)) prOpeners.current.set(routePath(to), from);
        navigate(to);
      },
    }),
    [client, navigate],
  );
  const currentRoute = useRef<Route>(route);
  /** Each PR Spec view's opener, by its path. */
  const prOpeners = useRef(new Map<string, Route>());
  useEffect(() => {
    currentRoute.current = route;
  }, [route]);
  const plainViewed = useCallback((s: string, c: string) => client.plainViewed(s, c), [client]);
  // TOPIC-4.3: Topics open counts as Work open, so its PR and Task members are as fresh as Work's rows.
  // TOPIC-10.5: so does a Topic's view.
  // TOPIC-4.3, TOPIC-14.3: a Topic view and the Suggest view count as Topics open.
  const workOpen = (layout.open && (layout.tab === 'work' || layout.tab === 'topics')) || route.name === 'topic' || route.name === 'suggest';
  useEffect(() => {
    if (state.clientId) void client.watchWork(state.clientId, workOpen);
  }, [client, state.clientId, workOpen]);
  // WORK-8.2: the server answers once the read ends; its outcome reaches every tab as a `work` event,
  // and a refusal during the cooldown or a rate limit shows on Refresh itself. What's left to say, in
  // plain words: a refusal while the server doesn't know this tab has Work open (409), a server
  // error, or no server at all (WORK UX, Errors).
  // SETUP-6.1: This Session follows the main pane's Session, live or past; SETUP-6.4: the tab's Refresh reads it again.
  const [setupRefresh, setSetupRefresh] = useState(0);
  const setupLive = route.name === 'session' ? state.sessions.get(route.id) : undefined;
  const [liveId, liveHarness, liveTitle, liveStatus] = [setupLive?.id, setupLive?.harness, setupLive?.title, setupLive?.status];
  const [pastId, pastHarness] = route.name === 'past' ? [route.id, route.harness] : [null, null];
  const setupSession = useMemo((): SetupSessionTarget | null => {
    if (liveId && liveHarness) return { id: liveId, harness: liveHarness, title: liveTitle ?? null, status: liveStatus ?? null };
    if (pastId && pastHarness) return { id: pastId, harness: pastHarness, title: null, status: null };
    return null;
  }, [liveId, liveHarness, liveTitle, liveStatus, pastId, pastHarness]);
  const readSetupSession = useCallback((sessionId: string) => client.setupSession(sessionId), [client]);
  const refreshWork = useCallback(
    () =>
      client.refreshWork().then(
        () => null,
        (err: unknown) => (err instanceof Error ? err.message : "Couldn't refresh Work."),
      ),
    [client],
  );
  // WORK-1.7: the tab strip's ↑/↓ and j/k, handed to the open panel.
  const libraryNav = useRef<PanelNav>(null);
  const setupNav = useRef<PanelNav>(null);
  const botsNav = useRef<PanelNav>(null);
  const historyNav = useRef<PanelNav>(null);
  const workNav = useRef<PanelNav>(null);
  const topicsNav = useRef<PanelNav>(null);
  const serversNav = useRef<PanelNav>(null);
  // PORTS-2.2: the Session whose group the Servers tab scrolls to, once.
  const [serversReveal, setServersReveal] = useState<string | null>(null);
  const showServers = useCallback((sessionId: string) => {
    updateLayout({ open: true, tab: 'servers' });
    setServersReveal(sessionId);
    setRightFocus((f) => ({ ...f, servers: f.servers + 1 }));
  }, [updateLayout]);
  // A launcher opened from Work gives focus back to Work when it closes without a start, to the list
  // holding the selected row, rather than to the page, where j/k would move the Session sidebar
  // (WORK UX, Focus).
  const launcherClosed = useCallback((e: Event) => {
    const opener = launchedFromTopic.current;
    if (opener) {
      launchedFromTopic.current = null;
      e.preventDefault();
      // A failed start goes back to a Topic view drawn afresh: its Start Session, not the old button.
      const target = opener.isConnected ? opener : document.querySelector<HTMLElement>('[data-testid="topic-view"] [data-action="start"]');
      target?.focus();
      return;
    }
    if (!launchedFromWork.current) return;
    launchedFromWork.current = false;
    e.preventDefault();
    setRightFocus((f) => ({ ...f, work: f.work + 1 }));
  }, []);
  // WORK-5.2: Review opens the launcher with its prompt and nothing else; you press Start. Always
  // Claude Code, whatever was started last: the prompt is a Claude Code plugin command. Its model is
  // the last one only when the last start was Claude Code's.
  const review = useCallback(
    (pr: WorkPr) => {
      const last = initialDraft(state.settings);
      setWorkDraft({ ...last, harness: 'claude', model: last.harness === 'claude' ? last.model : '', prompt: reviewPrompt(pr.url) });
      launchedFromWork.current = true;
      openLauncher();
    },
    [state.settings, openLauncher],
  );
  // WORK-5.1: Start Session on a Task opens the launcher with the Task's URL as its prompt and nothing
  // else, on the last start's Harness, model and directory; you press Start.
  const startOnTask = useCallback(
    (task: WorkTask) => {
      // TOPIC-5.2: a Task in exactly one Open Topic: the Session joins that Topic too, shown in the
      // launcher's Topic field, where it can be changed.
      const topic = taskTopic(state.topics?.topics ?? [], task.id);
      setWorkDraft({ ...initialDraft(state.settings), prompt: task.url, ...(topic ? { topic: { id: topic.id, via: 'task' as const } } : {}) });
      launchedFromWork.current = true;
      openLauncher();
    },
    [state.settings, state.topics, openLauncher],
  );
  // TOPIC-5.1: "Start Session" in a Topic view: the launcher pre-filled from the Topic, as WORK-5.1's
  // is from a Task; nothing starts until Start.
  const startInTopic = useCallback(
    (topic: Topic, opener: HTMLElement | null) => {
      setWorkDraft({ ...initialDraft(state.settings), prompt: promptFor(topic), topic: { id: topic.id, via: 'topic' }, fromTopicView: true });
      launchedFromWork.current = false;
      launchedFromTopic.current = opener;
      openLauncher();
    },
    [state.settings, openLauncher, promptFor],
  );
  const searchLibrary = useCallback((q: Parameters<LookoutClient['library']>[0]) => client.library(q), [client]);
  const libraryStatus = useCallback(() => client.libraryStatus(), [client]);
  const searchHistory = useCallback((q: Parameters<LookoutClient['history']>[0]) => client.history(q), [client]);
  const loadPast = useCallback((harness: HistoryItem['harness'], id: string) => client.pastSession(harness, id), [client]);
  // EVID-6.6: a headless reviewer opens read-only, as HIST-3.3's Show opens a past Session.
  const showReviewer = useCallback((harness: HistoryItem['harness'], id: string) => navigate({ name: 'past', harness, id }), [navigate]);
  const peekPast = useCallback((harness: HistoryItem['harness'], id: string) => client.pastPeek(harness, id), [client]);
  // HIST-3: a live Session is selected (3.2); one that can't be resumed opens read-only (3.3);
  // any other is resumed, its "Starting…" row selected as a start's is (3.1, LAUNCH-4.2).
  const openPast = useCallback(
    async (item: HistoryItem, live: boolean) => {
      if (live) return navigate({ name: 'session', id: item.sessionId });
      if (item.blocked) return navigate({ name: 'past', harness: item.harness, id: item.sessionId });
      const id = crypto.randomUUID();
      const pending = requestLaunch(ownLaunch(id, item.title, item.harness, item.projectPath ?? '', null, true));
      let result: ResumeResult;
      try {
        result = await client.resume(item.harness, item.sessionId, id);
      } catch (err) {
        pending.answered(null);
        pending.back();
        throw err;
      }
      pending.answered(result.kind === 'started' ? result.launch : null);
      if (!pending.here()) return; // you moved on meanwhile: stay there
      if (result.kind === 'live') navigate({ name: 'session', id: result.sessionId }, { replace: true });
      // HIST-3.3: it can't be resumed after all (its directory went since it was listed).
      else if (result.kind === 'blocked') navigate({ name: 'past', harness: result.harness, id: result.sessionId }, { replace: true });
      // This Lookout's own resume of it, already under way: its "Starting…" row.
      else if (result.launch.id !== id) navigate({ name: 'launch', id: result.launch.id }, { replace: true });
    },
    [client, navigate, requestLaunch],
  );
  const openLinkedSession = useCallback(
    (session: WorkSessionLink) => {
      const item: HistoryItem = {
        sessionId: session.sessionId,
        harness: session.harness,
        headless: null,
        title: session.title,
        projectPath: null,
        repo: null,
        branch: null,
        lastActiveAt: session.modifiedAt,
        snippet: null,
        firstPrompt: null,
        projectDisplay: null,
        blocked: null,
      };
      return openPast(item, session.live);
    },
    [openPast],
  );
  // INBOX-2: one Report and its Markdown, read from the server.
  const loadReport = useCallback((runId: string) => client.report(runId), [client]);
  const loadReportText = useCallback((path: string) => client.reportText(path), [client]);
  // DOC-3.3: after a restart nothing is listed, so a document at a Session's path has the path check list it again first.
  const loadDocument = useCallback(
    async (path: string) => {
      if (docSession) await client.checkPaths(docSession, [path]).catch(() => undefined);
      return client.document(path);
    },
    [client, docSession],
  );
  const loadDocumentText = useCallback((path: string) => client.documentText(path), [client]);
  // DOC-1.2: from the Library, a file shows in the main pane over the place you're in.
  const openDocument = useCallback((path: string) => navigate({ name: 'doc', path }), [navigate]);
  const markReport = useCallback((runId: string, mark: ReportMark) => client.markReport(runId, mark), [client]);
  // INBOX-4.1: the Inbox's rows as they show, filter and all (InboxList keeps it).
  const inboxShown = useRef<readonly string[]>([]);
  const setInboxShown = useCallback((ids: readonly string[]) => void (inboxShown.current = ids), []);
  // INBOX-4.1: archive the open Report, or move it back; once the server kept it, select the next row
  // down, else the one above, else nothing: of the rows on screen. A refusal moves nothing, and the Report says it.
  const archiveReport = useCallback(
    async (run: BotRun, archived: boolean) => {
      const rows = inboxShown.current;
      const i = rows.indexOf(run.id);
      const next = i === -1 ? null : (rows[i + 1] ?? rows[i - 1] ?? null);
      await client.markReport(run.id, { archived, arrivedAt: run.arrivedAt });
      // Unless you went elsewhere while it was saved.
      const here = parseRoute(window.location.pathname);
      if (here.name === 'inbox' && here.id === run.id) navigate(next ? { name: 'inbox', id: next } : { name: 'inbox' }, { replace: true });
    },
    [client, navigate],
  );
  // BOT-4.3: the start of a run that has no Session yet, where its Trust prompt is answered.
  const openStart = useCallback((launchId: string) => navigate({ name: 'launch', id: launchId }), [navigate]);
  // INBOX-2.7: the Session that wrote it: Open when it's live, else Resume, or Show when it can't be (HIST-3.3).
  const openRunSession = useCallback(
    (run: BotRun, session: HistoryItem | null) => {
      if (!run.sessionId) return;
      const item: HistoryItem = session ?? { sessionId: run.sessionId, harness: run.harness, headless: null, title: run.name, projectPath: null, projectDisplay: null, repo: null, branch: null, lastActiveAt: run.endedAt, snippet: null, firstPrompt: null, blocked: null };
      void openPast(item, state.sessions.has(run.sessionId)).catch(() => {});
    },
    [openPast, state.sessions],
  );
  // INBOX-2.2: a Report's Bot, shown in the Bots tab.
  const [botReveal, setBotReveal] = useState<string | null>(null);
  const showBot = useCallback(
    (botId: string) => {
      setBotReveal(botId);
      showTab('bots', true);
    },
    [showTab],
  );
  // BOT-1.5: a run's line: its Session while it's going, else its Report.
  const openRun = useCallback(
    (run: BotRun) => {
      if (runInFlight(run) && run.sessionId && state.sessions.has(run.sessionId)) return navigate({ name: 'session', id: run.sessionId });
      // Starting, or waiting at its Trust prompt: its start, while this tab lists it.
      if (run.launchId && latestLaunches.current.some((l) => l.id === run.launchId)) return navigate({ name: 'launch', id: run.launchId });
      if (run.arrivedAt !== null) {
        if (run.archived) setInboxChoice('archived');
        navigate({ name: 'inbox', id: run.id });
      }
    },
    [navigate, state.sessions],
  );

  // TOPIC-2.1: the Topic picker, for the members of the row it was opened on.
  const [pickTarget, setPickTarget] = useState<PickTarget | null>(null);
  // Focus goes back to what opened the picker, so A and j/k act on that panel again.
  const pickOpener = useRef<HTMLElement | null>(null);
  // TOPIC-2.5: a Topic chip opens the Topics tab on that Topic.
  const [reveal, setReveal] = useState<{ id: string; at: number } | null>(null);
  const byMember = useMemo(() => topicsByMember(state.topics), [state.topics]);
  const jevCanAsk = !!state.settings?.recommendWithJev && state.usage?.jev.state === 'ready';
  // TOPIC-9.4: "Other Topic…": the picker, whose pick moves the recommendation's item there.
  const otherTopic = useCallback(
    (rec: Recommendation) => {
      pickOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const label = rec.member.kind === 'pr' ? `${rec.member.snapshot.repo} #${rec.member.snapshot.number}` : rec.member.snapshot.title;
      setPickTarget({
        members: [rec.member],
        label,
        title: 'Other Topic',
        pick: async (to) => {
          await client.recommend({ action: 'move', key: rec.key, topicId: rec.topicId, to });
          return { added: true, title: '' };
        },
      });
    },
    [client],
  );
  // TOPIC-1.3, TOPIC-7.1: one "Archived" toggle for the tab and the graph.
  const [showArchived, setShowArchived] = useState(false);
  // TOPIC-7.1: a node picked in the graph, for the tab to show it past its filter.
  const [graphPick, setGraphPick] = useState<{ id: string } | null>(null);
  // TOPIC-7.1: "Open graph" and G: the graph in the main pane.
  const openGraph = useCallback(() => navigate({ name: 'topics' }), [navigate]);
  // TOPIC-14.1.
  const openSuggest = useCallback(() => navigate({ name: 'suggest' }), [navigate]);
  // TOPIC-10.1: "Open", Enter on an expanded Topic, or a graph node: its view, and the tab selects it.
  const openTopic = useCallback((id: string) => navigate({ name: 'topic', id }), [navigate]);
  // TOPIC-12.3, TOPIC-11.10, TOPIC-13.1: stable, so the Topic view reads its activity once per change.
  const topicActivity = useCallback((id: string, before: number | null) => client.topicActivity(id, before), [client]);
  const earlierSummaries = useCallback((id: string) => client.earlierSummaries(id), [client]);
  const seenTopic = useCallback((id: string, upto: number, keepalive?: boolean) => client.seenTopic(id, upto, keepalive), [client]);
  // …and however the view was reached (Back, Forward, a URL), the tab selects its Topic, past its filter.
  const viewedTopic = route.name === 'topic' ? route.id : null;
  useEffect(() => {
    if (!viewedTopic) return;
    updateLayout({ topic: viewedTopic });
    setGraphPick({ id: viewedTopic });
  }, [viewedTopic, updateLayout]);
  // TOPIC-6.1: "Link to Topic…": the picker, without "New Topic…", for an Edge from this Topic.
  const linkTo = useCallback(
    (topic: Topic) => {
      pickOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const linked = new Set((state.topics?.edges ?? []).flatMap((e) => (e.from === topic.id ? [e.to] : e.to === topic.id ? [e.from] : [])));
      setPickTarget({ members: [], label: topic.title, title: 'Link to Topic', link: { from: topic.id, linked, onLink: (to, label) => client.linkTopics(topic.id, to, label) } });
    },
    [client, state.topics],
  );
  const topicsApi = useMemo<TopicsApi>(
    () => ({
      byMember,
      addTo: (members: readonly NewMember[], label: string) => {
        pickOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        // TOPIC-9.1: "Judge again", offered while Jev can be asked.
        const judge = jevCanAsk ? () => Promise.all(members.map((member) => client.recommend({ action: 'judge-again', member }))) : undefined;
        setPickTarget({ members, label, ...(judge ? { judge } : {}) });
      },
      open: (id: string) => {
        updateLayout({ open: true, tab: 'topics', topic: id });
        setReveal({ id, at: Date.now() });
      },
      view: openTopic,
    }),
    [byMember, updateLayout, jevCanAsk, client, openTopic],
  );
  // TOPIC-3.5: the Session sidebar's filter also matches the titles of a live Session's Topics.
  const topicTitles = useCallback((row: SessionRow) => sessionTopicTitles(byMember, row), [byMember]);
  // TOPIC-3.4: a Session member's chip opens it when live, else resumes it (HIST-3).
  const openTopicSession = useCallback(
    (m: Extract<TopicMember, { kind: 'session' }>, live: boolean) => {
      const item: HistoryItem = {
        sessionId: m.ref.sessionId,
        harness: m.ref.harness,
        headless: null,
        title: m.snapshot.title,
        projectPath: null,
        repo: null,
        branch: null,
        lastActiveAt: null,
        snippet: null,
        firstPrompt: null,
        projectDisplay: m.snapshot.directory,
        blocked: null,
      };
      return openPast(item, live);
    },
    [openPast],
  );
  // TOPIC-4.4: no Library read yet: one, as opening the Library starts (LIB-2.7); its Outputs reach every tab as a `topics` event.
  // A read that fails says why where the Outputs would be, instead of reading forever.
  const [outputsError, setOutputsError] = useState<string | null>(null);
  const readLibrary = useCallback(() => {
    setOutputsError(null);
    client
      .library({ query: '', page: 1, headless: false, types: [...DEFAULT_LIBRARY_TYPES], project: '', hideGone: true })
      .then((page) => {
        if (page.state === 'not-installed') setOutputsError("The Library can't be read: tb-session isn't installed.");
        else if (page.state === 'too-old') setOutputsError(`The Library can't be read: ${page.reason}`);
      })
      .catch((err: unknown) => setOutputsError(`The Library couldn't be read: ${err instanceof Error ? err.message : String(err)}`));
  }, [client]);
  // TOPIC-4.4: "+N more" opens the Library on the Topic's Sessions.
  const [librarySessions, setLibrarySessions] = useState<{ label: string; keys: string[] } | null>(null);
  // PEOPLE-2.6: what is private, as one value the Library reads again on.
  const privacyKey = useMemo(() => JSON.stringify([state.settings.vaultFolder, state.settings.privateFolders]), [state.settings.vaultFolder, state.settings.privateFolders]);
  const moreOutputs = useCallback(
    (topic: Topic) => {
      const keys = topic.members.flatMap((m) => (m.kind === 'session' ? [`${m.ref.harness}:${m.ref.sessionId}`] : []));
      setLibrarySessions({ label: topic.title, keys });
      // Every type, repo and gone file, as the Topic counted them; the Library's text filter clears too.
      updateLayout({ open: true, tab: 'library', libraryFilter: { types: [...LIBRARY_TYPES], project: '', hideGone: false } });
      setRightFocus((f) => ({ ...f, library: f.library + 1 }));
    },
    [updateLayout],
  );

  // VIEW-2.2: the drawer is open while the Session Needs you, unless you toggled it during the
  // current Status (an override is tied to that Status and when it began).
  const drawerOpen = useCallback(
    (row: SessionRow) => {
      const o = overrides.get(row.id);
      return o && o.status === row.status && o.since === row.statusSince ? o.open : row.status === 'needs-you';
    },
    [overrides],
  );
  const toggleDrawer = useCallback(
    (row: SessionRow, open: boolean) =>
      setOverrides((m) => new Map(m).set(row.id, { open, status: row.status, since: row.statusSince })),
    [],
  );

  // VIEW: tell the server what this tab views, and whether its drawer is open, so it follows
  // only that. Derived here in one place; the client sends only the latest state. A new event
  // stream (reconnect) has a new client id, so this re-runs.
  const viewing = route.name === 'session' ? selectedId : null;
  const viewedRow = viewing ? state.sessions.get(viewing) : undefined;
  const previewing = !!viewedRow && viewedRow.controllable && drawerOpen(viewedRow);
  useEffect(() => {
    if (state.clientId) void client.watch(state.clientId, viewing, previewing);
  }, [client, state.clientId, viewing, previewing]);
  // VIEW-1: the chat in view; the store keeps a few others for switching back.
  useEffect(() => dispatch({ type: 'chat-view', sessionId: viewing }), [dispatch, viewing]);

  // VIEW-3: one send per Session at a time; on success, a draft is cleared only if it is still
  // exactly what was sent (text typed meanwhile stays).
  const aliases = useRef(state.aliases);
  useEffect(() => {
    aliases.current = state.aliases;
  });
  const sendMessage = useCallback(
    async (sessionId: string, text: string): Promise<boolean> => {
      if (inFlight.current.has(sessionId)) return false;
      inFlight.current.add(sessionId);
      setSending((s) => new Set(s).add(sessionId));
      const ids = () => [sessionId, aliases.current.get(sessionId)].filter((x): x is string => !!x);
      const setError = (failure: SendFailure | null) =>
        setSendErrors((m) => {
          const next = new Map(m);
          for (const id of ids()) {
            if (failure === null) next.delete(id);
            else next.set(id, failure);
          }
          return next;
        });
      setError(null);
      try {
        await client.sendMessage(sessionId, text);
        for (const id of ids()) if (drafts.get(id) === text) drafts.delete(id);
        return true;
      } catch (err) {
        // VIEW-3.7: a held send is a failed one; its reason is kept for the Esc button's pointer.
        const held = err instanceof SaveError && err.kind === 'send_held' ? err.reason : null;
        setError({ message: err instanceof Error ? err.message : 'Sending failed.', held });
        return false;
      } finally {
        const ids = [sessionId, aliases.current.get(sessionId)].filter((x): x is string => !!x);
        for (const id of ids) inFlight.current.delete(id);
        setSending((s) => {
          const next = new Set(s);
          for (const id of ids) next.delete(id);
          return next;
        });
      }
    },
    [client, drafts],
  );

  // VIEW-4.1–4.3: one answer per Session at a time. A refusal replaces the buttons with why, and
  // opens the terminal preview to answer there; nothing is ever retried on its own. Another tab's
  // answer first (`stale`) holds only until a newer read; a question's text the server can't take
  // stays in the form to fix; a lost connection may have answered.
  const answerPrompt = useCallback(
    async (row: SessionRow, req: AnswerRequest) => {
      const key = processKey(row);
      if (answersInFlight.current.has(key)) return;
      answersInFlight.current.add(key);
      const base = { key: req.kind === 'permission' ? promptKey(req.prompt) : questionKey(req.question), since: row.statusSince, read: req.epoch };
      const set = (a: AnswerAttempt) => setAttempts((m) => new Map(m).set(key, a));
      set({ ...base, phase: 'sending', message: null, epoch: null });
      try {
        const { epoch } = await client.answer(row.id, req);
        set({ ...base, phase: 'sent', message: null, epoch });
      } catch (err) {
        const e = err instanceof SaveError ? err : null;
        if (e && !e.lost && req.kind === 'question' && (e.status === 400 || e.status === 413)) {
          set({ ...base, phase: 'invalid', message: e.message, epoch: null });
          return;
        }
        const phase = e?.kind === 'stale' ? 'stale' : 'refused';
        const message = !e ? 'Couldn’t answer. Answer it in the terminal.' : e.lost ? LOST_ANSWER : e.message;
        set({ ...base, phase, message, epoch: null });
        toggleDrawer(row, true);
      } finally {
        answersInFlight.current.delete(key);
      }
    },
    [client, toggleDrawer],
  );

  // VIEW-4.4: one Esc per click; the button stays "Stopping…" until the Status leaves Busy, or 10 s
  // after the Esc landed (StopRequest, `stopButton`). VIEW-4.5: the Esc button is the same for a
  // Session that Needs you ("Pressing Esc…", `escButton`); each request keeps the Status it's for.
  const stopSession = useCallback(
    async (row: SessionRow, status: EscStatus) => {
      const key = processKey(row);
      if (stopsInFlight.current.has(key)) return;
      stopsInFlight.current.add(key);
      const since = row.statusSince;
      const at = Date.now();
      setStops((m) => new Map(m).set(key, { at, status, since, pending: true, error: null }));
      const settle = (next: StopRequest) => setStops((m) => (m.get(key)?.at === at ? new Map(m).set(key, next) : m));
      try {
        if (status === 'busy') await client.stopSession(row.id);
        else await client.escSession(row.id);
        settle({ at: Date.now(), status, since, pending: false, error: null });
      } catch (err) {
        // A lost connection may have pressed Esc: say so, and show the terminal.
        const lost = err instanceof SaveError && err.lost;
        const failed = status === 'busy' ? 'Couldn’t stop it.' : 'Couldn’t press Esc.';
        settle({ at, status, since, pending: false, error: lost ? LOST_STOP : err instanceof Error ? err.message : failed });
        if (lost) toggleDrawer(row, true);
      } finally {
        stopsInFlight.current.delete(key);
      }
    },
    [client, toggleDrawer],
  );

  // VIEW-5.6: Fleet ends it; the Session list then drops it, so the view shows it ended (VIEW-5.7).
  // `target` is the process the user confirmed, so a replacement is never the one closed.
  const endSession = useCallback(
    async (sessionId: string, target: EndTarget) => {
      await client.endSession(sessionId, target);
    },
    [client],
  );

  // HAND-2: each Session's wait for its Handover, next to the composer's drafts: it outlives the
  // popover and switching Sessions, and a reload drops it (HAND-2.2). Each read is for one moment of a
  // wait (its `sentAt` and `readAfter`), made once: an effect that runs again before the read's answer
  // lands doesn't read again.
  // HAND-6.4: ready Handovers come back from this browser's storage, and each change is kept there.
  const [keptHandovers] = useState(readKeptHandovers);
  const [handoffWaits, setHandoffWaits] = useState<ReadonlyMap<string, HandoffWait>>(keptHandovers);
  /** The waits as last rendered, for a start's answer to read (HAND-6.2). */
  const handoffWaitsRef = useRef<ReadonlyMap<string, HandoffWait>>(keptHandovers);
  const restoredHandovers = useRef<ReadonlySet<string>>(new Set(keptHandovers.keys()));
  // Only what changed is written, so this tab never writes over another tab's Handovers.
  const keptWaits = useRef<ReadonlyMap<string, HandoffWait>>(keptHandovers);
  /** What came in from another tab: already stored, so never written back (an echo between tabs). */
  const fromStorage = useRef(new WeakSet<HandoffWait>());
  useEffect(() => {
    keepHandovers(keptWaits.current, handoffWaits, (w) => fromStorage.current.has(w));
    keptWaits.current = handoffWaits;
    handoffWaitsRef.current = handoffWaits;
  }, [handoffWaits]);
  // Another tab's change comes in, as stored now, unless this tab's own request for that Session is under way.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      const change = keptHandoverChange(e);
      if (!change) return;
      if (change.wait) fromStorage.current.add(change.wait);
      setHandoffWaits((m) => {
        if (change.wait === null) return withoutReady(m, change.id);
        const w = m.get(change.id);
        return w && (w.state === 'sending' || w.state === 'writing') ? m : new Map(m).set(change.id, change.wait);
      });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  // HAND-6.2: starts from a ready Handover, by launch id. One that completes (in `started`) uses the
  // Handover up; one that fails, or leaves `launches` without starting once seen there, leaves it ready.
  useEffect(() => {
    if (!handoffStarts.size) return;
    let next: Map<string, HandoffStart> | null = null;
    const used: HandoffStart[] = [];
    for (const [launchId, s] of handoffStarts) {
      const launch = state.launches.find((l) => l.id === launchId);
      if (state.started.has(launchId)) {
        used.push(s);
        (next ??= new Map(handoffStarts)).delete(launchId);
      } else if (launch && launch.state !== 'failed') {
        if (!s.seen) (next ??= new Map(handoffStarts)).set(launchId, { ...s, seen: true });
      } else if (launch || s.seen) (next ??= new Map(handoffStarts)).delete(launchId);
    }
    if (used.length) setHandoffWaits((m) => used.reduce((acc, s) => withoutReady(acc, s.from, s.at), m));
    if (next) setHandoffStarts(next);
  }, [handoffStarts, state.started, state.launches]);
  const handoffReads = useRef(new Map<string, string>());
  // HAND-2.3: the requests sent to each Session from this page in the last SENT_SKEW_MS (`replyAfter`'s `skip`).
  const handoffSent = useRef(new Map<string, { request: string; sentAt: number }[]>());
  const [handoffTick, setHandoffTick] = useState(0);
  /** Changes a Session's wait, but only while it's still the one sent at `sentAt` (Cancel or Try again replace it). */
  const updateWait = useCallback((id: string, sentAt: number, next: (w: WritingWait) => HandoffWait) =>
    setHandoffWaits((m) => {
      const w = m.get(id);
      if (!w || (w.state !== 'sending' && w.state !== 'writing') || w.sentAt !== sentAt) return m;
      const changed = next(w);
      return changed === w ? m : new Map(m).set(id, changed);
    }), []);
  // HAND-1.3: the request goes as the composer's prompts do (VIEW-3.2), and fails as they do (VIEW-3.7).
  const writeHandoff = useCallback(
    async (row: SessionRow, piece: string) => {
      // HAND-1.1: only while it's Idle, so the request never joins a running Turn (Non-goals).
      if (row.status !== 'idle') return;
      const request = handoffRequest(piece);
      const sentAt = Date.now();
      // The same request sent moments ago (Cancel, then ask again) is in the chat's window too.
      const recent = (handoffSent.current.get(row.id) ?? []).filter((r) => sentAt - r.sentAt <= SENT_SKEW_MS);
      const skip = recent.filter((r) => r.request === request).length;
      const mine = { request, sentAt };
      handoffSent.current.set(row.id, [...recent, mine]);
      setHandoffWaits((m) => new Map(m).set(row.id, { state: 'sending', piece, request, sentAt, skip, busy: false, reads: 0, readAfter: sentAt + HANDOFF_READ_MS }));
      try {
        await client.sendMessage(row.id, request);
      } catch (err) {
        // It never reached the chat.
        handoffSent.current.set(row.id, (handoffSent.current.get(row.id) ?? []).filter((r) => r !== mine));
        updateWait(row.id, sentAt, (w) => ({ state: 'failed', piece: w.piece, reason: err instanceof Error ? err.message : 'Sending failed.' }));
        return;
      }
      // An Idle list right after the send may predate it: the chat is read from 2 s on (`readAfter`), or at once after a Busy.
      updateWait(row.id, sentAt, (w) => ({ ...w, state: 'writing' }));
    },
    [client, updateWait],
  );
  const cancelHandoff = useCallback((row: SessionRow) => setHandoffWaits((m) => {
    if (!m.has(row.id)) return m;
    const next = new Map(m);
    next.delete(row.id);
    return next;
  }), []);
  // HAND-2.3: the chat's latest entries, once the Status says the Turn may have ended: the reply in
  // the request's Turn is the Handover. Not done yet: read again shortly (`afterRead`).
  const readHandover = useCallback(
    async (id: string, wait: WritingWait) => {
      const moment = `${wait.sentAt}:${wait.readAfter}`;
      if (handoffReads.current.get(id) === moment) return;
      handoffReads.current.set(id, moment);
      let found: FoundReply | null = null;
      try {
        found = replyAfter((await client.latestMessages(id)).entries, wait.request, wait.sentAt, wait.skip);
      } catch {
        // read again
      }
      // A Busy seen while this read ran: the Turn runs again, and its end is read anew.
      updateWait(id, wait.sentAt, (w) => (w.busy !== wait.busy || w.reads !== wait.reads ? w : afterRead(w, found, Date.now())));
    },
    [client, updateWait],
  );
  // HAND-2.3, HAND-2.4: each wait follows its Session's row in the list: Busy, then Idle, ends the Turn.
  const listIsKnown = listKnown(state);
  // HAND-6.4: a kept Handover whose Session isn't in the list once it's known goes; its text stays in the chat.
  useEffect(() => {
    if (!listIsKnown || !restoredHandovers.current.size) return;
    const gone = [...restoredHandovers.current].filter((id) => !state.sessions.has(id));
    restoredHandovers.current = new Set();
    if (gone.length) setHandoffWaits((m) => gone.reduce((acc, id) => withoutReady(acc, id), m));
  }, [listIsKnown, state.sessions]);
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const [id, wait] of handoffWaits) {
      const row = state.sessions.get(id) ?? null;
      if (!row && !listIsKnown) continue;
      const step = waitStep(wait, row);
      if (wait.state !== 'writing') continue;
      if (step.kind === 'busy') updateWait(id, wait.sentAt, (w) => ({ ...w, busy: true, reads: 0, readAfter: 0 }));
      else if (step.kind === 'fail') updateWait(id, wait.sentAt, (w) => ({ state: 'failed', piece: w.piece, reason: step.reason }));
      else if (step.kind === 'read') {
        // Not yet: this runs again at `readAfter`, unless the row or the wait changes first.
        const due = wait.readAfter - Date.now();
        if (due <= 0) void readHandover(id, wait);
        else timers.push(setTimeout(() => setHandoffTick((t) => t + 1), due));
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [handoffWaits, state.sessions, listIsKnown, updateWait, readHandover, handoffTick]);
  // HAND-6.1, HAND-3.1: a ready Handover opens the launcher only when you ask, pre-filled the first time,
  // then with its fields as you left them (HAND-6.2); focus goes back to "Hand off…".
  const launchHandoff = useCallback(
    (row: SessionRow, opener: HTMLElement | null) => {
      const wait = handoffWaits.get(row.id);
      if (wait?.state !== 'ready' || launcherOpen) return;
      if (!wait.draft) setHandoffWaits((m) => withReadyDraft(m, row.id, handoffDraft(row, wait.handover, state.settings, state.topics?.topics ?? [], wait.piece)));
      setWorkDraft(null);
      setHandoffOpen(row.id);
      launchedFromWork.current = false;
      launchedFromTopic.current = opener;
      openLauncher();
    },
    [handoffWaits, launcherOpen, state.settings, state.topics, openLauncher],
  );
  // HAND-6.2: the launcher holding a Handover: its fields, and Discard and Keep in Topic. Its last
  // fields stay shown while it closes, after the Handover is used or discarded.
  const handoffWait = handoffOpen && !workDraft ? handoffWaits.get(handoffOpen) : undefined;
  // HAND-6.2: its Handover gone meanwhile (an earlier start completing, another tab using, keeping or
  // discarding it): the launcher closes, its fields shown only while it does.
  const handoffGone = launcherOpen && !!handoffOpen && !workDraft && handoffWait?.state !== 'ready';
  useEffect(() => {
    if (handoffGone) setLauncherOpen(false);
  }, [handoffGone]);
  const liveHandoffDraft = handoffWait?.state === 'ready' ? (handoffWait.draft ?? null) : null;
  const [handoffShown, setHandoffShown] = useState<LaunchDraft | null>(null);
  if (liveHandoffDraft && liveHandoffDraft !== handoffShown) setHandoffShown(liveHandoffDraft);
  const launcherHandoff = useMemo(() => {
    if (!handoffOpen || workDraft) return null;
    const id = handoffOpen;
    return {
      draft: liveHandoffDraft ?? handoffShown,
      onDraftChange: (d: LaunchDraft) => setHandoffWaits((m) => withReadyDraft(m, id, d)),
      handover: {
        onDiscard: () => {
          setLauncherOpen(false);
          setHandoffWaits((m) => withoutReady(m, id));
        },
        // TOPIC-15.7: kept in the Topic without a start; a refusal stays in the launcher.
        onKeepInTopic: async (topicId: string, prompt: string) => {
          const w = handoffWaits.get(id);
          const from = (w?.state === 'ready' ? w.draft?.continues?.title : undefined) ?? state.sessions.get(id)?.title ?? '';
          await client.keepHandover(topicId, { prompt, from, piece: w?.state === 'ready' ? w.piece : '' });
          setLauncherOpen(false);
          setHandoffWaits((m) => withoutReady(m, id));
        },
      },
    };
  }, [handoffOpen, workDraft, liveHandoffDraft, handoffShown, handoffWaits, state.sessions, client]);
  // HAND-4.1, HAND-4.2: a linked Session opens live, or past, read-only (HIST-3.3).
  const openLink = useCallback(
    (link: ShownLink) => navigate(link.live ? { name: 'session', id: link.live.id } : { name: 'past', harness: link.harness, id: link.sessionId }),
    [navigate],
  );
  // HAND-6.3: the rows that show a ready Handover.
  const handoversReady = useMemo(() => new Set([...handoffWaits].filter(([, w]) => w.state === 'ready').map(([id]) => id)), [handoffWaits]);
  const handoffControls = useMemo<HandoffControls>(
    () => ({
      waits: handoffWaits,
      write: (row, piece) => void writeHandoff(row, piece),
      cancel: cancelHandoff,
      launch: launchHandoff,
      links: (row) => ({
        from: row.continuedFrom ? showLink(row.continuedFrom, state.sessions) : null,
        into: (row.continuedIn ?? []).map((l) => showLink(l, state.sessions)),
      }),
      open: openLink,
    }),
    [handoffWaits, writeHandoff, cancelHandoff, launchHandoff, state.sessions, openLink],
  );

  // PORTS-4: the row the dialog opened on; the server checks it again before signalling (PORTS-4.7).
  // AWAKE-4.4: the server's answer goes into the store at once; its event went out before it, and the
  // store keeps whichever is newer by `rev` (AWAKE-1.1).
  const setAwake = useCallback(
    async (mode: AwakeMode, replace?: boolean) => {
      const awake = await client.setAwake(mode, replace);
      dispatch({ type: 'event', event: { type: 'awake', awake } });
      return awake;
    },
    [client, dispatch],
  );
  const stopServer = useCallback(
    async (server: LocalServer) => {
      if (server.startedAt === null) throw new Error('Lookout can’t confirm it’s the same server, so it won’t stop it.');
      return client.stopServer({ pid: server.pid, command: server.command, startedAt: server.startedAt, devctl: server.devctl });
    },
    [client],
  );

  // VIEW-5.12: Fleet types the Harness's `/rename`; the new title comes back through the list (VIEW-5.14).
  // VIEW-5.14: a rename made here shows at once, though the Session is selected (SIDE-10.4).
  const renameSession = useCallback(
    async (row: SessionRow, name: string) => {
      dispatch({ type: 'rename-sent', id: row.id, sent: true });
      try {
        return await client.renameSession(row.id, name);
      } catch (err) {
        dispatch({ type: 'rename-sent', id: row.id, sent: false });
        throw err;
      }
    },
    [client, dispatch],
  );

  // VIEW-6, VIEW-7: Fleet types `/model <id>` or `/effort <level>` into the process the menu was
  // opened on (`opened`; a pick after it changed asks nothing); the new value comes back with the
  // row (`pendingModel`, `pendingEffort`: VIEW-6.7, VIEW-7.7). One switch per Session process at a
  // time, whichever menu (VIEW-7.3); nothing is retried. An outcome Lookout can't be sure of opens
  // the Terminal preview (VIEW-6.8, VIEW-7.8) on the row as it is by then.
  const switchSetting = useCallback(
    async (what: SwitchWhat, row: SessionRow, value: string, opened: ModelTarget) => {
      const key = switchKey(row);
      const op = ++switchOps.current;
      // A pick that asks nothing says why beside its menu, leaving a switch under way to land as it does.
      const refuse = (error: string) =>
        setSwitches((m) => {
          const now = m.get(key);
          return new Map(m).set(key, now?.switching ? { ...now, error } : { op, what, switching: false, error });
        });
      if (opened.pid !== row.pid || opened.procStart !== row.procStart) {
        refuse(restartedWhy(what));
        return;
      }
      if (switchesInFlight.current.has(key)) {
        refuse(SWITCH_RUNNING);
        return;
      }
      switchesInFlight.current.add(key);
      setSwitches((m) => new Map(m).set(key, { op, what, switching: true, error: null }));
      const settle = (next: SwitchState) => setSwitches((m) => (m.get(key)?.op === op ? new Map(m).set(key, next) : m));
      try {
        const target = { pid: opened.pid, procStart: opened.procStart };
        if (what === 'effort') await client.switchEffort(row.id, { effort: value, ...target });
        else await client.switchModel(row.id, { model: value, ...target });
        settle({ op, what, switching: false, error: null });
      } catch (err) {
        const { error, uncertain } = switchFailure(err);
        settle({ op, what, switching: false, error });
        if (uncertain) toggleDrawer([...liveSessions.current.values()].find((r) => switchKey(r) === key) ?? row, true);
      } finally {
        switchesInFlight.current.delete(key);
      }
    },
    [client, toggleDrawer],
  );

  // USAGE-2.2: once a window's reset time passes, its numbers no longer hold: ask for new ones
  // (once per window and reset).
  const passedResets = (state.usage?.providers ?? [])
    .flatMap((p) => p.windows.filter((w) => hasReset(w, now)).map((w) => `${p.id}:${w.kind}:${w.model ?? ''}:${w.resetsAt}`))
    .join('|');
  const refreshedResets = useRef(new Set<string>());
  useEffect(() => {
    if (!passedResets) return;
    const fresh = passedResets.split('|').filter((k) => !refreshedResets.current.has(k));
    if (!fresh.length) return;
    for (const k of fresh) refreshedResets.current.add(k);
    void client.refreshUsage().catch(() => {});
  }, [passedResets, client]);
  // VIEW-1.6: "Show earlier" is a plain request; Chat hands the page back once it has noted
  // its scroll position, and the store puts it above the history.
  const loadEarlier = useCallback((sessionId: string, before: string) => client.earlierMessages(sessionId, before), [client]);
  // VIEW-1.17: file links, checked by the server per Session (VIEW-1.18); only the main pane gets them.
  const fileLinks = useMemo(() => new FileLinks((sessionId, paths) => client.checkPaths(sessionId, paths)), [client]);
  const addPage = useCallback(
    (sessionId: string, before: string, epoch: number, page: ChatPage) => dispatch({ type: 'chat-page', sessionId, before, epoch, page }),
    [dispatch],
  );
  // VIEW-1.5: the oldest end of a long chat is trimmed only while you're at the bottom.
  const onFollowing = useCallback(
    (sessionId: string, following: boolean) => dispatch({ type: 'chat-following', sessionId, following }),
    [dispatch],
  );

  // VIEW-1.10: a send's time follows a Codex Session whose id changed while it was in flight.
  const updateSentAt = useCallback(
    (sessionId: string, update: (current: number | undefined) => number | undefined) =>
      setSentAt((m) => {
        const next = new Map(m);
        for (const id of [sessionId, aliases.current.get(sessionId)]) {
          if (!id) continue;
          const value = update(m.get(id));
          if (value === undefined) next.delete(id);
          else next.set(id, value);
        }
        return next;
      }),
    [],
  );

  const clearSendError = useCallback(
    (sessionId: string) =>
      setSendErrors((m) => {
        if (!m.has(sessionId)) return m;
        const next = new Map(m);
        next.delete(sessionId);
        return next;
      }),
    [],
  );

  return (
    // DS-6.1: Loading ticks on this one-second clock rather than a timer of its own.
    <ClockContext.Provider value={now}>
      <TopicsContext.Provider value={topicsApi}>
      {/* SIDE-11.3: where the keys are, for the columns' edges and the composer's hint line. */}
      <KeysProvider>
      {/* SIDE-8.1: one grid, rows header / content / dock, shared by every column (see Shell). */}
      <div className={SHELL_GRID} data-shell="">
        {/* NAV-1: the rail of places, the window's first column. */}
        <PlaceRail
          place={place}
          onPlace={showPlace}
          unread={unreadCount}
          needsYou={needsYou}
          settingsOpen={route.name === 'settings'}
          onOpenSettings={() => (route.name === 'settings' ? showPlace(place) : navigate({ name: 'settings' }))}
          onShowShortcuts={showShortcuts}
          attention={toolsAttention(state.tools ?? null)}
        />
        <Sidebar
          place={place}
          inbox={
            <InboxList
              bots={state.bots}
              loaded={state.loaded}
              selectedId={route.name === 'inbox' ? (route.id ?? null) : null}
              now={now}
              onSelect={(id, how) => navigate({ name: 'inbox', id }, { replace: how === 'replace' })}
              view={inboxChoice}
              onView={setInboxChoice}
              onOpenBots={() => showTab('bots', true)}
              keyboardEnabled={!modalOpen && place === 'inbox'}
              onShown={setInboxShown}
            />
          }
          sessions={sessions}
          fleet={state.fleet}
          loaded={state.loaded}
          connected={state.connected}
          outdated={outdated}
          onReload={reload}
          idleThresholdHours={state.settings.idleThresholdHours}
          selectedId={selectedId ?? docSession}
          now={now}
          onSelect={onSelect}
          settingsOpen={route.name === 'settings'}
          onOpenSettings={() => (route.name === 'settings' ? showPlace(place) : navigate({ name: 'settings' }))}
          onNewSession={openOwnLauncher}
          launches={launches}
          selectedLaunchId={selectedLaunchId}
          onSelectLaunch={onSelectLaunch}
          onSelectNone={() => navigate({ name: 'home' }, { replace: true })}
          onDismissLaunch={(id) => void client.dismissLaunch(id).catch(() => {})}
          keyboardEnabled={!modalOpen}
          usage={state.usage}
          memory={state.memory}
          res={state.res}
          onMemoryOpenChange={setMemoryOpen}
          onUsageOpen={() => void client.refreshJev().catch(() => {})}
          topicTitles={topicTitles}
          work={state.work}
          onSearchMessages={searchMessages}
          unread={unread}
          handoversReady={handoversReady}
          orderUnread={orderUnread}
        />
        {/* tabIndex -1: focus lands here after the selected start is dismissed (LAUNCH UX). */}
        <main className={cn(SHELL_COLUMN, 'relative outline-none')} data-shell-column="main" tabIndex={-1}>
          {/* DS-4.5: a view that throws shows an error here, not a blank app; a new route starts clean. */}
          <ViewErrorBoundary resetKey={JSON.stringify(route)}>
            {route.name === 'settings' ? (
              <SettingsPage
                settings={state.settings}
                save={save}
                onBack={() => showPlace(place)}
                section={route.section ?? 'general'}
                onSection={(section) => navigate({ name: 'settings', section }, { replace: true })}
                tools={state.tools}
                now={now}
                loadTools={loadTools}
                refreshTools={refreshTools}
                jev={state.usage?.jev ?? null}
                jevAsksToday={state.topics?.jevAsksToday ?? 0}
                jevSetAside={state.topics?.jevSetAside}
                recommend={(action) => client.recommend(action)}
              />
            ) : route.name === 'inbox' ? (
              <ReportView
                // One Report's read and scroll never carry over to another's; PEOPLE-2.6: nor past a change of what is private.
                key={`${route.id ?? ''}\n${privacyKey}`}
                id={route.id ?? null}
                doc={route.doc ?? 1}
                bots={state.bots}
                loaded={state.loaded}
                sessions={state.sessions}
                now={now}
                view={inboxChoice}
                load={loadReport}
                loadText={loadReportText}
                onDoc={(doc) => route.id && navigate({ name: 'inbox', id: route.id, doc }, { replace: true })}
                onMark={markReport}
                onArchive={archiveReport}
                onOpenSession={openRunSession}
                onOpenStart={openStart}
                onShowBot={showBot}
                keyboardEnabled={!modalOpen}
              />
            ) : route.name === 'topics' ? (
              <TopicGraph
                view={state.topics}
                sessions={state.sessions}
                selected={layout.topic}
                onSelect={(topic) => {
                  updateLayout({ topic });
                  setGraphPick({ id: topic });
                }}
                archived={showArchived}
                onArchived={setShowArchived}
                createTopic={(title) => client.createTopic(title)}
                linkTopics={(from, to, label) => client.linkTopics(from, to, label)}
                editEdge={(id, edit) => client.editEdge(id, edit)}
                unlinkTopics={(id, other) => client.unlinkTopics(id, other)}
                placeTopics={(positions) => client.placeTopics(positions)}
                onOpenSession={openTopicSession}
                onOpen={openTopic}
                onSuggest={openSuggest}
                keyboardEnabled={!modalOpen}
              />
            ) : route.name === 'suggest' ? (
              <SuggestView
                view={state.topics}
                sessions={state.sessions}
                now={now}
                suggestPreview={() => client.suggestPreview()}
                suggest={() => client.suggest()}
                cancelSuggest={() => client.cancelSuggest()}
                acceptProposal={(id, accept) => client.acceptProposal(id, accept)}
                dismissProposal={(id) => client.dismissProposal(id)}
                recommend={(action) => client.recommend(action)}
                onOtherTopic={otherTopic}
              />
            ) : route.name === 'topic' ? (
              <TopicView
                // One Topic's drafts, focus and Library read never carry over to another's (TOPIC-1.2, TOPIC-4.4).
                key={route.id}
                id={route.id}
                tab={route.tab ?? 'overview'}
                onTab={(tab) => navigate({ name: 'topic', id: route.id, tab }, { replace: true })}
                view={state.topics}
                sessions={state.sessions}
                work={state.work}
                now={now}
                updateTopic={(id, patch) => client.updateTopic(id, patch)}
                deleteTopic={(id) => client.deleteTopic(id)}
                removeMember={(id, m) => client.removeMember(id, m)}
                onOpenSession={openTopicSession}
                onReadLibrary={readLibrary}
                outputsError={outputsError}
                onMoreOutputs={moreOutputs}
                recommend={(action) => client.recommend(action)}
                onOtherTopic={otherTopic}
                onOpenGraph={openGraph}
                onLinkTo={linkTo}
                linkTopics={(from, to, label) => client.linkTopics(from, to, label)}
                editEdge={(id, edit) => client.editEdge(id, edit)}
                unlinkTopics={(id, other) => client.unlinkTopics(id, other)}
                summarize={(id) => client.summarize(id)}
                cancelSummary={(id) => client.cancelSummary(id)}
                topicActivity={topicActivity}
                earlierSummaries={earlierSummaries}
                seenTopic={seenTopic}
                onOpenTopic={openTopic}
                onStartSession={startInTopic}
              />
            ) : route.name === 'plain' ? (
              <SpecView
                key={`${route.session}\u0000${route.checkout}\u0000${route.path}`}
                source={{ kind: 'session', session: route.session, checkout: route.checkout }}
                path={route.path}
                backTo={state.sessions.get(route.session)?.title ?? null}
                load={readPlain}
                setViewed={setPlainViewed}
                onBack={() => navigate({ name: 'session', id: route.session })}
                onOpenModule={(path, at) => navigate({ name: 'plain', session: route.session, checkout: route.checkout, path }, { hash: at ? specHash(at) : undefined })}
                examples={plainExamples}
                simple={plainSimple}
              />
            ) : route.name === 'plain-pr' ? (
              <SpecView
                key={`pr\u0000${route.repo}\u0000${route.number}\u0000${route.path}`}
                source={{ kind: 'pr', repo: route.repo, number: route.number }}
                path={route.path}
                backTo={null}
                load={readPlain}
                setViewed={setPlainViewed}
                onBack={() => navigate(prOpeners.current.get(routePath(route)) ?? { name: 'home' })}
                examples={plainExamples}
                simple={plainSimple}
                onOpenModule={(path, at) => {
                  // An imported Module of the same PR keeps this view's opener.
                  const to: Route = { name: 'plain-pr', repo: route.repo, number: route.number, path };
                  const opener = prOpeners.current.get(routePath(route));
                  if (opener && !prOpeners.current.has(routePath(to))) prOpeners.current.set(routePath(to), opener);
                  navigate(to, { hash: at ? specHash(at) : undefined });
                }}
              />
            ) : route.name === 'doc' ? (
              <DocumentView
                // One file's read and scroll never carry over to another's; PEOPLE-2.6: nor past a change of what is private, so the server is asked again.
                key={`${route.path}\n${privacyKey}`}
                path={route.path}
                load={loadDocument}
                loadText={loadDocumentText}
                // DOC-2.4: to where it was opened from; with nothing before it in this tab, to its Session, else the place you were in.
                onBack={() => (canGoBack() ? window.history.back() : route.session ? navigate({ name: 'session', id: route.session }) : showPlace(place))}
                keyboardEnabled={!modalOpen}
              />
            ) : route.name === 'past' ? (
              <PastSessionView harness={route.harness} sessionId={route.id} now={now} load={loadPast} sessions={state.sessions} onOpenLink={openLink} />
            ) : route.name === 'launch' ? (
              // Its Session is taking over the selection (the layout effect above): show nothing meanwhile.
              takeOver ? null : (
                <StartingView launch={launches.find((l) => l.id === route.id) ?? null} loaded={state.loaded} now={now} onTrust={(answer, prompt) => void answerTrust(route.id, answer, prompt)} />
              )
            ) : (
              <MainPane
                selectedId={selectedId}
                running={state.sessions.size > 0 || launches.length > 0}
                onNewSession={openOwnLauncher}
                onShowShortcuts={showShortcuts}
                aliases={state.aliases}
                live={(selectedId && state.sessions.get(selectedId)) || null}
                lastKnown={(selectedId && state.lastKnown.get(selectedId)) || null}
                list={
                  listKnown(state)
                    ? 'known'
                    : !state.loaded || state.fleet.state === 'starting'
                      ? 'loading'
                      : 'unavailable'
                }
                now={now}
                preview={(selectedId && state.previews.get(selectedId)) || null}
                drawerOpen={drawerOpen}
                onToggleDrawer={toggleDrawer}
                drafts={drafts}
                undoSend={state.settings?.undoSend ?? true}
                attachments={attachments}
                commands={commands}
                questionDrafts={questionDrafts}
                sending={sending}
                sendErrors={sendErrors}
                onEdit={clearSendError}
                onSend={sendMessage}
                chat={(selectedId && state.chats.get(selectedId)) || null}
                onEarlier={loadEarlier}
                fileLinks={fileLinks}
                onPage={addPage}
                onFollowing={onFollowing}
                sentAt={sentAt}
                onSentAt={updateSentAt}
                arrival={arrivalShown}
                loadChatSeen={loadChatSeen}
                saveChatSeen={saveChatSeen}
                onEnd={endSession}
                onRename={renameSession}
                models={harnesses}
                onLoadModels={loadHarnesses}
                onSwitch={(what, row, value, opened) => void switchSetting(what, row, value, opened)}
                changes={state.changes}
                evidence={state.evidence}
                onChangesOpen={onChangesOpen}
                onOpenChange={openChange}
                onOpenSpec={openSpec}
                onShowReviewer={showReviewer}
                plainViewed={plainViewed}
                ports={state.ports}
                onShowServers={showServers}
                switches={switches}
                prompts={state.prompts}
                attempts={attempts}
                onAnswer={(row, req) => void answerPrompt(row, req)}
                stops={stops}
                onStop={(row) => void stopSession(row, 'busy')}
                onEsc={(row) => void stopSession(row, 'needs-you')}
                handoff={handoffControls}
                sessions={state.sessions}
              />
            )}
          </ViewErrorBoundary>
          <KeysEdge column="main" />
        </main>
        {layout.open ? (
          <RightSidebar
            width={layout.width}
            onResize={(width) => updateLayout({ width })}
            tab={layout.tab}
            onTab={showTab}
            onClose={() => toggleRight(layout.tab)}
            refresh={state.work?.refresh ?? null}
            onRefresh={refreshWork}
            onSetupRefresh={() => setSetupRefresh((n) => n + 1)}
            now={now}
            panels={{
              library: <LibraryPanel focusKey={rightFocus.library} visible={layout.tab === 'library'} sessions={state.sessions} now={now} search={searchLibrary} status={libraryStatus} filter={layout.libraryFilter} onFilter={(libraryFilter) => updateLayout({ libraryFilter })} headless={layout.headless} onHeadless={(headless) => updateLayout({ headless })} onSession={openPast} onDocument={openDocument} keyboardEnabled={!modalOpen} navRef={libraryNav} sessionFilter={librarySessions} onClearSessionFilter={() => setLibrarySessions(null)} privacyKey={privacyKey} />,
              topics: (
                <TopicsPanel
                  viewedTopic={viewedTopic}
                  now={now}
                  view={state.topics}
                  sessions={state.sessions}
                  work={state.work}
                  focusKey={rightFocus.topics}
                  selected={layout.topic}
                  onSelect={(topic) => updateLayout({ topic })}
                  reveal={reveal}
                  onRevealed={() => setReveal(null)}
                  createTopic={(title) => client.createTopic(title)}
                  updateTopic={(id, patch) => client.updateTopic(id, patch)}
                  deleteTopic={(id) => client.deleteTopic(id)}
                  onOpenSession={openTopicSession}
                  recommend={(action) => client.recommend(action)}
                  onOtherTopic={otherTopic}
                  archived={showArchived}
                  onArchived={setShowArchived}
                  picked={graphPick}
                  onOpenGraph={openGraph}
                  onSuggest={openSuggest}
                  onOpenTopic={openTopic}
                  onStartSession={startInTopic}
                  onLinkTo={linkTo}
                  keyboardEnabled={!modalOpen}
                  navRef={topicsNav}
                />
              ),
              bots: (
                <BotsPanel
                  bots={state.bots}
                  sessions={state.sessions}
                  now={now}
                  focusKey={rightFocus.bots}
                  reveal={botReveal}
                  onRevealed={() => setBotReveal(null)}
                  settings={state.settings}
                  harnesses={harnesses}
                  onLoadHarnesses={loadHarnesses}
                  create={(input) => client.createBot(input)}
                  update={(id, patch) => client.updateBot(id, patch)}
                  remove={(id) => client.deleteBot(id)}
                  run={(id) => client.runBot(id)}
                  onOpenRun={openRun}
                  keyboardEnabled={!modalOpen}
                  navRef={botsNav}
                />
              ),
              servers: (
                <ServersPanel
                  ports={state.ports}
                  sessions={sessions}
                  now={now}
                  showAll={layout.showAllServers}
                  onShowAll={(showAllServers) => updateLayout({ showAllServers })}
                  focusKey={rightFocus.servers}
                  reveal={serversReveal}
                  onRevealed={() => setServersReveal(null)}
                  onSelectSession={(id) => onSelect(id, 'push')}
                  onStop={stopServer}
                  navRef={serversNav}
                />
              ),
              setup: (
                <SetupPanel
                  visible={layout.tab === 'setup'}
                  focusKey={rightFocus.setup}
                  read={() => client.setup()}
                  switchSkill={(name, on) => client.switchSkill(name, on)}
                  switchPlugin={(id, on) => client.switchPlugin(id, on)}
                  filter={layout.setupFilter}
                  onFilter={(setupFilter) => updateLayout({ setupFilter })}
                  open={layout.setupOpen}
                  onOpen={(setupOpen) => updateLayout({ setupOpen })}
                  keyboardEnabled={!modalOpen}
                  navRef={setupNav}
                  view={layout.setupView}
                  onView={(setupView) => updateLayout({ setupView })}
                  session={setupSession}
                  readSession={readSetupSession}
                  refreshKey={setupRefresh}
                />
              ),
              history: <HistoryPanel ask={historyAsk} onAsked={() => setHistoryAsk(null)} headless={layout.headless} onHeadless={(headless) => updateLayout({ headless })} focusKey={rightFocus.history} sessions={state.sessions} now={now} search={searchHistory} peek={peekPast} onOpen={openPast} navRef={historyNav} />,
              work: (
                <WorkPanel
                  work={state.work}
                  sessions={state.sessions}
                  filter={layout.workFilter}
                  onFilter={(workFilter) => updateLayout({ workFilter })}
                  now={now}
                  focusKey={rightFocus.work}
                  onStart={startOnTask}
                  onReview={review}
                  onOpenSession={openLinkedSession}
                  onOpenSettings={() => navigate({ name: 'settings' })}
                  keyboardEnabled={!modalOpen}
                  navRef={workNav}
                  specs={prSpecs}
                />
              ),
            }}
            nav={{ history: historyNav, work: workNav, library: libraryNav, topics: topicsNav, bots: botsNav, servers: serversNav, setup: setupNav }}
            counts={{ topics: state.topics?.recommendations.length ?? 0 }}
            servers={state.ports ? shownCount(state.ports) : undefined}
            corner={<KeepAwakeFooter awake={state.awake} now={now} onSet={setAwake} />}
          />
        ) : (
          <RightRail
            onOpen={toggleRight}
            counts={{ topics: state.topics?.recommendations.length ?? 0 }}
            servers={state.ports ? shownCount(state.ports) : undefined}
            corner={<KeepAwakeRail awake={state.awake} now={now} onSet={setAwake} />}
          />
        )}
        <Launcher
          open={launcherOpen}
          onOpenChange={setLauncherOpen}
          draft={workDraft ?? launcherHandoff?.draft ?? draft ?? initialDraft(state.settings)}
          onDraftChange={workDraft ? setWorkDraft : (launcherHandoff?.onDraftChange ?? setDraft)}
          settings={state.settings}
          harnesses={harnesses}
          usage={state.usage}
          now={now}
          onStart={start}
          onCloseAutoFocus={launcherClosed}
          topics={state.topics?.topics}
          promptFor={promptFor}
          keepsInput={!workDraft && !launcherHandoff}
          handover={launcherHandoff?.handover}
          commands={commands}
        />
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} returnFocus={shortcutsOpener} />
        <TopicPicker target={pickTarget} onClose={() => setPickTarget(null)} returnFocus={pickOpener} topics={state.topics?.topics ?? []} createTopic={(title) => client.createTopic(title)} addMember={(id, m) => client.addMember(id, m)} />
      </div>
      </KeysProvider>
      </TopicsContext.Provider>
    </ClockContext.Provider>
  );
}
