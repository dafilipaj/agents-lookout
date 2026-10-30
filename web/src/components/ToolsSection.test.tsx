import { FLEET_INSTALL_COMMAND, TB_PR_INSTALL_COMMAND, TB_SESSION_INSTALL_COMMAND } from '@shared/defaults.ts';
import { TOOLS, TOOL_IDS, type ToolRow, type ToolsSnapshot } from '@shared/tools.ts';
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
});

async function openSettings(tools: ToolsSnapshot | null, client: Parameters<typeof renderApp>[1] = {}) {
  const user = userEvent.setup();
  const app = renderApp('/', client);
  app.snapshot([]);
  if (tools) app.emit({ type: 'tools', tools });
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  const section = screen.getByRole('region', { name: 'Tools' });
  return { app, user, section, item: (id: string) => section.querySelector<HTMLElement>(`[data-tool="${id}"]`)! };
}

describe('Settings › Tools', () => {
  it('TOOLS-1.1: every Tool has a row with what it is for, where it was found and how, its version and its state; Fleet with its revision', async () => {
    const { section, item } = await openSettings(TROUBLE);
    expect([...section.querySelectorAll('[data-tool]')].map((e) => e.getAttribute('data-tool'))).toEqual([...TOOL_IDS]);
    expect(item('tb-pr')).toHaveTextContent('Work reads PRs through it');
    expect(within(item('fleet')).getByText('~/.cargo/bin/fleet (LOOKOUT_FLEET_BIN)')).toBeInTheDocument();
    expect(item('fleet').querySelector('[data-field="version"]')).toHaveTextContent('0.1.0 @ 38a461c');
    expect(item('claude').querySelector('[data-field="path"]')).toHaveTextContent('(Fleet)');
    expect(item('tb-pr').querySelector('[data-field="path"]')).toHaveTextContent('—');
    expect(item('git')).toHaveTextContent('unknown · git --version took longer than 5 s.');
    expect(item('tmux').querySelector('[data-field="state"]')).toHaveTextContent('ok');
  });

  it('TOOLS-1.4: opening Settings asks the server for the Tools once, the page says how old they are, and Refresh reads them now', async () => {
    // The page's clock is the app's: ages from now.
    const old = snapshot({}, Date.now() - 120_000);
    const fresh = snapshot({}, Date.now());
    const tools = vi.fn(async () => old);
    const refreshTools = vi.fn(async () => fresh);
    const { section, user } = await openSettings(old, { tools, refreshTools });
    await waitFor(() => expect(tools).toHaveBeenCalledTimes(1));
    expect(section.querySelector('[data-field="checked"]')).toHaveTextContent('Checked 2m ago');
    await user.click(within(section).getByRole('button', { name: 'Refresh' }));
    expect(refreshTools).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(section.querySelector('[data-field="checked"]')).toHaveTextContent('Checked just now'));
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
    // The only button in the section reads versions.
    expect(within(section).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Refresh']);
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
    ]);
    expect(within(item('tb-pr')).getByRole('alert')).toHaveTextContent('tb-pr is missing');
    expect(within(item('claude')).getByRole('status')).toHaveTextContent('Newer than Fleet knows (2.1.312)');
    // The Harness rows keep their fix-free state: nothing to run for a re-check.
    expect(item('claude').querySelector('[data-slot="command-block"]')).toBeNull();
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
    act(() => {});
    app.emit({ type: 'tools', tools: snapshot({ claude: { state: 'newer-than-known' }, codex: { state: 'update-available' } }, NOW) });
    expect(dot()).toBeNull();
    expect(button).toHaveAttribute('title', 'Settings');
  });
});
