import type { Backend, GitLocation, Harness, SessionRow, Status } from '../shared/types.ts';
import type { FleetRow } from './fleet.ts';

const HARNESSES: readonly string[] = ['claude', 'codex'] satisfies Harness[];

/** Fleet status → Glossary Status. */
export function toStatus(fleetStatus: string): Status {
  switch (fleetStatus) {
    case 'waiting':
      return 'needs-you';
    case 'busy':
      return 'busy';
    case 'idle':
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

export interface NormalizeDeps {
  /** Git location for a working directory; null when not a git dir or not read yet. */
  git(cwd: string): GitLocation | null;
  /** When the Session's current Status began, ms since epoch. */
  statusSince(id: string, status: Status, fleetUpdatedAt: number | null): number | null;
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
  for (const r of rows) {
    if (!HARNESSES.includes(r.harness)) continue;
    const id = sessionId(r);
    const status = toStatus(r.status);
    const backend = toBackend(r.backend);
    const pct = r.context?.pct;
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
      git: r.cwd ? deps.git(r.cwd) : null,
      backend,
      controllable: backend !== 'unknown',
      ownHost: perHost.get(tmuxHost(r) ?? '') === 1,
      model: r.model ?? null,
      procStart: procStart(r.proc_start),
    });
  }
  return out;
}
