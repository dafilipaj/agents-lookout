import { AMPHETAMINE_STORE_URL, FLEET_INSTALL_COMMAND, TB_PR_INSTALL_COMMAND, TB_SESSION_INSTALL_COMMAND } from '@shared/defaults.ts';
import { TOOLS, TOOL_GROUPS, TOOL_IDS, type ToolRow, type ToolsSnapshot } from '@shared/tools.ts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NOW, renderApp } from '@/test/helpers';
import { NEVER_RUNS } from './ToolsSection';

const row = (id: ToolRow['id'], over: Partial<ToolRow> = {}): ToolRow => ({
  id,
  purpose: TOOLS[id].purpose,
  path: `/usr/local/bin/${id}`,
  via: null,
  version: `${id} 1.0.0`,
  number: '1.0.0',
  revision: null,
  pin: null,
  needs: [...TOOLS[id].needs],
  state: 'ok',
  reason: 'New enough for everything Lookout does.',
  fix: null,
  link: null,
  checkedAt: NOW - 120_000,
  ...over,
});
const snapshot = (over: Partial<Record<ToolRow['id'], Partial<ToolRow>>> = {}, at = NOW - 120_000): ToolsSnapshot => ({
  rows: TOOL_IDS.map((id) => row(id, { checkedAt: at, ...over[id] })),
  checkedAt: at,
  reading: false,
});
const TROUBLE = snapshot({
  fleet: { version: 'fleet 0.1.0 (38a461c)', number: '0.1.0', revision: '38a461c', pin: '5e2afd8', state: 'behind', reason: 'Built from 38a461c; Lookout is tested against 5e2afd8.', fix: FLEET_INSTALL_COMMAND, path: '~/.cargo/bin/fleet', via: 'LOOKOUT_FLEET_BIN' },
  claude: { version: '2.1.314 (Claude Code)', number: '2.1.314', via: 'Fleet', state: 'newer-than-known', reason: "Fleet's model and Effort lists and its prompt reading were checked up to 2.1.312; re-check them." },
  codex: { version: 'codex-cli 0.163.0', number: '0.163.0', via: 'Fleet', state: 'update-available', reason: '0.164.0 is out (Codex checked 1 h ago).', fix: 'codex update' },
  'tb-session': { state: 'behind', reason: 'The Library needs 0.4.0.', fix: TB_SESSION_INSTALL_COMMAND, number: '0.3.0' },
  'tb-pr': { path: null, version: null, number: null, state: 'missing', reason: 'Not found on PATH or in ~/.local/bin.', fix: TB_PR_INSTALL_COMMAND },
  git: { state: 'unknown', version: null, number: null, reason: 'git --version took longer than 5 s.' },
  caffeinate: { path: '/usr/bin/caffeinate', version: null, number: null, reason: 'Comes with macOS; any version works.' },
  amphetamine: {
    path: null,
    version: null,
    number: null,
    state: 'missing',
    reason: "Keep-awake's Lid closed needs it; Awake works without it.",
    link: { label: 'Get it on the Mac App Store', href: AMPHETAMINE_STORE_URL },
  },
});

const toolsLink = () => within(screen.getByRole('navigation', { name: 'Settings' })).getByRole('link', { name: 'Tools' });
async function openSettings(tools: ToolsSnapshot | null, client: Parameters<typeof renderApp>[1] = {}) {
  const user = userEvent.setup();
  const app = renderApp('/', client);
  app.snapshot([]);
  if (tools) app.emit({ type: 'tools', tools });
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  // SIDE-7.6: Settings opens on General; the Tools are a sub-page of their own, read when it opens (TOOLS-1.4).
  const asked = vi.mocked(app.client.tools).mock.calls.length;
  await user.click(toolsLink());
  const section = screen.getByRole('region', { name: 'Tools' });
  return { app, user, section, asked, item: (id: string) => section.querySelector<HTMLElement>(`[data-tool="${id}"]`)! };
}

describe('Settings › Tools', () => {
  it('TOOLS-1.1: every Tool has a row with what it is for, where it was found and how, its version and its state; Fleet with its revision', async () => {
    const { section, item } = await openSettings(TROUBLE);
    expect([...section.querySelectorAll('[data-tool]')].map((e) => e.getAttribute('data-tool'))).toEqual(TOOL_GROUPS.flatMap((g) => g.ids));
    expect(item('tb-pr')).toHaveTextContent('Work reads PRs through it');
    expect(within(item('fleet')).getByText('~/.cargo/bin/fleet (LOOKOUT_FLEET_BIN)')).toBeInTheDocument();
    expect(item('fleet').querySelector('[data-field="version"]')).toHaveTextContent('0.1.0 @ 38a461c');
    expect(item('claude').querySelector('[data-field="path"]')).toHaveTextContent('(Fleet)');
    expect(item('tb-pr').querySelector('[data-field="path"]')).toHaveTextContent('—');
    expect(item('git')).toHaveTextContent('unknown · git --version took longer than 5 s.');
    expect(item('tmux').querySelector('[data-field="state"]')).toHaveTextContent('ok');
  });

  it('TOOLS-1.4: opening Settings › Tools, not General, asks the server for the Tools once; the page says how old they are, and Refresh reads them now', async () => {
    // The page's clock is the app's: ages from now.
    const old = snapshot({}, Date.now() - 120_000);
    const fresh = snapshot({}, Date.now());
    const tools = vi.fn(async () => old);
    const refreshTools = vi.fn(async () => fresh);
    const { section, user, asked } = await openSettings(old, { tools, refreshTools });
    expect(asked).toBe(0);
    await waitFor(() => expect(tools).toHaveBeenCalledTimes(1));
    expect(section.querySelector('[data-field="checked"]')).toHaveTextContent('Checked 2m ago');
    await user.click(within(section).getByRole('button', { name: 'Refresh' }));
    expect(refreshTools).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(section.querySelector('[data-field="checked"]')).toHaveTextContent(/^Checked \d+s ago$/));
    expect(tools).toHaveBeenCalledTimes(1);
  });

  it('TOOLS-1.4: before the first read lands, every Tool shows "checking…"', async () => {
    const { section } = await openSettings(null, { tools: () => new Promise(() => {}) });
    const versions = [...section.querySelectorAll('[data-field="version"]')].map((e) => e.textContent);
    expect(versions).toEqual(TOOL_IDS.map(() => 'checking…'));
  });

  it('TOOLS-3.4: the page says once that Lookout never installs or updates, and every fix is a command block to copy, never a button that runs it', async () => {
    const { section, item } = await openSettings(TROUBLE);
    expect(within(section).getAllByText(NEVER_RUNS)).toHaveLength(1);
    expect(screen.getAllByText(/never installs or updates/)).toHaveLength(1);
    for (const [id, fix] of [['fleet', FLEET_INSTALL_COMMAND], ['tb-session', TB_SESSION_INSTALL_COMMAND], ['tb-pr', TB_PR_INSTALL_COMMAND], ['codex', 'codex update']] as const) {
      expect(item(id).querySelector('[data-slot="command-block"]'), id).toHaveTextContent(fix);
    }
    // The only button in the section reads versions; the one link leaves for the App Store, which installs (TOOLS-5.4).
    expect(within(section).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Refresh']);
    expect(within(section).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([AMPHETAMINE_STORE_URL]);
  });

  it('TOOLS-4.2 (support): missing and behind are error Alerts, update-available and newer-than-known info ones, ok plain text', async () => {
    const { item } = await openSettings(TROUBLE);
    const tone = (id: string) => item(id).querySelector('[data-slot="alert"]')?.getAttribute('data-tone') ?? null;
    expect(TOOL_IDS.map((id) => [id, tone(id)])).toEqual([
      ['fleet', 'error'],
      ['claude', 'info'],
      ['codex', 'info'],
      ['tb-session', 'error'],
      ['tb-pr', 'error'],
      ['tb-prod', null],
      ['tb-jev', null],
      ['git', null],
      ['tmux', null],
      ['caffeinate', null],
      ['amphetamine', 'info'],
    ]);
    expect(within(item('tb-pr')).getByRole('alert')).toHaveTextContent('tb-pr is missing');
    expect(within(item('claude')).getByRole('status')).toHaveTextContent('Newer than Fleet knows (2.1.312)');
    // The Harness rows keep their fix-free state: nothing to run for a re-check.
    expect(item('claude').querySelector('[data-slot="command-block"]')).toBeNull();
  });
});

describe('third-party programs (TOOLS-5)', () => {
  it('TOOLS-5.1: the rows sit in two lists, Building blocks then Third-party, each under its heading; Amphetamine is named as an app, the rest by their command', async () => {
    const { section, item } = await openSettings(TROUBLE);
    const lists = within(section).getAllByRole('list');
    expect(lists.map((l) => l.getAttribute('aria-labelledby') && section.querySelector(`#${l.getAttribute('aria-labelledby')}`)?.textContent)).toEqual(['Building blocks', 'Third-party']);
    expect(within(section).getByRole('list', { name: 'Building blocks' }).querySelectorAll('[data-tool]')).toHaveLength(5);
    const third = within(section).getByRole('list', { name: 'Third-party' });
    expect([...third.querySelectorAll('[data-tool]')].map((e) => e.getAttribute('data-tool'))).toEqual(['claude', 'codex', 'git', 'tmux', 'caffeinate', 'amphetamine']);
    expect(within(section).getByRole('heading', { name: 'Third-party' })).toHaveClass('text-caption', 'font-medium', 'text-muted-foreground');
    expect(within(item('amphetamine')).getByText('Amphetamine')).not.toHaveClass('font-mono');
    expect(within(item('caffeinate')).getByText('caffeinate')).toHaveClass('font-mono');
    expect(item('caffeinate').querySelector('[data-field="version"]')).toHaveTextContent('—');
  });

  it('TOOLS-5.4: Amphetamine not installed is an info Alert with the Mac App Store link, opening in a new tab; without its helper it says so with no link; neither marks the Settings button', async () => {
    const { app, item } = await openSettings(TROUBLE);
    const alert = within(item('amphetamine')).getByRole('status');
    expect(alert).toHaveAttribute('data-tone', 'info');
    expect(alert).toHaveTextContent("Not installedKeep-awake's Lid closed needs it; Awake works without it.");
    const link = within(alert).getByRole('link', { name: 'Get it on the Mac App Store' });
    expect(link).toHaveAttribute('href', AMPHETAMINE_STORE_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.querySelector('svg')).toHaveClass('lucide-external-link');
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('title')).not.toMatch(/amphetamine/i);

    app.emit({ type: 'tools', tools: snapshot({ amphetamine: { path: '/Applications/Amphetamine.app', state: 'missing', reason: "Lid closed also needs its Power Protect helper, from Amphetamine's settings." } }, NOW) });
    const half = within(item('amphetamine')).getByRole('status');
    expect(half).toHaveTextContent("Not set upLid closed also needs its Power Protect helper, from Amphetamine's settings.");
    expect(within(half).queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('title', 'Settings');
  });
});

describe('the Settings button', () => {
  it('TOOLS-2.4: a dot marks it while a Tool is missing or behind, its tooltip naming each; update-available and newer-than-known don’t', async () => {
    const app = renderApp('/');
    app.snapshot([]);
    const button = screen.getByRole('button', { name: 'Settings' });
    const dot = () => button.querySelector('[data-field="tools-dot"]');
    expect(dot()).toBeNull();
    app.emit({ type: 'tools', tools: TROUBLE });
    expect(dot()).not.toBeNull();
    expect(button).toHaveAttribute('title', 'Settings: fleet is behind, tb-session is behind, tb-pr is missing');
    // Its name stays "Settings": the tooltip says why.
    expect(button).toHaveAccessibleName('Settings');
    // SIDE-7.6: Settings' Tools link carries the same dot, naming the same Tools.
    await userEvent.setup().click(button);
    expect(toolsLink().querySelector('[data-field="tools-dot"]')).not.toBeNull();
    expect(toolsLink()).toHaveAttribute('title', 'fleet is behind, tb-session is behind, tb-pr is missing');
    act(() => {});
    app.emit({ type: 'tools', tools: snapshot({ claude: { state: 'newer-than-known' }, codex: { state: 'update-available' } }, NOW) });
    expect(dot()).toBeNull();
    expect(button).toHaveAttribute('title', 'Settings');
    expect(toolsLink().querySelector('[data-field="tools-dot"]')).toBeNull();
    expect(toolsLink()).not.toHaveAttribute('title');
  });
});
