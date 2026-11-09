import type { LocalServer, PortsSnapshot } from '@shared/ports.ts';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupServers, upFor } from '@/lib/ports';
import { NOW, renderApp, row } from '@/test/helpers';

const server = (o: Partial<LocalServer> & { pid: number; ports: number[] }): LocalServer => ({
  command: 'node',
  name: 'node',
  cwd: '/Users/me/Projects/work',
  dir: 'work',
  repo: { name: 'work', commonDir: '/Users/me/Projects/work/.git' },
  startedAt: NOW - (2 * 60 + 10) * 60_000,
  sessionId: null,
  by: null,
  url: `http://localhost:${o.ports[0]}`,
  devctl: false,
  lookout: false,
  shown: true,
  ...o,
});
const ports = (servers: LocalServer[], o: Partial<PortsSnapshot> = {}): PortsSnapshot => ({ servers, readAt: NOW, error: null, ...o });

const API = server({ pid: 501, ports: [4301], name: 'test-pr-24926/api', dir: 'api-worktrees/test-pr-24926', repo: { name: 'api', commonDir: '/Users/me/work/repos/api/.git' }, sessionId: 'a', by: 'devctl', url: 'http://agent-api.localhost:4301', devctl: true });
const REDIS = server({ pid: 502, ports: [4300], name: 'test-pr-24926/redis', dir: '~/.local/state/redis', repo: null, sessionId: 'a', by: 'devctl', devctl: true });
const VITE = server({ pid: 601, ports: [5173, 5174], command: 'vite', name: 'vite', dir: 'fantastic', repo: { name: 'fantastic', commonDir: '/Users/me/fantastic/.git' }, sessionId: 'b', by: 'tree', startedAt: NOW - 14 * 60_000 });
const LOOKOUT = server({ pid: 100, ports: [4747], name: 'Lookout', dir: 'agents-lookout', repo: { name: 'agents-lookout', commonDir: '/Users/me/agents-lookout/.git' }, lookout: true });
const WT1 = server({ pid: 701, ports: [3000], dir: 'api-worktrees/one', repo: { name: 'api', commonDir: '/Users/me/work/repos/api/.git' } });
const WT2 = server({ pid: 702, ports: [3001], dir: 'api-worktrees/two', repo: { name: 'api', commonDir: '/Users/me/work/repos/api/.git' } });
const ELSEWHERE = server({ pid: 703, ports: [6379], command: 'redis-server', name: 'stack/redis', dir: '~/.local/state/redis', repo: null, devctl: true });
const MYSQL = server({ pid: 974, ports: [3306, 33060], command: 'mysqld', name: 'mysqld', dir: '/opt/homebrew/var/mysql', repo: null, shown: false });

const statusLine = () => screen.getByRole('group', { name: 'Status line' });
const chip = () => statusLine().querySelector<HTMLElement>('[data-field="servers"]');
const panel = () => document.getElementById('right-panel-servers')!;

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});
afterEach(() => vi.useRealTimers());

function open(path = '/s/a') {
  const app = renderApp(path);
  app.snapshot([
    row({ id: 'a', title: 'API rates port', changes: { additions: 120, deletions: 14, files: 3 }, model: 'claude-opus-5-5', statusSince: NOW - 1000 }),
    row({ id: 'b', title: 'Fantastic deal panel', status: 'busy', statusSince: NOW - 2000 }),
  ]);
  return app;
}

describe('the status line chip (PORTS-2)', () => {
  it('PORTS-2.1: after the Changes, the Server icon and `:port name` for one server, `N servers` for more, none without', async () => {
    const user = userEvent.setup();
    const app = open('/s/b');
    expect(chip()).toBeNull();
    app.emit({ type: 'ports', ports: ports([VITE, LOOKOUT]) });
    expect(chip()).toHaveTextContent(':5173 vite');
    expect(chip()!.querySelector('svg')).not.toBeNull();
    app.emit({ type: 'ports', ports: ports([LOOKOUT]) });
    expect(chip()).toBeNull();

    app.emit({ type: 'ports', ports: ports([API, REDIS, VITE]) });
    await user.click(screen.getByRole('option', { name: /API rates port/ }));
    expect(chip()).toHaveTextContent('2 servers');
    const fields = [...statusLine().querySelectorAll('[data-field]')].map((el) => el.getAttribute('data-field'));
    expect(fields.indexOf('servers')).toBe(fields.indexOf('changes') + 1);
    expect(statusLine().getAttribute('title')).toContain(' · 2 servers · ');
  });

  it('PORTS-2.2: its tooltip lists each server; one opens its URL in a new tab, more open the Servers tab at the Session\'s group', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    const app = open('/s/b');
    app.emit({ type: 'ports', ports: ports([API, REDIS, VITE]) });
    expect(chip()).toHaveAccessibleName('Open :5173 vite in the browser');
    expect(chip()).toHaveAttribute('title', ':5173, :5174  vite  fantastic  up 14m');
    await user.click(chip()!);
    expect(opened).toHaveBeenCalledWith('http://localhost:5173', '_blank', 'noopener,noreferrer');

    await user.click(screen.getByRole('option', { name: /API rates port/ }));
    expect(chip()).toHaveAccessibleName('Show 2 servers');
    expect(chip()!.getAttribute('title')!.split('\n')).toEqual([
      ':4301  test-pr-24926/api  api-worktrees/test-pr-24926  up 2h 10m',
      ':4300  test-pr-24926/redis  ~/.local/state/redis  up 2h 10m',
    ]);
    chip()!.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: 'Servers' })).toHaveAttribute('aria-selected', 'true');
    const list = within(panel()).getByRole('listbox', { name: 'Local servers' });
    expect(list).toHaveFocus();
    const selected = within(list).getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true')!;
    expect(within(panel()).getByRole('group', { name: 'API rates port' })).toContainElement(selected);
    opened.mockRestore();
  });

  it('PORTS-2.3: a chip that goes while it has focus hands focus to the composer', () => {
    const app = open('/s/b');
    app.emit({ type: 'ports', ports: ports([VITE]) });
    chip()!.focus();
    expect(chip()).toHaveFocus();
    app.emit({ type: 'ports', ports: ports([]) });
    expect(chip()).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
  });
});

it('PORTS-2.3: a chip that is the status line\'s only part hands focus on when the line goes with it', () => {
  const app = renderApp('/s/c');
  app.snapshot([row({ id: 'c', cwd: null, git: null })]);
  app.emit({ type: 'ports', ports: ports([{ ...VITE, sessionId: 'c' }]) });
  chip()!.focus();
  app.emit({ type: 'ports', ports: ports([]) });
  expect(screen.queryByRole('group', { name: 'Status line' })).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
});

describe('the Servers tab (PORTS-3)', () => {
  it('PORTS-3.1: a fifth tab after Topics, P opens and closes it, and its tooltip counts the shown servers', async () => {
    const user = userEvent.setup();
    const app = open('/s/a');
    app.emit({ type: 'ports', ports: ports([API, VITE, MYSQL]) });
    expect(screen.getByRole('button', { name: 'Servers, 2 running' })).toBeInTheDocument();
    await user.keyboard('p');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['History', 'Work', 'Library', 'Topics', 'Servers']);
    expect(tabs[4]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[4]).toHaveAttribute('title', 'Servers, 2 running (P)');
    // Only the open tab's name shows; the others keep theirs for screen readers and in the tooltip.
    expect(tabs.map((t) => t.querySelector('[data-slot="tab-name"]')!.classList.contains('sr-only'))).toEqual([true, true, true, true, false]);
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('p');
    expect(screen.queryByRole('tab', { name: 'Servers' })).toBeNull();
  });

  it('PORTS-3.2: grouped by Session in the sidebar\'s order, then Not in a Session by repo, then Elsewhere; j/k move, Enter opens', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    const app = open('/s/a');
    app.emit({ type: 'ports', ports: ports([API, REDIS, VITE, LOOKOUT, WT1, WT2, ELSEWHERE, MYSQL]) });
    await user.keyboard('p');
    const groups = within(panel()).getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    // Busy before Idle, as the sidebar orders them.
    expect(groups).toEqual(['Fantastic deal panel', 'API rates port', 'Not in a Session', 'agents-lookout', 'api', 'Elsewhere']);
    const rows = within(panel()).getAllByRole('option');
    expect(rows.map((r) => r.getAttribute('data-pid'))).toEqual(['601', '501', '502', '100', '701', '702', '703']);
    const vite = rows[0]!;
    expect(within(vite).getByRole('link', { name: ':5173' })).toHaveAttribute('href', 'http://localhost:5173');
    expect(within(vite).getByRole('link', { name: ':5173' })).toHaveAttribute('target', '_blank');
    expect(vite).toHaveTextContent(':5174');
    expect(vite.querySelector('[data-field="dir"]')).toHaveTextContent('fantastic');
    // The name keeps its width and the directory gives way, cut from its start (a Worktree's name ends in what tells it apart).
    expect(vite.querySelector('[data-field="name"]')).toHaveClass('shrink-0', 'max-w-[60%]');
    expect(vite.querySelector('[data-field="dir"]')).toHaveClass('min-w-0', 'truncate', '[direction:rtl]');
    expect(vite.querySelector('[data-field="dir"] > span')).toHaveAttribute('dir', 'ltr'); // keeps `~/` and `/` in place inside the rtl box
    expect(vite.querySelector('[data-field="age"]')).toHaveTextContent('14m');
    expect(rows[2]!.querySelector('[data-field="dir"]')).toHaveAttribute('title', API.cwd);
    const list = within(panel()).getByRole('listbox');
    expect(list).toHaveFocus();
    await user.keyboard('jj');
    expect(rows[2]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('k{Enter}');
    expect(opened).toHaveBeenCalledWith(API.url, '_blank', 'noopener,noreferrer');
    // From the tab strip too.
    screen.getByRole('tab', { name: 'Servers' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(rows[2]).toHaveAttribute('aria-selected', 'true');
    await user.click(within(panel()).getByRole('button', { name: /Fantastic deal panel/ }));
    expect(window.location.pathname).toBe('/s/b');
    opened.mockRestore();
  });

  it('PORTS-3.3: Show all adds the other listeners, dimmed, with their command; it\'s remembered with the layout', async () => {
    const user = userEvent.setup();
    const app = open('/s/a');
    app.emit({ type: 'ports', ports: ports([API, MYSQL]) });
    await user.keyboard('p');
    expect(within(panel()).queryByRole('group', { name: 'Other listeners' })).toBeNull();
    await user.click(within(panel()).getByRole('checkbox', { name: 'Show all' }));
    const others = within(panel()).getByRole('group', { name: 'Other listeners' });
    const mysql = within(others).getByRole('option');
    expect(mysql).toHaveClass('opacity-60');
    expect(mysql).toHaveTextContent(':3306:33060mysqld');
    expect(JSON.parse(window.localStorage.getItem('lookout.right')!).showAllServers).toBe(true);
  });

  it('PORTS-3.4: Reading ports… before the first read, its failure in its place, and the empty tab says what\'s hidden', async () => {
    const user = userEvent.setup();
    const app = open('/s/a');
    await user.keyboard('p');
    expect(within(panel()).getByRole('status')).toHaveTextContent('Reading ports…');
    app.emit({ type: 'ports', ports: ports([], { readAt: null, error: 'lsof timed out' }) });
    expect(panel()).toHaveTextContent("Couldn't read the ports: lsof timed out.");
    app.emit({ type: 'ports', ports: ports([MYSQL]) });
    expect(panel()).not.toHaveTextContent("Couldn't read");
    expect(within(panel()).getByRole('status')).toHaveTextContent('No Local servers running.1 other listener hidden');
    await user.click(within(panel()).getByRole('checkbox', { name: 'Show all' }));
    expect(panel()).not.toHaveTextContent('No Local servers running.');
  });

  it('PORTS-3.5: a failed read after a good one keeps the list, with an Alert saying when it\'s from', async () => {
    const user = userEvent.setup();
    const app = open('/s/b');
    app.emit({ type: 'ports', ports: ports([VITE]) });
    await user.keyboard('p');
    app.emit({ type: 'ports', ports: ports([VITE], { error: 'lsof timed out' }) });
    expect(panel().querySelector('[data-field="ports-error"]')).toHaveTextContent(/^Couldn't read the ports: lsof timed out\. Showing the list from \d\d:\d\d/);
    expect(within(panel()).getAllByRole('option')).toHaveLength(1);
    expect(chip()).toHaveTextContent(':5173 vite');
    app.emit({ type: 'ports', ports: ports([VITE]) });
    expect(panel().querySelector('[data-field="ports-error"]')).toBeNull();
  });
});

describe('Stop (PORTS-4)', () => {
  const stopButton = (pid: number) => panel().querySelector<HTMLElement>(`[data-pid="${pid}"] [data-field="stop"]`);

  it('PORTS-4.6: a shown row other than Lookout\'s has Stop, its name and key in its tooltip; Cancel stops nothing', async () => {
    const user = userEvent.setup();
    const app = open('/s/a');
    app.emit({ type: 'ports', ports: ports([API, VITE, LOOKOUT, WT1, MYSQL]) });
    await user.keyboard('p');
    expect(stopButton(601)).toHaveAccessibleName('Stop :5173 vite');
    expect(stopButton(601)).toHaveAttribute('title', 'Stop :5173 vite (X)');
    // No Tab stop inside the listbox, as the port's link.
    expect(stopButton(601)).toHaveAttribute('tabindex', '-1');
    expect(stopButton(100)).toBeNull();
    await user.click(within(panel()).getByRole('checkbox'));
    expect(stopButton(974)).toBeNull(); // "Other listeners" are a Non-goal
    // Shown on the row under the pointer and the selected one, so quiet rows stay quiet.
    expect(stopButton(701)).toHaveClass('opacity-0', 'group-hover/server:opacity-100');
    expect(stopButton(601)).toHaveClass('opacity-100');

    await user.click(stopButton(701)!);
    const dialog = screen.getByRole('dialog', { name: 'Stop :3000 node?' });
    expect(dialog).toHaveTextContent('In api-worktrees/one. It stops with the processes it started: they’re asked to exit, and forced after 3 seconds.'.replace('’', "'"));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(app.client.stopServer).not.toHaveBeenCalled();
    expect(within(panel()).getByRole('listbox')).toHaveFocus();
  });

  it('PORTS-4.6: x on the selected row asks too; a tb-devctl service says tb-devctl down; Stop reads Stopping… and closes once done', async () => {
    let finish!: () => void;
    const user = userEvent.setup();
    const app = open('/s/a');
    vi.mocked(app.client.stopServer).mockImplementation(() => new Promise((r) => (finish = () => r({ how: 'devctl', count: 0 }))));
    app.emit({ type: 'ports', ports: ports([API, VITE, LOOKOUT]) });
    await user.keyboard('p');
    await user.keyboard('j'); // VITE, then API (Busy first)
    await user.keyboard('x');
    const dialog = screen.getByRole('dialog', { name: 'Stop :4301 test-pr-24926/api?' });
    expect(dialog).toHaveTextContent('In “API rates port”. tb-devctl stops the service (tb-devctl down test-pr-24926 api), so its stack stays right.');
    await user.click(within(dialog).getByRole('button', { name: 'Stop' }));
    expect(app.client.stopServer).toHaveBeenCalledWith({ pid: 501, command: 'node', startedAt: API.startedAt, devctl: true });
    expect(within(dialog).getByRole('button', { name: 'Stopping…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => finish());
    expect(screen.queryByRole('dialog')).toBeNull();
    // Lookout's own row: x asks nothing.
    await user.keyboard('j');
    await user.keyboard('x');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('PORTS-4.5: a failed Stop says why in the dialog and the row stays; a row without a start time can\'t be confirmed', async () => {
    const user = userEvent.setup();
    const app = open('/s/a');
    vi.mocked(app.client.stopServer).mockRejectedValue(new Error('This server was restarted since the list was read, so nothing was stopped.'));
    app.emit({ type: 'ports', ports: ports([VITE, { ...WT1, startedAt: null }]) });
    await user.keyboard('p');
    await user.click(stopButton(601)!);
    let dialog = screen.getByRole('dialog', { name: 'Stop :5173 vite?' });
    expect(dialog).toHaveTextContent('In “Fantastic deal panel”.');
    await user.click(within(dialog).getByRole('button', { name: 'Stop' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('This server was restarted since the list was read, so nothing was stopped.');
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(panel().querySelector('[data-pid="601"]')).not.toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await user.click(stopButton(701)!);
    dialog = screen.getByRole('dialog', { name: 'Stop :3000 node?' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Lookout can’t confirm it’s the same server, so it won’t stop it.');
    expect(within(dialog).getByRole('button', { name: 'Stop' })).toBeDisabled();
  });
});

describe('PORTS-1.5, PORTS-3.2: the browser\'s helpers', () => {
  it('PORTS-1.5: how long a server has been up', () => {
    expect([upFor(NOW - 45_000, NOW), upFor(NOW - 14 * 60_000, NOW), upFor(NOW - 130 * 60_000, NOW), upFor(NOW - 120 * 60_000, NOW), upFor(NOW - 26 * 3600_000, NOW)]).toEqual(['45s', '14m', '2h 10m', '2h', '1d 2h']);
  });

  it('PORTS-3.2: a server whose Session Fleet no longer lists falls back to its repo', () => {
    const groups = groupServers(ports([{ ...WT1, sessionId: 'gone' }]), [], false);
    expect(groups.repos.map((g) => [g.name, g.servers.length])).toEqual([['api', 1]]);
  });
});
