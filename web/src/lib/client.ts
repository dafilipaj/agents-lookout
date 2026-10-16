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
}

/** A request the server refused or couldn't answer; `message` is for people. */
export class SaveError extends Error {
  readonly field: string | null;
  constructor(message: string, field: string | null = null) {
    super(message);
    this.field = field;
  }
}

export function createHttpClient(): LookoutClient {
  let token: string | null = null;

  const fetchToken = async () => {
    const res = await fetch('/api/bootstrap');
    if (!res.ok) throw new SaveError(`Lookout server refused (${res.status})`);
    token = ((await res.json()) as { token: string }).token;
    return token;
  };

  /** A mutating request: needs the token; the server makes a new one on each start. */
  const send = async (method: string, path: string, body?: unknown, retry = true): Promise<Response> => {
    const res = await fetch(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        'x-lookout-token': token ?? (await fetchToken()),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 403 && retry) {
      token = null;
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
    if (!res.ok) throw new SaveError(body.error ?? `${what} failed (${res.status}).`, body.field ?? null);
    return body;
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
  };
}
