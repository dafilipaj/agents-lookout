import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { type Server, createServer, get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveStatic } from './static.ts';

let root: string;
let server: Server;
let port: number;

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lookout-static-')));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Lookout</title>');
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(root, 'assets', 'big.js'), Buffer.alloc(32 * 1024 * 1024, 97));
  server = createServer((req, res) => void serveStatic(root, new URL(req.url!, 'http://x').pathname, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  rmSync(root, { recursive: true, force: true });
});

const fetchText = (path: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    }).on('error', reject);
  });

/** Files under the test root this process holds open (lsof). */
function openFilesUnderRoot(): string[] {
  try {
    return execFileSync('lsof', ['-p', String(process.pid), '-Fn'], { encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.startsWith('n') && l.includes(root))
      .map((l) => l.slice(1));
  } catch {
    return [];
  }
}

describe('serving the built UI', () => {
  it('serves files, and index.html for unknown paths and paths outside the root', async () => {
    expect(await fetchText('/assets/app.js')).toEqual({ status: 200, body: 'console.log(1)' });
    expect((await fetchText('/s/some-session')).body).toContain('<title>Lookout</title>');
    expect((await fetchText('/../../etc/passwd')).body).toContain('<title>Lookout</title>');
  });

  it('falls back to index.html when an asset is gone (e.g. mid-build), instead of crashing', async () => {
    expect((await fetchText('/assets/deleted-during-build.js')).body).toContain('<title>Lookout</title>');
  });

  it('closes the file when the client aborts a download', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = get({ host: '127.0.0.1', port, path: '/assets/big.js' }, (res) => {
        res.once('data', () => {
          req.destroy();
          resolve();
        });
      });
      req.on('error', (e) => (e.message.includes('aborted') || e.message.includes('socket hang up') ? undefined : reject(e)));
    });
    await expect.poll(openFilesUnderRoot, { timeout: 2000 }).toEqual([]);
    // And the server keeps serving.
    expect((await fetchText('/assets/app.js')).status).toBe(200);
  });
});
