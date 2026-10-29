import { randomUUID } from 'node:crypto';
import { open, stat as fsStat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, normalize } from 'node:path';
import { TB_SESSION_INSTALL_COMMAND } from '../shared/defaults.ts';
import { libraryIncludes } from '../shared/library-search.ts';
import { DEFAULT_LIBRARY_TYPES, LIBRARY_TYPES, type LibraryPage, type LibraryQuery, type OutputItem, type OutputSession, type OutputType } from '../shared/library.ts';
import type { RunError, Runner } from './exec.ts';
import { checkPaths, isPlainPath } from './files.ts';
import { SESSION_ID } from './history.ts';
import { cleanEnv } from './launcher.ts';
import { sanitizeLine } from './sanitize.ts';
import { OutputFiles } from './output-files.ts';

const PAGE_SIZE = 50;
const EXTENSIONS: Record<string, OutputType> = { md: 'markdown', html: 'html', htm: 'html', pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image' };
const object = (v: unknown): Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {};
const string = (v: unknown, max = 1024): string | null => typeof v === 'string' && v.length <= max && v.length > 0 && !/[\p{Cc}\p{Cf}]/u.test(v) ? v : null;
const time = (v: unknown) => typeof v === 'string' ? Date.parse(v) : NaN;
const label = (v: unknown): string | null => typeof v === 'string' ? v.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || null : null;
const path = (v: unknown) => typeof v === 'string' && isAbsolute(v) && isPlainPath(v) ? normalize(v) : null;
const fileType = (p: string) => EXTENSIONS[extname(p).slice(1).toLowerCase()] ?? null;
const url = (v: unknown) => { const s = string(v, 4096); if (!s) return null; try { const u = new URL(s); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? s : null; } catch { return null; } };

export class LibraryError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function parseLibraryQuery(params: URLSearchParams): LibraryQuery {
  const selected = (params.get('types') ?? '').split(',');
  const types = LIBRARY_TYPES.filter((t) => selected.includes(t));
  const n = Number(params.get('page') ?? '1');
  return {
    query: (params.get('q') ?? '').replace(/[\0\r\n\t]+/g, ' ').trim().slice(0, 500),
    page: Number.isInteger(n) ? Math.min(100_000, Math.max(1, n)) : 1,
    ...(params.has('readId') ? { readId: (params.get('readId') ?? '').slice(0, 128) } : {}),
    types: types.length ? types : [...DEFAULT_LIBRARY_TYPES], project: path(params.get('project')) ?? '',
    headless: params.get('headless') === '1', hideGone: params.get('hideGone') !== '0',
  };
}
interface FileStat { isFile(): boolean; mtimeMs?: number; size?: number }
interface LibraryOptions {
  runner: Runner;
  bin(): string;
  env?: NodeJS.ProcessEnv;
  stat?: (path: string) => Promise<FileStat>;
  statTimeoutMs?: number;
  isDirectory?: (path: string) => Promise<boolean>;
}
interface Read { id: string; at: number; headless: boolean; items: OutputItem[]; projects: string[] }
interface Action {
  kind: 'file' | 'artifact' | 'share'; key: string; at: number; tool: string | null;
  word: OutputSession['event']; path: string | null; type: OutputType | null;
  url: string | null; sourcePath: string | null; title: string; version: number | null;
  session: OutputSession;
}

/** LIB: Transcript facts enter here; selection, grouping, titles and existence belong to Lookout. */
export class Library {
  readonly files = new OutputFiles();
  private readonly opts: LibraryOptions;
  private readonly reads: Read[] = [];
  private readonly flights = new Map<boolean, Promise<Read | null>>();
  private revision: string | null = null;
  private activeIndex = 0;
  private readonly roots = new Map<string, { at: number; root: string | null }>();
  private readonly titles = new Map<string, { mtime: number; size: number; title: string; seen: number }>();
  constructor(opts: LibraryOptions) { this.opts = opts; }
  get indexing(): boolean { return this.activeIndex > 0; }
  private get home() { return (this.opts.env ?? process.env).HOME || homedir(); }
  private display(p: string) { return p === this.home || p.startsWith(`${this.home}/`) ? `~${p.slice(this.home.length)}` : p; }

  async find(q: LibraryQuery): Promise<LibraryPage> {
    let read = q.readId === undefined ? undefined : this.reads.find((r) => r.id === q.readId && r.headless === q.headless);
    if (q.readId !== undefined && !read || q.page > 1 && !read) return { state: 'read-again' };
    read ??= this.reads.findLast((r) => r.headless === q.headless && Date.now() - r.at < 2000);
    if (!read) {
      let flight = this.flights.get(q.headless);
      if (!flight) {
        flight = this.read(q.headless); this.flights.set(q.headless, flight);
        void flight.finally(() => { if (this.flights.get(q.headless) === flight) this.flights.delete(q.headless); }).catch(() => {});
      }
      const result = await flight;
      if (!result) return { state: 'not-installed', installCommand: TB_SESSION_INSTALL_COMMAND };
      read = result;
    }
    const query = q.query;
    const matching = read.items.filter((i) => {
      const chip = i.kind === 'artifact' || i.type === 'html' ? 'pages' : i.kind === 'share' ? 'share' : i.type;
      return q.types.includes(chip as LibraryQuery['types'][number]) && (!q.project || i.projectPath === q.project) &&
        (!query || [i.title, i.path, i.url, i.sourcePath].some((s) => s !== null && libraryIncludes(s, query)));
    });
    const hiddenGone = q.hideGone ? matching.filter((i) => i.kind === 'file' && !i.exists).length : 0;
    const shown = q.hideGone ? matching.filter((i) => i.kind !== 'file' || i.exists) : matching;
    const end = q.page * PAGE_SIZE;
    return { state: 'ok', readId: read.id, items: shown.slice(end - PAGE_SIZE, end), total: shown.length, nextPage: q.page + 1, hasMore: end < shown.length, hiddenGone, unfilteredEmpty: read.items.length === 0, projects: [...new Set([...read.projects, ...(q.project ? [q.project] : [])])].sort() };
  }

  private async read(headless: boolean): Promise<Read | null> {
    const bin = this.opts.bin(), info = await fsStat(bin).catch(() => null);
    // A read that starts while the first read after an upgrade is still running shares its 60 s budget.
    const revision = `${bin}:${info?.mtimeMs ?? ''}:${info?.size ?? ''}`, first = revision !== this.revision || this.activeIndex > 0;
    this.revision = revision;
    if (first) this.activeIndex++;
    const env = cleanEnv(this.opts.env ?? process.env);
    const all = async (args: string[]): Promise<unknown[] | null> => {
      const rows: unknown[] = [];
      for (let page = 1; ; page++) {
        let raw: string;
        try { raw = await this.opts.runner(bin, page === 1 ? args : [...args, '--page', String(page)], { timeoutMs: first ? 60_000 : 20_000, env }); }
        catch (err) {
          const e = err as RunError;
          if (e.code === 'ENOENT' || e.code === 2 && /unrecognized subcommand 'events'/.test(e.stderr ?? '')) return null;
          if (e.timedOut) throw new LibraryError(504, first ? 'Indexing Transcripts took too long. Run tb-session index --all-projects, then reopen Library.' : 'tb-session took too long to answer.');
          throw new LibraryError(502, `tb-session failed: ${sanitizeLine(e.stderr, 200) ?? 'no details'}`);
        }
        let parsed: Record<string, unknown>;
        try { parsed = object(JSON.parse(raw)); } catch { throw new LibraryError(502, 'tb-session returned an unexpected answer.'); }
        if (!Array.isArray(parsed.results) || !Number.isSafeInteger(parsed.total_results) || (parsed.total_results as number) < 0) throw new LibraryError(502, 'tb-session returned an unexpected answer.');
        rows.push(...parsed.results);
        if (rows.length >= (parsed.total_results as number)) return rows;
        if (!parsed.results.length) throw new LibraryError(502, 'tb-session returned an incomplete read.');
      }
    };
    try {
      const prefix = ['events', '--all-projects', '--json', '--headless', headless ? 'include' : 'exclude', '--limit', '100000'];
      const [files, remote, sessions] = await Promise.all([
        all([...prefix, '--kind', 'write,edit', '--ext', Object.keys(EXTENSIONS).join(',')]),
        all([...prefix, '--kind', 'artifact,share']), all(['list', '--all-projects', '--json', '--limit', '100000']),
      ]);
      if (!files || !remote || !sessions) return null;
      const metadata = new Map(sessions.map((s) => { const r = object(s); return [`${r.harness}:${r.session_id}`, r] as const; }));
      const actions = [...files, ...remote].map((r) => this.action(r, metadata)).filter((a): a is Action => a !== null);
      // LIB-2.11: a copied tool call (contract E6) is credited once.
      const unique = new Map<string, Action>(), anonymous: Action[] = [];
      for (const a of actions) {
        if (!a.tool) { anonymous.push(a); continue; }
        const k = JSON.stringify([a.tool, a.word, a.key]), previous = unique.get(k);
        const created = (s: OutputSession) => time(metadata.get(`${s.harness}:${s.sessionId}`)?.created_at);
        if (!previous) { unique.set(k, a); continue; }
        // Earliest created_at in list wins; a Session list knows ranks before one it doesn't; then the smaller id.
        const before = created(previous.session), now = created(a.session);
        const earlier = Number.isFinite(before) && Number.isFinite(now) ? (before !== now ? now < before : a.session.sessionId < previous.session.sessionId)
          : Number.isFinite(before) !== Number.isFinite(now) ? Number.isFinite(now) : a.session.sessionId < previous.session.sessionId;
        if (earlier) unique.set(k, a);
      }
      const groups = new Map<string, Action[]>();
      for (const a of [...unique.values(), ...anonymous]) { const k = JSON.stringify([a.kind, a.key]); const group = groups.get(k) ?? []; group.push(a); groups.set(k, group); }
      const grouped = [...groups.values()].map((g) => this.group(g));
      const local = grouped.filter((i) => i.kind === 'file');
      const directories = [...new Set([...local.map((i) => dirname(i.path!)), ...grouped.flatMap((i) => i.sourcePath ? [dirname(i.sourcePath)] : []), ...actions.flatMap((a) => a.session.projectPath ? [a.session.projectPath] : [])])];
      const directoriesThere = await this.directories(directories);
      const owned = await this.gitOwned(local.map((i) => i.path!), directoriesThere);
      const fileByPath = new Map(local.filter((i) => !owned.has(i.path!)).map((i) => [i.path!, i]));
      const folded = new Set<string>();
      for (const artifact of grouped.filter((i) => i.kind === 'artifact')) {
        const source = artifact.sourcePath ? fileByPath.get(artifact.sourcePath) : null;
        if (!source) continue;
        artifact.source = { path: source.path!, display: source.display, type: source.type!, createdAt: source.createdAt, updatedAt: source.updatedAt, events: source.events, exists: false };
        artifact.sessions = this.touches([...artifact.sessions, ...source.sessions]); folded.add(source.path!);
      }
      const items = grouped.filter((i) => i.kind !== 'file' || !folded.has(i.path!) && directoriesThere.has(dirname(i.path!)) && !owned.has(i.path!));
      const paths = [...new Set(items.flatMap((i) => i.kind === 'file' ? [i.path!] : i.source ? [i.source.path] : []))];
      const stats = new Map<string, FileStat>();
      const exists = await this.check(paths, async (p) => { const s = await (this.opts.stat ?? fsStat)(p); stats.set(p, s); return s; });
      await mapLimit(items, 8, async (i) => {
        if (i.kind === 'file') { i.exists = exists.has(i.path!); this.files.allow(i.path!); if (i.exists) i.title = await this.title(i.path!, i.type!, stats.get(i.path!)!); }
        if (i.source) { i.source.exists = exists.has(i.source.path); this.files.allow(i.source.path); }
        for (const s of i.sessions) if (!s.blocked && s.projectPath && !directoriesThere.has(s.projectPath)) s.blocked = 'folder-gone';
      });
      for (const [p, t] of this.titles) if (Date.now() - t.seen > 3_600_000) this.titles.delete(p);
      items.sort((a, b) => b.updatedAt - a.updatedAt || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
      const read = { id: randomUUID(), at: Date.now(), headless, items, projects: [...new Set(actions.flatMap((a) => a.session.projectPath ? [a.session.projectPath] : []))].sort() };
      this.reads.push(read); if (this.reads.length > 3) this.reads.shift();
      return read;
    } finally { if (first) this.activeIndex--; }
  }

  private action(value: unknown, metadata: Map<string, Record<string, unknown>>): Action | null {
    const r = object(value), file = r.kind === 'write' || r.kind === 'edit';
    if (!file && r.kind !== 'artifact' && r.kind !== 'share') return null;
    const p = file ? path(r.path) : null, type = p ? fileType(p) : null;
    if (file && (!p || !type || ['.claude', '.codex', '.pi'].some((d) => p === `${this.home}/${d}` || p.startsWith(`${this.home}/${d}/`)))) return null;
    const key = string(r.key, 4096), u = file ? null : url(r.url), at = time(r.timestamp);
    const id = string(r.session_id), harness = r.harness;
    if (!key || !Number.isFinite(at) || !id || !SESSION_ID.test(id) || harness !== 'claude' && harness !== 'codex' || !file && !u) return null;
    const projectPath = path(r.project_path), title = metadata.get(`${harness}:${id}`);
    const word = file ? r.kind as 'write' | 'edit' : r.kind === 'artifact' ? 'publish' : 'upload';
    const session: OutputSession = { sessionId: id, harness, title: label(title?.summary) ?? label(title?.first_prompt) ?? id.slice(0, 8), projectPath, projectDisplay: projectPath ? this.display(projectPath) : null, repo: projectPath ? basename(projectPath) : null, headless: typeof r.headless === 'boolean' ? r.headless : null, branch: label(r.git_branch), lastActiveAt: at, snippet: null, firstPrompt: null, blocked: r.transcript_missing === true ? 'transcript-missing' : !projectPath ? 'no-folder' : null, pruned: r.pruned === true, event: word };
    return { kind: file ? 'file' : r.kind as 'artifact' | 'share', key, at, word, tool: string(r.tool_use_id), path: p, type, url: u, sourcePath: path(r.source_path), title: file ? basename(p!) : label(r.title) ?? u!, version: typeof r.version === 'number' ? r.version : null, session };
  }
  private group(actions: Action[]): OutputItem {
    actions.sort((a, b) => b.at - a.at);
    const a = actions[0]!, projectPath = a.session.projectPath;
    return { kind: a.kind, key: a.key, type: a.type, title: a.title, path: a.path, url: a.url, display: a.path ? this.display(a.path) : a.url!, projectPath, repo: projectPath ? basename(projectPath) : null, createdAt: actions.at(-1)!.at, updatedAt: a.at, events: actions.length, exists: false, source: null, sourcePath: a.sourcePath, sourceDisplay: a.sourcePath ? this.display(a.sourcePath) : null, version: a.version, sessions: this.touches(actions.map((a) => a.session)) };
  }
  private touches(sessions: OutputSession[]): OutputSession[] {
    const seen = new Set<string>();
    return sessions.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0)).filter((s) => { const k = `${s.harness}:${s.sessionId}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }
  /** VIEW-1.18: all disk questions are batches of at most 100 with one 2s deadline per batch. */
  private async check(paths: string[], stat: (p: string) => Promise<{ isFile(): boolean }>): Promise<Set<string>> {
    const there = new Set<string>();
    for (let n = 0; n < paths.length; n += 100) {
      const answers = await checkPaths(null, paths.slice(n, n + 100), { stat, timeoutMs: this.opts.statTimeoutMs });
      for (const a of answers) if (a.exists) there.add(a.path);
    }
    return there;
  }
  private directories(paths: string[]) {
    return this.check(paths, async (p) => {
      const exists = this.opts.isDirectory ? await this.opts.isDirectory(p) : (await fsStat(p)).isDirectory();
      return { isFile: () => exists };
    });
  }

  private async gitOwned(paths: string[], directories: Set<string>): Promise<Set<string>> {
    const byRoot = new Map<string, string[]>();
    const dirs = [...new Set(paths.map(dirname))].filter((d) => directories.has(d));
    await mapLimit(dirs, 8, async (dir) => {
      let cached = this.roots.get(dir);
      if (!cached || Date.now() - cached.at >= 600_000) {
        let root: string | null;
        try { root = path((await this.git(['-C', dir, 'rev-parse', '--show-toplevel'])).trim()); }
        catch (err) { if ((err as RunError).code !== 128) throw this.gitError(err); root = null; }
        cached = { at: Date.now(), root }; this.roots.set(dir, cached);
      }
      if (cached.root) { const entries = byRoot.get(cached.root) ?? []; entries.push(...paths.filter((p) => dirname(p) === dir)); byRoot.set(cached.root, entries); }
    });
    const owned = new Set<string>();
    await mapLimit([...byRoot], 8, async ([root, files]) => {
      let output: string;
      try { output = await this.git(['-C', root, 'check-ignore', '-z', '--stdin'], files.join('\0') + '\0'); }
      catch (err) { if ((err as RunError).code !== 1) throw this.gitError(err); output = (err as RunError).stdout ?? ''; }
      const ignored = new Set(output.split('\0'));
      for (const p of files) if (!ignored.has(p)) owned.add(p);
    });
    for (const [d, r] of this.roots) if (Date.now() - r.at >= 600_000) this.roots.delete(d);
    return owned;
  }
  private git(args: string[], stdin?: string) {
    const valid = args.length === 4 && args[0] === '-C' && path(args[1]) && args[2] === 'rev-parse' && args[3] === '--show-toplevel' || args.length === 5 && args[0] === '-C' && path(args[1]) && args[2] === 'check-ignore' && args[3] === '-z' && args[4] === '--stdin';
    if (!valid) throw new LibraryError(500, 'Unexpected Library git question.');
    return this.opts.runner('git', args, { timeoutMs: 2000, env: { ...cleanEnv(this.opts.env ?? process.env), GIT_OPTIONAL_LOCKS: '0' }, ...(stdin === undefined ? {} : { stdin }) });
  }
  private gitError(err: unknown) { return new LibraryError(502, `Could not check file ownership: ${sanitizeLine((err as RunError).stderr, 200) ?? 'git did not answer'}`); }
  private async title(p: string, type: OutputType, stat: FileStat): Promise<string> {
    const fallback = basename(p);
    if (type !== 'markdown' && type !== 'html' || stat.mtimeMs === undefined || stat.size === undefined) return fallback;
    const cached = this.titles.get(p);
    if (cached?.mtime === stat.mtimeMs && cached.size === stat.size) { cached.seen = Date.now(); return cached.title; }
    let title = fallback;
    const handle = await open(p, 'r').catch(() => null);
    if (handle) {
      try { const buffer = Buffer.alloc(8192); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); const text = buffer.subarray(0, bytesRead).toString('utf8'); title = label(type === 'markdown' ? markdownTitle(text) : htmlTitle(text)) ?? fallback; }
      finally { await handle.close(); }
    }
    this.titles.set(p, { mtime: stat.mtimeMs, size: stat.size, title, seen: Date.now() });
    return title;
  }
}

async function mapLimit<T>(values: T[], limit: number, visit: (v: T) => Promise<void>): Promise<void> {
  let n = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => { while (n < values.length) await visit(values[n++]!); }));
}
function markdownTitle(text: string): string | null {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let front = lines[0]?.trim() === '---', fence = '', length = 0;
  for (const [n, line] of lines.entries()) {
    if (front) { if (n > 0 && /^(---|\.\.\.)\s*$/.test(line)) front = false; continue; }
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) { fence = marker[1]![0]!; length = marker[1]!.length; }
      else if (marker[1]![0] === fence && marker[1]!.length >= length && !marker[2]!.trim()) fence = '';
      continue;
    }
    if (fence) continue;
    const heading = /^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (heading) return heading[1]!;
  }
  return null;
}
function htmlTitle(text: string): string | null {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(text)?.[1];
  if (title === undefined) return null;
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return title.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, entity: string) => {
    if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? all;
    const point = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : all;
  });
}
