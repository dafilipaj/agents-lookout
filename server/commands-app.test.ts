import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { expect, it, vi } from 'vitest';
import type { CommandList } from '../shared/commands.ts';
import { defaultSettings } from '../shared/settings.ts';
import type { SessionRow } from '../shared/types.ts';
import { type AppOptions, createApp } from './app.ts';
import { Library } from './library.ts';
import { localAllowLists } from './security.ts';

/** The real HTTP handler over an in-memory socket. */
async function request(app: ReturnType<typeof createApp>, url: string, headers: Record<string, string> = {}) {
  const chunks: Buffer[] = [];
  const socket = new Duplex({ read() {}, write(c, _encoding, done) { chunks.push(Buffer.from(c)); done(); } });
  const req = new IncomingMessage(new Socket());
  req.method = 'GET';
  req.url = url;
  req.headers = { host: '127.0.0.1:4747', ...headers };
  const res = new ServerResponse(req);
  res.assignSocket(socket as never);
  await new Promise<void>((resolve) => {
    res.on('finish', resolve);
    app.server.emit('request', req, res);
    req.push(null);
  });
  socket.destroy();
  req.destroy();
  const text = Buffer.concat(chunks).toString().split('\r\n\r\n').slice(1).join('\r\n\r\n');
  return { status: res.statusCode, json: text ? JSON.parse(text) : null };
}

const LIST: CommandList = { harness: 'claude', items: [], error: null, readAt: 1 };
const row = (over: Partial<SessionRow>) => ({ id: 'sess-1', harness: 'claude', cwd: '/work/ledger', controllable: true, ...over }) as SessionRow;

function app(opts: { commands?: AppOptions['commands']; sessions?: SessionRow[]; startable?: (directory: string, continues: unknown) => Promise<boolean> }) {
  return createApp({
    attachmentsDir: join(tmpdir(), `lookout-unused-attachments-${randomUUID()}`),
    library: new Library({ runner: vi.fn(), bin: () => 'tb-session' }),
    guard: { ...localAllowLists(4747), token: 'test-token' },
    monitor: { snapshot: () => ({ sessions: opts.sessions ?? [], fleet: { state: 'ok' } }), watch: () => () => {} },
    settings: { get: defaultSettings, update: async () => defaultSettings(), onChange: () => () => {} },
    launcher: { list: () => [], recentStarts: () => [], harnesses: async () => [], start: vi.fn(), answerTrust: async () => null, trustDisconnected: () => {}, dismiss: () => false, ...(opts.startable ? { startable: opts.startable } : {}) },
    usage: { snapshot: () => null, watch: () => () => {}, refresh: async () => {}, refreshJev: async () => {} },
    memory: { snapshot: () => null, watch: () => () => {}, setOpen: () => {}, drop: () => {} },
    files: { check: vi.fn() },
    history: { find: vi.fn(), detail: vi.fn(), peek: vi.fn(), resume: vi.fn() },
    viewer: { watch: () => {}, drop: () => {}, send: vi.fn(), earlier: vi.fn() },
    sessions: { end: vi.fn(), answer: vi.fn(), stop: vi.fn(), rename: vi.fn(), switchModel: vi.fn(), switchEffort: vi.fn() },
    work: { snapshot: vi.fn(), watch: () => () => {}, refresh: vi.fn() },
    commands: opts.commands,
    staticDir: null,
  } satisfies AppOptions);
}

it("VIEW-15.12: the composer's list is read for the Harness and directory the server has for the Session, never the tab's", async () => {
  const list = vi.fn(async () => LIST);
  const a = app({ commands: { list }, sessions: [row({ id: 'sess-1', harness: 'codex', cwd: '/work/ledger' }), row({ id: 'claude:812', harness: 'claude', cwd: null })] });
  // What the tab adds to the address changes nothing: the row decides.
  expect(await request(a, '/api/sessions/sess-1/commands?harness=claude&directory=/etc')).toEqual({ status: 200, json: LIST });
  expect(list).toHaveBeenLastCalledWith('codex', '/work/ledger');
  expect((await request(a, `/api/sessions/${encodeURIComponent('claude:812')}/commands`)).status).toBe(200);
  expect(list).toHaveBeenLastCalledWith('claude', null);
});

it("VIEW-15.12: a Session the server doesn't list has no list, and a server without the reader no route", async () => {
  const list = vi.fn(async () => LIST);
  expect(await request(app({ commands: { list }, sessions: [row({})] }), '/api/sessions/gone/commands')).toEqual({ status: 404, json: { error: "This Session isn't running." } });
  expect(list).not.toHaveBeenCalled();
  expect((await request(app({ sessions: [row({})] }), '/api/sessions/sess-1/commands')).status).toBe(404);
});

it('VIEW-15.10: the list is a read: no token is asked, and another site is still refused', async () => {
  const a = app({ commands: { list: async () => LIST }, sessions: [row({})] });
  expect((await request(a, '/api/sessions/sess-1/commands')).status).toBe(200);
  expect((await request(a, '/api/sessions/sess-1/commands', { origin: 'https://evil.example' })).status).toBe(403);
});

it('LAUNCH-8.2: the launcher asks for the Harness and directory chosen, without the commands that open a dialog', async () => {
  const list = vi.fn(async () => LIST);
  const startable = vi.fn(async () => true);
  const a = app({ commands: { list }, startable });
  expect(await request(a, `/api/launch/commands?harness=codex&directory=${encodeURIComponent('~/Projects/ledger')}`)).toEqual({ status: 200, json: LIST });
  expect(startable).toHaveBeenLastCalledWith('~/Projects/ledger', null);
  // The directory as Settings spells it is read where it is.
  expect(list).toHaveBeenLastCalledWith('codex', join(homedir(), 'Projects/ledger'), { dialogs: false });
});

it('LAUNCH-8.4: the list is read only for a directory the launcher can start in, and only for a Harness it knows', async () => {
  const list = vi.fn(async () => LIST);
  const startable = vi.fn(async (directory: string, continues: unknown) => directory === '~/Projects/ledger' || (directory === '/work/old' && (continues as { sessionId?: string } | null)?.sessionId === 'sess-9'));
  const a = app({ commands: { list }, startable });
  const refused = { status: 400, json: { error: 'Pick one of the start directories from Settings.', field: 'directory' } };
  expect(await request(a, '/api/launch/commands?harness=claude&directory=/etc')).toEqual(refused);
  expect(await request(a, '/api/launch/commands?harness=claude')).toEqual(refused);
  // A Handover's start names the Session it continues; its directory counts only with it (HAND-3.4).
  expect(await request(a, '/api/launch/commands?harness=claude&directory=/work/old')).toEqual(refused);
  expect((await request(a, '/api/launch/commands?harness=claude&directory=/work/old&session=sess-9&sessionHarness=codex')).status).toBe(200);
  expect(startable).toHaveBeenLastCalledWith('/work/old', { sessionId: 'sess-9', harness: 'codex' });
  expect(await request(a, '/api/launch/commands?harness=pi&directory=~/Projects/ledger')).toEqual({ status: 400, json: { error: 'Pick Claude Code or Codex.', field: 'harness' } });
  expect(await request(a, '/api/launch/commands?directory=~/Projects/ledger')).toMatchObject({ status: 400 });
  expect(list).toHaveBeenCalledTimes(1);
  // A launcher that can't say where it may start refuses every directory.
  expect((await request(app({ commands: { list } }), '/api/launch/commands?harness=claude&directory=~/Projects/ledger')).status).toBe(400);
});
