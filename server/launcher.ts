import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { LaunchHarness, Settings } from '../shared/settings.ts';
import type { HarnessModel, HarnessOption, LaunchView } from '../shared/types.ts';
import type { RunError, Runner } from './exec.ts';
import type { FleetRow } from './fleet.ts';
import { sessionId } from './normalize.ts';
import { sanitizeLine } from './sanitize.ts';
import { EFFORT_LEVEL, MODEL_ID } from '../shared/model.ts';
import { expandHome } from './settings.ts';
import { object, parseTrustRead, TRUST_ID, TRUST_UNCERTAIN, trustCode, trustMessage } from './launch-trust.ts';

export { LAUNCH_TIMEOUT_MS } from '../shared/defaults.ts';
import { LAUNCH_TIMEOUT_MS } from '../shared/defaults.ts';
/** Harnesses and models are cached this long. */
export const HARNESS_CACHE_MS = 10 * 60_000;
/** A completed start's Session stays known this long, for a tab that reconnects (LAUNCH-4.2). */
export const RECENT_START_MS = 60_000;
/** LAUNCH-6.1: Trust prompt reads must not wait for Fleet list polls to finish. */
const TRUST_POLL_INTERVAL_MS = 2000;

const SPAWN_TIMEOUT_MS = 20_000;
const MAX_NAME = 80;
const MAX_PROMPT = 100_000;
const HARNESS_LABEL: Record<LaunchHarness, string> = { claude: 'Claude Code', codex: 'Codex' };
const TERMINAL_LINES = 8;
/** A launch id the tab chose (LAUNCH-4.2): a UUID, like the server's own. */
export const LAUNCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * VIEW-7.1: a model's Effort levels from `harness list` (Fleet's `efforts`, lowest first, and
 * `default_effort`), each a short word; none from a Fleet that predates them.
 */
function efforts(m: { efforts?: unknown; default_effort?: unknown }): Pick<HarnessModel, 'efforts' | 'defaultEffort'> {
  const list = Array.isArray(m.efforts) ? m.efforts.filter((e): e is string => typeof e === 'string' && EFFORT_LEVEL.test(e)) : [];
  const def = typeof m.default_effort === 'string' && EFFORT_LEVEL.test(m.default_effort) ? m.default_effort : null;
  return { efforts: [...new Set(list)], defaultEffort: def };
}

export class LaunchError extends Error {
  readonly status: number;
  readonly field: string | null;
  constructor(status: number, message: string, field: string | null = null) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

/**
 * TOOLS-1.2: one Harness as Fleet's `harness list --json` found it. `path` and `version` come from
 * the Fleet fork commit (docs/contracts/fleet-tools.md, F2); a Fleet without them gives null.
 */
export interface HarnessFact {
  id: LaunchHarness;
  installed: boolean;
  /** Absolute, where Fleet's login-shell lookup found it. */
  path: string | null;
  /** The first line of `<path> --version`, as Fleet read it. */
  version: string | null;
}

const MAX_HARNESS_PATH = 1024;

function harnessFact(h: unknown): HarnessFact[] {
  if (typeof h !== 'object' || h === null) return [];
  const r = h as Record<string, unknown>;
  if (r.id !== 'claude' && r.id !== 'codex') return [];
  const path =
    typeof r.path === 'string' && r.path.startsWith('/') && r.path.length <= MAX_HARNESS_PATH && !/[\p{Cc}\p{Cf}]/u.test(r.path) ? r.path : null;
  return [{ id: r.id, installed: r.installed === true, path, version: sanitizeLine(r.version, 200) }];
}

/**
 * The environment for what Lookout starts. Decision 0002: the login shell's `claude` wrapper
 * alone decides telemetry, so nothing Lookout inherited may reach the Session: not the
 * `OTEL_*` block, not Claude Code's own variables (which would also make `claude` think it is
 * nested in the Claude Session that happens to run Lookout). A tmux server that Fleet starts
 * fixes its global environment from this one.
 */
export function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === 'CLAUDECODE' || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT') continue;
    if (k.startsWith('CLAUDE_CODE_') || k.startsWith('OTEL_')) continue;
    out[k] = v;
  }
  return out;
}

/** What `fleet spawn --json` answered (Fleet docs/cli.md, "Spawning"), validated. */
export type SpawnAnswer =
  | { ok: true; tmuxSession: string | null; handle: string | null }
  | { ok: false; kind: string; error: string | null; starting: { tmuxSession: string; handle: string } | null }
  | null;

/**
 * Fleet's tmux names are `[A-Za-z0-9_-]` after sanitising (`core::tmux::sanitize_name`), which
 * sets no length: a name from a directory basename (up to 255 bytes) plus Fleet's `-<n>` suffix.
 * The bound only keeps garbage out, so it sits well above what Fleet can produce.
 */
export const MAX_TMUX_NAME = 512;
const TMUX_NAME = new RegExp(`^[A-Za-z0-9_.-]{1,${MAX_TMUX_NAME}}$`);

/** Parses `spawn --json`'s one object; null when it isn't one. */
export function parseSpawnAnswer(text: string | undefined): SpawnAnswer {
  if (!text?.trim()) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (r.ok === true) {
    return { ok: true, tmuxSession: typeof r.tmux_session === 'string' && TMUX_NAME.test(r.tmux_session) ? r.tmux_session : null, handle: paneHandle(r.handle) };
  }
  if (r.ok === false) {
    return { ok: false, kind: typeof r.kind === 'string' ? r.kind.slice(0, 40) : 'other', error: typeof r.error === 'string' ? r.error : null, starting: startingHost(r.starting) };
  }
  return null;
}

/** Fleet's own reason, safe for the UI: redacted, one line, and tmux never named (decision 0001). */
function fleetReason(text: unknown): string | null {
  const line = sanitizeLine(text, 200);
  return line ? line.replace(/tmux sessions?/gi, 'Session host').replace(/\btmux\b/gi, 'Session host') : null;
}

/**
 * Fleet's `dir_missing`: the start directory went between Lookout's check and the spawn. A
 * start reports it like any other failure; a resume opens the Session read-only (HIST-3.3).
 */
export class DirMissingError extends LaunchError {}

/** HIST-3.2: `spawn --resume` refused, because the Session is live already. */
export class SessionLiveError extends Error {
  constructor() {
    super('This Session is live already.');
  }
}

export interface ResumeRequest {
  sessionId: string;
  harness: LaunchHarness;
  /** The directory it originally started in (absolute). */
  directory: string;
  title: string;
  /** The id the tab chose for its "Starting…" row (LAUNCH-4.2); one is made up without it. */
  launchId?: string;
}

/** Fleet's tmux name rule (`core::tmux::sanitize_name`): an empty result is an error there. */
function tmuxSafe(name: string): string {
  return name
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function paneHandle(v: unknown): string | null {
  return typeof v === 'string' && /^%[0-9]{1,16}$/.test(v) ? v : null;
}
function startingHost(v: unknown): { tmuxSession: string; handle: string } | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const handle = paneHandle(r.handle);
  return typeof r.tmux_session === 'string' && TMUX_NAME.test(r.tmux_session) && handle ? { tmuxSession: r.tmux_session, handle } : null;
}

export class TrustError extends LaunchError {
  readonly kind: 'refused' | 'uncertain';
  constructor(status: number, message: string, kind: 'refused' | 'uncertain' = 'refused') { super(status, message); this.kind = kind; }
}

interface Launch extends LaunchView {
  handle: string | null;
  reading: Promise<void> | null;
  answering: boolean;
  uncertain: Set<string>;
  readDetail: string | null;
  trustEpoch: number;
  tmuxSession: string | null;
  /** HIST-3.1: the Session it resumes, which Fleet reports under the same id. */
  resumes: string | null;
  /** Fleet's `session_starting`: started elsewhere; C7 may name its Session host. */
  elsewhere: boolean;
  timer: NodeJS.Timeout | null;
}

export interface LauncherOptions {
  runner: Runner;
  fleetBin: () => string;
  settings: { get(): Settings; update(patch: unknown, from: 'server'): Promise<Settings> };
  /** Called whenever the launches change. */
  onChange(launches: LaunchView[], started: { launchId: string; sessionId: string }[]): void;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  timeoutMs?: number;
  log?: (line: string) => void;
}

/** Starts Sessions through `fleet spawn` (LAUNCH) and follows them until Fleet reports them. */
export class Launcher {
  private readonly launches = new Map<string, Launch>();
  /** Completed starts: the Session each became, and its process, so a later id change is followed. */
  private readonly recent = new Map<string, { sessionId: string; at: number; pid: number; harness: string }>();
  private harnessCache: { at: number; value: HarnessOption[]; facts: HarnessFact[] } | null = null;
  /** Bumped by `dropHarnesses`: a read started before it isn't cached. */
  private harnessEpoch = 0;
  /** The facts of the last read, cached or not (a read raced by `dropHarnesses` isn't cached). */
  private lastFacts: HarnessFact[] = [];
  private trustSupported = true;
  private stopped = false;
  private trustTimer: NodeJS.Timeout | null = null;
  private readonly opts: LauncherOptions;
  private readonly now: () => number;

  constructor(opts: LauncherOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  private get env() {
    return cleanEnv(this.opts.env ?? process.env);
  }

  list(): LaunchView[] {
    return [...this.launches.values()].map(view);
  }

  /** Starts completed in the last 60 s, and the Session each became. */
  recentStarts(): { launchId: string; sessionId: string }[] {
    const cutoff = this.now() - RECENT_START_MS;
    for (const [id, r] of this.recent) if (r.at <= cutoff) this.recent.delete(id);
    return [...this.recent].map(([launchId, r]) => ({ launchId, sessionId: r.sessionId }));
  }

  /**
   * VIEW-6: Claude Code's saved default may have changed (a model switch makes the pick the default,
   * as `/model` does): the cached list, whose "Default (…)" label may be stale, goes, and a read
   * already in flight, which may have seen the default from before, isn't cached either.
   */
  dropHarnesses(): void {
    this.harnessCache = null;
    this.harnessEpoch++;
  }

  /** LAUNCH-3: `fleet harness list --json`, cached for 10 minutes; `force` (TOOLS-1.4's Refresh) reads again and refreshes the cache. */
  async harnesses(force = false): Promise<HarnessOption[]> {
    if (!force && this.harnessCache && this.now() - this.harnessCache.at < HARNESS_CACHE_MS) return this.harnessCache.value;
    const epoch = this.harnessEpoch;
    let stdout: string;
    try {
      stdout = await this.opts.runner(this.opts.fleetBin(), ['--local', 'harness', 'list', '--json'], {
        timeoutMs: 10_000,
        env: this.env,
      });
    } catch (err) {
      throw new LaunchError(502, (err as RunError).code === 'ENOENT' ? "Fleet isn't installed." : `fleet harness list failed: ${firstLine(err)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new LaunchError(502, 'fleet harness list returned invalid JSON.');
    }
    const value = (Array.isArray(parsed) ? parsed : [])
      .filter((h): h is Record<string, unknown> => typeof h === 'object' && h !== null)
      .filter((h) => h.id === 'claude' || h.id === 'codex')
      .map((h): HarnessOption => {
        const models = (Array.isArray(h.models) ? h.models : [])
          .filter((m): m is { id: string; label: string; efforts?: unknown; default_effort?: unknown } => typeof m?.id === 'string' && typeof m?.label === 'string')
          .map((m): HarnessModel => ({ id: m.id, label: m.label, ...efforts(m) }));
        if (!models.some((m) => m.id === '')) models.unshift({ id: '', label: 'Default', efforts: [], defaultEffort: null });
        return {
          id: h.id as LaunchHarness,
          label: typeof h.label === 'string' ? h.label : HARNESS_LABEL[h.id as LaunchHarness],
          installed: h.installed === true,
          models,
        };
      })
      .sort((a, b) => (a.id === 'claude' ? -1 : b.id === 'claude' ? 1 : 0));
    const facts = (Array.isArray(parsed) ? parsed : []).flatMap((h) => harnessFact(h));
    if (epoch === this.harnessEpoch) this.harnessCache = { at: this.now(), value, facts };
    this.lastFacts = facts;
    return value;
  }

  /**
   * TOOLS-1.2: where Fleet found each Harness and the version it read there, from the same cached
   * `harness list` (docs/contracts/fleet-tools.md, F2). Throws as `harnesses()` does.
   */
  async harnessFacts(force = false): Promise<HarnessFact[]> {
    await this.harnesses(force);
    return this.harnessCache?.facts ?? this.lastFacts;
  }

  /**
   * LAUNCH-4.1: `fleet spawn --local --backend tmux …` with an argv array. Resolves once Fleet
   * has created the Session host; throws LaunchError otherwise (LAUNCH-4.4).
   */
  async start(input: unknown): Promise<LaunchView> {
    const req = await this.validate(input);
    const id = this.newId((input as Record<string, unknown> | null)?.launchId);
    const args = ['--local', 'spawn', '--json', '--backend', 'tmux', '--harness', req.harness, '--dir', expandHome(req.directory)];
    if (req.model) args.push('--model', req.model);
    if (req.effort) args.push('--effort', req.effort);
    if (req.skipPermissions) args.push('--skip-permissions');
    if (req.name) args.push('--name', req.name);
    if (req.prompt) args.push('--', req.prompt);
    const title = req.name || `${HARNESS_LABEL[req.harness]} in ${basename(expandHome(req.directory))}`;
    const launch = await this.spawn({ id, title, harness: req.harness, directory: req.directory, resumes: null, name: req.name }, args);
    // LAUNCH-1.2: remember the choices. A failed write doesn't fail the start.
    this.opts.settings
      .update({ lastLaunch: {
        harness: req.harness, model: req.model, directory: req.directory,
        byHarness: { [req.harness]: { effort: req.effort ?? null, skipPermissions: req.skipPermissions } },
      } }, 'server')
      .catch((err: unknown) => console.error('lookout: saving the last launch failed', err));
    return launch;
  }

  /**
   * HIST-3.2: this Lookout's own resume of that Session, still "Starting…" or failed (not yet
   * dismissed). A click on the past Session selects it; however long it has waited (a resume
   * stuck at a trust prompt, say), it's never started a second time.
   */
  pendingResume(sessionId: string, harness: LaunchHarness): LaunchView | null {
    for (const l of this.launches.values()) if (l.resumes === sessionId && l.harness === harness) return view(l);
    return null;
  }

  /**
   * HIST-3.1: `fleet spawn --resume` (the Fleet fork), through the same path as a start, so the
   * "Starting…" row, the 15 s failure (LAUNCH-4.5) and the environment (LAUNCH-5) are the same.
   * The caller has checked the request against tb-session and Fleet's list; Fleet refuses a
   * Session that's live anyway (SessionLiveError). A resume of the same Session this Lookout
   * already has under way is returned as it is, never spawned again; the check and the new row
   * happen in one synchronous step, so concurrent requests can't both pass it.
   */
  async resume(req: ResumeRequest): Promise<LaunchView> {
    const pending = this.pendingResume(req.sessionId, req.harness);
    if (pending) return pending;
    const id = this.newId(req.launchId);
    const args = [
      '--local', 'spawn', '--resume', req.sessionId, '--harness', req.harness, '--dir', req.directory, '--backend', 'tmux', '--json',
    ];
    return this.spawn({ id, title: req.title, harness: req.harness, directory: req.directory, resumes: req.sessionId, name: '' }, args);
  }

  /**
   * LAUNCH-4.2: the tab picks its launch's id, so it can select the "Starting…" row the moment
   * you press Start, before this answers. Without one (an older tab), one is made up.
   */
  private newId(requested: unknown): string {
    if (requested === undefined) return randomUUID();
    if (typeof requested !== 'string' || !LAUNCH_ID.test(requested)) throw new LaunchError(400, 'Invalid launch id.');
    if (this.launches.has(requested) || this.recent.has(requested)) throw new LaunchError(409, 'That launch id is taken.');
    return requested;
  }

  /** Shows the "Starting…" row, runs `fleet spawn … --json`, and follows the start (LAUNCH-4). */
  private async spawn(
    init: { id: string; title: string; harness: LaunchHarness; directory: string; resumes: string | null; name: string },
    args: string[],
  ): Promise<LaunchView> {
    const launch: Launch = {
      id: init.id,
      title: init.title,
      harness: init.harness,
      directory: init.directory,
      startedAt: this.now(),
      state: 'starting',
      trust: null,
      handle: null,
      reading: null,
      answering: false,
      uncertain: new Set(),
      readDetail: null,
      trustEpoch: 0,
      error: null,
      terminal: null,
      tmuxSession: null,
      resumes: init.resumes,
      elsewhere: false,
      timer: null,
    };
    this.launches.set(launch.id, launch);
    // LAUNCH-4.5: the 15 s count from when the "Starting…" row appears, not from when spawn returns.
    this.armTimer(launch);
    this.changed();

    let stdout: string;
    try {
      stdout = await this.opts.runner(this.opts.fleetBin(), args, { timeoutMs: SPAWN_TIMEOUT_MS, env: this.env });
    } catch (err) {
      // Fleet's `session_starting`: someone else's resume of this Session hasn't registered yet.
      // Like `session_live`, never retried; unlike it, there's no live Session to select yet, so
      // this "Starting…" row stays and follows the Session id until Fleet reports it.
      if (init.resumes !== null && spawnKind(err as RunError) === 'session_starting') {
        launch.elsewhere = true;
        const answer = parseSpawnAnswer((err as RunError).stdout);
        if (answer && !answer.ok && answer.starting) {
          launch.tmuxSession = answer.starting.tmuxSession;
          launch.handle = answer.starting.handle;
          this.scheduleTrustReads();
          await this.readTrust(launch);
        }
        // Already past the deadline while spawn ran: the failure says why there are no lines.
        if (launch.state === 'failed' && this.launches.has(launch.id)) {
          launch.error = this.timeoutError(launch);
          this.changed();
          if (launch.tmuxSession) void this.attachTerminal(launch.id);
        }
        return view(launch);
      }
      if (launch.timer) clearTimeout(launch.timer);
      this.launches.delete(launch.id);
      this.changed();
      throw spawnError(err as RunError, init.name);
    }
    const answer = parseSpawnAnswer(stdout);
    launch.tmuxSession = answer?.ok ? answer.tmuxSession : null;
    launch.handle = answer?.ok ? answer.handle : null;
    this.scheduleTrustReads();
    await this.readTrust(launch);
    // Already past the deadline while spawn ran: its terminal can be read now.
    if (launch.state === 'failed' && this.launches.has(launch.id)) void this.attachTerminal(launch.id);
    return view(launch);
  }

  /** After each successful `fleet list`: a launch whose Session host Fleet reports has started. */
  observe(rows: readonly FleetRow[]): void {
    // A Codex Session gets its session id after its first prompt, and its id changes: a completed
    // start follows it, so a tab that reconnects or reloads `/l/<id>` lands on the live id.
    for (const r of this.recent.values()) {
      const now = rows.find((row) => row.pid === r.pid && row.harness === r.harness);
      if (now) r.sessionId = sessionId(now);
    }
    const started: { launchId: string; sessionId: string }[] = [];
    for (const launch of this.launches.values()) {
      const row = rows.find(
        (r) =>
          r.harness === launch.harness &&
          ((launch.tmuxSession !== null && r.tmux_session === launch.tmuxSession) || (launch.resumes !== null && r.session_id === launch.resumes)),
      );
      if (!row) continue;
      if (launch.timer) clearTimeout(launch.timer);
      this.launches.delete(launch.id);
      const id = sessionId(row);
      this.recent.set(launch.id, { sessionId: id, at: this.now(), pid: row.pid, harness: row.harness });
      started.push({ launchId: launch.id, sessionId: id });
    }
    if (started.length) this.changed(started);
  }

  /** Removes a failed launch's row. Its Session host keeps running. */
  dismiss(id: string): boolean {
    const launch = this.launches.get(id);
    if (!launch || launch.answering || (launch.state !== 'failed' && launch.state !== 'trust')) return false;
    if (launch.timer) clearTimeout(launch.timer);
    this.launches.delete(id);
    this.changed();
    return true;
  }

  stop(): void {
    this.stopped = true;
    if (this.trustTimer) clearTimeout(this.trustTimer);
    this.trustTimer = null;
    for (const l of this.launches.values()) if (l.timer) clearTimeout(l.timer);
  }

  /** An independent cadence: even a stalled list poll cannot hold back the Trust card. */
  private scheduleTrustReads(): void {
    if (this.trustTimer || this.stopped || !this.trustSupported) return;
    if (![...this.launches.values()].some((l) => l.harness === 'claude' && l.tmuxSession && l.handle && l.state !== 'failed')) return;
    this.trustTimer = setTimeout(() => {
      this.trustTimer = null;
      this.scheduleTrustReads();
      void this.readTrusts();
    }, TRUST_POLL_INTERVAL_MS);
    this.trustTimer.unref?.();
  }

  /** LAUNCH-6.1: reads on the launcher's cadence; no overlapping read per launch. */
  async readTrusts(): Promise<void> {
    // These reads run in the background: one unexpected failure must never reject its caller.
    await Promise.allSettled([...this.launches.values()].map((l) => this.readTrust(l)));
  }

  private readTrust(l: Launch): Promise<void> {
    if (this.stopped || !this.trustSupported || this.launches.get(l.id) !== l || l.harness !== 'claude' || !l.tmuxSession || !l.handle || l.state === 'failed' || l.answering) return Promise.resolve();
    if (l.reading) return l.reading;
    const epoch = l.trustEpoch;
    l.reading = (async () => {
      let res: Record<string, unknown> | null;
      try {
        res = object(await this.opts.runner(this.opts.fleetBin(), this.trustArgs(l, '--list'), { timeoutMs: 5000, env: this.env }));
      } catch (err) {
        const e = err as RunError;
        if (typeof e?.stderr === 'string' && /error: unrecognized subcommand ['"]trust['"]/.test(e.stderr)) {
          if (this.trustSupported) this.log('lookout: trust unavailable: kind=unsupported detail=none typed=false');
          this.trustSupported = false;
        }
        res = object(e?.stdout);
      }
      if (this.stopped || this.launches.get(l.id) !== l || l.state === 'failed' || epoch !== l.trustEpoch) return;
      if (res?.detail != null && typeof res.detail !== 'string') return;
      const missing = res?.ok === false && typeof res.kind === 'string' && ['target_not_found', 'target_changed', 'host_unsupported'].includes(res.kind);
      const trust = missing ? null : parseTrustRead(res);
      if (trust === undefined) return;
      if (trust === null) {
        l.readDetail = null;
        if (l.state !== 'trust') return;
        this.waitAgain(l);
      } else {
        if (!trust.answerable && trust.detail !== l.readDetail) this.logTrust(l, 'read', null, res?.detail, false);
        l.readDetail = trust.detail;
        if (trust.id && l.uncertain.has(trust.id)) {
          trust.answerable = false;
          trust.message = TRUST_UNCERTAIN;
        }
        const changedId = l.trust?.id !== trust.id;
        if (changedId) l.terminal = null;
        l.state = 'trust';
        l.trust = trust;
        if (l.timer) clearTimeout(l.timer);
        l.timer = null;
        if (changedId && trust.message === TRUST_UNCERTAIN && trust.id) void this.attachTerminal(l.id, trust.id);
      }
      this.changed();
    })().finally(() => { l.reading = null; });
    return l.reading;
  }

  private trustArgs(l: Launch, mode: '--list' | '--accept' | '--decline'): string[] {
    return ['--local', 'trust', l.tmuxSession!, '--pane', l.handle!, '--json', mode];
  }

  /** The tab lost its answer's connection. A confirmed outcome wins; otherwise this id stays held. */
  trustDisconnected(id: string, prompt: string): void {
    const l = this.launches.get(id);
    if (l?.answering && l.trust?.id === prompt) l.uncertain.add(prompt);
  }

  /** LAUNCH-6.4–6.12: only an explicit click enters this method; Fleet checks the screen again. */
  async answerTrust(id: string, input: unknown): Promise<LaunchView | null> {
    const req = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
    if ((req.answer !== 'accept' && req.answer !== 'decline') || typeof req.prompt !== 'string' || !TRUST_ID.test(req.prompt)) throw new TrustError(400, 'Invalid trust answer.');
    const l = this.launches.get(id);
    if (!l || l.state !== 'trust' || !l.trust) throw new TrustError(409, 'The prompt is gone, so nothing was typed.');
    if (l.answering) throw new TrustError(409, 'Another tab is answering…');
    if (l.trust.id !== req.prompt) throw new TrustError(409, 'The prompt changed before Lookout answered, so nothing was typed.');
    if (l.uncertain.has(req.prompt)) throw new TrustError(409, TRUST_UNCERTAIN, 'uncertain');
    if (!l.trust.answerable) throw new TrustError(409, l.trust.message ?? 'Lookout cannot answer this prompt.');
    l.answering = true;
    l.trustEpoch++;
    l.trust = { ...l.trust, answering: req.answer, message: null };
    this.changed();
    let result: Record<string, unknown> | null;
    let runError: RunError | null = null;
    const args = [...this.trustArgs(l, req.answer === 'accept' ? '--accept' : '--decline'), '--prompt', req.prompt, '--allow-attached'];
    if (req.answer === 'decline') args.push('--close');
    try {
      result = object(await this.opts.runner(this.opts.fleetBin(), args, { timeoutMs: 15_000, env: this.env }));
    } catch (err) {
      runError = err as RunError;
      result = object(runError.stdout);
    }
    l.answering = false;
    // A monitor tick can have reported the Session while Fleet was verifying the answer.
    if (this.launches.get(id) !== l || this.stopped) return this.launches.has(id) ? view(l) : null;
    const success = !runError && result?.ok === true && result.answered === true && result.id === req.prompt && result.answer === req.answer;
    if (success && req.answer === 'accept') {
      this.waitAgain(l);
      this.changed();
      return view(l);
    }
    if (success && result && req.answer === 'decline' && typeof result.closed === 'boolean') {
      if (result.closed) {
        this.launches.delete(id);
        this.changed();
        return null;
      }
      l.state = 'failed';
      l.trust = null;
      l.error = result.close_detail === 'still_running'
        ? "Cancelled, but Claude Code didn't exit, so its Session host is still running."
        : "Cancelled, but its Session host couldn't be closed.";
      this.changed();
      await this.attachTerminal(id);
      return view(l);
    }
    const kind = trustCode(result?.kind, 'kind');
    const uncertain = l.uncertain.has(req.prompt) || runError?.timedOut || result?.ok !== false || result.typed !== false || kind === 'none' || kind === 'other' || kind === 'prompt_changed' || kind === 'outcome_uncertain';
    const message = uncertain ? TRUST_UNCERTAIN : trustMessage(result?.kind, result?.detail, result?.pane);
    if (uncertain) l.uncertain.add(req.prompt);
    l.trust = { ...l.trust, answering: null, answerable: false, message };
    this.changed();
    this.logTrust(l, req.answer, result?.kind, result?.detail, typeof result?.typed === 'boolean' ? result.typed : !!uncertain);
    if (uncertain) await this.attachTerminal(id, req.prompt);
    throw new TrustError(uncertain ? 502 : 409, message, uncertain ? 'uncertain' : 'refused');
  }

  private waitAgain(l: Launch): void {
    l.state = 'starting';
    l.trust = null;
    l.terminal = null;
    this.armTimer(l);
  }

  private armTimer(l: Launch): void {
    if (l.timer) clearTimeout(l.timer);
    l.timer = setTimeout(() => { void this.timedOut(l.id); }, this.opts.timeoutMs ?? LAUNCH_TIMEOUT_MS);
    l.timer.unref?.();
  }

  private logTrust(l: Launch, answer: string, kind: unknown, detail: unknown, typed: boolean): void {
    this.log(`lookout: trust refused: launch=${LAUNCH_ID.test(l.id) ? l.id : 'other'} answer=${answer} kind=${trustCode(kind, 'kind')} detail=${trustCode(detail, 'detail')} typed=${typed}`);
  }

  private log(line: string): void {
    try { (this.opts.log ?? console.warn)(line); } catch { /* A logger cannot change an answer's outcome. */ }
  }

  /** LAUNCH-6.2: check once more at the deadline before failing; its last lines follow. */
  private async timedOut(id: string): Promise<void> {
    const launch = this.launches.get(id);
    if (!launch || launch.state !== 'starting') return;
    // A monitor read may have captured its screen before the deadline. Wait it out, then
    // capture again: a prompt drawn in that gap must still hold the start (LAUNCH-6.2).
    if (launch.reading) await launch.reading;
    if (this.stopped || this.launches.get(id) !== launch || launch.state !== 'starting') return;
    await this.readTrust(launch);
    if (this.stopped || this.launches.get(id) !== launch || launch.state !== 'starting') return;
    launch.state = 'failed';
    launch.timer = null;
    launch.error = this.timeoutError(launch);
    this.changed();
    if (launch.tmuxSession) void this.attachTerminal(id);
  }

  /**
   * LAUNCH-4.5's message. A resume Fleet answered with `session_starting` has no Session host
   * of its own: it's being started elsewhere, so there are no terminal lines to show.
   */
  private timeoutError(launch: Launch): string {
    const after = `Fleet hasn't reported it after ${Math.round((this.opts.timeoutMs ?? LAUNCH_TIMEOUT_MS) / 1000)} s.`;
    if (launch.elsewhere && !launch.tmuxSession) {
      return `${after} It's being started in another terminal app (waiting at its Trust prompt, say); answer it there.`;
    }
    // Decision 0001: the UI never mentions tmux; the Session host is the Glossary's word.
    return `${after} Its Session host is still running.`;
  }

  /** Reads the Session host's screen (the only place Lookout touches tmux) and shows its end. */
  private async attachTerminal(id: string, prompt?: string): Promise<void> {
    const launch = this.launches.get(id);
    if (!launch?.tmuxSession) return;
    let out: string;
    try {
      out = await this.opts.runner('tmux', ['capture-pane', '-p', '-t', `=${launch.tmuxSession}:`], { timeoutMs: 3000, env: this.env });
    } catch {
      return;
    }
    if (this.launches.get(id) !== launch || (prompt && launch.trust?.id !== prompt)) return; // reported, dismissed or another prompt meanwhile
    launch.terminal = lastLines(out, TERMINAL_LINES);
    this.changed();
  }

  private async validate(input: unknown): Promise<{ directory: string; harness: LaunchHarness; model: string; name: string; prompt: string; effort: string | undefined; skipPermissions: boolean }> {
    const v = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
    const directory = typeof v.directory === 'string' ? v.directory : '';
    if (!this.opts.settings.get().startDirectories.includes(directory)) {
      throw new LaunchError(400, 'Pick one of the start directories from Settings.', 'directory');
    }
    if (v.harness !== 'claude' && v.harness !== 'codex') throw new LaunchError(400, 'Pick Claude Code or Codex.', 'harness');
    const harness = v.harness;
    const model = typeof v.model === 'string' ? v.model.trim() : '';
    if (!MODEL_ID.test(model)) throw new LaunchError(400, 'Invalid model.', 'model');
    const name = typeof v.name === 'string' ? v.name.trim() : '';
    if (name.length > MAX_NAME || /[\n\r\0]/.test(name)) throw new LaunchError(400, `A name is one line of at most ${MAX_NAME} characters.`, 'name');
    if (name && !tmuxSafe(name)) throw new LaunchError(400, 'A name needs at least one letter or digit.', 'name');
    const rawPrompt = typeof v.prompt === 'string' ? v.prompt : '';
    if (rawPrompt.includes('\0')) throw new LaunchError(400, 'Invalid prompt.', 'prompt');
    // LAUNCH-4.3: exactly as typed (indentation, trailing newline); only line endings normalized.
    const typed = rawPrompt.replace(/\r\n?/g, '\n');
    if (typed.length > MAX_PROMPT) throw new LaunchError(400, 'The prompt is too long.', 'prompt');
    const prompt = typed.trim() === '' ? '' : typed;

    const harnesses = await this.harnesses();
    const h = harnesses.find((x) => x.id === harness);
    if (!h?.installed) throw new LaunchError(400, `${HARNESS_LABEL[harness]} isn't installed.`, 'harness');
    const chosen = h.models.find((m) => m.id === model);
    if (!chosen) throw new LaunchError(400, `Unknown model for ${h.label}: ${model}`, 'model');
    if (v.effort !== undefined && (typeof v.effort !== 'string' || !chosen.efforts.includes(v.effort))) {
      throw new LaunchError(400, 'Pick an Effort listed for this model.', 'effort');
    }
    if (v.skipPermissions !== undefined && typeof v.skipPermissions !== 'boolean') {
      throw new LaunchError(400, 'Skip permissions must be a boolean.', 'skipPermissions');
    }
    return { directory, harness, model, name, prompt, effort: v.effort as string | undefined, skipPermissions: v.skipPermissions === true };
  }

  private changed(started: { launchId: string; sessionId: string }[] = []): void {
    this.opts.onChange(this.list(), started);
  }
}

function view(l: Launch): LaunchView {
  return {
    id: l.id,
    title: l.title,
    harness: l.harness,
    directory: l.directory,
    startedAt: l.startedAt,
    state: l.state,
    trust: l.trust,
    error: l.error,
    terminal: l.terminal,
  };
}

/** The last `n` non-blank lines of a terminal screen. */
function lastLines(text: string, n: number): string[] {
  return text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '')
    .slice(-n);
}

/** The `kind` of a failed `fleet spawn --json`, when it printed its object. */
function spawnKind(e: RunError): string | null {
  if (e.code === 'ENOENT' || e.timedOut) return null;
  const answer = parseSpawnAnswer(e.stdout);
  return answer && !answer.ok ? answer.kind : null;
}

/** A failed `fleet spawn --json`: its `kind` decides; its text is cleaned before the UI sees it. */
function spawnError(e: RunError, name: string): Error {
  if (e.code === 'ENOENT') return new LaunchError(502, "Fleet isn't installed.");
  if (e.timedOut) return new LaunchError(502, "Couldn't start the Session: Fleet took too long to answer.");
  const answer = parseSpawnAnswer(e.stdout);
  const kind = spawnKind(e);
  const reason = (answer && !answer.ok ? fleetReason(answer.error) : null) ?? fleetReason(e.stderr) ?? 'unknown error';
  switch (kind) {
    case 'session_live':
      return new SessionLiveError();
    // Decision 0001: the UI never names tmux, so Fleet's one expected error is reworded.
    case 'name_taken':
      return new LaunchError(409, `A Session host named ${name || 'like that'} already exists. Pick another name.`, 'name');
    case 'dir_missing':
      return new DirMissingError(502, `Couldn't start the Session: ${reason}`);
    case 'harness_unsupported':
    case 'usage':
      return new LaunchError(502, `Fleet can't do this: ${reason}`);
  }
  if (/unexpected argument '--(json|resume)'/.test(e.stderr ?? '')) {
    return new LaunchError(502, 'This Fleet is too old: update it from the fork (decision 0006).');
  }
  return new LaunchError(502, `Couldn't start the Session: ${reason}`);
}

function firstLine(err: unknown): string {
  const e = err as RunError;
  const text = (e.stderr?.trim() || e.message || 'unknown error').split('\n')[0]!;
  return text.replace(/^error:\s*/i, '');
}
