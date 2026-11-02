import { sidebarOrder } from '@shared/order.ts';
import type { LocalServer, PortsSnapshot } from '@shared/ports.ts';
import type { SessionRow } from '@shared/types.ts';

/** PORTS-2.1: the shown Local servers that belong to a Session, lowest port first. */
export function sessionServers(ports: PortsSnapshot | null, sessionId: string): LocalServer[] {
  return ports?.servers.filter((s) => s.sessionId === sessionId) ?? [];
}

/** PORTS-2.2, PORTS-3.2: how long a server has been up: `45s`, `14m`, `2h 10m`, `3d 2h`. */
export function upFor(startedAt: number, now: number): string {
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${Math.floor(h / 24)}d`;
}

/** PORTS-2.1: `:4301 test-pr-24926/api` for one server, `3 servers` for more. */
export function chipText(servers: readonly LocalServer[]): string {
  return servers.length === 1 ? `:${servers[0]!.ports[0]} ${servers[0]!.name}` : `${servers.length} servers`;
}

/** PORTS-2.2: what a click on the chip does. */
export function chipLabel(servers: readonly LocalServer[]): string {
  return servers.length === 1 ? `Open ${chipText(servers)} in the browser` : `Show ${servers.length} servers`;
}

/** PORTS-2.2: one server on one line: port, name, working directory, and how long it's been up. */
export function serverLine(server: LocalServer, now: number): string {
  return [`:${server.ports.join(', :')}`, server.name, server.dir ?? 'unknown directory', server.startedAt !== null ? `up ${upFor(server.startedAt, now)}` : null].filter(Boolean).join('  ');
}

export interface ServerGroups {
  /** The Sessions with shown servers, in the sidebar's order. */
  sessions: { session: SessionRow; servers: LocalServer[] }[];
  /** "Not in a Session": by repo, a repo's Worktrees together. */
  repos: { name: string; commonDir: string; servers: LocalServer[] }[];
  /** Shown, but in no checkout or with no known working directory. */
  elsewhere: LocalServer[];
  /** PORTS-3.3: the ones PORTS-1.4 hides; empty unless "Show all" is on. */
  others: LocalServer[];
  /** PORTS-3.4: how many "Show all" would add. */
  hidden: number;
}

/** PORTS-3.2, PORTS-3.3: the Servers tab's groups. */
export function groupServers(ports: PortsSnapshot | null, sessions: readonly SessionRow[], showAll: boolean): ServerGroups {
  const all = ports?.servers ?? [];
  const shown = all.filter((s) => s.shown);
  const hidden = all.filter((s) => !s.shown);
  const bySession = new Map<string, LocalServer[]>();
  const rest: LocalServer[] = [];
  const known = new Set(sessions.map((s) => s.id));
  for (const server of shown) {
    if (server.sessionId && known.has(server.sessionId)) bySession.set(server.sessionId, [...(bySession.get(server.sessionId) ?? []), server]);
    else rest.push(server);
  }
  const repos = new Map<string, ServerGroups['repos'][number]>();
  const elsewhere: LocalServer[] = [];
  for (const server of rest) {
    if (!server.repo) {
      elsewhere.push(server);
      continue;
    }
    const group = repos.get(server.repo.commonDir) ?? { name: server.repo.name, commonDir: server.repo.commonDir, servers: [] };
    group.servers.push(server);
    repos.set(server.repo.commonDir, group);
  }
  return {
    sessions: sidebarOrder(sessions).flatMap((session) => (bySession.has(session.id) ? [{ session, servers: bySession.get(session.id)! }] : [])),
    repos: [...repos.values()].sort((a, b) => a.name.localeCompare(b.name) || a.commonDir.localeCompare(b.commonDir)),
    elsewhere,
    others: showAll ? hidden : [],
    hidden: hidden.length,
  };
}

/** PORTS-3.1: how many servers the tab shows. */
export const shownCount = (ports: PortsSnapshot | null) => ports?.servers.filter((s) => s.shown).length ?? 0;
