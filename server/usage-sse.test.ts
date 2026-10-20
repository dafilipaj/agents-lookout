import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type LookoutApp, createApp } from './app.ts';
import { SettingsStore } from './settings.ts';
import { UsageMonitor } from './usage.ts';
import { WorkMonitor } from './work.ts';

const SECRETS = ['sk-ant-api03-AbCdEf123456', 'eyJhbGciOiJIUzI1NiJ9.abc', 'hunter2', 'deadbeefdeadbeefdeadbeefdeadbeef'];

const fleetOut = JSON.stringify({
  providers: [
    { id: 'claude', status: 'error', plan: null, limits: [], error: 'HTTP 401 Bearer eyJhbGciOiJIUzI1NiJ9.abc deadbeefdeadbeefdeadbeefdeadbeef', fetched_at: null, observed_at: null, credits: null },
    { id: 'codex', status: 'ok', plan: 'sk-ant-api03-AbCdEf123456', limits: [{ kind: 'session', label: 'https://u:hunter2@x.io', percent: 3, resets_at: null }], error: null, fetched_at: null, observed_at: null, credits: null },
  ],
});
const jevOut = JSON.stringify({
  version: '0.2.0', ready: false, key_present: false, key_source: 'none', base_url: 'https://u:hunter2@api.typesafe.ai/v1',
  base_url_has_path: true, base_url_hidden: 'deadbeefdeadbeefdeadbeefdeadbeef', base_url_source: 'env', config_path: null,
  config_exists: false, config_valid: null, config_used: false, error_reason: 'key sk-ant-api03-AbCdEf123456 rejected',
});

let dir: string;
let port: number;
let app: LookoutApp;
let usage: UsageMonitor;
const hosts = new Set<string>();

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lookout-usage-sse-'));
  const settings = new SettingsStore(join(dir, 'settings.json'));
  await settings.load();
  usage = new UsageMonitor({
    runner: async (file) => {
      if (file === '/bin/fleet') return fleetOut;
      throw Object.assign(new Error('x'), { code: 4, stdout: jevOut, stderr: '' });
    },
    fleetBin: () => '/bin/fleet',
    jevBin: () => '/bin/tb-jev',
    onChange: (u) => app.broadcast({ type: 'usage', usage: u }),
  });
  app = createApp({
    guard: { allowedHosts: hosts, allowedOrigins: new Set(), token: 't' },
    monitor: { snapshot: () => ({ sessions: [], fleet: { state: 'ok' } }), watch: () => () => {} },
    settings,
    launcher: {
      list: () => [],
      recentStarts: () => [],
      harnesses: async () => [],
      start: async () => {
        throw new Error('unused');
      },
      dismiss: () => false,
    },
    sessions: { end: async () => ({ how: 'exit' as const }), answer: async () => ({ epoch: 1 }), stop: async () => {} },
    files: { check: async () => [] },
    history: {
      find: async () => ({ state: 'ok', items: [], page: 1, hasMore: false }),
      detail: async () => {
        throw new Error('unused');
      },
      resume: async () => {
        throw new Error('unused');
      },
    },
    usage,
    work: new WorkMonitor({ runner: async () => '', tbPrBin: () => '/nonexistent/tb-pr', onChange: () => {} }),
    viewer: { watch: () => {}, drop: () => {}, send: async () => {}, earlier: async () => ({ entries: [], before: null }) },
    staticDir: null,
  });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  port = (app.server.address() as AddressInfo).port;
  hosts.add(`127.0.0.1:${port}`);
});
afterAll(async () => {
  await usage.close();
  app.server.closeAllConnections();
  await new Promise((r) => app.server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

describe('usage over the event stream (review #1)', () => {
  it('neither the snapshot nor the usage event carries anything token-like', async () => {
    const received = await new Promise<string>((resolve, reject) => {
      let body = '';
      const req = request({ host: '127.0.0.1', port, path: '/api/events' }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          body += c;
          if (body.includes('"type":"usage"')) {
            req.destroy();
            resolve(body);
          }
        });
      });
      req.on('error', (e) => (body.includes('"type":"usage"') ? resolve(body) : reject(e)));
      req.end();
    });
    expect(received).toContain('"type":"snapshot"');
    expect(received).toContain('"type":"usage"');
    expect(SECRETS.filter((s) => received.includes(s))).toEqual([]);
  });
});
