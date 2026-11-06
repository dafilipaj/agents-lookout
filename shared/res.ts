/** RES: `res`, the machine-wide queue for heavy jobs, as Lookout reads it from `res status --json`. */

/** RES-1.1: how often the queue is read while a tab is connected. */
export const RES_INTERVAL_MS = 5000;

/** RES-1.3: `res`'s priorities, and its ageing: one level more per 5 min waited. */
const PRIO: Record<string, number> = { bg: 0, check: 1, live: 2 };
const AGE_MS = 5 * 60_000;

export interface ResJob {
  id: string;
  pid: number;
  /** `run`: a `res run`; `standing`: a `res hold` for a server already running. */
  kind: 'run' | 'standing';
  state: 'holding' | 'waiting';
  prio: string;
  /** `<tool or command>@<repo>`, `vitest@agents-lookout`. */
  cls: string;
  /** The tool `res` recognised (`vitest`, `tsc`); null or absent for another command. */
  tool?: string | null;
  /** Holding: its lease; waiting: what it needs. */
  cores: number;
  mb: number;
  /** ms since epoch; null when `res` didn't say. */
  since: number | null;
  waitingSince: number | null;
  queuedAt: number | null;
  /** What `res` recorded: the tmux session name, else `$CLAUDE_CODE_SESSION_ID`. */
  session: string | null;
  /** RES-1.4: the Session it belongs to; null for none. */
  sessionId: string | null;
  /** RES-1.3: its place in the queue, from 1; null while it holds. */
  position: number | null;
}

/** RES-1.2: null means `res` isn't installed. */
export interface ResSnapshot {
  jobs: ResJob[];
  /** The last good read, ms since epoch. */
  readAt: number | null;
  /** Why the last read failed; null after a good one. */
  error: string | null;
}

/** RES-3: a Session's longest-waiting job, carried on its row. */
export interface Queued {
  tool: string;
  /** When it started waiting, ms since epoch. */
  since: number;
  position: number;
}

/** A Session as RES-1.4 matches it. */
export interface ResSession {
  id: string;
  /** The tmux session its pane lives in; null outside tmux. */
  tmuxSession: string | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const time = (v: unknown): number | null => {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};
const round1 = (n: number) => Math.round(n * 10) / 10;

/** What a waiting job asks for, as `res`'s `need(req)`: per worker for a scaled tool. */
function need(req: unknown): { cores: number; mb: number } | null {
  if (!req || typeof req !== 'object') return null;
  const r = req as Record<string, unknown>;
  if (r.scaled === true) {
    const workers = num(r.workers);
    const per = r.perWorker as Record<string, unknown> | undefined;
    const cores = num(per?.cores);
    const mb = num(per?.mb);
    if (workers === null || cores === null || mb === null) return null;
    return { cores: round1(workers * cores), mb: Math.round(num(r.fixedMB) ?? (num(r.baseMB) ?? 0) + workers * mb) };
  }
  const cores = num(r.cores);
  const mb = num(r.mb);
  return cores === null || mb === null ? null : { cores, mb };
}

/**
 * RES-1.1: the jobs in `res status --json`, in no particular order and with no Session yet; an
 * entry it can't read is skipped. Throws when the output isn't `res`'s JSON at all.
 */
export function parseResStatus(stdout: string): ResJob[] {
  const parsed: unknown = JSON.parse(stdout);
  const entries = (parsed as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) throw new Error('res status --json printed no entries');
  const jobs: ResJob[] = [];
  for (const e of entries as Record<string, unknown>[]) {
    if (!e || typeof e !== 'object') continue;
    const pid = num(e.pid);
    const state = e.state === 'holding' || e.state === 'waiting' ? e.state : null;
    const kind = e.kind === 'standing' ? 'standing' : e.kind === 'run' ? 'run' : null;
    const cls = str(e.cls);
    if (pid === null || !state || !kind || !cls) continue;
    const size = state === 'waiting' ? need(e.req) ?? { cores: num(e.cores) ?? 0, mb: num(e.mb) ?? 0 } : { cores: num(e.cores) ?? 0, mb: num(e.mb) ?? 0 };
    jobs.push({
      id: str(e.id) ?? String(pid),
      pid,
      kind,
      state,
      prio: str(e.prio) ?? 'check',
      cls,
      tool: str(e.tool),
      cores: size.cores,
      mb: size.mb,
      since: time(e.since),
      waitingSince: time(e.waitingSince),
      queuedAt: time(e.queuedAt),
      session: str(e.session),
      sessionId: null,
      position: null,
    });
  }
  return jobs;
}

/** When a waiting job started waiting: `res`'s `waitingSince ?? queuedAt`. */
export function waitStart(job: ResJob): number | null {
  return job.waitingSince ?? job.queuedAt;
}

/** RES-1.3: holders first, as `res` lists them; then waiters in its queue order, numbered. */
export function queueOrder(jobs: readonly ResJob[], now: number): ResJob[] {
  const level = (j: ResJob) => (PRIO[j.prio] ?? 1) + Math.floor(Math.max(0, now - (waitStart(j) ?? now)) / AGE_MS);
  const holding = jobs.filter((j) => j.state === 'holding').map((j) => ({ ...j, position: null }));
  const waiting = jobs
    .filter((j) => j.state === 'waiting')
    .toSorted((a, b) => level(b) - level(a) || (a.queuedAt ?? 0) - (b.queuedAt ?? 0) || a.id.localeCompare(b.id))
    .map((j, k) => ({ ...j, position: k + 1 }));
  return [...holding, ...waiting];
}

/**
 * RES-1.4: the Session a job's `session` names: the one Session whose pane is in that tmux session,
 * else the Session with that id. A tmux session several Sessions share names none.
 */
export function attributeJobs(jobs: readonly ResJob[], sessions: readonly ResSession[]): ResJob[] {
  const byHost = new Map<string, string[]>();
  for (const s of sessions) if (s.tmuxSession) byHost.set(s.tmuxSession, [...(byHost.get(s.tmuxSession) ?? []), s.id]);
  const ids = new Set(sessions.map((s) => s.id));
  return jobs.map((j) => {
    if (!j.session) return { ...j, sessionId: null };
    const hosted = byHost.get(j.session);
    if (hosted) return { ...j, sessionId: hosted.length === 1 ? hosted[0]! : null };
    return { ...j, sessionId: ids.has(j.session) ? j.session : null };
  });
}

/** The tool `res` recognised, else the one its class names: `vitest@agents-lookout` → `vitest`. */
export function jobTool(job: Pick<ResJob, 'cls' | 'tool'>): string {
  if (job.tool) return job.tool;
  const at = job.cls.lastIndexOf('@');
  return at > 0 ? job.cls.slice(0, at) : job.cls;
}

/** RES-3.1: a Session's longest-waiting job; null when none of its jobs waits. */
export function queuedFor(res: ResSnapshot | null, sessionId: string): Queued | null {
  let best: Queued | null = null;
  for (const j of res?.jobs ?? []) {
    if (j.state !== 'waiting' || j.sessionId !== sessionId) continue;
    const since = waitStart(j);
    if (since === null || j.position === null) continue;
    if (!best || since < best.since) best = { tool: jobTool(j), since, position: j.position };
  }
  return best;
}

/** RES-2.1: how many jobs wait. */
export function waitingCount(res: ResSnapshot | null): number {
  return res?.jobs.filter((j) => j.state === 'waiting').length ?? 0;
}
