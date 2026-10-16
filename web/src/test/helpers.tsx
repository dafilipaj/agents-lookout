import { type Settings, defaultSettings } from '@shared/settings.ts';
import type { FleetHealth, HarnessOption, LaunchRequest, LaunchView, ServerEvent, SessionRow } from '@shared/types.ts';
import { act, render } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '@/App';
import type { ClientListener, LookoutClient } from '@/lib/client';

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
  launch?: (req: LaunchRequest) => Promise<LaunchView>;
  sendMessage?: (sessionId: string, text: string) => Promise<void>;
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
    launch: vi.fn(options.launch ?? (async (req: LaunchRequest) => launchView({ id: 'l-1', title: req.name || 'New Session' }))),
    dismissLaunch: vi.fn(async () => {}),
    watch: vi.fn(async () => {}),
    sendMessage: vi.fn(options.sendMessage ?? (async () => {})),
  };
  const utils = render(<App client={client} />);
  const emit = (event: ServerEvent) =>
    act(() => {
      listener!.onEvent(event);
    });
  const snapshot = (sessions: SessionRow[], fleet: FleetHealth = { state: 'ok' }, current: Settings = settings()) =>
    emit({ type: 'snapshot', sessions, fleet, settings: current, launches: [], started: [], clientId: 'tab-1' });
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
