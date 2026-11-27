import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRIVATE_FOLDER_ERROR } from '../shared/private-folders.ts';
import { PRIVATE_NEEDS_VAULT, PRODUCTIVE_EMAIL_ERROR, SettingsError, VAULT_HAS_PRIVATE, defaultSettings, parseProductiveEmail } from '../shared/settings.ts';
import { SettingsStore, defaultSettingsPath, expandHome } from './settings.ts';

const D = defaultSettings();

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lookout-settings-'));
  file = join(dir, 'nested', 'lookout', 'settings.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('SettingsStore', () => {
  it('starts from defaults when there is no file', async () => {
    const store = new SettingsStore(file);
    expect(await store.load()).toEqual({ idleThresholdHours: 4, startDirectories: ['~/Projects/work'], lastLaunch: null, productiveEmail: null, recommendWithJev: false, undoSend: true, vaultFolder: null, privateFolders: [] });
  });

  it('SIDE-7.2: a saved value is written to the file and survives a restart', async () => {
    const store = new SettingsStore(file);
    await store.load();
    await store.update({ idleThresholdHours: 2.5 });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ idleThresholdHours: 2.5, version: 1 });

    const restarted = new SettingsStore(file);
    expect(await restarted.load()).toEqual({ ...D, idleThresholdHours: 2.5 });
  });

  it('SIDE-7.2: a change notifies listeners, which push it to every open tab', async () => {
    const store = new SettingsStore(file);
    await store.load();
    const listener = vi.fn();
    store.onChange(listener);
    await store.update({ idleThresholdHours: 1 });
    expect(listener).toHaveBeenCalledWith({ ...D, idleThresholdHours: 1 });
  });

  it('rejects invalid values and unknown keys, and leaves the file alone', async () => {
    const store = new SettingsStore(file);
    await store.load();
    await store.update({ idleThresholdHours: 3 });
    for (const bad of [{ idleThresholdHours: 0 }, { idleThresholdHours: -1 }, { idleThresholdHours: '4' }, { colour: 'red' }, [1]]) {
      expect(() => store.update(bad)).toThrow(SettingsError);
    }
    expect(store.get()).toEqual({ ...D, idleThresholdHours: 3 });
  });

  it('keeps keys it does not know, so a newer Lookout’s settings survive', async () => {
    writeFileSync(join(dir, 'f.json'), JSON.stringify({ idleThresholdHours: 6, futureThing: ['x'], version: 1 }));
    const store = new SettingsStore(join(dir, 'f.json'));
    expect(await store.load()).toEqual({ ...D, idleThresholdHours: 6 });
    await store.update({ idleThresholdHours: 7 });
    expect(JSON.parse(readFileSync(join(dir, 'f.json'), 'utf8'))).toEqual({
      idleThresholdHours: 7,
      futureThing: ['x'],
      version: 1,
    });
  });

  it('falls back to defaults for a corrupt file or invalid stored values', async () => {
    writeFileSync(join(dir, 'bad.json'), '{not json');
    expect(await new SettingsStore(join(dir, 'bad.json')).load()).toEqual(D);
    writeFileSync(join(dir, 'bad2.json'), JSON.stringify({ idleThresholdHours: 'soon' }));
    expect(await new SettingsStore(join(dir, 'bad2.json')).load()).toEqual(D);
  });

  it('LAUNCH-2.1: start directories default to ~/Projects/work', async () => {
    expect((await new SettingsStore(file).load()).startDirectories).toEqual(['~/Projects/work']);
  });

  it('LAUNCH-2.2: start directories can be added and removed, if they exist', async () => {
    const store = new SettingsStore(file);
    await store.load();
    await store.update({ startDirectories: ['~/Projects/work', `${dir}/`] }); // trailing slash trimmed
    expect(store.get().startDirectories).toEqual(['~/Projects/work', dir]);
    await expect(store.update({ startDirectories: ['~/Projects/work', join(dir, 'nope')] })).rejects.toThrow(/Not a directory/);
    await store.update({ startDirectories: [dir] });
    expect(store.get().startDirectories).toEqual([dir]);
    expect(() => store.update({ startDirectories: [] })).toThrow(/at least one/);
    expect(() => store.update({ startDirectories: ['relative/path'] })).toThrow(SettingsError);
    await expect(new SettingsStore(file).load()).resolves.toMatchObject({ startDirectories: [dir] });
  });

  it('LAUNCH-1.2: the last launch is written by the server only', async () => {
    const store = new SettingsStore(file);
    await store.load();
    const last = { harness: 'codex', model: 'gpt-6-astra', directory: '~/Projects/work' };
    expect(() => store.update({ lastLaunch: last })).toThrow(/can't be changed/);
    await store.update({ lastLaunch: last }, 'server');
    expect((await new SettingsStore(file).load()).lastLaunch).toEqual(last);
  });

  it('LAUNCH-3.4 LAUNCH-3.5: old settings load as first time and per-Harness choices survive a restart', async () => {
    const store = new SettingsStore(file);
    const last = { harness: 'claude', model: '', directory: '~/Projects/work' };
    await store.load();
    await store.update({ lastLaunch: last }, 'server');
    expect((await new SettingsStore(file).load()).lastLaunch).toMatchObject(last);
    const byHarness = { claude: { effort: 'high', skipPermissions: true }, codex: { effort: null, skipPermissions: false } };
    await store.update({ lastLaunch: { ...last, byHarness } }, 'server');
    expect((await new SettingsStore(file).load()).lastLaunch).toEqual({ ...last, byHarness });
    for (const choice of [{ effort: '--bad', skipPermissions: true }, { effort: 'high', skipPermissions: 'true' }]) {
      expect(() => store.update({ lastLaunch: { ...last, byHarness: { claude: choice } } }, 'server')).toThrow(SettingsError);
    }
    expect(() => store.update({ lastLaunch: { ...last, byHarness } })).toThrow(/can't be changed/);
  });

  it('LAUNCH-3.4 LAUNCH-3.5: queued saves only replace the starting Harness choices', async () => {
    const store = new SettingsStore(file);
    await store.load();
    const last = { model: '', directory: '~/Projects/work' };
    const claude = { effort: 'high', skipPermissions: true };
    const codex = { effort: 'low', skipPermissions: false };
    await Promise.all([
      store.update({ lastLaunch: { ...last, harness: 'claude', byHarness: { claude } } }, 'server'),
      store.update({ lastLaunch: { ...last, harness: 'codex', byHarness: { codex } } }, 'server'),
    ]);
    expect((await new SettingsStore(file).load()).lastLaunch).toEqual({ ...last, harness: 'codex', byHarness: { claude, codex } });
  });

  it('WORK-2.7: the Productive email is saved trimmed, otherwise as typed; empty clears it', async () => {
    const store = new SettingsStore(file);
    expect((await store.load()).productiveEmail).toBeNull();
    await store.update({ productiveEmail: '  Lamp.Lighter+work@Example.com\t' });
    expect(store.get().productiveEmail).toBe('Lamp.Lighter+work@Example.com');
    expect((await new SettingsStore(file).load()).productiveEmail).toBe('Lamp.Lighter+work@Example.com');
    await store.update({ productiveEmail: '   ' });
    expect(store.get().productiveEmail).toBeNull();
    await store.update({ productiveEmail: 'lamplighter@example.com' });
    await store.update({ productiveEmail: null });
    expect(store.get().productiveEmail).toBeNull();
  });

  it('WORK-2.7: whitespace inside, not exactly one @ with text on both sides, or over 254 characters is refused, and the saved value stays', async () => {
    const store = new SettingsStore(file);
    await store.load();
    await store.update({ productiveEmail: 'lamplighter@example.com' });
    const local = (n: number) => `${'a'.repeat(n - '@example.com'.length)}@example.com`;
    for (const bad of ['lamp lighter@example.com', 'lamp\u00a0lighter@example.com', 'lamp@light@example.com', 'lamplighter.example.com', '@example.com', 'lamplighter@', '@', local(255), 42, ['a@b.c']]) {
      let err: unknown;
      try {
        store.update({ productiveEmail: bad });
      } catch (e) {
        err = e;
      }
      expect(err, JSON.stringify(bad)).toBeInstanceOf(SettingsError);
      expect((err as SettingsError).message).toBe(PRODUCTIVE_EMAIL_ERROR);
      expect((err as SettingsError).field).toBe('productiveEmail');
    }
    expect(store.get().productiveEmail).toBe('lamplighter@example.com');
    expect(PRODUCTIVE_EMAIL_ERROR).toBe('Enter an email such as name@example.com');
    // 254 characters is still an email, as is anything with one @ and text on both sides.
    expect(parseProductiveEmail(local(254))).toBe(local(254));
    expect(parseProductiveEmail('a@b')).toBe('a@b');
    // A stored value the parser refuses reads as no email (WORK-2.6).
    writeFileSync(join(dir, 'bad-email.json'), JSON.stringify({ productiveEmail: 'not an email' }));
    expect((await new SettingsStore(join(dir, 'bad-email.json')).load()).productiveEmail).toBeNull();
  });

  it('WORK-2.7: a comma anywhere is refused, since tb-prod would send the value as a list of emails, and the saved value stays', async () => {
    const store = new SettingsStore(file);
    await store.load();
    await store.update({ productiveEmail: 'lamplighter@example.com' });
    for (const bad of ['x,colleague@example.com', 'lamplighter@example.com,', ',lamplighter@example.com', 'lamp,lighter@example.com', 'lamplighter@example,com', ' x , keeper@example.com ']) {
      expect(() => store.update({ productiveEmail: bad }), bad).toThrow(new SettingsError('productiveEmail', PRODUCTIVE_EMAIL_ERROR));
      expect(() => parseProductiveEmail(bad), bad).toThrow(PRODUCTIVE_EMAIL_ERROR);
    }
    expect(store.get().productiveEmail).toBe('lamplighter@example.com');
    // A stored one reads as no email (WORK-2.6): no query runs for it.
    writeFileSync(join(dir, 'comma-email.json'), JSON.stringify({ productiveEmail: 'x,colleague@example.com' }));
    expect((await new SettingsStore(join(dir, 'comma-email.json')).load()).productiveEmail).toBeNull();
  });

  it('expands ~ in paths', () => {
    expect(expandHome('~', '/h')).toBe('/h');
    expect(expandHome('~/Projects/work', '/h')).toBe('/h/Projects/work');
    expect(expandHome('/abs', '/h')).toBe('/abs');
  });

  it('lives in ~/.config/lookout/settings.json unless told otherwise', () => {
    expect(defaultSettingsPath({})).toBe(join(homedir(), '.config', 'lookout', 'settings.json'));
    expect(defaultSettingsPath({ XDG_CONFIG_HOME: '/cfg' })).toBe('/cfg/lookout/settings.json');
    expect(defaultSettingsPath({ LOOKOUT_SETTINGS: '/x.json' })).toBe('/x.json');
  });
});

describe('PEOPLE-1, PEOPLE-2: the Vault folder and Private folders', () => {
  const store = async () => {
    const s = new SettingsStore(file);
    await s.load();
    return s;
  };

  it('PEOPLE-1.2: the Vault folder is a full path on one line and a directory when it is saved; the saved one stays, and `~` is kept as typed', async () => {
    const s = await store();
    // Kept as typed: a folder under the home directory, given with `~`.
    const typed = `~/${dir.startsWith(homedir()) ? dir.slice(homedir().length + 1) : ''}`;
    const vault = dir.startsWith(homedir()) ? typed : dir;
    expect((await s.update({ vaultFolder: `${vault}/` })).vaultFolder).toBe(vault);
    expect(JSON.parse(readFileSync(file, 'utf8')).vaultFolder).toBe(vault);

    for (const bad of ['notes', 'Team/notes', '~other/notes', 'a\nb', 7]) {
      expect(() => s.update({ vaultFolder: bad }), String(bad)).toThrow('The Vault folder is a full path');
    }
    await expect(s.update({ vaultFolder: join(dir, 'missing') })).rejects.toThrow(`Not a directory: ${join(dir, 'missing')}`);
    writeFileSync(join(dir, 'a-file'), '');
    await expect(s.update({ vaultFolder: join(dir, 'a-file') })).rejects.toThrow('Not a directory');
    expect(s.get().vaultFolder).toBe(vault);

    // Empty, or null, clears it.
    expect((await s.update({ vaultFolder: '  ' })).vaultFolder).toBeNull();
    expect((await new SettingsStore(file).load()).vaultFolder).toBeNull();
  });

  it('PEOPLE-2.2: an entry the rule refuses is refused whole, with its words, and the saved list stays', async () => {
    const s = await store();
    await s.update({ vaultFolder: dir, privateFolders: ['Team/*/Reviews', ' Team/360 * ', 'Team/*/Reviews/'] });
    expect(s.get().privateFolders).toEqual(['Team/*/Reviews', 'Team/360 *']);

    for (const bad of [[''], ['Team//Reviews'], ['Team/../x'], ['./Team'], ['Team/**'], ['a\nb'], ['x'.repeat(301)], [7], 'Team']) {
      expect(() => s.update({ privateFolders: bad }), JSON.stringify(bad).slice(0, 30)).toThrow(bad === 'Team' ? 'Private folders must be a list.' : PRIVATE_FOLDER_ERROR);
    }
    await expect(s.update({ privateFolders: Array.from({ length: 51 }, (_, n) => `Team/${n}`) })).rejects.toMatchObject({ field: 'privateFolders', message: 'At most 50 Private folders.' });
    expect((await s.update({ privateFolders: Array.from({ length: 50 }, (_, n) => `Team/${n}`) })).privateFolders).toHaveLength(50);
    await s.update({ privateFolders: ['Team/*/Reviews', 'Team/360 *'] });
    // A full path that names no folder outright would hide everything.
    for (const all of [['/*'], ['~/*'], ['/*/*']]) expect(() => s.update({ privateFolders: all }), all[0]).toThrow(PRIVATE_FOLDER_ERROR);
    expect(s.get().privateFolders).toEqual(['Team/*/Reviews', 'Team/360 *']);
  });

  it('PEOPLE-2.2: a path inside the Vault needs the Vault folder: refused with none set, and the Vault folder cannot be cleared under one', async () => {
    const s = await store();
    await expect(s.update({ privateFolders: ['Team/Reviews'] })).rejects.toMatchObject({ field: 'privateFolders', message: PRIVATE_NEEDS_VAULT });
    // A full path needs no Vault.
    expect((await s.update({ privateFolders: ['~/notes/private', '/srv/private'] })).privateFolders).toEqual(['~/notes/private', '/srv/private']);

    await s.update({ vaultFolder: dir, privateFolders: ['Team/Reviews', '/srv/private'] });
    await expect(s.update({ vaultFolder: null })).rejects.toMatchObject({ field: 'vaultFolder', message: VAULT_HAS_PRIVATE });
    expect(s.get()).toMatchObject({ vaultFolder: dir, privateFolders: ['Team/Reviews', '/srv/private'] });
    // Both in one change: the list no longer holds a path inside it.
    expect(await s.update({ vaultFolder: null, privateFolders: ['/srv/private'] })).toMatchObject({ vaultFolder: null, privateFolders: ['/srv/private'] });
  });

  it('PEOPLE-2.10: a settings file edited by hand keeps every entry it can read: a bad one is left out alone, and a list over 50 is kept whole, to shrink in Settings and never grow', async () => {
    writeFileSync(join(dir, 'by-hand.json'), JSON.stringify({ vaultFolder: dir, privateFolders: ['Team/*/Reviews', 'Team/../oops', 7, '/srv/private', 'Team/*/Reviews'] }));
    const s = new SettingsStore(join(dir, 'by-hand.json'));
    expect((await s.load()).privateFolders).toEqual(['Team/*/Reviews', '/srv/private']);

    const many = Array.from({ length: 53 }, (_, n) => `Team/${n}`);
    writeFileSync(join(dir, 'long.json'), JSON.stringify({ vaultFolder: dir, privateFolders: many }));
    const long = new SettingsStore(join(dir, 'long.json'));
    expect((await long.load()).privateFolders).toEqual(many);
    await expect(long.update({ privateFolders: [...many, 'Team/one-more'] })).rejects.toThrow('At most 50 Private folders.');
    expect((await long.update({ privateFolders: many.slice(1) })).privateFolders).toHaveLength(52);
    await expect(long.update({ privateFolders: many })).rejects.toThrow('At most 50 Private folders.');
  });

  it("PEOPLE-2.10: a settings file that can't be read leaves the defaults, and its text is kept beside it when a setting is next saved, never written over", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const path = join(dir, 'broken.json');
      const typed = `{ "vaultFolder": "${dir}", "privateFolders": ["Team/*/Reviews"], }\n`; // a comma too many
      writeFileSync(path, typed);
      const s = new SettingsStore(path);
      expect((await s.load()).privateFolders).toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("can't be read as settings"));
      expect(existsSync(`${path}.unreadable`)).toBe(false);

      await s.update({ idleThresholdHours: 6 });
      expect(readFileSync(`${path}.unreadable`, 'utf8')).toBe(typed);
      expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ idleThresholdHours: 6 });
      // Once: the next save has nothing unreadable to keep.
      writeFileSync(`${path}.unreadable`, 'kept');
      await s.update({ idleThresholdHours: 7 });
      expect(readFileSync(`${path}.unreadable`, 'utf8')).toBe('kept');

      // A file that isn't there is no trouble, and neither is one that reads.
      warn.mockClear();
      await new SettingsStore(join(dir, 'none.json')).load();
      await new SettingsStore(path).load();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
