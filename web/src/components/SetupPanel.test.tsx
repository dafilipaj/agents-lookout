import type { SetupItem, SetupSnapshot } from '@shared/setup.ts';
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
