import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { type Settings, SettingsError, parseSettingsPatch, settingsFromStored } from '../shared/settings.ts';

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
  private readonly listeners = new Set<(s: Settings) => void>();
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<Settings> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      this.raw = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      this.raw = {}; // missing or unreadable: defaults
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
      const raw = { ...this.raw, ...patch, version: 1 };
      await mkdir(dirname(this.path), { recursive: true });
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
