import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { OutputFiles, OUTPUT_HEADERS, type TextRead, isCloudOnly, readTextFile } from './output-files.ts';
import { guardRequest, localAllowLists } from './security.ts';

const roots: string[] = [];
/** A read that gave a file's text; anything else fails the test. */
const textOf = (read: TextRead) => {
  if (read === null || 'trouble' in read) throw new Error(`no text: ${JSON.stringify(read)}`);
  return read;
};
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
  expect(textOf(await files.text(note, 1000)).body.toString()).toBe('# Review\n');
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
  expect(textOf(await files.text(open, 1000)).body.toString()).toBe('# Notes\n');
});

it('DOC-3.4: a file kept in the cloud that macOS won’t fetch says so, a read that failed says what the disk said, and one that hasn’t arrived in time says that', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lookout-outputs-')); roots.push(root);
  const note = join(root, 'note.md'); writeFileSync(note, '# A note\n');
  const { open } = await import('node:fs/promises');
  const { errno } = (await import('node:os')).constants;
  // What macOS answers a launchd job for a file iCloud keeps only in the cloud: it opens, and the read fails with EDEADLK, which Node has no name for.
  const failing = (err: object): typeof open => async (...args) => {
    const handle = await open(...args);
    handle.read = (async () => { throw Object.assign(new Error('read failed'), err); }) as typeof handle.read;
    return handle;
  };
  const refusing = (err: object): typeof open => async () => { throw Object.assign(new Error('open failed'), err); };
  expect(await readTextFile(note, 1000, { open: failing({ errno: -errno.EDEADLK, code: `Unknown system error ${-errno.EDEADLK}`, syscall: 'read' }) })).toEqual({ trouble: 'not-downloaded' });
  expect(await readTextFile(note, 1000, { open: refusing({ errno: -errno.EDEADLK }) })).toEqual({ trouble: 'not-downloaded' });
  // Any other failure of a file that is there says what the disk said: with the network away, a fetch ends this way.
  expect(await readTextFile(note, 1000, { open: failing({ errno: -errno.ETIMEDOUT, code: 'ETIMEDOUT', syscall: 'read' }) })).toEqual({ trouble: 'failed', code: 'ETIMEDOUT', cloud: false });
  expect(await readTextFile(note, 1000, { open: refusing({ code: 'EACCES' }) })).toEqual({ trouble: 'failed', code: 'EACCES', cloud: false });
  // A code that isn't one (Node's words for a number it has no name for) is left out of what is said.
  expect(await readTextFile(note, 1000, { open: failing({ errno: -999, code: 'Unknown system error -999' }) })).toEqual({ trouble: 'failed', code: '', cloud: false });
  // Gone, or swapped for a link, between the look and the open: not a file Lookout shows, as before.
  for (const code of ['ENOENT', 'ELOOP', 'ENOTDIR']) expect(await readTextFile(note, 1000, { open: refusing({ code }) }), code).toBeNull();
  expect(await readTextFile(join(root, 'never.md'), 1000)).toBeNull();
  // A file that is on this Mac reads as before.
  expect(textOf(await readTextFile(note, 1000)).body.toString()).toBe('# A note\n');
});

it('DOC-3.4: a read that waits for a fetch is given up after a while and closes its handle when it ends; asking again joins it, and no more than three wait at once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lookout-outputs-')); roots.push(root);
  const notes = ['a', 'b', 'c', 'd'].map((name) => { const p = join(root, `${name}.md`); writeFileSync(p, `# ${name}\n`); return p; });
  const { open } = await import('node:fs/promises');
  const opened: string[] = [], closed: string[] = [], release: (() => void)[] = [];
  const waiting: typeof open = async (...args) => {
    opened.push(String(args[0]));
    const handle = await open(...args), read = handle.read.bind(handle), close = handle.close.bind(handle);
    handle.read = (async (...a: Parameters<typeof read>) => { await new Promise<void>((r) => { release.push(r); }); return read(...a); }) as typeof handle.read;
    handle.close = async () => { closed.push(String(args[0])); return close(); };
    return handle;
  };
  const ask = (path: string) => readTextFile(path, 1000, { open: waiting, timeoutMs: 30 });
  expect(await ask(notes[0]!)).toEqual({ trouble: 'slow' });
  // The read is still under way: asking again waits for the same one, and opens nothing.
  expect(await ask(notes[0]!)).toEqual({ trouble: 'slow' });
  expect(opened).toEqual([notes[0]]);
  expect(closed).toEqual([]);
  // Three reads wait at most: a fourth file is told to come back, at once, and isn't opened.
  await ask(notes[1]!); await ask(notes[2]!);
  expect(opened).toEqual(notes.slice(0, 3));
  const before = Date.now();
  expect(await ask(notes[3]!)).toEqual({ trouble: 'slow' });
  expect(Date.now() - before).toBeLessThan(25);
  expect(opened).toEqual(notes.slice(0, 3));
  // The fetch arrives: a read that was joined gives its text, every handle is closed, and the next ask reads afresh.
  const joined = ask(notes[0]!);
  for (const go of release.splice(0)) go();
  expect(textOf(await joined).body.toString()).toBe('# a\n');
  await vi.waitFor(() => expect(closed.sort()).toEqual(notes.slice(0, 3)));
  expect(textOf(await readTextFile(notes[3]!, 1000)).body.toString()).toBe('# d\n');
});

it('PEOPLE-2.5: a file whose folder became private while its text was being read is refused, as one never listed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lookout-outputs-')); roots.push(root);
  const note = join(root, 'note.md'); writeFileSync(note, '# A note\n');
  // Open at the ask before the read, private at the one after it.
  let asked = 0;
  const files = new OutputFiles(async () => ++asked > 1);
  files.allow(note);
  expect(await files.text(note, 1000)).toBeNull();
  expect(asked).toBe(2);
});

it('LIB-2.12: a file is kept in the cloud and not on this Mac when it has a size and no block of the disk', () => {
  expect(isCloudOnly({ size: 961, blocks: 0 })).toBe(true);
  expect(isCloudOnly({ size: 961, blocks: 8 })).toBe(false);
  // An empty file has no block either, and nothing to fetch; a stat that doesn't say isn't taken for one.
  expect(isCloudOnly({ size: 0, blocks: 0 })).toBe(false);
  expect(isCloudOnly({ size: 961 })).toBe(false);
});

it('DOC-3.4: the launchd agent’s plist has macOS fetch a file kept in the cloud when the server reads it', async () => {
  const { readFileSync } = await import('node:fs');
  const plist = readFileSync(join(import.meta.dirname, '../scripts/launchd/local.lookout.server.plist'), 'utf8');
  expect(plist).toMatch(/<key>MaterializeDatalessFiles<\/key>\s*<true\/>/);
});
