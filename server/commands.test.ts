import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_COMMANDS } from '../shared/builtin-commands.ts';
import { MAX_COMMANDS, MAX_COMMAND_DESCRIPTION, MAX_COMMAND_HINT } from '../shared/commands.ts';
import type { SetupItem } from '../shared/setup.ts';
import { Commands, commandList } from './commands.ts';
import type { Runner } from './exec.ts';
import { HEAD_BYTES, Setup } from './setup.ts';

// Invented look-alikes of a Harness setup; no real configuration is copied here.
const skill = (over: Partial<SetupItem> & Pick<SetupItem, 'name'>): SetupItem => ({
  key: `skill:${over.name}:${Math.random()}`,
  kind: 'skill',
  harness: 'claude',
  description: `What ${over.name} does.`,
  source: { type: 'yours' },
  file: `/home/ana/.claude/skills/${over.name}/SKILL.md`,
  line: null,
  off: null,
  call: `/${over.name}`,
  ...over,
});
const plugin = (name: string) => ({ type: 'plugin' as const, name, id: `${name}@market`, version: '1.0.0' });
const calls = (items: readonly { call: string }[]) => items.map((i) => i.call);

describe('what a `/` lists for a Harness', () => {
  it('VIEW-15.2: Claude Code: the directory\'s own skills and commands, the skills that are on, and the Built-in commands', () => {
    const list = commandList(
      'claude',
      [
        skill({ name: 'ship-it', source: { type: 'repo' }, file: '/work/ledger/.claude/skills/ship-it/SKILL.md' }),
        skill({ name: 'lint', source: { type: 'repo' }, file: '/work/ledger/.claude/commands/tools/lint.md' }),
        skill({ name: 'notes', call: '/notes add | list' }),
        skill({ name: 'p-kit:review', source: plugin('p-kit'), call: '/p-kit:review <pr>' }),
        skill({ name: 'anthropic-skills:docs', source: { type: 'claude-ai' } }),
      ],
      [],
      7,
    );
    expect(list).toMatchObject({ harness: 'claude', error: null, readAt: 7 });
    expect(calls(list.items)).toEqual(expect.arrayContaining(['/ship-it', '/lint', '/notes', '/p-kit:review', '/anthropic-skills:docs', '/compact', '/config']));
    expect(list.items.find((i) => i.call === '/notes')).toEqual({ call: '/notes', name: 'notes', hint: 'add | list', description: 'What notes does.', source: 'yours', plugin: null, dialog: false });
    expect(list.items.find((i) => i.call === '/p-kit:review')).toMatchObject({ hint: '<pr>', source: 'plugin', plugin: 'p-kit' });
    expect(list.items.find((i) => i.call === '/ship-it')).toMatchObject({ source: 'repo', hint: null });
    expect(list.items.find((i) => i.call === '/anthropic-skills:docs')).toMatchObject({ source: 'claude-ai' });
    expect(list.items.filter((i) => i.source === 'builtin')).toHaveLength(BUILTIN_COMMANDS.claude.commands.length);
  });

  it('VIEW-15.2: a skill that is off, or that only the model may call, isn\'t listed', () => {
    const list = commandList(
      'claude',
      [skill({ name: 'quiet', off: 'override' }), skill({ name: 'p-old:draft', source: plugin('p-old'), off: 'plugin' }), skill({ name: 'model-only', userInvocable: false }), skill({ name: 'name-only', listing: 'name-only' }), skill({ name: 'notes' })],
      [],
      0,
    );
    const mine = calls(list.items.filter((i) => i.source !== 'builtin'));
    // A `skillOverrides` value other than `off` leaves a skill yours to call (SETUP-4.1).
    expect(mine.sort()).toEqual(['/name-only', '/notes']);
  });

  it('VIEW-15.2: a name two sources give is listed once, as the one Claude Code runs', () => {
    const list = commandList(
      'claude',
      [
        // The directory's command file, its skill folder and yours all call themselves `/deploy`.
        skill({ name: 'deploy', description: "The repo's command file.", source: { type: 'repo' }, file: '/work/ledger/.claude/commands/deploy.md' }),
        skill({ name: 'deploy', description: "The repo's skill.", source: { type: 'repo' }, file: '/work/ledger/.claude/skills/deploy/SKILL.md' }),
        skill({ name: 'deploy', description: 'Yours.' }),
        skill({ name: 'lint', description: "The repo's command file.", source: { type: 'repo' }, file: '/work/ledger/.claude/commands/lint.md' }),
        skill({ name: 'lint', description: "The repo's skill.", source: { type: 'repo' }, file: '/work/ledger/.claude/skills/lint/SKILL.md' }),
        // A skill of yours named as a Built-in command replaces it.
        skill({ name: 'compact', description: 'Your own compact.' }),
      ],
      [],
      0,
    );
    const of = (call: string) => list.items.filter((i) => i.call === call);
    expect(of('/deploy')).toEqual([expect.objectContaining({ description: 'Yours.', source: 'yours' })]);
    expect(of('/lint')).toEqual([expect.objectContaining({ description: "The repo's skill.", source: 'repo' })]);
    expect(of('/compact')).toEqual([expect.objectContaining({ description: 'Your own compact.', source: 'yours', dialog: false })]);
  });

  it('VIEW-15.3: Codex: its skills, each called `$name`, and its Built-in commands', () => {
    const list = commandList('codex', [skill({ name: 'cx-review', harness: 'codex', call: '$cx-review' }), skill({ name: 'review', harness: 'codex', call: '$review' })], [], 0);
    expect(list.harness).toBe('codex');
    expect(list.items.find((i) => i.call === '$cx-review')).toEqual({ call: '$cx-review', name: 'cx-review', hint: null, description: 'What cx-review does.', source: 'yours', plugin: null, dialog: false });
    // A skill and a Built-in command of one name are two calls in Codex: `$review` and `/review`.
    expect(calls(list.items)).toEqual(expect.arrayContaining(['$review', '/review', '/compact', '/model']));
    expect(calls(list.items)).not.toContain('/diff');
    expect(list.items.filter((i) => i.source === 'builtin')).toHaveLength(BUILTIN_COMMANDS.codex.commands.length);
  });

  it('VIEW-15.4: a Built-in command carries its hint and its mark', () => {
    const list = commandList('claude', [], [], 0);
    expect(list.items.find((i) => i.call === '/compact')).toEqual({ call: '/compact', name: 'compact', hint: '[instructions]', description: 'Summarize the conversation to free context', source: 'builtin', plugin: null, dialog: false });
    expect(list.items.find((i) => i.call === '/config')).toMatchObject({ dialog: true, source: 'builtin' });
  });

  it('LAUNCH-8.2: the launcher\'s list leaves out the Built-in commands that open a dialog', () => {
    const list = commandList('claude', [skill({ name: 'notes' })], [], 0, { dialogs: false });
    expect(list.items.some((i) => i.dialog)).toBe(false);
    expect(calls(list.items)).toEqual(expect.arrayContaining(['/notes', '/compact', '/init']));
    expect(calls(list.items)).not.toContain('/config');
    expect(calls(commandList('codex', [], [], 0, { dialogs: false }).items)).not.toContain('/model');
  });

  it('VIEW-15.12: a name Lookout won\'t type isn\'t listed, and a description and a hint are one line, cut', () => {
    const list = commandList(
      'claude',
      [
        skill({ name: 'two words' }),
        skill({ name: 'run; rm -rf ~' }),
        skill({ name: 'line\nbreak' }),
        skill({ name: 'x'.repeat(200) }),
        skill({ name: 'fine', description: `First line.\nSecond line.\n${'y'.repeat(400)}`, call: `/fine ${'[a] '.repeat(80)}` }),
        skill({ name: 'wordy', description: 'z'.repeat(400) }),
      ],
      [],
      0,
    );
    const mine = list.items.filter((i) => i.source !== 'builtin');
    expect(calls(mine).sort()).toEqual(['/fine', '/wordy']);
    const fine = mine.find((i) => i.call === '/fine')!;
    expect(fine.description).toBe('First line.');
    expect(fine.hint!.length).toBeLessThanOrEqual(MAX_COMMAND_HINT);
    expect(fine.hint!.endsWith('…')).toBe(true);
    const wordy = mine.find((i) => i.call === '/wordy')!;
    expect(wordy.description).toHaveLength(MAX_COMMAND_DESCRIPTION);
    expect(wordy.description.endsWith('…')).toBe(true);
  });

  it('VIEW-15.12: the list holds at most 2,000 items', () => {
    const many = Array.from({ length: MAX_COMMANDS + 50 }, (_, i) => skill({ name: `skill-${i}` }));
    expect(commandList('claude', many, [], 0).items).toHaveLength(MAX_COMMANDS);
  });

  it('VIEW-15.10: what couldn\'t be read is said in one line, and the rest still lists', () => {
    const list = commandList('claude', [skill({ name: 'notes' })], [{ kind: 'skill', file: 'claude plugin list --json', error: 'timed out\nafter 30 s' }], 0);
    expect(list.error).toBe('claude plugin list --json: timed out');
    expect(calls(list.items)).toEqual(expect.arrayContaining(['/notes', '/compact']));
  });
});

describe('reading the list', () => {
  it('VIEW-15.10: a read under way is shared by those who ask meanwhile, and the next one reads again', async () => {
    const finish: ((v: { items: SetupItem[]; errors: [] }) => void)[] = [];
    const readSkills = vi.fn(() => new Promise<{ items: SetupItem[]; errors: [] }>((resolve) => { finish.push(resolve); }));
    const commands = new Commands({ setup: { readSkills }, now: () => 42 });
    const first = commands.list('claude', '/work/ledger');
    const second = commands.list('claude', '/work/ledger');
    const elsewhere = commands.list('claude', '/work/other');
    // Two reads: one for each directory, the second ask for the first joining its read.
    expect(readSkills).toHaveBeenCalledTimes(2);
    expect(readSkills).toHaveBeenNthCalledWith(1, 'claude', '/work/ledger');
    expect(readSkills).toHaveBeenNthCalledWith(2, 'claude', '/work/other');
    finish[0]!({ items: [skill({ name: 'notes' })], errors: [] });
    finish[1]!({ items: [], errors: [] });
    const [a, b, c] = await Promise.all([first, second, elsewhere]);
    expect(a.readAt).toBe(42);
    expect(calls(a.items)).toContain('/notes');
    expect(b.items).toEqual(a.items);
    expect(calls(c.items)).not.toContain('/notes');
    const again = commands.list('claude', '/work/ledger');
    expect(readSkills).toHaveBeenCalledTimes(3);
    finish[2]!({ items: [], errors: [] });
    expect(calls((await again).items)).not.toContain('/notes');
  });

  it('VIEW-15.10: a read that throws still lists the Built-in commands, and says why', async () => {
    const commands = new Commands({ setup: { readSkills: async () => { throw new Error('disk on fire\nstack…'); } } });
    const list = await commands.list('codex', null);
    expect(list.error).toBe('skills: disk on fire');
    expect(calls(list.items)).toContain('/compact');
  });
});

describe('the skills Setup reads for a list', () => {
  let home: string;
  let repo: string;
  const put = async (path: string, text: string) => {
    const file = join(home, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  };
  const md = (name: string, description: string, extra = '') => `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# ${name}\n`;
  const runner = vi.fn<Runner>(async (_bin, args) => {
    if (args.join(' ') !== 'plugin list --json') throw new Error(`unexpected: ${args.join(' ')}`);
    return JSON.stringify([
      { id: 'p-kit@market', version: '1.2.0', scope: 'user', enabled: true, installPath: join(home, 'cache/p-kit') },
      { id: 'p-old@market', version: '0.3.0', scope: 'user', enabled: false, installPath: join(home, 'cache/p-old') },
      { id: 'p-repo@market', version: '2.0.0', scope: 'project', projectPath: repo, enabled: true, installPath: join(home, 'cache/p-repo') },
      { id: 'p-other@market', version: '2.0.0', scope: 'project', projectPath: '/somewhere/else', enabled: true, installPath: join(home, 'cache/p-other') },
    ]);
  });
  const setup = () => new Setup({ home, runner, claudeBin: async () => '/fake/claude' });

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'lookout-commands-'));
    repo = join(home, 'work/ledger');
    runner.mockClear();
    await put('.claude/settings.json', JSON.stringify({ skillOverrides: { quiet: 'off' } }));
    await put('.claude/skills/notes/SKILL.md', md('notes', 'Keep notes.', 'argument-hint: add | list\n'));
    await put('.claude/skills/quiet/SKILL.md', md('quiet', 'Turned off.'));
    await put('.claude/skills/background/SKILL.md', md('background', 'Only the model calls this.', 'user-invocable: false\n'));
    await put('.claude/skills/synced/space-1/docs/SKILL.md', md('docs', 'Shared docs.'));
    await put('.claude/agents/scout.md', '---\nname: scout\ndescription: Looks around.\n---\n');
    await put('cache/p-kit/skills/review/SKILL.md', md('review', 'Review a change.', 'argument-hint: <pr>\n'));
    await put('cache/p-old/skills/draft/SKILL.md', md('draft', 'Draft a plan.'));
    await put('cache/p-repo/skills/check/SKILL.md', md('check', 'Check the ledger.'));
    await put('cache/p-other/skills/far/SKILL.md', md('far', "Another repo's."));
    await put('work/ledger/.claude/skills/ship-it/SKILL.md', md('ship-it', 'Ship the ledger.'));
    await put('work/ledger/.claude/commands/tools/lint.md', '---\ndescription: Lint the ledger.\nuser-invocable: false\n---\nRun the linter.');
    await put('work/ledger/.claude/commands/fmt.md', 'Format the ledger.\n');
    await put('.codex/skills/cx-review/SKILL.md', md('cx-review', 'Review, in Codex.'));
    await put('.agents/skills/adopt/SKILL.md', md('adopt', 'Adopt a convention.'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('VIEW-15.2: Claude Code\'s, Everywhere and in a directory, with what turns one off or keeps it the model\'s', async () => {
    const { items, errors } = await setup().readSkills('claude', repo);
    expect(errors).toEqual([]);
    expect(items.every((i) => i.kind === 'skill' && i.harness === 'claude')).toBe(true);
    const by = Object.fromEntries(items.map((i) => [i.name, i]));
    expect(Object.keys(by).sort()).toEqual(['anthropic-skills:docs', 'background', 'fmt', 'lint', 'notes', 'p-kit:review', 'p-old:draft', 'p-repo:check', 'quiet', 'ship-it']);
    expect(by.background).toMatchObject({ userInvocable: false, off: null });
    expect(by.lint).toMatchObject({ userInvocable: false, source: { type: 'repo' } });
    expect(by.notes).not.toHaveProperty('userInvocable');
    expect(by.quiet).toMatchObject({ off: 'override' });
    expect(by['p-old:draft']).toMatchObject({ off: 'plugin' });
    expect(by['p-repo:check']).toMatchObject({ source: { type: 'plugin', name: 'p-repo' }, off: null });
    expect(by['ship-it']).toMatchObject({ source: { type: 'repo' } });

    const list = commandList('claude', items, errors, 0);
    expect(calls(list.items.filter((i) => i.source !== 'builtin')).sort()).toEqual(['/anthropic-skills:docs', '/fmt', '/notes', '/p-kit:review', '/p-repo:check', '/ship-it']);
    expect(list.items.find((i) => i.call === '/fmt')).toMatchObject({ description: 'Format the ledger.', source: 'repo' });
    expect(list.items.find((i) => i.call === '/p-kit:review')).toMatchObject({ hint: '<pr>', plugin: 'p-kit' });
  });

  it('VIEW-15.2: with no directory, only what every Session loads', async () => {
    const { items } = await setup().readSkills('claude', null);
    expect(items.map((i) => i.name).sort()).toEqual(['anthropic-skills:docs', 'background', 'notes', 'p-kit:review', 'p-old:draft', 'quiet']);
  });

  it('VIEW-15.3: Codex\'s, read without asking Claude Code for its plugins', async () => {
    const { items, errors } = await setup().readSkills('codex', repo);
    expect(errors).toEqual([]);
    expect(items.map((i) => `${i.harness}:${i.call}`).sort()).toEqual(['codex:$adopt', 'codex:$cx-review']);
    expect(runner).not.toHaveBeenCalled();
    expect(calls(commandList('codex', items, errors, 0).items)).toEqual(expect.arrayContaining(['$adopt', '$cx-review', '/compact']));
  });

  it('VIEW-15.10: only the Harness\'s own skills are read: what else can\'t be read says nothing in its list', async () => {
    await put('.claude.json', '{ not json');
    await put('.claude/agents/broken.md/keep', '');
    await put('.codex/config.toml', '= not toml');
    await put('.codex/hooks.json', '{ not json');
    await put('work/ledger/.mcp.json', '{ not json');
    await put('work/ledger/.claude/settings.json', '{ not json');
    const claude = await setup().readSkills('claude', repo);
    expect(claude.errors).toEqual([]);
    expect(claude.items.map((i) => i.name)).toEqual(expect.arrayContaining(['notes', 'ship-it', 'p-kit:review']));

    // Codex's list doesn't read Claude Code's settings, nor Claude Code's a Codex skill.
    await put('.claude/settings.json', '{ not json');
    await put('.codex/skills/odd/SKILL.md/keep', '');
    const codex = await setup().readSkills('codex', repo);
    expect(codex.errors).toEqual([expect.objectContaining({ file: join(home, '.codex/skills/odd/SKILL.md'), error: 'not a regular file' })]);
    expect(codex.items.map((i) => i.name).sort()).toEqual(['adopt', 'cx-review']);
    const again = await setup().readSkills('claude', repo);
    expect(again.errors).toEqual([expect.objectContaining({ file: join(home, '.claude/settings.json') })]);
  });

  it('VIEW-15.12: only a regular file is read, and only its first 64 KB', async () => {
    // A repo's `.claude` can link anywhere: a device never ends, a pipe never answers.
    await mkdir(join(repo, '.claude/commands'), { recursive: true });
    await symlink('/dev/zero', join(repo, '.claude/commands/endless.md'));
    await mkdir(join(repo, '.claude/skills/linked'), { recursive: true });
    await symlink('/dev/zero', join(repo, '.claude/skills/linked/SKILL.md'));
    // A link to a regular file is read as the file is.
    await symlink(join(home, '.claude/skills/notes/SKILL.md'), join(repo, '.claude/commands/noted.md'));
    // What's past the first 64 KB isn't read: this command's first line is.
    await put('work/ledger/.claude/commands/long.md', `${'\n'.repeat(HEAD_BYTES)}Never read.\n`);
    await put('work/ledger/.claude/commands/big.md', `---\ndescription: Big, and read at its start.\n---\n${'x'.repeat(HEAD_BYTES * 3)}`);

    const { items, errors } = await setup().readSkills('claude', repo);
    expect(errors.map((e) => [e.file.slice(repo.length), e.error]).sort()).toEqual([
      ['/.claude/commands/endless.md', 'not a regular file'],
      ['/.claude/skills/linked/SKILL.md', 'not a regular file'],
    ]);
    const by = Object.fromEntries(items.map((i) => [i.name, i]));
    expect(by.noted).toMatchObject({ description: 'Keep notes.', source: { type: 'repo' } });
    expect(by.long).toMatchObject({ description: '' });
    expect(by.big).toMatchObject({ description: 'Big, and read at its start.' });
    expect(by['ship-it']).toBeDefined();
  });

  it('VIEW-15.10: a plugin list that can\'t be read is an error, and your own skills still come', async () => {
    runner.mockRejectedValueOnce(new Error('claude: not signed in'));
    const { items, errors } = await setup().readSkills('claude', repo);
    expect(errors).toEqual([expect.objectContaining({ kind: 'skill', file: 'claude plugin list --json' })]);
    expect(items.map((i) => i.name)).toEqual(expect.arrayContaining(['notes', 'ship-it']));
  });
});
