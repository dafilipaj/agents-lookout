import type { PathAnswer } from '@shared/files.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANSWER_TTL_MS, FileLinks, FileStore } from './files';

const ROOT = '/Users/me/Projects/acme-app';
/** A server where every path under src/ is a file. */
const server = () =>
  vi.fn(async (_id: string, paths: string[]): Promise<PathAnswer[]> =>
    paths.map((path) => (path.startsWith('src/') ? { path, exists: true, absolute: `${ROOT}/${path}` } : { path, exists: false, absolute: null })),
  );

afterEach(() => vi.restoreAllMocks());

describe('the tab’s answers (VIEW-1.18)', () => {
  it('VIEW-1.18: the tab asks about each path once, in one batch, and again only after 30 s', async () => {
    const check = server();
    const store = new FileStore('s1', check);
    const changed = vi.fn();
    store.subscribe(changed);
    for (const p of ['src/a.ts', 'src/b.ts', 'src/a.ts', 'docs/c.md']) store.want(p);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith('s1', ['src/a.ts', 'src/b.ts', 'docs/c.md']);
    expect(store.absolute('src/a.ts')).toBe(`${ROOT}/src/a.ts`);
    expect(store.absolute('docs/c.md')).toBeNull();

    // Within 30 s nothing is asked again, whichever row shows the path.
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + ANSWER_TTL_MS - 1000);
    store.want('src/a.ts');
    store.want('docs/c.md');
    await new Promise((r) => setTimeout(r, 100));
    expect(check).toHaveBeenCalledTimes(1);
    // After 30 s, a row that shows it asks again; the old answer stays until the new one comes.
    clock.mockReturnValue(now + ANSWER_TTL_MS + 1000);
    store.want('src/a.ts');
    expect(store.absolute('src/a.ts')).toBe(`${ROOT}/src/a.ts`);
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(2));
    expect(check).toHaveBeenLastCalledWith('s1', ['src/a.ts']);
  });

  it('VIEW-1.18: at most 100 paths per request, one request at a time', async () => {
    let release: () => void = () => {};
    const inFlight: string[][] = [];
    const check = vi.fn(async (_id: string, paths: string[]): Promise<PathAnswer[]> => {
      inFlight.push(paths);
      await new Promise<void>((r) => (release = r));
      return paths.map((path) => ({ path, exists: false, absolute: null }));
    });
    const store = new FileStore('s1', check);
    for (let i = 0; i < 150; i++) store.want(`src/f${i}.ts`);
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    expect(inFlight[0]).toHaveLength(100);
    store.want('src/late.ts'); // wanted while the first is out: waits its turn
    await new Promise((r) => setTimeout(r, 100));
    expect(check).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(2));
    expect(inFlight[1]).toHaveLength(51);
    expect(inFlight[1]).toContain('src/late.ts');
    release();
  });

  it('VIEW-1.18: a failed request, or an answer that isn’t an absolute path, leaves the paths text for 30 s', async () => {
    const failing = vi.fn(async (): Promise<PathAnswer[]> => {
      throw new Error("This Session isn't running.");
    });
    const store = new FileStore('ended', failing);
    const changed = vi.fn();
    store.subscribe(changed);
    store.want('src/a.ts');
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    expect(store.absolute('src/a.ts')).toBeNull();
    store.want('src/a.ts');
    await new Promise((r) => setTimeout(r, 100));
    expect(failing).toHaveBeenCalledTimes(1);

    const odd = vi.fn(async (_id: string, paths: string[]): Promise<PathAnswer[]> => [
      { path: paths[0]!, exists: true, absolute: 'relative/a.ts' },
      { path: paths[1]!, exists: true, absolute: '/a/\nb.ts' },
      { path: paths[2]!, exists: false, absolute: '/a/c.ts' },
    ]);
    const other = new FileStore('s2', odd);
    const done = vi.fn();
    other.subscribe(done);
    ['src/a.ts', 'src/b.ts', 'src/c.ts'].forEach((p) => other.want(p));
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(['src/a.ts', 'src/b.ts', 'src/c.ts'].map((p) => other.absolute(p))).toEqual([null, null, null]);
  });

  it('VIEW-1.18: each Session has its own answers; switching back within 30 s asks nothing again, however many Sessions were viewed in between', async () => {
    const t0 = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    const check = server();
    const links = new FileLinks(check);
    const a = links.session('a');
    expect(links.session('a')).toBe(a);
    a.want('src/x.ts');
    await vi.waitFor(() => expect(a.absolute('src/x.ts')).not.toBeNull());
    expect(links.session('b').absolute('src/x.ts')).toBeNull();
    // Twelve other Sessions, more than the 8 kept: A's answer is still fresh, so A stays.
    for (let i = 0; i < 12; i++) links.session(`other-${i}`);
    clock.mockReturnValue(t0 + ANSWER_TTL_MS - 1000);
    expect(links.session('a')).toBe(a);
    a.want('src/x.ts');
    await new Promise((r) => setTimeout(r, 100));
    expect(check).toHaveBeenCalledTimes(1);
    // Once its answers have expired, a Session past the 8 most recent goes.
    clock.mockReturnValue(t0 + ANSWER_TTL_MS + 1000);
    for (let i = 0; i < 8; i++) links.session(`more-${i}`);
    expect(links.session('a')).not.toBe(a);
  });

  it('VIEW-1.18: past 2,000 answers only expired ones go: a fresh answer is never dropped, nor its path asked again within 30 s', async () => {
    const t0 = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    const check = server();
    const store = new FileStore('s1', check);
    const paths = Array.from({ length: 2100 }, (_, i) => `src/f${i}.ts`);
    paths.forEach((p) => store.want(p));
    await vi.waitFor(() => expect(store.absolute('src/f2099.ts')).not.toBeNull());
    expect(check).toHaveBeenCalledTimes(21);
    expect(paths.every((p) => store.absolute(p) !== null)).toBe(true); // 2,100 fresh answers, all kept
    paths.forEach((p) => store.want(p));
    await new Promise((r) => setTimeout(r, 100));
    expect(check).toHaveBeenCalledTimes(21);
    // Expired, they make room: the oldest go first once a new answer comes.
    clock.mockReturnValue(t0 + ANSWER_TTL_MS + 1000);
    store.want('src/new.ts');
    await vi.waitFor(() => expect(store.absolute('src/new.ts')).not.toBeNull());
    expect(store.absolute('src/f0.ts')).toBeNull();
    expect(store.absolute('src/f100.ts')).toBeNull();
    expect(store.absolute('src/f101.ts')).not.toBeNull();
  });
});
