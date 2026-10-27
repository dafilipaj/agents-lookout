import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { Duplex } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { defaultSettings } from '../shared/settings.ts';
import { createApp, type AppOptions, type LookoutApp } from './app.ts';
import { Launcher } from './launcher.ts';
import { OutputFiles } from './output-files.ts';

/** Real HTTP messages and the app's real request handler, without opening a TCP listener. */
function call(app: LookoutApp, body: string, headers: Record<string, string>, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const req = new IncomingMessage(new Socket());
    req.method = 'POST'; req.url = path; req.headers = { host: '127.0.0.1:12345', ...headers };
    let data = '';
    const socket = new Duplex({ read() {}, write(chunk, _encoding, done) { data += chunk.toString(); done(); } });
    const res = new ServerResponse(req);
    res.assignSocket(socket as Socket);
    res.on('finish', () => {
      // Strip the HTTP framing: every API reply has one JSON body.
      const json = data.slice(data.indexOf('{'), data.lastIndexOf('}') + 1);
      resolve({ status: res.statusCode, body: json });
      socket.destroy(); req.destroy();
    });
    app.server.emit('request', req, res);
    req.push(Buffer.from(body)); req.push(null);
  });
}

it('LAUNCH-6.10: trust route checks Origin/token and body size; fake Fleet receives only a validated click for the current card', async () => {
  const prompt = 't1.9f2c01aa';
  const calls: string[][] = [];
  const settings = defaultSettings();
  const launcher = new Launcher({
    runner: async (_file, args) => {
      calls.push([...args]);
      if (args.includes('harness')) return JSON.stringify([{ id: 'claude', installed: true, models: [{ id: '', label: 'Default' }] }]);
      if (args.includes('spawn')) return JSON.stringify({ ok: true, tmux_session: 'trust-test', handle: '%12' });
      if (args.includes('--list')) return JSON.stringify({ ok: true, prompt: { kind: 'trust', harness: 'claude', id: prompt, lines: ['Folder warning'], untouched: true }, answerable: true, detail: null });
      if (args.includes('--accept')) return JSON.stringify({ ok: true, answered: true, answer: 'accept', id: prompt, closed: null });
      throw new Error('unexpected command');
    }, fleetBin: () => '/fake/fleet', settings: { get: () => settings, update: async () => settings }, onChange: () => {},
  });
  const unused = vi.fn();
  const options: AppOptions = {
    staticDir: null, attachmentsDir: '/unused', guard: { allowedHosts: new Set(['127.0.0.1:12345']), allowedOrigins: new Set(['http://127.0.0.1:12345']), token: 'test-token' },
    launcher, settings: { get: () => settings, update: unused, onChange: unused },
    monitor: { snapshot: unused, watch: unused }, memory: { snapshot: unused, watch: unused, setOpen: unused, drop: unused },
    usage: { snapshot: unused, watch: unused, refresh: unused, refreshJev: unused },
    viewer: { watch: unused, drop: unused, send: unused, earlier: unused },
    sessions: { end: unused, answer: unused, stop: unused, rename: unused, switchModel: unused, switchEffort: unused },
    files: { check: unused }, history: { find: unused, detail: unused, peek: unused, resume: unused },
    library: { find: unused, indexing: false, files: new OutputFiles() },
    work: { snapshot: unused, watch: unused, refresh: unused },
  };
  const app = createApp(options);
  const launch = await launcher.start({ harness: 'claude', directory: '~/Projects/work' });
  const path = `/api/launches/${launch.id}/trust`;
  const body = JSON.stringify({ answer: 'accept', prompt });
  const headers = { 'content-type': 'application/json', origin: 'http://127.0.0.1:12345', 'x-lookout-token': 'test-token' };
  try {
    expect((await call(app, body, { ...headers, origin: 'https://evil.example' }, path)).status).toBe(403);
    expect((await call(app, body, { origin: headers.origin }, path)).status).toBe(403);
    expect((await call(app, JSON.stringify({ answer: 'accept', prompt: 'bad' }), headers, path)).status).toBe(400);
    expect((await call(app, JSON.stringify({ answer: 'accept', prompt: 't1.11111111' }), headers, path)).status).toBe(409);
    expect((await call(app, 'x'.repeat(1025), headers, path)).status).toBe(413);
    expect(calls.some((args) => args.includes('--accept'))).toBe(false);
    const result = await call(app, body, headers, path);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ launch: { state: 'starting', trust: null } });
    expect(calls.filter((args) => args.includes('--accept'))).toHaveLength(1);
    expect((await call(app, body, headers, path)).status).toBe(409);
  } finally { launcher.stop(); app.server.close(); }
});
