import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, isAbsolute, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { isPlainPath } from './files.ts';

/** LIB-3.3: applies even to errors and to SVG, which can contain scripts. Never allow-same-origin. */
export const OUTPUT_HEADERS = {
  'content-security-policy': 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};
const MEDIA: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.pdf': 'application/pdf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};
/** The server's capabilities, learned only from outputs answers, oldest out at 10,000. */
export class OutputFiles {
  private readonly paths = new Set<string>();
  allow(path: string): void {
    if (!isAbsolute(path) || !isPlainPath(path)) return;
    this.paths.add(normalize(path));
    if (this.paths.size > 10_000) this.paths.delete(this.paths.values().next().value!);
  }
  async serve(path: string, res: ServerResponse): Promise<void> {
    for (const [k, v] of Object.entries(OUTPUT_HEADERS)) res.setHeader(k, v);
    const fail = (status: number, message: string) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }); res.end(message); };
    const normalized = normalize(path), type = MEDIA[extname(normalized).toLowerCase()];
    if (!isPlainPath(path) || !isAbsolute(path) || !this.paths.has(normalized) || !type) return fail(404, 'This file is not available.');
    path = normalized;
    // lstat excludes a leaf symlink; NOFOLLOW closes the race with open. NONBLOCK prevents a
    // swapped-in FIFO from hanging the server before the open handle can be checked.
    const info = await lstat(path).catch(() => null);
    if (!info?.isFile()) return fail(404, 'This file no longer exists.');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
    if (!handle) return fail(404, 'This file could not be opened.');
    const opened = await handle.stat().catch(() => null);
    if (!opened?.isFile()) { await handle.close(); return fail(404, 'This file is not a regular file.'); }
    res.writeHead(200, { 'content-type': type, 'content-length': opened.size });
    await pipeline(handle.createReadStream(), res).catch(() => res.destroy());
  }
}
