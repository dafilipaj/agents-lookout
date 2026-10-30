import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { githubLogin } from './work.ts';

/**
 * WORK-3.8, WORK-3.9: Review request authors' GitHub avatars, fetched by the server and kept under
 * `~/.lookout/avatars/` for a day, so the page loads them from its own origin (0012: the CSP stays
 * `img-src 'self' data:`) and GitHub sees one request per author a day, never one per page load.
 */

export const AVATAR_FRESH_MS = 24 * 60 * 60 * 1000;
export const AVATAR_FAILED_MS = 60 * 60 * 1000;
export const AVATAR_TIMEOUT_MS = 5000;
export const MAX_AVATAR_BYTES = 512 * 1024;

const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const EXTENSIONS = Object.entries(TYPES).map(([type, ext]) => ({ type, ext }));

export interface Avatar {
  type: string;
  body: Buffer;
}

export interface AvatarsOptions {
  directory: string;
  /** The logins Lookout may fetch: Review requests' authors in Work's last read. */
  allowed: () => Iterable<string>;
  fetch?: typeof fetch;
  now?: () => number;
}

export class Avatars {
  private readonly failed = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<Avatar | null>>();

  private readonly opts: AvatarsOptions;

  constructor(opts: AvatarsOptions) {
    this.opts = opts;
  }

  /** The avatar for `login`, or null: not a login, not a Review request's author, or none to be had. */
  async get(login: string): Promise<Avatar | null> {
    const name = githubLogin(login)?.toLowerCase();
    if (!name || !this.isAllowed(name)) return null;
    const kept = await this.kept(name);
    if (kept && this.now() - kept.at < AVATAR_FRESH_MS) return kept.avatar;
    if ((this.failed.get(name) ?? 0) > this.now()) return kept?.avatar ?? null;
    let pending = this.inFlight.get(name);
    if (!pending) {
      pending = this.fetchAndKeep(name).finally(() => this.inFlight.delete(name));
      this.inFlight.set(name, pending);
    }
    // A fetch that fails still serves the copy kept, however old: a face from yesterday beats initials.
    return (await pending) ?? kept?.avatar ?? null;
  }

  private isAllowed(name: string): boolean {
    for (const login of this.opts.allowed()) if (login.toLowerCase() === name) return true;
    return false;
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private async kept(name: string): Promise<{ avatar: Avatar; at: number } | null> {
    for (const { type, ext } of EXTENSIONS) {
      const file = join(this.opts.directory, `${name}.${ext}`);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) continue;
      const body = await readFile(file).catch(() => null);
      if (body) return { avatar: { type, body }, at: info.mtimeMs };
    }
    return null;
  }

  private async fetchAndKeep(name: string): Promise<Avatar | null> {
    try {
      const res = await (this.opts.fetch ?? fetch)(`https://github.com/${name}.png?size=64`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS),
      });
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      const ext = TYPES[type];
      const length = Number(res.headers.get('content-length') ?? 0);
      if (!res.ok || !ext || length > MAX_AVATAR_BYTES) throw new Error('not an avatar');
      const body = await readBounded(res);
      await this.keep(name, ext, body);
      this.failed.delete(name);
      return { type, body };
    } catch {
      this.failed.set(name, this.now() + AVATAR_FAILED_MS);
      return null;
    }
  }

  /** Written through a temporary name and a rename, so a reader never sees half a file; one type kept per login. */
  private async keep(name: string, ext: string, body: Buffer): Promise<void> {
    await mkdir(this.opts.directory, { recursive: true, mode: 0o700 });
    await chmod(this.opts.directory, 0o700);
    const part = join(this.opts.directory, `.${name}.${randomUUID()}.part`);
    try {
      await writeFile(part, body, { mode: 0o600, flag: 'wx' });
      await rename(part, join(this.opts.directory, `${name}.${ext}`));
    } finally {
      await unlink(part).catch(() => {});
    }
    for (const other of EXTENSIONS) if (other.ext !== ext) await unlink(join(this.opts.directory, `${name}.${other.ext}`)).catch(() => {});
  }
}

/** The body, refused once it passes the limit, whatever Content-Length said. */
async function readBounded(res: Response): Promise<Buffer> {
  if (!res.body) throw new Error('no body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > MAX_AVATAR_BYTES) throw new Error('too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
