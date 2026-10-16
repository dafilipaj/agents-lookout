import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsError, defaultSettings } from '../shared/settings.ts';
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
    expect(await store.load()).toEqual({ idleThresholdHours: 4, startDirectories: ['~/Projects/work'], lastLaunch: null });
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
