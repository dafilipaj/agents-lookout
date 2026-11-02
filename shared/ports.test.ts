import { describe, expect, it } from 'vitest';
import { type AttributeInput, type Checkout, attribute, parseCwds, parseDevctl, parseElapsed, parseListeners, parseProcessTimes, shownDir } from './ports.ts';

// As `lsof -nP -iTCP -sTCP:LISTEN -FpcRn` printed it on 2026-11-02, `f` lines included.
const LISTEN = ['p974', 'R851', 'cmysqld', 'f19', 'n*:33060', 'f134', 'n*:3306', 'f135', 'n[::]:3306', 'p86094', 'R86062', 'cnode', 'f41', 'n127.0.0.1:4747', 'pjunk', 'cnothing', 'n*:80', 'p500', 'cvite', 'n[::1]:5173', 'n*:notaport', ''].join('\n');

describe('PORTS-1.1: parsing the reads', () => {
  it('PORTS-1.1: one listener per pid with all its ports, lowest first; lines that don\'t parse are skipped', () => {
    expect(parseListeners(LISTEN)).toEqual([
      { pid: 974, command: 'mysqld', ports: [3306, 33060] },
      { pid: 86094, command: 'node', ports: [4747] },
      { pid: 500, command: 'vite', ports: [5173] },
    ]);
    expect(parseListeners('')).toEqual([]);
  });

  it('PORTS-1.1: working directories, start times and tb-devctl services', () => {
    expect([...parseCwds('p974\nfcwd\nn/opt/homebrew/var/mysql\np1154\nfcwd\nn/\np9\nfcwd\nnnot-absolute\n')]).toEqual([[974, '/opt/homebrew/var/mysql'], [1154, '/']]);
    expect([parseElapsed('03:55'), parseElapsed('01:02:03'), parseElapsed('02-22:16:50'), parseElapsed('x')]).toEqual([235_000, 3_723_000, ((2 * 24 + 22) * 3600 + 16 * 60 + 50) * 1000, null]);
    expect([...parseProcessTimes('    1     0     1 02-22:16:50\n86094 86062 86062       03:55\nbad line\n')]).toEqual([
      [1, { pid: 1, ppid: 0, pgid: 1, elapsedMs: 253_010_000 }],
      [86094, { pid: 86094, ppid: 86062, pgid: 86062, elapsedMs: 235_000 }],
    ]);
    const devctl = JSON.stringify([
      { stack: 'test-pr-1', service: 'api', owner: 'claude:me:s-1', state: 'running', url: 'http://agent-api.localhost:4301', pgid: 58442, listener_pid: 58442 },
      { stack: 'test-pr-1', service: 'sidekiq', owner: 'claude:me:s-1', state: 'running', url: null, pgid: 62416, listener_pid: null },
      { stack: 'test-pr-1', service: 'bad', url: 'javascript:alert(1)' },
      { service: 'no-stack' },
    ]);
    expect(parseDevctl(devctl)).toEqual([
      { stack: 'test-pr-1', service: 'api', owner: 'claude:me:s-1', state: 'running', url: 'http://agent-api.localhost:4301', pgid: 58442, listenerPid: 58442 },
      { stack: 'test-pr-1', service: 'sidekiq', owner: 'claude:me:s-1', state: 'running', url: null, pgid: 62416, listenerPid: null },
      { stack: 'test-pr-1', service: 'bad', owner: null, state: 'unknown', url: null, pgid: null, listenerPid: null },
    ]);
    expect(parseDevctl('not json')).toEqual([]);
  });
});

const HOME = '/Users/me';
const CHECKOUTS: Record<string, Checkout> = {
  [`${HOME}/Projects/agents-lookout`]: { root: `${HOME}/Projects/agents-lookout`, commonDir: `${HOME}/Projects/agents-lookout/.git` },
  [`${HOME}/work/repos/api-worktrees/pr-1`]: { root: `${HOME}/work/repos/api-worktrees/pr-1`, commonDir: `${HOME}/work/repos/api/.git` },
  [`${HOME}/work`]: { root: `${HOME}/work`, commonDir: `${HOME}/work/.git` },
};
const checkout = (cwd: string) => Object.entries(CHECKOUTS).filter(([root]) => cwd === root || cwd.startsWith(`${root}/`)).sort((a, b) => b[0].length - a[0].length)[0]?.[1] ?? null;

function input(patch: Partial<AttributeInput>): AttributeInput {
  return { listeners: [], cwds: new Map(), ps: new Map(), devctl: [], sessions: [], lookoutPid: 100, home: HOME, checkout, startedAt: (_pid, _cmd, elapsed) => 1_000_000 - elapsed, ...patch };
}
const ps = (rows: [pid: number, ppid: number, pgid?: number][]) => new Map(rows.map(([pid, ppid, pgid]) => [pid, { pid, ppid, pgid: pgid ?? pid, elapsedMs: 60_000 }]));
const listener = (pid: number, port: number, command = 'node') => ({ pid, command, ports: [port] });

describe('PORTS-1.3: a Local server\'s Session', () => {
  const sessions = [
    { id: 's-1', harness: 'claude', pid: 10, cwd: `${HOME}/work` },
    { id: 's-2', harness: 'claude', pid: 20, cwd: `${HOME}/work` },
    { id: 's-3', harness: 'codex', pid: 30, cwd: `${HOME}/Projects/agents-lookout` },
  ];

  it('PORTS-1.3: tb-devctl\'s owner first, joined by listener_pid, else by process group; dead rows skipped', () => {
    const servers = attribute(input({
      sessions,
      listeners: [listener(501, 4301, 'ruby'), listener(502, 4302, 'ruby'), listener(503, 4303, 'ruby'), listener(504, 4304, 'ruby')],
      ps: ps([[501, 1], [502, 1, 777], [503, 30], [504, 1, 888]]),
      devctl: [
        { stack: 'pr-1', service: 'api', owner: 'claude:me:s-2', state: 'running', url: 'http://api.localhost:4301', pgid: 501, listenerPid: 501 },
        { stack: 'pr-1', service: 'web', owner: 'claude:me:s-1', state: 'running', url: null, pgid: 777, listenerPid: null },
        { stack: 'pr-1', service: 'old', owner: 'claude:me:s-1', state: 'dead', url: null, pgid: 503, listenerPid: 503 },
        { stack: 'pr-1', service: 'worker', owner: 'claude:me:s-1', state: 'running', url: null, pgid: 888, listenerPid: 889 },
      ],
    }));
    expect(servers.map((s) => [s.pid, s.name, s.sessionId, s.by, s.url, s.devctl])).toEqual([
      [501, 'pr-1/api', 's-2', 'devctl', 'http://api.localhost:4301', true],
      [502, 'pr-1/web', 's-1', 'devctl', 'http://localhost:4302', true],
      [503, 'ruby', 's-3', 'tree', 'http://localhost:4303', false],
      // Another process of the service's group than the one it recorded.
      [504, 'pr-1/worker', 's-1', 'devctl', 'http://localhost:4304', true],
    ]);
  });

  it('PORTS-1.3: an owner Fleet doesn\'t list labels the server but names no Session; the tree or the directory may still', () => {
    const [server] = attribute(input({
      sessions,
      listeners: [listener(501, 4301)],
      ps: ps([[501, 30]]),
      devctl: [{ stack: 'pr-1', service: 'api', owner: 'claude:me:gone', state: 'running', url: null, pgid: 501, listenerPid: 501 }],
    }));
    expect([server!.name, server!.sessionId, server!.by, server!.shown]).toEqual(['pr-1/api', 's-3', 'tree', true]);
  });

  it('PORTS-1.3: the nearest Session up the process tree; Lookout\'s tree cuts it', () => {
    const servers = attribute(input({
      sessions,
      listeners: [listener(601, 5173), listener(602, 5174)],
      ps: ps([[601, 600], [600, 20], [602, 100], [100, 10]]),
    }));
    expect(servers.map((s) => [s.pid, s.sessionId, s.by])).toEqual([[601, 's-2', 'tree'], [602, null, null]]);
  });

  it('PORTS-1.3: the working directory inside exactly one Session\'s, the deepest; two with the same name neither', () => {
    const servers = attribute(input({
      sessions,
      listeners: [listener(701, 3000), listener(702, 3001), listener(703, 3002)],
      ps: null,
      cwds: new Map([[701, `${HOME}/Projects/agents-lookout/web`], [702, `${HOME}/work/repos/api-worktrees/pr-1`], [703, '/tmp/x']]),
    }));
    expect(servers.map((s) => [s.pid, s.sessionId, s.by])).toEqual([[701, 's-3', 'cwd'], [702, null, null], [703, null, null]]);
  });
});

describe('PORTS-1.4, PORTS-1.5: what a Local server carries and whether it\'s shown', () => {
  it('PORTS-1.4: shown when it\'s a Session\'s, a tb-devctl service, in a checkout in the home folder, or Lookout; the rest only with Show all', () => {
    const servers = attribute(input({
      sessions: [{ id: 's-1', harness: 'claude', pid: 10, cwd: '/somewhere' }],
      listeners: [listener(100, 4747), listener(974, 3306, 'mysqld'), listener(861, 443, 'caddy'), listener(801, 8080), listener(802, 9000)],
      ps: ps([[801, 10]]),
      cwds: new Map([[100, `${HOME}/Projects/agents-lookout`], [974, '/opt/homebrew/var/mysql'], [802, `${HOME}/work/repos/api-worktrees/pr-1/spec`]]),
      // Homebrew's prefix is a git checkout, outside the home folder.
      checkout: (cwd) => (cwd.startsWith('/opt/homebrew/') ? { root: '/opt/homebrew', commonDir: '/opt/homebrew/.git' } : checkout(cwd)),
    }));
    expect(servers.map((s) => [s.ports[0], s.name, s.shown, s.lookout])).toEqual([
      [443, 'caddy', false, false],
      [3306, 'mysqld', false, false],
      [4747, 'Lookout', true, true],
      [8080, 'node', true, false],
      [9000, 'node', true, false],
    ]);
    expect(servers.find((s) => s.lookout)!.sessionId).toBeNull();
  });

  it('PORTS-1.5: the directory from the folder holding the repo, the repo for grouping, and the start time', () => {
    const servers = attribute(input({
      listeners: [listener(100, 4747), listener(802, 9000), listener(803, 9001), listener(804, 9002)],
      cwds: new Map([[100, `${HOME}/Projects/agents-lookout`], [802, `${HOME}/work/repos/api-worktrees/pr-1/spec`], [803, `${HOME}/.local/state/redis`]]),
      ps: ps([[100, 1], [802, 1]]),
    }));
    expect(servers.map((s) => [s.dir, s.repo?.name ?? null, s.startedAt])).toEqual([
      ['agents-lookout', 'agents-lookout', 940_000],
      ['api-worktrees/pr-1/spec', 'api', 940_000],
      ['~/.local/state/redis', null, null],
      [null, null, null],
    ]);
    expect(shownDir('/elsewhere/pr-1', { root: '/elsewhere/pr-1', commonDir: `${HOME}/work/repos/api/.git` }, HOME)).toBe('pr-1');
    expect(shownDir('/opt/x', null, HOME)).toBe('/opt/x');
  });
});
