import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../shared/settings.ts';
import type { WorkPr, WorkSnapshot } from '../shared/work.ts';
import { createApp } from './app.ts';
import { AVATAR_FAILED_MS, AVATAR_FRESH_MS, Avatars, MAX_AVATAR_BYTES } from './avatars.ts';
import { Library } from './library.ts';
import { localAllowLists } from './security.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

let root: string;
let dir: string;
let clock: number;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lookout-avatars-'));
  dir = join(root, 'avatars');
  clock = Date.parse('2026-10-30T12:00:00Z');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

const answer = (body: Buffer | string = PNG, init: { status?: number; type?: string; length?: string } = {}) =>
  new Response(typeof body === 'string' ? body : new Uint8Array(body), {
    status: init.status ?? 200,
    headers: { 'content-type': init.type ?? 'image/png', ...(init.length ? { 'content-length': init.length } : {}) },
  });

function avatars(fetcher = vi.fn(async (_url: string, _init?: RequestInit) => answer()), allowed = ['Teammate']) {
  return { fetcher, avatars: new Avatars({ directory: dir, allowed: () => allowed, fetch: fetcher as unknown as typeof fetch, now: () => clock }) };
}

describe('WORK-3.9: avatars the server fetches and keeps', () => {
  it('WORK-3.9: fetches github.com/<login>.png once, keeps it private and serves the copy for 24 hours', async () => {
    const { fetcher, avatars: a } = avatars();
    expect(await a.get('teammate')).toEqual({ type: 'image/png', body: PNG });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe('https://github.com/teammate.png?size=64');
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ redirect: 'follow' });
    expect(await readdir(dir)).toEqual(['teammate.png']);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, 'teammate.png'))).mode & 0o777).toBe(0o600);

    clock += AVATAR_FRESH_MS - 1;
    await utimes(join(dir, 'teammate.png'), new Date(clock - AVATAR_FRESH_MS + 2), new Date(clock - AVATAR_FRESH_MS + 2));
    expect(await a.get('TEAMMATE')).toEqual({ type: 'image/png', body: PNG }); // logins are case-insensitive
    expect(fetcher).toHaveBeenCalledTimes(1);

    clock += 10;
    expect(await a.get('teammate')).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2); // a day old: fetched again
  });

  it('WORK-3.9: answers only a Review request author with a GitHub login, without asking GitHub otherwise', async () => {
    const { fetcher, avatars: a } = avatars(undefined, ['teammate', 'dependabot[bot]']);
    for (const login of ['stranger', 'dependabot[bot]', '-dash', 'a--b', '../teammate', 'x'.repeat(40), '']) expect(await a.get(login), login).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('WORK-3.9: refuses what is not an image, too large or not found, then waits an hour before asking again', async () => {
    const big = Buffer.alloc(MAX_AVATAR_BYTES + 1);
    const refusals = [
      answer('<html>', { type: 'text/html' }),
      answer(PNG, { type: 'image/svg+xml' }),
      answer(PNG, { status: 404 }),
      answer(PNG, { length: String(MAX_AVATAR_BYTES + 1) }),
      answer(big), // no Content-Length: refused while reading
    ];
    for (const refusal of refusals) {
      const { fetcher, avatars: a } = avatars(vi.fn(async () => refusal));
      expect(await a.get('teammate')).toBeNull();
      expect(await a.get('teammate')).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(1); // the failure is kept
      expect(await readdir(dir).catch(() => [])).toEqual([]);
    }
    const { fetcher, avatars: a } = avatars(vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(answer()));
    expect(await a.get('teammate')).toBeNull();
    clock += AVATAR_FAILED_MS - 1;
    expect(await a.get('teammate')).toBeNull();
    clock += 2;
    expect(await a.get('teammate')).toEqual({ type: 'image/png', body: PNG });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('WORK-3.9: a failed fetch serves the copy kept, however old; one fetch per login at a time', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'teammate.jpg'), Buffer.from('old'));
    const old = new Date(clock - 3 * AVATAR_FRESH_MS);
    await utimes(join(dir, 'teammate.jpg'), old, old);
    const { avatars: a } = avatars(vi.fn(async () => { throw new Error('offline'); }));
    expect(await a.get('teammate')).toEqual({ type: 'image/jpeg', body: Buffer.from('old') });

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = vi.fn(async () => { await gate; return answer(PNG, { type: 'image/webp' }); });
    const { avatars: b } = avatars(slow);
    const both = Promise.all([b.get('teammate'), b.get('teammate')]);
    release();
    expect((await both).map((x) => x?.type)).toEqual(['image/webp', 'image/webp']);
    expect(slow).toHaveBeenCalledTimes(1);
    expect(await readdir(dir)).toEqual(['teammate.webp']); // one type kept per login
  });
});

describe('WORK-3.9: GET /api/avatars/<login>', () => {
  const review = (author: string | null): WorkPr => ({
    repo: 'willow', number: 2106, title: 'Count the willow leaves', url: 'https://github.com/productiveio/willow/pull/2106', author,
    createdAt: null, ageDays: null, rotting: null, ci: 'none', chip: null, column: 'waiting_on_me', taskIds: [], links: null,
  });

  function app(avatarsDir?: string) {
    const snapshot = { prs: { reviewRequests: [review('teammate'), review(null)] } } as unknown as WorkSnapshot;
    return createApp({
      attachmentsDir: join(root, 'attachments'), ...(avatarsDir ? { avatarsDir } : {}), guard: { ...localAllowLists(12345), token: 'test' },
      monitor: { snapshot: () => ({ sessions: [], fleet: { state: 'ok' } }), watch: () => () => {} },
      settings: { get: defaultSettings, update: vi.fn(), onChange: () => () => {} },
      launcher: { list: () => [], recentStarts: () => [], harnesses: vi.fn(), start: vi.fn(), answerTrust: async () => null, trustDisconnected: () => {}, dismiss: () => false },
      usage: { snapshot: () => null, watch: () => () => {}, refresh: vi.fn(), refreshJev: vi.fn() },
      memory: { snapshot: () => null, watch: () => () => {}, setOpen: () => {}, drop: () => {} },
      files: { check: vi.fn() }, history: { find: vi.fn(), detail: vi.fn(), peek: vi.fn(), resume: vi.fn() },
      viewer: { watch: () => {}, drop: () => {}, send: vi.fn(), earlier: vi.fn() },
      sessions: { end: vi.fn(), answer: vi.fn(), stop: vi.fn(), rename: vi.fn(), switchModel: vi.fn(), switchEffort: vi.fn() },
      library: new Library({ runner: vi.fn(), bin: () => 'unused' }),
      work: { snapshot: () => snapshot, watch: () => () => {}, refresh: vi.fn() }, staticDir: null,
    });
  }

  /** An `<img>`'s request: same origin, no Origin header and no token, as a browser sends it. */
  async function get(lookout: ReturnType<typeof createApp>, path: string, method = 'GET') {
    const chunks: Buffer[] = [];
    const socket = new Duplex({ read() {}, write(c, _e, done) { chunks.push(Buffer.from(c)); done(); } });
    const req = new IncomingMessage(socket as never);
    req.method = method; req.url = path;
    req.httpVersion = '1.1'; req.httpVersionMajor = 1; req.httpVersionMinor = 1;
    req.headers = { host: '127.0.0.1:12345', 'sec-fetch-site': 'same-origin', ...(method === 'GET' ? {} : { origin: 'http://127.0.0.1:12345', 'x-lookout-token': 'test' }) };
    req._destroy = (err, done) => done(err);
    const res = new ServerResponse(req); res.assignSocket(socket as never);
    const finished = new Promise<void>((resolve) => res.on('finish', resolve));
    lookout.server.emit('request', req, res);
    req.push(null);
    await finished; socket.destroy();
    const raw = Buffer.concat(chunks);
    const split = raw.indexOf('\r\n\r\n');
    const headers = Object.fromEntries(raw.subarray(0, split).toString().split('\r\n').slice(1).map((line) => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]));
    return { status: res.statusCode, headers, body: raw.subarray(split + 4) };
  }

  it('WORK-3.9: serves a kept avatar from its own origin, with its type; anyone else is a 404', async () => {
    const lookout = app(dir);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'teammate.png'), PNG);
    await utimes(join(dir, 'teammate.png'), new Date(), new Date());
    const ok = await get(lookout, '/api/avatars/teammate');
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.headers['cache-control']).toBe('private, max-age=3600');
    expect(ok.headers['content-security-policy']).toContain("img-src 'self' data:");
    expect(ok.body).toEqual(PNG);
    expect((await get(lookout, '/api/avatars/stranger')).status).toBe(404);
    expect((await get(lookout, '/api/avatars/teammate', 'POST')).status).toBe(405);
    expect((await get(app(), '/api/avatars/teammate')).status).toBe(404); // no folder: initials
    lookout.server.emit('close');
  });
});
