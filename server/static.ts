import { type FileHandle, open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serves the built UI. Unknown paths get index.html, so client routes survive a reload. */
export async function serveStatic(root: string, urlPath: string, res: ServerResponse): Promise<void> {
  let rel: string;
  try {
    rel = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  } catch {
    rel = '';
  }
  let file = join(root, rel);
  if (file !== root && !file.startsWith(root + sep)) file = join(root, 'index.html');

  // Open first and stat the open handle: a file deleted in between (e.g. during `pnpm build`)
  // then simply falls through to index.html or a 404, instead of failing mid-stream.
  let opened = await openFile(file);
  if (!opened) {
    file = join(root, 'index.html');
    opened = await openFile(file);
  }
  if (!opened) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('The UI is not built. Run `pnpm build`, or use `pnpm dev`.\n');
    return;
  }
  const { handle, size } = opened;
  const isAsset = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': size,
    'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  // pipeline destroys the source (closing the handle) when the client aborts or a read fails.
  await pipeline(handle.createReadStream(), res).catch(() => {
    res.destroy();
  });
}

async function openFile(file: string): Promise<{ handle: FileHandle; size: number } | null> {
  let handle: FileHandle;
  try {
    handle = await open(file, 'r');
  } catch {
    return null;
  }
  try {
    const info = await handle.stat();
    if (info.isFile()) return { handle, size: info.size };
  } catch {
    // fall through
  }
  await handle.close().catch(() => {});
  return null;
}
