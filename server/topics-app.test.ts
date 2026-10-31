import { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Socket } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { defaultSettings } from '../shared/settings.ts';
import type { ServerEvent } from '../shared/types.ts';
import { createApp } from './app.ts';
import { TopicStore, Topics, TopicsError } from './topics.ts';
import { WorkMonitor } from './work.ts';
import { Library } from './library.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Real HTTP handlers over in-memory sockets, with a real Topics store in a temporary directory. */
function setup() {
  const unused = async (): Promise<never> => {
    throw new Error('unused');
  };
  const dir = mkdtempSync(join(tmpdir(), 'lookout-topics-app-'));
  dirs.push(dir);
  const path = join(dir, 'topics.db');
  const late: { app?: ReturnType<typeof createApp> } = {};
  const topics = new Topics({ path, open: () => new TopicStore(path), onChange: (t) => late.app?.broadcast({ type: 'topics', topics: t }) });
  const app = (late.app = createApp({
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
    topics,
    files: { check: unused },
    history: { find: unused, detail: unused, peek: unused, resume: unused },
    staticDir: null,
  }));
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
  return { topics, exchange };
}

const PR = { kind: 'pr', ref: { url: 'https://github.com/productiveio/fantastic/pull/812' }, snapshot: { repo: 'fantastic', number: 812, title: 'Port the rates table', url: 'https://github.com/productiveio/fantastic/pull/812' } };

it('TOPIC-8.3: the snapshot carries every Topic, and a change made through the API reaches every tab as one topics event', async () => {
  const { exchange } = setup();
  const stream = exchange('GET', '/api/events');
  const snapshot = stream.events()[0];
  expect(snapshot).toMatchObject({ type: 'snapshot', topics: { state: 'ok', topics: [] } });
  const created = exchange('POST', '/api/topics', { title: '  Proposals rates ' });
  await created.done;
  expect(created.res.statusCode).toBe(201);
  const topic = (JSON.parse(created.text()) as { topic: { id: string; title: string } }).topic;
  expect(topic.title).toBe('Proposals rates');
  const added = exchange('POST', `/api/topics/${topic.id}/members`, PR);
  await added.done;
  expect(JSON.parse(added.text())).toEqual({ added: true, title: 'Proposals rates' });
  const again = exchange('POST', `/api/topics/${topic.id}/members`, PR);
  await again.done;
  expect(JSON.parse(again.text())).toEqual({ added: false, title: 'Proposals rates' });
  const updates = stream.events().filter((e) => e.type === 'topics');
  expect(updates).toHaveLength(2);
  expect(updates[1]).toMatchObject({ topics: { topics: [{ id: topic.id, members: [{ kind: 'pr', snapshot: PR.snapshot }] }] } });
  const read = exchange('GET', '/api/topics');
  await read.done;
  expect(JSON.parse(read.text())).toMatchObject({ state: 'ok', topics: [{ id: topic.id }] });
  stream.req.emit('close');
});

it('TOPIC-11.1, TOPIC-11.6: POST /api/topics/<id>/summary starts a summary (202, or 409 while one runs), DELETE cancels it; both check the token', async () => {
  const { topics, exchange } = setup();
  const started: string[] = [];
  const cancelled: string[] = [];
  topics.summarizer = {
    start: (id) => {
      if (started.includes(id)) throw new TopicsError(409, 'A summary of this Topic is already being written.');
      started.push(id);
    },
    cancel: (id) => cancelled.push(id),
    deleted: () => {},
  };
  const id = topics.create('A').id;
  const call = async (method: string, url: string, headers?: Record<string, string>) => {
    const r = exchange(method, url, undefined, headers);
    await r.done;
    return { status: r.res.statusCode, body: JSON.parse(r.text()) as Record<string, unknown> };
  };
  expect(await call('POST', `/api/topics/${id}/summary`)).toEqual({ status: 202, body: { ok: true } });
  expect(await call('POST', `/api/topics/${id}/summary`)).toEqual({ status: 409, body: { error: 'A summary of this Topic is already being written.' } });
  expect(await call('DELETE', `/api/topics/${id}/summary`)).toEqual({ status: 200, body: { ok: true } });
  expect(await call('POST', `/api/topics/${id}/summary`, { 'x-lookout-token': 'wrong' })).toMatchObject({ status: 403 });
  expect(await call('PUT', `/api/topics/${id}/summary`)).toEqual({ status: 405, body: { error: 'method not allowed' } });
  expect(started).toEqual([id]);
  expect(cancelled).toEqual([id]);
});

it('TOPIC-8.3: mutations under /api/topics check the token and Origin', async () => {
  const { exchange } = setup();
  for (const headers of [{ 'x-lookout-token': 'wrong' }, { origin: 'http://evil.example' }] as Record<string, string>[]) {
    const r = exchange('POST', '/api/topics', { title: 'A' }, headers);
    await r.done;
    expect(r.res.statusCode).toBe(403);
  }
  const list = exchange('GET', '/api/topics');
  await list.done;
  expect(JSON.parse(list.text()).topics).toEqual([]);
});

it('TOPIC-1.2, TOPIC-1.3, TOPIC-1.4, TOPIC-2.4: notes, Archive, Remove and Delete through the API; a refusal says why in plain words', async () => {
  const { exchange } = setup();
  const call = async (method: string, url: string, body?: unknown) => {
    const r = exchange(method, url, body);
    await r.done;
    return { status: r.res.statusCode, body: JSON.parse(r.text()) as Record<string, unknown> };
  };
  const { body } = await call('POST', '/api/topics', { title: 'A' });
  const id = (body.topic as { id: string }).id;
  expect((await call('PUT', `/api/topics/${id}`, { notes: 'Rounding: half up.', state: 'archived' })).body.topic).toMatchObject({ notes: 'Rounding: half up.', state: 'archived' });
  expect(await call('PUT', `/api/topics/${id}`, { title: '  ' })).toEqual({ status: 400, body: { error: 'A Topic needs a title.' } });
  expect(await call('POST', '/api/topics', {})).toEqual({ status: 400, body: { error: 'A Topic needs a title.' } });
  await call('POST', `/api/topics/${id}/members`, PR);
  expect((await call('DELETE', `/api/topics/${id}/members`, { kind: 'pr', ref: PR.ref })).status).toBe(200);
  expect(((await call('GET', '/api/topics')).body.topics as { members: unknown[] }[])[0]!.members).toEqual([]);
  expect((await call('DELETE', `/api/topics/${id}`)).status).toBe(200);
  expect(await call('PUT', `/api/topics/${id}`, { title: 'B' })).toEqual({ status: 404, body: { error: 'That Topic no longer exists.' } });
  expect((await call('GET', '/api/topics/not-an-id')).status).toBe(404);
});

it('TOPIC-8.3: a method /api/topics has no route for is refused', async () => {
  const { exchange } = setup();
  const r = exchange('PATCH', '/api/topics');
  await r.done;
  expect(r.res.statusCode).toBe(405);
});

it('TOPIC-9.4: Accept and Dismiss go through POST /api/topics/recommendations, token and Origin checked; a stale one says why', async () => {
  const { exchange, topics } = setup();
  const call = async (body: unknown, headers: Record<string, string> = {}) => {
    const r = exchange('POST', '/api/topics/recommendations', body, headers);
    await r.done;
    return { status: r.res.statusCode, body: JSON.parse(r.text()) as Record<string, unknown> };
  };
  const t = topics.create('Rates');
  topics.addMember(t.id, PR as never);
  const session = { kind: 'session', ref: { harness: 'claude', sessionId: 'a1b2c3d4-0000-4000-8000-000000000001' }, snapshot: { harness: 'claude', title: 'fix-ci', directory: null } } as const;
  topics.seen([session], 'off');
  topics.linkTies([{ member: session, topicId: t.id, reason: 'started on PR #812' }]);
  const key = topics.view().recommendations[0]!.key;
  expect((await call({ action: 'accept', key, topicId: t.id }, { 'x-lookout-token': 'wrong' })).status).toBe(403);
  expect(await call({ action: 'accept', key, topicId: t.id })).toEqual({ status: 200, body: { topicId: t.id } });
  expect(topics.view().topics[0]!.members.map((m) => m.reason)).toEqual(['added by hand', 'from a Link']);
  expect(await call({ action: 'dismiss', key, topicId: t.id })).toEqual({ status: 404, body: { error: 'That recommendation is no longer pending.' } });
  expect(await call({ action: 'judge-again', member: session })).toEqual({ status: 409, body: { error: "Jev can't be asked here." } });
  expect((await call({ action: 'explode' })).status).toBe(400);
});

it('TOPIC-6.1, TOPIC-6.2, TOPIC-7.2: Edges and positions through the API, token and Origin checked; a refusal says why', async () => {
  const { exchange, topics } = setup();
  const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = exchange(method, url, body, headers);
    await r.done;
    return { status: r.res.statusCode, body: JSON.parse(r.text()) as Record<string, unknown> };
  };
  const a = topics.create('Rates table').id;
  const b = topics.create('Proposals v2').id;
  expect((await call('POST', `/api/topics/${a}/edges`, { to: b, label: 'part of' }, { 'x-lookout-token': 'wrong' })).status).toBe(403);
  expect(await call('POST', `/api/topics/${a}/edges`, { to: b, label: 'part of' })).toEqual({ status: 201, body: { ok: true } });
  expect(await call('POST', `/api/topics/${b}/edges`, { to: a })).toEqual({ status: 409, body: { error: 'Already linked.' } });
  expect(await call('POST', `/api/topics/${a}/edges`, { to: a })).toEqual({ status: 400, body: { error: "A Topic can't be linked to itself." } });
  expect((await call('PUT', `/api/topics/${b}/edges`, { other: a, reverse: true })).status).toBe(200);
  expect(topics.view().edges.map((e) => [e.from, e.to, e.label])).toEqual([[b, a, 'part of']]);
  expect((await call('DELETE', `/api/topics/${a}/edges`, { other: b })).status).toBe(200);
  expect(topics.view().edges).toEqual([]);
  expect(await call('DELETE', `/api/topics/${a}/edges`, { other: b })).toEqual({ status: 404, body: { error: 'Those Topics are no longer linked.' } });
  expect((await call('PUT', '/api/topics/positions', { positions: [{ id: a, x: 10, y: 20 }] }, { origin: 'http://evil.example' })).status).toBe(403);
  expect(await call('PUT', '/api/topics/positions', { positions: [{ id: a, x: 10, y: 20 }, { id: b, x: 200, y: 20 }] })).toEqual({ status: 200, body: { ok: true } });
  expect(Object.fromEntries(topics.view().topics.map((t) => [t.id, t.pos]))).toEqual({ [a]: { x: 10, y: 20 }, [b]: { x: 200, y: 20 } });
  expect((await call('POST', '/api/topics/positions', {})).status).toBe(405);
});
