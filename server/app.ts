import { randomUUID } from 'node:crypto';
import { ChatSeen, ChatSeenError } from './chat-seen.ts';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { MAX_ATTACHMENT_BYTES } from '../shared/attachments.ts';
import { handoverText } from '../shared/handoff.ts';
import { type Settings, SettingsError, type SettingsView } from '../shared/settings.ts';
import type { AnswerRequest, AnswerResult, ChatPage, EffortSwitchRequest, EffortSwitchResult, EndResult, EndTarget, EscStatus, Harness, HarnessOption, HistoryDetail, HistoryPage, HistoryPeek, LaunchView, ModelSwitchRequest, ModelSwitchResult, RenameResult, ResumeResult, ServerEvent } from '../shared/types.ts';
import type { PathAnswer } from '../shared/files.ts';
import { REPORT_TEXT_MAX } from '../shared/bots.ts';
import { DOCUMENT_UNAVAILABLE, FILE_NOT_DOWNLOADED, FILE_SLOW, fileUnreadable } from '../shared/library.ts';
import type { ToolsSnapshot } from '../shared/tools.ts';
import type { UsageSnapshot } from '../shared/usage.ts';
import type { WorkSnapshot } from '../shared/work.ts';
import { AnswerError, parseAnswerRequest, parseEscStatus } from './answerer.ts';
import { AttachmentError, Attachments, DAY_MS } from './attachments.ts';
import { BOT_ID, type Bots, BotsError } from './bots.ts';
import { ChangesError } from './changes.ts';
import { EndError, parseEndTarget } from './closer.ts';
import { type Library } from './library.ts';
import { LibraryError, parseLibraryQuery } from './library.ts';
import { FRAMED_OUTPUT_CSP, OUTPUT_HEADERS, type TextRead } from './output-files.ts';
import { describeDocument } from './document.ts';
import type { People } from './people.ts';
import { documentType } from './documents.ts';
import { Avatars } from './avatars.ts';
import { PathsError } from './files.ts';
import { PlainError, type Plain } from './plain.ts';
import type { PlainExamplesMaker } from './plain-examples.ts';
import type { PlainSimplifier } from './plain-simplify.ts';
import { ModelSwitchError, parseEffortRequest, parseModelRequest } from './model-switch.ts';
import { RenameError, parseRenameRequest } from './renamer.ts';
import { type FindQuery, HistoryError, parseFindQuery } from './history.ts';
import { LaunchError, TrustError } from './launcher.ts';
import type { TopicLaunches } from './topic-launches.ts';
import type { HandoffLaunches } from './handoffs.ts';
import type { MemoryMonitor } from './memory.ts';
import type { PortsMonitor } from './ports.ts';
import { StopError, parseStopTarget } from './ports-stop.ts';
import type { ResMonitor } from './res.ts';
import { type KeepAwake, AwakeError } from './awake.ts';
import type { Evidence } from './evidence.ts';
import { type Setup, SetupFailure } from './setup.ts';
import type { Commands } from './commands.ts';
import { isSessionId, parsePluginSwitch, parseSkillSwitch } from '../shared/setup.ts';
import { parseAwakeRequest } from '../shared/awake.ts';
import type { SessionMonitor } from './monitor.ts';
import { type GuardConfig, guardRequest } from './security.ts';
import { type SettingsStore, expandHome } from './settings.ts';
import { serveStatic } from './static.ts';
import { type Topics, TopicsError, parseEdgeEdit, parseLink, parseMember, parseMemberRef, parsePatch, parsePositions, parseProposalAction, parseRecommendationAction, parseTitle, parseUnlink } from './topics.ts';
import type { ActivityEntry, ProposalAccept, RecommendationAction, SuggestPreview, TopicSummary } from '../shared/topics.ts';
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
    /** LAUNCH-8.4: whether the launcher can start in a directory; optional, so handler tests can leave it out. */
    startable?(directory: string, continues: unknown): Promise<boolean>;
  };
  memory: Pick<MemoryMonitor, 'snapshot' | 'watch' | 'setOpen' | 'drop'>;
  /** PORTS-1.2: the Local servers, read while any tab is connected; optional, so handler tests can leave it out. */
  ports?: Pick<PortsMonitor, 'snapshot' | 'watch' | 'stop'>;
  /** RES-1.1: `res`'s queue, read while any tab is connected; optional, so handler tests can leave it out. */
  resQueue?: Pick<ResMonitor, 'snapshot' | 'watch'>;
  /** AWAKE-1.1: keep-awake; optional, so handler tests can leave it out. */
  awake?: Pick<KeepAwake, 'snapshot' | 'watch' | 'set'>;
  /** EVID: each Session's Evidence, for a new tab; optional, so handler tests can leave it out. */
  evidence?: Pick<Evidence, 'views'>;
  /**
   * SETUP: what the Harnesses load, read when the tab opens, its two switches, and what one Session
   * loaded (SETUP-6); optional, so a server without it has no `/api/setup` (404).
   */
  setup?: Pick<Setup, 'read' | 'setSkill' | 'setPlugin' | 'readSession'>;
  /** VIEW-15, LAUNCH-8: what a `/` lists; optional, so a server without it has no such route (404). */
  commands?: Pick<Commands, 'list'>;
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
    /** HAND-2.3: the latest entries of a Session's chat, whether or not it's viewed; optional, so a server without it has no route (404). */
    latest?(sessionId: string): Promise<ChatPage>;
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
  /** PLAIN: the Spec view's Modules and Viewed marks; optional, so a server without it answers 404. */
  plain?: Pick<Plain, 'read' | 'setViewed' | 'viewedPaths' | 'prFiles'>;
  /** PLAIN-5.1, 5.4: the repos Lookout has a local clone of. */
  plainClones?: () => Promise<string[]>;
  /** PLAIN-11, 12: a Module's examples and port check, made on a press. */
  plainExamples?: Pick<PlainExamplesMaker, 'get' | 'frame' | 'start' | 'cancel'>;
  /** PLAIN-14: a Module's changed specs in simple words, made on a press. */
  plainSimple?: Pick<PlainSimplifier, 'get' | 'start' | 'cancel'>;
  /** VIEW-13.1: what you saw of each Session's chat; optional, so a server without it answers 404. */
  chatSeen?: Pick<ChatSeen, 'get' | 'set'>;
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
  /** PEOPLE-3, PEOPLE-4: the people in the Vault; optional, so a server without it has no `/api/people` (404). */
  people?: Pick<People, 'list' | 'person' | 'relist'>;
  /** PEOPLE-4.5: whether a file is under the Vault folder, said with a document's answer; none is without it. */
  inVault?(path: string, whenSlow: boolean): Promise<boolean>;
  /** BOT, INBOX: the Bots, their runs and the Reports they arrive as; optional, so a server without it has no `/api/bots` or `/api/inbox` (404). */
  bots?: Pick<Bots, 'snapshot' | 'create' | 'update' | 'remove' | 'runNow' | 'detail' | 'mark' | 'text'>;
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
  /** TOPIC-5.2: Sessions started for a Topic join it once Fleet reports them; optional, so a server without it refuses a start with a Topic. */
  topicLaunches?: Pick<TopicLaunches, 'check' | 'expect' | 'forget'>;
  /** HAND-3.3: starts from a Handover, recorded once Fleet reports them; optional, so a server without it refuses one. */
  handoffLaunches?: Pick<HandoffLaunches, 'check' | 'expect' | 'forget'>;
  /** TOPIC: Lookout's own store of Topics; optional, so a server without it has no `/api/topics` (404). */
  topics?: Pick<Topics, 'view' | 'create' | 'update' | 'delete' | 'addMember' | 'removeMember' | 'link' | 'editEdge' | 'unlink' | 'place'> & {
    /** TOPIC-15.7: "Keep in Topic": a Handover kept without a start. */
    keepHandover?(id: string, input: { prompt: string; from: string; piece: string }): void;
    /** TOPIC-9.4: Accept, Dismiss, Other Topic… or Judge again on a recommendation. */
    recommend?(action: RecommendationAction): { topicId: string | null };
    /** TOPIC-11.1, TOPIC-11.6: start a summary of the Topic, or cancel the one being written. */
    summarize?(id: string): void;
    cancelSummary?(id: string): void;
    /** TOPIC-12.3, TOPIC-11.10, TOPIC-13.1: a Topic's activity, its earlier summaries, and what's been seen. */
    activity?(id: string, before: number | null): ActivityEntry[];
    earlierSummaries?(id: string): TopicSummary[];
    seenUpTo?(id: string, upto: number): void;
    /** TOPIC-14: Suggest Topics: what a run would look at, start or cancel it, and accept or dismiss a proposal. */
    suggestPreview?(): Promise<SuggestPreview>;
    suggest?(): void;
    cancelSuggest?(): void;
    acceptProposal?(id: string, accept: ProposalAccept): { topicId: string };
    dismissProposal?(id: string): void;
  };
  /** Directory of the built UI; null in `pnpm dev`, where Vite serves it. */
  staticDir: string | null;
  /** SIDE-14: the build of the page served now, asked each time a tab connects; none means null. */
  build?(): string | null;
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
/** PORTS-4.7: `{ pid, command, startedAt, devctl }`. */
const MAX_PORTS_STOP_BODY = 1024;
const MAX_AWAKE_BODY = 256;
/** SETUP-4: a skill's name or a plugin's id, and on or off. */
const MAX_SETUP_BODY = 1024;
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
/** BOT-2.1: a prompt of up to 20,000 characters, JSON-escaped, and the rest of a Bot. */
const MAX_BOT_BODY = 192 * 1024;
/** INBOX-3.1, 4.1: `{ read, archived }`. */
const MAX_MARK_BODY = 1024;

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  // INBOX-2.9: Lookout's page may frame its own file route (`frame-src 'self'`) and nothing else; nothing frames the page.
  'content-security-policy':
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-src 'self'; frame-ancestors 'none'",
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
      build: opts.build?.() ?? null,
      usage: opts.usage.snapshot(),
      memory: opts.memory.snapshot(),
      work: opts.work.snapshot(),
      ...(opts.tools ? { tools: opts.tools.snapshot() } : {}),
      ...(opts.topics ? { topics: opts.topics.view() } : {}),
      ...(opts.ports ? { ports: opts.ports.snapshot() } : {}),
      ...(opts.resQueue ? { res: opts.resQueue.snapshot() } : {}),
      ...(opts.awake ? { awake: opts.awake.snapshot() } : {}),
      ...(opts.evidence ? { evidence: opts.evidence.views() } : {}),
      ...(opts.bots ? { bots: opts.bots.snapshot() } : {}),
    });
    clients.set(clientId, res);
    const unwatch = opts.monitor.watch();
    const unwatchMemory = opts.memory.watch();
    const unwatchPorts = opts.ports?.watch();
    const unwatchRes = opts.resQueue?.watch();
    const unwatchAwake = opts.awake?.watch();
    const unwatchUsage = opts.usage.watch(); // one usage poller for every open tab
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), opts.keepAliveMs ?? 15_000);
    req.on('close', () => {
      clearInterval(keepAlive);
      clients.delete(clientId);
      unwatchUsage();
      unwatchMemory();
      unwatchPorts?.();
      unwatchRes?.();
      unwatchAwake?.();
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
    // INBOX-2.9: `frame=1` is the same route for a Report's frame; without it nothing differs from LIB-3.3's tab.
    const outputFile = url.pathname !== '/api/library/file' ? false : url.searchParams.get('frame') === '1' ? 'frame' : 'tab';
    if (outputFile) for (const [k, v] of Object.entries(OUTPUT_HEADERS)) res.setHeader(k, v);
    if (outputFile === 'frame') res.setHeader('content-security-policy', FRAMED_OUTPUT_CSP);
    const verdict = guardRequest(req, opts.guard);
    if (!verdict.ok) return json(res, verdict.status, { error: verdict.reason }, outputFile);
    if (outputFile) {
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' }, outputFile);
      try { return await opts.library.files.serve(url.searchParams.get('path') ?? '', res, outputFile === 'frame'); }
      catch { if (!res.headersSent) json(res, 500, { error: 'This file could not be read.' }, outputFile); else res.destroy(); return; }
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
        // TOPIC-5.2: the Topic the Session joins, checked first and expected before the start is
        // sent, so a Fleet report that comes before this answer still finds it.
        const v = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
        // HAND-3.3: the Session a start from a Handover continues, checked before anything is expected.
        let continues;
        try {
          continues = opts.handoffLaunches?.check(v.continues) ?? null;
        } catch (err) {
          return json(res, 400, { error: err instanceof Error ? err.message : 'Invalid Session to continue.', field: 'continues' });
        }
        if (v.continues !== undefined && v.continues !== null && !opts.handoffLaunches) return json(res, 400, { error: 'Hand-offs are off on this server.', field: 'continues' });
        if (continues && typeof v.launchId !== 'string') return json(res, 400, { error: 'A start from a Handover needs its launch id.', field: 'continues' });
        let launchId: string | null = null;
        if (v.topic !== undefined && v.topic !== null) {
          if (!opts.topicLaunches) return json(res, 400, { error: 'Topics are off on this server.', field: 'topic' });
          let topic;
          try {
            topic = opts.topicLaunches.check(v.topic);
          } catch (err) {
            if (err instanceof TopicsError) return json(res, err.status, { error: err.message, field: 'topic' });
            throw err;
          }
          if (topic) {
            if (typeof v.launchId !== 'string') return json(res, 400, { error: 'A start for a Topic needs its launch id.', field: 'topic' });
            // TOPIC-15.1: a start from a Handover: the Topic keeps the Handover as it was started.
            const kept = continues && typeof v.prompt === 'string' ? { handover: handoverText(v.prompt), from: continues.title, piece: continues.piece ?? '' } : null;
            if (!opts.topicLaunches.expect(v.launchId, topic, kept)) return json(res, 409, { error: 'That launch id is taken.' });
            launchId = v.launchId;
          }
        }
        let handoffId: string | null = null;
        if (continues) {
          if (!opts.handoffLaunches!.expect(v.launchId as string, continues)) {
            if (launchId) opts.topicLaunches?.forget(launchId);
            return json(res, 409, { error: 'That launch id is taken.' });
          }
          handoffId = v.launchId as string;
        }
        try {
          return json(res, 200, { launch: await opts.launcher.start(body) });
        } catch (err) {
          if (launchId) opts.topicLaunches?.forget(launchId);
          if (handoffId) opts.handoffLaunches?.forget(handoffId);
          if (err instanceof LaunchError) return json(res, err.status, { error: err.message, field: err.field });
          throw err;
        }
      }
    }
    if (route === 'GET /api/library') return historyCall(res, () => opts.library.find(parseLibraryQuery(url.searchParams)));
    if (route === 'GET /api/library/status') return json(res, 200, { indexing: opts.library.indexing });
    // DOC-3.1: a file for the Document view: its Type and whether it's there; nothing about a path the server didn't list.
    if (route === 'GET /api/doc') {
      const doc = await describeDocument(opts.library, url.searchParams.get('path') ?? '', { inVault: opts.inVault, relistPerson: opts.people ? (path) => opts.people!.relist(path) : undefined });
      return doc ? json(res, 200, doc) : json(res, 404, { error: DOCUMENT_UNAVAILABLE });
    }
    // DOC-3.2: a listed Markdown file's text, at most its first megabyte, and whether it was cut.
    if (route === 'GET /api/library/text') {
      return sendText(res, await opts.library.files.text(url.searchParams.get('path') ?? '', REPORT_TEXT_MAX), DOCUMENT_UNAVAILABLE);
    }
    // PEOPLE-3.2: the Persons of the Vault, or why there are none; read from folder and file names at each ask (PEOPLE-3.4).
    if (route === 'GET /api/people' && opts.people) return json(res, 200, await opts.people.list());
    // PEOPLE-4.2, 4.3: one Person's notes by name; they are listed for the Document view (PEOPLE-4.4).
    const personMatch = opts.people && req.method === 'GET' ? /^\/api\/people\/([^/]{1,1024})$/.exec(url.pathname) : null;
    if (personMatch) {
      let name: string;
      try {
        name = decodeURIComponent(personMatch[1]!);
      } catch {
        return json(res, 400, { error: 'Not a name.' });
      }
      return json(res, 200, await opts.people!.person(name));
    }
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
    // SETUP-1.8: the tab opened, or came back: a fresh read of the files. It only reads, so it's a GET.
    if (route === 'GET /api/setup' && opts.setup) return json(res, 200, await opts.setup.read());
    // SETUP-6.4: This Session shows, or its Session ended a turn: a fresh read of its Transcript.
    if (req.method === 'GET' && url.pathname.startsWith('/api/setup/session/') && opts.setup) {
      const id = url.pathname.slice('/api/setup/session/'.length);
      if (!isSessionId(id)) return json(res, 400, { error: 'not a Claude Code session id' });
      return json(res, 200, await opts.setup.readSession(id));
    }
    // LAUNCH-8: the `/` list for the launcher's prompt: the Harness chosen, in a directory the
    // launcher can start in (LAUNCH-8.4), without the commands that open a dialog (LAUNCH-8.2). A read.
    if (route === 'GET /api/launch/commands' && opts.commands) {
      const harness = url.searchParams.get('harness');
      const directory = url.searchParams.get('directory') ?? '';
      if (harness !== 'claude' && harness !== 'codex') return json(res, 400, { error: 'Pick Claude Code or Codex.', field: 'harness' });
      const session = url.searchParams.get('session');
      const continues = session ? { sessionId: session, harness: url.searchParams.get('sessionHarness') } : null;
      if (!(await opts.launcher.startable?.(directory, continues))) return json(res, 400, { error: 'Pick one of the start directories from Settings.', field: 'directory' });
      return json(res, 200, await opts.commands.list(harness, expandHome(directory), { dialogs: false }));
    }
    // VIEW-15: the `/` list for a Session's composer. The Harness and directory are the server's own,
    // from its last list of Sessions, never the tab's (VIEW-15.12). A read: nothing is typed.
    const commandsMatch = /^\/api\/sessions\/([^/]{1,200})\/commands$/.exec(url.pathname);
    if (commandsMatch && req.method === 'GET' && opts.commands) {
      let sessionId: string;
      try {
        sessionId = decodeURIComponent(commandsMatch[1]!);
      } catch {
        return json(res, 400, { error: 'invalid session id' });
      }
      const row = opts.monitor.snapshot().sessions.find((s) => s.id === sessionId);
      if (!row) return json(res, 404, { error: "This Session isn't running." });
      return json(res, 200, await opts.commands.list(row.harness, row.cwd));
    }
    // SETUP-4: a switch changes a Harness's configuration, so it's a mutation: the token and Origin
    // (the guard checks every non-GET). The answer is the read that follows it.
    if ((route === 'POST /api/setup/skill' || route === 'POST /api/setup/plugin') && opts.setup) {
      const body = await readJson(req, res, MAX_SETUP_BODY, null);
      if (body === NO_BODY) return;
      try {
        if (route === 'POST /api/setup/skill') {
          const skill = parseSkillSwitch(body);
          if (!skill) return json(res, 400, { error: 'name must be a skill name and on a boolean' });
          return json(res, 200, { snapshot: await opts.setup.setSkill(skill.name, skill.on) });
        }
        const plugin = parsePluginSwitch(body);
        if (!plugin) return json(res, 400, { error: 'id must be a plugin id (name@marketplace) and on a boolean' });
        return json(res, 200, { snapshot: await opts.setup.setPlugin(plugin.id, plugin.on) });
      } catch (err) {
        if (err instanceof SetupFailure) return json(res, err.status, { error: err.message });
        throw err;
      }
    }
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
    // PLAIN-1, 2: a Module of a live Session's Checkout or of a PR, read only (PLAIN-6).
    if (route === 'GET /api/plain' && opts.plain) {
      const q = url.searchParams;
      try {
        return json(res, 200, await opts.plain.read(plainSourceOf(q), q.get('path'), q.get('fresh') === '1'));
      } catch (err) {
        if (err instanceof PlainError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }
    // VIEW-13.1: the last entry of a Session's chat you saw.
    if (route === 'GET /api/chat-seen' && opts.chatSeen) {
      try {
        return json(res, 200, { seen: await opts.chatSeen.get(url.searchParams.get('session')) });
      } catch (err) {
        if (err instanceof ChatSeenError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }
    // VIEW-13.1: kept as you leave the chat: a write, so every check a POST gets.
    if (route === 'POST /api/chat-seen' && opts.chatSeen) {
      const body = await readJson(req, res, MAX_OPEN_CHANGE_BODY, null);
      if (body === NO_BODY) return;
      const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
      try {
        await opts.chatSeen.set(b.session, b.cursor, b.at, b.left);
        return json(res, 200, { ok: true });
      } catch (err) {
        if (err instanceof ChatSeenError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }
    // PLAIN-3.3: which of a Checkout's changed Modules are Viewed.
    if (route === 'GET /api/plain/viewed' && opts.plain) {
      const q = url.searchParams;
      try {
        return json(res, 200, { paths: await opts.plain.viewedPaths(q.get('session') ?? '', q.get('checkout') ?? '') });
      } catch (err) {
        if (err instanceof PlainError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }
    // PLAIN-5.1: a PR's changed Modules, fetched from GitHub into a local clone (PLAIN-5.2).
    if (route === 'GET /api/plain/pr' && opts.plain) {
      const q = url.searchParams;
      try {
        return json(res, 200, await opts.plain.prFiles(q.get('repo'), q.get('pr'), q.get('fresh') === '1'));
      } catch (err) {
        if (err instanceof PlainError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }
    // PLAIN-5.4: which repos have a local clone, so a PR without one has no "Specs" button.
    if (route === 'GET /api/plain/clones' && opts.plainClones) {
      return json(res, 200, { repos: await opts.plainClones() });
    }
    // PLAIN-4.1: ticking or clearing Viewed writes a file: a mutation, so every check a POST gets.
    if (route === 'POST /api/plain/viewed' && opts.plain) {
      const body = await readJson(req, res, MAX_OPEN_CHANGE_BODY, null);
      if (body === NO_BODY) return;
      const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
      try {
        const source = b.repo !== undefined ? { kind: 'pr', repo: b.repo, number: b.pr } : { kind: 'session', session: b.session, checkout: b.checkout };
        await opts.plain.setViewed(source, b.path, b.key, b.viewed);
        return json(res, 200, { ok: true });
      } catch (err) {
        if (err instanceof PlainError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }
    // PLAIN-11.9, 11.12, 11.13: a Module's examples and the run's state. A read.
    if (route === 'GET /api/plain/examples' && opts.plainExamples) {
      const q = url.searchParams;
      try {
        return json(res, 200, await opts.plainExamples.get(plainSourceOf(q), q.get('path')));
      } catch (err) {
        if (err instanceof PlainError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }
    // PLAIN-11.10: a kept frame, by the Module's key and its name; nothing else is served from there.
    if (route === 'GET /api/plain/examples/frame' && opts.plainExamples) {
      const bytes = await opts.plainExamples.frame(url.searchParams.get('key'), url.searchParams.get('name'));
      if (!bytes) return json(res, 404, { error: 'No such picture.' });
      res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'image/jpeg', 'content-length': bytes.length, 'cache-control': 'private, max-age=86400, immutable' });
      return void res.end(bytes);
    }
    // PLAIN-11.14: the press runs the Checkout's tests and `claude -p`: a mutation, so the token and
    // Origin. The body names the Module only by its source and path (PLAIN-6.1).
    if (route === 'POST /api/plain/examples' && opts.plainExamples) {
      const body = await readJson(req, res, MAX_OPEN_CHANGE_BODY, null);
      if (body === NO_BODY) return;
      const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
      try {
        const source = b.repo !== undefined ? { kind: 'pr', repo: b.repo, number: b.pr } : { kind: 'session', session: b.session, checkout: b.checkout };
        await opts.plainExamples.start(source, b.path);
        return json(res, 202, { ok: true });
      } catch (err) {
        if (err instanceof PlainError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }
    // PLAIN-11.13: Cancel stops the run going, whichever Module's.
    if (route === 'POST /api/plain/examples/cancel' && opts.plainExamples) {
      opts.plainExamples.cancel();
      return json(res, 200, { ok: true });
    }
    // PLAIN-14.12, 14.13: a Module's simplified version and its run's state. A read.
    if (route === 'GET /api/plain/simple' && opts.plainSimple) {
      const q = url.searchParams;
      try {
        return json(res, 200, await opts.plainSimple.get(plainSourceOf(q), q.get('path')));
      } catch (err) {
        if (err instanceof PlainError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }
    // PLAIN-14.14: the press runs `claude -p` and its cancel stops it: mutations, so the token and
    // Origin. The body names the Module only by its source and path (PLAIN-6.1).
    if ((route === 'POST /api/plain/simple' || route === 'POST /api/plain/simple/cancel') && opts.plainSimple) {
      const body = await readJson(req, res, MAX_OPEN_CHANGE_BODY, null);
      if (body === NO_BODY) return;
      const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
      try {
        const source = b.repo !== undefined ? { kind: 'pr', repo: b.repo, number: b.pr } : { kind: 'session', session: b.session, checkout: b.checkout };
        if (route === 'POST /api/plain/simple') {
          await opts.plainSimple.start(source, b.path);
          return json(res, 202, { ok: true });
        }
        await opts.plainSimple.cancel(source, b.path);
        return json(res, 200, { ok: true });
      } catch (err) {
        if (err instanceof PlainError) return json(res, err.status, { error: err.message });
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
    // PORTS-4: stopping a Local server signals processes, so it's a mutation: the token and Origin
    // (the guard checks every non-GET). The body names the row the dialog opened on (PORTS-4.7).
    if (url.pathname === '/api/ports/stop' && req.method === 'POST') {
      if (!opts.ports) return json(res, 404, { error: 'not found' });
      const body = await readJson(req, res, MAX_PORTS_STOP_BODY, null);
      if (body === NO_BODY) return;
      try {
        return json(res, 200, await opts.ports.stop(parseStopTarget(body)));
      } catch (err) {
        if (err instanceof StopError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }
    // AWAKE-1.1: keep-awake starts and ends processes on the Mac, so it's a mutation: the token and
    // Origin (the guard checks every non-GET). AWAKE-3.1, 3.2: a refusal is 409 with why.
    if (url.pathname === '/api/awake' && req.method === 'POST') {
      if (!opts.awake) return json(res, 404, { error: 'not found' });
      const body = await readJson(req, res, MAX_AWAKE_BODY, null);
      if (body === NO_BODY) return;
      const request = parseAwakeRequest(body);
      if (!request) return json(res, 400, { error: 'mode must be off, awake or lid' });
      try {
        return json(res, 200, await opts.awake.set(request.mode, request.replace));
      } catch (err) {
        if (err instanceof AwakeError) return json(res, err.status, err.kind ? { error: err.message, kind: err.kind } : { error: err.message });
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
        const answers = await opts.files.check(sessionId, body);
        // DOC-3.1: a document it answers as a file is listed for the routes that read one; the check itself still returns no contents.
        for (const a of answers) if (a.exists && a.absolute && documentType(a.absolute)) opts.library.files.allow(a.absolute);
        return json(res, 200, { paths: answers });
      } catch (err) {
        if (err instanceof PathsError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }
    // HAND-2.3: a Session's latest chat entries, whether or not a tab views it: where the
    // Handover is read from once its Turn ends. A read, as "Show earlier" is.
    const latestMatch = /^\/api\/sessions\/([^/]{1,200})\/latest$/.exec(url.pathname);
    if (latestMatch && req.method === 'GET' && opts.viewer.latest) {
      let sessionId: string;
      try {
        sessionId = decodeURIComponent(latestMatch[1]!);
      } catch {
        return json(res, 400, { error: 'invalid session id' });
      }
      try {
        return json(res, 200, await opts.viewer.latest!(sessionId));
      } catch (err) {
        if (err instanceof ViewError) return json(res, err.status, { error: err.message, field: err.field });
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
    // BOT, INBOX: reading a Report is a read; a Bot made, changed, deleted or run, and a Report
    // marked, are mutations, so the token and Origin (0003; the guard checks every non-GET).
    if (url.pathname === '/api/bots' || url.pathname.startsWith('/api/bots/') || url.pathname.startsWith('/api/inbox/')) {
      if (!opts.bots) return json(res, 404, { error: 'not found' });
      return botsCall(req, res, url, opts.bots);
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
 * BOT: `POST /api/bots` (New Bot); `PUT` and `DELETE /api/bots/<id>` (Edit, Turn off and on, Delete);
 * `POST /api/bots/<id>/run` (Run now). INBOX: `GET /api/inbox/<run id>` (a Report, read), `PUT
 * /api/inbox/<run id>` (read, archived), `GET /api/inbox/text?path=` (a Markdown Report's text).
 * A refusal answers with its plain reason and, for a field of the dialog, the field (BOT-2.2).
 */
async function botsCall(req: IncomingMessage, res: ServerResponse, url: URL, bots: NonNullable<AppOptions['bots']>): Promise<void> {
  const path = url.pathname;
  try {
    // INBOX-2.4: at most its first megabyte, as text, and whether it was cut; never another extension.
    if (path === '/api/inbox/text') {
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
      return sendText(res, await bots.text(url.searchParams.get('path') ?? ''), 'This file is not available.');
    }
    const report = /^\/api\/inbox\/([^/]{1,64})$/.exec(path);
    if (report) {
      const id = report[1]!;
      if (!BOT_ID.test(id)) return json(res, 404, { error: 'This Report is gone.' });
      if (req.method === 'GET') return json(res, 200, await bots.detail(id));
      if (req.method !== 'PUT') return json(res, 405, { error: 'method not allowed' });
      const b = await readJson(req, res, MAX_MARK_BODY, null);
      if (b === NO_BODY) return;
      return json(res, 200, { run: bots.mark(id, b) });
    }
    const match = /^\/api\/bots(?:\/([^/]{1,64})(\/run)?)?$/.exec(path);
    if (!match) return json(res, 404, { error: 'not found' });
    const [, id, run] = match;
    if (id !== undefined && !BOT_ID.test(id)) return json(res, 404, { error: 'This Bot is gone.' });
    const body = () => readJson(req, res, MAX_BOT_BODY, { error: 'The prompt is too long.', field: 'prompt' });
    switch (`${req.method} ${id === undefined ? 'bots' : run ? 'run' : 'bot'}`) {
      case 'POST bots': {
        const b = await body();
        if (b === NO_BODY) return;
        return json(res, 200, { bot: await bots.create(b) });
      }
      case 'PUT bot': {
        const b = await body();
        if (b === NO_BODY) return;
        return json(res, 200, { bot: await bots.update(id!, b) });
      }
      case 'DELETE bot':
        bots.remove(id!);
        return json(res, 200, { ok: true });
      // BOT-4.2: Run now sends no body; it answers once the start has, with the run as it is then.
      case 'POST run':
        return json(res, 200, { run: await bots.runNow(id!) });
    }
  } catch (err) {
    if (err instanceof BotsError) return json(res, err.status, err.field ? { error: err.message, field: err.field } : { error: err.message });
    throw err;
  }
  return json(res, 405, { error: 'method not allowed' });
}

/** TOPIC-14: Suggest Topics' routes. A run goes on after the answer; every tab hears it through `topics`. */
async function suggestCall(req: IncomingMessage, res: ServerResponse, path: string, topics: NonNullable<AppOptions['topics']>): Promise<void> {
  try {
    if (path === '/api/topics/suggest') {
      if (req.method === 'GET') {
        if (!topics.suggestPreview) return json(res, 404, { error: 'not found' });
        return json(res, 200, await topics.suggestPreview());
      }
      if (req.method === 'POST') {
        if (!topics.suggest) return json(res, 404, { error: 'not found' });
        topics.suggest();
        return json(res, 202, { ok: true });
      }
      if (req.method === 'DELETE') {
        topics.cancelSuggest?.();
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: 'method not allowed' });
    }
    const id = decodeURIComponent(path.slice('/api/topics/suggest/'.length));
    if (!/^\d{1,12}:\d{1,3}$/.test(id)) return json(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
    const b = await readJson(req, res, MAX_TOPIC_BODY, null);
    if (b === NO_BODY) return;
    const action = parseProposalAction(b);
    if (action.action === 'dismiss') {
      if (!topics.dismissProposal) return json(res, 404, { error: 'not found' });
      topics.dismissProposal(id);
      return json(res, 200, { ok: true });
    }
    if (!topics.acceptProposal) return json(res, 404, { error: 'not found' });
    return json(res, 200, topics.acceptProposal(id, action.accept));
  } catch (err) {
    if (err instanceof TopicsError) return json(res, err.status, { error: err.message });
    if (err instanceof HistoryError) return json(res, err.status, { error: err.message });
    throw err;
  }
}

/**
 * TOPIC: `GET /api/topics`; `POST /api/topics`; `PUT` and `DELETE /api/topics/<id>`; `POST` and
 * `DELETE /api/topics/<id>/members`; `POST`, `PUT` and `DELETE /api/topics/<id>/edges` (TOPIC-6);
 * `PUT /api/topics/positions` (TOPIC-7.2); `POST /api/topics/recommendations` (TOPIC-9.4); `POST`
 * and `DELETE /api/topics/<id>/summary` (TOPIC-11); `GET /api/topics/<id>/activity`, `GET
 * /api/topics/<id>/summaries` and `PUT /api/topics/<id>/seen` (slice 7). A refusal answers with its
 * plain reason (TOPIC-8.4).
 */
async function topicsCall(req: IncomingMessage, res: ServerResponse, path: string, topics: NonNullable<AppOptions['topics']>): Promise<void> {
  // TOPIC-14: `GET`, `POST` and `DELETE /api/topics/suggest`, and `POST /api/topics/suggest/<proposal id>`.
  if (path === '/api/topics/suggest' || path.startsWith('/api/topics/suggest/')) return suggestCall(req, res, path, topics);
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
  if (path === '/api/topics/positions') {
    if (req.method !== 'PUT') return json(res, 405, { error: 'method not allowed' });
    const b = await readJson(req, res, MAX_TOPIC_BODY, null);
    if (b === NO_BODY) return;
    try {
      topics.place(parsePositions(b));
      return json(res, 200, { ok: true });
    } catch (err) {
      if (err instanceof TopicsError) return json(res, err.status, { error: err.message });
      throw err;
    }
  }
  const match = /^\/api\/topics(?:\/([0-9a-f-]{36})(?:\/(members|edges|summary|summaries|activity|seen|handovers))?)?$/.exec(path);
  if (!match) return json(res, 404, { error: 'not found' });
  const [, id, sub] = match;
  const route = `${req.method} ${id ? (sub ?? 'topic') : 'topics'}`;
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
      case 'POST edges': {
        const b = await body();
        if (b === NO_BODY) return;
        const { to, label } = parseLink(b);
        topics.link(id!, to, label);
        return json(res, 201, { ok: true });
      }
      case 'PUT edges': {
        const b = await body();
        if (b === NO_BODY) return;
        topics.editEdge(id!, parseEdgeEdit(b));
        return json(res, 200, { ok: true });
      }
      case 'DELETE edges': {
        const b = await body();
        if (b === NO_BODY) return;
        topics.unlink(id!, parseUnlink(b).other);
        return json(res, 200, { ok: true });
      }
      // TOPIC-15.7: "Keep in Topic", from the launcher with a Handover.
      case 'POST handovers': {
        if (!topics.keepHandover) return json(res, 404, { error: 'not found' });
        const b = await body();
        if (b === NO_BODY) return;
        const v = (typeof b === 'object' && b !== null ? b : {}) as Record<string, unknown>;
        const piece = v.piece ?? '';
        if (typeof v.prompt !== 'string' || typeof v.from !== 'string' || typeof piece !== 'string') return json(res, 400, { error: 'Expected { prompt, from, piece }.' });
        topics.keepHandover(id!, { prompt: v.prompt, from: v.from, piece });
        return json(res, 201, { ok: true });
      }
      // TOPIC-11.1: the run goes on after the answer; every tab hears how it went through `topics`.
      case 'POST summary':
        if (!topics.summarize) return json(res, 404, { error: 'not found' });
        topics.summarize(id!);
        return json(res, 202, { ok: true });
      case 'DELETE summary':
        if (!topics.cancelSummary) return json(res, 404, { error: 'not found' });
        topics.cancelSummary(id!);
        return json(res, 200, { ok: true });
      // TOPIC-12.3: newest first, a page at a time, before an entry id.
      case 'GET activity': {
        if (!topics.activity) return json(res, 404, { error: 'not found' });
        const before = new URL(req.url ?? '/', 'http://localhost').searchParams.get('before');
        const n = before === null ? null : Number(before);
        if (n !== null && !(Number.isSafeInteger(n) && n > 0)) return json(res, 400, { error: 'Before which entry?' });
        return json(res, 200, { entries: topics.activity(id!, n) });
      }
      case 'GET summaries':
        if (!topics.earlierSummaries) return json(res, 404, { error: 'not found' });
        return json(res, 200, { summaries: topics.earlierSummaries(id!) });
      // TOPIC-13.1: seen up to the newest entry the view showed.
      case 'PUT seen': {
        if (!topics.seenUpTo) return json(res, 404, { error: 'not found' });
        const b = await body();
        if (b === NO_BODY) return;
        const upto = (b as Record<string, unknown> | null)?.upto;
        if (typeof upto !== 'number' || !Number.isSafeInteger(upto) || upto < 0) return json(res, 400, { error: 'Seen up to which entry?' });
        topics.seenUpTo(id!, upto);
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

/**
 * `outputFile`: the file route's own answers carry its sandbox (LIB-3.3); for a Report's frame
 * (INBOX-2.9) they also say only Lookout's page may frame them, without `X-Frame-Options`.
 */
function json(res: ServerResponse, status: number, body: unknown, outputFile: false | 'tab' | 'frame' = false): void {
  const headers: Record<string, string> = { ...SECURITY_HEADERS, ...(outputFile ? OUTPUT_HEADERS : {}), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (outputFile === 'frame') {
    delete headers['x-frame-options'];
    headers['content-security-policy'] = FRAMED_OUTPUT_CSP;
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

/**
 * INBOX-2.4, DOC-3.2: a Markdown file's text, and whether it was cut. `unavailable`: what a file
 * Lookout doesn't show answers (404). DOC-3.4: a file that is one, and can't be had right now, says
 * why: macOS wouldn't fetch it from the cloud (503), it hasn't arrived in time (504), or its read
 * failed (500).
 */
function sendText(res: ServerResponse, file: TextRead, unavailable: string): void {
  if (file === null) return json(res, 404, { error: unavailable });
  if ('trouble' in file) {
    if (file.trouble === 'not-downloaded') return json(res, 503, { error: FILE_NOT_DOWNLOADED });
    if (file.trouble === 'slow') return json(res, 504, { error: FILE_SLOW });
    return json(res, 500, { error: fileUnreadable(file.code, file.cloud) });
  }
  res.writeHead(200, {
    ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'content-length': file.body.length, 'cache-control': 'no-store',
    ...(file.truncated ? { 'x-lookout-truncated': '1' } : {}),
  });
  res.end(file.body);
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

/** PLAIN-1.1, PLAIN-5: a Spec view's source from its query: `repo` and `pr`, else `session` and `checkout`. */
function plainSourceOf(q: URLSearchParams): unknown {
  if (q.has('repo')) return { kind: 'pr', repo: q.get('repo'), number: q.get('pr') };
  return { kind: 'session', session: q.get('session') ?? '', checkout: q.get('checkout') ?? '' };
}
