import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Library, LibraryError, parseLibraryQuery } from './library.ts';

const at = '2026-10-23T10:00:00Z';
const touch = { harness: 'claude', session_id: 'parent-session', title: 'Report writer', project_path: '/project', last_at: at, event: 'write', events: 1 };
const file = (path: string, extra = {}) => ({ kind: 'file', key: path, path, type: 'html', title: path, created_at: at, updated_at: at, events: 1, sessions: [touch], ...extra });
const answer = (results: unknown[], total = results.length) => JSON.stringify({ results, total_results: total, page: 1 });
const query = (s = '') => parseLibraryQuery(new URLSearchParams(s));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

it('LIB-2.1: fills 50 rows from at most five CLI pages, preserves overflow for the next page, ignores future kinds, and exposes no total', async () => {
  const runner = vi.fn(async (_bin, argv: readonly string[]) => {
    const p = Number(argv[argv.indexOf('--page') + 1]);
    return answer(Array.from({ length: 50 }, (_, i) => file(`/report-${(p - 1) * 50 + i}.html`, { kind: i === 0 ? 'future' : 'file' })), 1000);
  });
  const lib = new Library({ runner, bin: () => 'tb-session', stat: async (p) => ({ isFile: () => !p.includes('report-1') }), isDirectory: async () => true });
  const first = await lib.find(query());
  expect(first.state).toBe('ok');
  if (first.state !== 'ok') return;
  expect(first.items).toHaveLength(50);
  expect(first).not.toHaveProperty('total');
  expect(first.nextPage).toBe(3);
  const next = await lib.find(query(`page=${first.nextPage}`));
  if (next.state !== 'ok') throw new Error('missing page');
  expect(next.items).toHaveLength(50);
  expect(new Set([...first.items, ...next.items].map((i) => i.key)).size).toBe(100);
  const gone = new Library({ runner, bin: () => 'tb-session', stat: async () => ({ isFile: () => false }) });
  runner.mockClear();
  const empty = await gone.find(query());
  expect(runner).toHaveBeenCalledTimes(5);
  expect(empty).toMatchObject({ state: 'ok', items: [], hasMore: true, nextPage: 6 });
});

it('LIB-2.3: filters through exact CLI flags, keeps repos seen across answers, and uses argv for a flag-like query', async () => {
  const runner = vi.fn<import('./exec.ts').Runner>(async () => answer([file('/r.html', { project_path: '/project/seen' })]));
  const lib = new Library({ runner, bin: () => 'tb-session', stat: async () => ({ isFile: () => true }) });
  await lib.find(query('q=--%25_&types=pages,markdown,share&project=/project/chosen&headless=1'));
  expect(runner.mock.calls[0]?.[1]).toEqual(['outputs', '--all-projects', '--json', '--limit', '50', '--page', '1', '--kind', 'file,artifact,share', '--type', 'html,markdown', '--project', '/project/chosen', '--headless', 'include', '--q', '--', '--%_']);
  const page = await lib.find(query());
  expect(page).toMatchObject({ projects: ['/project/chosen', '/project/seen'] });
  expect(query('types=&page=-2')).toMatchObject({ types: ['pages', 'pdf'], page: 1, hideGone: true });
});

it('LIB-2.6: uses parent Session credits, marks deleted and pruned Sessions without calling show', async () => {
  const lib = new Library({ runner: async () => answer([file('/subagent.html', { sessions: [touch, { ...touch, session_id: 'deleted', transcript_missing: true }, { harness: 'claude', session_id: 'pruned-session', pruned: true, event: 'edit', last_at: at }] })]), bin: () => 'tb-session', stat: async () => ({ isFile: () => true }), isDirectory: async () => true });
  const page = await lib.find(query());
  if (page.state !== 'ok') throw new Error('missing');
  expect(page.items[0]?.sessions.map((s) => [s.sessionId, s.blocked, s.pruned])).toEqual([['parent-session', null, false], ['deleted', 'transcript-missing', false], ['pruned-session', 'no-folder', true]]);
});

it('LIB-2.8: uses a separate install hint, redacts errors, and grants only the first call per binary revision 60 seconds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookout-library-')); dirs.push(dir);
  const bin = join(dir, 'tb-session'); writeFileSync(bin, 'version one');
  const runner = vi.fn<import('./exec.ts').Runner>(async () => answer([file('/report.html')]));
  const lib = new Library({ runner, bin: () => bin });
  await lib.find(query()); await lib.find(query());
  expect(runner.mock.calls.map((c) => c[2].timeoutMs)).toEqual([60000, 20000]);
  writeFileSync(bin, 'version two, changed'); await lib.find(query());
  expect(runner.mock.calls[2]?.[2].timeoutMs).toBe(60000);
  runner.mockRejectedValueOnce(Object.assign(new Error('raw secret'), { code: 2, stderr: "error: unrecognized subcommand 'outputs'" }));
  expect(await lib.find(query())).toMatchObject({ state: 'not-installed' });
  runner.mockRejectedValueOnce(Object.assign(new Error('raw secret'), { stderr: 'Authorization: Bearer ghp_secret\nsecond line sk-secret' }));
  await expect(lib.find(query())).rejects.toThrow('tb-session failed: Authorization: …');
  runner.mockRejectedValueOnce(Object.assign(new Error('raw secret'), { timedOut: true }));
  await expect(lib.find(query())).rejects.toThrow(LibraryError);
});

it('LIB-2.9: stats absolute plain files and folded sources only, times out the batch, and never hides an Artifact for its gone source', async () => {
  const stat = vi.fn(async (p: string) => { if (p === '/slow.html') return new Promise<{ isFile(): boolean }>(() => {}); return { isFile: () => p === '/exists.html' }; });
  const artifact = { ...file('/unused'), kind: 'artifact', key: 'https://example.invalid/artifact', url: 'https://example.invalid/artifact', source: { path: '/gone.html', type: 'html', created_at: at, updated_at: at, events: 1 } };
  const lib = new Library({ runner: async () => answer([file('/exists.html'), file('/slow.html'), file('relative.html'), file('/a:b.html'), file('/line\nbreak.html'), file(`/long${'x'.repeat(1050)}.html`), artifact]), bin: () => 'tb-session', stat, statTimeoutMs: 5 });
  const page = await lib.find(query());
  expect(page).toMatchObject({ state: 'ok', hiddenGone: 5, items: [{ exists: true }, { kind: 'artifact', source: { exists: false } }] });
  expect(stat.mock.calls.map((c) => c[0])).toEqual(['/exists.html', '/slow.html', '/gone.html']);
});

it('LIB-2.8: an indexing timeout names the manual index command, and concurrent reads wait for that first flight', async () => {
  const failed = new Library({ runner: async () => { throw Object.assign(new Error('raw'), { timedOut: true }); }, bin: () => '/fake-tb-session' });
  await expect(failed.find(query())).rejects.toThrow('tb-session index --all-projects');
  let finish: ((s: string) => void) | undefined;
  const runner = vi.fn<import('./exec.ts').Runner>().mockImplementationOnce(() => new Promise((r) => { finish = r; })).mockResolvedValue(answer([file('/report.html')]));
  const lib = new Library({ runner, bin: () => '/fake-tb-session', stat: async () => ({ isFile: () => true }) });
  const first = lib.find(query()), second = lib.find(query('q=report'));
  await vi.waitFor(() => expect(lib.indexing).toBe(true)); expect(runner).toHaveBeenCalledTimes(1);
  finish!(answer([file('/report.html')])); await Promise.all([first, second]);
  expect(lib.indexing).toBe(false); expect(runner.mock.calls.map((c) => c[2].timeoutMs)).toEqual([60000, 20000]);
});
