import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { materializeOutputs } from '../e2e/fakes/outputs.ts';
import { respond } from '../e2e/fakes/tb-session.ts';
import { world } from '../e2e/world/builder.ts';

it('LIB-2.6: World declarations write parent and Subagent tool fixtures and files; the contract fake keeps parent credits and folded source fields', async () => {
  const home = await mkdtemp(join(tmpdir(), 'lookout-output-fixtures-'));
  try {
    const spec = world().outputs([
      { kind: 'file', path: 'output/report.md', events: 2 },
      { kind: 'file', path: 'output/map.html', updatedAt: '2026-10-24T10:00:00Z' },
      { kind: 'artifact', sourcePath: 'output/map.html', title: 'Map' },
      { kind: 'artifact', sourcePath: 'output/refused.html', refused: true },
      { kind: 'share', sourcePath: 'output/report.md', json: true },
      { kind: 'share', sourcePath: 'output/report.md', json: false },
      { kind: 'file', path: 'output/subagent.md', subagent: true },
    ]).declaration();
    const answer = await materializeOutputs(home, spec.outputs!.items);
    expect(answer.results).toHaveLength(5);
    expect(answer.results.find((r) => r.kind === 'artifact')).toMatchObject({ source: { path: join(home, 'output/map.html') } });
    expect((await stat(join(home, 'output/subagent.md'))).isFile()).toBe(true);
    const roots = await readdir(join(home, '.claude/projects'));
    const parent = await readFile(join(home, '.claude/projects', roots[0]!, 'library-writer.jsonl'), 'utf8');
    expect(parent).toContain('"name":"Write"'); expect(parent).toContain('"name":"Edit"'); expect(parent).toContain('"is_error":true'); expect(parent).toContain('tb-backyard share upload');
    const subagent = await readFile(join(home, '.claude/projects', roots[0]!, 'library-writer/subagents/agent-world-6.jsonl'), 'utf8'); expect(subagent).toContain('"sessionId":"library-writer"');
    const pages = respond(['outputs', '--all-projects', '--json', '--kind', 'file,artifact', '--type', 'html', '--limit', '50', '--page', '1'], answer);
    if (!('stdout' in pages)) throw new Error('no answer');
    expect(JSON.parse(pages.stdout!).results).toHaveLength(1);
    const search = respond(['outputs', '--json', '--q', '--', 'map.html'], answer);
    if (!('stdout' in search)) throw new Error('no answer');
    expect(JSON.parse(search.stdout!).results[0].title).toBe('Map');
    expect(respond(['outputs', '--json'], { ...answer, unsupported: true })).toEqual({ code: 2, stderr: "error: unrecognized subcommand 'outputs'\n" });
    expect(respond(['outputs', '--json', '--mystery'], answer)).toHaveProperty('refused');
    expect(respond(['show', '--json', '--harness', 'claude', '--', 'library-writer'], answer)).toHaveProperty('stdout');
    expect(respond(['list', '--json'], answer)).toHaveProperty('stdout');
    expect(respond(['search', '--json', '--', 'World'], answer)).toHaveProperty('stdout');
    expect(() => world().outputs([{ kind: 'file', path: '../escape.html' }])).toThrow('relative to HOME');
    expect(world().declaration().outputs).toBeNull();
  } finally { await rm(home, { recursive: true, force: true }); }
});
