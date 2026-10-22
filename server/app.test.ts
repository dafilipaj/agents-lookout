import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnswerRequest, EndTarget, EscStatus, ModelSwitchRequest, ServerEvent } from '../shared/types.ts';
import { AnswerError } from './answerer.ts';
import { type LookoutApp, createApp } from './app.ts';
import { EndError } from './closer.ts';
import type { FleetRow } from './fleet.ts';
import { checkSessionPaths } from './files.ts';
import { HistoryError } from './history.ts';
import { MODEL_UNCERTAIN, ModelSwitchError } from './model-switch.ts';
import { RenameError } from './renamer.ts';
import { SettingsStore } from './settings.ts';
import { chatViewer } from './test/helpers.ts';
import { HELD_MESSAGE, ViewError, type Viewer } from './viewer.ts';
import { WorkMonitor } from './work.ts';

let dir: string;
let app: LookoutApp;
let port: number;
let origin: string;
const hosts = new Set<string>();
const origins = new Set<string>();
const TOKEN = 'test-token';
let launched: unknown[] = [];
const USAGE = {
  providers: [],
  jev: { state: 'unavailable' as const, version: null, keySource: null, baseUrl: null, configPath: null, reason: null },
  checkedAt: 1,
};
let watches: { clientId: string; sessionId: string | null; preview: boolean }[] = [];
let dropped: string[] = [];
let sent: { sessionId: string; input: unknown }[] = [];
let pages: { sessionId: string; cursor: unknown }[] = [];
let finds: unknown[] = [];
let resumes: unknown[] = [];
let ended: { sessionId: string; target: EndTarget }[] = [];
let answers: { sessionId: string; req: AnswerRequest }[] = [];
let stops: string[] = [];
let renamed: { sessionId: string; name: string }[] = [];
let switched: ({ sessionId: string } & ModelSwitchRequest)[] = [];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lookout-app-'));
  launched = [];
  watches = [];
  dropped = [];
  sent = [];
  pages = [];
  finds = [];
  resumes = [];
  ended = [];
  answers = [];
  stops = [];
  renamed = [];
  switched = [];
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
    usage: { snapshot: () => USAGE, watch: () => () => {}, refreshJev: async () => {}, refresh: async () => {} },
    work: new WorkMonitor({ runner: async () => '', tbPrBin: () => '/nonexistent/tb-pr', tbProdBin: () => '/nonexistent/tb-prod', tbSessionBin: () => '/nonexistent/tb-session', onChange: () => {} }),
    viewer: {
      watch: (clientId: string, sessionId: string | null, preview: boolean) => void watches.push({ clientId, sessionId, preview }),
      drop: (clientId: string) => void dropped.push(clientId),
      send: async (sessionId: string, input: unknown) => {
        if (real) return real.viewer.send(sessionId, input);
        if (sessionId === 'gone') throw new ViewError(404, "This Session isn't running.");
        sent.push({ sessionId, input });
      },
      earlier: async (sessionId: string, cursor: unknown) => {
        if (sessionId === 'gone') throw new ViewError(404, "This Session isn't running, so earlier messages can't be loaded.");
        if (typeof cursor !== 'string') throw new ViewError(400, 'Invalid cursor.', 'before');
        pages.push({ sessionId, cursor });
        return { entries: [{ kind: 'user', cursor: 'c1', ts: null, text: 'older', queued: false }], before: null };
      },
    },
    sessions: {
      end: async (sessionId: string, target: EndTarget) => {
        if (sessionId === 'busy') throw new EndError(409, 'Fleet is typing into it; try again.');
        ended.push({ sessionId, target });
        return { how: 'exit' };
      },
      answer: async (sessionId: string, req: AnswerRequest) => {
        if (sessionId === 'moved') throw new AnswerError(409, 'The terminal no longer shows this prompt as it was, so nothing was typed. Answer it in the terminal.');
        if (sessionId === 'stale') throw new AnswerError(409, 'This was already answered from another tab, so nothing was typed.', 'stale');
        answers.push({ sessionId, req });
        return { epoch: 7 };
      },
      stop: async (sessionId: string, status: EscStatus) => {
        if (real) return real.viewer.stopSession(sessionId, status);
        if (sessionId === 'idle') throw new AnswerError(409, 'This Session isn’t working on anything now, so Esc wasn’t pressed.');
        stops.push(status === 'busy' ? sessionId : `${sessionId} (${status})`);
      },
      rename: async (sessionId: string, name: string) => {
        if (sessionId === 'busy') throw new RenameError(409, 'The Session isn’t Idle now, so it wasn’t renamed. Try again once it is.');
        renamed.push({ sessionId, name });
        return { result: 'renamed' as const };
      },
      switchModel: async (sessionId: string, req: ModelSwitchRequest) => {
        if (sessionId === 'busy') throw new ModelSwitchError(409, 'The Session isn’t Idle now, so the model wasn’t switched. Try again once it is.');
        if (sessionId === 'unsure') throw new ModelSwitchError(502, MODEL_UNCERTAIN, true);
        switched.push({ sessionId, ...req });
        return { model: req.model, confirmed: true };
      },
    },
    // VIEW-1.18: the real check, against this test's folder as the Session's cwd.
    files: { check: (sessionId, body) => checkSessionPaths({ lookup: (id) => (id === 'gone' ? null : { cwd: join(dir, 'repo') }) }, sessionId, body) },
    history: {
      find: async (q) => {
        finds.push(q);
        return { state: 'ok', items: [], page: q.page, hasMore: false };
      },
      detail: async (sessionId) => {
        if (sessionId === 'gone') throw new HistoryError(404, 'tb-session has no such Session.');
        return { item: { sessionId } as never, entries: [], source: 'index', preview: 'latest', totalMessages: null };
      },
      resume: async (input) => {
        resumes.push(input);
        return { kind: 'live', sessionId: 'abc' };
      },
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
  real?.viewer.stop();
  real = null;
  app.server.closeAllConnections();
  await new Promise((r) => app.server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

/**
 * VIEW-3.7, VIEW-4.5 end to end: while set, the routes' sends and Stops go to a real Viewer over the
 * fake `fleet` executable (real processes), its fixtures copied into the test's directory.
 */
let real: { viewer: Viewer; fleetDir: string; log: string } | null = null;

const FAKE_FLEET = new URL('./fixtures/fleet/messages/fake-fleet.mjs', import.meta.url).pathname;
const FAKE_FLEET_FIXTURES = new URL('./fixtures/fleet/messages/', import.meta.url).pathname;

/** Points the routes at a real Viewer over the fake `fleet`, its rows changed by `patch` (by session id) first. */
function useFakeFleet(patch: Record<string, Record<string, unknown>> = {}) {
  const fleetDir = join(dir, 'fleet');
  cpSync(FAKE_FLEET_FIXTURES, fleetDir, { recursive: true });
  const listFile = join(fleetDir, 'list.json');
  const rows = (JSON.parse(readFileSync(listFile, 'utf8')) as FleetRow[]).map((r) => ({ ...r, ...(r.session_id ? patch[r.session_id] : undefined) }));
  writeFileSync(listFile, JSON.stringify(rows));
  const log = join(dir, 'fleet.log');
  const env = { PATH: process.env.PATH, FAKE_FLEET_DIR: fleetDir, FAKE_FLEET_LOG: log };
  real = { viewer: chatViewer(FAKE_FLEET, env, rows).viewer, fleetDir, log };
  return real;
}

/** The fake `fleet` calls that would type or press a key. */
const typedByFleet = () =>
  real && existsSync(real.log)
    ? readFileSync(real.log, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as string[])
        .filter((a) => a.includes('send') || a.includes('keys'))
    : [];

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
    // USAGE: a (re)connecting tab gets the latest usage numbers at once.
    expect(firsts.map((e) => e.type === 'snapshot' && e.usage)).toEqual([USAGE, USAGE]);
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

describe('following a Session (VIEW)', () => {
  const json = { 'content-type': 'application/json' };

  it('VIEW-2.1: a tab says what it views; previews go to that tab only; a closed tab is forgotten', async () => {
    const [tab, other] = [openEvents(), openEvents()];
    const [snap, otherSnap] = await Promise.all([tab.next(), other.next()]);
    const clientId = snap.type === 'snapshot' ? snap.clientId : '';
    expect(clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(otherSnap.type === 'snapshot' && otherSnap.clientId).not.toBe(clientId);

    const put = (body: unknown, headers: Record<string, string>) => call('PUT', '/api/watch', { ...json, ...headers }, JSON.stringify(body));
    expect((await put({ clientId, sessionId: 's', preview: true }, { origin })).status).toBe(403); // no token
    expect((await put({ clientId: 'not-a-stream', sessionId: 's', preview: true }, { origin, 'x-lookout-token': TOKEN })).status).toBe(404);
    expect((await put({ clientId, sessionId: 's', preview: true }, { origin, 'x-lookout-token': TOKEN })).status).toBe(200);
    expect(watches).toEqual([{ clientId, sessionId: 's', preview: true }]);

    app.sendTo(clientId, { type: 'preview', sessionId: 's', text: 'hi', error: null });
    expect(await tab.next()).toEqual({ type: 'preview', sessionId: 's', text: 'hi', error: null });

    tab.close();
    await expect.poll(() => dropped).toContain(clientId);
    other.close();
  });

  it('VIEW-3.1: sending needs our Origin and the token, and passes refusals on', async () => {
    const post = (id: string, headers: Record<string, string>, body = '{"text":"Reply with OK"}') =>
      call('POST', `/api/sessions/${encodeURIComponent(id)}/send`, { ...json, ...headers }, body);
    expect((await post('sess-a', { origin })).status).toBe(403);
    expect((await post('sess-a', { origin: 'https://evil.example', 'x-lookout-token': TOKEN })).status).toBe(403);
    expect(sent).toEqual([]);
    expect((await post('sess-a', { origin, 'x-lookout-token': TOKEN })).status).toBe(200);
    expect(sent).toEqual([{ sessionId: 'sess-a', input: { text: 'Reply with OK' } }]);
    const malformed = await call('POST', '/api/sessions/%E0%A4%A/send', { ...json, origin, 'x-lookout-token': TOKEN }, '{"text":"x"}');
    expect(malformed.status).toBe(400);
    expect(JSON.parse(malformed.body)).toEqual({ error: 'invalid session id' });
    const gone = await post('gone', { origin, 'x-lookout-token': TOKEN });
    expect(gone.status).toBe(404);
    const tooBig = await post('sess-a', { origin, 'x-lookout-token': TOKEN }, JSON.stringify({ text: 'x'.repeat(900_001) }));
    expect(tooBig.status).toBe(413);
    expect(JSON.parse(tooBig.body)).toEqual({ error: 'The message is too long.', field: 'text' });
  });

  it.each(['text', 'prompt', 'no_input_box', 'unreadable'] as const)(
    'VIEW-3.7: end to end, a send the fake `fleet` holds for `%s` is a 409 with its reason and plain words, never what the box holds; nothing is typed',
    async (why) => {
      const CODEX = 'bbbbbbbb-0000-4000-8000-000000000102'; // idle, in its own Session host
      const t = useFakeFleet({ [CODEX]: { fake_send: why, fake_input: 'TOKEN=sk-live-0123456789abcdef' } });
      const res = await call('POST', `/api/sessions/${CODEX}/send`, { ...json, origin, 'x-lookout-token': TOKEN }, '{"text":"Reply with OK"}');
      expect(res.status).toBe(409);
      expect(JSON.parse(res.body)).toEqual({ error: HELD_MESSAGE[why], field: null, kind: 'send_held', reason: why });
      expect(res.body).not.toContain('sk-live');
      // Fleet was asked to type only into an empty box, and typed nothing: the Transcript has no new prompt.
      expect(typedByFleet()).toEqual([['--local', 'send', '--json', '--require-empty', '--', CODEX, 'Reply with OK']]);
      expect(readFileSync(join(t.fleetDir, 'sessions', `${CODEX}.json`), 'utf8')).not.toContain('Reply with OK');
    },
  );

  it('VIEW-3.7: end to end, an empty box takes the message: 200, and the fake `fleet` records it', async () => {
    const CODEX = 'bbbbbbbb-0000-4000-8000-000000000102'; // idle, in its own Session host
    const t = useFakeFleet();
    const res = await call('POST', `/api/sessions/${CODEX}/send`, { ...json, origin, 'x-lookout-token': TOKEN }, '{"text":"Reply with OK"}');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(readFileSync(join(t.fleetDir, 'sessions', `${CODEX}.json`), 'utf8')).toContain('Reply with OK');
  });
});

describe('the chat (VIEW-1)', () => {
  it('VIEW-1.6: "Show earlier" is a read: no token, but Host, Origin and Sec-Fetch-Site are checked', async () => {
    const get = (path: string, headers: Record<string, string> = {}) => call('GET', path, headers);
    const ok = await get('/api/sessions/sess-a/messages?before=c1.50', { origin });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ entries: [{ kind: 'user', cursor: 'c1', ts: null, text: 'older', queued: false }], before: null });
    expect(pages).toEqual([{ sessionId: 'sess-a', cursor: 'c1.50' }]);
    expect((await get('/api/sessions/sess-a/messages?before=c1', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await get('/api/sessions/sess-a/messages?before=c1', { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await get('/api/sessions/%E0%A4%A/messages?before=c1')).status).toBe(400);
    expect((await get('/api/sessions/sess-a/messages')).status).toBe(400); // no cursor
    expect((await get('/api/sessions/gone/messages?before=c1')).status).toBe(404);
    expect((await call('POST', '/api/sessions/sess-a/messages?before=c1', { origin, 'x-lookout-token': TOKEN })).status).toBe(404);
    expect(pages).toHaveLength(1);
  });

  it('VIEW-1.4: chat updates reach the tab over its event stream', async () => {
    const tab = openEvents();
    const snap = await tab.next();
    const clientId = snap.type === 'snapshot' ? snap.clientId : '';
    app.sendTo(clientId, { type: 'chat', sessionId: 's', op: 'append', entries: [{ kind: 'assistant', cursor: 'c9', ts: null, text: '**hi**', final: true }], updated: [], queue: [] });
    expect(await tab.next()).toMatchObject({ type: 'chat', op: 'append', sessionId: 's' });
    tab.close();
  });
});

describe('VIEW-1.18 route', () => {
  const json = { 'content-type': 'application/json' };
  const check = (id: string, headers: Record<string, string>, body: unknown) =>
    call('POST', `/api/sessions/${encodeURIComponent(id)}/paths`, { ...json, ...headers }, JSON.stringify(body));

  it('VIEW-1.18: the path check answers, in order, only whether each path is a file and its absolute path; it needs our Origin and the token as every POST', async () => {
    mkdirSync(join(dir, 'repo', 'src'), { recursive: true });
    writeFileSync(join(dir, 'repo', 'src', 'app.ts'), 'secret contents');
    const body = { paths: ['src/app.ts', 'src/missing.ts', 'src', '~/src/app.ts', `${dir}/repo/src/app.ts`] };
    expect((await check('abc', { 'x-lookout-token': TOKEN }, body)).status).toBe(403); // no Origin
    expect((await check('abc', { origin }, body)).status).toBe(403); // no token
    expect((await check('abc', { origin: 'https://evil.example', 'x-lookout-token': TOKEN }, body)).status).toBe(403);
    expect((await call('GET', '/api/sessions/abc/paths', { origin })).status).toBe(404);

    const ok = await check('abc', { origin, 'x-lookout-token': TOKEN }, body);
    expect(ok.status).toBe(200);
    const app = join(dir, 'repo', 'src', 'app.ts');
    expect(JSON.parse(ok.body)).toEqual({
      paths: [
        { path: 'src/app.ts', exists: true, absolute: app },
        { path: 'src/missing.ts', exists: false, absolute: null },
        { path: 'src', exists: false, absolute: null }, // a folder isn't a file
        { path: '~/src/app.ts', exists: false, absolute: null },
        { path: `${dir}/repo/src/app.ts`, exists: true, absolute: app },
      ],
    });
    expect(ok.body).not.toContain('secret contents');
  });

  it('VIEW-1.18: a bad batch is refused whole, an unknown Session is a 404, and the body is bounded', async () => {
    const h = { origin, 'x-lookout-token': TOKEN };
    for (const body of [null, [], { paths: [] }, { paths: 'src/a.ts' }, { paths: [1] }, { paths: Array.from({ length: 101 }, (_, i) => `a${i}.ts`) }]) {
      const res = await check('abc', h, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await check('gone', h, { paths: ['a.ts'] })).status).toBe(404);
    expect((await check('abc', h, { paths: ['x'.repeat(70 * 1024)] })).status).toBe(413);
    expect((await call('POST', '/api/sessions/abc/paths', { ...h, 'content-type': 'text/plain' }, '{}')).status).toBe(415);
    expect((await call('POST', '/api/sessions/%E0%A4%A/paths', { ...json, ...h }, '{"paths":["a.ts"]}')).status).toBe(400);
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

describe('VIEW-5.6 route', () => {
  it('VIEW-5.6: ending a Session is a mutation: it needs our Origin and the token, like LAUNCH’s start and HIST’s resume', async () => {
    const target = JSON.stringify({ pid: 61001, procStart: '2026-10-14T08:12:03Z' });
    const json = { 'content-type': 'application/json' };
    const end = (id: string, headers: Record<string, string>, body = target) =>
      call('POST', `/api/sessions/${encodeURIComponent(id)}/end`, { ...json, ...headers }, body);
    expect((await end('abc', { 'x-lookout-token': TOKEN })).status).toBe(403); // no Origin
    expect((await end('abc', { origin })).status).toBe(403); // no token
    expect((await end('abc', { origin: 'https://evil.example', 'x-lookout-token': TOKEN })).status).toBe(403);
    expect((await end('abc', { origin, 'x-lookout-token': TOKEN, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await call('GET', '/api/sessions/abc/end', { origin })).status).toBe(404);
    expect(ended).toEqual([]);

    const res = await end('abc', { origin, 'x-lookout-token': TOKEN });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ how: 'exit' });
    expect(ended).toEqual([{ sessionId: 'abc', target: { pid: 61001, procStart: '2026-10-14T08:12:03Z' } }]);

    const busy = await end('busy', { origin, 'x-lookout-token': TOKEN });
    expect(busy.status).toBe(409);
    expect(JSON.parse(busy.body)).toEqual({ error: 'Fleet is typing into it; try again.' });
    expect((await call('POST', '/api/sessions/%E0%A4%A/end', { ...json, origin, 'x-lookout-token': TOKEN }, target)).status).toBe(400);
  });

  it('VIEW-5.6: the body names the confirmed process; a missing or malformed one is refused before anything runs', async () => {
    const headers = { 'content-type': 'application/json', origin, 'x-lookout-token': TOKEN };
    const end = (body: string, h: Record<string, string> = headers) => call('POST', '/api/sessions/abc/end', h, body);
    expect((await end('{"pid":61001,"procStart":"2026-10-14T08:12:03Z"}', { origin, 'x-lookout-token': TOKEN })).status).toBe(415);
    expect((await end('not json')).status).toBe(400);
    expect(JSON.parse((await end('{"procStart":"2026-10-14T08:12:03Z"}')).body)).toEqual({ error: 'Invalid process id.' });
    expect(JSON.parse((await end('{"pid":61001,"procStart":"--json"}')).body)).toEqual({ error: 'Invalid process start time.' });
    expect((await end(JSON.stringify({ pid: 1, procStart: 'x'.repeat(2000) }))).status).toBe(413);
    expect(ended).toEqual([]);
  });
});

describe('VIEW-6 route', () => {
  const json = { 'content-type': 'application/json' };
  const body = JSON.stringify({ model: 'claude-sonnet-5-5', pid: 61004, procStart: '2026-10-14T09:30:00Z' });
  const switchModel = (id: string, headers: Record<string, string>, b = body) => call('POST', `/api/sessions/${encodeURIComponent(id)}/model`, { ...json, ...headers }, b);

  it('VIEW-6.5: switching the model types into the Session, so it’s a mutation: our Origin and the token, as renaming; the body names the model and the process', async () => {
    expect((await switchModel('abc', { 'x-lookout-token': TOKEN })).status).toBe(403); // no Origin
    expect((await switchModel('abc', { origin })).status).toBe(403); // no token
    expect((await switchModel('abc', { origin: 'https://evil.example', 'x-lookout-token': TOKEN })).status).toBe(403);
    expect((await call('GET', '/api/sessions/abc/model', { origin })).status).toBe(404);
    expect(switched).toEqual([]);

    const res = await switchModel('abc', { origin, 'x-lookout-token': TOKEN });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ model: 'claude-sonnet-5-5', confirmed: true });
    expect(switched).toEqual([{ sessionId: 'abc', model: 'claude-sonnet-5-5', pid: 61004, procStart: '2026-10-14T09:30:00Z' }]);
  });

  it('VIEW-6.8: a refusal says why in plain words; one Lookout can’t be sure of says so (`kind: uncertain`), so the tab opens the Terminal preview', async () => {
    const headers = { origin, 'x-lookout-token': TOKEN };
    const refused = await switchModel('busy', headers);
    expect(refused.status).toBe(409);
    expect(JSON.parse(refused.body)).toEqual({ error: 'The Session isn’t Idle now, so the model wasn’t switched. Try again once it is.' });
    const unsure = await switchModel('unsure', headers);
    expect(unsure.status).toBe(502);
    expect(JSON.parse(unsure.body)).toEqual({ error: MODEL_UNCERTAIN, kind: 'uncertain' });
  });

  it('VIEW-6.1: the model and the process are checked before anything runs', async () => {
    const headers = { origin, 'x-lookout-token': TOKEN };
    const bad = async (b: unknown) => JSON.parse((await switchModel('abc', headers, JSON.stringify(b))).body) as unknown;
    expect((await switchModel('abc', headers, 'not json')).status).toBe(400);
    expect(await bad({ model: '', pid: 1, procStart: '2026-10-14T09:30:00Z' })).toEqual({ error: 'Invalid model.' });
    expect(await bad({ model: 'claude opus', pid: 1, procStart: '2026-10-14T09:30:00Z' })).toEqual({ error: 'Invalid model.' });
    expect(await bad({ model: 'claude-sonnet-5-5', procStart: '2026-10-14T09:30:00Z' })).toEqual({ error: 'Invalid process id.' });
    expect(await bad({ model: 'claude-sonnet-5-5', pid: 1, procStart: '--json' })).toEqual({ error: 'Invalid process start time.' });
    expect((await switchModel('abc', headers, JSON.stringify({ model: 'x'.repeat(2000), pid: 1, procStart: null }))).status).toBe(413);
    expect(switched).toEqual([]);
  });
});

describe('VIEW-5.12 route', () => {
  const json = { 'content-type': 'application/json' };
  const rename = (id: string, headers: Record<string, string>, body = '{"title":"Invoice rounding"}') =>
    call('POST', `/api/sessions/${encodeURIComponent(id)}/rename`, { ...json, ...headers }, body);

  it('VIEW-5.12: renaming types into the Session, so it’s a mutation: it needs our Origin and the token, as sending does', async () => {
    expect((await rename('abc', { 'x-lookout-token': TOKEN })).status).toBe(403); // no Origin
    expect((await rename('abc', { origin })).status).toBe(403); // no token
    expect((await rename('abc', { origin: 'https://evil.example', 'x-lookout-token': TOKEN })).status).toBe(403);
    expect((await rename('abc', { origin, 'x-lookout-token': TOKEN, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await call('GET', '/api/sessions/abc/rename', { origin })).status).toBe(404);
    expect(renamed).toEqual([]);

    const res = await rename('abc', { origin, 'x-lookout-token': TOKEN });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ result: 'renamed' });
    expect(renamed).toEqual([{ sessionId: 'abc', name: 'Invoice rounding' }]);

    const refused = await rename('busy', { origin, 'x-lookout-token': TOKEN });
    expect(refused.status).toBe(409);
    expect(JSON.parse(refused.body)).toEqual({ error: 'The Session isn’t Idle now, so it wasn’t renamed. Try again once it is.' });
    expect((await call('POST', '/api/sessions/%E0%A4%A/rename', { ...json, origin, 'x-lookout-token': TOKEN }, '{"title":"x"}')).status).toBe(400);
  });

  it('VIEW-5.12: the name is checked before anything runs: trimmed, one line, at most 64 characters', async () => {
    const headers = { origin, 'x-lookout-token': TOKEN };
    expect((await call('POST', '/api/sessions/abc/rename', headers, '{"title":"x"}')).status).toBe(415);
    expect((await rename('abc', headers, 'not json')).status).toBe(400);
    expect(JSON.parse((await rename('abc', headers, '{"title":"   "}')).body)).toEqual({ error: 'Type a name first.', field: 'title' });
    expect(JSON.parse((await rename('abc', headers, JSON.stringify({ title: 'two\nlines' }))).body)).toMatchObject({ field: 'title' });
    expect(JSON.parse((await rename('abc', headers, JSON.stringify({ title: 'x'.repeat(65) }))).body)).toEqual({ error: 'A name is at most 64 characters; this one has 65.', field: 'title' });
    expect((await rename('abc', headers, JSON.stringify({ title: 'x'.repeat(5000) }))).status).toBe(413);
    expect(renamed).toEqual([]);
    expect((await rename('abc', headers, JSON.stringify({ title: '  Invoice rounding \t' }))).status).toBe(200);
    expect(renamed).toEqual([{ sessionId: 'abc', name: 'Invoice rounding' }]);
  });
});

describe('VIEW-4 routes', () => {
  const json = { 'content-type': 'application/json' };
  const permission = JSON.stringify({ kind: 'permission', prompt: 'p2.0badc0de', choice: 2, epoch: 5 });

  it('VIEW-4.3: answering types into a Session: it needs our Origin and the token, and the answer goes to the Session named', async () => {
    const answer = (id: string, headers: Record<string, string>, body = permission) =>
      call('POST', `/api/sessions/${encodeURIComponent(id)}/answer`, { ...json, ...headers }, body);
    expect((await answer('abc', { 'x-lookout-token': TOKEN })).status).toBe(403); // no Origin
    expect((await answer('abc', { origin })).status).toBe(403); // no token
    expect((await answer('abc', { origin: 'https://evil.example', 'x-lookout-token': TOKEN })).status).toBe(403);
    expect((await answer('abc', { origin, 'x-lookout-token': TOKEN, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await call('GET', '/api/sessions/abc/answer', { origin })).status).toBe(404);
    expect(answers).toEqual([]);

    const ok = await answer('abc', { origin, 'x-lookout-token': TOKEN });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ epoch: 7 });
    expect(answers).toEqual([{ sessionId: 'abc', req: { kind: 'permission', prompt: 'p2.0badc0de', choice: 2, epoch: 5 } }]);

    // Fleet's refusal reaches the tab with its status and plain words.
    const moved = await answer('moved', { origin, 'x-lookout-token': TOKEN });
    expect(moved.status).toBe(409);
    expect(JSON.parse(moved.body)).toEqual({ error: 'The terminal no longer shows this prompt as it was, so nothing was typed. Answer it in the terminal.' });
    // Refused because another tab answered first: the tab learns its read was stale.
    const stale = await answer('stale', { origin, 'x-lookout-token': TOKEN });
    expect(stale.status).toBe(409);
    expect(JSON.parse(stale.body)).toEqual({ error: 'This was already answered from another tab, so nothing was typed.', kind: 'stale' });
    expect((await call('POST', '/api/sessions/%E0%A4%A/answer', { ...json, origin, 'x-lookout-token': TOKEN }, permission)).status).toBe(400);
  });

  it('VIEW-4.3: a malformed answer is refused before anything runs', async () => {
    const headers = { ...json, origin, 'x-lookout-token': TOKEN };
    const answer = (body: string, h: Record<string, string> = headers) => call('POST', '/api/sessions/abc/answer', h, body);
    expect((await answer(permission, { origin, 'x-lookout-token': TOKEN })).status).toBe(415);
    expect((await answer('not json')).status).toBe(400);
    expect(JSON.parse((await answer('{"kind":"permission","prompt":"--json","choice":1}')).body)).toEqual({ error: 'Invalid answer.' });
    expect(JSON.parse((await answer('{"kind":"question","question":"toolu_1","answers":[{"options":[],"text":"a\\u001b"}],"epoch":5}')).body)).toEqual({
      error: 'The answer has characters that can’t be typed.',
    });
    expect((await answer(JSON.stringify({ kind: 'question', question: 'toolu_1', answers: [{ options: [], text: 'x'.repeat(200_000) }], epoch: 5 }))).status).toBe(413);
    expect(answers).toEqual([]);
  });

  it('VIEW-4.4: Stop is a mutation too: Origin and token; a refusal comes back with its words', async () => {
    const stop = (id: string, headers: Record<string, string>) => call('POST', `/api/sessions/${encodeURIComponent(id)}/stop`, headers);
    expect((await stop('abc', { 'x-lookout-token': TOKEN })).status).toBe(403);
    expect((await stop('abc', { origin })).status).toBe(403);
    expect((await call('GET', '/api/sessions/abc/stop', { origin })).status).toBe(404);
    expect(stops).toEqual([]);
    const ok = await stop('abc', { origin, 'x-lookout-token': TOKEN });
    expect(ok.status).toBe(200);
    expect(stops).toEqual(['abc']);
    const idle = await stop('idle', { origin, 'x-lookout-token': TOKEN });
    expect(idle.status).toBe(409);
    expect(JSON.parse(idle.body)).toEqual({ error: 'This Session isn’t working on anything now, so Esc wasn’t pressed.' });
  });

  it('VIEW-4.5: the Esc button takes Stop’s route with the Status it was shown in: Origin and token; any other body is refused before anything runs', async () => {
    const esc = (body: string, headers: Record<string, string> = { ...json, origin, 'x-lookout-token': TOKEN }) => call('POST', '/api/sessions/abc/stop', headers, body);
    expect((await esc('{"status":"needs-you"}', { ...json, origin })).status).toBe(403);
    expect((await esc('{"status":"needs-you"}', { ...json, 'x-lookout-token': TOKEN })).status).toBe(403);
    expect(stops).toEqual([]);
    expect((await esc('{"status":"needs-you"}')).status).toBe(200);
    expect((await esc('{"status":"busy"}')).status).toBe(200);
    expect(stops).toEqual(['abc (needs-you)', 'abc']);
    for (const bad of ['{}', '{"status":"idle"}', '"needs-you"', '[]', 'null']) {
      const res = await esc(bad);
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error: 'Invalid request.' });
    }
    expect((await esc('not json')).status).toBe(400);
    expect((await esc(JSON.stringify({ status: 'needs-you', pad: 'x'.repeat(2_000) }))).status).toBe(413);
    expect(stops).toHaveLength(2);
  });

  it('VIEW-4.5: end to end, Esc for a Session that Needs you presses `fleet keys id:<session_id> Escape --json` once; Stop for it, or Esc for one that doesn’t, presses nothing', async () => {
    const WAITING = 'aaaaaaaa-0000-4000-8000-000000000101'; // Needs you
    const IDLE = 'dddddddd-0000-4000-8000-000000000104';
    useFakeFleet();
    const headers = { ...json, origin, 'x-lookout-token': TOKEN };
    const stop = await call('POST', `/api/sessions/${WAITING}/stop`, { origin, 'x-lookout-token': TOKEN });
    expect(stop.status).toBe(409);
    expect(JSON.parse(stop.body)).toEqual({ error: 'This Session isn’t working on anything now, so Esc wasn’t pressed.' });
    const idle = await call('POST', `/api/sessions/${IDLE}/stop`, headers, '{"status":"needs-you"}');
    expect(idle.status).toBe(409);
    expect(JSON.parse(idle.body)).toEqual({ error: 'This Session isn’t waiting on you now, so Esc wasn’t pressed.' });
    expect(typedByFleet()).toEqual([]);
    const ok = await call('POST', `/api/sessions/${WAITING}/stop`, headers, '{"status":"needs-you"}');
    expect(ok.status).toBe(200);
    expect(typedByFleet()).toEqual([['--local', 'keys', `id:${WAITING}`, 'Escape', '--json']]);
    // A second Esc in the same spell, from any tab, within 10 s: refused, nothing pressed.
    const again = await call('POST', `/api/sessions/${WAITING}/stop`, headers, '{"status":"needs-you"}');
    expect(again.status).toBe(409);
    expect(JSON.parse(again.body)).toEqual({ error: 'Esc was just pressed in this Session, so it wasn’t pressed again. Give it a few seconds.' });
    expect(typedByFleet()).toHaveLength(1);
  });
});

describe('HIST routes', () => {
  it('HIST-2.2: GET /api/history passes the query, page and headless toggle, bounded', async () => {
    const res = await call('GET', '/api/history?q=%20rate%20card%0A&page=3&headless=1', { origin });
    expect(res.status).toBe(200);
    expect(finds).toEqual([{ query: 'rate card', page: 3, headless: true, harness: null }]);
    await call('GET', `/api/history?q=${'x'.repeat(2000)}&page=-4`);
    expect(finds[1]).toMatchObject({ page: 1, headless: false });
    expect((finds[1] as { query: string }).query).toHaveLength(500);
  });

  it('HIST-2.8: GET /api/history passes one Harness, or none for both', async () => {
    await call('GET', '/api/history?harness=codex');
    await call('GET', '/api/history?harness=pi');
    expect(finds).toEqual([expect.objectContaining({ harness: 'codex' }), expect.objectContaining({ harness: null })]);
  });

  it('HIST-3.3: GET /api/history/:harness/:id reads one past Session; odd ids never reach tb-session', async () => {
    expect(JSON.parse((await call('GET', '/api/history/codex/abc-1')).body)).toMatchObject({ source: 'index' });
    expect((await call('GET', '/api/history/codex/gone')).status).toBe(404);
    expect((await call('GET', '/api/history/pi/abc')).status).toBe(404);
    expect((await call('GET', '/api/history/claude/a%20b')).status).toBe(404);
  });

  it('HIST-3.1: resuming is a mutation: it needs our Origin and the token, like LAUNCH’s start', async () => {
    const body = JSON.stringify({ sessionId: 'abc', harness: 'claude' });
    const post = (headers: Record<string, string>) => call('POST', '/api/history/resume', { 'content-type': 'application/json', ...headers }, body);
    expect((await post({ 'x-lookout-token': TOKEN })).status).toBe(403);
    expect((await post({ origin })).status).toBe(403);
    expect(resumes).toEqual([]);
    const ok = await post({ origin, 'x-lookout-token': TOKEN });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ kind: 'live', sessionId: 'abc' });
    expect(resumes).toEqual([{ sessionId: 'abc', harness: 'claude' }]);
  });
});
