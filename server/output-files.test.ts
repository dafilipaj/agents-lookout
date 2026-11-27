import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { afterEach, expect, it } from 'vitest';
import { OutputFiles, OUTPUT_HEADERS } from './output-files.ts';
import { guardRequest, localAllowLists } from './security.ts';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
async function serve(files: OutputFiles, path: string) {
  const chunks: Buffer[] = [];
  const socket = new Duplex({ read() {}, write(c, _e, done) { chunks.push(Buffer.from(c)); done(); } });
  const req = new IncomingMessage(socket as never); req.method = 'GET';
  const res = new ServerResponse(req); res.assignSocket(socket as never);
  await files.serve(path, res);
  return { text: Buffer.concat(chunks).toString(), res };
}
it('LIB-3.3: streams listed files with media types and opaque-origin sandbox on successes and errors, refusing siblings, traversal and leaf symlinks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lookout-outputs-')); roots.push(root);
  const files = new OutputFiles();
  for (const [ext, media] of [['html', 'text/html'], ['htm', 'text/html'], ['pdf', 'application/pdf'], ['svg', 'image/svg+xml'], ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'], ['webp', 'image/webp']]) {
    const p = join(root, `report.${ext}`); writeFileSync(p, '<script>window.ran = true</script>'); files.allow(p);
    const result = await serve(files, p);
    expect(result.res.statusCode).toBe(200);
    expect(result.res.getHeader('content-type')).toContain(media);
    expect(result.res.getHeader('content-security-policy')).toBe('sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox');
    expect(result.res.getHeader('x-content-type-options')).toBe('nosniff');
    expect(result.text).toContain('window.ran');
  }
  const target = join(root, 'report.html'), link = join(root, 'link.html'); symlinkSync(target, link); files.allow(link);
  const md = join(root, 'report.md'); writeFileSync(md, '# report'); files.allow(md);
  for (const p of [link, md, join(root, 'chart.js'), join(root, 'sub', '..', 'report.html') + '/..', target + '/bad', '/etc/passwd', 'relative.html']) {
    const result = await serve(files, p);
    expect(result.res.statusCode).not.toBe(200);
    for (const [k, v] of Object.entries(OUTPUT_HEADERS)) expect(result.res.getHeader(k)).toBe(v);
  }
  // The allowlist is bounded; an old capability expires, and an exact normalized name is required.
  for (let n = 0; n < 10001; n++) files.allow(`/tmp/synthetic-${n}.html`);
  expect((await serve(files, target)).res.statusCode).toBe(404);
});
it('LIB-3.3: opaque-origin pages cannot read the API or file route or mutate, even with the token; no-cors reads fail the fetch-site guard', () => {
  const guard = { ...localAllowLists(4747), token: 'secret' };
  for (const url of ['/api/bootstrap', '/api/events', '/api/library', '/api/settings', '/api/library/file?path=/a.html']) {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE']) {
      const req = { url, method, headers: { host: '127.0.0.1:4747', origin: 'null', 'x-lookout-token': 'secret' } } as unknown as IncomingMessage;
      expect(guardRequest(req, guard)).toMatchObject({ ok: false, status: 403 });
      delete req.headers.origin; req.headers['sec-fetch-site'] = 'cross-site';
      expect(guardRequest(req, guard)).toMatchObject({ ok: false, status: 403 });
    }
  }
});

it('PEOPLE-2.5: a private file is refused as a path never listed, by every route, one listed before its folder became private included', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lookout-outputs-')); roots.push(root);
  let closed = false;
  const files = new OutputFiles(async (p) => closed && p.startsWith(join(root, 'Reviews')));
  mkdirSync(join(root, 'Reviews'));
  const note = join(root, 'Reviews', 'q3.md'), page = join(root, 'Reviews', 'q3.html'), open = join(root, 'notes.md');
  writeFileSync(note, '# Review\n'); writeFileSync(page, '<h1>Review</h1>'); writeFileSync(open, '# Notes\n');
  for (const p of [note, page, open]) files.allow(p);
  // Listed, and not private yet: read as any listed file.
  expect(await files.describe(note)).toEqual({ path: note, type: 'markdown', exists: true });
  expect((await files.text(note, 1000))?.body.toString()).toBe('# Review\n');
  expect((await serve(files, page)).res.statusCode).toBe(200);

  closed = true;
  expect(await files.describe(note)).toBeNull();
  expect(await files.text(note, 1000)).toBeNull();
  const refused = await serve(files, page);
  expect(refused.res.statusCode).toBe(404);
  expect(refused.text).toContain('This file is not available.');
  expect(refused.text).not.toContain('Review</h1>');
  // The answer is the one an unlisted path gets, word for word.
  const unlisted = await serve(files, join(root, 'never-listed.html'));
  expect(refused.text.split('\r\n\r\n')[1]).toBe(unlisted.text.split('\r\n\r\n')[1]);
  // A file outside the folder is read as before.
  expect(await files.describe(open)).toEqual({ path: open, type: 'markdown', exists: true });
  expect((await files.text(open, 1000))?.body.toString()).toBe('# Notes\n');
});
