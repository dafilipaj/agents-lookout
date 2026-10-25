import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
