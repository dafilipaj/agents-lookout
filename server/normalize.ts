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

/** `session_id` when present, otherwise `<harness>:<pid>`. */
export function sessionId(row: Pick<FleetRow, 'session_id' | 'harness' | 'pid'>): string {
  return row.session_id ? row.session_id : `${row.harness}:${row.pid}`;
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
      model: r.model ?? null,
    });
  }
  return out;
}
