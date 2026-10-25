import { stat as fsStat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute } from 'node:path';
import { TB_SESSION_INSTALL_COMMAND } from '../shared/defaults.ts';
import { DEFAULT_LIBRARY_TYPES, LIBRARY_TYPES, type LibraryPage, type LibraryQuery, type OutputItem, type OutputSession, type OutputSource, type OutputType } from '../shared/library.ts';
import type { RunError, Runner } from './exec.ts';
import { checkPaths, isPlainPath } from './files.ts';
import { SESSION_ID } from './history.ts';
import { cleanEnv } from './launcher.ts';
import { sanitizeLine } from './sanitize.ts';
import { OutputFiles } from './output-files.ts';

const PAGE_SIZE = 50;
const TYPES: readonly string[] = ['markdown', 'html', 'pdf', 'image'];
const object = (v: unknown): Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {};
const string = (v: unknown, max = 1024): string | null => typeof v === 'string' && v.length <= max && v.length > 0 && !/[\p{Cc}\p{Cf}]/u.test(v) ? v : null;
const time = (v: unknown) => typeof v === 'string' ? Date.parse(v) : NaN;
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0;
// Invalid plain/absolute paths still describe gone Outputs; checkPaths decides existence.
const path = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 16_384 ? v : null;
const label = (v: unknown): string | null => typeof v === 'string' ? v.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || null : null;
const project = (v: unknown) => { const p = path(v); return p && isAbsolute(p) && isPlainPath(p) ? p : null; };
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
    types: types.length ? types : [...DEFAULT_LIBRARY_TYPES],
    project: project(params.get('project')) ?? '',
    headless: params.get('headless') === '1',
    hideGone: params.get('hideGone') !== '0',
  };
}
interface LibraryOptions {
  runner: Runner;
  bin(): string;
  env?: NodeJS.ProcessEnv;
  stat?: (path: string) => Promise<{ isFile(): boolean }>;
  statTimeoutMs?: number;
  isDirectory?: (path: string) => Promise<boolean>;
}

/** Only facts from outputs; the sole disk reads here are the per-page existence checks. */
export class Library {
  readonly files = new OutputFiles();
  private readonly opts: LibraryOptions;
  private readonly projects = new Set<string>();
  /** A CLI page can overshoot 50 kept rows. Its tail belongs to the next cursor, never discarded. */
  private readonly tails = new Map<string, OutputItem[]>();
  private revision: string | null = null;
  private upgrading: Promise<string | null> | null = null;
  private activeIndex = 0;
  private empty: boolean | null = null;
  constructor(opts: LibraryOptions) { this.opts = opts; }
  get indexing(): boolean { return this.activeIndex > 0; }
  private get home() { return (this.opts.env ?? process.env).HOME || homedir(); }
  private display(p: string) { return p === this.home || p.startsWith(`${this.home}/`) ? `~${p.slice(this.home.length)}` : p; }

  private args(q: LibraryQuery, page: number): string[] {
    const kinds = [...(q.types.some((t) => t !== 'share') ? ['file'] : []), ...(q.types.includes('pages') ? ['artifact'] : []), ...(q.types.includes('share') ? ['share'] : [])];
    const types = q.types.filter((t) => t !== 'share').map((t) => t === 'pages' ? 'html' : t);
    const args = ['outputs', '--all-projects', '--json', '--limit', String(PAGE_SIZE), '--page', String(page), '--kind', kinds.join(',')];
    if (types.length) args.push('--type', types.join(','));
    if (q.project) args.push('--project', q.project);
    args.push('--headless', q.headless ? 'include' : 'exclude');
    if (q.query) args.push('--q', '--', q.query);
    return args;
  }
  private async call(args: string[]): Promise<string | null> {
    const bin = this.opts.bin();
    const info = await fsStat(bin).catch(() => null);
    const revision = `${bin}:${info?.mtimeMs ?? ''}:${info?.size ?? ''}`;
    // Queries opened together share the migration call, then run with the ordinary budget.
    if (this.upgrading) await this.upgrading;
    const first = revision !== this.revision;
    this.revision = revision;
    const run = async () => {
      if (first) this.activeIndex++;
      try {
        return await this.opts.runner(bin, args, { timeoutMs: first ? 60_000 : 20_000, env: cleanEnv(this.opts.env ?? process.env) });
      } catch (err) {
        const e = err as RunError;
        if (e.code === 'ENOENT' || (e.code === 2 && /unrecognized subcommand 'outputs'/.test(e.stderr ?? ''))) return null;
        if (e.timedOut) throw new LibraryError(504, first ? 'Indexing Transcripts took too long. Run tb-session index --all-projects, then reopen Library.' : 'tb-session took too long to answer.');
        throw new LibraryError(502, `tb-session failed: ${sanitizeLine(e.stderr, 200) ?? 'no details'}`);
      } finally { if (first) this.activeIndex--; }
    };
    if (!first) return run();
    const pending = run(); this.upgrading = pending;
    try { return await pending; } finally { if (this.upgrading === pending) this.upgrading = null; }
  }

  async find(q: LibraryQuery): Promise<LibraryPage> {
    const filterKey = JSON.stringify({ ...q, page: 0 });
    const tailKey = (page: number) => `${filterKey}:${page}`;
    if (q.project) this.projects.add(q.project);
    if (q.page === 1) for (const k of this.tails.keys()) if (k.startsWith(`${filterKey}:`)) this.tails.delete(k);
    const tail = this.tails.get(tailKey(q.page)) ?? [];
    await this.check(tail);
    const kept = tail.filter((r) => !q.hideGone || r.kind !== 'file' || r.exists);
    let nextPage = q.page, hasMore = true, hiddenGone = tail.length - kept.length;
    for (let reads = 0; reads < 5 && kept.length < PAGE_SIZE && hasMore; reads++) {
      const out = await this.call(this.args(q, nextPage));
      if (out === null) return { state: 'not-installed', installCommand: TB_SESSION_INSTALL_COMMAND };
      let parsed: Record<string, unknown>;
      try { parsed = object(JSON.parse(out)); } catch { throw new LibraryError(502, 'tb-session returned an unexpected answer.'); }
      if (!Array.isArray(parsed.results) || typeof parsed.total_results !== 'number' || !Number.isSafeInteger(parsed.total_results) || parsed.total_results < 0) throw new LibraryError(502, 'tb-session returned an unexpected answer.');
      if (parsed.total_results > 0) this.empty = false;
      const raw = parsed.results.slice(0, PAGE_SIZE) as unknown[];
      for (const r of raw) { const p = project(object(r).project_path); if (p) this.projects.add(p); }
      const items = raw.map((r) => this.row(r)).filter((r): r is OutputItem => r !== null);
      await this.check(items);
      for (const row of items) { if (q.hideGone && row.kind === 'file' && !row.exists) hiddenGone++; else kept.push(row); }
      hasMore = nextPage * PAGE_SIZE < parsed.total_results;
      nextPage++;
    }
    const overflow = kept.slice(PAGE_SIZE);
    if (overflow.length) {
      this.tails.set(tailKey(nextPage), overflow);
      if (this.tails.size > 200) this.tails.delete(this.tails.keys().next().value!);
    }
    // The exact unfiltered total is needed only to distinguish "nothing produced" from no match.
    // Do not infer it from a filtered query (the default already has Type/headless filters).
    if (q.page === 1 && this.empty !== false) {
      const out = await this.call(['outputs', '--all-projects', '--json', '--limit', '1', '--page', '1', '--headless', 'include']);
      if (out === null) return { state: 'not-installed', installCommand: TB_SESSION_INSTALL_COMMAND };
      try {
        const parsed = object(JSON.parse(out));
        if (typeof parsed.total_results !== 'number') throw new Error();
        this.empty = parsed.total_results === 0;
        for (const r of Array.isArray(parsed.results) ? parsed.results.slice(0, 1) : []) {
          const p = project(object(r).project_path); if (p) this.projects.add(p);
          const row = this.row(r);
          if (row?.kind === 'file' && row.path) this.files.allow(row.path);
          if (row?.source) this.files.allow(row.source.path);
        }
      } catch { throw new LibraryError(502, 'tb-session returned an unexpected answer.'); }
    }
    const items = kept.slice(0, PAGE_SIZE);
    await Promise.all(items.flatMap((r) => r.sessions.map(async (s) => {
      if (!s.blocked && !s.pruned && s.projectPath && !(await this.isDirectory(s.projectPath))) s.blocked = 'folder-gone';
    })));
    return { state: 'ok', items, nextPage, hasMore: hasMore || overflow.length > 0, hiddenGone, unfilteredEmpty: this.empty === true, projects: [...this.projects].sort() };
  }
  private async isDirectory(p: string) {
    return this.opts.isDirectory ? this.opts.isDirectory(p) : fsStat(p).then((s) => s.isDirectory(), () => false);
  }
  private async check(items: OutputItem[]) {
    const paths = items.flatMap((r) => r.kind === 'file' && r.path ? [r.path] : r.source ? [r.source.path] : []);
    const answers = await checkPaths(null, paths, { stat: this.opts.stat, timeoutMs: this.opts.statTimeoutMs });
    const exists = new Map(answers.map((r) => [r.path, r.exists]));
    for (const r of items) {
      if (r.path && r.kind === 'file') { r.exists = exists.get(r.path) === true; this.files.allow(r.path); }
      if (r.source) { r.source.exists = exists.get(r.source.path) === true; this.files.allow(r.source.path); }
    }
  }
  private row(value: unknown): OutputItem | null {
    const r = object(value), kind = r.kind;
    if (kind !== 'file' && kind !== 'artifact' && kind !== 'share') return null;
    const key = kind === 'file' ? path(r.key) : string(r.key, 4096), p = kind === 'file' ? path(r.path) : null, u = kind !== 'file' ? url(r.url) : null;
    const type = TYPES.includes(String(r.type)) ? r.type as OutputType : null;
    const createdAt = time(r.created_at), updatedAt = time(r.updated_at);
    if (!key || (kind === 'file' ? !p || !type : !u) || !Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null;
    const projectPath = project(r.project_path);
    const s = object(r.source), sp = path(s.path), st = TYPES.includes(String(s.type)) ? s.type as OutputType : null;
    const source: OutputSource | null = kind === 'artifact' && sp && st && Number.isFinite(time(s.created_at)) && Number.isFinite(time(s.updated_at)) ? { path: sp, display: this.display(sp), type: st, createdAt: time(s.created_at), updatedAt: time(s.updated_at), events: count(s.events), exists: false } : null;
    const sourcePath = path(r.source_path) ?? source?.path ?? null;
    const sessions = (Array.isArray(r.sessions) ? r.sessions.slice(0, 1000) : []).map((v): OutputSession | null => {
      const t = object(v), id = string(t.session_id), harness = t.harness;
      if (!id || !SESSION_ID.test(id) || (harness !== 'claude' && harness !== 'codex') || !['write', 'edit', 'publish', 'upload'].includes(String(t.event))) return null;
      const projectPath = project(t.project_path), pruned = t.pruned === true;
      return { sessionId: id, harness, title: label(t.title) ?? id.slice(0, 8), projectPath, projectDisplay: projectPath ? this.display(projectPath) : null, repo: projectPath ? basename(projectPath) : null, headless: typeof t.headless === 'boolean' ? t.headless : null, branch: null, lastActiveAt: Number.isFinite(time(t.last_at)) ? time(t.last_at) : null, snippet: null, firstPrompt: null, blocked: t.transcript_missing === true ? 'transcript-missing' : !projectPath ? 'no-folder' : null, pruned, event: t.event as OutputSession['event'] };
    }).filter((s): s is OutputSession => s !== null).sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
    return { kind, key, type, title: label(r.title) ?? (p ? basename(p) : u!), path: p, url: u, display: p ? this.display(p) : u!, projectPath, repo: projectPath ? basename(projectPath) : null, createdAt, updatedAt, events: count(r.events), exists: false, source, sourcePath, sourceDisplay: sourcePath ? this.display(sourcePath) : null, version: typeof r.version === 'number' ? r.version : null, sessions };
  }
}
