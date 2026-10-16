import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerEvent } from '../shared/types.ts';
import { type LookoutApp, createApp } from './app.ts';
import { SettingsStore } from './settings.ts';

let dir: string;
let app: LookoutApp;
let port: number;
let origin: string;
const hosts = new Set<string>();
const origins = new Set<string>();
const TOKEN = 'test-token';
let launched: unknown[] = [];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lookout-app-'));
  launched = [];
  const settings = new SettingsStore(join(dir, 'settings.json'));
  await settings.load();
  app = createApp({
    guard: { allowedHosts: hosts, allowedOrigins: origins, token: TOKEN },
    monitor: { snapshot: () => ({ sessions: [], fleet: { state: 'ok' } }), watch: () => () => {} },
    settings,
    launcher: {
      list: () => [],
      recentStarts: () => [{ launchId: 'launch-1', sessionId: 'session-1' }],
      harnesses: async () => [],
      start: async (input: unknown) => {
        launched.push(input);
        return { id: 'l', title: 't', harness: 'claude', directory: '~', startedAt: 0, state: 'starting', error: null, terminal: null };
      },
      dismiss: () => false,
    },
    staticDir: null,
  });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  port = (app.server.address() as AddressInfo).port;
  hosts.clear();
  origins.clear();
  hosts.add(`127.0.0.1:${port}`);
  origin = `http://127.0.0.1:${port}`;
  origins.add(origin);
});
afterEach(async () => {
  app.server.closeAllConnections();
  await new Promise((r) => app.server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

function call(method: string, path: string, headers: Record<string, string> = {}, body?: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const putSettings = (headers: Record<string, string>, body = '{"idleThresholdHours":2}') =>
  call('PUT', '/api/settings', { 'content-type': 'application/json', ...headers }, body);

describe('local server security (decision 0003)', () => {
  it('answers same-origin requests', async () => {
    expect((await call('GET', '/api/settings')).status).toBe(200);
    expect((await call('GET', '/api/settings', { origin })).status).toBe(200);
  });

  it('rejects another site’s Origin', async () => {
    const res = await call('GET', '/api/bootstrap', { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(res.body).not.toContain(TOKEN);
  });

  it('rejects an unknown Host (DNS rebinding)', async () => {
    expect((await call('GET', '/api/bootstrap', { host: `evil.example:${port}` })).status).toBe(403);
  });

  it('rejects requests the browser marks as cross-site', async () => {
    expect((await call('GET', '/api/events', { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });

  it('requires our Origin and the token to change anything', async () => {
    expect((await putSettings({ 'x-lookout-token': TOKEN })).status).toBe(403); // no Origin
    expect((await putSettings({ origin })).status).toBe(403); // no token
    expect((await putSettings({ origin, 'x-lookout-token': 'wrong' })).status).toBe(403);
    expect((await putSettings({ origin: 'https://evil.example', 'x-lookout-token': TOKEN })).status).toBe(403);
    const ok = await putSettings({ origin, 'x-lookout-token': TOKEN });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toMatchObject({ idleThresholdHours: 2 });
  });

  it('starting a Session needs our Origin and the token too', async () => {
    const body = JSON.stringify({ directory: '~/Projects/work', harness: 'claude', model: '', name: '', prompt: '' });
    const post = (headers: Record<string, string>) => call('POST', '/api/launch', { 'content-type': 'application/json', ...headers }, body);
    expect((await post({ origin: 'https://evil.example', 'x-lookout-token': TOKEN })).status).toBe(403);
    expect((await post({ origin })).status).toBe(403);
    expect((await post({ 'sec-fetch-site': 'cross-site', origin, 'x-lookout-token': TOKEN })).status).toBe(403);
    expect(launched).toEqual([]);
    expect((await post({ origin, 'x-lookout-token': TOKEN })).status).toBe(200);
    expect(launched).toHaveLength(1);
    expect((await call('DELETE', '/api/launch/00000000-0000-4000-8000-000000000000', { origin })).status).toBe(403);
  });

  it('LAUNCH-3.3: a long prompt fits the request; one over the limit is a 413 field error', async () => {
    const headers = { 'content-type': 'application/json', origin, 'x-lookout-token': TOKEN };
    const body = (prompt: string) => JSON.stringify({ directory: '~/Projects/work', harness: 'claude', model: '', name: '', prompt });
    // 100,000 characters of multi-byte text is ~300 KB of JSON.
    expect((await call('POST', '/api/launch', headers, body('é€'.repeat(50_000)))).status).toBe(200);
    expect(launched).toHaveLength(1);
    const tooBig = await call('POST', '/api/launch', headers, body('x'.repeat(2_000_000)));
    expect(tooBig.status).toBe(413);
    expect(JSON.parse(tooBig.body)).toEqual({ error: 'The prompt is too long.', field: 'prompt' });
    // Settings keep their small limit.
    const settingsTooBig = await putSettings({ origin, 'x-lookout-token': TOKEN }, JSON.stringify({ idleThresholdHours: 1, pad: 'x'.repeat(20_000) }));
    expect(settingsTooBig.status).toBe(413);
  });

  it('cuts off a client that sends far past the limit, and keeps serving', async () => {
    const res = await call('PUT', '/api/settings', { 'content-type': 'application/json', origin, 'x-lookout-token': TOKEN }, 'x'.repeat(16 * 1024 * 8)).catch(
      (err: NodeJS.ErrnoException) => ({ status: 0, body: err.code ?? '' }),
    );
    expect([0, 413]).toContain(res.status); // usually reset mid-upload
    expect((await call('GET', '/api/settings')).status).toBe(200);
  });

  it('rejects invalid settings with a reason', async () => {
    const res = await putSettings({ origin, 'x-lookout-token': TOKEN }, '{"idleThresholdHours":0}');
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).field).toBe('idleThresholdHours');
  });
});

describe('events', () => {
  it('SIDE-7.2: every open tab gets a settings change without reloading', async () => {
    const tabs = [openEvents(), openEvents()];
    const firsts = await Promise.all(tabs.map((t) => t.next()));
    expect(firsts.map((e) => e.type)).toEqual(['snapshot', 'snapshot']);
    // LAUNCH-4.2: a (re)connecting tab learns which starts completed recently.
    expect(firsts.map((e) => e.type === 'snapshot' && e.started)).toEqual([
      [{ launchId: 'launch-1', sessionId: 'session-1' }],
      [{ launchId: 'launch-1', sessionId: 'session-1' }],
    ]);

    await putSettings({ origin, 'x-lookout-token': TOKEN }, '{"idleThresholdHours":1.5}');
    const updates = await Promise.all(tabs.map((t) => t.next()));
    expect(updates).toEqual([
      { type: 'settings', settings: expect.objectContaining({ idleThresholdHours: 1.5 }) },
      { type: 'settings', settings: expect.objectContaining({ idleThresholdHours: 1.5 }) },
    ]);
    tabs.forEach((t) => t.close());
  });
});

/** A minimal SSE reader. */
function openEvents() {
  const queue: ServerEvent[] = [];
  const waiters: ((e: ServerEvent) => void)[] = [];
  let buffer = '';
  const req = request({ host: '127.0.0.1', port, path: '/api/events' }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        const data = block.split('\n').find((l) => l.startsWith('data: '));
        if (!data) continue;
        const event = JSON.parse(data.slice(6)) as ServerEvent;
        const w = waiters.shift();
        if (w) w(event);
        else queue.push(event);
      }
    });
  });
  req.end();
  return {
    next: () => new Promise<ServerEvent>((resolve) => (queue.length ? resolve(queue.shift()!) : waiters.push(resolve))),
    close: () => req.destroy(),
  };
}
