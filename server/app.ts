import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { SettingsError } from '../shared/settings.ts';
import type { HarnessOption, LaunchView, ServerEvent } from '../shared/types.ts';
import { LaunchError } from './launcher.ts';
import type { SessionMonitor } from './monitor.ts';
import { type GuardConfig, guardRequest } from './security.ts';
import type { SettingsStore } from './settings.ts';
import { serveStatic } from './static.ts';

export interface AppOptions {
  guard: GuardConfig;
  monitor: Pick<SessionMonitor, 'snapshot' | 'watch'>;
  settings: Pick<SettingsStore, 'get' | 'update' | 'onChange'>;
  launcher: {
    list(): LaunchView[];
    recentStarts(): { launchId: string; sessionId: string }[];
    harnesses(): Promise<HarnessOption[]>;
    start(input: unknown): Promise<LaunchView>;
    dismiss(id: string): boolean;
  };
  /** Directory of the built UI; null in `pnpm dev`, where Vite serves it. */
  staticDir: string | null;
  keepAliveMs?: number;
}

export interface LookoutApp {
  server: Server;
  /** Pushes an event to every open UI. */
  broadcast(event: ServerEvent): void;
}

const MAX_BODY = 16 * 1024;
/** A launch carries a prompt of up to 100,000 characters: up to ~600 KB of JSON-escaped UTF-8. */
const MAX_LAUNCH_BODY = 1024 * 1024;

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
};

export function createApp(opts: AppOptions): LookoutApp {
  const clients = new Set<ServerResponse>();

  const send = (res: ServerResponse, event: ServerEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const broadcast = (event: ServerEvent) => {
    for (const res of clients) send(res, event);
  };
  opts.settings.onChange((settings) => broadcast({ type: 'settings', settings }));

  const handleEvents = (req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    const { sessions, fleet } = opts.monitor.snapshot();
    send(res, { type: 'snapshot', sessions, fleet, settings: opts.settings.get(), launches: opts.launcher.list(),
      started: opts.launcher.recentStarts(),
    });
    clients.add(res);
    const unwatch = opts.monitor.watch();
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), opts.keepAliveMs ?? 15_000);
    req.on('close', () => {
      clearInterval(keepAlive);
      clients.delete(res);
      unwatch();
    });
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const verdict = guardRequest(req, opts.guard);
    if (!verdict.ok) return json(res, verdict.status, { error: verdict.reason });

    const route = `${req.method} ${url.pathname}`;
    switch (route) {
      case 'GET /api/bootstrap':
        return json(res, 200, { token: opts.guard.token });
      case 'GET /api/events':
        return handleEvents(req, res);
      case 'GET /api/settings':
        return json(res, 200, opts.settings.get());
      case 'PUT /api/settings': {
        const body = await readJson(req, res, MAX_BODY, null);
        if (body === NO_BODY) return;
        try {
          return json(res, 200, await opts.settings.update(body));
        } catch (err) {
          if (err instanceof SettingsError) return json(res, 400, { error: err.message, field: err.field });
          throw err;
        }
      }
      case 'GET /api/harnesses':
        try {
          return json(res, 200, { harnesses: await opts.launcher.harnesses() });
        } catch (err) {
          if (err instanceof LaunchError) return json(res, err.status, { error: err.message });
          throw err;
        }
      case 'POST /api/launch': {
        const body = await readJson(req, res, MAX_LAUNCH_BODY, { error: 'The prompt is too long.', field: 'prompt' });
        if (body === NO_BODY) return;
        try {
          return json(res, 200, { launch: await opts.launcher.start(body) });
        } catch (err) {
          if (err instanceof LaunchError) return json(res, err.status, { error: err.message, field: err.field });
          throw err;
        }
      }
    }
    const dismiss = /^\/api\/launch\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (dismiss && req.method === 'DELETE') {
      return opts.launcher.dismiss(dismiss[1]!) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'no such failed launch' });
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
    if (!opts.staticDir) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('In development, open the Vite dev server instead.\n');
      return;
    }
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    return serveStatic(opts.staticDir, url.pathname, res);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      console.error('lookout: request failed', err);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      else res.end();
    });
  });
  return { server, broadcast };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const NO_BODY = Symbol('no body');

class BodyTooLarge extends Error {
  /** The client kept sending past the hard cap; the connection is already gone. */
  readonly aborted: boolean;
  constructor(aborted: boolean) {
    super('body too large');
    this.aborted = aborted;
  }
}

/** Past the limit, a body is read and discarded up to this many times the limit… */
const DISCARD_FACTOR = 4;
/** …or for this long, so the 413 can be read; beyond either, the connection is dropped. */
const DISCARD_MS = 5000;

/**
 * Reads a JSON body of at most `limit` bytes; on a bad one, answers the request itself and
 * returns NO_BODY. `tooLarge` is the 413 body, e.g. naming the field that made it too large.
 */
async function readJson(
  req: IncomingMessage,
  res: ServerResponse,
  limit: number,
  tooLarge: { error: string; field: string } | null,
): Promise<unknown> {
  if (!String(req.headers['content-type']).startsWith('application/json')) {
    json(res, 415, { error: 'expected application/json' });
    return NO_BODY;
  }
  let text: string;
  try {
    text = await readBody(req, limit);
  } catch (err) {
    if (err instanceof BodyTooLarge) {
      // The whole body has been read, so the client is listening: the 413 reaches it.
      if (!err.aborted) json(res, 413, tooLarge ?? { error: 'Request too large.' });
    } else {
      json(res, 400, { error: 'unreadable body' });
    }
    return NO_BODY;
  }
  try {
    return JSON.parse(text);
  } catch {
    json(res, 400, { error: 'invalid JSON' });
    return NO_BODY;
  }
}

/**
 * Reads the body. Past `limit` it keeps reading but discards, and rejects with BodyTooLarge
 * once the request ends: answering while the client is still uploading would make it see a
 * reset instead of the 413. A client that sends far more, or for too long, is cut off.
 */
function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    let timer: NodeJS.Timeout | null = null;
    const chunks: Buffer[] = [];
    const cutOff = () => {
      if (timer) clearTimeout(timer);
      req.removeAllListeners('data');
      req.removeAllListeners('end');
      req.destroy();
      reject(new BodyTooLarge(true));
    };
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= limit) {
        chunks.push(c);
        return;
      }
      if (!over) {
        over = true;
        chunks.length = 0;
        timer = setTimeout(cutOff, DISCARD_MS);
      }
      if (size > limit * DISCARD_FACTOR) cutOff();
    });
    req.on('end', () => {
      if (timer) clearTimeout(timer);
      if (over) reject(new BodyTooLarge(false));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}
