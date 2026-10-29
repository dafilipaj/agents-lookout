import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { Runner } from './exec.ts';
import { run } from './exec.ts';
import { Library, LibraryError, parseLibraryQuery } from './library.ts';

const at = '2026-10-23T10:00:00Z';
const event = (path: string, extra = {}) => ({ kind: 'write', key: path, path, timestamp: at, title: path, harness: 'claude', session_id: 'parent-session', project_path: '/project', ...extra });
const answer = (results: unknown[], total = results.length) => JSON.stringify({ results, total_results: total, page: 1 });
const query = (s = '') => parseLibraryQuery(new URLSearchParams(s));
const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const fake = (rows: unknown[], sessions: unknown[] = []) => vi.fn<Runner>(async (bin, args) => bin === 'git' ? Promise.reject(Object.assign(new Error('not a repo'), { code: 128 })) : answer(args[0] === 'list' ? sessions : args.includes('write,edit') ? rows : []));
const options = (runner: Runner) => ({ runner, bin: () => '/fake-tb-session', stat: async () => ({ isFile: () => true }), isDirectory: async () => true });

it('LIB-2.1: reads all three sources in parallel, follows short CLI pages, holds exact pages and rereads only after expiry', async () => {
  let release!: () => void;
  const barrier = new Promise<void>((r) => { release = r; });
  const rows = Array.from({ length: 121 }, (_, n) => event(`/report-${n}.pdf`, { timestamp: new Date(Date.parse(at) - n * 1000).toISOString() }));
  const runner = vi.fn<Runner>(async (bin, args) => {
    if (bin === 'git') throw Object.assign(new Error('not a repo'), { code: 128 });
    await barrier;
    if (args[0] === 'list' || args.includes('artifact,share')) return answer([]);
    const page = args.includes('--page') ? Number(args[args.indexOf('--page') + 1]) : 1;
    return answer(rows.slice((page - 1) * 70, page * 70), rows.length);
  });
  const lib = new Library(options(runner));
  const pending = lib.find(query());
  await vi.waitFor(() => expect(runner.mock.calls.filter(([bin]) => bin !== 'git')).toHaveLength(3));
  release();
  const first = await pending; if (first.state !== 'ok') throw new Error('missing');
  expect(first).toMatchObject({ total: 121, hasMore: true, nextPage: 2 }); expect(first.items).toHaveLength(50);
  const calls = runner.mock.calls.length;
  const second = await lib.find(query(`page=2&readId=${first.readId}`));
  expect(second).toMatchObject({ total: 121, items: expect.arrayContaining([expect.objectContaining({ key: '/report-50.pdf' })]) });
  await lib.find(query()); expect(runner).toHaveBeenCalledTimes(calls);
  expect(runner.mock.calls.filter(([bin]) => bin !== 'git').map(([, a]) => a)).toEqual(expect.arrayContaining([
    ['events', '--all-projects', '--json', '--headless', 'exclude', '--limit', '100000', '--kind', 'write,edit', '--ext', 'md,html,htm,pdf,png,jpg,jpeg,gif,svg,webp'],
    ['events', '--all-projects', '--json', '--headless', 'exclude', '--limit', '100000', '--kind', 'artifact,share'],
    ['list', '--all-projects', '--json', '--limit', '100000'],
  ]));
  expect(await lib.find(query('page=2&readId=evicted'))).toEqual({ state: 'read-again' });
});

it('LIB-2.1: leaves out rows of a kind Lookout does not know (contract E9)', async () => {
  const runner = vi.fn<Runner>(async (bin, args) => bin === 'git' ? Promise.reject(Object.assign(new Error('not a repo'), { code: 128 })) : answer(args[0] === 'list' ? [] : args.includes('write,edit') ? [event('/kept.pdf')] : [event('/doc', { kind: 'doc', key: 'https://example.invalid/doc', url: 'https://example.invalid/doc', title: 'A doc' })]));
  expect(await new Library(options(runner)).find(query())).toMatchObject({ total: 1, items: [{ key: '/kept.pdf' }] });
});

it('LIB-2.3: filters a named read locally with exact repo and gone totals and projects from the entire read', async () => {
  const runner = fake([event('/one.html', { project_path: '/project/one' }), event('/gone.html', { project_path: '/project/two' }), event('/notes.md')]);
  const lib = new Library({ ...options(runner), stat: async (p) => ({ isFile: () => !p.includes('gone') }) });
  const first = await lib.find(query()); if (first.state !== 'ok') throw new Error('missing');
  const calls = runner.mock.calls.length;
  expect(first).toMatchObject({ total: 1, hiddenGone: 1, projects: ['/project', '/project/one', '/project/two'] });
  expect(await lib.find(query(`readId=${first.readId}&types=markdown&project=/project`))).toMatchObject({ total: 1, items: [{ path: '/notes.md' }] });
  expect(await lib.find(query(`readId=${first.readId}&project=/chosen`))).toMatchObject({ total: 0, unfilteredEmpty: false, projects: expect.arrayContaining(['/chosen']) });
  expect(await lib.find(query(`readId=${first.readId}&hideGone=0`))).toMatchObject({ total: 2, hiddenGone: 0 });
  expect(runner).toHaveBeenCalledTimes(calls);
  expect(query('types=&page=-2')).toMatchObject({ types: ['pages', 'pdf'], page: 1, hideGone: true });
});

it('LIB-2.4: literal Unicode case-insensitive search runs on the held read over title, path, URL and source path', async () => {
  const runner = fake([event('/ÄPFEL.html'), event('/percent%_.html'), event('/x.html', { kind: 'artifact', key: 'https://example.invalid/report', url: 'https://example.invalid/report', title: 'İstanbul', source_path: '/source/Σ.html' })]);
  const lib = new Library(options(runner));
  const first = await lib.find(query()); if (first.state !== 'ok') throw new Error('missing');
  const calls = runner.mock.calls.length;
  for (const q of ['äpfel', '%_', 'σ.html', 'REPORT']) expect(await lib.find(query(`readId=${first.readId}&q=${encodeURIComponent(q)}`))).toMatchObject({ total: 1 });
  expect(runner).toHaveBeenCalledTimes(calls);
});

it('LIB-2.6: joins Session titles, preserves parent credits, missing and pruned metadata without show', async () => {
  const rows = [event('/s.html', { subagent: 'agent-world.jsonl' }), event('/s.html', { session_id: 'deleted', transcript_missing: true }), event('/s.html', { session_id: 'pruned-session', pruned: true }), event('/s.html', { session_id: 'prompt-session' })];
  const runner = fake(rows, [{ session_id: 'parent-session', harness: 'claude', summary: 'Writer', first_prompt: 'Prompt' }, { session_id: 'prompt-session', harness: 'claude', first_prompt: 'First prompt' }]);
  const page = await new Library(options(runner)).find(query()); if (page.state !== 'ok') throw new Error('missing');
  expect(page.items[0]?.sessions).toEqual(expect.arrayContaining([
    expect.objectContaining({ sessionId: 'parent-session', title: 'Writer', blocked: null }),
    expect.objectContaining({ sessionId: 'prompt-session', title: 'First prompt' }),
    expect.objectContaining({ sessionId: 'deleted', blocked: 'transcript-missing' }),
    expect.objectContaining({ sessionId: 'pruned-session', title: 'pruned-s', pruned: true }),
  ]));
  expect(runner.mock.calls.some(([, args]) => args[0] === 'show')).toBe(false);
});

it('LIB-2.7: retains only the last three immutable reads, scopes headless reuse and checks existence again on refresh', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const gone = new Set<string>();
  const runner = fake([event('/report.html')]);
  const lib = new Library({ ...options(runner), stat: async (p) => ({ isFile: () => !gone.has(p) }) });
  const first = await lib.find(query()); if (first.state !== 'ok') throw new Error('missing');
  gone.add('/report.html');
  for (let n = 0; n < 3; n++) { vi.setSystemTime(Date.now() + 2100); await lib.find(query(n % 2 ? 'headless=1' : '')); }
  expect(await lib.find(query(`page=2&readId=${first.readId}`))).toEqual({ state: 'read-again' });
  expect(await lib.find(query())).toMatchObject({ total: 0, hiddenGone: 1 });
});

it('LIB-2.8: grants the first read per binary revision 60s, coalesces queries, detects missing events and redacts failures', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const runner = fake([]), lib = new Library(options(runner));
  await Promise.all([lib.find(query()), lib.find(query('q=other'))]);
  expect(runner.mock.calls).toHaveLength(3); expect(runner.mock.calls.map(([, , o]) => o.timeoutMs)).toEqual([60000, 60000, 60000]);
  vi.setSystemTime(Date.now() + 2100); await lib.find(query());
  expect(runner.mock.calls.slice(3).map(([, , o]) => o.timeoutMs)).toEqual([20000, 20000, 20000]);
  const missing = new Library(options(async () => { throw Object.assign(new Error('raw'), { code: 2, stderr: "error: unrecognized subcommand 'events'" }); }));
  expect(await missing.find(query())).toMatchObject({ state: 'not-installed' });
  const failed = new Library(options(async () => { throw Object.assign(new Error('raw'), { stderr: 'Authorization: Bearer ghp_secret\nsecond line sk-secret' }); }));
  await expect(failed.find(query())).rejects.toThrow('tb-session failed: Authorization: …');
  const slow = new Library(options(async () => { throw Object.assign(new Error('raw'), { timedOut: true }); }));
  await expect(slow.find(query())).rejects.toThrow('tb-session index --all-projects');
  expect(slow.indexing).toBe(false);
  const malformed = new Library(options(async () => answer([], 1)));
  await expect(malformed.find(query())).rejects.toBeInstanceOf(LibraryError);
});

it('LIB-2.9: stats every file and Artifact source before paging in batches of at most 100 with a shared deadline', async () => {
  const checked: string[] = [];
  const rows = Array.from({ length: 201 }, (_, n) => event(`/report-${n}.pdf`));
  const lib = new Library({ ...options(fake(rows)), stat: async (p) => { checked.push(p); if (p === '/report-0.pdf') return new Promise(() => {}); return { isFile: () => p !== '/report-200.pdf' }; }, statTimeoutMs: 5 });
  expect(await lib.find(query())).toMatchObject({ total: 199, hiddenGone: 2, items: expect.any(Array) });
  expect(checked).toHaveLength(201);
});

it('LIB-2.10: absolute plain document paths outside Harness homes, present directories and read-only git ownership per file', async () => {
  const home = await mkdtemp(join(tmpdir(), 'lookout-library-rules-')); roots.push(home);
  const repo = join(home, 'repo'); await mkdir(join(repo, 'ignored'), { recursive: true });
  await run('git', ['init', '--quiet', repo], { timeoutMs: 5000 });
  await writeFile(join(repo, '.gitignore'), 'ignored/\n*.html\n');
  const owned = join(repo, 'owned.md'), ignored = join(repo, 'ignored/report.md'), tracked = join(repo, 'ignored/tracked.md');
  for (const p of [owned, ignored, tracked]) await writeFile(p, '# Document');
  await run('git', ['-C', repo, 'add', '-f', 'ignored/tracked.md'], { timeoutMs: 5000 });
  const paths = [owned, ignored, tracked, join(home, 'outside.PDF'), join(home, 'gone/a.pdf'), join(home, '.claude/a.md'), join(home, '.codex/a.md'), join(home, '.pi/a.md'), 'relative.md', '/a:b.md', '/bad\nname.md', join(home, 'code.ts')];
  await writeFile(join(home, 'outside.PDF'), 'pdf');
  const calls: string[][] = [];
  const runner: Runner = async (bin, args, opts) => { if (bin === 'git') { calls.push([...args]); return run(bin, args, opts); } return answer(args.includes('write,edit') ? paths.map((p) => event(p)) : []); };
  const lib = new Library({ runner, bin: () => '/fake-tb-session', env: { ...process.env, HOME: home } });
  const page = await lib.find(query('types=markdown,pdf&hideGone=0'));
  expect(page).toMatchObject({ total: 2, items: expect.arrayContaining([expect.objectContaining({ path: ignored }), expect.objectContaining({ path: join(home, 'outside.PDF') })]) });
  expect(calls.filter((a) => a.includes('check-ignore'))).toHaveLength(1);
  expect(calls.every((a) => a.includes('rev-parse') || a.includes('check-ignore'))).toBe(true);
  expect(await readFile(owned, 'utf8')).toBe('# Document');
});

it('LIB-2.11: groups actions across history, credits fork copies to earliest-created Session, folds sources on both Artifacts and keeps newer edits', async () => {
  const rows = [event('/report.html', { tool_use_id: 'copy', session_id: 'z-original' }), event('/report.html', { tool_use_id: 'copy', session_id: 'a-fork' }), event('/report.html', { kind: 'edit', timestamp: '2026-10-25T10:00:00Z', session_id: 'editor' }), ...['one', 'two'].map((n) => event('/unused', { kind: 'artifact', key: `https://example.invalid/${n}`, url: `https://example.invalid/${n}`, title: n, source_path: '/report.html', timestamp: '2026-10-24T10:00:00Z' }))];
  const runner = fake(rows, [{ harness: 'claude', session_id: 'z-original', created_at: '2026-10-20T10:00:00Z' }, { harness: 'claude', session_id: 'a-fork', created_at: '2026-10-22T10:00:00Z' }]);
  const page = await new Library(options(runner)).find(query()); if (page.state !== 'ok') throw new Error('missing');
  expect(page.total).toBe(2);
  for (const item of page.items) {
    expect(item).toMatchObject({ kind: 'artifact', events: 1, updatedAt: Date.parse('2026-10-24T10:00:00Z'), source: { events: 2, createdAt: Date.parse(at), updatedAt: Date.parse('2026-10-25T10:00:00Z') } });
    expect(item.sessions.map((s) => s.sessionId)).not.toContain('a-fork');
    expect(item.sessions[0]).toMatchObject({ sessionId: 'editor', event: 'edit' });
  }
});

it('LIB-2.12: reads only the first 8KB for Markdown/HTML titles, skipping front matter and fences, cached by path+mtime+size', async () => {
  const home = await mkdtemp(join(tmpdir(), 'lookout-library-titles-')); roots.push(home);
  const md = join(home, 'notes.md'), html = join(home, 'report.html'), late = join(home, 'late.md');
  await writeFile(md, '---\ntitle: front\n# Wrong\n---\n```md\n# Code\n```\n~~~\n# More code\n~~~\n# Right heading\n');
  await writeFile(html, '<html><TITLE>Actual &amp; title</TITLE></html>'); await writeFile(late, 'x'.repeat(8192) + '\n# Too late');
  vi.useFakeTimers({ toFake: ['Date'] });
  const lib = new Library({ runner: fake([event(md), event(html), event(late)]), bin: () => '/fake-tb-session' });
  expect(await lib.find(query('types=markdown,pages'))).toMatchObject({ total: 3, items: expect.arrayContaining([expect.objectContaining({ title: 'Right heading' }), expect.objectContaining({ title: 'Actual & title' }), expect.objectContaining({ title: 'late.md' })]) });
  await writeFile(md, '# Changed heading\n'); vi.setSystemTime(Date.now() + 2100);
  expect(await lib.find(query('types=markdown&q=changed'))).toMatchObject({ total: 1, items: [{ title: 'Changed heading' }] });
});

it('LIB-2.11: fork credit prefers a known creation time over a Session absent from list, then uses the id fallback', async () => {
  const rows = [event('/known.html', { tool_use_id: 'copy', session_id: 'a-pruned', pruned: true }), event('/known.html', { tool_use_id: 'copy', session_id: 'z-known' }), event('/fallback.html', { tool_use_id: 'fallback', session_id: 'z-missing' }), event('/fallback.html', { tool_use_id: 'fallback', session_id: 'a-missing' })];
  const page = await new Library(options(fake(rows, [{ harness: 'claude', session_id: 'z-known', created_at: at }]))).find(query());
  if (page.state !== 'ok') throw new Error('missing');
  expect(page.items.find((i) => i.path === '/known.html')?.sessions.map((s) => s.sessionId)).toEqual(['z-known']);
  expect(page.items.find((i) => i.path === '/fallback.html')?.sessions.map((s) => s.sessionId)).toEqual(['a-missing']);
});

it('LIB-2.8: opposite headless reads during an upgrade share the 60-second migration budget', async () => {
  let finish!: () => void;
  const barrier = new Promise<void>((r) => { finish = r; });
  const runner = vi.fn<Runner>(async () => { await barrier; return answer([]); });
  const lib = new Library(options(runner));
  const first = lib.find(query());
  await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(3));
  const other = lib.find(query('headless=1'));
  await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(6));
  finish(); await Promise.all([first, other]);
  expect(runner.mock.calls.map(([, , o]) => o.timeoutMs)).toEqual(Array(6).fill(60000));
});
