import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { BOTS_READ_ONLY, REPORT_TEXT_MAX, type BotRun, type BotView, type ReportDetail } from '../shared/bots.ts';
import type { LibraryPage, OutputItem } from '../shared/library.ts';
import { defaultSettings } from '../shared/settings.ts';
import type { LaunchView, ServerEvent, SessionRow } from '../shared/types.ts';
import { type AppOptions, createApp } from './app.ts';
import { Bots } from './bots.ts';
import { LaunchError } from './launcher.ts';
import { Library } from './library.ts';
import { localAllowLists } from './security.ts';

const SANDBOX = 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox';
const ORIGIN = 'http://127.0.0.1:4747';
const BOT = { name: 'Tide tables', prompt: '/tide-tables for last week, as a page', harness: 'claude', model: '', directory: '~/Projects/reports', schedule: { days: ['mon'], time: '07:30' } };

const dirs: string[] = [];
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const output = (over: Partial<OutputItem>): OutputItem => ({
  kind: 'file', key: over.path ?? 'k', type: 'markdown', title: 'Tide tables, week 47', path: null, url: null, display: '', projectPath: null, repo: null, createdAt: 1, updatedAt: 2,
  events: 1, exists: true, source: null, sourcePath: null, sourceDisplay: null, version: null, sessions: [], ...over,
});
const row = (over: Partial<SessionRow>): SessionRow => ({ id: 'sess-1', pid: 501, harness: 'claude', title: 'Tide tables · Nov 23', status: 'busy', waitingFor: null, subagents: null, backgroundShell: false, procStart: '2026-11-23T06:30:00Z', done: null, viewedAt: null, ...over }) as SessionRow;

/**
 * The real HTTP handlers over in-memory sockets, with the real Bots on a store in a temporary home.
 * The launcher is a fake that starts nothing; Fleet's list, the Library's answer for a run and End
 * Session are fakes too.
 */
function setup(over: { dir?: string; pid?: number } = {}) {
  const dir = over.dir ?? mkdtempSync(join(tmpdir(), 'lookout-bots-app-'));
  if (!over.dir) dirs.push(dir);
  const unused = async (): Promise<never> => {
    throw new Error('unused');
  };
  const late: { app?: ReturnType<typeof createApp> } = {};
  const starts: { input: Record<string, unknown>; opts: unknown }[] = [];
  const t = { dir, starts, outputs: [] as OutputItem[], rows: new Map<string, SessionRow>(), ended: [] as string[] };
  const bots = new Bots({
    path: join(dir, '.lookout', 'bots.json'),
    home: dir,
    launcher: {
      start: async (input, opts) => {
        starts.push({ input: input as Record<string, unknown>, opts });
        return { id: (input as { launchId: string }).launchId, title: 't', harness: 'claude', directory: '~/Projects/reports', startedAt: 0, state: 'starting', trust: null, error: null, terminal: null, prompt: null, resume: false } satisfies LaunchView;
      },
      // The launcher's own refusal, as `Launcher.check` gives it (BOT-2.2).
      check: async (input) => {
        const v = input as Record<string, unknown>;
        if (v.directory !== '~/Projects/reports') throw new LaunchError(400, 'Pick one of the start directories from Settings.', 'directory');
        return { directory: '~/Projects/reports', harness: 'claude', model: '', effort: undefined, skipPermissions: v.skipPermissions === true };
      },
    },
    monitor: { watch: () => () => {}, get: (id) => t.rows.get(id) ?? null },
    library: { find: async (): Promise<LibraryPage> => ({ state: 'ok', items: t.outputs, readId: 'r', total: t.outputs.length, nextPage: 2, hasMore: false, projects: [], hiddenGone: 0, unfilteredEmpty: false }) },
    latest: async () => ({ entries: [{ kind: 'assistant', cursor: 'c1', ts: null, text: 'Week 47 is written.', final: true }], before: null }),
    end: async (id) => (t.ended.push(id), { how: 'exit' }),
    onChange: (b) => late.app?.broadcast({ type: 'bots', bots: b }),
    timer: { set: () => 0, clear: () => {} },
    // BOT-2.6: every server of a test is running; the first on a store is the one that runs its Bots.
    pid: over.pid ?? 5101,
    alive: () => true,
    watchStore: () => () => {},
    log: () => {},
  });
  stops.push(() => bots.stop());
  bots.start();
  const library = new Library({ runner: unused, bin: () => 'tb-session' });
  const app = (late.app = createApp({
    attachmentsDir: join(tmpdir(), `lookout-unused-attachments-${randomUUID()}`),
    guard: { ...localAllowLists(4747), token: 'test-token' },
    monitor: { snapshot: () => ({ sessions: [], fleet: { state: 'ok' } }), watch: () => () => {} },
    settings: { get: defaultSettings, update: unused, onChange: () => () => {} },
    launcher: { list: () => [], recentStarts: () => [], harnesses: unused, start: unused, answerTrust: async () => null, trustDisconnected: () => {}, dismiss: () => false },
    usage: { snapshot: () => null, watch: () => () => {}, refresh: unused, refreshJev: unused },
    memory: { snapshot: () => null, watch: () => () => {}, setOpen: () => {}, drop: () => {} },
    library,
    bots,
    work: { snapshot: vi.fn(), watch: () => () => {}, refresh: unused },
    viewer: { watch: () => {}, drop: () => {}, send: unused, earlier: unused },
    sessions: { end: unused, answer: unused, stop: unused, rename: unused, switchModel: unused, switchEffort: unused },
    files: { check: unused },
    history: { find: unused, detail: unused, peek: unused, resume: unused },
    staticDir: null,
  } satisfies AppOptions));

  /** One request and its whole answer. A change is sent as the page sends one: our Origin and the token. */
  const call = async (method: string, url: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) => {
    const chunks: Buffer[] = [];
    const socket = new Duplex({ read() {}, write(c, _encoding, done) { chunks.push(Buffer.from(c)); done(); } });
    const req = new IncomingMessage(socket as never);
    req.method = method;
    req.url = url;
    req.httpVersion = '1.0';
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 0;
    req.headers = {
      host: '127.0.0.1:4747',
      ...(method === 'GET' ? {} : { origin: ORIGIN, 'x-lookout-token': 'test-token' }),
      ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...opts.headers,
    };
    const res = new ServerResponse(req);
    res.assignSocket(socket as never);
    const finished = new Promise<void>((resolve) => res.on('finish', resolve));
    app.server.emit('request', req, res);
    if (opts.body !== undefined) req.emit('data', Buffer.from(JSON.stringify(opts.body)));
    req.emit('end');
    await finished;
    socket.destroy();
    // The headers as they went out on the wire, whichever way the handler set them.
    const [head = '', ...rest] = Buffer.concat(chunks).toString().split('\r\n\r\n');
    const body = rest.join('\r\n\r\n');
    const headers: Record<string, string | undefined> = Object.fromEntries(head.split('\r\n').slice(1).map((line) => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]));
    return { status: res.statusCode, headers, body, json: <T = Record<string, unknown>>() => JSON.parse(body) as T };
  };
  /** A tab's event stream, and what it has been sent so far. */
  const stream = () => {
    const req = new IncomingMessage(new Socket());
    req.method = 'GET';
    req.url = '/api/events';
    req.headers = { host: '127.0.0.1:4747' };
    const res = new ServerResponse(req);
    let text = '';
    res.write = ((chunk: string) => ((text += chunk), true)) as typeof res.write;
    app.server.emit('request', req, res);
    return { events: () => text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)) as ServerEvent), close: () => void req.emit('close') };
  };
  /** A Bot made through the API, and a run of it Fleet lists as `rows` say, last of all. */
  const bot = async (fields: Record<string, unknown> = {}) => (await call('POST', '/api/bots', { body: { ...BOT, ...fields } })).json<{ bot: BotView }>().bot;
  const run = async (botId: string, ...rows: SessionRow[]) => {
    const started = (await call('POST', `/api/bots/${botId}/run`)).json<{ run: BotRun }>().run;
    bots.launches([], [{ launchId: starts.at(-1)!.input.launchId as string, sessionId: 'sess-1' }]);
    for (const r of rows) {
      t.rows = new Map([[r.id, r]]);
      bots.observe([r]);
    }
    await bots.settled();
    return started;
  };
  return Object.assign(t, { bots, library, call, stream, bot, run });
}

const done = row({ status: 'idle', done: { at: 1, note: null } });

it('BOT-2.3: the snapshot carries the Bots and their runs, and every change reaches every open tab as one `bots` event, without a reload', async () => {
  const t = setup();
  const tabs = [t.stream(), t.stream()];
  expect(tabs[0]!.events()[0]).toMatchObject({ type: 'snapshot', bots: { state: 'ok', path: '~/.lookout/bots.json', error: null, bots: [], runs: [] } });
  const made = await t.bot();
  for (const tab of tabs) {
    expect(tab.events().filter((e) => e.type === 'bots')).toEqual([{ type: 'bots', bots: expect.objectContaining({ state: 'ok', bots: [expect.objectContaining({ id: made.id, name: 'Tide tables', nextAt: expect.any(Number), running: null })], runs: [] }) }]);
  }
  await t.run(made.id, row({}));
  const last = tabs[1]!.events().at(-1);
  expect(last).toMatchObject({ type: 'bots', bots: { bots: [{ id: made.id, running: expect.any(String) }], runs: [{ botId: made.id, state: 'running', sessionId: 'sess-1' }] } });
  // A tab that connects later gets it all in its snapshot.
  const late = t.stream();
  expect(late.events()[0]).toMatchObject({ type: 'snapshot', bots: { bots: [{ id: made.id }], runs: [{ state: 'running' }] } });
  [...tabs, late].forEach((tab) => tab.close());
});

it('BOT-2.6: on a second server on the same store the snapshot says read-only, and every change is answered 409 with its words; reading still works', async () => {
  const owner = setup();
  const bot = await owner.bot();
  owner.outputs = [output({ path: '/Users/me/Projects/reports/tides-47.md' })];
  const run = await owner.run(bot.id, row({}), done);
  const second = setup({ dir: owner.dir, pid: 5202 });
  const tab = second.stream();
  expect(tab.events()[0]).toMatchObject({ type: 'snapshot', bots: { state: 'read-only', bots: [{ id: bot.id, name: 'Tide tables' }], runs: [{ id: run.id, state: 'finished' }] } });
  const refused = { error: "Another Lookout on this Mac runs the Bots. Here they can't be changed." };
  expect(BOTS_READ_ONLY).toBe(refused.error);
  for (const [method, url, body] of [
    ['POST', '/api/bots', BOT],
    ['PUT', `/api/bots/${bot.id}`, { on: false }],
    ['DELETE', `/api/bots/${bot.id}`, undefined],
    ['POST', `/api/bots/${bot.id}/run`, undefined],
    ['PUT', `/api/inbox/${run.id}`, { read: true }],
    ['PUT', `/api/inbox/${run.id}`, { archived: true }],
  ] as const) {
    const answer = await second.call(method, url, { body });
    expect([answer.status, answer.json()], `${method} ${url}`).toEqual([409, refused]);
  }
  // Nothing changed, on either server, and nothing was started.
  expect(second.starts).toEqual([]);
  expect(tab.events().filter((e) => e.type === 'bots')).toEqual([]);
  expect(owner.bots.snapshot()).toMatchObject({ state: 'ok', bots: [{ id: bot.id, on: true }], runs: [{ id: run.id, read: false, archived: false }] });
  // A Report is read there as on the owner.
  second.outputs = owner.outputs;
  const read = await second.call('GET', `/api/inbox/${run.id}`);
  expect([read.status, read.json<ReportDetail>()]).toEqual([200, expect.objectContaining({ reply: 'Week 47 is written.', outputs: [expect.objectContaining({ title: 'Tide tables, week 47' })] })]);
  // The owner's routes are unchanged by the second server.
  expect((await owner.call('PUT', `/api/inbox/${run.id}`, { body: { read: true } })).status).toBe(200);
  tab.close();
});

it('BOT-2.2: POST /api/bots makes a Bot and PUT /api/bots/<id> changes any of its fields; what the server refuses is 400 with its reason and its field', async () => {
  const t = setup();
  const made = await t.call('POST', '/api/bots', { body: BOT });
  expect(made.status).toBe(200);
  const bot = made.json<{ bot: BotView }>().bot;
  expect(bot).toMatchObject({ ...BOT, id: expect.stringMatching(/^[0-9a-f-]{36}$/), effort: null, skipPermissions: false, on: true, skipped: 0, running: null, nextAt: expect.any(Number) });
  for (const [fields, field] of [[{ name: ' ' }, 'name'], [{ prompt: '' }, 'prompt'], [{ schedule: { days: ['mon'], time: '25:00' } }, 'schedule'], [{ directory: '/etc' }, 'directory']] as const) {
    const refused = await t.call('POST', '/api/bots', { body: { ...BOT, ...fields } });
    expect(refused.status, field).toBe(400);
    expect(refused.json(), field).toEqual({ error: expect.any(String), field });
  }
  expect((await t.call('POST', '/api/bots', { body: { ...BOT, directory: '/etc' } })).json()).toEqual({ error: 'Pick one of the start directories from Settings.', field: 'directory' });
  // Any subset of its fields, `on` among them.
  const off = await t.call('PUT', `/api/bots/${bot.id}`, { body: { on: false } });
  expect(off.status).toBe(200);
  expect(off.json<{ bot: BotView }>().bot).toMatchObject({ id: bot.id, name: 'Tide tables', on: false, nextAt: null });
  expect((await t.call('PUT', `/api/bots/${bot.id}`, { body: { name: 'Tides', schedule: null } })).json<{ bot: BotView }>().bot).toMatchObject({ name: 'Tides', schedule: null, on: false, prompt: BOT.prompt });
  const bad = await t.call('PUT', `/api/bots/${bot.id}`, { body: { schedule: { days: [], time: '07:30' } } });
  expect([bad.status, bad.json()]).toEqual([400, { error: 'Pick at least one day.', field: 'schedule' }]);
  for (const id of ['00000000-0000-4000-8000-000000000000', 'not%20an%20id']) {
    const unknown = await t.call('PUT', `/api/bots/${id}`, { body: { on: true } });
    expect([unknown.status, unknown.json()]).toEqual([404, { error: 'This Bot is gone.' }]);
  }
  expect(t.bots.snapshot().bots).toHaveLength(1);
  // Decision 0003: a change needs our Origin and the token; a prompt past the body's limit is a 413 field error.
  expect((await t.call('POST', '/api/bots', { body: BOT, headers: { 'x-lookout-token': 'wrong' } })).status).toBe(403);
  expect((await t.call('PUT', `/api/bots/${bot.id}`, { body: { on: true }, headers: { origin: 'https://evil.example' } })).status).toBe(403);
  const huge = await t.call('POST', '/api/bots', { body: { ...BOT, prompt: 'x'.repeat(300_000) } });
  expect([huge.status, huge.json()]).toEqual([413, { error: 'The prompt is too long.', field: 'prompt' }]);
  expect((await t.call('POST', '/api/bots', { headers: { 'content-type': 'text/plain' } })).status).toBe(415);
  expect((await t.call('GET', '/api/bots')).status).toBe(405);
  expect(t.bots.snapshot().bots).toEqual([expect.objectContaining({ name: 'Tides', on: false })]);
  expect(t.starts).toEqual([]);
});

it("BOT-2.4: DELETE /api/bots/<id> deletes a Bot; while one of its runs is going it's refused with 409, and its Reports stay", async () => {
  const t = setup();
  const bot = await t.bot();
  const run = await t.run(bot.id, row({}));
  const refused = await t.call('DELETE', `/api/bots/${bot.id}`);
  expect([refused.status, refused.json()]).toEqual([409, { error: "It's running. Wait for it, or end its Session." }]);
  expect((await t.call('DELETE', `/api/bots/${bot.id}`, { headers: { 'x-lookout-token': '' } })).status).toBe(403);
  t.bots.observe([done]);
  await t.bots.settled();
  const deleted = await t.call('DELETE', `/api/bots/${bot.id}`);
  expect([deleted.status, deleted.json()]).toEqual([200, { ok: true }]);
  expect(t.bots.snapshot()).toMatchObject({ bots: [], runs: [{ id: run.id, state: 'finished' }] });
  expect((await t.call('DELETE', `/api/bots/${bot.id}`)).status).toBe(404);
});

it('BOT-4.2: POST /api/bots/<id>/run starts a run at once, without a body; while one is going it answers 409 "It\'s running"', async () => {
  const t = setup();
  const bot = await t.bot({ on: false, schedule: null });
  const first = await t.call('POST', `/api/bots/${bot.id}/run`);
  expect(first.status).toBe(200);
  expect(first.json<{ run: BotRun }>().run).toMatchObject({ botId: bot.id, botName: 'Tide tables', state: 'starting', dueAt: null, sessionId: null });
  // BOT-4.3: its start's id, while it has no Session: where a Trust prompt would be answered.
  expect(first.json<{ run: BotRun }>().run.launchId).toEqual(expect.any(String));
  // BOT-4.1: through the launcher, with the Bot's fields, remembering nothing.
  expect(t.starts).toEqual([{ input: expect.objectContaining({ directory: '~/Projects/reports', harness: 'claude', model: '', prompt: BOT.prompt, name: expect.stringContaining('Tide tables · ') }), opts: { remember: false } }]);
  const again = await t.call('POST', `/api/bots/${bot.id}/run`);
  expect([again.status, again.json()]).toEqual([409, { error: "It's running" }]);
  expect(t.starts).toHaveLength(1);
  expect((await t.call('POST', '/api/bots/00000000-0000-4000-8000-000000000000/run')).status).toBe(404);
  expect((await t.call('POST', `/api/bots/${bot.id}/run`, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
  expect((await t.call('GET', `/api/bots/${bot.id}/run`)).status).toBe(405);
});

it('INBOX-2.1: GET /api/inbox/<run id> answers the Report as read now; a run the server doesn\'t have is 404 "This Report is gone"', async () => {
  const t = setup();
  const bot = await t.bot();
  t.outputs = [output({ path: '/Users/me/Projects/reports/tides-47.md' })];
  const run = await t.run(bot.id, row({}), done);
  const read = await t.call('GET', `/api/inbox/${run.id}`);
  expect(read.status).toBe(200);
  const detail = read.json<ReportDetail>();
  expect(detail).toEqual({
    run: expect.objectContaining({ id: run.id, state: 'finished', title: 'Tide tables, week 47', holds: { documents: 1, reply: true, first: { kind: 'file', type: 'markdown' } }, read: false, session: 'ended' }),
    reply: 'Week 47 is written.',
    outputs: [expect.objectContaining({ title: 'Tide tables, week 47', path: '/Users/me/Projects/reports/tides-47.md' })],
    outputsError: null,
    session: null,
  });
  // The reply is the Report's own: the run it's read with carries none.
  expect(detail.run).not.toHaveProperty('reply');
  for (const id of ['00000000-0000-4000-8000-000000000000', 'no%2Fsuch']) {
    const gone = await t.call('GET', `/api/inbox/${id}`);
    expect([gone.status, gone.json()]).toEqual([404, { error: 'This Report is gone.' }]);
  }
  // A read: the guard still checks who asks.
  expect((await t.call('GET', `/api/inbox/${run.id}`, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
  expect((await t.call('GET', `/api/inbox/${run.id}`, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
});

it('INBOX-3.1: PUT /api/inbox/<run id> marks a Report read or unread and archived or not, for every tab; it needs our Origin and the token', async () => {
  const t = setup();
  const bot = await t.bot();
  const run = await t.run(bot.id, row({}), done);
  const tab = t.stream();
  const read = await t.call('PUT', `/api/inbox/${run.id}`, { body: { read: true } });
  expect([read.status, read.json<{ run: BotRun }>().run]).toEqual([200, expect.objectContaining({ id: run.id, read: true, archived: false })]);
  expect(tab.events().at(-1)).toMatchObject({ type: 'bots', bots: { runs: [{ id: run.id, read: true }] } });
  expect((await t.call('PUT', `/api/inbox/${run.id}`, { body: { read: false } })).json<{ run: BotRun }>().run).toMatchObject({ read: false });
  // INBOX-4.1: archiving marks it read; Move to Inbox brings it back.
  expect((await t.call('PUT', `/api/inbox/${run.id}`, { body: { archived: true } })).json<{ run: BotRun }>().run).toMatchObject({ archived: true, read: true });
  expect((await t.call('PUT', `/api/inbox/${run.id}`, { body: { archived: false } })).json<{ run: BotRun }>().run).toMatchObject({ archived: false, read: true });
  const bad = await t.call('PUT', `/api/inbox/${run.id}`, { body: { read: 'yes' } });
  expect([bad.status, bad.json()]).toEqual([400, { error: 'Read is true or false.', field: 'read' }]);
  expect((await t.call('PUT', `/api/inbox/${run.id}`, { body: {} })).status).toBe(400);
  expect((await t.call('PUT', '/api/inbox/00000000-0000-4000-8000-000000000000', { body: { read: true } })).status).toBe(404);
  expect((await t.call('PUT', `/api/inbox/${run.id}`, { body: { read: true }, headers: { 'x-lookout-token': 'wrong' } })).status).toBe(403);
  expect((await t.call('DELETE', `/api/inbox/${run.id}`)).status).toBe(405);
  expect(t.bots.snapshot().runs[0]).toMatchObject({ read: true, archived: false });
  tab.close();
});

it("INBOX-2.4: GET /api/inbox/text serves a Markdown Report's text as plain text, at most its first megabyte and saying when it was cut; nothing a Report's read didn't list, and never another extension", async () => {
  const t = setup();
  const folder = join(t.dir, 'reports');
  mkdirSync(folder);
  const notes = join(folder, 'tides-47.md');
  const big = join(folder, 'tides-all.md');
  const page = join(folder, 'tides-47.html');
  const unlisted = join(folder, 'private.md');
  writeFileSync(notes, '# Tide tables, week 47\n\n<script>alert(1)</script> High water at 06:12.\n');
  writeFileSync(big, 'b'.repeat(REPORT_TEXT_MAX + 10));
  writeFileSync(page, '<!doctype html><title>Tide tables</title>');
  writeFileSync(unlisted, '# Not a Report\n');
  const bot = await t.bot();
  t.outputs = [output({ path: notes }), output({ path: big }), output({ path: page, type: 'html' })];
  const run = await t.run(bot.id, row({}), done);
  const text = (path: string, headers?: Record<string, string>) => t.call('GET', `/api/inbox/text?${new URLSearchParams({ path })}`, { headers });
  const read = await text(notes);
  expect(read.status).toBe(200);
  expect(read.body).toBe('# Tide tables, week 47\n\n<script>alert(1)</script> High water at 06:12.\n');
  // Text, never a page: its type is fixed and can't be sniffed into another.
  expect(read.headers).toMatchObject({ 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
  expect(read.headers['x-lookout-truncated']).toBeUndefined();
  const cut = await text(big);
  expect(cut.status).toBe(200);
  expect(cut.headers['x-lookout-truncated']).toBe('1');
  expect(cut.body).toBe('b'.repeat(REPORT_TEXT_MAX));
  // The Library's file route would serve the page; this one never serves another extension, or a file no Report listed.
  t.library.files.allow(page);
  t.library.files.allow(unlisted);
  for (const path of [page, unlisted, join(folder, 'gone.md'), '/etc/passwd', '', 'tides-47.md']) {
    const refused = await text(path);
    expect([refused.status, refused.json()], path).toEqual([404, { error: 'This file is not available.' }]);
    expect(refused.body).not.toContain('Not a Report');
  }
  expect((await t.call('GET', '/api/inbox/text')).status).toBe(404);
  expect((await text(notes, { origin: 'https://evil.example' })).status).toBe(403);
  expect((await text(notes, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  expect((await t.call('POST', `/api/inbox/text?${new URLSearchParams({ path: notes })}`)).status).toBe(405);
  // The Report itself is unchanged by any of it.
  expect(t.bots.snapshot().runs[0]).toMatchObject({ id: run.id, read: false });
});

it("INBOX-2.9: the file route with `frame=1` sends the same sandbox on every answer and lets only Lookout's own page frame it; without it nothing changes, and Lookout's page may frame only itself", async () => {
  const t = setup();
  const folder = join(t.dir, 'reports');
  mkdirSync(folder);
  const page = join(folder, 'tides-47.html');
  const html = '<!doctype html><title>Tide tables</title><script>document.title = "ran"</script>';
  writeFileSync(page, html);
  t.library.files.allow(page);
  t.library.files.allow(join(folder, 'gone.html'));
  const file = (path: string, frame: string | null, opts: { method?: string; headers?: Record<string, string> } = {}) =>
    t.call(opts.method ?? 'GET', `/api/library/file?${new URLSearchParams({ path, ...(frame === null ? {} : { frame }) })}`, { headers: opts.headers });
  const FRAMED = `${SANDBOX}; frame-ancestors 'self'`;

  // In a Report's frame: the tab's sandbox (an opaque origin: scripts run, no storage, no same-origin requests), and only Lookout's page around it.
  const framed = await file(page, '1');
  expect(framed.status).toBe(200);
  // Its links and forms open as ordinary tabs, never in the frame: a `base` with that target follows the page's own bytes, counted in its length.
  expect(framed.body).toBe(`${html}\n<base target="_blank">\n`);
  expect(Number(framed.headers['content-length'])).toBe(Buffer.byteLength(framed.body));
  // Only a page gets it: an image shown in a frame is its own bytes.
  const chart = join(folder, 'tides.svg');
  writeFileSync(chart, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  t.library.files.allow(chart);
  expect((await file(chart, '1')).body).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
  expect(framed.headers).toMatchObject({ 'content-security-policy': FRAMED, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' });
  expect(framed.headers['content-security-policy']).not.toMatch(/allow-same-origin|allow-top-navigation/);
  expect(framed.headers['x-frame-options']).toBeUndefined();
  // Every other answer of a framed request carries the same: a missing file, an unlisted one, a wrong method, a refused request.
  for (const [answer, status] of [
    [await file(join(folder, 'gone.html'), '1'), 404],
    [await file('/etc/passwd', '1'), 404],
    [await file(page, '1', { method: 'HEAD' }), 405],
    [await file(page, '1', { headers: { origin: 'null' } }), 403],
    [await file(page, '1', { headers: { 'sec-fetch-site': 'cross-site' } }), 403],
  ] as const) {
    expect(answer.status).toBe(status);
    expect(answer.headers['content-security-policy']).toBe(FRAMED);
    expect(answer.headers['x-content-type-options']).toBe('nosniff');
    expect(answer.headers['x-frame-options']).toBeUndefined();
  }

  // Without `frame=1` (or with anything else for it) the route answers as it did (LIB-3.3).
  for (const frame of [null, '0', 'true', '']) {
    const tab = await file(page, frame);
    expect(tab.status).toBe(200);
    expect(tab.body).toBe(html);
    expect(tab.headers['content-security-policy']).toBe(SANDBOX);
    expect(tab.headers['x-frame-options']).toBeUndefined();
  }
  const refused = await file(page, null, { headers: { origin: 'null' } });
  expect([refused.status, refused.headers['content-security-policy'], refused.headers['x-frame-options']]).toEqual([403, SANDBOX, 'DENY']);
  expect((await file(join(folder, 'gone.html'), null)).headers['content-security-policy']).toBe(SANDBOX);

  // Lookout's own page: frames from itself only, and nothing frames it.
  const own = await t.call('GET', '/api/settings');
  expect(own.headers['content-security-policy']).toBe("default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-src 'self'; frame-ancestors 'none'");
  expect(own.headers['x-frame-options']).toBe('DENY');
});
