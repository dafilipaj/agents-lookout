import { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Socket } from 'node:net';
import { expect, it, vi } from 'vitest';
import { defaultSettings } from '../shared/settings.ts';
import type { ServerEvent } from '../shared/types.ts';
import { createApp } from './app.ts';
import { WorkMonitor } from './work.ts';
import { MemoryMonitor } from './memory.ts';
import { Library } from './library.ts';

/** Real HTTP handlers and SSE serialization over in-memory sockets, with no host ports or processes. */
function setup() {
  const memory = new MemoryMonitor({ runner: async (file) => file.endsWith('ps') ? '100 1 1024 0 node' : '25769803776\n1', pid: 100, sessions: () => [], load: () => ({ one: 3.3, cores: 12 }), onChange: (m) => app.broadcast({ type: 'memory', memory: m }) });
  const unused = async (): Promise<never> => { throw new Error('unused'); };
  const setOpen = vi.spyOn(memory, 'setOpen');
  const drop = vi.spyOn(memory, 'drop');
  const app = createApp({
    attachmentsDir: join(tmpdir(), `lookout-unused-attachments-${randomUUID()}`),
    guard: { allowedHosts: new Set(['localhost']), allowedOrigins: new Set(['http://localhost']), token: 'test' },
    monitor: { snapshot: () => ({ sessions: [], fleet: { state: 'ok' } }), watch: () => () => {} },
    settings: { get: defaultSettings, update: unused, onChange: () => () => {} },
    launcher: { list: () => [], recentStarts: () => [], harnesses: unused, start: unused, answerTrust: async () => null, trustDisconnected: () => {}, dismiss: () => false },
    usage: { snapshot: () => null, watch: () => () => {}, refresh: unused, refreshJev: unused },
    memory,
    library: new Library({ runner: unused, bin: () => 'tb-session' }),
    work: new WorkMonitor({ runner: unused, tbPrBin: () => '/nonexistent/tb-pr', tbProdBin: () => '/nonexistent/tb-prod', tbSessionBin: () => 'tb-session', onChange: () => {} }),
    viewer: { watch: () => {}, drop: () => {}, send: unused, earlier: unused },
    sessions: { end: unused, answer: unused, stop: unused, rename: unused, switchModel: unused, switchEffort: unused },
    files: { check: unused }, history: { find: unused, detail: unused, peek: unused, resume: unused }, staticDir: null,
  });
  const exchange = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const req = new IncomingMessage(new Socket());
    req.method = method; req.url = url;
    req.headers = { host: 'localhost', origin: 'http://localhost', 'x-lookout-token': 'test', 'content-type': 'application/json', ...headers };
    const res = new ServerResponse(req);
    let text = '';
    res.write = ((chunk: string) => { text += chunk; return true; }) as typeof res.write;
    let ended!: () => void;
    const done = new Promise<void>((resolve) => { ended = resolve; });
    res.end = ((chunk?: string) => { text += chunk ?? ''; ended(); return res; }) as typeof res.end;
    app.server.emit('request', req, res);
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
    return { req, res, done, text: () => text, events: () => text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)) as ServerEvent) };
  };
  return { app, memory, setOpen, drop, exchange };
}

it('MEM-2.7: each tab receives the latest memory snapshot and changed memory events, including reconnection', async () => {
  const { memory, exchange } = setup();
  const first = exchange('GET', '/api/events');
  try {
    await memory.tick();
    const events = first.events();
    expect(events[0]).toMatchObject({ type: 'snapshot', memory: null });
    expect(events[1]).toMatchObject({ type: 'memory', memory: { watchedBytes: 1024 * 1024 } });
    const second = exchange('GET', '/api/events');
    try {
      expect(second.events()[0]).toMatchObject({ type: 'snapshot', memory: memory.snapshot() });
      await memory.tick();
      expect(first.events()).toHaveLength(2);
      expect(second.events()).toHaveLength(1);
    } finally { second.req.emit('close'); }
  } finally { first.req.emit('close'); await memory.close(); }
});

it('MEM-3.1: memory watches require a live client, boolean, token and Origin, and stream closure drops its open watch', async () => {
  const { memory, exchange, setOpen, drop } = setup();
  const stream = exchange('GET', '/api/events');
  try {
    const snapshot = stream.events()[0];
    if (snapshot?.type !== 'snapshot') throw new Error('missing snapshot');
    const clientId = snapshot.clientId;
    for (const [body, headers, status] of [
      [{ clientId: 'unknown', open: true }, {}, 404],
      [{ clientId, open: 'true' }, {}, 400],
      [{ clientId, open: true }, { 'x-lookout-token': '' }, 403],
      [{ clientId, open: true }, { origin: '' }, 403],
      [{ clientId, open: true }, {}, 200],
      [{ clientId, open: false }, {}, 200],
    ] as const) {
      const call = exchange('PUT', '/api/memory/watch', body, headers);
      await call.done;
      expect(call.res.statusCode).toBe(status);
    }
    expect(setOpen.mock.calls.slice(-2)).toEqual([[clientId, true], [clientId, false]]);
    stream.req.emit('close');
    expect(drop).toHaveBeenCalledWith(clientId);
    const after = exchange('PUT', '/api/memory/watch', { clientId, open: true });
    await after.done;
    expect(after.res.statusCode).toBe(404);
  } finally { stream.req.emit('close'); await memory.close(); }
});

for (const release of ['breakdown', 'stream', 'last tab'] as const) {
  it(`MEM-2.3: releasing the ${release} restores the 30-second cadence or stops sampling with no tabs`, async () => {
    vi.useFakeTimers();
    const { memory, exchange } = setup();
    const tick = vi.spyOn(memory, 'tick');
    const first = exchange('GET', '/api/events');
    const second = release === 'last tab' ? null : exchange('GET', '/api/events');
    try {
      const snapshot = first.events()[0];
      if (snapshot?.type !== 'snapshot') throw new Error('missing snapshot');
      await vi.advanceTimersByTimeAsync(2000);
      const opened = exchange('PUT', '/api/memory/watch', { clientId: snapshot.clientId, open: true });
      await opened.done;
      await vi.advanceTimersByTimeAsync(5000);
      const count = tick.mock.calls.length;
      if (release === 'breakdown') await exchange('PUT', '/api/memory/watch', { clientId: snapshot.clientId, open: false }).done;
      else first.req.emit('close');
      await vi.advanceTimersByTimeAsync(29_999);
      expect(tick).toHaveBeenCalledTimes(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(tick).toHaveBeenCalledTimes(count + (release === 'last tab' ? 0 : 1));
      if (release === 'last tab') {
        await vi.advanceTimersByTimeAsync(60_000);
        expect(tick).toHaveBeenCalledTimes(count);
      }
    } finally {
      first.req.emit('close'); second?.req.emit('close');
      await memory.close();
      vi.useRealTimers();
    }
  });
}
