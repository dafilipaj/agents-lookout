import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { type IncomingHttpHeaders, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PathAnswer } from '../shared/files.ts';
import { DOCUMENT_UNAVAILABLE } from '../shared/library.ts';
import { defaultSettings } from '../shared/settings.ts';
import { createApp, type AppOptions } from './app.ts';
import { RELIST_EVERY_MS, describeDocument } from './document.ts';
import { checkSessionPaths } from './files.ts';
import { Library } from './library.ts';
import { OutputFiles } from './output-files.ts';

const TOKEN = 'test-token';

type App = ReturnType<typeof createApp>;
const hosts = new Set<string>(), origins = new Set<string>();
const started: App[] = [];
let port = 0;
/** The real handler behind a real listener, as app.test.ts's: a POST's body needs one. */
function request(_app: App, path: string, opts: { headers?: Record<string, string>; method?: string; body?: unknown } = {}) {
  const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: opts.method ?? 'GET', path, headers: { ...(payload ? { 'content-type': 'application/json' } : {}), ...opts.headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}
async function listening(a: App): Promise<App> {
  await new Promise<void>((r) => a.server.listen(0, '127.0.0.1', r));
  port = (a.server.address() as AddressInfo).port;
  hosts.clear(); origins.clear();
  hosts.add(`127.0.0.1:${port}`); origins.add(`http://127.0.0.1:${port}`);
  started.push(a);
  return a;
}
const ours = () => ({ origin: `http://127.0.0.1:${port}` });
function app(library: Library, cwd: string) {
  return createApp({
    attachmentsDir: join(tmpdir(), `lookout-unused-attachments-${randomUUID()}`),
    library, guard: { allowedHosts: hosts, allowedOrigins: origins, token: TOKEN },
    monitor: { snapshot: () => ({ sessions: [], fleet: { state: 'ok' } }), watch: () => () => {} },
    settings: { get: defaultSettings, update: async () => defaultSettings(), onChange: () => () => {} },
    launcher: { list: () => [], recentStarts: () => [], harnesses: async () => [], start: vi.fn(), answerTrust: async () => null, trustDisconnected: () => {}, dismiss: () => false },
    usage: { snapshot: () => null, watch: () => () => {}, refresh: async () => {}, refreshJev: async () => {} },
    memory: { snapshot: () => null, watch: () => () => {}, setOpen: () => {}, drop: () => {} },
    // VIEW-1.18: the real check, for one Session Fleet lists.
    files: { check: (sessionId, body) => checkSessionPaths({ lookup: (id) => (id === 'live' ? { cwd } : null) }, sessionId, body) },
    history: { find: vi.fn(), detail: vi.fn(), peek: vi.fn(), resume: vi.fn() },
    viewer: { watch: () => {}, drop: () => {}, send: vi.fn(), earlier: vi.fn() },
    sessions: { end: vi.fn(), answer: vi.fn(), stop: vi.fn(), rename: vi.fn(), switchModel: vi.fn(), switchEffort: vi.fn() },
    work: { snapshot: vi.fn(), watch: () => () => {}, refresh: vi.fn() }, staticDir: null,
  } satisfies AppOptions);
}
const emptyLibrary = () => new Library({ runner: async () => JSON.stringify({ total_results: 0, results: [] }), bin: () => 'tb-session' });
const doc = (a: App, path: string) => request(a, `/api/doc?${new URLSearchParams({ path })}`);
const text = (a: App, path: string) => request(a, `/api/library/text?${new URLSearchParams({ path })}`);
const check = (a: App, session: string, paths: string[]) => request(a, `/api/sessions/${session}/paths`, { method: 'POST', headers: { ...ours(), 'x-lookout-token': TOKEN }, body: { paths } });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lookout-doc-'));
  await mkdir(join(dir, 'repo/docs'), { recursive: true });
  await writeFile(join(dir, 'repo/docs/notes.md'), '# Tide notes\n\nReady.\n');
  await writeFile(join(dir, 'repo/docs/map.html'), '<!doctype html><title>Map</title>');
  await writeFile(join(dir, 'repo/docs/rates.ts'), 'export const rate = 1;\n');
  await writeFile(join(dir, 'repo/docs/secret.md'), '# Not asked about\n');
});
afterEach(async () => {
  await Promise.all(started.splice(0).map((a) => new Promise((r) => a.server.close(r))));
  await rm(dir, { recursive: true, force: true });
});

it('DOC-3.1: the server answers a file’s Type and whether it exists only for a path it listed: one the path check answered for a Session Fleet lists, when it is a document', async () => {
  const a = await listening(app(emptyLibrary(), join(dir, 'repo')));
  const notes = join(dir, 'repo/docs/notes.md'), map = join(dir, 'repo/docs/map.html'), code = join(dir, 'repo/docs/rates.ts'), secret = join(dir, 'repo/docs/secret.md');
  // Nothing is listed yet: every path is the same 404, an existing one included.
  for (const path of [notes, secret, join(dir, 'repo/docs/none.md'), 'docs/notes.md', '~/notes.md', `${notes}‮`, '']) {
    const res = await doc(a, path);
    expect([res.status, JSON.parse(res.body)], path).toEqual([404, { error: DOCUMENT_UNAVAILABLE }]);
  }
  // The path check, a POST with the token, lists what it answers as a file and is a document.
  const answers = JSON.parse((await check(a, 'live', ['docs/notes.md', map, 'docs/rates.ts', 'docs/none.md'])).body).paths as PathAnswer[];
  expect(answers.map((p) => p.exists)).toEqual([true, true, true, false]);
  expect(JSON.parse((await doc(a, notes)).body)).toEqual({ path: notes, display: notes, type: 'markdown', exists: true });
  expect(JSON.parse((await doc(a, map)).body)).toMatchObject({ path: map, type: 'html', exists: true });
  // Code is not a document, and a file nobody asked about stays closed.
  expect((await doc(a, code)).status).toBe(404);
  expect((await doc(a, secret)).status).toBe(404);
  // A Session Fleet doesn't list gets no answer, so nothing is listed for it.
  expect((await check(a, 'gone', [secret])).status).toBe(404);
  expect((await doc(a, secret)).status).toBe(404);
  // Without the token the check is refused, and lists nothing.
  expect((await request(a, '/api/sessions/live/paths', { method: 'POST', headers: ours(), body: { paths: [secret] } })).status).toBe(403);
  expect((await doc(a, secret)).status).toBe(404);
  // A listed file that is gone since is still answered, as gone.
  await rm(notes);
  expect(JSON.parse((await doc(a, notes)).body)).toMatchObject({ path: notes, exists: false });
});

it('DOC-3.1: the path is shown with the home directory as ~', async () => {
  const files = new OutputFiles();
  const notes = join(dir, 'repo/docs/notes.md');
  files.allow(notes);
  const find = vi.fn();
  expect(await describeDocument({ files, find }, notes, { home: join(dir, 'repo') })).toEqual({ path: notes, display: '~/docs/notes.md', type: 'markdown', exists: true });
  expect(await describeDocument({ files, find }, notes, { home: join(dir, 'rep') })).toMatchObject({ display: notes });
  expect(find).not.toHaveBeenCalled();
});

it('DOC-3.2: the text route reads only a listed Markdown file, at most its first megabyte as whole characters, and never a symlink in its place; a page comes from the file route', async () => {
  const a = await listening(app(emptyLibrary(), join(dir, 'repo')));
  const notes = join(dir, 'repo/docs/notes.md'), map = join(dir, 'repo/docs/map.html'), long = join(dir, 'repo/docs/long.md'), link = join(dir, 'repo/docs/link.md');
  expect((await text(a, notes)).status).toBe(404);
  // "é" is two bytes: a megabyte and one byte of it is cut between the two.
  await writeFile(long, `a${'é'.repeat(524_288)}`);
  await symlink(join(dir, 'repo/docs/secret.md'), link);
  await check(a, 'live', [notes, map, long, link]);
  const got = await text(a, notes);
  expect([got.status, got.headers['content-type'], got.headers['x-lookout-truncated'], got.body]).toEqual([200, 'text/plain; charset=utf-8', undefined, '# Tide notes\n\nReady.\n']);
  expect(got.headers['cache-control']).toBe('no-store');
  const cut = await text(a, long);
  expect([cut.status, cut.headers['x-lookout-truncated']]).toEqual([200, '1']);
  expect(Buffer.byteLength(cut.body)).toBe(1024 * 1024 - 1);
  expect(cut.body.endsWith('é')).toBe(true);
  // Only `.md`, and never through a link put in a listed file's place.
  expect((await text(a, map)).status).toBe(404);
  expect((await text(a, link)).status).toBe(404);
  expect(JSON.parse((await text(a, join(dir, 'repo/docs/secret.md'))).body)).toEqual({ error: DOCUMENT_UNAVAILABLE });
  // The page: the file route, framed for Lookout's own page only.
  const page = await request(a, `/api/library/file?${new URLSearchParams({ path: map, frame: '1' })}`);
  expect([page.status, page.headers['content-type']]).toEqual([200, 'text/html; charset=utf-8']);
  expect(page.headers['content-security-policy']).toBe("sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; frame-ancestors 'self'");
});

it('DOC-3.3: an unlisted path that could be a document has the Library read once, headless Sessions included, before the answer; other paths and a second ask within 30 s read nothing', async () => {
  const files = new OutputFiles();
  const notes = join(dir, 'repo/docs/notes.md'), map = join(dir, 'repo/docs/map.html');
  // A Library read lists what it finds (LIB-3.3).
  const find = vi.fn(async () => { files.allow(notes); return { state: 'ok' } as never; });
  const library = { files, find };
  expect(await describeDocument(library, join(dir, 'repo/docs/rates.ts'), { now: 0 })).toBeNull();
  expect(await describeDocument(library, 'docs/notes.md', { now: 0 })).toBeNull();
  expect(find).not.toHaveBeenCalled();
  expect(await describeDocument(library, notes, { now: 1000 })).toMatchObject({ path: notes, type: 'markdown', exists: true });
  expect(find).toHaveBeenCalledTimes(1);
  expect(find).toHaveBeenCalledWith({ query: '', page: 1, types: ['pages', 'pdf', 'markdown', 'image', 'share'], project: '', headless: true, hideGone: false });
  // Listed now: no read. Another unlisted path within 30 s: no read either, and no answer.
  expect(await describeDocument(library, notes, { now: 2000 })).not.toBeNull();
  expect(await describeDocument(library, map, { now: 1000 + RELIST_EVERY_MS - 1 })).toBeNull();
  expect(find).toHaveBeenCalledTimes(1);
  expect(await describeDocument(library, map, { now: 1000 + RELIST_EVERY_MS })).toBeNull();
  expect(find).toHaveBeenCalledTimes(2);
  // A Library that fails leaves the path unanswered, and the view says it can't show it.
  const failing = { files: new OutputFiles(), find: vi.fn(async () => { throw new Error('tb-session is missing'); }) };
  expect(await describeDocument(failing, notes, { now: 0 })).toBeNull();
});
