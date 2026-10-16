import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { type Server, createServer, get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/** A read stream that sends one chunk, then fails like a disk error mid-file. */
function failingStream(): Readable {
  let sent = false;
  return new Readable({
    read() {
      if (!sent) {
        sent = true;
        this.push(Buffer.alloc(64 * 1024, 97));
      } else {
        this.destroy(Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO' }));
      }
    },
  });
}

const isBroken = (p: unknown) => String(p).includes('broken');

// Every way a file can be streamed fails for files named `broken*`.
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, createReadStream: (p: string, o?: unknown) => (isBroken(p) ? failingStream() : fs.createReadStream(p, o as never)) };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const fsp = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...fsp,
    open: async (p: string, flags?: string) => {
      const handle = await fsp.open(p, flags);
      if (!isBroken(p)) return handle;
      return Object.assign(Object.create(Object.getPrototypeOf(handle)), handle, {
        stat: () => handle.stat(),
        close: () => handle.close(),
        createReadStream: () => failingStream().on('close', () => void handle.close().catch(() => {})),
      });
    },
  };
});

const { serveStatic } = await import('./static.ts');

let root: string;
let server: Server;
let port: number;

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lookout-static-err-')));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Lookout</title>');
  writeFileSync(join(root, 'assets', 'broken.js'), Buffer.alloc(512 * 1024, 97));
  server = createServer((req, res) => void serveStatic(root, new URL(req.url!, 'http://x').pathname, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  rmSync(root, { recursive: true, force: true });
});

describe('serving the built UI when a read fails', () => {
  it('cuts the response off, and the server keeps running', async () => {
    const outcome = await new Promise<string>((resolve) => {
      get({ host: '127.0.0.1', port, path: '/assets/broken.js' }, (res) => {
        let bytes = 0;
        res.on('data', (c: Buffer) => (bytes += c.length));
        res.on('end', () => resolve(`ended after ${bytes}`));
        res.on('error', () => resolve('aborted'));
        res.on('close', () => resolve(res.complete ? `complete ${bytes}` : 'aborted'));
      }).on('error', () => resolve('aborted'));
    });
    expect(outcome).toBe('aborted'); // never a "complete" truncated file

    const next = await new Promise<number>((resolve, reject) => {
      get({ host: '127.0.0.1', port, path: '/' }, (res) => {
        res.resume();
        resolve(res.statusCode!);
      }).on('error', reject);
    });
    expect(next).toBe(200);
  });
});
