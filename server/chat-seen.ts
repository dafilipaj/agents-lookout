import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** VIEW-13.1: a record not used for this long goes. */
export const CHAT_SEEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** A Session's id as the chat knows it: a session id, or `<harness>:<pid>` before it has one. */
const SESSION = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const MAX_CURSOR = 512;

/** VIEW-13.1: the last entry of a Session's chat you saw. */
export interface ChatSeenRecord {
  cursor: string;
  /** Its time, ms since epoch; null when it has none. */
  at: number | null;
}

interface Stored extends ChatSeenRecord {
  /** When the record was last read or written, for the 30 days. */
  used: number;
}

interface Store {
  v: 1;
  sessions: Record<string, Stored>;
}

export class ChatSeenError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * VIEW-13.1: what you saw of each Session's chat when you last left it, in
 * `~/.lookout/chat-seen.json` (mode 0600), read once and written whole to a new file that is then
 * moved over the old one. Saves are queued, so a later one never loses to an earlier.
 */
export class ChatSeen {
  private readonly file: string;
  private readonly now: () => number;
  private store: Promise<Store> | null = null;
  /** Set when the file couldn't be read: nothing is written over it. */
  private readOnly = false;
  private saving: Promise<void> = Promise.resolve();

  constructor(opts: { file?: string; now?: () => number } = {}) {
    this.file = opts.file ?? join(homedir(), '.lookout', 'chat-seen.json');
    this.now = opts.now ?? Date.now;
  }

  async get(session: unknown): Promise<ChatSeenRecord | null> {
    const id = sessionOf(session);
    const store = await this.load();
    const rec = Object.hasOwn(store.sessions, id) ? store.sessions[id] : undefined;
    if (!rec) return null;
    rec.used = this.now();
    void this.save().catch(() => {});
    return { cursor: rec.cursor, at: rec.at };
  }

  async set(session: unknown, cursor: unknown, at: unknown): Promise<void> {
    const id = sessionOf(session);
    if (typeof cursor !== 'string' || !cursor || cursor.length > MAX_CURSOR) throw new ChatSeenError(400, 'Expected { session, cursor, at }.');
    if (at !== null && (typeof at !== 'number' || !Number.isFinite(at))) throw new ChatSeenError(400, 'Expected { session, cursor, at }.');
    const store = await this.load();
    store.sessions[id] = { cursor, at, used: this.now() };
    await this.save();
  }

  private load(): Promise<Store> {
    this.store ??= this.read();
    return this.store.then((s) => this.prune(s));
  }

  private async read(): Promise<Store> {
    // No prototype: a Session id like `constructor` is just a key.
    const store: Store = { v: 1, sessions: Object.create(null) as Record<string, Stored> };
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as { v?: unknown; sessions?: unknown };
      if (raw?.v === 1 && raw.sessions && typeof raw.sessions === 'object') {
        for (const [id, r] of Object.entries(raw.sessions as Record<string, Partial<Stored>>)) {
          if (SESSION.test(id) && typeof r?.cursor === 'string' && (r.at === null || typeof r.at === 'number') && typeof r.used === 'number') {
            store.sessions[id] = { cursor: r.cursor, at: r.at, used: r.used };
          }
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return store; // none yet
      if (err instanceof SyntaxError) {
        // Not JSON (never half-written: saves replace it whole): kept aside, then started afresh.
        await rename(this.file, `${this.file}.broken`).catch(() => {
          this.readOnly = true;
        });
      } else this.readOnly = true; // unreadable now: start empty, but never write over what's there
    }
    return store;
  }

  private prune(store: Store): Store {
    const now = this.now();
    for (const [id, r] of Object.entries(store.sessions)) if (now - r.used > CHAT_SEEN_TTL_MS) delete store.sessions[id];
    return store;
  }

  private save(): Promise<void> {
    const next = this.saving.then(async () => {
      const store = await this.load();
      if (this.readOnly) return;
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify(store), { mode: 0o600 });
      await rename(tmp, this.file);
    });
    this.saving = next.catch(() => {});
    return next;
  }
}

function sessionOf(session: unknown): string {
  if (typeof session !== 'string' || !SESSION.test(session)) throw new ChatSeenError(400, 'Invalid session id.');
  return session;
}
