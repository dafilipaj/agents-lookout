import { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Socket } from 'node:net';
import { expect, it, vi } from 'vitest';
import { defaultSettings } from '../shared/settings.ts';
import type { ServerEvent } from '../shared/types.ts';
import { createApp } from './app.ts';
import { ChangesError } from './changes.ts';
import { PlainError } from './plain.ts';
import { WorkMonitor } from './work.ts';
import { Library } from './library.ts';

/** Real HTTP handlers over in-memory sockets, with a stand-in for the Changes tracker. */
function setup() {
  const unused = async (): Promise<never> => {
    throw new Error('unused');
  };
  const changes = {
    watch: vi.fn(),
    drop: vi.fn(),
    open: vi.fn(async (_s: string, body: unknown) => {
      if ((body as { path?: string }).path === 'refused.ts') throw new ChangesError(404, "Lookout's latest list doesn't have that file.");
    }),
  };
  const plain = {
    read: vi.fn(async (_source: unknown, path: unknown, _fresh?: boolean) => {
      if (path === 'gone.plain') throw new PlainError(404, "gone.plain isn't in this Checkout or at its Branch point.");
      return { path } as never;
    }),
    setViewed: vi.fn(async () => {}),
    viewedPaths: vi.fn(async () => ['plain/a.plain']),
    prFiles: vi.fn(async (repo: unknown, number: unknown) => {
      if (repo === 'nowhere') throw new PlainError(404, 'No local clone of nowhere.');
      return { repo: String(repo), number: Number(number), files: [{ path: 'plain/crm.plain', viewed: true }], error: null };
    }),
  };
  const app = createApp({
    attachmentsDir: join(tmpdir(), `lookout-unused-attachments-${randomUUID()}`),
    guard: { allowedHosts: new Set(['localhost']), allowedOrigins: new Set(['http://localhost']), token: 'test' },
    monitor: { snapshot: () => ({ sessions: [], fleet: { state: 'ok' } }), watch: () => () => {} },
    settings: { get: defaultSettings, update: unused, onChange: () => () => {} },
    launcher: { list: () => [], recentStarts: () => [], harnesses: unused, start: unused, answerTrust: async () => null, trustDisconnected: () => {}, dismiss: () => false },
    usage: { snapshot: () => null, watch: () => () => {}, refresh: unused, refreshJev: unused },
    memory: { snapshot: () => null, watch: () => () => {}, setOpen: () => {}, drop: () => {} },
    library: new Library({ runner: unused, bin: () => 'tb-session' }),
    work: new WorkMonitor({ runner: unused, tbPrBin: () => '/nonexistent/tb-pr', tbProdBin: () => '/nonexistent/tb-prod', tbSessionBin: () => 'tb-session', onChange: () => {} }),
    viewer: { watch: () => {}, drop: () => {}, send: unused, earlier: unused },
    sessions: { end: unused, answer: unused, stop: unused, rename: unused, switchModel: unused, switchEffort: unused },
    changes,
    plain,
    files: { check: unused },
    history: { find: unused, detail: unused, peek: unused, resume: unused },
    staticDir: null,
  });
  const exchange = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const req = new IncomingMessage(new Socket());
    req.method = method;
    req.url = url;
    req.headers = { host: 'localhost', origin: 'http://localhost', 'x-lookout-token': 'test', 'content-type': 'application/json', ...headers };
    const res = new ServerResponse(req);
    let text = '';
    res.write = ((chunk: string) => {
      text += chunk;
      return true;
    }) as typeof res.write;
    let ended!: () => void;
    const done = new Promise<void>((resolve) => {
      ended = resolve;
    });
    res.end = ((chunk?: string) => {
      text += chunk ?? '';
      ended();
      return res;
    }) as typeof res.end;
    app.server.emit('request', req, res);
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
    return { req, res, done, text: () => text, events: () => text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)) as ServerEvent) };
  };
  return { changes, plain, exchange };
}

it("DIFF-3.6: a list is watched through the tab's live event stream, and its closing drops the watch", async () => {
  const { changes, exchange } = setup();
  const stream = exchange('GET', '/api/events');
  try {
    const snapshot = stream.events()[0];
    if (snapshot?.type !== 'snapshot') throw new Error('missing snapshot');
    const clientId = snapshot.clientId;
    for (const [body, headers, status] of [
      [{ clientId: 'unknown', sessionId: 's1' }, {}, 404],
      [{ clientId, sessionId: 7 }, {}, 400],
      [{ clientId, sessionId: 's1' }, { 'x-lookout-token': '' }, 403],
      [{ clientId, sessionId: 's1' }, {}, 200],
      [{ clientId, sessionId: null }, {}, 200],
    ] as const) {
      const call = exchange('PUT', '/api/changes/watch', body, headers);
      await call.done;
      expect(call.res.statusCode).toBe(status);
    }
    expect(changes.watch.mock.calls).toEqual([[clientId, 's1'], [clientId, null]]);
    stream.req.emit('close');
    expect(changes.drop).toHaveBeenCalledWith(clientId);
  } finally {
    stream.req.emit('close');
  }
});

it('DIFF-4.4: opening a file passes every check a mutation gets, and says why when it is refused', async () => {
  const { changes, exchange } = setup();
  for (const [headers, status] of [
    [{ 'x-lookout-token': '' }, 403],
    [{ origin: '' }, 403],
    [{ origin: 'http://evil.example' }, 403],
    [{ host: 'evil.example' }, 403],
    [{ 'sec-fetch-site': 'cross-site' }, 403],
  ] as const) {
    const call = exchange('POST', '/api/sessions/s1/changes/open', { root: '/r', path: 'a.ts' }, headers);
    await call.done;
    expect(call.res.statusCode).toBe(status);
  }
  expect(changes.open).not.toHaveBeenCalled();
  const ok = exchange('POST', '/api/sessions/s1/changes/open', { root: '/r', path: 'a.ts' });
  await ok.done;
  expect(ok.res.statusCode).toBe(200);
  expect(changes.open).toHaveBeenCalledWith('s1', { root: '/r', path: 'a.ts' });
  const no = exchange('POST', '/api/sessions/s1/changes/open', { root: '/r', path: 'refused.ts' });
  await no.done;
  expect(no.res.statusCode).toBe(404);
  expect(JSON.parse(no.text())).toEqual({ error: "Lookout's latest list doesn't have that file." });
});

it('PLAIN-1.1, PLAIN-6.1: a Module is read by Session, Checkout id and path, and a refusal says why', async () => {
  const { plain, exchange } = setup();
  const ok = exchange('GET', '/api/plain?session=s1&checkout=0123456789abcdef&path=plain%2Fcrm.plain', undefined, { 'x-lookout-token': '' });
  await ok.done;
  expect(ok.res.statusCode).toBe(200);
  expect(plain.read).toHaveBeenCalledWith({ kind: 'session', session: 's1', checkout: '0123456789abcdef' }, 'plain/crm.plain', false);
  const no = exchange('GET', '/api/plain?session=s1&checkout=0123456789abcdef&path=gone.plain');
  await no.done;
  expect(no.res.statusCode).toBe(404);
  expect(JSON.parse(no.text())).toEqual({ error: "gone.plain isn't in this Checkout or at its Branch point." });
  const list = exchange('GET', '/api/plain/viewed?session=s1&checkout=0123456789abcdef');
  await list.done;
  expect(JSON.parse(list.text())).toEqual({ paths: ['plain/a.plain'] });
});

it('PLAIN-4.1: ticking Viewed passes every check a mutation gets', async () => {
  const { plain, exchange } = setup();
  const body = { session: 's1', checkout: '0123456789abcdef', path: 'plain/crm.plain', key: 'a'.repeat(64), viewed: true };
  for (const [headers, status] of [
    [{ 'x-lookout-token': '' }, 403],
    [{ origin: 'http://evil.example' }, 403],
    [{ 'sec-fetch-site': 'cross-site' }, 403],
  ] as const) {
    const call = exchange('POST', '/api/plain/viewed', body, headers);
    await call.done;
    expect(call.res.statusCode).toBe(status);
  }
  expect(plain.setViewed).not.toHaveBeenCalled();
  const ok = exchange('POST', '/api/plain/viewed', body);
  await ok.done;
  expect(ok.res.statusCode).toBe(200);
  expect(plain.setViewed).toHaveBeenCalledWith({ kind: 'session', session: 's1', checkout: '0123456789abcdef' }, 'plain/crm.plain', 'a'.repeat(64), true);
  const pr = exchange('POST', '/api/plain/viewed', { repo: 'shop', pr: 7, path: 'plain/crm.plain', key: 'b'.repeat(64), viewed: false });
  await pr.done;
  expect(pr.res.statusCode).toBe(200);
  expect(plain.setViewed).toHaveBeenLastCalledWith({ kind: 'pr', repo: 'shop', number: 7 }, 'plain/crm.plain', 'b'.repeat(64), false);
});

it("PLAIN-5.1, 5.3, 5.4: a PR's Modules and a PR's Module are read by repo and number, fresh on opening; no clone says why", async () => {
  const { plain, exchange } = setup();
  const view = exchange('GET', '/api/plain?repo=shop&pr=7&path=plain%2Fcrm.plain&fresh=1');
  await view.done;
  expect(view.res.statusCode).toBe(200);
  expect(plain.read).toHaveBeenCalledWith({ kind: 'pr', repo: 'shop', number: '7' }, 'plain/crm.plain', true);
  const list = exchange('GET', '/api/plain/pr?repo=shop&pr=7&fresh=1');
  await list.done;
  expect(JSON.parse(list.text())).toEqual({ repo: 'shop', number: 7, files: [{ path: 'plain/crm.plain', viewed: true }], error: null });
  expect(plain.prFiles).toHaveBeenCalledWith('shop', '7', true);
  const none = exchange('GET', '/api/plain/pr?repo=nowhere&pr=7');
  await none.done;
  expect(none.res.statusCode).toBe(404);
  expect(JSON.parse(none.text())).toEqual({ error: 'No local clone of nowhere.' });
});
