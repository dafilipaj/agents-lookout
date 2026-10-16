/**
 * Lookout's settings, stored by the server (SIDE-7, LAUNCH-2). Each field has a default and a
 * parser; a feature adds its fields here.
 */
export interface Settings {
  /** SIDE-3.5: an Idle Session is dimmed after this many hours. */
  idleThresholdHours: number;
  /** LAUNCH-2: where new Sessions can start. `~` stands for the home directory. */
  startDirectories: string[];
  /** LAUNCH-1.2: the choices of the last successful start. Written by the server only. */
  lastLaunch: LastLaunch | null;
}

export type LaunchHarness = 'claude' | 'codex';

export interface LastLaunch {
  harness: LaunchHarness;
  /** Model id; '' is the Harness's own default. */
  model: string;
  directory: string;
}

export class SettingsError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.field = field;
  }
}

interface Field<T> {
  default: T;
  /** False for fields only the server writes (clients can't PUT them). */
  clientWritable?: boolean;
  /** Returns the parsed value, or throws a SettingsError. */
  parse(value: unknown, field: string): T;
}

const MAX_IDLE_HOURS = 24 * 30;
const MAX_START_DIRS = 50;
const MODEL_ID = /^[A-Za-z0-9._[\]/:-]{0,100}$/;

/** A start directory: absolute, or under `~`; one line. */
export function parseStartDirectory(value: unknown, field = 'startDirectories'): string {
  const dir = typeof value === 'string' ? value.trim().replace(/(.)\/+$/, '$1') : '';
  if (!dir || dir.length > 1024 || /[\0\n\r]/.test(dir) || !(dir === '~' || dir.startsWith('~/') || dir.startsWith('/'))) {
    throw new SettingsError(field, 'A start directory is a full path, such as ~/Projects/work or /Users/me/code.');
  }
  return dir;
}

const fields: { [K in keyof Settings]: Field<Settings[K]> } = {
  idleThresholdHours: {
    default: 4,
    parse(value, field) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_IDLE_HOURS) {
        throw new SettingsError(field, `Idle threshold must be a number of hours above 0 and at most ${MAX_IDLE_HOURS}.`);
      }
      return value;
    },
  },
  startDirectories: {
    default: ['~/Projects/work'],
    parse(value, field) {
      if (!Array.isArray(value)) throw new SettingsError(field, 'Start directories must be a list.');
      const dirs = [...new Set(value.map((v) => parseStartDirectory(v, field)))];
      if (dirs.length === 0) throw new SettingsError(field, 'Keep at least one start directory.');
      if (dirs.length > MAX_START_DIRS) throw new SettingsError(field, `At most ${MAX_START_DIRS} start directories.`);
      return dirs;
    },
  },
  lastLaunch: {
    default: null,
    clientWritable: false,
    parse(value, field) {
      if (value === null) return null;
      const v = isRecord(value) ? value : {};
      if (
        (v.harness !== 'claude' && v.harness !== 'codex') ||
        typeof v.model !== 'string' ||
        !MODEL_ID.test(v.model) ||
        typeof v.directory !== 'string'
      ) {
        throw new SettingsError(field, 'Invalid last launch.');
      }
      return { harness: v.harness, model: v.model, directory: parseStartDirectory(v.directory, field) };
    },
  },
};

const keys = Object.keys(fields) as (keyof Settings)[];

export function defaultSettings(): Settings {
  return structuredClone(Object.fromEntries(keys.map((k) => [k, fields[k].default]))) as unknown as Settings;
}

/** Reads settings from untrusted stored JSON: invalid or missing fields fall back to defaults. */
export function settingsFromStored(raw: unknown): Settings {
  const out = defaultSettings() as unknown as Record<string, unknown>;
  if (!isRecord(raw)) return out as unknown as Settings;
  for (const k of keys) {
    if (!(k in raw)) continue;
    try {
      out[k] = fields[k].parse(raw[k], k);
    } catch {
      // keep the default
    }
  }
  return out as unknown as Settings;
}

/**
 * Validates a partial update. Unknown keys, and server-only keys from a client, are rejected;
 * throws SettingsError.
 */
export function parseSettingsPatch(raw: unknown, from: 'client' | 'server' = 'client'): Partial<Settings> {
  if (!isRecord(raw)) throw new SettingsError('', 'Settings must be a JSON object.');
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!(keys as string[]).includes(k)) throw new SettingsError(k, `Unknown setting: ${k}`);
    if (from === 'client' && fields[k as keyof Settings].clientWritable === false) {
      throw new SettingsError(k, `${k} can't be changed here.`);
    }
    out[k] = fields[k as keyof Settings].parse(v, k);
  }
  return out as Partial<Settings>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
