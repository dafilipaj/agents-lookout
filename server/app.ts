import { randomUUID } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { MAX_ATTACHMENT_BYTES } from '../shared/attachments.ts';
import { type Settings, SettingsError, type SettingsView } from '../shared/settings.ts';
import type { AnswerRequest, AnswerResult, ChatPage, EffortSwitchRequest, EffortSwitchResult, EndResult, EndTarget, EscStatus, Harness, HarnessOption, HistoryDetail, HistoryPage, HistoryPeek, LaunchView, ModelSwitchRequest, ModelSwitchResult, RenameResult, ResumeResult, ServerEvent } from '../shared/types.ts';
import type { PathAnswer } from '../shared/files.ts';
import type { ToolsSnapshot } from '../shared/tools.ts';
import type { UsageSnapshot } from '../shared/usage.ts';
import type { WorkSnapshot } from '../shared/work.ts';
import { AnswerError, parseAnswerRequest, parseEscStatus } from './answerer.ts';
import { AttachmentError, Attachments, DAY_MS } from './attachments.ts';
import { ChangesError } from './changes.ts';
import { EndError, parseEndTarget } from './closer.ts';
import { type Library } from './library.ts';
import { LibraryError, parseLibraryQuery } from './library.ts';
import { OUTPUT_HEADERS } from './output-files.ts';
import { Avatars } from './avatars.ts';
import { PathsError } from './files.ts';
import { ModelSwitchError, parseEffortRequest, parseModelRequest } from './model-switch.ts';
import { RenameError, parseRenameRequest } from './renamer.ts';
import { type FindQuery, HistoryError, parseFindQuery } from './history.ts';
import { LaunchError, TrustError } from './launcher.ts';
import type { MemoryMonitor } from './memory.ts';
import type { SessionMonitor } from './monitor.ts';
import { type GuardConfig, guardRequest } from './security.ts';
import type { SettingsStore } from './settings.ts';
import { serveStatic } from './static.ts';
import { type Topics, TopicsError, parseMember, parseMemberRef, parsePatch, parseRecommendationAction, parseTitle } from './topics.ts';
import type { RecommendationAction } from '../shared/topics.ts';
import { MAX_MESSAGE, ViewError } from './viewer.ts';
import type { RefreshAnswer } from './work.ts';

export interface AppOptions {
  /** VIEW-9: explicit storage location; tests always pass a temporary directory. */
  attachmentsDir: string;
  /** WORK-3.9: where Review request authors' avatars are kept; without one, every avatar is a 404 (initials). */
  avatarsDir?: string;
  guard: GuardConfig;
  monitor: Pick<SessionMonitor, 'snapshot' | 'watch'>;
  settings: Pick<SettingsStore, 'get' | 'update' | 'onChange'>;
  /** WORK-2.5: `git config --global user.email`, read once at startup; sent with the settings, never stored. */
  productiveEmailSuggestion?: string | null;
  launcher: {
    list(): LaunchView[];
    recentStarts(): { launchId: string; sessionId: string }[];
    harnesses(): Promise<HarnessOption[]>;
    start(input: unknown): Promise<LaunchView>;
    dismiss(id: string): boolean;
    answerTrust(id: string, body: unknown): Promise<LaunchView | null>;
    trustDisconnected(id: string, prompt: string): void;
  };
  memory: Pick<MemoryMonitor, 'snapshot' | 'watch' | 'setOpen' | 'drop'>;
  usage: {
    snapshot(): UsageSnapshot | null;
    watch(): () => void;
    refreshJev(): Promise<void>;
    refresh(): Promise<void>;
  };
  viewer: {
    watch(clientId: string, sessionId: string | null, preview: boolean): void;
    drop(clientId: string): void;
    send(sessionId: string, input: unknown): Promise<void>;
    earlier(sessionId: string, cursor: unknown): Promise<ChatPage>;
  };
  /** VIEW-5.6: ends a Session through `fleet close`; VIEW-4: answers its prompt, or stops it. */
  sessions: {
    end(sessionId: string, target: EndTarget): Promise<EndResult>;
    /** VIEW-4.1–4.3: `fleet answer`, only while the terminal still shows that prompt untouched. */
    answer(sessionId: string, req: AnswerRequest): Promise<AnswerResult>;
    /** VIEW-4.4/4.5: Esc, through `fleet keys`, only while the Session is still in `status` (Stop: Busy; the Esc button: Needs you). */
    stop(sessionId: string, status: EscStatus): Promise<void>;
    /** VIEW-5.12–5.14: `fleet rename`, only while the Session is still Idle; `name` is already checked. */
    rename(sessionId: string, name: string): Promise<RenameResult>;
    /** VIEW-6: `fleet model`, only while the Session is still that process, Idle; `req` is already checked. */
    switchModel(sessionId: string, req: ModelSwitchRequest): Promise<ModelSwitchResult>;
    /** VIEW-7: `fleet effort`, through the model switch's gate; `req` is already checked. */
    switchEffort(sessionId: string, req: EffortSwitchRequest): Promise<EffortSwitchResult>;
  };
  /** DIFF: a Session's Changes; optional, so a server without it has no `/api/changes/watch` (404). */
  changes?: {
    watch(clientId: string, sessionId: string | null): void;
    drop(clientId: string): void;
    open(sessionId: string, body: unknown): Promise<void>;
  };
  /** VIEW-1.18: which of a batch of paths are files, for one Session's file links (VIEW-1.17). */
  files: {
    check(sessionId: string, body: unknown): Promise<PathAnswer[]>;
  };
  /** HIST: past Sessions through tb-session, and resuming one. */
  history: {
    find(q: FindQuery): Promise<HistoryPage>;
    detail(sessionId: string, harness: Harness): Promise<HistoryDetail>;
    /** HIST-2.10: an expanded result's first prompt and last message. */
    peek(sessionId: string, harness: Harness): Promise<HistoryPeek>;
    resume(input: unknown): Promise<ResumeResult>;
  };
  /** LIB: read-only Outputs and the paths learned from CLI answers. */
  library: Pick<Library, 'find' | 'indexing' | 'files'>;
  /** WORK: Tasks through tb-prod and PRs through tb-pr, read only while a tab has Work open. */
  work: {
    snapshot(): WorkSnapshot;
    /** A tab opened Work; the returned function says it closed it. */
    watch(): () => void;
    /** WORK-8.2: a forced read; never throws a command's error (WORK-7.7). */
    refresh(): Promise<RefreshAnswer>;
  };
  /**
   * TOOLS: every Tool Lookout runs. `read()` reads when the last read began a minute ago or more
   * (TOOLS-1.4), `force` for Refresh. Optional: without it, `/api/tools` is 404.
   */
  tools?: {
    snapshot(): ToolsSnapshot;
    read(opts?: { force?: boolean }): Promise<ToolsSnapshot>;
  };
  /** TOPIC: Lookout's own store of Topics; optional, so a server without it has no `/api/topics` (404). */
  topics?: Pick<Topics, 'view' | 'create' | 'update' | 'delete' | 'addMember' | 'removeMember'> & {
    /** TOPIC-9.4: Accept, Dismiss, Other Topic… or Judge again on a recommendation. */
    recommend?(action: RecommendationAction): { topicId: string | null };
  };
  /** Directory of the built UI; null in `pnpm dev`, where Vite serves it. */
  staticDir: string | null;
  keepAliveMs?: number;
}

export interface LookoutApp {
  server: Server;
  /** Pushes an event to every open UI. */
  broadcast(event: ServerEvent): void;
  /** Pushes an event to one tab's stream. */
  sendTo(clientId: string, event: ServerEvent): void;
}

const MAX_BODY = 16 * 1024;
/** A launch carries a prompt of up to 100,000 characters: up to ~600 KB of JSON-escaped UTF-8. */
const MAX_LAUNCH_BODY = 1024 * 1024;
/** A message of up to MAX_MESSAGE characters, JSON-escaped. */
const MAX_SEND_BODY = MAX_MESSAGE * 8;
/** VIEW-5.6: `{ pid, procStart }`. */
const MAX_END_BODY = 1024;
/** VIEW-4.1: up to 10 answers of 2,000 characters of text each, JSON-escaped, plus their options. */
const MAX_ANSWER_BODY = 160 * 1024;
/** VIEW-4.5: `{ status }`, the Status the Esc button was shown in. */
const MAX_STOP_BODY = 1024;
/** VIEW-5.12: `{ title }`, a name of at most 64 characters, JSON-escaped, with room for a longer one to get the 400 that says why. */
const MAX_RENAME_BODY = 4 * 1024;
/** VIEW-6, VIEW-7: `{ model, pid, procStart }` or `{ effort, pid, procStart }`. */
const MAX_MODEL_BODY = 1024;
/** DIFF-4: `{ root, path }`, each at most 4,096 characters, JSON-escaped. */
const MAX_OPEN_CHANGE_BODY = 64 * 1024;
/** VIEW-1.18: up to 100 paths of up to 1,024 characters, JSON-escaped. */
const MAX_PATHS_BODY = 64 * 1024;
/** TOPIC-1.2: notes of up to 20,000 characters, JSON-escaped (`\uXXXX` is six bytes). */
const MAX_TOPIC_BODY = 160 * 1024;

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
};

export function createApp(opts: AppOptions): LookoutApp {
  const attachments = new Attachments(opts.attachmentsDir);
  const avatars = opts.avatarsDir
    ? new Avatars({ directory: opts.avatarsDir, allowed: () => opts.work.snapshot().prs.reviewRequests.flatMap((pr) => (pr.author ? [pr.author] : [])) })
    : null;
  const clients = new Map<string, ServerResponse>();
  /** WORK-8.1: the tabs that have Work open, each with its hold on the Work poller. */
  const workOpen = new Map<string, () => void>();

  const send = (res: ServerResponse, event: ServerEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const broadcast = (event: ServerEvent) => {
    for (const res of clients.values()) send(res, event);
  };
  const sendTo = (clientId: string, event: ServerEvent) => {
    const res = clients.get(clientId);
    if (res) send(res, event);
  };
  /** WORK-2.5: the settings as sent, with what isn't stored. */
  const view = (settings: Settings): SettingsView => ({ ...settings, productiveEmailSuggestion: opts.productiveEmailSuggestion ?? null });
  opts.settings.onChange((settings) => broadcast({ type: 'settings', settings: view(settings) }));

  const handleEvents = (req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    const clientId = randomUUID();
    const { sessions, fleet } = opts.monitor.snapshot();
    send(res, { type: 'snapshot', sessions, fleet, settings: view(opts.settings.get()), launches: opts.launcher.list(),
      started: opts.launcher.recentStarts(),
      clientId,
      usage: opts.usage.snapshot(),
      memory: opts.memory.snapshot(),
      work: opts.work.snapshot(),
      ...(opts.tools ? { tools: opts.tools.snapshot() } : {}),
      ...(opts.topics ? { topics: opts.topics.view() } : {}),
    });
    clients.set(clientId, res);
    const unwatch = opts.monitor.watch();
    const unwatchMemory = opts.memory.watch();
    const unwatchUsage = opts.usage.watch(); // one usage poller for every open tab
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), opts.keepAliveMs ?? 15_000);
    req.on('close', () => {
      clearInterval(keepAlive);
      clients.delete(clientId);
      unwatchUsage();
      unwatchMemory();
      opts.memory.drop(clientId);
      workOpen.get(clientId)?.();
      workOpen.delete(clientId);
      opts.viewer.drop(clientId); // a tab that's gone stops what it was following
      opts.changes?.drop(clientId); // DIFF-3.6: and its open list
      unwatch();
    });
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const outputFile = url.pathname === '/api/library/file';
    if (outputFile) for (const [k, v] of Object.entries(OUTPUT_HEADERS)) res.setHeader(k, v);
    const verdict = guardRequest(req, opts.guard);
    if (!verdict.ok) return json(res, verdict.status, { error: verdict.reason }, outputFile);
    if (outputFile) {
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' }, true);
      try { return await opts.library.files.serve(url.searchParams.get('path') ?? '', res); }
      catch { if (!res.headersSent) json(res, 500, { error: 'This file could not be read.' }, true); else res.destroy(); return; }
    }

    const avatarMatch = /^\/api\/avatars\/([^/]{1,64})$/.exec(url.pathname);
    if (avatarMatch) {
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
      const avatar = avatars ? await avatars.get(decodeURIComponent(avatarMatch[1]!)).catch(() => null) : null;
      if (!avatar) return json(res, 404, { error: 'No avatar for that login.' });
      res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': avatar.type, 'content-length': avatar.body.length, 'cache-control': 'private, max-age=3600' });
      return res.end(avatar.body);
    }

    const route = `${req.method} ${url.pathname}`;
    switch (route) {
      case 'POST /api/attachments': {
        const name = url.searchParams.get('name');
        if (!name || name.length > 1024) return json(res, 400, { error: 'Expected a file name of 1 to 1,024 characters.' });
        if (req.headers['content-type'] !== 'application/octet-stream') return json(res, 415, { error: 'Expected application/octet-stream.' });
        const rawLength = req.headers['content-length'];
        if (rawLength === undefined) return json(res, 411, { error: 'Content-Length is required.' });
        const length = Number(rawLength);
        if (!Number.isSafeInteger(length) || length < 0) return json(res, 400, { error: 'Invalid Content-Length.' });
        if (length > MAX_ATTACHMENT_BYTES) return json(res, 413, { error: 'The file is over the 25 MB limit.' });
        try { return json(res, 201, { path: await attachments.save(name, req, length) }); }
        catch (err) {
          // Never let filesystem errors (including paths) reach the request logger.
          return json(res, err instanceof AttachmentError ? err.status : 500, { error: err instanceof AttachmentError ? err.message : `Lookout couldn't save ${name}.` });
        }
      }
      case 'GET /api/bootstrap':
        return json(res, 200, { token: opts.guard.token });
      case 'GET /api/events':
        return handleEvents(req, res);
      case 'GET /api/settings':
        return json(res, 200, view(opts.settings.get()));
      case 'PUT /api/settings': {
        const body = await readJson(req, res, MAX_BODY, null);
        if (body === NO_BODY) return;
        try {
          return json(res, 200, view(await opts.settings.update(body)));
        } catch (err) {
          if (err instanceof SettingsError) return json(res, 400, { error: err.message, field: err.field });
          throw err;
        }
      }
      case 'GET /api/harnesses':
        try {
          return json(res, 200, { harnesses: await opts.launcher.harnesses() });
        } catch (err) {
          if (err instanceof LaunchError) return json(res, err.status, { error: err.message });
          throw err;
        }
      case 'POST /api/launch': {
        const body = await readJson(req, res, MAX_LAUNCH_BODY, { error: 'The prompt is too long.', field: 'prompt' });
        if (body === NO_BODY) return;
        try {
          return json(res, 200, { launch: await opts.launcher.start(body) });
        } catch (err) {
          if (err instanceof LaunchError) return json(res, err.status, { error: err.message, field: err.field });
          throw err;
        }
      }
    }
    if (route === 'GET /api/library') return historyCall(res, () => opts.library.find(parseLibraryQuery(url.searchParams)));
    if (route === 'GET /api/library/status') return json(res, 200, { indexing: opts.library.indexing });
    // HIST-2: reads (the guard still checks Host, Origin and Sec-Fetch-Site).
    if (route === 'GET /api/history') {
      return historyCall(res, () => opts.history.find(parseFindQuery(url.searchParams)));
    }
    const pastMatch = /^\/api\/history\/(claude|codex)\/([A-Za-z0-9-]{1,128})(\/peek)?$/.exec(url.pathname);
    if (pastMatch && req.method === 'GET') {
      const [, harness, id, peek] = pastMatch;
      // HIST-2.10: what an expanded result reads, apart from HIST-3.3's read-only view.
      if (peek) return historyCall(res, () => opts.history.peek(id!, harness as Harness));
      return historyCall(res, () => opts.history.detail(id!, harness as Harness));
    }
    // HIST-3: resuming starts a process, so it's a mutation: the token and Origin, as LAUNCH's start.
    if (route === 'POST /api/history/resume') {
      const body = await readJson(req, res, MAX_BODY, null);
      if (body === NO_BODY) return;
      return historyCall(res, () => opts.history.resume(body));
    }
    // TOOLS-1.4: the Settings page opened: read the Tools when the last read began a minute ago or
    // more, and answer what's known. A read runs only `--version`, so it's a GET.
    if (route === 'GET /api/tools' && opts.tools) return json(res, 200, await opts.tools.read());
    // TOOLS-1.4: Refresh re-reads the installed versions now, joining a read in flight; the GitHub
    // release check keeps its once-a-minute limit. A POST, so the token and Origin apply.
    if (route === 'POST /api/tools/refresh' && opts.tools) return json(res, 200, await opts.tools.read({ force: true }));
    if (route === 'POST /api/usage/refresh') {
      // A window's reset time passed (USAGE-2.2): read the limits again (at most every 15 s).
      await opts.usage.refresh();
      return json(res, 200, { ok: true });
    }
    if (route === 'POST /api/usage/jev') {
      // The details opened (USAGE-2.1): check Jev again. Free: `tb-jev status` is local.
      await opts.usage.refreshJev();
      return json(res, 200, { ok: true });
    }
    // MEM-3.1: the tab's event stream owns its open breakdown, as Work's does.
    if (route === 'PUT /api/memory/watch') {
      const body = await readJson(req, res, MAX_BODY, null);
      if (body === NO_BODY) return;
      const w = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
      if (typeof w.clientId !== 'string' || !clients.has(w.clientId)) return json(res, 404, { error: 'unknown event stream' });
      if (typeof w.open !== 'boolean') return json(res, 400, { error: 'invalid open' });
      opts.memory.setOpen(w.clientId, w.open);
      return json(res, 200, { ok: true });
    }
    // WORK-8.1: a closed stream counts as closed. A PUT, so the token and Origin apply.
    if (route === 'PUT /api/work/watch') {
      const body = await readJson(req, res, MAX_BODY, null);
      if (body === NO_BODY) return;
      const w = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
      if (typeof w.clientId !== 'string' || !clients.has(w.clientId)) return json(res, 404, { error: 'unknown event stream' });
      if (typeof w.open !== 'boolean') return json(res, 400, { error: 'invalid open' });
      const held = workOpen.get(w.clientId);
      if (w.open && !held) workOpen.set(w.clientId, opts.work.watch());
      if (!w.open && held) {
        held();
        workOpen.delete(w.clientId);
      }
      return json(res, 200, { ok: true });
    }
    // WORK-8.2: Refresh runs `tb-pr refresh`, so it's a mutation (the token and Origin). It answers
    // with the outcome's plain reason only: a failure is never logged or passed on whole, since a
    // command's error carries its output (WORK-7.7). Refused while no tab has Work open (409), during
    // the cooldown or a rate limit (429).
    if (route === 'POST /api/work/refresh') {
      let answer: RefreshAnswer;
      try {
        answer = await opts.work.refresh();
      } catch {
        return json(res, 500, { ok: false, error: 'Refresh failed' });
      }
      return json(res, answer.status, answer.result);
    }
    if (route === 'PUT /api/watch') {
      const body = await readJson(req, res, MAX_BODY, null);
      if (body === NO_BODY) return;
      const w = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
      if (typeof w.clientId !== 'string' || !clients.has(w.clientId)) return json(res, 404, { error: 'unknown event stream' });
      if (w.sessionId !== null && (typeof w.sessionId !== 'string' || w.sessionId.length > 200)) {
        return json(res, 400, { error: 'invalid sessionId' });
      }
      opts.viewer.watch(w.clientId, w.sessionId, w.preview === true);
      return json(res, 200, { ok: true });
    }
    // DIFF-3.6: the tab's event stream owns its open list of changed files, as it owns Memory's breakdown.
    if (route === 'PUT /api/changes/watch' && opts.changes) {
      const body = await readJson(req, res, MAX_BODY, null);
      if (body === NO_BODY) return;
      const w = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
      if (typeof w.clientId !== 'string' || !clients.has(w.clientId)) return json(res, 404, { error: 'unknown event stream' });
      if (w.sessionId !== null && (typeof w.sessionId !== 'string' || w.sessionId.length > 200)) {
        return json(res, 400, { error: 'invalid sessionId' });
      }
      opts.changes.watch(w.clientId, w.sessionId);
      return json(res, 200, { ok: true });
    }
    // DIFF-4: opening a file's Changes runs `git` and VS Code: a mutation, so every check a POST gets.
    const openMatch = /^\/api\/sessions\/([^/]{1,200})\/changes\/open$/.exec(url.pathname);
    if (openMatch && req.method === 'POST' && opts.changes) {
      let sessionId: string;
      try {
        sessionId = decodeURIComponent(openMatch[1]!);
      } catch {
        return json(res, 400, { error: 'invalid session id' });
      }
      const body = await readJson(req, res, MAX_OPEN_CHANGE_BODY, null);
      if (body === NO_BODY) return;
      try {
        await opts.changes.open(sessionId, body);
        return json(res, 200, { ok: true });
      } catch (err) {
        if (err instanceof ChangesError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }
    const sendMatch = /^\/api\/sessions\/([^/]{1,200})\/send$/.exec(url.pathname);
    if (sendMatch && req.method === 'POST') {
      const body = await readJson(req, res, MAX_SEND_BODY, { error: 'The message is too long.', field: 'text' });
      if (body === NO_BODY) return;
      let sessionId: string;
      try {
        sessionId = decodeURIComponent(sendMatch[1]!);
      } catch {
        return json(res, 400, { error: 'invalid session id' });
      }
      try {
        await opts.viewer.send(sessionId, body);
        return json(res, 200, { ok: true });
      } catch (err) {
        // VIEW-3.7: a held send says so, and why; never what the input box holds.
        if (err instanceof ViewError) return json(res, err.status, { error: err.message, field: err.field, ...(err.held ? { kind: 'send_held', reason: err.held.reason } : {}) });
        throw err;
      }
    }
    // VIEW-5.6: ending a Session is a mutation: the token and Origin, as LAUNCH's start and
    // HIST's resume (the guard checks every non-GET). The body names the process the user
    // confirmed (`{ pid, procStart }`), so a replacement is never the one closed.
    const endMatch = /^\/api\/sessions\/([^/]{1,200})\/end$/.exec(url.pathname);
    if (endMatch && req.method === 'POST') {
      let sessionId: string;
      try {
        sessionId = decodeURIComponent(endMatch[1]!);
      } catch {
        return json(res, 400, { error: 'invalid session id' });
      }
      const body = await readJson(req, res, MAX_END_BODY, null);
      if (body === NO_BODY) return;
      try {
        return json(res, 200, await opts.sessions.end(sessionId, parseEndTarget(body)));
      } catch (err) {
        if (err instanceof EndError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }
    // VIEW-5.12: renaming types `/rename` into the Session: a mutation, so the token and Origin, as
    // sending does (the guard checks every non-GET). The name is checked before anything runs.
    const renameMatch = /^\/api\/sessions\/([^/]{1,200})\/rename$/.exec(url.pathname);
    if (renameMatch && req.method === 'POST') {
      let sessionId: string;
      try {
        sessionId = decodeURIComponent(renameMatch[1]!);
      } catch {
        return json(res, 400, { error: 'invalid session id' });
      }
      const body = await readJson(req, res, MAX_RENAME_BODY, null);
      if (body === NO_BODY) return;
      try {
        return json(res, 200, await opts.sessions.rename(sessionId, parseRenameRequest(body)));
      } catch (err) {
        if (err instanceof RenameError) return json(res, err.status, err.field ? { error: err.message, field: err.field } : { error: err.message });
        throw err;
      }
    }
    // VIEW-6, VIEW-7: switching the model or the Effort types `/model` or `/effort` into the
    // Session: a mutation, so the token and Origin, as renaming does. The body names the process the
    // menu was opened on.
    const modelMatch = /^\/api\/sessions\/([^/]{1,200})\/(model|effort)$/.exec(url.pathname);
    if (modelMatch && req.method === 'POST') {
      let sessionId: string;
      try {
        sessionId = decodeURIComponent(modelMatch[1]!);
      } catch {
        return json(res, 400, { error: 'invalid session id' });
      }
      const body = await readJson(req, res, MAX_MODEL_BODY, null);
      if (body === NO_BODY) return;
      try {
        if (modelMatch[2] === 'effort') return json(res, 200, await opts.sessions.switchEffort(sessionId, parseEffortRequest(body)));
        return json(res, 200, await opts.sessions.switchModel(sessionId, parseModelRequest(body)));
      } catch (err) {
        // VIEW-6.8, VIEW-7.8: an outcome Lookout can't be sure of says so, so the tab opens the Terminal preview.
        if (err instanceof ModelSwitchError) return json(res, err.status, err.uncertain ? { error: err.message, kind: 'uncertain' } : { error: err.message });
        throw err;
      }
    }
    // VIEW-4: answering a prompt and stopping a Session type into it: mutations, so the token and
    // Origin, as sending does (the guard checks every non-GET).
    const answerMatch = /^\/api\/sessions\/([^/]{1,200})\/(answer|stop)$/.exec(url.pathname);
    if (answerMatch && req.method === 'POST') {
      let sessionId: string;
      try {
        sessionId = decodeURIComponent(answerMatch[1]!);
      } catch {
        return json(res, 400, { error: 'invalid session id' });
      }
      try {
        if (answerMatch[2] === 'stop') {
          // VIEW-4.5: the Esc button names the Status it was shown in; Stop sends no body (Busy).
          let status: EscStatus = 'busy';
          if (req.headers['content-type'] !== undefined) {
            const body = await readJson(req, res, MAX_STOP_BODY, null);
            if (body === NO_BODY) return;
            status = parseEscStatus(body);
          }
          await opts.sessions.stop(sessionId, status);
          return json(res, 200, { ok: true });
        }
        const body = await readJson(req, res, MAX_ANSWER_BODY, { error: 'The answer is too long.', field: 'answers' });
        if (body === NO_BODY) return;
        return json(res, 200, await opts.sessions.answer(sessionId, parseAnswerRequest(body)));
      } catch (err) {
        // `stale`: the tab's read was older than another tab's answer; it holds until a newer read.
        // VIEW-10.3: text for a question with previews is a field error (`answers`).
        if (err instanceof AnswerError) return json(res, err.status, { error: err.message, ...(err.kind ? { kind: err.kind } : {}), ...(err.field ? { field: err.field } : {}) });
        throw err;
      }
    }
    // VIEW-1.18: which paths are files. It changes nothing, but its batch doesn't fit a URL, so it's
    // a POST, and the guard asks the token and Origin as for every POST.
    const pathsMatch = /^\/api\/sessions\/([^/]{1,200})\/paths$/.exec(url.pathname);
    if (pathsMatch && req.method === 'POST') {
      let sessionId: string;
      try {
        sessionId = decodeURIComponent(pathsMatch[1]!);
      } catch {
        return json(res, 400, { error: 'invalid session id' });
      }
      const body = await readJson(req, res, MAX_PATHS_BODY, null);
      if (body === NO_BODY) return;
      try {
        return json(res, 200, { paths: await opts.files.check(sessionId, body) });
      } catch (err) {
        if (err instanceof PathsError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }
    // VIEW-1.6: "Show earlier". A read: nothing is typed, so no token (the guard still checks
    // Host, Origin and Sec-Fetch-Site).
    const messagesMatch = /^\/api\/sessions\/([^/]{1,200})\/messages$/.exec(url.pathname);
    if (messagesMatch && req.method === 'GET') {
      let sessionId: string;
      try {
        sessionId = decodeURIComponent(messagesMatch[1]!);
      } catch {
        return json(res, 400, { error: 'invalid session id' });
      }
      try {
        return json(res, 200, await opts.viewer.earlier(sessionId, url.searchParams.get('before')));
      } catch (err) {
        if (err instanceof ViewError) return json(res, err.status, { error: err.message, field: err.field });
        throw err;
      }
    }
    // TOPIC-8.3: the view is a read; every change is a mutation, so the token and Origin (0003).
    if (url.pathname === '/api/topics' || url.pathname.startsWith('/api/topics/')) {
      if (!opts.topics) return json(res, 404, { error: 'not found' });
      return topicsCall(req, res, url.pathname, opts.topics);
    }
    const trust = /^\/api\/launches\/([0-9a-f-]{36})\/trust$/.exec(url.pathname);
    if (trust && req.method === 'POST') {
      const body = await readJson(req, res, 1024, null);
      if (body === NO_BODY) return;
      const disconnected = () => {
        const prompt = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).prompt : null;
        if (!res.writableEnded && typeof prompt === 'string') opts.launcher.trustDisconnected(trust[1]!, prompt);
      };
      res.once('close', disconnected);
      try {
        return json(res, 200, { launch: await opts.launcher.answerTrust(trust[1]!, body) });
      } catch (err) {
        if (err instanceof TrustError) return json(res, err.status, { error: err.message, kind: err.kind });
        throw err;
      } finally {
        res.off('close', disconnected);
      }
    }
    const dismiss = /^\/api\/launch\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (dismiss && req.method === 'DELETE') {
      return opts.launcher.dismiss(dismiss[1]!) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'no such failed launch' });
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
    if (!opts.staticDir) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('In development, open the Vite dev server instead.\n');
      return;
    }
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    return serveStatic(opts.staticDir, url.pathname, res);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      console.error('lookout: request failed', err);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      else res.end();
    });
  });
  // Only listening servers own the daily job; in-memory handler tests don't leave timers behind.
  let pruneTimer: NodeJS.Timeout | undefined;
  server.once('listening', () => {
    void attachments.prune();
    pruneTimer = setInterval(() => { void attachments.prune(); }, DAY_MS);
    pruneTimer.unref();
  });
  server.once('close', () => clearInterval(pruneTimer));
  return { server, broadcast, sendTo };
}

/**
 * TOPIC: `GET /api/topics`; `POST /api/topics`; `PUT` and `DELETE /api/topics/<id>`; `POST` and
 * `DELETE /api/topics/<id>/members`; `POST /api/topics/recommendations` (TOPIC-9.4). A refusal answers with its plain reason (TOPIC-8.4).
 */
async function topicsCall(req: IncomingMessage, res: ServerResponse, path: string, topics: NonNullable<AppOptions['topics']>): Promise<void> {
  if (path === '/api/topics/recommendations') {
    if (req.method !== 'POST' || !topics.recommend) return json(res, req.method === 'POST' ? 404 : 405, { error: req.method === 'POST' ? 'not found' : 'method not allowed' });
    const b = await readJson(req, res, MAX_TOPIC_BODY, null);
    if (b === NO_BODY) return;
    try {
      return json(res, 200, topics.recommend(parseRecommendationAction(b)));
    } catch (err) {
      if (err instanceof TopicsError) return json(res, err.status, { error: err.message });
      throw err;
    }
  }
  const match = /^\/api\/topics(?:\/([0-9a-f-]{36})(\/members)?)?$/.exec(path);
  if (!match) return json(res, 404, { error: 'not found' });
  const [, id, members] = match;
  const route = `${req.method} ${id ? (members ? 'members' : 'topic') : 'topics'}`;
  const body = async () => readJson(req, res, MAX_TOPIC_BODY, { error: 'The notes are too long.', field: 'notes' });
  try {
    switch (route) {
      case 'GET topics':
        return json(res, 200, topics.view());
      case 'POST topics': {
        const b = await body();
        if (b === NO_BODY) return;
        return json(res, 201, { topic: topics.create(parseTitle((b as Record<string, unknown> | null)?.title)) });
      }
      case 'PUT topic': {
        const b = await body();
        if (b === NO_BODY) return;
        return json(res, 200, { topic: topics.update(id!, parsePatch(b)) });
      }
      case 'DELETE topic':
        topics.delete(id!);
        return json(res, 200, { ok: true });
      case 'POST members': {
        const b = await body();
        if (b === NO_BODY) return;
        return json(res, 200, topics.addMember(id!, parseMember(b)));
      }
      case 'DELETE members': {
        const b = await body();
        if (b === NO_BODY) return;
        const { kind, ref } = parseMemberRef(b);
        topics.removeMember(id!, kind, ref);
        return json(res, 200, { ok: true });
      }
    }
  } catch (err) {
    if (err instanceof TopicsError) return json(res, err.status, { error: err.message });
    throw err;
  }
  return json(res, 405, { error: 'method not allowed' });
}

/** Answers with the result, or with a HistoryError's or LaunchError's status and message. */
async function historyCall(res: ServerResponse, call: () => Promise<unknown>): Promise<void> {
  try {
    return json(res, 200, await call());
  } catch (err) {
    if (err instanceof LibraryError || err instanceof HistoryError || err instanceof LaunchError) return json(res, err.status, { error: err.message });
    throw err;
  }
}

function json(res: ServerResponse, status: number, body: unknown, outputFile = false): void {
  res.writeHead(status, { ...SECURITY_HEADERS, ...(outputFile ? OUTPUT_HEADERS : {}), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const NO_BODY = Symbol('no body');

class BodyTooLarge extends Error {
  /** The client kept sending past the hard cap; the connection is already gone. */
  readonly aborted: boolean;
  constructor(aborted: boolean) {
    super('body too large');
    this.aborted = aborted;
  }
}

/** Past the limit, a body is read and discarded up to this many times the limit… */
const DISCARD_FACTOR = 4;
/** …or for this long, so the 413 can be read; beyond either, the connection is dropped. */
const DISCARD_MS = 5000;

/**
 * Reads a JSON body of at most `limit` bytes; on a bad one, answers the request itself and
 * returns NO_BODY. `tooLarge` is the 413 body, e.g. naming the field that made it too large.
 */
async function readJson(
  req: IncomingMessage,
  res: ServerResponse,
  limit: number,
  tooLarge: { error: string; field: string } | null,
): Promise<unknown> {
  if (!String(req.headers['content-type']).startsWith('application/json')) {
    json(res, 415, { error: 'expected application/json' });
    return NO_BODY;
  }
  let text: string;
  try {
    text = await readBody(req, limit);
  } catch (err) {
    if (err instanceof BodyTooLarge) {
      // The whole body has been read, so the client is listening: the 413 reaches it.
      if (!err.aborted) json(res, 413, tooLarge ?? { error: 'Request too large.' });
    } else {
      json(res, 400, { error: 'unreadable body' });
    }
    return NO_BODY;
  }
  try {
    return JSON.parse(text);
  } catch {
    json(res, 400, { error: 'invalid JSON' });
    return NO_BODY;
  }
}

/**
 * Reads the body. Past `limit` it keeps reading but discards, and rejects with BodyTooLarge
 * once the request ends: answering while the client is still uploading would make it see a
 * reset instead of the 413. A client that sends far more, or for too long, is cut off.
 */
function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    let timer: NodeJS.Timeout | null = null;
    const chunks: Buffer[] = [];
    const cutOff = () => {
      if (timer) clearTimeout(timer);
      req.removeAllListeners('data');
      req.removeAllListeners('end');
      req.destroy();
      reject(new BodyTooLarge(true));
    };
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= limit) {
        chunks.push(c);
        return;
      }
      if (!over) {
        over = true;
        chunks.length = 0;
        timer = setTimeout(cutOff, DISCARD_MS);
      }
      if (size > limit * DISCARD_FACTOR) cutOff();
    });
    req.on('end', () => {
      if (timer) clearTimeout(timer);
      if (over) reject(new BodyTooLarge(false));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}
