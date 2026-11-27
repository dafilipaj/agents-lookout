import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, isAbsolute, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { OutputType } from '../shared/library.ts';
import { documentType } from './documents.ts';
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
  /** A listed path, normalized; null for one that isn't plain, absolute and listed. */
  private listed(path: string): string | null {
    if (!isAbsolute(path) || !isPlainPath(path)) return null;
    const normalized = normalize(path);
    return this.paths.has(normalized) ? normalized : null;
  }
  /** DOC-3.3: whether a path could be listed at all: plain, absolute and a document's by extension. */
  couldList(path: string): boolean {
    return isAbsolute(path) && isPlainPath(path) && documentType(path) !== null;
  }
  /** DOC-3.1: a listed document's Type and whether it's still a file; null for any other path, and nothing else about it. */
  async describe(path: string): Promise<{ path: string; type: OutputType; exists: boolean } | null> {
    const file = this.listed(path), type = file === null ? null : documentType(file);
    if (file === null || type === null) return null;
    const info = await lstat(file).catch(() => null);
    return { path: file, type, exists: !!info?.isFile() };
  }
  /** DOC-3.2: a listed Markdown file's text, at most `max` bytes of it; null for anything else. */
  async text(path: string, max: number): Promise<{ body: Buffer; truncated: boolean } | null> {
    const file = this.listed(path);
    return file === null || extname(file).toLowerCase() !== '.md' ? null : readTextFile(file, max);
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

/**
 * INBOX-2.4, DOC-3.2: a file's first `max` bytes, and whether it was cut. As the file route: lstat
 * leaves out a leaf symlink, NOFOLLOW closes the race with open, and NONBLOCK keeps a swapped-in
 * FIFO from hanging the server before the handle is checked. Null for anything that isn't a file.
 */
export async function readTextFile(file: string, max: number): Promise<{ body: Buffer; truncated: boolean } | null> {
  const info = await lstat(file).catch(() => null);
  if (!info?.isFile()) return null;
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
  if (!handle) return null;
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) return null;
    const buffer = Buffer.alloc(Math.min(opened.size, max));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const truncated = opened.size > max;
    return { body: truncated ? wholeCharacters(buffer.subarray(0, bytesRead)) : buffer.subarray(0, bytesRead), truncated };
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** INBOX-2.4: a cut that split a character drops it, so the text ends on a whole one. */
function wholeCharacters(bytes: Buffer): Buffer {
  let lead = bytes.length - 1;
  while (lead >= 0 && bytes.length - lead < 4 && (bytes[lead]! & 0xc0) === 0x80) lead--;
  if (lead < 0) return bytes;
  const first = bytes[lead]!;
  const length = first >= 0xf0 ? 4 : first >= 0xe0 ? 3 : first >= 0xc0 ? 2 : 1;
  return bytes.length - lead < length ? bytes.subarray(0, lead) : bytes;
}
