import { describe, expect, it } from 'vitest';
import { BUILTIN_COMMANDS, BUILTIN_LEFT_OUT } from './builtin-commands.ts';
import { MAX_COMMAND_DESCRIPTION, MAX_COMMAND_HINT, commandWord, isCommandName, oneLine, sourceLabel } from './commands.ts';

describe('the word a `/` list works on', () => {
  it('VIEW-15.1: the box holds one word that starts with `/` and nothing else', () => {
    expect(commandWord('/')).toEqual({ word: '/', query: '', start: 0 });
    expect(commandWord('/comp')).toEqual({ word: '/comp', query: 'comp', start: 0 });
    expect(commandWord('/p-dev:code')).toEqual({ word: '/p-dev:code', query: 'p-dev:code', start: 0 });
    // Blanks before the `/` don't count: they aren't sent either (VIEW-3.8).
    expect(commandWord('  /comp')).toEqual({ word: '/comp', query: 'comp', start: 2 });
  });

  it('VIEW-15.1: a blank after the word, a second `/`, or a `/` later in the text is no such word', () => {
    expect(commandWord('/compact ')).toBeNull();
    expect(commandWord('/compact keep the plan')).toBeNull();
    expect(commandWord('/compact\n')).toBeNull();
    // A path (VIEW-9.7): its first word holds a second `/`.
    expect(commandWord('/Users/ana/shot.png')).toBeNull();
    expect(commandWord('/My\\ Folder/shot.png')).toBeNull();
    expect(commandWord('fix it /comp')).toBeNull();
    expect(commandWord('')).toBeNull();
    expect(commandWord('$review')).toBeNull();
  });
});

describe('what a list may hold', () => {
  it('VIEW-15.12: a name is letters, digits and `_ . : -`, at most 128 characters', () => {
    for (const ok of ['compact', 'p-dev:code', 'anthropic-skills:docx', 'run_all.v2', 'a'.repeat(128)]) expect(isCommandName(ok), ok).toBe(true);
    for (const bad of ['', 'two words', 'semi;colon', 'new\nline', 'tab\tbed', '-flag', ':colon', 'path/part', 'quote"d', 'dollar$', 'a'.repeat(129), 'esc\u001b[0m']) expect(isCommandName(bad), JSON.stringify(bad)).toBe(false);
  });

  it('VIEW-15.12: a description is its first line, its blanks single, cut with `…`', () => {
    expect(oneLine('\n  Review   a change.\nUse when asked.', MAX_COMMAND_DESCRIPTION)).toBe('Review a change.');
    const long = oneLine('x'.repeat(300), MAX_COMMAND_DESCRIPTION);
    expect(long).toHaveLength(MAX_COMMAND_DESCRIPTION);
    expect(long.endsWith('…')).toBe(true);
    expect(oneLine('[a] '.repeat(60), MAX_COMMAND_HINT).length).toBeLessThanOrEqual(MAX_COMMAND_HINT);
    expect(oneLine('', 10)).toBe('');
  });

  it('VIEW-15.5: where an item is from, in words', () => {
    expect(sourceLabel({ source: 'builtin', plugin: null })).toBe('Built-in');
    expect(sourceLabel({ source: 'repo', plugin: null })).toBe('This repo');
    expect(sourceLabel({ source: 'yours', plugin: null })).toBe('Yours');
    expect(sourceLabel({ source: 'claude-ai', plugin: null })).toBe('claude.ai');
    expect(sourceLabel({ source: 'plugin', plugin: 'p-kit' })).toBe('p-kit');
  });
});

describe('the Built-in commands Lookout keeps', () => {
  it('VIEW-15.4: one list per Harness, with the version it was checked against', () => {
    expect(BUILTIN_COMMANDS.claude.checked).toMatch(/^\d+\.\d+\.\d+$/);
    expect(BUILTIN_COMMANDS.codex.checked).toMatch(/^\d+\.\d+\.\d+$/);
    expect(BUILTIN_COMMANDS.claude.commands.length).toBeGreaterThan(80);
    expect(BUILTIN_COMMANDS.codex.commands.length).toBeGreaterThan(40);
  });

  it('VIEW-15.4: every command has a name Lookout will type, a few words on what it does and a hint that fits, once', () => {
    for (const harness of ['claude', 'codex'] as const) {
      const names = BUILTIN_COMMANDS[harness].commands.map((c) => c.name);
      expect(new Set(names).size, `${harness}: a name twice`).toBe(names.length);
      expect([...names].sort(), `${harness}: kept in order, so a diff shows what a release changed`).toEqual(names);
      for (const c of BUILTIN_COMMANDS[harness].commands) {
        expect(isCommandName(c.name), c.name).toBe(true);
        expect(c.description.length, c.name).toBeGreaterThan(3);
        expect(c.description.length, c.name).toBeLessThanOrEqual(60);
        expect(c.description, c.name).not.toMatch(/[\n.]$/);
        if (c.hint !== undefined) expect(oneLine(c.hint, MAX_COMMAND_HINT), c.name).toBe(c.hint);
      }
    }
  });

  it('VIEW-15.4: the commands that end the Session or sign the Mac out are left out, and Codex\'s `/diff`, which Esc can\'t close', () => {
    for (const harness of ['claude', 'codex'] as const) {
      const names = new Set(BUILTIN_COMMANDS[harness].commands.map((c) => c.name));
      for (const out of BUILTIN_LEFT_OUT[harness]) expect(names.has(out), `${harness}: /${out}`).toBe(false);
    }
    expect(BUILTIN_LEFT_OUT.claude).toEqual(expect.arrayContaining(['exit', 'quit', 'login', 'logout']));
    expect(BUILTIN_LEFT_OUT.codex).toEqual(expect.arrayContaining(['exit', 'quit', 'logout', 'diff']));
  });

  it('VIEW-15.4: a command that opens a dialog, a picker or a panel is marked, and one that acts at once isn\'t', () => {
    const marked = (harness: 'claude' | 'codex', name: string) => BUILTIN_COMMANDS[harness].commands.find((c) => c.name === name)?.dialog === true;
    for (const name of ['config', 'model', 'resume', 'usage', 'status', 'help', 'effort', 'permissions']) expect(marked('claude', name), `claude /${name}`).toBe(true);
    for (const name of ['compact', 'clear', 'init', 'context', 'code-review', 'reload-skills']) expect(marked('claude', name), `claude /${name}`).toBe(false);
    for (const name of ['model', 'review', 'resume', 'permissions', 'export']) expect(marked('codex', name), `codex /${name}`).toBe(true);
    for (const name of ['compact', 'new', 'init', 'status', 'pwd']) expect(marked('codex', name), `codex /${name}`).toBe(false);
  });
});
