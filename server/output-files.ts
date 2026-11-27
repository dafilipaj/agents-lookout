import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { constants as osConstants } from 'node:os';
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
  /** PEOPLE-2.5: whether a path is private, asked at every read; a listed path that became private is refused as unlisted. */
  private readonly isPrivate: (path: string) => Promise<boolean>;
  constructor(isPrivate: (path: string) => Promise<boolean> = async () => false) {
    this.isPrivate = isPrivate;
  }
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
    if (file === null || type === null || (await this.isPrivate(file))) return null;
    const info = await lstat(file).catch(() => null);
    return { path: file, type, exists: !!info?.isFile() };
  }
  /** DOC-3.2: a listed Markdown file's text, at most `max` bytes of it; null for anything else. DOC-3.4: or why it can't be had right now. */
  async text(path: string, max: number): Promise<TextRead> {
    const file = this.listed(path);
    if (file === null || extname(file).toLowerCase() !== '.md' || (await this.isPrivate(file))) return null;
    const read = await readTextFile(file, max);
    // PEOPLE-2.5: a read that waited for a fetch can end after the folder became private: asked again before any of it is sent.
    return read !== null && (await this.isPrivate(file)) ? null : read;
  }
  /** `framed`: the answer is for a Report's frame in Lookout's own page (INBOX-2.9). */
  async serve(path: string, res: ServerResponse, framed = false): Promise<void> {
    for (const [k, v] of Object.entries(OUTPUT_HEADERS)) res.setHeader(k, v);
    if (framed) res.setHeader('content-security-policy', FRAMED_OUTPUT_CSP);
    const fail = (status: number, message: string) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }); res.end(message); };
    const normalized = normalize(path), type = MEDIA[extname(normalized).toLowerCase()];
    if (!isPlainPath(path) || !isAbsolute(path) || !this.paths.has(normalized) || !type || (await this.isPrivate(normalized))) return fail(404, 'This file is not available.');
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
 * DOC-3.4: why a file's text can't be had right now, though it is a file Lookout shows. `not-downloaded`:
 * kept in the cloud, and macOS wouldn't fetch it for this process; `slow`: no answer in time; `failed`:
 * the read failed, with the disk's code, and whether the file is one that isn't on this Mac.
 */
export type TextTrouble = { trouble: 'not-downloaded' } | { trouble: 'slow' } | { trouble: 'failed'; code: string; cloud: boolean };
/** A file's text and whether it was cut; why it can't be had right now; or null: not a file Lookout shows. */
export type TextRead = { body: Buffer; truncated: boolean } | TextTrouble | null;
/** DOC-3.4: how long a file's text may take; a file kept in the cloud is fetched by its read, which waits for it. */
export const TEXT_TIMEOUT_MS = 20_000;
/**
 * DOC-3.4: how many reads may be under way at once. A read that waits for a fetch holds one of the
 * server's four file threads until macOS ends it, so one thread is always left for everything else.
 */
export const MAX_PENDING_READS = 3;
/** The reads under way, by file and length: a second ask for the same file joins the first, so asking again never takes another thread. */
const pendingReads = new Map<string, Promise<TextRead>>();

/**
 * Whether a file is kept in the cloud and isn't on this Mac (iCloud Drive's "dataless" file): it has
 * a size and not one block of the disk. Reading such a file fetches it, so a list never reads one
 * for a title (0018: drawing a list downloads nothing). Node doesn't give the flag macOS keeps for
 * this, so it is told by its blocks: a sparse file is taken for one too, and keeps its basename.
 */
export const isCloudOnly = (stat: { size?: number; blocks?: number }): boolean => (stat.size ?? 0) > 0 && stat.blocks === 0;

/**
 * macOS's answer to reading a file kept in the cloud that it won't fetch for this process: a launchd
 * job is refused unless its plist sets `MaterializeDatalessFiles` (README, "Keep it running"). Node
 * has no name for the code, so it is told by its number.
 */
const isNotFetched = (err: unknown): boolean => {
  const { errno, code } = (err ?? {}) as NodeJS.ErrnoException;
  return errno === -osConstants.errno.EDEADLK || code === 'EDEADLK';
};

/**
 * INBOX-2.4, DOC-3.2: a file's first `max` bytes, and whether it was cut. As the file route: lstat
 * leaves out a leaf symlink, NOFOLLOW closes the race with open, and NONBLOCK keeps a swapped-in
 * FIFO from hanging the server before the handle is checked. Null for anything that isn't a file.
 * DOC-3.4: a file kept in the cloud is fetched by this read. One macOS won't fetch, one that hasn't
 * arrived in time and one whose read failed each say which.
 */
export async function readTextFile(file: string, max: number, opts: { open?: typeof open; timeoutMs?: number } = {}): Promise<TextRead> {
  const key = `${max}\n${file}`;
  let reading = pendingReads.get(key);
  if (!reading) {
    if (pendingReads.size >= MAX_PENDING_READS) return { trouble: 'slow' };
    const started: Promise<TextRead> = readNow(file, max, opts.open ?? open).finally(() => {
      if (pendingReads.get(key) === started) pendingReads.delete(key);
    });
    pendingReads.set(key, started);
    reading = started;
  }
  // The answer is given up after a while; the read itself ends when the disk lets it, and closes its handle then.
  let timer: NodeJS.Timeout | undefined;
  const slow = new Promise<TextTrouble>((resolve) => {
    timer = setTimeout(() => resolve({ trouble: 'slow' }), opts.timeoutMs ?? TEXT_TIMEOUT_MS);
  });
  return Promise.race([reading, slow]).finally(() => clearTimeout(timer));
}

/** One read of a file's text, from its lstat to its handle's close; it never rejects. */
async function readNow(file: string, max: number, openFile: typeof open): Promise<TextRead> {
  const info = await lstat(file).catch(() => null);
  if (!info?.isFile()) return null;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await openFile(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = await handle.stat();
    if (!opened.isFile()) return null;
    const buffer = Buffer.alloc(Math.min(opened.size, max));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const truncated = opened.size > max;
    return { body: truncated ? wholeCharacters(buffer.subarray(0, bytesRead)) : buffer.subarray(0, bytesRead), truncated };
  } catch (err) {
    if (isNotFetched(err)) return { trouble: 'not-downloaded' };
    const code = (err as NodeJS.ErrnoException | null)?.code;
    // Gone, or swapped for a link, since the lstat: not a file Lookout shows.
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') return null;
    // Any other failure of a listed file says so: with the network away, the fetch of a file kept in the cloud ends here.
    return { trouble: 'failed', code: typeof code === 'string' && /^E[A-Z0-9]+$/.test(code) ? code : '', cloud: isCloudOnly(info) };
  } finally {
    await handle?.close().catch(() => undefined);
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
