import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { LaunchHarness, Settings } from '../shared/settings.ts';
import type { HarnessOption, LaunchView } from '../shared/types.ts';
import type { RunError, Runner } from './exec.ts';
import type { FleetRow } from './fleet.ts';
import { sessionId } from './normalize.ts';
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

/** Fleet's spawn prints `spawned tmux session <name>  (attach: …) in <dir>`; no `--json`. */
export function parseSpawnedSession(stdout: string): string | null {
  return /spawned tmux session (\S+)/.exec(stdout)?.[1] ?? null;
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
    const launch: Launch = {
      id: randomUUID(),
      title: req.name || `${HARNESS_LABEL[req.harness]} in ${basename(expandHome(req.directory))}`,
      harness: req.harness,
      directory: req.directory,
      startedAt: this.now(),
      state: 'starting',
      error: null,
      terminal: null,
      tmuxSession: null,
      timer: null,
    };
    this.launches.set(launch.id, launch);
    // LAUNCH-4.5: the 15 s count from when the "Starting…" row appears, not from when spawn returns.
    launch.timer = setTimeout(() => this.timedOut(launch.id), this.opts.timeoutMs ?? LAUNCH_TIMEOUT_MS);
    launch.timer.unref?.();
    this.changed();

    const args = ['--local', 'spawn', '--backend', 'tmux', '--harness', req.harness, '--dir', expandHome(req.directory)];
    if (req.model) args.push('--model', req.model);
    if (req.name) args.push('--name', req.name);
    if (req.prompt) args.push('--', req.prompt);
    let stdout: string;
    try {
      stdout = await this.opts.runner(this.opts.fleetBin(), args, { timeoutMs: SPAWN_TIMEOUT_MS, env: this.env });
    } catch (err) {
      if (launch.timer) clearTimeout(launch.timer);
      this.launches.delete(launch.id);
      this.changed();
      const e = err as RunError;
      if (e.code === 'ENOENT') throw new LaunchError(502, "Fleet isn't installed.");
      // Decision 0001: the UI never names tmux, so Fleet's one expected error is reworded.
      const taken = /tmux session `([^`]+)` already exists/.exec(e.stderr ?? '');
      if (taken) throw new LaunchError(409, `A Session host named ${taken[1]} already exists. Pick another name.`, 'name');
      throw new LaunchError(502, `Couldn't start the Session: ${firstLine(err)}`);
    }

    launch.tmuxSession = parseSpawnedSession(stdout);
    // Already past the deadline while spawn ran: its terminal can be read now.
    if (launch.state === 'failed' && this.launches.has(launch.id)) void this.attachTerminal(launch.id);
    // LAUNCH-1.2: remember the choices. A failed write doesn't fail the start.
    this.opts.settings
      .update({ lastLaunch: { harness: req.harness, model: req.model, directory: req.directory } }, 'server')
      .catch((err: unknown) => console.error('lookout: saving the last launch failed', err));
    return view(launch);
  }

  /** After each successful `fleet list`: a launch whose Session host Fleet reports has started. */
  observe(rows: readonly FleetRow[]): void {
    const started: { launchId: string; sessionId: string }[] = [];
    for (const launch of this.launches.values()) {
      if (!launch.tmuxSession) continue;
      const row = rows.find((r) => r.tmux_session === launch.tmuxSession && r.harness === launch.harness);
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
    // Decision 0001: the UI never mentions tmux; the Session host is the Glossary's word.
    launch.error = `Fleet hasn't reported it after ${Math.round((this.opts.timeoutMs ?? LAUNCH_TIMEOUT_MS) / 1000)} s. Its Session host is still running.`;
    this.changed();
    if (launch.tmuxSession) void this.attachTerminal(id);
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

function firstLine(err: unknown): string {
  const e = err as RunError;
  const text = (e.stderr?.trim() || e.message || 'unknown error').split('\n')[0]!;
  return text.replace(/^error:\s*/i, '');
}
