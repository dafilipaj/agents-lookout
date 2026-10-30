import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { defaultSettings } from '../shared/settings.ts';
import { TOOL_IDS, type ToolsSnapshot } from '../shared/tools.ts';
import { type AppOptions, createApp } from './app.ts';
import { Library } from './library.ts';
import { localAllowLists } from './security.ts';
import { ToolsMonitor } from './tools.ts';

/** The real HTTP handler over an in-memory socket, as library-app.test.ts drives it. */
async function request(app: ReturnType<typeof createApp>, url: string, headers: Record<string, string> = {}, method = 'GET') {
  const chunks: Buffer[] = [];
  const socket = new Duplex({ read() {}, write(c, _encoding, done) { chunks.push(Buffer.from(c)); done(); } });
  const req = new IncomingMessage(socket as never);
  req.method = method;
  req.url = url;
  req.httpVersion = '1.0';
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 0;
  req.headers = { host: '127.0.0.1:4747', ...headers };
  const res = new ServerResponse(req);
  res.assignSocket(socket as never);
  await new Promise<void>((resolve) => {
    res.on('finish', resolve);
    app.server.emit('request', req, res);
  });
  socket.destroy();
  return { status: res.statusCode, body: Buffer.concat(chunks).toString().split('\r\n\r\n').slice(1).join('\r\n\r\n') };
}

function app(tools: AppOptions['tools']) {
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
    tools,
    staticDir: null,
  } satisfies AppOptions);
}

const MUTATION = { origin: 'http://127.0.0.1:4747', 'x-lookout-token': 'test-token' };

it('TOOLS-1.1: GET /api/tools answers one row per Tool, in order, from the server’s monitor', async () => {
  const runner = vi.fn(async () => 'git version 2.54.0\n');
  const tools = new ToolsMonitor({ runner, env: { HOME: '/nonexistent-home', PATH: '/nonexistent-path', CARGO_HOME: '/nonexistent-cargo' }, harnesses: async () => [], jev: vi.fn(), onChange: () => {}, pin: '5e2afd8', tmuxDirs: [] });
  const res = await request(app(tools), '/api/tools');
  expect(res.status).toBe(200);
  const body = JSON.parse(res.body) as ToolsSnapshot;
  expect(body.rows.map((r) => r.id)).toEqual([...TOOL_IDS]);
  expect(body.rows.find((r) => r.id === 'tb-pr')).toMatchObject({ state: 'missing', path: null, version: null });
  // Nothing found, nothing run.
  expect(runner).not.toHaveBeenCalled();
});

it('TOOLS-1.4: the page opening reads through GET /api/tools (at most once a minute: the monitor decides), Refresh through POST /api/tools/refresh, which needs the token', async () => {
  const snapshot: ToolsSnapshot = { rows: [], checkedAt: 1, reading: false };
  const read = vi.fn(async () => snapshot);
  const server = app({ snapshot: () => snapshot, read });
  expect((await request(server, '/api/tools')).status).toBe(200);
  expect(read).toHaveBeenLastCalledWith();
  expect((await request(server, '/api/tools/refresh', {}, 'POST')).status).toBe(403);
  expect(read).toHaveBeenCalledTimes(1);
  const refreshed = await request(server, '/api/tools/refresh', MUTATION, 'POST');
  expect(refreshed.status).toBe(200);
  expect(JSON.parse(refreshed.body)).toEqual(snapshot);
  expect(read).toHaveBeenLastCalledWith({ force: true });
  // Not from another origin, even as a read.
  expect((await request(server, '/api/tools', { origin: 'https://example.com' })).status).toBe(403);
  // Without a monitor (the UI's tests), there's no such route.
  expect((await request(app(undefined), '/api/tools')).status).toBe(404);
});
