import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { type Settings, SettingsError, checkVaultSettings, parseSettingsPatch, settingsFromStored } from '../shared/settings.ts';

/** `~` and `~/…` to absolute paths. */
export function expandHome(dir: string, home = homedir()): string {
  if (dir === '~') return home;
  if (dir.startsWith('~/')) return join(home, dir.slice(2));
  return dir;
}

export function defaultSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.LOOKOUT_SETTINGS) return env.LOOKOUT_SETTINGS;
  const configHome = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(configHome, 'lookout', 'settings.json');
}

/**
 * Settings stored in one JSON file (SIDE-7.2). Keys this version doesn't know are kept on
 * write, so an older and a newer Lookout can share the file.
 */
export class SettingsStore {
  private current: Settings = settingsFromStored({});
  private raw: Record<string, unknown> = {};
  private writing: Promise<unknown> = Promise.resolve();
  /** PEOPLE-2.10: the file is there and isn't settings Lookout can read: its text is kept beside it before a save writes over it. */
  private unreadable = false;
  private readonly listeners = new Set<(s: Settings) => void>();
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<Settings> {
    this.raw = {}; // missing or unreadable: defaults
    this.unreadable = false;
    const text = await readFile(this.path, 'utf8').catch(() => null);
    if (text !== null) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) this.raw = parsed as Record<string, unknown>;
        else this.unreadable = true;
      } catch {
        this.unreadable = true;
      }
      // A file edited by hand into something unreadable: said once, where a server's troubles are read.
      if (this.unreadable) console.warn(`lookout: settings: ${this.path} can't be read as settings, so every setting is at its default; its text is kept as ${basename(this.path)}.unreadable when a setting is next saved`);
    }
    this.current = settingsFromStored(this.raw);
    return this.current;
  }

  get(): Settings {
    return this.current;
  }

  onChange(fn: (s: Settings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Validates (throws SettingsError, or rejects with one for a start directory that doesn't
   * exist), writes atomically, then notifies listeners. `server` may write server-only fields.
   */
  update(patchInput: unknown, from: 'client' | 'server' = 'client'): Promise<Settings> {
    const patch = parseSettingsPatch(patchInput, from);
    const next = this.writing.then(async () => {
      if (patch.startDirectories) {
        const added = patch.startDirectories.filter((d) => !this.current.startDirectories.includes(d));
        for (const dir of added) {
          const info = await stat(expandHome(dir)).catch(() => null);
          if (!info?.isDirectory()) throw new SettingsError('startDirectories', `Not a directory: ${dir}`);
        }
      }
      // PEOPLE-1.2: a Vault folder that isn't a directory when it's saved is refused.
      if (patch.vaultFolder && patch.vaultFolder !== this.current.vaultFolder) {
        const info = await stat(expandHome(patch.vaultFolder)).catch(() => null);
        if (!info?.isDirectory()) throw new SettingsError('vaultFolder', `Not a directory: ${patch.vaultFolder}`);
      }
      // PEOPLE-2.2: checked against what the change leaves, inside the write queue, so two tabs can't slip past it together.
      if (patch.vaultFolder !== undefined || patch.privateFolders !== undefined) checkVaultSettings({ ...this.current, ...patch }, patch, this.current);
      // LAUNCH-3.4, 3.5: merge inside the write queue, so two tabs starting different
      // Harnesses together cannot overwrite each other's remembered choices.
      const lastLaunch = patch.lastLaunch && {
        ...patch.lastLaunch,
        byHarness: { ...this.current.lastLaunch?.byHarness, ...patch.lastLaunch.byHarness },
      };
      const raw = { ...this.raw, ...patch, ...(lastLaunch?.byHarness && Object.keys(lastLaunch.byHarness).length ? { lastLaunch } : {}), version: 1 };
      await mkdir(dirname(this.path), { recursive: true });
      // PEOPLE-2.10: what was typed into a file Lookout couldn't read (a list of Private folders, say) is never written over.
      if (this.unreadable) {
        await copyFile(this.path, `${this.path}.unreadable`).catch(() => undefined);
        this.unreadable = false;
      }
      const tmp = `${this.path}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(raw, null, 2) + '\n', { mode: 0o600 });
      await rename(tmp, this.path);
      this.raw = raw;
      this.current = settingsFromStored(raw);
      for (const fn of this.listeners) fn(this.current);
      return this.current;
    });
    this.writing = next.catch(() => undefined);
    return next;
  }
}
