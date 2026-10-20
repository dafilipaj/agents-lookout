import { type Settings, defaultSettings } from '@shared/settings.ts';
import type { ChatPage, FleetHealth, HarnessOption, HistoryDetail, HistoryPage, LaunchRequest, LaunchView, ResumeResult, ServerEvent, SessionRow } from '@shared/types.ts';
import { act, render } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '@/App';
import type { ClientListener, HistoryQuery, LookoutClient } from '@/lib/client';

export const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);

export const settings = (over: Partial<Settings> = {}): Settings => ({ ...defaultSettings(), ...over });

export function row(over: Partial<SessionRow> & { id: string }): SessionRow {
  return {
    pid: 100,
    harness: 'claude',
    title: over.id,
    status: 'idle',
    waitingFor: null,
    statusSince: NOW - 60_000,
    contextPct: null,
    cwd: '/Users/me/Projects/work',
    git: { repo: 'work', worktree: null, branch: 'main' },
    backend: 'tmux',
    controllable: true,
    ownHost: false,
    procStart: '2026-10-14T08:12:03Z',
    model: null,
    ...over,
  };
}

export const HARNESSES: HarnessOption[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    installed: true,
    models: [
      { id: '', label: 'Default' },
      { id: 'claude-opus-5-5', label: 'Opus 5.5' },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
    ],
  },
  { id: 'codex', label: 'Codex', installed: true, models: [{ id: '', label: 'Default (gpt-6-astra)' }, { id: 'gpt-6-astra', label: 'GPT-6 Astra' }] },
];

export function launchView(over: Partial<LaunchView> & { id: string }): LaunchView {
  return {
    title: 'New Session',
    harness: 'claude',
    directory: '~/Projects/work',
    startedAt: NOW,
    state: 'starting',
    error: null,
    terminal: null,
    ...over,
  };
}

interface RenderOptions {
  harnesses?: () => Promise<HarnessOption[]>;
  launch?: LookoutClient['launch'];
  sendMessage?: (sessionId: string, text: string) => Promise<void>;
  endSession?: LookoutClient['endSession'];
  answer?: LookoutClient['answer'];
  stopSession?: LookoutClient['stopSession'];
  escSession?: LookoutClient['escSession'];
  earlierMessages?: (sessionId: string, before: string) => Promise<ChatPage>;
  history?: (q: HistoryQuery) => Promise<HistoryPage>;
  pastSession?: LookoutClient['pastSession'];
  resume?: LookoutClient['resume'];
  refreshWork?: LookoutClient['refreshWork'];
}

/** Renders the whole app against a fake server the test drives. */
export function renderApp(path = '/', options: RenderOptions = {}) {
  window.history.replaceState(null, '', path);
  let listener: ClientListener | null = null;
  const saveSettings = vi.fn(async (patch: Partial<Settings>): Promise<Settings> => settings(patch));
  const client: LookoutClient = {
    subscribe(l) {
      listener = l;
      return () => {
        listener = null;
      };
    },
    saveSettings,
    harnesses: vi.fn(options.harnesses ?? (async () => HARNESSES)),
    launch: vi.fn(options.launch ?? (async (req: LaunchRequest, launchId: string) => launchView({ id: launchId, title: req.name || 'New Session' }))),
    dismissLaunch: vi.fn(async () => {}),
    earlierMessages: vi.fn(options.earlierMessages ?? (async (): Promise<ChatPage> => ({ entries: [], before: null }))),
    watch: vi.fn(async () => {}),
    refreshJev: vi.fn(async () => {}),
    refreshUsage: vi.fn(async () => {}),
    watchWork: vi.fn(async () => {}),
    refreshWork: vi.fn(options.refreshWork ?? (async () => ({ ok: true as const }))),
    sendMessage: vi.fn(options.sendMessage ?? (async () => {})),
    endSession: vi.fn(options.endSession ?? (async () => ({ how: 'exit' as const }))),
    answer: vi.fn(options.answer ?? (async () => ({ epoch: 1 }))),
    stopSession: vi.fn(options.stopSession ?? (async () => {})),
    escSession: vi.fn(options.escSession ?? (async () => {})),
    history: vi.fn(options.history ?? (async (): Promise<HistoryPage> => ({ state: 'ok', items: [], page: 1, hasMore: false }))),
    pastSession: vi.fn(
      options.pastSession ??
        (async (): Promise<HistoryDetail> => {
          throw new Error('no past Session');
        }),
    ),
    resume: vi.fn(
      options.resume ??
        (async (): Promise<ResumeResult> => {
          throw new Error('no resume');
        }),
    ),
  };
  const utils = render(<App client={client} />);
  const emit = (event: ServerEvent) =>
    act(() => {
      listener!.onEvent(event);
    });
  const snapshot = (sessions: SessionRow[], fleet: FleetHealth = { state: 'ok' }, current: Settings = settings()) =>
    emit({ type: 'snapshot', sessions, fleet, settings: current, launches: [], started: [], clientId: 'tab-1', usage: null });
  const connection = (connected: boolean) =>
    act(() => {
      listener!.onConnection(connected);
    });
  return { ...utils, emit, snapshot, connection, saveSettings, client };
}

export function rowEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(id)}"]`);
  if (!el) throw new Error(`no row ${id}`);
  return el;
}

export function field(id: string, name: string): HTMLElement | null {
  return rowEl(id).querySelector<HTMLElement>(`[data-field="${name}"]`);
}

export const visibleTitles = () =>
  [...document.querySelectorAll('[role="option"] [data-field="title"]')].map((e) => e.textContent);

/** jsdom has no ResizeObserver: a fake one that records what it observes, and resizes on demand. */
export function fakeResizeObserver() {
  const observers: { cb: ResizeObserverCallback; targets: Set<Element> }[] = [];
  class FakeResizeObserver {
    targets = new Set<Element>();
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
      observers.push(this);
    }
    observe(t: Element) {
      this.targets.add(t);
    }
    unobserve(t: Element) {
      this.targets.delete(t);
    }
    disconnect() {
      this.targets.clear();
    }
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  const observed = (el: Element) => observers.some((o) => o.targets.has(el));
  const resize = (el: Element) =>
    act(() => {
      for (const o of observers) if (o.targets.has(el)) o.cb([{ target: el } as ResizeObserverEntry], o as unknown as ResizeObserver);
    });
  return { observed, resize };
}
