import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Socket } from 'node:net';
import { Duplex } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { defaultSettings } from '../shared/settings.ts';
import type { SetupSnapshot } from '../shared/setup.ts';
import { type AppOptions, createApp } from './app.ts';
import { Library } from './library.ts';
import { localAllowLists } from './security.ts';
import { SetupFailure } from './setup.ts';

/** The real HTTP handler over an in-memory socket, with an optional JSON body. */
async function request(app: ReturnType<typeof createApp>, url: string, opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const chunks: Buffer[] = [];
  const socket = new Duplex({ read() {}, write(c, _encoding, done) { chunks.push(Buffer.from(c)); done(); } });
  const req = new IncomingMessage(new Socket());
  req.method = opts.method ?? 'GET';
  req.url = url;
  req.headers = { host: '127.0.0.1:4747', ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...opts.headers };
  const res = new ServerResponse(req);
  res.assignSocket(socket as never);
  await new Promise<void>((resolve) => {
    res.on('finish', resolve);
    app.server.emit('request', req, res);
    if (opts.body !== undefined) req.push(Buffer.from(JSON.stringify(opts.body)));
    req.push(null);
  });
  socket.destroy();
  req.destroy();
  const text = Buffer.concat(chunks).toString().split('\r\n\r\n').slice(1).join('\r\n\r\n');
  return { status: res.statusCode, json: text ? JSON.parse(text) : null };
}

function app(setup: AppOptions['setup']) {
  return createApp({
    attachmentsDir: join(tmpdir(), `lookout-unused-attachments-${randomUUID()}`),
    library: new Library({ runner: vi.fn(), bin: () => 'tb-session' }),
    guard: { ...localAllowLists(4747), token: 'test-token' },
    monitor: { snapshot: () => ({ sessions: [], fleet: { state: 'ok' } }), watch: () => () => {} },
    settings: { get: defaultSettings, update: async () => defaultSettings(), onChange: () => () => {} },
    launcher: { list: () => [], recentStarts: () => [], harnesses: async () => [], start: vi.fn(), answerTrust: async () => null, trustDisconnected: () => {}, dismiss: () => false },
    usage: { snapshot: () => null, watch: () => () => {}, refresh: async () => {}, refreshJev: async () => {} },
    memory: { snapshot: () => null, watch: () => () => {}, setOpen: () => {}, drop: () => {} },
    files: { check: vi.fn() },
    history: { find: vi.fn(), detail: vi.fn(), peek: vi.fn(), resume: vi.fn() },
    viewer: { watch: () => {}, drop: () => {}, send: vi.fn(), earlier: vi.fn() },
    sessions: { end: vi.fn(), answer: vi.fn(), stop: vi.fn(), rename: vi.fn(), switchModel: vi.fn(), switchEffort: vi.fn() },
    work: { snapshot: vi.fn(), watch: () => () => {}, refresh: vi.fn() },
    setup,
    staticDir: null,
  } satisfies AppOptions);
}

const MUTATION = { origin: 'http://127.0.0.1:4747', 'x-lookout-token': 'test-token' };
const SNAPSHOT: SetupSnapshot = { items: [], errors: [], readAt: 1 };

it('SETUP-1.8: GET /api/setup answers a fresh read; a server without Setup has none', async () => {
  const read = vi.fn(async () => SNAPSHOT);
  const res = await request(app({ read, setSkill: vi.fn(), setPlugin: vi.fn(), readSession: vi.fn() }), '/api/setup');
  expect(res).toEqual({ status: 200, json: SNAPSHOT });
  expect(read).toHaveBeenCalledTimes(1);
  expect((await request(app(undefined), '/api/setup')).status).toBe(404);
});

it('SETUP-4.1, SETUP-4.2: a switch takes the token and Origin, checks its body, and answers the read after it', async () => {
  const setSkill = vi.fn(async () => SNAPSHOT);
  const setPlugin = vi.fn(async () => SNAPSHOT);
  const server = app({ read: vi.fn(), setSkill, setPlugin, readSession: vi.fn() });
  expect((await request(server, '/api/setup/skill', { method: 'POST', body: { name: 'notes', on: false } })).status).toBe(403);
  expect((await request(server, '/api/setup/skill', { method: 'POST', headers: MUTATION, body: { name: 'a b', on: false } })).status).toBe(400);
  expect((await request(server, '/api/setup/plugin', { method: 'POST', headers: MUTATION, body: { id: 'no-marketplace', on: false } })).status).toBe(400);
  expect(setSkill).not.toHaveBeenCalled();
  expect(await request(server, '/api/setup/skill', { method: 'POST', headers: MUTATION, body: { name: 'p-kit:review', on: false } })).toEqual({ status: 200, json: { snapshot: SNAPSHOT } });
  expect(setSkill).toHaveBeenCalledWith('p-kit:review', false);
  expect(await request(server, '/api/setup/plugin', { method: 'POST', headers: MUTATION, body: { id: 'p-kit@market', on: true } })).toEqual({ status: 200, json: { snapshot: SNAPSHOT } });
  expect(setPlugin).toHaveBeenCalledWith('p-kit@market', true);
});

it('SETUP-4.2: a switch that fails answers its status and why', async () => {
  const setPlugin = vi.fn(async () => Promise.reject(new SetupFailure('claude plugin disable p-kit@market failed: Plugin not found', 502)));
  const res = await request(app({ read: vi.fn(), setSkill: vi.fn(), setPlugin, readSession: vi.fn() }), '/api/setup/plugin', { method: 'POST', headers: MUTATION, body: { id: 'p-kit@market', on: false } });
  expect(res).toEqual({ status: 502, json: { error: 'claude plugin disable p-kit@market failed: Plugin not found' } });
});

it('SETUP-6.5: GET /api/setup/session/<id> reads that Session; an id that isn’t a Claude Code session id is refused', async () => {
  const session = { sessionId: '0b7c1a2e-4d5f-4a6b-8c9d-0e1f2a3b4c5d', errors: [] };
  const readSession = vi.fn(async () => session as never);
  const server = app({ read: vi.fn(), setSkill: vi.fn(), setPlugin: vi.fn(), readSession });
  expect(await request(server, '/api/setup/session/0b7c1a2e-4d5f-4a6b-8c9d-0e1f2a3b4c5d')).toEqual({ status: 200, json: session });
  expect(readSession).toHaveBeenCalledWith('0b7c1a2e-4d5f-4a6b-8c9d-0e1f2a3b4c5d');
  expect((await request(server, '/api/setup/session/..%2F..%2Fetc')).status).toBe(400);
  expect((await request(server, '/api/setup/session/claude:123')).status).toBe(400);
  expect(readSession).toHaveBeenCalledTimes(1);
});
