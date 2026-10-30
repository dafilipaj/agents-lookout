import { mkdir, mkdtemp, open, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { Runner } from './exec.ts';
import { run } from './exec.ts';
import { libraryIncludes, libraryMatches } from '../shared/library-search.ts';
import { Library, LibraryError, parseLibraryQuery } from './library.ts';
import { TB_SESSION_INSTALL_COMMAND } from '../shared/defaults.ts';
import { neededVersion } from '../shared/tools.ts';

vi.mock('node:fs/promises', async (original) => { const m = await original<typeof import('node:fs/promises')>(); return { ...m, open: vi.fn(m.open) }; });

const at = '2026-10-23T10:00:00Z';
const event = (path: string, extra = {}) => ({ kind: 'write', key: path, path, timestamp: at, title: path, harness: 'claude', session_id: 'parent-session', project_path: '/project', ...extra });
const answer = (results: unknown[], total = results.length) => JSON.stringify({ results, total_results: total, page: 1 });
const query = (s = '') => parseLibraryQuery(new URLSearchParams(s));
const notRepo = () => Object.assign(new Error('raw'), { code: 128, stderr: 'fatal: not a git repository (or any of the parent directories): .git' });
const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const fake = (rows: unknown[], sessions: unknown[] = []) => vi.fn<Runner>(async (bin, args) => bin === 'git' ? Promise.reject(notRepo()) : answer(args[0] === 'list' ? sessions : args.includes('write,edit') ? rows : []));
const options = (runner: Runner) => ({ runner, bin: () => '/fake-tb-session', stat: async () => ({ isFile: () => true }), isDirectory: async () => true });

it('LIB-2.1: reads all three sources in parallel, follows short CLI pages, holds exact pages and rereads only after expiry', async () => {
  let release!: () => void;
  const barrier = new Promise<void>((r) => { release = r; });
  const rows = Array.from({ length: 121 }, (_, n) => event(`/report-${n}.pdf`, { timestamp: new Date(Date.parse(at) - n * 1000).toISOString() }));
  const runner = vi.fn<Runner>(async (bin, args) => {
    if (bin === 'git') throw notRepo();
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
    ['list', '--all-projects', '--json', '--limit', '200'],
  ]));
  expect(await lib.find(query('page=2&readId=evicted'))).toEqual({ state: 'read-again' });
});

it('LIB-2.1: leaves out rows of a kind Lookout does not know (contract E9)', async () => {
  const runner = vi.fn<Runner>(async (bin, args) => bin === 'git' ? Promise.reject(notRepo()) : answer(args[0] === 'list' ? [] : args.includes('write,edit') ? [event('/kept.pdf')] : [event('/doc', { kind: 'doc', key: 'https://example.invalid/doc', url: 'https://example.invalid/doc', title: 'A doc' })]));
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
  const runner = fake(rows, [{ session_id: 'parent-session', harness: 'claude', summary: 'Writer', first_prompt: 'Prompt' }, { session_id: 'prompt-session', harness: 'claude', first_prompt: '\n\n<pasted_content id="34d8">\nFirst prompt\n</pasted_content id="34d8">\n' }]);
  const page = await new Library(options(runner)).find(query()); if (page.state !== 'ok') throw new Error('missing');
  expect(page.items[0]?.sessions).toEqual(expect.arrayContaining([
    expect.objectContaining({ sessionId: 'parent-session', title: 'Writer', blocked: null }),
    expect.objectContaining({ sessionId: 'prompt-session', title: 'First prompt' }),
    expect.objectContaining({ sessionId: 'deleted', blocked: 'transcript-missing' }),
    expect.objectContaining({ sessionId: 'pruned-session', title: 'pruned-s', pruned: true }),
  ]));
  expect(runner.mock.calls.some(([, args]) => args[0] === 'show')).toBe(false);
});

it('LIB-2.6: reads Session titles from list 200 at a time, following its pages', async () => {
  const sessions = Array.from({ length: 450 }, (_, n) => ({ session_id: `s-${n}`, harness: 'claude', summary: `Title ${n}` }));
  const runner = vi.fn<Runner>(async (bin, args) => {
    if (bin === 'git') throw notRepo();
    if (args[0] !== 'list') return answer(args.includes('write,edit') ? [event('/late.html', { session_id: 's-449' })] : []);
    const page = args.includes('--page') ? Number(args[args.indexOf('--page') + 1]) : 1;
    return answer(sessions.slice((page - 1) * 200, page * 200), sessions.length);
  });
  const page = await new Library(options(runner)).find(query()); if (page.state !== 'ok') throw new Error('missing');
  expect(page.items[0]?.sessions).toEqual([expect.objectContaining({ sessionId: 's-449', title: 'Title 449' })]);
  expect(runner.mock.calls.filter(([, args]) => args[0] === 'list').map(([, args]) => args)).toEqual([
    ['list', '--all-projects', '--json', '--limit', '200'],
    ['list', '--all-projects', '--json', '--limit', '200', '--page', '2'],
    ['list', '--all-projects', '--json', '--limit', '200', '--page', '3'],
  ]);
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
  // A tb-session without `events` (0.3.x) is too old, never missing (TOOLS-2.5).
  const missing = new Library(options(async () => { throw Object.assign(new Error('raw'), { code: 2, stderr: "error: unrecognized subcommand 'events'" }); }));
  expect(await missing.find(query())).toMatchObject({ state: 'too-old', installCommand: TB_SESSION_INSTALL_COMMAND });
  const failed = new Library(options(async () => { throw Object.assign(new Error('raw'), { stderr: 'Authorization: Bearer ghp_secret\nsecond line sk-secret' }); }));
  await expect(failed.find(query())).rejects.toThrow('tb-session failed: Authorization: …');
  const slow = new Library(options(async () => { throw Object.assign(new Error('raw'), { timedOut: true }); }));
  await expect(slow.find(query())).rejects.toThrow('tb-session index --all-projects');
  expect(slow.indexing).toBe(false);
  const malformed = new Library(options(async () => answer([], 1)));
  await expect(malformed.find(query())).rejects.toBeInstanceOf(LibraryError);
});

it('TOOLS-2.5: a tb-session without `events` is older than the Library needs, with the version installed when known, the needed one from the table and the update command; only one that is gone is not installed', async () => {
  const refuse = async () => { throw Object.assign(new Error('raw'), { code: 2, stderr: "\u001b[31merror:\u001b[0m unrecognized subcommand 'events'\n\nUsage: tb-session <COMMAND>\n" }); };
  const known = new Library({ ...options(refuse), toolVersion: () => '0.3.0' });
  expect(await known.find(query())).toEqual({ state: 'too-old', reason: 'tb-session 0.3.0 is older than the Library needs (0.4.0)', installCommand: TB_SESSION_INSTALL_COMMAND });
  expect(neededVersion('tb-session', 'the Library')).toBe('0.4.0');
  const unknown = new Library({ ...options(refuse), toolVersion: () => null });
  expect(await unknown.find(query())).toMatchObject({ state: 'too-old', reason: 'tb-session is older than the Library needs (0.4.0)' });
  // A flag `events` doesn't have is the same answer.
  const flag = new Library(options(async () => { throw Object.assign(new Error('raw'), { code: 2, stderr: "error: unexpected argument '--headless' found" }); }));
  expect(await flag.find(query())).toMatchObject({ state: 'too-old' });
  const gone = new Library(options(async () => { throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }); }));
  expect(await gone.find(query())).toEqual({ state: 'not-installed', installCommand: TB_SESSION_INSTALL_COMMAND });
});

it('LIB-2.9: stats every file and Artifact source before paging, 100 paths a batch with one shared deadline per batch', async () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const files = [...Array.from({ length: 200 }, (_, n) => event(`/report-${n}.pdf`)), event('/source.html')];
  const artifact = event('/unused', { kind: 'artifact', key: 'https://example.invalid/a', url: 'https://example.invalid/a', title: 'A', source_path: '/source.html' });
  const runner = vi.fn<Runner>(async (bin, args) => bin === 'git' ? Promise.reject(notRepo()) : answer(args[0] === 'list' ? [] : args.includes('write,edit') ? files : [artifact]));
  const started: { path: string; at: number }[] = [];
  let release!: () => void;
  const second = new Promise<void>((r) => { release = r; });
  // Batch one never answers (so only its deadline ends it), batch two waits for the test, batch three answers at once.
  const stat = async (p: string) => {
    started.push({ path: p, at: Date.now() });
    if (started.length <= 100) return new Promise<{ isFile(): boolean }>(() => {});
    if (started.length <= 200) await second;
    return { isFile: () => true };
  };
  const lib = new Library({ ...options(runner), stat, statTimeoutMs: 200 });
  const pending = lib.find(query());
  await sleep(100); expect(started).toHaveLength(100);
  await vi.waitFor(() => expect(started).toHaveLength(200));
  await sleep(60); expect(started).toHaveLength(200);
  release();
  const page = await pending; if (page.state !== 'ok') throw new Error('missing');
  expect(started).toHaveLength(201); expect(started.at(-1)?.path).toBe('/source.html');
  expect(started[100]!.at - started[0]!.at).toBeGreaterThanOrEqual(180);
  expect(started[99]!.at - started[0]!.at).toBeLessThan(100);
  expect(page).toMatchObject({ total: 101, hiddenGone: 100 });
  expect(page.items.find((i) => i.kind === 'artifact')).toMatchObject({ source: { path: '/source.html', exists: true } });
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

const gitRead = (home: string, paths: string[], log: (l: string) => void, wrap: (r: Runner) => Runner = (r) => r) => {
  const runner: Runner = wrap(async (bin, args, opts) => bin === 'git' ? run(bin, args, opts) : answer(args.includes('write,edit') ? paths.map((p) => event(p)) : args[0] === 'list' ? [] : [{ kind: 'share', key: 'https://example.invalid/s', url: 'https://example.invalid/s', title: 'A share', timestamp: at, harness: 'claude', session_id: 'parent-session', project_path: '/project' }]));
  return new Library({ runner, bin: () => '/fake-tb-session', env: { ...process.env, HOME: home }, log });
};
const repoIn = async (home: string, name: string) => {
  const repo = join(home, name); await mkdir(join(repo, 'ignored'), { recursive: true });
  await run('git', ['init', '--quiet', repo], { timeoutMs: 5000 });
  await writeFile(join(repo, '.gitignore'), 'ignored/\n');
  for (const f of ['owned.md', 'ignored/report.md']) await writeFile(join(repo, f), '# Document');
  return repo;
};

it('LIB-2.10: asks git about physical paths, so a repo reached through a symlinked folder is read and answered with the recorded paths', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'lookout-library-link-'))); roots.push(home);
  await mkdir(join(home, 'real'));
  await repoIn(join(home, 'real'), 'repo');
  await symlink(join(home, 'real'), join(home, 'link'));
  const lines: string[] = [];
  const recorded = [join(home, 'link/repo/owned.md'), join(home, 'link/repo/ignored/report.md')];
  const page = await gitRead(home, recorded, (l) => lines.push(l)).find(query('types=markdown'));
  expect(page).toMatchObject({ state: 'ok', total: 1, items: [{ path: recorded[1] }] });
  expect(lines).toEqual([]);
});

it('LIB-2.10: a root git cannot answer for (corrupt index, timeout) leaves out its files only; the read and its other Outputs are answered, one path-free line per failure', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'lookout-library-damaged-'))); roots.push(home);
  const bad = await repoIn(home, 'bad'), good = await repoIn(home, 'good'), slow = await repoIn(home, 'slow');
  await writeFile(join(bad, '.git/index'), 'garbage, not an index');
  const paths = [join(bad, 'owned.md'), join(bad, 'ignored/report.md'), join(good, 'owned.md'), join(good, 'ignored/report.md'), join(slow, 'ignored/report.md'), join(home, 'plain.pdf')];
  await writeFile(join(home, 'plain.pdf'), 'pdf');
  const lines: string[] = [];
  const timeout: (r: Runner) => Runner = (r) => async (bin, args, opts) => { if (bin === 'git' && args[1] === slow && args[2] === 'check-ignore') throw Object.assign(new Error('raw'), { timedOut: true, code: null }); return r(bin, args, opts); };
  const page = await gitRead(home, paths, (l) => lines.push(l), timeout).find(query('types=markdown,pdf,share'));
  if (page.state !== 'ok') throw new Error('missing');
  expect(page.items.map((i) => i.path ?? i.url).sort()).toEqual([join(good, 'ignored/report.md'), join(home, 'plain.pdf'), 'https://example.invalid/s'].sort());
  expect(lines).toHaveLength(2);
  expect(lines.every((l) => l.startsWith('lookout: library: git could not answer') && !l.includes(home))).toBe(true);
  expect(lines.join('\n')).toContain('timed out'); expect(lines.join('\n')).toMatch(/damaged index|failed \(exit 128\)/);
});

it("LIB-2.10: only git's \"not a git repository\" means no work tree; a dubious-ownership refusal leaves the files out and is asked again next read", async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  let refuse = true;
  const lines: string[] = [];
  const runner = vi.fn<Runner>(async (bin, args) => {
    if (bin === 'git') throw refuse ? Object.assign(new Error('raw'), { code: 128, stderr: "fatal: detected dubious ownership in repository at '/secret/place'" }) : notRepo();
    return answer(args[0] === 'list' ? [] : args.includes('write,edit') ? [event('/owned.md')] : []);
  });
  const lib = new Library({ ...options(runner), log: (l) => lines.push(l) });
  expect(await lib.find(query('types=markdown'))).toMatchObject({ total: 0 });
  expect(lines).toEqual(['lookout: library: git could not answer for a folder, its files are left out: dubious ownership']);
  refuse = false; vi.setSystemTime(Date.now() + 2100);
  expect(await lib.find(query('types=markdown'))).toMatchObject({ total: 1 });
  const asked = () => runner.mock.calls.filter(([bin]) => bin === 'git').length;
  expect(asked()).toBe(2);
  vi.setSystemTime(Date.now() + 2100); await lib.find(query('types=markdown'));
  expect(asked()).toBe(2);
});

it('LIB-2.4: a capital sharp S folds with ß and ss, in matching and in highlight ranges', async () => {
  expect(libraryIncludes('STRAẞE', 'Straße')).toBe(true); expect(libraryIncludes('Straße', 'STRAẞE')).toBe(true); expect(libraryIncludes('strasse', 'STRAẞE')).toBe(true);
  expect(libraryMatches('a STRAẞE b', 'straße')).toEqual([[2, 8]]);
  expect(libraryMatches('Straße', 'ẞ')).toEqual([[4, 5]]);
  const runner = fake([event('/STRAẞE.html')]);
  expect(await new Library(options(runner)).find(query(`q=${encodeURIComponent('Straße')}`))).toMatchObject({ total: 1 });
});

it('LIB-2.12: a title inside an HTML comment, script or style is not the page title', async () => {
  const home = await mkdtemp(join(tmpdir(), 'lookout-library-html-')); roots.push(home);
  const pages = { comment: '<!-- <title>Template</title> --><title>Actual</title>', script: '<script>var t = "<title>Script</title>";</script><style>/* <title>Style</title> */</style><TITLE>Real</TITLE>', open: '<!-- <title>Cut</title>', nested: '<script><!--</script><title>After</title>', literal: '<title>How <script> works</title>' };
  const paths = Object.keys(pages).map((n) => join(home, `${n}.html`));
  for (const [n, html] of Object.entries(pages)) await writeFile(join(home, `${n}.html`), html);
  const page = await new Library({ runner: fake(paths.map((p) => event(p))), bin: () => '/fake-tb-session' }).find(query());
  if (page.state !== 'ok') throw new Error('missing');
  expect(Object.fromEntries(page.items.map((i) => [basename(i.path!), i.title]))).toEqual({ 'comment.html': 'Actual', 'script.html': 'Real', 'open.html': 'open.html', 'nested.html': 'After', 'literal.html': 'How <script> works' });
});

it('LIB-2.12: an unchanged file reuses its cached title, a changed one is read again, an entry unused for an hour goes, a gone path is never opened', async () => {
  const home = await mkdtemp(join(tmpdir(), 'lookout-library-cache-')); roots.push(home);
  const a = join(home, 'a.md'), b = join(home, 'b.md'), gone = join(home, 'gone.md');
  await writeFile(a, '# Title A'); await writeFile(b, '# Title B');
  vi.useFakeTimers({ toFake: ['Date'] });
  let current = [a, b, gone];
  const runner = vi.fn<Runner>(async (bin, args) => bin === 'git' ? Promise.reject(notRepo()) : answer(args[0] === 'list' ? [] : args.includes('write,edit') ? current.map((p) => event(p)) : []));
  const lib = new Library({ runner, bin: () => '/fake-tb-session' });
  const opened = () => vi.mocked(open).mock.calls.map(([p]) => String(p));
  const read = async (...paths: string[]) => { current = paths; vi.setSystemTime(Date.now() + 2100); return lib.find(query('types=markdown&hideGone=0')); };
  vi.mocked(open).mockClear();
  await read(a, b, gone); expect(opened().sort()).toEqual([a, b]);
  await read(a, b, gone); expect(opened()).toHaveLength(2);
  await writeFile(a, '# Title A, longer');
  expect(await read(a, b)).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ title: 'Title A, longer' })]) }); expect(opened()).toHaveLength(3);
  await read(b); vi.setSystemTime(Date.now() + 1_800_000); await read(a, b); expect(opened()).toHaveLength(3);
  await read(b); vi.setSystemTime(Date.now() + 3_700_000); await read(b); expect(opened()).toHaveLength(3);
  await read(a, b); expect(opened().filter((p) => p === a)).toHaveLength(3); expect(opened().filter((p) => p === b)).toHaveLength(1);
  expect(opened()).not.toContain(gone);
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

const files = (...paths: string[]) => paths.map((p) => event(p));
const gitRunner = (rows: unknown[], git: Runner) => vi.fn<Runner>(async (bin, args, o) => bin === 'git' ? git(bin, args, o) : answer(args[0] === 'list' ? [] : args.includes('write,edit') ? rows : []));

it("LIB-2.10: a realpath that stalls or rejects leaves that folder's files out within the budget and keeps the others", async () => {
  const lines: string[] = [];
  const runner = gitRunner(files('/stalled/a.md', '/broken/b.md', '/fine/c.md'), async () => { throw notRepo(); });
  const lib = new Library({ ...options(runner), log: (l) => lines.push(l), realpathTimeoutMs: 100, realpath: async (d) => d === '/stalled' ? new Promise<string>(() => {}) : d === '/broken' ? Promise.reject(Object.assign(new Error('raw /broken'), { code: 'EIO' })) : d });
  const started = Date.now();
  const page = await lib.find(query('types=markdown'));
  expect(Date.now() - started).toBeLessThan(1500);
  expect(page).toMatchObject({ total: 1, items: [{ key: '/fine/c.md' }] });
  expect(lines.sort()).toEqual(['lookout: library: git could not answer for a folder, its files are left out: failed (exit unknown)', 'lookout: library: git could not answer for a folder, its files are left out: timed out']);
  expect(runner.mock.calls.filter(([bin]) => bin === 'git')).toHaveLength(1);
});

it('LIB-2.10: git always runs in the C locale, whatever locale the server inherited', async () => {
  const runner = gitRunner(files('/x/a.md'), async () => { throw notRepo(); });
  await new Library({ ...options(runner), realpath: async (d) => d, env: { ...process.env, LANG: 'de_DE.UTF-8', LC_ALL: 'de_DE.UTF-8', LANGUAGE: 'de' } }).find(query('types=markdown'));
  const envs = runner.mock.calls.filter(([bin]) => bin === 'git').map(([, , o]) => o.env);
  expect(envs).toHaveLength(1);
  expect(envs[0]).toMatchObject({ LC_ALL: 'C' }); expect(envs[0]!.LANGUAGE ?? '').toBe('');
});

it('LIB-2.10: only a diagnostic that starts a line means no work tree, not words inside a path', async () => {
  const stderr = "fatal: detected dubious ownership in repository at '/tmp/not a git repository'";
  const lines: string[] = [];
  const runner = gitRunner(files('/x/a.md'), async () => { throw Object.assign(new Error('raw'), { code: 128, stderr }); });
  expect(await new Library({ ...options(runner), realpath: async (d) => d, log: (l) => lines.push(l) }).find(query('types=markdown'))).toMatchObject({ total: 0 });
  expect(lines).toEqual(['lookout: library: git could not answer for a folder, its files are left out: dubious ownership']);
});

it('LIB-2.10: two recorded folders with one physical folder make one git call and one log line, and a failure is asked again next read', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  let refuse = true;
  const lines: string[] = [];
  const runner = gitRunner(files('/a/one.md', '/b/two.md'), async (_bin, args) => {
    if (refuse) throw Object.assign(new Error('raw'), { code: 128, stderr: "fatal: detected dubious ownership in repository at '/real'" });
    if (args.includes('rev-parse')) return '/real\n';
    return '/real/one.md\0/real/two.md\0';
  });
  const lib = new Library({ ...options(runner), log: (l) => lines.push(l), realpath: async () => '/real' });
  const asked = () => runner.mock.calls.filter(([bin]) => bin === 'git').length;
  expect(await lib.find(query('types=markdown'))).toMatchObject({ total: 0 });
  expect(asked()).toBe(1); expect(lines).toHaveLength(1);
  refuse = false; vi.setSystemTime(Date.now() + 2100);
  expect(await lib.find(query('types=markdown'))).toMatchObject({ total: 2 });
  expect(asked()).toBe(3);
});
