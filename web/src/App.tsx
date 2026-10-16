import type { LaunchRequest } from '@shared/types.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Launcher } from '@/components/Launcher';
import { MainPane } from '@/components/MainPane';
import { SettingsPage } from '@/components/SettingsPage';
import { Sidebar } from '@/components/Sidebar';
import type { LookoutClient } from '@/lib/client';
import { type HarnessState, type LaunchDraft, initialDraft } from '@/lib/launch';
import { useRoute } from '@/lib/router';
import { listKnown, useLookout } from '@/lib/store';
import { useNow } from '@/lib/time';

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

export function App({ client }: { client: LookoutClient }) {
  const state = useLookout(client);
  const [route, navigate] = useRoute();
  const now = useNow(1000);
  const sessions = useMemo(() => [...state.sessions.values()], [state.sessions]);
  const selectedId = route.name === 'session' ? route.id : null;

  // SIDE-3.3: the tab title counts the Sessions that need you.
  const needsYou = sessions.filter((s) => s.status === 'needs-you').length;
  useEffect(() => {
    document.title = needsYou > 0 ? `(${needsYou}) Lookout` : 'Lookout';
  }, [needsYou]);

  // A Codex Session's id changes once it gets a session id: keep it selected.
  const successor = selectedId && !state.sessions.has(selectedId) ? state.aliases.get(selectedId) : undefined;
  useEffect(() => {
    if (successor && state.sessions.has(successor)) navigate({ name: 'session', id: successor }, { replace: true });
  }, [successor, state.sessions, navigate]);

  const onSelect = useCallback(
    (id: string, how: 'push' | 'replace') => navigate({ name: 'session', id }, { replace: how === 'replace' }),
    [navigate],
  );
  const save = useCallback((patch: Parameters<LookoutClient['saveSettings']>[0]) => client.saveSettings(patch), [client]);

  // LAUNCH: the launcher. Its draft outlives closing it (LAUNCH-1.3); null = start fresh.
  const [launcherOpen, setLauncherOpen] = useState(false);
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
      if (!e.metaKey && (launcherOpen || isTextField(e.target))) return;
      e.preventDefault();
      openLauncher();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openLauncher, launcherOpen]);

  // LAUNCH-4.2: once Fleet reports a Session this tab started, select it.
  // Ownership is state, so whichever arrives last (the start's response or Fleet's report)
  // triggers the selection; `handled` makes each start select once.
  const [mine, setMine] = useState<ReadonlySet<string>>(new Set());
  const handled = useRef(new Set<string>());
  useEffect(() => {
    for (const id of mine) {
      const sessionId = state.started.get(id);
      if (!sessionId || handled.current.has(id)) continue;
      handled.current.add(id);
      navigate({ name: 'session', id: sessionId });
    }
  }, [mine, state.started, navigate]);

  const start = useCallback(
    async (req: LaunchRequest) => {
      const launch = await client.launch(req);
      setMine((m) => new Set(m).add(launch.id));
      setDraft(null);
      setLauncherOpen(false);
    },
    [client],
  );

  return (
    <div className="flex h-dvh overflow-hidden">
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
        launches={state.launches}
        onDismissLaunch={(id) => void client.dismissLaunch(id).catch(() => {})}
        keyboardEnabled={!launcherOpen}
      />
      <main className="min-w-0 flex-1 overflow-y-auto">
        {route.name === 'settings' ? (
          <SettingsPage settings={state.settings} save={save} onBack={() => navigate({ name: 'home' })} />
        ) : (
          <MainPane
            selectedId={selectedId}
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
          />
        )}
      </main>
      <Launcher
        open={launcherOpen}
        onOpenChange={setLauncherOpen}
        draft={draft ?? initialDraft(state.settings)}
        onDraftChange={setDraft}
        settings={state.settings}
        harnesses={harnesses}
        onStart={start}
      />
    </div>
  );
}
