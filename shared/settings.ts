import { EFFORT_LEVEL } from './model.ts';
import { MAX_PRIVATE_FOLDERS, PRIVATE_FOLDER_ERROR, isFullPath, parsePrivateFolder } from './private-folders.ts';

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
  /** WORK-2: whose Tasks Work reads; null until one is saved (WORK-2.6). */
  productiveEmail: string | null;
  /** TOPIC-9.3: Jev judges new items Links can't tie to a Topic; each ask is billed, so off by default. */
  recommendWithJev: boolean;
  /** VIEW-3.9, SIDE-7.7: a sent message waits 3 s in the composer, so it can be taken back. */
  undoSend: boolean;
  /** PEOPLE-1: where the Vault is, as typed (`~` kept); null until one is set. */
  vaultFolder: string | null;
  /** PEOPLE-2: folders whose files Lookout never lists or shows: paths inside the Vault folder, or full paths. */
  privateFolders: string[];
  /** PEOPLE-3.2: the folder inside the Vault folder that holds a folder per Person. */
  peopleFolder: string;
}

/**
 * What the server sends as settings: the stored ones, plus what it never stores (WORK-2.5):
 * `git config --global user.email` as a suggestion for the Productive email, null when git has none.
 */
export interface SettingsView extends Settings {
  productiveEmailSuggestion: string | null;
}

export type LaunchHarness = 'claude' | 'codex';

export interface LaunchChoices {
  effort: string | null;
  skipPermissions: boolean;
}

export interface LastLaunch {
  harness: LaunchHarness;
  /** Model id; '' is the Harness's own default. */
  model: string;
  directory: string;
  /** LAUNCH-3.4, 3.5: absent entries mean the Harness has not been started yet. */
  byHarness?: Partial<Record<LaunchHarness, LaunchChoices>>;
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
  /** Reads a stored value when one bad part mustn't cost the rest; `parse` when absent. */
  stored?(value: unknown): T;
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

/** WORK-2.7: why a Productive email is refused. */
export const PRODUCTIVE_EMAIL_ERROR = 'Enter an email such as name@example.com';
const MAX_EMAIL = 254;

/**
 * WORK-2.7: a Productive email, trimmed, otherwise as typed. Empty (or null) clears it. Refused with
 * whitespace or a comma inside, without exactly one `@` with text on both sides, or longer than 254
 * characters. The comma as a precaution: tb-prod sends a filter value holding one exactly as it
 * sends a list of values, which it joins with commas, so `x,colleague@example.com` can't be told
 * from two people; Productive keeps it whole today, but wouldn't if either side changed (Sources).
 * Every other character tb-prod percent-encodes, so it can't change the query.
 */
export function parseProductiveEmail(value: unknown, field = 'productiveEmail'): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new SettingsError(field, PRODUCTIVE_EMAIL_ERROR);
  const email = value.trim();
  if (email === '') return null;
  const parts = email.split('@');
  if (/[\s,]/.test(email) || parts.length !== 2 || !parts[0] || !parts[1] || [...email].length > MAX_EMAIL) {
    throw new SettingsError(field, PRODUCTIVE_EMAIL_ERROR);
  }
  return email;
}

/** PEOPLE-1.2: the Vault folder, a full path as a Start directory is; empty (or null) clears it. */
export function parseVaultFolder(value: unknown, field = 'vaultFolder'): string | null {
  if (value === null || (typeof value === 'string' && value.trim() === '')) return null;
  try {
    return parseStartDirectory(value, field);
  } catch {
    throw new SettingsError(field, 'The Vault folder is a full path, such as ~/Documents/notes or /Users/me/notes.');
  }
}

/**
 * PEOPLE-2.1, 2.2: the list of Private folders, each entry as parsePrivateFolder leaves it, without
 * repeats. How long it may be is checked against the saved list (checkVaultSettings).
 */
export function parsePrivateFolders(value: unknown, field = 'privateFolders'): string[] {
  if (!Array.isArray(value)) throw new SettingsError(field, 'Private folders must be a list.');
  const entries = value.map((v) => {
    const entry = parsePrivateFolder(v);
    if (entry === null) throw new SettingsError(field, PRIVATE_FOLDER_ERROR);
    return entry;
  });
  return [...new Set(entries)];
}

/** PEOPLE-3.2: the people folder until one is saved, and what an empty field goes back to. */
export const DEFAULT_PEOPLE_FOLDER = 'Team';
/** PEOPLE-3.2: why a people folder is refused. */
export const PEOPLE_FOLDER_ERROR = 'The People folder is a folder inside the Vault, such as Team or Work/Team.';
const MAX_PEOPLE_FOLDER = 300;

/**
 * PEOPLE-3.2: the people folder, a path inside the Vault folder, as typed but for the slashes at its
 * end. Empty (or null) is the default again. Refused: a full path, more than one line, a `*`, and an
 * empty, `.` or `..` part, which could name a folder outside the Vault.
 */
export function parsePeopleFolder(value: unknown, field = 'peopleFolder'): string {
  if (value === null || (typeof value === 'string' && value.trim() === '')) return DEFAULT_PEOPLE_FOLDER;
  if (typeof value !== 'string') throw new SettingsError(field, PEOPLE_FOLDER_ERROR);
  const folder = value.trim().replace(/\/+$/, '');
  if (folder.length > MAX_PEOPLE_FOLDER || /[\0\n\r*]/.test(folder) || folder.startsWith('/') || folder.startsWith('~') || folder.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new SettingsError(field, PEOPLE_FOLDER_ERROR);
  }
  return folder;
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
      const byHarness: LastLaunch['byHarness'] = {};
      if (v.byHarness !== undefined) {
        if (!isRecord(v.byHarness)) throw new SettingsError(field, 'Invalid last launch choices.');
        for (const harness of ['claude', 'codex'] as const) {
          const choice = v.byHarness[harness];
          if (choice === undefined) continue;
          if (!isRecord(choice) || (choice.effort !== null && (typeof choice.effort !== 'string' || !EFFORT_LEVEL.test(choice.effort))) || typeof choice.skipPermissions !== 'boolean') {
            throw new SettingsError(field, 'Invalid last launch choices.');
          }
          byHarness[harness] = { effort: choice.effort as string | null, skipPermissions: choice.skipPermissions };
        }
      }
      return { harness: v.harness, model: v.model, directory: parseStartDirectory(v.directory, field), ...(v.byHarness === undefined ? {} : { byHarness }) };
    },
  },
  productiveEmail: {
    default: null,
    parse: parseProductiveEmail,
  },
  recommendWithJev: {
    default: false,
    parse(value, field) {
      if (typeof value !== 'boolean') throw new SettingsError(field, 'Recommend Topics with Jev is on or off.');
      return value;
    },
  },
  undoSend: {
    default: true,
    parse(value, field) {
      if (typeof value !== 'boolean') throw new SettingsError(field, 'Undo send is on or off.');
      return value;
    },
  },
  vaultFolder: {
    default: null,
    parse: parseVaultFolder,
  },
  privateFolders: {
    default: [],
    parse: parsePrivateFolders,
    // PEOPLE-2.10: a file edited by hand keeps every entry it can read: a bad one costs only itself, and a
    // list over the limit isn't cut, since either would show files that were private.
    stored(value) {
      if (!Array.isArray(value)) return [];
      return [...new Set(value.map(parsePrivateFolder).filter((e): e is string => e !== null))];
    },
  },  peopleFolder: {
    default: DEFAULT_PEOPLE_FOLDER,
    parse: parsePeopleFolder,
  },
};

/** PEOPLE-2.2: a path inside the Vault needs a Vault folder. */
export const PRIVATE_NEEDS_VAULT = 'Set the Vault folder first, or give a full path.';
/** PEOPLE-2.2: the Vault folder can't be cleared under a Private folder that is a path inside it. */
export const VAULT_HAS_PRIVATE = 'Remove the Private folders inside it first.';

/**
 * PEOPLE-2.2: what a change would leave is refused when a Private folder is a path inside the Vault
 * and there is no Vault folder: such an entry would hide nothing while reading as if it did. And
 * PEOPLE-2.1: the list is at most 50 long; one already longer (a file edited by hand, PEOPLE-2.10)
 * may shrink, never grow.
 */
export function checkVaultSettings(next: Pick<Settings, 'vaultFolder' | 'privateFolders'>, patch: Partial<Settings>, saved: Pick<Settings, 'privateFolders'>): void {
  if (patch.privateFolders !== undefined && next.privateFolders.length > Math.max(MAX_PRIVATE_FOLDERS, saved.privateFolders.length)) {
    throw new SettingsError('privateFolders', `At most ${MAX_PRIVATE_FOLDERS} Private folders.`);
  }
  if (next.vaultFolder !== null || next.privateFolders.every(isFullPath)) return;
  if (patch.privateFolders !== undefined) throw new SettingsError('privateFolders', PRIVATE_NEEDS_VAULT);
  throw new SettingsError('vaultFolder', VAULT_HAS_PRIVATE);
}

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
      const field = fields[k] as Field<unknown>;
      out[k] = field.stored ? field.stored(raw[k]) : field.parse(raw[k], k);
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
