import type { Settings } from '@shared/settings.ts';
import type { HarnessOption, LaunchRequest, LaunchView, ServerEvent } from '@shared/types.ts';

export interface ClientListener {
  onEvent(event: ServerEvent): void;
  onConnection(connected: boolean): void;
}

/** How the UI talks to the Lookout server. Tests pass a fake. */
export interface LookoutClient {
  subscribe(listener: ClientListener): () => void;
  saveSettings(patch: Partial<Settings>): Promise<Settings>;
  harnesses(): Promise<HarnessOption[]>;
  launch(req: LaunchRequest): Promise<LaunchView>;
  dismissLaunch(id: string): Promise<void>;
  /** Tells the server what this tab views, and whether its terminal drawer is open (VIEW-2). */
  watch(clientId: string, sessionId: string | null, preview: boolean): Promise<void>;
  /** VIEW-3: types a message into the Session and submits it. */
  sendMessage(sessionId: string, text: string): Promise<void>;
}

/** A request the server refused or couldn't answer; `message` is for people. */
export class SaveError extends Error {
  readonly field: string | null;
  /** The HTTP status, when the server answered. */
  readonly status: number | null;
  constructor(message: string, field: string | null = null, status: number | null = null) {
    super(message);
    this.field = field;
    this.status = status;
  }
}

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
  const send = async (method: string, path: string, body?: unknown, retry = true): Promise<Response> => {
    const res = await fetch(path, {
      method,
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
      throw err instanceof SaveError ? err : new SaveError("Couldn't reach the Lookout server.");
    }
    const body = (await res.json().catch(() => ({}))) as T & { error?: string; field?: string | null };
    if (!res.ok) throw new SaveError(body.error ?? `${what} failed (${res.status}).`, body.field ?? null, res.status);
    return body;
  };

  /**
   * What the tab views (VIEW): one request in flight at a time, and after it the latest wanted
   * state only, so the server never ends on a stale one. A failed one is retried. VIEW-1's
   * message cursors are meant to ride on the same channel.
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

  return {
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
    saveSettings: (patch) => call<Settings>(() => send('PUT', '/api/settings', patch), 'Saving'),
    harnesses: async () => (await call<{ harnesses: HarnessOption[] }>(() => fetch('/api/harnesses'), 'Loading Harnesses')).harnesses,
    launch: async (req) => (await call<{ launch: LaunchView }>(() => send('POST', '/api/launch', req), 'Starting')).launch,
    dismissLaunch: async (id) => {
      await call(() => send('DELETE', `/api/launch/${encodeURIComponent(id)}`), 'Dismissing');
    },
    watch: async (clientId, sessionId, preview) => {
      wanted = { clientId, sessionId, preview };
      wake?.();
      void pump();
    },
    sendMessage: async (sessionId, text) => {
      await call(() => send('POST', `/api/sessions/${encodeURIComponent(sessionId)}/send`, { text }), 'Sending');
    },
  };
}
