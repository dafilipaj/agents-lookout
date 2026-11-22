import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSetup } from '../shared/setup.ts';
import { Setup } from './setup.ts';
import { importsOf, shownPath } from './setup-session.ts';
import { TranscriptReader, mcpToolName } from './setup-transcript.ts';

// An invented Session in an invented repo, ledger-web; no real Transcript or configuration is copied here.
const ID = '0b7c1a2e-4d5f-4a6b-8c9d-0e1f2a3b4c5d';
const SECRET = 'sk-not-a-real-value-0000';
const GUARD = 'node ~/.claude/hooks/guard.mjs';
const RELAY = '/bin/sh "$HOME/.relay/agent-hooks/relay-hook.sh"';
const REPO_HOOK = 'node .claude/hooks/check-migrations.mjs';
const UNKNOWN_HOOK = 'node /opt/other/lint-gate.mjs';

let home: string;
let repo: string;
const put = async (path: string, text: string) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
};
const skill = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;

// Long before the fixture's files are made, so they read as added after its loads (SETUP-9.2).
const T0 = Date.parse('2025-03-04T10:12:00.000Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

type Line = Record<string, unknown>;
const attachment = (min: number, a: Line, cwd = repo): Line => ({ type: 'attachment', timestamp: at(min), cwd, sessionId: ID, attachment: a });
const toolUse = (min: number, name: string, input: Line): Line => ({ type: 'assistant', timestamp: at(min), cwd: repo, message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: `t${min}`, name, input }] } });
const typed = (min: number, text: string): Line => ({ type: 'user', timestamp: at(min), cwd: repo, message: { role: 'user', content: text } });
const hook = (min: number, command: string, event: string, type = 'hook_success'): Line => attachment(min, { type, hookName: `${event}:Bash`, hookEvent: event, command, exitCode: type === 'hook_success' ? 0 : 1, durationMs: 12, stdout: '', stderr: '' });

function files(min: number, texts: { user: string; claude: string; agents: string; memory: string }): Line {
  return attachment(min, {
    type: 'instructions',
    files: [
      { path: join(home, '.claude/CLAUDE.md'), type: 'User', content: texts.user },
      { path: join(repo, 'CLAUDE.md'), type: 'Project', content: texts.claude },
      { path: join(repo, 'AGENTS.md'), type: 'Project', content: texts.agents },
      { path: join(repo, 'CLAUDE.local.md'), type: 'Local', content: 'Use the staging database.' },
      { path: join(home, '.claude/projects/-ledger/memory/MEMORY.md'), type: 'AutoMem', content: texts.memory },
      { path: join(home, '.claude/managed.md'), type: 'Managed', content: 'Not a type Lookout knows.' },
    ],
  });
}

const USER = '# Global\n\nKeep replies short.\nRun tests before a commit.';
const CLAUDE = '@AGENTS.md';
const AGENTS = '# Ledger web\n\nSpecs first. See `@docs/not-an-import.md` in code.\nImports @docs/STYLE.md too.';
const MEMORY = '- [Prefers pnpm](prefers-pnpm.md) — not npm\n- [Staging data](staging.md) — refreshed nightly\n';

/** The Transcript: a load, a compaction and a second load, then a subfolder's CLAUDE.md, the lists, calls and hook runs. */
function transcript(opts: { loads?: [number, number] } = {}): string {
  const [first, second] = opts.loads ?? [0, 30];
  const lines: (Line | string)[] = [
    { type: 'permission-mode', permissionMode: 'default' },
    files(first, { user: USER, claude: CLAUDE, agents: 'An older AGENTS.md', memory: MEMORY }),
    attachment(first, { type: 'skill_listing', isInitial: true, names: ['notes', 'p-kit:review', 'release', 'old-skill'], skillCount: 4 }),
    attachment(first, { type: 'agent_listing_delta', isInitial: true, addedTypes: ['general-purpose', 'Explore', 'p-kit:checker', 'reviewer'], builtInTypes: ['general-purpose', 'Explore'], builtInPluginTypes: [], removedTypes: [] }),
    attachment(first, { type: 'mcp_instructions_delta', addedNames: ['plugin:p-kit:tracker', 'claude.ai Calendar', 'ledger-db'], removedNames: [] }),
    { type: 'ai-title', aiTitle: 'Add CSV export to reports' },
    typed(1, '<command-name>/release</command-name>\n<command-message>release</command-message>'),
    typed(2, '<command-name>/compact</command-name>'),
    toolUse(3, 'Skill', { skill: 'p-kit:review', args: '42' }),
    toolUse(4, 'Skill', { skill: 'p-kit:review' }),
    toolUse(5, 'Agent', { description: 'Look around', subagent_type: 'Explore', prompt: 'x' }),
    toolUse(6, 'Task', { description: 'Old name', prompt: 'x' }),
    toolUse(7, 'Agent', { description: 'Check', subagent_type: 'p-kit:checker', prompt: 'x' }),
    toolUse(8, 'mcp__plugin_p-kit_tracker__list_issues', {}),
    toolUse(9, 'mcp__claude_ai_Calendar__events', {}),
    toolUse(10, 'mcp__claude_ai_Calendar__events', {}),
    hook(11, GUARD, 'PreToolUse'),
    hook(12, GUARD, 'PreToolUse', 'hook_non_blocking_error'),
    hook(13, RELAY, 'Stop'),
    hook(14, REPO_HOOK, 'PreToolUse'),
    hook(15, UNKNOWN_HOOK, 'PostToolUse', 'hook_cancelled'),
    '{ not json',
    { type: 'attachment', timestamp: at(16), attachment: { type: 'some_future_kind', what: 1 } },
    { type: 'system', subtype: 'compact_boundary', timestamp: at(second - 1) },
    files(second, { user: USER, claude: CLAUDE, agents: AGENTS, memory: MEMORY }),
    attachment(second, { type: 'skill_listing', isInitial: true, names: ['notes', 'p-kit:review', 'release'], skillCount: 3 }),
    attachment(second + 1, { type: 'skill_listing', isInitial: false, names: ['late-skill'], skillCount: 1 }),
    attachment(second + 10, { type: 'nested_memory', path: join(repo, 'api/CLAUDE.md'), displayPath: 'api/CLAUDE.md', content: { path: join(repo, 'api/CLAUDE.md'), type: 'Project', content: 'API rules.\nVersion every route.', contentDiffersFromDisk: false } }),
    attachment(second + 12, { type: 'nested_memory', path: join(repo, 'api/CLAUDE.md'), displayPath: 'api/CLAUDE.md', content: { path: join(repo, 'api/CLAUDE.md'), type: 'Project', content: 'API rules.\nVersion every route.' } }),
    hook(second + 2, GUARD, 'PostToolUse'),
    toolUse(second + 3, 'Skill', { skill: 'release' }),
  ];
  return lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n';
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'lookout-setup-session-'));
  repo = join(home, 'Projects/ledger-web');
  await put(join(home, '.claude/settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: GUARD }] }], PostToolUse: [{ hooks: [{ type: 'command', command: GUARD }] }], Stop: [{ hooks: [{ type: 'command', command: RELAY }] }] } }, null, 2));
  await put(join(home, '.claude/skills/notes/SKILL.md'), skill('notes', 'Keep notes.'));
  await put(join(home, '.claude/CLAUDE.md'), USER + '\n');
  await put(join(home, '.claude/projects/-ledger/memory/MEMORY.md'), MEMORY);
  await put(join(home, '.claude/projects/-ledger/memory/prefers-pnpm.md'), '---\nname: prefers-pnpm\ndescription: x\nmetadata:\n  type: feedback\n---\nUse pnpm.\n');
  await put(join(home, '.claude/projects/-ledger/memory/staging.md'), '---\nname: staging\ntype: project\n---\nNightly.\n');
  await put(join(home, '.claude.json'), JSON.stringify({ projects: { [repo]: { enabledMcpjsonServers: ['ledger-db'] } } }));
  await put(join(home, 'cache/market/p-kit/1.2.0/skills/review/SKILL.md'), skill('review', 'Review a change.'));
  await put(join(home, 'cache/market/p-kit/1.2.0/agents/checker.md'), '---\nname: checker\ndescription: Checks a slice.\n---\n');
  await put(join(home, 'cache/market/p-kit/1.2.0/.mcp.json'), JSON.stringify({ tracker: { command: 'npx', args: ['tracker-mcp'] } }));
  await put(join(home, 'cache/market/p-repo/2.0.0/skills/schema/SKILL.md'), skill('schema', 'Explain the schema.'));
  await put(join(home, 'cache/market/p-else/1.0.0/skills/other/SKILL.md'), skill('other', 'Another repo’s.'));
  // The repo: its instruction files (AGENTS.md as loaded, CLAUDE.md edited since, CLAUDE.local.md gone) and its own items.
  await put(join(repo, 'CLAUDE.md'), '@AGENTS.md\n@docs/STYLE.md\n');
  await put(join(repo, 'AGENTS.md'), AGENTS + '\n');
  await put(join(repo, 'api/CLAUDE.md'), 'API rules.\nVersion every route.\n');
  await put(join(repo, '.claude/skills/release/SKILL.md'), skill('release', 'Cut a release.'));
  await put(join(repo, '.claude/commands/seed.md'), '---\ndescription: Seed the staging database.\nargument-hint: <size>\n---\nSeed it.\n');
  await put(join(repo, '.claude/agents/reviewer.md'), '---\nname: reviewer\ndescription: Reviews migrations.\n---\n');
  await put(join(repo, '.claude/settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: REPO_HOOK }] }] } }, null, 2));
  await put(join(repo, '.claude/settings.local.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }, null, 2));
  await put(join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { 'ledger-db': { command: 'npx', args: ['db-mcp', '--token', SECRET] }, 'metrics': { type: 'http', url: `https://metrics.example/mcp?key=${SECRET}` } } }, null, 2));
  await put(join(home, `.claude/projects/-ledger/${ID}.jsonl`), transcript());
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function pluginList() {
  return JSON.stringify([
    { id: 'p-kit@market', version: '1.2.0', scope: 'user', enabled: true, installPath: join(home, 'cache/market/p-kit/1.2.0'), mcpServers: { tracker: { command: 'npx', args: ['tracker-mcp'] } } },
    { id: 'p-repo@market', version: '2.0.0', scope: 'project', projectPath: repo, enabled: true, installPath: join(home, 'cache/market/p-repo/2.0.0') },
    { id: 'p-else@market', version: '1.0.0', scope: 'project', projectPath: join(home, 'Projects/other'), enabled: true, installPath: join(home, 'cache/market/p-else/1.0.0') },
  ]);
}
const setup = () => new Setup({ home, runner: vi.fn(async () => pluginList()), claudeBin: async () => '/usr/local/bin/claude', now: () => 1000 });
const read = (): Promise<SessionSetup> => setup().readSession(ID);

describe('SETUP-6 This Session', () => {
  it('SETUP-6.5: the Transcript is found by its id under ~/.claude/projects; lines it doesn’t know are skipped', async () => {
    const s = await read();
    expect(s.errors).toEqual([]);
    expect(s.sessionId).toBe(ID);
    expect(s.readAt).toBe(1000);
  });

  it('SETUP-6.5: a Transcript that isn’t there is one error row naming it', async () => {
    const s = await setup().readSession('11111111-2222-4333-8444-555555555555');
    expect(s.errors).toEqual([{ where: 'transcript', kind: null, file: join(home, '.claude/projects/…/11111111-2222-4333-8444-555555555555.jsonl'), error: 'no such Transcript' }]);
    expect(s).toMatchObject({ instructions: [], ran: [], repo: [], memory: null, loadedAt: null });
  });

  it('SETUP-6.2: its directory from ~, its title, and its latest load, after the compaction', async () => {
    const s = await read();
    expect(s).toMatchObject({ directory: repo, directoryShown: '~/Projects/ledger-web', title: 'Add CSV export to reports', loadedAt: T0 + 30 * 60_000 });
  });

  it('SETUP-6.3: the closing line counts what its lists named from outside the repo, and Everywhere’s hooks', async () => {
    const s = await read();
    // Skills: notes, p-kit:review and late-skill (release is the repo's); agents: p-kit:checker (reviewer is the repo's,
    // the rest built in); MCP: tracker and Calendar (ledger-db is the repo's); hooks: Everywhere's two that are on.
    expect(s.everywhere).toEqual({ skill: 3, agent: 1, mcp: 2, hook: 2 });
  });
});

describe('SETUP-7 Instructions and memory', () => {
  it('SETUP-7.1: the latest load’s files in its order, grouped, then a file loaded later, once', async () => {
    const s = await read();
    expect(s.instructions.map((f) => [f.shown, f.group, f.later])).toEqual([
      ['~/.claude/CLAUDE.md', 'yours', false],
      ['CLAUDE.md', 'repo', false],
      ['AGENTS.md', 'repo', false],
      ['CLAUDE.local.md', 'repo', false],
      ['api/CLAUDE.md', 'repo', true],
    ]);
    expect(s.instructions[0]).toMatchObject({ lines: 4, tokens: Math.round(USER.length / 4), loadedAt: T0 + 30 * 60_000 });
    expect(s.instructions[4]).toMatchObject({ lines: 2, loadedAt: T0 + 40 * 60_000 });
  });

  it('SETUP-7.2: a file another imports names its importer, which counts it; an @ in code isn’t an import', async () => {
    const s = await read();
    const claude = s.instructions.find((f) => f.shown === 'CLAUDE.md')!;
    expect(claude.imports).toBe(1);
    expect(s.instructions.find((f) => f.shown === 'AGENTS.md')).toMatchObject({ importer: claude.key, imports: 0 });
    expect(importsOf('See `@a.md` and\n```\n@b.md\n```\n@c.md, @~/d.md', '/r/CLAUDE.md', '/h')).toEqual(['/r/c.md', '/h/d.md']);
  });

  it('SETUP-7.3: changed when the disk’s text differs from what loaded, gone when it’s not on disk; a last newline isn’t a change', async () => {
    const s = await read();
    const by = (shown: string) => s.instructions.find((f) => f.shown === shown)!;
    expect(by('~/.claude/CLAUDE.md')).toMatchObject({ disk: 'same', changedAt: null });
    expect(by('AGENTS.md')).toMatchObject({ disk: 'same' });
    expect(by('CLAUDE.md')).toMatchObject({ disk: 'changed', changedAt: expect.any(Number) });
    expect(by('CLAUDE.local.md')).toMatchObject({ disk: 'gone' });
  });

  it('SETUP-7.5: the memory index as loaded, an entry per line with its file’s type', async () => {
    const s = await read();
    const dir = join(home, '.claude/projects/-ledger/memory');
    expect(s.memory).toEqual({
      path: join(dir, 'MEMORY.md'),
      tokens: Math.round(MEMORY.length / 4),
      entries: [
        { key: expect.any(String), title: 'Prefers pnpm', file: join(dir, 'prefers-pnpm.md'), type: 'feedback' },
        { key: expect.any(String), title: 'Staging data', file: join(dir, 'staging.md'), type: 'project' },
      ],
    });
  });
});

describe('SETUP-8 Ran in this Session', () => {
  it('SETUP-8.1: by kind, Skills, Agents, MCP servers, then Hooks, the most first; a hook’s failed runs', async () => {
    const s = await read();
    expect(s.ran.map((r) => [r.kind, r.name, r.count, r.failed])).toEqual([
      ['skill', 'p-kit:review', 2, 0],
      ['skill', 'release', 2, 0],
      ['agent', 'Explore', 1, 0],
      ['agent', 'general-purpose', 1, 0],
      ['agent', 'p-kit:checker', 1, 0],
      ['mcp', 'Calendar', 2, 0],
      ['mcp', 'tracker', 1, 0],
      ['hook', 'guard.mjs', 3, 1],
      ['hook', 'check-migrations.mjs', 1, 0],
      ['hook', 'lint-gate.mjs', 1, 1],
      ['hook', 'relay-hook.sh', 1, 0],
    ]);
    expect(s.ran.find((r) => r.name === 'guard.mjs')?.events).toEqual(['PreToolUse', 'PostToolUse']);
  });

  it('SETUP-8.2: a row is the item Setup lists, Everywhere or the repo’s, a hook by its command; a built-in Subagent says so', async () => {
    const s = await read();
    const by = (name: string) => s.ran.find((r) => r.name === name)!;
    expect(by('guard.mjs').item).toMatchObject({ kind: 'hook', source: { type: 'yours' }, command: GUARD });
    expect(by('check-migrations.mjs').item).toMatchObject({ source: { type: 'repo' }, file: join(repo, '.claude/settings.json') });
    expect(by('release').item).toMatchObject({ source: { type: 'repo' } });
    expect(by('tracker').item).toMatchObject({ kind: 'mcp', source: { type: 'plugin', name: 'p-kit' } });
    expect(by('p-kit:checker').item).toMatchObject({ kind: 'agent', source: { type: 'plugin' } });
    expect(by('Explore')).toMatchObject({ item: null, builtIn: true });
    expect(by('Calendar')).toMatchObject({ item: null, origin: 'claude.ai' });
    expect(by('lint-gate.mjs')).toMatchObject({ item: null, events: ['PostToolUse'] });
    // The repo's skill that ran is in This repo's own too, without its count.
    expect(s.repo.find((i) => i.name === 'release')).toBeDefined();
  });

  it('SETUP-8.3: counts cover the whole Session, before and after a compaction', async () => {
    const s = await read();
    expect(s.ran.find((r) => r.name === 'guard.mjs')?.count).toBe(3);
    expect(s.ran.find((r) => r.name === 'release')?.count).toBe(2);
  });
});

describe('SETUP-9 This repo’s own', () => {
  it('SETUP-9.1: its skills, commands, agents, both settings files’ hooks, .mcp.json and its own plugins, credentials hidden', async () => {
    const s = await read();
    const names = [...s.repo, ...s.notLoaded.map((n) => n.item)].map((i) => `${i.kind}:${i.name}`).sort();
    expect(names).toEqual(['agent:reviewer', 'hook:check-migrations.mjs', 'hook:say', 'mcp:ledger-db', 'mcp:metrics', 'skill:p-repo:schema', 'skill:release', 'skill:seed']);
    const all = [...s.repo, ...s.notLoaded.map((n) => n.item)];
    expect(all.find((i) => i.name === 'seed')).toMatchObject({ source: { type: 'repo' }, description: 'Seed the staging database.', call: '/seed <size>', file: join(repo, '.claude/commands/seed.md') });
    expect(all.find((i) => i.name === 'say')).toMatchObject({ file: join(repo, '.claude/settings.local.json') });
    expect(all.find((i) => i.name === 'p-repo:schema')).toMatchObject({ source: { type: 'plugin', id: 'p-repo@market' } });
    expect(JSON.stringify(s)).not.toContain(SECRET);
  });

  it('SETUP-9.1: a command in a subfolder of .claude/commands is the repo’s, named by its file; its runs are its', async () => {
    await put(join(repo, '.claude/commands/tools/check.md'), '---\ndescription: Check the build.\n---\n');
    await put(join(home, `.claude/projects/-ledger/${ID}.jsonl`), transcript() + JSON.stringify(typed(90, '<command-name>/check</command-name>')) + '\n');
    const s = await read();
    const all = [...s.repo, ...s.notLoaded.map((n) => n.item)];
    expect(all.find((i) => i.name === 'check')).toMatchObject({ source: { type: 'repo' }, call: '/check', file: join(repo, '.claude/commands/tools/check.md') });
    expect(s.ran.find((r) => r.name === 'check')?.item).toMatchObject({ file: join(repo, '.claude/commands/tools/check.md') });
  });

  it('SETUP-9.1: a repo file that can’t be parsed is one error row; the rest still shows', async () => {
    await put(join(repo, '.mcp.json'), '{ not json');
    const s = await read();
    expect(s.errors).toEqual([{ where: 'repo', kind: 'mcp', file: join(repo, '.mcp.json'), error: expect.stringContaining('not valid JSON') }]);
    expect(s.repo.find((i) => i.name === 'release')).toBeDefined();
  });

  it('SETUP-9.2: what its lists don’t name is not loaded, with why: an unapproved .mcp.json server, or not in its lists', async () => {
    // A load after every file here was made: nothing was added after it.
    await put(join(home, `.claude/projects/-ledger/${ID}.jsonl`), transcript({ loads: [0, 60 * 24 * 365 * 50] }));
    await put(join(repo, '.claude/agents/drafter.md'), '---\nname: drafter\ndescription: Drafts.\n---\n');
    const s = await read();
    expect(s.notLoaded.map((n) => [n.item.name, n.why])).toEqual(
      expect.arrayContaining([
        ['seed', { reason: 'not-listed' }],
        ['drafter', { reason: 'not-listed' }],
        ['p-repo:schema', { reason: 'not-listed' }],
      ]),
    );
    // metrics isn't approved for the repo; ledger-db is. Hooks aren't in any list.
    expect(s.notLoaded.find((n) => n.item.name === 'metrics')?.why).toEqual({ reason: 'not-approved' });
    expect(s.notLoaded.some((n) => n.item.name === 'ledger-db' || n.item.kind === 'hook')).toBe(false);
  });

  it('SETUP-9.2: a list recorded empty names nothing, so the repo’s skills and agents aren’t loaded; with none recorded, nothing is said', async () => {
    const lines = (listings: boolean) =>
      [
        files(60 * 24 * 365 * 50, { user: USER, claude: CLAUDE, agents: AGENTS, memory: MEMORY }),
        ...(listings
          ? [
              attachment(60 * 24 * 365 * 50, { type: 'skill_listing', isInitial: true, names: [], skillCount: 0 }),
              attachment(60 * 24 * 365 * 50, { type: 'agent_listing_delta', isInitial: true, addedTypes: [], builtInTypes: [], removedTypes: [] }),
            ]
          : []),
      ]
        .map((l) => JSON.stringify(l))
        .join('\n') + '\n';
    await put(join(home, `.claude/projects/-ledger/${ID}.jsonl`), lines(true));
    let s = await read();
    expect(s.notLoaded.map((n) => n.item.name)).toEqual(expect.arrayContaining(['release', 'seed', 'reviewer']));
    await put(join(home, `.claude/projects/-ledger/${ID}.jsonl`), lines(false));
    s = await read();
    expect(s.notLoaded.some((n) => n.item.kind === 'skill' || n.item.kind === 'agent')).toBe(false);
  });

  it('SETUP-9.2: an item made after the latest load says when it was added', async () => {
    const s = await read();
    // The Transcript's loads are in 2025; the fixture's files were made now, after them.
    expect(s.notLoaded.find((n) => n.item.name === 'seed')?.why).toEqual({ reason: 'added', at: expect.any(Number) });
  });
});

describe('reading a Transcript', () => {
  it('SETUP-6.5: lines it doesn’t know, or can’t parse, are skipped', () => {
    const r = new TranscriptReader();
    r.line('{ not json');
    r.line(JSON.stringify({ type: 'attachment', attachment: { type: 'instructions', files: 'not a list' } }));
    r.line(JSON.stringify({ type: 'attachment', attachment: { type: 'hook_success', command: '' } }));
    r.line(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: {} }] } }));
    expect(r.facts).toMatchObject({ files: [], hookRuns: [], loadedAt: null });
    expect(r.facts.skillCalls.size).toBe(0);
  });

  it('SETUP-8.1: a tool call is read with or without a space after its keys’ colons', () => {
    const r = new TranscriptReader();
    r.line('{"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Skill", "input": {"skill": "notes"}}]}}');
    r.line('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__ledger-db__query","input":{}}]}}');
    expect([...r.facts.skillCalls]).toEqual([['notes', 1]]);
    expect([...r.facts.mcpCalls]).toEqual([['ledger-db', 1]]);
  });

  it('SETUP-6.3: a server whose deferred tools were all removed is no longer in its lists', () => {
    const r = new TranscriptReader();
    const delta = (addedNames: string[], removedNames: string[]) => JSON.stringify({ type: 'attachment', attachment: { type: 'deferred_tools_delta', addedNames, removedNames } });
    r.line(delta(['mcp__docs__search', 'mcp__docs__read', 'mcp__tickets__list'], []));
    r.line(delta([], ['mcp__tickets__list', 'mcp__docs__read']));
    expect([...r.facts.mcpTools]).toEqual(['docs']);
  });

  it('SETUP-8.2: an MCP server’s name as its tools carry it', () => {
    expect(mcpToolName('plugin:p-kit:tracker')).toBe('plugin_p-kit_tracker');
    expect(mcpToolName('claude.ai Calendar')).toBe('claude_ai_Calendar');
  });

  it('SETUP-6.2: a path from the repo, else from ~', () => {
    expect(shownPath('/h/r/a/CLAUDE.md', '/h/r', '/h')).toBe('a/CLAUDE.md');
    expect(shownPath('/h/.claude/CLAUDE.md', '/h/r', '/h')).toBe('~/.claude/CLAUDE.md');
    expect(shownPath('/etc/x', '/h/r', '/h')).toBe('/etc/x');
  });
});
