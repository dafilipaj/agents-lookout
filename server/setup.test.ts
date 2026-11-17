import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupItem, SetupSnapshot } from '../shared/setup.ts';
import type { Runner } from './exec.ts';
import { Setup, SetupFailure, frontmatter, hookName, keyLine, redactArgs, redactUrl } from './setup.ts';

// Invented look-alikes of a Harness setup; no real configuration is copied here.
let home: string;
const put = async (path: string, text: string) => {
  const file = join(home, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
};
const skill = (name: string, description: string, hint?: string) => `---\nname: ${name}\ndescription: ${description}\n${hint ? `argument-hint: ${hint}\n` : ''}---\n\n# ${name}\n`;

const SECRET = 'sk-not-a-real-value-0000';
const SETTINGS = {
  model: 'opus',
  skillOverrides: { notes: 'off', 'gone-skill': 'off', 'p-kit:draft': 'name-only' },
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node ~/.claude/hooks/guard.mjs', timeout: 10 }] }],
    Stop: [{ hooks: [{ type: 'command', command: '/bin/sh "$HOME/.relay/agent-hooks/relay-hook.sh"', timeout: 5 }] }],
    SessionStart: [{ hooks: [{ type: 'command', command: '/bin/sh "$HOME/.relay/agent-hooks/relay-hook.sh"', timeout: 5 }] }],
  },
  enabledPlugins: { 'p-kit@market': true },
};

function pluginList(): string {
  return JSON.stringify([
    { id: 'p-kit@market', version: '1.2.0', scope: 'user', enabled: true, installPath: join(home, 'cache/market/p-kit/1.2.0'), mcpServers: { tracker: { command: 'npx', args: ['tracker-mcp'], env: { TRACKER_TOKEN: SECRET } } } },
    { id: 'p-old@market', version: '0.3.0', scope: 'user', enabled: false, installPath: join(home, 'cache/market/p-old/0.3.0') },
    { id: 'p-repo@market', version: '2.0.0', scope: 'project', projectPath: '/somewhere', enabled: true, installPath: join(home, 'cache/market/p-repo/2.0.0') },
  ]);
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'lookout-setup-'));
  await put('.claude/settings.json', JSON.stringify(SETTINGS, null, 2) + '\n');
  await put('.claude/skills/notes/SKILL.md', skill('notes', '>-\n  Keep notes for later,\n  in one place.', 'add | list'));
  await put('.claude/skills/deploy/SKILL.md', skill('deploy', 'Deploy: the app, with checks.'));
  await put('.claude/skills/empty-dir/README.md', 'no skill here');
  await put('.claude/skills/synced/space-1/docs/SKILL.md', skill('docs', 'Shared docs from claude.ai.'));
  await put('.claude/skills/synced/space-1/manifest.json', '{}');
  await put('.claude/agents/scout.md', '---\nname: scout\ndescription: Looks around.\nmodel: sonnet\neffort: low\ntools: Read, Grep\n---\nBody');
  await put('.claude.json', JSON.stringify({ numStartups: 3, mcpServers: { search: { type: 'http', url: 'https://search.example/mcp', headers: { Authorization: `Bearer ${SECRET}` } } } }, null, 2));
  await put('cache/market/p-kit/1.2.0/skills/review/SKILL.md', skill('review', 'Review a change.', '<pr>'));
  await put('cache/market/p-kit/1.2.0/skills/draft/SKILL.md', skill('draft', 'Draft a plan.', '[issue-number]'));
  await put('cache/market/p-kit/1.2.0/agents/checker.md', '---\nname: checker\ndescription: Checks a slice.\ntools: [Read, Bash]\n---\n');
  await put('cache/market/p-kit/1.2.0/hooks/hooks.json', JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/pr-gate/hook.mjs"' }] }] } }, null, 2));
  await put('cache/market/p-kit/1.2.0/.mcp.json', JSON.stringify({ tracker: { command: 'npx', args: ['tracker-mcp'] } }, null, 2));
  await put('cache/market/p-old/0.3.0/skills/legacy/SKILL.md', skill('legacy', 'An old skill.'));
  await put('cache/market/p-repo/2.0.0/skills/local/SKILL.md', skill('local', 'A repo’s skill.'));
  await put('.codex/skills/fix/SKILL.md', skill('fix', 'Fix a failing test.'));
  await put('.agents/skills/plan/SKILL.md', skill('plan', 'Plan a change.'));
  const codexHooks = join(home, '.codex/hooks.json');
  await put(
    '.codex/hooks.json',
    JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node ~/.codex/guard.mjs' }] }], Stop: [{ hooks: [{ type: 'command', command: 'node ~/.codex/notify.mjs' }] }] } }, null, 2),
  );
  await put(
    '.codex/config.toml',
    [
      'model = "gpt-6"',
      '',
      '[mcp_servers.tickets]',
      'url = "https://tickets.example/mcp"',
      'bearer_token_env_var = "TICKETS_TOKEN"',
      '',
      '[mcp_servers.files]',
      'command = "npx"',
      'args = ["-y", "files-mcp"]',
      'enabled = false',
      '',
      '[mcp_servers.files.env]',
      `FILES_KEY = "${SECRET}"`,
      '',
      '[hooks.state]',
      '',
      `[hooks.state."${codexHooks}:pre_tool_use:0:0"]`,
      'enabled = true',
      'trusted_hash = "sha256:0000"',
      '',
    ].join('\n'),
  );
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function setup(runner: Runner = vi.fn(async () => pluginList())) {
  return new Setup({ home, runner, claudeBin: async () => '/usr/local/bin/claude', now: () => 1000 });
}
const find = (s: SetupSnapshot, kind: SetupItem['kind'], name: string, harness = 'claude') => s.items.find((i) => i.kind === kind && i.name === name && i.harness === harness);

describe('reading', () => {
  it('SETUP-2.1: Claude Code’s skills, synced skills, plugins (user scope), agents, hooks, MCP servers and skillOverrides', async () => {
    const s = await setup().read();
    expect(s.errors).toEqual([]);
    expect(find(s, 'skill', 'notes')).toMatchObject({ source: { type: 'yours' }, description: 'Keep notes for later, in one place.', call: '/notes add | list', file: join(home, '.claude/skills/notes/SKILL.md'), off: 'override', overrideKey: 'notes' });
    expect(find(s, 'skill', 'deploy')).toMatchObject({ description: 'Deploy: the app, with checks.', off: null });
    expect(find(s, 'skill', 'anthropic-skills:docs')).toMatchObject({ source: { type: 'claude-ai' } });
    expect(find(s, 'skill', 'p-kit:review')).toMatchObject({ source: { type: 'plugin', name: 'p-kit', id: 'p-kit@market', version: '1.2.0' }, call: '/p-kit:review <pr>' });
    expect(find(s, 'agent', 'scout')).toMatchObject({ model: 'sonnet', effort: 'low', tools: ['Read', 'Grep'], source: { type: 'yours' } });
    expect(find(s, 'agent', 'p-kit:checker')).toMatchObject({ tools: ['Read', 'Bash'], model: null });
    expect(find(s, 'hook', 'guard.mjs')).toMatchObject({ events: [{ event: 'PreToolUse', matcher: 'Bash' }], timeout: 10, file: join(home, '.claude/settings.json') });
    expect(find(s, 'hook', 'pr-gate/hook.mjs')).toMatchObject({ source: { type: 'plugin', name: 'p-kit' }, file: join(home, 'cache/market/p-kit/1.2.0/hooks/hooks.json') });
    expect(find(s, 'mcp', 'search')).toMatchObject({ transport: 'http', url: 'https://search.example/mcp', headers: ['Authorization'], source: { type: 'yours' } });
    expect(find(s, 'mcp', 'tracker')).toMatchObject({ transport: 'stdio', command: 'npx', args: ['tracker-mcp'], env: ['TRACKER_TOKEN'], file: join(home, 'cache/market/p-kit/1.2.0/.mcp.json'), line: 2 });
    // A project's plugin is slice 2's (Non-goals); a folder without SKILL.md isn't a skill.
    expect(s.items.some((i) => i.name.startsWith('p-repo:'))).toBe(false);
    expect(s.items.some((i) => i.name === 'empty-dir')).toBe(false);
    expect(s.readAt).toBe(1000);
  });

  it('SETUP-2.2: Codex’s skills as $name, its hooks with their trust, and its MCP servers', async () => {
    const s = await setup().read();
    expect(find(s, 'skill', 'fix', 'codex')).toMatchObject({ call: '$fix', source: { type: 'yours' } });
    expect(find(s, 'skill', 'plan', 'codex')).toMatchObject({ file: join(home, '.agents/skills/plan/SKILL.md') });
    expect(find(s, 'hook', 'guard.mjs', 'codex')).toMatchObject({ off: null, line: 9 });
    expect(find(s, 'mcp', 'tickets', 'codex')).toMatchObject({ transport: 'http', env: ['TICKETS_TOKEN'], file: join(home, '.codex/config.toml'), line: 3, off: null });
    expect(find(s, 'mcp', 'files', 'codex')).toMatchObject({ transport: 'stdio', env: ['FILES_KEY'], line: 7 });
  });

  it('SETUP-2.3: a file that can’t be parsed is one error row, and the rest still shows', async () => {
    await put('.codex/hooks.json', '{ not json');
    await put('cache/market/p-kit/1.2.0/skills/review/SKILL.md', '---\nname: review\ndescription: Review: a change, with: colons\n---\n');
    const s = await setup().read();
    expect(s.errors).toEqual([{ kind: 'hook', file: join(home, '.codex/hooks.json'), error: expect.any(String) }]);
    // Frontmatter that isn't valid YAML is still read, as Claude Code reads it.
    expect(find(s, 'skill', 'p-kit:review')?.description).toBe('Review: a change, with: colons');
    expect(find(s, 'skill', 'notes')).toBeDefined();
  });

  it('SETUP-2.3: a failing `claude plugin list` is an error row; Codex and your own items still show', async () => {
    const s = await setup(vi.fn(async () => Promise.reject(new Error('claude: not logged in')))).read();
    expect(s.errors).toEqual([{ kind: 'skill', file: 'claude plugin list --json', error: 'claude: not logged in' }]);
    expect(find(s, 'skill', 'notes')).toBeDefined();
    expect(find(s, 'skill', 'fix', 'codex')).toBeDefined();
  });

  it('SETUP-2.4: environment and header values never appear in the answer, only their names', async () => {
    const s = await setup().read();
    expect(JSON.stringify(s)).not.toContain(SECRET);
    expect(JSON.stringify(s)).not.toContain('Bearer');
  });

  it('SETUP-2.4: what looks like a credential in an MCP server’s arguments or URL is hidden', async () => {
    const args = ['-y', 'gh-mcp', '--token', SECRET, `--api-key=${SECRET}`, '-H', `Authorization: Bearer ${SECRET}`, `GITHUB_TOKEN=${SECRET}`, `--env=API_TOKEN=${SECRET}`, `https://me:${SECRET}@hooks.example/x?key=${SECRET}&v=2`, '--port', '8080'];
    await put('.claude.json', JSON.stringify({ mcpServers: { gh: { command: 'npx', args }, api: { type: 'http', url: `https://api.example/mcp?token=${SECRET}` }, vault: { type: 'http', url: `https://:${SECRET}@vault.example/mcp` } } }, null, 2));
    const s = await setup().read();
    expect(JSON.stringify(s)).not.toContain(SECRET);
    expect(find(s, 'mcp', 'gh')?.args).toEqual(['-y', 'gh-mcp', '--token', '…', '--api-key=…', '-H', '…', 'GITHUB_TOKEN=…', '--env=API_TOKEN=…', 'https://…@hooks.example/x?key=…&v=…', '--port', '8080']);
    expect(find(s, 'mcp', 'api')).toMatchObject({ url: 'https://api.example/mcp?token=…', description: 'https://api.example/mcp?token=…' });
    expect(find(s, 'mcp', 'vault')?.url).toBe('https://…@vault.example/mcp');
    expect(redactUrl(`https://alice:hello@${SECRET}@api.example/mcp`)).toBe('https://…@api.example/mcp');
    expect(redactArgs(['Authorization: Basic abc', 'say', 'Bearer abc'])).toEqual(['Authorization: …', 'say', 'Bearer …']);
    expect(redactUrl('https://search.example/mcp')).toBe('https://search.example/mcp');
  });

  it('SETUP-2.4: a CLI’s diagnostic is scrubbed, listing and switching alike', async () => {
    const diagnostic = `Invalid MCP configuration: API_TOKEN=${SECRET}`;
    const listing = await setup(vi.fn(async () => Promise.reject(new Error(diagnostic)))).read();
    expect(listing.errors).toEqual([{ kind: 'skill', file: 'claude plugin list --json', error: 'Invalid MCP configuration: API_TOKEN=…' }]);
    const flags = await setup(vi.fn(async () => Promise.reject(new Error(`Invalid MCP configuration: --api-key ${SECRET} --port 80`)))).read();
    expect(flags.errors[0]?.error).toBe('Invalid MCP configuration: --api-key … --port 80');
    const runner = vi.fn<Runner>(async (_file, args) => (args[1] === 'list' ? pluginList() : Promise.reject(Object.assign(new Error('exit 1'), { stderr: `{"api_key": "${SECRET}"} is invalid\n` }))));
    const err = await setup(runner).setPlugin('p-kit@market', false).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, message: 'claude plugin disable p-kit@market failed: {"api_key": …} is invalid' });
  });

  it('SETUP-2.4: an error row says where a file doesn’t parse, never what’s in it', async () => {
    await put('.claude.json', `{ "mcpServers": { "gh": { "env": { "GITHUB_TOKEN": ${SECRET} } } } }`);
    await put('.codex/config.toml', `[mcp_servers.files.env]\nFILES_KEY = ${SECRET}\n`);
    const s = await setup().read();
    expect(JSON.stringify(s)).not.toContain(SECRET);
    expect(s.errors).toEqual([
      { kind: 'mcp', file: join(home, '.claude.json'), error: 'not valid JSON' },
      { kind: 'mcp', file: join(home, '.codex/config.toml'), error: expect.stringMatching(/^not valid TOML \(line 2, column \d+\)$/) },
    ]);
  });

  it('SETUP-1.6: a hook is one item per command: the same command on two events is one, named by its script', async () => {
    const s = await setup().read();
    const relay = s.items.filter((i) => i.kind === 'hook' && i.name === 'relay-hook.sh');
    expect(relay).toHaveLength(1);
    expect(relay[0]).toMatchObject({ description: '2 events', events: [{ event: 'Stop', matcher: null }, { event: 'SessionStart', matcher: null }], timeout: 5 });
    expect(find(s, 'hook', 'guard.mjs')?.description).toBe('PreToolUse · Bash');
  });

  it('SETUP-1.6: a hook’s name is its script, with the folder for hook and index, else the first path, else the first word', () => {
    expect(hookName('node ~/.claude/hooks/res-guard.mjs')).toBe('res-guard.mjs');
    expect(hookName('node /Users/me/.claude/hooks/pr-gate/hook.mjs')).toBe('pr-gate/hook.mjs');
    expect(hookName('node "${CLAUDE_PLUGIN_ROOT}/dist/index.js" --fast')).toBe('dist/index.js');
    expect(hookName('if [ -f "${HOME-}/.relay/agent-hooks/relay-hook.cmd" ]; then x; else /bin/sh "${HOME-}/.relay/agent-hooks/relay-hook.sh"; fi')).toBe('relay-hook.sh');
    expect(hookName('node "$CLAUDE_PLUGIN_ROOT/scripts/workspaces" session-context')).toBe('workspaces');
    expect(hookName('say done')).toBe('say');
  });

  it('SETUP-5.1: what’s off, and why: skillOverrides, an entry naming no skill, an off plugin, an untrusted Codex hook, enabled = false', async () => {
    const s = await setup().read();
    expect(find(s, 'skill', 'notes')?.off).toBe('override');
    expect(find(s, 'skill', 'gone-skill')).toMatchObject({ off: 'override-missing', overrideKey: 'gone-skill', file: join(home, '.claude/settings.json'), line: 5 });
    expect(find(s, 'skill', 'p-old:legacy')).toMatchObject({ off: 'plugin', source: { type: 'plugin', id: 'p-old@market' } });
    expect(find(s, 'hook', 'notify.mjs', 'codex')?.off).toBe('untrusted');
    expect(find(s, 'mcp', 'files', 'codex')?.off).toBe('config');
  });

  it('SETUP-5.1: an entry for an off plugin’s skill is found on disk; with no config.toml, no Codex hook is trusted', async () => {
    await put('.claude/settings.json', JSON.stringify({ skillOverrides: { 'p-old:legacy': 'off' } }, null, 2));
    await rm(join(home, '.codex/config.toml'));
    const s = await setup().read();
    expect(s.items.filter((i) => i.name === 'p-old:legacy')).toEqual([expect.objectContaining({ off: 'plugin' })]);
    expect(s.items.some((i) => i.off === 'override-missing')).toBe(false);
    expect(find(s, 'hook', 'guard.mjs', 'codex')?.off).toBe('untrusted');
    expect(find(s, 'hook', 'notify.mjs', 'codex')?.off).toBe('untrusted');
  });

  it('SETUP-3.2: a top-level MCP server opens at its own line, not a project’s of the same name', async () => {
    await put('.claude.json', JSON.stringify({ projects: { '/repo': { mcpServers: { search: { command: 'a' } } } }, mcpServers: { search: { command: 'b' } } }, null, 2));
    const s = await setup().read();
    expect(find(s, 'mcp', 'search')).toMatchObject({ command: 'b', line: 12 });
    expect(keyLine('{"a": {"b": 1}, "b": {"c": "}"}, "x": [{"b": 2}]}', ['b', 'c'])).toBe(1);
    expect(keyLine('{"a": {"b": 1}}', ['b'])).toBeNull();
  });

  it('SETUP-4.1: a skillOverrides value other than off leaves the skill on, with its listing', async () => {
    const s = await setup().read();
    expect(find(s, 'skill', 'p-kit:draft')).toMatchObject({ off: null, listing: 'name-only' });
  });

  it('SETUP-3.1: an unquoted bracketed argument hint stays in the skill’s call', async () => {
    const s = await setup().read();
    expect(find(s, 'skill', 'p-kit:draft')?.call).toBe('/p-kit:draft [issue-number]');
  });

  it('frontmatter: YAML, a line-by-line fallback, and none', () => {
    expect(frontmatter('---\nname: a\ndescription: "b: c"\n---\n')).toEqual({ name: 'a', description: 'b: c' });
    expect(frontmatter('---\nname: a\ndescription: b: c\n---\n')).toEqual({ name: 'a', description: 'b: c' });
    expect(frontmatter('# no frontmatter')).toEqual({});
  });
});

describe('switching', () => {
  it('SETUP-4.1: Turn off adds "<name>": "off" to skillOverrides and changes nothing else; Turn on removes it', async () => {
    const file = join(home, '.claude/settings.json');
    const before = await readFile(file, 'utf8');
    const off = await setup().setSkill('deploy', false);
    const after = await readFile(file, 'utf8');
    expect(JSON.parse(after)).toEqual({ ...SETTINGS, skillOverrides: { ...SETTINGS.skillOverrides, deploy: 'off' } });
    // One line added, and the comma JSON needs before it; every other line as it was.
    expect(after.split('\n').filter((l) => !before.split('\n').includes(l))).toEqual(['    "p-kit:draft": "name-only",', '    "deploy": "off"']);
    expect(find(off, 'skill', 'deploy')?.off).toBe('override');
    const on = await setup().setSkill('deploy', true);
    expect(await readFile(file, 'utf8')).toBe(before);
    expect(find(on, 'skill', 'deploy')?.off).toBeNull();
  });

  it('SETUP-1.8: a read while a switch is under way waits for it', async () => {
    let finish!: () => void;
    const order: string[] = [];
    const runner = vi.fn<Runner>(async (_file, args) => {
      if (args[1] === 'list') {
        order.push('list');
        return pluginList();
      }
      await new Promise<void>((resolve) => (finish = resolve));
      order.push(args[1]!);
      return '';
    });
    // Finding the claude binary is part of the switch too: a read during it waits.
    let found!: () => void;
    const lookup = new Promise<void>((resolve) => (found = resolve));
    const claudeBin = vi.fn(async () => (await lookup, '/usr/local/bin/claude'));
    const s = new Setup({ home, runner, claudeBin, now: () => 1000 });
    const switching = s.setPlugin('p-kit@market', false);
    await vi.waitFor(() => expect(claudeBin).toHaveBeenCalled());
    const reading = s.read();
    found();
    await vi.waitFor(() => expect(finish).toBeDefined());
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([]);
    finish();
    await Promise.all([switching, reading]);
    expect(order).toEqual(['disable', 'list', 'list']);
  });

  it('SETUP-4.1: two switches at once both land, one after the other', async () => {
    const s = setup();
    await Promise.all([s.setSkill('deploy', false), s.setSkill('notes', true), s.setSkill('p-kit:review', false)]);
    const json = JSON.parse(await readFile(join(home, '.claude/settings.json'), 'utf8'));
    expect(json.skillOverrides).toEqual({ 'gone-skill': 'off', 'p-kit:draft': 'name-only', deploy: 'off', 'p-kit:review': 'off' });
  });

  it('SETUP-4.1: a settings file that’s a link stays a link; its target is written', async () => {
    const file = join(home, '.claude/settings.json');
    const target = join(home, 'dotfiles/claude-settings.json');
    await mkdir(dirname(target), { recursive: true });
    await rename(file, target);
    await symlink(target, file);
    await setup().setSkill('deploy', false);
    expect((await lstat(file)).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await readFile(target, 'utf8')).skillOverrides.deploy).toBe('off');
    await rm(target);
    await expect(setup().setSkill('deploy', true)).rejects.toMatchObject({ status: 409 });
  });

  it('SETUP-4.1: a settings file that isn’t JSON is left alone', async () => {
    await put('.claude/settings.json', '{ broken');
    await expect(setup().setSkill('deploy', false)).rejects.toMatchObject({ status: 409 });
    expect(await readFile(join(home, '.claude/settings.json'), 'utf8')).toBe('{ broken');
  });

  it('SETUP-4.2: a plugin switch runs claude plugin enable or disable, user scope, and answers the read after it', async () => {
    const runner = vi.fn<Runner>(async (_file, args) => (args[1] === 'list' ? pluginList() : ''));
    const s = await setup(runner).setPlugin('p-kit@market', false);
    expect(runner).toHaveBeenCalledWith('/usr/local/bin/claude', ['plugin', 'disable', '--scope', 'user', 'p-kit@market'], expect.objectContaining({ timeoutMs: expect.any(Number) }));
    expect(s.items.length).toBeGreaterThan(0);
    await setup(runner).setPlugin('p-old@market', true);
    expect(runner).toHaveBeenCalledWith('/usr/local/bin/claude', ['plugin', 'enable', '--scope', 'user', 'p-old@market'], expect.anything());
  });

  it('SETUP-4.2: a failed plugin switch says why', async () => {
    const runner = vi.fn<Runner>(async (_file, args) => (args[1] === 'list' ? pluginList() : Promise.reject(Object.assign(new Error('exit 1'), { stderr: 'Plugin not found\n' }))));
    const err = await setup(runner).setPlugin('p-kit@market', false).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupFailure);
    expect(err).toMatchObject({ status: 502, message: 'claude plugin disable p-kit@market failed: Plugin not found' });
  });
});
