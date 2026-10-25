import { IncomingMessage, ServerResponse } from 'node:http';
import { Duplex } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { defaultSettings } from '../shared/settings.ts';
import { createApp, type AppOptions } from './app.ts';
import { Library } from './library.ts';
import { localAllowLists } from './security.ts';

/** Exercise the real HTTP handler over an in-memory socket: no localhost listener required. */
async function request(app: ReturnType<typeof createApp>, url: string, headers: Record<string, string> = {}, method = 'GET') {
  const chunks: Buffer[] = [];
  const socket = new Duplex({ read() {}, write(c, _encoding, done) { chunks.push(Buffer.from(c)); done(); } });
  const req = new IncomingMessage(socket as never); req.method = method; req.url = url; req.httpVersion = '1.0'; req.httpVersionMajor = 1; req.httpVersionMinor = 0; req.headers = { host: '127.0.0.1:4747', ...headers };
  const res = new ServerResponse(req); res.assignSocket(socket as never);
  await new Promise<void>((resolve) => { res.on('finish', resolve); app.server.emit('request', req, res); });
  socket.destroy();
  return { status: res.statusCode, headers: res.getHeaders(), body: Buffer.concat(chunks).toString().split('\r\n\r\n').slice(1).join('\r\n\r\n') };
}
function app(library: Library) {
  return createApp({
    library, guard: { ...localAllowLists(4747), token: 'test-token' },
    monitor: { snapshot: () => ({ sessions: [], fleet: { state: 'ok' } }), watch: () => () => {} },
    settings: { get: defaultSettings, update: async () => defaultSettings(), onChange: () => () => {} },
    launcher: { list: () => [], recentStarts: () => [], harnesses: async () => [], start: vi.fn(), dismiss: () => false },
    usage: { snapshot: () => null, watch: () => () => {}, refresh: async () => {}, refreshJev: async () => {} },
    files: { check: vi.fn() },
    history: { find: vi.fn(), detail: vi.fn(), peek: vi.fn(), resume: vi.fn() },
    viewer: { watch: () => {}, drop: () => {}, send: vi.fn(), earlier: vi.fn() },
    sessions: { end: vi.fn(), answer: vi.fn(), stop: vi.fn(), rename: vi.fn(), switchModel: vi.fn(), switchEffort: vi.fn() },
    work: { snapshot: vi.fn(), watch: () => () => {}, refresh: vi.fn() }, staticDir: null,
  } satisfies AppOptions);
}
it('LIB-3.3: the real HTTP handler refuses opaque API reads and puts the file sandbox on guard failures, wrong methods and missing files', async () => {
  const lib = new Library({ runner: async () => JSON.stringify({ total_results: 0, results: [] }), bin: () => 'tb-session' });
  const server = app(lib);
  for (const url of ['/api/bootstrap', '/api/library', '/api/events', '/api/library/status']) expect((await request(server, url, { origin: 'null' })).status).toBe(403);
  for (const [method, headers, expected] of [['GET', {}, 404], ['GET', { origin: 'null' }, 403], ['HEAD', {}, 405], ['POST', { origin: 'http://127.0.0.1:4747', 'x-lookout-token': 'test-token' }, 405]] as const) {
    const result = await request(server, '/api/library/file?path=/etc/passwd', headers, method);
    expect(result.status).toBe(expected); expect(result.headers['content-security-policy']).toBe('sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox'); expect(result.headers['x-content-type-options']).toBe('nosniff');
  }
  const response = await request(server, '/api/library'); expect(response.status).toBe(200); expect(JSON.parse(response.body)).toMatchObject({ state: 'ok', items: [], unfilteredEmpty: true });
});
