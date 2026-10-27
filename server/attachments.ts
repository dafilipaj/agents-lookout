import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { link, lstat, mkdir, open, readdir, realpath, rmdir, unlink } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { MAX_ATTACHMENT_BYTES, safeName } from '../shared/attachments.ts';

export const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 14 * DAY_MS;
const { O_CREAT, O_DIRECTORY, O_EXCL, O_NOFOLLOW, O_RDONLY, O_WRONLY } = constants;

const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;

/**
 * VIEW-9.15, 9.17: a storage folder as it is right now: a folder, not a link, whose real path is
 * `real` (inside the attachments folder) and, given `was`, still the one checked before. Checked
 * right before each listing, write and deletion in it. Node has no `openat`/`unlinkat`, so a swap
 * after this check can't be ruled out (VIEW's Known gaps).
 */
async function folderAt(path: string, real: string, was?: Stats): Promise<Stats | null> {
  const info = await lstat(path).catch(() => null);
  if (!info?.isDirectory() || (was && !same(info, was))) return null;
  return (await realpath(path).catch(() => null)) === real ? info : null;
}

class Moved extends Error {
  constructor() { super('A storage folder moved'); }
}

export class AttachmentError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function localDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Browser-owned copies. No Harness, CLI, file contents or client destination is inspected. */
export class Attachments {
  readonly directory: string;
  constructor(directory: string) { this.directory = resolve(directory); }

  async save(name: string, body: AsyncIterable<Uint8Array>, length: number, now = new Date()): Promise<string> {
    let part: string | undefined;
    let destination: string | undefined;
    try {
      const root = await this.privateDirectory(this.directory);
      const day = join(this.directory, localDay(now));
      const folder = await this.privateDirectory(day, join(root.real, localDay(now)));
      const inFolder = async () => { if (!(await folderAt(day, folder.real, folder.info))) throw new Moved(); };
      await inFolder();
      part = join(day, `.${randomUUID()}.part`);
      // `wx` and no link followed: never an existing file, never through a link at its name.
      const file = await open(part, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600);
      try {
        // Before a byte is written: it was created in the day folder, not through one swapped since the check.
        if ((await realpath(part)) !== join(folder.real, basename(part))) throw new Moved();
        let size = 0;
        for await (const chunk of body) {
          size += chunk.byteLength;
          if (size > MAX_ATTACHMENT_BYTES) throw new AttachmentError(413, 'The file is over the 25 MB limit.');
          if (size > length) throw new AttachmentError(400, 'The file length did not match.');
          await file.writeFile(chunk);
        }
        if (size !== length) throw new AttachmentError(400, 'The file length did not match.');
      } finally { await file.close(); }
      for (let n = 1; ; n++) {
        const path = join(day, safeName(name, n));
        await inFolder();
        try { await link(part, path); destination = path; break; }
        catch (err) { if (code(err) !== 'EEXIST') throw err; }
      }
      await unlink(part);
      return destination;
    } catch (err) {
      if (destination) await unlink(destination).catch(() => {});
      if (err instanceof AttachmentError) throw err;
      throw new AttachmentError(code(err) === 'ENOSPC' ? 507 : 500,
        code(err) === 'ENOSPC' ? `The disk is full, so ${name} wasn't saved.` : `Lookout couldn't save ${name}.`);
    } finally {
      if (part) await unlink(part).catch(() => {});
    }
  }

  /**
   * `mkdir -p`, then made private through a handle that can't be a link (`O_NOFOLLOW`), checked to be
   * the folder at `real` (the attachments folder's own real path for the root itself).
   */
  private async privateDirectory(path: string, real?: string): Promise<{ info: Stats; real: string }> {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const handle = await open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    try {
      const info = await handle.stat();
      const at = real ?? await realpath(path);
      if (!(await folderAt(path, at, info))) throw new Moved();
      await handle.chmod(0o700);
      return { info, real: at };
    } finally { await handle.close(); }
  }

  async prune(now = new Date()): Promise<void> {
    let count = 0;
    let bytes = 0;
    const old = (info: Stats) => info.isFile() && now.getTime() - info.mtimeMs >= RETENTION_MS;
    try {
      const root = await lstat(this.directory).catch(() => null);
      if (!root?.isDirectory()) return;
      const rootReal = await realpath(this.directory);
      if (!(await folderAt(this.directory, rootReal, root))) return;
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - 14);
      for (const day of await readdir(this.directory, { withFileTypes: true })) {
        if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue;
        const folder = join(this.directory, day.name);
        const real = join(rootReal, day.name);
        try {
          // Right before listing it: a folder inside the attachments folder, not a link.
          const info = await folderAt(folder, real);
          if (!info) continue;
          for (const entry of await readdir(folder)) {
            try {
              const path = join(folder, entry);
              const seen = await lstat(path);
              if (!old(seen)) continue;
              // Right before deleting it: the same folder, and the same file, still regular and still old.
              if (!(await folderAt(folder, real, info))) break;
              const current = await lstat(path);
              if (!old(current) || !same(seen, current)) continue;
              await unlink(path);
              count++;
              bytes += current.size;
            } catch { /* Leave this entry for the next run. */ }
          }
          if (day.name <= localDay(cutoff) && await folderAt(folder, real, info)) await rmdir(folder).catch(() => {});
        } catch { /* Leave this folder for the next run. */ }
      }
    } catch { /* Missing, linked or unreadable storage: nothing to prune. */ }
    finally { console.info(`Pruned ${count} attachments, ${Math.round(bytes / (1024 * 1024))} MB`); }
  }
}

function code(err: unknown): unknown {
  return typeof err === 'object' && err !== null && 'code' in err ? err.code : null;
}
