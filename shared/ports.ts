/** PORTS-1.2: how often the reads run while a tab is connected. */
export const PORTS_INTERVAL_MS = 5000;

/** PORTS-1.3: which rule tied a Local server to its Session. */
export type Belongs = 'devctl' | 'tree' | 'cwd';

/** PORTS-1.5: one Local server, as the server sends it. */
export interface LocalServer {
  pid: number;
  /** The process's command name, from `lsof`. */
  command: string;
  /** Every port it listens on, lowest first. */
  ports: number[];
  /** tb-devctl's `stack/service`, "Lookout" for Lookout's own server, else the command. */
  name: string;
  /** Its working directory, in full; null when it couldn't be read. */
  cwd: string | null;
  /** The working directory as shown: from the folder holding the repo (`api-worktrees/test-pr-24926`), else from `~`. */
  dir: string | null;
  /** PORTS-3.2: the checkout's repo, its folder's name and common git directory; null outside one. */
  repo: { name: string; commonDir: string } | null;
  /** ms since epoch; null without a `ps` line. */
  startedAt: number | null;
  /** The Session it belongs to (`SessionRow.id`), and by which rule; both null when none. */
  sessionId: string | null;
  by: Belongs | null;
  url: string;
  /** A tb-devctl service. */
  devctl: boolean;
  /** Lookout's own server. */
  lookout: boolean;
  /** PORTS-1.4: shown without "Show all". */
  shown: boolean;
}

/** PORTS-1.2: what the `ports` event and the snapshot carry. */
export interface PortsSnapshot {
  servers: LocalServer[];
  /** The last good read of the listeners; null before one. */
  readAt: number | null;
  /** PORTS-3.4, 3.5: why the last listener query failed; null when it didn't. */
  error: string | null;
}

export interface Listener {
  pid: number;
  command: string;
  ports: number[];
}

export interface ProcessTimes {
  pid: number;
  ppid: number;
  pgid: number;
  /** How long it has run, in ms. */
  elapsedMs: number;
}

export interface DevctlService {
  stack: string;
  service: string;
  owner: string | null;
  state: string;
  url: string | null;
  pgid: number | null;
  listenerPid: number | null;
}

/** The Sessions PORTS-1.3 can name, from Fleet's list. */
export interface PortsSession {
  id: string;
  harness: string;
  pid: number;
  cwd: string | null;
}

/** A git checkout: its top folder and the repo's common git directory. */
export interface Checkout {
  root: string;
  commonDir: string;
}

// eslint-disable-next-line no-control-regex -- a command name is one line of printable text
const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120);
const int = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s) ? Number(s) : null);

/**
 * PORTS-1.1: `lsof -nP -iTCP -sTCP:LISTEN -FpcRn`, one field per line, `p` starting a process. A
 * process on several addresses or ports is one listener with all its ports. Lines that don't parse
 * are skipped, never the read.
 */
export function parseListeners(stdout: string): Listener[] {
  const byPid = new Map<number, { pid: number; command: string; ports: Set<number> }>();
  let current: { pid: number; command: string; ports: Set<number> } | null = null;
  for (const line of stdout.split('\n')) {
    const field = line[0];
    const value = line.slice(1);
    if (field === 'p') {
      const pid = int(value);
      current = pid ? (byPid.get(pid) ?? { pid, command: '', ports: new Set() }) : null;
      if (current) byPid.set(current.pid, current);
    } else if (!current) continue;
    else if (field === 'c') current.command = oneLine(value);
    else if (field === 'n') {
      const port = int(value.slice(value.lastIndexOf(':') + 1));
      if (port !== null && port > 0 && port < 65536) current.ports.add(port);
    }
  }
  return [...byPid.values()]
    .filter((l) => l.ports.size)
    .map((l) => ({ pid: l.pid, command: l.command || 'unknown', ports: [...l.ports].sort((a, b) => a - b) }));
}

/** PORTS-1.1: `lsof -nP -a -d cwd -Fpn -p <pids>`: each pid's working directory. */
export function parseCwds(stdout: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid: number | null = null;
  for (const line of stdout.split('\n')) {
    if (line[0] === 'p') pid = int(line.slice(1));
    else if (line[0] === 'n' && pid && line.length > 1 && line[1] === '/') cwds.set(pid, line.slice(1));
  }
  return cwds;
}

/** `ps`'s `etime`, `[[dd-]hh:]mm:ss`, in ms; null when it isn't one. */
export function parseElapsed(etime: string): number | null {
  const m = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(etime.trim());
  if (!m) return null;
  const [, d, h, min, s] = m;
  return (((Number(d ?? 0) * 24 + Number(h ?? 0)) * 60 + Number(min)) * 60 + Number(s)) * 1000;
}

/** PORTS-1.1: `ps -axo pid=,ppid=,pgid=,etime=`. */
export function parseProcessTimes(stdout: string): Map<number, ProcessTimes> {
  const rows = new Map<number, ProcessTimes>();
  for (const line of stdout.split('\n')) {
    const [pid, ppid, pgid, etime] = line.trim().split(/\s+/);
    const values = [int(pid), int(ppid), int(pgid)];
    const elapsedMs = etime ? parseElapsed(etime) : null;
    if (values.some((v) => v === null) || !values[0] || elapsedMs === null) continue;
    rows.set(values[0], { pid: values[0], ppid: values[1]!, pgid: values[2]!, elapsedMs });
  }
  return rows;
}

/** PORTS-1.1: `tb-devctl ps --json`; rows that aren't a service are skipped. */
export function parseDevctl(stdout: string): DevctlService[] {
  let rows: unknown;
  try {
    rows = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const str = (v: unknown) => (typeof v === 'string' && v ? oneLine(v) : null);
  const num = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);
  return rows.flatMap((r: Record<string, unknown>) => {
    if (typeof r !== 'object' || r === null) return [];
    const stack = str(r.stack);
    const service = str(r.service);
    if (!stack || !service) return [];
    const url = str(r.url);
    return [{ stack, service, owner: str(r.owner), state: str(r.state) ?? 'unknown', url: url && /^https?:\/\//.test(url) ? url : null, pgid: num(r.pgid), listenerPid: num(r.listener_pid) }];
  });
}

// POSIX paths, as lsof and Fleet give them; shared with the browser, so not `node:path`.
const sep = '/';
const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
const basename = (p: string) => trim(p).split(sep).pop() ?? '';
const dirname = (p: string) => trim(p).slice(0, Math.max(1, trim(p).lastIndexOf(sep)));
const inside = (dir: string, parent: string) => dir === parent || dir.startsWith(parent.endsWith(sep) ? parent : parent + sep);
/** `dir` below `parent`, as a relative path; '' when they're the same. */
const relative = (parent: string, dir: string) => (dir === parent ? '' : dir.slice(trim(parent) === sep ? 1 : trim(parent).length + 1));

/** The repo's own folder: the common git directory's parent, or a bare repo itself. */
function repoFolder(commonDir: string): string {
  return basename(commonDir) === '.git' ? dirname(commonDir) : commonDir;
}

/** PORTS-1.5: the working directory from the folder holding the repo, else from `~`. */
export function shownDir(cwd: string, checkout: Checkout | null, home: string): string {
  if (checkout) {
    const holder = dirname(repoFolder(checkout.commonDir));
    if (inside(cwd, holder) && cwd !== holder) return relative(holder, cwd);
    return [basename(checkout.root), relative(checkout.root, cwd)].filter(Boolean).join(sep);
  }
  if (home && inside(cwd, home)) return cwd === home ? '~' : `~${sep}${relative(home, cwd)}`;
  return cwd;
}

/** PORTS-1.3 (2): the nearest Session up the `ppid` chain; Lookout's own tree cuts it, as MEM's roots do. */
function treeSession(pid: number, ps: ReadonlyMap<number, ProcessTimes>, roots: ReadonlyMap<number, PortsSession>, lookoutPid: number): PortsSession | null {
  const seen = new Set<number>();
  for (let at: number | undefined = pid; at && at > 1 && !seen.has(at); at = ps.get(at)?.ppid) {
    seen.add(at);
    if (at === lookoutPid) return null;
    const root = roots.get(at);
    if (root) return root;
  }
  return null;
}

/** PORTS-1.3 (3): the one Session whose working directory holds `cwd` deepest; none on a tie. */
function cwdSession(cwd: string, sessions: readonly PortsSession[]): PortsSession | null {
  let best: PortsSession[] = [];
  let depth = -1;
  for (const s of sessions) {
    if (!s.cwd || !inside(cwd, s.cwd)) continue;
    const d = s.cwd.length;
    if (d > depth) [best, depth] = [[s], d];
    else if (d === depth && !best.some((b) => b.cwd === s.cwd && b.id === s.id)) best.push(s);
  }
  return best.length === 1 ? best[0]! : null;
}

export interface AttributeInput {
  listeners: readonly Listener[];
  cwds: ReadonlyMap<number, string>;
  /** Null when `ps` failed: no start times, no tree, no process groups. */
  ps: ReadonlyMap<number, ProcessTimes> | null;
  devctl: readonly DevctlService[];
  sessions: readonly PortsSession[];
  lookoutPid: number;
  home: string;
  checkout(cwd: string): Checkout | null;
  /** PORTS-1.5: the start time kept for this pid and command, given how long it has run. */
  startedAt(pid: number, command: string, elapsedMs: number): number;
}

/** PORTS-1.3–1.5: each listener as a Local server, its Session, name, URL and whether it's shown; lowest port first. */
export function attribute(input: AttributeInput): LocalServer[] {
  const { ps } = input;
  const roots = new Map(input.sessions.map((s) => [s.pid, s]));
  const live = input.devctl.filter((d) => d.state !== 'dead');
  const servers = input.listeners.map((l): LocalServer => {
    const times = ps?.get(l.pid) ?? null;
    const service = live.find((d) => d.listenerPid === l.pid) ?? (times ? live.find((d) => d.pgid === times.pgid) : undefined) ?? null;
    const lookout = l.pid === input.lookoutPid;
    let session: PortsSession | null = null;
    let by: Belongs | null = null;
    if (!lookout) {
      const owner = service?.owner?.split(':');
      const owned = owner && owner.length >= 3 ? input.sessions.find((s) => s.harness === owner[0] && s.id === owner.at(-1)) : undefined;
      const tree = owned ? null : ps ? treeSession(l.pid, ps, roots, input.lookoutPid) : null;
      const cwd = input.cwds.get(l.pid);
      const byCwd = owned || tree || !cwd ? null : cwdSession(cwd, input.sessions);
      session = owned ?? tree ?? byCwd;
      by = owned ? 'devctl' : tree ? 'tree' : byCwd ? 'cwd' : null;
    }
    const cwd = input.cwds.get(l.pid) ?? null;
    const checkout = cwd ? input.checkout(cwd) : null;
    return {
      pid: l.pid,
      command: l.command,
      ports: l.ports,
      name: service ? `${service.stack}/${service.service}` : lookout ? 'Lookout' : l.command,
      cwd,
      dir: cwd ? shownDir(cwd, checkout, input.home) : null,
      repo: checkout ? { name: basename(repoFolder(checkout.commonDir)).replace(/\.git$/, ''), commonDir: checkout.commonDir } : null,
      startedAt: times ? input.startedAt(l.pid, l.command, times.elapsedMs) : null,
      sessionId: session?.id ?? null,
      by,
      url: service?.url ?? `http://localhost:${l.ports[0]}`,
      devctl: !!service,
      lookout,
      // PORTS-1.4: a checkout in the home folder; Homebrew's /opt/homebrew is one too.
      shown: lookout || !!session || !!service || (!!checkout && !!input.home && inside(checkout.root, input.home)),
    };
  });
  return servers.sort((a, b) => a.ports[0]! - b.ports[0]! || a.pid - b.pid);
}
