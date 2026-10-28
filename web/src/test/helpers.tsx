import type { PathAnswer } from '@shared/files.ts';
import { type Settings, type SettingsView, defaultSettings } from '@shared/settings.ts';
import type { ChatPage, FleetHealth, HarnessOption, HistoryDetail, HistoryPage, HistoryPeek, LaunchRequest, LaunchView, ResumeResult, ServerEvent, SessionRow } from '@shared/types.ts';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect, vi } from 'vitest';
import { App } from '@/App';
import type { ClientListener, HistoryQuery, LookoutClient } from '@/lib/client';

export const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);

export const settings = (over: Partial<SettingsView> = {}): SettingsView => ({ ...defaultSettings(), productiveEmailSuggestion: null, ...over });

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
    git: { repo: 'work', worktree: null, branch: 'main', commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' },
    locationShown: { repo: true, where: true },
    backend: 'tmux',
    controllable: true,
    ownHost: false,
    procStart: '2026-10-14T08:12:03Z',
    pendingModel: null, pendingEffort: null,
    modelAt: null,
    model: null,
    effort: null,
    memoryGrowthBytes: null,
    subagents: null, activity: null, backgroundShell: false,
    ...over,
  };
}

/** VIEW-7.1: the levels Fleet lists for every Claude model today, lowest first. */
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export const HARNESSES: HarnessOption[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    installed: true,
    models: [
      { id: '', label: 'Default', efforts: CLAUDE_EFFORTS, defaultEffort: 'medium' },
      { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: CLAUDE_EFFORTS, defaultEffort: 'medium' },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: CLAUDE_EFFORTS, defaultEffort: 'medium' },
    ],
  },
  {
    id: 'codex',
    label: 'Codex',
    installed: true,
    models: [
      { id: '', label: 'Default (gpt-6-astra)', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
      { id: 'gpt-6-astra', label: 'GPT-6 Astra', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    ],
  },
];

export function launchView(over: Partial<LaunchView> & { id: string }): LaunchView {
  return {
    title: 'New Session',
    harness: 'claude',
    directory: '~/Projects/work',
    startedAt: NOW,
    state: 'starting',
    trust: null,
    error: null,
    terminal: null,
    ...over,
  };
}

interface RenderOptions {
  attach?: LookoutClient['attach'];
  library?: LookoutClient['library'];
  libraryStatus?: LookoutClient['libraryStatus'];
  harnesses?: () => Promise<HarnessOption[]>;
  launch?: LookoutClient['launch'];
  answerTrust?: LookoutClient['answerTrust'];
  sendMessage?: (sessionId: string, text: string) => Promise<void>;
  endSession?: LookoutClient['endSession'];
  renameSession?: LookoutClient['renameSession'];
  switchModel?: LookoutClient['switchModel'];
  switchEffort?: LookoutClient['switchEffort'];
  answer?: LookoutClient['answer'];
  stopSession?: LookoutClient['stopSession'];
  escSession?: LookoutClient['escSession'];
  earlierMessages?: (sessionId: string, before: string) => Promise<ChatPage>;
  history?: (q: HistoryQuery) => Promise<HistoryPage>;
  pastSession?: LookoutClient['pastSession'];
  pastPeek?: LookoutClient['pastPeek'];
  resume?: LookoutClient['resume'];
  refreshWork?: LookoutClient['refreshWork'];
  checkPaths?: LookoutClient['checkPaths'];
  saveSettings?: LookoutClient['saveSettings'];
}

/** Renders the whole app against a fake server the test drives. */
export function renderApp(path = '/', options: RenderOptions = {}) {
  window.history.replaceState(null, '', path);
  let listener: ClientListener | null = null;
  // The fake server's settings: the last ones the test sent, which a save patches and answers with, as the server does.
  let served = settings();
  const saveSettings = vi.fn(options.saveSettings ?? (async (patch: Partial<Settings>): Promise<SettingsView> => (served = { ...served, ...patch })));
  const client: LookoutClient = {
    attach: vi.fn(options.attach ?? (async (_file, name) => `/attachments/${name}`)),
    subscribe(l) {
      listener = l;
      return () => {
        listener = null;
      };
    },
    saveSettings,
    harnesses: vi.fn(options.harnesses ?? (async () => HARNESSES)),
    launch: vi.fn(options.launch ?? (async (req: LaunchRequest, launchId: string) => launchView({ id: launchId, title: req.name || 'New Session' }))),
    answerTrust: vi.fn(options.answerTrust ?? (async () => null)),
    dismissLaunch: vi.fn(async () => {}),
    earlierMessages: vi.fn(options.earlierMessages ?? (async (): Promise<ChatPage> => ({ entries: [], before: null }))),
    watch: vi.fn(async () => {}),
    refreshJev: vi.fn(async () => {}),
    refreshUsage: vi.fn(async () => {}),
    watchMemory: vi.fn(async () => {}),
    watchWork: vi.fn(async () => {}),
    refreshWork: vi.fn(options.refreshWork ?? (async () => ({ ok: true as const }))),
    sendMessage: vi.fn(options.sendMessage ?? (async () => {})),
    // VIEW-1.18: no path is a file unless the test says so.
    checkPaths: vi.fn(options.checkPaths ?? (async (_id: string, paths: string[]): Promise<PathAnswer[]> => paths.map((path) => ({ path, exists: false, absolute: null })))),
    endSession: vi.fn(options.endSession ?? (async () => ({ how: 'exit' as const }))),
    renameSession: vi.fn(options.renameSession ?? (async () => ({ result: 'renamed' as const }))),
    switchModel: vi.fn(options.switchModel ?? (async (_id: string, req: { model: string }) => ({ model: req.model, confirmed: false }))),
    switchEffort: vi.fn(options.switchEffort ?? (async (_id: string, req: { effort: string }) => ({ effort: req.effort, confirmed: false, saved: req.effort !== 'max' }))),
    answer: vi.fn(options.answer ?? (async () => ({ epoch: 1 }))),
    stopSession: vi.fn(options.stopSession ?? (async () => {})),
    escSession: vi.fn(options.escSession ?? (async () => {})),
    library: vi.fn(options.library ?? (async () => ({ state: 'ok' as const, items: [], nextPage: 2, hasMore: false, hiddenGone: 0, unfilteredEmpty: true, projects: [] }))),
    libraryStatus: vi.fn(options.libraryStatus ?? (async () => ({ indexing: false }))),
    history: vi.fn(options.history ?? (async (): Promise<HistoryPage> => ({ state: 'ok', items: [], page: 1, hasMore: false }))),
    pastSession: vi.fn(
      options.pastSession ??
        (async (): Promise<HistoryDetail> => {
          throw new Error('no past Session');
        }),
    ),
    pastPeek: vi.fn(options.pastPeek ?? (async (): Promise<HistoryPeek> => ({ firstPrompt: null, last: null, tailed: true }))),
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
      if (event.type === 'snapshot' || event.type === 'settings') served = event.settings;
      listener!.onEvent(event);
    });
  const snapshot = (sessions: SessionRow[], fleet: FleetHealth = { state: 'ok' }, current: SettingsView = settings()) =>
    emit({ type: 'snapshot', sessions, fleet, settings: current, launches: [], started: [], clientId: 'tab-1', usage: null, memory: null });
  const connection = (connected: boolean) =>
    act(() => {
      listener!.onConnection(connected);
    });
  return { ...utils, emit, snapshot, connection, saveSettings, client };
}

/**
 * HIST-3.5: a past Session is resumed, opened or shown only by its expanded result's button: a click
 * on the result expands it (when it isn't already), then the button is pressed.
 */
export async function pressResult(user: UserEvent, title: string) {
  const panel = screen.getByTestId('history-panel');
  const titleEl = await within(panel).findByText(title, { selector: '[data-field="title"]' });
  const option = titleEl.closest<HTMLElement>('[role="option"]')!;
  if (option.getAttribute('aria-expanded') !== 'true') await user.click(titleEl);
  await pressRowAction(user, option.querySelector<HTMLElement>('[data-field="actions"] [data-action]')!);
}

/**
 * A row's labelled button, pressed once the row a click expanded has settled (ROW_SETTLE_MS, WORK-1.12,
 * HIST-3.5): until then it ignores presses and says it's disabled.
 */
export async function pressRowAction(user: UserEvent, button: HTMLElement) {
  await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'));
  await user.click(button);
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

/**
 * The pointer crossing from one element into another (user-event's `hover` gives its events no
 * `relatedTarget`, so React takes every move as leaving the page): `out` of `from`, `over` `to`.
 */
export function movePointer(from: Element, to: Element) {
  const pointer = (type: string, target: Element, related: Element) => {
    const e = new MouseEvent(type, { bubbles: true, relatedTarget: related });
    act(() => {
      target.dispatchEvent(e);
    });
  };
  pointer('pointerout', from, to);
  pointer('pointerover', to, from);
}

/**
 * jsdom has no layout: give a preview box sizes as its text would have them. It fits when its text
 * is one of `fits`, else it is taller than its box and scrolls. Read live, so the box measures
 * what it shows after the option under the pointer changes.
 */
export function sizeBoxByText(pre: Element, fits: string[]) {
  Object.defineProperty(pre, 'scrollHeight', { configurable: true, get: () => (fits.includes(pre.textContent ?? '') ? 100 : 900) });
  Object.defineProperty(pre, 'clientHeight', { configurable: true, get: () => 300 });
  Object.defineProperty(pre, 'scrollWidth', { configurable: true, get: () => 100 });
  Object.defineProperty(pre, 'clientWidth', { configurable: true, get: () => 300 });
}
