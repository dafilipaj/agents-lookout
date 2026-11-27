import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivateFolders } from './private-folders.ts';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
/** A home with a Vault of invented notes, by its physical path. */
async function home() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'lookout-private-')));
  roots.push(dir);
  await mkdir(join(dir, 'notes/Team/Tomo/Reviews'), { recursive: true });
  await mkdir(join(dir, 'notes/Team/Tomo/1on1s'), { recursive: true });
  await writeFile(join(dir, 'notes/Team/Tomo/Reviews/q3.md'), '# Review\n');
  await writeFile(join(dir, 'notes/Team/Tomo/1on1s/2026-11-24.md'), '# 1on1\n');
  return dir;
}

describe('PEOPLE-2: which files are private', () => {
  it('PEOPLE-2.3: a file is private under a matched folder at any depth, on its path as recorded', async () => {
    const dir = await home();
    const folders = new PrivateFolders({ home: dir });
    expect(folders.any).toBe(false);
    expect(await folders.covers(join(dir, 'notes/Team/Tomo/Reviews/q3.md'))).toBe(false);

    await folders.set({ vaultFolder: '~/notes', privateFolders: ['Team/*/Reviews'] });
    expect(folders.any).toBe(true);
    expect(await folders.covers(join(dir, 'notes/Team/Tomo/Reviews/q3.md'))).toBe(true);
    expect(await folders.covers(join(dir, 'notes/Team/Tomo/Reviews/deep/er/a.md'))).toBe(true);
    expect(await folders.covers(join(dir, 'NOTES/team/tomo/REVIEWS/Q3.md'))).toBe(true);
    expect(await folders.covers(join(dir, 'notes/Team/Tomo/1on1s/2026-11-24.md'))).toBe(false);
    expect(await folders.covers(`${join(dir, 'notes/Team/Tomo')}/x/../Reviews/q3.md`)).toBe(true);
    expect(await folders.covers('notes/Team/Tomo/Reviews/q3.md')).toBe(false);
  });

  it('PEOPLE-2.3: a symlink on either side still meets: the file by its physical path, the Vault folder as it resolves', async () => {
    const dir = await home();
    // The file is recorded through an alias of the private folder.
    await symlink(join(dir, 'notes/Team/Tomo/Reviews'), join(dir, 'shortcut'));
    const folders = new PrivateFolders({ home: dir });
    await folders.set({ vaultFolder: '~/notes', privateFolders: ['Team/*/Reviews'] });
    expect(folders.matches(join(dir, 'shortcut/q3.md'))).toBe(false);
    expect(await folders.covers(join(dir, 'shortcut/q3.md'))).toBe(true);

    // The Vault folder is set through an alias, and the file is recorded by its physical path.
    await symlink(join(dir, 'notes'), join(dir, 'vault'));
    const aliased = new PrivateFolders({ home: dir });
    await aliased.set({ vaultFolder: '~/vault', privateFolders: ['Team/*/Reviews', 'Team/Tomo/1on1s'] });
    expect(await aliased.covers(join(dir, 'vault/Team/Tomo/Reviews/q3.md'))).toBe(true);
    expect(await aliased.covers(join(dir, 'notes/Team/Tomo/Reviews/q3.md'))).toBe(true);
    expect(await aliased.covers(join(dir, 'notes/Team/Tomo/1on1s/2026-11-24.md'))).toBe(true);
  });

  it('PEOPLE-2.3: a disk too slow to say where a folder really is leaves its files private, and a folder that is gone is not', async () => {
    const dir = await home();
    const never = new Promise<string>(() => {});
    const slow = new PrivateFolders({ home: dir, timeoutMs: 20, realpath: () => never });
    await slow.set({ vaultFolder: '~/notes', privateFolders: ['Team/*/Reviews'] });
    expect(await slow.covers(join(dir, 'elsewhere/a.md'))).toBe(true);

    const gone = new PrivateFolders({ home: dir });
    await gone.set({ vaultFolder: '~/notes', privateFolders: ['Team/*/Reviews'] });
    expect(await gone.covers(join(dir, 'no-such-folder/a.md'))).toBe(false);
  });

  it('PEOPLE-2.3: a file that is itself a link into a Private folder is private, by where it really is', async () => {
    const dir = await home();
    await mkdir(join(dir, 'work'));
    await symlink(join(dir, 'notes/Team/Tomo/Reviews/q3.md'), join(dir, 'work/latest.md'));
    await symlink(join(dir, 'notes/Team/Tomo/1on1s/2026-11-24.md'), join(dir, 'work/last-1on1.md'));
    const folders = new PrivateFolders({ home: dir });
    await folders.set({ vaultFolder: '~/notes', privateFolders: ['Team/*/Reviews'] });
    expect(folders.matches(join(dir, 'work/latest.md'))).toBe(false);
    expect(await folders.covers(join(dir, 'work/latest.md'))).toBe(true);
    expect(await folders.covers(join(dir, 'work/last-1on1.md'))).toBe(false);
  });

  it('PEOPLE-2.3: an entry is met at its physical path when its folder is made after it was saved, and whatever way the Vault folder was typed', async () => {
    const dir = await home();
    await symlink(join(dir, 'notes'), join(dir, 'vault'));
    const folders = new PrivateFolders({ home: dir });
    // The folder to move the notes into doesn't exist yet: its part of the path is kept as written.
    await folders.set({ vaultFolder: '~/vault', privateFolders: ['Team/Ana/Reviews'] });
    expect(await folders.covers(join(dir, 'notes/Team/Ana/Reviews/r.md'))).toBe(true);
    await mkdir(join(dir, 'notes/Team/Ana/Reviews'), { recursive: true });
    await writeFile(join(dir, 'notes/Team/Ana/Reviews/r.md'), '# Review\n');
    expect(await folders.covers(join(dir, 'notes/Team/Ana/Reviews/r.md'))).toBe(true);
    expect(await folders.covers(join(dir, 'vault/Team/Ana/Reviews/r.md'))).toBe(true);

    // A Vault folder typed with `..` and a doubled slash is the same folder.
    const typed = new PrivateFolders({ home: dir });
    await typed.set({ vaultFolder: `${dir}/work/..//notes`, privateFolders: ['Team/*/Reviews'] });
    expect(await typed.covers(join(dir, 'notes/Team/Tomo/Reviews/q3.md'))).toBe(true);
  });

  it('PEOPLE-2.3: where an entry really is is asked again every 10 s, so a disk that was slow, or a folder linked since, is still met', async () => {
    const dir = await home();
    await symlink(join(dir, 'notes'), join(dir, 'vault'));
    const physical = join(dir, 'notes/Team/Tomo/Reviews/q3.md');
    let now = 1_000_000;
    let slow = true;
    const never = new Promise<string>(() => {});
    const changed = vi.fn();
    const folders = new PrivateFolders({ home: dir, timeoutMs: 20, now: () => now, realpath: (p) => (slow && p.startsWith(join(dir, 'vault')) ? never : realpath(p)) });
    folders.onChange(changed);
    await folders.set({ vaultFolder: '~/vault', privateFolders: ['Team/*/Reviews'] });
    // The disk didn't say where the Vault really is: the file recorded at its physical path isn't met yet.
    expect(await folders.covers(physical)).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);

    // It answers now, and is asked again only once 10 s have passed.
    slow = false;
    now += 9_000;
    expect(await folders.covers(physical)).toBe(false);
    now += 1_000;
    expect(await folders.covers(physical)).toBe(true);
    // The rule grew, so whoever draws from it hears.
    expect(changed).toHaveBeenCalledTimes(2);

    // Slow again later: what it last answered stands.
    slow = true;
    now += 60_000;
    expect(await folders.covers(join(dir, 'notes/Team/Tomo/Reviews/other.md'))).toBe(true);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('PEOPLE-2.3: a place the disk once answered for an entry is kept while its link points nowhere, so nothing opens when a volume comes back', async () => {
    const dir = await home();
    await symlink(join(dir, 'notes'), join(dir, 'vault'));
    const physical = join(dir, 'notes/Team/Tomo/Reviews/q3.md');
    let now = 1_000_000;
    const changed = vi.fn();
    const folders = new PrivateFolders({ home: dir, now: () => now });
    folders.onChange(changed);
    await folders.set({ vaultFolder: '~/vault', privateFolders: ['Team/*/Reviews'] });
    expect(await folders.covers(physical)).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);

    // The volume goes away: the link points nowhere, and the disk is asked again meanwhile.
    await rename(join(dir, 'notes'), join(dir, 'away'));
    now += 10_000;
    expect(await folders.covers(join(dir, 'elsewhere/a.md'))).toBe(false);
    // It comes back: the file at its physical path is private at once, with no wait for the next ask.
    await rename(join(dir, 'away'), join(dir, 'notes'));
    now += 1_000;
    expect(folders.matches(physical)).toBe(true);
    expect(await folders.covers(join(dir, 'notes/Team/Tomo/Reviews/other.md'))).toBe(true);
    // Going and coming back changed nothing in the rule, so nobody is told and nothing is read again.
    now += 10_000;
    expect(await folders.covers(physical)).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('PEOPLE-2.6: the disk’s answer to a change tells no one a second time, a folder typed in another letter case is the same folder, and a listener that throws fails nothing', async () => {
    const dir = await home();
    await symlink(join(dir, 'notes'), join(dir, 'vault'));
    const changed = vi.fn();
    // Through a link, and in the case it was typed in: the disk answers with another spelling of each.
    const folders = new PrivateFolders({ home: dir });
    folders.onChange(changed);
    await folders.set({ vaultFolder: '~/vault', privateFolders: ['Team/*/Reviews'] });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(await folders.covers(join(dir, 'notes/Team/Tomo/Reviews/q3.md'))).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);

    const cased = new PrivateFolders({ home: dir, realpath: async (p) => (await realpath(p)).replace('/notes', '/NOTES') });
    const heard = vi.fn();
    await cased.set({ vaultFolder: '~/notes', privateFolders: [] });
    cased.onChange(heard);
    let now = Date.now();
    const later = new PrivateFolders({ home: dir, now: () => now, realpath: async (p) => (await realpath(p)).replace('/notes', '/NOTES') });
    await later.set({ vaultFolder: '~/notes', privateFolders: ['Team/*/Reviews'] });
    later.onChange(heard);
    now += 10_000;
    expect(await later.covers(join(dir, 'notes/Team/Tomo/Reviews/q3.md'))).toBe(true);
    expect(await cased.inVault(join(dir, 'notes/Team/Tomo/x.md'))).toBe(true);
    expect(heard).not.toHaveBeenCalled();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      folders.onChange(() => {
        throw new Error('a listener broke');
      });
      await expect(folders.set({ vaultFolder: '~/vault', privateFolders: ['Team/*/Reviews', 'Team/360 *'] })).resolves.toBeUndefined();
      expect(changed).toHaveBeenCalledTimes(2);
      expect(await folders.covers(join(dir, 'notes/Team/360 Q3/a.md'))).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('a listener failed'));
    } finally {
      warn.mockRestore();
    }
  });

  it('PEOPLE-2.6: settings that leave the rule as it was tell no one, so a save of any other setting costs the Library nothing', async () => {
    const dir = await home();
    const folders = new PrivateFolders({ home: dir });
    const changed = vi.fn();
    folders.onChange(changed);
    // No Vault and no Private folder, saved again and again (every Session start saves a setting).
    await folders.set({ vaultFolder: null, privateFolders: [] });
    await folders.set({ vaultFolder: null, privateFolders: [] });
    expect(changed).not.toHaveBeenCalled();

    await folders.set({ vaultFolder: '~/notes', privateFolders: ['Team/*/Reviews'] });
    const told = changed.mock.calls.length;
    expect(told).toBeGreaterThan(0);
    await folders.set({ vaultFolder: '~/notes', privateFolders: ['Team/*/Reviews'] });
    await folders.set({ vaultFolder: '~/notes/', privateFolders: ['Team/*/Reviews'] });
    expect(changed).toHaveBeenCalledTimes(told);
    await folders.set({ vaultFolder: '~/notes', privateFolders: ['Team/*/Reviews', 'Team/360 *'] });
    expect(changed.mock.calls.length).toBeGreaterThan(told);
  });

  it('PEOPLE-2.9: a file is in the Vault by its path as recorded or its physical path, a gone one too, and none is while no Vault folder is set', async () => {
    const dir = await home();
    await symlink(join(dir, 'notes'), join(dir, 'vault'));
    const folders = new PrivateFolders({ home: dir });
    expect(await folders.inVault(join(dir, 'notes/Team/Tomo/moved.md'))).toBe(false);
    await folders.set({ vaultFolder: '~/vault', privateFolders: [] });
    expect(folders.any).toBe(false);
    expect(await folders.inVault(join(dir, 'vault/Team/Tomo/moved.md'))).toBe(true);
    expect(await folders.inVault(join(dir, 'notes/Team/Tomo/moved.md'))).toBe(true);
    expect(await folders.inVault(join(dir, 'notes/Team/Tomo/1on1s/2026-11-24.md'))).toBe(true);
    expect(await folders.inVault(join(dir, 'elsewhere/moved.md'))).toBe(false);
    expect(await folders.inVault(join(dir, 'notes'))).toBe(false);
  });

  it('PEOPLE-2.6: a change holds at once, before the disk has answered, and tells who asked to hear', async () => {
    const dir = await home();
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const folders = new PrivateFolders({ home: dir, realpath: async (p) => (await held, realpath(p)) });
    const changed = vi.fn();
    folders.onChange(changed);
    const file = join(dir, 'notes/Team/Tomo/Reviews/q3.md');

    const done = folders.set({ vaultFolder: '~/notes', privateFolders: ['Team/*/Reviews'] });
    // As written, the rule holds before set's promise settles.
    expect(folders.matches(file)).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    release();
    await done;

    await folders.set({ vaultFolder: '~/notes', privateFolders: [] });
    expect(folders.any).toBe(false);
    expect(await folders.covers(file)).toBe(false);
    expect(changed.mock.calls.length).toBeGreaterThanOrEqual(2);

    // An entry inside the Vault matches nothing once the Vault folder is gone from the settings.
    await folders.set({ vaultFolder: null, privateFolders: ['Team/*/Reviews'] });
    expect(await folders.covers(file)).toBe(false);
  });
});
