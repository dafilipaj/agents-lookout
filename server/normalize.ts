import type { Backend, GitLocation, Harness, LocationShown, SessionRow, Status } from '../shared/types.ts';
import type { FleetListResult, FleetRow } from './fleet.ts';

const HARNESSES: readonly string[] = ['claude', 'codex'] satisfies Harness[];

/**
 * Fleet status → Glossary Status. SIDE-2.6: `shell` (Claude Code 2.1.308's Idle with a background
 * shell command still running) is Idle; the row keeps the shell as `backgroundShell`.
 */
export function toStatus(fleetStatus: string): Status {
  switch (fleetStatus) {
    case 'waiting':
      return 'needs-you';
    case 'busy':
      return 'busy';
    case 'idle':
    case 'shell':
      return 'idle';
    default:
      return 'unknown';
  }
}

function toBackend(b: string): Backend {
  return b === 'tmux' || b === 'iterm' ? b : 'unknown';
}

/** The tmux session a tmux-backed row lives in; null for any other. */
function tmuxHost(r: FleetRow): string | null {
  return r.backend === 'tmux' && typeof r.tmux_session === 'string' && r.tmux_session !== '' ? r.tmux_session : null;
}

/** `session_id` when present, otherwise `<harness>:<pid>`. */
export function sessionId(row: Pick<FleetRow, 'session_id' | 'harness' | 'pid'>): string {
  return row.session_id ? row.session_id : `${row.harness}:${row.pid}`;
}

/** RFC 3339 in UTC, as the Fleet contract gives `proc_start`: seconds, optional fraction, `Z`. */
const PROC_START = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const MAX_PROC_START = 40;

/**
 * VIEW-5.6: Fleet's `proc_start`, kept exactly as given (it goes back to `fleet close
 * --expect-start` verbatim), or null when it's missing, too long, malformed or not a real time.
 */
export function procStart(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_PROC_START || !PROC_START.test(value)) return null;
  const ms = Date.parse(value);
  // A real calendar time: Date.parse rolls 02-30 over to March, so the seconds must round-trip.
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19) ? value : null;
}

/** A short word, as Harnesses name their effort levels (`medium`, `xhigh`, `max`). */
const EFFORT = /^[A-Za-z0-9_-]{1,16}$/;

/**
 * VIEW-5.11: Fleet's `effort` as given when it is a short word; null when it's missing (an older
 * Fleet), null, not a string, empty or too long, so the status line shows nothing in its place.
 */
export function effort(value: unknown): string | null {
  return typeof value === 'string' && EFFORT.test(value) ? value : null;
}

/** SIDE-9.3: unknown running makes the whole count unknown; unknown finished shows no done part. */
export function subagents(value: unknown): SessionRow['subagents'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { running, finished } = value as Record<string, unknown>;
  const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 1000;
  return isCount(running) ? { running, finished: isCount(finished) ? finished : 0 } : null;
}

const MAX_ACTIVITY = 120;
/** Bidi controls, which could show a command reversed. */
const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * SIDE-2.11: Fleet's `activity` collapsed to one line (whitespace runs become one space) and cut to
 * 120 characters, the last an ellipsis; null when it's missing (an older Fleet), null, not a string or empty.
 */
export function activity(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(BIDI, '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  // By grapheme, so a cut never splits an emoji or a letter from its accent.
  const chars = Array.from(graphemes.segment(text), (s) => s.segment);
  return chars.length <= MAX_ACTIVITY ? text : `${chars.slice(0, MAX_ACTIVITY - 1).join('').trimEnd()}…`;
}

export interface NormalizeDeps {
  /** Git location for a working directory; null when not a git dir or not read yet. */
  git(cwd: string): GitLocation | null;
  /** SIDE-2.9: the common git dirs of the repos the Start directories are in; omitted: unknown, so every row shows its repo. */
  startRepos?(): ReadonlySet<string>;
  /** When the Session's current Status began, ms since epoch. */
  statusSince(id: string, status: Status, fleetUpdatedAt: number | null): number | null;
}

/**
 * SIDE-2.7–2.9: what of its location a row shows. The where part (Worktree or branch) hides at the
 * default location: in git, not a linked Worktree, on the repo's default branch (never when that is
 * unknown). The repo part hides only when the Start directories are all in this one repo, compared
 * by common git dir; outside git the working directory's name stands for it and always shows.
 */
export function locationShown(git: GitLocation | null, startRepos: ReadonlySet<string> | undefined): LocationShown {
  if (!git) return { repo: true, where: false };
  const atDefault = git.worktree === null && git.branch !== null && git.branch === git.defaultBranch;
  return {
    repo: !(startRepos?.size === 1 && startRepos.has(git.commonDir)),
    where: (git.worktree !== null || git.branch !== null) && !atDefault,
  };
}

/** Turns `fleet list --json` rows into sidebar rows. pi Sessions are a non-goal and dropped. */
export function normalizeRows(rows: readonly FleetRow[], deps: NormalizeDeps): SessionRow[] {
  const out: SessionRow[] = [];
  // VIEW-5.6: how many listed Sessions (pi included) each tmux session hosts.
  const perHost = new Map<string, number>();
  for (const r of rows) {
    const host = tmuxHost(r);
    if (host) perHost.set(host, (perHost.get(host) ?? 0) + 1);
  }
  const startRepos = deps.startRepos?.();
  for (const r of rows) {
    if (!HARNESSES.includes(r.harness)) continue;
    const id = sessionId(r);
    const status = toStatus(r.status);
    const backend = toBackend(r.backend);
    const pct = r.context?.pct;
    const git = r.cwd ? deps.git(r.cwd) : null;
    out.push({
      id,
      pid: r.pid,
      harness: r.harness as Harness,
      title: r.display_title || `${r.harness} ${r.pid}`,
      status,
      waitingFor: status === 'needs-you' ? (r.waiting_for?.trim() || null) : null,
      statusSince: deps.statusSince(id, status, typeof r.updated_at === 'number' ? r.updated_at : null),
      contextPct: typeof pct === 'number' && Number.isFinite(pct) ? Math.round(pct) : null,
      cwd: r.cwd ?? null,
      git,
      locationShown: locationShown(git, startRepos),
      backend,
      controllable: backend !== 'unknown',
      ownHost: perHost.get(tmuxHost(r) ?? '') === 1,
      model: r.model ?? null,
      effort: effort(r.effort),
      memoryGrowthBytes: null,
      subagents: subagents(r.subagents),
      // SIDE-2.11: only while Busy, so a stale value never shows on another Status.
      activity: status === 'busy' ? activity(r.activity) : null,
      backgroundShell: r.status === 'shell',
      procStart: procStart(r.proc_start),
      pendingModel: null,
      pendingEffort: null,
      modelAt: typeof r.model_at === 'string' ? r.model_at : null,
    });
  }
  return out;
}

/**
 * A Session as a `fleet list` made just now shows it, checked again right before Fleet types into
 * it (VIEW-5.12, VIEW-6): the first row `match` takes, null when it's gone, or `unavailable` when
 * the list couldn't be read.
 */
export function freshRow(list: FleetListResult, match: (row: SessionRow) => boolean): SessionRow | null | 'unavailable' {
  if (list.kind !== 'ok') return 'unavailable';
  return normalizeRows(list.rows, { git: () => null, statusSince: () => null }).find(match) ?? null;
}
