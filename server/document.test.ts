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
import { People } from './people.ts';
import { PrivateFolders } from './private-folders.ts';

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
function app(library: Library, cwd: string, extra: Partial<AppOptions> = {}) {
  return createApp({
    ...extra,
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
  expect(JSON.parse((await doc(a, notes)).body)).toEqual({ path: notes, display: notes, type: 'markdown', exists: true, vault: false });
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
  expect(await describeDocument({ files, find }, notes, { home: join(dir, 'repo') })).toEqual({ path: notes, display: '~/docs/notes.md', type: 'markdown', exists: true, vault: false });
  expect(await describeDocument({ files, find }, notes, { home: join(dir, 'rep') })).toMatchObject({ display: notes });
  expect(find).not.toHaveBeenCalled();
});

it('PEOPLE-4.4: the Document view’s routes read a note a Person’s page named, in Obsidian’s Vault, and never one in a Private folder or outside the people folder; a restart reads the Person’s folder again', async () => {
  // Invented notes: a 1on1, a review in a Private folder, a 1on1 in a `1on1s` folder that is private, and a note outside the people folder.
  const vault = join(dir, 'vault');
  const talk = join(vault, 'Team/Ines/1on1s/Ines 1on1 2026-11-24.md'), review = join(vault, 'Team/Ines/Reviews/autumn.md'), week = join(vault, 'Reports/week.md');
  const hidden = join(vault, 'Team/Tomo/1on1s/Tomo 1on1 2026-11-18.md');
  for (const [path, body] of [[talk, '# Ines 1on1\n\nOn track.\n'], [review, '# Review\n'], [week, '# Week\n'], [hidden, '# Tomo 1on1\n']] as const) {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, body);
  }
  // A server as `main.ts` puts it together: the People reader lists into the Library's files, which ask the Private folders at every read.
  const serve = async () => {
    const privateFolders = new PrivateFolders({ home: dir });
    await privateFolders.set({ vaultFolder: '~/vault', privateFolders: ['Team/*/Reviews', 'Team/Tomo/1on1s'] });
    const library = new Library({ runner: async () => JSON.stringify({ total_results: 0, results: [] }), bin: () => 'tb-session', isPrivate: (path) => privateFolders.covers(path) });
    const people = new People({ settings: () => ({ vaultFolder: '~/vault', peopleFolder: 'Team' }), home: dir, isPrivateFolder: (path) => privateFolders.coversFolder(path), allow: (path) => library.files.allow(path) });
    return listening(app(library, dir, { people, inVault: (path, whenSlow) => privateFolders.inVault(path, whenSlow) }));
  };
  const a = await serve();
  expect(JSON.parse((await request(a, '/api/people')).body)).toEqual({ state: 'ok', folder: 'Team', people: [{ name: 'Ines', oneOnOnes: 1, last: expect.any(String), next: null }, { name: 'Tomo', oneOnOnes: 0, last: null, next: null }] });
  // A 1on1s folder that is private: its note is one the page would name, and it names none.
  const tomo = (await request(a, '/api/people/Tomo')).body;
  expect(JSON.parse(tomo)).toEqual({ state: 'ok', folder: 'Team', person: { name: 'Tomo', oneOnOnes: [], notes: [] } });
  expect(tomo).not.toContain('2026-11-18');
  const page = JSON.parse((await request(a, '/api/people/Ines')).body);
  expect(page).toMatchObject({ state: 'ok', person: { name: 'Ines', oneOnOnes: [{ path: talk, date: '2026-11-24' }], notes: [] } });
  expect(JSON.parse((await doc(a, talk)).body)).toMatchObject({ path: talk, type: 'markdown', exists: true, vault: true });
  expect((await text(a, talk)).body).toBe('# Ines 1on1\n\nOn track.\n');
  // The page never named these: a note in a Private folder, and one outside the people folder.
  for (const path of [review, week, hidden]) {
    expect((await doc(a, path)).status, path).toBe(404);
    expect((await text(a, path)).status, path).toBe(404);
  }
  expect(JSON.parse((await request(a, '/api/people/Nobody')).body)).toEqual({ state: 'gone', folder: 'Team', name: 'Nobody' });
  expect((await request(a, '/api/people/%E0%A4%A')).status).toBe(400);

  // A restart: nothing is listed, and the note's own path still shows it.
  const b = await serve();
  expect(JSON.parse((await doc(b, talk)).body)).toMatchObject({ path: talk, exists: true, vault: true });
  expect((await text(b, talk)).status).toBe(200);
  expect((await doc(b, review)).status).toBe(404);
  expect((await doc(b, hidden)).status).toBe(404);
  // A server without the People reader has no such route.
  expect((await request(await listening(app(emptyLibrary(), dir)), '/api/people')).status).toBe(404);
});

it('PEOPLE-4.5: a document’s answer says whether the file is under the Vault folder, and a question that fails says it isn’t', async () => {
  const files = new OutputFiles();
  const notes = join(dir, 'repo/docs/notes.md'), map = join(dir, 'repo/docs/map.html');
  files.allow(notes);
  files.allow(map);
  const find = vi.fn(async () => ({ state: 'ok' }) as never);
  const inVault = vi.fn(async (path: string, _whenSlow: boolean) => path.endsWith('.md'));
  expect(await describeDocument({ files, find }, notes, { inVault })).toMatchObject({ path: notes, vault: true });
  expect(await describeDocument({ files, find }, map, { inVault })).toMatchObject({ path: map, vault: false });
  // A disk too slow to say is "no" here: the answer only chooses where Open goes.
  expect(inVault.mock.calls.every(([, whenSlow]) => whenSlow === false)).toBe(true);
  expect(await describeDocument({ files, find }, notes, { inVault: async () => { throw new Error('slow disk'); } })).toMatchObject({ vault: false });
  // A path the server won't read is asked nothing about.
  inVault.mockClear();
  expect(await describeDocument({ files, find }, join(dir, 'repo/docs/secret.md'), { inVault, now: 0 })).toBeNull();
  expect(inVault).not.toHaveBeenCalled();
});

it('PEOPLE-4.4: after a restart, a note inside the people folder is listed by reading its Person’s folder, with no read of the Library', async () => {
  const files = new OutputFiles();
  const notes = join(dir, 'repo/docs/notes.md'), map = join(dir, 'repo/docs/map.html');
  const find = vi.fn(async () => ({ state: 'ok' }) as never);
  // The Person's folder holds the note: reading it lists it.
  const relistPerson = vi.fn(async (path: string) => { if (path !== notes) return false; files.allow(notes); return true; });
  expect(await describeDocument({ files, find }, notes, { relistPerson, now: 0 })).toMatchObject({ path: notes, exists: true });
  expect(relistPerson).toHaveBeenCalledWith(notes);
  expect(find).not.toHaveBeenCalled();
  // A path no Person's folder holds goes on to the Library's read, as before (DOC-3.3).
  expect(await describeDocument({ files, find }, map, { relistPerson, now: 0 })).toBeNull();
  expect(find).toHaveBeenCalledTimes(1);
  // A listed path asks neither, and a path that could never be a document isn't looked for.
  relistPerson.mockClear();
  expect(await describeDocument({ files, find }, notes, { relistPerson, now: 0 })).not.toBeNull();
  expect(await describeDocument({ files, find }, join(dir, 'repo/docs/rates.ts'), { relistPerson, now: 0 })).toBeNull();
  expect(relistPerson).not.toHaveBeenCalled();
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
