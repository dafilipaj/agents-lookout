import { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Socket } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { HANDOFF_RESTATE_LINE as RESTATE_LINE } from '../shared/handoff.ts';
import { defaultSettings } from '../shared/settings.ts';
import type { ChatPage, LaunchView } from '../shared/types.ts';
import { createApp } from './app.ts';
import { HandoffLaunches, Handoffs } from './handoffs.ts';
import { LaunchError } from './launcher.ts';
import { Library } from './library.ts';
import { ViewError } from './viewer.ts';
import { WorkMonitor } from './work.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const OLD = 'a1b2c3d4-0000-4000-8000-000000000001';
const LAUNCH = '00000000-0000-4000-8000-0000000000aa';
const CONTINUES = { sessionId: OLD, harness: 'claude', title: 'Add CSV export to reports' };

/** Real HTTP handlers over in-memory sockets, with real hand-offs in a temporary directory. */
function setup(opts: { start?: (body: unknown) => Promise<LaunchView>; latest?: (id: string) => Promise<ChatPage>; topicLaunches?: NonNullable<Parameters<typeof createApp>[0]['topicLaunches']> } = {}) {
  const unused = async (): Promise<never> => {
    throw new Error('unused');
  };
  const dir = mkdtempSync(join(tmpdir(), 'lookout-handoff-app-'));
  dirs.push(dir);
  const handoffs = new Handoffs({ path: join(dir, 'handoffs.json') });
  const handoffLaunches = new HandoffLaunches(handoffs);
  const expect_ = vi.spyOn(handoffLaunches, 'expect');
  const forget = vi.spyOn(handoffLaunches, 'forget');
  const start = vi.fn(opts.start ?? (async (): Promise<LaunchView> => ({ id: LAUNCH, title: 'x', harness: 'claude', directory: '/x', startedAt: 0, state: 'starting', trust: null, error: null, terminal: null, prompt: null, resume: false })));
  const app = createApp({
    attachmentsDir: join(tmpdir(), `lookout-unused-attachments-${randomUUID()}`),
    guard: { allowedHosts: new Set(['localhost']), allowedOrigins: new Set(['http://localhost']), token: 'test' },
    monitor: { snapshot: () => ({ sessions: [], fleet: { state: 'ok' } }), watch: () => () => {} },
    settings: { get: defaultSettings, update: unused, onChange: () => () => {} },
    launcher: { list: () => [], recentStarts: () => [], harnesses: unused, start, answerTrust: async () => null, trustDisconnected: () => {}, dismiss: () => false },
    usage: { snapshot: () => null, watch: () => () => {}, refresh: unused, refreshJev: unused },
    memory: { snapshot: () => null, watch: () => () => {}, setOpen: () => {}, drop: () => {} },
    library: new Library({ runner: unused, bin: () => 'tb-session' }),
    work: new WorkMonitor({ runner: unused, tbPrBin: () => '/nonexistent/tb-pr', tbProdBin: () => '/nonexistent/tb-prod', tbSessionBin: () => 'tb-session', onChange: () => {} }),
    viewer: { watch: () => {}, drop: () => {}, send: unused, earlier: unused, ...(opts.latest ? { latest: opts.latest } : {}) },
    sessions: { end: unused, answer: unused, stop: unused, rename: unused, switchModel: unused, switchEffort: unused },
    handoffLaunches,
    ...(opts.topicLaunches ? { topicLaunches: opts.topicLaunches } : {}),
    files: { check: unused },
    history: { find: unused, detail: unused, peek: unused, resume: unused },
    staticDir: null,
  });
  const exchange = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const req = new IncomingMessage(new Socket());
    req.method = method;
    req.url = url;
    req.headers = { host: 'localhost', origin: 'http://localhost', 'x-lookout-token': 'test', 'content-type': 'application/json', ...headers };
    const res = new ServerResponse(req);
    let text = '';
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
    await done;
    return { status: res.statusCode, body: JSON.parse(text) as Record<string, unknown> };
  };
  return { exchange, start, expect: expect_, forget };
}

it('HAND-3.3: a start from a Handover is expected under its launch id before the start is sent, and forgotten when the start fails', async () => {
  const ok = setup();
  const started = await ok.exchange('POST', '/api/launch', { directory: '/x', harness: 'claude', model: '', name: '', prompt: 'Handover', launchId: LAUNCH, continues: CONTINUES });
  expect(started.status).toBe(200);
  expect(ok.expect).toHaveBeenCalledWith(LAUNCH, { ...CONTINUES, piece: '' });
  expect(ok.expect.mock.invocationCallOrder[0]).toBeLessThan(ok.start.mock.invocationCallOrder[0]!);
  expect(ok.forget).not.toHaveBeenCalled();

  const failing = setup({ start: async () => { throw new LaunchError(400, 'Pick one of the start directories from Settings.', 'directory'); } });
  const refused = await failing.exchange('POST', '/api/launch', { directory: '/x', harness: 'claude', model: '', name: '', prompt: '', launchId: LAUNCH, continues: CONTINUES });
  expect(refused).toEqual({ status: 400, body: { error: 'Pick one of the start directories from Settings.', field: 'directory' } });
  expect(failing.forget).toHaveBeenCalledWith(LAUNCH);
});

it("HAND-3.3: a start from a Handover without its launch id, or with a Session to continue that isn't one, is refused and nothing starts", async () => {
  const t = setup();
  const noId = await t.exchange('POST', '/api/launch', { directory: '/x', harness: 'claude', model: '', name: '', prompt: '', continues: CONTINUES });
  expect(noId).toEqual({ status: 400, body: { error: 'A start from a Handover needs its launch id.', field: 'continues' } });
  const bad = await t.exchange('POST', '/api/launch', { directory: '/x', harness: 'claude', model: '', name: '', prompt: '', launchId: LAUNCH, continues: { sessionId: '../x', harness: 'claude' } });
  expect(bad).toEqual({ status: 400, body: { error: 'Invalid Session to continue.', field: 'continues' } });
  expect(t.start).not.toHaveBeenCalled();
});

it('HAND-2.3: GET /api/sessions/<id>/latest reads the latest entries of a chat no tab views; its errors keep their status', async () => {
  const entries = [{ kind: 'assistant' as const, cursor: 'g1.2', ts: null, text: '<handover>\nFix it\n</handover>', final: true }];
  const latest = vi.fn(async (id: string): Promise<ChatPage> => {
    if (id === 'gone') throw new ViewError(404, "This Session isn't running, so its chat can't be read.");
    return { entries, before: null };
  });
  const t = setup({ latest });
  expect(await t.exchange('GET', `/api/sessions/${OLD}/latest`)).toEqual({ status: 200, body: { entries, before: null } });
  expect(latest).toHaveBeenCalledWith(OLD);
  expect(await t.exchange('GET', '/api/sessions/gone/latest')).toEqual({ status: 404, body: { error: "This Session isn't running, so its chat can't be read.", field: null } });
  // A read, but the guard still checks where it comes from.
  expect((await t.exchange('GET', `/api/sessions/${OLD}/latest`, undefined, { origin: 'https://evil.example' })).status).toBe(403);
});

it("TOPIC-15.1: a start from a Handover with a Topic picked hands the Topic's start the Handover as it was started, without its own lines, with the old title and the piece", async () => {
  const topicLaunches = { check: vi.fn((t: unknown) => t as { id: string; via: 'topic' }), expect: vi.fn(() => true), forget: vi.fn() };
  const t = setup({ topicLaunches });
  const prompt = `Rounding is settled: half up.\nShip behind the flag.\n\nContinued from: ${OLD} Add CSV export to reports\n${RESTATE_LINE}`;
  const started = await t.exchange('POST', '/api/launch', { directory: '/x', harness: 'claude', model: '', name: '', prompt, launchId: LAUNCH, topic: { id: 'topic-1', via: 'topic' }, continues: { ...CONTINUES, piece: ' the export ' } });
  expect(started.status).toBe(200);
  expect(topicLaunches.expect).toHaveBeenCalledWith(LAUNCH, { id: 'topic-1', via: 'topic' }, { handover: 'Rounding is settled: half up.\nShip behind the flag.', from: 'Add CSV export to reports', piece: 'the export' });
  // A start for a Topic without a Handover keeps nothing.
  await t.exchange('POST', '/api/launch', { directory: '/x', harness: 'claude', model: '', name: '', prompt: 'Go', launchId: '00000000-0000-4000-8000-0000000000bb', topic: { id: 'topic-1', via: 'topic' } });
  expect(topicLaunches.expect).toHaveBeenLastCalledWith('00000000-0000-4000-8000-0000000000bb', { id: 'topic-1', via: 'topic' }, null);
});
