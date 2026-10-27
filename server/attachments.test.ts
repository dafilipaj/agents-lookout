import { lstat, mkdir, mkdtemp, open, readFile, readdir, rm, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Attachments, DAY_MS } from './attachments.ts';
import { MAX_ATTACHMENT_BYTES } from '../shared/attachments.ts';

let root: string;
let dir: string;
const now = new Date(2026, 9, 27, 10, 12, 3);
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'lookout-attachments-')); dir = join(root, 'attachments'); });
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of [open, unlink, lstat]) vi.mocked(fn).mockReset();
  await rm(root, { recursive: true, force: true });
});
const bytes = Buffer.from([0, 255, 32, 10, 13, 128]);
const body = () => Readable.from([bytes.subarray(0, 2), bytes.subarray(2)]);

vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs, open: vi.fn(fs.open), unlink: vi.fn(fs.unlink), lstat: vi.fn(fs.lstat) };
});
const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
/** Runs `then` once, the first time `lstat` reads a path `when` picks, after it has read it. */
function afterLstat(when: (path: string) => boolean, then: (path: string) => Promise<void>) {
  const done = new Set<string>();
  vi.mocked(lstat).mockImplementation((async (path: string) => {
    const info = await fs.lstat(path);
    if (when(path) && !done.has(path)) { done.add(path); await then(path); }
    return info;
  }) as typeof lstat);
  return done;
}

describe('saved attachments', () => {
  it('VIEW-9.14: an ENOSPC while opening the copy becomes a disk-full error without filesystem details', async () => {
    vi.mocked(open).mockImplementation((async (path: string, flags: number, mode: number) => {
      if (path.endsWith('.part')) throw Object.assign(new Error('/private/path: no space'), { code: 'ENOSPC' });
      return fs.open(path, flags, mode);
    }) as typeof open);
    await expect(new Attachments(dir).save('shot.png', body(), bytes.length, now)).rejects.toMatchObject({ status: 507, message: "The disk is full, so shot.png wasn't saved." });
    expect(await readdir(join(dir, '2026-10-27'))).toEqual([]);
  });
  it('VIEW-9.3: saves the exact bytes under the local day and returns an absolute path', async () => {
    const path = await new Attachments(dir).save('shot.png', body(), bytes.length, now);
    expect(path).toBe(join(dir, '2026-10-27', 'shot.png'));
    expect(await readFile(path)).toEqual(bytes);
    expect(await readdir(join(dir, '2026-10-27'))).toEqual(['shot.png']);
  });
  it('VIEW-9.12: concurrent uploads claim the first free suffix without overwriting', async () => {
    const store = new Attachments(dir);
    const paths = await Promise.all(Array.from({ length: 6 }, (_, i) => store.save('shot.png', Readable.from([Buffer.from(String(i))]), 1, now)));
    expect(paths.sort()).toEqual(['shot.png', ...Array.from({ length: 5 }, (_, i) => `shot-${i + 2}.png`)].map(n => join(dir, '2026-10-27', n)).sort());
    expect(new Set(await Promise.all(paths.map(p => readFile(p, 'utf8')))).size).toBe(6);
  });
  it('VIEW-9.13: refuses streams over the limit or their declared size and keeps no partial file', async () => {
    const store = new Attachments(dir);
    for (const length of [bytes.length - 1, bytes.length + 1]) {
      await expect(store.save('bad', body(), length, now)).rejects.toMatchObject({ status: 400 });
    }
    await expect(store.save('large', Readable.from([Buffer.alloc(MAX_ATTACHMENT_BYTES + 1)]), MAX_ATTACHMENT_BYTES, now)).rejects.toMatchObject({ status: 413 });
    expect(await readdir(join(dir, '2026-10-27'))).toEqual([]);
  });
  it('VIEW-9.15: sanitizes paths, rejects linked storage folders and cleans up a cut-off stream', async () => {
    const store = new Attachments(dir);
    const path = await store.save('../../outside\\.shot.png', body(), bytes.length, now);
    expect(path).toBe(join(dir, '2026-10-27', 'shot.png'));
    async function* broken() { yield bytes; throw new Error('private filesystem details'); }
    await expect(store.save('broken', Readable.from(broken()), 100, now)).rejects.toMatchObject({ status: 500, message: "Lookout couldn't save broken." });
    expect(await readdir(join(dir, '2026-10-27'))).toEqual(['shot.png']);
    await mkdir(join(root, 'outside'));
    await symlink(join(root, 'outside'), join(dir, '2026-10-28'));
    await expect(store.save('nope', body(), bytes.length, new Date(2026, 9, 28))).rejects.toMatchObject({ status: 500 });
    await expect(new Attachments(join(dir, '2026-10-28')).save('nope', body(), bytes.length, now)).rejects.toMatchObject({ status: 500 });
    expect(await readdir(join(root, 'outside'))).toEqual([]);
  });
  it('VIEW-9.15: a day folder swapped for a link before the copy is created leaves nothing outside the attachments folder', async () => {
    const store = new Attachments(dir);
    await store.save('first.png', body(), bytes.length, now);
    const day = join(dir, '2026-10-27');
    const outside = join(root, 'outside');
    await mkdir(outside);
    vi.mocked(open).mockImplementation((async (path: string, flags: number, mode: number) => {
      if (path.endsWith('.part')) { await fs.rename(day, join(root, 'moved')); await fs.symlink(outside, day); }
      return fs.open(path, flags, mode);
    }) as typeof open);
    await expect(store.save('shot.png', body(), bytes.length, now)).rejects.toMatchObject({ status: 500, message: "Lookout couldn't save shot.png." });
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(join(root, 'moved'))).toEqual(['first.png']);
  });
  it('VIEW-9.18: directories are private, files are private, and saving logs no names or contents', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'error')];
    const path = await new Attachments(dir).save('private', body(), bytes.length, now);
    for (const folder of [dir, join(dir, '2026-10-27')]) expect((await stat(folder)).mode & 0o777).toBe(0o700);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
  it('VIEW-9.17: prunes only old regular files and empty old day folders, skipping links and other entries', async () => {
    const old = new Date(now.getTime() - 14 * DAY_MS);
    await mkdir(join(dir, '2026-10-01'), { recursive: true });
    await mkdir(join(dir, '2026-10-13'));
    await mkdir(join(dir, '2026-10-27'));
    await mkdir(join(dir, 'other'));
    await writeFile(join(root, 'outside'), 'keep');
    for (const name of ['old', 'young']) await writeFile(join(dir, '2026-10-01', name), 'x');
    await utimes(join(dir, '2026-10-01', 'old'), old, old);
    await utimes(join(dir, '2026-10-01', 'young'), now, now);
    await symlink(join(root, 'outside'), join(dir, '2026-10-01', 'link'));
    await mkdir(join(dir, '2026-10-01', 'nested'));
    const store = new Attachments(dir);
    await store.prune(now);
    expect(await readdir(join(dir, '2026-10-01'))).toEqual(['link', 'nested', 'young']);
    expect(await readdir(dir)).toEqual(['2026-10-01', '2026-10-27', 'other']);
    expect(await readFile(join(root, 'outside'), 'utf8')).toBe('keep');
    await symlink(dir, join(root, 'linked'));
    await new Attachments(join(root, 'linked')).prune(new Date(now.getTime() + 30 * DAY_MS));
    expect(await readFile(join(dir, '2026-10-01', 'young'), 'utf8')).toBe('x');
  });
  it('VIEW-9.17: a day folder swapped for a link after its check is never listed or pruned through', async () => {
    const folder = join(dir, '2026-10-01');
    const outside = join(root, 'outside');
    await mkdir(folder, { recursive: true });
    await mkdir(outside);
    await writeFile(join(outside, 'precious'), 'keep');
    await utimes(join(outside, 'precious'), new Date(0), new Date(0));
    const swapped = afterLstat(path => path === folder, async () => { await fs.rename(folder, join(root, 'moved')); await fs.symlink(outside, folder); });
    await new Attachments(dir).prune(now);
    expect(swapped.size).toBe(1);
    expect(await readFile(join(outside, 'precious'), 'utf8')).toBe('keep');
  });
  it('VIEW-9.17: a file touched or replaced between its check and its deletion is kept', async () => {
    const folder = join(dir, '2026-10-01');
    await mkdir(folder, { recursive: true });
    for (const name of ['plain', 'replaced', 'touched']) { await writeFile(join(folder, name), name); await utimes(join(folder, name), new Date(0), new Date(0)); }
    afterLstat(path => dirname(path) === folder, async path => {
      if (basename(path) === 'touched') await fs.utimes(path, now, now);
      if (basename(path) !== 'replaced') return;
      // A new file under the old name, with an old time of its own: another inode, so not the one checked.
      await fs.writeFile(`${path}.new`, 'new');
      await fs.utimes(`${path}.new`, new Date(0), new Date(0));
      await fs.rename(`${path}.new`, path);
    });
    await new Attachments(dir).prune(now);
    expect(await readdir(folder)).toEqual(['replaced', 'touched']);
    expect(await readFile(join(folder, 'replaced'), 'utf8')).toBe('new');
  });
  it('VIEW-9.17: a failed deletion is left for the next run while the other old files are pruned', async () => {
    const folder = join(dir, '2026-10-01');
    await mkdir(folder, { recursive: true });
    for (const name of ['a', 'b']) { await writeFile(join(folder, name), name); await utimes(join(folder, name), new Date(0), new Date(0)); }
    vi.mocked(unlink).mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
    const store = new Attachments(dir); await store.prune(now);
    expect(await readdir(folder)).toEqual(['a']);
    await store.prune(now);
    expect(await readdir(dir)).toEqual([]);
  });
});
