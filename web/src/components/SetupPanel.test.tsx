import type { SessionInstruction, SessionRan, SessionSetup, SetupItem, SetupSnapshot } from '@shared/setup.ts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, openMore, renderApp, row } from '@/test/helpers';

// Invented look-alikes of a Harness setup.
const KIT = { type: 'plugin' as const, name: 'p-kit', id: 'p-kit@market', version: '1.2.0' };
const TOOLS = { type: 'plugin' as const, name: 'a-tools', id: 'a-tools@market', version: '0.4.1' };
const OLD = { type: 'plugin' as const, name: 'p-old', id: 'p-old@market', version: '0.3.0' };
const YOURS = { type: 'yours' as const };
const item = (o: Partial<SetupItem> & Pick<SetupItem, 'key' | 'kind' | 'name'>): SetupItem => ({ harness: 'claude', description: '', source: YOURS, file: `/home/me/${o.name}.md`, line: null, off: null, ...o });

const NOTES = item({ key: 'notes', kind: 'skill', name: 'notes', description: 'Keep notes for later.\nA second line.', call: '/notes add | list', file: '/home/me/.claude/skills/notes/SKILL.md' });
const FIX = item({ key: 'fix', kind: 'skill', name: 'fix', harness: 'codex', description: 'Fix a failing test.', call: '$fix' });
const DOCS = item({ key: 'docs', kind: 'skill', name: 'anthropic-skills:docs', description: 'Shared docs.', source: { type: 'claude-ai' } });
const REVIEW = item({ key: 'review', kind: 'skill', name: 'p-kit:review', description: 'Review a pull request, findings first.', call: '/p-kit:review <pr>', source: KIT, file: '/home/me/cache/p-kit/skills/review/SKILL.md' });
const DRAFT = item({ key: 'draft', kind: 'skill', name: 'p-kit:draft', description: 'Draft a plan.', source: KIT });
const LINT = item({ key: 'lint', kind: 'skill', name: 'a-tools:lint', description: 'Lint the code.', source: TOOLS });
const GONE = item({ key: 'gone', kind: 'skill', name: 'gone', description: 'Not found on disk: only its skillOverrides entry', off: 'override-missing', overrideKey: 'gone', file: '/home/me/.claude/settings.json', line: 4 });
const LEGACY = item({ key: 'legacy', kind: 'skill', name: 'p-old:legacy', description: 'An old skill.', source: OLD, off: 'plugin' });
const CHECKER = item({ key: 'checker', kind: 'agent', name: 'p-kit:checker', description: 'Checks a review.', source: KIT, model: 'sonnet', effort: 'low', tools: ['Read', 'Grep'] });
const RELAY = item({ key: 'relay', kind: 'hook', name: 'relay-hook.sh', description: '2 events', events: [{ event: 'Stop', matcher: null }, { event: 'SessionStart', matcher: null }], command: '/bin/sh "$HOME/.relay/relay-hook.sh"', timeout: 5, file: '/home/me/.claude/settings.json', line: 12 });
const NOTIFY = item({ key: 'notify', kind: 'hook', name: 'notify.mjs', harness: 'codex', description: 'Stop', events: [{ event: 'Stop', matcher: null }], command: 'node notify.mjs', off: 'untrusted' });
const TICKETS = item({ key: 'tickets', kind: 'mcp', name: 'tickets', harness: 'codex', description: 'https://tickets.example/mcp', transport: 'http', url: 'https://tickets.example/mcp', env: ['TICKETS_TOKEN'], headers: [], file: '/home/me/.codex/config.toml', line: 3 });

const SNAPSHOT: SetupSnapshot = {
  items: [NOTES, FIX, DOCS, REVIEW, DRAFT, LINT, GONE, LEGACY, CHECKER, RELAY, NOTIFY, TICKETS],
  errors: [{ kind: 'hook', file: '/home/me/.codex/hooks.json', error: 'Unexpected token' }],
  readAt: NOW,
};

const panel = () => document.getElementById('right-panel-setup')!;
const section = (name: string) => within(panel()).getByRole('group', { name });
const groupLine = (label: RegExp | string) => within(panel()).getAllByRole('option').find((o) => o.getAttribute('data-field') === 'group' && (typeof label === 'string' ? o.getAttribute('aria-label') === label : label.test(o.getAttribute('aria-label') ?? '')))!;
const itemRow = (name: string) => within(panel()).getAllByRole('option').find((o) => o.getAttribute('data-field') === 'item' && o.getAttribute('aria-label')?.startsWith(`${name},`))!;
const shownRows = () => within(panel()).queryAllByRole('option').filter((o) => o.getAttribute('data-field') === 'item').map((o) => o.getAttribute('aria-label')!.split(',')[0]);

function open(setup: () => Promise<SetupSnapshot> = async () => SNAPSHOT, extra: Parameters<typeof renderApp>[1] = {}) {
  const app = renderApp('/s/a', { setup, ...extra });
  app.snapshot([row({ id: 'a', title: 'API rates port', statusSince: NOW - 1000 })]);
  return app;
}
async function openSetup(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('u');
  await screen.findByRole('group', { name: 'Skills' });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});
afterEach(() => vi.useRealTimers());

describe('the tab (SETUP-1)', () => {
  it('SETUP-1.1: a sixth tab after Servers, its icon Puzzle, on the rail too; U opens and closes it', async () => {
    const user = userEvent.setup();
    open();
    expect(screen.getByRole('button', { name: 'Setup' }).querySelector('svg.lucide-puzzle')).not.toBeNull();
    await user.keyboard('u');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['History', 'Work', 'Library', 'Topics', 'Servers', 'Setup']);
    expect(tabs[5]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[5]).toHaveAttribute('title', 'Setup (U)');
    expect(tabs[5]!.querySelector('svg.lucide-puzzle')).not.toBeNull();
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('u');
    expect(screen.queryByRole('tab', { name: 'Setup' })).toBeNull();
  });

  it('SETUP-1.2: four sections in order with the count of rows that are on; a five-way kind filter, remembered; a text filter on name and description', async () => {
    const user = userEvent.setup();
    const app = open();
    await openSetup(user);
    const sections = within(panel()).getAllByRole('group').filter((g) => g.hasAttribute('data-kind'));
    expect(sections.map((g) => g.getAttribute('data-kind'))).toEqual(['skill', 'agent', 'hook', 'mcp']);
    expect(sections.map((g) => g.querySelector('p')!.textContent)).toEqual(['Skills6', 'Agents1', 'Hooks1', 'MCP servers1']);
    const kind = within(panel()).getByRole('radiogroup', { name: 'Kind' });
    expect(within(kind).getAllByRole('radio').map((r) => r.textContent)).toEqual(['All', 'Skills', 'Agents', 'Hooks', 'MCP']);
    await user.click(within(kind).getByRole('radio', { name: 'Hooks' }));
    expect(within(panel()).getAllByRole('group').filter((g) => g.hasAttribute('data-kind')).map((g) => g.getAttribute('data-kind'))).toEqual(['hook']);
    expect(JSON.parse(window.localStorage.getItem('lookout.right')!).setupFilter).toBe('hook');
    app.unmount();
    // Remembered across a reload.
    open();
    // The sidebar reopens on Setup, as it was.
    await screen.findByRole('group', { name: 'Hooks' });
    expect(within(panel()).getByRole('radio', { name: 'Hooks' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(panel()).getByRole('radio', { name: 'All' }));
    // The filter matches a name ("review") and a description ("Checks a review.").
    await user.type(within(panel()).getByRole('searchbox', { name: 'Filter Setup' }), 'review');
    expect(within(panel()).getAllByRole('group').filter((g) => g.hasAttribute('data-kind')).map((g) => g.getAttribute('data-kind'))).toEqual(['skill', 'agent']);
    expect(shownRows()).toEqual(['p-kit:review', 'p-kit:checker']);
  });

  it('SETUP-1.3: grouped by source: Yours, claude.ai, then each plugin alphabetically, each line with its icon, count and version', async () => {
    const user = userEvent.setup();
    open();
    await openSetup(user);
    const lines = within(section('Skills')).getAllByRole('option').filter((o) => o.getAttribute('data-field') === 'group');
    expect(lines.map((l) => l.getAttribute('aria-label'))).toEqual(['Yours, 2', 'claude.ai, 1', 'a-tools, 1, 0.4.1', 'p-kit, 2, 1.2.0', '2 off']);
    expect(lines[0]!.querySelector('svg.lucide-user')).not.toBeNull();
    expect(lines[1]!.querySelector('svg.lucide-cloud')).not.toBeNull();
    expect(lines[3]!.querySelector('svg.lucide-package')).not.toBeNull();
    expect(lines[3]).toHaveTextContent('p-kit21.2.0');
  });

  it('SETUP-1.4: groups start folded; a press, Enter, → and ← open and close one; remembered; a filter opens the groups with a match and marks it', async () => {
    const user = userEvent.setup();
    const app = open();
    await openSetup(user);
    expect(shownRows()).toEqual([]);
    expect(groupLine('Yours, 2')).toHaveAttribute('aria-expanded', 'false');
    await user.click(groupLine('Yours, 2'));
    expect(shownRows()).toEqual(['fix', 'notes']);
    await user.keyboard('{Enter}');
    expect(shownRows()).toEqual([]);
    await user.keyboard('{ArrowRight}');
    expect(shownRows()).toEqual(['fix', 'notes']);
    await user.keyboard('{ArrowLeft}');
    await user.keyboard('j{ArrowRight}');
    expect(groupLine('claude.ai, 1')).toHaveAttribute('aria-expanded', 'true');
    expect(JSON.parse(window.localStorage.getItem('lookout.right')!).setupOpen).toEqual(['skill:claude-ai']);
    app.unmount();
    open();
    await screen.findByRole('group', { name: 'Skills' });
    expect(shownRows()).toEqual(['anthropic-skills:docs']);
    await user.type(within(panel()).getByRole('searchbox', { name: 'Filter Setup' }), 'draft');
    expect(shownRows()).toEqual(['p-kit:draft']);
    expect(groupLine('p-kit, 1, 1.2.0')).toHaveAttribute('aria-expanded', 'true');
    expect(itemRow('p-kit:draft').querySelector('mark')).toHaveTextContent('draft');
  });

  it('SETUP-1.5: a row is one line: its Harness’s icon, its name as called, its description’s first line', async () => {
    const user = userEvent.setup();
    open();
    await openSetup(user);
    await user.click(groupLine('Yours, 2'));
    const notes = itemRow('notes');
    expect(notes.querySelector('[data-harness="claude"], svg')).not.toBeNull();
    expect(notes.querySelector('[data-field="title"]')).toHaveTextContent('notes');
    expect(notes.querySelector('[data-field="description"]')).toHaveTextContent(/^Keep notes for later\.$/);
    expect(itemRow('fix').getAttribute('aria-label')).toBe('fix, Fix a failing test., Codex');
  });

  it('SETUP-1.6: a hook’s row says its events', async () => {
    const user = userEvent.setup();
    open();
    await openSetup(user);
    await user.click(within(section('Hooks')).getByRole('option', { name: 'Yours, 1' }));
    expect(itemRow('relay-hook.sh').querySelector('[data-field="description"]')).toHaveTextContent('2 events');
  });

  it('SETUP-1.7: Skills and Agents start with the built-in note, Hooks and MCP servers don’t', async () => {
    const user = userEvent.setup();
    open();
    await openSetup(user);
    const note = 'Plus the ones built into Claude Code, which Lookout can’t read.';
    expect(within(section('Skills')).getByText(note)).toBeInTheDocument();
    expect(within(section('Agents')).getByText(note)).toBeInTheDocument();
    expect(within(section('Hooks')).queryByText(note)).toBeNull();
    expect(within(section('MCP servers')).queryByText(note)).toBeNull();
  });

  it('SETUP-1.8: read when the tab opens, and again each time it does', async () => {
    const user = userEvent.setup();
    const app = open();
    expect(app.client.setup).not.toHaveBeenCalled();
    await openSetup(user);
    expect(app.client.setup).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('tab', { name: 'Work' }));
    await user.click(screen.getByRole('tab', { name: 'Setup' }));
    await waitFor(() => expect(app.client.setup).toHaveBeenCalledTimes(2));
  });
});

describe('what’s read (SETUP-2)', () => {
  it('SETUP-2.3: a file that couldn’t be read is one row in its section, naming the file and the error', async () => {
    const user = userEvent.setup();
    open();
    await openSetup(user);
    expect(within(section('Hooks')).getByText('Couldn’t read /home/me/.codex/hooks.json: Unexpected token')).toBeInTheDocument();
    expect(within(section('Skills')).queryByText(/Couldn’t read/)).toBeNull();
  });
});

describe('an item’s details (SETUP-3)', () => {
  it('SETUP-3.1: a press expands a row: its state, a summary, its file in the tooltip; by kind', async () => {
    const user = userEvent.setup();
    open();
    await openSetup(user);
    await user.click(groupLine('p-kit, 2, 1.2.0'));
    fireEvent.click(itemRow('p-kit:review'));
    const review = itemRow('p-kit:review');
    expect(review).toHaveAttribute('aria-expanded', 'true');
    const state = review.querySelector('[data-field="state"]')!;
    expect(state).toHaveTextContent('p-kit 1.2.0 · Claude Code');
    expect(state.getAttribute('title')).toBe('/home/me/cache/p-kit/skills/review/SKILL.md');
    expect(review.querySelector('[data-field="call"]')).toHaveTextContent('/p-kit:review <pr>');
    expect(review.querySelector('[data-field="row-summary"]')).toHaveTextContent('Review a pull request, findings first.');
    // An agent: model, Effort, tools counted and named in the tooltip.
    await user.click(within(section('Agents')).getByRole('option', { name: 'p-kit, 1, 1.2.0' }));
    fireEvent.click(itemRow('p-kit:checker'));
    const agent = itemRow('p-kit:checker').querySelector('[data-field="state"]')!;
    expect(agent).toHaveTextContent('sonnet · low Effort · 2 tools');
    expect(agent.getAttribute('title')).toBe('Tools: Read, Grep\n/home/me/p-kit:checker.md');
    // A hook: its events and timeout; its whole command.
    await user.click(within(section('Hooks')).getByRole('option', { name: 'Yours, 1' }));
    fireEvent.click(itemRow('relay-hook.sh'));
    const hook = itemRow('relay-hook.sh');
    expect(hook.querySelector('[data-field="state"]')).toHaveTextContent('2 events · 5 s');
    expect(hook.querySelector('[data-field="state"]')!.getAttribute('title')).toBe('Events: Stop, SessionStart\n/home/me/.claude/settings.json:12');
    expect(hook.querySelector('[data-field="command"]')).toHaveTextContent('/bin/sh "$HOME/.relay/relay-hook.sh"');
    // An MCP server: transport, env vars by name only.
    await user.click(within(section('MCP servers')).getByRole('option', { name: 'Yours, 1' }));
    fireEvent.click(itemRow('tickets'));
    const mcp = itemRow('tickets').querySelector('[data-field="state"]')!;
    expect(mcp).toHaveTextContent('http · 1 env var');
    expect(mcp.getAttribute('title')).toBe('Environment: TICKETS_TOKEN\n/home/me/.codex/config.toml:3');
  });

  it('SETUP-3.2: Open in VS Code, and Enter on the expanded row, open its file at its line', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    open();
    await openSetup(user);
    await user.click(within(section('Hooks')).getByRole('option', { name: 'Yours, 1' }));
    fireEvent.click(itemRow('relay-hook.sh'));
    await user.click(within(itemRow('relay-hook.sh')).getByRole('button', { name: /Open in VS Code/ }));
    expect(opened).toHaveBeenLastCalledWith('vscode://file/home/me/.claude/settings.json:12', '_self');
    opened.mockClear();
    await user.keyboard('{Enter}');
    expect(opened).toHaveBeenLastCalledWith('vscode://file/home/me/.claude/settings.json:12', '_self');
  });
});

describe('switches (SETUP-4)', () => {
  const after = (items: SetupItem[]) => async () => ({ snapshot: { ...SNAPSHOT, items } });

  it('SETUP-4.1: Turn off a skill under More; Turn on an off one removes its entry', async () => {
    const user = userEvent.setup();
    const app = open(undefined, { switchSkill: vi.fn(after(SNAPSHOT.items.map((i) => (i === NOTES ? { ...NOTES, off: 'override' as const, overrideKey: 'notes' } : i)))) });
    await openSetup(user);
    await user.click(groupLine('Yours, 2'));
    fireEvent.click(itemRow('notes'));
    await user.click(within(await openMore(itemRow('notes'), user)).getByRole('menuitem', { name: /^Turn off/ }));
    expect(app.client.switchSkill).toHaveBeenCalledWith('notes', false);
    await user.click(groupLine('3 off'));
    fireEvent.click(itemRow('gone'));
    await user.click(within(await openMore(itemRow('gone'), user)).getByRole('menuitem', { name: /^Turn on/ }));
    expect(app.client.switchSkill).toHaveBeenLastCalledWith('gone', true);
  });

  it('SETUP-4.2: Turn off plugin asks first, listing what it turns off, then switches it; an off plugin turns on at once', async () => {
    const user = userEvent.setup();
    const app = open(undefined, { switchPlugin: vi.fn(after(SNAPSHOT.items)) });
    await openSetup(user);
    await user.click(groupLine('p-kit, 2, 1.2.0'));
    fireEvent.click(itemRow('p-kit:draft'));
    await user.click(within(await openMore(itemRow('p-kit:draft'), user)).getByRole('menuitem', { name: 'Turn off plugin p-kit…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Turn off plugin p-kit?' });
    expect(dialog).toHaveTextContent('It turns off 2 skills and 1 agent, for Sessions started from now on.');
    expect(app.client.switchPlugin).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }));
    expect(app.client.switchPlugin).toHaveBeenCalledWith('p-kit@market', false);
    await user.click(groupLine('2 off'));
    fireEvent.click(itemRow('p-old:legacy'));
    const menu = await openMore(itemRow('p-old:legacy'), user);
    // Its plugin turns it off, so the skill has no switch of its own.
    // Its plugin turns it off, so X turns its plugin on.
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Turn on plugin p-oldX']);
    await user.click(within(menu).getByRole('menuitem', { name: /^Turn on plugin p-old/ }));
    expect(app.client.switchPlugin).toHaveBeenLastCalledWith('p-old@market', true);
  });

  it('SETUP-4.3: after a switch, it says it applies to Sessions started from now on, and shows the read after it', async () => {
    const user = userEvent.setup();
    open(undefined, { switchSkill: vi.fn(after(SNAPSHOT.items.filter((i) => i !== NOTES).concat({ ...NOTES, off: 'override', overrideKey: 'notes' }))) });
    await openSetup(user);
    await user.click(groupLine('Yours, 2'));
    fireEvent.click(itemRow('notes'));
    await user.click(within(await openMore(itemRow('notes'), user)).getByRole('menuitem', { name: /^Turn off/ }));
    expect(await within(panel()).findByText('Turned off notes. Sessions started from now on won’t load it; running ones keep what they loaded.')).toBeInTheDocument();
    expect(groupLine('Yours, 1')).toBeDefined();
    expect(groupLine('3 off')).toBeDefined();
  });

  it('SETUP-4.4: agents, hooks, MCP servers and Codex’s items have no switch of their own', async () => {
    const user = userEvent.setup();
    open();
    await openSetup(user);
    await user.click(groupLine('Yours, 2'));
    fireEvent.click(itemRow('fix'));
    expect(within(itemRow('fix')).queryByRole('button', { name: 'More' })).toBeNull();
    await user.click(within(section('Hooks')).getByRole('option', { name: 'Yours, 1' }));
    fireEvent.click(itemRow('relay-hook.sh'));
    expect(within(itemRow('relay-hook.sh')).queryByRole('button', { name: 'More' })).toBeNull();
    await user.click(within(section('MCP servers')).getByRole('option', { name: 'Yours, 1' }));
    fireEvent.click(itemRow('tickets'));
    expect(within(itemRow('tickets')).queryByRole('button', { name: 'More' })).toBeNull();
    // A plugin's agent has its plugin's switch only.
    await user.click(within(section('Agents')).getByRole('option', { name: 'p-kit, 1, 1.2.0' }));
    fireEvent.click(itemRow('p-kit:checker'));
    expect(within(await openMore(itemRow('p-kit:checker'), user)).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Turn off plugin p-kit…X']);
  });

  it('SETUP-4.5: X on the selected row runs its switch: a skill’s own, else its plugin’s, which asks first; More shows X by it', async () => {
    const user = userEvent.setup();
    const app = open(undefined, { switchSkill: vi.fn(after(SNAPSHOT.items)), switchPlugin: vi.fn(after(SNAPSHOT.items)) });
    await openSetup(user);
    await user.click(groupLine('p-kit, 2, 1.2.0'));
    fireEvent.click(itemRow('p-kit:draft'));
    const menu = await openMore(itemRow('p-kit:draft'), user);
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Turn offX', 'Turn off plugin p-kit…']);
    await user.keyboard('{Escape}');
    await user.keyboard('x');
    expect(app.client.switchSkill).toHaveBeenCalledWith('p-kit:draft', false);
    await waitFor(() => expect(within(panel()).getByText(/^Turned off p-kit:draft/)).toBeInTheDocument());
    // A plugin's agent: X asks before turning its plugin off; keys in the confirmation stay there.
    await user.click(within(section('Agents')).getByRole('option', { name: 'p-kit, 1, 1.2.0' }));
    fireEvent.click(itemRow('p-kit:checker'));
    await user.keyboard('x');
    const dialog = await screen.findByRole('dialog', { name: 'Turn off plugin p-kit?' });
    await user.keyboard('x');
    expect(app.client.switchPlugin).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }));
    expect(app.client.switchPlugin).toHaveBeenCalledWith('p-kit@market', false);
    // A hook has no switch: X does nothing.
    await user.click(within(section('Hooks')).getByRole('option', { name: 'Yours, 1' }));
    fireEvent.click(itemRow('relay-hook.sh'));
    await user.keyboard('x');
    expect(app.client.switchSkill).toHaveBeenCalledTimes(1);
    expect(app.client.switchPlugin).toHaveBeenCalledTimes(1);
  });
});

describe('what’s off (SETUP-5)', () => {
  it('SETUP-5.1: off items leave their groups and counts; the section’s off line lists them, quieter, with their source and why', async () => {
    const user = userEvent.setup();
    open();
    await openSetup(user);
    expect(groupLine('2 off')).toBeDefined();
    expect(shownRows()).toEqual([]);
    await user.click(groupLine('2 off'));
    expect(shownRows()).toEqual(['gone', 'p-old:legacy']);
    expect(itemRow('gone').closest('[data-field="off-rows"]')).toHaveClass('opacity-60');
    expect(itemRow('gone').querySelector('[data-field="description"]')).toHaveTextContent('Yours · off in skillOverrides, not found on disk');
    expect(itemRow('p-old:legacy').querySelector('[data-field="description"]')).toHaveTextContent('p-old · its plugin is off');
    expect(within(section('Hooks')).getByRole('option', { name: '1 off' })).toBeDefined();
  });
});

// SETUP-6 to SETUP-9: This Session, an invented Session in an invented repo, ledger-web.
const SID = '0b7c1a2e-4d5f-4a6b-8c9d-0e1f2a3b4c5d';
const SID2 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const REPO = '/home/me/Projects/ledger-web';
const LOADED = NOW - 60 * 60_000;
const at = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const file = (o: Partial<SessionInstruction> & Pick<SessionInstruction, 'path' | 'shown' | 'group'>): SessionInstruction => ({ key: `file:${o.path}`, importer: null, imports: 0, lines: 10, tokens: 200, loadedAt: LOADED, later: false, disk: 'same', changedAt: null, ...o });
const USER_MD = file({ path: '/home/me/.claude/CLAUDE.md', shown: '~/.claude/CLAUDE.md', group: 'yours', lines: 64, tokens: 1100 });
const CLAUDE_MD = file({ path: `${REPO}/CLAUDE.md`, shown: 'CLAUDE.md', group: 'repo', imports: 1, lines: 3, tokens: 10 });
const AGENTS_MD = file({ path: `${REPO}/AGENTS.md`, shown: 'AGENTS.md', group: 'repo', importer: CLAUDE_MD.key, lines: 48, tokens: 900, disk: 'changed', changedAt: NOW - 10 * 60_000 });
const LOCAL_MD = file({ path: `${REPO}/CLAUDE.local.md`, shown: 'CLAUDE.local.md', group: 'repo', lines: 6, tokens: 40, disk: 'gone' });
const API_MD = file({ path: `${REPO}/api/CLAUDE.md`, shown: 'api/CLAUDE.md', group: 'repo', lines: 2, tokens: 9, later: true, loadedAt: NOW - 30 * 60_000 });
const REPO_SRC = { type: 'repo' as const };
const RELEASE = item({ key: 'skill:claude:repo:release', kind: 'skill', name: 'release', description: 'Cut a release.', call: '/release', source: REPO_SRC, file: `${REPO}/.claude/skills/release/SKILL.md` });
const LEDGER_DB = item({ key: 'mcp:claude:repo:ledger-db', kind: 'mcp', name: 'ledger-db', description: 'npx db-mcp --token …', transport: 'stdio', command: 'npx', args: ['db-mcp', '--token', '…'], env: [], headers: [], source: REPO_SRC, file: `${REPO}/.mcp.json`, line: 3 });
const MIGRATE = item({ key: 'skill:claude:repo:migrate', kind: 'skill', name: 'migrate', description: 'Migrate the schema.', source: REPO_SRC, file: `${REPO}/.claude/skills/migrate/SKILL.md` });
const ran = (o: Partial<SessionRan> & Pick<SessionRan, 'key' | 'kind' | 'name' | 'count'>): SessionRan => ({ failed: 0, events: [], item: null, builtIn: false, origin: null, ...o });
const SESSION: SessionSetup = {
  sessionId: SID,
  title: 'From the Transcript',
  directory: REPO,
  directoryShown: '~/Projects/ledger-web',
  loadedAt: LOADED,
  instructions: [USER_MD, CLAUDE_MD, AGENTS_MD, LOCAL_MD, API_MD],
  memory: {
    path: '/home/me/.claude/projects/-ledger/memory/MEMORY.md',
    tokens: 400,
    entries: [
      { key: 'memory:0', title: 'Money is integer cents', file: '/home/me/.claude/projects/-ledger/memory/money.md', type: 'project' },
      { key: 'memory:1', title: 'CSV uses ; in EU locales', file: '/home/me/.claude/projects/-ledger/memory/csv.md', type: 'feedback' },
    ],
  },
  ran: [
    ran({ key: 'ran:skill:p-kit:review', kind: 'skill', name: 'p-kit:review', count: 2, item: REVIEW }),
    ran({ key: 'ran:skill:release', kind: 'skill', name: 'release', count: 1, item: RELEASE }),
    ran({ key: 'ran:agent:Explore', kind: 'agent', name: 'Explore', count: 3, builtIn: true }),
    ran({ key: 'ran:mcp:ledger-db', kind: 'mcp', name: 'ledger-db', count: 9, item: LEDGER_DB }),
    ran({ key: 'ran:mcp:claude_ai_Calendar', kind: 'mcp', name: 'Calendar', count: 1, origin: 'claude.ai' }),
    ran({ key: 'ran:hook:relay', kind: 'hook', name: 'relay-hook.sh', count: 212, failed: 2, events: ['Stop', 'SessionStart'], item: RELAY }),
  ],
  repo: [RELEASE, LEDGER_DB],
  notLoaded: [{ item: MIGRATE, why: { reason: 'added', at: NOW - 20 * 60_000 } }],
  everywhere: { skill: 97, agent: 8, hook: 16, mcp: 3 },
  errors: [],
  readAt: NOW,
};

const sessionRow = (over: Partial<Parameters<typeof row>[0]> = {}) => row({ id: SID, title: 'Add CSV export to reports', cwd: REPO, statusSince: NOW - 1000, ...over });
function openOn(path = `/s/${SID}`, setupSession: (id: string) => Promise<SessionSetup> = async (id) => ({ ...SESSION, sessionId: id }), rows = [sessionRow()]) {
  const app = renderApp(path, { setup: async () => SNAPSHOT, setupSession });
  app.snapshot(rows);
  return app;
}
async function showSession(user: ReturnType<typeof userEvent.setup>) {
  await openSetup(user);
  await user.click(within(panel()).getByRole('radio', { name: 'This Session' }));
  await within(panel()).findByRole('group', { name: 'Instructions' });
}
const sessionOption = (field: string, name: string) => within(panel()).getAllByRole('option').find((o) => o.getAttribute('data-field') === field && o.getAttribute('aria-label')?.startsWith(name))!;
const sectionIds = () => within(panel()).getAllByRole('group').filter((g) => g.hasAttribute('data-section')).map((g) => g.getAttribute('data-section'));

describe('This Session (SETUP-6)', () => {
  it('SETUP-6.1: a switch above the kind filter, Everywhere or This Session, remembered; disabled, saying why, with no Session or a Codex one open', async () => {
    const user = userEvent.setup();
    let app = openOn();
    await openSetup(user);
    const show = within(panel()).getByRole('radiogroup', { name: 'Show' });
    expect(within(show).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Everywhere', 'This Session']);
    await user.click(within(show).getByRole('radio', { name: 'This Session' }));
    await within(panel()).findByRole('group', { name: 'Instructions' });
    expect(JSON.parse(window.localStorage.getItem('lookout.right')!).setupView).toBe('session');
    app.unmount();
    // Remembered across a reload, and it follows a past Session too.
    app = openOn(`/h/claude/${SID2}`);
    await within(panel()).findByRole('group', { name: 'Instructions' });
    expect(app.client.setupSession).toHaveBeenLastCalledWith(SID2);
    app.unmount();
    // No Session open: This Session is disabled, saying why, and the tab shows Everywhere.
    app = openOn('/');
    await screen.findByRole('group', { name: 'Skills' });
    expect(within(panel()).getByRole('radio', { name: 'This Session' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(panel()).getByRole('radio', { name: 'This Session' })).toHaveAccessibleDescription(/Open a Session to see what it loaded/);
    expect(within(panel()).getByRole('radio', { name: 'Everywhere' })).toHaveAttribute('aria-checked', 'true');
    app.unmount();
    app = openOn('/s/c', undefined, [row({ id: 'c', harness: 'codex', title: 'A Codex Session', statusSince: NOW - 1000 })]);
    await screen.findByRole('group', { name: 'Skills' });
    expect(within(panel()).getByRole('radio', { name: 'This Session' })).toHaveAccessibleDescription(/Claude Code Sessions only, for now/);
    expect(app.client.setupSession).not.toHaveBeenCalled();
  });

  it('SETUP-6.2: the Session’s line in place of the kind filter: its title, its directory and when it loaded; the filter says This Session', async () => {
    const user = userEvent.setup();
    openOn();
    await showSession(user);
    expect(within(panel()).queryByRole('radiogroup', { name: 'Kind' })).toBeNull();
    const line = panel().querySelector('[data-field="session-line"]')!;
    expect(line.textContent).toContain('Add CSV export to reports');
    expect(line.querySelector('[data-field="loaded"]')!.textContent).toBe(`~/Projects/ledger-web · as it loaded at ${at(LOADED)}`);
    const filter = within(panel()).getByRole('searchbox', { name: 'Filter this Session’s Setup' });
    await user.type(filter, 'cents');
    expect(sectionIds()).toEqual(['memory']);
  });

  it('SETUP-6.3: Instructions, Memory, Ran in this Session and This repo’s own, then a line that counts the rest and switches to Everywhere', async () => {
    const user = userEvent.setup();
    openOn();
    await showSession(user);
    expect(sectionIds()).toEqual(['instructions', 'memory', 'ran', 'repo']);
    expect(within(panel()).getAllByRole('group').filter((g) => g.hasAttribute('data-section')).map((g) => g.querySelector('p')!.textContent)).toEqual([
      'Instructions5 files · ~2.1k tokens',
      'Memory2 entries · ~0.4k tokens',
      'Ran in this Session6',
      'This repo’s own2',
    ]);
    const closing = panel().querySelector('[data-field="everywhere-line"]')!;
    expect(closing.textContent).toBe('It also loaded 97 skills, 8 agents, 16 hooks and 3 MCP servers from Everywhere');
    await user.click(closing);
    await screen.findByRole('group', { name: 'Skills' });
    expect(within(panel()).getByRole('radio', { name: 'Everywhere' })).toHaveAttribute('aria-checked', 'true');
  });

  it('SETUP-6.4: read when chosen, when another Session opens, on the tab’s Refresh, and when its turn ends', async () => {
    const user = userEvent.setup();
    const app = openOn();
    await showSession(user);
    expect(app.client.setupSession).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(app.client.setupSession).toHaveBeenCalledTimes(2));
    app.snapshot([sessionRow({ status: 'busy' })]);
    await act(async () => {});
    expect(app.client.setupSession).toHaveBeenCalledTimes(2);
    app.snapshot([sessionRow({ status: 'idle' })]);
    await waitFor(() => expect(app.client.setupSession).toHaveBeenCalledTimes(3));
    act(() => {
      window.history.pushState({}, '', `/s/${SID2}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    app.snapshot([sessionRow(), sessionRow({ id: SID2, title: 'Fix rounding in invoice totals' })]);
    await waitFor(() => expect(app.client.setupSession).toHaveBeenLastCalledWith(SID2));
  });

  it('SETUP-6.5: a Transcript that can’t be read is one error row naming it', async () => {
    const user = userEvent.setup();
    const missing = `/home/me/.claude/projects/…/${SID}.jsonl`;
    openOn(`/s/${SID}`, async () => ({ ...SESSION, instructions: [], memory: null, ran: [], repo: [], notLoaded: [], errors: [{ where: 'transcript', kind: null, file: missing, error: 'no such Transcript' }] }));
    await openSetup(user);
    await user.click(within(panel()).getByRole('radio', { name: 'This Session' }));
    expect((await within(panel()).findByText(`Couldn’t read ${missing}: no such Transcript`))).toBeInTheDocument();
    expect(panel().querySelector('[data-field="everywhere-line"]')).toBeNull();
  });
});

describe('Instructions and memory (SETUP-7)', () => {
  it('SETUP-7.1: the files grouped Yours and This repo, each with its lines and tokens; one loaded later says when', async () => {
    const user = userEvent.setup();
    openOn();
    await showSession(user);
    const instructions = section('Instructions');
    expect(within(instructions).getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual([
      'Yours, 1',
      '~/.claude/CLAUDE.md, 64 lines · ~1.1k tokens',
      'This repo, 4',
      'CLAUDE.md, imports 1 · 3 lines · ~10 tokens',
      'AGENTS.md, 48 lines · ~0.9k tokens, changed',
      'CLAUDE.local.md, 6 lines · ~40 tokens, gone',
      `api/CLAUDE.md, 2 lines · ~9 tokens · loaded at ${at(NOW - 30 * 60_000)}`,
    ]);
    expect(groupLine('This repo, 4').querySelector('svg.lucide-folder-git-2')).not.toBeNull();
    expect(sessionOption('file', '~/.claude/CLAUDE.md').querySelector('svg.lucide-file-text')).not.toBeNull();
  });

  it('SETUP-7.2: an imported file sits under its importer, indented, with CornerDownRight; the importer says how many it imports', async () => {
    const user = userEvent.setup();
    openOn();
    await showSession(user);
    const agents = sessionOption('file', 'AGENTS.md');
    expect(agents.querySelector('svg.lucide-corner-down-right')).not.toBeNull();
    expect(agents.className).toContain('pl-11');
    expect(sessionOption('file', 'CLAUDE.md,').querySelector('[data-field="description"]')!.textContent).toBe('imports 1 · 3 lines · ~10 tokens');
  });

  it('SETUP-7.3: a file changed on disk has a changed chip in the warning tone; one gone, gone', async () => {
    const user = userEvent.setup();
    openOn();
    await showSession(user);
    expect(within(sessionOption('file', 'AGENTS.md')).getByText('changed')).toHaveAttribute('data-tone', 'warning');
    expect(within(sessionOption('file', 'CLAUDE.local.md')).getByText('gone')).toHaveAttribute('data-tone', 'muted');
    expect(within(sessionOption('file', '~/.claude/CLAUDE.md')).queryByText(/changed|gone/)).toBeNull();
  });

  it('SETUP-7.4: a file expands: its source, importer, lines and tokens, the full path in the tooltip; a changed one says what it works from; Open in VS Code', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    openOn();
    await showSession(user);
    fireEvent.click(sessionOption('file', 'AGENTS.md'));
    const agents = sessionOption('file', 'AGENTS.md');
    const state = agents.querySelector('[data-field="state"]')!;
    expect(state.textContent).toBe('48 lines · ~0.9k tokens · imported by CLAUDE.md · This repo');
    expect(state).toHaveAttribute('title', `${REPO}/AGENTS.md`);
    expect(agents.querySelector('[data-field="changed"]')!.textContent).toBe(`Edited on disk at ${at(NOW - 10 * 60_000)}, after the Session loaded it at ${at(LOADED)}. It works from the ${at(LOADED)} text until it compacts.`);
    await user.click(within(agents).getByRole('button', { name: /Open in VS Code/ }));
    expect(opened).toHaveBeenLastCalledWith(`vscode://file${REPO}/AGENTS.md`, '_self');
    opened.mockClear();
    await user.keyboard('{Enter}');
    expect(opened).toHaveBeenLastCalledWith(`vscode://file${REPO}/AGENTS.md`, '_self');
  });

  it('SETUP-7.5: Memory is the index as a group, an entry per row with its type; an entry opens its file', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    openOn();
    await showSession(user);
    const memory = section('Memory');
    expect(within(memory).getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual(['MEMORY.md, 2', 'Money is integer cents, project', 'CSV uses ; in EU locales, feedback']);
    expect(groupLine('MEMORY.md, 2').querySelector('svg.lucide-bookmark')).not.toBeNull();
    fireEvent.click(sessionOption('memory', 'Money is integer cents'));
    await user.keyboard('{Enter}');
    expect(opened).toHaveBeenLastCalledWith('vscode://file/home/me/.claude/projects/-ledger/memory/money.md', '_self');
  });
});

describe('Ran in this Session (SETUP-8)', () => {
  it('SETUP-8.1: grouped by kind, Skills, Agents, MCP servers, Hooks, each under a quiet label with its count; a row’s source, a hook’s events and failed runs, its count', async () => {
    const user = userEvent.setup();
    openOn();
    await showSession(user);
    const ranSection = section('Ran in this Session');
    expect([...ranSection.querySelectorAll('[data-field="ran-kind"]')].map((k) => k.textContent)).toEqual(['Skills2', 'Agents1', 'MCP servers2', 'Hooks1']);
    expect(within(ranSection).getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual([
      'p-kit:review, p-kit, 2×',
      'release, This repo, 1×',
      'Explore, Built into Claude Code, 3×',
      'ledger-db, This repo, 9 calls',
      'Calendar, claude.ai, 1 call',
      'relay-hook.sh, Yours · 2 events · 2 failed, 212×',
    ]);
  });

  it('SETUP-8.2: a row that is an item expands as its row does, its count first; the repo’s item is in both sections; a built-in Subagent has no action', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    openOn();
    await showSession(user);
    fireEvent.click(sessionOption('ran', 'relay-hook.sh'));
    const relay = sessionOption('ran', 'relay-hook.sh');
    expect(relay.querySelector('[data-field="state"]')!.textContent).toBe('212× · 2 events · 5 s');
    expect(relay.querySelector('[data-field="command"]')!.textContent).toBe(RELAY.command);
    await user.click(within(relay).getByRole('button', { name: /Open in VS Code/ }));
    expect(opened).toHaveBeenLastCalledWith('vscode://file/home/me/.claude/settings.json:12', '_self');
    // No switches here: those are Everywhere's (SETUP-4).
    expect(within(relay).queryByRole('button', { name: /More/ })).toBeNull();
    expect(within(section('This repo’s own')).getAllByRole('option').some((o) => o.getAttribute('aria-label')?.startsWith('release,'))).toBe(true);
    fireEvent.click(sessionOption('ran', 'Explore'));
    const explore = sessionOption('ran', 'Explore');
    expect(explore.querySelector('[data-field="state"]')!.textContent).toBe('3× · Built into Claude Code');
    expect(within(explore).queryByRole('button')).toBeNull();
  });
});

describe('This repo’s own (SETUP-9)', () => {
  it('SETUP-9.1: what its directory adds, each with its kind and where it’s defined; not inset', async () => {
    const user = userEvent.setup();
    openOn();
    await showSession(user);
    const repo = section('This repo’s own');
    const rows = within(repo).getAllByRole('option').filter((o) => o.getAttribute('data-field') === 'item');
    expect(rows.map((o) => o.querySelector('[data-field="description"]')!.textContent)).toEqual(['Skill · .claude/skills', 'MCP · .mcp.json · stdio']);
    expect(rows[0]!.className).toContain('pl-2');
  });

  it('SETUP-9.2: what its lists don’t name ends the section as a folded “1 not loaded” line, its rows quieter, saying why', async () => {
    const user = userEvent.setup();
    openOn();
    await showSession(user);
    const line = groupLine('1 not loaded');
    expect(line.querySelector('svg.lucide-circle-off')).not.toBeNull();
    expect(line).toHaveAttribute('aria-expanded', 'false');
    await user.click(line);
    const rows = panel().querySelector('[data-field="not-loaded-rows"]')!;
    expect(rows.className).toContain('opacity-60');
    expect(rows.querySelector('[data-field="description"]')!.textContent).toBe(`Skill · added at ${at(NOW - 20 * 60_000)}, after it started`);
  });

  it('SETUP-9.3: its rows expand with Open in VS Code and no switches', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    openOn();
    await showSession(user);
    const release = () => within(section('This repo’s own')).getAllByRole('option').find((o) => o.getAttribute('aria-label')?.startsWith('release,'))!;
    fireEvent.click(release());
    expect(release().querySelector('[data-field="state"]')!.textContent).toBe('This repo · Claude Code');
    expect(within(release()).queryByRole('button', { name: /More/ })).toBeNull();
    await user.keyboard('x');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(within(release()).getByRole('button', { name: /Open in VS Code/ }));
    expect(opened).toHaveBeenLastCalledWith(`vscode://file${REPO}/.claude/skills/release/SKILL.md`, '_self');
  });
});
