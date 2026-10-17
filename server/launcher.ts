import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { LaunchHarness, Settings } from '../shared/settings.ts';
import type { HarnessOption, LaunchView } from '../shared/types.ts';
import type { RunError, Runner } from './exec.ts';
import type { FleetRow } from './fleet.ts';
import { sessionId } from './normalize.ts';
import { sanitizeLine } from './sanitize.ts';
import { expandHome } from './settings.ts';

/** LAUNCH-4.5: a start that Fleet hasn't reported after this long becomes an error. */
export const LAUNCH_TIMEOUT_MS = 15_000;
/** Harnesses and models are cached this long. */
export const HARNESS_CACHE_MS = 10 * 60_000;
/** A completed start's Session stays known this long, for a tab that reconnects (LAUNCH-4.2). */
export const RECENT_START_MS = 60_000;

const SPAWN_TIMEOUT_MS = 20_000;
const MAX_NAME = 80;
const MAX_PROMPT = 100_000;
const MODEL_ID = /^[A-Za-z0-9._[\]/:-]{0,100}$/;
const HARNESS_LABEL: Record<LaunchHarness, string> = { claude: 'Claude Code', codex: 'Codex' };
const TERMINAL_LINES = 8;

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
  | { ok: true; tmuxSession: string | null }
  | { ok: false; kind: string; error: string | null }
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
    return { ok: true, tmuxSession: typeof r.tmux_session === 'string' && TMUX_NAME.test(r.tmux_session) ? r.tmux_session : null };
  }
  if (r.ok === false) {
    return { ok: false, kind: typeof r.kind === 'string' ? r.kind.slice(0, 40) : 'other', error: typeof r.error === 'string' ? r.error : null };
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
}

/** Fleet's tmux name rule (`core::tmux::sanitize_name`): an empty result is an error there. */
function tmuxSafe(name: string): string {
  return name
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

interface Launch extends LaunchView {
  tmuxSession: string | null;
  /** HIST-3.1: the Session it resumes, which Fleet reports under the same id. */
  resumes: string | null;
  /** Fleet's `session_starting`: started elsewhere, so no Session host of its own to read. */
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
}

/** Starts Sessions through `fleet spawn` (LAUNCH) and follows them until Fleet reports them. */
export class Launcher {
  private readonly launches = new Map<string, Launch>();
  private readonly recent = new Map<string, { sessionId: string; at: number }>();
  private harnessCache: { at: number; value: HarnessOption[] } | null = null;
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

  /** LAUNCH-3: `fleet harness list --json`, cached for 10 minutes. */
  async harnesses(): Promise<HarnessOption[]> {
    if (this.harnessCache && this.now() - this.harnessCache.at < HARNESS_CACHE_MS) return this.harnessCache.value;
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
          .filter((m): m is { id: string; label: string } => typeof m?.id === 'string' && typeof m?.label === 'string')
          .map((m) => ({ id: m.id, label: m.label }));
        if (!models.some((m) => m.id === '')) models.unshift({ id: '', label: 'Default' });
        return {
          id: h.id as LaunchHarness,
          label: typeof h.label === 'string' ? h.label : HARNESS_LABEL[h.id as LaunchHarness],
          installed: h.installed === true,
          models,
        };
      })
      .sort((a, b) => (a.id === 'claude' ? -1 : b.id === 'claude' ? 1 : 0));
    this.harnessCache = { at: this.now(), value };
    return value;
  }

  /**
   * LAUNCH-4.1: `fleet spawn --local --backend tmux …` with an argv array. Resolves once Fleet
   * has created the Session host; throws LaunchError otherwise (LAUNCH-4.4).
   */
  async start(input: unknown): Promise<LaunchView> {
    const req = await this.validate(input);
    const args = ['--local', 'spawn', '--json', '--backend', 'tmux', '--harness', req.harness, '--dir', expandHome(req.directory)];
    if (req.model) args.push('--model', req.model);
    if (req.name) args.push('--name', req.name);
    if (req.prompt) args.push('--', req.prompt);
    const title = req.name || `${HARNESS_LABEL[req.harness]} in ${basename(expandHome(req.directory))}`;
    const launch = await this.spawn({ title, harness: req.harness, directory: req.directory, resumes: null, name: req.name }, args);
    // LAUNCH-1.2: remember the choices. A failed write doesn't fail the start.
    this.opts.settings
      .update({ lastLaunch: { harness: req.harness, model: req.model, directory: req.directory } }, 'server')
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
    const args = [
      '--local', 'spawn', '--resume', req.sessionId, '--harness', req.harness, '--dir', req.directory, '--backend', 'tmux', '--json',
    ];
    return this.spawn({ title: req.title, harness: req.harness, directory: req.directory, resumes: req.sessionId, name: '' }, args);
  }

  /** Shows the "Starting…" row, runs `fleet spawn … --json`, and follows the start (LAUNCH-4). */
  private async spawn(
    init: { title: string; harness: LaunchHarness; directory: string; resumes: string | null; name: string },
    args: string[],
  ): Promise<LaunchView> {
    const launch: Launch = {
      id: randomUUID(),
      title: init.title,
      harness: init.harness,
      directory: init.directory,
      startedAt: this.now(),
      state: 'starting',
      error: null,
      terminal: null,
      tmuxSession: null,
      resumes: init.resumes,
      elsewhere: false,
      timer: null,
    };
    this.launches.set(launch.id, launch);
    // LAUNCH-4.5: the 15 s count from when the "Starting…" row appears, not from when spawn returns.
    launch.timer = setTimeout(() => this.timedOut(launch.id), this.opts.timeoutMs ?? LAUNCH_TIMEOUT_MS);
    launch.timer.unref?.();
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
        // Already past the deadline while spawn ran: the failure says why there are no lines.
        if (launch.state === 'failed' && this.launches.has(launch.id)) {
          launch.error = this.timeoutError(launch);
          this.changed();
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
    // Already past the deadline while spawn ran: its terminal can be read now.
    if (launch.state === 'failed' && this.launches.has(launch.id)) void this.attachTerminal(launch.id);
    return view(launch);
  }

  /** After each successful `fleet list`: a launch whose Session host Fleet reports has started. */
  observe(rows: readonly FleetRow[]): void {
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
      this.recent.set(launch.id, { sessionId: id, at: this.now() });
      started.push({ launchId: launch.id, sessionId: id });
    }
    if (started.length) this.changed(started);
  }

  /** Removes a failed launch's row. Its Session host keeps running. */
  dismiss(id: string): boolean {
    const launch = this.launches.get(id);
    if (!launch || launch.state !== 'failed') return false;
    this.launches.delete(id);
    this.changed();
    return true;
  }

  stop(): void {
    for (const l of this.launches.values()) if (l.timer) clearTimeout(l.timer);
  }

  /** LAUNCH-4.5: mark it failed at once; its terminal's last lines follow when they're read. */
  private timedOut(id: string): void {
    const launch = this.launches.get(id);
    if (!launch || launch.state !== 'starting') return;
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
      return `${after} It's being started elsewhere (waiting at a trust prompt, say); answer it there.`;
    }
    // Decision 0001: the UI never mentions tmux; the Session host is the Glossary's word.
    return `${after} Its Session host is still running.`;
  }

  /** Reads the Session host's screen (the only place Lookout touches tmux) and shows its end. */
  private async attachTerminal(id: string): Promise<void> {
    const launch = this.launches.get(id);
    if (!launch?.tmuxSession) return;
    let out: string;
    try {
      out = await this.opts.runner('tmux', ['capture-pane', '-p', '-t', `=${launch.tmuxSession}:`], { timeoutMs: 3000, env: this.env });
    } catch {
      return;
    }
    if (this.launches.get(id) !== launch) return; // reported or dismissed meanwhile
    launch.terminal = lastLines(out, TERMINAL_LINES);
    this.changed();
  }

  private async validate(input: unknown): Promise<{ directory: string; harness: LaunchHarness; model: string; name: string; prompt: string }> {
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
    if (!h.models.some((m) => m.id === model)) throw new LaunchError(400, `Unknown model for ${h.label}: ${model}`, 'model');
    return { directory, harness, model, name, prompt };
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
