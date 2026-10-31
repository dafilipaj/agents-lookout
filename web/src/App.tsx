import { LibraryPanel } from '@/components/LibraryPanel';
import type { LaunchHarness } from '@shared/settings.ts';
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
import { SettingsPage } from '@/components/SettingsPage';
import { SHELL_COLUMN, SHELL_GRID } from '@/components/Shell';
import { Sidebar } from '@/components/Sidebar';
import { StartingView } from '@/components/StartingView';
import { WorkPanel } from '@/components/WorkPanel';
import { type PickTarget, TopicPicker } from '@/components/TopicPicker';
import { TopicsPanel } from '@/components/TopicsPanel';
import { type LookoutClient, SaveError } from '@/lib/client';
import { ComposerAttachments, preventDropNavigation } from '@/lib/attachments';
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
import { type PanelNav, type RightLayout, type RightTab, loadLayout, saveLayout, toggleTab } from '@/lib/right-sidebar';
import { useAnyModalOpen } from '@/lib/modal';
import { type HarnessState, type LaunchDraft, initialDraft } from '@/lib/launch';
import { shownEffort } from '@/lib/effort-switch';
import { type ModelTarget, shownModel } from '@/lib/model-switch';
import { SWITCH_RUNNING, type SwitchState, type SwitchWhat, restartedWhy, switchFailure, switchKey } from '@/lib/status-switch';
import { parseRoute, routePath, useRoute } from '@/lib/router';
import { HARNESS_NAME } from '@/lib/sessions';
import { cn } from '@/lib/utils';
import { listKnown, shownLaunches, useLookout } from '@/lib/store';
import { pruneHeights } from '@/lib/terminal-height';
import { ClockContext, useNow } from '@/lib/time';
import { reviewPrompt } from '@/lib/work';
import { type TopicsApi, TopicsContext, sessionTopicTitles, topicsByMember } from '@/lib/topics';
import type { NewMember, Recommendation, Topic, TopicMember } from '@shared/topics.ts';
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

/** LAUNCH-4.2: the row this tab shows for its own start until the server lists it. */
function ownLaunch(id: string, title: string, harness: LaunchHarness, directory: string): LaunchView {
  return { id, title, harness, directory, startedAt: Date.now(), state: 'starting', trust: null, error: null, terminal: null };
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

export function App({ client }: { client: LookoutClient }) {
  const [state, dispatch] = useLookout(client);
  const [route, navigate] = useRoute();
  const now = useNow(1000);
  const sessions = useMemo(() => [...state.sessions.values()], [state.sessions]);
  const selectedId = route.name === 'session' ? route.id : null;
  const selectedLaunchId = route.name === 'launch' ? route.id : null;

  // SIDE-3.3: the tab title counts the Sessions that need you.
  const needsYou = sessions.filter((s) => s.status === 'needs-you').length;
  useEffect(() => {
    document.title = needsYou > 0 ? `(${needsYou}) Lookout` : 'Lookout';
  }, [needsYou]);

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

  // LAUNCH-1.1: N, ⌘N and "+" open the launcher on its own draft; Work's draft goes. Opening it over
  // an open launcher changes nothing.
  const openOwnLauncher = useCallback(() => {
    if (!launcherOpen) setWorkDraft(null);
    openLauncher();
  }, [launcherOpen, openLauncher]);

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
  useLayoutEffect(() => {
    if (takeOver) navigate({ name: 'session', id: takeOver }, { replace: true });
  }, [takeOver, navigate]);

  const start = useCallback(
    async (req: LaunchRequest) => {
      const id = crypto.randomUUID();
      // Which launcher this start came from, read now: Esc may close it, and reset the ref, before the answer.
      const fromWork = launchedFromWork.current;
      const pending = requestLaunch(ownLaunch(id, startTitle(req), req.harness, req.directory));
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
      // A server that picked its own id: follow it while the row is still selected.
      if (launch.id !== id && pending.here()) navigate({ name: 'launch', id: launch.id }, { replace: true });
      // A start from Work leaves LAUNCH-1.3's draft alone, as it never read it.
      if (!fromWork) setDraft(null);
      launchedFromWork.current = false; // the new Session's row is selected now
      setLauncherOpen(false);
    },
    [client, requestLaunch, navigate],
  );

  // HIST-1, WORK-1: the right sidebar; open or not, its width, its tab and Work's filter, kept in
  // this browser (HIST-1.3, WORK-1.2, WORK-1.5).
  const [layout, setLayout] = useState<RightLayout>(loadLayout);
  /** Bumped to move focus into the panel just opened or switched to (HIST-1.1). */
  const [rightFocus, setRightFocus] = useState<Record<RightTab, number>>({ history: 0, work: 0, library: 0, topics: 0 });
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
  // HIST-1.1, WORK-1.1: H and W, when focus isn't in a text field and no modal is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const tab = ({ h: 'history', w: 'work', l: 'library', t: 'topics' } as const)[key as 'h' | 'w' | 'l' | 't'];
      if (!tab) return;
      if (modalOpen || isTextField(e.target)) return;
      e.preventDefault();
      toggleRight(tab);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleRight, modalOpen]);
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
  // TOPIC-4.3: Topics open counts as Work open, so its PR and Task members are as fresh as Work's rows.
  const workOpen = layout.open && (layout.tab === 'work' || layout.tab === 'topics');
  useEffect(() => {
    if (state.clientId) void client.watchWork(state.clientId, workOpen);
  }, [client, state.clientId, workOpen]);
  // WORK-8.2: the server answers once the read ends; its outcome reaches every tab as a `work` event,
  // and a refusal during the cooldown or a rate limit shows on Refresh itself. What's left to say, in
  // plain words: a refusal while the server doesn't know this tab has Work open (409), a server
  // error, or no server at all (WORK UX, Errors).
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
  const historyNav = useRef<PanelNav>(null);
  const workNav = useRef<PanelNav>(null);
  const topicsNav = useRef<PanelNav>(null);
  // A launcher opened from Work gives focus back to Work when it closes without a start, to the list
  // holding the selected row, rather than to the page, where j/k would move the Session sidebar
  // (WORK UX, Focus).
  const launcherClosed = useCallback((e: Event) => {
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
      setWorkDraft({ ...initialDraft(state.settings), prompt: task.url });
      launchedFromWork.current = true;
      openLauncher();
    },
    [state.settings, openLauncher],
  );
  const searchLibrary = useCallback((q: Parameters<LookoutClient['library']>[0]) => client.library(q), [client]);
  const libraryStatus = useCallback(() => client.libraryStatus(), [client]);
  const searchHistory = useCallback((q: Parameters<LookoutClient['history']>[0]) => client.history(q), [client]);
  const loadPast = useCallback((harness: HistoryItem['harness'], id: string) => client.pastSession(harness, id), [client]);
  const peekPast = useCallback((harness: HistoryItem['harness'], id: string) => client.pastPeek(harness, id), [client]);
  // HIST-3: a live Session is selected (3.2); one that can't be resumed opens read-only (3.3);
  // any other is resumed, its "Starting…" row selected as a start's is (3.1, LAUNCH-4.2).
  const openPast = useCallback(
    async (item: HistoryItem, live: boolean) => {
      if (live) return navigate({ name: 'session', id: item.sessionId });
      if (item.blocked) return navigate({ name: 'past', harness: item.harness, id: item.sessionId });
      const id = crypto.randomUUID();
      const pending = requestLaunch(ownLaunch(id, item.title, item.harness, item.projectPath ?? ''));
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
    }),
    [byMember, updateLayout, jevCanAsk, client],
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

  // VIEW-5.12: Fleet types the Harness's `/rename`; the new title comes back through the list (VIEW-5.14).
  const renameSession = useCallback((row: SessionRow, name: string) => client.renameSession(row.id, name), [client]);

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
      {/* SIDE-8.1: one grid, rows header / content / dock, shared by every column (see Shell). */}
      <div className={SHELL_GRID} data-shell="">
        <Sidebar
          sessions={sessions}
          fleet={state.fleet}
          loaded={state.loaded}
          connected={state.connected}
          idleThresholdHours={state.settings.idleThresholdHours}
          selectedId={selectedId}
          now={now}
          onSelect={onSelect}
          settingsOpen={route.name === 'settings'}
          onOpenSettings={() => navigate(route.name === 'settings' ? { name: 'home' } : { name: 'settings' })}
          onNewSession={openOwnLauncher}
          onShowShortcuts={showShortcuts}
          launches={launches}
          selectedLaunchId={selectedLaunchId}
          onSelectLaunch={onSelectLaunch}
          onSelectNone={() => navigate({ name: 'home' }, { replace: true })}
          onDismissLaunch={(id) => void client.dismissLaunch(id).catch(() => {})}
          keyboardEnabled={!modalOpen}
          usage={state.usage}
          tools={state.tools}
          memory={state.memory}
          onMemoryOpenChange={setMemoryOpen}
          onUsageOpen={() => void client.refreshJev().catch(() => {})}
          topicTitles={topicTitles}
        />
        {/* tabIndex -1: focus lands here after the selected start is dismissed (LAUNCH UX). */}
        <main className={cn(SHELL_COLUMN, 'outline-none')} data-shell-column="main" tabIndex={-1}>
          {route.name === 'settings' ? (
            <SettingsPage
              settings={state.settings}
              save={save}
              onBack={() => navigate({ name: 'home' })}
              tools={state.tools}
              now={now}
              loadTools={loadTools}
              refreshTools={refreshTools}
              jev={state.usage?.jev ?? null}
              jevAsksToday={state.topics?.jevAsksToday ?? 0}
            />
          ) : route.name === 'past' ? (
            <PastSessionView harness={route.harness} sessionId={route.id} now={now} load={loadPast} />
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
              attachments={attachments}
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
              onEnd={endSession}
              onRename={renameSession}
              models={harnesses}
              onLoadModels={loadHarnesses}
              onSwitch={(what, row, value, opened) => void switchSetting(what, row, value, opened)}
              changes={state.changes}
              onChangesOpen={onChangesOpen}
              onOpenChange={openChange}
              switches={switches}
              prompts={state.prompts}
              attempts={attempts}
              onAnswer={(row, req) => void answerPrompt(row, req)}
              stops={stops}
              onStop={(row) => void stopSession(row, 'busy')}
              onEsc={(row) => void stopSession(row, 'needs-you')}
            />
          )}
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
            now={now}
            panels={{
              library: <LibraryPanel focusKey={rightFocus.library} visible={layout.tab === 'library'} sessions={state.sessions} now={now} search={searchLibrary} status={libraryStatus} filter={layout.libraryFilter} onFilter={(libraryFilter) => updateLayout({ libraryFilter })} headless={layout.headless} onHeadless={(headless) => updateLayout({ headless })} onSession={openPast} keyboardEnabled={!modalOpen} navRef={libraryNav} sessionFilter={librarySessions} onClearSessionFilter={() => setLibrarySessions(null)} />,
              topics: (
                <TopicsPanel
                  view={state.topics}
                  sessions={state.sessions}
                  work={state.work}
                  now={now}
                  focusKey={rightFocus.topics}
                  selected={layout.topic}
                  onSelect={(topic) => updateLayout({ topic })}
                  reveal={reveal}
                  onRevealed={() => setReveal(null)}
                  createTopic={(title) => client.createTopic(title)}
                  updateTopic={(id, patch) => client.updateTopic(id, patch)}
                  deleteTopic={(id) => client.deleteTopic(id)}
                  removeMember={(id, m) => client.removeMember(id, m)}
                  onOpenSession={openTopicSession}
                  onReadLibrary={readLibrary}
                  outputsError={outputsError}
                  onMoreOutputs={moreOutputs}
                  recommend={(action) => client.recommend(action)}
                  onOtherTopic={otherTopic}
                  keyboardEnabled={!modalOpen}
                  navRef={topicsNav}
                />
              ),
              history: <HistoryPanel headless={layout.headless} onHeadless={(headless) => updateLayout({ headless })} focusKey={rightFocus.history} sessions={state.sessions} now={now} search={searchHistory} peek={peekPast} onOpen={openPast} navRef={historyNav} />,
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
                />
              ),
            }}
            nav={{ history: historyNav, work: workNav, library: libraryNav, topics: topicsNav }}
            counts={{ topics: state.topics?.recommendations.length ?? 0 }}
          />
        ) : (
          <RightRail onOpen={toggleRight} counts={{ topics: state.topics?.recommendations.length ?? 0 }} />
        )}
        <Launcher
          open={launcherOpen}
          onOpenChange={setLauncherOpen}
          draft={workDraft ?? draft ?? initialDraft(state.settings)}
          onDraftChange={workDraft ? setWorkDraft : setDraft}
          settings={state.settings}
          harnesses={harnesses}
          usage={state.usage}
          now={now}
          onStart={start}
          onCloseAutoFocus={launcherClosed}
        />
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} returnFocus={shortcutsOpener} />
        <TopicPicker target={pickTarget} onClose={() => setPickTarget(null)} returnFocus={pickOpener} topics={state.topics?.topics ?? []} createTopic={(title) => client.createTopic(title)} addMember={(id, m) => client.addMember(id, m)} />
      </div>
      </TopicsContext.Provider>
    </ClockContext.Provider>
  );
}
