import { accessSync, constants } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, delimiter, isAbsolute, join } from 'node:path';
import { TB_SESSION_INSTALL_COMMAND } from '../shared/defaults.ts';
import type { ChatEntry, Harness, HistoryBlock, HistoryDetail, HistoryItem, HistoryPage, HistoryPeek, ResumeResult } from '../shared/types.ts';
import type { RunError, Runner } from './exec.ts';
import { DirMissingError, LAUNCH_ID, type Launcher, SessionLiveError, cleanEnv } from './launcher.ts';
import { unwrapPasted } from './pasted.ts';
import { sanitizeLine } from './sanitize.ts';

/**
 * HIST: past Sessions through tb-session (decision 0005), contract in
 * docs/features/history/SPEC.md, Technical approach. Everything it prints is validated and
 * bounded here before it reaches the browser, as `messages.ts` does for `fleet messages`.
 *
 * tb-session 0.2 has no `harness`, `headless`, `--headless`, `--harness` or `--tail`: its rows
 * are read as Claude Code with `headless: null`, and the flags are left out once it refuses them.
 */

/** HIST-2.1: Sessions per page while listing; a search returns its best this many. */
export const HISTORY_PAGE = 50;
/** HIST-3.3: the latest messages a Session that can't be resumed opens with. */
export const DETAIL_TAIL = 20;
/** The first call may index every Transcript; later ones take ~0.15 s. */
const TB_TIMEOUT_MS = 20_000;
const MAX_QUERY = 500;
const MAX_PAGE = 1000;
const MAX_TITLE = 300;
/** HIST-2.9: a first prompt or a last message in an expanded result: its first three lines, at most 600 characters. */
const PEEK_LINES = 3;
const MAX_PEEK = 600;
const MAX_SNIPPET = 400;
const MAX_PATH = 1024;
const MAX_BRANCH = 200;
const MAX_TEXT = 200_000;
/** The Fleet fork's rule for `spawn --resume` (contracts/fleet-spawn-resume.md). */
/** Never starting with `-`, so it can never be read as a flag. */
export const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const HARNESSES: readonly string[] = ['claude', 'codex'] satisfies Harness[];

export class HistoryError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Finds `tb-session` like Fleet's binary: LOOKOUT_TB_SESSION_BIN, then PATH, then
 * `~/.local/bin` (where cli-toolbox installs it; a server started by launchd has a short PATH).
 */
export function resolveTbSessionBin(env: NodeJS.ProcessEnv = process.env): string {
  if (env.LOOKOUT_TB_SESSION_BIN) return env.LOOKOUT_TB_SESSION_BIN;
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  dirs.push(join(env.HOME || homedir(), '.local', 'bin'));
  for (const dir of dirs) {
    const candidate = join(dir, 'tb-session');
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return 'tb-session';
}

export interface FindQuery {
  query: string;
  page: number;
  /** HIST-2.5: include Headless Sessions. */
  headless: boolean;
  /** HIST-2.8: only this Harness's Sessions; null for both. */
  harness: Harness | null;
}

/** Reads a `GET /api/history` query string; anything odd is clamped, not refused. */
export function parseFindQuery(params: URLSearchParams): FindQuery {
  const query = (params.get('q') ?? '').replace(/[\0\r\n\t]+/g, ' ').trim().slice(0, MAX_QUERY);
  const n = Number(params.get('page') ?? '1');
  const page = Number.isInteger(n) ? Math.min(Math.max(n, 1), MAX_PAGE) : 1;
  const h = params.get('harness');
  return { query, page, headless: params.get('headless') === '1', harness: h === 'claude' || h === 'codex' ? h : null };
}

export interface HistoryOptions {
  runner: Runner;
  bin: () => string;
  env?: NodeJS.ProcessEnv;
  /** Whether a directory exists (tests pass a fake). */
  isDirectory?: (path: string) => Promise<boolean>;
}

export class History {
  private readonly opts: HistoryOptions;
  /** tb-session 0.2: refuses the 0.3 flags. Learned from its first refusal. */
  private legacy = false;

  constructor(opts: HistoryOptions) {
    this.opts = opts;
  }

  private get isDirectory() {
    return this.opts.isDirectory ?? defaultIsDirectory;
  }

  /** HIST-2.9: the home directory, shown as `~`. */
  private get home() {
    return (this.opts.env ?? process.env).HOME || homedir();
  }

  /** HIST-2.1/2.2: the newest first with an empty query, else the best matches first. */
  async find(q: FindQuery): Promise<HistoryPage> {
    const run = (legacy: boolean) => {
      const args = q.query
        ? ['search', '--all-projects', '--json', '--limit', String(HISTORY_PAGE)]
        : ['list', '--all-projects', '--json', '--limit', String(HISTORY_PAGE), '--page', String(q.page)];
      if (!q.headless && !legacy) args.push('--headless', 'exclude');
      // HIST-2.8: tb-session 0.3 filters by Harness; 0.2 can't, so the rows are filtered below.
      if (q.harness && !legacy) args.push('--harness', q.harness);
      // After `--`, so a query that starts with `-` is still the query.
      if (q.query) args.push('--', q.query);
      return args;
    };
    const out = await this.call(run);
    if (out === null) return { state: 'not-installed', installCommand: TB_SESSION_INSTALL_COMMAND };
    const parsed = parseObject(out);
    if (!parsed || !Array.isArray(parsed.results)) throw new HistoryError(502, 'tb-session returned an unexpected answer.');
    // Never more than a page, whatever tb-session printed: bounded before any row is read or
    // its directory checked.
    const raw = (parsed.results as unknown[]).slice(0, HISTORY_PAGE);
    const rows = raw.map((r) => toRow(r, this.home)).filter((r): r is Row => r !== null);
    // HIST-2.5: tb-session 0.2 can't filter; `null` (unknown) stays, as with `--headless exclude`.
    // HIST-2.8: filtered here too, for tb-session 0.2, whose rows (no `harness`) are Claude Code.
    const shown = rows.filter((r) => (q.headless || r.item.headless !== true) && (!q.harness || r.item.harness === q.harness));
    const items = await Promise.all(shown.map((r) => this.withBlock(r)));
    const total = typeof parsed.total_results === 'number' ? parsed.total_results : null;
    const hasMore = !q.query && (total !== null ? q.page * HISTORY_PAGE < total : raw.length >= HISTORY_PAGE);
    return { state: 'ok', items, page: q.query ? 1 : q.page, hasMore };
  }

  /**
   * HIST-3.3: the Session and its latest messages, read-only. tb-session 0.2 can't tail: its
   * `show` gives the first 20, and the answer says so (`preview: 'first'`) instead of calling
   * them the latest.
   */
  async detail(sessionId: string, harness: Harness): Promise<HistoryDetail> {
    const { row, messages, source, total, legacy } = await this.show(sessionId, harness, DETAIL_TAIL);
    const shown = messages.slice(legacy ? 0 : -DETAIL_TAIL, legacy ? DETAIL_TAIL : undefined);
    const entries: ChatEntry[] = [];
    shown.forEach((m, i) => {
      const e = toEntry(m, i);
      if (e) entries.push(e);
    });
    const preview = !legacy ? 'latest' : total !== null && total > shown.length ? 'first' : 'all';
    return { item: await this.withBlock(row), entries, source, preview, totalMessages: total };
  }

  /**
   * HIST-2.9, HIST-2.10: what an expanded result shows besides its row: its first prompt and its
   * last message, read with one `show --tail 1` when it's expanded, never for a whole page.
   * tb-session 0.2 can't tail: its `show` gives the first messages, so the last is left out.
   */
  async peek(sessionId: string, harness: Harness): Promise<HistoryPeek> {
    const { row, messages, legacy } = await this.show(sessionId, harness, 1);
    const m = legacy ? null : messages.at(-1);
    const last = typeof m === 'object' && m !== null ? (m as Record<string, unknown>) : null;
    const said = last && (last.role === 'user' || last.role === 'assistant') ? lines(last.role === 'user' ? unwrapPasted(last.content) : last.content) : null;
    return { firstPrompt: row.item.firstPrompt, last: said ? { role: last!.role as 'user' | 'assistant', text: said } : null, tailed: !legacy };
  }

  /** HIST-3.1: what a resume needs, read again from tb-session. */
  async lookup(sessionId: string, harness: Harness): Promise<HistoryItem> {
    const { row } = await this.show(sessionId, harness, 1);
    return this.withBlock(row);
  }

  private async show(sessionId: string, harness: Harness, tail: number) {
    if (!SESSION_ID.test(sessionId)) throw new HistoryError(400, 'Invalid session id.');
    // Which form answered: a 0.2 `show` gives the first messages, not the latest.
    const asked = { legacy: false };
    const out = await this.call((old) => {
      asked.legacy = old;
      return old ? ['show', '--json', '--', sessionId] : ['show', '--json', '--harness', harness, '--tail', String(tail), '--', sessionId];
    });
    if (out === null) throw new HistoryError(502, "tb-session isn't installed.");
    const parsed = parseObject(out);
    // tb-session 0.2 lists Sessions without a prompt, so its `show` can be of one (HIST-2.6).
    const row = parsed ? toRow(parsed, this.home, !asked.legacy) : null;
    if (!row || row.item.sessionId !== sessionId || row.item.harness !== harness) {
      throw new HistoryError(502, 'tb-session returned an unexpected answer.');
    }
    // HIST-2.6 with 0.2: its `message_count` counts assistant-only and empty (tool-result)
    // messages, so a listed row may have no prompt. Its `show` carries `first_prompt`: without
    // one, the Session is neither resumed nor opened.
    if (asked.legacy && !text(parsed!.first_prompt, MAX_TITLE)) throw new HistoryError(422, 'This Session has no prompt.');
    const messages = Array.isArray(parsed!.messages) ? (parsed!.messages as unknown[]) : [];
    const source: 'transcript' | 'index' = parsed!.messages_source === 'index' ? 'index' : 'transcript';
    const t = parsed!.total_messages;
    const total = typeof t === 'number' && Number.isInteger(t) && t >= 0 ? t : null;
    return { row, messages, source, total, legacy: asked.legacy };
  }

  /** Can it be resumed: its Transcript is there and its start directory exists. */
  private async withBlock(row: Row): Promise<HistoryItem> {
    let blocked: HistoryBlock | null = null;
    if (row.transcriptMissing) blocked = 'transcript-missing';
    else if (!row.item.projectPath) blocked = 'no-folder';
    else if (!(await this.isDirectory(row.item.projectPath))) blocked = 'folder-gone';
    return { ...row.item, blocked };
  }

  /**
   * Runs tb-session; null when it isn't installed. A 0.2 that refuses a 0.3 flag is asked again
   * without them, and from then on.
   */
  private async call(args: (legacy: boolean) => string[]): Promise<string | null> {
    const env = cleanEnv(this.opts.env ?? process.env);
    for (;;) {
      const legacy = this.legacy;
      try {
        return await this.opts.runner(this.opts.bin(), args(legacy), { timeoutMs: TB_TIMEOUT_MS, env });
      } catch (err) {
        const e = err as RunError;
        if (e.code === 'ENOENT') return null;
        if (e.timedOut) throw new HistoryError(504, 'tb-session took too long to answer.');
        if (!legacy && /unexpected argument '--(headless|harness|tail)'/.test(e.stderr ?? '')) {
          this.legacy = true;
          continue;
        }
        // `show` with `--json`: resolution errors as one JSON object on stdout.
        const parsed = parseObject(e.stdout);
        if (parsed?.error === 'session_not_found') throw new HistoryError(404, 'tb-session has no such Session.');
        if (parsed?.error === 'ambiguous_session_id') throw new HistoryError(409, 'More than one past Session has this id.');
        const ended = typeof e.code === 'number' ? ` (exit ${e.code})` : '';
        throw new HistoryError(502, `tb-session failed: ${sanitizeLine(e.stderr, 200) ?? `no details${ended}`}`);
      }
    }
  }
}

export interface ResumeDeps {
  history: Pick<History, 'lookup'>;
  launcher: Pick<Launcher, 'resume' | 'pendingResume'>;
  /** HIST-3.2: whether Fleet's current list has this Session. */
  isLive(sessionId: string, harness: Harness): Promise<boolean>;
}

/**
 * HIST-3: a click on a past Session. One this Lookout is already resuming ("Starting…", or
 * failed and not dismissed) or a live one is selected, never started again (HIST-3.2);
 * otherwise it's read again from tb-session, so the directory comes from there and not from the
 * browser, and resumed through the launcher (HIST-3.1). One that can't be resumed after all
 * (its directory went since it was listed) opens read-only (HIST-3.3).
 */
export async function resumePast(deps: ResumeDeps, input: unknown): Promise<ResumeResult> {
  const v = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  if (typeof v.sessionId !== 'string' || !SESSION_ID.test(v.sessionId)) throw new HistoryError(400, 'Invalid session id.');
  if (v.harness !== 'claude' && v.harness !== 'codex') throw new HistoryError(400, 'Invalid Harness.');
  const { sessionId, harness } = v;
  if (v.launchId !== undefined && (typeof v.launchId !== 'string' || !LAUNCH_ID.test(v.launchId))) throw new HistoryError(400, 'Invalid launch id.');
  const launchId = v.launchId;
  const pending = deps.launcher.pendingResume(sessionId, harness);
  if (pending) return { kind: 'started', launch: pending };
  if (await deps.isLive(sessionId, harness)) return { kind: 'live', sessionId };
  const item = await deps.history.lookup(sessionId, harness);
  if (item.blocked || !item.projectPath) return { kind: 'blocked', harness, sessionId, blocked: item.blocked ?? 'no-folder' };
  try {
    const launch = await deps.launcher.resume({ sessionId, harness, directory: item.projectPath, title: item.title, launchId });
    return { kind: 'started', launch };
  } catch (err) {
    if (err instanceof SessionLiveError) return { kind: 'live', sessionId };
    // Its directory went between the check above and the spawn: read-only, as if it had gone before.
    if (err instanceof DirMissingError) return { kind: 'blocked', harness, sessionId, blocked: 'folder-gone' };
    throw err;
  }
}

interface Row {
  item: Omit<HistoryItem, 'blocked'>;
  transcriptMissing: boolean;
}

const bound = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = oneLine(v);
  return s ? bound(s, max) : null;
};
/** HIST-2.9: the first three lines that say something, each on one line, at most 600 characters in all. */
const lines = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const kept = v.split(/\r\n|[\n\r\u2028\u2029]/).map(oneLine).filter(Boolean).slice(0, PEEK_LINES);
  return kept.length ? bound(kept.join('\n'), MAX_PEEK) : null;
};
/** HIST-2.9: a start directory as shown: the home directory as `~`. */
const display = (path: string, home: string) => (home && home !== '/' && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path);

/**
 * One tb-session row, validated; null for one History never shows (HIST-2.6) or can't read.
 * `requirePrompt: false` for a 0.2 `show`, whose prompt the caller checks itself.
 */
function toRow(v: unknown, home: string, requirePrompt = true): Row | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.session_id !== 'string' || !SESSION_ID.test(r.session_id)) return null;
  // tb-session 0.2 rows have no `harness`: they're all Claude Code. pi is a non-goal.
  const harness = r.harness === undefined ? 'claude' : r.harness;
  if (typeof harness !== 'string' || !HARNESSES.includes(harness)) return null;
  // HIST-2.6: subagent Sessions and Sessions without a prompt (tb-session 0.3 drops them too).
  if (r.is_sidechain === true) return null;
  // tb-session 0.2's `list` rows carry no `first_prompt` at all (its `search` and `show` do), and
  // it lists empty Sessions: there, a Session with messages counts as one with a prompt. That's
  // a guess (0.2 counts assistant-only and empty messages too), so `show` checks it on a click.
  const firstPrompt = text(unwrapPasted(r.first_prompt), MAX_TITLE);
  const legacyList = r.first_prompt === undefined && typeof r.message_count === 'number';
  if (requirePrompt && !firstPrompt && !(legacyList && (r.message_count as number) > 0)) return null;
  const projectPath = typeof r.project_path === 'string' && isAbsolute(r.project_path) && !/[\0\n\r]/.test(r.project_path) && r.project_path.length <= MAX_PATH
    ? r.project_path
    : null;
  const at = typeof r.modified_at === 'string' ? Date.parse(r.modified_at) : NaN;
  const created = typeof r.created_at === 'string' ? Date.parse(r.created_at) : NaN;
  return {
    item: {
      sessionId: r.session_id,
      harness: harness as Harness,
      headless: typeof r.headless === 'boolean' ? r.headless : null,
      title: text(r.summary, MAX_TITLE) ?? firstPrompt ?? `Untitled Session ${r.session_id.slice(0, 8)}`,
      projectPath,
      projectDisplay: projectPath ? display(projectPath, home) : null,
      repo: projectPath ? bound(basename(projectPath), 100) : null,
      branch: text(r.git_branch, MAX_BRANCH),
      lastActiveAt: Number.isFinite(at) ? at : Number.isFinite(created) ? created : null,
      snippet: text(r.matched_snippet, MAX_SNIPPET),
      firstPrompt: lines(unwrapPasted(r.first_prompt)),
    },
    transcriptMissing: r.transcript_missing === true,
  };
}

/** A `show` message as a chat entry: prompts and replies only, as VIEW's chat shows them. */
function toEntry(v: unknown, i: number): ChatEntry | null {
  if (typeof v !== 'object' || v === null) return null;
  const m = v as Record<string, unknown>;
  if (typeof m.content !== 'string' || !m.content.trim()) return null;
  const content = bound(m.role === 'user' ? unwrapPasted(m.content) : m.content, MAX_TEXT);
  const ts = typeof m.timestamp === 'string' ? bound(m.timestamp, 64) : null;
  const cursor = `h${i}`;
  if (m.role === 'user') return { kind: 'user', cursor, ts, text: content, queued: false };
  if (m.role === 'assistant') return { kind: 'assistant', cursor, ts, text: content, final: true };
  return null;
}

function parseObject(text: string | undefined): Record<string, unknown> | null {
  if (!text?.trim()) return null;
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function defaultIsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
