import type { LibraryPage, LibraryQuery } from '@shared/library.ts';
import type { PathAnswer } from '@shared/files.ts';
import type { Settings, SettingsView } from '@shared/settings.ts';
import type { WorkRefreshResult } from '@shared/work.ts';
import { HELD_REASONS, type AnswerRequest, type AnswerResult, type ChatPage, type EffortSwitchRequest, type EffortSwitchResult, type EndResult, type EndTarget, type Harness, type HarnessOption, type HeldReason, type HistoryDetail, type HistoryPage, type HistoryPeek, type LaunchRequest, type LaunchView, type TrustRequest, type ModelSwitchRequest, type ModelSwitchResult, type RenameResult, type ResumeResult, type ServerEvent } from '@shared/types.ts';

export interface ClientListener {
  onEvent(event: ServerEvent): void;
  onConnection(connected: boolean): void;
}

/** How the UI talks to the Lookout server. Tests pass a fake. */
export interface LookoutClient {
  /** VIEW-9: sends one file's bytes to this Lookout server and returns its absolute saved path. */
  attach(file: File, name: string): Promise<string>;
  subscribe(listener: ClientListener): () => void;
  saveSettings(patch: Partial<Settings>): Promise<SettingsView>;
  harnesses(): Promise<HarnessOption[]>;
  /** LAUNCH-4.2: `launchId` is the tab's own, so its row is selected before this answers. */
  launch(req: LaunchRequest, launchId: string): Promise<LaunchView>;
  dismissLaunch(id: string): Promise<void>;
  answerTrust(id: string, req: TrustRequest): Promise<LaunchView | null>;
  /** VIEW-1.6: "Show earlier": the chat entries before `before`. */
  earlierMessages(sessionId: string, before: string): Promise<ChatPage>;
  /** Tells the server what this tab views, and whether its terminal drawer is open (VIEW-2). */
  watch(clientId: string, sessionId: string | null, preview: boolean): Promise<void>;
  /** VIEW-3: types a message into the Session and submits it. */
  sendMessage(sessionId: string, text: string): Promise<void>;
  /** VIEW-1.18: which of these paths are files, relative to the Session's folder; at most 100. */
  checkPaths(sessionId: string, paths: string[]): Promise<PathAnswer[]>;
  /** VIEW-5.6: ends the Session through Fleet (its Harness exits, its Session host closes). */
  endSession(sessionId: string, target: EndTarget): Promise<EndResult>;
  /** VIEW-5.12: renames the Session through Fleet: the Harness's own `/rename`, only while it's Idle. */
  renameSession(sessionId: string, title: string): Promise<RenameResult>;
  /**
   * VIEW-6: switches a Claude Code Session's model through Fleet, only while it's still that
   * process, Idle. Rejects with a SaveError whose `kind` is `uncertain` when Lookout can't tell
   * whether it switched (VIEW-6.8).
   */
  switchModel(sessionId: string, req: ModelSwitchRequest): Promise<ModelSwitchResult>;
  /** VIEW-7: switches a Claude Code Session's Effort through Fleet, as `switchModel` does its model (VIEW-7.8). */
  switchEffort(sessionId: string, req: EffortSwitchRequest): Promise<EffortSwitchResult>;
  /** VIEW-4.1–4.3: answers the prompt the Session waits on, only while its terminal still shows it untouched. */
  answer(sessionId: string, req: AnswerRequest): Promise<AnswerResult>;
  /** VIEW-4.4: interrupts a Busy Session, as Esc does in its terminal. */
  stopSession(sessionId: string): Promise<void>;
  /** VIEW-4.5: presses Esc in a Session that Needs you (a panel, a menu, a prompt Lookout doesn't answer). */
  escSession(sessionId: string): Promise<void>;
  /** USAGE-2.1: the details opened; have the server check Jev again. */
  refreshJev(): Promise<void>;
  /** USAGE-2.2: a window's reset passed; have the server read the limits again. */
  refreshUsage(): Promise<void>;
  /** MEM-3.1: whether this tab has the breakdown open, naming its current event stream. */
  watchMemory(clientId: string, open: boolean): Promise<void>;
  /** WORK-8.1: whether this tab has Work open, so the server reads only while some tab does. */
  watchWork(clientId: string, open: boolean): Promise<void>;
  /**
   * WORK-8.2: a forced read; refused during the cooldown or a rate limit (WORK-8.4). Rejects with a
   * SaveError saying in plain words why it didn't run: a 409, a server error, or no server.
   */
  refreshWork(): Promise<WorkRefreshResult>;
  /** HIST-2: past Sessions, newest first (empty query) or best match first. */
  library(q: LibraryQuery): Promise<LibraryPage>;
  libraryStatus(): Promise<{ indexing: boolean }>;
  history(q: HistoryQuery): Promise<HistoryPage>;
  /** HIST-3.3: a past Session's latest messages, read-only. */
  pastSession(harness: Harness, sessionId: string): Promise<HistoryDetail>;
  /** HIST-2.10: an expanded result's first prompt and last message. */
  pastPeek(harness: Harness, sessionId: string): Promise<HistoryPeek>;
  /** HIST-3.1/3.2: resume a past Session, or learn it's live. */
  resume(harness: Harness, sessionId: string, launchId: string): Promise<ResumeResult>;
}

export interface HistoryQuery {
  query: string;
  page: number;
  /** HIST-2.5: show Headless Sessions too. */
  headless: boolean;
  /** HIST-2.8: only this Harness's Sessions; null for both. */
  harness: Harness | null;
}

/** A request the server refused or couldn't answer; `message` is for people. */
export class SaveError extends Error {
  readonly field: string | null;
  /** The HTTP status, when the server answered. */
  readonly status: number | null;
  /** The server's kind of refusal, when it gives one (VIEW-4's `stale`, VIEW-3.7's `send_held`). */
  readonly kind: string | null;
  /** VIEW-3.7: why Fleet held a send, when it did and Lookout knows the reason. */
  readonly reason: HeldReason | null;
  /**
   * No answer came back from Lookout's server: the connection failed, or something in between (a
   * dev proxy while the server restarts) answered instead. The request may still have run.
   */
  readonly lost: boolean;
  constructor(message: string, field: string | null = null, status: number | null = null, extra: { kind?: string | null; reason?: HeldReason | null; lost?: boolean } = {}) {
    super(message);
    this.field = field;
    this.status = status;
    this.kind = extra.kind ?? null;
    this.reason = extra.reason ?? null;
    this.lost = extra.lost ?? false;
  }
}

/** WORK-8.2: Refresh refused while the server doesn't know yet that this tab has Work open (409). */
export const REFRESH_NOT_WATCHED = "Refresh didn't run: Lookout is still catching up with this tab. Try again in a moment.";
/** WORK-8.2: Refresh failed on Lookout's own server (a 500). */
export const REFRESH_FAILED = "Refresh failed: Lookout's server ran into a problem. Try again later.";

/** Retry delays for a watch the server didn't take: 1 s, 2 s, then every 5 s. */
const WATCH_RETRY_MS = [1000, 2000, 5000];

interface WatchState {
  clientId: string;
  sessionId: string | null;
  preview: boolean;
}

export function createHttpClient(): LookoutClient {
  // One token request at a time, shared by every request that needs it.
  let token: Promise<string> | null = null;
  const getToken = () => {
    token ??= (async () => {
      const res = await fetch('/api/bootstrap');
      if (!res.ok) throw new SaveError(`Lookout server refused (${res.status})`, null, res.status);
      return ((await res.json()) as { token: string }).token;
    })().catch((err: unknown) => {
      token = null;
      throw err;
    });
    return token;
  };

  /** A mutating request: needs the token; the server makes a new one on each start. */
  const send = async (method: string, path: string, body?: unknown, retry = true, signal?: AbortSignal): Promise<Response> => {
    const res = await fetch(path, {
      method,
      ...(signal ? { signal } : {}),
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        'x-lookout-token': await getToken(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 403 && retry) {
      token = null; // the server restarted with a new token
      return send(method, path, body, false);
    }
    return res;
  };

  /** Runs a request and returns its JSON, or throws a SaveError with the server's reason. */
  const call = async <T,>(request: () => Promise<Response>, what: string): Promise<T> => {
    let res: Response;
    try {
      res = await request();
    } catch (err) {
      throw err instanceof SaveError ? err : new SaveError("Couldn't reach the Lookout server.", null, null, { lost: true });
    }
    const body = (await res.json().catch(() => ({}))) as T & { error?: string; field?: string | null; kind?: string; reason?: unknown };
    if (!res.ok) {
      // Lookout's server always says why; a failure without a reason came from something in between.
      const lost = typeof body.error !== 'string' && res.status >= 500;
      const reason = HELD_REASONS.find((r) => r === body.reason) ?? null;
      throw new SaveError(body.error ?? `${what} failed (${res.status}).`, body.field ?? null, res.status, { kind: body.kind ?? null, reason, lost });
    }
    return body;
  };

  /**
   * What the tab views (VIEW): one request in flight at a time, and after it the latest wanted
   * state only, so the server never ends on a stale one. A failed one is retried. The viewed
   * Session's chat (VIEW-1) follows from it: the server keeps the cursors, not the tab.
   */
  let wanted: WatchState | null = null;
  let acked: string | null = null;
  let pumping = false;
  /** Ends a retry wait early: a new wanted state goes out at once. */
  let wake: (() => void) | null = null;
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    let attempt = 0;
    try {
      while (wanted && JSON.stringify(wanted) !== acked) {
        const sending = wanted;
        try {
          await call(() => send('PUT', '/api/watch', sending), 'Following the Session');
          acked = JSON.stringify(sending);
          attempt = 0;
        } catch (err) {
          // 404: that event stream is gone; its successor's snapshot brings a new client id.
          if (err instanceof SaveError && err.status === 404) {
            acked = JSON.stringify(sending);
            continue;
          }
          const delay = WATCH_RETRY_MS[Math.min(attempt, WATCH_RETRY_MS.length - 1)];
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, delay);
            function done() {
              clearTimeout(timer);
              wake = null;
              resolve();
            }
            wake = done;
          });
          attempt++;
        }
      }
    } finally {
      pumping = false;
    }
  };

  /**
   * WORK-8.1: whether this tab has Work open, sent as `watch` sends what it views: one request at a
   * time, then the latest wanted state only, retried until the server takes it. A 404 means that
   * event stream is gone, and the server stopped counting it; the next stream's snapshot brings a
   * new client id.
   */
  let workWanted: { clientId: string; open: boolean } | null = null;
  let workAcked: string | null = null;
  let workPumping = false;
  let workWake: (() => void) | null = null;
  const workPump = async () => {
    if (workPumping) return;
    workPumping = true;
    let attempt = 0;
    try {
      while (workWanted && JSON.stringify(workWanted) !== workAcked) {
        const sending = workWanted;
        try {
          await call(() => send('PUT', '/api/work/watch', sending), 'Watching Work');
          workAcked = JSON.stringify(sending);
          attempt = 0;
        } catch (err) {
          if (err instanceof SaveError && err.status === 404) {
            workAcked = JSON.stringify(sending);
            continue;
          }
          const delay = WATCH_RETRY_MS[Math.min(attempt, WATCH_RETRY_MS.length - 1)];
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, delay);
            function done() {
              clearTimeout(timer);
              workWake = null;
              resolve();
            }
            workWake = done;
          });
          attempt++;
        }
      }
    } finally {
      workPumping = false;
    }
  };

  let memoryWanted: { clientId: string; open: boolean } | null = null;
  let memoryAcked: string | null = null;
  let memoryPumping = false;
  let memoryWake: (() => void) | null = null;
  const memoryPump = async () => {
    if (memoryPumping) return;
    memoryPumping = true;
    let attempt = 0;
    try {
      while (memoryWanted && JSON.stringify(memoryWanted) !== memoryAcked) {
        const sending = memoryWanted;
        try {
          await call(() => send('PUT', '/api/memory/watch', sending), 'Watching Memory');
          memoryAcked = JSON.stringify(sending);
          attempt = 0;
        } catch (err) {
          if (err instanceof SaveError && err.status === 404) {
            memoryAcked = JSON.stringify(sending);
            continue;
          }
          const delay = WATCH_RETRY_MS[Math.min(attempt, WATCH_RETRY_MS.length - 1)];
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, delay);
            function done() {
              clearTimeout(timer);
              memoryWake = null;
              resolve();
            }
            memoryWake = done;
          });
          attempt++;
        }
      }
    } finally {
      memoryPumping = false;
    }
  };

  return {
    attach: async (file, name) => {
      const upload = async (retry = true): Promise<Response> => {
        const res = await fetch(`/api/attachments?name=${encodeURIComponent(name)}`, {
          method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-lookout-token': await getToken() },
          body: file,
        });
        if (res.status === 403 && retry) { token = null; return upload(false); }
        return res;
      };
      return (await call<{ path: string }>(() => upload(), 'Attaching')).path;
    },
    subscribe(listener) {
      let es: EventSource | null = null;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      let closed = false;
      const open = () => {
        es = new EventSource('/api/events');
        es.onopen = () => listener.onConnection(true);
        es.onmessage = (m: MessageEvent<string>) => listener.onEvent(JSON.parse(m.data) as ServerEvent);
        es.onerror = () => {
          listener.onConnection(false);
          // EventSource retries by itself, except after an HTTP error: then start over.
          if (es?.readyState === EventSource.CLOSED && !closed) {
            retryTimer = setTimeout(open, 2000);
          }
        };
      };
      open();
      return () => {
        closed = true;
        if (retryTimer) clearTimeout(retryTimer);
        es?.close();
      };
    },
    saveSettings: (patch) => call<SettingsView>(() => send('PUT', '/api/settings', patch), 'Saving'),
    harnesses: async () => (await call<{ harnesses: HarnessOption[] }>(() => fetch('/api/harnesses'), 'Loading Harnesses')).harnesses,
    launch: async (req, launchId) => (await call<{ launch: LaunchView }>(() => send('POST', '/api/launch', { ...req, launchId }), 'Starting')).launch,
    answerTrust: async (id, req) => {
      const body = await call<{ launch?: LaunchView | null }>(() => send('POST', `/api/launches/${encodeURIComponent(id)}/trust`, req, false, AbortSignal.timeout(20_000)), 'Answering trust prompt');
      if (body.launch !== null && (!body.launch || body.launch.id !== id || !['starting', 'trust', 'failed'].includes(body.launch.state))) {
        throw new SaveError("It may have been answered, but Lookout can't tell.", null, 502, { kind: 'uncertain' });
      }
      return body.launch;
    },
    dismissLaunch: async (id) => {
      await call(() => send('DELETE', `/api/launch/${encodeURIComponent(id)}`), 'Dismissing');
    },
    earlierMessages: (sessionId, before) =>
      call<ChatPage>(
        () => fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages?before=${encodeURIComponent(before)}`),
        'Loading earlier messages',
      ),
    watch: async (clientId, sessionId, preview) => {
      wanted = { clientId, sessionId, preview };
      wake?.();
      void pump();
    },
    watchWork: async (clientId, open) => {
      workWanted = { clientId, open };
      workWake?.();
      void workPump();
    },
    watchMemory: async (clientId, open) => {
      memoryWanted = { clientId, open };
      memoryWake?.();
      void memoryPump();
    },
    // WORK-8.2: the read's outcome, or a 429 with the time Refresh is back, which every tab's Refresh
    // shows anyway. Anything else didn't run, said in plain words (WORK UX, Errors): a 409, the server
    // not knowing yet that this tab has Work open (its stream reconnecting, the page still loading), a
    // server error, or no server.
    refreshWork: async () => {
      let res: Response;
      try {
        res = await send('POST', '/api/work/refresh');
      } catch {
        throw new SaveError("Couldn't reach the Lookout server.", null, null, { lost: true });
      }
      const body = (await res.json().catch(() => null)) as WorkRefreshResult | null;
      if (body && typeof body.ok === 'boolean' && (res.ok || res.status === 429)) return body;
      if (res.status === 409) throw new SaveError(REFRESH_NOT_WATCHED, null, 409);
      // Lookout's server always answers with a body; a failure without one came from something in between.
      const lost = res.status >= 500 && !body;
      throw new SaveError(lost ? "Couldn't reach the Lookout server." : REFRESH_FAILED, null, res.status, { lost });
    },
    refreshUsage: async () => {
      await call(() => send('POST', '/api/usage/refresh'), 'Refreshing usage');
    },
    refreshJev: async () => {
      await call(() => send('POST', '/api/usage/jev'), 'Checking Jev');
    },
    library: ({ query, page, continuation, headless, types, project, hideGone }) => call<LibraryPage>(() => fetch(`/api/library?${new URLSearchParams({ q: query, page: String(page), headless: headless ? '1' : '0', types: types.join(','), project, hideGone: hideGone ? '1' : '0', ...(continuation ? { continuation } : {}) })}`), 'Reading Library'),
    libraryStatus: () => call<{ indexing: boolean }>(() => fetch('/api/library/status'), 'Reading Library status'),
    history: ({ query, page, headless, harness }) =>
      call<HistoryPage>(
        () =>
          fetch(`/api/history?${new URLSearchParams({ q: query, page: String(page), headless: headless ? '1' : '0', ...(harness ? { harness } : {}) })}`),
        'Searching History',
      ),
    pastSession: (harness, sessionId) =>
      call<HistoryDetail>(() => fetch(`/api/history/${harness}/${encodeURIComponent(sessionId)}`), 'Loading the Session'),
    pastPeek: (harness, sessionId) =>
      call<HistoryPeek>(() => fetch(`/api/history/${harness}/${encodeURIComponent(sessionId)}/peek`), 'Reading the Session'),
    resume: (harness, sessionId, launchId) =>
      call<ResumeResult>(() => send('POST', '/api/history/resume', { sessionId, harness, launchId }), 'Resuming'),
    endSession: (sessionId, target) =>
      call<EndResult>(() => send('POST', `/api/sessions/${encodeURIComponent(sessionId)}/end`, target), 'Ending the Session'),
    renameSession: (sessionId, title) =>
      call<RenameResult>(() => send('POST', `/api/sessions/${encodeURIComponent(sessionId)}/rename`, { title }), 'Renaming'),
    switchModel: (sessionId, req) =>
      call<ModelSwitchResult>(() => send('POST', `/api/sessions/${encodeURIComponent(sessionId)}/model`, req), 'Switching the model'),
    switchEffort: (sessionId, req) =>
      call<EffortSwitchResult>(() => send('POST', `/api/sessions/${encodeURIComponent(sessionId)}/effort`, req), 'Switching the Effort'),
    answer: (sessionId, req) => call<AnswerResult>(() => send('POST', `/api/sessions/${encodeURIComponent(sessionId)}/answer`, req), 'Answering'),
    stopSession: async (sessionId) => {
      await call(() => send('POST', `/api/sessions/${encodeURIComponent(sessionId)}/stop`), 'Stopping');
    },
    // VIEW-4.5: Stop's route, for a Session that Needs you: the server presses only while it still does.
    escSession: async (sessionId) => {
      await call(() => send('POST', `/api/sessions/${encodeURIComponent(sessionId)}/stop`, { status: 'needs-you' }), 'Pressing Esc');
    },
    checkPaths: async (sessionId, paths) =>
      (await call<{ paths: PathAnswer[] }>(() => send('POST', `/api/sessions/${encodeURIComponent(sessionId)}/paths`, { paths }), 'Checking paths')).paths,
    sendMessage: async (sessionId, text) => {
      await call(() => send('POST', `/api/sessions/${encodeURIComponent(sessionId)}/send`, { text }), 'Sending');
    },
  };
}
