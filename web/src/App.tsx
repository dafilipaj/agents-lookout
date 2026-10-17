import type { LaunchHarness } from '@shared/settings.ts';
import type { ChatPage, EndTarget, HistoryItem, LaunchRequest, LaunchView, ResumeResult, SessionRow, Status } from '@shared/types.ts';
import { History as HistoryIcon } from 'lucide-react';
import { hasReset } from '@shared/usage.ts';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HistoryPanel } from '@/components/HistoryPanel';
import { Launcher } from '@/components/Launcher';
import { MainPane } from '@/components/MainPane';
import { PastSessionView } from '@/components/PastSessionView';
import { SettingsPage } from '@/components/SettingsPage';
import { SHELL_COLUMN, SHELL_GRID, ShellCell } from '@/components/Shell';
import { Sidebar } from '@/components/Sidebar';
import { StartingView } from '@/components/StartingView';
import { Button } from '@/components/ui/button';
import type { LookoutClient } from '@/lib/client';
import { tidySentAt } from '@/lib/activity';
import { type HistoryLayout, loadLayout, saveLayout } from '@/lib/history';
import { useAnyModalOpen } from '@/lib/modal';
import { type HarnessState, type LaunchDraft, initialDraft } from '@/lib/launch';
import { parseRoute, routePath, useRoute } from '@/lib/router';
import { HARNESS_NAME } from '@/lib/sessions';
import { cn } from '@/lib/utils';
import { listKnown, shownLaunches, useLookout } from '@/lib/store';
import { useNow } from '@/lib/time';

/** A manual drawer toggle, valid while the Session keeps the Status it had then. */
interface DrawerOverride {
  open: boolean;
  status: Status;
  since: number | null;
}

/** LAUNCH-4.2: the row this tab shows for its own start until the server lists it. */
function ownLaunch(id: string, title: string, harness: LaunchHarness, directory: string): LaunchView {
  return { id, title, harness, directory, startedAt: Date.now(), state: 'starting', error: null, terminal: null };
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
  const inFlight = useRef(new Set<string>());
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  // VIEW-3.4: the last failed send per Session, so it shows whichever composer is mounted.
  const [sendErrors, setSendErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [overrides, setOverrides] = useState<ReadonlyMap<string, DrawerOverride>>(new Map());
  // VIEW-1.10: when you last sent to each Session from the composer.
  const [sentAt, setSentAt] = useState<ReadonlyMap<string, number>>(new Map());

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
  const launches = useMemo(() => shownLaunches(state), [state]);
  const save = useCallback((patch: Parameters<LookoutClient['saveSettings']>[0]) => client.saveSettings(patch), [client]);

  // LAUNCH: the launcher. Its draft outlives closing it (LAUNCH-1.3); null = start fresh.
  const [launcherOpen, setLauncherOpen] = useState(false);
  // Background shortcuts stand down while any modal (the launcher, End Session) is open.
  const modalOpen = useAnyModalOpen();
  const [draft, setDraft] = useState<LaunchDraft | null>(null);
  const [harnesses, setHarnesses] = useState<HarnessState>({ state: 'loading' });
  const harnessRequest = useRef(false);
  const openLauncher = useCallback(() => {
    setLauncherOpen(true);
    if (harnessRequest.current) return;
    harnessRequest.current = true;
    client.harnesses().then(
      (list) => setHarnesses({ state: 'ready', harnesses: list }),
      (err: unknown) => {
        harnessRequest.current = false; // try again next time
        setHarnesses({ state: 'error', error: err instanceof Error ? err.message : "Couldn't load the Harnesses." });
      },
    );
  }, [client]);

  // LAUNCH-1.1: N opens the launcher when focus isn't in a text field. ⌘N does too, but a normal
  // Chrome tab keeps ⌘N for itself; it reaches the page only in an installed-app window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented || e.ctrlKey || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'n') return;
      if (!e.metaKey && (modalOpen || isTextField(e.target))) return;
      // ⌘N keeps working in the launcher, but never opens it over another dialog.
      if (modalOpen && !launcherOpen) return;
      e.preventDefault();
      openLauncher();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openLauncher, launcherOpen, modalOpen]);

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
      setDraft(null);
      setLauncherOpen(false);
    },
    [client, requestLaunch, navigate],
  );

  // HIST-1: the right sidebar; open or not, and its width, kept in this browser (HIST-1.3).
  const [layout, setLayout] = useState<HistoryLayout>(loadLayout);
  const [historyFocus, setHistoryFocus] = useState(0);
  const updateLayout = useCallback((patch: Partial<HistoryLayout>) => {
    setLayout((l) => {
      const next = { ...l, ...patch };
      saveLayout(next);
      return next;
    });
  }, []);
  const toggleHistory = useCallback(() => {
    setLayout((l) => {
      const next = { ...l, open: !l.open };
      saveLayout(next);
      return next;
    });
    setHistoryFocus((n) => n + 1);
  }, []);
  // HIST-1.1: H opens and closes it when focus isn't in a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 'h') return;
      if (modalOpen || isTextField(e.target)) return;
      e.preventDefault();
      toggleHistory();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleHistory, modalOpen]);
  const searchHistory = useCallback((q: Parameters<LookoutClient['history']>[0]) => client.history(q), [client]);
  const loadPast = useCallback((harness: HistoryItem['harness'], id: string) => client.pastSession(harness, id), [client]);
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
      const setError = (message: string | null) =>
        setSendErrors((m) => {
          const next = new Map(m);
          for (const id of ids()) {
            if (message === null) next.delete(id);
            else next.set(id, message);
          }
          return next;
        });
      setError(null);
      try {
        await client.sendMessage(sessionId, text);
        for (const id of ids()) if (drafts.get(id) === text) drafts.delete(id);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Sending failed.');
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

  // VIEW-5.6: Fleet ends it; the Session list then drops it, so the view shows it ended (VIEW-5.7).
  // `target` is the process the user confirmed, so a replacement is never the one closed.
  const endSession = useCallback(
    async (sessionId: string, target: EndTarget) => {
      await client.endSession(sessionId, target);
    },
    [client],
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
    // SIDE-8.1: one grid, rows header / content / dock, shared by every column (see Shell).
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
        onNewSession={openLauncher}
        launches={launches}
        selectedLaunchId={selectedLaunchId}
        onSelectLaunch={onSelectLaunch}
        onSelectNone={() => navigate({ name: 'home' }, { replace: true })}
        onDismissLaunch={(id) => void client.dismissLaunch(id).catch(() => {})}
        keyboardEnabled={!modalOpen}
        usage={state.usage}
        onUsageOpen={() => void client.refreshJev().catch(() => {})}
      />
      {/* tabIndex -1: focus lands here after the selected start is dismissed (LAUNCH UX). */}
      <main className={cn(SHELL_COLUMN, 'outline-none')} data-shell-column="main" tabIndex={-1}>
        {route.name === 'settings' ? (
          <SettingsPage settings={state.settings} save={save} onBack={() => navigate({ name: 'home' })} />
        ) : route.name === 'past' ? (
          <PastSessionView harness={route.harness} sessionId={route.id} now={now} load={loadPast} />
        ) : route.name === 'launch' ? (
          // Its Session is taking over the selection (the layout effect above): show nothing meanwhile.
          takeOver ? null : (
            <StartingView launch={launches.find((l) => l.id === route.id) ?? null} loaded={state.loaded} now={now} />
          )
        ) : (
          <MainPane
            selectedId={selectedId}
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
            sending={sending}
            sendErrors={sendErrors}
            onEdit={clearSendError}
            onSend={sendMessage}
            chat={(selectedId && state.chats.get(selectedId)) || null}
            onEarlier={loadEarlier}
            onPage={addPage}
            onFollowing={onFollowing}
            sentAt={sentAt}
            onSentAt={updateSentAt}
            onEnd={endSession}
          />
        )}
      </main>
      {layout.open ? (
        <HistoryPanel
          width={layout.width}
          onResize={(width) => updateLayout({ width })}
          onClose={toggleHistory}
          focusKey={historyFocus}
          sessions={state.sessions}
          now={now}
          search={searchHistory}
          onOpen={openPast}
        />
      ) : (
        // HIST-1.1: closed, the right sidebar is a narrow rail; its header cell carries the top line on.
        <div className={cn(SHELL_COLUMN, 'w-10 border-l border-sidebar-border bg-sidebar')} data-shell-column="right">
          <ShellCell row="header" className="justify-center border-sidebar-border">
            <Button variant="ghost" size="icon-sm" aria-label="History" title="History (H)" onClick={toggleHistory} className="size-7 text-muted-foreground">
              <HistoryIcon className="size-4" />
            </Button>
          </ShellCell>
        </div>
      )}
      <Launcher
        open={launcherOpen}
        onOpenChange={setLauncherOpen}
        draft={draft ?? initialDraft(state.settings)}
        onDraftChange={setDraft}
        settings={state.settings}
        harnesses={harnesses}
        usage={state.usage}
        now={now}
        onStart={start}
      />
    </div>
  );
}
