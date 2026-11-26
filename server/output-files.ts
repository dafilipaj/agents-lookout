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
/**
 * INBOX-2.9: the same sandbox for a Report shown in place (`frame=1`), and only Lookout's own page
 * may frame it. It carries no `X-Frame-Options`.
 */
export const FRAMED_OUTPUT_CSP = `${OUTPUT_HEADERS['content-security-policy']}; frame-ancestors 'self'`;
/**
 * INBOX-2.9: sent after a framed page's own bytes. A link or a form that names no target opens as
 * an ordinary tab; without it a plain link would replace the Report inside its frame. Browsers take
 * the first `base` with a target wherever it stands, so a page that sets its own keeps it.
 */
export const FRAMED_HTML_TAIL = Buffer.from('\n<base target="_blank">\n');
const MEDIA: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.pdf': 'application/pdf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};
/** LIB-3.3: the paths the server's Library reads listed (file Outputs and Artifact sources), oldest out at 10,000. */
export class OutputFiles {
  private readonly paths = new Set<string>();
  allow(path: string): void {
    if (!isAbsolute(path) || !isPlainPath(path)) return;
    this.paths.add(normalize(path));
    if (this.paths.size > 10_000) this.paths.delete(this.paths.values().next().value!);
  }
  /** `framed`: the answer is for a Report's frame in Lookout's own page (INBOX-2.9). */
  async serve(path: string, res: ServerResponse, framed = false): Promise<void> {
    for (const [k, v] of Object.entries(OUTPUT_HEADERS)) res.setHeader(k, v);
    if (framed) res.setHeader('content-security-policy', FRAMED_OUTPUT_CSP);
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
    // INBOX-2.9: a page shown in a Report's frame gets its links a tab of their own.
    const tail = framed && type.startsWith('text/html') ? FRAMED_HTML_TAIL : null;
    res.writeHead(200, { 'content-type': type, 'content-length': opened.size + (tail?.length ?? 0) });
    if (!tail) return void (await pipeline(handle.createReadStream(), res).catch(() => res.destroy()));
    await pipeline(handle.createReadStream(), res, { end: false }).then(() => res.end(tail), () => res.destroy());
  }
}
