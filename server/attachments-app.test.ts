import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings } from '../shared/settings.ts';
import { MAX_ATTACHMENT_BYTES } from '../shared/attachments.ts';
import { createApp } from './app.ts';
import { AttachmentError, Attachments, DAY_MS } from './attachments.ts';
import { Library } from './library.ts';
import { localAllowLists } from './security.ts';

let root: string;
let app: ReturnType<typeof createApp>;
const origin = 'http://127.0.0.1:12345';
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lookout-attachment-route-'));
  app = createApp({
    attachmentsDir: join(root, 'attachments'), guard: { ...localAllowLists(12345), token: 'test' },
    monitor: { snapshot: () => ({ sessions: [], fleet: { state: 'ok' } }), watch: () => () => {} },
    settings: { get: defaultSettings, update: vi.fn(), onChange: () => () => {} },
    launcher: { list: () => [], recentStarts: () => [], harnesses: vi.fn(), start: vi.fn(), dismiss: () => false },
    usage: { snapshot: () => null, watch: () => () => {}, refresh: vi.fn(), refreshJev: vi.fn() },
    memory: { snapshot: () => null, watch: () => () => {}, setOpen: () => {}, drop: () => {} },
    files: { check: vi.fn() }, history: { find: vi.fn(), detail: vi.fn(), peek: vi.fn(), resume: vi.fn() },
    viewer: { watch: () => {}, drop: () => {}, send: vi.fn(), earlier: vi.fn() },
    sessions: { end: vi.fn(), answer: vi.fn(), stop: vi.fn(), rename: vi.fn(), switchModel: vi.fn(), switchEffort: vi.fn() },
    library: new Library({ runner: vi.fn(), bin: () => 'unused' }),
    work: { snapshot: vi.fn(), watch: () => () => {}, refresh: vi.fn() }, staticDir: null,
  });
});
afterEach(async () => { app.server.emit('close'); vi.restoreAllMocks(); vi.useRealTimers(); await rm(root, { recursive: true, force: true }); });

/** Real handler and byte stream, without a TCP listener. */
async function upload(name: string | null = 'shot.png', data = Buffer.from([0, 255, 13, 10]), headers: Record<string, string | undefined> = {}, abort = false) {
  const chunks: Buffer[] = [];
  const socket = new Duplex({ read() {}, write(c, _e, done) { chunks.push(Buffer.from(c)); done(); } });
  const req = new IncomingMessage(socket as never);
  req.method = 'POST'; req.url = `/api/attachments${name === null ? '' : `?name=${encodeURIComponent(name)}`}`;
  req.httpVersion = '1.0'; req.httpVersionMajor = 1; req.httpVersionMinor = 0;
  req.headers = { host: '127.0.0.1:12345', origin, 'x-lookout-token': 'test', 'content-type': 'application/octet-stream', 'content-length': String(data.length), ...headers };
  req.complete = !abort;
  // The in-memory response shares this socket; an IncomingMessage normally owns its TCP socket.
  req._destroy = (err, done) => done(err);
  const res = new ServerResponse(req); res.assignSocket(socket as never);
  const finished = new Promise<void>(resolve => res.on('finish', resolve));
  app.server.emit('request', req, res);
  req.push(data);
  if (abort) req.destroy(new Error('cut off'));
  else req.push(null);
  await finished; socket.destroy();
  return { status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString().split('\r\n\r\n').slice(1).join('\r\n\r\n')) as { path?: string; error?: string } };
}

it('VIEW-9.3: the raw upload returns only the saved absolute path and preserves arbitrary bytes', async () => {
  const result = await upload('../../Screenshot 1.png');
  expect(result.status).toBe(201);
  expect(Object.keys(result.body)).toEqual(['path']);
  expect(result.body.path).toMatch(/\/attachments\/\d{4}-\d{2}-\d{2}\/Screenshot-1.png$/);
  expect(result.body.path!.startsWith(root)).toBe(true);
  expect(await readFile(result.body.path!)).toEqual(Buffer.from([0, 255, 13, 10]));
});
it('VIEW-9.15: metadata and the own Origin plus token are checked before any file is saved', async () => {
  for (const headers of [{ origin: undefined }, { origin: 'https://foreign.example' }, { 'x-lookout-token': undefined }]) expect((await upload('a', undefined, headers)).status).toBe(403);
  for (const name of [null, '', 'a'.repeat(1025)]) expect((await upload(name)).status).toBe(400);
  expect((await upload('a', undefined, { 'content-type': 'text/plain' })).status).toBe(415);
  expect((await upload('a', undefined, { 'content-length': undefined })).status).toBe(411);
  expect(await readdir(root)).toEqual([]);
});
it('VIEW-9.13: rejects oversized declared and actual bodies, including a stream without Content-Length', async () => {
  expect((await upload('a', undefined, { 'content-length': String(MAX_ATTACHMENT_BYTES + 1) })).status).toBe(413);
  expect((await upload('a', undefined, { 'transfer-encoding': 'chunked', 'content-length': undefined })).status).toBe(411);
  expect((await upload('a', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1), { 'content-length': String(MAX_ATTACHMENT_BYTES) })).status).toBe(413);
  for (const day of await readdir(join(root, 'attachments'))) expect(await readdir(join(root, 'attachments', day))).toEqual([]);
});
it('VIEW-9.15: a cut-off body leaves no file behind', async () => {
  expect((await upload('cut.png', undefined, { 'content-length': '100' }, true)).status).toBe(500);
  for (const day of await readdir(join(root, 'attachments'))) expect(await readdir(join(root, 'attachments', day))).toEqual([]);
});
it('VIEW-9.14: disk-full and other failures give plain file-specific errors without logging private details', async () => {
  const log = vi.spyOn(console, 'error');
  const save = vi.spyOn(Attachments.prototype, 'save');
  save.mockRejectedValueOnce(new AttachmentError(507, "The disk is full, so shot.png wasn't saved."));
  expect(await upload()).toEqual({ status: 507, body: { error: "The disk is full, so shot.png wasn't saved." } });
  save.mockRejectedValueOnce(new Error('/private/sensitive/path: error details'));
  expect(await upload()).toEqual({ status: 500, body: { error: "Lookout couldn't save shot.png." } });
  expect(log).not.toHaveBeenCalled();
});
it('VIEW-9.17: server startup and each 24-hour interval prune, and shutdown cancels the timer', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const prune = vi.spyOn(Attachments.prototype, 'prune').mockResolvedValue();
  app.server.emit('listening');
  expect(prune).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(DAY_MS - 1);
  expect(prune).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(prune).toHaveBeenCalledTimes(2);
  app.server.emit('close');
  await vi.advanceTimersByTimeAsync(DAY_MS);
  expect(prune).toHaveBeenCalledTimes(2);
});
it('VIEW-9.17: startup removes old copies before any upload', async () => {
  const day = join(root, 'attachments', '2000-01-01');
  await mkdir(day, { recursive: true });
  const path = join(day, 'old'); await writeFile(path, 'old'); await utimes(path, new Date(0), new Date(0));
  const done = vi.spyOn(console, 'info');
  app.server.emit('listening');
  await vi.waitFor(() => expect(done).toHaveBeenCalled());
  expect(await readdir(join(root, 'attachments'))).toEqual([]);
});
